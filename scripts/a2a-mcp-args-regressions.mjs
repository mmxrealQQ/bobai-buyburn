// WHAT A CALLER SENDS IS READ AS MEANT (15.11., the A-Z pass) — A2A on the shared endpoint and MCP on the site.
// Offline: fetch is answered here, nothing reaches the chain. Every case failed on the code before.
//   A2A  an address WITH words goes to the free tool the words name (fee tiers, route, range, escrow, balance, position,
//        pool), "$500" / "2k usd" rides along as the size; a wallet sent to the preflight gets its balance instead
//        (is_wallet); {"skill":"agent_chart","agent_id":363709} (one of OUR ids) charts it instead of -32601; the skills
//        spelled with _ or - both work (plaza_board, escrow_status); the answer carries the tool's data part, a refusal its code
//   MCP  bnb_agent_chart reads "#363709" and the CAIP form, refuses "0xabc" (was agent #0); plaza_board_read refuses a
//        type/status that does not exist (was ignored silently); /api/wallet without an address is 400 bad_address
//        (was 422 not_measurable); initialize answers the protocol version the client asked for when it is one we speak
// node scripts/a2a-mcp-args-regressions.mjs
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
registerHooks({ load(url, ctx, next) { return /\/(dashboard|shared)\/(?:i18n\/)?[^/]+\.js$/.test(url) ? next(url, { ...ctx, format: 'module' }) : next(url, ctx); } });
const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

// ---------------------------------------------------------------- A2A
const calls = [];
let walletAddr = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  let body = {}; try { body = JSON.parse(init.body || '{}'); } catch {}
  if (u.startsWith('https://brainonbnb.com/mcp') && body.method === 'tools/call') {
    const p = body.params; calls.push(p);
    if (p.name === 'bsc_token_preflight' && p.arguments?.address === walletAddr) return J({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'That address is a wallet, not a token.' }], structuredContent: { error: 'That address is a wallet, not a token.', code: 'is_wallet' }, isError: true } });
    if (p.name === 'bnb_agent_chart' && p.arguments?.agent_id === 'nope') return J({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Give the agent id.' }], structuredContent: { error: 'Give the agent id.', code: 'not_measurable' }, isError: true } });
    return J({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ tool: p.name }) }], structuredContent: { tool: p.name, ok: true } } });
  }
  if (u.startsWith('https://agent.brainonbnb.com/chart/')) return J({ id: Number(u.split('/').pop()), pulse: { verdict: 'x' } });
  if (u.startsWith('https://agent.brainonbnb.com/board')) return J({ threads: [] });
  return J({ jsonrpc: '2.0', id: 1, result: '0x0' });
};
const env = { AGENT: { get: async () => null, put: async () => {} } };
const S = await import(pathToFileURL(path.join(ROOT, 'worker-agent/sell.js')).href);
const a2a = async (parts) => {
  calls.length = 0;
  const req = new Request('https://agent.brainonbnb.com/a2a', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'chk', parts } } }) });
  const r = await S.handleA2A(req, env, {});
  return { calls: [...calls], j: await r.json() };
};
const T = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', W = '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce';
const CASES = [
  [`fee tiers for ${T}`, 'pancakeswap_fee_tiers', {}],
  [`best route to buy $500 of ${T}`, 'pancakeswap_best_route', { usd: 500 }],
  [`range plan for ${T} with 2k usd`, 'pancakeswap_range_plan', { capitalUsd: 2000 }],
  [`escrow jobs of ${W}`, 'erc8183_escrow_status', {}],
  [`what is the BOBAI balance of ${W}`, 'bobai_wallet_balance', {}],
  [`pancakeswap positions of ${W}`, 'pancakeswap_position_look', {}],
  [`how deep is the pool of ${T}`, 'bsc_pool_scan', {}],
  [`is ${T} safe to trade with $1,500`, 'bsc_token_preflight', { usd: 1500 }],
  [`${T}`, 'bsc_token_preflight', {}],
];
for (const [q, want, extra] of CASES) {
  const { calls: c } = await a2a([{ kind: 'text', text: q }]);
  const got = c[0];
  const argsOk = got && Object.entries(extra).every(([k, v]) => got.arguments?.[k] === v) && /^0x/.test(got.arguments?.address || '');
  check(got?.name === want && argsOk, `A2A "${q.slice(0, 48)}" -> ${want}${Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''}`, got ? got.name + ' ' + JSON.stringify(got.arguments) : 'no tool called');
}
walletAddr = W;
{ const { calls: c, j } = await a2a([{ kind: 'text', text: `check ${W}` }]);
  check(c.map((x) => x.name).join() === 'bsc_token_preflight,bobai_wallet_balance' && /bobai_wallet_balance/.test(j.result?.parts?.[0]?.text || ''), 'A2A a wallet sent to the preflight gets its balance (is_wallet)', c.map((x) => x.name).join()); }
