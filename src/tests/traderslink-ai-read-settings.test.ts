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
  it("persists the external research switch across restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "traderslink-ai-settings-"));
    tempDirectories.push(directory);
    const filePath = join(directory, "settings.json");
    const persistence = new TradersLinkAiReadSettingsPersistence({ filePath });

    assert.equal(persistence.load(), null);
    persistence.save(false);
    assert.equal(persistence.load()?.externalResearchEnabled, false);
    persistence.save(true);
    assert.equal(persistence.load()?.externalResearchEnabled, true);
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
