import type { AlertPayload } from "../alerts/alert-types.js";
import type { EvaluatedOpportunity } from "./opportunity-evaluator.js";

export type LiveOutputClass = "trader_critical" | "trader_helpful_optional" | "operator_only";

export type LiveThreadMessageKind = NonNullable<AlertPayload["metadata"]>["messageKind"] | "level_snapshot" | "level_extension";

export type FollowThroughStoryRecord = {
  eventType: string;
  label: string;
  entryPrice: number;
  postedAt: number;
  directionalReturnPct: number | null;
  storyKey: string;
};

export type AiSignalStoryRecord = {
  storyKey: string;
  reservedAt: number;
};

export type IntelligentAlertStoryRecord = {
  storyKey: string;
  zoneKey: string;
  eventType: string;
  severity?: string;
  score?: number;
  triggerPrice: number;
  postedAt: number;
};

export type LiveThreadRuntimePostKind =
  | "snapshot"
  | "extension"
  | "intelligent_alert"
  | "follow_through"
  | "continuity"
  | "follow_through_state"
  | "recap"
  | "ai_signal_commentary";

export type OptionalLivePostKind = "continuity" | "follow_through_state" | "recap";

export type NarrationBurstKind = OptionalLivePostKind | "follow_through";

export type CriticalLivePostKind = "intelligent_alert" | "follow_through";

export type LiveThreadPostRecord = {
  kind: LiveThreadRuntimePostKind;
  timestamp: number;
  eventType: string | null;
};

export type NarrationBurstRecord = {
  kind: NarrationBurstKind;
  eventType: string | null;
  timestamp: number;
};

export type FollowThroughPostDecision = {
  shouldPost: boolean;
  reason:
    | "new_story"
    | "minor_initial_move"
    | "repeat_cooldown"
    | "weak_label_transition"
    | "not_materially_new"
    | "materially_new";
  storyKey: string;
};

export type IntelligentAlertPostDecision = {
  shouldPost: boolean;
  reason:
    | "new_story"
    | "same_story_cooldown"
    | "zone_chop"
    | "material_escalation";
  storyKey: string;
  zoneKey: string;
};

export type CriticalLivePostDecision = {
  shouldPost: boolean;
  reason: "allowed" | "critical_burst" | "critical_kind_burst";
};

export type AiSignalPostDecision = {
  shouldPost: boolean;
  reason: "new_story" | "in_flight_or_recent_story" | "recent_symbol_ai" | "low_value_repeat";
  storyKey: string;
};

export type OptionalLivePostDecision = {
  shouldPost: boolean;
  reason:
    | "allowed"
    | "delivery_backoff"
    | "reactive_same_event_overlap"
    | "follow_through_state_after_continuity"
    | "continuity_after_follow_through_state"
    | "optional_density"
    | "optional_kind_density"
    | "optional_lead"
    | "reactive_recap"
    | "reactive_kind_repeat"
    | "fragile_optional_density"
    | "recap_density"
    | "recap_kind_density"
    | "continuity_kind_density"
    | "minor_continuity"
    | "non_directional_continuity_density"
    | "follow_through_state_kind_density"
    | "non_directional_follow_through_state_density"
    | "minor_follow_through_state"
    | "stalling_follow_through_state";
};

export type NarrationBurstDecision = {
  shouldPost: boolean;
  reason: "allowed" | "burst_limit" | "recap_burst" | "kind_cooldown";
};

export type LiveThreadPostingProfile = "quiet" | "balanced" | "active";

export type LiveThreadPostingPolicySettings = {
  profile: LiveThreadPostingProfile;
  followThroughRepeatCooldownMs: number;
  followThroughStoryWindowMs: number;
  intelligentAlertStoryWindowMs: number;
  intelligentAlertSameStoryCooldownMs: number;
  intelligentAlertZoneChopWindowMs: number;
  aiSignalStoryWindowMs: number;
  aiSignalSymbolWindowMs: number;
  materialFollowThroughDeltaPct: number;
  minInitialFollowThroughMovePct: number;
  minInitialFailedFollowThroughMovePct: number;
  materialAlertScoreEscalation: number;
  materialZoneReversalMovePct: number;
  criticalBurstWindowMs: number;
  criticalExtendedBurstWindowMs: number;
  criticalBurstLimit: number;
  criticalExtendedBurstLimit: number;
  followThroughKindBurstLimit: number;
  aiHighConfidenceMinScore: number;
  aiAlwaysPostMinScore: number;
  allowMinorContinuity: boolean;
  optionalLivePostDensityLimit: number;
  optionalLivePostKindLimit: number;
  minFollowThroughStateMovePct: number;
};

