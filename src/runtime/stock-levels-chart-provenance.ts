import type { LevelEngineOutputWithCandleSeries } from "../lib/levels/level-engine.js";
import type { LiveWatchlistLevelMap } from "../lib/live-watchlist/live-watchlist-types.js";
import { readAcceptedChartInput, type AcceptedChartInput } from "../lib/market-data/accepted-chart-input.js";
import { readAcceptedInputOrigins } from "../lib/market-data/accepted-input-origins.js";

type Input = Omit<AcceptedChartInput, "instrumentId" | "symbol" | "venue" | "upstreamRevision">;
export type StockLevelsChartEvidenceProvenance = Readonly<{
  version: 1;
  instrument: { id: string; symbol: string; venue: string };
  calculatedAtMs: number;
  inputs: Input[];
  zones: Array<{ side: "support" | "resistance"; index: number; inputIds: string[] }>;
}>;

/** No synthetic identity, inferred bar ends, registry writes or extra data reads. */
export function buildStockLevelsChartProvenance(input: {
  symbol: string;
  seriesMap?: LevelEngineOutputWithCandleSeries["seriesMap"];
  levelMap: LiveWatchlistLevelMap | null;
  calculatedAtMs: number;
}): StockLevelsChartEvidenceProvenance | undefined {
  if (!input.seriesMap || !input.levelMap || !Number.isSafeInteger(input.calculatedAtMs) || input.calculatedAtMs <= 0) return;
  const receipts: AcceptedChartInput[] = [];
  for (const frame of ["daily", "4h"] as const) {
    const series = input.seriesMap[frame];
    if (!series || series.candles.length === 0 || series.completenessStatus === "empty" ||
        series.validationIssues.some((issue) => issue.severity === "error")) continue;
    const accepted = readAcceptedChartInput(series);
    if (!accepted || accepted.frame !== frame || accepted.symbol !== input.symbol ||
        accepted.acceptedAtMs > input.calculatedAtMs) return;
    receipts.push(accepted);
  }
  if (receipts.length === 0 || new Set(receipts.map((item) => item.id)).size !== receipts.length) return;
  const first = receipts[0]!;
  if (receipts.some((item) => item.instrumentId !== first.instrumentId || item.symbol !== first.symbol ||
      item.venue !== first.venue || item.priceBasisId !== first.priceBasisId)) return;
  const known = new Set(receipts.map((item) => item.id));
  const zones: StockLevelsChartEvidenceProvenance["zones"] = [];
  for (const side of ["support", "resistance"] as const) {
    input.levelMap[side === "support" ? "supportLevels" : "resistanceLevels"].forEach((level, index) => {
      const ids = readAcceptedInputOrigins(level);
      if (ids?.length && ids.every((id) => known.has(id))) zones.push({ side, index, inputIds: [...ids] });
    });
  }
  if (zones.length === 0) return;
  return {
    version: 1,
    instrument: { id: first.instrumentId, symbol: first.symbol, venue: first.venue },
    calculatedAtMs: input.calculatedAtMs,
    inputs: receipts.map(({ instrumentId: _instrumentId, symbol: _symbol, venue: _venue,
      upstreamRevision: _upstreamRevision, ...facts }) => facts),
    zones,
  };
}
