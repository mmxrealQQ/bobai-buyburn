#!/usr/bin/env node
// THE TRADING AGENT, LIVE — the hourly tick that turns the rule into orders
// through the Binance Agentic Wallet (`baw` CLI), and the loop that runs it.
//
//   node scripts/trader-live.mjs --tick                 plan this hour, sign nothing
//   node scripts/trader-live.mjs --tick --confirm       plan and send
//   node scripts/trader-live.mjs --bootstrap --confirm  turn the wallet's BNB into the USDT base (keeps a gas reserve)
//   node scripts/trader-live.mjs --loop --confirm       run --tick --confirm every hour at :05, forever
//   node scripts/trader-live.mjs --state                what the agent holds and has done
//
// WHAT A TICK DOES, in order
//   1. wallet connected?  (baw wallet status) — otherwise it stops and says so
//   2. STOP file present? (data/trader/STOP)  — the operator's off switch
//   3. prices refreshed   (trader-fetch --hours 400 --out prices-live.json)
//   4. balances read      (baw wallet balance) and reconciled with state.json
//   5. the rule           (shared/trader-core.js signal, picks.json)
//   6. orders             one at a time; each polled to FINISHED/FAILED; the
//                         amount received is measured from the balance, not
//                         assumed, and the effective cost is written down
//   7. the profit rule    50% of the pool into BOBAI at a BOBAI dip, 50% into the pot
//   8. state + log        data/trader/state.json, data/trader/log.jsonl
//
// GUARDS
//   - never more than the pot in one order; never below MIN_ORDER_USD
//   - a BNB gas reserve is never traded
//   - daily loss cap: once realised losses in a UTC day exceed DAY_LOSS_CAP_PCT
//     of the capital, no new entry until the next day (exits still happen)
//   - a failed order is logged and the tick ends; nothing is retried blind
//
// State is the truth about what THIS agent holds; the wallet may hold more
// (the operator's own coins) and that is left alone.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TRADING_LEGS, DEFAULT_COSTS_PCT, zScores, signal } from '../shared/trader-core.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'data', 'trader');
const STATE = path.join(DIR, 'state.json');
const LOG = path.join(DIR, 'log.jsonl');
const PICKS = path.join(DIR, 'picks.json');
const LIVE = path.join(DIR, 'prices-live.json');
const STOP = path.join(DIR, 'STOP');

const CONFIRM = process.argv.includes('--confirm');
const argOf = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const has = (k) => process.argv.includes(k);

const CHAIN = '56';
const TOKEN = {
  BNB: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  BOB: '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e',
  BOBAI: '0x245c386dcfed896f5c346107596141e5edcbffff',
};
const GAS_RESERVE_BNB = 0.006;      // ~$4.50: dozens of swaps
// Gas is paid in BNB on top of the quote: 0.00047 BNB (~$0.35) per swap on 2026-09-08. Under $10 that is over 3.5% of an order.
const MIN_ORDER_USD = 10;
const DAY_LOSS_CAP_PCT = 5;
const BOBAI_DIP_Z = 1, BOBAI_WINDOW = 168, PROFIT_TO_BOBAI_PCT = 50;
const POLL_MS = 5000, POLL_MAX_MS = 120000;

const now = () => new Date().toISOString();
const log = (entry) => { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ at: now(), ...entry }) + '\n'); };
const say = (s) => console.log(s);

function baw(args, timeout = 60000) {
  try { return JSON.parse(execFileSync('baw', [...args, '--json'], { encoding: 'utf8', timeout, shell: process.platform === 'win32' })); }
  catch (e) { return { success: false, error: { message: String(e.stdout || e.message).slice(0, 300) } }; }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; }
}
function writeState(st) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st, null, 1)); }
function freshState(capital) {
  return { capital_usd: capital, pot_usdt: 0, position: null, profit_pool_usd: 0, bobai: { units: 0, spent_usd: 0, buys: 0 }, realised_usd: 0, day: { date: now().slice(0, 10), realised_usd: 0 }, fees_measured: [], started_at: now() };
}

function balances() {
  const r = baw(['wallet', 'balance', '--binanceChainId', CHAIN]);
  if (!r.success) throw new Error('balance: ' + r.error.message);
  const by = {};
  for (const b of r.data || []) by[String(b.symbol).toUpperCase()] = { balance: Number(b.balance), price: Number(b.price), value: Number(b.value), address: b.address };
  return by;
}
const bal = (by, sym) => (by[sym] ? by[sym].balance : 0);

