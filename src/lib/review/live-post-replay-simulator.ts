import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildFollowThroughStoryRecord,
  buildIntelligentAlertStoryRecord,
  classifyLiveThreadMessage,
  decideCriticalLivePost,
  decideFollowThroughPost,
  decideIntelligentAlertPost,
  decideNarrationBurst,
  decideOptionalLivePost,
  getLiveThreadPostingPolicySettings,
  resolveLiveThreadPostingProfile,
  type CriticalLivePostKind,
  type FollowThroughStoryRecord,
  type IntelligentAlertStoryRecord,
  type LiveThreadPostingPolicySettings,
  type LiveThreadPostingProfile,
  type LiveThreadPostRecord,
  type LiveThreadRuntimePostKind,
  type NarrationBurstRecord,
  type OptionalLivePostKind,
} from "../monitoring/live-thread-post-policy.js";
import type { EvaluatedOpportunity } from "../monitoring/opportunity-evaluator.js";

type ReplayAuditEntry = {
  type?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
  severity?: string;
  confidence?: string;
  score?: number;
  followThroughLabel?: string;
  continuityType?: string;
  progressLabel?: string;
  targetPrice?: number;
  directionalReturnPct?: number | null;
  rawReturnPct?: number | null;
};

type ReplaySymbolState = {
  originalPosted: number;
  simulatedPosted: number;
  suppressed: number;
  originalByKind: Record<string, number>;
  simulatedByKind: Record<string, number>;
  suppressedByReason: Record<string, number>;
  originalTimestamps: number[];
  simulatedTimestamps: number[];
  criticalPosts: LiveThreadPostRecord[];
  optionalPosts: LiveThreadPostRecord[];
  narrationState: NarrationBurstRecord[];
  followThroughRecords: FollowThroughStoryRecord[];
  intelligentAlertRecords: IntelligentAlertStoryRecord[];
  sampleSuppressions: Array<{
    timestamp: number;
    messageKind: string;
    reason: string;
    title?: string;
  }>;
};

export type LivePostReplaySimulationReport = {
  generatedAt: string;
  sourceAuditPath: string;
  profile: LiveThreadPostingProfile;
  totals: {
    originalPosted: number;
    simulatedPosted: number;
    suppressed: number;
    reductionPct: number;
    originalMaxPostsInFiveMinutes: number;
    simulatedMaxPostsInFiveMinutes: number;
    originalMaxPostsInTenMinutes: number;
    simulatedMaxPostsInTenMinutes: number;
  };
  perSymbol: Array<{
    symbol: string;
    originalPosted: number;
    simulatedPosted: number;
    suppressed: number;
    reductionPct: number;
    originalMaxPostsInFiveMinutes: number;
    simulatedMaxPostsInFiveMinutes: number;
    originalMaxPostsInTenMinutes: number;
    simulatedMaxPostsInTenMinutes: number;
    originalByKind: Record<string, number>;
    simulatedByKind: Record<string, number>;
    suppressedByReason: Record<string, number>;
    sampleSuppressions: Array<{
      timestamp: number;
      messageKind: string;
      reason: string;
      title?: string;
    }>;
  }>;
};

export type LivePostProfileComparisonReport = {
  generatedAt: string;
  sourceAuditPath: string;
  profiles: Array<{
    profile: LiveThreadPostingProfile;
    originalPosted: number;
    simulatedPosted: number;
    suppressed: number;
    reductionPct: number;
    maxPostsInFiveMinutes: number;
    maxPostsInTenMinutes: number;
  }>;
  topSymbols: Array<{
    symbol: string;
    originalPosted: number;
    quiet: number;
    balanced: number;
    active: number;
  }>;
};

export type RunnerStoryReport = {
  generatedAt: string;
  sourceAuditPath: string;
  symbols: Array<{
    symbol: string;
    firstTimestamp: number;
    lastTimestamp: number;
    postCount: number;
    firstPrice: number | null;
    lastPrice: number | null;
    lowPrice: number | null;
    highPrice: number | null;
    byKind: Record<string, number>;
    levelsMentioned: Array<{ price: number; count: number }>;
    qualitySummary: {
      traderCritical: number;
      helpfulContext: number;
      noisyRepeat: number;
      operatorOnly: number;
      unknown: number;
    };
    traderStory: string[];
    missingEventCandidates: Array<{
      timestamp: number;
      side: "support" | "resistance";
      level: number;
      fromPrice: number;
      toPrice: number;
      reason: string;
    }>;
    noisyPostSamples: Array<{
      timestamp: number;
      messageKind: string;
      reason: string;
      title?: string;
    }>;
    tuningSuggestions: string[];
    keyEvents: Array<{
      timestamp: number;
      messageKind: string;
      eventType?: string;
      title?: string;
      price?: number | null;
      level?: number | null;
    }>;
  }>;
};

type PostQualityCategory = keyof RunnerStoryReport["symbols"][number]["qualitySummary"];

type ClassifiedPostQuality = {
  category: PostQualityCategory;
  reason: string;
};

type PricePoint = {
  timestamp: number;
  price: number;
};

const OPTIONAL_LIVE_POST_WINDOW_MS = 15 * 60 * 1000;
const CONTINUITY_UPDATE_COOLDOWN_MS = 5 * 60 * 1000;
const CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS = 12 * 60 * 1000;
const NARRATION_BURST_WINDOW_MS = 90 * 1000;
const NARRATION_RECAP_BURST_WINDOW_MS = 75 * 1000;
const FOLLOW_THROUGH_MAJOR_MOVE_PCT = 2;

function readJsonLines(path: string): ReplayAuditEntry[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ReplayAuditEntry];
      } catch {
        return [];
      }
    });
}

function increment(table: Record<string, number>, key: string): void {
  table[key] = (table[key] ?? 0) + 1;
}

