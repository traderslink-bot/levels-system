type Receipt = {channelId:string;messageId:string};
type Event = {revision:number;body:{kind:string;status?:string;approvalRevision?:number;receipt?:Receipt;publication?:{discordWatchlistGroup?:string}}};
type Review = {events:readonly Event[]};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^\d{17,20}$/.test(value);

/** Only acknowledged category-publication messages, never Free Chat or X. */
export function sourceCategoryReceipts(review:Review|null,group:string):Receipt[]{
  const approvals=new Set((review?.events??[]).filter(event=>event.body.kind==='approve'&&event.body.publication?.discordWatchlistGroup===group).map(event=>event.revision));
  const receipts=new Map<string,Receipt>();
  for(const event of review?.events??[]){
    const body=event.body,receipt=body.receipt;
    if(body.kind!=='discord_chunk'||body.status!=='acknowledged'||!approvals.has(body.approvalRevision!)||!receipt||!validId(receipt.channelId)||!validId(receipt.messageId))continue;
    receipts.set(receipt.channelId+':'+receipt.messageId,{...receipt});
  }
  return [...receipts.values()];
}

export function categoryMoveLabel(group:string):string{
  if(/^top_watches:\d{4}-\d{2}-\d{2}$/.test(group))return 'Overnight Watches';
  const names:Record<string,string>={top_regular:'Top Regular Hour Watches',main:'Main Session',postmarket:'Post-Market',general:'General Watchlist',swings:'Swings'};
  if(!names[group])throw Error('Unknown Watchlist category.');
  return names[group];
}

/** Moving existing research is not a new analysis, quote, or entry recommendation. */
export function categoryMoveCopy(symbol:string,group:string){
  const label=categoryMoveLabel(group);
  return {title:`${symbol} added to ${label} by "This Guy"`,
    body:label==='Overnight Watches'
      ? `Watching ${symbol} for the next trading session. See the analysis for potential setups and levels to watch.`
      : `${symbol} has moved to ${label}. View the ticker page for available analysis, notes and levels.`};
}
