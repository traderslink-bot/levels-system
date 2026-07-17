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
      externalResearchEnabled: false,
      liveTraderReadCardVisible: false,
      potentialGainCardVisible: true,
      dailyCostBudgetEnabled: false,
      dailyCostBudgetUsd: 1,
    });
    assert.deepEqual(persistence.load(), {
      version: 3,
      lastUpdated: persistence.load()?.lastUpdated,
      externalResearchEnabled: false,
      liveTraderReadCardVisible: false,
      potentialGainCardVisible: true,
      dailyCostBudgetEnabled: false,
      dailyCostBudgetUsd: 1,
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
      version: 3,
      lastUpdated: 123,
      externalResearchEnabled: false,
      liveTraderReadCardVisible: true,
      potentialGainCardVisible: true,
      dailyCostBudgetEnabled: false,
      dailyCostBudgetUsd: 1,
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
});
