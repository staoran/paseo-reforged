import React, { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pause, Pencil, Play, RotateCw, Square, Target } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  AgentGoalError,
  AgentGoalSnapshot,
  AgentGoalStatus,
} from "@getpaseo/protocol/agent-types";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { formatDurationWithSeconds } from "@/utils/time";
import { applyGoalProjection, validateGoalObjective, type GoalProjection } from "./model";
import { buildGoalPresentation, shouldShowAgentGoalTrack } from "./presentation";
import type { GoalActionId, GoalActionPresentation, GoalPresentation } from "./presentation";

/** Localized copy consumed by the pure Goal track view. */
export interface GoalTrackLabels {
  /** Accessible label for the complete Goal status/control surface. */
  track: string;
  /** Accessible current-step description, when a step is present. */
  currentStep: string | null;
  /** Localized provider Goal status. */
  status: string;
  /** Localized token and elapsed-time summary. */
  usage: string;
  /** Accessible Pause command label. */
  pause: string;
  /** Accessible Resume command label. */
  resume: string;
  /** Accessible objective-edit command label. */
  edit: string;
  /** Accessible terminate command label. */
  terminate: string;
  /** Accessible projection-retry command label. */
  retry: string;
}

/** Props for the platform-neutral Goal track view. */
export interface GoalTrackViewProps {
  /** Derived Goal state and action matrix. */
  presentation: GoalPresentation;
  /** Provider-owned current step text, when available. */
  currentStep: string | null;
  /** Localized labels rendered by the control. */
  labels: GoalTrackLabels;
  /** Latest non-sensitive Goal control failure. */
  error: string | null;
  /** Invoked when the user selects an enabled Goal action. */
  onAction: (action: GoalActionId) => void;
}

/** Translation function shape used by Goal presentation helpers. */
type GoalTranslate = (key: string, values?: Record<string, string>) => string;

/** Normalized result shared by Goal read, update, and terminate actions. */
interface GoalActionResponse extends GoalProjection {
  /** Whether the complete requested operation succeeded. */
  ok: boolean;
  /** Structured daemon failure, including partial terminate failures. */
  error: AgentGoalError | null;
}

/** Theme-aware leaf wrappers keep Goal controls off the global Unistyles hook. */
const ThemedPause = withUnistyles(Pause);
const ThemedPlay = withUnistyles(Play);
const ThemedPencil = withUnistyles(Pencil);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedSquare = withUnistyles(Square);
const ThemedTarget = withUnistyles(Target);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

/** Stable icon mapping for each Goal command. */
const GOAL_ACTION_ICONS: Record<GoalActionId, typeof ThemedPause> = {
  pause: ThemedPause,
  resume: ThemedPlay,
  edit: ThemedPencil,
  terminate: ThemedSquare,
  retry: ThemedRotateCw,
};

/** Theme mapping for ordinary Goal controls. */
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Theme mapping for the destructive Goal command. */
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

/** Theme mapping for the active Goal marker. */
const runningColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotRunning });

/** Translation key for each provider-neutral Goal state. */
const GOAL_STATUS_KEYS: Record<AgentGoalStatus, string> = {
  active: "goals.status.active",
  paused: "goals.status.paused",
  blocked: "goals.status.blocked",
  usageLimited: "goals.status.usageLimited",
  budgetLimited: "goals.status.budgetLimited",
  complete: "goals.status.complete",
};

/** Updates Goal fields in every store map that may own the Agent replica. */
function applyGoalProjectionToStore(
  serverId: string,
  agentId: string,
  projection: GoalProjection,
): void {
  const store = useSessionStore.getState();
  const updateAgent = (agents: Map<string, Agent>): Map<string, Agent> => {
    const current = agents.get(agentId);
    if (!current) return agents;
    const next = new Map(agents);
    next.set(agentId, applyGoalProjection(current, projection));
    return next;
  };
  store.setAgents(serverId, updateAgent);
  store.setAgentDetails(serverId, updateAgent);
}

