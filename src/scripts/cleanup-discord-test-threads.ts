import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  type DiscordThreadCleanupCandidate,
  filterThreadCleanupCandidates,
  loadThreadCleanupCandidatesFromDiscordAudit,
  loadThreadCleanupCandidatesFromWatchlistState,
} from "../lib/alerts/discord-thread-cleanup.js";

type CleanupAction = "dry_run" | "archive" | "delete";

type CleanupOptions = {
  sourcePath: string;
  sourceType: "watchlist_state" | "discord_audit";
  action: CleanupAction;
  deleteStarterMessages: boolean;
  includeActive: boolean;
  confirmTestingCleanup: boolean;
  symbols?: string[];
  outputPath: string;
  maxParentMessagePages: number;
};

type DiscordMessage = {
  id: string;
  content?: string;
  thread?: {
    id?: string;
    name?: string;
  };
};

const DEFAULT_SOURCE_PATH = resolve(process.cwd(), "artifacts", "manual-watchlist-state.json");
const DEFAULT_OUTPUT_PATH = resolve(process.cwd(), "artifacts", "discord-thread-cleanup-plan.json");
const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_RATE_LIMIT_FALLBACK_MS = 1000;

function printUsage(): never {
  console.error(`Usage:
  npm run discord:cleanup:threads -- [options]

Safe preview:
  npm run discord:cleanup:threads -- --dry-run
  npm run discord:cleanup:threads -- --dry-run --symbols ATER,BIYA

Delete testing threads and their starter messages:
  npm run discord:cleanup:threads -- --delete --delete-starter-messages --confirm-testing-cleanup

Archive testing threads instead of deleting:
  npm run discord:cleanup:threads -- --archive --confirm-testing-cleanup

Options:
  --source <path>                 Watchlist state JSON or discord-delivery-audit.jsonl.
  --audit <path>                  Use a discord-delivery-audit.jsonl source.
  --state <path>                  Use a manual-watchlist-state.json source.
  --symbols ATER,BIYA             Limit cleanup to specific symbols.
  --include-active                Include active symbols. Omitted by default.
  --dry-run                       Preview only. Default action.
  --archive                       Archive selected threads.
  --delete                        Delete selected thread channels.
  --delete-starter-messages       Also delete matching starter messages in the parent watchlist channel.
  --confirm-testing-cleanup       Required for archive/delete actions.
  --output <path>                 Write cleanup plan JSON. Default: artifacts\\discord-thread-cleanup-plan.json.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): CleanupOptions {
  let sourcePath = DEFAULT_SOURCE_PATH;
  let sourceType: CleanupOptions["sourceType"] = "watchlist_state";
  let action: CleanupAction = "dry_run";
  let deleteStarterMessages = false;
  let includeActive = false;
  let confirmTestingCleanup = false;
  let symbols: string[] | undefined;
  let outputPath = DEFAULT_OUTPUT_PATH;
  let maxParentMessagePages = 10;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
      case "--source":
        sourcePath = resolve(argv[++index] ?? "");
        sourceType = sourcePath.toLowerCase().endsWith(".jsonl") ? "discord_audit" : "watchlist_state";
        break;
      case "--audit":
        sourcePath = resolve(argv[++index] ?? "");
        sourceType = "discord_audit";
        break;
      case "--state":
        sourcePath = resolve(argv[++index] ?? "");
        sourceType = "watchlist_state";
        break;
      case "--symbols":
        symbols = (argv[++index] ?? "")
          .split(",")
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean);
        break;
      case "--include-active":
        includeActive = true;
        break;
      case "--dry-run":
        action = "dry_run";
        break;
      case "--archive":
        action = "archive";
        break;
      case "--delete":
        action = "delete";
        break;
      case "--delete-starter-messages":
        deleteStarterMessages = true;
        break;
      case "--confirm-testing-cleanup":
        confirmTestingCleanup = true;
        break;
      case "--output":
        outputPath = resolve(argv[++index] ?? "");
        break;
      case "--max-parent-message-pages":
        maxParentMessagePages = Math.max(1, Math.floor(Number(argv[++index] ?? "10")));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    sourcePath,
    sourceType,
    action,
    deleteStarterMessages,
    includeActive,
    confirmTestingCleanup,
    symbols,
    outputPath,
    maxParentMessagePages,
  };
}

async function discordRequest<T>(
  path: string,
  init: RequestInit,
  botToken: string,
): Promise<T | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    if (response.ok) {
      return text.trim() ? (JSON.parse(text) as T) : null;
    }

    if (init.method === "DELETE" && response.status === 404) {
      return null;
    }

    if (response.status === 429 && attempt < 4) {
      let retryAfterMs = DISCORD_RATE_LIMIT_FALLBACK_MS;
      try {
        const parsed = JSON.parse(text) as { retry_after?: unknown };
        if (typeof parsed.retry_after === "number" && Number.isFinite(parsed.retry_after)) {
          retryAfterMs = Math.max(250, parsed.retry_after * 1000);
        }
      } catch {
        const headerRetryAfter = response.headers.get("retry-after");
        const seconds = Number(headerRetryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
          retryAfterMs = Math.max(250, seconds * 1000);
        }
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryAfterMs));
      continue;
    }

    throw new Error(`Discord API request failed (${response.status}) for ${path}: ${text || response.statusText}`);
  }

  throw new Error(`Discord API request failed after retries for ${path}.`);
}

async function fetchParentChannelMessages(
  channelId: string,
  botToken: string,
  maxPages: number,
): Promise<DiscordMessage[]> {
  const messages: DiscordMessage[] = [];
  let before: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const query: string = before ? `?limit=100&before=${before}` : "?limit=100";
    const batch: DiscordMessage[] | null = await discordRequest<DiscordMessage[]>(
      `/channels/${channelId}/messages${query}`,
      { method: "GET" },
      botToken,
    );
    if (!batch || batch.length === 0) {
      break;
    }
    messages.push(...batch);
    before = batch[batch.length - 1]?.id ?? null;
    if (batch.length < 100 || !before) {
      break;
    }
  }

  return messages;
}

function findStarterMessages(
  candidates: DiscordThreadCleanupCandidate[],
  parentMessages: DiscordMessage[],
): Array<{ symbol: string; threadId: string; messageId: string }> {
  const byThreadId = new Map(candidates.map((candidate) => [candidate.threadId, candidate]));
  const bySymbol = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));
  const matches: Array<{ symbol: string; threadId: string; messageId: string }> = [];

  for (const message of parentMessages) {
    const threadId = message.thread?.id?.trim();
    if (threadId && byThreadId.has(threadId)) {
      const candidate = byThreadId.get(threadId)!;
      matches.push({ symbol: candidate.symbol, threadId: candidate.threadId, messageId: message.id });
      continue;
    }

    const content = message.content?.trim().toUpperCase();
    if (content && bySymbol.has(content)) {
      const candidate = bySymbol.get(content)!;
      matches.push({ symbol: candidate.symbol, threadId: candidate.threadId, messageId: message.id });
    }
  }

  return matches;
}

function loadCandidates(options: CleanupOptions): DiscordThreadCleanupCandidate[] {
  const candidates =
    options.sourceType === "discord_audit"
      ? loadThreadCleanupCandidatesFromDiscordAudit(options.sourcePath)
      : loadThreadCleanupCandidatesFromWatchlistState(options.sourcePath);

  return filterThreadCleanupCandidates(candidates, {
    symbols: options.symbols,
    includeActive: options.includeActive,
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const candidates = loadCandidates(options);
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const watchlistChannelId = process.env.DISCORD_WATCHLIST_CHANNEL_ID?.trim();
  const mutating = options.action !== "dry_run";

  if (mutating && !options.confirmTestingCleanup) {
    throw new Error("Refusing to mutate Discord without --confirm-testing-cleanup.");
  }
  if (mutating && !botToken) {
    throw new Error("DISCORD_BOT_TOKEN is required for archive/delete cleanup.");
  }
  if (options.deleteStarterMessages && !watchlistChannelId) {
    throw new Error("DISCORD_WATCHLIST_CHANNEL_ID is required for --delete-starter-messages.");
  }

  const parentMessages =
    options.deleteStarterMessages && watchlistChannelId && botToken
      ? await fetchParentChannelMessages(watchlistChannelId, botToken, options.maxParentMessagePages)
      : [];
  const starterMessages = findStarterMessages(candidates, parentMessages);

  const plan = {
    generatedAt: new Date().toISOString(),
    sourcePath: options.sourcePath,
    sourceType: options.sourceType,
    action: options.action,
    deleteStarterMessages: options.deleteStarterMessages,
    includeActive: options.includeActive,
    candidateCount: candidates.length,
    starterMessageCount: starterMessages.length,
    candidates,
    starterMessages,
  };

  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  console.log(`Cleanup candidates: ${candidates.length}`);
  console.log(`Starter messages matched: ${starterMessages.length}`);
  console.log(`Plan written: ${options.outputPath}`);

  if (options.action === "dry_run" && !options.deleteStarterMessages) {
    console.log("Dry run only. No Discord changes were made.");
    return;
  }

  if (options.action === "archive") {
    for (const candidate of candidates) {
      await discordRequest(`/channels/${candidate.threadId}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true, locked: false }),
      }, botToken!);
      console.log(`Archived thread ${candidate.symbol} ${candidate.threadId}`);
    }
  }

  if (options.action === "delete") {
    for (const candidate of candidates) {
      await discordRequest(`/channels/${candidate.threadId}`, { method: "DELETE" }, botToken!);
      console.log(`Deleted thread ${candidate.symbol} ${candidate.threadId}`);
    }
  }

  if (options.deleteStarterMessages && options.action !== "dry_run") {
    for (const starter of starterMessages) {
      await discordRequest(
        `/channels/${watchlistChannelId}/messages/${starter.messageId}`,
        { method: "DELETE" },
        botToken!,
      );
      console.log(`Deleted starter message ${starter.symbol} ${starter.messageId}`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
