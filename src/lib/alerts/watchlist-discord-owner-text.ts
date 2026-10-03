/** Owner edits the opening message; generated links and configured audience remain intact. */
export function discordTextParts(content:string){
 const split=content.indexOf('\n\n');
 return {text:split<0?content:content.slice(0,split),suffix:split<0?'':content.slice(split)};
}
export function applyDiscordOwnerText(content:string,text:unknown):string {
 if(text===undefined)return content;
 if(typeof text!=='string'||!text.trim())throw Error('Enter Discord post text.');
 // Audience is controlled by the existing channel settings, not a typed mention.
 if(/@(everyone|here)\b|<@/i.test(text))throw Error('Use Discord notification settings for mentions.');
 const result=text.trim()+discordTextParts(content).suffix;
 if(result.length>2000)throw Error('Discord post text is too long.');
 return result;
}
