import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertLevelQualityDensityMetricFactsOnly,
  classifyLevelMapDensity,
  describeLevelQualityDensityMetric,
  isLevelQualityDensityMetric,
  validateLevelQualityDensityMetric,
  type LevelQualityDensityMetric,
  type LevelQualityDensityRow,
} from "../lib/levels/level-quality-density-metric.js";

type DensityMetricFixture = {
  schemaVersion: "level-quality-density-metric-fixture/v1";
  fixtureName: string;
  inputSummary: {
    rowCount: number;
  };
  metric: LevelQualityDensityMetric;
  expected: {
    classification: LevelQualityDensityMetric["classification"];
    sideBias: LevelQualityDensityMetric["sideBias"];
    densityBuckets: LevelQualityDensityMetric["densityBuckets"];
    bucketCounts: Partial<LevelQualityDensityMetric["bucketCounts"]>;
  };
  factualOnlyStatus: {
    checked: boolean;
    prohibitedLanguageHitCount: number;
  };
};

const fixtureDir = fileURLToPath(
  new URL("../../docs/examples/level-analysis-snapshot/level-quality-density-metric/contract-fixtures/", import.meta.url),
);

function readFixtures(): DensityMetricFixture[] {
  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => JSON.parse(readFileSync(`${fixtureDir}/${fileName}`, "utf8")) as DensityMetricFixture);
}

function row(params: Partial<LevelQualityDensityRow> & Pick<LevelQualityDensityRow, "levelId" | "kind" | "representativePrice">): LevelQualityDensityRow {
  return {
    bucket: params.kind === "support" ? "intradaySupport" : "intradayResistance",
    isExtension: false,
    syntheticContinuationMap: false,
    ...params,
  };
}

function assertNoProhibitedLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
    ["recommendation", /\brecommendation\b/],
    ["trade advice", /\btrade\s+advice\b/],
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

test("density metric contract fixtures parse validate and match expected classifications", () => {
  const fixtures = readFixtures();

  assert.equal(fixtures.length, 8);
  assert.deepEqual(
    fixtures.map((fixture) => fixture.fixtureName).sort(),
    [
      "density-metric-balanced",
      "density-metric-dense-clustered",
      "density-metric-dense-separated",
      "density-metric-extension-heavy",
      "density-metric-resistance-heavy",
      "density-metric-sparse",
      "density-metric-support-heavy",
      "density-metric-synthetic-present",
    ],
  );

  for (const fixture of fixtures) {
    assert.equal(fixture.schemaVersion, "level-quality-density-metric-fixture/v1");
    assert.equal(fixture.inputSummary.rowCount, fixture.metric.totalRows);
    assert.equal(validateLevelQualityDensityMetric(fixture.metric).valid, true, fixture.fixtureName);
    assert.equal(isLevelQualityDensityMetric(fixture.metric), true, fixture.fixtureName);
    assertLevelQualityDensityMetricFactsOnly(fixture.metric);
    assert.equal(fixture.metric.classification, fixture.expected.classification);
    assert.equal(fixture.metric.sideBias, fixture.expected.sideBias);
    assert.deepEqual(fixture.metric.densityBuckets, fixture.expected.densityBuckets);
    for (const [bucket, count] of Object.entries(fixture.expected.bucketCounts)) {
      assert.equal(fixture.metric.bucketCounts[bucket as keyof LevelQualityDensityMetric["bucketCounts"]], count);
    }
    assert.equal(fixture.factualOnlyStatus.checked, true);
    assert.equal(fixture.factualOnlyStatus.prohibitedLanguageHitCount, 0);
  }
});

test("density metric validation rejects malformed schema and unsafe safety flags", () => {
  const [fixture] = readFixtures();
  assert(fixture);

  const malformed = {
    ...fixture.metric,
    schemaVersion: "level-quality-density-metric/v0",
  };
  const unsafe = {
    ...fixture.metric,
    safety: {
      ...fixture.metric.safety,
      rankingUnchanged: false,
    },
  };

  assert.equal(validateLevelQualityDensityMetric(malformed).valid, false);
  assert.equal(isLevelQualityDensityMetric(malformed), false);
  assert.equal(validateLevelQualityDensityMetric(unsafe).valid, false);
  assert.throws(() => assertLevelQualityDensityMetricFactsOnly(unsafe), /Invalid level quality density metric/);
});

