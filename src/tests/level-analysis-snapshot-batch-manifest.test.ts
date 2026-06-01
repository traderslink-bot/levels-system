import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelAnalysisSnapshotBatchManifest,
  buildLevelAnalysisSnapshotBatchManifestEntry,
  deriveLevelAnalysisSnapshotArtifactPath,
  hashLevelAnalysisSnapshotArtifact,
  summarizeLevelAnalysisSnapshotBatchManifest,
  validateLevelAnalysisSnapshotBatchManifest,
} from "../lib/analysis/level-analysis-snapshot-batch-manifest.js";
import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import {
  parseLevelAnalysisSnapshotBatchManifestRunnerArgs,
  runLevelAnalysisSnapshotBatchManifestRunner,
} from "../scripts/run-level-analysis-snapshot-batch-manifest.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SNAPSHOT_PATH = join(
  REPO_ROOT,
  "docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json",
);

function loadSnapshot(): {
  content: string;
  snapshot: LevelAnalysisSnapshot;
} {
  const content = readFileSync(SNAPSHOT_PATH, "utf8");
  return {
    content,
    snapshot: JSON.parse(content) as LevelAnalysisSnapshot,
  };
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-analysis-batch-manifest-"));

  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function collectText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectText(item, out);
    }
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectText(item, out);
    }
  }

  return out;
}

