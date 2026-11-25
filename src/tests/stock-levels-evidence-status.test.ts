import assert from "node:assert/strict";
import test from "node:test";
import type { LiveWatchlistLevelMap, LiveWatchlistLevelMapLevel } from "../lib/live-watchlist/live-watchlist-types.js";
import { bindAcceptedInputOrigins } from "../lib/market-data/accepted-input-origins.js";
import { bindAcceptedChartInput, type AcceptedChartInput } from "../lib/market-data/accepted-chart-input.js";
import type { CandleProviderResponse } from "../lib/market-data/candle-types.js";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import { SCANNER_LEVELS_DAILY_DATASET, SCANNER_LEVELS_EVIDENCE_PROFILE, SCANNER_LEVELS_REGULAR_DATASET } from "../lib/market-data/stock-levels-evidence-profile.js";
import type { StockLevelsChartEvidenceProvenance } from "../runtime/stock-levels-chart-provenance.js";
import { annotateStockLevelsEvidence } from "../runtime/stock-levels-evidence-status.js";
import { createStockLevelsGenerator } from "../runtime/stock-levels-generator.js";

// Synthetic classification/transport fixtures; no authentic issuer or registry.
const through = Date.parse("2026-11-20T18:30:00Z");
const formed = through - 3_600_000;
const ids = { daily: "11234567-89ab-4cde-8f01-23456789abcd", "4h": "01234567-89ab-4cde-8f01-23456789abcd" };
const receipt: AcceptedChartInput = {
  id: ids["4h"], digest: "d".repeat(64), instrumentId: "fixture-listing", symbol: "SYN", venue: "XNAS",
  frame: "4h", datasetId: SCANNER_LEVELS_REGULAR_DATASET, priceBasisId: "fixture-basis",
  calendarRevision: "fixture-calendar", sessionMode: "regular", completedThroughMs: through,
  acceptedCutoffMs: through + 100, availableAtMs: through + 100, acceptedAtMs: through + 200,
};
const { instrumentId, symbol, venue, ...input } = receipt;
const provenance: StockLevelsChartEvidenceProvenance = {
  version: 1, instrument: { id: instrumentId, symbol, venue }, calculatedAtMs: through + 1000,
  inputs: [input], zones: [{ side: "support", index: 0, inputIds: [ids["4h"]] }],
};
function level(change: Partial<LiveWatchlistLevelMapLevel> = {}): LiveWatchlistLevelMapLevel {
  return bindAcceptedInputOrigins({ side: "support", price: 1.5, lowPrice: 1.5, highPrice: 1.5,
    distancePct: -0.25, label: "fixture", freshness: "aging", sourceEvidenceCount: 1,
    marketDataProvenance: { formedAt: formed, sourceLastSeenAt: formed }, roleFlipState: "original", ...change }, [ids["4h"]]);
}
function map(value = level()): LiveWatchlistLevelMap {
  return { currentPrice: 2, rangeState: "normal", nearestSupport: value, nearestResistance: null,
    nextStrongSupport: null, nextStrongResistance: null, supportLevels: [value], resistanceLevels: [] };
}

test("receipt-bound observed structure is classified without changing geometry, state or aliases", () => {
  const value = map(); const before = JSON.parse(JSON.stringify(value));
  annotateStockLevelsEvidence(value, provenance);
  assert.equal(value.supportLevels[0]!.evidenceStatus, "detected_structure");
  assert.equal(value.nearestSupport, value.supportLevels[0]);
  assert.equal(JSON.stringify(value, (key, item) => key === "evidenceStatus" ? undefined : item), JSON.stringify(before));
});

for (const key of ["lastTestedAt", "lastConfirmedAt"] as const) {
  test(`only a recorded later ${key} establishes historical testing`, () => {
    const value = map(level({ marketDataProvenance: { formedAt: formed, sourceLastSeenAt: formed, [key]: formed + 1000 } }));
    annotateStockLevelsEvidence(value, provenance);
    assert.equal(value.supportLevels[0]!.evidenceStatus, "historically_tested");
    value.supportLevels[0]!.marketDataProvenance![key] = formed;
    annotateStockLevelsEvidence(value, provenance);
    assert.equal(value.supportLevels[0]!.evidenceStatus, "detected_structure");
  });
}

