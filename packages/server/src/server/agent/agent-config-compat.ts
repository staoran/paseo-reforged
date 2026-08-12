import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";

import type { CreateAgentWorktreeTarget } from "@getpaseo/protocol/messages";
import type {
  AgentSessionConfig,
  JsonValue,
  McpServerConfig,
  McpToolRef,
  ProviderOptions,
  ToolPolicy,
} from "@getpaseo/protocol/agent-types";

import { ToolPolicyUnsupportedError } from "./provider-options.js";

export type LegacyProviderFamily = "codex" | "claude";

/**
 * The small provider boundary used by the compatibility module. Provider
 * registries adapt their concrete definitions to this shape so legacy
 * migration stays independent of provider clients and filesystem effects.
 */
export interface AgentConfigCompatibilityProvider {
  provider: string;
  legacyFamily?: LegacyProviderFamily;
  validateOptions: (options: ProviderOptions | undefined) => ProviderOptions | undefined;
  applyToolPolicy?: (
    config: AgentSessionConfig,
    toolPolicy: ToolPolicy | undefined,
  ) => AgentSessionConfig;
}

export interface ResolvedAgentSessionConfig extends AgentSessionConfig {
  /** Runtime-only options after legacy/canonical normalization. */
  resolvedProviderOptions?: ProviderOptions;
}

export class LegacyAgentConfigError extends Error {
  constructor(
    readonly code:
      | "legacy_agent_config_conflict"
      | "legacy_agent_config_ambiguous"
      | "legacy_agent_config_unsupported"
      | "legacy_agent_config_invalid",
    readonly provider: string,
    message: string,
    readonly path?: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "LegacyAgentConfigError";
  }
}

export interface HubExecutionContract {
  protocolVersion: 1;
  executionFingerprint: string;
  policyFingerprint: string;
  applicationState: "prepared" | "applied";
}

export class HubExecutionContractError extends Error {
  constructor(
    readonly code:
      | "hub_execution_contract_incomplete"
      | "hub_execution_contract_invalid"
      | "execution_contract_mismatch",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "HubExecutionContractError";
  }
}

export interface HubExecutionCreatePreflightInput extends AgentSessionConfig {
  executionId: string;
  prompt: string;
  env?: Record<string, string>;
  worktree?: CreateAgentWorktreeTarget;
  workspaceId?: string;
}

export interface HubExecutionRequestIntent {
  provider: string;
  cwd: string;
  prompt: string;
  promptHash: string;
  workspaceId?: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  env?: Record<string, string>;
  mcpServers?: Record<string, McpServerConfig>;
  worktree?: CreateAgentWorktreeTarget;
  policyFingerprint: string;
}

export interface PreparedHubExecutionCreate {
  protocolVersion: 1;
  executionId: string;
  request: HubExecutionRequestIntent;
  config: ResolvedAgentSessionConfig;
  executionFingerprint: string;
  policyFingerprint: string;
  hubExecutionContract: HubExecutionContract;
}

export interface HubResolvedProviderCreateConfig {
  modeId?: string;
  featureValues?: Record<string, unknown>;
  providerOptions?: ProviderOptions;
  toolPolicy?: ToolPolicy;
}

export interface HubExecutionResolvedTarget {
  cwd: string;
  workspaceId: string;
  resolveCreateConfig: (input: {
    cwd: string;
    provider: string;
    requestedMode?: string;
    featureValues?: Record<string, unknown>;
    unattended: true;
  }) => Promise<HubResolvedProviderCreateConfig> | HubResolvedProviderCreateConfig;
}

export interface ResolvedHubExecutionCreate {
  protocolVersion: 1;
  executionId: string;
  request: HubExecutionRequestIntent;
  config: ResolvedAgentSessionConfig;
  workspaceId: string;
  prompt: string;
  executionFingerprint: string;
  policyFingerprint: string;
  hubExecutionContract: HubExecutionContract;
}

/**
 * Resolve legacy beta.5 fields and canonical provider options at one public
 * runtime boundary. This function performs no workspace, worktree, Agent, or
 * Provider-session work.
 */
