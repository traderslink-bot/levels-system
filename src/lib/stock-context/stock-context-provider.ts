import type { FinnhubClient, FinnhubQuote, FinnhubThreadPreview } from "./finnhub-client.js";
import { createFinnhubClientFromEnv } from "./finnhub-client.js";
import type { StockContextProvider, StockContextPreview } from "./stock-context-types.js";
import type { YahooClient } from "./yahoo-client.js";
import { createYahooClientFromEnv } from "./yahoo-client.js";

type FetchLike = typeof fetch;

const EMPTY_FINNHUB_QUOTE: FinnhubQuote = {
  c: 0,
  d: 0,
  dp: 0,
  h: 0,
  l: 0,
  o: 0,
  pc: 0,
  t: 0,
};

function emptyFinnhubPreview(symbol: string): FinnhubThreadPreview {
  return {
    symbol,
    quote: EMPTY_FINNHUB_QUOTE,
    profile: {
      ticker: symbol,
    },
  };
}

export class CombinedStockContextProvider implements StockContextProvider {
  constructor(
    private readonly options: {
      finnhubClient?: FinnhubClient | null;
      yahooClient?: YahooClient | null;
    },
  ) {}

  async getThreadPreview(symbolInput: string): Promise<StockContextPreview> {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) {
      throw new Error("A ticker symbol is required.");
    }

    const [finnhubResult, yahooResult] = await Promise.allSettled([
      this.options.finnhubClient?.getThreadPreview(symbol) ?? Promise.resolve(emptyFinnhubPreview(symbol)),
      this.options.yahooClient?.getStockContext(symbol) ?? Promise.resolve(null),
    ]);

    const finnhubPreview =
      finnhubResult.status === "fulfilled" ? finnhubResult.value : emptyFinnhubPreview(symbol);
    const yahoo =
      yahooResult.status === "fulfilled"
        ? yahooResult.value
        : this.options.yahooClient
          ? {
              source: "Yahoo" as const,
              symbol,
              fetchedAt: Date.now(),
              errors: [yahooResult.reason instanceof Error ? yahooResult.reason.message : String(yahooResult.reason)],
            }
          : null;

    return {
      ...finnhubPreview,
      symbol,
      yahoo,
    };
  }
}

export function createStockContextProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): StockContextProvider | null {
  const finnhubClient = createFinnhubClientFromEnv(env, fetchImpl);
  const yahooClient = createYahooClientFromEnv(env, fetchImpl);

  if (!finnhubClient && !yahooClient) {
    return null;
  }

  return new CombinedStockContextProvider({
    finnhubClient,
    yahooClient,
  });
}
