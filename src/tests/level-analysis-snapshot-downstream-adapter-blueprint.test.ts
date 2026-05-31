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

type AdapterValidationResult = {
  accepted: boolean;
  quarantineReasons: string[];
};

type AdapterView = {
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
  safety: LevelAnalysisSnapshot["safety"];
  quality: {
    auditPresent: boolean;
    extensionCoverageWarnings: string[];
    clusteredAreaCount: number;
    staleLevelCount: number;
  };
  syntheticExtensions: {
    count: number;
    levels: Array<{
      id: string;
      kind: FinalLevelZone["kind"];
      representativePrice: number;
      source: "synthetic_continuation_map";
      evidenceLimitations: string[];
    }>;
  };
  compatibility: {
    preserveUnknownFields: true;
    acceptedSchemaMajor: "v1";
  };
  limitations: string[];
};

function readFixture(): LevelAnalysisSnapshot {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as LevelAnalysisSnapshot;
}

function allLevels(snapshot: LevelAnalysisSnapshot): FinalLevelZone[] {
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

function syntheticExtensions(snapshot: LevelAnalysisSnapshot): AdapterView["syntheticExtensions"]["levels"] {
  return allLevels(snapshot)
    .filter((level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map")
    .map((level) => ({
      id: level.id,
      kind: level.kind,
      representativePrice: level.representativePrice,
      source: "synthetic_continuation_map" as const,
      evidenceLimitations: level.extensionMetadata?.evidenceLimitations ?? [],
    }));
}

function deriveLimitations(snapshot: LevelAnalysisSnapshot): string[] {
  const limitations: string[] = [];

  if (!snapshot.sessionFacts) {
    limitations.push("missing_session_facts");
  }
  if (!snapshot.volumeFacts) {
    limitations.push("missing_volume_facts");
  }
  if (!snapshot.marketContext) {
    limitations.push("missing_market_context");
  }
  if (!snapshot.factsBundle) {
    limitations.push("missing_facts_bundle");
  }
  if (snapshot.nearestSupport === null) {
    limitations.push("nearest_support_absent");
  }
  if (snapshot.nearestResistance === null) {
    limitations.push("nearest_resistance_absent");
  }

  for (const warning of snapshot.levelQualityAudit.extensionCoverage.warnings ?? []) {
    limitations.push(`quality:${warning}`);
  }

  return limitations;
}

function deriveAdapterView(snapshot: LevelAnalysisSnapshot): AdapterView {
  const synthetic = syntheticExtensions(snapshot);

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
    safety: snapshot.safety,
    quality: {
      auditPresent: true,
      extensionCoverageWarnings: [...(snapshot.levelQualityAudit.extensionCoverage.warnings ?? [])],
      clusteredAreaCount: snapshot.levelQualityAudit.clusteredAreas.length,
      staleLevelCount: snapshot.levelQualityAudit.staleLevels.length,
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

function validateSnapshotForAdapter(snapshot: LevelAnalysisSnapshot): AdapterValidationResult {
  const quarantineReasons: string[] = [];

  if (!snapshot.schemaVersion?.startsWith("level-analysis-snapshot/v1")) {
    quarantineReasons.push("unsupported_schema_version");
  }
  if (snapshot.producer !== "levels-system") {
    quarantineReasons.push("unsupported_producer");
  }
  if (!snapshot.symbol) {
    quarantineReasons.push("missing_symbol");
  }
  if (!Number.isFinite(snapshot.asOfTimestamp)) {
    quarantineReasons.push("missing_as_of_timestamp");
  }
  if (!snapshot.inputSummary) {
    quarantineReasons.push("missing_input_summary");
  }
  if (!snapshot.levelEngineOutput) {
    quarantineReasons.push("missing_level_engine_output");
  }
  if (!Array.isArray(snapshot.diagnostics)) {
    quarantineReasons.push("missing_diagnostics");
  }
  if (!snapshot.safety) {
    quarantineReasons.push("missing_safety");
  } else {
    if (snapshot.safety.noLookaheadApplied !== true) {
      quarantineReasons.push("no_lookahead_not_confirmed");
    }
    if (syntheticExtensions(snapshot).length > 0 && snapshot.safety.syntheticExtensionsClearlyMarked !== true) {
      quarantineReasons.push("synthetic_extensions_not_confirmed_marked");
    }
  }

  return {
    accepted: quarantineReasons.length === 0,
    quarantineReasons,
  };
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      if (key !== "sourceSnapshot") {
        collectKeys(item, keys);
      }
    }
  }

  return keys;
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

  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectStringValues(item, out);
    }
  }

  return out;
}

test("adapter blueprint derives a factual connector view from the compact fixture", () => {
  const snapshot = readFixture();
  const view = deriveAdapterView(snapshot);

  assert.equal(view.contract.schemaVersion, "level-analysis-snapshot/v1");
  assert.equal(view.contract.producer, "levels-system");
  assert.equal(view.contract.compatibleV1, true);
  assert.equal(view.identity.symbol, snapshot.symbol);
  assert.equal(view.identity.asOfTimestamp, snapshot.asOfTimestamp);
  assert.equal(view.inputSummary, snapshot.inputSummary);
  assert.equal(view.nearest.support, snapshot.nearestSupport);
  assert.equal(view.nearest.resistance, snapshot.nearestResistance);
  assert.ok(view.levelMap.bucketCounts.intradaySupport > 0);
  assert.ok(view.levelMap.bucketCounts.intradayResistance > 0);
  assert.equal(view.facts.hasSessionFacts, true);
  assert.equal(view.facts.hasVolumeFacts, true);
  assert.equal(view.facts.hasMarketContext, true);
  assert.equal(view.facts.hasFactsBundle, true);
  assert.equal(view.safety.noLookaheadApplied, true);
  assert.equal(view.quality.auditPresent, true);
});

test("adapter blueprint preserves the raw snapshot unchanged", () => {
  const snapshot = readFixture();
  const before = JSON.stringify(snapshot);
  const view = deriveAdapterView(snapshot);

  assert.equal(view.sourceSnapshot, snapshot);
  assert.equal(JSON.stringify(snapshot), before);
});

test("adapter blueprint keeps synthetic rows marked and quality findings diagnostic-only", () => {
  const snapshot = readFixture();
  const view = deriveAdapterView(snapshot);

  assert.ok(view.syntheticExtensions.count > 0);
  for (const level of view.syntheticExtensions.levels) {
    assert.equal(level.source, "synthetic_continuation_map");
    assert.ok(level.evidenceLimitations.includes("not_historical_support_resistance"));
    assert.ok(level.evidenceLimitations.includes("no_touch_or_rejection_history"));
  }

  assert.ok(view.quality.extensionCoverageWarnings.every((warning) => typeof warning === "string"));
  assert.ok(view.limitations.every((limitation) => !limitation.includes("grade")));
});

test("adapter blueprint validation accepts the fixture and quarantines unsafe replay payloads", () => {
  const snapshot = readFixture();
  const unsafeSnapshot = structuredClone(snapshot);
  unsafeSnapshot.safety.noLookaheadApplied = false;

  assert.deepEqual(validateSnapshotForAdapter(snapshot), {
    accepted: true,
    quarantineReasons: [],
  });
  assert.deepEqual(validateSnapshotForAdapter(unsafeSnapshot), {
    accepted: false,
    quarantineReasons: ["no_lookahead_not_confirmed"],
  });
});

test("adapter blueprint view avoids downstream-owned fields and language", () => {
  const view = deriveAdapterView(readFixture());
  const keys = collectKeys(view).join("\n").toLowerCase();
  const text = collectStringValues(view).join("\n").toLowerCase();

  for (const [label, pattern] of [
    ["grade field", /\bgrade\b/],
    ["grading field", /\bgrading\b/],
    ["coach field", /\bcoach\b/],
    ["coaching field", /\bcoaching\b/],
    ["p/l field", /\bp\/l\b/],
    ["giveback field", /\bgiveback\b/],
    ["behavior score field", /\bbehaviorscore\b|\bbehavior_score\b|\bbehavior scoring\b/],
    ["recommendation field", /\brecommendation\b/],
  ] as const) {
    assert.equal(pattern.test(keys), false, `Unexpected ${label} in adapter view keys.`);
    assert.equal(pattern.test(text), false, `Unexpected ${label} in adapter view text.`);
  }
});