export async function resolveCompatibleAgentConfig(
  config: AgentSessionConfig,
  provider: AgentConfigCompatibilityProvider,
): Promise<ResolvedAgentSessionConfig> {
  const canonical = provider.validateOptions(config.providerOptions);
  const legacy = buildLegacyProviderOptions(config, provider);
  const merged = mergeProviderOptions(canonical, legacy, provider.provider);

  let resolved: ResolvedAgentSessionConfig = {
    ...config,
    ...(merged === undefined ? {} : { resolvedProviderOptions: merged }),
  };

  if (resolved.toolPolicy) {
    validateToolPolicyServers(resolved.toolPolicy, resolved.mcpServers, provider.provider);
    if (!provider.applyToolPolicy) {
      throw new ToolPolicyUnsupportedError(provider.provider);
    }
    resolved = {
      ...provider.applyToolPolicy(resolved, resolved.toolPolicy),
      ...(merged === undefined ? {} : { resolvedProviderOptions: merged }),
    };
  }

  return resolved;
}

/**
 * Perform the side-effect-free Hub Stage 1 request/policy preparation. The
 * returned request is a detached snapshot; callers must not consult raw input
 * after this function succeeds.
 */
export async function resolveHubExecutionCreatePreflight(
  input: HubExecutionCreatePreflightInput,
  provider: AgentConfigCompatibilityProvider,
): Promise<PreparedHubExecutionCreate> {
  if (provider.provider !== input.provider) {
    throw new Error(`Provider contract '${provider.provider}' does not match '${input.provider}'`);
  }
  if (!isAbsolute(input.cwd)) {
    throw new Error("Hub agent cwd must be absolute");
  }

  const cwd = normalize(input.cwd);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Hub agent prompt cannot be blank");

  const config = await resolveCompatibleAgentConfig(
    {
      provider: input.provider,
      cwd,
      modeId: normalizeOptionalString(input.modeId),
      model: normalizeOptionalString(input.model),
      thinkingOptionId: normalizeOptionalString(input.thinkingOptionId),
      featureValues: cloneJsonRecord(input.featureValues),
      providerOptions: cloneJsonRecord(input.providerOptions),
      toolPolicy: cloneToolPolicy(input.toolPolicy),
      mcpServers: cloneMcpServers(input.mcpServers),
      approvalPolicy: input.approvalPolicy,
      sandboxMode: input.sandboxMode,
      networkAccess: input.networkAccess,
      webSearch: input.webSearch,
      extra: cloneLegacyExtra(input.extra),
    },
    provider,
  );

  const requestBase: HubExecutionRequestIntent = {
    provider: input.provider,
    cwd,
    prompt,
    promptHash: createHash("sha256").update(prompt, "utf8").digest("hex"),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(config.model ? { model: config.model } : {}),
    ...(config.modeId ? { modeId: config.modeId } : {}),
    ...(config.thinkingOptionId ? { thinkingOptionId: config.thinkingOptionId } : {}),
    ...(config.featureValues ? { featureValues: cloneJsonRecord(config.featureValues) } : {}),
    ...(input.env ? { env: cloneStringRecord(input.env) } : {}),
    ...(config.mcpServers ? { mcpServers: cloneMcpServers(config.mcpServers) } : {}),
    ...(input.worktree
      ? { worktree: cloneJsonRecord(input.worktree) as CreateAgentWorktreeTarget }
      : {}),
    policyFingerprint: "",
  };

  const policyFingerprint = hashCanonicalJson({
    provider: input.provider,
    model: requestBase.model,
    providerOptions: config.resolvedProviderOptions ?? {},
    toolPolicy: sortToolPolicy(config.toolPolicy),
    mcpServers: referencedMcpServers(config.toolPolicy, config.mcpServers),
  });
  const request = { ...requestBase, policyFingerprint };
  const executionFingerprint = hashCanonicalJson({
    ...request,
    // The fingerprint intentionally excludes the literal request type and
    // requestId; those are transport metadata, not execution intent.
  });

  return {
    protocolVersion: 1,
    executionId: input.executionId,
    request,
    config,
    executionFingerprint,
    policyFingerprint,
    hubExecutionContract: {
      protocolVersion: 1,
      executionFingerprint,
      policyFingerprint,
      applicationState: "prepared",
    },
  };
}

/**
 * Resolve cwd-dependent mode/feature values after workspace/worktree creation.
 * Only the detached prepared shape and the resolved target are accepted.
 */
