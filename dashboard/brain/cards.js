// The cards live (2026-09-26): every closed window shows one small picture of what is inside it, drawn from the same
// reads the page already made — the homepage's figures (window.__bobaiNums, app.js), the phase table
// (window.__bobaiPhase) — and the text of the window itself. No card invents a number.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const GOLD = '#F0B90B', UP = '#35e07a', DOWN = '#ff4d6d';
  const NUMS = () => window.__bobaiNums || {};
  const cmp = (n) => Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const viz = (n) => { const c = $(`[data-open="w${n}"] .bw-viz`); return c; };
  const canvasIn = (el, h) => {
    let cv = el.querySelector('canvas'); if (!cv) { cv = document.createElement('canvas'); el.appendChild(cv); }
    const w = el.clientWidth, dpr = Math.min(devicePixelRatio, 2); if (!w) return null;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { g, w, h };
  };

  // 01 THE TOKEN: the supply, burned against circulating
  function draw01() {
    const el = viz('01'), c = NUMS().chain; if (!el || !c || !c.bobaiDead) return;
    const dead = c.bobaiDead, pct = dead / 1e9 * 100;
    // classes, not inline styles (2026-09-28): on a tall screen brain.css lets the bar and its figures grow with the card
    el.innerHTML = `<div class="cv-sup"><div class="cv-sup-bar"><i style="width:${pct}%"></i><i></i></div><div class="cv-sup-k"><span>🔥 burned</span><span>circulating</span></div><div class="cv-sup-v"><span>${cmp(dead)}</span><span>${cmp(1e9 - dead)}</span></div></div>`;
    const v = $('[data-open="w01"] .bw-v'); if (v) v.textContent = pct.toFixed(2) + '%';
  }

  // 02 TOKENOMICS: the 3% as a ring, the split in force (the homepage's own phase table)
  const SPLIT = [['bobaiPct', '#ff7a3d', 'BOBAI burn'], ['bobPct', '#fbbf24', 'BOB burn'], ['liqPct', '#2dd4bf', 'liquidity'], ['lpPct', '#60a5fa', 'DeFi agent'], ['gigglePct', '#f472b6', 'Giggle'], ['creatorPct', '#d6c7b8', 'creator']];
  function draw02() {
    const el = viz('02'), ph = typeof window.__bobaiPhase === 'function' && window.__bobaiPhase(); if (!el || !ph) return;
    const parts = SPLIT.map(([k, c, l]) => [parseFloat(ph[k]) || 0, c, l]).filter((p) => p[0] > 0), tot = parts.reduce((a, p) => a + p[0], 0) || 3;
    const R = 17, C = 2 * Math.PI * R; let off = 0;
    el.innerHTML = `<div class="cv-ring"><svg viewBox="0 0 44 44"><circle r="${R}" cx="22" cy="22" class="bg"/>${parts.map(([v, c]) => { const len = v / tot * C, s = `<circle r="${R}" cx="22" cy="22" stroke="${c}" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`; off += len; return s; }).join('')}<text x="22" y="25.5">3%</text></svg>`
      + `<ul>${parts.slice(0, 4).map(([v, c, l]) => `<li><i style="background:${c}"></i>${l}<b>${v}%</b></li>`).join('')}</ul></div>`;
  }

  // 03 PROOF: BOBAI burned per day, 14 days (the burn log the homepage already read; read here when it has not)
  // app.js reads the same 107 KB log; the card waits up to 10 s for its copy before asking itself (2026-09-30: a slow phone
  // loaded it twice at once)
  let burnsOwn = null, burnsAsked = false, burnsTimer = 0; const burnsT0 = performance.now();
  function draw03() {
    const el = viz('03'), b = NUMS().burns || burnsOwn; if (!el) return; if (!Array.isArray(b)) { if (!burnsAsked && performance.now() < burnsT0 + 10e3) { clearTimeout(burnsTimer); burnsTimer = setTimeout(draw03, 800); return; } if (!burnsAsked) { burnsAsked = true; fetch('/logs/burns.json').then((r) => r.json()).then((j) => { burnsOwn = j; draw03(); }).catch(() => {}); } return; }
    const day = (t) => Math.floor(t / 86400e3), today = day(Date.now()), v = new Array(14).fill(0);
    for (const e of b) { const i = 13 - (today - day(Date.parse(e.time))); if (i >= 0 && i < 14) v[i] += +e.bobaiBurned || 0; }
    const c = canvasIn(el, Math.max(40, Math.min(130, el.clientHeight - 6))); if (!c) return; const { g, w, h } = c, mx = Math.max(...v) || 1, bw = w / 14; // as tall as the card allows
    v.forEach((x, i) => { const bh = x ? Math.max(2, x / mx * (h - 2)) : 1; g.fillStyle = x ? (i === 13 ? '#ffd28a' : '#ff7a3d') : 'rgba(255,255,255,.1)'; if (x) { g.shadowColor = '#ff7a3d'; g.shadowBlur = 6; } g.fillRect(i * bw + 1.5, h - bh, bw - 3, bh); g.shadowBlur = 0; });
  }

  // 04 ECOSYSTEM: the apps inside, as their own icons
  function draw04() {
    const el = viz('04'); if (!el || el.dataset.done) return;
    const cards = $$('#w04 .ec'); if (!cards.length) return;
    // with their names (2026-09-28): eight bare 26 px icons left the biggest card half empty and said nothing
    const SHORT = { 'NFT Buy Drops': 'NFT Drops', 'Pool Scanner': 'Scanner', 'Agent Services': 'Services', 'Burn & Add Liq': 'Burn & Liq', "Worldcup '26": 'Worldcup' };
    const nm = (c) => { const t = (c.querySelector('h3')?.textContent || '').trim(); const d = document.createElement('i'); d.textContent = SHORT[t] || t; return d.innerHTML; };
    el.innerHTML = `<div class="cv-icons">${cards.slice(0, 8).map((c) => `<span class="cv-app">${c.querySelector('svg')?.outerHTML || c.querySelector('img')?.outerHTML || ''}<em>${nm(c)}</em></span>`).join('')}</div>`;
    const v = $('[data-open="w04"] .bw-v'); if (v) v.textContent = cards.length + ' apps & tools';
    el.dataset.done = 1;
  }


  // 06 ROADMAP: the phases as a track, the active one lit
  function draw06() {
    const el = viz('06'); if (!el || el.dataset.done) return;
    const ph = $$('#w06 .rm'); if (!ph.length) return;
    el.innerHTML = `<div class="cv-road">${ph.map((p) => `<span class="${p.classList.contains('rmd') ? 'done' : p.classList.contains('rmn') ? 'next' : 'on'}"><i></i><em>${p.querySelector('h3')?.textContent || ''}</em></span>`).join('')}</div>`;
    // "What comes next" names what comes next (2026-10-05: it showed the last shipped phase), with how many are shipped under it
    const act = ph.filter((p) => !p.classList.contains('rmn')).pop(), next = ph.find((p) => p.classList.contains('rmn')), v = $('[data-open="w06"] .bw-v'), l = $('[data-open="w06"] .bw-l');
    if (v && (next || act)) v.textContent = next ? 'Next · ' + (next.querySelector('h3')?.textContent || '') : act.querySelector('.rp')?.textContent.replace(/\s+—.*/, '') + ' · ' + (act.querySelector('h3')?.textContent || '');
    if (l && next) l.textContent = `${ph.filter((p) => !p.classList.contains('rmn')).length} of ${ph.length} phases shipped`;
    el.dataset.done = 1;
  }

  // 07 QUESTIONS: one question at a time, turning like a card
  let qi = 0;
  function draw07() {
    const el = viz('07'); if (!el) return;
    const qs = $$('#w07 summary').map((s) => s.textContent.replace(/[^\p{L}\p{N}?!.,'’$&()% -]+$/u, '').trim()).filter(Boolean); if (!qs.length) return;
    const v = $('[data-open="w07"] .bw-v'); if (v) v.textContent = qs.length + ' answers';
    el.innerHTML = `<div class="cv-q">“${qs[qi++ % qs.length]}”</div>`;
  }

  // the figures under the pictures, each one the terminal does not already show (operator: "nothing twice")
  function figs() {
    const ph = typeof window.__bobaiPhase === 'function' && window.__bobaiPhase(), v2 = $('[data-open="w02"] .bw-v');
    const end = ph && (typeof ph.end === 'number' ? ph.end : Date.parse(ph.end)) || window.__bobaiNums?.gg?.end;
    if (v2 && end) { const d = Math.max(0, Math.ceil((end - Date.now()) / 86400e3)); v2.textContent = d + ' days'; }
    const b = window.__bobaiNums?.burns || burnsOwn, v3 = $('[data-open="w03"] .bw-v');
    if (v3 && Array.isArray(b)) v3.textContent = cmp(b.filter((e) => Date.parse(e.time) >= Date.now() - 7 * 86400e3).reduce((a, e) => a + (+e.bobaiBurned || 0), 0)) + ' BOBAI';
  }
  function all() { draw01(); draw02(); draw03(); draw04(); draw06(); figs(); }
  addEventListener('bobai:nums', all);
  addEventListener('resize', () => { draw03(); });
  // the TG bot's 111 KB candle ledger was fetched every 2 min for nothing, and an NFT card drawer was never called: both
  // gone (2026-10-05). The periodic ticks skip while the tab is hidden; the next 'bobai:nums' on return redraws.
  setTimeout(all, 1500); setInterval(() => { if (!document.hidden) all(); }, 30000);
  // (05 is the chart now; the agent server's count lives in the terminal's BOTS view)
  draw07(); setInterval(() => { if (!document.hidden) draw07(); }, 6000);
})();
