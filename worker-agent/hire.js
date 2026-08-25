// Phase 4: hire for real. Negotiate a price with an agent, then hand the buyer
// the exact transactions that put the money in escrow.
//
// The broker answers "who can do this". The dispatcher calls a read-only tool
// and shows the answer. Neither one hires anybody — and hiring is the whole
// point of a marketplace. On BNB Chain that is ERC-8183: a job escrow where the
// buyer funds a Job in $U against a provider address, the provider submits a
// deliverable, and the escrow releases after an optimistic dispute window. If
// nothing is delivered, the buyer reclaims the budget after expiry.
//
// THE LINE IS UNCHANGED, and this is the part worth reading twice.
//
// We do not sign. We never hold a key belonging to the buyer, and no request to
// this worker can move anybody's money. `negotiate` is a read — it returns a
// signed quote and moves nothing. Everything after it is returned as UNSIGNED
// calldata that the buyer submits from their own wallet. That is the same
// stance the dispatcher takes on mutating tools, applied to the one flow where
// a payment genuinely has to happen: we prepare, you sign.
//
// It also happens to be the honest shape. An intermediary that escrows on a
// stranger's behalf is holding funds; one that hands over five calls is not.
//
// WHY THE CALLS ARE BUILT HERE AND NOT IN A LIBRARY
// The Altana SDK does this in one atomic relay intent, which is better if the
// buyer has an Altana wallet. Most do not. Plain calldata works from MetaMask,
// from a script, from another agent, and from an Altana session key — so the
// lowest common denominator is the right output, and the SDK path is offered
// alongside it rather than instead of it.

import { recordSession } from './sessions.js';

// AgenticCommerce kernel, EvaluatorRouter, OptimisticPolicy, ERC-8004 registry
// and the $U payment token, chain 56. Taken from ERC8183_ADDRESSES in
// @altananetwork/sdk 0.8.0 (packages/wallet — dist/erc8183.js), not from a blog
// post, and the kernel was read on-chain to confirm it answers: jobCounter()
// returned 56,655 and paymentToken() returned the address below.
//
// Note the registry is 0x8004…a432 — the same contract the census already
// scans. The identity layer and the employment layer are the same registry,
// which is why an agent id can be joined to a job history at all.
export const ERC8183 = {
  commerce: '0xEa4DAa3100A767e86FDed867729ae7446476EBA6',
  router: '0x51895229E12F9876011789B04f8698af06cCD6DA',
  policy: '0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5',
  registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  paymentToken: '0xcE24439F2D9C6a2289F741120FE202248B666666', // $U — "United Stables", 18 decimals
  chainId: 56,
};

