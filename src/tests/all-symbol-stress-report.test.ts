import assert from "node:assert/strict";
import test from "node:test";

import {
  assessAllSymbolPostBudget,
  buildAllSymbolStressReportFromAuditFiles,
  buildBroadSavedDataReplayPack,
  buildNoisySymbolRegressionPack,
  classifyAllSymbolStressPatterns,
  renderAllSymbolStressMarkdown,
  type AllSymbolStressSymbol,
} from "../lib/review/all-symbol-stress-report.js";

test("classifyAllSymbolStressPatterns identifies broad problem families", () => {
  const base: Omit<AllSymbolStressSymbol, "postBudget" | "patterns"> = {
    symbol: "TEST",
    sessions: 2,
    originalPosted: 50,
    simulatedPosted: 20,
    quietSimulatedPosted: 12,
    suppressed: 30,
    reductionPct: 60,
    maxOriginalPostsInSession: 30,
    maxSimulatedPostsInSession: 16,
    maxQuietSimulatedPostsInSession: 10,
    maxOriginalPostsInTenMinutes: 8,
    maxSimulatedPostsInTenMinutes: 4,
    maxSessionRangePct: 0.08,
    tightRangeSessionCount: 1,
    fastRunnerSessionCount: 1,
    missingEventCandidates: 2,
    noisyPostSamples: 3,
    threadStorySuppressions: 5,
    languageBoundaryHits: 1,
    budgetSymbolType: "low_priced_chop",
    budgetSessionLimit: 8,
    sampleSessions: [],
  };

  assert.deepEqual(classifyAllSymbolStressPatterns(base), [
    "overposting_original",
    "still_noisy_after_policy",
    "tight_range_chop",
    "fast_runner_cascade",
    "missed_event_candidate",
    "language_boundary",
  ]);
});

test("assessAllSymbolPostBudget separates chop from runner review", () => {
  assert.equal(
    assessAllSymbolPostBudget({
      maxSimulatedPostsInSession: 9,
      budgetSymbolType: "range_bound_small_cap",
      budgetSessionLimit: 12,
      maxSessionRangePct: 0.04,
      tightRangeSessionCount: 1,
      fastRunnerSessionCount: 0,
    }).status,
    "within_budget",
  );
  assert.equal(
    assessAllSymbolPostBudget({
      maxSimulatedPostsInSession: 16,
      budgetSymbolType: "low_priced_chop",
      budgetSessionLimit: 8,
      maxSessionRangePct: 0.04,
      tightRangeSessionCount: 1,
      fastRunnerSessionCount: 0,
    }).status,
    "excessive_chop",
  );
  assert.equal(
    assessAllSymbolPostBudget({
      maxSimulatedPostsInSession: 28,
      budgetSymbolType: "active_runner",
      budgetSessionLimit: 20,
      maxSessionRangePct: 0.76,
      tightRangeSessionCount: 0,
      fastRunnerSessionCount: 1,
    }).status,
    "runner_review",
  );
});

test("all-symbol stress markdown summarizes broad saved-data results", () => {
  const report = buildAllSymbolStressReportFromAuditFiles([], "artifacts");
  const markdown = renderAllSymbolStressMarkdown(report);

  assert.match(markdown, /All-Symbol Saved-Data Stress Report/);
  assert.match(markdown, /Highest-Risk Symbols/);
  assert.match(markdown, /Post-Budget Attention/);
  assert.match(markdown, /Quiet-Mode Replay Attention/);
  assert.match(markdown, /Noisy-Symbol Regression Pack/);
  assert.match(markdown, /Broad Saved-Data Replay Pack/);
  assert.equal(report.totals.symbols, 0);
  assert.equal(report.auditFilesDiscovered, 0);
  assert.equal(report.auditFilesScanned, 0);
  assert.equal(report.duplicateAuditFilesSkipped, 0);
  assert.equal(report.regressionPack.symbols.length, 0);
  assert.equal(report.broadReplayPack.archetypes.length, 5);
  assert.equal(report.totals.quietBudgetAttentionSymbols, 0);
});