// One swap, sent and watched to its end. Returns what arrived, measured.
function swap(fromSym, toSym, qty, why) {
  const before = balances();
  const q = baw(['market-order', 'quote', '--fromTokenQty', String(qty), '--fromToken', TOKEN[fromSym], '--toToken', TOKEN[toSym], '--binanceChainId', CHAIN]);
  const quoted = q.success ? Number(q.data.toCoinAmount) : null;
  if (!CONFIRM) {
    say(`  would swap ${qty} ${fromSym} -> ${toSym}${quoted != null ? ` (quote ${quoted} ${toSym})` : ''} — ${why}`);
    return { dry: true, quoted };
  }
  const r = baw(['market-order', 'swap', '--fromTokenQty', String(qty), '--fromToken', TOKEN[fromSym], '--toToken', TOKEN[toSym], '--binanceChainId', CHAIN, '--slippage', 'auto']);
  if (!r.success) { log({ kind: 'order_refused', fromSym, toSym, qty, why, error: r.error }); throw new Error(`swap refused: ${r.error.message}`); }
  const orderId = r.data.orderId;
  log({ kind: 'order_sent', orderId, fromSym, toSym, qty, quoted, why });
  let status = 'PENDING', txHash = null;
  const t0 = Date.now();
  while (Date.now() - t0 < POLL_MAX_MS) {
    const l = baw(['market-order', 'list', '--orderId', String(orderId), '--binanceChainId', CHAIN]);
    const row = l.success && l.data && Array.isArray(l.data.list) ? l.data.list.find((x) => String(x.orderId) === String(orderId)) || l.data.list[0] : null;
    if (row) { status = row.status; txHash = row.txHash || null; }
    if (status === 'FINISHED' || status === 'FAILED') break;
    execFileSync(process.platform === 'win32' ? 'timeout' : 'sleep', process.platform === 'win32' ? ['/t', String(POLL_MS / 1000)] : [String(POLL_MS / 1000)], { stdio: 'ignore', shell: process.platform === 'win32' });
  }
  if (status !== 'FINISHED') { log({ kind: 'order_failed', orderId, status, txHash, fromSym, toSym, qty }); throw new Error(`order ${orderId} ended ${status}`); }
  const after = balances();
  const received = Math.max(0, bal(after, toSym) - bal(before, toSym));
  const spent = Math.max(0, bal(before, fromSym) - bal(after, fromSym));
  const costPct = quoted && received ? Math.round((1 - received / quoted) * 10000) / 100 : null;
  log({ kind: 'order_done', orderId, txHash, fromSym, toSym, qty, spent, received, quoted, cost_vs_quote_pct: costPct, why });
  say(`  ${fromSym} -> ${toSym}: sent ${spent}, received ${received}${quoted ? ` (quote ${quoted}, ${costPct}% under it)` : ''} · tx ${txHash}`);
  return { dry: false, orderId, txHash, spent, received, quoted, costPct, priceUsd: after[toSym]?.price ?? before[toSym]?.price ?? null, priceFromUsd: after[fromSym]?.price ?? before[fromSym]?.price ?? null };
}

// ---------------------------------------------------------------- state view
if (has('--state')) {
  const st = readState();
  if (!st) { say('no state yet — run --bootstrap --confirm first'); process.exit(0); }
  say(JSON.stringify(st, null, 1));
  process.exit(0);
}

// ---------------------------------------------------------------- bootstrap
if (has('--bootstrap')) {
  const st = readState() || freshState(Number(argOf('--capital') || 100));
  const w = baw(['wallet', 'status']);
  if (!w.success || w.data.status !== 'CONNECTED') { say('wallet not connected'); process.exit(1); }
  const by = balances();
  const bnb = bal(by, 'BNB'), usdt = bal(by, 'USDT');
  say(`wallet: ${bnb} BNB (≈ $${(bnb * (by.BNB?.price || 0)).toFixed(2)}), ${usdt} USDT`);
  const spare = Math.max(0, bnb - GAS_RESERVE_BNB);
  const spareUsd = spare * (by.BNB?.price || 0);
  if (spareUsd < MIN_ORDER_USD) { say(`nothing to convert: ${spare.toFixed(5)} BNB above the ${GAS_RESERVE_BNB} BNB reserve`); st.pot_usdt = usdt; writeState(st); process.exit(0); }
  const qty = Math.floor(spare * 1e5) / 1e5;
  say(`converting ${qty} BNB (≈ $${spareUsd.toFixed(2)}) into the USDT base, keeping ${GAS_RESERVE_BNB} BNB for gas`);
  const r = swap('BNB', 'USDT', qty, 'bootstrap: BNB into the USDT base');
  if (!r.dry) { st.pot_usdt = bal(balances(), 'USDT'); st.capital_usd = Math.max(st.capital_usd, st.pot_usdt); if (r.costPct != null) st.fees_measured.push({ at: now(), pair: 'BNB->USDT', cost_vs_quote_pct: r.costPct }); writeState(st); say(`pot now ${st.pot_usdt} USDT`); }
  process.exit(0);
}

