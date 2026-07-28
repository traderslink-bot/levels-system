import assert from "node:assert/strict";
import { test } from "node:test";

import { formatLevelSnapshotMessage } from "../lib/alerts/alert-router.js";
import { buildChartThesisRead } from "../lib/monitoring/chart-thesis-engine.js";
import type { ChartThesisEngineInput } from "../lib/monitoring/chart-thesis-engine.js";
import { buildPotentialMoveRead, formatPotentialMoveRead } from "../lib/monitoring/potential-move-read.js";
import type { Candle, CandleProviderResponse, CandleTimeframe } from "../lib/market-data/candle-types.js";

function candle(day: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: day * 24 * 60 * 60 * 1000,
    open,
    high,
    low,
    close,
    volume: 1_000_000,
  };
}

function minuteCandle(minute: number, open: number, high: number, low: number, close: number, volume = 1_000_000): Candle {
  return {
    timestamp: Date.UTC(2026, 0, 5, 14, 30 + minute),
    open,
    high,
    low,
    close,
    volume,
  };
}

function response(timeframe: CandleTimeframe, candles: Candle[]): CandleProviderResponse {
  return {
    provider: "stub",
    symbol: "MOVE",
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

test("buildPotentialMoveRead finds a prior selloff origin and buyer response", () => {
  const read = buildPotentialMoveRead({
    symbol: "MOVE",
    currentPrice: 1.4,
    seriesMap: {
      daily: response("daily", [
        candle(1, 1.1, 1.18, 1.05, 1.12),
        candle(2, 1.7, 1.82, 1.08, 1.16),
        candle(3, 1.15, 1.25, 1.02, 1.12),
        candle(4, 1.1, 1.28, 1.07, 1.18),
      ]),
      "4h": response("4h", []),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "return_to_selloff_origin");
  assert.equal(read.label, "Return to selloff origin");
  assert.equal(read.status, "active");
  assert.equal(read.timeframe, "daily");
  assert.equal(read.selloffOriginLow, 1.7);
  assert.equal(read.selloffOriginHigh, 1.82);
  assert.equal(read.buyerResponseLow, 1.02);
  assert.ok(read.roomToTargetPct > 20);
  assert.ok(read.roomToTargetPct < 25);
  assert.match(read.lines.join("\n"), /sharp daily selloff/);
  assert.match(read.lines.join("\n"), /return-to-origin path/);
});

test("buildChartThesisRead can identify a failed breakdown reclaim", () => {
  const read = buildChartThesisRead({
    symbol: "TRAP",
    currentPrice: 1.09,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.08, 1.2, 1.04, 1.12),
        candle(2, 1.1, 1.28, 1.05, 1.15),
        candle(3, 1.16, 1.38, 1.08, 1.2),
        candle(4, 1.18, 1.3, 1.07, 1.14),
        candle(5, 1.13, 1.24, 1.06, 1.1),
        candle(6, 1.02, 1.2, 0.98, 1.09),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "failed_breakdown_reclaim");
  assert.equal(read.status, "active");
  assert.match(read.lines.join("\n"), /swept below/);
  assert.match(read.lines.join("\n"), /failed-breakdown read/);
});

test("buildChartThesisRead can identify compression into a breakout trigger", () => {
  const read = buildChartThesisRead({
    symbol: "BASE",
    currentPrice: 1.17,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.05, 1.16, 1.04, 1.1),
        candle(2, 1.1, 1.18, 1.08, 1.13),
        candle(3, 1.13, 1.19, 1.09, 1.14),
        candle(4, 1.14, 1.19, 1.1, 1.16),
        candle(5, 1.16, 1.2, 1.1, 1.17),
        candle(6, 1.16, 1.2, 1.11, 1.18),
        candle(7, 1.17, 1.21, 1.11, 1.18),
        candle(8, 1.18, 1.21, 1.12, 1.18),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "compression_breakout");
  assert.equal(read.status, "watch");
  assert.match(read.lines.join("\n"), /compressing inside a tight 4h base/);
  assert.match(read.lines.join("\n"), /Acceptance above/);
});

test("buildPotentialMoveRead suppresses unapproved internal chart theses", () => {
  const input: ChartThesisEngineInput = {
    symbol: "BASE",
    currentPrice: 1.17,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.05, 1.16, 1.04, 1.1),
        candle(2, 1.1, 1.18, 1.08, 1.13),
        candle(3, 1.13, 1.19, 1.09, 1.14),
        candle(4, 1.14, 1.19, 1.1, 1.16),
        candle(5, 1.16, 1.2, 1.1, 1.17),
        candle(6, 1.16, 1.2, 1.11, 1.18),
        candle(7, 1.17, 1.21, 1.11, 1.18),
        candle(8, 1.18, 1.21, 1.12, 1.18),
      ]),
      "5m": response("5m", []),
    },
  };

  assert.equal(buildChartThesisRead(input)?.type, "compression_breakout");
  assert.equal(buildPotentialMoveRead(input), null);
});

