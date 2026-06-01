import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");

function quoteWindowsArg(value: string): string {
  assert.equal(value.includes("\""), false, "smoke runner args must not contain quotes");
  return /\s/.test(value) ? `"${value}"` : value;
}

function runPackagedRunner(args: string[]): void {
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", ["npm", ...args].map(quoteWindowsArg).join(" ")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 90_000,
    });
    return;
  }

  execFileSync("npm", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 90_000,
  });
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-analysis-snapshot-smoke-"));

  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, out);
    }
    return out;
  }

  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectStringValues(item, out);
    }
  }

  return out;
}

function assertNoProhibitedDownstreamLanguage(value: unknown): void {
  const text = collectStringValues(value).join("\n").toLowerCase();

  for (const [label, pattern] of [
    ["recommendation", /\brecommendation\b/],
    ["coaching", /\bcoaching\b/],
    ["coach", /\bcoach\b/],
    ["grading", /\bgrading\b/],
    ["grade", /\bgrade\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/],
    ["entry decision", /\bentry decision\b/],
    ["exit decision", /\bexit decision\b/],
    ["trade advice", /\btrade advice\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} language in smoke output.`);
  }
}

function readPackageScripts(): Record<string, string> {
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  return packageJson.scripts ?? {};
}

test("packaged LevelAnalysisSnapshot runner writes and validates a production-shaped smoke artifact", () =>
  withTempDir((dir) => {
    const symbol = "SNAP";
    const outRoot = join(dir, "level-analysis-snapshot-smoke");
    const outPath = join(outRoot, symbol, String(AS_OF), "level-analysis-snapshot-v1.json");

    runPackagedRunner([
        "run",
        "snapshot:level-analysis",
        "--",
        "--symbol",
        symbol,
        "--as-of",
        "2026-05-01T10:20:00-04:00",
        "--reference-price",
        "10.68",
        "--candles-5m",
        "docs/examples/level-analysis-snapshot/sample-5m-candles.json",
        "--candles-15m",
        "docs/examples/level-analysis-snapshot/sample-15m-candles.json",
        "--candles-4h",
        "docs/examples/level-analysis-snapshot/sample-4h-candles.json",
        "--candles-daily",
        "docs/examples/level-analysis-snapshot/sample-daily-candles.json",
        "--previous-close",
        "9.1",
        "--out",
        outPath,
      ]);

    assert.equal(existsSync(outPath), true);

    const snapshot = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, any>;

    assert.equal(String(snapshot.schemaVersion).startsWith("level-analysis-snapshot/v1"), true);
    assert.equal(snapshot.producer, "levels-system");
    assert.equal(snapshot.symbol, symbol);
    assert.equal(snapshot.asOfTimestamp, AS_OF);
    assert.equal(snapshot.referencePrice, 10.68);
    assert.ok(snapshot.inputSummary);
    assert.equal(snapshot.inputSummary.candleCounts["15m"], 3);
    assert.equal(snapshot.inputSummary.filteredCandleCounts["15m"], 3);
    assert.ok(snapshot.diagnostics.includes("15m_facts_limited"));
    assert.ok(snapshot.timeframeFacts?.["15m"]);
    assert.equal(snapshot.timeframeFacts["15m"].schemaVersion, "level-analysis-15m-facts/v1");
    assert.ok(snapshot.levelEngineOutput);
    assert.ok(snapshot.levelIntelligenceReport);
    assert.ok(snapshot.levelQualityAudit);
    assert.ok(Array.isArray(snapshot.diagnostics));
    assert.ok(snapshot.safety);
    assert.equal(snapshot.safety.noLookaheadApplied, true);
    assert.equal(snapshot.safety.levelOutputUnchanged, true);
    assert.equal(snapshot.safety.factsOnlyVWAP, true);
    assert.equal(snapshot.safety.shelvesAreFactsOnly, true);
    assert.equal(snapshot.safety.syntheticExtensionsClearlyMarked, true);
    assert.equal(snapshot.safety.noRuntimeBehaviorChange, true);
    assertNoProhibitedDownstreamLanguage(snapshot);

    rmSync(outRoot, { recursive: true, force: true });
    assert.equal(existsSync(outRoot), false);
  }));

test("package exposes a deterministic ignored smoke command", () => {
  const scripts = readPackageScripts();

  assert.equal(
    scripts["snapshot:level-analysis:smoke"],
    "tsx src/scripts/run-level-analysis-snapshot.ts --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-15m docs/examples/level-analysis-snapshot/sample-15m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out artifacts/level-analysis-snapshot-smoke/SNAP/1777645200000/level-analysis-snapshot-v1.json",
  );
});
