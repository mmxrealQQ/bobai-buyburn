// Every link on a page, by the colour the browser actually paints it — so
// "the links are blue" is a number, before and after. A link that falls back
// to the browser's own colour is one no stylesheet claimed; the site's rule
// is gold with a light frame, and this counts the ones that escaped it.
//
//   node scripts/dashboard-check/link-colors.mjs <url> [width]
//
// Prints: total links, how many carry the site's gold, how many are the
// browser's blue, and the first few blue ones by text and href.
import {launch,newTab,closeTab} from '../scanner-audit/cdp.mjs';
const [url,W='1280']=process.argv.slice(2);
const {proc,port}=await launch(9800+Math.floor(Math.random()*400),Number(W),900);
const tab=await newTab(port);
await tab.send('Emulation.setDeviceMetricsOverride',{width:Number(W),height:900,deviceScaleFactor:1,mobile:Number(W)<700});
await tab.send('Page.navigate',{url});
await new Promise(r=>setTimeout(r,6000));
const r=await tab.eval(`(()=>{
  const gold=[240,185,11];
  const out={total:0,gold:0,blue:0,other:0,hidden:0,blues:[],framed:0};
  for(const a of document.querySelectorAll('a[href]')){
    const cs=getComputedStyle(a);
    const rect=a.getBoundingClientRect();
    if(!rect.width&&!rect.height){out.hidden++;continue;}
    out.total++;
    const m=(cs.color||'').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if(!m){out.other++;continue;}
    const [R,G,B]=[+m[1],+m[2],+m[3]];
    const isGold=Math.abs(R-gold[0])<40&&Math.abs(G-gold[1])<50&&B<90;
    const isBlue=B>150&&B>R+60&&B>G+30;
    if(isGold){out.gold++;if(cs.borderTopStyle!=='none'&&parseFloat(cs.borderTopWidth)>0)out.framed++;}
    else if(isBlue){out.blue++;const k=(a.className||'[no class]')+' '+cs.color;out.byClass=out.byClass||{};out.byClass[k]=(out.byClass[k]||0)+1;if(out.blues.length<12)out.blues.push((a.textContent.trim().slice(0,40)||'[no text]')+' -> '+a.getAttribute('href').slice(0,60)+' ('+cs.color+') '+a.outerHTML.slice(0,140).replace(/\s+/g,' '));}
    else out.other++;
  }
  return out;})()`);
console.log(JSON.stringify({url,width:Number(W),total:r.total,gold:r.gold,gold_framed:r.framed,blue:r.blue,other:r.other,hidden:r.hidden}));
for(const b of r.blues)console.log('  blue:',b);
if(r.byClass)for(const [k,v] of Object.entries(r.byClass).sort((a,b)=>b[1]-a[1]))console.log('  class:',v,k);
await closeTab(port,tab.targetId);proc.kill();
