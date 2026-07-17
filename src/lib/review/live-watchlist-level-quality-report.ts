import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  LiveWatchlistCardContent,
  LiveWatchlistLevelMap,
  LiveWatchlistLevelMapLevel,
  LiveWatchlistMarketDataStatus,
} from "../live-watchlist/live-watchlist-types.js";

type WatchlistQualitySymbolState = {
  symbol: string;
  status?: string;
  updatedAt?: number;
  latestPrice?: number | null;
  nearestSupport?: number | null;
  nearestResistance?: number | null;
  nearestSupportLabel?: string | null;
  nearestResistanceLabel?: string | null;
  latestTraderReadHeadline?: string | null;
  levelMap?: LiveWatchlistLevelMap | null;
  cards?: Partial<Record<string, LiveWatchlistCardContent | null>>;
};

function isArchivedInactiveSymbol(symbol: WatchlistQualitySymbolState): boolean {
  return symbol.status === "deactivated" || symbol.status === "stale";
}

export type WatchlistQualityStatePayload = {
  generatedAt?: number;
  marketDataStatus?: LiveWatchlistMarketDataStatus | string;
  marketDataUpdatedAt?: number | null;
  symbols: WatchlistQualitySymbolState[];
};

export type LiveWatchlistLevelQualityFindingKind =
  | "missing_level_map"
  | "same_boundary_both_sides"
  | "nearest_label_mismatch"
  | "label_vocabulary_mismatch"
  | "stronger_nearby_hidden"
  | "strong_structural_anchor_hidden"
  | "weak_ladder_before_structural_anchor";

export type LiveWatchlistLevelQualityFinding = {
  kind: LiveWatchlistLevelQualityFindingKind;
  severity: "major" | "watch" | "info";
  symbol: string;
  side?: "support" | "resistance";
  price?: number;
  score: number;
  summary: string;
  evidence: string[];
};

export type LiveWatchlistLevelQualityReport = {
  generatedAt: string;
  source: string;
  marketDataStatus: string | null;
  totals: {
    symbols: number;
    liveSymbols: number;
    deactivatedSymbols: number;
    symbolsWithLevelMap: number;
    findings: number;
    majorFindings: number;
    watchFindings: number;
    infoFindings: number;
  };
  findings: LiveWatchlistLevelQualityFinding[];
};

export type WriteLiveWatchlistLevelQualityReportOptions = {
  payload: WatchlistQualityStatePayload;
  source: string;
  outputDirectory: string;
  maxFindings?: number;
};

type ParsedLadderLevel = {
  side: "support" | "resistance";
  price: number;
  distancePct: number | null;
  strengthLabel?: "weak" | "moderate" | "strong" | "major";
  sourceLabel?: string | null;
  line: string;
};

const NEAR_STACK_DISTANCE_PCT = 0.02;
const OUTER_ANCHOR_MIN_DISTANCE_PCT = 0.25;
const OUTER_ANCHOR_MAX_DISTANCE_PCT = 0.45;

function formatPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function normalizeStrengthLabel(value: string | null | undefined): ParsedLadderLevel["strengthLabel"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "major") return "major";
  if (normalized === "strong" || normalized === "heavy") return "strong";
  if (normalized === "moderate") return "moderate";
  if (normalized === "weak" || normalized === "light") return "weak";
  return undefined;
}

function strengthRank(value: string | null | undefined): number {
  const normalized = normalizeStrengthLabel(value);
  if (normalized === "major") return 4;
  if (normalized === "strong") return 3;
  if (normalized === "moderate") return 2;
  if (normalized === "weak") return 1;
  return 0;
}

function sourceRank(value: string | null | undefined): number {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("daily") && normalized.includes("confluence")) return 5;
  if (normalized.includes("daily")) return 4;
  if (normalized.includes("4h") && normalized.includes("confluence")) return 3;
  if (normalized.includes("4h")) return 2;
  if (normalized.includes("intraday") || normalized.includes("5m")) return 1;
  return 0;
}

function qualityRank(level: Pick<LiveWatchlistLevelMapLevel, "strengthLabel" | "sourceLabel">): number {
  return strengthRank(level.strengthLabel) * 10 + sourceRank(level.sourceLabel);
}

function isStructuralSource(value: string | null | undefined): boolean {
  return sourceRank(value) >= sourceRank("4h structure");
}

function isStrongStructuralLevel(level: Pick<LiveWatchlistLevelMapLevel, "strengthLabel" | "sourceLabel">): boolean {
  return strengthRank(level.strengthLabel) >= strengthRank("strong") && isStructuralSource(level.sourceLabel);
}

