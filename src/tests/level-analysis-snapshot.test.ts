import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelAnalysisSnapshot,
  type LevelAnalysisSnapshot,
} from "../lib/analysis/level-analysis-snapshot.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import type { MarketContextProfile } from "../lib/market-context/index.js";
import type { SessionMarketFacts } from "../lib/session/index.js";
import type { VolumeMarketFacts, VolumeShelf } from "../lib/volume/index.js";

const AS_OF = Date.parse("2026-05-01T10:30:00-04:00");

function zone(overrides: Partial<FinalLevelZone> = {}): FinalLevelZone {
  const kind = overrides.kind ?? "resistance";
  const representativePrice = overrides.representativePrice ?? (kind === "support" ? 9.75 : 10.25);

  return {
    id: `${kind}-${representativePrice}`,
    symbol: "TEST",
    kind,
    timeframeBias: "5m",
    zoneLow: representativePrice - 0.05,
    zoneHigh: representativePrice + 0.05,
    representativePrice,
    strengthScore: 64,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 1,
    sourceTypes: [kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.6,
    rejectionScore: 0.5,
    displacementScore: 0.4,
    sessionSignificanceScore: 0.3,
    followThroughScore: 0.55,
    sourceEvidenceCount: 1,
    firstTimestamp: Date.parse("2026-05-01T09:35:00-04:00"),
    lastTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...overrides,
  };
}

function syntheticExtension(): FinalLevelZone {
  return zone({
    id: "TEST-synthetic-resistance-extension-1-13p0000",
    kind: "resistance",
    representativePrice: 13,
    zoneLow: 12.95,
    zoneHigh: 13.05,
    strengthScore: 0,
    strengthLabel: "weak",
    touchCount: 0,
    confluenceCount: 0,
    sourceTypes: [],
    timeframeSources: [],
    reactionQualityScore: 0,
    rejectionScore: 0,
    displacementScore: 0,
    sessionSignificanceScore: 0,
    followThroughScore: 0,
    sourceEvidenceCount: 0,
    isExtension: true,
    notes: [
      "Synthetic continuation-map extension for forward-planning only; not historical support/resistance.",
    ],
    extensionMetadata: {
      extensionSource: "synthetic_continuation_map",
      generationMethod: "round_number_ladder",
      referencePrice: 10,
      targetCoveragePct: 0.3,
      maxCoveragePct: 0.5,
      syntheticIndex: 1,
      evidenceLimitations: [
        "no_real_extension_candidate_available",
        "not_historical_support_resistance",
        "no_touch_or_rejection_history",
        "no_historical_confluence",
      ],
    },
  });
}

function levelOutput(): LevelEngineOutput {
  return {
    symbol: "TEST",
    generatedAt: AS_OF,
    metadata: {
      providerByTimeframe: { "5m": "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [
      zone({
        id: "major-support-950",
        kind: "support",
        representativePrice: 9.5,
        zoneLow: 9.45,
        zoneHigh: 9.55,
        timeframeBias: "daily",
        timeframeSources: ["daily"],
      }),
    ],
    majorResistance: [
      zone({
        id: "major-resistance-1050",
        representativePrice: 10.5,
        zoneLow: 10.45,
        zoneHigh: 10.55,
        timeframeBias: "daily",
        timeframeSources: ["daily"],
      }),
    ],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [
      zone({
        id: "intraday-support-975",
        kind: "support",
        representativePrice: 9.75,
        zoneLow: 9.7,
        zoneHigh: 9.8,
      }),
    ],
    intradayResistance: [
      zone({
        id: "intraday-resistance-1025",
        representativePrice: 10.25,
        zoneLow: 10.2,
        zoneHigh: 10.3,
      }),
    ],
    extensionLevels: {
      support: [],
      resistance: [syntheticExtension()],
    },
    specialLevels: {
      premarketHigh: 10.5,
      premarketLow: 9.5,
      openingRangeHigh: 10.25,
      openingRangeLow: 9.75,
    },
  };
}

function sessionFacts(overrides: Partial<SessionMarketFacts> = {}): SessionMarketFacts {
  return {
    symbol: "TEST",
    asOfTimestamp: AS_OF,
    sessionDate: "2026-05-01",
    currentPrice: 10,
    previousClose: 8.75,
    highOfDay: 10.5,
    lowOfDay: 9.5,
    premarketHigh: 10.5,
    premarketLow: 9.5,
    openingRangeHigh: 10.25,
    openingRangeLow: 9.75,
    regularSessionOpen: 9.9,
    vwap: 10.02,
    aboveVWAP: false,
    percentFromVWAP: -0.1996,
    diagnostics: [],
    ...overrides,
  };
}

function volumeFacts(overrides: Partial<VolumeMarketFacts> = {}): VolumeMarketFacts {
  return {
    symbol: "TEST",
    asOfTimestamp: AS_OF,
    currentVolume: 500_000,
    rollingAverageVolume: 125_000,
    relativeVolume: 4,
    dollarVolume: 5_000_000,
    volumeState: "extreme",
    liquidityQuality: "good",
    accelerationState: "surging",
    pullbackVolumeState: "drying_up",
    breakoutVolumeState: "strong",
    diagnostics: [],
    ...overrides,
  };
}

function volumeShelf(overrides: Partial<VolumeShelf> = {}): VolumeShelf {
  return {
    id: "TEST-volume-shelf-1020-1030",
    zoneLow: 10.2,
    zoneHigh: 10.3,
    representativePrice: 10.25,
    totalVolume: 900_000,
    dollarVolume: 9_000_000,
    percentOfWindowVolume: 42.5,
    touchCount: 4,
    firstTimestamp: Date.parse("2026-05-01T09:40:00-04:00"),
    lastTimestamp: Date.parse("2026-05-01T10:10:00-04:00"),
    shelfRole: "magnet",
    confidence: 0.82,
    reason: "High activity shelf carried as facts-only metadata.",
    ...overrides,
  };
}

function marketContext(overrides: Partial<MarketContextProfile> = {}): MarketContextProfile {
  return {
    primaryContext: "day_trade_runner",
    confidence: 0.77,
    runnerPhase: "high_of_day_breakout",
    evidence: [],
    warnings: [],
    facts: {
      percentFromPreviousClose: 14.2857,
      percentFromOpen: 1.0101,
      relativeVolume: 4,
      dollarVolume: 5_000_000,
      aboveVWAP: false,
      nearHighOfDay: true,
      filteredCandleCount: 12,
      filteredPremarketCandleCount: 4,
      filteredRegularSessionCandleCount: 8,
    },
    scoringAdjustments: {
      intradayWeightMultiplier: 1.2,
      dailyWeightMultiplier: 0.9,
      sessionLevelWeightMultiplier: 1.15,
      volumeWeightMultiplier: 1.3,
      extensionRiskPenaltyMultiplier: 1.15,
    },
    ...overrides,
  };
}

function buildSnapshot(): LevelAnalysisSnapshot {
  const session = sessionFacts();
  const volume = volumeFacts();
  const shelves = [volumeShelf()];

  return buildLevelAnalysisSnapshot({
    symbol: "test",
    asOfTimestamp: AS_OF,
    referencePrice: 10,
    levelEngineOutput: levelOutput(),
    sessionFacts: session,
    volumeFacts: volume,
    volumeShelves: shelves,
    marketContext: marketContext(),
  });
}

function assertNoForbiddenLanguage(value: unknown): void {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["enter", /\benter\b/],
    ["exit", /\bexit\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["mistake", /\bmistake\b/],
    ["coaching", /\bcoaching\b/],
    ["p/l", /\bp\/l\b/],
    ["giveback", /\bgiveback\b/],
    ["grading", /\bgrading\b/],
  ] as const) {
    assert.equal(pattern.test(serialized), false, `Unexpected forbidden language: ${label}`);
  }
}

test("builds snapshot from supplied LevelEngineOutput and facts", () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.symbol, "TEST");
  assert.equal(snapshot.asOfTimestamp, AS_OF);
  assert.equal(snapshot.referencePrice, 10);
  assert.equal(snapshot.sessionFacts?.vwap, 10.02);
  assert.equal(snapshot.volumeFacts?.relativeVolume, 4);
  assert.equal(snapshot.volumeShelves?.[0]?.id, "TEST-volume-shelf-1020-1030");
  assert.equal(snapshot.marketContext?.primaryContext, "day_trade_runner");
  assert.equal(snapshot.factsBundle?.symbol, "TEST");
  assert.equal(snapshot.factsBundle?.vwapFactsOnly, true);
});