function symbolOf(entry: ReplayAuditEntry): string {
  return entry.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function messageKindOf(entry: ReplayAuditEntry): string {
  if (entry.operation === "post_level_snapshot") {
    return "level_snapshot";
  }
  if (entry.operation === "post_level_extension") {
    return "level_extension";
  }
  return entry.messageKind ?? "unknown";
}

function runtimeKindOf(messageKind: string): LiveThreadRuntimePostKind | null {
  switch (messageKind) {
    case "level_snapshot":
      return "snapshot";
    case "level_extension":
      return "extension";
    case "intelligent_alert":
    case "level_clear_update":
      return "intelligent_alert";
    case "follow_through_update":
      return "follow_through";
    case "continuity_update":
      return "continuity";
    case "follow_through_state_update":
      return "follow_through_state";
    case "symbol_recap":
      return "recap";
    case "ai_signal_commentary":
      return "ai_signal_commentary";
    case "stock_context":
      return "recap";
    default:
      return null;
  }
}

function optionalKindOf(messageKind: string): OptionalLivePostKind | null {
  switch (messageKind) {
    case "continuity_update":
      return "continuity";
    case "follow_through_state_update":
      return "follow_through_state";
    case "symbol_recap":
    case "ai_signal_commentary":
    case "stock_context":
      return "recap";
    default:
      return null;
  }
}

function maxEventsInWindow(timestamps: number[], windowMs: number): number {
  const sorted = [...timestamps].sort((a, b) => a - b);
  let left = 0;
  let max = 0;
  for (let right = 0; right < sorted.length; right += 1) {
    while (sorted[right]! - sorted[left]! > windowMs) {
      left += 1;
    }
    max = Math.max(max, right - left + 1);
  }
  return max;
}

function pctReduction(original: number, simulated: number): number {
  if (original <= 0) {
    return 0;
  }
  return Number((((original - simulated) / original) * 100).toFixed(1));
}

function parseFirstPathPrice(entry: ReplayAuditEntry): number | null {
  const text = entry.body ?? entry.bodyPreview ?? "";
  const match = text.match(/(?:Path:\s*)?-?\s*(\d+(?:\.\d+)?)\s*->/i);
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function buildEvaluation(entry: ReplayAuditEntry): EvaluatedOpportunity | null {
  if (!entry.eventType || !entry.followThroughLabel || typeof entry.timestamp !== "number") {
    return null;
  }

  const entryPrice = typeof entry.targetPrice === "number" ? entry.targetPrice : parseFirstPathPrice(entry);
  if (entryPrice === null) {
    return null;
  }

  const directionalReturnPct = typeof entry.directionalReturnPct === "number" ? entry.directionalReturnPct : null;
  const rawReturnPct = typeof entry.rawReturnPct === "number" ? entry.rawReturnPct : directionalReturnPct ?? 0;
  const outcomePrice =
    directionalReturnPct === null
      ? entryPrice
      : entryPrice * (1 + directionalReturnPct / 100);

  return {
    symbol: symbolOf(entry),
    timestamp: entry.timestamp,
    evaluatedAt: entry.timestamp,
    entryPrice,
    outcomePrice,
    returnPct: rawReturnPct,
    directionalReturnPct,
    followThroughLabel: entry.followThroughLabel as EvaluatedOpportunity["followThroughLabel"],
    success: entry.followThroughLabel === "strong" || entry.followThroughLabel === "working",
    eventType: entry.eventType,
  };
}

function getState(map: Map<string, ReplaySymbolState>, symbol: string): ReplaySymbolState {
  const existing = map.get(symbol);
  if (existing) {
    return existing;
  }

  const created: ReplaySymbolState = {
    originalPosted: 0,
    simulatedPosted: 0,
    suppressed: 0,
    originalByKind: {},
    simulatedByKind: {},
    suppressedByReason: {},
    originalTimestamps: [],
    simulatedTimestamps: [],
    criticalPosts: [],
    optionalPosts: [],
    narrationState: [],
    followThroughRecords: [],
    intelligentAlertRecords: [],
    sampleSuppressions: [],
  };
  map.set(symbol, created);
  return created;
}

function pruneState(state: ReplaySymbolState, timestamp: number): void {
  state.criticalPosts = state.criticalPosts.filter((entry) => timestamp - entry.timestamp <= OPTIONAL_LIVE_POST_WINDOW_MS);
  state.optionalPosts = state.optionalPosts.filter((entry) => timestamp - entry.timestamp <= OPTIONAL_LIVE_POST_WINDOW_MS);
  state.narrationState = state.narrationState.filter((entry) => timestamp - entry.timestamp <= NARRATION_BURST_WINDOW_MS);
}

function recordSuppression(
  state: ReplaySymbolState,
  entry: ReplayAuditEntry,
  messageKind: string,
  reason: string,
): void {
  state.suppressed += 1;
  increment(state.suppressedByReason, reason);
  if (state.sampleSuppressions.length < 8) {
    state.sampleSuppressions.push({
      timestamp: entry.timestamp ?? 0,
      messageKind,
      reason,
      title: entry.title,
    });
  }
}

function recordSimulatedPost(
  state: ReplaySymbolState,
  entry: ReplayAuditEntry,
  messageKind: string,
  runtimeKind: LiveThreadRuntimePostKind,
): void {
  const timestamp = entry.timestamp ?? 0;
  const eventType = entry.eventType ?? null;
  state.simulatedPosted += 1;
  state.simulatedTimestamps.push(timestamp);
  increment(state.simulatedByKind, messageKind);
  const outputClass = classifyLiveThreadMessage(messageKind as Parameters<typeof classifyLiveThreadMessage>[0]);
  const record = { kind: runtimeKind, timestamp, eventType };
  if (outputClass === "trader_critical") {
    state.criticalPosts.push(record);
  } else if (outputClass === "trader_helpful_optional") {
    state.optionalPosts.push(record);
  }
}

function shouldTreatAlertAsMajor(entry: ReplayAuditEntry): boolean {
  return (
    entry.eventType === "breakout" ||
    entry.eventType === "breakdown" ||
    entry.eventType === "reclaim" ||
    entry.severity === "critical" ||
    (entry.severity === "high" && entry.confidence === "high")
  );
}

function parseAlertLevel(entry: ReplayAuditEntry): number | null {
  if (typeof entry.targetPrice === "number") {
    return entry.targetPrice;
  }

  const text = entry.body ?? entry.bodyPreview ?? "";
  const match = text.match(/\b(?:support|resistance)\s+(?:lost|cleared|at|through|above|below|near)?\s*(?:at\s*)?(?:light|moderate|heavy|major)?\s*(?:support|resistance)?\s*(\d+(?:\.\d+)?)/i)
    ?? text.match(/\b(?:hold above|back below|reclaims?|clears?)\s+(\d+(?:\.\d+)?)/i)
    ?? text.match(/\b(?:Trigger|Triggered near):\s*(\d+(?:\.\d+)?)/i);
  if (!match?.[1]) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseProgressLabel(value: string | undefined): "improving" | "stalling" | "degrading" | null {
  return value === "improving" || value === "stalling" || value === "degrading" ? value : null;
}

function simulateEntry(
  state: ReplaySymbolState,
  entry: ReplayAuditEntry,
  settings: LiveThreadPostingPolicySettings,
): void {
  const messageKind = messageKindOf(entry);
  const runtimeKind = runtimeKindOf(messageKind);
  const timestamp = entry.timestamp ?? 0;
  if (!runtimeKind) {
    recordSuppression(state, entry, messageKind, "unknown_runtime_kind");
    return;
  }

  pruneState(state, timestamp);

  if (messageKind === "follow_through_update") {
    const evaluation = buildEvaluation(entry);
    if (evaluation) {
      const decision = decideFollowThroughPost({
        records: state.followThroughRecords,
        evaluation,
        settings,
      });
      if (!decision.shouldPost) {
        recordSuppression(state, entry, messageKind, `follow_through_${decision.reason}`);
        return;
      }

      const majorChange =
        evaluation.followThroughLabel === "failed" ||
        evaluation.followThroughLabel === "strong" ||
        (evaluation.directionalReturnPct !== null &&
          Math.abs(evaluation.directionalReturnPct) >= FOLLOW_THROUGH_MAJOR_MOVE_PCT);
      const criticalDecision = decideCriticalLivePost({
        criticalPosts: state.criticalPosts,
        timestamp,
        kind: "follow_through",
        eventType: entry.eventType ?? null,
        majorChange,
        settings,
      });
      if (!criticalDecision.shouldPost) {
        recordSuppression(state, entry, messageKind, criticalDecision.reason);
        return;
      }

      const burstDecision = decideNarrationBurst({
        state: state.narrationState,
        timestamp,
        kind: "follow_through",
        eventType: entry.eventType ?? null,
        narrationBurstWindowMs: NARRATION_BURST_WINDOW_MS,
        recapBurstWindowMs: NARRATION_RECAP_BURST_WINDOW_MS,
        continuityCooldownMs: CONTINUITY_UPDATE_COOLDOWN_MS,
      });
      if (!burstDecision.shouldPost) {
        recordSuppression(state, entry, messageKind, `narration_${burstDecision.reason}`);
        return;
      }

      state.followThroughRecords.push(buildFollowThroughStoryRecord(evaluation));
      state.narrationState.push({ kind: "follow_through", timestamp, eventType: entry.eventType ?? null });
    }
  } else if (messageKind === "intelligent_alert") {
    const level = parseAlertLevel(entry);
    if (entry.eventType && level !== null) {
      const alertDecision = decideIntelligentAlertPost({
        records: state.intelligentAlertRecords,
        timestamp,
        eventType: entry.eventType,
        level,
        triggerPrice: parseFirstPathPrice(entry) ?? level,
        severity: entry.severity,
        score: typeof entry.score === "number" ? entry.score : undefined,
        settings,
      });
      if (!alertDecision.shouldPost) {
        recordSuppression(state, entry, messageKind, `alert_${alertDecision.reason}`);
        return;
      }

      state.intelligentAlertRecords.push(buildIntelligentAlertStoryRecord({
        timestamp,
        eventType: entry.eventType,
        level,
        triggerPrice: parseFirstPathPrice(entry) ?? level,
        severity: entry.severity,
        score: typeof entry.score === "number" ? entry.score : undefined,
      }));
    }

    const criticalDecision = decideCriticalLivePost({
      criticalPosts: state.criticalPosts,
      timestamp,
      kind: "intelligent_alert",
        eventType: entry.eventType ?? null,
        majorChange: shouldTreatAlertAsMajor(entry),
        settings,
      });
    if (!criticalDecision.shouldPost) {
      recordSuppression(state, entry, messageKind, criticalDecision.reason);
      return;
    }
  } else {
    const optionalKind = optionalKindOf(messageKind);
    if (optionalKind) {
      if (
        messageKind === "ai_signal_commentary" &&
        entry.severity !== "critical" &&
        !(
          entry.severity === "high" &&
          entry.confidence === "high" &&
          typeof entry.score === "number" &&
          entry.score >= settings.aiHighConfidenceMinScore
        ) &&
        !(typeof entry.score === "number" && entry.score >= settings.aiAlwaysPostMinScore)
      ) {
        recordSuppression(state, entry, messageKind, "ai_low_value_repeat");
        return;
      }

      const optionalDecision = decideOptionalLivePost({
        criticalPosts: state.criticalPosts,
        optionalPosts: state.optionalPosts,
        narrationAttempts: state.narrationState,
        timestamp,
        kind: optionalKind,
        majorChange: entry.continuityType === "confirmation" || entry.continuityType === "failed",
        eventType: entry.eventType ?? null,
        progressLabel: parseProgressLabel(entry.progressLabel),
        directionalReturnPct: typeof entry.directionalReturnPct === "number" ? entry.directionalReturnPct : null,
        deliveryBackoffActive: false,
        optionalDensityLimit: settings.optionalLivePostDensityLimit,
        optionalKindLimit: settings.optionalLivePostKindLimit,
        continuityCooldownMs: CONTINUITY_UPDATE_COOLDOWN_MS,
        continuityMajorTransitionCooldownMs: CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS,
        narrationBurstWindowMs: NARRATION_BURST_WINDOW_MS,
        settings,
      });
      if (!optionalDecision.shouldPost) {
        recordSuppression(state, entry, messageKind, `optional_${optionalDecision.reason}`);
        return;
      }

      const burstDecision = decideNarrationBurst({
        state: state.narrationState,
        timestamp,
        kind: optionalKind,
        eventType: entry.eventType ?? null,
        narrationBurstWindowMs: NARRATION_BURST_WINDOW_MS,
        recapBurstWindowMs: NARRATION_RECAP_BURST_WINDOW_MS,
        continuityCooldownMs: CONTINUITY_UPDATE_COOLDOWN_MS,
      });
      if (!burstDecision.shouldPost) {
        recordSuppression(state, entry, messageKind, `narration_${burstDecision.reason}`);
        return;
      }

      state.narrationState.push({ kind: optionalKind, timestamp, eventType: entry.eventType ?? null });
    }
  }

  recordSimulatedPost(state, entry, messageKind, runtimeKind);
}

export function buildLivePostReplaySimulationReport(
  auditPath: string,
  profileInput?: LiveThreadPostingProfile | string | null,
): LivePostReplaySimulationReport {
  const settings = getLiveThreadPostingPolicySettings(profileInput);
  const states = new Map<string, ReplaySymbolState>();
  const entries = readJsonLines(auditPath)
    .filter((entry) => entry.type === "discord_delivery_audit")
    .filter((entry) => entry.status === "posted")
    .filter((entry) =>
      entry.operation === "post_alert" ||
      entry.operation === "post_level_snapshot" ||
      entry.operation === "post_level_extension",
    )
    .filter((entry) => typeof entry.timestamp === "number")
    .sort((left, right) => left.timestamp! - right.timestamp!);

  for (const entry of entries) {
    const symbol = symbolOf(entry);
    const state = getState(states, symbol);
    const messageKind = messageKindOf(entry);
    state.originalPosted += 1;
    state.originalTimestamps.push(entry.timestamp!);
    increment(state.originalByKind, messageKind);
    simulateEntry(state, entry, settings);
  }

  const perSymbol = [...states.entries()]
    .map(([symbol, state]) => ({
      symbol,
      originalPosted: state.originalPosted,
      simulatedPosted: state.simulatedPosted,
      suppressed: state.suppressed,
      reductionPct: pctReduction(state.originalPosted, state.simulatedPosted),
      originalMaxPostsInFiveMinutes: maxEventsInWindow(state.originalTimestamps, 5 * 60 * 1000),
      simulatedMaxPostsInFiveMinutes: maxEventsInWindow(state.simulatedTimestamps, 5 * 60 * 1000),
      originalMaxPostsInTenMinutes: maxEventsInWindow(state.originalTimestamps, 10 * 60 * 1000),
      simulatedMaxPostsInTenMinutes: maxEventsInWindow(state.simulatedTimestamps, 10 * 60 * 1000),
      originalByKind: state.originalByKind,
      simulatedByKind: state.simulatedByKind,
      suppressedByReason: state.suppressedByReason,
      sampleSuppressions: state.sampleSuppressions,
    }))
    .sort((left, right) => right.suppressed - left.suppressed || left.symbol.localeCompare(right.symbol));

  const originalPosted = perSymbol.reduce((sum, symbol) => sum + symbol.originalPosted, 0);
  const simulatedPosted = perSymbol.reduce((sum, symbol) => sum + symbol.simulatedPosted, 0);

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    profile: settings.profile,
    totals: {
      originalPosted,
      simulatedPosted,
      suppressed: originalPosted - simulatedPosted,
      reductionPct: pctReduction(originalPosted, simulatedPosted),
      originalMaxPostsInFiveMinutes: Math.max(0, ...perSymbol.map((symbol) => symbol.originalMaxPostsInFiveMinutes)),
      simulatedMaxPostsInFiveMinutes: Math.max(0, ...perSymbol.map((symbol) => symbol.simulatedMaxPostsInFiveMinutes)),
      originalMaxPostsInTenMinutes: Math.max(0, ...perSymbol.map((symbol) => symbol.originalMaxPostsInTenMinutes)),
      simulatedMaxPostsInTenMinutes: Math.max(0, ...perSymbol.map((symbol) => symbol.simulatedMaxPostsInTenMinutes)),
    },
    perSymbol,
  };
}

export function buildLivePostProfileComparisonReport(auditPath: string): LivePostProfileComparisonReport {
  const profiles: LiveThreadPostingProfile[] = ["quiet", "balanced", "active"];
  const reports = profiles.map((profile) => buildLivePostReplaySimulationReport(auditPath, profile));
  const symbolNames = new Set<string>();
  for (const report of reports) {
    for (const symbol of report.perSymbol) {
      symbolNames.add(symbol.symbol);
    }
  }

  const symbolRows = [...symbolNames].map((symbol) => {
    const byProfile = Object.fromEntries(
      reports.map((report) => [
        report.profile,
        report.perSymbol.find((item) => item.symbol === symbol),
      ]),
    ) as Record<LiveThreadPostingProfile, LivePostReplaySimulationReport["perSymbol"][number] | undefined>;
    const originalPosted =
      byProfile.balanced?.originalPosted ?? byProfile.quiet?.originalPosted ?? byProfile.active?.originalPosted ?? 0;
    return {
      symbol,
      originalPosted,
      quiet: byProfile.quiet?.simulatedPosted ?? 0,
      balanced: byProfile.balanced?.simulatedPosted ?? 0,
      active: byProfile.active?.simulatedPosted ?? 0,
    };
  }).sort((left, right) => right.originalPosted - left.originalPosted || left.symbol.localeCompare(right.symbol));

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    profiles: reports.map((report) => ({
      profile: report.profile,
      originalPosted: report.totals.originalPosted,
      simulatedPosted: report.totals.simulatedPosted,
      suppressed: report.totals.suppressed,
      reductionPct: report.totals.reductionPct,
      maxPostsInFiveMinutes: report.totals.simulatedMaxPostsInFiveMinutes,
      maxPostsInTenMinutes: report.totals.simulatedMaxPostsInTenMinutes,
    })),
    topSymbols: symbolRows.slice(0, 20),
  };
}

function parseAllPrices(text: string): number[] {
  const prices: number[] = [];
  const matches = text.matchAll(/\b\d+(?:\.\d+)?\b/g);
  for (const match of matches) {
    const endIndex = (match.index ?? 0) + match[0].length;
    if (text.slice(endIndex).trimStart().startsWith("%")) {
      continue;
    }
    const value = Number(match[0]);
    if (Number.isFinite(value) && value > 0 && value < 10000) {
      prices.push(value);
    }
  }
  return prices;
}

function priceFromEntry(entry: ReplayAuditEntry): number | null {
  const text = entry.body ?? entry.bodyPreview ?? "";
  const priceMatch = text.match(/\bPrice:\s*(\d+(?:\.\d+)?)/i);
  if (priceMatch?.[1]) {
    return Number(priceMatch[1]);
  }

  const triggerMatch = text.match(/\b(?:Trigger|Triggered near):\s*(\d+(?:\.\d+)?)/i);
  if (triggerMatch?.[1]) {
    return Number(triggerMatch[1]);
  }

  return parseFirstPathPrice(entry);
}

function parseOutcomePathPrice(entry: ReplayAuditEntry): number | null {
  const text = entry.body ?? entry.bodyPreview ?? "";
  const match = text.match(/->\s*(\d+(?:\.\d+)?)/i);
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function sideForEntry(entry: ReplayAuditEntry): "support" | "resistance" | null {
  const text = `${entry.title ?? ""} ${entry.body ?? entry.bodyPreview ?? ""}`.toLowerCase();
  if (
    entry.eventType === "breakout" ||
    entry.eventType === "reclaim" ||
    text.includes("resistance") ||
    text.includes("breakout")
  ) {
    return "resistance";
  }
  if (entry.eventType === "breakdown" || text.includes("support") || text.includes("breakdown")) {
    return "support";
  }
  return null;
}

function storyKeyForQuality(entry: ReplayAuditEntry): string {
  const kind = messageKindOf(entry);
  const level = parseAlertLevel(entry);
  return [
    kind,
    entry.eventType ?? "unknown",
    entry.followThroughLabel ?? entry.continuityType ?? entry.progressLabel ?? "unknown",
    level === null ? "unknown" : level >= 1 ? level.toFixed(2) : level.toFixed(4),
  ].join("|");
}

function classifyPostQuality(
  entry: ReplayAuditEntry,
  storyCounts: Map<string, number>,
): ClassifiedPostQuality {
  const kind = messageKindOf(entry);
  const storyKey = storyKeyForQuality(entry);
  const storyCount = (storyCounts.get(storyKey) ?? 0) + 1;
  storyCounts.set(storyKey, storyCount);

  if (kind === "level_snapshot" || kind === "level_extension") {
    return { category: "helpfulContext", reason: "level map context" };
  }

  if (kind === "intelligent_alert" || kind === "level_clear_update") {
    if (
      entry.eventType === "breakout" ||
      entry.eventType === "breakdown" ||
      entry.eventType === "reclaim" ||
      entry.severity === "critical" ||
      entry.severity === "high"
    ) {
      return { category: "traderCritical", reason: "level decision event" };
    }
    return { category: "helpfulContext", reason: "setup context" };
  }

  if (kind === "follow_through_update") {
    const move = Math.abs(entry.directionalReturnPct ?? entry.rawReturnPct ?? 0);
    if (entry.followThroughLabel === "failed" || entry.followThroughLabel === "strong" || move >= 1) {
      return { category: "traderCritical", reason: "meaningful follow-through state change" };
    }
    if (storyCount >= 3 || move < 0.75) {
      return { category: "noisyRepeat", reason: "small or repeated follow-through update" };
    }
    return { category: "helpfulContext", reason: "follow-through context" };
  }

  if (kind === "continuity_update" || kind === "follow_through_state_update") {
    if (entry.continuityType === "confirmation" || entry.continuityType === "failed") {
      return { category: "helpfulContext", reason: "major continuity transition" };
    }
    return { category: "noisyRepeat", reason: "minor continuity narration" };
  }

  if (kind === "ai_signal_commentary" || kind === "symbol_recap") {
    return { category: "helpfulContext", reason: "summary commentary" };
  }

  return { category: "unknown", reason: "unclassified post kind" };
}

function parseSnapshotLevels(entry: ReplayAuditEntry, side: "support" | "resistance"): number[] {
  const text = entry.body ?? entry.bodyPreview ?? "";
  const prefix = side === "support" ? "Support" : "Resistance";
  const levels = new Set<number>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().toLowerCase().startsWith(prefix.toLowerCase())) {
      continue;
    }
    for (const match of line.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
      const value = Number(match[0]);
      if (Number.isFinite(value) && value > 0 && value < 1000) {
        levels.add(value);
      }
    }
  }
  return [...levels].sort((left, right) => left - right);
}

