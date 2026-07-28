import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type NasdaqMarketCapBucket,
  type NasdaqRawScreenerRow,
  type NasdaqUniverseRow,
  type NasdaqUniverseSnapshot,
  normalizeNasdaqRow,
} from "./nasdaq-marketcap-universe.js";

export const NYSE_SCREENER_URL =
  "https://api.nasdaq.com/api/screener/stocks?exchange=nyse&download=true";

export type NyseMarketCapUniverse = {
  generatedAt: string;
  source: string;
  bucketCounts: Record<Exclude<NasdaqMarketCapBucket, "invalid_or_missing">, number>;
  buckets: Record<Exclude<NasdaqMarketCapBucket, "invalid_or_missing">, NasdaqUniverseRow[]>;
};

export type NyseUniverseWriteResult = {
  masterJsonPath: string;
  rawJsonPath: string;
  cleanJsonPath: string;
  marketCapJsonPath: string;
  marketCapMarkdownPath: string;
  docMarketCapMarkdownPath: string;
  snapshot: NasdaqUniverseSnapshot;
  marketCapUniverse: NyseMarketCapUniverse;
};

const MARKET_CAP_BUCKETS: Array<Exclude<NasdaqMarketCapBucket, "invalid_or_missing">> = [
  "under_100m",
  "100m_to_200m",
  "200m_to_300m",
  "300m_to_400m",
  "400m_to_500m",
  "500m_plus",
];

const BUCKET_LABELS: Record<Exclude<NasdaqMarketCapBucket, "invalid_or_missing">, string> = {
  under_100m: "Under $100M",
  "100m_to_200m": "$100M to $200M",
  "200m_to_300m": "$200M to $300M",
  "300m_to_400m": "$300M to $400M",
  "400m_to_500m": "$400M to $500M",
  "500m_plus": "$500M+",
};

export async function fetchNyseScreenerRows(fetchImpl: typeof fetch = fetch): Promise<NasdaqRawScreenerRow[]> {
  const response = await fetchImpl(NYSE_SCREENER_URL, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/market-activity/stocks/screener",
    },
  });

  if (!response.ok) {
    throw new Error(`NYSE screener request failed with status ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as { data?: { rows?: NasdaqRawScreenerRow[] } };
  if (!Array.isArray(payload.data?.rows)) {
    throw new Error("NYSE screener response did not include data.rows.");
  }

  return payload.data.rows;
}

export function buildNyseUniverseSnapshot(rows: NasdaqRawScreenerRow[], generatedAt = new Date().toISOString()): NasdaqUniverseSnapshot {
  const normalizedRows = rows
    .map(normalizeNasdaqRow)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    generatedAt,
    source: NYSE_SCREENER_URL,
    rawCount: rows.length,
    cleanCount: normalizedRows.filter((row) => row.isLikelyCommonEquity).length,
    rows: normalizedRows,
  };
}

export function buildNyseMarketCapUniverse(snapshot: NasdaqUniverseSnapshot): NyseMarketCapUniverse {
  const buckets: NyseMarketCapUniverse["buckets"] = {
    under_100m: [],
    "100m_to_200m": [],
    "200m_to_300m": [],
    "300m_to_400m": [],
    "400m_to_500m": [],
    "500m_plus": [],
  };
  for (const row of snapshot.rows) {
    if (row.isLikelyCommonEquity && row.marketCapBucket !== "invalid_or_missing") {
      buckets[row.marketCapBucket].push(row);
    }
  }
  for (const bucket of MARKET_CAP_BUCKETS) {
    buckets[bucket].sort((a, b) => a.marketCap - b.marketCap || a.symbol.localeCompare(b.symbol));
  }
  return {
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
    bucketCounts: Object.fromEntries(MARKET_CAP_BUCKETS.map((bucket) => [bucket, buckets[bucket].length])) as NyseMarketCapUniverse["bucketCounts"],
    buckets,
  };
}

export function formatNyseMarketCapMarkdown(universe: NyseMarketCapUniverse): string {
  const total = MARKET_CAP_BUCKETS.reduce((sum, bucket) => sum + universe.bucketCounts[bucket], 0);
  const lines = [
    "# NYSE Market Cap Universe",
    "",
    `Generated at: ${universe.generatedAt}`,
    "",
    `Source: ${universe.source}`,
    "",
    "This is a generated view from the Nasdaq screener endpoint for NYSE listings. Market caps move; refresh before using it as a live scanner or candle-backfill queue.",
    "",
    "## Bucket Counts",
    "",
    "| Bucket | Count |",
    "| --- | ---: |",
    ...MARKET_CAP_BUCKETS.map((bucket) => `| ${BUCKET_LABELS[bucket]} | ${universe.bucketCounts[bucket]} |`),
    `| Total clean NYSE universe | ${total} |`,
    "",
  ];

  for (const bucket of MARKET_CAP_BUCKETS) {
    const rows = universe.buckets[bucket];
    lines.push(`## ${BUCKET_LABELS[bucket]}`, "", "### Comma Separated", "", rows.map((row) => row.symbol).join(", ") || "None.", "", "### Details", "");
    lines.push(formatRowsTable(rows), "");
  }

  return `${lines.join("\n")}\n`;
}

