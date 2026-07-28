import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildThreadHealthScoreReport } from "../lib/review/thread-health-score.js";

function writeRows(rows: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "thread-health-"));
  const path = join(dir, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"));
  return path;
}

test("thread health score flags repeated weak probes and delivery failures", () => {
  const auditPath = writeRows([
    {
      operation: "post_alert",
      status: "posted",
      symbol: "CYCU",
      timestamp: 1,
      title: "CYCU resistance crossed",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      acceptanceLabel: "weak_probe",
      failedLevelOutcome: "probe_only",
      body: "price is testing resistance",
    },
    {
      operation: "post_alert",
      status: "posted",
      symbol: "CYCU",
      timestamp: 2,
      title: "CYCU resistance crossed",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      acceptanceLabel: "weak_probe",
      failedLevelOutcome: "probe_only",
      body: "price is testing resistance again",
    },
    {
      operation: "post_alert",
      status: "failed",
      symbol: "CYCU",
      timestamp: 3,
      title: "CYCU breakout",
      error: "Discord failed",
    },
  ]);

  const report = buildThreadHealthScoreReport(auditPath);
  assert.equal(report.symbols[0]?.symbol, "CYCU");
  assert.equal(report.symbols[0]?.label, "broken");
  assert.equal(report.symbols[0]?.failedDeliveryCount, 1);
  assert.equal(report.symbols[0]?.repeatedStoryCount, 1);
});

test("thread health score leaves clean quiet threads healthy", () => {
  const auditPath = writeRows([
    {
      operation: "post_alert",
      status: "posted",
      symbol: "CLEAN",
      timestamp: 1,
      title: "CLEAN breakout",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      acceptanceLabel: "accepted",
      body: "price is above resistance for now",
    },
  ]);

  const report = buildThreadHealthScoreReport(auditPath);
  assert.equal(report.symbols[0]?.label, "healthy");
});

