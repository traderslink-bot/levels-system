import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DiscordAuditedThreadGateway } from "../lib/alerts/discord-audited-thread-gateway.js";
import type { DiscordThreadGateway } from "../lib/alerts/alert-router.js";

test("DiscordAuditedThreadGateway records successful downstream deliveries", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "discord-audit-"));
  const auditFilePath = join(tempDir, "discord-delivery-audit.jsonl");
  const capturedEntries: any[] = [];
  const gateway: DiscordThreadGateway = {
    async getThreadById(threadId) {
      return { id: threadId, name: "ALBT" };
    },
    async findThreadByName(name) {
      return { id: "thread-1", name };
    },
    async createThread(name) {
      return { id: "thread-created", name };
    },
    async sendMessage() {},
    async sendLevelSnapshot() {},
    async sendLevelExtension() {},
  };

  const audited = new DiscordAuditedThreadGateway(gateway, {
    gatewayMode: "real",
    auditFilePath,
    auditListener: (entry) => {
      capturedEntries.push(entry);
    },
  });

  await audited.createThread("ALBT");
  await audited.sendMessage("thread-1", {
    title: "ALBT breakout",
    body: "breakout resistance 2.40-2.50",
    event: {
      symbol: "ALBT",
      timestamp: 1,
    } as any,
    metadata: {
      messageKind: "intelligent_alert",
      eventType: "breakout",
      severity: "critical",
      confidence: "high",
      score: 108.68,
      postingFamily: "bullish_resolution",
      postingDecisionReason: "posted",
      clearanceLabel: "limited",
      barrierClutterLabel: "stacked",
      nearbyBarrierCount: 2,
      nextBarrierSide: "resistance",
      nextBarrierDistancePct: 0.024,
      tacticalRead: "firm",
      movementLabel: "building",
      movementPct: 0.008,
      pressureLabel: "strong",
      pressureScore: 0.74,
      triggerQualityLabel: "clean",
      dipBuyQualityLabel: "actionable",
      setupStateLabel: "continuation",
      failureRiskLabel: "contained",
      tradeMapLabel: "favorable",
      riskPct: 0.012,
      roomToRiskRatio: 3,
      targetSide: "resistance",
      targetPrice: 2.5,
      targetDistancePct: 0.024,
    },
  });
  await audited.sendLevelSnapshot("thread-1", {
    symbol: "ALBT",
    currentPrice: 2.51,
    supportZones: [{ representativePrice: 2.4 }],
    resistanceZones: [{ representativePrice: 2.6 }],
    timestamp: 2,
    audit: {
      referencePrice: 2.51,
      displayTolerance: 0.01,
      forwardResistanceLimit: 3.765,
      displayedSupportIds: ["support-1"],
      displayedResistanceIds: ["resistance-1"],
      omittedSupportCount: 0,
      omittedResistanceCount: 1,
      supportCandidates: [
        {
          id: "support-1",
          side: "support",
          bucket: "surfaced",
          representativePrice: 2.4,
          zoneLow: 2.39,
          zoneHigh: 2.41,
          strengthLabel: "moderate",
          strengthScore: 1.2,
          confluenceCount: 1,
          sourceEvidenceCount: 1,
          timeframeBias: "5m",
          timeframeSources: ["5m"],
          sourceTypes: ["swing_low"],
          freshness: "fresh",
          isExtension: false,
          displayed: true,
          omittedReason: "displayed",
        },
      ],
      resistanceCandidates: [
        {
          id: "resistance-1",
          side: "resistance",
          bucket: "surfaced",
          representativePrice: 2.6,
          zoneLow: 2.59,
          zoneHigh: 2.61,
          strengthLabel: "moderate",
          strengthScore: 1.2,
          confluenceCount: 1,
          sourceEvidenceCount: 1,
          timeframeBias: "5m",
          timeframeSources: ["5m"],
          sourceTypes: ["swing_high"],
          freshness: "fresh",
          isExtension: false,
          displayed: true,
          omittedReason: "displayed",
        },
        {
          id: "resistance-2",
          side: "resistance",
          bucket: "extension",
          representativePrice: 4,
          zoneLow: 3.98,
          zoneHigh: 4.02,
          strengthLabel: "major",
          strengthScore: 3,
          confluenceCount: 2,
          sourceEvidenceCount: 2,
          timeframeBias: "daily",
          timeframeSources: ["daily"],
          sourceTypes: ["swing_high"],
          freshness: "aging",
          isExtension: true,
          displayed: false,
          omittedReason: "outside_forward_range",
        },
      ],
    },
  });

  const lines = readFileSync(auditFilePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(lines.length, 3);
  assert.equal(lines[0]?.operation, "create_thread");
  assert.equal(lines[1]?.operation, "post_alert");
  assert.equal(lines[2]?.operation, "post_level_snapshot");
  assert.equal(lines[1]?.status, "posted");
  assert.equal(lines[1]?.symbol, "ALBT");
  assert.equal(lines[1]?.body, "breakout resistance 2.40-2.50");
  assert.equal(lines[1]?.messageKind, "intelligent_alert");
  assert.equal(lines[1]?.eventType, "breakout");
  assert.equal(lines[1]?.postingFamily, "bullish_resolution");
  assert.equal(lines[1]?.clearanceLabel, "limited");
  assert.equal(lines[1]?.barrierClutterLabel, "stacked");
  assert.equal(lines[1]?.nearbyBarrierCount, 2);
  assert.equal(lines[1]?.nextBarrierSide, "resistance");
  assert.equal(lines[1]?.nextBarrierDistancePct, 0.024);
  assert.equal(lines[1]?.tacticalRead, "firm");
  assert.equal(lines[1]?.movementLabel, "building");
  assert.equal(lines[1]?.movementPct, 0.008);
  assert.equal(lines[1]?.pressureLabel, "strong");
  assert.equal(lines[1]?.pressureScore, 0.74);
  assert.equal(lines[1]?.triggerQualityLabel, "clean");
  assert.equal(lines[1]?.dipBuyQualityLabel, "actionable");
  assert.equal(lines[1]?.setupStateLabel, "continuation");
  assert.equal(lines[1]?.failureRiskLabel, "contained");
  assert.equal(lines[1]?.tradeMapLabel, "favorable");
  assert.equal(lines[1]?.riskPct, 0.012);
  assert.equal(lines[1]?.roomToRiskRatio, 3);
  assert.equal(lines[1]?.targetSide, "resistance");
  assert.equal(lines[1]?.targetPrice, 2.5);
  assert.equal(lines[1]?.targetDistancePct, 0.024);
  assert.equal(lines[2]?.supportCount, 1);
  assert.equal(lines[2]?.resistanceCount, 1);
  assert.equal(lines[2]?.snapshotAudit?.omittedResistanceCount, 1);
  assert.equal(
    lines[2]?.snapshotAudit?.omittedResistanceLevels[0]?.omittedReason,
    "outside_forward_range",
  );
  assert.match(lines[2]?.body, /LEVEL SNAPSHOT: ALBT/);
  assert.equal(capturedEntries.length, 3);
});

