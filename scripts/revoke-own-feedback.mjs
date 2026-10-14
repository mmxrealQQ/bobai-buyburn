// Withdraws feedback that one of our own wallets once left on one of our own agents.
//
// WHY (2026-10-14): Mandate marks #302257/#302258 "Reviews look coordinated — the wallets reviewing it mostly review
// nothing else, which is how a review ring looks". One of those reviews is ours: the NFT relayer
// 0xBFB4b49787CE948C1Ee304f6C197a0E8b038ddb2 rated #302258 (responsetime 6000, index 1). An operator rating its own
// agent is the thing ERC-8004 reputation is meant to exclude, whatever the value. revokeFeedback(agentId, index) from
// the wallet that gave it marks it revoked on chain; the record stays readable, flagged isRevoked.
//
// SAFETY — a bare run changes nothing
//   Lists every feedback our wallets gave our agents, and what it would revoke. Sends only with --confirm.
//   Refuses when the key in .env is not the reviewing wallet.
//
//   node scripts/revoke-own-feedback.mjs             # show
//   node scripts/revoke-own-feedback.mjs --confirm   # revoke (one transaction per feedback, from the relayer)
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { REPUTATION, REPUTATION_ABI } from './lib/erc8004-reputation.mjs';

const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';
const OUR_AGENTS = [302257, 302258, 304493, 304494, 310460, 363709, 49467];
const REVIEWER = '0xBFB4b49787CE948C1Ee304f6C197a0E8b038ddb2'; // the NFT relayer
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });

const todo = [];
for (const id of OUR_AGENTS) {
  const clients = await pub.readContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getClients', args: [BigInt(id)] });
  if (!clients.some((c) => c.toLowerCase() === REVIEWER.toLowerCase())) continue;
  const last = await pub.readContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getLastIndex', args: [BigInt(id), REVIEWER] });
  for (let i = 1n; i <= last; i++) {
    const [value, dec, tag1, tag2, revoked] = await pub.readContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'readFeedback', args: [BigInt(id), REVIEWER, i] });
    console.log(`#${id}  index ${i}  ${tag1 || '-'}${tag2 ? '/' + tag2 : ''} = ${Number(value) / 10 ** dec}  ${revoked ? 'already revoked' : 'to revoke'}`);
    if (!revoked) todo.push({ id, index: i });
  }
}
if (!todo.length) { console.log('nothing of ours to revoke'); process.exit(0); }
if (!process.argv.includes('--confirm')) { console.log(`\n${todo.length} to revoke. Re-run with --confirm.`); process.exit(0); }

const key = process.env.NFT_RELAYER_PRIVATE_KEY;
if (!key) { console.error('NFT_RELAYER_PRIVATE_KEY is not set'); process.exit(1); }
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
if (account.address.toLowerCase() !== REVIEWER.toLowerCase()) { console.error(`the key in .env is ${account.address}, not the reviewer ${REVIEWER} — nothing sent`); process.exit(1); }
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
console.log(`signer ${account.address} (${formatEther(await pub.getBalance({ address: account.address }))} BNB)`);
for (const t of todo) {
  const hash = await wallet.writeContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'revokeFeedback', args: [BigInt(t.id), t.index], gasPrice: 100000000n });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`#${t.id} index ${t.index}: ${r.status} https://bscscan.com/tx/${hash}`);
}
