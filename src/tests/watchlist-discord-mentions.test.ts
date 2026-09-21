import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedDiscordMentions, appendDiscordMentions, discordAudience, loadDiscordMentions, saveDiscordMentions, validateDiscordMentions } from "../lib/alerts/watchlist-discord-mentions.js";
import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";
import { renderApprovedAnalysisDiscord, publicationPreviewHash } from "../lib/ai/traderslink-ai-read-publication-preview.js";
import { dispatchAnalysisReviewRequest } from "../runtime/manual-watchlist-analysis-review-api.js";
import { WATCHLIST_DISCORD_MENTIONS_PANEL } from "../runtime/manual-watchlist-discord-mentions-panel.js";

test("Discord mention settings persist off, role removal and replacement across reloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "watchlist-mentions-test-")); const path = join(dir, "settings.json");
  try {
    assert.deepEqual(loadDiscordMentions(path, "12345678901234567"), { everyone:true,roles:[{id:"12345678901234567",label:"Premium Members",enabled:true}] });
    const settings = { everyone:false,roles:[{id:"12345678901234567",label:"Premium",enabled:true},{id:"23456789012345678",label:"Other",enabled:false}] };
    saveDiscordMentions(settings,path); assert.deepEqual(loadDiscordMentions(path),settings);
    assert.deepEqual(discordAudience(loadDiscordMentions(path)),{everyone:false,roles:["12345678901234567"]});
    saveDiscordMentions({everyone:false,roles:[]},path); assert.deepEqual(loadDiscordMentions(path).roles,[]);
    saveDiscordMentions({everyone:true,roles:[settings.roles[1]]},path); assert.deepEqual(discordAudience(loadDiscordMentions(path)),{everyone:true,roles:[]});
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("role validation rejects malformed IDs, duplicates and invalid choices", () => {
  for (const roles of [[{id:"@everyone",label:"Role",enabled:true}], [{id:"12345678901234567",label:"",enabled:true}], [{id:"12345678901234567",label:"Role",enabled:"yes"}], Array(21).fill({id:"12345678901234567",label:"Role",enabled:true}), Array(2).fill({id:"12345678901234567",label:"Role",enabled:true})]) assert.throws(()=>validateDiscordMentions({everyone:false,roles}));
});
test("approved Discord bot and webhook payloads include only frozen audience and preserve images", async () => {
  for(const webhook of [false,true]) for(const audience of [{everyone:true,roles:["12345678901234567"]},{everyone:false,roles:["12345678901234567"]},{everyone:false,roles:[]}]) {
    let posted: any;
    const gateway = new DiscordRestThreadGateway({botToken:"fake",watchlistChannelId:"23456789012345678", ...(webhook?{webhookUrl:"https://discord.com/api/webhooks/34567890123456789/fake-token"}:{}),
      fetchImpl:async(_url,init)=>{if(init?.method === "GET") return Response.json({channel_id:"23456789012345678"}); posted = JSON.parse(init!.body instanceof FormData ? String(init!.body.get("payload_json")) : String(init!.body)); return Response.json({id:"45678901234567890"});}});
    const content=appendDiscordMentions("TEST added\nhttps://app.test/watchlist/TEST",audience);
    await gateway.sendApprovedAnalysisChunk({symbol:"TEST",deliveryKey:"key",content,audience,attachments:[{filename:"TEST-analysis-1.png",description:"Approved analysis",bytes:new Uint8Array([1,2])}]});
    assert.equal(posted.content,content); assert.deepEqual(posted.allowed_mentions,allowedDiscordMentions(audience)); assert.equal(posted.attachments[0].filename,"TEST-analysis-1.png");
    assert.equal(posted.content.includes("@everyone"),audience.everyone);
  }
});
test("old approved posts retain no mentions; updated analysis links remain intact", () => {
  assert.deepEqual(allowedDiscordMentions(),{parse:[],roles:[],users:[],replied_user:false});
  const read = {symbol:"TEST"} as Parameters<typeof renderApprovedAnalysisDiscord>[0];
  const audience={everyone:false,roles:["12345678901234567"]};
  assert.match(renderApprovedAnalysisDiscord(read,true,audience)[0]!,/^TEST Analysis updated/);
  assert.match(renderApprovedAnalysisDiscord(read,true,audience)[0]!,/<@&12345678901234567>/);
  const a={website:{symbol:"TEST"},discordChunks:["same"],discordAudience:audience};
  assert.notEqual(publicationPreviewHash(a),publicationPreviewHash({...a,discordAudience:{everyone:false,roles:[]}}));
});
test("mention endpoint requires owner actor and panel routes through authenticated proxy",async()=>{
  const result=await dispatchAnalysisReviewRequest({method:"POST",pathname:"/api/watchlist/analysis-review/discord-mentions",searchParams:new URLSearchParams(),actor:undefined,body:{everyone:true,roles:[]}},{} as any);
  assert.equal(result.status,403);
  const script=WATCHLIST_DISCORD_MENTIONS_PANEL.match(/<script>([\s\S]*)<\/script>/)![1]!; new Function(script);
  assert.ok(script.includes('fetch("/api/watchlist/analysis-review/discord-mentions"'));
  assert.ok(script.includes("textContent = text"));
});
