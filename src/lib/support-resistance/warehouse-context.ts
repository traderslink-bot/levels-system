import {
  CandleFetchService,
  StubHistoricalCandleProvider,
  type CandleFetchServiceOptions,
} from "../market-data/candle-fetch-service.js";
import type { HistoricalFetchRequest } from "../market-data/candle-fetch-service.js";
import {
  DurableCandleWarehouse,
  DurableCandleWarehouseFetchService,
  type DurableCandleWarehouseFetchServiceOptions,
} from "../candle-warehouse/index.js";
import {
  buildSupportResistanceContextForSymbol,
  type BuildSupportResistanceContextForSymbolRequest,
  type SupportResistanceSymbolContext,
} from "./symbol-context.js";
import {
  buildTradeAnalysisCandleContext,
  type BuildTradeAnalysisCandleContextRequest,
  type TradeAnalysisCandleContext,
} from "./trade-analysis-context.js";

export type WarehouseBackedSharedContextOptions = {
  warehouseDirectoryPath?: string;
  warehouse?: DurableCandleWarehouse;
  mode?: DurableCandleWarehouseFetchServiceOptions["mode"];
  fetchServiceOptions?: CandleFetchServiceOptions;
  preferredProvider?: HistoricalFetchRequest["preferredProvider"];
};

function hasExplicitProvider(options: WarehouseBackedSharedContextOptions): boolean {
  return Boolean(
    options.fetchServiceOptions?.provider ||
      options.fetchServiceOptions?.ib,
  );
}

function defaultProvider(options: WarehouseBackedSharedContextOptions): HistoricalFetchRequest["preferredProvider"] {
  return hasExplicitProvider(options)
    ? options.preferredProvider
    : options.preferredProvider ?? "ibkr";
}

function defaultMode(options: WarehouseBackedSharedContextOptions): DurableCandleWarehouseFetchServiceOptions["mode"] {
  if (options.mode) {
    return options.mode;
  }
  return hasExplicitProvider(options) ? "read_write" : "replay";
}

function buildWarehouseFetchService(options: WarehouseBackedSharedContextOptions = {}): DurableCandleWarehouseFetchService {
  const warehouse = options.warehouse ?? new DurableCandleWarehouse(options.warehouseDirectoryPath ?? "data/candles");
  const provider = defaultProvider(options);
  const mode = defaultMode(options);
  const delegate = hasExplicitProvider(options)
    ? new CandleFetchService({
        ...options.fetchServiceOptions,
        providerName: provider ?? options.fetchServiceOptions?.providerName,
      })
    : new CandleFetchService(new StubHistoricalCandleProvider());
  return new DurableCandleWarehouseFetchService({
    warehouse,
    delegate,
    mode,
  });
}

export async function buildWarehouseBackedSupportResistanceContextForSymbol(
  request: Omit<BuildSupportResistanceContextForSymbolRequest, "fetchService" | "fetchServiceOptions"> &
    WarehouseBackedSharedContextOptions,
): Promise<SupportResistanceSymbolContext> {
  const fetchService = buildWarehouseFetchService(request);
  return buildSupportResistanceContextForSymbol({
    ...request,
    fetchService,
    preferredProvider: defaultProvider(request),
  });
}

export async function buildDefaultSupportResistanceContextForSymbol(
  request: Omit<BuildSupportResistanceContextForSymbolRequest, "fetchService" | "fetchServiceOptions"> &
    WarehouseBackedSharedContextOptions,
): Promise<SupportResistanceSymbolContext> {
  return buildWarehouseBackedSupportResistanceContextForSymbol({
    warehouseDirectoryPath: "data/candles",
    ...request,
  });
}

export async function buildWarehouseBackedTradeAnalysisCandleContext(
  request: Omit<BuildTradeAnalysisCandleContextRequest, "fetchService" | "fetchServiceOptions"> &
    WarehouseBackedSharedContextOptions,
): Promise<TradeAnalysisCandleContext> {
  const fetchService = buildWarehouseFetchService(request);
  return buildTradeAnalysisCandleContext({
    ...request,
    fetchService,
    preferredProvider: defaultProvider(request),
  });
}

export async function buildDefaultTradeAnalysisCandleContext(
  request: Omit<BuildTradeAnalysisCandleContextRequest, "fetchService" | "fetchServiceOptions"> &
    WarehouseBackedSharedContextOptions,
): Promise<TradeAnalysisCandleContext> {
  return buildWarehouseBackedTradeAnalysisCandleContext({
    warehouseDirectoryPath: "data/candles",
    ...request,
  });
}
