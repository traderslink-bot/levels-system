import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type TradersLinkAiReadSettings = {
  version: 3;
  lastUpdated: number;
  externalResearchEnabled: boolean;
  liveTraderReadCardVisible: boolean;
  potentialGainCardVisible: boolean;
  dailyCostBudgetEnabled: boolean;
  dailyCostBudgetUsd: number;
};

export type TradersLinkAiReadSettingsPersistenceOptions = {
  filePath?: string;
};

const SETTINGS_VERSION = 3;
export const DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD = 1;
const MIN_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD = 0.01;
const MAX_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD = 10_000;
const DEFAULT_SETTINGS_FILE = resolve(
  process.cwd(),
  "artifacts",
  "traderslink-ai-read-settings.json",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeTradersLinkAiReadDailyCostBudgetUsd(
  value: unknown,
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD &&
    value <= MAX_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD
    ? Math.round(value * 100) / 100
    : null;
}

function validateSettings(value: unknown): TradersLinkAiReadSettings | null {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== SETTINGS_VERSION) ||
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
    liveTraderReadCardVisible:
      typeof value.liveTraderReadCardVisible === "boolean"
        ? value.liveTraderReadCardVisible
        : true,
    potentialGainCardVisible:
      typeof value.potentialGainCardVisible === "boolean"
        ? value.potentialGainCardVisible
        : true,
    dailyCostBudgetEnabled:
      typeof value.dailyCostBudgetEnabled === "boolean"
        ? value.dailyCostBudgetEnabled
        : false,
    dailyCostBudgetUsd:
      normalizeTradersLinkAiReadDailyCostBudgetUsd(value.dailyCostBudgetUsd) ??
      DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD,
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

  save(input: boolean | {
    externalResearchEnabled: boolean;
    liveTraderReadCardVisible: boolean;
    potentialGainCardVisible: boolean;
    dailyCostBudgetEnabled: boolean;
    dailyCostBudgetUsd: number;
  }): TradersLinkAiReadSettings {
    const values = typeof input === "boolean"
      ? {
          externalResearchEnabled: input,
          liveTraderReadCardVisible: true,
          potentialGainCardVisible: true,
          dailyCostBudgetEnabled: false,
          dailyCostBudgetUsd: DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD,
        }
      : input;
    const dailyCostBudgetUsd = normalizeTradersLinkAiReadDailyCostBudgetUsd(
      values.dailyCostBudgetUsd,
    );
    if (dailyCostBudgetUsd === null) {
      throw new Error(
        `dailyCostBudgetUsd must be between $${MIN_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD.toFixed(2)} and $${MAX_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD.toLocaleString("en-US", { minimumFractionDigits: 2 })}.`,
      );
    }
    const settings: TradersLinkAiReadSettings = {
      version: SETTINGS_VERSION,
      lastUpdated: Date.now(),
      ...values,
      dailyCostBudgetUsd,
    };
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(tempFilePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.filePath);
    return settings;
  }
}
