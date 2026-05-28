import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  formatLevelIntelligenceDiscordPreview,
  type FormatLevelIntelligenceDiscordPreviewOptions,
  type LevelIntelligenceDiscordPreview,
  type LevelIntelligenceDiscordPreviewMessage,
} from "./level-intelligence-discord-preview.js";
import {
  buildLevelIntelligenceReviewResult,
  loadLevelEngineOutputJson,
} from "../levels/level-intelligence-report-runner.js";
import { formatLevelIntelligenceReport } from "../levels/level-intelligence-report-formatter.js";
import { buildLevelIntelligenceReport } from "../levels/level-intelligence-report.js";
import type { LevelEngineOutput } from "../levels/level-types.js";
import type { MarketContextFactsBundle, MarketContextProfile } from "../market-context/index.js";
import type { SessionMarketFacts } from "../session/index.js";
import type { VolumeMarketFacts, VolumeShelf } from "../volume/index.js";

export type LevelIntelligenceDiscordPreviewRunnerFormat = "text" | "json";

export type LevelIntelligenceDiscordPreviewRunnerMode = "dry-run" | "send-test";

export type LevelIntelligenceDiscordPreviewRunnerOptions = {
  levelOutputPath: string;
  sessionFactsPath?: string;
  volumeFactsPath?: string;
  volumeShelvesPath?: string;
  marketContextPath?: string;
  factsBundlePath?: string;
  outPath?: string;
  format: LevelIntelligenceDiscordPreviewRunnerFormat;
  mode: LevelIntelligenceDiscordPreviewRunnerMode;
  testWebhookUrl?: string;
  maxMessageLength?: number;
};

export type LevelIntelligenceDiscordPreviewFactsInput = {
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  marketContext?: MarketContextProfile;
  factsBundle?: MarketContextFactsBundle;
};

export type LevelIntelligenceDiscordPreviewSendRequest = {
  webhookUrl: string;
  message: LevelIntelligenceDiscordPreviewMessage;
  payload: {
    content: string;
  };
};

export type LevelIntelligenceDiscordPreviewSendResult = {
  messageIndex: number;
  ok: boolean;
  status?: number;
  dryRun: boolean;
};

export type LevelIntelligenceDiscordPreviewSender = (
  request: LevelIntelligenceDiscordPreviewSendRequest,
) => Promise<Omit<LevelIntelligenceDiscordPreviewSendResult, "messageIndex" | "dryRun">>;

export type LevelIntelligenceDiscordPreviewRunnerResult = {
  levelOutputPath: string;
  outPath?: string;
  format: LevelIntelligenceDiscordPreviewRunnerFormat;
  mode: LevelIntelligenceDiscordPreviewRunnerMode;
  reportSymbol: string;
  preview: LevelIntelligenceDiscordPreview;
  sendResults: LevelIntelligenceDiscordPreviewSendResult[];
  content: string;
};

export type LevelIntelligenceDiscordPreviewRunnerFileSystem = {
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  mkdirSync: typeof mkdirSync;
};

export type LevelIntelligenceDiscordPreviewRunnerEnv = {
  LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL?: string;
};

const defaultFileSystem: LevelIntelligenceDiscordPreviewRunnerFileSystem = {
  readFileSync,
  writeFileSync,
  mkdirSync,
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseFormat(value: string | undefined): LevelIntelligenceDiscordPreviewRunnerFormat {
  if (value === undefined) {
    return "text";
  }
  if (value === "text" || value === "json") {
    return value;
  }

  throw new Error(`Unsupported --format value "${value}". Expected text or json.`);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0 || `${parsed}` !== value.trim()) {
    throw new Error(`Unsupported ${flag} value "${value}". Expected a positive integer.`);
  }

  return parsed;
}

