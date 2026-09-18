#!/usr/bin/env node
// The DeFi agent by hand: the same three steps the daily worker runs
// (worker-lp/index.js), from a laptop, plan by default.
//
//   sweep     AI income (USD1 on the x402 wallet, $U on the provider wallet)
//             -> BNB -> the DeFi wallet
//   collect   the position's fees -> BNB -> part kept as capital, the rest buys
//             $BOBAI the wallet holds (until 2026-09-09: the buyback wallet)
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
//   node scripts/lp-agent.mjs --step ladder         what the worker's ladder step would do (planned here, never sent)
//   node scripts/lp-agent.mjs --self-test           prove the guards fire
//   node scripts/lp-agent.mjs --confirm [--step x]  send it
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, fallback } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  RPCS, INCOME_SOURCES, ADDR, splitForRange, amountsForRange, minsForRange, MINT_DRIFT_TICKS, tradeToRatio, TRADE_DUST_WBNB, unwindCalls, ticksAround, readBnbUsd, sender, v3SwapArgs, swapNote,
  planSweep, executeSweep, planCollect, executeCollect, planIncrease, executeIncrease,
  planRebalance, planRelocate, executeRelocate, executeRebalance, ticksAdjacent, positionSide, planLadder, healLadder, readPosition,
} from '../shared/lp-agent.js';
import {
  refuseCollect, refuseSweep, refuseIncrease, refuseRebalance, refuseRelocate, HOME_POOL, rebalanceWait, depositForcesReset, DEPOSIT_RESET_SHARE, RESET_AFTER_HOURS,
  GAS_RESERVE_BNB, MIN_GAS_BNB, MIN_COLLECT_BNB, MIN_SWEEP_BNB, MIN_INCREASE_BNB, MIN_REBALANCE_BNB,
  splitFees, FEE_SHARE_KEPT_PCT, resetForward, MIN_RESET_FORWARD_BNB,
  widthUpgrade, widthClassOf, rangeLeft, RANGE_LEFT_TICKS, ONE_SIDED_GAP_TICKS, pickWidth, WIDTH_UPGRADE_ENABLED, ladderDecision, LADDER_GATE, ladderHeal, resumeSide,
} from '../shared/lp-guards.js';
import { moneyFlow, flowLines, trimHistory, withArchive, HISTORY_CAP } from '../shared/lp-flow.js';