function assertNoProhibitedLanguage(value: unknown): void {
  const text = collectText(value).join("\n").toLowerCase();
  for (const [label, pattern] of [
    ["recommendation", /\brecommendation\b/],
    ["coaching", /\bcoaching\b/],
    ["grading", /\bgrading\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/],
    ["entry decision", /\bentry decision\b/],
    ["exit decision", /\bexit decision\b/],
    ["trade advice", /\btrade advice\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} language.`);
  }
}

test("builds a manifest entry from a deterministic snapshot artifact", () => {
  const { content, snapshot } = loadSnapshot();
  const entry = buildLevelAnalysisSnapshotBatchManifestEntry({
    artifactPath: "docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json",
    artifactExists: true,
    fileSizeBytes: Buffer.byteLength(content),
    content,
    snapshot,
  });

  assert.equal(entry.symbol, "SNAP");
  assert.equal(entry.asOfTimestamp, snapshot.asOfTimestamp);
  assert.equal(entry.referencePrice, snapshot.referencePrice);
  assert.equal(entry.snapshotSchemaVersion, "level-analysis-snapshot/v1");
  assert.equal(entry.snapshotProducer, "levels-system");
  assert.equal(entry.status, "accepted");
  assert.deepEqual(entry.validationErrors, []);
  assert.equal(entry.timeframeCoverage["5m"].provided, true);
  assert.equal(entry.timeframeCoverage["15m"].provided, true);
  assert.equal(entry.timeframeCoverage["15m"].filteredCandleCount, 3);
  assert.equal(entry.has15mInput, true);
  assert.equal(entry.missing15mInput, false);
  assert.equal(entry.noLookaheadApplied, true);
  assert.equal(entry.syntheticExtensionsClearlyMarked, true);
  assert.equal(entry.checksumSha256, hashLevelAnalysisSnapshotArtifact(content));
  assert.equal(
    deriveLevelAnalysisSnapshotArtifactPath({
      outputRoot: "artifacts/level-analysis-snapshot",
      symbol: "snap",
      asOfTimestamp: snapshot.asOfTimestamp,
    }),
    `artifacts/level-analysis-snapshot/SNAP/${snapshot.asOfTimestamp}/level-analysis-snapshot-v1.json`,
  );
});

test("summarizes accepted failed skipped quarantined and 15m coverage counts", () => {
  const { content, snapshot } = loadSnapshot();
  const accepted = buildLevelAnalysisSnapshotBatchManifestEntry({
    artifactPath: "accepted.json",
    content,
    snapshot,
  });
  const failed = buildLevelAnalysisSnapshotBatchManifestEntry({
    artifactPath: "failed.json",
    status: "failed",
    validationErrors: ["artifact_read_failed"],
  });
  const skipped = buildLevelAnalysisSnapshotBatchManifestEntry({
    artifactPath: "skipped.json",
    status: "skipped",
  });
  const quarantined = buildLevelAnalysisSnapshotBatchManifestEntry({
    artifactPath: "quarantined.json",
    snapshot: {
      ...snapshot,
      producer: "other" as any,
    },
  });
  const summary = summarizeLevelAnalysisSnapshotBatchManifest([
    accepted,
    failed,
    skipped,
    quarantined,
  ]);

  assert.equal(summary.totalEntries, 4);
  assert.equal(summary.acceptedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.quarantinedCount, 1);
  assert.equal(summary.with15mInputCount, 2);
  assert.equal(summary.missing15mInputCount, 2);
  assert.equal(summary.timeframeAvailability["15m"], 2);
  assert.ok(summary.uniqueValidationErrors.includes("snapshot_producer_invalid"));
});

test("builds and validates a batch manifest", () => {
  const { content, snapshot } = loadSnapshot();
  const { manifest, validation } = buildLevelAnalysisSnapshotBatchManifest({
    batchId: "batch-review",
    generatedAt: "2026-06-01T00:00:00.000Z",
    outputRoot: "docs/examples/level-analysis-snapshot",
    runConfig: {
      source: "deterministic-review-fixture",
    },
    entries: [
      {
        artifactPath: "docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json",
        artifactExists: true,
        fileSizeBytes: Buffer.byteLength(content),
        content,
        snapshot,
      },
    ],
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(manifest.schemaVersion, "level-analysis-snapshot-batch-manifest/v1");
  assert.equal(manifest.producer, "levels-system");
  assert.equal(manifest.summary.totalEntries, 1);
  assert.equal(manifest.summary.acceptedCount, 1);
  assert.equal(manifest.summary.with15mInputCount, 1);
  assert.equal(manifest.safety.noLookaheadAppliedForAccepted, true);
  assert.equal(manifest.safety.syntheticExtensionsClearlyMarkedForAccepted, true);
  assert.equal(validateLevelAnalysisSnapshotBatchManifest(manifest).valid, true);
  assert.equal(
    validateLevelAnalysisSnapshotBatchManifest({
      ...manifest,
      schemaVersion: "level-analysis-snapshot-batch-manifest/v2",
    }).valid,
    false,
  );
  assert.equal(
    validateLevelAnalysisSnapshotBatchManifest({
      ...manifest,
      producer: "other",
    }).valid,
    false,
  );
  assert.equal(
    validateLevelAnalysisSnapshotBatchManifest({
      ...manifest,
      entries: [{ ...manifest.entries[0], artifactPath: "" }],
    }).valid,
    false,
  );
  assert.equal(
    validateLevelAnalysisSnapshotBatchManifest({
      ...manifest,
      entries: [{ ...manifest.entries[0], status: "unknown" }],
    }).valid,
    false,
  );
  assertNoProhibitedLanguage(manifest);
});

test("batch manifest script builds a manifest from a directory of snapshot artifacts", () =>
  withTempDir((dir) => {
    const inputPath = join(dir, "artifacts", "SNAP", "1777645200000", "level-analysis-snapshot-v1.json");
    const outPath = join(dir, "manifest", "batch-manifest.json");
    const snapshotContent = readFileSync(SNAPSHOT_PATH, "utf8");

    mkdirSync(join(dir, "artifacts", "SNAP", "1777645200000"), { recursive: true });
    writeFileSync(inputPath, snapshotContent, { encoding: "utf8", flag: "w" });

    const options = parseLevelAnalysisSnapshotBatchManifestRunnerArgs([
      "--input",
      join(dir, "artifacts"),
      "--out",
      outPath,
      "--output-root",
      join(dir, "artifacts"),
      "--batch-id",
      "temp-batch",
      "--generated-at",
      "2026-06-01T00:00:00.000Z",
    ]);
    const result = runLevelAnalysisSnapshotBatchManifestRunner(options);

    assert.equal(existsSync(outPath), true);
    assert.deepEqual(result.inputPaths, [inputPath]);
    assert.equal(result.manifest.batchId, "temp-batch");
    assert.equal(result.manifest.summary.totalEntries, 1);
    assert.equal(result.manifest.summary.acceptedCount, 1);
    assert.equal(result.manifest.summary.with15mInputCount, 1);
    assert.equal(validateLevelAnalysisSnapshotBatchManifest(JSON.parse(readFileSync(outPath, "utf8"))).valid, true);
  }));

test("batch manifest boundaries stay factual and isolated from Discord alert monitoring behavior", () => {
  const moduleSource = readFileSync(
    fileURLToPath(new URL("../lib/analysis/level-analysis-snapshot-batch-manifest.ts", import.meta.url)),
    "utf8",
  );
  const scriptSource = readFileSync(
    fileURLToPath(new URL("../scripts/run-level-analysis-snapshot-batch-manifest.ts", import.meta.url)),
    "utf8",
  );

  for (const source of [moduleSource, scriptSource]) {
    assert.equal(source.includes("../alerts/"), false);
    assert.equal(source.includes("../monitoring/"), false);
    assert.equal(source.toLowerCase().includes("discord"), false);
    assert.equal(source.toLowerCase().includes("trade advice"), false);
  }
});