test("buildChartThesisRead can identify a gap-fill reclaim", () => {
  const read = buildChartThesisRead({
    symbol: "GAP",
    currentPrice: 1.52,
    seriesMap: {
      daily: response("daily", [
        candle(1, 2.05, 2.2, 1.86, 2.0),
        candle(2, 1.3, 1.66, 1.15, 1.52),
      ]),
      "4h": response("4h", []),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "gap_fill_reclaim");
  assert.equal(read.status, "active");
  assert.match(read.lines.join("\n"), /gap-down open/);
  assert.match(read.lines.join("\n"), /gap-fill route/);
});

test("buildChartThesisRead can identify opening range expansion", () => {
  const read = buildChartThesisRead({
    symbol: "OPEN",
    currentPrice: 1.32,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", []),
      "5m": response("5m", [
        minuteCandle(0, 1.02, 1.12, 1.0, 1.08),
        minuteCandle(5, 1.08, 1.16, 1.04, 1.12),
        minuteCandle(10, 1.12, 1.22, 1.08, 1.18),
        minuteCandle(15, 1.18, 1.27, 1.14, 1.22),
        minuteCandle(20, 1.22, 1.3, 1.18, 1.25),
        minuteCandle(25, 1.25, 1.31, 1.2, 1.28),
        minuteCandle(30, 1.28, 1.32, 1.24, 1.29),
        minuteCandle(35, 1.29, 1.33, 1.25, 1.29),
        minuteCandle(40, 1.29, 1.34, 1.26, 1.3),
        minuteCandle(45, 1.3, 1.34, 1.27, 1.32),
      ]),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "opening_range_expansion");
  assert.equal(read.status, "active");
  assert.match(read.lines.join("\n"), /opening range/);
  assert.match(read.lines.join("\n"), /holding above/);
});

test("buildChartThesisRead can identify live volume expansion confirmation", () => {
  const read = buildChartThesisRead({
    symbol: "LIVE",
    currentPrice: 1.38,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", []),
      "5m": response("5m", [
        minuteCandle(0, 1.0, 1.04, 1.0, 1.02, 200_000),
        minuteCandle(5, 1.02, 1.08, 1.0, 1.04, 230_000),
        minuteCandle(10, 1.04, 1.1, 1.02, 1.08, 240_000),
        minuteCandle(15, 1.08, 1.12, 1.04, 1.08, 210_000),
        minuteCandle(20, 1.08, 1.13, 1.05, 1.1, 225_000),
        minuteCandle(25, 1.1, 1.15, 1.07, 1.12, 235_000),
        minuteCandle(30, 1.12, 1.16, 1.08, 1.13, 250_000),
        minuteCandle(35, 1.13, 1.17, 1.1, 1.12, 220_000),
        minuteCandle(40, 1.12, 1.18, 1.1, 1.15, 245_000),
        minuteCandle(45, 1.15, 1.2, 1.12, 1.18, 255_000),
        minuteCandle(50, 1.18, 1.22, 1.15, 1.18, 240_000),
        minuteCandle(55, 1.18, 1.23, 1.16, 1.2, 230_000),
        minuteCandle(60, 1.2, 1.25, 1.17, 1.21, 250_000),
        minuteCandle(65, 1.21, 1.26, 1.18, 1.22, 260_000),
        minuteCandle(70, 1.22, 1.27, 1.19, 1.24, 245_000),
        minuteCandle(75, 1.24, 1.28, 1.2, 1.25, 255_000),
        minuteCandle(80, 1.25, 1.29, 1.21, 1.26, 250_000),
        minuteCandle(85, 1.26, 1.41, 1.24, 1.38, 850_000),
      ]),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "live_volume_expansion_confirmation");
  assert.equal(read.status, "active");
  assert.match(read.lines.join("\n"), /fresh 5m confirmation/);
  assert.match(read.lines.join("\n"), /live tape confirmation/);
});

test("buildChartThesisRead can identify impulse flag continuation", () => {
  const read = buildChartThesisRead({
    symbol: "FLAG",
    currentPrice: 1.9,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.0, 1.1, 0.96, 1.04),
        candle(2, 1.05, 1.8, 1.02, 1.68),
        candle(3, 1.67, 1.9, 1.55, 1.78),
        candle(4, 1.76, 1.88, 1.58, 1.72),
        candle(5, 1.72, 1.86, 1.6, 1.75),
        candle(6, 1.75, 1.9, 1.62, 1.82),
        candle(7, 1.82, 1.94, 1.66, 1.88),
        candle(8, 1.88, 1.95, 1.7, 1.88),
        candle(9, 1.88, 1.94, 1.78, 1.89),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "impulse_flag_continuation");
  assert.equal(read.status, "watch");
  assert.match(read.lines.join("\n"), /strong 4h impulse/);
  assert.match(read.lines.join("\n"), /turning back into continuation/);
});

test("buildChartThesisRead suppresses selloff-origin reads when the reclaim trigger is too far away", () => {
  const read = buildChartThesisRead({
    symbol: "FAR",
    currentPrice: 3.5,
    seriesMap: {
      daily: response("daily", [
        candle(1, 4.2, 4.5, 3.9, 4.1),
        candle(2, 10.9, 11.75, 2.5, 3.2),
        candle(3, 3.2, 4.1, 2.55, 3.5),
      ]),
      "4h": response("4h", []),
      "5m": response("5m", []),
    },
  });

  assert.equal(read, null);
});

test("buildChartThesisRead can identify momentum expansion continuation", () => {
  const read = buildChartThesisRead({
    symbol: "MOMO",
    currentPrice: 1.72,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.0, 1.06, 0.98, 1.02),
        candle(2, 1.02, 1.08, 1.0, 1.04),
        candle(3, 1.04, 1.1, 1.02, 1.06),
        candle(4, 1.06, 1.12, 1.04, 1.08),
        candle(5, 1.08, 1.15, 1.06, 1.1),
        candle(6, 1.1, 1.18, 1.08, 1.14),
        candle(7, 1.14, 1.22, 1.1, 1.18),
        candle(8, 1.18, 1.82, 1.16, 1.72),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "momentum_expansion_continuation");
  assert.equal(read.status, "active");
  assert.match(read.lines.join("\n"), /live 4h expansion candle/);
  assert.match(read.lines.join("\n"), /momentum-continuation read/);
});

test("buildChartThesisRead can identify same-day catalyst active-runner continuation", () => {
  const read = buildChartThesisRead({
    symbol: "CAT",
    currentPrice: 2.35,
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "same_day",
    },
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.2, 1.32, 1.15, 1.24),
        candle(2, 1.24, 1.38, 1.18, 1.3),
        candle(3, 1.3, 1.44, 1.22, 1.34),
        candle(4, 1.34, 1.48, 1.26, 1.4),
        candle(5, 1.4, 1.52, 1.32, 1.45),
        candle(6, 1.45, 1.58, 1.36, 1.5),
        candle(7, 1.5, 1.66, 1.42, 1.56),
        candle(8, 1.58, 2.48, 1.52, 2.35),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "catalyst_active_runner_continuation");
  assert.equal(read.status, "active");
  assert.match(read.lines.join("\n"), /same-day catalyst card/);
  assert.match(read.lines.join("\n"), /active 4h runner candle/);
});

test("buildChartThesisRead can use raw press-release catalyst context without a website card", () => {
  const read = buildChartThesisRead({
    symbol: "RAW",
    currentPrice: 2.35,
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "no_card",
      catalystContext: {
        source: "local_press_release_db",
        checked: true,
        timing: "same_day_premarket",
        freshness: "same_day",
        articleCount: 1,
        primaryArticle: {
          ingestEventId: "raw-1",
          ticker: "RAW",
          url: "raw-1",
          articlePath: null,
          title: "RAW announces fresh small-cap catalyst",
          publishedAt: "2026-06-01T12:00:00.000Z",
          eventType: "press_release",
          filingType: null,
          routeTag: null,
          sourceUrl: null,
          observedAt: null,
          sourceKind: "ingest_events",
        },
        articles: [],
        summary: "same day premarket catalyst",
      },
    },
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.2, 1.32, 1.15, 1.24),
        candle(2, 1.24, 1.38, 1.18, 1.3),
        candle(3, 1.3, 1.44, 1.22, 1.34),
        candle(4, 1.34, 1.48, 1.26, 1.4),
        candle(5, 1.4, 1.52, 1.32, 1.45),
        candle(6, 1.45, 1.58, 1.36, 1.5),
        candle(7, 1.5, 1.66, 1.42, 1.56),
        candle(8, 1.58, 2.48, 1.52, 2.35),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "catalyst_active_runner_continuation");
  assert.match(read.evidence.join("\n"), /same day premarket local press-release catalyst/);
  assert.match(read.lines.join("\n"), /fresh local press-release catalyst/);
  assert.match(read.lines.join("\n"), /RAW announces fresh small-cap catalyst/);
});

test("buildChartThesisRead does not use raw recent-prior catalyst context as active continuation fuel", () => {
  const read = buildChartThesisRead({
    symbol: "OLD",
    currentPrice: 2.35,
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "no_card",
      catalystContext: {
        source: "local_press_release_db",
        checked: true,
        timing: "recent_prior",
        freshness: "recent_1_2_days",
        articleCount: 1,
        primaryArticle: null,
        articles: [],
        summary: "recent prior catalyst",
      },
    },
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.2, 1.32, 1.15, 1.24),
        candle(2, 1.24, 1.38, 1.18, 1.3),
        candle(3, 1.3, 1.44, 1.22, 1.34),
        candle(4, 1.34, 1.48, 1.26, 1.4),
        candle(5, 1.4, 1.52, 1.32, 1.45),
        candle(6, 1.45, 1.58, 1.36, 1.5),
        candle(7, 1.5, 1.66, 1.42, 1.56),
        candle(8, 1.58, 2.48, 1.52, 2.35),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.notEqual(read?.type, "catalyst_active_runner_continuation");
});

test("buildChartThesisRead does not use catalyst active-runner read for stale catalyst cards", () => {
  const read = buildChartThesisRead({
    symbol: "OLD",
    currentPrice: 2.35,
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "stale_3_7_days",
    },
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.2, 1.32, 1.15, 1.24),
        candle(2, 1.24, 1.38, 1.18, 1.3),
        candle(3, 1.3, 1.44, 1.22, 1.34),
        candle(4, 1.34, 1.48, 1.26, 1.4),
        candle(5, 1.4, 1.52, 1.32, 1.45),
        candle(6, 1.45, 1.58, 1.36, 1.5),
        candle(7, 1.5, 1.66, 1.42, 1.56),
        candle(8, 1.58, 2.48, 1.52, 2.35),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.notEqual(read?.type, "catalyst_active_runner_continuation");
});

test("buildChartThesisRead can identify an early washout base reversal", () => {
  const read = buildChartThesisRead({
    symbol: "WASH",
    currentPrice: 0.55,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 0.72, 0.74, 0.68, 0.7),
        candle(2, 0.7, 0.72, 0.64, 0.65),
        candle(3, 0.65, 0.66, 0.6, 0.6),
        candle(4, 0.6, 0.63, 0.57, 0.59),
        candle(5, 0.6, 0.6, 0.55, 0.568),
        candle(6, 0.56, 0.57, 0.51, 0.53),
        candle(7, 0.53, 0.586, 0.52, 0.526),
        candle(8, 0.54, 0.64, 0.522, 0.622),
        candle(9, 0.6, 0.634, 0.536, 0.561),
        candle(10, 0.528, 0.576, 0.513, 0.55),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "washout_base_reversal");
  assert.equal(read.status, "early");
  assert.match(read.lines.join("\n"), /washed out near the lower end/);
  assert.match(read.lines.join("\n"), /base-reversal watch/);
});

test("buildChartThesisRead can identify a damaged range reclaim", () => {
  const read = buildChartThesisRead({
    symbol: "DAMAGE",
    currentPrice: 0.99,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.42, 1.55, 1.18, 1.38),
        candle(2, 1.36, 1.5, 1.12, 1.18),
        candle(3, 1.18, 1.34, 0.98, 1.08),
        candle(4, 1.08, 1.2, 0.92, 1.0),
        candle(5, 1.0, 1.12, 0.86, 0.94),
        candle(6, 0.94, 1.02, 0.84, 0.9),
        candle(7, 0.9, 1.04, 0.86, 0.93),
        candle(8, 0.92, 1.1, 0.88, 0.95),
        candle(9, 0.9, 1.26, 0.84, 0.99),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "damaged_range_reclaim");
  assert.equal(read.status, "early");
  assert.ok(read.roomToTargetPct > 18);
  assert.ok(read.roomToTargetPct < 30);
  assert.match(read.lines.join("\n"), /not a clean base reversal/);
  assert.match(read.lines.join("\n"), /repairing the damaged range/);
});

test("buildChartThesisRead can identify a below-range buyer reclaim", () => {
  const read = buildChartThesisRead({
    symbol: "RECLAIM",
    currentPrice: 1.1,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.34, 1.45, 1.18, 1.32),
        candle(2, 1.32, 1.42, 1.14, 1.22),
        candle(3, 1.22, 1.36, 1.08, 1.16),
        candle(4, 1.16, 1.3, 1.02, 1.08),
        candle(5, 1.08, 1.24, 0.98, 1.04),
        candle(6, 1.04, 1.18, 1.0, 1.06),
        candle(7, 1.06, 1.14, 0.99, 1.02),
        candle(8, 1.02, 1.12, 1.0, 1.04),
        candle(9, 1.04, 1.16, 0.98, 1.1),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "below_range_buyer_reclaim");
  assert.equal(read.status, "active");
  assert.ok(read.roomToTargetPct > 18);
  assert.ok(read.roomToTargetPct < 32);
  assert.match(read.lines.join("\n"), /buyers have started responding/);
  assert.match(read.lines.join("\n"), /buyer-reclaim read/);
});

test("buildChartThesisRead can identify a lower-range springboard watch", () => {
  const read = buildChartThesisRead({
    symbol: "SPRING",
    currentPrice: 1.06,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.55, 1.7, 1.48, 1.62),
        candle(2, 1.62, 1.68, 1.42, 1.5),
        candle(3, 1.5, 1.6, 1.34, 1.4),
        candle(4, 1.4, 1.5, 1.26, 1.32),
        candle(5, 1.32, 1.42, 1.18, 1.24),
        candle(6, 1.24, 1.34, 1.08, 1.16),
        candle(7, 1.16, 1.24, 1.02, 1.08),
        candle(8, 1.08, 1.2, 1.03, 1.12),
        candle(9, 1.05, 1.18, 1.02, 1.06),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "lower_range_springboard");
  assert.equal(read.status, "active");
  assert.ok(read.roomToTargetPct > 30);
  assert.match(read.lines.join("\n"), /lower-range springboard/);
  assert.match(read.lines.join("\n"), /risk marker has to stay wider/);
});

test("buildChartThesisRead can identify quiet range accumulation before breakout", () => {
  const read = buildChartThesisRead({
    symbol: "QUIET",
    currentPrice: 1.2,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.1, 1.42, 1.1, 1.18),
        candle(2, 1.18, 1.36, 1.12, 1.14),
        candle(3, 1.14, 1.32, 1.11, 1.21),
        candle(4, 1.2, 1.34, 1.13, 1.18),
        candle(5, 1.18, 1.3, 1.12, 1.24),
        candle(6, 1.22, 1.35, 1.13, 1.2),
        candle(7, 1.2, 1.31, 1.14, 1.25),
        candle(8, 1.25, 1.3, 1.15, 1.22),
        candle(9, 1.19, 1.28, 1.16, 1.2),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "quiet_range_accumulation");
  assert.equal(read.status, "early");
  assert.ok(read.roomToTargetPct > 15);
  assert.match(read.lines.join("\n"), /building quietly inside a 4h range/);
  assert.match(read.lines.join("\n"), /first accumulation trigger/);
});

test("buildChartThesisRead can identify a quiet base measured expansion watch", () => {
  const read = buildChartThesisRead({
    symbol: "BASE",
    currentPrice: 1.22,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.12, 1.33, 1.07, 1.18),
        candle(2, 1.18, 1.28, 1.09, 1.14),
        candle(3, 1.14, 1.27, 1.08, 1.2),
        candle(4, 1.2, 1.25, 1.1, 1.16),
        candle(5, 1.16, 1.24, 1.11, 1.2),
        candle(6, 1.2, 1.24, 1.12, 1.23),
        candle(7, 1.21, 1.25, 1.13, 1.24),
        candle(8, 1.2, 1.245, 1.14, 1.23),
        candle(9, 1.18, 1.255, 1.15, 1.22),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "quiet_base_measured_expansion");
  assert.equal(read.status, "watch");
  assert.ok(read.roomToTargetPct > 25);
  assert.match(read.lines.join("\n"), /quiet base is starting to expand/);
  assert.match(read.lines.join("\n"), /next practical destination/);
});

test("buildChartThesisRead can identify a controlled range breakout", () => {
  const read = buildChartThesisRead({
    symbol: "SHELF",
    currentPrice: 4.39,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 3.48, 4.0, 3.2, 3.85),
        candle(2, 3.85, 3.91, 3.19, 3.72),
        candle(3, 3.71, 3.95, 3.32, 3.93),
        candle(4, 3.93, 3.95, 3.72, 3.82),
        candle(5, 3.9, 3.96, 3.71, 3.92),
        candle(6, 3.92, 3.97, 3.9, 3.93),
        candle(7, 3.96, 4.09, 3.9, 4.08),
        candle(8, 4.06, 4.45, 4.05, 4.39),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.ok(read);
  assert.equal(read.type, "controlled_range_breakout");
  assert.equal(read.status, "active");
  assert.match(read.lines.join("\n"), /controlled 4h shelf/);
  assert.match(read.lines.join("\n"), /controlled breakout read/);
});

test("buildChartThesisRead can identify active-runner cleared shelf power continuation", () => {
  const input: ChartThesisEngineInput = {
    symbol: "POWER",
    currentPrice: 1.8,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.02, 1.12, 1.0, 1.08),
        candle(2, 1.08, 1.14, 1.01, 1.1),
        candle(3, 1.1, 1.15, 1.02, 1.12),
        candle(4, 1.12, 1.15, 1.03, 1.11),
        candle(5, 1.11, 1.14, 1.04, 1.13),
        candle(6, 1.13, 1.15, 1.05, 1.14),
        candle(7, 1.14, 1.15, 1.04, 1.13),
        candle(8, 1.45, 1.86, 1.4, 1.8),
      ]),
      "5m": response("5m", []),
    },
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "no_card",
    },
  };
  const read = buildChartThesisRead(input);

  assert.ok(read);
  assert.equal(read.type, "cleared_shelf_power_continuation");
  assert.equal(read.status, "active");
  assert.ok(read.roomToTargetPct >= 25);
  assert.match(read.lines.join("\n"), /cleared a tight 4h shelf/);
  assert.match(read.lines.join("\n"), /power-continuation area/);
  assert.equal(buildPotentialMoveRead(input)?.type, "cleared_shelf_power_continuation");
});

