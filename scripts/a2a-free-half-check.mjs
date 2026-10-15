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
{
  const d = (await a2a('defi-agent', [{ kind: 'text', text: 'what can you do' }]))?.result?.parts?.[0]?.text || '';
  check(/PancakeSwap V3/.test(d), '"what can you do" still answers in one sentence', d.slice(0, 60));
}
console.log(`a2a-free-half: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
