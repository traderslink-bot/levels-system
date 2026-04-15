import { EventName, IBApi, WhatToShow } from "@stoqey/ib";

import type { Candle, CandleProviderResponse, CandleTimeframe } from "./candle-types.js";
import type {
  HistoricalCandleProvider,
  HistoricalFetchRequest,
} from "./candle-fetch-service.js";
import { sharedIbkrPacingQueue } from "./ibkr-pacing-queue.js";

type HistoricalDataListener = (
  reqId: number,
  time: string | number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  count?: number,
  wap?: number,
  hasGaps?: boolean,
) => void;

type HistoricalDataEndListener = (
  reqId: number,
  startDate: string,
  endDate: string,
) => void;

type ErrorListener = (
  error: unknown,
  code?: number,
  reqId?: number,
  advancedOrderReject?: unknown,
) => void;

type IBApiHistoricalClient = {
  on: (event: EventName | string, listener: (...args: any[]) => void) => void;
  off: (event: EventName | string, listener: (...args: any[]) => void) => void;
  reqHistoricalData: (
    reqId: number,
    contract: Record<string, unknown>,
    endDateTime: string,
    durationStr: string,
    barSizeSetting: string,
    whatToShow: string,
    useRTH: number | boolean,
    formatDate: number,
    keepUpToDate: boolean,
  ) => void;
  cancelHistoricalData: (reqId: number) => void;
};

