// 2026-04-14 09:28 PM America/Toronto
// In-memory level store with explicit monitored-zone identity and remap semantics.

import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import type {
  LadderPositionContext,
  MonitoringZoneContext,
  MonitoredZoneOrigin,
  MonitoredZoneRemapStatus,
} from "./monitoring-types.js";

type MonitoredZoneRecord = {
  monitoredZoneId: string;
  zone: FinalLevelZone;
  context: MonitoringZoneContext;
};

function cloneForMonitoring(record: MonitoredZoneRecord): FinalLevelZone {
  return {
    ...record.zone,
    id: record.monitoredZoneId,
  };
}

function overlapRatio(left: FinalLevelZone, right: FinalLevelZone): number {
  const overlapLow = Math.max(left.zoneLow, right.zoneLow);
  const overlapHigh = Math.min(left.zoneHigh, right.zoneHigh);
  if (overlapHigh <= overlapLow) {
    return 0;
  }

  const overlap = overlapHigh - overlapLow;
  const smallerWidth = Math.max(
    Math.min(left.zoneHigh - left.zoneLow, right.zoneHigh - right.zoneLow),
    0.0001,
  );
  return overlap / smallerWidth;
}

function centerDistancePct(left: FinalLevelZone, right: FinalLevelZone): number {
  return (
    Math.abs(left.representativePrice - right.representativePrice) /
    Math.max(Math.max(left.representativePrice, right.representativePrice), 0.0001)
  );
}

function zonesStronglyOverlap(left: FinalLevelZone, right: FinalLevelZone): boolean {
  return overlapRatio(left, right) >= 0.45 || centerDistancePct(left, right) <= 0.006;
}

function sortByKind(zones: FinalLevelZone[], kind: "support" | "resistance"): FinalLevelZone[] {
  return [...zones].sort((a, b) =>
    kind === "support"
      ? b.representativePrice - a.representativePrice
      : a.representativePrice - b.representativePrice,
  );
}

function ladderPositionForCanonical(
  kind: "support" | "resistance",
  index: number,
  total: number,
): LadderPositionContext {
  if (total <= 0) {
    return "inner";
  }

  return index === total - 1 ? "outermost" : "inner";
}

export class LevelStore {
  private readonly levels = new Map<string, LevelEngineOutput>();
  private readonly activeSupportZones = new Map<string, MonitoredZoneRecord[]>();
  private readonly activeResistanceZones = new Map<string, MonitoredZoneRecord[]>();
  private readonly versions = new Map<string, number>();
  private readonly zoneIdSequence = new Map<string, number>();

  private bumpVersion(symbol: string): void {
    this.versions.set(symbol, (this.versions.get(symbol) ?? 0) + 1);
  }

  private nextMonitoredZoneId(symbol: string, kind: "support" | "resistance"): string {
    const key = `${symbol.toUpperCase()}|${kind}`;
    const next = (this.zoneIdSequence.get(key) ?? 0) + 1;
    this.zoneIdSequence.set(key, next);
    return `${symbol.toUpperCase()}-${kind}-monitored-${next}`;
  }

  private buildContext(params: {
    monitoredZoneId: string;
    zone: FinalLevelZone;
    origin: MonitoredZoneOrigin;
    remapStatus: MonitoredZoneRemapStatus;
    remappedFromZoneIds: string[];
    sourceGeneratedAt?: number;
    dataQualityDegraded: boolean;
    ladderPosition: LadderPositionContext;
    activeSince?: number;
    lastRemappedAt?: number;
    recentlyPromotedExtension?: boolean;
  }): MonitoringZoneContext {
    return {
      monitoredZoneId: params.monitoredZoneId,
      canonicalZoneId: params.zone.id,
      origin: params.origin,
      remapStatus: params.remapStatus,
      remappedFromZoneIds: params.remappedFromZoneIds,
      sourceGeneratedAt: params.sourceGeneratedAt,
      zoneFreshness: params.zone.freshness,
      zoneStrengthLabel: params.zone.strengthLabel,
      dataQualityDegraded: params.dataQualityDegraded,
      recentlyRefreshed: params.remapStatus !== "new",
      recentlyPromotedExtension: params.recentlyPromotedExtension ?? false,
      ladderPosition: params.ladderPosition,
      activeSince: params.activeSince ?? Date.now(),
      lastRemappedAt: params.lastRemappedAt,
    };
  }

