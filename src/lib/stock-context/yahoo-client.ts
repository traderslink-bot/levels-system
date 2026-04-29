type FetchLike = typeof fetch;

type YahooRawValue<T> = T | { raw?: T; fmt?: string; longFmt?: string };

type YahooQuoteResult = {
  symbol?: string;
  longName?: string;
  shortName?: string;
  exchange?: string;
  fullExchangeName?: string;
  quoteSourceName?: string;
  currency?: string;
  marketCap?: number;
  regularMarketPrice?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketPreviousClose?: number;
  regularMarketVolume?: number;
  averageDailyVolume10Day?: number;
  averageDailyVolume3Month?: number;
  preMarketPrice?: number;
  preMarketChange?: number;
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChange?: number;
  postMarketChangePercent?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketTime?: number;
  preMarketTime?: number;
  postMarketTime?: number;
};

type YahooQuoteSummaryResult = {
  price?: Record<string, YahooRawValue<string | number>>;
  assetProfile?: Record<string, YahooRawValue<string | number>>;
  summaryDetail?: Record<string, YahooRawValue<string | number>>;
  defaultKeyStatistics?: Record<string, YahooRawValue<string | number>>;
  financialData?: Record<string, YahooRawValue<string | number>>;
};

export type YahooStockQuote = {
  source: "Yahoo";
  symbol: string;
  longName?: string;
  shortName?: string;
  exchange?: string;
  quoteSourceName?: string;
  currency?: string;
  marketCap?: number;
  regularMarketPrice?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketPreviousClose?: number;
  regularMarketVolume?: number;
  averageDailyVolume10Day?: number;
  averageDailyVolume3Month?: number;
  preMarketPrice?: number;
  preMarketChange?: number;
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChange?: number;
  postMarketChangePercent?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketTime?: number;
  preMarketTime?: number;
  postMarketTime?: number;
};

export type YahooStockSummary = {
  source: "Yahoo";
  sector?: string;
  industry?: string;
  country?: string;
  website?: string;
  description?: string;
  fullTimeEmployees?: number;
  marketCap?: number;
  floatShares?: number;
  sharesOutstanding?: number;
  sharesShort?: number;
  sharesShortPriorMonth?: number;
  shortPercentOfFloat?: number;
  shortRatio?: number;
  totalCash?: number;
  totalDebt?: number;
  totalRevenue?: number;
  grossProfits?: number;
  ebitda?: number;
  freeCashflow?: number;
  profitMargins?: number;
  operatingMargins?: number;
  grossMargins?: number;
  revenueGrowth?: number;
};

export type YahooPreviousDayRange = {
  source: "Yahoo";
  high?: number;
  low?: number;
  timestamp?: number;
};

export type YahooStockContext = {
  source: "Yahoo";
  symbol: string;
  fetchedAt: number;
  quote?: YahooStockQuote;
  summary?: YahooStockSummary;
  previousDay?: YahooPreviousDayRange;
  errors: string[];
};

export type YahooClientOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  quoteBaseUrl?: string;
  summaryBaseUrl?: string;
};

