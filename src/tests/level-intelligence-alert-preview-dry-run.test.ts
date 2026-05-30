import assert from "node:assert/strict";
import test from "node:test";

import type { DiscordThreadRoutingResult } from "../lib/alerts/alert-types.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import {
  ManualWatchlistRuntimeManager,
  resolveLevelIntelligenceAlertPreviewDryRun,
  type LevelIntelligenceAlertPreviewDryRunResult,
} from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";

function waitForAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function zone(
  params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "symbol" | "kind">,
): FinalLevelZone {
  const representativePrice =
    params.representativePrice ?? (params.kind === "support" ? 1.95 : 2.45);

  return {
    timeframeBias: "5m",
    zoneLow: params.zoneLow ?? representativePrice * 0.99,
    zoneHigh: params.zoneHigh ?? representativePrice * 1.01,
    representativePrice,
    strengthScore: 28,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 1,
    sourceTypes: [params.kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.72,
    rejectionScore: 0.61,
    displacementScore: 0.55,
    sessionSignificanceScore: 0.2,
    followThroughScore: 0.62,
    gapContinuationScore: 0,
    sourceEvidenceCount: 1,
    firstTimestamp: 1,
    lastTimestamp: 1,
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...params,
  };
}

function syntheticExtension(symbol: string): FinalLevelZone {
  return zone({
    id: "SYNX-synthetic-resistance-extension-1-3p2000",
    symbol,
    kind: "resistance",
    zoneLow: 3.19,
    zoneHigh: 3.21,
    representativePrice: 3.2,
    strengthScore: 0,
    strengthLabel: "weak",
    touchCount: 0,
    confluenceCount: 0,
    sourceTypes: [],
    timeframeSources: [],
    reactionQualityScore: 0,
    rejectionScore: 0,
    displacementScore: 0,
    sessionSignificanceScore: 0,
    followThroughScore: 0,
    sourceEvidenceCount: 0,
    isExtension: true,
    notes: [
      "Synthetic continuation-map extension for forward-planning only; not historical support/resistance.",
    ],
    extensionMetadata: {
      extensionSource: "synthetic_continuation_map",
      generationMethod: "round_number_ladder",
      referencePrice: 2.45,
      targetCoveragePct: 0.3,
      maxCoveragePct: 0.5,
      syntheticIndex: 1,
      evidenceLimitations: [
        "real_extension_coverage_below_threshold",
        "not_historical_support_resistance",
        "no_touch_or_rejection_history",
        "no_historical_confluence",
      ],
    },
  });
}

function buildLevelOutput(
  symbol: string,
  overrides: Partial<LevelEngineOutput> = {},
): LevelEngineOutput {
  return {
    symbol,
    generatedAt: 7,
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 2.45,
    },
    majorSupport: [],
    majorResistance: [],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [
      zone({
        id: "R1",
        symbol,
        kind: "resistance",
        zoneLow: 2.4,
        zoneHigh: 2.5,
        representativePrice: 2.45,
      }),
    ],
    extensionLevels: {
      support: [],
      resistance: [syntheticExtension(symbol)],
    },
    specialLevels: {},
    ...overrides,
  };
}

class FakeWatchlistStatePersistence {
  public storedEntries: any[] = [];

  load() {
    return this.storedEntries.map((entry) => ({ ...entry }));
  }

  save(entries: any[]) {
    this.storedEntries = entries.map((entry) => ({ ...entry }));
  }
}

class FakeMonitor {
  public startCalls: any[][] = [];
  public stopCalls = 0;
  public listener?: (event: any) => void;
  public onPriceUpdate?: (update: any) => void;

  async start(entries: any[], listener: (event: any) => void, onPriceUpdate?: (update: any) => void): Promise<void> {
    this.startCalls.push(entries.map((entry) => ({ ...entry })));
    this.listener = listener;
    this.onPriceUpdate = onPriceUpdate;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }
}

class FakeDiscordAlertRouter {
  public ensured: Array<{ symbol: string; storedThreadId?: string | null }> = [];
  public routed: Array<{ threadId: string; payload: any }> = [];
  public levelSnapshots: Array<{ threadId: string; payload: any }> = [];
  public levelExtensions: Array<{ threadId: string; payload: any }> = [];

  async ensureThread(symbol: string, storedThreadId?: string | null): Promise<DiscordThreadRoutingResult> {
    this.ensured.push({ symbol, storedThreadId });
    return {
      threadId: storedThreadId ?? `thread-${symbol.toUpperCase()}`,
      reused: Boolean(storedThreadId),
      recovered: false,
      created: !storedThreadId,
    };
  }

  async routeAlert(threadId: string, payload: any): Promise<void> {
    this.routed.push({ threadId, payload });
  }

  async routeLevelSnapshot(threadId: string, payload: any): Promise<void> {
    this.levelSnapshots.push({ threadId, payload });
  }

  async routeLevelExtension(threadId: string, payload: any): Promise<void> {
    this.levelExtensions.push({ threadId, payload });
  }
}

class FakeOpportunityRuntimeController {
  processMonitoringEvent() {
    return { newOpportunity: undefined };
  }

  processPriceUpdate() {
    return null;
  }
}

