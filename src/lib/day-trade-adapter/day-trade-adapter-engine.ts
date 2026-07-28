import type { Candle, CandleProviderResponse } from "../market-data/candle-types.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import type { TechnicalContext } from "../technical-context/technical-context-types.js";

export type DayTradeAdapterState =
  | "extreme_extension_no_base"
  | "base_forming"
  | "pullback_testing"
  | "reclaim_required"
  | "continuation_confirmed"
  | "failed_structure"
  | "recovery_watch"
  | "insufficient_data";

export type DayTradeAdapterLevelCluster = {
  low: number;
  high: number;
  price: number;
  side: "support" | "resistance";
  role:
    | "hold"
    | "pullback"
    | "invalidation"
    | "must_clear"
    | "obstacle"
    | "continuation"
    | "expansion";
  strength: "weak" | "moderate" | "strong" | "major";
  evidenceCount: number;
  levelIds: string[];
  sourceTypes: string[];
  provisional: boolean;
};

export type DayTradeAdapterCandleDiagnostics = {
  timeframe: "1m" | "5m";
  provider: string;
  candleCount: number;
  completedCandleCount: number;
  firstTimestamp: number | null;
  latestTimestamp: number | null;
  latestCompletedTimestamp: number | null;
  ageMs: number | null;
  completenessStatus: string;
  stale: boolean;
  validationIssues: Array<{ code: string; severity: string; message: string }>;
  zeroVolumeCount: number;
  duplicateTimestampCount: number;
  missingIntervalCount: number;
};

export type DayTradeAdapterMarketContext = {
  symbol: string;
  timestamp: number;
  currentPrice: number;
  livePriceUpdatedAt: number | null;
  levels: LevelEngineOutput | null;
  technicalContext: TechnicalContext | null;
  atr: {
    value: number | null;
    pct: number | null;
    period: number;
    timeframe: string;
    completedCandleCount: number;
    reliability: string;
    reason: string | null;
  };
};

export type DayTradeAdapterResult = {
  symbol: string;
  generatedAt: number;
  state: DayTradeAdapterState;
  confidence: "high" | "medium" | "low" | "unavailable";
  summary: string;
  extension: {
    sessionOrigin: number | null;
    sessionHigh: number | null;
    extensionFromOriginPct: number | null;
    extensionFromVwapPct: number | null;
    baseLow: number | null;
    baseHigh: number | null;
    provisional: boolean;
  };
  plan: {
    needsToHold: DayTradeAdapterLevelCluster | null;
    pullbackArea: DayTradeAdapterLevelCluster | null;
    mustClear: DayTradeAdapterLevelCluster | null;
    nearbyObstacles: DayTradeAdapterLevelCluster[];
    continuation: DayTradeAdapterLevelCluster | null;
    expansionTargets: DayTradeAdapterLevelCluster[];
    invalidation: DayTradeAdapterLevelCluster | null;
  };
  diagnostics: {
    livePriceAgeMs: number | null;
    technicalContext: TechnicalContext | null;
    atr: DayTradeAdapterMarketContext["atr"];
    candles: DayTradeAdapterCandleDiagnostics[];
    levelInventory: {
      received: number;
      deduplicated: number;
      clusters: number;
      fullLadderSupport: number;
      fullLadderResistance: number;
    };
    flags: string[];
  };
};

const STRENGTH_RANK = { weak: 0, moderate: 1, strong: 2, major: 3 } as const;

function roundPrice(value: number): number {
  return Number(value.toFixed(value < 1 ? 4 : 2));
}

function uniqueZones(levels: LevelEngineOutput | null): {
  zones: FinalLevelZone[];
  received: number;
  fullLadderSupport: number;
  fullLadderResistance: number;
} {
  if (!levels) {
    return { zones: [], received: 0, fullLadderSupport: 0, fullLadderResistance: 0 };
  }
  const all = [
    ...levels.majorSupport,
    ...levels.majorResistance,
    ...levels.intermediateSupport,
    ...levels.intermediateResistance,
    ...levels.intradaySupport,
    ...levels.intradayResistance,
    ...levels.extensionLevels.support,
    ...levels.extensionLevels.resistance,
    ...(levels.fullLadderLevels?.support ?? []),
    ...(levels.fullLadderLevels?.resistance ?? []),
  ];
  const byId = new Map<string, FinalLevelZone>();
  for (const zone of all) {
    const key = zone.id || `${zone.kind}:${zone.zoneLow}:${zone.zoneHigh}`;
    const existing = byId.get(key);
    if (!existing || zone.sourceEvidenceCount > existing.sourceEvidenceCount) {
      byId.set(key, zone);
    }
  }
  return {
    zones: [...byId.values()],
    received: all.length,
    fullLadderSupport: levels.fullLadderLevels?.support.length ?? 0,
    fullLadderResistance: levels.fullLadderLevels?.resistance.length ?? 0,
  };
}

