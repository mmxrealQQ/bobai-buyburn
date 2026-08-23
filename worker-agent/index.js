// BOBAI AGENT SERVICE — the paid surface, and the numbers behind it.
//
// Two jobs, deliberately in one worker because they are the same story:
//
//   1. A pool watch that agents pay for. The free scanner answers "what does
//      this trade cost right now"; this answers "tell me when that changes",
//      which is the part that cannot be done client-side because somebody has
//      to still be running in an hour.
//
//   2. The counters behind the public transparency block: how often we were
//      asked, what we earned, where the money went. Kept here rather than in
//      the dashboard worker so that the thing being measured and the thing
//      doing the measuring are not the same process.
//
// PAYMENT MODEL
// x402, scheme "exact": the caller sends USD1 to our address and hands us the
// transaction hash; we read the chain and confirm it. We do NOT use eip3009
// here even though the Bazaar entries do, and the reason is gas: an eip3009
// authorization has to be submitted by the recipient, so we would be paying gas
// to collect payment, with no facilitator sponsoring it until a Binance partner
// account exists. Direct transfer costs us nothing and needs nobody's approval.
// When the partner account lands, eip3009 gets added alongside — the accepts[]
// array is built to carry both.
//
// The receiving wallet's private key is NOT here and must never be. Verifying a
// payment is a read; the worker never moves funds.

import { runCensusTick } from './census.js';
import { handleFind } from './find.js';
import { dexterAccepts, verifyAndSettle, parsePaymentHeader } from './x402.js';
import { handleDispatch } from './dispatch.js';
import { readSessions, trackRecord } from './sessions.js';
import { runCanary } from './canary.js';

const RPCS = [
  'https://bsc.publicnode.com',
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-mainnet.public.blastapi.io',
];
// Logs are a separate endpoint on purpose: Binance's own dataseed refuses
// eth_getLogs outright, and a payment that cannot be read is a payment we would
// wrongly reject.
const LOGS_RPC = 'https://bsc-rpc.publicnode.com';

// Receipts need their OWN list, and this is not a detail. Both publicnode
// endpoints answer eth_getTransactionReceipt with "Archive requests require..."
// — even for a transaction minutes old. Reading receipts off the logs endpoint,
// as this worker did at first, rejected a real 96 USD1 transfer as "transaction
// not found": harmless for security, fatal for a paying customer, and invisible
// unless you test with a transaction that actually exists. Ordered so the two
// endpoints measured to serve receipts come first.
const RECEIPT_RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed.binance.org',
];

// USD1. Chosen by measurement, not by preference: on BSC, USDT and USDC do NOT
// implement EIP-3009, while USD1 and U do — which is why 40 of the 44 payment
// options across the whole B402 catalogue are one of those two. Picking USDT
// would have produced a service nobody could pay for with the standard scheme.
const USD1 = '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d';
const USD1_DECIMALS = 18n;

const NETWORK = 'eip155:56';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// 30 days of watching one pool. Priced against the catalogue, where calls run
// 0.01-0.03 USD — this is a subscription, not a call, so it sits above that,
// but low enough that trying it is not a decision.
const WATCH_PRICE_USD1 = 500000000000000000n; // 0.50 USD1
const WATCH_DAYS = 30;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });

