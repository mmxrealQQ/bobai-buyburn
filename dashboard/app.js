// Ausgelagert aus index.html: der Block war 28 KB und musste bei JEDEM
// Seitenaufruf mit dem Dokument uebertragen und geparst werden, obwohl er zum
// Anzeigen der Seite nicht gebraucht wird. Als eigene Datei mit defer laedt er
// parallel zum Parsen, blockiert nichts und liegt beim naechsten Aufruf im
// Cache — davon profitiert vor allem das Aktualisieren auf dem Handy.
// Versionierung ueber ?v= im <script>-Tag, siehe index.html.
// === NAV BUY BUTTON: only once the hero's own Buy CTA has scrolled away ===
!function(){const g=document.querySelector('.nb-group'),h=document.querySelector('.hero');
if(!g||!h)return;
if(!('IntersectionObserver'in window)){g.classList.add('on');return}
new IntersectionObserver(([e])=>g.classList.toggle('on',!e.isIntersecting),
  {rootMargin:'-120px 0px 0px 0px'}).observe(h)}();

/* Background is now the CSS aurora (.aur) — no canvas work needed.
// === BACKGROUND: the brain, wired into the chain ===
// Nodes fill an actual brain silhouette (top view — two hemispheres split by
// the longitudinal fissure), edges wire neighbouring nodes together, and gold
// pulses travel along those edges like transactions moving across the chain.
!function(){
  const c=document.getElementById('bg');if(!c)return;
  const x=c.getContext('2d'),GOLD='240,185,11';
  let w,h,N=[],E=[],P=[],rx,ry,reduce=false;
  try{reduce=matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}

  // Wobble on the radius gives the gyri; the excluded centre band is the fissure.
  function inBrain(u,v){
    const th=Math.atan2(v,u);
    const wob=1+.06*Math.sin(7*th)+.035*Math.sin(13*th+.9)+.03*Math.sin(4*th+2.1);
    if(Math.hypot(u,v/.84)>wob)return false;
    if(Math.abs(u)<.05&&Math.abs(v)<.86*wob)return false;
    return true;
  }
  function newPulse(){return{e:Math.floor(Math.random()*E.length),t:Math.random(),s:.005+Math.random()*.007}}

  function build(){
    w=c.width=innerWidth;h=c.height=innerHeight;
    // Wider than the 1100px content column on purpose — otherwise the whole
    // brain hides behind the cards and you only ever see stray dots.
    rx=Math.max(Math.min(w*.5,860),w*.42);ry=rx*.72;
    const cx=w/2,cy=h*.46,step=.105;
    N=[];E=[];P=[];
    for(let u=-1;u<=1;u+=step)for(let v=-1;v<=1;v+=step){
      const ju=u+(Math.random()-.5)*step*.75,jv=v+(Math.random()-.5)*step*.75;
      if(!inBrain(ju,jv))continue;
      N.push({x:cx+ju*rx,y:cy+jv*ry,p:Math.random()*6.28});
    }
    const lim=rx*step*2.4;
    for(let i=0;i<N.length;i++)for(let j=i+1;j<N.length;j++){
      const d=Math.hypot(N[i].x-N[j].x,N[i].y-N[j].y);
      if(d<lim)E.push({a:i,b:j,d});
    }
    if(E.length)for(let i=0;i<18;i++)P.push(newPulse());
  }

  function draw(){
    x.clearRect(0,0,w,h);
    const now=performance.now()/1000,lim=rx*.115*2.4;
    for(const e of E){
      const a=N[e.a],b=N[e.b];
      x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);
      x.strokeStyle='rgba('+GOLD+','+(.2*(1-e.d/lim))+')';x.lineWidth=.7;x.stroke();
    }
    for(const n of N){
      const r=reduce?1:1+Math.sin(now*1.3+n.p)*.45;
      x.beginPath();x.arc(n.x,n.y,Math.max(r,.5),0,6.28);
      x.fillStyle='rgba('+GOLD+',.55)';x.fill();
    }
    for(const p of P){
      const e=E[p.e];if(!e)continue;
      const a=N[e.a],b=N[e.b],px=a.x+(b.x-a.x)*p.t,py=a.y+(b.y-a.y)*p.t;
      const g=x.createRadialGradient(px,py,0,px,py,8);
      g.addColorStop(0,'rgba(255,214,90,.9)');g.addColorStop(1,'rgba('+GOLD+',0)');
      x.beginPath();x.arc(px,py,8,0,6.28);x.fillStyle=g;x.fill();
      if(!reduce){p.t+=p.s;if(p.t>=1)Object.assign(p,newPulse(),{t:0})}
    }
    requestAnimationFrame(draw);
  }
  addEventListener('resize',build);build();draw();
}();
*/

// === WRAPNET: neural wiring that runs down both margins and embraces the page ===
// Built from the real document height so it always spans the whole thing, and
// coloured with the character's glitch speckles (cyan / magenta / gold).
!function(){
  const svg = document.querySelector('.wrapnet'); if(!svg) return;
  const GLITCH = ['34,211,238', '232,121,249', '240,185,11'];
  const NS = 'http://www.w3.org/2000/svg';
  let raf, lastW = 0, lastH = 0;

  function build(){
    // Below 900px (and on short landscape phones) .wrapnet is display:none —
    // building hundreds of SVG nodes for an invisible element is pure
    // main-thread cost on exactly the devices that can least afford it.
    // Read the computed value rather than repeating the breakpoint, so this
    // can never drift out of sync with the media query.
    if(getComputedStyle(svg).display === 'none'){
      if(svg.firstChild){ while(svg.firstChild) svg.removeChild(svg.firstChild); }
      lastW = lastH = 0;
      return;
    }
    const page = document.querySelector('.page');
    const W = page.clientWidth, H = page.scrollHeight;
    if(!W || !H) return;
    // The ResizeObserver also fires on mobile address-bar show/hide, which
    // changes nothing about the page box. Rebuilding then is wasted work.
    if(W === lastW && H === lastH) return;
    lastW = W; lastH = H;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.height = H + 'px';
    while(svg.firstChild) svg.removeChild(svg.firstChild);

    // Content column edges — the wiring hugs just outside them.
    const col = Math.min(1100, W - 34);
    const pad = Math.max(18, (W - col) / 2 - 34);
    const rows = Math.max(6, Math.round(H / 420));
    const el = (t, a) => { const n = document.createElementNS(NS, t);
      for(const k in a) n.setAttribute(k, a[k]); return n; };

    for(const side of [0, 1]){
      const base = side ? W - pad : pad, dir = side ? -1 : 1;
      const pts = [];
      for(let i = 0; i <= rows; i++){
        const y = (H / rows) * i;
        // meander in and out so the strand feels organic, not ruled
        pts.push([base + dir * Math.sin(i * 1.15 + side * 2) * 26, y]);
      }
      let d = `M${pts[0][0].toFixed(0)} 0`;
      for(let i = 1; i < pts.length; i++){
        const [x0, y0] = pts[i-1], [x1, y1] = pts[i], my = (y0 + y1) / 2;
        d += ` C${x0.toFixed(0)} ${my.toFixed(0)} ${x1.toFixed(0)} ${my.toFixed(0)} ${x1.toFixed(0)} ${y1.toFixed(0)}`;
      }
      svg.appendChild(el('path', {class:'wn-e', d, stroke:`rgba(${GLITCH[2]},.22)`}));

      pts.forEach(([x, y], i) => {
        if(i === 0 || i === pts.length - 1) return;
        const c = GLITCH[i % GLITCH.length];
        // a short branch reaching in toward the content
        const bx = x + dir * (34 + (i % 3) * 16);
        svg.appendChild(el('path', {class:'wn-e',
          d:`M${x.toFixed(0)} ${y.toFixed(0)} C${(x + dir*22).toFixed(0)} ${(y-14).toFixed(0)} ${(bx-dir*10).toFixed(0)} ${(y-22).toFixed(0)} ${bx.toFixed(0)} ${(y-26).toFixed(0)}`,
          stroke:`rgba(${c},.2)`}));
        svg.appendChild(el('circle', {class:'wn-n', cx:bx.toFixed(0), cy:(y-26).toFixed(0), r:2,
          fill:`rgba(${c},.6)`, style:`animation:wnpulse ${(3.4 + i%4*.5).toFixed(1)}s ease-in-out ${(-i*.7).toFixed(1)}s infinite`}));
        // every third junction is a chain link
        if(i % 3 === 0){
          svg.appendChild(el('rect', {class:'wn-b', x:(x-5).toFixed(0), y:(y-5).toFixed(0),
            width:10, height:10, rx:2.5, transform:`rotate(45 ${x.toFixed(0)} ${y.toFixed(0)})`,
            stroke:`rgba(${c},.55)`, fill:`rgba(${c},.12)`}));
        } else {
          svg.appendChild(el('circle', {class:'wn-n', cx:x.toFixed(0), cy:y.toFixed(0), r:2.4,
            fill:`rgba(${c},.5)`}));
        }
      });
    }
  }
  const sched = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(build); };
  addEventListener('resize', sched);
  addEventListener('load', sched);
  new ResizeObserver(sched).observe(document.querySelector('.page'));
  sched();
}();

