import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

import {
  buildLivePostReplaySimulationReport,
  buildRunnerStoryReport,
  type LivePostReplaySimulationReport,
  type RunnerStoryReport,
} from "./live-post-replay-simulator.js";

type StressAuditRow = {
  type?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
};

export type AllSymbolStressPattern =
  | "overposting_original"
  | "still_noisy_after_policy"
  | "tight_range_chop"
  | "fast_runner_cascade"
  | "missed_event_candidate"
  | "language_boundary";

export type AllSymbolPostBudgetStatus = "within_budget" | "watch" | "excessive_chop" | "runner_review";
export type AllSymbolBudgetSymbolType =
  | "low_priced_chop"
  | "range_bound_small_cap"
  | "active_runner"
  | "extreme_runner"
  | "mixed_or_unknown";

export type AllSymbolPostBudget = {
  status: AllSymbolPostBudgetStatus;
  reason: string;
};

export type AllSymbolStressSymbol = {
  symbol: string;
  sessions: number;
  originalPosted: number;
  simulatedPosted: number;
  quietSimulatedPosted: number;
  suppressed: number;
  reductionPct: number;
  maxOriginalPostsInSession: number;
  maxSimulatedPostsInSession: number;
  maxQuietSimulatedPostsInSession: number;
  maxOriginalPostsInTenMinutes: number;
  maxSimulatedPostsInTenMinutes: number;
  maxSessionRangePct: number | null;
  tightRangeSessionCount: number;
  fastRunnerSessionCount: number;
  missingEventCandidates: number;
  noisyPostSamples: number;
  threadStorySuppressions: number;
  languageBoundaryHits: number;
  budgetSymbolType: AllSymbolBudgetSymbolType;
  budgetSessionLimit: number;
  postBudget: AllSymbolPostBudget;
  patterns: AllSymbolStressPattern[];
  sampleSessions: Array<{
    session: string;
    auditPath: string;
    originalPosted: number;
    simulatedPosted: number;
    quietSimulatedPosted: number;
    rangePct: number | null;
    missingEventCandidates: number;
    noisyPostSamples: number;
  }>;
};

export type NoisySymbolRegressionPack = {
  description: string;
  symbols: Array<{
    symbol: string;
    priority: "critical" | "high" | "watch";
    reasons: string[];
    maxSimulatedPostsInSession: number;
    maxSimulatedPostsInTenMinutes: number;
    maxSessionRangePct: number | null;
    targetSessions: AllSymbolStressSymbol["sampleSessions"];
  }>;
};

export type BroadSavedDataReplayPack = {
  description: string;
  archetypes: Array<{
    name:
      | "tight_range_chop"
      | "fast_runner_cascade"
      | "missed_event_candidate"
      | "language_boundary"
      | "high_activity_watch";
    symbols: Array<{
      symbol: string;
      sessions: AllSymbolStressSymbol["sampleSessions"];
      reason: string;
    }>;
  }>;
};

export type AllSymbolStressReport = {
  generatedAt: string;
  sourceRoot: string;
  auditFilesDiscovered: number;
  auditFilesScanned: number;
  duplicateAuditFilesSkipped: number;
  auditFilesFailed: Array<{
    auditPath: string;
    error: string;
  }>;
  totals: {
    symbols: number;
    originalPosted: number;
    simulatedPosted: number;
    quietSimulatedPosted: number;
    suppressed: number;
    reductionPct: number;
    overpostingOriginalSymbols: number;
    stillNoisyAfterPolicySymbols: number;
    tightRangeChopSymbols: number;
    fastRunnerCascadeSymbols: number;
    missedEventCandidateSymbols: number;
    languageBoundarySymbols: number;
    quietBudgetAttentionSymbols: number;
    postBudgetWatchSymbols: number;
    postBudgetExcessiveChopSymbols: number;
    postBudgetRunnerReviewSymbols: number;
    threadStorySuppressions: number;
  };
  symbols: AllSymbolStressSymbol[];
  regressionPack: NoisySymbolRegressionPack;
  broadReplayPack: BroadSavedDataReplayPack;
};

type MutableStressSymbol = Omit<
  AllSymbolStressSymbol,
  "reductionPct" | "budgetSymbolType" | "budgetSessionLimit" | "postBudget" | "patterns" | "sampleSessions"
> & {
  sampleSessions: AllSymbolStressSymbol["sampleSessions"];
};

