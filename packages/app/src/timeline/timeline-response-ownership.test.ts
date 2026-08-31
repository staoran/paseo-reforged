import { expect, test } from "vitest";
import {
  createAppTimelineRequestId,
  createTimelineResponseOwnership,
} from "./timeline-response-ownership";

test("a replaced viewed request rejects the old canonical response", () => {
  const ownership = createTimelineResponseOwnership();
  let firstCurrent = true;
  const first = ownership.begin({
    agentId: "agent-a",
    requestId: createAppTimelineRequestId("viewed"),
    isCurrent: () => firstCurrent,
  });
  firstCurrent = false;
  const replacement = ownership.begin({
    agentId: "agent-a",
    requestId: createAppTimelineRequestId("viewed"),
    isCurrent: () => true,
  });
  expect(ownership.isCurrent(first)).toBe(false);
  expect(ownership.isCurrent(replacement)).toBe(true);

  expect(
    ownership.shouldApply({
      agentId: "agent-a",
      requestId: first.requestId,
      activeInitializationRequestId: replacement.requestId,
    }),
  ).toBe(false);
  expect(
    ownership.shouldApply({
      agentId: "agent-a",
      requestId: replacement.requestId,
      activeInitializationRequestId: replacement.requestId,
    }),
  ).toBe(true);

  ownership.finish(replacement);
  expect(ownership.isCurrent(replacement)).toBe(false);
  expect(
    ownership.shouldApply({
      agentId: "agent-a",
      requestId: replacement.requestId,
      activeInitializationRequestId: null,
    }),
  ).toBe(false);
});

test("non-viewed responses remain eligible while direct initialization owns its request", () => {
  const ownership = createTimelineResponseOwnership();
  const initializationRequestId = createAppTimelineRequestId("initialization");

  expect(
    ownership.shouldApply({
      agentId: "agent-a",
      requestId: initializationRequestId,
      activeInitializationRequestId: initializationRequestId,
    }),
  ).toBe(true);
  expect(
    ownership.shouldApply({
      agentId: "agent-a",
      requestId: "daemon-request-outside-viewed-sync",
      activeInitializationRequestId: initializationRequestId,
    }),
  ).toBe(false);
  expect(
    ownership.shouldApply({
      agentId: "agent-a",
      requestId: "daemon-request-outside-viewed-sync",
      activeInitializationRequestId: null,
    }),
  ).toBe(true);
});

test("a new direct initialization rejects the previous viewed response", () => {
  const ownership = createTimelineResponseOwnership();
  const viewed = ownership.begin({
    agentId: "agent-a",
    requestId: createAppTimelineRequestId("viewed"),
    isCurrent: () => true,
  });
  const directRequestId = createAppTimelineRequestId("initialization");

  expect(
    ownership.shouldApply({
      agentId: "agent-a",
      requestId: viewed.requestId,
      activeInitializationRequestId: directRequestId,
    }),
  ).toBe(false);
  expect(
    ownership.shouldApply({
      agentId: "agent-a",
      requestId: directRequestId,
      activeInitializationRequestId: directRequestId,
    }),
  ).toBe(true);
});
