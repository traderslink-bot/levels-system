import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildMarketStructureLiveSmokeReport,
  formatMarketStructureLiveSmokeMarkdown,
  writeMarketStructureLiveSmokeReport,
} from "../lib/review/market-structure-live-smoke.js";

function formal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timeframe: "4h",
    bias: "bullish_transition",
    previousBias: "range",
    eventType: "bos_bullish",
    eventFreshness: "fresh",
    triggerTimestamp: "2026-06-17T14:00:00.000Z",
    confirmation: "close_confirmed",
    confidence: "medium",
    confidenceScore: 0.72,
    materialChange: true,
    brokenSwingPrice: 2,
    sweptSwingPrice: null,
    protectedHigh: 2.2,
    protectedLow: 1.9,
    latestHigh: 2.2,
    latestLow: 1.9,
    swingSequence: ["HL", "HH"],
    structureKey: "4h|bos_bullish|2.00",
    traderLine: "4h structure printed bullish BOS above 2.00.",
    debug: { candleCount: 40, reasons: [] },
    ...overrides,
  };
}

function stable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: "breakout_holding",
    previousState: "range_bound",
    structureKey: "breakout_holding|low:1.90|high:2.20",
    materialChange: true,
    confidence: "high",
    materialityScore: 0.9,
    rawState: "breakout_holding",
    reason: "high_materiality_change",
    candleCount: 40,
    ...overrides,
  };
}

function writeAudit(directory: string, rows: Record<string, unknown>[]): string {
  mkdirSync(directory, { recursive: true });
  const auditPath = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(auditPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return auditPath;
}

test("market structure live smoke passes when formal 5m stays hidden and stable 5m is visible", () => {
  const root = mkdtempSync(join(tmpdir(), "market-structure-live-smoke-"));
  const auditPath = writeAudit(join(root, "session-a"), [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "HTF",
      title: "HTF market structure update",
      marketStructureStoryVisible: true,
      marketStructureStoryKeys: [
        "4h|formal|4h|bos_bullish|2.00",
        "5m|stable|breakout_holding|low:1.90|high:2.20",
      ],
      marketStructure: {
        timeframes: {
          "4h": {
            formal: formal(),
          },
          "5m": {
            formal: formal({
              timeframe: "5m",
              confidence: "high",
              structureKey: "5m|bos_bullish|2.02",
            }),
            stable: stable(),
          },
        },
      },
    },
  ]);

  const report = buildMarketStructureLiveSmokeReport({ input: auditPath });
  const markdown = formatMarketStructureLiveSmokeMarkdown(report);

  assert.equal(report.ok, true);
  assert.equal(report.totals.visibleFormal5mStoryKeys, 0);
  assert.equal(report.totals.visibleHigherTimeframeFormalStoryKeys, 1);
  assert.equal(report.totals.visibleStable5mStoryKeys, 1);
  assert.equal(report.checks.find((item) => item.name === "tactical_formal_hidden")?.status, "pass");
  assert.match(markdown, /Overall: pass/);
});

test("market structure live smoke fails when tactical formal structure is visible", () => {
  const root = mkdtempSync(join(tmpdir(), "market-structure-live-smoke-fail-"));
  const auditPath = writeAudit(join(root, "session-a"), [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "FIVE",
      title: "FIVE market structure update",
      marketStructureStoryVisible: true,
      marketStructureStoryKeys: ["5m|formal|5m|bos_bullish|3.00"],
      marketStructure: {
        timeframes: {
          "5m": {
            formal: formal({
              timeframe: "5m",
              confidence: "high",
              brokenSwingPrice: 3,
              structureKey: "5m|bos_bullish|3.00",
            }),
          },
        },
      },
    },
  ]);

  const report = buildMarketStructureLiveSmokeReport({ input: auditPath });

  assert.equal(report.ok, false);
  assert.equal(report.totals.visibleFormal5mStoryKeys, 1);
  assert.equal(report.checks.find((item) => item.name === "tactical_formal_hidden")?.status, "fail");
});

test("market structure live smoke writer creates artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "market-structure-live-smoke-write-"));
  const auditPath = writeAudit(join(root, "session-a"), [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "HTF",
      marketStructureStoryVisible: true,
      marketStructureStoryKeys: ["4h|formal|4h|bos_bullish|2.00"],
      marketStructure: {
        timeframes: {
          "4h": {
            formal: formal(),
          },
        },
      },
    },
  ]);
  const report = buildMarketStructureLiveSmokeReport({ input: auditPath });
  const jsonPath = join(root, "out", "market-structure-live-smoke.json");
  const markdownPath = join(root, "out", "market-structure-live-smoke.md");
  writeMarketStructureLiveSmokeReport({ report, jsonPath, markdownPath });

  assert.ok(existsSync(jsonPath));
  assert.match(readFileSync(markdownPath, "utf8"), /Market Structure Live Smoke/);
});