const CONFIRM = process.argv.includes('--confirm');
const SELF = process.argv.includes('--self-test');
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const stepArg = argOf('--step');
const ALL = ['sweep', 'collect', 'relocate', 'rebalance', 'ladder', 'increase'];
// The pool a relocate moves to, named by a person: `--step relocate --to 0x…`.
const TO = argOf('--to');
// Without --step, the hand script runs the four steps of a day; a relocate is
// asked for by name, with the pool it moves to.
const STEPS = stepArg ? [stepArg] : ALL.filter((x) => x !== 'relocate');
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
// The worker's ladder record (KV lp:ladder), as the agent's public record
// carries it: which position is the main range and which the reserve. Without
// it this script read a wallet with a reserve as "2 positions" and refused
// every step the worker was running fine (2026-09-17).
const RECORD_URL = 'https://agent.brainonbnb.com/lp/agent?format=json';

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
  is('the increase counts the BNB it put in — its own gas is on the gas line, not in here too (until 2026-09-18 it was in both, and left the profit twice)', near(fl.out.into_position_bnb, 0.0101 - 0.00003) && fl.out.increases === 1);
  const forcedRec = { history: [{ at: '2026-09-20T10:00:00Z', ok: true, acted: true, steps: { rebalance: { acted: true, new_position: '10', wrapped_waiting_bnb: 0.4, txs: [{ gas_bnb: 0.00005 }] } } }] };
  is('a re-set forced by a deposit wraps it into its own mint: that is capital put in, counted once', near(moneyFlow(forcedRec).out.into_position_bnb, 0.4) && near(moneyFlow({ history: [{ ...forcedRec.history[0], steps: { rebalance: { ...forcedRec.history[0].steps.rebalance, wrapped_waiting_bnb: undefined } } }] }).out.into_position_bnb, 0));
  is('three re-sets', fl.out.resets === 3);
  is('gas is summed over every transaction, the failed run included', fl.gas.transactions === 11 && near(fl.gas.bnb, 0.00016));
  is('a failed collect adds no fees', near(fl.in.fees.collected_bnb, 0.008));
  is('since = first run that acted, last_moved = the newest', fl.since === '2026-09-03T05:23:00Z' && fl.last_moved === '2026-09-09T12:00:00Z');
  // The cap and its archive (2026-09-15): what the cap pushes out is not
  // lost to the sums, and a record under the cap archives nothing.
  {
    const runs = Array.from({ length: 5 }, (_, i) => ({ at: `2026-09-0${i + 1}T05:23:00Z`, acted: true, steps: { collect: { acted: true, owed: { bnb_equivalent: 0.001 }, kept_pct: 50, kept_bnb: 0.0005, bobai_bnb: 0.0005, bobai_units: 100, txs: [{ gas_bnb: 0.00001 }] } } }));
    const t = trimHistory(runs.slice(0, 4), runs[4], 3);
    is('the cap keeps the newest runs', t.kept.length === 3 && t.kept[0].at === runs[2].at && t.kept[2].at === runs[4].at);
    is('what the cap pushed out comes back oldest first', t.dropped.length === 2 && t.dropped[0].at === runs[0].at && t.dropped[1].at === runs[1].at);
    const u = trimHistory(runs.slice(0, 2), runs[2], 3);
    is('a history under the cap drops nothing', u.kept.length === 3 && u.dropped.length === 0);
    is('the cap defaults to 200', HISTORY_CAP === 200 && trimHistory(runs, undefined).kept.length === 5);
    const whole = moneyFlow({ history: runs, last: runs[4] });
    const merged = withArchive({ history: t.kept, last: runs[4] }, { entries: t.dropped });
    const part = moneyFlow(merged);
    is('the sums over archive + history equal the sums over the whole', part.out.bobai_units === whole.out.bobai_units && near(part.in.fees.bnb, whole.in.fees.bnb) && near(part.gas.bnb, whole.gas.bnb) && merged.history_archived === 2);
    is('the sums over the capped history alone fall short', moneyFlow({ history: t.kept, last: runs[4] }).out.bobai_units < whole.out.bobai_units);
    is('no archive leaves the record as it is', withArchive({ history: t.kept }, null).history.length === 3 && withArchive({ history: t.kept }, { entries: [] }).history_archived === undefined);
  }
  is('a record whose last collect names no share takes it from the last re-set', moneyFlow({ history: rec.history, last: { at: '2026-09-08T19:50:00Z', steps: {} } }).rule.fee_share_kept_pct === 50);
  is('waiting lists only wallets holding something', fl.waiting.income.length === 1 && fl.waiting.income[0].token === 'USD1');
  is('waiting carries the fees owed and the spendable BNB', near(fl.waiting.fees_owed_bnb, 0.000016) && near(fl.waiting.wallet_spendable_bnb, 0.0075));
  // The newest owed figure wins (2026-09-12): an hourly check's rebalance step
  // folded into the last record reads what the position owes now; the daily
  // collect's figure is up to a day old. Without one, the collect's stands.
  is('an hourly rebalance step\'s owed figure outranks the daily collect\'s', (() => { const l = rec.last; const r2 = { ...rec, last: { ...l, steps: { ...l.steps, rebalance: { ...(l.steps.rebalance || {}), fees_owed_bnb: 0.0049 } } } }; return near(moneyFlow(r2).waiting.fees_owed_bnb, 0.0049); })());
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
  check('out of range but the range is all WBNB below the price: BNB joins it, no trade (2026-09-16)', refuseIncrease({ ...healthyIncrease, inRange: false, wbnbOnly: true }), false);
  check('out of range and the range is all of the other side above the price: refuses, names the ladder', /ladder/.test(refuseIncrease({ ...healthyIncrease, inRange: false, wbnbOnly: false }) || '') ? null : 'no ladder named', false);
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
  check('at the edge (outside, within the slack): not left, refuses', refuseRebalance({ ...healthyRebalance, atEdge: true, side: 'below', ticksAway: 30 }), true);
  check('… and names the slack', /at the edge/.test(refuseRebalance({ ...healthyRebalance, atEdge: true, side: 'below', ticksAway: 30 })) && new RegExp(String(RANGE_LEFT_TICKS)).test(refuseRebalance({ ...healthyRebalance, atEdge: true, side: 'below', ticksAway: 30 })) ? null : 'no slack named', false);
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
    { width: 1, earnings: { net_usd_per_day: 0.6983 }, earnings_24h: { net_usd_per_day: 0.71 } },
    { width: 2, earnings: { net_usd_per_day: 0.6111 }, earnings_24h: { net_usd_per_day: 0.60 } },
    { width: 'full', earnings: null, earnings_24h: null },
  ];
  // RETIRED 2026-09-16: a position in range is never touched; the width
  // changes at the next one-sided re-set. The live case of 2026-09-10 ($154
  // at 2%, the record picking 1%) that used to go through is now refused,
  // and so is everything else — the function says why, in one sentence.
  const up = { daily: true, inRange: true, ticks: [-57990, -57610], tick: -57800, pick: rows[0], rows, hoursOfPrices: 182, valueBnb: 0.2127, bnbUsd: 723.6, resetCostUsd: 0.1 };
  const u = widthUpgrade(up);
  check('the upgrade is retired: even the case that used to pay back in a day is refused', u.upgrade ? 'upgraded' : null, false);
  check('… and says the width changes at the next re-set', /next re-set/.test(u.why) ? null : u.why, false);
  check('the flag says so too', WIDTH_UPGRADE_ENABLED === false ? null : 'enabled', false);
  for (const [state, why] of [
    [{ ...up, daily: false }, 'the hourly check never upgrades'],
    [{ ...up, inRange: false }, 'outside the range it is a re-set, not an upgrade'],
    [{ ...up, pick: null }, 'no pick, nothing to upgrade to'],
  ]) check(why, (() => { const r = widthUpgrade(state); return r.upgrade ? null : r.why; })(), true);

  console.log('the one-sided range (2026-09-16)');
  // Below its range the position is all token0 (CAKE here); the new range
  // sits above the price, starts the gap beyond it on the pool's grid and
  // spans what a centred ±width range spans. Above: the mirror image.
  const tickNow = -57807, sp = 10;
  const aboveP = ticksAdjacent(tickNow, 7, sp, 'below');
  const centred7 = ticksAround(tickNow, 7, sp);
  is('price below the old range: the new range is above the price', aboveP.side === 'above_price' && aboveP.tickLower > tickNow);
  is(`… starting at least ${ONE_SIDED_GAP_TICKS} ticks beyond it, on the grid`, aboveP.tickLower - tickNow >= ONE_SIDED_GAP_TICKS && aboveP.tickLower - tickNow < ONE_SIDED_GAP_TICKS + sp && aboveP.tickLower % sp === 0 && aboveP.tickUpper % sp === 0);
  is('… spanning what the centred range of that width spans (within a grid step)', Math.abs((aboveP.tickUpper - aboveP.tickLower) - (centred7.tickUpper - centred7.tickLower)) <= sp);
  const belowP = ticksAdjacent(tickNow, 3, sp, 'above');
  is('price above the old range: the new range is below the price, the gap away', belowP.side === 'below_price' && belowP.tickUpper < tickNow && tickNow - belowP.tickUpper >= ONE_SIDED_GAP_TICKS && belowP.tickUpper % sp === 0);
  // A one-sided range needs only the token the old range ended in: the
  // ratio trade has nothing to do.
  const sqA = Math.pow(1.0001, tickNow / 2), spA = splitForRange(sqA, aboveP.tickLower, aboveP.tickUpper);
  is('a range above the price takes only token0 — all CAKE, no WBNB', spA.perL0 > 0 && spA.perL1 === 0);
  is('… so a wallet holding only CAKE trades nothing for it', tradeToRatio({ wbnb: 0n, other: 10n ** 20n, perLWbnb: spA.perL1, perLOther: spA.perL0, otherPerWbnb: 1 / (sqA ** 2), wbnbPerOther: sqA ** 2 }).side === null);
  is('… and a deposit of WBNB beside it is all spent on CAKE (the fallen side, bought low)', (() => { const t = tradeToRatio({ wbnb: 10n ** 17n, other: 10n ** 20n, perLWbnb: spA.perL1, perLOther: spA.perL0, otherPerWbnb: 1 / (sqA ** 2), wbnbPerOther: sqA ** 2 }); return t.side === 'buy' && t.amount === 10n ** 17n; })());
  // rangeLeft: inside, at an edge, gone — both ways.
  const lo7 = -57530, hi7 = -56940;
  is('inside the range: not outside, not left', (() => { const r = rangeLeft(-57200, lo7, hi7); return !r.outside && !r.left && r.side === null; })());
  is(`${RANGE_LEFT_TICKS} ticks below the lower edge: outside, at the edge, not left`, (() => { const r = rangeLeft(lo7 - RANGE_LEFT_TICKS, lo7, hi7); return r.outside && r.side === 'below' && !r.left && r.ticks_away === RANGE_LEFT_TICKS; })());
  is('one tick further: left', rangeLeft(lo7 - RANGE_LEFT_TICKS - 1, lo7, hi7).left === true);
  is('the live tick of 2026-09-16 05:05 (277 ticks under): left, below', (() => { const r = rangeLeft(-57807, lo7, hi7); return r.left && r.side === 'below' && r.ticks_away === 277; })());
  is('at the upper tick itself: outside (the pool counts the upper tick as out), at the edge', (() => { const r = rangeLeft(hi7, lo7, hi7); return r.outside && r.side === 'above' && !r.left; })());
  is('far above: left, above', rangeLeft(hi7 + 200, lo7, hi7).left === true && rangeLeft(hi7 + 200, lo7, hi7).side === 'above');
  is('no ticks: nothing', rangeLeft(-57807, null, null).outside === false);
  // pickWidth: the width that ended the most ahead against holding over
  // the week, fees in; the width in use is kept under the bar.
  const wk = (w, fees, vs, share = 0.9, hours = 168) => ({ width: w, earnings: { net_usd_per_day: 0.1 }, earnings_7d: { hours, hours_in_range: hours * share, fees_usd: fees, vs_holding_usd: vs } });
  // The live week of 2026-09-16: narrow earned the most fees and lost the most to the trend.
  const week = [wk(0.25, 2.88, -5.42), wk(1, 2.53, -4.21), wk(3, 1.41, -1.91), wk(4, 1.14, -1.37), wk(5, 0.93, -0.99), wk(7, 0.72, -0.45), wk(10, 0.54, -0.05), { width: 'full', earnings_7d: null }];
  const pk = pickWidth(week);
  is('the pick is the width with the most money against holding, fees in (±10%: $0.49, not ±4%: −$0.23)', pk && pk.width === 10 && pk.score_usd === 0.49 && pk.kept_current === false);
  is('… and the basis names the week', /ended the most ahead/.test(pk.basis) && /±10% \+\$0\.49/.test(pk.basis) && /±4% −\$0\.23/.test(pk.basis));
  is('the width in use is replaced when the lead is over the bar (±4% in use, ±10% $0.72 ahead)', (() => { const r = pickWidth(week, { current: 4 }); return r.width === 10 && r.kept_current === false && /over the bar/.test(r.basis); })());
  is('… and kept when the lead is under it (±7% in use at $0.27, ±10% at $0.29: the bar is $0.30)', (() => { const r = pickWidth([wk(7, 0.72, -0.45), wk(10, 0.54, -0.25)], { current: 7 }); return r.width === 7 && r.kept_current === true && /stays/.test(r.basis) && r.best_width === 10; })());
  is('… the bar is a tenth of the score in use, at least two cents (a score of $0.05 in use needs $0.07)', (() => { const rows = [wk(2, 0.05, 0), wk(5, 0.069, 0), wk(7, 0.071, 0)]; return pickWidth(rows, { current: 2 }).width === 7 && pickWidth(rows.slice(0, 2), { current: 2 }).width === 2; })());
  is('a width in use that is the best stays and says so', (() => { const r = pickWidth(week, { current: 10 }); return r.width === 10 && r.kept_current === true && /the width in use/.test(r.basis); })());
  is('a ranging week (no loss to the trend) picks the narrowest, which earns the most', pickWidth([wk(1, 2.5, 0), wk(3, 1.4, 0), wk(10, 0.5, 0)]).width === 1);
  is('a tie goes to the wider width', pickWidth([wk(3, 1, -0.3), wk(5, 0.7, 0)]).width === 5);
  is('full range, rows without a week and rows without the holding line are never picked', pickWidth([{ width: 'full', earnings_7d: { hours: 168, hours_in_range: 168, fees_usd: 1, vs_holding_usd: 0 } }, { width: 2, earnings_7d: null }, { width: 3, earnings_7d: { hours: 168, hours_in_range: 100, fees_usd: 1 } }]) === null);
  is('a row with no hours does not count', pickWidth([{ width: 2, earnings_7d: { hours: 0, hours_in_range: 0, fees_usd: 0, vs_holding_usd: 0 } }]) === null);
  is('the pick carries fees, the holding line, the share of hours in range and the week', pk.fees_usd === 0.54 && pk.vs_holding_usd === -0.05 && pk.in_range_share === 0.9 && pk.hours === 168 && pk.best_width === 10);
  console.log('relocate');
  const relOk = { positions: 1, hasTarget: true, targetHasWbnb: true, samePool: false, toPool: HOME_POOL.pool, width: 1, valueBnb: 0.3, move: { move: true, why: 'x' } };
  check('a move to any pool but home: refuses by the operator\'s decision', /stays in CAKE\/BNB 0\.05%/.test(refuseRelocate({ ...relOk, toPool: '0x172fcd41e0913e95784454622d1c3724f546f849' }) || ''), true);
  check('a move with no pool named: refuses by the same decision', /stays in CAKE\/BNB 0\.05%/.test(refuseRelocate({ ...relOk, toPool: null }) || ''), true);
  check('home, spelled in capitals, is still home', refuseRelocate({ ...relOk, toPool: HOME_POOL.pool.toUpperCase().replace('0X', '0x') }), false);
  check('no position: refuses', refuseRelocate({ ...relOk, positions: 0 }), true);
  check('two positions: refuses', refuseRelocate({ ...relOk, positions: 2 }), true);
  check('the switch rule says stay: refuses with its reason', /switch rule says stay/.test(refuseRelocate({ ...relOk, move: { move: false, why: 'lead under 25%' } }) || ''), true);
  check('no pool named: refuses', refuseRelocate({ ...relOk, hasTarget: false }), true);
  check('a pool without WBNB: refuses', refuseRelocate({ ...relOk, targetHasWbnb: false }), true);
  check('the pool the position is in: refuses', refuseRelocate({ ...relOk, samePool: true }), true);
  check('no width: refuses', refuseRelocate({ ...relOk, width: null }), true);
  check('under the floor: refuses', refuseRelocate({ ...relOk, valueBnb: 0.01 }), true);
  check('a move the rule allows: goes', refuseRelocate(relOk), false);
  check('a person naming the pool passes no rule and goes', refuseRelocate({ ...relOk, move: null }), false);

  console.log('the ladder (2026-09-16): BNB beside a sell ladder opens a buy ladder');
  const L = (over) => ({ positions: 1, reserve: false, mainSide: 'other', reserveSide: null, spendableBnb: 0.03, reserveLeft: false, ...over });
  is(`main all of the other side above the price, ${LADDER_GATE} aside, BNB over the floor: mint the reserve`, ladderDecision(L({})).act === 'mint_reserve');
  is('… under the floor: nothing, and it says the ladder opens with the next deposit', (() => { const d = ladderDecision(L({ spendableBnb: MIN_INCREASE_BNB / 2 })); return d.act === null && /next deposit/.test(d.why); })());
  is('main all WBNB below the price: no ladder, the increase takes the BNB', (() => { const d = ladderDecision(L({ mainSide: 'wbnb' })); return d.act === null && /increase step/.test(d.why); })());
  is('main in range: no ladder, the increase takes the BNB', ladderDecision(L({ mainSide: 'both' })).act === null);
  is('no position: nothing', ladderDecision(L({ positions: 0 })).act === null);
  is('two positions the record does not name: a decision for a person', /person/.test(ladderDecision(L({ positions: 2, reserve: false })).why));
  is('three positions: a decision for a person', /person/.test(ladderDecision(L({ positions: 3, reserve: true })).why));
  const R = (over) => L({ positions: 2, reserve: true, reserveSide: 'wbnb', ...over });
  is('reserve stands (WBNB below), main above, BNB over the floor: grow the reserve', ladderDecision(R({})).act === 'increase_reserve');
  is('… under the floor: the ladder stands, nothing to do', (() => { const d = ladderDecision(R({ spendableBnb: 0.001 })); return d.act === null && /stands/.test(d.why); })());
  is('both hold only the other side (the price fell through the reserve): merge', ladderDecision(R({ reserveSide: 'other' })).act === 'merge');
  is('both hold only WBNB (the price rose through the main range): merge', ladderDecision(R({ mainSide: 'wbnb', reserveSide: 'wbnb' })).act === 'merge');
  is('the merge outranks a left reserve and waiting BNB', ladderDecision(R({ reserveSide: 'other', reserveLeft: true, spendableBnb: 1 })).act === 'merge');
  is('the reserve left below the price by more than the slack, main still above: re-set the reserve beside the price', ladderDecision(R({ reserveLeft: true })).act === 'reset_reserve');
  // The reserve does not chase a price the main range is in (2026-09-17: eight re-sets in a day, 0.96% of the reserve, fees of dust).
  is('the reserve left, but the main range is in range: it waits where it is, no re-set', (() => { const d = ladderDecision(R({ reserveLeft: true, mainSide: 'both', spendableBnb: 0.001 })); return d.act === null && /waits where it is/.test(d.why) && /buys on the way down/.test(d.why); })());
  is('… and with BNB over the floor the increase still takes it, not a re-set', (() => { const d = ladderDecision(R({ reserveLeft: true, mainSide: 'both' })); return d.act === null && /increase step/.test(d.why); })());
  is('the reserve left and the main range unread: no re-set', ladderDecision(R({ reserveLeft: true, mainSide: null, spendableBnb: 0.001 })).act === null);
  is('main in range, reserve below it, BNB waits: the increase takes it, not the ladder', (() => { const d = ladderDecision(R({ mainSide: 'both' })); return d.act === null && /increase step/.test(d.why); })());
  is('a standing ladder says where the main range is: in range, not "above the price"', /main in range/.test(ladderDecision(R({ mainSide: 'both', spendableBnb: 0.001 })).why) && /main above the price/.test(ladderDecision(R({ spendableBnb: 0.001 })).why));
  is('the gate is a worker variable named LP_LADDER', LADDER_GATE === 'LP_LADDER');
  // The ladder record follows the chain (2026-09-17, the day the agent stood still).
  const HL = (over) => ({ main: '7450561', reserve: '7450613', held: ['7450613', '7451444'], samePool: true, ...over });
  is('the record names a burnt main range, the reserve stands beside one other position in its pool: that one is the main range', (() => { const h = ladderHeal(HL({})); return h && h.main === '7451444' && /7450561/.test(h.why); })());
  is('… the ids may come as numbers or bigints', ladderHeal(HL({ main: 7450561, reserve: 7450613n, held: [7450613n, 7451444n] }))?.main === '7451444');
  is('the main range is still held: nothing to heal', ladderHeal(HL({ held: ['7450613', '7450561'] })) === null);
  is('the reserve is gone: nothing to heal, the guards decide', ladderHeal(HL({ held: ['7451444', '7451500'] })) === null);
  is('a third position: nothing to heal', ladderHeal(HL({ held: ['7450613', '7451444', '7451500'] })) === null);
  // The reserve alone (2026-09-18): the main range was burned by a re-set whose mint failed.
  is('the reserve is the only position left: it is the main range now and the ladder is closed', (() => { const h = ladderHeal(HL({ held: ['7450613'] })); return h && h.main === '7450613' && h.reserve === null && h.closed === true && /closed/.test(h.why); })());
  is('one position that is not the reserve: nothing to heal, the guards decide', ladderHeal(HL({ held: ['7451444'] })) === null);
  is('... and the main range alone, still held: nothing to heal', ladderHeal(HL({ held: ['7450561'] })) === null);
  is('the other position is in another pool: nothing to heal', ladderHeal(HL({ samePool: false })) === null);
  is('no reserve in the record, or no main: nothing to heal', ladderHeal(HL({ reserve: null })) === null && ladderHeal(HL({ main: null })) === null);
  // The same class on the reserve's side (2026-09-18): a reserve minted, its id never written.
  is('the main range is held beside one position the record does not name: that one is the reserve', (() => { const h = ladderHeal(HL({ main: '7451444', reserve: null, held: ['7451444', '7461743'] })); return h && h.main === '7451444' && h.reserve === '7461743' && h.adopted === true && /no reserve/.test(h.why); })());
  is('… also when the record still names a reserve burnt at its re-set', (() => { const h = ladderHeal(HL({ main: '7451444', reserve: '7450613', held: ['7461743', '7451444'] })); return h && h.reserve === '7461743' && h.adopted === true && /7450613/.test(h.why); })());
  is('… never across pools, never with a third position, never when the record is right', ladderHeal(HL({ main: '7451444', reserve: null, held: ['7451444', '7461743'], samePool: false })) === null && ladderHeal(HL({ main: '7451444', reserve: null, held: ['7451444', '7461743', '7461800'] })) === null && ladderHeal(HL({ main: '7451444', reserve: '7461743', held: ['7451444', '7461743'] })) === null);
  // A mint from the wallet finishes the re-set it belongs to (2026-09-18).
  is('a wallet left holding the other side alone is minted one-sided above the price, no trade', resumeSide(1) === 'below' && resumeSide(0.97) === 'below' && ticksAdjacent(-57200, 7, 10, resumeSide(1)).side === 'above_price');
  is('… all WBNB: one-sided below the price', resumeSide(0) === 'above' && resumeSide(0.04) === 'above' && ticksAdjacent(-57200, 7, 10, resumeSide(0)).side === 'below_price');
  is('… a mixed wallet is centred as before, and a wallet with nothing in it decides nothing', resumeSide(0.5) === null && resumeSide(0.9) === null && resumeSide(0.1) === null && resumeSide(null) === null && resumeSide(NaN) === null);
  is('planRebalance asks resumeSide when it mints from the wallet (source pin)', /if \(resume && valueBnb > 0\) oneSided = resumeSide\(/.test((await import('node:fs')).readFileSync(new URL('../shared/lp-agent.js', import.meta.url), 'utf8')));
  // THE MAIN RANGE IS GONE, THE RESERVE STANDS (2026-09-18): a re-set burnt the
  // main range beside the reserve and its mint failed. Driven through the real
  // plan functions over a chain that answers from a table — no RPC.
  {
    const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', POOL = '0xafb2da14056725e3ba3a30dd846b6bbbd7886c56', FACT = '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865', ME = ADDR.LP_WALLET;
    const tickNow = -57900;   // fell out of the old main range (-57860 …), inside the reserve (-59000 … -57090)
    const chain = ({ cake, wbnb = 0n, ids = [7461743n] }) => ({
      getBalance: async () => 6n * 10n ** 15n,
      simulateContract: async () => ({ result: [0n, 0n] }),
      readContract: async ({ address, functionName, args }) => {
        const to = String(address).toLowerCase();
        if (functionName === 'balanceOf') return to === ADDR.V3_POSITION_MANAGER ? BigInt(ids.length) : to === CAKE ? cake : to === ADDR.WBNB ? wbnb : 0n;
        if (functionName === 'tokenOfOwnerByIndex') return ids[Number(args[1])];
        if (functionName === 'positions') return [0n, '0x0000000000000000000000000000000000000000', CAKE, ADDR.WBNB, 500, -59000, -57090, 10n ** 19n, 0n, 0n, 0n, 0n];
        if (functionName === 'factory') return FACT;
        if (functionName === 'getPool') return POOL;
        if (functionName === 'slot0') return [BigInt(Math.floor(Math.pow(1.0001, tickNow / 2) * 2 ** 96)), tickNow, 0, 0, 0, 0, true];
        if (functionName === 'tickSpacing') return 10;
        if (functionName === 'token0') return CAKE;
        if (functionName === 'token1') return ADDR.WBNB;
        if (functionName === 'fee') return 500;
        throw new Error(`the table has no answer for ${functionName}`);
      },
    });
    const LAD = { main: '7451444', reserve: '7461743' };
    const REC = { hours_of_prices: 300, rows: [], earnings_pick: { width: 7, earnings: { net_usd_per_day: 0.1, resets: 1, reset_cost_usd: 0 } } };
    const loose = chain({ cake: 450n * 10n ** 18n });   // ~1.37 BNB of CAKE the burnt main range left in the wallet
    const rp = await readPosition(loose, ME, LAD);
    is('only the reserve held beside a main range the record names: the wallet holds NO main range, the reserve rides along', rp.positions === 0 && rp.pos === null && String(rp.reserve?.tokenId) === '7461743' && rp.main_missing === '7451444');
    is('… the same wallet without the record, or once the ladder is closed, reads the one position as the position', (await readPosition(loose, ME, null)).positions === 1 && (await readPosition(loose, ME, { main: '7461743', reserve: null })).positions === 1);
    is('… and nothing grows the reserve with the loose capital: increase, ladder and collect all stand', /no position to grow/.test((await planIncrease(loose, ME, null, LAD)).no || '') && (await planLadder(loose, ME, { record: REC, ladder: LAD })).act === null && /no position/.test((await planCollect(loose, ME, LAD).catch((e) => ({ no: `no position (${e.message})` }))).no || ''));
    const rs = await planRebalance(loose, ME, { record: REC, pool: POOL, ladder: LAD });
    is('the re-set is finished from the wallet beside the reserve: one-sided above the price, all of the other side, no trade', rs.resume === true && rs.no === null && rs.oneSided === 'below' && rs.ticks.side === 'above_price' && rs.ticks.tickLower > tickNow && rs.trade === null && rs.summary.reserve?.position === '7461743' && rs.summary.main_missing === '7451444' && rs.summary.value_with_reserve_bnb > rs.summary.value_bnb);
    is('ladderHeal leaves that wallet alone — the capital is there to mint', (await healLadder(loose, ME, { ...LAD })) === null && ladderHeal(HL({ held: ['7450613'], looseBnb: 1.37 })) === null && ladderHeal(HL({ held: ['7450613'], looseBnb: MIN_REBALANCE_BNB })) === null);
    const dust = chain({ cake: 10n ** 18n });   // ~0.003 BNB: nothing to mint a main range from
    is('… and closes the ladder when nothing worth minting lies beside the reserve', (await healLadder(dust, ME, { ...LAD }))?.closed === true && ladderHeal(HL({ held: ['7450613'], looseBnb: MIN_REBALANCE_BNB - 0.001 }))?.closed === true);
    is('… where the mint would be refused too (one floor for both, so the wallet never waits between them)', /below the 0.02 BNB floor/.test((await planRebalance(dust, ME, { record: REC, pool: POOL, ladder: LAD })).no || ''));
  }
  // The re-set beside a reserve: it reads its old range by id and names its new one by the mint (source pins; the chain half cannot run here).
  const coreSrc = (await import('node:fs')).readFileSync(new URL('../shared/lp-agent.js', import.meta.url), 'utf8');
  const rebSrc = coreSrc.slice(coreSrc.indexOf('export async function executeRebalance'), coreSrc.indexOf('export async function', coreSrc.indexOf('export async function executeRebalance') + 10));
  is('executeRebalance never asks for "the position of the wallet" — beside a reserve that read names none', rebSrc.length > 500 && !/readPosition\(/.test(rebSrc));
  is('… it reads the old range by the id the plan names, and the new one as the id the mint added', /readOne\(pub, account\.address, plan\.tokenId\)/.test(rebSrc) && /mintedSince\(pub, account\.address, idsBeforeMint\)/.test(rebSrc));
  // The reserve grows through the increase itself (2026-09-17): with the price inside it, WBNB alone is liquidity zero and the manager reverts (simulated on chain).
  const ladSrc = coreSrc.slice(coreSrc.indexOf('export async function executeLadder'));
  const incResSrc = ladSrc.slice(ladSrc.indexOf("plan.act === 'increase_reserve'"), ladSrc.indexOf("plan.act === 'reset_reserve'"));
  is('increase_reserve plans and runs the increase on the reserve range, read at the price now', incResSrc.length > 200 && /planIncrease\(pub, account\.address, \{ positions: 1, tokenId: plan\.reserve\.tokenId, pos: plan\.reserve\.pos/.test(incResSrc) && /executeIncrease\(pub, wallet, account, inc/.test(incResSrc));
  is('… and never sends a WBNB-only increaseLiquidity of its own', !/increaseLiquidity/.test(incResSrc) && !/amount0Desired/.test(incResSrc));
  is('what amountsForRange says of WBNB alone: into a range the price is in, nothing; into a range below the price, all of it', (() => {
    const inside = amountsForRange(Math.pow(1.0001, -57143 / 2), -59000, -57090, 0n, 10n ** 16n);
    const below = amountsForRange(Math.pow(1.0001, -57000 / 2), -59000, -57090, 0n, 10n ** 16n);
    return inside.L === 0 && inside.amount1 === 0n && below.amount1 > 99n * 10n ** 14n;
  })());
  // positionSide: which token a range holds at a price.
  const psPos = [0n, '0x0', '0xcake', '0xwbnb', 500, -57780, -57000, 10n ** 20n];   // CAKE/BNB: WBNB is token1
  is('a range above the price holds only the other side', positionSide(psPos, Math.pow(1.0001, -57807 / 2), false).side === 'other');
  is('a range below the price holds only WBNB', positionSide(psPos, Math.pow(1.0001, -56900 / 2), false).side === 'wbnb');
  is('a range around the price holds both', positionSide(psPos, Math.pow(1.0001, -57400 / 2), false).side === 'both');
  is('a range with no liquidity holds nothing', positionSide([...psPos.slice(0, 7), 0n], Math.pow(1.0001, -57400 / 2), false).side === null);
  is('… and its value in BNB is the two sides at the price', (() => { const v = positionSide(psPos, Math.pow(1.0001, -57400 / 2), false); return v.valueBnb > 0 && Math.abs(v.valueBnb - (v.wbnb + v.other * Math.pow(1.0001, -57400)) / 1e18) < 1e-12; })());

  console.log('deposit forces a re-set');
  check('in range: no', depositForcesReset({ inRange: true, spendableBnb: 1, valueBnb: 0.3 }), false);
  check('a deposit under the increase floor: no', depositForcesReset({ inRange: false, spendableBnb: 0.004, valueBnb: 0.01 }), false);
  check(`a deposit under ${DEPOSIT_RESET_SHARE * 100}% of the position: no`, depositForcesReset({ inRange: false, spendableBnb: 0.05, valueBnb: 0.3 }), false);
  check(`a deposit of exactly ${DEPOSIT_RESET_SHARE * 100}%: yes`, depositForcesReset({ inRange: false, spendableBnb: 0.075, valueBnb: 0.3 }), true);
  check('the 2026-09-10 case, 0.3056 beside 0.29: yes, and it says the share', /105%/.test(depositForcesReset({ inRange: false, spendableBnb: 0.3056, valueBnb: 0.29 }) || ''), true);
  check('no position value: no', depositForcesReset({ inRange: false, spendableBnb: 0.3, valueBnb: 0 }), false);

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

  console.log('the trade into the range\'s ratio (the 2026-09-14 leftover)');
  // A wallet that came out of its old range all in WBNB (the price rose
  // through the top) must buy exactly the other side a centred ±3% range
  // takes — no 99% headroom, no 2% over-buy — so that the mint takes both
  // sides whole. Leftover = the share of the value neither side of the mint
  // uses. The old rule (99% of L, 102% of the buy) left 1.6% on 2026-09-14.
  const t3 = ticksAround(-57235, 3, 10), sq3 = sqrtAt(-57235);
  const sp3 = splitForRange(sq3, t3.tickLower, t3.tickUpper);
  const pxW = sq3 ** 2;                       // token1 per token0; WBNB is token1 here (CAKE/BNB)
  const pW = sp3.perL1, pO = sp3.perL0, rB = 1 / pxW, rS = pxW;   // rB: other per WBNB, rS: WBNB per other
  const leftover = (W, C, tr) => {
    let w = W, c = C;
    if (tr.side === 'buy') { w -= Number(tr.amount); c += Number(tr.amount) * rB; }
    if (tr.side === 'sell') { c -= Number(tr.amount); w += Number(tr.amount) * rS; }
    const L = Math.min(w / pW, c / pO);
    const used = L * pW + L * pO * rS, value = w + c * rS;
    return (value - used) / value;
  };
  const oldRule = (W, C) => {
    const value = W + C * rS, Ln = (value * 0.99) / (pW + pO * rS), target = Ln * pO;
    return C > target ? { side: 'sell', amount: BigInt(Math.floor(C - target)) } : { side: 'buy', amount: BigInt(Math.floor((target - C) * rS * 1.02)) };
  };
  const Wall = 1.026e18;
  const tBuy = tradeToRatio({ wbnb: BigInt(Wall), other: 0n, perLWbnb: pW, perLOther: pO, otherPerWbnb: rB, wbnbPerOther: rS });
  is('all WBNB: it buys the other side', tBuy.side === 'buy' && tBuy.amount > 0n && tBuy.amount < BigInt(Wall));
  is('all WBNB: after the buy the mint takes everything (leftover < 0.01%)', leftover(Wall, 0, tBuy) < 1e-4);
  is('the old rule left about 1% even at a still price (1.6% on 2026-09-14 with the fee and the drift)', leftover(Wall, 0, oldRule(Wall, 0)) > 0.009);
  const Call = Wall / rS;
  const tSell = tradeToRatio({ wbnb: 0n, other: BigInt(Math.floor(Call)), perLWbnb: pW, perLOther: pO, otherPerWbnb: rB, wbnbPerOther: rS });
  is('all other side: it sells, and the mint takes everything', tSell.side === 'sell' && leftover(0, Call, tSell) < 1e-4);
  const Lx = 1e15, inRatio = tradeToRatio({ wbnb: BigInt(Math.floor(Lx * pW)), other: BigInt(Math.floor(Lx * pO)), perLWbnb: pW, perLOther: pO, otherPerWbnb: rB, wbnbPerOther: rS });
  is('a wallet already in the ratio trades nothing', inRatio.side === null || inRatio.amount < 1000n);
  const feeRate = 0.9995;   // a 0.05% pool: the quoter's rate carries the fee
  const buyFee = tradeToRatio({ wbnb: BigInt(Wall), other: 0n, perLWbnb: pW, perLOther: pO, otherPerWbnb: rB * feeRate, wbnbPerOther: rS * feeRate });
  is('with the pool fee in the rate it buys a little more WBNB-worth, still no leftover', buyFee.amount > tBuy.amount && (() => { let w = Wall - Number(buyFee.amount), c = Number(buyFee.amount) * rB * feeRate; const L = Math.min(w / pW, c / pO); return (w + c * rS - L * pW - L * pO * rS) / (w + c * rS) < 1e-4; })());
  const rangeAbove = splitForRange(sqrtAt(t3.tickUpper + 50), t3.tickLower, t3.tickUpper);   // price above the range: only token1 (WBNB) is held
  const edgeW = tradeToRatio({ wbnb: 0n, other: BigInt(Math.floor(Call)), perLWbnb: rangeAbove.perL1, perLOther: rangeAbove.perL0, otherPerWbnb: rB, wbnbPerOther: rS });
  is('above the range everything on the other side is sold', edgeW.side === 'sell' && edgeW.amount === BigInt(Math.floor(Call)));
  const rangeBelow = splitForRange(sqrtAt(t3.tickLower - 50), t3.tickLower, t3.tickUpper);
  const edgeC = tradeToRatio({ wbnb: BigInt(Wall), other: 0n, perLWbnb: rangeBelow.perL1, perLOther: rangeBelow.perL0, otherPerWbnb: rB, wbnbPerOther: rS });
  is('below the range all WBNB is spent on the other side', edgeC.side === 'buy' && edgeC.amount === BigInt(Wall));
  // A balance no double can hold: Number() of each of these rounds UP, and the
  // swap that asked for the rounded figure reverted for want of a few hundred wei.
  const odd = [31234567890123458700n, 9007199254740993n * 1001n, 1561000000000000123n + 2n ** 60n];
  is('"all of one side" never asks for more than the wallet holds, whatever the balance (sell)', odd.every((c) => { const t = tradeToRatio({ wbnb: 0n, other: c, perLWbnb: rangeAbove.perL1, perLOther: rangeAbove.perL0, otherPerWbnb: rB, wbnbPerOther: rS }); return t.side === 'sell' && t.amount <= c && c - t.amount < 10n ** 6n; }));
  is('… nor on the buying side', odd.every((w) => { const t = tradeToRatio({ wbnb: w, other: 0n, perLWbnb: rangeBelow.perL1, perLOther: rangeBelow.perL0, otherPerWbnb: rB, wbnbPerOther: rS }); return t.side === 'buy' && t.amount <= w && w - t.amount < 10n ** 6n; }));
  is('… and the fixture is one the old rule failed: the nearest double lies above at least one of these balances', odd.some((c) => BigInt(Number(c)) > c));
  is('no liquidity on either side: nothing to trade', tradeToRatio({ wbnb: BigInt(Wall), other: 0n, perLWbnb: 0, perLOther: 0, otherPerWbnb: rB, wbnbPerOther: rS }).side === null);
  is('the dust floor is a ten-thousandth of a BNB', TRADE_DUST_WBNB === 10n ** 14n);

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
    // The allowance check asks the sender whom it acts for. The collect of
    // 2026-09-14 04:23 forgot to say and asked for "undefined": the sender
    // now knows its wallet's owner on its own.
    const owned = sender(fakePub, { ...fakeWallet, account: { address: '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A' } }, []);
    check("a sender knows its wallet's owner without being told", owned.owner === '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A', true);
    check('… and a wallet without an account leaves it unset, not a guess', sender(fakePub, fakeWallet, []).owner === undefined, true);
    // Until 2026-09-14 each execute step made its own transaction list and it
    // came back only on a throw out of `send`. A step that sent and then failed
    // on a READ reported nothing sent: the collect of that morning recorded an
    // empty list against a collect that had run on chain. The list belongs to
    // the caller now, so it survives whatever throws.
    const mine = [];
    await sender(fakePub, { writeContract: async () => '0xaa' }, mine)('collect', {});
    let readErr = null;
    try { await Promise.reject(new Error('a read failed after the send')); } catch (e) { readErr = e; }
    check('the caller keeps the transactions when the failure comes from a read', mine.length === 1 && mine[0].hash === '0xaa', true);
    check("… which the error itself never carried, so only the caller's list can say it", readErr.txs === undefined, true);
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
    console.log('SWEEP — AI income -> BNB -> DeFi wallet');
    const feed = await readBnbUsd(pub);
    console.log(`  BNB ${f(feed.bnbUsd, 2)} $ (Chainlink, ${feed.feedAgeS} s old)`);
    for (const src of INCOME_SOURCES) {
      const key = process.env[src.keyEnv];
      if (!key) { console.log(`  ${src.name}: no ${src.keyEnv} in .env — skipped`); continue; }
      const a = acct(key);
      if (a.address.toLowerCase() !== src.wallet.toLowerCase()) { console.log(`  ${src.name}: ${src.keyEnv} does not open ${src.wallet} — skipped`); continue; }
      const plan = await planSweep(pub, src, feed);
      const s = plan.summary;
      console.log(`  ${src.name} ${src.wallet}: ${f(s.balance, 4)} ${src.symbol} (${src.earns}), worth ${f(s.bnb_equivalent)} BNB${s.implied_usd != null ? `, route pays $${s.implied_usd}` : ''}, its wallet holds ${f(s.wallet_bnb ?? s.gas_bnb)} BNB for gas`);
      if (plan.no) { console.log(`    nothing to do: ${plan.no}`); continue; }
      console.log(`    would sell ${f(s.sweeping, 4)} ${src.symbol}${s.capped ? ' (capped for this run)' : ''} for ~${f(s.bnb_equivalent)} BNB, paid straight to ${ADDR.LP_WALLET}`);
      if (!CONFIRM) continue;
      const wallet = createWalletClient({ account: a, chain: bsc, transport: transport() });
      const out = await executeSweep(pub, wallet, a, plan, log);
      console.log(`    sold ${out.sold} ${src.symbol}, the DeFi wallet received ${out.received_bnb} BNB`);
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

  // The wallet as the worker sees it: through the ladder record, healed in
  // hand the way the worker heals it (ladderHeal) — this script writes no KV.
  let ladder = null;
  try {
    const rec = await fetch(RECORD_URL, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
    const l = rec && rec.ladder && typeof rec.ladder === 'object' ? rec.ladder : null;
    ladder = l ? { main: l.main ?? null, reserve: l.reserve ?? null, since: l.since ?? null } : null;
    if (ladder) {
      const healed = await healLadder(pub, lp.address, ladder);
      if (healed) { console.log(`\nLADDER RECORD — ${healed.why} (read so here; the worker writes it on its next run)`); ladder.main = healed.main; if (healed.closed) ladder.reserve = null; if (healed.adopted) ladder.reserve = healed.reserve; }
    }
    if (ladder && ladder.reserve != null) {
      console.log(`\nLADDER RECORD — main range #${ladder.main}, reserve range #${ladder.reserve}: the two read as one position with a reserve attached`);
    }
  } catch (e) { console.log(`\nLADDER RECORD unreadable (${e.message}) — a wallet that holds a reserve range will read as two positions`); }

  if (STEPS.includes('collect')) {
    console.log(`\nCOLLECT — fees of the position held by ${lp.address} -> BNB -> kept as capital / $BOBAI held`);
    const plan = await planCollect(pub, lp.address, ladder);
    const s = plan.summary;
    if (plan.pos) {
      console.log(`  position #${s.position}  ticks ${s.ticks[0]} … ${s.ticks[1]}  ${s.in_range ? 'in range' : 'OUT OF RANGE'}  liquidity ${s.liquidity}`);
      console.log(`  owed      ${s.owed.wbnb} WBNB and ${s.owed.other} of ${s.owed.other_token}`);
      if (s.leftovers) console.log(`  leftovers ${s.leftovers.wbnb} WBNB and ${s.leftovers.other} of the other token, from an interrupted run`);
      console.log(`  worth     ${f(s.owed.bnb_equivalent)} BNB together${s.quote_off_pct != null ? `, quote ${s.quote_off_pct}% off the pool's price${s.sells_via ? ` (sells via ${s.sells_via})` : ''}` : ''}`);
    }
    console.log(`  wallet    ${f(s.wallet_bnb ?? s.gas_bnb)} BNB (reserve kept: ${GAS_RESERVE_BNB})`);
    if (plan.no) console.log(`  nothing to do: ${plan.no}`);
    else {
      console.log(`  would collect, sell the other side, unwrap, keep ${KEEP}% of what this run produced as capital and buy $BOBAI with the rest, held in this wallet`);
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
    const plan = await planRebalance(pub, lp.address, { record, widthOverride: WIDTH, pool, keptPct: KEEP, ladder });
    const s = plan.summary;
    if (plan.resume) console.log(`  no position — the wallet holds ${s.held?.other} of the other side and ${s.held?.wbnb} WBNB (worth ${f(s.value_bnb)} BNB), tick now ${s.tick}: a re-set that stopped before its mint`);
    else if (plan.pos) console.log(`  position #${s.position} ticks ${s.ticks[0]} … ${s.ticks[1]}, tick now ${s.tick}, ${s.in_range ? 'in range' : 'OUT OF RANGE'}, worth ${f(s.value_bnb)} BNB${s.reserve ? `; reserve #${s.reserve.position} ticks ${s.reserve.ticks[0]} … ${s.reserve.ticks[1]}, worth ${f(s.reserve.value_bnb)} BNB` : ''}`);
    if (plan.no) console.log(`  nothing to do: ${plan.no}`);
    else {
      console.log(`  width ±${s.width_pct}% (${s.width_basis}) -> new ticks ${s.new_ticks[0]} … ${s.new_ticks[1]}`);
      console.log(plan.resume ? `  would ${s.trade}, and mint the range from what the wallet then holds` : `  would withdraw and burn #${s.position}, ${s.trade}, and mint the new range from what the wallet then holds`);
      if (!plan.resume) console.log(`  the old range owes ${f(s.fees_owed_bnb)} BNB of fees: ${s.fees_to_bobai_bnb > 0 ? `${f(s.fees_to_bobai_bnb)} BNB would buy BOBAI (held in the wallet) before the mint, the rest into the new capital` : 'all of it would be minted into the new capital'} (kept share ${s.fees_kept_pct ?? KEEP}%)`);
      if (CONFIRM) {
        const out = await executeRebalance(pub, lpWallet(), lp, plan, log, { keptPct: KEEP });
        console.log(`  new position #${out.new_position} at ${out.new_ticks[0]} … ${out.new_ticks[1]}, liquidity ${out.liquidity_after}`);
        if (ladder && ladder.reserve != null) { ladder.main = out.new_position; console.log('  the ladder record on KV still names the old main range; the worker heals it on its next run (ladderHeal)'); }
        if (out.fees_folded_bnb != null) console.log(`  old range's fees ${f(out.fees_folded_bnb)} BNB: ${out.bobai_bnb > 0 ? `${f(out.bobai_bnb)} BNB bought ${out.bobai_units} BOBAI, held in ${out.bobai_held_in}` : out.fees_forward_why}`);
        acted += 1;
      }
    }
  }

  if (STEPS.includes('relocate')) {
    console.log('\nRELOCATE — the whole position -> another pool of the universe');
    if (!TO) console.log('  name the pool with --to 0x… (the pool record at https://agent.brainonbnb.com/lp/pools says which one is worth it)');
    const plan = await planRelocate(pub, lp.address, { toPool: TO, widthOverride: WIDTH, keptPct: KEEP });
    const s = plan.summary;
    if (plan.pos) console.log(`  position #${s.position} in ${s.from_pool}, ticks ${s.from_ticks[0]} … ${s.from_ticks[1]}, ${s.in_range ? 'in range' : 'OUT OF RANGE'}, worth ${f(s.value_bnb)} BNB`);
    if (plan.to) console.log(`  to ${s.to_pool} (fee ${s.to_fee_pct}%), tick there ${s.to_tick}`);
    if (plan.no) console.log(`  nothing to do: ${plan.no}`);
    else {
      console.log(`  width ±${s.width_pct}% (${s.width_basis}) -> new ticks ${s.new_ticks[0]} … ${s.new_ticks[1]}`);
      console.log(`  would withdraw and burn #${s.position}, ${(s.trades || ['trade nothing']).join(', ')}, and mint the range in the new pool from what the wallet then holds`);
      console.log(`  the old range owes ${f(s.fees_owed_bnb)} BNB of fees: ${s.fees_to_bobai_bnb > 0 ? `${f(s.fees_to_bobai_bnb)} BNB would buy BOBAI (held in the wallet) before the mint, the rest into the new capital` : 'all of it would be minted into the new capital'} (kept share ${s.fees_kept_pct ?? KEEP}%)`);
      if (CONFIRM) {
        const out = await executeRelocate(pub, lpWallet(), lp, plan, log, { keptPct: KEEP });
        console.log(`  new position #${out.new_position} in ${out.new_pool} at ${out.new_ticks[0]} … ${out.new_ticks[1]}, liquidity ${out.liquidity_after}; gas ${f(out.gas_bnb)} BNB, swap fees ${f(out.swap_fee_bnb)} BNB`);
        console.log(`  old range's fees ${f(out.fees_folded_bnb)} BNB: ${out.bobai_bnb > 0 ? `${f(out.bobai_bnb)} BNB bought ${out.bobai_units} BOBAI, held in ${out.bobai_held_in}` : out.fees_forward_why}`);
        acted += 1;
      }
    }
  }

  if (STEPS.includes('ladder')) {
    console.log('\nLADDER — BNB beside a main range that is all of the other side -> a reserve range below the price');
    let record = null;
    try { record = (await fetch(WINDOWS_URL, { signal: AbortSignal.timeout(20000) }).then((r) => r.json())).verdict || null; } catch { record = null; }
    const plan = await planLadder(pub, lp.address, { record, ladder });
    const s = plan.summary;
    if (s.position) console.log(`  main #${s.position} ${s.main_ticks ? `ticks ${s.main_ticks[0]} … ${s.main_ticks[1]}` : ''} holds ${s.main_side === 'both' ? 'both sides (in range)' : s.main_side === 'wbnb' ? 'only WBNB' : 'only the other side'}${s.reserve ? `; reserve #${s.reserve.position} ticks ${s.reserve.ticks[0]} … ${s.reserve.ticks[1]}, ${f(s.reserve.value_bnb)} BNB${s.reserve.left ? ', left by the price' : ''}` : '; no reserve'}; ${f(s.spendable_bnb)} BNB waits`);
    console.log(plan.act ? `  the worker would: ${plan.act} — ${plan.why}${plan.no ? ` — ${plan.no}` : ''}` : `  nothing to do: ${plan.why}${plan.no ? ` — ${plan.no}` : ''}`);
    // Planned here, run by the worker alone: a reserve minted or re-set by
    // hand would be a position the KV record does not name, and the worker
    // would refuse every step until a person wrote the record.
    if (plan.act && CONFIRM) console.log('  not sent from here: the ladder is the worker\'s step, because it must write the ladder record with it');
  }

  if (STEPS.includes('increase')) {
    console.log('\nINCREASE — BNB above the reserve -> the same position');
    const plan = await planIncrease(pub, lp.address, null, ladder);
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
