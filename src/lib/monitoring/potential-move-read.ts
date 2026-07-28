import {
  formatChartThesisRead,
  buildWatchlistChartThesisRead,
  type ChartThesisEngineInput,
} from "./chart-thesis-engine.js";
import type { ChartThesisRead, LevelSnapshotPayload } from "../alerts/alert-types.js";

export function buildPotentialMoveRead(input: ChartThesisEngineInput): ChartThesisRead | null {
  return buildWatchlistChartThesisRead(input);
}

export function formatPotentialMoveRead(read: LevelSnapshotPayload["potentialMoveRead"]): string[] {
  return formatChartThesisRead(read);
}
