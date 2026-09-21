// SCANNER — the chain layer. Everything that produces a number lives here; the
// page layer does nothing but display what this returns.
//
// The rule this file exists to enforce: a figure is either measured or it is
// labelled. Nothing is inferred from a reputation service and then presented as
// fact. That rule was not free — an earlier version took the transfer tax from
// GoPlus, which reported 4.45% sell tax for $Max while four executed sells on
// the chain charged exactly 3.000%. The label was wrong, our cost column was
// wrong with it, and nothing on the page would have told you.
//
// Three endpoints, each chosen for one capability:
//   RPC      eth_call. Binance's dataseed refuses eth_getLogs outright.
//   LOGS_RPC eth_getLogs, ~7,900 blocks (an hour) near the head. That is enough to find
//            real trades and measure what they were actually charged.
//   GOPLUS   contract properties no call reveals (mintable, proxy, LP lockers).
//            Optional, always attributed, never silently trusted.
// A single public endpoint cannot carry this page. Measured across a dozen of
// them: Binance's own dataseeds drop whole batches once an address has been
// scanned a few times in a row, Ankr and ninicoin refused every batch outright,
// and one endpoint dropping is indistinguishable — from inside the page — from
// a token having no pools. So there is a pool of endpoints, ordered by measured
// latency at 25 calls, and a failure moves to the next rather than becoming a
// claim about somebody's token. All of them send CORS: * , which is what makes
// running this from the visitor's own browser possible at all.
export const RPCS=['https://bsc.publicnode.com','https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed1.defibit.io','https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed.binance.org','https://1rpc.io/bnb'];
// Endpoints measured on 2026-08-29 against a 5,000-block eth_getLogs on a busy
// pair: only these two answered it at all. defibit and Binance's own dataseed
// said "limit exceeded", blastapi and drpc rate-limited, 1rpc caps the range at
// fifty blocks, llamarpc did not resolve. They share an operator, so they
// probably share a budget — but two hostnames spread a burst of five tier
// queries better than one does, and the caller cannot be asked to go slower.
export const LOGS_RPCS=['https://bsc-rpc.publicnode.com','https://bsc.publicnode.com'];
// THE WINDOW. One eth_getLogs call of this many blocks at the head: an hour of
// chain at BSC's 0.45 s blocks (7,900 blocks = 59 min, so hourly windows taken
// at the same minute never overlap). Measured 2026-09-09: the free log
// endpoint and the keyed one both answer 7,900 blocks in one call and refuse
// only beyond ~12,000 as "archive". It was 4,999 (37.5 min) before, and the
// pool and width records counted that as "hours" — a day of them took a day
// and a half of runs, and the fee estimate rested on 62% of each hour's swaps.
export const WINDOW_BLOCKS=7900;
// The tax read asks for the newest trades first (measureTax): about three
// minutes of chain, and a quarter of the hour when the hour itself is refused
// for the size of its answer.
export const TAX_SHORT_BLOCKS=400,TAX_MID_BLOCKS=2000;
// Live bindings: useKeyedRpcs() below moves a keyed endpoint to the front.
export let RPC=RPCS[0],
  LOGS_RPC=LOGS_RPCS[0];
export const GOPLUS='https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=',
  GOPLUS_TOKEN='https://api.gopluslabs.io/api/v1/token',
  V2FACTORY='0xca143ce32fe78f1f7019d7d551a6402fc5350c73',
  V3FACTORY='0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865',
  QUOTER='0xb048bbc1ee6b733fffcfb9e9cef7375518e25997',
  WBNB='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  BNB_PAIR='0x58f876857a02d6762e0101bb5c46a8c1ed44dc16',
  DEAD='0x000000000000000000000000000000000000dead',
  NULLA='0x0000000000000000000000000000000000000000';
// All 18 decimals on BSC — checked, unlike on other chains where USDT/USDC are 6.
export const QUOTES=[[WBNB,'BNB',0],
  ['0x55d398326f99059ff775485246999027b3197955','USDT',1],
  ['0xe9e7cea3dedca5984780bafc599bd69add087d56','BUSD',1],
  ['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d','USDC',1],
  ['0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d','USD1',1]];
export const V3_FEES=[100,500,2500,10000];
// Constant-product venues, and the fee each one charges.
//
// Every fee here was DERIVED, not read off a docs page: for each router, its
// factory() was confirmed on-chain, then getAmountsOut was solved against the
// pool's live reserves — out*rIn / (in*(rOut-out)) — which returns the fee the
// contract actually applies. PancakeSwap came back 0.2500% exactly, which is
// what validates the method; Uniswap 0.3000%, Biswap 0.2000%.
//
// A factory that is not in this table is NOT scanned and NOT guessed at. That
// matters more than it sounds: the previous build applied PancakeSwap's 0.25%
// to any V2-shaped pair a visitor pasted, so a Uniswap pool's cost column came
// out 0.05 points light with nothing on the page to say so.
export const FACTORIES={
  '0xca143ce32fe78f1f7019d7d551a6402fc5350c73':{name:'PancakeSwap V2',fee:0.0025},
  '0x8909dc15e40173ff4699343b6eb8132c65e18ec6':{name:'Uniswap V2',fee:0.0030},
  '0x858e3312ed3a876947ea49d572a7c42de08af7ee':{name:'Biswap',fee:0.0020},
};
export const V2_FEE=0.0025;
export const STEPS=[100,150,250,500,1000,2500];
// A batch of 40 eth_calls comes back "method eth_call in batch triggered rate
// limit"; 26 goes through in 86ms. Everything below chunks to stay under it.
const MAX_BATCH=25;

const S={reserves:'0x0902f1ac',token0:'0x0dfe1681',token1:'0xd21220a7',fee:'0xddca3f43',
  slot0:'0x3850c7bd',decimals:'0x313ce567',symbol:'0x95d89b41',name:'0x06fdde03',
  totalSupply:'0x18160ddd',factory:'0xc45a0155',feeTo:'0x017e7e58'};
const pad=a=>'0'.repeat(24)+a.slice(2).toLowerCase();
const num=v=>BigInt(v).toString(16).padStart(64,'0');
export const balOf=a=>'0x70a08231'+pad(a);
// A token's decimals as it states them. `Number(x)||18` read a token with 0
// decimals as 18 (2026-09-18): zero is an answer; only no answer is 18.
export const decOf=h=>{if(!h||h==='0x')return 18;const n=Number(hx(h));return Number.isFinite(n)&&n>=0&&n<=36?n:18};
export const getPair=(t,q)=>'0xe6a43905'+pad(t)+pad(q);
export const getPool=(t,q,f)=>'0x1698ee82'+pad(t)+pad(q)+num(f);
export const quoteCall=(tin,tout,amt,fee)=>'0xc6a5026a'+pad(tin)+pad(tout)+num(amt)+num(fee)+num(0);
export const call=(to,data)=>({to,data});
export const hx=h=>(h&&h!=='0x')?BigInt(h):0n;
export const addrAt=h=>h&&h.length>=42?('0x'+h.slice(-40)).toLowerCase():null;
export const res2=h=>h&&h.length>=130
  ?[Number(BigInt('0x'+h.slice(2,66))),Number(BigInt('0x'+h.slice(66,130)))]:null;
export const SEL=S;

