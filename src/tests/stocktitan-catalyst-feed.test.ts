import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RecentWebsiteArticleLookupResult } from "../lib/live-watchlist/recent-website-articles.js";
import {
  applyStockTitanRssFallback,
  parseStockTitanRssArticles,
  StockTitanRssCatalystFeed,
} from "../lib/live-watchlist/stocktitan-catalyst-feed.js";

const REFERENCE_TIME = Date.parse("2026-07-20T21:41:45.000Z");
const PAPL_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Pineapple Financial Reports $25.3 Million in Third-Quarter Net Income &amp; Enters Its Next Stage | PAPL Stock News</title>
      <link>https://www.stocktitan.net/news/PAPL/pineapple-financial-reports-25-3-million.html</link>
      <pubDate>Mon, 20 Jul 2026 21:19:00 GMT</pubDate>
      <guid isPermaLink="true">https://www.stocktitan.net/news/PAPL/pineapple-financial-reports-25-3-million.html</guid>
    </item>
    <item>
      <title>Pineapple Financial Provides an Old Update | PAPL Stock News</title>
      <link>https://www.stocktitan.net/news/PAPL/pineapple-financial-old-update.html</link>
      <pubDate>Wed, 20 May 2026 12:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Wrong host should be ignored | PAPL Stock News</title>
      <link>https://example.com/news/PAPL/wrong-host.html</link>
      <pubDate>Mon, 20 Jul 2026 21:20:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe("StockTitanRssCatalystFeed", () => {
  it("parses safe ticker RSS entries as title-only catalyst evidence", () => {
    const articles = parseStockTitanRssArticles(PAPL_RSS, "papl");

    assert.equal(articles.length, 2);
    assert.equal(
      articles[0]?.title,
      "Pineapple Financial Reports $25.3 Million in Third-Quarter Net Income & Enters Its Next Stage",
    );
    assert.equal(articles[0]?.publishedAt, "2026-07-20T21:19:00.000Z");
    assert.equal(articles[0]?.sourceKind, "stocktitan_rss");
    assert.equal(articles[0]?.eventType, "stocktitan_rss_catalyst");
    assert.equal(articles[0]?.summary, undefined);
  });

  it("fetches only recent RSS titles and caches repeated ticker lookups", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const feed = new StockTitanRssCatalystFeed({
      now: () => REFERENCE_TIME,
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(PAPL_RSS, {
          status: 200,
          headers: {
            "content-type": "application/rss+xml; charset=utf-8",
            "ratelimit-remaining": "29",
            "ratelimit-reset": "300",
          },
        });
      },
    });

    const first = await feed.lookup({
      symbol: "PAPL",
      referenceTimeMs: REFERENCE_TIME,
    });
    const second = await feed.lookup({
      symbol: "PAPL",
      referenceTimeMs: REFERENCE_TIME,
    });

    assert.equal(first.available, true);
    assert.equal(first.research.count, 1);
    assert.equal(first.research.articles[0]?.sourceKind, "stocktitan_rss");
    assert.equal(second.research.count, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://www.stocktitan.net/rss/news/PAPL");
    assert.match(String(requests[0]?.init?.headers &&
      (requests[0].init.headers as Record<string, string>)["user-agent"]), /TraderLink/i);
  });

  it("honors a StockTitan rate-limit response without trying another ticker", async () => {
    let fetchCount = 0;
    const feed = new StockTitanRssCatalystFeed({
      now: () => REFERENCE_TIME,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "300" },
        });
      },
    });

    const first = await feed.lookup({ symbol: "PAPL", referenceTimeMs: REFERENCE_TIME });
    const second = await feed.lookup({ symbol: "OTHER", referenceTimeMs: REFERENCE_TIME });

    assert.equal(first.available, false);
    assert.equal(first.error, "http_429");
    assert.equal(second.available, false);
    assert.equal(second.error, "rate_limited");
    assert.equal(fetchCount, 1);
  });
});

describe("applyStockTitanRssFallback", () => {
  it("keeps local research first and calls StockTitan only for an empty lookup", async () => {
    const localResearch: RecentWebsiteArticleLookupResult = {
      ticker: "PAPL",
      businessDays: 5,
      count: 1,
      articles: [{
        ticker: "PAPL",
        title: "Local TradersLink catalyst",
        url: "https://traderslink.pro/news/local-papl-catalyst",
      }],
    };
    let fallbackCalls = 0;
    const lookup = async () => {
      fallbackCalls += 1;
      return {
        available: true,
        research: {
          ticker: "PAPL",
          businessDays: 5,
          count: 1,
          articles: [{
            ticker: "PAPL",
            title: "StockTitan fallback catalyst",
            url: "https://www.stocktitan.net/news/PAPL/fallback.html",
            publishedAt: "2026-07-20T21:19:00.000Z",
            sourceKind: "stocktitan_rss" as const,
          }],
        },
      };
    };

    const localResult = await applyStockTitanRssFallback({
      localResearch,
      symbol: "PAPL",
      referenceTimeMs: REFERENCE_TIME,
      lookup,
    });
    assert.equal(localResult, localResearch);
    assert.equal(fallbackCalls, 0);

    const fallbackResult = await applyStockTitanRssFallback({
      localResearch: { ...localResearch, count: 0, articles: [] },
      symbol: "PAPL",
      referenceTimeMs: REFERENCE_TIME,
      lookup,
    });
    assert.equal(fallbackCalls, 1);
    assert.equal(fallbackResult.articles[0]?.sourceKind, "stocktitan_rss");
  });
});
