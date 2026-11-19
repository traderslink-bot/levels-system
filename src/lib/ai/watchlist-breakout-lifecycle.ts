import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveManualWatchlistDurableDirectory } from "../monitoring/manual-watchlist-durable-storage.js";

type Level = { price: number | null; rationale: string };
type Read = { breakoutContinuation: Level; simpleAnalysis?: { breakout?: unknown } | null; ownerHiddenSections?: string[]; targets?: Array<{label:string}> };
export type CrossedBreakout = { originalPrice: number; crossedAt: number };
type RecordState = { version: 1; identity: string; symbol: string; price: number; publishedAt: number; crossedAt: number | null };
const validPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Optional generated section only: never called by owner-edit or approval code. */
export function omitFollowupBreakout<T extends Read>(read: T, crossed?: CrossedBreakout): T {
  if (!crossed) return read;
  return { ...read, ...(read.targets ? {targets:read.targets.map(target=>target.label === "Breakout level" ? {...target,label:"Potential target"} : target)} : {}), breakoutContinuation: { ...read.breakoutContinuation, price: null, rationale: "" },
    ...(read.simpleAnalysis ? { simpleAnalysis: { ...read.simpleAnalysis, breakout: null } } : {}) };
}

export function publishedBreakoutPrice(read: unknown): number | null {
  if (!read || typeof read !== "object") return null;
  const value = read as { analysisFormat?: string; ownerHiddenSections?: string[]; simpleAnalysis?: {breakout?:{price?:unknown}}; breakoutContinuation?:{price?:unknown} };
  if (value.ownerHiddenSections?.includes("breakoutContinuation")) return null;
  const price = value.analysisFormat === "simple" ? value.simpleAnalysis?.breakout?.price : value.breakoutContinuation?.price;
  return validPrice(price) ? price : null;
}

/** One original published breakout per true activation; never resets on a move,
 * refresh, a calendar/session change, re-entry below the level or a restart.
 * No extra market requests: uses existing last-trade quotes and completed bars.
 */
export class WatchlistBreakoutLifecycle {
  private readonly cached = new Map<string, RecordState | null>();
  constructor(private readonly directory = join(resolveManualWatchlistDurableDirectory(), "watchlist-breakout-lifecycle")) {}
  private path(identity: string) {
    if (!identity || identity.length > 250) throw Error("Invalid breakout activation.");
    return join(this.directory, createHash("sha256").update(identity).digest("hex") + ".json");
  }
  private read(identity: string): RecordState | null {
    if (this.cached.has(identity)) return this.cached.get(identity)!;
    const path = this.path(identity);
    if (!existsSync(path)) { this.cached.set(identity, null); return null; }
    const value = JSON.parse(readFileSync(path,"utf8")) as RecordState;
    if (value.version !== 1 || value.identity !== identity || !validPrice(value.price) || !Number.isFinite(value.publishedAt) || value.publishedAt <= 0 || (value.crossedAt !== null && (!Number.isFinite(value.crossedAt) || value.crossedAt < value.publishedAt))) throw Error("Breakout history unavailable.");
    this.cached.set(identity,value); return value;
  }
  private save(value: RecordState) {
    mkdirSync(this.directory,{recursive:true});const path=this.path(value.identity);
    writeFileSync(path+".tmp",JSON.stringify(value),{mode:0o600});renameSync(path+".tmp",path);this.cached.set(value.identity,value);
  }
  register(identity: string, symbol: string, price: number, publishedAt: number) {
    if (this.read(identity) || !validPrice(price) || !Number.isFinite(publishedAt) || publishedAt <= 0) return;
    this.save({version:1,identity,symbol,price,publishedAt,crossedAt:null});
  }
  observe(identity: string, price: number, observedAt: number, cutoff = observedAt) {
    const state=this.read(identity);
    if (!state || state.crossedAt !== null || !validPrice(price) || !Number.isFinite(observedAt) || observedAt < state.publishedAt || observedAt > cutoff || price <= state.price) return;
    this.save({...state,crossedAt:observedAt});
  }
  observeBars(identity: string, bars: readonly {timestamp:number;high:number}[], duration: number, cutoff: number) {
    const state=this.read(identity);if(!state || state.crossedAt!==null)return;
    for(const bar of bars){
      // A bar spanning publication cannot establish whether its high came first.
      if(bar.timestamp < state.publishedAt || !Number.isFinite(duration) || duration<=0 || bar.timestamp+duration>cutoff)continue;
      this.observe(identity,bar.high,bar.timestamp+duration,cutoff);
    }
  }
  crossed(identity: string): CrossedBreakout | undefined {
    const state=this.read(identity);
    return state?.crossedAt != null ? {originalPrice:state.price,crossedAt:state.crossedAt} : undefined;
  }
}
