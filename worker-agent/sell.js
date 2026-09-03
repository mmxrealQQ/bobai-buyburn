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
    deliverables: 'Every Venus core-pool market ranked by supply APY, computed from the rate per block and a block time measured against the chain rather than the 10,512,000-blocks-a-year constant most published BSC yield figures still use — which understates these rates by about 6.7x. Cross-checked against Venus\'s own published APY, with divergences named. Given an amount and what you earn today it returns the days until a move pays for its own gas, which below a certain position size is never.',
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
    deliverables: 'A pair on PancakeSwap lives in up to five pools at once — V2 at 0.25% and V3 at 0.01%, 0.05%, 0.25% and 1.00% — and every interface ranks them by the money already parked in them, which is not what they pay. This measures each tier over a live window: turnover, the fees the pool actually paid out, and what your capital would have earned in each, both sides of the pool counted. And it does the sum the way the money actually works: fees go to the liquidity standing where the trade happens, so each tier is also read at the price - the tick book of the pool itself is walked to find what is parked within a couple of percent of it - with your own size in the denominator, because arriving is what dilutes it. On a constant-product pool that is under one percent of the balance, so the tier holding the most money is regularly not the tier you would be competing with least. It names the tiers holding real money that did not trade at all, and states how long the better tier would have to keep paying before a move pays for its own gas. Not annualised: the window travels with every figure.',
    needs: { token: 'the token or PancakeSwap pool to compare tiers for (0x…)', capitalUsd: 'how much liquidity you are placing, optional — defaults to 1000' },
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
export async function doWork(serviceId, params) {
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
function pickService(text = '', explicit) {
  if (explicit && SERVICES[explicit]) return SERVICES[explicit];
  const t = String(text).toLowerCase();
  // Order matters. "venus" appears in both lending questions and yield ones,
  // so the more specific intent is tested first: somebody asking about APY or
  // where to earn wants the yield agent even though they said Venus.
  if (/\bapy\b|\bapr\b|yield|best rate|earn(ing)? (the )?most|where to (put|park|lend)|supply rate/.test(t)) return SERVICES.yield_plan;
  // Before the rebalance test, and this order is load-bearing. Someone asking
  // "which fee tier should I provide liquidity in" is asking about LP range
  // placement, and the rebalance pattern below matches "allocation" — which
  // would have quietly sold them a portfolio rebalance instead.
  if (/fee.?tier|which (pool|tier)|provide liquidity|add liquidity|LP|liquidity provider|where to (lp|pool)|v3 (range|tier)/i.test(t)) return SERVICES.lp_tier_plan;
  if (/rebalanc|re-?weight|target weight|allocation|drift|portfolio/.test(t)) return SERVICES.rebalance_plan;
  if (/health.?factor|liquidat|collateral|venus|lending|borrow/.test(t)) return SERVICES.health_factor;
  if (/grid|ladder|range.?bot|dca.?grid/.test(t)) return SERVICES.grid_plan;
  return null;
}

const extractParams = (text = '', given = {}) => {
  const addr = String(text).match(/0x[a-fA-F0-9]{40}/)?.[0];
  const out = { ...given };
  if (addr && !out.address && !out.token) { out.address = addr; out.token = addr; }

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
};
// The seed sentences carry the numbers a service needs in words; the same
// extractor a funded job goes through turns them into parameters, plus the
// two the sentences state but the extractor does not read.
const SEED_PARAMS = {
  grid_plan: { levels: 10, bandPct: 15, capitalUsd: 1000 },
  yield_plan: { amountUsd: 1000 },
  lp_tier_plan: { capitalUsd: 1000 },
};
export async function exampleFor(serviceId, env, { fresh = false } = {}) {
  const service = SERVICES[serviceId];
  if (!service) return null;
  const key = `example:${serviceId}`;
  if (!fresh && env?.AGENT) {
    const cached = await env.AGENT.get(key, 'json').catch(() => null);
    if (cached) return { ...cached, cached: true };
  }
  const task = SEED_TASKS[serviceId];
  const params = extractParams(task, { ...(SEED_PARAMS[serviceId] || {}), service: serviceId });
  const t0 = Date.now();
  const result = await doWork(serviceId, params);
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
  return out;
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
    if (!service) {
      return rpcOk(id, {
        accepted: false,
        reason: 'We do not sell that. Two things are for sale here and both are measurements, not opinions.',
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

    const service = pickService(job.description, data.service);
    if (!service) return rpcErr(id, -32000, 'the job description does not match anything we sell');
    if (BigInt(job.budget) < PRICE_WEI(service.price)) {
      return rpcErr(id, -32000, `job ${jobId} is funded with ${Number(job.budget) / 1e18} $U; ${service.name} costs ${service.price_display}`);
    }

    const params = extractParams(`${job.description} ${text}`, data.params || data);
    let result;
    try {
      result = await doWork(service.id, params);
    } catch (e) {
      // A job we cannot do is not delivered and not charged for. The buyer's
      // budget stays in escrow and comes back to them at expiry, which is the
      // correct outcome and the one the kernel already implements.
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

    const delivery = await submitDeliverable({ env, jobId, document, readJob });
    await env.AGENT.put(`job:${jobId}`, JSON.stringify({ document, delivery, result }), { expirationTtl: 60 * 60 * 24 * 365 });

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
