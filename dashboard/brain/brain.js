// The new page's windows (2026-09-26). The cards around the terminal open their block as a window over it; a figure
// on a card is mirrored from the element inside its window, which app.js fills — one read, shown twice.
// BACK closes (2026-09-26, operator: "close correctly everywhere and come back"): every window, the page window and the
// chart view is one step in the browser's history, so a phone's back gesture closes what is open instead of leaving
// the page — and the × closes it by stepping back the same way, so history never fills with dead entries.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let open = null, back = null, chartOn = false, frameNav = 0;
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
  function close() { if (!open) return; hide(); if (!chartOn) popLayer(); }
  // STAGE 3: the site's own pages open in the page window, running their own code in the Brain look (?embed=1);
  // the apps (brainScreener, the game, the World Cup tip game) keep their own look and their own navigation inside
  const PAGES = /^\/(scanner|registry|services|defi|liquidity|agents|nft|library|whitepaper|advantage|session|source|token|faq|roadmap|archive|brainscreener|game|worldcup)(\/|$)/;
  const NAMES = { scanner: 'Pool Scanner', registry: 'Brain Plaza', services: 'Agent Services', defi: 'DeFi Agent', liquidity: 'DeFi Agent', agents: 'DeFi Agent', nft: 'NFT Collection', library: 'The Library', whitepaper: 'Lite Paper', advantage: 'Agent Advantage Report', session: 'Session Keys', source: 'The Source', token: 'The Token', faq: 'Questions', roadmap: 'Roadmap', archive: 'Archive', brainscreener: 'brainScreener', game: 'The BOBAI Game', worldcup: "World Cup '26 Tip Game" };
  function openPage(path, title) {
    const u = new URL(path, location.origin), key = u.pathname.split('/')[1];
    u.searchParams.set('embed', '1');
    const w = document.getElementById('wpage'), src = u.pathname + u.search + u.hash;
    $('.pg-t', w).textContent = NAMES[key] || title || 'Page';
    w.setAttribute('aria-label', NAMES[key] || title || 'Page'); $('.pg-f', w)?.setAttribute('title', NAMES[key] || title || 'Page'); // a screen reader names the page, not "Page"
    // the header carries the page's own logo, the one on its ecosystem card, instead of an arrow (operator, 2026-09-27);
    // a page without a card (the library, the lite paper …) carries the BOBAI logo
    const k = $('.pg-k', w), card = $$('a.ec').find((a) => new URL(a.getAttribute('href'), location.origin).pathname.split('/')[1] === key);
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
  function watchFrame(f) { let first = true; f.addEventListener('load', () => { if (first) { first = false; return; } if (f.dataset.replacing) { delete f.dataset.replacing; return; } frameNav++; }); }
  { const f = $('#wpage .pg-f'); if (f) watchFrame(f); }
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || !e.data.bp) return;
    if (e.data.bp === 'page') openPage(e.data.path, e.data.title);
    else if (e.data.bp === 'home') {
      const t = e.data.hash && document.getElementById(e.data.hash.slice(1)), w = t && t.closest('.bw-win');
      if (w) { hide(true); setTimeout(() => { show(w.id, true); setTimeout(() => t.scrollIntoView({ block: 'start' }), 60); }, 250); } else close();
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
    popping = true;
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
    if (e.target.closest('[data-close-win]') || e.target.classList.contains('bw-win')) { close(); return; }
    // an in-page link of the classic page ("#burns") opens the window that holds its target
    const a = e.target.closest('a[href^="#"]');
    if (a && a.getAttribute('href').length > 1) {
      const t = document.getElementById(a.getAttribute('href').slice(1)), w = t && t.closest('.bw-win');
      if (w) { e.preventDefault(); if (open !== w) show(w.id, !!open); setTimeout(() => t.scrollIntoView({ block: 'start' }), 60); }
      else e.preventDefault();
    }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopImmediatePropagation(); close(); } }, true);
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
    show(w.id); setTimeout(() => t.scrollIntoView({ block: 'start' }), 260);
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
