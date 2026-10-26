#!/usr/bin/env node
// THE CHECKUP WHERE BUILDERS LOOK (2026-10-26, operator: "weg 1 an einem testen"). Of 12 notices the Brain Board sent by
// A2A, none was read: the agents on BNB Chain take tasks, not mail. Their builders look at their agent on 8004scan and the
// marketplaces, which read the ERC-8004 ReputationRegistry. This writes ONE checkup there, for ONE agent the board already
// told, as a measurement anyone can repeat:
//   tag1 "checkup", tag2 "brain-board", value = the share of the checkup's checks that read ok, in percent (0 decimals);
//   feedbackURI = the checkup frozen as exact bytes on agent.brainonbnb.com/board/evidence/<keccak>.json, feedbackHash = that
//   keccak — "here is what was read, when, and each fix", not a taste score (scripts/lib/erc8004-reputation.mjs' rule).
// Sent by the provider wallet (AGENT_PROVIDER_PRIVATE_KEY, which wrote our responseTime feedback before). Refuses: an agent
// of ours (the contract would too), an agent the board never told, a second checkup for the same agent (data/board-feedback.json),
// a checkup that did not read, evidence that does not come back byte-identical. revoke: scripts/revoke-own-feedback.mjs.
//   node scripts/board-feedback.mjs <agent id>             dry run: reads the checkup, prints the evidence and the call
//   node scripts/board-feedback.mjs <agent id> --confirm   publishes the evidence, checks it, sends, reads it back
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, keccak256, toBytes, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { REPUTATION, REPUTATION_ABI, isOurAgent } from './lib/erc8004-reputation.mjs';
import { agentCheckup, a2aUrlOf } from '../worker-agent/board-checkup.js';

const ROOT = path.resolve(import.meta.dirname, '..'), LOG = path.join(ROOT, 'data', 'board-feedback.json');
const id = String(process.argv[2] || '').replace(/\D/g, ''), confirm = process.argv.includes('--confirm');
if (!id) { console.error('usage: node scripts/board-feedback.mjs <agent id> [--confirm]'); process.exit(1); }
const H = (process.env.HIT_SECRET || '').trim();
const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : {};
if (log[id]) { console.error(`#${id} has its checkup on the chain already: ${log[id].tx}`); process.exit(1); }

const key = (process.env.AGENT_PROVIDER_PRIVATE_KEY || '').trim();
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const rpc = http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org');
const pub = createPublicClient({ chain: bsc, transport: rpc });
if (await isOurAgent(pub, account.address, BigInt(id))) { console.error(`#${id} is ours — no checkup feedback on our own`); process.exit(1); }

// the board told it (its thread), from the operator's outreach status
const st = await fetch('https://agent.brainonbnb.com/board/outreach', { headers: { 'x-hit-secret': H } }).then((r) => r.json()).catch(() => null);
const thread = await (async () => { const ts = await fetch(`https://agent.brainonbnb.com/board?to=${id}&limit=50`).then((r) => r.json()).catch(() => null);
  return (ts?.threads || []).find((t) => /^Checkup for /.test(t.title))?.id || null; })();
if (!st?.told || !thread) { console.error(`#${id}: no checkup thread of the board found — tell it first`); process.exit(1); }

const c = await agentCheckup(id, { keyed: process.env.BSC_RPC_KEYED_URL_2 });
if (!c || c.exists === false) { console.error(`#${id}: the checkup did not read`); process.exit(1); }
const graded = c.checks.filter((x) => x.ok === true || x.ok === false), ok = graded.filter((x) => x.ok === true).length;
const value = Math.round((ok / graded.length) * 100);
const evidence = JSON.stringify({
  what: 'Brain Board checkup of an ERC-8004 agent on BNB Chain: what explorers and marketplaces read, each check with its fix',
  agent: Number(id), name: c.name || null, read_at: new Date().toISOString(), score: c.score, value_percent: value,
  method: 'https://agent.brainonbnb.com/board/how — the checks are re-run free at https://agent.brainonbnb.com/board/agent/' + id,
  checks: c.checks.map((x) => ({ check: x.check, ok: x.ok, detail: x.detail, ...(x.fix ? { fix: x.fix } : {}) })),
  thread: `https://agent.brainonbnb.com/board/thread/${thread}.md`, recheck: `https://agent.brainonbnb.com/board/recheck/${id}`,
  by: 'Brain Board, ERC-8004 #391841 (run by Brain On BNB AI)',
}, null, 2);
const hash = keccak256(toBytes(evidence)), endpoint = (await a2aUrlOf(id, {}).catch(() => null)) || '';
console.log(`#${id} ${c.name} — checkup ${c.score} → value ${value} (${ok} of ${graded.length} graded checks ok)`);
console.log(`giveFeedback(${id}, ${value}, 0, "checkup", "brain-board", "${endpoint}", <evidence url>, ${hash})`);
console.log(`thread #${thread} · sender ${account.address} (${formatEther(await pub.getBalance({ address: account.address }))} BNB)`);
if (!confirm) { console.log('\nDRY RUN — nothing published, nothing sent. Add --confirm.'); process.exit(0); }

const put = await fetch('https://agent.brainonbnb.com/board/evidence', { method: 'POST', headers: { 'x-hit-secret': H, 'content-type': 'application/json' }, body: evidence }).then((r) => r.json());
if (!put.ok || put.hash !== hash) { console.error('evidence not stored as sent', put); process.exit(1); }
const back = await fetch(put.url).then((r) => r.text());
if (keccak256(toBytes(back)) !== hash) { console.error('evidence does not come back byte-identical'); process.exit(1); }
console.log(`evidence live and byte-identical: ${put.url}`);

const wallet = createWalletClient({ account, chain: bsc, transport: rpc });
const args = [BigInt(id), BigInt(value), 0, 'checkup', 'brain-board', endpoint, put.url, hash];
const gas = await pub.estimateContractGas({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'giveFeedback', args, account: account.address });
const tx = await wallet.writeContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'giveFeedback', args, gas: (gas * 12n) / 10n });
const rec = await pub.waitForTransactionReceipt({ hash: tx });
const index = await pub.readContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getLastIndex', args: [BigInt(id), account.address] });
const read = await pub.readContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'readFeedback', args: [BigInt(id), account.address, index] });
console.log(`${rec.status} ${tx}\nreads back as index ${index}: ${read[0]} (${read[1]} dec) ${read[2]}/${read[3]}${read[4] ? ' REVOKED' : ''}`);
log[id] = { tx, index: Number(index), value, evidence: put.url, hash, thread, at: new Date().toISOString() };
fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
