import assert from "node:assert/strict";
import test from "node:test";

import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import { LevelStore } from "../lib/monitoring/level-store.js";

function buildZone(
  params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "symbol" | "kind">,
): FinalLevelZone {
  return {
    timeframeBias: "5m",
    zoneLow: params.kind === "support" ? 1.9 : 2.4,
    zoneHigh: params.kind === "support" ? 2.0 : 2.5,
    representativePrice: params.kind === "support" ? 1.95 : 2.45,
    strengthScore: 24,
    strengthLabel: "moderate",
    touchCount: 3,
    confluenceCount: 1,
    sourceTypes: [params.kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.62,
    rejectionScore: 0.4,
    displacementScore: 0.52,
    sessionSignificanceScore: 0.25,
    followThroughScore: params.followThroughScore ?? 0.68,
    gapContinuationScore: params.gapContinuationScore ?? 0,
    sourceEvidenceCount: 2,
    firstTimestamp: 1,
    lastTimestamp: 2,
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...params,
  };
}

function buildOutput(symbol: string, overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  return {
    symbol,
    generatedAt: Date.now(),
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
    },
    majorSupport: [],
    majorResistance: [],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [],
      resistance: [],
    },
    specialLevels: {},
    ...overrides,
  };
}

test("LevelStore preserves monitored zone identity across canonical overlap refreshes", () => {
  const store = new LevelStore();
  store.setLevels(
    buildOutput("ALBT", {
      intradayResistance: [
        buildZone({
          id: "R1",
          symbol: "ALBT",
          kind: "resistance",
          zoneLow: 2.4,
          zoneHigh: 2.5,
          representativePrice: 2.45,
        }),
      ],
    }),
  );

  const before = store.getResistanceZones("ALBT")[0];
  assert.ok(before);

  store.setLevels(
    buildOutput("ALBT", {
      intradayResistance: [
        buildZone({
          id: "R2",
          symbol: "ALBT",
          kind: "resistance",
          zoneLow: 2.43,
          zoneHigh: 2.53,
          representativePrice: 2.48,
        }),
      ],
    }),
  );

  const after = store.getResistanceZones("ALBT")[0];
  const context = after ? store.getZoneContext("ALBT", after.id) : undefined;

  assert.ok(after);
  assert.equal(after?.id, before?.id);
  assert.equal(context?.canonicalZoneId, "R2");
  assert.equal(context?.remapStatus, "preserved");
  assert.deepEqual(context?.remappedFromZoneIds, [before!.id]);
});

test("LevelStore marks split remaps when one prior monitored zone divides into multiple canonical zones", () => {
  const store = new LevelStore();
  store.setLevels(
    buildOutput("HUBC", {
      intradayResistance: [
        buildZone({
          id: "R1",
          symbol: "HUBC",
          kind: "resistance",
          zoneLow: 2.4,
          zoneHigh: 2.6,
          representativePrice: 2.5,
        }),
      ],
    }),
  );

  const original = store.getResistanceZones("HUBC")[0];
  assert.ok(original);

  store.setLevels(
    buildOutput("HUBC", {
      intradayResistance: [
        buildZone({
          id: "R2",
          symbol: "HUBC",
          kind: "resistance",
          zoneLow: 2.4,
          zoneHigh: 2.48,
          representativePrice: 2.44,
        }),
        buildZone({
          id: "R3",
          symbol: "HUBC",
          kind: "resistance",
          zoneLow: 2.52,
          zoneHigh: 2.6,
          representativePrice: 2.56,
        }),
      ],
    }),
  );

  const contexts = Object.values(store.getZoneContexts("HUBC"));
  const splitContexts = contexts.filter((context) => context.remapStatus === "split");

  assert.equal(splitContexts.length, 2);
  assert.ok(splitContexts.every((context) => context.remappedFromZoneIds.includes(original!.id)));
});

test("LevelStore replaces promoted extension identity with canonical lineage without duplicating monitored zones", () => {
  const store = new LevelStore();
  store.setLevels(
    buildOutput("BIRD", {
      intradayResistance: [
        buildZone({
          id: "R1",
          symbol: "BIRD",
          kind: "resistance",
          zoneLow: 2.4,
          zoneHigh: 2.5,
          representativePrice: 2.45,
        }),
      ],
      extensionLevels: {
        support: [],
        resistance: [
          buildZone({
            id: "XR1",
            symbol: "BIRD",
            kind: "resistance",
            zoneLow: 2.9,
            zoneHigh: 3.0,
            representativePrice: 2.95,
            isExtension: true,
          }),
        ],
      },
    }),
  );

  const promoted = store.activateExtensionLevels("BIRD", "resistance");
  const promotedZone = promoted.find((zone) => zone.representativePrice === 2.95);
  assert.ok(promotedZone);

  store.setLevels(
    buildOutput("BIRD", {
      intradayResistance: [
        buildZone({
          id: "R2",
          symbol: "BIRD",
          kind: "resistance",
          zoneLow: 2.91,
          zoneHigh: 3.01,
          representativePrice: 2.96,
        }),
      ],
    }),
  );

  const resistanceZones = store.getResistanceZones("BIRD");
  const replacement = resistanceZones.find((zone) => zone.representativePrice === 2.96);
  const context = replacement ? store.getZoneContext("BIRD", replacement.id) : undefined;

  assert.equal(resistanceZones.length, 1);
  assert.equal(replacement?.id, promotedZone?.id);
  assert.equal(context?.canonicalZoneId, "R2");
  assert.equal(context?.origin, "canonical");
  assert.equal(context?.remapStatus, "replaced");
});