// A dynamic string arrives as offset/length/data, but a few older tokens answer
// name()/symbol() with a raw bytes32. Both decode or the label is lost for
// no good reason.
export function decStr(h){
  if(!h||h==='0x')return '';
  const b=h.slice(2);
  try{
    if(b.length>=128){
      const len=parseInt(b.slice(64,128),16);
      if(len>0&&len<=128){
        // ABI string: decode the bytes as UTF-8, not as one char per byte. The
        // byte-per-char reading only accepted ASCII, so every token with a
        // Chinese, Cyrillic or emoji symbol came back as '' and was shown by
        // its address (seen on the four.meme feed, 2026-09-03). Control
        // characters are dropped; everything printable is kept.
        const bytes=new Uint8Array(len);for(let i=0;i<len;i++)bytes[i]=parseInt(b.substr(128+i*2,2),16);
        const s=new TextDecoder('utf-8',{fatal:false}).decode(bytes).replace(/[\x00-\x1f\x7f\ufffd]/g,'').trim();
        if(s)return s;
      }
    }
    let s='';for(let i=0;i<b.length;i+=2){const c=parseInt(b.substr(i,2),16);if(c>=32&&c<127)s+=String.fromCharCode(c)}
    return s.trim();
  }catch(e){return ''}
}
// Chunked, and loud when it fails.
//
// The node answers an over-long batch with one error object PER ENTRY rather
// than one error for the request. Reading those as empty results is how a rate
// limit turned into "this token has no liquidity" — a network condition
// silently rendered as a statement about somebody's token. It cost a real
// scan of $TUT, whose $2.2M pool simply vanished from the page.
//
// So: small chunks, one patient retry, and if the node still will not answer,
// an exception that surfaces as an error message. Never a quiet empty.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Sticky index: once an endpoint answers it keeps being used, so a healthy scan
// costs no extra round trips. It only moves on when one actually fails.
let epi=0;
// A keyed endpoint first, when the caller has one. The browser page and the
// installable skill never do — a key in a downloadable file is a published
// key — but the Worker behind /api/* and /mcp shares its egress address with
// the whole of Cloudflare, and the free publicnode budget it competes for
// there gave one answer in ten a throttled read in September 2026: the tax
// silently "labelled by GoPlus" instead of measured, the sell test "refused".
// A personal token has its own budget. The free list stays behind it as the
// fallback, and everything else — batching, throttle detection, the sticky
// index — is unchanged. Idempotent, so a Worker may call it per request.
export function useKeyedRpcs(urls){
  const add=(urls||[]).map(u=>String(u||'').trim()).filter(u=>/^https:\/\//.test(u));
  if(!add.length)return false;
  for(const list of [RPCS,LOGS_RPCS]){
    const rest=list.filter(u=>!add.includes(u));
    list.splice(0,list.length,...add,...rest);
  }
  RPC=RPCS[0];LOGS_RPC=LOGS_RPCS[0];epi=0;
  return true;
}
// "method eth_call in batch triggered rate limit", "capacity exceeded", 429s.
// Anything mentioning a revert is a real answer and must never match here.
const throttled=e=>{
  const m=String(e&&e.message||'').toLowerCase();
  if(m.includes('revert')||m.includes('execution'))return false;
  return e&&e.code===-32005||/rate|limit|capacity|too many|quota|busy|exceed/.test(m);
};
async function tryPost(url,body){
  try{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    if(!r.ok)return null;
    return await r.json();
  }catch(e){return null}
}
export async function rpcBatch(calls,url,block='latest'){
  const out=[];
  for(let i=0;i<calls.length;i+=MAX_BATCH){
    const part=calls.slice(i,i+MAX_BATCH);
    const body=part.map((c,k)=>({jsonrpc:'2.0',id:k,method:'eth_call',params:[c,block]}));
    let slot=null;
    const pool=url?[url]:RPCS;
    for(let n=0;n<pool.length&&!slot;n++){
      const j=await tryPost(pool[url?0:(epi+n)%pool.length],body);
      if(!Array.isArray(j))continue;
      // Two kinds of error arrive in the same shape and mean opposite things.
      // An EXECUTION REVERT is an answer: asking a plain token for getReserves()
      // is exactly how this page decides it is not a pool, and every call in
      // that batch reverting is the correct result, not a failure. A RATE LIMIT
      // is not an answer at all, and reading one as empty results is how a
      // throttled node once turned into "this token has no liquidity". Only the
      // second kind may move us to another endpoint.
      if(j.some(x=>x.error&&throttled(x.error)))continue;
      const s=[];for(const x of j)s[x.id]=x.result;
      slot=s;if(!url)epi=(epi+n)%pool.length;
    }
    if(!slot)throw new Error('every BSC endpoint refused this request');
    for(let k=0;k<part.length;k++)out.push(slot[k]);
    if(calls.length>MAX_BATCH)await sleep(40);
  }
  return out;
}
export async function rpc(method,params,url){
  const pool=url?[url]:RPCS;
  for(let n=0;n<pool.length;n++){
    const j=await tryPost(pool[url?0:(epi+n)%pool.length],{jsonrpc:'2.0',id:1,method,params});
    if(j&&!j.error)return j.result;
    if(j&&j.error&&url)throw new Error(j.error.message);
  }
  throw new Error('every BSC endpoint refused '+method);
}

// === WHAT IS THIS ADDRESS? ===
// People paste what they have, and what they have is usually a DexScreener link
// — which carries the POOL address, not the token. Guessing wrong here sends the
// whole scan down the wrong path, so the address is asked directly what it is.
export async function classify(addr){
  const q=await rpcBatch([call(addr,S.reserves),call(addr,S.fee),call(addr,S.slot0),
    call(addr,S.token0),call(addr,S.token1),call(addr,S.factory)]);
  if(q[0]&&q[0].length>=194&&res2(q[0])){
    // Which venue built this pair decides the fee. Asked, never assumed.
    const fac=addrAt(q[5]);
    return {kind:'v2pair',token0:addrAt(q[3]),token1:addrAt(q[4]),reserves:res2(q[0]),
      factory:fac,venue:fac?FACTORIES[fac]:null};
  }
  if(q[1]&&q[1]!=='0x'&&q[2]&&q[2].length>64)
    // The factory, asked like the V2 pair's: a Uniswap V3 pool answers the same
    // calls, and read as PancakeSwap's it was scanned under the wrong venue name
    // with the wrong quoter — every cost row null, 1% depth printed as $0
    // (2026-09-18).
    return {kind:'v3pool',fee:Number(hx(q[1])),token0:addrAt(q[3]),token1:addrAt(q[4]),
      sqrt:hx('0x'+q[2].slice(2,66)),factory:addrAt(q[5]),pancake:addrAt(q[5])===V3FACTORY};
  return {kind:'token'};
}

// === PRICING THE QUOTE SIDE ===
// A pool quoted in BNB or a stablecoin can be stated in dollars directly. A pool
// quoted in another meme token cannot — $MatthewCoin trades against $SpaceX, and
// no amount of reading that pair reveals what a dollar is. One hop to BNB fixes
// it, but honestly: the derived figure inherits the thinness of the hop, so the
// depth of that intermediate pool is carried out of here and shown.
export async function priceToken(addr,bnbUsd){
  const known=QUOTES.find(([a])=>a===addr);
  if(known)return {usd:known[2]?1:bnbUsd,sym:known[1],direct:true,dec:18};
  const p=await rpcBatch([call(V2FACTORY,getPair(addr,WBNB)),call(addr,S.symbol),call(addr,S.decimals)]);
  const pair=addrAt(p[0]),sym=decStr(p[1]).slice(0,12)||'?',dec=decOf(p[2]);
  if(!pair||pair===NULLA)return {usd:null,sym,direct:false,dec};
  const r=await rpcBatch([call(pair,S.reserves),call(pair,S.token0)]);
  const rr=res2(r[0]);if(!rr)return {usd:null,sym,direct:false};
  const is0=addrAt(r[1])===addr,
        tok=(is0?rr[0]:rr[1])/Math.pow(10,dec),wb=(is0?rr[1]:rr[0])/1e18;
  if(!(tok>0)||!(wb>0))return {usd:null,sym,direct:false};
  // `dec`: the quote side's own decimals. Every quote this tool knows by name
  // has 18; a pool quoted in another token may not, and the depth maths
  // downstream is written for 18 (see the scan's refusal).
  return {usd:(wb/tok)*bnbUsd,sym,direct:false,hopBnb:wb,hopPair:pair,dec};
}

// === POOL DISCOVERY ===
// Asked of the factories, not of an index. An index that has not caught up makes
// a live token look dead — GoPlus does not list $CAKE's V2 pair at all, and does
// not know $MatthewCoin's. The factory always answers.
export async function discover(token,tokDec,bnbUsd){
  const facs=Object.keys(FACTORIES);
  const v2=[];facs.forEach(f=>QUOTES.forEach(([q])=>v2.push(call(f,getPair(token,q)))));
  const v3=[];QUOTES.forEach(([q])=>V3_FEES.forEach(f=>v3.push(call(V3FACTORY,getPool(token,q,f)))));
  const found=await rpcBatch([...v2,...v3]);
  const cands=[];
  facs.forEach((f,fi)=>QUOTES.forEach(([qa,sym,stable],i)=>{
    const p=addrAt(found[fi*QUOTES.length+i]);
    if(p&&p!==NULLA)cands.push({kind:'v2',pair:p,quote:qa,sym,usd:stable?1:bnbUsd,
      fee:FACTORIES[f].fee,venue:FACTORIES[f].name,factory:f});
  }));
  QUOTES.forEach(([qa,sym,stable],i)=>V3_FEES.forEach((f,k)=>{
    const p=addrAt(found[facs.length*QUOTES.length+i*V3_FEES.length+k]);
    if(p&&p!==NULLA)cands.push({kind:'v3',pair:p,quote:qa,sym,usd:stable?1:bnbUsd,
      fee:f/1e6,feeRaw:f,venue:'PancakeSwap V3'});
  }));
  if(!cands.length)return [];
  // Depth is measured, never assumed: V2 from reserves, V3 from what the pool
  // contract actually holds. A pool that exists but is empty must sort last.
  const calls=[];
  cands.forEach(c=>{
    if(c.kind==='v2')calls.push(call(c.pair,S.reserves),call(c.pair,S.token0));
    else calls.push(call(c.quote,balOf(c.pair)),call(token,balOf(c.pair)));
  });
  const m=await rpcBatch(calls);
  cands.forEach((c,i)=>{
    if(c.kind==='v2'){
      const rr=res2(m[i*2]);if(!rr)return;
      const is0=addrAt(m[i*2+1])===token;
      c.tok=(is0?rr[0]:rr[1])/Math.pow(10,tokDec);c.q=(is0?rr[1]:rr[0])/1e18;
    }else{
      c.q=Number(hx(m[i*2]))/1e18;c.tok=Number(hx(m[i*2+1]))/Math.pow(10,tokDec);
    }
    c.hard=(c.q||0)*c.usd;
  });
  return cands.filter(c=>c.hard>0&&c.tok>0).sort((a,b)=>b.hard-a.hard);
}

// === V2 MATH ===
// IMPACT is where the price ends up: reserves after against reserves before. The
// pool fee stays in the pool and counts; a transfer tax never reaches the
// reserves on a buy, so it cannot move the price at all.
// COST is what the trader gives up against spot — a worse fill because the pool
// moved underneath, plus the fee and the tax on top.
export function ladderV2(tok,q,fee,taxB,taxS,px,quoteUsd){
  const FEE=1-fee,TB=1-taxB,TS=1-taxS;
  return STEPS.map(u=>{
    const dQ=u/quoteUsd,effB=dQ*FEE,outB=(tok*effB)/(q+effB),
          dT=u/px,effT=dT*TS*FEE,outS=(q*effT)/(tok+effT);
    return{usd:u,
      buyMove:(((q+dQ)/(tok-outB))/(q/tok)-1)*100,
      buyCost:(1-TB*FEE*q/(q+effB))*100,
      sellMove:(((q-outS)/(tok+dT*TS))/(q/tok)-1)*100,
      sellCost:(1-TS*FEE*tok/(tok+effT))*100};
  });
}
// (r + x)(r + FEE*x) = k*r^2  ->  FEE*x^2 + r(1+FEE)x + r^2(1-k) = 0
export function onePctV2(r,fee,k){const FEE=1-fee,b=1+FEE;
  return r*((-b+Math.sqrt(b*b+4*FEE*(k-1)))/(2*FEE))}

// === V3 MATH ===
// Concentrated liquidity has no closed form: impact depends on where the
// liquidity is parked around the current price, not on two reserves. Rather than
// approximate it, the pool's own quoter is asked — one eth_call per size,
// returning the exact fill and the exact price afterwards, ticks crossed and
// all. That is not an estimate of the trade; it is the trade, simulated.
const Q96=2n**96n;
export function sqrtToPrice(sqrt,decIn,decOut){
  const s=Number(sqrt)/Number(Q96);
  return s*s*Math.pow(10,decIn-decOut);
}
// The baseline comes from a DUST QUOTE in the same batch, never from a separate
// slot0 read. On a deep, busy pool the price moves more between two round trips
// than a $2,500 trade moves it: $BTCB's buy impact came out NEGATIVE across
// every rung, because what was being measured was one second of real trading,
// not the trade. Quoting a near-zero amount alongside the real ones gives a
// "before" from the same block state, so the difference is the trade and
// nothing else.
export async function ladderV3(pool,token,quote,feeRaw,tokDec,px,quoteUsd,taxB,taxS,sqrtBefore,tokenIs0){
  // The sell side is quoted with the amount that SURVIVES the transfer tax,
  // because that is all the pool ever sees. Quoting the gross amount and
  // scaling the answer afterwards would be an approximation where an exact
  // figure was available for the same single call.
  const amtsBuy=STEPS.map(u=>BigInt(Math.floor(u/quoteUsd*1e18))),
        amtsSell=STEPS.map(u=>BigInt(Math.floor(u/px*(1-taxS)*Math.pow(10,tokDec))));
  const dust=BigInt(Math.max(1,Math.floor(1/quoteUsd*1e18)));   // ~$1 of the quote token
  const calls=[call(QUOTER,quoteCall(quote,token,dust,feeRaw)),
               ...amtsBuy.map(a=>call(QUOTER,quoteCall(quote,token,a,feeRaw))),
               ...amtsSell.map(a=>call(QUOTER,quoteCall(token,quote,a,feeRaw)))];
  const all=await rpcBatch(calls);
  const baseHex=all[0],r=all.slice(1);
  const before=(baseHex&&baseHex.length>=130)
    ? Number(BigInt('0x'+baseHex.slice(66,130)))   // same block state as the rungs
    : Number(sqrtBefore);
  // A rung the pool cannot fill. When a size takes more than the pool holds
  // in range, the quoter walks to the end of the liquidity and reports the
  // price at the limit — sqrtPriceX96After lands on MIN/MAX_SQRT_RATIO and
  // squaring that printed "+5.33e+41%" for KII (1% tier, $750 in range),
  // with "you pay 47.76%" for a fill that never happened. Such a rung says
  // "the pool runs out at this size", not a number.
  const MIN_SQRT=4295128739,MAX_SQRT=1.4614467034852101e48;
  const dry=h=>{
    if(!h||h.length<130)return false;
    const after=Number(BigInt('0x'+h.slice(66,130)));
    return !(after>0)||after<=MIN_SQRT*1.0001||after>=MAX_SQRT*0.9999;
  };
  const move=h=>{
    if(!h||h.length<130||dry(h))return null;
    const after=Number(BigInt('0x'+h.slice(66,130)));
    if(!(after>0)||!(before>0))return null;
    const ratio=Math.pow(after/before,2);      // price of token0 in token1
    const m=((tokenIs0?ratio:1/ratio)-1)*100;   // ...expressed for OUR token
    return Math.abs(m)>1000?null:m;            // beyond ten-fold is the limit too
  };
  const out=h=>h&&h.length>=66?Number(BigInt('0x'+h.slice(2,66))):null;
  // SPOT, from the same block state as the rungs — for the same reason the
  // impact baseline is taken from the dust quote and not from slot0. Cost is a
  // comparison against spot, and slot0 was read one round trip earlier: on a
  // busy pool the price drifts more in that second than a $100 trade moves it,
  // which produced a NEGATIVE cost ("you pay −0.06%", i.e. the pool pays you)
  // on $BLUAI and $DOS. The dust quote already has the pool fee taken out of
  // its input, so the fee is added back to recover the mid price — otherwise
  // the fee would quietly vanish from the cost it is part of.
  const dustOut=out(baseHex),feeFrac=feeRaw/1e6;
  const pxLive=(dustOut>0)
    ? (Number(dust)/1e18)*(1-feeFrac)/(dustOut/Math.pow(10,tokDec))*quoteUsd
    : px;
  const spot=pxLive>0?pxLive:px;
  return STEPS.map((u,i)=>{
    const b=r[i],s=r[STEPS.length+i];
    const outTok=out(b),outQ=out(s);
    // Buy: quote in, tokens out, then the transfer tax is taken off the top.
    const gotTok=outTok!=null?outTok/Math.pow(10,tokDec)*(1-taxB):null;
    const paidQ=u/quoteUsd;
    // Sell: the pair only ever sees the taxed amount, so the tax is applied to
    // the input before the quote, exactly as the chain does it. What the trader
    // gives up is the GROSS amount, valued at spot.
    const gotQ=outQ!=null?outQ/1e18:null;
    const survS=(1-taxS)>0?(1-taxS):1;
    const sentTok=Number(amtsSell[i])/Math.pow(10,tokDec)/survS;
    const RUNS_OUT='the pool runs out at this size';
    const bDry=dry(b)||(b&&b.length>=130&&move(b)==null&&outTok!=null),
          sDry=dry(s)||(s&&s.length>=130&&move(s)==null&&outQ!=null);
    return {usd:u,
      buyMove:bDry?null:move(b),
      buyCost:(!bDry&&gotTok!=null)?(1-(gotTok*spot)/(paidQ*quoteUsd))*100:null,
      buyNote:bDry?RUNS_OUT:null,
      sellMove:(!sDry&&move(s)!=null)?-Math.abs(move(s)):null,
      sellCost:(!sDry&&gotQ!=null&&sentTok>0)?(1-(gotQ*quoteUsd)/(sentTok*spot))*100:null,
      sellNote:sDry?RUNS_OUT:null};
  });
}
// The ladder's six fixed sizes cannot express depth for a pool that is far
// deeper or far thinner than they assume, so the quoter is swept geometrically
// and the crossing of 1% is read off the curve. Interpolated in log space
// because impact against size is very close to a straight line there.
export async function onePctV3(pool,token,quote,feeRaw,tokDec,px,quoteUsd,sqrtBefore,tokenIs0,taxS=0){
  // $20 to $976M. The old sweep stopped at $1.3M and simply gave up on anything
  // deeper: USDC/USDT at the 0.01% tier does not move one percent for any figure
  // in that range, so both fields printed "—" for a pool holding $27M — read as
  // "could not measure" when the truth was "more than we asked". Twelve probes
  // is also exactly the batch ceiling once the dust quote and both directions
  // are counted (1 + 12 + 12 = 25).
  const probes=Array.from({length:12},(_,i)=>20*Math.pow(5,i));
  const dust=BigInt(Math.max(1,Math.floor(1/quoteUsd*1e18)));
  // The sell probes are quoted with what SURVIVES the transfer tax, because that
  // is all the pool ever sees — the same correction the V2 path applies when it
  // divides by (1-taxS). Without it a 5%-tax token's "moves the price −1%" was
  // the size that reaches the pool, not the size the seller has to send.
  const surv=1-(taxS||0);
  const calls=[call(QUOTER,quoteCall(quote,token,dust,feeRaw)),
               ...probes.map(u=>call(QUOTER,quoteCall(quote,token,BigInt(Math.floor(u/quoteUsd*1e18)),feeRaw))),
               ...probes.map(u=>call(QUOTER,quoteCall(token,quote,BigInt(Math.floor(u/px*surv*Math.pow(10,tokDec))),feeRaw)))];
  const all=await rpcBatch(calls);
  const baseHex=all[0],r=all.slice(1);
  const before=(baseHex&&baseHex.length>=130)?Number(BigInt('0x'+baseHex.slice(66,130))):Number(sqrtBefore);
  const mv=h=>{if(!h||h.length<130)return null;
    const after=Number(BigInt('0x'+h.slice(66,130)));
    if(!(after>0)||!(before>0))return null;
    const ratio=Math.pow(after/before,2);
    return Math.abs((tokenIs0?ratio:1/ratio)-1)*100};
  // Three outcomes, and they must not be flattened into one. A crossing found is
  // a figure. No crossing because every probe that the pool could quote stayed
  // under 1% is a LOWER BOUND, not an unknown — "more than $1.6M" is a real
  // answer and printing "—" for it understates a deep pool. Nothing quotable at
  // all is the only genuine unknown.
  const cross=off=>{
    const pts=probes.map((u,i)=>({u,m:mv(r[off+i])})).filter(p=>p.m!=null&&p.m>0);
    if(!pts.length)return {v:null,min:null};
    for(let i=1;i<pts.length;i++){
      if(pts[i].m>=1&&pts[i-1].m<1){
        const a=pts[i-1],b=pts[i],t=(Math.log(1)-Math.log(a.m))/(Math.log(b.m)-Math.log(a.m));
        return {v:Math.exp(Math.log(a.u)+t*(Math.log(b.u)-Math.log(a.u))),min:null};
      }
    }
    const last=pts[pts.length-1];
    // Below 1% at the largest size the pool would quote: a floor. Above 1% at
    // the smallest: too thin for this ladder to bracket, so no claim.
    return {v:null,min:last.m<1?last.u:null};
  };
  // Both figures are already GROSS: the probe list is denominated in what the
  // trader sends, and the tax was taken off inside the quoted amount, so there
  // is nothing left to scale here.
  const u=cross(0),d=cross(probes.length);
  return {up:u.v,down:d.v,upMin:u.min,downMin:d.min};
}

// === WHERE ELSE DOES IT TRADE? ===
// This decides whether the pool we can measure is worth measuring at all, so it
// cannot depend on a source that only knows the venues it happens to index.
// GoPlus used to fill this role and does not know fstswap: a token with $107k
// there showed up here as a $15 PancakeSwap dust pool with "+20,456% impact"
// and no warning, because from GoPlus's side there was nothing to compare
// against. DexScreener indexes the small venues, returns one consistent USD
// figure per pool, and sends CORS: * — so the comparison is like for like and
// the guard no longer depends on somebody else's coverage.
export async function venues(token){
  try{
    const r=await fetch('https://api.dexscreener.com/latest/dex/tokens/'+token,
      {signal:AbortSignal.timeout(9000)});
    if(!r.ok)return null;
    const j=await r.json();
    const list=(j.pairs||[]).filter(p=>p.chainId==='bsc'&&p.liquidity)
      .map(p=>({pair:(p.pairAddress||'').toLowerCase(),
        name:(p.dexId||'?')+' '+((p.labels||[]).join('')||'v2'),
        quote:p.quoteToken&&p.quoteToken.symbol||'',
        liq:Math.round(p.liquidity.usd||0)}))
      .sort((a,b)=>b.liq-a.liq);
    return list.length?list:null;
  }catch(e){return null}
}

// === THE TAX, MEASURED ===
// Not read off a label — read off trades that actually happened. The pair says
// how many tokens it moved; the token's own Transfer events in the same
// transaction say how many arrived. The gap is what was charged, to the wallet
// that paid it. On a taxed buy the pool emits two transfers, one to the tax sink
// and one to the buyer; the buyer's is the larger, and the difference is the tax.
export const SWAP_T='0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
      // Concentrated liquidity emits a DIFFERENT Swap event, and asking for the
      // V2 one over a V3 pool returns an empty list — which this page then
      // printed as "this pool has not traded in the last two hours" for pools
      // trading every block. Every V3 token silently fell back to the GoPlus
      // label, which is the one thing the tax card exists not to do.
      // And PancakeSwap's V3 Swap is NOT Uniswap's: it carries two extra
      // protocol-fee words, so it hashes to a different topic. Taken off a live
      // pool's own logs rather than from a docs page — asking for Uniswap's
      // topic returned zero swaps on USDC/USDT, a pool that trades every block.
      // Both are accepted; only the first is ever seen at this venue.
      SWAP_V3_T='0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83',
      SWAP_V3_UNI='0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
      XFER_T='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// V3 states the two amounts as SIGNED integers from the pool's point of view:
// positive went in, negative came out. V2 states four unsigned ones instead.
const TWO256=1n<<256n,TWO255=1n<<255n;
export const int256=h=>{const v=BigInt('0x'+h);return v>=TWO255?v-TWO256:v};
// How long the readable window actually is, in the reader's units. BSC's block
// time is not a constant — it was 3s, then 1.5s, then 0.75s — so "5,000 blocks
// is about two hours" was true when it was written and is wrong now. Asked of
// the chain instead of assumed.
async function windowSpan(from,to){
  try{
    const [a,b]=await Promise.all([
      rpc('eth_getBlockByNumber',['0x'+from.toString(16),false],LOGS_RPC),
      rpc('eth_getBlockByNumber',['0x'+to.toString(16),false],LOGS_RPC)]);
    const s=parseInt(b.timestamp,16)-parseInt(a.timestamp,16);
    if(!(s>0))return null;
    return s<5400?Math.round(s/60)+' minutes':(s/3600).toFixed(1).replace(/\.0$/,'')+' hours';
  }catch(e){return null}
}
export async function measureTax(token,pair,tokenIs0,kind){
  try{
    const head=parseInt(await rpc('eth_blockNumber',[],LOGS_RPC),16);
    // One window, and only one: the hour WINDOW_BLOCKS names (7,900 blocks,
    // 59 min — the endpoint answers that in one call and refuses only beyond
    // ~12,000 as "archive"). Until 2026-09-12 this read 4,999 blocks (38 min)
    // while every other reading on the page said "the last hour", and a thin
    // pool was simulated where an hour of trades would have measured it.
    const topic=kind==='v3'?[[SWAP_V3_T,SWAP_V3_UNI]]:[SWAP_T];
    // THE NEWEST TRADES FIRST, THE HOUR ONLY WHEN THEY ARE NOT ENOUGH
    // (2026-09-21). This read the whole hour and then used its newest sixteen
    // receipts. On the pools traded most that hour is more than the endpoint
    // returns at all — "query exceeds max results 20000", a fixed limit, not
    // throttling — and the same filter was sent four times and the whole read
    // repeated by the caller: AKE, 23,000 swaps an hour, came back after 16 s
    // with a GoPlus label where the measurement belongs. The last few minutes
    // of such a pool hold hundreds of swaps and answer in 60 ms. So: the short
    // window first; the hour only when it did not yield three buys and three
    // sells; and when the hour is refused for its size, a quarter of it.
    // Both log hosts, and a second pass after a beat, as before: the two
    // publicnode names throttle together, and a page that has just fired a
    // thirty-call batch gets a 403 for a second or two (2026-09-03). A refusal
    // for SIZE is not retried — the same range has the same size.
    let tooLarge=false;
    const fetchWindow=async blocks=>{
      const filter={address:pair,topics:topic,fromBlock:'0x'+(head-(blocks-1)).toString(16),toBlock:'0x'+head.toString(16)};
      for(let pass=0;pass<2;pass++){
        if(pass)await new Promise(r=>setTimeout(r,900));
        for(const url of LOGS_RPCS){
          try{const l=await rpc('eth_getLogs',[filter],url);if(l)return l}
          catch(e){if(/max results|exceeds|too (large|many)|limit/i.test(String(e&&e.message))){tooLarge=true;return null}}
        }
      }
      return null;
    };
    const U=h=>BigInt('0x'+h);
    const buys=[],sells=[];const seen=new Set();
    // Receipts are one round trip each, and a busy pool can offer thousands of
    // swaps. Sixteen is enough to find three of each on any pool with two-sided
    // flow, and bounds the wait when a pool is all arb and nothing qualifies.
    let tried=0;
    const enough=()=>(buys.length>=3&&sells.length>=3)||tried>=16;
    const take=async logs=>{
    for(const L of logs.slice().reverse()){
      if(buys.length>=3&&sells.length>=3)break;
      if(tried>=16)break;
      if(seen.has(L.transactionHash))continue;seen.add(L.transactionHash);
      const d=L.data.slice(2);
      let tokOut,tokIn;
      if(kind==='v3'){
        const a=int256(d.slice(0,64)),b=int256(d.slice(64,128)),mine=tokenIs0?a:b;
        tokOut=mine<0n?-mine:0n;tokIn=mine>0n?mine:0n;
      }else{
        const a0i=U(d.slice(0,64)),a1i=U(d.slice(64,128)),a0o=U(d.slice(128,192)),a1o=U(d.slice(192,256));
        tokOut=tokenIs0?a0o:a1o;tokIn=tokenIs0?a0i:a1i;
      }
      if(!(tokOut>0n)&&!(tokIn>0n))continue;
      if(tokOut>0n&&buys.length>=3)continue;
      if(tokIn>0n&&sells.length>=3)continue;
      // Receipts come from the main node, not the log node: the log endpoint
      // serves ranges but returns nothing useful for receipts, which cost an
      // earlier build every single tax measurement while looking like success.
      tried++;
      let rec;try{rec=await rpc('eth_getTransactionReceipt',[L.transactionHash])}catch(e){continue}
      if(!rec||!rec.logs)continue;
      // Which contracts in this transaction are POOLS. It matters because the
      // sell side works out the tax by comparing what the pair received against
      // the other token transfers the seller made — exact for a plain sell, and
      // nonsense for an arbitrage bot routing the same token through two pools,
      // where the second leg gets counted as if it were a fee. That is where a
      // 30.63% sell tax on $CAKE came from, a token with no tax at all. Anything
      // sent to another pool is a leg, not a fee, and is excluded by name.
      const isSwap=x=>x.topics[0]===SWAP_T||x.topics[0]===SWAP_V3_T||x.topics[0]===SWAP_V3_UNI;
      const pools=new Set(rec.logs.filter(isSwap).map(x=>x.address.toLowerCase()));
      // Our own pair swapped twice in one transaction cannot be matched to one
      // Swap event, so that transaction is skipped rather than misread.
      if(rec.logs.filter(x=>isSwap(x)&&x.address.toLowerCase()===pair).length!==1)continue;
      const xf=rec.logs.filter(x=>x.address.toLowerCase()===token&&x.topics[0]===XFER_T&&x.topics.length>=3)
        .map(x=>({from:'0x'+x.topics[1].slice(26),to:'0x'+x.topics[2].slice(26),v:U(x.data.slice(2)),
          i:parseInt(x.logIndex,16)}));
      if(!xf.length)continue;
      // A ratio outside [0, 1) is not a tax reading, it is a transfer this code
      // has mismatched — a rebasing token, a router that batches two swaps into
      // one receipt, a fee taken in a different token. Dropping it is right;
      // averaging it in would put a negative or a 300% tax on the page.
      const keep=(a,v)=>{if(isFinite(v)&&v>=-0.0001&&v<0.99)a.push(Math.max(0,v))};
      if(tokOut>0n){
        const outs=xf.filter(x=>x.from===pair);
        if(outs.length){const got=outs.reduce((m,x)=>x.v>m?x.v:m,0n);
          keep(buys,1-Number(got)/Number(tokOut))}
      }else{
        const inn=xf.find(x=>x.to===pair);
        // A taxed sell emits its fee leg RIGHT NEXT to the transfer that funds
        // the swap — same call, adjacent log indices. Anything the same wallet
        // sends elsewhere in a long routed transaction is a different trade, not
        // a fee, and summing it in is what produced a 30% sell tax for $CAKE.
        // Two filters, because either alone leaves a hole: not to another pool,
        // and not four logs away from the transfer it is supposed to belong to.
        if(inn){const total=xf.filter(x=>x.from===inn.from&&Math.abs(x.i-inn.i)<=3&&
            (x.to===pair||!pools.has(x.to)))
          .reduce((s,x)=>s+x.v,0n);
          // Above 50% this is not a tax reading, it is a mismatch. Real taxes
          // that high exist, but they cannot be told apart from a bad match, and
          // guessing wrong here is worse than saying nothing.
          if(total>0n){const t=1-Number(inn.v)/Number(total);if(t<0.5)keep(sells,t)}}
      }
    }
    };
    let windowBlocks=0,sawLogs=false;
    const steps=[TAX_SHORT_BLOCKS,WINDOW_BLOCKS];
    for(let si=0;si<steps.length&&!enough();si++){
      const logs=await fetchWindow(steps[si]);
      if(logs===null){
        if(steps[si]===WINDOW_BLOCKS&&tooLarge)steps.push(TAX_MID_BLOCKS);
        continue;
      }
      windowBlocks=Math.max(windowBlocks,steps[si]);
      if(logs.length)sawLogs=true;
      await take(logs);
    }
    // A refused range and a quiet pool arrive as the same emptiness and mean
    // opposite things. Only one of them may be stated as a fact about somebody
    // else's pool — and a quiet pool only for the window that really answered.
    if(!windowBlocks)return {ok:false,reason:'the log endpoint refused the range',block:head,windowBlocks:WINDOW_BLOCKS};
    if(!sawLogs){
      const span=await windowSpan(head-(windowBlocks-1),head);
      return {ok:false,reason:'this pool has not traded in the last '+(span||'~'+windowBlocks.toLocaleString('en-US')+' blocks'),block:head,windowBlocks};
    }
    // Exempt wallets exist — the deployer, the tax sink, routers on an allow
    // list — and they trade at 0%. Taking the median rather than the mean keeps
    // one exempt trade from dragging the figure below what a normal wallet pays.
    const med=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);
      return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2};
    const b=med(buys),s=med(sells);
    if(b==null&&s==null)return {ok:false,reason:'no readable transfers in recent trades',block:head,windowBlocks};
    return {ok:true,buy:b,sell:s,nBuy:buys.length,nSell:sells.length,block:head,windowBlocks,
      spread:{buy:buys.map(x=>+(x*100).toFixed(2)),sell:sells.map(x=>+(x*100).toFixed(2))}};
  }catch(e){return {ok:false,reason:'the log endpoint did not answer'}}
}