// Fade-in observer.
// Dieser Block hat die Seite auf dem Handy "kaputt" aussehen lassen: alle 45
// .fi-Elemente stehen auf opacity:0, bis der Observer sie freigibt — und der
// laeuft erst, wenn der Parser das Ende dieses 130-KB-Dokuments erreicht hat.
// Bis dahin war unterhalb des Heros nur Schwarz. Drei Aenderungen:
//   - rootMargin: freigeben, BEVOR das Element in den Blick kommt, statt erst
//     bei 8% Sichtbarkeit. Man scrollt jetzt nie in leere Flaechen hinein.
//   - unobserve nach dem Einblenden: jedes Element wird nur einmal gebraucht.
//   - Sicherheitsnetz: fehlt der IntersectionObserver oder geht sonst etwas
//     schief, ist nach spaetestens 5s garantiert alles sichtbar. Eine Seite
//     darf nie dauerhaft unsichtbaren Inhalt haben.
!function(){
  // Kein IntersectionObserver oder schon gescrollt? Dann gar nichts
  // verstecken — lieber ohne Effekt als mit leeren Flaechen. Wer bereits
  // scrollt, wuerde sonst Inhalt verschwinden sehen.
  if(!('IntersectionObserver'in window)||scrollY>0)return;
  const vh=innerHeight;
  // Nur was sicher unter dem Bildrand liegt. Alles Sichtbare bleibt sichtbar.
  const hidden=[...document.querySelectorAll('.fi')]
    .filter(el=>el.getBoundingClientRect().top>vh*1.1);
  hidden.forEach(el=>el.classList.add('pre'));
  const ob=new IntersectionObserver(e=>e.forEach(x=>{
    if(x.isIntersecting){x.target.classList.remove('pre');ob.unobserve(x.target)}
  }),{rootMargin:'400px 0px',threshold:0});
  hidden.forEach(el=>ob.observe(el));
  // Sicherheitsnetz: nach 5s ist garantiert nichts mehr versteckt.
  setTimeout(()=>hidden.forEach(el=>el.classList.remove('pre')),5000);
}();

// Shimmer nur auf dem, was gerade sichtbar ist. Der Effekt animiert
// background-position und laeuft damit zwingend auf dem Main-Thread — bei 21
// Elementen gleichzeitig kostet das dauerhaft Rechenzeit, auch fuer die 19,
// die gerade niemand sieht. Sichtbar bleibt der Effekt derselbe.
// Ohne IntersectionObserver (sehr alte Browser) laeuft er ueberall, wie frueher.
!function(){
  const els=document.querySelectorAll('.sh h2 em,.tc .b');
  if(!('IntersectionObserver'in window)){els.forEach(e=>e.classList.add('shim-on'));return}
  const so=new IntersectionObserver(es=>es.forEach(x=>x.target.classList.toggle('shim-on',x.isIntersecting)),
    {rootMargin:'80px'});
  els.forEach(e=>so.observe(e));
}();

// === ON-CHAIN DATA ===
const BOBAI='0x245c386dcfed896f5c346107596141e5edcbffff',BW='0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce',BOB='0x51363f073b1e4920fda7aa9e9d84ba97ede1560e',
      DEVW='0x15Ba17075ef5E0736292b030e3715d9100fe3d38',RPC='https://bsc-dataseed.binance.org/';
// Log fetch: same-origin proxy first, then the bot's own log domain, then the bundled copy
// Kein '?t='+Date.now() mehr. Der Zusatz machte jede URL einmalig und damit
// jedes Caching unmoeglich — burns.json (~88 KB) kam so bei jedem Aufruf und
// jedem Aktualisieren komplett neu. Die Frische regelt jetzt der Server:
// /logs/* liefert max-age=120 (der Bot schreibt nur alle 10 Minuten), die
// statische Reserve max-age=0 + must-revalidate, also 304 statt 88 KB.
async function gj(n){let r=null;
  try{r=await fetch('/logs/'+n)}catch(e){}
  if(!r||!r.ok){try{r=await fetch('https://logs.brainonbnb.com/logs/'+n)}catch(e){}}
  if(!r||!r.ok){try{r=await fetch('/'+n)}catch(e){}}
  return(r&&r.ok)?r.json():null}
// All nine reads below are independent — none ever needed a previous result —
// so issuing them one await at a time only ever bought round trips: ten of them,
// which on a phone at ~200ms RTT meant two seconds before the stat tiles filled.
// JSON-RPC batching puts the whole lot in a single POST.
const WBNB='0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      P='0x6eadd4cb786898b34929444988380ed0cc6fd9a6',   // BOBAI/WBNB pair
      BP='0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16',  // WBNB price pair — fallback only
      // Chainlink BNB/USD (8 decimals). The single source of truth for the BNB
      // price across the whole project: the buyback bot, the buy alerts and the
      // bot's /liq command all read this feed. Deriving it from a DEX pool here
      // instead put the page 0.055% away from the bot on the same block — two
      // answers to one question, which is one answer too many. The pool stays as
      // a fallback so a feed hiccup cannot blank the page.
      BNBFEED='0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
      // PancakeSwap's own protocol-fee address — the factory's feeTo(). The
      // pair mints LP to it on every liquidity event, which is where the
      // never-burned remainder comes from and why it grows as the pool trades.
      // Hardcoded, but never trusted: the line below only names it when its
      // balance actually accounts for the remainder, so if PancakeSwap ever
      // moves the address the page falls back to saying less instead of
      // saying something wrong.
      FEETO='0x0ed943Ce24BaEBf257488771759F9BF482C39706',
      DEAD_BAL='0x70a08231000000000000000000000000000000000000000000000000000000000000dEaD',
      balOf=a=>'0x70a08231000000000000000000000000'+a.slice(2),
      call=(to,data)=>['eth_call',[{to,data},'latest']],
      u18=h=>(h&&h!=='0x')?Number(BigInt(h))/1e18:0;
async function rpcBatch(calls){
  const r=await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(calls.map((c,i)=>({jsonrpc:'2.0',id:i,method:c[0],params:c[1]})))});
  const j=await r.json(),out=[];
  // Responses may come back in any order — index them by the id we sent.
  if(Array.isArray(j))for(const x of j)out[x.id]=x.result;
  return out;
}
// Burn figures are written out in full — the exact number is the point on a
// transparency dashboard. The stat tile's font size shrinks to fit instead.
// Every figure on the page is formatted en-US, the same way BscScan prints token
// amounts (75,927.92 — comma for thousands, dot for decimals). Leaving the locale
// to the browser meant a German visitor read "1.069 LP" where 1,069 was meant,
// which on an English page is not a cosmetic difference but a different number.
const nf=(n,d=0)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
function setBig(id,v,sym){put(id,nf(v)+' '+sym)}
// Setzt einen Wert und nimmt dem Feld gleichzeitig den "laedt"-Zustand.
function put(id,txt){const e=document.getElementById(id);if(!e)return;
  e.textContent=txt;e.classList.remove('ld')}
