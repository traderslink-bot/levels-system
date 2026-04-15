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
import type { LevelEngineOutput, RawLevelCandidate } from "./level-types.js";

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

  async generateLevels(request: LevelEngineRequest): Promise<LevelEngineOutput> {
    const seriesMap = await this.loadSeries(request);
    const rawCandidates: RawLevelCandidate[] = [];

    for (const timeframe of ["daily", "4h", "5m"] as const) {
      const series = seriesMap[timeframe];
      const swings = detectSwingPoints(
        series.candles,
        this.config.timeframeConfig[timeframe].swingWindow,
      );

      rawCandidates.push(
        ...buildRawLevelCandidates({
          symbol: request.symbol.toUpperCase(),
          timeframe,
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
      config: this.config,
    });
  }
}
