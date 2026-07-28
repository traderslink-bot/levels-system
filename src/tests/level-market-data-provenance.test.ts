import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRawCandidateMarketDataProvenance,
  enrichMarketDataProvenanceFromTouches,
} from "../lib/levels/level-market-data-provenance.js";
import { LEVEL_SCORE_CONFIG } from "../lib/levels/level-score-config.js";
import type { LevelTouch } from "../lib/levels/level-types.js";

function touch(overrides: Partial<LevelTouch>): LevelTouch {
  return {
    candleTimestamp: 2_000,
    timeframe: "5m",
    reactionType: "tap",
    touchDistancePct: 0,
    reactionMovePct: 0,
    reactionMoveCandles: 0,
    volumeRatio: 1,
    closedAwayFromLevel: false,
    wickRejectStrength: 0,
    bodyRejectStrength: 0,
    ...overrides,
  };
}

describe("level market-data provenance", () => {
  it("uses later repeated source evidence as a test and confirmation", () => {
    assert.deepEqual(
      buildRawCandidateMarketDataProvenance({
        formedAt: 1_000,
        sourceLastSeenAt: 3_000,
        repeatedSourceConfirmation: true,
      }),
      {
        formedAt: 1_000,
        sourceLastSeenAt: 3_000,
        lastTestedAt: 3_000,
        lastConfirmedAt: 3_000,
      },
    );
  });

  it("does not treat the formation candle, clean breaks, or volume-only taps as confirmation", () => {
    const provenance = enrichMarketDataProvenanceFromTouches({
      provenance: buildRawCandidateMarketDataProvenance({ formedAt: 1_000 }),
      touches: [
        touch({ candleTimestamp: 1_000, reactionType: "rejection" }),
        touch({ candleTimestamp: 2_000, reactionType: "clean_break", volumeRatio: 2 }),
        touch({ candleTimestamp: 3_000, reactionType: "tap", volumeRatio: 2 }),
      ],
      config: LEVEL_SCORE_CONFIG,
    });

    assert.equal(provenance?.lastTestedAt, 3_000);
    assert.equal(provenance?.lastConfirmedAt, undefined);
  });

  it("records the latest directional rejection as confirmation", () => {
    const provenance = enrichMarketDataProvenanceFromTouches({
      provenance: buildRawCandidateMarketDataProvenance({ formedAt: 1_000 }),
      touches: [
        touch({
          candleTimestamp: 2_000,
          reactionType: "tap",
          reactionMovePct: 0.02,
          closedAwayFromLevel: true,
        }),
        touch({ candleTimestamp: 4_000, reactionType: "failed_break" }),
      ],
      config: LEVEL_SCORE_CONFIG,
    });

    assert.equal(provenance?.lastTestedAt, 4_000);
    assert.equal(provenance?.lastConfirmedAt, 4_000);
  });
});
