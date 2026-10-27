#!/usr/bin/env node
// scripts/agent-wallets-regressions.mjs — each agent speaks with the key of its own agentWallet (2026-10-21)
//
// Operator, 21.10.: the Venus health factor monitor (#302257) and the Venus yield ranking (#304493) act from wallets
// of their own (Backup 1, Backup 2). The worker knew one key, the provider 0x7380: with an agentWallet moved, every
// SDK buyer would have refused their quotes (signed by the wrong key), the watcher would have skipped their funded
// jobs and submit() would have refused them. worker-agent/agent-wallets.js picks the key from the registry. Offline,
// with throwaway keys and the registry answered here:
//   - the registry's agentWallet picks the key; one we do not hold quotes nothing; an unreadable registry falls back
//     to the provider (the wallet of all six until a move);
//   - /health-factor/a2a signs its quote with the key the registry names, and the signature recovers to it, while
//     /grid-trader/a2a keeps the provider; the flat quote names the same address; the shared /a2a quotes a health
//     factor plan with the health factor agent's wallet too;
//   - submit() delivers a job named to any key of ours, and refuses a stranger's.
//
//   node scripts/agent-wallets-regressions.mjs       exit 1 on any FAIL
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverMessageAddress } from 'viem';

let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };

const kP = generatePrivateKey(), kB1 = generatePrivateKey(), kB2 = generatePrivateKey();
const P = privateKeyToAccount(kP).address, B1 = privateKeyToAccount(kB1).address, B2 = privateKeyToAccount(kB2).address;
const env = { AGENT_PROVIDER_PRIVATE_KEY: kP, BACKUP1_PRIVATE_KEY: kB1, BACKUP2_PRIVATE_KEY: kB2, AGENT: { get: async () => null, put: async () => {} } };
const STRANGER = '0x1111111111111111111111111111111111111111';

// The registry as this test says it stands: id -> agentWallet. Every other eth_call gets a 7-day word (the dispute window).
let registry = {}, registryUp = true;
const word = (hex) => '0x' + hex.toLowerCase().replace(/^0x/, '').padStart(64, '0');
globalThis.fetch = async (url, init = {}) => {
  let body = {}; try { body = JSON.parse(init.body || '{}'); } catch {}
  const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result }), { headers: { 'content-type': 'application/json' } });
  if (body.method === 'eth_call') {
    const { to, data } = body.params[0];
    if (String(to).toLowerCase() === '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432' && data.startsWith('0x00339509')) {
      if (!registryUp) throw new Error('registry down');
      const w = registry[Number(BigInt('0x' + data.slice(10)))];
      return reply(word(w || '0'));
    }
    return reply(word((604800).toString(16)));
  }
  return reply('0x0');
};

const W = await import('../worker-agent/agent-wallets.js');
const S = await import('../worker-agent/sell.js');
const { submitDeliverable } = await import('../worker-agent/submit.js');
const ask = async (path, data) => {
  const req = new Request('https://agent.brainonbnb.com' + path, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'chk', parts: [{ kind: 'data', data }] } } }) });
  const slug = path.match(/^\/([a-z-]+)\/a2a$/)?.[1];
  const r = await S.handleA2A(req, env, slug ? { agent: slug } : {});
  const j = await r.json();
  return j?.result?.parts?.[0]?.data || j?.result?.parts?.[0]?.text || j;
};
const SIGNED = (task) => ({ skill: 'negotiate-erc8183-job', task_description: task, terms: { deliverables: 'plan', quality_standards: 'on-chain' } });
const HF_TASK = 'health factor of 0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A on Venus';

