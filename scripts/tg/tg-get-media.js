#!/usr/bin/env node
// Download the last reference media the owner sent the bot in private chat.
//
// Usage:
//   node tg-get-media.js [output-path]
//
// Architecture (mirrors tg-send-sticker.js): the worker webhook stores the last
// owner-sent file (animation/video/document/photo/sticker) in KV. This script
// hits GET /media/download (auth'd with BROADCAST_SECRET) and saves the bytes.
// BOT_TOKEN never leaves Cloudflare.
//
// .env requires:
//   BROADCAST_SECRET  — shared secret between this script and the worker
//   BROADCAST_URL     — optional; defaults to the production worker origin
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BROADCAST_URL || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast')
  .replace(/\/broadcast$/, '');
const SECRET = process.env.BROADCAST_SECRET || '';
if (!SECRET) { console.error('Missing BROADCAST_SECRET in .env'); process.exit(1); }

const outArg = process.argv[2];

(async () => {
  const metaRes = await fetch(`${BASE}/media/last`, { headers: { 'x-broadcast-secret': SECRET } });
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok || !meta.ok) {
    console.error('❌ no media available:', metaRes.status, JSON.stringify(meta));
    process.exit(1);
  }
  console.log(`📥 last media: type=${meta.type} name=${meta.name} ts=${new Date(meta.ts).toISOString()}`);

  const res = await fetch(`${BASE}/media/download`, { headers: { 'x-broadcast-secret': SECRET } });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error('❌ download failed:', res.status, err);
    process.exit(1);
  }
  const name = decodeURIComponent(res.headers.get('x-media-name') || meta.name || 'ref.bin');
  const out = outArg || path.join('stickers', 'incoming', name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`✅ saved → ${out} (${fs.statSync(out).size} bytes)`);
})();
