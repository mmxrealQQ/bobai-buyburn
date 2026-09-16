#!/usr/bin/env node
// THE PORTFOLIO, from the keyboard.
//
//   node scripts/lp-portfolio.mjs               the live model, as the page and the bot see it
//   node scripts/lp-portfolio.mjs --self-test   pin the model's rules on synthetic records, both ways
//
// It reads. It signs nothing, holds no key and moves nothing.
import { lpPortfolio, lastDay, stepWords, holdingBenchmark } from '../worker-agent/lp-portfolio.js';
import { CANDIDATES } from '../worker-agent/lp-pools.js';

if (process.argv.includes('--self-test')) {
  let n = 0, bad = 0;
  const is = (what, cond) => { n++; if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}`); };
  const NOW = Date.UTC(2026, 8, 10, 12);
  const at = (h) => new Date(NOW - h * 3600e3).toISOString();
  const rec = {
    pool: CANDIDATES[0].pool,
    last: { at: at(8), ok: true, acted: true, steps: { sweep: [{ acted: false }], collect: { acted: false }, increase: { acted: true, position: '7397034', in_range: true, wallet_bnb: 0.003, bnb_spent: 0.08 } } },
    last_check: { at: at(1), ok: true, acted: false, steps: { increase: { acted: false, position: '7397034', in_range: false, wallet_bnb: 0.3056 } } },
    history: [
      { at: at(30), acted: true, steps: { rebalance: { acted: true, new_position: '7390000' } } },
      { at: at(8), acted: true, steps: { increase: { acted: true, bnb_spent: 0.08 } } },
      { at: at(3), acted: true, steps: { rebalance: { acted: true, new_position: '7397034', bobai_bnb: 0.0003, width_pct: 1 } } },
    ],
  };
  const series = {
    summary: {
      since: '2026-09-03T05:23:19.275Z', runs_with_a_position: 21, days_in_range: 17,
      value_bnb: { start: 0.072, now: 0.2925, added_by_hand_bnb: 0.0794, change_pct: 1.31, capital_total_bnb: 0.2872 },
      deposits_put_in_bnb: 0.1358, income_put_in_bnb: 0, fees_owed_now_bnb: 0.00087, bobai_held_units: 3895.4, fees_into_bobai_bnb: 0.001093, fees_kept_as_capital_bnb: 0.002866,
      profit: { bnb: 0.003762, usd: 2.72, from_price_bnb: -0.000422, from_fees_bnb: 0.004829, fees_collected_bnb: 0, fees_folded_bnb: 0.002866, fees_forwarded_at_resets_bnb: 0.001093, fees_owed_bnb: 0.00087, gas_bnb: 0.000645, bnb_usd: 722 },
    },
    points: [{ at: at(8), position: '7397034', in_range: true, wallet_bnb: 0.003 }],
  };
  const m = lpPortfolio(rec, series, { now: NOW, bobaiUsd: 0.0002 });
  is('a model comes out of three records', !!m && m.date === at(8).slice(0, 10));
  is('put in is the series capital total, with its sources', m.put_in.bnb === 0.2872 && m.put_in.sources.map((s) => s.label).join(',') === 'start,by hand,deposited');
  is('dollars at the series BNB price', m.put_in.usd === Math.round(0.2872 * 722 * 100) / 100 && m.worth.usd === Math.round(0.2925 * 722 * 100) / 100);
  is('the range is the newest check, not the series point', m.pool.in_range === false && m.holdings.wallet_bnb === 0.3056);
  is('the pool is the record\'s own, labelled from the pool list', m.pool.address === CANDIDATES[0].pool && m.pool.label === 'CAKE/BNB 0.05%' && m.pool.position === '7397034');
  is('P&L carries the split and the fee parts', m.pnl.profit_bnb === 0.00376 && m.pnl.from_price_bnb === -0.00042 && m.pnl.fee_parts.length === 3 && m.pnl.gas_bnb === 0.00065);
  is('the other token is read off the pool label', m.pnl.other_token === 'CAKE');
  is('the held $BOBAI is priced when the route has a price, and not otherwise', m.holdings.bobai_usd === 0.78 && lpPortfolio(rec, series, { now: NOW }).holdings.bobai_usd === null);
  is('the two halves of the profit are named: kept working, into $BOBAI', m.pnl.kept_working_bnb === 0.00287 && m.pnl.into_bobai_bnb === 0.00109 && m.pnl.bobai_units === 3895);
  is('the model carries no pool record: the agent stays in CAKE/BNB (2026-09-11)', !('pool_record' in m) && !m.links.pools);
  // The one sentence about what comes next, both ways: in range, out of range, with and without a width the record names.
  const w2 = { width_pct: 2, wait_hours: 3, net_usd_per_day: 0.16 };
  is('out of range with a width named: the sentence says when the re-set comes, how wide, and that it trades nothing', /^Out of range for 2\.0 h\. Re-set after 3 h out of range: one-sided beside the price, ±2% wide, no trade\.$/.test(lpPortfolio(rec, series, { now: NOW, width: w2, outsideSince: new Date(NOW - 2 * 36e5).toISOString() }).next));
  is('out of range with no width named yet: the re-set waits for the record', /^Out of range\. Re-set after the wait; the width record has no day of prices yet\.$/.test(m.next) && m.pool.width_pct === 1);
  is('at the edge of the range: not left, says so', (() => { const r3 = { ...rec, last_check: { ...rec.last_check, steps: { increase: { ...rec.last_check.steps.increase, at_edge: true } } } }; return /^At the edge of its range, not left\./.test(lpPortfolio(r3, series, { now: NOW }).next); })());
  is('in range with a width named: holds and earns, re-set only after the wait', (() => { const r2 = { ...rec, last_check: { ...rec.last_check, steps: { increase: { ...rec.last_check.steps.increase, in_range: true } } } }; return /^Holds and earns\. A re-set only after 3 h out of range: one-sided beside the price, ±2% wide, no trade\.$/.test(lpPortfolio(r2, series, { now: NOW, width: w2 }).next); })());
  is('the sentence carries no dollar figure (2026-09-12: the card stays simple; what a width nets lives in /lp/windows)', !/\$/.test(lpPortfolio(rec, series, { now: NOW, width: w2, outsideSince: new Date(NOW - 2 * 36e5).toISOString() }).next));
  is('the P&L names what the re-sets themselves cost', m.pnl.at_resets && m.pnl.at_resets.count === 0 && m.pnl.at_resets.lost_to_price_bnb === 0);
  is('the day is counted: re-sets, top-ups and the newest action', m.day.resets === 1 && m.day.top_ups === 1 && m.day.errors === 0 && m.day.last.step === undefined && /re-set/.test(m.day.last.what));
  is('the last day lists the runs of the last 24 h only, newest first', m.last_24h.length === 2 && m.last_24h[0].step === 'rebalance' && m.last_24h[1].step === 'increase' && /7397034/.test(m.last_24h[0].what));
  is('a re-set that bought BOBAI says so', /into \$BOBAI/.test(m.last_24h[0].what));
  is('a quiet day has an empty list', lastDay({ history: [{ at: at(40), acted: true, steps: { increase: { acted: true } } }] }, NOW).length === 0);
  is('a failed step is listed as an error', stepWords('collect', { acted: true, error: 'boom' }).error === true);
  is('a step that did not act is not listed', stepWords('increase', { acted: false }) === null);
  is('a relocate names the pool it moved to', /USDT\/BNB 0\.01%/.test(stepWords('relocate', { acted: true, new_pool: CANDIDATES[2].pool, new_position: '9' }).what));
  is('a width upgrade names both widths', /±2% → ±1%/.test(stepWords('rebalance', { acted: true, upgraded_from_pct: 2, upgraded_to_pct: 1 }).what));
  is('a one-sided re-set says which side and that it traded nothing', /one-sided above the price, no trade/.test(stepWords('rebalance', { acted: true, one_sided: 'above_price', new_position: '7' }).what));
  // AGAINST HOLDING: two arrivals, a price that rose 10% since the first.
  // 1 BNB arrived at price 1 (tick 0), 1 BNB at price 1.1 (tick ln(1.1)/ln(1.0001)); now the price is 1.1.
  const tk = (px) => Math.round(Math.log(px) / Math.log(1.0001));
  const pts = [{ at: at(50), tick: tk(1), capital_bnb: 1 }, { at: at(40), tick: tk(1.05), capital_bnb: 1 }, { at: at(20), tick: tk(1.1), capital_bnb: 2 }];
  const hb = holdingBenchmark(pts, { valueNow: 2.1, tickNow: tk(1.1), bobaiBnb: 0.01, owedBnb: 0.002, gasBnb: 0.001 });
  is('two arrivals are found (a point with the same capital is not one)', hb && hb.arrivals === 2);
  is('holding: the first BNB half in the risen side is worth 1.05, the second 1.00 — 2.05', hb && Math.abs(hb.holding_bnb - 2.05) < 1e-4);
  is('the position side counts what it produced and what it paid', hb && Math.abs(hb.lp_bnb - (2.1 + 0.01 + 0.002 - 0.001)) < 1e-9);
  is('vs holding is the difference, in BNB and in percent of the capital', hb && Math.abs(hb.vs_holding_bnb - (2.111 - 2.05)) < 1e-4 && Math.abs(hb.vs_holding_pct - 3.05) < 0.01);
  is('the other way round (WBNB as token0) reads the price inverted', Math.abs(holdingBenchmark(pts, { valueNow: 2.1, tickNow: tk(1.1), wbnbIs0: true }).holding_bnb - (1 * (0.5 + 0.5 * (1 / 1.1) / 1) + 1 * (0.5 + 0.5 * (1 / 1.1) / (1 / 1.1)))) < 1e-4);
  is('no ticks, no value or no capital: no line', holdingBenchmark([], { valueNow: 1, tickNow: 0 }) === null && holdingBenchmark(pts, { valueNow: 0, tickNow: 0 }) === null && holdingBenchmark(pts, { valueNow: 1, tickNow: null }) === null);
  is('the model carries the line under pnl when the series has ticks', (() => { const s2 = { ...series, points: [{ at: at(8), position: '7397034', in_range: true, wallet_bnb: 0.003, tick: -57800, capital_bnb: 0.2872 }] }; const r2 = { ...rec, last_check: { ...rec.last_check, steps: { increase: { ...rec.last_check.steps.increase, tick: -57800 } } } }; const x = lpPortfolio(r2, s2, { now: NOW }); return x.pnl.vs_holding && x.pnl.vs_holding.holding_bnb > 0 && typeof x.pnl.vs_holding.vs_holding_bnb === 'number'; })());
  is('… and null when it has none', m.pnl.vs_holding === null);
  is('without a series there is no model', lpPortfolio(rec, null) === null);
  console.log(`\n${n - bad}/${n} checks behave in both directions`);
  process.exitCode = bad ? 1 : 0;
} else {
  const r = await fetch('https://agent.brainonbnb.com/lp/portfolio', { headers: { accept: 'application/json' } });
  const j = await r.json();
  console.log(JSON.stringify(j, null, 2));
}
