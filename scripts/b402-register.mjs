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
// THE HONESTY LINE, AND WHY THIS SCRIPT SENDS NO PAYLOAD
// Binance's settle endpoint answers an empty 202 to any body at all, including
// obvious nonsense, so it cannot tell us whether it understood us. What we can
// do is refuse to lie to it. Everything this script sends is true: the resource
// URL, the price, the payment terms — all of it is read live from our own 402
// rather than typed in here, so the listing cannot drift from the service.
// The one field we will not invent is `payload`, which asserts that somebody
// signed a payment. Nobody has. So it is left out.
//   - If the listing appears, we got in without asserting anything false.
//   - If it does not, we have learned that for the cost of one HTTP request,
//     and can then decide whether a real 0.50 USD1 payment is worth making.
// Either outcome is an answer. The merchant endpoint is what tells us which.
//
// Usage:
//   node scripts/b402-register.mjs           # plan: print the exact body, send nothing
//   node scripts/b402-register.mjs --live    # send it, then watch for the listing
//   node scripts/b402-register.mjs --check   # only ask whether we are listed
import 'dotenv/config';

const SETTLE = 'https://www.binance.com/papi/v2/b402/settle';
const BAZAAR = 'https://www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar';
const WATCH = 'https://agent.brainonbnb.com/watch';

// Any real BSC pair works — the 402 comes back before the addresses are used
// for anything, and asking with real ones keeps us off the error path.
const PROBE = {
  token: '0x245c386dcfed896f5c346107596141e5edcbffff',
  pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6',
};

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const CHECK_ONLY = args.has('--check');

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
function bazaarBlob(req) {
  return {
    description:
      'Continuous depth monitoring of one BNB Smart Chain liquidity pool for 30 days. '
      + 'Fires a callback the moment the pool can no longer absorb a trade of your size '
      + 'without moving the price past your threshold. Runs every fifteen minutes around '
      + 'the clock, which is the part a one-off scan cannot do — measuring a pool once is '
      + 'free at brainonbnb.com/scanner and stays free.',
    info: {
      input: {
        type: 'http',
        method: 'POST',
        bodyType: 'application/json',
        body: {
          token: '0x… the BEP-20 token address',
          pair: '0x… the PancakeSwap pair holding it',
          threshold_usd: 'alert when a trade of this size moves the price past your limit',
          callback: 'https://… where to POST when that happens',
        },
        headers: {
          'PAYMENT-SIGNATURE': 'the transaction hash of your USD1 transfer, or an x402 payload',
        },
      },
      output: {
        type: 'application/json',
        example: {
          ok: true,
          watch_id: 'w_…',
          watching: { token: '0x…', pair: '0x…' },
          expires_at: '2026-09-22T00:00:00.000Z',
        },
      },
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['token', 'pair', 'callback'],
      properties: {
        token: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
        pair: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
        threshold_usd: { type: 'number', minimum: 1 },
        callback: { type: 'string', format: 'uri' },
      },
    },
  };
}

function settleBody(req) {
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: {
        url: req.resource,
        // The catalog shows this line, so it describes the service. The line on
        // the accepts entry describes how to pay for it, which is a different
        // question and belongs where it already is.
        description: bazaarBlob(req).description,
        mimeType: 'application/json',
      },
      accepted: req,
      // No `payload` key. See the note at the top: that field claims a signed
      // payment exists, and none does.
      extensions: { bazaar: bazaarBlob(req) },
    },
    paymentRequirements: req,
  };
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
const body = settleBody(req);

console.log('\n  the offer, read live from our own 402:');
console.log(`    resource   ${req.resource}`);
console.log(`    price      ${Number(BigInt(req.maxAmountRequired)) / 1e18} ${req.extra?.name || req.asset}`);
console.log(`    payTo      ${req.payTo}`);
console.log(`    scheme     ${req.scheme} on ${req.network}`);

if (!LIVE) {
  console.log('\n  --- body that --live would POST to the settle endpoint ---');
  console.log(j(body));
  console.log('\n  plan only. Nothing was sent. Re-run with --live to send it.');
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
