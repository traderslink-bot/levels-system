import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildTradeLifecycleSummaryReport } from "../lib/review/trade-lifecycle-summary.js";

function writeRows(rows: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "trade-lifecycle-"));
  const path = join(dir, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"));
  return path;
}

test("trade lifecycle summary identifies range-bound and breakout-working threads", () => {
  const auditPath = writeRows([
    {
      operation: "post_alert",
      status: "posted",
      symbol: "BOX",
      timestamp: 1,
      eventType: "level_touch",
      tradeStoryState: "building",
      behaviorBudgetLabel: "boring_range",
      title: "BOX support and resistance",
      body: "Price: 1.03 Main support: moderate support 1.00. Main resistance: major resistance 1.08.",
    },
    {
      operation: "post_alert",
      status: "posted",
      symbol: "RUN",
      timestamp: 2,
      eventType: "breakout",
      tradeStoryState: "breakout_accepted",
      behaviorBudgetLabel: "active_runner",
      triggerPrice: 5.25,
      title: "RUN breakout",
      body: "Main resistance: major resistance 5.00. Price is above resistance for now.",
    },
  ]);

  const report = buildTradeLifecycleSummaryReport(auditPath);
  const box = report.symbols.find((symbol) => symbol.symbol === "BOX");
  const run = report.symbols.find((symbol) => symbol.symbol === "RUN");

  assert.equal(box?.finalState, "range_bound");
  assert.equal(run?.finalState, "breakout_working");
  assert.match(run?.recap.join(" ") ?? "", /breakout working/);
});

