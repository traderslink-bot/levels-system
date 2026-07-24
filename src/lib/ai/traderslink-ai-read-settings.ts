import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type TradersLinkAiReadSettings = {
  version: 8;
  lastUpdated: number;
  model: "gpt-5.6-luna" | "gpt-5.6-terra";
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  externalResearchEnabled: boolean;
  generationEnabled: boolean;
  premarketGenerationEnabled: boolean;
  regularGenerationEnabled: boolean;
  postmarketGenerationEnabled: boolean;
  topRegularActivationGenerationEnabled: boolean;
  liveTraderReadCardVisible: boolean;
  potentialGainCardVisible: boolean;
  watchlistLifecycleLabelsVisible: boolean;
  reversalWatchlistVisible: boolean;
  topRegularWatchlistVisible: boolean;
  dailyCostBudgetEnabled: boolean;
  dailyCostBudgetUsd: number;
  automaticBoundaryRefreshesEnabled: boolean;
  automaticBoundaryRefreshesPerTicker: number;
};

export type TradersLinkAiReadSettingsPersistenceOptions = {
  filePath?: string;
};

const SETTINGS_VERSION = 8;
export const DEFAULT_TRADERSLINK_AI_READ_MODEL = "gpt-5.6-terra" as const;
export const DEFAULT_TRADERSLINK_AI_READ_REASONING_EFFORT = "medium" as const;
export const DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD = 1;
export const DEFAULT_TRADERSLINK_AI_READ_AUTOMATIC_BOUNDARY_REFRESHES_PER_TICKER = 2;
const MIN_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD = 0.01;
const MAX_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD = 10_000;
const MAX_TRADERSLINK_AI_READ_AUTOMATIC_BOUNDARY_REFRESHES_PER_TICKER = 1_000;
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

export function normalizeTradersLinkAiReadAutomaticBoundaryRefreshesPerTicker(
  value: unknown,
): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_TRADERSLINK_AI_READ_AUTOMATIC_BOUNDARY_REFRESHES_PER_TICKER
    ? value
    : null;
}

