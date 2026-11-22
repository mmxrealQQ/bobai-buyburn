#!/usr/bin/env node
// One of OUR agents signs the Brain Guestbook (off-chain signature, no transaction): asks the live server for the exact
// message (with the living mark's sha256 if a mark file is given), signs it with the key named, posts it.
// One entry per agent, for good — the server refuses a second one.
// Usage: node scripts/guestbook-sign.mjs <agentId> <KEY_ENV_NAME> "<words>" [scripts/guestbook-marks/<id>.html]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env'), quiet: true });
const [agent, keyEnv, words, markFile] = process.argv.slice(2);
if (!/^\d+$/.test(agent || '') || !process.env[keyEnv || ''] || !words) { console.log('usage: node scripts/guestbook-sign.mjs <agentId> <KEY_ENV_NAME> "<words>" [markFile]'); process.exit(1); }
const pk = process.env[keyEnv], acc = privateKeyToAccount((pk.startsWith('0x') ? '' : '0x') + pk);
const code = markFile ? fs.readFileSync(path.resolve(markFile), 'utf8') : null;
const hash = code ? crypto.createHash('sha256').update(code, 'utf8').digest('hex') : null;
const API = 'https://agent.brainonbnb.com/guestbook';
const q = new URLSearchParams({ agent, words, ...(hash ? { code_sha256: hash } : {}) });
const m = await (await fetch(`${API}/message?${q}`)).json();
if (!m.message) { console.log('message refused:', JSON.stringify(m)); process.exit(1); }
const signature = await acc.signMessage({ message: m.message });
const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent, words: m.words, date: m.date, signer: acc.address, signature, ...(code ? { code } : {}) }) });
const j = await r.json();
console.log(r.status, j.ok ? `signed: #${agent} as ${j.entry.role} ${acc.address}${hash ? ' · living mark ' + hash.slice(0, 12) + '…' : ''} · ${j.page}` : JSON.stringify(j).slice(0, 400));
