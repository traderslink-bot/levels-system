import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyDiscordOwnerText, discordTextParts, formatWatchlistDiscordHeading } from "../lib/alerts/watchlist-discord-owner-text.js";
import { attributeOwnerApprovedDiscord } from "../lib/ai/traderslink-ai-read-publication-preview.js";

const suffix='\n\nImages show part of the analysis. View full analysis in the app 👇\n\nView the live watchlist: https://example.test/watchlist\nView TEST ticker page: https://example.test/watchlist/TEST\n\n@everyone <@&123456789012345678>';
test('listing, first analysis, updates and category moves gain only a heading prefix',()=>{
 for(const title of ['TEST added to the watchlist.','TEST Analysis published','TEST Analysis updated','TEST added to Overnight Watches by "This Guy"']) {
  const original=title+'\nExisting explanation.'+suffix;
  assert.equal(applyDiscordOwnerText(original,undefined),'### '+original);
  assert.equal(discordTextParts(applyDiscordOwnerText(original,undefined)).suffix,suffix);
 }
});
test('automatic update attribution occurs before heading without restoring image text',()=>{
 const [attributed]=attributeOwnerApprovedDiscord(['TEST Analysis updated\nExisting explanation.'+suffix],'runtime:automatic-boundary');
 const result=applyDiscordOwnerText(attributed,undefined);
 assert.match(result,/^### TEST Analysis updated — Auto updated by AI\n/);
 assert.doesNotMatch(result,/by "This Guy"|Images show part/);
 assert.equal(result.slice(4),attributed);
});
test('owner attribution and custom text keep their existing semantics',()=>{
 const [attributed]=attributeOwnerApprovedDiscord(['TEST Analysis updated'+suffix],'platform-owner:00000000-0000-4000-8000-000000000001');
 assert.match(applyDiscordOwnerText(attributed,undefined),/^### TEST Analysis updated by "This Guy"\n/);
 assert.equal(applyDiscordOwnerText(attributed,'My custom TEST title\nMy explanation.'),'### My custom TEST title\nMy explanation.'+suffix);
});
test('heading formatting is idempotent and preserves line endings and existing headings',()=>{
 for(const value of ['### TEST title\nBody','# TEST title\nBody','## TEST title\nBody','TEST title\r\nBody','']) {
  const once=formatWatchlistDiscordHeading(value);
  assert.equal(formatWatchlistDiscordHeading(once),once);
  if(value.startsWith('#')||!value)assert.equal(once,value);
  else assert.equal(once,'### '+value);
 }
});
test('existing Discord character budget includes heading and protected suffix',()=>{
 const body='x'.repeat(2000-4-suffix.length);
 assert.equal(applyDiscordOwnerText('Original'+suffix,body).length,2000);
 assert.throws(()=>applyDiscordOwnerText('Original'+suffix,body+'x'),/too long/);
});
test('custom formatting cannot modify protected links or audience',()=>{
 assert.throws(()=>applyDiscordOwnerText('Original'+suffix,'Hello @everyone'),/notification settings/);
 assert.equal(applyDiscordOwnerText('Original'+suffix,'### TEST custom'),'### TEST custom'+suffix);
});
test('live approval, listing and move paths use final formatting; delivery stays untouched',()=>{
 const manager=readFileSync(new URL('../lib/monitoring/manual-watchlist-runtime-manager.ts',import.meta.url),'utf8');
 const moves=readFileSync(new URL('../lib/alerts/watchlist-category-move-service.ts',import.meta.url),'utf8');
 const gateway=readFileSync(new URL('../lib/alerts/discord-rest-thread-gateway.ts',import.meta.url),'utf8');
 assert.ok(manager.includes('attributeOwnerApprovedDiscord(preview.publication.discordChunks, input.actor).map((chunk,index)=>index===0?applyDiscordOwnerText(chunk,input.discordText):chunk)'));
 assert.ok(manager.includes('map(chunk=>applyDiscordOwnerText(chunk,input.discordText))'));
 assert.ok(manager.includes('discordTextParts(formatWatchlistDiscordHeading(content))'));
 assert.ok(moves.includes('const content=applyDiscordOwnerText('));
 assert.ok(gateway.includes('content: chunk.content,'));
 assert.ok(!gateway.includes('formatWatchlistDiscordHeading'));
});
