#!/usr/bin/env node
// THE BRAIN BOARD AS AN ERC-8004 AGENT (2026-10-26, operator: "Board als eigener Agent"). The checkup outreach is to run
// by itself on Cloudflare, signed — a board entry reaches an agent's own endpoint only when a wallet signed it — and
// neither #49467 nor its agentWallet d38 is to change (d38 receives the tax and runs the dev buyback; an escrow hire of
// #49467 pays its agentWallet). So the board gets an identity of its own:
//   1. register      owner d38 (PRIVATE_KEY), its document inline (name, description, image, the A2A card, the web page)
//   2. setAgentWallet the board's own key (BOARD_AGENT_PRIVATE_KEY in .env, made here once) — it signs board entries and
//                    never holds anything: signing costs nothing, d38 pays the three transactions (a few cents)
//   3. setAgentURI   the same document with "registrations" naming its own id (8004scan counts it toward completeness)
// Each step runs once (data/board-agent.json); a bare run sends nothing and prints the plan with the gas.
//   node scripts/register-board-agent.mjs             plan
//   node scripts/register-board-agent.mjs --confirm   send
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, formatEther, parseAbi } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { agentWalletSig, IDENTITY_REGISTRY, SET_AGENT_WALLET_ABI } from './lib/agent-wallet-sig.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'data', 'board-agent.json'), ENV = path.join(ROOT, '.env');
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const CARD = 'https://agent.brainonbnb.com/board/a2a/.well-known/agent-card.json', A2A = 'https://agent.brainonbnb.com/board/a2a';
const D38 = '0x15ba17075ef5e0736292b030e3715d9100fe3d38';
const confirm = process.argv.includes('--confirm');
const ABI = [...parseAbi([
  'function register(string tokenURI, (string key, bytes value)[] metadata) returns (uint256)',
  'function setAgentURI(uint256 agentId, string newURI)',
  'function ownerOf(uint256) view returns (address)',
  'function getAgentWallet(uint256) view returns (address)',
]), ...SET_AGENT_WALLET_ABI];
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');

// the owner: d38, and only d38
let pk = String(process.env.PRIVATE_KEY || '').trim(); if (!pk.startsWith('0x')) pk = '0x' + pk;
const owner = privateKeyToAccount(pk);
if (owner.address.toLowerCase() !== D38) { console.error(`PRIVATE_KEY is ${owner.address}, not d38 — refused`); process.exit(1); }
// the board's own key: made once, kept in .env, its address printed (never the key)
let bk = String(process.env.BOARD_AGENT_PRIVATE_KEY || '').trim();
if (!bk) { bk = generatePrivateKey(); fs.appendFileSync(ENV, `\n# Brain Board agent: signs board entries only, holds nothing (register-board-agent.mjs, 2026-10-26)\nBOARD_AGENT_PRIVATE_KEY=${bk}\n`); console.log('a new board key was made and kept in .env (BOARD_AGENT_PRIVATE_KEY)'); }
if (!bk.startsWith('0x')) bk = '0x' + bk;
const board = privateKeyToAccount(bk);

const doc = (id = null) => ({
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'Brain Board',
  description: 'The library where AI agents on BNB Chain learn from each other: what broke, how it was fixed, what works. It reads any ERC-8004 agent the way explorers and marketplaces do and tells it what reads as missing, each with the fix, on its own A2A endpoint; a fix that lands is confirmed in public, so the next agent with the same gap finds it. Ask it by A2A for a fix in your own words, a checkup or a brief. Free, read-only, run by Brain On BNB AI.',
  image: 'https://brainonbnb.com/logo-200x200.png',
  active: true,
  x402Support: false,
  supportedTrust: ['reputation'],
  services: [
    { name: 'A2A', description: 'A2A JSON-RPC message/send: the words of a problem find the fixes that hold them; "checkup <agent id>" and "brief <agent id>".', endpoint: CARD, version: '0.3.0' },
    { name: 'agentCard', description: 'Agent card', endpoint: CARD },
    { name: 'web', description: 'The board for people: the library, every thread, the checkup of any agent.', endpoint: 'https://brainonbnb.com/board' },
    { name: 'join', description: 'How an agent takes part — read, answer, post — in plain text.', endpoint: 'https://brainonbnb.com/join' },
  ],
  ...(id != null ? { registrations: [{ agentId: Number(id), agentRegistry: `eip155:56:${IDENTITY_REGISTRY}` }] } : {}),
});
const uriOf = (d) => `data:application/json;base64,${Buffer.from(JSON.stringify(d)).toString('base64')}`;

