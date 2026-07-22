import type { StableMarketStructureRuntimeContext } from "../monitoring/monitoring-types.js";
import type { TechnicalContextConfidence } from "../technical-context/technical-context-types.js";
import type {
  LiveWatchlistLifecycleRead,
  LiveWatchlistLevelMap,
  TradersLinkAiReadFailureRecoveryPlan,
  TradersLinkAiReadPayload,
  TradersLinkAiReadPullbackScenario,
} from "./live-watchlist-types.js";
import type {
  LiveWatchlistPullbackReadPhase,
  LiveWatchlistPullbackVolumeLabel,
} from "./pullback-read.js";

const MAX_STRUCTURE_AGE_MS = 20 * 60 * 1_000;
const MAX_FUTURE_EVIDENCE_SKEW_MS = 2 * 60 * 1_000;
const NEW_YORK_TIME_ZONE = "America/New_York";
const NEW_YORK_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const LIQUID_VOLUME_LABELS = new Set<LiveWatchlistPullbackVolumeLabel>([
  "strong",
  "expanding",
  "normal",
]);
const FADING_VOLUME_LABELS = new Set<LiveWatchlistPullbackVolumeLabel>(["thin", "fading"]);
const RECOVERY_ATTEMPT_STRUCTURE_STATES = new Set(["reclaim_attempt", "reclaim_confirmed"]);
const BROKEN_STRUCTURE_STATES = new Set(["pivot_lost", "trend_damaged", "failed_breakout"]);

export type LiveWatchlistLifecycleEvidence = {
  evaluatedAt: number;
  structureUpdatedAt: number | null;
  phase: LiveWatchlistPullbackReadPhase | null;
  technicalConfidence: TechnicalContextConfidence | null;
  volumeLabel: LiveWatchlistPullbackVolumeLabel;
  levelMap: LiveWatchlistLevelMap | null;
  tradeSetupState?: string | null;
  tradeSetupStateBeforeBlockers?: string | null;
  stableFiveMinuteState?: string | null;
  fiveMinuteStructure?: StableMarketStructureRuntimeContext | null;
  currentPrice?: number | null;
  aiRead?: TradersLinkAiLifecyclePlan | null;
};

export type TradersLinkAiLifecyclePlan = Pick<
  TradersLinkAiReadPayload,
  | "version"
  | "generatedAt"
  | "dataAsOf"
  | "needsToHold"
  | "momentumFailure"
  | "pullbackPlans"
  | "failureRecovery"
>;

