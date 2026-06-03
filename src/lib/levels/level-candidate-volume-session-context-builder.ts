import type { SessionMarketFacts } from "../session/session-market-facts.js";
import type { VolumeMarketFacts } from "../volume/volume-market-facts.js";
import type { VolumeShelf } from "../volume/volume-shelf-detector.js";
import {
  assertLevelCandidateVolumeSessionContextFactsOnly,
  validateLevelCandidateVolumeSessionContext,
  type LevelCandidateSessionFactName,
  type LevelCandidateSessionFactProximity,
  type LevelCandidateSessionFactRelation,
  type LevelCandidateVolumeSessionComparisonOutcome,
  type LevelCandidateVolumeSessionContext,
  type LevelCandidateVolumeSessionContextRow,
  type LevelCandidateVolumeSessionSide,
  type LevelCandidateVolumeSessionStage,
  type LevelCandidateVolumeShelfOverlap,
  type LevelCandidateVolumeShelfRelation,
} from "./level-candidate-volume-session-context.js";

export type LevelCandidateVolumeSessionContextInputRow = {
  rowId: string;
  levelId?: string;
  candidateId?: string;
  side: LevelCandidateVolumeSessionSide;
  stage: LevelCandidateVolumeSessionStage;
  price: number;
  zoneLow?: number;
  zoneHigh?: number;
  distanceFromReferencePct?: number;
};

export type BuildLevelCandidateVolumeSessionContextRequest = {
  symbol: string;
  provider: string;
  asOfTimestamp: number;
  asOfIso?: string;
  referencePrice?: number;
  rows: LevelCandidateVolumeSessionContextInputRow[];
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  proximity?: {
    sessionNearPct?: number;
    sessionOverlapPct?: number;
    volumeShelfNearPct?: number;
  };
  diagnostics?: string[];
  limitations?: string[];
};

type SessionFactSource = {
  fact: LevelCandidateSessionFactName;
  price: number | undefined;
};

type SideComparison = {
  side: LevelCandidateVolumeSessionSide;
  outcome: LevelCandidateVolumeSessionComparisonOutcome;
  comparedRowIds: string[];
  surfacedRowIds: string[];
  unsurfacedRowIds: string[];
  diagnostics: string[];
};

const SIDES: readonly LevelCandidateVolumeSessionSide[] = ["support", "resistance"];
const DEFAULT_SESSION_NEAR_PCT = 1;
const DEFAULT_SESSION_OVERLAP_PCT = 0.05;
const DEFAULT_VOLUME_SHELF_NEAR_PCT = 1;
const COMPARISON_EPSILON = 0.0001;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function safePositive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function distancePct(price: number, referencePrice: number): number {
  return round((Math.abs(price - referencePrice) / referencePrice) * 100);
}

function candidateZone(row: LevelCandidateVolumeSessionContextInputRow): { low: number; high: number } {
  const low = safePositive(row.zoneLow);
  const high = safePositive(row.zoneHigh);
  if (low !== undefined && high !== undefined) {
    return {
      low: Math.min(low, high),
      high: Math.max(low, high),
    };
  }

  return {
    low: row.price,
    high: row.price,
  };
}

function priceInZone(price: number, zone: { low: number; high: number }): boolean {
  return price >= zone.low && price <= zone.high;
}

function zonesOverlap(left: { low: number; high: number }, right: { low: number; high: number }): boolean {
  return left.low <= right.high && right.low <= left.high;
}

function nearestZoneDistancePct(
  rowZone: { low: number; high: number },
  shelfZone: { low: number; high: number },
  rowPrice: number,
): number {
  if (zonesOverlap(rowZone, shelfZone)) {
    return 0;
  }

  const distance = rowZone.high < shelfZone.low
    ? shelfZone.low - rowZone.high
    : rowZone.low - shelfZone.high;

  return round((Math.abs(distance) / rowPrice) * 100);
}

