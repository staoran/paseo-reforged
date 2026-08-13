import type {
  AgentSnapshotPayload,
  AgentStreamEventPayload,
  CreateAgentWorktreeTarget,
  HubExecutionControlAction,
} from "@getpaseo/protocol/messages";
import type { ProviderOptions, ToolPolicy } from "@getpaseo/protocol/agent-types";

import type { AgentManager, AgentManagerEvent, ManagedAgent } from "../agent/agent-manager.js";
import type { McpServerConfig } from "../agent/agent-sdk-types.js";
import type { AgentStorage, StoredAgentRecord } from "../agent/agent-storage.js";
import type { BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import type { CreatePaseoWorktreeWorkflowResult } from "../worktree-session.js";
import { buildStoredAgentPayload } from "../agent/agent-projections.js";
import { serializeAgentSnapshot, serializeAgentStreamEvent } from "../messages.js";
import { daemonExecutionKey, type DaemonAgentOwner } from "../agent/agent-owner.js";
import {
  HubExecutionContractError,
  resolveHubExecutionCreatePreflight,
  type PreparedHubExecutionCreate,
} from "../agent/agent-config-compat.js";
import { classifyStoredHubExecutionContract } from "../agent/agent-storage.js";

export interface HubExecutionAgentCreateInput {
  executionId: string;
  provider: string;
  cwd: string;
  prompt: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  providerOptions?: ProviderOptions;
  toolPolicy?: ToolPolicy;
  env?: Record<string, string>;
  mcpServers?: Record<string, McpServerConfig>;
  worktree?: CreateAgentWorktreeTarget;
}

export interface HubExecutionControlInput {
  requestId: string;
  executionId: string;
  action: HubExecutionControlAction;
}

export interface OwnedAgentSnapshot {
  executionId: string;
  agent: AgentSnapshotPayload;
  toolPolicyApplied?: true;
}

export type OwnedAgentEvent =
  | { type: "update"; executionId: string; agent: AgentSnapshotPayload }
  | {
      type: "stream";
      executionId: string;
      agentId: string;
      event: AgentStreamEventPayload;
    };

interface PendingExecutionCreate {
  prepared: Promise<PreparedHubExecutionCreate>;
  result: Promise<OwnedAgentSnapshot>;
}

interface DaemonExecutionsOptions {
  daemonId: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  createAgent: BoundCreateAgentCommand;
  interruptAgent: (agentId: string) => Promise<unknown>;
  archiveWorkspace: (workspaceId: string, requestId: string) => Promise<unknown>;
  cleanupFailedCreate?: (input: {
    createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
    createdAgentId: string | null;
  }) => Promise<void>;
}

export interface HubExecutionAgents {
  create(input: HubExecutionAgentCreateInput): Promise<OwnedAgentSnapshot>;
  control(input: HubExecutionControlInput): Promise<void>;
  subscribe(listener: (event: OwnedAgentEvent) => void): () => void;
  invalidateAuthority(): Promise<void>;
}

export class DaemonExecutions implements HubExecutionAgents {
  private readonly daemonId: string;
  private readonly agentManager: AgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly createAgentCommand: BoundCreateAgentCommand;
  private readonly pendingCreates = new Map<string, PendingExecutionCreate>();
  private readonly pendingControlActions = new Map<string, Promise<void>>();
  private readonly controlTails = new Map<string, Promise<void>>();
  private authorityGeneration = 0;
  private authorityActive = true;
  private readonly cleanupFailedCreate: NonNullable<DaemonExecutionsOptions["cleanupFailedCreate"]>;

  constructor(private readonly options: DaemonExecutionsOptions) {
    this.daemonId = options.daemonId;
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.createAgentCommand = options.createAgent;
    this.cleanupFailedCreate = options.cleanupFailedCreate ?? (async () => undefined);
  }

  create(input: HubExecutionAgentCreateInput): Promise<OwnedAgentSnapshot> {
    if (!this.authorityActive) {
      return Promise.reject(new Error("Hub relationship authority is no longer active"));
    }
    const owner = this.owner(input.executionId);
    const key = daemonExecutionKey(owner);
    const pending = this.pendingCreates.get(key);
    if (pending) {
      return this.resolvePendingCreate(input, pending, this.authorityGeneration);
    }

    const authorityGeneration = this.authorityGeneration;
    const prepared = this.prepareCreate(input);
    let pendingCreate: PendingExecutionCreate;
    const result = prepared
      .then((preparedInput) =>
        this.createOrResolvePrepared(owner, preparedInput, authorityGeneration),
      )
      .finally(() => {
        if (this.pendingCreates.get(key) === pendingCreate) {
          this.pendingCreates.delete(key);
        }
      });
    pendingCreate = { prepared, result };
    this.pendingCreates.set(key, pendingCreate);
    return result;
  }

  control(input: HubExecutionControlInput): Promise<void> {
    if (!this.authorityActive) {
      return Promise.reject(new Error("Hub relationship authority is no longer active"));
    }
    const owner = this.owner(input.executionId);
    const executionKey = daemonExecutionKey(owner);
    const actionKey = `${executionKey}\0${input.action}`;
    const pending = this.pendingControlActions.get(actionKey);
    if (pending) return pending;

    const previous =
      this.controlTails.get(executionKey) ??
      this.pendingCreates.get(executionKey)?.result.then(() => undefined) ??
      Promise.resolve();
    const authorityGeneration = this.authorityGeneration;
    const control = previous
      .catch(() => undefined)
      .then(() => this.controlOwnedExecution(owner, input, authorityGeneration));
    this.pendingControlActions.set(actionKey, control);
    this.controlTails.set(executionKey, control);
    const release = () => {
      if (this.pendingControlActions.get(actionKey) === control) {
        this.pendingControlActions.delete(actionKey);
      }
      if (this.controlTails.get(executionKey) === control) {
        this.controlTails.delete(executionKey);
      }
    };
    void control.then(release, release);
    return control;
  }

  async invalidateAuthority(): Promise<void> {
    this.authorityActive = false;
    this.authorityGeneration++;
    await Promise.allSettled([
      ...Array.from(this.pendingCreates.values(), (pending) => pending.result),
      ...this.pendingControlActions.values(),
    ]);
  }

  subscribe(listener: (event: OwnedAgentEvent) => void): () => void {
    return this.agentManager.subscribe(
      (event) => {
        const owned = this.projectEvent(event);
        if (owned) {
          listener(owned);
        }
      },
      { replayState: true },
    );
  }

  private async prepareCreate(
    input: HubExecutionAgentCreateInput,
  ): Promise<PreparedHubExecutionCreate> {
    requireHubMcpNamespace(input.mcpServers);
    return resolveHubExecutionCreatePreflight(
      input,
      this.agentManager.getAgentConfigCompatibilityProvider(input.provider),
    );
  }

  private async resolvePendingCreate(
    input: HubExecutionAgentCreateInput,
    pending: PendingExecutionCreate,
    authorityGeneration: number,
  ): Promise<OwnedAgentSnapshot> {
    const [incoming, original] = await Promise.all([this.prepareCreate(input), pending.prepared]);
    requireMatchingPreparedExecutionContract(original, incoming);
    this.requireAuthority(authorityGeneration);
    return pending.result;
  }

  private async createOrResolvePrepared(
    owner: DaemonAgentOwner,
    prepared: PreparedHubExecutionCreate,
    authorityGeneration: number,
  ): Promise<OwnedAgentSnapshot> {
    const existing = await this.agentStorage.findByDaemonExecution(owner);
    if (existing) {
      requireExecutionWorkspaceId(existing);
      this.requireAuthority(authorityGeneration);
      requireMatchingPersistedExecutionContract(existing, prepared);
      return this.resolveRecord(existing, prepared);
    }
    this.requireAuthority(authorityGeneration);

    let createdWorktree: CreatePaseoWorktreeWorkflowResult | null = null;
    let createdAgentId: string | null = null;
    try {
      const result = await this.createAgentCommand({
        kind: "hub",
        prepared,
        owner,
        onWorktreeCreated: (worktree) => {
          createdWorktree = worktree;
        },
        onCreated: (created) => {
          createdAgentId = created.agentId;
        },
      });
      this.requireAuthority(authorityGeneration);
      requireExecutionWorkspaceId(result.liveSnapshot);

      const durableRecord = await this.agentStorage.get(result.liveSnapshot.id);
      if (!durableRecord) {
        throw new HubExecutionContractError(
          "hub_execution_contract_incomplete",
          `Hub execution agent ${result.liveSnapshot.id} has no durable record`,
        );
      }
      requireMatchingPersistedExecutionContract(durableRecord, prepared);
      return {
        executionId: owner.executionId,
        agent: serializeAgentSnapshot(result.liveSnapshot),
        ...durableToolPolicyAcknowledgement(durableRecord, prepared),
      };
    } catch (error) {
      try {
        if (createdAgentId && this.agentManager.getAgent(createdAgentId)) {
          try {
            await this.agentManager.closeAgent(createdAgentId);
          } finally {
            await this.agentManager.deleteAgentState(createdAgentId);
          }
        }
      } finally {
        try {
          await this.cleanupFailedCreate({
            createdWorktree: ownedCreatedWorktree(createdWorktree),
            createdAgentId: null,
          });
        } finally {
          if (createdAgentId) {
            await this.agentStorage.remove(createdAgentId);
          }
        }
      }
      throw error;
    }
  }

  private async controlOwnedExecution(
    owner: DaemonAgentOwner,
    input: HubExecutionControlInput,
    authorityGeneration: number,
  ): Promise<void> {
    this.requireAuthority(authorityGeneration, "execution control");
    const record = await this.agentStorage.findByDaemonExecution(owner);
    this.requireAuthority(authorityGeneration, "execution control");
    if (!record) {
      return;
    }
    this.requireOwner(record);

    if (input.action === "interrupt") {
      if (!record.archivedAt && this.agentManager.getAgent(record.id)) {
        await this.options.interruptAgent(record.id);
      }
      return;
    }

    const workspaceId = requireExecutionWorkspaceId(record);
    this.requireAuthority(authorityGeneration, "execution control");
    await this.options.archiveWorkspace(workspaceId, input.requestId);
  }

  private resolveRecord(
    record: StoredAgentRecord,
    prepared: PreparedHubExecutionCreate,
  ): OwnedAgentSnapshot {
    requireExecutionWorkspaceId(record);
    return { ...this.projectRecord(record), ...durableToolPolicyAcknowledgement(record, prepared) };
  }

  private requireAuthority(authorityGeneration: number, operation = "agent creation"): void {
    if (!this.authorityActive || authorityGeneration !== this.authorityGeneration) {
      throw new Error(`Hub relationship authority ended during ${operation}`);
    }
  }

  private projectRecord(record: StoredAgentRecord): OwnedAgentSnapshot {
    const owner = this.requireOwner(record);
    const live = this.agentManager.getAgent(record.id);
    return {
      executionId: owner.executionId,
      agent: live
        ? serializeAgentSnapshot(live)
        : {
            ...buildStoredAgentPayload(record, this.agentManager.getRegisteredProviderIds()),
            status: "closed",
          },
    };
  }

  private projectEvent(event: AgentManagerEvent): OwnedAgentEvent | null {
    if (event.type === "agent_state") {
      return this.projectAgentState(event.agent);
    }
    if (event.type !== "agent_stream") {
      return null;
    }
    const agent = this.agentManager.getAgent(event.agentId);
    if (!this.isOwned(agent)) {
      return null;
    }
    const serialized = serializeAgentStreamEvent(event.event);
    if (!serialized) {
      return null;
    }
    return {
      type: "stream",
      executionId: agent.owner.executionId,
      agentId: agent.id,
      event: serialized,
    };
  }

  private projectAgentState(agent: ManagedAgent): OwnedAgentEvent | null {
    if (!this.isOwned(agent)) {
      return null;
    }
    return {
      type: "update",
      executionId: agent.owner.executionId,
      agent: serializeAgentSnapshot(agent),
    };
  }

  private isOwned(agent: ManagedAgent | null): agent is ManagedAgent & { owner: DaemonAgentOwner } {
    return agent?.owner?.kind === "daemon" && agent.owner.daemonId === this.daemonId;
  }

  private owner(executionId: string): DaemonAgentOwner {
    return { kind: "daemon", daemonId: this.daemonId, executionId };
  }

  private requireOwner(record: StoredAgentRecord): DaemonAgentOwner {
    const owner = record.owner;
    if (owner?.kind !== "daemon" || owner.daemonId !== this.daemonId) {
      throw new Error(`Agent ${record.id} is not owned by daemon ${this.daemonId}`);
    }
    return owner;
  }
}

function requireMatchingPersistedExecutionContract(
  record: StoredAgentRecord,
  prepared: PreparedHubExecutionCreate,
): void {
  const stored = classifyStoredHubExecutionContract(record.hubExecutionContract);
  if (stored.kind === "invalid") {
    throw new HubExecutionContractError(
      "hub_execution_contract_invalid",
      `Hub execution agent ${record.id} has a malformed contract`,
    );
  }
  if (stored.kind === "legacy") {
    if (
      prepared.config.resolvedProviderOptions !== undefined ||
      prepared.config.toolPolicy !== undefined
    ) {
      throw new HubExecutionContractError(
        "execution_contract_mismatch",
        `Legacy Hub execution agent ${record.id} cannot prove policy application`,
      );
    }
    return;
  }
  if (stored.contract.applicationState === "prepared") {
    throw new HubExecutionContractError(
      "hub_execution_contract_incomplete",
      `Hub execution agent ${record.id} did not complete policy application`,
    );
  }
  if (
    stored.contract.protocolVersion !== prepared.protocolVersion ||
    stored.contract.executionFingerprint !== prepared.executionFingerprint ||
    stored.contract.policyFingerprint !== prepared.policyFingerprint
  ) {
    throw new HubExecutionContractError(
      "execution_contract_mismatch",
      `Hub execution agent ${record.id} belongs to a different request intent`,
    );
  }
}

function requireMatchingPreparedExecutionContract(
  original: PreparedHubExecutionCreate,
  incoming: PreparedHubExecutionCreate,
): void {
  if (
    original.protocolVersion !== incoming.protocolVersion ||
    original.executionFingerprint !== incoming.executionFingerprint ||
    original.policyFingerprint !== incoming.policyFingerprint
  ) {
    throw new HubExecutionContractError(
      "execution_contract_mismatch",
      `Hub execution ${incoming.executionId} already has a different in-flight request intent`,
    );
  }
}

function durableToolPolicyAcknowledgement(
  record: StoredAgentRecord,
  prepared: PreparedHubExecutionCreate,
): Pick<OwnedAgentSnapshot, "toolPolicyApplied"> {
  if (!prepared.config.toolPolicy) return {};
  const stored = classifyStoredHubExecutionContract(record.hubExecutionContract);
  if (
    stored.kind !== "valid" ||
    stored.contract.applicationState !== "applied" ||
    stored.contract.policyFingerprint !== prepared.policyFingerprint
  ) {
    throw new HubExecutionContractError(
      "hub_execution_contract_incomplete",
      `Hub execution agent ${record.id} has no matching durable policy acknowledgement`,
    );
  }
  return { toolPolicyApplied: true };
}

function requireHubMcpNamespace(mcpServers: Record<string, McpServerConfig> | undefined): void {
  if (mcpServers && Object.hasOwn(mcpServers, "paseo")) {
    throw new Error('Hub execution MCP server name "paseo" is reserved by the daemon');
  }
}

function ownedCreatedWorktree(
  worktree: CreatePaseoWorktreeWorkflowResult | null,
): CreatePaseoWorktreeWorkflowResult | null {
  return worktree?.created === true ? worktree : null;
}

function requireExecutionWorkspaceId(
  record: Pick<StoredAgentRecord, "id" | "workspaceId">,
): string {
  if (!record.workspaceId) {
    throw new Error(`Hub execution agent ${record.id} has no workspaceId`);
  }
  return record.workspaceId;
}
