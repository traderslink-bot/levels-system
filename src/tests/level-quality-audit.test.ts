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

test("level quality audit flags wide gaps between forward resistance levels", () => {
  const report = buildLevelQualityAuditReport(output({
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 1.55,
    },
    intermediateResistance: [
      zone({ kind: "resistance", representativePrice: 1.74 }),
      zone({ kind: "resistance", representativePrice: 1.78 }),
      zone({ kind: "resistance", representativePrice: 1.83 }),
      zone({ kind: "resistance", representativePrice: 2.3146 }),
    ],
    extensionLevels: {
      support: [],
      resistance: [],
    },
  }));

  const finding = report.findings.find(
    (candidate) => candidate.code === "wide_internal_gap" && candidate.side === "resistance",
  );
  assert.ok(finding);
  assert.equal(finding.severity, "action");
  assert.deepEqual(finding.evidence.forwardLevels, [1.74, 1.78, 1.83, 2.3146]);
});

test("level quality audit flags wide gaps between forward support levels", () => {
  const report = buildLevelQualityAuditReport(output({
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 6.3,
    },
    majorSupport: [
      zone({ kind: "support", representativePrice: 6.18, sourceTypes: ["swing_low"] }),
      zone({ kind: "support", representativePrice: 6.1, sourceTypes: ["swing_low"] }),
      zone({ kind: "support", representativePrice: 4.95, sourceTypes: ["swing_low"] }),
      zone({ kind: "support", representativePrice: 2.55, sourceTypes: ["swing_low"] }),
    ],
    intermediateSupport: [],
    intradaySupport: [],
    intermediateResistance: [
      zone({ kind: "resistance", representativePrice: 6.43 }),
      zone({ kind: "resistance", representativePrice: 6.74 }),
      zone({ kind: "resistance", representativePrice: 7.0 }),
    ],
    extensionLevels: {
      support: [],
      resistance: [],
    },
  }));

  const finding = report.findings.find(
    (candidate) => candidate.code === "wide_internal_gap" && candidate.side === "support",
  );
  assert.ok(finding);
  assert.equal(finding.severity, "action");
  assert.deepEqual(finding.evidence.forwardLevels, [6.18, 6.1, 4.95, 2.55]);
});
