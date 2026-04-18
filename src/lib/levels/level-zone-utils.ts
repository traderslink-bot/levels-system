// 2026-04-17 09:31 PM America/Toronto
// Pure utility helpers for level zones, distances, and normalization.

import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import type { SourceTimeframe } from "./level-types.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fallback;
  }

  return numerator / denominator;
}

export function getZoneWidthPct(price: number): number {
  if (price < 2) {
    return LEVEL_SCORE_CONFIG.zoneRules.sub2DollarZoneWidthPct;
  }

  if (price < 10) {
    return LEVEL_SCORE_CONFIG.zoneRules.sub10DollarZoneWidthPct;
  }

  return LEVEL_SCORE_CONFIG.zoneRules.defaultZoneWidthPct;
}

export function buildZoneBounds(price: number): { zoneLow: number; zoneHigh: number } {
  const widthPct = getZoneWidthPct(price);
  const halfWidth = price * widthPct;

  return {
    zoneLow: Number((price - halfWidth).toFixed(6)),
    zoneHigh: Number((price + halfWidth).toFixed(6)),
  };
}

export function priceDistancePct(a: number, b: number): number {
  return Math.abs(safeDivide(a - b, Math.max(Math.abs(a), Math.abs(b), 0.000001), 0));
}

export function isPriceInsideZone(price: number, zoneLow: number, zoneHigh: number): boolean {
  return price >= Math.min(zoneLow, zoneHigh) && price <= Math.max(zoneLow, zoneHigh);
}

export function zoneMid(zoneLow: number, zoneHigh: number): number {
  return (zoneLow + zoneHigh) / 2;
}

export function zoneWidthPct(zoneLow: number, zoneHigh: number): number {
  return safeDivide(Math.abs(zoneHigh - zoneLow), Math.max(zoneMid(zoneLow, zoneHigh), 0.000001), 0);
}

export function zonesOverlap(
  zoneA: { zoneLow: number; zoneHigh: number },
  zoneB: { zoneLow: number; zoneHigh: number },
): boolean {
  return Math.max(zoneA.zoneLow, zoneB.zoneLow) <= Math.min(zoneA.zoneHigh, zoneB.zoneHigh);
}

export function overlapRatio(
  zoneA: { zoneLow: number; zoneHigh: number },
  zoneB: { zoneLow: number; zoneHigh: number },
): number {
  if (!zonesOverlap(zoneA, zoneB)) {
    return 0;
  }

  const intersection = Math.max(0, Math.min(zoneA.zoneHigh, zoneB.zoneHigh) - Math.max(zoneA.zoneLow, zoneB.zoneLow));
  const union = Math.max(zoneA.zoneHigh, zoneB.zoneHigh) - Math.min(zoneA.zoneLow, zoneB.zoneLow);

  return clamp(safeDivide(intersection, union, 0), 0, 1);
}

export function standardDeviation(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function normalizeTimeframeRank(timeframes: SourceTimeframe | SourceTimeframe[]): number {
  const ordered: SourceTimeframe[] = Array.isArray(timeframes) ? timeframes : [timeframes];
  const rankMap: Record<SourceTimeframe, number> = {
    daily: 1,
    "4h": 0.8,
    "1h": 0.6,
    "15m": 0.4,
    "5m": 0.25,
  };

  const strongest = ordered.reduce((best, timeframe) => Math.max(best, rankMap[timeframe]), 0);
  const confluenceBonus = ordered.length > 1 ? clamp((ordered.length - 1) * 0.05, 0, 0.15) : 0;

  return clamp(strongest + confluenceBonus, 0, 1);
}
