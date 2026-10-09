// TG ALERTS REGRESSIONS (2026-10-09): the bot's buy-alert context line, the daily market card, the degraded log
// scan's cursor, the burn-stuck mark and the /health evidence — run against the real worker code with a stand-in
// chain, Telegram and KV — plus the health module's new rules (told buys, burn alerts, 808.41 wallets, the hourly
// light look) and the health worker's hourly cron. Each pin FAILs on the code before 2026-10-09.
//   1  a degraded log read walks windows from a cursor: a buy 300 blocks back is found (the old cut read 50 blocks)
//   2  the buy alert carries ONE context line: holding (chain), Nth buy from this wallet, largest in 7 days; the
//      brain row still counts $10 a brain; the alert record is written once the alert went out
//   3  a failed balance read leaves the holding out — never "holds 0"
//   4  the daily market card goes to the group once (16:00 UTC window), from the ledger's buy/sell split
//   5  a burn whose alert cannot go out is marked (burn_stuck_since) and the mark is removed once it does
//   6  /health reports buy_alerts (an untold $100+ buy is missing), the NFT queue age, burn_alerts, scan_degraded_since
//   7  the health rules: an untold buy / a stuck queue / a burn stuck an hour read red; 808.41 to the hundredth;
//      the hourly look reads red on a dead cron; the module wires them into runHealth
//   8  the health worker: an hourly cron, dispatched by event.cron, silent when green; the e-mail fallback is
//      skipped without its secrets and sends plain text with them
// usage: node scripts/tg-alerts-regressions.mjs [--root <dir>]   offline; self-tests.mjs runs it (a *-regressions file)
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ri = process.argv.indexOf('--root');
const ROOT = ri > 0 ? path.resolve(process.argv[ri + 1]) : path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'ok    ' : 'FAIL  ') + what + (ok || !more ? '' : ' — ' + String(more).slice(0, 300))); ok ? pass++ : fail++; };
const real = { fetch: globalThis.fetch, error: console.error, log: console.log };
const quiet = () => Object.assign(console, { error: () => {}, log: () => {} });
const loud = () => Object.assign(console, { error: real.error, log: real.log });
const worker = await import(pathToFileURL(path.join(ROOT, 'worker-tg-bot', 'index.js')).href);

// ---- the stand-in world ------------------------------------------------------
const PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6', TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const DEAD = '000000000000000000000000000000000000dead', CHAINLINK = '0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee';
const BUYER = '0x1111111111111111111111111111111111111111';
const hex = (n) => '0x' + BigInt(n).toString(16);
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const e18 = (x) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
const swapLog = (block, tx, bnb, bobai) => ({ address: PAIR, blockNumber: hex(block), transactionHash: tx, logIndex: '0x0',
  topics: ['0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822', '0x' + '0'.repeat(64), '0x' + '0'.repeat(24) + BUYER.slice(2)],
  data: '0x' + word(0) + word(e18(bnb)) + word(e18(bobai)) + word(0) });
