const DEFAULT_NASDAQ_TRADE_HALT_RSS_URL =
  "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts";
const DEFAULT_CACHE_TTL_MS = 60_000;

export type NasdaqTradingHaltState = "halted" | "resumed" | "not_found";

export type NasdaqTradingHaltRecord = {
  symbol: string;
  state: Exclude<NasdaqTradingHaltState, "not_found">;
  haltDate: string | null;
  haltTime: string | null;
  reasonCode: string | null;
  resumptionDate: string | null;
  resumptionQuoteTime: string | null;
  resumptionTradeTime: string | null;
  source: "nasdaq_trader_rss";
};

export type NasdaqTradingHaltLookupResult = {
  checkedAt: number;
  available: boolean;
  cacheAgeMs: number | null;
  error: string | null;
  bySymbol: Record<string, NasdaqTradingHaltRecord | { symbol: string; state: "not_found" }>;
};

export type NasdaqTradingHaltLookup = (input: {
  symbols: string[];
  now: number;
}) => Promise<NasdaqTradingHaltLookupResult>;

export type NasdaqTradingHaltServiceOptions = {
  endpointUrl?: string;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
};

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function xmlTag(item: string, tag: string): string | null {
  const match = item.match(new RegExp(`<ndaq:${tag}[^>]*>([\\s\\S]*?)<\\/ndaq:${tag}>`, "i"));
  return match ? decodeXml(match[1] ?? "") || null : null;
}

export function parseNasdaqTradingHaltRss(xml: string): Map<string, NasdaqTradingHaltRecord> {
  const latestBySymbol = new Map<string, NasdaqTradingHaltRecord>();
  const items = xml.replace(/^\uFEFF/, "").match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  for (const item of items) {
    const symbol = xmlTag(item, "IssueSymbol")?.toUpperCase() ?? "";
    if (!symbol || latestBySymbol.has(symbol)) continue;
    const resumptionTradeTime = xmlTag(item, "ResumptionTradeTime");
    latestBySymbol.set(symbol, {
      symbol,
      state: resumptionTradeTime ? "resumed" : "halted",
      haltDate: xmlTag(item, "HaltDate"),
      haltTime: xmlTag(item, "HaltTime"),
      reasonCode: xmlTag(item, "ReasonCode"),
      resumptionDate: xmlTag(item, "ResumptionDate"),
      resumptionQuoteTime: xmlTag(item, "ResumptionQuoteTime"),
      resumptionTradeTime,
      source: "nasdaq_trader_rss",
    });
  }
  return latestBySymbol;
}

export class NasdaqTradingHaltService {
  private readonly endpointUrl: string;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private cachedAt: number | null = null;
  private cachedRecords = new Map<string, NasdaqTradingHaltRecord>();

  constructor(options: NasdaqTradingHaltServiceOptions = {}) {
    this.endpointUrl = options.endpointUrl ?? DEFAULT_NASDAQ_TRADE_HALT_RSS_URL;
    this.cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async lookup(input: { symbols: string[]; now: number }): Promise<NasdaqTradingHaltLookupResult> {
    let error: string | null = null;
    const cacheAgeMs = this.cachedAt === null ? null : Math.max(0, input.now - this.cachedAt);
    if (this.cachedAt === null || cacheAgeMs === null || cacheAgeMs >= this.cacheTtlMs) {
      try {
        const response = await this.fetchImpl(this.endpointUrl, {
          headers: {
            Accept: "application/rss+xml,application/xml,text/xml,*/*",
            "User-Agent": "TraderLink levels-system auto-watchlist/1.0",
          },
        });
        if (!response.ok) {
          throw new Error(`Nasdaq Trader halt feed returned HTTP ${response.status}.`);
        }
        this.cachedRecords = parseNasdaqTradingHaltRss(await response.text());
        this.cachedAt = input.now;
      } catch (lookupError) {
        error = lookupError instanceof Error ? lookupError.message : String(lookupError);
      }
    }

    const bySymbol: NasdaqTradingHaltLookupResult["bySymbol"] = {};
    for (const rawSymbol of input.symbols) {
      const symbol = rawSymbol.trim().toUpperCase();
      if (!symbol) continue;
      bySymbol[symbol] = this.cachedRecords.get(symbol) ?? { symbol, state: "not_found" };
    }
    return {
      checkedAt: input.now,
      available: this.cachedAt !== null,
      cacheAgeMs: this.cachedAt === null ? null : Math.max(0, input.now - this.cachedAt),
      error,
      bySymbol,
    };
  }
}
