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
};

const DEFAULT_API_BASE_URL = "https://discord.com/api/v10";

function normalizeNonEmpty(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required for Discord REST gateway.`);
  }
  return normalized;
}

function buildAlertMessageContent(payload: AlertPayload): string {
  return `${payload.title}\n${payload.body}`;
}

async function parseDiscordJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as T;
}

export class DiscordRestThreadGateway implements DiscordThreadGateway {
  private readonly botToken: string;
  private readonly watchlistChannelId: string;
  private readonly guildId?: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly autoArchiveDurationMinutes: 60 | 1440 | 4320 | 10080;

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
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${this.botToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Discord API request failed (${response.status}) for ${path}: ${body || response.statusText}`,
      );
    }

    return (await parseDiscordJson<T>(response)) as T;
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
    await this.postMessage(threadId, buildAlertMessageContent(payload));
  }

  async sendLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    await this.postMessage(threadId, formatLevelSnapshotMessage(payload));
  }

  async sendLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void> {
    await this.postMessage(threadId, formatLevelExtensionMessage(payload));
  }
}
