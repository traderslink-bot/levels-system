import type { AlertPayload } from "../alerts/alert-types.js";
import { AlertIntelligenceEngine } from "../alerts/alert-intelligence-engine.js";
import { formatIntelligentAlertAsPayload } from "../alerts/alert-router.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import { LevelStore } from "../monitoring/level-store.js";
import type { LivePriceListener, LivePriceProvider } from "../monitoring/live-price-types.js";
import {
  buildIntelligentAlertStoryRecord,
  decideIntelligentAlertPost,
  getLiveThreadPostingPolicySettings,
  type IntelligentAlertStoryRecord,
  type LiveThreadPostingProfile,
} from "../monitoring/live-thread-post-policy.js";
import type {
  LivePriceUpdate,
  MonitoringEvent,
  PracticalTradeStructureState,
  WatchlistEntry,
} from "../monitoring/monitoring-types.js";
import { WatchlistMonitor } from "../monitoring/watchlist-monitor.js";
import type { CandleMarketStructureState } from "../structure/index.js";

export type OfflineSmallCapScenarioName =
  | "range_chop"
  | "boring_consolidation"
  | "base_to_breakout"
  | "runner_structure_change"
  | "fake_breakout"
  | "support_area_loss"
  | "reclaim_after_flush";

export type OfflineSmallCapScenarioDefinition = {
  name: OfflineSmallCapScenarioName;
  symbol: string;
  description: string;
  updates: number[];
};

export type OfflineScenarioSuppressionReason =
  | "engine_filtered"
  | "post_policy_suppressed";

export type OfflineScenarioSuppressedAlert = {
  timestamp: number;
  eventType: MonitoringEvent["eventType"];
  level: number;
  triggerPrice: number;
  reason: OfflineScenarioSuppressionReason;
  detail: string;
  practicalStructureState?: PracticalTradeStructureState;
  stableMarketStructureState?: CandleMarketStructureState;
};

export type OfflineScenarioPostedAlert = {
  timestamp: number;
  eventType: MonitoringEvent["eventType"];
  title: string;
  body: string;
  level: number;
  triggerPrice: number;
  severity?: string;
  score?: number;
  practicalStructureState?: PracticalTradeStructureState;
  practicalZoneKey?: string;
  stableMarketStructureState?: CandleMarketStructureState;
  stableMarketStructureKey?: string;
  stableMarketStructureMaterialChange?: boolean;
};

export type OfflineSmallCapScenarioResult = {
  name: OfflineSmallCapScenarioName;
  symbol: string;
  description: string;
  updateCount: number;
  eventCount: number;
  postedCount: number;
  suppressedCount: number;
  events: Array<{
    timestamp: number;
    eventType: MonitoringEvent["eventType"];
    zoneKind: MonitoringEvent["zoneKind"];
    level: number;
    triggerPrice: number;
    practicalStructureState?: PracticalTradeStructureState;
    practicalZoneKey?: string;
    stableMarketStructureState?: CandleMarketStructureState;
    stableMarketStructureKey?: string;
    stableMarketStructureMaterialChange?: boolean;
  }>;
  postedAlerts: OfflineScenarioPostedAlert[];
  suppressedAlerts: OfflineScenarioSuppressedAlert[];
  practicalStates: PracticalTradeStructureState[];
  stableStates: CandleMarketStructureState[];
  stableMaterialChangeCount: number;
};

class ScenarioLivePriceProvider implements LivePriceProvider {
  public listener?: LivePriceListener;

  async start(_entries: WatchlistEntry[], onUpdate: LivePriceListener): Promise<void> {
    this.listener = onUpdate;
  }

  async stop(): Promise<void> {
    this.listener = undefined;
  }
}

