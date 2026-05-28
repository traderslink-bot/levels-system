import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelIntelligenceReviewResult,
  loadLevelEngineOutputJson,
  parseLevelIntelligenceReportRunnerArgs,
  renderFormattedLevelIntelligenceReport,
  runLevelIntelligenceReportRunner,
} from "../lib/levels/level-intelligence-report-runner.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";

const GENERATED_AT = Date.parse("2026-05-01T10:30:00-04:00");

function zone(overrides: Partial<FinalLevelZone> = {}): FinalLevelZone {
  const kind = overrides.kind ?? "resistance";

  return {
    id: "TEST-level-1000",
    symbol: "TEST",
    kind,
    timeframeBias: "5m",
    zoneLow: 9.95,
    zoneHigh: 10.05,
    representativePrice: 10,
    strengthScore: 72,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 1,
    sourceTypes: [kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.6,
    rejectionScore: 0.5,
    displacementScore: 0.4,
    sessionSignificanceScore: 0.3,
    followThroughScore: 0.5,
    sourceEvidenceCount: 1,
    firstTimestamp: Date.parse("2026-05-01T09:30:00-04:00"),
    lastTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...overrides,
  };
}

function levelOutput(): LevelEngineOutput {
  return {
    symbol: "TEST",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: { "5m": "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10.01,
    },
    majorSupport: [
      zone({ id: "major-support", kind: "support", representativePrice: 9.5, zoneLow: 9.45, zoneHigh: 9.55 }),
    ],
    majorResistance: [
      zone({ id: "major-resistance", representativePrice: 10.5, zoneLow: 10.45, zoneHigh: 10.55 }),
    ],
    intermediateSupport: [
      zone({ id: "intermediate-support", kind: "support", representativePrice: 9.25, zoneLow: 9.2, zoneHigh: 9.3 }),
    ],
    intermediateResistance: [
      zone({ id: "intermediate-resistance", representativePrice: 10.75, zoneLow: 10.7, zoneHigh: 10.8 }),
    ],
    intradaySupport: [
      zone({ id: "intraday-support", kind: "support", representativePrice: 9.75, zoneLow: 9.7, zoneHigh: 9.8 }),
    ],
    intradayResistance: [
      zone({ id: "intraday-resistance", representativePrice: 10.25, zoneLow: 10.2, zoneHigh: 10.3 }),
    ],
    extensionLevels: {
      support: [
        zone({ id: "extension-support", kind: "support", representativePrice: 8.75, zoneLow: 8.7, zoneHigh: 8.8, isExtension: true }),
      ],
      resistance: [
        zone({ id: "extension-resistance", representativePrice: 11.25, zoneLow: 11.2, zoneHigh: 11.3, isExtension: true }),
      ],
    },
    specialLevels: {
      premarketHigh: 10.75,
      premarketLow: 9.25,
      openingRangeHigh: 10.25,
      openingRangeLow: 9.75,
    },
  };
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-intelligence-runner-"));

  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(dir: string, output: LevelEngineOutput = levelOutput()): string {
  const filePath = join(dir, "level-output.json");
  writeFileSync(filePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return filePath;
}

function assertNoForbiddenLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();

  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["mistake", /\bmistake\b/],
    ["coaching", /\bcoaching\b/],
    ["entry", /\bentry\b/],
    ["exit", /\bexit\b/],
    ["stop loss", /\bstop loss\b/],
    ["target", /\btarget\b/],
    ["take profit", /\btake profit\b/],
    ["add", /\badd\b/],
    ["trim", /\btrim\b/],
    ["size", /\bsize\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected action language: ${label}`);
  }
}

test("parses required CLI options", () => {
  assert.deepEqual(
    parseLevelIntelligenceReportRunnerArgs([
      "--level-output",
      "fixture.json",
      "--out",
      "review.txt",
      "--format",
      "json",
    ]),
    {
      levelOutputPath: "fixture.json",
      outPath: "review.txt",
      format: "json",
    },
  );
});

test("rejects missing level-output path with clear error", () => {
  assert.throws(
    () => parseLevelIntelligenceReportRunnerArgs(["--format", "text"]),
    /Missing required --level-output <path>\./,
  );
});

test("loads a LevelEngineOutput JSON fixture", () => withTempDir((dir) => {
  const filePath = writeFixture(dir);
  const loaded = loadLevelEngineOutputJson(filePath);

  assert.equal(loaded.symbol, "TEST");
  assert.equal(loaded.majorSupport[0]?.id, "major-support");
  assert.equal(loaded.extensionLevels.resistance[0]?.id, "extension-resistance");
}));

test("builds and formats a text review report from a fixture", () => withTempDir((dir) => {
  const filePath = writeFixture(dir);
  const result = runLevelIntelligenceReportRunner({
    levelOutputPath: filePath,
    format: "text",
  });

  assert.equal(result.report.symbol, "TEST");
  assert.equal(result.report.counts.total, 8);
  assert.ok(result.content.includes("TEST facts-only level intelligence: 8 profiled level(s)."));
  assert.ok(result.content.includes("## Major Support"));
  assert.ok(result.content.includes("## Extension Resistance"));
  assert.ok(result.content.includes("## Safety"));
  assertNoForbiddenLanguage(result.content);
}));

test("writes JSON output when requested", () => withTempDir((dir) => {
  const filePath = writeFixture(dir);
  const outPath = join(dir, "nested", "review.json");
  const result = runLevelIntelligenceReportRunner({
    levelOutputPath: filePath,
    outPath,
    format: "json",
  });

  assert.equal(existsSync(outPath), true);
  assert.equal(readFileSync(outPath, "utf8"), result.content);

  const parsed = JSON.parse(result.content) as {
    report: { symbol: string; counts: { total: number } };
    formatted: { summary: string };
  };
  assert.equal(parsed.report.symbol, "TEST");
  assert.equal(parsed.report.counts.total, 8);
  assert.equal(parsed.formatted.summary, "TEST facts-only level intelligence: 8 profiled level(s).");
  assertNoForbiddenLanguage(parsed);
}));

test("review output is deterministic", () => {
  const output = levelOutput();
  const first = buildLevelIntelligenceReviewResult(output, "text");
  const second = buildLevelIntelligenceReviewResult(output, "text");

  assert.deepEqual(first, second);
  assert.equal(first.content, renderFormattedLevelIntelligenceReport(first.formatted));
});

test("source does not import LevelEngine Discord alerts monitoring or trader context", () => {
  const helperPath = fileURLToPath(new URL("../lib/levels/level-intelligence-report-runner.ts", import.meta.url));
  const scriptPath = fileURLToPath(new URL("../scripts/run-level-intelligence-report.ts", import.meta.url));
  const source = `${readFileSync(helperPath, "utf8")}\n${readFileSync(scriptPath, "utf8")}`;

  assert.equal(source.includes("level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(source.includes("buildLevelExtensions"), false);
  assert.equal(source.includes("rankLevels("), false);
  assert.equal(source.includes("../alerts"), false);
  assert.equal(source.includes("../monitoring"), false);
  assert.equal(source.includes("../trader-context"), false);
  assert.equal(source.toLowerCase().includes("discord"), false);
});

test("old/default runtime mode remains unchanged", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
