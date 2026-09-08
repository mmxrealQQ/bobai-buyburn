#!/usr/bin/env node
// THE POOL RECORD, from the keyboard.
//
// The agent worker records, every hour, what fifty dollars would have earned
// in each pool the operator named (worker-agent/lp-pools.js). This reads that
// record and pins the verdict's rules, so the number a person reads and the
// number the page shows come from the one function.
//
//   node scripts/lp-pools.mjs               what the record says now (live)
//   node scripts/lp-pools.mjs --width 2     at another width
//   node scripts/lp-pools.mjs --self-test   pin the rules, both ways, no network
//
// It reads. It signs nothing, holds no key and moves nothing.

import { poolVerdict, appendPoolWindow, CANDIDATES, MIN_HOURS_TO_PICK } from '../worker-agent/lp-pools.js';

const argOf = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SELF = process.argv.includes('--self-test');

if (SELF) {
  let n = 0, bad = 0;
  const is = (what, cond) => { n++; if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}`); };
  const win = (i, fees, swaps = 10, minutes = 60) => ({
    at: new Date(Date.UTC(2026, 8, 8, i)).toISOString(), from_block: 100 + i * 10, to_block: 109 + i * 10, minutes, swaps, price: 1,
    pool_fees_usd: 1, rows: [{ width: 1, fees, held: true }, { width: 2, fees: fees / 2, held: true }],
  });
  const A = CANDIDATES[0].pool, B = CANDIDATES[1].pool;
  let log = { usd: 50, pools: {} };
  for (let i = 0; i < 12; i++) { log = appendPoolWindow(log, A, win(i, 0.02)).log; log = appendPoolWindow(log, B, win(i, 0.04)).log; }

  const thin = poolVerdict(log, 1, { watched: A });
  is('twelve hours each: reported, nothing picked', thin.pick === null && thin.pools.length === 2 && /no pick until/.test(thin.why));
  is('the hours are the windows\' own minutes, not their count', thin.pools.every((p) => p.hours === 12));
  is('fees per day scale from the recorded hours', thin.pools.find((p) => p.pool === B).fees_usd_per_day === 0.96);
  is('the watched pool is marked', thin.pools.find((p) => p.pool === A).watched === true && thin.watched.pool === A);

  for (let i = 12; i < 26; i++) { log = appendPoolWindow(log, A, win(i, 0.02)).log; log = appendPoolWindow(log, B, win(i, 0.04)).log; }
  const full = poolVerdict(log, 1, { watched: A });
  is(`a day each (${MIN_HOURS_TO_PICK} h): the pool with more fees per day is picked`, full.pick && full.pick.pool === B);
  is('the verdict says it is a finding, not a move', /never changes pools by itself/.test(full.why));
  is('the same record at the other width picks by that width', poolVerdict(log, 2, { watched: A }).pick.pool === B);
  is('a width the record does not hold picks nothing', poolVerdict(log, 5, { watched: A }).pick === null);

  const same = { usd: 50, pools: {} };
  let l2 = same;
  for (let i = 0; i < 26; i++) { l2 = appendPoolWindow(l2, A, win(i, 0.05)).log; l2 = appendPoolWindow(l2, B, win(i, 0.01)).log; }
  const home = poolVerdict(l2, 1, { watched: A });
  is('when the watched pool leads, the verdict says so and names no move', home.pick.pool === A && /the pool the agent is in/.test(home.why));

  const dup = appendPoolWindow(log, A, win(3, 0.02));
  is('the same chain slice is not appended twice', dup.added === false);
  const quietLog = appendPoolWindow({ usd: 50, pools: {} }, B, win(0, 0, 0)).log;
  is('a window nobody swapped in is counted as quiet', poolVerdict(quietLog, 1).pools[0].quiet_windows === 1);
  const unknown = appendPoolWindow({ usd: 50, pools: {} }, '0x' + '1'.repeat(40), win(0, 0.01)).log;
  is('a pool outside the candidates keeps its address as its label', poolVerdict(unknown, 1).pools[0].label.startsWith('0x'));

  console.log(`\n${n - bad}/${n} checks behave in both directions`);
  process.exit(bad ? 1 : 0);
}

const width = argOf('--width');
const url = 'https://agent.brainonbnb.com/lp/pools?format=json' + (width ? `&width=${encodeURIComponent(width)}` : '');
const r = await fetch(url, { headers: { accept: 'application/json' } });
const j = await r.json();
if (!r.ok) { console.log(`${r.status}: ${j.error || 'no answer'}`); process.exit(0); }
console.log(`Pool record — $${j.usd} in ±${j.width_pct}%, since ${String(j.since || '').slice(0, 16).replace('T', ' ')} UTC`);
for (const p of j.pools) {
  console.log(`  ${p.watched ? '▶' : ' '} ${p.label.padEnd(16)} ${String(p.hours).padStart(6)} h  ${p.fees_usd_per_day == null ? '   —  ' : ('$' + p.fees_usd_per_day.toFixed(4)).padStart(8)}/day  swaps ${String(p.swaps).padStart(5)}  quiet ${p.quiet_windows}/${p.windows}`);
}
console.log(`\n${j.why}`);
if (j.last_error) console.log(`last error: ${j.last_error.at} ${j.last_error.message}`);