const FOLLOW_THROUGH_REPEAT_COOLDOWN_MS = 5 * 60 * 1000;
const FOLLOW_THROUGH_STORY_WINDOW_MS = 30 * 60 * 1000;
const INTELLIGENT_ALERT_STORY_WINDOW_MS = 30 * 60 * 1000;
const INTELLIGENT_ALERT_SAME_STORY_COOLDOWN_MS = 20 * 60 * 1000;
const INTELLIGENT_ALERT_ZONE_CHOP_WINDOW_MS = 5 * 60 * 1000;
const AI_SIGNAL_STORY_WINDOW_MS = 20 * 60 * 1000;
const AI_SIGNAL_SYMBOL_WINDOW_MS = 10 * 60 * 1000;
const SAME_STORY_LEVEL_PCT = 0.006;
const SAME_STORY_LEVEL_ABSOLUTE = 0.02;
const MATERIAL_FOLLOW_THROUGH_DELTA_PCT = 2;
const MIN_INITIAL_FOLLOW_THROUGH_MOVE_PCT = 1.25;
const MIN_INITIAL_FAILED_FOLLOW_THROUGH_MOVE_PCT = 1;
const MATERIAL_ALERT_SCORE_ESCALATION = 15;
const MATERIAL_ZONE_REVERSAL_MOVE_PCT = 1.25;
const CRITICAL_BURST_WINDOW_MS = 5 * 60 * 1000;
const CRITICAL_EXTENDED_BURST_WINDOW_MS = 10 * 60 * 1000;
const CRITICAL_BURST_LIMIT = 5;
const CRITICAL_EXTENDED_BURST_LIMIT = 8;
const FOLLOW_THROUGH_KIND_BURST_LIMIT = 2;
const MIN_FOLLOW_THROUGH_STATE_MOVE_PCT = 1;

const BASE_POSTING_POLICY_SETTINGS: LiveThreadPostingPolicySettings = {
  profile: "balanced",
  followThroughRepeatCooldownMs: FOLLOW_THROUGH_REPEAT_COOLDOWN_MS,
  followThroughStoryWindowMs: FOLLOW_THROUGH_STORY_WINDOW_MS,
  intelligentAlertStoryWindowMs: INTELLIGENT_ALERT_STORY_WINDOW_MS,
  intelligentAlertSameStoryCooldownMs: INTELLIGENT_ALERT_SAME_STORY_COOLDOWN_MS,
  intelligentAlertZoneChopWindowMs: INTELLIGENT_ALERT_ZONE_CHOP_WINDOW_MS,
  aiSignalStoryWindowMs: AI_SIGNAL_STORY_WINDOW_MS,
  aiSignalSymbolWindowMs: AI_SIGNAL_SYMBOL_WINDOW_MS,
  materialFollowThroughDeltaPct: MATERIAL_FOLLOW_THROUGH_DELTA_PCT,
  minInitialFollowThroughMovePct: MIN_INITIAL_FOLLOW_THROUGH_MOVE_PCT,
  minInitialFailedFollowThroughMovePct: MIN_INITIAL_FAILED_FOLLOW_THROUGH_MOVE_PCT,
  materialAlertScoreEscalation: MATERIAL_ALERT_SCORE_ESCALATION,
  materialZoneReversalMovePct: MATERIAL_ZONE_REVERSAL_MOVE_PCT,
  criticalBurstWindowMs: CRITICAL_BURST_WINDOW_MS,
  criticalExtendedBurstWindowMs: CRITICAL_EXTENDED_BURST_WINDOW_MS,
  criticalBurstLimit: CRITICAL_BURST_LIMIT,
  criticalExtendedBurstLimit: CRITICAL_EXTENDED_BURST_LIMIT,
  followThroughKindBurstLimit: FOLLOW_THROUGH_KIND_BURST_LIMIT,
  aiHighConfidenceMinScore: 60,
  aiAlwaysPostMinScore: 65,
  allowMinorContinuity: false,
  optionalLivePostDensityLimit: 1,
  optionalLivePostKindLimit: 1,
  minFollowThroughStateMovePct: MIN_FOLLOW_THROUGH_STATE_MOVE_PCT,
};