function buildPricePoints(symbolEntries: ReplayAuditEntry[]): PricePoint[] {
  const points: PricePoint[] = [];
  for (const entry of symbolEntries) {
    const timestamp = entry.timestamp ?? 0;
    const primary = priceFromEntry(entry);
    if (primary !== null && Number.isFinite(primary)) {
      points.push({ timestamp, price: primary });
    }
    const outcome = parseOutcomePathPrice(entry);
    if (outcome !== null && Number.isFinite(outcome)) {
      points.push({ timestamp: timestamp + 1, price: outcome });
    }
  }
  return points.sort((left, right) => left.timestamp - right.timestamp);
}

function hasNearbyPostedLevelEvent(params: {
  entries: ReplayAuditEntry[];
  timestamp: number;
  side: "support" | "resistance";
  level: number;
}): boolean {
  const windowMs = 3 * 60 * 1000;
  const tolerance = Math.max(0.01, params.level * 0.0125);
  return params.entries.some((entry) => {
    if (Math.abs((entry.timestamp ?? 0) - params.timestamp) > windowMs) {
      return false;
    }
    const kind = messageKindOf(entry);
    if (kind !== "intelligent_alert" && kind !== "level_clear_update") {
      return false;
    }
    if (sideForEntry(entry) !== params.side) {
      return false;
    }
    const level = parseAlertLevel(entry);
    return level !== null && Math.abs(level - params.level) <= tolerance;
  });
}

