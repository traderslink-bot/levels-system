/** Owner edits the opening message; generated links and configured audience remain intact. */
export function formatWatchlistDiscordHeading(content:string):string {
 // Presentation only. Run before freezing a new publication, never on retries.
 return content.replace(/^[^\r\n]+/,line=>/^#{1,3} /.test(line)?line:`### ${line}`);
}
export function discordTextParts(content:string){
 const split=content.indexOf('\n\n');
 return {text:split<0?content:content.slice(0,split),suffix:split<0?'':content.slice(split)};
}
export function applyDiscordOwnerText(content:string,text:unknown):string {
 if(text===undefined)return formatWatchlistDiscordHeading(content);
 if(typeof text!=='string'||!text.trim())throw Error('Enter Discord post text.');
 // Audience is controlled by the existing channel settings, not a typed mention.
 if(/@(everyone|here)\b|<@/i.test(text))throw Error('Use Discord notification settings for mentions.');
 const result=formatWatchlistDiscordHeading(text.trim()+discordTextParts(content).suffix);
 if(result.length>2000)throw Error('Discord post text is too long.');
 return result;
}
