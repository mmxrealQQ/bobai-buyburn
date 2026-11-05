#!/usr/bin/env node
// scripts/holder-pass-regressions.mjs — the $BOBAI holder pass, offline (2026-10-16)
//
// worker-agent/holder-pass.js lets a wallet holding 1,000,000 $BOBAI use the paid answers and the pool watch without
// paying, by a signature. None of our wallets with a local key holds the line, so the accepting path cannot be shown
// live; it is shown here with the real module, real signatures (viem) and a chain read that returns the balance asked
// for. Every refusal is pinned too, and each pin is checked against a proof that differs in exactly that one thing.
//
//   node scripts/holder-pass-regressions.mjs      exit 1 on any FAIL
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { useHolderPass, passMessage, isHolderProof, holderWalletOf, passKind, HOLDER_PASS } from '../worker-agent/holder-pass.js';

let pass = 0, fail = 0;
const is = (what, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };

const kv = () => { const m = new Map(); return { AGENT: { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } } }; };
const rpcWith = (wei) => async (method, params) => {
  if (method !== 'eth_call' || params[0].to !== HOLDER_PASS.bobai) throw new Error('unexpected call');
  return '0x' + wei.toString(16).padStart(64, '0');
};
const acct = privateKeyToAccount(generatePrivateKey()), other = privateKeyToAccount(generatePrivateKey());
const wallet = acct.address.toLowerCase();
const now = Date.parse('2026-10-16T12:00:00.000Z');
const proofOf = async (signer, w, issued) => `bobai-holder ${w} ${issued} ${await signer.signMessage({ message: passMessage(w, issued) })}`;
const fresh = new Date(now - 60e3).toISOString();
const good = await proofOf(acct, wallet, fresh);
const LINE = HOLDER_PASS.line;

