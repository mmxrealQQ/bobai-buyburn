// The new page's windows (2026-09-26). The cards around the terminal open their block as a window over it; a figure
// on a card is mirrored from the element inside its window, which app.js fills — one read, shown twice.
// BACK closes (2026-09-26, operator: "close correctly everywhere and come back"): every window, the page window and the
// chart view is one step in the browser's history, so a phone's back gesture closes what is open instead of leaving
// the page — and the × closes it by stepping back the same way, so history never fills with dead entries.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let open = null, back = null, chartOn = false, frameNav = 0;
  // THE × GOES BACK TO WHERE YOU WERE (2026-10-14, operator: "Brain Plaza, open the full screener, pick an agent, × —
  // and I am at the terminal; the × should always go back to where it was, everywhere"): every view a window replaces
  // (a card's window, a page, a page's own next page) is kept here; × and Esc step back one view at a time, scrolled
  // where it was, and only the first view closes. The backdrop and a link home still close at once.
  let trail = [], stepping = false;
  const here = () => {
    if (!open) return null;
    if (open.id !== 'wpage') return { win: open.id, y: $('.bw-body', open)?.scrollTop || 0 };
    const f = $('.pg-f', open); let at = f.dataset.at || f.getAttribute('src'), y = 0;
    try { const l = f.contentWindow.location; if (l.pathname && l.pathname !== 'blank') at = l.pathname + l.search + l.hash; y = f.contentWindow.scrollY || 0; } catch {}
    return at ? { page: at, title: $('.pg-t', open).textContent, y } : null;
  };
  const remember = () => { if (stepping) return; const h = here(); if (h) { trail.push(h); if (trail.length > 30) trail.shift(); } };
  // one history step while anything is open; switching from one window to the next reuses it
  const layer = () => history.state && history.state.bp === 'layer';
  function pushLayer() { if (!layer()) history.pushState({ bp: 'layer' }, ''); }
  // leave the step: back when the step is ours and on top; a page frame that navigated inside itself added steps of
  // its own, which a plain back would only walk inside the frame — then the step is marked spent and skipped later
  function popLayer() {
    if (!layer()) return;
    if (frameNav) { history.replaceState({ bp: 'spent' }, ''); frameNav = 0; } else history.back();
  }
  function show(id, keep) {
    const w = document.getElementById(id); if (!w) return;
    const fresh = !open; if (open && open !== w) remember();
    if (open) hide(true);
    if (!keep) pushLayer();
    back = back || document.activeElement; open = w; w.hidden = false;
    document.body.classList.add('bp-winon');
    // the page behind a window takes no focus (2026-10-10: Tab left the dialog for the header and the cards)
    $$('.bp-h, .bp-grid').forEach((e) => { e.inert = true; });
    requestAnimationFrame(() => { w.classList.add('on'); if (w.querySelector('.ts-rows')) window.__bobaiFitSchedule?.(); });
    w.querySelector('.bw-x')?.focus({ preventScroll: true });
    // the classic sections fade in on scroll (class "fi"); inside a window everything is simply there
    $$('.fi.pre', w).forEach((e) => e.classList.remove('pre'));
    // images are lazy on the classic page; in a window they are wanted now
    $$('img[loading="lazy"]', w).forEach((i) => { i.loading = 'eager'; });
    // a window opens at its top, not where it was scrolled to last time
    const b = $('.bw-body', w); if (b) b.scrollTop = 0;
    if (fresh && !stepping) trail = []; // a window opened from the page itself starts a new trail
    dispatchEvent(new CustomEvent('bp:open', { detail: id }));
  }
  // switching = closing one window for the next: the history step stays, the focus goes back only at the very end
  function hide(switching) {
    if (!open) return;
    const w = open; open = null; w.classList.remove('on');
    if (!switching) { document.body.classList.remove('bp-winon'); $$('.bp-h, .bp-grid').forEach((e) => { e.inert = false; }); back?.focus?.({ preventScroll: true }); back = null; }
    setTimeout(() => { if (open !== w) w.hidden = true; }, 220);
  }
  // closed by the × / the backdrop / Esc: close, then give the history step back
  function close() { if (!open) return; trail = []; hide(); if (!chartOn) popLayer(); }
  function stepBack() {
    const v = trail.pop(); if (!v) { close(); return; }
    stepping = true;
    try {
      if (v.win) { show(v.win, true); const b = $('.bw-body', open); if (b) b.scrollTop = v.y; }
      else { openPage(v.page, v.title); const f = $('#wpage .pg-f'); if (v.y && f) f.addEventListener('load', () => {
        // a page that fills its list after loading (the screener) is not tall enough yet: try again until it is, 5 s at most
        let n = 0; const go = () => { try { const cw = f.contentWindow; cw.scrollTo(0, v.y); if (Math.abs(cw.scrollY - v.y) > 4 && ++n < 33) setTimeout(go, 150); } catch {} }; go();
      }, { once: true }); }
    } finally { stepping = false; }
  }
  // STAGE 3: the site's own pages open in the page window, running their own code in the Brain look (?embed=1);
  // the apps (brainScreener, the game, the World Cup tip game) keep their own look and their own navigation inside
  const PAGES = /^\/(scanner|registry|services|defi|liquidity|agents|nft|library|whitepaper|advantage|session|source|token|faq|roadmap|archive|brainscreener|game|worldcup|list|agent|screener|board|jobs|settle|venus|pass|set-and-earn|pancakeswap|brainbook|wall)(\/|$)/;
  const NAMES = { brainbook: 'Brainbook', wall: 'Agent Wall', scanner: 'Pool Scanner', registry: 'Brain Plaza', services: 'Agent Services', defi: 'DeFi Agent', liquidity: 'DeFi Agent', agents: 'DeFi Agent', nft: 'NFT Collection', library: 'The Library', whitepaper: 'Whitepaper', advantage: 'Agent Advantage Report', session: 'Session Keys', source: 'The Source', token: 'The Token', faq: 'Questions', roadmap: 'Roadmap', archive: 'Archive', brainscreener: 'brainScreener', game: 'The BOBAI Game', worldcup: "World Cup '26 Tip Game", board: 'Brain Board', jobs: 'Job Board', settle: 'Job Settler', venus: 'Venus Agents', pass: 'Holder Pass', 'set-and-earn': 'Set and Earn', pancakeswap: 'PancakeSwap Tools' };
  function openPage(path, title) {
    const u = new URL(path, location.origin), key = u.pathname.split('/')[1];
    u.searchParams.set('embed', '1');
    const w = document.getElementById('wpage'), src = u.pathname + u.search + u.hash;
    if (open === w) { const h = here(); if (!(h && h.page && h.page.split('#')[0] === src.split('#')[0])) remember(); } // from a card's window: show() keeps it
    $('.pg-t', w).textContent = NAMES[key] || title || 'Page';
    w.setAttribute('aria-label', NAMES[key] || title || 'Page'); $('.pg-f', w)?.setAttribute('title', NAMES[key] || title || 'Page'); // a screen reader names the page, not "Page"
    // the header carries the page's own logo, the one on its ecosystem card, instead of an arrow (operator, 2026-09-27);
    // a page without a card (the library, the lite paper …) carries the BOBAI logo; the side apps' line counts as cards
    const k = $('.pg-k', w), card = $$('a.ec, a.ec-also').find((a) => new URL(a.getAttribute('href'), location.origin).pathname.split('/')[1] === key);
    const ico = card && card.querySelector('.ec-top svg, .ec-top img');
    k.replaceChildren(ico ? ico.cloneNode(true) : Object.assign(document.createElement('img'), { src: '/logo-sm.png', alt: '' }));
    const plain = new URL(u); plain.searchParams.delete('embed'); $('.pg-open', w).href = plain.pathname + plain.search + plain.hash;
    let f = $('.pg-f', w);
    if ((f.dataset.at || f.getAttribute('src')) !== src) {
      // a new page must not add a step to the history: an open frame is sent on with replace(); a closed one is
      // swapped for a fresh frame, whose first load never counts as a step
      // (never touch src of a live frame: setting it is one more navigation, and one more step)
      if (open === w && f.contentWindow) { try { f.dataset.replacing = '1'; f.contentWindow.location.replace(src); f.dataset.at = src; } catch { f.setAttribute('src', src); } }
      else { const n = f.cloneNode(false); delete n.dataset.at; delete n.dataset.replacing; n.setAttribute('src', src); f.replaceWith(n); f = n; watchFrame(f); }
      frameNav = 0;
    }
    if (open !== w) show('wpage');
  }
  // a load after the first one is the page moving on inside its frame (an app's own links): one more history step
  function watchFrame(f) {
    let first = true, was = null;
    const at = () => { try { const l = f.contentWindow.location; return l.pathname + l.search + l.hash; } catch { return null; } };
    f.addEventListener('load', () => {
      const now = at();
      if (first) { first = false; was = now; return; }
      if (f.dataset.replacing) { delete f.dataset.replacing; was = now; return; }
      frameNav++; if (was && now !== was && !stepping) { trail.push({ page: was, title: $('.pg-t', document.getElementById('wpage')).textContent, y: 0 }); f.dataset.at = now; }
      was = now;
    });
  }
  { const f = $('#wpage .pg-f'); if (f) watchFrame(f); }
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || !e.data.bp) return;
    if (e.data.bp === 'page') openPage(e.data.path, e.data.title);
    else if (e.data.bp === 'home') {
      const t = e.data.hash && document.getElementById(e.data.hash.slice(1)), w = t && t.closest('.bw-win');
      if (w) { hide(true); setTimeout(() => { show(w.id, true); setTimeout(() => t.scrollIntoView({ block: 'start' }), 60); }, 250); } else if (e.data.esc) stepBack(); else close();
    }
  });
  function openChart() { if (open) hide(); window.__bobaiChart?.(true); document.querySelector('.bp-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  // the terminal's chart view is a layer too (its own × and its CHART tab on a phone open and close it)
  addEventListener('bt:chart', (e) => {
    const on = !!e.detail; if (on === chartOn) return; chartOn = on;
    if (on) { if (!open) pushLayer(); } else if (!open && !popping) popLayer();
  });
  let popping = false;
  addEventListener('popstate', (e) => {
    const st = e.state && e.state.bp;
    if (st === 'spent') { history.back(); return; }
    if (st === 'layer') return; // stepped forward onto a layer: nothing to reopen
    popping = true; trail = [];
    if (open) hide();
    if (chartOn) { const x = document.querySelector('#bt .cx-x'); if (x) x.click(); else window.__bobaiChart?.(false); }
    popping = false; frameNav = 0;
  });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-open]');
    if (c && c.dataset.open === 'chart') { e.preventDefault(); openChart(); return; }
    if (c && c.dataset.open.startsWith('page:')) { e.preventDefault(); openPage(c.dataset.open.slice(5)); return; }
    if (c) { e.preventDefault(); show(c.dataset.open); return; }
    const pl = e.target.closest('a[href]:not(.pg-open)');
    if (pl && !e.metaKey && !e.ctrlKey && !e.shiftKey) { const u = new URL(pl.getAttribute('href'), location.origin); if (u.origin === location.origin && PAGES.test(u.pathname)) { e.preventDefault(); openPage(u.pathname + u.search + u.hash, pl.textContent.trim()); return; } }
    if (e.target.closest('[data-close-win]')) { stepBack(); return; }
    if (e.target.classList.contains('bw-win')) { close(); return; }
    // an in-page link of the classic page ("#burns") opens the window that holds its target
    const a = e.target.closest('a[href^="#"]');
    if (a && a.getAttribute('href').length > 1) {
      const t = document.getElementById(a.getAttribute('href').slice(1)), w = t && t.closest('.bw-win');
      if (w) { e.preventDefault(); if (open !== w) show(w.id, !!open); setTimeout(() => t.scrollIntoView({ block: 'start' }), 60); }
      else e.preventDefault();
    }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopImmediatePropagation(); stepBack(); } }, true);
  // the live figure on each card
  const mirror = () => { for (const v of $$('[data-mirror]')) { const s = document.getElementById(v.dataset.mirror); const t = s && s.textContent.trim(); if (t && t !== '--' && v.textContent !== t) v.textContent = t; } };
  mirror(); setInterval(mirror, 2000);
  // the windows' images load quietly once the terminal has started, so a window opens complete
  setTimeout(() => $$('.bw-win img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; }), 6000);
  // a reload on a layer step (or a return from another site) finds nothing open: step off it quietly
  if (layer()) history.replaceState(null, '');
  // A LINK WITH AN ANCHOR opens its window (2026-09-27): brainonbnb.com/#tokenomics, #faq, #giggle … are linked from
  // the Telegram bot, llms.txt and our own pages, and every one of them now lives inside a closed window. #burns never
  // had a target of its own; it means the live burn table.
  const ALIAS = { burns: 'tx-body' };
  function openHash() {
    const h = decodeURIComponent(location.hash.slice(1)); if (!h || h === 'brain') return;
    const t = document.getElementById(ALIAS[h] || h), w = t && t.closest('.bw-win'); if (!w) return;
    // a window may fold its blocks into a closed Details as it opens (02 puts #giggle there): open the fold, then go
    // (2026-10-28: /#giggle opened window 02 at its top with the pot hidden)
    show(w.id); setTimeout(() => { const d = t.closest('details'); if (d) d.open = true; t.scrollIntoView({ block: 'start' }); }, 700);
  }
  if (document.readyState === 'complete') setTimeout(openHash, 400); else addEventListener('load', () => setTimeout(openHash, 400), { once: true });
  addEventListener('hashchange', openHash);

  // THE TERMINAL BIGGER (2026-09-30, operator: "enlarge the Brain Terminal by a button — no new pop-up, it simply uses
  // almost the whole screen, and the picture stays exactly the same"): the centre frame leaves the grid and fills the
  // window up to a 10 px margin; the terminal fits itself to the new size (its own ResizeObserver) — the same scene,
  // bigger. The same button or Esc brings it back. Only offered in the three-column layout: on a phone, a tablet
  // upright or a fold the terminal already spans the width.
  const center = $('.bp-center'), shr = $('#bt-shr'), grid = $('.bp-grid');
  if (center && shr && grid) {
    const GROW = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const SHRINK = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const big = document.createElement('button'); big.type = 'button'; big.className = 'bt-big';
    const isBig = () => document.body.classList.contains('bp-big');
    const set = (on) => {
      document.body.classList.toggle('bp-big', on);
      big.innerHTML = on ? SHRINK : GROW; big.setAttribute('aria-pressed', String(on));
      big.title = on ? 'Back to normal size (Esc)' : 'Make the terminal bigger';
      big.setAttribute('aria-label', big.title);
    };
    set(false); shr.after(big);
    big.onclick = () => set(!isBig());
    // offered only while the grid has its three columns; a layout without them ends the big view
    const fit = () => { const three = getComputedStyle(grid).gridTemplateColumns.split(' ').length === 3; big.hidden = !three; if (!three && isBig()) set(false); };
    fit(); addEventListener('resize', fit);
    // Esc: a window or the share dialog open over it close first (they take the key themselves)
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && isBig() && !open && !$('#bt-shm.on')) set(false); });
  }
})();

