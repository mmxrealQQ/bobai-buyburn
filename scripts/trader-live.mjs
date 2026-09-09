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
//   node scripts/trader-live.mjs --loop --confirm       a tick now, then daily at 00:20 UTC; a re-measure on the 1st, forever
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
import { TRADING_LEGS, zScores, planRebalance, profitTake, ALLOCATION, REBALANCE_EVERY_DAYS, REBALANCE_BAND, DEFAULT_MIN_ORDER_USD, DEFAULT_MAX_ORDER_USD } from '../shared/trader-core.js';

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
const TICK_UTC = { hour: 0, minute: 20 };      // after the 00:00 UTC close the backtest used
const REMEASURE_UTC = { day: 1, hour: 1, minute: 0 };
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
  return { mode: 'allocation', capital_usd: capital, pot_usdt: 0, units: zeros(), cost_usd: zeros(), high_water_usd: capital, last_rebalance_at: null, profit_pool_usd: 0, bobai: { units: 0, spent_usd: 0, buys: 0 }, realised_usd: 0, fees_measured: [], started_at: now() };
}
// The state the hourly agent left (2026-09-08/09) becomes the slow machine's:
// its pot is the cash, an open position (there was none) would be the leg's
// units at what it cost, and the high-water mark starts at what it has now.
function migrate(st) {
  if (st.mode === 'allocation') return st;
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
export function formatDailyReport({ date, totalNow, capital, mark, vsCapital, vsMark, cash, valued, pool, bobai, bobaiMark, realised, done, nextPass, monthly, unpriced }) {
  const rule = '';
  const legs = TRADING_LEGS.map((l) => ({ l, v: valued[l] })).sort((x, y) => (y.v ?? -1) - (x.v ?? -1));
  const sleeves = legs.map(({ l, v }) => `${LEG_MARK[l] || '•'} ${l}: ${v == null ? 'no price today' : `$${v.toFixed(2)}  ·  ${pct(v, totalNow)}`}`);
  sleeves.push(`💵 Cash: $${Number(cash).toFixed(2)}${pool >= 1 ? `  ·  of it profit pool $${Number(pool).toFixed(2)}` : ''}`);
  const today = done.length ? done.map((d) => `• ${d}`).join('\n') : (monthly ? '• monthly pass: every sleeve inside its band, no order' : '• no order — nothing to do');
  return [
    `📊 <b>Trader · ${date}</b>${monthly ? '  ·  monthly pass' : ''}`,
    rule,
    `💼 <b>Pot: $${totalNow.toFixed(2)}</b>`,
    `📥 Put in: $${Number(capital).toFixed(2)}  ·  ${signed(vsCapital)} (${pct(vsCapital, capital)})`,
    `🏁 Mark: $${Number(mark).toFixed(2)}  ·  ${signed(vsMark)}${vsMark > 0 ? '  → half is taken at the next monthly pass' : ''}`,
    rule,
    `📊 <b>Sleeves</b>`,
    ...sleeves,
    rule,
    `🧠 <b>BOBAI</b>`,
    `🧠 Held: ${Math.round(bobai.units).toLocaleString('en-US')}  ·  ${bobai.buys} buy${bobai.buys === 1 ? '' : 's'}, $${Number(bobai.spent_usd).toFixed(2)} paid, worth $${Number(bobaiMark).toFixed(2)}`,
    `💰 Profit pool: $${Number(pool).toFixed(2)}  ·  buys BOBAI on its next dip`,
    `📈 Realised since start: ${signed(realised)}`,
    rule,
    `🔁 <b>Today</b>\n${today}`,
    `📅 Next monthly pass: <b>${nextPass}</b>${unpriced.length ? `\n⚠️ no price for ${unpriced.join(', ')} — not traded today` : ''}`,
  ].join('\n');
}

// ---------------------------------------------------------------- tick
const daysSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : Infinity);
const r2 = (x) => Math.round(x * 100) / 100;

