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
    // The four required categories all serve somebody spending money. This one
    // serves the other side of the market, and range management is what the
    // rebalancing category is defined as: "manages LP ranges, resets positions".
    category: 'rebalancing',
    price: '100000000000000000',
    price_display: '0.10 $U',
    deliverables: 'A pair on PancakeSwap lives in up to five pools at once — V2 at 0.25% and V3 at 0.01%, 0.05%, 0.25% and 1.00% — and every interface ranks them by the money already parked in them, which is not what they pay. This measures each tier over a live window: turnover, the fees the pool actually paid out, and what your capital would have earned in each, both sides of the pool counted. It names the tiers holding real money that did not trade at all, and states how long the better tier would have to keep paying before a move pays for its own gas. Not annualised: the window travels with every figure.',
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
async function doWork(serviceId, params) {
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
  return out;
};

// ---------------------------------------------------------------------------
// A2A JSON-RPC.
// ---------------------------------------------------------------------------
const rpcOk = (id, result) => Response.json({ jsonrpc: '2.0', id: id ?? 1, result });
const rpcErr = (id, code, message) => Response.json({ jsonrpc: '2.0', id: id ?? 1, error: { code, message } });

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