// === MANY READS, ONE REQUEST ===
//
// Reading a V3 pool's tick book is hundreds of eth_calls, and a JSON-RPC batch
// carries at most about 25 of them before this endpoint refuses the request. On
// the Workers free plan a single incoming request may make 50 outgoing ones, so
// the tick walk alone would spend a third of that budget and a busy pair with
// one extra price hop would fall off the edge — as "too many subrequests",
// which arrives as a failed scan rather than a slow one.
//
// Multicall3 is deployed on BNB Chain at the same address it uses everywhere,
// and it turns any number of view calls into ONE. Measured 2026-09-01: 400
// ticks() reads returned in 210 ms in a single call, byte for byte identical to
// the same 400 asked one at a time.
//
// It is a fast path, not a dependency. If the aggregate call fails for any
// reason the plain batch runs instead and the answer is the same, only slower —
// a helper contract must never be the reason a measurement cannot be made.
export const MULTICALL3='0xca11bde05977b3631167028862be2a173976ca11';
const w256=v=>BigInt(v).toString(16).padStart(64,'0');
const MC_CHUNK=500;

const encodeAggregate3=calls=>{
  const structs=calls.map(c=>{
    const d=c.data.slice(2),pad=d+'0'.repeat((64-(d.length%64))%64);
    // (address target, bool allowFailure, bytes callData) — allowFailure is on,
    // so one reverting call cannot take the other four hundred with it.
    return '0'.repeat(24)+c.to.slice(2).toLowerCase()+w256(0)+w256(0x60)+w256(d.length/2)+pad;
  });
  let off=32*calls.length,offs='';
  for(const s of structs){offs+=w256(off);off+=s.length/2}
  return '0x82ad56cb'+w256(0x20)+w256(calls.length)+offs+structs.join('');
};