function buildMissingEventCandidates(
  symbolEntries: ReplayAuditEntry[],
  pricePoints: PricePoint[],
): RunnerStoryReport["symbols"][number]["missingEventCandidates"] {
  const supportLevels = new Set<number>();
  const resistanceLevels = new Set<number>();
  for (const entry of symbolEntries) {
    for (const level of parseSnapshotLevels(entry, "support")) {
      supportLevels.add(level);
    }
    for (const level of parseSnapshotLevels(entry, "resistance")) {
      resistanceLevels.add(level);
    }
    const alertLevel = parseAlertLevel(entry);
    const side = sideForEntry(entry);
    if (alertLevel !== null && side === "support") {
      supportLevels.add(alertLevel);
    } else if (alertLevel !== null && side === "resistance") {
      resistanceLevels.add(alertLevel);
    }
  }

  const candidates: RunnerStoryReport["symbols"][number]["missingEventCandidates"] = [];
  const seen = new Set<string>();
  for (let index = 1; index < pricePoints.length; index += 1) {
    const previous = pricePoints[index - 1]!;
    const current = pricePoints[index]!;
    if (current.price > previous.price) {
      for (const level of resistanceLevels) {
        if (
          previous.price < level &&
          current.price >= level &&
          !hasNearbyPostedLevelEvent({ entries: symbolEntries, timestamp: current.timestamp, side: "resistance", level })
        ) {
          const key = `resistance|${level >= 1 ? level.toFixed(2) : level.toFixed(4)}`;
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({
              timestamp: current.timestamp,
              side: "resistance",
              level,
              fromPrice: previous.price,
              toPrice: current.price,
              reason: "price sample crossed a known resistance without a nearby clear/breakout post",
            });
          }
        }
      }
    } else if (current.price < previous.price) {
      for (const level of supportLevels) {
        if (
          previous.price > level &&
          current.price <= level &&
          !hasNearbyPostedLevelEvent({ entries: symbolEntries, timestamp: current.timestamp, side: "support", level })
        ) {
          const key = `support|${level >= 1 ? level.toFixed(2) : level.toFixed(4)}`;
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({
              timestamp: current.timestamp,
              side: "support",
              level,
              fromPrice: previous.price,
              toPrice: current.price,
              reason: "price sample crossed a known support without a nearby lost-support/breakdown post",
            });
          }
        }
      }
    }
  }
  return candidates.slice(0, 20);
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function buildTraderStory(params: {
  symbol: string;
  firstPrice: number | null;
  lastPrice: number | null;
  lowPrice: number | null;
  highPrice: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
  keyEvents: RunnerStoryReport["symbols"][number]["keyEvents"];
}): string[] {
  const lines: string[] = [];
  const referencePrice = params.lastPrice ?? params.firstPrice;
  lines.push(
    `${params.symbol} moved from ${formatPrice(params.firstPrice)} to ${formatPrice(params.lastPrice)} with a logged range of ${formatPrice(params.lowPrice)}-${formatPrice(params.highPrice)}.`,
  );
  const nearestSupport = referencePrice === null
    ? params.supportLevels[0]
    : params.supportLevels.filter((level) => level <= referencePrice).sort((left, right) => right - left)[0];
  const nearestResistance = referencePrice === null
    ? params.resistanceLevels[0]
    : params.resistanceLevels.filter((level) => level >= referencePrice).sort((left, right) => left - right)[0];
  if (nearestSupport !== undefined || nearestResistance !== undefined) {
    lines.push(
      `Most relevant logged map: support ${nearestSupport === undefined ? "n/a" : formatPrice(nearestSupport)}, resistance ${nearestResistance === undefined ? "n/a" : formatPrice(nearestResistance)}.`,
    );
  }
  const importantEvents = params.keyEvents
    .filter((event) =>
      event.eventType === "breakout" ||
      event.eventType === "breakdown" ||
      event.messageKind === "level_clear_update" ||
      event.messageKind === "level_snapshot",
    )
    .slice(0, 5)
    .map((event) => event.title || `${event.messageKind} ${event.eventType ?? ""}`.trim())
    .filter(Boolean);
  if (importantEvents.length > 0) {
    lines.push(`Main posted events: ${importantEvents.join("; ")}.`);
  }
  return lines;
}

