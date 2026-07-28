// 2026-04-14 08:05 PM America/Toronto
// Session-aware special intraday levels derived from classified 5 minute candles.

import type { Candle } from "../market-data/candle-types.js";
import { filterCandlesBySession } from "../market-data/candle-session-classifier.js";
import { buildReferenceLevels } from "../support-resistance/reference-levels.js";
import type { LevelKind, RawLevelCandidate, RawLevelCandidateSourceType } from "./level-types.js";

export type SpecialLevelOutput = {
  candidates: RawLevelCandidate[];
  summary: {
    premarketHigh?: number;
    premarketLow?: number;
    openingRangeHigh?: number;
    openingRangeLow?: number;
    previousDayHigh?: number;
    previousDayLow?: number;
    previousDayClose?: number;
    currentSessionHigh?: number;
    currentSessionLow?: number;
  };
};

function round(value: number): number {
  return Number(value.toFixed(4));
}

function finitePrice(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? round(value)
    : undefined;
}

function buildReferenceCandidate(params: {
  symbol: string;
  sourceType: RawLevelCandidateSourceType;
  kind: LevelKind;
  price: number | undefined;
  firstTimestamp: number;
  lastTimestamp: number;
  note: string;
  sessionSignificance?: number;
}): RawLevelCandidate | null {
  if (params.price === undefined) {
    return null;
  }

  const isOpeningRange = params.sourceType.startsWith("opening_range");
  const isCurrentSession = params.sourceType.startsWith("current_session");
  return {
    id: `${params.symbol}-reference-${params.sourceType}-${params.lastTimestamp}`,
    symbol: params.symbol,
    price: params.price,
    kind: params.kind,
    timeframe: params.sourceType.startsWith("previous_day") ? "daily" : "5m",
    sourceType: params.sourceType,
    touchCount: 1,
    reactionScore: 1,
    reactionQuality: isOpeningRange || isCurrentSession ? 0.9 : 0.8,
    rejectionScore: isOpeningRange || isCurrentSession ? 0.72 : 0.65,
    displacementScore: isOpeningRange || isCurrentSession ? 0.7 : 0.6,
    sessionSignificance: params.sessionSignificance ?? 1,
    followThroughScore: isOpeningRange || isCurrentSession ? 0.82 : 0.72,
    gapContinuationScore: 0,
    repeatedReactionCount: 1,
    gapStructure: false,
    firstTimestamp: params.firstTimestamp,
    lastTimestamp: params.lastTimestamp,
    notes: [params.note],
  };
}

