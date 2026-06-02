import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertLevelCandidateInventoryReviewVisibilityFactsOnly,
  isLevelCandidateInventoryReviewVisibilityWrapper,
  validateLevelCandidateInventoryReviewVisibilityWrapper,
  type LevelCandidateInventoryReviewVisibilityWrapper,
} from "../lib/levels/level-candidate-inventory-review-wiring.js";
import {
  summarizeLevelCandidateInventoryGaps,
  type LevelCandidateInventoryGapClassification,
} from "../lib/levels/level-candidate-inventory-visibility.js";

type CandidateInventoryReviewWiringFixture = {
  schemaVersion: "level-candidate-inventory-review-wiring-fixture/v1";
  fixtureName: string;
  wrapper: LevelCandidateInventoryReviewVisibilityWrapper;
  expectedPresent: boolean;
  expectedGapClassification: {
    support: LevelCandidateInventoryGapClassification;
    resistance: LevelCandidateInventoryGapClassification;
    overall: LevelCandidateInventoryGapClassification;
  };
  expectedLimitations: string[];
  expectedDiagnostics: string[];
  factualOnlyStatus: {
    checked: boolean;
    prohibitedLanguageHitCount: number;
  };
};

const fixtureDir = fileURLToPath(
  new URL("../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/review-wiring-fixtures/", import.meta.url),
);

function readFixtures(): CandidateInventoryReviewWiringFixture[] {
  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => JSON.parse(readFileSync(`${fixtureDir}/${fileName}`, "utf8")) as CandidateInventoryReviewWiringFixture);
}

function fixture(name: string): CandidateInventoryReviewWiringFixture {
  const found = readFixtures().find((item) => item.fixtureName === name);
  assert(found, `Missing fixture ${name}`);
  return found;
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

test("candidate inventory review wiring fixtures parse and validate", () => {
  const fixtures = readFixtures();

  assert.equal(fixtures.length, 5);
  for (const item of fixtures) {
    assert.equal(item.schemaVersion, "level-candidate-inventory-review-wiring-fixture/v1");
    assert.equal(validateLevelCandidateInventoryReviewVisibilityWrapper(item.wrapper).valid, true, item.fixtureName);
    assert.equal(isLevelCandidateInventoryReviewVisibilityWrapper(item.wrapper), true, item.fixtureName);
    assertLevelCandidateInventoryReviewVisibilityFactsOnly(item.wrapper);
    assert.equal(item.wrapper.present, item.expectedPresent);
    assert.equal(item.factualOnlyStatus.checked, true);
    assert.equal(item.factualOnlyStatus.prohibitedLanguageHitCount, 0);
  }
});

test("present candidate inventory wrappers preserve visibility and matching gap summary", () => {
  for (const item of readFixtures().filter((candidate) => candidate.wrapper.present)) {
    assert.equal(item.wrapper.present, true);
    assert.deepEqual(item.wrapper.gapSummary, item.expectedGapClassification);
    assert.deepEqual(
      item.wrapper.gapSummary,
      summarizeLevelCandidateInventoryGaps(item.wrapper.visibility),
    );
    assert.deepEqual(item.wrapper.visibility.limitations, item.expectedLimitations);
    assert.deepEqual(item.wrapper.visibility.diagnostics, item.expectedDiagnostics);
  }
});

test("missing candidate inventory wrapper validates with required limitation and diagnostic", () => {
  const item = fixture("review-wiring-missing-inventory");

  assert.equal(item.wrapper.present, false);
  assert.deepEqual(item.wrapper.limitations, ["raw_clustered_scored_inventory_not_available"]);
  assert.deepEqual(item.wrapper.diagnostics, ["candidate_inventory_visibility_not_available"]);
  assert.deepEqual(item.expectedGapClassification, {
    support: "inconclusive_missing_reasons",
    resistance: "inconclusive_missing_reasons",
    overall: "inconclusive_missing_reasons",
  });
});

test("candidate inventory review wiring rejects malformed wrappers", () => {
  const present = structuredClone(fixture("review-wiring-present-no-gap").wrapper);
  assert.equal(present.present, true);
  present.gapSummary = {
    support: "closer_unsurfaced_candidate",
    resistance: "no_gap",
    overall: "closer_unsurfaced_candidate",
  };

  const missing = {
    present: false,
    limitations: [],
    diagnostics: ["candidate_inventory_visibility_not_available"],
  };

  const sourceWrapper = fixture("review-wiring-present-no-gap").wrapper;
  assert.equal(sourceWrapper.present, true);
  const missingWithVisibility = {
    present: false,
    limitations: ["raw_clustered_scored_inventory_not_available"],
    diagnostics: ["candidate_inventory_visibility_not_available"],
    visibility: sourceWrapper.visibility,
  };

  assert.equal(validateLevelCandidateInventoryReviewVisibilityWrapper(present).valid, false);
  assert.equal(validateLevelCandidateInventoryReviewVisibilityWrapper(missing).valid, false);
  assert.equal(validateLevelCandidateInventoryReviewVisibilityWrapper(missingWithVisibility).valid, false);
});

test("candidate inventory review wiring facts-only assertion rejects unsafe wording", () => {
  const unsafe = {
    present: false,
    limitations: ["raw_clustered_scored_inventory_not_available"],
    diagnostics: ["candidate_inventory_visibility_not_available", "buy"],
  };

  assert.equal(validateLevelCandidateInventoryReviewVisibilityWrapper(unsafe).valid, true);
  assert.throws(
    () => assertLevelCandidateInventoryReviewVisibilityFactsOnly(unsafe),
    /non-factual wording/,
  );
});

test("candidate inventory review wiring helper does not mutate input", () => {
  const wrapper = structuredClone(fixture("review-wiring-present-closer-unsurfaced-support").wrapper);
  const before = structuredClone(wrapper);

  validateLevelCandidateInventoryReviewVisibilityWrapper(wrapper);
  assertLevelCandidateInventoryReviewVisibilityFactsOnly(wrapper);

  assert.deepEqual(wrapper, before);
});

test("candidate inventory review wiring fixtures remain facts-only", () => {
  for (const item of readFixtures()) {
    assertNoProhibitedLanguage(item.wrapper);
    assertNoProhibitedLanguage(item.expectedGapClassification);
    assertNoProhibitedLanguage(item.expectedLimitations);
    assertNoProhibitedLanguage(item.expectedDiagnostics);
  }
});

test("candidate inventory review wiring source stays isolated from providers cache writes alert monitoring Discord and journal paths", () => {
  const helperSource = readFileSync(
    fileURLToPath(new URL("../lib/levels/level-candidate-inventory-review-wiring.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  for (const blocked of [
    "../alerts/",
    "../monitoring/",
    "../trader-context/",
    "../market-data/",
    "level-engine",
    "ranklevel",
    "clusterraw",
    "scorelevel",
    "discord",
    "fetch(",
    "writefilesync",
  ]) {
    assert.equal(helperSource.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
