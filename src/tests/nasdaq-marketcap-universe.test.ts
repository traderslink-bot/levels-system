import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildExistingDocDiff,
  buildNasdaqUnder500BackfillPlan,
  buildNasdaqUniverseSnapshot,
  buildUnder500Universe,
  bucketNasdaqMarketCap,
  classifyCommonEquity,
  formatUnder500Markdown,
  parseExistingUnder100mSymbols,
  parseNasdaqMarketCap,
  writeNasdaqBackfillPlan,
  writeNasdaqUniverseArtifacts,
  type NasdaqRawScreenerRow,
} from "../lib/review/nasdaq-marketcap-universe.js";
import {
  buildNasdaqUnder500CandleBackfillPlan,
  formatNasdaqUnder500CandleBackfillPlan,
} from "../lib/review/nasdaq-under500-candle-backfill.js";
import {
  buildNasdaqOver500CandleBackfillPlan,
  buildOver500Universe,
  formatNasdaqOver500CandleBackfillPlan,
} from "../lib/review/nasdaq-over500-candle-backfill.js";
import {
  buildNyseMarketCapUniverse,
  buildNyseUniverseSnapshot,
  formatNyseMarketCapMarkdown,
} from "../lib/review/nyse-marketcap-universe.js";

const ROWS: NasdaqRawScreenerRow[] = [
  { symbol: "AAA", name: "AAA Inc. Common Stock", lastsale: "$1.00", marketCap: "99999999", volume: "1000" },
  { symbol: "BBB", name: "BBB Inc. Common Stock", lastsale: "$2.00", marketCap: "100000000", volume: "2000" },
  { symbol: "CCC", name: "CCC Inc. Common Stock", lastsale: "$3.00", marketCap: "200000000", volume: "3000" },
  { symbol: "DDD", name: "DDD Inc. Common Stock", lastsale: "$4.00", marketCap: "300000000", volume: "4000" },
  { symbol: "EEE", name: "EEE Inc. Common Stock", lastsale: "$5.00", marketCap: "400000000", volume: "5000" },
  { symbol: "FFF", name: "FFF Inc. Common Stock", lastsale: "$6.00", marketCap: "500000000", volume: "6000" },
  { symbol: "BADW", name: "Bad Warrants", lastsale: "$0.01", marketCap: "1000000", volume: "1" },
  { symbol: "WTO", name: "UTime Limited Class A Ordinary Shares", lastsale: "$0.97", marketCap: "1733079", volume: "777638" },
];

test("parses Nasdaq market caps and bucket boundaries", () => {
  assert.equal(parseNasdaqMarketCap("$123,456,789.00"), 123456789);
  assert.equal(bucketNasdaqMarketCap(99_999_999), "under_100m");
  assert.equal(bucketNasdaqMarketCap(100_000_000), "100m_to_200m");
  assert.equal(bucketNasdaqMarketCap(200_000_000), "200m_to_300m");
  assert.equal(bucketNasdaqMarketCap(300_000_000), "300m_to_400m");
  assert.equal(bucketNasdaqMarketCap(400_000_000), "400m_to_500m");
  assert.equal(bucketNasdaqMarketCap(500_000_000), "500m_plus");
  assert.equal(bucketNasdaqMarketCap(0), "invalid_or_missing");
});

test("classifies common equity conservatively", () => {
  assert.equal(classifyCommonEquity({ symbol: "ABCD", name: "ABCD Common Stock", marketCap: 1 }), "likely_common_equity");
  assert.equal(classifyCommonEquity({ symbol: "ABCDW", name: "ABCD Warrants", marketCap: 1 }), "blocked_name_pattern");
  assert.equal(classifyCommonEquity({ symbol: "ABCDW", name: "ABCD Holdings", marketCap: 1 }), "blocked_symbol_suffix");
  assert.equal(classifyCommonEquity({ symbol: "ACTU", name: "Actuate Therapeutics Inc. Common Stock", marketCap: 1 }), "likely_common_equity");
  assert.equal(classifyCommonEquity({ symbol: "ABCD", name: "ABCD Warrants", marketCap: 1 }), "blocked_name_pattern");
  assert.equal(classifyCommonEquity({ symbol: "ABCD", name: "ABCD Common Stock", marketCap: 0 }), "invalid_market_cap");
});

