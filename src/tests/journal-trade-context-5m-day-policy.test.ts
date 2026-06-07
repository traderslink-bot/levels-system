import assert from "node:assert/strict";
import test from "node:test";

import { buildLevelAnalysisSnapshotFromCandles } from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import { buildJournalTradeContextFiveMinuteDayPolicy } from "../lib/analysis/journal-trade-context-5m-day-policy.js";
import { candleCloseTimestamp } from "../lib/market-data/candle-as-of-filter.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TRADE_AS_OF = Date.parse("2026-06-01T10:17:00-04:00");

function candle(timestamp: number, index: number): Candle {
  const base = 8 + index * 0.015;
  return {
    timestamp,
    open: Number(base.toFixed(4)),
    high: Number((base + 0.08).toFixed(4)),
    low: Number((base - 0.05).toFixed(4)),
    close: Number((base + 0.03).toFixed(4)),
    volume: 100_000 + index * 1_000,
  };
}

function fiveMinuteDayCandles(startTimestamp: number, count: number): Candle[] {
  return Array.from({ length: count }, (_, index) =>
    candle(startTimestamp + index * FIVE_MINUTES_MS, index),
  );
}

function fourHourCandles(): Candle[] {
  return [
    candle(Date.parse("2026-05-29T04:00:00-04:00"), 1),
    candle(Date.parse("2026-05-29T08:00:00-04:00"), 2),
    candle(Date.parse("2026-05-29T12:00:00-04:00"), 3),
    candle(Date.parse("2026-05-29T16:00:00-04:00"), 4),
    candle(Date.parse("2026-06-01T00:00:00-04:00"), 5),
    candle(Date.parse("2026-06-01T04:00:00-04:00"), 6),
  ];
}

function dailyCandles(): Candle[] {
  return [
    candle(Date.parse("2026-05-26T00:00:00.000Z"), 1),
    candle(Date.parse("2026-05-27T00:00:00.000Z"), 2),
    candle(Date.parse("2026-05-28T00:00:00.000Z"), 3),
    candle(Date.parse("2026-05-29T00:00:00.000Z"), 4),
  ];
}

test("journal trade-context 5m policy fetches one reusable extended-session day per symbol", () => {
  const morning = buildJournalTradeContextFiveMinuteDayPolicy({
    symbol: "devs",
    tradeContextTimestamp: Date.parse("2026-06-01T09:42:00-04:00"),
  });
  const afternoon = buildJournalTradeContextFiveMinuteDayPolicy({
    symbol: "DEVS",
    tradeContextTimestamp: Date.parse("2026-06-01T14:30:00-04:00"),
  });
  const nextDay = buildJournalTradeContextFiveMinuteDayPolicy({
    symbol: "DEVS",
    tradeContextTimestamp: Date.parse("2026-06-02T09:42:00-04:00"),
  });

  assert.equal(morning.symbol, "DEVS");
  assert.equal(morning.fetchRequest.timeframe, "5m");
  assert.equal(morning.fetchRequest.lookbackBars, 192);
  assert.equal(morning.fetchRequest.endTimeMs, Date.parse("2026-06-02T00:00:00.000Z"));
  assert.equal(morning.session.startTimestamp, Date.parse("2026-06-01T08:00:00.000Z"));
  assert.equal(morning.session.endTimestamp, Date.parse("2026-06-02T00:00:00.000Z"));
  assert.equal(morning.session.localDate, "2026-06-01");
  assert.equal(morning.session.expectedBarCount, 192);
  assert.equal(morning.cacheIdentity.key, afternoon.cacheIdentity.key);
  assert.notEqual(morning.cacheIdentity.key, nextDay.cacheIdentity.key);
  assert.deepEqual(morning.safety, {
    fullDayFetchOnly: true,
    snapshotStillFiltersAsOf: true,
    noTradeSpecificCandleExpansion: true,
    noLevelEngineBehaviorChange: true,
  });
});

test("journal trade-context 5m policy respects exchange timezone across standard time", () => {
  const policy = buildJournalTradeContextFiveMinuteDayPolicy({
    symbol: "GME",
    tradeContextTimestamp: Date.parse("2026-01-15T10:00:00-05:00"),
  });

  assert.equal(policy.session.localDate, "2026-01-15");
  assert.equal(policy.session.startTimestamp, Date.parse("2026-01-15T09:00:00.000Z"));
  assert.equal(policy.session.endTimestamp, Date.parse("2026-01-16T01:00:00.000Z"));
  assert.equal(policy.fetchRequest.lookbackBars, 192);
});

test("full-day 5m input remains as-of filtered before snapshot facts are built", () => {
  const policy = buildJournalTradeContextFiveMinuteDayPolicy({
    symbol: "DEVS",
    tradeContextTimestamp: TRADE_AS_OF,
  });
  const fullDay = fiveMinuteDayCandles(
    policy.session.startTimestamp,
    policy.session.expectedBarCount,
  );
  const closedOnly = fullDay.filter(
    (item) => candleCloseTimestamp(item, "5m") <= TRADE_AS_OF,
  );
  const baseInput = {
    symbol: "DEVS",
    asOfTimestamp: TRADE_AS_OF,
    referencePrice: closedOnly.at(-1)?.close,
    fourHourCandles: fourHourCandles(),
    dailyCandles: dailyCandles(),
    previousClose: 8.25,
  };
  const fullDaySnapshot = buildLevelAnalysisSnapshotFromCandles({
    ...baseInput,
    candles5m: fullDay,
  });
  const closedOnlySnapshot = buildLevelAnalysisSnapshotFromCandles({
    ...baseInput,
    candles5m: closedOnly,
  });

  assert.equal(fullDay.length, 192);
  assert.equal(closedOnly.length, 75);
  assert.deepEqual(fullDaySnapshot.levelEngineOutput, closedOnlySnapshot.levelEngineOutput);
  assert.deepEqual(fullDaySnapshot.sessionFacts, closedOnlySnapshot.sessionFacts);
  assert.deepEqual(fullDaySnapshot.volumeFacts, closedOnlySnapshot.volumeFacts);
  assert.deepEqual(fullDaySnapshot.volumeShelves, closedOnlySnapshot.volumeShelves);
  assert.equal(fullDaySnapshot.inputSummary.candleCounts["5m"], 192);
  assert.equal(fullDaySnapshot.inputSummary.filteredCandleCounts["5m"], 75);
  assert.equal(fullDaySnapshot.inputSummary.excludedPartialCandleCounts["5m"], 1);
  assert.equal(fullDaySnapshot.inputSummary.excludedFutureCandleCounts["5m"], 116);
  assert.ok(fullDaySnapshot.diagnostics.includes("5m_partial_candles_filtered"));
  assert.ok(fullDaySnapshot.diagnostics.includes("5m_future_candles_filtered"));
  assert.equal(fullDaySnapshot.safety.noLookaheadApplied, true);
});

test("journal trade-context 5m policy rejects ambiguous symbols and invalid sessions", () => {
  assert.throws(
    () =>
      buildJournalTradeContextFiveMinuteDayPolicy({
        symbol: "bad symbol",
        tradeContextTimestamp: TRADE_AS_OF,
      }),
    /Invalid symbol/,
  );
  assert.throws(
    () =>
      buildJournalTradeContextFiveMinuteDayPolicy({
        symbol: "DEVS",
        tradeContextTimestamp: TRADE_AS_OF,
        sessionStartHour: 20,
        sessionEndHour: 4,
      }),
    /sessionEndHour must be greater/,
  );
});
