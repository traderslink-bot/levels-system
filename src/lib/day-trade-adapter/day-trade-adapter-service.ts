import type { CandleFetchService } from "../market-data/candle-fetch-service.js";
import type { CoordinatedCandleFetchDiagnostics } from "../market-data/coordinated-candle-fetch-service.js";
import {
  buildDayTradeAdapterResult,
  type DayTradeAdapterMarketContext,
  type DayTradeAdapterResult,
} from "./day-trade-adapter-engine.js";

type AdapterCandleFetcher = Pick<CandleFetchService, "fetchCandles" | "getProviderName"> & {
  getDiagnostics?: () => CoordinatedCandleFetchDiagnostics;
};

export type DayTradeAdapterTransition = {
  timestamp: number;
  state: DayTradeAdapterResult["state"];
  confidence: DayTradeAdapterResult["confidence"];
  summary: string;
};

export class DayTradeAdapterService {
  private enabled = false;
  private readonly results = new Map<string, DayTradeAdapterResult>();
  private readonly transitions = new Map<string, DayTradeAdapterTransition[]>();
  private readonly refreshInFlight = new Map<string, Promise<DayTradeAdapterResult>>();

  constructor(
    private readonly candleFetcher: AdapterCandleFetcher,
    private readonly getMarketContext: (symbol: string) => DayTradeAdapterMarketContext,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getStatus(symbol?: string) {
    const normalized = symbol?.trim().toUpperCase();
    return {
      enabled: this.enabled,
      provider: this.candleFetcher.getProviderName(),
      coordinator: this.candleFetcher.getDiagnostics?.() ?? null,
      results: normalized
        ? [...this.results.values()].filter((result) => result.symbol === normalized)
        : [...this.results.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
      transitions: normalized
        ? { [normalized]: this.transitions.get(normalized) ?? [] }
        : Object.fromEntries(this.transitions),
    };
  }

  async refresh(symbolInput: string, force = false): Promise<DayTradeAdapterResult> {
    if (!this.enabled && !force) {
      throw new Error("The deterministic day trade adapter is disabled.");
    }
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) throw new Error("symbol is required.");
    const pending = this.refreshInFlight.get(symbol);
    if (pending) return pending;
    const refresh = this.performRefresh(symbol).finally(() => {
      this.refreshInFlight.delete(symbol);
    });
    this.refreshInFlight.set(symbol, refresh);
    return refresh;
  }

  private async performRefresh(symbol: string): Promise<DayTradeAdapterResult> {
    const market = this.getMarketContext(symbol);
    const [oneMinute, fiveMinute] = await Promise.all([
      this.candleFetcher.fetchCandles({
        symbol,
        timeframe: "1m",
        lookbackBars: 600,
        endTimeMs: market.timestamp,
        preferredProvider: "yahoo",
      }),
      this.candleFetcher.fetchCandles({
        symbol,
        timeframe: "5m",
        lookbackBars: 720,
        endTimeMs: market.timestamp,
        preferredProvider: "yahoo",
      }),
    ]);
    const result = buildDayTradeAdapterResult({ market, oneMinute, fiveMinute });
    const previous = this.results.get(symbol);
    this.results.set(symbol, result);
    if (!previous || previous.state !== result.state || previous.summary !== result.summary) {
      const history = this.transitions.get(symbol) ?? [];
      history.push({
        timestamp: result.generatedAt,
        state: result.state,
        confidence: result.confidence,
        summary: result.summary,
      });
      this.transitions.set(symbol, history.slice(-20));
    }
    return result;
  }
}
