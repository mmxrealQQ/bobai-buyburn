#!/usr/bin/env node
// Send an image announcement (report card + caption) to the BOBAI Telegram group.
//
// Usage:
//   node tg-photo.js --photo <image> --caption-file <path> [--internal] [--no-brain]
//   node tg-photo.js --photo <image> --caption "<HTML text>"
//
// Architecture: like tg-update.js, this never talks to Telegram directly. It POSTs a
// multipart form to the bobai-tg-bot Worker's /broadcastphoto endpoint, authenticated
// with BROADCAST_SECRET. The worker forwards it to sendPhoto with its own BOT_TOKEN,
// which never leaves Cloudflare.
//
// --internal targets the private BOBAI Intern chat — use it to preview before the
// public group sees anything.
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const BASE = (process.env.BROADCAST_URL || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast')
  .replace(/\/broadcast$/, '');
const BROADCAST_SECRET = process.env.BROADCAST_SECRET || '';

if (!BROADCAST_SECRET) {
  console.error('Missing BROADCAST_SECRET in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const photoPath = flag('--photo');
const captionFile = flag('--caption-file');
const captionArg = flag('--caption');
const internal = args.includes('--internal');
const noBrain = args.includes('--no-brain');

if (!photoPath) {
  console.error('Usage: node tg-photo.js --photo <image> [--caption-file <path> | --caption "<html>"] [--internal] [--no-brain]');
  process.exit(1);
}
if (!fs.existsSync(photoPath)) {
  console.error('Photo not found: ' + photoPath);
  process.exit(1);
}

const caption = captionFile ? fs.readFileSync(captionFile, 'utf8').trim() : (captionArg || '').trim();
if (caption.length > 1024) {
  console.error(`Caption too long: ${caption.length}/1024 characters (Telegram limit). Shorten it.`);
  process.exit(1);
}

(async () => {
  const bytes = fs.readFileSync(photoPath);
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type: 'image/png' }), path.basename(photoPath));
  if (caption) form.append('caption', caption);
  if (internal) form.append('target', 'internal');
  if (noBrain) form.append('prefixBrain', '0');

  const r = await fetch(BASE + '/broadcastphoto', {
    method: 'POST',
    headers: { 'x-broadcast-secret': BROADCAST_SECRET },
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    console.error('Failed:', r.status, JSON.stringify(j));
    process.exit(1);
  }
  console.log(`Sent to ${internal ? 'INTERNAL' : 'PUBLIC group'}: message_id = ${j.message_id}` +
    `  (${(bytes.length / 1024).toFixed(0)} KB, caption ${caption.length}/1024)`);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