// Every offset below is a BYTE offset into the returned data, which is how the
// ABI states them. Reading one of them as a word index instead is not a crash:
// it lands on a different word that also parses as a number, and the decode
// then fails somewhere further along. The first port of this did exactly that,
// and the only symptom was that the fast path silently stopped being taken —
// the answers stayed right and the request count went UP by one.
const decodeAggregate3=(hex,n)=>{
  const b=hex.slice(2),at=o=>b.slice(o*2,o*2+64);
  const arr=Number(BigInt('0x'+at(0)));
  const len=Number(BigInt('0x'+at(arr)));
  if(len!==n)throw new Error('multicall returned '+len+' of '+n);
  const head=arr+32,out=[];
  for(let i=0;i<len;i++){
    const o=head+Number(BigInt('0x'+at(head+i*32)));
    const ok=BigInt('0x'+at(o))===1n;
    // Offsets inside the tuple are relative to the tuple's own start, not to
    // the word that carries them.
    const dOff=o+Number(BigInt('0x'+at(o+32)));
    const bytes=Number(BigInt('0x'+at(dOff)));
    out.push(ok?'0x'+b.slice((dOff+32)*2,(dOff+32)*2+bytes*2):null);
  }
  return out;
};

// `block` pins every call to one block instead of to whatever "latest" means at
// the moment each request lands. That is not a refinement, it is the difference
// between a consistent reading and a stitched one: read as a plain batch, a
// pool's tick book arrives over about two seconds of a chain that produces a
// block every 0.45, so the far end of the book is a different pool state from
// the near end. Measured on WBNB/USDT: stitched, the walk disagreed with the
// pool's own quoter by 0.002%; from one block, by nothing at all.
export async function multicall(calls,url,block='latest'){
  if(!calls.length)return [];
  try{
    const out=[];
    for(let i=0;i<calls.length;i+=MC_CHUNK){
      const part=calls.slice(i,i+MC_CHUNK);
      const r=await rpc('eth_call',[{to:MULTICALL3,data:encodeAggregate3(part)},block],url);
      if(!r||r==='0x')throw new Error('empty aggregate');
      out.push(...decodeAggregate3(r,part.length));
    }
    return out;
  }catch(e){
    // Same answer, more requests. Worth a line in the log rather than a silent
    // difference in cost between two runs of the same scan.
    return rpcBatch(calls,url,block);
  }
}

// HOW LONG THE WINDOW REALLY WAS, in minutes, asked of the chain.
//
// BSC's block time is not a constant — it was 3s, then 1.5s, then 0.45 — so a
// window derived from an assumed block time is wrong the moment the chain
// changes and nothing says so. It is asked instead.
//
// Both endpoints, and a retry, because the first version used one and had no
// second chance: on 2026-09-01 a single refused read made the whole answer come
// back with `minutes: null`, and the rule this project actually cares about is
// that the window travels with the figure. Losing the window to one flaky read
// turns a good measurement into one that must not be quoted.
export async function windowMinutes(from, to) {
  // Two rounds over the endpoints: the block reads share the log endpoint's
  // quota, and one refusal in a busy minute left the window "null min" on the
  // health check while the tiers themselves had been read.
  const tries = [...LOGS_RPCS, ...LOGS_RPCS];
  for (let i = 0; i < tries.length; i++) {
    const url = tries[i];
    if (i === LOGS_RPCS.length) await new Promise((r) => setTimeout(r, 200));
    try {
      const [a, b] = await Promise.all([
        rpc('eth_getBlockByNumber', ['0x' + from.toString(16), false], url),
        rpc('eth_getBlockByNumber', ['0x' + to.toString(16), false], url),
      ]);
      const s = parseInt(b.timestamp, 16) - parseInt(a.timestamp, 16);
      if (s > 0) return s / 60;
    } catch { /* try the other one */ }
  }
  return null;
}

// eth_getLogs over a range, and when the endpoint refuses it, over its two
// halves, then their halves (three levels: eight slices at most). The busiest
// pools — CAKE/BNB at 0.05% and 0.25% — came back "refused" in 3 of 3 runs
// over 5,000 blocks from the Worker's shared egress while the same range
// answered from a laptop; smaller answers pass where the big one does not.
// The sample stays the same window, just read in pieces. null = refused.
export async function getLogsSplit(params, from, to, url, depth = 0) {
  try {
    return await rpc('eth_getLogs', [{ ...params, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }], url);
  } catch {
    if (depth >= 3 || to - from < 64) return null;
    const mid = from + Math.floor((to - from) / 2);
    const a = await getLogsSplit(params, from, mid, url, depth + 1);
    if (a === null) return null;
    const b = await getLogsSplit(params, mid + 1, to, url, depth + 1);
    if (b === null) return null;
    return a.concat(b);
  }
}

