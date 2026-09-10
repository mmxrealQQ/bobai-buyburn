#!/usr/bin/env node
// THE TRADING AGENT, LIVE — the daily tick that keeps the pot at its target
// allocation through the Binance Agentic Wallet (`baw` CLI), and the loop that
// runs it. Since 2026-09-09 this is the SLOW MACHINE (docs/trading-agent.md):
// thirds of BNB, CAKE and BOB, rebalanced monthly, capital always invested,
// profit above the pot's own high-water mark half into $BOBAI on its dips.
// The hourly dip-trader it replaces is kept in trader.mjs as the measured
// alternative; its arithmetic still lives in shared/trader-core.js.
//
//   node scripts/trader-live.mjs --tick                 plan today, sign nothing
//   node scripts/trader-live.mjs --tick --confirm       plan and send
//   node scripts/trader-live.mjs --bootstrap --confirm  turn the wallet's BNB into USDT (keeps a gas reserve)
//   node scripts/trader-live.mjs --loop --confirm       a tick now, then daily at 04:00 UTC; a re-measure on the 1st, forever
//   node scripts/trader-live.mjs --state                what the agent holds and has done
//   node scripts/trader-live.mjs --remeasure            fetch six months and run the slow backtest again (reports, changes nothing)
//
// WHAT A TICK DOES, in order
//   1. wallet connected?  (baw wallet status) — otherwise it stops and says so
//   2. STOP file present? (data/trader/STOP)  — the operator's off switch
//   3. prices refreshed   (trader-fetch --hours 400 --out prices-live.json; BOBAI's dip needs 168 h)
//   4. balances read      (baw wallet balance) and reconciled with state.json
//   5. deposits           BNB above the reserve becomes USDT; USDT beyond what the
//                         agent counts as its own raises the capital and the high-water mark
//   6. gas                under the floor, a small USDT->BNB swap refills the reserve
//   7. the plan           shared/trader-core.js planRebalance: on the monthly day a full
//                         pass (band 20%, profit take first); on every other day a top-up
//                         pass that only invests cash that arrived
//   8. orders             sells first, then buys, one at a time; each polled to
//                         FINISHED/FAILED; what arrived is measured from the balance
//   9. the profit rule    the profit pool buys BOBAI at a BOBAI dip (never sold)
//  10. state + log + one daily report to the operator
//
// GUARDS
//   - never more than the cash there is in one buy; never below MIN_ORDER_USD;
//     never above MAX_ORDER_USD in one order (the rest waits for tomorrow)
//   - a BNB gas reserve is never traded
//   - a leg whose price cannot be read is not valued and not traded today
//   - a failed order is logged and the tick ends; nothing is retried blind
//
// State is the truth about what THIS agent holds; the wallet may hold more
// (the operator's own coins) and that is left alone.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TRADING_LEGS, zScores, planRebalance, profitTake, planReserve, ALLOCATION, REBALANCE_EVERY_DAYS, REBALANCE_BAND, DEFAULT_MIN_ORDER_USD, DEFAULT_MAX_ORDER_USD, RESERVE_TARGET_USD, RESERVE_DIP_PCT, RESERVE_MEAN_DAYS } from '../shared/trader-core.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'data', 'trader');
const STATE = path.join(DIR, 'state.json');
const LOG = path.join(DIR, 'log.jsonl');
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
const MIN_ORDER_USD = DEFAULT_MIN_ORDER_USD;
// No single order above this, whatever the pot: BOB's pool moves 0.3% at $500
// and 0.7% at $2,500 (scanner ladder, 2026-09-08). Money above the ceiling
// waits in USDT for tomorrow's pass.
const MAX_ORDER_USD = DEFAULT_MAX_ORDER_USD;
// Gas refills itself: under this much BNB, a small USDT->BNB swap tops the
// reserve back up, so a busy week never strands the agent without gas.
const GAS_FLOOR_BNB = 0.003;
const BOBAI_DIP_Z = 1, BOBAI_WINDOW = 168, PROFIT_TAKE_PCT = 50;
// 04:00 UTC since 2026-09-09: the operator wants the private card once a
// day at 04:00, and the card is the daily tick's own report (the LP card
// follows at 05:00 in the public channel, the whale recap at 06:00 inside).
const TICK_UTC = { hour: 4, minute: 0 };
const REMEASURE_UTC = { day: 1, hour: 1, minute: 0 };
// The Agentic Wallet's session is good for a year but only while it is used
// at least every 48 hours (Binance's rule, 2026-09-09). The daily tick is a
// use; if one tick fails the next is 24 h later, still inside the rule — but
// a second failure in a row would be 48 h and the session gone. So halfway
// between ticks the loop reads the wallet once more, orders nothing, and
// says so only when the wallet is no longer connected.
const KEEPALIVE_UTC = { hour: 12, minute: 20 };
// A deposit has to work within minutes, not at the next 00:20 (the operator,
// 2026-09-09: "such things have to happen within seconds or minutes"). Every
// DEPOSIT_WATCH_MIN the loop reads the balances — one wallet call — and when
// USDT beyond the record or BNB above the reserve is worth an order, it runs
// a tick at once; that tick takes the deposit in and invests it.
const DEPOSIT_WATCH_MIN = 10;
const POLL_MS = 5000, POLL_MAX_MS = 180000;

// An order the wallet accepted but whose end this tick could not see. The
// tick writes it into the state and ends; the next tick measures the wallet
// against the balances taken before the order and books what arrived. On
// 2026-09-09 the first buy of the slow machine went through on-chain while
// `market-order list --orderId` answered an empty list for three minutes —
// so the balance, not the order list, is what decides whether a swap is done.
class PendingOrder extends Error {
  constructor(p) { super(`order ${p.orderId} still pending after ${POLL_MAX_MS / 1000}s`); this.pending = p; }
}

const now = () => new Date().toISOString();