const SYSTEM_OR_OPERATOR_LANGUAGE =
  /Status:|Signal:|Decision area|setup update|state update|state recap|setup move|alert direction|after the alert|current read:|What matters next:|AI note:|directional progress|LEVEL SNAPSHOT|level map|mapped|remapped|operator-only|policy|suppression|replay|simulation|runtime-only|not a price target/i;

const DIRECT_ADVICE_LANGUAGE =
  /\b(?:buy here|buy now|sell now|sell here|take profit|stop out|trim here|add here|exit now|short setup|best entry|safe entry|can buy|should add|should trim|should exit|longs should|traders should|wait for)\b/i;

const ORIGINAL_OVERPOST_THRESHOLD = 25;
const SIMULATED_STILL_NOISY_THRESHOLD = 15;
const TIGHT_RANGE_POST_THRESHOLD = 12;
const TIGHT_RANGE_PCT = 0.12;
const FAST_RUNNER_RANGE_PCT = 0.3;
const FAST_RUNNER_POST_THRESHOLD = 10;
const POST_BUDGET_HEALTHY_SESSION_LIMIT = 12;
const POST_BUDGET_RUNNER_REVIEW_LIMIT = 25;

function classifyBudgetSymbolType(symbol: Omit<AllSymbolStressSymbol, "postBudget" | "patterns" | "budgetSymbolType" | "budgetSessionLimit">): AllSymbolBudgetSymbolType {
  const range = symbol.maxSessionRangePct ?? 0;
  if (range >= 0.75) {
    return "extreme_runner";
  }
  if (range >= FAST_RUNNER_RANGE_PCT || symbol.fastRunnerSessionCount > 0) {
    return "active_runner";
  }
  if (range <= TIGHT_RANGE_PCT && symbol.tightRangeSessionCount > 0) {
    return symbol.maxOriginalPostsInSession >= ORIGINAL_OVERPOST_THRESHOLD ? "low_priced_chop" : "range_bound_small_cap";
  }
  return "mixed_or_unknown";
}

function budgetLimitForSymbolType(type: AllSymbolBudgetSymbolType): number {
  switch (type) {
    case "low_priced_chop":
      return 8;
    case "range_bound_small_cap":
      return 12;
    case "active_runner":
      return 20;
    case "extreme_runner":
      return 30;
    default:
      return POST_BUDGET_HEALTHY_SESSION_LIMIT;
  }
}

export async function discoverDiscordAuditFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const stats = statSync(root);
  if (stats.isFile()) {
    return basename(root).toLowerCase() === "discord-delivery-audit.jsonl" ? [root] : [];
  }

  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === "discord-delivery-audit.jsonl") {
        found.push(fullPath);
      }
    }
  };

  await walk(root);
  return found.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
}

function dedupeAuditFilesByContent(auditFiles: string[]): string[] {
  const seenHashes = new Set<string>();
  const deduped: string[] = [];

  for (const auditPath of auditFiles) {
    const hash = createHash("sha256")
      .update(readFileSync(auditPath))
      .digest("hex");
    if (seenHashes.has(hash)) {
      continue;
    }

    seenHashes.add(hash);
    deduped.push(auditPath);
  }

  return deduped;
}

export function classifyAllSymbolStressPatterns(
  symbol: Omit<AllSymbolStressSymbol, "postBudget" | "patterns">,
): AllSymbolStressPattern[] {
  const patterns: AllSymbolStressPattern[] = [];

  if (symbol.maxOriginalPostsInSession >= ORIGINAL_OVERPOST_THRESHOLD) {
    patterns.push("overposting_original");
  }

  if (symbol.maxSimulatedPostsInSession >= SIMULATED_STILL_NOISY_THRESHOLD) {
    patterns.push("still_noisy_after_policy");
  }

  if (symbol.tightRangeSessionCount > 0) {
    patterns.push("tight_range_chop");
  }

  if (symbol.fastRunnerSessionCount > 0) {
    patterns.push("fast_runner_cascade");
  }

  if (symbol.missingEventCandidates > 0) {
    patterns.push("missed_event_candidate");
  }

  if (symbol.languageBoundaryHits > 0) {
    patterns.push("language_boundary");
  }

  return patterns;
}

