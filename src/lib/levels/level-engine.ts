// 2026-04-14 08:42 PM America/Toronto
// Main phase 1 support and resistance engine orchestrator with refined clustering and scoring.

import type { CandleProviderResponse, CandleTimeframe } from "../market-data/candle-types.js";
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
};

export type LevelEngineRuntimeOptions = {
  runtimeMode?: LevelRuntimeMode;
  compareActivePath?: LevelRuntimeCompareActivePath;
  onComparisonLog?: (entry: LevelRuntimeComparisonLogEntry) => void;
};

export class LevelEngine {
  constructor(
    private readonly fetchService: CandleFetchService,
    private readonly config: LevelEngineConfig = DEFAULT_LEVEL_ENGINE_CONFIG,
    private readonly runtimeOptions: LevelEngineRuntimeOptions = {},
  ) {}

  private buildOptionalIntradayFallback(params: {
    symbol: string;
    request: HistoricalFetchRequest;
    fallbackProvider: CandleProviderResponse["provider"];
  }): CandleProviderResponse {
    const requestEndTimestamp = params.request.endTimeMs ?? Date.now();
    const intervalMs = 5 * 60 * 1000;
    const requestedStartTimestamp = requestEndTimestamp - params.request.lookbackBars * intervalMs;

    return {
      provider: params.fallbackProvider,
      symbol: params.symbol.toUpperCase(),
      timeframe: "5m",
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
      validationIssues: [],
      sessionSummary: null,
      providerMetadata: {
        degraded_reason: "optional_intraday_unavailable",
      },
    };
  }

  private async loadSeries(
    request: LevelEngineRequest,
  ): Promise<Record<CandleTimeframe, CandleProviderResponse>> {
    const dailyPromise = this.fetchService.fetchCandles(request.historicalRequests.daily);
    const fourHourPromise = this.fetchService.fetchCandles(request.historicalRequests["4h"]);
    const fiveMinutePromise = this.fetchService.fetchCandles(request.historicalRequests["5m"]);

    const [daily, fourHour, fiveMinuteResult] = await Promise.allSettled([
      dailyPromise,
      fourHourPromise,
      fiveMinutePromise,
    ]);

    if (daily.status !== "fulfilled") {
      throw daily.reason;
    }

    if (fourHour.status !== "fulfilled") {
      throw fourHour.reason;
    }

    const fiveMinute =
      fiveMinuteResult.status === "fulfilled" &&
      fiveMinuteResult.value.completenessStatus !== "empty" &&
      !fiveMinuteResult.value.validationIssues.some((issue) => issue.severity === "error")
        ? fiveMinuteResult.value
        : this.buildOptionalIntradayFallback({
            symbol: request.symbol,
            request: request.historicalRequests["5m"],
            fallbackProvider: daily.value.provider,
          });

    return {
      daily: daily.value,
      "4h": fourHour.value,
      "5m": fiveMinute,
    };
  }

  private assertSeriesUsable(seriesMap: Record<CandleTimeframe, CandleProviderResponse>): void {
    for (const timeframe of ["daily", "4h"] as const) {
      const series = seriesMap[timeframe];
      const errors = series.validationIssues.filter((issue) => issue.severity === "error");

      if (errors.length > 0) {
        throw new Error(
          `Cannot generate levels for ${series.symbol} ${timeframe} because candle validation failed: ${errors
            .map((issue) => issue.code)
            .join(", ")}`,
        );
      }

      if (series.completenessStatus === "empty") {
        throw new Error(`Cannot generate levels for ${series.symbol} ${timeframe} because no candles were returned.`);
      }
    }
  }

  private deriveOutputMetadata(
    seriesMap: Record<CandleTimeframe, CandleProviderResponse>,
  ): LevelEngineOutput["metadata"] {
    const dataQualityFlags = [
      ...new Set(
        Object.values(seriesMap).flatMap((series) =>
          series.validationIssues.map((issue) => `${series.timeframe}:${issue.code}`),
        ),
      ),
    ];
    if (seriesMap["5m"].candles.length === 0) {
      dataQualityFlags.push("5m:unavailable");
    }
    const freshestTimestamp = Math.max(...Object.values(seriesMap).map((series) => series.candles.at(-1)?.timestamp ?? 0));
    const ageHours = (Date.now() - freshestTimestamp) / (1000 * 60 * 60);
    const freshness: LevelDataFreshness =
      ageHours <= 24 ? "fresh" : ageHours <= 24 * 7 ? "aging" : "stale";
    const referencePrice =
      seriesMap["5m"].candles.at(-1)?.close ??
      seriesMap["4h"].candles.at(-1)?.close ??
      seriesMap.daily.candles.at(-1)?.close;

    return {
      providerByTimeframe: {
        daily: seriesMap.daily.provider,
        "4h": seriesMap["4h"].provider,
        "5m": seriesMap["5m"].provider,
      },
      dataQualityFlags,
      freshness,
      referencePrice,
    };
  }

  private buildOldOutput(params: {
    symbol: string;
    metadata: LevelEngineOutput["metadata"];
    rawCandidates: RawLevelCandidate[];
    specialLevels: LevelEngineOutput["specialLevels"];
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
      ),
      this.config,
    );

    const resistanceZones = scoreLevelZones(
      clusterRawLevelCandidates(
        params.symbol,
        "resistance",
        params.rawCandidates,
        resistanceTolerance,
        this.config,
      ),
      this.config,
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

  async generateLevels(request: LevelEngineRequest): Promise<LevelEngineOutput> {
    const seriesMap = await this.loadSeries(request);
    this.assertSeriesUsable(seriesMap);
    const metadata = this.deriveOutputMetadata(seriesMap);
    const rawCandidates: RawLevelCandidate[] = [];

    for (const timeframe of ["daily", "4h", "5m"] as const) {
      const series = seriesMap[timeframe];
      if (series.candles.length === 0) {
        continue;
      }
      const swings = detectSwingPoints(
        series.candles,
        {
          swingWindow: this.config.timeframeConfig[timeframe].swingWindow,
          minimumDisplacementPct: this.config.timeframeConfig[timeframe].minimumDisplacementPct,
          minimumSeparationBars: this.config.timeframeConfig[timeframe].minimumSwingSeparationBars,
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
      seriesMap["5m"].candles,
    );

    rawCandidates.push(...special.candidates);
    const symbol = request.symbol.toUpperCase();
    const oldOutput = this.buildOldOutput({
      symbol,
      metadata,
      rawCandidates,
      specialLevels: special.summary,
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
}
