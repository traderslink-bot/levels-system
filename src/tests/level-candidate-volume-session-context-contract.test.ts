import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertLevelCandidateVolumeSessionContextFactsOnly,
  isLevelCandidateVolumeSessionContext,
  validateLevelCandidateVolumeSessionContext,
  type LevelCandidateVolumeSessionComparisonOutcome,
  type LevelCandidateVolumeSessionContext,
} from "../lib/levels/level-candidate-volume-session-context.js";

type VolumeSessionContextFixture = {
  schemaVersion: "level-candidate-volume-session-context-fixture/v1";
  fixtureName: string;
  inputSummary: {
    scenario: string;
    rowCount: number;
    rawCandlesIncluded: boolean;
    fullSnapshotsIncluded: boolean;
  };
  context: LevelCandidateVolumeSessionContext;
  expected: {
    comparisonOutcome: LevelCandidateVolumeSessionComparisonOutcome;
    diagnostics: string[];
  };
  factualOnlyStatus: {
    checked: boolean;
    prohibitedLanguageHitCount: number;
  };
};

const fixtureDir = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/contract-fixtures/",
    import.meta.url,
  ),
);

function readFixtures(): VolumeSessionContextFixture[] {
  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => JSON.parse(readFileSync(`${fixtureDir}/${fileName}`, "utf8")) as VolumeSessionContextFixture);
}

function fixture(name: string): VolumeSessionContextFixture {
  const found = readFixtures().find((item) => item.fixtureName === name);
  assert(found, `Missing fixture ${name}`);
  return found;
}

function cloneContext(name = "volume-session-context-surfaced-vwap-shelf-overlap"): LevelCandidateVolumeSessionContext {
  return structuredClone(fixture(name).context);
}

function assertNoProhibitedLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
    ["recommendation", /\brecommendation\b/],
    ["advice", /\badvice\b|\btrade\s+advice\b/],
    ["grade", /\bgrade\b|\bgrading\b/],
    ["coaching", /\bcoaching\b|\bcoach\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["should have", /\bshould have\b/],
    ["should enter", /\bshould\s+enter\b/],
    ["should exit", /\bshould\s+exit\b/],
    ["should add", /\bshould\s+add\b/],
    ["should trim", /\bshould\s+trim\b/],
    ["mistake", /\bmistake\b/],
    ["discipline", /\bdiscipline\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} wording`);
  }
}

test("volume session context contract fixtures parse and validate", () => {
  const fixtures = readFixtures();

  assert.equal(fixtures.length, 5);
  assert.deepEqual(
    fixtures.map((item) => item.fixtureName).sort(),
    [
      "volume-session-context-closer-unsurfaced-less-context",
      "volume-session-context-missing-facts-inconclusive",
      "volume-session-context-no-nearby-context",
      "volume-session-context-surfaced-vwap-shelf-overlap",
      "volume-session-context-unsurfaced-more-context",
    ],
  );

  for (const item of fixtures) {
    assert.equal(item.schemaVersion, "level-candidate-volume-session-context-fixture/v1");
    assert.equal(item.inputSummary.rowCount, item.context.contexts.length, item.fixtureName);
    assert.equal(item.inputSummary.rawCandlesIncluded, false, item.fixtureName);
    assert.equal(item.inputSummary.fullSnapshotsIncluded, false, item.fixtureName);
    assert.equal(validateLevelCandidateVolumeSessionContext(item.context).valid, true, item.fixtureName);
    assert.equal(isLevelCandidateVolumeSessionContext(item.context), true, item.fixtureName);
    assertLevelCandidateVolumeSessionContextFactsOnly(item.context);
    assert.equal(item.context.comparisonSummary.outcome, item.expected.comparisonOutcome);
    for (const diagnostic of item.expected.diagnostics) {
      assert.equal(item.context.diagnostics.includes(diagnostic), true, `${item.fixtureName} missing ${diagnostic}`);
    }
    assert.equal(item.factualOnlyStatus.checked, true);
    assert.equal(item.factualOnlyStatus.prohibitedLanguageHitCount, 0);
  }
});

test("volume session context fixtures lock intended comparison outcomes", () => {
  assert.equal(
    fixture("volume-session-context-surfaced-vwap-shelf-overlap").context.comparisonSummary.outcome,
    "surfaced_has_more_session_volume_context",
  );
  assert.equal(
    fixture("volume-session-context-closer-unsurfaced-less-context").context.comparisonSummary.outcome,
    "surfaced_has_more_session_volume_context",
  );
  assert.equal(
    fixture("volume-session-context-unsurfaced-more-context").context.comparisonSummary.outcome,
    "unsurfaced_has_more_session_volume_context",
  );
  assert.equal(
    fixture("volume-session-context-missing-facts-inconclusive").context.comparisonSummary.outcome,
    "missing_facts_inconclusive",
  );
  assert.equal(
    fixture("volume-session-context-no-nearby-context").context.comparisonSummary.outcome,
    "no_nearby_session_volume_context",
  );
});

test("volume session context validates surfaced VWAP and shelf overlap details", () => {
  const context = fixture("volume-session-context-surfaced-vwap-shelf-overlap").context;
  const [row] = context.contexts;
  assert(row);

  assert.equal(row.stage, "surfaced");
  assert.equal(row.session.vwap?.fact, "vwap");
  assert.equal(row.session.vwap?.factsOnly, true);
  assert.equal(row.shelves.overlaps[0]?.relation, "overlaps");
  assert.equal(row.shelves.overlaps[0]?.factsOnly, true);
  assert.equal(row.safety.vwapFactsOnly, true);
  assert.equal(row.safety.shelvesAreFactsOnly, true);
});

test("volume session context validates missing facts and no-nearby context fixtures", () => {
  const missing = fixture("volume-session-context-missing-facts-inconclusive").context;
  const noNearby = fixture("volume-session-context-no-nearby-context").context;

  assert.equal(missing.comparisonSummary.outcome, "missing_facts_inconclusive");
  assert.equal(missing.diagnostics.includes("session_facts_missing"), true);
  assert.equal(missing.diagnostics.includes("volume_facts_missing"), true);
  assert.equal(missing.diagnostics.includes("volume_shelf_facts_missing"), true);

  assert.equal(noNearby.comparisonSummary.outcome, "no_nearby_session_volume_context");
  assert.equal(noNearby.contexts[0]?.session.nearbyFacts[0]?.relation, "outside_threshold");
  assert.equal(noNearby.contexts[0]?.shelves.nearbyShelfIds.length, 0);
});

test("volume session context rejects malformed schema stage side session fact relation and outcome", () => {
  const malformedSchema = {
    ...cloneContext(),
    schemaVersion: "level-candidate-volume-session-context/v0",
  };
  const unknownStage = cloneContext();
  const unknownSide = cloneContext();
  const unknownSessionFact = cloneContext();
  const unknownRelation = cloneContext();
  const unknownOutcome = cloneContext();

  unknownStage.contexts[0]!.stage = "hidden" as LevelCandidateVolumeSessionContext["contexts"][number]["stage"];
  unknownSide.contexts[0]!.side = "middle" as LevelCandidateVolumeSessionContext["contexts"][number]["side"];
  unknownSessionFact.contexts[0]!.session.nearbyFacts[0]!.fact = "midpoint" as LevelCandidateVolumeSessionContext["contexts"][number]["session"]["nearbyFacts"][number]["fact"];
  unknownRelation.contexts[0]!.shelves.overlaps[0]!.relation = "touches" as LevelCandidateVolumeSessionContext["contexts"][number]["shelves"]["overlaps"][number]["relation"];
  unknownOutcome.comparisonSummary.outcome = "change_selection" as LevelCandidateVolumeSessionComparisonOutcome;

  assert.equal(validateLevelCandidateVolumeSessionContext(malformedSchema).valid, false);
  assert.equal(validateLevelCandidateVolumeSessionContext(unknownStage).valid, false);
  assert.equal(validateLevelCandidateVolumeSessionContext(unknownSide).valid, false);
  assert.equal(validateLevelCandidateVolumeSessionContext(unknownSessionFact).valid, false);
  assert.equal(validateLevelCandidateVolumeSessionContext(unknownRelation).valid, false);
  assert.equal(validateLevelCandidateVolumeSessionContext(unknownOutcome).valid, false);
});

test("volume session context rejects missing or unsafe safety flags", () => {
  const unsafeRoot = cloneContext() as unknown as Record<string, unknown>;
  const unsafeRow = cloneContext() as unknown as Record<string, unknown>;
  const unsafeShelf = cloneContext() as unknown as Record<string, unknown>;

  (unsafeRoot.safety as Record<string, unknown>).volumeSessionFactsUsedForScoringOrSurfacedSelection = true;
  (((unsafeRow.contexts as Array<Record<string, unknown>>)[0]!.safety as Record<string, unknown>)).noRankingChange = false;
  (((((unsafeShelf.contexts as Array<Record<string, unknown>>)[0]!.shelves as Record<string, unknown>)
    .overlaps as Array<Record<string, unknown>>)[0]!)).factsOnly = false;

  assert.equal(validateLevelCandidateVolumeSessionContext(unsafeRoot).valid, false);
  assert.equal(validateLevelCandidateVolumeSessionContext(unsafeRow).valid, false);
  assert.equal(validateLevelCandidateVolumeSessionContext(unsafeShelf).valid, false);
  assert.throws(
    () => assertLevelCandidateVolumeSessionContextFactsOnly(unsafeRoot),
    /Invalid level candidate volume session context/,
  );
});

test("volume session context facts-only assertion rejects prohibited wording", () => {
  const unsafe = cloneContext();
  unsafe.diagnostics = ["should enter"];

  assert.equal(validateLevelCandidateVolumeSessionContext(unsafe).valid, true);
  assert.throws(
    () => assertLevelCandidateVolumeSessionContextFactsOnly(unsafe),
    /non-factual wording/,
  );
});

test("volume session context helpers do not mutate input", () => {
  const context = cloneContext("volume-session-context-unsurfaced-more-context");
  const before = structuredClone(context);

  validateLevelCandidateVolumeSessionContext(context);
  isLevelCandidateVolumeSessionContext(context);
  assertLevelCandidateVolumeSessionContextFactsOnly(context);

  assert.deepEqual(context, before);
});

test("volume session context fixtures remain facts-only", () => {
  for (const item of readFixtures()) {
    assertNoProhibitedLanguage(item.context);
    assertNoProhibitedLanguage(item.expected);
  }
});

test("volume session context source stays isolated from behavior providers cache alert monitoring Discord and journal paths", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/levels/level-candidate-volume-session-context.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  for (const blocked of [
    "../alerts/",
    "../monitoring/",
    "../trader-context/",
    "../market-data/",
    "level-engine",
    "level-ranker",
    "level-ranking",
    "level-clusterer",
    "level-extension-engine",
    "level-scorer",
    "raw-level-candidate-builder",
    "discord",
    "journal",
    "fetch(",
    "writefilesync",
  ]) {
    assert.equal(source.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
