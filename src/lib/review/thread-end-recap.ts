import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type DiscordAuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
  triggerPrice?: number;
  targetPrice?: number;
  tradeStoryState?: string;
  rangeBoxLabel?: string;
  acceptanceLabel?: string;
  behaviorBudgetLabel?: string;
};

export type ThreadEndRecap = {
  symbol: string;
  postCount: number;
  firstPostAt: number;
  lastPostAt: number;
  firstTitle?: string;
  lastTitle?: string;
  eventCounts: Record<string, number>;
  messageKindCounts: Record<string, number>;
  mentionedLevels: number[];
  storyStates: Record<string, number>;
  rangeBoxPosts: number;
  weakProbePosts: number;
  behaviorBudgetLabels: Record<string, number>;
  recapLines: string[];
};

export type ThreadEndRecapReport = {
  generatedAt: string;
  sourceAuditPath: string;
  symbols: ThreadEndRecap[];
};

function readRows(path: string): DiscordAuditRow[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DiscordAuditRow];
      } catch {
        return [];
      }
    });
}

function visibleText(row: DiscordAuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join("\n");
}

function extractLevels(text: string): number[] {
  const matches = text.match(/\b\d+(?:\.\d{1,4})\b/g) ?? [];
  return [...new Set(matches.map(Number).filter((value) => Number.isFinite(value) && value > 0))]
    .sort((left, right) => left - right)
    .slice(0, 20);
}

function increment(table: Record<string, number>, key: string | undefined): void {
  const normalized = key?.trim() || "unknown";
  table[normalized] = (table[normalized] ?? 0) + 1;
}

function formatLevel(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function buildRecapLines(rows: DiscordAuditRow[], recap: Omit<ThreadEndRecap, "recapLines">): string[] {
  const lines: string[] = [];
  const topEvents = Object.entries(recap.eventCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([event, count]) => `${event} x${count}`)
    .join(", ");
  lines.push(`${recap.symbol} produced ${recap.postCount} trader-facing posts${topEvents ? ` (${topEvents})` : ""}.`);

  if (recap.mentionedLevels.length > 0) {
    lines.push(`Most-mentioned level area: ${recap.mentionedLevels.slice(0, 6).map(formatLevel).join(", ")}.`);
  }

  if (recap.rangeBoxPosts > 0) {
    lines.push(`Range behavior appeared in ${recap.rangeBoxPosts} posts; review whether the thread stayed calm inside the box.`);
  }

  if (recap.weakProbePosts > 0) {
    lines.push(`${recap.weakProbePosts} posts were weak probes/testing reads; these are the first candidates to suppress if the thread felt noisy.`);
  }

  const last = rows.at(-1);
  if (last?.title) {
    lines.push(`Last visible story: ${last.title}.`);
  }

  return lines;
}

export function buildThreadEndRecapReport(auditPath: string): ThreadEndRecapReport {
  const rows = readRows(auditPath)
    .filter((row) => row.operation === "post_alert" && row.status === "success" && row.symbol)
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
  const bySymbol = new Map<string, DiscordAuditRow[]>();
  for (const row of rows) {
    const symbol = row.symbol!.trim().toUpperCase();
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
  }

  const symbols = [...bySymbol.entries()]
    .map(([symbol, symbolRows]) => {
      const eventCounts: Record<string, number> = {};
      const messageKindCounts: Record<string, number> = {};
      const storyStates: Record<string, number> = {};
      const behaviorBudgetLabels: Record<string, number> = {};
      const levels = new Set<number>();
      let rangeBoxPosts = 0;
      let weakProbePosts = 0;

      for (const row of symbolRows) {
        increment(eventCounts, row.eventType);
        increment(messageKindCounts, row.messageKind);
        increment(storyStates, row.tradeStoryState);
        increment(behaviorBudgetLabels, row.behaviorBudgetLabel);
        if (row.rangeBoxLabel === "active") {
          rangeBoxPosts += 1;
        }
        if (row.acceptanceLabel === "weak_probe" || row.acceptanceLabel === "testing") {
          weakProbePosts += 1;
        }
        for (const level of extractLevels(visibleText(row))) {
          levels.add(level);
        }
      }

      const base = {
        symbol,
        postCount: symbolRows.length,
        firstPostAt: symbolRows[0]?.timestamp ?? 0,
        lastPostAt: symbolRows.at(-1)?.timestamp ?? 0,
        firstTitle: symbolRows[0]?.title,
        lastTitle: symbolRows.at(-1)?.title,
        eventCounts,
        messageKindCounts,
        mentionedLevels: [...levels].sort((left, right) => left - right).slice(0, 20),
        storyStates,
        rangeBoxPosts,
        weakProbePosts,
        behaviorBudgetLabels,
      };
      return {
        ...base,
        recapLines: buildRecapLines(symbolRows, base),
      };
    })
    .sort((left, right) => right.postCount - left.postCount || left.symbol.localeCompare(right.symbol));

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    symbols,
  };
}

export function formatThreadEndRecapMarkdown(report: ThreadEndRecapReport): string {
  const lines = [
    "# Thread End Recap Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
  ];
  if (report.symbols.length === 0) {
    lines.push("- No successful trader-facing posts were found.");
    return lines.join("\n");
  }

  for (const symbol of report.symbols) {
    lines.push(
      `## ${symbol.symbol}`,
      "",
      `- posts: ${symbol.postCount}`,
      `- first post: ${symbol.firstTitle ?? "untitled"}`,
      `- last post: ${symbol.lastTitle ?? "untitled"}`,
      `- range-box posts: ${symbol.rangeBoxPosts}`,
      `- weak-probe/testing posts: ${symbol.weakProbePosts}`,
      "",
      ...symbol.recapLines.map((line) => `- ${line}`),
      "",
    );
  }

  return lines.join("\n");
}

export function writeThreadEndRecapReport(params: {
  auditPath: string;
  jsonPath: string;
  markdownPath: string;
}): ThreadEndRecapReport {
  const report = buildThreadEndRecapReport(params.auditPath);
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(params.markdownPath, formatThreadEndRecapMarkdown(report));
  return report;
}