export function resolveLiveThreadPostingProfile(input?: string | null): LiveThreadPostingProfile {
  const normalized = input?.trim().toLowerCase();
  if (normalized === "quiet" || normalized === "active" || normalized === "balanced") {
    return normalized;
  }

  return "balanced";
}

export function getLiveThreadPostingPolicySettings(
  profileInput?: LiveThreadPostingProfile | string | null,
): LiveThreadPostingPolicySettings {
  const profile = resolveLiveThreadPostingProfile(profileInput);
  if (profile === "quiet") {
    return {
      ...BASE_POSTING_POLICY_SETTINGS,
      profile,
      intelligentAlertSameStoryCooldownMs: 30 * 60 * 1000,
      intelligentAlertZoneChopWindowMs: 8 * 60 * 1000,
      materialAlertScoreEscalation: 20,
      materialZoneReversalMovePct: 1.75,
      minInitialFollowThroughMovePct: 1.75,
      minInitialFailedFollowThroughMovePct: 1.25,
      materialFollowThroughDeltaPct: 2.75,
      criticalBurstLimit: 4,
      criticalExtendedBurstLimit: 6,
      followThroughKindBurstLimit: 2,
      aiHighConfidenceMinScore: 68,
      aiAlwaysPostMinScore: 72,
      minFollowThroughStateMovePct: 1.5,
    };
  }

  if (profile === "active") {
    return {
      ...BASE_POSTING_POLICY_SETTINGS,
      profile,
      intelligentAlertSameStoryCooldownMs: 10 * 60 * 1000,
      intelligentAlertZoneChopWindowMs: 3 * 60 * 1000,
      materialAlertScoreEscalation: 10,
      materialZoneReversalMovePct: 0.75,
      minInitialFollowThroughMovePct: 0.75,
      minInitialFailedFollowThroughMovePct: 0.65,
      materialFollowThroughDeltaPct: 1.25,
      criticalBurstLimit: 7,
      criticalExtendedBurstLimit: 10,
      followThroughKindBurstLimit: 4,
      aiHighConfidenceMinScore: 52,
      aiAlwaysPostMinScore: 58,
      allowMinorContinuity: true,
      optionalLivePostDensityLimit: 2,
      minFollowThroughStateMovePct: 0.75,
    };
  }

  return BASE_POSTING_POLICY_SETTINGS;
}

export function classifyLiveThreadMessage(kind: LiveThreadMessageKind | undefined): LiveOutputClass {
  switch (kind) {
    case "intelligent_alert":
    case "level_clear_update":
    case "follow_through_update":
    case "level_snapshot":
    case "level_extension":
      return "trader_critical";
    case "continuity_update":
    case "follow_through_state_update":
    case "symbol_recap":
    case "ai_signal_commentary":
      return "trader_helpful_optional";
    default:
      return "operator_only";
  }
}

export function sameStoryLevelTolerance(price: number): number {
  return Math.max(Math.abs(price) * SAME_STORY_LEVEL_PCT, SAME_STORY_LEVEL_ABSOLUTE);
}

export function formatPolicyLevel(price: number): string {
  if (!Number.isFinite(price)) {
    return "unknown";
  }

  const tolerance = sameStoryLevelTolerance(price);
  const bucket = Math.round(price / tolerance) * tolerance;
  return bucket >= 1 ? bucket.toFixed(2) : bucket.toFixed(4);
}

export function buildFollowThroughStoryKey(evaluation: Pick<EvaluatedOpportunity, "eventType" | "entryPrice">): string {
  return `${evaluation.eventType}|${formatPolicyLevel(evaluation.entryPrice)}`;
}

