#!/usr/bin/env node
// THE PORTFOLIO, from the keyboard.
//
//   node scripts/lp-portfolio.mjs               the live model, as the page and the bot see it
//   node scripts/lp-portfolio.mjs --self-test   pin the model's rules on synthetic records, both ways
//
// It reads. It signs nothing, holds no key and moves nothing.
import { lpPortfolio, lastDay, stepWords } from '../worker-agent/lp-portfolio.js';
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
      { at: at(3), acted: true, steps: { rebalance: { acted: true, new_position: '7397034', bobai_bnb: 0.0003 } } },
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
  const pools = {
    usd: 50, width_pct: 2,
    pools: [
      { pool: CANDIDATES[2].pool, label: 'USDT/BNB 0.01%', fees_usd_per_day: 1.9, hours: 30, watched: false },
      { pool: CANDIDATES[0].pool, label: 'CAKE/BNB 0.05%', fees_usd_per_day: 1.37, hours: 40, watched: true },
      { pool: CANDIDATES[1].pool, label: 'CAKE/BNB 0.01%', fees_usd_per_day: 1.14, hours: 38, watched: false },
      { pool: CANDIDATES[3].pool, label: 'USDT/BNB 0.05%', fees_usd_per_day: 0.5, hours: 30, watched: false },
      { pool: CANDIDATES[11].pool, label: 'BOB/BNB 0.05%', fees_usd_per_day: 0, hours: 39, watched: false },
    ],
    pick: { pool: CANDIDATES[2].pool, label: 'USDT/BNB 0.01%' }, watched: { pool: CANDIDATES[0].pool, label: 'CAKE/BNB 0.05%' },
    move: { move: true, why: 'USDT/BNB 0.01% earned 39% more', to: { label: 'USDT/BNB 0.01%' } },
  };
  const m = lpPortfolio(rec, series, pools, { now: NOW, bobaiUsd: 0.0002 });
  is('a model comes out of three records', !!m && m.date === at(8).slice(0, 10));
  is('put in is the series capital total, with its sources', m.put_in.bnb === 0.2872 && m.put_in.sources.map((s) => s.label).join(',') === 'start,by hand,deposited');
  is('dollars at the series BNB price', m.put_in.usd === Math.round(0.2872 * 722 * 100) / 100 && m.worth.usd === Math.round(0.2925 * 722 * 100) / 100);
  is('the range is the newest check, not the series point', m.pool.in_range === false && m.holdings.wallet_bnb === 0.3056);
  is('the pool is the record\'s own, labelled from the universe', m.pool.address === CANDIDATES[0].pool && m.pool.label === 'CAKE/BNB 0.05%' && m.pool.position === '7397034');
  is('P&L carries the split and the fee parts', m.pnl.profit_bnb === 0.00376 && m.pnl.from_price_bnb === -0.00042 && m.pnl.fee_parts.length === 3 && m.pnl.gas_bnb === 0.00065);
  is('the other token is read off the pool label', m.pnl.other_token === 'CAKE');
  is('the held $BOBAI is priced when the route has a price, and not otherwise', m.holdings.bobai_usd === 0.78 && lpPortfolio(rec, series, pools, { now: NOW }).holdings.bobai_usd === null);
  is('the two halves of the profit are named: kept working, into $BOBAI', m.pnl.kept_working_bnb === 0.00287 && m.pnl.into_bobai_bnb === 0.00109 && m.pnl.bobai_units === 3895);
  is('the pool record shows the top three and the pool the agent is in', m.pool_record.rows.length === 3 && m.pool_record.rows.some((r) => r.here) && m.pool_record.pools === 5);
  is('the pick and the switch verdict come through', m.pool_record.pick.label === 'USDT/BNB 0.01%' && m.pool_record.pick.here === false && m.pool_record.move.move === true && m.pool_record.move.to === 'USDT/BNB 0.01%');
  is('the last day lists the runs of the last 24 h only, newest first', m.last_24h.length === 2 && m.last_24h[0].step === 'rebalance' && m.last_24h[1].step === 'increase' && /7397034/.test(m.last_24h[0].what));
  is('a re-set that bought BOBAI says so', /into \$BOBAI/.test(m.last_24h[0].what));
  is('a quiet day has an empty list', lastDay({ history: [{ at: at(40), acted: true, steps: { increase: { acted: true } } }] }, NOW).length === 0);
  is('a failed step is listed as an error', stepWords('collect', { acted: true, error: 'boom' }).error === true);
  is('a step that did not act is not listed', stepWords('increase', { acted: false }) === null);
  is('a relocate names the pool it moved to', /USDT\/BNB 0\.01%/.test(stepWords('relocate', { acted: true, new_pool: CANDIDATES[2].pool, new_position: '9' }).what));
  is('a width upgrade names both widths', /±2% → ±1%/.test(stepWords('rebalance', { acted: true, upgraded_from_pct: 2, upgraded_to_pct: 1 }).what));
  is('without a series there is no model', lpPortfolio(rec, null, pools) === null);
  const noPools = lpPortfolio(rec, series, null, { now: NOW });
  is('without the pool record the model still stands, labelled from the record\'s pool', noPools.pool_record === null && noPools.pool.label === 'CAKE/BNB 0.05%');
  const here = lpPortfolio(rec, series, { ...pools, pick: pools.watched, move: { move: false, why: 'the pool the agent is in earns the most' } }, { now: NOW });
  is('when the pick is the pool the agent is in, the model says so', here.pool_record.pick.here === true && here.pool_record.move.move === false);
  console.log(`\n${n - bad}/${n} checks behave in both directions`);
  process.exitCode = bad ? 1 : 0;
} else {
  const r = await fetch('https://agent.brainonbnb.com/lp/portfolio', { headers: { accept: 'application/json' } });
  const j = await r.json();
  console.log(JSON.stringify(j, null, 2));
}
