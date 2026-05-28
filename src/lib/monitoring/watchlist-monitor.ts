// 2026-04-14 10:34 PM America/Toronto
// Main Phase 2 monitor orchestrator with event deduplication, cooldowns, strongest-zone filtering,
// and optional raw event listener support for downstream alert intelligence.

import type { FinalLevelZone } from "../levels/level-types.js";
import { DEFAULT_MONITORING_CONFIG, type MonitoringConfig } from "./monitoring-config.js";
import { detectMonitoringEvents } from "./event-detector.js";
import { createInitialInteractionState, updateInteractionState } from "./interaction-state-machine.js";
import type { LivePriceListener, LivePriceProvider } from "./live-price-types.js";
import { recordMonitoringEvent } from "./symbol-state.js";
import type {
  LivePriceUpdate,
  MonitoringEvent,
  MonitoringEventDiagnosticListener,
  MonitoringZoneContext,
  SymbolMonitoringState,
  WatchlistEntry,
  ZoneInteractionState,
} from "./monitoring-types.js";
import { LevelStore } from "./level-store.js";
import { IntradayPriceStructureTracker } from "./intraday-price-structure.js";
import { LiveStableMarketStructureTracker } from "./live-stable-market-structure.js";
import { VolumeActivityTracker } from "./volume-activity.js";

export type MonitoringEventListener = (event: MonitoringEvent) => void;

export type WatchlistMonitorOptions = {
  diagnosticListener?: MonitoringEventDiagnosticListener;
  priceAnomalyGuard?: {
    enabled?: boolean;
    maxSingleUpdateMovePct?: number;
    confirmWindowMs?: number;
    confirmTolerancePct?: number;
  };
};

type PendingEvent = {
  event: MonitoringEvent;
  zone: FinalLevelZone;
  updatedState: ZoneInteractionState;
};

type PendingPriceAnomaly = {
  lastPrice: number;
  timestamp: number;
  previousPrice: number;
};

const DEFAULT_PRICE_ANOMALY_MAX_MOVE_PCT = 0.35;
const DEFAULT_PRICE_ANOMALY_CONFIRM_WINDOW_MS = 30_000;
const DEFAULT_PRICE_ANOMALY_CONFIRM_TOLERANCE_PCT = 0.08;

export class WatchlistMonitor {
  private readonly symbolStates = new Map<string, SymbolMonitoringState>();
  private readonly emittedEventTimestamps = new Map<string, number>();
  private readonly pendingPriceAnomalies = new Map<string, PendingPriceAnomaly>();
  private readonly intradayStructureTracker = new IntradayPriceStructureTracker();
  private readonly stableMarketStructureTracker = new LiveStableMarketStructureTracker();
  private readonly volumeTracker = new VolumeActivityTracker();

  constructor(
    private readonly levelStore: LevelStore,
    private readonly livePriceProvider: LivePriceProvider,
    private readonly config: MonitoringConfig = DEFAULT_MONITORING_CONFIG,
    private readonly options: WatchlistMonitorOptions = {},
  ) {}

  private ensureSymbolState(symbol: string): SymbolMonitoringState {
    const existing = this.symbolStates.get(symbol);
    if (existing) {
      this.reconcileSymbolState(existing);
      return existing;
    }

    const output = this.levelStore.getLevels(symbol);
    this.applyVolumeBaseline(symbol, output);

    const state: SymbolMonitoringState = {
      symbol,
      supportZones: this.levelStore.getSupportZones(symbol),
      resistanceZones: this.levelStore.getResistanceZones(symbol),
      levelGeneratedAt: output?.generatedAt,
      levelFreshness: output?.metadata.freshness,
      levelStoreVersion: this.levelStore.getVersion(symbol),
      levelDataQualityFlags: output?.metadata.dataQualityFlags ?? [],
      zoneContexts: this.levelStore.getZoneContexts(symbol),
      interactions: {},
      bias: "neutral",
      pressureScore: 0,
      recentEvents: [],
    };

    for (const zone of [...state.supportZones, ...state.resistanceZones]) {
      state.interactions[zone.id] = createInitialInteractionState(symbol, zone);
    }

    this.symbolStates.set(symbol, state);
    return state;
  }

