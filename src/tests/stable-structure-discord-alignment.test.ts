import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildStableStructureDiscordAlignmentReport,
  formatStableStructureDiscordAlignmentMarkdown,
} from "../lib/review/stable-structure-discord-alignment.js";
import type { Candle } from "../lib/support-resistance/index.js";

const START = Date.UTC(2026, 4, 1, 13, 30, 0);
const FIVE_MINUTES = 5 * 60 * 1000;

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    return {
      timestamp: START + index * FIVE_MINUTES,
      open,
      high: Math.max(open, close) + 0.01,
      low: Math.max(0.01, Math.min(open, close) - 0.01),
      close,
      volume: 100_000 + index * 1_000,
    };
  });
}

function writeCacheFile(params: {
  root: string;
  symbol: string;
  candles: Candle[];
}): void {
  const endTimeMs = params.candles.at(-1)!.timestamp;
  const directory = join(params.root, params.symbol, "5m");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${params.candles.length}-${endTimeMs}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      request: {
        symbol: params.symbol,
        timeframe: "5m",
        lookbackBars: params.candles.length,
        endTimeMs,
        provider: "ibkr",
      },
      response: {
        candles: params.candles,
      },
    })}\n`,
  );
}

function writeAuditFile(params: {
  root: string;
  rows: unknown[];
}): string {
  const directory = join(params.root, "long-run", "2026-05-01_09-30-00");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, `${params.rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return path;
}

test("stable structure Discord alignment flags repeated posts when stable structure is unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "stable-structure-align-"));
  try {
    const auditRoot = join(root, "artifacts");
    const cacheRoot = join(root, "cache");
    writeCacheFile({
      root: cacheRoot,
      symbol: "TEST",
      candles: candlesFromCloses([
        1.00, 1.04, 1.01, 1.05, 1.00,
        1.04, 1.01, 1.05, 1.00, 1.04,
        1.01, 1.05, 1.00, 1.04, 1.01,
        1.05, 1.02, 1.04, 1.01, 1.03,
      ]),
    });
    writeAuditFile({
      root: auditRoot,
      rows: [
        {
          type: "discord_delivery_audit",
          operation: "post_alert",
          status: "posted",
          timestamp: START + 16 * FIVE_MINUTES,
          symbol: "TEST",
          title: "TEST level touch",
          body: "price testing resistance",
          messageKind: "alert",
        },
        {
          type: "discord_delivery_audit",
          operation: "post_alert",
          status: "posted",
          timestamp: START + 16 * FIVE_MINUTES + 60_000,
          symbol: "TEST",
          title: "TEST level touch",
          body: "price testing resistance again",
          messageKind: "alert",
        },
      ],
    });

    const report = buildStableStructureDiscordAlignmentReport({
      auditRoot,
      cacheDirectory: cacheRoot,
      auditLimit: null,
    });

    assert.equal(report.summary.postedRows, 2);
    assert.equal(report.summary.alignedRows, 2);
    assert.equal(report.summary.sameStructureRepeats, 1);
    assert.equal(report.perSymbol[0]?.symbol, "TEST");
    assert.equal(report.perSymbol[0]?.sameStructureRepeats, 1);
    assert.equal(report.posts[1]?.classification, "same_structure_repeat");

    const markdown = formatStableStructureDiscordAlignmentMarkdown(report);
    assert.match(markdown, /Stable Structure \/ Discord Alignment Audit/);
    assert.match(markdown, /same-structure repeats: 1/);
    assert.match(markdown, /TEST level touch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stable structure Discord alignment reports cache coverage gaps", () => {
  const root = mkdtempSync(join(tmpdir(), "stable-structure-align-"));
  try {
    const auditRoot = join(root, "artifacts");
    const cacheRoot = join(root, "cache");
    writeAuditFile({
      root: auditRoot,
      rows: [
        {
          type: "discord_delivery_audit",
          operation: "post_alert",
          status: "posted",
          timestamp: START + 60_000,
          symbol: "MISS",
          title: "MISS breakout",
          body: "price pushed above resistance",
        },
      ],
    });

    const report = buildStableStructureDiscordAlignmentReport({
      auditRoot,
      cacheDirectory: cacheRoot,
      auditLimit: null,
    });

    assert.equal(report.summary.postedRows, 1);
    assert.equal(report.summary.cacheUnavailableRows, 1);
    assert.equal(report.posts[0]?.classification, "cache_unavailable");
    assert.ok(report.findings.some((finding) => finding.reason === "cache_coverage_gap"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