type UnassignedCluster = Omit<DayTradeAdapterLevelCluster, "role">;

function clusterZones(
  zones: FinalLevelZone[],
  currentPrice: number,
  atrValue: number | null,
): UnassignedCluster[] {
  const threshold = atrValue && atrValue > 0
    ? atrValue * 0.35
    : Math.max(currentPrice < 1 ? 0.0003 : 0.03, currentPrice * 0.003);
  const sorted = [...zones].sort((a, b) => a.representativePrice - b.representativePrice);
  const clusters: Array<{ zones: FinalLevelZone[]; low: number; high: number }> = [];
  for (const zone of sorted) {
    const previous = clusters.at(-1);
    if (previous && zone.zoneLow <= previous.high + threshold) {
      previous.zones.push(zone);
      previous.low = Math.min(previous.low, zone.zoneLow);
      previous.high = Math.max(previous.high, zone.zoneHigh);
    } else {
      clusters.push({ zones: [zone], low: zone.zoneLow, high: zone.zoneHigh });
    }
  }
  return clusters.map((cluster) => {
    const evidenceCount = cluster.zones.reduce(
      (sum, zone) => sum + Math.max(1, zone.sourceEvidenceCount),
      0,
    );
    const weightedPrice = cluster.zones.reduce(
      (sum, zone) => sum + zone.representativePrice * Math.max(1, zone.sourceEvidenceCount),
      0,
    ) / evidenceCount;
    const strongest = cluster.zones.reduce((best, zone) =>
      STRENGTH_RANK[zone.strengthLabel] > STRENGTH_RANK[best.strengthLabel] ? zone : best
    );
    return {
      low: roundPrice(cluster.low),
      high: roundPrice(cluster.high),
      price: roundPrice(weightedPrice),
      side: weightedPrice <= currentPrice ? "support" : "resistance",
      strength: strongest.strengthLabel,
      evidenceCount,
      levelIds: cluster.zones.map((zone) => zone.id),
      sourceTypes: [...new Set(cluster.zones.flatMap((zone) => zone.sourceTypes))],
      provisional: cluster.zones.every((zone) =>
        zone.timeframeBias === "5m" || zone.sourceTypes.some((source) =>
          source === "current_session_high" || source === "current_session_low"
        )
      ),
    };
  });
}

function withRole(
  cluster: UnassignedCluster | undefined,
  role: DayTradeAdapterLevelCluster["role"],
): DayTradeAdapterLevelCluster | null {
  return cluster ? { ...cluster, role } : null;
}

function completedCandles(candles: Candle[], timeframeMs: number, asOf: number): Candle[] {
  return candles.filter((candle) => candle.timestamp + timeframeMs <= asOf);
}

function candleDiagnostics(
  response: CandleProviderResponse,
  timeframeMs: number,
  asOf: number,
): DayTradeAdapterCandleDiagnostics {
  const sorted = [...response.candles].sort((a, b) => a.timestamp - b.timestamp);
  const completed = completedCandles(sorted, timeframeMs, asOf);
  const uniqueTimestamps = new Set(sorted.map((candle) => candle.timestamp));
  let missingIntervalCount = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index].timestamp - sorted[index - 1].timestamp;
    if (gap > timeframeMs * 1.5 && gap < 8 * 60 * 60 * 1000) {
      missingIntervalCount += Math.max(1, Math.round(gap / timeframeMs) - 1);
    }
  }
  const latest = sorted.at(-1)?.timestamp ?? null;
  return {
    timeframe: response.timeframe as "1m" | "5m",
    provider: response.provider,
    candleCount: sorted.length,
    completedCandleCount: completed.length,
    firstTimestamp: sorted[0]?.timestamp ?? null,
    latestTimestamp: latest,
    latestCompletedTimestamp: completed.at(-1)?.timestamp ?? null,
    ageMs: latest === null ? null : Math.max(0, asOf - latest),
    completenessStatus: response.completenessStatus,
    stale: response.stale,
    validationIssues: response.validationIssues,
    zeroVolumeCount: sorted.filter((candle) => candle.volume === 0).length,
    duplicateTimestampCount: sorted.length - uniqueTimestamps.size,
    missingIntervalCount,
  };
}

