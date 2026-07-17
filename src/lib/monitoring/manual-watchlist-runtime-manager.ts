import { CandleFetchService } from "../market-data/candle-fetch-service.js";
import type { Candle } from "../market-data/candle-types.js";
import { LevelEngine, type LevelEngineSeriesMap } from "../levels/level-engine.js";
import type { LevelRuntimeComparisonLogEntry } from "../levels/level-runtime-comparison-logger.js";
import type {
  TradersLinkAiReadService,
} from "../ai/traderslink-ai-read-service.js";
import type { TradersLinkAiReadPriceActionContext } from "../ai/traderslink-ai-read-price-action.js";
import type {
  TradersLinkAiReadCostLedger,
  TradersLinkAiReadCostTrigger,
} from "../ai/traderslink-ai-read-cost-ledger.js";
import { resolveLevelRuntimeSettings } from "../levels/level-runtime-mode.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import { decideLevelRefresh } from "../levels/level-refresh-policy.js";
import {
  buildCandleMarketStructureContext,
  buildFormalMarketStructureContext,
  type CandleMarketStructureContext,
  type FormalMarketStructureContext,
} from "../structure/index.js";
import { AlertIntelligenceEngine } from "../alerts/alert-intelligence-engine.js";
import {
  formatLevelIntelligenceDiscordPreview,
  type LevelIntelligenceDiscordPreview,
} from "../alerts/level-intelligence-discord-preview.js";
import {
  formatIntelligentAlertAsPayload,
  type DiscordAlertRouter,
} from "../alerts/alert-router.js";
import {
  buildLiveWatchlistPotentialPathCoverage,
  buildLiveWatchlistSnapshotPatch,
  buildLiveWatchlistStatusPatch,
  buildLiveWatchlistTickerDataPatch,
  buildTradersLinkAiReadPatch,
  buildTradersLinkAiReadVisibilityPatch,
  type LiveWatchlistPotentialPathCoverage,
} from "../live-watchlist/live-watchlist-publisher.js";
import {
  lookupRecentWebsiteArticlesForSymbol,
  publishRecentWebsiteArticlesForSymbol,
} from "../live-watchlist/recent-website-articles.js";
import type {
  LiveWatchlistPublisher,
  TradersLinkAiReadPayload,
} from "../live-watchlist/live-watchlist-types.js";
import type {
  LevelExtensionPayload,
  LevelExtensionSide,
  LevelSnapshotDisplayZone,
  LevelSnapshotPayload,
} from "../alerts/alert-types.js";
import { buildLevelIntelligenceReport } from "../levels/level-intelligence-report.js";
import { formatLevelIntelligenceReport } from "../levels/level-intelligence-report-formatter.js";
import { LevelStore } from "./level-store.js";
import type { LivePriceUpdate, MonitoringEvent, WatchlistEntry } from "./monitoring-types.js";
import { buildOpportunityDiagnosticsLogEntry } from "./opportunity-diagnostics.js";
import { OpportunityRuntimeController } from "./opportunity-runtime-controller.js";
import { formatInterpretationForConsole } from "./opportunity-interpretation.js";
import { WatchlistMonitor } from "./watchlist-monitor.js";
import { WatchlistStatePersistence } from "./watchlist-state-persistence.js";
import { WatchlistStore } from "./watchlist-store.js";

export type ManualWatchlistRuntimeManagerOptions = {
  candleFetchService: CandleFetchService;
  levelStore: LevelStore;
  monitor: WatchlistMonitor;
  discordAlertRouter: DiscordAlertRouter;
  opportunityRuntimeController: OpportunityRuntimeController;
  watchlistStore?: WatchlistStore;
  watchlistStatePersistence?: WatchlistStatePersistence;
  liveWatchlistPublisher?: LiveWatchlistPublisher | null;
  tradersLinkAiReadService?: TradersLinkAiReadService | null;
  tradersLinkAiReadCostLedger?: TradersLinkAiReadCostLedger | null;
  tradersLinkAiReadCandleFetchService?: CandleFetchService | null;
  tradersLinkAiReadStartupRefreshEnabled?: boolean;
  seedSymbolLevels?: (symbol: string, referencePriceOverride?: number) => Promise<void>;
  levelIntelligenceAlertPreviewDryRun?: LevelIntelligenceAlertPreviewDryRunOptions;
};

const TRADERSLINK_AI_READ_AUTO_REFRESH_MIN_MS = 60 * 60 * 1_000;
const TRADERSLINK_AI_READ_RANGE_EDGE_PROGRESS = 0.85;
const TRADERSLINK_AI_READ_5M_FETCH_BARS = 720;
const TRADERSLINK_AI_READ_DAILY_FETCH_BARS = 30;
export type TradersLinkAiReadRequestedTrigger = TradersLinkAiReadCostTrigger | "automatic";

export type TradersLinkAiReadRefreshState = {
  generatedAt: number;
  currentPrice: number;
  upperBoundary: number | null;
  lowerBoundary: number | null;
};

export function decideTradersLinkAiReadRefresh(args: {
  previous: TradersLinkAiReadRefreshState | null;
  currentPrice: number;
  dataAsOf: number;
  force: boolean;
  requestedTrigger: TradersLinkAiReadRequestedTrigger;
  allowInitialGeneration?: boolean;
}): { shouldRefresh: boolean; trigger: TradersLinkAiReadCostTrigger } {
  const previous = args.previous;
  if (!previous) {
    return {
      shouldRefresh: args.force || args.allowInitialGeneration !== false,
      trigger: args.requestedTrigger === "automatic" ? "startup" : args.requestedTrigger,
    };
  }
  const crossedUpperBoundary =
    previous.upperBoundary !== null &&
    previous.currentPrice <= previous.upperBoundary &&
    args.currentPrice > previous.upperBoundary;
  const crossedLowerBoundary =
    previous.lowerBoundary !== null &&
    previous.currentPrice >= previous.lowerBoundary &&
    args.currentPrice < previous.lowerBoundary;
  const crossedAnalysisBoundary = crossedUpperBoundary || crossedLowerBoundary;
  const upperProgress = previous.upperBoundary !== null && previous.upperBoundary > previous.currentPrice
    ? (args.currentPrice - previous.currentPrice) /
      (previous.upperBoundary - previous.currentPrice)
    : Number.NEGATIVE_INFINITY;
  const lowerProgress = previous.lowerBoundary !== null && previous.lowerBoundary < previous.currentPrice
    ? (previous.currentPrice - args.currentPrice) /
      (previous.currentPrice - previous.lowerBoundary)
    : Number.NEGATIVE_INFINITY;
  const reachedRangeEdge =
    !crossedAnalysisBoundary &&
    (upperProgress >= TRADERSLINK_AI_READ_RANGE_EDGE_PROGRESS ||
      lowerProgress >= TRADERSLINK_AI_READ_RANGE_EDGE_PROGRESS);
  const timerElapsed =
    args.dataAsOf - previous.generatedAt >= TRADERSLINK_AI_READ_AUTO_REFRESH_MIN_MS;
  const trigger: TradersLinkAiReadCostTrigger = args.requestedTrigger === "automatic"
    ? crossedAnalysisBoundary
      ? "boundary_cross"
      : reachedRangeEdge
        ? "range_edge"
        : "scheduled"
    : args.requestedTrigger;
  return {
    shouldRefresh: args.force || timerElapsed || reachedRangeEdge || crossedAnalysisBoundary,
    trigger,
  };
}

export type ManualWatchlistActivationInput = {
  symbol: string;
  note?: string;
};

export const LEVEL_INTELLIGENCE_ALERT_PREVIEW_DRY_RUN_ENV =
  "LEVEL_INTELLIGENCE_ALERT_PREVIEW_DRY_RUN";

export type LevelIntelligenceAlertPreviewDryRunBuildOptions = {
  maxMessageLength?: number;
};

export type LevelIntelligenceAlertPreviewDryRunBuilder = (
  output: LevelEngineOutput,
  options: LevelIntelligenceAlertPreviewDryRunBuildOptions,
) => LevelIntelligenceDiscordPreview;

export type LevelIntelligenceAlertPreviewDryRunResult = {
  mode: "dry-run";
  symbol: string;
  timestamp: number;
  alertId: string;
  eventId: string;
  threadId: string;
  levelGeneratedAt: number;
  preview: LevelIntelligenceDiscordPreview;
  content: string;
};

export type LevelIntelligenceAlertPreviewDryRunErrorContext = {
  symbol: string;
  timestamp: number;
  alertId: string;
  eventId: string;
};

