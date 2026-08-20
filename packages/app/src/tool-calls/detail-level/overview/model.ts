import { isPaseoToolName } from "@getpaseo/protocol/tool-name-normalization";
import type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
import { describeToolCall, type ToolCallRun } from "../grouping";

const DIRECT_PASEO_TOOL_PREFIX = "paseo_";
const DIRECT_SEARCH_TOOL_SUFFIX_PATTERN = /(?:^|[_.:/])(?:web_search|llm_context)$/;
const RTK_EXECUTABLES = new Set(["rtk", "rtk.exe"]);
const RTK_PASSTHROUGH_SUBCOMMANDS = new Set(["proxy", "run"]);
const READ_COMMANDS = new Set(["cat", "get-content", "read"]);
const SEARCH_COMMANDS = new Set(["find", "findstr", "grep", "rg", "select-string"]);

export interface OverviewSummary {
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  paseoCallCount: number;
}

export type ToolCallGroupKind = "command" | "edit" | "other" | "paseo" | "read" | "search";

export interface OverviewToolCallGroup {
  mode: ToolCallDetailLevel;
  kind: ToolCallGroupKind;
  run: ToolCallRun;
  summary: OverviewSummary;
  isLoading: boolean;
}

export interface OverviewToolCallSequence {
  mode: ToolCallDetailLevel;
  run: ToolCallRun;
  groups: readonly OverviewToolCallGroup[];
  summary: OverviewSummary;
  isLoading: boolean;
}

function isPaseoCall(name: string, normalizedName: string): boolean {
  return isPaseoToolName(name) || normalizedName.startsWith(DIRECT_PASEO_TOOL_PREFIX);
}

function isSearchCall(name: string): boolean {
  return DIRECT_SEARCH_TOOL_SUFFIX_PATTERN.test(name);
}

/** Returns the executable basename without interpreting nested command strings. */
function getExecutableName(token: string | undefined): string {
  if (!token) return "";
  const pathParts = token.split(/[\\/]/);
  return (pathParts.at(-1) ?? token).toLowerCase();
}

/** Reads only the leading command tokens, preserving quoted scripts as one opaque token. */
function tokenizeCommandPrefix(command: string, limit = 4): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < command.length && tokens.length < limit) {
    while (/\s/.test(command[index] ?? "")) index += 1;
    if (index >= command.length) break;

    const quote = command[index] === '"' || command[index] === "'" ? command[index] : null;
    if (quote) index += 1;
    const start = index;
    if (quote) {
      while (index < command.length && command[index] !== quote) index += 1;
    } else {
      while (index < command.length && !/\s/.test(command[index] ?? "")) index += 1;
    }
    tokens.push(command.slice(start, index));
    if (quote && command[index] === quote) index += 1;
  }
  return tokens;
}

/** Maps a directly executed command to one of the semantic grouping categories. */
function classifyDirectCommand(command: string): ToolCallGroupKind {
  if (READ_COMMANDS.has(command)) return "read";
  if (SEARCH_COMMANDS.has(command)) return "search";
  return "command";
}

/** Classifies a shell command after removing an exact leading RTK wrapper. */
function classifyShellCommand(command: string): ToolCallGroupKind {
  const tokens = tokenizeCommandPrefix(command);
  let commandIndex = 0;
  const executable = getExecutableName(tokens[commandIndex]);
  if (!RTK_EXECUTABLES.has(executable)) {
    return classifyDirectCommand(executable);
  }

  commandIndex += 1;
  while (tokens[commandIndex]?.startsWith("-")) commandIndex += 1;
  const rtkSubcommand = getExecutableName(tokens[commandIndex]);
  if (RTK_PASSTHROUGH_SUBCOMMANDS.has(rtkSubcommand)) {
    commandIndex += 1;
  }
  return classifyDirectCommand(getExecutableName(tokens[commandIndex]));
}

/** Returns the semantic category that controls adjacent tool-call grouping. */
export function getToolCallGroupKind(call: ToolCallRun["calls"][number]): ToolCallGroupKind {
  const descriptor = describeToolCall(call);
  const normalizedName = descriptor.name.trim().toLowerCase();
  if (isPaseoCall(descriptor.name, normalizedName)) return "paseo";
  if (descriptor.detail.type === "edit" || descriptor.detail.type === "write") return "edit";
  if (descriptor.detail.type === "shell") return classifyShellCommand(descriptor.detail.command);
  if (descriptor.detail.type === "read") return "read";
  if (descriptor.detail.type === "search" || isSearchCall(normalizedName)) return "search";
  return "other";
}

/** Builds one semantic group model for either detail display mode. */
export function buildOverviewGroup(
  run: ToolCallRun,
  mode: ToolCallDetailLevel = "overview",
): OverviewToolCallGroup {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let isLoading = false;
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  let paseoCallCount = 0;

  for (const call of run.calls) {
    const descriptor = describeToolCall(call);
    isLoading ||= descriptor.status === "running" || descriptor.status === "executing";
    switch (getToolCallGroupKind(call)) {
      case "paseo":
        paseoCallCount += 1;
        break;
      case "edit":
        editedFiles.add(
          descriptor.detail.type === "edit" || descriptor.detail.type === "write"
            ? descriptor.detail.filePath
            : call.id,
        );
        break;
      case "command":
        commandCount += 1;
        break;
      case "read":
        readFiles.add(descriptor.detail.type === "read" ? descriptor.detail.filePath : call.id);
        break;
      case "search":
        searchCount += 1;
        break;
      case "other":
        otherToolCount += 1;
        break;
    }
  }

  const summary = {
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    paseoCallCount,
  };
  return {
    mode,
    kind: getToolCallGroupKind(run.calls[0]),
    run,
    isLoading,
    summary,
  };
}

/** Creates a category run while keeping only the live trailing category open for updates. */
function createCategoryRun(
  calls: readonly ToolCallRun["calls"][number][],
  isSealed: boolean,
): ToolCallRun {
  const first = calls[0];
  const latest = calls.at(-1);
  if (!first || !latest) {
    throw new Error("Cannot build an empty tool call category group");
  }
  return { id: first.id, calls, latest, isSealed };
}

/** Splits a continuous tool sequence into adjacent semantic category groups. */
function buildCategoryGroups(run: ToolCallRun, mode: ToolCallDetailLevel): OverviewToolCallGroup[] {
  const categoryRuns: Array<Array<ToolCallRun["calls"][number]>> = [];
  let pendingCalls: Array<ToolCallRun["calls"][number]> = [];
  let pendingKind: ToolCallGroupKind | null = null;

  for (const call of run.calls) {
    const kind = getToolCallGroupKind(call);
    if (pendingCalls.length > 0 && pendingKind !== kind) {
      categoryRuns.push(pendingCalls);
      pendingCalls = [];
    }
    pendingKind = kind;
    pendingCalls.push(call);
  }
  if (pendingCalls.length > 0) {
    categoryRuns.push(pendingCalls);
  }

  return categoryRuns.map((calls, index) =>
    buildOverviewGroup(
      createCategoryRun(calls, run.isSealed || index < categoryRuns.length - 1),
      mode,
    ),
  );
}

/** Builds one top-level sequence while retaining its ordered category groups. */
export function buildOverviewSequence(
  run: ToolCallRun,
  mode: ToolCallDetailLevel = "overview",
): OverviewToolCallSequence {
  const aggregate = buildOverviewGroup(run, mode);
  return {
    mode,
    run,
    groups: buildCategoryGroups(run, mode),
    summary: aggregate.summary,
    isLoading: aggregate.isLoading,
  };
}
