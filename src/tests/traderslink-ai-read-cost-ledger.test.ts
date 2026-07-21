import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { TradersLinkAiReadCostLedger } from "../lib/ai/traderslink-ai-read-cost-ledger.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";

function read(symbol: string, generatedAt: number, totalCostUsd: number): TradersLinkAiReadPayload {
  return {
    version: 2,
    generationId: `${symbol}-${generatedAt}`,
    symbol,
    generatedAt,
    dataAsOf: generatedAt - 1_000,
    currentPrice: 1,
    marketSession: "regular",
    bias: "neutral",
    confidence: "medium",
    currentRead: "Test read.",
    needsToHold: { label: "Hold", price: 0.9, rationale: "Test." },
    cautionBelow: { label: "Caution", price: 0.85, rationale: "Test." },
    momentumFailure: { label: "Failure", price: 0.8, rationale: "Test." },
    mustClear: { label: "Clear", price: 1.1, rationale: "Test." },
    breakoutContinuation: { label: "Continue", price: 1.2, rationale: "Test." },
    targets: [],
    downsideCheckpoints: [],
    catalystRealityCheck: {
      status: "none",
      summary: "None.",
      dayTradeRelevance: "None.",
      sourceUrls: [],
    },
    dilutionRisk: {
      level: "unknown",
      summary: "Unknown.",
      dayTradeRelevance: "Unknown.",
      sourceUrls: [],
      canCompanyIssueToday: null,
      companyIssuance: {
        status: "unknown",
        earliestDate: null,
        trigger: "unknown",
        summary: "Unknown.",
      },
      publicResale: {
        status: "unknown",
        earliestDate: null,
        trigger: "unknown",
        summary: "Unknown.",
      },
    },
    listingStatus: {
      status: "none",
      immediacy: "background",
      summary: "None.",
      dayTradeRelevance: "None.",
      sourceUrls: [],
    },
    riskSummary: [],
    sources: [],
    model: "gpt-5.6-terra",
    externalResearchEnabled: true,
    usedWebSearch: true,
    usage: {
      inputTokens: 1_000,
      cachedInputTokens: 100,
      outputTokens: 200,
      totalTokens: 1_200,
      webSearchCallCount: 1,
      tokenCostUsd: totalCostUsd - 0.01,
      webSearchCostUsd: 0.01,
      estimatedTotalCostUsd: totalCostUsd,
      pricing: {
        source: "built_in",
        inputPer1M: 2.5,
        cachedInputPer1M: 0.25,
        outputPer1M: 15,
        webSearchPer1KCalls: 10,
      },
    },
  };
}

describe("TradersLinkAiReadCostLedger", () => {
  it("tracks combined, per-ticker, trigger, model, and time-window expense estimates", () => {
    const directory = mkdtempSync(join(tmpdir(), "traderslink-ai-cost-"));
    try {
      const ledger = new TradersLinkAiReadCostLedger({ filePath: join(directory, "costs.jsonl") });
      const now = Date.parse("2026-07-17T18:00:00.000Z");
      ledger.record({ read: read("TGHL", now - 60_000, 0.025), trigger: "manual" });
      ledger.record({ read: read("TGHL", now - 2 * 60_000, 0.02), trigger: "price_move" });
      ledger.record({ read: read("BIYA", now - 10 * 24 * 60 * 60_000, 0.03), trigger: "activation" });

      const summary = ledger.summarize(now);
      assert.equal(summary.windows.today.requestCount, 2);
      assert.equal(summary.windows.last7Days.estimatedTotalCostUsd, 0.045);
      assert.equal(summary.windows.allTime.estimatedTotalCostUsd, 0.075);
      assert.equal(summary.windows.allTime.webSearchCallCount, 3);
      assert.deepEqual(summary.todayPerTicker.map((ticker) => ticker.symbol), ["TGHL"]);
      assert.equal(summary.todayPerTicker[0]?.requestCount, 2);
      assert.equal(summary.todayPerTicker[0]?.estimatedTotalCostUsd, 0.045);
      assert.equal(summary.perTicker[0]?.symbol, "TGHL");
      assert.equal(summary.perTicker[0]?.requestCount, 2);
      assert.equal(summary.perTicker[0]?.planGenerationCount, 2);
      assert.equal(summary.perTicker[0]?.averageCostPerRequestUsd, 0.0225);
      assert.equal(summary.byTrigger.find((item) => item.trigger === "manual")?.totals.requestCount, 1);
      assert.equal(summary.byModel[0]?.model, "gpt-5.6-terra");
      assert.deepEqual(summary.accountingHealth, {
        healthy: true,
        corruptLineCount: 0,
        lastLoadError: null,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves valid totals but reports corrupt ledger lines as incomplete accounting", () => {
    const directory = mkdtempSync(join(tmpdir(), "traderslink-ai-cost-corrupt-"));
    try {
      const filePath = join(directory, "costs.jsonl");
      const ledger = new TradersLinkAiReadCostLedger({ filePath });
      const now = Date.parse("2026-07-17T18:00:00.000Z");
      ledger.record({ read: read("TGHL", now - 60_000, 0.025), trigger: "manual" });
      appendFileSync(filePath, "{not-json}\n{\"version\":99}\n", "utf8");

      const summary = ledger.summarize(now);
      assert.equal(summary.windows.allTime.requestCount, 1);
      assert.equal(summary.windows.allTime.estimatedTotalCostUsd, 0.025);
      assert.equal(summary.accountingHealth.healthy, false);
      assert.equal(summary.accountingHealth.corruptLineCount, 2);
      assert.match(summary.accountingHealth.lastLoadError ?? "", /2 malformed or unsupported/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("throws when an attempt cannot be durably appended", () => {
    const directory = mkdtempSync(join(tmpdir(), "traderslink-ai-cost-write-"));
    try {
      const ledger = new TradersLinkAiReadCostLedger({ filePath: directory });
      const now = Date.parse("2026-07-17T18:00:00.000Z");
      assert.throws(
        () => ledger.record({ read: read("TGHL", now, 0.025), trigger: "manual" }),
        /EISDIR|illegal operation on a directory/i,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses a recent-request reserve to stop new reads before an enabled daily budget is exhausted", () => {
    const directory = mkdtempSync(join(tmpdir(), "traderslink-ai-cost-budget-"));
    try {
      const ledger = new TradersLinkAiReadCostLedger({ filePath: join(directory, "costs.jsonl") });
      const now = Date.parse("2026-07-17T18:00:00.000Z");
      ledger.record({ read: read("TGHL", now - 60_000, 0.025), trigger: "manual" });
      ledger.record({ read: read("BIYA", now - 2 * 60_000, 0.02), trigger: "activation" });
      const load = ledger.load.bind(ledger);
      let loadCount = 0;
      ledger.load = () => {
        loadCount += 1;
        return load();
      };

      const allowed = ledger.getDailyCostBudgetStatus({
        enabled: true,
        dailyLimitUsd: 0.1,
        now,
      });
      assert.equal(allowed.spentUsd, 0.045);
      assert.equal(allowed.projectedNextRequestUsd, 0.0225);
      assert.equal(allowed.canStartRequest, true);
      assert.equal(loadCount, 1);

      const blocked = ledger.getDailyCostBudgetStatus({
        enabled: true,
        dailyLimitUsd: 0.05,
        now,
      });
      assert.equal(blocked.canStartRequest, false);
      assert.match(blocked.blockReason ?? "", /reserve/i);
      assert.equal(loadCount, 2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
