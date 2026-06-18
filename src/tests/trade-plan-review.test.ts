import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendTradePlanReviewNote,
  buildTradePlanReviewPayload,
} from "../runtime/trade-plan-review.js";
import { TRADE_PLAN_REVIEW_PAGE } from "../runtime/trade-plan-review-page.js";

function writeSession(rows: object[]): string {
  const directory = mkdtempSync(join(tmpdir(), "trade-plan-review-"));
  writeFileSync(
    join(directory, "discord-delivery-audit.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n"),
  );
  return directory;
}

test("trade plan review derives zones from snapshot trade map and ladder", () => {
  const session = writeSession([
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1000,
      symbol: "VRAX",
      title: "VRAX support and resistance",
      messageKind: "level_snapshot",
      body:
        "VRAX support and resistance\nPrice: 0.3699\nTrade map:\nCurrent structure: VRAX is range-bound.\nCleaner above: acceptance above major resistance 0.3870-0.4019 area would shift attention higher.\nSupport that matters: heavy support 0.3500 is the first practical area buyers need to keep defending.\nBroader support: a clean loss of heavy support 0.3500 shifts attention lower.",
      snapshotAudit: {
        referencePrice: 0.3699,
        supportCandidates: [
          {
            side: "support",
            representativePrice: 0.35,
            zoneLow: 0.35,
            zoneHigh: 0.35,
            strengthLabel: "heavy",
            sourceLabel: "daily structure",
            displayed: true,
          },
        ],
        resistanceCandidates: [
          {
            side: "resistance",
            representativePrice: 0.387,
            zoneLow: 0.387,
            zoneHigh: 0.4019,
            strengthLabel: "major",
            sourceLabel: "clustered levels",
            displayed: true,
          },
        ],
      },
    },
  ]);

  const payload = buildTradePlanReviewPayload(session);
  const item = payload.items[0];

  assert.equal(payload.totals.posts, 1);
  assert.equal(item?.symbol, "VRAX");
  assert.match(item?.derivedPlan.breakZone ?? "", /acceptance above major resistance/);
  assert.match(item?.derivedPlan.supportThatMustHold ?? "", /heavy support 0\.3500/);
  assert.equal(item?.levels.nearestSupport?.representative, 0.35);
  assert.equal(item?.levels.nearestResistance?.representative, 0.387);
});

test("trade plan review saves latest note per post", () => {
  const session = writeSession([
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "AMST",
      title: "AMST level touch",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
      body: "price testing support. What to watch: buyers stabilize at 2.40.",
    },
  ]);
  const itemId = buildTradePlanReviewPayload(session).items[0]?.id;
  assert.ok(itemId);

  appendTradePlanReviewNote(session, {
    itemId,
    symbol: "AMST",
    verdict: "needs_work",
    notes: "Buy-zone wording is too vague.",
    tags: ["wording", "zone"],
  });

  const payload = buildTradePlanReviewPayload(session);
  assert.equal(payload.items[0]?.note?.verdict, "needs_work");
  assert.equal(payload.items[0]?.note?.notes, "Buy-zone wording is too vague.");
  assert.match(readFileSync(join(session, "trade-plan-review-notes.jsonl"), "utf8"), /Buy-zone wording/);
});

test("trade plan review page uses safe text rendering and note endpoint", () => {
  assert.match(TRADE_PLAN_REVIEW_PAGE, /Trade Plan Review/);
  assert.match(TRADE_PLAN_REVIEW_PAGE, /Buy-Zone Candidate/);
  assert.match(TRADE_PLAN_REVIEW_PAGE, /\/api\/trade-plan-review/);
  assert.match(TRADE_PLAN_REVIEW_PAGE, /\/api\/trade-plan-review\/notes/);
  assert.doesNotMatch(TRADE_PLAN_REVIEW_PAGE, /innerHTML\s*\+=/);
});
