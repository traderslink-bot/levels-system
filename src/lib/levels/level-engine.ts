// 2026-04-14 08:42 PM America/Toronto
// Main phase 1 support and resistance engine orchestrator with refined clustering and scoring.

import type { CandleProviderResponse, CandleTimeframe } from "../market-data/candle-types.js";
import { CandleFetchService, type HistoricalFetchRequest } from "../market-data/candle-fetch-service.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG, type LevelEngineConfig } from "./level-config.js";
import { clusterRawLevelCandidates } from "./level-clusterer.js";
import { buildRawLevelCandidates } from "./raw-level-candidate-builder.js";
import { rankLevelZones } from "./level-ranker.js";
import { scoreLevelZones } from "./level-scorer.js";
import { buildSpecialLevelCandidates } from "./special-level-builder.js";
import { detectSwingPoints } from "./swing-detector.js";
import type { LevelDataFreshness, LevelEngineOutput, RawLevelCandidate } from "./level-types.js";

export type LevelEngineRequest = {
  symbol: string;
  historicalRequests: Record<CandleTimeframe, HistoricalFetchRequest>;
};

export class LevelEngine {
  constructor(
    private readonly fetchService: CandleFetchService,
    private readonly config: LevelEngineConfig = DEFAULT_LEVEL_ENGINE_CONFIG,
  ) {}

  private async loadSeries(
    request: LevelEngineRequest,
  ): Promise<Record<CandleTimeframe, CandleProviderResponse>> {
    const [daily, fourHour, fiveMinute] = await Promise.all([
      this.fetchService.fetchCandles(request.historicalRequests.daily),
      this.fetchService.fetchCandles(request.historicalRequests["4h"]),
      this.fetchService.fetchCandles(request.historicalRequests["5m"]),
    ]);

    return {
      daily,
      "4h": fourHour,
      "5m": fiveMinute,
    };
  }

  private assertSeriesUsable(seriesMap: Record<CandleTimeframe, CandleProviderResponse>): void {
    for (const timeframe of ["daily", "4h", "5m"] as const) {
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
    const freshestTimestamp = Math.max(...Object.values(seriesMap).map((series) => series.candles.at(-1)?.timestamp ?? 0));
    const ageHours = (Date.now() - freshestTimestamp) / (1000 * 60 * 60);
    const freshness: LevelDataFreshness =
      ageHours <= 24 ? "fresh" : ageHours <= 24 * 7 ? "aging" : "stale";

    return {
      providerByTimeframe: {
        daily: seriesMap.daily.provider,
        "4h": seriesMap["4h"].provider,
        "5m": seriesMap["5m"].provider,
      },
      dataQualityFlags,
      freshness,
    };
  }

  async generateLevels(request: LevelEngineRequest): Promise<LevelEngineOutput> {
    const seriesMap = await this.loadSeries(request);
    this.assertSeriesUsable(seriesMap);
    const metadata = this.deriveOutputMetadata(seriesMap);
    const rawCandidates: RawLevelCandidate[] = [];

    for (const timeframe of ["daily", "4h", "5m"] as const) {
      const series = seriesMap[timeframe];
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

    const supportTolerance = Math.max(
      this.config.timeframeConfig.daily.clusterTolerancePct,
      this.config.timeframeConfig["4h"].clusterTolerancePct,
    );
    const resistanceTolerance = supportTolerance;

    const supportZones = scoreLevelZones(
      clusterRawLevelCandidates(
        request.symbol.toUpperCase(),
        "support",
        rawCandidates,
        supportTolerance,
        this.config,
      ),
      this.config,
    );

    const resistanceZones = scoreLevelZones(
      clusterRawLevelCandidates(
        request.symbol.toUpperCase(),
        "resistance",
        rawCandidates,
        resistanceTolerance,
        this.config,
      ),
      this.config,
    );

    return rankLevelZones({
      symbol: request.symbol.toUpperCase(),
      supportZones,
      resistanceZones,
      specialLevels: special.summary,
      metadata,
      config: this.config,
    });
  }
}
