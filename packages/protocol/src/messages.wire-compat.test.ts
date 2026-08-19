import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  AgentSnapshotPayloadSchema,
  AgentTimelineItemPayloadSchema,
  CreateAgentRequestMessageSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  WSHelloMessageSchema,
} from "./messages.js";

const LegacySubAgentToolCallSchema = z.object({
  type: z.literal("tool_call"),
  callId: z.string(),
  name: z.string(),
  status: z.enum(["running", "completed", "failed", "canceled"]),
  error: z.unknown().nullable(),
  detail: z.object({
    type: z.literal("sub_agent"),
    subAgentType: z.string().optional(),
    description: z.string().optional(),
    log: z.string(),
    // Copied from v0.1.65-beta.3: actions was required even though the UI ignored it.
    actions: z.array(
      z.object({
        index: z.number().int().positive(),
        toolName: z.string(),
        summary: z.string().optional(),
      }),
    ),
  }),
});

const LegacyAgentCapabilityFlagsSchema = z.object({
  supportsStreaming: z.boolean(),
  supportsSessionPersistence: z.boolean(),
  supportsDynamicModes: z.boolean(),
  supportsMcpServers: z.boolean(),
  supportsReasoningStream: z.boolean(),
  supportsToolInvocations: z.boolean(),
});

const LegacyAgentSnapshotPayloadSchema = AgentSnapshotPayloadSchema.omit({
  goal: true,
  goalStep: true,
  goalSync: true,
}).extend({
  capabilities: LegacyAgentCapabilityFlagsSchema,
});

