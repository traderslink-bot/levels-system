import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type TradersLinkAiReadSettings = {
  version: 1;
  lastUpdated: number;
  externalResearchEnabled: boolean;
};

export type TradersLinkAiReadSettingsPersistenceOptions = {
  filePath?: string;
};

const SETTINGS_VERSION = 1;
const DEFAULT_SETTINGS_FILE = resolve(
  process.cwd(),
  "artifacts",
  "traderslink-ai-read-settings.json",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateSettings(value: unknown): TradersLinkAiReadSettings | null {
  if (
    !isRecord(value) ||
    value.version !== SETTINGS_VERSION ||
    typeof value.lastUpdated !== "number" ||
    !Number.isFinite(value.lastUpdated) ||
    typeof value.externalResearchEnabled !== "boolean"
  ) {
    return null;
  }

  return {
    version: SETTINGS_VERSION,
    lastUpdated: value.lastUpdated,
    externalResearchEnabled: value.externalResearchEnabled,
  };
}

export class TradersLinkAiReadSettingsPersistence {
  private readonly filePath: string;

  constructor(options: TradersLinkAiReadSettingsPersistenceOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_SETTINGS_FILE;
  }

  getFilePath(): string {
    return this.filePath;
  }

  load(): TradersLinkAiReadSettings | null {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      const settings = validateSettings(parsed);
      if (!settings) {
        console.error(
          `[TradersLinkAiReadSettings] Discarded invalid settings file at ${this.filePath}.`,
        );
      }
      return settings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[TradersLinkAiReadSettings] Failed to load settings from ${this.filePath}: ${message}`,
        );
      }
      return null;
    }
  }

  save(externalResearchEnabled: boolean): TradersLinkAiReadSettings {
    const settings: TradersLinkAiReadSettings = {
      version: SETTINGS_VERSION,
      lastUpdated: Date.now(),
      externalResearchEnabled,
    };
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(tempFilePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.filePath);
    return settings;
  }
}
