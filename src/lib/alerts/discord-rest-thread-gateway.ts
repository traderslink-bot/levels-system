import type {
  AlertPayload,
  DiscordThread,
  LevelExtensionPayload,
  LevelSnapshotPayload,
} from "./alert-types.js";
import type { DiscordThreadGateway } from "./alert-router.js";
import { formatLevelExtensionMessage, formatLevelSnapshotMessage } from "./alert-router.js";

type DiscordSnowflake = string;

type DiscordMessageResponse = {
  id: DiscordSnowflake;
};

type DiscordChannelResponse = {
  id: DiscordSnowflake;
  name?: string;
  type?: number;
  parent_id?: string | null;
};

type DiscordThreadListResponse = {
  threads?: DiscordChannelResponse[];
};

type FetchLike = typeof fetch;

export type DiscordRestThreadGatewayOptions = {
  botToken: string;
  watchlistChannelId: string;
  guildId?: string;
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  autoArchiveDurationMinutes?: 60 | 1440 | 4320 | 10080;
  transientRetryAttempts?: number;
  transientRetryDelayMs?: number;
  maxTransientRetryDelayMs?: number;
  requestTimeoutMs?: number;
};

const DEFAULT_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_FLAG_SUPPRESS_EMBEDS = 1 << 2;
const DEFAULT_TRANSIENT_RETRY_ATTEMPTS = 1;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 750;
const DEFAULT_MAX_TRANSIENT_RETRY_DELAY_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function normalizeNonEmpty(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required for Discord REST gateway.`);
  }
  return normalized;
}

function buildAlertMessageContent(payload: AlertPayload): string {
  const title = payload.title.trim();
  return title ? `${title}\n${payload.body}` : payload.body;
}

async function parseDiscordJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as T;
}

function isTransientDiscordStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function parseRetryAfterMs(response: Response, fallbackMs: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    return fallbackMs;
  }

  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : fallbackMs;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DiscordRestThreadGateway implements DiscordThreadGateway {
  private readonly botToken: string;
  private readonly watchlistChannelId: string;
  private readonly guildId?: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly autoArchiveDurationMinutes: 60 | 1440 | 4320 | 10080;
  private readonly transientRetryAttempts: number;
  private readonly transientRetryDelayMs: number;
  private readonly maxTransientRetryDelayMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: DiscordRestThreadGatewayOptions) {
    this.botToken = normalizeNonEmpty(options.botToken, "Discord bot token");
    this.watchlistChannelId = normalizeNonEmpty(
      options.watchlistChannelId,
      "Discord watchlist channel id",
    );
    this.guildId = options.guildId?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = options.apiBaseUrl?.trim() || DEFAULT_API_BASE_URL;
    this.autoArchiveDurationMinutes = options.autoArchiveDurationMinutes ?? 1440;
    this.transientRetryAttempts = Math.max(0, Math.floor(options.transientRetryAttempts ?? DEFAULT_TRANSIENT_RETRY_ATTEMPTS));
    this.transientRetryDelayMs = Math.max(0, Math.floor(options.transientRetryDelayMs ?? DEFAULT_TRANSIENT_RETRY_DELAY_MS));
    this.maxTransientRetryDelayMs = Math.max(
      0,
      Math.floor(options.maxTransientRetryDelayMs ?? DEFAULT_MAX_TRANSIENT_RETRY_DELAY_MS),
    );
    this.requestTimeoutMs = Math.max(0, Math.floor(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS));
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.transientRetryAttempts; attempt += 1) {
      const controller = this.requestTimeoutMs > 0 ? new AbortController() : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), this.requestTimeoutMs)
        : null;
      let response: Response;

      try {
        response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
          ...init,
          signal: init?.signal ?? controller?.signal,
          headers: {
            Authorization: `Bot ${this.botToken}`,
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = new Error(
          controller?.signal.aborted
            ? `Discord API request timed out after ${this.requestTimeoutMs}ms for ${path}.`
            : `Discord API request failed for ${path}: ${message}`,
        );
        if (attempt < this.transientRetryAttempts) {
          await delay(this.transientRetryDelayMs);
          continue;
        }

        throw lastError;
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }

      if (response.ok) {
        return (await parseDiscordJson<T>(response)) as T;
      }

      const body = await response.text();
      lastError = new Error(
        `Discord API request failed (${response.status}) for ${path}: ${body || response.statusText}`,
      );
      if (attempt < this.transientRetryAttempts && isTransientDiscordStatus(response.status)) {
        const retryDelayMs = parseRetryAfterMs(response, this.transientRetryDelayMs);
        if (retryDelayMs > this.maxTransientRetryDelayMs) {
          throw new Error(
            `Discord transient retry delay ${retryDelayMs}ms exceeds max ${this.maxTransientRetryDelayMs}ms for ${path}: ${body || response.statusText}`,
          );
        }
        await delay(retryDelayMs);
        continue;
      }

      throw lastError;
    }

    throw lastError ?? new Error(`Discord API request failed for ${path}.`);
  }

  private async postMessage(channelId: string, content: string): Promise<DiscordMessageResponse> {
    return this.request<DiscordMessageResponse>(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  async getThreadById(threadId: string): Promise<DiscordThread | null> {
    try {
      const channel = await this.request<DiscordChannelResponse>(`/channels/${threadId}`);
      if (channel.parent_id && channel.parent_id !== this.watchlistChannelId) {
        return null;
      }

      return {
        id: channel.id,
        name: channel.name ?? "",
      };
    } catch {
      return null;
    }
  }

  private findMatchingThread(threads: DiscordChannelResponse[], name: string): DiscordThread | null {
    const match = threads.find(
      (thread) => thread.name === name && thread.parent_id === this.watchlistChannelId,
    );

    if (!match) {
      return null;
    }

    return {
      id: match.id,
      name: match.name ?? name,
    };
  }

  async findThreadByName(name: string): Promise<DiscordThread | null> {
    if (this.guildId) {
      try {
        const active = await this.request<DiscordThreadListResponse>(
          `/guilds/${this.guildId}/threads/active`,
        );
        const activeMatch = this.findMatchingThread(active.threads ?? [], name);
        if (activeMatch) {
          return activeMatch;
        }
      } catch {
        // Keep recovery deterministic: a failed active-thread lookup just falls through.
      }
    }

    try {
      const archived = await this.request<DiscordThreadListResponse>(
        `/channels/${this.watchlistChannelId}/threads/archived/public?limit=100`,
      );
      return this.findMatchingThread(archived.threads ?? [], name);
    } catch {
      return null;
    }
  }

  async createThread(name: string): Promise<DiscordThread> {
    const starterMessage = await this.postMessage(this.watchlistChannelId, name);
    const thread = await this.request<DiscordChannelResponse>(
      `/channels/${this.watchlistChannelId}/messages/${starterMessage.id}/threads`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          auto_archive_duration: this.autoArchiveDurationMinutes,
        }),
      },
    );

    return {
      id: thread.id,
      name: thread.name ?? name,
    };
  }

  async sendMessage(threadId: string, payload: AlertPayload): Promise<void> {
    const content = buildAlertMessageContent(payload);
    const flags = payload.metadata?.suppressEmbeds ? DISCORD_FLAG_SUPPRESS_EMBEDS : undefined;
    await this.request<DiscordMessageResponse>(`/channels/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify(flags === undefined ? { content } : { content, flags }),
    });
  }

  async sendLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    await this.postMessage(threadId, formatLevelSnapshotMessage(payload));
  }

  async sendLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void> {
    await this.postMessage(threadId, formatLevelExtensionMessage(payload));
  }
}
