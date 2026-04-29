import test from "node:test";
import assert from "node:assert/strict";

import { FinnhubClient } from "../lib/stock-context/finnhub-client.js";
import {
  buildFinnhubThreadPreviewPayload,
  formatFinnhubThreadPreview,
} from "../lib/stock-context/finnhub-thread-preview.js";
import { YahooClient } from "../lib/stock-context/yahoo-client.js";

test("FinnhubClient assembles a stock context preview from quote and profile data", async () => {
  const requestedPaths: string[] = [];
  const client = new FinnhubClient({
    apiKey: "test-key",
    fetchImpl: async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      requestedPaths.push(url.pathname);

      if (url.pathname.endsWith("/quote")) {
        return new Response(
          JSON.stringify({
            c: 12.34,
            d: 1.23,
            dp: 11.1,
            h: 13,
            l: 11.5,
            o: 11.75,
            pc: 11.11,
            t: 1_700_000_000,
          }),
          { status: 200 },
        );
      }

      if (url.pathname.endsWith("/stock/profile2")) {
        return new Response(
          JSON.stringify({
            country: "US",
            exchange: "NASDAQ",
            finnhubIndustry: "Technology",
            ipo: "2021-01-01",
            marketCapitalization: 850,
            name: "Example Corp",
            shareOutstanding: 125,
            ticker: "EXMP",
            weburl: "https://www.example.com",
          }),
          { status: 200 },
        );
      }

      return new Response("not found", { status: 404 });
    },
  });

  const preview = await client.getThreadPreview("exmp");

  assert.equal(preview.symbol, "EXMP");
  assert.deepEqual(
    requestedPaths.sort(),
    ["/api/v1/quote", "/api/v1/stock/profile2"].sort(),
  );
  assert.equal(preview.profile.name, "Example Corp");
});

test("formatFinnhubThreadPreview prints a compact terminal preview", () => {
  const preview = {
    symbol: "EXMP",
    quote: {
      c: 12.34,
      d: 1.23,
      dp: 11.1,
      h: 13,
      l: 11.5,
      o: 11.75,
      pc: 11.11,
      t: 1_700_000_000,
    },
    profile: {
      country: "US",
      exchange: "NASDAQ",
      finnhubIndustry: "Technology",
      ipo: "2021-01-01",
      marketCapitalization: 850,
      name: "Example Corp",
      shareOutstanding: 125,
      weburl: "https://www.example.com",
    },
  };
  const content = formatFinnhubThreadPreview(preview);
  const payload = buildFinnhubThreadPreviewPayload(preview);

  assert.match(content, /Company: Example Corp/);
  assert.match(content, /Exchange \(Finnhub\): NASDAQ/);
  assert.match(content, /Industry \(Finnhub\): Technology/);
  assert.match(content, /Country \(Finnhub\): US/);
  assert.match(content, /Website \(Finnhub\): https:\/\/www\.example\.com/);
  assert.match(content, /Market cap \(Finnhub\): 850\.00M/);
  assert.match(content, /Shares outstanding \(Finnhub\): 125\.00M/);
  assert.match(content, /Levels are loading\./);
  assert.doesNotMatch(content, /CURRENT PRICE:/);
  assert.doesNotMatch(content, /PERCENT CHANGE:/);
  assert.doesNotMatch(content, /OPEN:/);
  assert.doesNotMatch(content, /HIGH:/);
  assert.doesNotMatch(content, /LOW:/);
  assert.doesNotMatch(content, /PREVIOUS CLOSE:/);
  assert.doesNotMatch(content, /STOCK CONTEXT:/);
  assert.doesNotMatch(content, /TICKER:/);
  assert.doesNotMatch(content, /Status:|Signal:|Decision area|setup update|state recap|setup move|operator-only|policy|suppression|replay|simulation/i);
  assert.equal(payload.title, "");
  assert.equal(payload.metadata?.messageKind, "stock_context");
});

