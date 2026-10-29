#!/usr/bin/env node
// EVERY PUBLIC COMMAND OF THE TELEGRAM BOT, RUN (2026-10-29): each one goes through the bot's real webhook handler with
// Telegram faked (sendMessage captured, nothing posted) and the chain and our APIs live. Each must answer with one
// message and no undefined / NaN / [object Object]; /buy names 6% at any size (on chain a buy or sell goes through at 3%,
// whatever the size — "a big buy needs more" was wrong) and /bot says where the tax collects (in the token, not the wallet).
//   node scripts/tg-commands-check.mjs
const real = globalThis.fetch;
const sent = [];
globalThis.fetch = async (u, init) => {
  const s = String(u?.url || u);
  if (s.startsWith('https://api.telegram.org/')) { let b = {}; try { b = JSON.parse(init?.body || '{}'); } catch {} sent.push({ m: s.split('/').pop(), b }); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  return real(u, init);
};
const kv = new Map();
const KV = { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, String(v)); }, delete: async (k) => kv.delete(k), list: async () => ({ keys: [] }) };
const { default: worker } = await import('../worker-tg-bot/index.js');
const env = { BOT_TOKEN: 'x', KV, TG_INTERNAL_CHAT_ID: '-1', GATE: null };
let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}${!pass && detail ? ' — ' + detail : ''}`); };
const say = async (c) => {
  sent.length = 0;
  const update = { update_id: 1, message: { message_id: 5, date: Math.floor(Date.now() / 1000), text: c, chat: { id: -100999, type: 'supergroup' }, from: { id: 42, first_name: 'Tester' } } };
  await worker.fetch(new Request('https://bot.example/', { method: 'POST', body: JSON.stringify(update), headers: { 'content-type': 'application/json' } }), env, { waitUntil: () => {} });
  return sent.map((x) => x.b.text || x.b.caption || '').join('\n');
};
const CMDS = ['/start', '/help', '/price', '/buy', '/ca', '/tax', '/burn', '/bot', '/liq', '/defi', '/nft', '/giggle', '/links', '/security', '/alerts', '/whales', '/worldcup'];
const got = {};
for (const c of CMDS) {
  const t = await say(c).catch((e) => 'THREW ' + e);
  got[c] = t;
  const bad = [...new Set(t.replace(/<[^>]+>/g, '').match(/undefined|NaN|\[object Object\]|Infinity|THREW/g) || [])];
  ok(`${c}: one message, no undefined/NaN`, sent.length === 1 && t.length > 40 && !bad.length, `${sent.length} sent, ${bad.join(',')} · ${t.slice(0, 80)}`);
}
ok('/buy: 6% at any size, not "a big buy needs more"', /Set slippage to 6%, at any size/.test(got['/buy']) && !/needs more/.test(got['/buy']), got['/buy'].slice(-260));
ok('/bot: the tax collects in the token, which sends it to the bot wallet', /3% tax collects in the token, which swaps it to BNB and sends it to that wallet/.test(got['/bot']) && !/collects in that wallet/.test(got['/bot']), got['/bot'].slice(0, 260));
ok('a sentence in the group is not a command ("buy the dip" gets no answer)', (await say('buy the dip')) === '' && sent.length === 0);
console.log(`\n${n - failed}/${n} checks passed`);
process.exit(failed ? 1 : 0);
