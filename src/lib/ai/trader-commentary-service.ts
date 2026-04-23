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

      return {
        text,
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
        "Avoid the word participation.",
      userPayload: input,
    });
  }

  async explainSignal(input: SignalCommentaryInput): Promise<TraderCommentaryResult | null> {
    return this.requestCommentary({
      developerPrompt:
        "Explain a deterministic trading signal in plain English. " +
        "Be concise, cautious, and factual. Use 2 short sentences max. " +
        "Do not give direct execution advice. Avoid the word participation.",
      userPayload: input,
    });
  }

  async summarizeSymbolThread(input: ThreadCommentaryInput): Promise<TraderCommentaryResult | null> {
    return this.requestCommentary({
      developerPrompt:
        "Summarize a single trader-facing symbol thread. " +
        "Return 2 short sentences max. Focus on the current state, what changed, and what matters next. " +
        "Stay faithful to the provided deterministic facts and avoid direct trade instructions.",
      userPayload: input,
    });
  }

  async summarizeSession(input: SessionCommentaryInput): Promise<TraderCommentaryResult | null> {
    return this.requestCommentary({
      developerPrompt:
        "Summarize a trading-alert session for an operator. Return markdown with short sections: " +
        "Overall read, Best symbols, Weak spots, Noisy families, and Next tuning ideas. " +
        "Be concise, deterministic-friendly, and do not invent facts beyond the provided JSON.",
      userPayload: input,
    });
  }

  async identifyNoisyFamilies(input: SessionCommentaryInput): Promise<TraderCommentaryResult | null> {
    return this.requestCommentary({
      developerPrompt:
        "Review trading-alert session artifacts and identify which alert families or symbol patterns look noisy. " +
        "Return markdown bullets only with sections: Noisy families, Why they look noisy, and What to tune next. " +
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
