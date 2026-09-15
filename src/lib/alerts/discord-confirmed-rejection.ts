export function isConfirmedDiscordRejectionStatus(status: number): boolean {
  return [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(status);
}

/** Only a received HTTP rejection, never a timeout or an inferred failure. */
export type DiscordRateLimit = { retryAt: number; scope: string; reason: string };
export class DiscordConfirmedRejection extends Error {
  constructor(readonly status: number, readonly rateLimit?: DiscordRateLimit) {
    super(rateLimit ? `Discord rate limited delivery (429, ${rateLimit.scope}); retry after ${new Date(rateLimit.retryAt).toISOString()}. ${rateLimit.reason}` : `Discord rejected the approved message (${status}).`);
    if (!isConfirmedDiscordRejectionStatus(status)) throw new Error("Not a confirmed Discord rejection status.");
    this.name = "DiscordConfirmedRejection";
  }
}
