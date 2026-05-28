import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { formatLevelIntelligenceDiscordPreview } from "../lib/alerts/level-intelligence-discord-preview.js";
import {
  buildLevelIntelligenceDiscordPreviewReviewResult,
  loadLevelIntelligenceDiscordPreviewFactsInput,
  parseLevelIntelligenceDiscordPreviewRunnerArgs,
  runLevelIntelligenceDiscordPreviewRunner,
  type LevelIntelligenceDiscordPreviewSendRequest,
  type LevelIntelligenceDiscordPreviewSender,
} from "../lib/alerts/level-intelligence-discord-preview-runner.js";
import { buildLevelIntelligenceReviewResult } from "../lib/levels/level-intelligence-report-runner.js";
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
    notes: ["Volume shelf near this zone is market context only."],
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function withTempDir<T>(callback: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "level-intelligence-discord-preview-runner-"));

  try {
    return await callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(dir: string, output: LevelEngineOutput = levelOutput()): string {
  const filePath = join(dir, "level-output.json");
  writeFileSync(filePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return filePath;
}

function writeJsonFixture(dir: string, fileName: string, value: unknown): string {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function sessionFacts() {
  return {
    symbol: "TEST",
    asOfTimestamp: GENERATED_AT,
    sessionDate: "2026-05-01",
    previousClose: 9.1,
    regularSessionOpen: 9.4,
    currentPrice: 10.01,
    premarketHigh: 10.5,
    premarketLow: 9.5,
    premarketHighTimestamp: Date.parse("2026-05-01T08:45:00-04:00"),
    premarketLowTimestamp: Date.parse("2026-05-01T08:05:00-04:00"),
    openingRangeHigh: 10.25,
    openingRangeLow: 9.75,
    openingRangeStartTimestamp: Date.parse("2026-05-01T09:30:00-04:00"),
    openingRangeEndTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    highOfDay: 10.5,
    lowOfDay: 9.5,
    highOfDayTimestamp: Date.parse("2026-05-01T10:15:00-04:00"),
    lowOfDayTimestamp: Date.parse("2026-05-01T09:40:00-04:00"),
    vwap: 9.5,
    aboveVWAP: true,
    percentFromVWAP: 5.3684,
    diagnostics: [],
  };
}

function volumeFacts() {
  return {
    symbol: "TEST",
    asOfTimestamp: GENERATED_AT,
    currentVolume: 1_200_000,
    rollingAverageVolume: 375_000,
    relativeVolume: 3.2,
    dollarVolume: 8_750_000,
    volumeState: "high",
    liquidityQuality: "strong",
    accelerationState: "surging",
    pullbackVolumeState: "drying_up",
    breakoutVolumeState: "strong",
    diagnostics: [],
  };
}

function volumeShelves() {
  return [
    {
      id: "TEST-shelf-1045-1055",
      zoneLow: 10.45,
      zoneHigh: 10.55,
      representativePrice: 10.5,
      totalVolume: 2_500_000,
      dollarVolume: 26_250_000,
      percentOfWindowVolume: 32.5,
      touchCount: 5,
      firstTimestamp: Date.parse("2026-05-01T09:35:00-04:00"),
      lastTimestamp: Date.parse("2026-05-01T10:20:00-04:00"),
      shelfRole: "resistance",
      confidence: 0.82,
      reason: "High activity shelf near the supplied level.",
    },
  ];
}

function marketContext() {
  return {
    primaryContext: "day_trade_runner",
    confidence: 0.78,
    runnerPhase: "high_of_day_breakout",
    evidence: [
      {
        code: "near_high_of_day",
        context: "day_trade_runner",
        message: "Price is near high of day.",
        weight: 0.9,
      },
    ],
    warnings: [],
    facts: {
      percentFromPreviousClose: 14.2,
      percentFromOpen: 6.4,
      percentFromVWAP: 5.3684,
      relativeVolume: 3.2,
      dollarVolume: 8_750_000,
      aboveVWAP: true,
      abovePremarketHigh: false,
      aboveOpeningRangeHigh: false,
      nearHighOfDay: true,
      premarketHigh: 10.5,
      openingRangeHigh: 10.25,
      highOfDay: 10.5,
      filteredCandleCount: 12,
      filteredPremarketCandleCount: 5,
      filteredRegularSessionCandleCount: 7,
    },
    scoringAdjustments: {
      intradayWeightMultiplier: 1.2,
      dailyWeightMultiplier: 0.9,
      sessionLevelWeightMultiplier: 1.15,
      volumeWeightMultiplier: 1.3,
      extensionRiskPenaltyMultiplier: 1.15,
    },
  };
}

function factsBundle() {
  return {
    symbol: "TEST",
    asOfTimestamp: GENERATED_AT,
    referencePrice: 10.01,
    sessionFacts: sessionFacts(),
    volumeFacts: volumeFacts(),
    volumeShelves: volumeShelves(),
    diagnostics: {
      futureCandlesExcluded: 0,
      partialCandlesExcluded: 0,
      sessionDiagnostics: [],
      volumeDiagnostics: [],
    },
    levelOutputUnchanged: true,
    shelvesAreFactsOnly: true,
    vwapFactsOnly: true,
  };
}

function assertNoForbiddenLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();

  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["enter", /\benter\b/],
    ["exit", /\bexit\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["mistake", /\bmistake\b/],
    ["should", /\bshould\b/],
    ["coaching", /\bcoaching\b/],
    ["P/L", /\bp\/l\b/],
    ["giveback", /\bgiveback\b/],
    ["grading", /\bgrading\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected action language: ${label}`);
  }
}

test("parses dry-run and send-test CLI options", () => {
  assert.deepEqual(
    parseLevelIntelligenceDiscordPreviewRunnerArgs([
      "--level-output",
      "fixture.json",
      "--out",
      "preview.txt",
      "--format",
      "json",
      "--dry-run",
      "--max-message-length",
      "900",
    ]),
    {
      levelOutputPath: "fixture.json",
      outPath: "preview.txt",
      format: "json",
      mode: "dry-run",
      testWebhookUrl: undefined,
      maxMessageLength: 900,
      sessionFactsPath: undefined,
      volumeFactsPath: undefined,
      volumeShelvesPath: undefined,
      marketContextPath: undefined,
      factsBundlePath: undefined,
    },
  );

  assert.deepEqual(
    parseLevelIntelligenceDiscordPreviewRunnerArgs(["--level-output", "fixture.json", "--send-test"], {
      LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL: "https://example.test/webhook",
    }),
    {
      levelOutputPath: "fixture.json",
      outPath: undefined,
      format: "text",
      mode: "send-test",
      testWebhookUrl: "https://example.test/webhook",
      maxMessageLength: undefined,
      sessionFactsPath: undefined,
      volumeFactsPath: undefined,
      volumeShelvesPath: undefined,
      marketContextPath: undefined,
      factsBundlePath: undefined,
    },
  );
});

test("parses optional facts input paths", () => {
  assert.deepEqual(
    parseLevelIntelligenceDiscordPreviewRunnerArgs([
      "--level-output",
      "fixture.json",
      "--session-facts",
      "session.json",
      "--volume-facts",
      "volume.json",
      "--volume-shelves",
      "shelves.json",
      "--market-context",
      "context.json",
      "--facts-bundle",
      "bundle.json",
    ]),
    {
      levelOutputPath: "fixture.json",
      sessionFactsPath: "session.json",
      volumeFactsPath: "volume.json",
      volumeShelvesPath: "shelves.json",
      marketContextPath: "context.json",
      factsBundlePath: "bundle.json",
      outPath: undefined,
      format: "text",
      mode: "dry-run",
      testWebhookUrl: undefined,
      maxMessageLength: undefined,
    },
  );
});

test("dry-run returns preview messages without sending", async () => withTempDir(async (dir) => {
  const filePath = writeFixture(dir);
  const sender: LevelIntelligenceDiscordPreviewSender = async () => {
    throw new Error("sender must not be called in dry-run mode");
  };
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath: filePath,
    format: "text",
    mode: "dry-run",
  }, undefined, sender);

  assert.equal(result.mode, "dry-run");
  assert.equal(result.sendResults.length, 0);
  assert.ok(result.preview.messages.length > 0);
  assert.ok(result.content.includes("TEST level intelligence Discord preview (dry-run)"));
  assert.ok(result.content.includes("No test webhook deliveries."));
  assertNoForbiddenLanguage(result.content);
}));

test("dry-run accepts session facts JSON and includes session context in preview", async () => withTempDir(async (dir) => {
  const levelOutputPath = writeFixture(dir);
  const sessionFactsPath = writeJsonFixture(dir, "session-facts.json", sessionFacts());
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath,
    sessionFactsPath,
    format: "text",
    mode: "dry-run",
  });

  assert.ok(result.content.includes("Session facts: Level is near high of day 10.5"));
  assert.ok(result.content.includes("Session facts: Level is near low of day 9.5"));
  assert.ok(result.content.includes("Level is near VWAP fact 9.5"));
  assert.ok(result.content.includes("VWAP facts-only: true"));
  assert.equal(result.sendResults.length, 0);
  assertNoForbiddenLanguage(result.content);
}));

test("dry-run accepts volume facts JSON and includes volume context in preview", async () => withTempDir(async (dir) => {
  const levelOutputPath = writeFixture(dir);
  const volumeFactsPath = writeJsonFixture(dir, "volume-facts.json", volumeFacts());
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath,
    volumeFactsPath,
    format: "text",
    mode: "dry-run",
  });

  assert.ok(result.content.includes("Volume facts: state high; relative 3.2; dollar 8750000; liquidity strong; acceleration surging"));
  assert.ok(result.content.includes("Volume facts nearby: Volume state is high."));
  assert.ok(result.content.includes("Relative volume fact is 3.2."));
  assert.equal(result.sendResults.length, 0);
  assertNoForbiddenLanguage(result.content);
}));

test("dry-run accepts volume shelves JSON and keeps shelf facts separate from levels", async () => withTempDir(async (dir) => {
  const levelOutputPath = writeFixture(dir);
  const volumeShelvesPath = writeJsonFixture(dir, "volume-shelves.json", volumeShelves());
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath,
    volumeShelvesPath,
    format: "text",
    mode: "dry-run",
  });

  assert.ok(result.content.includes("Shelf facts: Level overlaps volume shelf TEST-shelf-1045-1055"));
  assert.ok(result.content.includes("Volume shelves facts-only: true"));
  assert.ok(result.content.includes("Volume shelves remain facts-only."));
  assert.equal(result.reportSymbol, "TEST");
  assert.equal(result.sendResults.length, 0);
  assertNoForbiddenLanguage(result.content);
}));

test("dry-run accepts detector-result shaped volume shelves JSON", async () => withTempDir(async (dir) => {
  const levelOutputPath = writeFixture(dir);
  const volumeShelvesPath = writeJsonFixture(dir, "volume-shelves-result.json", {
    symbol: "TEST",
    shelves: volumeShelves(),
    diagnostics: [],
  });
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath,
    volumeShelvesPath,
    format: "text",
    mode: "dry-run",
  });

  assert.ok(result.content.includes("Shelf facts: Level overlaps volume shelf TEST-shelf-1045-1055"));
  assertNoForbiddenLanguage(result.content);
}));

test("dry-run accepts market context JSON and includes market context facts", async () => withTempDir(async (dir) => {
  const levelOutputPath = writeFixture(dir);
  const marketContextPath = writeJsonFixture(dir, "market-context.json", marketContext());
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath,
    marketContextPath,
    format: "text",
    mode: "dry-run",
  });

  assert.ok(result.content.includes("Market context facts: day_trade_runner; runner phase high_of_day_breakout; confidence 0.78"));
  assert.ok(result.content.includes("Context tags: market_context_day_trade_runner | runner_phase_high_of_day_breakout"));
  assertNoForbiddenLanguage(result.content);
}));

test("dry-run accepts facts bundle JSON and includes bundled facts", async () => withTempDir(async (dir) => {
  const levelOutputPath = writeFixture(dir);
  const factsBundlePath = writeJsonFixture(dir, "facts-bundle.json", factsBundle());
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath,
    factsBundlePath,
    format: "text",
    mode: "dry-run",
  });

  assert.ok(result.content.includes("Session facts: Level is near high of day 10.5"));
  assert.ok(result.content.includes("Volume facts: state high; relative 3.2; dollar 8750000; liquidity strong; acceleration surging"));
  assert.ok(result.content.includes("Shelf facts: Level overlaps volume shelf TEST-shelf-1045-1055"));
  assertNoForbiddenLanguage(result.content);
}));

test("invalid optional facts JSON returns a clear error", async () => withTempDir(async (dir) => {
  const levelOutputPath = writeFixture(dir);
  const sessionFactsPath = join(dir, "invalid-session-facts.json");
  writeFileSync(sessionFactsPath, "{ not json", "utf8");

  await assert.rejects(
    () => runLevelIntelligenceDiscordPreviewRunner({
      levelOutputPath,
      sessionFactsPath,
      format: "text",
      mode: "dry-run",
    }),
    /Failed to read session facts JSON/,
  );
}));

test("invalid volume shelves shape returns a clear error", () => withTempDir(async (dir) => {
  const volumeShelvesPath = writeJsonFixture(dir, "bad-shelves.json", { notShelves: [] });

  assert.throws(
    () => loadLevelIntelligenceDiscordPreviewFactsInput({ volumeShelvesPath }),
    /Volume shelves JSON must contain a VolumeShelf array/,
  );
}));

test("send-test mode requires explicit test webhook config", async () => withTempDir(async (dir) => {
  const filePath = writeFixture(dir);
  let sendCount = 0;
  const sender: LevelIntelligenceDiscordPreviewSender = async () => {
    sendCount += 1;
    return { ok: true, status: 204 };
  };

  await assert.rejects(
    () => runLevelIntelligenceDiscordPreviewRunner({
      levelOutputPath: filePath,
      format: "text",
      mode: "send-test",
    }, undefined, sender),
    /requires --test-webhook-url/,
  );
  assert.equal(sendCount, 0);
}));

test("test webhook config alone does not send without the explicit send-test mode", async () => withTempDir(async (dir) => {
  const filePath = writeFixture(dir);
  let sendCount = 0;
  const sender: LevelIntelligenceDiscordPreviewSender = async () => {
    sendCount += 1;
    return { ok: true, status: 204 };
  };
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath: filePath,
    format: "text",
    mode: "dry-run",
    testWebhookUrl: "https://example.test/webhook",
  }, undefined, sender);

  assert.equal(result.mode, "dry-run");
  assert.equal(sendCount, 0);
  assert.equal(result.sendResults.length, 0);
}));

test("send-test mode sends only preview formatter messages to the supplied test webhook", async () => withTempDir(async (dir) => {
  const filePath = writeFixture(dir);
  const requests: LevelIntelligenceDiscordPreviewSendRequest[] = [];
  const sender: LevelIntelligenceDiscordPreviewSender = async (request) => {
    requests.push(request);
    return { ok: true, status: 204 };
  };
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath: filePath,
    format: "text",
    mode: "send-test",
    testWebhookUrl: "https://example.test/webhook",
  }, undefined, sender);

  assert.equal(result.mode, "send-test");
  assert.equal(requests.length, result.preview.messages.length);
  assert.deepEqual(
    requests.map((request) => request.payload.content),
    result.preview.messages.map((message) => message.text),
  );
  assert.deepEqual(
    requests.map((request) => request.webhookUrl),
    result.preview.messages.map(() => "https://example.test/webhook"),
  );
  assert.deepEqual(
    result.sendResults.map((sendResult) => ({ ok: sendResult.ok, status: sendResult.status, dryRun: sendResult.dryRun })),
    result.preview.messages.map(() => ({ ok: true, status: 204, dryRun: false })),
  );
  assertNoForbiddenLanguage(result.content);
}));

test("preview runner uses the existing Discord preview formatter", () => {
  const output = levelOutput();
  const review = buildLevelIntelligenceReviewResult(output, "text");
  const directPreview = formatLevelIntelligenceDiscordPreview(review.formatted, {
    maxMessageLength: 700,
  });
  const runnerPreview = buildLevelIntelligenceDiscordPreviewReviewResult(output, {
    levelOutputPath: "fixture.json",
    format: "text",
    mode: "dry-run",
    maxMessageLength: 700,
  }).preview;

  assert.deepEqual(runnerPreview, directPreview);
});

test("writes preview output when requested", async () => withTempDir(async (dir) => {
  const filePath = writeFixture(dir);
  const outPath = join(dir, "nested", "preview.json");
  const result = await runLevelIntelligenceDiscordPreviewRunner({
    levelOutputPath: filePath,
    outPath,
    format: "json",
    mode: "dry-run",
  });

  assert.equal(readFileSync(outPath, "utf8"), result.content);
  const parsed = JSON.parse(result.content) as { preview: { symbol: string }; sendResults: unknown[] };
  assert.equal(parsed.preview.symbol, "TEST");
  assert.deepEqual(parsed.sendResults, []);
  assertNoForbiddenLanguage(parsed);
}));

test("preview runner output is deterministic and does not mutate input output", () => {
  const output = levelOutput();
  const before = clone(output);
  const first = buildLevelIntelligenceDiscordPreviewReviewResult(output, {
    levelOutputPath: "fixture.json",
    format: "text",
    mode: "dry-run",
  });
  const second = buildLevelIntelligenceDiscordPreviewReviewResult(output, {
    levelOutputPath: "fixture.json",
    format: "text",
    mode: "dry-run",
  });

  assert.deepEqual(output, before);
  assert.deepEqual(first, second);
  assertNoForbiddenLanguage(first.preview);
});

test("source does not import live Discord gateways alert routing monitoring trader context or LevelEngine", () => {
  const helperPath = fileURLToPath(new URL("../lib/alerts/level-intelligence-discord-preview-runner.ts", import.meta.url));
  const scriptPath = fileURLToPath(new URL("../scripts/run-level-intelligence-discord-preview.ts", import.meta.url));
  const source = `${readFileSync(helperPath, "utf8")}\n${readFileSync(scriptPath, "utf8")}`;

  assert.equal(source.includes("discord-rest-thread-gateway"), false);
  assert.equal(source.includes("discord-audited-thread-gateway"), false);
  assert.equal(source.includes("local-discord-thread-gateway"), false);
  assert.equal(source.includes("alert-router"), false);
  assert.equal(source.includes("manual-watchlist-runtime-manager"), false);
  assert.equal(source.includes("watchlist-monitor"), false);
  assert.equal(source.includes("trader-context"), false);
  assert.equal(source.includes("level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
});

test("old/default runtime mode remains unchanged", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
