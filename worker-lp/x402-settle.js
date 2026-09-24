// The x402 Permit2 queue, settled from the x402 income wallet (2026-09-24,
// A8 of the review; the operator's go, route 2).
//
// worker-agent checks a standard x402 payment against our terms, simulates
// its settle, delivers the answer and queues the payment under
// x402:settle:<id> (shared/x402-permit2.js). Every firing of this worker's
// cron settles what waits: the same checks again, the settle simulated from
// this wallet, sent, and counted only when the receipt shows the USDC
// arriving at the x402 wallet. The call is the proxy's settle and nothing
// else — the calldata is built from the authorization the payer signed, the
// destination is the fixed proxy address, the wallet pays only gas.
//
// States: pending -> sent (a transaction is out, no receipt yet) -> settled,
// or failed (the payer's funds or allowance were gone, or the authorization
// expired). A failed one sets its earnings record to zero, so /stats never
// counts money that did not arrive.
import { createPublicClient, createWalletClient, http, fallback } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { permit2Mismatch, settleCalldata, transferredIn, PERMIT2_PROXY, QUEUE_PREFIX } from '../shared/x402-permit2.js';

export const X402_WALLET = '0x690e950214980bc329823a2db2fd90c06bd54de4';
const MAX_ATTEMPTS = 3;

async function markEarn(env, id, patch) {
  const raw = await env.AGENT.get(`earn:${id}`);
  if (!raw) return;
  try { await env.AGENT.put(`earn:${id}`, JSON.stringify({ ...JSON.parse(raw), ...patch })); } catch { /* the record stays as it was */ }
}

// `expectWallet`: only the fork test names another (a throwaway key on 127.0.0.1).
export async function settleX402Queue(env, rpcs, { expectWallet = X402_WALLET } = {}) {
  const key = env.X402_PRIVATE_KEY;
  if (!key) return { settled: 0, why: 'X402_PRIVATE_KEY is not set on this worker' };
  const acct = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  if (acct.address.toLowerCase() !== String(expectWallet).toLowerCase()) return { settled: 0, why: 'X402_PRIVATE_KEY does not open the x402 wallet' };

  const list = await env.AGENT.list({ prefix: QUEUE_PREFIX, limit: 20 });
  if (!list.keys.length) return { settled: 0, waiting: 0 };
  const transport = fallback(rpcs.map((u) => http(u, { timeout: 15000 })));
  const pub = createPublicClient({ chain: bsc, transport });
  const wallet = createWalletClient({ account: acct, chain: bsc, transport });
  const out = [];
  // Expiry is the chain's to decide: its clock, not this worker's.
  const chainNow = Number((await pub.getBlock()).timestamp);

  for (const k of list.keys) {
    const raw = await env.AGENT.get(k.name);
    if (!raw) continue;
    let rec; try { rec = JSON.parse(raw); } catch { continue; }
    const id = k.name.slice(QUEUE_PREFIX.length);
    const save = (patch) => env.AGENT.put(k.name, JSON.stringify({ ...rec, ...patch }), { expirationTtl: 14 * 86400 });
    const a = rec.payload && rec.payload.permit2Authorization;
    if (!a || rec.state === 'settled' || rec.state === 'failed') continue;

    // A transaction already out: only its receipt decides.
    if (rec.state === 'sent' && rec.tx) {
      const r = await pub.getTransactionReceipt({ hash: rec.tx }).catch(() => null);
      if (!r) { out.push({ id, state: 'sent', tx: rec.tx }); continue; }
      const got = transferredIn(r.logs, a.permitted.token, a.from, a.witness.to);
      const ok = r.status === 'success' && got >= BigInt(rec.req.amount ?? rec.req.maxAmountRequired);
      await save({ state: ok ? 'settled' : 'failed', settled_at: Date.now(), ...(ok ? {} : { reason: 'the settlement landed without the payment' }) });
      await markEarn(env, id, ok ? { settle: 'settled', settle_tx: rec.tx } : { settle: 'failed', settle_tx: rec.tx, amount: '0' });
      out.push({ id, state: ok ? 'settled' : 'failed', tx: rec.tx });
      continue;
    }

    // The same reading as at the door, now with no minimum life: expired is failed.
    const bad = permit2Mismatch(rec.payload, rec.req, { minLifeSec: 0, nowSec: chainNow });
    const attempts = Number(rec.attempts || 0) + 1;
    const fail = async (reason) => {
      await save({ state: 'failed', reason, attempts, failed_at: Date.now() });
      await markEarn(env, id, { settle: 'failed', reason, amount: '0' });
      out.push({ id, state: 'failed', reason });
    };
    if (bad) { await fail(bad); continue; }
    const data = settleCalldata(rec.payload);
    try { await pub.call({ account: acct.address, to: PERMIT2_PROXY, data }); }
    catch (e) {
      const reason = 'would not settle: ' + String(e.shortMessage || e.message || e).split('\n')[0].slice(0, 160);
      if (attempts >= MAX_ATTEMPTS) await fail(reason);
      else { await save({ attempts, last_error: reason }); out.push({ id, state: 'pending', reason, attempts }); }
      continue;
    }
    let hash;
    try {
      const gasPrice = await pub.getGasPrice();
      hash = await wallet.sendTransaction({ to: PERMIT2_PROXY, data, gasPrice });
    } catch (e) {
      await save({ attempts, last_error: 'send: ' + String(e.shortMessage || e.message || e).split('\n')[0].slice(0, 160) });
      out.push({ id, state: 'pending', attempts });
      continue;
    }
    // Written before the wait: a run cut off here leaves 'sent' with its hash,
    // and the next run reads the receipt instead of sending twice.
    await save({ state: 'sent', tx: hash, attempts, sent_at: Date.now() });
    rec = { ...rec, state: 'sent', tx: hash, attempts };
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 45000 }).catch(() => null);
    if (!r) { out.push({ id, state: 'sent', tx: hash }); continue; }
    const got = transferredIn(r.logs, a.permitted.token, a.from, a.witness.to);
    const ok = r.status === 'success' && got >= BigInt(rec.req.amount ?? rec.req.maxAmountRequired);
    await save({ state: ok ? 'settled' : 'failed', settled_at: Date.now(), ...(ok ? {} : { reason: 'the settlement landed without the payment' }) });
    await markEarn(env, id, ok ? { settle: 'settled', settle_tx: hash } : { settle: 'failed', settle_tx: hash, amount: '0' });
    out.push({ id, state: ok ? 'settled' : 'failed', tx: hash });
  }
  return { settled: out.filter((x) => x.state === 'settled').length, results: out };
}
