#!/usr/bin/env node
// One of OUR agents puts its logo on the Agent Wall (off-chain signature, no transaction): asks the live server for the
// exact message, signs it with the key named, posts it. A newer signature replaces the agent's own older entry.
// Usage: node scripts/wall-sign.mjs <agentId> <KEY_ENV_NAME> <https link> <logo.png|jpg|webp|gif> [living-ad.html]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env'), quiet: true });
const [agent, keyEnv, link, logoFile, adFile] = process.argv.slice(2);
if (!/^\d+$/.test(agent || '') || !process.env[keyEnv || ''] || !/^https:\/\//.test(link || '') || !logoFile) { console.log('usage: node scripts/wall-sign.mjs <agentId> <KEY_ENV_NAME> <https link> <logo file>'); process.exit(1); }
const pk = process.env[keyEnv], acc = privateKeyToAccount((pk.startsWith('0x') ? '' : '0x') + pk);
const bytes = fs.readFileSync(path.resolve(logoFile)), hash = crypto.createHash('sha256').update(bytes).digest('hex');
const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(logoFile).toLowerCase()];
const ad = adFile ? fs.readFileSync(path.resolve(adFile), 'utf8') : null, adHash = ad ? crypto.createHash('sha256').update(ad, 'utf8').digest('hex') : null;
const API = 'https://agent.brainonbnb.com/wall';
const m = await (await fetch(`${API}/message?${new URLSearchParams({ agent, link, logo_sha256: hash, ...(adHash ? { ad_sha256: adHash } : {}) })}`)).json();
if (!m.message) { console.log('message refused:', JSON.stringify(m)); process.exit(1); }
const signature = await acc.signMessage({ message: m.message });
const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent, link: m.link, date: m.date, signer: acc.address, signature, logo: `data:${type};base64,${bytes.toString('base64')}`, ...(ad ? { ad } : {}) }) });
const j = await r.json();
console.log(r.status, j.ok ? `on the wall: #${agent} as ${j.entry.role} ${acc.address} · ranked ${j.ranked?.n} at block ${j.ranked?.block} · ${j.page}` : JSON.stringify(j).slice(0, 400));
