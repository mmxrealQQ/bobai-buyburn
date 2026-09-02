#!/usr/bin/env node
// ONE WINDOW IS NOT EVIDENCE. This collects several.
//
// lp-plan.mjs picks a range from a single replay, and that replay covers about
// thirty-seven minutes — as much live chain as the log endpoint will serve near
// the head. On that one sample a very narrow range looks best, because in
// thirty-seven quiet minutes it never had to be nursed. Over a day it will be,
// and each re-entry costs roughly a percent of a fifty-dollar position.
//
// So this records windows instead of arguing about one. Run it whenever, as
// often as you like; each run appends what every candidate width did in that
// window. Since 2026-09-02 the agent worker records one every hour on its own
// (worker-agent/lp-windows.js), and `--sync` pulls those into the local file,
// so the record grows while nobody is at a keyboard. `--report` then answers
// the question that actually matters for a position nobody is watching: across
// everything recorded so far, how often did each width hold, and what did it
// collect once the nursing was paid for.
//
// It reads. It signs nothing, holds no key and moves nothing.
//
// WHY THE RECORD IS APPEND-ONLY AND KEEPS THE BLOCK NUMBERS
// Two runs a minute apart cover almost the same chain and would count as two
// independent observations while being one. Every entry carries its block
// range, and the verdict refuses to count two windows that overlap, so the
// answer cannot be inflated by running this in a loop. The verdict itself is
// ONE function, imported from the worker module, so what this prints and what
// lp-decision.mjs sizes the mint on cannot be two different readings.
//
// Usage:
//   node scripts/lp-windows.mjs                 record one window
//   node scripts/lp-windows.mjs --sync          merge the worker's hourly record in
//   node scripts/lp-windows.mjs --report        what the record says so far
//   node scripts/lp-windows.mjs --usd 50        size the replay differently
//   node scripts/lp-windows.mjs --self-test     pin the verdict's rules, both ways
import fs from 'node:fs';
import path from 'node:path';
import { verdict, appendWindow, mergeLogs, windowFromPlan, MAX_WINDOWS } from '../worker-agent/lp-windows.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const LOG = path.join(ROOT, 'data', 'lp-windows.json');
const REMOTE = 'https://agent.brainonbnb.com/lp/windows';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  const v = i >= 0 ? process.argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : d;
};
const USD = Number(arg('--usd', 50)) || 50;
const REPORT = process.argv.includes('--report');
const SYNC = process.argv.includes('--sync');
const SELF_TEST = process.argv.includes('--self-test');
// The pool the planner chose. Passed explicitly so a record is always about one
// pool: mixing two pools into one history would average away the thing being
// measured.
const POOL = arg('--pool', '0xafb2da14056725e3ba3a30dd846b6bbbd7886c56');

const read = () => {
  try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); }
  catch { return { pool: POOL, usd: USD, windows: [] }; }
};
const write = (log) => {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
};

