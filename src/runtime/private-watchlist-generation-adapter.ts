import { OpenAITradersLinkAiReadService, type TradersLinkAiReadService } from "../lib/ai/traderslink-ai-read-service.js";
import type { LevelEngineOutputWithCandleSeries } from "../lib/levels/level-engine.js";
import type { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { buildLevelSnapshotPayloadFromEngineOutput } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { buildLiveWatchlistPotentialPathPresentation, buildLiveWatchlistTechnicalContextPatch, buildTradersLinkAiReadPatch } from "../lib/live-watchlist/live-watchlist-publisher.js";
import { lookupOfficialWatchlistArticleSource } from "../lib/live-watchlist/official-watchlist-article-source.js";
import { buildTechnicalContextFromCandles } from "../lib/technical-context/technical-context.js";
import { resolveStockLevelsReferencePrice, isUsableStockLevelsPrice } from "./stock-levels-reference-price.js";
import type { PrivateWatchlistGenerationRequest, PrivateWatchlistInput } from "./private-watchlist-contract.js";
import type { BoundedPrivateWatchlistGenerator, PrivateGenerationResult, PrivateWatchlistCards } from "./private-watchlist-generation-store.js";

type Tariff = {
  inputUsdPerMillion: string; cachedInputUsdPerMillion: string; outputUsdPerMillion: string;
  webSearchUsdPerThousand: string; contextTokens: number; maxOutputTokens: number; maxToolCalls: number; attempts: number;
  verifiedAt: string;
};
type Dependencies = {
  generateLevels(input: { symbol: string; referencePriceOverride: number; calculationProfile: "dashboard_eodhd_daily_4h" }): Promise<LevelEngineOutputWithCandleSeries>;
  candles: Pick<CandleFetchService, "fetchCandles" | "getProviderName">;
  settings: Pick<TradersLinkAiReadService, "getConfiguredModel" | "getReasoningEffort" | "isExternalResearchEnabled"> | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};
const integer = (value: unknown, minimum = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const decimal = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("Private generation pricing is not configured.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
};
function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Private generation cost exceeds exact storage.");
  return Number(value);
}
function charge(tokens: number, rate: string): number {
  if (!integer(tokens)) throw new Error("Invalid provider usage.");
  // USD/million tokens equals micro-USD/token; round up once to a micro-USD.
  return safe((BigInt(tokens) * decimal(rate) + 999_999n) / 1_000_000n);
}
function readTariff(env: NodeJS.ProcessEnv, model: string): Tariff {
  const rates: unknown = JSON.parse(env.TRADERLINK_PRIVATE_WATCHLIST_MODEL_TARIFFS ?? "{}");
  const value = (rates as Record<string, Tariff> | null)?.[model];
  if (!value || !integer(value.contextTokens, 1) || !integer(value.maxOutputTokens, 1) ||
    !integer(value.maxToolCalls) || !integer(value.attempts, 1) || !Number.isFinite(Date.parse(value.verifiedAt)) ||
    value.maxOutputTokens > value.contextTokens) throw new Error("Verified private generation pricing is unavailable.");
  decimal(value.inputUsdPerMillion); decimal(value.cachedInputUsdPerMillion); decimal(value.outputUsdPerMillion); decimal(value.webSearchUsdPerThousand);
  if (decimal(value.cachedInputUsdPerMillion) > decimal(value.inputUsdPerMillion)) throw new Error("Invalid cached-input price.");
  return value;
}
function maximumAttempt(tariff: Tariff, web: boolean): number {
  // contextTokens must be the verified provider model context ceiling, not an
  // arbitrary product allowance. Each built-in tool can add another model turn.
  const turns = BigInt(web ? tariff.maxToolCalls : 0) + 1n;
  // Splitting cached and uncached usage can introduce one extra micro-USD of rounding.
  return safe(1n + BigInt(charge(safe(BigInt(tariff.contextTokens) * turns), tariff.inputUsdPerMillion)) +
    BigInt(charge(tariff.maxOutputTokens, tariff.outputUsdPerMillion)) +
    (web ? BigInt(charge(safe(BigInt(tariff.maxToolCalls) * 1000n), tariff.webSearchUsdPerThousand)) : 0n));
}

/** Snapshot-only pipeline. Uses pure formatters/calculation and never activates,
 * saves to, monitors, or publishes the owner's official Watchlist.
 */
export function createPrivateWatchlistGenerationAdapter(dependencies: Dependencies): BoundedPrivateWatchlistGenerator {
  const env = dependencies.env ?? process.env, transport = dependencies.fetchImpl ?? fetch;
  function configuration() {
    if (!dependencies.settings || !env.OPENAI_API_KEY) throw new Error("Private analysis provider is unavailable.");
    const model = dependencies.settings.getConfiguredModel();
    const tariff = readTariff(env, model);
    const web = dependencies.settings.isExternalResearchEnabled();
    if (web && !tariff.maxToolCalls) throw new Error("Configure a web research cost bound before generation.");
    return { model, tariff, web, maximum: safe(BigInt(maximumAttempt(tariff, web)) * BigInt(tariff.attempts)),
      reasoningEffort: dependencies.settings.getReasoningEffort() };
  }
  return {
    async quote(input: PrivateWatchlistInput): Promise<number> {
      return input.selection.analysis ? configuration().maximum : 0;
    },
    async generate(input: PrivateWatchlistGenerationRequest): Promise<PrivateGenerationResult> {
      let actual = 0, uncertain = false, dispatched = false, attempts = 0;
      try {
        const config = input.selection.analysis ? configuration() : null;
        if (config && config.maximum > input.maximumCostMicrousd) return { state: "not_executed", actualCostMicrousd: 0 };
        const quote = await resolveStockLevelsReferencePrice(input.symbol);
        if (!quote) throw new Error("A current reference price is unavailable.");
        const now = Date.now();
        const cards: { analysis?: unknown; indicators?: unknown; levels?: unknown } = {};
        const calculated = input.selection.levels || input.selection.analysis ? await dependencies.generateLevels({
          symbol: input.symbol, referencePriceOverride: quote.price, calculationProfile: "dashboard_eodhd_daily_4h",
        }) : null;
        if (!isUsableStockLevelsPrice(quote)) throw new Error("Reference price expired during preparation.");
        const snapshot = calculated ? buildLevelSnapshotPayloadFromEngineOutput({
          output: calculated.output, symbol: input.symbol, currentPrice: quote.price, timestamp: calculated.output.generatedAt,
        }) : null;
        if (input.selection.levels && snapshot) {
          const presentation = buildLiveWatchlistPotentialPathPresentation(snapshot);
          cards.levels = { symbol: input.symbol, referencePrice: quote.price, referencePriceAsOf: quote.asOf,
            calculatedAt: snapshot.timestamp, levelMap: presentation.levelMap, fullLadderCard: presentation.fullLadderCard,
            nearestSupportResistanceCard: presentation.nearestSupportResistanceCard };
        }
        const intraday = input.selection.indicators || input.selection.analysis ? await dependencies.candles.fetchCandles({
          symbol: input.symbol, timeframe: "5m", lookbackBars: 500, endTimeMs: now,
        }) : null;
        if (input.selection.indicators && intraday) {
          const context = buildTechnicalContextFromCandles({ candles: intraday.candles, currentPrice: quote.price,
            provider: intraday.provider, dataQualityFlags: intraday.validationIssues.map(issue => issue.code) });
          const card = buildLiveWatchlistTechnicalContextPatch({ symbol: input.symbol, timestamp: now, currentPrice: quote.price, technicalContext: context })?.cards.technicalContext;
          if (!card) throw new Error("Indicator coverage is insufficient.");
          cards.indicators = card;
        }
        if (input.selection.analysis && config && snapshot && calculated && intraday) {
          const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
          const research = await lookupOfficialWatchlistArticleSource({ symbol: input.symbol, targetSessionDate: date, referenceTimeMs: now });
          if (research.status === "lookup_unavailable") throw new Error("Research is unavailable.");
          const oneMinute = await dependencies.candles.fetchCandles({ symbol: input.symbol, timeframe: "1m", lookbackBars: 500, endTimeMs: now });
          if (!isUsableStockLevelsPrice(quote)) throw new Error("Reference price expired during research.");
          const boundedFetch: typeof fetch = async (url, init) => {
            if (String(url) !== "https://api.openai.com/v1/responses" || typeof init?.body !== "string" || uncertain ||
              attempts >= config.tariff.attempts) throw new Error("Private generation request cannot be dispatched.");
            const body = JSON.parse(init.body) as Record<string, unknown>;
            if (body.model !== config.model || body.max_output_tokens !== config.tariff.maxOutputTokens ||
              (Array.isArray(body.tools) && body.tools.some(tool => !tool || tool.type !== "web_search"))) throw new Error("Unpriced private generation request.");
            const tools = Array.isArray(body.tools) && body.tools.length > 0;
            const bound = maximumAttempt(config.tariff, tools);
            if (actual + bound > input.maximumCostMicrousd) throw new Error("Private generation reservation exhausted.");
            // Count the complete serialized input before dispatch. No text
            // generation is performed by the token-count endpoint.
            const count = await transport("https://api.openai.com/v1/responses/input_tokens", { method: "POST",
              headers: init.headers, body: JSON.stringify({ model: body.model, input: body.input, tools: body.tools, text: body.text }),
              signal: init.signal, redirect: "error" });
            if (!count.ok) throw new Error("Input token count unavailable.");
            const counted = await count.json() as { input_tokens?: unknown };
            if (!integer(counted.input_tokens) || counted.input_tokens + config.tariff.maxOutputTokens > config.tariff.contextTokens) throw new Error("Input exceeds the verified model context.");
            attempts += 1; dispatched = true; uncertain = true;
            const response = await transport(url, { ...init, redirect: "error", body: JSON.stringify({ ...body,
              ...(tools ? { max_tool_calls: config.tariff.maxToolCalls } : {}), store: false }) });
            const payload = await response.clone().json() as { usage?: { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } }; output?: { type?: string }[] };
            const usage = payload.usage;
            if (!usage || !integer(usage.input_tokens) || !integer(usage.output_tokens)) throw new Error("Provider usage is unresolved.");
            const cached = usage.input_tokens_details?.cached_tokens ?? 0;
            if (!integer(cached) || cached > usage.input_tokens || !Array.isArray(payload.output)) throw new Error("Provider usage is unresolved.");
            const calls = payload.output.filter(item => item.type === "web_search_call").length;
            if (calls > (tools ? config.tariff.maxToolCalls : 0)) throw new Error("Provider tool usage exceeds the bound.");
            const cost = safe(BigInt(charge(usage.input_tokens - cached, config.tariff.inputUsdPerMillion)) +
              BigInt(charge(cached, config.tariff.cachedInputUsdPerMillion)) + BigInt(charge(usage.output_tokens, config.tariff.outputUsdPerMillion)) +
              BigInt(charge(calls * 1000, config.tariff.webSearchUsdPerThousand)));
            if (cost > bound || actual + cost > input.maximumCostMicrousd) throw new Error("Provider cost exceeds the verified reservation.");
            actual += cost; uncertain = false;
            return response;
          };
          const service = new OpenAITradersLinkAiReadService({ apiKey: env.OPENAI_API_KEY!, model: config.model,
            fallbackModel: config.model, reasoningEffort: config.reasoningEffort, webSearchEnabled: config.web,
            maxOutputTokens: config.tariff.maxOutputTokens, fetchImpl: boundedFetch });
          const read = await service.generate({ snapshot, research: research.research, dataAsOf: now, generationId: input.requestId,
            priceAction: { source: intraday.provider, fetchedAt: Date.now(), priorRegularClose: null,
              intradayCandles: intraday.candles, oneMinuteCandles: oneMinute.candles,
              dailyCandles: calculated.seriesMap.daily.candles, fourHourCandles: calculated.seriesMap["4h"].candles,
              levelsOutput: calculated.output, levelsSnapshotCutoff: now } });
          cards.analysis = buildTradersLinkAiReadPatch({ read }).cards.tradersLinkAiRead;
        }
        if (uncertain) return { state: "unresolved", actualCostMicrousd: null };
        if ((["analysis", "indicators", "levels"] as const).some(key => input.selection[key] && !cards[key])) {
          return { state: dispatched ? "failed" : "not_executed", actualCostMicrousd: actual };
        }
        return { state: "completed", actualCostMicrousd: actual, cards: cards as PrivateWatchlistCards };
      } catch {
        return uncertain ? { state: "unresolved", actualCostMicrousd: null }
          : { state: dispatched ? "failed" : "not_executed", actualCostMicrousd: actual };
      }
    },
  };
}
