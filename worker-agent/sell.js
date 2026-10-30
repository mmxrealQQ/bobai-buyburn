// The other side of the counter: being hireable.
//
// Everything else in this worker is a buyer or a broker. /find says who can do
// a thing, /dispatch calls them, /hire builds the escrow transactions. None of
// that makes us hireable, and a marketplace whose own agents cannot be hired is
// asking of others what it has not done itself.
//
// It also fills a hole nobody else can fill. Measured across the whole chain
// after collapsing the fleet of identical deployments, the four categories the
// marketplace has to cover have this much genuine depth behind them:
// yield 4 operators, health factor 2, rebalancing 1, grid trading ZERO. The
// chain does not contain the variety it is being judged on. So we supply all
// four ourselves, honestly, and say where the numbers came from.
//
// Each one returns a figure the category's existing tools leave out, because a
// fifth ranked list of APYs is not depth:
//   health factor   the collateral drawdown that liquidates, cross-checked
//                   against Venus's own getAccountLiquidity
//   grid trading    the break-even spacing, below which no grid can profit
//   yield           the days until a move pays for its own gas — and a block
//                   time measured from the chain, because the constant most
//                   BSC yield figures still use is off by a factor of 6.7
//   rebalancing     the cost as a share of the money moved, and which holding
//                   the bill is concentrated in. It refuses to claim what a
//                   correction is worth, because that is not in any pool.
//
// A fifth was added afterwards, and for a different reason than depth: all four
// above serve somebody spending money. None served a liquidity provider, who
// has to choose between the up-to-five PancakeSwap pools a pair lives in and is
// shown, everywhere, the one number that does not answer it — the money already
// parked in each. lp_tier_plan measures what each tier actually paid instead.
//
// THE PROTOCOL, WHICH IS NOT MCP
// Hiring on BNB Chain runs over ERC-8183 and A2A, not MCP. A buyer sends
// `negotiate` over A2A JSON-RPC, gets a quote naming a provider address and a
// price, funds a job in the escrow kernel against that address, and tells the
// seller. The seller does the work and writes the deliverable on-chain, and the
// escrow releases after the dispute window.
//
// We answer in the flat dialect — { provider, price, currency } — because it
// names the provider outright. The other dialect in production out there omits
// it, which forces every buyer to guess at the address from a signature, and
// that guess is wrong in a way that is hard to see. Interoperability is not
// served by joining in.
//
// WHAT IS REFUSED
// Everything that has not been paid for. Before any work happens the kernel is
// read: the job must be FUNDED, it must name our provider address, and its
// budget must cover the quote. A seller that works on an unfunded job is not
// generous, it is a free API with extra steps.

import { healthFactor, drawdownToLiquidation } from './venus.js';
import { gridPlan } from './grid.js';
import { yieldPlan } from './yield.js';
import { rebalancePlan, rebalanceDefaultTarget } from './rebalance.js';
import { lpTierPlan } from './lp-tiers.js';
import { lpPositionPlan, lpPositionFacts, lpRangeCheck } from './lp-service.js';
import { decodeJob, ERC8183, readDisputeWindow } from './hire.js';

// WHAT THE JOB MUST LOOK LIKE, SAID IN THE QUOTE (2026-10-06). The delivery refuses a job evaluated by anyone but the
// escrow's router, and the kernel refuses any delivery to a job that expires inside the policy's dispute window (7 days):
// two jobs funded through mandatemarkets.com with a 6-day expiry sat FUNDED until they expired, and the buyer learned
// why only afterwards. The quote names both before anything is created or paid. A day on top of the window leaves room
// for the delivery itself. Kept beside the signed part, never in it: the signed hashes stay what the SDK checks. Pure.
export function jobRequirements(windowSec) {
  const days = Math.round(windowSec / 86400), min = windowSec + 86400;
  return {
    evaluator: ERC8183.router,
    hook: ERC8183.router,
    min_expiry_seconds_after_funding: min,
    why: `The job must be evaluated by the escrow's router ${ERC8183.router} (hook the router or none), and must expire at least ${Math.round(min / 86400)} days after it is funded: the kernel refuses any delivery to a job that expires inside its ${days}-day dispute window, and a job evaluated by anyone else never reaches the policy. Such a job is refused before any work, and its budget returns to you at expiry.`,
  };
}
const quoteWindow = async () => readDisputeWindow(async (to, data) => {
  const r = await fetch(RPCS[0], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }), signal: AbortSignal.timeout(6000) });
  return (await r.json()).result;
});
import { submitDeliverable, providerAccount } from './submit.js';
import { accountFor, accountForAgent, ourAccounts } from './agent-wallets.js';
import { signedQuote, agentMessage } from './standard-quote.js';
import { parseTask, answerTask } from './plain-tasks.js';
import { understoodReply, understand, readHoldings, readTargets } from './understand.js';

const RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed.binance.org',
  'https://bsc.publicnode.com',
];

// What we sell, what it costs, and what it is not.
//
// Priced low on purpose. The median funded job on this kernel is a cent, the
// whole escrow has moved 591 $U in its entire history, and a marketplace entry
// nobody can afford to try is a brochure. 0.10 $U is enough to prove a payment
// happened and cheap enough that trying it is not a decision.
export const SERVICES = {
  health_factor: {
    id: 'health_factor',
    name: 'Venus health factor & liquidation distance',
    category: 'health-factor-monitoring',
    price: '100000000000000000',
    price_display: '0.10 $U',
    deliverables: 'Health factor for a Venus position on BNB Chain, computed market by market from the Comptroller, with the collateral drawdown that would liquidate it and a stress table. Cross-checked against the protocol\'s own getAccountLiquidity — if the two disagree the answer says so instead of guessing.',
    needs: { address: 'the account whose position to read (0x…)' },
  },
  grid_plan: {
    id: 'grid_plan',
    name: 'Grid trading plan, costed against the real pool',
    category: 'grid-trading',
    price: '100000000000000000',
    price_display: '0.10 $U',
    deliverables: 'Grid levels for any BNB Chain pool with the round-trip cost of a cycle measured from the pool itself — swap fee, price impact at your fill size, and the transfer tax read from executed trades rather than a label. States the break-even spacing, which is the number that decides whether the grid can work at all.',
    needs: { token: 'the token or pool to grid (0x…)', capitalUsd: 'total capital, optional', levels: 'number of levels, optional', bandPct: 'range as ± percent, optional' },
  },
  yield_plan: {
    id: 'yield_plan',
    name: 'Venus yield ranking, and whether moving pays for itself',
    category: 'yield-optimization',
    price: '100000000000000000',
    price_display: '0.10 $U',
    deliverables: 'Every Venus core-pool market ranked by supply APY, computed from the rate per block and a block time measured against the chain rather than the 10,512,000-blocks-a-year constant most published BSC yield figures still use — which understates these rates by about 6.7x. Cross-checked on the chain: each market\'s supply rate is re-derived from its borrow rate, utilisation and reserve factor (the rule Venus\'s rate model pays by), and Venus\'s published APY is compared on top when their API answers — every row and the summary say what agreed, and a divergence is named. Given an amount and what you earn today it returns the days until a move pays for its own gas, which below a certain position size is never.',
    needs: { amountUsd: 'position size in USD, optional', from: 'the Venus market held today, optional', currentApyPct: 'what you earn today, optional' },
  },
  rebalance_plan: {
    id: 'rebalance_plan',
    name: 'Portfolio rebalance, priced against the pools that would execute it',
    category: 'rebalancing',
    price: '100000000000000000',
    price_display: '0.10 $U',
    deliverables: 'The swaps that move a BSC portfolio to target weights, each one costed against its own pool: swap fee, price impact at the actual size, and the transfer tax measured from executed trades. Returns the cost as a share of the money moved, and names the holding the bill is concentrated in. It does not claim to know what a correction is worth — that is a judgement about risk, not a quantity in a pool. For liquidity it rebalances ranges: a range check of every PancakeSwap V3 position a wallet holds, any pair — in range or not, the room to each edge, and the same width re-centred on today\'s price, aligned to the pool\'s tick spacing.',
    needs: { holdings: 'array of { token: "0x…", usd: 1000 }, optional when a position is named', targets: 'optional map of token → target weight in percent; equal weight if omitted', position: 'a PancakeSwap V3 position id, or the wallet that holds the positions (0x…), for a range check, optional' },
  },
  lp_tier_plan: {
    id: 'lp_tier_plan',
    name: 'Which PancakeSwap fee tier is actually paying its liquidity providers',
    // Filed under yield optimisation, which the track defines as "routes
    // liquidity to the highest available APR". That is literally this service:
    // it ranks five pools sharing one price by what they actually paid out and
    // says when a move covers its own gas. It sat under rebalancing at first on
    // the reading that a fee tier is a position being reset — but this moves no
    // range and resets nothing. The category that names APR is the one it
    // belongs in, and the four sections come out more even as a side effect
    // rather than as the reason.
    category: 'yield-optimization',
    price: '100000000000000000',
    price_display: '0.10 $U',
    deliverables: 'A pair on PancakeSwap lives in up to five pools at once — V2 at 0.25% and V3 at 0.01%, 0.05%, 0.25% and 1.00% — and every interface ranks them by the money already parked in them, which is not what they pay. This measures each tier over a live window: turnover, the fees the pool actually paid out, and what your capital would have earned in each, both sides of the pool counted. And it does the sum the way the money actually works: fees go to the liquidity standing where the trade happens, so each tier is also read at the price — the tick book of the pool itself is walked to find what is parked within a couple of percent of it — with your own size in the denominator, because arriving is what dilutes it. On a constant-product pool that is under one percent of the balance, so the tier holding the most money is regularly not the tier you would be competing with least. It names the tiers holding real money that did not trade at all, and states how long the better tier would have to keep paying before a move pays for its own gas. Not annualised: the window travels with every figure.',
    needs: { token: 'the token or PancakeSwap pool to compare tiers for (0x…)', capitalUsd: 'how much liquidity you are placing, optional — defaults to 1000' },
  },
  lp_position_plan: {
    id: 'lp_position_plan',
    name: 'The DeFi agent, on your position',
    category: 'rebalancing',
    price: '100000000000000000',
    price_display: '0.10 USD1',
    deliverables: 'What the agent that runs this project\'s own PancakeSwap V3 position would decide about yours, from the same code: whether it is in range and how much room is left to each edge, what it holds and is worth in BNB, what it is owed in fees and whether collecting pays for its own gas, whether a re-set is due and in which width — the width that ended the most ahead against simply holding over the last week when every width was replayed over the recorded prices (its fees, less the gas of its re-sets, plus where it stood against a wallet that held), the width in use kept unless another leads it by a tenth — and what the wallet\'s spare BNB would add. It reads and plans; it signs nothing on your position.',
    needs: { position: 'the PancakeSwap V3 position id (tokenId)', address: 'or the wallet that holds exactly one position (0x…)' },
  },
};

