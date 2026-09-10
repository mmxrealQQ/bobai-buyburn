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
  RPCS, INCOME_SOURCES, ADDR, splitForRange, amountsForRange, minsForRange, MINT_DRIFT_TICKS, unwindCalls, ticksAround, readBnbUsd, sender, v3SwapArgs, swapNote,
  planSweep, executeSweep, planCollect, executeCollect, planIncrease, executeIncrease,
  planRebalance, executeRebalance,
} from '../shared/lp-agent.js';
import {
  refuseCollect, refuseSweep, refuseIncrease, refuseRebalance, rebalanceWait, RESET_AFTER_HOURS,
  GAS_RESERVE_BNB, MIN_GAS_BNB, MIN_COLLECT_BNB, MIN_SWEEP_BNB, MIN_INCREASE_BNB, MIN_REBALANCE_BNB,
  splitFees, FEE_SHARE_KEPT_PCT, resetForward, MIN_RESET_FORWARD_BNB,
  widthUpgrade, widthClassOf,
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

  console.log('re-set fee share');
  // Both directions: a share worth sending is sent, a share under the floor
  // stays as capital (and is counted as kept, so nothing goes missing), a
  // kept share of 100% sends nothing, no fees owed sends nothing.
  const mBnb = 10n ** 15n; // 0.001 BNB
  eq('half of 0.001 BNB is sent on', resetForward(mBnb).forward, mBnb / 2n);
  eq('… and the other half is kept', resetForward(mBnb).kept, mBnb / 2n);
  eq('the share names the percentage it kept', resetForward(mBnb).pct, FEE_SHARE_KEPT_PCT);
  check('a share worth sending has no reason not to', resetForward(mBnb).why, false);
  const dust = BigInt(Math.round(MIN_RESET_FORWARD_BNB * 1e6)) * 10n ** 12n; // exactly the floor, doubled = 0.0002 folded
  eq('a buyback share exactly at the floor is sent', resetForward(dust * 2n).forward, dust);
  eq('a buyback share one wei under the floor stays', resetForward(dust * 2n - 2n).forward, 0n);
  eq('… and all of it counts as kept', resetForward(dust * 2n - 2n).kept, dust * 2n - 2n);
  check('the dust share says why it stayed', resetForward(dust * 2n - 2n).why, true);
  eq('0% kept sends everything', resetForward(mBnb, 0).forward, mBnb);
  eq('100% kept sends nothing', resetForward(mBnb, 100).forward, 0n);
  check('100% kept says so', resetForward(mBnb, 100).why, true);
  eq('no fees owed sends nothing', resetForward(0n).forward, 0n);
  check('no fees owed says so', resetForward(0n).why, true);
  eq('a typo in the share falls back to the default', resetForward(mBnb, 'half').pct, FEE_SHARE_KEPT_PCT);
  check(`the floor (${MIN_RESET_FORWARD_BNB}) is above two transactions at 1 gwei (0.00005)`, MIN_RESET_FORWARD_BNB > 0.00005 ? null : 'floor too low', false);

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
        rebalance: { acted: true, new_position: '7', fees_folded_bnb: 0.0006, txs: [{ gas_bnb: 0.00002 }] },
      } },
      { at: '2026-09-04T09:00:00Z', ok: false, acted: true, steps: { collect: { acted: true, error: 'reverted', txs: [{ gas_bnb: 0.00001 }] } } },
      // A re-set since 2026-09-08: it took 0.0004 of fees and sent half on.
      { at: '2026-09-08T19:50:00Z', ok: true, acted: true, steps: {
        rebalance: { acted: true, new_position: '8', fees_folded_bnb: 0.0004, fees_forwarded_bnb: 0.0002, fees_kept_pct: 50, forwarded_to: '0xdeFC', txs: [{ gas_bnb: 0.00002 }, { gas_bnb: 0.00001 }] },
      } },
      // Since 2026-09-09 the share buys BOBAI the agent holds: a collect and a
      // re-set that wrote bobai_bnb / bobai_units instead of forwarding.
      { at: '2026-09-09T12:00:00Z', ok: true, acted: true, steps: {
        collect: { acted: true, produced_bnb: 0.001, kept_bnb: 0.0005, kept_pct: 50, bobai_bnb: 0.0005, bobai_units: 2700, txs: [{ gas_bnb: 0.00001 }] },
        rebalance: { acted: true, new_position: '9', fees_folded_bnb: 0.0002, bobai_bnb: 0.0001, bobai_units: 540, fees_kept_pct: 50, txs: [{ gas_bnb: 0.00001 }] },
      } },
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
  is('a collect before the split counts what it forwarded as produced', near(fl.in.fees.collected_bnb, 0.008) && fl.in.fees.collects === 3);
  is('the fees three re-sets took are fees produced', near(fl.in.fees.folded_bnb, 0.0012) && fl.in.fees.resets_with_fees === 3 && near(fl.in.fees.bnb, 0.0092));
  is('a re-set before 2026-09-08 folded all of it in; the ones after sent half on', near(fl.in.fees.folded_kept_bnb, 0.0009) && near(fl.in.fees.forwarded_at_resets_bnb, 0.0003));
  is('the share: 0.003 + 0.002 to the buyback from old collects, 0.0002 from the old re-set, 0.0005 + 0.0001 into BOBAI since', near(fl.out.bobai_bnb, 0.0058));
  is('the BOBAI the agent holds is summed from collects and re-sets (2700 + 540)', near(fl.out.bobai_units, 3240));
  is('a record without bobai fields holds none', moneyFlow({ history: [rec.history[0]] }).out.bobai_units === 0);
  is('0.002 + 0.0005 kept by collects + 0.0006 + 0.0002 + 0.0001 folded by re-sets was kept as capital', near(fl.out.kept_as_capital_bnb, 0.0034));
  is('capital that arrived = income + kept', near(fl.out.capital_arrived_bnb, 0.0104));
  is('produced = the BOBAI share + what was kept', near(fl.in.fees.bnb, fl.out.bobai_bnb + fl.out.kept_as_capital_bnb));
  is('the increase counts the BNB it spent, gas included', near(fl.out.into_position_bnb, 0.0101) && fl.out.increases === 1);
  is('three re-sets', fl.out.resets === 3);
  is('gas is summed over every transaction, the failed run included', fl.gas.transactions === 11 && near(fl.gas.bnb, 0.00016));
  is('a failed collect adds no fees', near(fl.in.fees.collected_bnb, 0.008));
  is('since = first run that acted, last_moved = the newest', fl.since === '2026-09-03T05:23:00Z' && fl.last_moved === '2026-09-09T12:00:00Z');
  is('a record whose last collect names no share takes it from the last re-set', moneyFlow({ history: rec.history, last: { at: '2026-09-08T19:50:00Z', steps: {} } }).rule.fee_share_kept_pct === 50);
  is('waiting lists only wallets holding something', fl.waiting.income.length === 1 && fl.waiting.income[0].token === 'USD1');
  is('waiting carries the fees owed and the spendable BNB', near(fl.waiting.fees_owed_bnb, 0.000016) && near(fl.waiting.wallet_spendable_bnb, 0.0075));
  is('the rule is what the last collect named', fl.rule.fee_share_kept_pct === 50 && fl.rule.fee_share_bobai_pct === 50);
  is('paid_for carries the service earnings', fl.paid_for.x402_answers === 3 && near(fl.paid_for.usd1, 0.7));
  is('an empty record flows nothing', moneyFlow({}).in.total_bnb === 0 && moneyFlow({}).rule === null && moneyFlow(null).gas.transactions === 0);
  const lines = flowLines(fl);
  is('the lines name the source, the fees, the re-sets\' fees and the split', /USD1/.test(lines.came_in) && /0\.00800 BNB of fees over 3 collects, 0\.00120 BNB of fees taken at 3 re-sets, 0\.00030 of it spent on BOBAI held/.test(lines.came_in) && /0\.00580 BNB spent on BOBAI held in the wallet/.test(lines.went_out) && /0\.00340 BNB kept/.test(lines.went_out));
  is('re-sets that forwarded nothing read as all folded in', /0\.00060 BNB of fees taken at 1 re-set, all of it folded into the capital/.test(flowLines(moneyFlow({ history: rec.history.slice(0, 4) })).came_in));
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
  console.log('width upgrade (in range, the record names a better width)');
  // 380 ticks is ±1.9%: the record's 2%. 190 ticks: 1%. 40 ticks: 0.25%.
  check('380 ticks read as the 2% class', widthClassOf([-57990, -57610]) === 2 ? null : `got ${widthClassOf([-57990, -57610])}`, false);
  check('190 ticks read as the 1% class', widthClassOf([-57800, -57610]) === 1 ? null : `got ${widthClassOf([-57800, -57610])}`, false);
  check('no ticks: no class', widthClassOf(null) === null ? null : 'got a class', false);
  const rows = [
    { width: 1, earnings: { net_usd_per_day: 0.6983 } },
    { width: 2, earnings: { net_usd_per_day: 0.6111 } },
    { width: 'full', earnings: null },
  ];
  // The live case of 2026-09-10: $154 at 2%, the record picks 1%: +$0.27 a day against a $0.10 re-set.
  const up = { daily: true, inRange: true, ticks: [-57990, -57610], pick: rows[0], rows, hoursOfPrices: 182, valueBnb: 0.2127, bnbUsd: 723.6, resetCostUsd: 0.1 };
  const u = widthUpgrade(up);
  check('the daily run upgrades 2% → 1% when the gain pays the re-set within a day', u.upgrade ? null : u.why, false);
  check('the upgrade names from, to and the gain', u.from === 2 && u.to === 1 && u.gain_usd_per_day > 0.2 && u.gain_usd_per_day < 0.3 ? null : JSON.stringify(u), false);
  for (const [state, why] of [
    [{ ...up, daily: false }, 'the hourly check never upgrades'],
    [{ ...up, inRange: false }, 'outside the range it is a re-set, not an upgrade'],
    [{ ...up, ticks: null }, 'no ticks, no class'],
    [{ ...up, pick: null }, 'no pick, nothing to upgrade to'],
    [{ ...up, hoursOfPrices: 12 }, 'under a day of prices'],
    [{ ...up, ticks: [-57800, -57610] }, 'already at the picked width'],
    [{ ...up, rows: [rows[0]] }, 'the record has no earnings for the current width'],
    [{ ...up, valueBnb: 0 }, 'no dollar value'],
    [{ ...up, rows: [rows[0], { width: 2, earnings: { net_usd_per_day: 0.66 } }] }, 'a gain under a tenth of the current net is noise'],
    [{ ...up, resetCostUsd: 0.5 }, 'a gain under the re-set cost would not pay back within a day'],
  ]) check(why, (() => { const r = widthUpgrade(state); return r.upgrade ? null : r.why; })(), true);
  console.log('rebalance wait');
  const H = 36e5, now = Date.parse('2026-09-04T06:50:00Z');
  check('first hour outside: waits', rebalanceWait(null, now), true);
  check('one hour outside: still waits', rebalanceWait(now - 1 * H, now), true);
  // The hourly cron has seconds of jitter: the check two slots after the price
  // left must count as two hours, and the check one slot after must not.
  check('ten minutes under the delay: still waits', rebalanceWait(now - (RESET_AFTER_HOURS * H - 10 * 60e3), now), true);
  check('one minute under the delay (cron jitter): due', rebalanceWait(now - (RESET_AFTER_HOURS * H - 60e3), now), false);
  check('52 ms under the delay (the 2026-09-08 19:50 check): due', rebalanceWait(now - (RESET_AFTER_HOURS * H - 52), now), false);
  check(`exactly ${RESET_AFTER_HOURS} h outside: due`, rebalanceWait(now - RESET_AFTER_HOURS * H, now), false);
  // A measured wait of 0 h (2026-09-09): due the hour the price is first
  // seen outside, and due a minute later too; a wait passed explicitly is
  // the one used, not the set one.
  check('a measured wait of 0 h: due at once, first sighting', rebalanceWait(null, now, 0), false);
  check('a measured wait of 0 h: due a minute after the first sighting', rebalanceWait(now - 60e3, now, 0), false);
  check('a measured wait of 3 h: still waits at 2 h', rebalanceWait(now - 2 * H, now, 3), true);
  check('a measured wait of 1 h: due at 1 h', rebalanceWait(now - 1 * H, now, 1), false);
  check('an hour and a few seconds outside: still waits', rebalanceWait(now - (1 * H + 5e3), now), true);
  check('a day outside: due', rebalanceWait(now - 24 * H, now), false);
  console.log('unwind in one transaction');
  // The V3 re-centring swap (2026-09-09): the router's struct, every field
  // pinned, and the note the record keeps — fee from the pool's tier, the
  // notional in WBNB. The addresses are the ones verified on chain that day
  // (factory() = the V3 factory, WETH9() = WBNB), written here a second time
  // so a slip in either copy shows.
  const v3 = v3SwapArgs(ADDR.WBNB, '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', 500, '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A', 20000000000000000n, 6400000000000000000n, 1800000000n);
  check('the V3 swap sells exactly the amount asked, no more', v3.amountIn === 20000000000000000n, true);
  check('… into the position\'s fee tier', v3.fee === 500, true);
  check('… to the wallet, not the router', v3.recipient === '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A', true);
  check('… with the minimum out as the only guard (no price limit)', v3.amountOutMinimum === 6400000000000000000n && v3.sqrtPriceLimitX96 === 0n, true);
  check('… and a deadline', v3.deadline === 1800000000n, true);
  check('the V3 router is the verified one', ADDR.V3_SWAP_ROUTER === '0x1b81d678ffb9c0263b24a97847620c99d213eb14', true);
  check('the V3 quoter is the verified one', ADDR.V3_QUOTER === '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997', true);
  const note = swapNote('buy', 40000000000000000n, 500);
  check('a 0.04 WBNB buy through 0.05% notes a 0.00002 BNB fee', note.fee_bnb === 0.00002 && note.notional_bnb === 0.04 && note.fee_pct === 0.05, true);
  check('… a fifth of what the 0.25% pool took', swapNote('buy', 40000000000000000n, 2500).fee_bnb === 0.0001, true);
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

  console.log('sender: a failed run still names what it sent');
  // Two transactions go through, the third reverts on the chain; the error
  // must carry all three (the reverted one paid gas too). A simulation that
  // refuses before sending carries only what went before it.
  await (async () => {
    const fakePub = { getGasPrice: async () => 100000000n, waitForTransactionReceipt: async ({ hash }) => ({ status: hash === '0x3' ? 'reverted' : 'success', gasUsed: 21000n, effectiveGasPrice: 100000000n }) };
    let nth = 0;
    const fakeWallet = { writeContract: async () => `0x${++nth}`, sendTransaction: async () => `0x${++nth}` };
    const txs = [];
    const send = sender(fakePub, fakeWallet, txs);
    let err = null;
    try { await send('one', {}); await send('two', {}); await send('three', {}); } catch (e) { err = e; }
    check('a reverted third transaction throws', err ? null : 'no error', false);
    check('the error carries the three transactions sent', err && Array.isArray(err.txs) && err.txs.length === 3 && err.txs === txs ? null : `carried ${err && err.txs ? err.txs.length : 'none'}`, false);
    check('the reverted transaction has its gas measured', err && err.txs && err.txs[2].gas_bnb > 0 ? null : 'no gas on the reverted tx', false);
    const txs2 = [];
    const refusing = { writeContract: async () => { throw new Error('simulation reverted'); } };
    let err2 = null;
    try { await sender(fakePub, refusing, txs2)('mint', {}); } catch (e) { err2 = e; }
    check('a simulation that refuses before sending carries an empty list, not none', err2 && Array.isArray(err2.txs) && err2.txs.length === 0 ? null : 'not carried', false);
  })();

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
        console.log(`  produced ${out.produced_bnb || '0'} BNB: kept ${out.kept_bnb} BNB as capital, ${out.bobai_bnb} BNB bought ${out.bobai_units || '0'} BOBAI held in the wallet${out.why ? ` — ${out.why}` : ''}`);
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
    const plan = await planRebalance(pub, lp.address, { record, widthOverride: WIDTH, pool, keptPct: KEEP });
    const s = plan.summary;
    if (plan.resume) console.log(`  no position — the wallet holds ${s.held?.other} of the other side and ${s.held?.wbnb} WBNB (worth ${f(s.value_bnb)} BNB), tick now ${s.tick}: a re-set that stopped before its mint`);
    else if (plan.pos) console.log(`  position #${s.position} ticks ${s.ticks[0]} … ${s.ticks[1]}, tick now ${s.tick}, ${s.in_range ? 'in range' : 'OUT OF RANGE'}, worth ${f(s.value_bnb)} BNB`);
    if (plan.no) console.log(`  nothing to do: ${plan.no}`);
    else {
      console.log(`  width ±${s.width_pct}% (${s.width_basis}) -> new ticks ${s.new_ticks[0]} … ${s.new_ticks[1]}`);
      console.log(plan.resume ? `  would ${s.trade}, and mint the range from what the wallet then holds` : `  would withdraw and burn #${s.position}, ${s.trade}, and mint the new range from what the wallet then holds`);
      if (!plan.resume) console.log(`  the old range owes ${f(s.fees_owed_bnb)} BNB of fees: ${s.fees_to_bobai_bnb > 0 ? `${f(s.fees_to_bobai_bnb)} BNB would buy BOBAI (held in the wallet) before the mint, the rest into the new capital` : 'all of it would be minted into the new capital'} (kept share ${s.fees_kept_pct ?? KEEP}%)`);
      if (CONFIRM) {
        const out = await executeRebalance(pub, lpWallet(), lp, plan, log, { keptPct: KEEP });
        console.log(`  new position #${out.new_position} at ${out.new_ticks[0]} … ${out.new_ticks[1]}, liquidity ${out.liquidity_after}`);
        if (out.fees_folded_bnb != null) console.log(`  old range's fees ${f(out.fees_folded_bnb)} BNB: ${out.bobai_bnb > 0 ? `${f(out.bobai_bnb)} BNB bought ${out.bobai_units} BOBAI, held in ${out.bobai_held_in}` : out.fees_forward_why}`);
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
