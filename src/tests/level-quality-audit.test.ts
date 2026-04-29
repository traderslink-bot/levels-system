import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLevelQualityAuditReport,
  formatLevelQualityAuditReport,
} from "../lib/levels/level-quality-audit.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";

function zone(overrides: Partial<FinalLevelZone>): FinalLevelZone {
  const price = overrides.representativePrice ?? 1;
  return {
    id: `zone-${price}`,
    symbol: "ATER",
    kind: overrides.kind ?? "resistance",
    timeframeBias: overrides.timeframeBias ?? "daily",
    zoneLow: overrides.zoneLow ?? price,
    zoneHigh: overrides.zoneHigh ?? price,
    representativePrice: price,
    strengthScore: overrides.strengthScore ?? 2,
    strengthLabel: overrides.strengthLabel ?? "moderate",
    touchCount: overrides.touchCount ?? 2,
    confluenceCount: overrides.confluenceCount ?? 1,
    sourceTypes: overrides.sourceTypes ?? ["swing_high"],
    timeframeSources: overrides.timeframeSources ?? ["daily"],
    reactionQualityScore: overrides.reactionQualityScore ?? 1,
    rejectionScore: overrides.rejectionScore ?? 1,
    displacementScore: overrides.displacementScore ?? 1,
    sessionSignificanceScore: overrides.sessionSignificanceScore ?? 1,
    followThroughScore: overrides.followThroughScore ?? 1,
    sourceEvidenceCount: overrides.sourceEvidenceCount ?? 1,
    firstTimestamp: overrides.firstTimestamp ?? 1,
    lastTimestamp: overrides.lastTimestamp ?? 1,
    isExtension: overrides.isExtension ?? false,
    freshness: overrides.freshness ?? "fresh",
    notes: overrides.notes ?? [],
  };
}

function output(overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  return {
    symbol: "ATER",
    generatedAt: 1,
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 1.5,
    },
    majorSupport: [zone({ kind: "support", representativePrice: 1.2, sourceTypes: ["swing_low"] })],
    majorResistance: [],
    intermediateSupport: [zone({ kind: "support", representativePrice: 1.1, sourceTypes: ["swing_low"] })],
    intermediateResistance: [zone({ kind: "resistance", representativePrice: 2.1 })],
    intradaySupport: [zone({ kind: "support", representativePrice: 1.4, sourceTypes: ["swing_low"] })],
    intradayResistance: [],
    extensionLevels: {
      support: [],
      resistance: [zone({ kind: "resistance", representativePrice: 2.4, isExtension: true })],
    },
    specialLevels: {},
    ...overrides,
  };
}

test("level quality audit flags wide first resistance gaps", () => {
  const report = buildLevelQualityAuditReport(output());
  assert.equal(report.resistance.nearestLevel, 2.1);
  assert.equal(report.findings.some((finding) => finding.code === "wide_first_gap" && finding.severity === "action"), true);
  assert.match(formatLevelQualityAuditReport(report), /wide_first_gap/);
});

test("level quality audit reports healthy forward ladders when nearby levels exist", () => {
  const report = buildLevelQualityAuditReport(output({
    intermediateResistance: [
      zone({ kind: "resistance", representativePrice: 1.58 }),
      zone({ kind: "resistance", representativePrice: 1.7 }),
      zone({ kind: "resistance", representativePrice: 1.9 }),
    ],
    extensionLevels: {
      support: [],
      resistance: [],
    },
  }));
  assert.equal(report.findings.some((finding) => finding.code === "healthy_forward_ladder" && finding.side === "resistance"), true);
});