async function chain(){
  let q;
  try{
    q=await rpcBatch([
      ['eth_getBalance',[BW,'latest']],   // 0 buyback wallet, native
      call(WBNB,balOf(BW)),               // 1 buyback wallet, wrapped
      call(BOB,DEAD_BAL),                 // 2 BOB burned
      call(BOBAI,DEAD_BAL),               // 3 BOBAI burned
      call(P,'0x0902f1ac'),               // 4 BOBAI/WBNB reserves
      call(P,'0x0dfe1681'),               // 5 BOBAI/WBNB token0
      call(BP,'0x0902f1ac'),              // 6 BNB price reserves
      call(BP,'0x0dfe1681'),              // 7 BNB price token0
      call(BOBAI,balOf(BOBAI)),           // 8 tax queued in the contract
      call(P,'0x18160ddd'),               // 9 LP total supply
      call(P,DEAD_BAL),                   // 10 LP held at the dead address
      call(P,balOf(BW)),                  // 11 LP still held by the buyback bot
      call(P,balOf(DEVW)),                // 12 LP still held by the dev wallet
      call(P,balOf(FEETO)),               // 13 LP minted to PancakeSwap as protocol fee
      call(BNBFEED,'0x50d25bcd'),         // 14 Chainlink BNB/USD, latestAnswer()
    ]);
  }catch(e){return}
  // Each tile decodes in its own try/catch so one bad word of calldata can't
  // blank the rest of the bar.
  try{put('wallet-bnb',(u18(q[0])+u18(q[1])).toFixed(4)+' BNB')}catch(e){}
  try{const v=u18(q[2]);if(v>0)setBig('total-burned',v,'BOB')}catch(e){}
  let bAmt=0;
  try{const v=u18(q[3]);if(v>0){bAmt=v;setBig('total-bobai-burned',v,'BOBAI');
    const pct=document.getElementById('supply-burned-pct');if(pct)pct.textContent=(v/1e9*100).toFixed(1)+'%'}}catch(e){}
  try{
    const rH=q[4],r0=BigInt('0x'+rH.slice(2,66)),r1=BigInt('0x'+rH.slice(66,130)),
      is0=('0x'+q[5].slice(26).toLowerCase())===BOBAI,bR=is0?r0:r1,wR=is0?r1:r0,
      bH=q[6],b0=BigInt('0x'+bH.slice(2,66)),b1=BigInt('0x'+bH.slice(66,130)),
      w0=('0x'+q[7].slice(26).toLowerCase())===WBNB.toLowerCase(),
      bnbFeed=(()=>{try{const v=Number(BigInt(q[14]))/1e8;return v>0?v:0}catch(e){return 0}})(),
      // Feed first, pool second. A sane band around it, because a wrong BNB price
      // would quietly move every dollar figure on the page.
      bnbP=(bnbFeed>50&&bnbFeed<5000)?bnbFeed:Number(w0?b1:b0)/Number(w0?b0:b1),
      pU=(Number(wR)/Number(bR))*bnbP,
      circ=1e9-bAmt;
    put('mcap','$'+nf(pU*circ));
    put('volume','$'+nf((Number(wR)/1e18)*bnbP*2));
    const pend=u18(q[8]),tp=document.getElementById('tax-pending');
    // Cents below a thousand dollars. Whole dollars turned $2.35 of queued tax
    // into "≈$2", which reads as a rounding the page could not be bothered to do.
    const pendUsd=pend*pU;
    if(tp)tp.textContent=pend>=1
      ?'+ '+nf(pend)+' $BOBAI tax queued (≈$'+nf(pendUsd,pendUsd>=1000?0:2)+')':'';
    window.__bobaiPx=pU;window.__tgPoolRender&&window.__tgPoolRender();
    depth(bR,wR,bnbP,pU*circ);
  }catch(e){}
  // LP lock lives in its own try: it reads two extra words of the same batch, and
  // a hiccup there must not blank the depth figures decoded above.
  try{
    const tot=Number(BigInt(q[9])),dead=Number(BigInt(q[10]));
    if(tot>0)put('lq-lp',(dead/tot*100).toFixed(3)+'%');
    window.__lpDead=dead/1e18;sources();
    // THE OTHER SIDE OF THE BURN FIGURE.
    // "99.998% burned" says what is locked; it says nothing about the rest, and
    // the rest is the part worth checking — LP still held by a project wallet
    // could be pulled. Both are read live, so this cannot go stale: if either
    // wallet ever sits on LP, the line says so on the next refresh instead of
    // staying silent.
    const un=(tot-dead)/1e18,botLeft=u18(q[11]),devLeft=u18(q[12]),fee=u18(q[13]),
      el=document.getElementById('lq-unb');
    if(el&&tot>0){
      const held=botLeft+devLeft,pct=((tot-dead)/tot*100).toFixed(3);
      // Naming where it sits beats saying only where it does not. The whole
      // remainder is PancakeSwap's protocol fee: the pair mints it to the
      // exchange whenever liquidity moves, so the figure creeps up as the pool
      // trades and "LP burned" drifts a thousandth away from 100% by itself.
      // Only said when the balance really accounts for it — within a hundredth
      // of an LP, which is the rounding on the printed figure.
      const isFee=fee>0&&Math.abs(fee-un)<0.01;
      el.textContent=held>0.000001
        ? nf(un,2)+' LP ('+pct+'%) is not burned, and '+nf(held,4)+
          ' LP of it sits in a project wallet right now.'
        : isFee
        ? 'The other '+nf(un,2)+' LP ('+pct+'%) was never burned: it is PancakeSwap’s own '+
          'protocol fee, minted to the exchange every time liquidity moves, which is why it '+
          'creeps up as the pool trades. None of it is ours — the buyback bot and the dev '+
          'wallet both hold exactly 0 LP. Checked on every refresh, not claimed once.'
        : 'The other '+nf(un,2)+' LP ('+pct+
          '%) was never burned, and none of it is ours: the buyback bot and the dev wallet '+
          'both hold exactly 0 LP. Checked on every refresh, not claimed once.';
      el.classList.remove('ld');
    }
  }catch(e){}
}
// WHERE THE LOCKED LIQUIDITY COMES FROM.
// A full scan of every LP transfer into the dead address (blocks 88990359 to
// 115088761) found exactly three origins, and they sum to the on-chain balance to
// the decimal: the launch mint, the dev wallet, and the buyback bot. Nobody else
// has ever locked LP here.
//
// The launch mint is one event in the past and can never change, so it is the
// fixed number, and the dev total is derived as the remainder. That inverts the
// old arrangement for a reason: the dev figure used to come from a hand-kept file
// and went stale between runs, whereas a remainder against the live dead balance
// is right the moment the next run lands, with nothing to redeploy. The bot keeps
// its own log — cross-checked against the scan, it agreed exactly.
let botLp=null,srcMeta=null;
function sources(){
  const total=window.__lpDead;
  if(!(total>0)||!srcMeta)return;
  // Each source carries its share of all locked LP as well: the absolute figure
  // alone means nothing until you know how big the locked pile is.
  const card=(id,v)=>{
    put(id,nf(v)+' LP');
    const p=document.getElementById(id+'-pct');
    if(p)p.textContent=(v/total*100).toFixed(1)+'%';
  };
  const launch=srcMeta.launch.lp;
  card('lq-init',launch);
  if(botLp){
    card('lq-bot',botLp.lp);
    put('lq-bot-sub',botLp.n+' adds across Liquidity Boost I and II. Runs on its own, every cycle.');
    const dev=total-launch-botLp.lp;
    if(dev>0){
      card('lq-man',dev);
      put('lq-man-sub',(srcMeta.dev.burns+(srcMeta.runs||[]).length)+
        ' adds. Collected tax, swapped and added by hand.');
    }
  }
}
// The bot writes one entry per add — count them and sum the LP it burned.
function bbsrc(b){try{
  if(!Array.isArray(b)||!b.length)return;
  const lpSum=b.reduce((s,x)=>s+parseFloat(x.lpBurned||0),0);
  botLp={n:b.length,lp:lpSum};
  sources();
}catch(e){}}
// Carries the scan result: the fixed launch mint plus the burn counts, which are
// the only part a live read cannot supply.
function mansrc(j){try{
  if(!j||!j.launch||!j.dev)return;
  srcMeta=j;sources();
}catch(e){}}
// LIQUIDITY DEPTH — the pool stated the way a buyer actually experiences it.
// "Liquidity $28k" says little on its own: half of that figure is $BOBAI priced
// at its own market price, so it shrinks exactly when it would be needed. The
// BNB half is the part that holds, and it gets its own number rather than a
// footnote. The impact rows answer the question the ratios don't: what does my
// buy do to the price.
//
// Two questions that get confused with each other, so the panel answers both.
//
// IMPACT is how far the trade moves the price: the reserves after the swap
// against the reserves before. The LP fee stays in the pool and counts; the token
// tax never reaches the reserves, so it does not move the price at all.
//
// COST is what the trader gives up against the spot price — the fill is worse
// than spot because the pool moves under it, and on top of that the fee and the
// 3% tax are taken. It is always the larger of the two at small sizes (the toll
// dominates) and the smaller at large ones (a fill averages the path, while the
// price ends up where the path ended).
//
//   buy  cost = 1 − TAX·FEE·rBnb/(rBnb + FEE·dBnb)
//   sell cost = 1 − TAX·FEE·rTok/(rTok + TAX·FEE·dTok)
//
// The opposite reserve cancels out of both. At vanishing size they tend to
// 1 − TAX·FEE ≈ 3.24%, the fixed toll; everything above that is depth.
const LP_FEE=0.9975,TAX=0.97;
const DEPTH_BUYS=[100,150,250,500,1000,2500];
function depth(bR,wR,bnbP,mcap){
  const wbnb=Number(wR)/1e18,bnbSide=wbnb*bnbP,tvl=bnbSide*2;
  if(!(mcap>0)||!(wbnb>0))return;
  put('lq-ratio',(tvl/mcap*100).toFixed(1)+'%');
  put('lq-tvl','$'+nf(tvl));
  put('lq-hard',(bnbSide/mcap*100).toFixed(1)+'%');
  put('lq-bnb',wbnb.toFixed(2)+' BNB');
  // The percentage answers "how big is the floor against the market cap"; the
  // dollar figure answers "how much is actually there". Both, or neither is worth
  // much on its own.
  put('lq-bnb-usd','$'+nf(bnbSide));
  const tok=Number(bR)/1e18,px=(wbnb/tok)*bnbP;
  if(!(px>0))return;
  // The same depth read from the other end. The bars answer "what does $500 do";
  // this answers "what does one percent cost", which is the number a trader sizing
  // a position actually starts from.
  //
  // Constant product: (r + x)(r + FEE*x) = k*r², so FEE*x² + r(1+FEE)x + r²(1−k) = 0
  // and x is the positive root. k = 1.01 for a buy that lifts the price 1%,
  // k = 1/0.99 for a sell that drops it 1%.
  //
  // The buy needs no tax adjustment — BNB going in is never taxed. The sell does:
  // only 97% of the tokens sent ever reach the reserves, so the trader has to send
  // more than the pool math asks for. That, plus the slightly larger k, is the
  // whole reason the sell figure sits above the buy figure.
  const q=1+LP_FEE,
        onePct=(r,k)=>r*((-q+Math.sqrt(q*q+4*LP_FEE*(k-1)))/(2*LP_FEE)),
        money=v=>'$'+nf(v,v>=1000?0:2);
  // Hold the live reserves so the depth selector can re-run the same maths
  // against a deeper pool without refetching anything.
  LQ={wbnb,tok,bnbP,px,onePct,money,max:0};
  LQ.max=Math.max(...tradeRows(wbnb,tok,bnbP,px).map(r=>Math.max(r.buyMove,Math.abs(r.sellMove))));
  paintTrade();
}

