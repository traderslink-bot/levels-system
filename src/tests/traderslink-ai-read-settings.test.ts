import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEFAULT_TRADERSLINK_AI_READ_PER_TICKER_DAILY_COST_BUDGET_USD,
  TradersLinkAiReadSettingsPersistence,
} from "../lib/ai/traderslink-ai-read-settings.js";

test("AI Read settings upgrade older files with the safe per-ticker daily default", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-read-settings-legacy-"));
  try {
    const filePath = join(directory, "settings.json");
    writeFileSync(filePath, JSON.stringify({
      version: 5,
      lastUpdated: 1,
      externalResearchEnabled: false,
      liveTraderReadCardVisible: true,
      potentialGainCardVisible: true,
      watchlistLifecycleLabelsVisible: false,
      reversalWatchlistVisible: true,
      dailyCostBudgetEnabled: true,
      dailyCostBudgetUsd: 2.95,
    }));
    const persistence = new TradersLinkAiReadSettingsPersistence({ filePath });

    const settings = persistence.load();

    assert.equal(
      settings?.perTickerDailyCostBudgetUsd,
      DEFAULT_TRADERSLINK_AI_READ_PER_TICKER_DAILY_COST_BUDGET_USD,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AI Read settings persist the configurable per-ticker daily limit", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-read-settings-ticker-"));
  try {
    const filePath = join(directory, "settings.json");
    const persistence = new TradersLinkAiReadSettingsPersistence({ filePath });
    const saved = persistence.save({
      externalResearchEnabled: false,
      liveTraderReadCardVisible: true,
      potentialGainCardVisible: true,
      watchlistLifecycleLabelsVisible: false,
      reversalWatchlistVisible: true,
      dailyCostBudgetEnabled: true,
      dailyCostBudgetUsd: 2.95,
      perTickerDailyCostBudgetUsd: 0.3,
    });

    assert.equal(saved.version, 6);
    assert.equal(saved.perTickerDailyCostBudgetUsd, 0.3);
    assert.equal(
      JSON.parse(readFileSync(filePath, "utf8")).perTickerDailyCostBudgetUsd,
      0.3,
    );
    assert.throws(
      () => persistence.save({
        ...saved,
        perTickerDailyCostBudgetUsd: 0,
      }),
      /perTickerDailyCostBudgetUsd/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
