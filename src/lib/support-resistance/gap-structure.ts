import type { Candle } from "../market-data/candle-types.js";

export type SharedGapDirection = "up" | "down";

export type SharedGapZone = {
  direction: SharedGapDirection;
  start: number;
  end: number;
  fromClose: number;
  toOpen: number;
  timestamp: number;
  sizePct: number;
  filled: boolean;
  fillTimestamp: number | null;
  distancePctFromPrice: number | null;
};

export type SharedGapStructureDiagnostic = {
  code: "missing_candles" | "no_meaningful_gaps";
  message: string;
};

export type SharedGapStructure = {
  nearestGapAbove: SharedGapZone | null;
  nearestGapBelow: SharedGapZone | null;
  recentGaps: SharedGapZone[];
  diagnostics: SharedGapStructureDiagnostic[];
};

export type BuildGapStructureRequest = {
  candles: Candle[];
  currentPrice?: number;
  minimumGapPct?: number;
  maxRecentGaps?: number;
};

function pctDistance(left: number, right: number): number {
  return Number(((right - left) / Math.max(Math.abs(left), 0.0001) * 100).toFixed(4));
}

function round(value: number): number {
  return Number(value.toFixed(value >= 1 ? 4 : 6));
}

function annotateDistance(zone: Omit<SharedGapZone, "distancePctFromPrice">, currentPrice?: number): SharedGapZone {
  if (!Number.isFinite(currentPrice)) {
    return { ...zone, distancePctFromPrice: null };
  }
  const price = currentPrice!;
  const edge = price < zone.start ? zone.start : price > zone.end ? zone.end : price;
  return {
    ...zone,
    distancePctFromPrice: Number((Math.abs(edge - price) / Math.max(Math.abs(price), 0.0001) * 100).toFixed(4)),
  };
}

export function buildGapStructure(request: BuildGapStructureRequest): SharedGapStructure {
  const sorted = [...request.candles].sort((left, right) => left.timestamp - right.timestamp);
  const minimumGapPct = request.minimumGapPct ?? 2;
  const diagnostics: SharedGapStructureDiagnostic[] = [];
  if (sorted.length < 2) {
    return {
      nearestGapAbove: null,
      nearestGapBelow: null,
      recentGaps: [],
      diagnostics: [{
        code: "missing_candles",
        message: "At least two candles are required to derive gap structure.",
      }],
    };
  }

  const gaps: SharedGapZone[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const gapPct = Math.abs(pctDistance(previous.close, current.open));
    if (gapPct < minimumGapPct) {
      continue;
    }
    if (current.open > previous.close) {
      const start = previous.close;
      const end = current.open;
      const fill = sorted.slice(index + 1).find((candle) => candle.low <= start);
      gaps.push(annotateDistance({
        direction: "up",
        start: round(start),
        end: round(end),
        fromClose: previous.close,
        toOpen: current.open,
        timestamp: current.timestamp,
        sizePct: Number(gapPct.toFixed(4)),
        filled: Boolean(fill),
        fillTimestamp: fill?.timestamp ?? null,
      }, request.currentPrice));
    } else if (current.open < previous.close) {
      const start = current.open;
      const end = previous.close;
      const fill = sorted.slice(index + 1).find((candle) => candle.high >= end);
      gaps.push(annotateDistance({
        direction: "down",
        start: round(start),
        end: round(end),
        fromClose: previous.close,
        toOpen: current.open,
        timestamp: current.timestamp,
        sizePct: Number(gapPct.toFixed(4)),
        filled: Boolean(fill),
        fillTimestamp: fill?.timestamp ?? null,
      }, request.currentPrice));
    }
  }

  if (gaps.length === 0) {
    diagnostics.push({
      code: "no_meaningful_gaps",
      message: `No candle gaps met the ${minimumGapPct}% minimum threshold.`,
    });
  }

  const currentPrice = request.currentPrice;
  const openGaps = gaps.filter((gap) => !gap.filled);
  const nearestGapAbove = Number.isFinite(currentPrice)
    ? openGaps
        .filter((gap) => gap.end >= currentPrice!)
        .sort((left, right) => Math.max(0, left.start - currentPrice!) - Math.max(0, right.start - currentPrice!))[0] ?? null
    : null;
  const nearestGapBelow = Number.isFinite(currentPrice)
    ? openGaps
        .filter((gap) => gap.start <= currentPrice!)
        .sort((left, right) => Math.max(0, currentPrice! - left.end) - Math.max(0, currentPrice! - right.end))[0] ?? null
    : null;

  return {
    nearestGapAbove,
    nearestGapBelow,
    recentGaps: gaps.slice(-(request.maxRecentGaps ?? 8)),
    diagnostics,
  };
}
