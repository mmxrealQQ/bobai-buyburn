#!/usr/bin/env node
// ONE WINDOW IS NOT EVIDENCE. This collects several.
//
// lp-plan.mjs picks a range from a single replay, and that replay covers about
// an hour (thirty-seven minutes before 2026-09-09) — one log call near the
// head. On that one sample a very narrow range looks best, because in
// one quiet hour it never had to be nursed. Over a day it will be,
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
import { verdict, appendWindow, mergeLogs, windowFromPlan, earningsTest, rangeValue, measuredResetCost, resetSwapFee, resetLosses, deriveWidths, appendTick, priceSeries, MAX_WINDOWS, MAX_TICKS, calibration } from '../worker-agent/lp-windows.js';
import { RESET_AFTER_HOURS, MIN_HOURS_FOR_EARNINGS, WAIT_PICK_MIN_HOURS, WAIT_PICK_MARGIN, waitInUse, DERIVED_WIDTHS, RECORD_WIDTHS, widthClassOf } from '../shared/lp-guards.js';

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

  // earningsTest: each width lived through a price path, hour by hour.
  // Fee rows are what a centred range of that width earns in a 37.5-min
  // window: narrow earns more per hour, wide earns less.
  const H = 3600;
  const feeRows = [row(1, true, 0.10), row(5, true, 0.03), row(10, true, 0.015)];
  const pwin = (hourIdx, price, rows = feeRows) => ({ ...win(hourIdx * 1000, hourIdx * 1000 + 500, rows), at: new Date(1_700_000_000_000 + hourIdx * H * 1000).toISOString(), minutes: 37.5, price, rebalance_cost_usd: 0.5 });
  const flat = Array.from({ length: 30 }, (_, i) => pwin(i, 100));
  let e1 = earningsTest(flat, 1), e5 = earningsTest(flat, 5);
  t('a flat price never needs a re-set', e1.resets === 0 && e5.resets === 0);
  t('… and the narrow width earns the most per day', e1.net_usd_per_day > e5.net_usd_per_day && e1.net_usd_per_day > 0);
  t('an hour of window fees is scaled from its minutes (0.10 per 37.5 min → 0.16 per hour)', Math.abs(e1.fees_usd / e1.hours - 0.16) < 0.001);
  // A price that drifts 0.15% every hour leaves a ±1% range every few hours
  // and a ±5% range never in a day; the narrow width pays for re-sets it
  // cannot earn back, the wide one keeps most of what it earns. (0.4% an
  // hour, the fixture until 2026-09-11, is a 12% day: once a re-set is
  // charged what its range lost against holding, no width earns on that.)
  const driftRows = [row(1, true, 0.06), row(5, true, 0.03), row(10, true, 0.015)];
  const drift = Array.from({ length: 30 }, (_, i) => pwin(i, 100 * Math.pow(1.0015, i), driftRows));
  e1 = earningsTest(drift, 1); e5 = earningsTest(drift, 5); const e10 = earningsTest(drift, 10);
  t('a drifting price makes the narrow width re-set again and again', e1.resets > e5.resets && e5.resets >= e10.resets);
  t('… so the narrow width nets less than a wider one', e1.net_usd_per_day < e5.net_usd_per_day);
  // rangeValue: what a range is worth against holding its minted amounts.
  t('a range at its minting price has lost nothing', rangeValue(100, 1, 100).loss < 1e-9);
  t('a ±1% range at its lower edge has lost a quarter of a percent', Math.abs(rangeValue(100, 1, 100 / 1.01).loss - 0.0025) < 0.0002);
  t('below the range the position is all of the priced token and moves with the price', (() => { const a = rangeValue(100, 1, 95), b = rangeValue(100, 1, 90); return Math.abs(b.value / a.value - 90 / 95) < 1e-9; })());
  t('above the range the position is all of the quote and moves not at all', Math.abs(rangeValue(100, 1, 110).value - rangeValue(100, 1, 120).value) < 1e-12);
  t('a wide range loses less than a narrow one on the same move', rangeValue(100, 5, 98).loss < rangeValue(100, 1, 98).loss);
  t('the loss is never negative', [80, 99, 100, 101, 130].every((p) => rangeValue(100, 2, p).loss >= 0));
  // The replay charges each re-set what its range lost, and marks the open range.
  t('a re-set on a drifted price is charged what the range lost against holding', e1.resets > 0 && e1.lost_to_price_usd > 0);
  t('… and net is fees minus re-set costs minus that loss minus the open range\'s mark', Math.abs(e1.net_usd - (e1.fees_usd - e1.resets * e1.reset_cost_usd - e1.lost_to_price_usd - e1.open_loss_usd)) < 0.001);
  t('a range that never re-set still carries its open loss at the last price', e5.resets === 0 && e5.open_loss_usd > 0 && e5.lost_to_price_usd === 0);
  t('a flat price loses nothing to the price', earningsTest(flat, 1).lost_to_price_usd === 0 && earningsTest(flat, 1).open_loss_usd === 0);
  t('a 12% day nets nothing at any width', (() => { const fast = Array.from({ length: 30 }, (_, i) => pwin(i, 100 * Math.pow(1.004, i))); return [1, 5, 10].every((w) => earningsTest(fast, w).net_usd < 0); })());
  t('a re-set is only counted after the price has been outside for the delay', (() => {
    // outside for one hour, then back: no re-set with a 2 h delay
    const blip = [pwin(0, 100), pwin(1, 103), pwin(2, 100), pwin(3, 100), pwin(4, 100)];
    return earningsTest(blip, 1, { resetAfterHours: 2 }).resets === 0 && earningsTest(blip, 1, { resetAfterHours: 1 }).resets >= 1;
  })());
  t('a measured re-set cost overrides the replay\'s assumption', earningsTest(drift, 1, { resetCostUsd: 5 }).net_usd < earningsTest(drift, 1).net_usd);
  // The calibration: the position's own fees against the replay's dollars
  // for its width class, both on $50 a day. A day of series, a position.
  {
    const H = 36e5, t0 = Date.parse('2026-09-09T00:00:00Z');
    const pt = (h, fees, owed, value) => ({ at: new Date(t0 + h * H).toISOString(), fees_total_bnb: fees, owed_bnb: owed, value_bnb: value, bnb_usd: 700 });
    // 0.2 BNB earning 0.002 BNB in 24 h = 1% a day → $50 earns $0.50 a day.
    const series = [pt(0, 0.010, 0, 0.2), pt(12, 0.011, 0, 0.2), pt(24, 0.011, 0.001, 0.2)];
    const rows = [{ width: 2, earnings: { hours: 48, fees_usd: 2 * 0.6 } }, { width: 1, earnings: { hours: 48, fees_usd: 2 * 0.7 } }];
    const c = calibration(series, rows, 2);
    t('a day of series at 1% a day reads $0.50 a day on $50', c && Math.abs(c.measured_usd_per_day_on_50 - 0.5) < 1e-3 && c.hours === 24);
    t('the replay figure is the width class row, gross fees per day', c && Math.abs(c.replay_usd_per_day_on_50 - 0.6) < 1e-9);
    t('the factor is measured over replay', c && Math.abs(c.factor - 0.83) < 0.01);
    t('owed fees count as earned (they are the position\'s, uncollected)', calibration([pt(0, 0.01, 0, 0.2), pt(24, 0.01, 0.002, 0.2)], rows, 2).measured_usd_per_day_on_50 === c.measured_usd_per_day_on_50);
    t('under 20 h of series: no calibration', calibration([pt(0, 0.01, 0, 0.2), pt(12, 0.011, 0, 0.2)], rows, 2) === null);
    t('without a width class: no calibration', calibration(series, rows, null) === null);
    t('a width the record has no row for: measured, but no replay and no factor', (() => { const x = calibration(series, rows, 5); return x && x.replay_usd_per_day_on_50 === null && x.factor === null; })());
    // A deposit mid-way doubles the capital; the fee rate is on the time-weighted capital, not the last value.
    const dep = [pt(0, 0.010, 0, 0.2), pt(12, 0.011, 0, 0.4), pt(24, 0.012, 0, 0.4)];
    t('a deposit mid-way weighs the capital by time', (() => { const x = calibration(dep, rows, 2); return x && Math.abs(x.capital_bnb - 0.3) < 1e-9; })());
    t('only the last 72 h of series take part', (() => { const long = [pt(-100, 0, 0, 0.2), ...series]; const x = calibration(long, rows, 2); return x && x.hours === 24; })());
  }
  t('a gap in the record earns nothing for the gap', (() => {
    const gap = [pwin(0, 100), pwin(1, 100), pwin(20, 100), pwin(21, 100)];
    return earningsTest(gap, 1).hours <= 1 + 3 + 1 + 0.01;
  })());
  t('fewer than two priced windows decide nothing', earningsTest([pwin(0, 100)], 1) === null);
  // verdict: the earnings pick needs a day of prices and a positive net.
  const short = { windows: Array.from({ length: 10 }, (_, i) => pwin(i, 100)) };
  t(`under ${MIN_HOURS_FOR_EARNINGS} h of prices there is no earnings pick`, verdict(short).earnings_pick === null && verdict(short).rows[0].earnings !== null);
  const dayFlat = { windows: flat };
  t('a day of flat prices picks the narrowest width', verdict(dayFlat).earnings_pick?.width === 1);
  const dayDrift = { windows: drift };
  t('a day of drifting prices picks a wider width than the narrowest', verdict(dayDrift).earnings_pick && verdict(dayDrift).earnings_pick.width > 1);
  t('a width that nets nothing after its re-sets is never the pick', (() => {
    const v = verdict({ windows: Array.from({ length: 30 }, (_, i) => pwin(i, 100 * Math.pow(1.02, i), [row(1, true, 0.01)])) });
    return v.earnings_pick === null;
  })());
  t(`the earnings rule names the ${RESET_AFTER_HOURS} h delay it replays`, /2 h/.test(verdict(dayFlat).earnings_rule));
  // The delay test, both ways: reported for every wait, the wait in use
  // marked, nothing under a day of prices, and it never touches the pick.
  t('the delay test replays the waits 0, 1, 2 and 3 h', verdict(dayFlat).delay_test.delays.map((d) => d.hours).join(',') === '0,1,2,3');
  t(`the wait in use (${RESET_AFTER_HOURS} h) is marked as such`, verdict(dayFlat).delay_test.delays.filter((d) => d.in_use).map((d) => d.hours).join() === String(RESET_AFTER_HOURS));
  t('under a day of prices the delay test reports nothing', verdict(short).delay_test.delays.length === 0 && verdict(short).delay_test.pick === null);
  t('flat prices: every wait nets the same, and none re-sets', (() => {
    const d = verdict(dayFlat).delay_test.delays;
    return d.every((x) => x.resets === 0) && new Set(d.map((x) => x.net_usd_per_day)).size === 1;
  })());
  t('a blip that returns within the hour: waiting beats re-setting at once', (() => {
    const blipDay = Array.from({ length: 30 }, (_, i) => pwin(i, i === 10 ? 103 : 100, [row(1, true, 0.01)]));
    const d = verdict({ windows: blipDay }).delay_test.delays;
    const at0 = d.find((x) => x.hours === 0), at2 = d.find((x) => x.hours === 2);
    // At once: two re-sets (out, then back) that can eat the whole net, in
    // which case the wait reports "nothing" rather than a width.
    const n0 = at0 && at0.net_usd_per_day != null ? at0.net_usd_per_day : -Infinity;
    return at0 && at2 && at2.resets === 0 && (at0.resets == null || at0.resets > 0) && at2.net_usd_per_day > n0;
  })());
  t('under the bar the earnings pick is replayed with the set wait', verdict(dayDrift).delay_test.wait_basis === 'set' && verdict(dayDrift).earnings_rule.includes(`${RESET_AFTER_HOURS} h`));
  // THE MEASURED WAIT (2026-09-09), both ways. A price that steps 1.5% up
  // every six hours and stays leaves a ±1% range four times a day; a re-set
  // at once earns five of the six hours, a re-set after two earns four. Over
  // a week of such prices 0 h nets a quarter more than 2 h — over the bar —
  // so the re-set uses it, and the width pick is replayed with it. The same
  // path over sixty hours decides nothing; a flat week, where every wait
  // nets the same, keeps the set wait because nothing beat it by the bar.
  const stepRows = [row(1, true, 1.0), row(5, true, 0.03), row(10, true, 0.015)];
  const step = (hours) => Array.from({ length: hours }, (_, i) => pwin(i, 100 * Math.pow(1.015, Math.floor(i / 6)), stepRows));
  const vStep = verdict({ windows: step(130) });
  t('a week of stepping prices: the re-set uses the wait that netted the most (0 h)', vStep.delay_test.in_use_hours === 0 && vStep.delay_test.wait_basis === 'measured');
  t('… the 0 h row is the one marked in use', vStep.delay_test.delays.filter((d) => d.in_use).map((d) => d.hours).join() === '0');
  t('… by more than the bar over the set wait', (() => { const d0 = vStep.delay_test.delays.find((d) => d.hours === 0), d2 = vStep.delay_test.delays.find((d) => d.hours === 2); return d0.net_usd_per_day >= d2.net_usd_per_day * (1 + WAIT_PICK_MARGIN); })());
  t('… and the earnings pick is replayed with that wait', vStep.earnings_pick && vStep.earnings_pick.earnings.resets === vStep.delay_test.delays.find((d) => d.hours === 0).resets && /0 h/.test(vStep.earnings_rule) && /measured/.test(vStep.earnings_rule));
  const vShort = verdict({ windows: step(60) });
  t(`the same prices over 60 h keep the set wait (${WAIT_PICK_MIN_HOURS} h needed)`, vShort.delay_test.in_use_hours === RESET_AFTER_HOURS && vShort.delay_test.wait_basis === 'set' && vShort.delay_test.why.includes(String(WAIT_PICK_MIN_HOURS)));
  const vFlatWeek = verdict({ windows: Array.from({ length: 130 }, (_, i) => pwin(i, 100)) });
  t('a flat week, every wait equal: the set wait stands (nothing beat it by the bar)', vFlatWeek.delay_test.in_use_hours === RESET_AFTER_HOURS && vFlatWeek.delay_test.wait_basis === 'set' && /bar/.test(vFlatWeek.delay_test.why));
  // waitInUse alone, on made-up rows: the set wait winning is "measured" too;
  // a winner a cent over the set wait is not a change; no rows is the set wait.
  const dr = (hours, net) => ({ hours, width: 1, net_usd_per_day: net });
  t('when the set wait nets the most it is in use and called measured', (() => { const w = waitInUse([dr(0, 0.5), dr(1, 0.6), dr(2, 0.9), dr(3, 0.7)], 200); return w.hours === 2 && w.basis === 'measured'; })());
  t('a wait a cent ahead of the set wait does not replace it', (() => { const w = waitInUse([dr(0, 0.91), dr(1, 0.6), dr(2, 0.9), dr(3, 0.7)], 200); return w.hours === 2 && w.basis === 'set'; })());
  t('a wait a tenth ahead of the set wait replaces it', (() => { const w = waitInUse([dr(0, 0.99), dr(1, 0.6), dr(2, 0.9), dr(3, 0.7)], 200); return w.hours === 0 && w.basis === 'measured'; })());
  t('no delay rows: the set wait, called set', (() => { const w = waitInUse([], 200); return w.hours === RESET_AFTER_HOURS && w.basis === 'set'; })());
  t('a set wait that nets nothing yields to a wait that does', (() => { const w = waitInUse([dr(0, 0.9), { hours: 2, width: null, net_usd_per_day: null }], 200); return w.hours === 0 && w.basis === 'measured' && /netted nothing at any width/.test(w.why); })());
  t('… but not under the hours a measured wait needs', (() => { const w = waitInUse([dr(0, 0.9), { hours: 2, width: null, net_usd_per_day: null }], 60); return w.hours === RESET_AFTER_HOURS && w.basis === 'set'; })());
  t('… and not to a wait that nets nothing either', (() => { const w = waitInUse([dr(0, -0.2), { hours: 2, width: null, net_usd_per_day: null }], 200); return w.hours === RESET_AFTER_HOURS && w.basis === 'set' && /no wait nets/.test(w.why); })());
  // The measured re-set cost, both ways: only a re-set that acted, did not
  // error and recorded gas counts, the newest one wins, and without one the
  // verdict says the cost is assumed.
  const rec = { history: [
    { at: '2026-09-02T17:30:00Z', steps: { rebalance: { acted: true, gas_bnb: 0.0004, txs: new Array(9) } } },
    { at: '2026-09-04T07:50:00Z', steps: { rebalance: { acted: true, gas_bnb: 0.0002, txs: new Array(5) } } },
    { at: '2026-09-05T07:50:00Z', steps: { rebalance: { acted: true, error: 'reverted', gas_bnb: 0.0001, txs: new Array(1) } } },
  ] };
  const mc = measuredResetCost(rec, 700);
  t('the newest clean re-set is the measured cost', mc && mc.gas_bnb === 0.0002 && mc.usd === 0.14 && mc.transactions === 5);
  t('a re-set that errored is not a cost measurement', mc.at === '2026-09-04T07:50:00Z');
  t('no re-set on record means no measured cost', measuredResetCost({ history: [] }, 700) === null && measuredResetCost(null, 700) === null);
  t('no BNB price means no measured cost', measuredResetCost(rec, null) === null);
  // The swap fee of a re-set (2026-09-09), both ways: a measured field wins,
  // a buy is worked out from its WBNB, a sell from half the position, and a
  // re-set without a trade paid none. The cost the verdict charges is gas
  // plus the fee — 0.0002 BNB of gas and 0.04 WBNB through the 0.25% pool
  // at $700 is $0.21, not $0.14.
  t('a re-set with no trade on record paid no swap fee', resetSwapFee({}).bnb === 0 && /no trade/.test(resetSwapFee({}).basis));
  t('a buy names its WBNB: 0.04 WBNB through 0.25% is 0.0001 BNB', resetSwapFee({ trade: 'buy the other side with 0.040000 WBNB' }).bnb === 0.0001 && /estimated/.test(resetSwapFee({ trade: 'buy the other side with 0.040000 WBNB' }).basis));
  t('a sell is taken as half the position', resetSwapFee({ trade: 'sell 18.7 of 0x0e09 for WBNB', value_bnb: 0.08 }).bnb === 0.0001);
  t('a measured swap field wins over the estimate', resetSwapFee({ trade: 'buy the other side with 0.040000 WBNB', swap: { fee_bnb: 0.00005 } }).bnb === 0.00005 && resetSwapFee({ swap: { fee_bnb: 0.00005 } }).basis === 'measured');
  const recSwap = { history: [{ at: '2026-09-09T07:50:00Z', steps: { rebalance: { acted: true, gas_bnb: 0.0002, trade: 'buy the other side with 0.040000 WBNB', txs: new Array(3) } } }] };
  const mcs = measuredResetCost(recSwap, 700);
  t('the measured cost is gas plus the swap fee ($0.14 + $0.07 = $0.21)', mcs && mcs.usd === 0.21 && mcs.swap_fee_bnb === 0.0001 && mcs.gas_bnb === 0.0002);
  t('… and the verdict charges that sum', verdict(dayFlat, { resetCostUsd: mcs.usd }).reset_cost.usd === 0.21);
  t('a re-set that measured its impact is charged it too ($0.21 + $0.21)', (() => { const r = { history: [{ at: '2026-09-11T02:50:00Z', steps: { rebalance: { acted: true, gas_bnb: 0.0002, swap: { fee_bnb: 0.0001, impact_bnb: 0.0003 }, txs: new Array(5) } } }] }; const m = measuredResetCost(r, 700); return m.usd === 0.42 && m.impact_bnb === 0.0003 && /measured by the swap/.test(m.impact_basis); })());
  t('a re-set without an impact field is charged none and says so', mcs.impact_bnb === null && /not measured/.test(mcs.impact_basis));
  // The re-sets' own losses, from ticks: a ±1% range minted at tick 0 and left
  // at tick −200 (−2.0%) lost 0.76% against holding; execution is gas + fee + impact.
  const recLoss = { history: [
    { at: '2026-09-10T16:50:00Z', steps: { rebalance: { acted: true, ticks: [-100, 100], tick: -200, value_bnb: 0.5, fees_folded_bnb: 0.001, width_pct: 1, gas_bnb: 0.0001, swap: { fee_bnb: 0.00015, impact_bnb: 0.0002 } } } },
    { at: '2026-09-11T02:50:00Z', steps: { rebalance: { acted: true, ticks: [-200, 200], tick: 0, value_bnb: 0.6, width_pct: 2, gas_bnb: 0.0001, trade: 'buy the other side with 0.3 WBNB' } } },
    { at: '2026-09-11T03:50:00Z', steps: { rebalance: { acted: true, error: 'reverted', ticks: [-200, 200], tick: 0, value_bnb: 0.6, gas_bnb: 0.0001 } } },
    { at: '2026-09-11T04:50:00Z', steps: { rebalance: { acted: false, ticks: [-200, 200], tick: 0 } } },
  ] };
  const rl = resetLosses(recLoss, { bnbUsd: 700 });
  t('only re-sets that acted and did not error count, newest first', rl.resets === 2 && rl.rows[0].at === '2026-09-11T02:50:00Z');
  t('a ±1% range left 2% below its middle lost about 0.76% of the position against holding', Math.abs(rl.rows[1].lost_to_price_pct - 0.758) < 0.01 && Math.abs(rl.rows[1].lost_to_price_bnb - 0.501 * 0.00758) < 0.0001 && rl.rows[1].price_move_pct === -1.98);
  t('a range left at its own middle lost nothing', rl.rows[0].lost_to_price_bnb === 0 && rl.rows[0].price_move_pct === 0);
  t('execution is gas plus fee plus the measured impact, or the fee estimated from the trade', Math.abs(rl.rows[1].execution_bnb - 0.00045) < 1e-9 && rl.rows[1].impact_bnb === 0.0002 && rl.rows[0].impact_bnb === null && Math.abs(rl.rows[0].execution_bnb - (0.0001 + 0.3 * 0.0025)) < 1e-9);
  t('the totals add up and the dollars follow the BNB price', Math.abs(rl.lost_to_price_bnb - rl.rows[1].lost_to_price_bnb) < 1e-9 && rl.impact_measured === 1 && rl.rows[1].lost_to_price_usd === Math.round(rl.rows[1].lost_to_price_bnb * 700 * 100) / 100);
  t('no re-sets: an empty table, zero totals', resetLosses({ history: [] }).resets === 0 && resetLosses(null).lost_to_price_bnb === 0);
  // The derived widths: read off the neighbours, never rosier than the record.
  const wReal = { rows: [{ width: 1, held: false, in_range_pct: 80, crossings: 2, fees: 0.02, net: 0.01 }, { width: 2, held: true, in_range_pct: 100, crossings: 0, fees: 0.01, net: 0.01 }, { width: 5, held: true, in_range_pct: 100, crossings: 0, fees: 0.004, net: 0.004 }, { width: 10, held: true, in_range_pct: 100, crossings: 0, fees: 0.002, net: 0.002 }, { width: 'full', held: true, in_range_pct: 100, crossings: 0, fees: 0.0001, net: 0.0001 }] };
  const dw = deriveWidths(wReal);
  t(`the derived widths ${DERIVED_WIDTHS.join('/')} are added to a window`, DERIVED_WIDTHS.every((w) => dw.rows.some((r) => r.width === w && r.derived)) && dw.rows.length === wReal.rows.length + DERIVED_WIDTHS.length);
  t('a derived width\'s fees are the wider neighbour\'s times neighbour/width (±3% = ±5% × 5/3)', Math.abs(dw.rows.find((r) => r.width === 3).fees - 0.004 * 5 / 3) < 1e-6 && Math.abs(dw.rows.find((r) => r.width === 1.5).fees - 0.01 * 2 / 1.5) < 1e-6);
  t('… and whether it held comes off the narrower neighbour (±1.5% did not hold because ±1% did not; ±3% held because ±2% did)', dw.rows.find((r) => r.width === 1.5).held === false && dw.rows.find((r) => r.width === 1.5).crossings === 2 && dw.rows.find((r) => r.width === 3).held === true);
  t('a derived row\'s net carries the narrower neighbour\'s re-set cost (±1.5%: fees 0.0133 minus the 0.01 that ±1% paid)', Math.abs(dw.rows.find((r) => r.width === 1.5).net - (0.01 * 2 / 1.5 - 0.01)) < 1e-6);
  t('a window without a wider neighbour gets no derived row there', !deriveWidths({ rows: [{ width: 5, held: true, fees: 0.004, net: 0.004, crossings: 0 }] }).rows.some((r) => r.width === 7));
  t('the verdict replays the derived widths and marks them', (() => { const v = verdict(dayFlat); const r3 = v.rows.find((r) => r.width === 3); return r3 && r3.derived === true && r3.earnings && r3.earnings.fees_usd > 0 && v.rows.find((r) => r.width === 5).derived === false; })());
  // The price tape: samples between the hourly heads, both ways.
  const tapeAt = (hourIdx, minutes, price) => ({ at: new Date(1_700_000_000_000 + (hourIdx * 60 + minutes) * 60 * 1000).toISOString(), tick: 0, price, pool: '0xpool' });
  let tp = appendTick([], tapeAt(0, 10, 100));
  t('a sample is appended', tp.added && tp.tape.length === 1);
  t('a second sample within a minute is not', !appendTick(tp.tape, { ...tapeAt(0, 10, 100), at: new Date(Date.parse(tp.tape[0].at) + 30e3).toISOString() }).added);
  t('a sample without a price is not', !appendTick(tp.tape, { at: tapeAt(0, 20, 0).at, price: 0 }).added);
  t(`the tape is capped at ${MAX_TICKS} and keeps the newest`, (() => { let x = []; for (let i = 0; i < MAX_TICKS + 3; i++) x = appendTick(x, tapeAt(i, 0, 100)).tape; return x.length === MAX_TICKS && x[0].at === tapeAt(3, 0, 100).at; })());
  // A flat hour-by-hour record with a flat tape: the same fees, no re-set, the samples counted.
  const flatTape = [].concat(...flat.slice(0, 29).map((_, i) => [10, 20, 30, 40, 50].map((m) => tapeAt(i, m, 100))));
  const eFlatTape = earningsTest(flat, 1, { tape: flatTape });
  t('a flat tape changes nothing but the count of points', Math.abs(eFlatTape.fees_usd - earningsTest(flat, 1).fees_usd) < 1e-6 && eFlatTape.resets === 0 && eFlatTape.tape_samples === flatTape.length && eFlatTape.price_points === 30 + flatTape.length);
  // A price that leaves the range for twenty minutes between two in-range hourly heads:
  // the hourly series never sees it; the tape does, and with no wait it is a re-set.
  const blipTape = [tapeAt(5, 20, 103), tapeAt(5, 40, 103)];
  t('the hourly series misses an excursion inside the hour', earningsTest(flat, 1, { resetAfterHours: 0 }).resets === 0);
  t('… the tape sees it, and with no wait it is a re-set charged its loss', (() => { const e = earningsTest(flat, 1, { resetAfterHours: 0, tape: blipTape }); return e.resets >= 1 && e.lost_to_price_usd > 0; })());
  t('… and with a two-hour wait a twenty-minute excursion is not', earningsTest(flat, 1, { resetAfterHours: 2, tape: blipTape }).resets === 0);
  t('a sample earns at the rate of the window whose hour it falls in', (() => { const ps = priceSeries(flat.slice(0, 3), [tapeAt(1, 30, 100)]); const smp = ps.find((p) => p.at === tapeAt(1, 30, 100).at); return smp && smp.window === flat[2]; })());
  t('a sample within a minute of a window head is counted once', priceSeries(flat.slice(0, 3), [{ ...tapeAt(1, 0, 100), at: new Date(Date.parse(flat[1].at) + 20e3).toISOString() }]).length === 3);
  t('the verdict walks the tape of its own pool only and says how many samples', (() => { const v = verdict({ pool: '0xpool', windows: flat }, { tape: flatTape.concat([{ ...tapeAt(3, 15, 200), pool: '0xother' }]) }); return v.price_samples === flatTape.length && v.rows[0].earnings.resets === 0 && v.price_samples_since === flatTape[0].at; })());
  t('no tape: no samples, the same verdict as before', verdict(dayFlat).price_samples === 0 && verdict(dayFlat).earnings_pick?.width === 1);
  t('every width is also replayed over the last day alone', (() => { const v = verdict(dayFlat); const r = v.rows.find((x) => x.width === 1); return r.earnings_24h && r.earnings_24h.hours <= 24.01 && r.earnings_24h.hours >= 20 && v.rows.every((x) => x.width !== 'full' || x.earnings_24h === null); })());
  t('the last-day replay walks only the last day of the tape', (() => { const v = verdict({ pool: '0xpool', windows: flat }, { tape: flatTape }); const r = v.rows.find((x) => x.width === 1); return r.earnings_24h.tape_samples < r.earnings.tape_samples && r.earnings_24h.tape_samples > 0; })());
  t('the width class snaps to the finer grid (a ±3.1% range is the 3 class, not 2 or 5)', widthClassOf([-Math.round(Math.log(1.031) / Math.log(1.0001)), Math.round(Math.log(1.031) / Math.log(1.0001))]) === 3 && RECORD_WIDTHS.includes(1.5) && RECORD_WIDTHS.includes(7));
  t('the verdict charges the measured cost when given one', verdict(dayFlat, { resetCostUsd: 0.14 }).reset_cost.usd === 0.14 && /measured/.test(verdict(dayFlat, { resetCostUsd: 0.14 }).reset_cost.basis));
  t('… and says the cost is assumed when not', /assumed/.test(verdict(dayFlat).reset_cost.basis));

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
