import {
  formatLevelIntelligenceReport,
  type FormattedLevelIntelligenceReport,
  type FormattedLevelIntelligenceReportSection,
} from "../levels/level-intelligence-report-formatter.js";
import type { LevelIntelligenceReport } from "../levels/level-intelligence-report.js";

export type LevelIntelligenceDiscordPreviewSection = {
  title: string;
  lines: string[];
  text: string;
  truncated: boolean;
};

export type LevelIntelligenceDiscordPreviewMessage = {
  index: number;
  text: string;
  truncated: boolean;
};

export type LevelIntelligenceDiscordPreview = {
  symbol: string;
  summary: string;
  sections: LevelIntelligenceDiscordPreviewSection[];
  messages: LevelIntelligenceDiscordPreviewMessage[];
  diagnostics: string[];
  safety: FormattedLevelIntelligenceReport["safety"];
  maxMessageLength: number;
  truncated: boolean;
};

export type LevelIntelligenceDiscordPreviewDetailMode = "compact" | "full";

export type FormatLevelIntelligenceDiscordPreviewOptions = {
  detailMode?: LevelIntelligenceDiscordPreviewDetailMode;
  maxMessageLength?: number;
  maxLineLength?: number;
  maxLinesPerSection?: number;
};

const DEFAULT_MAX_MESSAGE_LENGTH = 1800;
const DEFAULT_MAX_LINE_LENGTH = 220;
const DEFAULT_MAX_LINES_PER_SECTION = 24;
const DEFAULT_COMPACT_MAX_LINE_LENGTH = 180;
const MIN_MESSAGE_LENGTH = 240;
const TRUNCATION_SUFFIX = " ... [truncated]";

const FORBIDDEN_PATTERNS = [
  /\bbuy\b/i,
  /\bsell\b/i,
  /\benter\b/i,
  /\bentry\b/i,
  /\bexit\b/i,
  /\bgood trade\b/i,
  /\bbad trade\b/i,
  /\bmistake\b/i,
  /\bshould\b/i,
  /\bcoaching\b/i,
  /\bcoach\b/i,
  /\bstop loss\b/i,
  /\btarget\b/i,
  /\btake profit\b/i,
  /\bprofit and loss\b/i,
  /\bp\/l\b/i,
  /\bgiveback\b/i,
  /\bjournal\b/i,
  /\bgrading\b/i,
];

function isFormattedReport(
  input: LevelIntelligenceReport | FormattedLevelIntelligenceReport,
): input is FormattedLevelIntelligenceReport {
  return "sections" in input && "summary" in input;
}

function normalizeReport(
  input: LevelIntelligenceReport | FormattedLevelIntelligenceReport,
): FormattedLevelIntelligenceReport {
  return isFormattedReport(input) ? input : formatLevelIntelligenceReport(input);
}

function isAllowedLine(line: string): boolean {
  return !FORBIDDEN_PATTERNS.some((pattern) => pattern.test(line));
}

function truncateLine(line: string, maxLineLength: number): { line: string; truncated: boolean } {
  if (line.length <= maxLineLength) {
    return { line, truncated: false };
  }

  const sliceLength = Math.max(0, maxLineLength - TRUNCATION_SUFFIX.length);
  return {
    line: `${line.slice(0, sliceLength).trimEnd()}${TRUNCATION_SUFFIX}`,
    truncated: true,
  };
}

function sectionPriority(title: string): number {
  const priority: Record<string, number> = {
    Summary: 0,
    "Major Support": 1,
    "Major Resistance": 2,
    "Intermediate Support": 3,
    "Intermediate Resistance": 4,
    "Intraday Support": 5,
    "Intraday Resistance": 6,
    "Extension Support": 7,
    "Extension Resistance": 8,
    Diagnostics: 9,
    Safety: 10,
  };

  return priority[title] ?? 99;
}

function previewSections(report: FormattedLevelIntelligenceReport): FormattedLevelIntelligenceReportSection[] {
  const wantedTitles = new Set([
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
  ]);

  return report.sections
    .filter((section) => wantedTitles.has(section.title))
    .sort((left, right) => sectionPriority(left.title) - sectionPriority(right.title));
}

function firstLineStarting(lines: string[], prefix: string): string | undefined {
  return lines.find((line) => line.startsWith(prefix) && isAllowedLine(line));
}

function firstLineAcross(
  sections: FormattedLevelIntelligenceReportSection[],
  prefix: string,
): string | undefined {
  for (const section of sections) {
    const line = firstLineStarting(section.lines, prefix);
    if (line) {
      return line;
    }
  }

  return undefined;
}

function compactDelimitedLine(line: string, maxItems: number): string {
  const separatorIndex = line.indexOf(": ");
  if (separatorIndex < 0) {
    return line;
  }

  const label = line.slice(0, separatorIndex);
  const body = line.slice(separatorIndex + 2);
  const pieces = body.split(" | ").filter((piece) => piece.length > 0);

  if (pieces.length <= maxItems) {
    return line;
  }

  return `${label}: ${pieces.slice(0, maxItems).join(" | ")} | +${pieces.length - maxItems} more`;
}