export function buildIntelligentAlertStoryKey(params: { eventType: string; level: number }): string {
  return `${params.eventType}|${formatPolicyLevel(params.level)}`;
}

export function buildIntelligentAlertZoneKey(params: { level: number }): string {
  return formatPolicyLevel(params.level);
}

export function pruneFollowThroughStoryRecords(
  records: FollowThroughStoryRecord[],
  timestamp: number,
  settings: LiveThreadPostingPolicySettings = getLiveThreadPostingPolicySettings(),
): FollowThroughStoryRecord[] {
  return records.filter((record) => timestamp - record.postedAt <= settings.followThroughStoryWindowMs);
}

function isMaterialFollowThroughChange(
  previous: FollowThroughStoryRecord,
  evaluation: Pick<EvaluatedOpportunity, "followThroughLabel" | "directionalReturnPct">,
  settings: LiveThreadPostingPolicySettings,
): boolean {
  if (previous.label !== evaluation.followThroughLabel) {
    return true;
  }

  if (previous.directionalReturnPct === null || evaluation.directionalReturnPct === null) {
    return false;
  }

  return Math.abs(evaluation.directionalReturnPct - previous.directionalReturnPct) >= settings.materialFollowThroughDeltaPct;
}

function isMinorInitialFollowThroughMove(
  evaluation: Pick<EvaluatedOpportunity, "followThroughLabel" | "directionalReturnPct">,
  settings: LiveThreadPostingPolicySettings,
): boolean {
  if (evaluation.followThroughLabel === "strong") {
    return false;
  }

  if (evaluation.directionalReturnPct === null) {
    return true;
  }

  const threshold =
    evaluation.followThroughLabel === "failed"
      ? settings.minInitialFailedFollowThroughMovePct
      : settings.minInitialFollowThroughMovePct;
  return Math.abs(evaluation.directionalReturnPct) < threshold;
}

function isMeaningfulFollowThroughTransition(previousLabel: string, nextLabel: string): boolean {
  if (previousLabel === nextLabel) {
    return true;
  }

  if (previousLabel === "unknown") {
    return true;
  }

  const transition = `${previousLabel}->${nextLabel}`;
  return [
    "working->strong",
    "working->failed",
    "stalled->working",
    "stalled->strong",
    "stalled->failed",
    "failed->working",
    "failed->strong",
    "strong->failed",
    "strong->stalled",
  ].includes(transition);
}

export function decideFollowThroughPost(params: {
  records: FollowThroughStoryRecord[];
  evaluation: EvaluatedOpportunity;
  settings?: LiveThreadPostingPolicySettings;
}): FollowThroughPostDecision {
  const settings = params.settings ?? getLiveThreadPostingPolicySettings();
  const storyKey = buildFollowThroughStoryKey(params.evaluation);
  const matching = params.records
    .filter((record) => record.storyKey === storyKey)
    .sort((left, right) => right.postedAt - left.postedAt);
  const latestSameLabel = matching.find(
    (record) =>
      record.eventType === params.evaluation.eventType &&
      record.label === params.evaluation.followThroughLabel,
  );
  const latestSameStory = matching[0];

  if (
    latestSameStory &&
    !isMeaningfulFollowThroughTransition(latestSameStory.label, params.evaluation.followThroughLabel)
  ) {
    return {
      shouldPost: false,
      reason: "weak_label_transition",
      storyKey,
    };
  }

  if (!latestSameLabel) {
    if (isMinorInitialFollowThroughMove(params.evaluation, settings)) {
      return {
        shouldPost: false,
        reason: "minor_initial_move",
        storyKey,
      };
    }

    return {
      shouldPost: true,
      reason: "new_story",
      storyKey,
    };
  }

  if (params.evaluation.evaluatedAt - latestSameLabel.postedAt <= settings.followThroughRepeatCooldownMs) {
    return {
      shouldPost: false,
      reason: "repeat_cooldown",
      storyKey,
    };
  }

  if (!isMaterialFollowThroughChange(latestSameLabel, params.evaluation, settings)) {
    return {
      shouldPost: false,
      reason: "not_materially_new",
      storyKey,
    };
  }

  return {
    shouldPost: true,
    reason: "materially_new",
    storyKey,
  };
}

