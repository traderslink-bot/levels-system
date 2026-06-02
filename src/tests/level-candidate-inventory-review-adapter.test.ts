import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelCandidateInventoryReviewVisibility,
  buildMissingCandidateInventoryReviewVisibility,
  extractNearestCandidateInventoryRows,
  type LevelCandidateInventoryReviewAdapterInput,
} from "../lib/levels/level-candidate-inventory-review-adapter.js";
import {
  assertLevelCandidateInventoryReviewVisibilityFactsOnly,
  validateLevelCandidateInventoryReviewVisibilityWrapper,
  type LevelCandidateInventoryReviewVisibilityWrapper,
} from "../lib/levels/level-candidate-inventory-review-wiring.js";
import {
  summarizeLevelCandidateInventoryGaps,
  validateLevelCandidateInventoryVisibility,
  type LevelCandidateInventoryGapClassification,
} from "../lib/levels/level-candidate-inventory-visibility.js";
import type {
  LevelCandidatePoolDiagnosticsReport,
  LevelCandidatePoolStage,
  LevelCandidatePoolStageSummary,
} from "../lib/levels/level-candidate-pool-diagnostics.js";

type AdapterFixture = {
  schemaVersion: "level-candidate-inventory-review-adapter-fixture/v1";
  fixtureName: string;
  adapterInputSummary: {
    symbol: string;
    provider: string;
    referencePrice: number;
    scenario: string;
  };
  expectedWrapper: LevelCandidateInventoryReviewVisibilityWrapper;
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

const GENERATED_AT = Date.parse("2026-06-01T16:00:00.000Z");
const fixtureDir = fileURLToPath(
  new URL("../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/adapter-fixtures/", import.meta.url),
);

function readFixtures(): AdapterFixture[] {
  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => JSON.parse(readFileSync(`${fixtureDir}/${fileName}`, "utf8")) as AdapterFixture);
}

function fixture(name: string): AdapterFixture {
  const found = readFixtures().find((item) => item.fixtureName === name);
  assert(found, `Missing fixture ${name}`);
  return found;
}

function depth(prices: number[], referencePrice: number): LevelCandidatePoolStageSummary["depth"] {
  const below = prices.filter((price) => price < referencePrice);
  const above = prices.filter((price) => price > referencePrice);

  return {
    referencePrice,
    belowReferenceCount: below.length,
    atReferenceCount: prices.filter((price) => price === referencePrice).length,
    aboveReferenceCount: above.length,
    nearestBelowReference: below.length > 0 ? Math.max(...below) : undefined,
    farthestBelowReference: below.length > 0 ? Math.min(...below) : undefined,
    nearestAboveReference: above.length > 0 ? Math.min(...above) : undefined,
    farthestAboveReference: above.length > 0 ? Math.max(...above) : undefined,
  };
}

function stage(
  stageName: LevelCandidatePoolStage,
  prices: number[],
  referencePrice = 10,
): LevelCandidatePoolStageSummary {
  const sortedPrices = [...prices].sort((left, right) => left - right);

  return {
    stage: stageName,
    total: sortedPrices.length,
    prices: sortedPrices,
    priceRange:
      sortedPrices.length > 0
        ? { min: sortedPrices[0]!, max: sortedPrices.at(-1)! }
        : undefined,
    byTimeframe: {},
    byTimeframeBias: {},
    bySourceType: {},
    bySourceTypeSet: {},
    depth: depth(sortedPrices, referencePrice),
  };
}