// === WHERE THE CAPITAL ACTUALLY SITS ===
//
// Every figure this project publishes about a V3 pool has so far divided by
// what the pool CONTRACT HOLDS, and said so in a caveat: "in V3 that includes
// liquidity sitting outside the current price range, which earns nothing."
// A caveat is a promise to measure something later. This is later.
//
// A liquidity provider is not paid for holding tokens. They are paid for the
// liquidity standing where the price is when a swap goes through, in proportion
// to their share of it. Capital parked two hundred percent away is on the
// books, in the balance, in every chart of "TVL" — and earns nothing. So the
// denominator an LP needs is not the pool's balance but the capital standing in
// the band the price is actually in.
//
// This reconstructs that from the pool's own tick data: the active liquidity at
// the current price, then every initialised tick inside the band with the net
// liquidity it adds or removes, walked outward in both directions. Each
// resulting segment is converted to token amounts with the standard
// concentrated-liquidity identities, so what comes back is not an index or a
// score. It is an amount of each token, in the band, and it can be checked — it
// can never exceed what the contract holds.
//
// V2 is measured the same way rather than exempted. A constant-product pool is
// a full-range position with L = sqrt(x*y), so the same band question has the
// same kind of answer — and that is the comparison that matters, because a V2
// pool holding forty million dollars may stand less capital at the price than a
// V3 pool holding two.
const TICK_BASE=1.0001;
// sqrt(1.0001^t), the pool's sqrtPrice at a tick, in raw token units. Number
// rather than the Q96 integer: every use below is a difference of two nearby
// roots multiplied by a liquidity, and doubles carry that to about twelve
// significant figures, which is nine more than any dollar figure here needs.
const sqrtAtTick=t=>Math.pow(TICK_BASE,t/2);
const fdiv=(a,b)=>Math.floor(a/b);
// int24 and int16 arguments are two's complement, sign-extended to a full word.
const iword=v=>{const b=BigInt(v);return ((b<0n?(1n<<256n)+b:b).toString(16)).padStart(64,'0')};
const TICKS_SEL='0xf30dba93',BITMAP_SEL='0x5339c296',
      LIQUIDITY_SEL='0x1a686502',SPACING_SEL='0xd0c93a7c';
const int128At=w=>{const v=BigInt('0x'+w);return v>=TWO255?v-TWO256:v};
// slot0 answers sqrtPriceX96 in word 0 and the current tick, signed, in word 1.
const int24At=w=>{const v=BigInt('0x'+w);return Number(v>=TWO255?v-TWO256:v)};

// The amounts one liquidity segment holds between two roots, given where the
// price stands. Above the price a segment is entirely token0, below it entirely
// token1, and the segment containing the price holds both — which is why both
// walks below start at the price itself rather than at a tick boundary.
export function segAmounts(L,sLo,sHi,sP){
  if(!(L>0)||!(sHi>sLo))return [0,0];
  if(sHi<=sP)return [0,L*(sHi-sLo)];
  if(sLo>=sP)return [L*(1/sLo-1/sHi),0];
  return [L*(1/sP-1/sHi),L*(sP-sLo)];
}

// A constant-product pool as the full-range position it is. No RPC: by the time
// this is worth asking, the reserves are already known.
export function bandDepthV2(r0,r1,bandPct){
  if(!(r0>0)||!(r1>0))return null;
  const L=Math.sqrt(r0*r1),sP=Math.sqrt(r1/r0),k=Math.sqrt(1+bandPct/100);
  const [a0,a1]=segAmounts(L,sP/k,sP*k,sP);
  return {amount0:a0,amount1:a1,complete:true,initialized_ticks:null};
}

// The same question asked of concentrated liquidity, which has to be walked.
//
// Three rounds for ALL pools at once rather than three rounds per pool: state,
// then bitmap words, then the initialised ticks those words point at. These
// endpoints rate-limit per request, and five tiers asked one after another is
// exactly the pattern that came back half-unreadable before.
// The cap is 400 because that is enough to never bite at the band this is used
// with: two percent is 198 ticks either side, and the finest spacing PancakeSwap
// runs is one, so 397 is the most a complete answer can ever need. It was 192
// first, and WBNB/USDT at the 0.01% tier came back truncated — understated by a
// quarter, flagged, but still a smaller number that looked like a real one.
// WHAT REACHES LIQUIDITY. slot0's sixth word is the protocol's cut of every
// swap fee: PancakeSwap packs two 16-bit shares in 1/10000 (token0 low, token1
// high — 3400 on CAKE/BNB 0.05%, i.e. 34% to the protocol); a Uniswap-style
// pool packs two 4-bit divisors (fee/x) in one byte. Told apart by size.
// Returns the share of a swap fee that liquidity providers receive, the mean
// of the two directions (they are equal on every pool read so far). Pure.
export const V2_LP_SHARE=0.17/0.25;   // PancakeSwap V2: 0.17 of the 0.25% goes to the pair
export function lpShareFromSlot0(slot0){
  if(!slot0||slot0.length<2+64*6)return null;
  const fp=Number(BigInt('0x'+slot0.slice(2+64*5,2+64*6)));
  const cut=fp>255?[(fp&0xffff)/1e4,(fp>>>16)/1e4]:[(fp&0xf)?1/(fp&0xf):0,(fp>>>4)?1/(fp>>>4):0];
  const lp=cut.map(x=>(x>=0&&x<1?1-x:1));
  return (lp[0]+lp[1])/2;
}
export async function bandDepthV3(pools,bandPct,maxTicks=400){
  if(!pools.length)return [];
  // ONE BLOCK FOR ALL THREE ROUNDS.
  //
  // The price, the active liquidity and every tick have to come from the same
  // state or they describe a pool that never existed: the price from one block
  // and the book from the next is a book with a hole in it. Multicall3 answers
  // its own block number in the same call that reads the state, so pinning the
  // two later rounds to it costs nothing — no extra request, no guess about
  // which block "latest" meant a moment ago.
  const stCalls=[call(MULTICALL3,'0x42cbb15c'),   // getBlockNumber()
    ...pools.flatMap(p=>[call(p,S.slot0),call(p,LIQUIDITY_SEL),call(p,SPACING_SEL)])];
  const st0=await multicall(stCalls);
  const blk=st0[0]&&st0[0]!=='0x'?'0x'+BigInt(st0[0]).toString(16):'latest';
  const st=st0.slice(1);
  const base=pools.map((p,i)=>{
    const s=st[i*3];
    if(!s||s.length<130)return null;
    const sqrtP=Number(BigInt('0x'+s.slice(2,66)))/Number(Q96);
    const tick=int24At(s.slice(66,130));
    const L=Number(hx(st[i*3+1]));
    const spacing=Number(hx(st[i*3+2]))||1;
    if(!(sqrtP>0))return null;
    // The band is set in price, not in ticks, so its edges are exact instead of
    // rounded to a spacing that differs per tier. The tick bounds only decide
    // which ticks have to be read.
    const k=Math.sqrt(1+bandPct/100);
    const span=Math.ceil(Math.log(1+bandPct/100)/Math.log(TICK_BASE));
    return {pool:p,sqrtP,tick,L,spacing,lpShare:lpShareFromSlot0(s),
      sLo:sqrtP/k,sHi:sqrtP*k,tLo:tick-span,tHi:tick+span};
  });

  // Which bitmap words cover the band. Ticks are stored compressed by spacing
  // and packed 256 to a word, so a wide-spacing tier is one word and a
  // spacing-of-one tier at two percent is two or three.
  const wordCalls=[],wordOwner=[];
  base.forEach((b,i)=>{
    if(!b)return;
    const cLo=fdiv(b.tLo,b.spacing),cHi=fdiv(b.tHi,b.spacing);
    for(let w=fdiv(cLo,256);w<=fdiv(cHi,256);w++){
      wordCalls.push(call(b.pool,BITMAP_SEL+iword(w)));wordOwner.push([i,w]);
    }
  });
  const words=wordCalls.length?await multicall(wordCalls,undefined,blk):[];

  const want=base.map(()=>[]);
  words.forEach((w,n)=>{
    const [i,word]=wordOwner[n],b=base[i];
    if(!w||w==='0x')return;
    const bits=BigInt(w);
    for(let bit=0;bit<256;bit++){
      if((bits>>BigInt(bit))&1n){
        const t=(word*256+bit)*b.spacing;
        if(t>=b.tLo&&t<=b.tHi)want[i].push(t);
      }
    }
  });

  // A cap, and it is reported rather than silently applied. A spacing-of-one
  // tier on a busy pair can carry several hundred initialised ticks inside two
  // percent, and reading all of them costs more round trips than the answer is
  // worth — but a figure computed over a truncated tick set is a smaller number
  // that looks like a real one, so it says which one it is.
  const truncated=base.map(()=>false);
  want.forEach((list,i)=>{
    if(!base[i])return;
    list.sort((a,b)=>a-b);
    if(list.length>maxTicks){
      // Keep the ticks NEAREST the price: they carry the liquidity a swap meets
      // first, so dropping the far edge understates the band by the least.
      const c=base[i].tick;
      want[i]=list.slice().sort((a,b)=>Math.abs(a-c)-Math.abs(b-c))
        .slice(0,maxTicks).sort((a,b)=>a-b);
      truncated[i]=true;
    }
  });

  const tickCalls=[],tickOwner=[];
  want.forEach((list,i)=>list.forEach(t=>{
    tickCalls.push(call(base[i].pool,TICKS_SEL+iword(t)));tickOwner.push([i,t]);
  }));
  // The one round that is worth aggregating. State and bitmap words are a
  // dozen calls between them and fit in a single batch already; the ticks are
  // hundreds, and asked as a plain batch they cost sixteen of the fifty
  // outgoing requests a Worker gets. Through Multicall3 they cost one.
  const tickRes=tickCalls.length?await multicall(tickCalls,undefined,blk):[];
  const nets=base.map(()=>new Map());
  tickRes.forEach((r,n)=>{
    const [i,t]=tickOwner[n];
    if(r&&r.length>=130)nets[i].set(t,int128At(r.slice(66,130)));
  });

  return base.map((b,i)=>{
    if(!b)return null;
    const net=nets[i],inBand=want[i];
    let a0=0,a1=0,inUp=0,inDown=0;
    // Upward from the price. Crossing an initialised tick from below adds its
    // net liquidity; the first segment starts at the price, because the tick
    // the price sits in is only partly above it.
    //
    // The same walk answers a second question for free, and it is the one that
    // makes this checkable: the token1 a buyer would have to put in to drag the
    // price to the upper edge is the y-side of exactly these segments. That
    // number can be handed to the pool's own quoter, and the quoter's answer
    // has to come back as the token0 counted here. Nothing else in this file
    // has an independent oracle; this does.
    let L=b.L,cur=b.sqrtP;
    for(const t of inBand.filter(t=>t>b.tick)){
      const s=Math.min(sqrtAtTick(t),b.sHi);
      const [x,y]=segAmounts(L,cur,s,b.sqrtP);a0+=x;a1+=y;
      inUp+=L*(s-cur);
      cur=s;
      if(cur>=b.sHi)break;
      L+=Number(net.get(t)||0n);
    }
    if(cur<b.sHi){
      const [x,y]=segAmounts(L,cur,b.sHi,b.sqrtP);a0+=x;a1+=y;
      inUp+=L*(b.sHi-cur);
    }
    // And downward. Crossing an initialised tick from above removes it — the
    // same net, the other way round, which is the identity the pool itself uses
    // when a swap walks the book.
    L=b.L;cur=b.sqrtP;
    for(const t of inBand.filter(t=>t<=b.tick).sort((x,y)=>y-x)){
      const s=Math.max(sqrtAtTick(t),b.sLo);
      const [x,y]=segAmounts(L,s,cur,b.sqrtP);a0+=x;a1+=y;
      inDown+=L*(1/s-1/cur);
      cur=s;
      if(cur<=b.sLo)break;
      L-=Number(net.get(t)||0n);
    }
    if(cur>b.sLo){
      const [x,y]=segAmounts(L,b.sLo,cur,b.sqrtP);a0+=x;a1+=y;
      inDown+=L*(1/b.sLo-1/cur);
    }
    return {amount0:a0,amount1:a1,tick:b.tick,spacing:b.spacing,lpShare:b.lpShare,
      complete:!truncated[i],initialized_ticks:inBand.length,
      band_ticks:[b.tLo,b.tHi],
      // What it would take to walk the price to either edge, before the pool
      // fee is added on top of the input. Amount out is the holding on that
      // side, which is why it is not repeated here.
      to_upper_in1:inUp,to_lower_in0:inDown};
  });
}

