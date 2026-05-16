// $BOBAI Worldcup '26 — Twemoji parser
// Windows browsers don't ship a flag-emoji font (and most don't ship any
// color-emoji font at all), so flag glyphs render as black squares with
// country codes. Twemoji replaces emoji text nodes with Twitter's SVG
// emoji images so every desktop sees the same flags as mobile.
//
// Re-parses a few times after initial load to catch async-rendered
// content (country grids, leaderboard rows) without needing every page
// to call this manually.

(function(){
  const BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/';
  function parse(){
    if (!window.twemoji || !document.body) return;
    try {
      window.twemoji.parse(document.body, { folder: 'svg', ext: '.svg', base: BASE });
    } catch (e) { /* swallow — partial parse is harmless */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', parse);
  } else {
    parse();
  }
  // Catch async content that renders after auth/fetch completes.
  [150, 600, 1500, 3000].forEach(ms => setTimeout(parse, ms));
})();
