import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRecentWebsiteArticlesPatch } from "../lib/live-watchlist/recent-website-articles.js";

import {
  createOfficialWatchlistArticleSourceLookup,
} from "../lib/live-watchlist/official-watchlist-article-source.js";

const TARGET_SESSION_DATE = "2026-09-08";
const CONTENT_SHA = "a".repeat(64);

function eligiblePayload(): Record<string, unknown> {
  return {
    contractVersion: "traderslink_watchlist_ai_source_v1",
    requestedTicker: "PDSB",
    targetSessionDate: TARGET_SESSION_DATE,
    eligibility: {
      status: "eligible",
      timeZone: "America/New_York",
      windowStartDateEt: "2026-09-02",
      windowEndDateEt: TARGET_SESSION_DATE,
      includedWeekdaysEt: ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", TARGET_SESSION_DATE],
    },
    article: {
      articleId: "article-pdsb",
      revision: "4",
      contentSha256: CONTENT_SHA,
      ticker: "PDSB",
      publicUrl: "https://traderslink.pro/news/PDSB/pdsb-catalyst",
      headline: "PDSB reports a catalyst",
      processedContent: "Canonical TradersLink processed article body.",
      publishedAt: "2026-09-08T13:00:00.000Z",
      observedAt: "2026-09-08T13:01:00.000Z",
      publishedDateEt: TARGET_SESSION_DATE,
      recency: "current_day",
      eventType: "press_release",
      routeTag: "press-release",
      sourceClass: "traderslink_processed",
      provenanceKey: `article-pdsb:4:${CONTENT_SHA}`,
    },
  };
}

describe("OfficialWatchlistArticleSource", () => {
  it("accepts the canonical Platform article contract and preserves processed content", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const lookup = createOfficialWatchlistArticleSourceLookup({
      env: {
        TRADERSLINK_WATCHLIST_INGEST_URL: "https://app.traderslink.pro/api/live-watchlist/ingest",
        TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN: "test-publisher-token",
      },
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json(eligiblePayload());
      },
      now: () => Date.parse("2026-09-08T14:00:00.000Z"),
    });

    const result = await lookup({ symbol: "pdsb", targetSessionDate: TARGET_SESSION_DATE });

    assert.equal(result.status, "eligible");
    assert.equal(result.research.articles[0]?.processedContent, "Canonical TradersLink processed article body.");
    assert.equal(result.research.articles[0]?.recency, "current_day");
    const publicPatch = buildRecentWebsiteArticlesPatch({ symbol: "PDSB", result: result.research });
    assert.ok(publicPatch);
    const publicBody = JSON.parse(publicPatch.cards.recentNewsFilings!.body!);
    assert.equal(publicBody.articles[0].title, result.research.articles[0]!.title);
    for (const field of ["processedContent", "articleId", "revision", "contentSha256", "targetSessionDate",
      "publishedDateEt", "recency", "windowStartDateEt", "windowEndDateEt"]) {
      assert.equal(Object.hasOwn(publicBody.articles[0], field), false, `${field} stays out of public recent-news data`);
    }
    assert.equal(requests[0]?.url, "https://app.traderslink.pro/api/news/watchlist-ai-source/PDSB?targetSessionDate=2026-09-08");
    assert.equal(requests[0]?.authorization, "Bearer test-publisher-token");
  });

  it("permits the caller to use the external fallback only after the exact no-eligible response", async () => {
    const lookup = createOfficialWatchlistArticleSourceLookup({
      env: {
        TRADERSLINK_WATCHLIST_INGEST_URL: "https://app.traderslink.pro/api/live-watchlist/ingest",
        TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN: "test-publisher-token",
      },
      fetchImpl: async () => Response.json({
        code: "no_eligible_article",
        requestedTicker: "PDSB",
        targetSessionDate: TARGET_SESSION_DATE,
      }, { status: 404 }),
    });

    const result = await lookup({ symbol: "PDSB", targetSessionDate: TARGET_SESSION_DATE });

    assert.equal(result.status, "no_eligible_article");
    assert.equal(result.research.count, 0);
  });

  it("fails closed when Platform is unavailable", async () => {
    const lookup = createOfficialWatchlistArticleSourceLookup({
      env: {
        TRADERSLINK_WATCHLIST_INGEST_URL: "https://app.traderslink.pro/api/live-watchlist/ingest",
        TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN: "test-publisher-token",
      },
      fetchImpl: async () => Response.json({ code: "news_source_unavailable" }, { status: 503 }),
    });

    const result = await lookup({ symbol: "PDSB", targetSessionDate: TARGET_SESSION_DATE });

    assert.equal(result.status, "lookup_unavailable");
    assert.equal(result.research.count, 0);
  });
});
