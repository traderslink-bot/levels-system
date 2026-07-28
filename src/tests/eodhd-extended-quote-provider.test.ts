import assert from "node:assert/strict";
import test from "node:test";

import {
  createEodhdExtendedQuoteProviderFromEnv,
  EodhdExtendedQuoteProvider,
} from "../lib/live-watchlist/eodhd-extended-quote-provider.js";

function createFetch(payload: unknown, urls: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    };
  }) as typeof fetch;
}

test("EodhdExtendedQuoteProvider maps Live v2 bid and ask fields", async () => {
  const urls: string[] = [];
  const provider = new EodhdExtendedQuoteProvider({
    apiToken: "test-token",
    fetchFn: createFetch({
      meta: { count: 1 },
      data: {
        "ABCD.US": {
          symbol: "ABCD.US",
          exchange: "XNAS",
          name: "ABCD Corp",
          currency: "USD",
          open: 2,
          high: 2.4,
          low: 1.9,
          lastTradePrice: 2.31,
          size: 100,
          lastTradeTime: 1_804_098_010_000,
          bidPrice: 2.3,
          bidSize: 4,
          bidTime: 1_804_098_011_000,
          askPrice: 2.32,
          askSize: 8,
          askTime: 1_804_098_012_000,
          volume: 123456,
          change: 0.11,
          changePercent: 5,
          previousClosePrice: 2.2,
          ethPrice: 2.34,
          ethVolume: 500,
          ethTime: 1_804_098_013_000,
          marketCap: 50_000_000,
          sharesFloat: 12_500_000,
          timestamp: 1_804_098_000,
        },
      },
      links: { next: null },
    }, urls),
    now: () => 1_804_098_020_000,
  });

  const quote = await provider.getExtendedQuote("abcd");

  assert.equal(new URL(urls[0]!).searchParams.get("s"), "ABCD.US");
  assert.equal(new URL(urls[0]!).searchParams.get("api_token"), "test-token");
  assert.equal(quote?.source, "eodhd_live_v2");
  assert.equal(quote?.symbol, "ABCD");
  assert.equal(quote?.providerSymbol, "ABCD.US");
  assert.equal(quote?.updatedAt, 1_804_098_013_000);
  assert.equal(quote?.lastTradePrice, 2.31);
  assert.equal(quote?.bidPrice, 2.3);
  assert.equal(quote?.bidSize, 4);
  assert.equal(quote?.askPrice, 2.32);
  assert.equal(quote?.askSize, 8);
  assert.equal(quote?.ethPrice, 2.34);
});

test("EodhdExtendedQuoteProvider caches per symbol within the configured TTL", async () => {
  let now = 1_804_098_020_000;
  const urls: string[] = [];
  const provider = new EodhdExtendedQuoteProvider({
    apiToken: "test-token",
    cacheTtlMs: 1_000,
    fetchFn: createFetch({
      data: {
        "ABCD.US": {
          symbol: "ABCD.US",
          lastTradePrice: 2.31,
        },
      },
    }, urls),
    now: () => now,
  });

  await provider.getExtendedQuote("ABCD");
  await provider.getExtendedQuote("ABCD");
  now += 1_001;
  await provider.getExtendedQuote("ABCD");

  assert.equal(urls.length, 2);
});

test("createEodhdExtendedQuoteProviderFromEnv returns null without a token or when disabled", () => {
  assert.equal(createEodhdExtendedQuoteProviderFromEnv({}), null);
  assert.equal(
    createEodhdExtendedQuoteProviderFromEnv({
      EODHD_API_TOKEN: "test-token",
      EODHD_EXTENDED_QUOTES: "off",
    }),
    null,
  );
  assert.ok(
    createEodhdExtendedQuoteProviderFromEnv({
      EODHD_API_TOKEN: "test-token",
    }) instanceof EodhdExtendedQuoteProvider,
  );
});
