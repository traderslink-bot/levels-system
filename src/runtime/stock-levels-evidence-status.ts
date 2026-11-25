import type { LiveWatchlistLevelMap, LiveWatchlistLevelMapLevel } from "../lib/live-watchlist/live-watchlist-types.js";
import { readAcceptedInputOrigins } from "../lib/market-data/accepted-input-origins.js";
import type { StockLevelsChartEvidenceProvenance } from "./stock-levels-chart-provenance.js";

const clock = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const positive = (value: number) => Number.isFinite(value) && value > 0;

function evidenceStatus(
  level: LiveWatchlistLevelMapLevel,
  throughMs: number,
): LiveWatchlistLevelMapLevel["evidenceStatus"] {
  const source = level.marketDataProvenance;
  const lower = level.lowPrice ?? level.price;
  const upper = level.highPrice ?? level.price;
  if (!source || !clock(throughMs) || !clock(source.formedAt) || !clock(source.sourceLastSeenAt) ||
      source.formedAt > source.sourceLastSeenAt || source.sourceLastSeenAt > throughMs ||
      !Number.isSafeInteger(level.sourceEvidenceCount) || Number(level.sourceEvidenceCount) <= 0 ||
      ![level.price, lower, upper].every(positive) || lower > upper ||
      (level.lowPrice === undefined) !== (level.highPrice === undefined)) return;
  for (const time of [source.lastTestedAt, source.lastConfirmedAt]) {
    if (time !== undefined && (!clock(time) || time < source.formedAt || time > throughMs)) return;
  }
  return [source.lastTestedAt, source.lastConfirmedAt].some(time => time !== undefined && time > source.formedAt)
    ? "historically_tested"
    : "detected_structure";
}

/** Annotate this request's presentation only; classification never changes freshness or role state. */
export function annotateStockLevelsEvidence(
  map: LiveWatchlistLevelMap | null,
  provenance: StockLevelsChartEvidenceProvenance,
): void {
  if (!map) return;
  const inputs = new Map(provenance.inputs.map(input => [input.id, input]));
  const zones = new Map(provenance.zones.map(zone => [`${zone.side}:${zone.index}`, zone.inputIds]));
  for (const side of ["support", "resistance"] as const) {
    map[side === "support" ? "supportLevels" : "resistanceLevels"].forEach((level, index) => {
      if (level.evidenceStatus === "synthetic_planning") return;
      delete level.evidenceStatus;
      const ids = zones.get(`${side}:${index}`);
      const origins = readAcceptedInputOrigins(level);
      if (level.side !== side || !ids?.length || origins?.length !== ids.length ||
          !ids.every(id => origins.includes(id) && inputs.has(id))) return;
      const throughMs = Math.min(provenance.calculatedAtMs,
        Math.max(...ids.map(id => inputs.get(id)!.completedThroughMs)));
      const status = evidenceStatus(level, throughMs);
      if (status) level.evidenceStatus = status;
    });
  }
}
