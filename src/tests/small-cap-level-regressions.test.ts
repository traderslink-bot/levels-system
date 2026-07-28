import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiveWatchlistLevelMap,
  buildLiveWatchlistLevelsUnavailablePatch,
} from "../lib/live-watchlist/live-watchlist-publisher.js";
import { SMALL_CAP_LEVEL_REGRESSION_FIXTURES } from "./fixtures/small-cap-level-regressions.js";

for (const fixture of SMALL_CAP_LEVEL_REGRESSION_FIXTURES) {
  test(`${fixture.symbol} small-cap level-map regression: ${fixture.expected}`, () => {
    if (fixture.expected === "unavailable") {
      const patch = buildLiveWatchlistLevelsUnavailablePatch({
        symbol: fixture.symbol,
        timestamp: 1_750_000_000_000,
        currentPrice: fixture.currentPrice,
      });
      assert.equal(patch.levelMap, null);
      assert.match(patch.cards.nearestSupportResistance?.body ?? "", /temporarily unavailable/i);
      assert.match(patch.cards.nearestSupportResistance?.body ?? "", /do not treat the map as open air/i);
      return;
    }

    const map = buildLiveWatchlistLevelMap({
      currentPrice: fixture.currentPrice,
      supportZones: fixture.supportZones,
      resistanceZones: fixture.resistanceZones,
      preferStructuralLevels: true,
      roleFlipContext: fixture.roleFlipContext,
      specialLevels: fixture.specialLevels,
      dataQuality: fixture.levelDataQuality,
    });
    assert.ok(map);
    assert.ok(map.tradePlan);
    assert.ok(map.supportLevels.length <= 8);
    assert.ok(map.resistanceLevels.length <= 8);

    if (fixture.expected === "testing_flip") {
      assert.equal(map.resistanceLevels.find((level) => level.price === 1.05)?.roleFlipState, "testing");
      assert.equal(map.supportLevels.some((level) => level.price === 1.05), false);
    }
    if (fixture.expected === "confirmed_flip") {
      const flipped = map.supportLevels.find((level) => level.price === 6);
      assert.equal(flipped?.roleFlipState, "confirmed");
      assert.equal(flipped?.roleFlipFromSide, "resistance");
      assert.equal(map.resistanceLevels.some((level) => level.price === 13.35), false);
    }
    if (fixture.expected === "catalyst_references") {
      assert.deepEqual(
        map.referenceLevels?.map((level) => level.key),
        ["pmh", "pml", "orh", "orl", "hod", "lod", "pdh", "pdl", "pdc"],
      );
    }
    if (fixture.expected === "dense_ladder") {
      // The potential-path card keeps one strong structural checkpoint between
      // 30% and 50% away; it does not collapse the path to only nearby levels.
      assert.deepEqual(map.resistanceLevels.map((level) => level.price), [0.66, 0.7, 0.75, 0.92]);
      assert.equal(map.tradePlan?.mustClear?.price, 0.66);
      assert.deepEqual(map.tradePlan?.targets.map((level) => level.price), [0.7, 0.75]);
    }
    if (fixture.expected === "intraday_only") {
      assert.equal(map.dataQuality?.status, "limited");
      assert.deepEqual(map.dataQuality?.availableTimeframes, ["5m"]);
      assert.ok(map.tradePlan?.needsToHold);
      assert.ok(map.tradePlan?.mustClear);
    }
  });
}