// TELEGRAM. The operator hears from the agent in a private chat with the
// project's bot (target 'operator' on the bot worker's /broadcast route; the
// bot learns that chat the first time the operator writes to it). The secret lives in this folder's .env,
// readable by the trader user only. No secret, no message — never a crash.
const ENV_FILE = path.join(ROOT, '.env');
const localEnv = (() => { try { return Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })); } catch { return {}; } })();
const TG_URL = localEnv.TG_BROADCAST_URL || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast';
async function notify(text) {
  const secret = localEnv.BROADCAST_SECRET;
  if (!secret) return false;
  try {
    const r = await fetch(TG_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-broadcast-secret': secret }, body: JSON.stringify({ text, target: 'operator', disablePreview: true }), signal: AbortSignal.timeout(15000) });
    return r.ok;
  } catch { return false; }
}
const money = (x, d = 2) => (x == null ? '—' : (x < 0 ? '−' : '') + '$' + Math.abs(Number(x)).toFixed(d));
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
const zeros = () => Object.fromEntries(TRADING_LEGS.map((l) => [l, 0]));
function freshState(capital) {
  return { mode: 'allocation', capital_usd: capital, pot_usdt: 0, units: zeros(), cost_usd: zeros(), high_water_usd: capital, last_rebalance_at: null, profit_pool_usd: 0, bobai: { units: 0, spent_usd: 0, buys: 0 }, realised_usd: 0, fees_measured: [], reserve_usd: 0, reserve_lot: null, started_at: now() };
}
// The state the hourly agent left (2026-09-08/09) becomes the slow machine's:
// its pot is the cash, an open position (there was none) would be the leg's
// units at what it cost, and the high-water mark starts at what it has now.
function migrate(st) {
  if (st.mode === 'allocation') {
    // The reserve fields arrived on 2026-09-10; an older state simply has none.
    if (st.reserve_usd == null) st.reserve_usd = 0;
    if (st.reserve_lot === undefined) st.reserve_lot = null;
    return st;
  }
  const out = { ...freshState(st.capital_usd), pot_usdt: st.pot_usdt, profit_pool_usd: st.profit_pool_usd || 0, bobai: st.bobai || { units: 0, spent_usd: 0, buys: 0 }, realised_usd: st.realised_usd || 0, fees_measured: st.fees_measured || [], started_at: st.started_at || now() };
  if (st.position && st.position.leg) { out.units[st.position.leg] = st.position.units; out.cost_usd[st.position.leg] = st.position.spent_usd; }
  out.high_water_usd = +(out.pot_usdt + TRADING_LEGS.reduce((s, l) => s + out.cost_usd[l], 0)).toFixed(2);
  out.migrated_at = now(); out.migrated_from = 'hourly';
  log({ kind: 'migrated', from: 'hourly', to: 'allocation', pot_usdt: out.pot_usdt, high_water_usd: out.high_water_usd });
  return out;
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
  let status = 'PENDING', txHash = null, after = null;
  const t0 = Date.now();
  while (Date.now() - t0 < POLL_MAX_MS) {
    // The order list, filtered and unfiltered (the filtered call has answered
    // an empty list for a live order); then the wallet itself.
    for (const args of [['market-order', 'list', '--orderId', String(orderId), '--binanceChainId', CHAIN], ['market-order', 'list', '--binanceChainId', CHAIN]]) {
      const l = baw(args);
      const row = l.success && l.data && Array.isArray(l.data.list) ? l.data.list.find((x) => String(x.orderId) === String(orderId)) : null;
      if (row) { status = row.status; txHash = row.txHash || txHash; break; }
    }
    if (status === 'FINISHED' || status === 'FAILED') break;
    after = balances();
    const arrived = bal(after, toSym) - bal(before, toSym);
    if (quoted && arrived >= quoted * 0.5) { status = 'FINISHED'; log({ kind: 'order_seen_in_balance', orderId, arrived }); break; }
    execFileSync(process.platform === 'win32' ? 'timeout' : 'sleep', process.platform === 'win32' ? ['/t', String(POLL_MS / 1000)] : [String(POLL_MS / 1000)], { stdio: 'ignore', shell: process.platform === 'win32' });
  }
  if (status === 'PENDING') {
    const p = { orderId, fromSym, toSym, qty, quoted, why, at: now(), before: { from: bal(before, fromSym), to: bal(before, toSym) } };
    log({ kind: 'order_pending', ...p });
    throw new PendingOrder(p);
  }
  if (status !== 'FINISHED') { log({ kind: 'order_failed', orderId, status, txHash, fromSym, toSym, qty }); throw new Error(`order ${orderId} ended ${status}`); }
  after = balances();
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
  say(JSON.stringify(migrate(st), null, 1));
  process.exit(0);
}

// ---------------------------------------------------------------- deposit watch
// True when the wallet holds money the record does not know about: USDT
// beyond the pot and the pool, or BNB above the gas reserve worth an order.
function depositWaiting() {
  const st = readState(); if (!st) return null;
  const w = baw(['wallet', 'status']);
  if (!w.success || w.data.status !== 'CONNECTED') return null;
  const by = balances();
  const usdt = bal(by, 'USDT'), known = st.pot_usdt + st.profit_pool_usd;
  if (usdt > known + MIN_ORDER_USD) return `${money(usdt - known)} USDT beyond the record`;
  // BNB the wallet holds beyond the BNB sleeve and the gas reserve — the
  // sleeve itself is not a deposit (2026-09-09 11:00–11:33: the watch counted
  // the sleeve, ran a tick every ten minutes, and every tick sent the card).
  const bnb = bal(by, 'BNB') - Number(st.units && st.units.BNB || 0) - GAS_RESERVE_BNB, px = by.BNB ? by.BNB.price : 0;
  if (px > 0 && bnb * px >= MIN_ORDER_USD) return `${bnb.toFixed(5)} BNB beyond the sleeve and the reserve`;
  return null;
}

// ---------------------------------------------------------------- keep-alive
// A wallet read between ticks so the session never sees 48 h of silence.
// Reads only: status, then the balances (a real use of the session, not a
// local file check). Never orders, never touches the state.
async function keepalive() {
  try {
    const w = baw(['wallet', 'status']);
    if (!w.success || w.data.status !== 'CONNECTED') {
      say('keep-alive: wallet not connected');
      log({ kind: 'keepalive', ok: false, connected: false });
      await notify('⚠️ <b>Trader: wallet not connected</b> — the session on the server has ended; sign in again with a QR code.');
      return false;
    }
    const by = balances();
    const n = Object.keys(by || {}).length;
    say(`keep-alive: wallet connected, ${n} balances read`);
    log({ kind: 'keepalive', ok: true, connected: true, balances: n });
    return true;
  } catch (e) {
    say('keep-alive failed: ' + e.message);
    log({ kind: 'keepalive', ok: false, error: String(e.message).slice(0, 200) });
    return false;
  }
}

// ---------------------------------------------------------------- bootstrap
if (has('--bootstrap')) {
  const st = migrate(readState() || freshState(Number(argOf('--capital') || 100)));
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


// The daily report, pure. Sorted largest sleeve first; a signed dollar
// figure carries its own arrow; blank lines separate the blocks, as /price does.
const LEG_MARK = { BNB: '🟡', CAKE: '🥞', BOB: '🔨' };
const signed = (x) => (x > 0 ? '▲ +' : x < 0 ? '▼ −' : '• ') + '$' + Math.abs(Number(x)).toFixed(2);
const pct = (x, of) => (of > 0 ? (x / of * 100).toFixed(1) + '%' : '—');
// THE CARD, AS A PORTFOLIO (the operator, 2026-09-09: "übersichtlicher mit
// pnl, holds, gewinn, verlust — wie ein portfolio"): what was put in, what it
// is worth, and per token its value, what it cost and the P&L in dollars and
// percent; then $BOBAI held, cash, realised and the total against the
// deposits; then what happened in the last 24 h. Pure.
export function formatDailyReport({ date, totalNow, capital, mark, vsCapital, vsMark, cash, valued, cost = {}, pool, bobai, bobaiMark, realised, done, nextPass, monthly, unpriced, reserve = null }) {
  // The dip reserve: cash that waits for a leg RESERVE_DIP_PCT under its
  // mean, or the lot it holds. Absent when the operator has not funded one.
  const reserveLine = !reserve || (!(reserve.usd > 0) && !reserve.lot) ? null
    : reserve.lot
      ? `🎯 Dip lot: <b>${LEG_MARK[reserve.lot.leg] || '•'} ${reserve.lot.leg} $${Number(reserve.lotValue ?? reserve.lot.cost_usd).toFixed(2)}</b>  ·  cost $${Number(reserve.lot.cost_usd).toFixed(2)}${reserve.lot.dip_pct != null ? `  ·  bought ${reserve.lot.dip_pct}% under the mean` : ''}  ·  sells at the ${RESERVE_MEAN_DAYS}-day mean`
      : `🎯 Dip reserve: <b>$${Number(reserve.usd).toFixed(2)}</b>  ·  waits for a leg ${RESERVE_DIP_PCT}% under its ${RESERVE_MEAN_DAYS}-day mean`;
  const rule = '';
  const legs = TRADING_LEGS.map((l) => ({ l, v: valued[l], c: Number(cost[l] || 0) })).sort((x, y) => (y.v ?? -1) - (x.v ?? -1));
  const pnl = (v, c) => (v == null ? null : v - c);
  const holdings = legs.map(({ l, v, c }) => v == null
    ? `${LEG_MARK[l] || '•'} ${l}: no price today  ·  cost $${c.toFixed(2)}`
    : `${LEG_MARK[l] || '•'} ${l}: <b>$${v.toFixed(2)}</b>  ·  cost $${c.toFixed(2)}  ·  ${signed(pnl(v, c))} (${pct(pnl(v, c), c)})`);
  const unrealised = legs.reduce((s, { v, c }) => s + (v == null ? 0 : v - c), 0);
  const bobaiPnl = Number(bobaiMark || 0) - Number(bobai.spent_usd || 0);
  const today = done.length ? done.map((d) => `• ${d}`).join('\n') : (monthly ? '• monthly pass: every sleeve inside its band, no order' : '• nothing to do — no deposit, no drift');
  return [
    `📊 <b>Trader · ${date}</b>${monthly ? '  ·  monthly pass' : ''}`,
    rule,
    `📥 <b>Deposits: $${Number(capital).toFixed(2)}</b>`,
    `💼 <b>Portfolio now: $${totalNow.toFixed(2)}</b>  ·  ${signed(vsCapital)} (${pct(vsCapital, capital)})`,
    `🏁 High-water mark: $${Number(mark).toFixed(2)}  ·  ${signed(vsMark)}${vsMark > 0 ? '  → half of it becomes $BOBAI at the next monthly pass' : ''}`,
    rule,
    `📊 <b>Holdings</b>  <i>(value · cost · P&L)</i>`,
    ...holdings,
    `💵 Cash: $${Number(cash).toFixed(2)}${pool >= 1 ? `  ·  of it profit pool $${Number(pool).toFixed(2)}` : ''}`,
    ...(reserveLine ? [reserveLine] : []),
    rule,
    `📈 <b>P&L</b>`,
    `📈 Unrealised on the holdings: ${signed(unrealised)}`,
    `✅ Realised since start: ${signed(realised)}`,
    `🧠 $BOBAI held: ${Math.round(bobai.units).toLocaleString('en-US')}  ·  paid $${Number(bobai.spent_usd).toFixed(2)}  ·  worth $${Number(bobaiMark).toFixed(2)}${bobai.units > 0 ? `  ·  ${signed(bobaiPnl)}` : ''}`,
    rule,
    `🧠 <b>BOBAI</b>`,
    `🧠 ${bobai.buys} buy${bobai.buys === 1 ? '' : 's'} so far  ·  half of every profit above the mark, bought on a BOBAI dip`,
    `💰 Profit pool: $${Number(pool).toFixed(2)}  ·  buys $BOBAI on its next dip, held in this wallet, never sold`,
    rule,
    `🔁 <b>Last 24 h</b>\n${today}`,
    `📅 Next monthly pass: <b>${nextPass}</b>${unpriced.length ? `\n⚠️ no price for ${unpriced.join(', ')} — not traded today` : ''}`,
  ].join('\n');
}

// What the log says happened in the last 24 h, in the card's words — the
// orders a deposit-watch tick sent at 10:54 belong on the 04:00 card too.
function recentDone(todayDone) {
  const out = [];
  try {
    const since = Date.now() - 86_400_000;
    const rows = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && Date.parse(r.at) >= since);
    for (const r of rows) {
      if (r.kind === 'bought' && r.leg) out.push(`bought ${money(r.spent_usd)} of ${r.leg}`);
      else if (r.kind === 'sold' && r.leg) out.push(`sold ${money(r.received_usd)} of ${r.leg} (${r.net_usd >= 0 ? '+' : ''}${money(r.net_usd)})`);
      else if (r.kind === 'capital_raised') out.push(`deposit taken in: ${money(r.to - r.from)} USDT`);
      else if (r.kind === 'deposit') out.push(`${r.bnb} BNB → ${money(r.usdt)} USDT (deposit)`);
      else if (r.kind === 'gas_refill') out.push(`${money(r.usdt)} USDT → gas`);
      else if (r.kind === 'profit_taken') out.push(`profit taken: ${money(r.moved)} to the pool`);
    }
  } catch { /* no log yet */ }
  return out.length ? [...new Set(out)] : todayDone;
}

// ---------------------------------------------------------------- tick
const daysSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : Infinity);
const r2 = (x) => Math.round(x * 100) / 100;

