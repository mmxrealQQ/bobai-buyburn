#!/usr/bin/env node
// Append additional stickers to an EXISTING Telegram sticker set via the
// bobai-tg-bot worker. Mirrors tg-create-stickerset.js but skips the
// /stickerset/create step — uploads each webm, then /stickerset/add.
//
// Usage:
//   node tg-extend-stickerset.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BROADCAST_URL || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast')
  .replace(/\/broadcast$/, '');
const SECRET = process.env.BROADCAST_SECRET || '';
if (!SECRET) { console.error('Missing BROADCAST_SECRET in .env'); process.exit(1); }

const OWNER_USER_ID = 7334850816;
const SET_NAME = 'bobai_meme_pack_by_bobai_official_bot';
const STICKERS = [
  ['gm',       '☀️'],
  ['pump',     '📈'],
  ['dip',      '🩸'],
  ['builder',  '🧱'],
  ['shield',   '🛡️'],
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

  for (const it of items) {
    const a = await postJson('/stickerset/add', {
      user_id: OWNER_USER_ID, name: SET_NAME, file_id: it.file_id, emoji: it.emoji,
    });
    if (!a.ok) { console.error(`[!] add ${it.slug} failed:`, JSON.stringify(a)); process.exit(1); }
    console.log(`[+] added ${it.slug} ${it.emoji}`);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n✅ Done.\nSet: https://t.me/addstickers/${SET_NAME}`);
})();