export function buildSpecialLevelCandidates(
  symbol: string,
  intradayCandles: Candle[],
  dailyCandles: Candle[] = [],
): SpecialLevelOutput {
  if (intradayCandles.length === 0 && dailyCandles.length === 0) {
    return { candidates: [], summary: {} };
  }

  const references = buildReferenceLevels({ dailyCandles, intradayCandles });
  const latestDay = new Date(intradayCandles.at(-1)?.timestamp ?? Date.now()).getDate();
  const latestIntradayCandles = intradayCandles.filter(
    (candle) => new Date(candle.timestamp).getDate() === latestDay,
  );
  const premarketCandles = filterCandlesBySession(latestIntradayCandles, "5m", "premarket");
  const openingRangeCandles = filterCandlesBySession(latestIntradayCandles, "5m", "opening_range");
  const lastTimestamp = latestIntradayCandles.at(-1)?.timestamp ?? dailyCandles.at(-1)?.timestamp ?? Date.now();
  const intradayFirstTimestamp = latestIntradayCandles[0]?.timestamp ?? lastTimestamp;
  const dailyFirstTimestamp = dailyCandles.at(-1)?.timestamp ?? lastTimestamp;
  const currentPrice = intradayCandles.at(-1)?.close ?? dailyCandles.at(-1)?.close ?? 0;
  const premarketHigh = finitePrice(
    premarketCandles.length > 0 ? Math.max(...premarketCandles.map((candle) => candle.high)) : null,
  );
  const premarketLow = finitePrice(
    premarketCandles.length > 0 ? Math.min(...premarketCandles.map((candle) => candle.low)) : null,
  );
  const openingRangeHigh = finitePrice(
    openingRangeCandles.length > 0 ? Math.max(...openingRangeCandles.map((candle) => candle.high)) : null,
  );
  const openingRangeLow = finitePrice(
    openingRangeCandles.length > 0 ? Math.min(...openingRangeCandles.map((candle) => candle.low)) : null,
  );
  const previousDayHigh = finitePrice(references.previousDayHigh);
  const previousDayLow = finitePrice(references.previousDayLow);
  const previousDayClose = finitePrice(references.previousDayClose);
  const currentSessionHigh = finitePrice(references.currentSessionHigh);
  const currentSessionLow = finitePrice(references.currentSessionLow);

  const candidates = [
    buildReferenceCandidate({ symbol, sourceType: "premarket_high", kind: "resistance", price: premarketHigh, firstTimestamp: premarketCandles[0]?.timestamp ?? intradayFirstTimestamp, lastTimestamp, note: "Session-accurate premarket high candidate." }),
    buildReferenceCandidate({ symbol, sourceType: "premarket_low", kind: "support", price: premarketLow, firstTimestamp: premarketCandles[0]?.timestamp ?? intradayFirstTimestamp, lastTimestamp, note: "Session-accurate premarket low candidate." }),
    buildReferenceCandidate({ symbol, sourceType: "opening_range_high", kind: "resistance", price: openingRangeHigh, firstTimestamp: openingRangeCandles[0]?.timestamp ?? intradayFirstTimestamp, lastTimestamp, note: "Session-accurate opening range high candidate." }),
    buildReferenceCandidate({ symbol, sourceType: "opening_range_low", kind: "support", price: openingRangeLow, firstTimestamp: openingRangeCandles[0]?.timestamp ?? intradayFirstTimestamp, lastTimestamp, note: "Session-accurate opening range low candidate." }),
    buildReferenceCandidate({ symbol, sourceType: "previous_day_high", kind: "resistance", price: previousDayHigh, firstTimestamp: dailyFirstTimestamp, lastTimestamp, note: "Previous regular-session high reference.", sessionSignificance: 0.96 }),
    buildReferenceCandidate({ symbol, sourceType: "previous_day_low", kind: "support", price: previousDayLow, firstTimestamp: dailyFirstTimestamp, lastTimestamp, note: "Previous regular-session low reference.", sessionSignificance: 0.96 }),
    buildReferenceCandidate({ symbol, sourceType: "previous_day_close", kind: previousDayClose !== undefined && currentPrice >= previousDayClose ? "support" : "resistance", price: previousDayClose, firstTimestamp: dailyFirstTimestamp, lastTimestamp, note: "Previous regular-session close reference.", sessionSignificance: 0.9 }),
    buildReferenceCandidate({ symbol, sourceType: "current_session_high", kind: "resistance", price: currentSessionHigh, firstTimestamp: intradayFirstTimestamp, lastTimestamp, note: "Current regular-session high-of-day reference." }),
    buildReferenceCandidate({ symbol, sourceType: "current_session_low", kind: "support", price: currentSessionLow, firstTimestamp: intradayFirstTimestamp, lastTimestamp, note: "Current regular-session low-of-day reference." }),
  ].filter((candidate): candidate is RawLevelCandidate =>
    candidate !== null && (
      candidate.sourceType === "premarket_high" ||
      candidate.sourceType === "premarket_low" ||
      candidate.sourceType === "opening_range_high" ||
      candidate.sourceType === "opening_range_low"
    ));

  return {
    candidates,
    summary: {
      premarketHigh,
      premarketLow,
      openingRangeHigh,
      openingRangeLow,
      previousDayHigh,
      previousDayLow,
      previousDayClose,
      currentSessionHigh,
      currentSessionLow,
    },
  };
}
