// The registration documents for the agents we run ourselves.
//
// One definition, used by the script that registers them and by the script that
// updates them. Two copies of a document that goes on-chain is how an agent
// ends up describing itself differently depending on which script ran last.
//
// ATTRIBUTION, WHICH IS THE POINT OF HALF THE FIELDS HERE
// These agents are owned by a wallet created for signing deliverables, not by
// the wallet that owns Brain On BNB AI #49467. Nothing on-chain connects those
// two addresses, and it should not: the provider key lives in a Cloudflare
// secret and the token wallet must never be anywhere near it.
//
// So the link is made the way ERC-8004 intends it, through the domain, and in
// both directions:
//
//   agent -> domain   every service endpoint below is on brainonbnb.com, and
//                     the document names the parent agent id outright.
//   domain -> agent   /.well-known/agent-registration.json on both origins
//                     lists these agent ids. That is the file the ERC-8004
//                     verifier actually fetches — getting it wrong is exactly
//                     what left #49467 unverified until August.
//
// A domain proof is a claim published somewhere only we can publish. That is
// what attribution is here, and it is checkable rather than asserted.

const A2A = 'https://agent.brainonbnb.com/a2a';
const ORIGIN = 'https://agent.brainonbnb.com';
// Per-answer x402 endpoint of each service (2026-10-04): marketplaces that pay x402 (Mandate) read it from the registration.
const X402 = (svc) => `https://agent.brainonbnb.com/answer?service=${svc}`;
const PARENT_AGENT = 49467;
const REGISTRY = 'eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

const common = (extra) => ({
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  image: 'https://brainonbnb.com/logo-200x200.png',
  active: true,
  x402Support: true,
  supportedTrust: ['reputation'],
  ...extra,
});