export type LevelIntelligenceAlertPreviewDryRunOptions = {
  enabled?: boolean;
  maxMessageLength?: number;
  buildPreview?: LevelIntelligenceAlertPreviewDryRunBuilder;
  onPreview?: (result: LevelIntelligenceAlertPreviewDryRunResult) => void;
  onError?: (error: Error, context: LevelIntelligenceAlertPreviewDryRunErrorContext) => void;
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeBooleanEnvValue(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function resolveLevelIntelligenceAlertPreviewDryRun(
  value?: string | null,
): boolean {
  const normalized = normalizeBooleanEnvValue(value);
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

type ActiveLevelSnapshotState = {
  lastSnapshot: string;
  highestResistance: number | null;
  resistanceRefreshBoundary: number | null;
  lowestSupport: number | null;
  referencePrice: number | null;
  lastRefreshTriggerResistance: number | null;
  lastRefreshTriggerSupport: number | null;
  lastRefreshTimestamp: number | null;
  lastExtensionPostKey: string | null;
  lastExtensionPostTimestamp: number | null;
};

function defaultBuildLevelIntelligenceAlertPreviewDryRun(
  output: LevelEngineOutput,
  options: LevelIntelligenceAlertPreviewDryRunBuildOptions,
): LevelIntelligenceDiscordPreview {
  const report = buildLevelIntelligenceReport({ output });
  const formatted = formatLevelIntelligenceReport(report);
  const previewOptions: LevelIntelligenceAlertPreviewDryRunBuildOptions = {};

  if (options.maxMessageLength !== undefined) {
    previewOptions.maxMessageLength = options.maxMessageLength;
  }

  return formatLevelIntelligenceDiscordPreview(formatted, previewOptions);
}

function renderLevelIntelligenceAlertPreviewDryRun(
  result: Omit<LevelIntelligenceAlertPreviewDryRunResult, "content">,
): string {
  const lines: string[] = [
    `${result.symbol} level intelligence alert preview (dry-run)`,
    `Alert id: ${result.alertId}`,
    `Event id: ${result.eventId}`,
    `Thread id: ${result.threadId}`,
    `Level generated at: ${result.levelGeneratedAt}`,
    `Messages: ${result.preview.messages.length}`,
    `Truncated: ${result.preview.truncated ? "yes" : "no"}`,
    "",
  ];

  for (const message of result.preview.messages) {
    lines.push(`--- preview message ${message.index} ---`);
    lines.push(message.text);
    lines.push("");
  }

  lines.push("Safety");
  lines.push("- Preview/test path only.");
  lines.push("- Existing alert payload unchanged.");
  lines.push("- Discord posting not invoked by preview sidecar.");
  lines.push("- Existing live alert routing remains the only alert route.");

  return `${lines.join("\n").trimEnd()}\n`;
}

const LEVEL_REFRESH_THRESHOLD_PCT = 0.01;
const LEVEL_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const LIVE_REFERENCE_ALIGNMENT_THRESHOLD_PCT = 0.01;
const LIVE_REFERENCE_CACHE_MAX_AGE_MS = 2 * 60 * 1000;
const LEVEL_PATH_MIN_LEVELS_PER_SIDE = 4;
const LEVEL_PATH_RESISTANCE_REFRESH_RUNWAY_PCT = 0.2;
const LEVEL_PATH_RESISTANCE_TARGET_RUNWAY_PCT = 0.3;
const LEVEL_PATH_SUPPORT_REFRESH_RUNWAY_PCT = 0.1;
const LEVEL_PATH_SUPPORT_TARGET_RUNWAY_PCT = 0.15;
const SNAPSHOT_PRICE_TOLERANCE_PCT = 0.001;
const SNAPSHOT_PRICE_TOLERANCE_ABSOLUTE = 0.001;
const SNAPSHOT_DISPLAY_COMPACTION_PCT = 0.0075;
const SNAPSHOT_DISPLAY_COMPACTION_ABSOLUTE = 0.01;
const SNAPSHOT_MIN_FORWARD_RESISTANCE_RANGE_PCT = 0.5;
const SNAPSHOT_MAX_FORWARD_RESISTANCE_RANGE_PCT = 1;
const SNAPSHOT_FULL_LOW_PRICE_COVERAGE_AT = 1.5;
const SNAPSHOT_BASE_COVERAGE_AT = 2.5;

function uniqueSortedLevels(levels: number[], direction: "asc" | "desc"): number[] {
  const unique = [...new Set(levels.filter((level) => Number.isFinite(level) && level > 0))];
  unique.sort((a, b) => (direction === "asc" ? a - b : b - a));
  return unique;
}

function snapshotPriceTolerance(price: number): number {
  return Math.max(price * SNAPSHOT_PRICE_TOLERANCE_PCT, SNAPSHOT_PRICE_TOLERANCE_ABSOLUTE);
}

function snapshotDisplayCompactionTolerance(price: number): number {
  return Math.max(price * SNAPSHOT_DISPLAY_COMPACTION_PCT, SNAPSHOT_DISPLAY_COMPACTION_ABSOLUTE);
}

function formatSnapshotLevel(level: number): string {
  return level >= 1 ? level.toFixed(2) : level.toFixed(4);
}

function snapshotForwardResistanceRangePct(currentPrice: number): number {
  if (currentPrice <= SNAPSHOT_FULL_LOW_PRICE_COVERAGE_AT) {
    return SNAPSHOT_MAX_FORWARD_RESISTANCE_RANGE_PCT;
  }
  if (currentPrice >= SNAPSHOT_BASE_COVERAGE_AT) {
    return SNAPSHOT_MIN_FORWARD_RESISTANCE_RANGE_PCT;
  }

  const progress =
    (currentPrice - SNAPSHOT_FULL_LOW_PRICE_COVERAGE_AT) /
    (SNAPSHOT_BASE_COVERAGE_AT - SNAPSHOT_FULL_LOW_PRICE_COVERAGE_AT);
  return (
    SNAPSHOT_MAX_FORWARD_RESISTANCE_RANGE_PCT -
    progress *
      (SNAPSHOT_MAX_FORWARD_RESISTANCE_RANGE_PCT -
        SNAPSHOT_MIN_FORWARD_RESISTANCE_RANGE_PCT)
  );
}

function formatStructureLabel(value: string | null | undefined): string {
  return value?.replaceAll("_", " ") ?? "unknown";
}

function formatOptionalStructurePrice(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? formatSnapshotLevel(value)
    : "n/a";
}

function formatFormalStructureLine(
  label: string,
  context: FormalMarketStructureContext,
): string {
  const eventLine =
    context.latestEvent.type === "none"
      ? "no confirmed BOS/CHOCH"
      : context.latestEvent.traderLine;

  const parts = [
    `${label}: ${eventLine}`,
  ];

  if (context.livePricePressure) {
    parts.push(context.livePricePressure.traderLine);
  }

  parts.push(
    `bias ${formatStructureLabel(context.bias)}`,
    `protected high ${formatOptionalStructurePrice(context.protectedHigh?.price)}`,
    `protected low ${formatOptionalStructurePrice(context.protectedLow?.price)}`,
    `confidence ${context.latestEvent.confidence}`,
  );

  return parts.join("; ");
}

function formatTacticalStructureLine(context: CandleMarketStructureContext): string {
  const parts = [
    `Tactical 5m: ${context.traderLine ?? formatStructureLabel(context.state)}`,
    `trend ${formatStructureLabel(context.trend.direction)}`,
    `confidence ${context.confidence.label}`,
  ];

  if (context.range?.active) {
    parts.push(
      `range ${formatSnapshotLevel(context.range.low)}-${formatSnapshotLevel(context.range.high)} (${context.range.quality})`,
    );
  }

  if (context.pivots.latestSwingLow) {
    parts.push(`latest low ${formatSnapshotLevel(context.pivots.latestSwingLow.price)}`);
  }

  if (context.pivots.latestSwingHigh) {
    parts.push(`latest high ${formatSnapshotLevel(context.pivots.latestSwingHigh.price)}`);
  }

  return parts.join("; ");
}

function buildMarketStructureSummary(params: {
  dailyCandles: Candle[];
  fourHourCandles: Candle[];
  fiveMinuteCandles: Candle[];
  symbol: string;
  currentPrice: number;
}): string {
  const dailyStructure = buildFormalMarketStructureContext({
    symbol: params.symbol,
    timeframe: "daily",
    candles: params.dailyCandles,
    currentPrice: params.currentPrice,
  });
  const fourHourStructure = buildFormalMarketStructureContext({
    symbol: params.symbol,
    timeframe: "4h",
    candles: params.fourHourCandles,
    currentPrice: params.currentPrice,
  });
  const tacticalStructure = buildCandleMarketStructureContext({
    symbol: params.symbol,
    candles: params.fiveMinuteCandles,
    currentPrice: params.currentPrice,
  });

  return [
    formatFormalStructureLine("Daily", dailyStructure),
    formatFormalStructureLine("HTF 4h", fourHourStructure),
    formatTacticalStructureLine(tacticalStructure),
  ].join("\n");
}

function freshnessRank(freshness: FinalLevelZone["freshness"]): number {
  switch (freshness) {
    case "fresh":
      return 2;
    case "aging":
      return 1;
    default:
      return 0;
  }
}

function timeframeRank(timeframeBias: FinalLevelZone["timeframeBias"]): number {
  switch (timeframeBias) {
    case "mixed":
      return 3;
    case "daily":
      return 2;
    case "4h":
      return 1;
    default:
      return 0;
  }
}

function formatSnapshotSourceLabel(zone: FinalLevelZone): string | undefined {
  if (zone.extensionMetadata?.extensionSource === "synthetic_continuation_map") {
    return "synthetic extension";
  }
  if (zone.isExtension) {
    return zone.sourceEvidenceCount > 1
      ? "clustered historical extension"
      : "historical extension";
  }
  if (zone.timeframeSources.length > 1) {
    return `${zone.timeframeSources.join("/")} clustered confluence`;
  }
  const source = zone.timeframeSources[0];
  if (!source) {
    return undefined;
  }
  const sourceLabel = source === "5m" ? "intraday" : `${source} structure`;
  return zone.sourceEvidenceCount > 1 ? `${sourceLabel} clustered levels` : sourceLabel;
}

function isBetterSnapshotRepresentative(
  challenger: FinalLevelZone,
  incumbent: FinalLevelZone,
  currentPrice: number,
  side: "support" | "resistance",
): boolean {
  if (challenger.strengthScore !== incumbent.strengthScore) {
    return challenger.strengthScore > incumbent.strengthScore;
  }

  if (challenger.confluenceCount !== incumbent.confluenceCount) {
    return challenger.confluenceCount > incumbent.confluenceCount;
  }

  if (challenger.sourceEvidenceCount !== incumbent.sourceEvidenceCount) {
    return challenger.sourceEvidenceCount > incumbent.sourceEvidenceCount;
  }

  if (timeframeRank(challenger.timeframeBias) !== timeframeRank(incumbent.timeframeBias)) {
    return timeframeRank(challenger.timeframeBias) > timeframeRank(incumbent.timeframeBias);
  }

  if (freshnessRank(challenger.freshness) !== freshnessRank(incumbent.freshness)) {
    return freshnessRank(challenger.freshness) > freshnessRank(incumbent.freshness);
  }

  const challengerDistance = Math.abs(challenger.representativePrice - currentPrice);
  const incumbentDistance = Math.abs(incumbent.representativePrice - currentPrice);
  if (challengerDistance !== incumbentDistance) {
    return challengerDistance < incumbentDistance;
  }

  return side === "support"
    ? challenger.representativePrice > incumbent.representativePrice
    : challenger.representativePrice < incumbent.representativePrice;
}

function sortSnapshotZones(
  zones: FinalLevelZone[],
  side: "support" | "resistance",
): FinalLevelZone[] {
  return [...zones].sort((left, right) =>
    side === "support"
      ? right.representativePrice - left.representativePrice
      : left.representativePrice - right.representativePrice,
  );
}

function isSyntheticContinuationMapZone(zone: FinalLevelZone): boolean {
  return zone.extensionMetadata?.extensionSource === "synthetic_continuation_map";
}

function selectSnapshotResistanceZones(params: {
  zones: FinalLevelZone[];
  currentPrice: number;
  tolerance: number;
  maxSyntheticResistancePrice: number;
}): FinalLevelZone[] {
  const sorted = sortSnapshotZones(
    params.zones.filter(
      (zone) => zone.representativePrice > params.currentPrice + params.tolerance,
    ),
    "resistance",
  );

  return sorted.filter(
    (zone) =>
      !isSyntheticContinuationMapZone(zone) ||
      zone.representativePrice <= params.maxSyntheticResistancePrice,
  );
}

function snapshotResistanceRefreshBoundary(
  zones: LevelSnapshotDisplayZone[],
): number | null {
  if (zones.length >= 2) {
    return zones.at(-2)?.representativePrice ?? null;
  }
  return zones.at(-1)?.representativePrice ?? null;
}

function compactSnapshotZones(
  zones: FinalLevelZone[],
  currentPrice: number,
  side: "support" | "resistance",
): FinalLevelZone[] {
  const sorted = sortSnapshotZones(zones, side);
  const compacted: FinalLevelZone[] = [];
  const tolerance = snapshotDisplayCompactionTolerance(Math.max(currentPrice, 0.0001));

  for (const zone of sorted) {
    const last = compacted.at(-1);
    if (!last) {
      compacted.push(zone);
      continue;
    }

    const sameDisplayPrice =
      formatSnapshotLevel(last.representativePrice) === formatSnapshotLevel(zone.representativePrice);
    const veryClose =
      Math.abs(last.representativePrice - zone.representativePrice) <= tolerance;

    if (!sameDisplayPrice && !veryClose) {
      compacted.push(zone);
      continue;
    }

    if (isBetterSnapshotRepresentative(zone, last, currentPrice, side)) {
      compacted[compacted.length - 1] = zone;
    }
  }

  return compacted;
}

function buildSnapshotDisplayZones(
  zones: FinalLevelZone[],
  _currentPrice: number,
  side: "support" | "resistance",
): LevelSnapshotDisplayZone[] {
  return sortSnapshotZones(zones, side).map((zone) => ({
    representativePrice: zone.representativePrice,
    lowPrice: zone.zoneLow,
    highPrice: zone.zoneHigh,
    strengthLabel: zone.strengthLabel,
    freshness: zone.freshness,
    touchCount: zone.touchCount,
    confluenceCount: zone.confluenceCount,
    sourceEvidenceCount: zone.sourceEvidenceCount,
    ...(zone.firstTimestamp > 0 ? { firstEvidenceAt: zone.firstTimestamp } : {}),
    ...(zone.lastTimestamp > 0 ? { lastEvidenceAt: zone.lastTimestamp } : {}),
    timeframeSources: [...zone.timeframeSources],
    isExtension: zone.isExtension,
    isSynthetic:
      zone.extensionMetadata?.extensionSource === "synthetic_continuation_map",
    sourceLabel: formatSnapshotSourceLabel(zone),
    ...(zone.roleFlipEvidence
      ? { roleFlipEvidence: { ...zone.roleFlipEvidence } }
      : {}),
  }));
}

export class ManualWatchlistRuntimeManager {
  private readonly levelEngine: LevelEngine;
  private readonly watchlistStore: WatchlistStore;
  private readonly watchlistStatePersistence: WatchlistStatePersistence;
  private readonly alertIntelligenceEngine = new AlertIntelligenceEngine();
  private readonly activeSnapshotState = new Map<string, ActiveLevelSnapshotState>();
  private readonly extensionRefreshInFlight = new Set<string>();
  private readonly marketStructureBySymbol = new Map<string, string>();
  private lastPriceUpdateAt: number | null = null;
  private readonly latestLivePriceBySymbol = new Map<string, { price: number; timestamp: number }>();
  private readonly liveReferenceAlignedSymbols = new Set<string>();
  private readonly aiReadInFlight = new Set<string>();
  private readonly aiReadState = new Map<string, TradersLinkAiReadRefreshState>();
  private readonly aiReadInitialGenerationSuppressedSymbols = new Set<string>();
  private isStarted = false;

  constructor(private readonly options: ManualWatchlistRuntimeManagerOptions) {
    const runtimeSettings = resolveLevelRuntimeSettings();
    this.levelEngine = new LevelEngine(options.candleFetchService, undefined, {
      runtimeMode: runtimeSettings.mode,
      compareActivePath: runtimeSettings.compareActivePath,
      ...(runtimeSettings.compareLoggingEnabled
        ? {
            onComparisonLog: (entry: LevelRuntimeComparisonLogEntry) =>
              console.log(JSON.stringify(entry)),
          }
        : {}),
    });
    this.watchlistStore = options.watchlistStore ?? new WatchlistStore();
    this.watchlistStatePersistence =
      options.watchlistStatePersistence ?? new WatchlistStatePersistence();
  }

  private persistWatchlist(): void {
    this.watchlistStatePersistence.save(this.watchlistStore.getEntries());
  }

  isTradersLinkAiReadConfigured(): boolean {
    return Boolean(
      this.options.tradersLinkAiReadService && this.options.liveWatchlistPublisher,
    );
  }

  private async buildTradersLinkAiReadPriceActionContext(
    symbolInput: string,
    dataAsOf: number,
  ): Promise<TradersLinkAiReadPriceActionContext> {
    const symbol = normalizeSymbol(symbolInput);
    const services = [
      this.options.tradersLinkAiReadCandleFetchService,
      this.options.candleFetchService,
    ].filter((service, index, all): service is CandleFetchService =>
      Boolean(service) && all.indexOf(service) === index
    );
    const fetchAsOf = Math.max(dataAsOf, Date.now());
    let intradayCandles: Candle[] = [];
    let dailyCandles: Candle[] = [];
    let source = "runtime OHLCV fallback";

    for (const candleService of services) {
      const [intradayResult, dailyResult] = await Promise.allSettled([
        candleService.fetchCandles({
          symbol,
          timeframe: "5m",
          lookbackBars: TRADERSLINK_AI_READ_5M_FETCH_BARS,
          endTimeMs: fetchAsOf,
        }),
        candleService.fetchCandles({
          symbol,
          timeframe: "daily",
          lookbackBars: TRADERSLINK_AI_READ_DAILY_FETCH_BARS,
          endTimeMs: fetchAsOf,
        }),
      ]);
      if (intradayCandles.length === 0 && intradayResult.status === "fulfilled") {
        const fetched = intradayResult.value.candles;
        if (fetched.length > 0) {
          intradayCandles = fetched;
          source = `${intradayResult.value.provider} full-session OHLCV`;
        }
      }
      if (dailyCandles.length === 0 && dailyResult.status === "fulfilled") {
        const fetched = dailyResult.value.candles;
        if (fetched.length > 0) {
          dailyCandles = fetched;
        }
      }
      if (intradayCandles.length > 0 && dailyCandles.length > 0) {
        break;
      }
    }

    return {
      source,
      fetchedAt: Date.now(),
      priorRegularClose: null,
      intradayCandles,
      dailyCandles,
    };
  }

  private async generateTradersLinkAiRead(
    symbolInput: string,
    force: boolean,
    requestedTrigger: TradersLinkAiReadRequestedTrigger,
  ): Promise<TradersLinkAiReadPayload | null> {
    const service = this.options.tradersLinkAiReadService;
    const publisher = this.options.liveWatchlistPublisher;
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.getEntry(symbol);
    if (!service || !publisher || !entry?.active || entry.tradersLinkAiReadCardVisible === false) {
      return null;
    }
    if (this.aiReadInFlight.has(symbol)) {
      return null;
    }

    const latest = this.latestLivePriceBySymbol.get(symbol);
    if (!latest || !Number.isFinite(latest.price) || latest.price <= 0) {
      return null;
    }
    const dataAsOf = latest.timestamp;
    const snapshot = this.buildLevelSnapshotPayload(
      symbol,
      dataAsOf,
      latest.price,
    );
    if (!Number.isFinite(snapshot.currentPrice) || snapshot.currentPrice <= 0) {
      return null;
    }

    const previous = this.aiReadState.get(symbol);
    const refreshDecision = decideTradersLinkAiReadRefresh({
      previous: previous ?? null,
      currentPrice: snapshot.currentPrice,
      dataAsOf,
      force,
      requestedTrigger,
      allowInitialGeneration: !this.aiReadInitialGenerationSuppressedSymbols.has(symbol),
    });
    if (!refreshDecision.shouldRefresh) {
      return null;
    }
    const trigger = refreshDecision.trigger;

    this.aiReadInFlight.add(symbol);
    try {
      const priceActionPromise = this.buildTradersLinkAiReadPriceActionContext(symbol, dataAsOf);
      let research;
      try {
        research = await lookupRecentWebsiteArticlesForSymbol({ symbol });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[TradersLinkAiRead] Primary press-release/SEC lookup failed for ${symbol}: ${message}`,
        );
        research = {
          ticker: symbol,
          businessDays: 5,
          count: 0,
          articles: [],
        };
      }

      const priceAction = await priceActionPromise;
      const read = await service.generate({ snapshot, research, priceAction, dataAsOf });
      this.options.tradersLinkAiReadCostLedger?.record({ read, trigger });
      const latestEntry = this.watchlistStore.getEntry(symbol);
      if (!latestEntry?.active || latestEntry.tradersLinkAiReadCardVisible === false) {
        return null;
      }
      await publisher.publish(buildTradersLinkAiReadPatch({
        read,
        visible: true,
      }));
      this.aiReadState.set(symbol, {
        generatedAt: read.generatedAt,
        currentPrice: read.currentPrice,
        upperBoundary: [
          read.breakoutContinuation.price,
          ...read.targets.map((target) => target.price),
        ].reduce<number | null>(
          (highest, price) => price === null ? highest : Math.max(highest ?? price, price),
          null,
        ),
        lowerBoundary: [
          read.momentumFailure.price,
          ...read.downsideCheckpoints.map((checkpoint) => checkpoint.price),
        ].reduce<number | null>(
          (lowest, price) => price === null ? lowest : Math.min(lowest ?? price, price),
          null,
        ),
      });
      this.aiReadInitialGenerationSuppressedSymbols.delete(symbol);
      return read;
    } finally {
      this.aiReadInFlight.delete(symbol);
    }
  }

  private scheduleTradersLinkAiRead(
    symbol: string,
    force: boolean,
    trigger: TradersLinkAiReadRequestedTrigger,
  ): void {
    void this.generateTradersLinkAiRead(symbol, force, trigger).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[TradersLinkAiRead] Failed to generate ${normalizeSymbol(symbol)} read: ${message}`);
    });
  }

  async refreshTradersLinkAiRead(symbolInput: string): Promise<TradersLinkAiReadPayload | null> {
    if (!this.isTradersLinkAiReadConfigured()) {
      throw new Error("TradersLink AI Read is not configured.");
    }
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.getEntry(symbol);
    if (!entry?.active) {
      throw new Error(`${symbol} is not active.`);
    }
    return this.generateTradersLinkAiRead(symbol, true, "manual");
  }

  async setTradersLinkAiReadCardVisible(
    symbolInput: string,
    visible: boolean,
  ): Promise<WatchlistEntry | null> {
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.patchEntry(symbol, {
      tradersLinkAiReadCardVisible: visible,
    });
    if (!entry) {
      return null;
    }
    this.persistWatchlist();
    if (this.options.liveWatchlistPublisher) {
      await this.options.liveWatchlistPublisher.publish(
        buildTradersLinkAiReadVisibilityPatch({ symbol, visible }),
      );
    }
    if (visible) {
      this.scheduleTradersLinkAiRead(symbol, true, "visibility_enabled");
    }
    return entry;
  }

  private publishLiveWatchlistStatus(
    symbol: string,
    status: "live" | "stale" | "deactivated",
    updatedAt = Date.now(),
  ): void {
    const publisher = this.options.liveWatchlistPublisher;
    if (!publisher) {
      return;
    }

    void publisher
      .publish(buildLiveWatchlistStatusPatch({ symbol, status, updatedAt }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[ManualWatchlistRuntimeManager] Failed to publish ${symbol} status: ${message}`);
      });
  }

  private publishLiveWatchlistTickerData(update: LivePriceUpdate): void {
    const publisher = this.options.liveWatchlistPublisher;
    if (!publisher?.publishTickerData) {
      return;
    }

    const patch = buildLiveWatchlistTickerDataPatch({
      symbol: update.symbol,
      lastPrice: update.lastPrice,
      timestamp: update.timestamp,
      supportZones: buildSnapshotDisplayZones(
        this.options.levelStore.getSupportZones(update.symbol),
        update.lastPrice,
        "support",
      ),
      resistanceZones: buildSnapshotDisplayZones(
        this.options.levelStore.getResistanceZones(update.symbol),
        update.lastPrice,
        "resistance",
      ),
    });
    if (!patch) {
      return;
    }

    void publisher.publishTickerData(patch).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ManualWatchlistRuntimeManager] Failed to publish ${update.symbol} ticker data: ${message}`);
    });
  }

  private buildLevelSnapshotPayload(
    symbol: string,
    timestamp: number,
    referencePriceOverride?: number,
  ): LevelSnapshotPayload {
    const levels = this.options.levelStore.getLevels(symbol);
    const currentPrice =
      (typeof referencePriceOverride === "number" && Number.isFinite(referencePriceOverride)
        ? referencePriceOverride
        : levels?.metadata.referencePrice) ?? 0;
    const normalizedPrice = Math.max(currentPrice, 0);
    const tolerance = snapshotPriceTolerance(Math.max(normalizedPrice, 0.0001));
    const levelsOutput = this.options.levelStore.getLevels(symbol);
    const maxSyntheticResistancePrice =
      normalizedPrice * (1 + snapshotForwardResistanceRangePct(normalizedPrice));
    const surfacedSupportZones = this.options.levelStore.getSupportZones(symbol);
    const surfacedResistanceZones = this.options.levelStore.getResistanceZones(symbol);
    const extensionSupportZones = levelsOutput?.extensionLevels.support ?? [];
    const extensionResistanceZones = levelsOutput?.extensionLevels.resistance ?? [];
    const supportZones = compactSnapshotZones(
      [...surfacedSupportZones, ...extensionSupportZones]
        .filter((zone) => zone.representativePrice < normalizedPrice - tolerance),
      normalizedPrice,
      "support",
    );
    const resistanceZones = compactSnapshotZones(
      selectSnapshotResistanceZones({
        zones: [...surfacedResistanceZones, ...extensionResistanceZones],
        currentPrice: normalizedPrice,
        tolerance,
        maxSyntheticResistancePrice,
      }),
      normalizedPrice,
      "resistance",
    );
    const supportDisplayZones = buildSnapshotDisplayZones(supportZones, normalizedPrice, "support");
    const resistanceDisplayZones = buildSnapshotDisplayZones(
      resistanceZones,
      normalizedPrice,
      "resistance",
    );

    const marketStructure = this.marketStructureBySymbol.get(symbol.toUpperCase())?.trim();

    return {
      symbol,
      currentPrice: normalizedPrice,
      supportZones: supportDisplayZones,
      resistanceZones: resistanceDisplayZones,
      ...(marketStructure ? { marketStructure } : {}),
      timestamp,
    };
  }

  private buildLevelExtensionPayload(
    symbol: string,
    side: LevelExtensionSide,
    timestamp: number,
  ): LevelExtensionPayload | null {
    const zones =
      side === "resistance"
        ? this.options.levelStore.getExtensionResistanceZones(symbol)
        : this.options.levelStore.getExtensionSupportZones(symbol);
    const levels = uniqueSortedLevels(
      zones.map((zone) => zone.representativePrice),
      side === "resistance" ? "asc" : "desc",
    );

    if (levels.length === 0) {
      return null;
    }

    return {
      symbol,
      side,
      levels,
      timestamp,
    };
  }

  private async postLevelSnapshot(
    symbol: string,
    threadId: string,
    timestamp: number,
    referencePriceOverride?: number,
  ): Promise<void> {
    const payload = this.buildLevelSnapshotPayload(symbol, timestamp, referencePriceOverride);
    const snapshotKey = JSON.stringify({
      symbol: payload.symbol,
      supportZones: payload.supportZones,
      resistanceZones: payload.resistanceZones,
    });
    const existingState = this.activeSnapshotState.get(symbol);

    if (existingState?.lastSnapshot === snapshotKey) {
      this.activeSnapshotState.set(symbol, {
        ...existingState,
        highestResistance: payload.resistanceZones.at(-1)?.representativePrice ?? null,
        resistanceRefreshBoundary: snapshotResistanceRefreshBoundary(payload.resistanceZones),
        lowestSupport: payload.supportZones.at(-1)?.representativePrice ?? null,
        referencePrice: payload.currentPrice,
      });
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "active",
        lastLevelPostAt: timestamp,
        refreshPending: false,
      });
      return;
    }

    await this.options.discordAlertRouter.routeLevelSnapshot(threadId, payload);
    this.activeSnapshotState.set(symbol, {
      lastSnapshot: snapshotKey,
      highestResistance: payload.resistanceZones.at(-1)?.representativePrice ?? null,
      resistanceRefreshBoundary: snapshotResistanceRefreshBoundary(payload.resistanceZones),
      lowestSupport: payload.supportZones.at(-1)?.representativePrice ?? null,
      referencePrice: payload.currentPrice,
      lastRefreshTriggerResistance: null,
      lastRefreshTriggerSupport: null,
      lastRefreshTimestamp: timestamp,
      lastExtensionPostKey: null,
      lastExtensionPostTimestamp: null,
    });
    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "active",
      lastLevelPostAt: timestamp,
      refreshPending: false,
    });
  }

  private async postLevelExtension(
    symbol: string,
    threadId: string,
    side: LevelExtensionSide,
    timestamp: number,
    referencePriceOverride?: number,
  ): Promise<boolean> {
    const payload = this.buildLevelExtensionPayload(symbol, side, timestamp);
    if (!payload) {
      return false;
    }

    const extensionKey = JSON.stringify({
      symbol: payload.symbol,
      side: payload.side,
      levels: payload.levels,
    });
    const existingState = this.activeSnapshotState.get(symbol);
    if (
      existingState?.lastExtensionPostKey === extensionKey &&
      existingState.lastExtensionPostTimestamp !== null &&
      timestamp - existingState.lastExtensionPostTimestamp < LEVEL_REFRESH_COOLDOWN_MS
    ) {
      return false;
    }

    await this.options.discordAlertRouter.routeLevelExtension(threadId, payload);
    this.options.levelStore.activateExtensionLevels(symbol, side);
    const refreshedPayload = this.buildLevelSnapshotPayload(
      symbol,
      timestamp,
      referencePriceOverride ?? existingState?.referencePrice ?? undefined,
    );
    if (this.options.liveWatchlistPublisher) {
      try {
        await this.options.liveWatchlistPublisher.publish(
          buildLiveWatchlistSnapshotPatch(refreshedPayload),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[ManualWatchlistRuntimeManager] Failed to refresh website ladder for ${symbol}: ${message}`,
        );
      }
    }
    const refreshedSnapshotKey = JSON.stringify({
      symbol: refreshedPayload.symbol,
      supportZones: refreshedPayload.supportZones,
      resistanceZones: refreshedPayload.resistanceZones,
    });
    this.activeSnapshotState.set(symbol, {
      lastSnapshot: refreshedSnapshotKey,
      highestResistance: refreshedPayload.resistanceZones.at(-1)?.representativePrice ?? null,
      resistanceRefreshBoundary: snapshotResistanceRefreshBoundary(
        refreshedPayload.resistanceZones,
      ),
      lowestSupport: refreshedPayload.supportZones.at(-1)?.representativePrice ?? null,
      referencePrice: refreshedPayload.currentPrice,
      lastRefreshTriggerResistance: existingState?.lastRefreshTriggerResistance ?? null,
      lastRefreshTriggerSupport: existingState?.lastRefreshTriggerSupport ?? null,
      lastRefreshTimestamp: existingState?.lastRefreshTimestamp ?? null,
      lastExtensionPostKey: extensionKey,
      lastExtensionPostTimestamp: timestamp,
    });
    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "active",
      lastExtensionPostAt: timestamp,
    });
    return true;
  }

  private async refreshLevelsIfNeeded(symbol: string, timestamp: number): Promise<boolean> {
    const current = this.options.levelStore.getLevels(symbol);
    const decision = decideLevelRefresh({
      output: current,
      referenceTimestamp: timestamp,
    });

    if (!decision.shouldRefresh) {
      return false;
    }

    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "refresh_pending",
      refreshPending: true,
    });
    await this.seedLevelsForSymbol(symbol);
    return true;
  }

  private async refreshMarketStructureForSymbol(
    symbol: string,
    currentPrice: number | undefined,
    seededSeries?: LevelEngineSeriesMap,
  ): Promise<void> {
    if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      return;
    }

    try {
      const resolvedSeries = seededSeries ?? await (async () => {
        const [daily, fourHour, fiveMinute] = await Promise.all([
          this.options.candleFetchService.fetchCandles({
            symbol,
            timeframe: "daily",
            lookbackBars: 220,
          }),
          this.options.candleFetchService.fetchCandles({
            symbol,
            timeframe: "4h",
            lookbackBars: 180,
          }),
          this.options.candleFetchService.fetchCandles({
            symbol,
            timeframe: "5m",
            lookbackBars: 100,
          }),
        ]);

        return {
          daily,
          "4h": fourHour,
          "5m": fiveMinute,
        };
      })();

      const summary = buildMarketStructureSummary({
        symbol,
        currentPrice,
        dailyCandles: resolvedSeries.daily.candles,
        fourHourCandles: resolvedSeries["4h"].candles,
        fiveMinuteCandles: resolvedSeries["5m"].candles,
      });

      this.marketStructureBySymbol.set(symbol.toUpperCase(), summary);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[ManualWatchlistRuntimeManager] Failed to refresh market structure for ${symbol}: ${normalizedError.message}`,
      );
    }
  }

  private potentialPathCoverage(
    symbol: string,
    currentPrice: number,
    side: LevelExtensionSide,
  ): LiveWatchlistPotentialPathCoverage {
    const zones = side === "resistance"
      ? [
          ...this.options.levelStore.getResistanceZones(symbol),
          ...this.options.levelStore.getExtensionResistanceZones(symbol),
        ]
      : [
          ...this.options.levelStore.getSupportZones(symbol),
          ...this.options.levelStore.getExtensionSupportZones(symbol),
        ];

    return buildLiveWatchlistPotentialPathCoverage({
      zones: buildSnapshotDisplayZones(zones, currentPrice, side),
      currentPrice,
      side,
    });
  }

  private pathCoverageNeedsRefresh(
    side: LevelExtensionSide,
    coverage: LiveWatchlistPotentialPathCoverage,
  ): boolean {
    const minimumRunway = side === "resistance"
      ? LEVEL_PATH_RESISTANCE_REFRESH_RUNWAY_PCT
      : LEVEL_PATH_SUPPORT_REFRESH_RUNWAY_PCT;
    return (
      coverage.levelCount < LEVEL_PATH_MIN_LEVELS_PER_SIDE ||
      coverage.outerDistancePct === null ||
      coverage.outerDistancePct < minimumRunway
    );
  }

  private pathCoverageMeetsTarget(
    side: LevelExtensionSide,
    coverage: LiveWatchlistPotentialPathCoverage,
  ): boolean {
    const targetRunway = side === "resistance"
      ? LEVEL_PATH_RESISTANCE_TARGET_RUNWAY_PCT
      : LEVEL_PATH_SUPPORT_TARGET_RUNWAY_PCT;
    return (
      coverage.levelCount >= LEVEL_PATH_MIN_LEVELS_PER_SIDE &&
      coverage.outerDistancePct !== null &&
      coverage.outerDistancePct >= targetRunway
    );
  }

  private resistanceBoundaryNeedsRefresh(
    update: LivePriceUpdate,
    snapshotState: ActiveLevelSnapshotState,
  ): boolean {
    const boundary =
      snapshotState.resistanceRefreshBoundary ?? snapshotState.highestResistance;
    return boundary !== null &&
      (boundary - update.lastPrice) / Math.max(boundary, 0.0001) <=
        LEVEL_REFRESH_THRESHOLD_PCT;
  }

  private supportBoundaryNeedsRefresh(
    update: LivePriceUpdate,
    snapshotState: ActiveLevelSnapshotState,
  ): boolean {
    const boundary = snapshotState.lowestSupport;
    return boundary !== null &&
      (update.lastPrice - boundary) / Math.max(boundary, 0.0001) <=
        LEVEL_REFRESH_THRESHOLD_PCT;
  }

  private shouldTriggerResistanceRefresh(
    update: LivePriceUpdate,
    snapshotState: ActiveLevelSnapshotState,
  ): boolean {
    const boundary =
      snapshotState.resistanceRefreshBoundary ?? snapshotState.highestResistance;
    const boundaryTriggered = this.resistanceBoundaryNeedsRefresh(update, snapshotState);
    const coverage = this.potentialPathCoverage(
      update.symbol,
      update.lastPrice,
      "resistance",
    );
    const coverageTriggered = this.pathCoverageNeedsRefresh("resistance", coverage);

    if (!boundaryTriggered && !coverageTriggered) {
      return false;
    }

    const triggerLevel = boundary ?? coverage.prices.at(-1) ?? 0;
    if (
      snapshotState.lastRefreshTimestamp !== null &&
      update.timestamp - snapshotState.lastRefreshTimestamp < LEVEL_REFRESH_COOLDOWN_MS &&
      (
        (coverageTriggered && snapshotState.lastRefreshTriggerResistance !== null) ||
        snapshotState.lastRefreshTriggerResistance === triggerLevel
      )
    ) {
      return false;
    }

    return true;
  }

  private shouldTriggerSupportRefresh(
    update: LivePriceUpdate,
    snapshotState: ActiveLevelSnapshotState,
  ): boolean {
    const boundary = snapshotState.lowestSupport;
    const boundaryTriggered = this.supportBoundaryNeedsRefresh(update, snapshotState);
    const coverage = this.potentialPathCoverage(
      update.symbol,
      update.lastPrice,
      "support",
    );
    const coverageTriggered = this.pathCoverageNeedsRefresh("support", coverage);

    if (!boundaryTriggered && !coverageTriggered) {
      return false;
    }

    const triggerLevel = boundary ?? coverage.prices.at(-1) ?? 0;
    if (
      snapshotState.lastRefreshTimestamp !== null &&
      update.timestamp - snapshotState.lastRefreshTimestamp < LEVEL_REFRESH_COOLDOWN_MS &&
      (
        (coverageTriggered && snapshotState.lastRefreshTriggerSupport !== null) ||
        snapshotState.lastRefreshTriggerSupport === triggerLevel
      )
    ) {
      return false;
    }

    return true;
  }

  private async maybeRefreshLevelSnapshot(update: LivePriceUpdate): Promise<void> {
    const symbol = normalizeSymbol(update.symbol);
    if (this.extensionRefreshInFlight.has(symbol)) {
      return;
    }

    const entry = this.watchlistStore.getEntry(symbol);
    const snapshotState = this.activeSnapshotState.get(symbol);

    if (
      !entry?.active ||
      !entry.discordThreadId ||
      !snapshotState
    ) {
      return;
    }

    const firstLiveReference = !this.liveReferenceAlignedSymbols.has(symbol);
    if (firstLiveReference) {
      const seededReference = snapshotState.referencePrice;
      const liveReferenceDistancePct =
        seededReference && seededReference > 0
          ? Math.abs(update.lastPrice - seededReference) / Math.max(update.lastPrice, seededReference)
          : Number.POSITIVE_INFINITY;

      if (liveReferenceDistancePct >= LIVE_REFERENCE_ALIGNMENT_THRESHOLD_PCT) {
        this.extensionRefreshInFlight.add(symbol);
        try {
          this.watchlistStore.patchEntry(symbol, {
            lifecycle: "refresh_pending",
            refreshPending: true,
          });
          await this.seedLevelsForSymbol(symbol, update.lastPrice);
          await this.postLevelSnapshot(
            symbol,
            entry.discordThreadId,
            update.timestamp,
            update.lastPrice,
          );
          this.liveReferenceAlignedSymbols.add(symbol);
        } finally {
          this.extensionRefreshInFlight.delete(symbol);
        }
        return;
      }

      this.liveReferenceAlignedSymbols.add(symbol);
    }

    const resistanceCoverage = this.potentialPathCoverage(
      symbol,
      update.lastPrice,
      "resistance",
    );
    const supportCoverage = this.potentialPathCoverage(
      symbol,
      update.lastPrice,
      "support",
    );
    const resistanceCoverageTriggered = this.pathCoverageNeedsRefresh(
      "resistance",
      resistanceCoverage,
    );
    const supportCoverageTriggered = this.pathCoverageNeedsRefresh(
      "support",
      supportCoverage,
    );
    const triggeredResistance = this.shouldTriggerResistanceRefresh(update, snapshotState);
    const triggeredSupport = this.shouldTriggerSupportRefresh(update, snapshotState);

    if (!triggeredResistance && !triggeredSupport) {
      return;
    }

    const resistanceBoundaryTriggered =
      triggeredResistance && this.resistanceBoundaryNeedsRefresh(update, snapshotState);
    const supportBoundaryTriggered =
      triggeredSupport && this.supportBoundaryNeedsRefresh(update, snapshotState);
    const side: LevelExtensionSide =
      supportBoundaryTriggered && !resistanceBoundaryTriggered
        ? "support"
        : triggeredResistance
          ? "resistance"
          : "support";
    const boundary =
      side === "resistance"
        ? snapshotState.resistanceRefreshBoundary ?? snapshotState.highestResistance ??
          resistanceCoverage.prices.at(-1) ?? 0
        : snapshotState.lowestSupport ?? supportCoverage.prices.at(-1) ?? 0;
    const selectedBoundaryTriggered = side === "resistance"
      ? resistanceBoundaryTriggered
      : supportBoundaryTriggered;
    const coverageTriggered = !selectedBoundaryTriggered && (
      side === "resistance"
        ? resistanceCoverageTriggered
        : supportCoverageTriggered
    );

    this.extensionRefreshInFlight.add(symbol);
    try {
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "extension_pending",
      });

      let extensionPosted = false;
      let rebuiltLevels = false;
      if (!coverageTriggered) {
        extensionPosted = await this.postLevelExtension(
          symbol,
          entry.discordThreadId,
          side,
          update.timestamp,
          update.lastPrice,
        );
      }
      const cachedExtensionState = this.activeSnapshotState.get(symbol);
      const cachedExtensionPostKey = extensionPosted
        ? cachedExtensionState?.lastExtensionPostKey ?? null
        : null;
      const cachedExtensionPostTimestamp = extensionPosted
        ? cachedExtensionState?.lastExtensionPostTimestamp ?? null
        : null;

      const coverageAfterCachedExtension = this.potentialPathCoverage(
        symbol,
        update.lastPrice,
        side,
      );
      if (
        coverageTriggered ||
        !extensionPosted ||
        !this.pathCoverageMeetsTarget(side, coverageAfterCachedExtension)
      ) {
        rebuiltLevels = true;
        await this.seedLevelsForSymbol(symbol, update.lastPrice);
        await this.postLevelSnapshot(
          symbol,
          entry.discordThreadId,
          update.timestamp,
          update.lastPrice,
        );
        if (cachedExtensionPostKey) {
          const rebuiltSnapshotState = this.activeSnapshotState.get(symbol);
          if (rebuiltSnapshotState) {
            this.activeSnapshotState.set(symbol, {
              ...rebuiltSnapshotState,
              lastExtensionPostKey: cachedExtensionPostKey,
              lastExtensionPostTimestamp: cachedExtensionPostTimestamp,
            });
          }
        }
        const refreshedExtensionPosted = await this.postLevelExtension(
          symbol,
          entry.discordThreadId,
          side,
          update.timestamp,
          update.lastPrice,
        );
        extensionPosted = refreshedExtensionPosted || extensionPosted;
      }

      if (rebuiltLevels && !extensionPosted && this.options.liveWatchlistPublisher) {
        try {
          await this.options.liveWatchlistPublisher.publish(
            buildLiveWatchlistSnapshotPatch(
              this.buildLevelSnapshotPayload(symbol, update.timestamp, update.lastPrice),
            ),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[ManualWatchlistRuntimeManager] Failed to publish rebuilt website ladder for ${symbol}: ${message}`,
          );
        }
      }

      const refreshedState = this.activeSnapshotState.get(symbol);
      this.activeSnapshotState.set(symbol, {
        lastSnapshot: refreshedState?.lastSnapshot ?? snapshotState.lastSnapshot,
        highestResistance: refreshedState?.highestResistance ?? snapshotState.highestResistance,
        resistanceRefreshBoundary:
          refreshedState?.resistanceRefreshBoundary ?? snapshotState.resistanceRefreshBoundary,
        lowestSupport: refreshedState?.lowestSupport ?? snapshotState.lowestSupport,
        referencePrice: refreshedState?.referencePrice ?? snapshotState.referencePrice,
        lastRefreshTriggerResistance:
          side === "resistance" ? boundary : refreshedState?.lastRefreshTriggerResistance ?? snapshotState.lastRefreshTriggerResistance,
        lastRefreshTriggerSupport:
          side === "support" ? boundary : refreshedState?.lastRefreshTriggerSupport ?? snapshotState.lastRefreshTriggerSupport,
        lastRefreshTimestamp: update.timestamp,
        lastExtensionPostKey: refreshedState?.lastExtensionPostKey ?? snapshotState.lastExtensionPostKey,
        lastExtensionPostTimestamp:
          refreshedState?.lastExtensionPostTimestamp ?? snapshotState.lastExtensionPostTimestamp,
      });

      if (!extensionPosted) {
        this.watchlistStore.patchEntry(symbol, {
          lifecycle: "active",
        });
      }
    } finally {
      this.extensionRefreshInFlight.delete(symbol);
    }
  }

  private async seedLevelsForSymbol(
    symbol: string,
    referencePriceOverride?: number,
  ): Promise<void> {
    if (this.options.seedSymbolLevels) {
      await this.options.seedSymbolLevels(symbol, referencePriceOverride);
      return;
    }

    const cachedLiveReference = this.latestLivePriceBySymbol.get(normalizeSymbol(symbol));
    const cachedLiveReferencePrice =
      cachedLiveReference &&
      Date.now() - cachedLiveReference.timestamp <= LIVE_REFERENCE_CACHE_MAX_AGE_MS
        ? cachedLiveReference.price
        : undefined;

    const generation = await this.levelEngine.generateLevelsWithSeries({
      symbol,
      referencePriceOverride:
        referencePriceOverride ?? cachedLiveReferencePrice,
      historicalRequests: {
        daily: { symbol, timeframe: "daily", lookbackBars: 220 },
        "4h": { symbol, timeframe: "4h", lookbackBars: 180 },
        "5m": { symbol, timeframe: "5m", lookbackBars: 100 },
      },
    });
    const { output, seriesByTimeframe } = generation;

    this.options.levelStore.setLevels(output);
    await this.refreshMarketStructureForSymbol(
      symbol,
      output.metadata.referencePrice,
      seriesByTimeframe,
    );
  }

  private emitTraderFacingInterpretations(
    interpretations?: ReturnType<OpportunityRuntimeController["processMonitoringEvent"]>["interpretations"],
  ): void {
    for (const interpretation of interpretations ?? []) {
      console.log(formatInterpretationForConsole(interpretation));
    }
  }

  private async ensureLevelsForActiveEntries(entries: WatchlistEntry[]): Promise<void> {
    for (const entry of entries) {
      if (!entry.active) {
        continue;
      }

      if (!this.options.levelStore.getLevels(entry.symbol)) {
        this.watchlistStore.patchEntry(entry.symbol, {
          lifecycle: "refresh_pending",
          refreshPending: true,
        });
        await this.seedLevelsForSymbol(entry.symbol);
      }
    }
  }

  private emitLevelIntelligenceAlertPreviewDryRun(params: {
    event: MonitoringEvent;
    threadId: string;
    levels: LevelEngineOutput | undefined;
    alertId: string;
  }): void {
    const options = this.options.levelIntelligenceAlertPreviewDryRun;
    if (!options?.enabled || !params.levels) {
      return;
    }

    const context: LevelIntelligenceAlertPreviewDryRunErrorContext = {
      symbol: params.event.symbol,
      timestamp: params.event.timestamp,
      alertId: params.alertId,
      eventId: params.event.id,
    };

    try {
      const buildPreview = options.buildPreview ?? defaultBuildLevelIntelligenceAlertPreviewDryRun;
      const buildOptions: LevelIntelligenceAlertPreviewDryRunBuildOptions = {};
      if (options.maxMessageLength !== undefined) {
        buildOptions.maxMessageLength = options.maxMessageLength;
      }
      const preview = buildPreview(params.levels, {
        ...buildOptions,
      });
      const resultWithoutContent: Omit<LevelIntelligenceAlertPreviewDryRunResult, "content"> = {
        mode: "dry-run",
        symbol: params.event.symbol,
        timestamp: params.event.timestamp,
        alertId: params.alertId,
        eventId: params.event.id,
        threadId: params.threadId,
        levelGeneratedAt: params.levels.generatedAt,
        preview,
      };
      const result: LevelIntelligenceAlertPreviewDryRunResult = {
        ...resultWithoutContent,
        content: renderLevelIntelligenceAlertPreviewDryRun(resultWithoutContent),
      };

      if (options.onPreview) {
        options.onPreview(result);
      } else {
        console.log(result.content);
      }
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      if (options.onError) {
        options.onError(normalizedError, context);
        return;
      }

      console.error(
        `[ManualWatchlistRuntimeManager] Level Intelligence alert preview dry-run failed for ${context.symbol}: ${normalizedError.message}`,
      );
    }
  }

  private handleMonitoringEvent = (event: MonitoringEvent): void => {
    const entry = this.watchlistStore.getEntry(event.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return;
    }

    const levels = this.options.levelStore.getLevels(event.symbol);
    const alertResult = this.alertIntelligenceEngine.processEvent(event, levels);
    if (alertResult.formatted) {
      const alert = formatIntelligentAlertAsPayload(alertResult.rawAlert);
      void this.options.discordAlertRouter.routeAlert(entry.discordThreadId, alert).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntimeManager] Failed to route Discord alert: ${message}`);
      });
      this.emitLevelIntelligenceAlertPreviewDryRun({
        event,
        threadId: entry.discordThreadId,
        levels,
        alertId: alertResult.rawAlert.id,
      });
    }

    const snapshot = this.options.opportunityRuntimeController.processMonitoringEvent(event);
    this.emitTraderFacingInterpretations(snapshot.interpretations);
    if (snapshot.newOpportunity) {
      console.log(JSON.stringify(
        buildOpportunityDiagnosticsLogEntry("opportunity_snapshot", snapshot, {
          symbol: event.symbol,
          timestamp: event.timestamp,
        }),
        null,
        2,
      ));
    }
  };

  private handlePriceUpdate = (update: LivePriceUpdate): void => {
    this.lastPriceUpdateAt = update.timestamp;
    this.latestLivePriceBySymbol.set(normalizeSymbol(update.symbol), {
      price: update.lastPrice,
      timestamp: update.timestamp,
    });
    this.publishLiveWatchlistTickerData(update);

    void this.maybeRefreshLevelSnapshot(update)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntimeManager] Failed to refresh level snapshot: ${message}`);
      })
      .finally(() => {
        this.scheduleTradersLinkAiRead(update.symbol, false, "automatic");
      });

    const snapshot = this.options.opportunityRuntimeController.processPriceUpdate(update);
    if (!snapshot) {
      return;
    }

    this.emitTraderFacingInterpretations(snapshot.interpretations);
    if (snapshot.completedEvaluations.length === 0) {
      return;
    }

    console.log(JSON.stringify(
      buildOpportunityDiagnosticsLogEntry("evaluation_update", snapshot, {
        symbol: update.symbol,
        timestamp: update.timestamp,
      }),
      null,
      2,
    ));
  };

  private async restartMonitoring(): Promise<void> {
    await this.options.monitor.stop();
    const activeEntries = this.watchlistStore.getActiveEntries();
    if (!this.options.tradersLinkAiReadStartupRefreshEnabled) {
      for (const entry of activeEntries) {
        this.aiReadInitialGenerationSuppressedSymbols.add(entry.symbol);
      }
    }

    if (activeEntries.length === 0) {
      return;
    }

    await this.ensureLevelsForActiveEntries(activeEntries);
    await this.options.monitor.start(
      activeEntries,
      this.handleMonitoringEvent,
      this.handlePriceUpdate,
    );
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    const persistedEntries = this.watchlistStatePersistence.load();
    if (persistedEntries) {
      this.watchlistStore.setEntries(persistedEntries);
    }

    const activeEntries = this.watchlistStore.getActiveEntries();
    for (const entry of activeEntries) {
      if (!entry.discordThreadId) {
        const thread = await this.options.discordAlertRouter.ensureThread(entry.symbol);
        this.watchlistStore.upsertManualEntry({
          symbol: entry.symbol,
          note: entry.note,
          discordThreadId: thread.threadId,
          active: true,
          lifecycle: "activating",
          activatedAt: entry.activatedAt ?? Date.now(),
          refreshPending: true,
        });
      }
    }
    for (const entry of activeEntries) {
      if (entry.discordThreadId) {
        await this.refreshLevelsIfNeeded(entry.symbol, Date.now());
        if (!this.options.levelStore.getLevels(entry.symbol)) {
          await this.seedLevelsForSymbol(entry.symbol);
        }
        await this.postLevelSnapshot(entry.symbol, entry.discordThreadId, Date.now());
      }
    }

    this.persistWatchlist();
    await this.restartMonitoring();
    for (const entry of this.watchlistStore.getActiveEntries()) {
      if (!this.isTradersLinkAiReadConfigured()) {
        break;
      }
      if (this.options.liveWatchlistPublisher) {
        await this.options.liveWatchlistPublisher.publish(
          buildTradersLinkAiReadVisibilityPatch({
            symbol: entry.symbol,
            visible: entry.tradersLinkAiReadCardVisible !== false,
          }),
        );
      }
      if (this.options.tradersLinkAiReadStartupRefreshEnabled) {
        this.scheduleTradersLinkAiRead(entry.symbol, false, "startup");
      }
    }
    this.isStarted = true;
  }

  async stop(): Promise<void> {
    await this.options.monitor.stop();
    this.latestLivePriceBySymbol.clear();
    this.liveReferenceAlignedSymbols.clear();
    this.aiReadInitialGenerationSuppressedSymbols.clear();
    this.isStarted = false;
  }

  getActiveEntries(): WatchlistEntry[] {
    return this.watchlistStore.getActiveEntries();
  }

  getRuntimeHealth(): {
    lastPriceUpdateAt: number | null;
    providerHealth: { priceFeedStatus: "live" | "stale" | "waiting" };
  } {
    const activeEntries = this.watchlistStore.getActiveEntries();
    if (activeEntries.length === 0) {
      return {
        lastPriceUpdateAt: this.lastPriceUpdateAt,
        providerHealth: { priceFeedStatus: "waiting" },
      };
    }

    if (!this.lastPriceUpdateAt) {
      return {
        lastPriceUpdateAt: null,
        providerHealth: { priceFeedStatus: "waiting" },
      };
    }

    return {
      lastPriceUpdateAt: this.lastPriceUpdateAt,
      providerHealth: {
        priceFeedStatus: Date.now() - this.lastPriceUpdateAt <= 120_000 ? "live" : "stale",
      },
    };
  }

  async activateSymbol(input: ManualWatchlistActivationInput): Promise<WatchlistEntry> {
    const symbol = normalizeSymbol(input.symbol);
    this.aiReadInitialGenerationSuppressedSymbols.delete(symbol);
    this.latestLivePriceBySymbol.delete(symbol);
    this.liveReferenceAlignedSymbols.delete(symbol);
    const existing = this.watchlistStore.getEntry(symbol);
    const thread = await this.options.discordAlertRouter.ensureThread(
      symbol,
      existing?.discordThreadId,
    );

    const entry = this.watchlistStore.upsertManualEntry({
      symbol,
      note: input.note,
      discordThreadId: thread.threadId,
      active: true,
      lifecycle: "activating",
      activatedAt: Date.now(),
      refreshPending: true,
    });

    await this.seedLevelsForSymbol(symbol);
    await this.postLevelSnapshot(symbol, thread.threadId, Date.now());
    this.persistWatchlist();
    void publishRecentWebsiteArticlesForSymbol({
      symbol,
      publisher: this.options.liveWatchlistPublisher ?? null,
    });
    await this.restartMonitoring();
    if (this.isTradersLinkAiReadConfigured() && this.options.liveWatchlistPublisher) {
      await this.options.liveWatchlistPublisher.publish(
        buildTradersLinkAiReadVisibilityPatch({
          symbol,
          visible: entry.tradersLinkAiReadCardVisible !== false,
        }),
      );
    }
    this.scheduleTradersLinkAiRead(symbol, true, "activation");
    return this.watchlistStore.getEntry(symbol) ?? entry;
  }

  async deactivateSymbol(symbol: string): Promise<WatchlistEntry | null> {
    const normalizedSymbol = normalizeSymbol(symbol);
    const entry = this.watchlistStore.deactivateSymbol(normalizedSymbol);
    if (!entry) {
      return null;
    }

    this.activeSnapshotState.delete(normalizedSymbol);
    this.latestLivePriceBySymbol.delete(normalizedSymbol);
    this.liveReferenceAlignedSymbols.delete(normalizedSymbol);
    this.aiReadState.delete(normalizedSymbol);
    this.aiReadInitialGenerationSuppressedSymbols.delete(normalizedSymbol);
    this.publishLiveWatchlistStatus(entry.symbol, "deactivated");
    this.persistWatchlist();
    await this.restartMonitoring();
    return entry;
  }
}