async function tick({ daily = false } = {}) {
  say(`tick ${now()}${CONFIRM ? '' : ' (dry)'}${daily ? ' (daily — with the card)' : ''}`);
  if (fs.existsSync(STOP)) { say('STOP file present — doing nothing'); log({ kind: 'stopped' }); return; }
  const w = baw(['wallet', 'status']);
  if (!w.success || w.data.status !== 'CONNECTED') { say('wallet not connected — sign in again (baw auth signin)'); log({ kind: 'not_connected' }); await notify('⚠️ <b>Trader: wallet not connected</b> — the session on the server has ended; sign in again with a QR code.'); return; }
  const st0 = readState();
  if (!st0) { say('no state — run --bootstrap --confirm first'); return; }
  const st = migrate(st0);
  // prices: the live file feeds BOBAI's dip test and is the fallback price
  // for a leg the wallet cannot price (BOB is small; its price comes from
  // its own pool, the same source the backtest used).
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'trader-fetch.mjs'), '--hours', '400', '--out', LIVE], { stdio: 'ignore', timeout: 120000 });
  const prices = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  const lastClose = (leg) => { const u = prices.series[leg]?.usd; return u && u.length ? Number(u[u.length - 1][1]) : null; };
  let by = balances();
  const priceOf = (leg) => (by[leg] && by[leg].price > 0 ? by[leg].price : lastClose(leg));
  const lines = [], done = [];
  // A pending order from the last tick: the wallet says what happened.
  if (st.pending) {
    const p = st.pending;
    const received = Math.max(0, bal(by, p.toSym) - p.before.to);
    const spent = Math.max(0, p.before.from - bal(by, p.fromSym));
    if (received > 0 && (!p.quoted || received >= p.quoted * 0.5)) {
      const forReserve = typeof p.why === 'string' && p.why.startsWith('reserve:');
      if (forReserve && p.fromSym === 'USDT' && TRADING_LEGS.includes(p.toSym)) { st.reserve_lot = { leg: p.toSym, units: received, cost_usd: r2(spent), at: p.at, dip_pct: null }; st.reserve_usd = r2(Math.max(0, st.reserve_usd - spent)); log({ kind: 'reserve_bought', leg: p.toSym, units: received, spent_usd: spent, why: 'pending order, booked from the balance', orderId: p.orderId }); done.push(`booked the pending dip lot: ${money(spent)} of ${p.toSym}`); }
      else if (forReserve && p.toSym === 'USDT' && st.reserve_lot && p.fromSym === st.reserve_lot.leg) { const basis = st.reserve_lot.cost_usd; st.reserve_usd = r2(st.reserve_usd + received); st.realised_usd = r2(st.realised_usd + received - basis); log({ kind: 'reserve_sold', leg: p.fromSym, units: spent, received_usd: received, basis_usd: basis, net_usd: r2(received - basis), why: 'pending order, booked from the balance', orderId: p.orderId }); st.reserve_lot = null; done.push(`booked the pending dip sale: ${money(received)} back to the reserve`); }
      else if (p.fromSym === 'USDT' && TRADING_LEGS.includes(p.toSym)) { st.units[p.toSym] += received; st.cost_usd[p.toSym] = r2(st.cost_usd[p.toSym] + spent); log({ kind: 'bought', leg: p.toSym, units: received, spent_usd: spent, price_usd: spent / received, why: 'rebalance (pending order, booked from the balance)', orderId: p.orderId }); done.push(`booked the pending buy: ${money(spent)} of ${p.toSym}`); }
      else if (p.toSym === 'USDT' && TRADING_LEGS.includes(p.fromSym)) { const share = st.units[p.fromSym] > 0 ? Math.min(1, spent / st.units[p.fromSym]) : 1; const basis = r2(st.cost_usd[p.fromSym] * share); st.units[p.fromSym] = Math.max(0, st.units[p.fromSym] - spent); st.cost_usd[p.fromSym] = r2(st.cost_usd[p.fromSym] - basis); st.realised_usd = r2(st.realised_usd + received - basis); log({ kind: 'sold', leg: p.fromSym, units: spent, received_usd: received, basis_usd: basis, net_usd: r2(received - basis), why: 'rebalance (pending order, booked from the balance)', orderId: p.orderId }); done.push(`booked the pending sale: ${money(received)} of ${p.fromSym}`); }
      else if (p.toSym === 'BOBAI') { st.bobai.units += received; st.bobai.spent_usd = r2(st.bobai.spent_usd + spent); st.bobai.buys += 1; st.profit_pool_usd = r2(Math.max(0, st.profit_pool_usd - spent)); log({ kind: 'bobai_bought', received, spent_usd: spent, why: 'pending order, booked from the balance', orderId: p.orderId }); done.push(`booked the pending BOBAI buy: ${money(spent)}`); }
      else log({ kind: 'pending_resolved', ...p, received, spent });
      lines.push(`pending order ${p.orderId} went through: ${spent} ${p.fromSym} became ${received} ${p.toSym}`);
    } else {
      log({ kind: 'pending_dropped', ...p, received, spent });
      lines.push(`pending order ${p.orderId} did not go through (nothing arrived) — dropped`);
    }
    delete st.pending;
  }
  // BNB is a sleeve AND the gas token. What the agent bought is st.units.BNB;
  // the rest of the wallet's BNB is the gas reserve and whatever the operator
  // sent. Every rule below about "spare" or "low" BNB is about that rest.
  const freeBnb = () => Math.max(0, bal(by, 'BNB') - st.units.BNB);
  // reconcile: coins the operator moved out are not the agent's any more;
  // coins he moved in are his and are left alone.
  for (const leg of TRADING_LEGS) {
    const have = bal(by, leg);
    if (have < st.units[leg] * 0.999) {
      log({ kind: 'units_missing', leg, state_units: st.units[leg], wallet: have });
      lines.push(`${leg}: the wallet holds ${have} of the ${st.units[leg]} on record — the record follows the wallet`);
      st.cost_usd[leg] = st.units[leg] > 0 ? r2(st.cost_usd[leg] * have / st.units[leg]) : 0;
      st.units[leg] = have;
    }
  }
  // DEPOSITS. The operator adds money by sending it to the wallet. BNB above
  // the gas reserve becomes USDT; USDT beyond what the agent counts as its
  // own (its cash and its profit pool) joins the pot and raises the capital
  // and the high-water mark — a deposit is never profit. Money is never
  // taken out by this code.
  const spareBnb = Math.max(0, freeBnb() - GAS_RESERVE_BNB);
  const spareUsd = spareBnb * (by.BNB ? by.BNB.price : 0);
  if (spareUsd >= MIN_ORDER_USD) {
    const qty = Math.floor(spareBnb * 1e5) / 1e5;
    lines.push(`deposit: ${qty} BNB (≈ $${spareUsd.toFixed(2)}) above the reserve becomes USDT`);
    const r = swap('BNB', 'USDT', qty, 'deposit: BNB above the reserve into USDT');
    if (!r.dry) { log({ kind: 'deposit', bnb: qty, usdt: r.received, txHash: r.txHash }); done.push(`${qty} BNB → ${money(r.received)} USDT (deposit)`); by = balances(); }
  }
  // Gas: refill from the cash when the reserve runs low (a swap's gas is
  // paid in BNB, not from the order).
  if (freeBnb() < GAS_FLOOR_BNB && bal(by, 'USDT') >= MIN_ORDER_USD) {
    const wantBnb = GAS_RESERVE_BNB - freeBnb();
    const usdtForGas = Math.max(MIN_ORDER_USD, Math.ceil(wantBnb * (by.BNB ? by.BNB.price : 750) * 100) / 100);
    lines.push(`gas: ${freeBnb().toFixed(5)} BNB outside the sleeve is under the ${GAS_FLOOR_BNB} floor — ${money(usdtForGas)} USDT becomes BNB`);
    const r = swap('USDT', 'BNB', usdtForGas, 'gas refill');
    if (!r.dry) { log({ kind: 'gas_refill', usdt: usdtForGas, bnb: r.received, txHash: r.txHash }); done.push(`${money(usdtForGas)} USDT → gas`); by = balances(); }
  }
  // Cash: all USDT in the wallet is the agent's — its pot or its profit pool.
  const known = st.pot_usdt + st.profit_pool_usd;
  const usdtNow = bal(by, 'USDT');
  if (usdtNow > known + 1) {
    const add = r2(usdtNow - known);
    // The dip reserve fills first, up to its target; the rest joins the thirds.
    const toReserve = r2(Math.min(add, Math.max(0, RESERVE_TARGET_USD - st.reserve_usd - (st.reserve_lot ? st.reserve_lot.cost_usd : 0))));
    lines.push(`deposit: ${money(add)} USDT beyond the record joins the pot${toReserve > 0 ? ` — ${money(toReserve)} of it fills the dip reserve` : ''}`);
    log({ kind: 'capital_raised', from: st.capital_usd, to: r2(st.capital_usd + add), high_water_from: st.high_water_usd, high_water_to: r2(st.high_water_usd + add), to_reserve: toReserve });
    st.capital_usd = r2(st.capital_usd + add); st.high_water_usd = r2(st.high_water_usd + add);
    st.reserve_usd = r2(st.reserve_usd + toReserve);
    if (CONFIRM) await notify(`💰 <b>Trader: deposit taken in</b> — ${money(add)} USDT${toReserve > 0 ? `; ${money(toReserve)} of it is the dip reserve (buys a leg ${RESERVE_DIP_PCT}% under its ${RESERVE_MEAN_DAYS}-day mean, sells at the mean)${add - toReserve > 0.01 ? `, ${money(r2(add - toReserve))} joins the thirds` : ''}` : ' joins the thirds'}; capital on record ${money(st.capital_usd)}.`);
  }
  st.pot_usdt = r2(Math.max(0, usdtNow - st.profit_pool_usd));
  // The reserve is cash the thirds never see: it is not in their holdings.
  // It cannot exceed the cash there is (a sale that did not arrive, say).
  st.reserve_usd = r2(Math.min(st.reserve_usd, st.pot_usdt));
  // Valuation. A leg without a price is not valued and not traded today.
  const holdings = { USDT: r2(Math.max(0, st.pot_usdt - st.reserve_usd)) };
  const unpriced = [];
  for (const leg of TRADING_LEGS) { const p = priceOf(leg); if (p > 0) holdings[leg] = r2(st.units[leg] * p); else { holdings[leg] = 0; if (st.units[leg] > 0) unpriced.push(leg); } }
  // The reserve's worth (cash, or its open lot at today's price) counts
  // towards the pot against the high-water mark — a deposit raised the mark.
  const reserveWorth = r2(st.reserve_usd + (st.reserve_lot && priceOf(st.reserve_lot.leg) > 0 ? st.reserve_lot.units * priceOf(st.reserve_lot.leg) : (st.reserve_lot ? st.reserve_lot.cost_usd : 0)));
  const total = r2(Object.values(holdings).reduce((a, b) => a + b, 0) + reserveWorth);
  // THE PLAN. Monthly: the full pass — profit take first, then every sleeve
  // back inside its band. Any other day: a top-up pass that invests cash
  // that arrived (a deposit, a sale's leftover) and sells nothing.
  const monthly = daysSince(st.last_rebalance_at) >= REBALANCE_EVERY_DAYS;
  let plan, take = { take: 0, excess: 0, high_water_after: st.high_water_usd };
  if (unpriced.length) {
    lines.push(`no orders today: no price for ${unpriced.join(', ')}`);
    plan = { orders: [], skipped: [] };
  } else if (monthly) {
    take = profitTake(total, st.high_water_usd, PROFIT_TAKE_PCT);
    plan = planRebalance(holdings, ALLOCATION, { band: REBALANCE_BAND, minOrderUsd: MIN_ORDER_USD, maxOrderUsd: MAX_ORDER_USD, takeUsd: take.take });
    lines.push(`monthly pass: pot ${money(total)} against a high-water mark of ${money(st.high_water_usd)}${take.take > 0 ? ` — ${money(take.excess)} above it, ${money(take.take)} taken for the profit pool` : ' — nothing above it, nothing taken'}`);
  } else {
    plan = planRebalance(holdings, ALLOCATION, { band: 0, minOrderUsd: MIN_ORDER_USD, maxOrderUsd: MAX_ORDER_USD, sells: false });
    if (plan.orders.length) lines.push(`top-up pass: ${money(holdings.USDT)} of cash goes into the sleeves under their target`);
    // Cash under the minimum order cannot buy anything and would sit until
    // the next deposit ($8.09 on 2026-09-10). It joins the dip reserve
    // instead: no swap, just the record — the reserve is USDT already, and
    // a lot is the whole reserve, so the cash works on the next dip. The
    // target only governs how a deposit is split; the reserve may hold more.
    const idle = r2(holdings.USDT);
    if (!plan.orders.length && idle > 0 && idle < MIN_ORDER_USD) {
      st.reserve_usd = r2(st.reserve_usd + idle); holdings.USDT = 0;
      log({ kind: 'reserve_topped_from_idle', usd: idle, reserve_usd: st.reserve_usd });
      lines.push(`idle cash: ${money(idle)} is under the $${MIN_ORDER_USD} minimum — it joins the dip reserve (now ${money(st.reserve_usd)})`);
      done.push(`${money(idle)} of idle cash joined the dip reserve`);
    }
  }
  for (const sk of plan.skipped) lines.push(`${sk.leg}: left alone — ${sk.why}`);
  // ORDERS. Sells first (the plan is sorted so), each measured, each written
  // down. A refused or failed order throws: the tick ends and says so.
  let orders = 0;
  try {
  for (const o of plan.orders) {
    const px = priceOf(o.leg);
    if (o.side === 'sell') {
      const qty = Math.min(st.units[o.leg], Math.floor((o.usd / px) * 1e6) / 1e6);
      if (qty <= 0) continue;
      const r = swap(o.leg, 'USDT', qty, `${monthly ? 'monthly' : 'top-up'}: ${o.leg} ${money(o.have_usd)} is above its ${money(o.target_usd)} target`);
      if (r.dry) continue;
      const share = st.units[o.leg] > 0 ? qty / st.units[o.leg] : 1;
      const basis = r2(st.cost_usd[o.leg] * share);
      const net = r2(r.received - basis);
      st.units[o.leg] = Math.max(0, st.units[o.leg] - r.spent); st.cost_usd[o.leg] = r2(st.cost_usd[o.leg] - basis);
      st.realised_usd = r2(st.realised_usd + net);
      if (r.costPct != null) st.fees_measured.push({ at: now(), pair: `${o.leg}->USDT`, cost_vs_quote_pct: r.costPct });
      log({ kind: 'sold', leg: o.leg, units: r.spent, received_usd: r.received, basis_usd: basis, net_usd: net, why: 'rebalance', txHash: r.txHash });
      done.push(`sold ${money(r.received)} of ${o.leg} (${net >= 0 ? '+' : ''}${money(net)} against what it cost)`);
      orders++;
    } else {
      const usd = Math.floor(o.usd * 100) / 100;
      const r = swap('USDT', o.leg, usd, `${monthly ? 'monthly' : 'top-up'}: ${o.leg} ${money(o.have_usd)} is under its ${money(o.target_usd)} target`);
      if (r.dry) continue;
      st.units[o.leg] = st.units[o.leg] + r.received; st.cost_usd[o.leg] = r2(st.cost_usd[o.leg] + r.spent);
      if (r.costPct != null) st.fees_measured.push({ at: now(), pair: `USDT->${o.leg}`, cost_vs_quote_pct: r.costPct });
      log({ kind: 'bought', leg: o.leg, units: r.received, spent_usd: r.spent, price_usd: r.received > 0 ? r.spent / r.received : null, why: 'rebalance', txHash: r.txHash });
      done.push(`bought ${money(r.spent)} of ${o.leg}`);
      orders++;
    }
  }
  } catch (e) {
    if (e instanceof PendingOrder) { st.pending = e.pending; st.last_tick = now(); writeState(st); await notify(`⏳ <b>Trader: an order is still pending</b> — ${e.pending.qty} ${e.pending.fromSym} → ${e.pending.toSym} (${e.pending.orderId}). The next tick books what arrived.`); }
    throw e;
  }
  if (CONFIRM) { by = balances(); st.pot_usdt = r2(Math.max(0, bal(by, 'USDT') - st.profit_pool_usd)); }
  if (monthly && CONFIRM && !unpriced.length) {
    // The take is cash now: it moves from the pot to the pool, and the mark
    // moves to the pot after the take. Without a take the mark holds.
    if (take.take > 0) {
      const moved = Math.min(take.take, st.pot_usdt);
      st.profit_pool_usd = r2(st.profit_pool_usd + moved); st.pot_usdt = r2(st.pot_usdt - moved);
      log({ kind: 'profit_taken', excess_usd: take.excess, taken_usd: moved, high_water_from: st.high_water_usd, high_water_to: take.high_water_after });
      await notify(`🏁 <b>Trader: profit taken</b> — the pot stood ${money(take.excess)} above its high-water mark; ${money(moved)} moved to the profit pool (it buys $BOBAI on the next dip), the rest stays and compounds. New mark ${money(take.high_water_after)}.`);
    }
    st.high_water_usd = take.high_water_after;
    st.last_rebalance_at = now();
  } else if (monthly && !CONFIRM) lines.push('(dry: the monthly pass is not written down)');
  // THE DIP RESERVE. Daily closes (the hour stamped 00:00 UTC) of the live
  // series, the last RESERVE_MEAN_DAYS + 1 per leg — the same closes the
  // measurement used. One order at most: the whole reserve into the leg
  // furthest under its mean by RESERVE_DIP_PCT, or the open lot back to USDT
  // at the mean. A lot's gain or loss stays in the reserve; a deposit refills
  // it up to the target.
  if (!unpriced.length && (st.reserve_usd >= MIN_ORDER_USD || st.reserve_lot)) {
    const closesByLeg = {};
    for (const leg of TRADING_LEGS) closesByLeg[leg] = (prices.series[leg]?.usd || []).filter(([ts]) => ts % 86_400_000 === 0).slice(-(RESERVE_MEAN_DAYS + 1)).map(([, px]) => Number(px));
    const rp = planReserve({ reserveUsd: st.reserve_usd, lot: st.reserve_lot, closesByLeg, dipPct: RESERVE_DIP_PCT, meanDays: RESERVE_MEAN_DAYS, minOrderUsd: MIN_ORDER_USD });
    lines.push(`reserve: ${rp.why}`);
    try {
      if (rp.action === 'buy') {
        const r = swap('USDT', rp.leg, rp.usd, `reserve: ${rp.why}`);
        if (!r.dry) {
          st.reserve_lot = { leg: rp.leg, units: r.received, cost_usd: r2(r.spent), at: now(), dip_pct: rp.dip_pct };
          st.reserve_usd = r2(Math.max(0, st.reserve_usd - r.spent));
          if (r.costPct != null) st.fees_measured.push({ at: now(), pair: `USDT->${rp.leg}`, cost_vs_quote_pct: r.costPct });
          log({ kind: 'reserve_bought', leg: rp.leg, units: r.received, spent_usd: r.spent, dip_pct: rp.dip_pct, txHash: r.txHash });
          done.push(`dip lot: ${money(r.spent)} of ${rp.leg} bought ${rp.dip_pct}% under its ${RESERVE_MEAN_DAYS}-day mean`);
          await notify(`🎯 <b>Trader: the reserve bought a dip</b> — ${money(r.spent)} of ${rp.leg}, ${rp.dip_pct}% under its ${RESERVE_MEAN_DAYS}-day mean. It goes back to USDT at the first daily close at or above the mean. <a href="https://bscscan.com/tx/${r.txHash}">tx</a>`);
          orders++;
        }
      } else if (rp.action === 'sell') {
        const qty = Math.min(bal(by, rp.leg), Math.floor(st.reserve_lot.units * 1e6) / 1e6);
        const r = swap(rp.leg, 'USDT', qty, `reserve: ${rp.why}`);
        if (!r.dry) {
          const basis = st.reserve_lot.cost_usd, net = r2(r.received - basis);
          st.reserve_usd = r2(st.reserve_usd + r.received); st.realised_usd = r2(st.realised_usd + net);
          if (r.costPct != null) st.fees_measured.push({ at: now(), pair: `${rp.leg}->USDT`, cost_vs_quote_pct: r.costPct });
          log({ kind: 'reserve_sold', leg: rp.leg, units: r.spent, received_usd: r.received, basis_usd: basis, net_usd: net, held_since: st.reserve_lot.at, txHash: r.txHash });
          done.push(`dip lot sold: ${money(r.received)} of ${rp.leg} back to the reserve (${net >= 0 ? '+' : ''}${money(net)})`);
          await notify(`🎯 <b>Trader: the dip lot is back in USDT</b> — ${rp.leg} closed at its ${RESERVE_MEAN_DAYS}-day mean; ${money(r.received)} back in the reserve, ${net >= 0 ? '+' : ''}${money(net)} against what it cost. <a href="https://bscscan.com/tx/${r.txHash}">tx</a>`);
          st.reserve_lot = null;
          orders++;
        }
      }
    } catch (e) {
      if (e instanceof PendingOrder) { st.pending = e.pending; st.last_tick = now(); writeState(st); await notify(`⏳ <b>Trader: a reserve order is still pending</b> — ${e.pending.qty} ${e.pending.fromSym} → ${e.pending.toSym} (${e.pending.orderId}). The next tick books what arrived.`); }
      throw e;
    }
    if (CONFIRM) { by = balances(); st.pot_usdt = r2(Math.max(0, bal(by, 'USDT') - st.profit_pool_usd)); }
  } else if (st.reserve_usd > 0) lines.push(`reserve: $${st.reserve_usd.toFixed(2)} waits — under the $${MIN_ORDER_USD} minimum until the next deposit`);
  // THE PROFIT RULE. The pool waits in USDT and buys BOBAI when BOBAI itself
  // dips (z ≤ −1 over 168 h). Bought, held, never sold.
  if (st.profit_pool_usd >= 1) {
    const bob = prices.series.BOBAI.usd.map((x) => x[1]);
    const zb = zScores(bob, Math.min(BOBAI_WINDOW, bob.length - 1));
    const z = zb[zb.length - 1];
    if (z != null && z <= -BOBAI_DIP_Z) {
      const toBobai = Math.floor(st.profit_pool_usd * 100) / 100;
      lines.push(`BOBAI dip (z ${z.toFixed(2)}): the pool's ${money(toBobai)} buys BOBAI`);
      if (toBobai >= 1) {
        const r = swap('USDT', 'BOBAI', toBobai, `profit rule: BOBAI dip z ${z.toFixed(2)}`);
        if (!r.dry) {
          st.bobai.units += r.received; st.bobai.spent_usd = r2(st.bobai.spent_usd + r.spent); st.bobai.buys += 1;
          st.profit_pool_usd = r2(Math.max(0, st.profit_pool_usd - r.spent));
          log({ kind: 'bobai_bought', received: r.received, spent_usd: r.spent, txHash: r.txHash });
          await notify(`🧠 <b>Trader: profit into $BOBAI</b> — ${money(r.spent)} bought ${Math.round(r.received).toLocaleString('en-US')} BOBAI on a dip (z ${z.toFixed(2)}). Held, never sold. <a href="https://bscscan.com/tx/${r.txHash}">tx</a>`);
          by = balances(); st.pot_usdt = r2(Math.max(0, bal(by, 'USDT') - st.profit_pool_usd));
        }
      }
    } else lines.push(`profit pool ${money(st.profit_pool_usd)} waits for a BOBAI dip (z ${z == null ? '—' : z.toFixed(2)}, needs ≤ −${BOBAI_DIP_Z})`);
  }
  st.last_tick = now();
  writeState(st);
  // THE DAILY REPORT — the operator asked for it sorted, with lines and
  // emojis, the essentials only (2026-09-09): what the pot is worth against
  // what went in and against the mark, the sleeves largest first, BOBAI and
  // the pool, what was done today, when the next monthly pass is. The
  // reasoning lines stay in the log and on the console.
  const valued = {}; let totalNow = st.pot_usdt;
  for (const leg of TRADING_LEGS) { const p = priceOf(leg); valued[leg] = p > 0 ? r2(st.units[leg] * p) : null; totalNow += valued[leg] || 0; }
  // The open dip lot is not in the pot's cash nor in the thirds' units.
  const lotValue = st.reserve_lot ? (priceOf(st.reserve_lot.leg) > 0 ? r2(st.reserve_lot.units * priceOf(st.reserve_lot.leg)) : st.reserve_lot.cost_usd) : 0;
  totalNow = r2(totalNow + lotValue);
  const reserve = { usd: st.reserve_usd, lot: st.reserve_lot, lotValue };
  const bobaiMark = by.BOBAI ? by.BOBAI.value : 0;
  const nextPass = st.last_rebalance_at ? new Date(Date.parse(st.last_rebalance_at) + REBALANCE_EVERY_DAYS * 86_400_000).toISOString().slice(0, 10) : 'today';
  const vsCapital = r2(totalNow - st.capital_usd), vsMark = r2(totalNow - st.high_water_usd);
  const legLine = TRADING_LEGS.map((l) => `${l} ${valued[l] == null ? '(no price)' : money(valued[l])}`).join(' · ');
  const report = formatDailyReport({ date: now().slice(0, 10), totalNow, capital: st.capital_usd, mark: st.high_water_usd, vsCapital, vsMark, cash: st.pot_usdt, valued, cost: st.cost_usd, pool: st.profit_pool_usd, bobai: st.bobai, bobaiMark, realised: st.realised_usd, done: recentDone(done), nextPass, monthly, unpriced, reserve });
  // The card goes out with the daily tick only. A deposit-watch tick and a
  // restart tick log the same lines and say nothing in the chat; their
  // orders are announced as events when they happen.
  if (CONFIRM && daily) await notify(report);
  for (const l of lines) say('  ' + l);
  say(`  ${legLine} · cash ${st.pot_usdt.toFixed(2)} · pot ${totalNow.toFixed(2)} vs ${st.capital_usd.toFixed(2)} in, mark ${st.high_water_usd.toFixed(2)} · pool ${st.profit_pool_usd.toFixed(2)} · BOBAI ${st.bobai.units} · orders today ${orders} · next monthly pass ${nextPass}`);
  log({ kind: 'tick', dry: !CONFIRM, monthly, pot_usdt: st.pot_usdt, units: st.units, valued, total_usd: totalNow, capital_usd: st.capital_usd, high_water_usd: st.high_water_usd, profit_pool_usd: st.profit_pool_usd, reserve_usd: st.reserve_usd, reserve_lot: st.reserve_lot, bobai: st.bobai, orders, lines });
}

