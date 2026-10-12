// The cards live (2026-09-26): every closed window shows one small picture of what is inside it, drawn from the same
// reads the page already made — the homepage's figures (window.__bobaiNums, app.js), the phase table
// (window.__bobaiPhase) — and the text of the window itself. No card invents a number.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const GOLD = '#F0B90B', UP = '#35e07a', DOWN = '#ff4d6d';
  const NUMS = () => window.__bobaiNums || {};
  const cmp = (n) => Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  // $BOBAI with its dollars (2026-10-09), at the price the homepage read from its own pool
  const usdOf = (n) => { const p = NUMS().chain?.priceUsd; return p > 0 ? ` <small class="cv-usd">≈$${cmp(n * p)}</small>` : ''; };
  const viz = (n) => { const c = $(`[data-open="w${n}"] .bw-viz`); return c; };
  const canvasIn = (el, h) => {
    let cv = el.querySelector('canvas'); if (!cv) { cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true'); el.appendChild(cv); } /* the card's own text names it (2026-10-10) */
    const w = el.clientWidth, dpr = Math.min(devicePixelRatio, 2); if (!w) return null;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { g, w, h };
  };

  // 01 THE TOKEN: the supply, burned against circulating
  // LIVE (operator, 2026-10-12: "the windows more interactive and intelligent", 01 = "live burn in the card"): the dead
  // address is read from the chain every 30 s (app.js); when it holds more than the card shows, the figures count up to
  // it and the line under them says how much just went. Otherwise the line names the bot's last burn (logs/burns.json).
  let shown01 = 0, just01 = 0, just01At = 0, anim01 = 0;
  const ago = (t) => { const m = Math.max(0, (Date.now() - t) / 60e3); return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  function paint01(el, dead) {
    const pct = dead / 1e9 * 100;
    // classes, not inline styles (2026-09-28): on a tall screen brain.css lets the bar and its figures grow with the card
    el.innerHTML = `<div class="cv-sup"><div class="cv-sup-bar"><i style="width:${pct}%"></i><i></i></div><div class="cv-sup-k"><span>🔥 burned</span><span>circulating</span></div><div class="cv-sup-v"><span>${cmp(dead)}${usdOf(dead)}</span><span>${cmp(1e9 - dead)}${usdOf(1e9 - dead)}</span></div></div>`;
    const v = $('[data-open="w01"] .bw-v'); if (v) v.textContent = pct.toFixed(2) + '%';
  }
  function line01() {
    const l = $('[data-open="w01"] .bw-l'); if (!l) return;
    const fresh = Date.now() - just01At < 90e3, btn = l.closest('button'); if (btn) btn.classList.toggle('just-burned', fresh);
    if (fresh) { l.textContent = `🔥 +${cmp(just01)} $BOBAI just burned`; return; }
    const b = NUMS().burns || burnsOwn, last = Array.isArray(b) ? [...b].reverse().find((e) => +e.bobaiBurned > 0) : null;
    l.textContent = last ? `burned · last +${cmp(+last.bobaiBurned)}, ${ago(Date.parse(last.time))}` : 'of the supply burned for good';
  }
  function draw01() {
    const el = viz('01'), c = NUMS().chain; if (!el || !c || !c.bobaiDead) return;
    const dead = c.bobaiDead;
    if (shown01 && dead > shown01 + 0.5 && !anim01) {
      const from = shown01, t0 = performance.now(); just01 = dead - from; just01At = Date.now(); line01();
      const step = (t) => { const k = Math.min(1, (t - t0) / 1600), e = 1 - Math.pow(1 - k, 3); paint01(el, from + (dead - from) * e); if (k < 1) anim01 = requestAnimationFrame(step); else anim01 = 0; };
      anim01 = requestAnimationFrame(step); shown01 = dead; setTimeout(line01, 90.5e3); return;
    }
    if (!anim01) paint01(el, dead);
    shown01 = dead; line01();
  }
  // a test hook (qa/live01.mjs): what the card does when the chain read shows more burned
  window.__card01 = { draw: () => draw01(), state: () => ({ shown01, just01, just01At }) };

  // 01's WINDOW: WHAT WOULD MY TRADE DO? (operator, 2026-10-12, "a calculator in the window"): an amount in $ or $BOBAI,
  // split by the phase in force (app.js __bobaiPhase, the same table the window shows) at the pool's own price. Nothing
  // more is claimed: the tax leaves the contract as BNB and the burns buy with it at the pool.
  function calc01() {
    const flow = $('#w01 .tax-flow'); if (!flow || $('#w01 .cx01')) return;
    const box = document.createElement('div'); box.className = 'cx01'; box.dataset.nousd = '1'; // its dollars are its own (app.js would add a second ≈$ to every $BOBAI amount)
    box.innerHTML = '<h4>What would my trade do?</h4><div class="cx01-in"><label>Trade <input type="number" min="0" step="any" inputmode="decimal" value="100" aria-label="Trade amount"></label><div class="cx01-u" role="group" aria-label="Unit"><button type="button" data-u="usd" aria-pressed="true">$</button><button type="button" data-u="bobai" aria-pressed="false">$BOBAI</button></div></div><div class="cx01-out" aria-live="polite"></div><p class="cx01-n">At the pool&rsquo;s price right now, before the split&rsquo;s own swap costs. The 3% leaves the token contract as BNB; the bot splits it every 10 min.</p>';
    flow.insertAdjacentElement('afterend', box);
    const inp = box.querySelector('input'), out = box.querySelector('.cx01-out'); let unit = 'usd';
    const PARTS = [['bobaiPct', '#35e07a', '$BOBAI burned for good', 1], ['bobPct', '#ff6b6b', '$BOB burned'], ['liqPct', '#f0b90b', 'liquidity added, LP burned'], ['lpPct', '#60a5fa', 'to the DeFi agent'], ['gigglePct', '#f472b6', 'to the Giggle pot'], ['creatorPct', '#a0a2c0', 'to the creator']];
    const usd = (x) => '$' + (x >= 100 ? x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : x.toFixed(x >= 0.01 || !x ? 2 : 4));
    const run = () => {
      const ph = typeof window.__bobaiPhase === 'function' && window.__bobaiPhase(), p = NUMS().chain?.priceUsd, a = Math.max(0, parseFloat(inp.value) || 0);
      if (!ph || !(p > 0)) { out.innerHTML = '<p class="cx01-n">Reading the price and the split…</p>'; return; }
      const tradeUsd = unit === 'usd' ? a : a * p;
      const rows = PARTS.map(([k, col, name, bobai]) => { const pc = parseFloat(ph[k]) || 0; if (!pc) return ''; const u = tradeUsd * pc / 100;
        return `<div class="cx01-r${bobai ? ' hi' : ''}"><i style="background:${col}"></i><span>${name}</span><b>${pc}%</b><em>${usd(u)}${bobai ? ` <small>≈ ${cmp(u / p)} $BOBAI</small>` : ''}</em></div>`; }).join('');
      const tax = PARTS.reduce((t, [k]) => t + (parseFloat(ph[k]) || 0), 0);
      out.innerHTML = `<div class="cx01-t">A ${usd(tradeUsd)} trade${unit === 'bobai' ? ` (${cmp(a)} $BOBAI)` : ''} pays ${usd(tradeUsd * tax / 100)} tax (${+tax.toFixed(2)}%):</div>` + rows;
    };
    inp.addEventListener('input', run);
    box.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', () => {
      unit = b.dataset.u; box.querySelectorAll('[data-u]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const p = NUMS().chain?.priceUsd; if (p > 0) { const a = parseFloat(inp.value) || 0; inp.value = unit === 'bobai' ? Math.round(a / p) : +(a * p).toFixed(2); }
      run();
    }));
    run(); setInterval(() => { const w = $('#w01'); if (w && !w.hidden) run(); }, 30e3);
  }

  // 02 TOKENOMICS: the 3% as a ring, the split in force (the homepage's own phase table)
  const SPLIT = [['bobaiPct', '#ff7a3d', 'BOBAI burn'], ['bobPct', '#fbbf24', 'BOB burn'], ['liqPct', '#2dd4bf', 'liquidity'], ['lpPct', '#60a5fa', 'DeFi agent'], ['gigglePct', '#f472b6', 'Giggle'], ['creatorPct', '#d6c7b8', 'creator']];
  function draw02() {
    const el = viz('02'), ph = typeof window.__bobaiPhase === 'function' && window.__bobaiPhase(); if (!el || !ph) return;
    const parts = SPLIT.map(([k, c, l]) => [parseFloat(ph[k]) || 0, c, l]).filter((p) => p[0] > 0), tot = parts.reduce((a, p) => a + p[0], 0) || 3;
    const R = 17, C = 2 * Math.PI * R; let off = 0;
    el.innerHTML = `<div class="cv-2"><div class="cv-ring"><svg viewBox="0 0 44 44"><circle r="${R}" cx="22" cy="22" class="bg"/>${parts.map(([v, c]) => { const len = v / tot * C, s = `<circle r="${R}" cx="22" cy="22" stroke="${c}" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`; off += len; return s; }).join('')}<text x="22" y="25.5">3%</text></svg>`
      + `<ul>${parts.slice(0, 4).map(([v, c, l]) => `<li><i style="background:${c}"></i>${l}<b>${v}%</b></li>`).join('')}${parts.length > 4 ? `<li><i style="background:linear-gradient(90deg,${parts.slice(4).map((p) => p[1]).join(',')})"></i>${parts.slice(4).map((p) => p[2]).join(' · ')}<b>${+parts.slice(4).reduce((a, p) => a + p[0], 0).toFixed(2)}%</b></li>` : ''}</ul></div>${next02Html()}</div>`; /* all six slices of the ring (2026-10-10: the legend summed to 1.9 % under a 3 % ring) */
  }

  // 02 LIVE (operator, 2026-10-12: "next split live" + "where it went, 7 days"). THE NEXT SPLIT, as it charges: the token
  // holds its 3% as $BOBAI until minDispatch(), then sends it on as BNB to the buyback wallet; the bot splits what is
  // there above its gas reserve on its next 10-minute run (the same sum and reserve as the terminal and Classic, app.js).
  // The bot's last run is its own heartbeat (logs.brainonbnb.com/health).
  let botLast = 0;
  const readBot = () => fetch('https://logs.brainonbnb.com/health', { cache: 'no-store' }).then((r) => r.json()).then((j) => { const t = Date.parse(j?.buyback); if (t) botLast = t; }).catch(() => {});
  setTimeout(readBot, 2500); setInterval(() => { if (!document.hidden) readBot(); }, 60e3);
  function next02() {
    const c = NUMS().chain; if (!c || !(c.priceUsd > 0) || !(c.minDispatch > 0)) return null;
    const sBnb = c.walletBnb > 0.004 ? c.walletBnb - 0.003 : 0, usd = c.queuedBobai * c.priceUsd + sBnb * (c.bnbUsd || 0);
    const pct = Math.min(100, c.queuedBobai / c.minDispatch * 100);
    const mins = botLast ? Math.max(0, Math.ceil((botLast + 600e3 - Date.now()) / 60e3)) : null;
    return { usd, pct, ready: sBnb > 0, sBnb, mins };
  }
  function next02Html() {
    const n = next02(); if (!n) return '';
    const $u = '$' + n.usd.toFixed(n.usd >= 1000 ? 0 : 2);
    const txt = n.ready ? `${$u} ready · split ${n.mins == null ? 'at the bot’s next run' : n.mins <= 1 ? 'about now' : `in ~${n.mins} min`}` : `${$u} charging · ${n.pct < 10 ? n.pct.toFixed(1) : n.pct.toFixed(0)}% to the next split`;
    return `<div class="cv-next${n.ready ? ' ready' : ''}" title="The token sends its tax on at ${cmp(NUMS().chain.minDispatch)} $BOBAI; the bot splits the BNB every 10 min"><div class="cv-next-bar"><i style="width:${n.ready ? 100 : n.pct.toFixed(1)}%"></i></div><span>${txt}</span></div>`;
  }

  // WHERE IT WENT, 7 DAYS (02's window): every part the bot sent, summed from its own logs — the split runs
  // (logs/burns.json) and the liquidity adds (logs/bobai-liq-log.json) — with the last transaction of each part
  let split7 = null, split7At = 0;
  async function where02() {
    const body = $('#w02 .bw-body'); if (!body) return;
    let box = $('#w02 .cx02');
    if (!box) { box = document.createElement('div'); box.className = 'cx02'; box.dataset.nousd = '1'; body.insertAdjacentElement('afterbegin', box); }
    if (!split7 || Date.now() - split7At > 5 * 60e3) {
      const [b, l] = await Promise.all([fetch('/logs/burns.json').then((r) => r.json()).catch(() => null), fetch('/logs/bobai-liq-log.json').then((r) => r.json()).catch(() => null)]);
      if (!Array.isArray(b) || !Array.isArray(l)) { if (!split7) box.innerHTML = '<h4>Where it went · last 7 days</h4><p class="cx01-n">The bot’s logs could not be read just now.</p>'; return; }
      const from = Date.now() - 7 * 86400e3, B = b.filter((e) => Date.parse(e.time) >= from), L = l.filter((e) => Date.parse(e.time) >= from);
      const sum = (A, k) => A.reduce((t, e) => t + (+e[k] || 0), 0), last = (A, k) => [...A].reverse().find((e) => e[k])?.[k];
      split7 = { runs: B.length, adds: L.length, parts: [
        ['#35e07a', '$BOBAI bought and burned', sum(B, 'bobaiBurnBnb'), `${cmp(sum(B, 'bobaiBurned'))} $BOBAI to the dead address`, last(B, 'bobaiBurnTx')],
        ['#ff6b6b', '$BOB bought and burned', sum(B, 'bobBurnBnb'), `${cmp(sum(B, 'bobBurned'))} $BOB to the dead address`, last(B, 'bobBurnTx')],
        ['#f0b90b', 'liquidity added, LP burned', sum(L, 'bnb'), `${cmp(sum(L, 'bobaiBought'))} $BOBAI paired, ${sum(L, 'lpBurned').toFixed(2)} LP burned`, last(L, 'lpBurnTx')],
        ['#60a5fa', 'to the DeFi agent', sum(B, 'lpAgentBnb'), 'its working capital', last(B, 'lpAgentTx')],
        ['#f472b6', 'to the Giggle pot', sum(B, 'giggleBnb'), 'the Giggle Academy pot', last(B, 'giggleTx')],
        ['#a0a2c0', 'to the creator', sum(B, 'creatorBnb'), 'the creator’s share', last(B, 'creatorTx')],
      ] };
      split7At = Date.now();
    }
    const bnbP = NUMS().chain?.bnbUsd || 0, tot = split7.parts.reduce((t, p) => t + p[2], 0);
    const usd = (x) => bnbP > 0 ? ` <small>≈$${(x * bnbP).toFixed(x * bnbP >= 100 ? 0 : 2)}</small>` : '';
    const n = next02();
    box.innerHTML = `<h4>Where it went · last 7 days</h4><p class="cx02-s">${split7.runs} split run${split7.runs === 1 ? '' : 's'} and ${split7.adds} liquidity add${split7.adds === 1 ? '' : 's'} by the bot, ${tot.toFixed(4)} BNB${usd(tot)} in all — from its own logs; each line links its last transaction.</p>`
      + split7.parts.map(([col, name, bnb, what, tx]) => `<div class="cx01-r cx02-r"><i style="background:${col}"></i><span>${name}<small>${what}</small></span><b>${tot ? (bnb / tot * 100).toFixed(0) + '%' : ''}</b><em>${bnb.toFixed(4)} BNB${usd(bnb)}${tx ? ` <a href="https://bscscan.com/tx/${tx}" target="_blank" rel="noopener" title="its last transaction on BscScan">tx ↗</a>` : ''}</em></div>`).join('')
      + (n ? `<p class="cx01-n">Next split: ${n.ready ? `$${n.usd.toFixed(2)} in BNB is ready; the bot splits it ${n.mins == null ? 'on its next run' : n.mins <= 1 ? 'about now' : `in ~${n.mins} min`}.` : `$${n.usd.toFixed(2)} of tax is charging in the token, ${n.pct.toFixed(1)}% of the ${cmp(NUMS().chain.minDispatch)} $BOBAI at which it is sent on.`} Dollars at today’s BNB price.</p>` : '');
  }
  new MutationObserver(() => { const w2 = $('#w02'); if (w2 && !w2.hidden) where02(); }).observe(document.getElementById('w02') || document.body, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => { const w3 = $('#w03'); if (w3 && !w3.hidden) proof03(); }).observe(document.getElementById('w03') || document.body, { attributes: true, attributeFilter: ['hidden'] });
  window.__card02 = { next: () => next02(), where: () => split7 };

  // 03 PROOF: BOBAI burned per day, 14 days (the burn log the homepage already read; read here when it has not)
  // app.js reads the same 107 KB log; the card waits up to 10 s for its copy before asking itself (2026-09-30: a slow phone
  // loaded it twice at once)
  let burnsOwn = null, burnsAsked = false, burnsTimer = 0; const burnsT0 = performance.now();
  function draw03() {
    const el = viz('03'), b = NUMS().burns || burnsOwn; if (!el) return; if (!Array.isArray(b)) { if (!burnsAsked && performance.now() < burnsT0 + 10e3) { clearTimeout(burnsTimer); burnsTimer = setTimeout(draw03, 800); return; } if (!burnsAsked) { burnsAsked = true; fetch('/logs/burns.json').then((r) => r.json()).then((j) => { burnsOwn = j; draw03(); }).catch(() => {}); } return; }
    const day = (t) => Math.floor(t / 86400e3), today = day(Date.now()), v = new Array(14).fill(0), runs = new Array(14).fill(0);
    for (const e of b) { const i = 13 - (today - day(Date.parse(e.time))); if (i >= 0 && i < 14 && +e.bobaiBurned > 0) { v[i] += +e.bobaiBurned; runs[i]++; } }
    days03 = { v, runs, today };
    const c = canvasIn(el, Math.max(40, Math.min(130, el.clientHeight - 6))); if (!c) return; const { g, w, h } = c, mx = Math.max(...v) || 1, bw = w / 14; // as tall as the card allows
    v.forEach((x, i) => { const bh = x ? Math.max(2, x / mx * (h - 2)) : 1, on = i === sel03; g.fillStyle = on ? '#fff3d6' : x ? (i === 13 ? '#ffd28a' : '#ff7a3d') : 'rgba(255,255,255,.1)'; if (x) { g.shadowColor = on ? '#ffd28a' : '#ff7a3d'; g.shadowBlur = on ? 12 : 6; } g.fillRect(i * bw + 1.5, h - bh, bw - 3, bh); g.shadowBlur = 0; });
    if (!el.dataset.tap) { el.dataset.tap = 1; tap03(el); }
  }
  // 03's BARS TELL THEIR DAY (operator, 2026-10-12: "bars to tap"): hover on a desktop, a tap on a phone — that day's
  // burned $BOBAI, in how many runs, in dollars at the pool's price now; a tap on a bar does not open the window (a tap
  // anywhere else on the card still does). The card's line comes back 6 s after the last look.
  let days03 = null, sel03 = -1, sel03T = 0;
  function show03(i) {
    const l = $('[data-open="w03"] .bw-l'); if (!l || !days03) return;
    if (!l.dataset.base) l.dataset.base = l.textContent;
    clearTimeout(sel03T);
    if (i < 0) { sel03 = -1; l.textContent = l.dataset.base; l.classList.remove('bar-day'); draw03(); return; }
    sel03 = i; const x = days03.v[i], n = days03.runs[i], p = NUMS().chain?.priceUsd;
    const d = new Date((days03.today - (13 - i)) * 86400e3).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    l.textContent = x ? `${i === 13 ? 'Today' : d}: ${cmp(x)} $BOBAI burned${p > 0 ? ` ≈$${cmp(x * p)}` : ''} · ${n} run${n === 1 ? '' : 's'}` : `${i === 13 ? 'Today' : d}: no burn by the bot`;
    l.classList.add('bar-day'); draw03(); sel03T = setTimeout(() => show03(-1), 6000);
  }
  function tap03(el) {
    const at = (e) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(13, Math.floor((e.clientX - r.left) / r.width * 14))); };
    el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { const i = at(e); if (i !== sel03) show03(i); } });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { clearTimeout(sel03T); sel03T = setTimeout(() => show03(-1), 600); } });
    el.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); show03(at(e)); });
  }
  window.__card03 = { show: (i) => show03(i), days: () => days03 };

  // 03's WINDOW: CHECK IT YOURSELF (operator, 2026-10-12): the dead address's $BOBAI as the chain says it right now (the
  // page's own 30-second read), and the bot's last burns, each with its transaction — believe nobody, look it up
  function proof03() {
    const body = $('#w03 .bw-body'); if (!body) return;
    let box = $('#w03 .cx03');
    if (!box) { box = document.createElement('div'); box.className = 'cx02 cx03'; box.dataset.nousd = '1'; body.insertAdjacentElement('afterbegin', box); }
    const c = NUMS().chain, b = NUMS().burns || burnsOwn, p = c?.priceUsd;
    const L = Array.isArray(b) ? b.filter((e) => +e.bobaiBurned > 0 && e.bobaiBurnTx).slice(-10).reverse() : [];
    const dead = 'https://bscscan.com/token/0x245c386dcfed896f5c346107596141e5edcbffff?a=0x000000000000000000000000000000000000dEaD';
    const when = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
    box.innerHTML = `<h4>Check it yourself</h4>`
      + (c?.bobaiDead ? `<p class="cx02-s">At the dead address right now: <b style="color:#f3efe6">${c.bobaiDead.toLocaleString('en-US', { maximumFractionDigits: 0 })} $BOBAI</b>${p > 0 ? ` ≈$${cmp(c.bobaiDead * p)}` : ''} — read from BNB Chain ${Math.max(1, Math.round((Date.now() - (c.at || Date.now())) / 1000))} s ago. <a href="${dead}" target="_blank" rel="noopener">See it on BscScan ↗</a></p>` : '<p class="cx02-s">Reading the dead address…</p>')
      + (L.length ? `<p class="cx02-s" style="margin-top:6px">The bot’s last ${L.length} burns — open any of them:</p>` + L.map((e) => `<div class="cx01-r cx02-r"><i style="background:#ff7a3d"></i><span>${when(Date.parse(e.time))}<small>bought with ${(+e.bobaiBurnBnb || 0).toFixed(4)} BNB</small></span><b></b><em>${cmp(+e.bobaiBurned)} $BOBAI${p > 0 ? `<small>≈$${(+e.bobaiBurned * p).toFixed(2)} today</small>` : ''} <a href="https://bscscan.com/tx/${e.bobaiBurnTx}" target="_blank" rel="noopener">tx ↗</a></em></div>`).join('') : '');
  }
  window.__card03.proof = () => proof03();

  // 04's LOGOS LIVE (operator, 2026-10-12: "a live dot per logo" + "a live fact on hover"): each app asked once on
  // load and every 5 min — its own live source where it has one (the Plaza's census, the DeFi agent's position, the
  // NFT drop, the agent server's count), else the page the logo opens. Green: it answered just now; red: it did not.
  // On a desktop a look at a logo puts one line in the card's foot: that live figure, or the app's own description.
  const LIVE04 = {
    '/registry': ['/api-registry.json', (j) => j?.reachability?.reachable ? `${Number(j.reachability.reachable).toLocaleString('en-US')} agents answer our census` : null],
    '/defi': ['https://agent.brainonbnb.com/lp/portfolio', (j) => j?.pool && typeof j.pool.in_range === 'boolean' ? `CAKE/BNB ${j.pool.in_range ? 'in range' : 'out of range'} · ±${j.pool.width_pct}%` : null],
    '/nft/': ['/api/nft-drop', (j) => j?.total?.minted != null ? `${j.total.minted.toLocaleString('en-US')} of ${j.total.cap.toLocaleString('en-US')} minted` : null],
    '/services': ['https://agent.brainonbnb.com/stats', (j) => j?.asked?.total ? `${cmp(j.asked.total)} calls by agents answered` : null],
  };
  function live04(el, cards) {
    const apps = $$('.cv-app', el);
    const ask = () => apps.forEach((a, k) => {
      const c = cards[k]; if (!c) return; const path = new URL(c.getAttribute('href') || '', location.origin).pathname, src = LIVE04[path];
      const desc = (c.querySelector('p')?.textContent || '').trim().replace(/\s+/g, ' ');
      a.dataset.fact = desc; a.dataset.live = a.dataset.live || 'wait';
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
      (src ? fetch(src[0], { signal: ctl.signal, cache: 'no-store' }).then((r) => r.ok ? r.json() : Promise.reject(r.status)).then((j) => { const f = src[1](j); if (!f) throw 0; a.dataset.fact = f; })
        : fetch(path, { method: 'HEAD', signal: ctl.signal, cache: 'no-store' }).then((r) => { if (!r.ok) throw r.status; }))
        .then(() => { a.dataset.live = 'up'; a.title = `${a.textContent.trim()} — answering now`; }, () => { a.dataset.live = 'down'; a.title = `${a.textContent.trim()} — did not answer just now`; })
        .finally(() => clearTimeout(t));
    });
    setTimeout(ask, 3500); setInterval(() => { if (!document.hidden) ask(); }, 5 * 60e3);
    const l = $('[data-open="w04"] .bw-l'); let back = 0;
    apps.forEach((a) => {
      a.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'mouse' || !l) return; clearTimeout(back); if (!l.dataset.base) l.dataset.base = l.textContent;
        l.textContent = `${a.textContent.trim()} · ${a.dataset.fact || ''}`; l.classList.add('app-fact'); });
      a.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'mouse' || !l) return; back = setTimeout(() => { l.textContent = l.dataset.base; l.classList.remove('app-fact'); }, 400); });
    });
  }
  window.__card04 = { state: () => $$('[data-open="w04"] .cv-app').map((a) => ({ n: a.textContent.trim(), live: a.dataset.live, fact: a.dataset.fact })) };

  // 04 ECOSYSTEM: the apps inside, as their own icons
  function draw04() {
    const el = viz('04'); if (!el || el.dataset.done) return;
    const cards = $$('#w04 .ec'); if (!cards.length) return;
    // with their names (2026-09-28): eight bare 26 px icons left the biggest card half empty and said nothing
    const SHORT = { 'NFT Buy Drops': 'NFT Drops', 'Pool Scanner': 'Scanner', 'Agent Services': 'Services', 'Burn & Add Liq': 'Burn & Liq', "Worldcup '26": 'Worldcup' };
    const nm = (c) => { const t = (c.querySelector('h3')?.textContent || '').trim(); const d = document.createElement('i'); d.textContent = SHORT[t] || t; return d.innerHTML; };
    // a logo opens its own page window (data-open="page:…", handled by brain.js); a page off this site has no door
    const door = (c) => { const u = new URL(c.getAttribute('href') || '', location.origin); return u.origin === location.origin ? ` data-open="page:${u.pathname}${u.search}" title="Open ${nm(c)}"` : ''; };
    el.innerHTML = `<div class="cv-icons">${cards.slice(0, 8).map((c) => `<span class="cv-app"${door(c)}>${c.querySelector('svg')?.outerHTML || c.querySelector('img')?.outerHTML || ''}<em>${nm(c)}</em></span>`).join('')}</div>`;
    const v = $('[data-open="w04"] .bw-v'); if (v) v.textContent = cards.length + ' apps & tools';
    el.dataset.done = 1; live04(el, cards);
  }


  // 06 ROADMAP: the phases as a track, the active one lit
  function draw06() {
    const el = viz('06'); if (!el || el.dataset.done) return;
    const ph = $$('#w06 .rm'); if (!ph.length) return;
    el.innerHTML = `<div class="cv-road">${ph.map((p) => `<span class="${p.classList.contains('rmd') ? 'done' : p.classList.contains('rmn') ? 'next' : 'on'}"><i></i><em>${p.querySelector('h3')?.textContent || ''}</em></span>`).join('')}</div>`;
    // "What comes next" names what comes next (2026-10-05: it showed the last shipped phase), with how many are shipped under it
    const act = ph.filter((p) => !p.classList.contains('rmn')).pop(), next = ph.find((p) => p.classList.contains('rmn')), v = $('[data-open="w06"] .bw-v'), l = $('[data-open="w06"] .bw-l');
    if (v && (next || act)) v.textContent = next ? 'Next · ' + (next.querySelector('h3')?.textContent || '') : act.querySelector('.rp')?.textContent.replace(/\s+—.*/, '') + ' · ' + (act.querySelector('h3')?.textContent || '');
    if (l && next) l.textContent = `${ph.filter((p) => !p.classList.contains('rmn')).length} of ${ph.length} phases live`; /* shipped or running, as the window says */
    el.dataset.done = 1;
  }

  // 07 QUESTIONS: one question at a time, turning like a card
  let qi = 0;
  function draw07() {
    const el = viz('07'); if (!el) return;
    const qs = $$('#w07 summary').map((s) => s.textContent.replace(/[^\p{L}\p{N}?!.,'’$&()% -]+$/u, '').trim()).filter(Boolean); if (!qs.length) return;
    const v = $('[data-open="w07"] .bw-v'); if (v) v.textContent = qs.length + ' answers';
    el.innerHTML = `<div class="cv-q">“${qs[qi++ % qs.length]}”</div>`;
    // as many lines as the picture holds, the rest an ellipsis (2026-10-12: on 1024x768 and 1366x768 the question was cut
    // in the middle of a line); no line fits, no question
    const q = el.firstChild, lh = parseFloat(getComputedStyle(q).lineHeight) || 17, n = Math.floor((el.clientHeight + 1) / lh);
    q.style.webkitLineClamp = q.style.lineClamp = String(Math.max(1, n)); q.style.display = n < 1 ? 'none' : '';
  }

  // the figures under the pictures, each one the terminal does not already show (operator: "nothing twice")
  function figs() {
    const ph = typeof window.__bobaiPhase === 'function' && window.__bobaiPhase(), v2 = $('[data-open="w02"] .bw-v');
    const end = ph && (typeof ph.end === 'number' ? ph.end : Date.parse(ph.end)) || window.__bobaiNums?.gg?.end;
    if (v2 && end) { const ms = Math.max(0, end - Date.now()), d = Math.floor(ms / 86400e3), h = Math.floor(ms % 86400e3 / 3600e3); v2.textContent = d + ' d ' + h + ' h'; } /* as the window counts it (2026-10-10: card 41 days, window 40 days 19 hours) */
    const b = window.__bobaiNums?.burns || burnsOwn, v3 = $('[data-open="w03"] .bw-v');
    if (v3 && Array.isArray(b)) v3.textContent = cmp(b.filter((e) => Date.parse(e.time) >= Date.now() - 7 * 86400e3).reduce((a, e) => a + (+e.bobaiBurned || 0), 0)) + ' BOBAI'; /* the dollars beside it */ if (v3 && Array.isArray(b) && NUMS().chain?.priceUsd > 0) v3.textContent += ' ≈$' + ((u) => u < 1e4 ? Math.round(u).toLocaleString('en-US') : cmp(u))(b.filter((e) => Date.parse(e.time) >= Date.now() - 7 * 86400e3).reduce((a, e) => a + (+e.bobaiBurned || 0), 0) * NUMS().chain.priceUsd) /* whole dollars, not $404.2 */;
  }
  function all() { draw01(); draw02(); draw03(); draw04(); draw06(); figs(); calc01(); const w2 = $('#w02'); if (w2 && !w2.hidden) where02(); const w3 = $('#w03'); if (w3 && !w3.hidden) proof03(); }
  addEventListener('bobai:nums', all);
  addEventListener('resize', () => { draw03(); });
  // the TG bot's 111 KB candle ledger was fetched every 2 min for nothing, and an NFT card drawer was never called: both
  // gone (2026-10-05). The periodic ticks skip while the tab is hidden; the next 'bobai:nums' on return redraws.
  setTimeout(all, 1500); setInterval(() => { if (!document.hidden) all(); }, 30000);
  // (05 is the chart now; the agent server's count lives in the terminal's BOTS view)
  draw07(); setInterval(() => { if (!document.hidden) draw07(); }, 6000);
})();
