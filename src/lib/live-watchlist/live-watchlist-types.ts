import type {
  AlertPayload,
  LevelExtensionPayload,
  LevelSnapshotDisplayZone,
  LevelSnapshotPayload,
} from "../alerts/alert-types.js";

export type LiveWatchlistCardKind =
  | "companyInfo"
  | "fullLadder"
  | "nearestSupportResistance"
  | "liveTraderRead"
  | "tradersLinkAiRead"
  | "marketStructure"
  | "recentNewsFilings";

export type LiveWatchlistStatus = "live" | "stale" | "deactivated";
export type LiveWatchlistMarketDataStatus = "live" | "stale" | "offline" | "starting";

export type LiveWatchlistCardContent = {
  title: string;
  body: string;
  updatedAt: number;
  priceWhenPosted: number | null;
  source: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type LiveWatchlistCardPatch = {
  symbol: string;
  status?: LiveWatchlistStatus;
  updatedAt: number;
  tradersLinkAiReadCardVisible?: boolean;
  cards: Partial<Record<LiveWatchlistCardKind, LiveWatchlistCardContent | null>>;
  levelMap?: LiveWatchlistLevelMap | null;
};

export type LiveWatchlistHealthPatch = {
  type: "health";
  marketDataStatus: LiveWatchlistMarketDataStatus;
  marketDataUpdatedAt: number;
};

export type LiveWatchlistTickerDataPatch = {
  type: "tickerData";
  symbol: string;
  status?: LiveWatchlistStatus;
  updatedAt: number;
  tradersLinkAiReadCardVisible?: boolean;
  latestPrice: number;
  nearestSupport: number | null;
  nearestResistance: number | null;
  nearestSupportLabel?: string | null;
  nearestResistanceLabel?: string | null;
};

export type TradersLinkAiReadBias = "bullish" | "neutral" | "bearish" | "mixed";
export type TradersLinkAiReadConfidence = "low" | "medium" | "high";
export type TradersLinkAiReadMarketSession =
  | "premarket"
  | "regular"
  | "postmarket"
  | "closed"
  | "unknown";

export type TradersLinkAiReadLevel = {
  label: string;
  price: number | null;
  rationale: string;
};

export type TradersLinkAiReadTarget = {
  label: string;
  price: number | null;
  condition: string;
};

export type TradersLinkAiReadSource = {
  title: string;
  url: string;
  sourceType: "press_release_sec_database" | "web_search";
};

export type TradersLinkAiReadCatalystStatus =
  | "confirmed"
  | "conditional"
  | "unverified"
  | "none";
export type TradersLinkAiReadDilutionLevel = "none" | "low" | "medium" | "high" | "unknown";
export type TradersLinkAiReadDilutionTimingStatus =
  | "immediate"
  | "near_term"
  | "conditional"
  | "delayed"
  | "unknown"
  | "none";
export type TradersLinkAiReadDilutionTrigger =
  | "already_issued"
  | "closing"
  | "settlement"
  | "shareholder_approval"
  | "registration_effective"
  | "resale_registration"
  | "warrant_exercise"
  | "conversion"
  | "purchase_trigger"
  | "lockup_expiry"
  | "merger_closing"
  | "unknown"
  | "none";
export type TradersLinkAiReadListingStatus =
  | "none"
  | "deficiency_notice"
  | "staff_determination"
  | "hearing_requested"
  | "hearing_pending"
  | "extension_or_exception"
  | "suspension_scheduled"
  | "delisted"
  | "unknown";
export type TradersLinkAiReadListingImmediacy =
  | "background"
  | "monitor"
  | "near_term"
  | "immediate"
  | "unknown";

export type TradersLinkAiReadCatalystContext = {
  summary: string;
  status: TradersLinkAiReadCatalystStatus;
  dayTradeRelevance: string;
  sourceUrls: string[];
};

export type TradersLinkAiReadDilutionRisk = {
  level: TradersLinkAiReadDilutionLevel;
  summary: string;
  dayTradeRelevance: string;
  sourceUrls: string[];
  canCompanyIssueToday: boolean | null;
  companyIssuance: TradersLinkAiReadDilutionTimingLane;
  publicResale: TradersLinkAiReadDilutionTimingLane;
};

export type TradersLinkAiReadDilutionTimingLane = {
  status: TradersLinkAiReadDilutionTimingStatus;
  earliestDate: string | null;
  trigger: TradersLinkAiReadDilutionTrigger;
  summary: string;
};

export type TradersLinkAiReadUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  webSearchCallCount: number;
  tokenCostUsd: number | null;
  webSearchCostUsd: number;
  estimatedTotalCostUsd: number | null;
  pricing: {
    source: "built_in" | "env_override" | "unknown";
    inputPer1M: number | null;
    cachedInputPer1M: number | null;
    outputPer1M: number | null;
    webSearchPer1KCalls: number;
  };
};

