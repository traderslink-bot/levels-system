import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type CommonEquitySecurityMasterStatus =
  | "verified_common_stock"
  | "not_common_stock"
  | "not_found"
  | "unavailable";

export type CommonEquitySecurityMasterVerification = {
  status: CommonEquitySecurityMasterStatus;
  instrumentType: string | null;
  source: "eodhd_exchange_symbols";
};

export type CommonEquitySecurityMasterResult = {
  available: boolean;
  checkedAt: number;
  source: "eodhd_exchange_symbols";
  cacheUsed: boolean;
  error: string | null;
  bySymbol: Record<string, CommonEquitySecurityMasterVerification>;
};

export type CommonEquitySecurityMasterLookup = (input: {
  symbols: string[];
}) => Promise<CommonEquitySecurityMasterResult>;

type EodhdSymbolRecord = {
  Code?: unknown;
  Type?: unknown;
};

type CacheFile = {
  version: 1;
  fetchedAt: number;
  commonSymbols: string[];
};

const DEFAULT_ENDPOINT_URL = "https://eodhd.com/api/exchange-symbol-list/US";
const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function normalizeSymbol(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function envText(...names: string[]): string | undefined {
  return names.map((name) => process.env[name]?.trim()).find(Boolean);
}

function parseCache(value: unknown): CacheFile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CacheFile>;
  if (
    candidate.version !== 1 ||
    typeof candidate.fetchedAt !== "number" ||
    !Number.isFinite(candidate.fetchedAt) ||
    !Array.isArray(candidate.commonSymbols)
  ) {
    return null;
  }
  return {
    version: 1,
    fetchedAt: candidate.fetchedAt,
    commonSymbols: [...new Set(candidate.commonSymbols.map(normalizeSymbol).filter(Boolean))],
  };
}

function loadCache(path: string): CacheFile | null {
  try {
    return parseCache(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function persistCache(path: string, cache: CacheFile): void {
  const temporary = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(cache)}\n`, "utf8");
  renameSync(temporary, path);
}

function isFresh(cache: CacheFile, now: number, maxAgeMs: number): boolean {
  return cache.fetchedAt <= now && now - cache.fetchedAt <= maxAgeMs;
}

function unavailableResult(symbols: string[], checkedAt: number, error: string): CommonEquitySecurityMasterResult {
  return {
    available: false,
    checkedAt,
    source: "eodhd_exchange_symbols",
    cacheUsed: false,
    error,
    bySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, {
      status: "unavailable" as const,
      instrumentType: null,
      source: "eodhd_exchange_symbols" as const,
    }])),
  };
}

function buildResult(
  symbols: string[],
  commonSymbols: Set<string>,
  checkedAt: number,
  cacheUsed: boolean,
): CommonEquitySecurityMasterResult {
  return {
    available: true,
    checkedAt,
    source: "eodhd_exchange_symbols",
    cacheUsed,
    error: null,
    bySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, {
      status: commonSymbols.has(symbol) ? "verified_common_stock" as const : "not_found" as const,
      instrumentType: commonSymbols.has(symbol) ? "Common Stock" : null,
      source: "eodhd_exchange_symbols" as const,
    }])),
  };
}

export class EodhdCommonStockSecurityMaster {
  private readonly fetchImpl: typeof fetch;
  private readonly apiToken: string | null;
  private readonly endpointUrl: string;
  private readonly cachePath: string;
  private readonly cacheMaxAgeMs: number;
  private readonly now: () => number;

  constructor(options: {
    apiToken?: string | null;
    endpointUrl?: string;
    cachePath: string;
    cacheMaxAgeMs?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
  }) {
    this.apiToken = options.apiToken?.trim() || envText("EODHD_API_TOKEN", "LEVEL_EODHD_API_TOKEN") || null;
    this.endpointUrl = options.endpointUrl?.trim() ||
      envText("EODHD_SECURITY_MASTER_URL", "LEVEL_EODHD_SECURITY_MASTER_URL") ||
      DEFAULT_ENDPOINT_URL;
    this.cachePath = options.cachePath;
    this.cacheMaxAgeMs = Math.max(60_000, options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async verifySymbols(input: { symbols: string[] }): Promise<CommonEquitySecurityMasterResult> {
    const symbols = [...new Set(input.symbols.map(normalizeSymbol).filter(Boolean))];
    const checkedAt = this.now();
    if (symbols.length === 0) {
      return {
        available: true,
        checkedAt,
        source: "eodhd_exchange_symbols",
        cacheUsed: true,
        error: null,
        bySymbol: {},
      };
    }
    const cached = loadCache(this.cachePath);
    if (cached && isFresh(cached, checkedAt, this.cacheMaxAgeMs)) {
      return buildResult(symbols, new Set(cached.commonSymbols), checkedAt, true);
    }
    if (!this.apiToken) {
      return unavailableResult(symbols, checkedAt, "EODHD_API_TOKEN is not configured for common-equity verification.");
    }

    const url = new URL(this.endpointUrl);
    url.searchParams.set("api_token", this.apiToken);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("type", "common_stock");
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      return unavailableResult(
        symbols,
        checkedAt,
        `EODHD common-equity lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      return unavailableResult(symbols, checkedAt, `EODHD common-equity lookup failed (${response.status}).`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return unavailableResult(symbols, checkedAt, "EODHD common-equity lookup returned invalid JSON.");
    }
    if (!Array.isArray(body)) {
      return unavailableResult(symbols, checkedAt, "EODHD common-equity lookup returned a non-array payload.");
    }
    const commonSymbols = [...new Set(body
      .filter((entry): entry is EodhdSymbolRecord => Boolean(entry) && typeof entry === "object")
      .filter((entry) => String(entry.Type ?? "").trim().toLowerCase() === "common stock")
      .map((entry) => normalizeSymbol(entry.Code))
      .filter(Boolean))];
    if (commonSymbols.length === 0) {
      return unavailableResult(symbols, checkedAt, "EODHD common-equity lookup returned no common-stock records.");
    }
    try {
      persistCache(this.cachePath, { version: 1, fetchedAt: checkedAt, commonSymbols });
    } catch (error) {
      // The result is still usable for this scan. The next scan will refetch.
      console.warn(`[AutoWatchlistSelector] Failed to cache EODHD security master: ${error instanceof Error ? error.message : String(error)}`);
    }
    return buildResult(symbols, new Set(commonSymbols), checkedAt, false);
  }
}
