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
  latestPrice: number;
  nearestSupport: number | null;
  nearestResistance: number | null;
  nearestSupportLabel?: string | null;
  nearestResistanceLabel?: string | null;
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
