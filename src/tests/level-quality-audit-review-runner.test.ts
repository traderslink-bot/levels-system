import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { LevelIntelligenceProfile } from "../lib/levels/level-intelligence-profile.js";
import type { LevelIntelligenceReport } from "../lib/levels/level-intelligence-report.js";
import {
  buildLevelQualityAuditReviewResult,
  loadLevelQualityAuditIntelligenceReportJson,
  loadLevelQualityAuditLevelOutputJson,
  parseLevelQualityAuditReviewRunnerArgs,
  renderLevelQualityAuditReport,
  runLevelQualityAuditReviewRunner,
} from "../lib/levels/level-quality-audit-review-runner.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { EnrichedLevelAnalysis, FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";

const GENERATED_AT = Date.parse("2026-05-27T14:30:00-04:00");

function enrichedAnalysis(finalLevelScore = 0.82): EnrichedLevelAnalysis {
  return {
    source: "rankLevels",
    structuralStrengthScore: finalLevelScore,
    activeRelevanceScore: finalLevelScore,
    finalLevelScore,
    confidence: 0.8,
    state: "respected",
    rank: 1,
    explanation: "Supplied ranked metadata for audit review fixture.",
    scoreBreakdown: {
      timeframeScore: finalLevelScore,
      touchScore: finalLevelScore,
      reactionQualityScore: finalLevelScore,
      reactionMagnitudeScore: finalLevelScore,
      volumeScore: finalLevelScore,
      cleanlinessScore: finalLevelScore,
      roleFlipScore: 0,
      defenseScore: finalLevelScore,
      recencyScore: finalLevelScore,
      overtestPenalty: 0,
      clusterPenalty: 0,
      structuralStrengthScore: finalLevelScore,
      distanceToPriceScore: finalLevelScore,
      freshReactionScore: finalLevelScore,
      intradayPressureScore: finalLevelScore,
      recentVolumeActivityScore: finalLevelScore,
      currentInteractionScore: finalLevelScore,
      activeRelevanceScore: finalLevelScore,
      finalLevelScore,
    },
    touchStats: {
      touchCount: 3,
      meaningfulTouchCount: 2,
      rejectionCount: 1,
      failedBreakCount: 0,
      cleanBreakCount: 0,
      reclaimCount: 1,
      strongestReactionMovePct: 4.1,
      averageReactionMovePct: 2,
      bestVolumeRatio: 1.8,
      averageVolumeRatio: 1.2,
      cleanlinessStdDevPct: 0.2,
      barsSinceLastReaction: 3,
      ageInBars: 24,
    },
  };
}

