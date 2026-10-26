#!/usr/bin/env node
// Our own entries on the Plaza Board (2026-10-23). Signs with the owner of our six agents (0xbFAA, LP_PRIVATE_KEY —
// a personal_sign, no transaction, no gas), so an entry naming one of them shows as verified.
//
//   node scripts/board-post.mjs <file.json>             dry run: prints each entry and the exact message it would sign
//   node scripts/board-post.mjs <file.json> --confirm   signs and posts, one after the other, and reads each back
//
// file.json: [{ action: 'post', agent: 304493, type: 'bug', to: '341555', title, body }, { action: 'reply', thread, … }]
import 'dotenv/config';
import fs from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { boardMessage, checkPost } from '../shared/plaza-board.js';

const file = process.argv[2], confirm = process.argv.includes('--confirm');
if (!file) { console.error('usage: node scripts/board-post.mjs <file.json> [--confirm]'); process.exit(1); }
// --as 49467: our Brain Plaza identity, signed by its owner (BOBAI_PRIVATE_KEY); --as 391841: the Brain Board itself, signed
// by its own agentWallet (BOARD_AGENT_PRIVATE_KEY — library entries read as the board's, not a token's, 2026-10-26);
// default the owner of our six (LP_PRIVATE_KEY)
const as = process.argv.includes('--as') ? process.argv[process.argv.indexOf('--as') + 1] : null;
let key = (as === '49467' ? process.env.BOBAI_PRIVATE_KEY : as === '391841' ? process.env.BOARD_AGENT_PRIVATE_KEY : process.env.LP_PRIVATE_KEY || '').trim(); if (!key.startsWith('0x')) key = '0x' + key;
const acct = privateKeyToAccount(key);
const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
// an entry names the agent that signs it: the board's key signs only as #391841
if (as === '391841') for (const e of entries) if (String(e.agent) !== '391841') { console.error(`--as 391841 signs entries of agent 391841 only (one names ${e.agent})`); process.exit(1); }
console.log(`${confirm ? 'POSTING' : 'DRY RUN — nothing is posted'} · signer ${acct.address}\n`);
for (const e of entries) {
  const p = { ...e, ts: Math.floor(Date.now() / 1000), signer: acct.address };
  const message = await boardMessage(p);
  const signature = await acct.signMessage({ message });
  const bad = checkPost({ ...p, signature });
  console.log(`— ${p.action} ${p.type || ''} as #${p.agent || '-'} → ${p.to || p.thread}: ${p.title || p.body.slice(0, 60)}`);
  if (bad) { console.log('  REFUSED by the rules:', bad); process.exit(1); }
  if (!confirm) { console.log(message.split('\n').map((l) => '    ' + l).join('\n') + '\n'); continue; }
  const r = await fetch('https://agent.brainonbnb.com/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, signature }) });
  const j = await r.json();
  console.log(`  ${r.status} ${JSON.stringify(j)}`);
  if (!j.ok) process.exit(1);
  const t = await fetch(`https://agent.brainonbnb.com/board/thread/${j.thread}`).then((x) => x.json());
  console.log(`  read back: thread #${t.id}, ${t.verified ? 'verified ' + t.agent_name : 'unverified'}, ${t.replies.length} replies\n`);
  await new Promise((res) => setTimeout(res, 1500));
}
