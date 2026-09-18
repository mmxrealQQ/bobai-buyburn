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
import { rebalancePlan } from './rebalance.js';
import { lpTierPlan } from './lp-tiers.js';
import { lpPositionPlan } from './lp-service.js';
import { decodeJob, ERC8183 } from './hire.js';
import { submitDeliverable, providerAccount } from './submit.js';

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
    deliverables: 'Every Venus core-pool market ranked by supply APY, computed from the rate per block and a block time measured against the chain rather than the 10,512,000-blocks-a-year constant most published BSC yield figures still use — which understates these rates by about 6.7x. Cross-checked against Venus\'s own published APY whenever their API answers — every row and the summary say whether it did, and a divergence is named. Given an amount and what you earn today it returns the days until a move pays for its own gas, which below a certain position size is never.',
    needs: { amountUsd: 'position size in USD, optional', from: 'the Venus market held today, optional', currentApyPct: 'what you earn today, optional' },
  },
  rebalance_plan: {
    id: 'rebalance_plan',
    name: 'Portfolio rebalance, priced against the pools that would execute it',
    category: 'rebalancing',
    price: '100000000000000000',
    price_display: '0.10 $U',
    deliverables: 'The swaps that move a BSC portfolio to target weights, each one costed against its own pool: swap fee, price impact at the actual size, and the transfer tax measured from executed trades. Returns the cost as a share of the money moved, and names the holding the bill is concentrated in. It does not claim to know what a correction is worth — that is a judgement about risk, not a quantity in a pool.',
    needs: { holdings: 'array of { token: "0x…", usd: 1000 }', targets: 'optional map of token → target weight in percent; equal weight if omitted' },
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

// Quoted in atomic units, because that is what every seller on this chain
// actually sends and a marketplace that publishes a census of other people's
// inconsistencies should not add one. price_display carries the human number.
const PRICE_WEI = (p) => BigInt(String(p));

// ---------------------------------------------------------------------------
// Reading the kernel. Deliberately a plain eth_call — the buyer's money is the
// thing being verified, so it is read from the chain and not from what the
// buyer told us.
// ---------------------------------------------------------------------------
async function readJob(jobId) {
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
export function missingInput(serviceId, params = {}) {
  const addr = (v) => /^0x[a-fA-F0-9]{40}$/.test(String(v || ''));
  const p = params || {};
  if (serviceId === 'health_factor') return addr(p.address) ? null : 'health_factor needs `address`: the account whose Venus position to read (0x…)';
  if (serviceId === 'grid_plan' || serviceId === 'lp_tier_plan') return addr(p.token) || addr(p.address) ? null : `${serviceId} needs \`token\`: the token or pool address (0x…)`;
  if (serviceId === 'rebalance_plan') return Array.isArray(p.holdings) && p.holdings.length ? null : 'rebalance_plan needs `holdings`: [{ "token": "0x…", "usd": 1000 }, …]';
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
    return { service: 'rebalance_plan', plan: await rebalancePlan(params || {}) };
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

export const extractParams = (text = '', given = {}) => {
  const addr = String(text).match(/0x[a-fA-F0-9]{40}/)?.[0];
  const out = { ...given };
  if (addr && !out.address && !out.token) { out.address = addr; out.token = addr; }
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
  if (!Array.isArray(out.holdings)) {
    const arr = String(text).match(/\[\s*\{[\s\S]*?\}\s*\]/)?.[0];
    if (arr) {
      try {
        const parsed = JSON.parse(arr);
        if (Array.isArray(parsed) && parsed.length) out.holdings = parsed;
      } catch { /* not JSON after all — fall through to the addresses */ }
    }
  }
  // No list in the text: read every address in the sentence as one holding and
  // split the stated capital evenly between them. Equal weight is the only
  // split that does not smuggle in a view about what the portfolio should be,
  // which is the same reasoning rebalance.js already applies to its targets.
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
  yield_plan: 'where is the best yield on BNB Chain for USDT right now',
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
      x402: `0.10 USD1 per answer (or the same in $BOBAI, quoted on the 402) at POST https://agent.brainonbnb.com/answer?service=${serviceId}`,
      ...(serviceId === 'lp_position_plan' ? {} : { escrow: `${service.price_display} through the ERC-8183 escrow on https://brainonbnb.com/registry ($U is United Stables, a dollar stablecoin)` }),
    },
    buy: `https://agent.brainonbnb.com/answer?service=${serviceId}`,
    terms: 'POST it once without payment: the 402 carries the price, the wallet and the inputs it needs',
  };
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
    price_display: service.price_display,
    task,
    produced_at: new Date().toISOString(),
    took_ms: Date.now() - t0,
    result,
    note: 'Run by the same code a funded job runs, on the sentence the hire box opens with. Not a paid job; the figures are from the moment above.',
  };
  if (env?.AGENT) await env.AGENT.put(key, JSON.stringify(out), { expirationTtl: 60 * 60 * 24 }).catch(() => {});
  return { ...out, ...exampleLinks(serviceId, service) };
}

