#!/usr/bin/env node
// Who paid (2026-10-19). An EIP-3009 payment is sent on chain by our own provider wallet (0x7380), so the receipt's
// `from` is ours whoever signed it; the payer is the sender of the transfer into the income wallet. verifyPayment
// took receipt.from, and /buys filed every one of Mandate's paid calls as our own test (from_strangers 0).
//
//   node scripts/payment-payer-check.mjs      a made-up receipt offline + Mandate's real payment of 19.10. (read only)
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    return /\/(dashboard|shared)\/[^/]+\.js$/.test(url) ? nextLoad(url, { ...context, format: 'module' }) : nextLoad(url, context);
  },
});
const ROOT = path.resolve(import.meta.dirname, '..');
const { transferredIn } = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'index.js')).href);

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

const USD1 = '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d';
const INCOME = '0x690e950214980bc329823a2db2fd90c06bd54de4';
const PROVIDER = '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963';
const MANDATE = '0xd6d11aa5046dc5c7be8d63b9223b60d7ad94cbe9';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topic = (a) => '0x' + '0'.repeat(24) + a.slice(2);

console.log('offline: a receipt sent by us, paid by someone else');
if (typeof transferredIn !== 'function') ok('worker-agent exports transferredIn', false, 'missing');
else {
  const receipt = { from: PROVIDER, logs: [
    { address: '0x55d398326f99059ff775485246999027b3197955', topics: [TRANSFER, topic(PROVIDER), topic(INCOME)], data: '0x' + (5n * 10n ** 18n).toString(16) },
    { address: USD1, topics: [TRANSFER, topic(MANDATE), topic(INCOME)], data: '0x' + (10n ** 17n).toString(16) },
  ] };
  const r = transferredIn(receipt, USD1, INCOME);
  ok('the payer is the sender of the USD1 transfer, not of the transaction', r.payer === MANDATE, r.payer);
  ok('and only that coin is counted', r.paid === 10n ** 17n, String(r.paid));
  ok('a receipt without a transfer to us names no payer', transferredIn({ from: PROVIDER, logs: [] }, USD1, INCOME).payer === null);
}

console.log('\nlive: Mandate\'s paid call of 19.10. 04:39 UTC (lp_tier_plan)');
const RPCS = ['https://bsc-dataseed1.defibit.io', 'https://bsc-mainnet.public.blastapi.io', 'https://bsc-dataseed.binance.org'];
async function receiptOf(tx) {
  for (const u of RPCS) {
    try {
      const j = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [tx] }), signal: AbortSignal.timeout(10000) })).json();
      if (j.result) return j.result;
    } catch { /* next */ }
  }
  return null;
}
{
  const rc = await receiptOf('0xf4884898a338e14bdaef3d1613cda3ad524c138c762bec64f7c9e18b359b3324');
  ok('the receipt is read', !!rc);
  if (rc && typeof transferredIn === 'function') {
    ok('the transaction was sent by our provider wallet', rc.from.toLowerCase() === PROVIDER, rc.from);
    const r = transferredIn(rc, USD1, INCOME);
    ok('the payer read from it is Mandate', r.payer === MANDATE, r.payer);
    ok('0.10 USD1 paid', r.paid === 10n ** 17n, String(r.paid));
  }
}

console.log(fails ? `\n${fails} FAILED` : '\npayment-payer: all pins hold');
process.exit(fails ? 1 : 0);
