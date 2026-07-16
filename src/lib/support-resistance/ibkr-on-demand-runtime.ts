import { IBApi } from "@stoqey/ib";

import type { CandleFetchServiceOptions } from "../market-data/candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "../market-data/ibkr-historical-candle-provider.js";
import type { BaseCandleProviderResponse } from "../market-data/candle-types.js";
import type {
  HistoricalCandleProvider,
  HistoricalFetchPlan,
  HistoricalFetchRequest,
} from "../market-data/provider-types.js";

type IBApiWithEvents = IBApi & {
  connect: () => void;
  disconnect: () => void;
  on: (eventName: string, handler: (...args: any[]) => void) => void;
  off: (eventName: string, handler: (...args: any[]) => void) => void;
};

type ReconnectInfo = {
  code: 1101 | 1102;
  requiresResubscribe: boolean;
};

type RuntimeState = {
  isConnected: boolean;
  reconnecting: boolean;
  reconnectTimer?: NodeJS.Timeout;
  reconnectListeners: Set<(info: ReconnectInfo) => void>;
  disconnectListeners: Set<() => void>;
  intentionalDisconnect: boolean;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (error: unknown, code?: number) => void;
};

export type CreateIbkrOnDemandCandleFetchServiceOptionsArgs = {
  clientId?: number;
  host?: string;
  port?: number;
  historicalTimeoutMs?: number;
  connectionTimeoutMs?: number;
  ib?: IBApi;
};

const runtimeStateByClient = new WeakMap<IBApi, RuntimeState>();
const ibClientByConnectionKey = new Map<string, IBApi>();

export const DEFAULT_ON_DEMAND_IBKR_HOST = "127.0.0.1";
export const DEFAULT_ON_DEMAND_IBKR_PORT = 7497;
export const DEFAULT_ON_DEMAND_IBKR_CLIENT_ID = 101;
export const DEFAULT_ON_DEMAND_IBKR_HISTORICAL_TIMEOUT_MS = 30_000;
export const DEFAULT_ON_DEMAND_IBKR_CONNECTION_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 2_000;

function getIbApiWithEvents(ib: IBApi): IBApiWithEvents {
  return ib as IBApiWithEvents;
}

function clearReconnectTimer(state: RuntimeState): void {
  if (!state.reconnectTimer) {
    return;
  }

  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = undefined;
}

function notifyDisconnect(state: RuntimeState): void {
  for (const listener of state.disconnectListeners) {
    listener();
  }
}

function notifyReconnect(state: RuntimeState, info: ReconnectInfo): void {
  for (const listener of state.reconnectListeners) {
    listener(info);
  }
}

function scheduleReconnect(ib: IBApi, state: RuntimeState): void {
  if (state.reconnecting || state.isConnected) {
    return;
  }

  state.reconnecting = true;

  const ibWithEvents = getIbApiWithEvents(ib);

  const attemptReconnect = (): void => {
    if (state.isConnected) {
      state.reconnecting = false;
      clearReconnectTimer(state);
      return;
    }

    try {
      ibWithEvents.connect();
    } catch {
      // Keep retrying until the client reconnects or the process exits.
    }

    state.reconnectTimer = setTimeout(attemptReconnect, RECONNECT_DELAY_MS);
  };

  state.reconnectTimer = setTimeout(attemptReconnect, RECONNECT_DELAY_MS);
}

function wrapDisconnectForIntent(ib: IBApi, state: RuntimeState): void {
  const ibWithEvents = getIbApiWithEvents(ib);
  const originalDisconnect = ibWithEvents.disconnect.bind(ibWithEvents);

  ibWithEvents.disconnect = () => {
    state.intentionalDisconnect = true;
    return originalDisconnect();
  };
}

export function initializeIbkrRuntime(ib: IBApi): IBApi {
  const existing = runtimeStateByClient.get(ib);

  if (existing) {
    return ib;
  }

  const state: RuntimeState = {
    isConnected: ib.isConnected,
    reconnecting: false,
    reconnectListeners: new Set(),
    disconnectListeners: new Set(),
    intentionalDisconnect: false,
    onConnected: () => {
      state.isConnected = true;
      state.reconnecting = false;
      state.intentionalDisconnect = false;
      clearReconnectTimer(state);
    },
    onDisconnected: () => {
      state.isConnected = false;
      notifyDisconnect(state);
      if (state.intentionalDisconnect) {
        state.intentionalDisconnect = false;
        return;
      }
      scheduleReconnect(ib, state);
    },
    onError: (_error: unknown, code?: number) => {
      if (code === 1100) {
        if (state.isConnected) {
          state.isConnected = false;
          notifyDisconnect(state);
        }

        scheduleReconnect(ib, state);
        return;
      }

      if (code === 1101 || code === 1102) {
        state.isConnected = true;
        state.reconnecting = false;
        clearReconnectTimer(state);
        notifyReconnect(state, {
          code,
          requiresResubscribe: code === 1101,
        });
      }
    },
  };

  const ibWithEvents = getIbApiWithEvents(ib);
  wrapDisconnectForIntent(ib, state);
  ibWithEvents.on("connected", state.onConnected);
  ibWithEvents.on("disconnected", state.onDisconnected);
  ibWithEvents.on("error", state.onError);

  runtimeStateByClient.set(ib, state);
  return ib;
}

