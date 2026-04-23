import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAITraderCommentaryServiceFromEnv,
  extractResponseText,
  OpenAITraderCommentaryService,
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

test("OpenAITraderCommentaryService summarizes a symbol thread from output_text", async () => {
  const service = new OpenAITraderCommentaryService({
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: "The symbol is still acting constructively, but the nearby path remains layered.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
  });

  const result = await service.summarizeSymbolThread({
    symbol: "ALBT",
    deterministicRecap: "state recap: breakout is still the lead idea near 2.45",
  });

  assert.equal(
    result?.text,
    "The symbol is still acting constructively, but the nearby path remains layered.",
  );
});

test("OpenAITraderCommentaryService identifies noisy families from output content fallback", async () => {
  const service = new OpenAITraderCommentaryService({
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: "- Compression alerts look noisiest.\n- Tune suppression around weak continuation cases.",
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
  });

  const result = await service.identifyNoisyFamilies({
    sessionSummary: {},
    threadSummaries: [],
  });

  assert.match(result?.text ?? "", /Compression alerts look noisiest/);
});
