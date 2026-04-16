import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  AlertPayload,
  DiscordThread,
  DiscordThreadMessageType,
  LevelExtensionPayload,
  LevelSnapshotPayload,
} from "./alert-types.js";
import type { DiscordThreadGateway } from "./alert-router.js";
import { formatLevelExtensionMessage, formatLevelSnapshotMessage } from "./alert-router.js";

type PersistedDiscordMessage = {
  type: DiscordThreadMessageType;
  title: string;
  body: string;
  symbol: string;
  timestamp: number;
};

type PersistedDiscordThread = DiscordThread & {
  messages: PersistedDiscordMessage[];
};

type PersistedDiscordState = {
  version: 1;
  nextThreadSequence: number;
  threads: Record<string, PersistedDiscordThread>;
};

export type LocalDiscordThreadGatewayConfig = {
  filePath?: string;
};

const DISCORD_STATE_VERSION = 1;
const DEFAULT_DISCORD_STATE_FILE = resolve(
  process.cwd(),
  "artifacts",
  "discord-threads.json",
);

function buildEmptyState(): PersistedDiscordState {
  return {
    version: DISCORD_STATE_VERSION,
    nextThreadSequence: 1,
    threads: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateState(value: unknown): PersistedDiscordState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.version !== DISCORD_STATE_VERSION ||
    typeof value.nextThreadSequence !== "number" ||
    !Number.isInteger(value.nextThreadSequence) ||
    value.nextThreadSequence < 1 ||
    !isRecord(value.threads)
  ) {
    return null;
  }

  const threads: PersistedDiscordState["threads"] = {};

  for (const [threadId, threadValue] of Object.entries(value.threads)) {
    if (
      !isRecord(threadValue) ||
      typeof threadValue.id !== "string" ||
      typeof threadValue.name !== "string" ||
      !Array.isArray(threadValue.messages)
    ) {
      return null;
    }

    const messages: PersistedDiscordMessage[] = [];
    for (const messageValue of threadValue.messages) {
      if (
        !isRecord(messageValue) ||
        (
          messageValue.type !== "alert" &&
          messageValue.type !== "level_snapshot" &&
          messageValue.type !== "level_extension"
        ) ||
        typeof messageValue.title !== "string" ||
        typeof messageValue.body !== "string" ||
        typeof messageValue.symbol !== "string" ||
        typeof messageValue.timestamp !== "number" ||
        !Number.isFinite(messageValue.timestamp)
      ) {
        return null;
      }

      messages.push({
        type: messageValue.type,
        title: messageValue.title,
        body: messageValue.body,
        symbol: messageValue.symbol,
        timestamp: messageValue.timestamp,
      });
    }

    threads[threadId] = {
      id: threadValue.id,
      name: threadValue.name,
      messages,
    };
  }

  return {
    version: DISCORD_STATE_VERSION,
    nextThreadSequence: value.nextThreadSequence,
    threads,
  };
}

export class LocalDiscordThreadGateway implements DiscordThreadGateway {
  private readonly filePath: string;

  constructor(config: LocalDiscordThreadGatewayConfig = {}) {
    this.filePath = config.filePath ?? DEFAULT_DISCORD_STATE_FILE;
  }

  private loadState(): PersistedDiscordState {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const validated = validateState(parsed);

      if (!validated) {
        console.error(
          `[LocalDiscordThreadGateway] Discarded invalid Discord thread state at ${this.filePath}.`,
        );
        return buildEmptyState();
      }

      return validated;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[LocalDiscordThreadGateway] Failed to load Discord thread state from ${this.filePath}: ${message}`,
        );
      }

      return buildEmptyState();
    }
  }

  private saveState(state: PersistedDiscordState): void {
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;

    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(tempFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      renameSync(tempFilePath, this.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[LocalDiscordThreadGateway] Failed to save Discord thread state to ${this.filePath}: ${message}`,
      );
    }
  }

  async getThreadById(threadId: string): Promise<DiscordThread | null> {
    const state = this.loadState();
    const thread = state.threads[threadId];

    if (!thread) {
      return null;
    }

    return {
      id: thread.id,
      name: thread.name,
    };
  }

  async findThreadByName(name: string): Promise<DiscordThread | null> {
    const state = this.loadState();
    const thread = Object.values(state.threads).find((item) => item.name === name);

    if (!thread) {
      return null;
    }

    return {
      id: thread.id,
      name: thread.name,
    };
  }

  async createThread(name: string): Promise<DiscordThread> {
    const state = this.loadState();
    const threadId = `discord-thread-${state.nextThreadSequence}`;
    state.nextThreadSequence += 1;
    state.threads[threadId] = {
      id: threadId,
      name,
      messages: [],
    };
    this.saveState(state);

    return {
      id: threadId,
      name,
    };
  }

  async sendMessage(threadId: string, payload: AlertPayload): Promise<void> {
    const state = this.loadState();
    const thread = state.threads[threadId];

    if (!thread) {
      throw new Error(`Discord thread ${threadId} was not found.`);
    }

    thread.messages.push({
      type: "alert",
      title: payload.title,
      body: payload.body,
      symbol: payload.event.symbol,
      timestamp: payload.event.timestamp,
    });
    this.saveState(state);
  }

  async sendLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    const state = this.loadState();
    const thread = state.threads[threadId];

    if (!thread) {
      throw new Error(`Discord thread ${threadId} was not found.`);
    }

    thread.messages.push({
      type: "level_snapshot",
      title: `LEVEL SNAPSHOT: ${payload.symbol}`,
      body: formatLevelSnapshotMessage(payload),
      symbol: payload.symbol,
      timestamp: payload.timestamp,
    });
    this.saveState(state);
  }

  async sendLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void> {
    const state = this.loadState();
    const thread = state.threads[threadId];

    if (!thread) {
      throw new Error(`Discord thread ${threadId} was not found.`);
    }

    thread.messages.push({
      type: "level_extension",
      title: `NEXT LEVELS: ${payload.symbol}`,
      body: formatLevelExtensionMessage(payload),
      symbol: payload.symbol,
      timestamp: payload.timestamp,
    });
    this.saveState(state);
  }
}
