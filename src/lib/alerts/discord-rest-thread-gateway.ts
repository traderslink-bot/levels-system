import { createHash } from "node:crypto";
import { join } from "node:path";
import { DiscordCooldown } from "./discord-rate-limit.js";
import { resolveManualWatchlistDurableDirectory } from "../monitoring/manual-watchlist-durable-storage.js";
import { DiscordConfirmedRejection, isConfirmedDiscordRejectionStatus } from "./discord-confirmed-rejection.js";
import type { ApprovedAnalysisDiscordChunk, ApprovedAnalysisDiscordReceipt } from "./alert-router.js";
import { allowedDiscordMentions, appendDiscordMentions, discordAudience, loadDiscordMentions } from "./watchlist-discord-mentions.js";
import type {
  AlertPayload,
  DiscordThread,
  LevelExtensionPayload,
  LevelSnapshotPayload,
} from "./alert-types.js";
import type { DiscordThreadGateway } from "./alert-router.js";
import { formatLevelExtensionMessage, formatLevelLadderMessage, formatLevelSnapshotMessage } from "./alert-router.js";
import { buildWatchlistDiscordLinkMessage } from "./watchlist-discord-link-message.js";

type DiscordSnowflake = string;

type DiscordMessageResponse = {
  id: DiscordSnowflake;
};

type DiscordGuildThreadsResponse = {
  threads?: DiscordChannelResponse[];
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
  premiumRoleId?: string;
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  autoArchiveDurationMinutes?: 60 | 1440 | 4320 | 10080;
  transientRetryAttempts?: number;
  transientRetryDelayMs?: number;
  maxTransientRetryDelayMs?: number;
  requestTimeoutMs?: number;
  cooldownFile?: string;
  webhookUrl?: string;
};

export type DiscordPermissionPreflightStatus = "pass" | "fail" | "skipped";

export type DiscordPermissionPreflightCheck = {
  name: string;
  status: DiscordPermissionPreflightStatus;
  detail: string;
};

export type DiscordPermissionPreflightResult = {
  ok: boolean;
  destructive: boolean;
  checks: DiscordPermissionPreflightCheck[];
};

const DEFAULT_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_FLAG_SUPPRESS_EMBEDS = 1 << 2;
const DEFAULT_TRANSIENT_RETRY_ATTEMPTS = 1;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 750;
const DEFAULT_MAX_TRANSIENT_RETRY_DELAY_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DISCORD_MESSAGE_MAX_LENGTH = 2000;

