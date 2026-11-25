import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { AlpacaRuntimeHistoricalProvider } from "../lib/market-data/alpaca-runtime-providers.js";
import {
  admitAcceptedChartInput, bindAcceptedChartInput, readAcceptedChartInput, type AcceptedChartInput,
} from "../lib/market-data/accepted-chart-input.js";
import { bindAcceptedInputOrigins, readAcceptedInputOrigins } from "../lib/market-data/accepted-input-origins.js";
import type { CandleProviderResponse } from "../lib/market-data/candle-types.js";
import { encodeGatewayWire } from "../lib/market-data/traderslink-gateway-wire.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import type { LevelEngineOutput, FinalLevelZone } from "../lib/levels/level-types.js";
import { createStockLevelsGenerator } from "../runtime/stock-levels-generator.js";
import { buildStockLevelsChartProvenance } from "../runtime/stock-levels-chart-provenance.js";
import { SCANNER_LEVELS_DAILY_DATASET, SCANNER_LEVELS_EVIDENCE_PROFILE, SCANNER_LEVELS_REGULAR_DATASET } from "../lib/market-data/stock-levels-evidence-profile.js";

// Synthetic acceptance mechanics. No fixture is an authentic market receipt.
const through = Date.parse("2026-11-20T18:30:00Z");
const received = through + 2000;
const id = "01234567-89ab-4cde-8f01-23456789abcd";
const accepted: AcceptedChartInput = {
  id, digest: "d".repeat(64), instrumentId: "synthetic-listing", symbol: "SYN", venue: "XNAS",
  frame: "4h", datasetId: "synthetic-sip", priceBasisId: "synthetic-split-basis",
  calendarRevision: "synthetic-calendar", sessionMode: "regular",
  completedThroughMs: through, availableAtMs: through + 400,
  acceptedCutoffMs: through + 600, acceptedAtMs: through + 700,
  upstreamRevision: "synthetic-source-revision",
};
const bar = { time: (through - 14_400_000) / 1000, open: 1.6, high: 1.8, low: 1.5, close: 1.7, volume: 1200 };
const request = { symbol: "SYN", timeframe: "4h" as const, lookbackBars: 1, acceptedEvidence: true };
const plan = { plannedBarCount: 1, requestStartTimestamp: through - 14_400_000, requestEndTimestamp: through + 1000 };

function environment(t: TestContext, wire = false) {
  const prior = { ...process.env };
  t.after(() => { process.env = prior; });
  if (wire) process.env.TRADERLINK_GATEWAY_CONTRACT = "traderslink.market.1";
  else delete process.env.TRADERLINK_GATEWAY_CONTRACT;
}
function payload(extra: Record<string, unknown> = {}) {
  return { symbol: "SYN", feed: "sip", adjustment: "split", complete: true,
    nextPageToken: null, bars: [bar], acceptedInput: accepted, ...extra };
}
function provider(body: unknown, seen: URL[] = []) {
  return new AlpacaRuntimeHistoricalProvider({ url: "https://gateway.invalid/", token: "synthetic-only", now: () => received,
    fetcher: (async (url: URL | RequestInfo) => {
      seen.push(new URL(String(url))); return Response.json(body);
    }) as typeof fetch });
}
function series(frame: "daily" | "4h" | "5m", input?: AcceptedChartInput): CandleProviderResponse {
  const result: CandleProviderResponse = {
    provider: "stub", symbol: "SYN", timeframe: frame, requestedLookbackBars: 1,
    candles: frame === "4h" || input ? [{ timestamp: bar.time * 1000,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }] : [],
    fetchStartTimestamp: received - 100, fetchEndTimestamp: received,
    requestedStartTimestamp: plan.requestStartTimestamp, requestedEndTimestamp: plan.requestEndTimestamp,
    sessionMetadataAvailable: false, actualBarsReturned: frame === "4h" || input ? 1 : 0,
    completenessStatus: frame === "4h" || input ? "complete" : "empty", stale: false,
    validationIssues: [], sessionSummary: null,
  };
  return input ? bindAcceptedChartInput(result, input) : result;
}
function output(extension = false): LevelEngineOutput {
  const zone: FinalLevelZone = bindAcceptedInputOrigins({
    id: "synthetic-zone", symbol: "SYN", kind: "support", timeframeBias: "4h",
    zoneLow: 1.5, zoneHigh: 1.5, representativePrice: 1.5, strengthScore: 9, strengthLabel: "major",
    touchCount: 2, confluenceCount: 1, sourceTypes: ["swing_low"], timeframeSources: ["4h"],
    reactionQualityScore: 1, rejectionScore: 1, displacementScore: 1, sessionSignificanceScore: 1,
    followThroughScore: 1, sourceEvidenceCount: 1, firstTimestamp: bar.time * 1000,
    lastTimestamp: bar.time * 1000, isExtension: extension, freshness: "fresh", notes: [],
  }, [id]);
  return { symbol: "SYN", generatedAt: through - 1000,
    metadata: { providerByTimeframe: { "4h": "stub" }, dataQualityFlags: [], freshness: "fresh", availableTimeframes: ["4h"] },
    majorSupport: [zone], majorResistance: [], intermediateSupport: [], intermediateResistance: [],
    intradaySupport: [], intradayResistance: [], extensionLevels: { support: [], resistance: [] },
    fullLadderLevels: { support: [zone], resistance: [] }, specialLevels: {} };
}