export async function writeNyseUniverseArtifacts(params: {
  snapshot: NasdaqUniverseSnapshot;
  rawRows: NasdaqRawScreenerRow[];
  masterJsonPath?: string;
  artifactsRoot?: string;
  docMarketCapMarkdownPath?: string;
}): Promise<NyseUniverseWriteResult> {
  const masterJsonPath = params.masterJsonPath ?? "data/nyse-universe/nyse-current-universe.json";
  const artifactsRoot = params.artifactsRoot ?? join("artifacts", "nyse-marketcap-universe", dateStamp(params.snapshot.generatedAt));
  const docMarketCapMarkdownPath = params.docMarketCapMarkdownPath ?? "docs/nyse-marketcap-universe.md";
  const marketCapUniverse = buildNyseMarketCapUniverse(params.snapshot);

  const rawJsonPath = join(artifactsRoot, "nyse-raw-screener.json");
  const cleanJsonPath = join(artifactsRoot, "nyse-clean-universe.json");
  const marketCapJsonPath = join(artifactsRoot, "nyse-marketcap-universe.json");
  const marketCapMarkdownPath = join(artifactsRoot, "nyse-marketcap-universe.md");

  await Promise.all([
    mkdir(dirname(masterJsonPath), { recursive: true }),
    mkdir(artifactsRoot, { recursive: true }),
    mkdir(dirname(docMarketCapMarkdownPath), { recursive: true }),
  ]);

  await writeJson(masterJsonPath, params.snapshot);
  await writeJson(rawJsonPath, { generatedAt: params.snapshot.generatedAt, source: params.snapshot.source, rows: params.rawRows });
  await writeJson(cleanJsonPath, {
    generatedAt: params.snapshot.generatedAt,
    source: params.snapshot.source,
    rows: params.snapshot.rows.filter((row) => row.isLikelyCommonEquity),
  });
  await writeJson(marketCapJsonPath, marketCapUniverse);
  await writeFile(marketCapMarkdownPath, formatNyseMarketCapMarkdown(marketCapUniverse), "utf8");
  await writeFile(docMarketCapMarkdownPath, formatNyseMarketCapMarkdown(marketCapUniverse), "utf8");

  return {
    masterJsonPath,
    rawJsonPath,
    cleanJsonPath,
    marketCapJsonPath,
    marketCapMarkdownPath,
    docMarketCapMarkdownPath,
    snapshot: params.snapshot,
    marketCapUniverse,
  };
}

export async function readNyseUniverseSnapshot(path: string): Promise<NasdaqUniverseSnapshot> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as NasdaqUniverseSnapshot;
  if (!Array.isArray(parsed.rows)) {
    throw new Error(`Invalid NYSE universe snapshot: ${path}`);
  }
  return parsed;
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

function dateStamp(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
