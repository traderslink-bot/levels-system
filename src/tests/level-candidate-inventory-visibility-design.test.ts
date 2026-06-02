import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertLevelCandidateInventoryVisibilityFactsOnly,
  isLevelCandidateInventoryVisibility,
  summarizeLevelCandidateInventoryGaps,
  validateLevelCandidateInventoryVisibility,
  type LevelCandidateInventoryGapClassification,
  type LevelCandidateInventoryVisibility,
} from "../lib/levels/level-candidate-inventory-visibility.js";

type CandidateInventoryFixture = {
  schemaVersion: "level-candidate-inventory-visibility-fixture/v1";
  fixtureName: string;
  inputSummary: {
    symbol: string;
    referencePrice: number;
    scenario: string;
  };
  visibility: LevelCandidateInventoryVisibility;
  expectedClassification: {
    support: LevelCandidateInventoryGapClassification;
    resistance: LevelCandidateInventoryGapClassification;
    overall: LevelCandidateInventoryGapClassification;
  };
  factualOnlyStatus: {
    checked: boolean;
    prohibitedLanguageHitCount: number;
  };
};

const fixtureDir = fileURLToPath(
  new URL("../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/contract-fixtures/", import.meta.url),
);

function readFixtures(): CandidateInventoryFixture[] {
  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => JSON.parse(readFileSync(`${fixtureDir}/${fileName}`, "utf8")) as CandidateInventoryFixture);
}

function fixtureByName(name: string): CandidateInventoryFixture {
  const fixture = readFixtures().find((item) => item.fixtureName === name);
  assert(fixture, `Missing fixture ${name}`);
  return fixture;
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

test("candidate inventory visibility fixtures parse validate and match expected classifications", () => {
  const fixtures = readFixtures();

  assert.equal(fixtures.length, 5);
  assert.deepEqual(
    fixtures.map((fixture) => fixture.fixtureName).sort(),
    [
      "candidate-inventory-closer-unsurfaced-resistance",
      "candidate-inventory-closer-unsurfaced-support",
      "candidate-inventory-inconclusive-missing-reasons",
      "candidate-inventory-no-gap",
      "candidate-inventory-truthful-market-context-gap",
    ],
  );

  for (const fixture of fixtures) {
    assert.equal(fixture.schemaVersion, "level-candidate-inventory-visibility-fixture/v1");
    assert.equal(fixture.inputSummary.symbol, fixture.visibility.symbol);
    assert.equal(validateLevelCandidateInventoryVisibility(fixture.visibility).valid, true, fixture.fixtureName);
    assert.equal(isLevelCandidateInventoryVisibility(fixture.visibility), true, fixture.fixtureName);
    assertLevelCandidateInventoryVisibilityFactsOnly(fixture.visibility);
    assert.deepEqual(summarizeLevelCandidateInventoryGaps(fixture.visibility), fixture.expectedClassification);
    assert.equal(fixture.factualOnlyStatus.checked, true);
    assert.equal(fixture.factualOnlyStatus.prohibitedLanguageHitCount, 0);
  }
});

test("candidate inventory visibility detects closer unsurfaced support and resistance", () => {
  const support = fixtureByName("candidate-inventory-closer-unsurfaced-support").visibility;
  const resistance = fixtureByName("candidate-inventory-closer-unsurfaced-resistance").visibility;

  assert.equal(support.unsurfacedCloser.support.present, true);
  assert.equal(support.unsurfacedCloser.support.nearest?.price, 9.75);
  assert.equal(support.gapClassification.support, "closer_unsurfaced_candidate");
  assert.equal(support.unsurfacedCloser.resistance.present, false);

  assert.equal(resistance.unsurfacedCloser.resistance.present, true);
  assert.equal(resistance.unsurfacedCloser.resistance.nearest?.price, 10.15);
  assert.equal(resistance.gapClassification.resistance, "closer_unsurfaced_candidate");
  assert.equal(resistance.unsurfacedCloser.support.present, false);
});

test("candidate inventory visibility identifies truthful market context when candidate stages align", () => {
  const visibility = fixtureByName("candidate-inventory-truthful-market-context-gap").visibility;

  assert.equal(visibility.unsurfacedCloser.support.present, false);
  assert.equal(visibility.unsurfacedCloser.resistance.present, false);
  assert.equal(visibility.nearest.raw.support?.price, visibility.nearest.scored.support?.price);
  assert.equal(visibility.nearest.scored.support?.price, visibility.nearest.surfaced.support?.price);
  assert.equal(visibility.nearest.raw.resistance?.price, visibility.nearest.scored.resistance?.price);
  assert.equal(visibility.nearest.scored.resistance?.price, visibility.nearest.surfaced.resistance?.price);
  assert.deepEqual(summarizeLevelCandidateInventoryGaps(visibility), {
    support: "truthful_market_context_gap",
    resistance: "truthful_market_context_gap",
    overall: "truthful_market_context_gap",
  });
});

test("candidate inventory visibility marks missing stage inventory as inconclusive", () => {
  const visibility = fixtureByName("candidate-inventory-inconclusive-missing-reasons").visibility;

  assert.equal(visibility.stageCounts.raw.total, 0);
  assert.equal(visibility.stageCounts.scored.total, 0);
  assert.equal(visibility.nearest.scored.support, undefined);
  assert.equal(visibility.unsurfacedCloser.support.reasonAvailability, "not_available");
  assert(visibility.limitations.includes("raw_clustered_scored_inventory_not_available"));
  assert.equal(visibility.gapClassification.overall, "inconclusive_missing_reasons");
});

test("candidate inventory visibility validation rejects malformed shape and unsafe flags", () => {
  const valid = fixtureByName("candidate-inventory-no-gap").visibility;
  const malformed = {
    ...valid,
    schemaVersion: "level-candidate-inventory-visibility/v0",
  };
  const unsafe = {
    ...valid,
    safety: {
      ...valid.safety,
      surfacedLevelsChanged: true,
    },
  };
  const inconsistent = {
    ...valid,
    stageCounts: {
      ...valid.stageCounts,
      raw: {
        ...valid.stageCounts.raw,
        total: 999,
      },
    },
  };

  assert.equal(validateLevelCandidateInventoryVisibility(malformed).valid, false);
  assert.equal(isLevelCandidateInventoryVisibility(malformed), false);
  assert.equal(validateLevelCandidateInventoryVisibility(unsafe).valid, false);
  assert.equal(validateLevelCandidateInventoryVisibility(inconsistent).valid, false);
  assert.throws(() => assertLevelCandidateInventoryVisibilityFactsOnly(unsafe), /Invalid level candidate inventory visibility/);
});

test("candidate inventory visibility helpers do not mutate inputs", () => {
  const visibility = fixtureByName("candidate-inventory-no-gap").visibility;
  const before = structuredClone(visibility);

  const validation = validateLevelCandidateInventoryVisibility(visibility);
  const summary = summarizeLevelCandidateInventoryGaps(visibility);

  assert.equal(validation.valid, true);
  assert.deepEqual(summary, visibility.gapClassification);
  assert.deepEqual(visibility, before);
});

test("candidate inventory visibility output remains factual and avoids prohibited language", () => {
  for (const fixture of readFixtures()) {
    assertNoProhibitedLanguage(fixture.visibility);
    assertNoProhibitedLanguage(fixture.expectedClassification);
  }
});

test("candidate inventory visibility source stays isolated from runtime providers alert monitoring Discord and journal paths", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/levels/level-candidate-inventory-visibility.ts", import.meta.url)),
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
  ]) {
    assert.equal(source.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
