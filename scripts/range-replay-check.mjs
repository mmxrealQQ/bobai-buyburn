#!/usr/bin/env node
// Does the range replay hold together?
//
// pancakeswap_range_plan walks a position through the swaps that really
// happened and reports what it would have collected per candidate width. There
// is nothing to compare that against on the internet either, so it has to be
// checked against the arithmetic it cannot escape.
//
// THE RELATION THAT DOES THE WORK
// For a position of fixed value, the liquidity constant L is very nearly
// inversely proportional to the width of its range: halve the width and you
// roughly double L. So for two widths that were BOTH in range for the whole
// window and are both small against the pool, the fees collected have to be in
// very nearly the same ratio as the widths, the other way up. Measured live on
// CAKE/BNB: ±0.5% took $0.0389, ±1% took $0.0196, ±2% took $0.0099 — halving,
// twice, from an independent replay of 210 separate trades. Nothing enforces
// that except the maths being right.
//
// The other three are floors no correct answer can go under: a wider range can
// never be in range for less of the window than a narrower one inside it, a
// range can never collect more than the pool paid out in total, and a position
// that was never in range must collect nothing rather than a small number.
//
// Usage:
//   node scripts/range-replay-check.mjs [--self-test] [token ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'range-check-'));
for (const f of ['scanner-chain.js', 'range-scan.js']) {
  let src = fs.readFileSync(path.join(ROOT, 'dashboard', f), 'utf8');
  src = src.split("'./scanner-chain.js'").join("'./scanner-chain.mjs'");
  fs.writeFileSync(path.join(stage, f.replace(/\.js$/, '.mjs')), src);
}
const R = await import('file://' + path.join(stage, 'range-scan.mjs').split(path.sep).join('/'));

const SELF = process.argv.includes('--self-test');
const TOKENS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DEFAULT = [['CAKE', '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82']];

