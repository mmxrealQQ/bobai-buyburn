#!/usr/bin/env node
// The Agent Advantage Report — measured, not asserted.
//
// Three questions a person on BNB Smart Chain actually has. Each one answered
// twice: once by asking an agent, once by doing what the agent does by hand.
// Both paths run from this machine, over the same network, in the same minute,
// and every number below is wall-clock and request-counted rather than
// estimated.
//
// HOW THE HAND-DONE PATH IS MEASURED, AND WHY THE RESULT UNDERSTATES THE CASE
// The manual path here is a script making the same calls a person would have to
// make. That is not what a person costs — it is the floor of what they could
// cost, with no page loads, no reading, no typing an address into a block
// explorer, no deciding which explorer to open. Every ratio this report prints
// is therefore a lower bound on the advantage, and it is written that way
// throughout. Inflating the human side would have been easy and would have made
// the whole document worthless.
//
// WHAT IS NOT TIME
// Speed is the least interesting column. Two of the three tasks below produce a
// DIFFERENT ANSWER by hand — not a slower one, a wrong one — because the manual
// route has to lean on a number a public interface shows (capital parked in a
// pool) as a proxy for the number the person actually wants (what that pool
// pays). That is the part of the advantage that does not shrink as people get
// faster.
//
//   node scripts/advantage-report.mjs                run all three, write the report
//   node scripts/advantage-report.mjs --self-test    pin the harness
//   node scripts/advantage-report.mjs --task 1       run one task
//
// Writes data/advantage/report.json. The page that renders it is
// dashboard/advantage.html.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'advantage');
const SELF_TEST = process.argv.includes('--self-test');
const ONLY = (() => {
  const i = process.argv.indexOf('--task');
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : null;
})();

const SITE = 'https://brainonbnb.com';
const AGENT = 'https://agent.brainonbnb.com';
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';

// Chain constants, same addresses the scanner uses.
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const V2FACTORY = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73';
const V3FACTORY = '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865';
const V3_FEES = [100, 500, 2500, 10000];
const CHAINLINK_BNB_USD = '0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee';
const ERC8004_REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const DEAD = '0x000000000000000000000000000000000000dead';

// The subjects. CAKE because the LP question is a real one for that pair and
// the pool set is deep enough to have a wrong answer available.
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';

// ---- measurement harness ---------------------------------------------------
// Counts requests as well as milliseconds. A path that answers in one call is
// not merely faster; it is one thing to get wrong instead of fourteen.
function meter() {
  let requests = 0;
  const started = Date.now();
  return {
    count: () => { requests++; },
    done: () => ({ ms: Date.now() - started, requests }),
  };
}

