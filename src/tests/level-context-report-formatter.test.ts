import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  formatLevelContextReport,
  type FormattedLevelContextReport,
} from "../lib/levels/level-context-report-formatter.js";
import type { LevelContextExplanation } from "../lib/levels/level-context-explainer.js";
import type { LevelContextReport } from "../lib/levels/level-context-report.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";

const GENERATED_AT = Date.parse("2026-05-01T10:30:00-04:00");

function explanation(
  levelId: string,
  kind: LevelContextExplanation["kind"],
  representativePrice: number,
  overrides: Partial<LevelContextExplanation> = {},
): LevelContextExplanation {
  return {
    levelId,
    symbol: "TEST",
    kind,
    representativePrice,
    explanation: `Facts-only context for ${kind} level ${representativePrice} includes supplied market facts.`,
    facts: [`Level ${levelId} uses existing supplied facts.`],
    confluences: [`Level ${levelId} has neutral confluence context.`],
    warnings: [],
    nearbySessionFacts: [],
    nearbyVolumeFacts: [],
    nearbyShelfFacts: [],
    contextTags: [`tag_${levelId}`],
    ...overrides,
  };
}

function report(): LevelContextReport {
  return {
    symbol: "TEST",
    generatedAt: GENERATED_AT,
    explanations: [
      explanation("major-support", "support", 9.5, {
        nearbySessionFacts: ["Level is near low of day 9.5 (0% away)."],
        facts: ["Level is near low of day 9.5 (0% away)."],
        contextTags: ["near_low_of_day"],
      }),
      explanation("major-resistance", "resistance", 10.5, {
        nearbySessionFacts: ["Level is near high of day 10.5 (0% away)."],
        facts: ["Level is near high of day 10.5 (0% away)."],
        contextTags: ["near_high_of_day"],
      }),
      explanation("intermediate-support", "support", 9.25, {
        nearbySessionFacts: ["Level is near premarket low 9.25 (0% away)."],
        contextTags: ["near_premarket_low"],
      }),
      explanation("intermediate-resistance", "resistance", 10.75, {
        nearbySessionFacts: ["Level is near premarket high 10.75 (0% away)."],
        facts: [
          "Level is near premarket high 10.75 (0% away).",
          "enrichedAnalysis state is respected with confidence 0.86.",
        ],
        contextTags: ["near_premarket_high", "enriched_analysis_available"],
      }),
      explanation("intraday-support", "support", 9.75, {
        nearbySessionFacts: ["Level is near opening range low 9.75 (0% away)."],
        contextTags: ["near_opening_range_low"],
      }),
      explanation("intraday-resistance", "resistance", 10.25, {
        facts: [
          "Level is near opening range high 10.25 (0% away).",
          "Relative volume fact is 4.",
          "Dollar volume fact is 4000000.",
        ],
        confluences: ["Volume shelf TEST-volume-shelf is facts-only context near this level."],
        warnings: [
          "VWAP is facts-only context and did not change level selection or scoring.",
          "Volume shelves are facts-only context and were not converted into support or resistance levels.",
        ],
        nearbySessionFacts: [
          "Level is near opening range high 10.25 (0% away).",
          "Level is near VWAP fact 10.24 (0.0977% away).",
        ],
        nearbyVolumeFacts: ["Volume state is extreme.", "Liquidity quality fact is good."],
        nearbyShelfFacts: [
          "Level overlaps volume shelf TEST-volume-shelf (10.2-10.3, 42.5% of window volume, role magnet).",
        ],
        contextTags: [
          "near_opening_range_high",
          "near_vwap_fact",
          "relative_volume_fact",
          "near_volume_shelf",
          "volume_shelf_role_magnet",
        ],
      }),
      explanation("extension-support", "support", 8.75, {
        facts: ["Level is an extension level from the supplied runtime ladder."],
        contextTags: ["extension_level"],
      }),
      explanation("extension-resistance", "resistance", 11.25, {
        facts: ["Level is an extension level from the supplied runtime ladder."],
        contextTags: ["extension_level"],
      }),
    ],
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
    safety: {
      levelOutputUnchanged: true,
      factsOnlyVWAP: true,
      shelvesAreFactsOnly: true,
      noRuntimeBehaviorChange: true,
    },
  };
}