const invalid: Array<[string, Partial<LiveWatchlistLevelMapLevel>]> = [
  ["missing provenance", { marketDataProvenance: undefined }],
  ["zero evidence count", { sourceEvidenceCount: 0 }],
  ["missing evidence count", { sourceEvidenceCount: undefined }],
  ["fractional evidence count", { sourceEvidenceCount: 0.5 }],
  ["invalid formation", { marketDataProvenance: { formedAt: NaN, sourceLastSeenAt: formed } }],
  ["source before formation", { marketDataProvenance: { formedAt: formed, sourceLastSeenAt: formed - 1 } }],
  ["source after accepted input", { marketDataProvenance: { formedAt: formed, sourceLastSeenAt: through + 1 } }],
  ["test before formation", { marketDataProvenance: { formedAt: formed, sourceLastSeenAt: formed, lastTestedAt: formed - 1 } }],
  ["confirmation after accepted input", { marketDataProvenance: { formedAt: formed, sourceLastSeenAt: formed, lastConfirmedAt: through + 1 } }],
  ["incomplete bounds", { highPrice: undefined }],
  ["invalid bounds", { lowPrice: 2, highPrice: 1 }],
  ["invalid price", { price: 0 }],
  ["wrong side", { side: "resistance" }],
];
for (const [name, change] of invalid) {
  test(`unqualified ${name} cannot retain a positive classification`, () => {
    const value = map(level({ evidenceStatus: "historically_tested", ...change }));
    annotateStockLevelsEvidence(value, provenance);
    assert.equal(value.supportLevels[0]!.evidenceStatus, undefined);
  });
}

test("private original lineage and a known bound input are required", () => {
  for (const origins of [[], [ids.daily], [ids["4h"], ids.daily]]) {
    const value = map(bindAcceptedInputOrigins(level(), origins));
    annotateStockLevelsEvidence(value, provenance);
    assert.equal(value.supportLevels[0]!.evidenceStatus, undefined);
  }
  const unknown = { ...provenance, inputs: [] };
  const value = map(); annotateStockLevelsEvidence(value, unknown);
  assert.equal(value.supportLevels[0]!.evidenceStatus, undefined);
});

test("a supplied synthetic marker is preserved and freshness/testing are never promoted", () => {
  const synthetic = map(level({ evidenceStatus: "synthetic_planning" }));
  annotateStockLevelsEvidence(synthetic, provenance);
  assert.equal(synthetic.supportLevels[0]!.evidenceStatus, "synthetic_planning");
  const stale = map(level({ freshness: "stale", roleFlipState: "testing" }));
  annotateStockLevelsEvidence(stale, provenance);
  assert.equal(stale.supportLevels[0]!.evidenceStatus, "detected_structure");
  assert.equal(stale.supportLevels[0]!.freshness, "stale");
  assert.equal(stale.supportLevels[0]!.roleFlipState, "testing");
});

