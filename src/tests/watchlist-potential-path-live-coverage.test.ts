import assert from "node:assert/strict";
import test from "node:test";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import { buildLiveWatchlistPotentialPathPresentation } from "../lib/live-watchlist/live-watchlist-publisher.js";
import type { LiveWatchlistTickerDataPatch } from "../lib/live-watchlist/live-watchlist-types.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import {
  buildLevelSnapshotPayloadFromEngineOutput,
  ManualWatchlistRuntimeManager,
  type ManualWatchlistRuntimeManagerOptions,
} from "../lib/monitoring/manual-watchlist-runtime-manager.js";

const at = Date.parse("2026-11-23T15:00:00Z");

function zone(price: number, kind: "support" | "resistance" = "resistance"): FinalLevelZone {
  return {
    id: `${kind}-${price}`, symbol: "BNAI", kind, timeframeBias: "daily",
    zoneLow: price, zoneHigh: price, representativePrice: price,
    strengthScore: 0.65, strengthLabel: price === 7 ? "strong" : "moderate",
    touchCount: 2, confluenceCount: 1, sourceTypes: [kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["daily"], reactionQualityScore: 0.6, rejectionScore: 0.6,
    displacementScore: 0.5, sessionSignificanceScore: 0.5, followThroughScore: 0.6,
    gapContinuationScore: 0, sourceEvidenceCount: 2,
    firstTimestamp: at - 7 * 86_400_000, lastTimestamp: at - 86_400_000,
    isExtension: false, freshness: "fresh", notes: [],
  };
}

// Prices reported by the owner. This is a controlled regression, not a capture
// of the private live BNAI snapshot or newly fetched candle evidence.
function bnaiOutput(): LevelEngineOutput {
  const near = [6.32, 6.47, 6.72, 6.8, 6.88, 7, 7.14, 7.28, 7.43, 7.56].map(price => zone(price));
  return {
    symbol: "BNAI", generatedAt: at - 60_000,
    metadata: { providerByTimeframe: {}, dataQualityFlags: [], freshness: "fresh", referencePrice: 6.275 },
    majorSupport: [], intermediateSupport: [], intradaySupport: [],
    majorResistance: [], intermediateResistance: near, intradayResistance: [],
    extensionLevels: { support: [], resistance: [] }, specialLevels: {},
    fullLadderLevels: {
      support: [zone(6.2, "support"), zone(5.8, "support")],
      resistance: [...near, ...[8.47, 9.45, 10.18, 10.57, 12.08, 30, 60, 86.28].map(price => zone(price))],
    },
  };
}

function fixture(output: LevelEngineOutput) {
  const levelStore = new LevelStore();
  levelStore.setLevels(output);
  const patches: LiveWatchlistTickerDataPatch[] = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as ManualWatchlistRuntimeManagerOptions["candleFetchService"],
    monitor: {} as ManualWatchlistRuntimeManagerOptions["monitor"],
    discordAlertRouter: {} as ManualWatchlistRuntimeManagerOptions["discordAlertRouter"],
    opportunityRuntimeController: {} as ManualWatchlistRuntimeManagerOptions["opportunityRuntimeController"],
    levelStore, now: () => at, realtimeTickerPrices: () => true,
    liveWatchlistPublisher: {
      publish: async () => {}, publishHealth: async () => {},
      publishTickerData: async patch => { patches.push(patch); },
    },
  });
  // Exercise the actual quote-to-website publication path, without starting
  // workers, providers, analysis generation, persistence or external delivery.
  const runtime = manager as unknown as {
    publishLiveTickerData(update: { symbol: string; lastPrice: number; timestamp: number }): void;
    getFastResistanceReferences(symbol: string): Array<{ representativePrice: number }>;
  };
  let tick = 0;
  return {
    runtime,
    quote(price: number) {
      runtime.publishLiveTickerData({ symbol: output.symbol, lastPrice: price, timestamp: at + ++tick * 15_000 });
      const patch = patches.at(-1);
      assert.ok(patch?.levelMap);
      return patch;
    },
  };
}

