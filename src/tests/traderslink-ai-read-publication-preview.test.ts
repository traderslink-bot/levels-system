import assert from "node:assert/strict";
import test from "node:test";
import { publicationPreviewHash, renderApprovedAnalysisDiscord, splitApprovedAnalysisText } from "../lib/ai/traderslink-ai-read-publication-preview.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";

test("delivery choices do not invalidate the content preview and analysis updates retain both links", () => {
  const publication = { website: {}, discordChunks: ["links"] };
  assert.equal(publicationPreviewHash(publication), publicationPreviewHash({ ...publication, notificationKind: "analysis", notifyUsers: false }));
  const previous = process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL;
  process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL = "https://app.traderslink.pro/watchlist";
  const update = renderApprovedAnalysisDiscord({ symbol: "PDSB" } as TradersLinkAiReadPayload, true).join("\n");
  if (previous === undefined) delete process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL; else process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL = previous;
  assert.match(update, /Analysis is now available for PDSB/);
  assert.match(update, /View the live watchlist/); assert.match(update, /View PDSB ticker page/);
  assert.doesNotMatch(update, /added to the watchlist/);
});

test("preview splitting preserves every character, including surrogate pairs and long owner lines", () => {
  for (const text of ["a".repeat(1999) + "🚀" + "b".repeat(2200), ("VWAP confirmation\nEMA support\n").repeat(200)]) {
    const chunks = splitApprovedAnalysisText(text);
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every((chunk) => chunk.length <= 2000 && !/[\uD800-\uDBFF]$/.test(chunk)));
  }
});

test("Current and Simple approval previews use the original linked notification only", () => {
  const previous = process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL;
  process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL = "https://app.traderslink.pro/watchlist";
  try {
    for (const analysisFormat of ["current", "simple"] as const) {
      const read = {symbol:"ADBT", analysisFormat, currentRead:"PRIVATE ANALYSIS",
        simpleAnalysis:{setup:"PRIVATE SIMPLE"}} as unknown as TradersLinkAiReadPayload;
      const chunks = renderApprovedAnalysisDiscord(read);
      assert.deepEqual(chunks, ["ADBT added to the watchlist.\n\nView the live watchlist: https://app.traderslink.pro/watchlist\nView ADBT ticker page: https://app.traderslink.pro/watchlist/ADBT"]);
      assert.doesNotMatch(chunks.join(""), /PRIVATE|Analysis price|Pullback/);
      const publication = {website:{symbol:"ADBT"},discordChunks:chunks};
      assert.equal(publicationPreviewHash(publication),publicationPreviewHash(structuredClone(publication)));
      assert.notEqual(publicationPreviewHash(publication),publicationPreviewHash({...publication,discordChunks:["different"]}));
    }
  } finally {
    if(previous === undefined) delete process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL;
    else process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL=previous;
  }
});
