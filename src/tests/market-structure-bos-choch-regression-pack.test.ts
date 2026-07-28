import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getMaterialMarketStructureStoryKeys } from "../lib/monitoring/market-structure-story-memory.js";
import type { RuntimeMarketStructureSnapshot } from "../lib/monitoring/monitoring-types.js";
import { buildIbkrSmallCapReadinessReport } from "../lib/review/ibkr-small-cap-readiness-report.js";
import { buildFormalMarketStructureGateAuditReport } from "../lib/review/formal-market-structure-gate-audit.js";
import { buildFormalMarketStructureGateCalibrationReport } from "../lib/review/formal-market-structure-gate-calibration.js";
import { buildMarketStructureLiveSmokeReport } from "../lib/review/market-structure-live-smoke.js";

function formal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timeframe: "5m",
    bias: "bullish_transition",
    previousBias: "range",
    eventType: "bos_bullish",
    eventFreshness: "fresh",
    triggerTimestamp: "2026-06-19T14:00:00.000Z",
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
    structureKey: "5m|bos_bullish|2.00",
    traderLine: "5m structure printed bullish BOS above 2.00.",
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

function writeSession(root: string, name: string, rows: Record<string, unknown>[]): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  const auditPath = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(auditPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return auditPath;
}

function postedStructureRow(params: {
  timestamp: number;
  symbol: string;
  title: string;
  storyKeys: string[];
  marketStructure: RuntimeMarketStructureSnapshot;
  referencePrice?: number;
}): Record<string, unknown> {
  return {
    type: "discord_delivery_audit",
    operation: "post_alert",
    status: "posted",
    timestamp: params.timestamp,
    symbol: params.symbol,
    title: params.title,
    marketStructureStoryVisible: params.storyKeys.length > 0,
    marketStructureStoryKeys: params.storyKeys,
    marketStructure: params.marketStructure,
    snapshotAudit: {
      referencePrice: params.referencePrice ?? 2,
    },
  };
}

function priceRow(timestamp: number, symbol: string, referencePrice: number): Record<string, unknown> {
  return {
    type: "discord_delivery_audit",
    operation: "post_alert",
    status: "posted",
    timestamp,
    symbol,
    title: `${symbol} follow-through`,
    snapshotAudit: {
      referencePrice,
    },
  };
}

test("BOS/CHOCH regression pack keeps tactical 5m formal metadata-only while stable 5m can surface", () => {
  const snapshot: RuntimeMarketStructureSnapshot = {
    timeframes: {
      "5m": {
        formal: formal({
          confidence: "high",
          structureKey: "5m|bos_bullish|2.00",
        }) as any,
        stable: stable() as any,
      },
    },
  };

  const keys = getMaterialMarketStructureStoryKeys(snapshot);

  assert.deepEqual(keys, ["5m|stable|breakout_holding|low:1.90|high:2.20"]);
});

test("BOS/CHOCH regression pack allows higher-timeframe formal keys and still carries stable 5m separately", () => {
  const snapshot: RuntimeMarketStructureSnapshot = {
    timeframes: {
      "4h": {
        formal: formal({
          timeframe: "4h",
          structureKey: "4h|bos_bullish|2.00",
        }) as any,
      },
      "5m": {
        formal: formal({
          confidence: "high",
          structureKey: "5m|choch_bullish|2.05",
          eventType: "choch_bullish",
        }) as any,
        stable: stable({
          structureKey: "reclaim_confirmed|low:1.95|high:2.25",
          state: "reclaim_confirmed",
        }) as any,
      },
    },
  };

  const keys = getMaterialMarketStructureStoryKeys(snapshot);

  assert.deepEqual(keys, [
    "4h|formal|4h|bos_bullish|2.00",
    "5m|stable|reclaim_confirmed|low:1.95|high:2.25",
  ]);
});

