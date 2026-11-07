/** Portable adapters for the separately hosted levels/Watchlist runtime.
 * Only a private VPS gateway token is used here; no Alpaca broker key.
 */
type RuntimeFrame = "1m" | "daily" | "4h" | "5m";
type HistoricalRequest = { symbol: string; timeframe: RuntimeFrame; lookbackBars: number; endTimeMs?: number };
type HistoricalPlan = { plannedBarCount: number; requestStartTimestamp: number; requestEndTimestamp: number };
type RuntimeUpdate = { symbol: string; timestamp: number; lastPrice: number; bid?: number; ask?: number };
type AdapterOptions = { url?: string; token?: string; fetcher?: typeof fetch; now?: () => number };
type RuntimeBar = { time: number; open: number; high: number; low: number; close: number; volume: number };

class RuntimeGateway {
  readonly now: () => number;
  private readonly base: URL;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  constructor(options: AdapterOptions = {}) {
    const raw = options.url ?? process.env.TRADERLINK_ALPACA_GATEWAY_URL;
    const token = options.token ?? process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN;
    if (!raw || !token) throw Error("Alpaca VPS gateway configuration is required.");
    this.base = new URL(raw.endsWith("/") ? raw : raw + "/");
    if (this.base.username || this.base.password || this.base.search || this.base.hash || (this.base.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && this.base.protocol === "http:" && this.base.hostname === "127.0.0.1"))) throw Error("Alpaca VPS gateway requires encrypted transport.");
    this.token = token; this.fetcher = options.fetcher ?? fetch; this.now = options.now ?? Date.now;
  }
  async get(path: string, query: URLSearchParams, signal?: AbortSignal) {
    const url = new URL(path, this.base); url.search = query.toString();
    const timeout = AbortSignal.timeout(120_000);
    const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${this.token}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: "error" });
    if (!response.ok) throw Error("Alpaca VPS market data is unavailable.");
    return response.json();
  }
}

export async function readAlpacaRuntimeReferencePrice(symbol: string, options: AdapterOptions = {}): Promise<{price:number;asOf:number;source:"alpaca"} | null> {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) return null;
  try {
    const gateway = new RuntimeGateway(options);
    const data = await gateway.get("quotes", new URLSearchParams({symbols:symbol}));
    const trade = data.feed === "sip" ? data.snapshots?.[symbol]?.latestTrade : null;
    const asOf = Date.parse(trade?.t ?? "");
    if (typeof trade?.p !== "number" || !Number.isFinite(trade.p) || trade.p <= 0 || !Number.isFinite(asOf) || asOf > gateway.now()) return null;
    return {price:trade.p,asOf,source:"alpaca"};
  } catch { return null; }
}

export class AlpacaRuntimeHistoricalProvider {
  readonly providerName = "alpaca" as const;
  private readonly gateway: RuntimeGateway;
  constructor(options: AdapterOptions = {}) { this.gateway = new RuntimeGateway(options); }
  async fetchCandles(request: HistoricalRequest, plan: HistoricalPlan) {
    const symbol = request.symbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw Error("Invalid stock symbol.");
    const started = this.gateway.now();
    const timeframe = { "1m": "1Min", daily: "1Day", "4h": "4Hour", "5m": "5Min" }[request.timeframe];
    const payload = await this.gateway.get("history", new URLSearchParams({ symbol, timeframe, start: String(plan.requestStartTimestamp), end: String(plan.requestEndTimestamp) })) as { symbol: string; feed: string; adjustment: string; complete: boolean; bars: RuntimeBar[] };
    if (payload.symbol !== symbol || payload.feed !== "sip" || payload.adjustment !== "split" || !payload.complete || !Array.isArray(payload.bars)) throw Error("Alpaca candle history is incomplete.");
    const bars = new Map<number, RuntimeBar>();
    for (const bar of payload.bars) {
      if (!Number.isSafeInteger(bar.time) || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || bar.low <= 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.volume < 0) throw Error("Invalid Alpaca candle data.");
      if (bar.time * 1000 >= plan.requestStartTimestamp && bar.time * 1000 <= plan.requestEndTimestamp) bars.set(bar.time, bar);
    }
    return { provider: "alpaca" as const, symbol, timeframe: request.timeframe, requestedLookbackBars: request.lookbackBars,
      candles: [...bars.values()].sort((a, b) => a.time - b.time).map(bar => ({ timestamp: bar.time * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })),
      fetchStartTimestamp: started, fetchEndTimestamp: this.gateway.now(), requestedStartTimestamp: plan.requestStartTimestamp, requestedEndTimestamp: plan.requestEndTimestamp,
      sessionMetadataAvailable: request.timeframe !== "daily", providerMetadata: { source: "alpaca_sip_vps", adjustment: "split" } };
  }
}