let world;
const reset = (over = {}) => {
  world = { latest: 130000000, logs: [], logCap: Infinity, sent: [], dead: 100_000_000, priceOk: true, buyerBal: e18(1234567), buyerFails: false, ...over };
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) { const m = u.split('/').pop(); world.sent.push({ method: m, body: JSON.parse(init.body || '{}') }); return json({ ok: true, result: { message_id: world.sent.length } }); }
  if (u.includes('/api/nft/state')) return json({ minted: [0, 0, 0, 0, 0, 0], cap: [100, 100, 100, 100, 100, 100], drops: [] });
  if (u.includes('logs.brainonbnb.com/logs/burns.json')) return json(world.burns || []);
  if (!init.body) return new Response('no', { status: 404 });
  let b; try { b = JSON.parse(init.body); } catch { return new Response('no', { status: 400 }); }
  const p = b.params || [];
  switch (b.method) {
    case 'eth_blockNumber': return json({ result: hex(world.latest) });
    case 'eth_getTransactionByHash': return json({ result: { from: BUYER } });
    case 'eth_getLogs': {
      const f = parseInt(p[0].fromBlock, 16), t = p[0].toBlock === 'latest' ? world.latest : parseInt(p[0].toBlock, 16);
      if (t - f + 1 > world.logCap) return json({ error: { message: 'block range too large' } });
      if (String(p[0].address).toLowerCase() !== PAIR) return json({ result: [] });
      return json({ result: world.logs.filter((l) => { const n = parseInt(l.blockNumber, 16); return n >= f && n <= t; }) });
    }
    case 'eth_call': {
      const to = String(p[0].to).toLowerCase(), d = String(p[0].data);
      if (to === CHAINLINK) return json({ result: '0x' + word(600n * 10n ** 8n) });
      if (to === PAIR) return world.priceOk ? json({ result: '0x' + word(e18(200_000_000)) + word(e18(50)) + word(0) }) : json({ error: { message: 'down' } });
      if (to === TOKEN && d.startsWith('0x18160ddd')) return json({ result: '0x' + word(e18(1_000_000_000)) });
      if (to === TOKEN && d.startsWith('0x70a08231')) {
        const who = d.slice(-40);
        if (who === DEAD) return json({ result: '0x' + word(e18(world.dead)) });
        if (who === BUYER.slice(2)) return world.buyerFails ? json({ error: { message: 'down' } }) : json({ result: '0x' + word(world.buyerBal) });
        return json({ result: '0x' + word(0) });
      }
      return json({ error: { message: 'unknown call' } });
    }
    default: return json({ error: { message: 'unknown' } });
  }
};
const store = new Map();
const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, String(v)); }, delete: async (k) => { store.delete(k); }, list: async () => ({ keys: [] }) };
const env = { KV, BOT_TOKEN: 'x', TG_INTERNAL_CHAT_ID: '', BROADCAST_SECRET: 's' };
const tick = async (at) => { quiet(); try { await worker.default.scheduled({ scheduledTime: at }, env, { waitUntil() {} }); } finally { loud(); } };
const health = async () => { quiet(); try { return await (await worker.default.fetch(new Request('https://tg/health'), env, { waitUntil() {} })).json(); } finally { loud(); } };
const fresh = (kv = {}) => { store.clear(); store.set('commands_version', 'v17-tax'); store.set('last_burned', String(100_000_000)); for (const [k, v] of Object.entries(kv)) store.set(k, typeof v === 'string' ? v : JSON.stringify(v)); };
const quietMinute = (m) => { const d = new Date(); d.setUTCHours(11, m, 0, 0); return d.getTime(); };
const now = Date.now(), DAY = 864e5;