// Order-locked with the kernel's enum. A job that reads SUBMITTED has a
// deliverable on-chain but the escrow has not released yet; COMPLETED means it
// has. The difference matters for a reputation number and is the reason we do
// not report "56,655 jobs" as if they were all finished work.
export const JOB_STATUS = ['OPEN', 'FUNDED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'EXPIRED'];

// Selectors computed from the ABI in the SDK, not guessed:
//   createJob(address,address,uint256,string,address)  0x41528812
//   registerJob(uint256,address)                       0x51d5456d
//   setBudget(uint256,uint256,bytes)                   0xdd4ae9d4
//   approve(address,uint256)                           0x095ea7b3
//   fund(uint256,uint256,bytes)                        0xd2e13f50
//   getJob(uint256)                                    0xbf22c457
//   jobCounter()                                       0x50355d76
//   claimRefund(uint256)                               0x5b7baf64
const SEL = {
  createJob: '0x41528812',
  registerJob: '0x51d5456d',
  setBudget: '0xdd4ae9d4',
  approve: '0x095ea7b3',
  fund: '0xd2e13f50',
  getJob: '0xbf22c457',
  jobCounter: '0x50355d76',
  claimRefund: '0x5b7baf64',
};

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addr = (a) => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0');

// UTF-8 bytes as hex, right-padded to a whole number of 32-byte words. Written
// out rather than borrowed because a Worker has TextEncoder but no Buffer, and
// a description containing a non-ASCII character encoded by charCode would
// produce calldata whose length prefix disagrees with its own payload.
const bytesHex = (s) => {
  const b = new TextEncoder().encode(s);
  let h = '';
  for (const x of b) h += x.toString(16).padStart(2, '0');
  const pad = (64 - (h.length % 64)) % 64;
  return { hex: h + '0'.repeat(pad), len: b.length };
};

// createJob(provider, evaluator, expiredAt, description, hook)
// Head is five words; `description` is dynamic so its slot carries the offset
// to the tail, which is 5 * 32 = 160 bytes from the start of the arguments.
const encodeCreateJob = ({ provider, evaluator, expiredAt, description, hook }) => {
  const d = bytesHex(description);
  return SEL.createJob
    + addr(provider)
    + addr(evaluator)
    + word(expiredAt)
    + word(160)
    + addr(hook)
    + word(d.len)
    + d.hex;
};

const encodeRegisterJob = (jobId, policy) => SEL.registerJob + word(jobId) + addr(policy);

// setBudget(jobId, amount, bytes optParams) and fund(jobId, expectedBudget,
// bytes optParams) share a shape: two static words then an empty bytes. The
// offset is 3 * 32 = 96 and the tail is a single zero length word. Passing no
// optParams is what the reference flow does; the policy reads its window from
// its own storage.
const encodeTwoWordsAndEmptyBytes = (sel, a, b) =>
  sel + word(a) + word(b) + word(96) + word(0);

const encodeSetBudget = (jobId, amount) => encodeTwoWordsAndEmptyBytes(SEL.setBudget, jobId, amount);
const encodeFund = (jobId, expectedBudget) => encodeTwoWordsAndEmptyBytes(SEL.fund, jobId, expectedBudget);
const encodeApprove = (spender, amount) => SEL.approve + addr(spender) + word(amount);

// getJob returns one dynamic tuple, so the return data begins with an offset to
// the tuple rather than the tuple itself. Everything below is relative to that
// offset — reading it as if the tuple started at byte 0 gives a plausible-
// looking job with every field shifted by one word, which is the kind of bug
// that reads fine and reports the wrong provider.
export const decodeJob = (hex) => {
  if (!hex || hex === '0x') return null;
  const b = hex.slice(2);
  const at = (i) => b.slice(i * 64, (i + 1) * 64);
  const num = (i) => BigInt('0x' + (at(i) || '0'));
  try {
    const base = Number(BigInt('0x' + at(0))) / 32; // word index where the tuple starts
    const w = (i) => at(base + i);
    const n = (i) => BigInt('0x' + w(i));
    const a = (i) => '0x' + w(i).slice(24);
    const descOff = Number(n(4)) / 32; // relative to the tuple start
    const descLen = Number(BigInt('0x' + at(base + descOff)));
    const descHex = b.slice((base + descOff + 1) * 64, (base + descOff + 1) * 64 + descLen * 2);
    const bytes = [];
    for (let i = 0; i < descHex.length; i += 2) bytes.push(parseInt(descHex.substr(i, 2), 16));
    const status = Number(n(7));
    return {
      id: n(0).toString(),
      client: a(1),
      provider: a(2),
      evaluator: a(3),
      description: new TextDecoder().decode(new Uint8Array(bytes)),
      budget: n(5).toString(),
      budget_u: Number(n(5)) / 1e18,
      expired_at: Number(n(6)),
      status: JOB_STATUS[status] ?? `UNKNOWN(${status})`,
      hook: a(8),
      submitted_at: Number(n(9)),
      deliverable: '0x' + w(10),
    };
  } catch {
    void num;
    return null;
  }
};

// ---------------------------------------------------------------------------
// Negotiation, over A2A.
//
// Two of the four BNB Agent Studio reference agents expose NO MCP surface at
// all — the LP Range Rebalancer and the Grid Trader serve only an agent card
// and speak A2A JSON-RPC. A marketplace that only speaks MCP cannot hire half
// of the categories it is being judged on, which is how a working router ends
// up scoring zero on functionality.
// ---------------------------------------------------------------------------

// A Worker cannot fetch its own custom domain — the request comes back as
// something that is not the JSON the seller sent, and the failure reads exactly
// like a broken seller. That matters here because our own agents are on this
// worker: hiring them over HTTP would fail while hiring a stranger's agent
// works, which is the wrong way round for a marketplace to behave.
//
// So the caller may inject a local delivery function. Nothing about the
// protocol changes — the same message goes to the same handler, it just does
// not leave the process. Injected rather than imported so this file stays
// dependency-free and its ABI self-test keeps working in plain Node.
const a2aSend = async (endpoint, data, timeoutMs = 25000, local = null) => {
  if (local) {
    const r = await local(endpoint, data);
    if (r) return r;
  }
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          messageId: `plaza-${Date.now().toString(36)}`,
          parts: [{ kind: 'data', data }],
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  // Same SSE tolerance as the MCP dispatcher: some A2A servers stream, and the
  // payload is the last data line.
  const line = text.trim().split('\n').filter((l) => l.trim()).pop() || '';
  try { return JSON.parse(line.replace(/^data:\s*/, '')); } catch { return null; }
};

// Sellers answer in two different shapes, and both are in production on the
// four BNB Agent Studio reference agents. Guessing one and calling the other
// broken would drop half the required categories, so both are parsed.
//
//   Dialect A — Yield Optimizer, Lending Guardian. A flat quote that names its
//   own hot wallet: { provider, price, currency: "U", instructions }.
//
//   Dialect B — LP Range Rebalancer, Grid Trader. The ERC-8183 negotiation
//   envelope: { request, response: { terms: { price, currency } }, request_hash,
//   response_hash, negotiation_hash, provider_sig, chain_id, verifying_contract }.
//   It carries no provider address at all — see resolveProvider for where that
//   comes from and how it was established.
//
// Walk the response rather than indexing a fixed path: the two dialects nest
// the payload at different depths, and one of them wraps it in an artifact
// while the other returns a bare message.
const findQuote = (node, depth = 0) => {
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const x of node) { const q = findQuote(x, depth + 1); if (q) return q; }
    return null;
  }
  if (typeof node !== 'object') return null;
  // Dialect A: a provider and a price together are unambiguous.
  if (/^0x[a-fA-F0-9]{40}$/.test(node.provider || '') && node.price != null) {
    return normalize({ ...node, dialect: 'flat' });
  }
  // Dialect B: the envelope is identified by a negotiation hash plus an
  // accepted response carrying terms. Requiring `accepted` keeps a rejected
  // quote from being escrowed against.
  if (node.negotiation_hash && node.response?.terms?.price != null) {
    if (node.response.accepted === false) return null;
    return normalize({
      dialect: 'envelope',
      price: node.response.terms.price,
      currency: node.response.terms.currency,
      negotiation_hash: node.negotiation_hash,
      request_hash: node.request_hash,
      response_hash: node.response_hash,
      provider_sig: node.provider_sig,
      chain_id: node.chain_id,
      verifying_contract: node.verifying_contract,
      evaluator_type: node.response.terms.evaluator_type,
      estimated_completion_seconds: node.response.estimated_completion_seconds,
      quote_expires_at: node.response.quote_expires_at,
      service: node.response.terms.deliverables,
    });
  }
  for (const v of Object.values(node)) { const q = findQuote(v, depth + 1); if (q) return q; }
  return null;
};