function severityRank(severity?: string): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

export function pruneIntelligentAlertStoryRecords(
  records: IntelligentAlertStoryRecord[],
  timestamp: number,
  settings: LiveThreadPostingPolicySettings = getLiveThreadPostingPolicySettings(),
): IntelligentAlertStoryRecord[] {
  return records.filter((record) => timestamp - record.postedAt <= settings.intelligentAlertStoryWindowMs);
}

export function decideIntelligentAlertPost(params: {
  records: IntelligentAlertStoryRecord[];
  timestamp: number;
  eventType: string;
  level: number;
  triggerPrice: number;
  severity?: string;
  score?: number;
  settings?: LiveThreadPostingPolicySettings;
}): IntelligentAlertPostDecision {
  const settings = params.settings ?? getLiveThreadPostingPolicySettings();
  const storyKey = buildIntelligentAlertStoryKey(params);
  const zoneKey = buildIntelligentAlertZoneKey(params);
  const matchingStory = params.records
    .filter((record) => record.storyKey === storyKey)
    .sort((left, right) => right.postedAt - left.postedAt)[0];

  if (matchingStory && params.timestamp - matchingStory.postedAt <= settings.intelligentAlertSameStoryCooldownMs) {
    const scoreEscalated =
      typeof params.score === "number" &&
      typeof matchingStory.score === "number" &&
      params.score - matchingStory.score >= settings.materialAlertScoreEscalation;
    const severityEscalated = severityRank(params.severity) > severityRank(matchingStory.severity);
    if (scoreEscalated || severityEscalated) {
      return { shouldPost: true, reason: "material_escalation", storyKey, zoneKey };
    }

    return { shouldPost: false, reason: "same_story_cooldown", storyKey, zoneKey };
  }

  const recentZone = params.records
    .filter(
      (record) =>
        record.zoneKey === zoneKey &&
        params.timestamp - record.postedAt <= settings.intelligentAlertZoneChopWindowMs,
    )
    .sort((left, right) => right.postedAt - left.postedAt)[0];
  if (recentZone && recentZone.eventType !== params.eventType) {
    const movePct = Math.abs((params.triggerPrice - recentZone.triggerPrice) / recentZone.triggerPrice);
    if (movePct < settings.materialZoneReversalMovePct / 100) {
      return { shouldPost: false, reason: "zone_chop", storyKey, zoneKey };
    }
  }

  return { shouldPost: true, reason: "new_story", storyKey, zoneKey };
}

export function buildIntelligentAlertStoryRecord(params: {
  timestamp: number;
  eventType: string;
  level: number;
  triggerPrice: number;
  severity?: string;
  score?: number;
}): IntelligentAlertStoryRecord {
  return {
    storyKey: buildIntelligentAlertStoryKey(params),
    zoneKey: buildIntelligentAlertZoneKey(params),
    eventType: params.eventType,
    severity: params.severity,
    score: params.score,
    triggerPrice: params.triggerPrice,
    postedAt: params.timestamp,
  };
}

export function decideCriticalLivePost(params: {
  criticalPosts: LiveThreadPostRecord[];
  timestamp: number;
  kind: CriticalLivePostKind;
  eventType?: string | null;
  majorChange: boolean;
  settings?: LiveThreadPostingPolicySettings;
}): CriticalLivePostDecision {
  const settings = params.settings ?? getLiveThreadPostingPolicySettings();
  if (params.majorChange) {
    return { shouldPost: true, reason: "allowed" };
  }

  const recentCritical = params.criticalPosts.filter(
    (entry) => params.timestamp - entry.timestamp >= 0 && params.timestamp - entry.timestamp <= settings.criticalBurstWindowMs,
  );
  const extendedCritical = params.criticalPosts.filter(
    (entry) =>
      params.timestamp - entry.timestamp >= 0 &&
      params.timestamp - entry.timestamp <= settings.criticalExtendedBurstWindowMs,
  );

  if (recentCritical.length >= settings.criticalBurstLimit || extendedCritical.length >= settings.criticalExtendedBurstLimit) {
    return { shouldPost: false, reason: "critical_burst" };
  }

  const recentKind = recentCritical.filter((entry) => entry.kind === params.kind);
  if (params.kind === "follow_through" && recentKind.length >= settings.followThroughKindBurstLimit) {
    return { shouldPost: false, reason: "critical_kind_burst" };
  }

  return { shouldPost: true, reason: "allowed" };
}

