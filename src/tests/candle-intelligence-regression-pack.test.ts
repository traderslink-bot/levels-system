import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateCandleIntelligenceRegressionPack,
  writeCandleIntelligenceRegressionPack,
} from "../lib/review/candle-intelligence-regression-pack.js";

const START = Date.parse("2026-05-01T13:30:00.000Z");

function writeAuditRows(directory: string, rows: object[]): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  return path;
}

test("candle intelligence regression pack promotes weak snapshots and missing evidence into cases", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-regression-pack-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: START,
      symbol: "WEAK",
      title: "WEAK support and resistance",
      body: "Price: 1.00",
    },
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: START + 60_000,
      symbol: "MISS",
      title: "MISS breakout",
      triggerPrice: 1.2,
    },
  ]);

  const pack = await generateCandleIntelligenceRegressionPack({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    maxCasesPerType: 5,
  });

  assert.ok(pack.totals.cases >= 2);
  assert.ok(pack.cases.some((item) => item.type === "weak_first_snapshot"));
  assert.ok(pack.cases.some((item) => item.type === "execution_relation_missing_evidence"));
});

test("candle intelligence regression pack writer creates JSON and markdown artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-regression-pack-write-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: START,
      symbol: "MISS",
      title: "MISS breakout",
      triggerPrice: 1.2,
    },
  ]);

  const pack = await writeCandleIntelligenceRegressionPack({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    jsonPath: join(root, "out", "pack.json"),
    markdownPath: join(root, "out", "pack.md"),
  });

  assert.ok(pack.totals.cases >= 1);
  assert.ok(existsSync(join(root, "out", "pack.json")));
  assert.match(readFileSync(join(root, "out", "pack.md"), "utf8"), /Candle Intelligence Regression Pack/);
});
