// Measures the layout of every page at every width that matters.
//
// The other four audits read files and endpoints. None of them can see the one
// failure a visitor notices first: a page that scrolls sideways on a phone, or
// a number that has been squeezed until it wraps into two lines. Those are
// facts about rendering, and only a browser knows them.
//
// Why headless and not the open tab: the extension's resize reports success and
// leaves the page at its real width, so every "mobile" measurement taken that
// way is a measurement of the desktop. CDP's device-metrics override actually
// changes the viewport, media queries included. Two hours went into believing
// the first kind of number once; this script exists so nobody repeats it.
//
// It measures rather than screenshots on purpose — images must not enter the
// context, and "this bar is 0.8 pixels long" is a better finding than a picture
// of a bar that looks short.
//
// Usage:
//   node scripts/layout-audit.mjs            # live site
//   node scripts/layout-audit.mjs --local    # http://127.0.0.1:8899 (python -m http.server from dashboard/)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scratchDir } from './lib/scratch.mjs';

const LIVE = 'https://brainonbnb.com';
const LOCAL = 'http://127.0.0.1:8899';
const BASE = process.argv.includes('--local') ? LOCAL : LIVE;
const ROOT = path.resolve(import.meta.dirname, '..');
const DASH = path.join(ROOT, 'dashboard');
const PORT = 9300 + (process.pid % 600);
// --progress=<file> appends one line per measurement as it happens.
const PROGRESS = (process.argv.find((a) => a.startsWith('--progress=')) || '').slice(11) || null;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found'); process.exit(1); }

// The widths where things actually break. 360 is the narrowest phone still in
// use, 390 the common iPhone, 768 the tablet edge where a two-column grid first
// appears, 1024 the laptop, 1440 the desktop the design was drawn at.
const WIDE = [360, 390, 768, 1024, 1440];
const NARROW = [360, 1440];

// Every page gets the two extremes, because that is where breakage lives. The
// pages people actually land on get the full sweep.
const MAIN = new Set(['/', '/services', '/registry', '/scanner', '/whitepaper', '/nft/', '/game/', '/brainscreener/', '/worldcup/']);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'code') walk(p, out); }
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
};

const pages = walk(DASH)
  .map((p) => '/' + path.relative(DASH, p).replace(/\\/g, '/'))
  .map((p) => p.replace(/index\.html$/, '').replace(/\.html$/, ''))
  .filter((p) => !p.includes('debug-ua') && !p.includes('for-designer') && !p.endsWith('/404'))
  .sort()
  // --only=<substring> narrows the run. A layout audit takes minutes; checking
  // the checker on two pages first is how the other four audits stopped
  // reporting things that were never wrong.
  // --only=<a,b> keeps only matching pages, --skip=<a,b> drops them. A full
  // sweep runs well past ten minutes, which is longer than a background task
  // here survives, so being able to cut it into pieces that each finish is the
  // difference between a result and three killed runs.
  .filter((p) => {
    const arg = (name) => {
      const a = process.argv.find((x) => x.startsWith('--' + name + '='));
      return a ? a.slice(name.length + 3).split(',').filter(Boolean) : null;
    };
    const only = arg('only');
    const skip = arg('skip');
    // The home page's path is "/", so a substring match can never single it
    // out: --only=index matches nothing and --only=/ matches everything. Both
    // read as a clean run — one because it measured no page at all. "home" and
    // "index" are therefore aliases for it, which is the only way to honour
    // "test what we changed" when what changed is the front page.
    const matches = (t) => (t === 'home' || t === 'index' ? p === '/' : p.includes(t));
    if (only && !only.some(matches)) return false;
    if (skip && skip.some(matches)) return false;
    return true;
  });

// A filter that selects nothing must not read as a clean run. --only=index
// matched no page and the audit reported "0 measurements across 0 pages — no
// layout problems", which is the most dangerous sentence a checker can print:
// it is what a passing run looks like.
if (!pages.length) {
  console.error('No page matched the filter. Nothing was measured — this is not a pass.');
  console.error('Available: ' + walk(DASH)
    .map((p) => '/' + path.relative(DASH, p).replace(/\\/g, '/'))
    .map((p) => p.replace(/index\.html$/, '').replace(/\.html$/, ''))
    .filter((p) => !p.includes('debug-ua') && !p.includes('for-designer') && !p.endsWith('/404'))
    .sort().join(' '));
  process.exit(2);
}