test("buildChartThesisRead can identify active-runner cleared shelf extension hold", () => {
  const input: ChartThesisEngineInput = {
    symbol: "HOLDUP",
    currentPrice: 1.75,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.02, 1.12, 1.0, 1.08),
        candle(2, 1.08, 1.14, 1.01, 1.1),
        candle(3, 1.1, 1.15, 1.02, 1.12),
        candle(4, 1.12, 1.15, 1.03, 1.11),
        candle(5, 1.11, 1.14, 1.04, 1.13),
        candle(6, 1.13, 1.15, 1.05, 1.14),
        candle(7, 1.14, 1.15, 1.04, 1.13),
        candle(8, 1.95, 2.05, 1.55, 1.67),
      ]),
      "5m": response("5m", []),
    },
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "no_card",
    },
  };
  const read = buildChartThesisRead(input);

  assert.ok(read);
  assert.equal(read.type, "cleared_shelf_power_continuation");
  assert.equal(read.status, "active");
  assert.ok(read.roomToTargetPct >= 25);
  assert.match(read.lines.join("\n"), /extension-hold read/);
  assert.match(read.lines.join("\n"), /chase-risk move/);
});

test("buildChartThesisRead labels hot 5m tape as volatile support for an existing active-runner thesis", () => {
  const fiveMinute = [
    ...Array.from({ length: 17 }, (_, index) =>
      minuteCandle(index * 5, 1.46, 1.54, 1.42, 1.5, 1_000_000),
    ),
    minuteCandle(85, 1.57, 1.82, 1.55, 1.8, 6_000_000),
  ];
  const read = buildChartThesisRead({
    symbol: "TAPE",
    currentPrice: 1.8,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.02, 1.5, 1.0, 1.2),
        candle(2, 1.12, 1.48, 1.02, 1.18),
        candle(3, 1.14, 1.49, 1.04, 1.22),
        candle(4, 1.2, 1.47, 1.03, 1.2),
        candle(5, 1.18, 1.46, 1.05, 1.24),
        candle(6, 1.23, 1.5, 1.08, 1.27),
        candle(7, 1.26, 1.49, 1.1, 1.29),
        candle(8, 1.42, 1.95, 1.35, 1.8),
      ]),
      "5m": response("5m", fiveMinute),
    },
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "same_day",
    },
  });

  assert.ok(read);
  assert.equal(read.type, "catalyst_active_runner_continuation");
  assert.equal(read.activeRunnerTape?.classification, "hot_volatile_5m_support");
  assert.equal(read.activeRunnerTape?.structure, "upper_range_control");
  assert.ok(read.activeRunnerTape.volumeRatio >= 5);
  assert.match(formatPotentialMoveRead(read).join("\n"), /5m tape supports the move, but volatility is elevated/);
  assert.match(formatPotentialMoveRead(read).join("\n"), /upper-range control/);
});

