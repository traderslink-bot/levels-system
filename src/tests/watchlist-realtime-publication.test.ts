import assert from "node:assert/strict";
import test from "node:test";
import { ManualWatchlistRuntimeManager, type ManualWatchlistRuntimeManagerOptions } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import type { LiveWatchlistTickerDataPatch } from "../lib/live-watchlist/live-watchlist-types.js";

test("Alpaca live trades bypass legacy 15-second website gate and same-ms prices get ordered revisions", () => {
  const now=Date.parse("2026-11-09T15:00:00Z");
  for(const realtime of [true,false]) {
    const store=new WatchlistStore();
    store.upsertManualEntry({symbol:"TEST",active:true,lifecycle:"active",lastPrice:5,lastPriceUpdateAt:now});
    const published:LiveWatchlistTickerDataPatch[]=[];
    const manager=new ManualWatchlistRuntimeManager({candleFetchService:{},monitor:{},discordAlertRouter:{},
      opportunityRuntimeController:{},levelStore:new LevelStore(),watchlistStore:store,watchlistStatePersistence:{},
      now:()=>now,realtimeTickerPrices:()=>realtime,liveWatchlistPublisher:{publish:async()=>undefined,
        publishTickerData:async (patch: LiveWatchlistTickerDataPatch)=>{published.push(patch);}},
    } as unknown as ManualWatchlistRuntimeManagerOptions);
    const internal=manager as unknown as {refreshPriorRegularClose:()=>void;publishLiveTickerData(update:{symbol:string;timestamp:number;lastPrice:number}):void};
    // Isolate publication from an unrelated historical HTTP lookup.
    internal.refreshPriorRegularClose=()=>undefined;
    internal.publishLiveTickerData({symbol:"TEST",timestamp:now,lastPrice:5});
    internal.publishLiveTickerData({symbol:"TEST",timestamp:now,lastPrice:5.1});
    internal.publishLiveTickerData({symbol:"TEST",timestamp:now+250,lastPrice:5.2});
    assert.equal(published.length,realtime?3:1);
    if(realtime) {
      assert.deepEqual(published.map(p=>p.latestPrice),[5,5.1,5.2]);
      assert.equal(published[1].marketDataObservedAt,now);
      assert(published[1].marketDataRevision!>published[0].marketDataRevision!);
      assert(published[2].marketDataRevision!>published[1].marketDataRevision!);
    }
  }
});

test("an older reconnect trade cannot overwrite stored newer Watchlist price",()=>{
  const now=Date.parse("2026-11-09T15:00:00Z");const store=new WatchlistStore();
  store.upsertManualEntry({symbol:"TEST",active:true,lifecycle:"active",lastPrice:5,lastPriceUpdateAt:now});
  const manager=new ManualWatchlistRuntimeManager({candleFetchService:{},monitor:{},discordAlertRouter:{},opportunityRuntimeController:{},
    levelStore:new LevelStore(),watchlistStore:store,watchlistStatePersistence:{},liveWatchlistPublisher:null,
  } as unknown as ManualWatchlistRuntimeManagerOptions);
  (manager as unknown as {handlePriceUpdate(update:{symbol:string;timestamp:number;lastPrice:number}):void}).handlePriceUpdate({symbol:"TEST",timestamp:now-1,lastPrice:2});
  assert.equal(store.getEntry("TEST")?.lastPrice,5);
});
