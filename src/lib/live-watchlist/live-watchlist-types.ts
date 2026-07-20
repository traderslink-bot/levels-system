import type {
  AlertPayload,
  LevelExtensionPayload,
  LevelSnapshotDisplayZone,
  LevelSnapshotPayload,
} from "../alerts/alert-types.js";

export type LiveWatchlistCardKind =
  | "companyInfo"
  | "levelMap"
  | "fullLadder"
  | "nearestSupportResistance"
  | "liveTraderRead"
  | "tradersLinkAiRead"
  | "marketStructure"
  | "technicalContext"
  | "recentNewsFilings"
  | "extendedQuote";

export type LiveWatchlistStatus = "live" | "stale" | "deactivated";
export type LiveWatchlistSlotState = "active" | "followup";
export type LiveWatchlistMarketDataStatus = "live" | "stale" | "offline" | "starting";
export type LiveWatchlistLifecycleStatus =
  | "monitoring"
  | "active"
  | "pullback_watch"
  | "recovery_watch"
  | "recovery_attempt"
  | "setup_fading"
  | "standby";

export type LiveWatchlistLifecycleRead = {
  status: LiveWatchlistLifecycleStatus;
  label: "Analysis Pending" | "Momentum Holding" | "Pullback Watch" | "Recovery Watch" | "Recovery Attempt" | "Setup Fading" | "Standby";
  reason: string;
  updatedAt: number;
};

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
  firstPostedAt?: number | null;
  watchlistSlotState?: LiveWatchlistSlotState;
  preserveExistingOnReactivation?: boolean;
  potentialGainCardVisible?: boolean;
  watchlistLifecycleLabelsVisible?: boolean;
  watchlistLifecycle?: LiveWatchlistLifecycleRead | null;
  tradersLinkAiReadCardVisible?: boolean;
  tradersLinkAiReadDipBuyPlanVisible?: boolean;
  levelMap?: LiveWatchlistLevelMap | null;
  cards: Partial<Record<LiveWatchlistCardKind, LiveWatchlistCardContent | null>>;
};

export type LiveWatchlistHealthPatch = {
  type: "health";
  marketDataStatus: LiveWatchlistMarketDataStatus;
  marketDataUpdatedAt: number | null;
};

export type LiveWatchlistTickerDataPatch = {
  type: "tickerData";
  symbol: string;
  status?: LiveWatchlistStatus;
  updatedAt: number;
  marketDataObservedAt?: number;
  marketDataRevision?: number;
  watchlistSlotState?: LiveWatchlistSlotState;
  potentialGainCardVisible?: boolean;
  watchlistLifecycleLabelsVisible?: boolean;
  watchlistLifecycle?: LiveWatchlistLifecycleRead | null;
  tradersLinkAiReadCardVisible?: boolean;
  tradersLinkAiReadDipBuyPlanVisible?: boolean;
  latestPrice: number;
  nearestSupport: number | null;
  nearestResistance: number | null;
  nearestSupportLabel?: string | null;
  nearestResistanceLabel?: string | null;
  levelMap?: LiveWatchlistLevelMap | null;
  volume?: number | null;
  extendedQuote?: LiveWatchlistExtendedQuote | null;
  priorRegularClosePrice?: number | null;
  moveFromPriorRegularClosePct?: number | null;
  priorRegularCloseSource?: string | null;
};

export type LiveWatchlistExtendedQuote = {
  source: "eodhd_live_v2";
  symbol: string;
  providerSymbol: string;
  updatedAt: number;
  fetchedAt: number;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  lastTradePrice: number | null;
  lastTradeSize: number | null;
  lastTradeTime: number | null;
  bidPrice: number | null;
  bidSize: number | null;
  bidTime: number | null;
  askPrice: number | null;
  askSize: number | null;
  askTime: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  previousClosePrice: number | null;
  ethPrice: number | null;
  ethVolume: number | null;
  ethTime: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  sharesFloat: number | null;
  timestamp: number | null;
};

