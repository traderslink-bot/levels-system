import test from "node:test";
import assert from "node:assert/strict";

import { FinnhubClient } from "../lib/stock-context/finnhub-client.js";
import { formatFinnhubThreadPreview } from "../lib/stock-context/finnhub-thread-preview.js";

test("FinnhubClient assembles a stock context preview and limits news items", async () => {
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
            weburl: "https://example.com",
          }),
          { status: 200 },
        );
      }

      if (url.pathname.endsWith("/company-news")) {
        return new Response(
          JSON.stringify([
            { headline: "Older item", source: "Source B", datetime: 100 },
            { headline: "Newest item", source: "Source A", datetime: 300 },
            { headline: "Middle item", source: "Source C", datetime: 200 },
            { headline: "Trimmed item", source: "Source D", datetime: 50 },
          ]),
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
    ["/api/v1/company-news", "/api/v1/quote", "/api/v1/stock/profile2"].sort(),
  );
  assert.equal(preview.recentNews.length, 3);
  assert.equal(preview.recentNews[0]?.headline, "Newest item");
  assert.equal(preview.recentNews[2]?.headline, "Older item");
});

test("formatFinnhubThreadPreview prints a compact terminal preview", () => {
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
      ipo: "2021-01-01",
      marketCapitalization: 850,
      name: "Example Corp",
      shareOutstanding: 125,
      weburl: "https://example.com",
    },
    recentNews: [
      {
        headline: "Example headline",
        source: "Example Source",
        datetime: 1_700_000_000,
      },
    ],
  });

  assert.match(content, /FIRST THREAD POST PREVIEW/);
  assert.match(content, /EXMP \| Example Corp \| NASDAQ \| Technology/);
  assert.match(content, /market cap 850\.00M/);
  assert.match(content, /Recent news/);
  assert.match(content, /Levels loading\.\.\./);
});
