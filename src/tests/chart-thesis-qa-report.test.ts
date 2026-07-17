import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candle, CandleProviderResponse, CandleTimeframe } from "../lib/market-data/candle-types.js";
import { buildChartThesisQaReport } from "../lib/review/chart-thesis-qa-report.js";

function candle(day: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: Date.UTC(2026, 0, day, 16, 0),
    open,
    high,
    low,
    close,
    volume: 1_000_000,
  };
}

function fiveMinuteCandleBeforeCutoff(
  cutoffDay: number,
  minutesBeforeCutoff: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): Candle {
  return {
    timestamp: Date.UTC(2026, 0, cutoffDay, 16, 0) - minutesBeforeCutoff * 60 * 1000,
    open,
    high,
    low,
    close,
    volume,
  };
}

function response(symbol: string, timeframe: CandleTimeframe, candles: Candle[]): CandleProviderResponse {
  return {
    provider: "stub",
    symbol,
    timeframe,
    requestedLookbackBars: candles.length,
    candles,
    fetchStartTimestamp: candles[0]?.timestamp ?? 0,
    fetchEndTimestamp: candles.at(-1)?.timestamp ?? 0,
    requestedStartTimestamp: candles[0]?.timestamp ?? 0,
    requestedEndTimestamp: candles.at(-1)?.timestamp ?? 0,
    sessionMetadataAvailable: false,
    actualBarsReturned: candles.length,
    completenessStatus: candles.length > 0 ? "complete" : "empty",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

test("chart thesis QA records a target hit from replayed candles", () => {
  const fourHour = [
    candle(1, 1.02, 1.08, 0.98, 1.04),
    candle(2, 1.04, 1.1, 1.0, 1.06),
    candle(3, 1.06, 1.12, 1.02, 1.08),
    candle(4, 1.42, 1.6, 1.08, 1.16),
    candle(5, 1.15, 1.25, 1.02, 1.12),
    candle(6, 1.1, 1.28, 1.07, 1.18),
    candle(7, 1.18, 1.52, 1.16, 1.44),
    candle(8, 1.44, 1.74, 1.38, 1.7),
    candle(9, 1.7, 1.86, 1.62, 1.78),
  ];
  const report = buildChartThesisQaReport({
    symbols: [{
      symbol: "HIT",
      seriesMap: {
        daily: response("HIT", "daily", []),
        "4h": response("HIT", "4h", fourHour),
        "5m": response("HIT", "5m", []),
      },
    }],
    samplesPerSymbol: 1,
    horizonBars: 3,
  });

  assert.equal(report.totals.samplesWithThesis, 1);
  assert.equal(report.totals.hitTarget, 1);
  assert.equal(report.samples[0]?.thesis?.type, "return_to_selloff_origin");
  assert.equal(report.totals.thesisStatuses.early, 1);
  assert.equal(report.samples[0]?.lifecycleScope, "unknown_lifecycle");
  assert.equal(report.totals.lifecycleScopes.unknown_lifecycle, 1);
  assert.equal(report.goodExamples.length, 1);
});

test("chart thesis QA records invalidated reads as bad examples", () => {
  const fourHour = [
    candle(1, 1.02, 1.08, 0.98, 1.04),
    candle(2, 1.04, 1.1, 1.0, 1.06),
    candle(3, 1.06, 1.12, 1.02, 1.08),
    candle(4, 1.42, 1.6, 1.08, 1.16),
    candle(5, 1.15, 1.25, 1.02, 1.12),
    candle(6, 1.1, 1.28, 1.07, 1.18),
    candle(7, 1.18, 1.2, 0.96, 1.0),
    candle(8, 1.0, 1.06, 0.94, 0.98),
    candle(9, 0.98, 1.02, 0.92, 0.96),
  ];
  const report = buildChartThesisQaReport({
    symbols: [{
      symbol: "FAIL",
      seriesMap: {
        daily: response("FAIL", "daily", []),
        "4h": response("FAIL", "4h", fourHour),
        "5m": response("FAIL", "5m", []),
      },
    }],
    samplesPerSymbol: 1,
    horizonBars: 3,
  });

  assert.equal(report.totals.samplesWithThesis, 1);
  assert.equal(report.totals.invalidated, 1);
  assert.equal(report.badExamples[0]?.outcome, "invalidated");
});

test("chart thesis QA flags missed meaningful moves when no thesis fired", () => {
  const fourHour = [
    candle(1, 1.0, 1.04, 0.98, 1.02),
    candle(2, 1.02, 1.05, 1.0, 1.03),
    candle(3, 1.03, 1.06, 1.01, 1.04),
    candle(4, 1.04, 1.07, 1.02, 1.05),
    candle(5, 1.05, 1.08, 1.03, 1.06),
    candle(6, 1.06, 1.09, 1.04, 1.07),
    candle(7, 1.07, 1.12, 1.05, 1.08),
    candle(8, 1.08, 1.55, 1.08, 1.48),
    candle(9, 1.48, 1.62, 1.38, 1.52),
  ];
  const report = buildChartThesisQaReport({
    symbols: [{
      symbol: "MISS",
      seriesMap: {
        daily: response("MISS", "daily", []),
        "4h": response("MISS", "4h", fourHour),
        "5m": response("MISS", "5m", []),
      },
    }],
    samplesPerSymbol: 1,
    horizonBars: 3,
    meaningfulMovePct: 25,
  });

  assert.equal(report.totals.samplesWithThesis, 0);
  assert.equal(report.totals.missedMeaningfulMoves, 1);
  const reason = report.missedMoves[0]?.reason;
  assert.ok(reason);
  assert.equal(report.totals.missedMoveReasons[reason], 1);
  assert.equal(typeof report.missedMoves[0]?.priorRangePct, "number");
  assert.match(report.missedMoves[0]?.summary ?? "", /no thesis/);
});

test("chart thesis QA rejection audit treats raw same-day catalyst context as fresh", () => {
  const fourHour = [
    candle(1, 1.0, 1.04, 0.98, 1.02),
    candle(2, 1.02, 1.05, 1.0, 1.03),
    candle(3, 1.03, 1.06, 1.01, 1.04),
    candle(4, 1.04, 1.07, 1.02, 1.05),
    candle(5, 1.05, 1.08, 1.03, 1.06),
    candle(6, 1.06, 1.09, 1.04, 1.07),
    candle(7, 1.07, 1.12, 1.05, 1.08),
    candle(8, 1.08, 1.55, 1.08, 1.48),
    candle(9, 1.48, 1.62, 1.38, 1.52),
  ];
  const cutoffTimestamp = fourHour[6]!.timestamp;
  const report = buildChartThesisQaReport({
    symbols: [{
      symbol: "CATQA",
      seriesMap: {
        daily: response("CATQA", "daily", []),
        "4h": response("CATQA", "4h", fourHour),
        "5m": response("CATQA", "5m", []),
      },
    }],
    cutoffTimestampsBySymbol: {
      CATQA: [cutoffTimestamp],
    },
    chartThesisContextBySymbolTimestamp: {
      [`CATQA:${cutoffTimestamp}`]: {
        activeRunner: true,
        catalystCardFreshness: "no_card",
        catalystContext: {
          source: "local_press_release_db",
          checked: true,
          timing: "same_day_premarket",
          freshness: "same_day",
          articleCount: 1,
          primaryArticle: null,
          articles: [],
          summary: "same-day raw catalyst",
        },
      },
    },
    samplesPerSymbol: 4,
    horizonBars: 2,
    meaningfulMovePct: 25,
  });

  const catalystRejection = report.missedMoves[0]?.rejectionAudit.thesisRejections
    .find((item) => item.thesisType === "catalyst_active_runner_continuation");

  assert.ok(catalystRejection);
  assert.equal(catalystRejection.diagnostics.freshCatalystContext, true);
  assert.equal(catalystRejection.diagnostics.catalystContextTiming, "same_day_premarket");
  assert.doesNotMatch(catalystRejection.blockers.join("\n"), /catalyst context/);
});

test("chart thesis QA keeps no-thesis rows below the meaningful move threshold", () => {
  const fourHour = [
    candle(1, 1.0, 1.04, 0.98, 1.02),
    candle(2, 1.02, 1.05, 1.0, 1.03),
    candle(3, 1.03, 1.06, 1.01, 1.04),
    candle(4, 1.04, 1.07, 1.02, 1.05),
    candle(5, 1.05, 1.08, 1.03, 1.06),
    candle(6, 1.06, 1.09, 1.04, 1.07),
    candle(7, 1.07, 1.12, 1.05, 1.08),
    candle(8, 1.08, 1.2, 1.08, 1.16),
    candle(9, 1.16, 1.18, 1.08, 1.12),
  ];
  const report = buildChartThesisQaReport({
    symbols: [{
      symbol: "QUIET",
      seriesMap: {
        daily: response("QUIET", "daily", []),
        "4h": response("QUIET", "4h", fourHour),
        "5m": response("QUIET", "5m", []),
      },
    }],
    samplesPerSymbol: 1,
    horizonBars: 2,
    meaningfulMovePct: 25,
  });

  assert.equal(report.totals.samplesWithThesis, 0);
  assert.equal(report.totals.missedMeaningfulMoves, 0);
  assert.equal(report.totals.noThesisBelowMeaningfulForward, 1);
  assert.equal(report.noThesisBelowMeaningfulForwardRows[0]?.symbol, "QUIET");
  assert.ok((report.noThesisBelowMeaningfulForwardRows[0]?.bestForwardPct ?? 0) < 25);
});

test("chart thesis QA can evaluate explicit runner cutoff timestamps", () => {
  const fourHour = [
    candle(1, 1.0, 1.04, 0.98, 1.02),
    candle(2, 1.02, 1.05, 1.0, 1.03),
    candle(3, 1.03, 1.06, 1.01, 1.04),
    candle(4, 1.04, 1.07, 1.02, 1.05),
    candle(5, 1.05, 1.08, 1.03, 1.06),
    candle(6, 1.06, 1.09, 1.04, 1.07),
    candle(7, 1.07, 1.1, 1.05, 1.08),
    candle(8, 1.08, 1.55, 1.08, 1.48),
    candle(9, 1.48, 1.62, 1.38, 1.52),
    candle(10, 1.52, 1.58, 1.45, 1.5),
  ];
  const report = buildChartThesisQaReport({
    symbols: [{
      symbol: "RUN",
      seriesMap: {
        daily: response("RUN", "daily", []),
        "4h": response("RUN", "4h", fourHour),
        "5m": response("RUN", "5m", []),
      },
    }],
    cutoffTimestampsBySymbol: {
      RUN: [fourHour[6]!.timestamp],
    },
    samplesPerSymbol: 4,
    horizonBars: 2,
    meaningfulMovePct: 25,
  });

  assert.equal(report.totals.samplesWithThesis, 0);
  assert.equal(report.totals.missedMeaningfulMoves, 1);
  assert.equal(report.missedMoves[0]?.cutoffTimestamp, fourHour[6]!.timestamp);
  assert.equal(report.missedMoves[0]?.bestForwardPct.toFixed(1), "50.0");
});

test("chart thesis QA labels replay samples by watchlist lifecycle scope", () => {
  const fourHour = [
    candle(1, 1.02, 1.08, 0.98, 1.04),
    candle(2, 1.04, 1.1, 1.0, 1.06),
    candle(3, 1.06, 1.12, 1.02, 1.08),
    candle(4, 1.42, 1.6, 1.08, 1.16),
    candle(5, 1.15, 1.25, 1.02, 1.12),
    candle(6, 1.1, 1.28, 1.07, 1.18),
    candle(7, 1.18, 1.52, 1.16, 1.44),
    candle(8, 1.44, 1.74, 1.38, 1.7),
    candle(9, 1.7, 1.86, 1.62, 1.78),
  ];
  const report = buildChartThesisQaReport({
    symbols: [{
      symbol: "LIVE",
      seriesMap: {
        daily: response("LIVE", "daily", []),
        "4h": response("LIVE", "4h", fourHour),
        "5m": response("LIVE", "5m", []),
      },
    }],
    samplesPerSymbol: 1,
    horizonBars: 3,
    lifecycleSessionsBySymbol: {
      LIVE: [{
        symbol: "LIVE",
        startedAt: candle(5, 1, 1, 1, 1).timestamp,
        endedAt: null,
        source: "archive",
        status: "live",
      }],
    },
  });

  assert.equal(report.samples[0]?.lifecycleScope, "active_window");
  assert.equal(report.totals.lifecycleScopes.active_window, 1);
});

test("chart thesis QA breaks down live confirmation by thesis type", () => {
  const fourHour = [
    candle(1, 1.0, 1.05, 0.98, 1.02),
    candle(2, 1.02, 1.08, 1.0, 1.04),
    candle(3, 1.04, 1.12, 1.02, 1.08),
    candle(4, 1.08, 1.18, 1.04, 1.12),
    candle(5, 1.12, 1.3, 1.08, 1.26),
    candle(6, 1.26, 1.41, 1.24, 1.38),
    candle(7, 1.38, 1.66, 1.34, 1.56),
    candle(8, 1.56, 1.68, 1.48, 1.62),
    candle(9, 1.62, 1.7, 1.52, 1.6),
  ];
  const fiveMinute = [
    fiveMinuteCandleBeforeCutoff(6, 85, 1.0, 1.04, 1.0, 1.02, 200_000),
    fiveMinuteCandleBeforeCutoff(6, 80, 1.02, 1.08, 1.0, 1.04, 230_000),
    fiveMinuteCandleBeforeCutoff(6, 75, 1.04, 1.1, 1.02, 1.08, 240_000),
    fiveMinuteCandleBeforeCutoff(6, 70, 1.08, 1.12, 1.04, 1.08, 210_000),
    fiveMinuteCandleBeforeCutoff(6, 65, 1.08, 1.13, 1.05, 1.1, 225_000),
    fiveMinuteCandleBeforeCutoff(6, 60, 1.1, 1.15, 1.07, 1.12, 235_000),
    fiveMinuteCandleBeforeCutoff(6, 55, 1.12, 1.16, 1.08, 1.13, 250_000),
    fiveMinuteCandleBeforeCutoff(6, 50, 1.13, 1.17, 1.1, 1.12, 220_000),
    fiveMinuteCandleBeforeCutoff(6, 45, 1.12, 1.18, 1.1, 1.15, 245_000),
    fiveMinuteCandleBeforeCutoff(6, 40, 1.15, 1.2, 1.12, 1.18, 255_000),
    fiveMinuteCandleBeforeCutoff(6, 35, 1.18, 1.22, 1.15, 1.18, 240_000),
    fiveMinuteCandleBeforeCutoff(6, 30, 1.18, 1.23, 1.16, 1.2, 230_000),
    fiveMinuteCandleBeforeCutoff(6, 25, 1.2, 1.25, 1.17, 1.21, 250_000),
    fiveMinuteCandleBeforeCutoff(6, 20, 1.21, 1.26, 1.18, 1.22, 260_000),
    fiveMinuteCandleBeforeCutoff(6, 15, 1.22, 1.27, 1.19, 1.24, 245_000),
    fiveMinuteCandleBeforeCutoff(6, 10, 1.24, 1.28, 1.2, 1.25, 255_000),
    fiveMinuteCandleBeforeCutoff(6, 5, 1.25, 1.29, 1.21, 1.26, 250_000),
    fiveMinuteCandleBeforeCutoff(6, 0, 1.26, 1.41, 1.24, 1.38, 850_000),
  ];
  const report = buildChartThesisQaReport({
    symbols: [{
      symbol: "LIVE",
      seriesMap: {
        daily: response("LIVE", "daily", []),
        "4h": response("LIVE", "4h", fourHour),
        "5m": response("LIVE", "5m", fiveMinute),
      },
    }],
    samplesPerSymbol: 1,
    horizonBars: 3,
  });

  assert.equal(report.samples[0]?.thesis?.type, "live_volume_expansion_confirmation");
  assert.equal(report.samples[0]?.liveConfirmation.present, true);
  assert.equal(report.totals.liveConfirmationPresent, 1);
  assert.equal(report.totals.liveConfirmationWithThesis, 1);
  assert.equal(report.totals.liveConfirmationOnMissedMoves, 0);
  assert.equal(report.thesisStats[0]?.liveConfirmationPresent, 1);
  assert.equal(report.thesisStats[0]?.statusCounts.active, 1);
});
