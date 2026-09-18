#!/usr/bin/env node
// One payment buys one answer. The x402 sale's ledger (worker-agent/ledger.js)
// run against a table that behaves like KV, through the race that used to make
// one payment worth any number of answers (2026-09-18): two requests with one
// hash, one of them built to fail, whose failure path deleted the mark of the
// one that delivered. Offline.   node scripts/payment-ledger-check.mjs
import { readPaid, claimPayment, settlePayment, CLAIM_FRESH_MS } from '../worker-agent/ledger.js';

let failed = 0, n = 0;
const ok = (label, pass) => { n++; if (!pass) failed++; console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}`); };
const kv = () => { const m = new Map(); return { AGENT: { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }, m }; };
const TX = '0x' + 'ab'.repeat(32);

{
  const env = kv();
  const a = await claimPayment(env, TX, 'answer:health_factor');
  const b = await claimPayment(env, TX, 'answer:health_factor');
  ok('the first request claims the payment, a second one with the same hash is refused while the claim is fresh', a.ok === true && b.ok === false && /another request/.test(b.reason));
  // B is the request built to fail: it never held the claim, so nothing it does frees the hash.
  ok('a request that does not hold the claim cannot turn it into a credit', (await settlePayment(env, TX, 'not-the-nonce', 'credit')) === false && (await readPaid(env, TX)).state === 'claimed');
  ok('the holder delivers, and the payment is final', (await settlePayment(env, TX, a.by, 'delivered')) === true && (await readPaid(env, TX)).state === 'delivered');
  const c = await claimPayment(env, TX, 'answer:yield_plan');
  ok('a delivered payment buys nothing again — on any service', c.ok === false && /already been used/.test(c.reason));
}
{
  const env = kv();
  const a = await claimPayment(env, TX, 'answer:grid_plan');
  await settlePayment(env, TX, a.by, 'credit', { failed: 'no address given' });
  ok('an answer that failed leaves a credit, not a free hash', (await readPaid(env, TX)).state === 'credit');
  const again = await claimPayment(env, TX, 'answer:grid_plan');
  ok('the buyer spends the credit with the same hash, once', again.ok === true && again.credit === true && (await claimPayment(env, TX, 'x')).ok === false);
  await settlePayment(env, TX, again.by, 'delivered');
  ok('… and then it is used', (await claimPayment(env, TX, 'x')).ok === false);
}
{
  const env = kv();
  await env.AGENT.put(`paid:${TX}`, '1');
  ok('a mark written before the ledger ("1") reads as delivered', (await readPaid(env, TX)).state === 'delivered' && (await claimPayment(env, TX, 'x')).ok === false);
  const env2 = kv();
  await env2.AGENT.put(`paid:${TX}`, JSON.stringify({ state: 'claimed', by: 'gone', at: Date.now() - CLAIM_FRESH_MS - 1000 }));
  ok('a claim whose request died is not a lock for ever: it can be taken after the fresh window', (await claimPayment(env2, TX, 'x')).ok === true);
  ok('a payment nobody has seen is unclaimed', (await readPaid(kv(), TX)) === null);
}
{
  // The write-then-read-back: a store that answers with somebody else's claim.
  const env = kv();
  const put = env.AGENT.put;
  env.AGENT.put = async (k, v) => { await put(k, JSON.stringify({ ...JSON.parse(v), by: 'the-other-request' })); };
  ok('a request that does not read its own nonce back lost the race and stops', (await claimPayment(env, TX, 'x')).ok === false);
}
// What a request is FOR, and what it cannot start without — asked before the money is taken.
{
  const { pickService, missingInput, extractParams } = await import('../worker-agent/sell.js');
  ok('a question about one position is the position plan, not a fee-tier comparison', pickService('my LP position 7451444')?.id === 'lp_position_plan' && pickService('is position #7451444 out of range')?.id === 'lp_position_plan');
  ok('… and "where should I LP" is still the tier plan', pickService('where should I LP with CAKE')?.id === 'lp_tier_plan' && pickService('which fee tier pays')?.id === 'lp_tier_plan');
  ok('a word that merely contains "lp" belongs to nobody (the word boundary that was a backspace byte)', pickService('help me with alpha') === null);
  ok('an answer that cannot start is refused before the payment is looked at', !!missingInput('health_factor', {}) && missingInput('health_factor', { address: '0xd319e1F8e987cf78333cEA853F455366640929cF' }) === null && missingInput('yield_plan', {}) === null && !!missingInput('rebalance_plan', { holdings: [] }) && missingInput('lp_position_plan', extractParams('my LP position 7451444', {})) === null);
}
// A control byte in a source file is a regex that silently stopped matching: a word boundary typed
// through a shell that ate its backslash is the backspace character (three files, 2026-09-18).
{
  const fs = await import('node:fs');
  const root = new URL('..', import.meta.url);
  const dirs = ['worker-agent', 'shared', 'worker-lp', 'worker-tg-bot', 'worker-nft-mint', 'worker-health', 'worker', 'dashboard', 'scripts', 'scripts/lib'];
  const bad = [];
  for (const d of dirs) {
    const dir = new URL(d + '/', root);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/[.](m?js|html|toml)$/.test(f)) continue;
      const buf = fs.readFileSync(new URL(f, dir));
      for (let i = 0; i < buf.length; i++) { const c = buf[i]; if (c < 9 || c === 11 || c === 12 || (c > 13 && c < 32)) { bad.push(`${d}/${f}@${i} (0x${c.toString(16)})`); break; } }
    }
  }
  ok('no source file carries a control byte' + (bad.length ? ` — ${bad.slice(0, 5).join(', ')}` : ''), bad.length === 0);
}
console.log(`\n${n - failed}/${n} checks pass`);
process.exitCode = failed ? 1 : 0;
