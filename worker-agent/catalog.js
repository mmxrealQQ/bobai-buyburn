// What this operator offers, in one place.
//
// WHY THIS FILE EXISTS
// The offering was spread across four surfaces that did not know about each
// other. `CAPABILITIES` lived inside index.js and described what an agent can
// call; `SERVICES` in sell.js described what you can hire us to deliver on
// chain; the home page rendered two of the five capability groups and none of
// the services; and a human asking "what can you actually do for me" had to
// read a marketplace page, a scanner page and an llms.txt to find out. Nobody
// was lying anywhere — there was simply no place where the whole offer stood
// at once, which is a different failure and just as expensive.
//
// So: one module. The worker serves it at /stats, the services page is
// generated from it, and neither can describe an offer the other does not
// have. Adding something we sell means adding it here, once.
import { SERVICES } from './sell.js';

export const USD1_DECIMALS = 18n;

// 30 days of watching one pool. Priced against the catalogue, where calls run
// 0.01-0.03 USD — this is a subscription, not a call, so it sits above that,
// but low enough that trying it is not a decision.
export const WATCH_PRICE_USD1 = 500000000000000000n; // 0.50 USD1
export const WATCH_DAYS = 30;

export const fmtUsd1 = (v) => {
  const whole = v / 10n ** USD1_DECIMALS;
  const frac = (v % 10n ** USD1_DECIMALS).toString().padStart(18, '0').slice(0, 2);
  return `${whole}.${frac}`;
};

export const CAPABILITIES = {
  free: [
    { name: 'pool scan (browser)', where: 'https://brainonbnb.com/scanner', what: 'measure any BSC pool: real trade cost, depth, tax from executed trades, a simulated sell — and a token still on its four.meme launch curve, read from four.meme\'s own contract' },
    { name: 'agent skill', where: 'npx skills add https://brainonbnb.com', what: 'the same measurement as an installable skill for any MCP-capable agent' },
    { name: 'MCP server', where: 'https://brainonbnb.com/mcp', what: 'read-only tools over MCP: measure any BSC pool before trading it (or the four.meme curve a new token is still on), search the ERC-8004 registry, read the census, plus live $BOBAI on-chain data' },
    { name: 'REST endpoints', where: 'https://brainonbnb.com/api/*', what: 'the same tools as plain GET, for agents that do not speak MCP' },
    // The three PancakeSwap answers, named rather than left inside "read-only
    // tools over MCP". Somebody arriving with a decision to make is looking for
    // the decision, not for the protocol it is delivered over.
    { name: 'which fee tier pays', where: 'https://brainonbnb.com/api/fee-tiers?address=0x...', what: 'a pair lives in up to five PancakeSwap pools at once. This measures what each actually paid its liquidity providers over a live window — per dollar in the pool, and per dollar standing within 2% of the price, which is the only part earning. The two rankings disagree often.' },
    { name: 'which price range', where: 'https://brainonbnb.com/api/range-plan?address=0x...&capitalUsd=1000', what: 'a V3 position is not in a pool, it is between two prices. A position of the size you name is replayed through the swaps that really happened: what each width would have collected, how much of the window it stayed in range, and what putting it back would cost.' },
    { name: 'which route, and can you get out', where: 'https://brainonbnb.com/api/best-route?address=0x...&usd=250', what: 'which of the five pools actually returns the most at your size, quoted by the venue rather than ranked by depth — and what comes back if you sell straight into the same route, with the transfer tax measured from executed trades folded in.' },
  ],
  record: [
    {
      name: 'session log',
      where: 'https://agent.brainonbnb.com/sessions',
      what: 'Every task routed to another agent, who answered, how long it took, and what failed. The track record is derived from this log — no operator sets its own score.',
      free: true,
    },
  ],
  hire: [
    {
      name: 'dispatch a task',
      where: 'POST https://agent.brainonbnb.com/dispatch  {"task":"..."}',
      what: 'Finds an agent that can answer, calls it, and returns the result naming who produced it. Add "dry_run": true to see which agent and tool would be used without calling anything.',
      limit: 'Read-only tools only. Anything that signs, sends, swaps or orders is listed for you to call yourself — never invoked on your behalf.',
      free: true,
    },
  ],
  broker: [
    {
      name: 'agent search',
      where: 'GET https://agent.brainonbnb.com/find?q=<what you need>',
      what: 'Finds ERC-8004 agents on BNB Chain that expose something matching, using the tools they returned when asked and the descriptions they wrote on-chain. Optional &speaks=mcp,a2a,x402 to require a protocol.',
      free: true,
    },
  ],
  paid: [
    {
      name: 'pool watch',
      where: 'POST https://agent.brainonbnb.com/watch',
      what: `continuous monitoring of one pool for ${WATCH_DAYS} days; fires a callback when depth falls below your threshold`,
      price: `${fmtUsd1(WATCH_PRICE_USD1)} USD1`,
      why_paid: 'it runs on our cron and storage around the clock, which the free scanner never does',
    },
    {
      name: 'paid answer',
      where: 'POST https://agent.brainonbnb.com/answer?service=<id>',
      what: 'any of the five deliveries below, one payment, the document at once — no escrow, no job, no dispute window. GET /answer lists them; POST once without payment for the terms',
      price: '0.10 USD1 per answer',
      why_paid: 'it is the same measurement the agents deliver through the escrow, at the same price, for a buyer with a wallet who wants it now',
    },
  ],
};

// Which registered agent sells which service.
//
// BY SLUG, NOT BY CATEGORY. Two of our agents share a category, so a lookup on
// category returns whichever came first and describes one agent as the other —
// a bug we already paid for once on the registry page. The ids are checked
// against data/own-agents.json by scripts/build-services.mjs, so a divergence
// fails a build instead of quietly publishing a hire button that opens the
// wrong agent.
export const SOLD_BY = {
  health_factor: { slug: 'health-factor', agent: 302257 },
  grid_plan: { slug: 'grid-trader', agent: 302258 },
  yield_plan: { slug: 'yield-optimizer', agent: 304493 },
  rebalance_plan: { slug: 'rebalancer', agent: 304494 },
  lp_tier_plan: { slug: 'lp-placement', agent: 310460 },
};

// The five things somebody can pay us to deliver, in the same shape as the
// capability groups above so that one renderer handles all of it. `needs` is
// carried through verbatim: what a service wants from you is part of knowing
// whether you can use it, and a price without that is half an answer.
export const DELIVERIES = Object.values(SERVICES).map((s) => ({
  id: s.id,
  name: s.name,
  what: s.deliverables,
  needs: s.needs,
  category: s.category,
  price: s.price_display,
  agent: SOLD_BY[s.id]?.agent ?? null,
  where: SOLD_BY[s.id] ? `https://brainonbnb.com/registry#cat-${s.category === 'health-factor-monitoring' ? 'health-factor' : s.category}` : null,
  how: 'ERC-8183 escrow: negotiate a quote, fund the job, the agent delivers on-chain. If nothing is delivered by expiry, claimRefund returns the whole budget. Or pay per answer over x402: POST https://agent.brainonbnb.com/answer?service=<id> once without payment for the terms, send 0.10 USD1, repeat with the transaction hash, and the same document comes straight back.',
  x402: `POST https://agent.brainonbnb.com/answer?service=${s.id}`,
}));

// One document, so that /stats and the page cannot disagree.
export const offering = () => ({ ...CAPABILITIES, deliver: DELIVERIES });
