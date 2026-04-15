type PendingTask = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

const MAX_REQUESTS = 60;
const WINDOW_MS = 10 * 60 * 1000;
const MIN_REQUEST_SPACING_MS = Math.ceil(WINDOW_MS / MAX_REQUESTS);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class IbkrPacingQueue {
  private readonly queue: PendingTask[] = [];
  private readonly timestamps: number[] = [];
  private activeRequests = 0;
  private processing = false;

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task: () => task(),
        resolve: (value) => resolve(value as T),
        reject,
      });

      void this.processQueue();
    });
  }

  private pruneTimestamps(now: number): void {
    while (
      this.timestamps.length > 0 &&
      now - this.timestamps[0]! >= WINDOW_MS
    ) {
      this.timestamps.shift();
    }
  }

  private async waitForCapacity(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.pruneTimestamps(now);

      const oldestTimestamp = this.timestamps[0];
      const lastTimestamp = this.timestamps.at(-1);
      const windowWaitMs =
        this.timestamps.length >= MAX_REQUESTS && oldestTimestamp !== undefined
          ? Math.max(0, WINDOW_MS - (now - oldestTimestamp))
          : 0;
      const spacingWaitMs =
        lastTimestamp !== undefined
          ? Math.max(0, MIN_REQUEST_SPACING_MS - (now - lastTimestamp))
          : 0;
      const waitMs = Math.max(windowWaitMs, spacingWaitMs);

      if (waitMs <= 0) {
        return;
      }

      await delay(waitMs);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) {
          continue;
        }

        await this.waitForCapacity();

        this.activeRequests += 1;
        this.timestamps.push(Date.now());

        try {
          const result = await next.task();
          next.resolve(result);
        } catch (error) {
          next.reject(error);
        } finally {
          this.activeRequests = Math.max(0, this.activeRequests - 1);
        }
      }
    } finally {
      this.processing = false;

      if (this.queue.length > 0) {
        void this.processQueue();
      }
    }
  }

  resetForTests(): void {
    this.queue.length = 0;
    this.timestamps.length = 0;
    this.activeRequests = 0;
    this.processing = false;
  }
}

export const sharedIbkrPacingQueue = new IbkrPacingQueue();
