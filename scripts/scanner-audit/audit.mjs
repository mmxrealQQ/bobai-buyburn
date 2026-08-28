import {launch,newTab,closeTab} from './cdp.mjs';

const PORT=9333, BASE=process.env.BASE||'http://127.0.0.1:8899/scanner.html';
const W=Number(process.env.W||1280), H=Number(process.env.H||900);

// Known-tricky targets from earlier rounds, then whatever BSC is actually
// trading right now, so the sample is not a museum.
const FIXED=[
  ['BOBAI','0x245c386dcfed896f5c346107596141e5edcbffff'],
  ['BOBAI pool (v2 pair pasted)','0x6eadd4cb786898b34929444988380ed0cc6fd9a6'],
  ['CAKE','0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'],
  ['BTCB','0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c'],
  ['ETH','0x2170ed0880ac9a755fd29b2688956bd959f933f8'],
  ['USDT','0x55d398326f99059ff775485246999027b3197955'],
  ['TUT','0xcaae2a2f939f51d97cdfa9a86e79e3f085b799f3'],
  ['garbage address','0x000000000000000000000000000000000000dead'],
  ['not a token (EOA)','0x15ba17075ef5e0736292b030e3715d9100fe3d38'],
];

async function geckoTokens(n){
  const out=[];
  for(const page of [1,2]){
    try{
      const r=await fetch('https://api.geckoterminal.com/api/v2/networks/bsc/pools?page='+page);
      const j=await r.json();
      for(const p of j.data||[]){
        const id=p.relationships?.base_token?.data?.id||'';
        const a=id.split('_')[1];
        const nm=(p.attributes?.name||'?').split('/')[0].trim();
        if(a&&/^0x[0-9a-f]{40}$/i.test(a)&&!out.some(x=>x[1]===a.toLowerCase()))
          out.push([nm,a.toLowerCase()]);
      }
    }catch(e){}
    await new Promise(r=>setTimeout(r,1200));
  }
  return out.slice(0,n);
}

const CHECKS=`(()=>{
  const out=$=>document.getElementById('sc-out');
  const o=out(),err=document.getElementById('sc-err');
  const txt=o&&!o.hidden?o.innerText:'';
  const etxt=err&&!err.hidden?err.innerText:'';
  const bad=[];
  const scan=(s,where)=>{
    for(const w of ['NaN','undefined','Infinity','null','[object']) if(s.includes(w)) bad.push(where+': "'+w+'"');
  };
  scan(txt,'out'); scan(etxt,'err');
  // An error box is a legitimate outcome — "that address is not a BSC token"
  // is the page working. A JavaScript exception rendered INTO that box is not,
  // and the two were indistinguishable here: a run where every token came back
  // "Something went wrong … token is not defined" was reported as 13/13 clean,
  // because the harness only asked whether an error was shown and never what
  // the error said. A programming error must never pass as a handled one.
  for(const m of ['is not defined','is not a function','Cannot read propert',
                  'undefined is not','null is not','Unexpected token','of undefined'])
    if(etxt.includes(m)||txt.includes(m)) bad.push('js exception surfaced to the reader: "'+m+'"');
  // ladder values
  const rows=[...document.querySelectorAll('.lad-c')].map(c=>
    [...c.querySelectorAll('.lad-r:not(.lad-hr)')].map(r=>({
      size:r.querySelector('.lad-s')?.textContent,
      imp:r.querySelector('.lad-p')?.textContent,
      pay:r.querySelector('.lad-x')?.textContent,
      bar:(()=>{const i=r.querySelector('.lad-b i');if(!i)return null;
        const p=r.querySelector('.lad-b').getBoundingClientRect().width;
        return +(p*new DOMMatrix(getComputedStyle(i).transform).a).toFixed(2)})()
    })));
  const num=s=>{if(!s)return null;const m=s.replace(/[^0-9.\\-]/g,'');return m===''?null:parseFloat(m)};
  rows.forEach((col,ci)=>{
    let prevI=null,prevP=null;
    col.forEach((r,i)=>{
      const im=Math.abs(num(r.imp)??0), pay=num(r.pay);
      if(r.imp&&r.imp!=='—'&&!(im>=0))bad.push('col'+ci+' row'+i+' impact unreadable '+r.imp);
      if(pay!=null&&pay<0)bad.push('col'+ci+' row'+i+' negative cost '+r.pay);
      if(prevI!=null&&im<prevI-1e-9)bad.push('col'+ci+' impact not monotone: '+prevI+' -> '+im);
      if(prevP!=null&&pay!=null&&pay<prevP-1e-9)bad.push('col'+ci+' cost not monotone: '+prevP+' -> '+pay);
      prevI=im;if(pay!=null)prevP=pay;
    });
  });
  // Every cost must clear the pool's own fee: that is the toll, payable at any
  // size, and a figure below it means the cost was measured against a stale price.
  const badge=document.querySelector('.badge')?.textContent||'';
  const fm=badge.match(/([0-9.]+)% (fee|tier)/);
  if(fm){const floor=parseFloat(fm[1]);
    rows.forEach((col,ci)=>col.forEach((r,i)=>{const pay=num(r.pay);
      if(pay!=null&&pay<floor-0.006)bad.push('col'+ci+' row'+i+' cost '+r.pay+' below the '+floor+'% fee floor');}));}
  // layout
  const ov=document.documentElement.scrollWidth>window.innerWidth+1;
  const clipped=[];
  document.querySelectorAll('.st,.cd,.warn,.f,.vn-r,.lad-r').forEach(e=>{
    const p=e.parentElement;if(!p)return;
    const a=e.getBoundingClientRect(),b=p.getBoundingClientRect();
    if(a.right>b.right+1.5)clipped.push((e.className||'')+' overflows parent by '+(a.right-b.right).toFixed(1)+'px');
  });
  return {ok:!!txt, err:etxt.slice(0,220), rows, bad, overflow:ov,
    clipped:clipped.slice(0,6), head:(document.querySelector('.hd-t')?.innerText||'').replace(/\\n/g,' '),
    stats:[...document.querySelectorAll('.st')].map(s=>s.innerText.replace(/\\n/g,' | ')).slice(0,12),
    warns:[...document.querySelectorAll('.warn b')].map(b=>b.textContent).slice(0,5)};
})()`;

