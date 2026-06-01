import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatFifteenMinuteCacheCoverageSummary,
  inspectFifteenMinuteCacheCoverage,
  parseInspectFifteenMinuteCacheCoverageArgs,
} from "../scripts/inspect-15m-cache-coverage.js";

function writeCacheFile(
  cacheRoot: string,
  provider: string,
  symbol: string,
  timeframe: "5m" | "15m" | "4h" | "daily",
  filename = "100-1777645200000.json",
): void {
  const directory = join(cacheRoot, provider, symbol, timeframe);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, filename),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        cachedAt: 1777645200000,
        request: {
          symbol,
          timeframe,
          lookbackBars: 100,
          endTimeMs: 1777645200000,
          provider,
        },
        response: {
          provider,
          symbol,
          timeframe,
          requestedLookbackBars: 100,
          candles: [],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

test("15m cache coverage inspection detects missing and complete 15m groups", () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "15m-cache-coverage-"));

  for (const timeframe of ["5m", "4h", "daily"] as const) {
    writeCacheFile(cacheRoot, "ibkr", "DEVS", timeframe);
  }
  for (const timeframe of ["5m", "15m", "4h", "daily"] as const) {
    writeCacheFile(cacheRoot, "ibkr", "QUBT", timeframe);
  }

  const summary = inspectFifteenMinuteCacheCoverage({
    cacheRoot,
    generatedAt: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(summary.generatedAt, "2026-06-01T00:00:00.000Z");
  assert.deepEqual(summary.providers, ["ibkr"]);
  assert.equal(summary.providerSymbolGroups, 2);
  assert.equal(summary.groupsWith5m4hDaily, 2);
  assert.equal(summary.groupsWithAny15m, 1);
  assert.equal(summary.groupsWith5m15m4hDaily, 1);
  assert.equal(summary.groupsMissing15mAmong5m4hDaily, 1);
  assert.deepEqual(summary.symbolsWith15m, ["ibkr/QUBT"]);
  assert.deepEqual(summary.symbolsMissing15mAmong5m4hDaily, ["ibkr/DEVS"]);
  assert.equal(summary.timeframeJsonFileCounts["15m"], 1);
  assert.equal(summary.validationCacheEntries, 7);
  assert.deepEqual(summary.diagnostics, []);
});

test("15m cache coverage inspection handles malformed and non-json files gracefully", () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "15m-cache-coverage-"));
  writeCacheFile(cacheRoot, "stub", "ENVX", "5m");
  writeCacheFile(cacheRoot, "stub", "ENVX", "4h");
  writeCacheFile(cacheRoot, "stub", "ENVX", "daily");

  const malformedDirectory = join(cacheRoot, "stub", "ENVX", "15m");
  mkdirSync(malformedDirectory, { recursive: true });
  writeFileSync(join(malformedDirectory, "100-1777645200000.json"), "{ nope", "utf8");
  writeFileSync(join(malformedDirectory, "notes.txt"), "ignore me", "utf8");

  const summary = inspectFifteenMinuteCacheCoverage({
    cacheRoot,
    generatedAt: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(summary.totalJsonFiles, 4);
  assert.equal(summary.malformedJsonFiles, 1);
  assert.equal(summary.nonJsonFiles, 1);
  assert.equal(summary.groupsWithAny15m, 1);
  assert.ok(summary.diagnostics.includes("malformed_json_files_present"));
  assert.ok(summary.diagnostics.includes("non_json_files_ignored"));
});

test("15m cache coverage inspection reports missing cache roots without provider calls", () => {
  const cacheRoot = join(tmpdir(), `missing-15m-cache-${Date.now()}`);
  const summary = inspectFifteenMinuteCacheCoverage({
    cacheRoot,
    generatedAt: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(summary.cacheRootExists, false);
  assert.equal(summary.providerSymbolGroups, 0);
  assert.equal(summary.totalJsonFiles, 0);
  assert.deepEqual(summary.diagnostics, ["cache_root_missing", "no_15m_cache_found"]);
});

test("15m cache coverage CLI parser and formatter are deterministic", () => {
  const parsed = parseInspectFifteenMinuteCacheCoverageArgs([
    "--cache-root",
    "cache",
    "--generated-at",
    "2026-06-01T00:00:00.000Z",
    "--out-json",
    "coverage.json",
    "--out-text",
    "coverage.txt",
  ]);

  assert.deepEqual(parsed, {
    cacheRoot: "cache",
    generatedAt: "2026-06-01T00:00:00.000Z",
    outJson: "coverage.json",
    outText: "coverage.txt",
  });

  const text = formatFifteenMinuteCacheCoverageSummary({
    generatedAt: "2026-06-01T00:00:00.000Z",
    cacheRoot: "cache",
    cacheRootExists: true,
    providers: ["ibkr"],
    providerSymbolGroups: 1,
    totalJsonFiles: 4,
    malformedJsonFiles: 0,
    validationCacheEntries: 4,
    nonJsonFiles: 0,
    groupsWith5m4hDaily: 1,
    groupsWithAny15m: 1,
    groupsWith5m15m4hDaily: 1,
    groupsMissing15mAmong5m4hDaily: 0,
    timeframeJsonFileCounts: {
      "5m": 1,
      "15m": 1,
      "4h": 1,
      daily: 1,
    },
    symbolsWith15m: ["ibkr/QUBT"],
    symbolsMissing15mAmong5m4hDaily: [],
    diagnostics: [],
    groups: [],
  });

  assert.equal(
    text,
    [
      "15m validation cache coverage",
      "Generated at: 2026-06-01T00:00:00.000Z",
      "Cache root: cache",
      "Cache root exists: true",
      "Providers: ibkr",
      "Provider/symbol groups: 1",
      "Total cache JSON files: 4",
      "Malformed JSON files: 0",
      "Validation cache entries: 4",
      "Non-JSON files ignored: 0",
      "5m JSON files: 1",
      "15m JSON files: 1",
      "4h JSON files: 1",
      "Daily JSON files: 1",
      "Groups with 5m/4h/daily: 1",
      "Groups with any 15m: 1",
      "Groups with 5m/15m/4h/daily: 1",
      "Groups missing 15m among 5m/4h/daily: 0",
      "Diagnostics: none",
      "Symbols with 15m: ibkr/QUBT",
      "",
    ].join("\n"),
  );
});
