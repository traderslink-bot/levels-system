import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const ICE_PRODUCT_CODES_CSV_URL = "https://www.ice.com/api/productguide/info/codes/all/csv";

export type FuturesUniverseSource = "seed" | "ice_product_codes";

export type FuturesUniverseTier = "tier_1_liquid" | "tier_2_watch" | "full_inventory";

export type FuturesRoot = {
  root: string;
  name: string;
  exchange: string;
  currency: string;
  assetClass: string;
  tier: FuturesUniverseTier;
  source: FuturesUniverseSource;
  sourceProductId?: string;
  sourceMarketType?: string;
  sourceMicCode?: string;
  notes?: string;
};

export type IceProductCodeRow = {
  productName: string;
  productId: string;
  physical: string;
  logical: string;
  group: string;
  clearingAdmin: string;
  clearingVenue: string;
  micCode: string;
  marketTypeName: string;
  symbolCode: string;
};

export type FuturesUniverse = {
  generatedAt: string;
  sources: string[];
  counts: {
    totalRoots: number;
    seedRoots: number;
    iceRows: number;
    iceFutureRows: number;
    uniqueIceSymbolCodes: number;
    byTier: Record<FuturesUniverseTier, number>;
    byExchange: Record<string, number>;
    byAssetClass: Record<string, number>;
  };
  notes: string[];
  roots: FuturesRoot[];
  iceProducts: IceProductCodeRow[];
};

export type FuturesUniverseWriteResult = {
  masterJsonPath: string;
  markdownPath: string;
  artifactJsonPath: string;
  artifactMarkdownPath: string;
  universe: FuturesUniverse;
};

