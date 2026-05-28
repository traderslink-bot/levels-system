import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  formatLevelIntelligenceDiscordPreview,
  type LevelIntelligenceDiscordPreview,
} from "../lib/alerts/level-intelligence-discord-preview.js";
import { formatLevelIntelligenceReport } from "../lib/levels/level-intelligence-report-formatter.js";
import type { LevelIntelligenceProfile } from "../lib/levels/level-intelligence-profile.js";
import type { LevelIntelligenceReport } from "../lib/levels/level-intelligence-report.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";

const GENERATED_AT = Date.parse("2026-05-01T10:30:00-04:00");

function intelligenceProfile(
  levelId: string,
  kind: LevelIntelligenceProfile["kind"],
  representativePrice: number,
  overrides: Partial<LevelIntelligenceProfile> = {},
): LevelIntelligenceProfile {
  return {
    levelId,
    symbol: "TEST",
    kind,
    representativePrice,
    zoneLow: representativePrice - 0.05,
    zoneHigh: representativePrice + 0.05,
    zoneWidthPercent: 1,
    origin: {
      sourceTypes: [kind === "support" ? "swing_low" : "swing_high"],
      timeframeSources: ["5m"],
      primaryTimeframe: "5m",
      isExtension: false,
    },
    freshness: {
      firstTimestamp: Date.parse("2026-05-01T09:30:00-04:00"),
      lastTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
      label: "fresh",
      state: "respected",
    },
    reaction: {
      touchCount: 3,
      reactionQualityScore: 0.6,
      rejectionScore: 0.5,
      displacementScore: 0.4,
      followThroughScore: 0.5,
      meaningfulTouchCount: 2,
      averageReactionMovePct: 2.4,
      strongestReactionMovePct: 5.2,
    },
    distance: {
      referencePrice: 10,
      distanceFromReferencePct: Math.abs(representativePrice - 10),
      category: "near",
    },
    volume: {
      volumeState: "extreme",
      relativeVolume: 4,
      dollarVolume: 4_000_000,
      liquidityQuality: "good",
      accelerationState: "surging",
      pullbackVolumeState: "drying_up",
      breakoutVolumeState: "strong",
      nearbyShelfIds: ["TEST-volume-shelf"],
    },
    confluence: {
      nearSessionFacts: [`${levelId} is near a supplied session fact.`],
      nearVolumeFacts: ["Volume state is extreme.", "VWAP is facts-only context near this level."],
      nearShelfFacts: [
        "Level overlaps volume shelf TEST-volume-shelf (10.2-10.3, 42.5% of window volume, role magnet).",
      ],
      contextTags: [`tag_${levelId}`, "near_vwap_fact", "near_volume_shelf"],
      nearRoundNumber: {
        value: representativePrice,
        type: "half",
        distancePct: 0,
      },
    },
    marketContext: {
      primaryContext: "day_trade_runner",
      runnerPhase: "high_of_day_breakout",
      confidence: 0.77,
    },
    confidence: 0.86,
    diagnostics: ["session_facts_missing"],
    reason: `Facts-only profile for ${kind} zone ${representativePrice}.`,
    safety: {
      factsOnly: true,
      noRuntimeBehaviorChange: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
    },
    ...overrides,
  };
}

