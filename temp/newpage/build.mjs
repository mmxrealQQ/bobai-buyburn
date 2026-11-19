// The new page (2026-09-26, the operator's vision): the Brain Terminal as the big window in the middle, the homepage's
// blocks as windows around it, everything in the terminal's look, Classic <-> Brain switch top right. Built in the dev
// lab only (bobai-lab.pages.dev/brain/) until it is finished; then it goes live with the switch.
//
// ONE SOURCE: this reads the Classic page itself (the lab's index.html) and re-frames its blocks. Every figure keeps
// its element id, so the same app.js fills Classic and the new page from the same reads — a number can never differ
// between the two. What is not shown as a window stays in the page, hidden, so app.js finds everything it expects.
//
//   node temp/newpage/build.mjs <lab dir>
import fs from 'node:fs';
import path from 'node:path';

const LAB = process.argv[2];
if (!LAB) throw new Error('usage: node build.mjs <lab dir>');
const src = fs.readFileSync(path.join(LAB, 'index.html'), 'utf8');
const HERE = import.meta.dirname;

// ---- cut the Classic page into its parts -------------------------------------------------------------------------
const head = src.slice(0, src.indexOf('</head>'));
const body = src.slice(src.indexOf('<body'), src.lastIndexOf('</body>'));
// top-level <section>…</section> blocks, in order (sections do not nest on this page, but count anyway)
function sections(html) {
  const out = []; let i = 0;
  while ((i = html.indexOf('<section', i)) >= 0) {
    let depth = 0, j = i;
    const re = /<section\b|<\/section>/g; re.lastIndex = i;
    let m;
    while ((m = re.exec(html))) { depth += m[0] === '</section>' ? -1 : 1; if (!depth) { j = m.index + 10; break; } }
    out.push({ html: html.slice(i, j), start: i, end: j }); i = j;
  }
  return out;
}
const secs = sections(body);
const find = (test) => { const s = secs.find((x) => test(x.html)); if (!s) throw new Error('section not found: ' + test); return s.html; };
const byBlock = (n) => find((h) => h.includes(`Block 0${n} &middot;`));
const giggle = find((h) => /id="giggle"/.test(h)), boost = find((h) => /id="liq-boost-bobai-3"/.test(h));
// the liquidity card for good (2026-10-28): app.js shows it instead of Boost III from Nov 20 on, here as on Classic
const lfg = find((h) => /id="liq-for-good"/.test(h));
const hero = find((h) => /class="hero"/.test(h)), stats = find((h) => /id="stats"/.test(h));
// the Classic blocks run 01-07 without a gap since 2026-10-05 (Roadmap 05, Questions 06, Socials 07); the window ids stay w06/w07
const socials = byBlock(7);
const footer = body.slice(body.indexOf('<footer'), body.indexOf('</footer>') + 9);
// the terminal's markup, from the Classic page, made the embedded centre window
const btStart = body.indexOf('<div class="bt" id="bt"');
const btEnd = body.indexOf('<script type="module">', btStart);
const bt = body.slice(btStart, btEnd).replace('<div class="bt" id="bt" role="dialog" aria-modal="true"', '<div class="bt embed" id="bt" role="region"');
const termCss = (body.match(/<link rel="stylesheet" href="terminal\/terminal\.css[^"]*">/) || [''])[0];
const termJs = (body.match(/import\('\.\/terminal\/terminal\.js[^']*'\)/) || ["import('./terminal/terminal.js')"])[0];
// every <script> of the Classic body except the terminal loader, in order (app.js and the page's own)
const scripts = [...body.matchAll(/<script\b[\s\S]*?<\/script>/g)].map((m) => m[0]).filter((s) => !s.includes("getElementById('btOpen')"));
// the Social links become header icons
// Only the socials, one each, as icons: Telegram, X Official (@BrainOnBNB) and the code. Market
// pages (Binance, OKX …) are not socials and stay in their windows.
const allLinks = [...(socials + footer).matchAll(/<a[^>]+href="(https?:[^"]+)"[^>]*>/g)].map((m) => m[1]);
const SOCIAL = [
  ['Telegram', (u) => /t\.me\//.test(u), '<path d="M21.5 3.5 2.8 10.7c-1.3.5-1.3 1.2-.2 1.6l4.8 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.8-.8L23 4.9c.3-1.4-.5-2-1.5-1.4Zm-3.3 3.6-8.9 8-.3 3.8-1.6-5.1 10.8-6.8c.5-.3.9 0 0 .1Z"/>'],
  ['X Official', (u) => /x\.com\/BrainOnBNB$/i.test(u), '<path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/>'],
  // the X Community account (@BrainOnBNBAI) is gone for good (operator, 2026-11-13) and is linked nowhere
  ['GitHub', (u) => /github\.com\//.test(u), '<path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.7.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"/>'],
];
const socialLinks = SOCIAL.map(([name, test, path]) => { const u = allLinks.find(test); return u ? { name, u, path } : null; }).filter(Boolean);

// ---- the seven windows -------------------------------------------------------------------------------------------
// preview: a kicker, a title, one live figure mirrored from an element the window already carries (app.js fills it)
// each window's own glow, like the terminal's flipcharts take the colour of their scene
const ACCENT = { '01': '#F0B90B', '02': '#2dd4bf', '03': '#ff7a3d', '04': '#60a5fa', '05': '#a78bfa', '06': '#F0B90B', '07': '#60a5fa', '08': '#c9b8a8' };
// the pages the Classic footer names, each with a line saying what it holds, and the contact under them.
// NOTHING TWICE (operator, 2026-10-05: "everything in 07 MORE that is already somewhere on the page can go"): the token
// and its contract are window 01 (the split is window 02), the code of every bot is in window 04, the Classic page has
// its button in the header, the finished campaigns are window 03 PROOF (operator: "the archive goes too, that is on the
// left under Proof"). So here stay only what the page has nowhere else: the Lite Paper, the source mirror, the contact.
const MORE = `<div class="bw-more"><div class="mo-g">${[
  ['whitepaper', 'Whitepaper', 'What $BOBAI is and how its 3% works'],
  ['/source', 'Source', 'The public mirror of the repository'],
].map(([u, t, d]) => `<a class="mo-a" href="${u}"><b>${t}</b><span>${d}</span></a>`).join('')}</div>
<p class="mo-f">Contact <a href="mailto:bobai@brainonbnb.ai">bobai@brainonbnb.ai</a></p>
<p class="mo-f">brainonbnb.com is the official home of Brain On BNB AI ($BOBAI).</p></div>`;
const W = [
  { n: '01', k: 'THE TOKEN', t: 'What $BOBAI is', html: byBlock(1) + socials, mirror: null, lab: 'of the supply burned for good' },
  { n: '02', k: 'TOKENOMICS', t: 'Where the 3% goes', html: boost + lfg + giggle + byBlock(2), mirror: null, lab: 'until this split ends' },
  { n: '03', k: 'PROOF', t: 'Every burn, on-chain', html: byBlock(3), mirror: null, lab: 'Burned by the bot, last 7 days · bars: 14 days' },
  { n: '04', k: 'ECOSYSTEM', t: 'Hire an agent, use the tools', html: byBlock(4), mirror: null, lab: 'apps, agents and tools' },
  // 05 is not a block of the classic page: it opens the terminal's own chart view (the scanner, plaza, services and
  // DeFi agent live in 04, every one of them opening as its own window — nothing twice, operator 2026-09-26)
  { n: '06', d: '05', k: 'BRAINMAP', t: 'Build · Believe · Brain', html: byBlock(5), mirror: null, lab: 'how the brain grows' },
  { n: '07', d: '06', k: 'QUESTIONS', t: 'Quick answers', html: byBlock(6), mirror: null, lab: 'FAQ' },
  // 07 MORE (operator, 2026-10-05: "the footer as a narrow line, like under 06 Questions, in a window too; the ones above
  // a little smaller"): the front page had no way to the Lite Paper, the token page, the archive or a contact — the
  // Classic footer sat in the hidden part. A small card, and behind it the same links as a window.
  { n: '08', d: '07', k: 'MORE', t: 'Paper, source, contact', html: MORE, mirror: null, mini: true, lab: 'whitepaper · source · contact' },
];
// 04's logos open their pages (cards.js); the link rows on the cards went again (operator, 2026-10-12: "04 stays as it was")
const card = (w) => cardButton(w);
const cardButton = (w) => `<button class="bw-card${w.mini ? ' bw-mini' : ''}" style="--c:${ACCENT[w.n]}" type="button" data-open="${w.chart ? 'chart' : w.page ? 'page:' + w.page : 'w' + w.n}"><span class="bw-n">${w.d || w.n}</span><span class="bw-k">${w.k}</span><b class="bw-t">${w.t}</b><span class="bw-viz" aria-hidden="true"></span><span class="bw-v"${w.mirror ? ` data-mirror="${w.mirror}"` : ''}>${w.mirror ? '…' : ''}</span><span class="bw-l">${w.lab}</span><i class="bw-go" aria-hidden="true">⤢</i></button>`;
const win = (w) => w.chart || w.page ? '' : `<div class="bw-win" style="--c:${ACCENT[w.n]}" id="w${w.n}" role="dialog" aria-modal="true" aria-label="${w.d || w.n} ${w.k}: ${w.t}" hidden><div class="bw-frame"><div class="bw-bar"><i></i><i></i><i></i><span><b>${w.d || w.n}</b> · ${w.k}<em>${w.t}</em></span><button class="bw-x" type="button" data-close-win aria-label="Close">×</button></div><div class="bw-body">${w.html}</div></div></div>`;

// THE BUY LINE (2026-10-27, operator: a trader 'in 10 seconds does not see why to buy'), generated here since 2026-10-28
// (it had been written into the built page only, and the next build would have dropped it). Its figures are the chart
// view's own (window.__btQuote: the terminal's chain reads and candle ledger, same formatting), refreshed every 2 s, so
// the line and the chart never differ (operator, 28.10.: 'always stale and not exactly the ones of the chart'). Only
// if the terminal does not come up do the site's /api reads fill it. No button of its own: the header has 'Buy $BOBAI'
// (operator, 28.10.: the phone's 'Buy on PancakeSwap' at the right end goes).
const BUYLINE = `<div class="bp-buyline" role="region" aria-label="$BOBAI at a glance">
  <button class="ca" type="button" data-ca="0x245c386dcfed896f5c346107596141e5edcbffff" title="Copy the contract address">CA 0x245c…ffff <span>Copy</span></button>
  <span class="f p"><span class="k">Price</span><b data-bl="price">—</b></span>
  <span class="f m"><span class="k">MC</span><b data-bl="mc">—</b></span>
  <span class="f l"><span class="k">Liq</span><b data-bl="liq">—</b></span>
</div>
<script>
(() => {
  // WHAT DOES NOT FIT GOES WHOLE, NEVER CUT (2026-10-30, operator: cut off at "supply"): the old width steps were set by
  // hand and the longer sentence of 29.10. outgrew nine of fifteen widths; the figures change length too, so the line
  // measures itself. From 1180 px it stands in the header; below that it scrolls sideways inside itself, as before.
  const line = document.querySelector('.bp-buyline'), order = ['.m', '.l', '.ca'].map((s) => line.querySelector(s)).filter(Boolean); // 8.11. (operator): only the CA, price, MC and liquidity in the line
  line.querySelector('.ca').addEventListener('click', (e) => { const b = e.currentTarget, s = b.querySelector('span'); navigator.clipboard?.writeText(b.dataset.ca).then(() => { s.textContent = 'Copied ✓'; setTimeout(() => { s.textContent = 'Copy'; }, 1600); }); });
  const fit = () => {
    order.forEach((e) => e.classList.remove('bl-off'));
    // never under the icons (2026-11-08, operator: "the line runs over the Telegram logo"): its right edge stops 12 px
    // before the first icon of the header's right side, however wide the buttons there are
    if (innerWidth >= 1180) { const soc = document.querySelector('.bp-soc'); if (soc) line.style.right = Math.max(0, innerWidth - soc.getBoundingClientRect().left + 12) + 'px'; }
    else line.style.right = '';
    // WHOLE ON A PHONE TOO (2026-11-16, Liste A): below 1180 the line only scrolled, and at 344-430 px a field stood cut
    // in half at the edge (MC or Liq) — the 30.10. rule, whole or not at all, now holds at every width, same order
    for (const e of order) { if (line.scrollWidth <= line.clientWidth) break; e.classList.add('bl-off'); }
  };
  const set = (k, t) => { const e = document.querySelector('[data-bl="' + k + '"]'); if (e && t && e.textContent !== t) { e.textContent = t; fit(); } };
  addEventListener('resize', fit); fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  let fromChart = false;
  const tick = () => { let q = null; try { q = window.__btQuote && window.__btQuote(); } catch (e) {} if (!q) return; fromChart = true; for (const k of ['price', 'mc', 'liq', 'vol', 'burned', 'lp']) set(k, q[k]); };
  setInterval(() => { if (!document.hidden) tick(); }, 2000);
  setTimeout(() => {
    if (fromChart) return;
    const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
    const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    get('/api/price').then((j) => { if (!j || fromChart) return; if (j.price_usd) set('price', '$' + Number(j.price_usd).toPrecision(5)); if (j.market_cap_usd) set('mc', usd(j.market_cap_usd)); });
    get('/api/liquidity').then((j) => { if (!j || fromChart) return; if (j.liquidity_usd) set('liq', usd(j.liquidity_usd)); if (j.lp_burned_percent != null) set('lp', j.lp_burned_percent + '%'); });
  }, 15000);
})();
</script>`;

// BOBAI CHECKS A TOKEN (2026-11-19, brain/check.js): one field for any BNB Chain token and a size; the answer is the pre-trade
// check every agent gets, in plain words, and he says the verdict. A phone shows the field as a row under the buy line;
// a wide screen opens it from the header's button over the left cards, so he stays in sight while he speaks.
const CHECK = `<section class="bk-panel" id="bk-panel" aria-label="Check a token before you buy">
  <form class="bk-form" id="bk-form" role="search" autocomplete="off">
    <label class="bk-lbl" for="bk-in">Check any BNB Chain token before you buy <span>· measured on-chain now, no wallet</span></label>
    <div class="bk-line"><input id="bk-in" type="text" spellcheck="false" autocapitalize="off" placeholder="Paste a token address or a DexScreener link"><button class="bk-go" type="submit">Check</button><button class="bk-x" type="button" aria-label="Close">&times;</button></div>
    <div class="bk-opts"><span class="bk-sizes" role="group" aria-label="Your size in dollars"></span><span class="bk-try"><span>Try</span></span></div>
  </form>
  <div class="bk-out" id="bk-out" aria-live="polite"></div>
</section>`;

// the Classic page's own title stays (2026-09-27, before go-live): it is the one search results and link cards already
// show for brainonbnb.com, and the Brain page takes over the same address
const page = `${head.replace('<head>', '<head>\n<base href="/">')}
<link rel="stylesheet" href="brain/brain.css?v=${Date.now()}">
<!-- BOBAI himself first (2026-09-30): his still was asked for only when the scene opened, after three.js — 6.7 s on a slow phone -->
<link rel="preload" href="terminal/fig/idle.webp" as="image" fetchpriority="high">
${termCss}
</head>
<body class="brainpage">
<div class="bp-h" role="banner">
  <h1 class="bp-sr">$BOBAI Brain Terminal: what Brain On BNB AI does with every trade, live from BNB Chain</h1>
  <a class="bp-logo" href="/"><img src="logo-sm.webp" width="34" height="34" alt=""><span class="bp-name"><span><b>$BOBAI</b> Brain On BNB AI</span><small>Built to stay. Every number checked, every tool for everyone.</small></span></a>
  <div class="bp-tick"></div>
  <div class="bp-soc" role="navigation" aria-label="Socials">${socialLinks.map((s) => `<a href="${s.u}" target="_blank" rel="noopener" aria-label="${s.name}" title="${s.name}"><svg viewBox="0 0 24 24" aria-hidden="true">${s.path}</svg>${s.name === 'X Official' ? '<i class="bp-ok" aria-hidden="true">✓</i>' : s.name === 'X Community' ? '<small>CT</small>' : ''}</a>`).join('')}</div>
  <button class="bp-chk-btn" type="button" aria-controls="bk-panel" aria-expanded="false" title="Check any BNB Chain token before you buy — read on-chain, live">Check a token</button>
  <a class="bp-sw" href="/classic" title="The classic page — the same figures">Classic</a>
  <a class="bp-buy" href="https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff&chain=bsc" target="_blank" rel="noopener" title="3% tax: set slippage to 6% in PancakeSwap">Buy $BOBAI</a>
</div>
${BUYLINE}
${CHECK}
<div class="bp-grid" role="main">
  <div class="bp-side l">${W.slice(0, 3).map(card).join('\n')}</div>
  <div class="bp-center" role="region" aria-label="BOBAI Brain Terminal">${bt}</div>
  <div class="bp-side r">${W.slice(3).map(card).join('\n')}</div>
</div>
${W.map(win).join('\n')}
<div class="bw-win bw-page" id="wpage" role="dialog" aria-modal="true" aria-label="Page" hidden><div class="bw-frame"><div class="bw-bar"><span><b class="pg-k"></b><em class="pg-t">…</em></span><a class="pg-open" href="/" target="_blank" rel="noopener">open as a page ↗</a><button class="bw-x" type="button" data-close-win aria-label="Close">×</button></div><iframe class="pg-f" title="Page"></iframe></div></div>
<div class="bp-hidden" hidden aria-hidden="true">${hero.replace(/<picture>[\s\S]*?<\/picture>/, '')}${stats}${footer}</div>
${scripts.filter((s) => !s.includes('application/ld+json')).join('\n')}
<script type="module">
// the terminal opens with the page: it IS the page
(async () => { try { (await ${termJs}).open(); } catch (e) { const i = document.getElementById('bt-intro'); if (i) i.textContent = 'BRAIN OFFLINE · RELOAD'; } })();
</script>
<script src="brain/brain.js?v=${Date.now()}" defer></script>
<script src="brain/cards.js?v=${Date.now()}" defer></script>
<script src="brain/hero.js?v=${Date.now()}" defer></script>
<script src="brain/check.js?v=${Date.now()}" defer></script>
</body></html>
`;
fs.mkdirSync(path.join(LAB, 'brain'), { recursive: true });
fs.writeFileSync(path.join(LAB, 'brain', 'index.html'), page);
for (const f of ['brain.css', 'brain.js', 'cards.js', 'hero.js', 'embed.css', 'embed.js', 'check.js']) fs.copyFileSync(path.join(HERE, f), path.join(LAB, 'brain', f));
console.log('wrote', path.join(LAB, 'brain', 'index.html'), (page.length / 1024).toFixed(0) + ' KB', '·', socialLinks.length, 'social links');