function series(frame: "daily" | "4h" | "5m"): CandleProviderResponse {
  const result: CandleProviderResponse = { provider: "alpaca", symbol: "SYN", timeframe: frame,
    requestedLookbackBars: 1, candles: frame === "5m" ? [] : [{ timestamp: formed, open: 1.5, high: 1.7, low: 1.4, close: 1.6, volume: 1000 }],
    fetchStartTimestamp: through, fetchEndTimestamp: through + 1000, requestedStartTimestamp: formed,
    requestedEndTimestamp: through, sessionMetadataAvailable: false, actualBarsReturned: frame === "5m" ? 0 : 1,
    completenessStatus: frame === "5m" ? "empty" : "complete", stale: false, validationIssues: [], sessionSummary: null };
  return frame === "5m" ? result : bindAcceptedChartInput(result, frame === "4h" ? receipt : {
    ...receipt, id: ids.daily, frame: "daily", datasetId: SCANNER_LEVELS_DAILY_DATASET, sessionMode: "extended" });
}
function output(change: Partial<LevelEngineOutput["majorSupport"][number]> = {}): LevelEngineOutput {
  const zone = bindAcceptedInputOrigins({ id: "fixture-zone", symbol: "SYN", kind: "support" as const,
    timeframeBias: "4h" as const, zoneLow: 1.5, zoneHigh: 1.5, representativePrice: 1.5,
    strengthScore: 40, strengthLabel: "major" as const, touchCount: 1, confluenceCount: 1,
    sourceTypes: ["swing_low" as const], timeframeSources: ["4h" as const], reactionQualityScore: 1,
    rejectionScore: 1, displacementScore: 1, sessionSignificanceScore: 1, followThroughScore: 1,
    sourceEvidenceCount: 1, firstTimestamp: formed, lastTimestamp: formed,
    marketDataProvenance: { formedAt: formed, sourceLastSeenAt: formed }, isExtension: false,
    freshness: "aging" as const, notes: [], ...change }, [ids["4h"]]);
  return { symbol: "SYN", generatedAt: through, metadata: { providerByTimeframe: { daily: "alpaca", "4h": "alpaca" },
    dataQualityFlags: [], freshness: "fresh", availableTimeframes: ["daily", "4h"] },
    majorSupport: [zone], majorResistance: [], intermediateSupport: [], intermediateResistance: [],
    intradaySupport: [], intradayResistance: [], extensionLevels: { support: [], resistance: [] },
    fullLadderLevels: { support: [zone], resistance: [] }, specialLevels: {} };
}

test("verified serialization carries classification; ordinary output and all existing map facts stay unchanged", async (t) => {
  const prior = { ...process.env }; t.after(() => { process.env = prior; });
  process.env.TRADERLINK_MARKET_DATA_PROVIDER = "alpaca";
  process.env.TRADERLINK_ALPACA_GATEWAY_URL = "https://fixture.invalid/";
  process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN = "fixture-only";
  delete process.env.TRADERLINK_GATEWAY_CONTRACT;
  t.mock.method(Date, "now", () => through + 1000);
  t.mock.method(globalThis, "fetch", async () => Response.json({ feed: "sip", snapshots: {
    SYN: { latestTrade: { p: 2, t: new Date(through + 900).toISOString() } } } }));
  const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => ({ output: output(),
    seriesMap: { daily: series("daily"), "4h": series("4h"), "5m": series("5m") } }) });
  const ordinary = await generator.generate("SYN");
  const verified = await generator.generate("SYN", SCANNER_LEVELS_EVIDENCE_PROFILE);
  assert.ok(ordinary.map && verified.map);
  assert.equal(ordinary.map.levelMap?.supportLevels[0]?.evidenceStatus, undefined);
  assert.equal(JSON.parse(JSON.stringify(verified)).map.levelMap.supportLevels[0].evidenceStatus, "detected_structure");
  assert.equal(JSON.stringify(verified, (key, value) => key === "evidenceStatus" ? undefined : value), JSON.stringify(ordinary));
});

for (const [name, change] of [
  ["stale-only", { freshness: "stale" }],
  ["no source evidence", { sourceEvidenceCount: 0 }],
  ["missing source clocks", { marketDataProvenance: undefined }],
  ["synthetic extension", { isExtension: true }],
] as const) {
  test(`verified ${name} output is unavailable rather than Scanner-ready`, async (t) => {
    const prior = { ...process.env }; t.after(() => { process.env = prior; });
    process.env.TRADERLINK_MARKET_DATA_PROVIDER = "alpaca";
    process.env.TRADERLINK_ALPACA_GATEWAY_URL = "https://fixture.invalid/";
    process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN = "fixture-only";
    delete process.env.TRADERLINK_GATEWAY_CONTRACT;
    t.mock.method(Date, "now", () => through + 1000);
    t.mock.method(globalThis, "fetch", async () => Response.json({ feed: "sip", snapshots: {
      SYN: { latestTrade: { p: 2, t: new Date(through + 900).toISOString() } } } }));
    const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => ({ output: output(change),
      seriesMap: { daily: series("daily"), "4h": series("4h"), "5m": series("5m") } }) });
    assert.ok((await generator.generate("SYN")).map);
    const result = await generator.generate("SYN", SCANNER_LEVELS_EVIDENCE_PROFILE);
    assert.equal(result.map, undefined); assert.equal(result.code, "market_data_unavailable");
  });
}
