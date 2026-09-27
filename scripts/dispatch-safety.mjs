// Does the router call the right things, and refuse the wrong ones.
//
// `isReadOnly` in worker-agent/dispatch.js is the single decision that stands
// between a routed question and somebody's funds: it decides whether a tool on
// a stranger's MCP server may be called on a buyer's behalf. It had no test at
// all, and it was wrong in both directions at once.
//
//   Too strict: it required a reading verb in the tool NAME. Measured against
//   our own server, it could reach 3 of our 19 tools. `bsc_pool_scan` — the
//   measurement this marketplace is built on — was unroutable because "scan" is
//   not on a list of twenty-five verbs. So were `bobai_price`, `bnb_agent_census`
//   and twelve others, and so is anything anyone else calls `pool_depth`.
//
//   Too blunt: it then declined any description containing a mutating word
//   anywhere. A pool measurement has every reason to say "swap fee" and
//   "transfer tax" — those are the nouns it measures. The tool was declined for
//   the sentence explaining that it never places a swap.
//
// Both directions are pinned here, because the repair for either one is a way
// of causing the other.
//
// Usage:
//   node scripts/dispatch-safety.mjs --self-test   fixtures, no network
//   node scripts/dispatch-safety.mjs               and measure the live server
import { isReadOnly, argsFromTask, addressesInTask, answersAsked, askedAction, usdInTask, taskTerms, scoreTool, rankTool, answersField, capAnswer, handleDispatch, KNOWN_TOKENS } from '../worker-agent/dispatch.js';
import fsPins from 'node:fs';
import { termWeights as findTermWeights, score as findScore } from '../worker-agent/find.js';

const SITE = process.env.SITE || 'https://brainonbnb.com';
const args = process.argv.slice(2);

const MUST_ACCEPT = [
  // The tightening of 2026-09-18 must not cost a reader: these talk ABOUT the
  // same verbs and do none of them.
  [{ name: 'rebalance_plan', description: 'Computes what a rebalance would cost, leg by leg. A measurement; nothing is sent.', annotations: { readOnlyHint: true } }, 'a rebalance PLANNER that declares itself a reader'],
  [{ name: 'get_open_positions', description: 'Lists the open positions of an account.' }, 'a reader of open positions'],
  [{ name: 'borrow_rates', description: 'Returns the current borrow APY per market.' }, 'a reader of borrow rates'],
  // Ours, by name shape. None of these carries a reading verb.
  [{ name: 'bsc_pool_scan', description: 'Measure what a trade on BNB Smart Chain would actually cost, before placing it. Returns real cost per trade size (price impact + swap fee + transfer tax together), the transfer tax measured from executed trades, and whether the LP is burned or still withdrawable.' }, 'a pool measurement that names swap fee and transfer tax as the things it measures'],
  [{ name: 'pancakeswap_fee_tiers', description: 'For a liquidity provider deciding where to put liquidity on PancakeSwap. Measures each tier over a live window: swaps, turnover, and the fees the pool actually paid out.' }, 'the fee-tier comparison'],
  [{ name: 'bobai_price', description: 'The current price of $BOBAI, read from the pool.' }, 'a price reader with no verb in its name'],
  [{ name: 'bnb_agent_census', description: 'How many ERC-8004 agents are registered on BNB Chain and how many answer when contacted.' }, 'a census'],
  // Somebody else's, same shape.
  [{ name: 'pool_depth', description: 'Reports the depth of a liquidity pool.' }, "a stranger's tool named as a noun"],
  [{ name: 'apy_ranking', description: 'Ranks lending markets by supply APY.' }, 'a ranking'],
  // Declared read-only by the server even though the name says nothing.
  [{ name: 'portfolio_snapshot', description: 'A snapshot.', annotations: { readOnlyHint: true } }, 'a tool the server declares read-only'],
  // Namespaced reader — the case a previous repair was written for.
  [{ name: 'topaz_get_protocol_stats', description: 'Protocol statistics.' }, 'a namespaced reader'],
];

