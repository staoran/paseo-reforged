import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Summary } from "lucide-react-native";
import { ExpandableBadge } from "@/components/message";
import { useOverviewSummaryLabel } from "@/tool-calls/detail-level/overview/label";
import type { CollapsedTurn } from "./model";
import { formatDuration } from "@/utils/time";

/**
 * The row a collapsed turn leaves under its user message, styled like a tool-call group.
 * Pressing it opens the turn's rows beneath it.
 */
export const TurnSummaryLine = memo(function TurnSummaryLine({
  turn,
  onExpandedChange,
}: {
  turn: CollapsedTurn;
  onExpandedChange: (hostId: string, expanded: boolean) => void;
}) {
  const { t } = useTranslation();
  const actions = useOverviewSummaryLabel(turn.summary.tools);
  /** Live processes remain forced open until their explicit final stops */
  let label = t("agentControls.thinking.title");
  if (turn.completed) {
    label = t("message.activity.completed");
    if (turn.durationMs !== null) {
      label = t("message.activity.completedWithDuration", {
        duration: formatDuration(turn.durationMs),
      });
    }
  }
  const toggle = useCallback(() => {
    if (turn.completed) onExpandedChange(turn.hostId, !turn.expanded);
  }, [onExpandedChange, turn.completed, turn.expanded, turn.hostId]);

  return (
    <ExpandableBadge
      testID="turn-summary"
      label={label}
      secondaryLabel={actions || undefined}
      icon={Summary}
      isExpanded={turn.expanded}
      onToggle={toggle}
      borderlessWhenExpanded
    />
  );
});