function diagnostics(params: {
  symbol: string;
  referencePrice?: number;
  support: Partial<Record<LevelCandidatePoolStage, number[]>>;
  resistance: Partial<Record<LevelCandidatePoolStage, number[]>>;
}): LevelCandidatePoolDiagnosticsReport {
  const referencePrice = params.referencePrice ?? 10;
  const support = {
    side: "support" as const,
    raw: stage("raw", params.support.raw ?? [], referencePrice),
    clustered: stage("clustered", params.support.clustered ?? [], referencePrice),
    scored: stage("scored", params.support.scored ?? [], referencePrice),
    surfaced: stage("surfaced", params.support.surfaced ?? [], referencePrice),
    extensionCandidates: stage("extension_candidate", params.support.extension_candidate ?? [], referencePrice),
    selectedExtensions: stage("extension_selected", params.support.extension_selected ?? [], referencePrice),
    narrowing: [],
    warnings: [],
  };
  const resistance = {
    side: "resistance" as const,
    raw: stage("raw", params.resistance.raw ?? [], referencePrice),
    clustered: stage("clustered", params.resistance.clustered ?? [], referencePrice),
    scored: stage("scored", params.resistance.scored ?? [], referencePrice),
    surfaced: stage("surfaced", params.resistance.surfaced ?? [], referencePrice),
    extensionCandidates: stage("extension_candidate", params.resistance.extension_candidate ?? [], referencePrice),
    selectedExtensions: stage("extension_selected", params.resistance.extension_selected ?? [], referencePrice),
    narrowing: [],
    warnings: [],
  };

  return {
    symbol: params.symbol,
    referencePrice,
    summary: {
      rawCandidateCount: support.raw.total + resistance.raw.total,
      clusteredZoneCount: support.clustered.total + resistance.clustered.total,
      scoredZoneCount: support.scored.total + resistance.scored.total,
      surfacedLevelCount: support.surfaced.total + resistance.surfaced.total,
      extensionCandidateCount: support.extensionCandidates.total + resistance.extensionCandidates.total,
      selectedExtensionCount: support.selectedExtensions.total + resistance.selectedExtensions.total,
    },
    surfacedBucketCounts: {
      majorSupport: 0,
      majorResistance: 0,
      intermediateSupport: 0,
      intermediateResistance: 0,
      intradaySupport: support.surfaced.total,
      intradayResistance: resistance.surfaced.total,
    },
    support,
    resistance,
    narrowing: [],
    diagnostics: ["candidate_pool_diagnostics_only"],
    safety: {
      diagnosticOnly: true,
      levelOutputUnchanged: true,
      extensionGenerationUnchanged: true,
      noRuntimeBehaviorChange: true,
    },
  };
}