function zone(
  id: string,
  kind: "support" | "resistance",
  representativePrice: number,
  overrides: Partial<FinalLevelZone> = {},
): FinalLevelZone {
  return {
    id,
    symbol: "QAUD",
    kind,
    timeframeBias: "5m",
    zoneLow: representativePrice - 0.03,
    zoneHigh: representativePrice + 0.03,
    representativePrice,
    strengthScore: 60,
    strengthLabel: "moderate",
    touchCount: 2,
    confluenceCount: 1,
    sourceTypes: [kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.56,
    rejectionScore: 0.5,
    displacementScore: 0.45,
    sessionSignificanceScore: 0.4,
    followThroughScore: 0.46,
    sourceEvidenceCount: 1,
    firstTimestamp: Date.parse("2026-05-27T09:30:00-04:00"),
    lastTimestamp: Date.parse("2026-05-27T10:30:00-04:00"),
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...overrides,
  };
}

function levelOutput(): LevelEngineOutput {
  return {
    symbol: "QAUD",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: { "5m": "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [
      zone("major-support-950", "support", 9.5, {
        timeframeBias: "daily",
        timeframeSources: ["daily"],
        strengthScore: 90,
        strengthLabel: "major",
        confluenceCount: 3,
        enrichedAnalysis: enrichedAnalysis(0.91),
      }),
    ],
    majorResistance: [
      zone("major-resistance-1050", "resistance", 10.5, {
        timeframeBias: "daily",
        timeframeSources: ["daily"],
        strengthScore: 86,
        strengthLabel: "major",
        confluenceCount: 3,
        enrichedAnalysis: enrichedAnalysis(0.88),
      }),
    ],
    intermediateSupport: [
      zone("intermediate-support-910", "support", 9.1, {
        strengthScore: 28,
        strengthLabel: "weak",
        confluenceCount: 0,
        freshness: "stale",
      }),
    ],
    intermediateResistance: [
      zone("intermediate-resistance-1020", "resistance", 10.2, {
        strengthScore: 34,
        strengthLabel: "weak",
        confluenceCount: 0,
        freshness: "stale",
      }),
    ],
    intradaySupport: [
      zone("intraday-support-980", "support", 9.8, {
        strengthScore: 67,
        strengthLabel: "strong",
      }),
    ],
    intradayResistance: [
      zone("intraday-resistance-1026", "resistance", 10.26, {
        strengthScore: 58,
        strengthLabel: "moderate",
      }),
    ],
    extensionLevels: {
      support: [
        zone("extension-support-855", "support", 8.55, {
          isExtension: true,
          freshness: "aging",
        }),
      ],
      resistance: [
        zone("extension-resistance-1160", "resistance", 11.6, {
          isExtension: true,
          freshness: "aging",
        }),
      ],
    },
    specialLevels: {
      premarketHigh: 10.5,
      premarketLow: 9.5,
      openingRangeHigh: 10.26,
      openingRangeLow: 9.8,
    },
  };
}

function profile(level: FinalLevelZone, overrides: Partial<LevelIntelligenceProfile> = {}): LevelIntelligenceProfile {
  return {
    levelId: level.id,
    symbol: level.symbol,
    kind: level.kind,
    representativePrice: level.representativePrice,
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    zoneWidthPercent: 0.6,
    origin: {
      sourceTypes: [...level.sourceTypes],
      timeframeSources: [...level.timeframeSources],
      primaryTimeframe: level.timeframeBias,
      isExtension: level.isExtension,
    },
    freshness: {
      firstTimestamp: level.firstTimestamp,
      lastTimestamp: level.lastTimestamp,
      label: level.freshness,
      state: level.enrichedAnalysis?.state,
    },
    reaction: {
      touchCount: level.touchCount,
      reactionQualityScore: level.reactionQualityScore,
      rejectionScore: level.rejectionScore,
      displacementScore: level.displacementScore,
      followThroughScore: level.followThroughScore,
    },
    distance: {
      referencePrice: 10,
      distanceFromReferencePct: Math.abs(level.representativePrice - 10) * 10,
      category: "near",
    },
    confluence: {
      nearSessionFacts: [],
      nearVolumeFacts: [],
      nearShelfFacts: [],
      contextTags: [],
    },
    confidence: level.enrichedAnalysis?.confidence,
    diagnostics: [],
    reason: "Audit review fixture profile.",
    safety: {
      factsOnly: true,
      noRuntimeBehaviorChange: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
    },
    ...overrides,
  };
}

function allLevels(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ];
}

