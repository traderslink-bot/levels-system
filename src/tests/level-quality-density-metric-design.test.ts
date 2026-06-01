import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  classifyLevelMapDensity,
  describeLevelQualityDensityMetric,
  type LevelQualityDensityRow,
} from "../lib/levels/level-quality-density-metric.js";

function row(params: Partial<LevelQualityDensityRow> & Pick<LevelQualityDensityRow, "levelId" | "kind" | "representativePrice">): LevelQualityDensityRow {
  const isSupport = params.kind === "support";
  return {
    bucket: isSupport ? "intradaySupport" : "intradayResistance",
    isExtension: false,
    syntheticContinuationMap: false,
    ...params,
  };
}

function extensionRow(
  levelId: string,
  kind: "support" | "resistance",
  representativePrice: number,
): LevelQualityDensityRow {
  return row({
    levelId,
    kind,
    representativePrice,
    bucket: kind === "support" ? "extensionSupport" : "extensionResistance",
    isExtension: true,
  });
}

function syntheticRow(
  levelId: string,
  kind: "support" | "resistance",
  representativePrice: number,
): LevelQualityDensityRow {
  return row({
    levelId,
    kind,
    representativePrice,
    bucket: kind === "support" ? "extensionSupport" : "extensionResistance",
    isExtension: true,
    syntheticContinuationMap: true,
  });
}

function assertNoProhibitedLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
    ["recommendation", /\brecommendation\b/],
    ["advice", /\btrade\s+advice\b/],
    ["grade", /\bgrade\b|\bgrading\b/],
    ["coaching", /\bcoaching\b|\bcoach\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["should have", /\bshould have\b/],
    ["mistake", /\bmistake\b/],
    ["discipline", /\bdiscipline\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} wording`);
  }
}

test("sparse map classification is audit-only and factual", () => {
  const rows = [
    row({ levelId: "support-1", kind: "support", representativePrice: 9.2 }),
    row({ levelId: "resistance-1", kind: "resistance", representativePrice: 10.8 }),
  ];
  const before = structuredClone(rows);
  const metric = classifyLevelMapDensity({ rows, referencePrice: 10 });

  assert.deepEqual(rows, before);
  assert.equal(metric.classification, "sparse");
  assert.equal(metric.rowsInsideAuditWindow, 2);
  assert.equal(metric.sideBias, "mixed");
  assert.equal(metric.flags.denseButSeparated, false);
  assert.equal(metric.safety.auditOnly, true);
  assertNoProhibitedLanguage(metric);
});

test("dense separated map is distinguished from clustered areas", () => {
  const rows = [
    row({ levelId: "support-1", kind: "support", representativePrice: 8.1 }),
    row({ levelId: "support-2", kind: "support", representativePrice: 8.7 }),
    row({ levelId: "support-3", kind: "support", representativePrice: 9.1 }),
    row({ levelId: "support-4", kind: "support", representativePrice: 9.5 }),
    row({ levelId: "support-5", kind: "support", representativePrice: 9.8 }),
    row({ levelId: "resistance-1", kind: "resistance", representativePrice: 10.2 }),
    row({ levelId: "resistance-2", kind: "resistance", representativePrice: 10.6 }),
    row({ levelId: "resistance-3", kind: "resistance", representativePrice: 11.0 }),
    row({ levelId: "resistance-4", kind: "resistance", representativePrice: 11.4 }),
    row({ levelId: "resistance-5", kind: "resistance", representativePrice: 11.8 }),
  ];
  const metric = classifyLevelMapDensity({
    rows,
    referencePrice: 10,
    clusteredAreaCount: 0,
  });

  assert.equal(metric.classification, "dense_separated");
  assert.equal(metric.flags.clusteredAreasPresent, false);
  assert.equal(metric.flags.denseButSeparated, true);
  assert(metric.diagnostics.includes("dense_but_separated_level_map"));
});

test("dense clustered map remains a separate density classification", () => {
  const rows = Array.from({ length: 10 }, (_, index) =>
    row({
      levelId: `clustered-${index}`,
      kind: index < 5 ? "support" : "resistance",
      representativePrice: 9.8 + index * 0.04,
    }),
  );
  const metric = classifyLevelMapDensity({
    rows,
    referencePrice: 10,
    diagnostics: ["clustered_level_areas_present"],
  });

  assert.equal(metric.classification, "dense_clustered");
  assert.equal(metric.flags.clusteredAreasPresent, true);
  assert.equal(metric.flags.denseButSeparated, false);
});

test("support-heavy and resistance-heavy density summaries are side-specific", () => {
  const supportHeavy = classifyLevelMapDensity({
    rows: [
      row({ levelId: "support-1", kind: "support", representativePrice: 9.1 }),
      row({ levelId: "support-2", kind: "support", representativePrice: 9.3 }),
      row({ levelId: "support-3", kind: "support", representativePrice: 9.5 }),
      row({ levelId: "support-4", kind: "support", representativePrice: 9.7 }),
      row({ levelId: "resistance-1", kind: "resistance", representativePrice: 10.3 }),
    ],
    referencePrice: 10,
  });
  const resistanceHeavy = classifyLevelMapDensity({
    rows: [
      row({ levelId: "support-1", kind: "support", representativePrice: 9.7 }),
      row({ levelId: "resistance-1", kind: "resistance", representativePrice: 10.3 }),
      row({ levelId: "resistance-2", kind: "resistance", representativePrice: 10.5 }),
      row({ levelId: "resistance-3", kind: "resistance", representativePrice: 10.7 }),
      row({ levelId: "resistance-4", kind: "resistance", representativePrice: 10.9 }),
    ],
    referencePrice: 10,
  });

  assert.equal(supportHeavy.sideBias, "support_heavy");
  assert.equal(resistanceHeavy.sideBias, "resistance_heavy");
});

test("extension and synthetic rows are counted separately", () => {
  const metric = classifyLevelMapDensity({
    rows: [
      row({ levelId: "support-1", kind: "support", representativePrice: 9.2 }),
      extensionRow("extension-support-1", "support", 8.6),
      extensionRow("extension-resistance-1", "resistance", 11.4),
      syntheticRow("synthetic-resistance-1", "resistance", 12.0),
    ],
    referencePrice: 10,
    thresholds: {
      extensionHeavyShare: 0.25,
    },
  });

  assert.equal(metric.counts.historical, 1);
  assert.equal(metric.counts.extension, 2);
  assert.equal(metric.counts.synthetic, 1);
  assert.equal(metric.flags.extensionHeavy, true);
  assert.equal(metric.flags.syntheticPresent, true);
  assert(metric.diagnostics.includes("synthetic_rows_present"));
  assert.equal(metric.densityBuckets.synthetic, 1);
});

test("audit window filters rows around reference price without mutation", () => {
  const rows = [
    row({ levelId: "support-in-window", kind: "support", representativePrice: 9.5 }),
    row({ levelId: "resistance-in-window", kind: "resistance", representativePrice: 10.5 }),
    row({ levelId: "support-outside-window", kind: "support", representativePrice: 5 }),
  ];
  const before = structuredClone(rows);
  const metric = classifyLevelMapDensity({
    rows,
    referencePrice: 10,
    thresholds: {
      auditWindowPct: 10,
    },
  });

  assert.deepEqual(rows, before);
  assert.equal(metric.totalRows, 3);
  assert.equal(metric.rowsInsideAuditWindow, 2);
  assert.equal(metric.bucketCounts.intradaySupport, 1);
});

test("description is factual and does not imply behavior changes", () => {
  const metric = classifyLevelMapDensity({
    rows: [
      row({ levelId: "support-1", kind: "support", representativePrice: 9.4 }),
      row({ levelId: "resistance-1", kind: "resistance", representativePrice: 10.6 }),
    ],
    referencePrice: 10,
  });
  const description = describeLevelQualityDensityMetric(metric);

  assert.match(description, /Density classification:/);
  assert.match(description, /Rows in audit window:/);
  assertNoProhibitedLanguage(description);
});

test("density metric source stays isolated from LevelEngine behavior alert monitoring Discord and journal paths", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/levels/level-quality-density-metric.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  for (const blocked of [
    "../alerts/",
    "../monitoring/",
    "../trader-context/",
    "level-engine",
    "ranklevel",
    "clusterraw",
    "scorelevel",
    "discord",
    "provider",
    "fetch(",
  ]) {
    assert.equal(source.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