function adapterInput(name: string): LevelCandidateInventoryReviewAdapterInput {
  const item = fixture(name);
  const symbol = item.adapterInputSummary.symbol;
  const base = {
    symbol,
    provider: "fixture",
    asOfTimestamp: GENERATED_AT,
    asOfIso: "2026-06-01T16:00:00.000Z",
    referencePrice: item.adapterInputSummary.referencePrice,
    sourceFiles: {
      "5m": `fixture/${symbol}/5m.json`,
      "4h": `fixture/${symbol}/4h.json`,
      daily: `fixture/${symbol}/daily.json`,
    },
  };

  if (name === "adapter-missing-inventory") {
    return base;
  }
  if (name === "adapter-closer-unsurfaced-support") {
    return {
      ...base,
      candidatePoolDiagnostics: diagnostics({
        symbol,
        support: {
          raw: [8, 9.1, 9.75],
          clustered: [9.1, 9.75],
          scored: [9.1, 9.75],
          surfaced: [9.1],
          extension_candidate: [8],
          extension_selected: [8],
        },
        resistance: {
          raw: [10.3],
          clustered: [10.3],
          scored: [10.3],
          surfaced: [10.3],
        },
      }),
    };
  }
  if (name === "adapter-closer-unsurfaced-resistance") {
    return {
      ...base,
      candidatePoolDiagnostics: diagnostics({
        symbol,
        support: {
          raw: [9.8],
          clustered: [9.8],
          scored: [9.8],
          surfaced: [9.8],
        },
        resistance: {
          raw: [10.15, 10.9, 12],
          clustered: [10.15, 10.9],
          scored: [10.15, 10.9],
          surfaced: [10.9],
          extension_candidate: [12],
          extension_selected: [12],
        },
      }),
    };
  }
  if (name === "adapter-truthful-market-context-gap") {
    return {
      ...base,
      candidatePoolDiagnostics: diagnostics({
        symbol,
        support: {
          raw: [7.5],
          clustered: [7.5],
          scored: [7.5],
          surfaced: [7.5],
        },
        resistance: {
          raw: [13],
          clustered: [13],
          scored: [13],
          surfaced: [13],
        },
      }),
    };
  }

  return {
    ...base,
    candidatePoolDiagnostics: diagnostics({
      symbol,
      support: {
        raw: [9, 9.8],
        clustered: [9.8],
        scored: [9.8],
        surfaced: [9.8],
        extension_candidate: [8],
        extension_selected: [8],
      },
      resistance: {
        raw: [10.2, 11],
        clustered: [10.2],
        scored: [10.2],
        surfaced: [10.2],
        extension_candidate: [12],
        extension_selected: [12],
      },
    }),
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

test("candidate inventory review adapter fixtures parse and validate", () => {
  const fixtures = readFixtures();

  assert.equal(fixtures.length, 5);
  for (const item of fixtures) {
    assert.equal(item.schemaVersion, "level-candidate-inventory-review-adapter-fixture/v1");
    assert.equal(item.factualOnlyStatus.checked, true);
    assert.equal(item.factualOnlyStatus.prohibitedLanguageHitCount, 0);
    assert.equal(validateLevelCandidateInventoryReviewVisibilityWrapper(item.expectedWrapper).valid, true, item.fixtureName);
    assertLevelCandidateInventoryReviewVisibilityFactsOnly(item.expectedWrapper);
  }
});

test("adapter builds present wrapper for no-gap fixture", () => {
  const item = fixture("adapter-no-gap");
  const wrapper = buildLevelCandidateInventoryReviewVisibility(adapterInput(item.fixtureName));

  assert.deepEqual(wrapper, item.expectedWrapper);
  assert.deepEqual(wrapper.present ? wrapper.gapSummary : undefined, item.expectedClassification);
});

test("adapter builds closer-unsurfaced support and resistance wrappers", () => {
  for (const fixtureName of [
    "adapter-closer-unsurfaced-support",
    "adapter-closer-unsurfaced-resistance",
  ]) {
    const item = fixture(fixtureName);
    const wrapper = buildLevelCandidateInventoryReviewVisibility(adapterInput(item.fixtureName));

    assert.deepEqual(wrapper, item.expectedWrapper);
    assert.equal(wrapper.present, true);
    assert.deepEqual(wrapper.gapSummary, item.expectedClassification);
    assert.deepEqual(summarizeLevelCandidateInventoryGaps(wrapper.visibility), item.expectedClassification);
  }
});

test("adapter builds truthful market-context wrapper", () => {
  const item = fixture("adapter-truthful-market-context-gap");
  const wrapper = buildLevelCandidateInventoryReviewVisibility(adapterInput(item.fixtureName));

  assert.deepEqual(wrapper, item.expectedWrapper);
  assert.equal(wrapper.present, true);
  assert.equal(wrapper.gapSummary.overall, "truthful_market_context_gap");
});

test("adapter builds missing wrapper when inventory unavailable", () => {
  const item = fixture("adapter-missing-inventory");
  const wrapper = buildLevelCandidateInventoryReviewVisibility(adapterInput(item.fixtureName));

  assert.deepEqual(wrapper, item.expectedWrapper);
  assert.deepEqual(
    buildMissingCandidateInventoryReviewVisibility(),
    item.expectedWrapper,
  );
});

test("adapter validates nested visibility and review wrapper facts-only", () => {
  for (const item of readFixtures().filter((candidate) => candidate.expectedWrapper.present)) {
    const wrapper = buildLevelCandidateInventoryReviewVisibility(adapterInput(item.fixtureName));
    assert.equal(validateLevelCandidateInventoryReviewVisibilityWrapper(wrapper).valid, true);
    assertLevelCandidateInventoryReviewVisibilityFactsOnly(wrapper);

    assert.equal(wrapper.present, true);
    assert.equal(validateLevelCandidateInventoryVisibility(wrapper.visibility).valid, true);
  }
});

test("adapter extracts nearest candidate inventory rows by stage", () => {
  const input = adapterInput("adapter-closer-unsurfaced-support");
  const rows = extractNearestCandidateInventoryRows({
    diagnostics: input.candidatePoolDiagnostics,
    stage: "scored",
    referencePrice: input.referencePrice,
  });

  assert.deepEqual(rows.support, {
    stage: "scored",
    side: "support",
    price: 9.75,
    distancePct: 2.5,
  });
  assert.deepEqual(rows.resistance, {
    stage: "scored",
    side: "resistance",
    price: 10.3,
    distancePct: 3,
  });
});

test("adapter represents incomplete but present diagnostics as inconclusive", () => {
  const wrapper = buildLevelCandidateInventoryReviewVisibility({
    symbol: "INCON",
    provider: "fixture",
    asOfTimestamp: GENERATED_AT,
    asOfIso: "2026-06-01T16:00:00.000Z",
    referencePrice: 10,
    sourceFiles: {
      "5m": "fixture/INCON/5m.json",
      "4h": "fixture/INCON/4h.json",
      daily: "fixture/INCON/daily.json",
    },
    candidatePoolDiagnostics: diagnostics({
      symbol: "INCON",
      support: {
        surfaced: [8.4],
      },
      resistance: {
        surfaced: [11.9],
      },
    }),
  });

  assert.equal(wrapper.present, true);
  assert.deepEqual(wrapper.gapSummary, {
    support: "inconclusive_missing_reasons",
    resistance: "inconclusive_missing_reasons",
    overall: "inconclusive_missing_reasons",
  });
  assert(wrapper.visibility.limitations.includes("raw_clustered_scored_inventory_not_available"));
});

test("adapter handles malformed diagnostics with a safe missing wrapper", () => {
  const wrapper = buildLevelCandidateInventoryReviewVisibility({
    symbol: "BAD",
    provider: "fixture",
    referencePrice: 10,
    diagnostics: {
      support: {
        raw: {},
      },
    },
  });

  assert.deepEqual(wrapper, {
    present: false,
    limitations: ["raw_clustered_scored_inventory_not_available"],
    diagnostics: ["candidate_inventory_visibility_not_available"],
  });
});

test("adapter helpers do not mutate input", () => {
  const input = adapterInput("adapter-closer-unsurfaced-support");
  const before = structuredClone(input);

  buildLevelCandidateInventoryReviewVisibility(input);
  extractNearestCandidateInventoryRows({
    diagnostics: input.candidatePoolDiagnostics,
    stage: "surfaced",
    referencePrice: input.referencePrice,
  });

  assert.deepEqual(input, before);
});

test("adapter output and fixtures remain facts-only", () => {
  for (const item of readFixtures()) {
    const wrapper = buildLevelCandidateInventoryReviewVisibility(adapterInput(item.fixtureName));
    assertNoProhibitedLanguage(item);
    assertNoProhibitedLanguage(wrapper);
  }
});

test("candidate inventory review adapter source stays isolated and is not wired into packaged review yet", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/levels/level-candidate-inventory-review-adapter.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();
  const reviewRunnerSource = readFileSync(
    fileURLToPath(new URL("../scripts/run-level-quality-review.ts", import.meta.url)),
    "utf8",
  );

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

  assert.equal(reviewRunnerSource.includes("candidateInventoryVisibility"), false);
});
