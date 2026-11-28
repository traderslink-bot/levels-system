import type { RuntimeTradeRevisions, RuntimeTradeRevisionRequest } from "../market-data/runtime-trade-revisions.js";
import type { LiveWatchlistPublishedPatch } from "../live-watchlist/live-watchlist-types.js";
import type { LiveWatchlistPotentialPathPresentation } from "../live-watchlist/live-watchlist-publisher.js";

type View = LiveWatchlistPotentialPathPresentation;
type State<T> = {
  identity: string;
  stamp: number;
  managed: boolean;
  status: "held" | "ordinary" | "corrected";
  revision?: string | null;
  basis?: string;
  retry?: { revision: string | null; after: number; delay: number };
  data?: T;
  dirty: boolean;
};
type Options<T> = {
  enabled(): boolean;
  active(): string[];
  identity(symbol: string): string | undefined;
  basis(symbol: string): string;
  read(scope: RuntimeTradeRevisionRequest): Promise<RuntimeTradeRevisions>;
  rebuild(symbol: string, cutoff: number, revision: string | null): Promise<T>;
  publish(symbol: string): Promise<void>;
  render(symbol: string, data: T, patch: LiveWatchlistPublishedPatch): View | null;
  now(): number;
};

const windowMs = 730 * 86_400_000;

// Only the current member-facing map is replaceable. Historical analyses and
// their publication acknowledgements still carry the exact saved payload.
export class WatchlistPotentialPathCorrections<T> {
  private states = new Map<string, State<T>>();
  private scan?: Promise<void>;
  private generation = 0;
  private lastStamp = 0;
  private stamp(): number {
    return this.lastStamp = Math.max(this.lastStamp + 1, this.options.now() * 1_000);
  }

  constructor(private readonly options: Options<T>) {}

  reset(): void {
    ++this.generation;
    this.states.clear();
  }

  poll(): Promise<void> {
    if (this.scan) return this.scan;
    this.scan = this.run(this.generation).finally(() => { this.scan = undefined; });
    return this.scan;
  }

  private async run(generation: number): Promise<void> {
    const enabled = this.options.enabled();
    const active = new Set(this.options.active());
    for (const symbol of this.states.keys()) {
      if (!active.has(symbol)) this.states.delete(symbol);
    }
    const symbols = [...active];
    for (let i = 0; i < symbols.length; i += 400) {
      if (generation !== this.generation) return;
      const cutoff = this.options.now();
      const batch = symbols.slice(i, i + 400);
      const identities = batch.map(symbol => this.options.identity(symbol));
      let result: RuntimeTradeRevisions | undefined;
      try {
        result = !enabled ? { feed: "sip", symbols: {} } : await this.options.read({ symbols: batch, start: cutoff + 1 - windowMs, end: cutoff + 1 });
      } catch { /* Unknown coverage holds the derived map until a verified read. */ }
      const rebuilds: Array<() => Promise<void>> = [];
      const publications: Array<() => Promise<void>> = [];
      for (const [index, symbol] of batch.entries()) {
        const identity = identities[index];
        const current = () => generation === this.generation && enabled === this.options.enabled() && identity === this.options.identity(symbol);
        if (identity === undefined || !current()) continue;
        let state = this.states.get(symbol);
        if (state?.identity !== identity) {
          state = { identity, stamp: this.stamp(), managed: false, status: "held", dirty: true };
          this.states.set(symbol, state);
        }
        const saved = state;
        const row = result?.symbols[symbol];
        if (!enabled) saved.managed = false;
        if (row) saved.managed = true;
        if (row?.pending) delete saved.retry;
        const revision = row?.revision ?? null;
        const basis = this.options.basis(symbol);
        const flush = async () => {
          if (!current() || !saved.dirty) return;
          try { await this.options.publish(symbol); saved.dirty = false; }
          catch { /* Retry the derived patch on the next scan. */ }
        };
        if (result && !row && !saved.managed) {
          if (saved.status !== "ordinary") saved.stamp = this.stamp();
          saved.dirty ||= saved.status !== "ordinary";
          saved.status = "ordinary";
        } else if (!result || row?.pending || saved.status !== "corrected" ||
                   saved.revision !== revision || saved.basis !== basis) {
          if (saved.status !== "held") saved.stamp = this.stamp();
          saved.dirty ||= saved.status !== "held";
          saved.status = "held";
          delete saved.data;
          const retry = saved.retry;
          if (result && !row?.pending && (!retry || retry.revision !== revision || cutoff >= retry.after)) rebuilds.push(async () => {
            if (!current()) return;
            let data: T;
            try {
              data = await this.options.rebuild(symbol, cutoff, revision);
            } catch {
              if (current()) {
                const delay = Math.min(300_000, retry?.revision === revision ? retry.delay * 2 : 30_000);
                saved.retry = { revision, after: this.options.now() + delay, delay };
              }
              return;
            }
            delete saved.retry;
            if (!current() || this.options.basis(symbol) !== basis) return;
            Object.assign(saved, { stamp: this.stamp(), data, revision, basis, status: "corrected", dirty: true });
            await flush();
          });
        }
        if (saved.dirty) publications.push(flush);
      }
      // Every affected symbol is fenced in memory before any await/publication.
      for (const publish of publications) await publish();
      for (const rebuild of rebuilds) await rebuild();
    }
  }

  project(patch: LiveWatchlistPublishedPatch): LiveWatchlistPublishedPatch {
    if (!("symbol" in patch) || patch.status === "deactivated") return patch;
    const identity = this.options.identity(patch.symbol);
    if (identity === undefined) return patch;
    if ("cards" in patch && !("levelMap" in patch) && !("nearestSupportResistance" in patch.cards) &&
        !("fullLadder" in patch.cards) && !("levelMap" in patch.cards)) return patch;
    let state = this.states.get(patch.symbol);
    if (state?.identity !== identity) {
      state = { identity, stamp: this.stamp(), managed: false, status: "held", dirty: true };
      this.states.set(patch.symbol, state);
    }
    const pathCorrection = { stamp: state.stamp, held: state.status === "held" };
    if (state.status === "ordinary") return { ...patch, pathCorrection };
    const view = state.status === "corrected" && state.data !== undefined
      ? this.options.render(patch.symbol, state.data, patch) : null;
    const levelMap = view?.levelMap ?? null;
    if ("cards" in patch) return { ...patch, pathCorrection, levelMap, cards: { ...patch.cards, levelMap: null,
      nearestSupportResistance: view?.nearestSupportResistanceCard ?? null, fullLadder: view?.fullLadderCard ?? null } };
    return { ...patch, pathCorrection, levelMap, nearestSupport: levelMap?.nearestSupport?.price ?? null,
      nearestResistance: levelMap?.nearestResistance?.price ?? null, nearestSupportLabel: levelMap?.nearestSupport?.label ?? null,
      nearestResistanceLabel: levelMap?.nearestResistance?.label ?? null };
  }
}
