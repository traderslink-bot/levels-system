// 2026-04-14 10:34 PM America/Toronto
// Main Phase 2 monitor orchestrator with event deduplication, cooldowns, strongest-zone filtering,
// and optional raw event listener support for downstream alert intelligence.

import type { FinalLevelZone } from "../levels/level-types.js";
import { DEFAULT_MONITORING_CONFIG, type MonitoringConfig } from "./monitoring-config.js";
import { detectMonitoringEvents } from "./event-detector.js";
import { createInitialInteractionState, updateInteractionState } from "./interaction-state-machine.js";
import type { LivePriceProvider } from "./live-price-types.js";
import type {
  LivePriceUpdate,
  MonitoringEvent,
  SymbolMonitoringState,
  WatchlistEntry,
  ZoneInteractionState,
} from "./monitoring-types.js";
import { LevelStore } from "./level-store.js";

export type MonitoringEventListener = (event: MonitoringEvent) => void;

type PendingEvent = {
  event: MonitoringEvent;
  zone: FinalLevelZone;
  updatedState: ZoneInteractionState;
};

export class WatchlistMonitor {
  private readonly symbolStates = new Map<string, SymbolMonitoringState>();
  private readonly emittedEventTimestamps = new Map<string, number>();

  constructor(
    private readonly levelStore: LevelStore,
    private readonly livePriceProvider: LivePriceProvider,
    private readonly config: MonitoringConfig = DEFAULT_MONITORING_CONFIG,
  ) {}

  private ensureSymbolState(symbol: string): SymbolMonitoringState {
    const existing = this.symbolStates.get(symbol);
    if (existing) {
      return existing;
    }

    const state: SymbolMonitoringState = {
      symbol,
      supportZones: this.levelStore.getSupportZones(symbol),
      resistanceZones: this.levelStore.getResistanceZones(symbol),
      interactions: {},
      recentEvents: [],
    };

    for (const zone of [...state.supportZones, ...state.resistanceZones]) {
      state.interactions[zone.id] = createInitialInteractionState(symbol, zone);
    }

    this.symbolStates.set(symbol, state);
    return state;
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
        config: this.config,
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
      symbolState.recentEvents.push(item.event);
      this.markEventEmitted(item.event);
      listener(item.event);
    }
  }

  private handleUpdate(update: LivePriceUpdate, listener: MonitoringEventListener): void {
    const symbol = update.symbol.toUpperCase();
    const symbolState = this.ensureSymbolState(symbol);

    symbolState.previousPrice = symbolState.lastPrice;
    symbolState.lastPrice = update.lastPrice;
    symbolState.lastUpdateAt = update.timestamp;

    const pending = [
      ...this.collectZoneEvents(symbolState, symbolState.supportZones, update),
      ...this.collectZoneEvents(symbolState, symbolState.resistanceZones, update),
    ];

    this.emitPendingEvents(symbolState, pending, listener);

    if (symbolState.recentEvents.length > 50) {
      symbolState.recentEvents.splice(0, symbolState.recentEvents.length - 50);
    }
  }

  async start(entries: WatchlistEntry[], listener: MonitoringEventListener): Promise<void> {
    const normalized = entries.map((entry) => ({
      ...entry,
      symbol: entry.symbol.toUpperCase(),
    }));

    for (const entry of normalized) {
      this.ensureSymbolState(entry.symbol);
    }

    await this.livePriceProvider.start(normalized, (update) => {
      this.handleUpdate(update, listener);
    });
  }

  async stop(): Promise<void> {
    await this.livePriceProvider.stop();
  }
}