// THE SET AND EARN PRICE (2026-10-27, operator's go: "Preis auf 0.01 bis 5.11."). Every BNB Set and Earn entrant has to
// hire three agents before 5 Nov 12:00 UTC, and the ones hired are the cheap ones (Mandate's at 0.01); ours stood at 0.10.
// Until then every escrow quote is 0.01; after it, 0.10 again by itself. x402 answers keep their own price (ANSWER_PRICE).
// A job is held to the price of the hour its quote was signed (negotiated_at in the description it anchors), so a quote
// signed in the sale and delivered after it is still delivered.
export const SALE_UNTIL = Date.UTC(2026, 10, 5, 12) / 1000;
export const onSale = (at = Date.now() / 1000) => at < SALE_UNTIL;
const BASE_WEI = 100000000000000000n, SALE_WEI = 10000000000000000n;
export const escrowWei = (at) => (onSale(at) ? SALE_WEI : BASE_WEI);
// what a funded job owes: the price of the hour its quote was signed, or of now when its description names no hour
export const dueFor = (description, now = Date.now() / 1000) => escrowWei(Number(String(description || '').match(/"negotiated_at":\s*(\d+)/)?.[1]) || now);
for (const s of Object.values(SERVICES)) {
  const unit = s.price_display.split(' ')[1];
  Object.defineProperty(s, 'price', { enumerable: true, get: () => String(escrowWei()) });
  Object.defineProperty(s, 'price_display', { enumerable: true, get: () => (onSale() ? `0.01 ${unit} (until 5 Nov 12:00 UTC, then 0.10)` : `0.10 ${unit}`) });
}

// Quoted in atomic units, because that is what every seller on this chain
// actually sends and a marketplace that publishes a census of other people's
// inconsistencies should not add one. price_display carries the human number.
const PRICE_WEI = (p) => BigInt(String(p));
// The DeFi agent's own wallet: the position the agent manages, read when a
// buyer hires the position plan without naming one of theirs.
const LP_AGENT_WALLET = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';