// `currency` is a symbol in one dialect and a token address in the other. Both
// are turned into an address, because that is what an approve() needs, and a
// caller handed the string "U" where an address belongs gets a transaction that
// reverts at signing time with nothing to explain it.
const normalize = (q) => {
  const c = String(q.currency || '');
  const asset = /^0x[a-fA-F0-9]{40}$/.test(c) ? c : ERC8183.paymentToken;
  return { ...q, currency_symbol: /^0x/.test(c) ? '$U' : (c === 'U' ? '$U' : c || '$U'), asset };
};

// A quoted price to atomic units of an 18-decimal token.
//
// Integer in, integer out: that is what every seller on this chain actually
// sends. A decimal is accepted because it is unambiguous — an atomic amount is
// a whole number by construction — and is scaled with string arithmetic rather
// than a float, because 0.1 * 1e18 in binary floating point is not
// 100000000000000000 and funding a job one wei short fails at the seller's end
// with no explanation.
const DECIMALS = 18;
export function toAtomic(price) {
  const raw = String(price ?? '').trim();
  if (!raw) throw new Error('empty price');
  if (/^\d+$/.test(raw)) return raw;
  const m = raw.match(/^(\d*)\.(\d+)$/);
  if (!m) throw new Error(`"${raw}" is not a number`);
  const whole = m[1] || '0';
  const frac = m[2].slice(0, DECIMALS).padEnd(DECIMALS, '0');
  if (m[2].length > DECIMALS) throw new Error(`"${raw}" has more than ${DECIMALS} decimal places`);
  return (BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt(frac)).toString();
}

