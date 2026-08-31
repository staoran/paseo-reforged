/** Prefix reserved for App-owned Agent timeline requests. */
const APP_TIMELINE_REQUEST_ID_PREFIX = "paseo-app-timeline:";
const DIRECT_INITIALIZATION_REQUEST_ID_PREFIX = `${APP_TIMELINE_REQUEST_ID_PREFIX}initialization:`;

/** Monotonic sequence used to distinguish App timeline requests in this runtime. */
let timelineRequestSequence = 0;

export type AppTimelineRequestScope = "initialization" | "viewed";

export interface TimelineResponseOwner {
  /** Agent whose canonical response lane is owned. */
  agentId: string;
  /** Correlation ID sent on the wire. */
  requestId: string;
  /** Reports whether the surrounding viewed catch-up generation remains current. */
  isCurrent(): boolean;
}

export interface TimelineResponseOwnership {
  /** Installs the latest viewed request owner for an Agent. */
  begin(owner: TimelineResponseOwner): TimelineResponseOwner;
  /** Retires a completed request without making duplicate responses current. */
  finish(owner: TimelineResponseOwner): void;
  /** Reports whether this exact viewed owner is still installed and current. */
  isCurrent(owner: TimelineResponseOwner): boolean;
  /** Decides whether a canonical response may enter the session reducer. */
  shouldApply(input: {
    agentId: string;
    requestId: string;
    activeInitializationRequestId: string | null;
  }): boolean;
}

/** Creates a wire correlation ID recognizable by the App timeline owner gate. */
export function createAppTimelineRequestId(scope: AppTimelineRequestScope): string {
  timelineRequestSequence += 1;
  return `${APP_TIMELINE_REQUEST_ID_PREFIX}${scope}:${timelineRequestSequence}`;
}

/** Creates request ownership state scoped to one SessionProvider. */
export function createTimelineResponseOwnership(): TimelineResponseOwnership {
  /** Latest viewed request owner for each Agent. */
  const currentByAgent = new Map<string, TimelineResponseOwner>();

  return {
    begin: (owner) => {
      currentByAgent.set(owner.agentId, owner);
      return owner;
    },
    finish: (owner) => {
      if (currentByAgent.get(owner.agentId) === owner) {
        currentByAgent.delete(owner.agentId);
      }
    },
    isCurrent: (owner) => currentByAgent.get(owner.agentId) === owner && owner.isCurrent(),
    shouldApply: ({ agentId, requestId, activeInitializationRequestId }) => {
      const owner = currentByAgent.get(agentId);
      if (activeInitializationRequestId) {
        if (requestId !== activeInitializationRequestId) return false;
        if (owner?.requestId === requestId) return owner.isCurrent();
        return requestId.startsWith(DIRECT_INITIALIZATION_REQUEST_ID_PREFIX);
      }
      if (!requestId.startsWith(APP_TIMELINE_REQUEST_ID_PREFIX)) return true;
      if (owner?.requestId === requestId) return owner.isCurrent();
      return false;
    },
  };
}