  private reconcileSymbolState(symbolState: SymbolMonitoringState): void {
    const symbol = symbolState.symbol.toUpperCase();
    const currentVersion = this.levelStore.getVersion(symbol);

    if (symbolState.levelStoreVersion === currentVersion) {
      return;
    }

    const output = this.levelStore.getLevels(symbol);
    this.applyVolumeBaseline(symbol, output);
    const supportZones = this.levelStore.getSupportZones(symbol);
    const resistanceZones = this.levelStore.getResistanceZones(symbol);
    const zoneIds = new Set([...supportZones, ...resistanceZones].map((zone) => zone.id));
    const nextZoneContexts = this.levelStore.getZoneContexts(symbol);
    const nextInteractions: Record<string, ZoneInteractionState> = {};
    const interactionByPriorZoneId = symbolState.interactions;

    const selectPreservedInteraction = (
      context: MonitoringZoneContext | undefined,
      zoneId: string,
    ): ZoneInteractionState | undefined => {
      const candidates = [
        interactionByPriorZoneId[zoneId],
        ...(context?.remappedFromZoneIds ?? []).map((priorZoneId) => interactionByPriorZoneId[priorZoneId]),
      ].filter((value): value is ZoneInteractionState => Boolean(value));

      if (candidates.length === 0) {
        return undefined;
      }

      return [...candidates].sort(
        (left, right) =>
          (right.lastTouchedAt ?? 0) - (left.lastTouchedAt ?? 0) ||
          (right.firstTouchedAt ?? 0) - (left.firstTouchedAt ?? 0) ||
          right.updatesNearZone - left.updatesNearZone,
      )[0];
    };

    for (const zone of [...supportZones, ...resistanceZones]) {
      const context = nextZoneContexts[zone.id];
      nextInteractions[zone.id] =
        selectPreservedInteraction(context, zone.id) ?? createInitialInteractionState(symbol, zone);
    }

    const remapTargetsByPriorZoneId = new Map<string, string>();
    for (const [nextZoneId, context] of Object.entries(nextZoneContexts)) {
      for (const priorZoneId of context.remappedFromZoneIds) {
        if (!remapTargetsByPriorZoneId.has(priorZoneId)) {
          remapTargetsByPriorZoneId.set(priorZoneId, nextZoneId);
        }
      }
    }

    const remappedRecentEvents = symbolState.recentEvents
      .map((event) => {
        const nextZoneId = zoneIds.has(event.zoneId)
          ? event.zoneId
          : remapTargetsByPriorZoneId.get(event.zoneId);
        if (!nextZoneId) {
          return null;
        }

        const nextContext = nextZoneContexts[nextZoneId];
        if (!nextContext) {
          return null;
        }

        return {
          ...event,
          zoneId: nextZoneId,
          eventContext: {
            ...event.eventContext,
            monitoredZoneId: nextContext.monitoredZoneId,
            canonicalZoneId: nextContext.canonicalZoneId,
            zoneFreshness: nextContext.zoneFreshness,
            zoneOrigin: nextContext.origin,
            remapStatus: nextContext.remapStatus,
            remappedFromZoneIds: [...nextContext.remappedFromZoneIds],
            dataQualityDegraded: nextContext.dataQualityDegraded,
            recentlyRefreshed: nextContext.recentlyRefreshed,
            recentlyPromotedExtension: nextContext.recentlyPromotedExtension,
            ladderPosition: nextContext.ladderPosition,
            zoneStrengthLabel: nextContext.zoneStrengthLabel,
            sourceGeneratedAt: nextContext.sourceGeneratedAt,
          },
        };
      })
      .filter((event) => event !== null) as MonitoringEvent[];

    symbolState.supportZones = supportZones;
    symbolState.resistanceZones = resistanceZones;
    symbolState.zoneContexts = nextZoneContexts;
    symbolState.interactions = nextInteractions;
    symbolState.recentEvents = remappedRecentEvents;
    symbolState.levelGeneratedAt = output?.generatedAt;
    symbolState.levelFreshness = output?.metadata.freshness;
    symbolState.levelDataQualityFlags = output?.metadata.dataQualityFlags ?? [];
    symbolState.levelStoreVersion = currentVersion;
  }

  private applyVolumeBaseline(
    symbol: string,
    output: ReturnType<LevelStore["getLevels"]>,
  ): void {
    this.volumeTracker.setBaseline(
      symbol,
      output?.metadata.volumeBaselineByTimeframe?.["5m"],
    );
  }