export function assessAllSymbolPostBudget(symbol: {
  maxSimulatedPostsInSession: number;
  budgetSessionLimit?: number;
  budgetSymbolType?: AllSymbolBudgetSymbolType;
  maxSessionRangePct: number | null;
  tightRangeSessionCount: number;
  fastRunnerSessionCount: number;
}): AllSymbolPostBudget {
  const limit = symbol.budgetSessionLimit ?? POST_BUDGET_HEALTHY_SESSION_LIMIT;
  const type = symbol.budgetSymbolType ?? "mixed_or_unknown";
  if (symbol.maxSimulatedPostsInSession <= limit) {
    return {
      status: "within_budget",
      reason: `max simulated session posts are ${symbol.maxSimulatedPostsInSession}, within the ${limit}-post ${type} budget`,
    };
  }

  if (
    symbol.fastRunnerSessionCount > 0 &&
    symbol.maxSimulatedPostsInSession >= POST_BUDGET_RUNNER_REVIEW_LIMIT
  ) {
    return {
      status: "runner_review",
      reason:
        `fast-runner session reaches ${symbol.maxSimulatedPostsInSession} simulated posts; confirm posts are expansion/failure/reclaim beats rather than level-by-level chatter`,
    };
  }

  if (
    symbol.fastRunnerSessionCount > 0 &&
    symbol.maxSessionRangePct !== null &&
    symbol.maxSessionRangePct >= FAST_RUNNER_RANGE_PCT &&
    symbol.maxSimulatedPostsInSession >= SIMULATED_STILL_NOISY_THRESHOLD
  ) {
    return {
      status: "runner_review",
      reason:
        `fast-runner session reaches ${symbol.maxSimulatedPostsInSession} simulated posts; confirm posts are expansion/failure/reclaim beats rather than level-by-level chatter`,
    };
  }

  if (symbol.tightRangeSessionCount > 0 && symbol.maxSimulatedPostsInSession >= SIMULATED_STILL_NOISY_THRESHOLD) {
    return {
      status: "excessive_chop",
      reason:
        `tight-range session still reaches ${symbol.maxSimulatedPostsInSession} simulated posts; review same-area and optional-context suppression before tightening live levels`,
    };
  }

  return {
    status: "watch",
    reason:
      `max simulated session posts are ${symbol.maxSimulatedPostsInSession}; inspect sample sessions before changing live policy`,
  };
}

function regressionPackPriority(symbol: AllSymbolStressSymbol): "critical" | "high" | "watch" {
  if (
    symbol.postBudget.status === "excessive_chop" ||
    symbol.postBudget.status === "runner_review" ||
    symbol.maxSimulatedPostsInSession >= 25 ||
    symbol.maxSimulatedPostsInTenMinutes >= 8
  ) {
    return "critical";
  }

  if (
    symbol.patterns.includes("still_noisy_after_policy") ||
    symbol.patterns.includes("missed_event_candidate") ||
    symbol.maxSimulatedPostsInSession >= 15
  ) {
    return "high";
  }

  return "watch";
}

function regressionPackReasons(symbol: AllSymbolStressSymbol): string[] {
  const reasons = new Set<string>();
  if (symbol.postBudget.status !== "within_budget") {
    reasons.add(`${symbol.postBudget.status}: ${symbol.postBudget.reason}`);
  }
  for (const pattern of symbol.patterns) {
    reasons.add(pattern);
  }
  if (symbol.maxSimulatedPostsInTenMinutes >= 5) {
    reasons.add(`${symbol.maxSimulatedPostsInTenMinutes} simulated posts in a ten-minute window`);
  }
  if (symbol.maxSessionRangePct !== null && symbol.maxSessionRangePct <= TIGHT_RANGE_PCT) {
    reasons.add(`tight maximum saved range ${formatPct(symbol.maxSessionRangePct)}`);
  }
  return [...reasons];
}

export function buildNoisySymbolRegressionPack(
  symbols: AllSymbolStressSymbol[],
  limit = 30,
): NoisySymbolRegressionPack {
  const selected = symbols
    .filter(
      (symbol) =>
        symbol.postBudget.status !== "within_budget" ||
        symbol.patterns.length > 0 ||
        symbol.maxSimulatedPostsInSession >= POST_BUDGET_HEALTHY_SESSION_LIMIT,
    )
    .sort(
      (left, right) =>
        right.maxSimulatedPostsInSession - left.maxSimulatedPostsInSession ||
        right.maxSimulatedPostsInTenMinutes - left.maxSimulatedPostsInTenMinutes ||
        right.originalPosted - left.originalPosted ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, limit)
    .map((symbol) => ({
      symbol: symbol.symbol,
      priority: regressionPackPriority(symbol),
      reasons: regressionPackReasons(symbol),
      maxSimulatedPostsInSession: symbol.maxSimulatedPostsInSession,
      maxSimulatedPostsInTenMinutes: symbol.maxSimulatedPostsInTenMinutes,
      maxSessionRangePct: symbol.maxSessionRangePct,
      targetSessions: symbol.sampleSessions,
    }));

  return {
    description:
      "Saved-data symbols and sessions that should be replayed after every posting-policy change. The pack is selected by simulated post count, tight-range chop, runner cascades, missed-event candidates, and trader-language risk.",
    symbols: selected,
  };
}

