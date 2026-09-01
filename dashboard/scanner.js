// SCANNER — the page layer. Every number shown here is produced by
// scanner-chain.js; this file decides only how it is presented and, just as
// importantly, how uncertainty is presented. Two rules run through all of it:
//
//   1. Nothing is rendered as markup from a name a stranger chose. Token names
//      are attacker-controlled strings and a contract can call itself
//      "<img onerror=…>". Everything foreign goes in through a text node.
//   2. Unknown is a state, not a blank. A property GoPlus did not check must
//      read "not checked" — never as an absent warning, which is how a reader
//      hears "fine". $Max returned undefined for is_honeypot and the old build
//      showed nothing at all, which is the most dangerous thing this page
//      could do.
import {RPC,GOPLUS,V2FACTORY,WBNB,BNB_PAIR,DEAD,NULLA,QUOTES,V2_FEE,STEPS,SEL as S,
  balOf,call,hx,addrAt,res2,decStr,rpcBatch,classify,priceToken,discover,
  ladderV2,onePctV2,ladderV3,onePctV3,measureTax,venues,FACTORIES} from './scanner-chain.js?v=15';

const $=id=>document.getElementById(id);
const nf=(n,d=0)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
// toPrecision() switches to exponential notation below 1e-7, which printed a real
// price as "$1.79e-8". Nobody quotes a token price that way. Write it out with
// every zero instead, at three significant digits. Longer, but unambiguous — and
// unlike the subscript-zero style ($0.0₈179) it survives being copied off the page,
// where the subscript silently degrades into an ordinary digit.
// The exponent comes from toExponential() rather than log10(), which is off by one
// for exact powers of ten (log10(0.001) = -3.0000000000000004).
const tiny=n=>{
  if(!(n>0))return Number(n||0).toFixed(2);
  const e=parseInt(n.toExponential(2).split('e')[1],10);
  // toFixed() caps at 100 decimals. Past that the expansion would be all zeros
  // and no significant digit at all, so keep the exponent rather than print a
  // number that reads as zero.
  return e<-98?n.toExponential(2):n.toFixed(Math.max(2,2-e));
};
const usd=n=>n==null?'—':n>=1000?'$'+nf(n):n>=1?'$'+nf(n,2):n>=0.01?'$'+nf(n,4):'$'+tiny(n);
const short=a=>a?a.slice(0,6)+'…'+a.slice(-4):'—';
// What a rebalance costs, said in units of what the position earns rather than
// in dollars — a dollar figure means nothing without the thing it is compared
// against. Rounded to whole windows only when there are whole windows to round
// to: the first version printed "about 0 windows" whenever the fees for one
// window happened to exceed the gas, which is the case this sentence exists to
// describe as GOOD news.
const costInWindows=(cost,fees)=>{
  if(!(cost>0))return 'nothing measurable';
  if(!(fees>0))return 'more than this range collected at all';
  const n=cost/fees;
  if(n>=1.5)return Math.round(n)+' windows of what it collected';
  if(n>=0.75)return 'about one window of what it collected';
  return Math.round(n*100)+'% of what it collected in one window';
};
// Two decimals lie at both ends: 99.998% burned rounds to a flat "100.00%",
// claiming more than the chain says, and a real 0.002% rounds to "0.00%",
// claiming it is not there. A sell tax of 4.45% must never print as "4.5%".
const pc=(v,d=2)=>v==null?'—':v>0&&v<0.01?'<0.01%':(v>=99.995&&v<100)?v.toFixed(3)+'%':v.toFixed(d)+'%';
const signed=v=>v==null?'—':(v<0?'':'+')+(Math.abs(v)<0.005?'0.00':v.toFixed(2))+'%';
function el(tag,cls,text){const e=document.createElement(tag);
  if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function frag(parent,...kids){kids.forEach(k=>parent.append(k));return parent}
const link=(t,href,cls)=>{const a=el('a',cls||'lk',t);a.href=href;a.target='_blank';a.rel='noopener';return a};

function fail(msg,sub){
  const o=$('sc-out');o.hidden=true;o.textContent='';
  const e=$('sc-err');e.hidden=false;e.textContent='';
  e.appendChild(el('b',null,msg));if(sub)e.appendChild(el('span',null,sub));
  $('sc-status').textContent='';
}
function busy(on,msg){
  $('sc-go').disabled=on;$('sc-go').textContent=on?'Reading…':'Scan';
  $('sc-status').textContent=on?(msg||''):'';
}
const step=m=>{if($('sc-go').disabled)$('sc-status').textContent=m};

// GoPlus flags. The third column says what a MISSING value means: for most
// properties silence is just silence, and claiming otherwise would invent an
// all-clear the service never gave.
const FLAGS=[
  ['is_mintable','Mintable','More tokens can be created — the supply is not fixed.'],
  ['is_proxy','Proxy contract','The logic sits behind an upgradeable pointer and can be replaced.'],
  ['can_take_back_ownership','Ownership reclaimable','A renounce can be undone.'],
  ['hidden_owner','Hidden owner','Ownership is held somewhere other than the usual slot.'],
  ['selfdestruct','Self-destruct','The contract can delete itself.'],
  ['transfer_pausable','Transfers pausable','Someone can freeze all transfers.'],
  ['is_blacklisted','Blacklist','Individual wallets can be blocked from trading.'],
  ['slippage_modifiable','Tax changeable','The tax rate is not fixed — it can be raised later.'],
  ['personal_slippage_modifiable','Per-wallet tax','A different tax can be set for individual wallets.'],
  ['trading_cooldown','Trading cooldown','A forced wait is enforced between trades.'],
  ['is_anti_whale','Max transaction limit','A cap on trade size is enforced.'],
  ['anti_whale_modifiable','Trade cap changeable','That cap can be changed later.'],
  ['cannot_sell_all','Cannot sell all','Selling the full balance in one go is blocked.'],
];

// COLOUR — and what it is allowed to mean.
//
// Green/amber/red here say ONE thing: how much this costs you, measured against
// a floor that is not a matter of opinion. Every pool has an unavoidable toll —
// the swap fee plus the transfer tax — that you pay at any size. Everything on
// top of that is depth. So the bands compare what you actually pay against that
// floor, and the impact bands are read straight off the price you move.
//
// What the colour deliberately does NOT mean: that a token is good, safe, or
// worth buying. A deep pool with a renounced owner can still go to zero, and a
// thin one can be perfectly honest. Publishing a verdict about somebody else's
// token would put our name on a judgement we cannot stand behind — and the one
// time we got it wrong, that is the only thing anyone would remember.
//
// An earlier draft coloured these by percentile against a sample of 46 pools.
// That was dropped: a keyword-scraped sample of 46 is not a distribution, and
// dressing it up as one would be inventing authority.
const band=(v,ok,mid)=>v==null?'':v<=ok?' good':v<=mid?' mid':' bad';
const costBand=(pay,floor)=>{
  if(pay==null||!(floor>0))return '';
  return band(pay/floor,1.5,3);       // at most half again over the toll, or triple it
};
const impactBand=v=>v==null?'':band(Math.abs(v),1,5);   // 1% and 5% of the price you move

// ---- building blocks -------------------------------------------------------
function statRow(items){
  const g=el('div','st-row');
  items.forEach(it=>{
    const c=el('div','st');
    // A sub-cent price written out with every zero is far longer than a market
    // cap, and at the headline size it wrapped mid-number on a 390px phone — a
    // price broken across two lines invites a misread. Step the size down by
    // length instead of letting it break.
    const vs=String(it.v==null?'':it.v),
          fit=vs.length>=16?' st-xl':vs.length>=12?' st-lg':'';
    c.appendChild(el('div','st-v'+fit+(it.dim?' dim':'')+(it.tone||''),it.v));
    c.appendChild(el('div','st-l',it.l));
    if(it.s){
      const s=el('div','st-s',it.s);
      // An address printed as plain text is a dead end — the reader wants to go
      // look at the wallet, and making them copy it by hand is the difference
      // between a claim and something they can check.
      if(it.link)s.append(' ',link(it.link.t,it.link.href,'lk'));
      c.appendChild(s);
    }
    g.appendChild(c);
  });
  return g;
}
// ---- fee tiers: the question a liquidity provider has ----------------------
//
// Everything above this card answers "what would a trade cost me". This one
// answers the other side: a pair on PancakeSwap lives in up to five pools at
// once — V2 at 0.25% and V3 at 0.01/0.05/0.25/1.00% — and every interface,
// including the venue list further up this page, ranks them by the money
// already parked in them. That is a record of what other people did. It is not
// what the pool pays, and the two come apart constantly.
//
// WHY THIS ONE CALLS AN ENDPOINT ON A PAGE THAT OTHERWISE CALLS NONE
// The rest of this page reads the chain straight from the visitor's browser and
// costs nothing to run. This card asks brainonbnb.com/api/fee-tiers instead,
// and that is deliberate rather than lazy: the identical measurement is sold to
// agents through an MCP tool and an ERC-8183 agent, and a page that computed it
// a second time here would eventually disagree with them about which tier pays
// best. One number, one source. It is behind a button so the default scan is
// unchanged, and nothing on this card is fetched unless somebody asks for it.
function tierCard(token){
  const c=card('Which fee tier is paying its liquidity providers',
    'For providing liquidity, not for trading. Measured over a live window and deliberately not annualised.');
  const btn=el('button','sc-tierbtn','Measure the PancakeSwap tiers');
  btn.type='button';
  const out=el('div','tier-out');
  c.append(btn,out);

  btn.addEventListener('click',async()=>{
    if(btn.disabled)return;
    btn.disabled=true;btn.textContent='Measuring…';
    out.textContent='';
    try{
      const r=await fetch('/api/fee-tiers?address='+encodeURIComponent(token));
      const d=await r.json();
      if(d.error){renderTierError(out,d.error);return;}
      renderTiers(out,d);
      btn.remove();
    }catch(e){
      renderTierError(out,'The measurement did not come back. Nothing is cached here, so a retry usually works.');
    }finally{
      if(btn.isConnected){btn.disabled=false;btn.textContent='Measure the PancakeSwap tiers';}
    }
  });
  return c;
}

function renderTierError(out,msg){
  out.textContent='';
  out.appendChild(el('p','cd-foot',msg));
}

function renderTiers(out,d){
  out.textContent='';
  const measured=(d.tiers||[]).filter(t=>t.measured);

  // A refused range and a quiet pool arrive as the same emptiness and mean
  // opposite things — one of them is a fact about somebody's pool and the other
  // is a fact about our measurement. Never the same sentence.
  if(!measured.length){
    out.appendChild(el('p','cd-foot','None of the '+((d.tiers||[]).length)+
      ' tiers could be read this time: the log endpoint refused the range. That says nothing about whether the pair traded. Try again in a moment.'));
    return;
  }

  // THE ANSWER FIRST, THE EVIDENCE UNDER IT.
  //
  // The table below is five rows of numbers that a liquidity provider has to
  // hold in their head simultaneously to get an answer out of. The answer is
  // two sentences, so it goes first, in the same shape the scan result uses
  // further up this page.
  const best=d.best_paying_tier, most=d.most_capital_tier;
  const bestW=d.best_paying_tier_by_working_capital, mostW=d.most_working_capital_tier;
  const ans=el('div','vd tier-ans');
  const line=(tone,head,body)=>{
    const r=el('div','vd-r vd-'+tone);
    r.appendChild(el('b',null,head));
    if(body)r.appendChild(el('span',null,body));
    ans.appendChild(r);
  };
  const row=t=>(d.tiers||[]).find(x=>x.tier===t);

  // 1. Where a new dollar earns most. Withheld — loudly — when any tier went
  //    unread or any band came back truncated, because a ranking over a subset
  //    names whichever tier happened to be readable.
  if(bestW){
    const b=row(bestW);
    line('good',bestW+' pays the most per dollar that is actually working.',
      b&&b.fees_per_1000_usd_working!=null
        ?'It paid $'+b.fees_per_1000_usd_working.toFixed(4)+' per $1,000 of capital standing within '+
         (d.band_pct||2)+'% of the price, over this window. That is the figure to compare, because a dollar you add only earns beside the capital that is at the price.'
        :'Measured over the capital standing at the price rather than the capital in the pool.');
  }else if(d.comparison_complete===false){
    const n=(d.tiers_unreadable||[]).length;
    line('unknown',n+' of '+(d.tiers_found||0)+' tiers could not be read, so no tier is called best.',
      (d.best_paying_tier_among_readable?'Of the ones that were read, '+d.best_paying_tier_among_readable+' paid most. ':'')+
      'A ranking over an unknown subset would name whichever tier happened to answer. Ask again in a moment.');
  }else if(d.bands_complete===false){
    line('unknown','The tick book was too dense to read whole, so no tier is called best.',
      'One of these pools has more price levels inside the band than can be read in one pass. The capital shown for it is understated, and understating one tier flatters the others.');
  }else{
    line('unknown','Nothing traded on any tier that could be read in this window.',
      'No fees were paid, so no tier can be ranked by what it paid. The capital figures below still hold.');
  }

  // 2. The finding this panel exists for: what a pool HOLDS and what it has
  //    standing at the price are different numbers, and every interface an LP
  //    can consult shows the first one.
  if(most&&mostW&&most!==mostW){
    const a=row(most), b=row(mostW);
    line('mid',most+' holds the most money. '+mostW+' has the most of it at the price.',
      (a&&a.capital_usd!=null&&a.working_capital_usd!=null&&b&&b.working_capital_usd!=null)
        ?most+' holds '+usd(a.capital_usd)+' and stands '+usd(a.working_capital_usd)+' within '+(d.band_pct||2)+
         '% of the price. '+mostW+' stands '+usd(b.working_capital_usd)+'. Depth on a listing page is the first number; what you compete with is the second.'
        :'');
  }else if(d.working_capital_changes_the_answer===true&&best&&bestW&&best!==bestW){
    line('mid','By the usual measure '+best+' looks best. By working capital '+bestW+' is.',
      'Dividing the same fees by everything the pool holds rewards a pool for capital that earns nothing. Both figures are in the table.');
  }else if(most&&mostW&&most===mostW&&bestW){
    line('mid',most+' both holds the most and stands the most at the price.',
      'The two measures agree here, which is worth knowing rather than assuming.');
  }
  out.appendChild(ans);

  const rows=el('div','tier-t');
  const head=el('div','tier-r tier-hr');
  head.append(el('span','tier-n','tier'),el('span','tier-c','in the pool'),
    el('span','tier-w','at the price'),el('span','tier-v','traded'),
    el('span','tier-f','pays per $1,000 working'));
  rows.appendChild(head);

  // The header disappears below 560px, so each figure carries its own label
  // that only shows there. Two unexplained numbers side by side on a phone is
  // how a panel with more information ends up saying less.
  const cell=(cls,label,text,extra)=>{
    const s=el('span',cls+(extra||''));
    s.appendChild(el('i','tl',label));
    s.appendChild(document.createTextNode(text));
    return s;
  };

  (d.tiers||[]).forEach(t=>{
    const r=el('div','tier-r'+(t.tier===bestW?' tier-best':''));
    const n=el('span','tier-n',t.tier);
    if(t.tier===most)n.appendChild(el('em','tier-tag','most capital'));
    else if(t.tier===mostW)n.appendChild(el('em','tier-tag','most at the price'));
    r.appendChild(n);
    r.appendChild(cell('tier-c','in the pool',t.capital_usd==null?'—':usd(t.capital_usd)));
    // Share as well as amount: "$171K of $17.4M" is the whole point, and one
    // percent reads harder than it should without the figure it is a share of.
    r.appendChild(cell('tier-w','at the price',
      t.working_capital_usd==null?'—':usd(t.working_capital_usd)+
        (t.working_share_pct!=null?' ('+t.working_share_pct.toFixed(t.working_share_pct<10?1:0)+'%)':'')));
    if(!t.measured){
      r.appendChild(cell('tier-v dim','traded','not readable'));
      r.appendChild(cell('tier-f dim','pays per $1,000','—'));
    }else{
      r.appendChild(cell('tier-v','traded',t.volume_usd>0?usd(t.volume_usd):'nothing'));
      const pays=t.fees_per_1000_usd_working;
      r.appendChild(cell('tier-f','pays per $1,000',pays==null?'—':'$'+pays.toFixed(4),
        t.tier===bestW?' good':(pays===0?' dim':'')));
    }
    rows.appendChild(r);
  });
  out.appendChild(rows);

  const idle=(d.idle_capital||[]).reduce((s,x)=>s+(x.capital_usd||0),0);
  if(idle>=100){
    out.appendChild(el('p','cd-foot',usd(idle)+' sits in '+
      (d.idle_capital.length===1?'a tier that':'tiers that')+' saw no trade at all in this window: '+
      d.idle_capital.map(x=>x.tier).join(', ')+'.'));
  }

  const w=d.measured_window||{};
  out.appendChild(el('p','cd-foot','Measured over '+(w.minutes??'~38')+
    ' minutes of chain — a sample, not a rate, and not annualised. Capital is both sides of the pool. "At the price" is the part of it standing within '+
    (d.band_pct||2)+'% of the current price, walked from the pool’s own tick data and checked against PancakeSwap’s quoter; the rest is on the balance sheet and earns nothing while the price is where it is. It assumes the price stays in that band, which it will not do forever. Impermanent loss is not in any of this.'));
}

// THE QUESTION AFTER THE TIER, and the only one V3 really forces.
//
// The card above answers which of the five pools sharing this pair is worth
// being in. Having picked one, a liquidity provider still has to say between
// which two prices the money sits, and that decision moves the outcome far more
// than the tier does — three orders of magnitude, on the pair this was built
// against. Every interface offers a preset for it.
//
// This is not a preset and not a forecast. The V3 Swap event carries the
// liquidity that was active when each trade went through, so a position of a
// chosen size is walked back through the trades that actually happened: in
// range or not, and what share of the liquidity standing there it would have
// been. Behind a button, like the tier card, because it costs a measurement.
function rangeCard(token){
  const c=card('Which price range, if you did provide liquidity',
    'A V3 position is not in a pool, it is between two prices. Replayed against the trades that actually happened in a live window.');
  const btn=el('button','sc-tierbtn','Replay the ranges');
  btn.type='button';
  const out=el('div','tier-out');
  c.append(btn,out);

  btn.addEventListener('click',async()=>{
    if(btn.disabled)return;
    btn.disabled=true;btn.textContent='Replaying…';
    out.textContent='';
    try{
      const r=await fetch('/api/range-plan?address='+encodeURIComponent(token));
      const d=await r.json();
      if(d.error){renderTierError(out,d.error);return;}
      renderRanges(out,d);
      btn.remove();
    }catch(e){
      renderTierError(out,'The replay did not come back. Nothing is cached here, so a retry usually works.');
    }finally{
      if(btn.isConnected){btn.disabled=false;btn.textContent='Replay the ranges';}
    }
  });
  return c;
}

function renderRanges(out,d){
  out.textContent='';
  const rows=d.ranges||[];
  const w=d.measured_window||{};
  if(!rows.length||!w.swaps){
    out.appendChild(el('p','cd-foot','No swap in the measured window, so there is nothing to replay a position against. That is a fact about this pool in the last forty minutes, not about the ranges.'));
    return;
  }

  const ans=el('div','vd tier-ans');
  const line=(tone,head,body)=>{
    const r=el('div','vd-r vd-'+tone);
    r.appendChild(el('b',null,head));
    if(body)r.appendChild(el('span',null,body));
    ans.appendChild(r);
  };
  const held=d.narrowest_range_that_held_the_whole_window;
  const best=d.best_earning_range_in_this_window;

  // The honest headline is the narrowest range that HELD, not the one that
  // earned most. The best earner is regularly a range the price walked out of,
  // and naming that as the answer would be recommending a position on the
  // strength of the forty minutes before it broke.
  if(held){
    const row=rows.find(r=>r.width_pct!=null&&('±'+r.width_pct+'%')===held);
    const full=rows.find(r=>r.full_range);
    line('good',held+' is the narrowest range that held for the whole window.',
      (row&&full&&full.fees_usd_in_window>0)
        ? 'On $'+nf(d.capital_considered_usd)+' it would have collected $'+row.fees_usd_in_window.toFixed(6)+
          ' — about '+Math.round(row.fees_usd_in_window/full.fees_usd_in_window)+
          ' times what the same money makes spread across every price. Narrow is where the fees are; it is also where the work is.'
        : 'Narrower ranges earn more per dollar and stop earning the moment the price leaves them.');
  }else{
    line('unknown','No range on this list held for the whole window.',
      'On this pool, in these forty minutes, the price was outside every width at some point. That is worth knowing before placing anything, and it is why the crossing count is a column rather than a footnote.');
  }
  if(best&&held&&best!==held){
    const b=rows.find(r=>('±'+r.width_pct+'%')===best);
    line('mid',best+' collected the most — and the price crossed its edge '+
      (b?b.times_it_crossed_the_edge:'')+(b&&b.times_it_crossed_the_edge===1?' time':' times')+'.',
      'A position there earns nothing while it is outside, and putting it back costs about $'+
      (d.rebalance_cost_usd_assumed||0).toFixed(2)+' in gas — '+
      costInWindows(d.rebalance_cost_usd_assumed,b&&b.fees_usd_in_window)+
      '. After paying for that, '+(d.best_range_after_paying_to_put_it_back||'nothing here')+' came out ahead.');
  }
  // The sentence that stops a narrow range looking free even when it held: the
  // cost of nursing it is a real number and it belongs beside the reward.
  else if(held){
    const hr=rows.find(r=>('±'+r.width_pct+'%')===held);
    if(hr&&hr.fees_usd_in_window>0&&d.rebalance_cost_usd_assumed>0){
      line('mid','One crossing costs '+costInWindows(d.rebalance_cost_usd_assumed,hr.fees_usd_in_window)+'.',
        'Putting a position back is roughly $'+d.rebalance_cost_usd_assumed.toFixed(2)+
        ' of gas — 700,000 units priced well above the current floor. It did not happen in this window. It is the thing to watch if it does.');
    }
  }
  out.appendChild(ans);

  const t=el('div','tier-t');
  const head=el('div','tier-r tier-hr');
  head.append(el('span','tier-n','range'),el('span','tier-c','between'),
    el('span','tier-w','in range'),el('span','tier-v','edge crossed'),
    el('span','tier-f','collected on $'+nf(d.capital_considered_usd)));
  t.appendChild(head);
  const cell=(cls,label,text,extra)=>{
    const s=el('span',cls+(extra||''));
    s.appendChild(el('i','tl',label));
    s.appendChild(document.createTextNode(text));
    return s;
  };
  rows.forEach(r=>{
    const isHeld=held&&('±'+r.width_pct+'%')===held;
    const row=el('div','tier-r'+(isHeld?' tier-best':''));
    const n=el('span','tier-n',r.full_range?'full range':'±'+r.width_pct+'%');
    if(isHeld)n.appendChild(el('em','tier-tag','narrowest that held'));
    row.appendChild(n);
    row.appendChild(cell('tier-c','between',
      r.price_range?(r.price_range.low+' – '+r.price_range.high):'every price'));
    row.appendChild(cell('tier-w','in range',
      r.share_of_window_in_range_pct==null?'—':r.share_of_window_in_range_pct+'%'));
    row.appendChild(cell('tier-v','edge crossed',
      r.times_it_crossed_the_edge===0?'never':r.times_it_crossed_the_edge+'×'));
    row.appendChild(cell('tier-f','collected','$'+r.fees_usd_in_window.toFixed(6),
      isHeld?' good':(r.fees_usd_in_window===0?' dim':'')));
    t.appendChild(row);
  });
  out.appendChild(t);

  out.appendChild(el('p','cd-foot','Measured over '+(w.minutes??'~38')+
    ' minutes of chain — a sample, not a rate, and not annualised. Replayed against the '+w.swaps+
    ' swaps that actually happened in it, using the liquidity the pool itself reported as active at each one — not a simulation of a market, arithmetic over trades that occurred. The pool paid $'+
    (w.fees_the_pool_paid_usd||0).toFixed(2)+' in fees across all of them. Not annualised: what a range did over forty minutes is not what it does over a year. '+
    (d.tier_chosen_because?'Pool picked for you: the '+d.tier_chosen_because+' — which tier PAYS best is the card above. ':'')+
    'Impermanent loss is not in any of this, and it is worst exactly where the fees are best.'));
}

function card(title,sub){
  const c=el('section','cd');
  const h=el('div','cd-h');
  h.appendChild(el('h3',null,title));
  if(sub)h.appendChild(el('p',null,sub));
  c.appendChild(h);
  return c;
}

// ---- the answer, before the evidence ---------------------------------------
//
// Everything below this is a measurement and every one of them is worth having.
// None of them is the sentence somebody came here for. The result used to open
// with "Hard USDT backing" and "Liquidity / Mcap" — correct, and neither is a
// phrase a person uses about their own money. So the first thing on the page is
// now three plain answers: what a normal-sized trade costs you, whether the
// token takes a cut of every trade, and whether anybody can walk off with the
// liquidity. The numbers are the same ones the cards below carry; nothing new
// is computed and nothing is rounded into a claim.
//
// A line that cannot be answered says so. "Could not be measured" is an honest
// line; a green tick that means "we did not look" is not.
function verdictCard(d,pool,gp,gpOk,tax){
  const c=el('section','cd vd-card');
  const h=el('div','cd-h');
  h.appendChild(el('h3',null,'The short answer'));
  h.appendChild(el('p',null,'The three things worth knowing before you trade this, in plain words. Every one of them is measured below.'));
  c.appendChild(h);
  const list=el('div','vd');

  const line=(tone,head,body)=>{
    const r=el('div','vd-r vd-'+tone);
    r.appendChild(el('b',null,head));
    r.appendChild(el('span',null,body));
    list.appendChild(r);
  };

  // 1. What a normal trade costs. The reference size is the row closest to $500
  //    rather than the smallest or the largest: the smallest flatters the pool
  //    and the largest scares people away from one that would have been fine.
  const rows=(d.rows||[]).slice().sort((a,b)=>Math.abs(a.usd-500)-Math.abs(b.usd-500));
  const ref=rows[0];
  const floors={buy:(1-(1-d.taxB)*(1-pool.fee))*100, sell:(1-(1-d.taxS)*(1-pool.fee))*100};
  if(ref&&ref.buyCost!=null&&ref.sellCost!=null){
    const worst=Math.max(ref.buyCost,ref.sellCost);
    const toll=Math.max(floors.buy,floors.sell);
    // Measured against the unavoidable toll for THIS pool, not against a fixed
    // percentage: 3% is cheap in a 1% fee tier with a 2% tax and dreadful in a
    // 0.05% pool with none.
    const tone=toll>0?(worst<=toll*1.5?'good':worst<=toll*3?'mid':'bad'):'mid';
    line(tone,'A $'+nf(ref.usd)+' trade costs you '+ref.buyCost.toFixed(1)+'% to buy and '+ref.sellCost.toFixed(1)+'% to sell.',
      'That is the whole cost: the pool fee, any transfer tax, and how far your own trade moves the price. '
      +(toll>0?'About '+toll.toFixed(1)+'% of it is unavoidable at any size in this pool; the rest is depth.'
             :'Round trip, that is about '+(ref.buyCost+ref.sellCost).toFixed(1)+'% before the price moves at all.'));
  }else{
    line('unknown','A trade of this size could not be priced.',
      'The quoter did not return a price for every size, so no cost figure is shown at all rather than a partial one.');
  }

  // 2. The tax. The figure most likely to be wrong elsewhere, which is why this
  //    page measures it from executed trades instead of reading the label.
  const measured=tax&&tax.ok&&(tax.buy!=null||tax.sell!=null);
  if(d.taxB||d.taxS){
    const both=Math.round(d.taxB*1000)===Math.round(d.taxS*1000);
    line(d.taxB>=0.10||d.taxS>=0.10?'bad':'mid',
      both?'This token takes '+pc(d.taxB*100)+' out of every trade.'
          :'This token takes '+pc(d.taxB*100)+' when you buy and '+pc(d.taxS*100)+' when you sell.',
      (measured?'Measured from trades that actually executed, not read off the contract label.'
              :'Reported by GoPlus and not verified here — no executed trade was available to measure it from.')
      +' It is already included in the cost above.');
  }else if(measured){
    line('good','No transfer tax. You keep what you trade, minus the pool fee.',
      'Measured from trades that actually executed. A token can still add one later if its contract allows it.');
  }else{
    line('unknown','Whether it takes a transfer tax could not be established.',
      'No executed trade was available to measure it from, and no label is trusted in its place. Treat the cost above as a floor.');
  }

  // 3. Who can remove the liquidity. On a concentrated-liquidity pool there are
  //    no LP tokens to burn, so the honest line is that this question does not
  //    apply rather than a reassuring one that does not mean anything.
  if(pool.kind==='v2'){
    const burnedPct=d.lpTot>0?(d.lpDead+d.lpNull)/d.lpTot*100:0;
    const feePct=d.lpTot>0&&d.lpFee>0?d.lpFee/d.lpTot*100:0;
    const free=Math.max(0,100-burnedPct-feePct);
    if(burnedPct>=99){
      line('good','Nobody can pull the liquidity out. It is burned.',
        pc(burnedPct)+' of the LP tokens sit at a dead address. Burned liquidity can never be withdrawn by anyone, including the people who put it there.');
    }else if(free>=50){
      // "Somebody can pull this" is the right warning for one wallet holding
      // the lot and the wrong one for a blue chip whose LP sits across
      // thousands of addresses. Both are "not burned"; only one is a person who
      // could empty the pool tonight, and the largest single holder is what
      // separates them.
      const others=(gp.lp_holders||[]).filter(x=>{const a=(x.address||'').toLowerCase();
        return a!==DEAD&&a!==NULLA&&a!==(d.feeTo||'')&&x.is_locked!==1});
      const top=others.sort((a,b)=>(parseFloat(b.percent)||0)-(parseFloat(a.percent)||0))[0];
      const topPct=top?(parseFloat(top.percent)||0)*100:null;
      if(gpOk&&topPct!=null&&topPct<10){
        line('mid','The liquidity is not burned, but no single wallet holds much of it.',
          pc(free)+' of the LP can be withdrawn in principle, spread across many holders — the largest one has '+pc(topPct)+
          '. Nobody here can empty the pool on their own; a lot of them leaving at once is a different question, and not one this page can answer.');
      }else if(gpOk&&topPct!=null){
        line('bad','One wallet can withdraw most of this liquidity.',
          pc(free)+' of the LP is neither burned nor at the exchange, and a single wallet holds '+pc(topPct)+
          ' of it. That is not proof of anything — plenty of honest pools look like this — but it is the risk that empties a pool overnight.');
      }else{
        // Not burned is measured on-chain and certain. WHO holds it is not:
        // without the holder list this page cannot tell one wallet from ten
        // thousand, and those are very different risks. Saying "somebody can
        // pull this" here would be a claim built on the half we could not read.
        line('unknown','The liquidity is not burned, and we could not see who holds it.',
          pc(free)+' of the LP is withdrawable in principle — that part is read from the chain. The holder list comes from GoPlus, which did not answer for this pool, so whether that is one wallet or thousands is unknown rather than fine.');
      }
    }else{
      line('mid','Part of the liquidity can still be withdrawn.',
        pc(burnedPct)+' is burned for good; about '+pc(free)+' is not. The breakdown, including who holds the largest unburned share, is further down.');
    }
  }else{
    line('unknown','“Is the liquidity burned?” does not apply to this pool.',
      'It is a concentrated-liquidity pool: liquidity is held as individual positions rather than as LP tokens, so there is nothing to burn. Any position here can be closed by whoever opened it, at any time.');
  }

  c.appendChild(list);
  c.appendChild(el('p','cd-legend',
    'None of this says whether the token is a good idea. It says what trading it would cost you today and who could change that.'));
  return c;
}

function renderLadder(rows,taxNote,floors){
  const wrap=el('div','lad');
  [['buy','Buying','up'],['sell','Selling','down']].forEach(([side,label,dir])=>{
    const floor=side==='buy'?floors.buy:floors.sell;
    const col=el('div','lad-c');
    const hd=el('div','lad-h lad-'+side);
    hd.appendChild(el('span','lad-t',label));
    hd.appendChild(el('span','lad-d','price '+dir));
    col.appendChild(hd);
    const head=el('div','lad-r lad-hr');
    head.append(el('span','lad-s','size'),el('span','lad-b',''),
      el('span','lad-p','impact'),el('span','lad-x','you pay'));
    col.appendChild(head);
    const vals=rows.map(r=>side==='buy'?r.buyMove:r.sellMove).filter(v=>v!=null).map(Math.abs);
    const max=Math.max(...vals,0.0001);
    rows.forEach(r=>{
      const mv=side==='buy'?r.buyMove:r.sellMove,cs=side==='buy'?r.buyCost:r.sellCost;
      const row=el('div','lad-r');
      row.appendChild(el('span','lad-s','$'+nf(r.usd)));
      const t=el('span','lad-b'),bar=el('i',side==='sell'?'sell':null);
      bar.style.transform='scaleX('+(mv==null?0:Math.min(1,Math.abs(mv)/max)).toFixed(4)+')';
      t.appendChild(bar);row.appendChild(t);
      row.appendChild(el('span','lad-p'+impactBand(mv),signed(mv)));
      row.appendChild(el('span','lad-x'+costBand(cs,floor),cs==null?'—':cs.toFixed(2)+'%'));
      col.appendChild(row);
    });
    wrap.appendChild(col);
  });
  const box=el('div');box.appendChild(wrap);
  if(taxNote)box.appendChild(el('p','cd-foot',taxNote));
  box.appendChild(el('p','cd-legend',
    'Colour is about cost, not quality. Green means you pay close to the unavoidable toll for this pool ('+
    (floors.buy>0?floors.buy.toFixed(2)+'% on a buy, '+floors.sell.toFixed(2)+'% on a sell':'fee plus tax')+
    ', payable at any size); amber is noticeably above it; red means the pool is moving under you. '+
    'It says nothing about whether the token is any good — a deep pool can still go to zero.'));
  return box;
}

// ---- tax card --------------------------------------------------------------
// The centrepiece, because it is the figure most likely to be wrong elsewhere.
// Measured values win; a label is shown as a label, with its disagreement
// spelled out rather than quietly averaged away.
function taxCard(tax,gp,gpOk){
  const c=card('The transfer tax, measured',
    'Not taken from a label — read off trades that actually executed. The pool reports how many tokens it moved, the token’s own transfer events report how many arrived, and the gap is what the wallet was charged.');
  const gB=gp.buy_tax!=null&&isFinite(Number(gp.buy_tax))?Number(gp.buy_tax)*100:null,
        gS=gp.sell_tax!=null&&isFinite(Number(gp.sell_tax))?Number(gp.sell_tax)*100:null;
  if(tax.ok){
    const mB=tax.buy!=null?tax.buy*100:null,mS=tax.sell!=null?tax.sell*100:null;
    c.appendChild(statRow([
      {v:mB!=null?pc(mB):(gB!=null?pc(gB):'—'),l:'Buy tax',dim:mB==null,
        tone:mB!=null?band(mB,0.01,5):'',
        s:tax.nBuy?'median of '+tax.nBuy+' executed buy'+(tax.nBuy===1?'':'s')
          :(gB!=null?'no buy in the window — GoPlus’s figure, unverified':'no buy in the window')},
      {v:mS!=null?pc(mS):(gS!=null?pc(gS):'—'),l:'Sell tax',dim:mS==null,
        tone:mS!=null?band(mS,0.01,5):'',
        s:tax.nSell?'median of '+tax.nSell+' executed sell'+(tax.nSell===1?'':'s')
          :(gS!=null?'no sell in the window — GoPlus’s figure, unverified':'no sell in the window')},
    ]));
    const parts=[];
    if(tax.spread.buy.length>1)parts.push('buys charged '+tax.spread.buy.map(x=>x+'%').join(', '));
    if(tax.spread.sell.length>1)parts.push('sells charged '+tax.spread.sell.map(x=>x+'%').join(', '));
    if(parts.length)c.appendChild(el('p','cd-foot','Every trade read: '+parts.join('; ')+
      '. A 0% entry is normal — deployers, tax sinks and allow-listed routers are usually exempt, which is why the median is used and not the average.'));
    const dis=[];
    if(gB!=null&&mB!=null&&Math.abs(gB-mB)>0.15)dis.push('buy '+pc(gB)+' vs '+pc(mB)+' measured');
    if(gS!=null&&mS!=null&&Math.abs(gS-mS)>0.15)dis.push('sell '+pc(gS)+' vs '+pc(mS)+' measured');
    if(dis.length){
      const w=el('div','warn warn-soft');
      w.appendChild(el('b',null,'GoPlus reports a different tax than the chain charged.'));
      w.appendChild(el('span',null,dis.join(' · ')+'. The figures on this page use the measured value. A label can be stale, can come from a partial simulation, or can include slippage from whatever size was simulated.'));
      c.appendChild(w);
    }
  }else{
    c.appendChild(statRow([
      {v:gB!=null?pc(gB):'—',l:'Buy tax (reported)',dim:true,s:'GoPlus label, unverified'},
      {v:gS!=null?pc(gS):'—',l:'Sell tax (reported)',dim:true,s:'GoPlus label, unverified'},
    ]));
    const w=el('div','warn warn-soft');
    w.appendChild(el('b',null,'Could not be measured: '+tax.reason+'.'));
    w.appendChild(el('span',null,(gB!=null||gS!=null)
      ? 'The numbers above come from GoPlus and are used in the “you pay” column, but nothing on the chain has confirmed them. Treat that column as indicative until this token trades again.'
      : 'No tax figure is available at all, so the “you pay” column below counts the pool fee only and is a floor, not the real cost.'));
    c.appendChild(w);
  }
  return c;
}

// ---- flags -----------------------------------------------------------------
function flagsCard(gp,gpOk){
  const c=card('What the contract can do',
    gpOk?'Contract properties as read from the verified source by GoPlus. These are properties, not a rating — a token can carry several of them and be perfectly ordinary, or carry none and still go to zero.'
        :'GoPlus did not answer for this token, so none of these properties could be checked. Every figure above is unaffected: it comes off the chain directly.');
  if(!gpOk)return c;
  const g=el('div','fg');
  const chip=(state,label,note)=>{const x=el('div','f f-'+state);
    x.appendChild(el('b',null,label));x.appendChild(el('span',null,note));return x};
  const owner=(gp.owner_address||'').toLowerCase();
  if(gp.owner_address==null)g.appendChild(chip('unk','Ownership not checked','GoPlus returned no owner field for this contract.'));
  else if(owner===NULLA||owner==='')g.appendChild(chip('ok','Ownership renounced','No owner address left on the contract.'));
  else g.appendChild(chip('on','Owner active','Owner is '+short(owner)+'.'));
  if(gp.is_open_source==null)g.appendChild(chip('unk','Verification not checked','GoPlus did not report whether the source is verified.'));
  else if(gp.is_open_source==='1')g.appendChild(chip('ok','Source verified','The published code matches the deployed bytecode.'));
  else g.appendChild(chip('on','Source not verified','Nothing here can be checked against source code — including every other line in this list.'));
  if(gp.is_honeypot==='1')g.appendChild(chip('bad','Honeypot','GoPlus could not sell this token in a simulation.'));
  else if(gp.is_honeypot==null)g.appendChild(chip('unk','Sellability not checked','GoPlus ran no sell simulation for this token.'));
  // The missing ones are listed by name. Silence about a property is not the
  // same as the property being absent, and only one of those two is safe to
  // let a reader assume.
  const unchecked=[];
  FLAGS.forEach(([k,label,note])=>{
    if(gp[k]==='1')g.appendChild(chip('on',label,note));
    else if(gp[k]==null)unchecked.push(label.toLowerCase());
  });
  c.appendChild(g);
  if(unchecked.length)c.appendChild(el('p','cd-foot',
    'Not checked for this token ('+unchecked.length+'): '+unchecked.join(', ')+
    '. GoPlus returned no value for these — that is not the same as “no”, and this page will not pretend it is. Proxy contracts in particular often come back only partly analysed.'));
  return c;
}

// ---- main render -----------------------------------------------------------
function render(d){
  const o=$('sc-out');o.hidden=false;$('sc-err').hidden=true;o.textContent='';
  const teaser=$('sc-what');if(teaser)teaser.hidden=true;
  const {gp,gpOk,addr,pool,name,symb,px,quoteUsd,quoteSym,tax,supply,burned,hop,deeper,partial}=d;
  // Both sides valued for real. On a V2 pair this is exactly twice the quote
  // side by construction; on a V3 pool the two halves are not equal and
  // doubling would invent liquidity that is not there.
  const hard=d.q*quoteUsd,tvl=hard+d.tok*px;
  const circ=supply!=null?supply-burned:null,mcap=circ!=null&&px?circ*px:null;

  // header
  const head=el('header','hd');
  const ttl=el('div','hd-t');
  ttl.appendChild(el('h2',null,symb));
  ttl.appendChild(el('span','hd-n',name));
  head.appendChild(ttl);
  const meta=el('div','hd-m');
  meta.appendChild(el('span','badge',pool.kind==='v3'
    ? 'PancakeSwap V3 · '+(pool.fee*100).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+'% tier'
    : (pool.venue||'PancakeSwap V2')+' · '+(pool.fee*100).toFixed(2)+'% fee'));
  meta.appendChild(el('span','badge badge-q',symb+' / '+quoteSym));
  if(gp.launchpad_token&&gp.launchpad_token.launchpad_name)
    meta.appendChild(el('span','badge badge-d','via '+gp.launchpad_token.launchpad_name));
  head.appendChild(meta);
  const lnk=el('div','hd-l');
  lnk.append(link(short(addr),'https://bscscan.com/token/'+addr),
    link('Pool '+short(pool.pair),'https://bscscan.com/address/'+pool.pair),
    link('DexScreener ↗','https://dexscreener.com/bsc/'+pool.pair));
  head.appendChild(lnk);
  o.appendChild(head);

  // The answer first. Everything after it is why.
  o.appendChild(verdictCard(d,pool,gp,gpOk,tax));

  // headline stats
  o.appendChild(statRow([
    {v:usd(px),l:'Price'},
    {v:mcap!=null?usd(mcap):'—',l:'Market Cap',s:circ!=null?nf(circ)+' circulating':'supply unreadable'},
    {v:usd(tvl),l:'Liquidity',s:'both sides of the pool'},
    {v:mcap?pc(tvl/mcap*100,1):'—',l:'Liquidity / Mcap',s:'how much of the valuation is actually in the pool'},
  ]));

  // depth
  // The "half of it is the token itself" framing is a CONSTANT-PRODUCT fact: a
  // V2 pair is 50/50 by construction, so the quote side really is a floor. A
  // concentrated-liquidity pool is neither balanced nor a floor — $mubarak's V3
  // pool holds 36% quote, and as the price falls its positions convert toward
  // the token side, buying the quote out. Printing the V2 sentence over a V3
  // pool is right about the number and wrong about what it means.
  const v3=pool.kind==='v3';
  const dep=card('How deep is it really?',
    v3?'The two sides of a concentrated-liquidity pool are not balanced — what sits here is whatever the current price has left in range. The '+quoteSym+' side is still the half that does not depend on this token being worth anything.'
      :'Half of any “liquidity” headline is the token itself, valued at its own price — it shrinks exactly when it would be needed. The '+quoteSym+' side is the half that holds.');
  dep.appendChild(statRow([
    {v:usd(hard),l:'Hard '+quoteSym+' backing',
      s:nf(d.q,d.q<100?3:2)+' '+quoteSym+(v3
        ?' in the pool right now — not a fixed floor: as the price falls, positions convert toward the token side'
        :' — keeps its value if the price falls')},
    {v:mcap?pc(hard/mcap*100,1):'—',l:'Hard backing / Mcap',
      s:v3?'how much of the valuation is currently backed by '+quoteSym+' in range'
          :'the floor under the market cap'},
    // "More than X" is an answer; a dash is not. On a concentrated-liquidity
    // pool the sweep can run out of range before the price gives way — USDC/USDT
    // does not move one percent for any size the quoter will price — and
    // printing "—" there reads as a failure to measure when the finding is that
    // the pool is deeper than the largest size asked about.
    {v:d.up!=null?usd(d.up):(d.upMin!=null?'> '+usd(d.upMin):'—'),l:'Moves the price +1%',
      s:d.up!=null?'a buy this size, right now':(d.upMin!=null?'deeper than the largest size quoted':'a buy this size, right now')},
    {v:d.down!=null?usd(d.down):(d.downMin!=null?'> '+usd(d.downMin):'—'),l:'Moves the price −1%',
      s:d.down!=null?'a sell this size, right now':(d.downMin!=null?'deeper than the largest size quoted':'a sell this size, right now')},
  ]));
  o.appendChild(dep);

  // Qualified by absolute depth rather than by share: say so before any figure
  // is read, not in a footnote under it.
  if(partial!=null){
    const w=el('div','warn warn-soft');
    w.appendChild(el('b',null,'This is one pool of several for this token.'));
    w.appendChild(el('span',null,'It holds '+usd(d.mineUsd)+' — about '+pc(partial*100,1)+
      ' of the '+usd(d.mineUsd+d.otherLiq)+' this token has across all venues. Every figure below describes '+
      'this pool exactly and says nothing about the others. It is deep enough to be worth measuring on its own, '+
      'which is why it is shown; a trade routed by an aggregator may well take a different path.'));
    o.appendChild(w);
  }
  if(deeper){
    const w=el('div','warn warn-soft');
    w.appendChild(el('b',null,'A deeper pool exists for this token.'));
    const s=el('span');
    s.append('You asked about this pool, so this is the one measured. But the '+
      (deeper.kind==='v3'?'PancakeSwap V3 '+(deeper.fee*100).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+'% tier':'PancakeSwap V2')+
      ' pool against '+deeper.sym+' holds '+usd(deeper.hard)+' on its '+deeper.sym+
      ' side against this one’s '+usd(d.q*quoteUsd)+'. ');
    const a=el('a','lk','Scan that one instead →');
    a.href='?token='+deeper.pair;a.target='_self';
    s.appendChild(a);
    w.appendChild(s);
    o.appendChild(w);
  }
  if(hop&&!hop.direct){
    const w=el('div','warn warn-soft');
    w.appendChild(el('b',null,'Every dollar figure here is derived, not direct.'));
    w.appendChild(el('span',null,'This pool is quoted in $'+hop.sym+', not in BNB or a stablecoin, so $'+hop.sym+
      ' had to be priced through its own BNB pool first — which holds '+nf(hop.hopBnb||0,3)+
      ' BNB. Everything above is only as trustworthy as that one pool: if it is thin or stale, so are these dollars. The percentages are unaffected.'));
    o.appendChild(w);
  }

  o.appendChild(taxCard(tax,gp,gpOk));

  // ladder
  const lad=card('What a trade does to the price — and what it costs',
    'Two different things, routinely confused. Impact is how far this trade alone moves the price. “You pay” is what you give up against the spot price: a worse fill because the pool moves underneath you, plus the pool fee, plus the transfer tax.');
  // One direction can be measured while the other is not: a quiet pool may show
  // three sells and no buys inside the window. Saying "measured" for both would
  // then be false for half the column, so each side names its own source.
  const src=m=>m?'measured':'reported by GoPlus, unverified';
  const taxNote=(d.taxB||d.taxS)
    ? 'Costs include a '+pc(d.taxB*100)+' buy tax ('+src(tax.ok&&tax.buy!=null)+
      ') and a '+pc(d.taxS*100)+' sell tax ('+src(tax.ok&&tax.sell!=null)+
      '), plus the '+(pool.fee*100).toFixed(2)+'% pool fee.'
    : 'Costs include the '+(pool.fee*100).toFixed(2)+'% pool fee only — no transfer tax could be established for this token, measured or reported, so treat this column as a floor.';
  // The toll: what a trade of ANY size costs before depth enters the picture.
  const floors={buy:(1-(1-d.taxB)*(1-pool.fee))*100, sell:(1-(1-d.taxS)*(1-pool.fee))*100};
  lad.appendChild(renderLadder(d.rows,taxNote,floors));
  o.appendChild(lad);

  // LP
  if(pool.kind==='v2'){
    const lp=card('Who holds the LP tokens',
      'Burned LP can never be withdrawn by anyone. Locked LP sits in a timelock — a promise with an expiry date, not a burn. Everything else can be pulled at any moment.');
    const burnedPct=d.lpTot>0?(d.lpDead+d.lpNull)/d.lpTot*100:0;
    // The exchange's own share is neither burned nor anybody's to pull, so it is
    // taken out of the free figure rather than counted as a risk.
    const feePct=d.lpTot>0&&d.lpFee>0?d.lpFee/d.lpTot*100:0;
    const holders=(gp.lp_holders||[]).filter(x=>{const a=(x.address||'').toLowerCase();
      return a!==DEAD&&a!==NULLA&&a!==(d.feeTo||'')});
    const lockedPct=holders.filter(x=>x.is_locked===1).reduce((s,x)=>s+(parseFloat(x.percent)||0),0)*100;
    const freePct=Math.max(0,100-burnedPct-lockedPct-feePct);
    const big=holders.filter(x=>x.is_locked!==1).sort((a,b)=>(parseFloat(b.percent)||0)-(parseFloat(a.percent)||0))[0];
    lp.appendChild(statRow([
      {v:pc(burnedPct),l:'Burned',tone:burnedPct>=99?' good':burnedPct>=1?' mid':' bad',s:nf(d.lpDead+d.lpNull,2)+' of '+nf(d.lpTot,2)+' LP, at the dead address'},
      {v:gpOk?pc(lockedPct):'—',l:'Locked',dim:!gpOk,
        s:gpOk?(lockedPct>0?'in a locker GoPlus recognises':'none in a known locker'):'needs GoPlus, which did not answer'},
      {v:gpOk?pc(freePct):'—',l:'Withdrawable',dim:!gpOk,
        s:gpOk?(big?'largest single holder '+pc((parseFloat(big.percent)||0)*100)+' —':'held across wallets')
              :'on-chain, '+pc(Math.max(0,100-burnedPct-feePct))+' of the LP is simply not burned',
        link:gpOk&&big?{t:short(big.address),href:'https://bscscan.com/address/'+big.address}:null},
    ]));
    // Named rather than left in the withdrawable bucket. On a pool that has run
    // for a while this is usually the entire unburned remainder, and reading it
    // as "somebody can pull this" is the wrong conclusion about the one holder
    // here who is not connected to the token at all.
    if(feePct>0){
      const f=el('p','cd-foot');
      f.append(pc(feePct)+' of the LP sits at '+(pool.venue||'the exchange')+'’s own protocol-fee address (');
      f.appendChild(link(short(d.feeTo),'https://bscscan.com/address/'+d.feeTo,'lk'));
      f.append('), which the pair mints to the venue every time liquidity moves. It grows on its own as the pool '+
        'trades and belongs to the exchange, not to the token — so it is counted separately from the figure above '+
        'rather than as liquidity somebody could pull.');
      lp.appendChild(f);
    }
    o.appendChild(lp);
  }else{
    const lp=card('LP ownership does not apply here',
      'This is a concentrated-liquidity pool. Liquidity is held as individual positions rather than as fungible LP tokens, so “LP burned” has no meaning at this venue — there is no LP token to burn. Depth can still leave at any time if position holders withdraw.');
    o.appendChild(lp);
  }

  // other venues
  // Dust is not a venue. A list of six pools holding fractions of a cent tells
  // the reader nothing and buries the one line that might matter, so anything
  // under $100 — or under a thousandth of the pool being measured — is dropped
  // and counted instead.
  const dustLine=Math.max(100,hard/1000),
        shown=(d.others||[]).filter(x=>(x.liquidity||0)>=dustLine),
        hidden=(d.others||[]).length-shown.length;
  if(shown.length){
    const ov=card('Where else it trades',
      'Everything above measures the deepest pool this page can read exactly. These are the rest, as indexed by DexScreener.');
    const l=el('div','vn');
    shown.slice(0,6).forEach(x=>{
      const r=el('div','vn-r');
      r.appendChild(el('span','vn-n',x.name||'Unknown'));
      r.appendChild(el('span','vn-v',usd(x.liquidity||0)));
      r.appendChild(/^0x[a-fA-F0-9]{40}$/.test(x.pair)
        ? link(short(x.pair),'https://bscscan.com/address/'+x.pair,'lk dim')
        : el('span','lk dim','position-based'));
      l.appendChild(r);
    });
    ov.appendChild(l);
    // The cutoff scales with the pool being measured, so it has to be named
    // rather than assumed: writing "$100" while actually hiding everything
    // under $606 states a number that is not the one used.
    if(hidden>0)ov.appendChild(el('p','cd-foot',hidden+' further pool'+(hidden===1?'':'s')+
      ' hold'+(hidden===1?'s':'')+' less than '+usd(dustLine)+' and '+(hidden===1?'is':'are')+
      ' not listed — under a thousandth of the pool above, which is not a place anyone trades.'));
    o.appendChild(ov);
  }else if((d.others||[]).length){
    o.appendChild(card('No other venue worth naming',
      'DexScreener indexes '+(d.others||[]).length+' further pool'+((d.others||[]).length===1?'':'s')+
      ' for this token, each holding less than '+usd(dustLine)+'. Everything tradable sits in the pool measured above.'));
  }

  o.appendChild(tierCard(addr));
  o.appendChild(rangeCard(addr));
  o.appendChild(flagsCard(gp,gpOk));
  o.appendChild(el('p','dis','Pool figures are read live from BNB Chain the moment you press Scan. The transfer tax is measured from recent executed trades where possible. Contract properties come from GoPlus and are attributed as such. This page describes a pool — it does not check the deployer’s history, the holder distribution, the socials, or anything off-chain; it cannot see an upgrade that has not happened yet; and it is not advice.'));
}

// ---- the "not measurable here" path ---------------------------------------
function renderElsewhere(gp,addr,name,symb,hard,others,otherLiq,share,hasPool){
  const o=$('sc-out');o.hidden=false;$('sc-err').hidden=true;o.textContent='';
  const teaser=$('sc-what');if(teaser)teaser.hidden=true;
  const head=el('header','hd');
  const ttl=el('div','hd-t');ttl.appendChild(el('h2',null,symb));ttl.appendChild(el('span','hd-n',name));
  head.appendChild(ttl);
  head.appendChild(frag(el('div','hd-l'),link(short(addr),'https://bscscan.com/token/'+addr),
    link('DexScreener ↗','https://dexscreener.com/bsc/'+addr)));
  o.appendChild(head);
  const w=el('div','warn');
  w.appendChild(el('b',null,'No pool here can be measured exactly.'));
  w.appendChild(el('span',null,(hasPool
    ? 'The readable pool holds '+usd(hard)+' — '+pc(share*100)+' of the '+usd(hard+otherLiq)+' GoPlus sees across all venues. The rest sits'
    : 'It has no readable PancakeSwap pool. Its '+usd(otherLiq)+' of liquidity sits')+
    ' in venues this page cannot quote exactly. Deriving depth from the sliver that is readable would produce a number that is not merely imprecise but wrong, so none is shown. The contract properties below are unaffected — they belong to the token, not to a venue.'));
  o.appendChild(w);
  if(others.length){
    const ov=card('Where it actually trades','As reported by GoPlus.');
    const l=el('div','vn');
    others.slice(0,6).forEach(x=>{
      const r=el('div','vn-r');
      r.appendChild(el('span','vn-n',x.name||'Unknown'));
      r.appendChild(el('span','vn-v',usd(x.liquidity||0)));
      r.appendChild(/^0x[a-fA-F0-9]{40}$/.test(x.pair)
        ? link(short(x.pair),'https://bscscan.com/address/'+x.pair,'lk dim')
        : el('span','lk dim','position-based'));
      l.appendChild(r);
    });
    ov.appendChild(l);o.appendChild(ov);
  }
  o.appendChild(flagsCard(gp,!!(gp.token_name||gp.dex||gp.is_open_source!=null)));
  o.appendChild(el('p','dis','Contract properties come from GoPlus. Not advice.'));
}

// ---- orchestration ---------------------------------------------------------
// Every stage sets this. It exists for one reason: a scan that ends with an
// empty page and no message is the worst thing this tool can do — the reader
// cannot tell whether the token is fine, broken, or whether we are. Measured at
// 2 blanks in 16 runs before this net went in. Now an empty result is caught
// here, named by the stage it died in, and shown as an error like any other.
let stage='start';
const at=s=>{stage=s;step(s)};

async function scan(input){
  stage='start';
  busy(true,'identifying the address…');
  try{
    const askGoPlus=a=>fetch(GOPLUS+a).then(r=>r.ok?r.json():null)
      .then(j=>j&&j.result&&(j.result[a]||j.result[a.toLowerCase()])).catch(()=>null);
    // Fired against the input on the chance it IS the token, because it usually
    // is and this is the slow leg. If the input turns out to be a pool, the
    // answer describes the LP token instead — "Pancake LPs / Cake-LP", with the
    // wrong name, the wrong supply and the wrong tax — so it is asked again
    // against the real token once that is known, and this first answer dropped.
    let gpP=askGoPlus(input);

    let what;
    try{what=await classify(input)}
    catch(e){return fail('The chain did not answer.','The public BSC node refused or timed out. Nothing is cached here, so a retry in a few seconds usually works.')}

    // A pasted pool tells us the venue directly. Which side is "the token" is
    // then the only open question: it is the side that is not the quote, and
    // the quote is whichever side can be priced.
    let token,pool=null,tokDec,bnbUsd,hop,deeper=null;
    const base=await rpcBatch([call(BNB_PAIR,S.reserves),call(BNB_PAIR,S.token0)]);
    const br=res2(base[0]),bIs0=addrAt(base[1])===WBNB;
    bnbUsd=br?(bIs0?br[1]/br[0]:br[0]/br[1]):0;
    if(!(bnbUsd>0))return fail('Could not price BNB.','The reference pool read back empty, so nothing could be stated in dollars.');

    if(what.kind==='v2pair'||what.kind==='v3pool'){
      at('reading the pool…');
      const [a,b]=[what.token0,what.token1];
      const qa=QUOTES.find(([x])=>x===a),qb=QUOTES.find(([x])=>x===b);
      if(qa&&!qb)token=b; else if(qb&&!qa)token=a;
      else if(qa&&qb)token=a;
      else{
        // Neither side is a currency we know. The quote is the one that has its
        // own BNB pool — $MatthewCoin/$SpaceX resolves this way.
        const pa=await priceToken(a,bnbUsd),pb=await priceToken(b,bnbUsd);
        token=(pb.usd!=null&&pa.usd==null)?a:(pa.usd!=null&&pb.usd==null)?b
             :((pb.hopBnb||0)>=(pa.hopBnb||0)?a:b);
      }
      const quote=token===a?b:a;
      const info=await rpcBatch([call(token,S.decimals),call(token,S.symbol),call(token,S.name)]);
      tokDec=Number(hx(info[0]))||18;
      hop=await priceToken(quote,bnbUsd);
      if(hop.usd==null)return fail('That pool cannot be priced.',
        'It trades '+(decStr(info[1])||'this token')+' against '+short(quote)+
        ', which has no BNB pool of its own — so there is no way to express its depth in dollars without inventing one.');
      if(what.kind==='v2pair'&&!what.venue)
        return fail('That pool is on a venue this page does not price.',
          'Its factory is '+short(what.factory||'')+', which is not one of the constant-product venues whose swap fee has been derived and verified here (PancakeSwap V2, Uniswap V2, Biswap). Applying somebody else’s fee would quietly understate what a trade costs, so no figures are shown.');
      pool=what.kind==='v2pair'
        ?{kind:'v2',pair:input,quote,sym:hop.sym,usd:hop.usd,
          fee:what.venue.fee,venue:what.venue.name,factory:what.factory,
          tok:(addrAt(what.token0)===token?what.reserves[0]:what.reserves[1])/Math.pow(10,tokDec),
          q:(addrAt(what.token0)===token?what.reserves[1]:what.reserves[0])/1e18}
        :{kind:'v3',pair:input,quote,sym:hop.sym,usd:hop.usd,fee:what.fee/1e6,feeRaw:what.fee,
          sqrt:what.sqrt,tokenIs0:what.token0===token};
      if(pool.kind==='v3'){
        const bal=await rpcBatch([call(quote,balOf(input)),call(token,balOf(input))]);
        pool.q=Number(hx(bal[0]))/1e18;pool.tok=Number(hx(bal[1]))/Math.pow(10,tokDec);
      }
      pool.usd=hop.usd;pool.sym=hop.sym;
      if(token!==input)gpP=askGoPlus(token);
      // A pasted pool is honoured — you asked about that one. But the factories
      // are still asked what else exists, because a link often points at a side
      // pool while the real depth sits one fee tier over, and staying silent
      // about that would answer the question asked instead of the one meant.
      try{
        const alt=(await discover(token,tokDec,bnbUsd))
          .find(c=>c.pair.toLowerCase()!==pool.pair.toLowerCase()&&c.hard>(pool.q||0)*pool.usd*1.15);
        if(alt)deeper=alt;
      }catch(e){}
    }else{
      token=input;
      at('asking the factories which pools exist…');
      const info=await rpcBatch([call(token,S.decimals),call(token,S.symbol),call(token,S.name)]);
      tokDec=Number(hx(info[0]))||18;
      const cands=await discover(token,tokDec,bnbUsd);
      pool=cands[0]||null;
      hop={direct:true,sym:pool?pool.sym:'BNB'};
      if(pool&&pool.kind==='v3'){
        const s=await rpcBatch([call(pool.pair,S.slot0),call(pool.pair,S.token0)]);
        pool.sqrt=hx('0x'+s[0].slice(2,66));pool.tokenIs0=addrAt(s[1])===token;
      }
    }

    const gp=(await gpP)||{},gpOk=!!(gp.token_name||gp.dex||gp.is_open_source!=null);
    const nameInfo=await rpcBatch([call(token,S.symbol),call(token,S.name),
      call(token,S.totalSupply),call(token,balOf(DEAD)),call(token,balOf(NULLA))]);
    const symb=(gp.token_symbol||decStr(nameInfo[0])||'?').trim().slice(0,16),
          name=(gp.token_name||decStr(nameInfo[1])||'Unknown token').trim().slice(0,60),
          supply=nameInfo[2]?Number(hx(nameInfo[2]))/Math.pow(10,tokDec):null,
          burned=(Number(hx(nameInfo[3]))+Number(hx(nameInfo[4])))/Math.pow(10,tokDec);

    // Venues from DexScreener, which indexes the small DEXes; GoPlus's list is
    // the fallback and only covers what it happens to know.
    at('checking where else it trades…');
    const dsAll=await venues(token);
    const others=dsAll
      ? dsAll.filter(x=>!pool||x.pair!==pool.pair.toLowerCase())
        .map(x=>({pair:x.pair,name:x.name+(x.quote?' · '+x.quote:''),liquidity:x.liq}))
      : (gp.dex||[]).filter(x=>x.pair&&(!pool||x.pair.toLowerCase()!==pool.pair.toLowerCase()))
        .map(x=>({pair:x.pair,name:x.name||x.liquidity_type||'Unknown',liquidity:parseFloat(x.liquidity)||0}))
        .sort((a,b)=>b.liquidity-a.liquidity);
    const otherLiq=others.reduce((s,x)=>s+(x.liquidity||0),0);
    const hard=pool?(pool.q||0)*pool.usd:0;
    // "Is the pool I can measure representative?" — and the comparison must use
    // ONE yardstick. It used to weigh our own one-sided figure (the quote tokens
    // actually sitting in the pool) against GoPlus's two-sided one, which values
    // both halves. On a V3 pool those differ by a factor of eight: $153k of real
    // USDT against their $868k. Every V3 pool therefore looked like a rounding
    // error next to the others and got refused — $MarsCoin's did, while trading
    // perfectly well. So when GoPlus has a figure for OUR pool, both sides of
    // the ratio come from GoPlus; only when it does not do we fall back to
    // measuring ours against theirs, which is the imperfect case.
    const mineFrom=list=>{if(!list||!pool)return null;
      const e=list.find(x=>(x.pair||'').toLowerCase()===pool.pair.toLowerCase());
      return e?(e.liq!=null?e.liq:parseFloat(e.liquidity)||0):null};
    const mine=mineFrom(dsAll)!=null?mineFrom(dsAll):mineFrom(gp.dex);
    const share=!pool?0
      :(mine!=null&&mine+otherLiq>0)?mine/(mine+otherLiq)
      :(otherLiq>0?hard/(hard+otherLiq):1);
    // A readable pool that holds a sliver of the real liquidity describes a side
    // pocket. $TUT keeps $2.0M in V3 and $338 in V2; a ladder off that pair says
    // "+68% on a $100 buy" for a token with two million dollars of depth. A
    // footnote does not survive a screenshot, so the ladder is not drawn at all.
    // Two questions, and the old guard only asked one of them. "What share of
    // the token's liquidity is this?" catches the side-pocket case — $v$ keeps
    // $19k here against $1.5M elsewhere, and a ladder off that would describe a
    // market nobody trades in. But share alone refused $BTCB, whose pool here
    // holds THIRTEEN MILLION DOLLARS and is merely one of several: perfectly
    // measurable, just not the whole story. So a pool also qualifies on its own
    // absolute depth, and when it qualifies that way the reader is told plainly
    // what share it is.
    const mineUsd=mine!=null?mine:hard*2;
    const deepEnough=mineUsd>=100000;
    // An address that is not a token at all used to land in the "trades
    // elsewhere" path and be told its "$0.00 of liquidity sits in venues this
    // page cannot quote exactly" — a sentence about a market that does not
    // exist. A wallet address pasted by mistake deserves to be told that.
    if(!pool&&!others.length&&!gpOk&&!(supply>0)&&!decStr(nameInfo[0]))
      return fail('That address is not a BSC token.',
        'It answers nothing to symbol() or totalSupply(), has no pool at any venue this page can read, and GoPlus does not list it. A wallet address, or a contract that is not a token, looks exactly like this.');
    if(!pool||(share<0.25&&!deepEnough))
      return renderElsewhere(gp,token,name,symb,hard,others,otherLiq,share,!!pool);
    const partial=share<0.25?share:null;

    // PRICE. For a constant-product pair the ratio of the two reserves IS the
    // price. For a concentrated-liquidity pool it is not, and using it anyway
    // put $TUT at $0.081 when the pool was quoting $0.127 — a 36% error that
    // then reappeared as a nonsensical "you pay 32.8%". V3 keeps its price in
    // sqrtPriceX96, so that is where it is read from.
    let px;
    if(pool.kind==='v3'){
      const d0=pool.tokenIs0?tokDec:18,d1=pool.tokenIs0?18:tokDec,
            r=Math.pow(Number(pool.sqrt)/Math.pow(2,96),2)*Math.pow(10,d0-d1);
      px=(pool.tokenIs0?r:1/r)*pool.usd;
    }else px=(pool.q/pool.tok)*pool.usd;
    if(!(px>0))return fail('That pool is empty.','Both sides read back as zero — there is nothing to measure.');

    at('measuring the tax from real trades…');
    const tokenIs0=pool.kind==='v2'
      ? (await rpcBatch([call(pool.pair,S.token0)]).then(r=>addrAt(r[0])===token))
      : pool.tokenIs0;
    const tax=await measureTax(token,pool.pair.toLowerCase(),tokenIs0,pool.kind);
    const gB=Number(gp.buy_tax),gS=Number(gp.sell_tax);
    const taxB=tax.ok&&tax.buy!=null?tax.buy:(isFinite(gB)?gB:0),
          taxS=tax.ok&&tax.sell!=null?tax.sell:(isFinite(gS)?gS:0),
          usedTax=tax.ok||isFinite(gB)||isFinite(gS);

    at('quoting trade sizes…');
    let rows,up,down,upMin=null,downMin=null;
    if(pool.kind==='v2'){
      rows=ladderV2(pool.tok,pool.q,pool.fee,taxB,taxS,px,pool.usd);
      up=onePctV2(pool.q,pool.fee,1.01)*pool.usd;
      down=onePctV2(pool.tok,pool.fee,1/0.99)/(1-taxS)*px;
    }else{
      rows=await ladderV3(pool.pair,token,pool.quote,pool.feeRaw,tokDec,px,pool.usd,
        taxB,taxS,pool.sqrt,pool.tokenIs0);
      const oc=await onePctV3(pool.pair,token,pool.quote,pool.feeRaw,tokDec,px,pool.usd,
        pool.sqrt,pool.tokenIs0,taxS);
      up=oc.up;down=oc.down;upMin=oc.upMin;downMin=oc.downMin;
    }

    let lpTot=0,lpDead=0,lpNull=0,lpFee=0,feeTo=null;
    if(pool.kind==='v2'){
      const lp=await rpcBatch([call(pool.pair,S.totalSupply),call(pool.pair,balOf(DEAD)),
        call(pool.pair,balOf(NULLA)),
        // The venue's own cut. A constant-product pair mints LP to the factory's
        // feeTo() on every liquidity event, so on any pool that has run for a
        // while some unburned LP belongs to the exchange, not to anybody near
        // the token. Listed as "withdrawable" without saying so, it reads as a
        // rug waiting to happen.
        pool.factory?call(pool.factory,S.feeTo):call(pool.pair,S.totalSupply)]);
      lpTot=Number(hx(lp[0]))/1e18;lpDead=Number(hx(lp[1]))/1e18;lpNull=Number(hx(lp[2]))/1e18;
      if(pool.factory){
        feeTo=addrAt(lp[3]);
        if(feeTo&&feeTo!==NULLA){
          const fb=await rpcBatch([call(pool.pair,balOf(feeTo))]);
          lpFee=Number(hx(fb[0]))/1e18;
        }else feeTo=null;
      }
    }

    render({gp,gpOk,addr:token,pool,name,symb,px,q:pool.q,tok:pool.tok,
      quoteUsd:pool.usd,quoteSym:pool.sym,rows,up,down,upMin,downMin,tax,usedTax,
      supply,burned,lpTot,lpDead,lpNull,lpFee,feeTo,others,hop,deeper,taxB,taxS,partial,mineUsd,otherLiq});
    try{history.replaceState(null,'','?token='+token)}catch(e){}
  }catch(e){
    fail('Something went wrong reading this token.',
      (e&&e.message?e.message+'. ':'')+'Nothing here is cached, so trying again often works. If it keeps failing, the address may not be a BSC token or pool.');
  }finally{
    busy(false);
    again.hidden=false;
    // The net. If nothing was drawn and no error was shown, say so plainly
    // rather than leaving a blank page that looks like the token's fault.
    const out=$('sc-out');
    if((out.hidden||!out.children.length)&&$('sc-err').hidden)
      fail('The scan ended without a result.',
        'It stopped at “'+stage+'” without producing figures and without an error — almost always a public BSC node dropping a request mid-scan. Press Scan again; it normally works on the second try.');
  }
}

// Accept what people actually paste: a bare address, a BscScan link, a
// DexScreener link (which carries the POOL, not the token), a PancakeSwap URL.
const parseInput=s=>{const m=String(s||'').match(/0x[a-fA-F0-9]{40}/);return m?m[0].toLowerCase():null};
function submit(){
  const a=parseInput($('sc-in').value);
  if(!a)return fail('That is not a contract address.',
    'Paste a BSC token address, a pool address, or a BscScan / DexScreener link that contains one.');
  scan(a);
}
$('sc-go').addEventListener('click',submit);
$('sc-in').addEventListener('keydown',e=>{if(e.key==='Enter')submit()});

// ── Scanning a second token ────────────────────────────────────────────────
// The scanned address stays in the field on purpose, but that made the next
// scan a chore: select the whole thing, delete it, then paste. Three ways out,
// because the field is far above the fold once a result is drawn: a cross in
// the field, a button under the result, and select-on-click so a paste simply
// replaces what is there.
const again=$('sc-again'),clearBtn=$('sc-clear');
const showClear=()=>{clearBtn.hidden=!$('sc-in').value};
function startOver(scroll){
  $('sc-in').value='';showClear();
  const o=$('sc-out');o.hidden=true;o.textContent='';
  $('sc-err').hidden=true;$('sc-status').textContent='';
  const teaser=$('sc-what');if(teaser)teaser.hidden=false;
  again.hidden=true;
  // The URL still carried the old token; left alone, a reload would scan a
  // token that is no longer on the screen.
  try{history.replaceState(null,'',location.pathname)}catch(e){}
  if(scroll)$('sc-in').scrollIntoView({block:'center',behavior:'smooth'});
  $('sc-in').focus();
}
clearBtn.addEventListener('click',()=>startOver(false));
$('sc-again-btn').addEventListener('click',()=>startOver(true));
$('sc-in').addEventListener('input',showClear);
$('sc-in').addEventListener('focus',()=>{if(!again.hidden)$('sc-in').select()});
showClear();
(function(){const t=parseInput(new URLSearchParams(location.search).get('token'));
  // Setting .value from script fires no input event, so the clear cross has
  // to be told by hand — otherwise arriving via ?token= shows an address with
  // no way to clear it, which is the one arrival that matters most.
  if(t){$('sc-in').value=t;showClear();scan(t)}})();