test("metadata opt-in preserves candles and keeps receipts private; ordinary requests do not opt in", async (t) => {
  environment(t);
  const urls: URL[] = [], adapter = provider(payload(), urls);
  const tagged = await adapter.fetchCandles(request, plan);
  const ordinary = await adapter.fetchCandles({ ...request, acceptedEvidence: undefined }, plan);
  assert.equal(urls[0]!.searchParams.get("acceptedEvidence"), "1");
  assert.equal(urls[1]!.searchParams.has("acceptedEvidence"), false);
  assert.deepEqual(readAcceptedInputOrigins(tagged), [id]);
  assert.deepEqual(readAcceptedChartInput(tagged), accepted);
  assert.equal(readAcceptedChartInput(ordinary), undefined);
  assert.equal(JSON.stringify(tagged), JSON.stringify(ordinary));
});

test("normalization or incomplete/mismatched receipt withholds metadata and preserves existing candle normalization", async (t) => {
  environment(t);
  const cases = [
    payload({ bars: [bar, bar] }),
    payload({ bars: [{ ...bar, time: bar.time + 60 }, bar] }),
    payload({ bars: [{ ...bar, time: bar.time - 60 }, bar] }),
    payload({ nextPageToken: "more" }),
    payload({ acceptedInput: { ...accepted, symbol: "OTHER" } }),
    payload({ acceptedInput: { ...accepted, acceptedCutoffMs: accepted.acceptedAtMs + 1 } }),
    payload({ acceptedInput: { ...accepted, acceptedAtMs: received + 1 } }),
    payload({ acceptedInput: undefined }),
  ];
  for (const body of cases) {
    const result = await provider(body).fetchCandles(request, plan);
    assert.ok(result.candles.length);
    assert.equal(readAcceptedChartInput(result), undefined);
    assert.equal(readAcceptedInputOrigins(result), undefined);
  }
});

test("exact neutral wire carries the receipt; malformed optional wire metadata cannot mask candle errors", async (t) => {
  environment(t, true);
  const urls: URL[] = [];
  const result = await provider(encodeGatewayWire("history", payload()), urls).fetchCandles(request, plan);
  assert.equal(urls[0]!.searchParams.get("includeAcceptance"), "1");
  assert.deepEqual(readAcceptedChartInput(result), accepted);
  const malformed = encodeGatewayWire("history", payload({ acceptedInput: undefined })) as { data: Record<string, unknown> };
  malformed.data.acceptedInput = [];
  const fallback = await provider(malformed).fetchCandles(request, plan);
  assert.equal(readAcceptedChartInput(fallback), undefined);
  assert.deepEqual(fallback.candles, result.candles);
  const invalidCandle = encodeGatewayWire("history", payload({ acceptedInput: undefined, bars: [{ ...bar, low: -1 }] }));
  await assert.rejects(provider(invalidCandle).fetchCandles(request, plan), /Invalid Alpaca candle/);
});