// ---- CDP, no npm ----------------------------------------------------------
// Port and profile are per-run, keyed on the process id. A previous run that
// was interrupted leaves a Chrome holding both: the next run then finds a
// debugger already listening, attaches to that stale browser instead of its
// own, and sits there doing nothing at 0.5% CPU until somebody notices. It cost
// half an hour of "still running" before the cause was obvious.
const tmp = scratchDir('layout-audit-');
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + tmp,
  '--hide-scrollbars',
  '--no-first-run',
  '--disable-gpu',
], { stdio: 'ignore' });

// However this ends — finished, thrown, or Ctrl-C — the browser goes with it.
const cleanup = () => {
  try { chrome.kill(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, msgId = 0;
const pending = new Map();

const connect = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' });
      const t = await r.json();
      ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      };
      return;
    } catch { await sleep(400); }
  }
  throw new Error('could not reach Chrome on port ' + PORT);
};

const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};

// ---- the measurement ------------------------------------------------------
// Written as a string because it runs in the page, not here. No backticks and
// no regex: a heredoc once ate both, and the resulting silent breakage cost an
// afternoon. Plain string concatenation and DOM APIs only.
const MEASURE = `(async () => {
  // Wake lazy content and anything behind an IntersectionObserver, then return
  // to the top so the measurements describe the page as it is first seen.
  const h = document.documentElement.scrollHeight;
  for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 600));

  const de = document.documentElement;
  const cw = de.clientWidth;
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) {
      s += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    }
    return s;
  };

  const out = { over: de.scrollWidth - cw, sideways: [], clipped: [], wrapped: [], slivers: [] };

  // Decoration is allowed to hang off the edge — that is usually the point of
  // it. The aurora behind every page is position:fixed with inset:-25% and a
  // 110px blur, so a naive check reports it as "cut off by 130px" on every
  // page at every width. Anything a visitor cannot touch is not a layout
  // defect, and pointer-events:none is exactly that property, stated by the
  // stylesheet itself rather than guessed from a class name.
  //
  // Memoised, and that is not premature: the first version walked the whole
  // ancestor chain per element and asked the browser for a fresh computed style
  // at every step. On a page with a few thousand elements that is tens of
  // thousands of style resolutions per measurement, and a sweep that should
  // take four minutes ran past ten. Each element's own style is computed once
  // here, and the answer for its parent is already cached by the time it is
  // needed, so the chain costs one lookup instead of its own depth.
  const decoCache = new Map();
  const styleOf = new Map();
  const cs = (el) => {
    let s = styleOf.get(el);
    if (!s) { s = getComputedStyle(el); styleOf.set(el, s); }
    return s;
  };
  const decorative = (el) => {
    const hit = decoCache.get(el);
    if (hit !== undefined) return hit;
    const s = cs(el);
    let v;
    if (s.pointerEvents === 'none' || s.visibility === 'hidden' || s.opacity === '0') v = true;
    else if (el.getAttribute('aria-hidden') === 'true' && !el.textContent.trim()) v = true;
    else v = el.parentElement && el.parentElement !== document.body ? decorative(el.parentElement) : false;
    decoCache.set(el, v);
    return v;
  };

  const all = document.querySelectorAll('body *');

  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;

    const p = el.parentElement;
    const pr = p ? p.getBoundingClientRect() : null;

    // GEOMETRY FIRST, STYLE ONLY FOR SUSPECTS.
    //
    // The earlier version asked the browser for a computed style on every
    // element before testing anything. On the Plaza page — 784 agents, tens of
    // thousands of nodes — that turned a sub-second measurement into more than
    // five minutes, and three sweeps were abandoned before the cause was
    // measured rather than guessed. Rectangles are already computed by layout
    // and cost nothing to read; a computed style is work. So every element is
    // screened by rectangle alone, and only the handful that look wrong are
    // asked about their style.
    const pastViewport = out.over > 1 && r.right > cw + 1;
    const pastParent = pr && pr.width > 0 && r.right > pr.right + 1.5;
    const leaf = !el.children.length;
    // A bar scaled to nothing needs no style at all: getBoundingClientRect
    // already has the transform applied, so a visible width under two pixels
    // inside a parent that is wide IS the finding — but only for something that
    // is actually a bar.
    //
    // "Thin" alone caught two things that are supposed to be thin: the game's
    // 1px HUD separators, and the visually-hidden <h1> every page carries for
    // screen readers (the clip:rect(0,0,0,0) 1x1 trick). What distinguishes a
    // fill from either is that a fill sits ALONE inside a track that clips it,
    // and has real height. All three conditions are rectangle-and-DOM facts, so
    // this still costs no style lookup.
    const sliver = pr && r.width < 2 && pr.width > 40 && r.height > 2 &&
      p.children.length === 1 && (() => {
        const ps = cs(p);
        return ps.overflow === 'hidden' || ps.overflowX === 'hidden' || ps.overflowX === 'clip';
      })();

    if (!pastViewport && !pastParent && !leaf && !sliver) continue;
    if (decorative(el)) continue;

    if (pastViewport) out.sideways.push(label(el) + ' right=' + Math.round(r.right));
    if (sliver) out.slivers.push(label(el) + ' ' + r.width.toFixed(1) + 'px');

    if (pastParent) {
      const st = cs(p);
      const own = cs(el);
      const scrollable = st.overflowX === 'auto' || st.overflowX === 'scroll';
      const hidden = st.overflow === 'hidden' || st.overflowX === 'hidden';
      // An absolutely positioned element with a negative offset was PUT there.
      // The little arrow that links the flow cards sits at right:-16px so it
      // straddles the card edge; reporting it as "cut off by 15px" on every
      // page at every width is the checker misreading a design decision as a
      // defect. The offset says the intent out loud, so it is read rather than
      // guessed at from class names.
      const placed = (own.position === 'absolute' || own.position === 'fixed') &&
        [own.right, own.left, own.top, own.bottom].some((v) => v.startsWith('-'));
      // Cut off inside a parent that neither scrolls nor intends to clip.
      if (!scrollable && !hidden && !placed) {
        out.clipped.push(label(el) + ' in ' + label(p) + ' by ' + Math.round(r.right - pr.right) + 'px');
      }
    }

    // A figure that has wrapped onto a second line, which on a stat tile means
    // the tile got too narrow for its own number.
    //
    // Measured with getClientRects(), not with height against line-height. An
    // inline box that wraps produces one rect per line — that is the browser
    // stating the fact directly. The height comparison guessed, and it guessed
    // wrong on every single-glyph icon span on the site, where the height comes
    // from padding and nothing has wrapped at all.
    if (leaf) {
      const txt = (el.textContent || '').trim();
      // Screened on the text before the style is fetched, for the same reason
      // as above: most leaves hold prose or nothing, and neither can be the
      // squeezed figure this is looking for.
      if (!(txt.length > 1 && txt.length < 40 && !txt.includes(' '))) continue;
      const st = cs(el);
      const inline = st.display.startsWith('inline');
      // A stylesheet that says break-all or anywhere has asked for the break.
      // Contract addresses and endpoint URLs are set that way on purpose —
      // breaking them is how they fit on a phone at all, and the alternative is
      // the sideways scroll this script exists to catch. Reporting a requested
      // break as a defect would push the site towards the worse of the two.
      const asked = st.wordBreak === 'break-all' || st.overflowWrap === 'anywhere' ||
        st.overflowWrap === 'break-word' || st.wordBreak === 'break-word';
      // What this check is for is a figure squeezed until it wraps — a stat
      // tile too narrow for its own number. A URL, a path or a contract address
      // in running text is a different animal: it has nowhere good to break,
      // browsers break it at a slash, and the alternative is a page that
      // scrolls sideways. Reporting those buried the one finding that mattered
      // under sixty that did not.
      const isAddressish = txt.includes('/') || txt.includes('://') ||
        /^0x[0-9a-fA-F…]{6,}$/.test(txt) || /^[a-z0-9-]+(\.[a-z0-9-]+){1,}$/i.test(txt);
      if (inline && !asked && !isAddressish && el.getClientRects().length > 1) {
        out.wrapped.push(label(el) + ' "' + txt.slice(0, 18) + '"');
      }
    }
  }

  const cap = (a) => a.slice(0, 5);
  return JSON.stringify({
    over: out.over,
    sideways: cap(out.sideways),
    clipped: cap(out.clipped),
    wrapped: cap(out.wrapped),
    slivers: cap(out.slivers),
    counts: {
      sideways: out.sideways.length, clipped: out.clipped.length,
      wrapped: out.wrapped.length, slivers: out.slivers.length,
    },
  });
})()`;

