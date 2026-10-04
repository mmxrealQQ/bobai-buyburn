// x402 in USD1 by EIP-3009, settled by us (2026-10-04, operator's go).
//
// WHY. Marketplaces on BNB Chain pay x402 sellers with a signed
// TransferWithAuthorization in USD1 or $U — Mandate calls an agent "Priced"
// (rung 3) and lets its hire button pay per call only when the seller accepts
// that; our 402 offered USDC through Permit2 and USD1 by plain transfer, so
// to Mandate our agents were merely "Live". The facilitator we use for USDC
// (Dexter) settles no EIP-3009 on BSC, so this file does it.
//
// HOW, and what is never trusted:
//   1. every field against our terms — to = our x402 wallet, value >= price,
//      the validity window open now and long enough to settle in;
//   2. the signature recovered off-chain against USD1's own EIP-712 domain
//      ("World Liberty Financial USD", "1", 56, USD1 — equal to the token's
//      DOMAIN_SEPARATOR, checked 2026-10-04) — a forged one costs us nothing;
//   3. authorizationState(from, nonce) on the token — a used nonce is refused;
//   4. the transfer simulated as an eth_call from our sender — balance and
//      signature proven at this block before any gas is spent;
//   5. sent from the provider wallet (gas only; the money moves from the payer
//      straight to the x402 wallet, never through the sender), receipt waited.
// The resulting transaction hash then goes through the SAME check a direct
// USD1 transfer does (verifyPayment: a Transfer of >= price to our wallet in
// that receipt) and the same one-time claim, so a hash can be used once.
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseSignature, recoverTypedDataAddress, getAddress } from 'viem';
import { bsc } from 'viem/chains';
import { providerAccount } from './submit.js';

export const USD1 = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d';
const RPCS = ['https://bsc-dataseed1.defibit.io', 'https://bsc-dataseed.binance.org'];
const DOMAIN = { name: 'World Liberty Financial USD', version: '1', chainId: 56, verifyingContract: USD1 };
const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
};
const ABI = [
  { name: 'transferWithAuthorization', type: 'function', stateMutability: 'nonpayable', inputs: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' }], outputs: [] },
  { name: 'authorizationState', type: 'function', stateMutability: 'view', inputs: [{ name: 'authorizer', type: 'address' }, { name: 'nonce', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
];
const MIN_WINDOW = 30; // seconds the authorization must still be valid for

// The accepts[] entry: x402 v1 and v2 spellings both, the way Mandate and the
// reference clients read it (extra.transferMethod / assetTransferMethod).
export function eip3009Accepts({ payTo, amountAtomic, description, resource }) {
  return {
    scheme: 'exact', network: 'eip155:56', asset: USD1,
    amount: String(amountAtomic), maxAmountRequired: String(amountAtomic),
    payTo, resource, maxTimeoutSeconds: 300,
    description: `${description} — USD1 by EIP-3009 (sign TransferWithAuthorization, send it in X-PAYMENT or PAYMENT-SIGNATURE; we settle it)`,
    extra: { name: DOMAIN.name, version: DOMAIN.version, decimals: 18, assetTransferMethod: 'eip3009', transferMethod: 'eip3009' },
  };
}

// Is this decoded payment payload an EIP-3009 authorization?
export const isEip3009 = (inner) => !!(inner && inner.authorization && inner.signature && inner.authorization.nonce);

// Pure checks, no network — pinned by scripts/payment-ledger-check.mjs.
export function eip3009Mismatch(inner, { payTo, price, now = Math.floor(Date.now() / 1000) }) {
  const a = inner?.authorization || {};
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.from || '')) return 'authorization.from is not an address';
  if (String(a.to || '').toLowerCase() !== String(payTo).toLowerCase()) return `authorization.to must be ${payTo}`;
  let value; try { value = BigInt(a.value); } catch { return 'authorization.value is not a number'; }
  if (value < BigInt(price)) return `authorization.value ${value} is below the price ${price}`;
  if (Number(a.validAfter || 0) > now) return 'the authorization is not valid yet';
  if (Number(a.validBefore || 0) < now + MIN_WINDOW) return 'the authorization expires too soon to settle';
  if (!/^0x[0-9a-fA-F]{64}$/.test(a.nonce || '')) return 'authorization.nonce must be 32 bytes of hex';
  if (!/^0x[0-9a-fA-F]{130}$/.test(inner.signature || '')) return 'signature must be 65 bytes of hex';
  return null;
}

// Settle it. Returns { ok:true, tx, from, value } or { ok:false, reason }.
export async function settleEip3009(env, inner, { payTo, price }) {
  const bad = eip3009Mismatch(inner, { payTo, price });
  if (bad) return { ok: false, stage: 'verify', reason: bad };
  const a = inner.authorization;
  const message = { from: getAddress(a.from), to: getAddress(a.to), value: BigInt(a.value), validAfter: BigInt(a.validAfter || 0), validBefore: BigInt(a.validBefore), nonce: a.nonce };
  let signer;
  try { signer = await recoverTypedDataAddress({ domain: DOMAIN, types: TYPES, primaryType: 'TransferWithAuthorization', message, signature: inner.signature }); }
  catch { return { ok: false, stage: 'verify', reason: 'the signature does not recover' }; }
  if (signer.toLowerCase() !== message.from.toLowerCase()) return { ok: false, stage: 'verify', reason: `the signature is ${signer}'s, not ${message.from}'s` };
  const account = providerAccount(env);
  if (!account) return { ok: false, stage: 'settle', reason: 'this seller cannot settle EIP-3009 right now (no sender key); nothing was taken' };
  const pub = createPublicClient({ chain: bsc, transport: http(RPCS[0]) });
  const used = await pub.readContract({ address: USD1, abi: ABI, functionName: 'authorizationState', args: [message.from, message.nonce] }).catch(() => null);
  if (used === null) return { ok: false, stage: 'verify', reason: 'the token could not be read; nothing was taken — try again' };
  if (used) return { ok: false, stage: 'verify', reason: 'this authorization nonce has already been used' };
  const { v, r, s, yParity } = parseSignature(inner.signature);
  const data = encodeFunctionData({ abi: ABI, functionName: 'transferWithAuthorization', args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, Number(v ?? (yParity + 27)), r, s] });
  try { await pub.call({ account, to: USD1, data }); }
  catch (e) { return { ok: false, stage: 'verify', reason: 'the payment would not settle: ' + String(e.shortMessage || e.message || e).split('\n')[0].slice(0, 200) }; }
  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPCS[0]) });
  let hash;
  try { hash = await wallet.sendTransaction({ to: USD1, data }); }
  catch (e) { return { ok: false, stage: 'settle', reason: 'sending the settlement failed: ' + String(e.shortMessage || e.message || e).slice(0, 160) + ' — nothing was taken' }; }
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
  if (!rc || rc.status !== 'success') return { ok: false, stage: 'settle', reason: `the settlement ${hash} did not succeed`, tx: hash };
  return { ok: true, tx: hash.toLowerCase(), from: message.from, value: message.value };
}