test("builds under-500M universe with no duplicate bucket membership", () => {
  const snapshot = buildNasdaqUniverseSnapshot(ROWS, "2026-05-07T00:00:00.000Z");
  const under500 = buildUnder500Universe(snapshot);
  assert.equal(under500.bucketCounts.under_100m, 2);
  assert.equal(under500.bucketCounts["100m_to_200m"], 1);
  assert.equal(under500.bucketCounts["200m_to_300m"], 1);
  assert.equal(under500.bucketCounts["300m_to_400m"], 1);
  assert.equal(under500.bucketCounts["400m_to_500m"], 1);
  const symbols = Object.values(under500.buckets).flat().map((row) => row.symbol);
  assert.equal(symbols.length, new Set(symbols).size);
  assert.ok(!symbols.includes("FFF"));
  assert.ok(!symbols.includes("BADW"));
});

test("diff classifies stale, alias, moved, current, and new under-100M symbols", () => {
  const snapshot = buildNasdaqUniverseSnapshot(ROWS, "2026-05-07T00:00:00.000Z");
  const diff = buildExistingDocDiff({
    existingSymbols: ["AAA", "BBB", "OLD", "WTOU"],
    snapshot,
    sourceChecklistPath: "checklist.md",
  });
  const bySymbol = new Map(diff.rows.map((row) => [row.symbol, row]));
  assert.equal(bySymbol.get("AAA")?.status, "still_current_under_100m");
  assert.equal(bySymbol.get("BBB")?.status, "current_but_moved_bucket");
  assert.equal(bySymbol.get("OLD")?.status, "not_in_current_nasdaq_screener");
  assert.equal(bySymbol.get("WTOU")?.status, "possible_alias_candidate");
  assert.equal(bySymbol.get("WTOU")?.currentSymbol, "WTO");
  assert.equal(bySymbol.get("WTO")?.status, "new_under_100m_candidate");
});

test("parses existing under-100M checklist and formats markdown", () => {
  const markdown = [
    "# All bucketed NASDAQ under $100M tickers, deduped",
    "",
    "AAA, BBB, WTOU",
    "",
    "---",
  ].join("\n");
  assert.deepEqual(parseExistingUnder100mSymbols(markdown), ["AAA", "BBB", "WTOU"]);
  const rendered = formatUnder500Markdown(buildUnder500Universe(buildNasdaqUniverseSnapshot(ROWS, "2026-05-07T00:00:00.000Z")));
  assert.match(rendered, /NASDAQ Under \$500M Market Cap Universe/);
  assert.match(rendered, /WTO/);
});

test("writes universe artifacts and dry-run backfill plan", async () => {
  const root = mkdtempSync(join(tmpdir(), "nasdaq-universe-"));
  const checklistPath = join(root, "checklist.md");
  writeFileSync(checklistPath, "# All bucketed NASDAQ under $100M tickers, deduped\n\nAAA, WTOU\n\n---\n", "utf8");
  const snapshot = buildNasdaqUniverseSnapshot(ROWS, "2026-05-07T00:00:00.000Z");
  const result = await writeNasdaqUniverseArtifacts({
    snapshot,
    rawRows: ROWS,
    checklistPath,
    masterJsonPath: join(root, "data", "nasdaq-current-universe.json"),
    artifactsRoot: join(root, "artifacts"),
    docUnder500MarkdownPath: join(root, "docs", "nasdaq-under-500m-marketcap-universe.md"),
  });
  assert.ok(existsSync(result.masterJsonPath));
  assert.ok(existsSync(result.under500JsonPath));
  assert.ok(existsSync(result.docUnder500MarkdownPath));
  assert.match(readFileSync(result.diffMarkdownPath, "utf8"), /possible_alias_candidate/);

  const plan = buildNasdaqUnder500BackfillPlan({
    snapshot,
    sourceUniversePath: result.masterJsonPath,
    warehouseDirectoryPath: join(root, "data", "candles"),
  });
  assert.equal(plan.dryRun, true);
  assert.deepEqual(plan.timeframes, ["daily", "4h", "5m"]);
  assert.equal(plan.stages.length, 5);
  assert.ok(plan.stages.every((stage) => !stage.symbols.includes("FFF")));
  const planResult = await writeNasdaqBackfillPlan({ plan, outDir: join(root, "plan") });
  assert.ok(existsSync(planResult.jsonPath));
  assert.match(readFileSync(planResult.markdownPath, "utf8"), /dry-run planning artifact/);
});