// btoa() only handles Latin-1. The moment a description contained an em dash
// the whole /watch endpoint returned 500 — the payload was fine, the encoder
// was not. Encoding to UTF-8 bytes first makes any character safe, which
// matters because these strings are human-readable copy that will keep
// acquiring punctuation.
const b64 = (obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const rpc = async (method, params, endpoints) => {
  const list = endpoints ? (Array.isArray(endpoints) ? endpoints : [endpoints]) : RPCS;
  let last;
  for (const endpoint of list) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (j.error) { last = new Error(j.error.message); continue; }
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('all RPC endpoints failed');
};

const hexToBig = (h) => (h && h !== '0x' ? BigInt(h) : 0n);
const addrFromTopic = (t) => '0x' + String(t).slice(26).toLowerCase();

// ---------------------------------------------------------------- counters

// One KV read+write per counted event would cost a write on every single
// request. Counters are therefore bucketed by day and the totals derived on
// read, which also gives the transparency block a time series for free.
const today = () => new Date().toISOString().slice(0, 10);

async function bump(env, kind, n = 1) {
  const key = `count:${kind}:${today()}`;
  const cur = Number((await env.AGENT.get(key)) || 0);
  await env.AGENT.put(key, String(cur + n), { expirationTtl: 60 * 60 * 24 * 400 });
}

async function readCounters(env) {
  const list = await env.AGENT.list({ prefix: 'count:' });
  const byKind = {};
  const byDay = {};
  for (const k of list.keys) {
    const [, kind, day] = k.name.split(':');
    const v = Number((await env.AGENT.get(k.name)) || 0);
    byKind[kind] = (byKind[kind] || 0) + v;
    byDay[day] = byDay[day] || {};
    byDay[day][kind] = v;
  }
  return { byKind, byDay };
}

// ---------------------------------------------------------------- payment

// Confirms that a specific transaction really moved at least `min` USD1 into
// our address, and that we have not already honoured it.
//
// Every one of these checks earns its place. Without the receipt status a
// reverted transfer counts as payment. Without the token check any worthless
// token sent to the same address counts. Without the recipient check somebody
// pastes a transfer between two strangers. Without the KV guard one payment
// buys unlimited watches.
async function verifyPayment(env, txHash, payTo, min) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) return { ok: false, reason: 'malformed transaction hash' };

  const spent = await env.AGENT.get(`paid:${txHash.toLowerCase()}`);
  if (spent) return { ok: false, reason: 'this payment has already been used' };

  const receipt = await rpc('eth_getTransactionReceipt', [txHash], RECEIPT_RPCS).catch(() => null);
  if (!receipt) return { ok: false, reason: 'transaction not found — if it was just sent, wait for it to confirm' };
  if (receipt.status !== '0x1') return { ok: false, reason: 'that transaction failed on-chain' };

  let paid = 0n;
  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== USD1) continue;
    if ((log.topics || [])[0] !== TRANSFER_TOPIC) continue;
    if (addrFromTopic(log.topics[2]) !== payTo.toLowerCase()) continue;
    paid += hexToBig(log.data);
  }
  if (paid < min)
    return {
      ok: false,
      reason: `paid ${fmtUsd1(paid)} USD1, need ${fmtUsd1(min)} USD1`,
    };

  return { ok: true, paid, from: (receipt.from || '').toLowerCase(), block: receipt.blockNumber };
}

const fmtUsd1 = (v) => {
  const whole = v / 10n ** USD1_DECIMALS;
  const frac = (v % 10n ** USD1_DECIMALS).toString().padStart(18, '0').slice(0, 2);
  return `${whole}.${frac}`;
};

// ------------------------------------------------------------ pool reading

const SEL = {
  getReserves: '0x0902f1ac',
  token0: '0x0dfe1681',
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
};

const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const padAddr = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');

// Depth of a V2 pair in USD, read from the quote side only. One-sided on
// purpose: it is the number that decides what a sell can actually get out, and
// it needs no price oracle beyond the quote token itself.
async function poolDepthUsd(pair, quoteToken, quoteUsd) {
  const bal = await call(quoteToken, SEL.balanceOf + padAddr(pair));
  const raw = hexToBig(bal);
  return Number(raw) / 1e18 * quoteUsd;
}

// BNB price from the reference pair, the same source the rest of the project
// uses so that one number does not disagree with itself across surfaces.
const BNB_PAIR = '0x58f876857a02d6762e0101bb5c46a8c1ed44dc16';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
async function bnbUsd() {
  const [res, t0] = await Promise.all([
    call(BNB_PAIR, SEL.getReserves),
    call(BNB_PAIR, SEL.token0),
  ]);
  const b = res.slice(2);
  const r0 = Number(BigInt('0x' + b.slice(0, 64))) / 1e18;
  const r1 = Number(BigInt('0x' + b.slice(64, 128))) / 1e18;
  const bnbIs0 = ('0x' + t0.slice(26)).toLowerCase() === WBNB;
  return bnbIs0 ? r1 / r0 : r0 / r1;
}

// ---------------------------------------------------------------- watches

async function createWatch(env, spec, payment) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const watch = {
    id,
    token: spec.token.toLowerCase(),
    pair: spec.pair.toLowerCase(),
    quote: (spec.quote || WBNB).toLowerCase(),
    depthBelowUsd: spec.depthBelowUsd ?? null,
    callback: spec.callback || null,
    createdAt: now,
    expiresAt: now + WATCH_DAYS * 86400000,
    paidTx: payment.tx,
    paidBy: payment.from,
    lastDepthUsd: null,
    triggered: [],
  };
  await env.AGENT.put(`watch:${id}`, JSON.stringify(watch), {
    expirationTtl: WATCH_DAYS * 86400 + 86400,
  });
  return watch;
}

