import type {
  CandleFetchTimeframe,
  CandleProviderName,
  CandleProviderResponse,
} from "../market-data/candle-types.js";
import type { HistoricalFetchRequest } from "../market-data/candle-fetch-service.js";
import {
  planWarehouseMissingCandleBackfill,
  type PlanWarehouseMissingCandleBackfillRequest,
  type WarehouseMissingCandleBackfillPlan,
  type WarehouseMissingCandleBackfillTask,
} from "./bulk-backfill-planner.js";
import type { CandleWarehouseCoverage, CandleWarehouseUpsertRequest } from "./durable-candle-warehouse.js";

type BackfillFetchClient = {
  getProviderName(): CandleProviderName;
  fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse>;
};

type BackfillWarehouse = PlanWarehouseMissingCandleBackfillRequest["warehouse"] & {
  upsertCandles(request: CandleWarehouseUpsertRequest): Promise<CandleWarehouseCoverage>;
};

export type CandleWarehouseBackfillMode = "dry_run" | "execute";
export type CandleWarehouseBackfillReadiness =
  | "already_covered"
  | "safe_to_fetch"
  | "refreshed"
  | "provider_risk";

export type CandleWarehouseBackfillTaskResult = {
  symbol: string;
  timeframe: CandleFetchTimeframe;
  sessionDate: string;
  status: "planned" | "fetched" | "skipped" | "failed";
  readiness: CandleWarehouseBackfillReadiness;
  requestedLookbackBars: number;
  missingRangeCount: number;
  missingCandleCountEstimate: number;
  fetchedCandles: number;
  storedCandles: number;
  error: string | null;
};

export type CandleWarehouseBackfillResult = {
  generatedAt: string;
  mode: CandleWarehouseBackfillMode;
  provider: CandleProviderName;
  plan: WarehouseMissingCandleBackfillPlan;
  totals: {
    plannedTasks: number;
    attemptedTasks: number;
    fetchedTasks: number;
    skippedTasks: number;
    failedTasks: number;
    fetchedCandles: number;
    storedCandles: number;
  };
  taskResults: CandleWarehouseBackfillTaskResult[];
};

export type ExecuteCandleWarehouseBackfillRequest = Omit<PlanWarehouseMissingCandleBackfillRequest, "warehouse"> & {
  warehouse: BackfillWarehouse;
  fetchClient: BackfillFetchClient;
  mode?: CandleWarehouseBackfillMode;
  concurrency?: number;
  throttleMs?: number;
  maxTasks?: number;
};

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function lookbackBarsForTask(task: WarehouseMissingCandleBackfillTask): number {
  return Math.max(task.lookbackBars, task.missingCandleCountEstimate);
}

function plannedResult(task: WarehouseMissingCandleBackfillTask): CandleWarehouseBackfillTaskResult {
  return {
    symbol: task.symbol,
    timeframe: task.timeframe,
    sessionDate: task.sessionDate,
    status: "planned",
    readiness: "safe_to_fetch",
    requestedLookbackBars: lookbackBarsForTask(task),
    missingRangeCount: task.missingRanges.length,
    missingCandleCountEstimate: task.missingCandleCountEstimate,
    fetchedCandles: 0,
    storedCandles: 0,
    error: null,
  };
}

async function runTask(params: {
  task: WarehouseMissingCandleBackfillTask;
  request: ExecuteCandleWarehouseBackfillRequest;
}): Promise<CandleWarehouseBackfillTaskResult> {
  const lookbackBars = lookbackBarsForTask(params.task);
  try {
    const response = await params.request.fetchClient.fetchCandles({
      symbol: params.task.symbol,
      timeframe: params.task.timeframe,
      lookbackBars,
      endTimeMs: params.task.endTimestamp,
      preferredProvider: params.task.provider,
    });
    const coverage = await params.request.warehouse.upsertCandles({
      provider: response.provider,
      symbol: response.symbol,
      timeframe: response.timeframe,
      candles: response.candles,
      sourceFetchedAt: response.fetchEndTimestamp,
    });
    return {
      ...plannedResult(params.task),
      status: "fetched",
      readiness: "refreshed",
      fetchedCandles: response.actualBarsReturned,
      storedCandles: coverage.candleCount,
    };
  } catch (error) {
    return {
      ...plannedResult(params.task),
      status: "failed",
      readiness: "provider_risk",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]!;
      nextIndex += 1;
      await worker(item);
    }
  }));
}

export async function executeCandleWarehouseBackfill(
  request: ExecuteCandleWarehouseBackfillRequest,
): Promise<CandleWarehouseBackfillResult> {
  const mode = request.mode ?? "dry_run";
  const provider = request.provider ?? request.fetchClient.getProviderName();
  const plan = await planWarehouseMissingCandleBackfill({
    ...request,
    provider,
    warehouse: request.warehouse,
  });
  const selectedTasks = typeof request.maxTasks === "number" && Number.isFinite(request.maxTasks)
    ? plan.tasks.slice(0, request.maxTasks)
    : plan.tasks;

  if (mode === "dry_run") {
    const taskResults = selectedTasks.map(plannedResult);
    return {
      generatedAt: new Date().toISOString(),
      mode,
      provider,
      plan,
      totals: {
        plannedTasks: selectedTasks.length,
        attemptedTasks: 0,
        fetchedTasks: 0,
        skippedTasks: selectedTasks.length,
        failedTasks: 0,
        fetchedCandles: 0,
        storedCandles: 0,
      },
      taskResults,
    };
  }

  const concurrency = clampPositiveInteger(request.concurrency, 1);
  const throttleMs = Math.max(0, request.throttleMs ?? 0);
  const taskResults: CandleWarehouseBackfillTaskResult[] = [];
  await runWithConcurrency(selectedTasks, concurrency, async (task) => {
    if (throttleMs > 0) {
      await sleep(throttleMs);
    }
    taskResults.push(await runTask({ task, request: { ...request, provider } }));
  });

  return {
    generatedAt: new Date().toISOString(),
    mode,
    provider,
    plan,
    totals: {
      plannedTasks: selectedTasks.length,
      attemptedTasks: selectedTasks.length,
      fetchedTasks: taskResults.filter((task) => task.status === "fetched").length,
      skippedTasks: 0,
      failedTasks: taskResults.filter((task) => task.status === "failed").length,
      fetchedCandles: taskResults.reduce((sum, task) => sum + task.fetchedCandles, 0),
      storedCandles: taskResults.reduce((sum, task) => sum + task.storedCandles, 0),
    },
    taskResults: taskResults.sort((left, right) =>
      left.symbol.localeCompare(right.symbol) || left.timeframe.localeCompare(right.timeframe),
    ),
  };
}
