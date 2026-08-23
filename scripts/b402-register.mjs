// Puts the paid pool watch into Binance's B402 Bazaar.
//
// WHAT THE BAZAAR IS
// A catalog an agent can search to find paid endpoints it can call, run by
// Binance at www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar. There is no
// signup: the docs say a listing appears "within ~30-60 seconds of the first
// confirmed settle containing the metadata blob", where the blob rides along in
// paymentPayload.extensions.bazaar. No partner account, no API key — the note
// in our own memory that one was needed turned out to be wrong.
//
// WHAT IS ACTUALLY IN THERE (measured 2026-08-23, all 976 entries read)
//   976 resources, 6 distinct payTo addresses, one of them holding 941 of them.
//   Every single entry is type "http". Not one is type "mcp".
// So the catalog is five small operators and one bulk lister, not a market. Two
// things follow. Being listed is cheap and worth having; and a payload of 941
// entries from one address is a strong hint that the endpoint indexes what it
// is handed rather than demanding a settled payment for each one.
//
// THE HONESTY LINE, AND WHY A PAYLOAD ONLY APPEARS WITH --proof
// Binance's settle endpoint answers an empty 202 to any body at all, including
// obvious nonsense, so it cannot tell us whether it understood us. What we can
// do is refuse to lie to it. Everything this script sends is true: the resource
// URL, the price, the payment terms — all of it is read live from our own 402
// rather than typed in here, so the listing cannot drift from the service.
// The one field we will not invent is `payload`, which asserts that a payment
// happened. Without --proof it is left out entirely; with --proof it names a
// real transaction, and the script reads that transaction off the chain before
// it will send it. Measured 2026-08-23: a settle with no payload was answered
// 202 and never indexed, so a real payment is evidently what it wants.
// Either outcome is an answer. The merchant endpoint is what tells us which.
//
// The scheme named here is OUR scheme — "exact", USD1 by direct transfer, the
// same one our own 402 publishes. The catalog's existing entries all use
// eip3009 and it would be easy to claim that instead to look native, but an
// eip3009 authorization has to be submitted by the recipient and this worker
// holds no key and moves no funds. Advertising a payment route we cannot honour
// would be a lie with a victim: an agent that signs one and gets nothing.
//
// Usage:
//   node scripts/b402-register.mjs           # plan: print the exact body, send nothing
//   node scripts/b402-register.mjs --live    # send it, then watch for the listing
//   node scripts/b402-register.mjs --check   # only ask whether we are listed
//   node scripts/b402-register.mjs --proof=0x…  --live   # with a real payment
import 'dotenv/config';

const SETTLE = 'https://www.binance.com/papi/v2/b402/settle';
const BAZAAR = 'https://www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar';
const WATCH = 'https://agent.brainonbnb.com/watch';
const MCP = 'https://agent.brainonbnb.com/mcp';

// Any real BSC pair works — the 402 comes back before the addresses are used
// for anything, and asking with real ones keeps us off the error path.
const PROBE = {
  token: '0x245c386dcfed896f5c346107596141e5edcbffff',
  pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6',
};

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const CHECK_ONLY = args.has('--check');
const PROOF = (process.argv.slice(2).find((a) => a.startsWith('--proof=')) || '').slice(8).toLowerCase();
if (PROOF && !/^0x[a-f0-9]{64}$/.test(PROOF)) {
  console.error('--proof must be a transaction hash (0x + 64 hex).');
  process.exit(1);
}

const payTo = process.env.X402_WALLET;
if (!payTo) {
  console.error('X402_WALLET is not in .env — that is the address a listing is filed under.');
  process.exit(1);
}

const j = (o) => JSON.stringify(o, null, 2);