function samePrice(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(Math.max(Math.abs(left), Math.abs(right)) * 0.001, 0.0001);
}

function relativeDistancePct(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(Math.max(Math.abs(left), Math.abs(right)), 0.0001);
}

function visibleLevels(levelMap: LiveWatchlistLevelMap, side: "support" | "resistance"): LiveWatchlistLevelMapLevel[] {
  return side === "support" ? levelMap.supportLevels : levelMap.resistanceLevels;
}

function parseFullLadderLevels(card: LiveWatchlistCardContent | null | undefined): ParsedLadderLevel[] {
  if (!card?.body) {
    return [];
  }

  const levels: ParsedLadderLevel[] = [];
  let side: "support" | "resistance" | null = null;
  for (const rawLine of card.body.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (/^resistance:?$/i.test(line)) {
      side = "resistance";
      continue;
    }
    if (/^support:?$/i.test(line)) {
      side = "support";
      continue;
    }
    if (!side || !line || /^none$/i.test(line)) {
      continue;
    }

    const match = line.match(
      /^([0-9]*\.?[0-9]+)(?:\s*-\s*([0-9]*\.?[0-9]+))?\s*\(([-+]?[0-9.]+)%?,\s*([^,)]+)(?:,\s*([^)]+))?\)/i,
    );
    if (!match?.[1]) {
      continue;
    }
    const first = Number(match[1]);
    const second = match[2] === undefined ? first : Number(match[2]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      continue;
    }
    const price = (first + second) / 2;
    const distancePct = match[3] === undefined ? null : Number(match[3]) / 100;
    levels.push({
      side,
      price,
      distancePct: Number.isFinite(distancePct) ? distancePct : null,
      strengthLabel: normalizeStrengthLabel(match[4]),
      sourceLabel: match[5]?.trim() ?? null,
      line,
    });
  }
  return levels;
}

function heavyEvidenceSnippet(value: string): string {
  const match = /\bheavy\b/i.exec(value);
  if (!match) {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }
  const start = Math.max(match.index - 80, 0);
  const end = Math.min(match.index + 100, value.length);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < value.length ? "..." : "";
  return `${prefix}${value.slice(start, end)}${suffix}`;
}

function fullLadderLevelsForSide(
  symbol: WatchlistQualitySymbolState,
  side: "support" | "resistance",
): ParsedLadderLevel[] {
  return parseFullLadderLevels(symbol.cards?.fullLadder).filter((level) => level.side === side);
}

function isVisiblePrice(
  visible: LiveWatchlistLevelMapLevel[],
  price: number,
): boolean {
  return visible.some((level) => samePrice(level.price, price));
}

function sameBoundaryFindings(
  symbol: WatchlistQualitySymbolState,
  levelMap: LiveWatchlistLevelMap,
): LiveWatchlistLevelQualityFinding[] {
  const findings: LiveWatchlistLevelQualityFinding[] = [];
  for (const support of levelMap.supportLevels) {
    for (const resistance of levelMap.resistanceLevels) {
      if (!samePrice(support.price, resistance.price)) {
        continue;
      }
      const nearestDuplicate =
        samePrice(levelMap.nearestSupport?.price ?? Number.NaN, support.price) ||
        samePrice(levelMap.nearestResistance?.price ?? Number.NaN, resistance.price);
      findings.push({
        kind: "same_boundary_both_sides",
        severity: nearestDuplicate ? "major" : "watch",
        symbol: symbol.symbol,
        price: support.price,
        score: nearestDuplicate ? 90 : 70,
        summary: `${symbol.symbol} shows ${formatPrice(support.price)} as both support and resistance on the visible card.`,
        evidence: [
          `Support label: ${support.label}.`,
          `Resistance label: ${resistance.label}.`,
          "Trader read: the card should assign one side based on current price, not show the same boundary twice.",
        ],
      });
    }
  }
  return findings;
}