test("YahooClient assembles quote, summary, and previous-day context", async () => {
  const requestedPaths: string[] = [];
  const client = new YahooClient({
    fetchImpl: async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      requestedPaths.push(url.pathname);

      if (url.pathname.endsWith("/finance/quote")) {
        return new Response(
          JSON.stringify({
            quoteResponse: {
              result: [
                {
                  symbol: "EXMP",
                  longName: "Example Corp",
                  fullExchangeName: "NasdaqCM",
                  regularMarketPrice: 12.34,
                  regularMarketDayHigh: 13,
                  regularMarketDayLow: 11.5,
                  regularMarketVolume: 1_250_000,
                  preMarketPrice: 12.5,
                  preMarketChange: 0.16,
                  preMarketChangePercent: 1.3,
                  postMarketPrice: 12.1,
                  postMarketChange: -0.24,
                  postMarketChangePercent: -1.9,
                  fiftyTwoWeekHigh: 20,
                  fiftyTwoWeekLow: 4.5,
                  marketCap: 850_000_000,
                  regularMarketTime: 100,
                  preMarketTime: 200,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      if (url.pathname.endsWith("/finance/quoteSummary/EXMP")) {
        return new Response(
          JSON.stringify({
            quoteSummary: {
              result: [
                {
                  assetProfile: {
                    sector: "Technology",
                    industry: "Software",
                    country: "US",
                    website: "https://www.example.com",
                    longBusinessSummary: "Example builds trader tools.",
                  },
                  price: {
                    marketCap: { raw: 875_000_000 },
                  },
                  defaultKeyStatistics: {
                    floatShares: { raw: 25_000_000 },
                    sharesOutstanding: { raw: 40_000_000 },
                    sharesShort: { raw: 2_500_000 },
                    shortPercentOfFloat: { raw: 0.1 },
                    shortRatio: { raw: 1.25 },
                  },
                  financialData: {
                    totalCash: { raw: 50_000_000 },
                    totalDebt: { raw: 8_000_000 },
                    totalRevenue: { raw: 120_000_000 },
                    profitMargins: { raw: -0.08 },
                    operatingMargins: { raw: -0.12 },
                    revenueGrowth: { raw: 0.42 },
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      if (url.pathname.endsWith("/finance/chart/EXMP")) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [10, 20, 30],
                  indicators: {
                    quote: [
                      {
                        high: [10, 11, 12],
                        low: [8, 9, 10],
                      },
                    ],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("not found", { status: 404 });
    },
  });

  const context = await client.getStockContext("exmp");

  assert.equal(context.symbol, "EXMP");
  assert.equal(context.quote?.preMarketPrice, 12.5);
  assert.equal(context.summary?.floatShares, 25_000_000);
  assert.equal(context.previousDay?.high, 12);
  assert.equal(context.previousDay?.low, 10);
  assert.deepEqual(
    requestedPaths.sort(),
    [
      "/v7/finance/quote",
      "/v10/finance/quoteSummary/EXMP",
      "/v8/finance/chart/EXMP",
      "/v8/finance/chart/EXMP",
    ].sort(),
  );
});

test("YahooClient uses chart price when quote endpoint has no usable price", async () => {
  const client = new YahooClient({
    fetchImpl: async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname.endsWith("/finance/quote")) {
        return new Response(JSON.stringify({ quoteResponse: { result: [] } }), { status: 200 });
      }

      if (url.pathname.endsWith("/finance/quoteSummary/EXMP")) {
        return new Response(JSON.stringify({ quoteSummary: { result: [] } }), { status: 200 });
      }

      if (url.pathname.endsWith("/finance/chart/EXMP") && url.searchParams.get("interval") === "1m") {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: {
                    currency: "USD",
                    exchangeName: "NasdaqCM",
                    regularMarketPrice: 1.2,
                    chartPreviousClose: 1.1,
                    currentTradingPeriod: {
                      pre: { start: 100, end: 200 },
                      regular: { start: 201, end: 500 },
                      post: { start: 501, end: 700 },
                    },
                  },
                  timestamp: [120, 180],
                  indicators: {
                    quote: [
                      {
                        close: [1.22, 1.27],
                        high: [1.23, 1.28],
                        low: [1.18, 1.2],
                        volume: [1000, 2500],
                      },
                    ],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      if (url.pathname.endsWith("/finance/chart/EXMP")) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [10],
                  indicators: {
                    quote: [{ high: [1.3], low: [1.1] }],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("not found", { status: 404 });
    },
  });

  const context = await client.getStockContext("exmp");
  const content = formatFinnhubThreadPreview({
    symbol: "EXMP",
    quote: { c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 },
    profile: { name: "Example Corp" },
    yahoo: context,
  });

  assert.equal(context.quote?.preMarketPrice, 1.27);
  assert.equal(context.quote?.priceSource, "chart");
  assert.match(content, /Current price \(Yahoo\): 1\.27 \(premarket\)/);
});

test("formatFinnhubThreadPreview includes only Yahoo current price in trader context", () => {
  const content = formatFinnhubThreadPreview({
    symbol: "EXMP",
    quote: {
      c: 12.34,
      d: 1.23,
      dp: 11.1,
      h: 13,
      l: 11.5,
      o: 11.75,
      pc: 11.11,
      t: 1_700_000_000,
    },
    profile: {
      country: "US",
      exchange: "NASDAQ",
      finnhubIndustry: "Technology",
      marketCapitalization: 850,
      name: "Example Corp",
      shareOutstanding: 125,
      weburl: "https://www.example.com",
    },
    yahoo: {
      source: "Yahoo",
      symbol: "EXMP",
      fetchedAt: 1,
      errors: [],
      quote: {
        source: "Yahoo",
        symbol: "EXMP",
        regularMarketPrice: 12.34,
        regularMarketDayHigh: 13,
        regularMarketDayLow: 11.5,
        regularMarketVolume: 1_250_000,
        preMarketPrice: 12.5,
        preMarketChange: 0.16,
        preMarketChangePercent: 1.3,
        fiftyTwoWeekHigh: 20,
        fiftyTwoWeekLow: 4.5,
        regularMarketTime: 100,
        preMarketTime: 200,
      },
      previousDay: {
        source: "Yahoo",
        high: 11,
        low: 9,
        timestamp: 20,
      },
      summary: {
        source: "Yahoo",
        marketCap: 875_000_000,
        floatShares: 25_000_000,
        sharesOutstanding: 40_000_000,
        sharesShort: 2_500_000,
        shortPercentOfFloat: 0.1,
        shortRatio: 1.25,
        totalCash: 50_000_000,
        totalDebt: 8_000_000,
        totalRevenue: 120_000_000,
        profitMargins: -0.08,
        operatingMargins: -0.12,
        revenueGrowth: 0.42,
        description: "Example builds trader tools.",
      },
    },
  });

  assert.match(content, /Yahoo context:/);
  assert.match(content, /Current price \(Yahoo\): 12\.50 \(premarket\)/);
  assert.doesNotMatch(content, /Previous day range \(Yahoo\)/);
  assert.doesNotMatch(content, /52-week range \(Yahoo\)/);
  assert.doesNotMatch(content, /Market cap \(Yahoo\)/);
  assert.doesNotMatch(content, /Float \/ shares \(Yahoo\)/);
  assert.doesNotMatch(content, /Short interest \(Yahoo\)/);
  assert.doesNotMatch(content, /Profitability \(Yahoo\)/);
  assert.doesNotMatch(content, /Cash \/ debt \(Yahoo\)/);
  assert.doesNotMatch(content, /Company description \(Yahoo\)/);
});

test("formatFinnhubThreadPreview omits Yahoo section when only non-current-price Yahoo fields are available", () => {
  const content = formatFinnhubThreadPreview({
    symbol: "EXMP",
    quote: {
      c: 0,
      d: 0,
      dp: 0,
      h: 0,
      l: 0,
      o: 0,
      pc: 0,
      t: 0,
    },
    profile: {
      name: "Example Corp",
    },
    yahoo: {
      source: "Yahoo",
      symbol: "EXMP",
      fetchedAt: 1,
      errors: ["Yahoo quote unavailable for EXMP.", "Yahoo quote summary unavailable for EXMP."],
      previousDay: {
        source: "Yahoo",
        high: 1.27,
        low: 1.16,
        timestamp: 20,
      },
    },
  });

  assert.doesNotMatch(content, /Yahoo context:/);
  assert.doesNotMatch(content, /Previous day range \(Yahoo\)/);
  assert.doesNotMatch(content, /unavailable/i);
  assert.doesNotMatch(content, /Current price \(Yahoo\): n\/a/);
  assert.doesNotMatch(content, /Regular session \(Yahoo\): price n\/a/);
  assert.doesNotMatch(content, /Market cap \(Yahoo\): n\/a/);
  assert.doesNotMatch(content, /Float \/ shares \(Yahoo\): float n\/a/);
});

test("formatFinnhubThreadPreview omits Yahoo section completely when Yahoo has no usable data", () => {
  const content = formatFinnhubThreadPreview({
    symbol: "EXMP",
    quote: {
      c: 0,
      d: 0,
      dp: 0,
      h: 0,
      l: 0,
      o: 0,
      pc: 0,
      t: 0,
    },
    profile: {
      name: "Example Corp",
    },
    yahoo: {
      source: "Yahoo",
      symbol: "EXMP",
      fetchedAt: 1,
      errors: ["Yahoo quote unavailable for EXMP.", "Yahoo quote summary unavailable for EXMP."],
    },
  });

  assert.doesNotMatch(content, /Yahoo context:/);
  assert.doesNotMatch(content, /unavailable/i);
});