  private reconcileCanonicalSide(params: {
    symbol: string;
    side: "support" | "resistance";
    currentRecords: MonitoredZoneRecord[];
    nextZones: FinalLevelZone[];
    output: LevelEngineOutput;
  }): MonitoredZoneRecord[] {
    const { symbol, side, currentRecords, output } = params;
    const nextZones = sortByKind(params.nextZones, side);
    const unmatchedCurrent = new Set(currentRecords.map((record) => record.monitoredZoneId));
    const records: MonitoredZoneRecord[] = [];
    const now = Date.now();
    const overlapsByNextIndex = nextZones.map((zone) =>
      currentRecords.filter((record) => zonesStronglyOverlap(record.zone, zone)),
    );
    const nextOverlapCountByCurrentId = new Map<string, number>();

    for (const overlapping of overlapsByNextIndex) {
      for (const record of overlapping) {
        nextOverlapCountByCurrentId.set(
          record.monitoredZoneId,
          (nextOverlapCountByCurrentId.get(record.monitoredZoneId) ?? 0) + 1,
        );
      }
    }

    for (const [index, zone] of nextZones.entries()) {
      const allOverlapping = overlapsByNextIndex[index] ?? [];
      const overlapping = allOverlapping.filter((record) =>
        unmatchedCurrent.has(record.monitoredZoneId),
      );

      const bestExisting = [...overlapping].sort(
        (left, right) =>
          overlapRatio(right.zone, zone) - overlapRatio(left.zone, zone) ||
          right.zone.strengthScore - left.zone.strengthScore,
      )[0];

      if (bestExisting) {
        unmatchedCurrent.delete(bestExisting.monitoredZoneId);
      }

      const remappedFromZoneIds = allOverlapping.map((record) => record.monitoredZoneId);
      remappedFromZoneIds.forEach((id) => unmatchedCurrent.delete(id));
      const splitSource = allOverlapping.find(
        (record) => (nextOverlapCountByCurrentId.get(record.monitoredZoneId) ?? 0) > 1,
      );
      const fallbackContext = [...allOverlapping]
        .sort(
          (left, right) =>
            (right.context.activeSince ?? 0) - (left.context.activeSince ?? 0) ||
            right.zone.strengthScore - left.zone.strengthScore,
        )[0]?.context;

      const remapStatus: MonitoredZoneRemapStatus =
        remappedFromZoneIds.length > 1
          ? "merged"
          : splitSource
            ? "split"
          : bestExisting && bestExisting.context.origin === "promoted_extension"
            ? "replaced"
            : bestExisting
              ? "preserved"
              : "new";

      const monitoredZoneId =
        bestExisting?.monitoredZoneId ?? this.nextMonitoredZoneId(symbol, side);
      const previousContext = bestExisting?.context;
      records.push({
        monitoredZoneId,
        zone,
        context: this.buildContext({
          monitoredZoneId,
          zone,
          origin: "canonical",
          remapStatus,
          remappedFromZoneIds,
          sourceGeneratedAt: output.generatedAt,
          dataQualityDegraded: output.metadata.dataQualityFlags.length > 0,
          ladderPosition: ladderPositionForCanonical(side, index, nextZones.length),
          activeSince: previousContext?.activeSince ?? fallbackContext?.activeSince,
          lastRemappedAt: remapStatus === "new" ? undefined : now,
          recentlyPromotedExtension: false,
        }),
      });
    }

    return records;
  }

  private promoteExtensionSide(params: {
    symbol: string;
    side: "support" | "resistance";
    currentRecords: MonitoredZoneRecord[];
    extensionZones: FinalLevelZone[];
    output: LevelEngineOutput;
  }): MonitoredZoneRecord[] {
    const { symbol, side, currentRecords, output } = params;
    const existing = [...currentRecords];
    const sortedExtensions = sortByKind(params.extensionZones, side);

    for (const [index, zone] of sortedExtensions.entries()) {
      const overlap = existing.find((record) => zonesStronglyOverlap(record.zone, zone));
      if (overlap) {
        continue;
      }

      const monitoredZoneId = this.nextMonitoredZoneId(symbol, side);
      existing.push({
        monitoredZoneId,
        zone,
        context: this.buildContext({
          monitoredZoneId,
          zone,
          origin: "promoted_extension",
          remapStatus: "new",
          remappedFromZoneIds: [],
          sourceGeneratedAt: output.generatedAt,
          dataQualityDegraded: output.metadata.dataQualityFlags.length > 0,
          ladderPosition: "extension",
          recentlyPromotedExtension: true,
        }),
      });
    }

    return sortByKind(existing.map((record) => record.zone), side).map((zone) =>
      existing.find((record) => record.zone.id === zone.id)!,
    );
  }

