import { OpenAITradersLinkAiReadService } from "../src/lib/ai/traderslink-ai-read-service.js";
import type { LevelSnapshotPayload } from "../src/lib/alerts/alert-types.js";
import type { TradersLinkAiReadPriceActionContext } from "../src/lib/ai/traderslink-ai-read-price-action.js";

const model = process.argv[2]?.trim();
const reasoningEffort = process.argv[3]?.trim().toLowerCase();
const apiKey = process.env.OPENAI_API_KEY?.trim();

if (!model || !apiKey || (reasoningEffort && !["low", "medium", "high", "xhigh"].includes(reasoningEffort))) {
  console.error("Usage: OPENAI_API_KEY=... tsx scripts/probe-traderslink-ai-read-model.ts <model> [low|medium|high|xhigh]");
  process.exitCode = 1;
} else {
  const dataAsOf = Date.now();
  const snapshot: LevelSnapshotPayload = {
    symbol: "TLQA",
    timestamp: dataAsOf,
    currentPrice: 1.36,
    marketStructure: null,
    supportZones: [],
    resistanceZones: [],
  } as LevelSnapshotPayload;
  const intradayCandles = Array.from({ length: 120 }, (_, index) => {
    const timestamp = dataAsOf - (119 - index) * 5 * 60 * 1_000;
    const open = 1.08 + index * 0.0022 + Math.sin(index / 4) * 0.018;
    const close = open + Math.cos(index / 3) * 0.009;
    return {
      timestamp,
      open,
      high: Math.max(open, close) + 0.015,
      low: Math.min(open, close) - 0.014,
      close,
      volume: 80_000 + index * 2_500,
    };
  });
  const dailyCandles = Array.from({ length: 30 }, (_, index) => {
    const timestamp = dataAsOf - (30 - index) * 24 * 60 * 60 * 1_000;
    const open = 0.88 + index * 0.014;
    const close = open + (index % 4 - 1.5) * 0.012;
    return {
      timestamp,
      open,
      high: Math.max(open, close) + 0.06,
      low: Math.min(open, close) - 0.045,
      close,
      volume: 500_000 + index * 12_000,
    };
  });
  const priceAction: TradersLinkAiReadPriceActionContext = {
    source: "synthetic test-only full-session OHLCV",
    fetchedAt: dataAsOf,
    priorRegularClose: 1.18,
    intradayCandles,
    dailyCandles,
  };
  const attempts: Array<Record<string, unknown>> = [];
  const service = new OpenAITradersLinkAiReadService({
    apiKey,
    model,
    fallbackModel: model,
    reasoningEffort: (reasoningEffort ?? "medium") as "low" | "medium" | "high" | "xhigh",
    webSearchEnabled: false,
    timeoutMs: 120_000,
    maxOutputTokens: 8_000,
  });
  const startedAt = Date.now();
  try {
    const read = await service.generate({
      snapshot,
      priceAction,
      research: { ticker: "TLQA", businessDays: 5, count: 0, articles: [] },
      generationId: `TLQA-PROBE-${dataAsOf}`,
      onAttempt: (attempt) => {
        attempts.push({
          attemptType: attempt.attemptType,
          status: attempt.status,
          model: attempt.model,
          clientRequestId: attempt.clientRequestId,
          durationMs: attempt.durationMs,
          timeoutOverrunMs: attempt.timeoutOverrunMs,
          inputTokens: attempt.usage.inputTokens,
          outputTokens: attempt.usage.outputTokens,
          estimatedTotalCostUsd: attempt.usage.estimatedTotalCostUsd,
          error: attempt.error,
        });
      },
    });
    console.log(JSON.stringify({
      ok: true,
      testOnly: true,
      model,
      reasoningEffort: reasoningEffort ?? "medium",
      elapsedMs: Date.now() - startedAt,
      attempts,
      result: {
        bias: read.bias,
        confidence: read.confidence,
        currentPrice: read.currentPrice,
        mustClear: read.mustClear.price,
        breakoutContinuation: read.breakoutContinuation.price,
        targetCount: read.targets.length,
        estimatedTotalCostUsd: read.usage.estimatedTotalCostUsd,
      },
    }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({
      ok: false,
      testOnly: true,
      model,
      reasoningEffort: reasoningEffort ?? "medium",
      elapsedMs: Date.now() - startedAt,
      attempts,
      error: message,
    }, null, 2));
    process.exitCode = 1;
  }
}
