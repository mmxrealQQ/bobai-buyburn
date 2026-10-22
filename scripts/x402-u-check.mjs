#!/usr/bin/env node
// x402 in $U by EIP-3009 (2026-10-22, operator's go "x402 in $U annehmen"). Marque counted no x402 seller live that
// did not take $U; worker-agent now offers it last in every 402's accepts and settles it like USD1.
// Held against:
//   offline  the token is read off the signature: a $U authorization is $U, a USD1 one USD1, one signed under any
//            other domain is neither; the accepts entry names $U with United Stables' domain
//   chain    a real $U authorization (our provider wallet to the x402 wallet, 0.10 $U) simulated as the very call
//            the worker sends — proves domain, signature and balance at this block; NOTHING is sent
//   live     the 402 of /answer, /scan-pass and /watch offers $U by EIP-3009, last, with USD1 still accepts[0]
// usage: node scripts/x402-u-check.mjs [origin]
import 'dotenv/config';
import { createPublicClient, http, encodeFunctionData, parseSignature, toHex } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { eip3009Token, eip3009Accepts, EIP3009_TOKENS, U, USD1 } from '../worker-agent/x402-eip3009.js';
const origin = (process.argv[2] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const TYPES = { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] };
const PAY_TO = '0x690E950214980BC329823A2DB2fD90C06Bd54dE4';
const sign = async (acct, domain, value = 100000000000000000n) => {
  const now = Math.floor(Date.now() / 1000);
  const authorization = { from: acct.address, to: PAY_TO, value: String(value), validAfter: '0', validBefore: String(now + 600), nonce: toHex(crypto.getRandomValues(new Uint8Array(32))) };
  const signature = await acct.signTypedData({ domain, types: TYPES, primaryType: 'TransferWithAuthorization', message: { ...authorization, value: BigInt(authorization.value), validAfter: 0n, validBefore: BigInt(authorization.validBefore) } });
  return { authorization, signature };
};
const tok = (a) => EIP3009_TOKENS.find((t) => t.address === a).domain;

// offline
const k = privateKeyToAccount(generatePrivateKey());
say((await eip3009Token(await sign(k, tok(U)))).token?.label === '$U', 'a $U authorization is read as $U');
say((await eip3009Token(await sign(k, tok(USD1)))).token?.label === 'USD1', 'a USD1 authorization is read as USD1');
say(!(await eip3009Token(await sign(k, { name: 'Tether USD', version: '1', chainId: 56, verifyingContract: '0x55d398326f99059fF775485246999027B3197955' }))).token, 'one signed under another token\'s domain is neither');
const acc = eip3009Accepts({ payTo: PAY_TO, amountAtomic: '100000000000000000', description: 'x', resource: 'r', asset: U });
say(acc.asset === U && acc.extra.name === 'United Stables' && acc.extra.version === '1' && acc.extra.assetTransferMethod === 'eip3009', `the accepts entry: ${acc.asset.slice(0, 8)}… ${acc.extra.name} v${acc.extra.version} ${acc.extra.assetTransferMethod}`);

// chain: simulate only
const pk = process.env.AGENT_PROVIDER_PRIVATE_KEY;
if (!pk) say(false, 'AGENT_PROVIDER_PRIVATE_KEY missing in .env');
else {
  const prov = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
  const inner = await sign(prov, tok(U));
  const a = inner.authorization, { v, r, s, yParity } = parseSignature(inner.signature);
  const data = encodeFunctionData({ abi: [{ name: 'transferWithAuthorization', type: 'function', stateMutability: 'nonpayable', inputs: ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'].map((n, i) => ({ name: n, type: i < 2 ? 'address' : i === 5 ? 'bytes32' : 'uint256' })).concat([{ name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' }]), outputs: [] }],
    functionName: 'transferWithAuthorization', args: [a.from, a.to, BigInt(a.value), 0n, BigInt(a.validBefore), a.nonce, Number(v ?? (yParity + 27)), r, s] });
  const pub = createPublicClient({ chain: bsc, transport: http('https://bsc-dataseed.binance.org') });
  const sim = await pub.call({ account: prov, to: U, data }).then(() => 'ok').catch((e) => String(e.shortMessage || e.message).split('\n')[0]);
  say(sim === 'ok', `a real 0.10 $U authorization ${prov.address.slice(0, 8)}… -> x402 wallet settles in simulation (nothing sent): ${sim}`);
}

// live
for (const [path, init] of [['/answer?service=health_factor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }], ['/scan-pass', { method: 'POST' }], ['/watch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pair: '0x6eadd4cb786898b3c6b2fb6d2ee0d2b4f01a7e1d', threshold_usd: 100 }) }]]) {
  const r = await fetch(origin + path, init).catch(() => null);
  const head = r?.headers.get('payment-required');
  let acc = [], top = {}; try { top = JSON.parse(Buffer.from(head, 'base64').toString()); acc = top.accepts || []; } catch {}
  const last = acc[acc.length - 1] || {};
  say(r?.status === 402 && String(acc[0]?.asset).toLowerCase() === USD1.toLowerCase() && String(last.asset).toLowerCase() === U.toLowerCase() && last.extra?.assetTransferMethod === 'eip3009',
    `${path}: 402 offers $U by EIP-3009 last (${acc.length} ways), USD1 still first`);
  say(String(top.asset).toLowerCase() === U.toLowerCase() && top.symbol === 'U' && top.network === 'eip155:56' && /^0x[0-9a-fA-F]{40}$/.test(top.payTo || ''), `${path}: the header names $U at the top (asset, symbol, network, payTo), as the one seller Marque counts live does`);
}
// b (2026-10-22): every card says "$0.05 in $BOBAI", and the 402 it points at really carries that $BOBAI entry, worth half
const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const px = await fetch('https://brainonbnb.com/api/price').then((r) => r.json()).catch(() => ({}));
for (const [slug, svc] of [['health-factor', 'health_factor'], ['grid-trader', 'grid_plan'], ['yield-optimizer', 'yield_plan'], ['rebalancer', 'rebalance_plan'], ['lp-placement', 'lp_tier_plan'], ['defi-agent', 'lp_position_plan']]) {
  const card = await fetch(`${origin}/${slug}/.well-known/agent-card.json?r=${Date.now()}`).then((r) => r.json()).catch(() => null);
  const sk = (card?.skills || []).find((k) => k.id === svc);
  const r = await fetch(`${origin}/answer?service=${svc}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
  let acc = []; try { acc = JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString()).accepts || []; } catch {}
  const b = acc.find((x) => String(x.asset).toLowerCase() === BOBAI);
  const usd = b && px.price_usd ? Number(BigInt(b.maxAmountRequired || b.amount) / 10n ** 15n) / 1000 * px.price_usd : null;
  say(/\$0\.05 in \$BOBAI/.test(sk?.price || '') && sk?.pay_in_bobai?.price_usd === 0.05 && usd != null && usd > 0.035 && usd < 0.06, `${slug}: the card says $0.05 in $BOBAI and its 402 carries it (${usd == null ? 'no $BOBAI entry' : '≈$' + usd.toFixed(3) + ' must arrive'})`);
}
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