function intelligenceReport(output: LevelEngineOutput): LevelIntelligenceReport {
  const profiles = allLevels(output).map((level) => {
    if (level.id === "major-resistance-1050") {
      return profile(level, {
        confluence: {
          nearSessionFacts: ["near high of day"],
          nearVolumeFacts: ["volume elevated"],
          nearShelfFacts: ["near volume shelf"],
          contextTags: ["runner context"],
        },
        marketContext: {
          primaryContext: "day_trade_runner",
          runnerPhase: "high_of_day_breakout",
          confidence: 0.76,
        },
      });
    }

    return profile(level);
  });

  return {
    symbol: output.symbol,
    generatedAt: output.generatedAt,
    referencePrice: output.metadata.referencePrice,
    profiles,
    buckets: {
      majorSupport: profiles.filter((item) => item.levelId === "major-support-950"),
      majorResistance: profiles.filter((item) => item.levelId === "major-resistance-1050"),
      intermediateSupport: profiles.filter((item) => item.levelId === "intermediate-support-910"),
      intermediateResistance: profiles.filter((item) => item.levelId === "intermediate-resistance-1020"),
      intradaySupport: profiles.filter((item) => item.levelId === "intraday-support-980"),
      intradayResistance: profiles.filter((item) => item.levelId === "intraday-resistance-1026"),
      extensionSupport: profiles.filter((item) => item.levelId === "extension-support-855"),
      extensionResistance: profiles.filter((item) => item.levelId === "extension-resistance-1160"),
    },
    counts: {
      majorSupport: 1,
      majorResistance: 1,
      intermediateSupport: 1,
      intermediateResistance: 1,
      intradaySupport: 1,
      intradayResistance: 1,
      extensionSupport: 1,
      extensionResistance: 1,
      total: 8,
    },
    diagnostics: [],
    safety: {
      levelOutputUnchanged: true,
      factsOnly: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
      noRuntimeBehaviorChange: true,
    },
  };
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-quality-audit-review-"));

  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(dir: string, fileName: string, value: unknown): string {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function assertNoRecommendationLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();

  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["enter", /\benter\b/],
    ["exit", /\bexit\b/],
    ["good trade", /good trade/],
    ["bad trade", /bad trade/],
    ["mistake", /\bmistake\b/],
    ["coaching", /\bcoaching\b/],
    ["p/l", /p\/l/],
    ["giveback", /\bgiveback\b/],
    ["grading", /\bgrading\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} wording`);
  }
}

test("parses level quality audit CLI options", () => {
  assert.deepEqual(
    parseLevelQualityAuditReviewRunnerArgs([
      "--level-output",
      "level-output.json",
      "--level-intelligence-report",
      "intelligence.json",
      "--out",
      "audit.txt",
      "--format",
      "json",
    ]),
    {
      levelOutputPath: "level-output.json",
      levelIntelligenceReportPath: "intelligence.json",
      outPath: "audit.txt",
      format: "json",
    },
  );
});

test("rejects missing required level-output path with clear error", () => {
  assert.throws(
    () => parseLevelQualityAuditReviewRunnerArgs(["--format", "text"]),
    /Missing required --level-output <path>\./,
  );
});

test("loads LevelEngineOutput and optional LevelIntelligenceReport JSON fixtures", () => withTempDir((dir) => {
  const output = levelOutput();
  const outputPath = writeJson(dir, "level-output.json", output);
  const intelligencePath = writeJson(dir, "intelligence.json", intelligenceReport(output));

  assert.equal(loadLevelQualityAuditLevelOutputJson(outputPath).symbol, "QAUD");
  assert.equal(loadLevelQualityAuditIntelligenceReportJson(intelligencePath).profiles.length, 8);
}));

test("produces readable text audit output from fixture JSON", () => withTempDir((dir) => {
  const output = levelOutput();
  const outputPath = writeJson(dir, "level-output.json", output);
  const intelligencePath = writeJson(dir, "intelligence.json", intelligenceReport(output));

  const result = runLevelQualityAuditReviewRunner({
    levelOutputPath: outputPath,
    levelIntelligenceReportPath: intelligencePath,
    format: "text",
  });

  assert.equal(result.report.symbol, "QAUD");
  assert.equal(result.report.summary.totalLevels, 8);
  assert.match(result.content, /QAUD level quality audit/);
  assert.match(result.content, /## Summary/);
  assert.match(result.content, /## Strongest Levels/);
  assert.match(result.content, /## Weakest Levels/);
  assert.match(result.content, /## Stale Levels/);
  assert.match(result.content, /## Clustered Areas/);
  assert.match(result.content, /## Extension Coverage/);
  assert.match(result.content, /## Nearby Coverage/);
  assert.match(result.content, /## Confluence Summary/);
  assertNoRecommendationLanguage(result.content);
}));

test("produces JSON audit output and writes to out path", () => withTempDir((dir) => {
  const output = levelOutput();
  const outputPath = writeJson(dir, "level-output.json", output);
  const intelligencePath = writeJson(dir, "intelligence.json", intelligenceReport(output));
  const outPath = join(dir, "nested", "audit.json");

  const result = runLevelQualityAuditReviewRunner({
    levelOutputPath: outputPath,
    levelIntelligenceReportPath: intelligencePath,
    outPath,
    format: "json",
  });

  assert.equal(existsSync(outPath), true);
  assert.equal(readFileSync(outPath, "utf8"), result.content);

  const parsed = JSON.parse(result.content) as { report: { symbol: string; summary: { totalLevels: number } } };
  assert.equal(parsed.report.symbol, "QAUD");
  assert.equal(parsed.report.summary.totalLevels, 8);
  assertNoRecommendationLanguage(parsed);
}));

test("handles missing optional intelligence report", () => withTempDir((dir) => {
  const outputPath = writeJson(dir, "level-output.json", levelOutput());
  const result = runLevelQualityAuditReviewRunner({
    levelOutputPath: outputPath,
    format: "text",
  });

  assert.equal(result.levelIntelligenceReportPath, undefined);
  assert(result.report.diagnostics.includes("level_intelligence_report_missing"));
  assert.match(result.content, /level_intelligence_report_missing/);
}));

test("rejects invalid JSON with clear errors", () => withTempDir((dir) => {
  const outputPath = join(dir, "level-output.json");
  writeFileSync(outputPath, "{", "utf8");

  assert.throws(
    () => loadLevelQualityAuditLevelOutputJson(outputPath),
    /Failed to read LevelEngineOutput JSON/,
  );

  const validOutputPath = writeJson(dir, "valid-output.json", levelOutput());
  const invalidIntelligencePath = join(dir, "intelligence.json");
  writeFileSync(invalidIntelligencePath, "{", "utf8");

  assert.throws(
    () => runLevelQualityAuditReviewRunner({
      levelOutputPath: validOutputPath,
      levelIntelligenceReportPath: invalidIntelligencePath,
      format: "text",
    }),
    /Failed to read LevelIntelligenceReport JSON/,
  );
}));

test("output is deterministic and inputs are not mutated", () => {
  const output = levelOutput();
  const intelligence = intelligenceReport(output);
  const outputBefore = JSON.stringify(output);
  const intelligenceBefore = JSON.stringify(intelligence);

  const first = buildLevelQualityAuditReviewResult(output, intelligence, "text");
  const second = buildLevelQualityAuditReviewResult(output, intelligence, "text");

  assert.deepEqual(first, second);
  assert.equal(first.content, renderLevelQualityAuditReport(first.report));
  assert.equal(JSON.stringify(output), outputBefore);
  assert.equal(JSON.stringify(intelligence), intelligenceBefore);
});

test("source does not import LevelEngine Discord alerts monitoring or trader context", () => {
  const helperPath = fileURLToPath(new URL("../lib/levels/level-quality-audit-review-runner.ts", import.meta.url));
  const scriptPath = fileURLToPath(new URL("../scripts/run-level-quality-audit.ts", import.meta.url));
  const source = `${readFileSync(helperPath, "utf8")}\n${readFileSync(scriptPath, "utf8")}`;

  assert.equal(source.includes("level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(source.includes("buildLevelExtensions"), false);
  assert.equal(source.includes("rankLevels("), false);
  assert.equal(source.includes("../alerts"), false);
  assert.equal(source.includes("../monitoring"), false);
  assert.equal(source.includes("../trader-context"), false);
  assert.equal(source.toLowerCase().includes("discord"), false);
});

test("old/default runtime mode remains unchanged", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