function tradeRows(wbnb,tok,bnbP,px){
  return DEPTH_BUYS.map(u=>{
    // Buy: BNB in, tokens out. Only the fee-reduced input reaches the curve.
    const dB=u/bnbP,effB=dB*LP_FEE,outB=(tok*effB)/(wbnb+effB);
    // Sell: tokens in, already 3% lighter by the time the pair sees them.
    const dT=u/px,effT=dT*TAX*LP_FEE,outS=(wbnb*effT)/(tok+effT);
    return {
      buyMove:(((wbnb+dB)/(tok-outB))/(wbnb/tok)-1)*100,
      buyCost:(1-TAX*LP_FEE*wbnb/(wbnb+effB))*100,
      sellMove:(((wbnb-outS)/(tok+dT*TAX))/(wbnb/tok)-1)*100,
      sellCost:(1-TAX*LP_FEE*tok/(tok+effT))*100,
    };
  });
}

// "What if the pool were deeper" — the one question the panel could not answer.
// A liquidity add grows BOTH sides in the same ratio, so the price is untouched
// and the multiplier applies to each reserve. Only the trade figures move; the
// tiles above (pool value, LP burned, ratios) describe the pool that actually
// exists and must never follow the selector.
let LQ=null,LQMUL=1;
function paintTrade(){
  if(!LQ)return;
  const m=LQMUL,wbnb=LQ.wbnb*m,tok=LQ.tok*m,{bnbP,px,onePct,money}=LQ,sim=m>1;
  put('lq-up1',money(onePct(wbnb,1.01)*bnbP));
  put('lq-dn1',money(onePct(tok,1/0.99)/TAX*px));
  // The sub-labels literally read "right now" — false the moment a multiplier is
  // picked, so they get rewritten rather than left to contradict the figure.
  put('lq-up1s',sim?'a buy this size, if the pool were '+m+'× deeper'
                   :'a buy this size, right now');
  put('lq-dn1s',sim?'a sell this size, if the pool were '+m+'× deeper — still above the buy figure, because 3% of the tokens never reach the pool'
                   :'a sell this size, right now — above the buy figure, mostly because 3% of the tokens never reach the pool');
  put('lq-simn',sim?'Hypothetical — the pool is not '+m+'× deeper. Only these trade figures are simulated; everything above stays the real pool. The bars keep the live scale, so deeper reads as shorter.':'');
  const box=document.querySelector('.lqi');if(box)box.classList.toggle('sim',sim);
  // One scale across both columns, otherwise the two sides cannot be compared by
  // eye — which is the entire point of putting them next to each other. The scale
  // stays pinned to the live pool, so a deeper pool visibly shortens every bar
  // instead of silently rescaling back to full length.
  const rows=tradeRows(wbnb,tok,bnbP,px),max=LQ.max;
  rows.forEach((r,i)=>{
    const n=i+1;
    put('lq-bm'+n,'+'+r.buyMove.toFixed(2)+'%');
    put('lq-sm'+n,r.sellMove.toFixed(2)+'%');
    const bc=document.getElementById('lq-bc'+n);if(bc)bc.textContent='costs '+r.buyCost.toFixed(2)+'%';
    const sc=document.getElementById('lq-sc'+n);if(sc)sc.textContent='costs '+r.sellCost.toFixed(2)+'%';
    // A deep simulation squeezes the small rows toward zero — at 10x the $100 bar
    // came out 1.07px on a phone, which reads as broken rather than as tiny. Floor
    // it at 2px whenever the value isn't actually zero. The exact figure sits right
    // next to the bar, so nothing is overstated by the floor; it only separates
    // "almost nothing" from "nothing at all".
    const set=(id,v)=>{const el=document.getElementById(id);if(!el)return;
      let s=max>0?Math.abs(v)/max:0;
      const track=el.parentElement?el.parentElement.clientWidth:0;
      if(s>0&&track>0)s=Math.max(s,2/track);
      el.style.transform='scaleX('+s.toFixed(4)+')'};
    set('lq-bw'+n,r.buyMove);set('lq-sw'+n,r.sellMove);
  });
}
// Delegated, so it cannot race the first paint or the fetch that feeds it.
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('.lqsim-b');if(!b)return;
  LQMUL=Number(b.dataset.mul)||1;
  document.querySelectorAll('.lqsim-b').forEach(x=>{
    x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',x===b);
  });
  paintTrade();
});
// The burn log is 900+ rows, but .txw is a 400px scroll box — painting all of
// them up front cost ~4600 DOM nodes nobody ever sees. Render a screenful and
// append the next chunk as the reader scrolls toward the end. If the wrapper
// isn't there for some reason we fall back to rendering everything, so this can
// never silently swallow rows.
const TX_CHUNK=60;
function paintRows(id,rows){
  const body=document.getElementById(id);if(!body)return;
  const wrap=body.closest('.txw');
  if(body.__more&&wrap)wrap.removeEventListener('scroll',body.__more);
  body.__more=null;
  if(!wrap||rows.length<=TX_CHUNK){body.innerHTML=rows.join('');return}
  let n=TX_CHUNK;
  body.innerHTML=rows.slice(0,n).join('');
  const more=()=>{
    if(wrap.scrollTop+wrap.clientHeight<wrap.scrollHeight-240)return;
    body.insertAdjacentHTML('beforeend',rows.slice(n,n+TX_CHUNK).join(''));
    n+=TX_CHUNK;
    if(n>=rows.length){wrap.removeEventListener('scroll',more);body.__more=null}
  };
  body.__more=more;
  wrap.addEventListener('scroll',more,{passive:true});
}
function bdata(b){try{if(b&&b.length>0){const rows=[];for(const x of[...b].reverse()){const t=new Date(x.time).toISOString().replace('T',' ').slice(0,19)+' UTC',ba=parseFloat(x.bob||x.bobBurned||0),bt2=x.burnTx||x.bobBurnTx;if(ba>0&&bt2)rows.push(`<tr><td>${t}</td><td><span class="tb">BURN BOB</span></td><td>${nf(ba)} BOB</td><td><a class="txl" href="https://bscscan.com/tx/${bt2}" target="_blank" rel="noopener">${bt2.slice(0,10)}...${bt2.slice(-6)}</a></td></tr>`);const aa=parseFloat(x.bobaiBurned||0),at=x.bobaiBurnTx;if(aa>0&&at)rows.push(`<tr><td>${t}</td><td><span class="tba">BURN BOBAI</span></td><td>${nf(aa)} BOBAI</td><td><a class="txl" href="https://bscscan.com/tx/${at}" target="_blank" rel="noopener">${at.slice(0,10)}...${at.slice(-6)}</a></td></tr>`);if(x.bobaiNote)rows.push(`<tr><td>${t}</td><td><span class="tba" style="opacity:.5">BURN BOBAI</span></td><td style="opacity:.5">failed</td><td style="opacity:.5">${x.bobaiNote}</td></tr>`);if(x.bobaiCreatorTx)rows.push(`<tr><td>${t}</td><td><span class="tcr">CREATOR</span></td><td>${parseFloat(x.bobaiBurnBnb).toFixed(4)} BNB</td><td><a class="txl" href="https://bscscan.com/tx/${x.bobaiCreatorTx}" target="_blank" rel="noopener">${x.bobaiCreatorTx.slice(0,10)}...${x.bobaiCreatorTx.slice(-6)}</a></td></tr>`);if(x.creatorTx)rows.push(`<tr><td>${t}</td><td><span class="tcr">CREATOR</span></td><td>${parseFloat(x.creatorBnb).toFixed(4)} BNB</td><td><a class="txl" href="https://bscscan.com/tx/${x.creatorTx}" target="_blank" rel="noopener">${x.creatorTx.slice(0,10)}...${x.creatorTx.slice(-6)}</a></td></tr>`)}put('burn-count',b.length.toString());paintRows('tx-body',rows)}}catch(e){}}
// The three log files used to be fetched in a serial then-chain — and
// bobai-liq-log.json twice over, once for each campaign card. One parallel
// round of fetches, each file read exactly once.
// The logs used to be fetched only on every tenth tick, i.e. every five
// minutes. Combined with the server cache (two minutes fresh, then up to ten
// more minutes of "serve the old copy and refetch in the background") a fresh
// burn could stay off the page for a quarter of an hour — which is exactly what
// "the page doesn't update itself any more" looked like.
// Now on every tick. That costs nothing: the server attaches a fingerprint to
// each file and, as long as nothing changed, answers with an empty "not
// modified" instead of the full 88 KB.
// liq-boost-log.json is the finished $BOB archive from June and never changes
// again — it is fetched exactly once, at load.
async function logs(){
  const [burns,bb]=await Promise.all([gj('burns.json'),gj('bobai-liq-log.json')]);
  bdata(burns);bbdata(bb);bb2data(bb);bbsrc(bb);
}
// Static file, appended once per manual run: read once at load, and fetched
// directly rather than through gj() — that helper probes the log worker first,
// which would cost two 404s per page load for a file the worker never serves.
fetch('liq-runs.json').then(r=>r.ok?r.json():null).then(mansrc).catch(()=>{});
gj('liq-boost-log.json').then(lbdata);
let busy=false;
async function go(){
  if(busy)return;busy=true;
  try{
    await Promise.all([chain(),logs()]);
    const el=document.getElementById('last-update');
    if(el)el.textContent='Updated '+new Date().toISOString().replace('T',' ').slice(0,19)+' UTC';
  }finally{busy=false}
}
go();setInterval(go,30000);
// On a phone the page spends most of its life in the background: screen off,
// app switched, another tab. Browsers freeze timers then — and since the HTML
// is allowed into the back/forward cache, returning to the page can even bring
// it back wholesale from memory, frozen on the numbers from before. From the
// outside both look identical: "it stopped updating, I have to reload". So the
// moment it becomes visible again, refetch. The guard keeps the two events
// from firing the same round twice.
let lastWake=0;
function wake(){const n=Date.now();if(n-lastWake<5000)return;lastWake=n;go()}
addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')wake()});
addEventListener('pageshow',e=>{if(e.persisted)wake()});