test("buildChartThesisRead labels extreme 5m tape as extended chase risk instead of a cleaner thesis", () => {
  const fiveMinute = [
    ...Array.from({ length: 17 }, (_, index) =>
      minuteCandle(index * 5, 1.46, 1.54, 1.42, 1.5, 1_000_000),
    ),
    minuteCandle(85, 1.55, 2.05, 1.5, 1.8, 32_000_000),
  ];
  const read = buildChartThesisRead({
    symbol: "CHASE",
    currentPrice: 1.8,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.02, 1.5, 1.0, 1.2),
        candle(2, 1.12, 1.48, 1.02, 1.18),
        candle(3, 1.14, 1.49, 1.04, 1.22),
        candle(4, 1.2, 1.47, 1.03, 1.2),
        candle(5, 1.18, 1.46, 1.05, 1.24),
        candle(6, 1.23, 1.5, 1.08, 1.27),
        candle(7, 1.26, 1.49, 1.1, 1.29),
        candle(8, 1.42, 1.95, 1.35, 1.8),
      ]),
      "5m": response("5m", fiveMinute),
    },
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "same_day",
    },
  });

  assert.ok(read);
  assert.equal(read.type, "catalyst_active_runner_continuation");
  assert.equal(read.activeRunnerTape?.classification, "extended_chase_risk");
  assert.match(formatPotentialMoveRead(read).join("\n"), /real momentum, but this is extended rather than clean/);
  assert.match(formatPotentialMoveRead(read).join("\n"), /momentum with chase risk/);
});