function sessionCandles(candles: Candle[], asOf: number): Candle[] {
  const sessionDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(asOf);
  return candles.filter((candle) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(candle.timestamp) === sessionDate
  );
}

export function buildDayTradeAdapterResult(input: {
  market: DayTradeAdapterMarketContext;
  oneMinute: CandleProviderResponse;
  fiveMinute: CandleProviderResponse;
}): DayTradeAdapterResult {
  const { market } = input;
  const flags: string[] = [];
  const inventory = uniqueZones(market.levels);
  const atrUsable = market.atr.reliability === "reliable" && (market.atr.value ?? 0) > 0;
  if (!atrUsable) flags.push(`atr_unreliable:${market.atr.reason ?? market.atr.reliability}`);
  const clusters = clusterZones(inventory.zones, market.currentPrice, atrUsable ? market.atr.value : null);
  const support = clusters.filter((cluster) => cluster.price <= market.currentPrice).sort((a, b) => b.price - a.price);
  const resistance = clusters.filter((cluster) => cluster.price > market.currentPrice).sort((a, b) => a.price - b.price);
  const oneMinuteSession = sessionCandles(input.oneMinute.candles, market.timestamp);
  const fiveMinuteCompleted = completedCandles(
    sessionCandles(input.fiveMinute.candles, market.timestamp),
    5 * 60 * 1000,
    market.timestamp,
  );
  const sessionHigh = oneMinuteSession.length
    ? Math.max(...oneMinuteSession.map((candle) => candle.high))
    : null;
  const highIndex = sessionHigh === null
    ? -1
    : oneMinuteSession.findIndex((candle) => candle.high === sessionHigh);
  const originWindow = highIndex >= 0 ? oneMinuteSession.slice(0, highIndex + 1) : [];
  const sessionOrigin = originWindow.length
    ? Math.min(...originWindow.map((candle) => candle.low))
    : null;
  const recentCompleted = fiveMinuteCompleted.slice(-4);
  const baseLow = recentCompleted.length >= 3
    ? Math.min(...recentCompleted.map((candle) => candle.low))
    : null;
  const baseHigh = recentCompleted.length >= 3
    ? Math.max(...recentCompleted.map((candle) => candle.high))
    : null;
  const extensionFromOriginPct = sessionOrigin && sessionOrigin > 0
    ? (market.currentPrice / sessionOrigin - 1) * 100
    : null;
  const extensionFromVwapPct = market.technicalContext?.priceVsVwapPct ?? null;
  const extensionThresholdPct = atrUsable
    ? Math.max(12, (market.atr.pct ?? 0) * 3)
    : 20;
  const isExtended = (extensionFromOriginPct ?? 0) >= extensionThresholdPct;
  const baseRangePct = baseLow && baseHigh ? ((baseHigh - baseLow) / baseLow) * 100 : null;
  const baseIsTight = baseRangePct !== null && (
    atrUsable ? baseRangePct <= Math.max(5, (market.atr.pct ?? 0) * 1.5) : baseRangePct <= 8
  );
  const hold = support[0];
  const priceBelowHold = Boolean(hold && market.currentPrice < hold.low);
  const lastCompleted = fiveMinuteCompleted.at(-1);
  const confirmedAboveMustClear = Boolean(
    resistance[0] && lastCompleted && lastCompleted.close > resistance[0].high,
  );
  let state: DayTradeAdapterState = "recovery_watch";
  if (!market.levels || oneMinuteSession.length === 0 || fiveMinuteCompleted.length === 0) {
    state = "insufficient_data";
  } else if (priceBelowHold) {
    state = "failed_structure";
  } else if (confirmedAboveMustClear) {
    state = "continuation_confirmed";
  } else if (isExtended && !baseIsTight) {
    state = "extreme_extension_no_base";
  } else if (isExtended && baseIsTight) {
    state = "base_forming";
  } else if (hold && market.currentPrice <= hold.high * 1.015) {
    state = "pullback_testing";
  } else if (market.technicalContext?.aboveVwap === false || market.technicalContext?.aboveEma9 === false) {
    state = "reclaim_required";
  }
  if (input.oneMinute.stale || input.fiveMinute.stale) flags.push("stale_yahoo_candles");
  if (input.oneMinute.validationIssues.length || input.fiveMinute.validationIssues.length) {
    flags.push("yahoo_validation_issues");
  }
  if (!market.technicalContext || market.technicalContext.confidence === "unavailable") {
    flags.push("technical_context_unavailable");
  }
  const confidence = state === "insufficient_data"
    ? "unavailable"
    : flags.length >= 2
      ? "low"
      : flags.length === 1 || market.technicalContext?.confidence === "low"
        ? "medium"
        : "high";
  const needsToHold = withRole(hold, "hold");
  const mustClear = withRole(resistance[0], "must_clear");
  const continuation = withRole(resistance[1], "continuation");
  const expansionTargets = resistance.slice(2)
    .filter((cluster) => cluster.strength === "strong" || cluster.strength === "major" || cluster.evidenceCount >= 3)
    .slice(0, 3)
    .map((cluster) => ({ ...cluster, role: "expansion" as const }));
  const nearbyObstacles = resistance.slice(0, 3)
    .filter((cluster) => !expansionTargets.some((target) => target.levelIds.some((id) => cluster.levelIds.includes(id))))
    .map((cluster) => ({ ...cluster, role: "obstacle" as const }));
  const summary = state === "extreme_extension_no_base"
    ? "Price is extended from the session origin without a confirmed base; avoid treating the nearest ladder level as automatic support."
    : state === "base_forming"
      ? "An extended move is consolidating, but the same-day base remains provisional until completed candles confirm it."
      : state === "pullback_testing"
        ? "Price is testing the nearest evidence cluster; a completed hold or reclaim is required before continuation."
        : state === "reclaim_required"
          ? "Price is below an intraday trend reference; reclaim VWAP or EMA structure before treating overhead levels as targets."
          : state === "continuation_confirmed"
            ? "A completed five-minute candle cleared the first supply cluster; use the next evidence area for continuation, not a fixed percentage target."
            : state === "failed_structure"
              ? "Price is below the nearest hold cluster; the prior setup is invalid until structure is reclaimed."
              : state === "insufficient_data"
                ? "The adapter does not have enough completed session candles and level evidence to form a plan."
                : "Structure is mixed; preserve the hold, reclaim, and must-clear conditions while the chart develops.";

  return {
    symbol: market.symbol,
    generatedAt: market.timestamp,
    state,
    confidence,
    summary,
    extension: {
      sessionOrigin: sessionOrigin === null ? null : roundPrice(sessionOrigin),
      sessionHigh: sessionHigh === null ? null : roundPrice(sessionHigh),
      extensionFromOriginPct: extensionFromOriginPct === null ? null : Number(extensionFromOriginPct.toFixed(1)),
      extensionFromVwapPct: extensionFromVwapPct === null ? null : Number(extensionFromVwapPct.toFixed(1)),
      baseLow: baseLow === null ? null : roundPrice(baseLow),
      baseHigh: baseHigh === null ? null : roundPrice(baseHigh),
      provisional: true,
    },
    plan: {
      needsToHold,
      pullbackArea: withRole(support[0], "pullback"),
      mustClear,
      nearbyObstacles,
      continuation,
      expansionTargets,
      invalidation: withRole(support[1], "invalidation"),
    },
    diagnostics: {
      livePriceAgeMs: market.livePriceUpdatedAt === null
        ? null
        : Math.max(0, market.timestamp - market.livePriceUpdatedAt),
      technicalContext: market.technicalContext,
      atr: market.atr,
      candles: [
        candleDiagnostics(input.oneMinute, 60_000, market.timestamp),
        candleDiagnostics(input.fiveMinute, 5 * 60_000, market.timestamp),
      ],
      levelInventory: {
        received: inventory.received,
        deduplicated: inventory.zones.length,
        clusters: clusters.length,
        fullLadderSupport: inventory.fullLadderSupport,
        fullLadderResistance: inventory.fullLadderResistance,
      },
      flags,
    },
  };
}