export async function handleA2A(request, env) {
  let body;
  try { body = await request.json(); } catch { return rpcErr(null, -32700, 'not JSON'); }
  const id = body?.id;
  if (body?.method !== 'message/send') {
    return rpcErr(id, -32601, `this agent speaks message/send; "${body?.method}" is not implemented`);
  }

  const { data, text } = dataParts(body?.params?.message);
  const skill = String(data.skill || data.method || '').toLowerCase();
  const account = providerAccount(env);
  const provider = account?.address || env?.AGENT_PROVIDER_WALLET || null;

  // --- what do you sell -------------------------------------------------
  if (!skill || skill === 'list' || skill === 'capabilities') {
    return rpcOk(id, {
      agent: 'Brain on BNB — hireable services',
      provider,
      currency: 'U',
      payment: 'ERC-8183 escrow on BNB Chain, kernel ' + ERC8183.commerce,
      services: Object.values(SERVICES),
      can_sign: !!account,
      how: 'Send skill:"negotiate" with terms.deliverables describing what you need. You get a quote naming this provider address and a price. Fund a job in the kernel against that address, then send skill:"notify_funded" with job_id.',
    });
  }

  // --- negotiate ---------------------------------------------------------
  if (skill === 'negotiate' || skill === 'quote') {
    if (!provider) return rpcErr(id, -32000, 'this agent has no provider address configured and cannot quote');
    const wanted = [data.task_description, data.terms?.deliverables, text].filter(Boolean).join(' ');
    const service = pickService(wanted, data.service);
    // The position plan is sold per answer over x402 and nowhere else — the
    // card says so (escrow: false). Negotiating it here used to come back
    // accepted:true in $U, and a job funded on that quote would have been
    // worked through the escrow the card rules out (2026-09-18).
    if (service && service.id === 'lp_position_plan') {
      return rpcOk(id, { accepted: false, reason: 'The position plan is sold per answer over x402, not through the ERC-8183 escrow.', buy_it_here: 'POST https://agent.brainonbnb.com/answer?service=lp_position_plan', price: service.price_display });
    }
    if (!service) {
      return rpcOk(id, {
        accepted: false,
        reason: `We do not sell that. ${Object.keys(SERVICES).length} things are for sale here (listed below) and all of them are measurements, not opinions.`,
        services: Object.values(SERVICES).map((s) => ({ id: s.id, name: s.name, price: s.price, currency: 'U' })),
      });
    }
    return rpcOk(id, {
      // Flat dialect: a provider address and a price, which is everything a
      // buyer needs and is the half the other dialect leaves out.
      accepted: true,
      provider,
      price: service.price,
      price_display: service.price_display,
      currency: 'U',
      service: service.id,
      category: service.category,
      deliverables: service.deliverables,
      needs: service.needs,
      estimated_completion_seconds: 120,
      instructions: `Create a job in ${ERC8183.commerce} naming ${provider} as provider, set the budget to ${service.price} (${service.price_display}), fund it, then send skill:"notify_funded" with job_id and the parameters listed under "needs".`,
      chain_id: 56,
      verifying_contract: ERC8183.commerce,
      payment_token: ERC8183.paymentToken,
    });
  }

  // --- deliver -----------------------------------------------------------
  if (skill === 'notify_funded' || skill === 'deliver' || skill === 'start') {
    const jobId = String(data.job_id ?? data.jobId ?? '').match(/^\d+$/)?.[0];
    if (!jobId) return rpcErr(id, -32602, 'notify_funded needs job_id');
    if (!account) return rpcErr(id, -32000, 'this agent cannot deliver: no provider key configured');

    const job = await readJob(jobId);
    if (!job) return rpcErr(id, -32000, `job ${jobId} does not exist in the kernel`);
    if (job.provider.toLowerCase() !== account.address.toLowerCase()) {
      return rpcErr(id, -32000, `job ${jobId} names ${job.provider} as provider. That is not us — we would be working for somebody else's escrow.`);
    }
    if (job.status === 'SUBMITTED' || job.status === 'COMPLETED') {
      const prior = await env.AGENT.get(`job:${jobId}`, 'json');
      return rpcOk(id, { already_delivered: true, job_id: jobId, status: job.status, result: prior?.result ?? null, deliverable_url: `https://agent.brainonbnb.com/job/${jobId}/result` });
    }
    if (job.status !== 'FUNDED') {
      return rpcErr(id, -32000, `job ${jobId} is ${job.status}. Fund it first — nothing is worked on before the escrow holds the budget.`);
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
      return rpcErr(id, -32000, `job ${jobId} is evaluated by ${job.evaluator || 'nobody'}${job.hook ? ` with hook ${job.hook}` : ''}, not by this escrow's router (${ERC8183.router}). Only a job the router evaluates reaches the policy that pays the seller — create it through https://agent.brainonbnb.com/hire and nothing else changes for you.`);
    }
    // ONE DELIVERY PER JOB. Two notify_funded for one job used to run the work
    // twice, and the second one's document replaced the stored one after the
    // first one's digest was already on-chain. A short lock, read back.
    const lockKey = `lock:job:${jobId}`, lockBy = crypto.randomUUID();
    const held = await env.AGENT.get(lockKey);
    if (held) return rpcErr(id, -32000, `job ${jobId} is being delivered by another request right now — follow it at https://agent.brainonbnb.com/job?id=${jobId}`);
    await env.AGENT.put(lockKey, lockBy, { expirationTtl: 120 });
    if ((await env.AGENT.get(lockKey)) !== lockBy) return rpcErr(id, -32000, `job ${jobId} is being delivered by another request right now`);

    // WHAT WAS BOUGHT IS WHAT THE CHAIN SAYS WAS BOUGHT. notify_funded needs no
    // authentication — it only says "look at the chain" — so nothing in it may
    // decide the work: `service` and `params` in the message used to win over
    // the job's own description, and anyone who saw a funded job could have a
    // different document committed on-chain for the real buyer. The message
    // now only fills what the description does not say.
    const service = pickService(job.description, null) || pickService('', data.service);
    if (!service) return rpcErr(id, -32000, 'the job description does not match anything we sell');
    if (BigInt(job.budget) < PRICE_WEI(service.price)) {
      return rpcErr(id, -32000, `job ${jobId} is funded with ${Number(job.budget) / 1e18} $U; ${service.name} costs ${service.price_display}`);
    }

    const fromChain = extractParams(String(job.description || ''), {});
    const asked = extractParams(String(text || ''), data.params || data);
    const params = { ...asked, ...fromChain, service: service.id };
    let result;
    try {
      result = await doWork(service.id, params, env);
    } catch (e) {
      // A job we cannot do is not delivered and not charged for. The buyer's
      // budget stays in escrow and comes back to them at expiry, which is the
      // correct outcome and the one the kernel already implements.
      await env.AGENT.delete(lockKey).catch(() => {});
      return rpcErr(id, -32000, `could not complete job ${jobId}: ${e.message}. Nothing was submitted; your budget is untouched and returns to you at expiry.`);
    }

    const document = JSON.stringify({
      job_id: jobId,
      service: service.id,
      provider: account.address,
      client: job.client,
      produced_at: new Date().toISOString(),
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
      return rpcErr(id, -32000, `job ${jobId}: the work is done and stored, but writing it on-chain did not go through (${String(e.shortMessage || e.message || e).slice(0, 160)}). Send notify_funded again in a minute — the same document is submitted, nothing is worked twice. https://agent.brainonbnb.com/job/${jobId}/result`);
    }
    // A delivery that was already on-chain keeps the document it was made from.
    if (!delivery?.already) await env.AGENT.put(`job:${jobId}`, JSON.stringify({ document, delivery, result }), { expirationTtl: 60 * 60 * 24 * 365 });

    return rpcOk(id, {
      delivered: true,
      job_id: jobId,
      service: service.id,
      result,
      on_chain: delivery,
      deliverable_url: `https://agent.brainonbnb.com/job/${jobId}/result`,
      note: 'The deliverable is on-chain in full, not as a link. The bytes32 is the SHA-256 of the document served at the URL above, so both can be checked against each other.',
    });
  }

  return rpcErr(id, -32601, `unknown skill "${skill}". Send skill:"list" to see what is for sale.`);
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
