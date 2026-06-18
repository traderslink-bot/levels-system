import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CandleFetchTimeframe } from "../market-data/candle-types.js";

export const NASDAQ_SCREENER_URL =
  "https://api.nasdaq.com/api/screener/stocks?exchange=nasdaq&download=true";

export type NasdaqRawScreenerRow = {
  symbol?: unknown;
  name?: unknown;
  lastsale?: unknown;
  netchange?: unknown;
  pctchange?: unknown;
  marketCap?: unknown;
  country?: unknown;
  ipoyear?: unknown;
  volume?: unknown;
  sector?: unknown;
  industry?: unknown;
  url?: unknown;
  [key: string]: unknown;
};

export type NasdaqMarketCapBucket =
  | "under_100m"
  | "100m_to_200m"
  | "200m_to_300m"
  | "300m_to_400m"
  | "400m_to_500m"
  | "500m_plus"
  | "invalid_or_missing";

export type CommonEquityStatus =
  | "likely_common_equity"
  | "invalid_symbol"
  | "invalid_market_cap"
  | "blocked_name_pattern"
  | "blocked_symbol_suffix";

export type NasdaqUniverseRow = {
  symbol: string;
  name: string;
  lastSale: string;
  netChange: string;
  percentChange: string;
  marketCap: number;
  marketCapRaw: string;
  marketCapBucket: NasdaqMarketCapBucket;
  country: string;
  ipoYear: string;
  volume: number;
  sector: string;
  industry: string;
  url: string;
  isLikelyCommonEquity: boolean;
  commonEquityStatus: CommonEquityStatus;
  raw: NasdaqRawScreenerRow;
};

export type NasdaqUniverseSnapshot = {
  generatedAt: string;
  source: string;
  rawCount: number;
  cleanCount: number;
  rows: NasdaqUniverseRow[];
};

export type NasdaqUnder500Universe = {
  generatedAt: string;
  source: string;
  bucketCounts: Record<Exclude<NasdaqMarketCapBucket, "500m_plus" | "invalid_or_missing">, number>;
  buckets: Record<Exclude<NasdaqMarketCapBucket, "500m_plus" | "invalid_or_missing">, NasdaqUniverseRow[]>;
};

export type ExistingDocDiffStatus =
  | "still_current_under_100m"
  | "current_but_moved_bucket"
  | "not_in_current_nasdaq_screener"
  | "possible_alias_candidate"
  | "new_under_100m_candidate";

export type ExistingDocDiffRow = {
  symbol: string;
  status: ExistingDocDiffStatus;
  currentSymbol: string | null;
  currentBucket: NasdaqMarketCapBucket | null;
  marketCap: number | null;
  reason: string;
};

export type ExistingDocDiff = {
  generatedAt: string;
  sourceChecklistPath: string;
  rows: ExistingDocDiffRow[];
};

export type NasdaqUniverseWriteResult = {
  masterJsonPath: string;
  rawJsonPath: string;
  cleanJsonPath: string;
  under500JsonPath: string;
  under500MarkdownPath: string;
  docUnder500MarkdownPath: string;
  diffMarkdownPath: string;
  diffJsonPath: string;
  snapshot: NasdaqUniverseSnapshot;
  under500: NasdaqUnder500Universe;
  diff: ExistingDocDiff;
};

export type NasdaqBackfillPlanStage = {
  stage: number;
  bucket: Exclude<NasdaqMarketCapBucket, "500m_plus" | "invalid_or_missing">;
  symbols: string[];
  missingSymbols: string[];
  coveredSymbols: string[];
  unresolvedSymbols: string[];
};

export type NasdaqBackfillPlan = {
  generatedAt: string;
  sourceUniversePath: string;
  warehouseDirectoryPath: string;
  provider: "ibkr";
  timeframes: CandleFetchTimeframe[];
  dryRun: true;
  stages: NasdaqBackfillPlanStage[];
};

const UNDER_500_BUCKETS: Array<Exclude<NasdaqMarketCapBucket, "500m_plus" | "invalid_or_missing">> = [
  "under_100m",
  "100m_to_200m",
  "200m_to_300m",
  "300m_to_400m",
  "400m_to_500m",
];

