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

type CandidateInventoryContractFixture = {
  schemaVersion: "level-candidate-inventory-visibility-fixture/v1";
  fixtureName: string;
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

function readFixtures(): CandidateInventoryContractFixture[] {
  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => JSON.parse(readFileSync(`${fixtureDir}/${fileName}`, "utf8")) as CandidateInventoryContractFixture);
}

function fixture(name: string): CandidateInventoryContractFixture {
  const found = readFixtures().find((item) => item.fixtureName === name);
  assert(found, `Missing fixture ${name}`);
  return found;
}

function cloneVisibility(name = "candidate-inventory-no-gap"): LevelCandidateInventoryVisibility {
  return structuredClone(fixture(name).visibility);
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

test("candidate inventory visibility contract fixtures parse and validate", () => {
  const fixtures = readFixtures();

  assert.equal(fixtures.length, 5);
  for (const item of fixtures) {
    assert.equal(item.schemaVersion, "level-candidate-inventory-visibility-fixture/v1");
    assert.equal(validateLevelCandidateInventoryVisibility(item.visibility).valid, true, item.fixtureName);
    assert.equal(isLevelCandidateInventoryVisibility(item.visibility), true, item.fixtureName);
    assertLevelCandidateInventoryVisibilityFactsOnly(item.visibility);
    assert.deepEqual(summarizeLevelCandidateInventoryGaps(item.visibility), item.expectedClassification);
    assert.equal(item.factualOnlyStatus.checked, true);
    assert.equal(item.factualOnlyStatus.prohibitedLanguageHitCount, 0);
  }
});

test("candidate inventory visibility contract locks fixture classifications", () => {
  assert.deepEqual(summarizeLevelCandidateInventoryGaps(fixture("candidate-inventory-no-gap").visibility), {
    support: "no_gap",
    resistance: "no_gap",
    overall: "no_gap",
  });
  assert.deepEqual(summarizeLevelCandidateInventoryGaps(fixture("candidate-inventory-closer-unsurfaced-support").visibility), {
    support: "closer_unsurfaced_candidate",
    resistance: "no_gap",
    overall: "closer_unsurfaced_candidate",
  });
  assert.deepEqual(summarizeLevelCandidateInventoryGaps(fixture("candidate-inventory-closer-unsurfaced-resistance").visibility), {
    support: "no_gap",
    resistance: "closer_unsurfaced_candidate",
    overall: "closer_unsurfaced_candidate",
  });
  assert.deepEqual(summarizeLevelCandidateInventoryGaps(fixture("candidate-inventory-truthful-market-context-gap").visibility), {
    support: "truthful_market_context_gap",
    resistance: "truthful_market_context_gap",
    overall: "truthful_market_context_gap",
  });
  assert.deepEqual(summarizeLevelCandidateInventoryGaps(fixture("candidate-inventory-inconclusive-missing-reasons").visibility), {
    support: "inconclusive_missing_reasons",
    resistance: "inconclusive_missing_reasons",
    overall: "inconclusive_missing_reasons",
  });
});

test("candidate inventory visibility rejects malformed schema unknown stage and unknown classification", () => {
  const malformedSchema = {
    ...cloneVisibility(),
    schemaVersion: "level-candidate-inventory-visibility/v0",
  };
  const unknownStage = cloneVisibility();
  const unknownClassification = {
    ...cloneVisibility(),
    gapClassification: {
      support: "mystery_gap",
      resistance: "no_gap",
      overall: "no_gap",
    },
  };

  unknownStage.stageCounts = {
    ...unknownStage.stageCounts,
    unknown_stage: {
      stage: "raw",
      support: 0,
      resistance: 0,
      total: 0,
    },
  } as LevelCandidateInventoryVisibility["stageCounts"];

  assert.equal(validateLevelCandidateInventoryVisibility(malformedSchema).valid, false);
  assert.equal(validateLevelCandidateInventoryVisibility(unknownStage).valid, false);
  assert.equal(validateLevelCandidateInventoryVisibility(unknownClassification).valid, false);
});

test("candidate inventory visibility rejects missing or false safety flags", () => {
  const falseFlag = {
    ...cloneVisibility(),
    safety: {
      ...cloneVisibility().safety,
      readOnly: false,
    },
  };
  const missingFlag = cloneVisibility() as unknown as Record<string, unknown>;
  missingFlag.safety = {
    ...(missingFlag.safety as Record<string, unknown>),
    cacheFilesWritten: undefined,
  };

  assert.equal(validateLevelCandidateInventoryVisibility(falseFlag).valid, false);
  assert.equal(validateLevelCandidateInventoryVisibility(missingFlag).valid, false);
});

test("candidate inventory visibility facts-only assertion rejects prohibited language", () => {
  const unsafe = {
    ...cloneVisibility(),
    diagnostics: ["buy"],
  };

  assert.equal(validateLevelCandidateInventoryVisibility(unsafe).valid, true);
  assert.throws(
    () => assertLevelCandidateInventoryVisibilityFactsOnly(unsafe),
    /non-factual wording/,
  );
});

test("candidate inventory visibility helper does not mutate input", () => {
  const visibility = cloneVisibility("candidate-inventory-closer-unsurfaced-support");
  const before = structuredClone(visibility);

  validateLevelCandidateInventoryVisibility(visibility);
  summarizeLevelCandidateInventoryGaps(visibility);
  assertLevelCandidateInventoryVisibilityFactsOnly(visibility);

  assert.deepEqual(visibility, before);
});

test("candidate inventory visibility contract output remains facts-only", () => {
  for (const item of readFixtures()) {
    assertNoProhibitedLanguage(item.visibility);
    assertNoProhibitedLanguage(item.expectedClassification);
  }
});

test("candidate inventory visibility contract source stays isolated from providers cache writes alert monitoring Discord and journal paths", () => {
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
    "writefilesync",
  ]) {
    assert.equal(source.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
