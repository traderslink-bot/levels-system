// 2026-04-14 08:42 PM America/Toronto
// Main phase 1 support and resistance engine orchestrator with refined clustering and scoring.

import type { CandleProviderResponse, CandleTimeframe } from "../market-data/candle-types.js";
import { buildVolumeBaselineFromCandles } from "../monitoring/volume-activity.js";
import { CandleFetchService, type HistoricalFetchRequest } from "../market-data/candle-fetch-service.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG, type LevelEngineConfig } from "./level-config.js";
import { clusterRawLevelCandidates } from "./level-clusterer.js";
import {
  buildLevelRuntimeComparisonLogEntry,
  type LevelRuntimeComparisonLogEntry,
} from "./level-runtime-comparison-logger.js";
import type {
  LevelRuntimeCompareActivePath,
  LevelRuntimeMode,
} from "./level-runtime-mode.js";
import { buildNewRuntimeCompatibleLevelOutput } from "./level-runtime-output-adapter.js";
import { buildRawLevelCandidates } from "./raw-level-candidate-builder.js";
import { rankLevelZones } from "./level-ranker.js";
import { normalizeOldPathOutput } from "./level-ranking-comparison.js";
import { scoreLevelZones } from "./level-scorer.js";
import { buildSpecialLevelCandidates } from "./special-level-builder.js";
import { detectSwingPoints } from "./swing-detector.js";
import type { LevelDataFreshness, LevelEngineOutput, RawLevelCandidate } from "./level-types.js";

export type LevelEngineRequest = {
  symbol: string;
  historicalRequests: Record<CandleTimeframe, HistoricalFetchRequest>;
  referencePriceOverride?: number;
};

export type LevelEngineRuntimeOptions = {
  runtimeMode?: LevelRuntimeMode;
  compareActivePath?: LevelRuntimeCompareActivePath;
  onComparisonLog?: (entry: LevelRuntimeComparisonLogEntry) => void;
};

export type LevelEngineOutputWithCandleSeries = {
  output: LevelEngineOutput;
  seriesMap: Record<CandleTimeframe, CandleProviderResponse>;
};

export class LevelEngine {
  constructor(
    private readonly fetchService: CandleFetchService,
    private readonly config: LevelEngineConfig = DEFAULT_LEVEL_ENGINE_CONFIG,
    private readonly runtimeOptions: LevelEngineRuntimeOptions = {},
  ) {}

  private buildUnavailableSeriesFallback(params: {
    symbol: string;
    request: HistoricalFetchRequest;
    fallbackProvider: CandleProviderResponse["provider"];
    reason: string;
  }): CandleProviderResponse {
    const requestEndTimestamp = params.request.endTimeMs ?? Date.now();
    const intervalMs =
      params.request.timeframe === "daily"
        ? 24 * 60 * 60 * 1000
        : params.request.timeframe === "4h"
          ? 4 * 60 * 60 * 1000
          : 5 * 60 * 1000;
    const requestedStartTimestamp = requestEndTimestamp - params.request.lookbackBars * intervalMs;

    return {
      provider: params.fallbackProvider,
      symbol: params.symbol.toUpperCase(),
      timeframe: params.request.timeframe,
      requestedLookbackBars: params.request.lookbackBars,
      candles: [],
      fetchStartTimestamp: requestEndTimestamp,
      fetchEndTimestamp: requestEndTimestamp,
      requestedStartTimestamp,
      requestedEndTimestamp: requestEndTimestamp,
      sessionMetadataAvailable: true,
      actualBarsReturned: 0,
      completenessStatus: "empty",
      stale: true,
      validationIssues: [{
        code: "zero_results",
        severity: "error",
        message: `${params.request.timeframe} candles are unavailable: ${params.reason}`,
      }],
      sessionSummary: null,
      providerMetadata: {
        degraded_reason: "provider_or_validation_unavailable",
      },
    };
  }

  private isSeriesUsable(series: CandleProviderResponse): boolean {
    return series.candles.length > 0 &&
      series.completenessStatus !== "empty" &&
      !series.validationIssues.some((issue) => issue.severity === "error");
  }