  setLevels(output: LevelEngineOutput): void {
    const symbol = output.symbol.toUpperCase();
    this.levels.set(symbol, output);
    this.activeSupportZones.set(
      symbol,
      this.reconcileCanonicalSide({
        symbol,
        side: "support",
        currentRecords: this.activeSupportZones.get(symbol) ?? [],
        nextZones: [
          ...output.majorSupport,
          ...output.intermediateSupport,
          ...output.intradaySupport,
        ],
        output,
      }),
    );
    this.activeResistanceZones.set(
      symbol,
      this.reconcileCanonicalSide({
        symbol,
        side: "resistance",
        currentRecords: this.activeResistanceZones.get(symbol) ?? [],
        nextZones: [
          ...output.majorResistance,
          ...output.intermediateResistance,
          ...output.intradayResistance,
        ],
        output,
      }),
    );
    this.bumpVersion(symbol);
  }

  getLevels(symbol: string): LevelEngineOutput | undefined {
    return this.levels.get(symbol.toUpperCase());
  }

  getSupportZones(symbol: string): FinalLevelZone[] {
    return (this.activeSupportZones.get(symbol.toUpperCase()) ?? []).map(cloneForMonitoring);
  }

  getResistanceZones(symbol: string): FinalLevelZone[] {
    return (this.activeResistanceZones.get(symbol.toUpperCase()) ?? []).map(cloneForMonitoring);
  }

  getExtensionSupportZones(symbol: string): FinalLevelZone[] {
    return this.getLevels(symbol)?.extensionLevels.support ?? [];
  }

  getExtensionResistanceZones(symbol: string): FinalLevelZone[] {
    return this.getLevels(symbol)?.extensionLevels.resistance ?? [];
  }

  activateExtensionLevels(symbol: string, side: "support" | "resistance"): FinalLevelZone[] {
    const normalized = symbol.toUpperCase();
    const output = this.getLevels(normalized);
    if (!output) {
      return [];
    }

    if (side === "support") {
      const next = this.promoteExtensionSide({
        symbol: normalized,
        side,
        currentRecords: this.activeSupportZones.get(normalized) ?? [],
        extensionZones: output.extensionLevels.support,
        output,
      });
      this.activeSupportZones.set(normalized, next);
      this.bumpVersion(normalized);
      return next.map(cloneForMonitoring);
    }

    const next = this.promoteExtensionSide({
      symbol: normalized,
      side,
      currentRecords: this.activeResistanceZones.get(normalized) ?? [],
      extensionZones: output.extensionLevels.resistance,
      output,
    });
    this.activeResistanceZones.set(normalized, next);
    this.bumpVersion(normalized);
    return next.map(cloneForMonitoring);
  }

  getVersion(symbol: string): number {
    return this.versions.get(symbol.toUpperCase()) ?? 0;
  }

  getZoneContext(symbol: string, monitoredZoneId: string): MonitoringZoneContext | undefined {
    const normalized = symbol.toUpperCase();
    const record = [
      ...(this.activeSupportZones.get(normalized) ?? []),
      ...(this.activeResistanceZones.get(normalized) ?? []),
    ].find((item) => item.monitoredZoneId === monitoredZoneId);

    return record ? { ...record.context, remappedFromZoneIds: [...record.context.remappedFromZoneIds] } : undefined;
  }

  getZoneContexts(symbol: string): Record<string, MonitoringZoneContext> {
    const normalized = symbol.toUpperCase();
    const contexts = [
      ...(this.activeSupportZones.get(normalized) ?? []),
      ...(this.activeResistanceZones.get(normalized) ?? []),
    ];

    return Object.fromEntries(
      contexts.map((record) => [
        record.monitoredZoneId,
        {
          ...record.context,
          remappedFromZoneIds: [...record.context.remappedFromZoneIds],
        },
      ]),
    );
  }
}
