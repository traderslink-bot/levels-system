import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  AlertPayload,
  DiscordThread,
  LevelExtensionPayload,
  LevelSnapshotPayload,
} from "./alert-types.js";
import type { DiscordThreadGateway } from "./alert-router.js";

export type DiscordDeliveryAuditOperation =
  | "create_thread"
  | "post_alert"
  | "post_level_snapshot"
  | "post_level_extension";

export type DiscordDeliveryAuditStatus = "posted" | "failed";

export type DiscordDeliveryAuditEntry = {
  type: "discord_delivery_audit";
  operation: DiscordDeliveryAuditOperation;
  status: DiscordDeliveryAuditStatus;
  gatewayMode: "real" | "local";
  timestamp: number;
  threadId?: string;
  symbol?: string;
  title?: string;
  bodyPreview?: string;
  error?: string;
};

export type DiscordAuditedThreadGatewayOptions = {
  gatewayMode: "real" | "local";
  auditFilePath?: string;
  auditListener?: (entry: DiscordDeliveryAuditEntry) => void;
};

const DEFAULT_AUDIT_FILE_PATH = resolve(
  process.cwd(),
  "artifacts",
  "discord-delivery-audit.jsonl",
);

function previewBody(body: string): string {
  const singleLine = body.replace(/\s+/g, " ").trim();
  return singleLine.length <= 240 ? singleLine : `${singleLine.slice(0, 237)}...`;
}

export class DiscordAuditedThreadGateway implements DiscordThreadGateway {
  private readonly auditFilePath: string;

  constructor(
    private readonly inner: DiscordThreadGateway,
    private readonly options: DiscordAuditedThreadGatewayOptions,
  ) {
    this.auditFilePath = options.auditFilePath ?? DEFAULT_AUDIT_FILE_PATH;
  }

  private writeAudit(entry: DiscordDeliveryAuditEntry): void {
    mkdirSync(dirname(this.auditFilePath), { recursive: true });
    appendFileSync(this.auditFilePath, `${JSON.stringify(entry)}\n`, "utf8");
    this.options.auditListener?.(entry);
  }

  private recordPosted(
    operation: DiscordDeliveryAuditOperation,
    payload: {
      threadId?: string;
      symbol?: string;
      title?: string;
      bodyPreview?: string;
    },
  ): void {
    this.writeAudit({
      type: "discord_delivery_audit",
      operation,
      status: "posted",
      gatewayMode: this.options.gatewayMode,
      timestamp: Date.now(),
      ...payload,
    });
  }

  private recordFailed(
    operation: DiscordDeliveryAuditOperation,
    error: unknown,
    payload: {
      threadId?: string;
      symbol?: string;
      title?: string;
      bodyPreview?: string;
    },
  ): never {
    const message = error instanceof Error ? error.message : String(error);
    this.writeAudit({
      type: "discord_delivery_audit",
      operation,
      status: "failed",
      gatewayMode: this.options.gatewayMode,
      timestamp: Date.now(),
      error: message,
      ...payload,
    });
    throw error;
  }

  async getThreadById(threadId: string): Promise<DiscordThread | null> {
    return this.inner.getThreadById(threadId);
  }

  async findThreadByName(name: string): Promise<DiscordThread | null> {
    return this.inner.findThreadByName(name);
  }

  async createThread(name: string): Promise<DiscordThread> {
    try {
      const thread = await this.inner.createThread(name);
      this.recordPosted("create_thread", {
        threadId: thread.id,
        symbol: name,
        title: "thread_created",
        bodyPreview: `Created thread ${thread.name}`,
      });
      return thread;
    } catch (error) {
      this.recordFailed("create_thread", error, {
        symbol: name,
        title: "thread_create_failed",
        bodyPreview: `Failed to create thread ${name}`,
      });
    }
  }

  async sendMessage(threadId: string, payload: AlertPayload): Promise<void> {
    try {
      await this.inner.sendMessage(threadId, payload);
      this.recordPosted("post_alert", {
        threadId,
        symbol: payload.event.symbol,
        title: payload.title,
        bodyPreview: previewBody(payload.body),
      });
    } catch (error) {
      this.recordFailed("post_alert", error, {
        threadId,
        symbol: payload.event.symbol,
        title: payload.title,
        bodyPreview: previewBody(payload.body),
      });
    }
  }

  async sendLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    const bodyPreview =
      `price ${payload.currentPrice}; support ${payload.supportZones.length}; ` +
      `resistance ${payload.resistanceZones.length}`;

    try {
      await this.inner.sendLevelSnapshot(threadId, payload);
      this.recordPosted("post_level_snapshot", {
        threadId,
        symbol: payload.symbol,
        title: `LEVEL SNAPSHOT: ${payload.symbol}`,
        bodyPreview,
      });
    } catch (error) {
      this.recordFailed("post_level_snapshot", error, {
        threadId,
        symbol: payload.symbol,
        title: `LEVEL SNAPSHOT: ${payload.symbol}`,
        bodyPreview,
      });
    }
  }

  async sendLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void> {
    const bodyPreview = `${payload.side} ${payload.levels.join(", ")}`;

    try {
      await this.inner.sendLevelExtension(threadId, payload);
      this.recordPosted("post_level_extension", {
        threadId,
        symbol: payload.symbol,
        title: `NEXT LEVELS: ${payload.symbol}`,
        bodyPreview: previewBody(bodyPreview),
      });
    } catch (error) {
      this.recordFailed("post_level_extension", error, {
        threadId,
        symbol: payload.symbol,
        title: `NEXT LEVELS: ${payload.symbol}`,
        bodyPreview: previewBody(bodyPreview),
      });
    }
  }
}
