#!/usr/bin/env node
// Build the "BOBAI Saga" Telegram sticker SET (weekend-vibes look, wise-master
// meme captions) via the bobai-tg-bot worker. Mirrors tg-create-stickerset.js.
//
// Usage: node tg-create-saga-pack.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BROADCAST_URL || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast')
  .replace(/\/broadcast$/, '');
const SECRET = process.env.BROADCAST_SECRET || '';
if (!SECRET) { console.error('Missing BROADCAST_SECRET in .env'); process.exit(1); }

const OWNER_USER_ID = 7334850816;
const PREFIX = 'bobai_saga_pack';
const TITLE = 'BOBAI Saga — May the Pump Be With You';
const STICKERS = [
  ['saga-pump',     '🧙'],
  ['saga-patience', '⏳'],
  ['saga-nosell',   '✋'],
  ['saga-hodl',     '✊'],
  ['saga-fear',     '🧘'],
];

const HDR = { 'x-broadcast-secret': SECRET };

async function postJson(endpoint, body) {
  const r = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { ...HDR, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false, error: 'invalid json response' }));
}

async function uploadOne(filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('user_id', String(OWNER_USER_ID));
  form.append('sticker', new Blob([buf], { type: 'video/webm' }), path.basename(filePath));
  const r = await fetch(`${BASE}/stickerset/upload`, { method: 'POST', headers: HDR, body: form });
  return r.json().catch(() => ({ ok: false, error: 'invalid json response' }));
}

(async () => {
  const me = await fetch(`${BASE}/stickerset/getbot`, { headers: HDR }).then(r => r.json());
  if (!me.ok || !me.username) {
    console.error('[!] getbot failed:', JSON.stringify(me)); process.exit(1);
  }
  const setName = `${PREFIX}_by_${me.username}`;
  console.log(`[*] set name: ${setName}`);

  const items = STICKERS.map(([slug, emoji]) => {
    const fp = path.join(__dirname, 'stickers', 'out', `bobai-${slug}.webm`);
    if (!fs.existsSync(fp)) { console.error(`[!] missing: ${fp}`); process.exit(1); }
    return { slug, emoji, fp };
  });

  for (const it of items) {
    const j = await uploadOne(it.fp);
    if (!j.ok) { console.error(`[!] upload ${it.slug} failed:`, JSON.stringify(j)); process.exit(1); }
    it.file_id = j.result.file_id;
    console.log(`[+] uploaded ${it.slug} ${it.emoji}  ${it.file_id.slice(0, 24)}…`);
  }

  const first = items[0];
  const c = await postJson('/stickerset/create', {
    user_id: OWNER_USER_ID, name: setName, title: TITLE,
    file_id: first.file_id, emoji: first.emoji,
  });
  if (!c.ok) { console.error('[!] create failed:', JSON.stringify(c)); process.exit(1); }
  console.log(`[+] set created (${first.slug} ${first.emoji})`);

  for (let i = 1; i < items.length; i++) {
    const it = items[i];
    const a = await postJson('/stickerset/add', {
      user_id: OWNER_USER_ID, name: setName, file_id: it.file_id, emoji: it.emoji,
    });
    if (!a.ok) { console.error(`[!] add ${it.slug} failed:`, JSON.stringify(a)); process.exit(1); }
    console.log(`[+] added ${it.slug} ${it.emoji}`);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n✅ Done.\nInstall: https://t.me/addstickers/${setName}`);
})();
