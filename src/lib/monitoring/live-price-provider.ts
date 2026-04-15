// 2026-04-14 09:28 PM America/Toronto
// Stub live price provider so the monitoring system can run before IBKR is wired in.

import type { LivePriceProvider, LivePriceListener } from "./live-price-types.js";
import type { WatchlistEntry } from "./monitoring-types.js";

function seededNumber(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export class StubLivePriceProvider implements LivePriceProvider {
  private timer?: NodeJS.Timeout;
  private tick = 0;

  async start(entries: WatchlistEntry[], onUpdate: LivePriceListener): Promise<void> {
    const active = entries.filter((entry) => entry.active);
    const basePrices = new Map<string, number>();

    active.forEach((entry, index) => {
      basePrices.set(entry.symbol, 4.4 + index * 0.35);
    });

    this.timer = setInterval(() => {
      this.tick += 1;

      for (const entry of active) {
        const base = basePrices.get(entry.symbol) ?? 4.5;
        const wobble = (seededNumber(this.tick * (entry.symbol.length + 3)) - 0.5) * 0.18;
        const trend = Math.sin(this.tick / 5) * 0.05;
        const price = Number((base + wobble + trend).toFixed(4));

        onUpdate({
          symbol: entry.symbol,
          timestamp: Date.now(),
          lastPrice: price,
          volume: Math.round(10000 + seededNumber(this.tick + price) * 50000),
        });
      }
    }, 1200);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