  private syncTrackedSymbols(entries: WatchlistEntry[]): void {
    const activeSymbols = new Set(
      entries
        .filter((entry) => entry.active)
        .map((entry) => entry.symbol.toUpperCase()),
    );

    for (const symbol of this.symbolStates.keys()) {
      if (!activeSymbols.has(symbol)) {
        this.symbolStates.delete(symbol);
        this.intradayStructureTracker.reset(symbol);
        this.stableMarketStructureTracker.reset(symbol);
        this.volumeTracker.reset(symbol);
        this.pendingPriceAnomalies.delete(symbol);
      }
    }

    for (const gateKey of this.emittedEventTimestamps.keys()) {
      const symbol = gateKey.split("|", 1)[0];
      if (symbol && !activeSymbols.has(symbol)) {
        this.emittedEventTimestamps.delete(gateKey);
      }
    }
  }

  private buildEventGateKey(event: MonitoringEvent): string {
    return `${event.symbol}|${event.zoneId}|${event.eventType}`;
  }

  private isEventOnCooldown(event: MonitoringEvent): boolean {
    const gateKey = this.buildEventGateKey(event);
    const previousTimestamp = this.emittedEventTimestamps.get(gateKey);

    if (previousTimestamp === undefined) {
      return false;
    }

    return event.timestamp - previousTimestamp < this.config.eventCooldownMs;
  }

  private markEventEmitted(event: MonitoringEvent): void {
    const gateKey = this.buildEventGateKey(event);
    this.emittedEventTimestamps.set(gateKey, event.timestamp);
  }

  private applyEmittedEventToState(
    state: ZoneInteractionState,
    event: MonitoringEvent,
  ): ZoneInteractionState {
    switch (event.eventType) {
      case "breakout":
      case "breakdown":
      case "reclaim":
        return {
          ...state,
          phase: "confirmed",
        };

      case "fake_breakout":
      case "fake_breakdown":
        return {
          ...state,
          phase: "failed",
        };

      case "rejection":
        return {
          ...state,
          phase: "rejected",
        };

      case "compression":
      default:
        return state;
    }
  }

  private collectZoneEvents(
    symbolState: SymbolMonitoringState,
    zones: FinalLevelZone[],
    update: LivePriceUpdate,
  ): PendingEvent[] {
    const pending: PendingEvent[] = [];
    const zonesToEvaluate = [...zones]
      .map((zone) => {
        let distancePct = 0;

        if (update.lastPrice > zone.zoneHigh) {
          distancePct = (update.lastPrice - zone.zoneHigh) / Math.max(zone.zoneHigh, 0.0001);
        } else if (update.lastPrice < zone.zoneLow) {
          distancePct = (zone.zoneLow - update.lastPrice) / Math.max(zone.zoneLow, 0.0001);
        }

        return {
          zone,
          distancePct,
        };
      })
      .sort((a, b) => a.distancePct - b.distancePct)
      .slice(0, this.config.nearestZonesToEvaluate)
      .map(({ zone }) => zone);

    for (const zone of zonesToEvaluate) {
      const previousState =
        symbolState.interactions[zone.id] ?? createInitialInteractionState(symbolState.symbol, zone);

      const currentState = updateInteractionState({
        previousState,
        zone,
        update,
        previousPrice: symbolState.previousPrice,
        config: this.config,
      });

      symbolState.interactions[zone.id] = currentState;

      const events = detectMonitoringEvents({
        previousState,
        currentState,
        zone,
        update,
        previousPrice: symbolState.previousPrice,
        symbolState,
        config: this.config,
        diagnosticListener: this.options.diagnosticListener,
      });

      for (const event of events) {
        if (this.isEventOnCooldown(event)) {
          continue;
        }

        pending.push({
          event,
          zone,
          updatedState: currentState,
        });
      }
    }

    return pending;
  }

  private dedupeAndPrioritizeEvents(pending: PendingEvent[]): PendingEvent[] {
    const bestByBucket = new Map<string, PendingEvent>();

    for (const item of pending) {
      const bucketKey = `${item.event.symbol}|${item.event.eventType}|${item.event.zoneKind}`;
      const existing = bestByBucket.get(bucketKey);

      if (!existing || item.zone.strengthScore > existing.zone.strengthScore) {
        bestByBucket.set(bucketKey, item);
      }
    }

    return [...bestByBucket.values()]
      .sort((a, b) => b.zone.strengthScore - a.zone.strengthScore)
      .slice(0, this.config.maxEventsPerSymbolPerUpdate);
  }