describe("wire schema compatibility", () => {
  test("new daemons retain beta.5 agent launch fields", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      config: {
        provider: "codex",
        cwd: "/tmp/project",
        approvalPolicy: "never",
        sandboxMode: "read-only",
        networkAccess: false,
        webSearch: false,
        extra: {
          codex: { web_search: "disabled", custom_legacy_flag: true },
        },
      },
      requestId: "legacy-agent-config",
    });

    expect(parsed.config).toMatchObject({
      approvalPolicy: "never",
      sandboxMode: "read-only",
      networkAccess: false,
      webSearch: false,
      extra: {
        codex: { web_search: "disabled", custom_legacy_flag: true },
      },
    });
  });

  test("hello parses with and without the project update capability", () => {
    const legacy = WSHelloMessageSchema.parse({
      type: "hello",
      clientId: "legacy-client",
      clientType: "mobile",
      protocolVersion: 1,
    });
    const capable = WSHelloMessageSchema.parse({
      type: "hello",
      clientId: "capable-client",
      clientType: "mobile",
      protocolVersion: 1,
      capabilities: { project_updates: true },
    });

    expect([legacy, capable]).toEqual([
      {
        type: "hello",
        clientId: "legacy-client",
        clientType: "mobile",
        protocolVersion: 1,
      },
      {
        type: "hello",
        clientId: "capable-client",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: { project_updates: true },
      },
    ]);
  });

  test("server info strips unknown legacy features while accepting former turn identity", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "legacy-server",
      features: {
        workspaceGithubClone: true,
        agentTurnIdentity: true,
      },
    });

    expect(parsed).toEqual({
      status: "server_info",
      serverId: "legacy-server",
      hostname: null,
      version: null,
      features: { agentTurnIdentity: true },
    });
  });

  test("server info preserves the optional Agent Goal control capability", () => {
    // Legacy daemon payload has no Goal capability field.
    const legacy = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "legacy-server",
      features: {},
    });
    // Supporting daemon advertises the single public Goal control gate.
    const capable = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "capable-server",
      features: { agentGoalControl: true },
    });

    expect([legacy.features?.agentGoalControl, capable.features?.agentGoalControl]).toEqual([
      undefined,
      true,
    ]);
  });

  test("assistant timeline message ids are optional on the wire", () => {
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "assistant_message",
        text: "old daemon shape",
      }),
    ).toEqual({
      type: "assistant_message",
      text: "old daemon shape",
    });
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "assistant_message",
        text: "new daemon shape",
        messageId: "msg-1",
      }),
    ).toEqual({
      type: "assistant_message",
      text: "new daemon shape",
      messageId: "msg-1",
    });
  });

  test("task progress fields are optional on the wire", () => {
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "todo",
        items: [{ text: "Legacy task", completed: false }],
      }),
    ).toEqual({ type: "todo", items: [{ text: "Legacy task", completed: false }] });
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "todo",
        items: [
          {
            id: "task-1",
            text: "Current task",
            activeForm: "Working on current task",
            status: "in_progress",
            completed: false,
          },
        ],
      }),
    ).toEqual({
      type: "todo",
      items: [
        {
          id: "task-1",
          text: "Current task",
          activeForm: "Working on current task",
          status: "in_progress",
          completed: false,
        },
      ],
    });
  });

  test("sub_agent tool-call payload still parses against the v0.1.65-beta.3 schema", () => {
    const parsed = LegacySubAgentToolCallSchema.parse({
      type: "tool_call",
      callId: "call-sub-agent-1",
      name: "Task",
      status: "completed",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        childSessionId: "child-session-1",
        log: "[Read] README.md",
        actions: [],
      },
    });

    expect(parsed.detail.actions).toEqual([]);
  });

  test("old clients ignore Goal and rewind additions in new daemon snapshots", () => {
    const parsed = LegacyAgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
        supportsRewindConversation: true,
        supportsRewindFiles: true,
        supportsRewindBoth: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
      goal: {
        objective: "New daemon Goal",
        status: "active",
        tokenBudget: null,
        tokensUsed: 500,
        timeUsedSeconds: 30,
        createdAt: "2026-08-18T01:00:00.000Z",
        updatedAt: "2026-08-18T01:00:30.000Z",
      },
      goalStep: null,
      goalSync: "synced",
    });

    expect(parsed.capabilities).toEqual({
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    });
    expect("goal" in parsed).toBe(false);
  });

  test("new clients parse agent snapshots without rewind capabilities", () => {
    const parsed = AgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
    });

    expect(parsed.capabilities.supportsRewindConversation).toBe(false);
    expect(parsed.capabilities.supportsRewindFiles).toBe(false);
    expect(parsed.capabilities.supportsRewindBoth).toBe(false);
  });

  test("new clients distinguish unknown, absent, and active Goal snapshots", () => {
    // Minimal legacy snapshot shared by the three compatibility cases.
    const snapshot = {
      id: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      model: null,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
    };

    // An omitted Goal remains unknown for old daemons and providers without support.
    const unknown = AgentSnapshotPayloadSchema.parse(snapshot);
    // A null Goal is an authoritative confirmation that no Goal exists.
    const absent = AgentSnapshotPayloadSchema.parse({
      ...snapshot,
      goal: null,
      goalStep: null,
      goalSync: "synced",
    });
    // An object Goal carries the provider generation and its matching current step.
    const active = AgentSnapshotPayloadSchema.parse({
      ...snapshot,
      goal: {
        objective: "Implement Goal support",
        status: "active",
        tokenBudget: 100_000,
        tokensUsed: 12_500,
        timeUsedSeconds: 900,
        createdAt: "2026-08-18T01:00:00.000Z",
        updatedAt: "2026-08-18T01:05:00.000Z",
      },
      goalStep: {
        generation: "2026-08-18T01:00:00.000Z",
        ordinal: 2,
        text: "Add protocol schemas",
        status: "in_progress",
        activeForm: "Adding protocol schemas",
      },
      goalSync: "synced",
    });

    expect([unknown.goal, absent.goal, active.goal, active.goalStep, active.goalSync]).toEqual([
      undefined,
      null,
      {
        objective: "Implement Goal support",
        status: "active",
        tokenBudget: 100_000,
        tokensUsed: 12_500,
        timeUsedSeconds: 900,
        createdAt: "2026-08-18T01:00:00.000Z",
        updatedAt: "2026-08-18T01:05:00.000Z",
      },
      {
        generation: "2026-08-18T01:00:00.000Z",
        ordinal: 2,
        text: "Add protocol schemas",
        status: "in_progress",
        activeForm: "Adding protocol schemas",
      },
      "synced",
    ]);
  });

  test("Agent Goal get request and response preserve correlated authoritative state", () => {
    // Public request is parsed through the complete daemon inbound union.
    const request = SessionInboundMessageSchema.parse({
      type: "agent.goal.get.request",
      requestId: "goal-get-1",
      agentId: "agent-1",
    });
    // Public response is parsed through the complete daemon outbound union.
    const response = SessionOutboundMessageSchema.parse({
      type: "agent.goal.get.response",
      payload: {
        requestId: "goal-get-1",
        agentId: "agent-1",
        ok: true,
        goal: null,
        goalStep: null,
        goalSync: "synced",
        error: null,
      },
    });

    expect([request, response]).toEqual([
      {
        type: "agent.goal.get.request",
        requestId: "goal-get-1",
        agentId: "agent-1",
      },
      {
        type: "agent.goal.get.response",
        payload: {
          requestId: "goal-get-1",
          agentId: "agent-1",
          ok: true,
          goal: null,
          goalStep: null,
          goalSync: "synced",
          error: null,
        },
      },
    ]);
  });

  test("Agent Goal update accepts pause, resume, and objective replacement mutations", () => {
    // All public update mutations share one correlated request envelope.
    const requests = [
      { kind: "pause" },
      { kind: "resume" },
      { kind: "replace_objective", objective: "Finish the protocol implementation" },
    ].map((mutation, index) =>
      SessionInboundMessageSchema.parse({
        type: "agent.goal.update.request",
        requestId: `goal-update-${index}`,
        agentId: "agent-1",
        expectedGeneration: "2026-08-18T01:00:00.000Z",
        mutation,
      }),
    );
    // The response keeps the authoritative projection and the same correlation id.
    const response = SessionOutboundMessageSchema.parse({
      type: "agent.goal.update.response",
      payload: {
        requestId: "goal-update-2",
        agentId: "agent-1",
        ok: true,
        goal: null,
        goalStep: null,
        goalSync: "synced",
        error: null,
      },
    });

    expect([
      requests.map((request) => "mutation" in request && request.mutation),
      response,
    ]).toEqual([
      [
        { kind: "pause" },
        { kind: "resume" },
        { kind: "replace_objective", objective: "Finish the protocol implementation" },
      ],
      {
        type: "agent.goal.update.response",
        payload: {
          requestId: "goal-update-2",
          agentId: "agent-1",
          ok: true,
          goal: null,
          goalStep: null,
          goalSync: "synced",
          error: null,
        },
      },
    ]);
  });

  test("Agent Goal terminate exposes a cleared Goal with a still-running turn", () => {
    // Termination optionally protects against operating on a replaced Goal generation.
    const request = SessionInboundMessageSchema.parse({
      type: "agent.goal.terminate.request",
      requestId: "goal-terminate-1",
      agentId: "agent-1",
      expectedGeneration: "2026-08-18T01:00:00.000Z",
    });
    // Partial success remains explicit when clear succeeds but interrupt fails.
    const response = SessionOutboundMessageSchema.parse({
      type: "agent.goal.terminate.response",
      payload: {
        requestId: "goal-terminate-1",
        agentId: "agent-1",
        ok: false,
        goal: null,
        goalStep: null,
        clear: "cleared",
        interrupt: "failed",
        outcome: "goal_cleared_turn_running",
        error: {
          code: "interrupt_failed",
          retryable: true,
          message: "Goal cleared, but the active turn could not be interrupted",
        },
      },
    });

    expect([request, response]).toEqual([
      {
        type: "agent.goal.terminate.request",
        requestId: "goal-terminate-1",
        agentId: "agent-1",
        expectedGeneration: "2026-08-18T01:00:00.000Z",
      },
      {
        type: "agent.goal.terminate.response",
        payload: {
          requestId: "goal-terminate-1",
          agentId: "agent-1",
          ok: false,
          goal: null,
          goalStep: null,
          clear: "cleared",
          interrupt: "failed",
          outcome: "goal_cleared_turn_running",
          error: {
            code: "interrupt_failed",
            retryable: true,
            message: "Goal cleared, but the active turn could not be interrupted",
          },
        },
      },
    ]);
  });
});