function nearestLabelMismatchFindings(
  symbol: WatchlistQualitySymbolState,
  levelMap: LiveWatchlistLevelMap,
): LiveWatchlistLevelQualityFinding[] {
  const findings: LiveWatchlistLevelQualityFinding[] = [];
  const checks: Array<{
    side: "support" | "resistance";
    nearest: LiveWatchlistLevelMapLevel | null;
    statePrice: number | null | undefined;
    stateLabel: string | null | undefined;
  }> = [
    {
      side: "support",
      nearest: levelMap.nearestSupport,
      statePrice: symbol.nearestSupport,
      stateLabel: symbol.nearestSupportLabel,
    },
    {
      side: "resistance",
      nearest: levelMap.nearestResistance,
      statePrice: symbol.nearestResistance,
      stateLabel: symbol.nearestResistanceLabel,
    },
  ];

  for (const check of checks) {
    if (!check.nearest || typeof check.statePrice !== "number") {
      continue;
    }
    if (samePrice(check.nearest.price, check.statePrice)) {
      continue;
    }
    findings.push({
      kind: "nearest_label_mismatch",
      severity: "major",
      symbol: symbol.symbol,
      side: check.side,
      price: check.nearest.price,
      score: 80,
      summary: `${symbol.symbol} nearest ${check.side} state does not match the visible level map.`,
      evidence: [
        `State nearest ${check.side}: ${formatPrice(check.statePrice)} (${check.stateLabel ?? "no label"}).`,
        `Level map nearest ${check.side}: ${check.nearest.label}.`,
      ],
    });
  }
  return findings;
}

function labelVocabularyFindings(
  symbol: WatchlistQualitySymbolState,
  levelMap: LiveWatchlistLevelMap,
): LiveWatchlistLevelQualityFinding[] {
  const labels: string[] = [
    symbol.nearestSupportLabel,
    symbol.nearestResistanceLabel,
    symbol.latestTraderReadHeadline,
    ...levelMap.supportLevels.map((level) => level.label),
    ...levelMap.resistanceLevels.map((level) => level.label),
  ].filter((value): value is string => Boolean(value));
  for (const [cardKey, card] of Object.entries(symbol.cards ?? {})) {
    if (card?.title) {
      labels.push(`${cardKey} title: ${card.title}`);
    }
    if (card?.body) {
      labels.push(`${cardKey} body: ${card.body}`);
    }
  }
  const heavyLabels = labels
    .filter((label) => /\bheavy\b/i.test(label))
    .map(heavyEvidenceSnippet);
  if (heavyLabels.length === 0) {
    return [];
  }
  return [{
    kind: "label_vocabulary_mismatch",
    severity: "watch",
    symbol: symbol.symbol,
    score: 55,
    summary: `${symbol.symbol} visible website card still mixes 'heavy' into strength labels.`,
    evidence: heavyLabels.slice(0, 4),
  }];
}

function strongerNearbyHiddenFindings(
  symbol: WatchlistQualitySymbolState,
  levelMap: LiveWatchlistLevelMap,
  side: "support" | "resistance",
): LiveWatchlistLevelQualityFinding[] {
  const visible = visibleLevels(levelMap, side);
  const full = fullLadderLevelsForSide(symbol, side);
  const findings: LiveWatchlistLevelQualityFinding[] = [];

  for (const visibleLevel of visible) {
    if (strengthRank(visibleLevel.strengthLabel) > strengthRank("moderate")) {
      continue;
    }
    const hiddenBetter = full
      .filter((candidate) => !isVisiblePrice(visible, candidate.price))
      .filter((candidate) => relativeDistancePct(candidate.price, visibleLevel.price) <= NEAR_STACK_DISTANCE_PCT)
      .filter((candidate) => isStrongStructuralLevel(candidate))
      .filter((candidate) => qualityRank(candidate) > qualityRank(visibleLevel))
      .sort((left, right) => qualityRank(right) - qualityRank(left))[0];
    if (!hiddenBetter) {
      continue;
    }
    findings.push({
      kind: "stronger_nearby_hidden",
      severity: "major",
      symbol: symbol.symbol,
      side,
      price: hiddenBetter.price,
      score: 86,
      summary: `${symbol.symbol} shows weaker ${side} ${formatPrice(visibleLevel.price)} while stronger nearby ${formatPrice(hiddenBetter.price)} is hidden.`,
      evidence: [
        `Visible: ${visibleLevel.label}.`,
        `Hidden full-ladder line: ${hiddenBetter.line}.`,
        `Distance between levels: ${(relativeDistancePct(hiddenBetter.price, visibleLevel.price) * 100).toFixed(1)}%.`,
      ],
    });
  }

  return findings;
}