export function buildFollowThroughStoryRecord(evaluation: EvaluatedOpportunity): FollowThroughStoryRecord {
  return {
    eventType: evaluation.eventType,
    label: evaluation.followThroughLabel,
    entryPrice: evaluation.entryPrice,
    postedAt: evaluation.evaluatedAt,
    directionalReturnPct: evaluation.directionalReturnPct,
    storyKey: buildFollowThroughStoryKey(evaluation),
  };
}

export function buildAiSignalStoryKey(params: {
  symbol: string;
  eventType: string;
  level?: number;
  title?: string;
}): string {
  const levelPart = typeof params.level === "number" && Number.isFinite(params.level)
    ? formatPolicyLevel(params.level)
    : "unknown";
  const titlePart = (params.title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 80);
  return `${params.symbol.toUpperCase()}|${params.eventType}|${levelPart}|${titlePart}`;
}

export function pruneAiSignalStoryRecords(
  records: AiSignalStoryRecord[],
  timestamp: number,
  settings: LiveThreadPostingPolicySettings = getLiveThreadPostingPolicySettings(),
): AiSignalStoryRecord[] {
  return records.filter((record) => timestamp - record.reservedAt <= settings.aiSignalStoryWindowMs);
}

export function decideAiSignalPost(params: {
  records: AiSignalStoryRecord[];
  symbolAiRecords: AiSignalStoryRecord[];
  timestamp: number;
  storyKey: string;
  severity?: string;
  confidence?: string;
  score?: number;
  settings?: LiveThreadPostingPolicySettings;
}): AiSignalPostDecision {
  const settings = params.settings ?? getLiveThreadPostingPolicySettings();
  if (
    params.records.some(
      (record) => record.storyKey === params.storyKey && params.timestamp - record.reservedAt <= settings.aiSignalStoryWindowMs,
    )
  ) {
    return {
      shouldPost: false,
      reason: "in_flight_or_recent_story",
      storyKey: params.storyKey,
    };
  }

  const recentSymbolAi = params.symbolAiRecords.some(
    (record) => params.timestamp - record.reservedAt <= settings.aiSignalSymbolWindowMs,
  );
  if (recentSymbolAi) {
    return {
      shouldPost: false,
      reason: "recent_symbol_ai",
      storyKey: params.storyKey,
    };
  }

  const highValue =
    params.severity === "critical" ||
    (params.severity === "high" && params.confidence === "high" && typeof params.score === "number" && params.score >= settings.aiHighConfidenceMinScore) ||
    (typeof params.score === "number" && params.score >= settings.aiAlwaysPostMinScore);
  if (!highValue) {
    return {
      shouldPost: false,
      reason: "low_value_repeat",
      storyKey: params.storyKey,
    };
  }

  return {
    shouldPost: true,
    reason: "new_story",
    storyKey: params.storyKey,
  };
}

function isReactiveEvent(eventType: string | null | undefined): boolean {
  return eventType !== undefined && eventType !== null && ["level_touch", "compression"].includes(eventType);
}

function isFragileDirectionalEvent(eventType: string | null | undefined): boolean {
  return (
    eventType !== undefined &&
    eventType !== null &&
    ["fake_breakout", "fake_breakdown", "rejection"].includes(eventType)
  );
}

function isTrendDirectionalEvent(eventType: string | null | undefined): boolean {
  return eventType !== undefined && eventType !== null && ["breakout", "breakdown", "reclaim"].includes(eventType);
}

