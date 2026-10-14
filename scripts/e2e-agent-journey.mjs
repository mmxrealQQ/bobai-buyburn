// THE STRANGER'S JOURNEY, END TO END (2026-10-14): what another AI agent meets when it finds us — discover (llms.txt,
// agent card, domain proof, official MCP registry, x402 catalogue), measure (MCP 26 tools, a pre-trade check, a V3
// position look), find an agent (broker, evidence ranking, chart), hire (escrow quote, A2A), pay (x402 terms with
// $BOBAI at half price, every agent's own MCP, a free example) and trust (the second-opinion record, the portfolio).
// Live, read-only: nothing is signed and no money moves.
//   node scripts/e2e-agent-journey.mjs   exit 1 on any FAIL
const S = 'https://brainonbnb.com', A = 'https://agent.brainonbnb.com';
const CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';
let bad = 0;
const step = (name, ok, detail) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const j = async (u, init) => { try { const r = await fetch(u, { ...(init || {}), signal: AbortSignal.timeout(45000) }); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) }; } catch (e) { return { status: 0, body: null, err: e.message }; } };
const rpc = (u, method, params) => j(u, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });

// 1. DISCOVER
const llms = await fetch(`${S}/llms.txt`).then((r) => r.text()).catch(() => '');
step('llms.txt names MCP, x402, Set and Earn and the DeFi agent', /\/mcp/.test(llms) && /x402/.test(llms) && /set-and-earn/.test(llms) && /363709/.test(llms));
const card = await j(`${S}/.well-known/agent-card.json`);
step('the agent card answers with skills', card.status === 200 && (card.body?.skills || []).length > 5, `${(card.body?.skills || []).length} skills`);
const reg = await j(`${S}/.well-known/agent-registration.json`);
step('the domain proof names our agents', JSON.stringify(reg.body || {}).includes('363709') && JSON.stringify(reg.body || {}).includes('49467'));
const mreg = await j('https://registry.modelcontextprotocol.io/v0/servers?search=com.brainonbnb');
step('the official MCP registry lists com.brainonbnb/bobai', JSON.stringify(mreg.body || {}).includes('com.brainonbnb/bobai'));
const x402 = await j(`${A}/.well-known/x402`);
step('the x402 catalogue lists the paid resources', (x402.body?.resources || []).length >= 7, `${(x402.body?.resources || []).length} resources`);

// 2. MEASURE (free)
const init = await rpc(`${S}/mcp`, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
step('MCP initialize', init.body?.result?.serverInfo?.version === '1.5.0', init.body?.result?.serverInfo?.version);
const tl = await rpc(`${S}/mcp`, 'tools/list');
step('MCP lists 26 tools', (tl.body?.result?.tools || []).length === 26, `${(tl.body?.result?.tools || []).length}`);
const pf = await rpc(`${S}/mcp`, 'tools/call', { name: 'bsc_token_preflight', arguments: { address: CAKE, usd: 250 } });
step('a pre-trade check on CAKE answers', pf.body?.result && !pf.body.result.isError, (pf.body?.result?.content?.[0]?.text || '').slice(0, 80).replace(/\s+/g, ' '));
const look = await rpc(`${S}/mcp`, 'tools/call', { name: 'pancakeswap_position_look', arguments: { address: '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A' } });
step('a V3 position look answers with The Flip', /the_flip/.test(look.body?.result?.content?.[0]?.text || ''));

// 3. FIND an agent
const find = await j(`${A}/find?q=rebalance%20pancakeswap%20v3%20position`);
step('the broker finds agents for a rebalancing task', (find.body?.agents || find.body?.matches || find.body?.results || []).length > 0, `${(find.body?.agents || find.body?.matches || find.body?.results || []).length} found`);
const rank = await j(`${A}/chart/rank?category=rebalancing&limit=10`);
step('the evidence ranking for rebalancing answers', rank.status === 200 && (rank.body?.agents || rank.body?.ranked || []).length > 0);
const chart = await j(`${A}/chart/363709`);
step('the DeFi agent has a measured chart', chart.status === 200 && chart.body?.id == 363709);

// 4. HIRE (quote only)
const hire = await j(`${A}/hire?agent=363709&task=${encodeURIComponent('plan my PancakeSwap V3 position held by 0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A')}`);
step('a hire quote with the transactions to fund it', hire.status === 200 && JSON.stringify(hire.body || {}).length > 500, `http ${hire.status}`);
const a2a = await rpc(`${A}/defi-agent/a2a`, 'message/send', { message: { role: 'user', kind: 'message', messageId: 'e2e', parts: [{ kind: 'text', text: 'what can you do' }] } });
step('the DeFi agent answers over A2A', !!a2a.body?.result, a2a.body?.error?.message);

// 5. PAY (terms) and the agent's own MCP
const terms = await j(`${A}/answer?service=lp_position_plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const bob = (terms.body?.accepts || []).find((a) => /^0x245c/i.test(a.asset || ''));
step('x402 terms: USD1 first, $BOBAI at half price', terms.status === 402 && /0x8d0d/i.test(terms.body?.accepts?.[0]?.asset || '') && /half price/.test(bob?.description || ''));
for (const slug of ['defi-agent', 'health-factor', 'grid-trader', 'yield-optimizer', 'rebalancer', 'lp-placement']) {
  const t = await rpc(`${A}/${slug}/mcp`, 'tools/list');
  step(`${slug} publishes its tools over MCP`, (t.body?.result?.tools || []).length === 2);
}
const ex = await j(`${A}/example?service=lp_position_plan`);
step('a free example answer shows what is sold', ex.status === 200 && !!ex.body?.result);

// 6. TRUST
const so = await j(`${A}/second-opinion`);
step('the agent-hires-agent record is public', so.status === 200 && Array.isArray(so.body?.opinions));
const pr = await j(`${A}/lp/portfolio`);
step('the DeFi agent portfolio is public', pr.status === 200 && pr.body?.worth?.bnb > 0, `${pr.body?.worth?.bnb} BNB`);
console.log(`\ne2e: ${bad ? bad + ' FAIL' : 'all PASS'}`);
process.exitCode = bad ? 1 : 0;