test("includes LevelIntelligenceReport and LevelQualityAuditReport", () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.levelIntelligenceReport.symbol, "TEST");
  assert.equal(snapshot.levelIntelligenceReport.counts.total, 5);
  assert.equal(snapshot.levelIntelligenceReport.counts.extensionResistance, 1);
  assert.equal(snapshot.levelQualityAudit.symbol, "TEST");
  assert.equal(snapshot.levelQualityAudit.summary.totalLevels, 5);
  assert.equal(snapshot.levelQualityAudit.summary.extensionCount, 1);
  assert.equal(snapshot.levelQualityAudit.safety.noScoringChange, true);
});

test("preserves synthetic extension metadata and marks it clearly", () => {
  const snapshot = buildSnapshot();
  const extension = snapshot.levelEngineOutput.extensionLevels.resistance[0];
  const profile = snapshot.levelIntelligenceReport.buckets.extensionResistance[0];

  assert.equal(extension?.extensionMetadata?.extensionSource, "synthetic_continuation_map");
  assert.equal(extension?.extensionMetadata?.generationMethod, "round_number_ladder");
  assert.equal(snapshot.safety.syntheticExtensionsClearlyMarked, true);
  assert.ok(extension?.notes.join(" ").includes("not historical support/resistance"));
  assert.ok(profile?.extension?.label.includes("Synthetic continuation map"));
});