async function checkWatches(env) {
  const list = await env.AGENT.list({ prefix: 'watch:' });
  if (!list.keys.length) return { checked: 0, fired: 0 };
  const price = await bnbUsd().catch(() => 0);
  if (!price) return { checked: 0, fired: 0, error: 'could not price BNB' };

  let fired = 0;
  for (const k of list.keys) {
    const raw = await env.AGENT.get(k.name);
    if (!raw) continue;
    const w = JSON.parse(raw);
    if (Date.now() > w.expiresAt) { await env.AGENT.delete(k.name); continue; }

    let depth;
    try {
      depth = await poolDepthUsd(w.pair, w.quote, w.quote === WBNB ? price : 1);
    } catch { continue; } // a node dropping a call is not a depth collapse
    w.lastDepthUsd = Math.round(depth);
    w.lastCheckedAt = Date.now();

    if (w.depthBelowUsd != null && depth < w.depthBelowUsd) {
      const already = w.triggered.some((t) => Date.now() - t.at < 6 * 3600000);
      if (!already) {
        w.triggered.push({ at: Date.now(), depthUsd: Math.round(depth) });
        fired++;
        if (w.callback) {
          // Fire-and-forget: a subscriber's endpoint being down must not stall
          // the run for everyone else on the list.
          await fetch(w.callback, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              watch: w.id, token: w.token, pair: w.pair,
              depthUsd: Math.round(depth), threshold: w.depthBelowUsd,
              at: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(5000),
          }).catch(() => {});
        }
      }
    }
    await env.AGENT.put(k.name, JSON.stringify(w), {
      expirationTtl: Math.max(60, Math.floor((w.expiresAt - Date.now()) / 1000) + 86400),
    });
  }
  await bump(env, 'watch_checks', list.keys.length);
  return { checked: list.keys.length, fired };
}

// ---------------------------------------------------------------- earnings

async function readEarnings(env) {
  const list = await env.AGENT.list({ prefix: 'earn:' });
  let total = 0n;
  const payments = [];
  for (const k of list.keys) {
    const rec = JSON.parse((await env.AGENT.get(k.name)) || '{}');
    if (!rec.amount) continue;
    total += BigInt(rec.amount);
    payments.push({ at: rec.at, amountUsd1: fmtUsd1(BigInt(rec.amount)), tx: rec.tx, for: rec.for });
  }
  payments.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { totalUsd1: fmtUsd1(total), totalRaw: total.toString(), count: payments.length, payments: payments.slice(0, 25) };
}

// ---------------------------------------------------------------- handler

const CAPABILITIES = {
  free: [
    { name: 'pool scan (browser)', where: 'https://brainonbnb.com/scanner', what: 'measure any BSC pool: real trade cost, depth, tax from executed trades' },
    { name: 'agent skill', where: 'npx skills add https://brainonbnb.com', what: 'the same measurement as an installable skill for any MCP-capable agent' },
    { name: 'MCP server', where: 'https://brainonbnb.com/mcp', what: 'read-only tools over MCP: measure any BSC pool before trading it, search the ERC-8004 registry, read the census, plus live $BOBAI on-chain data' },
    { name: 'REST endpoints', where: 'https://brainonbnb.com/api/*', what: 'the same tools as plain GET, for agents that do not speak MCP' },
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
  ],
};

// The one paid tool. Its description says the price in the first sentence:
// an agent deciding whether to call something should not have to call it to
// find out that it costs money.
const WATCH_TOOL = {
  name: 'bsc_pool_watch',
  description:
    'PAID (0.50 USD1, 30 days). Watch one BNB Smart Chain liquidity pool around the clock and '
    + 'get told the moment it can no longer absorb a trade of your size. Checked every fifteen '
    + 'minutes for thirty days; fires a callback when depth falls below your threshold. '
    + 'Call it once WITHOUT `payment` and it answers with the price and where to send it — that '
    + 'call is free. Measuring a pool once is free too and always will be: use bsc_pool_scan at '
    + 'https://brainonbnb.com/mcp for that. This tool is only worth paying for because somebody '
    + 'has to still be running in an hour.',
  inputSchema: {
    type: 'object',
    required: ['token', 'pair'],
    properties: {
      token: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'The BEP-20 token address.' },
      pair: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'The PancakeSwap pair holding it.' },
      quote: { type: 'string', description: 'Optional. The other side of the pair, if it is not WBNB.' },
      depthBelowUsd: {
        type: 'number',
        description:
          'Alert when the pool can no longer absorb a trade of this many dollars. '
          + 'Leave it out and the watch records depth but never fires, which is a real thing to '
          + 'want and a bad thing to get by accident.',
      },
      callback: { type: 'string', format: 'uri', description: 'Where to POST when it fires. Without one, poll /watch/<id>.' },
      payment: {
        type: 'string',
        description:
          'The transaction hash of your USD1 transfer, or a base64 x402 payload. Omit it on the '
          + 'first call to be told what to pay and where.',
      },
    },
  },
};

