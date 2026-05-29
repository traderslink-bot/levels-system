import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  clusterRawLevelCandidates,
  clusterRawLevelCandidatesWithDiagnostics,
} from "../lib/levels/level-clusterer.js";
import { buildLevelClusteringDiagnostics } from "../lib/levels/level-clustering-diagnostics.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type {
  FinalLevelZone,
  RawLevelCandidate,
  RawLevelCandidateSourceType,
} from "../lib/levels/level-types.js";
import type { CandleTimeframe } from "../lib/market-data/candle-types.js";

const GENERATED_AT = Date.parse("2026-05-29T10:00:00-04:00");

function rawCandidate(overrides: {
  id: string;
  kind: "support" | "resistance";
  price: number;
  timeframe?: CandleTimeframe;
  sourceType?: RawLevelCandidateSourceType;
  symbol?: string;
}): RawLevelCandidate {
  return {
    id: overrides.id,
    symbol: overrides.symbol ?? "CLST",
    price: overrides.price,
    kind: overrides.kind,
    timeframe: overrides.timeframe ?? "4h",
    sourceType:
      overrides.sourceType ?? (overrides.kind === "support" ? "swing_low" : "swing_high"),
    touchCount: 2,
    reactionScore: 0.5,
    reactionQuality: 0.6,
    rejectionScore: 0.45,
    displacementScore: 0.55,
    sessionSignificance: 0.1,
    followThroughScore: 0.5,
    repeatedReactionCount: 1,
    gapStructure: false,
    firstTimestamp: GENERATED_AT - 60_000,
    lastTimestamp: GENERATED_AT,
    notes: [],
  };
}

function zone(
  overrides: Partial<FinalLevelZone> & {
    id: string;
    kind: "support" | "resistance";
    representativePrice: number;
  },
): FinalLevelZone {
  return {
    id: overrides.id,
    symbol: overrides.symbol ?? "CLST",
    kind: overrides.kind,
    timeframeBias: overrides.timeframeBias ?? "4h",
    zoneLow: overrides.zoneLow ?? Number((overrides.representativePrice - 0.05).toFixed(4)),
    zoneHigh: overrides.zoneHigh ?? Number((overrides.representativePrice + 0.05).toFixed(4)),
    representativePrice: overrides.representativePrice,
    strengthScore: overrides.strengthScore ?? 24,
    strengthLabel: overrides.strengthLabel ?? "moderate",
    touchCount: overrides.touchCount ?? 2,
    confluenceCount: overrides.confluenceCount ?? 1,
    sourceTypes:
      overrides.sourceTypes ?? (overrides.kind === "support" ? ["swing_low"] : ["swing_high"]),
    timeframeSources: overrides.timeframeSources ?? ["4h"],
    reactionQualityScore: overrides.reactionQualityScore ?? 0.6,
    rejectionScore: overrides.rejectionScore ?? 0.42,
    displacementScore: overrides.displacementScore ?? 0.54,
    sessionSignificanceScore: overrides.sessionSignificanceScore ?? 0.1,
    followThroughScore: overrides.followThroughScore ?? 0.48,
    gapContinuationScore: overrides.gapContinuationScore,
    sourceEvidenceCount: overrides.sourceEvidenceCount ?? 1,
    firstTimestamp: overrides.firstTimestamp ?? GENERATED_AT - 60_000,
    lastTimestamp: overrides.lastTimestamp ?? GENERATED_AT,
    sessionDate: overrides.sessionDate,
    isExtension: overrides.isExtension ?? false,
    freshness: overrides.freshness ?? "fresh",
    notes: overrides.notes ?? [],
    enrichedAnalysis: overrides.enrichedAnalysis,
  };
}

function rawCandidatesFixture(): RawLevelCandidate[] {
  return [
    rawCandidate({ id: "support-1", kind: "support", price: 9, timeframe: "daily" }),
    rawCandidate({ id: "support-2", kind: "support", price: 9.15, timeframe: "4h" }),
    rawCandidate({ id: "support-3", kind: "support", price: 9.3, timeframe: "4h" }),
    rawCandidate({ id: "support-4", kind: "support", price: 9.45, timeframe: "5m" }),
    rawCandidate({ id: "support-5", kind: "support", price: 9.6, timeframe: "5m" }),
    rawCandidate({ id: "resistance-1", kind: "resistance", price: 10.4, timeframe: "daily" }),
  ];
}

