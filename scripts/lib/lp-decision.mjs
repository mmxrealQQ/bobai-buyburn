// THE DECISION, in one place, so that what is printed and what is signed are
// the same decision.
//
// lp-plan.mjs prints this. lp-open.mjs executes it. If they each worked it out
// for themselves, the plan a person reads and the position that gets minted
// would agree right up until the day they did not — and the day they did not
// would be a day the price had moved between the two runs, which is every day.
// So the decision is made once, returned as data, and the two scripts only
// differ in what they do with it.
//
// The decision is made by this project's own two published tools and nothing
// else: pancakeswap_fee_tiers chooses the pool, pancakeswap_range_plan chooses
// the width. There is no override, no hand-picked favourite and no constant in
// this file that says which pool is best. If the answer looks wrong, that is a
// finding about the tools, and the tools are what get fixed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verdict } from '../../worker-agent/lp-windows.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

// The repo root is CommonJS and dashboard/*.js are ES modules, so they are
// staged as .mjs before Node will read their exports — the same trick
// build-skill.mjs uses to ship them. Not copies: read fresh from the one source
// on every run, so a fix to the measurement is a fix here too.
export async function loadTools() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-decide-'));
  for (const f of ['scanner-chain.js', 'tier-scan.js', 'range-scan.js']) {
    let src = fs.readFileSync(path.join(ROOT, 'dashboard', f), 'utf8');
    src = src.split("'./scanner-chain.js'").join("'./scanner-chain.mjs'");
    fs.writeFileSync(path.join(stage, f.replace(/\.js$/, '.mjs')), src);
  }
  const u = (f) => 'file://' + path.join(stage, f).split(path.sep).join('/');
  const C = await import(u('scanner-chain.mjs'));
  const { feeTiers } = await import(u('tier-scan.mjs'));
  const { rangePlan } = await import(u('range-scan.mjs'));
  return { C, feeTiers, rangePlan, cleanup: () => fs.rmSync(stage, { recursive: true, force: true }) };
}

// THE UNIVERSE IS FIXED AND SMALL, on purpose.
//
// BNB, $BOBAI, $BOB and CAKE. A liquidity position is a position: it holds two
// tokens and takes on their price. Widening this to whatever pays best this
// hour would mean the project quietly acquiring exposure to tokens it has never
// said a word about, which is not a thing to do with a treasury — and it is the
// exact behaviour this marketplace criticises in other agents.
export const UNIVERSE = [
  ['CAKE', '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
    'the venue we measure, and the only outside token this project has ever named'],
  ['BOB', '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e',
    'already held and already burned by the tax, so no new exposure'],
  ['BOBAI', '0x245c386dcfed896f5c346107596141e5edcbffff',
    'our own token'],
];

export const V3_POSITION_MANAGER = '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364';
export const V2_ROUTER = '0x10ed43c718714eb63d5aa57b78b54704e256024e';
// Both were confirmed against the chain rather than taken from a docs page: the
// position manager's factory() returns the same V3 factory the scanner reads,
// and both contracts' WETH() is WBNB. A wrong address here does not throw, it
// sends money somewhere else.

const TICK_BASE = 1.0001;
const sqrtAtTick = (t) => Math.pow(TICK_BASE, t / 2);

// WHAT THE RECORD SAYS, when there is one.
//
// A single replay covers about an hour (thirty-seven minutes before
// 2026-09-09), one log call near the head. That is enough to compare
// widths and nowhere near enough to choose one for a position nobody watches:
// measured on the same pool two hours apart, +/-0.25% went from best in the
// list to SIX crossings and minus $2.74 on fifty dollars. The narrow width had
// simply not been tested by a move yet.
//
// So if data/lp-windows.json holds windows for this pool, they decide, and the
// single fresh replay is demoted to what it actually is — the latest
// observation. The rules (overlaps count once, ever-negative is out, fewer than
// two windows decide nothing) live in worker-agent/lp-windows.js, the same
// function the hourly cron and `lp-windows.mjs --report` use, so the width a
// person reads in the report is the width this sizes the mint on.
function recordedVerdict(pool, root) {
  try {
    const log = JSON.parse(fs.readFileSync(path.join(root, 'data', 'lp-windows.json'), 'utf8'));
    if (!log.windows?.length || log.pool?.toLowerCase() !== String(pool).toLowerCase()) return null;
    const v = verdict(log);
    return { windows: v.windows, thin: v.thin, rows: v.rows, pick: v.pick };
  } catch { return null; }
}