function sessionFactSources(sessionFacts: SessionMarketFacts): SessionFactSource[] {
  return [
    { fact: "vwap", price: sessionFacts.vwap },
    { fact: "premarket_high", price: sessionFacts.premarketHigh },
    { fact: "premarket_low", price: sessionFacts.premarketLow },
    { fact: "opening_range_high", price: sessionFacts.openingRangeHigh },
    { fact: "opening_range_low", price: sessionFacts.openingRangeLow },
    { fact: "high_of_day", price: sessionFacts.highOfDay },
    { fact: "low_of_day", price: sessionFacts.lowOfDay },
    { fact: "previous_close", price: sessionFacts.previousClose },
    { fact: "regular_session_open", price: sessionFacts.regularSessionOpen },
  ];
}

function sessionRelationFor(params: {
  row: LevelCandidateVolumeSessionContextInputRow;
  factPrice: number;
  sessionNearPct: number;
  sessionOverlapPct: number;
}): LevelCandidateSessionFactRelation {
  const zone = candidateZone(params.row);
  const pct = distancePct(params.factPrice, params.row.price);
  if (priceInZone(params.factPrice, zone) || pct <= params.sessionOverlapPct) {
    return "overlaps";
  }
  if (pct <= params.sessionNearPct) {
    return "near";
  }

  return "outside_threshold";
}

export function findNearbySessionFactsForCandidate(params: {
  row: LevelCandidateVolumeSessionContextInputRow;
  sessionFacts?: SessionMarketFacts;
  sessionNearPct?: number;
  sessionOverlapPct?: number;
}): LevelCandidateSessionFactProximity[] {
  if (!params.sessionFacts) {
    return [];
  }

  const sessionNearPct = Math.max(0, params.sessionNearPct ?? DEFAULT_SESSION_NEAR_PCT);
  const sessionOverlapPct = Math.max(0, params.sessionOverlapPct ?? DEFAULT_SESSION_OVERLAP_PCT);
  const proximities = sessionFactSources(params.sessionFacts)
    .flatMap((source) => {
      const price = safePositive(source.price);
      if (price === undefined) {
        return [];
      }
      const proximity: LevelCandidateSessionFactProximity = {
        fact: source.fact,
        price: round(price),
        distancePct: distancePct(price, params.row.price),
        relation: sessionRelationFor({
          row: params.row,
          factPrice: price,
          sessionNearPct,
          sessionOverlapPct,
        }),
        factsOnly: true,
      };

      return [proximity];
    });
  const nearby = proximities.filter((fact) => fact.relation !== "outside_threshold");

  if (nearby.length > 0) {
    return nearby;
  }

  const closestOutside = proximities
    .filter((fact) => fact.relation === "outside_threshold")
    .sort((left, right) => left.distancePct - right.distancePct)[0];

  return closestOutside ? [closestOutside] : [];
}

function shelfRelationFor(params: {
  row: LevelCandidateVolumeSessionContextInputRow;
  shelf: VolumeShelf;
  volumeShelfNearPct: number;
}): LevelCandidateVolumeShelfRelation | undefined {
  const rowZone = candidateZone(params.row);
  const shelfZone = {
    low: params.shelf.zoneLow,
    high: params.shelf.zoneHigh,
  };

  if (
    zonesOverlap(rowZone, shelfZone) ||
    priceInZone(params.row.price, shelfZone) ||
    priceInZone(params.shelf.representativePrice, rowZone)
  ) {
    return "overlaps";
  }

  const pct = nearestZoneDistancePct(rowZone, shelfZone, params.row.price);
  return pct <= params.volumeShelfNearPct ? "near" : undefined;
}

