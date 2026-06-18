import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildStartupCacheReadinessReport,
  writeStartupCacheReadinessReport,
} from "../lib/review/startup-cache-readiness-report.js";
import type { Candle, CandleFetchTimeframe } from "../lib/support-resistance/index.js";

const NOW = Date.parse("2026-05-01T15:00:00.000Z");

function candle(timestamp: number, close = 1): Candle {
  return {
    timestamp,
    open: close,
    high: close + 0.01,
    low: close - 0.01,
    close,
    volume: 100_000,
  };
}

function candles(count: number, end: number, intervalMs: number): Candle[] {
  return Array.from({ length: count }, (_, index) =>
    candle(end - (count - index - 1) * intervalMs, 1 + index * 0.001),
  );
}

function writeCache(root: string, symbol: string, timeframe: CandleFetchTimeframe, rows: Candle[]): void {
  const directory = join(root, "ibkr", symbol, timeframe);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "cache.json"), JSON.stringify({ response: { candles: rows } }), "utf8");
}

function writeState(root: string): string {
  const path = join(root, "manual-watchlist-state.json");
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      lastUpdated: NOW,
      entries: [
        {
          symbol: "FAST",
          active: true,
          priority: 1,
          tags: ["manual"],
          lifecycle: "active",
          discordThreadId: "thread-fast",
        },
        {
          symbol: "MISS",
          active: true,
          priority: 2,
          tags: ["manual"],
          lifecycle: "active",
          discordThreadId: "thread-miss",
        },
        {
          symbol: "OLD",
          active: false,
          priority: 3,
          tags: ["manual"],
          lifecycle: "inactive",
          discordThreadId: null,
        },
      ],
    }),
    "utf8",
  );
  return path;
}

test("startup cache readiness report identifies fast-restore and blocked symbols", () => {
  const root = mkdtempSync(join(tmpdir(), "startup-cache-readiness-"));
  try {
    const statePath = writeState(root);
    const cacheRoot = join(root, "cache");
    writeCache(cacheRoot, "FAST", "daily", candles(3, NOW, 24 * 60 * 60_000));
    writeCache(cacheRoot, "FAST", "4h", candles(3, NOW, 4 * 60 * 60_000));
    writeCache(cacheRoot, "FAST", "5m", candles(3, NOW, 5 * 60_000));

    const report = buildStartupCacheReadinessReport({
      watchlistStatePath: statePath,
      cacheDirectoryPath: cacheRoot,
      now: NOW,
      requiredCandles: { daily: 3, "4h": 3, "5m": 3 },
    });

    assert.equal(report.totals.symbols, 2);
    assert.equal(report.totals.readyForFastRestore, 1);
    assert.equal(report.totals.blocked, 1);
    const fast = report.symbols.find((symbol) => symbol.symbol === "FAST");
    assert.equal(fast?.canRestoreLevelsFromCache, true);
    assert.equal(fast?.discordSnapshotPolicy, "wait_for_fresh_refresh");
    assert.equal(fast?.freshRefreshRequiredBeforeDiscordSnapshot, true);
    const miss = report.symbols.find((symbol) => symbol.symbol === "MISS");
    assert.equal(miss?.status, "blocked");
    assert.equal(miss?.discordSnapshotPolicy, "do_not_post_from_cache");
    assert.equal(miss?.freshRefreshRequiredBeforeDiscordSnapshot, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup cache readiness writer creates operator artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "startup-cache-readiness-write-"));
  try {
    const statePath = writeState(root);
    const report = writeStartupCacheReadinessReport({
      watchlistStatePath: statePath,
      cacheDirectoryPath: join(root, "cache"),
      now: NOW,
      jsonPath: join(root, "out", "readiness.json"),
      markdownPath: join(root, "out", "readiness.md"),
    });

    assert.equal(report.totals.blocked, 2);
    assert.ok(existsSync(join(root, "out", "readiness.json")));
    assert.match(readFileSync(join(root, "out", "readiness.md"), "utf8"), /Operator-only report/);
    assert.match(readFileSync(join(root, "out", "readiness.md"), "utf8"), /fresh refresh required before Discord snapshot: true/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