// --- what we are listed as, read from the running service ------------------
// Nothing about the offer is written down twice. If the price or the wallet
// changes, this reads the new one; there is no copy here to forget to update.
async function liveRequirements() {
  const r = await fetch(WATCH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(PROBE),
  });
  if (r.status !== 402) throw new Error(`expected 402 from ${WATCH}, got ${r.status}`);
  const body = await r.json();
  const accepts = body.accepts || [];
  // The direct-transfer entry is the one to advertise: it needs no facilitator,
  // so it is the one we can honour on our own regardless of who is up.
  const direct = accepts.find((a) => a?.extra?.assetTransferMethod === 'direct-transfer');
  if (!direct) throw new Error('the live 402 no longer offers a direct-transfer route');
  return direct;
}

// --- the metadata blob -----------------------------------------------------
// Shape taken from a listing that is actually in the catalog rather than from
// the documentation, because the two do not fully agree and the catalog is the
// thing that has to accept us.
//
// This is the `mcp` variant. Every one of the 976 entries in the catalog is
// type "http"; the format has supported "mcp" all along and nobody has used it.
// The tool description and its input schema are read live from our own MCP
// server rather than restated here, so the catalog entry cannot describe a tool
// that differs from the one an agent would actually call.
async function liveTool() {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const body = await r.json();
  const tool = (body?.result?.tools || [])[0];
  if (!tool) throw new Error(`${MCP} listed no tools`);
  return tool;
}

function bazaarBlob(tool) {
  return {
    description: tool.description,
    info: {
      input: {
        type: 'mcp',
        tool: tool.name,
        inputSchema: tool.inputSchema,
        example: {
          name: tool.name,
          arguments: {
            token: '0x245c386dcfed896f5c346107596141e5edcbffff',
            pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6',
            depthBelowUsd: 2000,
            callback: 'https://your-agent.example/hook',
          },
        },
      },
      output: {
        type: 'application/json',
        example: {
          ok: true,
          watch: 'w_…',
          expires: '2026-09-22T00:00:00.000Z',
          watching: { token: '0x…', pair: '0x…', depthBelowUsd: 2000 },
          paid: '0.50 USD1',
        },
      },
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...tool.inputSchema,
    },
  };
}

function settleBody(req, tool, payload = null) {
  const blob = bazaarBlob(tool);
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: {
        // The MCP endpoint, not the HTTP one: what is being listed is a tool an
        // agent calls over MCP, and pointing at /watch would send them to a
        // door this entry does not describe.
        url: MCP,
        // The catalog shows this line, so it describes the service. The line on
        // the accepts entry describes how to pay for it, which is a different
        // question and belongs where it already is.
        description: blob.description,
        mimeType: 'application/json',
      },
      accepted: req,
      // `payload` is only present when a real signed authorization exists. It
      // asserts that somebody signed a payment, and inventing one to satisfy a
      // schema would be a lie told to a payment endpoint.
      ...(payload ? { payload } : {}),
      extensions: { bazaar: blob },
    },
    paymentRequirements: req,
  };
}

// --- does the proof actually exist on chain? -------------------------------
// The settle endpoint cannot tell us it disbelieved us, so nothing unverified
// gets sent in its name. A transfer to the wrong address, of the wrong amount,
// or one that never confirmed, stops here rather than becoming a claim.
const USD1 = '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const PRICE = 500000000000000000n;

async function readProof(hash) {
  // publicnode refuses receipts as "archive requests" even for fresh ones — the
  // service worker learned that the expensive way and keeps its own list.
  for (const rpc of ['https://bsc-dataseed1.defibit.io', 'https://bsc-mainnet.public.blastapi.io', 'https://bsc-dataseed.binance.org']) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
      });
      const receipt = (await r.json()).result;
      if (!receipt) continue;
      if (receipt.status !== '0x1') return { ok: false, why: 'that transaction failed on chain' };
      for (const log of receipt.logs || []) {
        if (log.address.toLowerCase() !== USD1) continue;
        if (log.topics?.[0] !== TRANSFER) continue;
        const to = '0x' + log.topics[2].slice(-40);
        if (to.toLowerCase() !== payTo.toLowerCase()) continue;
        const value = BigInt(log.data);
        if (value < PRICE) return { ok: false, why: `it moved ${Number(value) / 1e18} USD1, and the price is ${Number(PRICE) / 1e18}` };
        const from = '0x' + log.topics[1].slice(-40);
        if (from.toLowerCase() === payTo.toLowerCase()) return { ok: false, why: 'payer and recipient are the same address' };
        return { ok: true, from, value };
      }
      return { ok: false, why: `no USD1 transfer to ${payTo} in that transaction` };
    } catch { /* try the next node */ }
  }
  return { ok: false, why: 'no node would return that receipt' };
}

