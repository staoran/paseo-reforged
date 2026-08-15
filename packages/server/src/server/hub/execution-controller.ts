import { isAbsolute } from "node:path";
import type {
  HubExecutionAgentCreateErrorDetails,
  HubExecutionAgentCreateRequest,
  HubExecutionAgentValidateRequest,
  HubExecutionAgentValidationIssue,
  HubExecutionControlRequest,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import { HubExecutionContractError } from "../agent/agent-config-compat.js";
import {
  ProviderOptionsValidationError,
  ToolPolicyUnsupportedError,
} from "../agent/provider-options.js";

import type { HubExecutionAgents, OwnedAgentEvent } from "./daemon-executions.js";

interface HubExecutionControllerOptions {
  agents: HubExecutionAgents;
  validateAgentConfiguration: (
    input: Omit<HubExecutionAgentValidateRequest, "type" | "requestId">,
  ) => Promise<HubExecutionAgentValidationIssue[]>;
  send: (message: SessionOutboundMessage) => void;
}

export class HubExecutionController {
  private readonly agents: HubExecutionAgents;
  private readonly send: (message: SessionOutboundMessage) => void;
  private readonly validateAgentConfiguration: HubExecutionControllerOptions["validateAgentConfiguration"];
  private readonly unsubscribe: () => void;
  private readonly pendingCreates = new Set<Promise<void>>();
  private readonly pendingControls = new Set<Promise<void>>();
  private readonly pendingValidations = new Set<Promise<void>>();
  private cleanupPromise: Promise<void> | null = null;
  private closed = false;

  constructor(options: HubExecutionControllerOptions) {
    this.agents = options.agents;
    this.validateAgentConfiguration = options.validateAgentConfiguration;
    this.send = options.send;
    this.unsubscribe = this.agents.subscribe((event) => this.sendOwnedEvent(event));
  }

  cleanup(): Promise<void> {
    this.cleanupPromise ??= this.cleanupOnce();
    return this.cleanupPromise;
  }

  private async cleanupOnce(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    await Promise.allSettled([
      ...this.pendingCreates,
      ...this.pendingControls,
      ...this.pendingValidations,
    ]);
  }

  async validateAgent(message: HubExecutionAgentValidateRequest): Promise<void> {
    if (this.closed) return;
    const validation = this.validateAgentWithResponse(message);
    this.pendingValidations.add(validation);
    try {
      await validation;
    } finally {
      this.pendingValidations.delete(validation);
    }
  }

  private async validateAgentWithResponse(
    message: HubExecutionAgentValidateRequest,
  ): Promise<void> {
    let issues: HubExecutionAgentValidationIssue[] = [];
    let error: string | null = null;
    try {
      issues = await this.validateAgentConfiguration({
        provider: message.provider,
        model: message.model,
        modeId: message.modeId,
        thinkingOptionId: message.thinkingOptionId,
        providerOptions: message.providerOptions,
      });
    } catch (validationError) {
      error = validationError instanceof Error ? validationError.message : String(validationError);
    }
    if (this.closed) return;
    this.send({
      type: "hub.execution.agent.validate.response",
      payload: {
        requestId: message.requestId,
        valid: error === null && issues.length === 0,
        issues,
        error,
      },
    });
  }

  async controlExecution(message: HubExecutionControlRequest): Promise<void> {
    if (this.closed) return;
    const control = this.controlExecutionWithResponse(message);
    this.pendingControls.add(control);
    try {
      await control;
    } finally {
      this.pendingControls.delete(control);
    }
  }

  private async controlExecutionWithResponse(message: HubExecutionControlRequest): Promise<void> {
    let error: string | null = null;
    try {
      requireNonBlankHubAgentField("executionId", message.executionId);
      await this.agents.control({
        requestId: message.requestId,
        executionId: message.executionId,
        action: message.action,
      });
    } catch (controlError) {
      error = controlError instanceof Error ? controlError.message : String(controlError);
    }
    if (this.closed) return;
    this.send({
      type: "hub.execution.control.response",
      payload: {
        requestId: message.requestId,
        executionId: message.executionId,
        action: message.action,
        success: error === null,
        error,
      },
    });
  }

  async createAgent(message: HubExecutionAgentCreateRequest): Promise<void> {
    if (this.closed) return;
    const create = this.createAgentWithResponse(message);
    this.pendingCreates.add(create);
    try {
      await create;
    } finally {
      this.pendingCreates.delete(create);
    }
  }

  private async createAgentWithResponse(message: HubExecutionAgentCreateRequest): Promise<void> {
    try {
      requireNonBlankHubAgentField("executionId", message.executionId);
      requireNonBlankHubAgentField("prompt", message.prompt);
      requireNonBlankHubAgentField("cwd", message.cwd);
      if (!isAbsolute(message.cwd)) throw new Error("Hub agent cwd must be absolute");
      const result = await this.agents.create({
        executionId: message.executionId,
        provider: message.provider,
        cwd: message.cwd,
        prompt: message.prompt,
        model: message.model,
        modeId: message.modeId,
        thinkingOptionId: message.thinkingOptionId,
        featureValues: message.featureValues,
        providerOptions: message.providerOptions,
        toolPolicy: message.toolPolicy,
        env: message.env,
        mcpServers: message.mcpServers,
        worktree: message.worktree,
      });
      if (this.closed) return;
      this.send({
        type: "hub.execution.agent.create.response",
        payload: {
          requestId: message.requestId,
          executionId: message.executionId,
          agentId: result.agent.id,
          agent: result.agent,
          success: true,
          ...(result.toolPolicyApplied ? { toolPolicyApplied: true as const } : {}),
          error: null,
        },
      });
    } catch (error) {
      if (this.closed) return;
      const failure = toHubCreateFailure(error);
      this.send({
        type: "hub.execution.agent.create.response",
        payload: {
          requestId: message.requestId,
          executionId: message.executionId,
          agentId: null,
          agent: null,
          success: false,
          ...failure,
        },
      });
    }
  }

  private sendOwnedEvent(event: OwnedAgentEvent): void {
    if (this.closed) return;
    if (event.type === "update") {
      this.send({
        type: "hub.execution.agent.update",
        payload: {
          executionId: event.executionId,
          agentId: event.agent.id,
          agent: event.agent,
        },
      });
      return;
    }
    this.send({
      type: "hub.execution.agent.stream",
      payload: {
        executionId: event.executionId,
        agentId: event.agentId,
        event: event.event,
      },
    });
  }
}

interface HubCreateFailure {
  error: string;
  errorDetails?: HubExecutionAgentCreateErrorDetails;
}

function toHubCreateFailure(error: unknown): HubCreateFailure {
  if (error instanceof ProviderOptionsValidationError) {
    return {
      error: "Hub execution provider options are invalid",
      errorDetails: {
        code: error.code,
        provider: error.provider,
        issues: error.issues,
        message: error.message,
      },
    };
  }
  if (error instanceof ToolPolicyUnsupportedError) {
    return {
      error: "Hub execution tool policy is unsupported",
      errorDetails: {
        code: error.code,
        provider: error.provider,
        message: error.message,
      },
    };
  }
  if (error instanceof HubExecutionContractError) {
    return {
      error: hubExecutionContractErrorSummary(error.code),
      errorDetails: { code: error.code, message: error.message },
    };
  }
  return { error: "Hub execution could not be created" };
}

function hubExecutionContractErrorSummary(code: HubExecutionContractError["code"]): string {
  switch (code) {
    case "hub_execution_contract_incomplete":
      return "Hub execution is incomplete";
    case "hub_execution_contract_invalid":
      return "Hub execution contract is invalid";
    case "execution_contract_mismatch":
      return "Hub execution request conflicts with an existing execution";
  }
}

function requireNonBlankHubAgentField(
  field: "executionId" | "prompt" | "cwd",
  value: string,
): void {
  if (value.trim().length === 0) {
    throw new Error(`Hub agent ${field} cannot be blank`);
  }
}