const MUST_REFUSE = [
  // An agent's controls (2026-09-24): this one, verbatim from a stranger's
  // yield optimiser, was CALLED for "is this token safe 0x…".
  [{ name: 'pause', description: 'Emergency stop. Refuses all further migrations; scanning continues.\n\n    The only state-changing tool exposed, because it fails SAFE — the worst a\n    hostile prompt achieves is halting an agent that was about to trade. REQUIRES AN API KEY.' }, "a stranger's emergency stop"],
  [{ name: 'stop_bot', description: 'Shows nothing; stops the bot.' }, 'a stop control'],
  [{ name: 'set_alert_threshold', description: 'Returns the new threshold.' }, 'a setter'],
  [{ name: 'strategy_toggle', description: 'Reports the strategy state.' }, 'a toggle'],
  [{ name: 'get_mode', description: 'Returns the mode. Calling it with a value changes the state of the vault.' }, 'a reader whose description says it changes state'],
  // Mutating verb in the name, wherever it sits. The five that nearly shipped.
  [{ name: 'get_swap_calldata', description: 'Returns the calldata.' }, 'a builder wearing a get_ prefix'],
  [{ name: 'prepare_bobai_swap', description: 'Prepares a swap.' }, 'a swap preparer'],
  [{ name: 'create_order', description: 'Places an order.' }, 'an order placer'],
  [{ name: 'get_order_status', description: 'Order status.' }, 'a name carrying "order" at all'],
  [{ name: 'build_transaction', description: 'Builds it.' }, 'a transaction builder'],
  // Innocent name, action in the description.
  [{ name: 'portfolio_helper', description: 'Signs and sends the transaction for you.' }, 'an innocent name that admits signing'],
  [{ name: 'pool_helper', description: 'Swaps your tokens into the deeper pool automatically.' }, 'an innocent name that acts on your tokens'],
  [{ name: 'lp_manager', description: 'Withdraws the position and deposits it into the better tier.' }, 'an innocent name that moves a position'],
  // The server says no even though nothing else does.
  [{ name: 'account_view', description: 'A view of the account.', annotations: { readOnlyHint: false } }, 'a tool the server declares NOT read-only'],
  [{ name: 'account_view2', description: 'A view.', annotations: { destructiveHint: true } }, 'a tool the server flags destructive'],
  // A server contradicting itself: the declaration says read-only, the prose
  // says it signs. Believe the half that costs money.
  [{ name: 'portfolio_view', description: 'Signs and broadcasts the rebalance for you.', annotations: { readOnlyHint: true } }, 'a declared reader whose description admits signing'],
  // No positive signal anywhere: not a reader as far as anyone can tell.
  [{ name: 'xyz', description: 'Does the thing.' }, 'a tool that says nothing about itself'],
  [{ name: '', description: 'no name at all' }, 'a nameless tool'],
  // 2026-09-18: thirteen of thirteen adversarial tools went through. The verbs
  // of lending and position management were on no list, a name without
  // separators hid its verb from the segment test, and "returns a report" in
  // the description was read as the sign of a reader.
  [{ name: 'rebalance_portfolio', description: 'Rebalances the portfolio and returns a report.' }, 'a rebalancer that "returns a report"'],
  [{ name: 'liquidate_position', description: 'Returns the status after liquidating.' }, 'a liquidator'],
  [{ name: 'harvest_rewards', description: 'Reports the rewards harvested.' }, 'a harvester'],
  [{ name: 'repay_loan', description: 'Returns the remaining debt.' }, 'a loan repayment'],
  [{ name: 'borrow', description: 'Returns the health factor afterwards.' }, 'a borrow'],
  [{ name: 'withdrawall', description: 'Returns the balance.' }, 'a verb hidden in a name without separators'],
  [{ name: 'placeorder', description: 'Returns the order status.' }, 'an order placed under one word'],
  [{ name: 'sendfunds', description: 'Returns a receipt.' }, 'a send under one word'],
  [{ name: 'manage', description: 'Closes your position and returns the status.' }, 'a description that closes a position'],
  [{ name: 'farm_helper', description: 'Adds liquidity and reports the share.' }, 'a description that adds liquidity'],
  [{ name: 'vault_info', description: 'Compounds your rewards, then shows the balance.' }, 'a description that compounds rewards'],
];

