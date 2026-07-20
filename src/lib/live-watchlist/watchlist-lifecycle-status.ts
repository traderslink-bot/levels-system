import type { TechnicalContextConfidence } from "../technical-context/technical-context-types.js";
import type {
  LiveWatchlistLifecycleRead,
  LiveWatchlistLevelMap,
  LiveWatchlistLevelMapLevel,
} from "./live-watchlist-types.js";
import type {
  LiveWatchlistPullbackReadPhase,
  LiveWatchlistPullbackVolumeLabel,
} from "./pullback-read.js";

const MAX_STRUCTURE_AGE_MS = 20 * 60 * 1_000;
const MIN_HIGH_QUALITY_PULLBACK_FROM_HOD_PCT = 0.1;
const MIN_ORDINARY_PULLBACK_FROM_HOD_PCT = 0.15;
const MIN_PULLBACK_FROM_HOD_ATR = 2;
const MAX_PULLBACK_ZONE_DISTANCE_ATR = 0.35;
const LIQUID_VOLUME_LABELS = new Set<LiveWatchlistPullbackVolumeLabel>([
  "strong",
  "expanding",
  "normal",
]);
const FADING_VOLUME_LABELS = new Set<LiveWatchlistPullbackVolumeLabel>(["thin", "fading"]);
const RECOVERY_ATTEMPT_STRUCTURE_STATES = new Set(["reclaim_attempt", "reclaim_confirmed"]);
const BROKEN_STRUCTURE_STATES = new Set(["pivot_lost", "trend_damaged", "failed_breakout"]);

export type LiveWatchlistLifecycleEvidence = {
  evaluatedAt: number;
  structureUpdatedAt: number | null;
  phase: LiveWatchlistPullbackReadPhase | null;
  technicalConfidence: TechnicalContextConfidence | null;
  volumeLabel: LiveWatchlistPullbackVolumeLabel;
  levelMap: LiveWatchlistLevelMap | null;
  tradeSetupState?: string | null;
  tradeSetupStateBeforeBlockers?: string | null;
  stableFiveMinuteState?: string | null;
};

function read(
  status: LiveWatchlistLifecycleRead["status"],
  label: LiveWatchlistLifecycleRead["label"],
  reason: string,
  updatedAt: number,
): LiveWatchlistLifecycleRead {
  return { status, label, reason, updatedAt };
}

function hasMappedSupport(levelMap: LiveWatchlistLevelMap | null): boolean {
  if (!levelMap) return false;
  return levelMap.supportLevels.some((level) => level.price < levelMap.currentPrice) ||
    (levelMap.nearestSupport?.price ?? Number.POSITIVE_INFINITY) < levelMap.currentPrice;
}

function strengthRank(value: LiveWatchlistLevelMapLevel["strengthLabel"]): number {
  if (value === "major") return 4;
  if (value === "strong") return 3;
  if (value === "moderate") return 2;
  if (value === "weak") return 1;
  return 0;
}

function isQualifiedPullbackSupport(level: LiveWatchlistLevelMapLevel): boolean {
  if (
    level.side !== "support" ||
    level.roleFlipState === "testing" ||
    strengthRank(level.strengthLabel) < strengthRank("moderate")
  ) {
    return false;
  }
  return (
    strengthRank(level.strengthLabel) >= strengthRank("strong") ||
    /daily|4h|confluence|structure|opening range|session low|gap floor/i.test(level.sourceLabel ?? "")
  );
}

function minimumPullbackFromHighPct(level: LiveWatchlistLevelMapLevel): number {
  return strengthRank(level.strengthLabel) >= strengthRank("strong")
    ? MIN_HIGH_QUALITY_PULLBACK_FROM_HOD_PCT
    : MIN_ORDINARY_PULLBACK_FROM_HOD_PCT;
}

