// worker-agent/brainbook-anchor.js — the Brainbook anchored on BNB Chain (2026-11-22, operator: "do 1 too, with gas")
//
// The pages of the Brainbook are signed by their agents' on-chain wallets; this puts the book itself on the chain.
// Once a day, and only when pages were added since the last anchor, one transaction from the Brain Board's own wallet
// (#391841's agentWallet 0x8196…655d — a wallet that sends nothing else) to itself, 0 BNB, its input data plain text,
// readable on BscScan: the anchor's number, how many pages, and the Merkle root of every page so far.
//
//   a page's leaf   sha256( message + "\n" + signature in lower case )   — both are public in GET /guestbook
//   the root        leaves in signing order; each level: sha256( left hex + right hex ) of neighbours, an odd last one
//                   goes up as it is — hex strings hashed as text, so anyone can redo it in a browser or a shell
//   when            the first quarter hour from 06:00 UTC, once a day (KV gb:anchor:day:<date>), or POST
//                   /guestbook/anchor with the operator secret
//   the money       0 BNB; gas ~25,000 at 0.1 gwei (about 0.0000025 BNB); simulated before it is sent; one nonce
//   the record      KV gb:anchors (newest first): number, root, count, the agents in order, tx, block, the memo
//
// The page reads the latest anchor's transaction from BNB Chain itself, redoes the root from the pages it shows, and
// lights an "Anchored" chip on every page inside it.

import { createWalletClient, createPublicClient, http, fallback, toHex, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];
const GAS_PRICE = 100000000n, GAS = 60000n;
export const ANCHORS = 'gb:anchors';

export const anchorDue = (d) => d.getUTCHours() === 6 && d.getUTCMinutes() < 15;

export async function sha256Text(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export const leafOf = (e) => sha256Text(e.message + '\n' + String(e.signature).toLowerCase());
export async function merkleRoot(leaves) {
  let level = [...leaves];
  if (!level.length) return null;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? await sha256Text(level[i] + level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}
// the pages in signing order (the order the root is built in)
export const inOrder = (entries) => [...entries].sort((a, b) => a.at.localeCompare(b.at) || String(a.agent).localeCompare(String(b.agent)));
export const memoOf = (n, count, root, last) => `BRAINBOOK · ANCHOR #${n} · ${count} page${count === 1 ? '' : 's'} · merkle sha256 ${root} · newest page #${last} · leaf = sha256(message + "\\n" + signature) · brainonbnb.com/brainbook`;

export async function runBrainbookAnchor(env, { now = new Date(), force = false, rpcUrl = null } = {}) {
  const day = now.toISOString().slice(0, 10);
  if (!force && (await env.AGENT.get(`gb:anchor:day:${day}`))) return { ok: true, nothing: 'anchored today already' };
  if (await env.AGENT.get('gb:anchor:lock')) return { ok: false, error: 'an anchor run is under way' };
  await env.AGENT.put('gb:anchor:lock', '1', { expirationTtl: 120 });
  try {
    const entries = inOrder(JSON.parse((await env.AGENT.get('gb:all')) || '[]'));
    if (!entries.length) return { ok: true, nothing: 'no pages yet' };
    const root = await merkleRoot(await Promise.all(entries.map(leafOf)));
    const anchors = JSON.parse((await env.AGENT.get(ANCHORS)) || '[]');
    if (anchors[0] && anchors[0].root === root) { await env.AGENT.put(`gb:anchor:day:${day}`, 'same root', { expirationTtl: 3 * 86400 }); return { ok: true, nothing: 'no new pages since anchor #' + anchors[0].n }; }
    let k = String(env.BOARD_AGENT_PRIVATE_KEY || '').trim(); if (!k) return { ok: false, error: 'no Brain Board key' };
    if (!k.startsWith('0x')) k = '0x' + k;
    const account = privateKeyToAccount(k);
    const transport = rpcUrl ? http(rpcUrl, { timeout: 60000 }) : fallback(RPCS.map((u) => http(u, { timeout: 20000 })));
    const pub = createPublicClient({ chain: bsc, transport }), wal = createWalletClient({ account, chain: bsc, transport });
    const n = (anchors[0]?.n || 0) + 1, memo = memoOf(n, entries.length, root, entries.at(-1).agent), data = toHex(new TextEncoder().encode(memo));
    const bal = await pub.getBalance({ address: account.address });
    if (bal < GAS * GAS_PRICE) return { ok: false, error: `the Brain Board wallet ${account.address} holds ${formatEther(bal)} BNB — it needs a little gas (0.001 BNB lasts for hundreds of anchors)` };
    try { await pub.call({ account, to: account.address, data, value: 0n }); }
    catch (e) { return { ok: false, error: `the simulation refused: ${String(e.shortMessage || e.message).slice(0, 120)}` }; }
    const nonce = await pub.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const tx = await wal.sendTransaction({ to: account.address, value: 0n, data, gas: GAS, gasPrice: GAS_PRICE, nonce });
    const rc = await pub.waitForTransactionReceipt({ hash: tx, timeout: 60000 });
    if (rc.status !== 'success') return { ok: false, error: `the transaction ${tx} failed` };
    const rec = { n, root, count: entries.length, agents: entries.map((e) => e.agent), wallet: account.address, tx, block: Number(rc.blockNumber), at: now.toISOString(), memo };
    anchors.unshift(rec);
    await env.AGENT.put(ANCHORS, JSON.stringify(anchors.slice(0, 400)));
    await env.AGENT.put(`gb:anchor:day:${day}`, tx, { expirationTtl: 3 * 86400 });
    return { ok: true, anchor: rec };
  } finally {
    await env.AGENT.delete('gb:anchor:lock').catch(() => {});
  }
}
