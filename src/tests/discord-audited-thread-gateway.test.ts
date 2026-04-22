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
      eventType: "breakout",
      severity: "critical",
      confidence: "high",
      score: 108.68,
      postingFamily: "bullish_resolution",
      postingDecisionReason: "posted",
      clearanceLabel: "limited",
      nextBarrierSide: "resistance",
      nextBarrierDistancePct: 0.024,
      tacticalRead: "firm",
    },
  });
  await audited.sendLevelSnapshot("thread-1", {
    symbol: "ALBT",
    currentPrice: 2.51,
    supportZones: [{ representativePrice: 2.4 }],
    resistanceZones: [{ representativePrice: 2.6 }],
    timestamp: 2,
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
  assert.equal(lines[1]?.eventType, "breakout");
  assert.equal(lines[1]?.postingFamily, "bullish_resolution");
  assert.equal(lines[1]?.clearanceLabel, "limited");
  assert.equal(lines[1]?.nextBarrierSide, "resistance");
  assert.equal(lines[1]?.nextBarrierDistancePct, 0.024);
  assert.equal(lines[1]?.tacticalRead, "firm");
  assert.equal(lines[2]?.supportCount, 1);
  assert.equal(lines[2]?.resistanceCount, 1);
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
        eventType: "breakout",
        severity: "critical",
        confidence: "high",
        score: 108.68,
        postingFamily: "bullish_resolution",
        postingDecisionReason: "posted",
        clearanceLabel: "tight",
        nextBarrierSide: "support",
        nextBarrierDistancePct: 0.011,
        tacticalRead: "tired",
      },
    }),
    /Discord rejected post/,
  );

  const line = JSON.parse(readFileSync(auditFilePath, "utf8").trim());
  assert.equal(line.operation, "post_alert");
  assert.equal(line.status, "failed");
  assert.equal(line.gatewayMode, "local");
  assert.equal(line.eventType, "breakout");
  assert.equal(line.postingFamily, "bullish_resolution");
  assert.equal(line.clearanceLabel, "tight");
  assert.equal(line.nextBarrierSide, "support");
  assert.equal(line.nextBarrierDistancePct, 0.011);
  assert.equal(line.tacticalRead, "tired");
  assert.match(line.error, /Discord rejected post/);
});
