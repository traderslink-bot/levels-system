import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type TradersLinkAiReadSettings = {
  version: 6;
  lastUpdated: number;
  externalResearchEnabled: boolean;
  liveTraderReadCardVisible: boolean;
  potentialGainCardVisible: boolean;
  watchlistLifecycleLabelsVisible: boolean;
  reversalWatchlistVisible: boolean;
  dailyCostBudgetEnabled: boolean;
  dailyCostBudgetUsd: number;
  perTickerDailyCostBudgetUsd: number;
};

export type TradersLinkAiReadSettingsPersistenceOptions = {
  filePath?: string;
};

const SETTINGS_VERSION = 6;
export const DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD = 1;
export const DEFAULT_TRADERSLINK_AI_READ_PER_TICKER_DAILY_COST_BUDGET_USD = 0.25;
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
    typeof value.version !== "number" ||
    ![1, 2, 3, 4, 5, SETTINGS_VERSION].includes(value.version) ||
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
    watchlistLifecycleLabelsVisible:
      typeof value.watchlistLifecycleLabelsVisible === "boolean"
        ? value.watchlistLifecycleLabelsVisible
        : false,
    reversalWatchlistVisible:
      typeof value.reversalWatchlistVisible === "boolean"
        ? value.reversalWatchlistVisible
        : true,
    dailyCostBudgetEnabled:
      typeof value.dailyCostBudgetEnabled === "boolean"
        ? value.dailyCostBudgetEnabled
        : false,
    dailyCostBudgetUsd:
      normalizeTradersLinkAiReadDailyCostBudgetUsd(value.dailyCostBudgetUsd) ??
      DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD,
    perTickerDailyCostBudgetUsd:
      normalizeTradersLinkAiReadDailyCostBudgetUsd(value.perTickerDailyCostBudgetUsd) ??
      DEFAULT_TRADERSLINK_AI_READ_PER_TICKER_DAILY_COST_BUDGET_USD,
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
    watchlistLifecycleLabelsVisible: boolean;
    reversalWatchlistVisible: boolean;
    dailyCostBudgetEnabled: boolean;
    dailyCostBudgetUsd: number;
    perTickerDailyCostBudgetUsd: number;
  }): TradersLinkAiReadSettings {
    const values = typeof input === "boolean"
      ? {
          externalResearchEnabled: input,
          liveTraderReadCardVisible: true,
          potentialGainCardVisible: true,
          watchlistLifecycleLabelsVisible: false,
          reversalWatchlistVisible: true,
          dailyCostBudgetEnabled: false,
          dailyCostBudgetUsd: DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD,
          perTickerDailyCostBudgetUsd:
            DEFAULT_TRADERSLINK_AI_READ_PER_TICKER_DAILY_COST_BUDGET_USD,
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
    const perTickerDailyCostBudgetUsd = normalizeTradersLinkAiReadDailyCostBudgetUsd(
      values.perTickerDailyCostBudgetUsd,
    );
    if (perTickerDailyCostBudgetUsd === null) {
      throw new Error(
        `perTickerDailyCostBudgetUsd must be between $${MIN_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD.toFixed(2)} and $${MAX_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD.toLocaleString("en-US", { minimumFractionDigits: 2 })}.`,
      );
    }
    const settings: TradersLinkAiReadSettings = {
      version: SETTINGS_VERSION,
      lastUpdated: Date.now(),
      ...values,
      dailyCostBudgetUsd,
      perTickerDailyCostBudgetUsd,
    };
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(tempFilePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.filePath);
    return settings;
  }
}
