import { it } from "node:test";
import assert from "node:assert/strict";
import { buildTradersLinkAiReadDeveloperPrompt } from "../lib/ai/traderslink-ai-read-service.js";
import { SIMPLE_ANALYSIS_PROMPT } from "../lib/ai/watchlist-simple-analysis.js";

for (const [name, prompt] of [
  ["owner review", buildTradersLinkAiReadDeveloperPrompt(true)],
  ["automatic", buildTradersLinkAiReadDeveloperPrompt(false)],
  ["simple", SIMPLE_ANALYSIS_PROMPT],
] as const) {
  it(name + " requests direct news wording without losing qualifications", () => {
    assert.match(prompt, /rewrite 'The supplied TradersLink article reports that GRML entered an agreement' as 'GRML entered an agreement\.'/);
    assert.match(prompt, /Preserve uncertainty, attribution to company claims, dates, amounts/);
    assert.match(prompt, /Before returning JSON, check visible news prose/);
    assert.match(prompt, /not a fact to reuse/);
    assert.match(prompt, /Do not add links to visible prose or change source metadata/);
  });
}
