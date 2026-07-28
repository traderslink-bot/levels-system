import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildThreadEndRecapReport,
  formatThreadEndRecapMarkdown,
} from "../lib/review/thread-end-recap.js";

function row(value: Record<string, unknown>): string {
  return JSON.stringify({
    operation: "post_alert",
    status: "success",
    timestamp: 1,
    symbol: "CYCU",
    messageKind: "intelligent_alert",
    ...value,
  });
}

test("thread end recap summarizes post families, weak probes, and range-box evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "thread-recap-"));
  const auditPath = join(dir, "discord-delivery-audit.jsonl");
  writeFileSync(auditPath, [
    row({
      timestamp: 10,
      title: "CYCU support and resistance",
      body: "Price: 1.03\nSupport 1.01\nResistance 1.08",
      messageKind: "level_snapshot",
      eventType: "snapshot",
    }),
    row({
      timestamp: 20,
      title: "CYCU breakout",
      body: "price is only slightly above resistance",
      eventType: "breakout",
      tradeStoryState: "breakout_attempt",
      rangeBoxLabel: "active",
      acceptanceLabel: "weak_probe",
      behaviorBudgetLabel: "boring_range",
    }),
  ].join("\n"));

  const report = buildThreadEndRecapReport(auditPath);

  assert.equal(report.symbols.length, 1);
  assert.equal(report.symbols[0]!.symbol, "CYCU");
  assert.equal(report.symbols[0]!.postCount, 2);
  assert.equal(report.symbols[0]!.rangeBoxPosts, 1);
  assert.equal(report.symbols[0]!.weakProbePosts, 1);
  assert.match(formatThreadEndRecapMarkdown(report), /weak probes\/testing reads/);
});