function buildTuningSuggestions(params: {
  qualitySummary: RunnerStoryReport["symbols"][number]["qualitySummary"];
  missingEventCandidates: RunnerStoryReport["symbols"][number]["missingEventCandidates"];
  postCount: number;
  byKind: Record<string, number>;
}): string[] {
  const suggestions: string[] = [];
  if (params.qualitySummary.noisyRepeat >= 5) {
    suggestions.push("tighten follow-through and continuity repeats for this kind of runner day");
  }
  if (params.missingEventCandidates.some((candidate) => candidate.side === "resistance")) {
    suggestions.push("review resistance-cleared detection; at least one logged price sample crossed resistance without a nearby post");
  }
  if (params.missingEventCandidates.some((candidate) => candidate.side === "support")) {
    suggestions.push("review support-lost detection; at least one logged price sample crossed support without a nearby post");
  }
  const optionalPosts =
    (params.byKind.continuity_update ?? 0) +
    (params.byKind.follow_through_state_update ?? 0) +
    (params.byKind.ai_signal_commentary ?? 0);
  if (params.postCount > 0 && optionalPosts / params.postCount > 0.35) {
    suggestions.push("optional narration is a large share of the thread; require stronger state change before posting");
  }
  if (suggestions.length === 0) {
    suggestions.push("no obvious quality issue stood out from the saved posts");
  }
  return suggestions;
}