test("Generator binds final origins and an actual post-compute clock while retaining its original map timestamp", async (t) => {
  environment(t);
  process.env.TRADERLINK_MARKET_DATA_PROVIDER = "alpaca";
  process.env.TRADERLINK_ALPACA_GATEWAY_URL = "https://gateway.invalid/";
  process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN = "synthetic-only";
  let now = received;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => Response.json({ feed: "sip", snapshots: {
    SYN: { latestTrade: { p: 1.7, t: new Date(received - 100).toISOString() } },
  } }));
  const map = output();
  const seriesMap = { daily: series("daily"), "4h": series("4h", accepted), "5m": series("5m") };
  const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => {
    now = received + 800; return { output: map, seriesMap };
  } });
  const result = await generator.generate("SYN");
  assert.ok(result.map?.chartEvidenceProvenance);
  assert.equal(result.map.calculatedAt, through - 1000);
  assert.equal(result.map.chartEvidenceProvenance.calculatedAtMs, received + 800);
  assert.deepEqual(result.map.chartEvidenceProvenance.zones, [{ side: "support", index: 0, inputIds: [id] }]);
  assert.equal(result.map.chartEvidenceProvenance.inputs[0]!.id, id);
  assert.equal(result.map.chartEvidenceProvenance.inputs[0]!.digest, accepted.digest);
  const baseline = await createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => ({ output: map }) }).generate("SYN");
  const { chartEvidenceProvenance: _private, ...publicMap } = result.map;
  assert.equal(JSON.stringify(publicMap), JSON.stringify(baseline.map));
  const extension = await createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => ({ output: output(true), seriesMap }) }).generate("SYN");
  assert.ok(extension.map);
  assert.equal(extension.map.chartEvidenceProvenance, undefined);
});

test("all consumed series must be qualified with coherent identity and actual available clocks", () => {
  const level = bindAcceptedInputOrigins({ side: "support" as const, price: 1.5, distancePct: -0.1, label: "synthetic" }, [id]);
  const levelMap = { currentPrice: 1.7, rangeState: "normal" as const, nearestSupport: level, nearestResistance: null,
    nextStrongSupport: null, nextStrongResistance: null, supportLevels: [level], resistanceLevels: [] };
  const inputs = { daily: series("daily"), "4h": series("4h", accepted), "5m": series("5m") };
  assert.ok(buildStockLevelsChartProvenance({ symbol: "SYN", seriesMap: inputs, levelMap, calculatedAtMs: received }));
  const daily = { ...accepted, id: "11234567-89ab-4cde-8f01-23456789abcd", frame: "daily" as const, instrumentId: "different" };
  assert.equal(buildStockLevelsChartProvenance({ symbol: "SYN", seriesMap: { ...inputs, daily: series("daily", daily) }, levelMap, calculatedAtMs: received }), undefined);
  assert.equal(buildStockLevelsChartProvenance({ symbol: "SYN", seriesMap: inputs, levelMap, calculatedAtMs: through }), undefined);
  assert.equal(admitAcceptedChartInput({ ...accepted, availableAtMs: accepted.acceptedAtMs + 1 },
    { symbol: "SYN", frame: "4h", requestEndMs: plan.requestEndTimestamp, receivedAtMs: received }), undefined);
});

