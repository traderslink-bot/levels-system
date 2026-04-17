import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VALIDATION_LOOKBACKS,
  isStructurallyRequiredValidationTimeframe,
  resolveValidationLookbacks,
} from "../lib/validation/validation-lookback-config.js";

test("resolveValidationLookbacks returns defaults when env is unset", () => {
  const lookbacks = resolveValidationLookbacks({});

  assert.deepEqual(lookbacks, DEFAULT_VALIDATION_LOOKBACKS);
});

test("resolveValidationLookbacks honors positive env overrides", () => {
  const lookbacks = resolveValidationLookbacks({
    LEVEL_VALIDATION_LOOKBACK_DAILY: "220",
    LEVEL_VALIDATION_LOOKBACK_4H: "180",
    LEVEL_VALIDATION_LOOKBACK_5M: "240",
  });

  assert.deepEqual(lookbacks, {
    daily: 220,
    "4h": 180,
    "5m": 240,
  });
});

test("resolveValidationLookbacks ignores invalid env overrides", () => {
  const lookbacks = resolveValidationLookbacks({
    LEVEL_VALIDATION_LOOKBACK_DAILY: "0",
    LEVEL_VALIDATION_LOOKBACK_4H: "-5",
    LEVEL_VALIDATION_LOOKBACK_5M: "abc",
  });

  assert.deepEqual(lookbacks, DEFAULT_VALIDATION_LOOKBACKS);
});

test("isStructurallyRequiredValidationTimeframe only requires daily and 4h", () => {
  assert.equal(isStructurallyRequiredValidationTimeframe("daily"), true);
  assert.equal(isStructurallyRequiredValidationTimeframe("4h"), true);
  assert.equal(isStructurallyRequiredValidationTimeframe("5m"), false);
});
