// GUESSED NAMES AND AGENT ID IN PLAIN WORDS (2026-11-28). Offline: fetch is answered here, nothing reaches the chain.
//   MCP  a guessed name that plainly asks for one tool runs it and says so (called_as): check_token_safety and
//        get_token_price were seen on 24.11. and got "Unknown tool"; probes and unclear names keep "Unknown tool".
//   A2A  the Agent ID Book on the shared endpoint: {"skill":"agent_id"} and plain words ("agent id onboarding for 0x…",
//        "does 0x… hold an agent id", "agent id hackathon projects") reach bnb_agent_id with the action they ask for;
//        before, the skill was -32601 and the words went to the agent search or the catalogue.
// node scripts/guessed-names-regressions.mjs
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
registerHooks({ load(url, ctx, next) { return /\/(dashboard|shared)\/(?:i18n\/)?[^/]+\.js$/.test(url) ? next(url, { ...ctx, format: 'module' }) : next(url, ctx); } });
const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  let body = {}; try { body = JSON.parse(init.body || '{}'); } catch {}
  if (String(url).startsWith('https://brainonbnb.com/mcp') && body.method === 'tools/call') {
    calls.push(body.params);
    return J({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ tool: body.params.name }) }], structuredContent: { tool: body.params.name } } });
  }
  return J({});
};

// ---------------------------------------------------------------- MCP: which names are taken as which tool
const W = await import(pathToFileURL(path.join(ROOT, 'dashboard/_worker.js')).href);
const site = W.default;
check(typeof W.guessTool === 'function', 'guessTool is exported by the worker');
const CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const G = [
  ['check_token_safety', { token_address: CAKE }, 'bsc_token_preflight'],
  ['token_safety_check', { address: CAKE }, 'bsc_token_preflight'],
  ['honeypot_check', { address: CAKE }, 'bsc_token_preflight'],
  ['check-honeypot', { address: CAKE }, 'bsc_token_preflight'],
  ['is_honeypot', { address: CAKE }, 'bsc_token_preflight'],
  ['rug_check', { address: CAKE }, 'bsc_token_preflight'],
  ['scan_token', { address: CAKE }, 'bsc_token_preflight'],
  ['audit_contract', { contract: CAKE }, 'bsc_token_preflight'],
  ['get_token_price', { token_address: CAKE }, 'bsc_token_preflight'],
  ['get_token_price', {}, 'bobai_token'],
  ['get_token_price', { token: BOBAI.toUpperCase().replace('0X', '0x') }, 'bobai_token'],
  ['token_price', { symbol: '$BOBAI' }, 'bobai_token'],
  ['get_price', { symbol: 'CAKE' }, null],          // a symbol we would have to guess into an address: not taken
  ['__no_such_tool__', {}, null],
  ['kawal__nonexistent__tool', {}, null],
  ['__verifymcp_auth_probe_44f31bcfac022e8e__', {}, null],
  ['__radial_auth_probe__', {}, null],
  ['get_weather', {}, null],
  ['swap_tokens', { address: CAKE }, null],
];
for (const [n, a, want] of G) {
  const g = W.guessTool?.(n, a);
  check((g?.name || null) === want, `guessTool("${n}", ${JSON.stringify(a)}) -> ${want || 'none'}`, g?.name || 'none');
}
{ const g = W.guessTool?.('get_token_price', {}); check(JSON.stringify(g?.args) === '{"what":"price"}', 'the $BOBAI price is asked with what=price only (bobai_token takes no other field)', JSON.stringify(g?.args)); }

