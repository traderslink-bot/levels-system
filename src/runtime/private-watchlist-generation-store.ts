import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parsePrivateWatchlistGenerationRequest, parsePrivateWatchlistInput, type PrivateWatchlistGenerationRequest, type PrivateWatchlistInput } from "./private-watchlist-contract.js";

export type PrivateWatchlistCards = Readonly<{ analysis?: unknown; indicators?: unknown; levels?: unknown }>;
export type PrivateWatchlistGenerationReceipt = Readonly<{
  protocolVersion: 1; userId: string; requestId: string; requestHash: string;
  state: "pending" | "completed" | "unresolved" | "not_executed" | "failed";
  maximumCostMicrousd: number; actualCostMicrousd: number | null; cards?: PrivateWatchlistCards;
}>;
export type PrivateGenerationResult =
  | Readonly<{ state: "completed"; actualCostMicrousd: number; cards: PrivateWatchlistCards }>
  | Readonly<{ state: "failed" | "not_executed"; actualCostMicrousd: number }>
  | Readonly<{ state: "unresolved"; actualCostMicrousd: null }>;
export interface BoundedPrivateWatchlistGenerator {
  /** Preparation must never dispatch a billable generation. */
  quote(input: PrivateWatchlistInput): Promise<number>;
  /** Enforce the reservation before every paid attempt, including retries/tools. */
  generate(input: PrivateWatchlistGenerationRequest): Promise<PrivateGenerationResult>;
}
const amount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

/** One durable receipt per member/request. Neither restart nor missing/uncertain
 * receipt authorizes redispatch. No publisher or official Watchlist dependency.
 */
export class PrivateWatchlistGenerationStore {
  constructor(private readonly directory: string, private readonly generator: BoundedPrivateWatchlistGenerator) {}

  async quote(raw: unknown): Promise<{ protocolVersion: 1; bounded: true; maximumCostMicrousd: number }> {
    const maximumCostMicrousd = await this.generator.quote(parsePrivateWatchlistInput(raw));
    if (!amount(maximumCostMicrousd)) throw new Error("Generation cost bound unavailable.");
    return { protocolVersion: 1, bounded: true, maximumCostMicrousd };
  }

  private path(request: PrivateWatchlistGenerationRequest): string {
    return join(this.directory, request.userId, `${request.requestId}.json`);
  }

  async receipt(raw: unknown): Promise<PrivateWatchlistGenerationReceipt> {
    const request = parsePrivateWatchlistGenerationRequest(raw);
    const saved = JSON.parse(await readFile(this.path(request), "utf8")) as PrivateWatchlistGenerationReceipt;
    if (saved.protocolVersion !== 1 || saved.userId !== request.userId || saved.requestId !== request.requestId ||
      saved.requestHash !== request.requestHash || saved.maximumCostMicrousd !== request.maximumCostMicrousd) {
      throw new Error("Private Watchlist receipt identity conflict.");
    }
    return saved;
  }

  async generate(raw: unknown): Promise<PrivateWatchlistGenerationReceipt> {
    const request = parsePrivateWatchlistGenerationRequest(raw);
    const reservation: PrivateWatchlistGenerationReceipt = { protocolVersion: 1,
      userId: request.userId, requestId: request.requestId, requestHash: request.requestHash,
      state: "pending", maximumCostMicrousd: request.maximumCostMicrousd, actualCostMicrousd: null };
    await mkdir(join(this.directory, request.userId), { recursive: true, mode: 0o700 });
    const receiptPath = this.path(request);
    let handle;
    try { handle = await open(receiptPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return this.receipt(request);
    }
    try { await handle.writeFile(JSON.stringify(reservation)); await handle.sync(); }
    finally { await handle.close(); }
    // The directory entry must be durable before any provider can be called.
    // Unsupported filesystems fail closed rather than weakening at-most-once.
    await syncDirectory(join(this.directory, request.userId));
    await syncDirectory(this.directory);
    await syncDirectory(dirname(this.directory));

    let completed: PrivateWatchlistGenerationReceipt = { ...reservation, state: "unresolved" };
    try {
      const result = await this.generator.generate(request);
      if (result.state !== "unresolved") {
        if (!amount(result.actualCostMicrousd) || result.actualCostMicrousd > request.maximumCostMicrousd ||
          (result.state === "not_executed" && result.actualCostMicrousd !== 0)) throw new Error("Invalid private generation cost.");
        if (result.state === "completed") {
          for (const key of ["analysis", "indicators", "levels"] as const) {
            if (request.selection[key] !== (result.cards[key] !== undefined && result.cards[key] !== null)) throw new Error("Invalid selected card result.");
          }
          if (Object.keys(result.cards).some(key => !["analysis", "indicators", "levels"].includes(key))) throw new Error("Unexpected private result.");
          completed = { ...reservation, state: "completed", actualCostMicrousd: result.actualCostMicrousd, cards: result.cards };
        } else completed = { ...reservation, state: result.state, actualCostMicrousd: result.actualCostMicrousd };
      }
    } catch { /* Unknown work keeps the full hold. Never infer zero cost from errors. */ }
    const temporary = `${receiptPath}.settlement`;
    const settlement = await open(temporary, "wx", 0o600);
    try { await settlement.writeFile(JSON.stringify(completed)); await settlement.sync(); }
    finally { await settlement.close(); }
    await rename(temporary, receiptPath);
    await syncDirectory(join(this.directory, request.userId));
    return completed;
  }
}