// The paid purchase itself, lifted out of the HTTP route so that MCP can sell
// the same thing without a second copy of the payment logic living beside it.
// Returns what the caller should be told rather than a Response: the two front
// doors format it differently, and only one of them can carry a header.
async function purchaseWatch(env, ctx, payTo, spec, proof) {
  if (!proof) {
    // The 402 itself. accepts[] is an array because a second scheme
    // (eip3009, once a facilitator is in place) will sit beside this one
    // rather than replace it.
    // Two ways to pay the same price into the same wallet. The first is
    // standard x402 that any stock client can execute unattended; the
    // second is our own direct transfer, which needs no facilitator and
    // no signature support. A client takes whichever it can do.
    const resource = 'https://agent.brainonbnb.com/watch';
    const requirements = {
      x402Version: 2,
      accepts: [
        dexterAccepts({
          payTo,
          amountAtomic: WATCH_PRICE_USD1.toString(),
          description: `Pool watch for ${WATCH_DAYS} days`,
          resource,
        }),
        {
          scheme: 'exact',
          network: NETWORK,
          asset: USD1,
          maxAmountRequired: WATCH_PRICE_USD1.toString(),
          payTo,
          resource,
          description: `Pool watch for ${WATCH_DAYS} days — direct transfer, then send the transaction hash in PAYMENT-SIGNATURE`,
          extra: { name: 'World Liberty Financial USD', version: '1', decimals: 18, assetTransferMethod: 'direct-transfer' },
        },
      ],
    };
    return {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': b64(requirements) },
      requirements,
      body: {
        error: 'payment required',
        how: `Send ${fmtUsd1(WATCH_PRICE_USD1)} USD1 to ${payTo} on BNB Smart Chain, then repeat this request with header PAYMENT-SIGNATURE: <transaction hash>.`,
        accepts: requirements.accepts,
      },
    };
  }

  const parsed = parsePaymentHeader(proof);
  let check;
  let tx;

  if (parsed.kind === 'x402') {
    // Standard x402: the facilitator verifies the signature and moves the
    // money. We never see a key and never submit a transaction.
    const reqs = {
      x402Version: 2,
      accepts: [dexterAccepts({
        payTo, amountAtomic: WATCH_PRICE_USD1.toString(),
        description: `Pool watch for ${WATCH_DAYS} days`,
        resource: 'https://agent.brainonbnb.com/watch',
      })],
    };
    const r = await verifyAndSettle(parsed.value, reqs.accepts[0]);
    if (!r.ok) return { status: 402, body: { error: 'payment not accepted', stage: r.stage, reason: r.reason } };
    tx = (r.tx || `x402:${Date.now()}`).toLowerCase();
    const already = await env.AGENT.get(`paid:${tx}`);
    if (already) return { status: 402, body: { error: 'payment not accepted', reason: 'this settlement has already been used' } };
    check = { ok: true, paid: WATCH_PRICE_USD1, from: r.payer };
  } else {
    check = await verifyPayment(env, proof.trim(), payTo, WATCH_PRICE_USD1);
    if (!check.ok) return { status: 402, body: { error: 'payment not accepted', reason: check.reason } };
    tx = proof.trim().toLowerCase();
  }
  // Marked spent BEFORE the watch is created: if creation fails the caller
  // has lost nothing they cannot retry with support, whereas the reverse
  // order lets a retry storm mint watches off one payment.
  await env.AGENT.put(`paid:${tx}`, '1', { expirationTtl: 60 * 60 * 24 * 400 });
  await env.AGENT.put(
    `earn:${tx}`,
    JSON.stringify({ at: Date.now(), amount: check.paid.toString(), tx, for: 'watch' }),
    { expirationTtl: 60 * 60 * 24 * 400 },
  );

  const watch = await createWatch(env, spec, { tx, from: check.from });
  ctx.waitUntil(bump(env, 'watch_created'));

  // Anything the caller sent that this endpoint does not read is named back
  // to them. The first paid request in the service's life passed
  // "threshold_pct", which is not a field here — it was swallowed in
  // silence, and the watch was created with no threshold at all. It would
  // have run for thirty days, never fired, and looked like it was working.
  // A caller who mistypes a field has to be told, or they are paying for
  // something they did not ask for.
  const KNOWN = new Set(['token', 'pair', 'quote', 'depthBelowUsd', 'callback']);
  const ignored = Object.keys(spec || {}).filter((k) => !KNOWN.has(k));

  return { status: 200, body: {
    ok: true,
    watch: watch.id,
    expires: new Date(watch.expiresAt).toISOString(),
    watching: { token: watch.token, pair: watch.pair, depthBelowUsd: watch.depthBelowUsd },
    callback: watch.callback ? 'will POST on trigger' : 'none set — poll /watch/<id>',
    paid: `${fmtUsd1(check.paid)} USD1`,
    // Stated rather than implied: a watch with no threshold records depth
    // and never alerts, which is a legitimate thing to want and a terrible
    // thing to receive by accident.
    ...(watch.depthBelowUsd == null ? {
      alerting: 'OFF — no depthBelowUsd was given, so this watch records depth but will never fire. Send depthBelowUsd (a number, in USD) to be alerted when the pool falls below it.',
    } : {}),
    ...(ignored.length ? {
      ignored_fields: ignored,
      ignored_note: 'These were not recognised and had no effect. The fields this endpoint reads are: token, pair, quote, depthBelowUsd, callback.',
    } : {}),
  } };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS')
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,PAYMENT-SIGNATURE',
        },
      });

    const payTo = env.X402_WALLET;

    if (path === '/') {
      return json({
        service: 'Brain On BNB AI — agent service',
        what_this_is: 'Paid, continuous pool monitoring on BNB Smart Chain, plus the public counters behind brainonbnb.com. Measurement only — nothing here is financial advice.',
        capabilities: CAPABILITIES,
        payment: { protocol: 'x402', network: NETWORK, asset: USD1, symbol: 'USD1', payTo },
        transparency: 'https://agent.brainonbnb.com/stats',
      });
    }

    // Public transparency surface. Everything the dashboard block shows comes
    // from here, so the page cannot present a number this endpoint would not.
    // What the self-updating half of the census knows. The headline figures
    // come from a full offline scan; this reports what has changed since.
    // The broker. Ask what you need done, get agents that expose something
    // matching — open, no key, so another agent can use it mid-task.
    if (path === '/find') {
      const r = await handleFind(url);
      return json(r.body, r.status);
    }

    // Hire: a task in, an answer back, with the agent that produced it named.
    // Read-only tools only — see dispatch.js for why that line is not moved.
    if (path === '/dispatch') {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      const r = await handleDispatch(url, body, env);
      ctx.waitUntil(bump(env, 'dispatch'));
      return json(r.body, r.status);
    }

    // The series. Daily points and full-scan points are returned separately,
    // never merged into one line — one is a sample of two dozen endpoints, the
    // other is every id in the registry, and a chart that averages them would
    // be lying with real numbers.
    // The public record. Every task this router passed on, and the track
    // record that falls out of it — derived from the log, never declared by
    // the operator it describes.
    if (path === '/sessions') {
      const sessions = await readSessions(env);
      const record = trackRecord(sessions);
      return json({
        what_this_is: 'Every task Brain Plaza has routed to another agent, and how each one went. Failures included — a record that only showed successes would be marketing.',
        how_to_read_it: 'Nobody reports their own score here. An operator appears because it was asked something, and its reliability is the count of times it answered. We store what was asked and a short excerpt of the answer, never the full response.',
        sessions_recorded: sessions.length,
        operators_seen: record.length,
        track_record: record,
        recent: sessions.slice(-40).reverse(),
      });
    }

    if (path === '/census-history') {
      const raw = JSON.parse((await env.AGENT.get('census:history')) || '[]');
      const daily = raw.filter((p) => p.kind === 'daily');
      const full = raw.filter((p) => p.kind === 'full');
      const first = daily[0], last = daily[daily.length - 1];
      return json({
        what_this_is: 'How the ERC-8004 registry on BNB Chain has moved since we started watching it.',
        note: 'Daily points track the registry high-water mark and re-check a rotating slice of known endpoints — a sample, not the whole registry. Full points come from scanning every id offline. They are kept apart because they measure different things.',
        watching_since: first?.date || null,
        days_observed: daily.length,
        growth: first && last ? {
          from: first.highest_id, to: last.highest_id,
          new_registrations: (last.highest_id || 0) - (first.highest_id || 0),
          per_day: daily.length > 1
            ? Math.round(((last.highest_id || 0) - (first.highest_id || 0)) / (daily.length - 1))
            : null,
        } : null,
        daily,
        full_scans: full,
      });
    }

    // Records a completed offline scan as a fixed point in the series. Secret
    // guarded: these are the numbers the page quotes, and anyone able to post
    // them could rewrite the history the page is built on.
    if (path === '/census-history' && request.method === 'POST') {
      return json({ error: 'use /census-full' }, 400);
    }
    if (path === '/census-full' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const b = await request.json().catch(() => null);
      if (!b || !Number.isInteger(b.registered_ids)) return json({ error: 'registered_ids required' }, 400);
      const hist = JSON.parse((await env.AGENT.get('census:history')) || '[]');
      const date = (b.date || new Date().toISOString()).slice(0, 10);
      const point = {
        date, kind: 'full',
        registered_ids: b.registered_ids,
        parse: b.parse ?? null,
        with_endpoint: b.with_endpoint ?? null,
        reachable: b.reachable ?? null,
        operators: b.operators ?? null,
        mcp: b.mcp ?? null,
      };
      const i = hist.findIndex((h) => h.date === date && h.kind === 'full');
      if (i >= 0) hist[i] = point; else hist.push(point);
      hist.sort((x, y) => (x.date < y.date ? -1 : 1));
      await env.AGENT.put('census:history', JSON.stringify(hist));
      return json({ ok: true, recorded: point, points: hist.length });
    }

    if (path === '/census') {
      const latest = await env.AGENT.get('census:latest');
      if (!latest) return json({ error: 'no census tick has run yet' }, 503);
      return json(JSON.parse(latest));
    }

    if (path === '/stats') {
      const [counters, earnings, watches] = await Promise.all([
        readCounters(env),
        readEarnings(env),
        env.AGENT.list({ prefix: 'watch:' }),
      ]);
      // "Requests answered" must mean requests somebody made. Our own cron
      // sweeps are counted too — they are worth knowing — but folding them into
      // the public total would inflate it with our own activity, which is the
      // exact dishonesty this block exists to avoid.
      const INTERNAL = new Set(['watch_checks']);
      const external = Object.fromEntries(
        Object.entries(counters.byKind).filter(([k]) => !INTERNAL.has(k)),
      );
      return json({
        asked: {
          total: Object.values(external).reduce((a, b) => a + b, 0),
          by_kind: external,
          by_day: counters.byDay,
          internal: Object.fromEntries(
            Object.entries(counters.byKind).filter(([k]) => INTERNAL.has(k)),
          ),
          note: 'total counts requests made by others. Our own scheduled sweeps are listed separately under internal.',
        },
        earned: earnings,
        active_watches: watches.keys.length,
        money_flow: {
          '1': 'an agent pays USD1 for a watch',
          '2': `it lands at ${payTo || '(not configured)'} — a wallet used for nothing else`,
          '3': 'from there it buys $BOBAI and burns it, the same thing the buyback bot does with the trade tax',
          '4': 'every step is a public transaction, verifiable on BscScan',
          first_burn: '0.50 USD1 -> 6,043.28 $BOBAI, burned 2026-08-22: https://bscscan.com/tx/0x0da33c6339fd88de8fa443f7d41d0e0749fbac14e678c976fd3dc0f6ea39b27e',
          note: 'Step 3 is done by hand while the amounts are small. It is not automated yet, and this line will say so until it is. The burn log at logs.brainonbnb.com lists the bot\'s own automated runs only, so a burn done by hand is on chain but not in that log — the transaction above is the record.',
        },
        capabilities: CAPABILITIES,
        generated_at: new Date().toISOString(),
      });
    }

    // Called by the dashboard worker so that MCP and REST traffic lands in the
    // same counters as everything else. Shared-secret rather than open, or the
    // public numbers would be whatever a stranger felt like posting.
    if (path === '/hit' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const body = await request.json().catch(() => ({}));
      const kind = String(body.kind || '').replace(/[^a-z0-9_]/gi, '').slice(0, 32);
      if (!kind) return json({ error: 'kind required' }, 400);
      ctx.waitUntil(bump(env, kind));
      return json({ ok: true });
    }

    // MCP, carrying exactly one tool: the paid watch.
    //
    // WHY THIS EXISTS SEPARATELY FROM brainonbnb.com/mcp
    // That server has seventeen tools and every one of them is free. This one
    // has one tool and it costs money. Keeping them apart means an agent that
    // wants the free surface never has to reason about payment, and the paid
    // tool does not have to be smuggled into a server advertised as free.
    //
    // WHY AN MCP TOOL AT ALL, WHEN /watch ALREADY SELLS IT
    // Measured 2026-08-23: all 976 entries in Binance's B402 Bazaar are type
    // "http". Not one is "mcp", though the format has supported it all along.
    // An agent that speaks MCP and wants to buy something has, today, nothing
    // in that catalog it can call natively. The tool below is the same product
    // through the door those agents already have open.
    if (path === '/mcp') {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
      };
      const rpcOk = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: cors });
      const rpcErr = (id, code, message) => new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), { headers: cors });

      if (request.method === 'GET') {
        return new Response(JSON.stringify({
          name: 'Brain On BNB AI — paid pool watch',
          protocol: '2025-06-18',
          tools: ['bsc_pool_watch'],
          note: 'One tool, and it is paid. The free tools live at https://brainonbnb.com/mcp.',
        }), { headers: cors });
      }

      let body;
      try { body = await request.json(); } catch { return rpcErr(null, -32700, 'Parse error'); }
      const { id, method, params } = body || {};
      if (method && method.startsWith('notifications/')) return new Response(null, { status: 202, headers: cors });

      if (method === 'initialize') {
        return rpcOk(id, {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'Brain On BNB AI — paid pool watch', version: '1.0.0' },
        });
      }
      if (method === 'ping') return rpcOk(id, {});
      if (method === 'tools/list') {
        ctx.waitUntil(bump(env, 'mcp'));
        return rpcOk(id, { tools: [WATCH_TOOL] });
      }
      if (method === 'tools/call') {
        ctx.waitUntil(bump(env, 'mcp'));
        if (params?.name !== 'bsc_pool_watch') return rpcErr(id ?? null, -32602, 'Unknown tool: ' + params?.name);
        if (!payTo) return rpcErr(id ?? null, -32000, 'service not configured to receive payments yet');
        const a = params?.arguments || {};
        if (!/^0x[a-fA-F0-9]{40}$/.test(a.token || '') || !/^0x[a-fA-F0-9]{40}$/.test(a.pair || '')) {
          return rpcOk(id, {
            isError: true,
            content: [{ type: 'text', text: 'token and pair must both be BSC addresses (0x + 40 hex).' }],
          });
        }
        const { payment, ...spec } = a;
        const out = await purchaseWatch(env, ctx, payTo, spec, payment || null);
        // A 402 here is not a failure — it is the price list, which is what a
        // first call is for. Reporting it as an error would make every client
        // that checks isError abandon the purchase before it began.
        // The HTTP wording tells the caller to resend with a header. Over MCP
        // there is no header to set — the same proof goes in the `payment`
        // argument — and instructions a caller cannot follow are worse than
        // none, so the sentence is rewritten for the door it came through.
        const forMcp = (b) => ({
          ...b,
          how: `Send ${fmtUsd1(WATCH_PRICE_USD1)} USD1 to ${payTo} on BNB Smart Chain, then call this tool again with the same arguments plus payment: "<transaction hash>".`,
        });
        const answer = out.status === 402 && !payment
          ? { payment_required: true, ...forMcp(out.body) }
          : out.status === 402
            ? { payment_rejected: true, ...out.body }
            : out.body;
        return rpcOk(id, {
          content: [{ type: 'text', text: JSON.stringify(answer, null, 2) }],
          structuredContent: answer,
          ...(out.status === 402 && payment ? { isError: true } : {}),
        });
      }
      return rpcErr(id ?? null, -32601, 'Method not found: ' + method);
    }

    if (path === '/watch' && request.method === 'POST') {
      if (!payTo) return json({ error: 'service not configured to receive payments yet' }, 503);
      const spec = await request.json().catch(() => null);
      if (!spec || !/^0x[a-fA-F0-9]{40}$/.test(spec.token || '') || !/^0x[a-fA-F0-9]{40}$/.test(spec.pair || ''))
        return json({ error: 'token and pair must both be BSC addresses' }, 400);
      const out = await purchaseWatch(env, ctx, payTo, spec, request.headers.get('PAYMENT-SIGNATURE'));
      return json(out.body, out.status, out.headers || {});
    }

    // Runs the watch sweep on demand. Exists because a cron that only fires
    // every fifteen minutes cannot be verified after a deploy without either
    // waiting for it or trusting that it works — and "the paid part is
    // presumably fine" is not a state this service should ever be shipped in.
    // Same shared secret as /hit; nothing here is reachable without it.
    if (path === '/run-checks' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const result = await checkWatches(env);
      return json({ ok: true, ...result });
    }

    // Runs the census tick on demand. Same reason as /run-checks: a job that
    // fires once a day cannot be verified after a deploy without waiting a
    // day, and "it will presumably work tomorrow" is not a state to ship in.
    if (path === '/run-census' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const r = await runCensusTick(env);
      return json({ ok: true, ...r });
    }

    // Same reason as /run-census: a job that fires once a day is untestable
    // after a deploy unless it can be triggered by hand.
    if (path === '/run-canary' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const r = await runCanary(env);
      return json({ ok: true, ...r });
    }

    // Accepts the endpoint list produced by the offline publish step. Written
    // once per full scan, not per run — this is the input the rotating
    // reachability check walks through.
    if (path === '/census-endpoints' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const body = await request.json().catch(() => null);
      if (!Array.isArray(body)) return json({ error: 'expected an array of {id,url}' }, 400);
      const clean = body
        .filter((x) => x && Number.isInteger(x.id) && typeof x.url === 'string' && /^https?:\/\//i.test(x.url))
        .slice(0, 20000)
        .map((x) => ({ id: x.id, url: x.url.slice(0, 300) }));
      await env.AGENT.put('census:endpoints', JSON.stringify(clean));

      // The offline scan's high-water mark seeds the growth check. Without it
      // the daily tick has no baseline to count new registrations from, and
      // reports highest_id: null forever — which is what it did on the first
      // run. Sent alongside the list because the two come from the same scan
      // and would otherwise drift apart.
      const seed = Number(new URL(request.url).searchParams.get('highestId'));
      let seeded = null;
      if (Number.isInteger(seed) && seed > 0) {
        const st = JSON.parse((await env.AGENT.get('census:state')) || '{}');
        st.highestId = seed;
        // A full scan IS a new baseline — it just read every id up to this one.
        // Carrying the old "new since baseline" forward would count the four
        // thousand agents the scan already includes as if they had arrived
        // since, and the page would state a growth figure that double-counts.
        // Zero here, and the frontier moved up to the same mark so tomorrow's
        // tick starts reading where the scan stopped instead of redoing it.
        st.baselineId = seed;
        st.newSinceBaseline = 0;
        st.lastScannedNew = seed;
        await env.AGENT.put('census:state', JSON.stringify(st));
        seeded = seed;
      }
      return json({ ok: true, stored: clean.length, ...(seeded ? { baseline_highest_id: seeded } : {}) });
    }

    const one = path.match(/^\/watch\/([0-9a-f-]{36})$/i);
    if (one) {
      const raw = await env.AGENT.get(`watch:${one[1]}`);
      if (!raw) return json({ error: 'no such watch, or it has expired' }, 404);
      ctx.waitUntil(bump(env, 'watch_polled'));
      return json(JSON.parse(raw));
    }

    return json({ error: 'not found', see: 'https://agent.brainonbnb.com/' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkWatches(env).catch(() => {}));

    // The cron fires every fifteen minutes for the watch checks. The two daily
    // jobs below hang off it, each pinned to ONE tick rather than to an hour:
    // matching on the hour alone ran the census four times every morning, which
    // is four times the KV writes on an account already close to the free-plan
    // ceiling, for a registry that does not change that fast.
    const t = new Date(event.scheduledTime);
    const firstTickOfHour = t.getUTCMinutes() < 15;

    // 03:0x UTC — read what is new in the registry, re-check a slice of the
    // known endpoints.
    if (t.getUTCHours() === 3 && firstTickOfHour) {
      ctx.waitUntil(runCensusTick(env).catch(() => {}));
    }

    // 15:0x UTC — ask a few real questions and write down how they went. Kept
    // twelve hours away from the census so the two never share an invocation's
    // outbound-call budget.
    if (t.getUTCHours() === 15 && firstTickOfHour) {
      ctx.waitUntil(runCanary(env).catch(() => {}));
    }
  },
};
