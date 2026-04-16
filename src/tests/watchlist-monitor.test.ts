import assert from "node:assert/strict";
import test from "node:test";

import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import type { LivePriceListener, LivePriceProvider } from "../lib/monitoring/live-price-types.js";
import type { MonitoringEvent, WatchlistEntry } from "../lib/monitoring/monitoring-types.js";

class FakeLivePriceProvider implements LivePriceProvider {
  public listener?: LivePriceListener;

  async start(entries: WatchlistEntry[], onUpdate: LivePriceListener): Promise<void> {
    this.listener = onUpdate;
  }

  async stop(): Promise<void> {
    this.listener = undefined;
  }
}

function buildZone(params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "symbol" | "kind">): FinalLevelZone {
  return {
    timeframeBias: "5m",
    zoneLow: params.kind === "support" ? 1.9 : 2.4,
    zoneHigh: params.kind === "support" ? 2.0 : 2.5,
    representativePrice: params.kind === "support" ? 1.95 : 2.45,
    strengthScore: 22,
    strengthLabel: "moderate",
    touchCount: 3,
    confluenceCount: 1,
    sourceTypes: [params.kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.62,
    rejectionScore: 0.4,
    displacementScore: 0.55,
    sessionSignificanceScore: 0.25,
    followThroughScore: params.followThroughScore ?? 0.7,
    gapContinuationScore: params.gapContinuationScore ?? 0,
    sourceEvidenceCount: 2,
    firstTimestamp: 1,
    lastTimestamp: Date.now(),
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...params,
  };
}

function buildLevelOutput(symbol: string, overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  return {
    symbol,
    generatedAt: Date.now(),
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
    },
    majorSupport: [],
    majorResistance: [],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [],
      resistance: [],
    },
    specialLevels: {},
    ...overrides,
  };
}

test("WatchlistMonitor reconciles refreshed levels and emits events for the new active zone set", async () => {
  const levelStore = new LevelStore();
  const liveProvider = new FakeLivePriceProvider();
  const events: MonitoringEvent[] = [];
  const monitor = new WatchlistMonitor(levelStore, liveProvider);

  levelStore.setLevels(buildLevelOutput("ALBT", {
    intradayResistance: [
      buildZone({
        id: "R1",
        symbol: "ALBT",
        kind: "resistance",
        zoneLow: 2.4,
        zoneHigh: 2.5,
        representativePrice: 2.45,
      }),
    ],
  }));

  await monitor.start(
    [{ symbol: "ALBT", active: true, priority: 1, tags: ["manual"] }],
    (event) => events.push(event),
  );

  levelStore.setLevels(buildLevelOutput("ALBT", {
    intradayResistance: [
      buildZone({
        id: "R2",
        symbol: "ALBT",
        kind: "resistance",
        zoneLow: 3.0,
        zoneHigh: 3.1,
        representativePrice: 3.05,
      }),
    ],
  }));

  liveProvider.listener?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 3.04,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventContext.canonicalZoneId, "R2");
  assert.ok(events[0]?.zoneId.startsWith("ALBT-resistance-monitored-"));
  assert.equal(events[0]?.eventType, "level_touch");
});

test("WatchlistMonitor evaluates posted extension zones after they are activated in the level store", async () => {
  const levelStore = new LevelStore();
  const liveProvider = new FakeLivePriceProvider();
  const events: MonitoringEvent[] = [];
  const monitor = new WatchlistMonitor(levelStore, liveProvider);

  levelStore.setLevels(buildLevelOutput("BIRD", {
    intradayResistance: [
      buildZone({
        id: "R1",
        symbol: "BIRD",
        kind: "resistance",
        zoneLow: 2.4,
        zoneHigh: 2.5,
        representativePrice: 2.45,
      }),
    ],
    extensionLevels: {
      support: [],
      resistance: [
        buildZone({
          id: "XR1",
          symbol: "BIRD",
          kind: "resistance",
          zoneLow: 2.9,
          zoneHigh: 3.0,
          representativePrice: 2.95,
          isExtension: true,
        }),
      ],
    },
  }));

  await monitor.start(
    [{ symbol: "BIRD", active: true, priority: 1, tags: ["manual"] }],
    (event) => events.push(event),
  );

  levelStore.activateExtensionLevels("BIRD", "resistance");
  liveProvider.listener?.({
    symbol: "BIRD",
    timestamp: 1000,
    lastPrice: 2.96,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventContext.canonicalZoneId, "XR1");
  assert.equal(events[0]?.eventContext.zoneOrigin, "promoted_extension");
  assert.equal(events[0]?.eventType, "level_touch");
});

test("WatchlistMonitor preserves monitored identity when a refreshed canonical zone replaces a promoted extension", async () => {
  const levelStore = new LevelStore();
  const liveProvider = new FakeLivePriceProvider();
  const events: MonitoringEvent[] = [];
  const monitor = new WatchlistMonitor(levelStore, liveProvider);

  levelStore.setLevels(buildLevelOutput("IMMP", {
    intradayResistance: [
      buildZone({
        id: "R1",
        symbol: "IMMP",
        kind: "resistance",
        zoneLow: 2.4,
        zoneHigh: 2.5,
        representativePrice: 2.45,
      }),
    ],
    extensionLevels: {
      support: [],
      resistance: [
        buildZone({
          id: "XR1",
          symbol: "IMMP",
          kind: "resistance",
          zoneLow: 2.9,
          zoneHigh: 3.0,
          representativePrice: 2.95,
          isExtension: true,
        }),
      ],
    },
  }));

  await monitor.start(
    [{ symbol: "IMMP", active: true, priority: 1, tags: ["manual"] }],
    (event) => events.push(event),
  );

  const promoted = levelStore.activateExtensionLevels("IMMP", "resistance");
  const promotedZone = promoted.find((zone) => zone.representativePrice === 2.95);
  assert.ok(promotedZone);

  levelStore.setLevels(buildLevelOutput("IMMP", {
    intradayResistance: [
      buildZone({
        id: "R2",
        symbol: "IMMP",
        kind: "resistance",
        zoneLow: 2.91,
        zoneHigh: 3.01,
        representativePrice: 2.96,
      }),
    ],
  }));

  liveProvider.listener?.({
    symbol: "IMMP",
    timestamp: 1000,
    lastPrice: 2.97,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.zoneId, promotedZone?.id);
  assert.equal(events[0]?.eventContext.canonicalZoneId, "R2");
  assert.equal(events[0]?.eventContext.remapStatus, "replaced");
  assert.equal(events[0]?.eventContext.zoneOrigin, "canonical");
});