if (args.includes('--self-test')) {
  const fails = [];
  for (const [tool, why] of MUST_ACCEPT)
    if (!isReadOnly(tool)) fails.push(`refused ${why} (${tool.name || '<unnamed>'}) — the router cannot reach it`);
  for (const [tool, why] of MUST_REFUSE)
    if (isReadOnly(tool)) fails.push(`ACCEPTED ${why} (${tool.name || '<unnamed>'}) — this one calls somebody's money`);

  if (fails.length) {
    console.error(`\nself-test FAILED (${fails.length})`);
    for (const f of fails) console.error(`  x ${f}`);
    process.exit(1);
  }
  // The argument filler, both ways: it passes on what the task literally
  // contains and nothing else. A filler that guessed would call strangers'
  // tools with invented inputs, which is the thing the router promises not to do.
  const addrSchema = { required: ['address'], properties: { address: { type: 'string' } } };
  const a1 = argsFromTask(addrSchema, 'measure the pool of token 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82');
  if (!a1 || a1.address !== '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82') fails.push('an address in the task was not passed to an address parameter');
  if (argsFromTask(addrSchema, 'measure the FOO pool') !== null) fails.push('a task with no address and no known symbol filled an address parameter anyway — that is guessing');
  const a3 = argsFromTask(addrSchema, 'measure the CAKE pool');
  if (!a3 || a3.address !== KNOWN_TOKENS.CAKE) fails.push('CAKE, a symbol that means one contract on this chain, was not read as its address');
  if (addressesInTask('measure the CAKE pool').symbols_read_as?.CAKE !== KNOWN_TOKENS.CAKE) fails.push('the answer would not say that CAKE was read as an address');
  if (addressesInTask('measure the pool 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82 for CAKE').symbols_read_as !== null) fails.push('a pasted address was second to a symbol');
  if (addressesInTask('what does a cake cost').addrs[0] !== KNOWN_TOKENS.CAKE) fails.push('a symbol in lower case was not read');
  if (addressesInTask('the ethereal question').addrs.length) fails.push('a word that merely starts with a symbol was read as one');
  // An optional address-like parameter is filled from the task, so a tool
  // that would otherwise default to its own account is asked about the
  // visitor's.
  const optSchema = { required: [], properties: { account: { type: 'string' }, depth: { type: 'number' } } };
  const a4 = argsFromTask(optSchema, 'health factor of 0xd319e1F8e987cf78333cEA853F455366640929cF');
  if (!a4 || a4.account !== '0xd319e1F8e987cf78333cEA853F455366640929cF' || 'depth' in a4) fails.push('an optional account parameter was not filled from the address in the task');
  if (argsFromTask(optSchema, 'health factor of my position') !== null) fails.push('an optional account parameter was filled with nothing to fill it from');
  // The answer must be about what was asked.
  const asked = ['0xd319e1F8e987cf78333cEA853F455366640929cF'];
  if (answersAsked('{"account":"0xa09991fc5D8637bb4245737C3ebF26E24D653962","debt":0}', asked)) fails.push('an answer about a different account passed as the answer');
  if (!answersAsked('{"account":"0xd319e1f8e987cf78333cea853f455366640929cf","hf":2.3}', asked)) fails.push('an answer about the asked account (lower case) was rejected');
  if (!answersAsked('{"tvl": 12}', asked)) fails.push('an answer that names no address at all was rejected');
  if (!answersAsked('anything', [])) fails.push('a task with no address had its answer rejected');
  // A request for an action is refused; a question about one is not.
  for (const t of ['swap 1 BNB to CAKE', 'please sell my CAKE', 'I want to buy BOBAI', 'build swap calldata and sign it', 'can you transfer 5 USDT to 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'])
    if (!askedAction(t).length) fails.push(`an order was not recognised as one: "${t}"`);
  for (const t of ['what would a $BOBAI trade cost', 'the swap fee of the CAKE pool', 'how much does a transaction cost on BSC', 'price impact of a $500 buy', 'is the sell tax measured'])
    if (askedAction(t).length) fails.push(`a question about an action was refused as an order: "${t}"`);
  // "to" before a verb is an order only after a word of intent (2026-09-24).
  for (const t of ['what does it cost to buy BOBAI', 'how much slippage to sell 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', 'is it safe to swap CAKE'])
    if (askedAction(t).length) fails.push(`a question about an action was refused as an order: "${t}"`);
  for (const t of ['I need to sell my CAKE', 'I am going to buy BOBAI', 'I want you to swap 1 BNB', 'help me to transfer USDT'])
    if (!askedAction(t).length) fails.push(`an order was not recognised as one: "${t}"`);
  // The broker weighs a word by how rare it is and matches it whole
  // (2026-09-24, P6): long descriptions no longer win a whole sentence.
  {
    const verbose = { id: 1, name: 'Everything Agent', description: 'get out again, check and route everything, a check before anything', tools: [] };
    const safety = { id: 2, name: 'Token Safety', description: 'honeypot and tax check for a token', tools: [] };
    const others = Array.from({ length: 20 }, (_, i) => ({ id: 10 + i, name: `other ${i}`, description: 'check a thing', tools: [] }));
    const poolF = [verbose, safety, ...others];
    const tsF = ['check', 'safe'];
    const wF = findTermWeights(poolF, tsF);
    if (!(wF.check < wF.safe)) fails.push('a word nearly every agent uses weighed as much as a rare one');
    if (!(findScore(safety, tsF, wF) > findScore(verbose, tsF, wF))) fails.push('"safe" did not find "Token Safety" ahead of a long description that only says "check"');
    if (findScore({ name: 'x', description: 'rescan the route', tools: [] }, ['scan'], null) !== 0) fails.push('a term matched inside another word');
    if (findScore({ name: 'x', description: 'a pool scanner', tools: [] }, ['scan'], null) === 0) fails.push('a four-letter term did not find the word it starts');
  }
  // Control words judge tool names only; in a sentence they are questions.
  for (const t of ['stop loss level for CAKE', 'set of pools for BOBAI', 'start price of the CAKE pool'])
    if (askedAction(t).length) fails.push(`a question was refused as an order on a control word: "${t}"`);
  // The dollar size in the task is the size answered, and only a figure
  // marked as dollars is one.
  const sizeSchema = { required: ['address'], properties: { address: { type: 'string' }, usd: { type: 'number' } } };
  for (const [t, want] of [['preflight 50000 $ of 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', 50000], ['a $2k buy of CAKE', 2000], ['cost of $500.', 500], ['2,000 USD into CAKE', 2000], ['$1.5k of CAKE', 1500]]) {
    const a = argsFromTask(sizeSchema, t) || { usd: usdInTask(t) };
    if (a.usd !== want) fails.push(`the dollar size in "${t}" was read as ${a.usd}, not ${want}`);
  }
  for (const t of ['preflight 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', 'what would a $BOBAI trade cost for CAKE', 'buy 500 CAKE', 'CAKE in block 123692264'])
    if (argsFromTask(sizeSchema, t)?.usd !== undefined) fails.push(`a dollar size was invented from "${t}"`);
  if (argsFromTask(sizeSchema, 'a $500 trade of FOO') !== null) fails.push('a dollar figure alone called a tool with nothing else to go on');
  if (argsFromTask({ required: ['address'], properties: { address: { type: 'string' }, depth: { type: 'number' } } }, 'CAKE $500')?.depth !== undefined) fails.push('a dollar size was put into a parameter that is not about dollars');
  // Tool choice reads content words, whole (2026-09-24, P2). Filler, an
  // address and a figure are not topics; "get", "can" and "out" inside
  // `topaz_get_user_dex_positions`, "scan" and "route" once outscored the tool
  // the question was about.
  const tt = taskTerms('check before a trade: 50000 $ of 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82, can I get out again');
  for (const w of ['can', 'get', 'of', '50000', '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82']) if (tt.includes(w)) fails.push(`"${w}" was kept as a topic word`);
  for (const w of ['check', 'trade', 'before', 'out']) if (!tt.includes(w)) fails.push(`"${w}" was dropped as a topic word`);
  const stranger = { name: 'topaz_get_user_dex_positions', description: 'Get a wallet user DEX positions, can scan routes' };
  const preflightTool = { name: 'bsc_token_preflight', description: 'The check to run before every trade: can I get in, and can I get out again' };
  if (scoreTool(stranger, tt) >= scoreTool(preflightTool, tt)) fails.push('a tool matching only filler scored at least as high as the tool the question was about');
  if (scoreTool({ name: 'get_routes', description: 'rescan about' }, ['scan', 'out', 'can']) !== 0) fails.push('a term matched inside another word');
  if (scoreTool({ name: 'get_pools', description: '' }, ['pool']) !== 3) fails.push('a plural in a tool name did not match the singular in the task');
  if (argsFromTask({ required: ['symbol'], properties: { symbol: { type: 'string' } } }, 'price of CAKE 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82') !== null) fails.push('a parameter the task cannot name was filled anyway');
  const a2 = argsFromTask({ required: ['token', 'chainId'], properties: { token: { type: 'string' }, chainId: { type: 'number' } } }, 'scan 0x245c386dcfed896f5c346107596141e5edcbffff');
  if (!a2 || a2.token !== '0x245c386dcfed896f5c346107596141e5edcbffff' || a2.chainId !== 56) fails.push('the chain this router serves was not filled in beside the address');
  if (argsFromTask({ required: [] }, 'anything') !== null) fails.push('a tool with no required arguments was given some');

  // ---- the three routing defects of 2026-09-27, both ways ----
  // 1. A named pair reaches the tool whole. "best CAKE/BNB range" passed CAKE
  //    alone and was answered for Cake/USDT.
  const rangeSchema = { required: ['address'], properties: { address: { type: 'string' }, capitalUsd: { type: 'number' }, quote: { type: 'string' } } };
  const r1 = argsFromTask(rangeSchema, 'best CAKE/BNB range');
  if (!r1 || r1.address !== KNOWN_TOKENS.CAKE || r1.quote !== KNOWN_TOKENS.WBNB) fails.push(`"best CAKE/BNB range" did not pass BNB as the quote (got ${JSON.stringify(r1)})`);
  if (argsFromTask(rangeSchema, 'best CAKE range')?.quote !== undefined) fails.push('a quote was invented for a task that names one token');
  const qtSchema = { required: ['address'], properties: { address: { type: 'string' }, quoteToken: { type: 'string' } } };
  if (argsFromTask(qtSchema, 'range for CAKE')?.quoteToken !== undefined) fails.push('a quote parameter was handed the token itself when only one was named');
  if (argsFromTask(qtSchema, 'range for CAKE/USDT')?.quoteToken !== KNOWN_TOKENS.USDT) fails.push('a quoteToken parameter did not get the second token of the pair');
  // The range tool must be able to take it: without the parameter the pair is
  // dropped again at the tool, whatever the router passes.
  {
    const rd = (p) => fsPins.readFileSync(new URL(p, import.meta.url), 'utf8');
    const line = (src) => src.split('\n').find((l) => l.includes("name: 'pancakeswap_range_plan'")) || '';
    if (!/quote: \{ type: 'string'/.test(line(rd('../dashboard/_worker.js')))) fails.push('pancakeswap_range_plan on /mcp declares no quote parameter — a named pair is dropped');
    if (!/quote: \{ type: 'string'/.test(line(rd('../mcp/server.mjs'))) || !/params: \{[^}]*quote: 'quote'/.test(line(rd('../mcp/server.mjs')))) fails.push('the stdio server\'s pancakeswap_range_plan does not declare and forward quote');
    if (!/opts\.quote/.test(rd('../dashboard/range-scan.js'))) fails.push('rangePlan reads no quote — it picks the deepest quote whatever was asked');
  }
  // 2. A size in the task prefers the tool that takes a size; a size alone
  //    picks nothing, and no size adds nothing.
  {
    const t2 = 'is 0x245c386dcfed896f5c346107596141e5edcbffff safe to buy for $500';
    const stranger2 = { name: 'analyse', description: 'Is the token safe: proxy, owner, liquidity.', inputSchema: { properties: { token: { type: 'string' } } } };
    const ours2 = { name: 'bsc_token_preflight', description: 'Before a trade: is it safe to get in and out.', inputSchema: { properties: { address: { type: 'string' }, usd: { type: 'number' } } } };
    const tt2 = taskTerms(t2);
    if (scoreTool(stranger2, tt2) !== scoreTool(ours2, tt2)) fails.push('fixture drift: the two safety tools no longer tie on words, so the size pin tests nothing');
    if (!(rankTool(ours2, tt2, t2) > rankTool(stranger2, tt2, t2))) fails.push('a task with a dollar size did not prefer the tool that takes the size — the $500 is dropped again');
    const t2n = 'is 0x245c386dcfed896f5c346107596141e5edcbffff safe to buy';
    if (rankTool(ours2, taskTerms(t2n), t2n) !== scoreTool(ours2, taskTerms(t2n))) fails.push('a task with no dollar size still ranked a size-taking tool up');
    if (rankTool({ name: 'xyz_usd', description: 'nothing', inputSchema: { properties: { usd: { type: 'number' } } } }, tt2, t2) !== 0) fails.push('a dollar figure alone ranked a tool that matched no word of the task');
  }
  //    An answer too long to pass on is shortened by its shape, never cut
  //    inside a string: 28,809 characters cut at 12,000 reached the Plaza
  //    page as JSON that no longer parsed.
  {
    const big = JSON.stringify({ verdict: 'caution', holders: Array.from({ length: 400 }, (_, i) => ({ address: '0x' + String(i).padStart(40, '0'), note: 'x'.repeat(40) })), log: 'y'.repeat(9000) });
    const c = capAnswer(big, 12000);
    const out = JSON.stringify(c.value);
    if (typeof c.value !== 'object' || c.value === null) fails.push('an oversized JSON answer came back as text, not as JSON');
    else if (out.length > 12000) fails.push(`an oversized JSON answer was not brought under the cap (${out.length})`);
    else if (c.value.verdict !== 'caution') fails.push('shortening an oversized answer lost its short fields');
    if (!c.cut) fails.push('an oversized answer was shortened without saying so');
    if (big.slice(0, 12000) === (typeof c.value === 'string' ? c.value : null)) fails.push('an oversized JSON answer was cut mid-string, the old way');
    const small = capAnswer('{"hf":2.4}');
    if (small.cut || small.value?.hf !== 2.4) fails.push('a small JSON answer was not passed on as it came');
    const txt = capAnswer('z'.repeat(13000), 12000);
    if (typeof txt.value !== 'string' || !txt.cut || !/more characters cut\]$/.test(txt.value)) fails.push('an oversized plain-text answer was not cut and marked');
  }
  // 3. An answer without the field asked for is not the answer.
  {
    const t3 = 'health factor of 0xd319e1F8e987cf78333cEA853F455366640929cF on Venus';
    if (answersField('{"account":"0xd319e1F8e987cf78333cEA853F455366640929cF","markets":[],"debt_usd":1}', t3)) fails.push('an answer with no health factor passed as the answer to a health-factor question');
    if (!answersField('{"account":"0xd319…","pools":[{"health_factor":2.41}]}', t3)) fails.push('an answer carrying health_factor was rejected');
    if (!answersField('{"healthFactor":"2.4"}', t3)) fails.push('an answer carrying healthFactor was rejected');
    if (!answersField('{"tvl":1}', 'tvl of the CAKE pool')) fails.push('a task that names no known field had its answer rejected');
    const named = { name: 'get_health_factor', description: 'venus' };
    if (rankTool(named, taskTerms(t3), t3) - scoreTool(named, taskTerms(t3)) !== 3) fails.push('a tool named after the asked field was not ranked up');
  }
  // All three through the real dispatcher, over fixtures: the broker, the
  // tool lists and the answers are served from memory, so this pins the loop
  // itself — which tool is called, with what, and what is passed on.
  {
    const CAKE = KNOWN_TOKENS.CAKE, BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff', ACC = '0xd319e1F8e987cf78333cEA853F455366640929cF';
    const S = (props, req) => ({ type: 'object', properties: props, required: req });
    const servers = {
      'https://stranger.example/mcp': [
        { name: 'analyse', description: 'Token safety: is the token safe, proxy, owner, liquidity. Read-only.', inputSchema: S({ token: { type: 'string' } }, ['token']),
          answer: () => JSON.stringify({ subject: BOBAI, verdict: 'caution', holders: Array.from({ length: 500 }, (_, i) => ({ address: '0x' + String(i).padStart(40, '0'), share: i })) }) },
      ],
      'https://ours.example/mcp': [
        { name: 'bsc_token_preflight', description: 'Before a trade: is it safe to get in and out, at your size.', inputSchema: S({ address: { type: 'string' }, usd: { type: 'number' } }, ['address']),
          answer: (a) => JSON.stringify({ token: a.address, size_usd: a.usd ?? 250 }) },
        { name: 'pancakeswap_range_plan', description: 'Which price range for a V3 position: returns the fees each width collected.', inputSchema: S({ address: { type: 'string' }, capitalUsd: { type: 'number' }, quote: { type: 'string' } }, ['address']),
          answer: (a) => JSON.stringify({ token: a.address, quote: a.quote ?? 'deepest' }) },
      ],
      'https://guardian.example/mcp': [
        { name: 'get_position', description: 'Every Venus market the account touches; they count toward the health factor.', inputSchema: S({ account: { type: 'string' } }, []),
          answer: (a) => JSON.stringify({ account: a.account, markets: [] }) },
        { name: 'get_risk', description: 'Health factor and liquidation distance.', inputSchema: S({ account: { type: 'string' } }, []),
          answer: (a) => JSON.stringify({ account: a.account, health_factor: 2.41 }) },
      ],
    };
    const agents = [
      { id: 900001, name: 'Token Safety Analyse', description: 'token safety', speaks: ['mcp'], endpoints: ['https://stranger.example/mcp'], tools: servers['https://stranger.example/mcp'] },
      { id: 900002, name: 'Pre-trade', description: 'before a trade; price ranges', speaks: ['mcp'], endpoints: ['https://ours.example/mcp'], tools: servers['https://ours.example/mcp'] },
      { id: 900003, name: 'Lending Guardian', description: 'venus health factor', speaks: ['mcp'], endpoints: ['https://guardian.example/mcp'], tools: servers['https://guardian.example/mcp'] },
    ].map((a) => ({ ...a, tools: a.tools.map(({ name, description }) => ({ name, description })) }));
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, init = {}) => {
      const url = String(u);
      if (url.endsWith('/api-agents.json')) return new Response(JSON.stringify({ agents }));
      const tools = servers[url];
      if (!tools) return new Response('not here', { status: 404 });
      const { method, params } = JSON.parse(init.body || '{}');
      if (method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: tools.map(({ answer, ...t }) => t) } }));
      const t = tools.find((x) => x.name === params?.name);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: t.answer(params.arguments || {}) }] } }));
    };
    const ask = async (task) => (await handleDispatch(new URL('https://agent.brainonbnb.com/dispatch'), { task }, null, {})).body;
    try {
      const d1 = await ask('best CAKE/BNB range');
      if (d1.answered_by?.tool !== 'pancakeswap_range_plan' || d1.arguments_taken_from_task?.quote !== KNOWN_TOKENS.WBNB) fails.push(`dispatch: "best CAKE/BNB range" did not reach the range tool with BNB as quote (${d1.answered_by?.tool}, ${JSON.stringify(d1.arguments_taken_from_task)})`);
      const d2 = await ask(`is ${BOBAI} safe to buy for $500`);
      if (d2.answered_by?.tool !== 'bsc_token_preflight' || d2.arguments_taken_from_task?.usd !== 500) fails.push(`dispatch: a sized pre-trade question went to ${d2.answered_by?.tool} with ${JSON.stringify(d2.arguments_taken_from_task)}, not to the preflight at $500`);
      const d2b = await ask(`analyse token safety of ${BOBAI}`);
      if (d2b.answered_by?.tool !== 'analyse') fails.push(`dispatch fixture drift: the oversized answer was not produced (${d2b.answered_by?.tool})`);
      else if (typeof d2b.result !== 'object' || !d2b.truncated || JSON.stringify(d2b.result).length > 12000) fails.push('dispatch: an oversized JSON answer was not passed on as shortened JSON');
      const d3 = await ask(`health factor of ${ACC} on Venus`);
      if (d3.answered_by?.tool !== 'get_risk' || d3.result?.health_factor !== 2.41) fails.push(`dispatch: a health-factor question was answered by ${d3.answered_by?.tool}, without the health factor`);
      if (!(d3.attempts || []).some((x) => x.tool === 'get_position' && /without the health factor/.test(x.outcome))) fails.push('dispatch: the answer without the health factor was not named in attempts');
    } catch (e) {
      fails.push(`dispatch over fixtures threw: ${e?.message || e}`);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  if (fails.length) { for (const f of fails) console.log('  x ' + f); process.exitCode = 1; }
  else console.log('argument filler: an address in the task is passed on, nothing is guessed, a tool with no arguments gets none');
  console.log(`self-test passed: ${MUST_ACCEPT.length} readers reachable, ${MUST_REFUSE.length} writers refused, declarations honoured in both directions`);
  if (!args.includes('--live')) process.exit(0);
}