  private async loadSeries(
    request: LevelEngineRequest,
  ): Promise<Record<CandleTimeframe, CandleProviderResponse>> {
    const dailyPromise = this.fetchService.fetchCandles(request.historicalRequests.daily);
    const fourHourPromise = this.fetchService.fetchCandles(request.historicalRequests["4h"]);
    const fiveMinutePromise = this.fetchService.fetchCandles(request.historicalRequests["5m"]);

    const [dailyResult, fourHourResult, fiveMinuteResult] = await Promise.allSettled([
      dailyPromise,
      fourHourPromise,
      fiveMinutePromise,
    ]);

    const fallbackProvider = this.fetchService.getProviderName();
    const resolveSeries = (
      result: PromiseSettledResult<CandleProviderResponse>,
      historicalRequest: HistoricalFetchRequest,
    ): CandleProviderResponse => result.status === "fulfilled"
      ? result.value
      : this.buildUnavailableSeriesFallback({
          symbol: request.symbol,
          request: historicalRequest,
          fallbackProvider,
          reason: result.reason instanceof Error ? result.reason.message : "provider request failed",
        });

    return {
      daily: resolveSeries(dailyResult, request.historicalRequests.daily),
      "4h": resolveSeries(fourHourResult, request.historicalRequests["4h"]),
      "5m": resolveSeries(fiveMinuteResult, request.historicalRequests["5m"]),
    };
  }

