#!/usr/bin/env node
// IS IT US OR CLOUDFLARE (2026-10-23). The hourly look went red at 03:40 UTC on 23.10. while every bot was healthy:
// Cloudflare started cron ticks up to 13 min late. The red message now says which it likely is, and every red look
// is kept (KV health:light-log). Pins (the code before 2026-10-23 FAILs all — no dispatchNote, no note, no log):
//   1  the look started late -> "Likely Cloudflare"
//   2  every bot late together -> "Likely Cloudflare"
//   3  only one bot late, the look on time -> "Only <bot>", not Cloudflare
//   4  a red that is not a heartbeat (can post) -> no note
//   5  the message carries the note; the worker keeps every red look and passes scheduledTime
// usage: node scripts/health-dispatch-check.mjs      offline
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
const lib = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'health-checks.mjs')).href);
const src = fs.readFileSync(path.join(ROOT, 'worker-health', 'index.js'), 'utf8');
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };

const note = lib.dispatchNote || (() => '');
const tgLate = [{ area: 'Bots', name: 'telegram bot cron alive', good: false, detail: 'last tick 18 min ago' }];
const n1 = note(tgLate, { tg: 18, buyback: 4, dev: 20 }, 6);
is('1  the look itself started late: likely Cloudflare', /Likely Cloudflare/.test(n1) && /6 min late/.test(n1), n1);
const n2 = note([...tgLate, { area: 'Bots', name: 'buyback bot ran recently', good: false }], { tg: 18, buyback: 64, dev: 75 }, 0);
is('2  every bot late together: likely Cloudflare', /Likely Cloudflare/.test(n2) && /together/.test(n2), n2);
const n3 = note(tgLate, { tg: 18, buyback: 4, dev: 20 }, 0);
is('3  only the TG bot late, the look on time: look at that bot', /^🔎 Only TG bot 18 min/.test(n3) && !/Cloudflare/.test(n3), n3);
const n4 = note([{ area: 'Bots', name: 'telegram bot can post', good: false }], { tg: 30, buyback: 70, dev: 90 }, 9);
is('4  a red that is not a heartbeat gets no note', n4 === '', n4);

let rendered = '';
try { const w = await import(pathToFileURL(path.join(ROOT, 'worker-health', 'index.js')).href); rendered = w.renderLightMessage(tgLate, '2026-10-23 03:40', n1); } catch { rendered = ''; }
is('5  the red message carries the note', rendered.includes('Likely Cloudflare'));
is('5  the worker keeps every red look and passes scheduledTime', /keepLightLog\(env,/.test(src) && /scheduledTime: event\.scheduledTime/.test(src) && /binding = "AGENT"/.test(fs.readFileSync(path.join(ROOT, 'worker-health', 'wrangler.toml'), 'utf8')));

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
