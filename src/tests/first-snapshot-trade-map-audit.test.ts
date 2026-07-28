import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatFirstSnapshotTradeMapAudit,
  generateFirstSnapshotTradeMapAudit,
  writeFirstSnapshotTradeMapAudit,
} from "../lib/review/first-snapshot-trade-map-audit.js";

function writeAuditRows(directory: string, rows: object[]): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  return path;
}

test("first snapshot trade-map audit scores strong and weak first posts with evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "first-snapshot-audit-"));
  const auditPath = writeAuditRows(root, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 13, 30, 0),
      symbol: "GOOD",
      title: "GOOD support and resistance",
      body: [
        "Price: 1.20",
        "What price is doing now:",
        "Price is between light support 1.10 and heavy resistance 1.25.",
        "Closest levels to watch:",
        "Resistance:\n1.25 (+4.2%, heavy resistance, daily confluence)",
        "Support:\n1.10 (-8.3%, light support, fresh intraday)",
        "More support and resistance:",
        "Resistance:\n1.25\n1.40",
        "Support:\n1.10\n1.00",
        "The stock is range-bound under resistance.",
      ].join("\n"),
    },
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 13, 35, 0),
      symbol: "BAD",
      title: "BAD level map",
      body: "Price: 0.99\nRisk opens toward 0.98. Best entry is the dip.",
    },
  ]);

  const report = generateFirstSnapshotTradeMapAudit({ auditPath });
  const markdown = formatFirstSnapshotTradeMapAudit(report);

  assert.equal(report.totals.symbols, 2);
  assert.equal(report.totals.fullTraderMapCount, 1);
  assert.equal(report.totals.lineByLineLevelCount, 1);
  assert.equal(report.totals.advisoryRiskCount, 1);
  assert.equal(report.symbols.find((symbol) => symbol.symbol === "GOOD")?.score.label, "strong");
  assert.equal(report.symbols.find((symbol) => symbol.symbol === "GOOD")?.mapChecks.hasSupportStrength, true);
  assert.equal(report.symbols.find((symbol) => symbol.symbol === "BAD")?.score.label, "weak");
  assert.equal(report.symbols.find((symbol) => symbol.symbol === "BAD")?.mapChecks.hasAdvisoryLanguage, true);
  assert.match(markdown, /BAD - weak/);
  assert.match(markdown, /too advisory/);
  assert.match(markdown, /map checks:/);
});

test("first snapshot audit flags ladder-only snapshots that lack a practical trader map", () => {
  const root = mkdtempSync(join(tmpdir(), "first-snapshot-ladder-only-"));
  const auditPath = writeAuditRows(root, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 13, 30, 0),
      symbol: "LADR",
      title: "LADR support and resistance",
      body: [
        "Price: 1.20",
        "Closest levels to watch:",
        "Resistance:\n1.25 (+4.2%, heavy resistance, daily confluence)",
        "Support:\n1.10 (-8.3%, light support, fresh intraday)",
        "More support and resistance:",
        "Resistance:\n1.25\n1.40",
        "Support:\n1.10\n1.00",
      ].join("\n"),
    },
  ]);

  const report = generateFirstSnapshotTradeMapAudit({ auditPath });
  const symbol = report.symbols[0]!;

  assert.equal(symbol.symbol, "LADR");
  assert.notEqual(symbol.score.label, "strong");
  assert.equal(symbol.mapChecks.hasRoomOrRangeContext, false);
  assert.ok(symbol.score.issues.includes("missing: practical trade-map lines beyond the raw ladder"));
});

test("first snapshot trade-map writer creates JSON and markdown artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "first-snapshot-write-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 13, 30, 0),
      symbol: "WRITE",
      title: "WRITE support and resistance",
      body: "Price: 1.20\nWhat price is doing now:\nPrice is between support 1.10 and resistance 1.25.",
    },
  ]);

  const report = writeFirstSnapshotTradeMapAudit({
    auditPath,
    jsonPath: join(root, "out", "report.json"),
    markdownPath: join(root, "out", "report.md"),
  });

  assert.equal(report.totals.symbols, 1);
  assert.equal(JSON.parse(readFileSync(join(root, "out", "report.json"), "utf8")).totals.symbols, 1);
  assert.match(readFileSync(join(root, "out", "report.md"), "utf8"), /First Snapshot Trade Map Audit/);
});