// === LIQ BOOST DATA ===
function lbdata(entries){try{if(!entries||entries.length===0)return;document.getElementById('lb-count').textContent=entries.length;let totalBnb=0;let totalLp=0;const rows=[];for(const x of[...entries].reverse()){const t=new Date(x.time).toISOString().replace('T',' ').slice(0,19)+' UTC';const bnb=parseFloat(x.bnb||0);totalBnb+=bnb;const lp=x.lpBurned||'--';if(lp!=='--')totalLp+=parseFloat(lp);const tx=x.addLiqTx||'';rows.push('<tr><td>'+t+'</td><td>'+bnb.toFixed(4)+' BNB</td><td>'+(lp==='--'?'--':nf(lp,4))+'</td><td>'+(tx?'<a class="txl" href="https://bscscan.com/tx/'+tx+'" target="_blank" rel="noopener">'+tx.slice(0,10)+'...'+tx.slice(-6)+'</a>':'--')+'</td></tr>')}document.getElementById('lb-bnb').textContent=totalBnb.toFixed(4)+' BNB';document.getElementById('lb-lp').textContent=nf(totalLp,2);paintRows('lb-tx-body',rows)}catch(e){console.error('lbdata error:',e)}}

// === BOBAI LIQ BOOST DATA ===
// One log file, two campaigns: everything before BB2_START belongs to round one (the
// archive card, frozen at its final numbers), everything after to the live boost II card.
const BB2_START=new Date('2026-08-08T00:00:00Z').getTime();
const BB2_END=new Date('2026-09-16T23:59:59Z').getTime();
function bbdata(all){try{if(!all||all.length===0)return;const entries=all.filter(x=>new Date(x.time).getTime()<BB2_START);if(entries.length===0)return;document.getElementById('bb-count').textContent=entries.length;let totalBnb=0;let totalLp=0;const rows=[];for(const x of[...entries].reverse()){const t=new Date(x.time).toISOString().replace('T',' ').slice(0,19)+' UTC';const bnb=parseFloat(x.bnb||0);totalBnb+=bnb;const lp=x.lpBurned||'--';if(lp!=='--')totalLp+=parseFloat(lp);const tx=x.addLiqTx||'';rows.push('<tr><td>'+t+'</td><td>'+bnb.toFixed(4)+' BNB</td><td>'+(lp==='--'?'--':nf(lp,4))+'</td><td>'+(tx?'<a class="txl" href="https://bscscan.com/tx/'+tx+'" target="_blank" rel="noopener">'+tx.slice(0,10)+'...'+tx.slice(-6)+'</a>':'--')+'</td></tr>')}document.getElementById('bb-bnb').textContent=totalBnb.toFixed(4)+' BNB';document.getElementById('bb-lp').textContent=nf(totalLp,2);paintRows('bb-tx-body',rows)}catch(e){console.error('bbdata error:',e)}}

// === BOBAI LIQ BOOST II DATA (live campaign) ===
function bb2data(all){try{if(!all)return;const entries=all.filter(x=>{const t=new Date(x.time).getTime();return t>=BB2_START&&t<=BB2_END});const cEl=document.getElementById('bb2-count');if(!cEl)return;cEl.textContent=entries.length;let totalBnb=0;let totalLp=0;const rows=[];for(const x of[...entries].reverse()){const t=new Date(x.time).toISOString().replace('T',' ').slice(0,19)+' UTC';const bnb=parseFloat(x.bnb||0);totalBnb+=bnb;const lp=x.lpBurned||'--';if(lp!=='--')totalLp+=parseFloat(lp);const tx=x.addLiqTx||'';rows.push('<tr><td>'+t+'</td><td>'+bnb.toFixed(4)+' BNB</td><td>'+(lp==='--'?'--':nf(lp,4))+'</td><td>'+(tx?'<a class="txl" href="https://bscscan.com/tx/'+tx+'" target="_blank" rel="noopener">'+tx.slice(0,10)+'...'+tx.slice(-6)+'</a>':'--')+'</td></tr>')}document.getElementById('bb2-bnb').textContent=totalBnb.toFixed(4)+' BNB';document.getElementById('bb2-lp').textContent=nf(totalLp,2);if(rows.length)paintRows('bb2-tx-body',rows)}catch(e){console.error('bb2data error:',e)}}

