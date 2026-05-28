import type { Candle } from "../../market-data/candle-types.js";
import { calculateLatestEma } from "./ema.js";
import { calculateLatestVwap } from "./vwap.js";

export type DynamicLevelDiagnostics = {
  code:
    | "missing_intraday_candles"
    | "insufficient_ema_bars"
    | "missing_volume_for_vwap";
  message: string;
};

export type DynamicLevelsFromCandlesOptions = {
  sessionDate?: string;
  emaPeriods?: number[];
  currentPrice?: number;
};

export type DynamicLevelPriceContext = {
  currentPrice: number;
  priceVsVwapPct: number | null;
  priceVsEma9Pct: number | null;
  priceVsEma20Pct: number | null;
  aboveVwap: boolean | null;
  aboveEma9: boolean | null;
  aboveEma20: boolean | null;
  dynamicSupportCandidate: "vwap" | "ema9" | "ema20" | null;
  dynamicResistanceCandidate: "vwap" | "ema9" | "ema20" | null;
};

export type DynamicLevelsFromCandles = {
  vwap: number | null;
  emaByPeriod: Record<number, number | null>;
  ema9: number | null;
  ema20: number | null;
  priceContext?: DynamicLevelPriceContext | null;
  diagnostics: DynamicLevelDiagnostics[];
};

function pctFromPrice(price: number, level: number | null): number | null {
  return level === null ? null : Number(((price - level) / Math.max(Math.abs(price), 0.0001) * 100).toFixed(4));
}

function nearestDynamicLevel(
  price: number,
  levels: Array<["vwap" | "ema9" | "ema20", number | null]>,
  side: "below" | "above",
): "vwap" | "ema9" | "ema20" | null {
  const candidates = levels
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .filter(([, value]) => side === "below" ? value! <= price : value! >= price)
    .sort((left, right) =>
      side === "below"
        ? right[1]! - left[1]!
        : left[1]! - right[1]!,
    );
  return candidates[0]?.[0] ?? null;
}

export function buildDynamicLevelsFromCandles(
  candles: Candle[] | undefined,
  options: DynamicLevelsFromCandlesOptions = {},
): DynamicLevelsFromCandles {
  const sorted = [...(candles ?? [])].sort((left, right) => left.timestamp - right.timestamp);
  const emaPeriods = options.emaPeriods ?? [9, 20];
  const diagnostics: DynamicLevelDiagnostics[] = [];
  const emaByPeriod: Record<number, number | null> = {};

  if (sorted.length === 0) {
    diagnostics.push({
      code: "missing_intraday_candles",
      message: "5-minute candles are required for shared VWAP/EMA dynamic levels.",
    });
  }

  for (const period of emaPeriods) {
    const latest = calculateLatestEma(sorted, period);
    emaByPeriod[period] = latest;
    if (latest === null) {
      diagnostics.push({
        code: "insufficient_ema_bars",
        message: `At least ${period} candles are required to calculate EMA ${period}.`,
      });
    }
  }

  const vwap = calculateLatestVwap(sorted, { sessionDate: options.sessionDate });
  if (vwap === null && sorted.length > 0) {
    diagnostics.push({
      code: "missing_volume_for_vwap",
      message: "VWAP requires positive per-bar volume on the supplied intraday candles.",
    });
  }
  const currentPrice = options.currentPrice;
  const priceContext =
    typeof currentPrice === "number" && Number.isFinite(currentPrice) && currentPrice > 0
      ? {
          currentPrice,
          priceVsVwapPct: pctFromPrice(currentPrice, vwap),
          priceVsEma9Pct: pctFromPrice(currentPrice, emaByPeriod[9] ?? null),
          priceVsEma20Pct: pctFromPrice(currentPrice, emaByPeriod[20] ?? null),
          aboveVwap: vwap === null ? null : currentPrice >= vwap,
          aboveEma9: emaByPeriod[9] === null || emaByPeriod[9] === undefined ? null : currentPrice >= emaByPeriod[9]!,
          aboveEma20: emaByPeriod[20] === null || emaByPeriod[20] === undefined ? null : currentPrice >= emaByPeriod[20]!,
          dynamicSupportCandidate: nearestDynamicLevel(currentPrice, [
            ["vwap", vwap],
            ["ema9", emaByPeriod[9] ?? null],
            ["ema20", emaByPeriod[20] ?? null],
          ], "below"),
          dynamicResistanceCandidate: nearestDynamicLevel(currentPrice, [
            ["vwap", vwap],
            ["ema9", emaByPeriod[9] ?? null],
            ["ema20", emaByPeriod[20] ?? null],
          ], "above"),
        }
      : null;

  return {
    vwap,
    emaByPeriod,
    ema9: emaByPeriod[9] ?? null,
    ema20: emaByPeriod[20] ?? null,
    priceContext,
    diagnostics,
  };
}
