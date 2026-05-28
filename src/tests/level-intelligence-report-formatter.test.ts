import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  formatLevelIntelligenceReport,
  type FormattedLevelIntelligenceReport,
} from "../lib/levels/level-intelligence-report-formatter.js";
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

function allText(formatted: FormattedLevelIntelligenceReport): string {
  return [
    formatted.summary,
    ...formatted.diagnostics,
    ...formatted.sections.flatMap((section) => [section.title, ...section.lines]),
  ].join(" ");
}

function section(formatted: FormattedLevelIntelligenceReport, title: string) {
  const match = formatted.sections.find((item) => item.title === title);
  assert.ok(match, `Missing section ${title}`);
  return match;
}

function assertNoForbiddenLanguage(formatted: FormattedLevelIntelligenceReport): void {
  const text = allText(formatted).toLowerCase();

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

test("formats a report into summary bucket sections diagnostics and safety", () => {
  const formatted = formatLevelIntelligenceReport(report());

  assert.equal(formatted.symbol, "TEST");
  assert.equal(formatted.generatedAt, GENERATED_AT);
  assert.equal(formatted.summary, "TEST facts-only level intelligence: 8 profiled level(s).");
  assert.deepEqual(formatted.diagnostics, ["session_facts_missing", "volume_facts_missing"]);
  assert.ok(section(formatted, "Summary").lines.some((line) => line.includes("Profiled levels: 8")));
  assert.ok(section(formatted, "Diagnostics").lines.includes("session_facts_missing"));
  assert.ok(section(formatted, "Safety").lines.includes("No runtime behavior change: true"));
});

test("includes all support resistance and extension sections when profiles exist", () => {
  const formatted = formatLevelIntelligenceReport(report());

  assert.deepEqual(
    formatted.sections.map((item) => item.title),
    [
      "Summary",
      "Major Support",
      "Major Resistance",
      "Intermediate Support",
      "Intermediate Resistance",
      "Intraday Support",
      "Intraday Resistance",
      "Extension Support",
      "Extension Resistance",
      "Diagnostics",
      "Safety",
    ],
  );
});

test("includes counts from the original report", () => {
  const formatted = formatLevelIntelligenceReport(report());
  const summary = section(formatted, "Summary").lines.join(" ");

  assert.ok(summary.includes("major support 1"));
  assert.ok(summary.includes("major resistance 1"));
  assert.ok(summary.includes("intermediate support 1"));
  assert.ok(summary.includes("intermediate resistance 1"));
  assert.ok(summary.includes("intraday support 1"));
  assert.ok(summary.includes("intraday resistance 1"));
  assert.ok(summary.includes("extension support 1"));
  assert.ok(summary.includes("extension resistance 1"));
});

test("includes level explanations and profile facts", () => {
  const formatted = formatLevelIntelligenceReport(report());
  const lines = section(formatted, "Intraday Resistance").lines;

  assert.ok(lines.some((line) => line.includes("resistance zone 10.25")));
  assert.ok(lines.some((line) => line.includes("Zone: 10.2-10.3")));
  assert.ok(lines.some((line) => line.includes("Origin: 5m")));
  assert.ok(lines.some((line) => line.includes("Freshness: fresh; state respected")));
  assert.ok(lines.some((line) => line.includes("Reaction: touches 3")));
  assert.ok(lines.some((line) => line.includes("Distance: 0.25% from reference 10")));
  assert.ok(lines.some((line) => line.includes("Reason: Facts-only profile")));
});

test("keeps VWAP and volume shelves facts-only", () => {
  const formatted = formatLevelIntelligenceReport(report());
  const text = allText(formatted);

  assert.ok(text.includes("VWAP is facts-only context"));
  assert.ok(text.includes("volume shelf TEST-volume-shelf"));
  assert.ok(text.includes("Volume shelves facts-only: true"));
  assertNoForbiddenLanguage(formatted);
});

test("does not mutate the input report", () => {
  const input = report();
  const before = structuredClone(input);

  formatLevelIntelligenceReport(input);

  assert.deepEqual(input, before);
});

test("output is deterministic", () => {
  const input = report();

  assert.deepEqual(formatLevelIntelligenceReport(input), formatLevelIntelligenceReport(input));
});

test("filters forbidden action language if supplied by upstream profile text", () => {
  const input = report();
  input.buckets.majorSupport[0]!.reason = "This supplied phrase says buy.";
  input.buckets.majorSupport[0]!.confluence.nearVolumeFacts.push("This supplied phrase says target.");
  input.diagnostics.push("This supplied phrase says sell.");

  const formatted = formatLevelIntelligenceReport(input);

  assertNoForbiddenLanguage(formatted);
});

test("formatter source does not call LevelEngine or runtime wiring modules", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-intelligence-report-formatter.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

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