test("preserves LevelEngineOutput unchanged and does not mutate inputs", () => {
  const output = levelOutput();
  const session = sessionFacts();
  const volume = volumeFacts();
  const shelves = [volumeShelf()];
  const context = marketContext();
  const before = JSON.stringify({ output, session, volume, shelves, context });

  const snapshot = buildLevelAnalysisSnapshot({
    symbol: "TEST",
    asOfTimestamp: AS_OF,
    referencePrice: 10,
    levelEngineOutput: output,
    sessionFacts: session,
    volumeFacts: volume,
    volumeShelves: shelves,
    marketContext: context,
  });

  assert.deepEqual(snapshot.levelEngineOutput, output);
  assert.notEqual(snapshot.levelEngineOutput, output);
  assert.equal(JSON.stringify({ output, session, volume, shelves, context }), before);
  assert.equal(snapshot.safety.levelOutputUnchanged, true);
});

test("marks VWAP and shelves as facts-only", () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.safety.factsOnlyVWAP, true);
  assert.equal(snapshot.safety.shelvesAreFactsOnly, true);
  assert.equal(snapshot.levelIntelligenceReport.safety.vwapFactsOnly, true);
  assert.equal(snapshot.levelIntelligenceReport.safety.shelvesAreFactsOnly, true);
  assert.equal(snapshot.factsBundle?.shelvesAreFactsOnly, true);
});

test("output is deterministic and serializable", () => {
  const left = buildSnapshot();
  const right = buildSnapshot();
  const serialized = JSON.stringify(left);

  assert.deepEqual(left, right);
  assert.deepEqual(JSON.parse(serialized), JSON.parse(JSON.stringify(right)));
});

test("flags as-of boundary warnings without changing output", () => {
  const snapshot = buildLevelAnalysisSnapshot({
    symbol: "TEST",
    asOfTimestamp: AS_OF - 1,
    levelEngineOutput: levelOutput(),
  });

  assert.equal(snapshot.safety.noLookaheadApplied, false);
  assert.ok(snapshot.diagnostics.includes("as_of_boundary_warning"));
});

test("does not emit recommendation coaching or grading language", () => {
  assertNoForbiddenLanguage(buildSnapshot());
});

test("builder source does not import Discord alert monitoring or LevelEngine runtime paths", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/analysis/level-analysis-snapshot.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  assert.equal(source.includes("../alerts"), false);
  assert.equal(source.includes("../monitoring"), false);
  assert.equal(source.includes("discord"), false);
  assert.equal(source.includes("level-engine"), false);
  assert.equal(source.includes("date.now"), false);
});

test("runtime mode old remains default", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