export function findVolumeShelfOverlapsForCandidate(params: {
  row: LevelCandidateVolumeSessionContextInputRow;
  volumeShelves?: VolumeShelf[];
  volumeShelfNearPct?: number;
}): LevelCandidateVolumeShelfOverlap[] {
  const volumeShelfNearPct = Math.max(0, params.volumeShelfNearPct ?? DEFAULT_VOLUME_SHELF_NEAR_PCT);

  return (params.volumeShelves ?? [])
    .flatMap((shelf) => {
      const relation = shelfRelationFor({
        row: params.row,
        shelf,
        volumeShelfNearPct,
      });
      if (!relation) {
        return [];
      }

      const overlap: LevelCandidateVolumeShelfOverlap = {
        shelfId: shelf.id,
        zoneLow: round(shelf.zoneLow),
        zoneHigh: round(shelf.zoneHigh),
        representativePrice: round(shelf.representativePrice),
        relation,
        shelfRole: shelf.shelfRole,
        totalVolume: round(shelf.totalVolume, 0),
        dollarVolume: round(shelf.dollarVolume, 2),
        percentOfWindowVolume: round(shelf.percentOfWindowVolume),
        factsOnly: true,
      };

      return [overlap];
    })
    .sort((left, right) => {
      if (left.relation !== right.relation) {
        return left.relation === "overlaps" ? -1 : 1;
      }

      return left.representativePrice - right.representativePrice;
    });
}

function volumeDiagnostics(volumeFacts: VolumeMarketFacts | undefined): string[] {
  if (!volumeFacts) {
    return ["volume_facts_missing"];
  }

  return uniqueSorted(volumeFacts.diagnostics.map((diagnostic) => diagnostic.code));
}

function sessionDiagnostics(params: {
  sessionFacts?: SessionMarketFacts;
  nearbyFacts: LevelCandidateSessionFactProximity[];
}): string[] {
  if (!params.sessionFacts) {
    return ["session_facts_missing", "vwap_unavailable"];
  }

  const diagnostics: string[] = params.sessionFacts.diagnostics.map((diagnostic) => diagnostic.code);
  if (params.sessionFacts.vwap === undefined) {
    diagnostics.push("vwap_unavailable");
  }
  if (!params.nearbyFacts.some((fact) => fact.relation !== "outside_threshold")) {
    diagnostics.push("no_nearby_session_fact");
  }

  return uniqueSorted(diagnostics);
}

function shelfDiagnostics(params: {
  volumeShelves?: VolumeShelf[];
  overlaps: LevelCandidateVolumeShelfOverlap[];
}): string[] {
  if (!params.volumeShelves) {
    return ["volume_shelf_facts_missing"];
  }
  if (params.overlaps.length === 0) {
    return ["no_nearby_volume_shelf"];
  }

  return [];
}

function idDiagnostics(row: LevelCandidateVolumeSessionContextInputRow): string[] {
  if ((row.stage === "surfaced" || row.stage === "extension_selected") && !row.levelId) {
    return ["level_id_unavailable"];
  }
  if ((row.stage === "raw" || row.stage === "clustered" || row.stage === "scored" || row.stage === "extension_candidate") && !row.candidateId) {
    return ["candidate_id_unavailable"];
  }

  return [];
}

function hasNearbySession(row: LevelCandidateVolumeSessionContextRow): boolean {
  return row.session.nearbyFacts.some((fact) => fact.relation !== "outside_threshold");
}

function hasVolumeFacts(row: LevelCandidateVolumeSessionContextRow): boolean {
  return [
    row.volume.relativeVolume,
    row.volume.dollarVolume,
    row.volume.volumeState,
    row.volume.liquidityQuality,
    row.volume.accelerationState,
    row.volume.pullbackVolumeState,
    row.volume.breakoutVolumeState,
  ].some((value) => value !== undefined && value !== "unknown");
}

function contextScore(row: LevelCandidateVolumeSessionContextRow): number {
  const sessionCount = row.session.nearbyFacts.filter((fact) => fact.relation !== "outside_threshold").length;
  const shelfCount = row.shelves.overlaps.length;
  const hasPriceSpecificContext = sessionCount > 0 || shelfCount > 0;
  const volumeBonus = hasPriceSpecificContext && hasVolumeFacts(row) ? 1 : 0;

  return sessionCount + shelfCount * 2 + volumeBonus;
}