function normalizeNonEmpty(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required for Discord REST gateway.`);
  }
  return normalized;
}

function normalizeDiscordSnowflake(value: string | undefined, label: string): string {
  const normalized = normalizeNonEmpty(value, label);
  if (!/^\d{17,20}$/.test(normalized)) {
    throw new Error(`${label} must be a valid Discord snowflake.`);
  }
  return normalized;
}

function buildAlertMessageContent(payload: AlertPayload): string {
  const title = payload.title.trim();
  return title ? `${title}\n${payload.body}` : payload.body;
}

function removeDynamicIndicatorLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => !/\b(?:vwap|ema(?:9|20)?|ema\s*\d*)\b/i.test(line))
    .join("\n")
    .trimEnd();
}

function prepareDiscordContent(content: string): string {
  return removeDynamicIndicatorLines(content);
}

function splitLongLine(line: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxLength) {
    chunks.push(line.slice(index, index + maxLength));
  }
  return chunks;
}

function splitDiscordContent(content: string): string[] {
  const prepared = prepareDiscordContent(content).trimEnd();
  if (prepared.length <= DISCORD_MESSAGE_MAX_LENGTH) {
    return [prepared.length > 0 ? prepared : " "];
  }

  const chunks: string[] = [];
  let current = "";

  const flushCurrent = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };

  for (const line of prepared.split("\n")) {
    const candidate = current.length > 0 ? `${current}\n${line}` : line;
    if (candidate.length <= DISCORD_MESSAGE_MAX_LENGTH) {
      current = candidate;
      continue;
    }

    flushCurrent();

    if (line.length <= DISCORD_MESSAGE_MAX_LENGTH) {
      current = line;
      continue;
    }

    chunks.push(...splitLongLine(line, DISCORD_MESSAGE_MAX_LENGTH));
  }

  flushCurrent();
  return chunks.length > 0 ? chunks : [" "];
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
  private readonly cooldown: DiscordCooldown;
  private requestTail: Promise<unknown> = Promise.resolve();
  private readonly botToken: string;
  private readonly watchlistChannelId: string;
  private readonly guildId?: string;
  private readonly premiumRoleId: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly autoArchiveDurationMinutes: 60 | 1440 | 4320 | 10080;
  private readonly transientRetryAttempts: number;
  private readonly transientRetryDelayMs: number;
  private readonly maxTransientRetryDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly webhookUrl?: string;
  private webhookDestinationVerified = false;

  constructor(options: DiscordRestThreadGatewayOptions) {
    if (options.webhookUrl) {
      let parsed: URL;
      try { parsed = new URL(options.webhookUrl); } catch { throw new Error("Invalid Watchlist webhook configuration."); }
      if (parsed.protocol !== "https:" || parsed.hostname !== "discord.com" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
        !/^\/api\/(?:v10\/)?webhooks\/\d{17,20}\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) throw new Error("Invalid Watchlist webhook configuration.");
      this.webhookUrl = parsed.toString();
    }
    this.cooldown = new DiscordCooldown(options.cooldownFile ?? (!options.fetchImpl
      ? join(resolveManualWatchlistDurableDirectory(), `discord-cooldown-${createHash("sha256").update(options.botToken).digest("hex").slice(0, 16)}.json`) : undefined));
    this.botToken = normalizeNonEmpty(options.botToken, "Discord bot token");
    this.watchlistChannelId = normalizeNonEmpty(
      options.watchlistChannelId,
      "Discord watchlist channel id",
    );
    this.guildId = options.guildId?.trim() || undefined;
    this.premiumRoleId = options.premiumRoleId === undefined
      ? null
      : normalizeDiscordSnowflake(options.premiumRoleId, "Discord Premium role id");
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

  private async request<T>(path: string, init?: RequestInit, retryAttempts = this.transientRetryAttempts, approvedChunk = false): Promise<T> {
    const operation = this.requestTail.then(() => this.requestSerial<T>(path, init, retryAttempts, approvedChunk));
    this.requestTail = operation.catch(() => {});
    return operation;
  }

  private async requestSerial<T>(path: string, init?: RequestInit, retryAttempts = this.transientRetryAttempts, approvedChunk = false): Promise<T> {
    let lastError: Error | null = null;
    const webhook = Boolean(this.webhookUrl && (path.startsWith("/watchlist-webhook") || (path === `/channels/${this.watchlistChannelId}/messages` && init?.method === "POST")));
    const url = webhook ? path.startsWith("/watchlist-webhook")
      ? this.webhookUrl! + path.slice("/watchlist-webhook".length) : this.webhookUrl! + "?wait=true" : `${this.apiBaseUrl}${path}`;
    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
      const cooldown = this.cooldown.current();
      if (cooldown) throw new DiscordConfirmedRejection(429, cooldown);
      const controller = this.requestTimeoutMs > 0 ? new AbortController() : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), this.requestTimeoutMs)
        : null;
      let response: Response;

      try {
        response = await this.fetchImpl(url, {
          ...init,
          signal: init?.signal ?? controller?.signal,
          headers: {
            ...(webhook ? {} : { Authorization: `Bot ${this.botToken}` }),
            ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
            ...(init?.headers ?? {}),
          },
        });
      } catch (error) {
        const message = webhook ? "Webhook transport did not return a confirmed response." : error instanceof Error ? error.message : String(error);
        lastError = new Error(
          controller?.signal.aborted
            ? `Discord API request timed out after ${this.requestTimeoutMs}ms for ${path}.`
            : `Discord API request failed for ${path}: ${message}`,
        );
        if (attempt < retryAttempts) {
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

      if (response.status === 429) {
        const rateLimit = await response.clone().json().catch(() => ({})) as {global?: boolean; message?: string; retry_after?: number};
        const globalBlock = rateLimit.global === true || response.headers.get("x-ratelimit-global") === "true" ||
          /blocked from accessing our API.*global rate limits/i.test(rateLimit.message ?? "");
        const seconds = typeof rateLimit.retry_after === "number" && Number.isFinite(rateLimit.retry_after) && rateLimit.retry_after >= 0
          ? rateLimit.retry_after * 1000 : 60_000;
        const detail = { retryAt: Date.now() + Math.ceil(Math.max(1_000, seconds, parseRetryAfterMs(response, seconds))) + 1_000,
          scope: globalBlock ? "global" : ["user", "shared"].includes(response.headers.get("x-ratelimit-scope") ?? "") ? response.headers.get("x-ratelimit-scope")! : "route",
          reason: globalBlock ? "Discord temporarily blocked API access." : "Discord requested a delivery cooldown." };
        this.cooldown.record(detail);
        throw new DiscordConfirmedRejection(429, detail);
      }
      if (approvedChunk && isConfirmedDiscordRejectionStatus(response.status)) throw new DiscordConfirmedRejection(response.status);
      const body = webhook ? "Webhook request failed." : await response.text();
      lastError = new Error(
        `Discord API request failed (${response.status}) for ${path}: ${body || response.statusText}`,
      );
      if (attempt < retryAttempts && isTransientDiscordStatus(response.status)) {
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

  private async postSingleMessage(
    channelId: string,
    content: string,
    flags?: number,
  ): Promise<DiscordMessageResponse> {
    return this.request<DiscordMessageResponse>(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify(flags === undefined ? { content } : { content, flags }),
    });
  }

  private async postMessage(
    channelId: string,
    content: string,
    flags?: number,
  ): Promise<DiscordMessageResponse> {
    const chunks = splitDiscordContent(content);
    const [firstChunk, ...remainingChunks] = chunks;
    const firstResponse = await this.postSingleMessage(channelId, firstChunk ?? " ", flags);

    for (const chunk of remainingChunks) {
      await this.postSingleMessage(channelId, chunk, flags);
    }

    return firstResponse;
  }

  private async postTickerAddedAnnouncement(content: string): Promise<DiscordMessageResponse> {
    await this.verifyWebhookDestination();
    let audience = { everyone: false, roles: [] as string[] };
    try { audience = discordAudience(loadDiscordMentions(undefined, this.premiumRoleId ?? undefined)); } catch { /* Send without mentions if configuration is unreadable. */ }
    const [firstChunk, ...remainingChunks] = splitDiscordContent(
      appendDiscordMentions(content, audience),
    );
    const firstResponse = await this.request<DiscordMessageResponse>(
      `/channels/${this.watchlistChannelId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: firstChunk ?? "@everyone",
          allowed_mentions: allowedDiscordMentions(audience),
        }),
      },
    );

    for (const chunk of remainingChunks) {
      await this.postSingleMessage(this.watchlistChannelId, chunk);
    }

    return firstResponse;
  }

  private async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.request<unknown>(`/channels/${channelId}/messages/${messageId}`, {
      method: "DELETE",
    });
  }

  async announceTickerAdded(name: string): Promise<void> {
    await this.postTickerAddedAnnouncement(
      buildWatchlistDiscordLinkMessage(name),
    );
  }

  async preflightPermissions(
    options: { postTest?: boolean } = {},
  ): Promise<DiscordPermissionPreflightResult> {
    const checks: DiscordPermissionPreflightCheck[] = [];
    const runCheck = async (
      name: string,
      detail: string,
      check: () => Promise<void>,
    ): Promise<void> => {
      try {
        await check();
        checks.push({ name, status: "pass", detail });
      } catch (error) {
        checks.push({
          name,
          status: "fail",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    };

    await runCheck(
      "watchlist_channel_read",
      `can read channel ${this.watchlistChannelId}`,
      async () => {
        await this.request<DiscordChannelResponse>(`/channels/${this.watchlistChannelId}`);
      },
    );

    if (this.guildId) {
      await runCheck(
        "active_threads_read",
        `can read active threads for guild ${this.guildId}`,
        async () => {
          await this.request<DiscordGuildThreadsResponse>(`/guilds/${this.guildId}/threads/active`);
        },
      );
    } else {
      checks.push({
        name: "active_threads_read",
        status: "skipped",
        detail: "DISCORD_GUILD_ID is not configured, so active-thread recovery cannot be preflighted.",
      });
    }

    await runCheck(
      "archived_threads_read",
      `can read archived public threads for channel ${this.watchlistChannelId}`,
      async () => {
        await this.request<DiscordThreadListResponse>(
          `/channels/${this.watchlistChannelId}/threads/archived/public?limit=2`,
        );
      },
    );

    if (options.postTest) {
      let messageId: string | null = null;
      await runCheck(
        "watchlist_channel_post",
        "can send a temporary preflight message in the watchlist channel",
        async () => {
          const message = await this.postMessage(
            this.watchlistChannelId,
            `TradersLink permission preflight ${new Date().toISOString()}`,
          );
          messageId = message.id;
        },
      );

      if (messageId) {
        await runCheck(
          "watchlist_channel_delete_test_message",
          "can delete the temporary preflight message",
          async () => {
            await this.deleteMessage(this.watchlistChannelId, messageId!);
          },
        );
      }
    } else {
      checks.push({
        name: "watchlist_channel_post",
        status: "skipped",
        detail: "post test skipped; rerun with --post-test to verify send/delete permissions.",
      });
    }

    return {
      ok: checks.every((check) => check.status !== "fail"),
      destructive: Boolean(options.postTest),
      checks,
    };
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
    const starterMessage = await this.postMessage(
      this.watchlistChannelId,
      buildWatchlistDiscordLinkMessage(name),
    );
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
    const flags = payload.metadata?.suppressEmbeds ? DISCORD_FLAG_SUPPRESS_EMBEDS : undefined;
    await this.postMessage(threadId, buildAlertMessageContent(payload), flags);
  }

  /** A single already-previewed chunk. Durable review delivery owns recovery;
   * an uncertain response must never trigger a blind transport resend.
   */
  async sendApprovedAnalysisChunk(chunk: ApprovedAnalysisDiscordChunk): Promise<ApprovedAnalysisDiscordReceipt> {
    if (!chunk.deliveryKey.trim() || chunk.deliveryKey.length > 512 || !chunk.symbol.trim()) throw new Error("Approved Discord chunk identity is required.");
    if (!chunk.content.trim() || chunk.content.length > DISCORD_MESSAGE_MAX_LENGTH) throw new Error("Approved Discord chunks must contain 1–2000 characters.");
    await this.verifyWebhookDestination();
    const nonce = createHash("sha256").update(chunk.deliveryKey).digest("hex").slice(0, 25);
    const attachments = chunk.attachments ?? [];
    if (attachments.length > 3 || attachments.some(file => !/^[A-Z][A-Z0-9.-]*-analysis-[123]\.png$/.test(file.filename)
      || !file.bytes.length || file.bytes.length > 4_000_000 || file.description.length > 1024)) {
      throw new Error("Invalid analysis image attachment");
    }
    const payload = {
      content: chunk.content,
      allowed_mentions: allowedDiscordMentions(chunk.audience),
      flags: DISCORD_FLAG_SUPPRESS_EMBEDS,
      ...(!this.webhookUrl ? { nonce, enforce_nonce: true } : {}),
      ...(attachments.length ? { attachments: attachments.map((file, id) => ({ id, filename: file.filename, description: file.description })) } : {}),
    };
    let body: string | FormData = JSON.stringify(payload);
    if (attachments.length) {
      body = new FormData();
      body.append("payload_json", JSON.stringify(payload));
      attachments.forEach((file, index) => (body as FormData).append(`files[${index}]`, new Blob([new Uint8Array(file.bytes)], { type: "image/png" }), file.filename));
    }
    const message = await this.request<DiscordMessageResponse>(`/channels/${this.watchlistChannelId}/messages`, {
      method: "POST",
      body,
    }, 0, true);
    if (!message || !/^\d{17,20}$/.test(message.id)) throw new Error("Discord did not return an approved-message receipt; delivery is uncertain.");
    return { messageId: message.id, channelId: this.watchlistChannelId };
  }

  private async verifyWebhookDestination(): Promise<void> {
    if (!this.webhookUrl || this.webhookDestinationVerified) return;
    const hook = await this.request<{ channel_id?: string }>("/watchlist-webhook", { method: "GET" }, 0);
    if (hook.channel_id !== this.watchlistChannelId) throw new Error("Watchlist webhook belongs to a different channel. No notification was sent.");
    this.webhookDestinationVerified = true;
  }

  async sendLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    await this.postMessage(threadId, formatLevelSnapshotMessage(payload));
  }

  /** Read-only verification of an owner-selected existing message. This never
   * sends a message or decides that a missing message is safe to resend.
   */
  async verifyApprovedAnalysisMessage(chunk: ApprovedAnalysisDiscordChunk, messageId: string, notBefore: number): Promise<ApprovedAnalysisDiscordReceipt> {
    if (!/^\d{17,20}$/.test(messageId) || !Number.isFinite(notBefore) || notBefore <= 0 ||
      !chunk.content.trim() || !chunk.deliveryKey.trim()) throw new Error("Invalid Discord verification request.");
    if (this.webhookUrl) {
      await this.verifyWebhookDestination();
      const message = await this.request<{ id: string; channel_id: string; webhook_id?: string; content?: string; timestamp?: string }>(`/watchlist-webhook/messages/${messageId}`, { method: "GET" }, 0);
      const webhookId = new URL(this.webhookUrl).pathname.split("/").at(-2);
      const timestamp = typeof message.timestamp === "string" ? Date.parse(message.timestamp) : NaN;
      if (message.id !== messageId || message.channel_id !== this.watchlistChannelId || message.webhook_id !== webhookId ||
        message.content !== chunk.content || !Number.isFinite(timestamp) || timestamp < notBefore) throw new Error("Discord message does not match the approved delivery. No delivery status was changed.");
      return { messageId, channelId: this.watchlistChannelId };
    }
    const self = await this.request<{ id: string; bot?: boolean }>("/users/@me", { method: "GET" }, 0);
    const message = await this.request<{ id: string; channel_id: string; content?: string; author?: { id: string }; webhook_id?: string;
      timestamp?: string; nonce?: string | number }>(`/channels/${this.watchlistChannelId}/messages/${messageId}`, { method: "GET" }, 0);
    const timestamp = typeof message?.timestamp === "string" ? Date.parse(message.timestamp) : Number.NaN;
    const nonce = createHash("sha256").update(chunk.deliveryKey).digest("hex").slice(0, 25);
    if (!self || !message || !self.bot || !/^\d{17,20}$/.test(self.id) || message.author?.id !== self.id || message.webhook_id ||
      message.id !== messageId || message.channel_id !== this.watchlistChannelId || message.content !== chunk.content ||
      !Number.isFinite(timestamp) || timestamp < notBefore || (message.nonce !== undefined && String(message.nonce) !== nonce)) {
      throw new Error("Discord message does not match the approved delivery. No delivery status was changed.");
    }
    return { messageId, channelId: this.watchlistChannelId };
  }

  async sendLevelLadder(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    const ladder = formatLevelLadderMessage(payload);
    if (ladder) {
      await this.postMessage(threadId, ladder);
    }
  }

  async sendLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void> {
    await this.postMessage(threadId, formatLevelExtensionMessage(payload));
  }
}
