import type { Candle } from "../market-data/candle-types.js";
import {
  filterCandlesByCloseAsOf,
  type CandleAsOfFilterDiagnostic,
} from "../market-data/candle-as-of-filter.js";

export type VolumeState =
  | "unknown"
  | "low"
  | "normal"
  | "elevated"
  | "high"
  | "extreme";

export type LiquidityQuality =
  | "unknown"
  | "thin"
  | "acceptable"
  | "good"
  | "strong";

export type VolumeAccelerationState =
  | "unknown"
  | "decelerating"
  | "steady"
  | "building"
  | "surging"
  | "exhaustion_risk";

export type PullbackVolumeState =
  | "unknown"
  | "drying_up"
  | "normal"
  | "selling_pressure_increasing";

export type BreakoutVolumeState =
  | "unknown"
  | "not_applicable"
  | "weak"
  | "confirmed"
  | "strong"
  | "exhaustion_risk";

export type VolumeMarketFactDiagnosticCode =
  | "future_candles_filtered"
  | "partial_candles_filtered"
  | "no_closed_candles"
  | "insufficient_rolling_volume_history"
  | "zero_rolling_average_volume"
  | "no_reference_price_for_dollar_volume";

export type VolumeMarketFactDiagnostic = {
  code: VolumeMarketFactDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  excludedCount?: number;
};

export type VolumeMarketFacts = {
  symbol: string;
  asOfTimestamp: number;
  currentVolume?: number;
  rollingAverageVolume?: number;
  relativeVolume?: number;
  dollarVolume?: number;
  volumeState: VolumeState;
  liquidityQuality: LiquidityQuality;
  accelerationState: VolumeAccelerationState;
  pullbackVolumeState: PullbackVolumeState;
  breakoutVolumeState: BreakoutVolumeState;
  diagnostics: VolumeMarketFactDiagnostic[];
};

export type BuildVolumeMarketFactsRequest = {
  symbol: string;
  asOfTimestamp: number;
  candles5m: Candle[];
  referencePrice?: number;
  rollingWindowCandles?: number;
};

const DEFAULT_ROLLING_WINDOW_CANDLES = 5;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function convertFilterDiagnostic(diagnostic: CandleAsOfFilterDiagnostic): VolumeMarketFactDiagnostic {
  return {
    code: diagnostic.code,
    severity: "info",
    message: diagnostic.message,
    excludedCount: diagnostic.excludedCount,
  };
}

function classifyVolumeState(relativeVolume: number | undefined): VolumeState {
  if (relativeVolume === undefined || !Number.isFinite(relativeVolume)) {
    return "unknown";
  }

  if (relativeVolume < 0.6) {
    return "low";
  }
  if (relativeVolume < 1.5) {
    return "normal";
  }
  if (relativeVolume < 2.5) {
    return "elevated";
  }
  if (relativeVolume < 4) {
    return "high";
  }

  return "extreme";
}

function classifyLiquidityQuality(dollarVolume: number | undefined): LiquidityQuality {
  if (dollarVolume === undefined || !Number.isFinite(dollarVolume)) {
    return "unknown";
  }

  if (dollarVolume < 250_000) {
    return "thin";
  }
  if (dollarVolume < 1_000_000) {
    return "acceptable";
  }
  if (dollarVolume < 5_000_000) {
    return "good";
  }

  return "strong";
}

function classifyAcceleration(candles: Candle[]): VolumeAccelerationState {
  if (candles.length < 6) {
    return "unknown";
  }

  const prior = candles.slice(-6, -3);
  const recent = candles.slice(-3);
  const priorAverage = average(prior.map((candle) => candle.volume));
  const recentAverage = average(recent.map((candle) => candle.volume));

  if (priorAverage === undefined || recentAverage === undefined || priorAverage <= 0) {
    return "unknown";
  }

  const latest = recent.at(-1)!;
  const previous = recent.at(-2);
  if (recentAverage >= priorAverage * 2.5 && previous && latest.volume <= previous.volume * 0.6) {
    return "exhaustion_risk";
  }

  const ratio = recentAverage / priorAverage;
  if (ratio >= 2.5) {
    return "surging";
  }
  if (ratio >= 1.25) {
    return "building";
  }
  if (ratio >= 0.75) {
    return "steady";
  }

  return "decelerating";
}