const BUCKET_LABELS: Record<NasdaqMarketCapBucket, string> = {
  under_100m: "Under $100M",
  "100m_to_200m": "$100M to $200M",
  "200m_to_300m": "$200M to $300M",
  "300m_to_400m": "$300M to $400M",
  "400m_to_500m": "$400M to $500M",
  "500m_plus": "$500M+",
  invalid_or_missing: "Invalid / Missing Market Cap",
};

const BLOCKED_NAME_PATTERNS = [
  /\bWarrants?\b/i,
  /\bRights?\b/i,
  /\bUnits?\b/i,
  /\bUnit\b/i,
  /\bPreferred\b/i,
  /\bPreference\b/i,
  /\bDepositary Shares\b/i,
  /\bSenior Notes?\b/i,
  /\bNotes Due\b/i,
  /\bETF\b/i,
  /\bETN\b/i,
  /\bFund\b/i,
  /\bTrust\b/i,
];

const BLOCKED_SYMBOL_SUFFIXES = ["W", "WS", "WT", "U", "R"];
const COMMON_EQUITY_NAME_HINTS = [
  /\bCommon Stock\b/i,
  /\bCommon Shares\b/i,
  /\bOrdinary Shares\b/i,
  /\bClass [A-Z] Ordinary Shares\b/i,
  /\bClass [A-Z] Common Stock\b/i,
  /\bAmerican Depositary Shares\b/i,
];