function rawNumber(value: YahooRawValue<string | number> | undefined): number | undefined {
  const raw = typeof value === "object" && value !== null && "raw" in value ? value.raw : value;
  const numberValue = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function rawString(value: YahooRawValue<string | number> | undefined): string | undefined {
  const raw = typeof value === "object" && value !== null && "raw" in value ? value.raw : value;
  const stringValue = typeof raw === "string" ? raw.trim() : undefined;
  return stringValue && stringValue.length > 0 ? stringValue : undefined;
}

function isSameLocalDate(timestampSeconds: number | undefined, timestampMs: number): boolean {
  if (typeof timestampSeconds !== "number" || !Number.isFinite(timestampSeconds)) {
    return false;
  }

  const left = new Date(timestampSeconds * 1000);
  const right = new Date(timestampMs);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function readNumber(
  primary: Record<string, YahooRawValue<string | number>> | undefined,
  key: string,
  fallback?: number,
): number | undefined {
  return rawNumber(primary?.[key]) ?? fallback;
}

function readString(
  primary: Record<string, YahooRawValue<string | number>> | undefined,
  key: string,
  fallback?: string,
): string | undefined {
  return rawString(primary?.[key]) ?? fallback;
}

export class YahooClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly quoteBaseUrl: string;
  private readonly summaryBaseUrl: string;

  constructor(options: YahooClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.quoteBaseUrl = options.quoteBaseUrl ?? "https://query1.finance.yahoo.com/v7/finance/quote";
    this.summaryBaseUrl = options.summaryBaseUrl ?? "https://query1.finance.yahoo.com/v10/finance/quoteSummary";
  }

  async getPreviousDayRange(symbolInput: string): Promise<YahooPreviousDayRange> {
    const symbol = symbolInput.trim().toUpperCase();
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("range", "10d");
    url.searchParams.set("interval", "1d");
    url.searchParams.set("includePrePost", "false");

    const data = await this.requestJson<{
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              high?: Array<number | null>;
              low?: Array<number | null>;
            }>;
          };
        }>;
      };
    }>(url);
    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    const highs = quote?.high ?? [];
    const lows = quote?.low ?? [];

    const lastIndex = Math.min(timestamps.length, highs.length, lows.length) - 1;
    const startIndex = isSameLocalDate(timestamps[lastIndex], Date.now()) ? lastIndex - 1 : lastIndex;

    for (let index = startIndex; index >= 0; index -= 1) {
      const high = highs[index];
      const low = lows[index];
      if (typeof high === "number" && Number.isFinite(high) && typeof low === "number" && Number.isFinite(low)) {
        return {
          source: "Yahoo",
          high,
          low,
          timestamp: timestamps[index],
        };
      }
    }

    throw new Error(`Yahoo previous day range unavailable for ${symbol}.`);
  }

  private async requestJson<T>(url: URL): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 TraderLink levels-system",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Yahoo request failed (${response.status} ${response.statusText}) for ${url.pathname}: ${body}`.trim(),
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getQuote(symbolInput: string): Promise<YahooStockQuote> {
    const symbol = symbolInput.trim().toUpperCase();
    const url = new URL(this.quoteBaseUrl);
    url.searchParams.set("symbols", symbol);

    const data = await this.requestJson<{ quoteResponse?: { result?: YahooQuoteResult[] } }>(url);
    const quote = data.quoteResponse?.result?.[0];
    if (!quote) {
      throw new Error(`Yahoo quote unavailable for ${symbol}.`);
    }

    return {
      source: "Yahoo",
      symbol,
      longName: quote.longName,
      shortName: quote.shortName,
      exchange: quote.fullExchangeName ?? quote.exchange,
      quoteSourceName: quote.quoteSourceName,
      currency: quote.currency,
      marketCap: quote.marketCap,
      regularMarketPrice: quote.regularMarketPrice,
      regularMarketOpen: quote.regularMarketOpen,
      regularMarketDayHigh: quote.regularMarketDayHigh,
      regularMarketDayLow: quote.regularMarketDayLow,
      regularMarketPreviousClose: quote.regularMarketPreviousClose,
      regularMarketVolume: quote.regularMarketVolume,
      averageDailyVolume10Day: quote.averageDailyVolume10Day,
      averageDailyVolume3Month: quote.averageDailyVolume3Month,
      preMarketPrice: quote.preMarketPrice,
      preMarketChange: quote.preMarketChange,
      preMarketChangePercent: quote.preMarketChangePercent,
      postMarketPrice: quote.postMarketPrice,
      postMarketChange: quote.postMarketChange,
      postMarketChangePercent: quote.postMarketChangePercent,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
      regularMarketTime: quote.regularMarketTime,
      preMarketTime: quote.preMarketTime,
      postMarketTime: quote.postMarketTime,
    };
  }

  async getSummary(symbolInput: string): Promise<YahooStockSummary> {
    const symbol = symbolInput.trim().toUpperCase();
    const url = new URL(`${this.summaryBaseUrl.replace(/\/+$/g, "")}/${encodeURIComponent(symbol)}`);
    url.searchParams.set(
      "modules",
      [
        "price",
        "assetProfile",
        "summaryDetail",
        "defaultKeyStatistics",
        "financialData",
      ].join(","),
    );

    const data = await this.requestJson<{ quoteSummary?: { result?: YahooQuoteSummaryResult[]; error?: unknown } }>(url);
    const summary = data.quoteSummary?.result?.[0];
    if (!summary) {
      throw new Error(`Yahoo quote summary unavailable for ${symbol}.`);
    }

    return {
      source: "Yahoo",
      sector: readString(summary.assetProfile, "sector"),
      industry: readString(summary.assetProfile, "industry"),
      country: readString(summary.assetProfile, "country"),
      website: readString(summary.assetProfile, "website"),
      description: readString(summary.assetProfile, "longBusinessSummary"),
      fullTimeEmployees: readNumber(summary.assetProfile, "fullTimeEmployees"),
      marketCap: readNumber(summary.price, "marketCap", readNumber(summary.summaryDetail, "marketCap")),
      floatShares: readNumber(summary.defaultKeyStatistics, "floatShares"),
      sharesOutstanding: readNumber(summary.defaultKeyStatistics, "sharesOutstanding"),
      sharesShort: readNumber(summary.defaultKeyStatistics, "sharesShort"),
      sharesShortPriorMonth: readNumber(summary.defaultKeyStatistics, "sharesShortPriorMonth"),
      shortPercentOfFloat: readNumber(summary.defaultKeyStatistics, "shortPercentOfFloat"),
      shortRatio: readNumber(summary.defaultKeyStatistics, "shortRatio"),
      totalCash: readNumber(summary.financialData, "totalCash"),
      totalDebt: readNumber(summary.financialData, "totalDebt"),
      totalRevenue: readNumber(summary.financialData, "totalRevenue"),
      grossProfits: readNumber(summary.financialData, "grossProfits"),
      ebitda: readNumber(summary.financialData, "ebitda"),
      freeCashflow: readNumber(summary.financialData, "freeCashflow"),
      profitMargins: readNumber(summary.financialData, "profitMargins"),
      operatingMargins: readNumber(summary.financialData, "operatingMargins"),
      grossMargins: readNumber(summary.financialData, "grossMargins"),
      revenueGrowth: readNumber(summary.financialData, "revenueGrowth"),
    };
  }

  async getStockContext(symbolInput: string): Promise<YahooStockContext> {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) {
      throw new Error("A ticker symbol is required.");
    }

    const [quoteResult, summaryResult, previousDayResult] = await Promise.allSettled([
      this.getQuote(symbol),
      this.getSummary(symbol),
      this.getPreviousDayRange(symbol),
    ]);

    const errors: string[] = [];
    if (quoteResult.status === "rejected") {
      errors.push(quoteResult.reason instanceof Error ? quoteResult.reason.message : String(quoteResult.reason));
    }
    if (summaryResult.status === "rejected") {
      errors.push(summaryResult.reason instanceof Error ? summaryResult.reason.message : String(summaryResult.reason));
    }
    if (previousDayResult.status === "rejected") {
      errors.push(previousDayResult.reason instanceof Error ? previousDayResult.reason.message : String(previousDayResult.reason));
    }

    return {
      source: "Yahoo",
      symbol,
      fetchedAt: Date.now(),
      quote: quoteResult.status === "fulfilled" ? quoteResult.value : undefined,
      summary: summaryResult.status === "fulfilled" ? summaryResult.value : undefined,
      previousDay: previousDayResult.status === "fulfilled" ? previousDayResult.value : undefined,
      errors,
    };
  }
}

export function createYahooClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): YahooClient | null {
  const enabled = env.YAHOO_STOCK_CONTEXT_ENABLED?.trim().toLowerCase();
  if (enabled === "0" || enabled === "false" || enabled === "no" || enabled === "off") {
    return null;
  }

  return new YahooClient({ fetchImpl });
}
