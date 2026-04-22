export type ManualWatchlistLifecycleEventName =
  | "runtime_started"
  | "monitor_restart_completed"
  | "thread_ready"
  | "activation_queued"
  | "activation_started"
  | "levels_seeded"
  | "activation_completed"
  | "activation_failed"
  | "snapshot_posted"
  | "extension_posted"
  | "alert_posted"
  | "alert_suppressed"
  | "alert_post_failed"
  | "deactivated"
  | "restore_failed";

export type ManualWatchlistLifecycleEvent = {
  type: "manual_watchlist_lifecycle";
  event: ManualWatchlistLifecycleEventName;
  timestamp: number;
  symbol?: string;
  threadId?: string | null;
  details?: Record<string, string | number | boolean | null>;
};

export type ManualWatchlistLifecycleListener = (
  event: ManualWatchlistLifecycleEvent,
) => void;

export function createConsoleManualWatchlistLifecycleListener(): ManualWatchlistLifecycleListener {
  return (event) => {
    console.log(JSON.stringify(event));
  };
}
