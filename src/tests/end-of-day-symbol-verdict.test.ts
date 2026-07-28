import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildEndOfDaySymbolVerdictReport,
  buildEndOfDaySymbolVerdictReportWithEvidence,
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
  assert.equal(report.symbols[0]?.reviewQuestions.firstPostGaveGoodMap, true);
  assert.equal(report.symbols[0]?.reviewQuestions.postedTooMuch, false);
  assert.equal(report.symbols[0]?.reviewQuestions.missedMeaningfulMove, null);

  const markdown = formatEndOfDaySymbolVerdictMarkdown(report);
  assert.match(markdown, /first post trade map: good/);
  assert.match(markdown, /practical answers:/);
  assert.match(markdown, /Run candle-backed missed meaningful move audit/);
});

test("end-of-day symbol verdict with evidence folds candle-backed audit counts into action items", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "eod-symbol-verdict-evidence-"));
  const auditPath = join(tempDir, "discord-delivery-audit.jsonl");
  writeFileSync(auditPath, [
    {
      operation: "post_alert",
      status: "posted",
      timestamp: Date.parse("2026-05-01T14:00:00.000Z"),
      sourceTimestamp: Date.parse("2026-05-01T14:00:00.000Z"),
      symbol: "MISS",
      title: "MISS breakout",
      body: "Triggered near: 1.20",
      triggerPrice: 1.2,
      messageKind: "intelligent_alert",
      eventType: "breakout",
    },
  ].map((row) => JSON.stringify(row)).join("\n"));

  const report = await buildEndOfDaySymbolVerdictReportWithEvidence({
    auditPath,
    cacheDirectoryPath: join(tempDir, "cache"),
  });

  assert.equal(report.totals.symbols, 1);
  assert.equal(report.symbols[0]?.candleEvidence?.executionRelationMissingEvidence, 1);
  assert.equal(report.symbols[0]?.candleEvidence?.firstSnapshotFullTraderMap, false);
  assert.ok((report.symbols[0]?.candleEvidence?.advancedContextMissingFacts.length ?? 0) > 0);
  assert.ok((report.symbols[0]?.candleEvidence?.providerReadinessWarnings.length ?? 0) > 0);
  assert.ok((report.symbols[0]?.evidenceExamples?.length ?? 0) > 0);
  assert.equal(report.symbols[0]?.reviewQuestions.needsCacheOrProviderWork, true);
  assert.equal(report.symbols[0]?.reviewQuestions.advancedContextTrusted, false);
  assert.ok(report.symbols[0]?.actionItems.some((item) => /Backfill missing candles/i.test(item)));
  const markdown = formatEndOfDaySymbolVerdictMarkdown(report);
  assert.match(markdown, /candle evidence:/);
  assert.match(markdown, /map\/structure\/context evidence:/);
  assert.match(markdown, /evidence examples:/);
});