walletAddr = null;
{ const { calls: c, j } = await a2a([{ kind: 'data', data: { skill: 'agent_chart', agent_id: 363709 } }]);
  check(c[0]?.name === 'bnb_agent_chart' && !j.error, 'A2A {"skill":"agent_chart","agent_id":363709} (our own id) charts it', j.error ? JSON.stringify(j.error) : c[0]?.name); }
{ const { j } = await a2a([{ kind: 'data', data: { skill: 'plaza_board', action: 'how' } }]);
  check(!j.error && !!j.result, 'A2A skill "plaza_board" (underscore) reads the board like "plaza-board"', j.error ? JSON.stringify(j.error) : ''); }
{ const { calls: c, j } = await a2a([{ kind: 'data', data: { skill: 'escrow-status', address: W } }]);
  const { calls: c2, j: j2 } = await a2a([{ kind: 'data', data: { skill: 'escrow_status', address: W } }]);
  check(!j.error && !j2.error, 'A2A skill "escrow-status" and "escrow_status" both answer', JSON.stringify(j.error || j2.error || '')); }
{ const { j } = await a2a([{ kind: 'data', data: { skill: 'price' } }]);
  const dp = (j.result?.parts || []).find((p) => p.kind === 'data');
  check(dp?.data?.tool === 'bobai_price' && dp.data.ok === true, 'A2A an answer carries the tool\'s structured data as a data part', JSON.stringify(j.result?.parts?.map((p) => p.kind))); }
{ const { j } = await a2a([{ kind: 'data', data: { skill: 'agent_chart', agent_id: 'nope' } }]);
  const dp = (j.result?.parts || []).find((p) => p.kind === 'data');
  check(dp?.data?.code === 'not_measurable' && dp.data.error && dp.data.is_error === true, 'A2A a refusal says so in its data part (is_error + code)', JSON.stringify(dp?.data || j.error)); }

// ---------------------------------------------------------------- MCP on the site
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push(u);
  if (u.startsWith('https://agent.brainonbnb.com/chart/')) return J({ id: Number(u.split('/').pop()), pulse: { verdict: 'x', series: [] } });
  if (u.startsWith('https://agent.brainonbnb.com/board')) return J({ threads: [] });
  return J({});
};
const site = (await import(pathToFileURL(path.join(ROOT, 'dashboard/_worker.js')).href)).default;
const senv = { HIT_SECRET: 'hs', ASSETS: { fetch: async () => new Response('asset') } };
const sctx = { waitUntil: () => {} };
const quiet = console.log;
const mcp = async (method, params) => {
  console.log = () => {};
  try { const r = await site.fetch(new Request('https://brainonbnb.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), senv, sctx); return r.json(); }
  finally { console.log = quiet; }
};
const chart = async (agent_id) => { calls.length = 0; const j = await mcp('tools/call', { name: 'bnb_agent_chart', arguments: { agent_id } }); return { j, url: calls.find((u) => u.includes('/chart/')) }; };
for (const [arg, want] of [[363709, '363709'], ['363709', '363709'], ['#363709', '363709'], ['eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:363709', '363709']]) {
  const { j, url } = await chart(arg);
  check(url === 'https://agent.brainonbnb.com/chart/' + want && !j.result?.isError, `MCP bnb_agent_chart ${JSON.stringify(arg)} -> #${want}`, url || JSON.stringify(j.result?.content?.[0]?.text || j.error).slice(0, 120));
}
for (const arg of ['0xabc', '12abc', 'agent', '']) {
  const { j, url } = await chart(arg);
  check(!url && j.result?.isError === true, `MCP bnb_agent_chart ${JSON.stringify(arg)} is refused, no chart read`, url || '');
}
for (const args of [{ type: 'bogus' }, { status: 'zzz' }]) {
  calls.length = 0; const j = await mcp('tools/call', { name: 'plaza_board_read', arguments: args });
  check(j.result?.isError === true && /one of/.test(j.result?.content?.[0]?.text || '') && !calls.some((u) => u.includes('/board')), `MCP plaza_board_read ${JSON.stringify(args)} is refused with the allowed values`, (j.result?.content?.[0]?.text || '').slice(0, 100));
}
{ calls.length = 0; const j = await mcp('tools/call', { name: 'plaza_board_read', arguments: { type: 'fix', status: 'resolved' } });
  check(!j.result?.isError && calls.some((u) => u.includes('type=fix') && u.includes('status=resolved')), 'MCP plaza_board_read with real values still reads', calls.join(' ')); }
{ console.log = () => {}; const r = await site.fetch(new Request('https://brainonbnb.com/api/wallet'), senv, sctx); console.log = quiet; const j = await r.json();
  check(r.status === 400 && j.code === 'bad_address', '/api/wallet without an address: 400 bad_address', r.status + ' ' + j.code); }
for (const [asked, want] of [['2025-03-26', '2025-03-26'], ['2024-11-05', '2024-11-05'], ['2025-06-18', '2025-06-18'], ['1999-01-01', '2025-06-18']]) {
  const j = await mcp('initialize', { protocolVersion: asked, clientInfo: { name: 't' } });
  check(j.result?.protocolVersion === want, `MCP initialize asked ${asked} -> ${want}`, j.result?.protocolVersion);
}
// a stranger test of /mcp/agents (2026-11-19): limit "abc", 0, -3, 500 were taken silently; {"id":…} did not name agent_id
for (const [lim, ok] of [['abc', false], [0, false], [-3, false], [500, false], [2.5, false], [10, true], ['25', true]]) {
  const j = await mcp('tools/call', { name: 'find_agents_on_bnb_chain', arguments: { query: 'health factor', limit: lim } });
  const sc = j.result?.structuredContent || {}, txt = j.result?.content?.[0]?.text || '';
  check(ok ? !j.result?.isError : (j.result?.isError === true && /limit must be a whole number from 1 to 25/.test(txt + JSON.stringify(sc))), `find_agents limit ${JSON.stringify(lim)} ${ok ? 'taken' : 'refused in words'}`, txt.slice(0, 90));
}
{ const j = await mcp('tools/call', { name: 'bnb_agent_chart', arguments: { id: '363709' } }); const txt = j.result?.content?.[0]?.text || '';
  check(j.result?.isError === true && /"agent_id"/.test(txt) && /got "id"/.test(txt), 'bnb_agent_chart with {"id":…} names agent_id and what it got', txt.slice(0, 120)); }
globalThis.fetch = realFetch;
console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
