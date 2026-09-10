export function isConfirmedDiscordRejectionStatus(status: number): boolean {
  return [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(status);
}

/** Only a received HTTP rejection, never a timeout or an inferred failure. */
export class DiscordConfirmedRejection extends Error {
  constructor(readonly status: number) {
    super(`Discord rejected the approved message (${status}).`);
    if (!isConfirmedDiscordRejectionStatus(status)) throw new Error("Not a confirmed Discord rejection status.");
    this.name = "DiscordConfirmedRejection";
  }
}
