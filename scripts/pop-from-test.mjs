// node scripts/pop-from-test.mjs [base]  — Brain Pop: where players come from (11.11., operator: "measure first, then
// strengthen the channel that brings players"). Plays against the PREVIEW worker by default (bobai-pop2, its own
// database), with fresh players that are not our check prefix f00d, because test players are never counted:
//   1 a new visitor with ?from=tg counts came_tg once; the same visitor again does not
//   2 their first round counts played_tg; a second round that day does not
//   3 an invented source becomes came_other (nobody can make up count keys)
//   4 a visit without ?from counts no came_ at all (old pages keep their old counts)
//   5 /m/pop?from=tg sends the game link on with &from=tg; /m/pop/<run> without one says from=share
import { V } from '../temp/terminal-site/terminal/pop-engine.mjs';
const BASE = process.argv[2] || 'https://bobai-pop2.bobbuildonbnb.workers.dev';
const SITE = process.argv[3] || 'https://brainonbnb.com';
const pid = () => 'a' + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(1);
const J = async (p, body) => (await fetch(BASE + '/api/pop/' + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const today = new Date().toISOString().slice(0, 10);
const counts = async () => (await J('stats')).days?.[today] || {};
let fails = 0;
const ok = (name, cond, info = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (info ? ' — ' + info : '')); if (!cond) fails++; };
const d = (a, b, k) => (b[k] || 0) - (a[k] || 0);

const a = pid(), b = pid(), c = pid();
const s0 = await counts();
await J(`day?p=${a}&from=tg`); await J(`day?p=${a}&from=tg`);
await J(`day?p=${b}&from=Bad!!Source`);
await J(`day?p=${c}`);
const s1 = await counts();
ok('1 a new visitor from tg counts came_tg once', d(s0, s1, 'came_tg') === 1, `came_tg +${d(s0, s1, 'came_tg')}`);
ok('3 an invented source counts as came_other', d(s0, s1, 'came_other') === 1, `came_other +${d(s0, s1, 'came_other')}`);
ok('4 a visit without from counts no came_', Object.keys(s1).filter((k) => k.startsWith('came_')).reduce((n, k) => n + d(s0, s1, k), 0) === 2);
const name = [1, 2, 3];
const r1 = await J('start', { v: V, pid: a, name, from: 'tg' }); const s2 = await counts();
const r2 = await J('start', { v: V, pid: a, name, from: 'tg' }); const s3 = await counts();
ok('2 the first round counts played_tg', d(s1, s2, 'played_tg') === 1, r1.error || `played_tg +${d(s1, s2, 'played_tg')}`);
ok('2 a second round that day does not', !r1.error && !r2.error && d(s2, s3, 'played_tg') === 0, r2.error || '');
const loc = async (p) => { const t = await (await fetch(SITE + p, { redirect: 'manual' })).text(); return (t.match(/location\.replace\("([^"]+)"\)/) || [])[1]; };
const g = await loc('/m/pop?from=tg'), h = await loc('/m/pop/b444499e01be');
ok('5 /m/pop?from=tg passes the source on', g === '/?pop=play&from=tg', g);
ok('5 a run link without a source says share', h === '/?pop=b444499e01be&from=share', h);
// 6 the step before the game: a visit counts once a day per browser by source, the notice's choice by its answer
const v0 = await counts(), e = pid();
await J(`visit?p=${e}&from=site-home`); await J(`visit?p=${e}&from=site-home`); await J('visit?p=f00d000000000099&from=site-home');
await J('ask?c=stay'); await J('ask?c=std'); await J('ask?c=stay&own=1'); const bad = await J('ask?c=maybe');
const v1 = await counts();
ok('6 a visit counts once a day per browser, a check never', d(v0, v1, 'visit_site-home') === 1, `visit_site-home +${d(v0, v1, 'visit_site-home')}`);
ok('6 the notice counts stay and standard, not our checks, not an invented answer', d(v0, v1, 'ask_stay') === 1 && d(v0, v1, 'ask_std') === 1 && !!bad.error, `stay +${d(v0, v1, 'ask_stay')} std +${d(v0, v1, 'ask_std')}`);
console.log(`\npop-from test: ${9 - fails}/9`);
process.exit(fails ? 1 : 0);
