#!/usr/bin/env node
// node scripts/mcp-examples-check.mjs [base=https://brainonbnb.com]
// THE EXAMPLE A PROBE CALLS WITH (2026-11-11): registry and quality probes (qamcp-login-check, brickbluebot …) call every
// tool of /mcp and fill the arguments from the schema; the five measurement tools had no example, the probes sent empty
// values or a symbol and got bad_address every day (10.11.: 18 of their calls). Every one of the five must now name an
// example address, and a call with exactly that example must answer with a measurement — on /mcp and on the small
// servers that carry the tool (/mcp/preflight, /mcp/pancakeswap).
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const TOOLS = ['bsc_token_preflight', 'bsc_pool_scan', 'pancakeswap_fee_tiers', 'pancakeswap_range_plan', 'pancakeswap_best_route'];
const H = { 'user-agent': 'brainonbnb-mcp-examples-check/1', 'content-type': 'application/json', accept: 'application/json' };
const rpc = async (path, method, params) => (await (await fetch(BASE + path, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(90000) })).json()).result;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
for (const path of ['/mcp', '/mcp/preflight', '/mcp/pancakeswap']) {
  const tools = (await rpc(path, 'tools/list', {}))?.tools || [];
  for (const t of tools.filter((x) => TOOLS.includes(x.name))) {
    const ex = t.inputSchema?.properties?.address?.examples?.[0];
    ok(`${path} ${t.name}: the address argument names an example`, /^0x[0-9a-fA-F]{40}$/.test(ex || ''), ex || 'none');
  }
}
const tools = (await rpc('/mcp', 'tools/list', {}))?.tools || [];
for (const name of TOOLS) {
  const t = tools.find((x) => x.name === name), ex = t?.inputSchema?.properties?.address?.examples?.[0];
  if (!ex) { ok(`${name}: a call with its example answers`, false, 'no example to call with'); continue; }
  const r = await rpc('/mcp', 'tools/call', { name, arguments: { address: ex } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
  ok(`${name}: a call with its example answers`, r && !r.isError, (r?.content?.[0]?.text || '').slice(0, 90).replace(/\s+/g, ' '));
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