if (has('--notify-test')) { const ok = await notify('✅ Trader on the server can reach this chat. Reports: every order as it happens, a summary daily at 04:00 UTC.'); say(ok ? 'sent' : 'not sent (no secret, or the route refused)'); process.exit(ok ? 0 : 1); }

if (has('--tick')) { await tick().catch(async (e) => { say('tick failed: ' + e.message); log({ kind: 'tick_failed', error: e.message }); await notify('⚠️ <b>Trader: tick failed</b> — ' + String(e.message).slice(0, 200)); process.exitCode = 1; }); process.exit(); }

// THE MONTHLY RE-MEASURE. The allocation was chosen by evidence; evidence
// ages. On the 1st of each month six months of prices are fetched again and
// scripts/trader-slow.mjs is run on the pot's size. It CHANGES NOTHING — the
// allocation is the operator's decision — it reports whether thirds/monthly
// is still the pick and what the alternatives would have earned.
async function remeasure() {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'trader-fetch.mjs'), '--hours', '4320'], { stdio: 'ignore', timeout: 600000 });
    const st = readState();
    const cap = st ? Math.max(100, Math.round(st.capital_usd)) : 100;
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'trader-slow.mjs'), '--capital', String(cap)], { encoding: 'utf8', timeout: 900000 });
    const keep = out.split(/\r?\n/).filter((l) => /chosen on the first|on the unseen 40%|buy once and hold, same|costs and gas × 1.5|other split points/.test(l)).map((l) => l.trim());
    log({ kind: 'remeasure', capital_usd: cap, summary: keep });
    say('re-measure done'); for (const l of keep) say('  ' + l);
    if (CONFIRM) await notify(`📐 <b>Trader: monthly re-measure</b> (six months, pot $${cap})\n${keep.map((l) => '· ' + l).join('\n')}\nLive stays thirds BNB/CAKE/BOB, monthly — a change is the operator's call.`);
  } catch (e) { log({ kind: 'remeasure_failed', error: String(e.message).slice(0, 200) }); say('re-measure failed: ' + e.message); }
}