  private emitPendingEvents(
    symbolState: SymbolMonitoringState,
    pending: PendingEvent[],
    listener: MonitoringEventListener,
  ): void {
    const finalEvents = this.dedupeAndPrioritizeEvents(pending);

    for (const item of finalEvents) {
      const nextState = this.applyEmittedEventToState(item.updatedState, item.event);
      symbolState.interactions[item.zone.id] = nextState;
      recordMonitoringEvent(symbolState, item.event);
      this.markEventEmitted(item.event);
      listener(item.event);
    }
  }

  private shouldSuppressUnconfirmedPriceAnomaly(
    symbolState: SymbolMonitoringState,
    update: LivePriceUpdate,
  ): boolean {
    const guard = this.options.priceAnomalyGuard;
    if (guard?.enabled === false) {
      return false;
    }

    const previousPrice = symbolState.lastPrice;
    if (
      previousPrice === undefined ||
      previousPrice <= 0 ||
      !Number.isFinite(previousPrice) ||
      !Number.isFinite(update.lastPrice) ||
      update.lastPrice <= 0
    ) {
      return false;
    }

    const symbol = symbolState.symbol.toUpperCase();
    const maxMovePct = guard?.maxSingleUpdateMovePct ?? DEFAULT_PRICE_ANOMALY_MAX_MOVE_PCT;
    const movePct = Math.abs(update.lastPrice - previousPrice) / Math.max(Math.abs(previousPrice), 0.0001);

    if (movePct <= maxMovePct) {
      this.pendingPriceAnomalies.delete(symbol);
      return false;
    }

    const pending = this.pendingPriceAnomalies.get(symbol);
    const confirmWindowMs = guard?.confirmWindowMs ?? DEFAULT_PRICE_ANOMALY_CONFIRM_WINDOW_MS;
    const confirmTolerancePct = guard?.confirmTolerancePct ?? DEFAULT_PRICE_ANOMALY_CONFIRM_TOLERANCE_PCT;
    const confirmsPending =
      pending !== undefined &&
      update.timestamp - pending.timestamp <= confirmWindowMs &&
      Math.abs(update.lastPrice - pending.lastPrice) / Math.max(Math.abs(pending.lastPrice), 0.0001) <= confirmTolerancePct;

    if (confirmsPending) {
      this.pendingPriceAnomalies.delete(symbol);
      return false;
    }

    this.pendingPriceAnomalies.set(symbol, {
      lastPrice: update.lastPrice,
      timestamp: update.timestamp,
      previousPrice,
    });
    return true;
  }

  private handleUpdate(
    update: LivePriceUpdate,
    listener: MonitoringEventListener,
    onPriceUpdate?: LivePriceListener,
  ): void {
    const symbol = update.symbol.toUpperCase();
    const symbolState = this.ensureSymbolState(symbol);
    this.reconcileSymbolState(symbolState);

    if (this.shouldSuppressUnconfirmedPriceAnomaly(symbolState, update)) {
      return;
    }

    symbolState.previousPrice = symbolState.lastPrice;
    symbolState.lastPrice = update.lastPrice;
    symbolState.lastUpdateAt = update.timestamp;
    symbolState.intradayStructure = this.intradayStructureTracker.update(update);
    symbolState.stableMarketStructure = this.stableMarketStructureTracker.update(update);
    symbolState.volumeActivity = this.volumeTracker.update(update);

    const pending = [
      ...this.collectZoneEvents(symbolState, symbolState.supportZones, update),
      ...this.collectZoneEvents(symbolState, symbolState.resistanceZones, update),
    ];

    this.emitPendingEvents(symbolState, pending, listener);
    onPriceUpdate?.(update);
  }

  async start(
    entries: WatchlistEntry[],
    listener: MonitoringEventListener,
    onPriceUpdate?: LivePriceListener,
  ): Promise<void> {
    const normalized = entries.map((entry) => ({
      ...entry,
      symbol: entry.symbol.toUpperCase(),
    }));

    this.syncTrackedSymbols(normalized);

    for (const entry of normalized) {
      if (!entry.active) {
        continue;
      }

      this.ensureSymbolState(entry.symbol);
    }

    await this.livePriceProvider.start(normalized, (update) => {
      this.handleUpdate(update, listener, onPriceUpdate);
    });
  }

  async stop(): Promise<void> {
    await this.livePriceProvider.stop();
  }
}