test("DiscordAuditedThreadGateway records failed downstream deliveries before rethrowing", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "discord-audit-"));
  const auditFilePath = join(tempDir, "discord-delivery-audit.jsonl");
  const gateway: DiscordThreadGateway = {
    async getThreadById() {
      return null;
    },
    async findThreadByName() {
      return null;
    },
    async createThread(name) {
      return { id: "thread-created", name };
    },
    async sendMessage() {
      throw new Error("Discord rejected post");
    },
    async sendLevelSnapshot() {},
    async sendLevelExtension() {},
  };

  const audited = new DiscordAuditedThreadGateway(gateway, {
    gatewayMode: "local",
    auditFilePath,
  });

  await assert.rejects(
    audited.sendMessage("thread-1", {
      title: "ALBT breakout",
      body: "breakout resistance 2.40-2.50",
      event: {
        symbol: "ALBT",
        timestamp: 1,
      } as any,
      metadata: {
        messageKind: "intelligent_alert",
        eventType: "breakout",
        severity: "critical",
        confidence: "high",
        score: 108.68,
        postingFamily: "bullish_resolution",
        postingDecisionReason: "posted",
        clearanceLabel: "tight",
        barrierClutterLabel: "dense",
        nearbyBarrierCount: 3,
        nextBarrierSide: "support",
        nextBarrierDistancePct: 0.011,
        tacticalRead: "tired",
        movementLabel: "back_inside",
        movementPct: 0.004,
        pressureLabel: "tentative",
        pressureScore: 0.34,
        triggerQualityLabel: "crowded",
        dipBuyQualityLabel: "poor",
        setupStateLabel: "confirmation",
        failureRiskLabel: "high",
        tradeMapLabel: "tight",
        riskPct: 0.018,
        roomToRiskRatio: 0.6,
        targetSide: "support",
        targetPrice: 2.38,
        targetDistancePct: 0.011,
      },
    }),
    /Discord rejected post/,
  );

  const line = JSON.parse(readFileSync(auditFilePath, "utf8").trim());
  assert.equal(line.operation, "post_alert");
  assert.equal(line.status, "failed");
  assert.equal(line.gatewayMode, "local");
  assert.equal(line.messageKind, "intelligent_alert");
  assert.equal(line.eventType, "breakout");
  assert.equal(line.postingFamily, "bullish_resolution");
  assert.equal(line.clearanceLabel, "tight");
  assert.equal(line.barrierClutterLabel, "dense");
  assert.equal(line.nearbyBarrierCount, 3);
  assert.equal(line.nextBarrierSide, "support");
  assert.equal(line.nextBarrierDistancePct, 0.011);
  assert.equal(line.tacticalRead, "tired");
  assert.equal(line.movementLabel, "back_inside");
  assert.equal(line.movementPct, 0.004);
  assert.equal(line.pressureLabel, "tentative");
  assert.equal(line.pressureScore, 0.34);
  assert.equal(line.triggerQualityLabel, "crowded");
  assert.equal(line.dipBuyQualityLabel, "poor");
  assert.equal(line.setupStateLabel, "confirmation");
  assert.equal(line.failureRiskLabel, "high");
  assert.equal(line.tradeMapLabel, "tight");
  assert.equal(line.riskPct, 0.018);
  assert.equal(line.roomToRiskRatio, 0.6);
  assert.equal(line.targetSide, "support");
  assert.equal(line.targetPrice, 2.38);
  assert.equal(line.targetDistancePct, 0.011);
  assert.match(line.error, /Discord rejected post/);
});