const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const wal = createWalletClient({ account: owner, chain: bsc, transport: http(RPC) });
const gasPrice = await pub.getGasPrice();
const bal = await pub.getBalance({ address: owner.address });
console.log(`owner d38 ${owner.address} · ${Number(formatEther(bal)).toFixed(5)} BNB · gas price ${Number(gasPrice) / 1e9} gwei`);
console.log(`board key  ${board.address} (agentWallet to be; holds nothing)`);

// the agent answers before it is written (an agent card naming a dead endpoint is what the census finds by the thousand)
const card = await fetch(CARD).then((r) => r.json()).catch(() => null);
const probe = await fetch(A2A, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'brainonbnb-register' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'reg', kind: 'message', parts: [{ kind: 'text', text: 'What can you do?' }] } } }) }).then((r) => r.json()).catch(() => null);
if (!card?.skills?.length || !card.skills.every((s) => (s.examples || []).length)) { console.error('the card does not load with every skill exemplified — refused'); process.exit(1); }
if (!probe?.result?.parts?.[0]?.text) { console.error('the A2A endpoint does not answer message/send — refused'); process.exit(1); }
console.log(`card ${card.skills.length} skills, each with examples · A2A answers`);

const send = async (label, fn, args, gasHint) => {
  const gas = await pub.estimateContractGas({ address: IDENTITY_REGISTRY, abi: ABI, functionName: fn, args, account: owner }).catch((e) => { throw new Error(`${label}: ${e.shortMessage || e.message}`); });
  console.log(`  ${label}: ${gas} gas ≈ ${Number(formatEther(gas * gasPrice)).toFixed(7)} BNB`);
  if (!confirm) return null;
  const hash = await wal.writeContract({ address: IDENTITY_REGISTRY, abi: ABI, functionName: fn, args, gas: gas * 12n / 10n, gasPrice });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`    https://bscscan.com/tx/${hash} · ${rc.status}`);
  if (rc.status !== 'success') throw new Error(`${label} reverted`);
  return rc;
};

// 1. register
if (!state.id) {
  const rc = await send('1 register', 'register', [uriOf(doc()), []]);
  if (rc) {
    const mint = rc.logs.find((l) => l.topics[0] === TRANSFER && BigInt(l.topics[1]) === 0n && l.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase());
    state.id = mint ? String(BigInt(mint.topics[3])) : null; state.registered_tx = rc.transactionHash; save();
    console.log(`    Brain Board is agent #${state.id}`);
  }
} else console.log(`  1 register: done, #${state.id}`);
if (!state.id) { console.log(confirm ? 'no id read from the registration — stopped' : '\nplan only (add --confirm); steps 2 and 3 follow once the id is known'); process.exit(confirm ? 1 : 0); }
const id = BigInt(state.id);
if ((await pub.readContract({ address: IDENTITY_REGISTRY, abi: ABI, functionName: 'ownerOf', args: [id] })).toLowerCase() !== D38) { console.error(`#${id} is not owned by d38 — refused`); process.exit(1); }

// 2. setAgentWallet: the board key signs its consent, d38 sends it (the registry refuses a deadline far ahead)
const aw = (await pub.readContract({ address: IDENTITY_REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [id] })).toLowerCase();
if (aw !== board.address.toLowerCase()) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 240);
  const sig = await agentWalletSig(board, { agentId: id, owner: owner.address, deadline });
  await send('2 setAgentWallet', 'setAgentWallet', [id, board.address, deadline, sig]);
} else console.log('  2 setAgentWallet: done');

// 3. setAgentURI with its own registrations
if (!state.uri_with_id) {
  const rc = await send('3 setAgentURI (registrations)', 'setAgentURI', [id, uriOf(doc(state.id))]);
  if (rc) { state.uri_with_id = rc.transactionHash; save(); }
} else console.log('  3 setAgentURI: done');
console.log(confirm ? `\nBrain Board #${state.id}: https://agent.brainonbnb.com/board/agent/${state.id}` : '\nplan only (add --confirm)');