const SEED_ROOTS: FuturesRoot[] = [
  { root: "ES", name: "E-mini S&P 500", exchange: "CME", currency: "USD", assetClass: "Equity Index", tier: "tier_1_liquid", source: "seed" },
  { root: "MES", name: "Micro E-mini S&P 500", exchange: "CME", currency: "USD", assetClass: "Equity Index", tier: "tier_1_liquid", source: "seed" },
  { root: "NQ", name: "E-mini Nasdaq-100", exchange: "CME", currency: "USD", assetClass: "Equity Index", tier: "tier_1_liquid", source: "seed" },
  { root: "MNQ", name: "Micro E-mini Nasdaq-100", exchange: "CME", currency: "USD", assetClass: "Equity Index", tier: "tier_1_liquid", source: "seed" },
  { root: "RTY", name: "E-mini Russell 2000", exchange: "CME", currency: "USD", assetClass: "Equity Index", tier: "tier_1_liquid", source: "seed" },
  { root: "M2K", name: "Micro E-mini Russell 2000", exchange: "CME", currency: "USD", assetClass: "Equity Index", tier: "tier_1_liquid", source: "seed" },
  { root: "YM", name: "E-mini Dow", exchange: "CBOT", currency: "USD", assetClass: "Equity Index", tier: "tier_1_liquid", source: "seed" },
  { root: "MYM", name: "Micro E-mini Dow", exchange: "CBOT", currency: "USD", assetClass: "Equity Index", tier: "tier_1_liquid", source: "seed" },
  { root: "CL", name: "Crude Oil WTI", exchange: "NYMEX", currency: "USD", assetClass: "Energy", tier: "tier_1_liquid", source: "seed" },
  { root: "MCL", name: "Micro WTI Crude Oil", exchange: "NYMEX", currency: "USD", assetClass: "Energy", tier: "tier_1_liquid", source: "seed" },
  { root: "NG", name: "Henry Hub Natural Gas", exchange: "NYMEX", currency: "USD", assetClass: "Energy", tier: "tier_1_liquid", source: "seed" },
  { root: "RB", name: "RBOB Gasoline", exchange: "NYMEX", currency: "USD", assetClass: "Energy", tier: "tier_2_watch", source: "seed" },
  { root: "HO", name: "NY Harbor ULSD", exchange: "NYMEX", currency: "USD", assetClass: "Energy", tier: "tier_2_watch", source: "seed" },
  { root: "BZ", name: "Brent Crude Oil Last Day", exchange: "NYMEX", currency: "USD", assetClass: "Energy", tier: "tier_2_watch", source: "seed" },
  { root: "GC", name: "Gold", exchange: "COMEX", currency: "USD", assetClass: "Metals", tier: "tier_1_liquid", source: "seed" },
  { root: "MGC", name: "Micro Gold", exchange: "COMEX", currency: "USD", assetClass: "Metals", tier: "tier_1_liquid", source: "seed" },
  { root: "SI", name: "Silver", exchange: "COMEX", currency: "USD", assetClass: "Metals", tier: "tier_1_liquid", source: "seed" },
  { root: "SIL", name: "Micro Silver", exchange: "COMEX", currency: "USD", assetClass: "Metals", tier: "tier_2_watch", source: "seed" },
  { root: "HG", name: "Copper", exchange: "COMEX", currency: "USD", assetClass: "Metals", tier: "tier_1_liquid", source: "seed" },
  { root: "PL", name: "Platinum", exchange: "NYMEX", currency: "USD", assetClass: "Metals", tier: "tier_2_watch", source: "seed" },
  { root: "PA", name: "Palladium", exchange: "NYMEX", currency: "USD", assetClass: "Metals", tier: "tier_2_watch", source: "seed" },
  { root: "ZB", name: "U.S. Treasury Bond", exchange: "CBOT", currency: "USD", assetClass: "Rates", tier: "tier_1_liquid", source: "seed" },
  { root: "UB", name: "Ultra U.S. Treasury Bond", exchange: "CBOT", currency: "USD", assetClass: "Rates", tier: "tier_1_liquid", source: "seed" },
  { root: "ZN", name: "10-Year T-Note", exchange: "CBOT", currency: "USD", assetClass: "Rates", tier: "tier_1_liquid", source: "seed" },
  { root: "ZF", name: "5-Year T-Note", exchange: "CBOT", currency: "USD", assetClass: "Rates", tier: "tier_1_liquid", source: "seed" },
  { root: "ZT", name: "2-Year T-Note", exchange: "CBOT", currency: "USD", assetClass: "Rates", tier: "tier_1_liquid", source: "seed" },
  { root: "SR3", name: "Three-Month SOFR", exchange: "CME", currency: "USD", assetClass: "Rates", tier: "tier_2_watch", source: "seed" },
  { root: "6E", name: "Euro FX", exchange: "CME", currency: "USD", assetClass: "FX", tier: "tier_1_liquid", source: "seed" },
  { root: "6B", name: "British Pound FX", exchange: "CME", currency: "USD", assetClass: "FX", tier: "tier_1_liquid", source: "seed" },
  { root: "6J", name: "Japanese Yen FX", exchange: "CME", currency: "USD", assetClass: "FX", tier: "tier_1_liquid", source: "seed" },
  { root: "6A", name: "Australian Dollar FX", exchange: "CME", currency: "USD", assetClass: "FX", tier: "tier_1_liquid", source: "seed" },
  { root: "6C", name: "Canadian Dollar FX", exchange: "CME", currency: "USD", assetClass: "FX", tier: "tier_1_liquid", source: "seed" },
  { root: "6S", name: "Swiss Franc FX", exchange: "CME", currency: "USD", assetClass: "FX", tier: "tier_2_watch", source: "seed" },
  { root: "6N", name: "New Zealand Dollar FX", exchange: "CME", currency: "USD", assetClass: "FX", tier: "tier_2_watch", source: "seed" },
  { root: "6M", name: "Mexican Peso FX", exchange: "CME", currency: "USD", assetClass: "FX", tier: "tier_2_watch", source: "seed" },
  { root: "DX", name: "U.S. Dollar Index", exchange: "ICEUS", currency: "USD", assetClass: "FX", tier: "tier_2_watch", source: "seed" },
  { root: "ZC", name: "Corn", exchange: "CBOT", currency: "USD", assetClass: "Agriculture", tier: "tier_2_watch", source: "seed" },
  { root: "ZW", name: "Chicago SRW Wheat", exchange: "CBOT", currency: "USD", assetClass: "Agriculture", tier: "tier_2_watch", source: "seed" },
  { root: "ZS", name: "Soybeans", exchange: "CBOT", currency: "USD", assetClass: "Agriculture", tier: "tier_2_watch", source: "seed" },
  { root: "ZM", name: "Soybean Meal", exchange: "CBOT", currency: "USD", assetClass: "Agriculture", tier: "tier_2_watch", source: "seed" },
  { root: "ZL", name: "Soybean Oil", exchange: "CBOT", currency: "USD", assetClass: "Agriculture", tier: "tier_2_watch", source: "seed" },
  { root: "KE", name: "KC HRW Wheat", exchange: "CBOT", currency: "USD", assetClass: "Agriculture", tier: "tier_2_watch", source: "seed" },
  { root: "LE", name: "Live Cattle", exchange: "CME", currency: "USD", assetClass: "Livestock", tier: "tier_2_watch", source: "seed" },
  { root: "HE", name: "Lean Hogs", exchange: "CME", currency: "USD", assetClass: "Livestock", tier: "tier_2_watch", source: "seed" },
  { root: "GF", name: "Feeder Cattle", exchange: "CME", currency: "USD", assetClass: "Livestock", tier: "tier_2_watch", source: "seed" },
  { root: "BTC", name: "Bitcoin", exchange: "CME", currency: "USD", assetClass: "Crypto", tier: "tier_1_liquid", source: "seed" },
  { root: "MBT", name: "Micro Bitcoin", exchange: "CME", currency: "USD", assetClass: "Crypto", tier: "tier_1_liquid", source: "seed" },
  { root: "ETH", name: "Ether", exchange: "CME", currency: "USD", assetClass: "Crypto", tier: "tier_1_liquid", source: "seed" },
  { root: "MET", name: "Micro Ether", exchange: "CME", currency: "USD", assetClass: "Crypto", tier: "tier_1_liquid", source: "seed" },
];

