import type { TechnicalContextConfidence } from "../technical-context/technical-context-types.js";
import type {
  LiveWatchlistLifecycleRead,
  LiveWatchlistLevelMap,
} from "./live-watchlist-types.js";
import type {
  LiveWatchlistPullbackReadPhase,
  LiveWatchlistPullbackVolumeLabel,
} from "./pullback-read.js";

const MAX_STRUCTURE_AGE_MS = 20 * 60 * 1_000;
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
    return mappedSupport
      ? read(
          "pullback_watch",
          "Pullback Watch",
          "Momentum has cooled below EMA9 while price is still holding above VWAP and mapped support.",
          evidence.evaluatedAt,
        )
      : read(
          "monitoring",
          "Analysis Pending",
          "Momentum has cooled, but a valid structural pullback area is not yet confirmed.",
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