// === CAN THIS TOKEN BE SOLD? ===
// The question every buyer has and no label answers. GoPlus does not analyse a
// fresh token at all (measured 2026-09-02: none of 370 tokens tried came back
// analysed), so the page answered "sellability not checked" exactly where it
// mattered most. This asks the chain directly.
//
// HOW, WITHOUT SPENDING ANYTHING
// eth_call accepts a state override: for the length of one call, a probe
// address is given a token balance, an allowance to the PancakeSwap V2 router
// and some BNB, and the router is asked to sell. The public BSC nodes honour
// the override (all three tested on 2026-09-02). The balance and allowance
// live in mappings whose storage slot differs per contract, so the slot is
// found first by writing a value into candidate slots and reading balanceOf
// and allowance back, one batched request each. A contract that stores
// balances somewhere no candidate reaches (a proxy with a detached store, a
// packed struct) reports "could not place a test balance", which is an honest
// "not checked", never a "safe".
//
// WHAT A REVERT MEANS AND DOES NOT MEAN
// A sell that reverts for a fresh address with a normal balance is what a
// honeypot looks like from the outside. It is also what a token with a
// max-wallet rule or a trading pause looks like, so the revert reason is
// passed through and the chip says "reverted", not "scam". A sell that
// succeeds is proof for THIS size at THIS block from an address with no
// history; an owner can still flip a switch tomorrow, and the page says so.
const V2_ROUTER='0x10ed43c718714eb63d5aa57b78b54704e256024e';
const SEL_SELL_FOT='0x791ac947', SEL_BUY_FOT='0xb6f9de95', SEL_BAL='0x70a08231', SEL_ALLOW='0xdd62ed3e';
const PROBE='0x0000000000000000000000000000000000c0ffee';
// A contract as the seller. The router's fee-on-transfer swap returns nothing,
// so a plain address can only learn that a sell went through; a contract placed
// at PROBE by the same state override reads back what arrived, and the tax is
// arithmetic on that. Source: scripts/probe/SellProbe.sol; the bytes are
// reproduced by scripts/probe/build-probe.mjs (--check compares them).
// solc 0.8.36 · optimizer 200 · evm paris · 2121 bytes
const SELL_PROBE_CODE='0x60806040526004361061002d5760003560e01c80634279a6a8146100395780637b213b6c1461007257600080fd5b3661003457005b600080fd5b34801561004557600080fd5b506100596100543660046104ee565b610085565b6040805192835260208301919091520160405180910390f35b610059610080366004610548565b610250565b6000808383600081811061009b5761009b61059b565b90506020020160208101906100b091906105b1565b60405163095ea7b360e01b81526001600160a01b03888116600483015260248201889052919091169063095ea7b3906044016020604051808303816000875af1158015610101573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061012591906105d3565b5060405163d06ca61f60e01b81526001600160a01b0387169063d06ca61f906101569088908890889060040161063d565b600060405180830381865afa158015610173573d6000803e3d6000fd5b505050506040513d6000823e601f3d908101601f1916820160405261019b9190810190610676565b6101a6600185610759565b815181106101b6576101b661059b565b60209081029190910101519150476001600160a01b03871663791ac9478760008888306101e542610258610772565b6040518763ffffffff1660e01b815260040161020696959493929190610785565b600060405180830381600087803b15801561022057600080fd5b505af1158015610234573d6000803e3d6000fd5b5050505080476102449190610759565b91505094509492505050565b600080808484610261600182610759565b8181106102705761027061059b565b905060200201602081019061028591906105b1565b60405163d06ca61f60e01b81529091506001600160a01b0387169063d06ca61f906102b89034908990899060040161063d565b600060405180830381865afa1580156102d5573d6000803e3d6000fd5b505050506040513d6000823e601f3d908101601f191682016040526102fd9190810190610676565b610308600186610759565b815181106103185761031861059b565b60209081029190910101516040516370a0823160e01b81523060048201529093506000906001600160a01b038316906370a0823190602401602060405180830381865afa15801561036d573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061039191906107c3565b90506001600160a01b03871663b6f9de953460008989306103b442610258610772565b6040518763ffffffff1660e01b81526004016103d49594939291906107dc565b6000604051808303818588803b1580156103ed57600080fd5b505af1158015610401573d6000803e3d6000fd5b50506040516370a0823160e01b81523060048201528493506001600160a01b03861692506370a082319150602401602060405180830381865afa15801561044c573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061047091906107c3565b61047a9190610759565b92505050935093915050565b80356001600160a01b038116811461049d57600080fd5b919050565b60008083601f8401126104b457600080fd5b50813567ffffffffffffffff8111156104cc57600080fd5b6020830191508360208260051b85010111156104e757600080fd5b9250929050565b6000806000806060858703121561050457600080fd5b61050d85610486565b935060208501359250604085013567ffffffffffffffff81111561053057600080fd5b61053c878288016104a2565b95989497509550505050565b60008060006040848603121561055d57600080fd5b61056684610486565b9250602084013567ffffffffffffffff81111561058257600080fd5b61058e868287016104a2565b9497909650939450505050565b634e487b7160e01b600052603260045260246000fd5b6000602082840312156105c357600080fd5b6105cc82610486565b9392505050565b6000602082840312156105e557600080fd5b815180151581146105cc57600080fd5b81835260208301925060008160005b84811015610633576001600160a01b0361061d83610486565b1686526020958601959190910190600101610604565b5093949350505050565b8381526040602082015260006106576040830184866105f5565b95945050505050565b634e487b7160e01b600052604160045260246000fd5b60006020828403121561068857600080fd5b815167ffffffffffffffff81111561069f57600080fd5b8201601f810184136106b057600080fd5b805167ffffffffffffffff8111156106ca576106ca610660565b8060051b604051601f19603f830116810181811067ffffffffffffffff821117156106f7576106f7610660565b60405291825260208184018101929081018784111561071557600080fd5b6020850194505b838510156107385784518082526020958601959093500161071c565b509695505050505050565b634e487b7160e01b600052601160045260246000fd5b8181038181111561076c5761076c610743565b92915050565b8082018082111561076c5761076c610743565b86815285602082015260a0604082015260006107a560a0830186886105f5565b6001600160a01b039490941660608301525060800152949350505050565b6000602082840312156107d557600080fd5b5051919050565b8581526080602082015260006107f66080830186886105f5565b6001600160a01b039490941660408301525060600152939250505056fea26469706673582212207c8527339b57accc0677cb1e32c5eb3cebcdfa73637ae8a8847fd653e60ac77a64736f6c63430008240033';
const SEL_PROBE_SELL='0x4279a6a8', SEL_PROBE_BUY='0x7b213b6c';
const CALLER='0x000000000000000000000000000000000000beef';
// The token amount that must have reached a PancakeSwap V2 pair for it to pay
// `received` of the quote side, from the constant product with the 0.25% fee
// (getAmountIn without its +1). What was sent minus what arrived is the tax.
// Exported so the checker can pin the arithmetic without a node in the loop.
export function sellTaxFromReceived(reserveTok,reserveQ,amount,received){
  if(!(reserveQ>received)||!(amount>0n)||!(received>0n))return null;
  const arrived=(reserveTok*received*10000n)/((reserveQ-received)*9975n);
  const t=1-Number(arrived)/Number(amount);
  return t<0?0:Math.min(t,1);
}
const pad32=v=>(typeof v==='bigint'?v.toString(16):String(v).replace(/^0x/,'')).padStart(64,'0');
const hexToBytes=h=>{const s=h.replace(/^0x/,'');const a=new Uint8Array(s.length/2);for(let i=0;i<a.length;i++)a[i]=parseInt(s.substr(i*2,2),16);return a};
// keccak256 over raw bytes. The page and the worker both have crypto.subtle
// for SHA and nothing for keccak, so a compact Keccak-f[1600] lives here.
function keccak256(bytes){
  const RC=[0x1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x80000001n,0x8000000080008008n];
  const ROT=[[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]];
  const M=(1n<<64n)-1n, rot=(x,n)=>n?(((x<<BigInt(n))|(x>>BigInt(64-n)))&M):x;
  const st=new Array(25).fill(0n); const rate=136;
  const msg=new Uint8Array(Math.ceil((bytes.length+1)/rate)*rate); msg.set(bytes); msg[bytes.length]^=0x01; msg[msg.length-1]^=0x80;
  for(let off=0;off<msg.length;off+=rate){
    for(let i=0;i<rate/8;i++){let w=0n;for(let b=7;b>=0;b--)w=(w<<8n)|BigInt(msg[off+i*8+b]);st[i]^=w}
    for(let r=0;r<24;r++){
      const C=[0,1,2,3,4].map(x=>st[x]^st[x+5]^st[x+10]^st[x+15]^st[x+20]);
      const D=[0,1,2,3,4].map(x=>C[(x+4)%5]^rot(C[(x+1)%5],1));
      for(let i=0;i<25;i++)st[i]^=D[i%5];
      const B=new Array(25);
      for(let x=0;x<5;x++)for(let y=0;y<5;y++)B[y+5*((2*x+3*y)%5)]=rot(st[x+5*y],ROT[x][y]);
      for(let x=0;x<5;x++)for(let y=0;y<5;y++)st[x+5*y]=B[x+5*y]^((~B[(x+1)%5+5*y])&B[(x+2)%5+5*y]);
      st[0]^=RC[r];
    }
  }
  let out='';for(let i=0;i<4;i++){let w=st[i];for(let b=0;b<8;b++){out+=Number(w&0xffn).toString(16).padStart(2,'0');w>>=8n}}
  return out;
}
export const keccakHex=hex=>'0x'+keccak256(hexToBytes(hex));
async function postRaw(url,body){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('http '+r.status);return r.json();
}
// The batched slot search is forty calls in one request, and a public node
// under load answers that with 429 (seen from the worker on the first live
// run). Every endpoint in the pool is tried before the simulation gives up,
// and a node that answered once is kept for the rest of this simulation.
async function postAny(body,pref){
  const order=[pref,...RPCS.filter(u=>u!==pref)].filter(Boolean);
  let last=null;
  for(const u of order){try{const j=await postRaw(u,body);if(Array.isArray(j)||(j&&!j.error))return {url:u,j}}catch(e){last=e}}
  throw last||new Error('no endpoint answered');
}
// A slot search is only conclusive when the node answered EVERY candidate
// without an error. A throttled node answers a batch with some entries as
// "rate limit" — and a search that read that as "no slot matched" reported
// a perfectly ordinary token as "non-standard storage" on the second call
// of the first live run. Errors inside the batch mean: ask the next node.
async function searchSlot(calls,amount,pref){
  const order=[pref,...RPCS.filter(u=>u!==pref)].filter(Boolean);
  let last=null;
  for(const u of order){
    let j=null;try{j=await postRaw(u,calls)}catch(e){last=e;continue}
    if(!Array.isArray(j)){last=new Error('not a batch');continue}
    const hit=j.find(x=>x.result&&x.result!=='0x'&&BigInt(x.result)===amount);
    if(hit)return {url:u,hit};
    if(j.some(x=>x.error)||j.length<calls.length){last=new Error('throttled batch');continue}
    return {url:u,hit:null};
  }
  throw last||new Error('no endpoint answered');
}
// Only a REVERT is a verdict about the token. A node that answers "rate
// limit", "timeout" or "method not supported" has said nothing about the
// sell, and on the first live run four answers in a row read such a refusal
// as "the sell reverted" — a false honeypot on our own token. Exported so the
// checker can pin both directions without a node in the loop.
export function isRevert(err){
  if(!err)return false;
  const m=String(err.message||'').toLowerCase();
  const d=typeof err.data==='string'?err.data:'';
  return /revert|invalid opcode|out of gas/.test(m)||d.startsWith('0x08c379a0')||d.startsWith('0x4e487b71')||err.code===3;
}
function revertText(err){
  const m=String(err&&(err.message||err)).slice(0,120);
  const d=err&&err.data&&typeof err.data==='string'?err.data:null;
  if(d&&d.startsWith('0x08c379a0')){try{const len=parseInt(d.slice(74,138),16);const hex=d.slice(138,138+len*2);let s='';for(let i=0;i<hex.length;i+=2)s+=String.fromCharCode(parseInt(hex.substr(i,2),16));return s}catch(e){}}
  return m;
}
export async function simulateRoundTrip(token,pair,tokenIs0,kind){
  try{
    if(kind!=='v2')return {ok:false,reason:'the simulation covers PancakeSwap V2 pairs; this token trades on V3'};
    token=token.toLowerCase();
    const url=RPCS[0];
    // THE PAIR THE PROBE REALLY TRADES THROUGH (2026-09-18). The probe sells
    // token -> WBNB through PancakeSwap's V2 router, whatever pair was scanned.
    // The tax was then solved against the SCANNED pair's reserves: for the
    // CAKE/USDT pair that read a 99.87% sell tax on a token with none, and a
    // token with no BNB pair on PancakeSwap V2 read "sell REVERTED" — a false
    // honeypot. The reserves are now those of the pair the router will use;
    // without one the test says it was not run, which is what happened.
    //
    // THROUGH THE POOL THAT WAS SCANNED, WHEN THE ROUTER CAN (2026-09-21). That
    // fix sent every token whose market is NOT against BNB to its token/BNB
    // pair, whatever that pair holds. ARK: a $28M ARK/USDT pool charging 2.5%
    // on a sell (three executed sells), and the test sold 0.0006 ARK into an
    // ARK/BNB pair holding four dollars — "sellable: true, tax 0/0", about a
    // market nobody trades in. A tax or a sell block tied to the main pair
    // (`to == pair`, the usual pattern) is invisible from a side pair, and a
    // broken side pair reads as a false "not sellable". The router routes
    // through two pairs as readily as one: when the scanned pool is a
    // PancakeSwap V2 pair against a quote that has its own BNB pair there, the
    // test sells token -> quote -> BNB and buys back the same way. Whatever it
    // traded through is NAMED in the answer (`pair`, `through_scanned_pool`),
    // so a caller never has to guess which market "sellable" is about.
    pair=String(pair).toLowerCase();
    const head=await rpcBatch([call(V2FACTORY,getPair(token,WBNB)),call(pair,S.token0),call(pair,S.token1),call(pair,S.factory)],url);
    const wp=addrAt(head[0]),t0=addrAt(head[1]),t1=addrAt(head[2]),fac=addrAt(head[3]);
    const quote=t0===token?t1:t1===token?t0:null;
    let path=[token,WBNB],through=wp===pair;
    if(!through&&fac===V2FACTORY&&quote&&quote!==WBNB){
      const qp=addrAt((await rpcBatch([call(V2FACTORY,getPair(quote,WBNB))],url))[0]);
      if(qp&&qp!==NULLA){path=[token,quote,WBNB];through=true}
    }
    if(!through){
      if(!wp||wp===NULLA)return {ok:false,reason:'the sell test trades through PancakeSwap V2 against BNB, and neither this token nor the pool that was read has a route there — not run, not cleared'};
      pair=wp;tokenIs0=BigInt(token)<BigInt(WBNB);
    }
    const named={pair,path,through_scanned_pool:through,
      ...(through?{}:{pair_note:'NOT the pool that was read: this token\'s PancakeSwap V2 pair against BNB, the only one this router could trade. A tax or a sell block tied to the main pool does not show here.'})};
    // A realistic size: one part in a thousand of what the pair holds.
    const res=await rpcBatch([call(pair,SEL.reserves)],url);
    const rr=res2(res[0]);if(!rr)return {ok:false,reason:'the pair reserves could not be read'};
    const reserveTok=BigInt(Math.floor(tokenIs0?rr[0]:rr[1]));
    const reserveQ=BigInt(Math.floor(tokenIs0?rr[1]:rr[0]));
    const amount=reserveTok/1000n>0n?reserveTok/1000n:1n;
    const amtHex='0x'+pad32(amount);
    const probeKey=pad32(PROBE);
    const balCalls=[],balKeys=[];
    for(let slot=0;slot<40;slot++){const k=keccakHex(probeKey+pad32(BigInt(slot)));balKeys.push(k);
      balCalls.push({jsonrpc:'2.0',id:slot,method:'eth_call',params:[{to:token,data:SEL_BAL+probeKey},'latest',{[token]:{stateDiff:{[k]:amtHex}}}]})}
    // Twelve candidates first: nearly every ERC-20 keeps balances in one of
    // the first slots, and a batch a third the size is a batch a public node
    // answers under load. The long tail is only asked when the short one misses.
    let b1=await searchSlot(balCalls.slice(0,12),amount,url);
    if(!b1.hit)b1=await searchSlot(balCalls.slice(12),amount,b1.url);
    const node=b1.url;const balHit=b1.hit;
    if(!balHit)return {ok:false,reason:'could not place a test balance in this contract (non-standard storage) — not checked, not cleared'};
    const balKey=balKeys[balHit.id];
    const size_note='one part in a thousand of the pair\'s token reserve, sold from a fresh address with no history';

    // 1. The probe: a contract at PROBE sells and buys, and reports what
    // arrived. That is the sell test AND the tax, in one call each.
    const pr=await probeRoundTrip(token,amount,amtHex,balKey,reserveTok,reserveQ,node,path);
    if(pr.supported&&pr.sell.ok&&pr.buy.ok){
      return {ok:true,sellable:true,buyable:true,sell_error:null,buy_error:null,amount:amount.toString(),size_note,...named,
        tax:{sell_pct:pr.sellTax==null?null:+(pr.sellTax*100).toFixed(2),buy_pct:pr.buyTax==null?null:+(pr.buyTax*100).toFixed(2),
          method:'simulated at this block: what the pair would pay for the whole amount against what arrived after the transfer, from a fresh address with no history'},
        source:'eth_call with a state override on the PancakeSwap V2 router, at this block; the seller is a contract placed at a fresh address so what came back could be read'};
    }
    // 2. A revert with a contract as the seller is not yet a verdict: a
    // "no contracts may trade" rule refuses it and a plain wallet sails
    // through. So the same sell is asked from a plain address before anything
    // is called refused — and when the node does not support code overrides at
    // all, the plain address is simply the only path.
    const plain=await plainRoundTrip(token,amount,amtHex,balKey,node,path);
    if(!plain.ok)return pr.supported
      ? {ok:true,sellable:pr.sell.ok,buyable:pr.buy.ok,sell_error:pr.sell.error,buy_error:pr.buy.error,amount:amount.toString(),size_note,...named,tax:null,
         source:'eth_call with a state override on the PancakeSwap V2 router, at this block; the seller was a contract at a fresh address'}
      : plain;
    if(pr.supported&&plain.sellable&&!pr.sell.ok){
      return {...plain,...named,tax:null,contract_refused:pr.sell.error,
        note:'A plain wallet sells; a contract as the seller was refused ('+pr.sell.error+'). That is what an anti-bot rule looks like, and it means the tax could not be measured by simulation.'};
    }
    return {...plain,...named,tax:null};
  }catch(e){return {ok:false,reason:'the simulation could not run: '+String(e.message||e).slice(0,80)}}
}
async function probeRoundTrip(token,amount,amtHex,balKey,reserveTok,reserveQ,node,path=[token,WBNB]){
  const words=a=>pad32(BigInt(a.length))+a.map(x=>pad32(x)).join('');
  const override={[token]:{stateDiff:{[balKey]:amtHex}},[PROBE]:{code:SELL_PROBE_CODE,balance:'0x'+pad32(10n**18n)},[CALLER]:{balance:'0x'+pad32(10n**18n)}};
  const sellData=SEL_PROBE_SELL+pad32(V2_ROUTER)+pad32(amount)+pad32(0x60n)+words(path);
  const buyData=SEL_PROBE_BUY+pad32(V2_ROUTER)+pad32(0x40n)+words(path.slice().reverse());
  const calls=[
    {jsonrpc:'2.0',id:1,method:'eth_call',params:[{from:CALLER,to:PROBE,data:sellData,gas:'0x1e8480'},'latest',override]},
    {jsonrpc:'2.0',id:2,method:'eth_call',params:[{from:CALLER,to:PROBE,data:buyData,value:'0x'+pad32(10n**16n),gas:'0x1e8480'},'latest',override]},
  ];
  let sell=null,buy=null;
  for(const u of [node,...RPCS.filter(x=>x!==node)]){
    let out=null;try{out=await postRaw(u,calls)}catch(e){continue}
    if(!Array.isArray(out))continue;
    const s1=out.find(x=>x.id===1),b1=out.find(x=>x.id===2);
    const settled=x=>x&&(!x.error||isRevert(x.error));
    if(settled(s1)&&settled(b1)){sell=s1;buy=b1;break}
  }
  if(!sell||!buy)return {supported:false};
  const two=h=>{const x=String(h||'').replace(/^0x/,'');return x.length>=128?[BigInt('0x'+x.slice(0,64)),BigInt('0x'+x.slice(64,128))]:null};
  const sv=sell.error?null:two(sell.result),bv=buy.error?null:two(buy.result);
  // A result that decodes to nothing is a node that ran the call without the
  // code override and returned empty — that is "unsupported", not "sold".
  if((!sell.error&&!sv)||(!buy.error&&!bv))return {supported:false};
  // One hop: solved exactly against the pair's reserves. Two hops: the probe's
  // own quote for the whole amount against what arrived — at one part in a
  // thousand of the reserve the curve bends that by under 0.01 points.
  const sellTax=!sv?null:path.length===2?sellTaxFromReceived(reserveTok,reserveQ,amount,sv[1])
    :sv[0]>0n?Math.max(0,Math.min(1,1-Number(sv[1])/Number(sv[0]))):null;
  const buyTax=bv&&bv[0]>0n?Math.max(0,Math.min(1,1-Number(bv[1])/Number(bv[0]))):null;
  return {supported:true,
    sell:{ok:!sell.error,error:sell.error?revertText(sell.error):null,quoted:sv?sv[0].toString():null,received:sv?sv[1].toString():null},
    buy:{ok:!buy.error,error:buy.error?revertText(buy.error):null,quoted:bv?bv[0].toString():null,received:bv?bv[1].toString():null},
    sellTax,buyTax};
}
// The plain-address path: the original simulation. It needs the allowance
// placed by storage override too, since a wallet cannot approve inside an
// eth_call, and it learns only whether the router accepted the sell.
async function plainRoundTrip(token,amount,amtHex,balKey,node,path=[token,WBNB]){
  const words=a=>pad32(BigInt(a.length))+a.map(x=>pad32(x)).join('');
  try{
    const probeKey=pad32(PROBE), routerKey=pad32(V2_ROUTER);
    const alCalls=[],alKeys=[];
    for(let slot=0;slot<40;slot++){const inner=keccakHex(probeKey+pad32(BigInt(slot)));const k=keccakHex(routerKey+inner.slice(2));alKeys.push(k);
      alCalls.push({jsonrpc:'2.0',id:slot,method:'eth_call',params:[{to:token,data:SEL_ALLOW+probeKey+routerKey},'latest',{[token]:{stateDiff:{[k]:amtHex}}}]})}
    let a1=await searchSlot(alCalls.slice(0,12),amount,node);
    if(!a1.hit)a1=await searchSlot(alCalls.slice(12),amount,a1.url);
    node=a1.url;const alHit=a1.hit;
    if(!alHit)return {ok:false,reason:'could not place a test allowance in this contract — not checked, not cleared'};
    const alKey=alKeys[alHit.id];
    const deadline=pad32(BigInt(Math.floor(Date.now()/1000)+600));
    const override={[token]:{stateDiff:{[balKey]:amtHex,[alKey]:amtHex}},[PROBE]:{balance:'0x'+pad32(10n**18n)}};
    const sellData=SEL_SELL_FOT+pad32(amount)+pad32(0n)+pad32(0xa0n)+probeKey+deadline+words(path);
    const buyData=SEL_BUY_FOT+pad32(0n)+pad32(0x80n)+probeKey+deadline+words(path.slice().reverse());
    const calls=[
      {jsonrpc:'2.0',id:1,method:'eth_call',params:[{from:PROBE,to:V2_ROUTER,data:sellData,gas:'0x1e8480'},'latest',override]},
      {jsonrpc:'2.0',id:2,method:'eth_call',params:[{from:PROBE,to:V2_ROUTER,data:buyData,value:'0x'+pad32(10n**16n),gas:'0x1e8480'},'latest',override]},
    ];
    // Every node in turn until both answers are either a result or a revert.
    let sell=null,buy=null;
    for(const u of [node,...RPCS.filter(x=>x!==node)]){
      let out=null;try{out=await postRaw(u,calls)}catch(e){continue}
      if(!Array.isArray(out))continue;
      const s1=out.find(x=>x.id===1),b1=out.find(x=>x.id===2);
      const settled=x=>x&&(!x.error||isRevert(x.error));
      if(settled(s1)&&settled(b1)){sell=s1;buy=b1;break}
    }
    if(!sell||!buy)return {ok:false,reason:'every node refused the simulation call (rate limit or unsupported) — not checked, not cleared'};
    const sellOk=!sell.error,buyOk=!buy.error;
    return {ok:true,sellable:sellOk,buyable:buyOk,
      sell_error:sellOk?null:revertText(sell&&sell.error),buy_error:buyOk?null:revertText(buy&&buy.error),
      amount:amount.toString(),
      size_note:'one part in a thousand of the pair\'s token reserve, sold from a fresh address with no history',
      source:'eth_call with a state override on the PancakeSwap V2 router, at this block'};
  }catch(e){return {ok:false,reason:'the simulation could not run: '+String(e.message||e).slice(0,80)}}
}

