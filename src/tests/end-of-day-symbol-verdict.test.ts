import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildEndOfDaySymbolVerdictReport,
  formatEndOfDaySymbolVerdictMarkdown,
} from "../lib/review/end-of-day-symbol-verdict.js";

test("end-of-day symbol verdict answers the practical review questions", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "eod-symbol-verdict-"));
  const auditPath = join(tempDir, "discord-delivery-audit.jsonl");
  const rows = [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1,
      symbol: "CYCU",
      title: "CYCU support and resistance",
      body: [
        "Trade map:",
        "Current structure: CYCU is range-bound between support 1.00 and resistance 1.06.",
        "Support that matters: support 1.00 is the first practical area buyers need to keep defending.",
        "Closest levels to watch:",
        "Resistance:",
        "1.06 (+6.0%)",
        "",
        "Support:",
        "1.00 (-1.0%)",
      ].join("\n"),
      messageKind: "snapshot",
      whyPosted: "level snapshot posted after candle seeding",
    },
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 2,
      symbol: "CYCU",
      title: "CYCU resistance crossed",
      body: "price pushed above 1.06; nearby resistance above is 1.12",
      messageKind: "level_clear_update",
      eventType: "breakout",
      whyPosted: "new resistance level crossed",
      acceptanceLabel: "accepted",
      levelImportanceLabel: "major_decision",
    },
  ];
  writeFileSync(auditPath, rows.map((row) => JSON.stringify(row)).join("\n"));

  const report = buildEndOfDaySymbolVerdictReport(auditPath);

  assert.equal(report.totals.symbols, 1);
  assert.equal(report.symbols[0]?.symbol, "CYCU");
  assert.equal(report.symbols[0]?.firstPostTradeMap.verdict, "good");
  assert.equal(report.symbols[0]?.postVolume.verdict, "good");
  assert.equal(report.symbols[0]?.levelCompleteness.verdict, "good");
  assert.equal(report.symbols[0]?.missedMeaningfulMove.verdict, "needs_candle_audit");

  const markdown = formatEndOfDaySymbolVerdictMarkdown(report);
  assert.match(markdown, /first post trade map: good/);
  assert.match(markdown, /Run candle-backed missed meaningful move audit/);
});