export function createIbkrClient(args: {
  clientId?: number;
  host?: string;
  port?: number;
} = {}): IBApi {
  const ib = new IBApi({
    host: args.host ?? DEFAULT_ON_DEMAND_IBKR_HOST,
    port: args.port ?? DEFAULT_ON_DEMAND_IBKR_PORT,
    clientId: args.clientId ?? DEFAULT_ON_DEMAND_IBKR_CLIENT_ID,
  });

  return initializeIbkrRuntime(ib);
}

function ibkrConnectionKey(args: {
  clientId?: number;
  host?: string;
  port?: number;
}): string {
  return [
    args.host ?? DEFAULT_ON_DEMAND_IBKR_HOST,
    args.port ?? DEFAULT_ON_DEMAND_IBKR_PORT,
    args.clientId ?? DEFAULT_ON_DEMAND_IBKR_CLIENT_ID,
  ].join(":");
}

export function getOrCreateIbkrClient(args: {
  clientId?: number;
  host?: string;
  port?: number;
} = {}): IBApi {
  const key = ibkrConnectionKey(args);
  const existing = ibClientByConnectionKey.get(key);

  if (existing) {
    return initializeIbkrRuntime(existing);
  }

  const ib = createIbkrClient(args);
  ibClientByConnectionKey.set(key, ib);

  return ib;
}

export function isIbkrConnected(ib: IBApi): boolean {
  const state = runtimeStateByClient.get(ib);

  return state?.isConnected ?? ib.isConnected;
}

export function isIbkrReconnecting(ib: IBApi): boolean {
  return runtimeStateByClient.get(ib)?.reconnecting ?? false;
}

export async function waitForIbkrConnection(
  ib: IBApi,
  timeoutMs: number = DEFAULT_ON_DEMAND_IBKR_CONNECTION_TIMEOUT_MS,
): Promise<void> {
  const ibWithEvents = getIbApiWithEvents(initializeIbkrRuntime(ib));

  if (isIbkrConnected(ib)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeoutHandle);
      ibWithEvents.off("connected", onConnected);
      ibWithEvents.off("error", onError);
    };

    const finalizeResolve = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    const finalizeReject = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const onConnected = (): void => {
      finalizeResolve();
    };

    const onError = (error: unknown, code?: number): void => {
      if (typeof code !== "number" || code < 500 || code >= 600) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Unknown IBKR connection error.";

      finalizeReject(new Error(`IBKR connection failed (code ${code}): ${message}`));
    };

    const timeoutHandle = setTimeout(() => {
      finalizeReject(
        new Error(`Timed out after ${timeoutMs}ms waiting for IBKR connection.`),
      );
    }, timeoutMs);

    ibWithEvents.on("connected", onConnected);
    ibWithEvents.on("error", onError);
    ibWithEvents.connect();
  });
}

export function onIbkrReconnect(
  ib: IBApi,
  listener: (info: ReconnectInfo) => void,
): () => void {
  initializeIbkrRuntime(ib);
  const state = runtimeStateByClient.get(ib)!;
  state.reconnectListeners.add(listener);

  return () => {
    state.reconnectListeners.delete(listener);
  };
}

export function onIbkrDisconnect(ib: IBApi, listener: () => void): () => void {
  initializeIbkrRuntime(ib);
  const state = runtimeStateByClient.get(ib)!;
  state.disconnectListeners.add(listener);

  return () => {
    state.disconnectListeners.delete(listener);
  };
}

class ConnectedIbkrHistoricalCandleProvider implements HistoricalCandleProvider {
  readonly providerName = "ibkr" as const;
  private readonly delegate: IbkrHistoricalCandleProvider;

  constructor(
    private readonly ib: IBApi,
    private readonly historicalTimeoutMs: number,
    private readonly connectionTimeoutMs: number,
  ) {
    this.delegate = new IbkrHistoricalCandleProvider(ib, historicalTimeoutMs);
  }

  async fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    await waitForIbkrConnection(this.ib, this.connectionTimeoutMs);

    return this.delegate.fetchCandles(request, plan);
  }
}

export function createIbkrOnDemandCandleFetchServiceOptions(
  args: CreateIbkrOnDemandCandleFetchServiceOptionsArgs = {},
): CandleFetchServiceOptions {
  const historicalTimeoutMs =
    args.historicalTimeoutMs ?? DEFAULT_ON_DEMAND_IBKR_HISTORICAL_TIMEOUT_MS;
  const connectionTimeoutMs =
    args.connectionTimeoutMs ?? DEFAULT_ON_DEMAND_IBKR_CONNECTION_TIMEOUT_MS;
  const ib =
    args.ib ??
    getOrCreateIbkrClient({
      clientId: args.clientId,
      host: args.host,
      port: args.port,
    });

  initializeIbkrRuntime(ib);

  return {
    providerName: "ibkr",
    provider: new ConnectedIbkrHistoricalCandleProvider(
      ib,
      historicalTimeoutMs,
      connectionTimeoutMs,
    ),
    ib,
    ibkrTimeoutMs: historicalTimeoutMs,
  };
}
