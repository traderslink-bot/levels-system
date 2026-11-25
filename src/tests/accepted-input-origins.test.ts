import assert from "node:assert/strict";
import test from "node:test";
import {
  bindAcceptedInputOrigins,
  inheritAcceptedInputOrigins,
  readAcceptedInputOrigins,
} from "../lib/market-data/accepted-input-origins.js";
import { clusterRawLevelCandidates } from "../lib/levels/level-clusterer.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { buildRawLevelCandidates } from "../lib/levels/raw-level-candidate-builder.js";
import type { FinalLevelZone, LevelEngineOutput, RawLevelCandidate } from "../lib/levels/level-types.js";
import { CandleFetchService, type HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import { buildLevelSnapshotPayloadFromEngineOutput } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import {
  buildLiveWatchlistLevelMap,
  buildLiveWatchlistPotentialPathPresentation,
} from "../lib/live-watchlist/live-watchlist-publisher.js";

// Synthetic lineage mechanics only. These IDs certify no real market input.
const at = Date.parse("2026-11-20T15:00:00Z");

function raw(frame: "daily" | "4h", withOrigins = true): RawLevelCandidate {
  const interval = frame === "daily" ? 86_400_000 : 14_400_000;
  const candles = [
    [1.30, 1.36, 1.27, 1.34], [1.34, 1.39, 1.31, 1.37],
    [1.37, 1.76, 1.34, 1.46], [1.45, 1.55, 1.40, 1.43],
    [1.43, 1.48, 1.38, 1.41],
  ].map(([open, high, low, close], index) => ({
    timestamp: at - (4 - index) * interval, open: open!, high: high!, low: low!, close: close!, volume: 2000,
  }));
  const candidates = buildRawLevelCandidates({
    symbol: "SYN", timeframe: frame, candles,
    swings: [{ index: 2, timestamp: candles[2]!.timestamp, price: 1.76,
      kind: "resistance", strength: 1, displacement: 0.2, separation: 2, reactionCount: 2 }],
    ...(withOrigins ? { inputOrigins: bindAcceptedInputOrigins({}, [`synthetic-${frame}-revision`]) } : {}),
  });
  const candidate = candidates.find((item) => item.kind === "resistance" && item.price === 1.76);
  assert.ok(candidate);
  return candidate;
}

function zone(candidates: RawLevelCandidate[]): FinalLevelZone {
  const zones = clusterRawLevelCandidates("SYN", "resistance", candidates, 0.03, DEFAULT_LEVEL_ENGINE_CONFIG, at);
  assert.equal(zones.length, 1);
  // Strength is a fixture setting; this suite does not evaluate trading quality.
  return { ...zones[0]!, strengthLabel: "major", strengthScore: 9 };
}

function present(resistance: FinalLevelZone) {
  const output: LevelEngineOutput = {
    symbol: "SYN", generatedAt: at,
    metadata: { providerByTimeframe: { daily: "stub", "4h": "stub" },
      dataQualityFlags: [], freshness: "fresh", availableTimeframes: ["daily", "4h"] },
    majorSupport: [], majorResistance: [resistance], intermediateSupport: [], intermediateResistance: [],
    intradaySupport: [], intradayResistance: [], extensionLevels: { support: [], resistance: [] },
    specialLevels: {}, fullLadderLevels: { support: [], resistance: [resistance] },
  };
  return buildLiveWatchlistPotentialPathPresentation(buildLevelSnapshotPayloadFromEngineOutput({
    output, symbol: "SYN", currentPrice: 1.6, timestamp: at,
  }));
}

test("lineage is private JSON-free metadata and survives ordinary object copying", () => {
  const original = { price: 1.76 };
  const tagged = bindAcceptedInputOrigins(original, ["synthetic-4h-revision"]);
  assert.equal(readAcceptedInputOrigins(original), undefined);
  assert.deepEqual(readAcceptedInputOrigins({ ...tagged }), ["synthetic-4h-revision"]);
  assert.equal(JSON.stringify(tagged), JSON.stringify(original));
  assert.deepEqual(Object.keys(tagged), Object.keys(original));
  assert.ok(Object.isFrozen(readAcceptedInputOrigins(tagged)));
});

test("a missing contributor clears attribution even when the target copied a known contributor", () => {
  const known = bindAcceptedInputOrigins({ price: 1.76 }, ["synthetic-4h-revision"]);
  const merged = inheritAcceptedInputOrigins({ ...known }, known, { price: 1.77 });
  assert.equal(readAcceptedInputOrigins(merged), undefined);
  assert.equal(readAcceptedInputOrigins(bindAcceptedInputOrigins(known, [])), undefined);
  assert.equal(readAcceptedInputOrigins(bindAcceptedInputOrigins(known, [""])), undefined);
});

test("actual raw candidate construction and cluster unions retain all mixed input revisions", () => {
  const daily = raw("daily"), fourHour = raw("4h");
  assert.deepEqual(readAcceptedInputOrigins(daily), ["synthetic-daily-revision"]);
  assert.deepEqual(readAcceptedInputOrigins(fourHour), ["synthetic-4h-revision"]);
  const mixed = zone([daily, fourHour]);
  assert.deepEqual(readAcceptedInputOrigins(mixed), ["synthetic-daily-revision", "synthetic-4h-revision"]);
  assert.deepEqual(new Set(mixed.timeframeSources), new Set(["daily", "4h"]));
  assert.equal(readAcceptedInputOrigins(zone([daily, raw("4h", false)])), undefined);
});

test("snapshot and final publisher retain exact selected lineage without changing public map or ladder bytes", () => {
  const mixed = zone([raw("daily"), raw("4h")]);
  const tagged = present(mixed), baseline = present(bindAcceptedInputOrigins(mixed, []));
  assert.ok(tagged.levelMap);
  assert.equal(tagged.levelMap.resistanceLevels.length, 1);
  assert.deepEqual(readAcceptedInputOrigins(tagged.levelMap.resistanceLevels[0]!),
    ["synthetic-daily-revision", "synthetic-4h-revision"]);
  assert.equal(JSON.stringify(tagged), JSON.stringify(baseline));
  assert.equal(tagged.fullLadderCard?.body, baseline.fullLadderCard?.body);
});

test("publisher suppression retains the selected winner's origins without claiming discarded evidence", () => {
  const winner = bindAcceptedInputOrigins({ representativePrice: 1.76, strengthLabel: "major" as const,
    sourceLabel: "Daily structure", sourceEvidenceCount: 5 }, ["synthetic-winner-revision"]);
  const rejected = bindAcceptedInputOrigins({ representativePrice: 1.76, strengthLabel: "moderate" as const,
    sourceLabel: "4h structure", sourceEvidenceCount: 1 }, ["synthetic-rejected-revision"]);
  const map = buildLiveWatchlistLevelMap({ currentPrice: 1.6, supportZones: [], resistanceZones: [rejected, winner] });
  assert.ok(map);
  assert.equal(map.resistanceLevels.length, 1);
  assert.deepEqual(readAcceptedInputOrigins(map.resistanceLevels[0]!), ["synthetic-winner-revision"]);
});

test("display labels and matching prices cannot create missing input lineage", () => {
  const unqualified = present(zone([raw("4h", false)]));
  assert.ok(unqualified.levelMap?.resistanceLevels.length);
  assert.equal(readAcceptedInputOrigins(unqualified.levelMap.resistanceLevels[0]!), undefined);
});

test("second-pass merging preserves both origins and refuses an incomplete origin chain", () => {
  const daily = raw("daily");
  const other = { ...raw("4h"), price: 1.77 };
  const merged = clusterRawLevelCandidates("SYN", "resistance", [daily, other], 0, DEFAULT_LEVEL_ENGINE_CONFIG, at);
  assert.equal(merged.length, 1);
  assert.deepEqual(readAcceptedInputOrigins(merged[0]!), ["synthetic-daily-revision", "synthetic-4h-revision"]);
  const unknown = clusterRawLevelCandidates("SYN", "resistance",
    [daily, bindAcceptedInputOrigins(other, [])], 0, DEFAULT_LEVEL_ENGINE_CONFIG, at);
  assert.equal(unknown.length, 1);
  assert.equal(readAcceptedInputOrigins(unknown[0]!), undefined);
});

test("the actual fetch/finalization/engine path carries admitted series identities to structural output", async () => {
  const frames: string[] = [];
  const service = new CandleFetchService({
    providerName: "stub",
    async fetchCandles(request: HistoricalFetchRequest) {
      frames.push(request.timeframe);
      const step = request.timeframe === "daily" ? 86_400_000 : 14_400_000;
      const highs = [1.36, 1.39, 1.76, 1.55, 1.48];
      return bindAcceptedInputOrigins({
        provider: "stub" as const, symbol: request.symbol, timeframe: request.timeframe,
        requestedLookbackBars: 5,
        candles: highs.map((high, index) => ({ timestamp: at - (4 - index) * step,
          open: 1.35, high, low: 1.25, close: 1.34, volume: 2000 })),
        fetchStartTimestamp: at, fetchEndTimestamp: at,
        requestedStartTimestamp: at - 5 * step, requestedEndTimestamp: at,
        sessionMetadataAvailable: false,
      }, [`synthetic-${request.timeframe}-revision`]);
    },
  });
  const request = (timeframe: "daily" | "4h" | "5m") => ({ symbol: "SYN", timeframe, lookbackBars: 5, endTimeMs: at });
  const result = await new LevelEngine(service).generateLevelsWithCandleSeries({
    symbol: "SYN", referencePriceOverride: 1.6, includeFiveMinute: false,
    historicalRequests: { daily: request("daily"), "4h": request("4h"), "5m": request("5m") },
  });
  assert.deepEqual(frames, ["daily", "4h"]);
  assert.deepEqual(readAcceptedInputOrigins(result.seriesMap.daily), ["synthetic-daily-revision"]);
  const levels = [...(result.output.fullLadderLevels?.support ?? []), ...(result.output.fullLadderLevels?.resistance ?? [])];
  assert.ok(levels.some((item) => readAcceptedInputOrigins(item)?.includes("synthetic-4h-revision")));
});