function validateSettings(value: unknown): TradersLinkAiReadSettings | null {
  if (
    !isRecord(value) ||
    ![1, 2, 3, 4, 5, 6, 7, SETTINGS_VERSION].includes(value.version as number) ||
    typeof value.lastUpdated !== "number" ||
    !Number.isFinite(value.lastUpdated) ||
    typeof value.externalResearchEnabled !== "boolean"
  ) {
    return null;
  }

  return {
    version: SETTINGS_VERSION,
    lastUpdated: value.lastUpdated,
    model:
      value.model === "gpt-5.6-luna" || value.model === "gpt-5.6-terra"
        ? value.model
        : DEFAULT_TRADERSLINK_AI_READ_MODEL,
    reasoningEffort:
      value.reasoningEffort === "low" ||
      value.reasoningEffort === "medium" ||
      value.reasoningEffort === "high" ||
      value.reasoningEffort === "xhigh"
        ? value.reasoningEffort
        : DEFAULT_TRADERSLINK_AI_READ_REASONING_EFFORT,
    externalResearchEnabled: value.externalResearchEnabled,
    generationEnabled:
      typeof value.generationEnabled === "boolean" ? value.generationEnabled : true,
    premarketGenerationEnabled:
      typeof value.premarketGenerationEnabled === "boolean"
        ? value.premarketGenerationEnabled
        : true,
    regularGenerationEnabled:
      typeof value.regularGenerationEnabled === "boolean"
        ? value.regularGenerationEnabled
        : true,
    postmarketGenerationEnabled:
      typeof value.postmarketGenerationEnabled === "boolean"
        ? value.postmarketGenerationEnabled
        : true,
    topRegularActivationGenerationEnabled:
      typeof value.topRegularActivationGenerationEnabled === "boolean"
        ? value.topRegularActivationGenerationEnabled
        : true,
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
    topRegularWatchlistVisible:
      typeof value.topRegularWatchlistVisible === "boolean"
        ? value.topRegularWatchlistVisible
        : true,
    dailyCostBudgetEnabled:
      typeof value.dailyCostBudgetEnabled === "boolean"
        ? value.dailyCostBudgetEnabled
        : false,
    dailyCostBudgetUsd:
      normalizeTradersLinkAiReadDailyCostBudgetUsd(value.dailyCostBudgetUsd) ??
      DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD,
    automaticBoundaryRefreshesEnabled:
      typeof value.automaticBoundaryRefreshesEnabled === "boolean"
        ? value.automaticBoundaryRefreshesEnabled
        : true,
    automaticBoundaryRefreshesPerTicker:
      normalizeTradersLinkAiReadAutomaticBoundaryRefreshesPerTicker(
        value.automaticBoundaryRefreshesPerTicker,
      ) ?? DEFAULT_TRADERSLINK_AI_READ_AUTOMATIC_BOUNDARY_REFRESHES_PER_TICKER,
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
    model?: "gpt-5.6-luna" | "gpt-5.6-terra";
    reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    externalResearchEnabled: boolean;
    generationEnabled?: boolean;
    premarketGenerationEnabled?: boolean;
    regularGenerationEnabled?: boolean;
    postmarketGenerationEnabled?: boolean;
    topRegularActivationGenerationEnabled?: boolean;
    liveTraderReadCardVisible: boolean;
    potentialGainCardVisible: boolean;
    watchlistLifecycleLabelsVisible: boolean;
    reversalWatchlistVisible: boolean;
    topRegularWatchlistVisible?: boolean;
    dailyCostBudgetEnabled: boolean;
    dailyCostBudgetUsd: number;
    automaticBoundaryRefreshesEnabled?: boolean;
    automaticBoundaryRefreshesPerTicker?: number;
  }): TradersLinkAiReadSettings {
    const existing = this.load();
    const rawValues = typeof input === "boolean"
      ? {
          model: existing?.model ?? DEFAULT_TRADERSLINK_AI_READ_MODEL,
          reasoningEffort:
            existing?.reasoningEffort ?? DEFAULT_TRADERSLINK_AI_READ_REASONING_EFFORT,
          externalResearchEnabled: input,
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
          dailyCostBudgetUsd: DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD,
          automaticBoundaryRefreshesEnabled: true,
          automaticBoundaryRefreshesPerTicker:
            DEFAULT_TRADERSLINK_AI_READ_AUTOMATIC_BOUNDARY_REFRESHES_PER_TICKER,
        }
      : input;
    const values = {
      ...rawValues,
      model: rawValues.model ?? existing?.model ?? DEFAULT_TRADERSLINK_AI_READ_MODEL,
      reasoningEffort:
        rawValues.reasoningEffort ??
        existing?.reasoningEffort ??
        DEFAULT_TRADERSLINK_AI_READ_REASONING_EFFORT,
      generationEnabled: rawValues.generationEnabled ?? true,
      premarketGenerationEnabled: rawValues.premarketGenerationEnabled ?? true,
      regularGenerationEnabled: rawValues.regularGenerationEnabled ?? true,
      postmarketGenerationEnabled: rawValues.postmarketGenerationEnabled ?? true,
      topRegularActivationGenerationEnabled:
        rawValues.topRegularActivationGenerationEnabled ?? true,
      topRegularWatchlistVisible: rawValues.topRegularWatchlistVisible ?? true,
      automaticBoundaryRefreshesEnabled:
        rawValues.automaticBoundaryRefreshesEnabled ??
        existing?.automaticBoundaryRefreshesEnabled ??
        true,
      automaticBoundaryRefreshesPerTicker:
        rawValues.automaticBoundaryRefreshesPerTicker ??
        existing?.automaticBoundaryRefreshesPerTicker ??
        DEFAULT_TRADERSLINK_AI_READ_AUTOMATIC_BOUNDARY_REFRESHES_PER_TICKER,
    };
    const dailyCostBudgetUsd = normalizeTradersLinkAiReadDailyCostBudgetUsd(
      values.dailyCostBudgetUsd,
    );
    if (dailyCostBudgetUsd === null) {
      throw new Error(
        `dailyCostBudgetUsd must be between $${MIN_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD.toFixed(2)} and $${MAX_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD.toLocaleString("en-US", { minimumFractionDigits: 2 })}.`,
      );
    }
    const automaticBoundaryRefreshesPerTicker =
      normalizeTradersLinkAiReadAutomaticBoundaryRefreshesPerTicker(
        values.automaticBoundaryRefreshesPerTicker,
      );
    if (automaticBoundaryRefreshesPerTicker === null) {
      throw new Error(
        "automaticBoundaryRefreshesPerTicker must be a whole number between 0 and 1,000.",
      );
    }
    const settings: TradersLinkAiReadSettings = {
      version: SETTINGS_VERSION,
      lastUpdated: Date.now(),
      ...values,
      dailyCostBudgetUsd,
      automaticBoundaryRefreshesPerTicker,
    };
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(tempFilePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.filePath);
    return settings;
  }
}
