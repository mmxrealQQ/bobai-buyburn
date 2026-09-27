// The share card as an SVG string — the server twin of makeCard() in the Brain Terminal (terminal.js).
//
// motifOf() is a line-by-line port of the terminal's: the same five moments, the same labels, the same
// formulas, the same rounding, so the picture a crawler fetches says exactly what the page says. What the
// server cannot have is the live 3D frame behind the numbers; the backdrop is the terminal's still look
// instead (dark glass, dot grid, gold halo). Where the port differs, it differs on purpose:
//  - a figure whose source failed is null, and null DROPS the element (tile, sub-clause, headline) — the
//    browser waits for its data before it lets anyone share; a server answering a crawler cannot wait;
//  - the page's window.__bobaiNums overrides are the same formulas over the same logs (checked against
//    dashboard/app.js ggdata/bb3data and the LP read), so the fallbacks here ARE those numbers.
//
// No canvas in a Worker, so text is measured from advance widths extracted at build time (metrics.json,
// tools/make-assets.py); fit() shrinks a line to its box the same way the browser's does.

import METRICS from './metrics.json' with { type: 'json' };

export const MOTIFS = ['now', 'burn', 'liq', 'day', 'week'];
export const SIZES = { wide: [1600, 900], tall: [1080, 1350] };

// the terminal's destination colours (DEST in terminal.js)
const C = { burnA: '#ff8a1f', burnB: '#ffc247', liq: '#2ee6c8', defi: '#60a5fa', giggle: '#f472b6', gold: '#F0B90B' };
const BURN_TIERS = [[250, 'burn-supernova'], [150, 'burn-apocalypse'], [50, 'burn-mega'], [15, 'burn-big'], [5, 'burn-nice'], [0, 'burn-small']];
const GIGGLE_DAY = Date.parse('2026-11-20T00:01:00Z');
const BB3 = { start: Date.parse('2026-09-19T18:00:00Z'), end: GIGGLE_DAY };

// ---------- the terminal's formatters, verbatim ----------
const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const cmp = n => Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const bnb4 = n => (+n || 0).toFixed(4) + ' BNB';
const bnbF = n => `${nf(n, Number(n) < 0.1 ? 4 : 3)} BNB`;
const pcEdge = v => v == null ? '—' : v > 0 && v < 0.001 ? '<0.001%' : (v >= 99.9995 && v < 100) ? '>99.999%' : v.toFixed(3) + '%';
const supplyPct = v => (v / 1e9 * 100).toFixed(1);
const bobOf = e => +(e.bob || e.bobBurned) || 0;
const has = v => v != null && Number.isFinite(v);

function boost3(liq) {
  const list = liq.filter(l => { const t = Date.parse(l.time); return t >= BB3.start && t < BB3.end; });
  return { n: list.length, bnb: list.reduce((a, l) => a + (parseFloat(l.bnb) || 0), 0), lp: list.reduce((a, l) => a + (parseFloat(l.lpBurned) || 0), 0) };
}
const ggBnb = burns => burns.filter(e => e.giggleTx).reduce((a, e) => a + (parseFloat(e.giggleBnb) || 0), 0);