function compactVolumeFactsLine(line: string): string {
  return line.replace(/^Volume facts:/, "Volume context:");
}

function compactCountsLine(line: string): string {
  const match = line.match(
    /^Counts: major support (\d+), major resistance (\d+), intermediate support (\d+), intermediate resistance (\d+), intraday support (\d+), intraday resistance (\d+), extension support (\d+), extension resistance (\d+)$/,
  );

  if (!match) {
    return line;
  }

  const [, majorSupport, majorResistance, intermediateSupport, intermediateResistance, intradaySupport, intradayResistance, extensionSupport, extensionResistance] = match;

  return [
    `Counts: major S/R ${majorSupport}/${majorResistance}`,
    `intermediate S/R ${intermediateSupport}/${intermediateResistance}`,
    `intraday S/R ${intradaySupport}/${intradayResistance}`,
    `extension S/R ${extensionSupport}/${extensionResistance}`,
  ].join("; ");
}

function compactSafetyLine(report: FormattedLevelIntelligenceReport): string {
  return [
    `facts-only ${report.safety.factsOnly}`,
    `VWAP facts-only ${report.safety.vwapFactsOnly}`,
    `shelves facts-only ${report.safety.shelvesAreFactsOnly}`,
    `runtime unchanged ${report.safety.noRuntimeBehaviorChange}`,
  ].join("; ");
}

function isLevelStartLine(line: string): boolean {
  return /^(support|resistance) zone /i.test(line);
}

function splitLevelGroups(lines: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isLevelStartLine(line)) {
      if (current.length > 0) {
        groups.push(current);
      }
      current = [line];
      continue;
    }

    if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function compactLevelGroup(group: string[]): string[] {
  const lines: string[] = [];
  const firstLine = group.find(isAllowedLine);
  const extensionSource = firstLineStarting(group, "Extension source:");
  const extensionGeneration = firstLineStarting(group, "Extension generation:");
  const extensionEvidence = firstLineStarting(group, "Extension evidence limits:");
  const distance = firstLineStarting(group, "Distance:");
  const reaction = firstLineStarting(group, "Reaction:");
  const sessionFacts = firstLineStarting(group, "Session facts:");
  const shelfFacts = firstLineStarting(group, "Shelf facts:");
  const isSyntheticContinuationMap = extensionSource?.includes("Synthetic continuation map") ?? false;

  if (firstLine) {
    lines.push(firstLine);
  }
  if (extensionSource) {
    lines.push(extensionSource);
  }
  if (extensionGeneration && isSyntheticContinuationMap) {
    lines.push(extensionGeneration);
  }
  if (extensionEvidence && isSyntheticContinuationMap) {
    lines.push(compactDelimitedLine(extensionEvidence, 3));
  }
  if (distance) {
    lines.push(distance);
  }
  if (reaction && !isSyntheticContinuationMap) {
    lines.push(reaction);
  }
  if (sessionFacts) {
    lines.push(compactDelimitedLine(sessionFacts, 2));
  }
  if (shelfFacts) {
    lines.push(compactDelimitedLine(shelfFacts, 1));
  }

  return lines;
}

function compactSummarySection(
  report: FormattedLevelIntelligenceReport,
  sections: FormattedLevelIntelligenceReportSection[],
): FormattedLevelIntelligenceReportSection {
  const summary = sections.find((section) => section.title === "Summary");
  const lines = (summary?.lines ?? [])
    .filter((line) => line.startsWith("Symbol:") || line.startsWith("Profiled levels:") || line.startsWith("Counts:"))
    .map((line) => (line.startsWith("Counts:") ? compactCountsLine(line) : line));
  const marketContext = firstLineAcross(sections, "Market context facts:");
  const volumeContext = firstLineAcross(sections, "Volume facts:");
  const diagnostics = report.diagnostics.filter(isAllowedLine);

  if (marketContext) {
    lines.push(marketContext);
  }
  if (volumeContext) {
    lines.push(compactVolumeFactsLine(volumeContext));
  }
  if (diagnostics.length > 0) {
    lines.push(`Diagnostics: ${diagnostics.slice(0, 3).join(" | ")}${diagnostics.length > 3 ? ` | +${diagnostics.length - 3} more` : ""}`);
  }
  lines.push(`Safety: ${compactSafetyLine(report)}`);

  return {
    title: "Summary",
    lines,
  };
}

function compactLevelSection(section: FormattedLevelIntelligenceReportSection): FormattedLevelIntelligenceReportSection {
  const lines: string[] = [];
  const groups = splitLevelGroups(section.lines);

  if (groups.length === 0) {
    return {
      title: section.title,
      lines,
    };
  }

  const maxGroups = section.title.startsWith("Extension") ? 3 : 1;
  const selectedGroups = groups.slice(0, maxGroups);

  for (const group of selectedGroups) {
    lines.push(...compactLevelGroup(group));
  }

  if (selectedGroups.length < groups.length) {
    lines.push(`Additional levels: +${groups.length - selectedGroups.length} more`);
  }

  return {
    title: section.title,
    lines,
  };
}