function allText(formatted: FormattedLevelContextReport): string {
  return [
    formatted.summary,
    ...formatted.sections.flatMap((section) => [section.title, ...section.lines]),
  ].join(" ");
}

function section(formatted: FormattedLevelContextReport, title: string) {
  const match = formatted.sections.find((item) => item.title === title);
  assert.ok(match, `Missing section ${title}`);
  return match;
}

function assertNoForbiddenLanguage(formatted: FormattedLevelContextReport): void {
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

test("formats a report into summary sections and safety", () => {
  const formatted = formatLevelContextReport(report());

  assert.equal(formatted.symbol, "TEST");
  assert.equal(formatted.generatedAt, GENERATED_AT);
  assert.equal(formatted.summary, "TEST facts-only level context: 8 explained level(s).");
  assert.equal(section(formatted, "Summary").lines.some((line) => line.includes("Explained levels: 8")), true);
  assert.deepEqual(formatted.safety, {
    levelOutputUnchanged: true,
    factsOnlyVWAP: true,
    shelvesAreFactsOnly: true,
    noRuntimeBehaviorChange: true,
  });
  assert.ok(section(formatted, "Safety").lines.includes("No runtime behavior change: true"));
});

test("includes all major intermediate intraday and extension sections when explanations exist", () => {
  const formatted = formatLevelContextReport(report());
  const titles = formatted.sections.map((item) => item.title);

  assert.deepEqual(titles, [
    "Summary",
    "Major Support",
    "Major Resistance",
    "Intermediate Support",
    "Intermediate Resistance",
    "Intraday Support",
    "Intraday Resistance",
    "Extension Support",
    "Extension Resistance",
    "Safety",
  ]);
});

test("includes counts from the original report", () => {
  const formatted = formatLevelContextReport(report());
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

test("includes facts confluences warnings tags and nearby fact groups", () => {
  const formatted = formatLevelContextReport(report());
  const lines = section(formatted, "Intraday Resistance").lines;

  assert.ok(lines.some((line) => line.includes("Facts: Level is near opening range high")));
  assert.ok(lines.some((line) => line.includes("Confluences: Volume shelf TEST-volume-shelf")));
  assert.ok(lines.some((line) => line.includes("Warnings: VWAP is facts-only context")));
  assert.ok(lines.some((line) => line.includes("Session facts: Level is near opening range high")));
  assert.ok(lines.some((line) => line.includes("Volume facts: Volume state is extreme")));
  assert.ok(lines.some((line) => line.includes("Shelf facts: Level overlaps volume shelf")));
  assert.ok(lines.some((line) => line.includes("Context tags: near_opening_range_high")));
});

test("keeps volume shelf and VWAP language facts-only", () => {
  const formatted = formatLevelContextReport(report());
  const text = allText(formatted);

  assert.ok(text.includes("VWAP is facts-only context"));
  assert.ok(text.includes("Volume shelves are facts-only context"));
  assert.ok(text.includes("volume shelf TEST-volume-shelf"));
  assertNoForbiddenLanguage(formatted);
});

test("does not mutate the input report", () => {
  const input = report();
  const before = structuredClone(input);

  formatLevelContextReport(input);

  assert.deepEqual(input, before);
});

test("output is deterministic", () => {
  const input = report();

  assert.deepEqual(formatLevelContextReport(input), formatLevelContextReport(input));
});

test("filters forbidden action language if supplied by upstream explanation text", () => {
  const input = report();
  input.explanations[0]!.facts.push("This supplied phrase says buy.");
  input.explanations[0]!.warnings.push("This supplied phrase says target.");

  const formatted = formatLevelContextReport(input);

  assertNoForbiddenLanguage(formatted);
});

test("formatter source does not call LevelEngine or runtime wiring modules", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-context-report-formatter.ts", import.meta.url));
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
