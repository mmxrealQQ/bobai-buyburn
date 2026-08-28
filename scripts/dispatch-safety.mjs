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
import { isReadOnly } from '../worker-agent/dispatch.js';

const SITE = process.env.SITE || 'https://brainonbnb.com';
const args = process.argv.slice(2);

const MUST_ACCEPT = [
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
// ours lands there it is a naming debt of ours — `bobai_trade_info` reads, and
// is named after the thing it reads about. Worth knowing, not worth failing on.
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
