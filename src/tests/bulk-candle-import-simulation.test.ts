import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildBulkCandleImportSimulationReport,
  writeBulkCandleImportSimulationReport,
} from "../lib/review/bulk-candle-import-simulation.js";

test("bulk candle import simulation shows provider task savings from symbol/session dedupe", async () => {
  const root = mkdtempSync(join(tmpdir(), "bulk-import-sim-"));
  const report = await buildBulkCandleImportSimulationReport({
    warehouseDirectoryPath: join(root, "warehouse"),
    symbolCount: 2,
    sessionCount: 3,
    tradesPerSymbolSession: 4,
    timeframes: ["1m", "5m"],
    startSessionDate: "2026-05-01",
  });

  assert.equal(report.totals.generatedTradeRows, 24);
  assert.equal(report.totals.naiveProviderTasks, 48);
  assert.equal(report.totals.dedupedProviderTasks, 12);
  assert.equal(report.totals.avoidedProviderTasks, 36);
  assert.equal(report.totals.plannedWarehouseTasks, 12);
  assert.equal(report.totals.missingWarehouseTasks, 12);
  assert.ok(report.plan.tasks.every((task) => task.lookbackBars > 0));
});

test("bulk candle import simulation writer creates JSON and markdown reports", async () => {
  const root = mkdtempSync(join(tmpdir(), "bulk-import-sim-write-"));
  const report = await writeBulkCandleImportSimulationReport({
    warehouseDirectoryPath: join(root, "warehouse"),
    symbolCount: 1,
    sessionCount: 1,
    tradesPerSymbolSession: 2,
    timeframes: ["1m"],
    jsonPath: join(root, "out", "report.json"),
    markdownPath: join(root, "out", "report.md"),
  });

  assert.equal(report.totals.generatedTradeRows, 2);
  assert.ok(existsSync(join(root, "out", "report.json")));
  assert.match(readFileSync(join(root, "out", "report.md"), "utf8"), /Bulk Candle Import Simulation/);
});
