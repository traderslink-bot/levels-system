import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { extractResponseText } from "../lib/ai/trader-commentary-service.js";

type FetchLike = typeof fetch;

export const AI_CLEAN_READ_REASONING_EFFORT = "xhigh" as const;
export const DEFAULT_AI_CLEAN_READ_MODEL = "gpt-5.5";
export const AI_CLEAN_READ_MAX_OUTPUT_TOKENS = 5000;
export const DEFAULT_AI_CLEAN_READ_TIMEOUT_MS = 120_000;
const AI_CLEAN_READ_TIMEOUT_ENV = "LEVEL_CLEAN_READ_TIMEOUT_MS";

export type AiCleanReadPricing = {
  model: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export type AiCleanReadUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
};

export type AiCleanReadInput = {
  symbol: string;
  currentPrice: string;
  ladderText: string;
  aiPromptNotes?: string;
};

export type AiCleanReadResult = {
  text: string;
  model: string;
  reasoningEffort: typeof AI_CLEAN_READ_REASONING_EFFORT;
  usage: AiCleanReadUsage | null;
  pricing: AiCleanReadPricing | null;
};

export type AiCleanReadRecord = AiCleanReadInput & AiCleanReadResult & {
  id: string;
  createdAt: string;
  /** Legacy field present in clean-read records saved before audit comments were separated. */
  operatorComments?: string;
};

export type AiCleanReadComment = {
  id: string;
  cleanReadId: string | null;
  symbol: string;
  comments: string;
  updatedAt: string;
};

export type AiCleanReadPayload = {
  generatedAt: string;
  sessionDirectory: string | null;
  recordsPath: string;
  commentsPath: string;
  model: string;
  reasoningEffort: typeof AI_CLEAN_READ_REASONING_EFFORT;
  openAiApiKeyPresent: boolean;
  pricing: AiCleanReadPricing | null;
  usageSummary: AiCleanReadUsageSummary;
  records: Array<AiCleanReadRecord & { latestComment: AiCleanReadComment | null }>;
};

export type AiCleanReadUsageSummary = {
  recordCount: number;
  recordsWithUsage: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
};

export type AiCleanReadSnapshotSource = {
  input: AiCleanReadInput;
  auditPath: string;
  timestamp: number | null;
};