function classifyPullbackVolume(candles: Candle[]): PullbackVolumeState {
  if (candles.length < 6) {
    return "unknown";
  }

  const prior = candles.slice(-6, -3);
  const pullback = candles.slice(-3);
  const priorAverage = average(prior.map((candle) => candle.volume));
  const pullbackAverage = average(pullback.map((candle) => candle.volume));

  if (priorAverage === undefined || pullbackAverage === undefined || priorAverage <= 0) {
    return "unknown";
  }

  const priceIsPullingBack = pullback.at(-1)!.close < pullback[0]!.open;
  if (!priceIsPullingBack) {
    return "unknown";
  }

  const ratio = pullbackAverage / priorAverage;
  if (ratio <= 0.65) {
    return "drying_up";
  }
  if (ratio >= 1.4 && pullback.at(-1)!.close < pullback.at(-1)!.open) {
    return "selling_pressure_increasing";
  }

  return "normal";
}

function classifyBreakoutVolume(
  candles: Candle[],
  relativeVolume: number | undefined,
): BreakoutVolumeState {
  if (candles.length < 2) {
    return "unknown";
  }

  const latest = candles.at(-1)!;
  const priorHigh = Math.max(...candles.slice(0, -1).map((candle) => candle.high));
  const isBreakout = latest.high > priorHigh && latest.close > latest.open;

  if (!isBreakout) {
    return "not_applicable";
  }
  if (relativeVolume === undefined || !Number.isFinite(relativeVolume)) {
    return "unknown";
  }
  if (relativeVolume < 1) {
    return "weak";
  }
  if (relativeVolume < 2) {
    return "confirmed";
  }
  if (relativeVolume < 4) {
    return "strong";
  }

  return "exhaustion_risk";
}

function sumVolume(candles: Candle[]): number {
  return candles.reduce((sum, candle) => sum + candle.volume, 0);
}

function deriveRollingAverage(
  candles: Candle[],
  rollingWindowCandles: number,
): number | undefined {
  if (candles.length < 2) {
    return undefined;
  }

  const priorCandles = candles.slice(0, -1).slice(-rollingWindowCandles);
  return average(priorCandles.map((candle) => candle.volume));
}

export function buildVolumeMarketFacts(request: BuildVolumeMarketFactsRequest): VolumeMarketFacts {
  const filtered = filterCandlesByCloseAsOf({
    candles: request.candles5m,
    timeframe: "5m",
    asOfTimestamp: request.asOfTimestamp,
  });
  const diagnostics = filtered.diagnostics.map(convertFilterDiagnostic);
  const candles = filtered.candles;
  const currentVolume = candles.at(-1)?.volume;
  const rollingWindowCandles = Math.max(1, Math.floor(request.rollingWindowCandles ?? DEFAULT_ROLLING_WINDOW_CANDLES));
  const rollingAverageRaw = deriveRollingAverage(candles, rollingWindowCandles);

  if (candles.length === 0) {
    diagnostics.push({
      code: "no_closed_candles",
      severity: "warning",
      message: "No closed 5m candles were available for volume facts as of the requested timestamp.",
    });
  } else if (rollingAverageRaw === undefined) {
    diagnostics.push({
      code: "insufficient_rolling_volume_history",
      severity: "info",
      message: "At least two closed candles are required to compute rolling average volume.",
    });
  }

  if (request.referencePrice === undefined) {
    diagnostics.push({
      code: "no_reference_price_for_dollar_volume",
      severity: "info",
      message: "Dollar volume was not computed because no current/reference price fact was provided.",
    });
  }

  if (rollingAverageRaw === 0) {
    diagnostics.push({
      code: "zero_rolling_average_volume",
      severity: "warning",
      message: "Relative volume was not computed because the rolling average volume is zero.",
    });
  }

  const rollingAverageVolume = rollingAverageRaw === undefined ? undefined : round(rollingAverageRaw);
  const relativeVolume =
    currentVolume === undefined || rollingAverageRaw === undefined || rollingAverageRaw <= 0
      ? undefined
      : round(currentVolume / rollingAverageRaw);
  const dollarVolume =
    request.referencePrice === undefined ? undefined : round(request.referencePrice * sumVolume(candles), 2);
  const volumeState = classifyVolumeState(relativeVolume);
  const accelerationState = classifyAcceleration(candles);

  return {
    symbol: request.symbol.toUpperCase(),
    asOfTimestamp: request.asOfTimestamp,
    currentVolume,
    rollingAverageVolume,
    relativeVolume,
    dollarVolume,
    volumeState,
    liquidityQuality: classifyLiquidityQuality(dollarVolume),
    accelerationState,
    pullbackVolumeState: classifyPullbackVolume(candles),
    breakoutVolumeState: classifyBreakoutVolume(candles, relativeVolume),
    diagnostics,
  };
}