export function buildRunnerStoryReport(auditPath: string, symbolsInput?: string[]): RunnerStoryReport {
  const requested = new Set((symbolsInput ?? []).map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const entries = readJsonLines(auditPath)
    .filter((entry) => entry.type === "discord_delivery_audit")
    .filter((entry) => entry.status === "posted")
    .filter((entry) =>
      entry.operation === "post_alert" ||
      entry.operation === "post_level_snapshot" ||
      entry.operation === "post_level_extension",
    )
    .filter((entry) => typeof entry.timestamp === "number")
    .filter((entry) => requested.size === 0 || requested.has(symbolOf(entry)))
    .sort((left, right) => left.timestamp! - right.timestamp!);

  const grouped = new Map<string, ReplayAuditEntry[]>();
  for (const entry of entries) {
    const symbol = symbolOf(entry);
    grouped.set(symbol, [...(grouped.get(symbol) ?? []), entry]);
  }

  const symbols = [...grouped.entries()].map(([symbol, symbolEntries]) => {
    const byKind: Record<string, number> = {};
    const levelCounts = new Map<string, { price: number; count: number }>();
    const supportLevels = new Set<number>();
    const resistanceLevels = new Set<number>();
    const storyCounts = new Map<string, number>();
    const qualitySummary: RunnerStoryReport["symbols"][number]["qualitySummary"] = {
      traderCritical: 0,
      helpfulContext: 0,
      noisyRepeat: 0,
      operatorOnly: 0,
      unknown: 0,
    };
    const noisyPostSamples: RunnerStoryReport["symbols"][number]["noisyPostSamples"] = [];
    const keyEvents: RunnerStoryReport["symbols"][number]["keyEvents"] = [];

    for (const entry of symbolEntries) {
      const kind = messageKindOf(entry);
      increment(byKind, kind);
      const quality = classifyPostQuality(entry, storyCounts);
      qualitySummary[quality.category] += 1;
      if (quality.category === "noisyRepeat" && noisyPostSamples.length < 12) {
        noisyPostSamples.push({
          timestamp: entry.timestamp!,
          messageKind: kind,
          reason: quality.reason,
          title: entry.title,
        });
      }

      for (const level of parseAllPrices(`${entry.title ?? ""} ${entry.body ?? ""}`)) {
        const key = level >= 1 ? level.toFixed(2) : level.toFixed(4);
        const existing = levelCounts.get(key);
        levelCounts.set(key, { price: level, count: (existing?.count ?? 0) + 1 });
      }
      for (const level of parseSnapshotLevels(entry, "support")) {
        supportLevels.add(level);
      }
      for (const level of parseSnapshotLevels(entry, "resistance")) {
        resistanceLevels.add(level);
      }
      const alertLevel = parseAlertLevel(entry);
      const side = sideForEntry(entry);
      if (alertLevel !== null && side === "support") {
        supportLevels.add(alertLevel);
      } else if (alertLevel !== null && side === "resistance") {
        resistanceLevels.add(alertLevel);
      }

      if (
        kind === "intelligent_alert" ||
        kind === "level_clear_update" ||
        kind === "level_snapshot" ||
        kind === "level_extension"
      ) {
        keyEvents.push({
          timestamp: entry.timestamp!,
          messageKind: kind,
          eventType: entry.eventType,
          title: entry.title,
          price: priceFromEntry(entry),
          level: parseAlertLevel(entry),
        });
      }
    }

    const sortedPrices = buildPricePoints(symbolEntries);
    const priceValues = sortedPrices.map((item) => item.price);
    const firstPrice = sortedPrices[0]?.price ?? null;
    const lastPrice = sortedPrices.at(-1)?.price ?? null;
    const lowPrice = priceValues.length ? Math.min(...priceValues) : null;
    const highPrice = priceValues.length ? Math.max(...priceValues) : null;
    const sortedSupportLevels = [...supportLevels].sort((left, right) => right - left);
    const sortedResistanceLevels = [...resistanceLevels].sort((left, right) => left - right);
    const missingEventCandidates = buildMissingEventCandidates(symbolEntries, sortedPrices);
    return {
      symbol,
      firstTimestamp: symbolEntries[0]?.timestamp ?? 0,
      lastTimestamp: symbolEntries.at(-1)?.timestamp ?? 0,
      postCount: symbolEntries.length,
      firstPrice,
      lastPrice,
      lowPrice,
      highPrice,
      byKind,
      levelsMentioned: [...levelCounts.values()]
        .sort((left, right) => right.count - left.count || left.price - right.price)
        .slice(0, 20),
      qualitySummary,
      traderStory: buildTraderStory({
        symbol,
        firstPrice,
        lastPrice,
        lowPrice,
        highPrice,
        supportLevels: sortedSupportLevels,
        resistanceLevels: sortedResistanceLevels,
        keyEvents,
      }),
      missingEventCandidates,
      noisyPostSamples,
      tuningSuggestions: buildTuningSuggestions({
        qualitySummary,
        missingEventCandidates,
        postCount: symbolEntries.length,
        byKind,
      }),
      keyEvents: keyEvents.slice(0, 80),
    };
  }).sort((left, right) => right.postCount - left.postCount || left.symbol.localeCompare(right.symbol));

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    symbols,
  };
}

