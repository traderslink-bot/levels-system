import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertLevelCandidateVolumeSessionContextFactsOnly,
  validateLevelCandidateVolumeSessionContext,
  type LevelCandidateVolumeSessionComparisonOutcome,
  type LevelCandidateVolumeSessionContext,
} from "../lib/levels/level-candidate-volume-session-context.js";
import {
  buildLevelCandidateVolumeSessionContext,
  buildLevelCandidateVolumeSessionContextRow,
  findNearbySessionFactsForCandidate,
  findVolumeShelfOverlapsForCandidate,
  type BuildLevelCandidateVolumeSessionContextRequest,
} from "../lib/levels/level-candidate-volume-session-context-builder.js";
import type { SessionMarketFacts } from "../lib/session/session-market-facts.js";
import type { VolumeMarketFacts } from "../lib/volume/volume-market-facts.js";
import type { VolumeShelf } from "../lib/volume/volume-shelf-detector.js";

type BuilderFixture = {
  schemaVersion: "level-candidate-volume-session-context-builder-fixture/v1";
  fixtureName: string;
  inputSummary: {
    scenario: string;
    rowCount: number;
    sessionFactsPresent: boolean;
    volumeFactsPresent: boolean;
    volumeShelvesPresent: boolean;
    rawCandlesIncluded: false;
    fullSnapshotsIncluded: false;
  };
  expectedContext: LevelCandidateVolumeSessionContext;
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
    "../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/builder-fixtures/",
    import.meta.url,
  ),
);
const asOfTimestamp = 1_780_329_600_000;
const asOfIso = "2026-06-01T16:00:00.000Z";

function readFixtures(): BuilderFixture[] {
  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => JSON.parse(readFileSync(`${fixtureDir}/${fileName}`, "utf8")) as BuilderFixture);
}

function fixture(name: string): BuilderFixture {
  const found = readFixtures().find((item) => item.fixtureName === name);
  assert(found, `Missing fixture ${name}`);
  return found;
}

function sessionFacts(symbol: string, overrides: Partial<SessionMarketFacts>): SessionMarketFacts {
  return {
    symbol,
    asOfTimestamp,
    sessionDate: "2026-06-01",
    diagnostics: [],
    ...overrides,
  };
}

function volumeFacts(symbol: string, overrides: Partial<VolumeMarketFacts>): VolumeMarketFacts {
  return {
    symbol,
    asOfTimestamp,
    volumeState: "normal",
    liquidityQuality: "acceptable",
    accelerationState: "steady",
    pullbackVolumeState: "normal",
    breakoutVolumeState: "not_applicable",
    diagnostics: [],
    ...overrides,
  };
}

function volumeShelf(overrides: Partial<VolumeShelf>): VolumeShelf {
  return {
    id: "fixture-shelf",
    zoneLow: 1,
    zoneHigh: 2,
    representativePrice: 1.5,
    totalVolume: 1,
    dollarVolume: 1,
    percentOfWindowVolume: 1,
    touchCount: 1,
    firstTimestamp: asOfTimestamp - 1_000,
    lastTimestamp: asOfTimestamp,
    shelfRole: "unknown",
    confidence: 0.5,
    reason: "Fixture shelf fact.",
    ...overrides,
  };
}