test("buildChartThesisRead labels lost near-term hold as caution instead of rejection", () => {
  const fiveMinute = [
    ...Array.from({ length: 17 }, (_, index) =>
      minuteCandle(index * 5, 1.62, 1.7, 1.58, 1.66, 1_000_000),
    ),
    minuteCandle(85, 1.72, 1.78, 1.55, 1.66, 7_000_000),
  ];
  const read = buildChartThesisRead({
    symbol: "HOLD",
    currentPrice: 1.66,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.02, 1.64, 1.0, 1.2),
        candle(2, 1.12, 1.66, 1.02, 1.18),
        candle(3, 1.14, 1.68, 1.04, 1.22),
        candle(4, 1.2, 1.65, 1.03, 1.2),
        candle(5, 1.18, 1.66, 1.05, 1.24),
        candle(6, 1.23, 1.68, 1.08, 1.27),
        candle(7, 1.26, 1.7, 1.1, 1.29),
        candle(8, 1.42, 2.05, 1.25, 1.8),
      ]),
      "5m": response("5m", fiveMinute),
    },
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "same_day",
    },
  });

  assert.ok(read);
  assert.equal(read.type, "catalyst_active_runner_continuation");
  assert.equal(read.activeRunnerTape?.structure, "lost_near_term_hold");
  assert.match(formatPotentialMoveRead(read).join("\n"), /below the near-term hold/);
  assert.match(formatPotentialMoveRead(read).join("\n"), /buyers need a reclaim/);
});