if (has('--remeasure') || has('--refit')) { await remeasure(); process.exit(); }
if (has('--keepalive')) { const ok = await keepalive(); process.exit(ok ? 0 : 1); }

if (has('--loop')) {
  say(`loop: a tick now, then daily at ${String(TICK_UTC.hour).padStart(2, '0')}:${String(TICK_UTC.minute).padStart(2, '0')} UTC${CONFIRM ? ', sending orders' : ' (dry)'}; a wallet keep-alive at ${String(KEEPALIVE_UTC.hour).padStart(2, '0')}:${String(KEEPALIVE_UTC.minute).padStart(2, '0')} UTC (reads only); a deposit watch every ${DEPOSIT_WATCH_MIN} min; a re-measure on the ${REMEASURE_UTC.day}st at ${String(REMEASURE_UTC.hour).padStart(2, '0')}:${String(REMEASURE_UTC.minute).padStart(2, '0')} UTC; STOP file at ${STOP} halts it`);
  const run = (daily = false) => tick({ daily }).catch(async (e) => { say('tick failed: ' + e.message); log({ kind: 'tick_failed', error: e.message }); await notify('⚠️ <b>Trader: tick failed</b> — ' + String(e.message).slice(0, 200)); });
  await run(false);
  setInterval(() => {
    const d = new Date(), h = d.getUTCHours(), m = d.getUTCMinutes();
    if (h === TICK_UTC.hour && m === TICK_UTC.minute) run(true);
    if (h === KEEPALIVE_UTC.hour && m === KEEPALIVE_UTC.minute) keepalive();
    if (m % DEPOSIT_WATCH_MIN === 0 && !(h === TICK_UTC.hour && m === TICK_UTC.minute)) {
      try { const found = depositWaiting(); if (found) { say(`deposit watch: ${found} — running a tick now`); log({ kind: 'deposit_seen', what: found }); run(); } }
      catch (e) { say('deposit watch failed: ' + e.message); log({ kind: 'deposit_watch_failed', error: String(e.message).slice(0, 200) }); }
    }
    if (d.getUTCDate() === REMEASURE_UTC.day && h === REMEASURE_UTC.hour && m === REMEASURE_UTC.minute) remeasure();
  }, 60000);
} else {
  say('node scripts/trader-live.mjs --tick [--confirm] | --bootstrap --confirm | --loop --confirm | --state | --remeasure | --keepalive');
}
