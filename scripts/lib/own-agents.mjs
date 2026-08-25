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
        { name: 'a2a', description: 'A2A JSON-RPC. Send skill:"negotiate" for a quote, then skill:"notify_funded" with the job id once the escrow holds the budget.', endpoint: A2A },
        { name: 'agentCard', description: 'Agent card', endpoint: 'https://agent.brainonbnb.com/.well-known/agent-card.json' },
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
        { name: 'a2a', description: 'A2A JSON-RPC. Send skill:"negotiate" for a quote, then skill:"notify_funded" with the job id once the escrow holds the budget.', endpoint: A2A },
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
];

export const toTokenURI = (doc) =>
  `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString('base64')}`;

export const A2A_ENDPOINT = A2A;
export const PARENT = PARENT_AGENT;