const {port}=await launch(PORT,W,H);
const targets=[...FIXED,...(await geckoTokens(Number(process.env.N||26)))];
console.log('targets:',targets.length);
const results=[];
for(const [label,addr] of targets){
  const tab=await newTab(port);
  await tab.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:W<700});
  const errs=[];
  tab.ws.addEventListener('message',ev=>{
    const m=JSON.parse(ev.data);
    if(m.method==='Runtime.exceptionThrown')errs.push('EXC '+(m.params.exceptionDetails?.exception?.description||'').split('\n')[0]);
    if(m.method==='Log.entryAdded'&&m.params.entry.level==='error'&&!/Failed to load resource/.test(m.params.entry.text))errs.push('LOG '+m.params.entry.text.slice(0,140));
  });
  const t0=Date.now();
  let r;
  try{
    await tab.send('Page.navigate',{url:BASE+'?token='+addr});
    // wait for a result or an error, whichever lands first
    for(let i=0;i<90;i++){
      await new Promise(x=>setTimeout(x,700));
      const done=await tab.eval(`(()=>{const o=document.getElementById('sc-out'),e=document.getElementById('sc-err');
        return !!((o&&!o.hidden&&o.children.length)||(e&&!e.hidden&&e.textContent))})()`).catch(()=>false);
      if(done)break;
    }
    r=await tab.eval(CHECKS);
  }catch(e){r={ok:false,bad:['driver: '+e.message],rows:[],err:''}}
  const ms=Date.now()-t0;
  results.push({label,addr,ms,errs,...r});
  await closeTab(port,tab.targetId);
}

let fails=0;
for(const r of results){
  const issues=[...(r.bad||[]),...(r.clipped||[]),...r.errs];
  if(r.overflow)issues.push('HORIZONTAL OVERFLOW');
  if(!r.ok&&!r.err)issues.push('BLANK PAGE — no result, no error');
  const tag=issues.length?'FAIL':'ok  ';
  if(issues.length)fails++;
  console.log(`\n[${tag}] ${r.label} ${r.addr} (${(r.ms/1000).toFixed(1)}s)`);
  if(r.head)console.log('   ',r.head);
  if(r.err)console.log('    ERRBOX:',r.err.replace(/\n/g,' ').slice(0,180));
  if(r.warns?.length)console.log('    warns:',r.warns.join(' | '));
  if(r.rows?.[0]?.length)console.log('    buy :',r.rows[0].map(x=>`${x.size}${x.imp}/${x.pay}[${x.bar}px]`).join(' '));
  if(r.rows?.[1]?.length)console.log('    sell:',r.rows[1].map(x=>`${x.size}${x.imp}/${x.pay}[${x.bar}px]`).join(' '));
  issues.forEach(i=>console.log('    !! '+i));
}
console.log(`\n=== ${results.length-fails}/${results.length} clean, ${fails} with findings ===`);
process.exit(0);