export type TradersLinkAiReadListingContext = {
  status: TradersLinkAiReadListingStatus;
  immediacy: TradersLinkAiReadListingImmediacy;
  summary: string;
  dayTradeRelevance: string;
  sourceUrls: string[];
};

export type TradersLinkAiReadPayload = {
  version: 2;
  symbol: string;
  generatedAt: number;
  dataAsOf: number;
  currentPrice: number;
  marketSession: TradersLinkAiReadMarketSession;
  bias: TradersLinkAiReadBias;
  confidence: TradersLinkAiReadConfidence;
  currentRead: string;
  needsToHold: TradersLinkAiReadLevel;
  cautionBelow: TradersLinkAiReadLevel;
  momentumFailure: TradersLinkAiReadLevel;
  mustClear: TradersLinkAiReadLevel;
  breakoutContinuation: TradersLinkAiReadLevel;
  targets: TradersLinkAiReadTarget[];
  downsideCheckpoints: TradersLinkAiReadTarget[];
  catalystRealityCheck: TradersLinkAiReadCatalystContext;
  dilutionRisk: TradersLinkAiReadDilutionRisk;
  listingStatus: TradersLinkAiReadListingContext;
  riskSummary: string[];
  sources: TradersLinkAiReadSource[];
  model: string;
  usedWebSearch: boolean;
  usage: TradersLinkAiReadUsage;
};

export type LiveWatchlistPublisher = {
  publish(patch: LiveWatchlistCardPatch): Promise<void>;
  publishHealth?(patch: LiveWatchlistHealthPatch): Promise<void>;
  publishTickerData?(patch: LiveWatchlistTickerDataPatch): Promise<void>;
};

export type LiveWatchlistHttpPublisherOptions = {
  ingestUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  onError?: (
    error: unknown,
    patch: LiveWatchlistCardPatch | LiveWatchlistHealthPatch | LiveWatchlistTickerDataPatch,
  ) => void;
};

export type LiveWatchlistNearestLevel = {
  price: number;
  distancePct: number;
  strengthLabel?: LevelSnapshotDisplayZone["strengthLabel"];
  sourceLabel?: string;
};

export type LiveWatchlistLevelEvidenceStatus =
  | "detected_structure"
  | "historically_tested"
  | "synthetic_planning";

export type LiveWatchlistLevelMapLevel = {
  side: "support" | "resistance";
  price: number;
  lowPrice?: number;
  highPrice?: number;
  distancePct: number;
  lowDistancePct?: number;
  highDistancePct?: number;
  strengthLabel?: LevelSnapshotDisplayZone["strengthLabel"];
  freshness?: LevelSnapshotDisplayZone["freshness"];
  sourceLabel?: string | null;
  evidenceCount?: number;
  firstEvidenceAt?: number;
  lastEvidenceAt?: number;
  timeframes?: Array<"daily" | "4h" | "5m">;
  isClustered?: boolean;
  evidenceStatus?: LiveWatchlistLevelEvidenceStatus;
  roleFlipState?: "original" | "testing" | "confirmed";
  label: string;
};

export type LiveWatchlistLevelMapRangeState = "tight" | "normal" | "wide";

export type LiveWatchlistLevelMap = {
  currentPrice: number;
  rangeState: LiveWatchlistLevelMapRangeState;
  nearestSupport: LiveWatchlistLevelMapLevel | null;
  nearestResistance: LiveWatchlistLevelMapLevel | null;
  nextStrongSupport: LiveWatchlistLevelMapLevel | null;
  nextStrongResistance: LiveWatchlistLevelMapLevel | null;
  supportLevels: LiveWatchlistLevelMapLevel[];
  resistanceLevels: LiveWatchlistLevelMapLevel[];
};

export type LiveWatchlistSnapshotSource =
  | { kind: "level_snapshot"; payload: LevelSnapshotPayload }
  | { kind: "level_extension"; payload: LevelExtensionPayload }
  | { kind: "alert"; payload: AlertPayload };
