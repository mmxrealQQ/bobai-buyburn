// The x402 catalogue: /.well-known/x402
//
// A 402 tells an agent the price once it has already found the endpoint. This
// file is the other direction — it lets an agent that has only our domain find
// out that we sell anything at all, what it costs, and where to send the money,
// without calling a paid route to discover it.
//
// Format taken from a working catalogue rather than a specification, because no
// public specification defines it: Dexter serves version 1 with exactly these
// four fields, and aggregators read it. See scripts/x402-catalog-proof.mjs for
// how the ownership-proof message format was recovered, and docs/x402-catalog.md
// for the whole derivation.
//
// ONE SOURCE: payTo and the price are passed in from the worker that also
// answers the 402, never re-declared here. A catalogue quoting a price the
// endpoint does not charge is worse than no catalogue — it is a public,
// machine-readable lie, and an agent that budgeted against it fails at payment.

// Signatures over the bare origin string, EIP-191, by the wallet that receives
// payment. Generated offline by scripts/x402-catalog-proof.mjs; the private key
// is deliberately absent from this worker.
//
// Both are shipped in the one document so the same bytes verify whether they
// were fetched from the agent subdomain or the main domain. A verifier picks the
// proof that recovers to our payTo for the origin it used; the other simply does
// not match, which is the correct outcome, not an error.
export const OWNERSHIP_PROOFS = {
  'https://agent.brainonbnb.com':
    '0x073f1bf5e215bed2faa830c855968781bd343f94b20fff624aa6f55a4e680fe31a8dc8b2379b93e57fdaf3b880b01ca1765f8c97138be2e12685dab8810e52c51b',
  'https://brainonbnb.com':
    '0x64c3a9a9872b5837526234ebf1560bdac309968f3d5892b0a4381650b1c6eff0141d2e2858cc5c4c4d8b06b880794f799909f8f147e66ccf430547664e299cf61b',
};

// Only endpoints that actually answer 402 belong in resources[]. Our free
// surface is much larger than our paid one, but listing a free URL here would
// tell a client to prepare a payment for something that never asks for one.
// The free tools are named in the instructions instead, where an agent reading
// the catalogue will still find them.
// Since 2026-09-03 the deliveries (ANSWER_IDS, counted, never typed) are sold per answer here too — the
// same doWork() the ERC-8183 escrow path runs, one payment, the document
// straight back. Each is its own resource because each has its own inputs.
const ANSWER_IDS = ['health_factor', 'grid_plan', 'yield_plan', 'rebalance_plan', 'lp_tier_plan', 'lp_position_plan'];
const ANSWER_NAMES = {
  health_factor: 'Venus health factor & liquidation distance for an address',
  grid_plan: 'Grid trading plan for a BNB Chain pool, costed against the real pool',
  yield_plan: 'Venus yield ranking, and whether moving pays for itself',
  rebalance_plan: 'Portfolio rebalance, priced against the pools that would execute it',
  lp_tier_plan: 'Which PancakeSwap fee tier is actually paying its liquidity providers',
  lp_position_plan: 'The DeFi agent on YOUR PancakeSwap V3 position: in range, worth, fees owed, whether a re-set is due and in which width — the same code that runs ours. Reads and plans, signs nothing',
};
const PAID_RESOURCES = [
  'https://agent.brainonbnb.com/watch',
  ...ANSWER_IDS.map((id) => `https://agent.brainonbnb.com/answer?service=${id}`),
];

function instructions({ payTo, price, days, asset, network }) {
  return `# Brain On BNB AI — agent service

Measurement of BNB Smart Chain liquidity, sold per resource over [x402](https://x402.org).
No API key, no account, no signup. Measurement only — nothing here is financial advice.

## Payment

- **Asset**: USD1 (\`${asset}\`) on BNB Smart Chain (\`${network}\`) by direct transfer; the facilitator route (way 1 below, \`accepts[0]\` in every 402) settles the same amount in USDC
- **Pay to**: \`${payTo}\`
- **Header**: send proof in \`PAYMENT-SIGNATURE\`

Two ways to pay the same price into the same wallet, advertised side by side in
every 402. A client takes whichever it can execute:

1. **Standard x402**, scheme \`exact\`, settled through the public Dexter
   facilitator (\`https://x402.dexter.cash\`) via Permit2. Gas is sponsored, so
   neither side pays it. Any stock x402 v2 client does this unattended.
2. **Direct transfer** — send USD1 yourself, then repeat the request with the
   transaction hash in \`PAYMENT-SIGNATURE\`. Needs no facilitator and no
   signature support, which is why it exists.

## Paid resources

| Endpoint | Description | Price |
|----------|-------------|-------|
| \`POST /watch\` | Watch one PancakeSwap pool around the clock for ${days} days. Records depth every 15 minutes and POSTs your callback when the pool can no longer absorb a trade of your chosen size. | ${price} |
${ANSWER_IDS.map((id) => `| \`POST /answer?service=${id}\` | ${ANSWER_NAMES[id]}. One payment, the answer at once: send \`{"task":"…"}\` with the address in it, or \`{"params":{…}}\`. Free preview of the shape at \`GET /example?service=${id}\`. | 0.10 USD1 |`).join('\n')}

