type FetchLike = typeof fetch;

export type TraderCommentaryResult = {
  text: string;
  model: string;
};

export type SymbolRecapCommentaryInput = {
  symbol: string;
  deterministicRecap: string;
  topOpportunity?: Record<string, unknown> | null;
  latestProgress?: Record<string, unknown> | null;
  latestEvaluation?: Record<string, unknown> | null;
};

export type SignalCommentaryInput = {
  symbol: string;
  title: string;
  deterministicBody: string;
  eventType?: string;
  severity?: string;
  confidence?: string;
  score?: number;
  metadata?: Record<string, unknown> | null;
};

export type ThreadCommentaryInput = {
  symbol: string;
  deterministicRecap: string;
  threadSummary?: Record<string, unknown> | null;
  topOpportunity?: Record<string, unknown> | null;
  latestProgress?: Record<string, unknown> | null;
  latestEvaluation?: Record<string, unknown> | null;
};

export type SessionCommentaryInput = {
  sessionSummary: Record<string, unknown>;
  threadSummaries: unknown[];
  threadClutterReport?: Record<string, unknown> | unknown[] | null;
};

export interface TraderCommentaryService {
  enhanceSymbolRecap(input: SymbolRecapCommentaryInput): Promise<TraderCommentaryResult | null>;
  explainSignal(input: SignalCommentaryInput): Promise<TraderCommentaryResult | null>;
  summarizeSymbolThread(input: ThreadCommentaryInput): Promise<TraderCommentaryResult | null>;
  summarizeSession(input: SessionCommentaryInput): Promise<TraderCommentaryResult | null>;
  identifyNoisyFamilies(input: SessionCommentaryInput): Promise<TraderCommentaryResult | null>;
}

export type OpenAITraderCommentaryServiceOptions = {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

type ResponsesApiOutputItem = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

type ResponsesApiResponse = {
  output_text?: string;
  output?: ResponsesApiOutputItem[];
  error?: {
    message?: string;
  };
};

function extractResponseText(response: ResponsesApiResponse): string | null {
  if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim().length > 0) {
        return content.text.trim();
      }
    }
  }

  return null;
}

function containsBlockedTraderCommentary(text: string): boolean {
  return [
    /\bshort(?:ing|s)?\b/i,
    /\bsell\s+short\b/i,
    /\bshort\s+(?:setup|entry|trade|idea)\b/i,
    /\bdownside\b/i,
    /\b(?:target|objective)\b/i,
    /\bnext\s+support\b/i,
    /\bfirst\s+support\b/i,
    /\btoward\s+(?:first\s+|next\s+)?support\b/i,
    /\bwait\s+to\s+open\b/i,
    /\bopen\s+new\s+longs\b/i,
    /\bbuy\s+now\b/i,
    /\bsell\s+now\b/i,
  ].some((pattern) => pattern.test(text));
}

export function validateTraderCommentaryText(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/[≈]/g, "about ")
    .replace(/[‑]/g, "-");
  if (!cleaned || containsBlockedTraderCommentary(cleaned)) {
    return null;
  }

  return cleaned;
}

const LIVE_TRADER_COMMENTARY_RULES =
  "This product is for long-only traders. Never suggest shorting, short entries, downside targets, or bearish trade ideas. " +
  "Do not use the words downside, target, objective, first support, next support, buy now, sell now, wait to open, or open new longs. " +
  "For weak or bearish conditions, say the setup is not clean for longs yet and name the reclaim or confirmation level. " +
  "For resistance tests, say buyers need acceptance above resistance. For support tests, say buyers need to defend or reclaim support. " +
  "If a possible dip-buy area is provided, you may mention it only as conditional support where buyers must stabilize. " +
  "Do not tell the user to buy now or sell now. Stay faithful to the deterministic facts. Use plain ASCII punctuation.";

export class OpenAITraderCommentaryService implements TraderCommentaryService {
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAITraderCommentaryServiceOptions) {
    this.model = options.model ?? "gpt-5-mini";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  private async requestCommentary(input: {
    developerPrompt: string;
    userPayload: Record<string, unknown>;
  }): Promise<TraderCommentaryResult | null> {
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
          input: [
            {
              role: "developer",
              content: [
                {
                  type: "input_text",
                  text: input.developerPrompt,
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify(input.userPayload),
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
        return null;
      }

      const validatedText = validateTraderCommentaryText(text);
      if (!validatedText) {
        return null;
      }

      return {
        text: validatedText,
        model: this.model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async enhanceSymbolRecap(input: SymbolRecapCommentaryInput): Promise<TraderCommentaryResult | null> {
    return this.requestCommentary({
      developerPrompt:
        "You write short trader-facing commentary. Be plain, concrete, and cautious. " +
        "Do not tell the user to buy or sell. Explain the structured setup in 2 short sentences max. " +
        "Prefer words like volume, activity, room, support, resistance, continuation, and failure risk. " +
        "Avoid the word participation. " +
        LIVE_TRADER_COMMENTARY_RULES,
      userPayload: input,
    });
  }

  async explainSignal(input: SignalCommentaryInput): Promise<TraderCommentaryResult | null> {
    return this.requestCommentary({
      developerPrompt:
        "Explain a deterministic trading signal in plain English. " +
        "Be concise, cautious, and factual. Use exactly 1 short sentence, 35 words max. " +
        "Do not give direct execution advice. Avoid the word participation. " +
        LIVE_TRADER_COMMENTARY_RULES,
      userPayload: input,
    });
  }

  async summarizeSymbolThread(input: ThreadCommentaryInput): Promise<TraderCommentaryResult | null> {
    return this.requestCommentary({
      developerPrompt:
        "Summarize a single trader-facing symbol thread. " +
        "Return 2 short sentences max. Focus on the current state, what changed, and what matters next. " +
        "Stay faithful to the provided deterministic facts and avoid direct trade instructions. " +
        LIVE_TRADER_COMMENTARY_RULES,
      userPayload: input,
    });
  }

  async summarizeSession(input: SessionCommentaryInput): Promise<TraderCommentaryResult | null> {
    return this.requestCommentary({
      developerPrompt:
        "Summarize a trading-alert session for an operator. Return markdown with short sections: " +
        "Overall read, Best symbols, Weak spots, Thread clutter, Noisy families, and Next tuning ideas. " +
        "Be concise, deterministic-friendly, and do not invent facts beyond the provided JSON.",
      userPayload: input,
    });
  }

  async identifyNoisyFamilies(input: SessionCommentaryInput): Promise<TraderCommentaryResult | null> {
    return this.requestCommentary({
      developerPrompt:
        "Review trading-alert session artifacts and identify which alert families, symbol patterns, or thread behaviors look noisy. " +
        "Return markdown bullets only with sections: Noisy families, Thread clutter risks, Why they look noisy, and What to tune next. " +
        "Use only the provided deterministic facts.",
      userPayload: input,
    });
  }
}

export function createOpenAITraderCommentaryServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): OpenAITraderCommentaryService | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return new OpenAITraderCommentaryService({
    apiKey,
    model: env.LEVEL_AI_MODEL?.trim() || "gpt-5-mini",
    fetchImpl,
  });
}

export { extractResponseText };