// ---- four.meme: a token still on its launch curve ---------------------------
// A four.meme token has no PancakeSwap pool until its raise completes; until
// then every trade goes through four.meme's TokenManager, and a scanner that
// only knows pools said "no pool" about a token that trades all day. The
// platform's own helper contract answers the three questions this page asks of
// a pool — what is it worth, what does a trade cost, can you sell it — with one
// view call each: getTokenInfo(address), tryBuy(address,uint256,uint256),
// trySell(address,uint256). Prices come back as quote-wei per whole token; the
// fee rate is in basis points of 1e4 (100 = 1 %). tryBuy's estimatedCost plus
// estimatedFee is the money in; trySell's funds is the money out AFTER its fee
// (checked on a live curve: fee was 1 % of funds+fee, not of funds).
export const FOURMEME_HELPER='0xf251f83e40a78868fcfa3fa4599dad6494e46034';
export const FOURMEME_MANAGER='0x5c952063c7fc8610ffdb798152d69f0b9550762b';
const CURVE_SEL={info:'0x1f69565f',tryBuy:'0xe21b103a',trySell:'0xc6f43e8c'};
const wordAt=(h,i)=>h&&h.length>=66+64*i?hx('0x'+h.slice(2+64*i,66+64*i)):null;
const addrWord=(h,i)=>h&&h.length>=66+64*i?addrAt('0x'+h.slice(2+64*i,66+64*i)):null;

