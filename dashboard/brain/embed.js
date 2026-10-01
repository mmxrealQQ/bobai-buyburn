// Inside a window of the Brain page (2026-09-26, stage 3): a link to another page of the site asks the Brain page
// to show that page in its window instead of navigating this frame away; a link home closes the window. Links to
// other sites open in a new tab as they always did. An app (brainScreener, the game, the World Cup tip game) moves
// freely inside its own folder — its tests, results and tables are its own pages, in the same window.
(() => {
  if (window.parent === window) return;
  const PAGES = /^\/(scanner|registry|services|defi|liquidity|agents|nft|library|whitepaper|advantage|session|source|token|faq|roadmap|archive|brainscreener|game|worldcup)(\/|$|\?)/;
  const APPS = /^\/(brainscreener|game|worldcup)(\/|$)/;
  const home = location.pathname.split('/')[1];
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]'); if (!a || e.defaultPrevented) return;
    if (a.target === '_blank' && !a.href.startsWith(location.origin)) return;
    const u = new URL(a.getAttribute('href'), location.href);
    if (u.origin !== location.origin) { if (!a.target) a.target = '_blank'; return; } // another site: never inside the window
    if (u.pathname === location.pathname && (u.hash || a.getAttribute('href').startsWith('#'))) return; // an anchor on this page
    if (APPS.test(location.pathname) && u.pathname.split('/')[1] === home) return; // an app's own page
    if (/\.(txt|zip|json|pdf|md)$/i.test(u.pathname)) { if (!a.target) a.target = '_blank'; return; } // a file: its own tab
    e.preventDefault();
    if (PAGES.test(u.pathname)) parent.postMessage({ bp: 'page', path: u.pathname + u.search + u.hash, title: a.textContent.trim().slice(0, 60) }, location.origin);
    else parent.postMessage({ bp: 'home', hash: u.hash }, location.origin);
  }, true);
  // Esc inside the frame closes the window, as it does outside it
  addEventListener('keydown', (e) => { if (e.key === 'Escape') parent.postMessage({ bp: 'home' }, location.origin); });
  parent.postMessage({ bp: 'ready', title: document.title }, location.origin);
})();