function buildZone(params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "symbol" | "kind">): FinalLevelZone {
  return {
    timeframeBias: "5m",
    zoneLow: params.kind === "support" ? 0.99 : 1.06,
    zoneHigh: params.kind === "support" ? 1.02 : 1.06,
    representativePrice: params.kind === "support" ? 1.01 : 1.06,
    strengthScore: 34,
    strengthLabel: "moderate",
    touchCount: 4,
    confluenceCount: 1,
    sourceTypes: [params.kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.66,
    rejectionScore: 0.42,
    displacementScore: 0.58,
    sessionSignificanceScore: 0.28,
    followThroughScore: 0.68,
    gapContinuationScore: 0,
    sourceEvidenceCount: 2,
    firstTimestamp: 1,
    lastTimestamp: 2,
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...params,
  };
}

function buildScenarioLevels(symbol: string): LevelEngineOutput {
  return {
    symbol,
    generatedAt: 1,
    metadata: {
      providerByTimeframe: {
        "5m": "scenario",
        daily: "scenario",
      },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 1.04,
      volumeBaselineByTimeframe: {
        "5m": {
          averageVolume: 120_000,
          sampleSize: 24,
        },
      },
    },
    majorSupport: [
      buildZone({
        id: `${symbol}-support-core`,
        symbol,
        kind: "support",
        timeframeBias: "mixed",
        zoneLow: 0.9898,
        zoneHigh: 1.02,
        representativePrice: 1.01,
        strengthScore: 52,
        strengthLabel: "major",
        confluenceCount: 3,
        touchCount: 8,
        timeframeSources: ["5m", "4h", "daily"],
        sourceEvidenceCount: 4,
      }),
      buildZone({
        id: `${symbol}-support-lower`,
        symbol,
        kind: "support",
        timeframeBias: "mixed",
        zoneLow: 0.948,
        zoneHigh: 0.956,
        representativePrice: 0.9522,
        strengthScore: 38,
        strengthLabel: "strong",
        confluenceCount: 2,
        timeframeSources: ["4h", "daily"],
      }),
    ],
    majorResistance: [
      buildZone({
        id: `${symbol}-resistance-112`,
        symbol,
        kind: "resistance",
        timeframeBias: "mixed",
        zoneLow: 1.118,
        zoneHigh: 1.122,
        representativePrice: 1.12,
        strengthScore: 46,
        strengthLabel: "strong",
        confluenceCount: 2,
        timeframeSources: ["4h", "daily"],
      }),
      buildZone({
        id: `${symbol}-resistance-125`,
        symbol,
        kind: "resistance",
        timeframeBias: "daily",
        zoneLow: 1.245,
        zoneHigh: 1.255,
        representativePrice: 1.25,
        strengthScore: 50,
        strengthLabel: "major",
        confluenceCount: 3,
        timeframeSources: ["daily"],
      }),
    ],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [
      buildZone({
        id: `${symbol}-support-090`,
        symbol,
        kind: "support",
        zoneLow: 0.895,
        zoneHigh: 0.905,
        representativePrice: 0.9001,
        strengthScore: 36,
        strengthLabel: "strong",
        timeframeSources: ["5m", "4h"],
      }),
    ],
    intradayResistance: [
      buildZone({
        id: `${symbol}-resistance-106`,
        symbol,
        kind: "resistance",
        zoneLow: 1.058,
        zoneHigh: 1.062,
        representativePrice: 1.06,
        strengthScore: 34,
        strengthLabel: "moderate",
        timeframeSources: ["5m"],
      }),
    ],
    extensionLevels: {
      support: [],
      resistance: [],
    },
    specialLevels: {},
  };
}

export function defaultOfflineSmallCapScenarios(): OfflineSmallCapScenarioDefinition[] {
  return [
    {
      name: "boring_consolidation",
      symbol: "BORE",
      description: "All-day small-cap consolidation between one support area and one resistance area; this should prove the system does not post dozens of small range taps.",
      updates: [
        1.018, 1.026, 1.034, 1.046, 1.056, 1.061, 1.052, 1.041, 1.029, 1.016,
        1.004, 0.998, 1.009, 1.021, 1.033, 1.047, 1.058, 1.062, 1.054, 1.043,
        1.031, 1.018, 1.006, 0.999, 1.011, 1.024, 1.038, 1.049, 1.057, 1.061,
        1.053, 1.039, 1.025, 1.013, 1.004, 1.017,
      ],
    },
    {
      name: "range_chop",
      symbol: "CHOP",
      description: "Low-volume small-cap oscillates between the practical support area and first resistance without changing the trade story.",
      updates: [
        1.03, 1.045, 1.055, 1.061, 1.052, 1.035, 1.018, 1.004, 0.998, 1.012,
        1.026, 1.044, 1.058, 1.063, 1.051, 1.033, 1.017, 1.006, 0.996, 1.014,
        1.029, 1.046, 1.059, 1.062, 1.049, 1.031, 1.016, 1.005, 0.999, 1.02,
      ],
    },
    {
      name: "base_to_breakout",
      symbol: "BASE",
      description: "Higher lows build under resistance before a real expansion through the first resistance zone.",
      updates: [
        1.00, 1.018, 1.032, 1.047, 1.058, 1.052, 1.028, 1.038, 1.052, 1.061,
        1.064, 1.078, 1.095, 1.116, 1.126, 1.145,
      ],
    },
    {
      name: "runner_structure_change",
      symbol: "RUNR",
      description: "Small-cap runner builds under resistance, clears the first range, pulls back above the former area, and expands again. This should allow useful posts only at real structure changes.",
      updates: [
        1.00, 1.018, 1.034, 1.052, 1.061, 1.048, 1.032, 1.044, 1.057, 1.063,
        1.079, 1.096, 1.116, 1.128, 1.146, 1.132, 1.118, 1.125, 1.148, 1.176,
        1.205, 1.238, 1.262, 1.246, 1.228, 1.252, 1.284,
      ],
    },
    {
      name: "fake_breakout",
      symbol: "FAKE",
      description: "Price briefly clears resistance, cannot hold the area, and falls back into the prior band.",
      updates: [
        1.025, 1.044, 1.058, 1.066, 1.071, 1.052, 1.035, 1.021, 1.008, 0.998,
      ],
    },
    {
      name: "support_area_loss",
      symbol: "LOSS",
      description: "The whole practical support area fails, which should matter more than a one-cent wiggle.",
      updates: [
        1.045, 1.03, 1.018, 1.006, 0.996, 0.982, 0.968, 0.953, 0.944,
      ],
    },
    {
      name: "reclaim_after_flush",
      symbol: "RCLM",
      description: "Price loses the support area, then reclaims it instead of continuing lower.",
      updates: [
        1.04, 1.02, 1.002, 0.982, 0.962, 0.95, 0.972, 0.991, 1.012, 1.031,
        1.052, 1.064,
      ],
    },
  ];
}

function updateForPrice(symbol: string, timestamp: number, price: number, index: number): LivePriceUpdate {
  return {
    symbol,
    timestamp,
    lastPrice: price,
    volume: 1_000_000 + index * 35_000,
  };
}

export async function runOfflineSmallCapScenario(
  scenario: OfflineSmallCapScenarioDefinition,
  options: {
    startTimestamp?: number;
    intervalMs?: number;
    postingProfile?: LiveThreadPostingProfile;
  } = {},
): Promise<OfflineSmallCapScenarioResult> {
  const startTimestamp = options.startTimestamp ?? Date.UTC(2026, 4, 1, 13, 30, 0);
  const intervalMs = options.intervalMs ?? 5 * 60 * 1000;
  const postingProfile = options.postingProfile ?? "balanced";
  const levelStore = new LevelStore();
  const liveProvider = new ScenarioLivePriceProvider();
  const monitor = new WatchlistMonitor(levelStore, liveProvider);
  const engine = new AlertIntelligenceEngine();
  const levels = buildScenarioLevels(scenario.symbol);
  const events: MonitoringEvent[] = [];
  const postedAlerts: OfflineScenarioPostedAlert[] = [];
  const suppressedAlerts: OfflineScenarioSuppressedAlert[] = [];
  const storyRecords: IntelligentAlertStoryRecord[] = [];

  levelStore.setLevels(levels);
  await monitor.start(
    [{ symbol: scenario.symbol, active: true, priority: 1, tags: ["offline-scenario"] }],
    (event) => {
      events.push(event);
      const alertResult = engine.processEvent(event, levelStore.getLevels(event.symbol));

      if (!alertResult.formatted) {
        suppressedAlerts.push({
          timestamp: event.timestamp,
          eventType: event.eventType,
          level: event.level,
          triggerPrice: event.triggerPrice,
          reason: "engine_filtered",
          detail: alertResult.delivery.reason,
          practicalStructureState: event.eventContext.tradeStructure?.state,
          stableMarketStructureState: event.eventContext.stableMarketStructureState,
        });
        return;
      }

      const payload = formatIntelligentAlertAsPayload(alertResult.rawAlert);
      const decision = decideIntelligentAlertPost({
        records: storyRecords,
        timestamp: event.timestamp,
        eventType: event.eventType,
        level: event.level,
        triggerPrice: event.triggerPrice,
        severity: alertResult.rawAlert.severity,
        score: alertResult.rawAlert.score,
        practicalStructureState: payload.metadata?.practicalStructureState,
        practicalZoneKey: payload.metadata?.practicalZoneKey,
        practicalStructureMaterialChange: payload.metadata?.practicalStructureMaterialChange,
        stableMarketStructureState: payload.metadata?.stableMarketStructureState,
        stableMarketStructureKey: payload.metadata?.stableMarketStructureKey,
        stableMarketStructureMaterialChange: payload.metadata?.stableMarketStructureMaterialChange,
        settings: getLiveThreadPostingPolicySettings(postingProfile),
      });

      if (!decision.shouldPost) {
        suppressedAlerts.push({
          timestamp: event.timestamp,
          eventType: event.eventType,
          level: event.level,
          triggerPrice: event.triggerPrice,
          reason: "post_policy_suppressed",
          detail: decision.reason,
          practicalStructureState: payload.metadata?.practicalStructureState,
          stableMarketStructureState: payload.metadata?.stableMarketStructureState,
        });
        return;
      }

      storyRecords.push(buildIntelligentAlertStoryRecord({
        timestamp: event.timestamp,
        eventType: event.eventType,
        level: event.level,
        triggerPrice: event.triggerPrice,
        severity: alertResult.rawAlert.severity,
        score: alertResult.rawAlert.score,
        practicalStructureState: payload.metadata?.practicalStructureState,
        practicalZoneKey: payload.metadata?.practicalZoneKey,
        stableMarketStructureState: payload.metadata?.stableMarketStructureState,
        stableMarketStructureKey: payload.metadata?.stableMarketStructureKey,
      }));
      postedAlerts.push(toPostedAlert(payload, event));
    },
  );

  scenario.updates.forEach((price, index) => {
    liveProvider.listener?.(updateForPrice(
      scenario.symbol,
      startTimestamp + index * intervalMs,
      price,
      index,
    ));
  });

  await monitor.stop();

  const practicalStates = uniqueDefined(
    events.map((event) => event.eventContext.tradeStructure?.state),
  );
  const stableStates = uniqueDefined(
    events.map((event) => event.eventContext.stableMarketStructureState),
  );

  return {
    name: scenario.name,
    symbol: scenario.symbol,
    description: scenario.description,
    updateCount: scenario.updates.length,
    eventCount: events.length,
    postedCount: postedAlerts.length,
    suppressedCount: suppressedAlerts.length,
    events: events.map((event) => ({
      timestamp: event.timestamp,
      eventType: event.eventType,
      zoneKind: event.zoneKind,
      level: event.level,
      triggerPrice: event.triggerPrice,
      practicalStructureState: event.eventContext.tradeStructure?.state,
      practicalZoneKey: event.eventContext.tradeStructure?.practicalZoneKey,
      stableMarketStructureState: event.eventContext.stableMarketStructureState,
      stableMarketStructureKey: event.eventContext.stableMarketStructureKey,
      stableMarketStructureMaterialChange: event.eventContext.stableMarketStructureMaterialChange,
    })),
    postedAlerts,
    suppressedAlerts,
    practicalStates,
    stableStates,
    stableMaterialChangeCount: events.filter(
      (event) => event.eventContext.stableMarketStructureMaterialChange,
    ).length,
  };
}

function toPostedAlert(payload: AlertPayload, event: MonitoringEvent): OfflineScenarioPostedAlert {
  return {
    timestamp: event.timestamp,
    eventType: event.eventType,
    title: payload.title,
    body: payload.body,
    level: event.level,
    triggerPrice: event.triggerPrice,
    severity: payload.metadata?.severity,
    score: payload.metadata?.score,
    practicalStructureState: payload.metadata?.practicalStructureState,
    practicalZoneKey: payload.metadata?.practicalZoneKey,
    stableMarketStructureState: payload.metadata?.stableMarketStructureState,
    stableMarketStructureKey: payload.metadata?.stableMarketStructureKey,
    stableMarketStructureMaterialChange: payload.metadata?.stableMarketStructureMaterialChange,
  };
}

function uniqueDefined<T>(values: Array<T | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => value !== undefined))];
}

