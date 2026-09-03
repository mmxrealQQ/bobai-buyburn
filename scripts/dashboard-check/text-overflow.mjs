// Which text run pushes a page wider than the phone. Elements can be measured
// with getBoundingClientRect, but a nowrap sentence inside a span reports the
// span's box, not the text's — this walks text nodes with a Range and names the
// one that sticks out (found: the x402 price sentence on /services, 427px on a
// 390px phone).
//
//   node scripts/dashboard-check/text-overflow.mjs <url> [width=390]
import {launch,newTab,closeTab} from '../scanner-audit/cdp.mjs';
const [url,W='390']=process.argv.slice(2);
const {proc,port}=await launch(9700+Math.floor(Math.random()*90),Number(W),900);
const tab=await newTab(port);
await tab.send('Emulation.setDeviceMetricsOverride',{width:Number(W),height:900,deviceScaleFactor:1,mobile:true});
await tab.send('Page.navigate',{url});await new Promise(r=>setTimeout(r,6000));
const r=await tab.eval(`(()=>{const W=document.documentElement.clientWidth;const out=[];const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=tw.nextNode())){if(!n.nodeValue.trim())continue;const rg=document.createRange();rg.selectNodeContents(n);for(const b of rg.getClientRects()){if(b.right>W+1){const e=n.parentElement;out.push(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.split(' ')[0]:'')+' right='+Math.round(b.right)+' '+JSON.stringify(n.nodeValue.trim().slice(0,70)));break}}}
const pe=[];for(const e of document.querySelectorAll('body *')){const cs=getComputedStyle(e,'::after');const cb=getComputedStyle(e,'::before');}
return {W,sw:document.documentElement.scrollWidth,text:out.slice(0,15)}})()`);
console.log(JSON.stringify(r,null,1));await closeTab(port,tab.targetId);proc.kill();