// ---------------------------------------------------------------- tick
async function tick() {
  say(`tick ${now()}${CONFIRM ? '' : ' (dry)'}`);
  if (fs.existsSync(STOP)) { say('STOP file present — doing nothing'); log({ kind: 'stopped' }); return; }
  const w = baw(['wallet', 'status']);
  if (!w.success || w.data.status !== 'CONNECTED') { say('wallet not connected — sign in again (baw auth signin)'); log({ kind: 'not_connected' }); return; }
  const st = readState();
  if (!st) { say('no state — run --bootstrap --confirm first'); return; }
  // prices
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'trader-fetch.mjs'), '--hours', '400', '--out', LIVE], { stdio: 'ignore', timeout: 120000 });
  const prices = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  const picks = JSON.parse(fs.readFileSync(PICKS, 'utf8')).picks;
  const by = balances();
  // day roll
  const today = now().slice(0, 10);
  if (st.day.date !== today) st.day = { date: today, realised_usd: 0 };
  const dayCapped = st.day.realised_usd <= -(st.capital_usd * DAY_LOSS_CAP_PCT / 100);
  // reconcile: an open position whose token is gone from the wallet is gone
  if (st.position && bal(by, st.position.leg) < st.position.units * 0.5) {
    log({ kind: 'position_missing', position: st.position, wallet: bal(by, st.position.leg) });
    say(`position in ${st.position.leg} is not in the wallet any more — marking it closed by hand`);
    st.position = null;
  }
  st.pot_usdt = bal(by, 'USDT');
  const closesOf = (leg) => prices.series[leg].usd.map((x) => x[1]);
  const lines = [];
  // 1. exit?
  if (st.position) {
    const leg = st.position.leg, P = picks[leg];
    const s = signal(closesOf(leg), P, { position: { price: st.position.entry_price }, nowMs: Date.now(), entryMs: Date.parse(st.position.entry_at) });
    lines.push(`${leg}: ${s.action.toUpperCase()} — ${s.why}`);
    if (s.action === 'sell') {
      const qty = Math.min(bal(by, leg), st.position.units);
      const r = swap(leg, 'USDT', Math.floor(qty * 1e6) / 1e6, `exit ${leg}: ${s.why}`);
      if (!r.dry) {
        const net = r.received - st.position.spent_usd;
        st.realised_usd += net; st.day.realised_usd += net;
        if (net >= 0) st.profit_pool_usd += net; else if (st.profit_pool_usd + net >= 0) st.profit_pool_usd += net; else st.profit_pool_usd = 0;
        log({ kind: 'closed', leg, entry_price: st.position.entry_price, spent_usd: st.position.spent_usd, received_usd: r.received, net_usd: net, why: s.why, txHash: r.txHash });
        if (r.costPct != null) st.fees_measured.push({ at: now(), pair: `${leg}->USDT`, cost_vs_quote_pct: r.costPct });
        st.position = null; st.pot_usdt = bal(balances(), 'USDT');
      }
    }
  }
  // 2. entry?
  if (!st.position) {
    if (dayCapped) lines.push(`no entry: today's realised loss ${st.day.realised_usd.toFixed(2)} passed the ${DAY_LOSS_CAP_PCT}% cap`);
    else {
      let best = null;
      for (const leg of TRADING_LEGS) {
        const P = picks[leg]; if (!P) continue;
        const s = signal(closesOf(leg), P);
        lines.push(`${leg}: ${s.action.toUpperCase()} — ${s.why}`);
        if (s.action === 'buy' && (!best || s.z < best.z)) best = { leg, z: s.z, why: s.why };
      }
      const pot = Math.min(st.pot_usdt, st.capital_usd + st.profit_pool_usd * 0);   // the pot, never the operator's other USDT
      if (best && pot >= MIN_ORDER_USD) {
        const qty = Math.floor(pot * 100) / 100;
        const r = swap('USDT', best.leg, qty, `enter ${best.leg}: ${best.why}`);
        if (!r.dry) {
          st.position = { leg: best.leg, units: r.received, spent_usd: r.spent, entry_price: r.received > 0 ? r.spent / r.received : null, entry_at: now(), z: best.z };
          log({ kind: 'opened', ...st.position, txHash: r.txHash });
          if (r.costPct != null) st.fees_measured.push({ at: now(), pair: `USDT->${best.leg}`, cost_vs_quote_pct: r.costPct });
          st.pot_usdt = bal(balances(), 'USDT');
        }
      } else if (best) lines.push(`no entry: pot $${pot.toFixed(2)} is under the $${MIN_ORDER_USD} minimum`);
    }
  }
  // 3. the profit rule
  if (st.profit_pool_usd >= 1) {
    const bob = prices.series.BOBAI.usd.map((x) => x[1]);
    const zb = zScores(bob, Math.min(BOBAI_WINDOW, bob.length - 1));
    const z = zb[zb.length - 1];
    if (z != null && z <= -BOBAI_DIP_Z) {
      const toBobai = Math.floor(st.profit_pool_usd * PROFIT_TO_BOBAI_PCT / 100 * 100) / 100, toGrow = st.profit_pool_usd - toBobai;
      lines.push(`BOBAI dip (z ${z.toFixed(2)}): $${toBobai} of profit into BOBAI, $${toGrow.toFixed(2)} grows the pot`);
      if (toBobai >= 1) {
        const r = swap('USDT', 'BOBAI', toBobai, `profit rule: BOBAI dip z ${z.toFixed(2)}`);
        if (!r.dry) {
          st.bobai.units += r.received; st.bobai.spent_usd += r.spent; st.bobai.buys += 1;
          st.capital_usd += toGrow; st.profit_pool_usd = 0;
          log({ kind: 'bobai_bought', received: r.received, spent_usd: r.spent, grew_pot_usd: toGrow, txHash: r.txHash });
          st.pot_usdt = bal(balances(), 'USDT');
        }
      }
    } else lines.push(`profit pool $${st.profit_pool_usd.toFixed(2)} waits for a BOBAI dip (z ${z == null ? '—' : z.toFixed(2)}, needs ≤ −${BOBAI_DIP_Z})`);
  }
  st.last_tick = now();
  writeState(st);
  for (const l of lines) say('  ' + l);
  say(`  pot ${st.pot_usdt.toFixed(2)} USDT · position ${st.position ? `${st.position.leg} (${st.position.units} since ${st.position.entry_at.slice(0, 16)})` : 'none'} · pool $${st.profit_pool_usd.toFixed(2)} · BOBAI ${st.bobai.units} (${st.bobai.buys} buys, $${st.bobai.spent_usd.toFixed(2)}) · realised $${st.realised_usd.toFixed(2)}`);
  log({ kind: 'tick', dry: !CONFIRM, pot_usdt: st.pot_usdt, position: st.position, profit_pool_usd: st.profit_pool_usd, bobai: st.bobai, lines });
}

