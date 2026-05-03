export type CandleWarehouseStorageMode = "jsonl" | "sqlite_recommended" | "service_recommended";

export type CandleWarehouseStoragePolicyInput = {
  symbolCount: number;
  sessionCount: number;
  estimatedRows: number;
  monthlyImportTrades?: number;
};

export type CandleWarehouseStoragePolicy = {
  mode: CandleWarehouseStorageMode;
  reasons: string[];
  thresholds: {
    jsonlComfortRows: number;
    sqliteRecommendedRows: number;
    serviceRecommendedRows: number;
    sqliteRecommendedMonthlyTrades: number;
  };
};

const JSONL_COMFORT_ROWS = 1_000_000;
const SQLITE_RECOMMENDED_ROWS = 5_000_000;
const SERVICE_RECOMMENDED_ROWS = 25_000_000;
const SQLITE_RECOMMENDED_MONTHLY_TRADES = 10_000;

export function assessCandleWarehouseStoragePolicy(
  input: CandleWarehouseStoragePolicyInput,
): CandleWarehouseStoragePolicy {
  const reasons: string[] = [];
  let mode: CandleWarehouseStorageMode = "jsonl";

  if (input.estimatedRows >= SERVICE_RECOMMENDED_ROWS) {
    mode = "service_recommended";
    reasons.push("estimated candle rows are high enough that a service-backed warehouse should be planned");
  } else if (
    input.estimatedRows >= SQLITE_RECOMMENDED_ROWS ||
    (input.monthlyImportTrades ?? 0) >= SQLITE_RECOMMENDED_MONTHLY_TRADES
  ) {
    mode = "sqlite_recommended";
    reasons.push("query volume or row count is high enough that SQLite indexes would materially help");
  } else {
    reasons.push("JSONL remains practical for local testing and early single-operator usage");
  }

  if (input.symbolCount >= 500) {
    reasons.push("large symbol count increases directory scans and favors indexed metadata");
  }
  if (input.sessionCount >= 250) {
    reasons.push("large session count increases repeated range lookups across date files");
  }

  return {
    mode,
    reasons,
    thresholds: {
      jsonlComfortRows: JSONL_COMFORT_ROWS,
      sqliteRecommendedRows: SQLITE_RECOMMENDED_ROWS,
      serviceRecommendedRows: SERVICE_RECOMMENDED_ROWS,
      sqliteRecommendedMonthlyTrades: SQLITE_RECOMMENDED_MONTHLY_TRADES,
    },
  };
}
