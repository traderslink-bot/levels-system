import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { TradersLinkAiReadSettingsPersistence } from "../lib/ai/traderslink-ai-read-settings.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
describe("TradersLinkAiReadSettingsPersistence", () => {
  it("persists AI research and global card switches across restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "traderslink-ai-settings-"));
    tempDirectories.push(directory);
    const filePath = join(directory, "settings.json");
    const persistence = new TradersLinkAiReadSettingsPersistence({ filePath });

    assert.equal(persistence.load(), null);
    persistence.save({
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      externalResearchEnabled: false,
      generationEnabled: false,
      premarketGenerationEnabled: false,
      regularGenerationEnabled: true,
      postmarketGenerationEnabled: false,
      topRegularActivationGenerationEnabled: false,
      liveTraderReadCardVisible: false,
      potentialGainCardVisible: true,
      watchlistLifecycleLabelsVisible: true,
      reversalWatchlistVisible: false,
      topRegularWatchlistVisible: false,
      dailyCostBudgetEnabled: false,
      dailyCostBudgetUsd: 1,
    });
    assert.deepEqual(persistence.load(), {
      version: 9,
      automaticUpdatesEnabled: false,
      reviewBeforePublishingEnabled: true,
      lastUpdated: persistence.load()?.lastUpdated,
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      externalResearchEnabled: false,
      generationEnabled: false,
      premarketGenerationEnabled: false,
      regularGenerationEnabled: true,
      postmarketGenerationEnabled: false,
      topRegularActivationGenerationEnabled: false,
      liveTraderReadCardVisible: false,
      potentialGainCardVisible: true,
      watchlistLifecycleLabelsVisible: true,
      reversalWatchlistVisible: false,
      topRegularWatchlistVisible: false,
      dailyCostBudgetEnabled: false,
      dailyCostBudgetUsd: 1,
      automaticBoundaryRefreshesEnabled: true,
      automaticBoundaryRefreshesPerTicker: 2,
    });
  });

  it("migrates earlier settings with the daily cost guard safely off", () => {
    const directory = mkdtempSync(join(tmpdir(), "traderslink-ai-settings-migration-"));
    tempDirectories.push(directory);
    const filePath = join(directory, "settings.json");
    writeFileSync(filePath, JSON.stringify({
      version: 2,
      lastUpdated: 123,
      externalResearchEnabled: false,
      liveTraderReadCardVisible: true,
      potentialGainCardVisible: true,
    }));

    const loaded = new TradersLinkAiReadSettingsPersistence({ filePath }).load();
    assert.deepEqual(loaded, {
      version: 9,
      automaticUpdatesEnabled: false,
      reviewBeforePublishingEnabled: true,
      lastUpdated: 123,
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      externalResearchEnabled: false,
      generationEnabled: true,
      premarketGenerationEnabled: true,
      regularGenerationEnabled: true,
      postmarketGenerationEnabled: true,
      topRegularActivationGenerationEnabled: true,
      liveTraderReadCardVisible: true,
      potentialGainCardVisible: true,
      watchlistLifecycleLabelsVisible: false,
      reversalWatchlistVisible: true,
      topRegularWatchlistVisible: true,
      dailyCostBudgetEnabled: false,
      dailyCostBudgetUsd: 1,
      automaticBoundaryRefreshesEnabled: true,
      automaticBoundaryRefreshesPerTicker: 2,
    });
  });

  it("rejects malformed settings instead of enabling research", () => {
    const directory = mkdtempSync(join(tmpdir(), "traderslink-ai-settings-"));
    tempDirectories.push(directory);
    const filePath = join(directory, "settings.json");
    writeFileSync(filePath, JSON.stringify({ version: 1, externalResearchEnabled: "yes" }));
    const persistence = new TradersLinkAiReadSettingsPersistence({ filePath });

    assert.equal(persistence.load(), null);
    assert.match(readFileSync(filePath, "utf8"), /externalResearchEnabled/);
  });

  it("upgrades version 8 without losing boundary controls and preserves owner switches on other saves", () => {
    const directory = mkdtempSync(join(tmpdir(), "traderslink-ai-settings-v9-"));
    tempDirectories.push(directory);
    const filePath = join(directory, "settings.json");
    writeFileSync(filePath, JSON.stringify({
      version: 8, lastUpdated: 123, externalResearchEnabled: false,
      automaticBoundaryRefreshesEnabled: true, automaticBoundaryRefreshesPerTicker: 7,
    }));
    const persistence = new TradersLinkAiReadSettingsPersistence({ filePath });
    const loaded = persistence.load()!;
    assert.equal(loaded.automaticUpdatesEnabled, false);
    assert.equal(loaded.reviewBeforePublishingEnabled, true);
    assert.equal(loaded.automaticBoundaryRefreshesPerTicker, 7);
    persistence.save({ ...loaded, automaticUpdatesEnabled: true, reviewBeforePublishingEnabled: false });
    const { automaticUpdatesEnabled, reviewBeforePublishingEnabled, ...otherSettings } = loaded;
    persistence.save(otherSettings);
    assert.equal(persistence.load()?.automaticUpdatesEnabled, true);
    assert.equal(persistence.load()?.reviewBeforePublishingEnabled, false);
    persistence.save(false);
    assert.equal(persistence.load()?.automaticUpdatesEnabled, true);
    assert.equal(persistence.load()?.reviewBeforePublishingEnabled, false);
  });
});