function rowHighLevelDiagnostics(row: LevelCandidateVolumeSessionContextRow): string[] {
  const diagnostics = [...row.diagnostics];
  const score = contextScore(row);

  if (row.session.diagnostics.includes("session_facts_missing") ||
      row.volume.diagnostics.includes("volume_facts_missing") ||
      row.shelves.diagnostics.includes("volume_shelf_facts_missing")) {
    diagnostics.push("volume_session_comparison_inconclusive");
  } else if (score === 0) {
    diagnostics.push("no_nearby_session_volume_context");
  } else if (
    (row.stage === "surfaced" || row.stage === "extension_selected") &&
    row.session.vwap !== undefined &&
    row.shelves.overlaps.length > 0
  ) {
    diagnostics.push("surfaced_vwap_shelf_overlap_context_present");
  } else if (row.stage === "surfaced" || row.stage === "extension_selected") {
    diagnostics.push("surfaced_session_volume_context_present");
  }

  return uniqueSorted(diagnostics);
}

export function buildLevelCandidateVolumeSessionContextRow(params: {
  row: LevelCandidateVolumeSessionContextInputRow;
  referencePrice?: number;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  proximity?: BuildLevelCandidateVolumeSessionContextRequest["proximity"];
}): LevelCandidateVolumeSessionContextRow {
  const nearbyFacts = findNearbySessionFactsForCandidate({
    row: params.row,
    sessionFacts: params.sessionFacts,
    sessionNearPct: params.proximity?.sessionNearPct,
    sessionOverlapPct: params.proximity?.sessionOverlapPct,
  });
  const shelfOverlaps = findVolumeShelfOverlapsForCandidate({
    row: params.row,
    volumeShelves: params.volumeShelves,
    volumeShelfNearPct: params.proximity?.volumeShelfNearPct,
  });
  const vwap = nearbyFacts.find((fact) => fact.fact === "vwap");
  const distanceFromReferencePct =
    params.row.distanceFromReferencePct ??
    (params.referencePrice !== undefined && params.referencePrice > 0
      ? distancePct(params.row.price, params.referencePrice)
      : undefined);
  const contextRow: LevelCandidateVolumeSessionContextRow = {
    rowId: params.row.rowId,
    side: params.row.side,
    stage: params.row.stage,
    price: round(params.row.price),
    session: {
      nearbyFacts,
      diagnostics: sessionDiagnostics({
        sessionFacts: params.sessionFacts,
        nearbyFacts,
      }),
    },
    volume: {
      diagnostics: volumeDiagnostics(params.volumeFacts),
    },
    shelves: {
      nearbyShelfIds: shelfOverlaps.map((shelf) => shelf.shelfId),
      overlaps: shelfOverlaps,
      diagnostics: shelfDiagnostics({
        volumeShelves: params.volumeShelves,
        overlaps: shelfOverlaps,
      }),
    },
    diagnostics: idDiagnostics(params.row),
    safety: {
      factsOnly: true,
      noLevelSelectionChange: true,
      noRankingChange: true,
      noRuntimeBehaviorChange: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
    },
  };
  if (params.row.levelId !== undefined) {
    contextRow.levelId = params.row.levelId;
  }
  if (params.row.candidateId !== undefined) {
    contextRow.candidateId = params.row.candidateId;
  }
  if (params.row.zoneLow !== undefined) {
    contextRow.zoneLow = round(params.row.zoneLow);
  }
  if (params.row.zoneHigh !== undefined) {
    contextRow.zoneHigh = round(params.row.zoneHigh);
  }
  if (distanceFromReferencePct !== undefined) {
    contextRow.distanceFromReferencePct = distanceFromReferencePct;
  }
  if (vwap !== undefined) {
    contextRow.session.vwap = vwap;
  }
  if (params.volumeFacts?.relativeVolume !== undefined) {
    contextRow.volume.relativeVolume = params.volumeFacts.relativeVolume;
  }
  if (params.volumeFacts?.dollarVolume !== undefined) {
    contextRow.volume.dollarVolume = params.volumeFacts.dollarVolume;
  }
  if (params.volumeFacts?.volumeState !== undefined) {
    contextRow.volume.volumeState = params.volumeFacts.volumeState;
  }
  if (params.volumeFacts?.liquidityQuality !== undefined) {
    contextRow.volume.liquidityQuality = params.volumeFacts.liquidityQuality;
  }
  if (params.volumeFacts?.accelerationState !== undefined) {
    contextRow.volume.accelerationState = params.volumeFacts.accelerationState;
  }
  if (params.volumeFacts?.pullbackVolumeState !== undefined) {
    contextRow.volume.pullbackVolumeState = params.volumeFacts.pullbackVolumeState;
  }
  if (params.volumeFacts?.breakoutVolumeState !== undefined) {
    contextRow.volume.breakoutVolumeState = params.volumeFacts.breakoutVolumeState;
  }

  return {
    ...contextRow,
    diagnostics: rowHighLevelDiagnostics(contextRow),
  };
}

