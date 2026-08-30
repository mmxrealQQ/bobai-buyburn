// Applies the fixes the audit found, across every page at once.
//
// Written rather than done by hand because 21 pages needed the same four
// things, and doing that manually is how pages end up subtly different from
// each other — which is the problem being fixed in the first place.
//
// Only touches what is missing. A page that already has a description keeps
// its own; nothing here overwrites human-written copy.
//
// Usage:
//   node scripts/site-fix.mjs --dry    show what would change
//   node scripts/site-fix.mjs          apply
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DASH = path.join(ROOT, 'dashboard');
const DRY = process.argv.includes('--dry');

const OG_IMAGE = 'https://brainonbnb.com/og-banner.png';

// Per-page copy. Written out rather than generated, because a description
// assembled from a template reads like one — and these are what shows up in
// search results and shared links.
const COPY = {
  'worldcup/app/index.html': ['BOBAI Worldcup \'26 — Tipgame', 'The BOBAI World Cup 2026 tipping game: predict every match, climb the leaderboard, share the $BOBAI prize pool. Free to enter, settled on-chain.'],
  'worldcup/app/dashboard.html': ['Your Worldcup \'26 Dashboard', 'Your standing in the BOBAI World Cup 2026 tipping game — points, rank, and every prediction you made.'],
  'worldcup/app/leaderboard.html': ['Worldcup \'26 Leaderboard', 'Live standings for the BOBAI World Cup 2026 tipping game — every player, every point, updated as matches finish.'],
  'worldcup/app/tips.html': ['Your Worldcup \'26 Predictions', 'Enter and review your predictions for the BOBAI World Cup 2026 tipping game. Locked at kick-off, scored automatically.'],
  'worldcup/app/bonus.html': ['Worldcup \'26 Bonus Questions', 'Tournament-long bonus predictions in the BOBAI World Cup 2026 tipping game — top scorer, winner, and more.'],
  'worldcup/app/rules.html': ['Worldcup \'26 Rules & Scoring', 'How the BOBAI World Cup 2026 tipping game is scored: points per match, bonus questions, tiebreakers, and payout.'],
  'worldcup/app/prize-pool.html': ['Worldcup \'26 Prize Pool', 'The $BOBAI prize pool for the World Cup 2026 tipping game — how it was funded and how it is split.'],
  'worldcup/app/crypto.html': ['Worldcup \'26 — Getting Paid In $BOBAI', 'How prizes reach you in the BOBAI World Cup 2026 tipping game: wallet setup, the token, and the payout process.'],
  'worldcup/app/user.html': ['Your Worldcup \'26 Account', 'Your player profile for the BOBAI World Cup 2026 tipping game — name, wallet, and settings.'],
  'worldcup/app/reset.html': ['Reset Your Password', 'Set a new password for your BOBAI World Cup 2026 tipping game account.'],
  'worldcup/index.html': ['BOBAI Worldcup \'26 — Archive', 'The BOBAI World Cup 2026 tipping game ran from June 11 to July 19, 2026 and paid out 8.94M $BOBAI. This is the frozen archive.'],
  'brainscreener/adhd-result.html': ['Your ADHD Screening Result', 'Your result from the ASRS-based ADHD self-screening on brainScreener. Anonymous, free, and not a diagnosis.'],
  'brainscreener/iq-result.html': ['Your IQ Test Result', 'Your result from the brainScreener IQ test. Anonymous, free, and for orientation only.'],
  'brainscreener/character-result.html': ['Your Character Profile', 'Your result from the brainScreener character questionnaire. Anonymous, free, and not a clinical assessment.'],
  'brainscreener/404.html': ['Page Not Found — brainScreener', 'That page does not exist. Browse the 13 free, anonymous self-tests on brainScreener instead.'],
  'brainscreener/debug-ua.html': ['Debug — brainScreener', 'Internal diagnostic page.'],
};

const AURORA = '<div class="aur" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>';

const FOOTER = `<footer><div class="fi2">
  <div class="fb"><img src="/logo-sm.webp" width="96" height="96" alt=""><span>BOBAI</span></div>
  <div class="fm">
    <p style="margin-top:6px;opacity:.75">Made by <a href="/">Brain On BNB AI</a> &middot; <a href="/whitepaper">Whitepaper</a></p>
  </div>
</div></footer>`;

const NAV = (label, href) => `<nav><div class="nav">
    <a class="back-btn" href="/" title="Back to Dashboard"><span>&larr;</span> Dashboard</a>
    <a class="brand-link" href="${href}">${label}</a>
    <a class="nb" href="https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff" target="_blank" rel="noopener">Buy $BOBAI</a>
  </div></nav>`;

