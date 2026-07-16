// Confirm a support/resistance role flip only after higher-timeframe break,
// retest, defense, and current-side evidence are all present.

import type { Candle } from "../market-data/candle-types.js";
import { filterCandlesByCloseAsOf } from "../market-data/candle-as-of-filter.js";
import type { LevelCandidate, SourceTimeframe } from "./level-types.js";
import { buildZoneBounds } from "./level-zone-utils.js";

type EligibleRoleFlipTimeframe = Extract<SourceTimeframe, "daily" | "4h">;

export type ConfirmedRoleFlipRequest = {
  candidate: LevelCandidate;
  timeframe: EligibleRoleFlipTimeframe;
  candles: Candle[];
  formationTimestamp: number;
  referencePrice: number;
  asOfTimestamp?: number;
};

const BREAK_CLOSE_BUFFER_PCT = 0.001;
const RETEST_PROXIMITY_PCT = 0.004;
const MIN_POST_RETEST_REACTION_PCT = 0.015;
const MAX_RETEST_SEARCH_BARS = 30;
const POST_RETEST_REACTION_BARS = 8;
const DECISIVE_INVALIDATION_PCT = 0.03;

function closesThroughOriginalRole(
  candle: Candle,
  originalType: LevelCandidate["type"],
  zoneLow: number,
  zoneHigh: number,
): boolean {
  return originalType === "resistance"
    ? candle.close > zoneHigh * (1 + BREAK_CLOSE_BUFFER_PCT)
    : candle.close < zoneLow * (1 - BREAK_CLOSE_BUFFER_PCT);
}

function retestsAndHoldsNewRole(
  candle: Candle,
  flippedType: LevelCandidate["type"],
  zoneLow: number,
  zoneHigh: number,
): boolean {
  if (flippedType === "support") {
    return (
      candle.low <= zoneHigh * (1 + RETEST_PROXIMITY_PCT) &&
      candle.high >= zoneLow &&
      candle.close >= zoneHigh
    );
  }

  return (
    candle.high >= zoneLow * (1 - RETEST_PROXIMITY_PCT) &&
    candle.low <= zoneHigh &&
    candle.close <= zoneLow
  );
}

function findPostRetestReaction(
  candles: Candle[],
  retestIndex: number,
  flippedType: LevelCandidate["type"],
  price: number,
  zoneLow: number,
  zoneHigh: number,
): Candle | null {
  const reactionWindow = candles.slice(
    retestIndex + 1,
    retestIndex + 1 + POST_RETEST_REACTION_BARS,
  );

  return reactionWindow.find((candle) => {
    if (flippedType === "support") {
      return (
        candle.close >= zoneHigh &&
        (candle.high - price) / Math.max(price, 0.0001) >= MIN_POST_RETEST_REACTION_PCT
      );
    }

    return (
      candle.close <= zoneLow &&
      (price - candle.low) / Math.max(price, 0.0001) >= MIN_POST_RETEST_REACTION_PCT
    );
  }) ?? null;
}

function wasLaterInvalidated(
  candles: Candle[],
  retestIndex: number,
  flippedType: LevelCandidate["type"],
  zoneLow: number,
  zoneHigh: number,
): boolean {
  const laterCandles = candles.slice(retestIndex + 1);

  for (let index = 0; index < laterCandles.length; index += 1) {
    const candle = laterCandles[index]!;
    const nextCandle = laterCandles[index + 1];
    const decisivelyInvalidated = flippedType === "support"
      ? candle.close < zoneLow * (1 - DECISIVE_INVALIDATION_PCT)
      : candle.close > zoneHigh * (1 + DECISIVE_INVALIDATION_PCT);
    if (decisivelyInvalidated) {
      return true;
    }

    if (!nextCandle) {
      continue;
    }

    const confirmedInvalidation = flippedType === "support"
      ? candle.close < zoneLow * (1 - BREAK_CLOSE_BUFFER_PCT) &&
        nextCandle.close < zoneLow * (1 - BREAK_CLOSE_BUFFER_PCT)
      : candle.close > zoneHigh * (1 + BREAK_CLOSE_BUFFER_PCT) &&
        nextCandle.close > zoneHigh * (1 + BREAK_CLOSE_BUFFER_PCT);
    if (confirmedInvalidation) {
      return true;
    }
  }

  return false;
}

function referenceRemainsOnFlippedSide(
  referencePrice: number,
  flippedType: LevelCandidate["type"],
  zoneLow: number,
  zoneHigh: number,
): boolean {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return false;
  }

  return flippedType === "support"
    ? referencePrice >= zoneHigh * (1 + BREAK_CLOSE_BUFFER_PCT)
    : referencePrice <= zoneLow * (1 - BREAK_CLOSE_BUFFER_PCT);
}