test("buildChartThesisRead does not use cleared shelf power continuation without active-runner context", () => {
  const read = buildChartThesisRead({
    symbol: "SHELFY",
    currentPrice: 1.8,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 1.02, 1.12, 1.0, 1.08),
        candle(2, 1.08, 1.14, 1.01, 1.1),
        candle(3, 1.1, 1.15, 1.02, 1.12),
        candle(4, 1.12, 1.15, 1.03, 1.11),
        candle(5, 1.11, 1.14, 1.04, 1.13),
        candle(6, 1.13, 1.15, 1.05, 1.14),
        candle(7, 1.14, 1.15, 1.04, 1.13),
        candle(8, 1.45, 1.86, 1.4, 1.8),
      ]),
      "5m": response("5m", []),
    },
  });

  assert.notEqual(read?.type, "cleared_shelf_power_continuation");
});

test("buildChartThesisRead can select internal upper-range ignition while trader read suppresses it", () => {
  const input: ChartThesisEngineInput = {
    symbol: "IGNITE",
    currentPrice: 3.9,
    seriesMap: {
      daily: response("daily", []),
      "4h": response("4h", [
        candle(1, 3.55, 3.7, 3.48, 3.62),
        candle(2, 3.62, 3.82, 3.55, 3.76),
        candle(3, 3.76, 3.95, 3.64, 3.82),
        candle(4, 3.82, 4.02, 3.7, 3.88),
        candle(5, 3.88, 4.04, 3.74, 3.92),
        candle(6, 3.9, 4.08, 3.78, 3.94),
        candle(7, 3.94, 4.1, 3.8, 3.9),
        candle(8, 3.86, 3.98, 3.82, 3.9),
      ]),
      "5m": response("5m", []),
    },
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: "no_card",
    },
  };
  const read = buildChartThesisRead(input);

  assert.equal(read?.type, "upper_range_ignition");
  assert.equal(buildPotentialMoveRead(input), null);
});