test("under-500M candle backfill plan classifies missing and partial coverage without provider access", async () => {
  const root = mkdtempSync(join(tmpdir(), "nasdaq-under500-backfill-"));
  const warehouseRoot = join(root, "data", "candles");
  const dailyDir = join(warehouseRoot, "ibkr", "AAA", "daily");
  mkdirSync(dailyDir, { recursive: true });
  const now = Date.parse("2026-05-07T16:00:00.000Z");
  const rows = Array.from({ length: 130 }, (_, index) => {
    const timestamp = now - (129 - index) * 24 * 60 * 60 * 1000;
    return JSON.stringify({
      timestamp,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1000,
    });
  });
  writeFileSync(join(dailyDir, "2026-05-07.jsonl"), `${rows.join("\n")}\n`, "utf8");

  const snapshot = buildNasdaqUniverseSnapshot(ROWS, "2026-05-07T00:00:00.000Z");
  const plan = buildNasdaqUnder500CandleBackfillPlan({
    snapshot,
    sourceUniversePath: "universe.json",
    warehouseDirectoryPath: warehouseRoot,
    timeframes: ["daily"],
    knownContractUnresolvedSymbols: ["BBB"],
    now,
  });
  const bySymbol = new Map(plan.tasks.map((task) => [task.symbol, task]));
  assert.equal(bySymbol.get("AAA")?.status, "covered");
  assert.equal(bySymbol.get("WTO")?.status, "missing");
  assert.equal(bySymbol.get("BBB")?.status, "contract_unresolved");
  assert.ok(!plan.selectedTasks.some((task) => task.symbol === "BBB"));
  assert.match(formatNasdaqUnder500CandleBackfillPlan(plan), /duplicate-safe by design/);
});

test("over-500M candle backfill plan selects all remaining fetchable symbols by default", async () => {
  const root = mkdtempSync(join(tmpdir(), "nasdaq-over500-backfill-"));
  const warehouseRoot = join(root, "data", "candles");
  const dailyDir = join(warehouseRoot, "ibkr", "FFF", "daily");
  mkdirSync(dailyDir, { recursive: true });
  const now = Date.parse("2026-05-07T16:00:00.000Z");
  const rows = Array.from({ length: 130 }, (_, index) => {
    const timestamp = now - (129 - index) * 24 * 60 * 60 * 1000;
    return JSON.stringify({
      timestamp,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1000,
    });
  });
  writeFileSync(join(dailyDir, "2026-05-07.jsonl"), `${rows.join("\n")}\n`, "utf8");

  const snapshot = buildNasdaqUniverseSnapshot(ROWS, "2026-05-07T00:00:00.000Z");
  const over500 = buildOver500Universe(snapshot);
  assert.deepEqual(over500.map((row) => row.symbol), ["FFF"]);

  const plan = buildNasdaqOver500CandleBackfillPlan({
    snapshot,
    sourceUniversePath: "universe.json",
    warehouseDirectoryPath: warehouseRoot,
    timeframes: ["daily", "4h", "5m"],
    now,
  });
  assert.equal(plan.totals.symbols, 1);
  assert.equal(plan.totals.partial, 1);
  assert.equal(plan.totals.selectedForFetch, 1);
  assert.deepEqual(plan.selectedTasks[0]?.fetchTimeframes, ["4h", "5m"]);
  assert.match(formatNasdaqOver500CandleBackfillPlan(plan), /market cap of \$500M or above/);

  const capped = buildNasdaqOver500CandleBackfillPlan({
    snapshot,
    sourceUniversePath: "universe.json",
    warehouseDirectoryPath: warehouseRoot,
    timeframes: ["daily", "4h", "5m"],
    maxSymbols: 0,
    now,
  });
  assert.equal(capped.totals.selectedForFetch, 0);
});

test("builds NYSE market-cap universe across all clean buckets", () => {
  const snapshot = buildNyseUniverseSnapshot(ROWS, "2026-05-09T12:00:00.000Z");
  const universe = buildNyseMarketCapUniverse(snapshot);

  assert.equal(snapshot.source, "https://api.nasdaq.com/api/screener/stocks?exchange=nyse&download=true");
  assert.equal(universe.bucketCounts.under_100m, 2);
  assert.equal(universe.bucketCounts["100m_to_200m"], 1);
  assert.equal(universe.bucketCounts["200m_to_300m"], 1);
  assert.equal(universe.bucketCounts["300m_to_400m"], 1);
  assert.equal(universe.bucketCounts["400m_to_500m"], 1);
  assert.equal(universe.bucketCounts["500m_plus"], 1);
  assert.ok(!Object.values(universe.buckets).flat().some((row) => row.symbol === "BADW"));
  assert.match(formatNyseMarketCapMarkdown(universe), /NYSE Market Cap Universe/);
});