export function formatLivePostReplaySimulationMarkdown(report: LivePostReplaySimulationReport): string {
  const lines: string[] = [
    "# Live Post Replay Simulation",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    `Profile: ${report.profile}`,
    "",
    "## Summary",
    "",
    `- original posts: ${report.totals.originalPosted}`,
    `- simulated posts: ${report.totals.simulatedPosted}`,
    `- suppressed: ${report.totals.suppressed} (${report.totals.reductionPct}%)`,
    `- max burst 5m: ${report.totals.originalMaxPostsInFiveMinutes} -> ${report.totals.simulatedMaxPostsInFiveMinutes}`,
    `- max burst 10m: ${report.totals.originalMaxPostsInTenMinutes} -> ${report.totals.simulatedMaxPostsInTenMinutes}`,
    "",
    "## Symbols",
    "",
  ];

  for (const symbol of report.perSymbol.filter((item) => item.suppressed > 0).slice(0, 12)) {
    lines.push(
      `### ${symbol.symbol}`,
      "",
      `- posts: ${symbol.originalPosted} -> ${symbol.simulatedPosted} (${symbol.reductionPct}% reduction)`,
      `- max burst 5m: ${symbol.originalMaxPostsInFiveMinutes} -> ${symbol.simulatedMaxPostsInFiveMinutes}`,
      `- max burst 10m: ${symbol.originalMaxPostsInTenMinutes} -> ${symbol.simulatedMaxPostsInTenMinutes}`,
      `- suppressed by reason: ${JSON.stringify(symbol.suppressedByReason)}`,
      `- original by kind: ${JSON.stringify(symbol.originalByKind)}`,
      `- simulated by kind: ${JSON.stringify(symbol.simulatedByKind)}`,
    );

    if (symbol.sampleSuppressions.length > 0) {
      lines.push("- sample suppressions:");
      for (const suppression of symbol.sampleSuppressions) {
        lines.push(
          `  - ${new Date(suppression.timestamp).toISOString()} ${suppression.messageKind}: ${suppression.reason}${suppression.title ? ` (${suppression.title})` : ""}`,
        );
      }
    }
    lines.push("");
  }

  if (report.perSymbol.every((symbol) => symbol.suppressed === 0)) {
    lines.push("- No posts would have been suppressed by the simulated rules.", "");
  }

  return lines.join("\n");
}

