#!/usr/bin/env node
// Send an animated .webm sticker via the bobai-tg-bot Cloudflare Worker.
//
// Usage:
//   node tg-send-sticker.js <chat_id> <path-to-webm>
//
// Architecture (mirrors tg-update.js): this script does NOT talk to Telegram
// directly. It POSTs the file as multipart/form-data to the worker's /sendsticker
// endpoint, authenticated with the shared BROADCAST_SECRET. The worker forwards it
// to Telegram sendSticker using its own BOT_TOKEN (a CF secret that never leaves CF).
//
// .env requires:
//   BROADCAST_SECRET  — shared secret between this script and the worker
//   BROADCAST_URL     — optional; defaults to the production worker origin
require('dotenv').config();
const fs = require('fs');

const BASE = (process.env.BROADCAST_URL || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast')
  .replace(/\/broadcast$/, '');
const SECRET = process.env.BROADCAST_SECRET || '';

const [chatId, filePath] = process.argv.slice(2);
if (!SECRET)   { console.error('Missing BROADCAST_SECRET in .env'); process.exit(1); }
if (!chatId)   { console.error('Usage: node tg-send-sticker.js <chat_id> <path-to-webm>'); process.exit(1); }
if (!filePath || !fs.existsSync(filePath)) { console.error('webm file not found:', filePath); process.exit(1); }

(async () => {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('sticker', new Blob([buf], { type: 'video/webm' }), 'sticker.webm');

  const res = await fetch(`${BASE}/sendsticker`, {
    method: 'POST',
    headers: { 'x-broadcast-secret': SECRET },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.ok) {
    console.log('✅ sent — message_id', json.result?.message_id);
  } else {
    console.error('❌ failed:', res.status, JSON.stringify(json));
    process.exit(1);
  }
})();
