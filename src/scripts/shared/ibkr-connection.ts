import { IBApi } from "@stoqey/ib";

type IBApiWithEvents = IBApi & {
  off: (eventName: string, handler: (...args: any[]) => void) => void;
  on: (eventName: string, handler: (...args: any[]) => void) => void;
};

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

export async function waitForIbkrConnection(
  ib: IBApi,
  timeoutMs: number = DEFAULT_CONNECTION_TIMEOUT_MS,
): Promise<void> {
  const ibWithEvents = ib as IBApiWithEvents;

  if (ib.isConnected) {
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
    ib.connect();
  });
}