// === THE LIBRARY: copy buttons and the in-page code viewer ===
// Reading the code should not cost a download. The viewer fetches the bundle's
// flattened .txt — the same file the curl line hands to an AI, so there is one
// artifact to keep correct instead of two — splits it back into files and shows
// them. Everything here is an enhancement: with the script dead, the download
// and plain-text links in the document still work.
!function(){
  const lib=document.getElementById('library');if(!lib)return;

  function flash(btn,text){const old=btn.textContent;btn.textContent=text;btn.classList.add('done');
    setTimeout(()=>{btn.textContent=old;btn.classList.remove('done')},1400)}
  // navigator.clipboard is https-only and absent in a few in-app browsers; the
  // textarea fallback is what makes the button work inside Telegram and X.
  function copy(text,btn){
    const done=()=>flash(btn,'copied');
    if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(text).then(done,()=>fallback(text,done));return}
    fallback(text,done);
  }
  function fallback(text,done){
    const ta=document.createElement('textarea');ta.value=text;
    ta.style.cssText='position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');done()}catch(e){}
    document.body.removeChild(ta);
  }

  // --- the .txt bundle, back into files -------------------------------------
  function parse(txt){
    const parts=txt.split(/\n={70,}\n=== FILE: /);
    return parts.slice(1).map(p=>{
      const nl=p.indexOf('\n');
      return {path:p.slice(0,nl).trim(), body:p.slice(nl+1).replace(/^={70,}\n\n?/,'').replace(/\n+$/,'')};
    });
  }

  // --- highlighting ---------------------------------------------------------
  // Escaping only &, < and > leaves quotes intact, which is what lets the string
  // rule below match at all. Comment syntax is picked per extension: a single
  // shared rule painted every CSS hex colour as a comment.
  const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const KW='const|let|var|function|return|if|else|for|while|await|async|new|class|extends|import|export|from|try|catch|finally|throw|typeof|instanceof|delete|void|null|true|false|undefined|require|module|this|break|continue|switch|case|default|yield|static|get|set|pragma|contract|interface|library|mapping|address|bool|string|memory|storage|calldata|payable|public|private|external|internal|pure|view|returns|emit|event|modifier|constructor|require|revert|select|insert|update|delete|create|table|policy|grant|alter|drop|where|from|join|on|as|values|primary|key|references|begin|end|declare|def|elif|import|not|and|or';
  const COMMENT={js:'\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*', css:'\\/\\*[\\s\\S]*?\\*\\/',
    sql:'--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/', hash:'#[^\\n]*', html:'&lt;!--[\\s\\S]*?--&gt;'};
  function rules(path){
    const e=(path.split('.').pop()||'').toLowerCase();
    if(e==='html')return COMMENT.html+'|'+COMMENT.js;
    if(e==='css')return COMMENT.css;
    if(e==='sql')return COMMENT.sql;
    if(e==='toml'||e==='py'||e==='yml'||e==='yaml')return COMMENT.hash;
    if(e==='md')return COMMENT.html;
    return COMMENT.js;
  }
  function paint(path,body){
    const src=esc(body);
    const re=new RegExp('('+rules(path)+')|("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)'+
      '|\\b('+KW+')\\b|(\\b0x[0-9a-fA-F]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?\\b)','g');
    return src.replace(re,(m,c,s,k,n)=>
      c?'<span class="c">'+c+'</span>':s?'<span class="s">'+s+'</span>':
      k?'<span class="k">'+k+'</span>':'<span class="n">'+n+'</span>');
  }

  // --- the overlay ----------------------------------------------------------
  let open=null;
  function close(){
    if(!open)return;
    document.removeEventListener('keydown',open.key,true);
    open.el.remove();document.body.style.overflow='';
    open.from&&open.from.focus();open=null;
  }
  async function view(slug,title){
    const el=document.createElement('div');
    el.className='cv';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');
    el.setAttribute('aria-label',title+' — source code');
    el.innerHTML='<div class="cv-w">'+
      '<div class="cv-h"><div><div class="cv-ti"></div><div class="cv-su">loading…</div></div>'+
      '<a class="cv-dl" href="/code/'+slug+'.zip" download>&#x2193; Download .zip</a>'+
      '<button class="cv-x" type="button" aria-label="Close">&#x2715;</button></div>'+
      '<div class="cv-ld">Fetching the bundle…</div></div>';
    el.querySelector('.cv-ti').textContent=title;
    document.body.appendChild(el);document.body.style.overflow='hidden';
    const from=document.activeElement;
    const key=e=>{
      if(e.key==='Escape'){e.preventDefault();close();return}
      if(e.key!=='Tab')return;
      // Focus stays inside: tabbing out of a modal and clicking things behind it
      // is how a dialog turns into a trap of a different kind.
      const f=[...el.querySelectorAll('button,a[href],[tabindex]:not([tabindex="-1"])')]
        .filter(x=>x.offsetParent!==null);
      if(!f.length)return;
      const first=f[0],last=f[f.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    };
    open={el,key,from};
    document.addEventListener('keydown',key,true);
    el.addEventListener('click',e=>{if(e.target===el)close()});
    el.querySelector('.cv-x').addEventListener('click',close);
    el.querySelector('.cv-x').focus();

    let files=[];
    try{
      const r=await fetch('/code/'+slug+'.txt');
      if(!r.ok)throw new Error(r.status);
      files=parse(await r.text());
    }catch(e){
      const ld=el.querySelector('.cv-ld');
      if(ld)ld.innerHTML='Could not load the code here. '+
        '<a class="cv-dl" href="/code/'+slug+'.zip" download>Download the zip instead</a>';
      return;
    }
    if(!open||open.el!==el)return;              // closed again while fetching
    const lines=files.reduce((s,f)=>s+f.body.split('\n').length,0);
    el.querySelector('.cv-su').textContent=files.length+' files · '+
      lines.toLocaleString('en-US')+' lines · MIT · no secrets included';
    const w=el.querySelector('.cv-w');
    el.querySelector('.cv-ld').remove();
    const m=document.createElement('div');
    m.className='cv-m';
    m.innerHTML='<div class="cv-l"></div><div class="cv-r">'+
      '<div class="cv-b"><span class="cv-p"></span><button class="cv-cp" type="button">copy file</button></div>'+
      '<pre class="cv-c"><code></code></pre></div>';
    w.appendChild(m);
    const list=m.querySelector('.cv-l'),code=m.querySelector('.cv-c code'),
          pathEl=m.querySelector('.cv-p'),pre=m.querySelector('.cv-c');
    let cur=0;
    function show(i){
      cur=i;const f=files[i];
      pathEl.textContent=f.path;
      code.innerHTML=paint(f.path,f.body);
      pre.scrollTop=0;pre.scrollLeft=0;
      [...list.children].forEach((b,n)=>b.classList.toggle('on',n===i));
    }
    files.forEach((f,i)=>{
      const b=document.createElement('button');
      b.type='button';b.className='cv-f';
      b.innerHTML='<i>'+f.body.split('\n').length+'</i>';
      b.insertBefore(document.createTextNode(f.path),b.firstChild);
      b.addEventListener('click',()=>show(i));
      list.appendChild(b);
    });
    m.querySelector('.cv-cp').addEventListener('click',e=>copy(files[cur].body,e.currentTarget));
    show(0);
  }

  lib.addEventListener('click',e=>{
    const cp=e.target.closest('.lib-cp');
    if(cp){copy(cp.dataset.copy,cp);return}
    const v=e.target.closest('.lib-view');
    if(v)view(v.dataset.slug,v.dataset.title);
  });
}();

// === WORLDCUP TIPGAME — live prize pool ticker (Supabase wc_pool, anon read) ===
!function(){
  // Same Supabase project + public anon key used by /worldcup/index.html — safe to inline.
  const URL='https://aerffjhdsbxpvuulkryr.supabase.co/rest/v1/wc_pool?id=eq.1&select=total_bobai,bobai_price_usd';
  const KEY='sb_publishable_ne0MFzyCQb6MvFWur2X-Vw_vG9JH76_';
  function fmtBobai(n){
    if(n>=1e9)return(n/1e9).toFixed(2)+'B';
    if(n>=1e6)return(n/1e6).toFixed(2)+'M';
    if(n>=1e3)return(n/1e3).toFixed(1)+'K';
    return Math.round(n).toLocaleString('en-US');
  }
  function fmtUsd(n){
    if(n>=1000)return'$'+Math.round(n).toLocaleString('en-US');
    return'$'+n.toFixed(2);
  }
  // WC26 is settled — the BOBAI amount is a frozen archive snapshot (one read),
  // but the USD equivalent keeps tracking the live GeckoTerminal price (same
  // source as the worldcup app, so both pages show the same USD figure).
  // Fallbacks: on-chain price from chain() (window.__bobaiPx) → stored snapshot.
  let poolTotal=0,snapshotPrice=0,gtPrice=0;
  function render(){
    if(!poolTotal)return;
    const px=(gtPrice>0?gtPrice:(window.__bobaiPx>0?window.__bobaiPx:snapshotPrice));
    const tb=document.getElementById('tg-pool-bobai');
    const tu=document.getElementById('tg-pool-usd');
    if(tb)tb.textContent=fmtBobai(poolTotal)+' BOBAI';
    if(tu)tu.textContent=px>0?fmtUsd(poolTotal*px):'';
  }
  window.__tgPoolRender=render;
  async function load(){
    try{
      const r=await fetch(URL,{headers:{apikey:KEY,Accept:'application/json'}});
      if(!r.ok)return;
      const rows=await r.json();
      const p=Array.isArray(rows)?rows[0]:null;
      if(!p)return;
      poolTotal=parseFloat(p.total_bobai)||0;
      snapshotPrice=parseFloat(p.bobai_price_usd)||0;
      render();
    }catch(_){}
  }
  async function loadGt(){
    try{
      const r=await fetch('https://api.geckoterminal.com/api/v2/networks/bsc/pools/0x6eadd4cb786898b34929444988380ed0cc6fd9a6');
      if(!r.ok)return;
      const j=await r.json();
      const px=parseFloat(j?.data?.attributes?.base_token_price_usd)||0;
      if(px>0){gtPrice=px;render()}
    }catch(_){}
  }
  load();loadGt();setInterval(loadGt,60000);
}();

