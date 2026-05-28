import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { finalizeCandleProviderResponse } from "../market-data/candle-quality.js";
import {
  CandleFetchService,
  StubHistoricalCandleProvider,
  type HistoricalFetchRequest,
} from "../market-data/candle-fetch-service.js";
import type {
  BaseCandleProviderResponse,
  Candle,
  CandleFetchTimeframe,
  CandleProviderName,
  CandleProviderResponse,
} from "../market-data/candle-types.js";

export type DurableCandleWarehouseRow = Candle & {
  symbol: string;
  provider: CandleProviderName;
  timeframe: CandleFetchTimeframe;
  sourceFetchedAt: number;
  adjustmentMode: "raw";
};

export type CandleWarehouseRangeRequest = {
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  startTimestamp: number;
  endTimestamp: number;
};

export type CandleWarehouseUpsertRequest = {
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  candles: Candle[];
  sourceFetchedAt?: number;
};

export type CandleWarehouseCoverage = {
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  candleCount: number;
  startTimestamp: number | null;
  endTimestamp: number | null;
};

export type CandleWarehouseMissingRange = {
  startTimestamp: number;
  endTimestamp: number;
};

type CandleFetchClient = {
  getProviderName(): CandleProviderName;
  fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse>;
};

export type DurableCandleWarehouseFetchServiceOptions = {
  warehouse: DurableCandleWarehouse;
  delegate: CandleFetchClient;
  mode?: "read_write" | "refresh" | "replay";
};

const ONE_MINUTE_MS = 60_000;

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("symbol is required.");
  }
  return normalized;
}

