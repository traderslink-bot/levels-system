type FetchLike = typeof fetch;

export type FinnhubQuote = {
  c: number;
  d: number;
  dp: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
};

export type FinnhubCompanyProfile = {
  country?: string;
  currency?: string;
  exchange?: string;
  finnhubIndustry?: string;
  ipo?: string;
  logo?: string;
  marketCapitalization?: number;
  name?: string;
  shareOutstanding?: number;
  ticker?: string;
  weburl?: string;
};

export type FinnhubThreadPreview = {
  symbol: string;
  quote: FinnhubQuote;
  profile: FinnhubCompanyProfile;
};

export type FinnhubClientOptions = {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
};

export class FinnhubClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(private readonly options: FinnhubClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.baseUrl = options.baseUrl ?? "https://finnhub.io/api/v1";
  }

  private async requestJson<T>(path: string, query: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("token", this.options.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Finnhub request failed (${response.status} ${response.statusText}) for ${path}: ${body}`.trim(),
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getQuote(symbol: string): Promise<FinnhubQuote> {
    return this.requestJson<FinnhubQuote>("/quote", {
      symbol,
    });
  }

  async getCompanyProfile(symbol: string): Promise<FinnhubCompanyProfile> {
    return this.requestJson<FinnhubCompanyProfile>("/stock/profile2", {
      symbol,
    });
  }

  async getThreadPreview(symbolInput: string): Promise<FinnhubThreadPreview> {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) {
      throw new Error("A ticker symbol is required.");
    }

    const [quote, profile] = await Promise.all([
      this.getQuote(symbol),
      this.getCompanyProfile(symbol),
    ]);

    return {
      symbol,
      quote,
      profile,
    };
  }
}

export function createFinnhubClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): FinnhubClient | null {
  const apiKey = env.FINNHUB_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return new FinnhubClient({
    apiKey,
    fetchImpl,
  });
}