// --- are we in the catalog? ------------------------------------------------
async function listed() {
  const r = await fetch(`${BAZAAR}/merchant?payTo=${payTo}`, {
    headers: { accept: 'application/json' },
  });
  const body = await r.json().catch(() => null);
  const res = body?.data?.resources || [];
  return { count: res.length, resources: res };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- run -------------------------------------------------------------------
console.log('B402 Bazaar registration\n');

const before = await listed();
console.log(`  listed under ${payTo}: ${before.count} resource(s)`);
for (const r of before.resources) console.log(`    - ${r.resource}`);

if (CHECK_ONLY) process.exit(0);

const req = await liveRequirements();
const tool = await liveTool();

let payload = null;
if (PROOF) {
  const p = await readProof(PROOF);
  if (!p.ok) {
    console.error(`
  that proof does not hold up: ${p.why}`);
    process.exit(1);
  }
  console.log(`
  proof checked on chain: ${Number(p.value) / 1e18} USD1 from ${p.from}`);
  payload = { scheme: req.scheme, network: req.network, transaction: PROOF, payer: p.from };
}
const body = settleBody(req, tool, payload);

console.log('\n  the offer, read live from our own 402 and MCP server:');
console.log(`    resource   ${MCP}   (listed as type "mcp")`);
console.log(`    tool       ${tool.name}`);
console.log(`    price      ${Number(BigInt(req.maxAmountRequired)) / 1e18} ${req.extra?.name || req.asset}`);
console.log(`    payTo      ${req.payTo}`);
console.log(`    scheme     ${req.scheme} on ${req.network}`);

if (!LIVE) {
  console.log('\n  --- body that --live would POST to the settle endpoint ---');
  console.log(j(body));
  console.log(payload
    ? '\n  plan only. Nothing was sent. Re-run with the same --proof plus --live.'
    : '\n  plan only, and with no payment attached — the attempt on 2026-08-23 got a 202\n'
      + '  and no listing, so that path is already known to be a dead end. Add\n'
      + '  --proof=<transaction hash> of a real 0.50 USD1 transfer to the address\n'
      + '  above, then --live.');
  process.exit(0);
}

console.log(`\n  POST ${SETTLE}`);
const res = await fetch(SETTLE, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body),
});
const text = (await res.text()).slice(0, 300);
console.log(`  -> ${res.status} ${text || '(empty body)'}`);
console.log('  An empty 202 means nothing on its own — this endpoint answers that to anything.');

// The docs promise indexing within 30-60 seconds. Give it three minutes before
// calling it a black hole; a slow index and a silent drop look identical early.
console.log('\n  watching the catalog for up to 3 minutes...');
for (let i = 1; i <= 12; i++) {
  await sleep(15000);
  const now = await listed();
  if (now.count > before.count) {
    console.log(`\n  listed after ~${i * 15}s:`);
    for (const r of now.resources) console.log(`    - ${r.resource}`);
    process.exit(0);
  }
  process.stdout.write('.');
}

console.log('\n\n  Not listed after 3 minutes.');
console.log('  The settle endpoint took the request and did nothing visible with it.');
console.log('  Next lever would be a real signed 0.50 USD1 payment — which needs USD1');
console.log('  in a wallet we control, and is a decision for a human, not this script.');