type ResponsesApiResponse = {
  status?: string;
  incomplete_details?: {
    reason?: string;
  } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    };
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export type OpenAICleanReadServiceOptions = {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

const CLEAN_READ_DEVELOPER_PROMPT = [
  "You are a professional small-cap day-trade chart reader.",
  "Convert a full support/resistance ladder into one concise trader-ready clean read.",
  "Write like an experienced trader giving chart analysis, not like a system labeling zones.",
  "Use the current price as the anchor. Explain what price needs to hold, what resistance is overhead, what opens up above, and what support matters if it fails.",
  "Return exactly this body format. Do not include a title, ticker header, current-price header, markdown bullets, markdown fences, or the words Clean read:",
  "One short sentence saying where price is trading now, using the nearest support/resistance context.",
  "",
  "Needs to hold:",
  "$X-$Y area",
  "",
  "Resistance above:",
  "$A-$B is the first test",
  "$C is the cleaner breakout trigger",
  "Above $C, watch $D, $E, then $F",
  "",
  "Targets to consider:",
  "$G-$H, $I-$J, $K",
  "",
  "If support fails:",
  "$L-$M is the next support area",
  "$N-$O is deeper risk support",
  "",
  "Read:",
  "One short practical summary, for example: Constructive while holding above $X. Still choppy under $B. Cleaner strength starts above $C.",
  "Do not list every ladder level. Do not explain your reasoning. Do not include markdown fences.",
  "Do not call any buy zone best, safest, guaranteed, or must-buy.",
  "Use 'Targets to consider' only, not sell targets or profit targets.",
  "Every phrase must be correct relative to the current price.",
  "If current price is inside or near a level cluster, describe the nearby area as what price needs to hold or the range price is trading in.",
  "Needs to hold should use detected support or near-price ladder levels, not the current price as a made-up zone endpoint.",
  "Do not use current price as a range boundary unless that exact price appears in the supplied ladder.",
  "Always write price ranges from low to high, for example $3.25-$3.33, never $3.33-$3.25.",
  "Use reclaim only when price is below a level or zone that must be retaken.",
  "If a level or zone is above current price, call it resistance, first test, acceptance, or breakout trigger, not reclaim.",
  "The breakout trigger must be the first practical price or tight zone where acceptance would change the read.",
  "Do not make the breakout trigger a wide multi-target band. If the ladder has a wide overhead shelf, use the low end as the trigger and leave higher prices for targets.",
  "For breakout trigger zones, keep the zone tight. If the candidate zone is wider than about 5% from low to high, use a single trigger price at the low end.",
  "Use support / risk support language instead of dip-buy language.",
  "Prefer practical risk/reward over mechanically choosing the closest level.",
  "Targets to consider must be useful upside checkpoints for traders, not tiny nearby resistance noise.",
  "Do not use a target within about 3% of current price unless it is the only overhead level available.",
  "Levels used in Needs to hold, first resistance test, or breakout trigger should usually not be repeated as targets.",
  "Targets should usually start beyond the next resistance test or breakout trigger.",
  "When the ladder provides room, include 3-5 target checkpoints or zones that span near, mid, and stretch upside.",
  "Do not stop at the first small overhead level if higher supplied levels are relevant for potential profit-taking.",
  "If the ladder is sparse, still produce the closest useful clean-read zones from the provided levels.",
  "Do not invent levels outside the supplied ladder except for obvious rounded continuation map groupings already implied by the levels.",
  "Do not use 'No additional resistance found below' or similar boundary text as a target; it is not a tradable level.",
  "Use plain ASCII punctuation.",
].join("\n");

const AI_CLEAN_READ_PRICING: Record<string, AiCleanReadPricing> = {
  "gpt-5.5": {
    model: "gpt-5.5",
    inputUsdPerMillion: 5,
    cachedInputUsdPerMillion: 0.5,
    outputUsdPerMillion: 30,
  },
  "gpt-5.4": {
    model: "gpt-5.4",
    inputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 0.25,
    outputUsdPerMillion: 15,
  },
  "gpt-5.4-mini": {
    model: "gpt-5.4-mini",
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
  },
  "gpt-5": {
    model: "gpt-5",
    inputUsdPerMillion: 1.25,
    cachedInputUsdPerMillion: 0.125,
    outputUsdPerMillion: 10,
  },
  "gpt-5-mini": {
    model: "gpt-5-mini",
    inputUsdPerMillion: 0.25,
    cachedInputUsdPerMillion: 0.025,
    outputUsdPerMillion: 2,
  },
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function removeNonTargetableLadderBoundaries(ladderText: string): string {
  return ladderText
    .replace(/^No additional (?:resistance|support) found below [^\n]+\.?$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactInput(input: AiCleanReadInput): AiCleanReadInput {
  return {
    symbol: normalizeSymbol(input.symbol),
    currentPrice: input.currentPrice.trim(),
    ladderText: input.ladderText.trim(),
    aiPromptNotes: input.aiPromptNotes?.trim() || undefined,
  };
}

function buildCleanReadUserPrompt(input: AiCleanReadInput): string {
  const compacted = compactInput(input);
  return [
    `Ticker: $${compacted.symbol}`,
    `Current price: ${compacted.currentPrice}`,
    compacted.aiPromptNotes ? `Optional trader note to send to OpenAI: ${compacted.aiPromptNotes}` : null,
    "Full support/resistance ladder:",
    removeNonTargetableLadderBoundaries(compacted.ladderText),
  ].filter((line): line is string => line !== null).join("\n\n");
}

function stripLeadingBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && !next[0]?.trim()) {
    next.shift();
  }
  return next;
}

function formatHeaderCurrentPrice(currentPrice: string): string {
  const parsed = Number(currentPrice);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return currentPrice;
  }

  const decimals = parsed >= 0.25 ? 2 : parsed >= 0.01 ? 4 : 6;
  return parsed.toFixed(decimals).replace(/\.?0+$/, "");
}

type ParsedCleanReadZoneLine = {
  low: number;
  high: number;
  label: string;
};

function formatCleanReadPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) {
    return String(price);
  }

  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  if (price >= 0.01) {
    return `$${price.toFixed(4)}`;
  }
  return `$${price.toFixed(6)}`;
}

