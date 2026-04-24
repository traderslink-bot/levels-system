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

export type FinnhubCompanyNewsItem = {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

export type FinnhubThreadPreview = {
  symbol: string;
  quote: FinnhubQuote;
  profile: FinnhubCompanyProfile;
  recentNews: FinnhubCompanyNewsItem[];
};

export type FinnhubClientOptions = {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
  newsLookbackDays?: number;
  newsLimit?: number;
};

function toIsoDateParts(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export class FinnhubClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly newsLookbackDays: number;
  private readonly newsLimit: number;

  constructor(private readonly options: FinnhubClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.baseUrl = options.baseUrl ?? "https://finnhub.io/api/v1";
    this.newsLookbackDays = options.newsLookbackDays ?? 7;
    this.newsLimit = options.newsLimit ?? 3;
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

  async getCompanyNews(symbol: string): Promise<FinnhubCompanyNewsItem[]> {
    const to = new Date();
    const from = new Date(to.getTime() - this.newsLookbackDays * 24 * 60 * 60 * 1000);
    const items = await this.requestJson<FinnhubCompanyNewsItem[]>("/company-news", {
      symbol,
      from: toIsoDateParts(from),
      to: toIsoDateParts(to),
    });

    return [...items]
      .sort((left, right) => (right.datetime ?? 0) - (left.datetime ?? 0))
      .slice(0, this.newsLimit);
  }

  async getThreadPreview(symbolInput: string): Promise<FinnhubThreadPreview> {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) {
      throw new Error("A ticker symbol is required.");
    }

    const [quote, profile, recentNews] = await Promise.all([
      this.getQuote(symbol),
      this.getCompanyProfile(symbol),
      this.getCompanyNews(symbol),
    ]);

    return {
      symbol,
      quote,
      profile,
      recentNews,
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