// ---------------------------------------------------------------------------
// Reading the kernel. Deliberately a plain eth_call — the buyer's money is the
// thing being verified, so it is read from the chain and not from what the
// buyer told us.
// ---------------------------------------------------------------------------
export async function readJob(jobId) {
  const data = '0xbf22c457' + BigInt(jobId).toString(16).padStart(64, '0');
  for (let i = 0; i < RPCS.length * 2; i++) {
    try {
      const r = await fetch(RPCS[i % RPCS.length], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ERC8183.commerce, data }, 'latest'] }),
        signal: AbortSignal.timeout(12000),
      });
      const j = await r.json();
      if (j.result && j.result !== '0x') {
        const job = decodeJob(j.result);
        // A job id that does not exist does NOT revert here — the kernel hands
        // back a zero struct that decodes into a plausible unfunded job. Only
        // a struct that reports back the id we asked for is a real job.
        if (job && String(job.id) === String(jobId)) return job;
        return null;
      }
    } catch { /* next endpoint */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The work itself.
// ---------------------------------------------------------------------------
// WHAT A SERVICE CANNOT START WITHOUT — asked BEFORE the money is taken
// (2026-09-18). The sale charged first and looked at the input afterwards: a
// buyer who forgot the address paid, got a 422, and — through the facilitator,
// whose Permit2 payment cannot be presented twice — had no way to use what he
// had paid for. Returns the sentence to show, or null when the work can start.
// Pure; pinned by scripts/payment-ledger-check.mjs.
// NEVER SELL A PLAN THAT CANNOT BE MADE (2026-10-12). The position plan is
// made for one position against WBNB; asked for a CAKE/USDT position, the
// agent quoted 0.10 $U and would have delivered "plans only WBNB pairs". When
// the task names a position or a wallet, it is read before the quote: not
// one position, or not against WBNB, is declined with the reason. A read
// that fails does not block the quote (delivery reads again and says why).
export async function cannotPlan(serviceId, params = {}) {
  if (missingInput(serviceId, params)) return null;
  // a range check with nothing to check is not sold (2026-10-23): a wallet without a position, or an id that does not
  // exist. Empty positions are a reading (pair, fee tier, "nothing left to re-centre") and are quoted.
  if (serviceId === 'rebalance_plan' && params.range && !(Array.isArray(params.holdings) && params.holdings.length)) {
    try {
      const rc = await lpRangeCheck(params);
      if (!rc.positions.some((p) => !p.error)) return `${rc.summary}`;
    } catch (e) { return `${String(e.message || e).slice(0, 160)}.`; }
    return null;
  }
  if (serviceId !== 'lp_position_plan') return null;
  try {
    const { facts } = await lpPositionFacts(params);
    if (facts.positions !== 1) return facts.verdict || `That wallet holds ${facts.positions} PancakeSwap V3 positions; name the one to plan by its id.`;
    if (facts.liquidity === '0') return `Position #${facts.position} holds no liquidity — nothing to plan.`;
    // not against WBNB (2026-10-23): quoted — the delivery is the range check of that position (lpPositionPlan)
  } catch { /* unreadable now: delivery reads it again */ }
  return null;
}

// The two plans that take a token start from WBNB when the buyer named none (2026-10-22), in the quote and the delivery.
export const WBNB_TOKEN = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
export const TOKEN_DEFAULTS_TO_WBNB = new Set(['grid_plan', 'lp_tier_plan']);
export const WBNB_NOTE = `No token was named: the plan is for WBNB (${WBNB_TOKEN}), BNB Chain's own coin.`;
export const PLAIN_ASK_NOTE = 'No service was named: this is the Venus health factor and liquidation distance of the hiring wallet, read from the chain at delivery. Also for sale here, each quoted when named in task_description: grid_plan, yield_plan, rebalance_plan, lp_tier_plan.';
export const REBALANCE_DEFAULT_NOTE = 'No holdings or position were named: the plan prices the hiring wallet\'s holdings, read from the chain at delivery, to equal weight (a wallet with fewer than two gets the DeFi agent\'s own wallet, said so in the answer). Name holdings, or a PancakeSwap V3 position or wallet for a range check, to choose.';
export function missingInput(serviceId, params = {}) {
  const addr = (v) => /^0x[a-fA-F0-9]{40}$/.test(String(v || ''));
  const p = params || {};
  if (serviceId === 'health_factor') return addr(p.address) ? null : 'health_factor needs `address`: the account whose Venus position to read (0x…)';
  if (serviceId === 'grid_plan' || serviceId === 'lp_tier_plan') return addr(p.token) || addr(p.address) ? null : `${serviceId} needs \`token\`: the token or pool address (0x…)`;
  // a range check (2026-10-23) needs the position or the wallet that holds them
  if (serviceId === 'rebalance_plan') return (Array.isArray(p.holdings) && p.holdings.length) || (p.range && (/^\d+$/.test(String(p.position ?? '')) || addr(p.address))) ? null : 'rebalance_plan needs `holdings`: [{ "token": "0x…", "usd": 1000 }, …] — or, for a range check of PancakeSwap V3 positions, `position` (the tokenId) or `address` (the wallet that holds them)';
  if (serviceId === 'lp_position_plan') return /^\d+$/.test(String(p.position ?? p.tokenId ?? p.id ?? '')) || addr(p.address) || addr(p.wallet) || addr(p.owner) ? null : 'lp_position_plan needs `position` (the PancakeSwap V3 tokenId) or `address` (a wallet that holds exactly one)';
  return null;   // yield_plan starts with nothing
}
export async function doWork(serviceId, params, env = null) {
  if (serviceId === 'lp_position_plan') {
    return { service: 'lp_position_plan', plan: await lpPositionPlan(params || {}, env) };
  }
  if (serviceId === 'health_factor') {
    const account = String(params?.address || params?.account || '').match(/0x[a-fA-F0-9]{40}/)?.[0];
    if (!account) throw new Error('health_factor needs an address to look at');
    const position = await healthFactor(account);
    return { service: 'health_factor', position, ...(position.has_position ? { drawdown: drawdownToLiquidation(position) } : {}) };
  }
  if (serviceId === 'grid_plan') {
    return { service: 'grid_plan', plan: await gridPlan(params || {}) };
  }
  if (serviceId === 'yield_plan') {
    return { service: 'yield_plan', plan: await yieldPlan(params || {}) };
  }
  if (serviceId === 'rebalance_plan') {
    const p = params || {};
    if (!(Array.isArray(p.holdings) && p.holdings.length) && (p.range || p.position != null)) return { service: 'rebalance_plan', mode: 'range_check', plan: await lpRangeCheck(p) };
    return { service: 'rebalance_plan', plan: await rebalancePlan(p) };
  }
  if (serviceId === 'lp_tier_plan') {
    return { service: 'lp_tier_plan', plan: await lpTierPlan(params || {}) };
  }
  throw new Error(`unknown service "${serviceId}"`);
}

// Which service a free-text task is asking for. Buyers describe what they want
// in prose, and refusing to answer anything that is not an exact service id
// would make us the kind of seller that only talks to its own client.
export function pickService(text = '', explicit) {
  if (explicit && SERVICES[explicit]) return SERVICES[explicit];
  const t = String(text).toLowerCase();
  // Order matters. "venus" appears in both lending questions and yield ones,
  // so the more specific intent is tested first: somebody asking about APY or
  // where to earn wants the yield agent even though they said Venus.
  if (/\bapy\b|\bapr\b|yield|best rate|earn(ing)? (the )?most|where to (put|park|lend)|supply rate/.test(t)) return SERVICES.yield_plan;
  // A question about ONE position — named by its id, or "my position", in or
  // out of its range — is the position plan's, and has to be asked before the
  // tier test below claims every sentence with "LP" in it (2026-09-18: "my LP
  // position 7451444" was quoted a fee-tier comparison).
  if (/position\s*(id\s*)?#?\s*\d{3,}|\bmy (lp |v3 |liquidity )?position\b|\bv3 position\b|out of range|in range|re-?set (my|the) range/.test(t)) return SERVICES.lp_position_plan;
  // Before the rebalance test, and this order is load-bearing. Someone asking
  // "which fee tier should I provide liquidity in" is asking about LP range
  // placement, and the rebalance pattern below matches "allocation" — which
  // would have quietly sold them a portfolio rebalance instead.
  if (/fee.?tier|which (pool|tier)|provide liquidity|add liquidity|\bLP\b|liquidity provider|where to (lp|pool)|v3 (range|tier)/i.test(t)) return SERVICES.lp_tier_plan;
  if (/rebalanc|re-?weight|target weight|allocation|drift|portfolio/.test(t)) return SERVICES.rebalance_plan;
  if (/health.?factor|liquidat|collateral|venus|lending|borrow/.test(t)) return SERVICES.health_factor;
  if (/grid|ladder|range.?bot|dca.?grid/.test(t)) return SERVICES.grid_plan;
  return null;
}

export const RANGE_WORDS = /\bv3 positions?\b|\bpositions? (held|of|owned)\b|\bin range\b|out of range|re-?cent(er|re)|range check|\blp range/i;
export const extractParams = (text = '', given = {}) => {
  const addr = String(text).match(/0x[a-fA-F0-9]{40}/)?.[0];
  const out = { ...given };
  if (addr && !out.address && !out.token) { out.address = addr; out.token = addr; }
  // The amount of a yield question (2026-10-30): "1000 USDT" was read and dropped, and the plan answered without a size.
  if (out.amountUsd == null && /\byield\b/i.test(String(text))) {
    const m = String(text).match(/\$\s?([\d,]+)|\b([\d,]+)\s*(?:USDT|USDC|USD1|FDUSD|DAI)\b/i);
    const v = m && Number(String(m[1] || m[2]).replace(/,/g, ''));
    if (v > 0) out.amountUsd = v;
  }
  // A PancakeSwap V3 position is named by a number, not an address. "position
  // 7309536" in the sentence is the id; the first paid $BOBAI answer (2026-09-03)
  // was refused for want of exactly this line.
  if (out.position == null) {
    const m = String(text).match(/position\s*(?:id\s*)?#?\s*(\d{3,})/i);
    if (m) out.position = m[1];
  }

  // rebalance_plan is the one service that needs a list rather than a single
  // address, and free text could never produce one. A job hired through the
  // panel arrived here with `token` set and `holdings` empty, so the service
  // refused every time — and it refused AFTER the buyer had funded the escrow,
  // which is the most expensive moment to discover that a category cannot be
  // delivered at all. The strictness in rebalance.js is right; what was missing
  // was the bridge from a sentence to a portfolio.
  const givenList = Array.isArray(given.holdings) && given.holdings.length > 0;
  let listed = givenList;
  if (!Array.isArray(out.holdings)) {
    const arr = String(text).match(/\[\s*\{[\s\S]*?\}\s*\]/)?.[0];
    if (arr) {
      try {
        const parsed = JSON.parse(arr);
        if (Array.isArray(parsed) && parsed.length) { out.holdings = parsed; listed = true; }
      } catch { /* not JSON after all — fall through to the addresses */ }
    }
  }
  // No list in the text: read every address in the sentence as one holding and
  // split the stated capital evenly between them. Equal weight is the only
  // split that does not smuggle in a view about what the portfolio should be,
  // which is the same reasoning rebalance.js already applies to its targets.
  // Each address with its own figure first, as the A2A reading does (understand.js, 2026-10-18): "1000 USD of 0x… and
  // 1000 USD of 0x… to 70/30" is two holdings of 1000 and a 70/30 target, not an even split of the first figure.
  if (!Array.isArray(out.holdings) || !out.holdings.length) {
    const h = readHoldings(String(text));
    if (h.length) { out.holdings = h; listed = true; }
  }
  // A RANGE CHECK, NOT A PORTFOLIO (2026-10-23): "range check for the PancakeSwap v3 positions held by 0x…" named a
  // wallet, and the fallback below would have read it as one $1,000 token holding. Range words and no list of holdings:
  // the request is a range check of that wallet's positions (or the position named), and no holdings are made up.
  if (!listed && RANGE_WORDS.test(String(text))) { out.range = true; return out; }
  if (Array.isArray(out.holdings) && out.holdings.length >= 2 && (out.targets == null || typeof out.targets !== 'object')) {
    const tg = readTargets(String(text), out.holdings);
    if (tg) out.targets = tg;
  }
  if (!Array.isArray(out.holdings) || !out.holdings.length) {
    const tokens = [...new Set(String(text).match(/0x[a-fA-F0-9]{40}/g) || [])];
    if (tokens.length) {
      const stated = Number(String(text).match(/\$\s?([\d,]+)/)?.[1]?.replace(/,/g, ''));
      const usd = stated > 0 ? stated : 1000;
      out.holdings = tokens.map((t) => ({ token: t, usd: usd / tokens.length }));
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// A2A JSON-RPC.
// ---------------------------------------------------------------------------
// Every other endpoint on this worker answers through a helper that sets
// Access-Control-Allow-Origin; these two used Response.json directly and set
// nothing. The preflight passed — OPTIONS is handled centrally and says POST is
// allowed — so a browser sent the request, the worker did the work, and then
// the browser threw the response away for want of one header. From the page it
// looks like the network failed.
//
// This is the last step of the hire flow, so the cost of that missing header
// was specific: the escrow was funded and the seller was never told to deliver.
// Node never saw it, because CORS is a browser rule and every test of this
// endpoint had been made from Node.
const RPC_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const rpcOk = (id, result) => Response.json({ jsonrpc: '2.0', id: id ?? 1, result }, { headers: RPC_HEADERS });
const rpcErr = (id, code, message) => Response.json({ jsonrpc: '2.0', id: id ?? 1, error: { code, message } }, { headers: RPC_HEADERS });
// The list and the flat negotiate as an A2A Message (2026-10-10). The card says
// protocolVersion 0.3.0, whose message/send returns a Message or a Task; these
// two returned a bare object, which a strict 0.3 client rejects. Everything now
// sits in the data part. The same fields stay flat beside it for the readers
// that index result.accepted / result.provider directly (the generated
// /registry ask box, register-own-agents.mjs) until they read the part.
const flatMessage = (data) => ({ ...data, ...agentMessage(data) });

const dataParts = (message) => {
  const parts = message?.parts || [];
  const out = {};
  let text = '';
  for (const p of parts) {
    if (p?.kind === 'data' && p.data && typeof p.data === 'object') Object.assign(out, p.data);
    if (p?.kind === 'text' && typeof p.text === 'string') text += ' ' + p.text;
  }
  return { data: out, text: text.trim() };
};

// ---------------------------------------------------------------------------
// One worked example per service, for the marketplace card.
//
// A card that describes a service in prose leaves the buyer guessing what the
// 0.10 $U actually buys. So each card carries a real answer. Where a paid job
// exists its stored deliverable is the example (that is done by the publisher,
// which knows the job ids); where none does yet, this runs the very same
// doWork() a funded job would run, on the seed task the hire box opens with,
// so the example cannot describe an answer the service would not give. Cached
// a day: the point is the shape of the answer, not the freshest figure.
// ---------------------------------------------------------------------------
const SEED_ACCOUNT = '0xd319e1F8e987cf78333cEA853F455366640929cF'; // a real Venus position, the one job 56657 was paid for
const SEED_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const SEED_CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
export const SEED_TASKS = {
  health_factor: `health factor and liquidation distance for the Venus position at ${SEED_ACCOUNT}`,
  grid_plan: `grid plan for ${SEED_TOKEN}, 10 levels across a 15% band, $1000 capital`,
  yield_plan: 'where is the best stablecoin yield on BNB Chain right now',
  // Two holdings, so the example has a trade to price; and a pair that lives
  // in several fee tiers, so the tier comparison has something to compare.
  rebalance_plan: `rebalance holdings [{"token":"${SEED_TOKEN}","usd":700},{"token":"${SEED_CAKE}","usd":300}] to equal weight`,
  lp_tier_plan: `which PancakeSwap fee tier is actually paying for ${SEED_CAKE}, placing $1000 of liquidity`,
  // Our own position, read the way a stranger's would be: the example IS the
  // agent looking at itself through the paid door.
  lp_position_plan: 'what would the DeFi agent do with the PancakeSwap V3 position held by 0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A',
};
// The seed sentences carry the numbers a service needs in words; the same
// extractor a funded job goes through turns them into parameters, plus the
// two the sentences state but the extractor does not read.
const SEED_PARAMS = {
  grid_plan: { levels: 10, bandPct: 15, capitalUsd: 1000 },
  yield_plan: { amountUsd: 1000 },
  lp_tier_plan: { capitalUsd: 1000 },
};
// The way from the free preview to the paid answer (2026-09-18): every 402
// and the catalogue point into /example, and nothing pointed back out; and
// the price stood in the escrow's unit ($U) for a reader who came from a
// USD1 catalogue, with no gloss.
function exampleLinks(serviceId, service) {
  return {
    price: {
      x402: `0.10 USD1, USDC or $U per answer (or half that in $BOBAI, quoted on the 402) at POST https://agent.brainonbnb.com/answer?service=${serviceId}`,
      escrow: serviceId === 'lp_position_plan'
        ? SERVICES.lp_position_plan.price_display.replace('USD1', '$U') + ' through the ERC-8183 escrow from the DeFi Agent #363709 — signed quote at https://agent.brainonbnb.com/defi-agent/a2a (skill negotiate-erc8183-job); $U is United Stables, a dollar stablecoin'
        : `${service.price_display} through the ERC-8183 escrow on https://brainonbnb.com/registry ($U is United Stables, a dollar stablecoin)`,
    },
    buy: `https://agent.brainonbnb.com/answer?service=${serviceId}`,
    terms: 'POST it once without payment: the 402 carries the price, the wallet and the inputs it needs',
  };
}
// THE FIGURES A CHECKER COMPARES, AT THE TOP (2026-10-14). Mandate asks every rebalancing agent the same question and
// compares "in range" and "current tick" with its own reading of the chain; ours sat two levels down
// (result.plan.in_range, result.plan.pool.tick) and its page said "not data we can read". The paid answer and its
// free example both carry them at the top level, from this one place.
// The same for its house agents in the other categories: Guard-1 is compared on "health factor", Yield-1 on "Venus
// USDT rate" (the supply rate).
export function checkedFigures(serviceId, result) {
  const plan = result && result.plan;
  if (serviceId === 'lp_position_plan' && plan && plan.pool) return { position: plan.position ?? null, in_range: plan.in_range ?? null, current_tick: plan.pool.tick ?? null, tick_lower: plan.pool.ticks?.[0] ?? null, tick_upper: plan.pool.ticks?.[1] ?? null };
  if (serviceId === 'health_factor' && result && result.position) return { health_factor: result.position.health_factor ?? null };
  if (serviceId === 'yield_plan' && plan && Array.isArray(plan.ranked)) {
    const rates = {};
    for (const m of plan.ranked) if (m && m.symbol && Number.isFinite(m.supply_apy_pct)) rates[String(m.symbol).replace(/^v/, '')] = m.supply_apy_pct;
    return { venus_usdt_rate_pct: rates.USDT ?? null, venus_supply_rates_pct: rates };
  }
  // grid (2026-10-15): Mandate compares the levels with the bounds, their count and order, the allocations with the capital
  if (serviceId === 'grid_plan' && plan && plan.grid && Array.isArray(plan.grid.prices)) {
    const g = plan.grid, levels = g.prices.map((x) => ({ level: x.level, price: x.price, side: x.side, allocation_usd: x.capital_usd }));
    return { lower_price: g.lower_price, upper_price: g.upper_price, level_count: levels.length, levels, capital_usd: g.capital_usd, allocated_usd: +levels.reduce((s, x) => s + x.allocation_usd, 0).toFixed(2) };
  }
  return {};
}
export async function exampleFor(serviceId, env, { fresh = false } = {}) {
  const service = SERVICES[serviceId];
  if (!service) return null;
  const key = `example:${serviceId}`;
  if (!fresh && env?.AGENT) {
    const cached = await env.AGENT.get(key, 'json').catch(() => null);
    if (cached) return { ...cached, ...exampleLinks(serviceId, service), cached: true };
  }
  const task = SEED_TASKS[serviceId];
  const params = extractParams(task, { ...(SEED_PARAMS[serviceId] || {}), service: serviceId });
  const t0 = Date.now();
  const result = await doWork(serviceId, params, env);
  const out = {
    service: serviceId,
    name: service.name,
    // THE REQUEST ITSELF (2026-10-28, a stranger on /services: "no copy-paste request with real values", and the escrow's
    // sale price stood here beside the x402 link that asks 0.10): the exact body this example ran, ready to send with a
    // payment; the price of each way is in `price` below.
    request: { method: 'POST', url: `https://agent.brainonbnb.com/answer?service=${serviceId}`, body: { params: Object.fromEntries(Object.entries(params || {}).filter(([k, v]) => k in (service.needs || {}) && v != null && v !== '')) } },   // only the fields this service names: the extractor fills address, token and holdings for every sentence
    task,
    produced_at: new Date().toISOString(),
    took_ms: Date.now() - t0,
    ...checkedFigures(serviceId, result),
    result,
    note: 'Run by the same code a funded job runs, on the sentence the hire box opens with. Not a paid job; the figures are from the moment above.',
  };
  if (env?.AGENT) await env.AGENT.put(key, JSON.stringify(out), { expirationTtl: 60 * 60 * 24 }).catch(() => {});
  return { ...out, ...exampleLinks(serviceId, service) };
}

// opts.agent: an endpoint that belongs to ONE of our agents (/defi-agent/a2a)
// sells that agent's service whatever the prose says.
// One endpoint per agent (2026-10-04): /<slug>/a2a sells that agent's one
// service. The five used to share /a2a and one card that matched none of their
// registrations — 8004scan graded all five "broken" while the DeFi Agent, with
// a card of its own, read "healthy".
export const AGENT_SERVICE = {
  'defi-agent': 'lp_position_plan',
  'health-factor': 'health_factor',
  'grid-trader': 'grid_plan',
  'yield-optimizer': 'yield_plan',
  rebalancer: 'rebalance_plan',
  'lp-placement': 'lp_tier_plan',
};

// AN AGENT'S OWN ENDPOINT SELLS ITS OWN SERVICE — unless the request plainly
// asks for another of ours (2026-10-04). Selling a portfolio rebalance to
// somebody asking where their LP range should go answers a question nobody
// asked; the honest reply names the agent that does it. Open or matching
// wording still gets this agent's quote.
const SLUG_OF = Object.fromEntries(Object.entries(AGENT_SERVICE).map(([slug, svc]) => [svc, slug]));
const ownSentence = (s) => `I sell one thing on BNB Chain: ${s.name}. ${String(s.deliverables).match(/^.*?\.(?=\s|$)/)?.[0] || s.deliverables} Hireable over ERC-8183 for ${s.price_display} with a signed quote (skill negotiate-erc8183-job), or per answer over x402 at https://agent.brainonbnb.com/answer?service=${s.id}.`;
// A PRICE CHECK IS NOT A TASK (2026-10-22): Marque asks every listed agent for its price with skill "negotiate", task
// "marque-quote-probe: price check for a <its category> task. No job will be created from this quote", deliverables
// "price quote only". It files the fee tier agent (#310460) and the DeFi agent (#363709) under "rebalancing", so the
// probe read as a rebalance and both answered "ask the rebalancer" — no quote, and Marque showed them as not hireable
// (no_quote / expired_or_unproven). Asked only for a price, an agent's own endpoint names its own.
const priceCheckOnly = (data) => /quote-probe|price check|price quote only/i.test([data?.task_description, data?.task, data?.terms?.deliverables].filter((v) => typeof v === 'string').join(' '));
function misdirected(forced, wanted, data) {
  if (priceCheckOnly(data)) return null;
  // the Rebalancer does LP range checks too (2026-10-23): marketplaces file range work under "rebalancing"
  if (forced === 'rebalance_plan' && RANGE_WORDS.test(String(wanted))) return null;
  const guessed = pickService(wanted, data?.service);
  if (!forced || !guessed || guessed.id === forced) return null;
  const there = `https://agent.brainonbnb.com/${SLUG_OF[guessed.id]}/a2a`;
  return `This agent sells ${forced} (${SERVICES[forced].name}). What you describe is ${guessed.id} (${guessed.name}): ask ${there} for it over the ERC-8183 escrow, or buy it per answer over x402 at https://agent.brainonbnb.com/answer?service=${guessed.id}.`;
}

// ONE OF OURS, NAMED ON THE SHARED ENDPOINT (2026-10-23): SafeHire asks every listed agent at /a2a with its ERC-8004
// token id inside a JSON task ({"erc8004_token_id":363709,…}) and skill "negotiate" + service. The DeFi agent's was
// answered "ask /defi-agent/a2a" and the other five were quoted by the shared provider rather than by the agent named.
// A request that names one of our agents — by token id, or by a service only one agent sells — is answered as that
// agent's own endpoint answers it. Ids as in catalog.js SOLD_BY (pinned by scripts/range-check-check.mjs).
export const OWN_AGENT_BY_ID = { 302257: 'health-factor', 302258: 'grid-trader', 304493: 'yield-optimizer', 304494: 'rebalancer', 310460: 'lp-placement', 363709: 'defi-agent' };
export function ownAgentNamed(data = {}) {
  const tryJson = (s) => { try { return typeof s === 'string' && s.trim().startsWith('{') ? JSON.parse(s) : null; } catch { return null; } };
  const inner = [data, data.request, tryJson(data.task_description), tryJson(data.request?.task_description), tryJson(data.task)].filter((x) => x && typeof x === 'object');
  for (const o of inner) {
    const tid = String(o.erc8004_token_id ?? o.agent_id ?? o.agentId ?? o.token_id ?? '');
    if (OWN_AGENT_BY_ID[tid]) return OWN_AGENT_BY_ID[tid];
  }
  for (const o of inner) if (typeof o.service === 'string' && SLUG_OF[o.service]) return SLUG_OF[o.service];
  return null;
}

export async function handleA2A(request, env, opts = {}) {
  let body;
  try { body = await request.json(); } catch { return rpcErr(null, -32700, 'not JSON'); }
  const id = body?.id;
  if (body?.method !== 'message/send') {
    return rpcErr(id, -32601, `this agent speaks message/send; "${body?.method}" is not implemented`);
  }

  const { data, text } = dataParts(body?.params?.message);
  // THE PLAZA BOARD OVER A2A (2026-10-23): any of our endpoints reads and writes the board — skill "plaza-board",
  // action read (filters as GET /board) | post | reply | status (the signed entry, as POST /board)
  if (String(data.skill || '').toLowerCase() === 'plaza-board') {
    const { readBoard, writeEntry, BOARD_HOW } = await import('./board.js');
    const action = String(data.action || 'read');
    if (action === 'how') return rpcOk(id, agentMessage(BOARD_HOW));
    if (action === 'read') return rpcOk(id, agentMessage(await readBoard(env, data)));
    const r = await writeEntry(env, { ...data, action, skill: undefined }, request.headers.get('cf-connecting-ip'));
    return rpcOk(id, agentMessage(r.body));
  }
  // ANY WALLET'S ESCROW OVER A2A (2026-10-23): skill "escrow-status", { address } — escrow-for.js, read-only
  if (String(data.skill || '').toLowerCase() === 'escrow-status') {
    const { readEscrowFor } = await import('./escrow-for.js');
    const address = String(data.address || data.wallet || (String(text || '').match(/0x[0-9a-fA-F]{40}/) || [])[0] || '');
    return rpcOk(id, agentMessage(await readEscrowFor(env, address)));
  }
  if (!opts.agent) { const routed = ownAgentNamed(data); if (routed) opts = { ...opts, agent: routed }; }
  const skill = String(data.skill || data.method || '').toLowerCase();
  // The address that speaks for this endpoint: on an agent's own endpoint its agentWallet as the registry names it
  // (agent-wallets.js, 2026-10-21), on the shared one the provider. A quote names the wallet of the agent whose
  // service it sells, wherever it is asked for.
  const self = opts.agent ? await accountForAgent(env, opts.agent) : { account: providerAccount(env) };
  const account = self.account;
  const provider = account?.address || self.wallet || env?.AGENT_PROVIDER_WALLET || null;
  const forced = AGENT_SERVICE[opts.agent] || null;
  const sellerOf = (serviceId) => accountForAgent(env, SLUG_OF[serviceId]);

  // --- a task in plain words (2026-10-04) --------------------------------
  // Marketplaces test agents with text, not skills: Marque's "callable"
  // check asks what we take in one sentence, and its rebalancing test hands
  // over a V3 position at a past block and wants strict JSON. Answered here
  // when no skill was named, with the JSON as a text part (what a strict
  // reader parses) and as a data part.
  if (!skill && text) {
    const task = parseTask(text);
    if (task) {
      try {
        const r = await answerTask(task, [env?.BSC_RPC_KEYED_URL_2, 'https://bsc-mainnet.public.blastapi.io', 'https://bsc-dataseed1.defibit.io'].filter(Boolean));
        return rpcOk(id, { kind: 'message', role: 'agent', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: JSON.stringify(r.json) }, { kind: 'data', data: r.json }] });
      } catch (e) {
        return rpcErr(id, -32000, `could not answer that ${task.kind} task at block ${task.block ?? task.range?.block ?? 'latest'}: ${String(e.message || e).slice(0, 160)}`);
      }
    }
    if (/what (task|tasks|job|jobs) do you (take|do|handle)|what do you do|what can you do|in one sentence/i.test(text)) {
      const sentence = forced === 'lp_position_plan'
        ? 'I manage PancakeSwap V3 liquidity ranges on BNB Chain: give me a position (and optionally a block and a re-centring policy) and I return whether it is in range, how far it is from its bounds, whether a re-set is due, the new range centred on the price and the token amounts to mint it — the same code that runs our own CAKE/BNB position every day (a wide ±20% range, re-set centred with one swap once the price has stayed outside), hireable over ERC-8183 for ' + SERVICES.lp_position_plan.price_display.replace('USD1', '$U') + '.'
        // Each agent introduces itself (2026-10-12): all five answered with the
        // shared catalogue line, so a marketplace asking "what do you do"
        // could not tell the Venus monitor from the grid planner.
        : forced ? ownSentence(SERVICES[forced])
        : `I sell ${Object.keys(SERVICES).length} on-chain measurements on BNB Chain — Venus health factor, grid break-even, yield after gas, rebalance cost, PancakeSwap fee-tier and position plans — each hireable over ERC-8183 for ${SERVICES.health_factor.price_display} or per answer over x402.`;
      return rpcOk(id, { kind: 'message', role: 'agent', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: sentence }] });
    }
    // any other question on an agent's own endpoint: what it understood, what is missing, the filled-in request
    // (understand.js, 2026-10-13 — it used to answer every question with its self-description and the whole catalogue)
    if (forced && SERVICES[forced]) {
      const r = understoodReply({ service: SERVICES[forced], text, missing: missingInput, agentUrl: `https://agent.brainonbnb.com/${opts.agent}/a2a` });
      // THE FREE HALF, ANSWERED (2026-10-15): "is this position in range" got a price and a link, though the card
      // promises the reading and the MCP tool gives it away; the reading leads now, the offer for the paid half follows
      const free = opts.freeHalf ? await opts.freeHalf(r.data.understood.params || {}, text).catch(() => null) : null;
      if (free) {
        const data = { ...free.figures, free_reading: free.out, paid_half: r.data };
        return rpcOk(id, { kind: 'message', role: 'agent', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: JSON.stringify(data) }, { kind: 'data', data }] });
      }
      return rpcOk(id, { kind: 'message', role: 'agent', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: r.sentence }, { kind: 'data', data: r.data }] });
    }
  }
  // A question as data, without a skill (2026-10-15): {wallet}, {position}, {address} on an agent's own endpoint is
  // answered with the free reading, as its MCP tool answers it, instead of the agent describing itself.
  if (!skill && forced && opts.freeHalf && Object.keys(data).length) {
    const free = await opts.freeHalf({ ...data, ...(data.params || {}) }, [data.task_description, data.description, text].filter(Boolean).join(' ')).catch(() => null);
    if (free) {
      const out = { ...free.figures, free_reading: free.out, paid_half: { service: forced, price: `0.10 USD1 per answer over x402 (or half that in $BOBAI), or ${SERVICES[forced].price_display} through the ERC-8183 escrow`, pay_per_answer: `https://agent.brainonbnb.com/answer?service=${forced}`, escrow: `send skill:"negotiate-erc8183-job" to https://agent.brainonbnb.com/${opts.agent}/a2a` } };
      return rpcOk(id, { kind: 'message', role: 'agent', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: JSON.stringify(out) }, { kind: 'data', data: out }] });
    }
  }

  // --- BNB's standard hire (2026-10-04) ----------------------------------
  // The SDK dialect: a signed NegotiationResult the buyer anchors as the job
  // description. Marketplaces on the BNB Agent SDK speak only this, so
  // without it none of our agents could be hired there.
  if (skill === 'negotiate-erc8183-job') {
    if (!ourAccounts(env).length) return rpcErr(id, -32000, 'this agent cannot sign a quote: no provider key configured');
    const wanted = [data.task_description, data.terms?.deliverables, text].filter(Boolean).join(' ');
    const elsewhere = misdirected(forced, wanted, data);
    if (elsewhere) return rpcOk(id, agentMessage({ accepted: false, reason_code: '0x03', reason: elsewhere }));
    // A PLAIN PRICE REQUEST ON THE SHARED ENDPOINT (2026-10-24, operator's go: "beide beheben"): "Quote your standard
    // deliverable" names no service, and #49467's card points here; it was declined and Pokter marks that
    // seller-declined. The one service that needs nothing named — the Venus health factor of the hiring wallet, read at
    // delivery — is quoted, and the signed terms say so and list the others. A brief that names a service gets that one.
    const picked = forced ? SERVICES[forced] : pickService(wanted, data.service);
    const plainAsk = !forced && !picked && !data.service;
    const service = picked || (plainAsk ? SERVICES.health_factor : null);
    if (!service || (service.id === 'lp_position_plan' && !forced)) {
      return rpcOk(id, agentMessage({ accepted: false, reason_code: '0x03', reason: service ? 'The position plan is sold through the escrow by the DeFi agent at https://agent.brainonbnb.com/defi-agent/a2a.' : `We do not sell that. For sale here: ${Object.values(SERVICES).filter((s) => s.id !== 'lp_position_plan').map((s) => `${s.id} (${s.name})`).join('; ')}.` }));
    }
    // WHAT THE WORK CANNOT START WITHOUT IS ASKED BEFORE THE QUOTE IS SIGNED
    // (2026-10-05). An SDK buyer never sends params after funding: a quote
    // signed for "rebalance my holdings" with no holdings named became a
    // funded job nobody could deliver, its budget held until expiry. The
    // two services that can read the hiring wallet instead (the Venus health
    // factor, the position plan) are quoted; deliverJob falls back to it.
    const need = missingInput(service.id, extractParams([data.task_description, data.terms?.deliverables].filter(Boolean).join(' '), data.params || {}));
    // NO TOKEN NAMED: THE PLAN IS FOR WBNB (operator's go, 2026-10-22). Pokter asks every agent for a price with a
    // generic brief; the grid planner and the fee tier agent declined it and showed as not hireable there. The x402 path
    // already plans WBNB when nothing is named; now the escrow quote does the same, and says so in the signed terms.
    const wbnbDefault = !!need && TOKEN_DEFAULTS_TO_WBNB.has(service.id);
    // NOTHING NAMED ON THE REBALANCER (2026-10-23): Pokter's "Quote your standard deliverable so a buyer can see the
    // price" was declined for want of holdings and marked seller-declined. Delivery reads the hiring wallet's holdings
    // from the chain (rebalanceDefaultTarget, as the x402 path does since 2026-10-15); the signed terms say so.
    const holdingsDefault = !!need && service.id === 'rebalance_plan';
    if (need && service.id !== 'health_factor' && service.id !== 'lp_position_plan' && !wbnbDefault && !holdingsDefault) {
      return rpcOk(id, agentMessage({ accepted: false, reason_code: '0x04', reason: `${need}. Name it in task_description and ask again — nothing was quoted.` }));
    }
    const asked = extractParams([data.task_description, data.terms?.deliverables, text].filter(Boolean).join(' '), data.params || {});
    const cannot = await cannotPlan(service.id, wbnbDefault ? { ...asked, token: WBNB_TOKEN } : asked);
    if (cannot) return rpcOk(id, agentMessage({ accepted: false, reason_code: '0x04', reason: `${cannot} Nothing was quoted.` }));
    // signed by the agentWallet of the agent selling it: the key an SDK buyer checks the quote against
    const seller = await sellerOf(service.id);
    if (!seller.account) return rpcOk(id, agentMessage({ accepted: false, reason_code: '0x05', reason: `${seller.reason}.` }));
    const q = await signedQuote({ data, service, account: seller.account, chainId: ERC8183.chainId, verifyingContract: ERC8183.commerce, currency: ERC8183.paymentToken, note: wbnbDefault ? WBNB_NOTE : holdingsDefault ? REBALANCE_DEFAULT_NOTE : plainAsk ? PLAIN_ASK_NOTE : null });
    if (!q.ok) return rpcOk(id, agentMessage({ accepted: false, reason_code: q.reason_code, reason: q.reason }));
    return rpcOk(id, agentMessage({ ...q.envelope, job_requirements: jobRequirements(await quoteWindow()) }));
  }
  if (skill === 'erc8183-job-status') {
    const jobId = String(data.job_id ?? '').match(/^\d+$/)?.[0];
    if (!jobId) return rpcErr(id, -32602, "erc8183-job-status requires an integer 'job_id'");
    const job = await readJob(jobId);
    if (!job) return rpcErr(id, -32000, `job ${jobId} does not exist in the kernel`);
    return rpcOk(id, agentMessage({ job_id: Number(jobId), client: job.client, provider: job.provider, status: job.status, budget: String(job.budget), deliverable_url: `https://agent.brainonbnb.com/job/${jobId}/result` }));
  }

  // --- what do you sell -------------------------------------------------
  if (!skill || skill === 'list' || skill === 'capabilities') {
    // On an agent's own endpoint its own service leads (2026-10-12): a "hello"
    // to the grid planner answered with a list headed "hireable services".
    const own = forced ? SERVICES[forced] : null;
    return rpcOk(id, flatMessage({
      agent: own ? `Brain on BNB — ${own.name}` : 'Brain on BNB — hireable services',
      ...(own ? { this_agent: ownSentence(own), service: own } : {}),
      // the meeting place, named to every agent that asks what we do (2026-10-23)
      plaza_board: 'Something between agents not working? The Brain Board: bugs, fixes and help between AI agents and platforms — read https://agent.brainonbnb.com/board.md, your agent’s checkup https://agent.brainonbnb.com/board/agent/<your id>, skill "plaza-board" here.',
      provider,
      currency: 'U',
      payment: 'ERC-8183 escrow on BNB Chain, kernel ' + ERC8183.commerce,
      services: own ? [own, ...Object.values(SERVICES).filter((s) => s !== own)] : Object.values(SERVICES),
      can_sign: !!account,
      how: 'Send skill:"negotiate" with terms.deliverables describing what you need. You get a quote naming this provider address and a price. Fund a job in the kernel against that address, then send skill:"notify_funded" with job_id.',
    }));
  }

  // --- negotiate ---------------------------------------------------------
  if (skill === 'negotiate' || skill === 'quote') {
    if (!provider) return rpcErr(id, -32000, 'this agent has no provider address configured and cannot quote');
    // task / description / request too (2026-10-18): an outside review sent the card's example under "task" and was told
    // "we do not sell that"; only task_description was read
    const wanted = [data.task_description, data.task, data.description, data.request, data.terms?.deliverables, text].filter((v) => typeof v === 'string' && v).join(' ');
    const elsewhere = misdirected(forced, wanted, data);
    if (elsewhere) return rpcOk(id, flatMessage({ accepted: false, reason: elsewhere }));
    const service = forced ? SERVICES[forced] : pickService(wanted, data.service);
    // The position plan is sold through the escrow by the DeFi agent alone
    // (2026-10-04, its own identity and endpoint /defi-agent). On the shared
    // endpoint it is still x402 only — the card there says escrow: false.
    if (service && service.id === 'lp_position_plan' && opts.agent !== 'defi-agent') {
      return rpcOk(id, flatMessage({ accepted: false, reason: 'The position plan is sold per answer over x402 here, or through the ERC-8183 escrow by the DeFi agent at https://agent.brainonbnb.com/defi-agent/a2a.', buy_it_here: 'POST https://agent.brainonbnb.com/answer?service=lp_position_plan', price: service.price_display }));
    }
    if (!service) {
      return rpcOk(id, flatMessage({
        accepted: false,
        reason: `We do not sell that. ${Object.keys(SERVICES).length} things are for sale here (listed below) and all of them are measurements, not opinions.`,
        services: Object.values(SERVICES).map((s) => ({ id: s.id, name: s.name, price: s.price, currency: 'U' })),
      }));
    }
    const cannot = await cannotPlan(service.id, extractParams(wanted, data.params || {}));
    if (cannot) return rpcOk(id, flatMessage({ accepted: false, reason: `${cannot} Nothing was quoted.` }));
    const seller = await sellerOf(service.id);
    if (!seller.account) return rpcOk(id, flatMessage({ accepted: false, reason: `${seller.reason}.` }));
    const sellerAddress = seller.account.address;
    const req = jobRequirements(await quoteWindow());
    // SIGNED ON THIS DIALECT TOO (2026-10-30): Marque asks with "negotiate" and showed our six as
    // identity_matched_unsigned beside eleven provider_signed agents. An ask that carries terms gets the same envelope
    // as negotiate-erc8183-job next to the flat fields; if it cannot be signed the flat quote stands as before.
    // SafeHire nests the same ask under data.request.
    const ask = data.terms ? data : data.request?.terms ? { ...data, ...data.request } : null;
    const signed = ask ? await signedQuote({ data: ask, service, account: seller.account, chainId: ERC8183.chainId, verifyingContract: ERC8183.commerce, currency: ERC8183.paymentToken }).catch(() => null) : null;
    return rpcOk(id, flatMessage({
      ...(signed?.ok ? signed.envelope : {}),
      // Flat dialect: a provider address and a price, which is everything a
      // buyer needs and is the half the other dialect leaves out.
      accepted: true,
      provider: sellerAddress,
      price: service.price,
      price_display: service.price_display.replace("USD1", "$U"),
      currency: 'U',
      service: service.id,
      category: service.category,
      deliverables: service.deliverables,
      needs: service.needs,
      estimated_completion_seconds: 120,
      instructions: `Create a job in ${ERC8183.commerce} naming ${sellerAddress} as provider, set the budget to ${service.price} (${service.price_display.replace("USD1", "$U")}), fund it, then send skill:"notify_funded" with job_id and the parameters listed under "needs". Evaluator: ${ERC8183.router}; expiry at least ${Math.round(req.min_expiry_seconds_after_funding / 86400)} days after funding (see job_requirements).`,
      chain_id: 56,
      verifying_contract: ERC8183.commerce,
      payment_token: ERC8183.paymentToken,
      job_requirements: req,
    }));
  }

  // --- deliver -----------------------------------------------------------
  if (skill === 'notify_funded' || skill === 'deliver' || skill === 'start') {
    const jobId = String(data.job_id ?? data.jobId ?? '').match(/^\d+$/)?.[0];
    if (!jobId) return rpcErr(id, -32602, 'notify_funded needs job_id');
    const r = await deliverJob(jobId, env, { text, data });
    return r.error ? rpcErr(id, -32000, r.error) : rpcOk(id, r.result);
  }

  // --- a skill named by the id the card lists it under (2026-10-18) ------
  // The cards list each service as a skill (health_factor, grid_plan …); an outside review sent
  // {"skill":"health_factor","address":…} and got -32601 unknown skill — only plain words reached it. Now the id is
  // answered as the plain question is: the free reading where this agent has one, the paid half's terms with it.
  if (SERVICES[skill]) {
    if (forced && forced !== skill) {
      return rpcOk(id, flatMessage({ accepted: false, reason: `This agent sells ${forced} (${SERVICES[forced].name}). ${skill} is sold by https://agent.brainonbnb.com/${SLUG_OF[skill]}/a2a — or per answer over x402 at https://agent.brainonbnb.com/answer?service=${skill}.` }));
    }
    const paidHalf = { service: skill, price: `0.10 USD1 per answer over x402 (or half that in $BOBAI), or ${SERVICES[skill].price_display} through the ERC-8183 escrow`, pay_per_answer: `https://agent.brainonbnb.com/answer?service=${skill}`, escrow: `send skill:"negotiate-erc8183-job" to https://agent.brainonbnb.com/${SLUG_OF[skill]}/a2a` };
    const { skill: _s, method: _m, ...inputs } = data;
    const free = forced && opts.freeHalf ? await opts.freeHalf({ ...inputs, ...(data.params || {}) }, [data.task_description, data.task, text].filter((v) => typeof v === 'string' && v).join(' ')).catch(() => null) : null;
    const out = free
      ? { ...free.figures, free_reading: free.out, paid_half: paidHalf }
      : { service: SERVICES[skill], free_reading: forced ? `none for these inputs — ${missingInput(skill, extractParams(String(data.task || data.task_description || text || ''), { ...inputs, ...(data.params || {}) })) || 'name the address'}` : `ask this agent's own endpoint, https://agent.brainonbnb.com/${SLUG_OF[skill]}/a2a`, paid_half: paidHalf };
    return rpcOk(id, { kind: 'message', role: 'agent', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: JSON.stringify(out) }, { kind: 'data', data: out }] });
  }

  return rpcErr(id, -32601, `unknown skill "${skill}". Send skill:"list" to see what is for sale.`);
}

