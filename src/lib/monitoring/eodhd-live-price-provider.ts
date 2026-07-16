import type { LivePriceProvider, LivePriceListener } from "./live-price-types.js";
import type { WatchlistEntry } from "./monitoring-types.js";

type EodhdWebSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (event: "open" | "message" | "error" | "close", listener: (event: any) => void) => void;
  removeEventListener?: (event: "open" | "message" | "error" | "close", listener: (event: any) => void) => void;
};

type EodhdWebSocketFactory = (url: string) => EodhdWebSocketLike;

export type EodhdLivePriceProviderOptions = {
  apiToken?: string;
  endpointUrl?: string;
  maxSymbols?: number;
  reconnectDelayMs?: number;
  socketFactory?: EodhdWebSocketFactory;
};

type EodhdTradeMessage = {
  s?: unknown;
  p?: unknown;
  v?: unknown;
  t?: unknown;
  ms?: unknown;
  dp?: unknown;
};

const DEFAULT_ENDPOINT_URL = "wss://ws.eodhistoricaldata.com/ws/us";
const DEFAULT_MAX_SYMBOLS = 50;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const OPEN_STATE = 1;

function envText(...names: string[]): string | undefined {
  return names.map((name) => process.env[name]?.trim()).find(Boolean);
}

function resolveSocketFactory(factory?: EodhdWebSocketFactory): EodhdWebSocketFactory {
  if (factory) {
    return factory;
  }
  const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (url: string) => EodhdWebSocketLike }).WebSocket;
  if (!WebSocketCtor) {
    throw new Error("Global WebSocket is unavailable; use Node 22+ or provide an EODHD socket factory.");
  }
  return (url: string) => new WebSocketCtor(url);
}

function parsePositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeWatchlistSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeEodhdWebSocketSymbol(symbol: string): string {
  const normalized = normalizeWatchlistSymbol(symbol);
  return normalized.endsWith(".US") ? normalized.slice(0, -3) : normalized;
}

function positiveIntegerEnv(names: string[], fallback: number): number {
  const raw = envText(...names);
  const parsed = raw ? Number.parseInt(raw, 10) : undefined;
  return Number.isInteger(parsed) && parsed! > 0 ? parsed! : fallback;
}

export class EodhdLivePriceProvider implements LivePriceProvider {
  private readonly apiToken: string;
  private readonly endpointUrl: string;
  private readonly maxSymbols: number;
  private readonly reconnectDelayMs: number;
  private readonly socketFactory: EodhdWebSocketFactory;
  private activeSymbols: string[] = [];
  private activeSymbolByStreamSymbol = new Map<string, string>();
  private listener?: LivePriceListener;
  private socket?: EodhdWebSocketLike;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(options: EodhdLivePriceProviderOptions = {}) {
    const apiToken = options.apiToken ?? envText("EODHD_API_TOKEN", "LEVEL_EODHD_API_TOKEN");
    if (!apiToken) {
      throw new Error("EODHD_API_TOKEN is required to use the EODHD live price provider.");
    }

    this.apiToken = apiToken;
    this.endpointUrl = options.endpointUrl ?? envText("EODHD_WEBSOCKET_URL", "LEVEL_EODHD_WEBSOCKET_URL") ?? DEFAULT_ENDPOINT_URL;
    this.maxSymbols = options.maxSymbols ?? positiveIntegerEnv(
      ["EODHD_WEBSOCKET_MAX_SYMBOLS", "LEVEL_EODHD_WEBSOCKET_MAX_SYMBOLS"],
      DEFAULT_MAX_SYMBOLS,
    );
    this.reconnectDelayMs = options.reconnectDelayMs ?? positiveIntegerEnv(
      ["EODHD_WEBSOCKET_RECONNECT_DELAY_MS", "LEVEL_EODHD_WEBSOCKET_RECONNECT_DELAY_MS"],
      DEFAULT_RECONNECT_DELAY_MS,
    );
    this.socketFactory = resolveSocketFactory(options.socketFactory);
  }

  async start(entries: WatchlistEntry[], onUpdate: LivePriceListener): Promise<void> {
    await this.stop();

    const activeSymbolByStreamSymbol = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.active) {
        continue;
      }
      const watchlistSymbol = normalizeWatchlistSymbol(entry.symbol);
      if (!watchlistSymbol) {
        continue;
      }
      const streamSymbol = normalizeEodhdWebSocketSymbol(watchlistSymbol);
      if (!activeSymbolByStreamSymbol.has(streamSymbol)) {
        activeSymbolByStreamSymbol.set(streamSymbol, watchlistSymbol);
      }
    }
    const activeSymbols = [...activeSymbolByStreamSymbol.keys()];
    if (activeSymbols.length > this.maxSymbols) {
      throw new Error(`EODHD WebSocket supports ${this.maxSymbols} active symbols by configuration; received ${activeSymbols.length}.`);
    }

    this.activeSymbols = activeSymbols;
    this.activeSymbolByStreamSymbol = activeSymbolByStreamSymbol;
    this.listener = onUpdate;
    this.stopping = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
    this.listener = undefined;
    this.activeSymbols = [];
    this.activeSymbolByStreamSymbol = new Map();
  }

  private connect(): void {
    const url = new URL(this.endpointUrl);
    url.searchParams.set("api_token", this.apiToken);
    const socket = this.socketFactory(url.toString());
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.stopping) {
        return;
      }
      this.subscribe(socket);
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || this.stopping) {
        return;
      }
      this.handleMessage(event?.data);
    });
    socket.addEventListener("error", (event) => {
      if (this.socket !== socket || this.stopping) {
        return;
      }
      console.error("EODHD WebSocket error:", event?.message ?? event);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = undefined;
      if (!this.stopping) {
        this.scheduleReconnect();
      }
    });
  }

  private subscribe(socket: EodhdWebSocketLike): void {
    if (socket.readyState !== OPEN_STATE || this.activeSymbols.length === 0) {
      return;
    }

    socket.send(JSON.stringify({
      action: "subscribe",
      symbols: this.activeSymbols.join(","),
    }));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.stopping) {
        this.connect();
      }
    }, this.reconnectDelayMs);
  }

  private handleMessage(raw: unknown): void {
    if (!this.listener || raw === undefined || raw === null) {
      return;
    }

    let parsed: EodhdTradeMessage | EodhdTradeMessage[];
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) as EodhdTradeMessage | EodhdTradeMessage[] : raw as EodhdTradeMessage;
    } catch {
      return;
    }

    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
      this.handleTradeMessage(message);
    }
  }

  private handleTradeMessage(message: EodhdTradeMessage): void {
    if (!this.listener) {
      return;
    }

    const symbol = typeof message.s === "string" ? normalizeEodhdWebSocketSymbol(message.s) : "";
    const watchlistSymbol = this.activeSymbolByStreamSymbol.get(symbol);
    const lastPrice = parsePositiveNumber(message.p);
    if (!symbol || !watchlistSymbol || !lastPrice || message.dp === true) {
      return;
    }

    this.listener({
      symbol: watchlistSymbol,
      timestamp: parsePositiveNumber(message.t) ?? Date.now(),
      lastPrice,
      volume: parsePositiveNumber(message.v),
    });
  }
}
