// Ownership proofs for the /.well-known/x402 catalogue.
//
// A catalogue is a claim: "payments for the resources under this origin belong
// to this wallet." Anyone can write that sentence about anyone's wallet, so the
// claim is worth nothing unless the wallet itself signs it. That signature is
// the ownershipProof, and an aggregator checks it by recovering the signer from
// the message and comparing it to the payTo address in our 402.
//
// WHAT IS SIGNED — and how we know, because no public spec documents it:
// Dexter publishes a working catalogue at https://x402.dexter.cash/.well-known/x402
// with two proofs, one 64-byte (Solana) and one 65-byte (EVM). Their 402 names
// payTo 0x9421c7CA7D8DcEe9760d72Be81137eE162003C36 on eip155:8453. Recovering
// their EVM signature against a list of candidate messages produced exactly one
// hit: the plain origin string "https://x402.dexter.cash", EIP-191 personal_sign,
// no nonce, no timestamp, no JSON. That is the format reproduced here. It was
// measured, not read from documentation — see docs/x402-catalog.md.
//
// The proof is generated offline and baked into the worker as a constant. The
// worker must never hold the private key: it serves a public file, and a key
// that signs money has no business in a request handler.
//
// Usage:
//   node scripts/x402-catalog-proof.mjs           # print proofs for both origins
//   node scripts/x402-catalog-proof.mjs --verify  # re-check what is live now

import 'dotenv/config';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverMessageAddress } from 'viem';

// The origins we publish a catalogue at. Each needs its own proof: the message
// IS the origin, so a signature for one does not verify for the other.
const ORIGINS = [
  'https://agent.brainonbnb.com',
  'https://brainonbnb.com',
];

const die = (m) => { console.error(m); process.exit(1); };

async function generate() {
  const pk = process.env.X402_PRIVATE_KEY;
  if (!pk) die('No X402_PRIVATE_KEY in .env');
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);

  const declared = process.env.X402_WALLET;
  if (declared && declared.toLowerCase() !== account.address.toLowerCase()) {
    die(`X402_PRIVATE_KEY derives ${account.address}, but X402_WALLET says ${declared}. Refusing to sign with the wrong wallet.`);
  }

  console.log(`Signer: ${account.address}`);
  console.log('');

  for (const origin of ORIGINS) {
    const signature = await account.signMessage({ message: origin });

    // Never emit a proof without recovering it first. A signature that does not
    // round-trip is worse than no signature: it is a public claim that fails
    // verification, and it fails on the aggregator's side where we cannot see it.
    const recovered = await recoverMessageAddress({ message: origin, signature });
    if (recovered.toLowerCase() !== account.address.toLowerCase()) {
      die(`Self-check failed for ${origin}: recovered ${recovered}, expected ${account.address}`);
    }

    console.log(`  origin    ${origin}`);
    console.log(`  proof     ${signature}`);
    console.log(`  recovers  ${recovered}  ok`);
    console.log('');
  }
}

// Reads the catalogues as the world sees them and checks every proof recovers
// to the address the same catalogue names as payTo. This is the check an
// aggregator runs; running it ourselves is how we find out before they do.
async function verifyLive() {
  let bad = 0;
  for (const origin of ORIGINS) {
    const url = `${origin}/.well-known/x402`;
    process.stdout.write(`${url}\n`);
    let doc;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) {
        console.log(`  FAIL  served ${ct || 'no content-type'}, not JSON (HTTP ${r.status})`);
        bad++; continue;
      }
      doc = await r.json();
    } catch (e) {
      console.log(`  FAIL  ${e.message}`);
      bad++; continue;
    }

    const proofs = doc.ownershipProofs || [];
    if (!proofs.length) { console.log('  FAIL  no ownershipProofs'); bad++; continue; }

    // Whose wallet should the proof recover to? Ask the resource itself rather
    // than trusting a constant in this file: the 402 is the authority on where
    // the money goes, and if the two ever disagree the catalogue is the lie.
    let payTo = null;
    for (const res of doc.resources || []) {
      try {
        const r = await fetch(res, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
        if (r.status !== 402) continue;
        const body = await r.json();
        payTo = body?.accepts?.find((a) => a.payTo)?.payTo || null;
        if (payTo) break;
      } catch { /* try the next resource */ }
    }
    if (!payTo) { console.log('  WARN  could not read payTo from any listed resource'); }

    // The document carries a proof per origin, and the message IS the origin —
    // so proofs for the OTHER origin necessarily recover to some unrelated
    // address here. That is correct, not a failure. What has to be true is that
    // at least one proof recovers to payTo for the origin we actually fetched.
    let matched = false;
    for (const p of proofs) {
      let recovered;
      try {
        recovered = await recoverMessageAddress({ message: origin, signature: p });
      } catch (e) {
        console.log(`  FAIL  ${p.slice(0, 14)}… is not a recoverable signature: ${e.message}`);
        bad++; continue;
      }
      const isOurs = payTo && recovered.toLowerCase() === payTo.toLowerCase();
      if (isOurs) matched = true;
      console.log(`  proof ${p.slice(0, 14)}… recovers ${recovered}${
        isOurs ? '  == payTo  ok' : '  (proof for another origin)'}`);
    }
    if (payTo && !matched) {
      console.log(`  FAIL  no proof recovers to ${payTo} for origin ${origin}`);
      bad++;
    }
  }
  console.log('');
  console.log(bad ? `${bad} problem(s)` : 'all proofs verify against the payTo the resource itself names');
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes('--verify')) await verifyLive();
else await generate();
