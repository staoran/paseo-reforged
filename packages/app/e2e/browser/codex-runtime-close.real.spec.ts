import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { cleanupRewindFlow, launchAgent, type AgentHandle } from "../support/helpers/rewind-flow";
import type { SeedDaemonClient } from "../support/helpers/seed-client";

interface RuntimeClient extends SeedDaemonClient {
  closeIdleAgentRuntime(agentId: string): Promise<"closed" | "already_closed">;
}

/** Returns Windows Codex app-server process IDs, excluding the PowerShell probe itself */
function codexAppServerPids(): Set<number> {
  const script =
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -notmatch 'powershell|pwsh' -and $_.CommandLine -match 'codex' -and $_.CommandLine -match 'app-server' } | ForEach-Object ProcessId) | ConvertTo-Json -Compress";
  const output = execFileSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
  }).trim();
  const parsed: unknown = output ? JSON.parse(output) : [];
  return new Set(
    (Array.isArray(parsed) ? parsed : [parsed]).filter((pid): pid is number =>
      Number.isInteger(pid),
    ),
  );
}

test("closing an idle Codex runtime releases its app-server process and keeps its record", async ({
  page,
}, testInfo) => {
  test.skip(process.platform !== "win32", "Windows process observation is required");
  testInfo.setTimeout(120_000);
  const before = codexAppServerPids();
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "paseo-codex-runtime-close-")));
  let handle: AgentHandle | undefined;
  try {
    handle = await launchAgent({ page, provider: "codex", cwd, mode: "full-access" });
    const activePids = [...codexAppServerPids()].filter((pid) => !before.has(pid));
    expect(activePids.length).toBeGreaterThan(0);
    const client = handle.client as RuntimeClient;
    await testInfo.attach("codex-idle-before-close", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect(await client.closeIdleAgentRuntime(handle.agentId)).toBe("closed");
    await expect
      .poll(() => [...codexAppServerPids()].filter((pid) => activePids.includes(pid)))
      .toEqual([]);
    await expect
      .poll(async () => {
        const agents = await client.fetchAgents({ scope: "active" });
        return agents.entries.find((entry) => entry.agent.id === handle?.agentId)?.agent.status;
      })
      .toBe("closed");
  } finally {
    await cleanupRewindFlow({ handle, cwd });
  }
});
