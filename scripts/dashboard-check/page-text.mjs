// Read a page the way a stranger meets it: its visible text, in order, plus
// every console error, failed request and whether the page scrolls sideways.
// This is how round two (2026-09-03) found the scanner teaser that never hid,
// the "in range and earning" line nine hours stale, and the services nav
// 37px past a phone — none of which any assertion-based checker was asking.
//
//   node scripts/dashboard-check/page-text.mjs <url> [waitSelector] [settleMs] [width]
//   CLICK="#sc-feed-go" node scripts/dashboard-check/page-text.mjs <url> "#sc-feed-body table"
//
// waitSelector: wait until this element has content (max 30 s) before settling.
// CLICK: dispatch a click on that selector 1.5 s after load, before waiting.
import {launch,newTab,closeTab} from '../scanner-audit/cdp.mjs';
const [url,sel='',ms='4000',W='1280']=process.argv.slice(2);
const {proc,port}=await launch(9400+Math.floor(Math.random()*400),Number(W),900);
const tab=await newTab(port);
await tab.send('Emulation.setDeviceMetricsOverride',{width:Number(W),height:900,deviceScaleFactor:1,mobile:Number(W)<700});
const errs=[];
tab.ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
  if(m.method==='Runtime.exceptionThrown')errs.push('EXC '+(m.params.exceptionDetails?.exception?.description||'').split('\n')[0]);
  if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errs.push('LOG '+m.params.entry.text.slice(0,160));
  if(m.method==='Runtime.consoleAPICalled'&&(m.params.type==='error'||m.params.type==='warning'))errs.push('CON '+m.params.args.map(a=>a.value||a.description||'').join(' ').slice(0,160));
});
await tab.send('Network.enable');tab.ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.method==='Network.responseReceived'&&m.params.response.status>=400)errs.push('NET '+m.params.response.status+' '+m.params.response.url.slice(0,120));if(m.method==='Network.loadingFailed')errs.push('NETFAIL '+m.params.errorText)});
await tab.send('Page.navigate',{url});
if(process.env.CLICK){await new Promise(r=>setTimeout(r,1500));await tab.eval(`document.querySelector(${JSON.stringify(process.env.CLICK)}).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)}
if(sel){for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,500));
  const ok=await tab.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!(e&&!e.hidden&&(e.children.length||e.textContent.trim()))})()`).catch(()=>false);if(ok)break}}
await new Promise(r=>setTimeout(r,Number(ms)));
const t=await tab.eval(`(()=>{document.querySelectorAll('[hidden]').forEach(()=>{});const sw=document.documentElement.scrollWidth,cw=document.documentElement.clientWidth;return {sw,cw,text:document.body.innerText}})()`);
console.log(t.text);
console.log('\n=== scrollWidth',t.sw,'clientWidth',t.cw,t.sw>t.cw?'HORIZONTAL OVERFLOW':'ok');
console.log('=== console:',errs.length?'\n'+errs.join('\n'):'clean');
await closeTab(port,tab.targetId);proc.kill();
