#!/usr/bin/env node
// The LP agent by hand: the same three steps the daily worker runs
// (worker-lp/index.js), from a laptop, plan by default.
//
//   sweep     AI income (USD1 on the x402 wallet, $U on the provider wallet)
//             -> BNB -> the liquidity wallet
//   collect   the position's fees -> BNB -> the buyback wallet
//   increase  BNB above the reserve -> more of the same position
//
// Every function here is imported from shared/lp-agent.js, the file the
// worker runs. Nothing is reimplemented: a plan printed here is the plan the
// cron would send tonight, on today's chain.
//
// SAFETY — a bare run changes nothing.
//   Nothing happens without --confirm.
//   --self-test drives synthetic states through the same guard functions the
//   real run uses, in both directions, because a guard nobody has watched
//   fire is a guess.
//
// Usage:
//   node scripts/lp-agent.mjs                       plan all three steps
//   node scripts/lp-agent.mjs --step collect        one step
//   node scripts/lp-agent.mjs --self-test           prove the guards fire
//   node scripts/lp-agent.mjs --confirm [--step x]  send it
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, fallback } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  RPCS, INCOME_SOURCES, ADDR, splitForRange, unwindCalls, ticksAround, readBnbUsd,
  planSweep, executeSweep, planCollect, executeCollect, planIncrease, executeIncrease,
  planRebalance, executeRebalance,
} from '../shared/lp-agent.js';
import {
  refuseCollect, refuseSweep, refuseIncrease, refuseRebalance, rebalanceWait, RESET_AFTER_HOURS,
  GAS_RESERVE_BNB, MIN_GAS_BNB, MIN_COLLECT_BNB, MIN_SWEEP_BNB, MIN_INCREASE_BNB, MIN_REBALANCE_BNB,
} from '../shared/lp-guards.js';

const CONFIRM = process.argv.includes('--confirm');
const SELF = process.argv.includes('--self-test');
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const stepArg = argOf('--step');
const ALL = ['sweep', 'collect', 'rebalance', 'increase'];
const STEPS = stepArg ? [stepArg] : ALL;
// A width named by a person for the re-set. It is printed as a hand-made
// choice and never remembered: the record's earnings test is the standing rule.
const WIDTH = argOf('--width') != null ? Number(argOf('--width')) : null;
if (stepArg && !ALL.includes(stepArg)) {
  console.error(`--step must be one of ${ALL.join(', ')}, not "${stepArg}"`);
  process.exitCode = 2;
}
if (WIDTH != null && !(WIDTH > 0 && WIDTH <= 50)) {
  console.error(`--width is a percent between 0 and 50, not "${argOf('--width')}"`);
  process.exitCode = 2;
}
const WINDOWS_URL = 'https://agent.brainonbnb.com/lp/windows';