type IbkrHistoricalBar = {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const HISTORICAL_DATA_END_EVENT = "historicalDataEnd";

const TIMEFRAME_TO_BAR_SIZE: Record<CandleTimeframe, string> = {
  daily: "1 day",
  "4h": "4 hours",
  "5m": "5 mins",
};

export class IbkrHistoricalCandleProvider implements HistoricalCandleProvider {
  private static nextRequestId = 10_000;

  constructor(
    private readonly ib: IBApi,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    this.validateRequest(request);

    const reqId = IbkrHistoricalCandleProvider.nextRequestId++;
    const symbol = request.symbol.trim().toUpperCase();
    const bars = await sharedIbkrPacingQueue.enqueue(() =>
      this.requestHistoricalBars(reqId, symbol, request),
    );

    if (bars.length === 0) {
      throw new Error(`IBKR returned no historical candles for ${symbol} (${request.timeframe}).`);
    }

    const candles = bars
      .map((bar, index) => this.mapBarToCandle(bar, symbol, request.timeframe, index))
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(-request.lookbackBars);

    if (candles.length === 0) {
      throw new Error(`IBKR returned no usable historical candles for ${symbol} (${request.timeframe}).`);
    }

    return {
      symbol,
      timeframe: request.timeframe,
      candles,
    };
  }

  private get ibClient(): IBApiHistoricalClient {
    return this.ib as unknown as IBApiHistoricalClient;
  }

  private validateRequest(request: HistoricalFetchRequest): void {
    if (!request.symbol.trim()) {
      throw new Error("symbol is required.");
    }

    if (!Number.isInteger(request.lookbackBars) || request.lookbackBars <= 0) {
      throw new Error("lookbackBars must be a positive integer.");
    }
  }

  private requestHistoricalBars(
    reqId: number,
    symbol: string,
    request: HistoricalFetchRequest,
  ): Promise<IbkrHistoricalBar[]> {
    return new Promise<IbkrHistoricalBar[]>((resolve, reject) => {
      const bars: IbkrHistoricalBar[] = [];
      let settled = false;

      const cleanup = (): void => {
        clearTimeout(timeoutHandle);
        this.ibClient.off(EventName.historicalData, onHistoricalData);
        this.ibClient.off(HISTORICAL_DATA_END_EVENT, onHistoricalDataEnd);
        this.ibClient.off(EventName.error, onError);
      };

      const finalizeResolve = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(bars);
      };

      const finalizeReject = (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        try {
          this.ibClient.cancelHistoricalData(reqId);
        } catch {
          // Ignore cancellation failures during error cleanup.
        }

        reject(error);
      };

      const onHistoricalData: HistoricalDataListener = (
        incomingReqId,
        time,
        open,
        high,
        low,
        close,
        volume,
      ) => {
        if (incomingReqId !== reqId) {
          return;
        }

        if (typeof time === "string" && time.startsWith("finished")) {
          finalizeResolve();
          return;
        }

        bars.push({
          time,
          open,
          high,
          low,
          close,
          volume,
        });
      };

      const onHistoricalDataEnd: HistoricalDataEndListener = (incomingReqId) => {
        if (incomingReqId !== reqId) {
          return;
        }

        finalizeResolve();
      };

      const onError: ErrorListener = (error, code, incomingReqId) => {
        const extractedReqId =
          typeof error === "number"
            ? error
            : typeof incomingReqId === "number"
              ? incomingReqId
              : undefined;

        if (extractedReqId !== reqId) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Unknown IBKR historical data error.";
        const errorCode = typeof code === "number" ? ` (code ${code})` : "";

        finalizeReject(
          new Error(`Failed to fetch IBKR historical data for ${symbol}${errorCode}: ${message}`),
        );
      };

      const timeoutHandle = setTimeout(() => {
        finalizeReject(
          new Error(
            `Timed out after ${this.timeoutMs}ms while fetching IBKR historical data for ${symbol}.`,
          ),
        );
      }, this.timeoutMs);

      this.ibClient.on(EventName.historicalData, onHistoricalData);
      this.ibClient.on(HISTORICAL_DATA_END_EVENT, onHistoricalDataEnd);
      this.ibClient.on(EventName.error, onError);

      try {
        this.ibClient.reqHistoricalData(
          reqId,
          {
            symbol,
            secType: "STK",
            exchange: "SMART",
            currency: "USD",
          },
          "",
          this.getDurationForTimeframe(request.timeframe),
          TIMEFRAME_TO_BAR_SIZE[request.timeframe],
          WhatToShow.TRADES,
          false,
          2,
          false,
        );
      } catch (error) {
        finalizeReject(
          error instanceof Error
            ? error
            : new Error(`Failed to start IBKR historical data request for ${symbol}.`),
        );
      }
    });
  }

  private mapBarToCandle(
    bar: IbkrHistoricalBar,
    symbol: string,
    timeframe: CandleTimeframe,
    index: number,
  ): Candle {
    const timestamp = this.parseIbkrTimestamp(bar.time);

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error(
        `IBKR returned invalid timestamp for ${symbol} (${timeframe}) at bar ${index}: ${String(bar.time)}`,
      );
    }

    return {
      timestamp,
      open: this.toFiniteNumber(bar.open, "open", symbol, timeframe, index),
      high: this.toFiniteNumber(bar.high, "high", symbol, timeframe, index),
      low: this.toFiniteNumber(bar.low, "low", symbol, timeframe, index),
      close: this.toFiniteNumber(bar.close, "close", symbol, timeframe, index),
      volume: Math.max(0, Math.round(this.toFiniteNumber(bar.volume, "volume", symbol, timeframe, index))),
    };
  }

  private parseIbkrTimestamp(rawTime: string | number): number {
    if (typeof rawTime === "number") {
      const timestamp = rawTime * 1000;

      if (!Number.isFinite(timestamp)) {
        throw new Error(`Invalid IBKR numeric timestamp: ${rawTime}`);
      }

      return timestamp;
    }

    const trimmed = rawTime.trim();

    if (/^\d+$/.test(trimmed)) {
      const numericValue = Number(trimmed);
      const timestamp = trimmed.length <= 10 ? numericValue * 1000 : numericValue;

      if (!Number.isFinite(timestamp)) {
        throw new Error(`Invalid IBKR numeric timestamp: ${rawTime}`);
      }

      return timestamp;
    }

    if (/^\d{8}$/.test(trimmed)) {
      const year = Number(trimmed.slice(0, 4));
      const monthIndex = Number(trimmed.slice(4, 6)) - 1;
      const day = Number(trimmed.slice(6, 8));
      const timestamp = new Date(year, monthIndex, day).getTime();

      if (!Number.isFinite(timestamp)) {
        throw new Error(`Invalid IBKR daily timestamp: ${rawTime}`);
      }

      return timestamp;
    }

    const parts = trimmed.match(
      /^(\d{4})(\d{2})(\d{2})[-\s]+(\d{2}):(\d{2}):(\d{2})$/,
    );

    if (parts) {
      const [, yearText, monthText, dayText, hourText, minuteText, secondText] = parts;
      const timestamp = new Date(
        Number(yearText),
        Number(monthText) - 1,
        Number(dayText),
        Number(hourText),
        Number(minuteText),
        Number(secondText),
      ).getTime();

      if (!Number.isFinite(timestamp)) {
        throw new Error(`Invalid IBKR intraday timestamp: ${rawTime}`);
      }

      return timestamp;
    }

    const fallbackTimestamp = Date.parse(trimmed);

    if (!Number.isFinite(fallbackTimestamp)) {
      throw new Error(`Unsupported IBKR timestamp format: ${rawTime}`);
    }

    return fallbackTimestamp;
  }

  private getDurationForTimeframe(timeframe: CandleTimeframe): string {
    switch (timeframe) {
      case "5m":
        return "2 D";
      case "4h":
        return "1 M";
      case "daily":
        return "1 Y";
    }
  }

  private toFiniteNumber(
    value: number,
    fieldName: string,
    symbol: string,
    timeframe: CandleTimeframe,
    index: number,
  ): number {
    if (!Number.isFinite(value)) {
      throw new Error(
        `IBKR returned invalid ${fieldName} for ${symbol} (${timeframe}) at bar ${index}: ${value}`,
      );
    }

    return value;
  }
}