{
  const env = kv();
  const r = await useHolderPass(env, rpcWith(LINE), good, 'answer:grid_plan', now);
  is('a wallet at the line, signing for itself, is let through', r.ok && r.wallet === wallet && r.used === 1 && r.of === HOLDER_PASS.allowance.answer, JSON.stringify(r).slice(0, 120));
  for (let i = 1; i < HOLDER_PASS.allowance.answer; i++) await useHolderPass(env, rpcWith(LINE), good, 'answer:grid_plan', now);
  const over = await useHolderPass(env, rpcWith(LINE), good, 'answer:yield_plan', now);
  is(`answer ${HOLDER_PASS.allowance.answer + 1} the same day is refused (allowance_used)`, !over.ok && over.body.code === 'allowance_used');
  const w1 = await useHolderPass(env, rpcWith(LINE), good, 'watch', now);
  is('the watch allowance is its own count', w1.ok && w1.kind === 'watch' && w1.used === 1);
  await useHolderPass(env, rpcWith(LINE), good, 'watch', now);
  const w3 = await useHolderPass(env, rpcWith(LINE), good, 'watch', now);
  is(`watch ${HOLDER_PASS.allowance.watch + 1} the same day is refused`, !w3.ok && w3.body.code === 'allowance_used');
  const next = await useHolderPass(env, rpcWith(LINE), await proofOf(acct, wallet, new Date(now + 86400e3 - 60e3).toISOString()), 'answer:grid_plan', now + 86400e3);
  is('the next UTC day the allowance is new', next.ok && next.used === 1);
}
{
  const r = await useHolderPass(kv(), rpcWith(LINE - 1n), good, 'answer:grid_plan', now);
  is('one wei under the line is refused (below_line)', !r.ok && r.body.code === 'below_line');
  const ok = await useHolderPass(kv(), rpcWith(LINE), good, 'answer:grid_plan', now);
  is('…and exactly the line is not', ok.ok);
}
{
  const forged = `bobai-holder ${wallet} ${fresh} ${await other.signMessage({ message: passMessage(wallet, fresh) })}`;
  const r = await useHolderPass(kv(), rpcWith(LINE * 10n), forged, 'answer:grid_plan', now);
  is('a signature from another wallet naming this one is refused (wrong_signer)', !r.ok && r.body.code === 'wrong_signer');
  const otherIssued = new Date(now - 30e3).toISOString();
  const swapped = `bobai-holder ${wallet} ${otherIssued} ${good.split(' ')[3]}`;
  const r2 = await useHolderPass(kv(), rpcWith(LINE), swapped, 'answer:grid_plan', now);
  is('a signature reused with another issued time is refused', !r2.ok && r2.body.code === 'wrong_signer');
}
{
  const old = new Date(now - 11 * 60e3).toISOString();
  const r = await useHolderPass(kv(), rpcWith(LINE), await proofOf(acct, wallet, old), 'answer:grid_plan', now);
  is('a proof signed 11 minutes ago is refused (stale_proof)', !r.ok && r.body.code === 'stale_proof');
  const nine = new Date(now - 9 * 60e3).toISOString();
  is('…one signed 9 minutes ago is not', (await useHolderPass(kv(), rpcWith(LINE), await proofOf(acct, wallet, nine), 'answer:grid_plan', now)).ok);
  const ahead = new Date(now + 5 * 60e3).toISOString();
  const r3 = await useHolderPass(kv(), rpcWith(LINE), await proofOf(acct, wallet, ahead), 'answer:grid_plan', now);
  is('a proof dated 5 minutes ahead is refused', !r3.ok && r3.body.code === 'stale_proof');
}
{
  const r = await useHolderPass(kv(), rpcWith(LINE), good, 'tip', now);
  is('a tip takes no holder pass (not_for_this)', !r.ok && r.body.code === 'not_for_this');
  const r2 = await useHolderPass(kv(), rpcWith(LINE), good.replace(/ 0x[0-9a-f]{130}$/i, ' 0x1234'), 'answer:grid_plan', now);
  is('a malformed proof is refused before any read (bad_proof)', !r2.ok && r2.body.code === 'bad_proof');
  const r3 = await useHolderPass(kv(), async () => { throw new Error('node down'); }, good, 'answer:grid_plan', now);
  is('a balance that cannot be read is 503, not a refusal or a pass', !r3.ok && r3.status === 503);
  is('every refusal carries the terms', !!(await useHolderPass(kv(), rpcWith(0n), good, 'answer:grid_plan', now)).body.holder_pass?.how);
}
is('isHolderProof tells the pass from a transaction hash and an x402 payload', isHolderProof(good) && !isHolderProof('0x' + 'ab'.repeat(32)) && !isHolderProof('eyJ4NDAy'));
is('holderWalletOf reads the named wallet in lower case', holderWalletOf(good.replace(wallet, acct.address)) === wallet && holderWalletOf('0xabc') === null);
is('passKind: answers and the watch, nothing else', passKind('answer:grid_plan') === 'answer' && passKind('watch') === 'watch' && passKind('tip') === null);

// THE LAST BYTE (2026-11-05): wallets that write v as 0/1 or EIP-155 style (147/148 on BNB Chain) are read; a forger still is not
{
  const fresh = new Date(now - 30e3).toISOString();
  const sig = await acct.signMessage({ message: passMessage(wallet, fresh) });
  const v = parseInt(sig.slice(-2), 16) - 27;
  for (const nv of [v, v + 147, v + 37]) {
    const r = await useHolderPass(kv(), rpcWith(LINE), `bobai-holder ${wallet} ${fresh} ${sig.slice(0, -2)}${nv.toString(16).padStart(2, '0')}`, 'answer:grid_plan', now);
    is(`a signature with v = ${nv} is read and accepted`, r.ok === true, JSON.stringify(r.body || {}).slice(0, 120));
  }
  const osig = await other.signMessage({ message: passMessage(wallet, fresh) });
  const ov = parseInt(osig.slice(-2), 16) - 27 + 147;
  const r = await useHolderPass(kv(), rpcWith(LINE), `bobai-holder ${wallet} ${fresh} ${osig.slice(0, -2)}${ov.toString(16)}`, 'answer:grid_plan', now);
  is('… a forged one with v = 147/148 is still refused (wrong_signer)', r.ok === false && r.body?.code === 'wrong_signer');
}

console.log(`holder-pass: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