export type LiveWatchlistExtendedQuoteProvider = {
  getExtendedQuote(symbol: string): Promise<LiveWatchlistExtendedQuote | null>;
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

export type TradersLinkAiReadSourceEvidence = {
  publishedAt: string | null;
  filingType: string | null;
  retrievedAt: string | null;
  supportingExcerpt: string | null;
  excerptKind: "article_summary" | "article_title" | "web_search_title";
  supersessionStatus: "latest_in_retrieved_window" | "not_checked";
};

export type TradersLinkAiReadSource = {
  title: string;
  url: string;
  sourceType: "press_release_sec_database" | "web_search";
  evidence?: TradersLinkAiReadSourceEvidence;
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

export type TradersLinkAiReadDilutionTimingLane = {
  status: TradersLinkAiReadDilutionTimingStatus;
  earliestDate: string | null;
  trigger: TradersLinkAiReadDilutionTrigger;
  summary: string;
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
  /** Immutable id assigned before the first provider attempt for this read. */
  generationId: string;
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
  externalResearchEnabled: boolean;
  usedWebSearch: boolean;
  usage: TradersLinkAiReadUsage;
};

export type LiveWatchlistPublishedPatch =
  | LiveWatchlistCardPatch
  | LiveWatchlistHealthPatch
  | LiveWatchlistTickerDataPatch;

export type LiveWatchlistPublisher = {
  publish(patch: LiveWatchlistCardPatch): Promise<void>;
  publishHealth?(patch: LiveWatchlistHealthPatch): Promise<void>;
  publishTickerData?(patch: LiveWatchlistTickerDataPatch): Promise<void>;
  /** Optional durable-publisher acknowledgement, including replayed outbox items. */
  onPublished?(listener: (patch: LiveWatchlistPublishedPatch) => void): () => void;
  replayPending?(): Promise<void>;
  /** Flushes any buffered local audit persistence without delaying normal publishes. */
  flushPending?(): Promise<void>;
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

export type LiveWatchlistLevelMapRangeState = "tight" | "normal" | "wide";

export type LiveWatchlistAtrDistanceState =
  | "inside_normal_noise"
  | "nearby"
  | "meaningful"
  | "substantial";

export type LiveWatchlistLevelMapLevel = {
  side: "support" | "resistance";
  price: number;
  lowPrice?: number;
  highPrice?: number;
  distancePct: number;
  distanceAtr?: number;
  atrDistanceState?: LiveWatchlistAtrDistanceState;
  strengthLabel?: LevelSnapshotDisplayZone["strengthLabel"];
  freshness?: LevelSnapshotDisplayZone["freshness"];
  touchCount?: number;
  confluenceCount?: number;
  reactionQualityScore?: number;
  rejectionScore?: number;
  displacementScore?: number;
  sessionSignificanceScore?: number;
  sourceEvidenceCount?: number;
  sourceLabel?: string | null;
  marketDataProvenance?: LevelSnapshotDisplayZone["marketDataProvenance"];
  roleFlipFromSide?: "support" | "resistance" | null;
  roleFlipState?: "original" | "testing" | "confirmed";
  label: string;
};

export type LiveWatchlistLevelDataQuality = {
  status: "full" | "limited" | "unavailable";
  availableTimeframes: Array<"daily" | "4h" | "5m">;
  flags: string[];
  message?: string;
};

export type LiveWatchlistReferenceLevel = {
  key: "pmh" | "pml" | "orh" | "orl" | "hod" | "lod" | "pdh" | "pdl" | "pdc" | "vwap";
  label: string;
  price: number;
  kind: "session" | "dynamic";
};

export type LiveWatchlistTradePlan = {
  needsToHold: LiveWatchlistLevelMapLevel | null;
  failureBelow: LiveWatchlistLevelMapLevel | null;
  mustClear: LiveWatchlistLevelMapLevel | null;
  targets: LiveWatchlistLevelMapLevel[];
  openAir: boolean;
};

export type LiveWatchlistLevelMap = {
  currentPrice: number;
  rangeState: LiveWatchlistLevelMapRangeState;
  nearestSupport: LiveWatchlistLevelMapLevel | null;
  nearestResistance: LiveWatchlistLevelMapLevel | null;
  nextStrongSupport: LiveWatchlistLevelMapLevel | null;
  nextStrongResistance: LiveWatchlistLevelMapLevel | null;
  supportLevels: LiveWatchlistLevelMapLevel[];
  resistanceLevels: LiveWatchlistLevelMapLevel[];
  roleFlipConfirmationPct?: number;
  tradePlan?: LiveWatchlistTradePlan;
  dataQuality?: LiveWatchlistLevelDataQuality;
  referenceLevels?: LiveWatchlistReferenceLevel[];
  volatilityContext?: {
    atr: number;
    atrPct: number;
    period: number;
    timeframe: "5m";
    completedCandleCount: number | null;
    reliability: "reliable";
  };
};

export type LiveWatchlistSnapshotSource =
  | { kind: "level_snapshot"; payload: LevelSnapshotPayload }
  | { kind: "level_extension"; payload: LevelExtensionPayload }
  | { kind: "alert"; payload: AlertPayload };