export async function negotiate(endpoint, task, terms, local = null) {
  const res = await a2aSend(endpoint, {
    skill: 'negotiate',
    task_description: task,
    // Both keys are REQUIRED by the reference sellers' card. Omitting either
    // gets a validation error rather than a quote, and the error does not say
    // which one is missing.
    terms: {
      deliverables: terms?.deliverables || task,
      quality_standards: terms?.quality_standards || 'current on-chain data, stated as of a timestamp',
    },
  }, 25000, local);
  if (!res) return { ok: false, error: 'seller did not return parseable JSON' };
  if (res.error) return { ok: false, error: res.error.message || 'seller rejected the negotiation' };
  const quote = findQuote(res.result);
  if (!quote) return { ok: false, error: 'seller answered but returned no price quote' };
  return { ok: true, quote };
}

// ---------------------------------------------------------------------------
// The buyer's five calls.
// ---------------------------------------------------------------------------

// The escrow's expiry is the buyer's refund guarantee, not a deadline for the
// seller's convenience: after it passes with nothing delivered, claimRefund
// returns the whole budget. Default is a day, floored well above the quoted
// completion estimate so that a slow-but-honest seller is not cut off, and
// capped so that a mistyped value cannot lock funds for a year.
const HOUR = 3600;

// The floor is not a comfort margin, it is a hard requirement of the escrow,
// and getting it wrong made every job hired through here undeliverable.
//
// The OptimisticPolicy holds a dispute window — measured, 604,800 seconds =
// seven days — and the escrow can only release after it. A job that expires
// before that window closes can therefore never complete, so the kernel refuses
// the provider's submit() outright. It refuses with an unnamed custom error
// (0x15e5dd74) that appears in no signature database, which is why this cost a
// real funded job to find: the seller looks broken, the buyer's money sits in
// escrow until expiry, and nothing anywhere says why.
//
// So the window is read from the policy itself rather than assumed, with a day
// on top for the provider to actually do the work. DISPUTE_WINDOW_FALLBACK is
// only used if the policy cannot be read, and it is the measured value.
const DISPUTE_WINDOW_FALLBACK = 7 * 24 * HOUR;
const DELIVERY_MARGIN = 24 * HOUR;
const MAX_EXPIRY = 30 * 24 * HOUR;

// disputeWindow() — selector 0x117f5f92, computed from the signature and
// confirmed against the live policy, which answers 604800.
const DISPUTE_WINDOW_CALL = '0x117f5f92';

export async function readDisputeWindow(rpcCall) {
  try {
    const raw = await rpcCall(ERC8183.policy, DISPUTE_WINDOW_CALL);
    const v = Number(BigInt(raw));
    // A policy answering something absurd is a policy we do not understand, and
    // guessing would put somebody's budget out of reach for a year.
    if (v > 0 && v <= MAX_EXPIRY) return v;
  } catch { /* fall through */ }
  return DISPUTE_WINDOW_FALLBACK;
}

const expiryFor = (quote, override, disputeWindow = DISPUTE_WINDOW_FALLBACK) => {
  const now = Math.floor(Date.now() / 1000);
  const floor = disputeWindow + DELIVERY_MARGIN;
  const est = Number(quote?.estimated_completion_seconds || 0);
  // An override may lengthen the window but never shorten it below the floor:
  // a buyer asking for a one-hour expiry is asking for a job that cannot be
  // delivered, and quietly obeying would be the same bug with a caller to blame.
  const wanted = override ? Number(override) : Math.max(floor, est * 6);
  return now + Math.min(Math.max(floor, wanted), MAX_EXPIRY);
};

// What goes on-chain as the job description. The seller's card says to anchor
// the returned envelope, so the envelope's identifying fields go in — the
// signature and hash are what make the quote provable later, and the task text
// is what makes the job readable by anyone scanning the kernel (including us).
const describeJob = (task, quote) => {
  const env = {
    task: String(task).slice(0, 400),
    ...(quote.service ? { service: quote.service } : {}),
    ...(quote.negotiation_hash ? { negotiation_hash: quote.negotiation_hash } : {}),
    ...(quote.provider_sig ? { provider_sig: quote.provider_sig } : {}),
    ...(quote.quoted_at ? { quoted_at: quote.quoted_at } : {}),
    via: 'brainonbnb.com/registry',
  };
  return JSON.stringify(env);
};

