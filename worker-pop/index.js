// BOBAI POP — the Brain Pop daily run's server (2026-11-06). The plan of the day, the board, the check of every run.
// Behind brainonbnb.com/api/pop/* (proxied by dashboard/_worker.js, so the page talks to its own origin).
//
//   GET  /api/pop/day[?d=YYYY-MM-DD]  the day's number, its plan (60 s), the names to pick from, today's top 10
//   POST /api/pop/start  {pid, name:[a,b,n], d?}      a run begins: its id; d = an older day is a challenge, not ranked
//   POST /api/pop/finish {run, pops:[[i,t]], hits}     the run is checked and counted (game.js check), its place told
//   GET  /api/pop/run/<id>                            one finished run: name, day, score, its timeline (the ghost)
//   GET  /api/pop/top?scope=day|week|all               the board
//
// One Durable Object (SQLite) holds every run and every player's best of a day, so a place is always exact.
// No free text anywhere: a name is three numbers into the lists in game.js, a player is a random id from the browser.

import { plan, check, nameOf, dayOf, dayNo, validDay, seasonOver, RUN_MS, ADJ, NOUN, FIRST_DAY, LAST_DAY } from './game.js';
// a player's private code (the overall winner shows it to claim the prize): the first 8 of sha-256 of the browser's id
const claimOf = async pid => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('brainpop:' + pid)))].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

const J = (o, s = 200, cache = 'no-store') => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } });
const STARTS_PER_IP_DAY = 80;

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (!u.pathname.startsWith('/api/pop/')) return J({ error: 'not found' }, 404);
    const o = env.POP.get(env.POP.idFromName('board'));
    return o.fetch(req);
  },
};