// THE AGENT WALL BEHIND THE TERMINAL (2026-11-22, operator: "the background of the terminal, like the Million Dollar
// Homepage: only agents, on the chain, holding $BOBAI, the bigger their share the bigger their logo"; 23.11.: 41 places).
// The same wall as /wall, drawn between the 3D picture and everything else in the window, so it reads as the terminal's
// own backdrop. It takes no click (taps go to BOBAI and the scene as before). Operator, later the same day: the WALL
// switch sits beside LIVE and looks like it; it turns the backdrop on and off (remembered); the wall exists only in the
// standard terminal, never with ROT or a Xmas theme; the clear view, with its explanation, is /wall (Apps & tools).
// Only logos whose bytes hash to the hash the agent signed are drawn.
(() => {
  const win = document.getElementById('bt-win'), live = document.getElementById('bt-live');
  if (!win || !live || !document.querySelector('.bp-center')) return;
  const API = 'https://agent.brainonbnb.com/wall', MAX = 41, KEY = 'bp-wall';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sha256 = async (buf) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), (x) => x.toString(16).padStart(2, '0')).join('');
  // squarified treemap, the same as /wall
  function squarify(items, x, y, w, h) {
    const total = items.reduce((s, i) => s + i.w, 0), out = []; if (!total || w <= 0 || h <= 0) return out;
    const scale = (w * h) / total; let rest = items.map((i) => ({ ...i, a: i.w * scale }));
    while (rest.length) {
      const short = Math.min(w, h); let row = [], best = Infinity;
      for (const it of rest) { const r = [...row, it], s = r.reduce((t, k) => t + k.a, 0), mx = Math.max(...r.map((k) => k.a)), mn = Math.min(...r.map((k) => k.a)), worst = Math.max((short * short * mx) / (s * s), (s * s) / (short * short * mn)); if (worst > best && row.length) break; row = r; best = worst; }
      const s = row.reduce((t, k) => t + k.a, 0), side = s / short; let off = 0;
      for (const k of row) { const len = k.a / side; if (w >= h) out.push({ ...k, x, y: y + off, w: side, h: len }); else out.push({ ...k, x: x + off, y, w: len, h: side }); off += len; }
      if (w >= h) { x += side; w -= side; } else { y += side; h -= side; }
      rest = rest.slice(row.length);
    }
    return out;
  }
  const layer = document.createElement('div'); layer.className = 'bp-wall'; layer.setAttribute('aria-hidden', 'true');
  const gl = document.getElementById('bt-gl'); if (gl) gl.after(layer); else win.prepend(layer);
  // the switch: small and round like ROT, left of LIVE on the same line (a text pill pushed ROT off the line)
  const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'bt-wall bw-abs'; // out of the flow from the start
  sw.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 2h7v7H2zM10.5 2H14v4.5h-3.5zM10.5 8H14v6h-3.5zM2 10.5h7V14H2z" fill="currentColor"/></svg>';
  live.before(sw);
  // never on from the start (operator, 22.11.): the visitor turns it on; that choice is remembered
  let on = false; try { on = localStorage.getItem(KEY) === 'on'; } catch {}
  const set = (v) => {
    on = v; layer.classList.toggle('off', !on); win.classList.toggle('bw-on', on); sw.setAttribute('aria-pressed', String(on));
    sw.title = on ? 'The Agent Wall is behind the terminal: AI agents sized by the $BOBAI they hold. Click to turn it off' : 'Show the Agent Wall behind the terminal';
    sw.setAttribute('aria-label', on ? 'Agent Wall backdrop: on' : 'Agent Wall backdrop: off');
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
    if (on && !DATA) load();
  };
  sw.onclick = () => set(!on);
  // THE PLACE (operator: "on the same line as LIVE and ROT, and WALL and ROT must not cross"): the switch stays out of
  // the bar's flow, so ROT keeps exactly the room it had; it takes a free gap on LIVE's line: left of LIVE when the
  // title's text leaves room, else right of ROT (or of LIVE) when nothing stands there, else just under LIVE
  const SZ = 24, GAP = 6;
  const place = () => {
    const hud = sw.parentElement; if (!hud) return;
    const h = hud.getBoundingClientRect(), lv = live.getBoundingClientRect(); if (!lv.width) return;
    const cy = (lv.top + lv.bottom) / 2, rot = document.getElementById('bt-br'), rr = rot && rot.getBoundingClientRect();
    const rotOnLine = rr && rr.width && Math.abs((rr.top + rr.bottom) / 2 - cy) < 8;
    // the title's text, as drawn (its box is wider than its words)
    let textRight = -Infinity; const tt = hud.querySelector('.ttl');
    if (tt) { const rg = document.createRange(); rg.selectNodeContents(tt); for (const q of rg.getClientRects()) if (q.width && q.bottom > cy - 14 && q.top < cy + 14) textRight = Math.max(textRight, q.right); }
    const others = [...hud.children].filter((e) => e !== sw && e !== tt && e !== live && e !== rot && e.getBoundingClientRect().width && getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect());
    const free = (x) => x >= h.left + 4 && x + SZ <= h.right - 4 && !others.some((q) => q.left < x + SZ + GAP && q.right > x - GAP && q.top < cy + SZ / 2 && q.bottom > cy - SZ / 2) && !(rotOnLine && rr.left < x + SZ + GAP && rr.right > x - GAP);
    const left = lv.left - GAP - SZ, right = (rotOnLine ? rr.right : lv.right) + GAP;
    let x, y = cy - SZ / 2;
    if (left - GAP >= textRight && free(left)) x = left; else if (free(right)) x = right; else { x = lv.left; y = lv.bottom + 4; }
    sw.classList.add('bw-abs'); sw.style.left = x - h.left + 'px'; sw.style.top = y - h.top + 'px';
  };
  new ResizeObserver(place).observe(win); new MutationObserver(place).observe(win, { attributes: true, attributeFilter: ['class'] });
  { let n = 0; const t = setInterval(() => { place(); if (++n > 40) clearInterval(t); }, 500); } // ROT settles in its first seconds
  addEventListener('resize', place);
  let DATA = null; const LOGOS = {}, ADS = {};
  function draw() {
    if (!DATA) return;
    // the board ends above the chart strip (operator, 23.11.: "the Brain On BNB logo can't be seen, it is under the chart"):
    // no tile hides under it; the strip itself is thin glass while the wall is on
    { const tl = win.querySelector('.tl'), tb = tl && getComputedStyle(tl).display !== 'none' ? tl.offsetHeight : 0; if (layer.style.bottom !== tb + 'px') layer.style.bottom = tb + 'px'; }
    // on a phone the board starts under the top bar (operator, 23.11.: "texts and symbols cut over each other", on phones
    // too): title, LIVE, WALL and MOMENTS stood on the ad's own words; on a wide window the bar has room beside the tiles
    { let tp = 0; if (win.classList.contains('portrait')) { const y0 = win.getBoundingClientRect().top;
        // the title counts by its own line (its box keeps room for the mood chip, invisible with the wall on)
        for (const e of win.querySelectorAll('.hud > :not(.ttl), .hud .bt-wall, .hud .ttl > b')) { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); if (r.width && r.height && cs.visibility !== 'hidden' && cs.display !== 'none') tp = Math.max(tp, r.bottom - y0); }
        tp = Math.ceil(tp + 6); }
      if (layer.style.top !== tp + 'px') layer.style.top = tp + 'px'; }
    const W = layer.clientWidth, H = layer.clientHeight, list = DATA.wall || [];
    if (!W || !H) return;
    // the floor keeps a small holder (or one holding none, while places are free) visible and shrinks with the crowd (at most half the wall): all 41 fit
    const sum = list.reduce((s, a) => s + a.bobai, 0), cap = Math.max(1e6, sum * 1.15), floor = cap * Math.min(.035, .5 / Math.max(1, list.length));
    const items = list.map((a) => ({ w: Math.max(a.bobai, floor), e: a })).sort((p, q) => q.w - p.w);
    const used = items.reduce((s, i) => s + i.w, 0), f = list.length >= MAX ? 1 : Math.min(1, used / cap);
    let tiles;
    if (!items.length) tiles = [{ free: true, x: 0, y: 0, w: W, h: H }];
    else if (f >= .999) tiles = squarify(items, 0, 0, W, H);
    else if (W >= H) { const aw = Math.max(W * f, Math.min(W * .4, 150)); tiles = [...squarify(items, 0, 0, aw, H), { free: true, x: aw, y: 0, w: W - aw, h: H }]; }
    else { const ah = Math.max(H * f, Math.min(H * .4, 150)); tiles = [...squarify(items, 0, 0, W, ah), { free: true, x: 0, y: ah, w: W, h: H - ah }]; }
    layer.innerHTML = tiles.map((t) => {
      const st = `left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px`;
      // THE SAME BOARD AS /wall (operator: "in the terminal and on /wall it must look the same", "a huge marketing
      // board"): the same tiles, and every free place one cell of a fine grid, so all 41 places can be seen
      if (t.free) { const n = Math.max(1, MAX - list.length), sz = Math.sqrt((t.w * t.h) / n), cols = Math.max(1, Math.round(t.w / sz)), rows = Math.ceil(n / cols);
        return `<div class="bw-t free" style="${st}"><i style="background-size:${(t.w / cols).toFixed(2)}px ${(t.h / rows).toFixed(2)}px"></i></div>`; }
      const e = t.e, size = t.w < 36 || t.h < 36 ? ' small tiny' : t.w < 120 || t.h < 90 ? ' small' : '', ad = ADS[e.agent] && t.w >= 150 && t.h >= 120;
      return `<div class="bw-t${size}${ad ? ' ad' : ''}" style="${st}" data-agent="${esc(e.agent)}"><i>${LOGOS[e.agent] ? `<img src="${LOGOS[e.agent]}" alt="">` : `<span class="ph">${esc((String(e.name || '?').replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase())}</span>`}<span class="nm">${esc(e.name)}</span><span class="hd">${Number(e.bobai).toLocaleString('en-US', { maximumFractionDigits: 0 })} $BOBAI</span></i></div>`;
    }).join('');
    // a living ad plays in its tile as on /wall: its own frame, no network, storage, cookie or wallet (it can show, never track)
    layer.querySelectorAll('.bw-t.ad > i').forEach((el) => { const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('referrerpolicy', 'no-referrer'); f.tabIndex = -1; f.setAttribute('aria-hidden', 'true');
      f.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#0b090a;color:#f3ece6;font-family:system-ui,sans-serif}</style></head><body>${ADS[el.parentElement.dataset.agent]}</body></html>`; el.prepend(f); });
  }
  let loading = null;
  function load() {
    if (loading) return loading;
    loading = fetch(API).then((r) => r.json()).then(async (j) => {
      DATA = j; draw(); layer.classList.add('built');
      await Promise.all((j.wall || []).filter((e) => e.ad_url && e.ad_sha256).map(async (e) => { try { const txt = await (await fetch(e.ad_url)).text(); const h = await sha256(new TextEncoder().encode(txt)); if (h === e.ad_sha256 && e.message.includes(`Living ad sha256: ${h}\n`)) ADS[e.agent] = txt; else delete ADS[e.agent]; } catch {} }));
      await Promise.all((j.wall || []).map(async (e) => { if (LOGOS[e.agent + ':' + e.logo_sha256]) { LOGOS[e.agent] = LOGOS[e.agent + ':' + e.logo_sha256]; return; } try { const buf = await (await fetch(e.logo_url)).arrayBuffer(); const h = await sha256(buf); if (h === e.logo_sha256 && e.message.includes(`Logo sha256: ${h}\n`)) LOGOS[e.agent] = LOGOS[e.agent + ':' + h] = URL.createObjectURL(new Blob([buf], { type: e.logo_type })); else delete LOGOS[e.agent]; } catch {} }));
      draw();
    }).catch(() => { if (!DATA) setTimeout(load, 15e3); }).finally(() => { loading = null; });
    return loading;
  }
  set(on);
  // the terminal's own start comes first (not on 'load': the terminal's clips keep that event waiting for long)
  if (on) setTimeout(load, 2500);
  new ResizeObserver(() => { clearTimeout(draw.t); draw.t = setTimeout(draw, 150); }).observe(layer);
  setInterval(() => { if (on && !document.hidden) load(); }, 10 * 60e3);
})();
