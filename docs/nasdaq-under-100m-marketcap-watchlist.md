
THIS FILE IS NOT PARET OF THIS PROJECT PLEASE INGORE IT UNLESS YOU ARE INSTRUCTED TO USE IT.

# NASDAQ Under $100M Market Cap Watchlist Generator

Generated: 2026-05-04
Timezone context: America/Toronto

## What this file is

This file is a clean, repeatable generator for building the exact watchlist you asked for:

1. NASDAQ only
2. Market cap under $100M
3. Organized into these buckets:
   - Under $30M, excluding the under $30M tickers already given earlier
   - $30M to $50M
   - $50M to $70M
   - $70M to $100M
4. Excludes obvious warrants, units, rights, notes, preferreds, and other non-common-equity style securities by default

I am giving this as a generator instead of a static pasted list because market caps in this range change constantly intraday. Running this script gives you the current NASDAQ screener output at the time you run it.

## Data source

Primary source:

```text
https://api.nasdaq.com/api/screener/stocks?exchange=nasdaq&download=true
```

The endpoint returns rows with fields such as:

```text
symbol, name, lastsale, netchange, pctchange, marketCap, country, ipoyear, volume, sector, industry, url
```

## Tickers already given earlier to exclude from the under $30M bucket

```text
YYAI, QCLS, CRWS, KYNB, REFR, LSTA, SNTI, CGTL, AGPU, UFG, TMDE, TOP, RNTX, HBIO, CCEL, AIXC, PLRZ, SWAG, BIOX, NEON, NEUP, FARM, LVLU, ZTG, FLUX, MNTS, FTHM, CLPS, ATCX
```

## How to run

Create a file named:

```text
generate-nasdaq-under-100m.mjs
```

Paste the full script below into that file, then run:

```powershell
node generate-nasdaq-under-100m.mjs
```

It will create:

```text
nasdaq-under-100m-marketcap-current.md
nasdaq-under-100m-marketcap-current.json
```

The `.md` file will contain the organized ticker buckets. The `.json` file will contain the full detailed rows.

## Complete generator script

```javascript
// 2026-05-04 00:00 America/Toronto - Complete NASDAQ under $100M market cap watchlist generator.
import fs from "node:fs/promises";

const NASDAQ_SCREENER_URL = "https://api.nasdaq.com/api/screener/stocks?exchange=nasdaq&download=true";

const EXCLUDED_UNDER_30M_TICKERS = new Set([
  "YYAI", "QCLS", "CRWS", "KYNB", "REFR", "LSTA", "SNTI", "CGTL", "AGPU", "UFG",
  "TMDE", "TOP", "RNTX", "HBIO", "CCEL", "AIXC", "PLRZ", "SWAG", "BIOX", "NEON",
  "NEUP", "FARM", "LVLU", "ZTG", "FLUX", "MNTS", "FTHM", "CLPS", "ATCX",
]);

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
  /\bFund\b/i,
  /\bTrust\b/i,
];

function parseMarketCap(rawValue) {
  const numericValue = Number(String(rawValue ?? "").replace(/[^0-9.-]/g, ""));

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return numericValue;
}

function normalizeTicker(symbol) {
  return String(symbol ?? "").trim().toUpperCase();
}

function isProbablyCommonEquity(row) {
  const ticker = normalizeTicker(row.symbol);
  const name = String(row.name ?? "").replace(/\s+/g, " ").trim();
  const marketCap = parseMarketCap(row.marketCap);

  if (!ticker || marketCap <= 0) {
    return false;
  }

  if (BLOCKED_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return false;
  }

  if (ticker.endsWith("W") || ticker.endsWith("WS") || ticker.endsWith("WT") || ticker.endsWith("U") || ticker.endsWith("R")) {
    return false;
  }

  return true;
}

function bucketForMarketCap(marketCap) {
  if (marketCap < 30_000_000) {
    return "under30";
  }

  if (marketCap >= 30_000_000 && marketCap < 50_000_000) {
    return "thirtyToFifty";
  }

  if (marketCap >= 50_000_000 && marketCap < 70_000_000) {
    return "fiftyToSeventy";
  }

  if (marketCap >= 70_000_000 && marketCap < 100_000_000) {
    return "seventyToOneHundred";
  }

  return null;
}

function formatDollars(value) {
  return `$${(value / 1_000_000).toFixed(2)}M`;
}

function formatMarkdownTable(rows) {
  if (rows.length === 0) {
    return "No tickers found in this bucket at generation time.\n";
  }

  const header = "| Ticker | Company | Market Cap | Last Sale | Volume | Country | Sector | Industry |\n|---|---|---:|---:|---:|---|---|---|";
  const body = rows.map((row) => {
    const ticker = normalizeTicker(row.symbol);
    const name = String(row.name ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "/");
    const marketCap = formatDollars(parseMarketCap(row.marketCap));
    const lastSale = String(row.lastsale ?? "").trim() || "N/A";
    const volume = Number(row.volume ?? 0).toLocaleString("en-US");
    const country = String(row.country ?? "").trim().replace(/\|/g, "/") || "N/A";
    const sector = String(row.sector ?? "").trim().replace(/\|/g, "/") || "N/A";
    const industry = String(row.industry ?? "").trim().replace(/\|/g, "/") || "N/A";

    return `| ${ticker} | ${name} | ${marketCap} | ${lastSale} | ${volume} | ${country} | ${sector} | ${industry} |`;
  }).join("\n");

  return `${header}\n${body}\n`;
}

function formatCommaSeparated(rows) {
  return rows.map((row) => normalizeTicker(row.symbol)).join(", ");
}

async function fetchNasdaqRows() {
  const response = await fetch(NASDAQ_SCREENER_URL, {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
      "Origin": "https://www.nasdaq.com",
      "Referer": "https://www.nasdaq.com/market-activity/stocks/screener",
    },
  });

  if (!response.ok) {
    throw new Error(`NASDAQ screener request failed with status ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const rows = payload?.data?.rows;

  if (!Array.isArray(rows)) {
    throw new Error("NASDAQ screener response did not include data.rows.");
  }

  return rows;
}

