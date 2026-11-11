// BOBAI POP — the Brain Pop server (2026-11-06). The plan of the day, the boards, the check of every run, the prize pool.
// Behind brainonbnb.com/api/pop/* (proxied by dashboard/_worker.js, so the page talks to its own origin).
//
// BRAIN POP 2.0 (operator, 6.11.: "aim, skill, logic, luck; the seven stations as super powers that come by themselves;
// e-sports world championship worthy; 60 seconds stay"): the game is temp/terminal-site/terminal/pop-engine.mjs — ONE
// file, played by the terminal and bundled here. A run is its taps [t, x, y]; this worker REPLAYS them with the same
// engine, so the score on the board is the score the taps really made, aim included. 2.0 has its own tables (runs3,
// best3): the boards began again with it (operator: "reset"); 1.0's tables stay as they were.
//
//   GET  /api/pop/day[?d=YYYY-MM-DD]  the day's number, its 2.0 plan, the names to pick from, the day's top 10
//   POST /api/pop/start  {pid, name, d?}             a run begins: its id; d = an older day is a rematch, not ranked
//   POST /api/pop/finish {run, inputs:[[t,x,y]]}     the run is replayed and counted, its place told
//   GET  /api/pop/run/<id>                           one finished run: name, day, score, timeline (ghost), its taps (replay)
//   GET  /api/pop/top?scope=day|all[&d=]             the boards (top 10)
//   GET  /api/pop/pool                               the prize pool: the $BOBAI in the Giggle/prize wallet, from the chain
//   POST /api/pop/name {pid, name}                   a new name shows on the boards at once
//   GET  /api/pop/claim/<code>                       the prize check (the player's private code)
//   GET  /api/pop/stats                              the funnel per day
//   GET  /api/pop/wallet?pid=                        the player's holder badge (7.11.): linked?, $BOBAI, badge
//   POST /api/pop/wallet {pid, wallet, issued, signature} | {pid, unlink: true}   link a wallet by a signature (no transaction)
//
// No free text anywhere: a name is three numbers into lists or the player's own (letters, digits, _), brainrotted.

import { nameOf, dayOf, dayNo, validDay, seasonOver, ADJ, NOUN, ROT, ROT_KIND, FIRST_DAY, LAST_DAY } from './game.js';
import { checkLink, balanceOf, tierOf, linkMessage, TIERS, STALE_MS } from './wallet.js';
// 6.9 ONCE MORE (operator, 6.11.: 'back to the first 6.9, in the whole terminal, with super combos and helpers'): the tap game,
// pop-engine.mjs, now with SUPER/MEGA/GOD combos and the DeFi helper; its boards (runs3/best3) began at 0 with it
import { plan, replay, RUN_MS, V, WEAPONS, UNIT } from '../temp/terminal-site/terminal/pop-engine.mjs';
// scores are kept in whole units of 0.0000001 (the engine's UNIT) and sent as points with seven decimals
const P7 = (u) => Math.round(u) / UNIT;
const rowsP = (L) => L.map((r) => ({ ...r, score: P7(r.score) }));
// a player's private code (the overall winner shows it to claim the prize): the first 8 of sha-256 of the browser's id
const claimOf = async pid => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('brainpop:' + pid)))].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

const J = (o, s = 200, cache = 'no-store') => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } });
const STARTS_PER_IP_DAY = 120;
const test0 = pid => String(pid).startsWith('f00d'); // our own checks: never on the board, never in the counts
// where a player came from (11.11.): the game sends ?from= / {from}; a short known shape or 'other', so nobody can
// invent count keys. came_<from> = a new visitor of the day, played_<from> = their first round of the day.
const fromOf = v => { const s = String(v || ''); return /^[a-z0-9-]{1,16}$/.test(s) ? s : 'other'; };
// THE PRIZE POOL (operator, 6.11.): the Giggle/prize wallet's $BOBAI — the 808.41 it holds are the start, every $BOBAI
// donated to it adds; on 30 Nov the overall #1 gets ALL of it. Anything else sent there (BNB, stables) stays there and is
// NOT part of the pool — the page says it plainly: send only $BOBAI.
const POOL_WALLET = '0x5E4102520A71B2AA18a1208330d4848dea4BD105', BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc.publicnode.com'];

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (!u.pathname.startsWith('/api/pop/')) return J({ error: 'not found' }, 404);
    const o = env.POP.get(env.POP.idFromName('board'));
    return o.fetch(req);
  },
};

