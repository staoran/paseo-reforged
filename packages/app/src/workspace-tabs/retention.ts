export const MODIFIED_STATE_NOT_RECOVERABLE_RETENTION_REASON =
  "modified-state-not-recoverable" as const;

export type RetainedTabReason = typeof MODIFIED_STATE_NOT_RECOVERABLE_RETENTION_REASON;
