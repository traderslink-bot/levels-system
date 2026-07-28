import type { CandleFetchTimeframe, CandleProviderName } from "../market-data/candle-types.js";
import { isLikelyTradableIntradayTimestamp } from "../market-data/candle-session-classifier.js";
import type { CandleWarehouseCoverage, CandleWarehouseMissingRange } from "./durable-candle-warehouse.js";

export type BulkCandleBackfillTradeInput = {
  symbol: string;
  sessionDate: string;
  asOfTimestamp?: number | string | Date;
  startTimestamp?: number | string | Date;
};

export type BulkCandleBackfillTask = {
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  sessionDate: string;
  startTimestamp: number;
  endTimestamp: number;
  lookbackBars: number;
  tradeRequestCount?: number;
  estimatedCandleCount?: number;
};

export type BulkCandleBackfillProviderBatch = {
  provider: CandleProviderName;
  batchIndex: number;
  taskCount: number;
  estimatedCandleCount: number;
  symbols: string[];
  timeframes: CandleFetchTimeframe[];
  startTimestamp: number;
  endTimestamp: number;
  tasks: BulkCandleBackfillTask[];
};

export type BulkCandleBackfillBatchingOptions = {
  maxTasksPerBatch?: number;
  maxEstimatedCandlesPerBatch?: number;
};

export type BulkCandleBackfillPlan = {
  provider: CandleProviderName;
  tasks: BulkCandleBackfillTask[];
  providerBatches?: BulkCandleBackfillProviderBatch[];
  symbolCount: number;
  sessionCount: number;
  naiveTaskCount?: number;
  dedupedTaskCount: number;
  avoidedTaskCount?: number;
  avoidedTaskPct?: number;
  estimatedCandleCount?: number;
  maxTaskEstimatedCandles?: number;
};

export type WarehouseMissingCandleBackfillTask = BulkCandleBackfillTask & {
  coverage: CandleWarehouseCoverage;
  missingRanges: CandleWarehouseMissingRange[];
  likelyNoBarMissingRanges?: CandleWarehouseMissingRange[];
  missingCandleCountEstimate: number;
  likelyNoBarMissingCandleCountEstimate?: number;
};

export type WarehouseMissingCandleBackfillPlan = Omit<BulkCandleBackfillPlan, "tasks" | "dedupedTaskCount"> & {
  tasks: WarehouseMissingCandleBackfillTask[];
  plannedTaskCount: number;
  missingTaskCount: number;
  fullyCoveredTaskCount: number;
  missingCandleCountEstimate: number;
  likelyNoBarMissingTaskCount: number;
  likelyNoBarMissingCandleCountEstimate: number;
};

export type PlanBulkCandleBackfillRequest = {
  trades: BulkCandleBackfillTradeInput[];
  provider?: CandleProviderName;
  timeframes?: CandleFetchTimeframe[];
  lookbackBars?: Partial<Record<CandleFetchTimeframe, number>>;
  batching?: BulkCandleBackfillBatchingOptions;
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

const newYorkWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
});

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