/** Formats the provider Goal token and elapsed-time counters. */
function formatGoalUsage(goal: GoalPresentation["goal"], translate: GoalTranslate): string {
  const values = {
    used: formatTokenCount(goal.tokensUsed),
    time: formatDurationWithSeconds(goal.timeUsedSeconds * 1_000),
  };
  if (goal.tokenBudget === null) {
    return translate("goals.usage.withoutBudget", values);
  }
  return translate("goals.usage.withBudget", {
    ...values,
    budget: formatTokenCount(goal.tokenBudget),
  });
}

/** Selects the provider's preferred current-step wording. */
function currentStepText(agent: Pick<Agent, "goalStep">): string | null {
  if (!agent.goalStep) return null;
  return agent.goalStep.status === "in_progress" && agent.goalStep.activeForm
    ? agent.goalStep.activeForm
    : agent.goalStep.text;
}

/** Starts one non-editor Goal action through the shared daemon client. */
function requestGoalAction(
  client: DaemonClient,
  agentId: string,
  goal: AgentGoalSnapshot,
  action: GoalActionId,
): Promise<GoalActionResponse> | null {
  switch (action) {
    case "retry":
      return client.getAgentGoal(agentId);
    case "pause":
    case "resume":
      return client.updateAgentGoal(
        agentId,
        { kind: action },
        { expectedGeneration: goal.createdAt },
      );
    case "terminate":
      return client
        .terminateAgentGoal(agentId, { expectedGeneration: goal.createdAt })
        .then((response) => ({
          ok: response.ok,
          goal: response.goal,
          goalStep: response.goalStep,
          goalSync: "synced" as const,
          error: response.error,
        }));
    case "edit":
      return null;
  }
}

/** Returns localized validation copy for the paused Goal editor. */
function objectiveValidationError(
  reason: "empty" | "too_long" | null,
  translate: GoalTranslate,
): string | null {
  if (reason === "empty") {
    return translate("goals.editor.validation.empty");
  }
  if (reason === "too_long") {
    return translate("goals.editor.validation.tooLong", { max: "4000" });
  }
  return null;
}

