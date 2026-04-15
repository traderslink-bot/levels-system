// 2026-04-14 09:28 PM America/Toronto
// Simple in-memory level store used by the watchlist monitor.

import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";

export class LevelStore {
  private readonly levels = new Map<string, LevelEngineOutput>();

  setLevels(output: LevelEngineOutput): void {
    this.levels.set(output.symbol.toUpperCase(), output);
  }

  getLevels(symbol: string): LevelEngineOutput | undefined {
    return this.levels.get(symbol.toUpperCase());
  }

  getSupportZones(symbol: string): FinalLevelZone[] {
    const output = this.getLevels(symbol);
    if (!output) {
      return [];
    }

    return [
      ...output.majorSupport,
      ...output.intermediateSupport,
      ...output.intradaySupport,
    ];
  }

  getResistanceZones(symbol: string): FinalLevelZone[] {
    const output = this.getLevels(symbol);
    if (!output) {
      return [];
    }

    return [
      ...output.majorResistance,
      ...output.intermediateResistance,
      ...output.intradayResistance,
    ];
  }
}