// --- self-test: the rules, pinned in both directions --------------------------
if (SELF_TEST) {
  let n = 0; const bad = [];
  const t = (name, cond) => { n++; if (!cond) bad.push(name); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); };
  const row = (width, held, net, crossings = held ? 0 : 1) => ({ width, held, in_range_pct: held ? 100 : 80, crossings, fees: Math.abs(net), net });
  const win = (from, to, rows) => ({ at: new Date(from * 1000).toISOString(), from_block: from, to_block: to, minutes: 37, swaps: 100, pool_fees_usd: 1, rebalance_cost_usd: 0.48, rows });
  const good = [row(0.5, true, 0.09), row(1, true, 0.04), row('full', true, 0.0002)];

  // Thin: one window decides nothing, however good it looks.
  let v = verdict({ windows: [win(100, 200, good)] });
  t('one window is thin and picks nothing', v.thin && v.pick === null && v.windows === 1);
  // Two non-overlapping windows decide.
  v = verdict({ windows: [win(100, 200, good), win(300, 400, good)] });
  t('two clean windows pick the best net width', !v.thin && v.pick?.width === 0.5);
  // Overlap counts once — and therefore stays thin.
  v = verdict({ windows: [win(100, 200, good), win(150, 250, good)] });
  t('overlapping windows count once', v.windows === 1 && v.overlapping_runs_not_counted === 1 && v.thin);
  // Ever negative disqualifies even with a positive sum.
  v = verdict({ windows: [win(100, 200, [row(0.25, false, -2.7, 6), row(1, true, 0.04)]), win(300, 400, [row(0.25, true, 5), row(1, true, 0.04)])] });
  t('a width that was ever negative is not picked despite a positive total', v.pick?.width === 1);
  t('… and the record says so', v.rows.find((r) => r.width === 0.25)?.everNegative === true);
  // Ever failed to hold disqualifies even when net stayed positive.
  v = verdict({ windows: [win(100, 200, [row(0.5, false, 0.01, 1), row(2, true, 0.02)]), win(300, 400, [row(0.5, true, 0.2), row(2, true, 0.02)])] });
  t('a width that once failed to hold is not picked', v.pick?.width === 2);
  // Full range is never the pick.
  v = verdict({ windows: [win(100, 200, [row(0.5, false, -1, 3), row('full', true, 0.001)]), win(300, 400, [row(0.5, false, -1, 3), row('full', true, 0.001)])] });
  t('full range is reported but never picked', v.pick === null && v.rows.some((r) => r.width === 'full'));
  // The positive direction of the same rule: nothing safe -> null, not "least bad".
  t('no safe width means no pick, not the least bad one', v.pick === null);
  // Empty log.
  v = verdict({ windows: [] });
  t('an empty record is thin with no rows', v.thin && v.rows.length === 0 && v.pick === null);

  // appendWindow: duplicates by chain slice are not appended; the cap holds.
  let log = { pool: 'x', usd: 50, windows: [] };
  let r = appendWindow(log, win(100, 200, good)); log = r.log;
  t('first window is appended', r.added && log.windows.length === 1);
  r = appendWindow(log, win(100, 200, good));
  t('the same chain slice is not appended twice', !r.added && r.log.windows.length === 1);
  r = appendWindow(log, win(300, 400, good));
  t('a different slice is appended', r.added && r.log.windows.length === 2);
  let big = { pool: 'x', usd: 50, windows: [] };
  for (let i = 0; i < MAX_WINDOWS + 5; i++) big = appendWindow(big, win(i * 1000, i * 1000 + 500, good)).log;
  t(`the record is capped at ${MAX_WINDOWS} and keeps the newest`, big.windows.length === MAX_WINDOWS && big.windows[0].from_block === 5000);

  // mergeLogs: union by slice, sorted, refuses across pools.
  const a = { pool: '0xAAA', usd: 50, windows: [win(300, 400, good), win(100, 200, good)] };
  const b = { pool: '0xaaa', usd: 50, windows: [win(100, 200, good), win(500, 600, good)] };
  const m = mergeLogs(a, b);
  t('merge unions by chain slice and sorts', m.windows.length === 3 && m.windows[0].from_block === 100 && m.windows[2].from_block === 500);
  let threw = false;
  try { mergeLogs(a, { pool: '0xbbb', usd: 50, windows: [] }); } catch { threw = true; }
  t('merge refuses two different pools', threw);
  t('merge accepts a record that names no pool yet', mergeLogs({ usd: 50, windows: [] }, b).pool === '0xaaa');

  // windowFromPlan: the held rule, both ways.
  const plan = (share, crossed) => ({
    measured_window: { from_block: 1, to_block: 2, minutes: 37, swaps: 1, fees_the_pool_paid_usd: 1 },
    rebalance_cost_usd_assumed: 0.48,
    ranges: [{ width_pct: 1, share_of_window_in_range_pct: share, times_it_crossed_the_edge: crossed, fees_usd_in_window: 0.1, net_after_rebalancing_usd_in_window: 0.1 }],
  });
  t('100% in range with 0 crossings is held', windowFromPlan(plan(100, 0), 50).rows[0].held === true);
  t('100% in range but one crossing is NOT held', windowFromPlan(plan(100, 1), 50).rows[0].held === false);
  t('99% in range is NOT held', windowFromPlan(plan(99, 0), 50).rows[0].held === false);

  console.log(`\n${n - bad.length} of ${n} checks passed`);
  if (bad.length) { bad.forEach((b) => console.log(`  - ${b}`)); process.exitCode = 1; }
} else if (SYNC) {
  // --- sync: the worker's hourly record into the local file --------------------
  const r = await fetch(REMOTE, { signal: AbortSignal.timeout(20000) });
  const body = await r.text();
  if (/^\s*</.test(body)) { console.error('the worker answered with a page, not a record — is /lp/windows routed?'); process.exitCode = 1; }
  else {
    const remote = JSON.parse(body);
    if (remote.error) console.log(`worker: ${remote.error}. Nothing to merge yet.`);
    else {
      const local = read();
      const before = local.windows.length;
      let merged;
      try { merged = mergeLogs(local, { pool: remote.pool, usd: remote.usd, windows: remote.windows }); }
      catch (e) { console.error(e.message); process.exitCode = 1; }
      if (merged) {
        write(merged);
        console.log(`merged ${remote.windows.length} worker window(s) into ${before} local → ${merged.windows.length} total (${merged.windows.length - before} new)`);
        const v = verdict(merged);
        console.log(`  ${v.windows} non-overlapping · ${v.thin ? 'still thin' : v.pick ? `pick ±${v.pick.width}%` : 'no width qualifies'}`);
        console.log('  → node scripts/lp-windows.mjs --report');
      }
    }
  }
} else if (REPORT) {
  // --- report ------------------------------------------------------------------
  const log = read();
  if (!log.windows.length) {
    console.log('Nothing recorded yet. Run --sync, or run this without flags a few times across the day.');
  } else {
    const v = verdict(log);
    console.log(`\nWhat ${v.windows} non-overlapping window${v.windows === 1 ? '' : 's'} say about ${log.pool}`);
    if (v.overlapping_runs_not_counted) console.log(`  (${v.overlapping_runs_not_counted} further run${v.overlapping_runs_not_counted === 1 ? '' : 's'} overlapped an earlier window and are not counted twice)`);
    console.log(`  recorded ${v.from.slice(0, 16).replace('T', ' ')} → ${v.to.slice(0, 16).replace('T', ' ')}, blocks ${v.from_block}–${v.to_block}`);
    console.log(`  position size in every replay: $${log.usd}\n`);
    console.log('width      held all window   crossings   collected      net of nursing');
    for (const s of v.rows) {
      console.log(
        (s.width === 'full' ? 'full' : '±' + s.width + '%').padEnd(10),
        `${s.held}/${s.of}`.padStart(13),
        String(s.crossings).padStart(12),
        ('$' + s.fees.toFixed(6)).padStart(14),
        ('$' + s.net.toFixed(6)).padStart(20),
        s.everNegative ? '  ← went negative once; out' : (!s.heldEvery && s.width !== 'full' ? '  ← did not hold once; out' : ''),
      );
    }
    console.log('');
    // THE ANSWER, and it is deliberately not "whichever collected most".
    // A width that has to be put back is a width somebody has to be awake for,
    // and nothing here does that automatically yet.
    if (v.thin) console.log('  One window decides nothing. Two non-overlapping ones are needed before the record decides.');
    else if (v.pick) console.log(`  The record's pick: ±${v.pick.width}% — held in all ${v.pick.of}, never negative, $${v.pick.net.toFixed(6)} net.`);
    else console.log('  No width held in every window without going negative. For a position nobody is watching, that is the finding.');
    if (v.windows < 5) {
      console.log(`\n  ${v.windows} window${v.windows === 1 ? '' : 's'} is still thin. Thirty-seven minutes of a quiet afternoon is not a day, and`);
      console.log('  the widths that look best here are the ones that have not yet been tested by a move.');
    }
  }
} else {
  // --- record one window, by hand ------------------------------------------------
  const { loadTools } = await import('./lib/lp-decision.mjs');
  const T = await loadTools();
  let plan;
  try { plan = await T.rangePlan(POOL, { capitalUsd: USD }); }
  catch (e) { console.error(`could not replay: ${e.headline || e.message}`); T.cleanup(); process.exitCode = 1; plan = null; }
  if (plan) {
    const log = read();
    const { log: next, added } = appendWindow({ ...log, pool: plan.pool, usd: USD }, windowFromPlan(plan, USD));
    write(next);
    const held = plan.narrowest_range_that_held_the_whole_window;
    console.log(`${added ? 'recorded' : 'already had'} window ${next.windows.length}: blocks ${plan.measured_window.from_block}–${plan.measured_window.to_block}, `
      + `${plan.measured_window.swaps} swaps over ${plan.measured_window.minutes} min`);
    console.log(`  narrowest that held: ${held || 'none'} · best net: ${plan.best_range_after_paying_to_put_it_back}`);
    console.log(`  → node scripts/lp-windows.mjs --report`);
    T.cleanup();
  }
}
// No process.exit() after a chain read: on Windows that trips a libuv assertion
// and turns a clean run into exit code 127. exitCode is set where it matters.