function buildArchetypeSymbols(
  symbols: AllSymbolStressSymbol[],
  predicate: (symbol: AllSymbolStressSymbol) => boolean,
  reason: (symbol: AllSymbolStressSymbol) => string,
  limit: number,
): BroadSavedDataReplayPack["archetypes"][number]["symbols"] {
  return symbols
    .filter(predicate)
    .sort(
      (left, right) =>
        right.maxSimulatedPostsInSession - left.maxSimulatedPostsInSession ||
        right.maxSimulatedPostsInTenMinutes - left.maxSimulatedPostsInTenMinutes ||
        right.originalPosted - left.originalPosted ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, limit)
    .map((symbol) => ({
      symbol: symbol.symbol,
      sessions: symbol.sampleSessions,
      reason: reason(symbol),
    }));
}

export function buildBroadSavedDataReplayPack(
  symbols: AllSymbolStressSymbol[],
  limitPerArchetype = 12,
): BroadSavedDataReplayPack {
  return {
    description:
      "Broad saved-data replay pack for posting-policy and first-post wording changes. It intentionally samples multiple behavior families instead of only named problem tickers.",
    archetypes: [
      {
        name: "tight_range_chop",
        symbols: buildArchetypeSymbols(
          symbols,
          (symbol) => symbol.tightRangeSessionCount > 0 || symbol.postBudget.status === "excessive_chop",
          (symbol) =>
            `range stayed tight in ${symbol.tightRangeSessionCount} session(s); max simulated posts/session ${symbol.maxSimulatedPostsInSession}`,
          limitPerArchetype,
        ),
      },
      {
        name: "fast_runner_cascade",
        symbols: buildArchetypeSymbols(
          symbols,
          (symbol) => symbol.fastRunnerSessionCount > 0 || symbol.postBudget.status === "runner_review",
          (symbol) =>
            `runner behavior in ${symbol.fastRunnerSessionCount} session(s); max range ${formatPct(symbol.maxSessionRangePct)} and max simulated posts/session ${symbol.maxSimulatedPostsInSession}`,
          limitPerArchetype,
        ),
      },
      {
        name: "missed_event_candidate",
        symbols: buildArchetypeSymbols(
          symbols,
          (symbol) => symbol.missingEventCandidates > 0,
          (symbol) => `${symbol.missingEventCandidates} saved missed-event candidate(s) need replay review`,
          limitPerArchetype,
        ),
      },
      {
        name: "language_boundary",
        symbols: buildArchetypeSymbols(
          symbols,
          (symbol) => symbol.languageBoundaryHits > 0,
          (symbol) => `${symbol.languageBoundaryHits} saved trader-language boundary hit(s) need current-code comparison`,
          limitPerArchetype,
        ),
      },
      {
        name: "high_activity_watch",
        symbols: buildArchetypeSymbols(
          symbols,
          (symbol) =>
            symbol.maxSimulatedPostsInSession >= POST_BUDGET_HEALTHY_SESSION_LIMIT ||
            symbol.maxSimulatedPostsInTenMinutes >= 4,
          (symbol) =>
            `high activity under current policy: ${symbol.maxSimulatedPostsInSession} max simulated posts/session, ${symbol.maxSimulatedPostsInTenMinutes} max simulated posts/10m`,
          limitPerArchetype,
        ),
      },
    ],
  };
}

function readAuditRows(auditPath: string): StressAuditRow[] {
  return readFileSync(auditPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StressAuditRow)
    .filter((row) => row.type === "discord_delivery_audit");
}

function countLanguageBoundaryHits(rows: StressAuditRow[]): Map<string, number> {
  const hits = new Map<string, number>();

  for (const row of rows) {
    if (row.status !== "posted" || !row.symbol) {
      continue;
    }

    const text = [row.title, row.body ?? row.bodyPreview].filter(Boolean).join("\n");
    if (!text) {
      continue;
    }

    if (SYSTEM_OR_OPERATOR_LANGUAGE.test(text) || DIRECT_ADVICE_LANGUAGE.test(text)) {
      const symbol = row.symbol.toUpperCase();
      hits.set(symbol, (hits.get(symbol) ?? 0) + 1);
    }
  }

  return hits;
}

