import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildVisualAuditReplayReport,
  formatVisualAuditReplayHtml,
} from "../lib/review/visual-audit-replay.js";

test("visual audit replay builds an HTML timeline from saved Discord audit rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-replay-"));
  const auditPath = join(dir, "discord-delivery-audit.jsonl");
  writeFileSync(auditPath, [
    JSON.stringify({
      operation: "post_alert",
      status: "success",
      timestamp: Date.UTC(2026, 4, 1, 13, 30),
      symbol: "AKAN",
      title: "AKAN breakout",
      body: "Triggered near: 40.30",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      acceptanceLabel: "accepted",
      rangeBoxLabel: "wide",
      behaviorBudgetLabel: "active_runner",
    }),
    JSON.stringify({
      operation: "post_alert",
      status: "success",
      timestamp: Date.UTC(2026, 4, 1, 13, 35),
      symbol: "AKAN",
      title: "AKAN support test",
      body: "Triggered near: 42.00",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
    }),
  ].join("\n"));

  const report = buildVisualAuditReplayReport(auditPath);
  const html = formatVisualAuditReplayHtml(report);

  assert.equal(report.symbols.length, 1);
  assert.equal(report.symbols[0]!.postCount, 2);
  assert.equal(report.symbols[0]!.priceLow, 40.3);
  assert.equal(report.symbols[0]!.priceHigh, 42);
  assert.match(html, /Visual Audit Replay/);
  assert.match(html, /AKAN breakout/);
  assert.match(html, /acceptance: accepted/);
});
