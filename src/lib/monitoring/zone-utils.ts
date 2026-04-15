// 2026-04-14 09:28 PM America/Toronto
// Utility helpers for zone interaction logic.

import type { FinalLevelZone } from "../levels/level-types.js";

export function distancePctFromZone(price: number, zone: FinalLevelZone): number {
  if (price >= zone.zoneLow && price <= zone.zoneHigh) {
    return 0;
  }

  const boundary = price < zone.zoneLow ? zone.zoneLow : zone.zoneHigh;
  return Math.abs(price - boundary) / Math.max(boundary, 0.0001);
}

export function isInsideZone(price: number, zone: FinalLevelZone): boolean {
  return price >= zone.zoneLow && price <= zone.zoneHigh;
}

export function isAboveZone(price: number, zone: FinalLevelZone): boolean {
  return price > zone.zoneHigh;
}

export function isBelowZone(price: number, zone: FinalLevelZone): boolean {
  return price < zone.zoneLow;
}

export function zoneMidPrice(zone: FinalLevelZone): number {
  return (zone.zoneLow + zone.zoneHigh) / 2;
}