// ---- the domain proof, on both origins, against what is actually on-chain ----
//
// An ERC-8004 verifier fetches /.well-known/agent-registration.json on the host
// an agent names, and believes the ids it finds there. That list is written by
// hand in two files — dashboard/_worker.js and worker-agent/index.js — and both
// carry a comment asking whoever edits one to remember the other. A comment is
// not a check. #49467 sat unverified for months on exactly this.
//
// The truth is data/own-agents.json, written by the registration script from
// the transaction receipt. Both origins are held against it.
{
  const { default: state } = await import('../data/own-agents.json', { with: { type: 'json' } });
  const registered = Object.values(state.agents || {}).map((a) => a.id).sort((a, b) => a - b);
  const PARENT = 49467;
  const expected = [...new Set([...registered, PARENT])].sort((a, b) => a - b);

  const origins = ['https://brainonbnb.com', 'https://agent.brainonbnb.com'];
  console.log('\nDomain proof — the ids each origin claims, against the chain');
  for (const origin of origins) {
    const doc = await fetch(`${origin}/.well-known/agent-registration.json`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!doc) { console.error(`  ${origin} — did not serve the proof`); process.exitCode = 1; continue; }
    const claimed = (doc.registrations || []).map((r) => Number(r.agentId)).sort((a, b) => a - b);
    const missing = expected.filter((id) => !claimed.includes(id));
    const extra = claimed.filter((id) => !expected.includes(id));
    if (missing.length || extra.length) {
      console.error(`  ${origin} — claims ${claimed.length}, expected ${expected.length}`);
      if (missing.length) console.error(`      missing (unattributable on this host): ${missing.join(', ')}`);
      if (extra.length) console.error(`      claims an id we have no receipt for: ${extra.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(`  ${origin} — all ${claimed.length} ids, matching the receipts`);
    }
  }
}

// ---- live: how much of our own server can our own router actually reach ----
const listed = await fetch(`${SITE}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}).then((r) => r.json()).catch(() => null);

const tools = listed?.result?.tools || [];
if (!tools.length) {
  console.error('tools/list did not answer — nothing measured');
  process.exit(1);
}

// Two different things get called "refused" and only one of them is a bug.
//
// A tool whose NAME carries a mutating verb is refused by design, and the rule
// is not going to be relaxed: it is what stops `get_swap_calldata`. When one of
// ours lands there it is a naming debt of ours, not a reason to loosen the rule.
// Two of ours sat here — `bobai_trade_info` and `bobai_how_to_buy`, both pure
// readers named after the thing they read about — and on 29 August they were
// renamed to `bobai_dex_info` and `bobai_purchase_guide` instead. The old names
// still answer as deprecated aliases; they are simply no longer advertised, so
// nothing a stranger's router can see carries a verb it has to refuse. This
// list stays for the next one: it is worth knowing, not worth failing on.
//
// A tool refused for any other reason IS a bug, because everything this server
// publishes reads: the worker holds no key and has nothing to spend.
const MUTATING_IN_NAME = /(^|_)(build|create|send|submit|sign|execute|swap|trade|order|buy|sell|deposit|withdraw|transfer|approve|revoke|deploy|mint|burn|stake|unstake|vote|claim|cancel|update|delete|write|pay|bridge|redeem|register|authorize|confirm|calldata|tx|transaction)(_|$)/;

const reachable = tools.filter((t) => isReadOnly(t));
const refused = tools.filter((t) => !isReadOnly(t));
const byName = refused.filter((t) => MUTATING_IN_NAME.test(t.name));
const unexplained = refused.filter((t) => !MUTATING_IN_NAME.test(t.name));
const declared = tools.filter((t) => t.annotations?.readOnlyHint === true);

console.log(`\nRouter reach — ${SITE}`);
console.log(`  ${reachable.length} of ${tools.length} tools reachable by our own dispatcher`);
console.log(`  ${declared.length} declare readOnlyHint, which is what a stranger's router reads`);
if (byName.length) {
  console.log(`\n  refused on the verb in their own name — by design, and our naming debt:`);
  for (const t of byName) console.log(`    ${t.name}`);
}
if (unexplained.length) {
  console.log(`\n  refused with nothing in the name to explain it — this is the bug shape:`);
  for (const t of unexplained) console.log(`    ${t.name}`);
  console.error(`\n${unexplained.length} reader(s) unreachable for no nameable reason.`);
  process.exitCode = 1;
} else {
  console.log('\nevery tool not named after an action can be reached by the router.');
}