export async function finalizeHubExecutionCreate(
  prepared: PreparedHubExecutionCreate,
  target: HubExecutionResolvedTarget,
): Promise<ResolvedHubExecutionCreate> {
  if (!isAbsolute(target.cwd)) throw new Error("Hub resolved cwd must be absolute");
  if (!target.workspaceId) throw new Error("Hub execution requires a workspaceId");

  const resolved = await target.resolveCreateConfig({
    cwd: target.cwd,
    provider: prepared.config.provider,
    requestedMode: prepared.request.modeId,
    featureValues: prepared.request.featureValues,
    unattended: true,
  });

  if (
    resolved.providerOptions !== undefined &&
    !deepEqual(resolved.providerOptions, prepared.config.resolvedProviderOptions ?? {})
  ) {
    throw new Error("Hub runtime finalize would cause policy expansion");
  }
  if (
    resolved.toolPolicy !== undefined &&
    !deepEqual(resolved.toolPolicy, prepared.config.toolPolicy)
  ) {
    throw new Error("Hub runtime finalize would cause tool policy expansion");
  }

  const config: ResolvedAgentSessionConfig = {
    ...prepared.config,
    cwd: normalize(target.cwd),
    ...(resolved.modeId === undefined ? {} : { modeId: resolved.modeId }),
    ...(resolved.featureValues === undefined
      ? {}
      : { featureValues: cloneJsonRecord(resolved.featureValues) }),
  };

  return {
    protocolVersion: 1,
    executionId: prepared.executionId,
    request: prepared.request,
    config,
    workspaceId: target.workspaceId,
    prompt: prepared.request.prompt,
    executionFingerprint: prepared.executionFingerprint,
    policyFingerprint: prepared.policyFingerprint,
    hubExecutionContract: prepared.hubExecutionContract,
  };
}

function buildLegacyProviderOptions(
  config: AgentSessionConfig,
  provider: AgentConfigCompatibilityProvider,
): ProviderOptions | undefined {
  const hasLegacyFields =
    config.approvalPolicy !== undefined ||
    config.sandboxMode !== undefined ||
    config.networkAccess !== undefined ||
    config.webSearch !== undefined ||
    config.extra !== undefined;
  if (!hasLegacyFields) return undefined;

  if (!provider.legacyFamily) {
    throw new LegacyAgentConfigError(
      "legacy_agent_config_unsupported",
      provider.provider,
      "legacy fields have no proven provider mapping",
    );
  }

  if (provider.legacyFamily === "claude") {
    const legacy = cloneJsonRecord(config.extra?.claude);
    validateLegacyClaudeEnv(legacy, provider.provider);
    return legacy;
  }

  const explicit: ProviderOptions = {};
  if (config.approvalPolicy !== undefined) explicit.approval_policy = config.approvalPolicy;
  if (config.sandboxMode !== undefined) explicit.sandbox_mode = config.sandboxMode;
  if (config.networkAccess !== undefined) {
    explicit.sandbox_workspace_write = { network_access: config.networkAccess };
  }

  const extra = cloneJsonRecord(config.extra?.codex);
  const canonical = cloneJsonRecord(config.providerOptions);
  const hasExplicitWebSearch =
    getPath(canonical, ["web_search"]) !== undefined ||
    getPath(extra, ["web_search"]) !== undefined;
  if (config.webSearch === true && !hasExplicitWebSearch) {
    throw new LegacyAgentConfigError(
      "legacy_agent_config_ambiguous",
      provider.provider,
      "webSearch=true has no unambiguous Codex web_search mapping",
      "webSearch",
    );
  }
  if (config.webSearch === false) explicit.web_search = "disabled";

  // Validate only the explicitly mapped native fields. Historical `extra`
  // remains a deliberately wider JSON surface and is passed through below.
  if (Object.keys(explicit).length > 0) {
    provider.validateOptions(explicit);
  }
  return mergeProviderOptions(extra, explicit, provider.provider);
}

function validateLegacyClaudeEnv(options: ProviderOptions | undefined, provider: string): void {
  const env = options?.env;
  if (env === undefined) return;
  if (!isPlainObject(env)) {
    throw new LegacyAgentConfigError(
      "legacy_agent_config_invalid",
      provider,
      "extra.claude.env must be an object of string values",
      "extra.claude.env",
    );
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      throw new LegacyAgentConfigError(
        "legacy_agent_config_invalid",
        provider,
        `extra.claude.env.${key} must be a string`,
        `extra.claude.env.${key}`,
      );
    }
  }
}

function mergeProviderOptions(
  canonical: ProviderOptions | undefined,
  legacy: ProviderOptions | undefined,
  provider: string,
): ProviderOptions | undefined {
  if (canonical === undefined && legacy === undefined) return undefined;
  if (canonical === undefined) return cloneJsonRecord(legacy);
  if (legacy === undefined) return cloneJsonRecord(canonical);
  return mergeJsonObjects(canonical, legacy, provider, []);
}