/** Connected Goal control for one Agent composer. */
export function AgentGoalTrack({
  serverId,
  agentId,
}: {
  /** Host that owns the Agent. */
  serverId: string;
  /** Agent whose provider-owned Goal is controlled. */
  agentId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const state = useSessionStore(
    useShallow((store) => {
      const session = store.sessions[serverId];
      const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
      return {
        supported: session?.serverInfo?.features?.agentGoalControl === true,
        client: session?.client ?? null,
        goal: agent?.goal,
        goalStep: agent?.goalStep,
        goalSync: agent?.goalSync,
      };
    }),
  );
  const [pendingAction, setPendingAction] = useState<GoalActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorGoal, setEditorGoal] = useState<AgentGoalSnapshot | null>(null);
  const presentation = useMemo(
    () =>
      buildGoalPresentation({
        goal: state.goal,
        goalSync: state.goalSync,
        pendingAction,
      }),
    [pendingAction, state.goal, state.goalSync],
  );

  const handleAction = useCallback(
    (action: GoalActionId) => {
      if (!state.client || !state.goal || pendingAction) return;
      if (action === "edit") {
        if (state.goal.status !== "paused") return;
        setError(null);
        setEditorGoal(state.goal);
        return;
      }
      const request = requestGoalAction(state.client, agentId, state.goal, action);
      if (!request) return;
      setPendingAction(action);
      setError(null);
      void request
        .then((response) => {
          applyGoalProjectionToStore(serverId, agentId, {
            goal: response.goal,
            goalStep: response.goalStep,
            goalSync: response.goalSync,
          });
          const message = response.error?.message ?? null;
          setError(message);
          if (message) toast.error(message);
          return undefined;
        })
        .catch((cause: unknown) => {
          const message = t("goals.errors.actionFailed", { message: toErrorMessage(cause) });
          setError(message);
          toast.error(message);
        })
        .finally(() => setPendingAction(null));
    },
    [agentId, pendingAction, serverId, state.client, state.goal, t, toast],
  );

  const handleEditorClose = useCallback(() => {
    if (pendingAction) return;
    setEditorGoal(null);
  }, [pendingAction]);

  const handleObjectiveSubmit = useCallback(
    (objective: string) => {
      if (!state.client || !editorGoal || pendingAction) return;
      setPendingAction("edit");
      setError(null);
      void state.client
        .updateAgentGoal(
          agentId,
          { kind: "replace_objective", objective },
          { expectedGeneration: editorGoal.createdAt },
        )
        .then((response) => {
          applyGoalProjectionToStore(serverId, agentId, {
            goal: response.goal,
            goalStep: response.goalStep,
            goalSync: response.goalSync,
          });
          const message = response.error?.message ?? null;
          setError(message);
          if (message) {
            toast.error(message);
            return undefined;
          }
          if (response.ok) setEditorGoal(null);
          return undefined;
        })
        .catch((cause: unknown) => {
          const message = t("goals.errors.actionFailed", { message: toErrorMessage(cause) });
          setError(message);
          toast.error(message);
        })
        .finally(() => setPendingAction(null));
    },
    [agentId, editorGoal, pendingAction, serverId, state.client, t, toast],
  );

  const currentStep = currentStepText({ goalStep: state.goalStep });
  const labels = useMemo<GoalTrackLabels | null>(() => {
    if (!presentation) return null;
    return {
      track: t("goals.accessibility.track"),
      currentStep: currentStep ? t("goals.accessibility.currentStep", { step: currentStep }) : null,
      status: t(GOAL_STATUS_KEYS[presentation.goal.status]),
      usage: formatGoalUsage(presentation.goal, t),
      pause: t("goals.actions.pause"),
      resume: t("goals.actions.resume"),
      edit: t("goals.actions.edit"),
      terminate: t("goals.actions.terminate"),
      retry: t("goals.actions.retry"),
    };
  }, [currentStep, presentation, t]);

  if (
    !shouldShowAgentGoalTrack({ supported: state.supported, goal: state.goal }) ||
    !presentation ||
    !labels
  ) {
    return null;
  }

  return (
    <>
      <GoalTrackView
        presentation={presentation}
        currentStep={currentStep}
        labels={labels}
        error={error}
        onAction={handleAction}
      />
      {editorGoal ? (
        <GoalObjectiveEditor
          key={editorGoal.createdAt}
          goal={editorGoal}
          pending={pendingAction === "edit"}
          remoteError={error}
          onClose={handleEditorClose}
          onSubmit={handleObjectiveSubmit}
        />
      ) : null}
    </>
  );
}

/** Props for the fresh-mount paused Goal objective editor. */
interface GoalObjectiveEditorProps {
  /** Paused Goal snapshot that seeds the draft and generation guard. */
  goal: AgentGoalSnapshot;
  /** Whether the objective replacement RPC is in flight. */
  pending: boolean;
  /** Latest daemon or transport failure for this edit attempt. */
  remoteError: string | null;
  /** Closes the editor without changing the provider Goal. */
  onClose: () => void;
  /** Submits one locally validated and normalized objective. */
  onSubmit: (objective: string) => void;
}

/** Edits a paused Goal objective while making generation and usage reset explicit. */
function GoalObjectiveEditor({
  goal,
  pending,
  remoteError,
  onClose,
  onSubmit,
}: GoalObjectiveEditorProps): ReactElement {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const [draft, setDraft] = useState(goal.objective);
  const [validationReason, setValidationReason] = useState<"empty" | "too_long" | null>(null);
  const header = useMemo<SheetHeader>(() => ({ title: t("goals.editor.title") }), [t]);
  const validationError = objectiveValidationError(validationReason, t);

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    setValidationReason(null);
  }, []);

  const handleSubmit = useCallback(() => {
    const validation = validateGoalObjective(draft);
    if (!validation.ok) {
      setValidationReason(validation.reason);
      return;
    }
    setValidationReason(null);
    onSubmit(validation.objective);
  }, [draft, onSubmit]);

  const footer = useMemo(
    () => (
      <View style={styles.editorFooter}>
        <Button
          variant="secondary"
          size="md"
          style={styles.editorFooterButton}
          disabled={pending}
          onPress={onClose}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="md"
          style={styles.editorFooterButton}
          loading={pending}
          disabled={pending}
          testID="goal-editor-save"
          onPress={handleSubmit}
        >
          {t("goals.editor.save")}
        </Button>
      </View>
    ),
    [handleSubmit, onClose, pending, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={480}
      scrollable={false}
      testID="goal-editor"
    >
      <View style={styles.editorContent}>
        <Field label={t("goals.editor.objectiveLabel")} error={validationError ?? remoteError}>
          <FormTextInput
            size={size}
            initialValue={goal.objective}
            onChangeText={handleChange}
            accessibilityLabel={t("goals.editor.objectiveLabel")}
            editable={!pending}
            multiline
            autoFocus
            testID="goal-editor-objective"
          />
        </Field>
        <Text style={styles.editorWarning}>{t("goals.editor.resetWarning")}</Text>
      </View>
    </AdaptiveModalSheet>
  );
}

