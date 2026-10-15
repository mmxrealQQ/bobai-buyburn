#!/usr/bin/env node
// scripts/a2a-free-half-check.mjs — do our agents give over A2A what their cards promise? (2026-10-15)
//
// The DeFi agent's card says "give me a position and I return whether it is in range"; asked that over A2A it
// answered with a price and a link, and asked with a data part ({wallet}) it described itself. Mandate checks every
// agent from its free call, field by field against the chain ("in range", "current tick" within 30 ticks; the health
// factor; the Venus USDT rate), and our five pages read "not data we can read". This asks the way a stranger asks:
// a sentence, a data part, the MCP tool with Mandate's word `wallet` — and compares the tick with slot0.
//
//   node scripts/a2a-free-half-check.mjs [base]     (default https://agent.brainonbnb.com)
const BASE = (process.argv[2] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
const WALLET = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const post = async (url, body) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) })).json().catch(() => ({}));
const a2a = (slug, parts) => post(`${BASE}/${slug}/a2a`, { jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: `free-half-check-${Date.now()}`, parts } } });
const dataOf = (j) => (j?.result?.parts || []).find((p) => p.kind === 'data')?.data || null;
async function slot0Tick(pool) {
  const r = await post('https://bsc-dataseed.binance.org', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: pool, data: '0x3850c7bd' }, 'latest'] });
  return r.result ? Number(BigInt.asIntN(24, BigInt('0x' + r.result.slice(66, 130)))) : null;
}
async function rangeOk(what, d) {
  const pool = d?.free_reading?.pool?.address || d?.pool?.address;
  const tick = pool ? await slot0Tick(pool) : null;
  check(!!d && typeof d.in_range === 'boolean' && Number.isInteger(d.current_tick) && tick != null && Math.abs(d.current_tick - tick) <= 30,
    what, d ? `in_range ${d.in_range}, current_tick ${d.current_tick} vs slot0 ${tick}` : 'no data part');
}

await rangeOk('DeFi agent, a sentence naming the wallet: in_range and current_tick at the top of the data',
  dataOf(await a2a('defi-agent', [{ kind: 'text', text: `Is the PancakeSwap V3 position of wallet ${WALLET} in range, and what is the pool's current tick?` }])));
await rangeOk('DeFi agent, a data part {wallet}: the reading, not a self-description',
  dataOf(await a2a('defi-agent', [{ kind: 'data', data: { wallet: WALLET } }])));