export function decideNarrationBurst(params: {
  state: NarrationBurstRecord[];
  timestamp: number;
  kind: NarrationBurstKind;
  eventType?: string | null;
  narrationBurstWindowMs: number;
  recapBurstWindowMs: number;
  continuityCooldownMs: number;
  settings?: LiveThreadPostingPolicySettings;
}): NarrationBurstDecision {
  const state = params.state.filter((entry) => params.timestamp - entry.timestamp <= params.narrationBurstWindowMs);
  const recentKind = state.filter((entry) => entry.kind === params.kind);
  const burstLimit = isReactiveEvent(params.eventType) || isFragileDirectionalEvent(params.eventType) ? 2 : 3;

  if (state.length >= burstLimit) {
    return { shouldPost: false, reason: "burst_limit" };
  }

  if (
    params.kind === "recap" &&
    state.some((entry) => params.timestamp - entry.timestamp <= params.recapBurstWindowMs)
  ) {
    return { shouldPost: false, reason: "recap_burst" };
  }

  if (
    params.kind !== "continuity" &&
    recentKind.length >= 1 &&
    recentKind.some((entry) => params.timestamp - entry.timestamp <= params.continuityCooldownMs)
  ) {
    return { shouldPost: false, reason: "kind_cooldown" };
  }

  return { shouldPost: true, reason: "allowed" };
}