export function parseLevelIntelligenceDiscordPreviewRunnerArgs(
  args: string[],
  env: LevelIntelligenceDiscordPreviewRunnerEnv = {},
): LevelIntelligenceDiscordPreviewRunnerOptions {
  let levelOutputPath: string | undefined;
  let sessionFactsPath: string | undefined;
  let volumeFactsPath: string | undefined;
  let volumeShelvesPath: string | undefined;
  let marketContextPath: string | undefined;
  let factsBundlePath: string | undefined;
  let outPath: string | undefined;
  let format: LevelIntelligenceDiscordPreviewRunnerFormat = "text";
  let sendTest = false;
  let dryRun = false;
  let testWebhookUrl: string | undefined;
  let maxMessageLength: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--level-output") {
      levelOutputPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--session-facts") {
      sessionFactsPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--volume-facts") {
      volumeFactsPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--volume-shelves") {
      volumeShelvesPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--market-context") {
      marketContextPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--facts-bundle") {
      factsBundlePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      outPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--format") {
      format = parseFormat(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--max-message-length") {
      maxMessageLength = parsePositiveInteger(requireValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--test-webhook-url") {
      testWebhookUrl = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--send-test") {
      sendTest = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument "${arg}".`);
  }

  if (!levelOutputPath) {
    throw new Error("Missing required --level-output <path>.");
  }

  const mode: LevelIntelligenceDiscordPreviewRunnerMode = sendTest && !dryRun ? "send-test" : "dry-run";

  return {
    levelOutputPath,
    sessionFactsPath,
    volumeFactsPath,
    volumeShelvesPath,
    marketContextPath,
    factsBundlePath,
    outPath,
    format,
    mode,
    testWebhookUrl: testWebhookUrl ?? env.LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL,
    maxMessageLength,
  };
}

function assertTestWebhookUrl(value: string | undefined): asserts value is string {
  if (!value) {
    throw new Error("Shadow Discord preview send-test requires --test-webhook-url or LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL.");
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("Shadow Discord preview test webhook URL must start with http:// or https://.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function loadJsonFile(
  filePath: string,
  label: string,
  fileSystem: Pick<LevelIntelligenceDiscordPreviewRunnerFileSystem, "readFileSync">,
): unknown {
  try {
    return JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${label} JSON from ${filePath}: ${message}`);
  }
}

function loadOptionalJsonFile(
  filePath: string | undefined,
  label: string,
  fileSystem: Pick<LevelIntelligenceDiscordPreviewRunnerFileSystem, "readFileSync">,
): unknown | undefined {
  return filePath === undefined ? undefined : loadJsonFile(filePath, label, fileSystem);
}

function normalizeVolumeShelvesJson(value: unknown): VolumeShelf[] {
  if (Array.isArray(value)) {
    return value as VolumeShelf[];
  }

  if (isRecord(value) && Array.isArray(value.shelves)) {
    return value.shelves as VolumeShelf[];
  }

  throw new Error("Volume shelves JSON must contain a VolumeShelf array or an object with a shelves array.");
}

export function loadLevelIntelligenceDiscordPreviewFactsInput(
  options: Pick<
    LevelIntelligenceDiscordPreviewRunnerOptions,
    "sessionFactsPath" | "volumeFactsPath" | "volumeShelvesPath" | "marketContextPath" | "factsBundlePath"
  >,
  fileSystem: Pick<LevelIntelligenceDiscordPreviewRunnerFileSystem, "readFileSync"> = defaultFileSystem,
): LevelIntelligenceDiscordPreviewFactsInput {
  const sessionFacts = loadOptionalJsonFile(options.sessionFactsPath, "session facts", fileSystem) as
    | SessionMarketFacts
    | undefined;
  const volumeFacts = loadOptionalJsonFile(options.volumeFactsPath, "volume facts", fileSystem) as
    | VolumeMarketFacts
    | undefined;
  const marketContext = loadOptionalJsonFile(options.marketContextPath, "market context", fileSystem) as
    | MarketContextProfile
    | undefined;
  const factsBundle = loadOptionalJsonFile(options.factsBundlePath, "facts bundle", fileSystem) as
    | MarketContextFactsBundle
    | undefined;
  const volumeShelvesJson = loadOptionalJsonFile(options.volumeShelvesPath, "volume shelves", fileSystem);

  return {
    sessionFacts,
    volumeFacts,
    volumeShelves: volumeShelvesJson === undefined ? undefined : normalizeVolumeShelvesJson(volumeShelvesJson),
    marketContext,
    factsBundle,
  };
}

