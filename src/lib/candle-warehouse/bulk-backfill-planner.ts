import type { CandleFetchTimeframe, CandleProviderName } from "../market-data/candle-types.js";
import type { CandleWarehouseCoverage, CandleWarehouseMissingRange } from "./durable-candle-warehouse.js";

export type BulkCandleBackfillTradeInput = {
  symbol: string;
  sessionDate: string;
  asOfTimestamp?: number | string | Date;
};

export type BulkCandleBackfillTask = {
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  sessionDate: string;
  startTimestamp: number;
  endTimestamp: number;
  lookbackBars: number;
};

export type BulkCandleBackfillPlan = {
  provider: CandleProviderName;
  tasks: BulkCandleBackfillTask[];
  symbolCount: number;
  sessionCount: number;
  dedupedTaskCount: number;
};

export type WarehouseMissingCandleBackfillTask = BulkCandleBackfillTask & {
  coverage: CandleWarehouseCoverage;
  missingRanges: CandleWarehouseMissingRange[];
  missingCandleCountEstimate: number;
};

export type WarehouseMissingCandleBackfillPlan = Omit<BulkCandleBackfillPlan, "tasks" | "dedupedTaskCount"> & {
  tasks: WarehouseMissingCandleBackfillTask[];
  plannedTaskCount: number;
  missingTaskCount: number;
  fullyCoveredTaskCount: number;
  missingCandleCountEstimate: number;
};

export type PlanBulkCandleBackfillRequest = {
  trades: BulkCandleBackfillTradeInput[];
  provider?: CandleProviderName;
  timeframes?: CandleFetchTimeframe[];
  lookbackBars?: Partial<Record<CandleFetchTimeframe, number>>;
};

export type PlanWarehouseMissingCandleBackfillRequest = PlanBulkCandleBackfillRequest & {
  warehouse: {
    getCoverage(request: {
      provider: CandleProviderName;
      symbol: string;
      timeframe: CandleFetchTimeframe;
      startTimestamp: number;
      endTimestamp: number;
    }): Promise<CandleWarehouseCoverage>;
    findMissingRanges(request: {
      provider: CandleProviderName;
      symbol: string;
      timeframe: CandleFetchTimeframe;
      startTimestamp: number;
      endTimestamp: number;
    }): Promise<CandleWarehouseMissingRange[]>;
  };
};

const DEFAULT_LOOKBACK_BARS: Record<CandleFetchTimeframe, number> = {
  "1m": 480,
  "5m": 180,
  "4h": 180,
  daily: 520,
};

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("symbol is required for bulk candle backfill planning.");
  }
  return normalized;
}

function parseTimestamp(value: number | string | Date | undefined, fallbackSessionDate: string): number {
  if (value === undefined) {
    return Date.parse(`${fallbackSessionDate}T23:59:59.999Z`);
  }
  const parsed = typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid asOfTimestamp for bulk candle backfill: ${String(value)}`);
  }
  return parsed;
}

function intervalMs(timeframe: CandleFetchTimeframe): number {
  if (timeframe === "1m") {
    return 60_000;
  }
  if (timeframe === "5m") {
    return 5 * 60_000;
  }
  if (timeframe === "4h") {
    return 4 * 60 * 60_000;
  }
  return 24 * 60 * 60_000;
}

function lookbackBarsForRange(startTimestamp: number, endTimestamp: number, timeframe: CandleFetchTimeframe): number {
  return Math.max(1, Math.floor((endTimestamp - startTimestamp) / intervalMs(timeframe)) + 1);
}

export function planBulkCandleBackfill(request: PlanBulkCandleBackfillRequest): BulkCandleBackfillPlan {
  const provider = request.provider ?? "ibkr";
  const timeframes = request.timeframes ?? ["daily", "4h", "5m", "1m"];
  const tasksByKey = new Map<string, BulkCandleBackfillTask>();
  const symbols = new Set<string>();
  const sessions = new Set<string>();

  for (const trade of request.trades) {
    const symbol = normalizeSymbol(trade.symbol);
    symbols.add(symbol);
    sessions.add(trade.sessionDate);
    for (const timeframe of timeframes) {
      const lookbackBars = request.lookbackBars?.[timeframe] ?? DEFAULT_LOOKBACK_BARS[timeframe];
      const endTimestamp = parseTimestamp(trade.asOfTimestamp, trade.sessionDate);
      const startTimestamp = endTimestamp - lookbackBars * intervalMs(timeframe);
      const key = `${provider}:${symbol}:${trade.sessionDate}:${timeframe}`;
      const existing = tasksByKey.get(key);
      if (existing) {
        const mergedStartTimestamp = Math.min(existing.startTimestamp, startTimestamp);
        const mergedEndTimestamp = Math.max(existing.endTimestamp, endTimestamp);
        tasksByKey.set(key, {
          ...existing,
          startTimestamp: mergedStartTimestamp,
          endTimestamp: mergedEndTimestamp,
          lookbackBars: Math.max(
            existing.lookbackBars,
            lookbackBars,
            lookbackBarsForRange(mergedStartTimestamp, mergedEndTimestamp, timeframe),
          ),
        });
        continue;
      }
      tasksByKey.set(key, {
        provider,
        symbol,
        timeframe,
        sessionDate: trade.sessionDate,
        startTimestamp,
        endTimestamp,
        lookbackBars,
      });
    }
  }

  return {
    provider,
    tasks: [...tasksByKey.values()].sort((left, right) =>
      left.symbol.localeCompare(right.symbol) ||
      left.sessionDate.localeCompare(right.sessionDate) ||
      left.timeframe.localeCompare(right.timeframe),
    ),
    symbolCount: symbols.size,
    sessionCount: sessions.size,
    dedupedTaskCount: tasksByKey.size,
  };
}

export async function planWarehouseMissingCandleBackfill(
  request: PlanWarehouseMissingCandleBackfillRequest,
): Promise<WarehouseMissingCandleBackfillPlan> {
  const baseline = planBulkCandleBackfill(request);
  const tasks: WarehouseMissingCandleBackfillTask[] = [];
  let fullyCoveredTaskCount = 0;
  let missingCandleCountEstimate = 0;

  for (const task of baseline.tasks) {
    const rangeRequest = {
      provider: task.provider,
      symbol: task.symbol,
      timeframe: task.timeframe,
      startTimestamp: task.startTimestamp,
      endTimestamp: task.endTimestamp,
    };
    const [coverage, missingRanges] = await Promise.all([
      request.warehouse.getCoverage(rangeRequest),
      request.warehouse.findMissingRanges(rangeRequest),
    ]);
    if (missingRanges.length === 0) {
      fullyCoveredTaskCount += 1;
      continue;
    }
    const interval = intervalMs(task.timeframe);
    const taskMissingEstimate = missingRanges.reduce((sum, range) =>
      sum + Math.floor((range.endTimestamp - range.startTimestamp) / interval) + 1, 0);
    missingCandleCountEstimate += taskMissingEstimate;
    tasks.push({
      ...task,
      coverage,
      missingRanges,
      missingCandleCountEstimate: taskMissingEstimate,
    });
  }

  return {
    provider: baseline.provider,
    tasks,
    symbolCount: baseline.symbolCount,
    sessionCount: baseline.sessionCount,
    plannedTaskCount: baseline.dedupedTaskCount,
    missingTaskCount: tasks.length,
    fullyCoveredTaskCount,
    missingCandleCountEstimate,
  };
}