function rangePct(story: RunnerStoryReport["symbols"][number]): number | null {
  if (
    story.lowPrice === null ||
    story.highPrice === null ||
    story.lowPrice <= 0 ||
    story.highPrice <= 0 ||
    story.highPrice < story.lowPrice
  ) {
    return null;
  }

  return (story.highPrice - story.lowPrice) / Math.max(story.lowPrice, 0.0001);
}

function ensureSymbol(map: Map<string, MutableStressSymbol>, symbol: string): MutableStressSymbol {
  const normalized = symbol.toUpperCase();
  const existing = map.get(normalized);
  if (existing) {
    return existing;
  }

  const created: MutableStressSymbol = {
    symbol: normalized,
    sessions: 0,
    originalPosted: 0,
    simulatedPosted: 0,
    quietSimulatedPosted: 0,
    suppressed: 0,
    maxOriginalPostsInSession: 0,
    maxSimulatedPostsInSession: 0,
    maxQuietSimulatedPostsInSession: 0,
    maxOriginalPostsInTenMinutes: 0,
    maxSimulatedPostsInTenMinutes: 0,
    maxSessionRangePct: null,
    tightRangeSessionCount: 0,
    fastRunnerSessionCount: 0,
    missingEventCandidates: 0,
    noisyPostSamples: 0,
    threadStorySuppressions: 0,
    languageBoundaryHits: 0,
    sampleSessions: [],
  };
  map.set(normalized, created);
  return created;
}

function replaySymbolByName(
  replay: LivePostReplaySimulationReport,
): Map<string, LivePostReplaySimulationReport["perSymbol"][number]> {
  return new Map(replay.perSymbol.map((symbol) => [symbol.symbol.toUpperCase(), symbol]));
}

function addSampleSession(
  target: MutableStressSymbol,
  sample: AllSymbolStressSymbol["sampleSessions"][number],
): void {
  target.sampleSessions.push(sample);
  target.sampleSessions.sort(
    (left, right) =>
      right.originalPosted - left.originalPosted ||
      right.simulatedPosted - left.simulatedPosted ||
      (right.rangePct ?? 0) - (left.rangePct ?? 0),
  );
  target.sampleSessions = target.sampleSessions.slice(0, 5);
}

