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
//   LOGS_RPC eth_getLogs, ~5000 blocks near the head. That is enough to find
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
export const RPC=RPCS[0],
  LOGS_RPC='https://bsc-rpc.publicnode.com',
  GOPLUS='https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=',
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
        let s='';for(let i=0;i<len;i++)s+=String.fromCharCode(parseInt(b.substr(128+i*2,2),16));
        if(/^[\x20-\x7e]+$/.test(s))return s;
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
export async function rpcBatch(calls,url){
  const out=[];
  for(let i=0;i<calls.length;i+=MAX_BATCH){
    const part=calls.slice(i,i+MAX_BATCH);
    const body=part.map((c,k)=>({jsonrpc:'2.0',id:k,method:'eth_call',params:[c,'latest']}));
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
    return {kind:'v3pool',fee:Number(hx(q[1])),token0:addrAt(q[3]),token1:addrAt(q[4]),
      sqrt:hx('0x'+q[2].slice(2,66))};
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
  if(known)return {usd:known[2]?1:bnbUsd,sym:known[1],direct:true};
  const p=await rpcBatch([call(V2FACTORY,getPair(addr,WBNB)),call(addr,S.symbol),call(addr,S.decimals)]);
  const pair=addrAt(p[0]),sym=decStr(p[1]).slice(0,12)||'?',dec=Number(hx(p[2]))||18;
  if(!pair||pair===NULLA)return {usd:null,sym,direct:false};
  const r=await rpcBatch([call(pair,S.reserves),call(pair,S.token0)]);
  const rr=res2(r[0]);if(!rr)return {usd:null,sym,direct:false};
  const is0=addrAt(r[1])===addr,
        tok=(is0?rr[0]:rr[1])/Math.pow(10,dec),wb=(is0?rr[1]:rr[0])/1e18;
  if(!(tok>0)||!(wb>0))return {usd:null,sym,direct:false};
  return {usd:(wb/tok)*bnbUsd,sym,direct:false,hopBnb:wb,hopPair:pair};
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
  const move=h=>{
    if(!h||h.length<130)return null;
    const after=Number(BigInt('0x'+h.slice(66,130)));
    if(!(after>0)||!(before>0))return null;
    const ratio=Math.pow(after/before,2);      // price of token0 in token1
    return ((tokenIs0?ratio:1/ratio)-1)*100;   // ...expressed for OUR token
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
    return {usd:u,
      buyMove:move(b),
      buyCost:gotTok!=null?(1-(gotTok*spot)/(paidQ*quoteUsd))*100:null,
      sellMove:move(s)!=null?-Math.abs(move(s)):null,
      sellCost:(gotQ!=null&&sentTok>0)?(1-(gotQ*quoteUsd)/(sentTok*spot))*100:null};
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
const SWAP_T='0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
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
const int256=h=>{const v=BigInt('0x'+h);return v>=TWO255?v-TWO256:v};
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
    // One window, and only one: this endpoint serves ~5,000 blocks at the head
    // and answers anything older with "archive requests require a personal
    // token". The second window the earlier build asked for was refused every
    // single time, which cost a round trip and bought nothing.
    const from=head-4999;
    let logs=null;
    const topic=kind==='v3'?[[SWAP_V3_T,SWAP_V3_UNI]]:[SWAP_T];
    try{logs=await rpc('eth_getLogs',[{address:pair,topics:topic,
      fromBlock:'0x'+from.toString(16),toBlock:'0x'+head.toString(16)}],LOGS_RPC)}catch(e){logs=null}
    // A refused range and a quiet pool arrive as the same emptiness and mean
    // opposite things. Only one of them may be stated as a fact about somebody
    // else's pool.
    if(!logs)return {ok:false,reason:'the log endpoint refused the range'};
    if(!logs.length){
      const span=await windowSpan(from,head);
      return {ok:false,reason:'this pool has not traded in the last '+(span||'~5,000 blocks')};
    }
    const U=h=>BigInt('0x'+h);
    const buys=[],sells=[];const seen=new Set();
    // Receipts are one round trip each, and a busy pool can offer thousands of
    // swaps. Sixteen is enough to find three of each on any pool with two-sided
    // flow, and bounds the wait when a pool is all arb and nothing qualifies.
    let tried=0;
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
    // Exempt wallets exist — the deployer, the tax sink, routers on an allow
    // list — and they trade at 0%. Taking the median rather than the mean keeps
    // one exempt trade from dragging the figure below what a normal wallet pays.
    const med=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);
      return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2};
    const b=med(buys),s=med(sells);
    if(b==null&&s==null)return {ok:false,reason:'no readable transfers in recent trades'};
    return {ok:true,buy:b,sell:s,nBuy:buys.length,nSell:sells.length,
      spread:{buy:buys.map(x=>+(x*100).toFixed(2)),sell:sells.map(x=>+(x*100).toFixed(2))}};
  }catch(e){return {ok:false,reason:'the log endpoint did not answer'}}
}