/** Renders the provider-owned Goal projection above the composer. */
export function GoalTrackView({
  presentation,
  currentStep,
  labels,
  error,
  onAction,
}: GoalTrackViewProps): ReactElement {
  return (
    <View style={styles.outer} accessibilityLabel={labels.track} testID="goal-track">
      <View style={styles.track}>
        <View style={styles.surface}>
          <View style={styles.row}>
            <ThemedTarget size={ICON_SIZE.sm} uniProps={runningColorMapping} aria-hidden />
            <View style={styles.content}>
              <View style={styles.titleRow}>
                <Text style={styles.objective} numberOfLines={1}>
                  {presentation.goal.objective}
                </Text>
                <Text style={styles.status} numberOfLines={1}>
                  {labels.status}
                </Text>
              </View>
              {currentStep ? (
                <Text
                  style={styles.step}
                  accessibilityLabel={labels.currentStep ?? undefined}
                  numberOfLines={1}
                >
                  {currentStep}
                </Text>
              ) : null}
              <Text style={styles.usage} numberOfLines={1}>
                {labels.usage}
              </Text>
            </View>
            <View style={styles.actions}>
              {presentation.actions.map((action) => (
                <GoalActionButton
                  key={action.id}
                  action={action}
                  label={labels[action.id]}
                  onAction={onAction}
                />
              ))}
            </View>
          </View>
          {error ? (
            <Text style={styles.error} numberOfLines={2} testID="goal-track-error">
              {error}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Renders one icon-only Goal command with a desktop tooltip. */
function GoalActionButton({
  action,
  label,
  onAction,
}: {
  /** Derived command visibility and availability. */
  action: GoalActionPresentation;
  /** Localized tooltip and accessibility copy. */
  label: string;
  /** Parent Goal command dispatcher. */
  onAction: (action: GoalActionId) => void;
}): ReactElement {
  const Icon = GOAL_ACTION_ICONS[action.id];
  const colorMapping = action.id === "terminate" ? destructiveColorMapping : mutedColorMapping;
  const handlePress = useCallback(() => onAction(action.id), [action.id, onAction]);

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild disabled={!action.enabled}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={`goal-action-${action.id}`}
          disabled={!action.enabled}
          hitSlop={8}
          style={styles.actionButton}
          onPress={handlePress}
        >
          {action.pending ? (
            <ThemedLoadingSpinner size="small" uniProps={colorMapping} />
          ) : (
            <Icon size={ICON_SIZE.sm} uniProps={colorMapping} />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  outer: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
  },
  track: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    marginBottom: -theme.spacing[4],
  },
  surface: {
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderBottomWidth: 0,
    borderTopLeftRadius: theme.borderRadius.lg,
    borderTopRightRadius: theme.borderRadius.lg,
    overflow: "hidden",
    paddingBottom: theme.spacing[4],
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  objective: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  status: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  step: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  usage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.spacing[1],
  },
  actionButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
  },
  error: {
    marginHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  editorContent: {
    gap: theme.spacing[3],
  },
  editorWarning: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  editorFooter: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  editorFooterButton: {
    flex: 1,
  },
  tooltip: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