export function buildHireCalls({ provider, budget, task, quote, expiredAt, asset }) {
  const description = describeJob(task, quote);
  // The seller names its own settlement currency. It is $U for every seller
  // seen so far, but approving a hardcoded token against a quote priced in
  // another one would approve the wrong asset and fund nothing.
  const token = asset || ERC8183.paymentToken;
  return [
    {
      step: 1,
      what: 'Create the job',
      to: ERC8183.commerce,
      data: encodeCreateJob({
        provider,
        // The router is set as BOTH evaluator and hook. That is not a
        // simplification — it is what the reference deployment does, and a job
        // registered with a different evaluator never reaches the policy that
        // releases it.
        evaluator: ERC8183.router,
        hook: ERC8183.router,
        expiredAt,
        description,
      }),
      value: '0x0',
      note: 'Returns the jobId. Read it from the return value or from jobCounter() — every later step needs it.',
    },
    {
      step: 2,
      what: 'Bind the dispute policy',
      to: ERC8183.router,
      data: null,
      template: (jobId) => SEL.registerJob + word(jobId) + addr(ERC8183.policy),
      value: '0x0',
      note: 'registerJob(jobId, OptimisticPolicy). Without it there is no verdict engine and the escrow cannot settle.',
    },
    {
      step: 3,
      what: 'Set the budget',
      to: ERC8183.commerce,
      data: null,
      template: (jobId) => encodeSetBudget(jobId, budget),
      value: '0x0',
      note: `setBudget(jobId, ${budget}) — ${Number(budget) / 1e18} $U.`,
    },
    {
      step: 4,
      what: 'Approve $U for the escrow',
      to: token,
      data: encodeApprove(ERC8183.commerce, budget),
      value: '0x0',
      note: 'Approves exactly the budget, not an unlimited allowance.',
    },
    {
      step: 5,
      what: 'Fund the escrow',
      to: ERC8183.commerce,
      data: null,
      template: (jobId) => encodeFund(jobId, budget),
      value: '0x0',
      note: 'Moves the $U. This is the only call that spends anything, and you sign it yourself.',
    },
  ];
}

// The calls that depend on a jobId cannot be encoded until step 1 has run, and
// pretending otherwise would hand the buyer calldata that silently targets job
// 0. So the response carries the two forms honestly: the calls that are ready
// now, and a template for the rest with the placeholder named.
//
// The placeholder is spliced by position, not by searching for a run of zeros.
// In all three of these calls the jobId is the first argument, so it occupies
// bytes 4..36 — the one thing about the layout that is certain. Substituting a
// zero word by pattern would happily replace an empty `optParams` length
// instead and produce a template that encodes the budget into the job id.
const JOBID_AT = { start: 2 + 8, end: 2 + 8 + 64 }; // '0x' + 4-byte selector, one word
const withPlaceholder = (data) =>
  data.slice(0, JOBID_AT.start) + '<JOBID>' + data.slice(JOBID_AT.end);

const serializeCalls = (calls) => calls.map((c) => {
  const { template, ...rest } = c;
  if (rest.data) return { ...rest, ready: true };
  return {
    ...rest,
    ready: false,
    data_template: withPlaceholder(template(0)),
    needs: 'jobId from step 1 — substitute it as a 32-byte big-endian word (64 hex chars, left-padded)',
  };
});

// One rendering of a quote, used whether or not the hire can proceed, so that
// the two responses never drift into describing the same quote differently.
const quoteView = (q, budget) => ({
  price_atomic: budget,
  price: `${Number(budget) / 1e18} ${q.currency_symbol}`,
  asset: q.asset,
  service: q.service || null,
  estimated_completion_seconds: q.estimated_completion_seconds ?? null,
  quoted_at: q.quoted_at || null,
  quote_expires_at: q.quote_expires_at ?? null,
  negotiation_hash: q.negotiation_hash || null,
  provider_sig: q.provider_sig || null,
  // Two of the reference sellers ask for a UMA optimistic oracle rather than
  // the OptimisticPolicy this flow registers. Surfaced rather than smoothed
  // over: it changes who decides whether the work was delivered.
  evaluator_type: q.evaluator_type || null,
  dialect: q.dialect,
});

// One eth_call, over the same public endpoints the rest of the worker uses.
// Injectable via opts so the offline test can drive it without a network.
const HIRE_RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed.binance.org',
];
const rpcCall = async (to, data) => {
  let last;
  for (const endpoint of HIRE_RPCS) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (j.error) { last = new Error(j.error.message); continue; }
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('all RPC endpoints failed');
};