function clusteredZonesFixture(): FinalLevelZone[] {
  return [
    zone({
      id: "support-cluster",
      kind: "support",
      representativePrice: 9.3,
      zoneLow: 9,
      zoneHigh: 9.6,
      sourceEvidenceCount: 5,
      sourceTypes: ["swing_low"],
      timeframeBias: "mixed",
      timeframeSources: ["daily", "4h", "5m"],
    }),
    zone({
      id: "resistance-cluster",
      kind: "resistance",
      representativePrice: 10.4,
      zoneLow: 10.35,
      zoneHigh: 10.45,
      sourceEvidenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeBias: "daily",
      timeframeSources: ["daily"],
    }),
  ];
}

test("detects high compression ratio", () => {
  const report = buildLevelClusteringDiagnostics({
    symbol: "CLST",
    rawCandidates: rawCandidatesFixture(),
    clusteredZones: clusteredZonesFixture(),
  });

  assert.equal(report.rawCandidateCount, 6);
  assert.equal(report.clusteredZoneCount, 2);
  assert.equal(report.compressionRatio, 3);
  assert(report.warnings.includes("high_compression_ratio"));
  assert.equal(report.safety.clusteringBehaviorUnchanged, true);
});

test("reports cluster raw member counts and raw price spans", () => {
  const report = buildLevelClusteringDiagnostics({
    symbol: "CLST",
    rawCandidates: rawCandidatesFixture(),
    clusteredZones: clusteredZonesFixture(),
  });
  const supportCluster = report.clusters[0];

  assert.equal(supportCluster?.clusterId, "support-cluster");
  assert.equal(supportCluster?.kind, "support");
  assert.equal(supportCluster?.rawMemberMapping, "inferred_from_zone_span");
  assert.equal(supportCluster?.rawMemberCount, 5);
  assert.deepEqual(supportCluster?.rawMemberPrices, [9, 9.15, 9.3, 9.45, 9.6]);
  assert.equal(supportCluster?.minRawMemberPrice, 9);
  assert.equal(supportCluster?.maxRawMemberPrice, 9.6);
  assert.equal(supportCluster?.rawPriceSpanPct, 6.4516);
});

test("reports source and timeframe mix for raw members", () => {
  const report = buildLevelClusteringDiagnostics({
    symbol: "CLST",
    rawCandidates: rawCandidatesFixture(),
    clusteredZones: clusteredZonesFixture(),
  });
  const supportCluster = report.clusters[0];

  assert.deepEqual(supportCluster?.sourceTypes, ["swing_low"]);
  assert.deepEqual(supportCluster?.sourceTypeCounts, { swing_low: 5 });
  assert.deepEqual(supportCluster?.timeframeSources, ["4h", "5m", "daily"]);
  assert.deepEqual(supportCluster?.timeframeCounts, { "4h": 2, "5m": 2, daily: 1 });
});

test("cluster member tracking diagnostics preserve exact existing cluster output", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-05-29T10:00:00-04:00"),
  });
  const candidates = rawCandidatesFixture();
  const normalOutput = clusterRawLevelCandidates(
    "CLST",
    "support",
    candidates,
    0.1,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );
  const diagnosticOutput = clusterRawLevelCandidatesWithDiagnostics(
    "CLST",
    "support",
    candidates,
    0.1,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );

  assert.deepEqual(diagnosticOutput.zones, normalOutput);
  assert.equal(diagnosticOutput.diagnostics.safety.diagnosticOnly, true);
  assert.equal(diagnosticOutput.diagnostics.safety.normalClusterOutputUnchanged, true);
  assert.equal(diagnosticOutput.diagnostics.finalClusterCount, normalOutput.length);
});

test("raw members are tracked exactly when clusterer diagnostics are supplied", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-05-29T10:00:00-04:00"),
  });
  const candidates = rawCandidatesFixture();
  const diagnosticOutput = clusterRawLevelCandidatesWithDiagnostics(
    "CLST",
    "support",
    candidates,
    0.1,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );
  const report = buildLevelClusteringDiagnostics({
    symbol: "CLST",
    rawCandidates: candidates,
    clusteredZones: diagnosticOutput.zones,
    trackedClusters: diagnosticOutput.diagnostics.clusters,
  });
  const cluster = report.clusters[0];

  assert.equal(cluster?.rawMemberMapping, "tracked_from_clusterer_diagnostics");
  assert.equal(cluster?.exactRawMemberTrackingAvailable, true);
  assert.deepEqual(cluster?.rawMemberIds, [
    "support-1",
    "support-2",
    "support-3",
    "support-4",
    "support-5",
  ]);
  assert(report.diagnostics.includes("raw_member_mapping_tracked_from_clusterer_diagnostics_when_available"));
});

