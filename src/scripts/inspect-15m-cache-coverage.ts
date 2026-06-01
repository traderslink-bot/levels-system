import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CoverageTimeframe = "5m" | "15m" | "4h" | "daily";

type TimeframeCoverage = {
  jsonFiles: number;
  malformedJsonFiles: number;
  validationCacheEntries: number;
  nonJsonFiles: number;
};

type SymbolCoverage = {
  provider: string;
  symbol: string;
  timeframes: Record<CoverageTimeframe, TimeframeCoverage>;
  has5m4hDaily: boolean;
  has15m: boolean;
  has5m15m4hDaily: boolean;
};

export type FifteenMinuteCacheCoverageSummary = {
  generatedAt: string;
  cacheRoot: string;
  cacheRootExists: boolean;
  providers: string[];
  providerSymbolGroups: number;
  totalJsonFiles: number;
  malformedJsonFiles: number;
  validationCacheEntries: number;
  nonJsonFiles: number;
  groupsWith5m4hDaily: number;
  groupsWithAny15m: number;
  groupsWith5m15m4hDaily: number;
  groupsMissing15mAmong5m4hDaily: number;
  timeframeJsonFileCounts: Record<CoverageTimeframe, number>;
  symbolsWith15m: string[];
  symbolsMissing15mAmong5m4hDaily: string[];
  diagnostics: string[];
  groups: SymbolCoverage[];
};

export type InspectFifteenMinuteCacheCoverageOptions = {
  cacheRoot: string;
  generatedAt?: string;
};

export type InspectFifteenMinuteCacheCoverageCliOptions =
  InspectFifteenMinuteCacheCoverageOptions & {
    outJson?: string;
    outText?: string;
  };

export type FifteenMinuteCacheCoverageArtifact = Omit<
  FifteenMinuteCacheCoverageSummary,
  "groups" | "symbolsMissing15mAmong5m4hDaily" | "symbolsWith15m"
> & {
  symbolsWith15mSample: string[];
  symbolsMissing15mAmong5m4hDailySample: string[];
};

const TIMEFRAMES: CoverageTimeframe[] = ["5m", "15m", "4h", "daily"];

function emptyTimeframeCoverage(): TimeframeCoverage {
  return {
    jsonFiles: 0,
    malformedJsonFiles: 0,
    validationCacheEntries: 0,
    nonJsonFiles: 0,
  };
}

function emptyTimeframes(): Record<CoverageTimeframe, TimeframeCoverage> {
  return {
    "5m": emptyTimeframeCoverage(),
    "15m": emptyTimeframeCoverage(),
    "4h": emptyTimeframeCoverage(),
    daily: emptyTimeframeCoverage(),
  };
}

function directoryNames(path: string): string[] {
  try {
    return readdirSync(path)
      .filter((entry) => statSync(join(path, entry)).isDirectory())
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidationCacheEntry(value: unknown, timeframe: CoverageTimeframe): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== 1 || !isRecord(value.request) || !isRecord(value.response)) {
    return false;
  }

  return (
    value.request.timeframe === timeframe &&
    isRecord(value.response) &&
    Array.isArray(value.response.candles)
  );
}

function inspectTimeframeDirectory(
  cacheRoot: string,
  provider: string,
  symbol: string,
  timeframe: CoverageTimeframe,
): TimeframeCoverage {
  const result = emptyTimeframeCoverage();
  const directoryPath = join(cacheRoot, provider, symbol, timeframe);

  let entries: string[];
  try {
    entries = readdirSync(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return result;
    }

    throw error;
  }

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry);
    if (!statSync(entryPath).isFile()) {
      continue;
    }

    if (!entry.endsWith(".json")) {
      result.nonJsonFiles += 1;
      continue;
    }

    result.jsonFiles += 1;
    try {
      const parsed = JSON.parse(readFileSync(entryPath, "utf8"));
      if (isValidationCacheEntry(parsed, timeframe)) {
        result.validationCacheEntries += 1;
      }
    } catch {
      result.malformedJsonFiles += 1;
    }
  }

  return result;
}

