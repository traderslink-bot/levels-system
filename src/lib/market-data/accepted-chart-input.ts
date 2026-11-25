import { bindAcceptedInputOrigins } from "./accepted-input-origins.js";

/** Normalized private receipt from the authenticated gateway's acceptance registry. */
export type AcceptedChartInput = Readonly<{
  id: string;
  digest: string;
  upstreamRevision?: string;
  instrumentId: string;
  symbol: string;
  venue: string;
  frame: "daily" | "4h";
  datasetId: string;
  priceBasisId: string;
  calendarRevision: string;
  sessionMode: "regular" | "extended";
  completedThroughMs: number;
  acceptedCutoffMs: number;
  availableAtMs: number;
  acceptedAtMs: number;
}>;

const receipt = Symbol("accepted-chart-input");
type Carrier = { [receipt]?: AcceptedChartInput };
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 192;
const clock = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

export function admitAcceptedChartInput(value: unknown, expected: {
  symbol: string; frame: "daily" | "4h"; requestEndMs: number; receivedAtMs: number;
}): AcceptedChartInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(input.id) ||
      typeof input.digest !== "string" || !/^[a-f0-9]{64}$/u.test(input.digest) ||
      ![input.instrumentId, input.symbol, input.venue, input.datasetId, input.priceBasisId, input.calendarRevision].every(identifier) ||
      input.symbol !== expected.symbol || input.frame !== expected.frame ||
      (input.sessionMode !== "regular" && input.sessionMode !== "extended") ||
      (input.upstreamRevision !== undefined && !identifier(input.upstreamRevision)) ||
      ![input.completedThroughMs, input.acceptedCutoffMs, input.availableAtMs, input.acceptedAtMs,
        expected.receivedAtMs, expected.requestEndMs].every(clock)) return;
  const candidate = input as unknown as AcceptedChartInput;
  if (candidate.completedThroughMs > candidate.acceptedCutoffMs ||
      candidate.acceptedCutoffMs > candidate.acceptedAtMs ||
      candidate.completedThroughMs > candidate.availableAtMs ||
      candidate.availableAtMs > candidate.acceptedAtMs ||
      candidate.acceptedAtMs > expected.receivedAtMs ||
      candidate.completedThroughMs > expected.requestEndMs) return;
  return Object.freeze({
    id: candidate.id, digest: candidate.digest,
    ...(candidate.upstreamRevision === undefined ? {} : { upstreamRevision: candidate.upstreamRevision }),
    instrumentId: candidate.instrumentId, symbol: candidate.symbol, venue: candidate.venue,
    frame: candidate.frame, datasetId: candidate.datasetId, priceBasisId: candidate.priceBasisId,
    calendarRevision: candidate.calendarRevision, sessionMode: candidate.sessionMode,
    completedThroughMs: candidate.completedThroughMs, acceptedCutoffMs: candidate.acceptedCutoffMs,
    availableAtMs: candidate.availableAtMs, acceptedAtMs: candidate.acceptedAtMs,
  });
}

/** Use only for a receipt bound upstream to the exact unchanged computation reply. */
export function bindAcceptedChartInput<T extends object>(series: T, input: AcceptedChartInput): T {
  return bindAcceptedInputOrigins({ ...series, [receipt]: input }, [input.id]);
}

export function readAcceptedChartInput(series: object): AcceptedChartInput | undefined {
  return (series as Carrier)[receipt];
}