Call any of them once **without** payment and it answers 402 with the price,
the payment options and the inputs it needs. That call is free and is the
intended way to discover terms. \`GET /answer\` lists the ${ANSWER_IDS.length} in one document.

${ANSWER_IDS.length - 1} of the ${ANSWER_IDS.length} answers are also sold through the ERC-8183 escrow on
\`https://brainonbnb.com/registry\`, at the same price, for a buyer who wants
a kernel between them and the seller. Here there is no job and no dispute
window: the money moves, the document comes back.

The same watch is sold over MCP as the tool \`bsc_pool_watch\` at
\`https://agent.brainonbnb.com/mcp\`. It is the same product and the same price;
MCP is not listed as a resource above because it negotiates payment inside the
tool result rather than with an HTTP 402.

## Free — no payment, now or later

Measuring a pool **once** is free and always will be. Only continuous monitoring
is paid, because something has to still be running in an hour.

| Where | What |
|-------|------|
| \`GET https://brainonbnb.com/api/preflight?address=0x…&usd=250\` | Before a trade of any BSC token, at your size: what stops it, what to weigh, the route, the slippage it needs and the round trip with the measured tax — one short answer. MCP tool \`bsc_token_preflight\` |
| \`https://brainonbnb.com/mcp\` | MCP server, read-only: measure any BSC pool before trading it, search the ERC-8004 registry, read the census |
| \`https://brainonbnb.com/api/*\` | The same tools as plain GET, for agents that do not speak MCP |
| \`https://brainonbnb.com/scanner\` | The measurement in a browser |
| \`npx skills add https://brainonbnb.com\` | The same measurement as an installable agent skill |
| \`GET https://agent.brainonbnb.com/find?q=…\` | Broker: ERC-8004 agents on BNB Chain that expose something matching |
| \`GET https://agent.brainonbnb.com/lp/look?position=…\` | The DeFi agent's look at any PancakeSwap V3 position: in range, room, value, fees owed. The plan is the paid \`lp_position_plan\` |
| \`POST https://agent.brainonbnb.com/dispatch\` | Routes a task to an agent that can answer it and names who produced the result. Read-only tools only — anything that signs, sends or swaps is listed for you to call yourself, never invoked on your behalf. |
| \`GET https://agent.brainonbnb.com/sessions\` | Every task routed, who answered, how long it took, what failed |

## Transparency

\`https://agent.brainonbnb.com/stats\` reports what this service has been asked
for and what happened to the money. Revenue is sold for BNB into the project's
own PancakeSwap liquidity position; of the fees that position earns, half
stays in it as capital and half buys $BOBAI that the agent holds. Every step is
on-chain, and the daily record is at \`https://agent.brainonbnb.com/lp/agent\`.

## Identity

- **ERC-8004**: agent #49467 on BNB Smart Chain
- **A2A agent card**: https://agent.brainonbnb.com/.well-known/agent-card.json (the sellers, with prices and inputs; the parent identity's card is at https://brainonbnb.com/.well-known/agent-card.json)
- **Site**: https://brainonbnb.com
`;
}

// Built fresh per request from the caller's own constants. Cheap, and it means
// the catalogue cannot drift from the 402 the way a hand-written file would.
export function buildCatalog({ payTo, price, days, asset, network }) {
  return {
    version: 1,
    resources: PAID_RESOURCES,
    ownershipProofs: Object.values(OWNERSHIP_PROOFS),
    instructions: instructions({ payTo, price, days, asset, network }),
  };
}