export async function fetchIceProductCodes(fetchImpl: typeof fetch = fetch): Promise<IceProductCodeRow[]> {
  const response = await fetchImpl(ICE_PRODUCT_CODES_CSV_URL, {
    headers: {
      Accept: "text/csv,application/vnd.ms-excel,*/*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`ICE product-code request failed with status ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return parseIceCsv(text);
}

export function buildFuturesUniverse(params: {
  iceProducts?: IceProductCodeRow[];
  generatedAt?: string;
} = {}): FuturesUniverse {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const iceProducts = [...(params.iceProducts ?? [])].sort((a, b) => a.symbolCode.localeCompare(b.symbolCode));
  const iceFutureRows = iceProducts.filter(isLikelyIceFuture);
  const rootsByKey = new Map<string, FuturesRoot>();

  for (const root of SEED_ROOTS) {
    rootsByKey.set(rootKey(root), root);
  }

  for (const row of iceFutureRows) {
    const root = normalizeSymbol(row.symbolCode);
    if (!root) {
      continue;
    }
    const universeRoot: FuturesRoot = {
      root,
      name: row.productName,
      exchange: normalizeIceExchange(row),
      currency: "USD",
      assetClass: row.group || "Unknown",
      tier: "full_inventory",
      source: "ice_product_codes",
      sourceProductId: row.productId,
      sourceMarketType: row.marketTypeName,
      sourceMicCode: row.micCode,
      notes: "Imported as inventory only; qualify against IBKR before candle backfill.",
    };
    const key = rootKey(universeRoot);
    if (!rootsByKey.has(key)) {
      rootsByKey.set(key, universeRoot);
    }
  }

  const roots = [...rootsByKey.values()].sort((a, b) =>
    a.exchange.localeCompare(b.exchange) || a.root.localeCompare(b.root) || a.name.localeCompare(b.name),
  );

  return {
    generatedAt,
    sources: [
      "Seeded liquid CME/CBOT/NYMEX/COMEX/ICE roots for first monitoring tiers.",
      ICE_PRODUCT_CODES_CSV_URL,
    ],
    counts: {
      totalRoots: roots.length,
      seedRoots: SEED_ROOTS.length,
      iceRows: iceProducts.length,
      iceFutureRows: iceFutureRows.length,
      uniqueIceSymbolCodes: new Set(iceProducts.map((row) => normalizeSymbol(row.symbolCode)).filter(Boolean)).size,
      byTier: countBy(roots, (root) => root.tier) as Record<FuturesUniverseTier, number>,
      byExchange: countBy(roots, (root) => root.exchange),
      byAssetClass: countBy(roots, (root) => root.assetClass),
    },
    notes: [
      "This is a futures universe inventory, not a candle-backfill queue.",
      "Futures contracts require root + exchange + expiry/month before IBKR candle requests can be made.",
      "Run an IBKR qualification pass later to mark which roots/contracts your account can resolve and download.",
      "CME-family products are seeded here because the CME public product-slate API blocked automated access from this environment.",
    ],
    roots,
    iceProducts,
  };
}

export async function writeFuturesUniverseArtifacts(params: {
  universe: FuturesUniverse;
  masterJsonPath?: string;
  markdownPath?: string;
  artifactsRoot?: string;
}): Promise<FuturesUniverseWriteResult> {
  const masterJsonPath = params.masterJsonPath ?? "data/futures-universe/futures-current-universe.json";
  const markdownPath = params.markdownPath ?? "docs/futures-universe.md";
  const artifactsRoot = params.artifactsRoot ?? join("artifacts", "futures-universe", dateStamp(params.universe.generatedAt));
  const artifactJsonPath = join(artifactsRoot, "futures-universe.json");
  const artifactMarkdownPath = join(artifactsRoot, "futures-universe.md");

  await Promise.all([
    mkdir(dirname(masterJsonPath), { recursive: true }),
    mkdir(dirname(markdownPath), { recursive: true }),
    mkdir(artifactsRoot, { recursive: true }),
  ]);

  await writeJson(masterJsonPath, params.universe);
  await writeJson(artifactJsonPath, params.universe);
  const markdown = formatFuturesUniverseMarkdown(params.universe);
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(artifactMarkdownPath, markdown, "utf8");

  return {
    masterJsonPath,
    markdownPath,
    artifactJsonPath,
    artifactMarkdownPath,
    universe: params.universe,
  };
}

export function formatFuturesUniverseMarkdown(universe: FuturesUniverse): string {
  const lines = [
    "# Futures Universe",
    "",
    `Generated at: ${universe.generatedAt}`,
    "",
    "This is an inventory only. It does not mean futures candles have been backfilled.",
    "",
    "## Counts",
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Total futures roots/products in universe | ${universe.counts.totalRoots.toLocaleString("en-US")} |`,
    `| Seed roots | ${universe.counts.seedRoots.toLocaleString("en-US")} |`,
    `| ICE product-code rows imported | ${universe.counts.iceRows.toLocaleString("en-US")} |`,
    `| ICE futures-like rows imported | ${universe.counts.iceFutureRows.toLocaleString("en-US")} |`,
    `| Unique ICE symbol codes | ${universe.counts.uniqueIceSymbolCodes.toLocaleString("en-US")} |`,
    "",
    "## Notes",
    "",
    ...universe.notes.map((note) => `- ${note}`),
    "",
    "## Tier Counts",
    "",
    "| Tier | Count |",
    "| --- | ---: |",
    ...Object.entries(universe.counts.byTier).map(([tier, count]) => `| ${tier} | ${count.toLocaleString("en-US")} |`),
    "",
    "## Exchange Counts",
    "",
    "| Exchange | Count |",
    "| --- | ---: |",
    ...Object.entries(universe.counts.byExchange)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([exchange, count]) => `| ${escapeMarkdownCell(exchange)} | ${count.toLocaleString("en-US")} |`),
    "",
    "## Tier 1 Liquid Roots",
    "",
    formatRootTable(universe.roots.filter((root) => root.tier === "tier_1_liquid")),
    "",
    "## Tier 2 Watch Roots",
    "",
    formatRootTable(universe.roots.filter((root) => root.tier === "tier_2_watch")),
    "",
    "## Full Inventory Sample",
    "",
    formatRootTable(universe.roots.filter((root) => root.tier === "full_inventory").slice(0, 250)),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function parseIceCsv(text: string): IceProductCodeRow[] {
  const rows = parseCsv(text);
  const [header, ...records] = rows;
  if (!header) {
    return [];
  }
  const index = new Map(header.map((name, position) => [name, position]));
  return records
    .map((record) => ({
      productName: extractHyperlinkLabel(readCsv(record, index, "PRODUCT (Click to open in Browser)")),
      productId: readCsv(record, index, "PRODUCT ID"),
      physical: readCsv(record, index, "PHYSICAL"),
      logical: readCsv(record, index, "LOGICAL"),
      group: readCsv(record, index, "GROUP"),
      clearingAdmin: readCsv(record, index, "CLEARING ADMIN"),
      clearingVenue: readCsv(record, index, "CLEARING VENUE"),
      micCode: readCsv(record, index, "MIC CODE"),
      marketTypeName: readCsv(record, index, "MARKET TYPE NAME"),
      symbolCode: readCsv(record, index, "SYMBOL CODE"),
    }))
    .filter((row) => row.symbolCode || row.productName);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function readCsv(record: string[], index: Map<string, number>, column: string): string {
  const position = index.get(column);
  return position === undefined ? "" : (record[position] ?? "").trim();
}

function extractHyperlinkLabel(value: string): string {
  const match = value.match(/HYPERLINK\(".*?","(.*)"\)/);
  return (match?.[1] ?? value).replace(/""/g, '"').trim();
}

function isLikelyIceFuture(row: IceProductCodeRow): boolean {
  return /\bfutures?\b/i.test(row.productName) || /\bfutures?\b/i.test(row.marketTypeName);
}

function normalizeIceExchange(row: IceProductCodeRow): string {
  if (row.micCode === "IFUS" || row.micCode === "ICUS") {
    return "ICEUS";
  }
  if (row.micCode === "IFEU" || row.micCode === "IFED") {
    return "ICEEU";
  }
  return row.micCode || row.clearingVenue || "ICE";
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function rootKey(root: FuturesRoot): string {
  return `${root.exchange}:${root.root}`;
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function formatRootTable(rows: FuturesRoot[]): string {
  if (rows.length === 0) {
    return "No roots found.";
  }
  return [
    "| Root | Name | Exchange | Asset Class | Tier | Source |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.root} | ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell(row.exchange)} | ${escapeMarkdownCell(row.assetClass)} | ${row.tier} | ${row.source} |`),
  ].join("\n");
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