test("hidden depth candidates are exposed from tracked cluster members", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-05-29T10:00:00-04:00"),
  });
  const candidates = [
    rawCandidate({
      id: "support-depth-low",
      kind: "support",
      price: 9,
      timeframe: "5m",
    }),
    rawCandidate({
      id: "support-representative",
      kind: "support",
      price: 9.3,
      timeframe: "daily",
    }),
    rawCandidate({
      id: "support-upper-member",
      kind: "support",
      price: 9.6,
      timeframe: "5m",
    }),
  ];
  const diagnosticOutput = clusterRawLevelCandidatesWithDiagnostics(
    "CLST",
    "support",
    candidates,
    0.1,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );
  const trackedCluster = diagnosticOutput.diagnostics.clusters[0];
  const report = buildLevelClusteringDiagnostics({
    symbol: "CLST",
    rawCandidates: candidates,
    clusteredZones: diagnosticOutput.zones,
    trackedClusters: diagnosticOutput.diagnostics.clusters,
  });
  const cluster = report.clusters[0];

  assert.deepEqual(trackedCluster?.potentialExtensionDepthMemberIds, ["support-depth-low"]);
  assert.deepEqual(cluster?.hiddenDepthCandidateIds, ["support-depth-low"]);
  assert.deepEqual(cluster?.potentialExtensionDepthMemberIds, ["support-depth-low"]);
  assert.equal(cluster?.membersSpanMateriallyDifferentPrices, true);
  assert(cluster?.warnings.includes("hidden_depth_possible"));
});

test("flags broad clusters many-member clusters and possible hidden depth", () => {
  const report = buildLevelClusteringDiagnostics({
    symbol: "CLST",
    rawCandidates: rawCandidatesFixture(),
    clusteredZones: clusteredZonesFixture(),
  });
  const supportCluster = report.clusters[0];

  assert.equal(supportCluster?.isBroadCluster, true);
  assert.equal(supportCluster?.mayHideMultipleCandidateDepths, true);
  assert(supportCluster?.warnings.includes("broad_cluster_span"));
  assert(supportCluster?.warnings.includes("many_members_single_cluster"));
  assert(supportCluster?.warnings.includes("hidden_depth_possible"));
  assert(report.warnings.includes("broad_cluster_span"));
  assert(report.warnings.includes("many_members_single_cluster"));
  assert(report.warnings.includes("hidden_depth_possible"));
});

test("handles missing raw-member mapping safely", () => {
  const report = buildLevelClusteringDiagnostics({
    symbol: "CLST",
    rawCandidates: [rawCandidate({ id: "support-outside", kind: "support", price: 8 })],
    clusteredZones: [
      zone({
        id: "unmatched-support-cluster",
        kind: "support",
        representativePrice: 9.5,
        zoneLow: 9.4,
        zoneHigh: 9.6,
      }),
    ],
  });
  const cluster = report.clusters[0];

  assert.equal(cluster?.rawMemberMapping, "unavailable");
  assert.equal(cluster?.rawMemberCount, 0);
  assert.deepEqual(cluster?.rawMemberPrices, []);
  assert.equal(report.unmappedRawCandidateCount, 1);
  assert(cluster?.warnings.includes("no_raw_members_available"));
  assert(report.warnings.includes("no_raw_members_available"));
});

test("output is deterministic and does not mutate inputs", () => {
  const input = {
    symbol: "CLST",
    rawCandidates: rawCandidatesFixture(),
    clusteredZones: clusteredZonesFixture(),
  };
  const before = structuredClone(input);
  const first = buildLevelClusteringDiagnostics(input);
  const second = buildLevelClusteringDiagnostics(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
});

test("cluster member tracking diagnostics do not mutate inputs", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-05-29T10:00:00-04:00"),
  });
  const candidates = rawCandidatesFixture();
  const before = structuredClone(candidates);
  const first = clusterRawLevelCandidatesWithDiagnostics(
    "CLST",
    "support",
    candidates,
    0.1,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );
  const second = clusterRawLevelCandidatesWithDiagnostics(
    "CLST",
    "support",
    candidates,
    0.1,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );

  assert.deepEqual(candidates, before);
  assert.deepEqual(first, second);
});

test("diagnostics do not use LevelEngine or clustering behavior paths", () => {
  const sourcePath = fileURLToPath(
    new URL("../lib/levels/level-clustering-diagnostics.ts", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");
  const clustererSourcePath = fileURLToPath(
    new URL("../lib/levels/level-clusterer.ts", import.meta.url),
  );
  const clustererSource = readFileSync(clustererSourcePath, "utf8");

  assert.equal(source.includes("./level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(source.includes("clusterRawLevelCandidates"), false);
  assert.equal(source.includes("./level-clusterer"), false);
  assert.equal(clustererSource.includes("./level-engine"), false);
  assert.equal(clustererSource.includes("new LevelEngine"), false);
  assert.equal(resolveLevelRuntimeMode(), "old");
});