function formatSymbolKey(group: SymbolCoverage): string {
  return `${group.provider}/${group.symbol}`;
}

export function inspectFifteenMinuteCacheCoverage(
  options: InspectFifteenMinuteCacheCoverageOptions,
): FifteenMinuteCacheCoverageSummary {
  const generatedAt = new Date(options.generatedAt ?? Date.now()).toISOString();
  const cacheRoot = resolve(options.cacheRoot);
  const providers = directoryNames(cacheRoot);
  const groups: SymbolCoverage[] = [];

  for (const provider of providers) {
    for (const symbol of directoryNames(join(cacheRoot, provider))) {
      const timeframes = emptyTimeframes();
      for (const timeframe of TIMEFRAMES) {
        timeframes[timeframe] = inspectTimeframeDirectory(cacheRoot, provider, symbol, timeframe);
      }

      const has5m4hDaily =
        timeframes["5m"].jsonFiles > 0 &&
        timeframes["4h"].jsonFiles > 0 &&
        timeframes.daily.jsonFiles > 0;
      const has15m = timeframes["15m"].jsonFiles > 0;

      groups.push({
        provider,
        symbol,
        timeframes,
        has5m4hDaily,
        has15m,
        has5m15m4hDaily: has5m4hDaily && has15m,
      });
    }
  }

  const timeframeJsonFileCounts = {
    "5m": 0,
    "15m": 0,
    "4h": 0,
    daily: 0,
  };
  let totalJsonFiles = 0;
  let malformedJsonFiles = 0;
  let validationCacheEntries = 0;
  let nonJsonFiles = 0;

  for (const group of groups) {
    for (const timeframe of TIMEFRAMES) {
      const coverage = group.timeframes[timeframe];
      timeframeJsonFileCounts[timeframe] += coverage.jsonFiles;
      totalJsonFiles += coverage.jsonFiles;
      malformedJsonFiles += coverage.malformedJsonFiles;
      validationCacheEntries += coverage.validationCacheEntries;
      nonJsonFiles += coverage.nonJsonFiles;
    }
  }

  const symbolsWith15m = groups.filter((group) => group.has15m).map(formatSymbolKey).sort();
  const symbolsMissing15mAmong5m4hDaily = groups
    .filter((group) => group.has5m4hDaily && !group.has15m)
    .map(formatSymbolKey)
    .sort();

  const diagnostics: string[] = [];
  if (!existsSync(cacheRoot)) {
    diagnostics.push("cache_root_missing");
  }
  if (symbolsWith15m.length === 0) {
    diagnostics.push("no_15m_cache_found");
  }
  if (malformedJsonFiles > 0) {
    diagnostics.push("malformed_json_files_present");
  }
  if (nonJsonFiles > 0) {
    diagnostics.push("non_json_files_ignored");
  }

  return {
    generatedAt,
    cacheRoot,
    cacheRootExists: existsSync(cacheRoot),
    providers,
    providerSymbolGroups: groups.length,
    totalJsonFiles,
    malformedJsonFiles,
    validationCacheEntries,
    nonJsonFiles,
    groupsWith5m4hDaily: groups.filter((group) => group.has5m4hDaily).length,
    groupsWithAny15m: symbolsWith15m.length,
    groupsWith5m15m4hDaily: groups.filter((group) => group.has5m15m4hDaily).length,
    groupsMissing15mAmong5m4hDaily: symbolsMissing15mAmong5m4hDaily.length,
    timeframeJsonFileCounts,
    symbolsWith15m,
    symbolsMissing15mAmong5m4hDaily,
    diagnostics,
    groups,
  };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

export function parseInspectFifteenMinuteCacheCoverageArgs(
  args: string[],
): InspectFifteenMinuteCacheCoverageCliOptions {
  let cacheRoot: string | undefined;
  let generatedAt: string | undefined;
  let outJson: string | undefined;
  let outText: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cache-root") {
      cacheRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--generated-at") {
      generatedAt = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out-json") {
      outJson = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out-text") {
      outText = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}".`);
  }

  if (!cacheRoot) {
    throw new Error("Missing required --cache-root <path>.");
  }

  return {
    cacheRoot,
    generatedAt,
    outJson,
    outText,
  };
}

