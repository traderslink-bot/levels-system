import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildDailyTraderReviewReport,
  type DailyTraderReviewSymbol,
} from "./daily-trader-review.js";

type AuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  noLevelReason?: string;
  whyPosted?: string;
};

export type SymbolVerdictLabel = "good" | "watch" | "needs_work" | "needs_candle_audit";

export type EndOfDaySymbolVerdict = {
  symbol: string;
  overall: SymbolVerdictLabel;
  firstPostTradeMap: {
    verdict: SymbolVerdictLabel;
    reason: string;
    excerpt: string | null;
  };
  postVolume: {
    verdict: SymbolVerdictLabel;
    reason: string;
    postCount: number;
    expectedMax: number;
  };
  missedMeaningfulMove: {
    verdict: SymbolVerdictLabel;
    reason: string;
  };
  levelCompleteness: {
    verdict: SymbolVerdictLabel;
    reason: string;
  };
  traderWording: {
    verdict: SymbolVerdictLabel;
    reason: string;
  };
  actionItems: string[];
};

export type EndOfDaySymbolVerdictReport = {
  generatedAt: string;
  sourceAuditPath: string;
  totals: {
    symbols: number;
    good: number;
    watch: number;
    needsWork: number;
    needsCandleAudit: number;
  };
  symbols: EndOfDaySymbolVerdict[];
};

function readRows(path: string): AuditRow[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditRow];
      } catch {
        return [];
      }
    });
}

function isPosted(row: AuditRow): boolean {
  return (
    (row.status === "posted" || row.status === "success") &&
    ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation))
  );
}

function symbolOf(row: AuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function rowText(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join("\n").trim();
}

function excerpt(value: string, maxLength = 360): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function firstPostVerdict(rows: AuditRow[]): EndOfDaySymbolVerdict["firstPostTradeMap"] {
  const first = rows.find((row) => row.operation === "post_level_snapshot") ?? rows[0];
  if (!first) {
    return {
      verdict: "needs_work",
      reason: "No visible first post was found for this symbol.",
      excerpt: null,
    };
  }

  const text = rowText(first);
  const hasTradeMap = /Trade map:|What price is doing now:/i.test(text);
  const hasBothSides = /Resistance:/i.test(text) && /Support:/i.test(text);
  const hasPracticalContext = /support that matters|cleaner above|current structure|closest levels/i.test(text);
  if (hasTradeMap && hasBothSides && hasPracticalContext) {
    return {
      verdict: "good",
      reason: "First post included a readable trade map and both support/resistance context.",
      excerpt: excerpt(text),
    };
  }
  if (hasBothSides) {
    return {
      verdict: "watch",
      reason: "First post included support/resistance, but the practical trade map could be clearer.",
      excerpt: excerpt(text),
    };
  }
  return {
    verdict: "needs_work",
    reason: "First post did not clearly frame both support and resistance for a trader.",
    excerpt: excerpt(text),
  };
}

function postVolumeVerdict(symbol: DailyTraderReviewSymbol): EndOfDaySymbolVerdict["postVolume"] {
  if (symbol.budgetStatus === "within_budget") {
    return {
      verdict: "good",
      reason: "Post count stayed within the expected budget for this symbol behavior.",
      postCount: symbol.postCount,
      expectedMax: symbol.expectedPostBudgetMax,
    };
  }
  if (symbol.budgetStatus === "watch") {
    return {
      verdict: "watch",
      reason: "Post count was above ideal but not clearly excessive.",
      postCount: symbol.postCount,
      expectedMax: symbol.expectedPostBudgetMax,
    };
  }
  return {
    verdict: "needs_work",
    reason: "Post count exceeded the expected trader-useful budget.",
    postCount: symbol.postCount,
    expectedMax: symbol.expectedPostBudgetMax,
  };
}

function missedMoveVerdict(symbol: DailyTraderReviewSymbol): EndOfDaySymbolVerdict["missedMeaningfulMove"] {
  if (symbol.latePostCount > 0) {
    return {
      verdict: "watch",
      reason: `${symbol.latePostCount} posts were late enough to review against candle timing.`,
    };
  }
  if (symbol.noLevelCount > 0) {
    return {
      verdict: "needs_candle_audit",
      reason: "Missing next-level context appeared in saved posts; run missed-move/level audit against candles.",
    };
  }
  return {
    verdict: "needs_candle_audit",
    reason: "Saved Discord rows alone cannot prove no meaningful move was missed; confirm with the candle-backed missed-move audit.",
  };
}

function levelCompletenessVerdict(symbol: DailyTraderReviewSymbol): EndOfDaySymbolVerdict["levelCompleteness"] {
  if (symbol.noLevelCount > 0) {
    return {
      verdict: "needs_work",
      reason: `${symbol.noLevelCount} posts had missing or unavailable next-level context.`,
    };
  }
  if (symbol.mainSupport === null || symbol.mainResistance === null) {
    return {
      verdict: "watch",
      reason: "Saved posts did not expose both a main support and main resistance reference.",
    };
  }
  return {
    verdict: "good",
    reason: "Saved posts exposed usable support/resistance context without missing-level wording.",
  };
}

function traderWordingVerdict(symbol: DailyTraderReviewSymbol): EndOfDaySymbolVerdict["traderWording"] {
  const worstReasons = symbol.worstExamples.map((example) => example.reason).join(" ");
  if (/missing next-level|weak probe|late delivery/i.test(worstReasons) || symbol.weakProbeCount >= 3) {
    return {
      verdict: "watch",
      reason: "Some examples need trader-readability review, mostly around weak probes, missing context, or timing.",
    };
  }
  return {
    verdict: "good",
    reason: "Representative saved wording looked trader-facing from the daily review evidence.",
  };
}

function combineVerdicts(verdicts: SymbolVerdictLabel[]): SymbolVerdictLabel {
  if (verdicts.includes("needs_work")) {
    return "needs_work";
  }
  if (verdicts.includes("watch")) {
    return "watch";
  }
  if (verdicts.includes("needs_candle_audit")) {
    return "needs_candle_audit";
  }
  return "good";
}

function actionItems(verdict: EndOfDaySymbolVerdict): string[] {
  const items: string[] = [];
  if (verdict.firstPostTradeMap.verdict !== "good") {
    items.push("Review first-post trade map wording and level context.");
  }
  if (verdict.postVolume.verdict !== "good") {
    items.push("Replay current post policy for repeated same-area noise.");
  }
  if (verdict.missedMeaningfulMove.verdict === "needs_candle_audit") {
    items.push("Run candle-backed missed meaningful move audit.");
  }
  if (verdict.levelCompleteness.verdict !== "good") {
    items.push("Run level quality audit for missing/wide ladder context.");
  }
  if (verdict.traderWording.verdict !== "good") {
    items.push("Review saved wording examples for trader clarity.");
  }
  return items;
}

export function buildEndOfDaySymbolVerdictReport(auditPath: string): EndOfDaySymbolVerdictReport {
  const daily = buildDailyTraderReviewReport(auditPath);
  const rows = readRows(auditPath)
    .filter((row) => row.symbol && isPosted(row))
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
  const rowsBySymbol = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row);
    rowsBySymbol.set(symbol, [...(rowsBySymbol.get(symbol) ?? []), row]);
  }

  const symbols = daily.symbols.map((symbolReport) => {
    const firstPostTradeMap = firstPostVerdict(rowsBySymbol.get(symbolReport.symbol) ?? []);
    const postVolume = postVolumeVerdict(symbolReport);
    const missedMeaningfulMove = missedMoveVerdict(symbolReport);
    const levelCompleteness = levelCompletenessVerdict(symbolReport);
    const traderWording = traderWordingVerdict(symbolReport);
    const overall = combineVerdicts([
      firstPostTradeMap.verdict,
      postVolume.verdict,
      missedMeaningfulMove.verdict,
      levelCompleteness.verdict,
      traderWording.verdict,
    ]);
    const verdict: EndOfDaySymbolVerdict = {
      symbol: symbolReport.symbol,
      overall,
      firstPostTradeMap,
      postVolume,
      missedMeaningfulMove,
      levelCompleteness,
      traderWording,
      actionItems: [],
    };
    verdict.actionItems = actionItems(verdict);
    return verdict;
  });

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    totals: {
      symbols: symbols.length,
      good: symbols.filter((symbol) => symbol.overall === "good").length,
      watch: symbols.filter((symbol) => symbol.overall === "watch").length,
      needsWork: symbols.filter((symbol) => symbol.overall === "needs_work").length,
      needsCandleAudit: symbols.filter((symbol) => symbol.overall === "needs_candle_audit").length,
    },
    symbols,
  };
}