function report(): LevelIntelligenceReport {
  const majorSupport = intelligenceProfile("major-support", "support", 9.5);
  const majorResistance = intelligenceProfile("major-resistance", "resistance", 10.5);
  const intermediateSupport = intelligenceProfile("intermediate-support", "support", 9.25);
  const intermediateResistance = intelligenceProfile("intermediate-resistance", "resistance", 10.75);
  const intradaySupport = intelligenceProfile("intraday-support", "support", 9.75);
  const intradayResistance = intelligenceProfile("intraday-resistance", "resistance", 10.25);
  const extensionSupport = intelligenceProfile("extension-support", "support", 8.75, {
    origin: {
      sourceTypes: ["swing_low"],
      timeframeSources: ["5m"],
      primaryTimeframe: "5m",
      isExtension: true,
    },
    confluence: {
      nearSessionFacts: [],
      nearVolumeFacts: [],
      nearShelfFacts: [],
      contextTags: ["extension_level"],
    },
    reason: "Facts-only extension profile from the supplied runtime ladder.",
  });
  const extensionResistance = intelligenceProfile("extension-resistance", "resistance", 11.25, {
    origin: {
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      primaryTimeframe: "5m",
      isExtension: true,
    },
    confluence: {
      nearSessionFacts: [],
      nearVolumeFacts: [],
      nearShelfFacts: [],
      contextTags: ["extension_level"],
    },
    reason: "Facts-only extension profile from the supplied runtime ladder.",
  });

  return {
    symbol: "TEST",
    generatedAt: GENERATED_AT,
    referencePrice: 10,
    profiles: [
      majorSupport,
      majorResistance,
      intermediateSupport,
      intermediateResistance,
      intradaySupport,
      intradayResistance,
      extensionSupport,
      extensionResistance,
    ],
    buckets: {
      majorSupport: [majorSupport],
      majorResistance: [majorResistance],
      intermediateSupport: [intermediateSupport],
      intermediateResistance: [intermediateResistance],
      intradaySupport: [intradaySupport],
      intradayResistance: [intradayResistance],
      extensionSupport: [extensionSupport],
      extensionResistance: [extensionResistance],
    },
    counts: {
      majorSupport: 1,
      majorResistance: 1,
      intermediateSupport: 1,
      intermediateResistance: 1,
      intradaySupport: 1,
      intradayResistance: 1,
      extensionSupport: 1,
      extensionResistance: 1,
      total: 8,
    },
    diagnostics: ["session_facts_missing", "volume_facts_missing"],
    safety: {
      levelOutputUnchanged: true,
      factsOnly: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
      noRuntimeBehaviorChange: true,
    },
  };
}

function allText(preview: LevelIntelligenceDiscordPreview): string {
  return [
    preview.summary,
    ...preview.diagnostics,
    ...preview.sections.flatMap((section) => [section.title, ...section.lines, section.text]),
    ...preview.messages.map((message) => message.text),
  ].join(" ");
}

function section(preview: LevelIntelligenceDiscordPreview, title: string) {
  const match = preview.sections.find((item) => item.title === title);
  assert.ok(match, `Missing section ${title}`);
  return match;
}

