import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AI_CLEAN_READ_REASONING_EFFORT,
  DEFAULT_AI_CLEAN_READ_TIMEOUT_MS,
  OpenAICleanReadService,
  appendAiCleanReadComment,
  appendAiCleanReadRecord,
  buildAiCleanReadPayload,
  buildCleanReadUserPrompt,
  createOpenAICleanReadServiceFromEnv,
  resolveAiCleanReadPaths,
  resolveLatestCleanReadSnapshotInput,
} from "../runtime/ai-clean-read.js";

test("buildCleanReadUserPrompt anchors the ladder to symbol and current price", () => {
  const prompt = buildCleanReadUserPrompt({
    symbol: " aim ",
    currentPrice: "0.4199",
    ladderText: "Resistance:\n0.4282\nNo additional resistance found below 0.8400 (+100.0%).\nSupport:\n0.4065",
    aiPromptNotes: "Watch if it calls 0.40 best buy.",
  });

  assert.match(prompt, /Ticker: \$AIM/);
  assert.match(prompt, /Current price: 0\.4199/);
  assert.match(prompt, /Optional trader note to send to OpenAI/);
  assert.match(prompt, /Resistance:/);
  assert.doesNotMatch(prompt, /No additional resistance found below/);
});

test("createOpenAICleanReadServiceFromEnv returns null without an API key", () => {
  assert.equal(createOpenAICleanReadServiceFromEnv({}), null);
});

test("OpenAICleanReadService uses a longer configurable timeout", async () => {
  let aborted = false;
  const service = new OpenAICleanReadService({
    apiKey: "test-key",
    timeoutMs: 5,
    fetchImpl: async (_url, init) => {
      await new Promise<void>((resolve) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          resolve();
        });
      });
      throw new Error("This operation was aborted");
    },
  });

  await assert.rejects(
    () =>
      service.generateCleanRead({
        symbol: "AIM",
        currentPrice: "0.4199",
        ladderText: "Resistance:\n0.4282\nSupport:\n0.4065",
      }),
    /aborted/,
  );
  assert.equal(aborted, true);
  assert.equal(DEFAULT_AI_CLEAN_READ_TIMEOUT_MS, 120_000);
});

test("resolveLatestCleanReadSnapshotInput pulls the latest posted watchlist ladder", () => {
  const sessionDirectory = mkdtempSync(join(tmpdir(), "ai-clean-read-snapshot-"));
  const auditPath = join(sessionDirectory, "discord-delivery-audit.jsonl");
  appendFileSync(
    auditPath,
    `${JSON.stringify({
      operation: "post_level_snapshot",
      status: "posted",
      symbol: "OLD",
      timestamp: 1,
      body: "OLD support and resistance\nPrice: 1.00\n\nMore support and resistance:\nResistance:\n1.10\n\nSupport:\n0.90",
    })}\n`,
  );
  appendFileSync(
    auditPath,
    `${JSON.stringify({
      operation: "post_level_snapshot",
      status: "posted",
      symbol: "AIM",
      timestamp: 2,
      body: [
        "AIM support and resistance",
        "Price: 0.4226",
        "",
        "Trade map:",
        "This text should not be sent as the ladder.",
        "",
        "More support and resistance:",
        "Resistance:",
        "0.4272 (+1.1%, heavy, 4h structure)",
        "",
        "Support:",
        "0.4065 (-3.8%, moderate, fresh intraday)",
      ].join("\n"),
    })}\n`,
  );

  const source = resolveLatestCleanReadSnapshotInput(sessionDirectory);

  assert.equal(source?.input.symbol, "AIM");
  assert.equal(source?.input.currentPrice, "0.4226");
  assert.match(source?.input.ladderText ?? "", /AIM full level ladder/);
  assert.match(source?.input.ladderText ?? "", /Resistance:/);
  assert.doesNotMatch(source?.input.ladderText ?? "", /This text should not be sent/);
  assert.equal(source?.timestamp, 2);
});