function approvedAlertEvent() {
  return {
    id: "evt-1",
    episodeId: "evt-1-episode",
    symbol: "ALBT",
    type: "breakout" as const,
    eventType: "breakout" as const,
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance" as const,
    level: 2.45,
    triggerPrice: 2.52,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish" as const,
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh" as const,
      zoneOrigin: "canonical" as const,
      remapStatus: "preserved" as const,
      remappedFromZoneIds: ["ALBT-resistance-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost" as const,
      zoneStrengthLabel: "strong" as const,
      sourceGeneratedAt: 7,
    },
    timestamp: 10,
    notes: ["Breakout through outermost resistance."],
  };
}

async function setupManager(params: {
  levelOutput?: LevelEngineOutput;
  previewOptions?: ConstructorParameters<typeof ManualWatchlistRuntimeManager>[0]["levelIntelligenceAlertPreviewDryRun"];
} = {}) {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const output = params.levelOutput ?? buildLevelOutput("ALBT");
  const previewOptions = params.previewOptions;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async () => {
      levelStore.setLevels(output);
    },
    ...(previewOptions ? { levelIntelligenceAlertPreviewDryRun: previewOptions } : {}),
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });

  return {
    monitor,
    discordAlertRouter,
    levelStore,
  };
}

const forbiddenTerms = [
  "buy",
  "sell",
  "enter",
  "exit",
  "good trade",
  "bad trade",
  "mistake",
  "coaching",
  "p/l",
  "giveback",
  "grading",
];

function assertNoForbiddenLanguage(value: unknown): void {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const term of forbiddenTerms) {
    assert.equal(serialized.includes(term), false, `unexpected forbidden term: ${term}`);
  }
}

test("alert preview dry-run flag defaults to disabled", async () => {
  assert.equal(resolveLevelIntelligenceAlertPreviewDryRun(), false);

  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    const { monitor, discordAlertRouter } = await setupManager();
    monitor.listener?.(approvedAlertEvent());
    await waitForAsyncWork();

    assert.equal(discordAlertRouter.routed.length, 1);
    assert.equal(capturedLogs.length, 0);
  } finally {
    console.log = originalLog;
  }
});

test("enabled alert preview dry-run generates preview after approved alert from LevelStore output", async () => {
  const previews: LevelIntelligenceAlertPreviewDryRunResult[] = [];
  const { monitor, discordAlertRouter } = await setupManager({
    previewOptions: {
      enabled: true,
      onPreview: (result) => {
        previews.push(result);
      },
    },
  });

  monitor.listener?.(approvedAlertEvent());
  await waitForAsyncWork();

  assert.equal(discordAlertRouter.routed.length, 1);
  assert.equal(discordAlertRouter.levelExtensions.length, 0);
  assert.equal(previews.length, 1);
  assert.equal(previews[0]?.symbol, "ALBT");
  assert.equal(previews[0]?.mode, "dry-run");
  assert.equal(previews[0]?.levelGeneratedAt, 7);
  assert.equal(previews[0]?.preview.truncated, false);
  assert(previews[0]?.preview.messages.length > 0);
  assert(previews[0]?.content.includes("Synthetic continuation map"));
  assert(previews[0]?.content.includes("not historical support/resistance"));
  assert(previews[0]?.content.includes("SYNX-synthetic-resistance-extension-1-3p2000"));
  assertNoForbiddenLanguage(previews[0]);
});

test("enabled alert preview dry-run leaves existing alert payload unchanged", async () => {
  const { monitor, discordAlertRouter } = await setupManager({
    previewOptions: {
      enabled: true,
      onPreview: () => undefined,
    },
  });

  monitor.listener?.(approvedAlertEvent());
  await waitForAsyncWork();

  assert.equal(discordAlertRouter.routed.length, 1);
  assert.equal(discordAlertRouter.routed[0]?.payload.title, "ALBT breakout");
  assert.equal(
    discordAlertRouter.routed[0]?.payload.body,
    "breakout resistance 2.40-2.50 | strong outermost | fresh | refreshed",
  );
});

test("disabled alert preview dry-run does not build preview", async () => {
  let buildCount = 0;
  const { monitor, discordAlertRouter } = await setupManager({
    previewOptions: {
      enabled: false,
      buildPreview: () => {
        buildCount += 1;
        throw new Error("preview builder must not run");
      },
      onPreview: () => undefined,
    },
  });

  monitor.listener?.(approvedAlertEvent());
  await waitForAsyncWork();

  assert.equal(discordAlertRouter.routed.length, 1);
  assert.equal(buildCount, 0);
});

test("alert preview dry-run errors do not break existing alert flow", async () => {
  const errors: Error[] = [];
  const { monitor, discordAlertRouter } = await setupManager({
    previewOptions: {
      enabled: true,
      buildPreview: () => {
        throw new Error("synthetic preview fixture failure");
      },
      onError: (error) => {
        errors.push(error);
      },
    },
  });

  monitor.listener?.(approvedAlertEvent());
  await waitForAsyncWork();

  assert.equal(discordAlertRouter.routed.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, "synthetic preview fixture failure");
});

test("alert preview dry-run resolver accepts explicit true values only", () => {
  assert.equal(resolveLevelIntelligenceAlertPreviewDryRun("true"), true);
  assert.equal(resolveLevelIntelligenceAlertPreviewDryRun("1"), true);
  assert.equal(resolveLevelIntelligenceAlertPreviewDryRun("yes"), true);
  assert.equal(resolveLevelIntelligenceAlertPreviewDryRun("on"), true);
  assert.equal(resolveLevelIntelligenceAlertPreviewDryRun("false"), false);
  assert.equal(resolveLevelIntelligenceAlertPreviewDryRun(""), false);
});

test("runtime mode old remains default", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
