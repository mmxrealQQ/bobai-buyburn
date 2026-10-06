// Each window's head strip (2026-09-26, stage 2): before the classic block, the window says its point in figures and
// one diagram, the way the terminal's flipchart does. Built when a window opens, refreshed while it is open; every
// figure is one the page already read (window.__bobaiNums from app.js, __bobaiPhase, the logs), nothing new is asked
// of the chain except where noted.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const N = () => window.__bobaiNums || {};
  const NF = {}; const nf = (n, d = 0) => (NF[d] || (NF[d] = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))).format(Number(n)); // one formatter per decimal count, kept: toLocaleString built a new one on every call (35x slower, 2026-10-06), same output
  const cmp = (n) => Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
  const fig = (k, v, c) => `<div class="hf"><span>${k}</span><b${c ? ' class="c"' : ''}>${v}</b></div>`;
  let burnsOwn = null;
  const burns = async () => N().burns || burnsOwn || (burnsOwn = await fetch('/logs/burns.json').then((r) => r.json()).catch(() => null));
  function strip(win) { let h = $('.bw-hero', win); if (!h) { h = document.createElement('div'); h.className = 'bw-hero'; $('.bw-body', win).prepend(h); } return h; }

  // 01 THE TOKEN: price, market cap, and the supply as one bar — burned against circulating
  function w01(win) {
    const c = N().chain; if (!c || !c.priceUsd) return;
    const dead = c.bobaiDead || 0, circ = 1e9 - dead;
    strip(win).innerHTML = fig('PRICE', '$' + c.priceUsd.toPrecision(4)) + fig('MARKET CAP', '$' + nf(c.priceUsd * circ)) + fig('BURNED FOR GOOD', (dead / 1e9 * 100).toFixed(2) + '%', 1) + fig('CIRCULATING', cmp(circ) + ' BOBAI')
      + `<div class="hd"><div class="ht">THE SUPPLY · 1,000,000,000 BOBAI</div><div class="sup"><i style="width:${dead / 1e7}%;background:linear-gradient(90deg,#ff7a3d,#ffb46b);box-shadow:0 0 12px #ff7a3d"></i><i style="flex:1;background:linear-gradient(90deg,rgba(240,185,11,.55),rgba(240,185,11,.25))"></i></div><div class="sup-k"><span>🔥 ${nf(dead)} at the dead address</span><span>${nf(circ)} circulating</span></div></div>`;
  }
  // 02 TOKENOMICS: the 3% of every trade as one ring, every share of the table in force
  const SPLIT = [['bobaiPct', '#ff7a3d', 'BOBAI bought & burned'], ['bobPct', '#fbbf24', '$BOB bought & burned'], ['liqPct', '#2dd4bf', 'liquidity, LP burned'], ['lpPct', '#60a5fa', 'DeFi agent'], ['gigglePct', '#f472b6', 'Giggle Academy pot'], ['creatorPct', '#d6c7b8', 'creator']];
  function w02(win) {
    const ph = typeof window.__bobaiPhase === 'function' && window.__bobaiPhase(); if (!ph) return;
    const parts = SPLIT.map(([k, c, l]) => [parseFloat(ph[k]) || 0, c, l]).filter((p) => p[0] > 0), tot = parts.reduce((a, p) => a + p[0], 0) || 3;
    const R = 50, C = 2 * Math.PI * R; let off = 0;
    const arcs = parts.map(([v, c]) => { const len = v / tot * C, s = `<circle r="${R}" cx="65" cy="65" stroke="${c}" stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" style="filter:drop-shadow(0 0 4px ${c})"/>`; off += len; return s; }).join('');
    // the same next-buyback figure as the Classic tile (2026-10-05): app.js publishes it with the bot's gas reserve left out
    const q = N().chain, sBnb = q ? (q.splitBnb ?? (q.walletBnb > 0.004 ? q.walletBnb - 0.003 : 0)) : 0, nextUsd = q ? (q.nextBuybackUsd ?? q.queuedBobai * q.priceUsd + sBnb * q.bnbUsd) : 0;
    strip(win).innerHTML = `<div class="hd"><div class="ht">WHERE THE 3% OF EVERY TRADE GOES · THE TABLE IN FORCE</div><div class="ring"><svg viewBox="0 0 130 130"><circle class="bg" r="${R}" cx="65" cy="65"/>${arcs}<text x="65" y="71">3%</text></svg><ul>${parts.map(([v, c, l]) => `<li style="color:${c}"><i style="background:${c}"></i><span style="color:#dcd8ea">${l}</span><b>${v}%</b></li>`).join('')}</ul></div></div>`
      + (q ? fig('NEXT BUYBACK CHARGING', '$' + nf(nextUsd, 2), 1) + fig('TAX IN THE TOKEN', cmp(q.queuedBobai) + ' BOBAI') + fig('BNB TO SPLIT · GAS RESERVE KEPT', sBnb.toFixed(4) + ' BNB') : '');
  }
  // 03 PROOF: thirty days of burns, BOBAI and $BOB, one bar a day
  async function w03(win) {
    const b = await burns(); if (!Array.isArray(b)) return;
    const day = (t) => Math.floor(t / 86400e3), today = day(Date.now()), A = new Array(30).fill(0), n7 = b.filter((e) => Date.parse(e.time) >= Date.now() - 7 * 86400e3);
    // per day: BOBAI burned, the BNB that bought it, the runs (operator, 2026-10-01: "on the bars, hover or tap: that day's
    // BOBAI and its value in USD, only for the day you are on")
    const Bnb = new Array(30).fill(0), Runs = new Array(30).fill(0);
    for (const e of b) { const i = 29 - (today - day(Date.parse(e.time))); if (i >= 0 && i < 30) { A[i] += +e.bobaiBurned || 0; Bnb[i] += +e.bobaiBurnBnb || 0; Runs[i]++; } }
    const tot = b.reduce((a, e) => a + (+e.bobaiBurned || 0), 0);
    const h = strip(win);
    h.innerHTML = fig('BOT BURN RUNS', nf(b.length)) + fig('BOBAI BURNED BY THE BOT', cmp(tot), 1) + fig('LAST 7 DAYS', cmp(n7.reduce((a, e) => a + (+e.bobaiBurned || 0), 0)) + ' BOBAI') + fig('LAST BURN', new Date(Date.parse(b[b.length - 1].time)).toISOString().replace('T', ' ').slice(0, 16) + ' UTC')
      + `<div class="hd"><div class="ht">BOBAI BURNED BY THE BOT · ONE BAR A DAY · 30 DAYS · HOVER OR TAP A DAY</div><div class="bbw"><canvas height="90"></canvas><div class="bbt" hidden></div></div></div>`;
    const cv = $('canvas', h), tip = $('.bbt', h);
    let hi = -1;
    const draw = () => {
      const w = cv.clientWidth, H = 90, dpr = Math.min(devicePixelRatio, 2); if (!w) return;
      cv.width = w * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const mx = Math.max(...A) || 1, bw = w / 30;
      A.forEach((v, i) => { const bh = v ? Math.max(2, v / mx * (H - 14)) : 1; g.fillStyle = i === hi ? '#fff3d6' : v ? (i === 29 ? '#ffd28a' : '#ff7a3d') : 'rgba(255,255,255,.08)'; if (v) { g.shadowColor = i === hi ? '#ffd28a' : '#ff7a3d'; g.shadowBlur = i === hi ? 14 : 8; } g.fillRect(i * bw + 2, H - 12 - bh, bw - 4, bh); g.shadowBlur = 0; });
      if (hi >= 0) { g.fillStyle = 'rgba(255,210,138,.12)'; g.fillRect(hi * bw, 0, bw, H - 12); }
      g.fillStyle = 'rgba(160,162,192,.6)'; g.font = '600 9px ui-monospace,monospace'; g.fillText('30 DAYS AGO', 0, H - 1); g.textAlign = 'right'; g.fillText('TODAY', w, H - 1);
    };
    // one day's figures: the date (UTC, as the bars count), BOBAI burned, worth today at the live price, the BNB that bought it
    const show = (i) => {
      hi = i; draw(); if (i < 0) { tip.hidden = true; return; }
      const N = window.__bobaiNums || {}, px = (N.chain && N.chain.priceUsd) || (window.__btPrice && window.__btPrice()) || 0, d = new Date((today - (29 - i)) * 86400e3).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
      tip.innerHTML = A[i]
        ? `<b>${d}</b><span>${cmp(A[i])} BOBAI burned</span><span>${px ? `worth $${nf(A[i] * px, 2)} today` : ''}${px && Bnb[i] ? ' · ' : ''}${Bnb[i] ? `bought with ${Bnb[i].toFixed(4)} BNB` : ''}</span><i>${Runs[i]} bot run${Runs[i] === 1 ? '' : 's'}</i>`
        : `<b>${d}</b><span>no burn run that day</span>`;
      tip.hidden = false; const bw = cv.clientWidth / 30, x = (i + 0.5) * bw, tw = tip.offsetWidth;
      // beside the bar, on the side with room: never above the chart, where the window cut off the date
      const L = x > cv.clientWidth / 2 ? x - bw / 2 - 6 - tw : x + bw / 2 + 6;
      tip.style.left = Math.max(0, Math.min(cv.clientWidth - tw, L)) + 'px';
    };
    const at = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(29, Math.floor((e.clientX - r.left) / (r.width / 30)))); };
    cv.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') show(at(e)); });
    cv.addEventListener('pointerdown', (e) => show(at(e) === hi && e.pointerType !== 'mouse' ? -1 : at(e))); // a finger: tap a day, tap it again to close
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') show(-1); });
    requestAnimationFrame(draw);
  }
  // 07 QUESTIONS: find one by typing
  function w07(win) {
    if ($('.bw-hero', win)) return;
    strip(win).innerHTML = '<input class="fq" type="search" placeholder="Search the answers — buy, tax, contract, agents …" aria-label="Search the questions">';
    $('.fq', win).addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); for (const d of $$('details', win)) d.hidden = !!q && !d.textContent.toLowerCase().includes(q); });
  }
  // 05 ROADMAP (window w06): the plan as one track — every phase a station, the shipped ones lit, the active one pulsing
  function w06(win) {
    if ($('.bw-hero', win)) return;
    const ph = $$('.rm', win); if (!ph.length) return;
    const done = ph.filter((p) => !p.classList.contains('rmn')).length;
    strip(win).innerHTML = `<div class="hd"><div class="ht">THE PLAN · ${done} OF ${ph.length} PHASES SHIPPED OR RUNNING</div><div class="rtrack">${ph.map((p) => { const st = p.classList.contains('rmd') ? 'done' : p.classList.contains('rmn') ? 'next' : 'on'; const items = p.querySelectorAll('li').length, ok = p.querySelectorAll('.ck').length; return `<div class="rt ${st}"><i></i><b>${p.querySelector('h3')?.textContent || ''}</b><span>${(p.querySelector('.rp')?.textContent || '').replace(/Phase \d+ — /, '')}</span><em>${ok} of ${items} done</em></div>`; }).join('')}</div></div>`;
  }
  const BUILD = { w01, w02, w03, w06, w07 };
  let timer = 0;
  addEventListener('bp:open', (e) => {
    const id = e.detail, win = document.getElementById(id), f = BUILD[id]; if (!win || !f) return;
    f(win); clearInterval(timer); if (id !== 'w07' && id !== 'w06') timer = setInterval(() => { if (!win.hidden) f(win); else clearInterval(timer); }, 20000);
  });
  addEventListener('bobai:nums', () => { const w = $('.bw-win.on'); if (w && BUILD[w.id] && w.id !== 'w07' && w.id !== 'w06') BUILD[w.id](w); });
})();
