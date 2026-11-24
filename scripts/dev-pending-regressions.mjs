#!/usr/bin/env node
// shared/dev-pending.js — a builder's transfer whose receipt never came (Liste B point 2, 2026-11-24): landed = paid,
// reverted = owed, dropped = owed, still in the pool or a node error = wait and pay nothing. Offline, a fake chain.
import { resolvePending, mayStillLand } from '../shared/dev-pending.js';

let pass = 0, fail = 0;
const say = (ok, t, got) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`); };
const H = (n) => '0x' + String(n).repeat(64).slice(0, 64);
class TransactionReceiptNotFoundError extends Error { constructor() { super('Transaction receipt could not be found'); this.name = 'TransactionReceiptNotFoundError'; } }
class TransactionNotFoundError extends Error { constructor() { super('Transaction could not be found'); this.name = 'TransactionNotFoundError'; } }
const chain = (rcs, txs) => ({
  getTransactionReceipt: async ({ hash }) => { const r = rcs[hash]; if (r === 'err') throw new Error('fetch failed: 503'); if (!r) throw new TransactionReceiptNotFoundError(); return r; },
  getTransaction: async ({ hash }) => { const t = txs[hash]; if (t === 'err') throw new Error('fetch failed: 503'); if (!t) throw new TransactionNotFoundError(); return t; },
});
const A = '0xaaaa', B = '0xbbbb', C = '0xcccc', D = '0xdddd', E = '0xeeee';

const r = await resolvePending(
  { [A]: { hash: H(1), value: '4000' }, [B]: { hash: H(2), value: '4000' }, [C]: { hash: H(3), value: '2000' } },
  { [B]: '1000' },
  chain({ [H(1)]: { status: 'success' }, [H(2)]: { status: 'reverted' } }, {}),
);
say(!r.pending[A] && !r.owed[A], 'landed after the run: paid, nothing owed — the builder is not paid twice', r);
say(r.owed[B] === '5000' && !r.pending[B], 'reverted: its BNB came back, owed on top of what was owed before', r.owed);
say(r.owed[C] === '2000' && !r.pending[C], 'unknown to the chain (dropped): owed', r.owed);
say(r.waiting === false && Object.keys(r.pending).length === 0, 'nothing left pending, the run may go on');

const w = await resolvePending({ [D]: { hash: H(4), value: '4000' } }, {}, chain({}, { [H(4)]: { hash: H(4) } }));
say(w.waiting === true && w.pending[D] && !w.owed[D], 'still in the pool: the run waits, nothing owed, still pending', w);
const e1 = await resolvePending({ [E]: { hash: H(5), value: '4000' } }, {}, chain({ [H(5)]: 'err' }, {}));
const e2 = await resolvePending({ [E]: { hash: H(5), value: '4000' } }, {}, chain({}, { [H(5)]: 'err' }));
say(e1.waiting && e2.waiting && e1.pending[E] && e2.pending[E] && !e1.owed[E] && !e2.owed[E], 'a node that errs is no answer: wait, never owed (the transfer may have landed)', { e1, e2 });
const bad = await resolvePending({ [E]: { hash: 'x', value: '1' } }, {}, chain({}, {}));
say(!bad.pending[E] && !bad.owed[E], 'an unreadable entry is dropped, not paid');
say(mayStillLand(new Error('Builder #3: no receipt for 0xabc — it may still arrive')) && !mayStillLand(new Error('Builder #3: 0xabc reverted')) && !mayStillLand(new Error('insufficient funds')), 'only "no receipt" counts as a transfer that may still land');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