export function normalizeNasdaqSymbol(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function parseNasdaqMarketCap(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNasdaqVolume(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function bucketNasdaqMarketCap(marketCap: number): NasdaqMarketCapBucket {
  if (!Number.isFinite(marketCap) || marketCap <= 0) {
    return "invalid_or_missing";
  }
  if (marketCap < 100_000_000) {
    return "under_100m";
  }
  if (marketCap < 200_000_000) {
    return "100m_to_200m";
  }
  if (marketCap < 300_000_000) {
    return "200m_to_300m";
  }
  if (marketCap < 400_000_000) {
    return "300m_to_400m";
  }
  if (marketCap < 500_000_000) {
    return "400m_to_500m";
  }
  return "500m_plus";
}

export function classifyCommonEquity(row: Pick<NasdaqUniverseRow, "symbol" | "name" | "marketCap">): CommonEquityStatus {
  if (!row.symbol) {
    return "invalid_symbol";
  }
  if (!Number.isFinite(row.marketCap) || row.marketCap <= 0) {
    return "invalid_market_cap";
  }
  if (BLOCKED_NAME_PATTERNS.some((pattern) => pattern.test(row.name))) {
    return "blocked_name_pattern";
  }
  if (
    BLOCKED_SYMBOL_SUFFIXES.some((suffix) => row.symbol.endsWith(suffix)) &&
    !COMMON_EQUITY_NAME_HINTS.some((pattern) => pattern.test(row.name))
  ) {
    return "blocked_symbol_suffix";
  }
  return "likely_common_equity";
}

export function normalizeNasdaqRow(row: NasdaqRawScreenerRow): NasdaqUniverseRow {
  const symbol = normalizeNasdaqSymbol(row.symbol);
  const name = String(row.name ?? "").replace(/\s+/g, " ").trim();
  const marketCap = parseNasdaqMarketCap(row.marketCap);
  const normalized: NasdaqUniverseRow = {
    symbol,
    name,
    lastSale: String(row.lastsale ?? "").trim(),
    netChange: String(row.netchange ?? "").trim(),
    percentChange: String(row.pctchange ?? "").trim(),
    marketCap,
    marketCapRaw: String(row.marketCap ?? "").trim(),
    marketCapBucket: bucketNasdaqMarketCap(marketCap),
    country: String(row.country ?? "").trim(),
    ipoYear: String(row.ipoyear ?? "").trim(),
    volume: parseNasdaqVolume(row.volume),
    sector: String(row.sector ?? "").trim(),
    industry: String(row.industry ?? "").trim(),
    url: String(row.url ?? "").trim(),
    isLikelyCommonEquity: false,
    commonEquityStatus: "invalid_symbol",
    raw: row,
  };
  normalized.commonEquityStatus = classifyCommonEquity(normalized);
  normalized.isLikelyCommonEquity = normalized.commonEquityStatus === "likely_common_equity";
  return normalized;
}

export async function fetchNasdaqScreenerRows(fetchImpl: typeof fetch = fetch): Promise<NasdaqRawScreenerRow[]> {
  const response = await fetchImpl(NASDAQ_SCREENER_URL, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/market-activity/stocks/screener",
    },
  });

  if (!response.ok) {
    throw new Error(`NASDAQ screener request failed with status ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as { data?: { rows?: NasdaqRawScreenerRow[] } };
  if (!Array.isArray(payload.data?.rows)) {
    throw new Error("NASDAQ screener response did not include data.rows.");
  }

  return payload.data.rows;
}

export function buildNasdaqUniverseSnapshot(rows: NasdaqRawScreenerRow[], generatedAt = new Date().toISOString()): NasdaqUniverseSnapshot {
  const normalizedRows = rows
    .map(normalizeNasdaqRow)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    generatedAt,
    source: NASDAQ_SCREENER_URL,
    rawCount: rows.length,
    cleanCount: normalizedRows.filter((row) => row.isLikelyCommonEquity).length,
    rows: normalizedRows,
  };
}

export function buildUnder500Universe(snapshot: NasdaqUniverseSnapshot): NasdaqUnder500Universe {
  const buckets: NasdaqUnder500Universe["buckets"] = {
    under_100m: [],
    "100m_to_200m": [],
    "200m_to_300m": [],
    "300m_to_400m": [],
    "400m_to_500m": [],
  };
  for (const row of snapshot.rows) {
    if (row.isLikelyCommonEquity && isUnder500Bucket(row.marketCapBucket)) {
      buckets[row.marketCapBucket].push(row);
    }
  }
  for (const bucket of UNDER_500_BUCKETS) {
    buckets[bucket].sort((a, b) => a.marketCap - b.marketCap || a.symbol.localeCompare(b.symbol));
  }
  return {
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
    bucketCounts: Object.fromEntries(UNDER_500_BUCKETS.map((bucket) => [bucket, buckets[bucket].length])) as NasdaqUnder500Universe["bucketCounts"],
    buckets,
  };
}

function isUnder500Bucket(bucket: NasdaqMarketCapBucket): bucket is Exclude<NasdaqMarketCapBucket, "500m_plus" | "invalid_or_missing"> {
  return UNDER_500_BUCKETS.includes(bucket as Exclude<NasdaqMarketCapBucket, "500m_plus" | "invalid_or_missing">);
}

export function parseExistingUnder100mSymbols(markdown: string): string[] {
  const heading = "# All bucketed NASDAQ under $100M tickers, deduped";
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start < 0) {
    return [];
  }
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line === "---") {
      break;
    }
    if (/^[A-Z0-9, ]+$/.test(line) && line.includes(",")) {
      return uniqueSorted(line.split(","));
    }
  }
  return [];
}

export function buildExistingDocDiff(params: {
  existingSymbols: string[];
  snapshot: NasdaqUniverseSnapshot;
  sourceChecklistPath: string;
}): ExistingDocDiff {
  const bySymbol = new Map(params.snapshot.rows.map((row) => [row.symbol, row]));
  const existingSet = new Set(params.existingSymbols);
  const rows: ExistingDocDiffRow[] = [];

  for (const symbol of params.existingSymbols) {
    const current = bySymbol.get(symbol);
    if (current) {
      if (current.isLikelyCommonEquity && current.marketCapBucket === "under_100m") {
        rows.push({
          symbol,
          status: "still_current_under_100m",
          currentSymbol: symbol,
          currentBucket: current.marketCapBucket,
          marketCap: current.marketCap,
          reason: "Existing checklist symbol is still current Nasdaq likely-common equity under $100M.",
        });
      } else {
        rows.push({
          symbol,
          status: "current_but_moved_bucket",
          currentSymbol: symbol,
          currentBucket: current.marketCapBucket,
          marketCap: current.marketCap,
          reason: current.isLikelyCommonEquity
            ? "Existing checklist symbol is current but no longer in the under-$100M clean bucket."
            : `Existing checklist symbol is current but filtered as ${current.commonEquityStatus}.`,
        });
      }
      continue;
    }

    const aliasCandidate = findAliasCandidate(symbol, bySymbol);
    if (aliasCandidate) {
      rows.push({
        symbol,
        status: "possible_alias_candidate",
        currentSymbol: aliasCandidate.symbol,
        currentBucket: aliasCandidate.marketCapBucket,
        marketCap: aliasCandidate.marketCap,
        reason: `Old symbol is absent, but ${aliasCandidate.symbol} is present and looks like a plausible current-symbol candidate.`,
      });
      continue;
    }

    rows.push({
      symbol,
      status: "not_in_current_nasdaq_screener",
      currentSymbol: null,
      currentBucket: null,
      marketCap: null,
      reason: "Existing checklist symbol was not found in the current Nasdaq screener snapshot.",
    });
  }

  for (const row of params.snapshot.rows) {
    if (row.isLikelyCommonEquity && row.marketCapBucket === "under_100m" && !existingSet.has(row.symbol)) {
      rows.push({
        symbol: row.symbol,
        status: "new_under_100m_candidate",
        currentSymbol: row.symbol,
        currentBucket: row.marketCapBucket,
        marketCap: row.marketCap,
        reason: "Current Nasdaq likely-common equity under $100M is not in the existing checklist.",
      });
    }
  }

  return {
    generatedAt: params.snapshot.generatedAt,
    sourceChecklistPath: params.sourceChecklistPath,
    rows: rows.sort((a, b) => a.status.localeCompare(b.status) || a.symbol.localeCompare(b.symbol)),
  };
}

function findAliasCandidate(symbol: string, bySymbol: Map<string, NasdaqUniverseRow>): NasdaqUniverseRow | null {
  const candidates = [
    symbol.endsWith("U") ? symbol.slice(0, -1) : "",
    symbol.endsWith("W") ? symbol.slice(0, -1) : "",
    symbol.endsWith("R") ? symbol.slice(0, -1) : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const row = bySymbol.get(candidate);
    if (row) {
      return row;
    }
  }
  return null;
}

export function formatUnder500Markdown(under500: NasdaqUnder500Universe): string {
  const lines = [
    "# NASDAQ Under $500M Market Cap Universe",
    "",
    `Generated at: ${under500.generatedAt}`,
    "",
    `Source: ${under500.source}`,
    "",
    "This is a generated view from the canonical Nasdaq universe. Market caps move; refresh before using it as a live scanner or candle-backfill queue.",
    "",
    "## Bucket Counts",
    "",
    "| Bucket | Count |",
    "| --- | ---: |",
    ...UNDER_500_BUCKETS.map((bucket) => `| ${BUCKET_LABELS[bucket]} | ${under500.bucketCounts[bucket]} |`),
    `| Total under $500M | ${UNDER_500_BUCKETS.reduce((total, bucket) => total + under500.bucketCounts[bucket], 0)} |`,
    "",
  ];

  for (const bucket of UNDER_500_BUCKETS) {
    const rows = under500.buckets[bucket];
    lines.push(`## ${BUCKET_LABELS[bucket]}`, "", "### Comma Separated", "", rows.map((row) => row.symbol).join(", ") || "None.", "", "### Details", "");
    lines.push(formatRowsTable(rows), "");
  }

  return `${lines.join("\n")}\n`;
}

export function formatExistingDocDiffMarkdown(diff: ExistingDocDiff): string {
  const counts = countBy(diff.rows, (row) => row.status);
  const lines = [
    "# Nasdaq Existing Under-$100M Checklist Diff",
    "",
    `Generated at: ${diff.generatedAt}`,
    "",
    `Source checklist: ${diff.sourceChecklistPath}`,
    "",
    "## Counts",
    "",
    "| Status | Count |",
    "| --- | ---: |",
    ...([
      "still_current_under_100m",
      "current_but_moved_bucket",
      "not_in_current_nasdaq_screener",
      "possible_alias_candidate",
      "new_under_100m_candidate",
    ] as ExistingDocDiffStatus[]).map((status) => `| ${status} | ${counts.get(status) ?? 0} |`),
    "",
    "## Rows",
    "",
    "| Symbol | Status | Current Symbol | Current Bucket | Market Cap | Reason |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...diff.rows.map((row) => `| ${row.symbol} | ${row.status} | ${row.currentSymbol ?? ""} | ${row.currentBucket ?? ""} | ${row.marketCap ? formatDollars(row.marketCap) : ""} | ${escapeMarkdownCell(row.reason)} |`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function writeNasdaqUniverseArtifacts(params: {
  snapshot: NasdaqUniverseSnapshot;
  rawRows: NasdaqRawScreenerRow[];
  checklistPath: string;
  masterJsonPath?: string;
  artifactsRoot?: string;
  docUnder500MarkdownPath?: string;
}): Promise<NasdaqUniverseWriteResult> {
  const masterJsonPath = params.masterJsonPath ?? "data/nasdaq-universe/nasdaq-current-universe.json";
  const artifactsRoot = params.artifactsRoot ?? join("artifacts", "nasdaq-marketcap-universe", dateStamp(params.snapshot.generatedAt));
  const docUnder500MarkdownPath = params.docUnder500MarkdownPath ?? "docs/nasdaq-under-500m-marketcap-universe.md";
  const under500 = buildUnder500Universe(params.snapshot);
  const checklistMarkdown = existsSync(params.checklistPath) ? await readFile(params.checklistPath, "utf8") : "";
  const existingSymbols = parseExistingUnder100mSymbols(checklistMarkdown);
  const diff = buildExistingDocDiff({
    existingSymbols,
    snapshot: params.snapshot,
    sourceChecklistPath: params.checklistPath,
  });

  const rawJsonPath = join(artifactsRoot, "nasdaq-raw-screener.json");
  const cleanJsonPath = join(artifactsRoot, "nasdaq-clean-universe.json");
  const under500JsonPath = join(artifactsRoot, "nasdaq-under500m-universe.json");
  const under500MarkdownPath = join(artifactsRoot, "nasdaq-under500m-universe.md");
  const diffMarkdownPath = join(artifactsRoot, "nasdaq-existing-doc-diff.md");
  const diffJsonPath = join(artifactsRoot, "nasdaq-existing-doc-diff.json");

  await Promise.all([
    mkdir(dirname(masterJsonPath), { recursive: true }),
    mkdir(artifactsRoot, { recursive: true }),
    mkdir(dirname(docUnder500MarkdownPath), { recursive: true }),
  ]);

  await writeJson(masterJsonPath, params.snapshot);
  await writeJson(rawJsonPath, { generatedAt: params.snapshot.generatedAt, source: params.snapshot.source, rows: params.rawRows });
  await writeJson(cleanJsonPath, {
    generatedAt: params.snapshot.generatedAt,
    source: params.snapshot.source,
    rows: params.snapshot.rows.filter((row) => row.isLikelyCommonEquity),
  });
  await writeJson(under500JsonPath, under500);
  await writeFile(under500MarkdownPath, formatUnder500Markdown(under500), "utf8");
  await writeFile(docUnder500MarkdownPath, formatUnder500Markdown(under500), "utf8");
  await writeFile(diffMarkdownPath, formatExistingDocDiffMarkdown(diff), "utf8");
  await writeJson(diffJsonPath, diff);

  return {
    masterJsonPath,
    rawJsonPath,
    cleanJsonPath,
    under500JsonPath,
    under500MarkdownPath,
    docUnder500MarkdownPath,
    diffMarkdownPath,
    diffJsonPath,
    snapshot: params.snapshot,
    under500,
    diff,
  };
}

export async function readNasdaqUniverseSnapshot(path: string): Promise<NasdaqUniverseSnapshot> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as NasdaqUniverseSnapshot;
  if (!Array.isArray(parsed.rows)) {
    throw new Error(`Invalid Nasdaq universe snapshot: ${path}`);
  }
  return parsed;
}

export function buildNasdaqUnder500BackfillPlan(params: {
  snapshot: NasdaqUniverseSnapshot;
  sourceUniversePath: string;
  warehouseDirectoryPath?: string;
  timeframes?: CandleFetchTimeframe[];
}): NasdaqBackfillPlan {
  const warehouseDirectoryPath = params.warehouseDirectoryPath ?? "data/candles";
  const timeframes = params.timeframes ?? ["daily", "4h", "5m"];
  const under500 = buildUnder500Universe(params.snapshot);
  const stages = UNDER_500_BUCKETS.map((bucket, index): NasdaqBackfillPlanStage => {
    const symbols = under500.buckets[bucket].map((row) => row.symbol);
    const coveredSymbols = symbols.filter((symbol) => hasWarehouseTimeframes(warehouseDirectoryPath, "ibkr", symbol, timeframes));
    const missingSymbols = symbols.filter((symbol) => !coveredSymbols.includes(symbol));
    return {
      stage: index + 1,
      bucket,
      symbols,
      missingSymbols,
      coveredSymbols,
      unresolvedSymbols: [],
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    sourceUniversePath: params.sourceUniversePath,
    warehouseDirectoryPath,
    provider: "ibkr",
    timeframes,
    dryRun: true,
    stages,
  };
}

export function formatNasdaqBackfillPlanMarkdown(plan: NasdaqBackfillPlan): string {
  const lines = [
    "# Nasdaq Under-$500M Candle Backfill Plan",
    "",
    `Generated at: ${plan.generatedAt}`,
    "",
    `Source universe: ${plan.sourceUniversePath}`,
    `Warehouse: ${plan.warehouseDirectoryPath}`,
    `Provider: ${plan.provider}`,
    `Timeframes: ${plan.timeframes.join(", ")}`,
    "",
    "This is a dry-run planning artifact. It does not fetch provider data.",
    "",
    "## Stages",
    "",
    "| Stage | Bucket | Symbols | Covered | Missing |",
    "| ---: | --- | ---: | ---: | ---: |",
    ...plan.stages.map((stage) => `| ${stage.stage} | ${BUCKET_LABELS[stage.bucket]} | ${stage.symbols.length} | ${stage.coveredSymbols.length} | ${stage.missingSymbols.length} |`),
    "",
  ];

  for (const stage of plan.stages) {
    lines.push(`## Stage ${stage.stage}: ${BUCKET_LABELS[stage.bucket]}`, "", "### Missing Symbols", "", stage.missingSymbols.join(", ") || "None.", "", "### Covered Symbols", "", stage.coveredSymbols.join(", ") || "None.", "");
  }

  return `${lines.join("\n")}\n`;
}

export async function writeNasdaqBackfillPlan(params: {
  plan: NasdaqBackfillPlan;
  outDir?: string;
}): Promise<{ jsonPath: string; markdownPath: string }> {
  const outDir = params.outDir ?? join("artifacts", "nasdaq-marketcap-universe", dateStamp(params.plan.generatedAt), "under500-backfill-plan");
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "nasdaq-under500m-backfill-plan.json");
  const markdownPath = join(outDir, "nasdaq-under500m-backfill-plan.md");
  await writeJson(jsonPath, params.plan);
  await writeFile(markdownPath, formatNasdaqBackfillPlanMarkdown(params.plan), "utf8");
  return { jsonPath, markdownPath };
}

function hasWarehouseTimeframes(root: string, provider: string, symbol: string, timeframes: CandleFetchTimeframe[]): boolean {
  return timeframes.every((timeframe) => {
    const path = join(root, provider, symbol, timeframe);
    return existsSync(path) && readdirSync(path).some((entry) => entry.endsWith(".jsonl"));
  });
}

function formatRowsTable(rows: NasdaqUniverseRow[]): string {
  if (rows.length === 0) {
    return "No tickers found in this bucket.\n";
  }
  return [
    "| Ticker | Company | Market Cap | Last Sale | Volume | Country | Sector | Industry |",
    "| --- | --- | ---: | ---: | ---: | --- | --- | --- |",
    ...rows.map((row) => `| ${row.symbol} | ${escapeMarkdownCell(row.name)} | ${formatDollars(row.marketCap)} | ${escapeMarkdownCell(row.lastSale || "N/A")} | ${row.volume.toLocaleString("en-US")} | ${escapeMarkdownCell(row.country || "N/A")} | ${escapeMarkdownCell(row.sector || "N/A")} | ${escapeMarkdownCell(row.industry || "N/A")} |`),
  ].join("\n");
}

function formatDollars(value: number): string {
  return `$${(value / 1_000_000).toFixed(2)}M`;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeNasdaqSymbol(value)).filter(Boolean))].sort();
}

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function dateStamp(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
