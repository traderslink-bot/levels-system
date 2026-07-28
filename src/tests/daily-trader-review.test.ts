import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildDailyTraderReviewReport,
  writeDailyTraderReview,
} from "../lib/review/daily-trader-review.js";

function writeAudit(rows: object[]): string {
  const directory = mkdtempSync(join(tmpdir(), "daily-trader-review-"));
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"));
  return path;
}

test("daily trader review flags over-budget chop and missing context", () => {
  const rows: object[] = [];
  for (let index = 0; index < 10; index += 1) {
    rows.push({
      operation: "post_alert",
      status: "posted",
      timestamp: 1000 + index * 20_000,
      symbol: "CYCU",
      title: "CYCU level touch",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
      triggerPrice: 1.01 + (index % 2) * 0.01,
      rangeBoxLabel: "active",
      acceptanceLabel: "testing",
      behaviorBudgetLabel: "boring_range",
      failedLevelOutcome: "testing",
      body: "price testing resistance near 1.02 with support 0.98",
    });
  }
  rows.push({
    operation: "post_alert",
    status: "posted",
    timestamp: 500_000,
    symbol: "CUE",
    title: "CUE resistance crossed",
    messageKind: "intelligent_alert",
    eventType: "breakout",
    triggerPrice: 35.98,
    noLevelReason: "no_resistance_above",
    body: "Resistance above: none currently surfaced",
  });

  const report = buildDailyTraderReviewReport(writeAudit(rows));
  const cycu = report.symbols.find((symbol) => symbol.symbol === "CYCU");
  const cue = report.symbols.find((symbol) => symbol.symbol === "CUE");

  assert.ok(cycu);
  assert.equal(cycu.expectedBudgetStyle, "low_volume_chop");
  assert.equal(cycu.budgetStatus, "watch");
  assert.ok(cycu.sameMinuteBurstCount > 0);
  assert.ok(cue);
  assert.equal(cue.noLevelCount, 1);
  assert.equal(report.totals.posts, 11);
});

test("daily trader review writes markdown and html gallery", () => {
  const auditPath = writeAudit([
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "AKAN",
      title: "AKAN breakout",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      triggerPrice: 40.3,
      acceptanceLabel: "accepted",
      levelImportanceLabel: "major_decision",
      whyPosted: "accepted breakout",
      body: "price is above resistance and next resistance is 47.25",
    },
  ]);
  const directory = mkdtempSync(join(tmpdir(), "daily-trader-review-out-"));
  const jsonPath = join(directory, "review.json");
  const markdownPath = join(directory, "review.md");
  const htmlPath = join(directory, "review.html");

  const report = writeDailyTraderReview({ auditPath, jsonPath, markdownPath, htmlPath });

  assert.equal(report.symbols[0]?.symbol, "AKAN");
  assert.match(readFileSync(markdownPath, "utf8"), /Daily Trader Review/);
  assert.match(readFileSync(markdownPath, "utf8"), /Best examples/);
  assert.match(readFileSync(htmlPath, "utf8"), /Daily Trader Review/);
  assert.match(readFileSync(jsonPath, "utf8"), /expectedBudgetStyle/);
});

test("daily trader review ignores delayed stock context as story late delivery", () => {
  const report = buildDailyTraderReviewReport(writeAudit([
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "AIIO",
      title: "Current price: 0.7543 (postmarket)",
      messageKind: "stock_context",
      deliveryLagMs: 240_000,
      body: "Company: Robo.ai Inc Levels are loading.",
    },
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "AIIO",
      title: "AIIO breakout",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      acceptanceLabel: "accepted",
      deliveryLagMs: 10_000,
      body: "price is above resistance and next resistance is 0.86",
    },
  ]));

  assert.equal(report.totals.latePosts, 0);
  assert.equal(report.symbols.find((symbol) => symbol.symbol === "AIIO")?.latePostCount, 0);
});

test("daily trader review excludes stock context from trader-story post budget", () => {
  const report = buildDailyTraderReviewReport(writeAudit([
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "SEGG",
      title: "Current price: 1.40",
      messageKind: "stock_context",
      body: "Company context. Levels are loading.",
    },
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 2000,
      symbol: "SEGG",
      title: "SEGG support and resistance",
      messageKind: "level_snapshot",
      triggerPrice: 1.4,
      body: "Price: 1.40 Resistance: 1.46 Support: 1.34",
    },
  ]));

  const symbol = report.symbols.find((item) => item.symbol === "SEGG");
  assert.equal(report.totals.posts, 1);
  assert.equal(symbol?.postCount, 1);
  assert.equal(symbol?.firstTitle, "SEGG support and resistance");
});
