import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPostReasonAuditReportFromRows,
  renderPostReasonAuditMarkdown,
} from "../lib/review/post-reason-audit-report.js";

test("post reason audit report summarizes operator-only whyPosted evidence", () => {
  const report = buildPostReasonAuditReportFromRows([
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1,
      symbol: "AKAN",
      title: "AKAN breakout",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      whyPosted: "event passed breakout policy",
      postBudgetSymbolType: "higher_priced_runner",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2,
      symbol: "CUE",
      title: "CUE resistance crossed",
      messageKind: "level_clear_update",
      eventType: "breakout",
      noLevelReason: "higher resistance not available in active snapshot or extension cache",
    },
  ], "inline");

  assert.equal(report.totals.postedRows, 2);
  assert.equal(report.totals.rowsWithWhyPosted, 1);
  assert.equal(report.totals.rowsWithoutWhyPosted, 1);
  assert.equal(report.totals.rowsWithNoLevelReason, 1);
  assert.equal(report.reasons[0]?.reason, "event passed breakout policy");
  assert.equal(report.symbols.find((symbol) => symbol.symbol === "AKAN")?.postBudgetSymbolTypes.higher_priced_runner, 1);

  const markdown = renderPostReasonAuditMarkdown(report);
  assert.match(markdown, /Post Reason Audit Report/);
  assert.match(markdown, /No-Level Examples/);
  assert.match(markdown, /higher resistance not available/);
});
