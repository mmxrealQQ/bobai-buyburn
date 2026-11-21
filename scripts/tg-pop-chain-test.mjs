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
let chain = null, tgDown = false, clock = ''; const sent = [];
const board = { scope: 'day', day: DAY, no: 5, rows: [{ name: 'Baby mmx_QQinu 1000x', score: 12383496.5578953, run: RUN }, { name: 'Bobaione Cazzone', score: 5617509.0904636, run: 'c060d759d6c5' }], players: 6 };
globalThis.fetch = async (u, init) => {
  const url = String(u), J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://agent.brainonbnb.com/pop/chain')) return chain ? J({ day: DAY, tx: chain }) : J({ error: 'not written (yet)' }, 404);
  if (url.includes('/api/pop/top?scope=day')) return J(board);
  if (url.includes('/api/pop/top?scope=all')) return J({ rows: board.rows, players: 40 });
  if (url.includes('/api/pop/pool')) return J({ bobai: 808.41 });
  if (url.includes('/api/price')) return J({ price_usd: 0.000227 });
  if (url.includes('api.telegram.org')) {
    const method = url.split('/').pop();
    if (tgDown) { sent.push({ method, refused: true, at: clock }); return J({ ok: false, error_code: 502, description: 'Bad Gateway' }); }
    sent.push({ method, body: JSON.parse(init.body) }); return J({ ok: true, result: {} });
  }
  return J({}, 404);
};
const mod = await import('file:///' + path.join(ROOT, 'worker-tg-bot', 'index.js').replace(/\\/g, '/'));
const kv = new Map(), env = { KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, TG_BOT_TOKEN: 'test', TELEGRAM_BOT_TOKEN: 'test' };
const at = (hm) => { clock = hm; return new Date(`2026-11-11T${hm}:00Z`); };
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
// MARKED ONLY WHEN SENT (15.11., the A-Z pass): the day was marked 'sent' BEFORE Telegram answered, so one refused or
// timed-out send lost the post for good — on 1 Dec that is the season-over post. Now a refusal is retried next minute,
// at most 5 tries a day (no loop for three days if Telegram keeps refusing).
kv.clear(); sent.length = 0; chain = TX; tgDown = true;
await mod.postPopChampion(env, at('00:20'));
ok('5 Telegram refuses: the day is NOT marked sent', kv.get('pop_champ:' + DAY) !== 'sent', 'flag=' + kv.get('pop_champ:' + DAY));
tgDown = false; const before = sent.filter((s) => !s.refused).length;
await mod.postPopChampion(env, at('00:21'));
ok('6 the next minute tries again and the post goes out once', sent.filter((s) => !s.refused).length === before + 1 && kv.get('pop_champ:' + DAY) === 'sent');
await mod.postPopChampion(env, at('00:22'));
ok('7 after it went out: nothing again', sent.filter((s) => !s.refused).length === before + 1);
kv.clear(); sent.length = 0; tgDown = true;
for (let m = 20; m < 40; m++) await mod.postPopChampion(env, at('00:' + m));
const tries = new Set(sent.filter((s) => s.refused).map((s) => s.at)).size;
ok('8 Telegram keeps refusing: at most 5 tries, then it stops', tries > 0 && tries <= 5, tries + ' tries');
tgDown = false;
// the season-over post itself: 1 Dec, 00:20 posts the 30 Nov day
kv.clear(); sent.length = 0; board.day = '2026-11-30'; board.no = 25;
await mod.postPopChampion(env, new Date('2026-12-01T00:20:00Z'));
const cap3 = sent[0]?.body?.caption || sent[0]?.body?.text || '';
ok('9 1 Dec 00:20: the season-over post goes out (day 30 Nov)', sent.length === 1 && cap3.includes('Season over') && kv.get('pop_champ:2026-11-30') === 'sent', cap3.split('\n')[0]);
// A-Z 2026-11-21: the line was anchored on "▶️ Play today:", which the season-over post does not have
ok('10 the season-over post carries its transaction too', cap3.includes('⛓ On BNB Chain: https://bscscan.com/tx/' + TX), cap3.split('\n').slice(-3).join(' | '));
console.log(`\ntg pop-chain test: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);