test("formatLevelSnapshotMessage renders chart thesis before trade map", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "MOVE",
    currentPrice: 1.18,
    supportZones: [{ representativePrice: 1.05, strengthLabel: "major", sourceLabel: "daily confluence" }],
    resistanceZones: [{ representativePrice: 1.32, strengthLabel: "major", sourceLabel: "daily confluence" }],
    timestamp: 1,
    potentialMoveRead: {
      type: "return_to_selloff_origin",
      label: "Return to selloff origin",
      timeframe: "daily",
      status: "active",
      confidence: "medium",
      score: 70,
      evidence: ["sharp selloff"],
      selloffOriginLow: 1.7,
      selloffOriginHigh: 1.82,
      buyerResponseLow: 1.02,
      reclaimTrigger: 1.32,
      returnTargetLow: 1.7,
      returnTargetHigh: 1.82,
      roomToTargetPct: 44.1,
      sessionsAgo: 2,
      lines: [
        "MOVE had a sharp daily selloff 2 sessions ago from the 1.70-1.82 area.",
        "Buyers responded near 1.02; holding above 1.32 keeps the return-to-origin path in play.",
        "If that reclaim holds, the chart has room back toward 1.70-1.82 (+44.1% to the lower edge).",
      ],
    },
  });

  assert.match(message, /Chart Thesis \(Active: Return to selloff origin, medium confidence\):/);
  assert.match(message, /return-to-origin path/);
  assert.ok(message.indexOf("Chart Thesis") < message.indexOf("Trade map:"));
});