test("OpenAICleanReadService sends xhigh reasoning and clean-read template rules", async () => {
  let requestBody: any = null;
  const service = new OpenAICleanReadService({
    apiKey: "test-key",
    model: "gpt-test",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          output_text: [
            "Clean read:",
            "$0.4065-$0.4282 = key hold / reclaim area",
            "$0.4561-$0.4815 = next reclaim test",
            "$0.5039-$0.5454 = real momentum breakout zone",
            "$0.3702-$0.3945 = first dip-buy zone",
            "$0.3000-$0.3502 = deeper dip-buy zone",
            "Targets: $0.4561-$0.4815, $0.513-$0.5298",
          ].join("\n"),
          usage: {
            input_tokens: 1820,
            output_tokens: 940,
            total_tokens: 2760,
            input_tokens_details: {
              cached_tokens: 320,
            },
            output_tokens_details: {
              reasoning_tokens: 760,
            },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });

  const result = await service.generateCleanRead({
    symbol: "AIM",
    currentPrice: "0.4199",
    ladderText: "Resistance:\n0.4282\nSupport:\n0.4065",
  });

  assert.equal(result.model, "gpt-test");
  assert.equal(result.reasoningEffort, AI_CLEAN_READ_REASONING_EFFORT);
  assert.match(result.text, /^\$AIM\n\nCurrent Price: 0\.42\n\n/);
  assert.doesNotMatch(result.text, /Clean read:/);
  assert.match(result.text, /\$0\.4065-\$0\.4282 = current hold \/ decision area/);
  assert.match(result.text, /\$0\.4561-\$0\.4815 = next resistance \/ acceptance test/);
  assert.match(result.text, /\$0\.5039 = breakout trigger; \$0\.5454 = confirmation \/ expansion checkpoint/);
  assert.match(result.text, /\$0\.3702-\$0\.3945 = first pullback support area/);
  assert.match(result.text, /\$0\.3000-\$0\.3502 = deeper support \/ risk area/);
  assert.match(result.text, /Targets to consider: \$0\.4561-\$0\.4815, \$0\.5130-\$0\.5298/);
  assert.deepEqual(result.usage, {
    inputTokens: 1820,
    cachedInputTokens: 320,
    outputTokens: 940,
    reasoningTokens: 760,
    totalTokens: 2760,
    estimatedCostUsd: null,
  });
  assert.equal(result.pricing, null);
  assert.equal(requestBody?.reasoning?.effort, "xhigh");
  assert.equal(requestBody?.max_output_tokens, 5000);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /breakout trigger/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /Needs to hold:/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /Resistance above:/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /If support fails:/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /Every phrase must be correct relative to the current price/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /not the current price as a made-up zone endpoint/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /Always write price ranges from low to high/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /Do not make the breakout trigger a wide multi-target band/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /not a tradable level/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /Do not call any buy zone best/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /not tiny nearby resistance noise/);
  assert.match(requestBody?.input?.[0]?.content?.[0]?.text ?? "", /Targets to consider/);
  assert.match(requestBody?.input?.[1]?.content?.[0]?.text ?? "", /Ticker: \$AIM/);
});

test("AI clean-read normalization orders trader-style dollar ranges low to high", () => {
  const sessionDirectory = mkdtempSync(join(tmpdir(), "ai-clean-read-range-order-"));
  appendAiCleanReadRecord(
    sessionDirectory,
    {
      symbol: "LIMN",
      currentPrice: "0.2984",
      ladderText: "Resistance:\n0.3154 (+5.7%, moderate, daily confluence)\nSupport:\n0.2761 (-7.5%, moderate, daily structure)\n0.2551 (-14.5%, major, daily confluence)",
    },
    {
      text: [
        "$LIMN",
        "",
        "Current Price: 0.3",
        "",
        "Price is sitting between $0.276 support and $0.315 resistance.",
        "Needs to hold:",
        "$0.2761-$0.2551 area",
        "Resistance above:",
        "$0.3154 is the first test",
        "$0.3328 is the cleaner breakout trigger",
        "Targets to consider:",
        "$0.3497, $0.3750",
        "If support fails:",
        "$0.2761-$0.2551 is the next support area",
        "Read:",
        "Constructive while support holds.",
      ].join("\n"),
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      usage: null,
      pricing: null,
    },
  );

  const payload = buildAiCleanReadPayload({
    sessionDirectory,
    model: "gpt-5.5",
    openAiApiKeyPresent: true,
  });

  assert.match(payload.records[0]?.text ?? "", /\$0\.2551-\$0\.2761 area/);
  assert.match(payload.records[0]?.text ?? "", /\$0\.2551-\$0\.2761 is the next support area/);
  assert.doesNotMatch(payload.records[0]?.text ?? "", /\$0\.2761-\$0\.2551/);
});

test("AI clean-read normalization removes non-targetable ladder boundaries from targets", () => {
  const sessionDirectory = mkdtempSync(join(tmpdir(), "ai-clean-read-boundary-"));
  const record = appendAiCleanReadRecord(
    sessionDirectory,
    {
      symbol: "LIMN",
      currentPrice: "0.2984",
      ladderText: [
        "LIMN full level ladder",
        "Price: 0.2984",
        "",
        "Resistance:",
        "0.3154 (+5.7%, moderate, daily confluence)",
        "0.3328 (+11.5%, major, daily confluence)",
        "0.3497 (+17.2%, moderate, 4h structure)",
        "0.3750 (+25.7%, light, extension)",
        "0.4000 (+34.0%, light, extension)",
        "No additional resistance found below 0.5968 (+100.0%).",
        "",
        "Support:",
        "0.2761 (-7.5%, moderate, daily structure)",
      ].join("\n"),
    },
    {
      text: [
        "$0.2761-$0.3154 = key hold / reclaim area",
        "$0.3154-$0.3328 = next reclaim test",
        "$0.3328-$0.3497 = real momentum breakout zone",
        "$0.2551-$0.2761 = first dip-buy zone",
        "$0.2200-$0.2429 = deeper dip-buy zone",
        "Targets to consider: $0.3750, $0.4000, $0.5968",
      ].join("\n"),
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      usage: null,
      pricing: null,
    },
  );

  const payload = buildAiCleanReadPayload({
    sessionDirectory,
    model: "gpt-5.5",
    openAiApiKeyPresent: true,
  });

  assert.equal(payload.records[0]?.id, record.id);
  assert.match(payload.records[0]?.text ?? "", /Targets to consider: \$0\.3750, \$0\.4000/);
  assert.doesNotMatch(payload.records[0]?.text ?? "", /\$0\.5968/);
  assert.match(payload.records[0]?.ladderText ?? "", /No additional resistance found below/);
});