function runnerContent(result: Omit<LevelIntelligenceDiscordPreviewRunnerResult, "content">): string {
  if (result.format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  const lines: string[] = [
    `${result.preview.symbol} level intelligence Discord preview (${result.mode})`,
    `Messages: ${result.preview.messages.length}`,
    `Truncated: ${result.preview.truncated ? "yes" : "no"}`,
    "",
  ];

  for (const message of result.preview.messages) {
    lines.push(`--- preview message ${message.index} ---`);
    lines.push(message.text);
    lines.push("");
  }

  lines.push("Safety");
  lines.push("- Preview/test path only.");
  lines.push("- Existing live alert routing was not invoked.");
  lines.push("- Existing monitoring path was not invoked.");
  lines.push("- Existing LevelEngine runtime path was not invoked.");
  lines.push("- VWAP remains facts-only.");
  lines.push("- Volume shelves remain facts-only.");

  if (result.sendResults.length === 0) {
    lines.push("- No test webhook deliveries.");
  } else {
    lines.push(`- Test webhook deliveries: ${result.sendResults.length}.`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildLevelIntelligenceDiscordPreviewReviewResult(
  output: LevelEngineOutput,
  options: Pick<LevelIntelligenceDiscordPreviewRunnerOptions, "levelOutputPath" | "outPath" | "format" | "mode" | "maxMessageLength"> & {
    factsInput?: LevelIntelligenceDiscordPreviewFactsInput;
  },
): Omit<LevelIntelligenceDiscordPreviewRunnerResult, "sendResults" | "content"> {
  const review =
    options.factsInput === undefined
      ? buildLevelIntelligenceReviewResult(output, "text")
      : {
          report: buildLevelIntelligenceReport({
            output,
            sessionFacts: options.factsInput.sessionFacts,
            volumeFacts: options.factsInput.volumeFacts,
            volumeShelves: options.factsInput.volumeShelves,
            marketContext: options.factsInput.marketContext,
            factsBundle: options.factsInput.factsBundle,
          }),
        };
  const formatted =
    "formatted" in review ? review.formatted : formatLevelIntelligenceReport(review.report);
  const previewOptions: FormatLevelIntelligenceDiscordPreviewOptions = {};

  if (options.maxMessageLength !== undefined) {
    previewOptions.maxMessageLength = options.maxMessageLength;
  }

  const preview = formatLevelIntelligenceDiscordPreview(formatted, previewOptions);

  return {
    levelOutputPath: options.levelOutputPath,
    outPath: options.outPath,
    format: options.format,
    mode: options.mode,
    reportSymbol: review.report.symbol,
    preview,
  };
}

export async function sendLevelIntelligenceDiscordPreviewWebhookMessage(
  request: LevelIntelligenceDiscordPreviewSendRequest,
): Promise<Omit<LevelIntelligenceDiscordPreviewSendResult, "messageIndex" | "dryRun">> {
  const response = await fetch(request.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request.payload),
  });

  if (!response.ok) {
    throw new Error(`Shadow Discord preview test webhook returned HTTP ${response.status}.`);
  }

  return {
    ok: true,
    status: response.status,
  };
}

export async function runLevelIntelligenceDiscordPreviewRunner(
  options: LevelIntelligenceDiscordPreviewRunnerOptions,
  fileSystem: LevelIntelligenceDiscordPreviewRunnerFileSystem = defaultFileSystem,
  sender: LevelIntelligenceDiscordPreviewSender = sendLevelIntelligenceDiscordPreviewWebhookMessage,
): Promise<LevelIntelligenceDiscordPreviewRunnerResult> {
  const output = loadLevelEngineOutputJson(options.levelOutputPath, fileSystem);
  const factsInput = loadLevelIntelligenceDiscordPreviewFactsInput(options, fileSystem);
  const baseResult = buildLevelIntelligenceDiscordPreviewReviewResult(output, {
    ...options,
    factsInput,
  });
  const sendResults: LevelIntelligenceDiscordPreviewSendResult[] = [];

  if (options.mode === "send-test") {
    assertTestWebhookUrl(options.testWebhookUrl);

    for (const message of baseResult.preview.messages) {
      const sendResult = await sender({
        webhookUrl: options.testWebhookUrl,
        message,
        payload: {
          content: message.text,
        },
      });

      sendResults.push({
        ...sendResult,
        messageIndex: message.index,
        dryRun: false,
      });
    }
  }

  const resultWithoutContent: Omit<LevelIntelligenceDiscordPreviewRunnerResult, "content"> = {
    ...baseResult,
    sendResults,
  };
  const content = runnerContent(resultWithoutContent);
  const result: LevelIntelligenceDiscordPreviewRunnerResult = {
    ...resultWithoutContent,
    content,
  };

  if (options.outPath) {
    fileSystem.mkdirSync(dirname(options.outPath), { recursive: true });
    fileSystem.writeFileSync(options.outPath, result.content, "utf8");
  }

  return result;
}
