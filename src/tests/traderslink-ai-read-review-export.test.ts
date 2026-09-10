import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TradersLinkAiReadReviewStore } from "../lib/ai/traderslink-ai-read-review-store.js";
import { exportAnalysisReview } from "../lib/ai/traderslink-ai-read-review-export.js";

test("audit export selects one generation, retains its edits/approval and redacts credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "review-export-"));
  try {
    const store = new TradersLinkAiReadReviewStore(directory);
    store.begin("cycle", "PDSB", true, "owner");
    store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g1", payload: { symbol: "PDSB", currentRead: "original" } });
    store.saveDraft({ cycleId: "cycle", expectedHead: 2, actor: "owner", payload: { symbol: "PDSB", currentRead: "edited" } });
    store.approve("cycle", 3, 3, "owner");
    store.recordDelivery("cycle", 4, 4, "website", "acknowledged", "receipt");
    store.saveDraft({ cycleId: "cycle", expectedHead: 5, actor: "generator", generationId: "g2", payload: { symbol: "PDSB", currentRead: "not selected" } });
    const review = store.read("cycle")!;
    const before = JSON.stringify(review);
    const result = exportAnalysisReview({ review, generationId: "g1", secrets: ["test-private-secret"], diagnostics: { read: () => ({ version: 1, events: [{
      generationId: "g1", requestId: "r1", symbol: "PDSB", phase: "request", at: 1,
      payload: { api_key: "other-key", body: "test-private-secret", source: "https://example.com?token=hidden", cleanUrl: "https://example.com", input_tokens: 42 },
    }] }) } });
    const exported = JSON.stringify(result);
    assert.doesNotMatch(exported, /not selected|other-key|test-private-secret|token=hidden/);
    assert.match(exported, /original|edited/);
    assert.equal((result.selectedEvents as any[]).length, 4);
    assert.equal(result.diagnosticStatus, "available");
    assert.equal((result.diagnostic as any).events[0].payload.input_tokens, 42);
    assert.equal((result.diagnostic as any).events[0].payload.cleanUrl, "https://example.com");
    assert.equal(JSON.stringify(review), before);
    let reads = 0;
    assert.throws(() => exportAnalysisReview({ review, generationId: "other", diagnostics: { read: () => { reads++; return null; } } }));
    assert.equal(reads, 0);
    assert.equal(exportAnalysisReview({ review, generationId: "g1", diagnostics: { read: () => null } }).diagnosticStatus, "not_captured_or_no_longer_available");
    assert.equal(exportAnalysisReview({ review, generationId: "g1", diagnostics: { read: () => { throw new Error("private path"); } } }).diagnosticStatus, "unavailable");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
