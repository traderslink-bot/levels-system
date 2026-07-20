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
const RECOVERY_STRUCTURE_STATES = new Set(["reclaim_confirmed", "higher_lows_intact"]);
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
      "Monitoring",
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
          "Monitoring",
          "Momentum has cooled, but a valid structural pullback area is not yet confirmed.",
          evidence.evaluatedAt,
        );
  }

  if (evidence.phase === "failed_move_risk") {
    const stableState = evidence.stableFiveMinuteState ?? "";
    const recoveryEvidence = RECOVERY_STRUCTURE_STATES.has(stableState) ||
      [evidence.tradeSetupState, evidence.tradeSetupStateBeforeBlockers]
        .some((state) => state === "armed" || state === "forming");
    if (
      mappedSupport &&
      LIQUID_VOLUME_LABELS.has(evidence.volumeLabel) &&
      recoveryEvidence
    ) {
      return read(
        "recovery_watch",
        "Recovery Watch",
        "The prior momentum structure failed, but participation and base/reclaim evidence remain usable.",
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
      "Monitoring",
      "The prior setup is damaged; waiting for either a base-and-reclaim or confirmed participation fade.",
      evidence.evaluatedAt,
    );
  }

  if (FADING_VOLUME_LABELS.has(evidence.volumeLabel)) {
    return read(
      "monitoring",
      "Monitoring",
      "Price structure remains constructive, but participation is not strong enough for an Active label.",
      evidence.evaluatedAt,
    );
  }

  return read(
    "active",
    "Active",
    "Price remains above the core VWAP and EMA9 momentum structure.",
    evidence.evaluatedAt,
  );
}