export async function handleHire(url, body, env, opts = {}) {
  const task = String(body?.task || url.searchParams.get('task') || '').slice(0, 400);
  const target = String(body?.agent || url.searchParams.get('agent') || '').trim();
  if (!task) return { status: 400, body: { error: 'task is required — describe what you want done' } };
  if (!target) return { status: 400, body: { error: 'agent is required — an ERC-8004 id or an A2A endpoint URL' } };

  const started = Date.now();
  const endpoint = await resolveA2aEndpoint(target);
  if (!endpoint) {
    return { status: 404, body: {
      error: 'no A2A endpoint found for that agent',
      hint: 'Pass an https:// A2A endpoint directly, or an ERC-8004 id that appears in https://brainonbnb.com/api-agents.json',
    } };
  }

  const neg = await negotiate(endpoint, task, body?.terms, opts.localA2A || null);
  if (!neg.ok) {
    await recordSession(env, {
      task, tool: 'erc8183:negotiate', ok: false, ms: Date.now() - started,
      outcome: neg.error, agent: target, ...(opts.probe ? { probe: true } : {}),
    });
    return { status: 502, body: { error: neg.error, endpoint, negotiated: false } };
  }

  const q = neg.quote;
  // Every seller measured in the wild quotes atomic units — the flat dialect
  // and the envelope both send 1000000000000000000 for one $U. But a price is
  // a string arriving from a stranger, and one that reads "0.10" used to reach
  // BigInt() and take the whole endpoint down with an unexplained 500. A
  // decimal point cannot appear in an atomic amount, so it is unambiguous and
  // is converted rather than rejected; anything that is neither is refused with
  // a reason the seller's author can act on.
  let budget;
  try {
    budget = toAtomic(q.price);
  } catch (e) {
    return { status: 502, body: {
      error: `the seller quoted a price this buyer cannot use: ${e.message}`,
      quoted: String(q.price), endpoint, negotiated: true, hireable: false,
      expected: 'an integer amount in the payment token\'s smallest unit (1 $U = 1000000000000000000), or a decimal amount such as "0.10"',
    } };
  }
  const disputeWindow = await readDisputeWindow(opts.rpcCall || rpcCall);
  const expiredAt = expiryFor(q, body?.expires_in_seconds, disputeWindow);
  const { provider, provider_source, provider_problem } = await resolveProvider(q, target, opts.rpcCall || rpcCall);

  await recordSession(env, {
    task, tool: 'erc8183:negotiate', ok: true, ms: Date.now() - started,
    outcome: `quoted ${Number(budget) / 1e18} ${q.currency_symbol}`,
    agent: target, excerpt: q.service || null, ...(opts.probe ? { probe: true } : {}),
  });

  // A quote we cannot address is still worth returning — the price is real
  // information — but it must not come with calls, because calls need a
  // provider and inventing one escrows money to nobody.
  if (!provider) {
    return { status: 200, body: {
      negotiated: true, endpoint, hireable: false,
      quote: quoteView(q, budget),
      why_not: provider_problem,
    } };
  }

  const calls = buildHireCalls({ provider, budget, task, quote: q, expiredAt, asset: q.asset });

  return { status: 200, body: {
    negotiated: true,
    hireable: true,
    endpoint,
    provider,
    provider_source,
    quote: quoteView(q, budget),
    escrow: {
      standard: 'ERC-8183',
      chain_id: ERC8183.chainId,
      kernel: ERC8183.commerce,
      payment_token: ERC8183.paymentToken,
      payment_token_symbol: '$U',
      expires_at: expiredAt,
      refundable: 'If nothing is delivered by expiry, claimRefund(jobId) on the kernel returns the full budget to you.',
    },
    calls: serializeCalls(calls),
    // Said plainly, because the difference between this and a custodial
    // marketplace is the entire trust argument.
    we_do_not_sign:
      'These are unsigned calls. This service holds no key of yours and cannot move your funds. '
      + 'Submit them from your own wallet, or through an Altana session key with a spend cap if you '
      + 'want an agent to be able to re-hire within a limit you set.',
    after_funding:
      'Send the seller {"skill":"notify_funded","job_id":<jobId>} over the same A2A endpoint to request delivery.',
    track: `https://agent.brainonbnb.com/job?id=<jobId>`,
  } };
}

