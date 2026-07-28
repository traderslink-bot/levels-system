import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCandleImportSafetyReport,
  formatCandleImportSafetyReport,
} from "../lib/review/candle-import-safety-report.js";

function writeAuditRows(sessionDirectory: string, rows: object[]): void {
  mkdirSync(sessionDirectory, { recursive: true });
  writeFileSync(
    join(sessionDirectory, "discord-delivery-audit.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n"),
    "utf8",
  );
}

test("candle import safety report makes provider pressure and dedupe explicit", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-import-safety-"));
  const sessionDirectory = join(root, "session");
  const asOfTimestamp = Date.UTC(2026, 4, 1, 14, 0, 0);
  writeAuditRows(sessionDirectory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: asOfTimestamp,
      symbol: "SAFE",
    },
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: asOfTimestamp + 60_000,
      symbol: "SAFE",
    },
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: asOfTimestamp,
      symbol: "GAP",
    },
  ]);

  const report = await buildCandleImportSafetyReport({
    auditPath: sessionDirectory,
    warehouseDirectoryPath: join(root, "warehouse"),
    timeframes: ["5m", "1m"],
  });

  assert.equal(report.totals.tradeProxies, 2);
  assert.ok(report.totals.naiveProviderTasks >= report.totals.plannedProviderTasks);
  assert.ok(report.totals.missingTasks > 0);
  assert.ok(["safe_to_plan", "provider_pressure_watch", "warehouse_gap"].includes(report.verdict));
  assert.ok(report.symbolSessionCoverage.some((item) => item.symbol === "SAFE" && item.status === "missing"));
  assert.match(formatCandleImportSafetyReport(report), /avoided provider tasks/i);
  assert.match(formatCandleImportSafetyReport(report), /Symbol \/ Session Coverage/i);
});
