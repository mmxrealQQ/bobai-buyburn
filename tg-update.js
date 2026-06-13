#!/usr/bin/env node
// Send a "brain update" announcement to the BOBAI Telegram group.
//
// Usage:
//   node tg-update.js "<HTML-formatted text>"
//   node tg-update.js --file <path-to-text-file>      (preferred for multi-line)
//
// Architecture:
//   This script does NOT talk to Telegram directly. It POSTs the announcement to
//   the bobai-tg-bot Cloudflare Worker's /broadcast endpoint, authenticated with a
//   shared BROADCAST_SECRET. The worker then sends two messages via its own
//   BOT_TOKEN (a CF secret that never leaves Cloudflare):
//     1) A lone 🧠 — Telegram renders 1-3 emoji-only messages as JUMBO, which
//        acts as the visual "this is an update" header for every announcement.
//     2) The actual text with parse_mode=HTML.
//
// .env requires:
//   BROADCAST_SECRET  — shared secret between this script and the worker
//                        (set on CF with: npx wrangler secret put BROADCAST_SECRET
//                        --config worker-tg-bot/wrangler.toml)
//   BROADCAST_URL     — optional override; defaults to the production worker URL
require('dotenv').config();

const BROADCAST_URL    = process.env.BROADCAST_URL    || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast';
const BROADCAST_SECRET = process.env.BROADCAST_SECRET || '';

if (!BROADCAST_SECRET) {
  console.error('Missing BROADCAST_SECRET in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
let text;
const fileIdx = args.indexOf('--file');
if (fileIdx >= 0) {
  const path = args[fileIdx + 1];
  if (!path) { console.error('--file requires a path'); process.exit(1); }
  text = require('fs').readFileSync(path, 'utf8').trim();
} else {
  text = args.join(' ').trim();
}
if (!text) {
  console.error('Usage: node tg-update.js "<HTML text>"  |  node tg-update.js --file <path>');
  process.exit(1);
}

(async () => {
  const r = await fetch(BROADCAST_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-broadcast-secret': BROADCAST_SECRET,
    },
    body: JSON.stringify({ text, prefixBrain: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    console.error('Failed:', r.status, JSON.stringify(j));
    process.exit(1);
  }
  console.log('Sent: message_id =', j.message_id);
})().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