function timeframeMs(timeframe: CandleFetchTimeframe): number {
  if (timeframe === "1m") {
    return ONE_MINUTE_MS;
  }
  if (timeframe === "5m") {
    return 5 * ONE_MINUTE_MS;
  }
  if (timeframe === "4h") {
    return 4 * 60 * ONE_MINUTE_MS;
  }
  return 24 * 60 * ONE_MINUTE_MS;
}

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dateKeysBetween(startTimestamp: number, endTimestamp: number): string[] {
  const keys: string[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const start = Math.floor(startTimestamp / dayMs) * dayMs;
  const end = Math.floor(endTimestamp / dayMs) * dayMs;
  for (let timestamp = start; timestamp <= end; timestamp += dayMs) {
    keys.push(dateKey(timestamp));
  }
  return keys;
}

function rowKey(row: DurableCandleWarehouseRow): string {
  return String(row.timestamp);
}

function sortCandles<T extends Candle>(candles: T[]): T[] {
  return [...candles].sort((left, right) => left.timestamp - right.timestamp);
}

function uniqueSortedCandles<T extends Candle>(candles: T[]): T[] {
  const byTimestamp = new Map<number, T>();
  for (const candle of candles) {
    if (Number.isFinite(candle.timestamp)) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return sortCandles([...byTimestamp.values()]);
}

function buildRequestedRange(request: HistoricalFetchRequest): {
  startTimestamp: number;
  endTimestamp: number;
  intervalMs: number;
} {
  const intervalMs = timeframeMs(request.timeframe);
  const rawEnd = request.endTimeMs ?? Date.now();
  const endTimestamp = Math.floor(rawEnd / intervalMs) * intervalMs;
  return {
    endTimestamp,
    startTimestamp: endTimestamp - request.lookbackBars * intervalMs,
    intervalMs,
  };
}

function sessionMetadataAvailable(timeframe: CandleFetchTimeframe): boolean {
  return timeframe === "1m" || timeframe === "5m";
}

export class DurableCandleWarehouse {
  constructor(readonly rootDirectoryPath: string) {}

  private directoryPath(params: {
    provider: CandleProviderName;
    symbol: string;
    timeframe: CandleFetchTimeframe;
  }): string {
    return join(
      this.rootDirectoryPath,
      params.provider,
      normalizeSymbol(params.symbol),
      params.timeframe,
    );
  }

  private filePath(params: {
    provider: CandleProviderName;
    symbol: string;
    timeframe: CandleFetchTimeframe;
    date: string;
  }): string {
    return join(
      this.directoryPath(params),
      `${params.date}.jsonl`,
    );
  }

  async upsertCandles(request: CandleWarehouseUpsertRequest): Promise<CandleWarehouseCoverage> {
    const symbol = normalizeSymbol(request.symbol);
    const candles = uniqueSortedCandles(request.candles);
    const sourceFetchedAt = request.sourceFetchedAt ?? Date.now();
    const byDate = new Map<string, DurableCandleWarehouseRow[]>();

    for (const candle of candles) {
      const key = dateKey(candle.timestamp);
      byDate.set(key, [
        ...(byDate.get(key) ?? []),
        {
          ...candle,
          symbol,
          provider: request.provider,
          timeframe: request.timeframe,
          sourceFetchedAt,
          adjustmentMode: "raw",
        },
      ]);
    }

    for (const [date, rows] of byDate) {
      const path = this.filePath({
        provider: request.provider,
        symbol,
        timeframe: request.timeframe,
        date,
      });
      const existing = await this.readRowsFromFile(path);
      const merged = new Map<string, DurableCandleWarehouseRow>();
      for (const row of [...existing, ...rows]) {
        merged.set(rowKey(row), row);
      }
      await this.writeRowsToFile(path, sortCandles([...merged.values()]));
    }

    return this.getCoverage({
      provider: request.provider,
      symbol,
      timeframe: request.timeframe,
      startTimestamp: candles[0]?.timestamp ?? 0,
      endTimestamp: candles.at(-1)?.timestamp ?? 0,
    });
  }

  async getCandles(request: CandleWarehouseRangeRequest): Promise<Candle[]> {
    const rows: DurableCandleWarehouseRow[] = [];
    for (const date of dateKeysBetween(request.startTimestamp, request.endTimestamp)) {
      const path = this.filePath({
        provider: request.provider,
        symbol: request.symbol,
        timeframe: request.timeframe,
        date,
      });
      rows.push(...await this.readRowsFromFile(path));
    }

    return uniqueSortedCandles(
      rows
        .filter((row) => row.timestamp >= request.startTimestamp && row.timestamp <= request.endTimestamp)
        .map((row) => ({
          timestamp: row.timestamp,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
        })),
    );
  }

  async getCoverage(request: CandleWarehouseRangeRequest): Promise<CandleWarehouseCoverage> {
    const candles = await this.getCandles(request);
    return {
      provider: request.provider,
      symbol: normalizeSymbol(request.symbol),
      timeframe: request.timeframe,
      candleCount: candles.length,
      startTimestamp: candles[0]?.timestamp ?? null,
      endTimestamp: candles.at(-1)?.timestamp ?? null,
    };
  }

  async findMissingRanges(request: CandleWarehouseRangeRequest): Promise<CandleWarehouseMissingRange[]> {
    const intervalMs = timeframeMs(request.timeframe);
    const candles = await this.getCandles(request);
    const existing = new Set(candles.map((candle) => candle.timestamp));
    const missing: CandleWarehouseMissingRange[] = [];
    let currentMissingStart: number | null = null;

    for (
      let timestamp = Math.floor(request.startTimestamp / intervalMs) * intervalMs;
      timestamp <= request.endTimestamp;
      timestamp += intervalMs
    ) {
      const hasCandle = existing.has(timestamp);
      if (!hasCandle && currentMissingStart === null) {
        currentMissingStart = timestamp;
      }
      if (hasCandle && currentMissingStart !== null) {
        missing.push({
          startTimestamp: currentMissingStart,
          endTimestamp: timestamp - intervalMs,
        });
        currentMissingStart = null;
      }
    }

    if (currentMissingStart !== null) {
      missing.push({
        startTimestamp: currentMissingStart,
        endTimestamp: Math.floor(request.endTimestamp / intervalMs) * intervalMs,
      });
    }

    return missing;
  }

  async listSymbols(provider: CandleProviderName): Promise<string[]> {
    try {
      const entries = await readdir(join(this.rootDirectoryPath, provider), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name.toUpperCase())
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async readRowsFromFile(path: string): Promise<DurableCandleWarehouseRow[]> {
    try {
      const raw = await readFile(path, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as DurableCandleWarehouseRow;
            return Number.isFinite(parsed.timestamp) ? [parsed] : [];
          } catch {
            return [];
          }
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async writeRowsToFile(path: string, rows: DurableCandleWarehouseRow[]): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
    await rename(tempPath, path);
  }
}

export class DurableCandleWarehouseFetchService extends CandleFetchService {
  private readonly warehouse: DurableCandleWarehouse;
  private readonly delegate: CandleFetchClient;
  private readonly mode: "read_write" | "refresh" | "replay";

  constructor(options: DurableCandleWarehouseFetchServiceOptions) {
    super(new StubHistoricalCandleProvider());
    this.warehouse = options.warehouse;
    this.delegate = options.delegate;
    this.mode = options.mode ?? "read_write";
  }

  override getProviderName(): CandleProviderName {
    return this.delegate.getProviderName();
  }

  override async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    const symbol = normalizeSymbol(request.symbol);
    const provider = request.preferredProvider ?? this.delegate.getProviderName();
    const range = buildRequestedRange(request);
    const warehouseRequest: CandleWarehouseRangeRequest = {
      provider,
      symbol,
      timeframe: request.timeframe,
      startTimestamp: range.startTimestamp,
      endTimestamp: range.endTimestamp,
    };

    if (this.mode !== "refresh") {
      const storedCandles = await this.warehouse.getCandles(warehouseRequest);
      if (storedCandles.length >= request.lookbackBars) {
        return this.buildWarehouseResponse(request, provider, storedCandles.slice(-request.lookbackBars), {
          cacheStatus: "hit",
        });
      }
      if (this.mode === "replay") {
        throw new Error(
          `Durable candle warehouse miss for ${symbol} ${request.timeframe}; found ${storedCandles.length}/${request.lookbackBars} candles.`,
        );
      }
    }

    const fresh = await this.delegate.fetchCandles(request);
    await this.warehouse.upsertCandles({
      provider: fresh.provider,
      symbol: fresh.symbol,
      timeframe: fresh.timeframe,
      candles: fresh.candles,
      sourceFetchedAt: fresh.fetchEndTimestamp,
    });
    return {
      ...fresh,
      providerMetadata: {
        ...fresh.providerMetadata,
        durableWarehouse: "write_through",
        durableWarehouseMode: this.mode,
      },
    };
  }

  private buildWarehouseResponse(
    request: HistoricalFetchRequest,
    provider: CandleProviderName,
    candles: Candle[],
    metadata: Record<string, string>,
  ): CandleProviderResponse {
    const range = buildRequestedRange(request);
    const response: BaseCandleProviderResponse = {
      provider,
      symbol: normalizeSymbol(request.symbol),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles: sortCandles(candles),
      fetchStartTimestamp: Date.now(),
      fetchEndTimestamp: Date.now(),
      requestedStartTimestamp: range.startTimestamp,
      requestedEndTimestamp: range.endTimestamp,
      sessionMetadataAvailable: sessionMetadataAvailable(request.timeframe),
      providerMetadata: {
        durableWarehouse: "read",
        ...metadata,
      },
    };
    return finalizeCandleProviderResponse(response);
  }
}