try {
  // 1 -------------------------------------------------------------------------
  reset({ logCap: 50 });
  const TX1 = '0x' + 'a1'.repeat(32);
  world.logs = [swapLog(world.latest - 300, TX1, 0.5, 2_000_000)];
  fresh();
  for (let i = 1; i <= 6; i++) await tick(quietMinute(i));
  const queued = JSON.parse(store.get('pending_nft_buys') || '[]');
  is('1 a degraded read walks on from its cursor: a $300 buy 300 blocks back is found and queued (the old cut saw 50 blocks)', queued.some((q) => q.txHash === TX1), `queue: ${JSON.stringify(queued.map((q) => q.txHash))}`);
  const h1 = await health();
  is('1 /health names the degraded scan (scan_degraded_since) and its cursor', typeof h1.scan_degraded_since === 'string' && !!h1.scan_cursor?.buys, JSON.stringify({ s: h1.scan_degraded_since, c: h1.scan_cursor }));

  // 2 -------------------------------------------------------------------------
  const TX2 = '0x' + 'b2'.repeat(32), ledger = [];
  for (let t = now - 7.2 * DAY; t < now; t += 6 * 3600e3) ledger.push({ t, from: 1, to: Math.round(t / 1000), buys: 1, sells: 0, vol_bnb: 0.33, buy_bnb: 0.33, sell_bnb: 0, bnb_usd: 600, price_bnb: 2.5e-7, big: [[1, 0.333, 1e6, '0x' + Math.round(t).toString(16).padStart(64, '0'), '0x2222222222222222222222222222222222222222']] });
  const alertedBefore = { since: now - 8 * DAY, buys: [{ tx: '0xold', buyer: BUYER, usd: 150, ts: now - DAY }] };
  const pend = [{ bnbAmount: 0.5, bobaiAmount: 2_000_000, usdValue: 300, buyer: BUYER, txHash: TX2, queuedAt: now - 10 * 60e3 }];
  reset();
  fresh({ swap_buckets: ledger, alerted_buys: alertedBefore, pending_nft_buys: pend, posted_txs: [TX2] });
  await tick(quietMinute(3));
  const photo = world.sent.find((s) => s.method === 'sendPhoto' && /NICE BUY|HUGE BUY|BIG BUY/.test(s.body.caption || ''));
  const cap = photo ? photo.body.caption : '';
  const ctxLines = cap.split('\n').filter((l) => /^📊 /.test(l));
  is('2 the buy alert carries ONE context line: holding with USD, 2nd buy from this wallet this week, largest buy in 7 days',
    ctxLines.length === 1 && /Holds 1\.23M BOBAI \(≈\$[0-9.,]+K?\)/.test(ctxLines[0]) && /2nd buy from this wallet this week/.test(ctxLines[0]) && /largest buy in 7 days/.test(ctxLines[0]), ctxLines.join(' | ') || cap.slice(0, 300));
  is('2 the brain row still counts $10 a brain ($300 = 30)', [...(cap.split('\n')[0] || '')].filter((c) => c === '🧠').length === 30, cap.split('\n')[0]);
  const rec = JSON.parse(store.get('alerted_buys') || 'null');
  is('2 the alert record holds the new alert next to the old one (written because an alert went out)', !!rec && rec.buys.length === 2 && rec.buys.some((b) => b.tx === TX2 && b.usd === 300) && rec.since === alertedBefore.since, JSON.stringify(rec));

  // 3 -------------------------------------------------------------------------
  reset({ buyerFails: true });
  fresh({ swap_buckets: ledger, pending_nft_buys: pend, posted_txs: [TX2] });
  await tick(quietMinute(4));
  const cap3 = (world.sent.find((s) => s.method === 'sendPhoto' && /BUY/.test(s.body.caption || '')) || { body: {} }).body.caption || '';
  is('3 a failed balance read leaves the holding out (never "holds 0"); the rest still says what is known', !!cap3 && !/[Hh]olds/.test(cap3) && /largest buy in 7 days/i.test(cap3), cap3.split('\n').filter((l) => /📊/.test(l)).join(' | ') || cap3.slice(0, 200));
  is('3 a first alert ever starts the record without inventing a history', (() => { const r = JSON.parse(store.get('alerted_buys') || 'null'); return !!r && r.buys.length === 1 && !/buy from this wallet/.test(cap3); })());

  // 4 -------------------------------------------------------------------------
  const d0 = new Date(); d0.setUTCHours(16, 7, 0, 0); const at16 = d0.getTime();
  const day = [];
  for (let i = 0; i < 144; i++) { const t = at16 - DAY + (i + 1) * 600e3; day.push({ t, from: i * 1000, to: i * 1000 + 999, buys: 2, sells: 1, vol_bnb: 0.3, buy_bnb: 0.2, sell_bnb: 0.1, bnb_usd: 600, price_bnb: 2.5e-7, ...(i === 50 ? { big: [[1, 1.5, 6e6, '0x' + 'c3'.repeat(32), BUYER], [0, 0.9, 3.6e6, '0x' + 'd4'.repeat(32), PAIR]] } : {}) }); }
  reset();
  world.burns = [{ time: new Date(at16 - 3600e3).toISOString(), bobaiBurned: '20000' }, { time: new Date(at16 - 2 * DAY).toISOString(), bobaiBurned: '99999' }];
  fresh({ swap_buckets: day });
  await tick(at16);
  const cards = world.sent.filter((s) => s.method === 'sendMessage' && /the last \d+ hours on the pool/.test(s.body.text || ''));
  const card = cards[0] ? cards[0].body.text : '';
  is('4 the market card goes to the group: 288 buys ($17.3K) vs 144 sells ($8.6K), net +14.400 BNB, largest buy $900 and sell $540, 20K BOBAI burned with USD',
    cards.length === 1 && cards[0].body.chat_id === '-1003791636543' && /Buys: <b>288<\/b> · \$17\.3K/.test(card) && /Sells: <b>144<\/b> · \$8\.6K/.test(card) && /\+14\.400 BNB \(≈\$[0-9.]+K\) into the pool/.test(card)
    && /Largest buy: \$900\.00/.test(card) && /Largest sell: \$540\.00/.test(card) && /20\.0K BOBAI<\/b> \(≈\$[0-9.]+\) in 1 run/.test(card), card.slice(0, 600));
  world.sent = [];
  await tick(at16 + 600e3);
  is('4 … once a day: the date flag stops the next tick', store.get('market_card_date') === new Date(at16).toISOString().slice(0, 10) && !world.sent.some((s) => /hours on the pool/.test(s.body.text || '')));
  is('4 the ledger books each side\'s BNB (buy_bnb / sell_bnb) — the card has a split to read', /buy_bnb: Number\(buyWei\) \/ 1e18, sell_bnb: Number\(sellWei\) \/ 1e18/.test(fs.readFileSync(path.join(ROOT, 'worker-tg-bot', 'index.js'), 'utf8')));

  // 5 -------------------------------------------------------------------------
  reset({ priceOk: false, dead: 100_005_000 });
  fresh();
  await tick(quietMinute(5));
  const stuck = store.get('burn_stuck_since');
  is('5 a burn whose alert cannot go out (no price) is marked burn_stuck_since', !!stuck && store.get('last_burned') === String(100_000_000), JSON.stringify({ stuck, last: store.get('last_burned') }));
  world.priceOk = true;
  await tick(quietMinute(6));
  is('5 … and the mark goes once the alert went out', !store.has('burn_stuck_since') && Number(store.get('last_burned')) === 100_005_000, JSON.stringify({ stuck: store.get('burn_stuck_since'), last: store.get('last_burned') }));

  // 6 -------------------------------------------------------------------------
  reset({ dead: 100_200_000 });
  const TXM = '0x' + 'e5'.repeat(32), TXP = '0x' + 'f6'.repeat(32);
  fresh({ swap_buckets: [{ t: now - 3600e3, from: 1, to: 2, buys: 2, sells: 0, buy_bnb: 1, sell_bnb: 0, bnb_usd: 600, big: [[1, 0.5, 2e6, TXM, BUYER], [1, 0.4, 1.6e6, TXP, BUYER], [1, 0.9, 3e6, '0x' + '99'.repeat(32), '0xdefc0e900dfc83e207902cf22265ae63f94c01ce']] }],
    posted_txs: [TXP], pending_nft_buys: [{ txHash: TXP, queuedAt: now - 20 * 60e3 }], burn_stuck_since: new Date(now - 2 * 3600e3).toISOString() });
  const h6 = await health();
  const ba = h6.buy_alerts || {};
  is('6 /health: 2 buys of $100+ (one of ours left out), 1 marked, the untold one named; the queue\'s oldest 20 min',
    ba.buys_100_24h === 2 && ba.posted === 1 && ba.missing_count === 1 && ba.missing[0] === TXM && ba.pending?.count === 1 && ba.pending?.oldest_min === 20, JSON.stringify(ba));
  is('6 /health: burn_alerts names last_burned, the dead balance, the gap and since when it is stuck', h6.burn_alerts?.last_burned === 100_000_000 && Math.round(h6.burn_alerts?.gap) === 200_000 && !!h6.burn_alerts?.stuck_since, JSON.stringify(h6.burn_alerts));
  is('6 /health: the market card\'s date is listed with the daily posts', !!h6.daily && 'market_card' in h6.daily, JSON.stringify(h6.daily));

  // 7 -------------------------------------------------------------------------
  let H = null;
  try { H = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'health-checks.mjs')).href); } catch (e) { H = {}; }
  const tv = H.tgEvidenceVerdicts ? H.tgEvidenceVerdicts(h6) : [];
  const byName = (re) => tv.find((v) => re.test(v.name)) || {};
  is('7 the health rule reads the bot\'s own /health: the untold buy, the 20-min queue and the burn stuck 2 h are red',
    tv.length === 3 && byName(/was posted/).good === false && /never told/.test(byName(/was posted/).detail) && byName(/15 min/).good === false && byName(/burn alerts/).good === false, JSON.stringify(tv));
  const keep = H.keepVerdict;
  is('7 808.41 to the hundredth: dust is fine, 808.39 and 26,792 are red, an unread wallet is red',
    !!keep && keep('a', 808410000002992638762n).good && !keep('a', 808390000000000000000n).good && !keep('a', 26792110000000000000000n).good && !keep('a', null).good);
  const want = ['0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce', '0x15Ba17075ef5E0736292b030e3715d9100fe3d38', '0xBFB4b49787CE948C1Ee304f6C197a0E8b038ddb2', '0x5E4102520A71B2AA18a1208330d4848dea4BD105', '0x5c82D2F12EE6AC09297784f94ebF9331277Bdc3C'];
  const liq = fs.existsSync(path.join(ROOT, 'add-liquidity-safe.js')) ? fs.readFileSync(path.join(ROOT, 'add-liquidity-safe.js'), 'utf8') : fs.readFileSync(path.join(import.meta.dirname, '..', 'add-liquidity-safe.js'), 'utf8');
  is('7 the five wallets are the operator\'s list, and 1ce / d38 are the wallets whose code keeps 808.41', !!H.KEEP_808_WALLETS && want.every((a) => Object.values(H.KEEP_808_WALLETS).includes(a)) && Object.keys(H.KEEP_808_WALLETS).length === 5
    && /KEEP_BOBAI = parseEther\('808\.41'\)/.test(liq) && /0x15Ba17075ef5E0736292b030e3715d9100fe3d38/.test(liq) && H.BUYBACK_WALLET === want[0]);
  const lv = H.lightVerdicts ? (tg, logs) => H.lightVerdicts(tg, logs, now).filter((v) => !v.good).map((v) => v.name).join('|') : () => 'missing';
  const hb = new Date(now - 5 * 60e3).toISOString();
  is('7 the hourly look: green when both heartbeats are fresh; a dead cron, a kicked bot, a 2-h-old buyback each red; no answer red',
    lv({ ok: true, cron_alive: true, channel_configured: true }, { buyback: hb }) === ''
    && lv({ ok: true, cron_alive: false, channel_configured: true }, { buyback: hb }) === 'telegram bot cron alive'
    && lv({ ok: true, cron_alive: true, channel_configured: true, last_send_error: { at: hb, lasting: true, method: 'sendPhoto', description: 'kicked' } }, { buyback: hb }) === 'telegram bot can post'
    && lv({ ok: true, cron_alive: true, channel_configured: true }, { buyback: new Date(now - 2 * 3600e3).toISOString() }) === 'buyback bot ran recently'
    && lv(null, null) === 'telegram bot answers|buyback bot ran recently');
  const hsrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'health-checks.mjs'), 'utf8');
  const run = hsrc.slice(hsrc.indexOf('export async function runHealth'));
  is('7 runHealth asks them every morning (told buys, burn alerts, the five wallets, the market card) and pins its rules', /tgEvidenceVerdicts\(j\)/.test(run) && /readKeepBalances\(RPC\)/.test(run) && /dailyOnTime\(d\.market_card, 19\)/.test(run) && /tgEvidenceHolds\(\)/.test(run) && /keepHolds\(\)/.test(run));

  // 8 -------------------------------------------------------------------------
  let W = {};
  try { W = await import(pathToFileURL(path.join(ROOT, 'worker-health', 'index.js')).href); } catch { W = {}; }
  const toml = fs.readFileSync(path.join(ROOT, 'worker-health', 'wrangler.toml'), 'utf8');
  const crons = ((toml.match(/crons\s*=\s*\[([^\]]*)\]/) || [])[1] || '').match(/"[^"]+"/g) || [];
  is('8 the health worker has an hourly cron next to the 09:10 one, and the code knows it by name', crons.includes('"10 9 * * *"') && !!W.LIGHT_CRON && crons.includes(`"${W.LIGHT_CRON}"`) && /^\d+ \* \* \* \*$/.test(W.LIGHT_CRON || ''), crons.join(','));
  const asked = [];
  const tgGreen = { fetch: async (u) => { asked.push(String(u)); return json(/health/.test(String(u)) ? { ok: true, cron_alive: true, channel_configured: true } : { ok: true, message_id: 1 }); } };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { asked.push(String(u)); return /logs\.brainonbnb\.com\/health/.test(String(u)) ? json({ buyback: new Date().toISOString() }) : new Response('{}', { status: 404 }); };
  const waits = [];
  try { quiet(); if (W.default) await W.default.scheduled({ cron: W.LIGHT_CRON }, { TG: tgGreen, BROADCAST_SECRET: 's' }, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits); } catch (e) { asked.push('threw ' + e.message); } finally { loud(); globalThis.fetch = prevFetch; }
  is('8 the hourly cron runs the light look only (two heartbeats) and says nothing when green', asked.length === 2 && asked.some((u) => /tg\/health|workers\.dev\/health/.test(u)) && asked.some((u) => /logs\.brainonbnb\.com\/health/.test(u)) && !asked.some((u) => /broadcast/.test(u)), asked.join(' '));
  const mails = [];
  const ef = W.emailFallback;
  const r1 = ef ? await (async () => { quiet(); try { return await ef({}, 'x', async () => { mails.push(1); return { ok: true }; }); } finally { loud(); } })() : null;
  const r2 = ef ? await ef({ RESEND_API_KEY: 'k', ALERT_EMAIL_TO: 'a@b.c' }, '🚨 <b>Health</b> · 1 FAILING\n❌ <b>Bots</b> · x &lt;y&gt;', async (u, init) => { mails.push({ u, body: JSON.parse(init.body) }); return { ok: true }; }) : null;
  is('8 the e-mail fallback: skipped without its secrets, plain text with them', r1 === 'not configured' && r2 === 'sent' && mails.length === 1 && mails[0].u === 'https://api.resend.com/emails' && mails[0].body.text === '🚨 Health · 1 FAILING\n❌ Bots · x <y>' && mails[0].body.subject === '🚨 Health · 1 FAILING', JSON.stringify({ r1, r2, mails }));
} finally { globalThis.fetch = real.fetch; loud(); }

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
