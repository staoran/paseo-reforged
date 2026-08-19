import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { isPlatform } from "../src/test-utils/platform.js";
import { signalProcessTree, type TreeKillTarget } from "../src/utils/tree-kill.js";
import { resolveSupervisorLogFile } from "./supervisor-log-config.js";

/** Worker environment key containing the fixture-owned process registry path. */
const FIXTURE_PROCESS_REGISTRY_ENV = "PASEO_SUPERVISOR_FIXTURE_PROCESS_REGISTRY";
/** Maximum wait for a registered descendant to disappear after forced termination. */
const FIXTURE_PROCESS_EXIT_TIMEOUT_MS = 2_000;
/** Poll interval while waiting for a registered descendant to disappear. */
const FIXTURE_PROCESS_EXIT_POLL_MS = 10;

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const supervisorPath = fileURLToPath(new URL("./supervisor.ts", import.meta.url));

interface SupervisorFixtureOptions {
  /** JavaScript module source executed as the supervised worker. */
  workerSource: string;
  /** Creates the configured log path as a directory to force a real stream error. */
  logPathIsDirectory?: boolean;
  /** Matches the production crash restart option. */
  restartOnCrash?: boolean;
  /** Maximum duration before the fixture force-kills its supervisor process. */
  timeoutMs?: number;
  /** Writes a release line to inherited stdin after this stderr marker is observed. */
  releaseWorkerAfterStderr?: string;
}

interface SupervisorFixtureResult {
  /** Supervisor process exit code. */
  code: number | null;
  /** Supervisor process exit signal. */
  signal: NodeJS.Signals | null;
  /** Wall-clock process lifetime used by restart timing assertions. */
  elapsedMs: number;
  /** Durable log contents, when the target is a regular file. */
  log: string;
  /** Captured supervisor and worker stdout. */
  stdout: string;
  /** Captured supervisor and worker stderr. */
  stderr: string;
}

interface SupervisorExit {
  /** Supervisor process exit code. */
  code: number | null;
  /** Supervisor process exit signal. */
  signal: NodeJS.Signals | null;
}

interface SupervisorExitedOutcome {
  /** Successful race discriminator. */
  type: "exit";
  /** Supervisor exit status. */
  exit: SupervisorExit;
}

interface SupervisorTimeoutOutcome {
  /** Timeout race discriminator. */
  type: "timeout";
}

type SupervisorExitOutcome = SupervisorExitedOutcome | SupervisorTimeoutOutcome;

interface WaitForSupervisorExitOptions {
  /** Spawned supervisor process. */
  child: ChildProcess;
  /** Resolves after the supervisor stdio and process handles close. */
  closed: Promise<void>;
  /** Resolves with the supervisor exit status. */
  exit: Promise<SupervisorExit>;
  /** Maximum duration before forcing supervisor termination. */
  timeoutMs: number;
}

interface WaitForFixtureProcessExitOptions {
  /** Registered fixture-owned process id. */
  processId: number;
  /** Maximum duration before reporting a cleanup failure. */
  timeoutMs: number;
}

/** Returns a Node-style error code without asserting the caught value's type. */
function getErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  if (!("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

/** Reads the descendant process id emitted by the restart fixture. */
function readDescendantProcessId(output: string): number {
  const match = output.match(/fixture-descendant-pid:(\d+)/);
  if (!match) {
    throw new Error("restart fixture did not report its descendant process id");
  }
  return Number(match[1]);
}

/** Reports whether a fixture process still accepts signals. */
function isFixtureProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (getErrorCode(error) === "ESRCH") {
      return false;
    }
    throw error;
  }
}

/** Best-effort emergency cleanup for a descendant when a test assertion fails. */
function forceKillFixtureProcess(processId: number): void {
  if (!isFixtureProcessRunning(processId)) {
    return;
  }
  try {
    process.kill(processId, "SIGKILL");
  } catch (error) {
    if (getErrorCode(error) !== "ESRCH") {
      throw error;
    }
  }
}

