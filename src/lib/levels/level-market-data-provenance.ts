import type { LevelScoreConfig } from "./level-score-config.js";
import type {
  LevelMarketDataProvenance,
  LevelTouch,
  RawLevelCandidate,
} from "./level-types.js";

function finiteTimestamp(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function latestTimestamp(values: Array<number | undefined>): number | undefined {
  const finite = values
    .map(finiteTimestamp)
    .filter((value): value is number => value !== undefined);
  return finite.length > 0 ? Math.max(...finite) : undefined;
}

export function buildRawCandidateMarketDataProvenance(params: {
  formedAt: number;
  sourceLastSeenAt?: number;
  repeatedSourceConfirmation?: boolean;
}): LevelMarketDataProvenance {
  const formedAt = params.formedAt;
  const sourceLastSeenAt = params.sourceLastSeenAt ?? formedAt;
  const hasLaterSourceEvidence = sourceLastSeenAt > formedAt;

  return {
    formedAt,
    sourceLastSeenAt,
    ...(hasLaterSourceEvidence ? { lastTestedAt: sourceLastSeenAt } : {}),
    ...(hasLaterSourceEvidence && params.repeatedSourceConfirmation
      ? { lastConfirmedAt: sourceLastSeenAt }
      : {}),
  };
}

export function touchConfirmsLevel(
  touch: LevelTouch,
  config: LevelScoreConfig,
): boolean {
  if (
    touch.reactionType === "rejection" ||
    touch.reactionType === "failed_break" ||
    touch.reactionType === "reclaim"
  ) {
    return true;
  }

  return (
    touch.reactionType !== "clean_break" &&
    touch.reactionMovePct >= config.touchThresholds.minReactionMovePct &&
    (touch.closedAwayFromLevel ||
      touch.wickRejectStrength >= 0.4 ||
      touch.bodyRejectStrength >= 0.4)
  );
}

export function enrichMarketDataProvenanceFromTouches(params: {
  provenance: LevelMarketDataProvenance | undefined;
  touches: LevelTouch[];
  config: LevelScoreConfig;
}): LevelMarketDataProvenance | undefined {
  if (!params.provenance) {
    return undefined;
  }

  const laterTouches = params.touches.filter(
    (touch) => touch.candleTimestamp > params.provenance!.formedAt,
  );
  const confirmingTouches = laterTouches.filter((touch) =>
    touchConfirmsLevel(touch, params.config),
  );

  return {
    ...params.provenance,
    lastTestedAt: latestTimestamp([
      params.provenance.lastTestedAt,
      ...laterTouches.map((touch) => touch.candleTimestamp),
    ]),
    lastConfirmedAt: latestTimestamp([
      params.provenance.lastConfirmedAt,
      ...confirmingTouches.map((touch) => touch.candleTimestamp),
    ]),
  };
}

export function aggregateRawCandidateMarketDataProvenance(
  candidates: RawLevelCandidate[],
): LevelMarketDataProvenance | undefined {
  const provenance = candidates
    .map((candidate) => candidate.marketDataProvenance)
    .filter((value): value is LevelMarketDataProvenance => value !== undefined);
  if (provenance.length === 0) {
    return undefined;
  }

  return {
    formedAt: Math.min(...provenance.map((value) => value.formedAt)),
    sourceLastSeenAt: Math.max(...provenance.map((value) => value.sourceLastSeenAt)),
    lastTestedAt: latestTimestamp(provenance.map((value) => value.lastTestedAt)),
    lastConfirmedAt: latestTimestamp(provenance.map((value) => value.lastConfirmedAt)),
  };
}

export function mergeLevelMarketDataProvenance(
  left: LevelMarketDataProvenance | undefined,
  right: LevelMarketDataProvenance | undefined,
): LevelMarketDataProvenance | undefined {
  if (!left) return right ? { ...right } : undefined;
  if (!right) return { ...left };
  return {
    formedAt: Math.min(left.formedAt, right.formedAt),
    sourceLastSeenAt: Math.max(left.sourceLastSeenAt, right.sourceLastSeenAt),
    lastTestedAt: latestTimestamp([left.lastTestedAt, right.lastTestedAt]),
    lastConfirmedAt: latestTimestamp([left.lastConfirmedAt, right.lastConfirmedAt]),
  };
}
