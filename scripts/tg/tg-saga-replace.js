#!/usr/bin/env node
// Replace one sticker in the live saga set (same position) with a fresh webm.
// Usage: node tg-saga-replace.js <slug> <emoji>
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BROADCAST_URL || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast')
  .replace(/\/broadcast$/, '');
const SECRET = process.env.BROADCAST_SECRET || '';
const OWNER_USER_ID = 7334850816;
const NAME = 'bobai_saga_pack_by_bobai_official_bot';
const HDR = { 'x-broadcast-secret': SECRET };

const [slug, emoji] = process.argv.slice(2);
if (!slug || !emoji) { console.error('Usage: node tg-saga-replace.js <slug> <emoji>'); process.exit(1); }

(async () => {
  const g = await fetch(`${BASE}/stickerset/get?name=${NAME}`, { headers: HDR }).then(x => x.json());
  if (!g.ok) { console.error('[!] get set failed:', JSON.stringify(g).slice(0, 300)); process.exit(1); }
  const old = g.result.stickers.find(s => (s.emoji || '') === emoji);
  if (!old) { console.error(`[!] no sticker with emoji ${emoji} in set`); process.exit(1); }

  const buf = fs.readFileSync(path.join(__dirname, 'stickers', 'out', `bobai-${slug}.webm`));
  const form = new FormData();
  form.append('user_id', String(OWNER_USER_ID));
  form.append('sticker', new Blob([buf], { type: 'video/webm' }), `${slug}.webm`);
  const up = await fetch(`${BASE}/stickerset/upload`, { method: 'POST', headers: HDR, body: form }).then(x => x.json());
  if (!up.ok) { console.error('[!] upload failed:', JSON.stringify(up)); process.exit(1); }

  const r = await fetch(`${BASE}/stickerset/replace`, {
    method: 'POST', headers: { ...HDR, 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: OWNER_USER_ID, name: NAME, old_sticker: old.file_id,
                           file_id: up.result.file_id, emoji }),
  }).then(x => x.json());
  if (!r.ok) { console.error('[!] replace failed:', JSON.stringify(r)); process.exit(1); }
  console.log(`✅ replaced ${emoji} ${slug} in ${NAME}`);
})();