await connect();
await send('Page.enable');
await send('Runtime.enable');

// ---- does the detector detect? -------------------------------------------
// A check that has only ever returned "nothing found" is indistinguishable
// from a check that cannot find anything. So before trusting a clean run,
// break a page on purpose and confirm the break is reported. Every audit in
// this project earns its clean result this way.
if (process.argv.includes('--self-test')) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(7000);
  await evaluate(`(() => {
    const d = document.createElement('div');
    d.id = 'audit-canary';
    d.textContent = 'x';
    d.style.cssText = 'width:900px;height:20px;background:red';
    document.body.appendChild(d);
    return 1;
  })()`);
  const rawSelf = await evaluate(MEASURE);
  const r = rawSelf ? JSON.parse(rawSelf) : { over: 0, sideways: [] };
  // Looked for in every list, not just the first. The lists are capped at five
  // entries for readability, and the canary sits last in the DOM — the first
  // version of this assertion failed on a run where the detector had in fact
  // reported it, which is its own small lesson about trusting a red result.
  const caught = r.over > 1 &&
    [].concat(r.sideways, r.clipped).some((s) => s.includes('audit-canary'));
  if (!caught) console.log('  what came back: ' + JSON.stringify(r).slice(0, 600));
  console.log('\nself-test: ' + (caught
    ? 'a 900px element on a 390px page was reported — the detector works'
    : 'FAILED — a deliberately broken page came back clean, do not trust this run'));
  if (!caught) process.exit(1);
  await evaluate("document.getElementById('audit-canary').remove()");
}