test("noisy-symbol regression pack prioritizes noisy sessions for future replay", () => {
  const noisy: AllSymbolStressSymbol = {
    symbol: "CYCU",
    sessions: 1,
    originalPosted: 42,
    simulatedPosted: 18,
    quietSimulatedPosted: 11,
    suppressed: 24,
    reductionPct: 57.1,
    maxOriginalPostsInSession: 42,
    maxSimulatedPostsInSession: 18,
    maxQuietSimulatedPostsInSession: 11,
    maxOriginalPostsInTenMinutes: 9,
    maxSimulatedPostsInTenMinutes: 6,
    maxSessionRangePct: 0.08,
    tightRangeSessionCount: 1,
    fastRunnerSessionCount: 0,
    missingEventCandidates: 0,
    noisyPostSamples: 4,
    threadStorySuppressions: 7,
    languageBoundaryHits: 0,
    budgetSymbolType: "low_priced_chop",
    budgetSessionLimit: 8,
    postBudget: {
      status: "excessive_chop",
      reason: "tight-range session still reaches 18 simulated posts",
    },
    patterns: ["overposting_original", "still_noisy_after_policy", "tight_range_chop"],
    sampleSessions: [{
      session: "2026-05-01_09-30-00",
      auditPath: "artifacts/long-run/2026-05-01_09-30-00/discord-delivery-audit.jsonl",
      originalPosted: 42,
      simulatedPosted: 18,
      quietSimulatedPosted: 11,
      rangePct: 0.08,
      missingEventCandidates: 0,
      noisyPostSamples: 4,
    }],
  };

  const quiet: AllSymbolStressSymbol = {
    ...noisy,
    symbol: "CALM",
    originalPosted: 8,
    simulatedPosted: 5,
    quietSimulatedPosted: 4,
    suppressed: 3,
    maxOriginalPostsInSession: 8,
    maxSimulatedPostsInSession: 5,
    maxQuietSimulatedPostsInSession: 4,
    maxOriginalPostsInTenMinutes: 2,
    maxSimulatedPostsInTenMinutes: 1,
    tightRangeSessionCount: 0,
    noisyPostSamples: 0,
    postBudget: {
      status: "within_budget",
      reason: "inside budget",
    },
    patterns: [],
    sampleSessions: [],
  };

  const pack = buildNoisySymbolRegressionPack([quiet, noisy]);

  assert.equal(pack.symbols.length, 1);
  assert.equal(pack.symbols[0]?.symbol, "CYCU");
  assert.equal(pack.symbols[0]?.priority, "critical");
  assert.ok(pack.symbols[0]?.reasons.some((reason) => reason.includes("excessive_chop")));
  assert.equal(pack.symbols[0]?.targetSessions[0]?.session, "2026-05-01_09-30-00");
});

test("broad saved-data replay pack samples multiple behavior archetypes", () => {
  const tightChop: AllSymbolStressSymbol = {
    symbol: "CYCU",
    sessions: 1,
    originalPosted: 42,
    simulatedPosted: 18,
    quietSimulatedPosted: 11,
    suppressed: 24,
    reductionPct: 57.1,
    maxOriginalPostsInSession: 42,
    maxSimulatedPostsInSession: 18,
    maxQuietSimulatedPostsInSession: 11,
    maxOriginalPostsInTenMinutes: 9,
    maxSimulatedPostsInTenMinutes: 6,
    maxSessionRangePct: 0.08,
    tightRangeSessionCount: 1,
    fastRunnerSessionCount: 0,
    missingEventCandidates: 0,
    noisyPostSamples: 4,
    threadStorySuppressions: 7,
    languageBoundaryHits: 0,
    budgetSymbolType: "low_priced_chop",
    budgetSessionLimit: 8,
    postBudget: {
      status: "excessive_chop",
      reason: "tight-range session still reaches 18 simulated posts",
    },
    patterns: ["tight_range_chop"],
    sampleSessions: [{
      session: "2026-05-01_09-30-00",
      auditPath: "artifacts/long-run/2026-05-01_09-30-00/discord-delivery-audit.jsonl",
      originalPosted: 42,
      simulatedPosted: 18,
      quietSimulatedPosted: 11,
      rangePct: 0.08,
      missingEventCandidates: 0,
      noisyPostSamples: 4,
    }],
  };
  const runner: AllSymbolStressSymbol = {
    ...tightChop,
    symbol: "AKAN",
    maxSessionRangePct: 0.7,
    tightRangeSessionCount: 0,
    fastRunnerSessionCount: 1,
    missingEventCandidates: 3,
    languageBoundaryHits: 2,
    postBudget: {
      status: "runner_review",
      reason: "fast runner review",
    },
    patterns: ["fast_runner_cascade", "missed_event_candidate", "language_boundary"],
  };

  const pack = buildBroadSavedDataReplayPack([tightChop, runner], 5);

  assert.equal(pack.archetypes.find((entry) => entry.name === "tight_range_chop")?.symbols[0]?.symbol, "CYCU");
  assert.equal(pack.archetypes.find((entry) => entry.name === "fast_runner_cascade")?.symbols[0]?.symbol, "AKAN");
  assert.equal(pack.archetypes.find((entry) => entry.name === "missed_event_candidate")?.symbols[0]?.symbol, "AKAN");
  assert.equal(pack.archetypes.find((entry) => entry.name === "language_boundary")?.symbols[0]?.symbol, "AKAN");
  assert.ok(pack.archetypes.find((entry) => entry.name === "high_activity_watch")?.symbols.length);
});