function nearestSurfacedDistance(rows: LevelCandidateVolumeSessionContextRow[]): number | undefined {
  return rows
    .filter((row) => row.stage === "surfaced" || row.stage === "extension_selected")
    .map((row) => row.distanceFromReferencePct)
    .filter((distance): distance is number => distance !== undefined)
    .sort((left, right) => left - right)[0];
}

function comparisonRowsForSide(
  contexts: LevelCandidateVolumeSessionContextRow[],
  side: LevelCandidateVolumeSessionSide,
): { surfacedRows: LevelCandidateVolumeSessionContextRow[]; unsurfacedRows: LevelCandidateVolumeSessionContextRow[] } {
  const sideRows = contexts.filter((row) => row.side === side);
  const surfacedRows = sideRows.filter((row) => row.stage === "surfaced" || row.stage === "extension_selected");
  const surfacedDistance = nearestSurfacedDistance(sideRows);
  const scoredRows = sideRows.filter((row) => row.stage === "scored");
  const unsurfacedRows = surfacedDistance === undefined
    ? scoredRows
    : scoredRows.filter(
      (row) => row.distanceFromReferencePct !== undefined &&
        row.distanceFromReferencePct + COMPARISON_EPSILON < surfacedDistance,
    );

  return {
    surfacedRows,
    unsurfacedRows,
  };
}

function maxContextScore(rows: LevelCandidateVolumeSessionContextRow[]): number {
  return rows.reduce((max, row) => Math.max(max, contextScore(row)), 0);
}

function hasMissingFacts(rows: LevelCandidateVolumeSessionContextRow[]): boolean {
  return rows.some((row) =>
    row.session.diagnostics.includes("session_facts_missing") ||
    row.volume.diagnostics.includes("volume_facts_missing") ||
    row.shelves.diagnostics.includes("volume_shelf_facts_missing"),
  );
}

function hasUnavailableIdentifiers(rows: LevelCandidateVolumeSessionContextRow[]): boolean {
  return rows.some((row) =>
    row.diagnostics.includes("candidate_id_unavailable") ||
    row.diagnostics.includes("level_id_unavailable"),
  );
}

function diagnosticForOutcome(outcome: LevelCandidateVolumeSessionComparisonOutcome): string {
  switch (outcome) {
    case "surfaced_has_more_session_volume_context":
      return "surfaced_session_volume_context_present";
    case "unsurfaced_has_more_session_volume_context":
      return "unsurfaced_more_session_volume_context";
    case "similar_session_volume_context":
      return "similar_session_volume_context";
    case "missing_facts_inconclusive":
      return "volume_session_comparison_inconclusive";
    case "candidate_identifier_unavailable":
      return "candidate_identifier_unavailable";
    case "no_nearby_session_volume_context":
      return "no_nearby_session_volume_context";
  }
}

function diagnosticsForSideOutcome(params: {
  outcome: LevelCandidateVolumeSessionComparisonOutcome;
  surfacedRows: LevelCandidateVolumeSessionContextRow[];
  unsurfacedRows: LevelCandidateVolumeSessionContextRow[];
}): string[] {
  if (
    params.outcome === "surfaced_has_more_session_volume_context" &&
    params.unsurfacedRows.length > 0
  ) {
    return ["closer_unsurfaced_less_session_volume_context"];
  }
  if (
    params.outcome === "surfaced_has_more_session_volume_context" &&
    params.surfacedRows.some((row) =>
      row.session.vwap !== undefined &&
      row.shelves.overlaps.length > 0,
    )
  ) {
    return ["surfaced_vwap_shelf_overlap_context_present"];
  }

  return [diagnosticForOutcome(params.outcome)];
}