export async function decide({ usd = 50, tools = null, onProgress = () => {} } = {}) {
  const T = tools || (await loadTools());
  const { C, feeTiers, rangePlan } = T;

  const candidates = [];
  for (const [sym, addr, why] of UNIVERSE) {
    let tiers = null;
    try { tiers = await feeTiers(addr); }
    catch (e) { candidates.push({ sym, addr, why, skipped: `tiers unreadable: ${e.headline || e.message}` }); continue; }

    const v3 = (tiers.tiers || []).filter((t) => /^V3/.test(t.tier));
    if (!v3.length) {
      candidates.push({ sym, addr, why, tiers, skipped:
        `no V3 pool against ${tiers.quote.symbol}. A V2 position spans every price by construction, so there is no range to choose.` });
      continue;
    }

    // The pool comes from the WORKING-capital ranking, not the parked one. That
    // is the entire argument of the tier tool; using the other number here
    // would be this project not believing its own measurement.
    const pick = tiers.best_paying_tier_by_working_capital
      || tiers.best_paying_tier_by_working_capital_among_readable;
    const row = (tiers.tiers || []).find((t) => t.tier === pick && /^V3/.test(t.tier))
      || v3.slice().sort((a, b) => (b.working_capital_usd || 0) - (a.working_capital_usd || 0))[0];
    const pickedIsV2 = pick && !/^V3/.test(pick);

    onProgress({ sym, stage: 'tier', tier: row.tier });

    let plan = null;
    try { plan = await rangePlan(row.pair || row.pool, { capitalUsd: usd }); }
    catch (e) { candidates.push({ sym, addr, why, tiers, row, skipped: `range replay unreadable: ${e.headline || e.message}` }); continue; }

    const held = plan.narrowest_range_that_held_the_whole_window;
    const heldRow = held ? plan.ranges.find((r) => `±${r.width_pct}%` === held) : null;
    candidates.push({ sym, addr, why, tiers, row, plan, held, heldRow, pickedIsV2,
      full: plan.ranges.find((r) => r.full_range) });
    onProgress({ sym, stage: 'range', held });
  }

  // The comparison, and it is made on one number: what this much money would
  // have collected in the narrowest range that actually HELD for the whole
  // window, net of what putting it back would have cost. A range the price
  // walked out of does not get to beat one that did not — the exits are exactly
  // the work an unattended position cannot do for itself.
  const usable = candidates.filter((c) => c.heldRow && c.heldRow.net_after_rebalancing_usd_in_window > 0);
  usable.sort((a, b) => b.heldRow.net_after_rebalancing_usd_in_window - a.heldRow.net_after_rebalancing_usd_in_window);
  const win = usable[0] || null;
  if (!win) return { usd, candidates, winner: null, tools: T };

  // Tick bounds aligned to the pool's own spacing. A mint reverts on a tick
  // that is not a multiple of it, and rounding INWARD keeps the range no wider
  // than the one the replay measured — rounding outward would quietly buy a
  // different position from the one that was tested.
  const st = await C.rpcBatch([
    C.call(win.plan.pool, C.SEL.slot0),
    C.call(win.plan.pool, '0xd0c93a7c'),   // tickSpacing()
    C.call(win.plan.pool, C.SEL.token0),
  ]);
  const spacing = Number(C.hx(st[1])) || 1;
  const tickNow = (() => {
    const v = BigInt('0x' + st[0].slice(66, 130));
    return Number(v >= (1n << 255n) ? v - (1n << 256n) : v);
  })();
  const sqrtP = Number(BigInt('0x' + st[0].slice(2, 66))) / Number(2n ** 96n);
  // The recorded history overrides the single fresh window when it exists.
  const record = recordedVerdict(win.plan.pool, ROOT);
  let chosenWidth = win.heldRow.width_pct, widthBasis = 'one fresh window';
  if (record && !record.thin) {
    if (record.pick) {
      chosenWidth = record.pick.width;
      widthBasis = `${record.windows} recorded windows — held in every one, never negative`;
    } else {
      chosenWidth = null;
      widthBasis = `${record.windows} recorded windows, and no width held in all of them without going negative`;
    }
  } else if (record && record.thin) {
    widthBasis = `one fresh window (only ${record.windows} recorded so far — two are needed before the record decides)`;
  }
  if (chosenWidth == null) {
    return { usd, candidates, tools: T, winner: null, record, widthBasis };
  }
  const chosenRow = win.plan.ranges.find((r) => r.width_pct === chosenWidth) || win.heldRow;
  const span = Math.log(1 + chosenWidth / 100) / Math.log(TICK_BASE);
  const tickLower = Math.ceil((tickNow - span) / spacing) * spacing;
  const tickUpper = Math.floor((tickNow + span) / spacing) * spacing;

  const token0 = C.addrAt(st[2]);
  const tokenIsZero = token0 === win.addr;
  const token1 = tokenIsZero ? win.plan.pair.quote.address : win.addr;
  const dec0 = tokenIsZero ? win.plan.pair.token.decimals : win.plan.pair.quote.decimals;
  const dec1 = tokenIsZero ? win.plan.pair.quote.decimals : win.plan.pair.token.decimals;

  // What the position needs, in each token, for the range it is going into.
  // These are the standard identities and they are not a preference: inside a
  // range the split between the two sides is fixed by where the price sits in
  // it, so "half and half" is wrong except by coincidence.
  const sLo = sqrtAtTick(tickLower), sHi = sqrtAtTick(tickUpper);
  const perL0 = sqrtP >= sHi ? 0 : (1 / Math.max(sqrtP, sLo) - 1 / sHi);
  const perL1 = sqrtP <= sLo ? 0 : (Math.min(sqrtP, sHi) - sLo);

  const base = await C.rpcBatch([C.call(C.BNB_PAIR, C.SEL.reserves), C.call(C.BNB_PAIR, C.SEL.token0)]);
  const br = C.res2(base[0]);
  const bnbUsd = C.addrAt(base[1]) === C.WBNB ? br[1] / br[0] : br[0] / br[1];
  const tokUsd = (await C.priceToken(win.addr, bnbUsd)).usd;
  const knownQ = C.QUOTES.find(([x]) => x === win.plan.pair.quote.address);
  const quoteUsd = knownQ ? (knownQ[2] ? 1 : bnbUsd) : (await C.priceToken(win.plan.pair.quote.address, bnbUsd)).usd;
  const usdPerUnit0 = (tokenIsZero ? tokUsd : quoteUsd) / 10 ** dec0;
  const usdPerUnit1 = (tokenIsZero ? quoteUsd : tokUsd) / 10 ** dec1;

  const perLUsd = perL0 * usdPerUnit0 + perL1 * usdPerUnit1;
  const L = perLUsd > 0 ? usd / perLUsd : 0;
  const amount0 = L * perL0, amount1 = L * perL1;

  return {
    usd, candidates, tools: T,
    winner: {
      symbol: win.sym, why: win.why, pool: win.plan.pool, tier: win.row.tier,
      fee_pct: win.plan.fee_pct, width_pct: chosenWidth,
      width_basis: widthBasis, record,
      price_range: chosenRow.price_range, price_now: win.plan.price_now,
      tickNow, tickLower, tickUpper, spacing, sqrtP,
      token0, token1, dec0, dec1, tokenIsZero,
      amount0Raw: BigInt(Math.floor(amount0)), amount1Raw: BigInt(Math.floor(amount1)),
      amount0: amount0 / 10 ** dec0, amount1: amount1 / 10 ** dec1,
      usdPerUnit0, usdPerUnit1, bnbUsd,
      measured: chosenRow, window: win.plan.measured_window,
      rebalanceUsd: win.plan.rebalance_cost_usd_assumed,
      bestNet: win.plan.best_range_after_paying_to_put_it_back,
      full: win.full,
      runnerUp: usable[1] || null,
    },
  };
}
