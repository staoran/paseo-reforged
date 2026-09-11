import { describe, expect, it } from "vitest";
import {
  selectRemoteTimelineAgentIds,
  shouldDeferAgentTimelineSync,
  type LazyAgentTimelineState,
} from "./lazy-agent-loading";

function createAgent(overrides: Partial<LazyAgentTimelineState> = {}): LazyAgentTimelineState {
  return {
    status: "closed",
    archivedAt: null,
    ...overrides,
  };
}

describe("lazy agent timeline loading", () => {
  it("keeps every visible agent eligible when lazy loading is disabled", () => {
    const agentsById = new Map([
      ["closed", createAgent()],
      ["archived", createAgent({ archivedAt: new Date("2026-09-11T00:00:00.000Z") })],
    ]);

    expect(
      selectRemoteTimelineAgentIds({
        visibleAgentIds: ["closed", "archived", "missing"],
        lazyLoadAgents: false,
        hasAuthoritativeAgentDirectory: true,
        agentsById,
        startIntentAgentIds: new Set(),
        deferredAgentIds: new Set(),
      }),
    ).toEqual(["closed", "archived", "missing"]);
  });

  it("defers unknown and non-archived closed agents without a local start intent", () => {
    const agentsById = new Map([
      ["closed", createAgent()],
      ["archived", createAgent({ archivedAt: new Date("2026-09-11T00:00:00.000Z") })],
      ["idle", createAgent({ status: "idle" })],
      ["running", createAgent({ status: "running" })],
      ["error", createAgent({ status: "error" })],
    ]);

    expect(
      selectRemoteTimelineAgentIds({
        visibleAgentIds: ["closed", "archived", "idle", "running", "error", "missing"],
        lazyLoadAgents: true,
        hasAuthoritativeAgentDirectory: true,
        agentsById,
        startIntentAgentIds: new Set(),
        deferredAgentIds: new Set(),
      }),
    ).toEqual(["archived", "idle", "running", "error"]);
  });

  it("waits for an unknown agent record before allowing remote synchronization", () => {
    expect(
      shouldDeferAgentTimelineSync({
        lazyLoadAgents: true,
        hasAuthoritativeAgentDirectory: true,
        agent: null,
        hasLocalStartIntent: false,
      }),
    ).toBe(true);
  });

  it("restores remote sync eligibility after the user starts a closed agent", () => {
    expect(
      shouldDeferAgentTimelineSync({
        lazyLoadAgents: true,
        hasAuthoritativeAgentDirectory: true,
        agent: createAgent(),
        hasLocalStartIntent: true,
      }),
    ).toBe(false);
  });

  it("defers a cached non-closed agent until the directory becomes authoritative", () => {
    expect(
      selectRemoteTimelineAgentIds({
        visibleAgentIds: ["cached-idle"],
        lazyLoadAgents: true,
        hasAuthoritativeAgentDirectory: false,
        agentsById: new Map([["cached-idle", createAgent({ status: "idle" })]]),
        startIntentAgentIds: new Set(),
        deferredAgentIds: new Set(),
      }),
    ).toEqual([]);
  });

  it("keeps a passively closed agent deferred after a late active directory update", () => {
    expect(
      shouldDeferAgentTimelineSync({
        lazyLoadAgents: true,
        hasAuthoritativeAgentDirectory: true,
        agent: createAgent({ status: "idle" }),
        hasLocalStartIntent: false,
        hasPassiveDeferral: true,
      }),
    ).toBe(true);
  });

  it("does not defer archived agents from a stale passive deferral", () => {
    expect(
      shouldDeferAgentTimelineSync({
        lazyLoadAgents: true,
        hasAuthoritativeAgentDirectory: true,
        agent: createAgent({ archivedAt: new Date("2026-09-11T00:00:00.000Z") }),
        hasLocalStartIntent: false,
        hasPassiveDeferral: true,
      }),
    ).toBe(false);
  });
});