export function formatEndOfDaySymbolVerdictMarkdown(report: EndOfDaySymbolVerdictReport): string {
  const lines = [
    "# End Of Day Symbol Verdicts",
    "",
    "Operator-only verdict report answering the practical trader-review questions per symbol.",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Totals",
    "",
    `- symbols: ${report.totals.symbols}`,
    `- good: ${report.totals.good}`,
    `- watch: ${report.totals.watch}`,
    `- needs work: ${report.totals.needsWork}`,
    `- needs candle audit only: ${report.totals.needsCandleAudit}`,
    "",
  ];

  for (const symbol of report.symbols.slice(0, 100)) {
    lines.push(`## ${symbol.symbol} - ${symbol.overall}`, "");
    lines.push(`- first post trade map: ${symbol.firstPostTradeMap.verdict} - ${symbol.firstPostTradeMap.reason}`);
    lines.push(`- post volume: ${symbol.postVolume.verdict} - ${symbol.postVolume.postCount}/${symbol.postVolume.expectedMax}; ${symbol.postVolume.reason}`);
    lines.push(`- missed meaningful move: ${symbol.missedMeaningfulMove.verdict} - ${symbol.missedMeaningfulMove.reason}`);
    lines.push(`- level completeness: ${symbol.levelCompleteness.verdict} - ${symbol.levelCompleteness.reason}`);
    lines.push(`- trader wording: ${symbol.traderWording.verdict} - ${symbol.traderWording.reason}`);
    if (symbol.actionItems.length > 0) {
      lines.push("- action items:");
      for (const item of symbol.actionItems) {
        lines.push(`  - ${item}`);
      }
    }
    if (symbol.firstPostTradeMap.excerpt) {
      lines.push("", "First post excerpt:", "", `> ${symbol.firstPostTradeMap.excerpt}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writeEndOfDaySymbolVerdict(params: {
  auditPath: string;
  jsonPath: string;
  markdownPath: string;
}): EndOfDaySymbolVerdictReport {
  const report = buildEndOfDaySymbolVerdictReport(params.auditPath);
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(params.markdownPath, formatEndOfDaySymbolVerdictMarkdown(report));
  return report;
}