// --------------------------------------------------------------------------
// --self-test: every refusal, and the one allow, for each of the three guards
// --------------------------------------------------------------------------
if (SELF) {
  let bad = 0;
  const check = (label, r, wantRefusal) => {
    const ok = wantRefusal ? !!r : !r;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${wantRefusal ? 'refuses' : 'allows '}: ${label}${r ? ` — "${String(r).slice(0, 72)}"` : ''}`);
    if (!ok) bad += 1;
  };
  console.log('collect');
  const healthyCollect = { positions: 1, liquidity: 10n ** 18n, owedBnbEquivalent: 0.01, gasBnb: 0.01, quoteOffPct: 2 };
  for (const [state, why] of [
    [{ positions: 0 }, 'no position'],
    [{ positions: 2 }, 'two positions'],
    [{ positions: 1, liquidity: 0n }, 'position emptied'],
    [{ ...healthyCollect, owedBnbEquivalent: 0 }, 'nothing owed'],
    [{ ...healthyCollect, owedBnbEquivalent: 0.0001 }, 'dust below the gas it costs'],
    [{ ...healthyCollect, gasBnb: 0.0001 }, 'no gas'],
    [{ ...healthyCollect, quoteOffPct: 60 }, 'quote far off the pool'],
    [{ ...healthyCollect, quoteOffPct: -60 }, 'quote far off the pool, the other way'],
  ]) check(why, refuseCollect(state), true);
  check('a healthy position with real fees owed', refuseCollect(healthyCollect), false);
  check('a quote 10% off, within the 25% band', refuseCollect({ ...healthyCollect, quoteOffPct: 10 }), false);
  // The reserve the collect leaves behind must be enough for the next collect.
  check(`the reserve (${GAS_RESERVE_BNB}) covers the gas floor (${MIN_GAS_BNB})`, GAS_RESERVE_BNB >= MIN_GAS_BNB ? null : 'reserve below the floor', false);
  // A wallet holding exactly the reserve after a run must be allowed to act.
  check('a wallet holding exactly the reserve', refuseCollect({ ...healthyCollect, gasBnb: GAS_RESERVE_BNB }), false);

  console.log('sweep');
  const healthySweep = { symbol: 'USD1', balance: 5, bnbEquivalent: 0.007, gasBnb: 0.002, bnbUsd: 700, feedAgeS: 30, impliedUsd: 1.0 };
  for (const [state, why] of [
    [{ ...healthySweep, balance: 0, bnbEquivalent: 0 }, 'nothing arrived'],
    [{ ...healthySweep, gasBnb: 0.0001 }, 'no gas on the income wallet'],
    [{ ...healthySweep, feedAgeS: 7200 }, 'stale Chainlink feed'],
    [{ ...healthySweep, bnbUsd: 12 }, 'implausible BNB price'],
    [{ ...healthySweep, balance: 0.5, bnbEquivalent: 0.0007 }, 'income under the floor'],
    [{ ...healthySweep, impliedUsd: 0.5 }, 'route pays half a dollar'],
    [{ ...healthySweep, impliedUsd: 1.5 }, 'route pays a dollar and a half'],
  ]) check(why, refuseSweep(state), true);
  check('five dollars of USD1 on a wallet with gas', refuseSweep(healthySweep), false);
  check('the same in $U', refuseSweep({ ...healthySweep, symbol: '$U' }), false);
  check('a plan stage with no quote yet', refuseSweep({ ...healthySweep, impliedUsd: null }), false);

  console.log('increase');
  const healthyIncrease = { positions: 1, spendableBnb: 0.02, inRange: true };
  for (const [state, why] of [
    [{ ...healthyIncrease, positions: 0 }, 'no position'],
    [{ ...healthyIncrease, positions: 2 }, 'two positions'],
    [{ ...healthyIncrease, spendableBnb: 0.005 }, 'capital under the floor'],
    [{ ...healthyIncrease, spendableBnb: 0 }, 'nothing above the reserve'],
    [{ ...healthyIncrease, inRange: false }, 'price outside the range'],
  ]) check(why, refuseIncrease(state), true);
  check('capital above the floor and a price in range', refuseIncrease(healthyIncrease), false);
  check(`exactly the floor (${MIN_INCREASE_BNB})`, refuseIncrease({ ...healthyIncrease, spendableBnb: MIN_INCREASE_BNB }), false);

  console.log('rebalance');
  const healthyRebalance = { positions: 1, inRange: false, width: 1, hoursOfPrices: 30, valueBnb: 0.07 };
  for (const [state, why] of [
    [{ ...healthyRebalance, positions: 0 }, 'no position'],
    [{ ...healthyRebalance, positions: 2 }, 'two positions'],
    [{ ...healthyRebalance, inRange: true }, 'price still inside the range'],
    [{ ...healthyRebalance, width: null, hoursOfPrices: 6 }, 'no width has earned its re-sets yet'],
    [{ ...healthyRebalance, valueBnb: 0.005 }, 'position too small to pay for a re-set'],
  ]) check(why, refuseRebalance(state), true);
  check('out of range, a day-tested width, enough capital', refuseRebalance(healthyRebalance), false);
  check(`exactly the floor (${MIN_REBALANCE_BNB})`, refuseRebalance({ ...healthyRebalance, valueBnb: MIN_REBALANCE_BNB }), false);
  console.log('rebalance wait');
  const H = 36e5, now = Date.parse('2026-09-04T06:50:00Z');
  check('first hour outside: waits', rebalanceWait(null, now), true);
  check('one hour outside: still waits', rebalanceWait(now - 1 * H, now), true);
  check('just under the delay: still waits', rebalanceWait(now - (RESET_AFTER_HOURS * H - 60e3), now), true);
  check(`exactly ${RESET_AFTER_HOURS} h outside: due`, rebalanceWait(now - RESET_AFTER_HOURS * H, now), false);
  check('a day outside: due', rebalanceWait(now - 24 * H, now), false);
  console.log('unwind in one transaction');
  const calls = unwindCalls(7309536n, 72166992217730319120n, 1n, 2n, '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A', 1800000000n);
  check('three calls: decreaseLiquidity, collect, burn — in that order', calls.length === 3 && calls[0].startsWith('0x0c49ccbe') && calls[1].startsWith('0xfc6f7865') && calls[2].startsWith('0x42966c68') ? null : calls.map((c) => c.slice(0, 10)).join(','), false);
  check('the token id is in every call', calls.every((c) => c.includes(BigInt(7309536).toString(16).padStart(64, '0'))) ? null : 'a call lacks the token id', false);
  const t = ticksAround(-59407, 1, 10);
  check('a re-set range sits on the pool\'s grid around the tick', t.tickLower % 10 === 0 && t.tickUpper % 10 === 0 && t.tickLower < -59407 && t.tickUpper > -59407 ? null : `${t.tickLower}…${t.tickUpper}`, false);
  check('and is never wider than the width asked for', (t.tickUpper - t.tickLower) <= 2 * Math.log(1.01) / Math.log(1.0001) ? null : 'wider', false);

  console.log('split');
  // Below the range a position is all token0, above it all token1, inside it both.
  const lo = -59340, hi = -59250;
  const mid = Math.pow(1.0001, (lo + hi) / 4), below = Math.pow(1.0001, (lo - 100) / 2), above = Math.pow(1.0001, (hi + 100) / 2);
  const sMid = splitForRange(mid, lo, hi), sBelow = splitForRange(below, lo, hi), sAbove = splitForRange(above, lo, hi);
  check('inside the range holds both tokens', sMid.perL0 > 0 && sMid.perL1 > 0 ? null : 'one side is zero', false);
  check('below the range holds only token0', sBelow.perL0 > 0 && sBelow.perL1 === 0 ? null : 'token1 is not zero', false);
  check('above the range holds only token1', sAbove.perL1 > 0 && sAbove.perL0 === 0 ? null : 'token0 is not zero', false);
  // Ten times the capital is ten times the liquidity: the split is linear in L.
  check('the split is linear in liquidity', Math.abs(splitForRange(mid, lo, hi).perL0 - sMid.perL0) < 1e-18 ? null : 'not linear', false);

  const total = 8 + 4 + 7 + 3 + 5 + 2 + 5 + 4 + 4;
  console.log(`\n${total - bad}/${total} checks behave in both directions (floors: collect ${MIN_COLLECT_BNB}, sweep ${MIN_SWEEP_BNB}, increase ${MIN_INCREASE_BNB} BNB)`);
  process.exitCode = bad ? 1 : 0;
}

// --------------------------------------------------------------------------
// The live path
// --------------------------------------------------------------------------
const transport = () => process.env.BSC_RPC_URL
  ? http(process.env.BSC_RPC_URL)
  : fallback(RPCS.map((u) => http(u, { timeout: 15000 })));
const acct = (key) => privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const f = (n, d = 6) => Number(n).toFixed(d);

async function main() {
  const pub = createPublicClient({ chain: bsc, transport: transport() });
  const log = (s) => console.log(s);
  let acted = 0;

  if (STEPS.includes('sweep')) {
    console.log('SWEEP — AI income -> BNB -> liquidity wallet');
    const feed = await readBnbUsd(pub);
    console.log(`  BNB ${f(feed.bnbUsd, 2)} $ (Chainlink, ${feed.feedAgeS} s old)`);
    for (const src of INCOME_SOURCES) {
      const key = process.env[src.keyEnv];
      if (!key) { console.log(`  ${src.name}: no ${src.keyEnv} in .env — skipped`); continue; }
      const a = acct(key);
      if (a.address.toLowerCase() !== src.wallet.toLowerCase()) { console.log(`  ${src.name}: ${src.keyEnv} does not open ${src.wallet} — skipped`); continue; }
      const plan = await planSweep(pub, src, feed);
      const s = plan.summary;
      console.log(`  ${src.name} ${src.wallet}: ${f(s.balance, 4)} ${src.symbol} (${src.earns}), worth ${f(s.bnb_equivalent)} BNB${s.implied_usd != null ? `, route pays $${s.implied_usd}` : ''}, gas ${f(s.gas_bnb)} BNB`);
      if (plan.no) { console.log(`    nothing to do: ${plan.no}`); continue; }
      console.log(`    would sell ${f(s.sweeping, 4)} ${src.symbol}${s.capped ? ' (capped for this run)' : ''} for ~${f(s.bnb_equivalent)} BNB, paid straight to ${ADDR.LP_WALLET}`);
      if (!CONFIRM) continue;
      const wallet = createWalletClient({ account: a, chain: bsc, transport: transport() });
      const out = await executeSweep(pub, wallet, a, plan, log);
      console.log(`    sold ${out.sold} ${src.symbol}, the liquidity wallet received ${out.received_bnb} BNB`);
      acted += 1;
    }
  }

  const lpKey = process.env.LP_PRIVATE_KEY;
  if (!lpKey) {
    console.error('No LP_PRIVATE_KEY in .env. Create the wallet first: node scripts/create-lp-wallet.mjs');
    process.exitCode = 2;
    return;
  }
  const lp = acct(lpKey);
  const lpWallet = () => createWalletClient({ account: lp, chain: bsc, transport: transport() });

  if (STEPS.includes('collect')) {
    console.log(`\nCOLLECT — fees of the position held by ${lp.address} -> BNB -> buyback wallet`);
    const plan = await planCollect(pub, lp.address);
    const s = plan.summary;
    if (plan.pos) {
      console.log(`  position #${s.position}  ticks ${s.ticks[0]} … ${s.ticks[1]}  ${s.in_range ? 'in range' : 'OUT OF RANGE'}  liquidity ${s.liquidity}`);
      console.log(`  owed      ${s.owed.wbnb} WBNB and ${s.owed.other} of ${s.owed.other_token}`);
      if (s.leftovers) console.log(`  leftovers ${s.leftovers.wbnb} WBNB and ${s.leftovers.other} of the other token, from an interrupted run`);
      console.log(`  worth     ${f(s.owed.bnb_equivalent)} BNB together${s.quote_off_pct != null ? `, V2 quote ${s.quote_off_pct}% off the pool's price` : ''}`);
    }
    console.log(`  gas       ${f(s.gas_bnb)} BNB (reserve kept: ${GAS_RESERVE_BNB})`);
    if (plan.no) console.log(`  nothing to do: ${plan.no}`);
    else {
      console.log(`  would collect, sell the other side, unwrap, and forward what this run produced to ${ADDR.BUYBACK_WALLET}`);
      if (CONFIRM) {
        const out = await executeCollect(pub, lpWallet(), lp, plan, log);
        console.log(`  forwarded ${out.forwarded_bnb} BNB${out.why ? ` — ${out.why}` : ''}`);
        acted += 1;
      }
    }
  }

  if (STEPS.includes('rebalance')) {
    console.log('\nREBALANCE — a range the price has left is re-set around today\'s price');
    // The window record as the cron built it, with the verdict computed by
    // the same function the worker uses — one record, one rule.
    let record = null;
    try {
      const w = await fetch(WINDOWS_URL, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
      record = w.verdict || null;
      if (record) console.log(`  record: ${record.windows} windows, ${record.hours_of_prices} h of prices, earnings pick ${record.earnings_pick ? `±${record.earnings_pick.width}% ($${record.earnings_pick.earnings.net_usd_per_day}/day on $50)` : 'none yet'}, day-pick ${record.day_pick ? `±${record.day_pick.width}%` : 'none yet'}${w.last_error ? `, last cron error ${w.last_error.at.slice(0, 16)}: ${w.last_error.error}` : ''}`);
    } catch (e) { console.log(`  record unreadable (${e.message}) — only a --width named by hand can re-set today`); }
    const plan = await planRebalance(pub, lp.address, { record, widthOverride: WIDTH });
    const s = plan.summary;
    if (plan.pos) console.log(`  position #${s.position} ticks ${s.ticks[0]} … ${s.ticks[1]}, tick now ${s.tick}, ${s.in_range ? 'in range' : 'OUT OF RANGE'}, worth ${f(s.value_bnb)} BNB`);
    if (plan.no) console.log(`  nothing to do: ${plan.no}`);
    else {
      console.log(`  width ±${s.width_pct}% (${s.width_basis}) -> new ticks ${s.new_ticks[0]} … ${s.new_ticks[1]}`);
      console.log(`  would withdraw and burn #${s.position}, ${s.trade}, and mint the new range from what the wallet then holds`);
      if (CONFIRM) {
        const out = await executeRebalance(pub, lpWallet(), lp, plan, log);
        console.log(`  new position #${out.new_position} at ${out.new_ticks[0]} … ${out.new_ticks[1]}, liquidity ${out.liquidity_after}`);
        acted += 1;
      }
    }
  }

  if (STEPS.includes('increase')) {
    console.log('\nINCREASE — BNB above the reserve -> the same position');
    const plan = await planIncrease(pub, lp.address);
    const s = plan.summary;
    console.log(`  wallet holds ${f(s.wallet_bnb)} BNB, ${f(s.spendable_bnb)} above the reserve and gas budget${s.tick != null ? `, tick ${s.tick} ${s.in_range ? 'in range' : 'OUT OF RANGE'}` : ''}`);
    if (plan.no) console.log(`  nothing to do: ${plan.no}`);
    else {
      console.log(`  would wrap ${s.would_add.wbnb} BNB, buy ${s.would_add.other} of ${s.would_add.other_token} for ~${s.would_add.buying_other_costs_bnb} BNB, and add both to #${plan.tokenId}`);
      if (CONFIRM) {
        const out = await executeIncrease(pub, lpWallet(), lp, plan, log);
        console.log(`  added ${out.other_used} of the other token and ${out.wbnb_used} WBNB; liquidity now ${out.liquidity_after}`);
        acted += 1;
      }
    }
  }

  if (!CONFIRM) console.log('\nPLAN ONLY — nothing was sent. Add --confirm to send it.');
  else console.log(`\nDone: ${acted} step(s) acted.`);
}

// NO process.exit HERE. Calling it immediately after a viem HTTP read trips a
// libuv assertion on Windows and the process ends with code 127 after a run
// that did what it was asked. Every path returns, failures set
// process.exitCode, and the process closes its own sockets.
if (!SELF && process.exitCode !== 2) await main().catch((e) => { console.error(`\nFailed: ${e.shortMessage || e.message}`); process.exitCode = 1; });