function deriveSideComparison(
  contexts: LevelCandidateVolumeSessionContextRow[],
  side: LevelCandidateVolumeSessionSide,
): SideComparison | undefined {
  const sideRows = contexts.filter((row) => row.side === side);
  if (sideRows.length === 0) {
    return undefined;
  }

  const { surfacedRows, unsurfacedRows } = comparisonRowsForSide(contexts, side);
  const comparedRows = [...surfacedRows, ...unsurfacedRows];
  const rowsToCompare = comparedRows.length > 0 ? comparedRows : sideRows;
  const surfacedScore = maxContextScore(surfacedRows);
  const unsurfacedScore = maxContextScore(unsurfacedRows);
  let outcome: LevelCandidateVolumeSessionComparisonOutcome;

  if (hasMissingFacts(rowsToCompare)) {
    outcome = "missing_facts_inconclusive";
  } else if (hasUnavailableIdentifiers(rowsToCompare)) {
    outcome = "candidate_identifier_unavailable";
  } else if (surfacedScore === 0 && unsurfacedScore === 0) {
    outcome = "no_nearby_session_volume_context";
  } else if (surfacedRows.length > 0 && unsurfacedRows.length === 0) {
    outcome = surfacedScore > 0
      ? "surfaced_has_more_session_volume_context"
      : "no_nearby_session_volume_context";
  } else if (unsurfacedRows.length > 0 && surfacedRows.length === 0) {
    outcome = unsurfacedScore > 0
      ? "unsurfaced_has_more_session_volume_context"
      : "no_nearby_session_volume_context";
  } else if (surfacedScore > unsurfacedScore) {
    outcome = "surfaced_has_more_session_volume_context";
  } else if (unsurfacedScore > surfacedScore) {
    outcome = "unsurfaced_has_more_session_volume_context";
  } else {
    outcome = "similar_session_volume_context";
  }

  const diagnostics = diagnosticsForSideOutcome({
    outcome,
    surfacedRows,
    unsurfacedRows,
  });
  if (outcome === "missing_facts_inconclusive") {
    for (const row of rowsToCompare) {
      diagnostics.push(...row.session.diagnostics, ...row.volume.diagnostics, ...row.shelves.diagnostics);
    }
  }

  return {
    side,
    outcome,
    comparedRowIds: rowsToCompare.map((row) => row.rowId),
    surfacedRowIds: surfacedRows.map((row) => row.rowId),
    unsurfacedRowIds: unsurfacedRows.map((row) => row.rowId),
    diagnostics: uniqueSorted(diagnostics),
  };
}

function rootOutcome(sideComparisons: SideComparison[]): LevelCandidateVolumeSessionComparisonOutcome {
  const outcomes = sideComparisons.map((comparison) => comparison.outcome);
  for (const outcome of [
    "missing_facts_inconclusive",
    "candidate_identifier_unavailable",
    "unsurfaced_has_more_session_volume_context",
    "surfaced_has_more_session_volume_context",
    "similar_session_volume_context",
    "no_nearby_session_volume_context",
  ] as const) {
    if (outcomes.includes(outcome)) {
      return outcome;
    }
  }

  return "no_nearby_session_volume_context";
}

function applyComparisonDiagnostics(
  contexts: LevelCandidateVolumeSessionContextRow[],
  sideComparisons: SideComparison[],
): LevelCandidateVolumeSessionContextRow[] {
  const diagnosticByRowId = new Map<string, string[]>();
  for (const comparison of sideComparisons) {
    for (const rowId of comparison.comparedRowIds) {
      diagnosticByRowId.set(rowId, [
        ...(diagnosticByRowId.get(rowId) ?? []),
        ...comparison.diagnostics,
      ]);
    }
  }

  return contexts.map((row) => ({
    ...row,
    diagnostics: uniqueSorted([
      ...row.diagnostics,
      ...(diagnosticByRowId.get(row.rowId) ?? []),
    ]),
  }));
}

