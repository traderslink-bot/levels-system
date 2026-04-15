import { IBApi } from "@stoqey/ib";

type IBApiWithEvents = IBApi & {
  connect: () => void;
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
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (error: unknown, code?: number) => void;
};

const runtimeStateByClient = new WeakMap<IBApi, RuntimeState>();

export const DEFAULT_IBKR_HOST = "127.0.0.1";
export const DEFAULT_IBKR_PORT = 7497;
export const DEFAULT_IBKR_CLIENT_ID = 101;
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
      // Continue retry loop until the client reconnects.
    }

    state.reconnectTimer = setTimeout(attemptReconnect, RECONNECT_DELAY_MS);
  };

  state.reconnectTimer = setTimeout(attemptReconnect, RECONNECT_DELAY_MS);
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
    onConnected: () => {
      state.isConnected = true;
      state.reconnecting = false;
      clearReconnectTimer(state);
    },
    onDisconnected: () => {
      state.isConnected = false;
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
  ibWithEvents.on("connected", state.onConnected);
  ibWithEvents.on("disconnected", state.onDisconnected);
  ibWithEvents.on("error", state.onError);

  runtimeStateByClient.set(ib, state);
  return ib;
}

export function createIbkrClient(
  clientId: number = DEFAULT_IBKR_CLIENT_ID,
  host: string = DEFAULT_IBKR_HOST,
  port: number = DEFAULT_IBKR_PORT,
): IBApi {
  const ib = new IBApi({
    host,
    port,
    clientId,
  });

  return initializeIbkrRuntime(ib);
}

export function isIbkrConnected(ib: IBApi): boolean {
  const state = runtimeStateByClient.get(ib);
  return state?.isConnected ?? ib.isConnected;
}

export function isIbkrReconnecting(ib: IBApi): boolean {
  return runtimeStateByClient.get(ib)?.reconnecting ?? false;
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

export function onIbkrDisconnect(
  ib: IBApi,
  listener: () => void,
): () => void {
  initializeIbkrRuntime(ib);
  const state = runtimeStateByClient.get(ib)!;
  state.disconnectListeners.add(listener);

  return () => {
    state.disconnectListeners.delete(listener);
  };
}
