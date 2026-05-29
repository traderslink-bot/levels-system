import assert from "node:assert/strict";
import test from "node:test";

import { buildLevelExtensions } from "../lib/levels/level-extension-engine.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";

function zone(overrides: Partial<FinalLevelZone> = {}): FinalLevelZone {
  const kind = overrides.kind ?? "resistance";

  const result: FinalLevelZone = {
    id: overrides.id ?? `${kind}-zone`,
    symbol: overrides.symbol ?? "SYN",
    kind,
    timeframeBias: overrides.timeframeBias ?? "daily",
    zoneLow: overrides.zoneLow ?? 10,
    zoneHigh: overrides.zoneHigh ?? 10.1,
    representativePrice: overrides.representativePrice ?? 10.05,
    strengthScore: overrides.strengthScore ?? 72,
    strengthLabel: overrides.strengthLabel ?? "strong",
    touchCount: overrides.touchCount ?? 3,
    confluenceCount: overrides.confluenceCount ?? 1,
    sourceTypes:
      overrides.sourceTypes ?? (kind === "support" ? ["swing_low"] : ["swing_high"]),
    timeframeSources: overrides.timeframeSources ?? ["daily"],
    reactionQualityScore: overrides.reactionQualityScore ?? 0.72,
    rejectionScore: overrides.rejectionScore ?? 0.68,
    displacementScore: overrides.displacementScore ?? 0.61,
    sessionSignificanceScore: overrides.sessionSignificanceScore ?? 0.2,
    followThroughScore: overrides.followThroughScore ?? 0.44,
    sourceEvidenceCount: overrides.sourceEvidenceCount ?? 3,
    firstTimestamp: overrides.firstTimestamp ?? 1_765_000_000_000,
    lastTimestamp: overrides.lastTimestamp ?? 1_765_086_400_000,
    isExtension: overrides.isExtension ?? false,
    freshness: overrides.freshness ?? "fresh",
    notes: overrides.notes ?? ["Historical level candidate."],
  };

  if (overrides.gapContinuationScore !== undefined) {
    result.gapContinuationScore = overrides.gapContinuationScore;
  }
  if (overrides.sessionDate !== undefined) {
    result.sessionDate = overrides.sessionDate;
  }
  if (overrides.extensionMetadata !== undefined) {
    result.extensionMetadata = overrides.extensionMetadata;
  }
  if (overrides.enrichedAnalysis !== undefined) {
    result.enrichedAnalysis = overrides.enrichedAnalysis;
  }

  return result;
}

function outputWithHistoricalExtension(): LevelEngineOutput {
  return {
    symbol: "SYN",
    generatedAt: 1_765_086_500_000,
    metadata: {
      providerByTimeframe: {
        daily: "fixture",
      },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [zone({
      id: "major-support",
      kind: "support",
      representativePrice: 9,
      zoneLow: 8.95,
      zoneHigh: 9.05,
    })],
    majorResistance: [zone({
      id: "major-resistance",
      representativePrice: 10.8,
      zoneLow: 10.75,
      zoneHigh: 10.85,
    })],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [],
      resistance: [zone({
        id: "historical-extension",
        representativePrice: 12,
        zoneLow: 11.95,
        zoneHigh: 12.05,
        isExtension: true,
      })],
    },
    specialLevels: {},
  };
}

test("existing LevelEngineOutput JSON serialization remains unchanged for historical levels", () => {
  const output = outputWithHistoricalExtension();
  const parsed = JSON.parse(JSON.stringify(output)) as LevelEngineOutput;

  assert.deepEqual(parsed, output);
  assert.equal(
    Object.hasOwn(parsed.extensionLevels.resistance[0]!, "extensionMetadata"),
    false,
  );
  assert.deepEqual(parsed.extensionLevels.resistance[0]!.sourceTypes, ["swing_high"]);
  assert.equal(parsed.extensionLevels.resistance[0]!.strengthLabel, "strong");
});

test("existing historical extension selection remains historical by default", () => {
  const surfacedResistance = [zone({
    id: "visible-resistance",
    representativePrice: 10.75,
    zoneLow: 10.7,
    zoneHigh: 10.8,
  })];
  const realExtensionCandidate = zone({
    id: "real-extension-candidate",
    representativePrice: 12,
    zoneLow: 11.95,
    zoneHigh: 12.05,
  });
  const extensionLevels = buildLevelExtensions({
    supportZones: [],
    resistanceZones: [...surfacedResistance, realExtensionCandidate],
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    maxExtensionPerSide: 1,
  });

  assert.equal(extensionLevels.resistance.length, 1);
  assert.equal(extensionLevels.resistance[0]!.id, "real-extension-candidate");
  assert.equal(extensionLevels.resistance[0]!.isExtension, true);
  assert.equal(extensionLevels.resistance[0]!.extensionMetadata, undefined);
  assert.deepEqual(extensionLevels.resistance[0]!.sourceTypes, ["swing_high"]);
});

test("synthetic continuation-map metadata is representable and serializable", () => {
  const synthetic = zone({
    id: "synthetic-resistance-extension-1",
    representativePrice: 13.5,
    zoneLow: 13.45,
    zoneHigh: 13.55,
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
      "Synthetic continuation-map extension for forward planning only; not historical support/resistance.",
    ],
    extensionMetadata: {
      extensionSource: "synthetic_continuation_map",
      generationMethod: "round_number_ladder",
      referencePrice: 10,
      targetCoveragePct: 0.35,
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
  const parsed = JSON.parse(JSON.stringify(synthetic)) as FinalLevelZone;

  assert.deepEqual(parsed, synthetic);
  assert.equal(parsed.extensionMetadata?.extensionSource, "synthetic_continuation_map");
  assert.equal(parsed.extensionMetadata?.generationMethod, "round_number_ladder");
  assert.deepEqual(parsed.sourceTypes, []);
  assert.deepEqual(parsed.timeframeSources, []);
  assert.equal(parsed.touchCount, 0);
  assert.equal(parsed.rejectionScore, 0);
  assert.equal(parsed.confluenceCount, 0);
  assert.match(parsed.notes.join(" "), /Synthetic continuation-map extension/);
  assert.match(parsed.notes.join(" "), /not historical support\/resistance/);
});

test("runtime mode old remains default", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