// === BOBAI LIQ BOOST II COUNTDOWN ===
!function(){
  function tick(){
    const now=Date.now();
    let diff;
    if(now<BB2_START){diff=BB2_END-BB2_START}
    else if(now>=BB2_END){diff=0}
    else{diff=BB2_END-now}
    const d=Math.floor(diff/86400000);
    const h=Math.floor((diff%86400000)/3600000);
    const m=Math.floor((diff%3600000)/60000);
    const dEl=document.getElementById('bb2-days');
    const hEl=document.getElementById('bb2-hours');
    const mEl=document.getElementById('bb2-mins');
    if(dEl)dEl.textContent=d;
    if(hEl)hEl.textContent=h;
    if(mEl)mEl.textContent=m;
  }
  tick();setInterval(tick,60000);
}();

// === TAX ALLOCATION SCHEDULE — phase-aware highlight + inline notes ===
!function(){
  const phases=[
    {id:'liq-boost',     start:0,                                           end:new Date('2026-06-04T23:59:00Z').getTime(), creatorNote:'(−0.5% → $BOB liq add)', bobNote:'(−0.5% → $BOBAI liq add)', creatorPct:'0.5%', bobPct:'0.5%', bobaiPct:'1%'},
    {id:'standard-pre',  start:new Date('2026-06-04T23:59:00Z').getTime(), end:new Date('2026-06-11T00:01:00Z').getTime(), creatorNote:'', bobNote:'(−0.5% → $BOBAI liq add)', creatorPct:'1%', bobPct:'0.5%', bobaiPct:'1%'},
    {id:'wc26',          start:new Date('2026-06-11T00:01:00Z').getTime(), end:new Date('2026-07-19T23:59:00Z').getTime(), creatorNote:'(−0.26% → Prize Pool, −0.25% → $BOBAI liq)', bobNote:'(−0.26% → Prize Pool, −0.5% → $BOBAI liq)', creatorPct:'0.49%', bobPct:'0.24%', bobaiPct:'1%'},
    {id:'standard-bb',   start:new Date('2026-07-19T23:59:00Z').getTime(), end:new Date('2026-08-01T23:59:59Z').getTime(), creatorNote:'(−0.25% → $BOBAI liq add)', bobNote:'(−0.5% → $BOBAI liq add)', creatorPct:'0.75%', bobPct:'0.5%', bobaiPct:'1%'},
    {id:'standard-post', start:new Date('2026-08-01T23:59:59Z').getTime(), end:new Date('2026-08-08T00:00:00Z').getTime(), creatorNote:'', bobNote:'', creatorPct:'1%', bobPct:'1%', bobaiPct:'1%'},
    {id:'bobai-liq-2',   start:new Date('2026-08-08T00:00:00Z').getTime(), end:new Date('2026-09-17T00:01:00Z').getTime(), creatorNote:'', bobNote:'(−0.8% → $BOBAI liq add)', creatorPct:'1%', bobPct:'0.2%', bobaiPct:'1%'},
    {id:'sunshine',      start:new Date('2026-09-17T00:01:00Z').getTime(), end:new Date('2026-11-20T00:01:00Z').getTime(), creatorNote:'', bobNote:'', creatorPct:'1%', bobPct:'1%', bobaiPct:'1%'},
    {id:'standard-final',start:new Date('2026-11-20T00:01:00Z').getTime(), end:Infinity, creatorNote:'', bobNote:'', creatorPct:'1%', bobPct:'1%', bobaiPct:'1%'}
  ];
  // Size the scroll window to exactly: 1 past phase (context) + active + everything upcoming.
  // Capped at MAX_VISIBLE so long schedules stay compact; older phases remain reachable by scrolling.
  // Measured from live row heights so it also works on mobile, where rows wrap to multiple lines.
  const MAX_VISIBLE=5, ROW_GAP=8;
  let scrolledFor=null;
  function fitSchedule(){
    const cont=document.querySelector('.ts-rows');
    if(!cont)return;
    const rows=Array.from(cont.querySelectorAll('.ts-row'));
    const idx=rows.findIndex(r=>r.classList.contains('active'));
    if(idx<0)return;
    const from=Math.max(0,idx-1);
    const shown=rows.slice(from,from+MAX_VISIBLE);
    if(!shown.length)return;
    const h=shown.reduce((s,r)=>s+r.offsetHeight,0)+ROW_GAP*(shown.length-1);
    cont.style.maxHeight=h+'px';
    // Only jump on the first fit / when the phase actually rolls over — never yank a
    // visitor who scrolled back to read earlier phases.
    const id=rows[idx].getAttribute('data-phase');
    if(scrolledFor!==id){cont.scrollTop=rows[from].offsetTop;scrolledFor=id}
  }
  let rzT;
  addEventListener('resize',()=>{clearTimeout(rzT);rzT=setTimeout(fitSchedule,150)});
  addEventListener('load',fitSchedule);
  function apply(){
    const now=Date.now();
    let active=null;
    phases.forEach(p=>{if(now>=p.start&&now<p.end)active=p});
    document.querySelectorAll('.ts-row').forEach(r=>{
      const id=r.getAttribute('data-phase');
      const ph=phases.find(p=>p.id===id);
      r.classList.remove('active','past');
      if(active&&id===active.id)r.classList.add('active');
      else if(ph&&now>=ph.end)r.classList.add('past');
    });
    if(active)fitSchedule();
    const cN=document.getElementById('ts-inline-creator');
    const bN=document.getElementById('ts-inline-bob');
    if(cN){cN.textContent=active?active.creatorNote:'';cN.classList.toggle('active',!!(active&&active.creatorNote))}
    if(bN){bN.textContent=active?active.bobNote:'';bN.classList.toggle('active',!!(active&&active.bobNote))}
    const pC=document.getElementById('tax-pct-creator');
    const pB=document.getElementById('tax-pct-bob');
    const pA=document.getElementById('tax-pct-bobai');
    if(pC)pC.textContent=active?active.creatorPct:'~1%';
    if(pB)pB.textContent=active?active.bobPct:'~1%';
    if(pA)pA.textContent=active?active.bobaiPct:'~1%';
    // The "How it works" card two rows up used to state a flat ~1/1/1 while the
    // panel right below it showed the campaign split. One page cannot say two
    // things about the same tax, so the card reads from the same schedule.
    const st=document.getElementById('step-split');
    if(st)st.textContent=active?(active.creatorPct+'/'+active.bobPct+'/'+active.bobaiPct):'~1/1/1';
  }
  apply();setInterval(apply,60000);
}();

// ---- Block 05 · Agents -------------------------------------------------
// Fills the agent block from the same endpoint anyone else can call, so the
// page cannot show a figure that endpoint would not confirm. Everything here
// degrades to a plain dash rather than to a zero: "0 requests" is a claim,
// "–" is an unanswered question, and only one of those is honest when the
// service is unreachable.
!function(){
  const el = id => document.getElementById(id);
  if(!el('ag-asked')) return;

  const nf = n => Number(n).toLocaleString('en-US');

  // The footer already had this right: a named link, not a printed URL. The
  // name of the thing IS the link, so there is nothing to read twice and
  // nothing to wrap badly. Only commands stay verbatim — a command you cannot
  // copy character for character is useless.
  const li = (name, desc, w) => {
    const isCmd = w && !/^(https?:\/\/|POST |GET )/i.test(w);
    const url = w && /^(POST|GET)\s+/i.test(w) ? w.replace(/^\w+\s+/, '') : w;
    const head = (url && !isCmd)
      ? `<b><a class="agt-where" href="${url}" rel="noopener">${name}</a></b>`
      : `<b>${name}</b>`;
    return `<li>${head}<span>${desc}</span>${isCmd ? `<code class="agt-cmd">${w}</code>` : ''}</li>`;
  };

  fetch('https://agent.brainonbnb.com/stats', {cache:'no-store'})
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(d => {
      const asked = d.asked && d.asked.total || 0;
      el('ag-asked').textContent = nf(asked);
      // Counting started the day the block shipped; saying "since counting
      // began" without saying when that was invites the reading that the
      // project has only ever had this many requests.
      const days = d.asked && d.asked.by_day ? Object.keys(d.asked.by_day).sort() : [];
      if(days.length) el('ag-asked-sub').textContent = 'since ' + days[0];

      const earned = d.earned && d.earned.totalUsd1 || '0.00';
      el('ag-earned').textContent = earned === '0.00' ? 'none yet' : earned;
      if(earned === '0.00'){
        el('ag-earned').style.fontSize = '1.15rem';
        el('ag-earned-sub').textContent = 'nobody has bought a watch yet';
      } else {
        el('ag-earned-sub').textContent = (d.earned.count||0) + ' payment' +
          ((d.earned.count===1)?'':'s') + ', in USD1';
      }

      el('ag-watch').textContent = nf(d.active_watches || 0);

      // The capability lists and the machine-facing note left the homepage on
      // 2026-09-02 (they live on /services); guarded, so a page without the
      // elements does not throw here and lose the block below.
      const cap = d.capabilities || {};
      const free = (cap.free||[]).map(c => li(c.name, c.what, c.where)).join('');
      const paid = (cap.paid||[]).map(c =>
        li(c.name + ' — ' + (c.price||''), c.what + ' ' + (c.why_paid||''), c.where)).join('');
      if(el('ag-surf')) el('ag-surf').textContent = (cap.free||[]).length || 4;
      if(free && el('ag-free')) el('ag-free').innerHTML = free;
      if(paid && el('ag-paid')) el('ag-paid').innerHTML = paid;

      const note = d.money_flow && d.money_flow.note;
      if(note && el('ag-flow-note')) el('ag-flow-note').textContent = note;
    })
    .then(() => fillLpBlock())
    .then(() => Promise.all([
      // Two sources on purpose, and the same two the Plaza page itself uses.
      // The full scan is the only thing that knows how many endpoints answer
      // and how many operators there are — but it is a photograph, taken by
      // hand every few weeks. The daily tick knows nothing about operators and
      // everything about how far the registry has grown since.
      //
      // Showing the scan's total here while /registry showed the live one made
      // the same figure differ by five thousand between two pages of the same
      // site. One number, one source: the headline is the live high-water mark
      // in both places, and the sub-line says which half came from where.
      fetch('https://agent.brainonbnb.com/census', {cache:'no-store'})
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api-registry.json', {cache:'no-store'})
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]))
    .then(([live, reg]) => {
      // The Brain Plaza tile that used to live here is gone: the marketplace
      // card at the top of this block carries the same number and the same
      // link, and two of each in one block reads as two destinations. The card
      // fills itself from these same two sources, so the figures still agree.
      void live; void reg;
    })
    .catch(() => {
      ['ag-asked','ag-earned','ag-watch'].forEach(i => { el(i).textContent = '–'; });
      el('ag-asked-sub').textContent = 'the counter did not answer just now';
    });
}();