function parseCleanReadZoneLine(line: string): ParsedCleanReadZoneLine | null {
  const match = line.trim().match(
    /^\$?([0-9]+(?:\.[0-9]+)?)(?:\s*-\s*\$?([0-9]+(?:\.[0-9]+)?))?\s*=\s*(.+)$/i,
  );
  if (!match) {
    return null;
  }

  const first = Number(match[1]);
  const second = match[2] ? Number(match[2]) : first;
  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) {
    return null;
  }

  return {
    low: Math.min(first, second),
    high: Math.max(first, second),
    label: match[3]?.trim() ?? "",
  };
}

function formatCleanReadZoneLine(low: number, high: number, label: string): string {
  const samePrice = Math.abs(high - low) <= Math.max(low, 0.0001) * 0.0001;
  const priceText = samePrice
    ? formatCleanReadPrice(low)
    : `${formatCleanReadPrice(low)}-${formatCleanReadPrice(high)}`;
  return `${priceText} = ${label}`;
}

function normalizeCleanReadZoneLine(line: string, currentPrice: number | null): string {
  if (currentPrice === null) {
    return line;
  }

  const parsed = parseCleanReadZoneLine(line);
  if (!parsed) {
    return line;
  }

  const normalizedLabel = parsed.label.toLowerCase();
  const midpoint = (parsed.low + parsed.high) / 2;
  const widthPct = midpoint > 0 ? (parsed.high - parsed.low) / midpoint : 0;
  const priceTolerance = Math.max(currentPrice * 0.001, 0.001);
  const currentInside = currentPrice >= parsed.low - priceTolerance && currentPrice <= parsed.high + priceTolerance;

  if (/key hold\s*\/\s*reclaim|hold\s*\/\s*reclaim/.test(normalizedLabel)) {
    if (currentInside) {
      return formatCleanReadZoneLine(parsed.low, parsed.high, "current hold / decision area");
    }
    if (currentPrice < parsed.low - priceTolerance) {
      return formatCleanReadZoneLine(parsed.low, parsed.high, "reclaim area");
    }
    return formatCleanReadZoneLine(parsed.low, parsed.high, "pullback support / hold area");
  }

  if (/next reclaim/.test(normalizedLabel) && parsed.low > currentPrice + priceTolerance) {
    return formatCleanReadZoneLine(parsed.low, parsed.high, "next resistance / acceptance test");
  }

  if (/real momentum breakout zone|momentum breakout zone/.test(normalizedLabel)) {
    if (widthPct > 0.05) {
      return `${formatCleanReadPrice(parsed.low)} = breakout trigger; ${formatCleanReadPrice(parsed.high)} = confirmation / expansion checkpoint`;
    }
    return formatCleanReadZoneLine(parsed.low, parsed.high, "breakout trigger");
  }

  if (/first (?:dip-buy|buy) zone/.test(normalizedLabel)) {
    return formatCleanReadZoneLine(parsed.low, parsed.high, "first pullback support area");
  }

  if (/deeper (?:dip-buy|buy) zone/.test(normalizedLabel)) {
    return formatCleanReadZoneLine(parsed.low, parsed.high, "deeper support / risk area");
  }

  return line;
}

function parseNonTargetableBoundaryPrices(ladderText: string): number[] {
  return [...ladderText.matchAll(/^No additional (?:resistance|support) found below ([0-9]+(?:\.[0-9]+)?)/gim)]
    .map((match) => Number(match[1]))
    .filter((price) => Number.isFinite(price) && price > 0);
}

function normalizeCleanReadTargetsLine(line: string, nonTargetableBoundaryPrices: number[]): string {
  const match = line.match(/^Targets to consider:\s*(.+)$/i);
  if (!match || nonTargetableBoundaryPrices.length === 0) {
    return line;
  }

  const targetText = match[1] ?? "";
  const targets = targetText
    .split(/\s*,\s*/)
    .map((target) => target.trim())
    .filter(Boolean)
    .filter((target) => {
      const prices = [...target.matchAll(/\$?([0-9]+(?:\.[0-9]+)?)/g)]
        .map((priceMatch) => Number(priceMatch[1]))
        .filter((price) => Number.isFinite(price) && price > 0);
      return !prices.some((price) =>
        nonTargetableBoundaryPrices.some(
          (boundary) => Math.abs(boundary - price) <= Math.max(boundary * 0.001, 0.001),
        ),
      );
    });

  return targets.length > 0 ? `Targets to consider: ${targets.join(", ")}` : "";
}