export function buildAllSymbolStressReportFromAuditFiles(
  auditFiles: string[],
  sourceRoot: string,
): AllSymbolStressReport {
  const dedupedAuditFiles = dedupeAuditFilesByContent(auditFiles);
  const symbols = new Map<string, MutableStressSymbol>();
  const auditFilesFailed: AllSymbolStressReport["auditFilesFailed"] = [];

  for (const auditPath of dedupedAuditFiles) {
    try {
      const rows = readAuditRows(auditPath);
      const languageHits = countLanguageBoundaryHits(rows);
      const replay = buildLivePostReplaySimulationReport(auditPath, "balanced");
      const quietReplay = buildLivePostReplaySimulationReport(auditPath, "quiet");
      const runner = buildRunnerStoryReport(auditPath);
      const replayBySymbol = replaySymbolByName(replay);
      const quietReplayBySymbol = replaySymbolByName(quietReplay);
      const session = basename(dirname(auditPath));

      for (const story of runner.symbols) {
        const symbol = story.symbol.toUpperCase();
        const replaySymbol = replayBySymbol.get(symbol);
        const quietReplaySymbol = quietReplayBySymbol.get(symbol);
        const originalPosted = replaySymbol?.originalPosted ?? story.postCount;
        const simulatedPosted = replaySymbol?.simulatedPosted ?? originalPosted;
        const quietSimulatedPosted = quietReplaySymbol?.simulatedPosted ?? simulatedPosted;
        const suppressed = replaySymbol?.suppressed ?? Math.max(0, originalPosted - simulatedPosted);
        const sessionRangePct = rangePct(story);
        const target = ensureSymbol(symbols, symbol);

        target.sessions += 1;
        target.originalPosted += originalPosted;
        target.simulatedPosted += simulatedPosted;
        target.quietSimulatedPosted += quietSimulatedPosted;
        target.suppressed += suppressed;
        target.maxOriginalPostsInSession = Math.max(target.maxOriginalPostsInSession, originalPosted);
        target.maxSimulatedPostsInSession = Math.max(target.maxSimulatedPostsInSession, simulatedPosted);
        target.maxQuietSimulatedPostsInSession = Math.max(target.maxQuietSimulatedPostsInSession, quietSimulatedPosted);
        target.maxOriginalPostsInTenMinutes = Math.max(
          target.maxOriginalPostsInTenMinutes,
          replaySymbol?.originalMaxPostsInTenMinutes ?? 0,
        );
        target.maxSimulatedPostsInTenMinutes = Math.max(
          target.maxSimulatedPostsInTenMinutes,
          replaySymbol?.simulatedMaxPostsInTenMinutes ?? 0,
        );
        target.maxSessionRangePct =
          sessionRangePct === null
            ? target.maxSessionRangePct
            : Math.max(target.maxSessionRangePct ?? 0, sessionRangePct);
        target.missingEventCandidates += story.missingEventCandidates.length;
        target.noisyPostSamples += story.noisyPostSamples.length;
        target.threadStorySuppressions += replaySymbol?.threadStorySuppressions ?? 0;
        target.languageBoundaryHits += languageHits.get(symbol) ?? 0;

        if (
          sessionRangePct !== null &&
          sessionRangePct <= TIGHT_RANGE_PCT &&
          originalPosted >= TIGHT_RANGE_POST_THRESHOLD
        ) {
          target.tightRangeSessionCount += 1;
        }

        if (
          sessionRangePct !== null &&
          sessionRangePct >= FAST_RUNNER_RANGE_PCT &&
          originalPosted >= FAST_RUNNER_POST_THRESHOLD
        ) {
          target.fastRunnerSessionCount += 1;
        }

        addSampleSession(target, {
          session,
          auditPath,
          originalPosted,
          simulatedPosted,
          quietSimulatedPosted,
          rangePct: sessionRangePct,
          missingEventCandidates: story.missingEventCandidates.length,
          noisyPostSamples: story.noisyPostSamples.length,
        });
      }
    } catch (error) {
      auditFilesFailed.push({
        auditPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const finalized = [...symbols.values()]
    .map((symbol): AllSymbolStressSymbol => {
      const partial = {
        ...symbol,
        reductionPct:
          symbol.originalPosted === 0
            ? 0
            : Number(((symbol.suppressed / symbol.originalPosted) * 100).toFixed(1)),
      };
      const budgetSymbolType = classifyBudgetSymbolType(partial);
      const budgetSessionLimit = budgetLimitForSymbolType(budgetSymbolType);
      return {
        ...partial,
        budgetSymbolType,
        budgetSessionLimit,
        postBudget: assessAllSymbolPostBudget({
          ...partial,
          budgetSymbolType,
          budgetSessionLimit,
        }),
        patterns: classifyAllSymbolStressPatterns({
          ...partial,
          budgetSymbolType,
          budgetSessionLimit,
        }),
      };
    })
    .sort(
      (left, right) =>
        right.patterns.length - left.patterns.length ||
        right.maxSimulatedPostsInSession - left.maxSimulatedPostsInSession ||
        right.maxOriginalPostsInSession - left.maxOriginalPostsInSession ||
        right.originalPosted - left.originalPosted,
    );

  const totals = {
    symbols: finalized.length,
    originalPosted: finalized.reduce((sum, symbol) => sum + symbol.originalPosted, 0),
    simulatedPosted: finalized.reduce((sum, symbol) => sum + symbol.simulatedPosted, 0),
    quietSimulatedPosted: finalized.reduce((sum, symbol) => sum + symbol.quietSimulatedPosted, 0),
    suppressed: finalized.reduce((sum, symbol) => sum + symbol.suppressed, 0),
    reductionPct: 0,
    overpostingOriginalSymbols: finalized.filter((symbol) => symbol.patterns.includes("overposting_original")).length,
    stillNoisyAfterPolicySymbols: finalized.filter((symbol) => symbol.patterns.includes("still_noisy_after_policy")).length,
    tightRangeChopSymbols: finalized.filter((symbol) => symbol.patterns.includes("tight_range_chop")).length,
    fastRunnerCascadeSymbols: finalized.filter((symbol) => symbol.patterns.includes("fast_runner_cascade")).length,
    missedEventCandidateSymbols: finalized.filter((symbol) => symbol.patterns.includes("missed_event_candidate")).length,
    languageBoundarySymbols: finalized.filter((symbol) => symbol.patterns.includes("language_boundary")).length,
    quietBudgetAttentionSymbols: finalized.filter((symbol) => symbol.maxQuietSimulatedPostsInSession > symbol.budgetSessionLimit).length,
    postBudgetWatchSymbols: finalized.filter((symbol) => symbol.postBudget.status === "watch").length,
    postBudgetExcessiveChopSymbols: finalized.filter((symbol) => symbol.postBudget.status === "excessive_chop").length,
    postBudgetRunnerReviewSymbols: finalized.filter((symbol) => symbol.postBudget.status === "runner_review").length,
    threadStorySuppressions: finalized.reduce((sum, symbol) => sum + symbol.threadStorySuppressions, 0),
  };
  totals.reductionPct =
    totals.originalPosted === 0
      ? 0
      : Number(((totals.suppressed / totals.originalPosted) * 100).toFixed(1));

  return {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    auditFilesDiscovered: auditFiles.length,
    auditFilesScanned: dedupedAuditFiles.length,
    duplicateAuditFilesSkipped: auditFiles.length - dedupedAuditFiles.length,
    auditFilesFailed,
    totals,
    symbols: finalized,
    regressionPack: buildNoisySymbolRegressionPack(finalized),
    broadReplayPack: buildBroadSavedDataReplayPack(finalized),
  };
}

export type BuildAllSymbolStressReportOptions = {
  maxAuditFiles?: number;
};

function limitAuditFiles(auditFiles: string[], maxAuditFiles?: number): string[] {
  if (typeof maxAuditFiles !== "number" || !Number.isFinite(maxAuditFiles) || maxAuditFiles <= 0) {
    return auditFiles;
  }
  return auditFiles.slice(0, Math.floor(maxAuditFiles));
}

export async function buildAllSymbolStressReport(
  sourceRoot: string,
  options: BuildAllSymbolStressReportOptions = {},
): Promise<AllSymbolStressReport> {
  const auditFiles = await discoverDiscordAuditFiles(sourceRoot);
  return buildAllSymbolStressReportFromAuditFiles(limitAuditFiles(auditFiles, options.maxAuditFiles), sourceRoot);
}

function formatPct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function renderAllSymbolStressMarkdown(report: AllSymbolStressReport): string {
  const lines = [
    "# All-Symbol Saved-Data Stress Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source root: ${report.sourceRoot}`,
    `Audit files discovered: ${report.auditFilesDiscovered}`,
    `Audit files scanned after dedupe: ${report.auditFilesScanned}`,
    `Duplicate audit files skipped: ${report.duplicateAuditFilesSkipped}`,
    `Audit files failed: ${report.auditFilesFailed.length}`,
    "",
    "## Totals",
    "",
    `- symbols: ${report.totals.symbols}`,
    `- original posted rows: ${report.totals.originalPosted}`,
    `- simulated posted rows: ${report.totals.simulatedPosted}`,
    `- quiet-mode simulated rows: ${report.totals.quietSimulatedPosted}`,
    `- suppressed by current balanced policy: ${report.totals.suppressed} (${report.totals.reductionPct}%)`,
    `- thread-story suppressions: ${report.totals.threadStorySuppressions}`,
    `- original overposting symbols: ${report.totals.overpostingOriginalSymbols}`,
    `- still noisy after current policy: ${report.totals.stillNoisyAfterPolicySymbols}`,
    `- tight-range chop symbols: ${report.totals.tightRangeChopSymbols}`,
    `- fast-runner cascade symbols: ${report.totals.fastRunnerCascadeSymbols}`,
    `- missed-event candidate symbols: ${report.totals.missedEventCandidateSymbols}`,
    `- language-boundary symbols: ${report.totals.languageBoundarySymbols}`,
    `- quiet budget attention symbols: ${report.totals.quietBudgetAttentionSymbols}`,
    `- post-budget watch symbols: ${report.totals.postBudgetWatchSymbols}`,
    `- post-budget excessive-chop symbols: ${report.totals.postBudgetExcessiveChopSymbols}`,
    `- post-budget runner-review symbols: ${report.totals.postBudgetRunnerReviewSymbols}`,
    "",
    "## Highest-Risk Symbols",
    "",
    "| Symbol | Type | Budget | Limit | Patterns | Sessions | Original | Balanced | Quiet | Thread-story suppressed | Max original/session | Max balanced/session | Max quiet/session | Max 10m original/balanced | Max range |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
  ];

  for (const symbol of report.symbols.slice(0, 40)) {
    lines.push(
      `| ${symbol.symbol} | ${symbol.budgetSymbolType} | ${symbol.postBudget.status} | ${symbol.budgetSessionLimit} | ${symbol.patterns.join(", ") || "none"} | ${symbol.sessions} | ${symbol.originalPosted} | ${symbol.simulatedPosted} | ${symbol.quietSimulatedPosted} | ${symbol.threadStorySuppressions} | ${symbol.maxOriginalPostsInSession} | ${symbol.maxSimulatedPostsInSession} | ${symbol.maxQuietSimulatedPostsInSession} | ${symbol.maxOriginalPostsInTenMinutes}/${symbol.maxSimulatedPostsInTenMinutes} | ${formatPct(symbol.maxSessionRangePct)} |`,
    );
  }

  const quietAttention = report.symbols.filter(
    (symbol) => symbol.maxQuietSimulatedPostsInSession > symbol.budgetSessionLimit,
  );
  lines.push("", "## Quiet-Mode Replay Attention", "");
  lines.push("Symbols listed here would still post above the healthy session budget even under the quiet profile.");
  if (quietAttention.length === 0) {
    lines.push("- none", "");
  } else {
    for (const symbol of quietAttention.slice(0, 25)) {
      lines.push(
        `- ${symbol.symbol}: ${symbol.budgetSymbolType}; max quiet/session ${symbol.maxQuietSimulatedPostsInSession} vs ${symbol.budgetSessionLimit}-post budget; balanced max ${symbol.maxSimulatedPostsInSession}; original max ${symbol.maxOriginalPostsInSession}`,
      );
    }
    lines.push("");
  }

  const budgetAttention = report.symbols.filter((symbol) => symbol.postBudget.status !== "within_budget");
  lines.push("", "## Post-Budget Attention", "");
  if (budgetAttention.length === 0) {
    lines.push("- All symbols are within the current simulated post budget.", "");
  } else {
    for (const symbol of budgetAttention.slice(0, 25)) {
      lines.push(
        `- ${symbol.symbol}: ${symbol.postBudget.status} - ${symbol.postBudget.reason}`,
      );
    }
    lines.push("");
  }

  lines.push("", "## Noisy-Symbol Regression Pack", "");
  lines.push(report.regressionPack.description, "");
  if (report.regressionPack.symbols.length === 0) {
    lines.push("- No symbols currently require a noisy-story regression pack.", "");
  } else {
    lines.push("| Symbol | Priority | Max simulated/session | Max simulated/10m | Max range | Reasons |");
    lines.push("| --- | --- | ---: | ---: | ---: | --- |");
    for (const symbol of report.regressionPack.symbols.slice(0, 30)) {
      lines.push(
        `| ${symbol.symbol} | ${symbol.priority} | ${symbol.maxSimulatedPostsInSession} | ${symbol.maxSimulatedPostsInTenMinutes} | ${formatPct(symbol.maxSessionRangePct)} | ${symbol.reasons.join("; ")} |`,
      );
    }
    lines.push("", "Target sessions:");
    for (const symbol of report.regressionPack.symbols.slice(0, 15)) {
      const sessions = symbol.targetSessions
        .slice(0, 3)
        .map((session) => `${session.session} (${session.originalPosted}->${session.simulatedPosted}, quiet ${session.quietSimulatedPosted})`)
        .join(", ");
      lines.push(`- ${symbol.symbol}: ${sessions || "no saved session sample"}`);
    }
    lines.push("");
  }

  lines.push("", "## Broad Saved-Data Replay Pack", "");
  lines.push(report.broadReplayPack.description, "");
  for (const archetype of report.broadReplayPack.archetypes) {
    lines.push(`### ${archetype.name}`, "");
    if (archetype.symbols.length === 0) {
      lines.push("- none", "");
      continue;
    }

    for (const symbol of archetype.symbols) {
      const sessions = symbol.sessions
        .slice(0, 3)
        .map((session) => `${session.session} (${session.originalPosted}->${session.simulatedPosted}, quiet ${session.quietSimulatedPosted})`)
        .join(", ");
      lines.push(`- ${symbol.symbol}: ${symbol.reason}; sessions: ${sessions || "no saved session sample"}`);
    }
    lines.push("");
  }

  lines.push("", "## Sample Sessions", "");
  for (const symbol of report.symbols.slice(0, 20)) {
    lines.push(`### ${symbol.symbol}`, "");
    lines.push(`Patterns: ${symbol.patterns.join(", ") || "none"}`);
    lines.push(`Thread-story suppressions: ${symbol.threadStorySuppressions}`);
    for (const session of symbol.sampleSessions) {
      lines.push(
        `- ${session.session}: ${session.originalPosted} -> ${session.simulatedPosted} posts (quiet ${session.quietSimulatedPosted}), range ${formatPct(session.rangePct)}, missed candidates ${session.missingEventCandidates}, noisy samples ${session.noisyPostSamples}`,
      );
    }
    lines.push("");
  }

  if (report.auditFilesFailed.length > 0) {
    lines.push("## Failed Audit Files", "");
    for (const failure of report.auditFilesFailed.slice(0, 30)) {
      lines.push(`- ${failure.auditPath}: ${failure.error}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
