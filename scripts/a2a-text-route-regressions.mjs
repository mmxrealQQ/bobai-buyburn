// Plain-word questions on the shared A2A endpoint go to the free tool they name (2026-11-15).
// Offline: fetch is replaced, the tool the endpoint calls is recorded. Run: node scripts/a2a-text-route-regressions.mjs
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };

let called = null;
globalThis.fetch = async (url, init = {}) => {
  let body = {}; try { body = JSON.parse(init.body || '{}'); } catch {}
  if (String(url).startsWith('https://brainonbnb.com/mcp') && body.method === 'tools/call') {
    called = body.params;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ tool: body.params.name }) }] } }), { headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x0' }), { headers: { 'content-type': 'application/json' } });
};
const env = { AGENT: { get: async () => null, put: async () => {} } };
const S = await import('../worker-agent/sell.js');
const ask = async (text, path = '/a2a') => {
  called = null;
  const req = new Request('https://agent.brainonbnb.com' + path, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'chk', parts: [{ kind: 'text', text }] } } }) });
  const slug = path.match(/^\/([a-z-]+)\/a2a$/)?.[1];
  const r = await S.handleA2A(req, env, slug ? { agent: slug } : {});
  return { called, j: await r.json() };
};

const CASES = [
  ['what is the price of BOBAI', 'bobai_price'],
  ['how do I buy $BOBAI', 'bobai_purchase_guide'],
  ['how much BOBAI has been burned', 'bobai_burned'],
  ['BOBAI liquidity', 'bobai_liquidity'],
  ['what is the tax on bobai', 'bobai_tokenomics'],
  ['who are the whales in BOBAI', 'bobai_smart_money'],
  ['tell me about bobai', 'bobai_token_info'],
  ['find me an agent that can rebalance my PancakeSwap v3 position', 'find_agents_on_bnb_chain'],
  ['is there an agent for swap routing', 'find_agents_on_bnb_chain'],
];
for (const [q, want] of CASES) {
  const { called: c } = await ask(q);
  check(c?.name === want, `"${q}" -> ${want}`, c?.name || 'no tool called');
}
{
  const { called: c } = await ask('find me an agent that can rebalance my PancakeSwap v3 position');
  check(c?.arguments?.query?.includes('rebalance'), 'the search carries the words as its query', c?.arguments?.query);
}
// what must stay as it was
for (const q of ['hello', 'what can you do']) {
  const { called: c, j } = await ask(q);
  check(!c && /hireable services|measurements/.test(JSON.stringify(j)), `"${q}" still gets the catalogue`, c?.name || '');
}
{
  const { called: c } = await ask('is 0x55d398326f99059ff775485246999027b3197955 safe to buy');
  check(c?.name === 'bsc_token_preflight', 'an address still goes to the preflight', c?.name);
}
{
  const { called: c } = await ask('what is the price of BOBAI', '/health-factor/a2a');
  check(c?.name !== 'bobai_price', 'an agent\'s own endpoint is not rerouted', c?.name || 'none');
}
// a token named by its symbol (2026-11-15)
{
  const U = await import('../worker-agent/understand.js');
  const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
  const grid = S.SERVICES.grid_plan;
  const T = [
    ['grid plan for CAKE', CAKE],
    ['grid plan for CAKE on BNB Chain', CAKE],
    ['grid plan for CAKE/BNB, 10 levels', CAKE],
    ['a grid for WBNB/USDT', WBNB],
    ['a grid for BNB', WBNB],
    ['grid plan on BNB Smart Chain', undefined],
    ['grid for CAKE and ETH', undefined],
    ['grid for pancake swap', undefined],
  ];
  for (const [q, want] of T) {
    const got = U.understand(grid, q).token;
    check(got === want, `understand: "${q}" -> ${want || 'no token'}`, got || 'none');
  }
  check(S.extractParams('grid plan for CAKE on BNB Chain').token === CAKE, 'extractParams reads the symbol too', S.extractParams('grid plan for CAKE on BNB Chain').token);
  check(S.extractParams(`grid for CAKE at ${WBNB}`).token === WBNB, 'an address beats a symbol', S.extractParams(`grid for CAKE at ${WBNB}`).token);
  check(!S.extractParams('health factor of my CAKE loan').address, 'a symbol never becomes the wallet address');
}
// (18.11.) the ERC-8183 escrow settles in $U only: no service's escrow price may name another unit (lp_position_plan said
// "0.10 USD1" since 3 Sep; a stranger test of Brain Plaza saw "USD1" in one answer and "$U" everywhere else)
check(Object.values(S.SERVICES).every((s) => / \$U\b/.test(s.price_display) && !/USD1/.test(s.price_display)), 'every escrow price is in $U, none in USD1');
// (18.11.) Workers load modules with the clock at 0: the catalogue's deliver prices froze at "0.01 $U (until 5 Nov…)" and
// stood on agent.brainonbnb.com/ two weeks after the sale. Loaded here the same way, they must read today's price.
{
  const real = Date.now; Date.now = () => 0;
  const C = await import('../worker-agent/catalog.js');
  Date.now = real;
  check(C.DELIVERIES.every((d) => d.price === '0.10 $U') && JSON.stringify(C.offering()).includes('"price":"0.10 $U"') && !/until 5 Nov/.test(JSON.stringify(C.offering())), 'the catalogue reads the price when asked, not the clock it was loaded with');
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