export function deriveVolumeSessionComparisonSummary(
  contexts: LevelCandidateVolumeSessionContextRow[],
): LevelCandidateVolumeSessionContext["comparisonSummary"] {
  const sideComparisons = SIDES.flatMap((side) => {
    const comparison = deriveSideComparison(contexts, side);
    return comparison ? [comparison] : [];
  });
  const outcome = rootOutcome(sideComparisons);
  const diagnostics = uniqueSorted(sideComparisons.flatMap((comparison) => comparison.diagnostics));
  const summary: LevelCandidateVolumeSessionContext["comparisonSummary"] = {
    outcome,
    comparedRowIds: uniqueSorted(sideComparisons.flatMap((comparison) => comparison.comparedRowIds)),
    surfacedRowIds: uniqueSorted(sideComparisons.flatMap((comparison) => comparison.surfacedRowIds)),
    unsurfacedRowIds: uniqueSorted(sideComparisons.flatMap((comparison) => comparison.unsurfacedRowIds)),
    diagnostics: diagnostics.length > 0 ? diagnostics : [diagnosticForOutcome(outcome)],
  };
  for (const comparison of sideComparisons) {
    summary[comparison.side] = comparison.outcome;
  }

  return summary;
}

function assertValidContext(context: LevelCandidateVolumeSessionContext): LevelCandidateVolumeSessionContext {
  const validation = validateLevelCandidateVolumeSessionContext(context);
  if (!validation.valid) {
    throw new Error(`Invalid candidate volume session context from builder: ${validation.errors.join("; ")}`);
  }
  assertLevelCandidateVolumeSessionContextFactsOnly(context);

  return context;
}

export function buildLevelCandidateVolumeSessionContext(
  request: BuildLevelCandidateVolumeSessionContextRequest,
): LevelCandidateVolumeSessionContext {
  const initialRows = request.rows.map((row) =>
    buildLevelCandidateVolumeSessionContextRow({
      row,
      referencePrice: request.referencePrice,
      sessionFacts: request.sessionFacts,
      volumeFacts: request.volumeFacts,
      volumeShelves: request.volumeShelves,
      proximity: request.proximity,
    }),
  );
  const initialSummary = deriveVolumeSessionComparisonSummary(initialRows);
  const contexts = applyComparisonDiagnostics(initialRows, SIDES.flatMap((side) => {
    const comparison = deriveSideComparison(initialRows, side);
    return comparison ? [comparison] : [];
  }));
  const comparisonSummary = deriveVolumeSessionComparisonSummary(contexts);
  const diagnostics = uniqueSorted([
    ...(request.diagnostics ?? []),
    ...(request.limitations ?? []),
    ...initialSummary.diagnostics,
    ...comparisonSummary.diagnostics,
    ...contexts.flatMap((row) => [
      ...row.session.diagnostics,
      ...row.volume.diagnostics,
      ...row.shelves.diagnostics,
      ...row.diagnostics,
    ]),
  ]);
  const context: LevelCandidateVolumeSessionContext = {
    schemaVersion: "level-candidate-volume-session-context/v1",
    symbol: request.symbol.toUpperCase(),
    provider: request.provider,
    asOfTimestamp: request.asOfTimestamp,
    contexts,
    comparisonSummary,
    diagnostics,
    safety: {
      factsOnly: true,
      noLevelSelectionChange: true,
      noRankingChange: true,
      noRuntimeBehaviorChange: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
      fifteenMinuteFedIntoLevelEngine: false,
      volumeSessionFactsUsedForScoringOrSurfacedSelection: false,
      supportResistanceDetectionChanged: false,
      levelEngineScoringRankingClusteringChanged: false,
      surfacedLevelsChanged: false,
      extensionGenerationChanged: false,
      providerCallsMade: false,
      cacheFilesWritten: false,
      rawCandlesIncluded: false,
      fullSnapshotsIncluded: false,
    },
  };
  if (request.asOfIso !== undefined) {
    context.asOfIso = request.asOfIso;
  }
  if (request.referencePrice !== undefined) {
    context.referencePrice = request.referencePrice;
  }

  return assertValidContext(context);
}