export async function runOfflineSmallCapScenarios(options: {
  postingProfile?: LiveThreadPostingProfile;
} = {}): Promise<OfflineSmallCapScenarioResult[]> {
  const results: OfflineSmallCapScenarioResult[] = [];
  for (const scenario of defaultOfflineSmallCapScenarios()) {
    results.push(await runOfflineSmallCapScenario(scenario, options));
  }
  return results;
}

export function renderOfflineSmallCapScenarioMarkdown(results: OfflineSmallCapScenarioResult[]): string {
  const lines = [
    "# Offline Small-Cap Scenario Simulation",
    "",
    "This report drives deterministic price paths through the real monitor, alert intelligence engine, trader formatter, and live-thread post policy.",
    "",
    "| Scenario | Updates | Events | Posted | Suppressed | Practical states | Stable 5m states |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];

  for (const result of results) {
    lines.push(
      `| ${result.name} | ${result.updateCount} | ${result.eventCount} | ${result.postedCount} | ${result.suppressedCount} | ${result.practicalStates.join(", ") || "none"} | ${result.stableStates.join(", ") || "none"} |`,
    );
  }

  for (const result of results) {
    lines.push("", `## ${result.name}`, "", result.description, "");
    lines.push("Posted alerts:");
    if (result.postedAlerts.length === 0) {
      lines.push("- none");
    } else {
      for (const post of result.postedAlerts) {
        lines.push(`- ${post.eventType} near ${post.triggerPrice.toFixed(4)}: ${post.title} (${post.practicalStructureState ?? "no structure"})`);
      }
    }

    const suppressionReasons = new Map<string, number>();
    for (const suppressed of result.suppressedAlerts) {
      const key = `${suppressed.reason}:${suppressed.detail}`;
      suppressionReasons.set(key, (suppressionReasons.get(key) ?? 0) + 1);
    }

    lines.push("", "Suppressions:");
    if (suppressionReasons.size === 0) {
      lines.push("- none");
    } else {
      for (const [reason, count] of suppressionReasons) {
        lines.push(`- ${reason}: ${count}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
