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
        // the $BOBAI it burns sits beside the name, so every row's share stands right next to its dollars (2026-10-19)
        return `<div class="cx01-r${bobai ? ' hi' : ''}"><i style="background:${col}"></i><span>${name}${bobai ? ` <small>${cmp(u / p)} $BOBAI</small>` : ''}</span><b>${pc}%</b><em>${usd(u)}</em></div>`; }).join('');
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
    verify01(box);
  }
  // 01's WINDOW: THE CONTRACT, READ JUST NOW (2026-10-13): what the page says about the token — nobody owns it, the tax
  // is 3% — asked from the contract itself the moment the window opens: owner() and feeRate() (basis points)
  function verify01(after) {
    if ($('#w01 .cx01v')) return;
    const box = document.createElement('div'); box.className = 'cx02 cx01v'; box.dataset.nousd = '1'; after.insertAdjacentElement('afterend', box);
    const CA = '0x245c386dcfed896f5c346107596141e5edcbffff', read = (data) => fetch('https://bsc-dataseed.binance.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: CA, data }, 'latest'] }) }).then((r) => r.json()).then((j) => j.result);
    const draw = () => Promise.all([read('0x8da5cb5b'), read('0x978bbdb9')]).then(([o, f]) => {
      const owner = o ? '0x' + o.slice(-40) : null, nobody = owner === '0x' + '0'.repeat(40), bps = f ? parseInt(f, 16) : null;
      const row = (ok, what, got) => `<div class="cx01-r"><i style="background:${ok ? '#35e07a' : '#ff4d6d'}"></i><span>${what}</span><b>${ok ? '✓' : '✗'}</b><em>${got}</em></div>`;
      box.innerHTML = `<h4>Checked on the contract just now</h4><p class="cx02-s">Not our word: these two answers come from the $BOBAI contract on BNB Chain the moment this window opened. <a href="https://bscscan.com/token/${CA}#readContract" target="_blank" rel="noopener">Read it yourself on BscScan ↗</a></p>`
        + (owner ? row(nobody, 'Nobody owns it — owner() is the zero address', nobody ? '0x000…000' : owner.slice(0, 8) + '…') : '<p class="cx01-n">owner() did not answer just now.</p>')
        + (bps != null ? row(bps === 300, 'The tax is fixed at 3% — feeRate() in basis points', `${bps} = ${(bps / 100).toFixed(2)}%`) : '<p class="cx01-n">feeRate() did not answer just now.</p>');
    }).catch(() => { box.innerHTML = '<h4>Checked on the contract just now</h4><p class="cx01-n">The chain did not answer just now.</p>'; });
    draw(); new MutationObserver(() => { const w = $('#w01'); if (w && !w.hidden) draw(); }).observe(document.getElementById('w01'), { attributes: true, attributeFilter: ['hidden'] });
  }

  // 02 TOKENOMICS: the 3% as a ring, the split in force (the homepage's own phase table)
  const SPLIT = [['bobaiPct', '#ff7a3d', 'BOBAI burn'], ['bobPct', '#fbbf24', 'BOB burn'], ['liqPct', '#2dd4bf', 'liquidity'], ['lpPct', '#60a5fa', 'DeFi agent'], ['gigglePct', '#f472b6', 'Giggle'], ['creatorPct', '#d6c7b8', 'creator']];
  function draw02() {
    const el = viz('02'), ph = typeof window.__bobaiPhase === 'function' && window.__bobaiPhase(); if (!el || !ph) return;
    const parts = SPLIT.map(([k, c, l]) => [parseFloat(ph[k]) || 0, c, l]).filter((p) => p[0] > 0), tot = parts.reduce((a, p) => a + p[0], 0) || 3;
    const R = 17, C = 2 * Math.PI * R; let off = 0;
    el.innerHTML = `<div class="cv-2"><div class="cv-ring"><svg viewBox="0 0 44 44"><circle r="${R}" cx="22" cy="22" class="bg"/>${parts.map(([v, c]) => { const len = v / tot * C, s = `<circle r="${R}" cx="22" cy="22" stroke="${c}" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`; off += len; return s; }).join('')}<text x="22" y="25.5">3%</text></svg>`
      + `<ul class="cv-leg${parts.length > 5 ? ' six' : ''}">${parts.map(([v, c, l]) => `<li><i style="background:${c}"></i>${l === 'Giggle' ? 'Giggle pot' : l}<b>${v}%</b></li>`).join('')}</ul></div>${next02Html()}</div>`; /* all six slices of the ring (2026-10-10: the legend summed to 1.9 % under a 3 % ring) */
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
  // ON ONE SCREEN (operator, 2026-10-19, his choice): the week is no longer a box of its own above the ring that
  // repeated the six shares — hero.js puts each share's week into the ring's own list (split7, keyed by share), and
  // shape02 below turns the boost and the pot into two small cards with the tables and the pool's depth under Details.
  async function where02() {
    const body = $('#w02 .bw-body'); if (!body) return;
    shape02();
    if (where02.busy) return;   // hero.js asks too (below), while a read may already be on its way
    if (!split7 || Date.now() - split7At > 5 * 60e3) {
      where02.busy = true;
      try { await read02(); } finally { where02.busy = false; }
    }
  }
  async function read02() {
    {
      const [b, l] = await Promise.all([fetch('/logs/burns.json').then((r) => r.json()).catch(() => null), fetch('/logs/bobai-liq-log.json').then((r) => r.json()).catch(() => null)]);
      // the ring shows no week then, never a guess — and asks again shortly, three times (19.10.: a slow read on the preview
      // left "…" in every row until the window was opened again)
      if (!Array.isArray(b) || !Array.isArray(l)) { if ((where02.tries = (where02.tries || 0) + 1) <= 3) setTimeout(where02, 3000); return; }
      where02.tries = 0;
      const from = Date.now() - 7 * 86400e3, B = b.filter((e) => Date.parse(e.time) >= from), L = l.filter((e) => Date.parse(e.time) >= from);
      const sum = (A, k) => A.reduce((t, e) => t + (+e[k] || 0), 0), last = (A, k) => [...A].reverse().find((e) => e[k])?.[k];
      // every token amount with its dollars at today's price (operator rule, 2026-10-10)
      const C = NUMS().chain || {}, at$ = (x, pr) => pr > 0 ? ` ≈$${cmp(x * pr)}` : '';
      split7 = { runs: B.length, adds: L.length, parts: [
        ['#35e07a', '$BOBAI bought and burned', sum(B, 'bobaiBurnBnb'), `${cmp(sum(B, 'bobaiBurned'))} $BOBAI${at$(sum(B, 'bobaiBurned'), C.priceUsd)} to the dead address`, last(B, 'bobaiBurnTx'), 'bobaiPct'],
        ['#ff6b6b', '$BOB bought and burned', sum(B, 'bobBurnBnb'), `${cmp(sum(B, 'bobBurned'))} $BOB${at$(sum(B, 'bobBurned'), C.bobUsdPrice)} to the dead address`, last(B, 'bobBurnTx'), 'bobPct'],
        ['#f0b90b', 'liquidity added, LP burned', sum(L, 'bnb'), `${cmp(sum(L, 'bobaiBought'))} $BOBAI${at$(sum(L, 'bobaiBought'), C.priceUsd)} paired, ${sum(L, 'lpBurned').toFixed(2)} LP burned`, last(L, 'lpBurnTx'), 'liqPct'],
        ['#60a5fa', 'to the DeFi agent', sum(B, 'lpAgentBnb'), 'its working capital', last(B, 'lpAgentTx'), 'lpPct'],
        ['#f472b6', 'to the Giggle pot', sum(B, 'giggleBnb'), 'the Giggle Academy pot', last(B, 'giggleTx'), 'gigglePct'],
        ['#a0a2c0', 'to the creator', sum(B, 'creatorBnb'), 'the creator’s share', last(B, 'creatorTx'), 'creatorPct'],
      ] };
      split7At = Date.now();
      if (typeof window.__hero02 === 'function') window.__hero02();
    }
  }
  // the boost and the pot as two cards (name, one sentence, one live figure, the days left), read from the fields
  // app.js already fills (bb3-*, gg-*); the full blocks, their tables and the pool's depth move under Details
  function shape02() {
    const body = $('#w02 .bw-body'); if (!body) return;
    if (!body.dataset.shaped) {
      const boost = $('#liq-boost-bobai-3', body), pot = $('#giggle', body), sec = $('section.sec', body), lqd = sec && $('.lqd', sec), hero = $('.bw-hero', body);
      if (!hero && !shape02.tries) shape02.tries = 0;
      if (!hero && shape02.tries++ < 20) { setTimeout(shape02, 300); return; }   // the ring is drawn on the same open
      if (!boost || !pot || !sec || !hero) return;
      body.dataset.shaped = '1';
      const k = document.createElement('div'); k.className = 'cx2k'; k.dataset.nousd = '1';
      k.innerHTML = `<div class="cx2c" data-k="boost"><b>Liq Boost III</b><p>0.5% of every trade into the BOBAI/BNB pool, its LP burned.</p><span class="ec-live" data-v>Running until Nov 20</span><small data-d></small></div>`
        + `<div class="cx2c" data-k="pot"><b>Giggle Academy pot</b><p>0.3% of every trade, given to the kids on Nov 20.</p><span class="ec-live" data-v>Collecting until Nov 20</span><small data-d></small></div>`;
      hero.insertAdjacentElement('afterend', k);
      const more = document.createElement('details'); more.className = 'cx2-more';
      more.innerHTML = '<summary>Details · every liquidity add, the pot’s payments, how deep the pool is</summary>';
      sec.insertAdjacentElement('afterend', more);
      more.append(boost, pot); if (lqd) more.append(lqd);
      setInterval(() => { const w = $('#w02'); if (w && !w.hidden) fill02(); }, 30e3);
    }
    fill02();
  }
  function fill02() {
    const t = (id) => (document.getElementById(id)?.textContent || '').trim(), ok = (s) => s && s !== '--' && s !== '…';
    const card = (k, v, d) => { const c = $(`#w02 .cx2c[data-k="${k}"]`); if (!c) return; if (v) $('[data-v]', c).textContent = v; if (d) $('[data-d]', c).textContent = d; };
    const days = (id) => ok(t(id)) ? `${t(id)} day${t(id) === '1' ? '' : 's'} left` : '';
    card('boost', ok(t('bb3-count')) && ok(t('bb3-bnb')) ? `${t('bb3-count')} adds · ${t('bb3-bnb')}` : '', days('bb3-days'));
    card('pot', ok(t('gg-bnb')) ? t('gg-bnb') : '', days('gg-days'));   // gg-bnb carries its BNB and its dollars already
  }
  new MutationObserver(() => { const w2 = $('#w02'); if (w2 && !w2.hidden) where02(); }).observe(document.getElementById('w02') || document.body, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => { const w3 = $('#w03'); if (w3 && !w3.hidden) proof03(); }).observe(document.getElementById('w03') || document.body, { attributes: true, attributeFilter: ['hidden'] });
  window.__card02 = { next: () => next02(), where: () => split7, load: () => where02() };

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
  // 03 ON ONE SCREEN (operator, 2026-10-19, his choice): under the chart the last three burns (when, how much, its
  // transaction) and one line of links to check it yourself; every address, every burn since launch and the past
  // campaigns move under one closed Details. The dead address's balance is the strip's first figure now.
  function proof03() {
    const body = $('#w03 .bw-body'); if (!body) return;
    const hero = $('.bw-hero', body);
    if (!hero) { if ((proof03.tries = (proof03.tries || 0) + 1) < 20) setTimeout(proof03, 300); return; }
    let box = $('#w03 .cx03');
    if (!box) { box = document.createElement('div'); box.className = 'cx02 cx03'; box.dataset.nousd = '1'; hero.insertAdjacentElement('afterend', box); }
    if (!body.dataset.shaped) {
      const sec = $('section.sec', body);
      if (sec) {
        body.dataset.shaped = '1';
        const more = document.createElement('details'); more.className = 'cx2-more';
        more.innerHTML = '<summary>Details · every address, every burn since launch, past campaigns</summary>';
        sec.insertAdjacentElement('beforebegin', more); more.append(sec);
      }
    }
    const c = NUMS().chain, b = NUMS().burns || burnsOwn, p = c?.priceUsd;
    const L = Array.isArray(b) ? b.filter((e) => +e.bobaiBurned > 0 && e.bobaiBurnTx).slice(-3).reverse() : [];
    const dead = 'https://bscscan.com/token/0x245c386dcfed896f5c346107596141e5edcbffff?a=0x000000000000000000000000000000000000dEaD';
    const when = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });   // UTC once, in the heading: a phone kept each date on two lines
    box.innerHTML = `<h4>The last burns <small class="cx03-u">UTC</small></h4>`
      + (L.length ? L.map((e) => `<div class="cx01-r cx02-r"><i style="background:#ff7a3d"></i><span>${when(Date.parse(e.time))}</span><b></b><em>${cmp(+e.bobaiBurned)} $BOBAI${p > 0 ? ` ≈$${(+e.bobaiBurned * p).toFixed(2)}` : ''} <a href="https://bscscan.com/tx/${e.bobaiBurnTx}" target="_blank" rel="noopener">tx ↗</a></em></div>`).join('') : '<p class="cx02-s">Reading the bot’s log…</p>')
      + `<p class="cx02-s cx03-k">Check it yourself: <a href="${dead}" target="_blank" rel="noopener">the dead address ↗</a> · <a href="https://bscscan.com/token/0x245c386dcfed896f5c346107596141e5edcbffff" target="_blank" rel="noopener">the contract ↗</a> · <a href="https://logs.brainonbnb.com/logs/burns.json" target="_blank" rel="noopener">the bot’s log ↗</a></p>`;
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
    '/board': ['https://agent.brainonbnb.com/board?limit=1', (j) => j?.total > 0 ? `${j.total} threads · ${j.open} open · anyone answers` : null],
    '/services': ['https://agent.brainonbnb.com/stats', (j) => j?.asked?.total ? `${cmp(j.asked.total)} calls by agents answered` : null],
  };
  function live04(el, cards) {
    const apps = $$('.cv-app', el);
    const ask = () => apps.forEach((a, k) => {
      const c = cards[k]; if (!c) return; const path = new URL(c.getAttribute('href') || '', location.origin).pathname, src = LIVE04[path];
      const desc = (c.querySelector('p')?.textContent || '').trim().replace(/\s+/g, ' ');
      // AN APP THAT HAS ENDED SAYS SO (2026-10-12, operator: the World Cup tip game is over — its card had a green "live"
      // dot): the window's own status tag decides; a finished one gets a grey dot and the sentence that says it ended
      if (c.querySelector('.ec-st') && !c.querySelector('.ec-st.live')) { const st = c.querySelector('.ec-st').textContent.trim(); a.dataset.live = 'done'; const plain = desc.replace(/\s*≈\$\d(?:[\d,.]*\d)?[KMB]?/g, ''); /* app.js puts ≈$ after every $BOBAI amount on the page */ a.dataset.fact = `${st.toLowerCase()} · ${(plain.split(/(?<=\.)\s+/).find((x) => /\b(ran|ended|archive)\b/i.test(x)) || plain).trim()}`; a.title = `${a.textContent.trim()} — ${st.toLowerCase()}, an archive`; return; }
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
    // the apps only: the three "for every agent" cards under them (2026-10-21) are services of BOBAI's, not apps
    const cards = $$('#w04 .ec').filter((c) => !c.closest('.ec-every')); if (!cards.length) return;
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

  // 05 BRAINMAP WITH ITS PROOF (operator, 2026-10-12: "99% of roadmap goals are empty promises and marketing"): every
  // tick in the window carries the thing that proves it — a contract read, a transaction, a heartbeat, a page — and every
  // open goal its live figure. What cannot be proven says so. The card's foot turns through the three open goals.
  const CA = '0x245c386dcfed896f5c346107596141e5edcbffff', PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6', POT = '0x5E4102520A71B2AA18a1208330d4848dea4BD105';
  const tx = (h, t) => h ? `<a href="https://bscscan.com/tx/${h}" target="_blank" rel="noopener">${t} ↗</a>` : '';
  const ext = (u, t) => `<a href="${u}" target="_blank" rel="noopener">${t} ↗</a>`;
  const dt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  let owner05 = null, stats05 = null, buys05 = null, bot05 = 0, goal05 = 0;
  const read05 = () => {
    fetch('https://bsc-dataseed.binance.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: CA, data: '0x8da5cb5b' }, 'latest'] }) })
      .then((r) => r.json()).then((j) => { if (typeof j?.result === 'string') owner05 = { v: '0x' + j.result.slice(-40), at: Date.now() }; }).catch(() => {});
    fetch('https://agent.brainonbnb.com/stats').then((r) => r.json()).then((j) => { stats05 = j; }).catch(() => {});
    // the paid answers from the ledger itself (every payment with its transaction), our own test purchases left out
    fetch('https://agent.brainonbnb.com/buys').then((r) => r.json()).then((j) => { const from = Date.now() - 7 * 86400e3; buys05 = (j.payments || []).filter((p) => !p.self_test && String(p.for).startsWith('answer') && Date.parse(p.at) >= from).length; }).catch(() => {});
    fetch('https://logs.brainonbnb.com/health', { cache: 'no-store' }).then((r) => r.json()).then((j) => { const t = Date.parse(j?.buyback); if (t) bot05 = t; }).catch(() => {});
  };
  const goals05 = () => {
    const N = NUMS(), out = {}, bnbP = N.chain?.bnbUsd;
    const v = typeof window.__btVol24 === 'function' && window.__btVol24();
    if (v && v.first && v.first <= Date.now() - 86400e3 + 60e3) out.vol = `$${v.usd >= 1000 ? cmp(v.usd) : v.usd.toFixed(0)} traded on the chain in the last 24 h`;
    const days = stats05?.asked?.by_day; if (days) { const from = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10); let n = 0, m = 0; for (const [d, k] of Object.entries(days)) if (d > from) for (const [kk, c] of Object.entries(k)) { if (/_checks$/.test(kk)) continue; n += c; }
      // HONEST COUNT (2026-10-19): our own watch checks (rug_watch_checks too) are no callers, and "of them MCP" counted every
      // registry's handshake as use; the paid answers (the ledger, buys05) are what agents actually bought
      out.agents = `${cmp(n)} requests to our agent server in 7 days` + (buys05 != null ? `, ${buys05} answer${buys05 === 1 ? '' : 's'} paid for by other agents` : ''); }
    // whole days, as the pot's own countdown counts them (2026-10-19: this said 32 d beside 02's "31 days left")
    if (N.gg?.bnb != null && N.gg?.end) { const d = Math.max(0, Math.floor((N.gg.end - Date.now()) / 86400e3)); out.pot = `Giggle pot ${N.gg.bnb.toFixed(3)} BNB${bnbP ? ` ≈$${cmp(Math.round(N.gg.bnb * bnbP))}` : ''} · ${d} d to the kids`; }
    return out;
  };
  function line05() {
    const l = $('[data-open="w06"] .bw-l'); if (!l) return; if (!l.dataset.base) l.dataset.base = l.textContent;
    const g = Object.values(goals05()); if (!g.length) return;
    l.textContent = g[goal05++ % g.length]; l.classList.add('goal-live');
  }
  function proof05() {
    const lis = $$('#w06 .rm li'); if (!lis.length) return;
    const N = NUMS(), B = N.burns || burnsOwn, L = N.liq, g = goals05();
    const lastRun = Array.isArray(B) ? [...B].reverse().find((e) => e.bobaiBurnTx) : null, firstBob = Array.isArray(B) ? B.find((e) => e.burnTx || e.bobBurnTx) : null;
    const lastLiq = Array.isArray(L) ? [...L].reverse().find((e) => e.lpBurnTx) : null;
    const RULES = [
      [/pitch decks/, () => `the proof we can give: every line of code is public — <a href="/library">The Library</a>; who wrote it cannot be read from a chain`],
      [/Four\.Meme/, () => `${ext(`https://four.meme/token/${CA}`, 'the launch on Four.Meme')} · ${ext(`https://bscscan.com/token/${PAIR}`, 'the PancakeSwap pool')}`],
      [/owner renounced/, () => `${owner05 ? `owner() = ${owner05.v === '0x' + '0'.repeat(40) ? '<b>0x000…000</b> (nobody)' : `<b class="bad">${owner05.v}</b>`}, read from the contract ${Math.max(1, Math.round((Date.now() - owner05.at) / 1000))} s ago` : 'reading owner() from the contract…'} · LP at the dead address: <b>${N.lpLocked || '…'}</b> ${ext(`https://bscscan.com/token/${PAIR}#balances`, 'holders')}`],
      [/\$BOB.*day one|from day one/, () => firstBob ? `the first $BOB burn, ${dt(Date.parse(firstBob.time))}: ${tx(firstBob.burnTx || firstBob.bobBurnTx, 'transaction')}` : ''],
      [/Every trade is a breath/, () => lastRun ? `the last split, ${dt(Date.parse(lastRun.time))}: ${tx(lastRun.bobaiBurnTx, '$BOBAI burn')} · ${tx(lastRun.bobBurnTx, '$BOB burn')} · ${tx(lastRun.lpAgentTx, 'DeFi')} · ${tx(lastRun.giggleTx, 'Giggle')}` : ''],
      [/every 10 minutes/, () => bot05 ? `its heartbeat: last check ${Math.max(1, Math.round((Date.now() - bot05) / 60e3))} min ago — ${ext('https://logs.brainonbnb.com/health', 'read it')}` : ''],
      [/into the fire/, () => lastLiq ? `the last LP burn, ${dt(Date.parse(lastLiq.time))}: ${tx(lastLiq.lpBurnTx, 'transaction')} · ${N.bb3?.count ?? '…'} adds since Sep 19` : ''],
      [/Giggle Academy/, () => N.gg?.bnb != null ? `the pot holds ${N.gg.bnb.toFixed(3)} BNB from ${N.gg.count} payments — ${ext(`https://bscscan.com/address/${POT}`, 'the pot on BscScan')}` : ''],
      [/Brain Terminal/, () => `live on this page, reading BNB Chain right now`],
      [/before you ape/, () => `<a href="/scanner">open the scanner</a>`],
      [/Brain Plaza/, () => `<a href="/registry">Brain Plaza</a> · <a href="/screener">the screener</a>`],
      [/DeFi agent/, () => `<a href="/defi">its position, gains and losses</a>`],
      [/rug watch/, () => `<a href="/services">how an agent sets one</a>`],
      [/^Volume/, () => g.vol ? `<b>${g.vol}</b>` : 'the 24-hour figure shows once the terminal has read a full day'],
      [/More agents/, () => g.agents ? `<b>${g.agents}</b>` : ''],
      [/Nov 20/, () => g.pot ? `<b>${g.pot}</b>` : ''],
      [/No price dates/, () => `a promise, not a proof: this map names no price and no date`],
    ];
    lis.forEach((li) => {
      const txt = li.textContent.replace(/^[✓○]\s*/, '').trim(), r = RULES.find(([re]) => re.test(txt)); if (!r) return;
      let pf = li.querySelector('.pf'); if (!pf) { pf = document.createElement('small'); pf.className = 'pf'; li.querySelector('span:last-child')?.appendChild(pf); }
      const h = r[1](); if (h) pf.innerHTML = h;
    });
  }
  // 05 ON ONE SCREEN (operator, 2026-10-19, his choice): the track on top; each phase that is done one line — a mark,
  // its name, one sentence, one proof; the phase now open with its goals and their live figures; every step of every
  // phase (with its proof, as before) under one closed Details. Phases are read from the page, so a new one appears.
  const SAY05 = { Build: 'Fair launch on Four.Meme, LP burned, owner renounced', Believe: 'Every trade feeds the bot, around the clock',
    Brain: 'Terminal, scanner, Brain Plaza, DeFi agent, rug watch', 'Big Brain': 'Volume, more agents, the Giggle pot to the kids' };
  function shape05() {
    const body = $('#w06 .bw-body'), rmg = body && $('.rmg', body), hero = body && $('.bw-hero', body); if (!rmg) return;
    if (!hero) { if ((shape05.tries = (shape05.tries || 0) + 1) < 20) setTimeout(shape05, 300); return; }
    if (!body.dataset.shaped) {
      body.dataset.shaped = '1';
      const box = document.createElement('div'); box.className = 'cx5'; box.dataset.nousd = '1';
      hero.insertAdjacentElement('afterend', box);
      const more = document.createElement('details'); more.className = 'cx2-more';
      more.innerHTML = '<summary>Every step of every phase, each with its proof</summary>';
      rmg.insertAdjacentElement('beforebegin', more); more.append(rmg);
    }
    fill05();
  }
  function fill05() {
    const box = $('#w06 .cx5'); if (!box) return;
    const N = NUMS(), g = goals05(), ph = $$('#w06 .rm');
    const mins = bot05 ? Math.max(1, Math.round((Date.now() - bot05) / 60e3)) : null;
    const owner = owner05 ? (owner05.v === '0x' + '0'.repeat(40) ? 'owner() = 0x000…000, nobody' : `owner() = ${owner05.v}`) : 'reading owner()…';
    const PROOF = { Build: ext(`https://bscscan.com/token/${CA}#readContract`, owner), Believe: mins ? ext('https://logs.brainonbnb.com/health', `heartbeat ${mins} min ago`) : 'reading the heartbeat…', Brain: 'live on this page' };
    const done = ph.filter((p) => !p.classList.contains('rmn')), now = ph.find((p) => p.classList.contains('rmn'));
    const name = (p) => $('h3', p)?.textContent.trim() || '';
    const paid = buys05 != null ? `${buys05} answer${buys05 === 1 ? '' : 's'} paid by other agents in 7 days` : '';
    const GOALS = [['Volume', g.vol || 'the 24-hour figure shows once the terminal has read a full day'], ['Agents use our tools', paid || 'reading the payments…'],
      ['The Giggle pot', g.pot || 'reading the pot…'], ['No price promise', 'this map names no price and no date']];
    box.innerHTML = done.map((p) => `<div class="cx5-r"><i>✓</i><b>${name(p)}</b><span>${SAY05[name(p)] || $('li span:last-child', p)?.firstChild?.textContent || ''}</span><em>${PROOF[name(p)] || ''}</em></div>`).join('')
      + (now ? `<div class="cx5-now"><div class="cx5-h">▶ NOW · ${name(now)}</div>${GOALS.map(([k, v], i) => `<div class="cx5-g"><b>${k}</b><span class="${i < 3 ? 'ec-live' : 'cx5-p'}">${v}</span></div>`).join('')}</div>` : '');
  }
  setTimeout(read05, 4000); setInterval(() => { if (!document.hidden) read05(); }, 5 * 60e3);
  setInterval(() => { if (!document.hidden) { line05(); const w = $('#w06'); if (w && !w.hidden) fill05(); } }, 6000);
  new MutationObserver(() => { const w = $('#w06'); if (w && !w.hidden) { read05(); shape05(); proof05(); setTimeout(() => { proof05(); fill05(); }, 1500); } }).observe(document.getElementById('w06') || document.body, { attributes: true, attributeFilter: ['hidden'] });
  window.__card05 = { goals: () => goals05(), proof: () => { proof05(); return $$('#w06 .rm li').map((li) => [li.textContent.trim().slice(0, 40), li.querySelector('.pf')?.textContent || '']); } };

  // 07 QUESTIONS: one question at a time, turning like a card
  // 07 MORE (operator, 2026-10-12: "the code lives" + "for agents: copy"): when the site was last rebuilt and the date
  // of the public source it carries (build.json, written by every deploy), and what a developer or an agent needs to
  // start — each with a copy button. The card's foot says how fresh the build is.
  let build07 = null;
  const age = (t) => { const m = Math.max(0, (Date.now() - t) / 60e3); return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const day07 = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  // the newer of the site's deploy and the agent worker's (2026-10-24, operator: "auf der page steht ja immer noch rebuilt
  // 1h ago" — the board, the agents and the APIs ship with the worker, not with the site)
  const readBuild = () => Promise.all([fetch('/build.json', { cache: 'no-store' }).then((r) => r.json()), fetch('https://agent.brainonbnb.com/build', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)]).then(([j, a]) => {
    const t = Math.max(Date.parse(j.site_deployed_at) || 0, Date.parse(a?.agent_deployed_at) || 0);
    build07 = { ...j, site_deployed_at: t ? new Date(t).toISOString() : j.site_deployed_at }; line07(); more07();
  }).catch(() => {});
  setTimeout(readBuild, 3000); setInterval(() => { if (!document.hidden) readBuild(); }, 10 * 60e3);
  function line07() {
    const l = $('[data-open="w08"] .bw-l'); if (!l || !build07?.site_deployed_at) return;
    l.textContent = `rebuilt ${age(Date.parse(build07.site_deployed_at))}${build07.source_mirror ? ` · source ${day07(Date.parse(build07.source_mirror.date))}` : ''}`; l.classList.add('code-live');
  }
  setInterval(() => { if (!document.hidden) line07(); }, 60e3);
  const copyRow = (label, val, note) => `<div class="cx07-r"><span><b>${label}</b><small>${note}</small></span><code>${val}</code><button type="button" class="cx07-c" data-copy="${val}">Copy</button></div>`;
  function more07() {
    const body = $('#w08 .bw-body'); if (!body) return;
    let box = $('#w08 .cx07');
    if (!box) {
      box = document.createElement('div'); box.className = 'cx02 cx07'; box.dataset.nousd = '1'; body.insertAdjacentElement('afterbegin', box);
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (!b) return; const v = b.dataset.copy;
        const done = () => { b.textContent = 'Copied ✓'; b.classList.add('ok'); setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('ok'); }, 1600); };
        (navigator.clipboard?.writeText(v) || Promise.reject()).then(done, () => { const t = document.createElement('textarea'); t.value = v; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch {} t.remove(); }); });
    }
    const b = build07, src = b?.source_mirror;
    box.innerHTML = `<h4>The code lives</h4>`
      + `<p class="cx02-s">${b?.site_deployed_at ? `This site was rebuilt <b style="color:#f3efe6">${age(Date.parse(b.site_deployed_at))}</b>. ` : ''}${src ? `Its public source, mirrored ${day07(Date.parse(src.date))} (commit <code>${src.commit}</code>), clones from here — every line of what runs on this page:` : 'Its public source clones from here:'}</p>`
      + copyRow('Clone the source', 'git clone https://brainonbnb.com/source.git', 'the whole repository, our own mirror')
      + `<h4 style="margin-top:16px">For agents</h4><p class="cx02-s">What an agent or its developer needs to start, free and read-only:</p>`
      + copyRow('MCP endpoint', 'https://brainonbnb.com/mcp', 'tools over MCP, no key')
      + copyRow('Skill doc', 'https://brainonbnb.com/skill.md', 'what each tool does, how to call it')
      + copyRow('Agent card', 'https://brainonbnb.com/.well-known/agent-card.json', 'A2A, ERC-8004 #49467')
      + copyRow('llms.txt', 'https://brainonbnb.com/llms.txt', 'the site, for a model to read');
  }
  { const w = document.getElementById('w08'); if (w) new MutationObserver(() => { if (!w.hidden) more07(); }).observe(w, { attributes: true, attributeFilter: ['hidden'] }); }
  window.__card07 = { build: () => build07 };

  let qi = 0, q07 = -1;
  // 06's QUESTION OPENS ITS ANSWER (operator, 2026-10-12): a tap on the card opens the window at the question the card
  // shows right then, unfolded; and the window has a search over every question and answer (all words must be there)
  const faqs = () => $$('#w07 details.faq-item');
  function openQ(k) {
    const d = faqs()[k]; if (!d) return;
    const fold = d.closest('details.cx7-more'); if (fold) fold.open = true;   // a question from the tile may sit in the fold (2026-10-19)
    faqs().forEach((x) => { if (x !== d) x.open = false; }); d.open = true; d.classList.add('faq-hit');
    setTimeout(() => d.classList.remove('faq-hit'), 2600); setTimeout(() => d.scrollIntoView({ block: 'start', behavior: 'smooth' }), 400);
  }
  // every contract address in an answer gets a copy button (2026-10-13): the answer to "what is the official address"
  // is the one people copy, and a typo there costs money
  function copyCa07() {
    $$('#w07 .faq-body code').forEach((c) => {
      const v = c.textContent.trim(); if (!/^0x[0-9a-fA-F]{40}$/.test(v) || c.nextElementSibling?.classList.contains('faq-copy')) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'faq-copy'; b.textContent = 'Copy';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => { b.textContent = 'Copied ✓'; b.classList.add('ok'); setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('ok'); }, 1600); }, () => {}); });
      c.insertAdjacentElement('afterend', b);
    });
  }
  function search07() {
    copyCa07();
    const list = $('#w07 .faq-list'); if (!list || $('#w07 .faq-search')) return;
    const box = document.createElement('div'); box.className = 'faq-search';
    // the one search of the window (2026-10-19: hero.js had a second one above it): it reaches every answer, and the
    // fold of the other questions (shape07) opens when a match is in it and steps aside when none is
    box.innerHTML = `<input type="search" placeholder="Search all ${faqs().length} answers: tax, contract, buy, agents…" aria-label="Search the answers"><span class="faq-n" aria-live="polite"></span>`;
    list.insertAdjacentElement('beforebegin', box);
    const inp = box.querySelector('input'), n = box.querySelector('.faq-n');
    inp.addEventListener('input', () => {
      const words = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean); let c = 0;
      faqs().forEach((d) => { const t = d.textContent.toLowerCase(), hit = words.every((w) => t.includes(w)); d.hidden = !hit; d.open = words.length > 0 && hit; if (hit) c++; });
      const fold = $('#w07 details.cx7-more');
      if (fold) { fold.hidden = words.length > 0 && !faqs().some((d) => fold.contains(d) && !d.hidden); if (words.length && !fold.hidden) fold.open = true; }
      n.textContent = words.length ? (c ? `${c} answer${c === 1 ? '' : 's'}` : 'No answer has these words. Ask BOBAI in the terminal.') : '';
    });
  }
  let want07 = -1;
  document.addEventListener('click', (e) => { if (e.target.closest('button[data-open="w07"]')) want07 = q07; }, true);
  { const w = document.getElementById('w07'); if (w) new MutationObserver(() => { if (w.hidden) return; search07(); if (want07 >= 0) { const k = want07; want07 = -1; openQ(k); } }).observe(w, { attributes: true, attributeFilter: ['hidden'] }); }
  window.__card06 = { q: () => q07, open: (k) => openQ(k) };
  function draw07() {
    const el = viz('07'); if (!el) return;
    const qs = $$('#w07 summary').map((s) => s.textContent.replace(/[^\p{L}\p{N}?!.,'’$&()% -]+$/u, '').trim()).filter(Boolean); if (!qs.length) return;
    const v = $('[data-open="w07"] .bw-v'); if (v) v.textContent = qs.length + ' answers';
    el.innerHTML = `<div class="cv-q">“${qs[(q07 = qi++ % qs.length)]}”</div>`;
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
  // 01 ON ONE SCREEN (operator, 2026-10-19, his choice "buy and trust"): under the figures one sentence of what $BOBAI
  // is, its address to copy and the way to buy it; then the contract's two answers read just now and the trade
  // calculator (both moved up, not rebuilt); one line of links; how it works, the split, the tax plan and every listing
  // under one closed Details. The split itself is 02's window. hero.js prepends its strip, so it stays on top.
  function shape01() {
    const body = $('#w01 .bw-body'), calc = $('#w01 .cx01'), proof = $('#w01 .cx01v'), about = $('#w01 #about'), soc = $('#w01 #socials');
    if (!body || !calc || !proof || !about || body.dataset.shaped) return;
    body.dataset.shaped = '1';
    const k = document.createElement('div'); k.className = 'cx1'; k.dataset.nousd = '1';
    k.innerHTML = `<p class="cx1-s">A meme token on BNB Chain whose 3% trade tax buys back and burns, adds liquidity and funds a DeFi agent — every step a transaction.</p>`
      + `<div class="cx1-row"><code title="the $BOBAI contract on BNB Chain">${CA}</code><button type="button" class="cx1-copy">Copy</button>`
      + `<a class="cx1-buy" href="https://pancakeswap.finance/swap?outputCurrency=${CA}" target="_blank" rel="noopener">Buy on PancakeSwap →</a></div>`;
    body.prepend(k);
    k.after(proof); proof.after(calc);
    const links = document.createElement('p'); links.className = 'cx1-l';
    links.innerHTML = [['https://t.me/bobai_official', 'Telegram'], ['https://x.com/BrainOnBNB', 'X'], [`https://dexscreener.com/bsc/${CA}`, 'DexScreener'],
      ['https://www.coingecko.com/en/coins/brain-on-bnb-ai', 'CoinGecko'], [`https://bscscan.com/token/${CA}`, 'BscScan']].map(([u, t]) => `<a href="${u}" target="_blank" rel="noopener">${t} ↗</a>`).join(' · ');
    calc.after(links);
    const more = document.createElement('details'); more.className = 'cx2-more';
    more.innerHTML = '<summary>Details · how it works, the tax plan, everywhere it is listed</summary>';
    links.after(more); more.append(about); if (soc) more.append(soc);
    $('.cx1-copy', k).addEventListener('click', (e) => { const b = e.currentTarget; (navigator.clipboard ? navigator.clipboard.writeText(CA) : Promise.reject()).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1600); }).catch(() => {}); });
  }
  // 06 ON ONE SCREEN (operator, 2026-10-19, his choice): the search on top (hero.js, it reaches every answer), then the
  // five questions a buyer asks first — the address, where to buy, is it safe, the tax, can my agent use the tools — and
  // the others under one closed fold. Moved, not copied: one answer each on the page.
  const TOP07 = [/official \$BOBAI contract address/, /Where can I buy/, /Is \$BOBAI safe/, /trading tax/, /own AI agent/];
  function shape07() {
    const body = $('#w07 .bw-body'), list = body && $('.faq-list', body); if (!list || body.dataset.shaped) return;
    const items = $$('details.faq-item', list); if (items.length < 8) return;
    body.dataset.shaped = '1';
    const top = document.createElement('div'); top.className = 'faq-list cx7';
    for (const re of TOP07) { const d = items.find((x) => re.test(x.querySelector('summary').textContent)); if (d) top.append(d); }
    const sec = list.closest('section') || list;
    sec.insertAdjacentElement('beforebegin', top);
    const more = document.createElement('details'); more.className = 'cx2-more cx7-more';
    more.innerHTML = `<summary>${$$('details.faq-item', list).length} more questions</summary>`;
    top.insertAdjacentElement('afterend', more); more.append(sec);
  }
  function all() { draw01(); draw02(); draw03(); draw04(); draw06(); figs(); calc01(); shape01(); shape07(); const w2 = $('#w02'); if (w2 && !w2.hidden) where02(); const w3 = $('#w03'); if (w3 && !w3.hidden) proof03(); }
  addEventListener('bobai:nums', all);
  addEventListener('resize', () => { draw03(); });
  // the TG bot's 111 KB candle ledger was fetched every 2 min for nothing, and an NFT card drawer was never called: both
  // gone (2026-10-05). The periodic ticks skip while the tab is hidden; the next 'bobai:nums' on return redraws.
  setTimeout(all, 1500); setInterval(() => { if (!document.hidden) all(); }, 30000);
  // (05 is the chart now; the agent server's count lives in the terminal's BOTS view)
  draw07(); setInterval(() => { if (!document.hidden) draw07(); }, 6000);
})();
