import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type {
  LevelAnalysisSnapshot,
  LevelAnalysisSnapshotNearestLevel,
} from "../lib/analysis/level-analysis-snapshot.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";

const FIXTURE_PATH = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json",
    import.meta.url,
  ),
);
const LOCKED_TIMEFRAME_KEYS = ["5m", "15m", "4h", "daily"] as const;

type SnapshotLike = Partial<LevelAnalysisSnapshot> & Record<string, unknown>;

type AdapterValidationResult = {
  accepted: boolean;
  quarantineReasons: string[];
  limitations: string[];
};

type FactualConnectorView = {
  contract: {
    schemaVersion: string;
    producer: string;
    compatibleV1: boolean;
  };
  identity: {
    symbol: string;
    asOfTimestamp: number;
    referencePrice?: number;
  };
  sourceSnapshot: LevelAnalysisSnapshot;
  inputSummary: LevelAnalysisSnapshot["inputSummary"];
  nearest: {
    support: LevelAnalysisSnapshotNearestLevel | null;
    resistance: LevelAnalysisSnapshotNearestLevel | null;
  };
  levelMap: {
    bucketCounts: Record<string, number>;
    extensionCounts: {
      support: number;
      resistance: number;
    };
  };
  facts: {
    hasSessionFacts: boolean;
    hasVolumeFacts: boolean;
    volumeShelfCount: number;
    hasMarketContext: boolean;
    hasFactsBundle: boolean;
  };
  diagnostics: {
    snapshot: string[];
    audit: string[];
  };
  safety: {
    noLookaheadApplied: boolean;
    levelOutputUnchanged: boolean;
    factsOnlyVWAP: boolean;
    shelvesAreFactsOnly: boolean;
    syntheticExtensionsClearlyMarked: boolean;
  };
  quality: {
    auditPresent: boolean;
    extensionCoverageWarnings: string[];
    nearbyCoverageWarnings: string[];
    clusteredAreaCount: number;
    staleLevelCount: number;
    weakContextLevelCount: number;
  };
  syntheticExtensions: {
    count: number;
    levels: Array<{
      id: string;
      kind: FinalLevelZone["kind"];
      representativePrice: number;
      source: "synthetic_continuation_map";
      evidenceLimitations: string[];
      touchCount: number;
      confluenceCount: number;
    }>;
  };
  compatibility: {
    preserveUnknownFields: true;
    acceptedSchemaMajor: "v1";
  };
  limitations: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFixture(): LevelAnalysisSnapshot {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as LevelAnalysisSnapshot;
}

function cloneSnapshot(snapshot = readFixture()): LevelAnalysisSnapshot {
  return structuredClone(snapshot);
}

function allLevels(snapshot: Pick<LevelAnalysisSnapshot, "levelEngineOutput">): FinalLevelZone[] {
  return [
    ...snapshot.levelEngineOutput.majorSupport,
    ...snapshot.levelEngineOutput.majorResistance,
    ...snapshot.levelEngineOutput.intermediateSupport,
    ...snapshot.levelEngineOutput.intermediateResistance,
    ...snapshot.levelEngineOutput.intradaySupport,
    ...snapshot.levelEngineOutput.intradayResistance,
    ...snapshot.levelEngineOutput.extensionLevels.support,
    ...snapshot.levelEngineOutput.extensionLevels.resistance,
  ];
}

function surfacedLevels(snapshot: Pick<LevelAnalysisSnapshot, "levelEngineOutput">): FinalLevelZone[] {
  return [
    ...snapshot.levelEngineOutput.majorSupport,
    ...snapshot.levelEngineOutput.majorResistance,
    ...snapshot.levelEngineOutput.intermediateSupport,
    ...snapshot.levelEngineOutput.intermediateResistance,
    ...snapshot.levelEngineOutput.intradaySupport,
    ...snapshot.levelEngineOutput.intradayResistance,
  ];
}

function extensionLevels(snapshot: Pick<LevelAnalysisSnapshot, "levelEngineOutput">): FinalLevelZone[] {
  return [
    ...snapshot.levelEngineOutput.extensionLevels.support,
    ...snapshot.levelEngineOutput.extensionLevels.resistance,
  ];
}

function findSyntheticExtensionRows(snapshot: Pick<LevelAnalysisSnapshot, "levelEngineOutput">): FinalLevelZone[] {
  return allLevels(snapshot).filter(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeSyntheticCount(value: SnapshotLike): number {
  const output = value.levelEngineOutput;
  if (!isRecord(output)) {
    return 0;
  }

  const extensionLevelsValue = output.extensionLevels;
  if (!isRecord(extensionLevelsValue)) {
    return 0;
  }

  return [...safeArray(extensionLevelsValue.support), ...safeArray(extensionLevelsValue.resistance)].filter(
    (candidate) =>
      isRecord(candidate) &&
      isRecord(candidate.extensionMetadata) &&
      candidate.extensionMetadata.extensionSource === "synthetic_continuation_map",
  ).length;
}

function bucketCounts(snapshot: LevelAnalysisSnapshot): Record<string, number> {
  return {
    majorSupport: snapshot.levelEngineOutput.majorSupport.length,
    majorResistance: snapshot.levelEngineOutput.majorResistance.length,
    intermediateSupport: snapshot.levelEngineOutput.intermediateSupport.length,
    intermediateResistance: snapshot.levelEngineOutput.intermediateResistance.length,
    intradaySupport: snapshot.levelEngineOutput.intradaySupport.length,
    intradayResistance: snapshot.levelEngineOutput.intradayResistance.length,
    extensionSupport: snapshot.levelEngineOutput.extensionLevels.support.length,
    extensionResistance: snapshot.levelEngineOutput.extensionLevels.resistance.length,
  };
}

function hasNearestShape(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  const expected: Array<[string, string]> = [
    ["levelId", "string"],
    ["kind", "string"],
    ["bucket", "string"],
    ["representativePrice", "number"],
    ["zoneLow", "number"],
    ["zoneHigh", "number"],
    ["strengthScore", "number"],
    ["strengthLabel", "string"],
    ["distanceFromReferencePct", "number"],
    ["isExtension", "boolean"],
  ];

  return expected.every(([field, type]) => typeof value[field] === type);
}

function pushInputSummaryReasons(value: SnapshotLike, quarantineReasons: string[]): void {
  const summary = value.inputSummary;
  if (!isRecord(summary)) {
    quarantineReasons.push("missing_input_summary");
    return;
  }

  for (const field of [
    "timeframesPresent",
    "candleCounts",
    "filteredCandleCounts",
    "excludedFutureCandleCounts",
    "excludedPartialCandleCounts",
    "timeframes",
    "previousCloseProvided",
  ]) {
    if (!(field in summary)) {
      quarantineReasons.push(`missing_input_summary_${field}`);
    }
  }

  const timeframes = summary.timeframes;
  const candleCounts = summary.candleCounts;
  const filteredCandleCounts = summary.filteredCandleCounts;
  const excludedFutureCandleCounts = summary.excludedFutureCandleCounts;
  const excludedPartialCandleCounts = summary.excludedPartialCandleCounts;

  for (const key of LOCKED_TIMEFRAME_KEYS) {
    if (!isRecord(timeframes) || !isRecord(timeframes[key])) {
      quarantineReasons.push(`missing_timeframe_${key}`);
    }
    for (const [containerName, containerValue] of [
      ["candleCounts", candleCounts],
      ["filteredCandleCounts", filteredCandleCounts],
      ["excludedFutureCandleCounts", excludedFutureCandleCounts],
      ["excludedPartialCandleCounts", excludedPartialCandleCounts],
    ] as const) {
      if (!isRecord(containerValue) || typeof containerValue[key] !== "number") {
        quarantineReasons.push(`missing_${containerName}_${key}`);
      }
    }
  }
}

function pushLevelOutputReasons(value: SnapshotLike, quarantineReasons: string[]): void {
  const output = value.levelEngineOutput;
  if (!isRecord(output)) {
    quarantineReasons.push("missing_level_engine_output");
    return;
  }
  const outputRecord = output as Record<string, unknown>;

  for (const bucket of [
    "majorSupport",
    "majorResistance",
    "intermediateSupport",
    "intermediateResistance",
    "intradaySupport",
    "intradayResistance",
  ]) {
    if (!Array.isArray(outputRecord[bucket])) {
      quarantineReasons.push(`missing_bucket_${bucket}`);
    }
  }

  const extensionLevelsValue = output.extensionLevels;
  if (!isRecord(extensionLevelsValue)) {
    quarantineReasons.push("missing_extension_levels");
    return;
  }
  if (!Array.isArray(extensionLevelsValue.support)) {
    quarantineReasons.push("missing_extension_support");
  }
  if (!Array.isArray(extensionLevelsValue.resistance)) {
    quarantineReasons.push("missing_extension_resistance");
  }
}

function deriveLimitations(value: SnapshotLike): string[] {
  const limitations: string[] = [];

  if (value.nearestSupport === null) {
    limitations.push("nearest_support_absent");
  }
  if (value.nearestResistance === null) {
    limitations.push("nearest_resistance_absent");
  }
  if (!value.sessionFacts) {
    limitations.push("missing_session_facts");
  }
  if (!value.volumeFacts) {
    limitations.push("missing_volume_facts");
  }
  if (!value.marketContext) {
    limitations.push("missing_market_context");
  }
  if (!value.factsBundle) {
    limitations.push("missing_facts_bundle");
  }

  const shelves = value.volumeShelves;
  if (Array.isArray(shelves) && shelves.length === 0) {
    limitations.push("empty_volume_shelves");
  }

  const audit = value.levelQualityAudit;
  if (isRecord(audit) && isRecord(audit.extensionCoverage)) {
    for (const warning of safeArray(audit.extensionCoverage.warnings)) {
      if (typeof warning === "string") {
        limitations.push(`quality:${warning}`);
      }
    }
  }

  return limitations;
}

function validateSnapshotForAdapter(value: unknown): AdapterValidationResult {
  const quarantineReasons: string[] = [];

  if (!isRecord(value)) {
    return {
      accepted: false,
      quarantineReasons: ["snapshot_not_object"],
      limitations: [],
    };
  }

  const snapshot = value as SnapshotLike;

  if (typeof snapshot.schemaVersion !== "string") {
    quarantineReasons.push("missing_schema_version");
  } else if (!snapshot.schemaVersion.startsWith("level-analysis-snapshot/v1")) {
    quarantineReasons.push("unsupported_schema_version");
  }

  if (snapshot.producer !== "levels-system") {
    quarantineReasons.push("unsupported_producer");
  }

  if (typeof snapshot.symbol !== "string" || snapshot.symbol.length === 0) {
    quarantineReasons.push("missing_symbol");
  }

  if (typeof snapshot.asOfTimestamp !== "number" || !Number.isFinite(snapshot.asOfTimestamp)) {
    quarantineReasons.push("missing_as_of_timestamp");
  }

  pushInputSummaryReasons(snapshot, quarantineReasons);

  if (!("nearestSupport" in snapshot)) {
    quarantineReasons.push("missing_nearest_support_field");
  } else if (!hasNearestShape(snapshot.nearestSupport)) {
    quarantineReasons.push("malformed_nearest_support");
  }

  if (!("nearestResistance" in snapshot)) {
    quarantineReasons.push("missing_nearest_resistance_field");
  } else if (!hasNearestShape(snapshot.nearestResistance)) {
    quarantineReasons.push("malformed_nearest_resistance");
  }

  pushLevelOutputReasons(snapshot, quarantineReasons);

  if (!isRecord(snapshot.levelIntelligenceReport)) {
    quarantineReasons.push("missing_level_intelligence_report");
  }
  if (!isRecord(snapshot.levelQualityAudit)) {
    quarantineReasons.push("missing_level_quality_audit");
  }
  if (!Array.isArray(snapshot.diagnostics)) {
    quarantineReasons.push("missing_diagnostics");
  }

  if (!isRecord(snapshot.safety)) {
    quarantineReasons.push("missing_safety");
  } else {
    if (snapshot.safety.noLookaheadApplied !== true) {
      quarantineReasons.push("no_lookahead_not_confirmed");
    }
    if (safeSyntheticCount(snapshot) > 0 && snapshot.safety.syntheticExtensionsClearlyMarked !== true) {
      quarantineReasons.push("synthetic_extensions_not_confirmed_marked");
    }
  }

  return {
    accepted: quarantineReasons.length === 0,
    quarantineReasons,
    limitations: deriveLimitations(snapshot),
  };
}

function deriveFactualConnectorView(snapshot: LevelAnalysisSnapshot): FactualConnectorView {
  const synthetic = findSyntheticExtensionRows(snapshot).map((level) => ({
    id: level.id,
    kind: level.kind,
    representativePrice: level.representativePrice,
    source: "synthetic_continuation_map" as const,
    evidenceLimitations: level.extensionMetadata?.evidenceLimitations ?? [],
    touchCount: level.touchCount,
    confluenceCount: level.confluenceCount,
  }));

  return {
    contract: {
      schemaVersion: snapshot.schemaVersion,
      producer: snapshot.producer,
      compatibleV1: snapshot.schemaVersion.startsWith("level-analysis-snapshot/v1"),
    },
    identity: {
      symbol: snapshot.symbol,
      asOfTimestamp: snapshot.asOfTimestamp,
      referencePrice: snapshot.referencePrice,
    },
    sourceSnapshot: snapshot,
    inputSummary: snapshot.inputSummary,
    nearest: {
      support: snapshot.nearestSupport,
      resistance: snapshot.nearestResistance,
    },
    levelMap: {
      bucketCounts: bucketCounts(snapshot),
      extensionCounts: {
        support: snapshot.levelEngineOutput.extensionLevels.support.length,
        resistance: snapshot.levelEngineOutput.extensionLevels.resistance.length,
      },
    },
    facts: {
      hasSessionFacts: Boolean(snapshot.sessionFacts),
      hasVolumeFacts: Boolean(snapshot.volumeFacts),
      volumeShelfCount: snapshot.volumeShelves?.length ?? 0,
      hasMarketContext: Boolean(snapshot.marketContext),
      hasFactsBundle: Boolean(snapshot.factsBundle),
    },
    diagnostics: {
      snapshot: [...snapshot.diagnostics],
      audit: [...snapshot.levelQualityAudit.diagnostics],
    },
    safety: {
      noLookaheadApplied: snapshot.safety.noLookaheadApplied,
      levelOutputUnchanged: snapshot.safety.levelOutputUnchanged,
      factsOnlyVWAP: snapshot.safety.factsOnlyVWAP,
      shelvesAreFactsOnly: snapshot.safety.shelvesAreFactsOnly,
      syntheticExtensionsClearlyMarked: snapshot.safety.syntheticExtensionsClearlyMarked,
    },
    quality: {
      auditPresent: true,
      extensionCoverageWarnings: [...(snapshot.levelQualityAudit.extensionCoverage.warnings ?? [])],
      nearbyCoverageWarnings: [...(snapshot.levelQualityAudit.nearbyCoverage.warnings ?? [])],
      clusteredAreaCount: snapshot.levelQualityAudit.clusteredAreas.length,
      staleLevelCount: snapshot.levelQualityAudit.staleLevels.length,
      weakContextLevelCount: snapshot.levelQualityAudit.weakContextLevels.length,
    },
    syntheticExtensions: {
      count: synthetic.length,
      levels: synthetic,
    },
    compatibility: {
      preserveUnknownFields: true,
      acceptedSchemaMajor: "v1",
    },
    limitations: deriveLimitations(snapshot),
  };
}

function assertAccepted(value: unknown, expectedLimitations: string[] = []): AdapterValidationResult {
  const result = validateSnapshotForAdapter(value);
  assert.equal(result.accepted, true, `Expected accepted snapshot, got ${result.quarantineReasons.join(", ")}`);
  for (const limitation of expectedLimitations) {
    assert.ok(result.limitations.includes(limitation), `Expected limitation ${limitation}`);
  }
  return result;
}

function assertQuarantined(value: unknown, expectedReason: string): AdapterValidationResult {
  const result = validateSnapshotForAdapter(value);
  assert.equal(result.accepted, false, "Expected snapshot to be quarantined.");
  assert.ok(result.quarantineReasons.includes(expectedReason), `Expected reason ${expectedReason}`);
  return result;
}

function withoutField(field: keyof LevelAnalysisSnapshot): SnapshotLike {
  const copy = cloneSnapshot() as SnapshotLike;
  delete copy[field];
  return copy;
}

function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, out);
    }
    return out;
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      collectStringValues(item, out);
    }
  }

  return out;
}

function collectDerivedViewKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDerivedViewKeys(item, out);
    }
    return out;
  }

  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      if (key !== "sourceSnapshot") {
        collectDerivedViewKeys(item, out);
      }
    }
  }

  return out;
}

function assertNoJournalOwnedFields(view: FactualConnectorView): void {
  const keys = collectDerivedViewKeys(view).join("\n").toLowerCase();
  const text = collectStringValues({
    ...view,
    sourceSnapshot: undefined,
  })
    .join("\n")
    .toLowerCase();

  for (const [label, pattern] of [
    ["grade", /\bgrade\b|\bgrading\b/],
    ["coach", /\bcoach\b|\bcoaching\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior_score\b|\bbehavior scoring\b/],
    ["recommendation", /\brecommendation\b/],
    ["entry decision", /\bentrydecision\b|\bentry_decision\b|\bentry decision\b/],
    ["exit decision", /\bexitdecision\b|\bexit_decision\b|\bexit decision\b/],
    ["trade advice", /\btradeadvice\b|\btrade_advice\b|\btrade advice\b/],
  ] as const) {
    assert.equal(pattern.test(keys), false, `Unexpected ${label} field in derived view.`);
    assert.equal(pattern.test(text), false, `Unexpected ${label} text in derived view.`);
  }
}