function structuralAnchorHiddenFindings(
  symbol: WatchlistQualitySymbolState,
  levelMap: LiveWatchlistLevelMap,
  side: "support" | "resistance",
): LiveWatchlistLevelQualityFinding[] {
  const visible = visibleLevels(levelMap, side);
  const full = fullLadderLevelsForSide(symbol, side);
  const findings: LiveWatchlistLevelQualityFinding[] = [];

  for (const candidate of full) {
    const distance = Math.abs(candidate.distancePct ?? ((candidate.price - levelMap.currentPrice) / Math.max(levelMap.currentPrice, 0.0001)));
    if (
      distance < OUTER_ANCHOR_MIN_DISTANCE_PCT ||
      distance > OUTER_ANCHOR_MAX_DISTANCE_PCT ||
      !isStrongStructuralLevel(candidate) ||
      isVisiblePrice(visible, candidate.price)
    ) {
      continue;
    }
    const nearbyVisibleStrong = visible.some(
      (level) => relativeDistancePct(level.price, candidate.price) <= NEAR_STACK_DISTANCE_PCT && isStrongStructuralLevel(level),
    );
    if (nearbyVisibleStrong) {
      continue;
    }
    const nearbyVisibleWeaker = visible.some(
      (level) =>
        relativeDistancePct(level.price, candidate.price) <= NEAR_STACK_DISTANCE_PCT &&
        qualityRank(level) < qualityRank(candidate),
    );
    if (nearbyVisibleWeaker) {
      continue;
    }
    const weakerTargetVisible = visible.some((level) => {
      const levelDistance = Math.abs(level.distancePct);
      return (
        Math.abs(levelDistance - distance) <= 0.03 &&
        qualityRank(level) < qualityRank(candidate)
      );
    });
    findings.push({
      kind: "strong_structural_anchor_hidden",
      severity: weakerTargetVisible ? "major" : "watch",
      symbol: symbol.symbol,
      side,
      price: candidate.price,
      score: weakerTargetVisible ? 82 : 62,
      summary: `${symbol.symbol} hides strong structural ${side} ${formatPrice(candidate.price)} around ${formatPct(side === "support" ? -distance : distance)}.`,
      evidence: [
        `Hidden full-ladder line: ${candidate.line}.`,
        weakerTargetVisible
          ? "A weaker visible level is occupying the same planning-distance area."
          : "No nearby strong visible structural level represents this outer anchor.",
      ],
    });
  }

  return findings.slice(0, 2);
}

function weakLadderBeforeStructuralAnchorFindings(
  symbol: WatchlistQualitySymbolState,
  levelMap: LiveWatchlistLevelMap,
  side: "support" | "resistance",
): LiveWatchlistLevelQualityFinding[] {
  const visible = visibleLevels(levelMap, side);
  const firstStrongIndex = visible.findIndex(isStrongStructuralLevel);
  if (firstStrongIndex <= 2) {
    return [];
  }
  const weakerBefore = visible.slice(0, firstStrongIndex);
  return [{
    kind: "weak_ladder_before_structural_anchor",
    severity: "watch",
    symbol: symbol.symbol,
    side,
    price: visible[firstStrongIndex]?.price,
    score: 50 + weakerBefore.length,
    summary: `${symbol.symbol} shows ${weakerBefore.length} weaker ${side} levels before the first strong structural level.`,
    evidence: [
      `First strong structural ${side}: ${visible[firstStrongIndex]?.label ?? "n/a"}.`,
      `Earlier visible levels: ${weakerBefore.map((level) => level.label).join(" | ")}.`,
      "Trader read: this may be fine, but review whether the card is giving too much equal weight to minor levels.",
    ],
  }];
}

function findingsForSymbol(symbol: WatchlistQualitySymbolState): LiveWatchlistLevelQualityFinding[] {
  const normalizedSymbol = symbol.symbol.toUpperCase();
  const symbolForFindings = { ...symbol, symbol: normalizedSymbol };
  const levelMap = symbol.levelMap ?? null;
  if (!levelMap) {
    const archivedInactive = isArchivedInactiveSymbol(symbolForFindings);
    return [{
      kind: "missing_level_map",
      severity: archivedInactive ? "info" : "major",
      symbol: normalizedSymbol,
      score: archivedInactive ? 15 : 75,
      summary: archivedInactive
        ? `${normalizedSymbol} is archived/inactive and has no retained level map.`
        : `${normalizedSymbol} has no visible level map on the website payload.`,
      evidence: archivedInactive
        ? ["Archive-only QA keeps this sample in scope, but missing live-only card state should not be treated as current production risk."]
        : ["The watchlist card cannot produce nearest support/resistance guidance without a level map."],
    }];
  }

  return [
    ...sameBoundaryFindings(symbolForFindings, levelMap),
    ...nearestLabelMismatchFindings(symbolForFindings, levelMap),
    ...labelVocabularyFindings(symbolForFindings, levelMap),
    ...strongerNearbyHiddenFindings(symbolForFindings, levelMap, "support"),
    ...strongerNearbyHiddenFindings(symbolForFindings, levelMap, "resistance"),
    ...structuralAnchorHiddenFindings(symbolForFindings, levelMap, "support"),
    ...structuralAnchorHiddenFindings(symbolForFindings, levelMap, "resistance"),
    ...weakLadderBeforeStructuralAnchorFindings(symbolForFindings, levelMap, "support"),
    ...weakLadderBeforeStructuralAnchorFindings(symbolForFindings, levelMap, "resistance"),
  ];
}