// Accepts an ERC-8004 id or a URL. For an id we look it up in the same index
// the broker and dispatcher read, so all three can never disagree about where
// an agent lives.
const AGENTS_URL = 'https://brainonbnb.com/api-agents.json';
let idx = { at: 0, data: null };

async function loadIndex() {
  if (!idx.data || Date.now() - idx.at > 10 * 60 * 1000) {
    const r = await fetch(AGENTS_URL, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) return null;
    idx = { at: Date.now(), data: await r.json() };
  }
  return idx.data;
}

// The A2A endpoint is whatever the agent card's `url` says it is, and assuming
// `/a2a` is wrong for half the reference agents: the LP Rebalancer and the Grid
// Trader serve A2A at the ORIGIN, and POSTing to /a2a there returns a 404 that
// looks exactly like a dead agent. Card first, convention only as a fallback.
async function cardEndpoint(origin) {
  const r = await fetch(new URL('/.well-known/agent-card.json', origin).href, {
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const card = await r.json().catch(() => null);
  if (!card) return null;
  const iface = (card.supportedInterfaces || []).find((i) => i.url);
  // Cards in the wild declare http:// for a host that only answers https, so
  // the scheme of the origin we already reached wins over the one in the card.
  const raw = iface?.url || card.url;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const o = new URL(origin);
    u.protocol = o.protocol;
    return u.href;
  } catch { return null; }
}

async function resolveA2aEndpoint(target) {
  let origin = null;
  if (/^https?:\/\//i.test(target)) {
    // An explicit endpoint is honoured as given — a caller that knows the path
    // should not be second-guessed. Only a bare origin gets resolved.
    const u = new URL(target);
    if (u.pathname !== '/' ) return target;
    origin = u.origin;
  } else {
    const id = Number(target);
    if (!Number.isFinite(id)) return null;
    const data = await loadIndex();
    if (!data) return null;
    const agent = (data.agents || []).find((a) => a.id === id);
    if (!agent) return null;
    const eps = agent.endpoints || [];
    const direct = eps.find((e) => /\/a2a(\/|$)/i.test(e));
    if (direct) return direct;
    try { origin = new URL(eps[0]).origin; } catch { return null; }
  }
  return (await cardEndpoint(origin)) || origin + '/a2a';
}

// Where the provider address comes from when the seller does not state one.
//
// Dialect B returns a signed envelope and no provider field, so the address has
// to come from somewhere else. Two candidates were tested and only one holds up:
//
//   ecrecover over the negotiation hash — rejected. Both the raw-digest and the
//   EIP-191 recovery produce addresses with zero balance and zero nonce, and
//   neither appears anywhere in the kernel's job history. Recovering an address
//   that has never existed on-chain and escrowing money to it would be the
//   worst possible failure mode, so this path is not used.
//
//   ownerOf(agentId) on the ERC-8004 registry — confirmed. The LP Rebalancer's
//   owner 0x20f1cA5d… and the Grid Trader's owner 0xFAf0ffd1… both appear as
//   the `provider` of real, funded jobs in the last 400 on the kernel. Note
//   this is NOT true of dialect A: the Yield Optimizer and Lending Guardian are
//   both owned by 0xd16faAa9… yet quote 0xa09991fc… as provider, which is why
//   a declared provider always wins over the registry.
const OWNER_OF = '0x6352211e';

async function resolveProvider(quote, target, rpcCall) {
  if (/^0x[a-fA-F0-9]{40}$/.test(quote.provider || '')) {
    return { provider: quote.provider, provider_source: 'declared by the seller in its quote' };
  }
  const id = Number(target);
  if (!Number.isFinite(id)) {
    return { provider: null, provider_source: null,
      provider_problem: 'The seller returned a signed quote without a provider address, and it was addressed by URL rather than by ERC-8004 id, so there is no registry entry to read the owner from. Re-request by id.' };
  }
  const raw = await rpcCall(ERC8183.registry, OWNER_OF + BigInt(id).toString(16).padStart(64, '0')).catch(() => null);
  if (!raw || raw === '0x' || /^0x0{64}$/.test(raw)) {
    return { provider: null, provider_source: null,
      provider_problem: `The seller's quote names no provider and ownerOf(${id}) could not be read, so there is no address to escrow against.` };
  }
  return {
    provider: '0x' + raw.slice(-40),
    provider_source: `ownerOf(${id}) on the ERC-8004 registry — the seller's quote does not name one`,
  };
}
