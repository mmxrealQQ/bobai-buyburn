#!/usr/bin/env node
// Every host the BROWSER code fetches from is allowed by the site's CSP (dashboard/_headers, connect-src).
// 2026-11-15: a log host (Pocket) went first on 2.11. without a line there; browsers blocked it in 3 ms and the scanner
// lost its trades and measured tax for two weeks with nothing red anywhere. rpc-revert-regressions pins the chain hosts;
// this pins the rest: every literal fetch / EventSource target in the pages and their scripts. The site worker
// (_worker.js) runs on the server, where the CSP does not apply, and is left out.
//   node scripts/csp-hosts-regressions.mjs      (self-tests.mjs runs it as it is)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

const cspOf = (headers) => ((headers.match(/connect-src([^;]+)/) || [])[1] || '').trim().split(/\s+/);
// read by the site worker alone (no page loads them; fetch-once.js IS loaded by the home page and stays in)
const SERVER_ONLY = new Set(['_worker.js', 'preflight.js', 'tier-scan.js', 'range-scan.js', 'swap-route.js']);
const files = [];
const dash = path.join(ROOT, 'dashboard');
for (const f of fs.readdirSync(dash)) if (/\.(js|html)$/.test(f) && !SERVER_ONLY.has(f)) files.push(path.join(dash, f));
for (const d of fs.readdirSync(dash)) { const p = path.join(dash, d, 'index.html'); if (fs.existsSync(p)) files.push(p); }
for (const f of ['i18n/ar.js', 'i18n/core.js']) if (fs.existsSync(path.join(dash, f))) files.push(path.join(dash, f));
const term = path.join(ROOT, 'temp/terminal-site/terminal');
if (fs.existsSync(term)) for (const f of fs.readdirSync(term)) if (/\.(m?js)$/.test(f)) files.push(path.join(term, f));

const TARGET = /(?:fetch|EventSource)\(\s*['"`](https:\/\/[a-zA-Z0-9.-]+)/g;
const hostsIn = (text) => [...text.matchAll(TARGET)].map((m) => m[1]);
const missingFrom = (csp, hosts) => [...new Set(hosts)].filter((h) => !csp.includes(h) && !(h === 'https://brainonbnb.com' && csp.includes("'self'")));

const csp = cspOf(fs.readFileSync(path.join(dash, '_headers'), 'utf8'));
const found = new Map();
for (const f of files) for (const h of hostsIn(fs.readFileSync(f, 'utf8'))) { if (!found.has(h)) found.set(h, path.relative(ROOT, f)); }
const miss = missingFrom(csp, [...found.keys()]);
ok(`every host the browser code fetches is in connect-src (${found.size} hosts in ${files.length} files)`, found.size >= 5 && !miss.length, miss.map((h) => `${h} (${found.get(h)})`).join(', '));

// the check itself, both ways: a host taken out of the CSP is found missing; a server-only file is not read
const without = csp.filter((h) => h !== 'https://api.dexscreener.com');
ok('a host removed from connect-src is reported (dexscreener)', missingFrom(without, [...found.keys()]).includes('https://api.dexscreener.com'));
ok('a fetch written in a page is read, with any quote style', hostsIn("x=fetch('https://a.example') ; y=fetch(\"https://b.example\"); z=fetch(`https://c.example/p`)").join() === 'https://a.example,https://b.example,https://c.example');
ok('the server worker is left out (the CSP does not apply there)', !files.some((f) => f.endsWith('_worker.js')));

console.log(`\ncsp-hosts: ${fails ? fails + ' FAIL' : 'all pins hold'}`);
process.exit(fails ? 1 : 0);