function newYorkDateKey(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const parts = NEW_YORK_DATE_FORMATTER.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function aiPlanIsCurrent(
  plan: TradersLinkAiLifecyclePlan,
  evaluatedAt: number,
): boolean {
  const evaluatedDate = newYorkDateKey(evaluatedAt);
  return (
    evaluatedDate !== null &&
    newYorkDateKey(plan.generatedAt) === evaluatedDate &&
    newYorkDateKey(plan.dataAsOf) === evaluatedDate &&
    plan.generatedAt <= evaluatedAt + MAX_FUTURE_EVIDENCE_SKEW_MS &&
    plan.dataAsOf <= evaluatedAt + MAX_FUTURE_EVIDENCE_SKEW_MS &&
    plan.dataAsOf <= plan.generatedAt + MAX_FUTURE_EVIDENCE_SKEW_MS
  );
}

function read(
  status: LiveWatchlistLifecycleRead["status"],
  label: LiveWatchlistLifecycleRead["label"],
  reason: string,
  updatedAt: number,
): LiveWatchlistLifecycleRead {
  return { status, label, reason, updatedAt };
}

function hasMappedSupport(levelMap: LiveWatchlistLevelMap | null): boolean {
  if (!levelMap) return false;
  return levelMap.supportLevels.some((level) => level.price < levelMap.currentPrice) ||
    (levelMap.nearestSupport?.price ?? Number.POSITIVE_INFINITY) < levelMap.currentPrice;
}

function pullbackQualificationReason(
  levelMap: LiveWatchlistLevelMap | null,
  structure: StableMarketStructureRuntimeContext | null | undefined,
): string | null {
  if (
    structure?.state !== "pullback_to_structure" ||
    structure.rawState !== "pullback_to_structure"
  ) {
    return "Momentum has cooled, but the current five-minute candles have not confirmed a pullback into structure.";
  }
  if (!levelMap) {
    return "Momentum has cooled, but current price and VWAP context are not available to confirm the pullback.";
  }
  if (
    structure.confidence === "low" ||
    structure.candleCount < 12 ||
    (structure.rawRunLength ?? 0) < 2
  ) {
    return "The five-minute pullback read has not persisted with enough reliable candle evidence yet.";
  }
  if (
    structure.trendDirection !== "uptrend" ||
    (structure.higherLowCount ?? 0) < 2 ||
    (structure.higherHighCount ?? 0) < 1
  ) {
    return "The five-minute candles do not show a constructive higher-high and higher-low impulse preceding this retracement.";
  }
  if (
    structure.activeRangeQuality === "choppy" ||
    typeof structure.activeRangeLow !== "number" ||
    !Number.isFinite(structure.activeRangeLow) ||
    typeof structure.activeRangeHigh !== "number" ||
    !Number.isFinite(structure.activeRangeHigh) ||
    structure.activeRangeHigh <= structure.activeRangeLow
  ) {
    return "The five-minute candles do not have a clean active range low to define the pullback area.";
  }

  const currentPrice = levelMap.currentPrice;
  if (
    !Number.isFinite(currentPrice) ||
    currentPrice < structure.activeRangeLow ||
    currentPrice > structure.activeRangeHigh
  ) {
    return "Price is not holding inside the candle-defined pullback range.";
  }

  const vwap = levelMap.referenceLevels?.find((level) => level.key === "vwap")?.price;
  if (
    typeof vwap !== "number" ||
    !Number.isFinite(vwap) ||
    currentPrice < vwap
  ) {
    return "The candle pullback is not holding VWAP, so it remains an unconfirmed or damaged setup.";
  }
  return null;
}

function scenarioLifecycleRead(
  scenario: TradersLinkAiReadPullbackScenario,
  scenarioName: "shallow" | "deep",
  currentPrice: number,
  updatedAt: number,
): LiveWatchlistLifecycleRead | null {
  if (currentPrice <= scenario.invalidationPrice || currentPrice > scenario.zoneHigh) {
    return null;
  }
  const name = scenarioName === "shallow" ? "shallow momentum" : "deep reset";
  return read(
    "pullback_watch",
    "Pullback Watch",
    currentPrice >= scenario.zoneLow
      ? `Price is testing the AI Read's ${name} pullback zone; buyer defense and the published confirmation are still required.`
      : `Price is below the AI Read's ${name} pullback zone but above its invalidation; a new base and reclaim are required.`,
    updatedAt,
  );
}

function hasRecoveryBase(
  recovery: TradersLinkAiReadFailureRecoveryPlan,
  structure: StableMarketStructureRuntimeContext | null | undefined,
): boolean {
  if (
    !structure ||
    structure.candleCount < 12 ||
    (structure.rawRunLength ?? 0) < 2
  ) {
    return false;
  }
  const basePrice = typeof structure.latestSwingLow === "number" && Number.isFinite(structure.latestSwingLow)
    ? structure.latestSwingLow
    : typeof structure.activeRangeLow === "number" && Number.isFinite(structure.activeRangeLow)
      ? structure.activeRangeLow
      : null;
  return basePrice !== null &&
    basePrice >= recovery.recoveryZoneLow &&
    basePrice <= recovery.recoveryZoneHigh;
}

function deriveAiReadLifecycleRead(
  evidence: LiveWatchlistLifecycleEvidence,
  currentPrice: number,
): LiveWatchlistLifecycleRead {
  const aiRead = evidence.aiRead!;
  const momentumFailure = aiRead.momentumFailure.price;
  const recovery = aiRead.failureRecovery;
  const stableState = evidence.stableFiveMinuteState ?? "";

  if (momentumFailure !== null && currentPrice <= momentumFailure) {
    if (!recovery) {
      return read(
        "monitoring",
        "Analysis Pending",
        "Price is below the AI Read's momentum-failure boundary, but no evidence-backed recovery setup is available.",
        evidence.evaluatedAt,
      );
    }
    const baseConfirmed = hasRecoveryBase(recovery, evidence.fiveMinuteStructure);
    const reclaimStructure = RECOVERY_ATTEMPT_STRUCTURE_STATES.has(stableState);
    if (
      baseConfirmed &&
      reclaimStructure &&
      currentPrice >= recovery.firstReclaimPrice
    ) {
      if (currentPrice >= recovery.setupRestorePrice && stableState === "reclaim_confirmed") {
        return read(
          "active",
          "Momentum Holding",
          "A new base formed in the AI recovery area and price confirmed the published setup-restoration reclaim.",
          evidence.evaluatedAt,
        );
      }
      return read(
        "recovery_attempt",
        "Recovery Attempt",
        `A new base formed in the AI recovery area and price reclaimed the published ${recovery.firstReclaimPrice} recovery trigger.`,
        evidence.evaluatedAt,
      );
    }
    if (
      currentPrice >= recovery.recoveryZoneLow &&
      currentPrice <= recovery.firstReclaimPrice
    ) {
      return read(
        "recovery_watch",
        "Recovery Watch",
        `Price is near the AI Read's ${recovery.recoveryZoneLow}-${recovery.recoveryZoneHigh} recovery-watch area; a new base and reclaim of ${recovery.firstReclaimPrice} are required.`,
        evidence.evaluatedAt,
      );
    }
    if (
      FADING_VOLUME_LABELS.has(evidence.volumeLabel) &&
      BROKEN_STRUCTURE_STATES.has(stableState)
    ) {
      return read(
        "setup_fading",
        "Setup Fading",
        "The momentum setup failed outside its mapped recovery sequence while participation and five-minute structure deteriorated.",
        evidence.evaluatedAt,
      );
    }
    return read(
      "monitoring",
      "Analysis Pending",
      currentPrice > recovery.firstReclaimPrice
        ? `Price is above the published ${recovery.firstReclaimPrice} recovery trigger, but a new base in the recovery area has not been confirmed.`
        : "The momentum setup failed and price is outside the AI Read's recovery-watch area.",
      evidence.evaluatedAt,
    );
  }

  const shallowRead = aiRead.pullbackPlans.shallow
    ? scenarioLifecycleRead(aiRead.pullbackPlans.shallow, "shallow", currentPrice, evidence.evaluatedAt)
    : null;
  if (shallowRead) return shallowRead;
  const deepRead = aiRead.pullbackPlans.deep
    ? scenarioLifecycleRead(aiRead.pullbackPlans.deep, "deep", currentPrice, evidence.evaluatedAt)
    : null;
  if (deepRead) return deepRead;

  const needsToHold = aiRead.needsToHold.price;
  if (needsToHold !== null && currentPrice < needsToHold) {
    return read(
      "monitoring",
      "Analysis Pending",
      "Price is below the AI Read's needs-to-hold boundary but has not entered an active pullback or recovery setup.",
      evidence.evaluatedAt,
    );
  }
  return read(
    "active",
    "Momentum Holding",
    "Live price remains above the AI Read's active momentum and pullback boundaries.",
    evidence.evaluatedAt,
  );
}

export function deriveLiveWatchlistLifecycleRead(
  evidence: LiveWatchlistLifecycleEvidence,
): LiveWatchlistLifecycleRead {
  const currentPrice = typeof evidence.currentPrice === "number" && Number.isFinite(evidence.currentPrice)
    ? evidence.currentPrice
    : evidence.levelMap?.currentPrice ?? null;
  const structureAge = evidence.structureUpdatedAt === null
    ? Number.POSITIVE_INFINITY
    : evidence.evaluatedAt - evidence.structureUpdatedAt;
  if (
    !evidence.phase ||
    evidence.technicalConfidence === null ||
    evidence.technicalConfidence === "unavailable" ||
    evidence.technicalConfidence === "low" ||
    structureAge < -2 * 60 * 1_000 ||
    structureAge > MAX_STRUCTURE_AGE_MS
  ) {
    return read(
      "monitoring",
      "Analysis Pending",
      "Waiting for fresh, reliable 5-minute structure before assigning a lifecycle state.",
      evidence.evaluatedAt,
    );
  }
  if (evidence.aiRead?.version === 3 && currentPrice !== null) {
    if (!aiPlanIsCurrent(evidence.aiRead, evidence.evaluatedAt)) {
      return read(
        "monitoring",
        "Analysis Pending",
        "Waiting for a current-session AI Read before assigning a lifecycle state.",
        evidence.evaluatedAt,
      );
    }
    return deriveAiReadLifecycleRead(evidence, currentPrice);
  }

  const mappedSupport = hasMappedSupport(evidence.levelMap);
  if (evidence.phase === "pullback_forming") {
    const qualificationFailure = pullbackQualificationReason(
      evidence.levelMap,
      evidence.fiveMinuteStructure,
    );
    return qualificationFailure
      ? read("monitoring", "Analysis Pending", qualificationFailure, evidence.evaluatedAt)
      : read(
          "pullback_watch",
          "Pullback Watch",
          "Five-minute candles show a persistent higher-high and higher-low retracement into the active range low while price holds VWAP.",
          evidence.evaluatedAt,
        );
  }

  if (evidence.phase === "failed_move_risk") {
    const stableState = evidence.stableFiveMinuteState ?? "";
    if (
      mappedSupport &&
      LIQUID_VOLUME_LABELS.has(evidence.volumeLabel)
    ) {
      if (RECOVERY_ATTEMPT_STRUCTURE_STATES.has(stableState)) {
        return read(
          "recovery_attempt",
          "Recovery Attempt",
          stableState === "reclaim_confirmed"
            ? "Five-minute structure has confirmed a reclaim, but core VWAP and EMA9 momentum still need to be restored."
            : "Five-minute structure is attempting a reclaim while mapped support and participation remain usable.",
          evidence.evaluatedAt,
        );
      }
      return read(
        "recovery_watch",
        "Recovery Watch",
        "The prior momentum structure failed, but mapped support and participation remain usable while waiting for a five-minute reclaim attempt.",
        evidence.evaluatedAt,
      );
    }
    if (
      FADING_VOLUME_LABELS.has(evidence.volumeLabel) &&
      BROKEN_STRUCTURE_STATES.has(stableState)
    ) {
      return read(
        "setup_fading",
        "Setup Fading",
        "Price has lost VWAP and EMA9 while participation and confirmed 5-minute structure are deteriorating.",
        evidence.evaluatedAt,
      );
    }
    return read(
      "monitoring",
      "Analysis Pending",
      "The prior setup is damaged; waiting for either a base-and-reclaim or confirmed participation fade.",
      evidence.evaluatedAt,
    );
  }

  if (FADING_VOLUME_LABELS.has(evidence.volumeLabel)) {
    return read(
      "monitoring",
      "Analysis Pending",
      "Price structure remains constructive, but participation is not strong enough for a Momentum Holding label.",
      evidence.evaluatedAt,
    );
  }

  return read(
    "active",
    "Momentum Holding",
    "Price remains above the core VWAP and EMA9 momentum structure.",
    evidence.evaluatedAt,
  );
}