const findings = [];
let measured = 0;

console.log('\nLayout audit — ' + pages.length + ' pages, real viewports via CDP\n');

for (const page of pages) {
  const widths = MAIN.has(page) ? WIDE : NARROW;
  for (const w of widths) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768,
    });
    await send('Page.navigate', { url: BASE + page });
    // Fixed settle rather than a load event: several pages fill in from the
    // network for the better part of ten seconds, and measuring before that is
    // measuring an empty page. The homepage taught this the expensive way.
    await sleep(page === '/' || page === '/registry' ? 7000 : 3500);

    // Written straight to disk, not through stdout. Node buffers stdout when it
    // is not a terminal, so a piped or redirected run shows absolutely nothing
    // until it exits — which makes a slow run and a hung run look identical,
    // and cost three abandoned sweeps before the difference was clear.
    const t0 = Date.now();
    const raw = await evaluate(MEASURE);
    if (PROGRESS) {
      try {
        fs.appendFileSync(PROGRESS, `${page} @${w} ${Date.now() - t0}ms ${raw ? 'ok' : 'NO ANSWER'}\n`);
      } catch { /* progress logging must never break the run */ }
    }
    measured++;
    if (!raw) { findings.push({ page, w, note: 'page did not answer' }); process.stdout.write('?'); continue; }

    let r;
    try { r = JSON.parse(raw); } catch { process.stdout.write('?'); continue; }

    const bad = r.over > 1 || r.counts.clipped || r.counts.wrapped || r.counts.slivers;
    if (bad) { findings.push({ page, w, ...r }); process.stdout.write('x'); }
    else process.stdout.write('.');
  }
}

await send('Emulation.clearDeviceMetricsOverride');
ws.close();
chrome.kill();

console.log('\n');
if (!findings.length) {
  console.log(measured + ' measurements across ' + pages.length + ' pages — no layout problems.\n');
} else {
  for (const f of findings) {
    console.log(f.page + '  @' + f.w + 'px');
    if (f.note) { console.log('   ' + f.note); continue; }
    if (f.over > 1) console.log('   scrolls sideways by ' + f.over + 'px: ' + f.sideways.join(', '));
    if (f.counts.clipped) console.log('   cut off (' + f.counts.clipped + '): ' + f.clipped.join(', '));
    if (f.counts.wrapped) console.log('   wrapped (' + f.counts.wrapped + '): ' + f.wrapped.join(', '));
    if (f.counts.slivers) console.log('   bar scaled to nothing: ' + f.slivers.join(', '));
  }
  console.log('\n' + findings.length + ' of ' + measured + ' measurements have something to fix\n');
}
process.exit(0);