async function main() {
  const rows = await fetchNasdaqRows();

  const filteredRows = rows
    .filter(isProbablyCommonEquity)
    .map((row) => ({ ...row, marketCapNumber: parseMarketCap(row.marketCap) }))
    .filter((row) => row.marketCapNumber > 0 && row.marketCapNumber < 100_000_000)
    .sort((a, b) => a.marketCapNumber - b.marketCapNumber || normalizeTicker(a.symbol).localeCompare(normalizeTicker(b.symbol)));

  const buckets = {
    under30: [],
    thirtyToFifty: [],
    fiftyToSeventy: [],
    seventyToOneHundred: [],
  };

  for (const row of filteredRows) {
    const ticker = normalizeTicker(row.symbol);
    const bucket = bucketForMarketCap(row.marketCapNumber);

    if (!bucket) {
      continue;
    }

    if (bucket === "under30" && EXCLUDED_UNDER_30M_TICKERS.has(ticker)) {
      continue;
    }

    buckets[bucket].push(row);
  }

  const generatedAt = new Date().toISOString();

  const markdown = `# NASDAQ Tickers Under $100M Market Cap\n\nGenerated at: ${generatedAt}\n\nSource: ${NASDAQ_SCREENER_URL}\n\nFilters applied:\n\n1. NASDAQ exchange from Nasdaq screener endpoint\n2. Market cap greater than $0 and under $100M\n3. Excluded obvious warrants, units, rights, notes, preferreds, funds, and ETFs by name/ticker pattern\n4. Under $30M bucket excludes the tickers already given earlier\n\nImportant: Market caps in this range change fast. Re-run this generator before importing into a live scanner.\n\n## Bucket counts\n\n| Bucket | Count |\n|---|---:|\n| Under $30M, excluding prior tickers | ${buckets.under30.length} |\n| $30M to $50M | ${buckets.thirtyToFifty.length} |\n| $50M to $70M | ${buckets.fiftyToSeventy.length} |\n| $70M to $100M | ${buckets.seventyToOneHundred.length} |\n| Total | ${buckets.under30.length + buckets.thirtyToFifty.length + buckets.fiftyToSeventy.length + buckets.seventyToOneHundred.length} |\n\n## Under $30M, excluding prior tickers\n\n### Comma-separated\n\n${formatCommaSeparated(buckets.under30)}\n\n### Details\n\n${formatMarkdownTable(buckets.under30)}\n\n## $30M to $50M\n\n### Comma-separated\n\n${formatCommaSeparated(buckets.thirtyToFifty)}\n\n### Details\n\n${formatMarkdownTable(buckets.thirtyToFifty)}\n\n## $50M to $70M\n\n### Comma-separated\n\n${formatCommaSeparated(buckets.fiftyToSeventy)}\n\n### Details\n\n${formatMarkdownTable(buckets.fiftyToSeventy)}\n\n## $70M to $100M\n\n### Comma-separated\n\n${formatCommaSeparated(buckets.seventyToOneHundred)}\n\n### Details\n\n${formatMarkdownTable(buckets.seventyToOneHundred)}\n`;

  await fs.writeFile("nasdaq-under-100m-marketcap-current.md", markdown, "utf8");
  await fs.writeFile("nasdaq-under-100m-marketcap-current.json", JSON.stringify({ generatedAt, buckets }, null, 2), "utf8");

  console.log("Created nasdaq-under-100m-marketcap-current.md");
  console.log("Created nasdaq-under-100m-marketcap-current.json");
  console.log(`Under $30M excluding prior tickers: ${buckets.under30.length}`);
  console.log(`$30M to $50M: ${buckets.thirtyToFifty.length}`);
  console.log(`$50M to $70M: ${buckets.fiftyToSeventy.length}`);
  console.log(`$70M to $100M: ${buckets.seventyToOneHundred.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Notes for scanner use

For your trading scanner, I would still add your own filters after generation:

1. Minimum average volume
2. Minimum current day volume
3. Minimum price
4. Maximum spread
5. Float filter if you have a reliable float source
6. Recent reverse split or dilution warning filter
7. Exclude SPAC shells if you do not want them
8. Exclude Chinese ADRs or foreign issuers if you want a cleaner U.S. operating-company list

## Why this should be refreshed

A stock can move from one bucket to another during the same day because market cap changes with price. In this low market cap range, dilution, reverse splits, Nasdaq compliance events, mergers, and news can also quickly change whether a ticker belongs in the list.