/** Adapts a registered process id to the shared process-tree signaling helper. */
function createFixtureProcessTarget(processId: number): TreeKillTarget {
  return {
    pid: processId,
    exitCode: null,
    signalCode: null,
    /** Sends the fallback signal directly when tree-kill cannot enumerate the process. */
    kill(signal) {
      try {
        return process.kill(processId, signal);
      } catch {
        return false;
      }
    },
  };
}

/** Reads unique process ids registered by workers owned by this fixture. */
async function readRegisteredFixtureProcessIds(registryPath: string): Promise<number[]> {
  let contents: string;
  try {
    contents = await readFile(registryPath, "utf8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  }

  const processIds = new Set<number>();
  for (const line of contents.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }
    const processId = Number(line);
    if (!Number.isSafeInteger(processId)) {
      throw new Error(`fixture process registry contains an invalid process id: ${line}`);
    }
    if (processId <= 0) {
      throw new Error(`fixture process registry contains an invalid process id: ${line}`);
    }
    processIds.add(processId);
  }
  return [...processIds];
}

/** Waits until a registered fixture process no longer exists. */
async function waitForFixtureProcessExit(options: WaitForFixtureProcessExitOptions): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (isFixtureProcessRunning(options.processId)) {
    if (Date.now() >= deadline) {
      throw new Error(`fixture process ${options.processId} did not exit after SIGKILL`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, FIXTURE_PROCESS_EXIT_POLL_MS);
    });
  }
}

/** Terminates every descendant explicitly registered as fixture-owned. */
async function cleanupRegisteredFixtureProcesses(registryPath: string): Promise<void> {
  const processIds = await readRegisteredFixtureProcessIds(registryPath);
  for (const processId of processIds) {
    await signalProcessTree(createFixtureProcessTarget(processId), "SIGKILL");
    await waitForFixtureProcessExit({
      processId,
      timeoutMs: FIXTURE_PROCESS_EXIT_TIMEOUT_MS,
    });
  }
}

/** Reports whether the spawned supervisor has not recorded an exit status. */
function isChildProcessRunning(child: ChildProcess | null): child is ChildProcess {
  if (!child) {
    return false;
  }
  if (child.exitCode !== null) {
    return false;
  }
  return child.signalCode === null;
}