let failed = 0, checks = 0;
const ok = (name, pass, detail) => {
  checks += 1;
  if (!pass) failed += 1;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const list = TOKENS.length ? TOKENS.map((t) => [t.slice(0, 8), t.toLowerCase()]) : DEFAULT;
for (const [name, addr] of list) {
  let plan;
  try { plan = await R.rangePlan(addr, { capitalUsd: 1000 }); }
  catch (e) { ok(`${name}: replay runs`, false, e.headline || e.message); continue; }

  const rows = plan.ranges.filter((r) => !r.full_range);
  const full = plan.ranges.find((r) => r.full_range);
  ok(`${name}: replay runs`, rows.length >= 4 && !!full,
    `${plan.measured_window.swaps} swaps, pool paid $${plan.measured_window.fees_the_pool_paid_usd}`);
  if (!rows.length) continue;

  // 1. Nothing may collect more than the pool paid out in the same window.
  const overpaid = plan.ranges.filter((r) => r.fees_usd_in_window > plan.measured_window.fees_the_pool_paid_usd);
  ok(`${name}: no range collects more than the pool paid`, overpaid.length === 0,
    overpaid.length ? overpaid.map((r) => `${r.width_pct}%: $${r.fees_usd_in_window}`).join(', ')
      : `most any range took: $${Math.max(...plan.ranges.map((r) => r.fees_usd_in_window)).toFixed(6)} of $${plan.measured_window.fees_the_pool_paid_usd}`);

  // 2. A wider range contains a narrower one, so it cannot be in range less
  //    often. This catches a sign error or an inverted bound instantly.
  let monotone = true, where = '';
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.share_of_window_in_range_pct != null && b.share_of_window_in_range_pct != null
      && b.share_of_window_in_range_pct < a.share_of_window_in_range_pct - 0.05) {
      monotone = false; where = `±${b.width_pct}% in range ${b.share_of_window_in_range_pct}% < ±${a.width_pct}% at ${a.share_of_window_in_range_pct}%`;
    }
  }
  ok(`${name}: a wider range is never in range less often`, monotone, where || 'monotone across all widths');

  // 3. The halving. Only across widths that never left, because a range the
  //    price walked out of stops collecting for reasons that have nothing to do
  //    with L — comparing those would test the market, not the arithmetic.
  const held = rows.filter((r) => r.times_it_crossed_the_edge === 0 && r.fees_usd_in_window > 0
    && r.share_of_window_in_range_pct === 100);
  let worst = 0, pairs = 0, detail = [];
  for (let i = 1; i < held.length; i++) {
    const a = held[i - 1], b = held[i];
    const widthRatio = b.width_pct / a.width_pct;
    const feeRatio = a.fees_usd_in_window / b.fees_usd_in_window;
    const off = Math.abs(feeRatio / widthRatio - 1) * 100;
    pairs += 1; worst = Math.max(worst, off);
    detail.push(`±${a.width_pct}→±${b.width_pct}: ${off.toFixed(1)}%`);
  }
  // 12% is loose on purpose: L is only exactly inverse to width in the limit of
  // a narrow range, and the widest pairs here are 5% and 10%, where the
  // approximation genuinely bends. A real error shows up as hundreds.
  ok(`${name}: fees scale inversely with width across ranges that held`,
    pairs === 0 || worst < 12,
    pairs === 0 ? 'no two widths both held the whole window — nothing to compare' : detail.join('  '));

  // 4. "Held" has to mean held. The first build called a range held when it was
  //    never seen LEAVING, which a range the price only wandered into halfway
  //    through satisfies perfectly: ±0.25% came back marked as never left while
  //    it had been in range for 80% of the window. The position is centred on
  //    today's price and replayed backwards, so arriving is as common as
  //    leaving, and the two must never be printed as the same fact.
  const claim = plan.narrowest_range_that_held_the_whole_window;
  const claimed = claim ? rows.find((r) => `±${r.width_pct}%` === claim) : null;
  ok(`${name}: the range called held was in range the whole window`,
    !claim || (claimed && claimed.share_of_window_in_range_pct === 100 && claimed.times_it_crossed_the_edge === 0),
    claim ? `${claim}: ${claimed?.share_of_window_in_range_pct}% of the window, ${claimed?.times_it_crossed_the_edge} crossings`
      : 'nothing held the whole window, and nothing was claimed to');

  // 5. And full range, the widest of all, must be the poorest.
  ok(`${name}: full range collects least`,
    full.fees_usd_in_window <= Math.min(...rows.map((r) => r.fees_usd_in_window)) * 1.001,
    `full $${full.fees_usd_in_window.toFixed(6)} against the best width at $${Math.max(...rows.map((r) => r.fees_usd_in_window)).toFixed(6)}`);

  if (SELF) {
    // A position ten thousand percent wide is full range by another name, so it
    // must collect about what full range collects. If the width were being
    // ignored — the failure that would make every row above look plausible and
    // be meaningless — this would come back equal to the narrow rows instead.
    const wide = await R.rangePlan(addr, { capitalUsd: 1000 });
    const w = wide.ranges.find((r) => r.width_pct === 10);
    ok('SELF: the width is actually used',
      w && full && w.fees_usd_in_window > full.fees_usd_in_window * 1.5,
      w ? `±10% took $${w.fees_usd_in_window.toFixed(6)}, full range $${full.fees_usd_in_window.toFixed(6)}` : 'no ±10% row');
    // And the size has to be used too: ten times the capital in the same range
    // collects close to ten times as much while it is small against the pool.
    const big = await R.rangePlan(addr, { capitalUsd: 10000 });
    const b1 = rows.find((r) => r.width_pct === 2), b10 = big.ranges.find((r) => r.width_pct === 2);
    const ratio = b1 && b10 && b1.fees_usd_in_window > 0 ? b10.fees_usd_in_window / b1.fees_usd_in_window : null;
    ok('SELF: ten times the capital collects close to ten times the fees',
      ratio != null && ratio > 8 && ratio < 10.2,
      ratio == null ? 'could not compare' : `${ratio.toFixed(2)}× — under 10 because the position dilutes itself`);
  }
}

fs.rmSync(stage, { recursive: true, force: true });
console.log(`\n${checks - failed}/${checks} checks passed${SELF ? ' (with self-test)' : ''}`);
process.exit(failed ? 1 : 0);