// ---------- the five moments (terminal.js motifOf) ----------
export function motifOf(k, S, now = Date.now()) {
  const sumB = (a, f) => a.reduce((s, x) => s + (parseFloat(f(x)) || 0), 0);
  const utc = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase() + ' · ' + new Date(t).toISOString().slice(11, 16) + ' UTC';
  const lpText = has(S.lpPct) ? pcEdge(S.lpPct) : null;
  const usd = (v, d = 0) => (has(S.price) ? `≈ $${nf(v * S.price, d)} today` : null);
  const join = (...p) => p.filter(Boolean).join('  ·  ');
  if (k === 'burn') {
    const e = S.burns.at(-1); if (!e) return null;
    const t = Date.parse(e.time), l = S.liq.find(x => Math.abs(Date.parse(x.time) - t) < 20 * 60e3);
    const tier = has(S.bnbP) ? BURN_TIERS.find(x => (+e.bobaiBurnBnb || 0) * S.bnbP >= x[0]) : null;
    return {
      pose: tier ? tier[1] : 'burn', col: C.burnA, stamp: 'BURN OF ' + utc(t), tx: e.bobaiBurnTx, t,
      label: 'BOBAI JUST BURNED', value: nf(e.bobaiBurned), sub: join(`BOBAI · from ${bnbF(e.totalBnb)} of tax`, usd(+e.bobaiBurned, 2)),
      cards: [['$BOB BURNED', cmp(bobOf(e)) + ' BOB', 'the same run', C.burnB],
        ['LIQUIDITY ADDED', l ? bnb4(l.bnb) : '—', l ? nf(l.lpBurned, 2) + ' LP burned' : 'no add in this run', C.liq],
        ['TO THE DEFI AGENT', bnb4(e.lpAgentBnb), 'it works the capital', C.defi],
        ['TO THE GIGGLE POT', bnb4(e.giggleBnb), 'donated on Nov 20', C.giggle]],
      text: `$BOBAI just burned ${nf(e.bobaiBurned)} BOBAI and ${cmp(bobOf(e))} $BOB from its 3% tax. Check it on-chain: bscscan.com/tx/${e.bobaiBurnTx}`,
    };
  }
  if (k === 'liq') {
    const l = S.liq.at(-1); if (!l) return null;
    const b = boost3(S.liq), t = Date.parse(l.time);
    return {
      pose: 'liq', col: C.liq, stamp: 'LIQUIDITY ADD OF ' + utc(t), tx: l.addLiqTx, t,
      label: 'BOBAI JUST ADDED LIQUIDITY', value: bnb4(l.bnb), sub: `+ ${cmp(l.bobaiBought)} BOBAI paired  ·  the LP is burned`,
      cards: [['LP BURNED', nf(l.lpBurned, 2) + ' LP', 'sent to the dead address', C.liq],
        ['POOL LOCKED', lpText, 'of all LP, forever', C.liq],
        ['LIQ BOOST III', b.n + ' adds', 'since Sep 19', C.gold],
        ['BOOST III TOTAL', bnb4(b.bnb), nf(b.lp, 2) + ' LP burned', C.gold]],
      text: `$BOBAI just added ${bnb4(l.bnb)} of liquidity and burned the LP` + (lpText ? `: ${lpText} of the pool is locked forever.` : '.') + ` On-chain: bscscan.com/tx/${l.addLiqTx}`,
    };
  }
  if (k === 'day' || k === 'week') {
    if (!S.logsOk) return null; // a window with the log missing would read "0 burned"
    const span = k === 'day' ? 86400e3 : 7 * 86400e3, since = now - span;
    const runs = S.burns.filter(e => Date.parse(e.time) >= since), adds = S.liq.filter(x => Date.parse(x.time) >= since);
    const burned = sumB(runs, e => e.bobaiBurned), bob = sumB(runs, bobOf);
    const range = k === 'day' ? 'LAST 24 HOURS · TO ' + utc(now)
      : 'LAST 7 DAYS · ' + new Date(since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase() + ' – ' + new Date(now).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
    const word = k === 'day' ? 'the last 24 hours' : 'the last 7 days';
    return {
      pose: k === 'day' ? 'idle' : 'giggle', col: C.gold, stamp: range, tx: null, t: now,
      label: k === 'day' ? 'BOBAI BURNED IN 24 HOURS' : 'BOBAI BURNED IN 7 DAYS', value: nf(burned),
      sub: join(`BOBAI in ${runs.length} burn run${runs.length === 1 ? '' : 's'}`, usd(burned)),
      cards: [['$BOB BURNED', cmp(bob) + ' BOB', 'Build On BNB, gone', C.burnB],
        ['LIQUIDITY ADDED', S.liqOk ? bnb4(sumB(adds, x => x.bnb)) : null, adds.length + ' add' + (adds.length === 1 ? '' : 's') + ' · LP burned', C.liq],
        ['TO THE DEFI AGENT', bnb4(sumB(runs, e => e.lpAgentBnb)), 'it works the capital', C.defi],
        ['TO THE GIGGLE POT', bnb4(sumB(runs, e => e.giggleTx ? e.giggleBnb : 0)), 'donated on Nov 20', C.giggle]],
      text: `$BOBAI, ${word}: ${nf(burned)} BOBAI and ${cmp(bob)} $BOB burned in ${runs.length} runs` + (S.liqOk ? `, ${bnb4(sumB(adds, x => x.bnb))} added to liquidity with the LP burned` : '') + '. All on-chain.',
    };
  }
  // 'now' — the page's headline block
  const wk = S.burns.filter(e => Date.parse(e.time) >= now - 7 * 86400e3);
  const qUsd = has(S.queued) && has(S.walletBnb) && has(S.price) && has(S.bnbP) ? S.queued * S.price + S.walletBnb * S.bnbP : null;
  const dead = has(S.deadA) ? S.deadA : null;
  return {
    pose: 'idle', col: C.burnA, stamp: utc(now) + '  ·  LIVE FROM BNB CHAIN', tx: null, t: now,
    label: dead ? 'BOBAI BURNED FOREVER' : null, value: dead ? nf(dead) : null,
    sub: dead ? join(`${supplyPct(dead)}% of the supply`, has(S.price) ? `≈ $${nf(dead * S.price)} today` : null) : null,
    cards: [['BURNED THIS WEEK', S.logsOk ? cmp(sumB(wk, e => e.bobaiBurned)) + ' BOBAI' : null, '+ ' + cmp(sumB(wk, bobOf)) + ' $BOB burned', C.burnA],
      ['NEXT BUYBACK', qUsd != null ? '$' + nf(qUsd, 2) : null, 'tax charging the next burn', C.gold],
      ['LIQUIDITY LOCKED', lpText, 'of the pool LP burned', C.liq],
      ['GIGGLE ACADEMY POT', S.logsOk ? bnb4(ggBnb(S.burns)) : null, 'donated on Nov 20', C.giggle]],
    text: dead ? `$BOBAI's brain right now: ${nf(dead)} BOBAI burned (${supplyPct(dead)}% of supply)` + (qUsd != null ? `, $${nf(qUsd, 2)} charging for the next buyback` : '') + '. Watch it live.'
      : '$BOBAI — every trade pays 3% into burns, liquidity and a donation pot. Watch it live on BNB Chain.',
  };
}

// ---------- the terminal's candle series (terminal.js candles()): each opens where the one before closed ----------
function candleSeries(src, pxBnb) {
  if (!src?.rows?.length) return [];
  const out = []; let prev = null;
  for (const r of src.rows) {
    const o = prev ? prev.c : r.c;
    out.push({ t: r.t, o, c: r.c, h: Math.max(o, r.c, r.h || 0), l: Math.min(o, r.c, r.l || Infinity), n: (r.b || 0) + (r.s || 0) });
    prev = r;
  }
  const last = src.rows[src.rows.length - 1];
  if (last && pxBnb > 0) out.push({ t: last.t + src.minutes * 60e3, o: last.c, c: pxBnb, h: Math.max(last.c, pxBnb), l: Math.min(last.c, pxBnb), n: 0 });
  return out;
}

// ---------- text ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FACE = { sg: 'Space Grotesk', ui: 'Inter' };
// the terminal's labels are monospace; the site ships no mono face, so they are Inter with tracking
const TRACK = 0.06;
function width(text, face, weight, size, track = 0) {
  const m = METRICS[`${face === 'sg' ? 'spacegrotesk' : 'inter'}-${face === 'sg' ? (weight >= 650 ? 700 : 600) : (weight >= 600 ? 700 : 500)}`];
  let w = 0; for (const ch of String(text)) w += m[ch] ?? 0.6;
  return w * size + track * size * [...String(text)].length;
}
function fit(text, face, weight, size, min, maxW, track = 0) {
  let f = size; while (f > min && width(text, face, weight, f, track) > maxW) f -= 2;
  return f;
}
function txt(x, y, text, { face = 'ui', weight = 500, size, fill, track = 0, anchor, opacity, filter, max, min } = {}) {
  const s = max ? fit(text, face, weight, size, min ?? Math.round(size * 0.6), max, track) : size;
  return `<text x="${x}" y="${y}" font-family="${FACE[face]}" font-weight="${weight >= 650 ? 700 : weight >= 550 && face === 'sg' ? 600 : weight >= 600 ? 700 : 500}" font-size="${s}"`
    + (track ? ` letter-spacing="${(track * s).toFixed(2)}"` : '') + (anchor ? ` text-anchor="${anchor}"` : '')
    + (opacity != null ? ` opacity="${opacity}"` : '') + (filter ? ` filter="url(#${filter})"` : '')
    + ` fill="${fill}">${esc(text)}</text>`;
}
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

// img: { logo: dataURI, pose: name => dataURI|null }
export function cardSvg(m, fmt, S, img, now = Date.now()) {
  const tall = fmt === 'tall', [W, H] = SIZES[tall ? 'tall' : 'wide'];
  const LX = 64, out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<defs>
<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><rect x="11" y="11" width="1.6" height="1.6" fill="rgba(255,236,200,.06)"/></pattern>
<radialGradient id="halo" gradientUnits="userSpaceOnUse" cx="${W * 0.3}" cy="0" r="${W * 0.7}"><stop offset="0" stop-color="${C.gold}" stop-opacity=".13"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient>
<radialGradient id="halo2" gradientUnits="userSpaceOnUse" cx="${W * 0.3}" cy="0" r="${W * 0.5}"><stop offset="0" stop-color="${m.col}" stop-opacity=".08"/><stop offset="1" stop-color="${m.col}" stop-opacity="0"/></radialGradient>
<linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".085"/><stop offset="1" stop-color="#fff" stop-opacity=".03"/></linearGradient>
<linearGradient id="topline" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.gold}" stop-opacity="0"/><stop offset=".5" stop-color="${C.gold}" stop-opacity=".95"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>
<radialGradient id="floor"><stop offset="0" stop-color="#000" stop-opacity=".7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<filter id="b18" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="18"/></filter>
<filter id="b6" x="-50%" y="-600%" width="200%" height="1300%"><feGaussianBlur stdDeviation="6"/></filter>
<clipPath id="logoc"><circle cx="${LX + 28}" cy="${tall ? 92 : 84}" r="28"/></clipPath>
</defs>`);
  // backdrop: near-black, the terminal's dot grid, a gold halo from the top with the moment's colour in it
  out.push(`<rect width="${W}" height="${H}" fill="#0c0b0c"/><rect width="${W}" height="${H}" fill="url(#dots)"/><rect width="${W}" height="${H}" fill="url(#halo)"/><rect width="${W}" height="${H}" fill="url(#halo2)"/>`);

  // BOBAI, large, in the pose of the moment, standing in its colour
  const pose = img.pose(m.pose) || img.pose('idle');
  const FH = tall ? 780 : 830, FX = tall ? W / 2 : 1190, FY = tall ? 118 : H - FH + 18, FW = FH * 2 / 3, feet = FY + FH - 18;
  const gy = FY + FH * 0.45, gr = tall ? 440 : 520;
  out.push(`<radialGradient id="fglow" gradientUnits="userSpaceOnUse" cx="${FX}" cy="${gy}" r="${gr}"><stop offset="0" stop-color="${m.col}" stop-opacity=".30"/><stop offset=".45" stop-color="${m.col}" stop-opacity=".08"/><stop offset="1" stop-color="${m.col}" stop-opacity="0"/></radialGradient>`);
  out.push(`<rect x="${FX - 560}" y="${FY - 100}" width="1120" height="${FH + 200}" fill="url(#fglow)"/>`);
  // the shadow under his feet: a flattened circle, so no edge of a box ever shows
  out.push(`<ellipse cx="${FX}" cy="${feet}" rx="240" ry="38" fill="url(#floor)"/>`);
  if (pose) out.push(`<image x="${FX - FW / 2}" y="${FY}" width="${FW}" height="${FH}" href="${pose}" xlink:href="${pose}" preserveAspectRatio="xMidYMid meet"/>`);
  // on the tall card the numbers sit under him: a dark fade so his feet never run into the headline
  if (tall) out.push(`<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0b0c" stop-opacity="0"/><stop offset="1" stop-color="#0c0b0c" stop-opacity=".92"/></linearGradient><rect x="0" y="800" width="${W}" height="75" fill="url(#fade)"/><rect x="0" y="875" width="${W}" height="${H - 875}" fill="#0c0b0c" opacity=".92"/><rect width="${W}" y="875" height="${H - 875}" fill="url(#dots)"/>`);

  // header: logo, name, the moment
  const HY = tall ? 92 : 84;
  if (img.logo) out.push(`<image x="${LX}" y="${HY - 28}" width="56" height="56" href="${img.logo}" xlink:href="${img.logo}" clip-path="url(#logoc)"/><circle cx="${LX + 28}" cy="${HY}" r="28" fill="none" stroke="rgba(240,185,11,.35)" stroke-width="1.5"/>`);
  const tx0 = img.logo ? LX + 74 : LX, tw = width('$BOBAI', 'sg', 700, 34);
  out.push(txt(tx0, HY, '$BOBAI', { face: 'sg', weight: 700, size: 34, fill: C.gold }));
  out.push(txt(tx0 + tw + 10, HY, 'BRAIN TERMINAL', { face: 'sg', weight: 700, size: 34, fill: '#eceaf5' }));
  out.push(txt(tx0, HY + 26, m.stamp, { weight: 700, size: 15, fill: '#8f90ad', track: TRACK, max: (tall ? W - LX : 820) - tx0, min: 11 }));

  // the one big number (dropped whole when its source failed — never a zero in its place)
  const NY = tall ? 900 : 200, colW = tall ? W - LX * 2 : 700;
  if (m.label && m.value) {
    out.push(txt(LX, NY, m.label, { weight: 700, size: 17, fill: m.col, track: TRACK * 1.4, max: colW, min: 12 }));
    const vs = fit(m.value, 'sg', 700, 104, 56, colW);
    out.push(txt(LX - 4, NY + 96, m.value, { face: 'sg', weight: 700, size: vs, fill: m.col, opacity: 0.45, filter: 'b18' }));
    out.push(txt(LX - 4, NY + 96, m.value, { face: 'sg', weight: 700, size: vs, fill: '#ffffff' }));
    if (m.sub) out.push(txt(LX, NY + 136, m.sub, { size: 20, fill: '#a0a2c0', max: colW, min: 13 }));
  }

  // glass cards: 2 x 2 beside BOBAI, or one row of four under him; a card whose figure is missing is left out
  const cards = m.cards.filter(c => c[1] != null);
  const cols = tall ? 4 : 2, GX = tall ? 14 : 20, GY = 22, CW = tall ? (W - LX * 2 - GX * 3) / 4 : 302, CH = tall ? 150 : 138, CY = tall ? 1072 : 384;
  cards.forEach(([lab, val, sub, col], i) => {
    const x = LX + (i % cols) * (CW + GX), y = CY + Math.floor(i / cols) * (CH + GY), pad = tall ? 16 : 22, iw = CW - pad * 2;
    out.push(`<clipPath id="cc${i}"><rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="18"/></clipPath>`);
    out.push(`<rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="18" fill="rgba(12,11,12,.55)"/><rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="18" fill="url(#glass)" stroke="rgba(255,255,255,.13)" stroke-width="1.5"/>`);
    out.push(`<rect x="${x}" y="${y}" width="${CW}" height="4" fill="${col}" clip-path="url(#cc${i})"/>`);
    out.push(txt(x + pad, y + 38, lab, { weight: 700, size: 14, fill: col, track: TRACK, max: iw, min: 10 }));
    out.push(txt(x + pad, y + 88, val, { face: 'sg', weight: 600, size: tall ? 34 : 40, fill: '#ffffff', max: iw, min: 20 }));
    out.push(txt(x + pad, y + (tall ? 122 : 118), sub, { size: tall ? 13 : 15, fill: '#9496b4', max: iw, min: 10 }));
  });

  // the day's candles under the figures, with this moment marked on them (wide only)
  const cs = tall ? [] : candleSeries(S.candles, S.pxBnb).slice(-144);
  if (cs.length > 6) {
    const X0 = LX, X1 = LX + 624, Y0 = 718, Y1 = 790, mt = m.t || now;
    let lo = Infinity, hi = 0; for (const q of cs) { lo = Math.min(lo, q.l); hi = Math.max(hi, q.h); }
    const sp = Math.max(hi - lo, lo * 0.004), Yc = p => Y1 - (p - lo) / sp * (Y1 - Y0), st = (X1 - X0) / cs.length, bw = Math.max(1.4, st * 0.6);
    out.push(txt(X0, Y0 - 12, '$BOBAI · 24H · 10-MIN CANDLES FROM THE POOL', { weight: 700, size: 11, fill: '#8f90ad', track: TRACK }));
    const g = [];
    cs.forEach((q, i) => {
      const x = X0 + i * st + st / 2, flat = Math.abs(q.c - q.o) < q.o * 2e-5 && !q.n, col = flat ? 'rgba(160,162,192,.5)' : q.c >= q.o ? '#35e07a' : '#ff4d6d';
      const xr = Math.round(x) + 0.5, y0 = Yc(Math.max(q.o, q.c));
      g.push(`<line x1="${xr}" y1="${Yc(q.h).toFixed(1)}" x2="${xr}" y2="${Yc(q.l).toFixed(1)}" stroke="${col}" stroke-width="1"/>`);
      g.push(`<rect x="${(x - bw / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.2, Yc(Math.min(q.o, q.c)) - y0).toFixed(1)}" fill="${col}"/>`);
    });
    out.push(g.join(''));
    // the moment: the first candle at or after it; a moment before the strip's start is not marked at all
    const mi = cs.findIndex(q => q.t >= mt);
    if (mt >= cs[0].t - 600e3) {
      const mx = X0 + (mi < 0 ? cs.length - 1 : mi) * st + st / 2;
      out.push(`<line x1="${mx + 0.5}" y1="${Y0 - 4}" x2="${mx + 0.5}" y2="${Y1 + 4}" stroke="${m.col}" stroke-width="1" stroke-dasharray="3 4"/>`);
      out.push(`<circle cx="${mx}" cy="${Y0 - 4}" r="9" fill="${m.col}" opacity=".6" filter="url(#b6)"/><circle cx="${mx}" cy="${Y0 - 4}" r="5" fill="${m.col}"/>`);
    }
  }

  // footer: where to see it, and where to check this very moment
  const fw = width('brainonbnb.com', 'sg', 700, 26);
  out.push(txt(LX, H - 58, 'brainonbnb.com', { face: 'sg', weight: 700, size: 26, fill: C.gold }));
  out.push(txt(LX + fw + 14, H - 58, '$BOBAI · Brain On BNB AI', { face: 'sg', weight: 600, size: 18, fill: '#8f90ad' }));
  out.push(txt(LX, H - 30, m.tx ? `tx ${m.tx.slice(0, 10)}…${m.tx.slice(-8)} · check it on bscscan.com` : '3% of every trade · every burn is a transaction you can check',
    { size: 15, fill: '#8f90ad', max: tall ? W - LX * 2 : 800, min: 11 }));

  // the glass frame, with its glow and its line of light
  // the glow is stacked strokes, not a blur: a Gaussian over a full-card frame cost resvg ~1.8 s of CPU per
  // image (measured in Node, 2026-09-27), the strokes cost nothing and read the same at share-preview size
  for (const [sw, a] of [[22, 0.025], [14, 0.04], [8, 0.06], [4, 0.09]])
    out.push(`<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="14" fill="none" stroke="rgba(240,185,11,${a})" stroke-width="${sw}"/>`);
  out.push(`<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="14" fill="none" stroke="rgba(240,185,11,.28)" stroke-width="2"/>`);
  out.push(`<rect x="${W * 0.12}" y="12" width="${W * 0.76}" height="4" fill="url(#topline)" filter="url(#b6)"/><rect x="${W * 0.12}" y="13" width="${W * 0.76}" height="2.5" fill="url(#topline)"/>`);
  out.push('</svg>');
  return out.join('\n');
}

// title / description for the share page's meta tags
export function metaOf(m) {
  const title = m.label && m.value ? `$BOBAI · ${m.value} ${m.label.replace(/^BOBAI /, '').toLowerCase()}` : '$BOBAI · Brain Terminal';
  return { title, description: m.text };
}
