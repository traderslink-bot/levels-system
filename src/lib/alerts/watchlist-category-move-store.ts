import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveManualWatchlistDurableDirectory } from "../monitoring/manual-watchlist-durable-storage.js";
import type { CategoryMove } from "./watchlist-category-move-state.js";

export type StoredCategoryMove = CategoryMove & {
  actor: string;
  audience: {everyone:boolean;roles:string[]};
  approvalRevision: number | null;
};
const validId=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const directory=()=>join(resolveManualWatchlistDurableDirectory(),"watchlist-category-moves");
type Ledger={version:1;moves:StoredCategoryMove[]};

/** One small ledger per ticker, owned by the existing single runtime writer. */
export class CategoryMoveStore {
  private path(symbol:string){
    if(!/^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,2})?$/.test(symbol))throw Error("Invalid ticker.");
    return join(directory(),symbol+".json");
  }
  read(symbol:string):StoredCategoryMove[]{
    const file=this.path(symbol);
    if(!existsSync(file))return [];
    const ledger=JSON.parse(readFileSync(file,"utf8")) as Ledger;
    if(ledger.version!==1||!Array.isArray(ledger.moves)||ledger.moves.some(move=>!validId(move.id)||move.symbol!==symbol))throw Error("Saved move status could not be read.");
    return ledger.moves;
  }
  get(symbol:string,id:string){
    if(!validId(id))throw Error("Invalid move request.");
    return this.read(symbol).find(move=>move.id===id);
  }
  save(move:StoredCategoryMove){
    if(!validId(move.id))throw Error("Invalid move request.");
    const file=this.path(move.symbol),moves=this.read(move.symbol),index=moves.findIndex(item=>item.id===move.id);
    if(index>=0){
      const previous=moves[index]!;
      for(const key of ["symbol","cycleId","from","to","createdAt","content","actor","notify","published","approvalRevision"] as const)
        if(previous[key]!==move[key])throw Error("Saved move identity changed.");
      moves[index]=structuredClone(move);
    }else moves.push(structuredClone(move));
    mkdirSync(directory(),{recursive:true});
    writeFileSync(file+".tmp",JSON.stringify({version:1,moves}),{mode:0o600});
    renameSync(file+".tmp",file);
  }
}
