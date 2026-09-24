import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WATCHLIST_MODELS, WATCHLIST_REASONING_EFFORTS, WATCHLIST_MODEL_PRICING, isWatchlistModel, isWatchlistReasoningEffort } from "../lib/ai/watchlist-model-options.js";
import { TradersLinkAiReadSettingsPersistence, DEFAULT_TRADERSLINK_AI_READ_MODEL, DEFAULT_TRADERSLINK_AI_READ_REASONING_EFFORT } from "../lib/ai/traderslink-ai-read-settings.js";

test("Watchlist supports all approved model and effort combinations without changing defaults", () => {
  const folder = mkdtempSync(join(tmpdir(), "watchlist-model-options-"));
  try {
    const settings = new TradersLinkAiReadSettingsPersistence({ filePath: join(folder, "settings.json") });
    settings.save(false);
    for (const model of WATCHLIST_MODELS) for (const reasoningEffort of WATCHLIST_REASONING_EFFORTS) {
      const previous = settings.load();
      assert(previous);
      settings.save({ ...previous, model, reasoningEffort });
      const loaded = settings.load();
      assert(loaded);
      assert.equal(loaded.model, model);
      assert.equal(loaded.reasoningEffort, reasoningEffort);
      const { model: _model, reasoningEffort: _effort, lastUpdated: _updated, ...other } = loaded;
      const { model: _previousModel, reasoningEffort: _previousEffort, lastUpdated: _oldUpdated, ...before } = previous;
      assert.deepEqual(other, before);
    }
    assert.equal(DEFAULT_TRADERSLINK_AI_READ_MODEL, "gpt-5.6-terra");
    assert.equal(DEFAULT_TRADERSLINK_AI_READ_REASONING_EFFORT, "medium");
    assert.equal(isWatchlistModel("gpt-6-terra"), false);
    assert.equal(isWatchlistReasoningEffort("ultra"), false);
    assert.equal(WATCHLIST_MODEL_PRICING["gpt-6-luna"].outputPer1M, 0.5);
    assert.equal(WATCHLIST_MODEL_PRICING["gpt-6-sol"].outputPer1M, 10);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
