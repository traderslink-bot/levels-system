import type { CandleTimeframe } from "../market-data/candle-types.js";

export const DEFAULT_VALIDATION_LOOKBACKS: Record<CandleTimeframe, number> = {
  daily: 120,
  "4h": 120,
  "5m": 160,
};

function resolvePositiveInteger(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function lookbackEnvKey(timeframe: CandleTimeframe): string {
  switch (timeframe) {
    case "daily":
      return "LEVEL_VALIDATION_LOOKBACK_DAILY";
    case "4h":
      return "LEVEL_VALIDATION_LOOKBACK_4H";
    case "5m":
      return "LEVEL_VALIDATION_LOOKBACK_5M";
  }
}

export function resolveValidationLookbacks(
  env: NodeJS.ProcessEnv = process.env,
  defaults: Record<CandleTimeframe, number> = DEFAULT_VALIDATION_LOOKBACKS,
): Record<CandleTimeframe, number> {
  return {
    daily: resolvePositiveInteger(env[lookbackEnvKey("daily")], defaults.daily),
    "4h": resolvePositiveInteger(env[lookbackEnvKey("4h")], defaults["4h"]),
    "5m": resolvePositiveInteger(env[lookbackEnvKey("5m")], defaults["5m"]),
  };
}

export function isStructurallyRequiredValidationTimeframe(
  timeframe: CandleTimeframe,
): boolean {
  return timeframe === "daily" || timeframe === "4h";
}
