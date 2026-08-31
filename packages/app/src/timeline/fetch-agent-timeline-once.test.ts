import { expect, test } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { fetchAgentTimelineOnce } from "./fetch-agent-timeline-once";

type TimelinePage = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;

test("concurrent equivalent timeline reads with the same request ID share one request", async () => {
  let resolvePage: (page: TimelinePage) => void = () => {};
  /** Timeline page retained until both callers enter the shared request. */
  const page = new Promise<TimelinePage>((resolve) => {
    resolvePage = resolve;
  });
  /** Wire calls observed through the public timeline client seam. */
  const requests: Array<{
    agentId: string;
    request: Parameters<DaemonClient["fetchAgentTimeline"]>[1];
  }> = [];
  /** Client whose pending wire request exposes whether equivalent calls are deduplicated. */
  const client = {
    fetchAgentTimeline: async (
      agentId: string,
      request: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
    ) => {
      requests.push({ agentId, request });
      return page;
    },
  };
  /** Correlation ID shared by direct initialization and the viewed catch-up handoff. */
  const requestId = "paseo-app-timeline:initialization:test-shared";
  /** Direct initialization request entering the deduplication seam first. */
  const directRequest = {
    direction: "tail" as const,
    limit: 100,
    projection: "projected" as const,
    requestId,
  };
  /** Independently allocated viewed request with the same wire identity and shape. */
  const viewedRequest = {
    direction: "tail" as const,
    limit: 100,
    projection: "projected" as const,
    requestId,
  };

  const first = fetchAgentTimelineOnce(client, "agent", directRequest);
  const second = fetchAgentTimelineOnce(client, "agent", viewedRequest);
  resolvePage({ hasNewer: false } as TimelinePage);

  await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  expect(requests).toEqual([{ agentId: "agent", request: directRequest }]);
});