test("AI clean-read normalization repairs position-aware labels and wide breakout zones", () => {
  const sessionDirectory = mkdtempSync(join(tmpdir(), "ai-clean-read-labels-"));
  const record = appendAiCleanReadRecord(
    sessionDirectory,
    {
      symbol: "QUCY",
      currentPrice: "3.58",
      ladderText: "Resistance:\n3.67\n3.73\n3.93\n4.35\nSupport:\n3.52\n3.25",
    },
    {
      text: [
        "$3.52-$3.62 = key hold / reclaim area",
        "$3.67-$3.73 = next reclaim test",
        "$3.93-$4.35 = real momentum breakout zone",
        "$3.25-$3.33 = first dip-buy zone",
        "$3.09-$3.15 = deeper dip-buy zone",
        "Targets to consider: $4.50-$4.60, $4.77-$4.99, $5.25-$5.34",
      ].join("\n"),
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      usage: null,
      pricing: null,
    },
  );

  const payload = buildAiCleanReadPayload({
    sessionDirectory,
    model: "gpt-5.5",
    openAiApiKeyPresent: true,
  });

  assert.equal(payload.records[0]?.id, record.id);
  assert.match(payload.records[0]?.text ?? "", /\$3\.52-\$3\.62 = current hold \/ decision area/);
  assert.match(payload.records[0]?.text ?? "", /\$3\.67-\$3\.73 = next resistance \/ acceptance test/);
  assert.match(
    payload.records[0]?.text ?? "",
    /\$3\.93 = breakout trigger; \$4\.35 = confirmation \/ expansion checkpoint/,
  );
  assert.match(payload.records[0]?.text ?? "", /\$3\.25-\$3\.33 = first pullback support area/);
  assert.match(payload.records[0]?.text ?? "", /\$3\.09-\$3\.15 = deeper support \/ risk area/);
  assert.doesNotMatch(payload.records[0]?.text ?? "", /key hold \/ reclaim area/);
  assert.doesNotMatch(payload.records[0]?.text ?? "", /real momentum breakout zone/);
  assert.doesNotMatch(payload.records[0]?.text ?? "", /dip-buy zone/);
});

test("AI clean-read records and comments persist to jsonl audit files", () => {
  const sessionDirectory = mkdtempSync(join(tmpdir(), "ai-clean-read-"));
  const record = appendAiCleanReadRecord(
    sessionDirectory,
    {
      symbol: "aim",
      currentPrice: "0.4199",
      ladderText: "Resistance:\n0.4282\nSupport:\n0.4065",
      aiPromptNotes: "Watch for real volume before calling momentum.",
    },
    {
      text: "Clean read:\n$0.4065-$0.4282 = key hold / reclaim area",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      usage: {
        inputTokens: 2000,
        cachedInputTokens: 500,
        outputTokens: 1000,
        reasoningTokens: 850,
        totalTokens: 3000,
        estimatedCostUsd: 0.03775,
      },
      pricing: {
        model: "gpt-5.5",
        inputUsdPerMillion: 5,
        cachedInputUsdPerMillion: 0.5,
        outputUsdPerMillion: 30,
      },
    },
  );
  const comment = appendAiCleanReadComment(sessionDirectory, {
    cleanReadId: record.id,
    symbol: "AIM",
    comments: "Good zone grouping for audit.",
  });

  const paths = resolveAiCleanReadPaths(sessionDirectory);
  const payload = buildAiCleanReadPayload({
    sessionDirectory,
    model: "gpt-5.5",
    openAiApiKeyPresent: true,
  });

  assert.match(readFileSync(paths.recordsPath, "utf8"), /Clean read/);
  assert.match(readFileSync(paths.recordsPath, "utf8"), /Watch for real volume/);
  assert.match(readFileSync(paths.commentsPath, "utf8"), /Good zone grouping/);
  assert.equal(payload.records[0]?.id, record.id);
  assert.match(payload.records[0]?.text ?? "", /^\$AIM\n\nCurrent Price: 0\.42\n\n/);
  assert.doesNotMatch(payload.records[0]?.text ?? "", /Clean read:/);
  assert.equal(payload.records[0]?.latestComment?.id, comment.id);
  assert.equal(payload.records[0]?.symbol, "AIM");
  assert.equal(payload.records[0]?.aiPromptNotes, "Watch for real volume before calling momentum.");
  assert.equal(payload.records[0]?.usage?.totalTokens, 3000);
  assert.equal(payload.usageSummary.recordsWithUsage, 1);
  assert.equal(payload.usageSummary.totalTokens, 3000);
  assert.equal(payload.usageSummary.reasoningTokens, 850);
  assert.equal(payload.usageSummary.estimatedCostUsd, 0.03775);
});