test("BNAI live updates retain meaningful Full Ladder resistance beyond the old selected range", () => {
  const output = bnaiOutput();
  const original = JSON.stringify(output);
  const { levelMap, latestPrice } = fixture(output).quote(7.13);
  assert.equal(latestPrice, 7.13);
  assert.equal(levelMap?.currentPrice, 7.13);
  const resistance = levelMap!.resistanceLevels.map(level => level.price);
  assert.ok(resistance.includes(8.47), "known daily resistance at +18.8% must remain available");
  assert.ok(resistance.includes(9.45), "retain the next observed outer checkpoint at +32.5%");
  assert.equal(resistance.at(-1), 9.45);
  assert.ok(resistance.length <= 8);
  assert.ok(!resistance.includes(86.28), "the card must not expose the entire distant inventory");
  for (const level of [...levelMap!.supportLevels, ...levelMap!.resistanceLevels]) {
    assert.ok(Math.abs(level.distancePct - (level.price / 7.13 - 1)) < 1e-12);
  }
  assert.equal(JSON.stringify(output), original, "live selection must not mutate historical prices or evidence");
});

test("live quotes reselect from the same full pool as the initial Potential Path presentation", () => {
  const output = bnaiOutput();
  const live = fixture(output);
  for (const price of [6.275, 7.13, 8.6]) {
    const map = live.quote(price).levelMap!;
    const initial = buildLiveWatchlistPotentialPathPresentation(buildLevelSnapshotPayloadFromEngineOutput({
      output, symbol: output.symbol, currentPrice: price, timestamp: at,
    })).levelMap!;
    assert.deepEqual(map.supportLevels.map(level => level.price), initial.supportLevels.map(level => level.price));
    assert.deepEqual(map.resistanceLevels.map(level => level.price), initial.resistanceLevels.map(level => level.price));
    assert.ok(map.supportLevels.length <= 8 && map.resistanceLevels.length <= 8);
  }
  const moved = live.quote(8.6).levelMap!;
  assert.ok(moved.supportLevels.some(level => level.price === 8.47 && level.roleFlipState === "confirmed"));
});

test("live support includes historical shelves that were outside the tactical buckets", () => {
  const output = bnaiOutput();
  output.intermediateResistance = [];
  output.fullLadderLevels!.resistance = [];
  const map = fixture(output).quote(7.13).levelMap!;
  assert.ok(map.supportLevels.some(level => level.price === 6.2));
  assert.ok(map.supportLevels.some(level => level.price === 5.8));
});

test("adding the full pool preserves clustering, factual empty sides and synthetic resistance exclusions", () => {
  const output = bnaiOutput();
  output.intermediateResistance = [];
  output.fullLadderLevels = { support: [], resistance: [
    zone(7.43), zone(7.44), zone(8.47), zone(9.45),
    { ...zone(8), notes: ["snapshot_continuation_map"] },
    zone(86.28),
  ] };
  const map = fixture(output).quote(7.13).levelMap!;
  assert.equal(map.supportLevels.length, 0, "never manufacture support to fill the card");
  assert.equal(map.resistanceLevels.filter(level => level.price === 7.43 || level.price === 7.44).length, 1);
  assert.ok(!map.resistanceLevels.some(level => level.price === 8 || level.price === 86.28));
  assert.ok(map.resistanceLevels.some(level => level.price === 8.47));
});

test("legacy outputs without Full Ladder still publish their existing levels", () => {
  const output = bnaiOutput();
  delete output.fullLadderLevels;
  const map = fixture(output).quote(7.13).levelMap!;
  assert.ok(map.resistanceLevels.length > 0);
  assert.ok(!map.resistanceLevels.some(level => level.price === 8.47));
});

test("website coverage does not broaden the separate fast-monitor resistance inventory", () => {
  const live = fixture(bnaiOutput());
  assert.ok(!live.runtime.getFastResistanceReferences("BNAI").some(level => level.representativePrice === 8.47));
  assert.ok(live.quote(7.13).levelMap!.resistanceLevels.some(level => level.price === 8.47));
});