// THE DELIVERY ITSELF, out of the A2A handler (2026-10-04). A buyer who hires
// the way BNB's own SDK does — signed quote, createJob, fund — never sends
// notify_funded: the reference seller watches the kernel for funded jobs
// naming it. Ours waited for the message, so a job funded through Marque or
// any SDK client would have sat FUNDED until it expired. The cron's watcher
// (watchFundedJobs) and notify_funded now share this one path; nothing in it
// trusts the caller — the job, its provider, evaluator and budget are read
// from the chain.
export async function deliverJob(jobId, env, { text = '', data = {} } = {}) {
  if (!ourAccounts(env).length) return { error: 'this agent cannot deliver: no provider key configured' };
  const job = await readJob(jobId);
  if (!job) return { error: `job ${jobId} does not exist in the kernel` };
  // delivered by the key the job names as provider (agent-wallets.js, 2026-10-21): any of ours, never another's
  const account = accountFor(env, job.provider);
  if (!account) {
    return { error: `job ${jobId} names ${job.provider} as provider. That is not us — we would be working for somebody else's escrow.` };
  }
  if (job.status === 'SUBMITTED' || job.status === 'COMPLETED') {
    const prior = await env.AGENT.get(`job:${jobId}`, 'json');
    return { result: { already_delivered: true, job_id: jobId, status: job.status, result: prior?.result ?? null, deliverable_url: `https://agent.brainonbnb.com/job/${jobId}/result` } };
  }
  if (job.status !== 'FUNDED') {
    return { error: `job ${jobId} is ${job.status}. Fund it first — nothing is worked on before the escrow holds the budget.` };
  }
  // A JOB THAT EXPIRES INSIDE THE DISPUTE WINDOW CANNOT BE DELIVERED
  // (2026-10-04). The kernel refuses submit() with 0x15e5dd74 when the job
  // would expire before the policy's window (7 days) closes — found on two
  // jobs funded through mandatemarkets.com with a 6-day expiry. Saying so
  // before any work keeps the watcher from computing and retrying an answer
  // the chain will not take; the buyer's budget returns at expiry.
  {
    const windowSec = await readDisputeWindow(async (to, data) => {
      const r = await fetch(RPCS[0], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }), signal: AbortSignal.timeout(10000) });
      return (await r.json()).result;
    });
    if (job.expired_at && job.expired_at < Math.floor(Date.now() / 1000) + windowSec) {
      return { error: `job ${jobId} expires ${new Date(job.expired_at * 1000).toISOString()}, inside the escrow's ${Math.round(windowSec / 86400)}-day dispute window, so the kernel refuses any delivery (0x15e5dd74). Nothing was worked; the budget returns to the buyer at expiry (claimRefund). Create the job with an expiry at least ${Math.round(windowSec / 86400) + 1} days out.`, permanent: true };
    }
  }
  // WORK ONLY FOR AN ESCROW THAT CAN PAY (2026-09-18). A job is released by
  // the policy only when its evaluator and hook are the router. Anyone can
  // create a job naming us as provider and THEMSELVES as evaluator, fund ten
  // cents, take the full result out of this very response, then reject the
  // job and claim the refund — free answers, our gas. hire.js has always
  // said so ("a job registered with a different evaluator never reaches the
  // policy that releases it"); the seller never looked.
  const router = String(ERC8183.router).toLowerCase();
  const zero = '0x0000000000000000000000000000000000000000';
  const evaluator = String(job.evaluator || '').toLowerCase(), hook = String(job.hook || '').toLowerCase();
  if (evaluator !== router || (hook !== router && hook !== zero && hook !== '')) {
    return { error: `job ${jobId} is evaluated by ${job.evaluator || 'nobody'}${job.hook ? ` with hook ${job.hook}` : ''}, not by this escrow's router (${ERC8183.router}). Only a job the router evaluates reaches the policy that pays the seller — create it through https://agent.brainonbnb.com/hire and nothing else changes for you.`, permanent: true };
  }
  // ONE DELIVERY PER JOB. Two notify_funded for one job used to run the work
  // twice, and the second one's document replaced the stored one after the
  // first one's digest was already on-chain. A short lock, read back.
  const lockKey = `lock:job:${jobId}`, lockBy = crypto.randomUUID();
  const held = await env.AGENT.get(lockKey);
  if (held) return { error: `job ${jobId} is being delivered by another request right now — follow it at https://agent.brainonbnb.com/job?id=${jobId}` };
  await env.AGENT.put(lockKey, lockBy, { expirationTtl: 120 });
  if ((await env.AGENT.get(lockKey)) !== lockBy) return { error: `job ${jobId} is being delivered by another request right now` };

  // WHAT WAS BOUGHT IS WHAT THE CHAIN SAYS WAS BOUGHT. notify_funded needs no
  // authentication — it only says "look at the chain" — so nothing in it may
  // decide the work: `service` and `params` in the message used to win over
  // the job's own description, and anyone who saw a funded job could have a
  // different document committed on-chain for the real buyer. The message
  // now only fills what the description does not say.
  // A quote we signed names its service in the deliverables ("service
  // lp_position_plan — …", see signedQuote), and that sentence is in the job
  // description the buyer anchored. It wins over guessing from prose: six of
  // our agents share one provider address, so the job itself cannot say
  // which one was hired.
  const tagged = String(job.description || '').match(/\bservice ([a-z_]+)\b/)?.[1];
  const service = (tagged && SERVICES[tagged]) || pickService(job.description, null) || pickService('', data.service);
  if (!service) return { error: 'the job description does not match anything we sell', permanent: true };
  // the price of the hour the quote was signed (a sale quote delivered after the sale is still paid in full)
  const due = dueFor(job.description);
  if (BigInt(job.budget) < due) {
    return { error: `job ${jobId} is funded with ${Number(job.budget) / 1e18} $U; ${service.name} costs ${Number(due) / 1e18} $U`, permanent: true };
  }

  // A signed (SDK) description is JSON whose currency and verifying_contract
  // are addresses too — the first address in the raw text was the $U token,
  // read as "the wallet to plan for" (job 56905, 2026-10-04). Only the
  // buyer's own words are read: the task and the terms.
  const humanText = (() => {
    const raw = String(job.description || '');
    try { const d = JSON.parse(raw); if (d && (d.task || d.terms)) return [d.task, d.terms?.deliverables, d.terms?.quality_standards].filter(Boolean).join(' '); } catch { /* not JSON */ }
    return raw;
  })();
  const fromChain = extractParams(humanText, {});
  const asked = extractParams(String(text || ''), data.params || data);
  // THE BUYER'S NUMBERS, READ (2026-10-23): "a 45-level grid … between 500 and 5500 with 5000 USDT" (Marque job 57037)
  // was planned with the defaults — extractParams reads addresses and positions, not levels, capital or bounds. The A2A
  // reading (understand.js) does, and goes under what the job and the buyer named explicitly.
  const params = { ...understand(service, humanText), ...asked, ...fromChain, service: service.id };
  let result;
  try {
    // THE DEFI AGENT WITHOUT A POSITION NAMED (2026-10-04). A marketplace
    // hire carries the buyer's words and often no position id: the plan is
    // then made for the wallet that paid, and if that wallet holds no single
    // V3 position, for the agent's own — the delivery is still the agent's
    // real decision, and the document says whose position it read.
    if (service.id === 'lp_position_plan' && missingInput(service.id, params)) {
      try { result = await doWork(service.id, { ...params, address: job.client }, env); result.read_for = `the hiring wallet ${job.client}`; }
      catch { result = await doWork(service.id, { ...params, address: LP_AGENT_WALLET }, env); result.read_for = `the agent's own position (wallet ${LP_AGENT_WALLET}) — the hiring wallet ${job.client} holds no single PancakeSwap V3 position and none was named`; }
    } else if (service.id === 'health_factor' && missingInput(service.id, params)) {
      // no account named (2026-10-05): the wallet that paid is the one read, and the document says so
      result = await doWork(service.id, { ...params, address: job.client }, env); result.read_for = `the hiring wallet ${job.client} — no account was named in the task`;
    } else if (service.id === 'rebalance_plan' && missingInput(service.id, params)) {
      // nothing named (2026-10-23): the quote said the hiring wallet's holdings, read now
      const got = await rebalanceDefaultTarget(job.client);
      result = await doWork(service.id, { ...params, holdings: got.holdings }, env); result.read_for = got.target;
    } else if (TOKEN_DEFAULTS_TO_WBNB.has(service.id) && missingInput(service.id, params)) {
      // no token named (2026-10-22): the quote said WBNB, so WBNB is planned, and the document says so
      result = await doWork(service.id, { ...params, token: WBNB_TOKEN }, env); result.read_for = WBNB_NOTE;
    } else result = await doWork(service.id, params, env);
  } catch (e) {
    // A job we cannot do is not delivered and not charged for. The buyer's
    // budget stays in escrow and comes back to them at expiry, which is the
    // correct outcome and the one the kernel already implements.
    await env.AGENT.delete(lockKey).catch(() => {});
    // an input the job never named will not appear by trying again; anything else may pass (the watcher retries)
    return { error: `could not complete job ${jobId}: ${e.message}. Nothing was submitted; your budget is untouched and returns to you at expiry.`, ...(missingInput(service.id, params) ? { permanent: true } : {}) };
  }

  const document = JSON.stringify({
    job_id: jobId,
    service: service.id,
    provider: account.address,
    client: job.client,
    produced_at: new Date().toISOString(),
    ...checkedFigures(service.id, result),
    result,
    method: 'Every figure here is read from the chain at the time above. Nothing is cached and nothing is self-reported.',
    verify: 'The bytes32 on this job is the SHA-256 of exactly this document as served.',
  });

  // The document is stored BEFORE it is sent, and a submit that throws is an
  // answer, not a bare 500: the transaction may still land, and a deliverable
  // on-chain with no document behind it cannot be checked by anyone.
  const already = await env.AGENT.get(`job:${jobId}`, 'json');
  if (!already) await env.AGENT.put(`job:${jobId}`, JSON.stringify({ document, delivery: null, result }), { expirationTtl: 60 * 60 * 24 * 365 });
  let delivery;
  try { delivery = await submitDeliverable({ env, jobId, document, readJob }); }
  catch (e) {
    await env.AGENT.delete(lockKey).catch(() => {});
    return { error: `job ${jobId}: the work is done and stored, but writing it on-chain did not go through (${String(e.shortMessage || e.message || e).slice(0, 160)}). Send notify_funded again in a minute — the same document is submitted, nothing is worked twice. https://agent.brainonbnb.com/job/${jobId}/result` };
  }
  // A delivery that was already on-chain keeps the document it was made from.
  if (!delivery?.already) await env.AGENT.put(`job:${jobId}`, JSON.stringify({ document, delivery, result }), { expirationTtl: 60 * 60 * 24 * 365 });

  return { result: {
    delivered: true,
    job_id: jobId,
    service: service.id,
    result,
    on_chain: delivery,
    deliverable_url: `https://agent.brainonbnb.com/job/${jobId}/result`,
    note: 'The deliverable is on-chain in full, not as a link. The bytes32 is the SHA-256 of the document served at the URL above, so both can be checked against each other.',
  } };
}

// The stored deliverable, served so the on-chain digest can be checked against
// something. A commitment to a document nobody can fetch proves nothing.
export async function handleJobResult(jobId, env) {
  const stored = await env.AGENT.get(`job:${jobId}`, 'json');
  if (!stored) return new Response(JSON.stringify({ error: `no deliverable stored for job ${jobId}` }, null, 2), { status: 404, headers: { 'content-type': 'application/json' } });
  return new Response(stored.document, {
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'x-deliverable-digest': stored.delivery?.deliverable_digest || '',
      'x-deliverable-tx': stored.delivery?.tx || '',
    },
  });
}
