// DOES THE STYLE ARRIVE? Every other checker measures structure, links,
// sizes and overflow; none of them asked whether a class name on the page is
// matched by any rule in the stylesheets the page actually loaded. That is
// how `.back-btn` and `.brand-link` — defined inline on two pages and on no
// other — left /advantage with three unstyled links from the day it went
// live until a person noticed (2026-09-01). This asks exactly that question,
// in a real browser, on the live site.
//
//   node scripts/dashboard-check/style-arrival.mjs                 every top-level page
//   node scripts/dashboard-check/style-arrival.mjs --only=services  one page (name, not path)
//   node scripts/dashboard-check/style-arrival.mjs --self-test      plant an unstyled class, expect the report
//   node scripts/dashboard-check/style-arrival.mjs --all            also list the hooks (unmatched but not bare)
//   BASE=https://brainonbnb.com  (default)   W=1280 (default)
//
// A class is reported when a VISIBLE element carries it and no selector in
// any readable stylesheet mentions it. Classes that exist only for scripts
// to find elements by are listed in JS_ONLY with the reason; a class added to
// that list without a reason is the next /advantage.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newTab, closeTab } from '../scanner-audit/cdp.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const BASE = (process.env.BASE || 'https://brainonbnb.com').replace(/\/$/, '');
const W = Number(process.env.W || 1280);
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const SELF_TEST = args.includes('--self-test');

// Classes that are hooks for scripts, not styles. Each with the reason.
const JS_ONLY = {
  fi: 'fade-in marker; the rule lives on .fi.on / IntersectionObserver adds the state',
  ld: 'loading marker set by app.js until the first number lands',
};

// Every top-level page of the dashboard, as the live site routes it.
function pages() {
  const dash = path.join(ROOT, 'dashboard');
  return fs.readdirSync(dash).filter((f) => f.endsWith('.html') && !f.startsWith('_'))
    .map((f) => f.replace(/\.html$/, '')).filter((n) => !only || n === only)
    .map((n) => ({ name: n, url: n === 'index' ? BASE + '/' : `${BASE}/${n}` }));
}

const PROBE = `(() => {
  const styled = new Set(); let unreadable = 0, sheets = 0;
  const walk = (rules) => { for (const r of rules) {
    if (r.selectorText) for (const m of r.selectorText.matchAll(/\\.(-?[_a-zA-Z][\\w-]*)/g)) styled.add(m[1].replace(/\\\\/g, ''));
    if (r.cssRules) walk(r.cssRules);
  } };
  for (const s of document.styleSheets) { sheets++; try { walk(s.cssRules); } catch { unreadable++; } }
  // An element is a finding when NONE of its classes is matched, it has text
  // of its own to show, and it looks bare — no padding, border or background,
  // and the same font and colour as its parent. A wrapper with no text of its
  // own, a second class on a styled element, or an element a descendant
  // selector dresses (.card button) is a hook, not a finding; hooks are
  // counted and shown with --all.
  const seen = new Map(), hooks = new Map();
  for (const el of document.querySelectorAll('[class]')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const b = el.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0)) continue;
    const classes = [...el.classList]; const none = classes.every((c) => !styled.has(c));
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const ps = el.parentElement ? getComputedStyle(el.parentElement) : cs;
    const bare = ['paddingTop','paddingBottom','paddingLeft','paddingRight'].every((k) => cs[k] === '0px') && (cs.borderStyle === 'none' || cs.borderWidth === '0px') && (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') && cs.fontSize === ps.fontSize && cs.fontWeight === ps.fontWeight && cs.color === ps.color;
    for (const c of classes) {
      if (styled.has(c)) continue;
      const finding = none && ownText && bare;
      const map = finding ? seen : hooks;
      const e = map.get(c) || { cls: c, tags: new Set(), n: 0, text: '' };
      e.n++; e.tags.add(el.tagName.toLowerCase()); if (!e.text) e.text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
      map.set(c, e);
    }
  }
  const out = (m) => [...m.values()].map((e) => ({ cls: e.cls, tags: [...e.tags].join(','), n: e.n, text: e.text }));
  return { sheets, unreadable, styled: styled.size, unstyled: out(seen), hooks: out(hooks) };
})()`;

const { proc, port } = await launch(9400 + Math.floor(Math.random() * 400), W, 900);
let findings = 0;
const list = pages();
try {
  for (const p of list) {
    const tab = await newTab(port);
    await tab.send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: W < 700 });
    await tab.send('Page.navigate', { url: p.url });
    await new Promise((r) => setTimeout(r, 3500));
    let res;
    try { res = await tab.eval(PROBE); } catch (e) { console.log(`  ??   ${p.name.padEnd(14)} could not be read: ${e.message.slice(0, 80)}`); findings++; await closeTab(port, tab.targetId); continue; }
    const real = res.unstyled.filter((u) => !JS_ONLY[u.cls]);
    const tag = real.length ? 'FAIL' : 'ok  ';
    if (real.length) findings += real.length;
    const hooks = res.hooks.filter((u) => !JS_ONLY[u.cls]);
    console.log(`  ${tag} ${p.name.padEnd(14)} ${res.styled} styled classes in ${res.sheets} sheets${res.unreadable ? ` (${res.unreadable} cross-origin, unread)` : ''}; ${real.length} unstyled, ${hooks.length} hook${hooks.length === 1 ? '' : 's'}`);
    for (const u of real) console.log(`         .${u.cls} on <${u.tags}> ×${u.n}${u.text ? ` — "${u.text}"` : ''}`);
    if (args.includes('--all')) for (const u of hooks) console.log(`         hook .${u.cls} on <${u.tags}> ×${u.n}`);
    if (SELF_TEST && p === list[0]) {
      // Both directions: a planted unknown class on a visible element must be
      // reported; a planted known one must not.
      const known = res.styled > 0 ? await tab.eval(`[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules]}catch{return []}}).map(r=>r.selectorText||'').join(' ').match(/\\.([_a-zA-Z][\\w-]*)/)[1]`) : null;
      await tab.eval(`(()=>{const d=document.createElement('div');d.className='zz-unstyled-probe';d.textContent='probe';document.body.appendChild(d);const k=document.createElement('div');k.className=${JSON.stringify(known)};k.textContent='known';document.body.appendChild(k);})()`);
      const again = await tab.eval(PROBE);
      const caught = again.unstyled.some((u) => u.cls === 'zz-unstyled-probe');
      const falseAlarm = again.unstyled.some((u) => u.cls === known);
      console.log(`  ${caught ? 'ok  ' : 'FAIL'} self-test: a planted unstyled class is reported`);
      console.log(`  ${falseAlarm ? 'FAIL' : 'ok  '} self-test: a planted styled class (.${known}) is not`);
      if (!caught || falseAlarm) findings++;
    }
    await closeTab(port, tab.targetId);
  }
} finally { proc.kill(); }
console.log(findings ? `\n${findings} finding(s)` : '\nevery visible class on every page is matched by a loaded stylesheet');
process.exitCode = findings ? 1 : 0;
