/** Isolated, offline preview. It has no publication, provider or live-card imports. */
export type SimpleAnalysisPreview = {
  symbol: string;
  reference: number;
  read: {
    setup: string;
    pullbacks: Array<{low: number; high: number; explanation: string; confirmation: string; invalidation: number}>;
    upside: Array<{low: number; high: number; explanation: string}>;
    invalidation: {price: number; explanation: string} | null;
  };
};

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const price = (value: number) => Number.isFinite(value)
  ? '$' + value.toLocaleString('en-US', {maximumFractionDigits:4}) : '—';
const area = (low: number, high: number) => low === high ? price(low) : `${price(low)}–${price(high)}`;

/** Render only the four intended sections; internal audit and evidence never become prose. */
export function renderSimpleAnalysisPreviewCard({symbol,reference,read}: SimpleAnalysisPreview): string {
  const text = (value: string) => `<p>${escape(value)}</p>`;
  const section = (title: string, body: string) => `<section><h3>${title}</h3>${body}</section>`;
  const pullbacks = [...read.pullbacks].sort((a,b)=>b.high-a.high);
  return `<article><header><h2>${escape(symbol)}</h2><span>Analysis price: ${price(reference)}</span></header>` +
    section('TradersLink Analysis',text(read.setup)) +
    pullbacks.map((plan,index)=>section(index === 0 ? 'Pullback' : 'Deeper pullback',
      `<strong>${area(plan.low,plan.high)}</strong>` + text(plan.explanation) +
      `<p><b>Confirmation:</b> ${escape(plan.confirmation)}</p><p><b>Invalidation:</b> ${price(plan.invalidation)}</p>`)).join('') +
    (read.upside.length ? section('Where it could go next',`<ol>${read.upside.map(level=>
      `<li><strong>${area(level.low,level.high)}</strong>${text(level.explanation)}</li>`).join('')}</ol>`) : '') +
    (read.invalidation ? section('Thesis invalidation',`<strong>${price(read.invalidation.price)}</strong>${text(read.invalidation.explanation)}`) : '') +
    '</article>';
}

export function renderSimpleAnalysisPreviewDocument(cases: SimpleAnalysisPreview[]): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Simple analysis test preview</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#19283e;font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:24px}h1{font-size:24px}nav{display:flex;gap:16px;flex-wrap:wrap;margin:20px 0}a{color:#011e56}article{background:white;border:1px solid #dce2ec;border-radius:12px;margin:24px 0;overflow:hidden}header{padding:20px 24px;background:#edf2fa;display:flex;justify-content:space-between;align-items:center;gap:12px}h2{margin:0;font-size:28px;color:#011e56}section{padding:16px 24px;border-top:1px solid #edf0f5}h3{font-size:16px;margin:0 0 10px;color:#011e56}p{margin:7px 0;white-space:pre-wrap}ol{padding-left:22px;margin:0}li{padding:8px 0}strong{font-size:17px}footer{font-size:13px;color:#526176}@media(max-width:600px){main{padding:12px}header{align-items:flex-start;flex-direction:column}section,header{padding:16px}}
  </style></head><body><main><h1>Simple analysis test preview</h1><p>Saved test analyses — not published. Prices and analysis reflect each saved test packet.</p><nav>${cases.map((item,index)=>`<a href="#case-${index}">${escape(item.symbol)}</a>`).join('')}</nav>${cases.map((item,index)=>`<div id="case-${index}">${renderSimpleAnalysisPreviewCard(item)}</div>`).join('')}<footer>This preview does not change the live Watchlist or send Discord posts.</footer></main></body></html>`;
}
