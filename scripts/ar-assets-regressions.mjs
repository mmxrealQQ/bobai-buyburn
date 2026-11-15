// THE ARABIC LAYER, LOADED ONCE (15.11., the A-Z pass). Held offline:
//   switch    /pop and /connect reach the worker (_routes.json), so they get the EN|ع switch and hreflang like every other
//             page in AR_PAGES (before: straight from the asset store, no switch, /ar/ twin only by typing it)
//   whitepaper its header has the slot the switch goes into (.nav .ar-in) and the worker fills it
//   entities  every &name; in a dashboard page is one decodeHtml() knows (−, §, ± stayed raw: /ar/token "−1%" English,
//             four paragraphs of /ar/whitepaper English)
//   cache     /i18n/* is immutable for a year, so a change must carry a new address: ar.json a new "v", core.js a new ?v=
//             in ar.js, ar.js/ar.css a new AR_V — each held against the last commit (git HEAD)
// node scripts/ar-assets-regressions.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(import.meta.dirname, '..'), D = path.join(ROOT, 'dashboard');
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const read = (f) => fs.readFileSync(path.join(D, f), 'utf8');
const head = (f) => { try { return execFileSync('git', ['show', 'HEAD:dashboard/' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };

// switch: the routes
const R = JSON.parse(read('_routes.json')), inc = R.include || [], exc = R.exclude || [];
const re = (r) => new RegExp('^' + r.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
const routed = (p) => inc.some((r) => re(r).test(p)) && !exc.some((r) => re(r).test(p));
for (const p of ['/pop', '/pop.html', '/connect', '/connect.html']) say(routed(p), `${p} reaches the worker (switch + hreflang)`);
// every AR page with its own .html file is routed
const core = read('i18n/core.js');
const AR_PAGES = new RegExp(core.match(/export const AR_PAGES = \/(.*)\/;/)[1]);
const pages = fs.readdirSync(D).filter((f) => f.endsWith('.html')).map((f) => '/' + f.replace(/\.html$/, '')).filter((p) => AR_PAGES.test(p));
const unrouted = pages.filter((p) => !routed(p));
say(!unrouted.length, `every page of AR_PAGES with a file reaches the worker${unrouted.length ? ' — not: ' + unrouted.join(' ') : ''}`);

// whitepaper slot
const W = read('_worker.js');
say(/class="ar-in"/.test(read('whitepaper.html').split('<main')[0]), 'the whitepaper header has the switch slot (.ar-in)');
say(W.includes("'.nav .ar-in'") && /\.nav \.ar-in[^\n]*e\.append\(langSwitch/.test(W), 'the worker puts the switch into that slot');

// entities
const ENT = new Set([...core.match(/const ENT = \{([^}]*)\}/)[1].matchAll(/(\w+):/g)].map((m) => m[1]));
const miss = {};
for (const f of fs.readdirSync(D).filter((f) => f.endsWith('.html'))) for (const m of read(f).matchAll(/&([a-zA-Z]+);/g)) if (!ENT.has(m[1])) (miss[m[1]] ||= new Set()).add(f);
say(!Object.keys(miss).length, `every named entity in the pages is decoded${Object.keys(miss).length ? ' — missing: ' + Object.entries(miss).map(([k, v]) => k + ' (' + [...v].join(', ') + ')').join('; ') : ''}`);

// cache + versions
const H = read('_headers');
say(/^\/i18n\/\*\s*\n\s*Cache-Control: public, max-age=31536000, immutable/m.test(H), '/i18n/* is cached immutable');
const arJs = read('i18n/ar.js'), coreV = (s) => (s.match(/\/i18n\/core\.js\?v=(\d+)/) || [])[1], arV = (s) => (s.match(/const AR_V = '(\d+)'/) || [])[1];
say(!!coreV(arJs) && W.includes('/i18n/ar.js?v=${AR_V}') && W.includes('/i18n/ar.css?v=${AR_V}') && W.includes('/i18n/ar.json?v=${AR_DICT.v}') && /ar\.json\?v=' \+/.test(arJs), 'every /i18n/ file is asked with a ?v=');
const hCore = head('i18n/core.js'), hAr = head('i18n/ar.js'), hCss = head('i18n/ar.css'), hJson = head('i18n/ar.json'), hW = head('_worker.js');
if (hCore && hAr && hJson && hW) {
  say(hCore === core || coreV(hAr) !== coreV(arJs), `core.js changed -> its ?v= in ar.js is new (${coreV(hAr)} -> ${coreV(arJs)})`);
  say((hAr === arJs && hCss === read('i18n/ar.css')) || arV(hW) !== arV(W), `ar.js/ar.css changed -> AR_V is new (${arV(hW)} -> ${arV(W)})`);
  const j = read('i18n/ar.json');
  say(hJson === j || JSON.parse(hJson).v !== JSON.parse(j).v, `ar.json changed -> its "v" is new (${JSON.parse(hJson).v} -> ${JSON.parse(j).v})`);
} else say(false, 'the last commit could not be read (git)');
console.log(bad ? `\n${bad} FAIL` : '\nArabic layer: all PASS'); process.exit(bad ? 1 : 0);
