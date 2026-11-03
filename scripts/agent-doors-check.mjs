#!/usr/bin/env node
// THE SIX AGENT DOORS SAY HOW TO WALK IN (2026-11-03). A week of /stats/detail: the per-agent MCP servers
// (agent.brainonbnb.com/<agent>/mcp) were listed 19,654 times and called 148. This walks each door the way an agent
// does that knows nothing: initialize, tools/list, the example the door itself offers, a wrong tool name, the free tool
// with no arguments. FAIL when the greeting has no instructions with a call that works, the free tool's schema carries
// no example, that very example does not answer, or a wrong name / an empty call comes back without one to try.
//   node scripts/agent-doors-check.mjs [base]   (default https://agent.brainonbnb.com)   exit 1 on any FAIL
const base = (process.argv[2] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
const DOORS = ['defi-agent', 'health-factor', 'yield-optimizer', 'grid-trader', 'rebalancer', 'lp-placement'];
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const rpc = (door, method, params) => fetch(`${base}/${door}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'brainonbnb-check' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(60000) }).then((r) => r.json()).catch((e) => ({ error: { message: String(e) } }));
for (const door of DOORS) {
  const init = await rpc(door, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'brainonbnb-check', version: '1' } });
  const ins = init.result?.instructions || '';
  const list = await rpc(door, 'tools/list', {});
  const free = list.result?.tools?.[0];
  const ex = free?.inputSchema?.examples?.[0];
  say(!!ins && free && ins.includes(free.name) && ex && ins.includes(JSON.stringify(ex)), `${door}: the greeting names ${free?.name} with the example ${JSON.stringify(ex)}`);
  if (free && ex) {
    const call = await rpc(door, 'tools/call', { name: free.name, arguments: ex });
    say(call.result && !call.result.isError && (call.result.content?.[0]?.text || '').length > 40, `${door}: the example answers (${(call.result?.content?.[0]?.text || call.error?.message || '').replace(/\s+/g, ' ').slice(0, 70)})`);
  }
  const wrong = await rpc(door, 'tools/call', { name: 'get_price_of_token', arguments: {} });
  say(/Unknown tool/.test(wrong.error?.message || '') && /try \{/.test(wrong.error?.message || '') && /brainonbnb\.com\/mcp/.test(wrong.error?.message || ''), `${door}: a wrong name gets one to try (${(wrong.error?.message || '').slice(0, 80)})`);
  if (free && Object.keys(ex || {}).length) {
    const empty = await rpc(door, 'tools/call', { name: free.name, arguments: {} });
    const txt = empty.result?.content?.[0]?.text || '';
    // the DeFi agent answers an empty call with the position it runs itself (since 14.10.): an answer beats a hint
    if (door === 'defi-agent') say(!empty.result?.isError && /this is the position this agent runs itself/.test(txt), `${door}: an empty call shows its own position (${txt.replace(/\s+/g, ' ').slice(0, 80)})`);
    else say(empty.result?.isError && /Try: \{/.test(txt), `${door}: an empty call is refused with one to try (${txt.slice(0, 80)})`);
  }
}
console.log(fails ? `FAIL  ${fails}` : 'PASS  six agent doors: a greeting with a call that works, an example that answers, a hint on every miss');
process.exit(fails ? 1 : 0);
