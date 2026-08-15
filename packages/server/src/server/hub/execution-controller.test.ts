import { describe, expect, test } from "vitest";
import type {
  AgentSnapshotPayload,
  HubExecutionAgentCreateRequest,
  HubExecutionAgentValidateRequest,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";

import type {
  HubExecutionAgents,
  OwnedAgentEvent,
  OwnedAgentSnapshot,
} from "./daemon-executions.js";
import { HubExecutionController } from "./execution-controller.js";
import {
  ProviderOptionsValidationError,
  ToolPolicyUnsupportedError,
} from "../agent/provider-options.js";
import { HubExecutionContractError } from "../agent/agent-config-compat.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

class ControlledHubExecutionAgents implements HubExecutionAgents {
  private readonly createObserved = deferred<void>();
  private readonly createGate = deferred<OwnedAgentSnapshot>();

  create(): Promise<OwnedAgentSnapshot> {
    this.createObserved.resolve();
    return this.createGate.promise;
  }

  async control(): Promise<void> {}

  subscribe(_listener: (event: OwnedAgentEvent) => void): () => void {
    return () => undefined;
  }

  async invalidateAuthority(): Promise<void> {}

  async creationStarted(): Promise<void> {
    await this.createObserved.promise;
  }

  finishCreate(): void {
    this.createGate.resolve({
      executionId: "execution-shutdown",
      agent: {
        id: "agent-shutdown",
        status: "running",
      } as AgentSnapshotPayload,
    });
  }
}

class RejectingHubExecutionAgents implements HubExecutionAgents {
  constructor(private readonly error: Error) {}

  async create(): Promise<OwnedAgentSnapshot> {
    throw this.error;
  }

  async control(): Promise<void> {}

  subscribe(_listener: (event: OwnedAgentEvent) => void): () => void {
    return () => undefined;
  }

  async invalidateAuthority(): Promise<void> {}
}

describe("HubExecutionController", () => {
  test("validates a named agent through the daemon provider registry", async () => {
    const messages: SessionOutboundMessage[] = [];
    const validateAgentConfiguration = async (
      message: Omit<HubExecutionAgentValidateRequest, "type" | "requestId">,
    ) =>
      message.model === "missing" ? [{ path: ["model"], message: "Model is unavailable" }] : [];
    const controller = new HubExecutionController({
      agents: new ControlledHubExecutionAgents(),
      validateAgentConfiguration,
      send: (message) => messages.push(message),
    });

    await controller.validateAgent({
      type: "hub.execution.agent.validate.request",
      requestId: "validate-agent",
      provider: "codex",
      model: "missing",
    });

    expect(messages).toEqual([
      {
        type: "hub.execution.agent.validate.response",
        payload: {
          requestId: "validate-agent",
          valid: false,
          issues: [{ path: ["model"], message: "Model is unavailable" }],
          error: null,
        },
      },
    ]);
  });

  test("cleanup fences in-flight creates before the dead session can receive a response", async () => {
    const agents = new ControlledHubExecutionAgents();
    const messages: SessionOutboundMessage[] = [];
    const controller = new HubExecutionController({
      agents,
      validateAgentConfiguration: async () => [],
      send: (message) => messages.push(message),
    });

    const create = controller.createAgent({
      type: "hub.execution.agent.create.request",
      requestId: "shutdown-create",
      executionId: "execution-shutdown",
      provider: "codex",
      cwd: "/tmp/paseo",
      prompt: "sleep 30",
    } satisfies HubExecutionAgentCreateRequest);
    await agents.creationStarted();

    const cleanup = controller.cleanup();
    agents.finishCreate();
    await Promise.all([create, cleanup]);

    expect(messages).toEqual([]);
  });

  test("does not acknowledge a requested tool policy without durable application evidence", async () => {
    const agents = new ControlledHubExecutionAgents();
    const messages: SessionOutboundMessage[] = [];
    const controller = new HubExecutionController({
      agents,
      validateAgentConfiguration: async () => [],
      send: (message) => messages.push(message),
    });

    const create = controller.createAgent({
      type: "hub.execution.agent.create.request",
      requestId: "tool-policy-create",
      executionId: "execution-shutdown",
      provider: "hub-e2e",
      cwd: "/tmp/paseo",
      prompt: "finish",
      mcpServers: { hub: { type: "http", url: "http://127.0.0.1/execution" } },
      toolPolicy: {
        preapproved: [{ kind: "mcp", server: "hub", tool: "finish_execution" }],
      },
    });
    await agents.creationStarted();
    agents.finishCreate();
    await create;

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "hub.execution.agent.create.response",
      payload: { success: true },
    });
    expect(messages[0]?.payload).not.toHaveProperty("toolPolicyApplied");
  });

  test.each([
    {
      error: new ProviderOptionsValidationError("codex", [
        { path: ["sandbox_workspace_write", "writable_roots", 0], message: "Expected string" },
      ]),
      expectedError: "Hub execution provider options are invalid",
      expectedDetails: {
        code: "provider_options_invalid",
        provider: "codex",
        issues: [
          {
            path: ["sandbox_workspace_write", "writable_roots", 0],
            message: "Expected string",
          },
        ],
      },
    },
    {
      error: new ToolPolicyUnsupportedError("pi"),
      expectedError: "Hub execution tool policy is unsupported",
      expectedDetails: { code: "tool_policy_unsupported", provider: "pi" },
    },
    {
      error: new HubExecutionContractError(
        "execution_contract_mismatch",
        "The durable execution belongs to another request",
      ),
      expectedError: "Hub execution request conflicts with an existing execution",
      expectedDetails: { code: "execution_contract_mismatch" },
    },
  ])(
    "returns compatible $expectedDetails.code create feedback",
    async ({ error, expectedError, expectedDetails }) => {
      const messages: SessionOutboundMessage[] = [];
      const controller = new HubExecutionController({
        agents: new RejectingHubExecutionAgents(error),
        send: (message) => messages.push(message),
      });

      await controller.createAgent({
        type: "hub.execution.agent.create.request",
        requestId: "rejected-create",
        executionId: "rejected-execution",
        provider: "codex",
        cwd: "/tmp/paseo",
        prompt: "run unattended",
      });

      expect(messages).toEqual([
        expect.objectContaining({
          type: "hub.execution.agent.create.response",
          payload: expect.objectContaining({
            success: false,
            error: expectedError,
            errorDetails: expect.objectContaining(expectedDetails),
          }),
        }),
      ]);
    },
  );

  test("does not expose unknown create failure inputs or credentials", async () => {
    const secret = "Bearer hub-secret-token";
    const messages: SessionOutboundMessage[] = [];
    const controller = new HubExecutionController({
      agents: new RejectingHubExecutionAgents(
        new Error(`providerOptions api_key=value; prompt=private; authorization=${secret}`),
      ),
      validateAgentConfiguration: async () => [],
      send: (message) => messages.push(message),
    });

    await controller.createAgent({
      type: "hub.execution.agent.create.request",
      requestId: "secret-create",
      executionId: "secret-execution",
      provider: "codex",
      cwd: "/tmp/paseo",
      prompt: "private",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        type: "hub.execution.agent.create.response",
        payload: {
          requestId: "secret-create",
          executionId: "secret-execution",
          agentId: null,
          agent: null,
          success: false,
          error: "Hub execution could not be created",
        },
      }),
    ]);
    expect(JSON.stringify(messages)).not.toContain(secret);
  });
});