export function formatLivePostProfileComparisonMarkdown(report: LivePostProfileComparisonReport): string {
  const lines = [
    "# Live Post Profile Comparison",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Profiles",
    "",
    "| Profile | Original | Simulated | Suppressed | Reduction | Max 5m | Max 10m |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...report.profiles.map((profile) =>
      `| ${profile.profile} | ${profile.originalPosted} | ${profile.simulatedPosted} | ${profile.suppressed} | ${profile.reductionPct}% | ${profile.maxPostsInFiveMinutes} | ${profile.maxPostsInTenMinutes} |`,
    ),
    "",
    "## Top Symbols",
    "",
    "| Symbol | Original | Quiet | Balanced | Active |",
    "|---|---:|---:|---:|---:|",
    ...report.topSymbols.map((symbol) =>
      `| ${symbol.symbol} | ${symbol.originalPosted} | ${symbol.quiet} | ${symbol.balanced} | ${symbol.active} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

export function formatRunnerStoryMarkdown(report: RunnerStoryReport): string {
  const lines: string[] = [
    "# Runner Story Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
  ];

  for (const symbol of report.symbols.slice(0, 12)) {
    lines.push(
      `## ${symbol.symbol}`,
      "",
      `- posts: ${symbol.postCount}`,
      `- time: ${new Date(symbol.firstTimestamp).toISOString()} -> ${new Date(symbol.lastTimestamp).toISOString()}`,
      `- price path: ${symbol.firstPrice ?? "n/a"} -> ${symbol.lastPrice ?? "n/a"} | low ${symbol.lowPrice ?? "n/a"} | high ${symbol.highPrice ?? "n/a"}`,
      `- by kind: ${JSON.stringify(symbol.byKind)}`,
      `- quality: ${symbol.qualitySummary.traderCritical} critical / ${symbol.qualitySummary.helpfulContext} helpful / ${symbol.qualitySummary.noisyRepeat} noisy-repeat / ${symbol.qualitySummary.unknown} unknown`,
      `- most-mentioned levels: ${symbol.levelsMentioned.map((level) => `${level.price} (${level.count})`).join(", ") || "n/a"}`,
      "",
      "### Trader Story",
      "",
      ...symbol.traderStory.map((line) => `- ${line}`),
      "",
      "### Tuning Suggestions",
      "",
      ...symbol.tuningSuggestions.map((suggestion) => `- ${suggestion}`),
      "",
      "### Missing Event Candidates",
      "",
    );

    if (symbol.missingEventCandidates.length === 0) {
      lines.push("- none detected from saved post price samples");
    } else {
      for (const candidate of symbol.missingEventCandidates.slice(0, 12)) {
        lines.push(
          `- ${new Date(candidate.timestamp).toISOString()} ${candidate.side} ${formatPrice(candidate.level)} crossed ${formatPrice(candidate.fromPrice)} -> ${formatPrice(candidate.toPrice)}: ${candidate.reason}`,
        );
      }
    }

    lines.push(
      "",
      "### Noisy Post Samples",
      "",
    );
    if (symbol.noisyPostSamples.length === 0) {
      lines.push("- none flagged");
    } else {
      for (const sample of symbol.noisyPostSamples.slice(0, 8)) {
        lines.push(
          `- ${new Date(sample.timestamp).toISOString()} ${sample.messageKind}: ${sample.reason}${sample.title ? ` (${sample.title})` : ""}`,
        );
      }
    }

    lines.push(
      "",
      "### Key Events",
      "",
    );

    for (const event of symbol.keyEvents.slice(0, 30)) {
      const parts = [
        new Date(event.timestamp).toISOString(),
        event.messageKind,
        event.eventType ?? "n/a",
        event.title ?? "",
        event.price !== null && event.price !== undefined ? `price ${event.price}` : "",
        event.level !== null && event.level !== undefined ? `level ${event.level}` : "",
      ].filter(Boolean);
      lines.push(`- ${parts.join(" | ")}`);
    }
    lines.push("");
  }

  if (report.symbols.length === 0) {
    lines.push("- No runner story rows were available.", "");
  }

  return lines.join("\n");
}

export function writeLivePostReplaySimulationReports(params: {
  jsonPath: string;
  markdownPath: string;
  report: LivePostReplaySimulationReport;
}): void {
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.markdownPath, `${formatLivePostReplaySimulationMarkdown(params.report)}\n`, "utf8");
}

export function writeLivePostProfileComparisonReports(params: {
  jsonPath: string;
  markdownPath: string;
  report: LivePostProfileComparisonReport;
}): void {
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.markdownPath, `${formatLivePostProfileComparisonMarkdown(params.report)}\n`, "utf8");
}

export function writeRunnerStoryReports(params: {
  jsonPath: string;
  markdownPath: string;
  report: RunnerStoryReport;
}): void {
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.markdownPath, `${formatRunnerStoryMarkdown(params.report)}\n`, "utf8");
}
