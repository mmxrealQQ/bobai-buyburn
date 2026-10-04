// USD1 x402 by EIP-3009 against the live /answer (2026-10-04).
//
// Dry (default, spends nothing): an authorization from a fresh empty wallet must
// be refused at the simulation ("would not settle"), and a signature by the
// wrong key must be refused before any chain call. On a server without the
// EIP-3009 path both come back as the plain price list — that is the FAIL.
// --real: the x402 wallet pays ITSELF 0.10 USD1 for one yield_plan answer
// (from = to = 0x690E; nets zero, the provider pays the settle gas). A person
// starts it with `!`: node scripts/bnb-sdk/x402-eip3009-test.mjs --real
import path from 'node:path';
import dotenv from 'dotenv';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
const BASE = 'https://agent.brainonbnb.com';
const USD1 = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d';
const PAYTO = '0x690E950214980BC329823A2DB2fD90C06Bd54dE4';
const DOMAIN = { name: 'World Liberty Financial USD', version: '1', chainId: 56, verifyingContract: USD1 };
const TYPES = { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] };
const real = process.argv.includes('--real');

async function pay(signer, from) {
  const now = Math.floor(Date.now() / 1000);
  const nonce = '0x' + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const authorization = { from, to: PAYTO, value: '100000000000000000', validAfter: String(now - 60), validBefore: String(now + 300), nonce };
  const signature = await signer.signTypedData({ domain: DOMAIN, types: TYPES, primaryType: 'TransferWithAuthorization', message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) } });
  const header = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'eip155:56', payload: { signature, authorization } })).toString('base64');
  const r = await fetch(`${BASE}/answer?service=yield_plan`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-PAYMENT': header }, body: JSON.stringify({ task: 'where is the best yield on BNB Chain for USDT right now' }), signal: AbortSignal.timeout(120000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let bad = 0;
const ok = (n, pass, d) => { if (!pass) bad++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${n} — ${d}`); };
if (!real) {
  const empty = privateKeyToAccount(generatePrivateKey());
  const a = await pay(empty, empty.address);
  ok('an empty wallet is refused at the simulation, nothing sent', a.status === 402 && /would not settle/.test(a.body.reason || ''), `${a.status} ${a.body.error || ''} · ${String(a.body.reason || '').slice(0, 120)}`);
  const b = await pay(empty, PAYTO);
  ok('a signature by the wrong key is refused before any chain call', b.status === 402 && /signature is/.test(b.body.reason || ''), `${b.status} ${b.body.error || ''} · ${String(b.body.reason || '').slice(0, 120)}`);
} else {
  const k = process.env.X402_PRIVATE_KEY;
  const me = privateKeyToAccount(k.startsWith('0x') ? k : `0x${k}`);
  if (me.address.toLowerCase() !== PAYTO.toLowerCase()) throw new Error('X402_PRIVATE_KEY is not the x402 wallet');
  const r = await pay(me, me.address);
  ok('a real USD1 EIP-3009 payment buys one answer', r.status === 200 && !!r.body.result, `${r.status} · paid ${r.body.paid || '-'} · tx ${r.body.tx ? 'https://bscscan.com/tx/' + r.body.tx : '-'} · ${r.body.error || ''} ${String(r.body.reason || '').slice(0, 120)}`);
}
process.exit(bad ? 1 : 0);
