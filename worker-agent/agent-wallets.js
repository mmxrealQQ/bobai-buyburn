// worker-agent/agent-wallets.js — which of our keys speaks for which agent (2026-10-21)
//
// Operator, 21.10.: the Venus health factor monitor (#302257) and the Venus yield ranking (#304493) are to act on
// Venus from wallets of their own (Backup 1 and Backup 2), so that what they do on the chain is theirs and fits what
// they say. Until then every agent's agentWallet was the provider 0x7380, and this worker knew that one key only.
//
// Nothing here names which wallet belongs to which agent. The ERC-8004 registry does: an agent's quotes are signed
// with the key whose address is that agent's agentWallet on the chain, and a funded job is delivered with the key
// whose address the job names as provider. So the code is right before the agentWallet moves and after it, and the
// move itself is one transaction on the registry. A job funded to 0x7380 while the move happens is still delivered.
//
// The keys this worker may hold. Each one signs only quotes, submit() and, for the two Venus agents, their own work.

import { privateKeyToAccount } from 'viem/accounts';

export const KEY_NAMES = ['AGENT_PROVIDER_PRIVATE_KEY', 'BACKUP1_PRIVATE_KEY', 'BACKUP2_PRIVATE_KEY'];

// Slug -> ERC-8004 token id, the same six as the cards (index.js OWN_CARDS + the DeFi agent).
export const AGENT_ID_OF = {
  'defi-agent': 363709,
  'health-factor': 302257,
  'grid-trader': 302258,
  'yield-optimizer': 304493,
  rebalancer: 304494,
  'lp-placement': 310460,
};

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];
const TTL = 10 * 60 * 1000;
const walletCache = new Map();   // id -> { wallet, at }

const accountOf = (raw) => {
  const key = String(raw || '').trim();
  const hex = key.startsWith('0x') ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  try { return privateKeyToAccount(hex); } catch { return null; }
};

// Every key of ours this worker holds, the provider first.
export function ourAccounts(env) {
  const out = [];
  for (const name of KEY_NAMES) { const a = accountOf(env?.[name]); if (a && !out.some((x) => x.address === a.address)) out.push(a); }
  return out;
}

// The key whose address this is, or null when it is nobody's we hold.
export function accountFor(env, address) {
  const want = String(address || '').toLowerCase();
  return ourAccounts(env).find((a) => a.address.toLowerCase() === want) || null;
}

async function rpcCall(to, data) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }), signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j.result && j.result.length >= 66) return j.result;
      last = new Error(j.error?.message || 'empty answer');
    } catch (e) { last = e; }
  }
  throw last || new Error('no RPC answered');
}

// getAgentWallet(uint256) on the identity registry, ten minutes' cache. An unreadable registry falls back to the last
// answer read; with none, null (the caller decides what that means).
export async function agentWalletOf(id, { read = rpcCall, now = Date.now() } = {}) {
  const hit = walletCache.get(id);
  if (hit && now - hit.at < TTL) return hit.wallet;
  try {
    const word = await read(REGISTRY, '0x00339509' + BigInt(id).toString(16).padStart(64, '0'));
    const wallet = '0x' + word.slice(26, 66);
    if (!/^0x[0-9a-f]{40}$/.test(wallet) || /^0x0{40}$/.test(wallet)) throw new Error('no agentWallet set');
    walletCache.set(id, { wallet, at: now });
    return wallet;
  } catch { return hit ? hit.wallet : null; }
}

// The key that speaks for an agent: the one whose address is its agentWallet. { account, wallet } on success,
// { account: null, wallet, reason } when the registry names a wallet this worker does not hold (nothing is quoted —
// a quote from another key is refused by every SDK buyer, and a flat quote would send a buyer's money to an address
// that cannot deliver). An unreadable registry falls back to the provider key: a buyer checks the quote against the
// registry itself, and a job funded to the provider is always delivered.
export async function accountForAgent(env, slug, opts = {}) {
  const id = AGENT_ID_OF[slug];
  const fallback = accountOf(env?.AGENT_PROVIDER_PRIVATE_KEY);
  if (!id) return { account: fallback, wallet: fallback?.address || null };
  const wallet = await agentWalletOf(id, opts);
  if (!wallet) return { account: fallback, wallet: fallback?.address || null, unread: true };
  const account = accountFor(env, wallet);
  if (!account) return { account: null, wallet, reason: `the agentWallet of #${id} is ${wallet}, a key this worker does not hold — nothing is quoted` };
  return { account, wallet };
}

export const _clearWalletCache = () => walletCache.clear();
