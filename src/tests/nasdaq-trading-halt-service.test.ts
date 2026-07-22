import assert from "node:assert/strict";
import test from "node:test";

import {
  NasdaqTradingHaltService,
  parseNasdaqTradingHaltRss,
} from "../lib/auto-watchlist/nasdaq-trading-halt-service.js";

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:ndaq="http://www.nasdaqtrader.com/">
  <channel>
    <item>
      <ndaq:HaltDate>07/20/2026</ndaq:HaltDate>
      <ndaq:HaltTime>15:25:20.970</ndaq:HaltTime>
      <ndaq:IssueSymbol>ZYBT</ndaq:IssueSymbol>
      <ndaq:ReasonCode>LUDP</ndaq:ReasonCode>
      <ndaq:ResumptionDate>07/20/2026</ndaq:ResumptionDate>
      <ndaq:ResumptionQuoteTime>15:25:20</ndaq:ResumptionQuoteTime>
      <ndaq:ResumptionTradeTime />
    </item>
    <item>
      <ndaq:HaltDate>07/20/2026</ndaq:HaltDate>
      <ndaq:HaltTime>15:15:04.936</ndaq:HaltTime>
      <ndaq:IssueSymbol>ZYBT</ndaq:IssueSymbol>
      <ndaq:ReasonCode>LUDP</ndaq:ReasonCode>
      <ndaq:ResumptionDate>07/20/2026</ndaq:ResumptionDate>
      <ndaq:ResumptionQuoteTime>15:15:04</ndaq:ResumptionQuoteTime>
      <ndaq:ResumptionTradeTime>15:25:05</ndaq:ResumptionTradeTime>
    </item>
    <item>
      <ndaq:HaltDate>07/20/2026</ndaq:HaltDate>
      <ndaq:HaltTime>15:23:58.186</ndaq:HaltTime>
      <ndaq:IssueSymbol>ADVB</ndaq:IssueSymbol>
      <ndaq:ReasonCode>LUDP</ndaq:ReasonCode>
      <ndaq:ResumptionTradeTime>15:28:58</ndaq:ResumptionTradeTime>
    </item>
  </channel>
</rss>`;

test("Nasdaq halt RSS parser keeps the latest halt event per symbol", () => {
  const records = parseNasdaqTradingHaltRss(RSS);
  assert.equal(records.get("ZYBT")?.state, "halted");
  assert.equal(records.get("ZYBT")?.haltTime, "15:25:20.970");
  assert.equal(records.get("ZYBT")?.reasonCode, "LUDP");
  assert.equal(records.get("ADVB")?.state, "resumed");
  assert.equal(records.get("ADVB")?.resumptionTradeTime, "15:28:58");
});

test("Nasdaq halt service caches the free feed for one minute and keeps a stale snapshot on refresh failure", async () => {
  let fetchCount = 0;
  const service = new NasdaqTradingHaltService({
    cacheTtlMs: 60_000,
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount > 1) throw new Error("temporary feed failure");
      return new Response(RSS, { status: 200, headers: { "Content-Type": "text/xml" } });
    },
  });
  const first = await service.lookup({ symbols: ["ZYBT", "NONE"], now: 1_000_000 });
  const cached = await service.lookup({ symbols: ["ZYBT"], now: 1_030_000 });
  const staleFallback = await service.lookup({ symbols: ["ZYBT"], now: 1_061_000 });

  assert.equal(fetchCount, 2);
  assert.equal(first.bySymbol.ZYBT?.state, "halted");
  assert.equal(first.bySymbol.NONE?.state, "not_found");
  assert.equal(cached.bySymbol.ZYBT?.state, "halted");
  assert.equal(staleFallback.available, true);
  assert.equal(staleFallback.bySymbol.ZYBT?.state, "halted");
  assert.match(staleFallback.error ?? "", /temporary feed failure/);
});