async function tick() {
  say(`tick ${now()}${CONFIRM ? '' : ' (dry)'}`);
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
      if (p.fromSym === 'USDT' && TRADING_LEGS.includes(p.toSym)) { st.units[p.toSym] += received; st.cost_usd[p.toSym] = r2(st.cost_usd[p.toSym] + spent); log({ kind: 'bought', leg: p.toSym, units: received, spent_usd: spent, price_usd: spent / received, why: 'rebalance (pending order, booked from the balance)', orderId: p.orderId }); done.push(`booked the pending buy: ${money(spent)} of ${p.toSym}`); }
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
    lines.push(`deposit: ${money(add)} USDT beyond the record joins the pot`);
    log({ kind: 'capital_raised', from: st.capital_usd, to: r2(st.capital_usd + add), high_water_from: st.high_water_usd, high_water_to: r2(st.high_water_usd + add) });
    st.capital_usd = r2(st.capital_usd + add); st.high_water_usd = r2(st.high_water_usd + add);
    if (CONFIRM) await notify(`💰 <b>Trader: deposit taken in</b> — ${money(add)} USDT joins the pot; capital on record ${money(st.capital_usd)}.`);
  }
  st.pot_usdt = r2(Math.max(0, usdtNow - st.profit_pool_usd));
  // Valuation. A leg without a price is not valued and not traded today.
  const holdings = { USDT: st.pot_usdt };
  const unpriced = [];
  for (const leg of TRADING_LEGS) { const p = priceOf(leg); if (p > 0) holdings[leg] = r2(st.units[leg] * p); else { holdings[leg] = 0; if (st.units[leg] > 0) unpriced.push(leg); } }
  const total = r2(Object.values(holdings).reduce((a, b) => a + b, 0));
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
    if (plan.orders.length) lines.push(`top-up pass: ${money(st.pot_usdt)} of cash goes into the sleeves under their target`);
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
  totalNow = r2(totalNow);
  const bobaiMark = by.BOBAI ? by.BOBAI.value : 0;
  const nextPass = st.last_rebalance_at ? new Date(Date.parse(st.last_rebalance_at) + REBALANCE_EVERY_DAYS * 86_400_000).toISOString().slice(0, 10) : 'today';
  const vsCapital = r2(totalNow - st.capital_usd), vsMark = r2(totalNow - st.high_water_usd);
  const legLine = TRADING_LEGS.map((l) => `${l} ${valued[l] == null ? '(no price)' : money(valued[l])}`).join(' · ');
  const report = formatDailyReport({ date: now().slice(0, 10), totalNow, capital: st.capital_usd, mark: st.high_water_usd, vsCapital, vsMark, cash: st.pot_usdt, valued, pool: st.profit_pool_usd, bobai: st.bobai, bobaiMark, realised: st.realised_usd, done, nextPass, monthly, unpriced });
  if (CONFIRM) await notify(report);
  for (const l of lines) say('  ' + l);
  say(`  ${legLine} · cash ${st.pot_usdt.toFixed(2)} · pot ${totalNow.toFixed(2)} vs ${st.capital_usd.toFixed(2)} in, mark ${st.high_water_usd.toFixed(2)} · pool ${st.profit_pool_usd.toFixed(2)} · BOBAI ${st.bobai.units} · orders today ${orders} · next monthly pass ${nextPass}`);
  log({ kind: 'tick', dry: !CONFIRM, monthly, pot_usdt: st.pot_usdt, units: st.units, valued, total_usd: totalNow, capital_usd: st.capital_usd, high_water_usd: st.high_water_usd, profit_pool_usd: st.profit_pool_usd, bobai: st.bobai, orders, lines });
}

if (has('--notify-test')) { const ok = await notify('✅ Trader on the server can reach this chat. Reports: every order as it happens, a summary daily at 00:20 UTC.'); say(ok ? 'sent' : 'not sent (no secret, or the route refused)'); process.exit(ok ? 0 : 1); }

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

if (has('--loop')) {
  say(`loop: a tick now, then daily at ${String(TICK_UTC.hour).padStart(2, '0')}:${String(TICK_UTC.minute).padStart(2, '0')} UTC${CONFIRM ? ', sending orders' : ' (dry)'}; a re-measure on the ${REMEASURE_UTC.day}st at ${String(REMEASURE_UTC.hour).padStart(2, '0')}:${String(REMEASURE_UTC.minute).padStart(2, '0')} UTC; STOP file at ${STOP} halts it`);
  const run = () => tick().catch(async (e) => { say('tick failed: ' + e.message); log({ kind: 'tick_failed', error: e.message }); await notify('⚠️ <b>Trader: tick failed</b> — ' + String(e.message).slice(0, 200)); });
  await run();
  setInterval(() => {
    const d = new Date(), h = d.getUTCHours(), m = d.getUTCMinutes();
    if (h === TICK_UTC.hour && m === TICK_UTC.minute) run();
    if (d.getUTCDate() === REMEASURE_UTC.day && h === REMEASURE_UTC.hour && m === REMEASURE_UTC.minute) remeasure();
  }, 60000);
} else {
  say('node scripts/trader-live.mjs --tick [--confirm] | --bootstrap --confirm | --loop --confirm | --state | --remeasure');
}