if (has('--tick')) { await tick().catch((e) => { say('tick failed: ' + e.message); log({ kind: 'tick_failed', error: e.message }); process.exitCode = 1; }); process.exit(); }

// THE WEEKLY REFIT. Parameters chosen once go stale; every Monday 00:20 UTC
// six months of prices are fetched again and the choice is redone by the
// same walk-forward (scripts/trader.mjs --backtest writes picks.json). An
// open position keeps its leg; only the thresholds it is judged by move.
function refit() {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'trader-fetch.mjs'), '--hours', '4320'], { stdio: 'ignore', timeout: 600000 });
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'trader.mjs'), '--backtest'], { encoding: 'utf8', timeout: 900000 });
    log({ kind: 'refit', summary: out.split(/\r?\n/).filter((l) => /pick:|last 40%|ROTATION on/.test(l)).map((l) => l.trim()).slice(0, 12) });
    say('refit done');
  } catch (e) { log({ kind: 'refit_failed', error: String(e.message).slice(0, 200) }); say('refit failed: ' + e.message); }
}

if (has('--refit')) { refit(); process.exit(); }

if (has('--loop')) {
  say(`loop: a tick every hour at :05${CONFIRM ? ', sending orders' : ' (dry)'}; a refit every Monday 00:20 UTC; STOP file at ${STOP} halts it`);
  const run = () => tick().catch((e) => { say('tick failed: ' + e.message); log({ kind: 'tick_failed', error: e.message }); });
  await run();
  setInterval(() => {
    const d = new Date(), m = d.getUTCMinutes();
    if (m === 5) run();
    if (d.getUTCDay() === 1 && d.getUTCHours() === 0 && m === 20) refit();
  }, 60000);
} else {
  say('node scripts/trader-live.mjs --tick [--confirm] | --bootstrap --confirm | --loop --confirm | --state');
}