// the whole MCP path: a guessed name is not "Unknown tool", and a probe still is
const senv = { HIT_SECRET: 'hs', ASSETS: { fetch: async () => new Response('asset') } }, sctx = { waitUntil: () => {} };
const quiet = console.log;
const mcp = async (p, method, params) => {
  console.log = () => {};
  try { const r = await site.fetch(new Request('https://brainonbnb.com' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), senv, sctx); return r.json(); }
  finally { console.log = quiet; }
};
{
  const j = await mcp('/mcp', 'tools/call', { name: 'check_token_safety', arguments: { token_address: CAKE } });
  const txt = j.result?.content?.[0]?.text || j.error?.message || '';
  check(!/Unknown tool/.test(txt) && !j.error, 'MCP check_token_safety runs a tool, not "Unknown tool"', txt.slice(0, 100));
}
{
  const j = await mcp('/mcp', 'tools/call', { name: '__no_such_tool__', arguments: {} });
  const txt = j.result?.content?.[0]?.text || j.error?.message || '';
  check(/Unknown tool/.test(txt), 'MCP __no_such_tool__ (a probe) still gets "Unknown tool"', txt.slice(0, 60));
}
{
  // on a focused server the guess is held to that server's tools: /mcp/board has no preflight
  const j = await mcp('/mcp/board', 'tools/call', { name: 'check_token_safety', arguments: { address: CAKE } });
  check(j.error?.code === -32601 && /This server has/.test(j.error?.message || ''), '/mcp/board: a guess for a tool it does not serve is refused with its list', (j.error?.message || '').slice(0, 80));
}

// ---------------------------------------------------------------- A2A: the Agent ID Book on the shared endpoint
const S = await import(pathToFileURL(path.join(ROOT, 'worker-agent/sell.js')).href);
const env = { AGENT: { get: async () => null, put: async () => {} } };
const WALLET = '0xF714000000000000000000000000000000000001';
const ask = async (parts) => {
  calls.length = 0;
  const req = new Request('https://agent.brainonbnb.com/a2a', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'chk', parts } } }) });
  const r = await S.handleA2A(req, env, {});
  return { call: calls[0] || null, j: await r.json() };
};
const T = [
  [[{ kind: 'data', data: { skill: 'agent_id', address: WALLET } }], 'onboard', WALLET],
  [[{ kind: 'data', data: { skill: 'agent_id' } }], 'how', undefined],
  [[{ kind: 'data', data: { skill: 'agent_id', action: 'book' } }], 'book', undefined],
  [[{ kind: 'text', text: `agent id onboarding for ${WALLET}` }], 'onboard', WALLET],
  [[{ kind: 'text', text: `does ${WALLET} hold an Agent ID?` }], 'check', WALLET],
  [[{ kind: 'text', text: `set up my Binance Agentic Wallet ${WALLET}` }], 'onboard', WALLET],
  [[{ kind: 'text', text: `how many Agent ID users does ${WALLET} have` }], 'projects', WALLET],
  [[{ kind: 'text', text: 'agent id hackathon projects' }], 'projects', undefined],
  [[{ kind: 'text', text: 'how do I sign the Agent ID book' }], 'how', undefined],
];
for (const [parts, action, address] of T) {
  const { call } = await ask(parts);
  check(call?.name === 'bnb_agent_id' && call.arguments?.action === action && call.arguments?.address === address, `A2A ${JSON.stringify(parts[0].data || parts[0].text)} -> bnb_agent_id ${action}`, call ? `${call.name} ${JSON.stringify(call.arguments)}` : 'no tool called');
}
// what must stay as it was
for (const [text, want] of [['find me an agent that can rebalance my PancakeSwap v3 position', 'find_agents_on_bnb_chain'], ['what is the price of BOBAI', 'bobai_price'], [`is ${CAKE} safe to buy`, 'bsc_token_preflight']]) {
  const { call } = await ask([{ kind: 'text', text }]);
  check(call?.name === want, `A2A "${text.slice(0, 50)}" still -> ${want}`, call?.name || 'none');
}
{
  const card = (await (await site.fetch(new Request('https://brainonbnb.com/.well-known/agent-card.json'), senv, sctx)).json());
  const s = (card.skills || []).find((x) => x.id === 'agent_id');
  check(!!s && /baw/.test(s.description) && s.tags.includes('binance'), 'the A2A card has the agent_id skill (baw, tagged binance)');
}
globalThis.fetch = realFetch;
console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