export function formatFifteenMinuteCacheCoverageSummary(
  summary: FifteenMinuteCacheCoverageSummary,
): string {
  const lines = [
    "15m validation cache coverage",
    `Generated at: ${summary.generatedAt}`,
    `Cache root: ${summary.cacheRoot}`,
    `Cache root exists: ${summary.cacheRootExists}`,
    `Providers: ${summary.providers.length === 0 ? "none" : summary.providers.join(", ")}`,
    `Provider/symbol groups: ${summary.providerSymbolGroups}`,
    `Total cache JSON files: ${summary.totalJsonFiles}`,
    `Malformed JSON files: ${summary.malformedJsonFiles}`,
    `Validation cache entries: ${summary.validationCacheEntries}`,
    `Non-JSON files ignored: ${summary.nonJsonFiles}`,
    `5m JSON files: ${summary.timeframeJsonFileCounts["5m"]}`,
    `15m JSON files: ${summary.timeframeJsonFileCounts["15m"]}`,
    `4h JSON files: ${summary.timeframeJsonFileCounts["4h"]}`,
    `Daily JSON files: ${summary.timeframeJsonFileCounts.daily}`,
    `Groups with 5m/4h/daily: ${summary.groupsWith5m4hDaily}`,
    `Groups with any 15m: ${summary.groupsWithAny15m}`,
    `Groups with 5m/15m/4h/daily: ${summary.groupsWith5m15m4hDaily}`,
    `Groups missing 15m among 5m/4h/daily: ${summary.groupsMissing15mAmong5m4hDaily}`,
    `Diagnostics: ${summary.diagnostics.length === 0 ? "none" : summary.diagnostics.join(", ")}`,
  ];

  if (summary.symbolsWith15m.length > 0) {
    lines.push(`Symbols with 15m: ${summary.symbolsWith15m.slice(0, 20).join(", ")}`);
  }

  if (summary.symbolsMissing15mAmong5m4hDaily.length > 0) {
    lines.push(
      `Sample symbols missing 15m: ${summary.symbolsMissing15mAmong5m4hDaily
        .slice(0, 20)
        .join(", ")}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function buildFifteenMinuteCacheCoverageArtifact(
  summary: FifteenMinuteCacheCoverageSummary,
): FifteenMinuteCacheCoverageArtifact {
  const {
    groups: _groups,
    symbolsWith15m,
    symbolsMissing15mAmong5m4hDaily,
    ...compact
  } = summary;

  return {
    ...compact,
    symbolsWith15mSample: symbolsWith15m.slice(0, 50),
    symbolsMissing15mAmong5m4hDailySample: symbolsMissing15mAmong5m4hDaily.slice(0, 50),
  };
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function isDirectRun(): boolean {
  const argvPath = process.argv[1];
  return argvPath !== undefined && fileURLToPath(import.meta.url) === resolve(argvPath);
}

if (isDirectRun()) {
  try {
    const options = parseInspectFifteenMinuteCacheCoverageArgs(process.argv.slice(2));
    const summary = inspectFifteenMinuteCacheCoverage(options);
    const text = formatFifteenMinuteCacheCoverageSummary(summary);

    if (options.outJson) {
      writeOutput(
        options.outJson,
        `${JSON.stringify(buildFifteenMinuteCacheCoverageArtifact(summary), null, 2)}\n`,
      );
    }
    if (options.outText) {
      writeOutput(options.outText, text);
    }
    process.stdout.write(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
