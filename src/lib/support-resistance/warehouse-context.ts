import { CandleFetchService, type CandleFetchServiceOptions } from "../market-data/candle-fetch-service.js";
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

function buildWarehouseFetchService(options: WarehouseBackedSharedContextOptions = {}): DurableCandleWarehouseFetchService {
  const warehouse = options.warehouse ?? new DurableCandleWarehouse(options.warehouseDirectoryPath ?? "data/candles");
  const delegate = new CandleFetchService({
    ...options.fetchServiceOptions,
    providerName: options.preferredProvider ?? options.fetchServiceOptions?.providerName,
  });
  return new DurableCandleWarehouseFetchService({
    warehouse,
    delegate,
    mode: options.mode ?? "read_write",
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
    preferredProvider: request.preferredProvider,
  });
}

export async function buildDefaultSupportResistanceContextForSymbol(
  request: Omit<BuildSupportResistanceContextForSymbolRequest, "fetchService" | "fetchServiceOptions"> &
    WarehouseBackedSharedContextOptions,
): Promise<SupportResistanceSymbolContext> {
  return buildWarehouseBackedSupportResistanceContextForSymbol({
    mode: "read_write",
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
    preferredProvider: request.preferredProvider,
  });
}

export async function buildDefaultTradeAnalysisCandleContext(
  request: Omit<BuildTradeAnalysisCandleContextRequest, "fetchService" | "fetchServiceOptions"> &
    WarehouseBackedSharedContextOptions,
): Promise<TradeAnalysisCandleContext> {
  return buildWarehouseBackedTradeAnalysisCandleContext({
    mode: "read_write",
    warehouseDirectoryPath: "data/candles",
    ...request,
  });
}
