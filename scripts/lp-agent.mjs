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
  RPCS, INCOME_SOURCES, ADDR, splitForRange, amountsForRange, minsForRange, MINT_DRIFT_TICKS, unwindCalls, ticksAround, readBnbUsd,
  planSweep, executeSweep, planCollect, executeCollect, planIncrease, executeIncrease,
  planRebalance, executeRebalance,
} from '../shared/lp-agent.js';
import {
  refuseCollect, refuseSweep, refuseIncrease, refuseRebalance, rebalanceWait, RESET_AFTER_HOURS,
  GAS_RESERVE_BNB, MIN_GAS_BNB, MIN_COLLECT_BNB, MIN_SWEEP_BNB, MIN_INCREASE_BNB, MIN_REBALANCE_BNB,
  splitFees, FEE_SHARE_KEPT_PCT,
} from '../shared/lp-guards.js';
import { moneyFlow, flowLines } from '../shared/lp-flow.js';

const CONFIRM = process.argv.includes('--confirm');
const SELF = process.argv.includes('--self-test');
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const stepArg = argOf('--step');
const ALL = ['sweep', 'collect', 'rebalance', 'increase'];
const STEPS = stepArg ? [stepArg] : ALL;
// A width named by a person for the re-set. It is printed as a hand-made
// choice and never remembered: the record's earnings test is the standing rule.
const WIDTH = argOf('--width') != null ? Number(argOf('--width')) : null;
// The share of a collect kept as capital. Default is the standing rule in
// lp-guards.js (the worker reads the same figure from LP_FEE_KEEP_PCT).
const KEEP = argOf('--keep') != null ? Number(argOf('--keep')) : FEE_SHARE_KEPT_PCT;
if (stepArg && !ALL.includes(stepArg)) {
  console.error(`--step must be one of ${ALL.join(', ')}, not "${stepArg}"`);
  process.exitCode = 2;
}
if (argOf('--keep') != null && !(KEEP >= 0 && KEEP <= 100)) {
  console.error(`--keep is a percent between 0 and 100, not "${argOf('--keep')}"`);
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
  let bad = 0, total = 0;
  const check = (label, r, wantRefusal) => {
    total += 1;
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

  console.log('fee split');
  // Both directions: the default keeps half, an explicit 0 sends it all to the
  // buyback, an explicit 100 keeps it all, and a bad value falls back to the
  // default rather than to either extreme.
  const eq = (label, got, want) => check(label, got === want ? null : `got ${got}, wanted ${want}`, false);
  const one = 10n ** 18n;
  eq(`default keeps ${FEE_SHARE_KEPT_PCT}% of 1 BNB`, splitFees(one).keep, (one * BigInt(FEE_SHARE_KEPT_PCT)) / 100n);
  eq('default sends the rest to the buyback', splitFees(one).keep + splitFees(one).buyback, one);
  eq('0% keeps nothing', splitFees(one, 0).keep, 0n);
  eq('0% forwards everything', splitFees(one, 0).buyback, one);
  eq('100% keeps everything', splitFees(one, 100).keep, one);
  eq('100% forwards nothing', splitFees(one, 100).buyback, 0n);
  eq('25% of 1 BNB is 0.25', splitFees(one, 25).keep, one / 4n);
  eq('12.5% is honoured to the hundredth', splitFees(one, 12.5).keep, (one * 125n) / 1000n);
  eq('"50" as a string works (a wrangler var is a string)', splitFees(one, '50').pct, 50);
  eq('a typo falls back to the default, not to 0', splitFees(one, 'fifty').pct, FEE_SHARE_KEPT_PCT);
  eq('150 falls back to the default, not to 100', splitFees(one, 150).pct, FEE_SHARE_KEPT_PCT);
  eq('a negative share falls back to the default', splitFees(one, -5).pct, FEE_SHARE_KEPT_PCT);
  eq('undefined (var not set) falls back to the default', splitFees(one, undefined).pct, FEE_SHARE_KEPT_PCT);
  eq('nothing produced splits to nothing', splitFees(0n).keep + splitFees(0n).buyback, 0n);
  eq('a negative amount is treated as nothing', splitFees(-1n).buyback, 0n);

  console.log('money flow');
  // The record as the worker writes it, with one run of each kind, a dry run
  // that must not count, and a collect from before the split (forwarded only).
  const rec = {
    history: [
      { at: '2026-09-02T14:20:00Z', dry: true, ok: false, acted: false, steps: { collect: { acted: true, forwarded_bnb: '9', txs: [{ gas_bnb: 1 }] } } },
      { at: '2026-09-03T05:23:00Z', ok: true, acted: true, steps: {
        sweep: [{ source: 'x402', token: 'USD1', acted: true, sold: '5', received_bnb: '0.007', txs: [{ gas_bnb: 0.00001 }, { gas_bnb: 0.00002 }] }, { source: 'provider', acted: false, why: 'nothing' }],
        collect: { acted: true, forwarded_bnb: '0.003', txs: [{ gas_bnb: 0.00001 }] },
      } },
      { at: '2026-09-04T05:23:00Z', ok: true, acted: true, steps: {
        collect: { acted: true, produced_bnb: '0.004', kept_bnb: '0.002', forwarded_bnb: '0.002', kept_pct: 50, txs: [{ gas_bnb: 0.00001 }] },
        increase: { acted: true, wbnb_used: '0.005', bnb_spent: '0.0101', txs: [{ gas_bnb: 0.00003 }] },
        rebalance: { acted: true, new_position: '7', txs: [{ gas_bnb: 0.00002 }] },
      } },
      { at: '2026-09-04T09:00:00Z', ok: false, acted: true, steps: { collect: { acted: true, error: 'reverted', txs: [{ gas_bnb: 0.00001 }] } } },
    ],
    last: { at: '2026-09-04T05:23:00Z', steps: {
      sweep: [{ source: 'x402', token: 'USD1', balance: 0.6, bnb_equivalent: 0.0008 }, { source: 'provider', token: '$U', balance: 0 }],
      collect: { kept_pct: 50, owed: { bnb_equivalent: 0.000016 } },
      increase: { spendable_bnb: 0.0075 },
    } },
  };
  const fl = moneyFlow(rec, { earned: { count: 3, totalUsd1: '0.70' } });
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const is = (label, ok) => check(label, ok ? null : 'wrong', false);
  is('a dry run counts for nothing', fl.in.fees.bnb < 9 && fl.gas.bnb < 1);
  is('income is summed per source', fl.in.income.length === 1 && fl.in.income[0].source === 'x402' && near(fl.in.income[0].bnb, 0.007) && fl.in.income[0].runs === 1);
  is('a sweep that did not act is not a source', !fl.in.income.some((s) => s.source === 'provider'));
  is('a collect before the split counts what it forwarded as produced', near(fl.in.fees.bnb, 0.007) && fl.in.fees.collects === 2);
  is('the buyback got 0.003 + 0.002', near(fl.out.buyback_bnb, 0.005));
  is('0.002 was kept as capital', near(fl.out.kept_as_capital_bnb, 0.002));
  is('capital that arrived = income + kept', near(fl.out.capital_arrived_bnb, 0.009));
  is('the increase counts the BNB it spent, gas included', near(fl.out.into_position_bnb, 0.0101) && fl.out.increases === 1);
  is('one re-set', fl.out.resets === 1);
  is('gas is summed over every transaction, the failed run included', fl.gas.transactions === 7 && near(fl.gas.bnb, 0.00011));
  is('a failed collect adds no fees', near(fl.in.fees.bnb, 0.007));
  is('since = first run that acted, last_moved = the newest', fl.since === '2026-09-03T05:23:00Z' && fl.last_moved === '2026-09-04T09:00:00Z');
  is('waiting lists only wallets holding something', fl.waiting.income.length === 1 && fl.waiting.income[0].token === 'USD1');
  is('waiting carries the fees owed and the spendable BNB', near(fl.waiting.fees_owed_bnb, 0.000016) && near(fl.waiting.wallet_spendable_bnb, 0.0075));
  is('the rule is what the last collect named', fl.rule.fee_share_kept_pct === 50 && fl.rule.fee_share_buyback_pct === 50);
  is('paid_for carries the service earnings', fl.paid_for.x402_answers === 3 && near(fl.paid_for.usd1, 0.7));
  is('an empty record flows nothing', moneyFlow({}).in.total_bnb === 0 && moneyFlow({}).rule === null && moneyFlow(null).gas.transactions === 0);
  const lines = flowLines(fl);
  is('the lines name the source, the fees and the split', /USD1/.test(lines.came_in) && /0\.00700 BNB of fees/.test(lines.came_in) && /0\.00500 BNB to the buyback/.test(lines.went_out) && /0\.00200 BNB kept/.test(lines.went_out));
  is('an empty record reads as nothing yet', /no income swept yet/.test(flowLines(moneyFlow({})).came_in) && /nothing has left/.test(flowLines(moneyFlow({})).went_out));

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
    [{ ...healthyIncrease, spendableBnb: MIN_INCREASE_BNB / 2 }, 'capital under the floor'],
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
  console.log('rebalance resumed from the wallet (the 2026-09-05 12:50 stop before the mint)');
  const resume = { positions: 0, resume: true, inRange: false, width: 1, hoursOfPrices: 30, valueBnb: 0.08 };
  check('no position, the two sides in the wallet, a width, enough capital: mints', refuseRebalance(resume), false);
  for (const [state, why] of [
    [{ ...resume, resume: false }, 'no position and no pool named: nothing to resume'],
    [{ ...resume, valueBnb: 0.005 }, 'the two sides are worth less than the floor'],
    [{ ...resume, width: null, hoursOfPrices: 6 }, 'no width has earned its re-sets yet'],
    [{ ...resume, positions: 1 }, 'a position exists — that is a re-set, and its in-range check applies'],
  ]) check(why, refuseRebalance(state), state.positions === 1 ? false : true);
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

  console.log('what the range takes (the 2026-09-05 revert)');
  // Balances in the range's own ratio are taken whole; an excess on one side
  // is left, and the minimum follows what is taken, not what is held. The
  // failed run held 2.038 CAKE beside 0.0025 WBNB and asked for 90% of both.
  const L0 = 1e15, have0 = BigInt(Math.floor(L0 * sMid.perL0)), have1 = BigInt(Math.floor(L0 * sMid.perL1));
  const whole = amountsForRange(mid, lo, hi, have0, have1);
  check('balances in the ratio are taken whole', whole.amount0 <= have0 && whole.amount1 <= have1 && whole.amount0 > (have0 * 999n) / 1000n && whole.amount1 > (have1 * 999n) / 1000n ? null : 'amount0 ' + whole.amount0 + ' of ' + have0 + ', amount1 ' + whole.amount1 + ' of ' + have1, false);
  const excess = amountsForRange(mid, lo, hi, have0 * 8n, have1);
  check('an excess of token0 is left, token1 is the short side', excess.amount1 === whole.amount1 && excess.amount0 <= whole.amount0 + 1n ? null : 'amount0 ' + excess.amount0 + ' amount1 ' + excess.amount1, false);
  const mins = minsForRange(mid, lo, hi, have0 * 8n, have1, 0);   // no drift here: this pins the ratio rule alone
  check('the minimum for token0 follows what is taken, not the balance', mins.amount0Min < (have0 * 8n * 90n) / 100n && mins.amount0Min > (excess.amount0 * 96n) / 100n && mins.amount0Min <= excess.amount0 ? null : String(mins.amount0Min), false);
  check('below the range only token0 is taken, token1 not at all', amountsForRange(below, lo, hi, have0, have1).amount1 === 0n && amountsForRange(below, lo, hi, have0, have1).amount0 > 0n ? null : 'token1 taken', false);
  check('nothing held means nothing taken and a zero minimum', minsForRange(mid, lo, hi, 0n, have1).amount0Min === 0n && minsForRange(mid, lo, hi, 0n, have1).amount1Min === 0n ? null : 'not zero', false);

  console.log(`minimums with ${MINT_DRIFT_TICKS} ticks of drift (the 2026-09-05 12:50 revert)`);
  // The failed mint: ±1% (190 ticks), balances in the ratio at the tick, the
  // pool a few ticks away by the time the block came. With the drift in the
  // minimums a mint at any price inside the tolerance passes; at zero drift
  // the old behaviour is back, and a move of a handful of ticks fails it.
  const sqrtAt = (t) => Math.pow(1.0001, t / 2);
  const n1 = ticksAround(-58441, 1, 10);
  const s1 = sqrtAt(-58441), r0 = BigInt(Math.floor(1e15 * splitForRange(s1, n1.tickLower, n1.tickUpper).perL0)), r1 = BigInt(Math.floor(1e15 * splitForRange(s1, n1.tickLower, n1.tickUpper).perL1));
  const tol = minsForRange(s1, n1.tickLower, n1.tickUpper, r0, r1);
  const none = minsForRange(s1, n1.tickLower, n1.tickUpper, r0, r1, 0);
  const passes = (m, t) => { const a = amountsForRange(sqrtAt(t), n1.tickLower, n1.tickUpper, r0, r1); return a.amount0 >= m.amount0Min && a.amount1 >= m.amount1Min; };
  check('at the read price both minimums pass', passes(tol, -58441) ? null : 'fails at the read price', false);
  check(`${MINT_DRIFT_TICKS} ticks up still passes`, passes(tol, -58441 + MINT_DRIFT_TICKS) ? null : 'fails', false);
  check(`${MINT_DRIFT_TICKS} ticks down still passes`, passes(tol, -58441 - MINT_DRIFT_TICKS) ? null : 'fails', false);
  check(`${MINT_DRIFT_TICKS * 2} ticks up is outside the tolerance and fails`, passes(tol, -58441 + MINT_DRIFT_TICKS * 2) ? 'passes' : null, false);
  check('with zero drift a move of 6 ticks fails — the 12:50 revert', passes(none, -58441 + 6) ? 'passes' : null, false);
  check('the drift lowers the minimums, it never raises them', tol.amount0Min <= none.amount0Min && tol.amount1Min <= none.amount1Min && (tol.amount0Min < none.amount0Min || tol.amount1Min < none.amount1Min) ? null : 'not lower', false);

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
      console.log(`  would collect, sell the other side, unwrap, keep ${KEEP}% of what this run produced as capital and forward the rest to ${ADDR.BUYBACK_WALLET}`);
      if (CONFIRM) {
        const out = await executeCollect(pub, lpWallet(), lp, plan, log, { keptPct: KEEP });
        console.log(`  produced ${out.produced_bnb || '0'} BNB: kept ${out.kept_bnb} BNB as capital, forwarded ${out.forwarded_bnb} BNB${out.why ? ` — ${out.why}` : ''}`);
        acted += 1;
      }
    }
  }

  if (STEPS.includes('rebalance')) {
    console.log('\nREBALANCE — a range the price has left is re-set around today\'s price');
    // The window record as the cron built it, with the verdict computed by
    // the same function the worker uses — one record, one rule.
    let record = null, pool = null;
    try {
      const w = await fetch(WINDOWS_URL, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
      record = w.verdict || null;
      pool = w.pool || null;
      if (record) console.log(`  record: ${record.windows} windows, ${record.hours_of_prices} h of prices, earnings pick ${record.earnings_pick ? `±${record.earnings_pick.width}% ($${record.earnings_pick.earnings.net_usd_per_day}/day on $50)` : 'none yet'}, day-pick ${record.day_pick ? `±${record.day_pick.width}%` : 'none yet'}${w.last_error ? `, last cron error ${w.last_error.at.slice(0, 16)}: ${w.last_error.error}` : ''}`);
    } catch (e) { console.log(`  record unreadable (${e.message}) — only a --width named by hand can re-set today`); }
    const plan = await planRebalance(pub, lp.address, { record, widthOverride: WIDTH, pool });
    const s = plan.summary;
    if (plan.resume) console.log(`  no position — the wallet holds ${s.held?.other} of the other side and ${s.held?.wbnb} WBNB (worth ${f(s.value_bnb)} BNB), tick now ${s.tick}: a re-set that stopped before its mint`);
    else if (plan.pos) console.log(`  position #${s.position} ticks ${s.ticks[0]} … ${s.ticks[1]}, tick now ${s.tick}, ${s.in_range ? 'in range' : 'OUT OF RANGE'}, worth ${f(s.value_bnb)} BNB`);
    if (plan.no) console.log(`  nothing to do: ${plan.no}`);
    else {
      console.log(`  width ±${s.width_pct}% (${s.width_basis}) -> new ticks ${s.new_ticks[0]} … ${s.new_ticks[1]}`);
      console.log(plan.resume ? `  would ${s.trade}, and mint the range from what the wallet then holds` : `  would withdraw and burn #${s.position}, ${s.trade}, and mint the new range from what the wallet then holds`);
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
      if (s.capital) console.log(`  capital beside the position: ${f(s.capital.bnb_above_reserve)} BNB above the reserve, ${f(s.capital.wbnb_held)} WBNB held, ${s.capital.other_held} of the other side held (~${f(s.capital.other_held_in_bnb)} BNB)`);
      console.log(`  would ${plan.nativeRaw > 0n ? `wrap ${f(Number(plan.nativeRaw) / 1e18)} BNB, ` : ''}${s.would_add.buying_other ? `buy ${s.would_add.buying_other} of ${s.would_add.other_token} for ~${s.would_add.buying_other_costs_bnb} BNB` : s.would_add.selling_other ? `sell ${s.would_add.selling_other} of ${s.would_add.other_token} for WBNB` : 'trade nothing'}, and add ${s.would_add.wbnb} WBNB + ${s.would_add.other} of the other side to #${plan.tokenId}`);
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