function compactDiagnosticsSection(report: FormattedLevelIntelligenceReport): FormattedLevelIntelligenceReportSection {
  const diagnostics = report.diagnostics.filter(isAllowedLine);

  return {
    title: "Diagnostics",
    lines: diagnostics.length > 0 ? [diagnostics.join(" | ")] : ["none"],
  };
}

function compactSafetySection(report: FormattedLevelIntelligenceReport): FormattedLevelIntelligenceReportSection {
  return {
    title: "Safety",
    lines: [
      compactSafetyLine(report),
      "Preview/test path only; no Discord posting or runtime behavior change.",
    ],
  };
}

function compactPreviewSections(report: FormattedLevelIntelligenceReport): FormattedLevelIntelligenceReportSection[] {
  const sections = previewSections(report);
  const compact: FormattedLevelIntelligenceReportSection[] = [compactSummarySection(report, sections)];

  for (const section of sections) {
    if (section.title === "Summary" || section.title === "Diagnostics" || section.title === "Safety") {
      continue;
    }

    compact.push(compactLevelSection(section));
  }

  compact.push(compactDiagnosticsSection(report));
  compact.push(compactSafetySection(report));

  return compact;
}

function formatSection(
  section: FormattedLevelIntelligenceReportSection,
  options: Required<Pick<FormatLevelIntelligenceDiscordPreviewOptions, "maxLineLength" | "maxLinesPerSection">>,
): LevelIntelligenceDiscordPreviewSection {
  const lines: string[] = [];
  let truncated = false;
  const allowedLines = section.lines.filter(isAllowedLine);
  const selectedLines = allowedLines.slice(0, options.maxLinesPerSection);

  if (selectedLines.length < allowedLines.length) {
    truncated = true;
  }

  for (const rawLine of selectedLines) {
    const result = truncateLine(rawLine, options.maxLineLength);
    truncated = truncated || result.truncated;
    lines.push(result.line);
  }

  if (truncated && !lines.includes("Section shortened for Discord preview.")) {
    lines.push("Section shortened for Discord preview.");
  }

  const body = lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : "- none";

  return {
    title: section.title,
    lines,
    text: `**${section.title}**\n${body}`,
    truncated,
  };
}

function splitMessages(
  header: string,
  sections: LevelIntelligenceDiscordPreviewSection[],
  maxMessageLength: number,
): LevelIntelligenceDiscordPreviewMessage[] {
  const messages: LevelIntelligenceDiscordPreviewMessage[] = [];
  let current = header;
  let currentTruncated = false;

  for (const section of sections) {
    const block = `\n\n${section.text}`;

    if (current.length + block.length > maxMessageLength && current.length > 0) {
      messages.push({
        index: messages.length + 1,
        text: current,
        truncated: currentTruncated,
      });
      current = section.text;
      currentTruncated = section.truncated;
      continue;
    }

    current = current.length > 0 ? `${current}${block}` : section.text;
    currentTruncated = currentTruncated || section.truncated;
  }

  if (current.length > 0) {
    messages.push({
      index: messages.length + 1,
      text: current,
      truncated: currentTruncated,
    });
  }

  return messages.map((message) => {
    if (message.text.length <= maxMessageLength) {
      return message;
    }

    const sliceLength = Math.max(0, maxMessageLength - TRUNCATION_SUFFIX.length);
    return {
      ...message,
      text: `${message.text.slice(0, sliceLength).trimEnd()}${TRUNCATION_SUFFIX}`,
      truncated: true,
    };
  });
}

export function formatLevelIntelligenceDiscordPreview(
  input: LevelIntelligenceReport | FormattedLevelIntelligenceReport,
  options: FormatLevelIntelligenceDiscordPreviewOptions = {},
): LevelIntelligenceDiscordPreview {
  const report = normalizeReport(input);
  const detailMode = options.detailMode ?? "compact";
  const maxMessageLength = Math.max(MIN_MESSAGE_LENGTH, options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH);
  const defaultLineLength = detailMode === "compact" ? DEFAULT_COMPACT_MAX_LINE_LENGTH : DEFAULT_MAX_LINE_LENGTH;
  const maxLineLength = Math.max(80, options.maxLineLength ?? defaultLineLength);
  const maxLinesPerSection = Math.max(1, options.maxLinesPerSection ?? DEFAULT_MAX_LINES_PER_SECTION);
  const sectionSource = detailMode === "compact" ? compactPreviewSections(report) : previewSections(report);
  const sections = sectionSource.map((section) =>
    formatSection(section, { maxLineLength, maxLinesPerSection }),
  );
  const header = `**${report.symbol} Level Intelligence Preview**\n${report.summary}`;
  const messages = splitMessages(header, sections, maxMessageLength);

  return {
    symbol: report.symbol,
    summary: report.summary,
    sections,
    messages,
    diagnostics: report.diagnostics.filter(isAllowedLine),
    safety: report.safety,
    maxMessageLength,
    truncated: sections.some((section) => section.truncated) || messages.some((message) => message.truncated),
  };
}