function findingSortValue(finding: LiveWatchlistLevelQualityFinding): number {
  const severityScore = finding.severity === "major" ? 300 : finding.severity === "watch" ? 200 : 100;
  return severityScore + finding.score;
}

export function buildLiveWatchlistLevelQualityReport(
  payload: WatchlistQualityStatePayload,
  source = "unknown",
  maxFindings = 80,
): LiveWatchlistLevelQualityReport {
  const findings = payload.symbols
    .flatMap(findingsForSymbol)
    .sort((left, right) => findingSortValue(right) - findingSortValue(left))
    .slice(0, maxFindings);
  return {
    generatedAt: new Date().toISOString(),
    source,
    marketDataStatus: payload.marketDataStatus ?? null,
    totals: {
      symbols: payload.symbols.length,
      liveSymbols: payload.symbols.filter((symbol) => symbol.status === "live").length,
      deactivatedSymbols: payload.symbols.filter((symbol) => symbol.status === "deactivated").length,
      symbolsWithLevelMap: payload.symbols.filter((symbol) => Boolean(symbol.levelMap)).length,
      findings: findings.length,
      majorFindings: findings.filter((finding) => finding.severity === "major").length,
      watchFindings: findings.filter((finding) => finding.severity === "watch").length,
      infoFindings: findings.filter((finding) => finding.severity === "info").length,
    },
    findings,
  };
}

function renderMarkdown(report: LiveWatchlistLevelQualityReport): string {
  const lines: string[] = [];
  lines.push("# Live Watchlist Level Quality Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Source: ${report.source}`);
  lines.push(`Market data status: ${report.marketDataStatus ?? "unknown"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Symbols: ${report.totals.symbols}`);
  lines.push(`- Live symbols: ${report.totals.liveSymbols}`);
  lines.push(`- Deactivated symbols: ${report.totals.deactivatedSymbols}`);
  lines.push(`- Symbols with level map: ${report.totals.symbolsWithLevelMap}`);
  lines.push(`- Findings: ${report.totals.findings}`);
  lines.push(`- Major: ${report.totals.majorFindings}`);
  lines.push(`- Watch: ${report.totals.watchFindings}`);
  lines.push(`- Info: ${report.totals.infoFindings}`);
  lines.push("");
  lines.push("## How To Use This");
  lines.push("");
  lines.push("This is a website-card QA report. It does not prove the full level engine is wrong. It flags places where the visible watchlist read may hide better structure, duplicate a boundary, or give too much equal weight to weaker levels.");
  lines.push("");
  lines.push("Prioritize repeated `major` findings across symbols before changing global selection rules.");
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("No findings.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  for (const finding of report.findings) {
    const side = finding.side ? ` ${finding.side}` : "";
    const price = finding.price === undefined ? "" : ` ${formatPrice(finding.price)}`;
    lines.push(`### ${finding.severity.toUpperCase()} ${finding.symbol} ${finding.kind}${side}${price}`);
    lines.push("");
    lines.push(`- Score: ${finding.score.toFixed(1)}`);
    lines.push(`- Summary: ${finding.summary}`);
    for (const evidence of finding.evidence) {
      lines.push(`- Evidence: ${evidence}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function writeLiveWatchlistLevelQualityReport(
  options: WriteLiveWatchlistLevelQualityReportOptions,
): LiveWatchlistLevelQualityReport {
  const report = buildLiveWatchlistLevelQualityReport(
    options.payload,
    options.source,
    options.maxFindings,
  );
  mkdirSync(options.outputDirectory, { recursive: true });
  writeFileSync(
    join(options.outputDirectory, "live-watchlist-level-quality-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(
    join(options.outputDirectory, "live-watchlist-level-quality-report.md"),
    renderMarkdown(report),
  );
  return report;
}
