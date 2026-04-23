import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAITraderCommentaryServiceFromEnv,
  extractResponseText,
} from "../lib/ai/trader-commentary-service.js";

test("extractResponseText prefers output_text when present", () => {
  assert.equal(
    extractResponseText({
      output_text: "Short recap.",
      output: [],
    }),
    "Short recap.",
  );
});

test("extractResponseText falls back to output content items", () => {
  assert.equal(
    extractResponseText({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: "Fallback recap.",
            },
          ],
        },
      ],
    }),
    "Fallback recap.",
  );
});

test("createOpenAITraderCommentaryServiceFromEnv returns null without an API key", () => {
  assert.equal(
    createOpenAITraderCommentaryServiceFromEnv({}),
    null,
  );
});
