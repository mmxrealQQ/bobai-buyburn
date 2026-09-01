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
// window. `--report` then answers the question that actually matters for a
// position nobody is watching: across everything recorded so far, how often did
// each width hold, and what did it collect once the nursing was paid for.
//
// It reads. It signs nothing, holds no key and moves nothing.
//
// WHY THE RECORD IS APPEND-ONLY AND KEEPS THE BLOCK NUMBERS
// Two runs a minute apart cover almost the same chain and would count as two
// independent observations while being one. Every entry carries its block
// range, and --report refuses to count two windows that overlap, so the answer
// cannot be inflated by running this in a loop.
//
// Usage:
//   node scripts/lp-windows.mjs                 record one window
//   node scripts/lp-windows.mjs --report        what the record says so far
//   node scripts/lp-windows.mjs --usd 50        size the replay differently
import fs from 'node:fs';
import path from 'node:path';
import { loadTools } from './lib/lp-decision.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const LOG = path.join(ROOT, 'data', 'lp-windows.json');

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  const v = i >= 0 ? process.argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : d;
};
const USD = Number(arg('--usd', 50)) || 50;
const REPORT = process.argv.includes('--report');
// The pool the planner chose. Passed explicitly so a record is always about one
// pool: mixing two pools into one history would average away the thing being
// measured.
const POOL = arg('--pool', '0xafb2da14056725e3ba3a30dd846b6bbbd7886c56');

const read = () => {
  try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); }
  catch { return { pool: POOL, usd: USD, windows: [] }; }
};

if (REPORT) {
  const log = read();
  if (!log.windows.length) {
    console.log('Nothing recorded yet. Run it without --report a few times across the day.');
    process.exit(0);
  }
  // Overlapping windows are one observation, not two. Kept in the file — the
  // record is what happened — and skipped in the count.
  const sorted = log.windows.slice().sort((a, b) => a.from_block - b.from_block);
  const used = [];
  for (const w of sorted) {
    const last = used[used.length - 1];
    if (!last || w.from_block > last.to_block) used.push(w);
  }
  const skipped = sorted.length - used.length;

  const widths = [...new Set(used.flatMap((w) => w.rows.map((r) => r.width)))]
    .sort((a, b) => (a === 'full' ? 1e9 : a) - (b === 'full' ? 1e9 : b));

  console.log(`\nWhat ${used.length} non-overlapping window${used.length === 1 ? '' : 's'} say about ${log.pool}`);
  if (skipped) console.log(`  (${skipped} further run${skipped === 1 ? '' : 's'} overlapped an earlier window and are not counted twice)`);
  const first = used[0], last = used[used.length - 1];
  console.log(`  recorded ${first.at.slice(0, 16).replace('T', ' ')} → ${last.at.slice(0, 16).replace('T', ' ')}, blocks ${first.from_block}–${last.to_block}`);
  console.log(`  position size in every replay: $${log.usd}\n`);

  console.log('width      held all window   crossings   collected      net of nursing');
  const summary = [];
  for (const w of widths) {
    const rows = used.map((x) => x.rows.find((r) => r.width === w)).filter(Boolean);
    if (!rows.length) continue;
    const held = rows.filter((r) => r.held).length;
    const crossings = rows.reduce((s, r) => s + r.crossings, 0);
    const fees = rows.reduce((s, r) => s + r.fees, 0);
    const net = rows.reduce((s, r) => s + r.net, 0);
    summary.push({ w, held, of: rows.length, crossings, fees, net });
    console.log(
      (w === 'full' ? 'full' : '±' + w + '%').padEnd(10),
      `${held}/${rows.length}`.padStart(13),
      String(crossings).padStart(12),
      ('$' + fees.toFixed(6)).padStart(14),
      ('$' + net.toFixed(6)).padStart(20),
    );
  }

  // THE ANSWER, and it is deliberately not "whichever collected most".
  // A width that has to be put back is a width somebody has to be awake for,
  // and nothing here does that automatically yet.
  const best = summary.slice().sort((a, b) => b.net - a.net)[0];
  const alwaysHeld = summary.filter((s) => s.held === s.of && s.w !== 'full');
  const narrowestAlways = alwaysHeld.length ? alwaysHeld.sort((a, b) => a.w - b.w)[0] : null;
  console.log('');
  if (best) {
    console.log(`  Best once the nursing is paid for: ${best.w === 'full' ? 'full range' : '±' + best.w + '%'} at $${best.net.toFixed(6)} across ${best.of} window(s).`);
  }
  console.log(narrowestAlways
    ? `  Narrowest width that held in EVERY window: ±${narrowestAlways.w}% — ${narrowestAlways.of} for ${narrowestAlways.of}.`
    : '  No width held in every window. For a position nobody is watching, that is the finding.');
  if (used.length < 5) {
    console.log(`\n  ${used.length} window${used.length === 1 ? '' : 's'} is still thin. Thirty-seven minutes of a quiet afternoon is not a day, and`);
    console.log('  the widths that look best here are the ones that have not yet been tested by a move.');
  }
  process.exit(0);
}

// --- record one window -------------------------------------------------------
const T = await loadTools();
let plan;
try { plan = await T.rangePlan(POOL, { capitalUsd: USD }); }
catch (e) { console.error(`could not replay: ${e.headline || e.message}`); T.cleanup(); process.exit(1); }

const log = read();
log.pool = plan.pool;
log.usd = USD;
log.windows.push({
  at: new Date().toISOString(),
  from_block: plan.measured_window.from_block,
  to_block: plan.measured_window.to_block,
  minutes: plan.measured_window.minutes,
  swaps: plan.measured_window.swaps,
  pool_fees_usd: plan.measured_window.fees_the_pool_paid_usd,
  rebalance_cost_usd: plan.rebalance_cost_usd_assumed,
  rows: plan.ranges.map((r) => ({
    width: r.full_range ? 'full' : r.width_pct,
    // "Held" means in range for the whole window. Not "never seen leaving" —
    // the position is centred on today's price and replayed backwards, so a
    // range can just as easily be arrived in.
    held: r.share_of_window_in_range_pct === 100 && r.times_it_crossed_the_edge === 0,
    in_range_pct: r.share_of_window_in_range_pct,
    crossings: r.times_it_crossed_the_edge,
    fees: r.fees_usd_in_window,
    net: r.net_after_rebalancing_usd_in_window,
  })),
});
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');

const held = plan.narrowest_range_that_held_the_whole_window;
console.log(`recorded window ${log.windows.length}: blocks ${plan.measured_window.from_block}–${plan.measured_window.to_block}, `
  + `${plan.measured_window.swaps} swaps over ${plan.measured_window.minutes} min`);
console.log(`  narrowest that held: ${held || 'none'} · best net: ${plan.best_range_after_paying_to_put_it_back}`);
console.log(`  → node scripts/lp-windows.mjs --report`);
T.cleanup();