// The liquidity agent's block, on its own so /liquidity can carry it without
// the rest of the agents block. Same rows, same source, same sums.
function fillLpBlock(){
  const el = id => document.getElementById(id);
  return fetch('https://agent.brainonbnb.com/lp/agent', {cache:'no-store'})
    .then(r => r.ok ? r.json() : null).catch(() => null)
    .then(rec => {
        // The liquidity agent's own record: what it holds, whether it is
        // earning right now, and what it has already moved. Sums come from
        // the history of actions, not from a counter anyone could edit.
        const list = el('ag-lp'), noteEl = el('ag-lp-note');
        if(!list) return;
        const item = (i, b, s) => '<li><span class="agt-i">' + i + '</span><div><b>' + b + '</b><span>' + s + '</span></div></li>';
        if(!rec || !rec.last){
          list.innerHTML = item('&middot;', 'No record yet', 'The agent has not run its first tick.');
          return;
        }
        // Plain words. The record's own reasons are written for an operator
        // ("below the 0.002 BNB floor"); a visitor gets the state, not the rule.
        const last = rec.last, st = last.steps || {}, c = st.collect || {}, rb = st.rebalance || {};
        const hist = rec.history || [];
        const sum = (pick) => hist.reduce((a, e) => a + (Number(pick(e)) || 0), 0);
        const swept = sum(e => (Array.isArray(e.steps && e.steps.sweep) ? e.steps.sweep : []).reduce((a, s) => a + (Number(s.received_bnb) || 0), 0));
        const forwarded = sum(e => e.steps && e.steps.collect && e.steps.collect.forwarded_bnb);
        const f = (v, d) => Number(v || 0).toFixed(d);
        const when = String(last.at || '').replace('T', ' ').slice(0, 16) + ' UTC';
        const sweeps = Array.isArray(st.sweep) ? st.sweep : [];
        const waiting = sweeps.filter(s => s.balance > 0).map(s => f(s.balance, 2) + ' ' + (s.token || s.source)).join(' + ');
        const anyError = last.ok === false;
        const rows = [];
        // A hand-triggered run can be narrowed to one step, and a record whose
        // only step is the rebalance still knows the position. Reading it from
        // collect alone showed "No position open" the evening the range was
        // re-set by hand, with the position in range and holding money.
        const pos = c.position || rb.position;
        const inRange = c.in_range != null ? c.in_range : rb.in_range;
        rows.push(item('&#9679;',
          pos ? (inRange === false ? 'The position is out of range — waiting for a re-set' : 'The position is in range and earning') : 'No position open',
          pos ? 'PancakeSwap V3 position #' + pos + (rb.value_bnb != null ? ', worth ' + f(rb.value_bnb, 4) + ' BNB' : '') : ''));
        rows.push(item('&#9679;', 'Fees already sent to the buyback bot: ' + f(forwarded, 5) + ' BNB',
          c.owed ? 'Earned since the last collect: ' + f(c.owed.bnb_equivalent, 6) + ' BNB. Small amounts are left to grow until collecting them beats the gas.' : ''));
        rows.push(item('&#9679;', 'Income already put into the position: ' + f(swept, 5) + ' BNB',
          waiting ? 'Waiting to be moved: ' + waiting + '. It moves once it is worth more than the gas.' : 'Nothing waiting right now.'));
        rows.push(item('&#9679;', last.acted ? 'Last check: it acted' : 'Last check: nothing to do',
          when + (anyError ? '. One step could not finish; the operator has been told.' : '.')));
        list.innerHTML = rows.join('');
        if(noteEl) noteEl.textContent = 'Runs once a day on its own. The capital stays in the position; only the fees leave it.';
      });
}
if(!document.getElementById('ag-asked') && document.getElementById('ag-lp')) fillLpBlock();

// The series: one row per run of the liquidity agent, from /lp/series. The
// summary line answers the question first; the table is the evidence.
function fillLpSeries(){
  const el = id => document.getElementById(id);
  const table = el('ag-lp-series'), sum = el('ag-lp-series-sum');
  if(!table) return;
  const f = (v, d) => (v == null || !isFinite(Number(v))) ? '—' : Number(v).toFixed(d);
  const pct = v => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  fetch('https://agent.brainonbnb.com/lp/series', {cache:'no-store'})
    .then(r => r.ok ? r.json() : null).catch(() => null)
    .then(d => {
      const pts = d && Array.isArray(d.points) ? d.points : [];
      const s = d && d.summary;
      if(!pts.length){ sum.textContent = 'No run recorded yet. The first point lands after the next 05:23 UTC run.'; return; }
      const v = s && s.value_bnb;
      sum.innerHTML = 'Since <b>' + esc(String(s.since).slice(0,10)) + '</b>: ' + s.points + ' run' + (s.points === 1 ? '' : 's') +
        (v && v.start != null ? ', position worth <b>' + f(v.start,4) + ' → ' + f(v.now,4) + ' BNB</b> (' + pct(v.change_pct) + ')' : '') +
        (s.price_move_pct_since_start != null ? ', the pair moved <b>' + pct(s.price_move_pct_since_start) + '</b>' : '') +
        ', in range on <b>' + s.days_in_range + '</b> of ' + s.points + ', fees sent to the buyback bot <b>' + f(s.fees_sent_to_buyback_bnb,5) + ' BNB</b>, income put in <b>' + f(s.income_put_in_bnb,5) + ' BNB</b>.';
      const base = pts.find(p => p.value_bnb != null);
      const head = '<tr><th>Run</th><th>Position</th><th>Worth (BNB)</th><th>Since start</th><th>Range</th><th>Fees owed (BNB)</th><th>Sent to buyback (BNB)</th><th>Income put in (BNB)</th><th>Did</th></tr>';
      const rows = pts.slice().reverse().map(p => {
        const chg = base && p.value_bnb != null && base.value_bnb ? ((p.value_bnb - base.value_bnb) / base.value_bnb) * 100 : null;
        return '<tr><td>' + esc(String(p.at).replace('T',' ').slice(0,16)) + '</td>' +
          '<td>' + (p.position ? '#' + esc(p.position) : '—') + '</td>' +
          '<td>' + f(p.value_bnb,4) + '</td>' +
          '<td class="' + (chg == null ? '' : chg >= 0 ? 'up' : 'down') + '">' + pct(chg) + '</td>' +
          '<td class="' + (p.in_range ? 'up' : p.in_range === false ? 'down' : '') + '">' + (p.in_range ? 'in' : p.in_range === false ? 'out' : '—') + '</td>' +
          '<td>' + f(p.owed_bnb,6) + '</td><td>' + f(p.forwarded_total_bnb,5) + '</td><td>' + f(p.swept_total_bnb,5) + '</td>' +
          '<td>' + (p.ok === false ? 'one step failed' : p.acted ? 'moved money' : 'nothing to do') + '</td></tr>';
      });
      table.innerHTML = head + rows.join('');
    });
}
fillLpSeries();
