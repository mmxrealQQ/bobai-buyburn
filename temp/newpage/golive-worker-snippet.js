    // THE BRAIN PAGE IS THE FRONT PAGE (operator, 2026-09-26/27): the Brain Terminal in the middle, the homepage's
    // blocks as windows around it. The page it replaces stays one click away at /classic, with the same figures from
    // the same app.js. /classic has no trailing slash, so the Classic page's relative asset paths still resolve.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (url.pathname === '/index.html') return Response.redirect(url.origin + '/' + url.search, 301);
      const r = await env.ASSETS.fetch(new Request(url.origin + '/brain/', request));
      return new Response(r.body, { status: r.status, headers: secureHeaders(new Headers(r.headers)) });
    }
    if (url.pathname === '/classic' || url.pathname === '/classic/') {
      if (url.pathname.endsWith('/')) return Response.redirect(url.origin + '/classic' + url.search, 301);
      const r = await env.ASSETS.fetch(new Request(url.origin + '/', request));
      return new Response(r.body, { status: r.status, headers: secureHeaders(new Headers(r.headers)) });
    }
    if (url.pathname === '/brain' || url.pathname === '/brain/' || url.pathname === '/brain/index.html') return Response.redirect(url.origin + '/' + url.search, 301);
    // A page of this site shown in a window of the Brain page: ?embed=1 (or the browser's own "loaded in a frame"
    // header) adds the window look and the link bridge. The apps (brainScreener, the game, the World Cup tip game)
    // keep their own look and get only the bridge, on every one of their pages.
    if (request.method === 'GET' && (url.searchParams.get('embed') === '1' || request.headers.get('sec-fetch-dest') === 'iframe')) {
      const r = await env.ASSETS.fetch(request);
      if ((r.headers.get('content-type') || '').includes('text/html')) {
        // embed.js/.css carry a ?v= BUMPED ON EVERY CHANGE (2026-10-12: the zone keeps browser copies 4 h, an old embed.js
        // without /screener made "Open the screener" in the Plaza window do nothing)
        const app = /^\/(brainscreener|game|worldcup)(\/|$)/.test(url.pathname);
        const t = new HTMLRewriter()
          .on('html', { element(e) { e.setAttribute('class', ((e.getAttribute('class') || '') + (app ? ' bp-app' : ' bp-embed')).trim()); } })
          .on('head', { element(e) { e.append((app ? '' : '<link rel="stylesheet" href="/brain/embed.css?v=1024">') + '<script src="/brain/embed.js?v=1024" defer></script>', { html: true }); } })
          .transform(r);
        return new Response(t.body, { status: t.status, headers: secureHeaders(new Headers(t.headers)) });
      }
      return new Response(r.body, { status: r.status, headers: secureHeaders(new Headers(r.headers)) });
    }

// ---- helper ----
// The four headers every page gets at the end of fetch(); the Brain page's own routes above return before it.
function secureHeaders(h) {
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'SAMEORIGIN');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return h;
}
