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
  eventType?: string;
  messageKind?: string;
  severity?: string;
  confidence?: string;
  score?: number;
  postingFamily?: string;
  postingDecisionReason?: string;
  clearanceLabel?: string;
  barrierClutterLabel?: string;
  nearbyBarrierCount?: number;
  nextBarrierSide?: string;
  nextBarrierDistancePct?: number;
  tacticalRead?: string;
  movementLabel?: string;
  movementPct?: number;
  pressureLabel?: string;
  pressureScore?: number;
  triggerQualityLabel?: string;
  pathQualityLabel?: string;
  dipBuyQualityLabel?: string;
  exhaustionLabel?: string;
  setupStateLabel?: string;
  failureRiskLabel?: string;
  tradeMapLabel?: string;
  riskPct?: number;
  roomToRiskRatio?: number;
  targetSide?: string;
  targetPrice?: number;
  targetDistancePct?: number;
  followThroughLabel?: string;
  progressLabel?: string;
  continuityType?: string;
  aiGenerated?: boolean;
  directionalReturnPct?: number | null;
  rawReturnPct?: number | null;
  supportCount?: number;
  resistanceCount?: number;
  side?: string;
  levelCount?: number;
  error?: string;
};

export type DiscordAuditedThreadGatewayOptions = {
  gatewayMode: "real" | "local";
  auditFilePath?: string;
  auditListener?: (entry: DiscordDeliveryAuditEntry) => void;
};

type DiscordDeliveryAuditPayload = Omit<
  DiscordDeliveryAuditEntry,
  "type" | "operation" | "status" | "gatewayMode" | "timestamp" | "error"
>;

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
    payload: DiscordDeliveryAuditPayload,
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
    payload: DiscordDeliveryAuditPayload,
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
        symbol: payload.symbol ?? payload.event?.symbol,
        title: payload.title,
        bodyPreview: previewBody(payload.body),
        messageKind: payload.metadata?.messageKind,
        eventType: payload.metadata?.eventType,
        severity: payload.metadata?.severity,
        confidence: payload.metadata?.confidence,
        score: payload.metadata?.score,
        postingFamily: payload.metadata?.postingFamily,
        postingDecisionReason: payload.metadata?.postingDecisionReason,
        clearanceLabel: payload.metadata?.clearanceLabel,
        barrierClutterLabel: payload.metadata?.barrierClutterLabel,
        nearbyBarrierCount: payload.metadata?.nearbyBarrierCount,
        nextBarrierSide: payload.metadata?.nextBarrierSide,
        nextBarrierDistancePct: payload.metadata?.nextBarrierDistancePct,
        tacticalRead: payload.metadata?.tacticalRead,
        movementLabel: payload.metadata?.movementLabel,
        movementPct: payload.metadata?.movementPct,
        pressureLabel: payload.metadata?.pressureLabel,
        pressureScore: payload.metadata?.pressureScore,
        triggerQualityLabel: payload.metadata?.triggerQualityLabel,
        pathQualityLabel: payload.metadata?.pathQualityLabel,
        dipBuyQualityLabel: payload.metadata?.dipBuyQualityLabel,
        exhaustionLabel: payload.metadata?.exhaustionLabel,
        setupStateLabel: payload.metadata?.setupStateLabel,
        failureRiskLabel: payload.metadata?.failureRiskLabel,
        tradeMapLabel: payload.metadata?.tradeMapLabel,
        riskPct: payload.metadata?.riskPct,
        roomToRiskRatio: payload.metadata?.roomToRiskRatio,
        targetSide: payload.metadata?.targetSide,
        targetPrice: payload.metadata?.targetPrice,
        targetDistancePct: payload.metadata?.targetDistancePct,
        followThroughLabel: payload.metadata?.followThroughLabel,
        progressLabel: payload.metadata?.progressLabel,
        continuityType: payload.metadata?.continuityType,
        aiGenerated: payload.metadata?.aiGenerated,
        directionalReturnPct: payload.metadata?.directionalReturnPct,
        rawReturnPct: payload.metadata?.rawReturnPct,
      });
    } catch (error) {
      this.recordFailed("post_alert", error, {
        threadId,
        symbol: payload.symbol ?? payload.event?.symbol,
        title: payload.title,
        bodyPreview: previewBody(payload.body),
        messageKind: payload.metadata?.messageKind,
        eventType: payload.metadata?.eventType,
        severity: payload.metadata?.severity,
        confidence: payload.metadata?.confidence,
        score: payload.metadata?.score,
        postingFamily: payload.metadata?.postingFamily,
        postingDecisionReason: payload.metadata?.postingDecisionReason,
        clearanceLabel: payload.metadata?.clearanceLabel,
        barrierClutterLabel: payload.metadata?.barrierClutterLabel,
        nearbyBarrierCount: payload.metadata?.nearbyBarrierCount,
        nextBarrierSide: payload.metadata?.nextBarrierSide,
        nextBarrierDistancePct: payload.metadata?.nextBarrierDistancePct,
        tacticalRead: payload.metadata?.tacticalRead,
        movementLabel: payload.metadata?.movementLabel,
        movementPct: payload.metadata?.movementPct,
        pressureLabel: payload.metadata?.pressureLabel,
        pressureScore: payload.metadata?.pressureScore,
        triggerQualityLabel: payload.metadata?.triggerQualityLabel,
        pathQualityLabel: payload.metadata?.pathQualityLabel,
        dipBuyQualityLabel: payload.metadata?.dipBuyQualityLabel,
        exhaustionLabel: payload.metadata?.exhaustionLabel,
        setupStateLabel: payload.metadata?.setupStateLabel,
        failureRiskLabel: payload.metadata?.failureRiskLabel,
        tradeMapLabel: payload.metadata?.tradeMapLabel,
        riskPct: payload.metadata?.riskPct,
        roomToRiskRatio: payload.metadata?.roomToRiskRatio,
        targetSide: payload.metadata?.targetSide,
        targetPrice: payload.metadata?.targetPrice,
        targetDistancePct: payload.metadata?.targetDistancePct,
        followThroughLabel: payload.metadata?.followThroughLabel,
        progressLabel: payload.metadata?.progressLabel,
        continuityType: payload.metadata?.continuityType,
        aiGenerated: payload.metadata?.aiGenerated,
        directionalReturnPct: payload.metadata?.directionalReturnPct,
        rawReturnPct: payload.metadata?.rawReturnPct,
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
        supportCount: payload.supportZones.length,
        resistanceCount: payload.resistanceZones.length,
      });
    } catch (error) {
      this.recordFailed("post_level_snapshot", error, {
        threadId,
        symbol: payload.symbol,
        title: `LEVEL SNAPSHOT: ${payload.symbol}`,
        bodyPreview,
        supportCount: payload.supportZones.length,
        resistanceCount: payload.resistanceZones.length,
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
        side: payload.side,
        levelCount: payload.levels.length,
      });
    } catch (error) {
      this.recordFailed("post_level_extension", error, {
        threadId,
        symbol: payload.symbol,
        title: `NEXT LEVELS: ${payload.symbol}`,
        bodyPreview: previewBody(bodyPreview),
        side: payload.side,
        levelCount: payload.levels.length,
      });
    }
  }
}