// An RPC caller that counts, and that FAILS LOUDLY. A measurement that swallows
// an error finishes early and looks fast — the fastest path in any comparison
// is always the broken one, which is why this throws instead of returning null.
async function rpc(m, method, params) {
  m.count();
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

// The timeout is a parameter because an armed AbortSignal.timeout keeps the
// process alive until it fires, and on Windows calling process.exit() while one
// is still closing trips a libuv assertion — the script would report a passing
// self-test and then exit 127, which is a failing exit code on a passing test.
async function getJson(m, url, timeoutMs = 60000) {
  m.count();
  // Calls into our own worker carry its secret, so /hire files them as our
  // quote runs and not as outside callers on the public track record
  // (2026-09-18: they never did, and were counted as strangers).
  const ours = /^https:\/\/agent\.brainonbnb\.com\//.test(url) && process.env.HIT_SECRET ? { headers: { 'x-hit-secret': process.env.HIT_SECRET } } : {};
  const r = await fetch(url, { ...ours, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  if (/^\s*<!doctype html/i.test(text)) {
    // brainonbnb.com answers any unrouted path with 200 and the site HTML, so a
    // status code proves nothing here.
    throw new Error(`${url} returned the site HTML, not JSON`);
  }
  return JSON.parse(text);
}

const pad = (hex) => hex.replace(/^0x/, '').padStart(64, '0');
const call = (m, to, data) => rpc(m, 'eth_call', [{ to, data }, 'latest']);
const num = (hex, dec = 18) => Number(BigInt(hex || '0x0')) / 10 ** dec;
const slice = (hex, i) => '0x' + hex.replace(/^0x/, '').slice(i * 64, (i + 1) * 64);

// Selectors, hand-encoded like the rest of this codebase does it.
const SEL = {
  getPair: '0xe6a43905',
  getPool: '0x1698ee82',
  getReserves: '0x0902f1ac',
  token0: '0x0dfe1681',
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
  latestRoundData: '0xfeaf968c',
  liquidity: '0x1a686502',
  tokenURI: '0xc87b56dd',
};

// ---- task 1: where should a liquidity provider put money? ------------------
// The trading task the bounty asks for. A pair lives in up to five pools at
// once and every public interface ranks them by the money already parked in
// them, which is not a statement about what they pay.
async function task1Agent() {
  const m = meter();
  // The tool withholds its verdict when a tier could not be read, and its own
  // caveat says to ask again. So this asks again — up to twice more, with every
  // attempt counted in the request total, because a caller who retried twice
  // made three requests and an honest comparison has to carry that. Taking the
  // first incomplete answer as a refusal would score the tool's honesty as a
  // failure, which is precisely backwards.
  let j = await getJson(m, `${SITE}/api/fee-tiers?address=${CAKE}`);
  for (let attempt = 0; attempt < 2 && j.comparison_complete === false; attempt++) {
    j = await getJson(m, `${SITE}/api/fee-tiers?address=${CAKE}`);
  }
  return {
    ...m.done(),
    answer: {
      answered: Boolean(j.best_paying_tier),
      best_paying_tier: j.best_paying_tier,
      most_capital_tier: j.most_capital_tier,
      capital_is_in_the_best_paying_tier: j.capital_is_in_the_best_paying_tier,
      // The tool dates the window from block timestamps and leaves minutes
      // null when a tier could not be read in time. The page once printed
      // "a single -minute window" from that null. Estimated from the block
      // count instead, at BSC's 0.45 s a block, and labelled as an estimate.
      window: j.measured_window && j.measured_window.minutes == null && j.measured_window.blocks
        ? { ...j.measured_window, minutes: Number(((j.measured_window.blocks * 0.45) / 60).toFixed(1)), minutes_source: 'estimated from the block count at 0.45 s a block — the tool could not date every tier' }
        : j.measured_window,
      tiers: (j.tiers || []).map((t) => ({
        tier: t.tier, capital_usd: t.capital_usd, swaps: t.swaps,
        fees_paid_usd: t.fees_paid_usd, fees_per_1000_usd_parked: t.fees_per_1000_usd_parked,
      })),
    },
  };
}

// By hand: find every pool for the pair, read what is parked in each, and — the
// step that is actually hard — price the swaps that went through each one over
// a window to see what it paid. Anyone stopping before that last step answers
// the wrong question, which is what the "capital" answer below records.
async function task1Manual() {
  const m = meter();
  const pools = [];

  const v2 = await call(m, V2FACTORY, SEL.getPair + pad(CAKE) + pad(WBNB));
  const v2Addr = '0x' + v2.slice(-40);
  if (!/^0x0+$/.test(v2Addr)) pools.push({ tier: 'V2 0.25%', address: v2Addr, feePct: 0.25, kind: 'v2' });

  for (const fee of V3_FEES) {
    const p = await call(m, V3FACTORY, SEL.getPool + pad(CAKE) + pad(WBNB) + pad('0x' + fee.toString(16)));
    const a = '0x' + p.slice(-40);
    if (!/^0x0+$/.test(a)) pools.push({ tier: `V3 ${fee / 10000}%`, address: a, feePct: fee / 10000, kind: 'v3' });
  }

  const bnbRound = await call(m, CHAINLINK_BNB_USD, SEL.latestRoundData);
  const bnbUsd = num(slice(bnbRound, 1), 8);

  const head = parseInt(await rpc(m, 'eth_blockNumber', []), 16);
  // The same window the agent measures over, so the two are comparable.
  const fromBlock = head - 5000;

  for (const p of pools) {
    const cake = await call(m, CAKE, SEL.balanceOf + pad(p.address));
    const wbnb = await call(m, WBNB, SEL.balanceOf + pad(p.address));
    p.token_held = num(cake);
    p.quote_held = num(wbnb);
    p.capital_usd = p.quote_held * bnbUsd * 2;

    // Swap events. v2 and v3 have different signatures and different payload
    // layouts, which is one more thing to get right by hand.
    const topic = p.kind === 'v2'
      ? '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
      : '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83';
    let logs = [];
    try {
      logs = await rpc(m, 'eth_getLogs', [{ address: p.address, topics: [topic], fromBlock: '0x' + fromBlock.toString(16), toBlock: 'latest' }]);
    } catch {
      // Node refused the range. Recorded as unmeasured — NOT as zero swaps.
      // "Nobody traded here" and "we could not look" are different answers and
      // must never render the same.
      p.swaps = null;
      p.fees_paid_usd = null;
      continue;
    }
    p.swaps = logs.length;
    let volumeQuote = 0;
    for (const log of logs) {
      const d = log.data.replace(/^0x/, '');
      if (p.kind === 'v2') {
        const a1In = Number(BigInt('0x' + d.slice(64, 128))) / 1e18;
        const a1Out = Number(BigInt('0x' + d.slice(192, 256))) / 1e18;
        volumeQuote += a1In + a1Out;
      } else {
        // v3 amounts are signed; the quote side is whichever of the two is WBNB.
        const t0 = await call(m, p.address, SEL.token0);
        const quoteIsToken0 = ('0x' + t0.slice(-40)).toLowerCase() === WBNB;
        const raw = BigInt('0x' + d.slice(quoteIsToken0 ? 0 : 64, quoteIsToken0 ? 64 : 128));
        const signed = raw > (1n << 255n) ? raw - (1n << 256n) : raw;
        volumeQuote += Math.abs(Number(signed)) / 1e18;
      }
    }
    p.volume_usd = volumeQuote * bnbUsd;
    p.fees_paid_usd = p.volume_usd * (p.feePct / 100);
    p.fees_per_1000_usd_parked = p.capital_usd > 0 ? (p.fees_paid_usd / p.capital_usd) * 1000 : 0;
  }

  const measured = pools.filter((p) => p.fees_per_1000_usd_parked !== null && p.fees_per_1000_usd_parked !== undefined);
  const best = measured.slice().sort((a, b) => b.fees_per_1000_usd_parked - a.fees_per_1000_usd_parked)[0];
  const biggest = pools.slice().sort((a, b) => b.capital_usd - a.capital_usd)[0];

  return {
    ...m.done(),
    answer: {
      best_paying_tier: best?.tier ?? null,
      most_capital_tier: biggest?.tier ?? null,
      // The question was which tier PAYS. Without the swap history there is no
      // answer to it, only a ranking by what is parked — a different question
      // that happens to be the easy one.
      answered: Boolean(best),
      could_not_answer: best ? null : 'the public node refused the log range, so no tier could be priced — only the capital ranking survived, which is the number every public interface already shows',
      capital_is_in_the_best_paying_tier: best && biggest ? best.tier === biggest.tier : null,
      pools_found: pools.length,
      tiers: pools.map((p) => ({
        tier: p.tier, capital_usd: p.capital_usd, swaps: p.swaps,
        fees_paid_usd: p.fees_paid_usd, fees_per_1000_usd_parked: p.fees_per_1000_usd_parked,
      })),
    },
    // What someone stopping at the public interface would have concluded. Every
    // pool list a person can open — the DEX itself, the aggregators, the
    // analytics sites — sorts by this number.
    the_answer_a_public_interface_gives: biggest?.tier ?? null,
  };
}

// The size both paths price. Set from what the agent actually returns, so the
// two are answering the same question.
let TRADE_SIZE_USD = 2500;

// ---- task 2: what does this trade cost, and can the pool be pulled? --------
// The security task. Two questions that a token's own page never answers: the
// real cost of a trade at a size that matters, and whether the liquidity behind
// it can be withdrawn tomorrow.
async function task2Agent() {
  const m = meter();
  // The question is the real cost, and the transfer tax is part of it. When
  // the log endpoint refuses the trade window, the tool says the tax could not
  // be established rather than printing 0% — and this asks again, up to twice,
  // every attempt counted, exactly as task 1 does. If the tax is still not
  // established, the agent did NOT answer the question, and the report says so.
  let j = await getJson(m, `${SITE}/api/pool-scan?address=${CAKE}`);
  const taxKnown = (x) => (x.tax ?? x.transferTax)?.buyPct != null;
  for (let attempt = 0; attempt < 2 && !taxKnown(j); attempt++) {
    j = await getJson(m, `${SITE}/api/pool-scan?address=${CAKE}`);
  }
  // Whatever the largest size the agent priced is, the hand-done path is asked
  // for the same one below. Comparing 0.28% at $2,500 against 0.31% at $5,000
  // would be comparing two different questions and calling it a difference.
  const at5k = (j.tradeCost || []).slice(-1)[0];
  TRADE_SIZE_USD = at5k?.sizeUsd || TRADE_SIZE_USD;
  if (at5k?.sizeUsd && at5k.sizeUsd !== 2500) console.warn(`  note: the agent's largest priced size is $${at5k.sizeUsd}, the question says $2,500 — update the question text`);
  return {
    ...m.done(),
    answer: {
      price_usd: j.price?.usd,
      pool: j.pool?.venue,
      // The tool's liquidityUsd is the QUOTE SIDE ONLY (its liquidityBasis says
      // so) — the BNB in the pool, the half that holds when the token falls.
      // Named that way here so the hand-done column below measures the same
      // thing; the first version compared it against a both-sides figure and
      // printed a 2x "difference" that was two definitions.
      hard_backing_usd: j.pool?.liquidityUsd,
      liquidity_basis: j.pool?.liquidityBasis ?? 'quote side only',
      share_of_liquidity_readable: j.pool?.shareOfLiquidity,
      sell_cost_pct_at_size: at5k ? { sizeUsd: at5k.sizeUsd, sellCostPct: at5k.sellCostPct } : null,
      transfer_tax: j.tax ?? j.transferTax ?? null,
      lp_burned_pct: j.lp?.burnedPct ?? j.lpBurnedPct ?? null,
      answered: taxKnown(j) && j.price?.usd != null,
      could_not_answer: taxKnown(j) ? null : 'the transfer tax could not be established in this run (the log endpoint refused the trade window three times), and a cost without the tax is not the cost',
    },
  };
}

async function task2Manual() {
  const m = meter();
  const pair = '0x' + (await call(m, V2FACTORY, SEL.getPair + pad(CAKE) + pad(WBNB))).slice(-40);
  const reserves = await call(m, pair, SEL.getReserves);
  const t0 = ('0x' + (await call(m, pair, SEL.token0)).slice(-40)).toLowerCase();
  const r0 = num(slice(reserves, 0));
  const r1 = num(slice(reserves, 1));
  const tokenReserve = t0 === CAKE ? r0 : r1;
  const quoteReserve = t0 === CAKE ? r1 : r0;

  const bnbRound = await call(m, CHAINLINK_BNB_USD, SEL.latestRoundData);
  const bnbUsd = num(slice(bnbRound, 1), 8);
  const priceUsd = (quoteReserve / tokenReserve) * bnbUsd;
  // The BNB side of the pool, the same figure the agent reports.
  const hardBackingUsd = quoteReserve * bnbUsd;

  // LP safety: how much of the LP token is at the dead address.
  const lpSupply = num(await call(m, pair, SEL.totalSupply));
  const lpDead = num(await call(m, pair, SEL.balanceOf + pad(DEAD)));
  const lpBurnedPct = lpSupply > 0 ? (lpDead / lpSupply) * 100 : 0;

  // Cost of the same sell the agent priced, by the constant-product formula
  // with the 0.25% fee.
  const sizeUsd = TRADE_SIZE_USD;
  const amountIn = sizeUsd / priceUsd;
  const inAfterFee = amountIn * 0.9975;
  const out = (inAfterFee * quoteReserve) / (tokenReserve + inAfterFee);
  const outUsd = out * bnbUsd;
  const sellCostPct = ((sizeUsd - outUsd) / sizeUsd) * 100;

  return {
    ...m.done(),
    answer: {
      price_usd: priceUsd,
      pool: 'PancakeSwap V2',
      hard_backing_usd: hardBackingUsd,
      liquidity_basis: 'quote side only — the WBNB reserve at the price feed',
      // The number this path cannot produce: what share of the token's total
      // liquidity this one readable pool is. Answering it means finding every
      // other pool on every other venue first — a second search, not a step.
      share_of_liquidity_readable: null,
      sell_cost_pct_at_size: { sizeUsd, sellCostPct },
      // Nor this one: a transfer tax is only visible by comparing what a swap
      // sent with what the recipient received, across executed trades. It is
      // not a field on the contract, and reading a label instead is how a 10%
      // tax gets called 0%.
      transfer_tax: null,
      lp_burned_pct: lpBurnedPct,
      answered: false,
      could_not_answer: 'the transfer tax and the share of liquidity this pool represents are both missing. Neither is a field to read: the tax only exists in the difference between what a swap sent and what arrived, and the share needs every other pool on every other venue found first.',
    },
  };
}

// How many ids the registry holds right now. ownerOf() answers "does this id
// exist" directly; doubling past the end and then bisecting costs about twenty
// calls and never has to trust a number somebody typed.
async function highestRegistryId(m) {
  const OWNER_OF = '0x6352211e';
  const exists = async (id) => {
    try {
      const r = await call(m, ERC8004_REGISTRY, OWNER_OF + pad('0x' + id.toString(16)));
      return Boolean(r && r !== '0x' && BigInt(r) !== 0n);
    } catch { return false; }
  };
  let hi = 1;
  while (await exists(hi * 2) && hi < 1 << 24) hi *= 2;
  let lo = hi;
  hi *= 2;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

// ---- task 3: find someone on this chain who can do the job -----------------
// The marketplace task. The registry has no index, and its size is read from
// the chain rather than written here: a hardcoded total is a measurement that
// silently ages, and this file exists to argue against exactly that. It was
// 310,517 when this task was first written and 316,472 six days later.
async function task3Agent() {
  const m = meter();
  const found = await getJson(m, `${AGENT}/find?q=${encodeURIComponent('monitor a Venus health factor and warn me before liquidation')}&limit=5`);
  const candidates = found.candidates || found.results || found.agents || [];
  // "Tell me what it charges" is half the question. The broker's hire path
  // asks the candidate for a price over A2A; the first of the top three that
  // quotes is the answer, and every candidate asked is counted as a request.
  let charges = null;
  const asked = [];
  for (const c of candidates.slice(0, 3)) {
    const id = c.id ?? c.agentId;
    try {
      const h = await getJson(m, `${AGENT}/hire?agent=${id}&task=${encodeURIComponent('health factor and liquidation distance for the Venus position at 0xd319e1F8e987cf78333cEA853F455366640929cF')}`, 45000);
      asked.push({ id, name: c.name, quoted: Boolean(h.quote?.price), price: h.quote?.price ?? null, reason: h.quote?.price ? null : (h.reason || h.error || 'no quote') });
      if (h.quote?.price) {
        charges = { id, name: c.name, price: h.quote.price, currency: h.escrow?.payment_token_symbol ?? null, provider: h.provider ?? null, service: h.quote.service ?? null, how: 'quoted over A2A through the marketplace hire path, escrow ERC-8183' };
        break;
      }
    } catch (e) {
      asked.push({ id, name: c.name, quoted: false, price: null, reason: String(e.message || e).slice(0, 120) });
    }
  }
  return {
    ...m.done(),
    answer: {
      answered: candidates.length > 0 && Boolean(charges),
      could_not_answer: candidates.length === 0 ? 'no candidate was found' : charges ? null : 'candidates were found but none of the top three quoted a price when asked',
      candidates: candidates.length,
      top: candidates.slice(0, 3).map((c) => ({ id: c.id ?? c.agentId, name: c.name })),
      asked_for_a_price: asked,
      charges,
    },
  };
}

// By hand there is no search. The registry is an ERC-721: ids and tokenURIs.
// Finding a health-factor agent means reading them. This measures the real rate
// over a sample and states the extrapolation as an extrapolation.
async function task3Manual() {
  const m = meter();
  const SAMPLE = 150;
  const started = Date.now();
  let read = 0, withDocument = 0;
  // Sampled from the newest ids, which are the most likely to be live — a
  // person starting at id 1 would fare worse, so this is the generous version.
  // Highest minted id, asked of the registry itself. ownerOf() reverts for an
  // id that was never minted, so a plain doubling-then-bisect finds the top.
  const highest = await highestRegistryId(m);
  for (let id = highest; id > highest - SAMPLE; id--) {
    try {
      const uri = await call(m, ERC8004_REGISTRY, SEL.tokenURI + pad('0x' + id.toString(16)));
      read++;
      if (uri && uri.length > 130) withDocument++;
    } catch { /* an id that will not read still cost the request */ }
  }
  const elapsed = Date.now() - started;
  const perId = elapsed / Math.max(read, 1);
  const total = highest;

  return {
    ...m.done(),
    answer: {
      answered: false,
      could_not_answer: 'no candidate was produced. The registry has no index: 150 ids were read to measure the rate, and that is 0.05% of it.',
      registry_ids_at_measurement: total,
      sampled_ids: read,
      ids_with_a_document: withDocument,
      ms_per_id_measured: Math.round(perId),
      // Not a measurement — arithmetic on one. Labelled so nobody quotes it as
      // if the whole registry had been walked for this report.
      extrapolated_hours_to_read_the_registry: Number(((perId * total) / 3600000).toFixed(1)),
      note: 'Reading every id is only step one: the documents then have to be fetched, parsed and probed before any of them can be called, and 1,060 of the endpoints that claim to exist do not answer.',
    },
  };
}

// ---- the marketplace half --------------------------------------------------
// TermiX asks for tasks run "with an agent hired through your marketplace".
// The timed agent path above is the free endpoint; this records, per task, the
// agent on Brain Plaza that sells the same answer, what it quotes right now
// through the marketplace's own hire path, and the completed job where one
// exists. Quoted outside the timed paths so the quote never inflates either
// side's clock.
async function quoteThroughMarketplace(agentId, task) {
  const m = meter();
  try {
    const h = await getJson(m, `${AGENT}/hire?agent=${agentId}&task=${encodeURIComponent(task)}`, 45000);
    return { ...m.done(), quoted: Boolean(h.quote?.price), price: h.quote?.price ?? null, currency: h.escrow?.payment_token_symbol ?? null, provider: h.provider ?? null, service: h.quote?.service ?? null, escrow: h.escrow?.standard ?? null, reason: h.quote?.price ? null : (h.reason || h.error || 'no quote') };
  } catch (e) {
    return { ...m.done(), quoted: false, price: null, reason: String(e.message || e).slice(0, 120) };
  }
}
async function priceOfTheX402Watch() {
  // The one-off pool measurement is free by design; the continuous watch of
  // the same pool is the paid product, and its price is whatever the 402 says.
  const m = meter();
  try {
    m.count();
    const r = await fetch(`${AGENT}/watch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    const acc = Array.isArray(j.accepts) ? j.accepts[0] : null;
    // The 402 says it in words ("Send 0.50 USD1 to 0x…"); the accepts[] entry
    // carries the token's EIP-712 domain name, which for USD1 reads "USD Coin"
    // and would mislabel the price. The sentence is the source, the atomic
    // amount the fallback.
    const said = /Send ([0-9.]+ [A-Za-z0-9$]+)/.exec(j.how || '');
    const price = said ? said[1] : (acc?.maxAmountRequired ? `${Number(acc.maxAmountRequired) / 1e18} (atomic ${acc.maxAmountRequired}, asset ${acc.asset})` : null);
    return { ...m.done(), status: r.status, quoted: r.status === 402 && Boolean(price), price: price ?? null, reason: r.status === 402 ? null : `expected 402, got ${r.status}` };
  } catch (e) {
    return { ...m.done(), quoted: false, price: null, reason: String(e.message || e).slice(0, 120) };
  }
}
const MARKETPLACE = {
  1: async () => ({
    agent_id: 310460, name: 'Brain on BNB — PancakeSwap Fee Tier Placement', category: 'yield-optimization',
    hire: `${SITE}/registry#cat-yield-optimization`, what_it_delivers: 'the same fee-tier measurement, delivered on-chain through the ERC-8183 escrow',
    quote: await quoteThroughMarketplace(310460, 'which PancakeSwap fee tier is actually paying for 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82, placing $10000 of liquidity'),
    completed_job: null,
  }),
  2: async () => ({
    agent_id: 49467, name: 'Brain On BNB AI ($BOBAI)', category: 'pool measurement',
    hire: `${SITE}/services`, what_it_delivers: 'the one-off measurement is free by design; the continuous watch of the same pool is sold per x402 and over MCP as bsc_pool_watch',
    quote: await priceOfTheX402Watch(),
    completed_job: null,
  }),
  3: async () => ({
    agent_id: 302257, name: 'Brain on BNB — Venus Health Factor Monitor', category: 'health-factor',
    hire: `${SITE}/registry#cat-health-factor`, what_it_delivers: 'the health factor of a Venus position, delivered on-chain through the ERC-8183 escrow',
    quote: await quoteThroughMarketplace(302257, 'health factor and liquidation distance for the Venus position at 0xd319e1F8e987cf78333cEA853F455366640929cF'),
    completed_job: { id: 56657, status: 'COMPLETED', result: `${AGENT}/job/56657/result`, page: `${SITE}/job?id=56657`, note: 'hired through the marketplace, delivered on-chain, escrow released' },
  }),
};

// ---- self-test -------------------------------------------------------------
// The harness decides what the report claims, so it is pinned in both
// directions — most of all against the failure that would make the agent look
// good for the wrong reason.
if (SELF_TEST) {
  const fails = [];

  const m = meter();
  if (m.done().requests !== 0) fails.push('a fresh meter did not start at zero requests');
  const m2 = meter();
  m2.count(); m2.count();
  if (m2.done().requests !== 2) fails.push('the meter did not count requests');

  // A failed call must throw, not resolve. If a broken path returned early and
  // quietly, it would post the fastest time in the report and win the
  // comparison by being broken.
  let threw = false;
  try {
    const m3 = meter();
    await getJson(m3, `${SITE}/definitely-not-a-route-${Date.now()}`, 2000);
  } catch { threw = true; }
  if (!threw) fails.push('an unrouted path did not throw — the site answers those with 200 and HTML, and a measurement that accepts it would time the wrong thing');

  // The two paths must not share a meter, or the manual path inherits the
  // agent's request count and the comparison becomes flattering.
  const a = meter(); const b = meter();
  a.count();
  if (b.done().requests !== 0) fails.push('two meters share state');

  if (fails.length) {
    console.error('self-test FAILED');
    for (const f of fails) console.error('  ' + f);
    process.exitCode = 1;
  } else {
    console.log('self-test passed: requests are counted per path, a broken path throws instead of finishing fast, and the site HTML fallback cannot be mistaken for an answer');
  }
  // Not process.exit(): see the note on getJson. The process ends on its own
  // once the last timeout above has expired, with the code set here.
}

// ---- run -------------------------------------------------------------------
const TASKS = SELF_TEST ? [] : [
  {
    n: 1,
    category: 'trading / liquidity provision',
    question: 'I have $10,000 to provide as liquidity for CAKE/WBNB on PancakeSwap. Which of the five fee tiers should it go into?',
    why_it_is_hard: 'The pair lives in up to five pools at once. Every public interface ranks them by the capital already parked in them, and that is not what an LP is paid on.',
    agent: task1Agent, manual: task1Manual,
  },
  {
    n: 2,
    category: 'security / risk',
    question: 'Before I take a $2,500 position: what does that trade actually cost, and can the liquidity behind it be withdrawn tomorrow?',
    why_it_is_hard: 'The headline slippage a router shows is not the cost. Transfer tax, price impact and swap fee are three different numbers, and LP withdrawability is not on the token page at all.',
    agent: task2Agent, manual: task2Manual,
  },
  {
    n: 3,
    category: 'agent discovery / hiring',
    question: 'Find me an agent on BNB Smart Chain that monitors a Venus health factor, and tell me what it charges.',
    why_it_is_hard: 'The identity registry holds hundreds of thousands of ids with no index and no search, and it grows every hour. Nothing about it is queryable by what an agent does.',
    agent: task3Agent, manual: task3Manual,
  },
];

const results = [];
for (const t of TASKS) {
  if (ONLY && t.n !== ONLY) continue;
  process.stdout.write(`task ${t.n} — ${t.category}\n`);
  let agent = null, manual = null, agentError = null, manualError = null;
  try { agent = await t.agent(); } catch (e) { agentError = String(e.message || e); }
  try { manual = await t.manual(); } catch (e) { manualError = String(e.message || e); }

  // A path that failed is reported as failed. It is never reported as a fast
  // one, and the ratio is withheld rather than computed from a broken half.
  //
  // The subtler version of the same trap, and the one this run actually hit: a
  // path that RAN fine but never produced the answer. On task 1 the hand-done
  // route came back quicker than the agent — because its log queries were
  // refused, so it skipped the only expensive step and returned the ranking it
  // already had. Dividing those two times would have published "the manual way
  // is faster" off the back of a question that went unanswered. So the ratio
  // exists only where both sides actually answered.
  const bothAnswered = Boolean(agent?.answer?.answered && manual?.answer?.answered);
  const ratio = bothAnswered && agent.ms > 0 ? Number((manual.ms / agent.ms).toFixed(1)) : null;
  const mark = (r) => (r?.answer?.answered ? 'answered' : 'did NOT answer the question');
  console.log(`  agent  ${agent ? `${agent.ms} ms, ${agent.requests} request(s) — ${mark(agent)}` : `FAILED — ${agentError}`}`);
  console.log(`  manual ${manual ? `${manual.ms} ms, ${manual.requests} request(s) — ${mark(manual)}` : `FAILED — ${manualError}`}`);
  if (ratio) console.log(`  ratio  ${ratio}× — a lower bound: the manual path here is a script, not a person`);
  else if (agent && manual) console.log(`  ratio  withheld — ${manual.answer?.answered ? 'the agent' : 'the hand-done path'} did not produce the answer, and time against a non-answer is not a comparison`);

  let marketplace = null;
  try { marketplace = MARKETPLACE[t.n] ? await MARKETPLACE[t.n]() : null; } catch (e) { marketplace = { error: String(e.message || e) }; }
  if (marketplace) console.log(`  market ${marketplace.quote?.quoted ? `${marketplace.name} quotes ${marketplace.quote.price}` : `${marketplace.name} — no quote (${marketplace.quote?.reason || marketplace.error})`}`);

  results.push({
    task: t.n, category: t.category, question: t.question, why_it_is_hard: t.why_it_is_hard,
    agent: agent ? { ...agent, error: null } : { error: agentError },
    manual: manual ? { ...manual, error: null } : { error: manualError },
    marketplace,
    ratio_lower_bound: ratio,
    both_paths_answered: bothAnswered,
  });
}

const report = {
  what_this_is: 'Three real tasks on BNB Smart Chain, each done twice: once by asking an agent, once by hand. Wall-clock and request counts, measured on one machine in one run.',
  how_to_read_it: 'The manual path is a script making the same calls a person would have to make — no page loads, no reading, no typing. Every ratio here is therefore a floor, not an estimate of what a person costs. Where a path could not answer at all, that is recorded as an unanswered question and never as a fast one.',
  measured_at: new Date().toISOString(),
  chain: 'BNB Smart Chain (eip155:56)',
  rpc: RPC,
  tasks: results,
  cost: {
    agent_path: 'No API key, no account, no subscription. Every endpoint used here is public and free to call.',
    manual_path: 'Also free in fees — the cost is the person. The request counts above are what they would be issuing by hand.',
  },
  caveats: [
    'Both paths read the same chain over the same RPC in the same run, so network conditions apply to both equally.',
    'The manual path is a lower bound on human effort and is described that way everywhere it appears.',
    'Task 3 extrapolates from a measured per-id rate over a 150-id sample. The extrapolation is labelled; the measurement is real.',
    'Speed is the weakest of the three columns. Two of the three tasks produce a different answer by hand, not merely a later one.',
  ],
};

// A self-test run measures nothing, so it must not be allowed to write. The
// first version did, and replaced a real report with an empty one — a check
// that damages what it checks.
if (!SELF_TEST) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, 'report.json');
  // A --task run measures one task and must not replace a report holding
  // three. The first version did exactly that: one debugging run left the
  // published page's source carrying a single task, and nothing would have said
  // so until somebody regenerated the page. Single-task results are merged into
  // whatever is already on disk, by task number.
  if (ONLY) {
    let prior = null;
    try { prior = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    if (prior?.tasks?.length) {
      const merged = prior.tasks.map((t) => results.find((r) => r.task === t.task) || t);
      for (const r of results) if (!merged.some((t) => t.task === r.task)) merged.push(r);
      report.tasks = merged.sort((a, b) => a.task - b.task);
      report.note_partial_run = `Task ${ONLY} was re-measured on its own; the other tasks carry their earlier measurement.`;
    }
  }
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nwrote data/advantage/report.json — ${report.tasks.length} task(s)${ONLY ? ` (task ${ONLY} re-measured, the rest kept)` : ''}`);
}
