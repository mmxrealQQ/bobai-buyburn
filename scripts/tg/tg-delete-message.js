#!/usr/bin/env node
// Delete a message (e.g. a preview sticker) via the bobai-tg-bot Worker.
//
// Usage:
//   node tg-delete-message.js <chat_id> <message_id>
//
// POSTs to the worker's /deletemessage endpoint (auth: BROADCAST_SECRET); the
// worker calls Telegram deleteMessage with its own BOT_TOKEN. Note: Telegram only
// lets bots delete messages younger than 48h.
require('dotenv').config();

const BASE = (process.env.BROADCAST_URL || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast')
  .replace(/\/broadcast$/, '');
const SECRET = process.env.BROADCAST_SECRET || '';

const [chatId, messageId] = process.argv.slice(2);
if (!SECRET)    { console.error('Missing BROADCAST_SECRET in .env'); process.exit(1); }
if (!chatId || !messageId) { console.error('Usage: node tg-delete-message.js <chat_id> <message_id>'); process.exit(1); }

(async () => {
  const res = await fetch(`${BASE}/deletemessage`, {
    method: 'POST',
    headers: { 'x-broadcast-secret': SECRET, 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), message_id: Number(messageId) }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.ok) {
    console.log('🗑️  deleted message', messageId);
  } else {
    console.error('❌ failed:', res.status, JSON.stringify(json));
    process.exit(1);
  }
})();
