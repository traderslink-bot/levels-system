import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveManualWatchlistDurableDirectory } from '../monitoring/manual-watchlist-durable-storage.js';

type Draft = { version: 1; text: string | null; revision: string; actor: string; savedAt: number };
/** Owner-only drafts. Identity includes activation cycle and original analysis, not edit revision. */
export class DiscordPostDraftStore {
  constructor(private readonly directory = join(resolveManualWatchlistDurableDirectory(), 'watchlist-discord-drafts')) {}
  private path(key: string) { return join(this.directory, createHash('sha256').update(key).digest('hex') + '.json'); }
  read(key: string): Draft | null {
    let value: string;
    try { value = readFileSync(this.path(key), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const draft = JSON.parse(value) as Draft;
    if (draft.version !== 1 || (draft.text !== null && typeof draft.text !== 'string') || typeof draft.revision !== 'string') throw Error('Saved post text could not be read.');
    return draft;
  }
  save(key: string, text: string | null, expectedRevision: string | null, actor: string): Draft {
    const previous = this.read(key);
    if ((previous?.revision ?? null) !== expectedRevision) throw Error('Post text changed in another window. Reopen it before saving.');
    const draft: Draft = { version: 1, text, revision: randomUUID(), actor, savedAt: Date.now() };
    mkdirSync(this.directory, { recursive: true });
    const file = this.path(key), temporary = file + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(draft), { mode: 0o600 });
    renameSync(temporary, file);
    return draft;
  }
}