const clock = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit" });
function sessionKey(time: number) {
  const values = Object.fromEntries(clock.formatToParts(time).map(part => [part.type, part.value]));
  const minute = Number(values.hour) * 60 + Number(values.minute);
  return { date: `${values.year}-${values.month}-${values.day}`, session: minute < 240 || minute >= 1200 ? "overnight" : minute < 570 ? "premarket" : minute < 960 ? "regular" : "after_hours" };
}

/** Polls the VPS's shared WebSocket cache, never Alpaca REST for each live tick. */
export class AlpacaRuntimeLivePriceProvider {
  private readonly gateway: RuntimeGateway;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private readonly published = new Map<string, string>();
  constructor(options: AdapterOptions = {}) { this.gateway = new RuntimeGateway(options); }
  async start(entries: { symbol: string; active: boolean }[], onUpdate: (update: RuntimeUpdate) => void) {
    await this.stop();
    const symbols = [...new Set(entries.filter(entry => entry.active).map(entry => entry.symbol.trim().toUpperCase()))];
    if (symbols.length > 400 || symbols.some(symbol => !/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol))) throw Error("Invalid Alpaca Watchlist population.");
    const generation = ++this.generation, abort = new AbortController(); this.abort = abort;
    const publish = (symbol: string, trade: { p?: number; t?: string } | null, quote?: { bp?: number; ap?: number }) => {
      if (generation !== this.generation || !trade || typeof trade.p !== "number" || !Number.isFinite(trade.p) || trade.p <= 0) return;
      const timestamp = Date.parse(trade.t ?? ""), now = this.gateway.now();
      if (!Number.isFinite(timestamp) || timestamp > now + 2000) return;
      const source = sessionKey(timestamp), current = sessionKey(now);
      if (current.session === "overnight") { if (now - timestamp > 8 * 3600_000 || source.session !== "overnight") return; }
      else if (source.date !== current.date || source.session !== current.session) return;
      const signature = `${timestamp}:${trade.p}`; if (this.published.get(symbol) === signature) return;
      this.published.set(symbol, signature);
      const book = typeof quote?.bp === "number" && Number.isFinite(quote.bp) && quote.bp > 0 && typeof quote.ap === "number" && Number.isFinite(quote.ap) && quote.ap >= quote.bp ? { bid: quote.bp, ask: quote.ap } : {};
      onUpdate({ symbol, timestamp, lastPrice: trade.p, ...book });
    };
    const poll = async () => {
      try {
        if (sessionKey(this.gateway.now()).session === "overnight") {
          const remaining = [...symbols];
          await Promise.all(Array.from({ length: Math.min(4, symbols.length) }, async () => {
            while (remaining.length && generation === this.generation) {
              const symbol = remaining.shift()!;
              try { const data = await this.gateway.get("overnight", new URLSearchParams({ symbol }), abort.signal); if (data.feed === "boats") publish(symbol, data.trade); } catch { /* Retain last accepted value. */ }
            }
          }));
        } else if (symbols.length) {
          const data = await this.gateway.get("quotes", new URLSearchParams({ symbols: symbols.join(",") }), abort.signal);
          if (data.feed === "sip" && data.connected) for (const symbol of symbols) publish(symbol, data.snapshots?.[symbol]?.latestTrade, data.snapshots?.[symbol]?.latestQuote);
        }
      } catch { /* No silent provider fallback or manufactured fresh timestamp. */ }
      finally { if (generation === this.generation && symbols.length) this.timer = setTimeout(() => void poll(), 5000); }
    };
    if (symbols.length) void poll();
  }
  async stop() { this.generation++; clearTimeout(this.timer); this.abort?.abort(); this.abort = undefined; this.published.clear(); }
}
