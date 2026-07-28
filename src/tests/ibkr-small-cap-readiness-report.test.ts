import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildIbkrSmallCapReadinessReport,
  formatIbkrSmallCapReadinessMarkdown,
  writeIbkrSmallCapReadinessReport,
  type IbkrSmallCapReadinessProbe,
} from "../lib/review/ibkr-small-cap-readiness-report.js";

function probe(overrides: Partial<IbkrSmallCapReadinessProbe>): IbkrSmallCapReadinessProbe {
  return {
    symbol: "BIYA",
    timeframe: "5m",
    status: "completed",
    barsReceived: 192,
    firstBar: ["1781769600", 0.48, 0.5, 0.46, 0.48, 21508],
    lastBar: ["1781826900", 0.412, 0.412, 0.412, 0.412, 0],
    durationMs: 6_200,
    details: { event: "historicalData finished marker" },
    ...overrides,
  };
}

test("IBKR small-cap readiness report classifies ready, thin, and unavailable symbols", () => {
  const report = buildIbkrSmallCapReadinessReport({
    timeframe: "5m",
    requestedLookbackBars: 50,
    minimumReadyBars: 50,
    timeoutMs: 60_000,
    generatedAt: "2026-06-19T21:00:00.000Z",
    probes: [
      probe({ symbol: "BIYA", barsReceived: 192 }),
      probe({ symbol: "THIN", barsReceived: 12 }),
      probe({ symbol: "SEGG", status: "timeout", barsReceived: 0, firstBar: null, lastBar: null }),
      probe({ symbol: "ERRR", status: "error", barsReceived: 0, firstBar: null, lastBar: null }),
    ],
  });

  assert.equal(report.totals.symbols, 4);
  assert.equal(report.totals.ready, 1);
  assert.equal(report.totals.thinHistory, 1);
  assert.equal(report.totals.providerUnavailable, 2);
  assert.equal(report.totals.completed, 2);
  assert.equal(report.totals.timeout, 1);
  assert.equal(report.totals.error, 1);
  assert.equal(report.symbols.find((row) => row.symbol === "BIYA")?.readiness, "ready");
  assert.equal(report.symbols.find((row) => row.symbol === "THIN")?.readiness, "thin_history");
  assert.equal(report.symbols.find((row) => row.symbol === "SEGG")?.readiness, "provider_unavailable");
});

test("IBKR small-cap readiness markdown explains provider unavailability separately from gate logic", () => {
  const report = buildIbkrSmallCapReadinessReport({
    timeframe: "5m",
    requestedLookbackBars: 50,
    timeoutMs: 60_000,
    generatedAt: "2026-06-19T21:00:00.000Z",
    probes: [
      probe({ symbol: "AUUD", barsReceived: 192 }),
      probe({ symbol: "ATER", status: "timeout", barsReceived: 0, firstBar: null, lastBar: null }),
    ],
  });
  const markdown = formatIbkrSmallCapReadinessMarkdown(report);

  assert.match(markdown, /IBKR Small-Cap Readiness Report/);
  assert.match(markdown, /\| AUUD \| ready \| completed \| 192/);
  assert.match(markdown, /\| ATER \| provider_unavailable \| timeout \| 0/);
  assert.match(markdown, /not a market-structure gate failure/i);
});

test("IBKR small-cap readiness writer creates JSON and markdown artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "ibkr-small-cap-readiness-"));
  const report = buildIbkrSmallCapReadinessReport({
    timeframe: "5m",
    requestedLookbackBars: 50,
    timeoutMs: 60_000,
    probes: [probe({ symbol: "BIYA" })],
  });
  const jsonPath = join(directory, "out", "ibkr-small-cap-readiness.json");
  const markdownPath = join(directory, "out", "ibkr-small-cap-readiness.md");

  writeIbkrSmallCapReadinessReport({ report, jsonPath, markdownPath });

  assert.ok(existsSync(jsonPath));
  assert.ok(existsSync(markdownPath));
  assert.match(readFileSync(markdownPath, "utf8"), /BIYA/);
});