function parseOptionalTimestamp(value: number | string | Date | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${fieldName} for bulk candle backfill: ${String(value)}`);
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

function pct(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2));
}

function estimateCandleCount(startTimestamp: number, endTimestamp: number, timeframe: CandleFetchTimeframe): number {
  return Math.max(1, Math.floor((endTimestamp - startTimestamp) / intervalMs(timeframe)) + 1);
}

function isNewYorkWeekday(timestamp: number): boolean {
  const weekday = newYorkWeekdayFormatter.format(new Date(timestamp));
  return weekday !== "Sat" && weekday !== "Sun";
}

function isLikelyTradableTimestampForTimeframe(timestamp: number, timeframe: CandleFetchTimeframe): boolean {
  if (timeframe === "daily") {
    return isNewYorkWeekday(timestamp);
  }
  if (timeframe === "4h") {
    return isNewYorkWeekday(timestamp) && isLikelyTradableIntradayTimestamp(timestamp);
  }
  return isLikelyTradableIntradayTimestamp(timestamp);
}

function compactTimestampsIntoRanges(timestamps: number[], interval: number): CandleWarehouseMissingRange[] {
  if (timestamps.length === 0) {
    return [];
  }
  const sorted = [...timestamps].sort((left, right) => left - right);
  const ranges: CandleWarehouseMissingRange[] = [];
  let startTimestamp = sorted[0]!;
  let endTimestamp = sorted[0]!;

  for (const timestamp of sorted.slice(1)) {
    if (timestamp === endTimestamp + interval) {
      endTimestamp = timestamp;
      continue;
    }
    ranges.push({ startTimestamp, endTimestamp });
    startTimestamp = timestamp;
    endTimestamp = timestamp;
  }

  ranges.push({ startTimestamp, endTimestamp });
  return ranges;
}

function classifyMissingRangesBySession(params: {
  timeframe: CandleFetchTimeframe;
  missingRanges: CandleWarehouseMissingRange[];
  coverage?: CandleWarehouseCoverage;
}): {
  actionableRanges: CandleWarehouseMissingRange[];
  likelyNoBarRanges: CandleWarehouseMissingRange[];
  actionableEstimate: number;
  likelyNoBarEstimate: number;
} {
  const interval = intervalMs(params.timeframe);
  const coverageEndTimestamp = params.coverage?.endTimestamp;
  const hasCoverage = (params.coverage?.candleCount ?? 0) > 0 && typeof coverageEndTimestamp === "number";
  const actionableTimestamps: number[] = [];
  const likelyNoBarTimestamps: number[] = [];
  for (const range of params.missingRanges) {
    for (let timestamp = range.startTimestamp; timestamp <= range.endTimestamp; timestamp += interval) {
      if (!isLikelyTradableTimestampForTimeframe(timestamp, params.timeframe)) {
        likelyNoBarTimestamps.push(timestamp);
      } else if (hasCoverage && timestamp <= coverageEndTimestamp) {
        likelyNoBarTimestamps.push(timestamp);
      } else {
        actionableTimestamps.push(timestamp);
      }
    }
  }

  return {
    actionableRanges: compactTimestampsIntoRanges(actionableTimestamps, interval),
    likelyNoBarRanges: compactTimestampsIntoRanges(likelyNoBarTimestamps, interval),
    actionableEstimate: actionableTimestamps.length,
    likelyNoBarEstimate: likelyNoBarTimestamps.length,
  };
}

function finalizeTask(task: BulkCandleBackfillTask): BulkCandleBackfillTask {
  const estimatedCandleCount = estimateCandleCount(task.startTimestamp, task.endTimestamp, task.timeframe);
  return {
    ...task,
    lookbackBars: Math.max(task.lookbackBars, estimatedCandleCount),
    estimatedCandleCount,
  };
}

export function groupBackfillTasksIntoProviderBatches(
  tasks: BulkCandleBackfillTask[],
  options: BulkCandleBackfillBatchingOptions = {},
): BulkCandleBackfillProviderBatch[] {
  const maxTasksPerBatch = Math.max(1, options.maxTasksPerBatch ?? 50);
  const maxEstimatedCandlesPerBatch = Math.max(1, options.maxEstimatedCandlesPerBatch ?? 50_000);
  const sorted = [...tasks].sort((left, right) =>
    left.provider.localeCompare(right.provider) ||
    left.symbol.localeCompare(right.symbol) ||
    left.sessionDate.localeCompare(right.sessionDate) ||
    left.timeframe.localeCompare(right.timeframe),
  );
  const batches: BulkCandleBackfillProviderBatch[] = [];
  let current: BulkCandleBackfillTask[] = [];
  let currentEstimatedCandles = 0;

  function flush(): void {
    if (current.length === 0) {
      return;
    }
    batches.push({
      provider: current[0]!.provider,
      batchIndex: batches.length + 1,
      taskCount: current.length,
      estimatedCandleCount: currentEstimatedCandles,
      symbols: [...new Set(current.map((task) => task.symbol))].sort(),
      timeframes: [...new Set(current.map((task) => task.timeframe))].sort(),
      startTimestamp: Math.min(...current.map((task) => task.startTimestamp)),
      endTimestamp: Math.max(...current.map((task) => task.endTimestamp)),
      tasks: current,
    });
    current = [];
    currentEstimatedCandles = 0;
  }

  for (const task of sorted) {
    const wouldOverflowTasks = current.length >= maxTasksPerBatch;
    const taskEstimatedCandles = task.estimatedCandleCount ?? estimateCandleCount(task.startTimestamp, task.endTimestamp, task.timeframe);
    const wouldOverflowCandles =
      current.length > 0 && currentEstimatedCandles + taskEstimatedCandles > maxEstimatedCandlesPerBatch;
    const wouldMixProviders = current.length > 0 && current[0]!.provider !== task.provider;
    if (wouldOverflowTasks || wouldOverflowCandles || wouldMixProviders) {
      flush();
    }
    current.push(task);
    currentEstimatedCandles += taskEstimatedCandles;
  }
  flush();

  return batches;
}

export function planBulkCandleBackfill(request: PlanBulkCandleBackfillRequest): BulkCandleBackfillPlan {
  const provider = request.provider ?? "ibkr";
  const timeframes = request.timeframes ?? ["daily", "4h", "5m", "1m"];
  const tasksByKey = new Map<string, BulkCandleBackfillTask>();
  const symbols = new Set<string>();
  const sessions = new Set<string>();
  const naiveTaskCount = request.trades.length * timeframes.length;

  for (const trade of request.trades) {
    const symbol = normalizeSymbol(trade.symbol);
    symbols.add(symbol);
    sessions.add(trade.sessionDate);
    for (const timeframe of timeframes) {
      const lookbackBars = request.lookbackBars?.[timeframe] ?? DEFAULT_LOOKBACK_BARS[timeframe];
      const endTimestamp = parseTimestamp(trade.asOfTimestamp, trade.sessionDate);
      const startTimestamp = parseOptionalTimestamp(trade.startTimestamp, "startTimestamp") ??
        endTimestamp - lookbackBars * intervalMs(timeframe);
      if (startTimestamp > endTimestamp) {
        throw new Error(`Invalid startTimestamp for ${symbol} ${timeframe}: startTimestamp is after asOfTimestamp.`);
      }
      const key = `${provider}:${symbol}:${trade.sessionDate}:${timeframe}`;
      const existing = tasksByKey.get(key);
      if (existing) {
        const mergedStartTimestamp = Math.min(existing.startTimestamp, startTimestamp);
        const mergedEndTimestamp = Math.max(existing.endTimestamp, endTimestamp);
        tasksByKey.set(key, {
          ...existing,
          startTimestamp: mergedStartTimestamp,
          endTimestamp: mergedEndTimestamp,
          tradeRequestCount: (existing.tradeRequestCount ?? 1) + 1,
          lookbackBars: Math.max(
            existing.lookbackBars,
            lookbackBars,
            lookbackBarsForRange(mergedStartTimestamp, mergedEndTimestamp, timeframe),
          ),
          estimatedCandleCount: estimateCandleCount(mergedStartTimestamp, mergedEndTimestamp, timeframe),
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
        tradeRequestCount: 1,
        estimatedCandleCount: estimateCandleCount(startTimestamp, endTimestamp, timeframe),
      });
    }
  }

  const tasks = [...tasksByKey.values()]
    .map(finalizeTask)
    .sort((left, right) =>
      left.symbol.localeCompare(right.symbol) ||
      left.sessionDate.localeCompare(right.sessionDate) ||
      left.timeframe.localeCompare(right.timeframe),
    );
  const estimatedCandleCount = tasks.reduce((sum, task) => sum + (task.estimatedCandleCount ?? 0), 0);
  const avoidedTaskCount = naiveTaskCount - tasks.length;

  return {
    provider,
    tasks,
    providerBatches: groupBackfillTasksIntoProviderBatches(tasks, request.batching),
    symbolCount: symbols.size,
    sessionCount: sessions.size,
    naiveTaskCount,
    dedupedTaskCount: tasks.length,
    avoidedTaskCount,
    avoidedTaskPct: pct(avoidedTaskCount, naiveTaskCount),
    estimatedCandleCount,
    maxTaskEstimatedCandles: tasks.reduce((max, task) => Math.max(max, task.estimatedCandleCount ?? 0), 0),
  };
}

export async function planWarehouseMissingCandleBackfill(
  request: PlanWarehouseMissingCandleBackfillRequest,
): Promise<WarehouseMissingCandleBackfillPlan> {
  const baseline = planBulkCandleBackfill(request);
  const tasks: WarehouseMissingCandleBackfillTask[] = [];
  let fullyCoveredTaskCount = 0;
  let missingCandleCountEstimate = 0;
  let likelyNoBarMissingTaskCount = 0;
  let likelyNoBarMissingCandleCountEstimate = 0;

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
    const classified = classifyMissingRangesBySession({
      timeframe: task.timeframe,
      missingRanges,
      coverage,
    });
    likelyNoBarMissingCandleCountEstimate += classified.likelyNoBarEstimate;
    if (classified.likelyNoBarEstimate > 0) {
      likelyNoBarMissingTaskCount += 1;
    }
    if (classified.actionableEstimate === 0) {
      fullyCoveredTaskCount += 1;
      continue;
    }
    missingCandleCountEstimate += classified.actionableEstimate;
    tasks.push({
      ...task,
      coverage,
      missingRanges: classified.actionableRanges,
      likelyNoBarMissingRanges: classified.likelyNoBarRanges,
      missingCandleCountEstimate: classified.actionableEstimate,
      likelyNoBarMissingCandleCountEstimate: classified.likelyNoBarEstimate,
    });
  }

  return {
    provider: baseline.provider,
    tasks,
    providerBatches: groupBackfillTasksIntoProviderBatches(tasks, request.batching),
    symbolCount: baseline.symbolCount,
    sessionCount: baseline.sessionCount,
    naiveTaskCount: baseline.naiveTaskCount,
    avoidedTaskCount: baseline.avoidedTaskCount,
    avoidedTaskPct: baseline.avoidedTaskPct,
    estimatedCandleCount: tasks.reduce((sum, task) => sum + (task.estimatedCandleCount ?? 0), 0),
    maxTaskEstimatedCandles: tasks.reduce((max, task) => Math.max(max, task.estimatedCandleCount ?? 0), 0),
    plannedTaskCount: baseline.dedupedTaskCount,
    missingTaskCount: tasks.length,
    fullyCoveredTaskCount,
    missingCandleCountEstimate,
    likelyNoBarMissingTaskCount,
    likelyNoBarMissingCandleCountEstimate,
  };
}