function uniqueClosedCandles(
  candles: Candle[],
  timeframe: EligibleRoleFlipTimeframe,
  asOfTimestamp: number,
): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  const closedCandles = filterCandlesByCloseAsOf({
    candles,
    timeframe,
    asOfTimestamp,
  }).candles;
  for (const candle of closedCandles) {
    if (candle.volume <= 0) {
      continue;
    }
    byTimestamp.set(candle.timestamp, candle);
  }

  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

/**
 * Returns a replacement candidate in the new role. The original candidate is
 * intentionally replaced instead of duplicated so the same price cannot be
 * shown simultaneously as both support and resistance after a confirmed flip.
 */
export function buildConfirmedRoleFlipCandidate(
  request: ConfirmedRoleFlipRequest,
): LevelCandidate | null {
  const { candidate, timeframe, formationTimestamp, referencePrice } = request;
  const { zoneLow, zoneHigh } =
    candidate.zoneLow !== undefined && candidate.zoneHigh !== undefined
      ? { zoneLow: candidate.zoneLow, zoneHigh: candidate.zoneHigh }
      : buildZoneBounds(candidate.price);
  const flippedType = candidate.type === "resistance" ? "support" : "resistance";

  if (!referenceRemainsOnFlippedSide(referencePrice, flippedType, zoneLow, zoneHigh)) {
    return null;
  }

  const evidenceCandles = uniqueClosedCandles(
    request.candles,
    timeframe,
    request.asOfTimestamp ?? Date.now(),
  ).filter((candle) => candle.timestamp > formationTimestamp);

  for (let index = 0; index < evidenceCandles.length - 2; index += 1) {
    const firstBreakClose = evidenceCandles[index]!;
    const secondBreakClose = evidenceCandles[index + 1]!;
    if (
      !closesThroughOriginalRole(firstBreakClose, candidate.type, zoneLow, zoneHigh) ||
      !closesThroughOriginalRole(secondBreakClose, candidate.type, zoneLow, zoneHigh)
    ) {
      continue;
    }

    const retestSearchEnd = Math.min(
      evidenceCandles.length,
      index + 2 + MAX_RETEST_SEARCH_BARS,
    );
    let retestIndex = -1;
    for (let cursor = index + 2; cursor < retestSearchEnd; cursor += 1) {
      if (retestsAndHoldsNewRole(evidenceCandles[cursor]!, flippedType, zoneLow, zoneHigh)) {
        retestIndex = cursor;
        break;
      }
    }

    if (retestIndex < 0) {
      continue;
    }
    const reactionCandle = findPostRetestReaction(
      evidenceCandles,
      retestIndex,
      flippedType,
      candidate.price,
      zoneLow,
      zoneHigh,
    );
    if (
      !reactionCandle ||
      // Once the second break close confirms the crossing, any later
      // invalidation cancels that attempt. Do not allow a failed breakout to
      // become a flip merely because price eventually approaches the zone
      // again and produces a reaction.
      wasLaterInvalidated(evidenceCandles, index + 1, flippedType, zoneLow, zoneHigh)
    ) {
      continue;
    }

    const confirmationCandle = secondBreakClose;
    const retestCandle = evidenceCandles[retestIndex]!;
    return {
      id: `${candidate.id}-role-flip-${flippedType}-${confirmationCandle.timestamp}-${retestCandle.timestamp}`,
      symbol: candidate.symbol,
      type: flippedType,
      price: candidate.price,
      zoneLow,
      zoneHigh,
      sourceTimeframes: [...new Set([...candidate.sourceTimeframes, timeframe])],
      originKinds: [...new Set([...candidate.originKinds, "role_flip" as const])],
      // Analyze only the post-confirmation role. Including the pre-break history
      // would incorrectly classify the old role as a break of the new one.
      analysisCandles: evidenceCandles.slice(index + 2),
      roleFlipCount: Math.max(candidate.roleFlipCount ?? 0, 1),
      roleFlipEvidence: {
        originalType: candidate.type,
        flippedType,
        timeframe,
        formationTimestamp,
        firstBreakTimestamp: firstBreakClose.timestamp,
        confirmationTimestamp: confirmationCandle.timestamp,
        retestTimestamp: retestCandle.timestamp,
        reactionTimestamp: reactionCandle.timestamp,
      },
    };
  }

  return null;
}
