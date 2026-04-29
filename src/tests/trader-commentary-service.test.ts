import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAITraderCommentaryServiceFromEnv,
  extractResponseText,
  OpenAITraderCommentaryService,
  validateTraderCommentaryText,
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

test("validateTraderCommentaryText blocks short-side or direct execution wording", () => {
  assert.equal(validateTraderCommentaryText("This is a short setup under support."), null);
  assert.equal(validateTraderCommentaryText("Buy now if it clears resistance."), null);
  assert.equal(validateTraderCommentaryText("Limited downside to support at 1.04."), null);
  assert.equal(validateTraderCommentaryText("Wait to open new longs until price reclaims 3.04."), null);
  assert.equal(validateTraderCommentaryText("The next support is near 2.92."), null);
  assert.equal(
    validateTraderCommentaryText("Longs should wait for a reclaim before trusting the setup."),
    "Longs should wait for a reclaim before trusting the setup.",
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

test("OpenAITraderCommentaryService drops blocked commentary output", async () => {
  const service = new OpenAITraderCommentaryService({
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: "This is a short setup with a downside target near support.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
  });

  const result = await service.explainSignal({
    symbol: "ALBT",
    title: "ALBT support lost",
    deterministicBody: "support lost; longs need a reclaim",
  });

  assert.equal(result, null);
});

test("OpenAITraderCommentaryService normalizes safe unicode punctuation", async () => {
  const service = new OpenAITraderCommentaryService({
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: "Buyers need acceptance above resistance - confirmation still matters.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
  });

  const result = await service.explainSignal({
    symbol: "ALBT",
    title: "ALBT level touch",
    deterministicBody: "price testing resistance",
  });

  assert.equal(result?.text, "Buyers need acceptance above resistance - confirmation still matters.");
});

test("OpenAITraderCommentaryService drops downside support-target phrasing", async () => {
  const service = new OpenAITraderCommentaryService({
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: "Limited downside to next support near 1.04, so wait to open new longs.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
  });

  const result = await service.explainSignal({
    symbol: "ALBT",
    title: "ALBT level touch",
    deterministicBody: "price testing resistance",
  });

  assert.equal(result, null);
});

test("OpenAITraderCommentaryService sends long-only rules for signal explanations", async () => {
  let requestBody: any = null;
  const service = new OpenAITraderCommentaryService({
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          output_text: "Longs should wait for acceptance above resistance before trusting continuation.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });

  const result = await service.explainSignal({
    symbol: "ALBT",
    title: "ALBT breakout",
    deterministicBody: "breakout through resistance",
  });

  assert.match(result?.text ?? "", /Longs should wait/);
  assert.match(
    requestBody?.input?.[0]?.content?.[0]?.text ?? "",
    /long-only traders/i,
  );
  assert.match(
    requestBody?.input?.[0]?.content?.[0]?.text ?? "",
    /Use exactly 1 short sentence, 35 words max/i,
  );
  assert.match(
    requestBody?.input?.[0]?.content?.[0]?.text ?? "",
    /Do not use the words downside, target, objective/i,
  );
  assert.match(
    requestBody?.input?.[0]?.content?.[0]?.text ?? "",
    /support reaction area/i,
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