function assertNoProhibitedText(value: unknown): void {
  const text = collectStringValues(value).join("\n").toLowerCase();

  for (const [label, pattern] of [
    ["recommendation", /\brecommendation\b/],
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
    ["grade", /\bgrade\b|\bgrading\b/],
    ["coach", /\bcoach\b|\bcoaching\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/],
    ["entry decision", /\bentry decision\b/],
    ["exit decision", /\bexit decision\b/],
    ["trade advice", /\btrade advice\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} text.`);
  }
}

test("valid compact fixture is accepted by adapter-style validation", () => {
  const snapshot = readFixture();

  assert.doesNotThrow(() => JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));
  assert.equal(snapshot.schemaVersion.startsWith("level-analysis-snapshot/v1"), true);
  assert.equal(snapshot.producer, "levels-system");
  assert.ok(snapshot.symbol);
  assert.equal(typeof snapshot.asOfTimestamp, "number");
  assert.ok(snapshot.inputSummary);
  assert.deepEqual(Object.keys(snapshot.inputSummary.timeframes).sort(), [...LOCKED_TIMEFRAME_KEYS].sort());
  assert.deepEqual(Object.keys(snapshot.inputSummary.candleCounts).sort(), [...LOCKED_TIMEFRAME_KEYS].sort());
  assert.ok(snapshot.levelEngineOutput);
  assert.ok(Array.isArray(snapshot.levelEngineOutput.majorSupport));
  assert.ok(Array.isArray(snapshot.levelEngineOutput.majorResistance));
  assert.ok(Array.isArray(snapshot.levelEngineOutput.intermediateSupport));
  assert.ok(Array.isArray(snapshot.levelEngineOutput.intermediateResistance));
  assert.ok(Array.isArray(snapshot.levelEngineOutput.intradaySupport));
  assert.ok(Array.isArray(snapshot.levelEngineOutput.intradayResistance));
  assert.ok(Array.isArray(snapshot.levelEngineOutput.extensionLevels.support));
  assert.ok(Array.isArray(snapshot.levelEngineOutput.extensionLevels.resistance));
  assert.ok(Array.isArray(snapshot.diagnostics));
  assert.ok(snapshot.safety);
  assertAccepted(snapshot);
});

test("adapter-style factual view preserves raw snapshot and additive fields", () => {
  const snapshot = cloneSnapshot() as LevelAnalysisSnapshot & Record<string, unknown>;
  const before = JSON.stringify(snapshot);

  snapshot.additiveConnectorProbe = { preserved: true };
  (snapshot.levelEngineOutput.metadata as Record<string, unknown>).additiveMetadataProbe = {
    nested: true,
  };

  const withUnknownBefore = JSON.stringify(snapshot);
  const view = deriveFactualConnectorView(snapshot);

  assert.equal(view.sourceSnapshot, snapshot);
  assert.equal(JSON.stringify(snapshot), withUnknownBefore);
  assert.notEqual(JSON.stringify(snapshot), before);
  assert.deepEqual((view.sourceSnapshot as Record<string, unknown>).additiveConnectorProbe, { preserved: true });
  assert.deepEqual((view.sourceSnapshot.levelEngineOutput.metadata as Record<string, unknown>).additiveMetadataProbe, {
    nested: true,
  });
});

test("derived connector view exposes factual identity map facts diagnostics safety quality and limitations", () => {
  const snapshot = readFixture();
  const view = deriveFactualConnectorView(snapshot);

  assert.equal(view.contract.compatibleV1, true);
  assert.equal(view.identity.symbol, snapshot.symbol);
  assert.equal(view.identity.asOfTimestamp, snapshot.asOfTimestamp);
  assert.equal(view.identity.referencePrice, snapshot.referencePrice);
  assert.equal(view.nearest.support, snapshot.nearestSupport);
  assert.equal(view.nearest.resistance, snapshot.nearestResistance);
  assert.deepEqual(view.levelMap.bucketCounts, bucketCounts(snapshot));
  assert.equal(view.facts.hasSessionFacts, true);
  assert.equal(view.facts.hasVolumeFacts, true);
  assert.equal(view.facts.volumeShelfCount, snapshot.volumeShelves?.length ?? 0);
  assert.equal(view.facts.hasMarketContext, true);
  assert.equal(view.facts.hasFactsBundle, true);
  assert.deepEqual(view.diagnostics.snapshot, snapshot.diagnostics);
  assert.deepEqual(view.diagnostics.audit, snapshot.levelQualityAudit.diagnostics);
  assert.equal(view.safety.noLookaheadApplied, true);
  assert.equal(view.quality.auditPresent, true);
  assert.deepEqual(view.quality.extensionCoverageWarnings, snapshot.levelQualityAudit.extensionCoverage.warnings);
  assert.equal(view.syntheticExtensions.count, findSyntheticExtensionRows(snapshot).length);
  assert.ok(Array.isArray(view.limitations));
  assertNoJournalOwnedFields(view);
});

test("adapter-style validation quarantines malformed required fields and unsafe replay snapshots", () => {
  assertQuarantined(withoutField("schemaVersion"), "missing_schema_version");

  const wrongMajor = cloneSnapshot() as SnapshotLike;
  (wrongMajor as Record<string, unknown>).schemaVersion = "level-analysis-snapshot/v2";
  assertQuarantined(wrongMajor, "unsupported_schema_version");

  const wrongProducer = cloneSnapshot() as SnapshotLike;
  (wrongProducer as Record<string, unknown>).producer = "journal-system";
  assertQuarantined(wrongProducer, "unsupported_producer");

  assertQuarantined(withoutField("symbol"), "missing_symbol");
  assertQuarantined(withoutField("asOfTimestamp"), "missing_as_of_timestamp");
  assertQuarantined(withoutField("inputSummary"), "missing_input_summary");
  assertQuarantined(withoutField("levelEngineOutput"), "missing_level_engine_output");
  assertQuarantined(withoutField("diagnostics"), "missing_diagnostics");
  assertQuarantined(withoutField("safety"), "missing_safety");

  const unsafe = cloneSnapshot();
  unsafe.safety.noLookaheadApplied = false;
  assertQuarantined(unsafe, "no_lookahead_not_confirmed");

  const unmarkedSynthetic = cloneSnapshot();
  unmarkedSynthetic.safety.syntheticExtensionsClearlyMarked = false;
  assertQuarantined(unmarkedSynthetic, "synthetic_extensions_not_confirmed_marked");

  const malformedNearest = cloneSnapshot() as SnapshotLike;
  (malformedNearest as Record<string, unknown>).nearestSupport = {
    kind: "support",
    representativePrice: 9.75,
  };
  assertQuarantined(malformedNearest, "malformed_nearest_support");
});

test("adapter-style validation tolerates nullable optional and additive scenarios with limitations", () => {
  const nullableNearest = cloneSnapshot();
  nullableNearest.nearestSupport = null;
  nullableNearest.nearestResistance = null;
  assertAccepted(nullableNearest, ["nearest_support_absent", "nearest_resistance_absent"]);

  const emptyExtensions = cloneSnapshot();
  emptyExtensions.levelEngineOutput.extensionLevels.support = [];
  emptyExtensions.levelEngineOutput.extensionLevels.resistance = [];
  assertAccepted(emptyExtensions);
  assert.equal(deriveFactualConnectorView(emptyExtensions).syntheticExtensions.count, 0);

  const noShelves = cloneSnapshot();
  noShelves.volumeShelves = [];
  assertAccepted(noShelves, ["empty_volume_shelves"]);

  const missingOptionalFacts = cloneSnapshot() as SnapshotLike;
  delete missingOptionalFacts.marketContext;
  delete missingOptionalFacts.factsBundle;
  assertAccepted(missingOptionalFacts, ["missing_market_context", "missing_facts_bundle"]);

  const additive = cloneSnapshot() as SnapshotLike;
  additive.additiveTopLevelField = { ok: true };
  (additive.levelEngineOutput!.metadata as Record<string, unknown>).additiveMetadataField = "preserved";
  assertAccepted(additive);
  const view = deriveFactualConnectorView(additive as LevelAnalysisSnapshot);
  assert.equal((view.sourceSnapshot as Record<string, unknown>).additiveTopLevelField !== undefined, true);
  assert.equal((view.sourceSnapshot.levelEngineOutput.metadata as Record<string, unknown>).additiveMetadataField, "preserved");
});

test("synthetic continuation-map rows are marked and stay outside surfaced buckets", () => {
  const snapshot = readFixture();
  const syntheticRows = findSyntheticExtensionRows(snapshot);
  const surfacedSyntheticRows = surfacedLevels(snapshot).filter(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );
  const extensionSyntheticRows = extensionLevels(snapshot).filter(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );

  assert.ok(syntheticRows.length > 0, "Fixture should include synthetic continuation-map rows.");
  assert.equal(surfacedSyntheticRows.length, 0);
  assert.equal(extensionSyntheticRows.length, syntheticRows.length);

  for (const level of syntheticRows) {
    const limitations = level.extensionMetadata?.evidenceLimitations ?? [];
    const notes = level.notes.join(" ").toLowerCase();

    assert.equal(level.extensionMetadata?.extensionSource, "synthetic_continuation_map");
    assert.equal(level.isExtension, true);
    assert.equal(level.touchCount, 0);
    assert.equal(level.confluenceCount, 0);
    assert.equal(level.sourceEvidenceCount, 0);
    assert.ok(limitations.includes("not_historical_support_resistance"));
    assert.ok(limitations.includes("no_touch_or_rejection_history"));
    assert.ok(limitations.includes("no_historical_confluence"));
    assert.ok(notes.includes("not historical support/resistance"));
  }
});

test("LevelQualityAudit is surfaced as factual quality context only", () => {
  const snapshot = readFixture();
  const view = deriveFactualConnectorView(snapshot);

  assert.ok(snapshot.levelQualityAudit);
  assert.deepEqual(view.diagnostics.audit, snapshot.levelQualityAudit.diagnostics);
  assert.deepEqual(view.quality.extensionCoverageWarnings, snapshot.levelQualityAudit.extensionCoverage.warnings);
  assert.deepEqual(view.quality.nearbyCoverageWarnings, snapshot.levelQualityAudit.nearbyCoverage.warnings);
  assert.ok(view.limitations.every((limitation) => !/\bgrade\b|\bcoaching\b|\brecommendation\b/.test(limitation)));
  assertNoJournalOwnedFields(view);
});

test("fixture and derived factual view avoid prohibited downstream behavior language", () => {
  const snapshot = readFixture();
  const view = deriveFactualConnectorView(snapshot);

  assertNoProhibitedText(snapshot);
  assertNoProhibitedText({
    ...view,
    sourceSnapshot: undefined,
  });
  assertNoJournalOwnedFields(view);
});