await rangeOk('DeFi agent, a data part {position}', dataOf(await a2a('defi-agent', [{ kind: 'data', data: { position: '7637521' } }])));
{
  const d = dataOf(await a2a('health-factor', [{ kind: 'data', data: { address: WALLET } }]));
  check(!!d && 'health_factor' in d && d.free_reading?.account?.toLowerCase() === WALLET.toLowerCase(), 'health monitor, a data part {address}: health_factor at the top', d ? `health_factor ${d.health_factor}` : 'no data part');
}
{
  const d = dataOf(await a2a('yield-optimizer', [{ kind: 'text', text: 'What does Venus pay on USDT right now?' }]));
  check(!!d && Number.isFinite(d.venus_usdt_rate_pct), 'yield agent, a sentence: venus_usdt_rate_pct at the top', d ? `${d.venus_usdt_rate_pct} %` : 'no data part');
}
{
  const j = await post(`${BASE}/defi-agent/mcp`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lp_position_look', arguments: { wallet: WALLET } } });
  const s = j.result?.structuredContent || {};
  check(!s.input && s.owner?.toLowerCase() === WALLET.toLowerCase() && typeof s.in_range === 'boolean', 'MCP lp_position_look reads the wallet given as `wallet` (Mandate\'s word)', s.input ? `ignored it: "${s.input.slice(0, 60)}"` : `owner ${s.owner}`);
}
// Mandate's own question (captured 2026-10-15 09:50 UTC): a wallet with five positions, "the positions" — each one read
const MANDATE_Q = 'PancakeSwap V3 range check and re-centre plan for the positions of 0x54c06cC2623aAA2Dcc38B17fA07aD2e99b363C90, via mandatemarkets.com';
for (const slug of ['defi-agent', 'lp-placement']) {
  const d = dataOf(await a2a(slug, [{ kind: 'text', text: MANDATE_Q }]));
  const ps = Array.isArray(d?.positions) ? d.positions : [];
  const pool = ps.find((p) => p.pool)?.pool, tick = pool ? await slot0Tick(pool) : null;
  const okEach = ps.length > 1 && ps.every((p) => typeof p.in_range === 'boolean' && Number.isInteger(p.current_tick) && (p.in_range === (p.tick_lower <= p.current_tick && p.current_tick < p.tick_upper)));
  check(okEach && tick != null && Math.abs(ps[0].current_tick - tick) <= 30, `${slug}, Mandate's range check of a wallet with several positions: each one read`, `${ps.length} positions, ${ps.filter((p) => p.in_range).length} in range, tick ${ps[0]?.current_tick} vs slot0 ${tick}`);
}
{
  const d = dataOf(await a2a('lp-placement', [{ kind: 'text', text: 'Which fee tier pays for CAKE 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82?' }]));
  check(!!d && !d.positions && !!d.understood, 'fee-tier agent, a fee-tier question: still its own offer, no position reading', d ? Object.keys(d).slice(0, 4).join(', ') : 'no data part');
}
// Mandate's grid question (its standard page, 2026-10-15): the levels inside the bounds asked for (within 1%), the count
// asked for (give or take one) in price order, allocations adding up to no more than the capital. The bounds are taken
// from our own reading of the WBNB/USDT pair's reserves, not from the answer.
async function wbnbUsd() {
  const r = await post('https://bsc-dataseed.binance.org', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE', data: '0x0902f1ac' }, 'latest'] });
  if (!r.result) return null;
  const usdt = BigInt('0x' + r.result.slice(2, 66)), wbnb = BigInt('0x' + r.result.slice(66, 130));   // token0 USDT, token1 WBNB, both 18 decimals
  return Number(usdt * 10n ** 6n / wbnb) / 1e6;
}
async function gridOk(what, d, { band = 8, n = 10, capital = 1000, stop = false } = {}) {
  const px = await wbnbUsd(), lo = px * (1 - band / 100), hi = px * (1 + band / 100);
  const lv = Array.isArray(d?.levels) ? d.levels.map((x) => Number(x?.price ?? x)) : [];
  const alloc = Array.isArray(d?.levels) ? d.levels.reduce((s, x) => s + Number(x?.allocation_usd ?? 0), 0) : NaN;
  const inside = lv.length && lv.every((p) => p >= lo * 0.99 && p <= hi * 1.01), ordered = lv.every((p, i) => !i || p > lv[i - 1]);
  const stopOk = !stop || (Number.isFinite(d?.stop_price) && d.stop_price < lv[0]);
  check(!!px && inside && Math.abs(lv.length - n) <= 1 && ordered && alloc > 0 && alloc <= capital && d.allocated_usd <= capital && stopOk, what,
    d ? `levels ${lv.length} ${lv[0]?.toFixed(2)}..${lv.at(-1)?.toFixed(2)} vs ours ${lo.toFixed(2)}..${hi.toFixed(2)}, allocated ${alloc}, stop ${d.stop_price ?? '-'}` : 'no data part');
}
await gridOk('grid agent, Mandate\'s grid question as a sentence: levels, bounds, allocations at the top',
  dataOf(await a2a('grid-trader', [{ kind: 'text', text: 'A grid for WBNB/USDT between two prices 8% either side of the price now, with a stop and 1,000 USD of capital, over 10 levels.' }])), { stop: true });
await gridOk('grid agent, a data part {token, levels, bandPct, capitalUsd}',
  dataOf(await a2a('grid-trader', [{ kind: 'data', data: { token: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', levels: 10, bandPct: 8, capitalUsd: 1000 } }])));
{
  const d = (await a2a('defi-agent', [{ kind: 'text', text: 'what can you do' }]))?.result?.parts?.[0]?.text || '';
  check(/PancakeSwap V3/.test(d), '"what can you do" still answers in one sentence', d.slice(0, 60));
}
console.log(`a2a-free-half: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
