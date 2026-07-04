#!/usr/bin/env node
// One-off: add the remaining 4 saga stickers to the freshly created set
// (createNewStickerSet → addStickerToSet race needs retries).
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BROADCAST_URL || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast')
  .replace(/\/broadcast$/, '');
const SECRET = process.env.BROADCAST_SECRET || '';
const OWNER_USER_ID = 7334850816;
const NAME = 'bobai_saga_pack_by_bobai_official_bot';
const STICKERS = [
  ['saga-patience', '⏳'],
  ['saga-nosell',   '✋'],
  ['saga-hodl',     '✊'],
  ['saga-fear',     '🧘'],
];
const HDR = { 'x-broadcast-secret': SECRET };

async function uploadOne(filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('user_id', String(OWNER_USER_ID));
  form.append('sticker', new Blob([buf], { type: 'video/webm' }), path.basename(filePath));
  const r = await fetch(`${BASE}/stickerset/upload`, { method: 'POST', headers: HDR, body: form });
  return r.json();
}

(async () => {
  for (const [slug, emoji] of STICKERS) {
    const fp = path.join(__dirname, 'stickers', 'out', `bobai-${slug}.webm`);
    const up = await uploadOne(fp);
    if (!up.ok) { console.error(`[!] upload ${slug}:`, JSON.stringify(up)); process.exit(1); }
    let done = false;
    for (let att = 1; att <= 6 && !done; att++) {
      const r = await fetch(`${BASE}/stickerset/add`, {
        method: 'POST', headers: { ...HDR, 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: OWNER_USER_ID, name: NAME, file_id: up.result.file_id, emoji }),
      }).then(x => x.json());
      if (r.ok) { console.log(`[+] added ${slug} ${emoji}`); done = true; break; }
      console.log(`[~] ${slug} attempt ${att}: ${r.description || JSON.stringify(r)} — retrying`);
      await new Promise(res => setTimeout(res, 4000));
    }
    if (!done) { console.error(`[!] gave up on ${slug}`); process.exit(1); }
  }
  const g = await fetch(`${BASE}/stickerset/get?name=${NAME}`, { headers: HDR }).then(x => x.json());
  const count = g.result?.stickers?.length ?? '?';
  console.log(`\n✅ set now has ${count} stickers\nInstall: https://t.me/addstickers/${NAME}`);
})();
