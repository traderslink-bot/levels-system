/** Classification only. Lack of old metadata alone is not proof a level is fabricated. */
export type ResistanceEvidence = {
  id?: string; notes?: string[]; sourceLabel?: string | null;
  sourceEvidenceCount?: number; evidenceCount?: number; touchCount?: number;
  evidenceStatus?: string;
  marketDataProvenance?: { formedAt?: number; lastTestedAt?: number; lastConfirmedAt?: number };
};

export const NO_HIGHER_RESISTANCE = "No higher historical resistance detected in the available price history.";
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
export function hasObservedResistanceEvidence(level: ResistanceEvidence): boolean {
  return positive(level.sourceEvidenceCount) || positive(level.evidenceCount) || positive(level.touchCount) ||
    Object.values(level.marketDataProvenance ?? {}).some(positive);
}

export function isSyntheticResistance(level: ResistanceEvidence): boolean {
  if (level.evidenceStatus === "synthetic_planning" ||
      /-(?:synthetic-resistance-extension|snapshot-continuation-resistance)-/.test(level.id ?? "") ||
      (Array.isArray(level.notes) && level.notes.some(note => typeof note === "string" && (note === "snapshot_continuation_map" || /^Synthetic continuation extension generated /.test(note))))) return true;
  const source = typeof level.sourceLabel === "string" ? level.sourceLabel.trim().toLowerCase() : undefined;
  if (source === "continuation map") return true;
  // This is the exact older transport signature of the synthetic builder.
  // Genuine historical extensions and legacy rows with absent counts survive.
  return source === "extension" && level.sourceEvidenceCount === 0 && level.touchCount === 0 &&
    !hasObservedResistanceEvidence(level);
}