export function decideOptionalLivePost(params: {
  criticalPosts: LiveThreadPostRecord[];
  optionalPosts: LiveThreadPostRecord[];
  narrationAttempts: NarrationBurstRecord[];
  timestamp: number;
  kind: OptionalLivePostKind;
  majorChange: boolean;
  eventType?: string | null;
  progressLabel?: "improving" | "stalling" | "degrading" | null;
  directionalReturnPct?: number | null;
  deliveryBackoffActive: boolean;
  optionalDensityLimit: number;
  optionalKindLimit: number;
  continuityCooldownMs: number;
  continuityMajorTransitionCooldownMs: number;
  narrationBurstWindowMs: number;
  settings?: LiveThreadPostingPolicySettings;
}): OptionalLivePostDecision {
  const settings = params.settings ?? getLiveThreadPostingPolicySettings();
  const recentCritical = params.criticalPosts.length;
  const recentOptional = params.optionalPosts.length;
  const recentKind = params.optionalPosts.filter((entry) => entry.kind === params.kind).length;
  const lastCriticalAt = params.criticalPosts.at(-1)?.timestamp ?? null;
  const recentCriticalAge =
    lastCriticalAt === null ? Number.POSITIVE_INFINITY : params.timestamp - lastCriticalAt;
  const optionalLead = recentOptional - recentCritical;
  const reactiveEvent = isReactiveEvent(params.eventType);
  const fragileDirectionalEvent = isFragileDirectionalEvent(params.eventType);
  const trendDirectionalEvent = isTrendDirectionalEvent(params.eventType);
  const recentSameEventOptional = params.optionalPosts.filter(
    (entry) =>
      entry.eventType !== null &&
      entry.eventType === (params.eventType ?? null) &&
      params.timestamp - entry.timestamp <= params.narrationBurstWindowMs,
  );
  const recentSameEventContinuity = recentSameEventOptional.filter((entry) => entry.kind === "continuity").length;
  const recentSameEventFollowThroughState = recentSameEventOptional.filter(
    (entry) => entry.kind === "follow_through_state",
  ).length;
  const recentSameEventOptionalAttempts = params.narrationAttempts.filter(
    (entry) =>
      entry.eventType !== null &&
      entry.eventType === (params.eventType ?? null) &&
      (entry.kind === "continuity" || entry.kind === "follow_through_state" || entry.kind === "recap"),
  );
  const recentSameEventContinuityAttempts = recentSameEventOptionalAttempts.filter(
    (entry) => entry.kind === "continuity",
  ).length;
  const recentSameEventFollowThroughStateAttempts = recentSameEventOptionalAttempts.filter(
    (entry) => entry.kind === "follow_through_state",
  ).length;

  if (params.deliveryBackoffActive) {
    return { shouldPost: false, reason: "delivery_backoff" };
  }

  if (params.kind === "continuity" && !params.majorChange && !settings.allowMinorContinuity) {
    return { shouldPost: false, reason: "minor_continuity" };
  }

  if (
    (reactiveEvent || fragileDirectionalEvent) &&
    (recentSameEventOptional.length >= 1 || recentSameEventOptionalAttempts.length >= 1)
  ) {
    return { shouldPost: false, reason: "reactive_same_event_overlap" };
  }

  if (params.kind === "follow_through_state" && !params.majorChange) {
    if (params.progressLabel === "stalling") {
      return { shouldPost: false, reason: "stalling_follow_through_state" };
    }

    if (
      params.directionalReturnPct === null ||
      params.directionalReturnPct === undefined ||
      Math.abs(params.directionalReturnPct) < settings.minFollowThroughStateMovePct
    ) {
      return { shouldPost: false, reason: "minor_follow_through_state" };
    }
  }

  if (
    params.kind === "follow_through_state" &&
    (recentSameEventContinuity >= 1 || recentSameEventContinuityAttempts >= 1)
  ) {
    return { shouldPost: false, reason: "follow_through_state_after_continuity" };
  }

  if (
    params.kind === "continuity" &&
    (recentSameEventFollowThroughState >= 1 || recentSameEventFollowThroughStateAttempts >= 1)
  ) {
    return { shouldPost: false, reason: "continuity_after_follow_through_state" };
  }

  if (recentOptional >= params.optionalDensityLimit && recentCriticalAge > params.continuityCooldownMs) {
    return { shouldPost: false, reason: "optional_density" };
  }

  if (recentKind >= params.optionalKindLimit && recentCriticalAge > params.continuityCooldownMs) {
    return { shouldPost: false, reason: "optional_kind_density" };
  }

  if (optionalLead >= 2 && recentCriticalAge > params.continuityCooldownMs) {
    return { shouldPost: false, reason: "optional_lead" };
  }

  if ((reactiveEvent || fragileDirectionalEvent) && params.kind === "recap") {
    return { shouldPost: false, reason: "reactive_recap" };
  }

  if ((reactiveEvent || fragileDirectionalEvent) && params.kind === "continuity" && recentKind >= 1) {
    return { shouldPost: false, reason: "reactive_kind_repeat" };
  }

  if ((reactiveEvent || fragileDirectionalEvent) && params.kind === "follow_through_state" && recentKind >= 1) {
    return { shouldPost: false, reason: "reactive_kind_repeat" };
  }

  if (fragileDirectionalEvent && recentOptional >= 2 && recentCriticalAge > params.continuityCooldownMs) {
    return { shouldPost: false, reason: "fragile_optional_density" };
  }

  if (
    params.kind === "recap" &&
    recentOptional >= 2 &&
    recentCriticalAge > params.continuityMajorTransitionCooldownMs
  ) {
    return { shouldPost: false, reason: "recap_density" };
  }

  if (
    params.kind === "recap" &&
    recentKind >= 1 &&
    optionalLead >= 1 &&
    recentCriticalAge > params.continuityCooldownMs
  ) {
    return { shouldPost: false, reason: "recap_kind_density" };
  }

  if (
    params.kind === "continuity" &&
    recentKind >= 2 &&
    optionalLead >= 1 &&
    recentCriticalAge > params.continuityCooldownMs
  ) {
    return { shouldPost: false, reason: "continuity_kind_density" };
  }

  if (
    params.kind === "continuity" &&
    !trendDirectionalEvent &&
    recentOptional >= 2 &&
    recentCriticalAge > params.continuityCooldownMs
  ) {
    return { shouldPost: false, reason: "non_directional_continuity_density" };
  }

  if (
    params.kind === "follow_through_state" &&
    recentKind >= 1 &&
    optionalLead >= 1 &&
    recentCriticalAge > params.continuityCooldownMs
  ) {
    return { shouldPost: false, reason: "follow_through_state_kind_density" };
  }

  if (params.kind === "follow_through_state" && !trendDirectionalEvent && recentOptional >= 2) {
    return { shouldPost: false, reason: "non_directional_follow_through_state_density" };
  }

  return { shouldPost: true, reason: "allowed" };
}