test("BOS/CHOCH regression pack calibrates noisy tactical 5m as metadata-only and HTF formal as actionable", () => {
  const root = mkdtempSync(join(tmpdir(), "bos-choch-regression-"));
  const tacticalAuditPath = writeSession(root, "tactical-5m", [
    postedStructureRow({
      timestamp: 1_000,
      symbol: "NOISY",
      title: "NOISY tactical structure",
      storyKeys: ["5m|formal|5m|bos_bullish|2.00"],
      referencePrice: 2,
      marketStructure: {
        timeframes: {
          "5m": {
            formal: formal({
              confidence: "high",
              structureKey: "5m|bos_bullish|2.00",
            }) as any,
            stable: stable() as any,
          },
        },
      },
    }),
    priceRow(2_000, "NOISY", 1.94),
  ]);
  writeSession(root, "higher-timeframe", [
    postedStructureRow({
      timestamp: 1_000,
      symbol: "HTF",
      title: "HTF formal structure",
      storyKeys: ["4h|formal|4h|bos_bullish|2.00"],
      referencePrice: 2,
      marketStructure: {
        timeframes: {
          "4h": {
            formal: formal({
              timeframe: "4h",
              structureKey: "4h|bos_bullish|2.00",
            }) as any,
          },
        },
      },
    }),
    priceRow(2_000, "HTF", 2.08),
  ]);

  const gateAudit = buildFormalMarketStructureGateAuditReport(tacticalAuditPath);
  const tacticalEvent = gateAudit.events.find((event) => event.symbol === "NOISY");
  const calibration = buildFormalMarketStructureGateCalibrationReport({
    sourceRoot: root,
    limit: null,
    forwardWindowMinutes: 90,
  });

  assert.equal(tacticalEvent?.decision, "metadata_only");
  assert.equal(tacticalEvent?.gateReason, "tactical_5m_metadata_only");
  assert.equal(tacticalEvent?.gateChecks.stableSupportsDirection, true);
  assert.equal(calibration.totals.formalBosChochEvents, 2);
  assert.equal(calibration.totals.actionable, 1);
  assert.equal(calibration.totals.metadataOnly, 1);
  assert.equal(calibration.byReason.find((row) => row.key === "tactical_5m_metadata_only")?.failed, 1);
  assert.equal(calibration.byReason.find((row) => row.key === "higher_timeframe_formal")?.continued, 1);
});

test("BOS/CHOCH regression pack fails smoke when a saved audit exposes tactical 5m formal story keys", () => {
  const root = mkdtempSync(join(tmpdir(), "bos-choch-smoke-leak-"));
  const auditPath = writeSession(root, "leaked-5m-formal", [
    postedStructureRow({
      timestamp: 1_000,
      symbol: "LEAK",
      title: "LEAK tactical formal structure",
      storyKeys: ["5m|formal|5m|choch_bearish|1.80"],
      referencePrice: 1.8,
      marketStructure: {
        timeframes: {
          "5m": {
            formal: formal({
              bias: "bearish_transition",
              eventType: "choch_bearish",
              confidence: "high",
              brokenSwingPrice: 1.8,
              structureKey: "5m|choch_bearish|1.80",
            }) as any,
          },
        },
      },
    }),
  ]);

  const smoke = buildMarketStructureLiveSmokeReport({ input: auditPath });

  assert.equal(smoke.ok, false);
  assert.equal(smoke.totals.visibleFormal5mStoryKeys, 1);
  assert.equal(smoke.checks.find((item) => item.name === "tactical_formal_hidden")?.status, "fail");
});

test("BOS/CHOCH regression pack reports provider readiness separately from structure decisions", () => {
  const report = buildIbkrSmallCapReadinessReport({
    timeframe: "5m",
    requestedLookbackBars: 50,
    minimumReadyBars: 50,
    timeoutMs: 25_000,
    generatedAt: "2026-06-19T21:30:00.000Z",
    probes: [
      {
        symbol: "BIYA",
        timeframe: "5m",
        status: "completed",
        barsReceived: 192,
        firstBar: null,
        lastBar: null,
        durationMs: 600,
        details: { event: "historicalData finished marker" },
      },
      {
        symbol: "MISS",
        timeframe: "5m",
        status: "timeout",
        barsReceived: 0,
        firstBar: null,
        lastBar: null,
        durationMs: 25_000,
        details: { timeoutMs: 25_000 },
      },
    ],
  });

  assert.equal(report.totals.ready, 1);
  assert.equal(report.totals.providerUnavailable, 1);
  assert.equal(report.symbols.find((row) => row.symbol === "MISS")?.readiness, "provider_unavailable");
  assert.match(
    report.symbols.find((row) => row.symbol === "MISS")?.reason ?? "",
    /IBKR timeout/i,
  );
});