function mergeJsonObjects(
  canonical: ProviderOptions,
  legacy: ProviderOptions,
  provider: string,
  path: string[],
): ProviderOptions {
  const result: ProviderOptions = cloneJsonRecord(canonical) ?? {};
  for (const [key, legacyValue] of Object.entries(legacy)) {
    const nextPath = [...path, key];
    const canonicalValue = result[key];
    if (canonicalValue === undefined) {
      result[key] = cloneJsonValue(legacyValue, provider, nextPath);
      continue;
    }
    if (isPlainObject(canonicalValue) && isPlainObject(legacyValue)) {
      result[key] = mergeJsonObjects(canonicalValue, legacyValue, provider, nextPath);
      continue;
    }
    if (!deepEqual(canonicalValue, legacyValue)) {
      throw new LegacyAgentConfigError(
        "legacy_agent_config_conflict",
        provider,
        `canonical and legacy values differ at ${nextPath.join(".")}`,
        nextPath.join("."),
      );
    }
  }
  return result;
}

function validateToolPolicyServers(
  policy: ToolPolicy,
  servers: Record<string, McpServerConfig> | undefined,
  provider: string,
): void {
  const names = new Set(Object.keys(servers ?? {}));
  for (const grant of policy.preapproved) {
    if (!names.has(grant.server)) {
      throw new LegacyAgentConfigError(
        "legacy_agent_config_invalid",
        provider,
        `toolPolicy grant '${grant.server}.${grant.tool}' requires an MCP server in the same request`,
        `toolPolicy.preapproved.${grant.server}.${grant.tool}`,
      );
    }
  }
}

function referencedMcpServers(
  policy: ToolPolicy | undefined,
  servers: Record<string, McpServerConfig> | undefined,
): Record<string, McpServerConfig> {
  if (!policy || !servers) return {};
  const names = new Set(policy.preapproved.map((grant) => grant.server));
  return Object.fromEntries(Object.entries(servers).filter(([name]) => names.has(name))) as Record<
    string,
    McpServerConfig
  >;
}

function sortToolPolicy(policy: ToolPolicy | undefined): ToolPolicy | undefined {
  if (!policy) return undefined;
  return {
    preapproved: [...policy.preapproved]
      .sort(compareToolRefs)
      .map(({ kind, server, tool }) => ({ kind, server, tool })),
  };
}

function compareToolRefs(a: McpToolRef, b: McpToolRef): number {
  return `${a.kind}\0${a.server}\0${a.tool}`.localeCompare(`${b.kind}\0${b.server}\0${b.tool}`);
}

function hashCanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .flatMap((key) => {
          const entry = (value as Record<string, unknown>)[key];
          return entry === undefined ? [] : [[key, canonicalize(entry)]];
        }),
    );
  }
  return value;
}

function cloneJsonRecord(value: unknown): ProviderOptions | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new LegacyAgentConfigError(
      "legacy_agent_config_invalid",
      "unknown",
      "provider configuration must be a JSON object",
    );
  }
  return cloneJsonValue(value, "unknown", []) as ProviderOptions;
}

function cloneLegacyExtra(value: AgentSessionConfig["extra"]): AgentSessionConfig["extra"] {
  if (value === undefined) return undefined;
  return {
    ...(value.codex === undefined ? {} : { codex: cloneJsonRecord(value.codex) }),
    ...(value.claude === undefined ? {} : { claude: cloneJsonRecord(value.claude) }),
  };
}

function cloneMcpServers(
  value: Record<string, McpServerConfig> | undefined,
): Record<string, McpServerConfig> | undefined {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function cloneStringRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]));
}

function cloneToolPolicy(value: ToolPolicy | undefined): ToolPolicy | undefined {
  return value ? { preapproved: value.preapproved.map((grant) => ({ ...grant })) } : undefined;
}

function cloneJsonValue(value: unknown, provider: string, path: string[]): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value))
    return value.map((entry, index) => cloneJsonValue(entry, provider, [...path, String(index)]));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        entry === undefined ? [] : [[key, cloneJsonValue(entry, provider, [...path, key])]],
      ),
    );
  }
  throw new LegacyAgentConfigError(
    "legacy_agent_config_invalid",
    provider,
    `non-JSON value at ${path.join(".") || "provider configuration"}`,
    path.join("."),
  );
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getPath(value: ProviderOptions | undefined, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isPlainObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}