const NAV_CSS = `<style>
  .back-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;
    background:rgba(240,185,11,.08);border:1px solid rgba(240,185,11,.2);color:var(--gold);
    font-size:12px;font-weight:600;text-decoration:none;letter-spacing:.3px;
    transition:transform .2s ease,background .2s,border-color .2s;white-space:nowrap}
  .back-btn:hover{transform:translateX(-2px);background:rgba(240,185,11,.15);border-color:rgba(240,185,11,.4)}
  .back-btn span{font-size:14px;line-height:1}
  .brand-link{font-family:'Space Grotesk';font-weight:700;font-size:14px;letter-spacing:.5px;
    color:var(--gold);white-space:nowrap;text-decoration:none}
  .brand-link:hover{opacity:.85}
  @media (max-width:560px){.brand-link{font-size:12px}.nb{padding:7px 14px;font-size:.72rem}}
</style>`;

const changes = [];
const record = (page, what) => changes.push(`${page}: ${what}`);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'code') walk(p, out); }
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
};

for (const file of walk(DASH)) {
  const rel = path.relative(DASH, file).replace(/\\/g, '/');
  let s = fs.readFileSync(file, 'utf8');
  const before = s;

  const titleMatch = s.match(/<title>([^<]*)<\/title>/);
  const title = (COPY[rel]?.[0]) || (titleMatch ? titleMatch[1].trim() : null);
  const desc = COPY[rel]?.[1];

  // ---- description ----
  if (!/<meta name="description"/.test(s) && desc) {
    s = s.replace(/<\/title>/, `</title>\n  <meta name="description" content="${desc}">`);
    record(rel, 'added meta description');
  }

  // ---- social card ----
  // Every page that can be shared should show something when it is. Without
  // og:title a link posts as a bare URL, which looks broken rather than plain.
  if (!/property="og:title"/.test(s) && title) {
    const url = 'https://brainonbnb.com/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '');
    const block = [
      `  <meta property="og:title" content="${title.replace(/"/g, '&quot;')}">`,
      desc ? `  <meta property="og:description" content="${desc}">` : '',
      `  <meta property="og:image" content="${OG_IMAGE}">`,
      `  <meta property="og:url" content="${url}">`,
      `  <meta property="og:type" content="website">`,
      `  <meta name="twitter:card" content="summary_large_image">`,
      `  <meta name="twitter:title" content="${title.replace(/"/g, '&quot;')}">`,
      desc ? `  <meta name="twitter:description" content="${desc}">` : '',
      `  <meta name="twitter:image" content="${OG_IMAGE}">`,
    ].filter(Boolean).join('\n');
    s = s.replace(/<\/title>/, `</title>\n${block}`);
    record(rel, 'added social card');
  } else if (!/property="og:image"/.test(s) && /property="og:title"/.test(s)) {
    s = s.replace(/(<meta property="og:title"[^>]*>)/, `$1\n  <meta property="og:image" content="${OG_IMAGE}">`);
    record(rel, 'added og:image');
  }
  if (!/name="twitter:card"/.test(s) && /property="og:title"/.test(s)) {
    s = s.replace(/(<meta property="og:title"[^>]*>)/, `$1\n  <meta name="twitter:card" content="summary_large_image">`);
    record(rel, 'added twitter:card');
  }

  // ---- aurora backdrop, for main-site pages that carry the shared stylesheet ----
  const mainSite = !rel.startsWith('brainscreener/') && !rel.startsWith('worldcup/app/');
  if (mainSite && !/class="aur"/.test(s) && /styles\.css/.test(s) && /<body[^>]*>/.test(s)) {
    s = s.replace(/(<body[^>]*>)/, `$1\n${AURORA}`);
    record(rel, 'added aurora backdrop');
  }

  // ---- nav and footer on main-site sub-pages ----
  if (mainSite && rel !== 'index.html' && /styles\.css/.test(s)) {
    if (!/<nav/.test(s) && /<body[^>]*>/.test(s)) {
      const label = rel.startsWith('game') ? 'BOBAI Game'
        : rel.startsWith('nft') ? 'BOBAI NFT Drops'
        : title || 'BOBAI';
      const href = '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '');
      s = s.replace(/<\/head>/, `${NAV_CSS}\n</head>`);
      s = s.replace(/(<body[^>]*>(?:\s*<div class="aur"[^>]*>.*?<\/div>)?)/s, `$1\n  ${NAV(label, href)}`);
      record(rel, 'added nav');
    }
    if (!/<footer/.test(s) && /<\/body>/.test(s)) {
      s = s.replace(/<\/body>/, `${FOOTER}\n</body>`);
      record(rel, 'added footer');
    }
  }

  if (s !== before && !DRY) fs.writeFileSync(file, s);
}

console.log(`\n${DRY ? 'Would change' : 'Changed'} ${changes.length} things:\n`);
changes.forEach((c) => console.log('  ' + c));
console.log();