// --- the choice itself
{
  registry = { 302257: P, 302258: P, 304493: P };
  W._clearWalletCache();
  const a = await W.accountForAgent(env, 'health-factor');
  check(a.account?.address === P, 'while the registry names the provider, the provider speaks for the health factor agent', a.account?.address);
  registry = { 302257: B1, 302258: P, 304493: B2 };
  W._clearWalletCache();
  const b = await W.accountForAgent(env, 'health-factor'), y = await W.accountForAgent(env, 'yield-optimizer'), g = await W.accountForAgent(env, 'grid-trader');
  check(b.account?.address === B1 && y.account?.address === B2 && g.account?.address === P, 'once moved, Backup 1 speaks for #302257, Backup 2 for #304493, the provider still for the grid planner', `${b.account?.address?.slice(0, 8)} ${y.account?.address?.slice(0, 8)} ${g.account?.address?.slice(0, 8)}`);
  registry = { 302257: STRANGER };
  W._clearWalletCache();
  const s = await W.accountForAgent(env, 'health-factor');
  check(s.account === null && /does not hold/.test(s.reason || ''), 'an agentWallet we hold no key for: nothing speaks for it, and it says why', s.reason || '');
  registry = { 302257: B1 };
  W._clearWalletCache();
  await W.accountForAgent(env, 'health-factor');
  registryUp = false;
  const cached = await W.accountForAgent(env, 'health-factor', { now: Date.now() + 11 * 60e3 });
  W._clearWalletCache();
  const cold = await W.accountForAgent(env, 'health-factor');
  registryUp = true;
  check(cached.account?.address === B1 && cold.account?.address === P && cold.unread, 'an unreadable registry keeps the last answer read; with none, the provider', `${cached.account?.address?.slice(0, 8)} / ${cold.account?.address?.slice(0, 8)}`);
  // a cleared agentWallet (the NFT moved, 2026-10-27) is an answer: after the cache it reads null, not the old wallet;
  // the other way, an unreadable registry still keeps the old one (above)
  registry = { 302257: B1 };
  W._clearWalletCache();
  await W.agentWalletOf(302257);
  registry = {};
  const cleared = await W.agentWalletOf(302257, { now: Date.now() + 11 * 60e3 });
  registry = { 302257: B1 };
  check(cleared === null, 'a cleared agentWallet (0x0) reads null once the cache is old, not the wallet read before it', String(cleared));
  W._clearWalletCache();
  check(W.accountFor(env, B2.toLowerCase())?.address === B2 && W.accountFor(env, STRANGER) === null, 'a job\'s provider picks the key of that address, a stranger\'s none');
}

// --- the quotes, through the A2A endpoints
{
  registry = { 302257: B1, 302258: P, 304493: B2, 363709: P };
  W._clearWalletCache();
  const q = await ask('/health-factor/a2a', SIGNED(HF_TASK));
  const signer = q?.negotiation_hash ? await recoverMessageAddress({ message: q.negotiation_hash, signature: q.provider_sig }) : null;
  check(q?.provider_address === B1 && signer === B1, 'the health factor agent\'s signed quote names Backup 1 and is signed by it', `${q?.provider_address} / signer ${signer}`);
  const y = await ask('/yield-optimizer/a2a', SIGNED('best stablecoin yield on Venus'));
  check(y?.provider_address === B2, 'the yield agent\'s signed quote names Backup 2', String(y?.provider_address || JSON.stringify(y).slice(0, 100)));
  const g = await ask('/grid-trader/a2a', SIGNED('grid plan for 0x245c386dcfed896f5c346107596141e5edcbffff between 0.0001 and 0.0002, 10 levels, 1000 capital'));
  check(g?.provider_address === P, 'the grid planner\'s quote keeps the provider', String(g?.provider_address || JSON.stringify(g).slice(0, 100)));
  const flat = await ask('/health-factor/a2a', { skill: 'negotiate', task_description: HF_TASK });
  check(flat?.accepted === true && flat.provider === B1 && flat.instructions.includes(B1), 'the flat quote names Backup 1 as the provider to fund', `${flat?.provider}`);
  const shared = await ask('/a2a', { skill: 'negotiate', task_description: HF_TASK, service: 'health_factor' });
  check(shared?.provider === B1, 'the shared /a2a quotes a health factor plan with the health factor agent\'s wallet', `${shared?.provider} (${shared?.service})`);
  registry = { 302257: STRANGER, 302258: P, 304493: B2, 363709: P };
  W._clearWalletCache();
  const none = await ask('/health-factor/a2a', SIGNED(HF_TASK));
  check(none?.accepted === false && !none?.provider_sig, 'an agentWallet we hold no key for: no quote is signed', String(none?.reason || '').slice(0, 90));
}

// --- delivery: by the key the job names
{
  const doc = '{"x":1}';
  const asJob = (provider, status = 'COMPLETED') => async () => ({ provider, status, client: STRANGER, budget: '1' });
  const d1 = await submitDeliverable({ env, jobId: 1, document: doc, readJob: asJob(B1) }).catch((e) => ({ error: e.message }));
  const d0 = await submitDeliverable({ env, jobId: 2, document: doc, readJob: asJob(P) }).catch((e) => ({ error: e.message }));
  check(d1?.already === true && d0?.already === true, 'submit() takes a job named to Backup 1 as ours, as one named to the provider', `${JSON.stringify(d1).slice(0, 60)} | ${JSON.stringify(d0).slice(0, 60)}`);
  const ds = await submitDeliverable({ env, jobId: 3, document: doc, readJob: asJob(STRANGER) }).catch((e) => ({ error: e.message }));
  check(/not us/.test(ds?.error || ''), 'and refuses a job named to a stranger', ds?.error || JSON.stringify(ds));
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