function normalizeDollarRangesInLine(line: string): string {
  return line.replace(
    /\$([0-9]+(?:\.[0-9]+)?)\s*-\s*\$?([0-9]+(?:\.[0-9]+)?)/g,
    (_match, firstText: string, secondText: string) => {
      const first = Number(firstText);
      const second = Number(secondText);
      if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) {
        return _match;
      }

      return `${formatCleanReadPrice(Math.min(first, second))}-${formatCleanReadPrice(Math.max(first, second))}`;
    },
  );
}

function normalizeCleanReadOutput(input: AiCleanReadInput, text: string): string {
  const compacted = compactInput(input);
  const nonTargetableBoundaryPrices = parseNonTargetableBoundaryPrices(input.ladderText);
  const parsedCurrentPrice = Number(compacted.currentPrice);
  const currentPrice = Number.isFinite(parsedCurrentPrice) && parsedCurrentPrice > 0
    ? parsedCurrentPrice
    : null;
  let lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  lines = stripLeadingBlankLines(lines);
  while (lines.length > 0) {
    const first = lines[0]?.trim() ?? "";
    if (
      /^clean read:?$/i.test(first) ||
      first.toUpperCase() === `$${compacted.symbol}` ||
      /^ticker:\s*\$?[A-Z0-9.:-]+$/i.test(first) ||
      /^current price:\s*\$?[0-9]+(?:\.[0-9]+)?$/i.test(first)
    ) {
      lines.shift();
      lines = stripLeadingBlankLines(lines);
      continue;
    }
    break;
  }

  const body = lines
    .join("\n")
    .replace(/^clean read:\s*$/gim, "")
    .replace(/^targets:/gim, "Targets to consider:")
    .replace(/^nearest targets?:/gim, "Targets to consider:")
    .replace(/^targets to consider:/gim, "Targets to consider:")
    .split("\n")
    .map((line) => normalizeCleanReadTargetsLine(line, nonTargetableBoundaryPrices))
    .filter((line) => line.trim().length > 0)
    .map(normalizeDollarRangesInLine)
    .map((line) => normalizeCleanReadZoneLine(line, currentPrice))
    .join("\n")
    .trim();

  return [`$${compacted.symbol}`, "", `Current Price: ${formatHeaderCurrentPrice(compacted.currentPrice)}`, "", body]
    .join("\n")
    .trimEnd();
}

function extractCurrentPriceFromSnapshotBody(body: string): string | null {
  const match = body.match(/^Price:\s*([0-9]+(?:\.[0-9]+)?)/im);
  return match?.[1] ?? null;
}

