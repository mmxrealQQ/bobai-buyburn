// THE TELEGRAM CHAMPION POST LINKS THE DAY ON CHAIN (2026-11-10, operator: "make the TG link"). worker-tg-bot's night
// post waits for worker-agent/pop-chain.js to write the closed day on BNB Chain (from 00:15 UTC) and carries its
// transaction. Every outside call is answered here (no Telegram message is sent, nothing on chain):
//   1  00:16, the day not on chain yet: nothing is posted, nothing is marked, the next minute asks again
//   2  00:20, the day on chain: one post, its caption carries "⛓ On BNB Chain: https://bscscan.com/tx/<tx>"
//   3  the next minute posts nothing again (once a day)
//   4  00:45, still not on chain: the post goes out without the line (never lost)
//   node scripts/tg-pop-chain-test.mjs
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
let n = 0, failed = 0;
const ok = (what, cond, detail = '') => { n++; if (!cond) failed++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const DAY = '2026-11-10', TX = '0x' + 'ab'.repeat(32), RUN = 'b444499e01be';
let chain = null; const sent = [];
const board = { scope: 'day', day: DAY, no: 5, rows: [{ name: 'Baby mmx_QQinu 1000x', score: 12383496.5578953, run: RUN }, { name: 'Bobaione Cazzone', score: 5617509.0904636, run: 'c060d759d6c5' }], players: 6 };
globalThis.fetch = async (u, init) => {
  const url = String(u), J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://agent.brainonbnb.com/pop/chain')) return chain ? J({ day: DAY, tx: chain }) : J({ error: 'not written (yet)' }, 404);
  if (url.includes('/api/pop/top?scope=day')) return J(board);
  if (url.includes('/api/pop/top?scope=all')) return J({ rows: board.rows, players: 40 });
  if (url.includes('/api/pop/pool')) return J({ bobai: 808.41 });
  if (url.includes('/api/price')) return J({ price_usd: 0.000227 });
  if (url.includes('api.telegram.org')) { sent.push({ method: url.split('/').pop(), body: JSON.parse(init.body) }); return J({ ok: true, result: {} }); }
  return J({}, 404);
};
const mod = await import('file:///' + path.join(ROOT, 'worker-tg-bot', 'index.js').replace(/\\/g, '/'));
const kv = new Map(), env = { KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, TG_BOT_TOKEN: 'test', TELEGRAM_BOT_TOKEN: 'test' };
const at = (hm) => new Date(`2026-11-11T${hm}:00Z`);
await mod.postPopChampion(env, at('00:16'));
ok('1 00:16, the day not on chain yet: nothing posted, nothing marked', sent.length === 0 && !kv.has('pop_champ:' + DAY));
chain = TX;
await mod.postPopChampion(env, at('00:20'));
const cap = sent[0]?.body?.caption || sent[0]?.body?.text || '';
ok('2 00:20, on chain: one post carrying the transaction', sent.length === 1 && cap.includes('⛓ On BNB Chain: https://bscscan.com/tx/' + TX) && cap.includes('⚔️ Beat the champion: https://brainonbnb.com/m/pop/' + RUN), cap.split('\n').slice(-4).join(' | '));
await mod.postPopChampion(env, at('00:21'));
ok('3 the next minute posts nothing again', sent.length === 1);
kv.clear(); sent.length = 0; chain = null;
await mod.postPopChampion(env, at('00:45'));
const cap2 = sent[0]?.body?.caption || sent[0]?.body?.text || '';
ok('4 00:45, still not on chain: the post goes out without the line', sent.length === 1 && !cap2.includes('On BNB Chain'));
console.log(`\ntg pop-chain test: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);
