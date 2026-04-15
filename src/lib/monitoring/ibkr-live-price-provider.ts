// 2026-04-14 11:39 PM America/Toronto
// IBKR live price provider for real-time watchlist monitoring.
// This file intentionally uses a few local type casts because @stoqey/ib
// exposes strict event typings that do not line up cleanly with runtime usage.

import { IBApi } from "@stoqey/ib";
import type { LivePriceProvider, LivePriceListener } from "./live-price-types.js";
import type { WatchlistEntry } from "./monitoring-types.js";

type SymbolSubscription = {
  tickerId: number;
  symbol: string;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  volume?: number;
};

export class IBKRLivePriceProvider implements LivePriceProvider {
  private readonly ib: IBApi;
  private readonly subscriptions = new Map<number, SymbolSubscription>();
  private listener?: LivePriceListener;
  private isConnected = false;
  private hasRegisteredHandlers = false;
  private nextTickerId = 1;

  private readonly handleConnected = (): void => {
    this.isConnected = true;
    console.log(
      `IBKR connected on ${this.host}:${this.port} with clientId ${this.clientId}`,
    );
  };

  private readonly handleDisconnected = (): void => {
    this.isConnected = false;
    console.log("IBKR disconnected");
  };

  private readonly handleError = (
    error: unknown,
    code?: number,
    reqId?: number,
  ): void => {
    console.error("IBKR error:", {
      error,
      code,
      reqId,
    });
  };

  private readonly handleTickPrice = (
    tickerId: number,
    field: number,
    price: number | undefined,
  ): void => {
    const subscription = this.subscriptions.get(tickerId);
    if (
      !subscription ||
      !this.listener ||
      price === undefined ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return;
    }

    // 2026-04-14 11:39 PM America/Toronto
    // IB field mapping:
    // 1 = bid
    // 2 = ask
    // 4 = last
    if (field === 1) {
      subscription.bid = price;
    } else if (field === 2) {
      subscription.ask = price;
    } else if (field === 4) {
      subscription.lastPrice = price;
    } else {
      return;
    }

    const derivedLastPrice =
      subscription.lastPrice ?? subscription.bid ?? subscription.ask;

    if (!derivedLastPrice || derivedLastPrice <= 0) {
      return;
    }

    this.listener({
      symbol: subscription.symbol,
      timestamp: Date.now(),
      lastPrice: derivedLastPrice,
      bid: subscription.bid,
      ask: subscription.ask,
      volume: subscription.volume,
    });
  };

  private readonly handleTickSize = (
    tickerId: number,
    field: number,
    size: number | undefined,
  ): void => {
    const subscription = this.subscriptions.get(tickerId);
    if (
      !subscription ||
      !this.listener ||
      size === undefined ||
      !Number.isFinite(size)
    ) {
      return;
    }

    // 2026-04-14 11:39 PM America/Toronto
    // IB field mapping:
    // 8 = volume
    if (field === 8) {
      subscription.volume = size;
    } else {
      return;
    }

    const derivedLastPrice =
      subscription.lastPrice ?? subscription.bid ?? subscription.ask;

    if (!derivedLastPrice || derivedLastPrice <= 0) {
      return;
    }

    this.listener({
      symbol: subscription.symbol,
      timestamp: Date.now(),
      lastPrice: derivedLastPrice,
      bid: subscription.bid,
      ask: subscription.ask,
      volume: subscription.volume,
    });
  };

  constructor(
    private readonly host: string = "127.0.0.1",
    private readonly port: number = 7497,
    private readonly clientId: number = 101,
  ) {
    this.ib = new IBApi({
      host: this.host,
      port: this.port,
      clientId: this.clientId,
    });
  }

  // 2026-04-14 11:39 PM America/Toronto
  // The package typings for .on(...) are stricter than the runtime event strings we use.
  // Casting only this small boundary keeps the rest of the file typed.
  private get ibAny(): {
    connect: () => void;
    disconnect: () => void;
    on: (eventName: string, handler: (...args: any[]) => void) => void;
    off: (eventName: string, handler: (...args: any[]) => void) => void;
    reqMktData: (
      tickerId: number,
      contract: Record<string, unknown>,
      genericTickList: string,
      snapshot: boolean,
      regulatorySnapshot: boolean,
    ) => void;
    cancelMktData: (tickerId: number) => void;
  } {
    return this.ib as unknown as {
      connect: () => void;
      disconnect: () => void;
      on: (eventName: string, handler: (...args: any[]) => void) => void;
      off: (eventName: string, handler: (...args: any[]) => void) => void;
      reqMktData: (
        tickerId: number,
        contract: Record<string, unknown>,
        genericTickList: string,
        snapshot: boolean,
        regulatorySnapshot: boolean,
      ) => void;
      cancelMktData: (tickerId: number) => void;
    };
  }

  private registerEventHandlers(): void {
    if (this.hasRegisteredHandlers) {
      return;
    }

    this.hasRegisteredHandlers = true;
    this.ibAny.on("connected", this.handleConnected);
    this.ibAny.on("disconnected", this.handleDisconnected);
    this.ibAny.on("error", this.handleError);
    this.ibAny.on("tickPrice", this.handleTickPrice);
    this.ibAny.on("tickSize", this.handleTickSize);
  }

  private unregisterEventHandlers(): void {
    if (!this.hasRegisteredHandlers) {
      return;
    }

    this.ibAny.off("connected", this.handleConnected);
    this.ibAny.off("disconnected", this.handleDisconnected);
    this.ibAny.off("error", this.handleError);
    this.ibAny.off("tickPrice", this.handleTickPrice);
    this.ibAny.off("tickSize", this.handleTickSize);
    this.hasRegisteredHandlers = false;
  }

  private async waitForConnection(timeoutMs: number = 10_000): Promise<void> {
    const start = Date.now();

    while (!this.isConnected) {
      if (Date.now() - start > timeoutMs) {
        throw new Error("Timed out waiting for IBKR connection.");
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async start(entries: WatchlistEntry[], onUpdate: LivePriceListener): Promise<void> {
    await this.stop();

    this.listener = onUpdate;
    this.registerEventHandlers();

    this.ibAny.connect();
    await this.waitForConnection();

    const activeEntries = entries.filter((entry) => entry.active);

    activeEntries.forEach((entry, index) => {
      const tickerId = this.nextTickerId;
      this.nextTickerId += 1;
      const symbol = entry.symbol.toUpperCase();

      this.subscriptions.set(tickerId, {
        tickerId,
        symbol,
      });

      this.ibAny.reqMktData(
        tickerId,
        {
          symbol,
          secType: "STK" as any,
          exchange: "SMART",
          currency: "USD",
        },
        "",
        false,
        false,
      );
    });
  }

  async stop(): Promise<void> {
    for (const [tickerId] of this.subscriptions) {
      try {
        this.ibAny.cancelMktData(tickerId);
      } catch (error) {
        console.error(
          "Failed to cancel market data subscription:",
          tickerId,
          error,
        );
      }
    }

    this.subscriptions.clear();
    this.nextTickerId = 1;

    if (this.isConnected) {
      this.ibAny.disconnect();
    }

    this.unregisterEventHandlers();
    this.listener = undefined;
    this.isConnected = false;
  }
}