function buildCleanReadLadderTextFromSnapshot(
  symbol: string,
  currentPrice: string,
  body: string,
): string {
  const marker = "More support and resistance:";
  const markerIndex = body.indexOf(marker);
  const ladderSection = markerIndex >= 0
    ? body.slice(markerIndex + marker.length).trim()
    : body.trim();

  return [
    `${symbol} full level ladder`,
    `Price: ${currentPrice}`,
    "",
    ladderSection,
  ].join("\n");
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

export function getAiCleanReadPricing(model: string): AiCleanReadPricing | null {
  return AI_CLEAN_READ_PRICING[model.trim()] ?? null;
}

export function estimateAiCleanReadCostUsd(
  model: string,
  usage: Omit<AiCleanReadUsage, "estimatedCostUsd">,
): number | null {
  const pricing = getAiCleanReadPricing(model);
  if (!pricing) {
    return null;
  }

  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const standardInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  return (
    (standardInputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillion
  );
}

function normalizeAiCleanReadUsage(
  model: string,
  usage: ResponsesApiResponse["usage"] | undefined,
): AiCleanReadUsage | null {
  if (!usage) {
    return null;
  }

  const inputTokens = normalizeNonNegativeInteger(usage.input_tokens);
  const cachedInputTokens = normalizeNonNegativeInteger(
    usage.input_tokens_details?.cached_tokens,
  );
  const outputTokens = normalizeNonNegativeInteger(usage.output_tokens);
  const reasoningTokens = normalizeNonNegativeInteger(
    usage.output_tokens_details?.reasoning_tokens,
  );
  const totalTokens = normalizeNonNegativeInteger(usage.total_tokens) || inputTokens + outputTokens;

  if (inputTokens + outputTokens + totalTokens === 0) {
    return null;
  }

  const usageWithoutCost = {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };

  return {
    ...usageWithoutCost,
    estimatedCostUsd: estimateAiCleanReadCostUsd(model, usageWithoutCost),
  };
}

function buildUsageSummary(records: AiCleanReadRecord[]): AiCleanReadUsageSummary {
  const usageRecords = records.flatMap((record) => record.usage ? [record.usage] : []);
  const estimatedCostUsd = usageRecords.reduce<number | null>((total, usage) => {
    if (usage.estimatedCostUsd === null) {
      return total;
    }
    return (total ?? 0) + usage.estimatedCostUsd;
  }, null);

  return {
    recordCount: records.length,
    recordsWithUsage: usageRecords.length,
    inputTokens: usageRecords.reduce((total, usage) => total + usage.inputTokens, 0),
    cachedInputTokens: usageRecords.reduce((total, usage) => total + usage.cachedInputTokens, 0),
    outputTokens: usageRecords.reduce((total, usage) => total + usage.outputTokens, 0),
    reasoningTokens: usageRecords.reduce((total, usage) => total + usage.reasoningTokens, 0),
    totalTokens: usageRecords.reduce((total, usage) => total + usage.totalTokens, 0),
    estimatedCostUsd,
  };
}

export class OpenAICleanReadService {
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAICleanReadServiceOptions) {
    this.model = options.model?.trim() || DEFAULT_AI_CLEAN_READ_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AI_CLEAN_READ_TIMEOUT_MS;
  }

  async generateCleanRead(input: AiCleanReadInput): Promise<AiCleanReadResult> {
    const compacted = compactInput(input);
    if (!compacted.symbol) {
      throw new Error("Symbol is required.");
    }
    if (!compacted.currentPrice) {
      throw new Error("Current price is required.");
    }
    if (!compacted.ladderText) {
      throw new Error("Support/resistance ladder is required.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          reasoning: {
            effort: AI_CLEAN_READ_REASONING_EFFORT,
          },
          max_output_tokens: AI_CLEAN_READ_MAX_OUTPUT_TOKENS,
          input: [
            {
              role: "developer",
              content: [
                {
                  type: "input_text",
                  text: CLEAN_READ_DEVELOPER_PROMPT,
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: buildCleanReadUserPrompt(compacted),
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as ResponsesApiResponse;
      if (!response.ok) {
        const message = payload.error?.message ?? response.statusText;
        throw new Error(message);
      }

      const text = extractResponseText(payload);
      if (!text) {
        if (payload.incomplete_details?.reason) {
          throw new Error(`OpenAI returned no clean-read text (${payload.incomplete_details.reason}).`);
        }
        throw new Error("OpenAI returned no clean-read text.");
      }

      return {
        text: normalizeCleanReadOutput(compacted, text),
        model: this.model,
        reasoningEffort: AI_CLEAN_READ_REASONING_EFFORT,
        usage: normalizeAiCleanReadUsage(this.model, payload.usage),
        pricing: getAiCleanReadPricing(this.model),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createOpenAICleanReadServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): OpenAICleanReadService | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return new OpenAICleanReadService({
    apiKey,
    model: env.LEVEL_CLEAN_READ_AI_MODEL?.trim() || DEFAULT_AI_CLEAN_READ_MODEL,
    timeoutMs: resolvePositiveIntegerEnv(env[AI_CLEAN_READ_TIMEOUT_ENV], DEFAULT_AI_CLEAN_READ_TIMEOUT_MS),
    fetchImpl,
  });
}

function resolvePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveAiCleanReadPaths(sessionDirectory: string | null): {
  recordsPath: string;
  commentsPath: string;
} {
  const baseDirectory = sessionDirectory || join(process.cwd(), "artifacts");
  return {
    recordsPath: join(baseDirectory, "ai-clean-read-records.jsonl"),
    commentsPath: join(baseDirectory, "ai-clean-read-comments.jsonl"),
  };
}

function readJsonLines<T>(path: string): T[] {
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

export function resolveLatestCleanReadSnapshotInput(
  sessionDirectory: string | null,
  requestedSymbol?: string,
): AiCleanReadSnapshotSource | null {
  if (!sessionDirectory) {
    return null;
  }

  const auditPath = join(sessionDirectory, "discord-delivery-audit.jsonl");
  if (!existsSync(auditPath)) {
    return null;
  }

  const normalizedRequestedSymbol = normalizeSymbol(requestedSymbol ?? "");
  const lines = readFileSync(auditPath, "utf8").split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const row = JSON.parse(lines[index]) as {
        operation?: string;
        status?: string;
        symbol?: string;
        body?: string;
        timestamp?: number;
      };
      const symbol = normalizeSymbol(row.symbol ?? "");
      const body = typeof row.body === "string" ? row.body.trim() : "";
      if (
        row.operation !== "post_level_snapshot" ||
        row.status !== "posted" ||
        !symbol ||
        !body ||
        (normalizedRequestedSymbol && symbol !== normalizedRequestedSymbol)
      ) {
        continue;
      }

      const currentPrice = extractCurrentPriceFromSnapshotBody(body);
      if (!currentPrice) {
        continue;
      }

      return {
        input: {
          symbol,
          currentPrice,
          ladderText: buildCleanReadLadderTextFromSnapshot(symbol, currentPrice, body),
        },
        auditPath,
        timestamp: typeof row.timestamp === "number" ? row.timestamp : null,
      };
    } catch {
      continue;
    }
  }

  return null;
}

export function appendAiCleanReadRecord(
  sessionDirectory: string | null,
  input: AiCleanReadInput,
  result: AiCleanReadResult,
): AiCleanReadRecord {
  const { recordsPath } = resolveAiCleanReadPaths(sessionDirectory);
  const compacted = compactInput(input);
  const record: AiCleanReadRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    symbol: compacted.symbol,
    currentPrice: compacted.currentPrice,
    ladderText: compacted.ladderText,
    aiPromptNotes: compacted.aiPromptNotes,
    text: result.text,
    model: result.model,
    reasoningEffort: result.reasoningEffort,
    usage: result.usage,
    pricing: result.pricing,
  };

  mkdirSync(dirname(recordsPath), { recursive: true });
  appendFileSync(recordsPath, `${JSON.stringify(record)}\n`);
  return record;
}

export function appendAiCleanReadComment(
  sessionDirectory: string | null,
  comment: {
    cleanReadId?: string | null;
    symbol: string;
    comments: string;
  },
): AiCleanReadComment {
  const { commentsPath } = resolveAiCleanReadPaths(sessionDirectory);
  const normalized: AiCleanReadComment = {
    id: randomUUID(),
    cleanReadId: comment.cleanReadId?.trim() || null,
    symbol: normalizeSymbol(comment.symbol),
    comments: comment.comments.trim(),
    updatedAt: new Date().toISOString(),
  };

  if (!normalized.symbol) {
    throw new Error("Symbol is required.");
  }
  if (!normalized.comments) {
    throw new Error("Comments are required.");
  }

  mkdirSync(dirname(commentsPath), { recursive: true });
  appendFileSync(commentsPath, `${JSON.stringify(normalized)}\n`);
  return normalized;
}

export function buildAiCleanReadPayload(params: {
  sessionDirectory: string | null;
  model: string;
  openAiApiKeyPresent: boolean;
}): AiCleanReadPayload {
  const { recordsPath, commentsPath } = resolveAiCleanReadPaths(params.sessionDirectory);
  const comments = readJsonLines<AiCleanReadComment>(commentsPath);
  const latestCommentByRecord = new Map<string, AiCleanReadComment>();
  for (const comment of comments) {
    if (comment.cleanReadId) {
      latestCommentByRecord.set(comment.cleanReadId, comment);
    }
  }

  const records = readJsonLines<AiCleanReadRecord>(recordsPath)
    .slice(-50)
    .reverse()
    .map((record) => ({
      ...record,
      text: normalizeCleanReadOutput(record, record.text),
      latestComment: latestCommentByRecord.get(record.id) ?? null,
    }));

  return {
    generatedAt: new Date().toISOString(),
    sessionDirectory: params.sessionDirectory,
    recordsPath,
    commentsPath,
    model: params.model,
    reasoningEffort: AI_CLEAN_READ_REASONING_EFFORT,
    openAiApiKeyPresent: params.openAiApiKeyPresent,
    pricing: getAiCleanReadPricing(params.model),
    usageSummary: buildUsageSummary(records),
    records,
  };
}

export { CLEAN_READ_DEVELOPER_PROMPT, buildCleanReadUserPrompt };
