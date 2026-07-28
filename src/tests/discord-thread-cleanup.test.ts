import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  filterThreadCleanupCandidates,
  loadThreadCleanupCandidatesFromDiscordAudit,
  loadThreadCleanupCandidatesFromWatchlistState,
} from "../lib/alerts/discord-thread-cleanup.js";

test("discord thread cleanup loads inactive thread ids from watchlist state", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "discord-cleanup-"));
  const statePath = join(tempDir, "manual-watchlist-state.json");
  writeFileSync(
    statePath,
    JSON.stringify({
      version: 1,
      lastUpdated: 1,
      entries: [
        {
          symbol: "ATER",
          active: false,
          lifecycle: "inactive",
          discordThreadId: "1491000000000000001",
          lastThreadPostAt: 1000,
        },
        {
          symbol: "BIYA",
          active: true,
          lifecycle: "active",
          discordThreadId: "1491000000000000002",
          lastThreadPostAt: 2000,
        },
        {
          symbol: "NOID",
          active: false,
          discordThreadId: null,
        },
      ],
    }),
    "utf8",
  );

  const candidates = loadThreadCleanupCandidatesFromWatchlistState(statePath);
  const inactiveOnly = filterThreadCleanupCandidates(candidates);
  const withActive = filterThreadCleanupCandidates(candidates, { includeActive: true });

  assert.equal(candidates.length, 2);
  assert.deepEqual(inactiveOnly.map((candidate) => candidate.symbol), ["ATER"]);
  assert.deepEqual(withActive.map((candidate) => candidate.symbol), ["ATER", "BIYA"]);
  assert.equal(inactiveOnly[0]?.threadId, "1491000000000000001");
  assert.equal(inactiveOnly[0]?.source, "watchlist_state");
});

test("discord thread cleanup can build candidates from audit rows and filter symbols", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "discord-cleanup-audit-"));
  const auditPath = join(tempDir, "discord-delivery-audit.jsonl");
  const rows = [
    {
      type: "discord_delivery_audit",
      operation: "create_thread",
      status: "posted",
      timestamp: 1000,
      symbol: "ATER",
      threadId: "1491000000000000001",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "ATER",
      threadId: "1491000000000000001",
    },
    {
      type: "discord_delivery_audit",
      operation: "create_thread",
      status: "posted",
      timestamp: 1500,
      symbol: "XTLB",
      threadId: "1491000000000000003",
    },
  ];
  writeFileSync(auditPath, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");

  const candidates = loadThreadCleanupCandidatesFromDiscordAudit(auditPath);
  const aterOnly = filterThreadCleanupCandidates(candidates, { symbols: ["ATER"] });

  assert.equal(candidates.length, 2);
  assert.equal(candidates.find((candidate) => candidate.symbol === "ATER")?.lastSeenAt, 2000);
  assert.deepEqual(aterOnly.map((candidate) => candidate.symbol), ["ATER"]);
  assert.equal(aterOnly[0]?.active, null);
  assert.equal(aterOnly[0]?.source, "discord_audit");
});