export class PopBoard {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, day TEXT, pid TEXT, name TEXT, ranked INT, ip TEXT, started INT, finished INT, score INT, maxc INT, pops INT, timeline TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS best (day TEXT, pid TEXT, name TEXT, score INT, run TEXT, at INT, PRIMARY KEY (day, pid))`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS best_day ON best (day, score DESC, at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS runs_ip ON runs (day, ip)`);
  }
  rows(q, ...a) { return [...this.sql.exec(q, ...a)]; }
  top(scope, today, n = 10) {
    if (scope === 'day') return this.rows(`SELECT name, score, run FROM best WHERE day = ? ORDER BY score DESC, at ASC LIMIT ?`, today, n);
    const from = scope === 'week' ? dayOf(Date.parse(today + 'T00:00:00Z') - 6 * 86400e3) : FIRST_DAY;
    // a player's best single run in the span (the newest name they played under)
    return this.rows(`SELECT b.name, b.score, b.run FROM best b JOIN (SELECT pid, MAX(score) s FROM best WHERE day >= ? GROUP BY pid) m ON b.pid = m.pid AND b.score = m.s
      WHERE b.day >= ? GROUP BY b.pid ORDER BY b.score DESC, b.at ASC LIMIT ?`, from, from, n);
  }
  players(day) { return this.rows(`SELECT COUNT(*) c FROM best WHERE day = ?`, day)[0].c; }
  async fetch(req) {
    const u = new URL(req.url), now = Date.now(), today = dayOf(now), p = u.pathname.slice('/api/pop/'.length);
    const ip = (req.headers.get('x-pop-ip') || req.headers.get('cf-connecting-ip') || '').slice(0, 64);
    try {
      if (req.method === 'GET' && p === 'day') {
        const d = u.searchParams.get('d') || today; if (!validDay(d, today)) return J({ error: 'no such day' }, 400);
        return J({ day: d, no: dayNo(d), today, ms: RUN_MS, plan: plan(d), names: { adj: ADJ, noun: NOUN }, top: this.top('day', d), players: this.players(d) });
      }
      if (req.method === 'GET' && p === 'top') {
        const s = ['day', 'week', 'all'].includes(u.searchParams.get('scope')) ? u.searchParams.get('scope') : 'day', last = today > LAST_DAY ? LAST_DAY : today, d = u.searchParams.get('d') || last;
        if (s === 'day' && !validDay(d, today)) return J({ error: 'no such day' }, 400);
        return J({ scope: s, day: s === 'day' ? d : last, no: dayNo(s === 'day' ? d : last), first: FIRST_DAY, last, rows: this.top(s, s === 'day' ? d : last, 10), players: s === 'day' ? this.players(d) : this.rows('SELECT COUNT(DISTINCT pid) c FROM best')[0].c }, 200, 'public, max-age=20');
      }
      // the prize check: which player has this code, and where they stand overall (no code is ever listed anywhere)
      if (req.method === 'GET' && p.startsWith('claim/')) {
        const code = p.slice(6).toUpperCase(); if (!/^[0-9A-F]{8}$/.test(code)) return J({ error: 'a code is 8 hex characters' }, 400);
        const all = this.rows('SELECT pid, MAX(score) s FROM best GROUP BY pid ORDER BY s DESC');
        for (let k = 0; k < all.length; k++) if (await claimOf(all[k].pid) === code) { const n = this.rows('SELECT name FROM best WHERE pid = ? ORDER BY score DESC LIMIT 1', all[k].pid)[0]; return J({ code, name: n && n.name, best: all[k].s, overall_place: k + 1, players: all.length, season_over: seasonOver(today) }); }
        return J({ code, found: false });
      }
      if (req.method === 'GET' && p.startsWith('run/')) {
        const r = this.rows(`SELECT id, day, name, score, maxc, pops, timeline, ranked FROM runs WHERE id = ? AND finished IS NOT NULL`, p.slice(4))[0];
        if (!r) return J({ error: 'no such run' }, 404);
        return J({ run: r.id, day: r.day, no: dayNo(r.day), name: r.name, score: r.score, maxc: r.maxc, pops: r.pops, ranked: !!r.ranked, timeline: JSON.parse(r.timeline || '[]') }, 200, 'public, max-age=300');
      }
      if (req.method === 'POST' && p === 'start') {
        const b = await req.json().catch(() => ({})), name = nameOf(b.name), pid = String(b.pid || '');
        if (!/^[0-9a-f]{16}$/.test(pid) || !name) return J({ error: 'pid (16 hex) and name [adj, noun, 1-99] needed' }, 400);
        if (seasonOver(today) && !b.d) return J({ error: 'the season is over (30 Nov); the boards stay' }, 410);
        const d = b.d || today; if (!validDay(d, today)) return J({ error: 'no such day' }, 400);
        if (ip && this.rows(`SELECT COUNT(*) c FROM runs WHERE day = ? AND ip = ?`, today, ip)[0].c >= STARTS_PER_IP_DAY) return J({ error: 'enough runs from here today, come back tomorrow (UTC)' }, 429);
        const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12), test = pid.startsWith('f00d'); /* our own checks (qa/brainpop-daily.mjs) play for real but never reach the board */
        this.sql.exec(`INSERT INTO runs (id, day, pid, name, ranked, ip, started) VALUES (?, ?, ?, ?, ?, ?, ?)`, id, d, pid, name, d === today && !test ? 1 : 0, ip, now);
        if (Math.random() < 0.02) this.sql.exec(`DELETE FROM runs WHERE finished IS NULL AND started < ?`, now - 86400e3);
        return J({ run: id, day: d, no: dayNo(d), ranked: d === today && !test, name });
      }
      if (req.method === 'POST' && p === 'finish') {
        const b = await req.json().catch(() => ({})), r = this.rows(`SELECT * FROM runs WHERE id = ?`, String(b.run || ''))[0];
        if (!r) return J({ error: 'no such run' }, 404);
        if (r.finished) return J({ error: 'this run is counted already' }, 409);
        const took = now - r.started;
        if (took < RUN_MS - 3000) return J({ error: 'the minute is not over yet' }, 400);
        if (took > 15 * 60e3) return J({ error: 'too late for this run, start a new one' }, 400);
        const c = check(r.day, b.pops, b.hits || []);
        if (!c.ok) { this.sql.exec(`UPDATE runs SET finished = ?, score = 0, pops = 0 WHERE id = ?`, now, r.id); return J({ error: 'not counted: ' + c.why }, 422); }
        this.sql.exec(`UPDATE runs SET finished = ?, score = ?, maxc = ?, pops = ?, timeline = ? WHERE id = ?`, now, c.score, c.maxc, c.n, JSON.stringify(c.timeline), r.id);
        let best = c.score, rank = null, players = null;
        if (r.ranked) {
          const old = this.rows(`SELECT score FROM best WHERE day = ? AND pid = ?`, r.day, r.pid)[0];
          if (!old || c.score > old.score) this.sql.exec(`INSERT OR REPLACE INTO best (day, pid, name, score, run, at) VALUES (?, ?, ?, ?, ?, ?)`, r.day, r.pid, r.name, c.score, r.id, now);
          else best = old.score;
          const me = this.rows(`SELECT score, at FROM best WHERE day = ? AND pid = ?`, r.day, r.pid)[0];
          rank = this.rows(`SELECT COUNT(*) c FROM best WHERE day = ? AND (score > ? OR (score = ? AND at < ?))`, r.day, me.score, me.score, me.at)[0].c + 1;
          players = this.players(r.day);
        }
        return J({ run: r.id, day: r.day, no: dayNo(r.day), name: r.name, score: c.score, maxc: c.maxc, pops: c.n, dropped: c.dropped, drops: c.drops, code: await claimOf(r.pid), ranked: !!r.ranked, best, rank, players, top: this.top('day', r.day) });
      }
      return J({ error: 'not found' }, 404);
    } catch (e) { return J({ error: 'server: ' + String(e.message || e).slice(0, 120) }, 500); }
  }
}