// null when the address is not a four.meme token at all (the helper returns a
// zero version), an object otherwise — including for tokens that have long
// since graduated, where `liquidityAdded` is true and the pool path applies.
export async function curveInfo(token,url){
  let r;
  try{r=(await rpcBatch([call(FOURMEME_HELPER,CURVE_SEL.info+pad(token))],url))[0]}
  catch(e){return null}
  const version=Number(wordAt(r,0)||0n);
  if(!version)return null;
  const quoteAddr=addrWord(r,2);
  const known=QUOTES.find(([a])=>a===quoteAddr);
  const isBnb=!quoteAddr||quoteAddr===NULLA||quoteAddr===WBNB;
  const offers=Number(wordAt(r,7))/1e18, maxOffers=Number(wordAt(r,8))/1e18;
  const funds=Number(wordAt(r,9))/1e18, maxRaising=Number(wordAt(r,10))/1e18;
  const launch=Number(wordAt(r,6)||0n);
  return {
    version, manager:addrWord(r,1),
    quoteAddr:isBnb?null:quoteAddr,
    quoteSym:isBnb?'BNB':known?known[1]:null,
    quoteIsStable:!isBnb&&!!known&&known[2]===1,
    // quote per whole token, as a plain number
    price:Number(wordAt(r,3))/1e18,
    feePct:Number(wordAt(r,4)||0n)/100,
    launchTime:launch>0?launch:null,
    offersLeft:offers, maxOffers,
    raised:funds, maxRaising,
    progressPct:maxRaising>0?Math.min(100,funds/maxRaising*100):null,
    liquidityAdded:(wordAt(r,11)||0n)!==0n,
  };
}

// What a buy and a sell of each USD size would cost on the curve right now,
// against the curve's own last price, fee included — the same definition the
// pool ladder uses, so the two are comparable. A size the curve cannot fill
// (more than is left to raise) comes back with null costs rather than a
// number that describes a trade nobody could place.
export async function curveLadder(token,info,quoteUsd,sizesUsd,url){
  if(!(quoteUsd>0)||!(info.price>0))return [];
  const sizes=sizesUsd.filter(s=>s>0);
  const calls=[];
  for(const usd of sizes){
    const fundsWei=BigInt(Math.floor(usd/quoteUsd*1e18));
    const tokensWei=BigInt(Math.floor(usd/quoteUsd/info.price*1e18));
    calls.push(call(FOURMEME_HELPER,CURVE_SEL.tryBuy+pad(token)+num(0)+num(fundsWei)));
    calls.push(call(FOURMEME_HELPER,CURVE_SEL.trySell+pad(token)+num(tokensWei)));
  }
  let res;
  try{res=await rpcBatch(calls,url)}catch(e){return []}
  const rows=[];
  sizes.forEach((usd,i)=>{
    const b=res[2*i],s=res[2*i+1];
    const row={usd,buyCost:null,sellCost:null,buyNote:null,sellNote:null};
    const paid=usd/quoteUsd;
    const got=b?Number(wordAt(b,2))/1e18:0;
    const cost=b?Number(wordAt(b,3))/1e18:0, fee=b?Number(wordAt(b,4))/1e18:0;
    // The helper fills what it can: a buy that would overshoot the raise is
    // capped at what is left, and the money it would actually take (cost plus
    // fee) is then less than the money offered. Checked live: a $2,500 buy
    // against $1,300 left came back "cheaper" than a $1,000 one, because the
    // cost was measured on the capped part only. Such a row says so instead.
    // ... but "less than offered" alone does not mean capped (2026-09-18): some
    // curves take a per-token deduction, and cost+fee then comes back at 0.97
    // of the funds at EVERY size — a curve with 17.85 of 18 BNB still to raise
    // had all six rows marked "more than the curve has left". Capped is said
    // only when the buy really reaches what is left: the raise's remainder in
    // money, or the tokens still on offer. Otherwise the cost is measured from
    // what the helper says the buy takes (amountMsgValue for a BNB raise,
    // amountApproval for a token raise), against the tokens it returns.
    const inPaid=cost+fee;
    const needs=b?Math.max(Number(wordAt(b,5)),Number(wordAt(b,6)))/1e18:0;
    const leftMoney=(info.maxRaising>0&&info.raised!=null)?info.maxRaising-info.raised:null;
    const hitsCap=(leftMoney!=null&&inPaid>=leftMoney*0.999)||(info.offersLeft>0&&got>=info.offersLeft*0.999);
    if(b&&got>0&&inPaid>=paid*0.999){
      row.buyCost=(inPaid/(got*info.price)-1)*100;
    }else if(b&&got>0&&hitsCap){
      row.buyNote='more than the curve has left to sell';
    }else if(b&&got>0){
      // The helper's figure is taken only where it is plausibly that — the money
      // offered, give or take; anything else and the money offered stands in.
      const took=needs>=paid*0.5&&needs<=paid*1.05?needs:paid;
      row.buyCost=(took/(got*info.price)-1)*100;
    }else row.buyNote='the curve did not quote this size';
    const tokens=paid/info.price;
    const out=s?Number(wordAt(s,2))/1e18:0;
    if(s&&out>0)row.sellCost=(1-out/(tokens*info.price))*100;
    else row.sellNote='the curve did not quote this size';
    rows.push(row);
  });
  return rows;
}

// What is trading on four.meme's curve right now, straight from the manager's
// own logs: the most recently traded tokens that have not graduated, each with
// its raise, price and what a $100 buy and sell would cost. Nobody shows the
// cost of a curve trade before there is a pool; this is the list a person
// wants before pressing buy on a launch. Runs in the browser, on demand — a
// few dozen small reads against the public log nodes, which cap eth_getLogs
// at a handful of blocks per call, hence the windows. No event signature is
// assumed: every log the manager writes about a token carries that token's
// address in its first data word, and that is all this reads.
export async function curveFeed({blocks=300,window=10,max=8,quoteUsd={bnb:0},sizeUsd=100}={}){
  const url=LOGS_RPCS[0];
  const head=Number(await rpc('eth_blockNumber',[],url));
  const windows=[];
  for(let to=head;to>head-blocks;to-=window)windows.push([to-window+1,to]);
  const logs=(await Promise.all(windows.map(([from,to])=>
    rpc('eth_getLogs',[{address:FOURMEME_MANAGER,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16)}],url).catch(()=>[])
  ))).flat().filter(l=>Array.isArray(l.topics)&&l.data&&l.data.length>=130);
  // Newest first; one entry per token, the block it was last seen in.
  logs.sort((a,b)=>Number(b.blockNumber)-Number(a.blockNumber)||Number(b.logIndex)-Number(a.logIndex));
  const seen=new Map();
  for(const l of logs){
    const t=addrAt('0x'+l.data.slice(2,66));
    if(!t||t===NULLA||seen.has(t))continue;
    seen.set(t,{token:t,lastBlock:Number(l.blockNumber),trades:1});
    if(seen.size>=max*3)break;
  }
  for(const l of logs){const t=addrAt('0x'+l.data.slice(2,66));const e=t&&seen.get(t);if(e&&e.lastBlock!==Number(l.blockNumber))e.trades++;}
  const out=[];
  for(const e of seen.values()){
    if(out.length>=max)break;
    const cv=await curveInfo(e.token);
    if(!cv||cv.liquidityAdded)continue;
    const q=cv.quoteSym==='BNB'?quoteUsd.bnb:cv.quoteIsStable?1:0;
    let symbol=null;
    try{const s=await rpcBatch([call(e.token,S.symbol)]);symbol=decStr(s[0])||null}catch(err){}
    const rows=q>0?await curveLadder(e.token,cv,q,[sizeUsd]).catch(()=>[]):[];
    const r=rows[0]||{};
    out.push({token:e.token,symbol,lastBlock:e.lastBlock,blocksAgo:head-e.lastBlock,quoteSym:cv.quoteSym,
      raised:cv.raised,maxRaising:cv.maxRaising,progressPct:cv.progressPct,priceUsd:q>0?cv.price*q:null,
      buyCost:r.buyCost??null,sellCost:r.sellCost??null,buyNote:r.buyNote||null,feePct:cv.feePct});
  }
  return {head,blocks,tokensSeen:seen.size,list:out};
}