export class PopBoard {
  constructor(state, env) {
    this.sql = state.storage.sql; this.env = env; this.pool = null;
    // 2.0's own tables; inputs = the taps of a run (its replay)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs3 (id TEXT PRIMARY KEY, day TEXT, pid TEXT, name TEXT, ranked INT, ip TEXT, started INT, finished INT, score INT, maxc INT, pops INT, misses INT, rugs INT, timeline TEXT, inputs TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS best3 (day TEXT, pid TEXT, name TEXT, score INT, run TEXT, at INT, PRIMARY KEY (day, pid))`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS best3_day ON best3 (day, score DESC, at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS runs3_ip ON runs3 (day, ip)`);
    // every round its own seed (operator 6.11.: "every round must have its randomness"): drawn at the start, replayed with
    try { this.sql.exec('ALTER TABLE runs3 ADD COLUMN seed INT'); } catch {}
    // 1.0's tables go (operator, 6.11.: "the 1.0 highscores need no archive")
    this.sql.exec('DROP TABLE IF EXISTS runs'); this.sql.exec('DROP TABLE IF EXISTS best');
    // the first 6.9 tables go too: with the super combos and helpers the scores are new (operator: 'highscore at 0')
    this.sql.exec('DROP TABLE IF EXISTS runs2'); this.sql.exec('DROP TABLE IF EXISTS best2');
    // the game's funnel per day (GET /api/pop/stats)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS counts (day TEXT, k TEXT, n INT, PRIMARY KEY (day, k))`);
    // THE HOLDER BADGE (7.11.): a player's linked wallet and its $BOBAI as last read; only the badge reaches a board
    // who opened the game window, once per player and day (7.11.: 'opened' counts every opening, not people)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS seen (day TEXT, pid TEXT, PRIMARY KEY (day, pid))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS wallets (pid TEXT PRIMARY KEY, wallet TEXT, bobai REAL, read_at INT, linked_at INT)`);
  }
  rows(q, ...a) { return [...this.sql.exec(q, ...a)]; }
  bump(day, k, by = 1) { this.sql.exec(`INSERT INTO counts (day, k, n) VALUES (?, ?, ?) ON CONFLICT (day, k) DO UPDATE SET n = n + ?`, day, String(k).slice(0, 60), by, by); }
  top(scope, day, n = 10) {
    if (scope === 'day') return this.badged(rowsP(this.rows(`SELECT b.name, b.score, b.run, w.bobai FROM best3 b LEFT JOIN wallets w ON w.pid = b.pid WHERE b.day = ? ORDER BY b.score DESC, b.at ASC LIMIT ?`, day, n)));
    // overall: a player's best single run of the season (under the name they play as now)
    return this.badged(rowsP(this.rows(`SELECT b.name, b.score, b.run, w.bobai FROM best3 b JOIN (SELECT pid, MAX(score) s FROM best3 GROUP BY pid) m ON b.pid = m.pid AND b.score = m.s
      LEFT JOIN wallets w ON w.pid = b.pid GROUP BY b.pid ORDER BY b.score DESC, MIN(b.at) ASC LIMIT ?`, n)));
  }
  // the badge in place of the balance: a board never carries a wallet or an amount
  badged(L) { return L.map(({ bobai, ...r }) => ({ ...r, badge: bobai == null ? null : tierOf(bobai) })); }
  // a linked wallet read again when its reading is older than 6 h (a holder who sold loses the badge)
  async refreshWallet(pid, force = false) {
    const w = this.rows('SELECT wallet, bobai, read_at FROM wallets WHERE pid = ?', pid)[0]; if (!w) return null;
    if (!force && Date.now() - w.read_at < STALE_MS) return w;
    const b = await balanceOf(w.wallet); if (b == null) return w;
    this.sql.exec('UPDATE wallets SET bobai = ?, read_at = ? WHERE pid = ?', b, Date.now(), pid); return { ...w, bobai: b, read_at: Date.now() };
  }
  players(day) { return this.rows(`SELECT COUNT(*) c FROM best3 WHERE day = ?`, day)[0].c; }
  async readPool() {
    if (this.pool && Date.now() - this.pool.at < 120e3) return this.pool;
    const data = '0x70a08231' + POOL_WALLET.slice(2).toLowerCase().padStart(64, '0');
    for (const rpc of RPCS) {
      try {
        const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: BOBAI, data }, 'latest'] }), signal: AbortSignal.timeout(6000) });
        const j = await r.json(); if (!j.result) continue;
        const wei = BigInt(j.result); this.pool = { at: Date.now(), bobai: Number(wei / 10n ** 14n) / 1e4 }; return this.pool;
      } catch {}
    }
    return this.pool; // the last answer, if the chain did not answer now
  }
  async fetch(req) {
    const u = new URL(req.url), now = Date.now(), today = dayOf(now), p = u.pathname.slice('/api/pop/'.length);
    const ip = (req.headers.get('x-pop-ip') || req.headers.get('cf-connecting-ip') || '').slice(0, 64);
    try {
      if (req.method === 'GET' && p === 'day') {
        if (!u.searchParams.has('own')) this.bump(today, u.searchParams.get('d') && u.searchParams.get('d') !== today ? 'opened_challenge' : 'opened');
        { const sp = String(u.searchParams.get('p') || ''); if (/^[0-9a-f]{16}$/.test(sp) && !test0(sp) && !u.searchParams.has('own') && !this.rows('SELECT 1 FROM seen WHERE day = ? AND pid = ?', today, sp).length) { this.sql.exec('INSERT INTO seen (day, pid) VALUES (?, ?)', today, sp); this.bump(today, 'opened_players'); if (u.searchParams.has('from')) this.bump(today, 'came_' + fromOf(u.searchParams.get('from'))); } }
        const d = u.searchParams.get('d') || today; if (!validDay(d, today)) return J({ error: 'no such day' }, 400);
        return J({ v: V, day: d, no: dayNo(d), today, ms: RUN_MS, plan: plan(d), weapons: WEAPONS, names: { adj: ADJ, noun: NOUN, rot: ROT, kind: ROT_KIND }, top: this.top('day', d), players: this.players(d) });
      }
      // a share, counted by where it went (7.11.: nobody knew whether runs are shared); only known targets, nothing stored
      if (req.method === 'GET' && p === 'share') {
        const to = String(u.searchParams.get('to') || ''); if (!/^(x|telegram|whatsapp|discord|copy|sheet|save|dare|game)$/.test(to)) return J({ error: 'unknown target' }, 400);
        if (!u.searchParams.has('own')) this.bump(today, 'share_' + to);
        return J({ ok: true });
      }
      if (req.method === 'GET' && p === 'pool') {
        const pl = await this.readPool();
        return J({ wallet: POOL_WALLET, bobai: pl ? pl.bobai : null, read_at: pl ? new Date(pl.at).toISOString() : null, rule: 'Only $BOBAI counts. The overall #1 on 30 Nov gets all of it. Anything else sent to this wallet is lost.' }, 200, 'public, max-age=60');
      }
      // the operator hides a name from every board (it becomes a random one); needs the admin key (wrangler secret POP_ADMIN)
      if (req.method === 'POST' && p === 'hide') {
        const b = await req.json().catch(() => ({})); if (!this.env.POP_ADMIN || b.key !== this.env.POP_ADMIN) return J({ error: 'no' }, 403);
        const to = 'HIDDEN ' + Math.floor(Math.random() * 900 + 100), n1 = this.rows('SELECT COUNT(*) c FROM best3 WHERE name = ?', String(b.name || ''))[0].c;
        this.sql.exec('UPDATE best3 SET name = ? WHERE name = ?', to, String(b.name || '')); this.sql.exec('UPDATE runs3 SET name = ? WHERE name = ?', to, String(b.name || ''));
        return J({ hidden: String(b.name || ''), as: to, rows: n1 });
      }
      if (req.method === 'GET' && p === 'stats') {
        const out = {}; for (const r of this.rows('SELECT day, k, n FROM counts WHERE day >= ? ORDER BY day, k', dayOf(now - 13 * 86400e3))) (out[r.day] ||= {})[r.k] = r.n;
        for (const d of Object.keys(out)) out[d].players = this.players(d);
        return J({ days: out });
      }
      if (req.method === 'GET' && p === 'top') {
        const s = u.searchParams.get('scope') === 'all' ? 'all' : 'day', last = today > LAST_DAY ? LAST_DAY : today, d = u.searchParams.get('d') || last;
        if (s === 'day' && !validDay(d, today)) return J({ error: 'no such day' }, 400);
        return J({ scope: s, day: s === 'day' ? d : last, no: dayNo(s === 'day' ? d : last), first: FIRST_DAY, last, rows: this.top(s, d, 10), players: s === 'day' ? this.players(d) : this.rows('SELECT COUNT(DISTINCT pid) c FROM best3')[0].c }, 200, 'public, max-age=20');
      }
      // the prize check: which player has this code, and where they stand overall (no code is ever listed anywhere)
      if (req.method === 'GET' && p.startsWith('claim/')) {
        const code = p.slice(6).toUpperCase(); if (!/^[0-9A-F]{8}$/.test(code)) return J({ error: 'a code is 8 hex characters' }, 400);
        const all = this.rows('SELECT pid, MAX(score) s FROM best3 GROUP BY pid ORDER BY s DESC');
        for (let k = 0; k < all.length; k++) if (await claimOf(all[k].pid) === code) { const n = this.rows('SELECT name FROM best3 WHERE pid = ? ORDER BY score DESC LIMIT 1', all[k].pid)[0]; return J({ code, name: n && n.name, best: P7(all[k].s), overall_place: k + 1, players: all.length, season_over: seasonOver(today) }); }
        return J({ code, found: false });
      }
      if (req.method === 'GET' && p.startsWith('run/')) {
        const r = this.rows(`SELECT id, day, name, score, maxc, pops, misses, rugs, timeline, inputs, ranked, seed FROM runs3 WHERE id = ? AND finished IS NOT NULL`, p.slice(4))[0];
        if (!r) return J({ error: 'no such run' }, 404);
        return J({ v: V, run: r.id, day: r.day, no: dayNo(r.day), seed: r.seed, name: r.name, score: P7(r.score), maxc: r.maxc, pops: r.pops, misses: r.misses, rugs: r.rugs, ranked: !!r.ranked, timeline: JSON.parse(r.timeline || '[]'), inputs: JSON.parse(r.inputs || '[]') }, 200, 'public, max-age=300');
      }
      // THE HOLDER BADGE (7.11.): read or link; a link is a signature (personal_sign) of linkMessage, never a transaction
      if (p === 'wallet' && req.method === 'GET') {
        const pid = String(u.searchParams.get('pid') || ''); if (!/^[0-9a-f]{16}$/.test(pid)) return J({ error: 'pid (16 hex) needed' }, 400);
        const w = await this.refreshWallet(pid);
        return J({ linked: !!w, wallet: w ? w.wallet : null, bobai: w ? w.bobai : null, badge: w ? tierOf(w.bobai) : null, tiers: TIERS, message: 'BOBAI Brain Pop holder badge\nplayer: <pid>\nwallet: <lowercase address>\nissued: <ISO time>' });
      }
      if (p === 'wallet' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (b.unlink) { const pid = String(b.pid || ''); if (!/^[0-9a-f]{16}$/.test(pid)) return J({ error: 'pid (16 hex) needed' }, 400); this.sql.exec('DELETE FROM wallets WHERE pid = ?', pid); return J({ linked: false }); }
        const c = await checkLink(b, now); if (!c.ok) return J({ error: c.error }, c.status);
        const bal = await balanceOf(c.wallet); if (bal == null) return J({ error: 'the chain did not answer, try again in a minute' }, 503);
        this.sql.exec('INSERT OR REPLACE INTO wallets (pid, wallet, bobai, read_at, linked_at) VALUES (?, ?, ?, ?, ?)', c.pid, c.wallet, bal, now, now);
        if (!test0(c.pid)) this.bump(today, 'wallet_linked' + (tierOf(bal) ? '_' + tierOf(bal) : ''));
        return J({ linked: true, wallet: c.wallet, bobai: bal, badge: tierOf(bal), tiers: TIERS });
      }
      // a new name shows on the boards at once (BRAINROT IT or the dice), not only after the next run
      if (req.method === 'POST' && p === 'name') {
        const b = await req.json().catch(() => ({})), name = nameOf(b.name), pid = String(b.pid || '');
        if (!/^[0-9a-f]{16}$/.test(pid) || !name) return J({ error: 'a name is 3 to 16 letters, digits or _ (no spaces, no dots)' }, 400);
        if (!test0(pid)) this.sql.exec('UPDATE best3 SET name = ? WHERE pid = ?', name, pid);
        return J({ name, rows: this.rows('SELECT COUNT(*) c FROM best3 WHERE pid = ?', pid)[0].c });
      }
      if (req.method === 'POST' && p === 'start') {
        const b = await req.json().catch(() => ({})), name = nameOf(b.name), pid = String(b.pid || '');
        if (b.v !== V) return J({ error: 'Brain Pop 6.9 is here: reload the page' }, 426);
        if (!/^[0-9a-f]{16}$/.test(pid)) return J({ error: 'pid (16 hex) needed' }, 400);
        if (!name) return J({ error: 'a name is 3 to 16 letters, digits or _ (no spaces, no dots)' }, 400);
        if (seasonOver(today) && !b.d) return J({ error: 'the season is over (30 Nov); the boards stay' }, 410);
        const d = b.d || today; if (!validDay(d, today)) return J({ error: 'no such day' }, 400);
        if (ip && this.rows(`SELECT COUNT(*) c FROM runs3 WHERE day = ? AND ip = ?`, today, ip)[0].c >= STARTS_PER_IP_DAY) return J({ error: 'enough runs from here today, come back tomorrow (UTC)' }, 429);
        const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12), test = test0(pid); /* our own checks play for real but never reach the board */
        const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1; // the round's die
        if (!test && b.from && !this.rows('SELECT 1 FROM runs3 WHERE day = ? AND pid = ? LIMIT 1', today, pid).length) this.bump(today, 'played_' + fromOf(b.from));
        this.sql.exec(`INSERT INTO runs3 (id, day, pid, name, ranked, ip, started, seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, d, pid, name, d === today && !test ? 1 : 0, ip, now, seed);
        // a player is the browser, the name is its latest: every board row of this player takes it at once
        if (!test) this.sql.exec('UPDATE best3 SET name = ? WHERE pid = ?', name, pid);
        if (Math.random() < 0.02) this.sql.exec(`DELETE FROM runs3 WHERE finished IS NULL AND started < ?`, now - 86400e3);
        if (!test) this.bump(today, d === today ? 'started' : 'started_rematch');
        return J({ v: V, run: id, day: d, no: dayNo(d), seed, ranked: d === today && !test, name });
      }
      if (req.method === 'POST' && p === 'finish') {
        const b = await req.json().catch(() => ({}));
        if (!b.inputs) return J({ error: 'Brain Pop 6.9 is here: reload the page' }, 426);
        const r = this.rows(`SELECT * FROM runs3 WHERE id = ?`, String(b.run || ''))[0];
        if (!r) return J({ error: 'no such run' }, 404);
        if (r.finished) return J({ error: 'this run is counted already' }, 409);
        const took = now - r.started;
        if (took < RUN_MS - 3000) return J({ error: 'the minute is not over yet' }, 400);
        if (took > 15 * 60e3) return J({ error: 'too late for this run, start a new one' }, 400);
        const c = replay(r.day, b.inputs, r.seed || 0);
        if (!c) { this.bump(r.day, 'refused_run'); this.sql.exec(`UPDATE runs3 SET finished = ?, score = 0, pops = 0 WHERE id = ?`, now, r.id); return J({ error: 'not counted: the taps could not be read' }, 422); }
        this.sql.exec(`UPDATE runs3 SET finished = ?, score = ?, maxc = ?, pops = ?, misses = ?, rugs = ?, timeline = ?, inputs = ? WHERE id = ?`, now, c.score, c.maxc, c.pops, c.misses, c.rugs, JSON.stringify(c.timeline), JSON.stringify(b.inputs.slice(0, 900)), r.id);
        let best = c.score, rank = null, players = null;
        if (r.ranked) {
          const old = this.rows(`SELECT score FROM best3 WHERE day = ? AND pid = ?`, r.day, r.pid)[0];
          if (!old || c.score > old.score) this.sql.exec(`INSERT OR REPLACE INTO best3 (day, pid, name, score, run, at) VALUES (?, ?, ?, ?, ?, ?)`, r.day, r.pid, r.name, c.score, r.id, now);
          else best = old.score;
          const me = this.rows(`SELECT score, at FROM best3 WHERE day = ? AND pid = ?`, r.day, r.pid)[0];
          rank = this.rows(`SELECT COUNT(*) c FROM best3 WHERE day = ? AND (score > ? OR (score = ? AND at < ?))`, r.day, me.score, me.score, me.at)[0].c + 1;
          players = this.players(r.day);
        }
        await this.refreshWallet(r.pid).catch(() => null); // a badge on the board is as fresh as the player's last run
        if (!test0(r.pid)) { this.bump(r.day, 'finished'); if (c.applied < b.inputs.length) this.bump(r.day, 'taps_not_applied', b.inputs.length - c.applied); }
        return J({ v: V, run: r.id, day: r.day, no: dayNo(r.day), seed: r.seed, name: r.name, score: P7(c.score), maxc: c.maxc, pops: c.pops, misses: c.misses, rugs: c.rugs, taps: c.taps, weapons: c.weapons, code: await claimOf(r.pid), ranked: !!r.ranked, best: P7(best), rank, players, top: this.top('day', r.day) });
      }
      return J({ error: 'not found' }, 404);
    } catch (e) { return J({ error: 'server: ' + String(e.message || e).slice(0, 120) }, 500); }
  }
}