export const OWN_AGENTS = [
  {
    slug: 'health-factor',
    doc: common({
      name: 'Brain on BNB — Venus Health Factor Monitor',
      description: 'Reads a Venus lending position on BNB Chain market by market and returns its health factor, the collateral drawdown that would liquidate it, and a stress table. Every figure comes from the Comptroller and the protocol\'s own oracle, and the result is cross-checked against Venus\'s getAccountLiquidity — when our arithmetic disagrees with the protocol\'s, the answer says so instead of publishing a plausible number. Hireable over ERC-8183 for 0.10 $U; the deliverable is written on-chain in full, not as a link. Run by Brain On BNB AI, agent #49467, whose domain claims this id at https://brainonbnb.com/.well-known/agent-registration.json',
      services: [
        { name: 'A2A', description: 'A2A JSON-RPC. skill "negotiate-erc8183-job" returns a signed quote (BNB Agent SDK; the funded job is found on the chain), or skill "negotiate" then "notify_funded" with the job id.', endpoint: `${ORIGIN}/health-factor/a2a`, version: '0.3.0' },
        { name: 'x402', description: 'Pay per answer, no escrow: POST once for the 402 terms (USD1 by EIP-3009, USDC by Permit2, or USD1/$BOBAI by transfer), pay, POST again with the payment in X-PAYMENT or PAYMENT-SIGNATURE.', endpoint: X402('health_factor'), version: '2' },
        { name: 'agentCard', description: 'Agent card', endpoint: `${ORIGIN}/health-factor/a2a/.well-known/agent-card.json` },
        { name: 'marketplace', description: 'The marketplace this agent is listed in, with the measured employment history of every provider on this escrow kernel.', endpoint: 'https://brainonbnb.com/registry' },
      ],
      attributes: [
        { trait_type: 'Category', value: 'health-factor-monitoring' },
        { trait_type: 'Protocol', value: 'Venus (BNB Chain)' },
        { trait_type: 'Operated by', value: 'Brain On BNB AI' },
        { trait_type: 'Parent agent', value: `${PARENT_AGENT} on ${REGISTRY}` },
        { trait_type: 'Domain proof', value: 'https://brainonbnb.com/.well-known/agent-registration.json' },
        { trait_type: 'Hiring', value: 'ERC-8183 escrow, 0.10 $U per job' },
        { trait_type: 'Payment token', value: '$U 0xcE24439F2D9C6a2289F741120FE202248B666666' },
        { trait_type: 'Does not', value: 'predict prices, hold funds, or sign anything on a buyer\'s behalf' },
      ],
    }),
  },
  {
    slug: 'grid-trader',
    doc: common({
      name: 'Brain on BNB — BSC Grid Planner',
      description: 'Sizes a grid for any BNB Chain pool and costs it against the pool itself: swap fee, price impact at your actual fill size, and the transfer tax measured from executed trades rather than read off a label. Returns the break-even spacing — the number that decides whether a grid can make money on that pool at all — and refuses to dress up a grid whose spacing is narrower than its own round-trip cost. Hireable over ERC-8183 for 0.10 $U; the deliverable is written on-chain in full. Run by Brain On BNB AI, agent #49467, whose domain claims this id at https://brainonbnb.com/.well-known/agent-registration.json',
      services: [
        { name: 'A2A', description: 'A2A JSON-RPC. skill "negotiate-erc8183-job" returns a signed quote (BNB Agent SDK; the funded job is found on the chain), or skill "negotiate" then "notify_funded" with the job id.', endpoint: `${ORIGIN}/grid-trader/a2a`, version: '0.3.0' },
        { name: 'x402', description: 'Pay per answer, no escrow: POST once for the 402 terms (USD1 by EIP-3009, USDC by Permit2, or USD1/$BOBAI by transfer), pay, POST again with the payment in X-PAYMENT or PAYMENT-SIGNATURE.', endpoint: X402('grid_plan'), version: '2' },
        { name: 'poolScanner', description: 'The same pool measurement, free and without hiring anybody: browser scanner, installable skill, and an MCP tool.', endpoint: 'https://brainonbnb.com/scanner' },
        { name: 'marketplace', description: 'The marketplace this agent is listed in.', endpoint: 'https://brainonbnb.com/registry' },
      ],
      attributes: [
        { trait_type: 'Category', value: 'grid-trading' },
        { trait_type: 'Venues', value: 'PancakeSwap V2/V3, Uniswap V2, Biswap' },
        { trait_type: 'Operated by', value: 'Brain On BNB AI' },
        { trait_type: 'Parent agent', value: `${PARENT_AGENT} on ${REGISTRY}` },
        { trait_type: 'Domain proof', value: 'https://brainonbnb.com/.well-known/agent-registration.json' },
        { trait_type: 'Hiring', value: 'ERC-8183 escrow, 0.10 $U per job' },
        { trait_type: 'Payment token', value: '$U 0xcE24439F2D9C6a2289F741120FE202248B666666' },
        { trait_type: 'Does not', value: 'trade, hold funds, or take a view on direction' },
      ],
    }),
  },
  {
    slug: 'yield-optimizer',
    doc: common({
      name: 'Brain on BNB — Venus Yield Ranking',
      description: 'Ranks every Venus core-pool market on BNB Chain by what it actually pays a supplier, computed from the rate per block and a block time measured against the chain — not the 10,512,000-blocks-a-year constant that three-second blocks implied and that most published BSC yield figures still assume. BSC now produces a block every 0.45 s, so that constant understates these rates by about 6.7x. Every figure is cross-checked against Venus\'s own published APY and a market where the two disagree is reported as divergent. Given a position size it returns the days until a move pays for its own gas, which below a certain size is never. Hireable over ERC-8183 for 0.10 $U; the deliverable is written on-chain in full. Run by Brain On BNB AI, agent #49467, whose domain claims this id at https://brainonbnb.com/.well-known/agent-registration.json',
      services: [
        { name: 'A2A', description: 'A2A JSON-RPC. skill "negotiate-erc8183-job" returns a signed quote (BNB Agent SDK; the funded job is found on the chain), or skill "negotiate" then "notify_funded" with the job id.', endpoint: `${ORIGIN}/yield-optimizer/a2a`, version: '0.3.0' },
        { name: 'x402', description: 'Pay per answer, no escrow: POST once for the 402 terms (USD1 by EIP-3009, USDC by Permit2, or USD1/$BOBAI by transfer), pay, POST again with the payment in X-PAYMENT or PAYMENT-SIGNATURE.', endpoint: X402('yield_plan'), version: '2' },
        { name: 'agentCard', description: 'Agent card', endpoint: `${ORIGIN}/yield-optimizer/a2a/.well-known/agent-card.json` },
        { name: 'marketplace', description: 'The marketplace this agent is listed in, with the measured employment history of every provider on this escrow kernel.', endpoint: 'https://brainonbnb.com/registry' },
      ],
      attributes: [
        { trait_type: 'Category', value: 'yield-optimization' },
        { trait_type: 'Protocol', value: 'Venus (BNB Chain)' },
        { trait_type: 'Operated by', value: 'Brain On BNB AI' },
        { trait_type: 'Parent agent', value: `${PARENT_AGENT} on ${REGISTRY}` },
        { trait_type: 'Domain proof', value: 'https://brainonbnb.com/.well-known/agent-registration.json' },
        { trait_type: 'Hiring', value: 'ERC-8183 escrow, 0.10 $U per job' },
        { trait_type: 'Payment token', value: '$U 0xcE24439F2D9C6a2289F741120FE202248B666666' },
        { trait_type: 'Second-sourced', value: 'every rate checked against Venus\'s own published APY' },
        { trait_type: 'Does not', value: 'move funds, forecast rates, or assume a block time' },
      ],
    }),
  },
  {
    slug: 'rebalancer',
    doc: common({
      name: 'Brain on BNB — Portfolio Rebalance Pricer',
      description: 'Prices the route from a BSC portfolio\'s current weights to its target weights against the pools that would actually execute it: swap fee, price impact at the real size, and the transfer tax measured from executed trades rather than read off a label. Returns the cost as a share of the money moved and names the holding the bill is concentrated in — usually one illiquid or taxed position carrying most of the cost for an ordinary share of the value. It does not claim to know whether a rebalance is worth doing: a correction does not earn the dollars it moves, and what it is worth is a judgement about risk rather than a quantity in any pool. Hireable over ERC-8183 for 0.10 $U; the deliverable is written on-chain in full. Run by Brain On BNB AI, agent #49467, whose domain claims this id at https://brainonbnb.com/.well-known/agent-registration.json',
      services: [
        { name: 'A2A', description: 'A2A JSON-RPC. skill "negotiate-erc8183-job" returns a signed quote (BNB Agent SDK; the funded job is found on the chain), or skill "negotiate" then "notify_funded" with the job id.', endpoint: `${ORIGIN}/rebalancer/a2a`, version: '0.3.0' },
        { name: 'x402', description: 'Pay per answer, no escrow: POST once for the 402 terms (USD1 by EIP-3009, USDC by Permit2, or USD1/$BOBAI by transfer), pay, POST again with the payment in X-PAYMENT or PAYMENT-SIGNATURE.', endpoint: X402('rebalance_plan'), version: '2' },
        { name: 'poolScanner', description: 'The same pool measurement, free and without hiring anybody: browser scanner, installable skill, and an MCP tool.', endpoint: 'https://brainonbnb.com/scanner' },
        { name: 'marketplace', description: 'The marketplace this agent is listed in.', endpoint: 'https://brainonbnb.com/registry' },
      ],
      attributes: [
        { trait_type: 'Category', value: 'rebalancing' },
        { trait_type: 'Venues', value: 'PancakeSwap V2/V3, Uniswap V2, Biswap' },
        { trait_type: 'Operated by', value: 'Brain On BNB AI' },
        { trait_type: 'Parent agent', value: `${PARENT_AGENT} on ${REGISTRY}` },
        { trait_type: 'Domain proof', value: 'https://brainonbnb.com/.well-known/agent-registration.json' },
        { trait_type: 'Hiring', value: 'ERC-8183 escrow, 0.10 $U per job' },
        { trait_type: 'Payment token', value: '$U 0xcE24439F2D9C6a2289F741120FE202248B666666' },
        { trait_type: 'Does not', value: 'trade, hold funds, or decide what you should hold' },
      ],
    }),
  },
  {
    slug: 'lp-placement',
    doc: common({
      name: 'Brain on BNB — PancakeSwap Fee Tier Placement',
      // Filed under yield optimisation: the track defines that category as
      // "routes liquidity to the highest available APR", and ranking five
      // pools by what they actually paid is that question. Moved off
      // rebalancing on 2026-08-31 — this manages no range and resets nothing.
      description: 'A pair on PancakeSwap lives in up to five pools at once — V2 at 0.25% and V3 at 0.01%, 0.05%, 0.25% and 1.00% — sharing a price and competing for the same flow. Every interface ranks them by the money already parked in them, which is a record of what other people did rather than a measure of what the pool pays, and the two come apart constantly: across six of the busiest pairs on this chain the tier holding the most capital was routinely not the tier paying best, and a 1.00% pool held real money on every one of them while trading on none. This measures each tier over a live window — turnover, the fees the pool actually paid out, and what a given amount of liquidity would have earned in each, counting both sides of the pool because a provider puts up both. It names the tiers holding money that did not trade at all, and states how long the better tier would have to keep paying before a move covers its own gas. It does not annualise: the window is about an hour of chain and travels with every figure. Impermanent loss is not in the number and the answer says so. Hireable over ERC-8183 for 0.10 $U; the deliverable is written on-chain in full. Run by Brain On BNB AI, agent #49467, whose domain claims this id at https://brainonbnb.com/.well-known/agent-registration.json',
      services: [
        { name: 'A2A', description: 'A2A JSON-RPC. skill "negotiate-erc8183-job" returns a signed quote (BNB Agent SDK; the funded job is found on the chain), or skill "negotiate" then "notify_funded" with the job id.', endpoint: `${ORIGIN}/lp-placement/a2a`, version: '0.3.0' },
        { name: 'x402', description: 'Pay per answer, no escrow: POST once for the 402 terms (USD1 by EIP-3009, USDC by Permit2, or USD1/$BOBAI by transfer), pay, POST again with the payment in X-PAYMENT or PAYMENT-SIGNATURE.', endpoint: X402('lp_tier_plan'), version: '2' },
        { name: 'feeTiers', description: 'The same measurement, free and without hiring anybody: an MCP tool, a plain GET, and an installable skill.', endpoint: 'https://brainonbnb.com/api/fee-tiers' },
        { name: 'marketplace', description: 'The marketplace this agent is listed in, with the measured employment history of every provider on this escrow kernel.', endpoint: 'https://brainonbnb.com/registry' },
      ],
      attributes: [
        { trait_type: 'Category', value: 'yield-optimization' },
        { trait_type: 'Venues', value: 'PancakeSwap V2 and V3, all four V3 fee tiers' },
        { trait_type: 'Operated by', value: 'Brain On BNB AI' },
        { trait_type: 'Parent agent', value: `${PARENT_AGENT} on ${REGISTRY}` },
        { trait_type: 'Domain proof', value: 'https://brainonbnb.com/.well-known/agent-registration.json' },
        { trait_type: 'Hiring', value: 'ERC-8183 escrow, 0.10 $U per job' },
        { trait_type: 'Payment token', value: '$U 0xcE24439F2D9C6a2289F741120FE202248B666666' },
        { trait_type: 'Measured, not modelled', value: 'fees are the pool fee applied to turnover read from the pool\'s own swap logs' },
        { trait_type: 'Does not', value: 'annualise a one-hour window, price impermanent loss, move liquidity, or hold funds' },
      ],
    }),
  },
  {
    // The one agent here that ACTS, not only measures (2026-10-04, BNB Chain
    // Set and Earn). It runs the project's own position every day from
    // 0xbFAA…7F0A; hired, it applies that same code to the buyer's position.
    // Its endpoint and card are its own (/defi-agent), so a marketplace
    // listing this id lists this agent and not the six-service counter.
    slug: 'defi-agent',
    doc: common({
      name: 'Brain on BNB — DeFi Agent',
      description: 'Rebalancing agent for PancakeSwap V3 liquidity. Runs the $BOBAI project\'s own PancakeSwap V3 position (CAKE/BNB,0.05 %) on BNB Chain by itself, every day, from wallet 0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A: it collects the fees, and when the price leaves the range it re-sets the range one-sided beside the price without a swap, in the width that ended the most ahead against simply holding when every width was replayed over the last week. Every step is a public transaction, and the daily record is at https://agent.brainonbnb.com/lp/agent. Hired, it runs the same code on your position and writes its decision on-chain in full: in range or not and how much room is left to each edge, what the position holds and is owed, whether collecting pays for its own gas, whether a re-set is due and in which width. It reads and plans; it signs nothing on your position. Hireable over ERC-8183 for 0.10 $U with a signed quote (negotiate-erc8183-job); a funded job is found on the chain and delivered without further messages. Run by Brain On BNB AI, agent #49467, whose domain claims this id at https://brainonbnb.com/.well-known/agent-registration.json',
      services: [
        { name: 'A2A', description: 'A2A JSON-RPC (message/send). skill "negotiate-erc8183-job" returns a signed quote; anchor it via createJob and fund it.', endpoint: 'https://agent.brainonbnb.com/defi-agent/a2a', version: '0.3.0' },
        { name: 'x402', description: 'Pay per answer, no escrow: POST once for the 402 terms (USD1 by EIP-3009, USDC by Permit2, or USD1/$BOBAI by transfer), pay, POST again with the payment in X-PAYMENT or PAYMENT-SIGNATURE.', endpoint: X402('lp_position_plan'), version: '2' },
        { name: 'agentCard', description: 'This agent\'s A2A card: purpose, category, skills, operating wallet.', endpoint: 'https://agent.brainonbnb.com/defi-agent/.well-known/agent-card.json' },
        { name: 'web', description: 'The agent\'s live page: position, decisions, results against holding.', endpoint: 'https://brainonbnb.com/defi' },
        { name: 'record', description: 'The daily run record as JSON: every collect, re-set and deposit with its transactions.', endpoint: 'https://agent.brainonbnb.com/lp/agent' },
      ],
      attributes: [
        { trait_type: 'Category', value: 'rebalancing' },
        { trait_type: 'Venue', value: 'PancakeSwap V3 on BNB Chain' },
        { trait_type: 'Home pool', value: 'CAKE/BNB 0.05 %' },
        { trait_type: 'Operating wallet', value: 'eip155:56:0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A' },
        { trait_type: 'Schedule', value: 'daily run 04:23 UTC, hourly check at :50, deposit watch every 10 minutes' },
        { trait_type: 'Operated by', value: 'Brain On BNB AI' },
        { trait_type: 'Parent agent', value: `${PARENT_AGENT} on ${REGISTRY}` },
        { trait_type: 'Domain proof', value: 'https://brainonbnb.com/.well-known/agent-registration.json' },
        { trait_type: 'Hiring', value: 'ERC-8183 escrow, 0.10 $U per job, signed quote' },
        { trait_type: 'Payment token', value: '$U 0xcE24439F2D9C6a2289F741120FE202248B666666' },
        { trait_type: 'Source', value: 'https://github.com/mmxrealQQ/bobai-buyburn (shared/lp-agent.js, worker-lp/)' },
        { trait_type: 'Does not', value: 'sign on a buyer\'s position, hold a buyer\'s funds, or predict prices' },
      ],
    }),
  },
];

export const toTokenURI = (doc) =>
  `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString('base64')}`;

export const A2A_ENDPOINT = A2A;
export const PARENT = PARENT_AGENT;

// Which service each registered agent actually sells.
//
// The registry page used to find this by matching the agent's category against
// SERVICES, which worked only while no two agents shared a category. Two do
// now, so the lookup returned whichever service came first in the object and
// one of our own agents was described as the other one. Mapping the slug is
// the fix: a slug names exactly one agent, a category does not.
export const SERVICE_BY_SLUG = {
  'health-factor': 'health_factor',
  'grid-trader': 'grid_plan',
  'yield-optimizer': 'yield_plan',
  rebalancer: 'rebalance_plan',
  'lp-placement': 'lp_tier_plan',
  'defi-agent': 'lp_position_plan',
};