function pullbackQualificationReason(
  levelMap: LiveWatchlistLevelMap | null,
  stableFiveMinuteState: string | null | undefined,
): string | null {
  if (stableFiveMinuteState !== "pullback_to_structure") {
    return "Momentum has cooled, but confirmed five-minute structure is not yet testing a pullback area.";
  }
  if (!levelMap) {
    return "Momentum has cooled, but a valid structural pullback area is not yet confirmed.";
  }

  const currentPrice = levelMap.currentPrice;
  const atr = levelMap.volatilityContext?.atr;
  const highOfDay = levelMap.referenceLevels?.find((level) => level.key === "hod")?.price;
  if (
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0 ||
    typeof atr !== "number" ||
    !Number.isFinite(atr) ||
    atr <= 0 ||
    typeof highOfDay !== "number" ||
    !Number.isFinite(highOfDay) ||
    highOfDay <= currentPrice
  ) {
    return "Waiting for reliable high-of-day and five-minute ATR context before confirming a pullback area.";
  }

  const testedSupport = levelMap.supportLevels.find((level) =>
    level.price < currentPrice &&
    typeof level.distanceAtr === "number" &&
    Number.isFinite(level.distanceAtr) &&
    level.distanceAtr <= MAX_PULLBACK_ZONE_DISTANCE_ATR &&
    isQualifiedPullbackSupport(level),
  );
  if (!testedSupport) {
    return "Price is not yet testing a qualified structural pullback area; nearby support alone is not enough.";
  }

  const retreatFromHighPct = (highOfDay - currentPrice) / highOfDay;
  const retreatFromHighAtr = (highOfDay - currentPrice) / atr;
  const requiredRetreatPct = minimumPullbackFromHighPct(testedSupport);
  if (
    retreatFromHighPct < requiredRetreatPct ||
    retreatFromHighAtr < MIN_PULLBACK_FROM_HOD_ATR
  ) {
    const requiredPercent = Math.round(requiredRetreatPct * 100);
    return `Price has only eased from the high; this pullback area requires at least a ${requiredPercent}% HOD reset plus meaningful ATR distance.`;
  }
  return null;
}

export function deriveLiveWatchlistLifecycleRead(
  evidence: LiveWatchlistLifecycleEvidence,
): LiveWatchlistLifecycleRead {
  const structureAge = evidence.structureUpdatedAt === null
    ? Number.POSITIVE_INFINITY
    : evidence.evaluatedAt - evidence.structureUpdatedAt;
  if (
    !evidence.phase ||
    evidence.technicalConfidence === null ||
    evidence.technicalConfidence === "unavailable" ||
    evidence.technicalConfidence === "low" ||
    structureAge < -2 * 60 * 1_000 ||
    structureAge > MAX_STRUCTURE_AGE_MS
  ) {
    return read(
      "monitoring",
      "Analysis Pending",
      "Waiting for fresh, reliable 5-minute structure before assigning a lifecycle state.",
      evidence.evaluatedAt,
    );
  }

  const mappedSupport = hasMappedSupport(evidence.levelMap);
  if (evidence.phase === "pullback_forming") {
    const qualificationFailure = pullbackQualificationReason(
      evidence.levelMap,
      evidence.stableFiveMinuteState,
    );
    return qualificationFailure
      ? read("monitoring", "Analysis Pending", qualificationFailure, evidence.evaluatedAt)
      : read(
          "pullback_watch",
          "Pullback Watch",
          "A meaningful retreat from the high is testing confirmed five-minute structure at a qualified pullback area.",
          evidence.evaluatedAt,
        );
  }

  if (evidence.phase === "failed_move_risk") {
    const stableState = evidence.stableFiveMinuteState ?? "";
    if (
      mappedSupport &&
      LIQUID_VOLUME_LABELS.has(evidence.volumeLabel)
    ) {
      if (RECOVERY_ATTEMPT_STRUCTURE_STATES.has(stableState)) {
        return read(
          "recovery_attempt",
          "Recovery Attempt",
          stableState === "reclaim_confirmed"
            ? "Five-minute structure has confirmed a reclaim, but core VWAP and EMA9 momentum still need to be restored."
            : "Five-minute structure is attempting a reclaim while mapped support and participation remain usable.",
          evidence.evaluatedAt,
        );
      }
      return read(
        "recovery_watch",
        "Recovery Watch",
        "The prior momentum structure failed, but mapped support and participation remain usable while waiting for a five-minute reclaim attempt.",
        evidence.evaluatedAt,
      );
    }
    if (
      FADING_VOLUME_LABELS.has(evidence.volumeLabel) &&
      BROKEN_STRUCTURE_STATES.has(stableState)
    ) {
      return read(
        "setup_fading",
        "Setup Fading",
        "Price has lost VWAP and EMA9 while participation and confirmed 5-minute structure are deteriorating.",
        evidence.evaluatedAt,
      );
    }
    return read(
      "monitoring",
      "Analysis Pending",
      "The prior setup is damaged; waiting for either a base-and-reclaim or confirmed participation fade.",
      evidence.evaluatedAt,
    );
  }

  if (FADING_VOLUME_LABELS.has(evidence.volumeLabel)) {
    return read(
      "monitoring",
      "Analysis Pending",
      "Price structure remains constructive, but participation is not strong enough for a Momentum Holding label.",
      evidence.evaluatedAt,
    );
  }

  return read(
    "active",
    "Momentum Holding",
    "Price remains above the core VWAP and EMA9 momentum structure.",
    evidence.evaluatedAt,
  );
}