test("formatLevelSnapshotMessage suppresses under-tested chart reads from the trader surface", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "MOVE",
    currentPrice: 1.18,
    supportZones: [{ representativePrice: 1.05, strengthLabel: "major", sourceLabel: "daily confluence" }],
    resistanceZones: [{ representativePrice: 1.32, strengthLabel: "major", sourceLabel: "daily confluence" }],
    timestamp: 1,
    potentialMoveRead: {
      type: "upper_range_ignition",
      label: "Upper-range ignition",
      timeframe: "4h",
      status: "watch",
      confidence: "medium",
      score: 66,
      triggerLow: 1.24,
      triggerHigh: 1.24,
      targetLow: 1.48,
      targetHigh: 1.48,
      invalidationLevel: 1.05,
      roomToTargetPct: 25.4,
      evidence: ["price is holding upper range"],
      lines: [
        "MOVE is holding the upper part of a recent 4h range from 1.05 to 1.24.",
        "A push through 1.24 would be the ignition trigger for continuation.",
        "If that trigger works, the first measured expansion area is near 1.48 (+25.4%).",
      ],
    },
  });

  assert.doesNotMatch(message, /Chart Watch/);
  assert.doesNotMatch(message, /Chart Thesis \(Setup watch: Upper-range ignition/);
  assert.doesNotMatch(message, /ignition trigger/);
  assert.match(message, /Trade map:/);
});
