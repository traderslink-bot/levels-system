import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTradersLinkAiReadDeveloperPrompt, buildTradersLinkAiReadResponseSchema } from "../lib/ai/traderslink-ai-read-service.js";

for (const ownerReview of [false, true]) {
  test(`research sections are not requested (owner review: ${ownerReview})`, () => {
    const schema = buildTradersLinkAiReadResponseSchema(ownerReview);
    for (const key of ["dilutionRisk", "listingStatus"]) {
      assert.equal(Object.hasOwn(schema.properties, key), false);
      assert.equal((schema.required as readonly string[]).includes(key), false);
    }
    assert.ok(Object.hasOwn(schema.properties, "catalystRealityCheck"));
    assert.ok(Object.hasOwn(schema.properties, "pullbackPlans"));
    const prompt = buildTradersLinkAiReadDeveloperPrompt(ownerReview);
    assert.match(prompt, /Do not research dilution/);
    assert.match(prompt, /do not generate these sections/);
    assert.doesNotMatch(prompt, /For dilution research|Dilution has two separate clocks|use Nasdaq's official|Listing immediacy means/);
    assert.match(prompt, /sourceSummary, positivePoints, and negativePoints/);
  });
}
