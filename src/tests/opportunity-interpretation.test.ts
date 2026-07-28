import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AdaptedOpportunity } from "../lib/monitoring/adaptive-scoring.js";
import {
  APPROVED_INTERPRETATION_MESSAGE_TEMPLATES,
  OpportunityInterpretationLayer,
  formatInterpretationLevel,
  interpretOpportunity,
} from "../lib/monitoring/opportunity-interpretation.js";

function makeOpportunity(overrides: Partial<AdaptedOpportunity> = {}): AdaptedOpportunity {
  return {
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneKind: "support",
    level: 2.4,
    strength: 0.7,
    confidence: 0.65,
    priority: 70,
    bias: "bullish",
    pressureScore: 0.8,
    structureType: "breakout_setup",
    structureStrength: 0.6,
    timestamp: 1_000_000,
    score: 0.8,
    normalizedScore: 0.9,
    classification: "medium",
    adaptiveScore: 0.82,
    adaptiveMultiplier: 1.02,
    eventTypeExpectancy: 0.2,
    disabled: false,
    disableReason: null,
    ...overrides,
  };
}

describe("opportunity interpretation", () => {
  it("builds the exact in-zone message for small-cap level touches", () => {
    const interpretation = interpretOpportunity({
      opportunity: makeOpportunity(),
      levels: {
        referenceLevel: 2.4,
        zoneLabel: "support",
      },
      structure: {
        type: null,
        strength: 0.6,
      },
      adaptiveState: {
        adaptiveMultiplier: 1.02,
        weakStreak: 0,
      },
    });

    assert.equal(interpretation.type, "in_zone");
    assert.equal(interpretation.symbol, "ALBT");
    assert.equal(interpretation.message, "price testing support near 2.40 - watching reaction");
    assert.equal(interpretation.confidence, 0.71);
  });

  it("uses the exact weakening message when weak streak rises under negative adaptive pressure", () => {
    const interpretation = interpretOpportunity({
      opportunity: makeOpportunity({
        type: "reclaim",
        adaptiveMultiplier: 0.91,
      }),
      levels: {
        referenceLevel: 2.4,
        zoneLabel: "support",
      },
      structure: {
        type: null,
        strength: 0.6,
      },
      adaptiveState: {
        adaptiveMultiplier: 0.91,
        weakStreak: 2,
      },
    });

    assert.equal(interpretation.type, "weakening");
    assert.equal(interpretation.message, "support weakening near 2.40");
  });

  it("uses the exact pre-zone phrase map", () => {
    const breakoutPreZone = interpretOpportunity({
      opportunity: makeOpportunity({
        type: "breakout",
        eventType: "breakout",
      }),
      levels: {
        referenceLevel: 2.4,
        zoneLabel: "support",
      },
      structure: {
        type: null,
        strength: 0.6,
      },
      adaptiveState: {
        adaptiveMultiplier: 1.02,
        weakStreak: 0,
      },
    });
    const compressionPreZone = interpretOpportunity({
      opportunity: makeOpportunity({
        type: "compression",
        eventType: "compression",
      }),
      levels: {
        referenceLevel: 2.4,
        zoneLabel: "support",
      },
      structure: {
        type: null,
        strength: 0.6,
      },
      adaptiveState: {
        adaptiveMultiplier: 1.02,
        weakStreak: 0,
      },
    });

    assert.equal(breakoutPreZone.type, "pre_zone");
    assert.equal(breakoutPreZone.message, "watching pullback into support near 2.40");
    assert.equal(compressionPreZone.type, "pre_zone");
    assert.equal(compressionPreZone.message, "watching pullback into support near 2.40");
  });

  it("uses canonical event types when alert labels differ from monitoring events", () => {
    const interpretation = interpretOpportunity({
      opportunity: makeOpportunity({
        type: "consolidation",
        eventType: "compression",
        timestamp: 1_000_200,
      }),
      levels: {
        referenceLevel: 2.4,
        zoneLabel: "support",
      },
      structure: {
        type: null,
        strength: 0.6,
      },
      adaptiveState: {
        adaptiveMultiplier: 1.02,
        weakStreak: 0,
      },
    });

    assert.equal(interpretation.type, "pre_zone");
    assert.equal(interpretation.message, "watching pullback into support near 2.40");
    assert.deepEqual(interpretation.tags, [
      "pre_zone",
      "compression",
      "support",
      "no_structure",
    ]);
  });

  it("prefers the carried zone kind over inferred bias when building the message", () => {
    const interpretation = interpretOpportunity({
      opportunity: makeOpportunity({
        eventType: "level_touch",
        zoneKind: "resistance",
        bias: "bullish",
      }),
      levels: {
        referenceLevel: 2.4,
        zoneLabel: "resistance",
      },
      structure: {
        type: null,
        strength: 0.6,
      },
      adaptiveState: {
        adaptiveMultiplier: 1.02,
        weakStreak: 0,
      },
    });

    assert.equal(interpretation.type, "in_zone");
    assert.equal(interpretation.message, "price testing resistance near 2.40 - watching reaction");
    assert.deepEqual(interpretation.tags, [
      "in_zone",
      "level_touch",
      "resistance",
      "no_structure",
    ]);
  });

  it("uses the exact confirmation and breakout-context phrases", () => {
    const rejectionConfirmation = interpretOpportunity({
      opportunity: makeOpportunity({
        symbol: "BIRD",
        type: "rejection",
        eventType: "rejection",
      }),
      levels: {
        referenceLevel: 3.15,
        zoneLabel: "support",
      },
      structure: {
        type: "breakout_setup",
        strength: 0.6,
      },
      adaptiveState: {
        adaptiveMultiplier: 1.01,
        weakStreak: 0,
      },
    }, { stageRank: 2 });
    const reclaimConfirmation = interpretOpportunity({
      opportunity: makeOpportunity({
        symbol: "HUBC",
        type: "reclaim",
        eventType: "reclaim",
      }),
      levels: {
        referenceLevel: 1.18,
        zoneLabel: "support",
      },
      structure: {
        type: "breakout_setup",
        strength: 0.6,
      },
      adaptiveState: {
        adaptiveMultiplier: 1.01,
        weakStreak: 0,
      },
    }, { stageRank: 2 });
    const breakoutContext = interpretOpportunity({
      opportunity: makeOpportunity({
        symbol: "IMMP",
        type: "breakout",
        eventType: "breakout",
      }),
      levels: {
        referenceLevel: 0.88,
        zoneLabel: "support",
      },
      structure: {
        type: "breakout_setup",
        strength: 0.85,
      },
      adaptiveState: {
        adaptiveMultiplier: 1.04,
        weakStreak: 0,
      },
    }, { stageRank: 3 });

    assert.equal(rejectionConfirmation.type, "confirmation");
    assert.equal(rejectionConfirmation.message, "buyers reacting at support near 3.15");
    assert.equal(reclaimConfirmation.type, "confirmation");
    assert.equal(reclaimConfirmation.message, "buyers reacting at support near 1.18");
    assert.equal(breakoutContext.type, "breakout_context");
    assert.equal(breakoutContext.message, "holding above breakout level near 0.8800");
  });

  it("suppresses duplicate symbol-type-level messages during cooldown", () => {
    const layer = new OpportunityInterpretationLayer();
    const first = layer.interpret(makeOpportunity(), 0);
    const second = layer.interpret(makeOpportunity({ timestamp: 1_000_030 }), 0);

    assert.ok(first);
    assert.equal(second, null);
  });

  it("advances progression without skipping directly to confirmation", () => {
    const layer = new OpportunityInterpretationLayer();
    const confirmation = layer.interpret(makeOpportunity({
      symbol: "IMMP",
      type: "reclaim",
      eventType: "reclaim",
      timestamp: 1_010_000,
    }), 0);

    assert.ok(confirmation);
    assert.equal(confirmation.type, "in_zone");
    assert.equal(confirmation.message, "price testing support near 2.40 - watching reaction");
  });

  it("formats console output with the required fixed structure", () => {
    const layer = new OpportunityInterpretationLayer();
    const interpretation = layer.interpret(makeOpportunity({
      symbol: "BIRD",
      timestamp: 1_200_000,
    }), 0);

    assert.ok(interpretation);
    assert.equal(
      layer.formatForConsole(interpretation),
      [
        "SYMBOL: BIRD",
        "TYPE: in_zone",
        "EVENT: level_touch",
        "MESSAGE: price testing support near 2.40 - watching reaction",
        "CONFIDENCE: 0.71",
      ].join("\n"),
    );
  });

  it("is byte-identical for repeated identical inputs", () => {
    const context = {
      opportunity: makeOpportunity({
        symbol: "IMMP",
        type: "breakout",
        eventType: "breakout",
        level: 0.88,
        timestamp: 1_400_000,
      }),
      levels: {
        referenceLevel: 0.88,
        zoneLabel: "support" as const,
      },
      structure: {
        type: "breakout_setup",
        strength: 0.85,
      },
      adaptiveState: {
        adaptiveMultiplier: 1.04,
        weakStreak: 0,
      },
    };

    const first = JSON.stringify(interpretOpportunity(context, { stageRank: 3 }));
    const second = JSON.stringify(interpretOpportunity(context, { stageRank: 3 }));

    assert.equal(first, second);
  });

  it("covers every supported interpretation type with an approved deterministic message path", () => {
    const cases = [
      {
        expectedType: "pre_zone",
        level: 2.4,
        interpretation: interpretOpportunity({
          opportunity: makeOpportunity({ type: "compression", eventType: "compression", timestamp: 1_500_000 }),
          levels: { referenceLevel: 2.4, zoneLabel: "support" },
          structure: { type: null, strength: 0.4 },
          adaptiveState: { adaptiveMultiplier: 1.02, weakStreak: 0 },
        }),
      },
      {
        expectedType: "in_zone",
        level: 2.4,
        interpretation: interpretOpportunity({
          opportunity: makeOpportunity({ type: "level_touch", eventType: "level_touch", timestamp: 1_500_100 }),
          levels: { referenceLevel: 2.4, zoneLabel: "support" },
          structure: { type: null, strength: 0.4 },
          adaptiveState: { adaptiveMultiplier: 1.02, weakStreak: 0 },
        }),
      },
      {
        expectedType: "confirmation",
        level: 2.4,
        interpretation: interpretOpportunity({
          opportunity: makeOpportunity({ type: "reclaim", eventType: "reclaim", timestamp: 1_500_200 }),
          levels: { referenceLevel: 2.4, zoneLabel: "support" },
          structure: { type: null, strength: 0.4 },
          adaptiveState: { adaptiveMultiplier: 1.02, weakStreak: 0 },
        }, { stageRank: 2 }),
      },
      {
        expectedType: "weakening",
        level: 2.4,
        interpretation: interpretOpportunity({
          opportunity: makeOpportunity({
            type: "reclaim",
            eventType: "reclaim",
            adaptiveMultiplier: 0.95,
            timestamp: 1_500_300,
          }),
          levels: { referenceLevel: 2.4, zoneLabel: "support" },
          structure: { type: null, strength: 0.4 },
          adaptiveState: { adaptiveMultiplier: 0.95, weakStreak: 1 },
        }),
      },
      {
        expectedType: "breakout_context",
        level: 0.88,
        interpretation: interpretOpportunity({
          opportunity: makeOpportunity({ type: "breakout", eventType: "breakout", level: 0.88, timestamp: 1_500_400 }),
          levels: { referenceLevel: 0.88, zoneLabel: "support" },
          structure: { type: "breakout_setup", strength: 0.8 },
          adaptiveState: { adaptiveMultiplier: 1.04, weakStreak: 0 },
        }, { stageRank: 3 }),
      },
      {
        expectedType: "neutral",
        level: 2.4,
        interpretation: interpretOpportunity({
          opportunity: makeOpportunity({
            type: "fake_breakout",
            eventType: "fake_breakout",
            bias: "bearish",
            timestamp: 1_500_500,
          }),
          levels: { referenceLevel: 2.4, zoneLabel: "resistance" },
          structure: { type: null, strength: 0.2 },
          adaptiveState: { adaptiveMultiplier: 1, weakStreak: 0 },
        }),
      },
    ] as const;

    for (const item of cases) {
      assert.equal(item.interpretation.type, item.expectedType);
      assert.equal(
        item.interpretation.message,
        APPROVED_INTERPRETATION_MESSAGE_TEMPLATES[item.expectedType].replace(
          "{level}",
          formatInterpretationLevel(item.level),
        ),
      );
    }
  });
});
