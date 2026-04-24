import test from "node:test";
import assert from "node:assert/strict";

import { FinnhubClient } from "../lib/stock-context/finnhub-client.js";
import {
  buildFinnhubThreadPreviewPayload,
  formatFinnhubThreadPreview,
} from "../lib/stock-context/finnhub-thread-preview.js";

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

  assert.match(content, /COMPANY: Example Corp/);
  assert.match(content, /EXCHANGE: NASDAQ/);
  assert.match(content, /INDUSTRY: Technology/);
  assert.match(content, /COUNTRY: US/);
  assert.match(content, /WEBSITE: https:\/\/www\.example\.com/);
  assert.match(content, /MARKET CAP: 850\.00M/);
  assert.match(content, /CURRENT PRICE: 12\.340/);
  assert.match(content, /PERCENT CHANGE: \+11\.10%/);
  assert.match(content, /OPEN: 11\.750/);
  assert.match(content, /PREVIOUS CLOSE: 11\.110/);
  assert.match(content, /Levels loading\.\.\./);
  assert.doesNotMatch(content, /STOCK CONTEXT:/);
  assert.doesNotMatch(content, /TICKER:/);
  assert.equal(payload.title, "");
  assert.equal(payload.metadata?.messageKind, "stock_context");
});