function assertNoForbiddenLanguage(preview: LevelIntelligenceDiscordPreview): void {
  const text = allText(preview).toLowerCase();

  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["enter", /\benter\b/],
    ["entry", /\bentry\b/],
    ["exit", /\bexit\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["mistake", /\bmistake\b/],
    ["should", /\bshould\b/],
    ["coaching", /\bcoaching\b/],
    ["P/L", /\bp\/l\b/],
    ["giveback", /\bgiveback\b/],
    ["journal", /\bjournal\b/],
    ["grading", /\bgrading\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected recommendation language: ${label}`);
  }
}

test("formats a LevelIntelligenceReport into Discord preview sections", () => {
  const preview = formatLevelIntelligenceDiscordPreview(report());

  assert.equal(preview.symbol, "TEST");
  assert.equal(preview.summary, "TEST facts-only level intelligence: 8 profiled level(s).");
  assert.equal(preview.messages[0]?.text.startsWith("**TEST Level Intelligence Preview**"), true);
  assert.equal(section(preview, "Summary").lines.some((line) => line.includes("Profiled levels: 8")), true);
});

test("accepts a preformatted LevelIntelligenceReport", () => {
  const formatted = formatLevelIntelligenceReport(report());
  const preview = formatLevelIntelligenceDiscordPreview(formatted);

  assert.equal(preview.symbol, "TEST");
  assert.equal(preview.sections[0]?.title, "Summary");
  assert.equal(preview.safety.noRuntimeBehaviorChange, true);
});

test("includes support resistance and extension sections", () => {
  const preview = formatLevelIntelligenceDiscordPreview(report());
  const titles = preview.sections.map((item) => item.title);

  assert.ok(titles.includes("Major Support"));
  assert.ok(titles.includes("Major Resistance"));
  assert.ok(titles.includes("Intermediate Support"));
  assert.ok(titles.includes("Intermediate Resistance"));
  assert.ok(titles.includes("Intraday Support"));
  assert.ok(titles.includes("Intraday Resistance"));
  assert.ok(titles.includes("Extension Support"));
  assert.ok(titles.includes("Extension Resistance"));
});

test("includes diagnostics safety notes facts and confluences", () => {
  const preview = formatLevelIntelligenceDiscordPreview(report());
  const text = allText(preview);

  assert.ok(text.includes("session_facts_missing"));
  assert.ok(text.includes("No runtime behavior change: true"));
  assert.ok(text.includes("Session facts: major-support is near a supplied session fact."));
  assert.ok(text.includes("Volume facts nearby: Volume state is extreme."));
  assert.ok(text.includes("Shelf facts: Level overlaps volume shelf TEST-volume-shelf"));
  assert.ok(text.includes("Context tags: tag_major-support"));
});

test("truncates long lines and splits messages under the configured length", () => {
  const input = report();
  input.buckets.majorSupport[0]!.confluence.nearSessionFacts = [
    `Long session fact ${"x".repeat(500)}`,
  ];
  const preview = formatLevelIntelligenceDiscordPreview(input, {
    maxMessageLength: 320,
    maxLineLength: 110,
    maxLinesPerSection: 4,
  });

  assert.equal(preview.truncated, true);
  assert.ok(preview.messages.length > 1);
  assert.ok(preview.messages.every((message) => message.text.length <= preview.maxMessageLength));
  assert.ok(allText(preview).includes("[truncated]"));
});

test("preserves VWAP and volume shelves as facts-only text", () => {
  const preview = formatLevelIntelligenceDiscordPreview(report());
  const text = allText(preview);

  assert.ok(text.includes("VWAP is facts-only context"));
  assert.ok(text.includes("Volume shelves facts-only: true"));
  assert.ok(text.includes("volume shelf TEST-volume-shelf"));
  assertNoForbiddenLanguage(preview);
});

test("filters forbidden action and grading language from supplied formatted input", () => {
  const formatted = formatLevelIntelligenceReport(report());
  formatted.sections[1]!.lines.push("This supplied line says buy.");
  formatted.sections[1]!.lines.push("This supplied line says should.");
  formatted.sections[1]!.lines.push("This supplied line mentions P/L and giveback.");
  formatted.diagnostics.push("This supplied diagnostic says sell.");

  const preview = formatLevelIntelligenceDiscordPreview(formatted);

  assertNoForbiddenLanguage(preview);
});

test("does not mutate input reports", () => {
  const input = report();
  const before = structuredClone(input);

  formatLevelIntelligenceDiscordPreview(input);

  assert.deepEqual(input, before);
});

test("output is deterministic", () => {
  const input = report();

  assert.deepEqual(
    formatLevelIntelligenceDiscordPreview(input),
    formatLevelIntelligenceDiscordPreview(input),
  );
});

test("source does not import Discord gateways alerts monitoring trader context or LevelEngine", () => {
  const sourcePath = fileURLToPath(new URL("../lib/alerts/level-intelligence-discord-preview.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [
    "discord-rest-thread-gateway",
    "discord-audited-thread-gateway",
    "local-discord-thread-gateway",
    "alert-router",
    "alert-intelligence-engine",
    "watchlist-monitor",
    "manual-watchlist-runtime-manager",
    "trader-context",
    "level-engine",
    "new LevelEngine",
  ]) {
    assert.equal(source.includes(forbidden), false, `Unexpected live/runtime import marker: ${forbidden}`);
  }
});

test("old/default runtime mode remains unchanged", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