test("shared historical profile alone does not opt Private Watchlists into acceptance", async () => {
  const captured: Array<{ historicalRequests: Record<string, { acceptedEvidence?: boolean }> }> = [];
  const fake = {
    options: { candleFetchService: {} },
    buildLevelSeedHistoricalRequests: () => ({
      daily: { symbol: "SYN", timeframe: "daily", lookbackBars: 5 },
      "4h": { symbol: "SYN", timeframe: "4h", lookbackBars: 5 },
      "5m": { symbol: "SYN", timeframe: "5m", lookbackBars: 5 },
    }),
    levelEngine: { generateLevelsWithCandleSeries: async (value: (typeof captured)[number]) => { captured.push(value); } },
  } as unknown as ManualWatchlistRuntimeManager;
  const generate = ManualWatchlistRuntimeManager.prototype.generateLevelsWithWatchlistConfiguration;
  await generate.call(fake, { symbol: "SYN", referencePriceOverride: 1.7, calculationProfile: "dashboard_eodhd_daily_4h" });
  await generate.call(fake, { symbol: "SYN", referencePriceOverride: 1.7, calculationProfile: "dashboard_eodhd_daily_4h", acceptedEvidence: true });
  await generate.call(fake, { symbol: "SYN", referencePriceOverride: 1.7, calculationProfile: "watchlist", acceptedEvidence: true });
  assert.deepEqual(Object.values(captured[0]!.historicalRequests).map((row) => row.acceptedEvidence), [undefined, undefined, undefined]);
  assert.deepEqual(Object.values(captured[1]!.historicalRequests).map((row) => row.acceptedEvidence), [true, true, undefined]);
  assert.deepEqual(Object.values(captured[2]!.historicalRequests).map((row) => row.acceptedEvidence), [undefined, undefined, undefined]);
});

test("strict evidence requires a single-frame 4H final zone even when both inputs are accepted", async (t) => {
  environment(t);
  process.env.TRADERLINK_MARKET_DATA_PROVIDER = "alpaca";
  process.env.TRADERLINK_ALPACA_GATEWAY_URL = "https://gateway.invalid/";
  process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN = "synthetic-only";
  t.mock.method(Date, "now", () => received);
  t.mock.method(globalThis, "fetch", async () => Response.json({ feed: "sip", snapshots: {
    SYN: { latestTrade: { p: 1.7, t: new Date(received - 100).toISOString() } },
  } }));
  const daily: AcceptedChartInput = { ...accepted, id: "11234567-89ab-4cde-8f01-23456789abcd",
    frame: "daily", datasetId: SCANNER_LEVELS_DAILY_DATASET, sessionMode: "extended" };
  const fourHour: AcceptedChartInput = { ...accepted, datasetId: SCANNER_LEVELS_REGULAR_DATASET };
  for (const origins of [[daily.id], [daily.id, fourHour.id]]) {
    const map = output();
    const zone = bindAcceptedInputOrigins(map.majorSupport[0]!, origins);
    map.majorSupport = [zone]; map.fullLadderLevels = { support: [zone], resistance: [] };
    const seriesMap = { daily: series("daily", daily), "4h": series("4h", fourHour), "5m": series("5m") };
    const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => ({ output: map, seriesMap }) });
    assert.ok((await generator.generate("SYN")).map?.chartEvidenceProvenance);
    const result = await generator.generate("SYN", SCANNER_LEVELS_EVIDENCE_PROFILE);
    assert.equal(result.map, undefined);
    assert.equal(result.code, "market_data_unavailable");
  }
});

test("explicit manager profile preserves native Daily, forces accepted regular 4H and omits 5m execution", async () => {
  let captured: Record<string, unknown> | undefined;
  const fake = {
    options: { candleFetchService: { getProviderName: () => "alpaca" } },
    buildLevelSeedHistoricalRequests: () => ({
      daily: { symbol: "SYN", timeframe: "daily", lookbackBars: 520 },
      "4h": { symbol: "SYN", timeframe: "4h", lookbackBars: 180 },
      "5m": { symbol: "SYN", timeframe: "5m", lookbackBars: 390 },
    }),
    levelEngine: { generateLevelsWithCandleSeries: async (value: Record<string, unknown>) => { captured = value; } },
  } as unknown as ManualWatchlistRuntimeManager;
  await ManualWatchlistRuntimeManager.prototype.generateLevelsWithWatchlistConfiguration.call(fake, {
    symbol: "SYN", referencePriceOverride: 1.7, calculationProfile: SCANNER_LEVELS_EVIDENCE_PROFILE,
  });
  assert.equal(captured?.includeFiveMinute, false);
  assert.deepEqual(captured?.historicalRequests, {
    daily: { symbol: "SYN", timeframe: "daily", lookbackBars: 520, acceptedEvidence: true },
    "4h": { symbol: "SYN", timeframe: "4h", lookbackBars: 180, acceptedEvidence: true, sessionMode: "regular" },
    "5m": { symbol: "SYN", timeframe: "5m", lookbackBars: 390 },
  });
});