  private assertSeriesUsable(seriesMap: Record<CandleTimeframe, CandleProviderResponse>): void {
    const availableTimeframes = (["daily", "4h", "5m"] as const)
      .filter((timeframe) => this.isSeriesUsable(seriesMap[timeframe]));
    if (availableTimeframes.length > 0) {
      return;
    }

    const symbol = seriesMap.daily.symbol;
    const causes = (["daily", "4h", "5m"] as const).map((timeframe) => {
      const series = seriesMap[timeframe];
      const errors = series.validationIssues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code);
      return `${timeframe}:${errors.join("+") || "empty"}`;
    });
    throw new Error(
      `Cannot generate levels for ${symbol} because no usable candle series were returned (${causes.join(", ")}).`,
    );
  }

  private deriveOutputMetadata(
    seriesMap: Record<CandleTimeframe, CandleProviderResponse>,
    referenceTimestamp: number,
    referencePriceOverride?: number,
  ): LevelEngineOutput["metadata"] {
    const availableTimeframes = (["daily", "4h", "5m"] as const)
      .filter((timeframe) => this.isSeriesUsable(seriesMap[timeframe]));
    const dataQualityFlags = [
      ...new Set(
        Object.values(seriesMap).flatMap((series) =>
          series.validationIssues.map((issue) => `${series.timeframe}:${issue.code}`),
        ),
      ),
    ];
    for (const timeframe of ["daily", "4h", "5m"] as const) {
      if (!availableTimeframes.includes(timeframe)) {
        dataQualityFlags.push(`${timeframe}:unavailable`);
      }
    }
    const freshestTimestamp = Math.max(...Object.values(seriesMap).map((series) => series.candles.at(-1)?.timestamp ?? 0));
    const ageHours = Math.max(0, referenceTimestamp - freshestTimestamp) / (1000 * 60 * 60);
    const freshness: LevelDataFreshness =
      ageHours <= 24 ? "fresh" : ageHours <= 24 * 7 ? "aging" : "stale";
    const referencePrice =
      typeof referencePriceOverride === "number" &&
      Number.isFinite(referencePriceOverride) &&
      referencePriceOverride > 0
        ? referencePriceOverride
        : seriesMap["5m"].candles.at(-1)?.close ??
          seriesMap["4h"].candles.at(-1)?.close ??
          seriesMap.daily.candles.at(-1)?.close;
    const fiveMinuteVolumeBaseline = buildVolumeBaselineFromCandles(seriesMap["5m"].candles);

    return {
      providerByTimeframe: {
        daily: seriesMap.daily.provider,
        "4h": seriesMap["4h"].provider,
        "5m": seriesMap["5m"].provider,
      },
      dataQualityFlags,
      coverage: availableTimeframes.length === 3 ? "full" : "limited",
      availableTimeframes,
      freshness,
      referencePrice,
      volumeBaselineByTimeframe: {
        ...(fiveMinuteVolumeBaseline ? { "5m": fiveMinuteVolumeBaseline } : {}),
      },
    };
  }

  private deriveReferenceTimestamp(
    seriesMap: Record<CandleTimeframe, CandleProviderResponse>,
  ): number {
    const timestamps = Object.values(seriesMap)
      .map((series) => series.requestedEndTimestamp)
      .filter((timestamp) => Number.isFinite(timestamp));

    if (timestamps.length === 0) {
      return Date.now();
    }

    return Math.max(...timestamps);
  }

  private buildOldOutput(params: {
    symbol: string;
    metadata: LevelEngineOutput["metadata"];
    rawCandidates: RawLevelCandidate[];
    specialLevels: LevelEngineOutput["specialLevels"];
    referenceTimestamp: number;
  }): LevelEngineOutput {
    const supportTolerance = Math.max(
      this.config.timeframeConfig.daily.clusterTolerancePct,
      this.config.timeframeConfig["4h"].clusterTolerancePct,
    );
    const resistanceTolerance = supportTolerance;

    const supportZones = scoreLevelZones(
      clusterRawLevelCandidates(
        params.symbol,
        "support",
        params.rawCandidates,
        supportTolerance,
        this.config,
        params.referenceTimestamp,
      ),
      this.config,
      params.referenceTimestamp,
    );

    const resistanceZones = scoreLevelZones(
      clusterRawLevelCandidates(
        params.symbol,
        "resistance",
        params.rawCandidates,
        resistanceTolerance,
        this.config,
        params.referenceTimestamp,
      ),
      this.config,
      params.referenceTimestamp,
    );

    return rankLevelZones({
      symbol: params.symbol,
      supportZones,
      resistanceZones,
      specialLevels: params.specialLevels,
      metadata: params.metadata,
      config: this.config,
    });
  }

  private buildOutputFromSeries(
    request: LevelEngineRequest,
    seriesMap: Record<CandleTimeframe, CandleProviderResponse>,
  ): LevelEngineOutput {
    this.assertSeriesUsable(seriesMap);
    const referenceTimestamp = this.deriveReferenceTimestamp(seriesMap);
    const metadata = this.deriveOutputMetadata(
      seriesMap,
      referenceTimestamp,
      request.referencePriceOverride,
    );
    const rawCandidates: RawLevelCandidate[] = [];

    for (const timeframe of ["daily", "4h", "5m"] as const) {
      const series = seriesMap[timeframe];
      if (!this.isSeriesUsable(series)) {
        continue;
      }
      const swings = detectSwingPoints(
        series.candles,
        {
          swingWindow: this.config.timeframeConfig[timeframe].swingWindow,
          minimumDisplacementPct: this.config.timeframeConfig[timeframe].minimumDisplacementPct,
          minimumSeparationBars: this.config.timeframeConfig[timeframe].minimumSwingSeparationBars,
          includeBarrierCandles: timeframe === "daily" || timeframe === "4h",
        },
      );

      rawCandidates.push(
        ...buildRawLevelCandidates({
          symbol: request.symbol.toUpperCase(),
          timeframe,
          candles: series.candles,
          swings,
        }),
      );
    }

    const special = buildSpecialLevelCandidates(
      request.symbol.toUpperCase(),
      this.isSeriesUsable(seriesMap["5m"]) ? seriesMap["5m"].candles : [],
      this.isSeriesUsable(seriesMap.daily) ? seriesMap.daily.candles : [],
    );

    rawCandidates.push(...special.candidates);
    const symbol = request.symbol.toUpperCase();
    const oldOutput = this.buildOldOutput({
      symbol,
      metadata,
      rawCandidates,
      specialLevels: special.summary,
      referenceTimestamp,
    });
    const runtimeMode = this.runtimeOptions.runtimeMode ?? "old";

    if (runtimeMode === "old") {
      return oldOutput;
    }

    const newProjection = buildNewRuntimeCompatibleLevelOutput({
      symbol,
      rawCandidates,
      candlesByTimeframe: {
        daily: seriesMap.daily.candles,
        "4h": seriesMap["4h"].candles,
        "5m": seriesMap["5m"].candles,
      },
      metadata,
      specialLevels: special.summary,
      runtimeBucketOwnership: "surfaced",
      legacyRuntimeBuckets: oldOutput,
      legacyExtensionLevels: oldOutput.extensionLevels,
    });

    if (runtimeMode === "new") {
      return newProjection.output;
    }

    const compareActivePath = this.runtimeOptions.compareActivePath ?? "old";
    this.runtimeOptions.onComparisonLog?.(
      buildLevelRuntimeComparisonLogEntry({
        symbol,
        activePath: compareActivePath,
        oldPath: normalizeOldPathOutput(oldOutput, metadata.referencePrice ?? 0, 12),
        newPath: newProjection.comparableOutput,
      }),
    );

    return compareActivePath === "new" ? newProjection.output : oldOutput;
  }

  async generateLevelsWithCandleSeries(
    request: LevelEngineRequest,
  ): Promise<LevelEngineOutputWithCandleSeries> {
    const seriesMap = await this.loadSeries(request);
    return {
      output: this.buildOutputFromSeries(request, seriesMap),
      seriesMap,
    };
  }

  async generateLevels(request: LevelEngineRequest): Promise<LevelEngineOutput> {
    const { output } = await this.generateLevelsWithCandleSeries(request);
    return output;
  }
}