/** Waits for process closure, force-killing on timeout before reporting failure. */
async function waitForSupervisorExit(
  options: WaitForSupervisorExitOptions,
): Promise<SupervisorExit> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const outcome: SupervisorExitOutcome = await Promise.race([
      options.exit.then((exit): SupervisorExitedOutcome => ({ type: "exit", exit })),
      new Promise<SupervisorTimeoutOutcome>((resolve) => {
        timeout = setTimeout(() => resolve({ type: "timeout" }), options.timeoutMs);
      }),
    ]);
    if (outcome.type === "exit") {
      return outcome.exit;
    }

    await signalProcessTree(options.child, "SIGKILL");
    await options.closed;
    throw new Error("supervisor fixture timed out");
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/** Runs an isolated real supervisor process and returns its externally visible output. */
async function runSupervisorFixture(
  options: SupervisorFixtureOptions,
): Promise<SupervisorFixtureResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "paseo-supervisor-log-"));
  const logPath = path.join(tempDir, "daemon.log");
  const workerPath = path.join(tempDir, "worker.mjs");
  const runnerPath = path.join(tempDir, "runner.mjs");
  const processRegistryPath = path.join(tempDir, "fixture-processes.txt");
  let child: ChildProcess | null = null;
  let closed: Promise<void> | null = null;

  try {
    if (options.logPathIsDirectory) {
      await mkdir(logPath);
    }
    await writeFile(workerPath, options.workerSource);
    await writeFile(
      runnerPath,
      `
      import { runSupervisor } from ${JSON.stringify(pathToFileURL(supervisorPath).href)};

      runSupervisor({
        name: "TestSupervisor",
        startupMessage: "starting fixture",
        resolveWorkerEntry: () => ${JSON.stringify(workerPath)},
        workerArgs: [],
        workerEnv: {
          ...process.env,
          [${JSON.stringify(FIXTURE_PROCESS_REGISTRY_ENV)}]: ${JSON.stringify(processRegistryPath)},
        },
        workerExecArgv: [],
        restartOnCrash: ${JSON.stringify(options.restartOnCrash ?? false)},
        logFile: {
          path: ${JSON.stringify(logPath)},
          rotate: { maxSize: "1m", maxFiles: 2 },
        },
      });
    `,
    );

    const startedAt = Date.now();
    const supervisor = spawn(process.execPath, ["--import", "tsx", runnerPath], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = supervisor;
    closed = new Promise<void>((resolve) => {
      supervisor.once("close", () => resolve());
    });
    const exit = new Promise<SupervisorExit>((resolve, reject) => {
      supervisor.once("error", reject);
      supervisor.once("close", (code, signal) => resolve({ code, signal }));
    });

    let stdout = "";
    let stderr = "";
    let workerReleased = false;
    supervisor.stdout?.setEncoding("utf8");
    supervisor.stderr?.setEncoding("utf8");
    supervisor.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    supervisor.stderr?.on("data", (chunk) => {
      stderr += chunk;
      if (workerReleased) {
        return;
      }
      const releaseMarker = options.releaseWorkerAfterStderr;
      if (!releaseMarker) {
        return;
      }
      if (!stderr.includes(releaseMarker)) {
        return;
      }
      workerReleased = true;
      supervisor.stdin?.end("release\n");
    });

    const { code, signal } = await waitForSupervisorExit({
      child: supervisor,
      closed,
      exit,
      timeoutMs: options.timeoutMs ?? 10_000,
    });

    const log = options.logPathIsDirectory ? "" : await readFile(logPath, "utf8");
    return { code, signal, elapsedMs: Date.now() - startedAt, log, stdout, stderr };
  } finally {
    try {
      if (isChildProcessRunning(child)) {
        await signalProcessTree(child, "SIGKILL");
        if (closed) {
          await closed;
        }
      }
      await cleanupRegisteredFixtureProcesses(processRegistryPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

describe("supervisor durable logging", () => {
  test("resolves rotation defaults", () => {
    const paseoHome = path.join(path.sep, "tmp", "paseo-home");
    const logFile = resolveSupervisorLogFile(paseoHome, {}, {});

    expect(logFile).toEqual({
      path: path.join(paseoHome, "daemon.log"),
      rotate: { maxSize: "10m", maxFiles: 3 },
    });
  });

  test("lets persisted rotation override env rotation defaults", () => {
    const paseoHome = path.join(path.sep, "tmp", "paseo-home");
    const logFile = resolveSupervisorLogFile(
      paseoHome,
      {
        log: {
          file: {
            path: "logs/daemon.log",
            rotate: { maxSize: "25m", maxFiles: 4 },
          },
        },
      },
      {
        PASEO_LOG_ROTATE_SIZE: "200m",
        PASEO_LOG_ROTATE_COUNT: "12",
      },
    );

    expect(logFile).toEqual({
      path: path.resolve(paseoHome, "logs", "daemon.log"),
      rotate: { maxSize: "25m", maxFiles: 4 },
    });
  });

  test("uses env rotation when persisted rotation is absent", () => {
    const paseoHome = path.join(path.sep, "tmp", "paseo-home");
    const logFile = resolveSupervisorLogFile(
      paseoHome,
      {},
      {
        PASEO_LOG_ROTATE_SIZE: "50m",
        PASEO_LOG_ROTATE_COUNT: "8",
      },
    );

    expect(logFile).toEqual({
      path: path.join(paseoHome, "daemon.log"),
      rotate: { maxSize: "50m", maxFiles: 8 },
    });
  });

  test("writes supervised worker stdout and stderr to daemon.log", async () => {
    const result = await runSupervisorFixture({
      workerSource: `
        process.stdout.write('{"level":30,"msg":"worker-json-stdout"}\\n');
        process.stderr.write('{"level":50,"msg":"worker-json-stderr"}\\n');
        process.exit(0);
      `,
    });

    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.log).toContain('"worker-json-stdout"');
    expect(result.log).toContain('"worker-json-stderr"');
    expect(result.stdout).toContain('"worker-json-stdout"');
    expect(result.stderr).toContain('"worker-json-stderr"');
  });

  test("preserves raw non-JSON stdout and stderr lines", async () => {
    const result = await runSupervisorFixture({
      workerSource: `
        process.stdout.write('raw stdout line\\n');
        process.stderr.write('raw stderr line\\n');
        process.exit(0);
      `,
    });

    expect(result.log).toContain("raw stdout line\n");
    expect(result.log).toContain("raw stderr line\n");
  });

  test("continues supervising when the durable log stream fails", async () => {
    const logFailureMarker = "Durable log stream failed; continuing without file logging";
    const supervisorRun = await runSupervisorFixture({
      logPathIsDirectory: true,
      releaseWorkerAfterStderr: logFailureMarker,
      workerSource: `
        process.on("disconnect", () => process.exit(90));
        process.stdin.setEncoding("utf8");
        process.stdin.once("data", () => {
          process.stdout.write("worker stdout after log failure\\n");
          process.stderr.write("worker stderr after log failure\\n");
          process.send?.({ type: "paseo:shutdown", reason: "log_failure_test_complete" });
        });
        process.stdin.resume();
        setInterval(() => {}, 1000);
      `,
    });

    expect(supervisorRun.code).toBe(0);
    expect(supervisorRun.signal).toBeNull();
    expect(supervisorRun.stdout).toContain("worker stdout after log failure");
    expect(supervisorRun.stderr).toContain("worker stderr after log failure");
    expect(supervisorRun.stderr).toContain(logFailureMarker);
  });

  test("reaps registered worker descendants before returning", async () => {
    const supervisorRun = await runSupervisorFixture({
      workerSource: `
        import { appendFileSync } from "node:fs";
        import { spawn } from "node:child_process";

        const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        descendant.unref();
        const registryPath = process.env[${JSON.stringify(FIXTURE_PROCESS_REGISTRY_ENV)}];
        if (!registryPath) {
          throw new Error("fixture process registry is unavailable");
        }
        appendFileSync(registryPath, descendant.pid + "\\n");
        process.stdout.write("fixture-descendant-pid:" + descendant.pid + "\\n");
        process.send?.({ type: "paseo:shutdown", reason: "descendant_cleanup_complete" });
        setInterval(() => {}, 1000);
      `,
    });

    const descendantProcessId = readDescendantProcessId(supervisorRun.stdout);
    try {
      expect(supervisorRun.code).toBe(0);
      expect(supervisorRun.signal).toBeNull();
      expect(isFixtureProcessRunning(descendantProcessId)).toBe(false);
    } finally {
      forceKillFixtureProcess(descendantProcessId);
    }
  });

  test("logs the worker shutdown reason before signaling the worker", async () => {
    const result = await runSupervisorFixture({
      workerSource: `
        process.send?.({ type: "paseo:shutdown", reason: "client_shutdown_rpc" });
        setInterval(() => {}, 1000);
      `,
    });

    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.log).toContain('"msg":"Worker requested shutdown"');
    expect(result.log).toContain('"reason":"client_shutdown_rpc"');
    expect(result.log).toContain('"msg":"Supervisor sending signal to worker"');
    expect(result.log).toContain('"signal":"SIGTERM"');
    expect(result.log).toContain('"workerPid":');
  });

  test("does not restart a worker based on heartbeat absence", async () => {
    const result = await runSupervisorFixture({
      timeoutMs: 20_000,
      workerSource: `
        import { existsSync, writeFileSync } from "node:fs";

        const marker = process.argv[1] + ".started";
        if (!existsSync(marker)) {
          writeFileSync(marker, "started");
          setTimeout(() => {
            process.send?.({ type: "paseo:shutdown", reason: "silent_worker_test_complete" });
          }, 16_000);
          setInterval(() => {}, 1_000);
        } else {
          process.send?.({ type: "paseo:shutdown", reason: "unexpected_silent_worker_restart" });
          setInterval(() => {}, 1_000);
        }
      `,
    });

    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.log).toContain('"reason":"silent_worker_test_complete"');
    expect(result.log).not.toContain('"reason":"unexpected_silent_worker_restart"');
    expect(result.log).not.toContain('"msg":"Worker heartbeat timed out; restarting worker"');
  }, 25_000);

  test.skipIf(isPlatform("win32"))(
    "forces shutdown when a worker ignores SIGTERM",
    async () => {
      const result = await runSupervisorFixture({
        timeoutMs: 15_000,
        workerSource: `
          process.on("SIGTERM", () => {});
          process.send?.({ type: "paseo:shutdown", reason: "stalled_worker_shutdown" });
          setInterval(() => {}, 1_000);
        `,
      });

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.log).toContain('"reason":"stalled_worker_shutdown"');
      expect(result.log).toContain('"msg":"Worker did not exit after SIGTERM; forcing SIGKILL"');
      expect(result.log).toContain('"signal":"SIGKILL"');
    },
    20_000,
  );

  test.skipIf(isPlatform("win32"))(
    "restarts after worker exit while a descendant retains the worker stdio",
    async () => {
      const supervisorRun = await runSupervisorFixture({
        timeoutMs: 7_000,
        workerSource: `
          import { spawn } from "node:child_process";
          import { appendFileSync, existsSync, writeFileSync } from "node:fs";

          const marker = process.argv[1] + ".started";
          if (!existsSync(marker)) {
            writeFileSync(marker, "started");
            const descendant = spawn(
              process.execPath,
              ["-e", "setInterval(() => {}, 1000)"],
              { stdio: ["ignore", "inherit", "inherit"] },
            );
            descendant.unref();
            const registryPath = process.env[${JSON.stringify(FIXTURE_PROCESS_REGISTRY_ENV)}];
            if (!registryPath) {
              throw new Error("fixture process registry is unavailable");
            }
            appendFileSync(registryPath, descendant.pid + "\\n");
            process.stdout.write("fixture-descendant-pid:" + descendant.pid + "\\n");
            process.on("SIGTERM", () => process.exit(0));
            process.send?.({ type: "paseo:restart", reason: "stdio_descendant" });
            setInterval(() => {}, 1000);
          } else {
            process.send?.({ type: "paseo:shutdown", reason: "stdio_restart_complete" });
            setInterval(() => {}, 1000);
          }
        `,
      });

      const descendantProcessId = readDescendantProcessId(supervisorRun.stdout);
      try {
        expect(supervisorRun.code).toBe(0);
        expect(supervisorRun.signal).toBeNull();
        expect(supervisorRun.elapsedMs).toBeLessThan(2_500);
        expect(supervisorRun.log).toContain('"reason":"stdio_descendant"');
        expect(supervisorRun.log).toContain("Restarting worker");
        expect(isFixtureProcessRunning(descendantProcessId)).toBe(false);
      } finally {
        forceKillFixtureProcess(descendantProcessId);
      }
    },
    7_000,
  );

  // POSIX-only: Windows reports the worker self-kill as an exit code, not SIGKILL.
  test.skipIf(isPlatform("win32"))(
    "logs worker signal exits even when the worker cannot log",
    async () => {
      const result = await runSupervisorFixture({
        workerSource: `
        process.kill(process.pid, "SIGKILL");
      `,
      });

      expect(result.code).toBe(1);
      expect(result.signal).toBeNull();
      expect(result.log).toContain('"msg":"Worker exited"');
      expect(result.log).toContain('"signal":"SIGKILL"');
      expect(result.log).toContain("Supervisor exiting");
    },
  );
});