test("contract helper validates sparse balanced dense separated and dense clustered metrics", () => {
  const sparse = classifyLevelMapDensity({
    rows: [
      row({ levelId: "support-1", kind: "support", representativePrice: 9.2 }),
      row({ levelId: "resistance-1", kind: "resistance", representativePrice: 10.8 }),
    ],
    referencePrice: 10,
  });
  const balanced = classifyLevelMapDensity({
    rows: [
      row({ levelId: "support-1", kind: "support", representativePrice: 8.9 }),
      row({ levelId: "support-2", kind: "support", representativePrice: 9.3 }),
      row({ levelId: "support-3", kind: "support", representativePrice: 9.7 }),
      row({ levelId: "resistance-1", kind: "resistance", representativePrice: 10.3 }),
      row({ levelId: "resistance-2", kind: "resistance", representativePrice: 10.7 }),
      row({ levelId: "resistance-3", kind: "resistance", representativePrice: 11.1 }),
    ],
    referencePrice: 10,
  });
  const denseSeparated = classifyLevelMapDensity({
    rows: Array.from({ length: 10 }, (_, index) =>
      row({
        levelId: `separated-${index}`,
        kind: index < 5 ? "support" : "resistance",
        representativePrice: index < 5 ? 8.5 + index * 0.25 : 10.5 + (index - 5) * 0.25,
      }),
    ),
    referencePrice: 10,
  });
  const denseClustered = classifyLevelMapDensity({
    rows: Array.from({ length: 10 }, (_, index) =>
      row({
        levelId: `clustered-${index}`,
        kind: index < 5 ? "support" : "resistance",
        representativePrice: 9.8 + index * 0.04,
      }),
    ),
    referencePrice: 10,
    diagnostics: ["clustered_level_areas_present"],
  });

  assert.equal(sparse.classification, "sparse");
  assert.equal(balanced.classification, "balanced");
  assert.equal(denseSeparated.classification, "dense_separated");
  assert.equal(denseClustered.classification, "dense_clustered");

  for (const metric of [sparse, balanced, denseSeparated, denseClustered]) {
    assert.equal(validateLevelQualityDensityMetric(metric).valid, true);
    assertLevelQualityDensityMetricFactsOnly(metric);
  }
});

test("side and bucket fixtures preserve support resistance extension and synthetic rules", () => {
  const fixturesByName = new Map(readFixtures().map((fixture) => [fixture.fixtureName, fixture]));

  const supportHeavy = fixturesByName.get("density-metric-support-heavy");
  const resistanceHeavy = fixturesByName.get("density-metric-resistance-heavy");
  const extensionHeavy = fixturesByName.get("density-metric-extension-heavy");
  const syntheticPresent = fixturesByName.get("density-metric-synthetic-present");

  assert.equal(supportHeavy?.metric.sideBias, "support_heavy");
  assert.equal(resistanceHeavy?.metric.sideBias, "resistance_heavy");
  assert.equal(extensionHeavy?.metric.flags.extensionHeavy, true);
  assert.equal(extensionHeavy?.metric.densityBuckets.extension, 3);
  assert.equal(syntheticPresent?.metric.flags.syntheticPresent, true);
  assert.equal(syntheticPresent?.metric.densityBuckets.synthetic, 1);
  assert.equal(syntheticPresent?.metric.counts.historical, 2);
});

test("density metric classification does not mutate supplied rows or imply output changes", () => {
  const rows = [
    row({ levelId: "support-1", kind: "support", representativePrice: 9.4 }),
    row({ levelId: "resistance-1", kind: "resistance", representativePrice: 10.6 }),
  ];
  const before = structuredClone(rows);
  const metric = classifyLevelMapDensity({ rows, referencePrice: 10 });

  assert.deepEqual(rows, before);
  assert.deepEqual(metric.safety, {
    auditOnly: true,
    generatedLevelsUnchanged: true,
    rankingUnchanged: true,
    clusteringUnchanged: true,
    surfacedLevelsUnchanged: true,
    extensionGenerationUnchanged: true,
  });
});

test("density metric text remains factual and avoids prohibited language", () => {
  for (const fixture of readFixtures()) {
    const description = describeLevelQualityDensityMetric(fixture.metric);
    assert.match(description, /Density classification:/);
    assertNoProhibitedLanguage(fixture.metric);
    assertNoProhibitedLanguage(description);
  }
});

test("density metric source stays isolated from behavior providers cache alert monitoring Discord and journal paths", () => {
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
    "cache",
    "fetch(",
  ]) {
    assert.equal(source.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
