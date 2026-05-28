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

export type FormatLevelIntelligenceDiscordPreviewOptions = {
  maxMessageLength?: number;
  maxLineLength?: number;
  maxLinesPerSection?: number;
};

const DEFAULT_MAX_MESSAGE_LENGTH = 1800;
const DEFAULT_MAX_LINE_LENGTH = 220;
const DEFAULT_MAX_LINES_PER_SECTION = 24;
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
  const maxMessageLength = Math.max(MIN_MESSAGE_LENGTH, options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH);
  const maxLineLength = Math.max(80, options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH);
  const maxLinesPerSection = Math.max(1, options.maxLinesPerSection ?? DEFAULT_MAX_LINES_PER_SECTION);
  const sections = previewSections(report).map((section) =>
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