function fixtureInputs(): Record<string, BuildLevelCandidateVolumeSessionContextRequest> {
  return {
    "builder-surfaced-vwap-shelf-overlap": {
      symbol: "FIXA",
      provider: "ibkr",
      asOfTimestamp,
      asOfIso,
      referencePrice: 10.25,
      rows: [
        {
          rowId: "surfaced-support-1",
          levelId: "FIXA-support-zone-1",
          side: "support",
          stage: "surfaced",
          price: 10.12,
          zoneLow: 10.08,
          zoneHigh: 10.16,
        },
      ],
      sessionFacts: sessionFacts("FIXA", {
        vwap: 10.1,
        openingRangeLow: 10.08,
      }),
      volumeFacts: volumeFacts("FIXA", {
        relativeVolume: 2.1,
        dollarVolume: 840_000,
        volumeState: "elevated",
        accelerationState: "building",
        pullbackVolumeState: "drying_up",
      }),
      volumeShelves: [
        volumeShelf({
          id: "FIXA-shelf-1",
          zoneLow: 10.05,
          zoneHigh: 10.18,
          representativePrice: 10.11,
          totalVolume: 125_000,
          dollarVolume: 1_263_750,
          percentOfWindowVolume: 22.5,
          shelfRole: "support",
        }),
      ],
    },
    "builder-closer-unsurfaced-less-context": {
      symbol: "FIXB",
      provider: "ibkr",
      asOfTimestamp,
      asOfIso,
      referencePrice: 4.2,
      rows: [
        {
          rowId: "surfaced-support-1",
          levelId: "FIXB-support-zone-4",
          side: "support",
          stage: "surfaced",
          price: 3.96,
          zoneLow: 3.93,
          zoneHigh: 4,
        },
        {
          rowId: "unsurfaced-support-1",
          candidateId: "FIXB-scored-support-2",
          side: "support",
          stage: "scored",
          price: 4.08,
        },
      ],
      sessionFacts: sessionFacts("FIXB", {
        vwap: 4.02,
        premarketLow: 3.95,
      }),
      volumeFacts: volumeFacts("FIXB", {
        relativeVolume: 1.8,
        dollarVolume: 520_000,
        volumeState: "elevated",
        pullbackVolumeState: "drying_up",
      }),
      volumeShelves: [
        volumeShelf({
          id: "FIXB-shelf-2",
          zoneLow: 3.9,
          zoneHigh: 4.01,
          representativePrice: 3.97,
          totalVolume: 92_000,
          dollarVolume: 365_240,
          percentOfWindowVolume: 18.4,
          shelfRole: "support",
        }),
      ],
    },
    "builder-unsurfaced-more-context": {
      symbol: "FIXC",
      provider: "ibkr",
      asOfTimestamp,
      asOfIso,
      referencePrice: 21.5,
      rows: [
        {
          rowId: "surfaced-support-1",
          levelId: "FIXC-support-zone-9",
          side: "support",
          stage: "surfaced",
          price: 19.4,
          zoneLow: 19.25,
          zoneHigh: 19.55,
        },
        {
          rowId: "unsurfaced-support-1",
          candidateId: "FIXC-scored-support-4",
          side: "support",
          stage: "scored",
          price: 20.6,
        },
      ],
      sessionFacts: sessionFacts("FIXC", {
        vwap: 20.62,
        regularSessionOpen: 20.55,
      }),
      volumeFacts: volumeFacts("FIXC", {
        relativeVolume: 2.8,
        dollarVolume: 2_450_000,
        volumeState: "high",
        liquidityQuality: "good",
        accelerationState: "building",
        pullbackVolumeState: "drying_up",
        breakoutVolumeState: "confirmed",
      }),
      volumeShelves: [
        volumeShelf({
          id: "FIXC-shelf-3",
          zoneLow: 20.5,
          zoneHigh: 20.7,
          representativePrice: 20.61,
          totalVolume: 184_000,
          dollarVolume: 3_792_240,
          percentOfWindowVolume: 31.2,
          shelfRole: "support",
        }),
      ],
    },
    "builder-missing-facts-inconclusive": {
      symbol: "FIXD",
      provider: "ibkr",
      asOfTimestamp,
      asOfIso,
      referencePrice: 0.82,
      rows: [
        {
          rowId: "surfaced-support-1",
          levelId: "FIXD-support-zone-1",
          side: "support",
          stage: "surfaced",
          price: 0.74,
        },
      ],
    },
    "builder-no-nearby-context": {
      symbol: "FIXE",
      provider: "ibkr",
      asOfTimestamp,
      asOfIso,
      referencePrice: 7.5,
      rows: [
        {
          rowId: "surfaced-resistance-1",
          levelId: "FIXE-resistance-zone-1",
          side: "resistance",
          stage: "surfaced",
          price: 8.9,
          zoneLow: 8.82,
          zoneHigh: 8.96,
        },
      ],
      sessionFacts: sessionFacts("FIXE", {
        highOfDay: 7.62,
      }),
      volumeFacts: volumeFacts("FIXE", {
        relativeVolume: 1.1,
        dollarVolume: 620_000,
      }),
      volumeShelves: [],
    },
  };
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

test("volume session context builder fixtures parse and validate", () => {
  const fixtures = readFixtures();

  assert.equal(fixtures.length, 5);
  assert.deepEqual(
    fixtures.map((item) => item.fixtureName).sort(),
    [
      "builder-closer-unsurfaced-less-context",
      "builder-missing-facts-inconclusive",
      "builder-no-nearby-context",
      "builder-surfaced-vwap-shelf-overlap",
      "builder-unsurfaced-more-context",
    ],
  );

  for (const item of fixtures) {
    assert.equal(item.schemaVersion, "level-candidate-volume-session-context-builder-fixture/v1");
    assert.equal(item.inputSummary.rowCount, item.expectedContext.contexts.length, item.fixtureName);
    assert.equal(item.inputSummary.rawCandlesIncluded, false, item.fixtureName);
    assert.equal(item.inputSummary.fullSnapshotsIncluded, false, item.fixtureName);
    assert.equal(validateLevelCandidateVolumeSessionContext(item.expectedContext).valid, true, item.fixtureName);
    assertLevelCandidateVolumeSessionContextFactsOnly(item.expectedContext);
    assert.equal(item.expectedContext.comparisonSummary.outcome, item.expected.comparisonOutcome);
    for (const diagnostic of item.expected.diagnostics) {
      assert.equal(item.expectedContext.diagnostics.includes(diagnostic), true, `${item.fixtureName} missing ${diagnostic}`);
    }
    assert.equal(item.factualOnlyStatus.checked, true);
    assert.equal(item.factualOnlyStatus.prohibitedLanguageHitCount, 0);
  }
});

test("builder creates exact expected contexts from deterministic fixture scenarios", () => {
  const inputs = fixtureInputs();

  for (const item of readFixtures()) {
    const input = inputs[item.fixtureName];
    assert(input, `Missing builder input for ${item.fixtureName}`);
    const actual = buildLevelCandidateVolumeSessionContext(input);
    assert.deepEqual(actual, item.expectedContext, item.fixtureName);
  }
});

test("builder creates surfaced VWAP and shelf overlap context", () => {
  const context = buildLevelCandidateVolumeSessionContext(fixtureInputs()["builder-surfaced-vwap-shelf-overlap"]!);
  const [row] = context.contexts;
  assert(row);

  assert.equal(context.comparisonSummary.outcome, "surfaced_has_more_session_volume_context");
  assert.equal(row.session.vwap?.fact, "vwap");
  assert.equal(row.session.vwap?.factsOnly, true);
  assert.equal(row.shelves.overlaps[0]?.relation, "overlaps");
  assert.equal(row.shelves.overlaps[0]?.factsOnly, true);
  assert.equal(row.diagnostics.includes("surfaced_vwap_shelf_overlap_context_present"), true);
});

test("builder creates closer-unsurfaced less-context comparison", () => {
  const context = buildLevelCandidateVolumeSessionContext(fixtureInputs()["builder-closer-unsurfaced-less-context"]!);

  assert.equal(context.comparisonSummary.outcome, "surfaced_has_more_session_volume_context");
  assert.equal(context.comparisonSummary.unsurfacedRowIds.includes("unsurfaced-support-1"), true);
  assert.equal(context.diagnostics.includes("closer_unsurfaced_less_session_volume_context"), true);
});

test("builder creates unsurfaced more-context comparison", () => {
  const context = buildLevelCandidateVolumeSessionContext(fixtureInputs()["builder-unsurfaced-more-context"]!);

  assert.equal(context.comparisonSummary.outcome, "unsurfaced_has_more_session_volume_context");
  assert.equal(context.contexts[1]?.shelves.overlaps[0]?.shelfId, "FIXC-shelf-3");
  assert.equal(context.diagnostics.includes("unsurfaced_more_session_volume_context"), true);
});

test("builder creates missing-facts inconclusive context", () => {
  const context = buildLevelCandidateVolumeSessionContext(fixtureInputs()["builder-missing-facts-inconclusive"]!);

  assert.equal(context.comparisonSummary.outcome, "missing_facts_inconclusive");
  assert.equal(context.diagnostics.includes("session_facts_missing"), true);
  assert.equal(context.diagnostics.includes("volume_facts_missing"), true);
  assert.equal(context.diagnostics.includes("volume_shelf_facts_missing"), true);
});

test("builder creates no-nearby context summary", () => {
  const context = buildLevelCandidateVolumeSessionContext(fixtureInputs()["builder-no-nearby-context"]!);

  assert.equal(context.comparisonSummary.outcome, "no_nearby_session_volume_context");
  assert.equal(context.contexts[0]?.session.nearbyFacts[0]?.relation, "outside_threshold");
  assert.equal(context.contexts[0]?.shelves.nearbyShelfIds.length, 0);
});

test("builder computes distance from reference when missing", () => {
  const row = buildLevelCandidateVolumeSessionContextRow({
    row: {
      rowId: "distance-row",
      levelId: "distance-level",
      side: "support",
      stage: "surfaced",
      price: 9,
    },
    referencePrice: 10,
    sessionFacts: sessionFacts("DIST", { vwap: 9 }),
    volumeFacts: volumeFacts("DIST", { relativeVolume: 1, dollarVolume: 100_000 }),
    volumeShelves: [],
  });

  assert.equal(row.distanceFromReferencePct, 10);
});

test("session fact proximity threshold works", () => {
  const row = {
    rowId: "threshold-row",
    levelId: "threshold-level",
    side: "support",
    stage: "surfaced",
    price: 10,
  } as const;

  assert.equal(
    findNearbySessionFactsForCandidate({
      row,
      sessionFacts: sessionFacts("THR", { vwap: 10.08 }),
      sessionNearPct: 1,
    })[0]?.relation,
    "near",
  );
  assert.equal(
    findNearbySessionFactsForCandidate({
      row,
      sessionFacts: sessionFacts("THR", { vwap: 10.3 }),
      sessionNearPct: 1,
    })[0]?.relation,
    "outside_threshold",
  );
});

test("shelf overlap and proximity work", () => {
  const row = {
    rowId: "shelf-row",
    levelId: "shelf-level",
    side: "support",
    stage: "surfaced",
    price: 10,
    zoneLow: 9.95,
    zoneHigh: 10.05,
  } as const;
  const overlaps = findVolumeShelfOverlapsForCandidate({
    row,
    volumeShelves: [
      volumeShelf({ id: "overlap", zoneLow: 10, zoneHigh: 10.1, representativePrice: 10.02 }),
      volumeShelf({ id: "near", zoneLow: 10.12, zoneHigh: 10.15, representativePrice: 10.13 }),
    ],
    volumeShelfNearPct: 2,
  });

  assert.equal(overlaps[0]?.shelfId, "overlap");
  assert.equal(overlaps[0]?.relation, "overlaps");
  assert.equal(overlaps[1]?.shelfId, "near");
  assert.equal(overlaps[1]?.relation, "near");
});

test("builder output validates and remains facts-only", () => {
  for (const input of Object.values(fixtureInputs())) {
    const context = buildLevelCandidateVolumeSessionContext(input);
    assert.equal(validateLevelCandidateVolumeSessionContext(context).valid, true);
    assertLevelCandidateVolumeSessionContextFactsOnly(context);
    assertNoProhibitedLanguage(context);
  }
});

test("facts-only assertion rejects prohibited wording if injected", () => {
  const context = buildLevelCandidateVolumeSessionContext(fixtureInputs()["builder-surfaced-vwap-shelf-overlap"]!);
  context.diagnostics.push("should enter");

  assert.throws(
    () => assertLevelCandidateVolumeSessionContextFactsOnly(context),
    /non-factual wording/,
  );
});

test("builder helpers do not mutate inputs", () => {
  const input = fixtureInputs()["builder-unsurfaced-more-context"]!;
  const before = structuredClone(input);

  buildLevelCandidateVolumeSessionContext(input);

  assert.deepEqual(input, before);
});

test("builder source stays isolated from generation providers cache alert monitoring Discord and journal paths", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/levels/level-candidate-volume-session-context-builder.ts", import.meta.url)),
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
