// The dev lab's only server code (2026-09-26): the pages read their figures from same-origin paths (/logs/…, /api/…)
// that the real site's worker answers. Here they are handed to brainonbnb.com unchanged, so the lab shows the same
// numbers as the live site; everything else is the lab's own static files. Read-only: GET and HEAD only.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && /^\/(logs|api)\//.test(url.pathname)) {
      const r = await fetch('https://brainonbnb.com' + url.pathname + url.search, { headers: { accept: request.headers.get('accept') || '*/*' } });
      const h = new Headers(r.headers); h.set('x-lab-proxy', 'brainonbnb.com');
      return new Response(r.body, { status: r.status, headers: h });
    }
    // The Brain page is the lab's front page (operator, 2026-09-26: "the dev lab has to be the Brain by default, with
    // only the option of Classic"). Classic answers at /classic — no trailing slash, so its relative asset paths
    // (styles.css, app.js …) still resolve at the root.
    if (url.pathname === '/' || url.pathname === '/index.html') return env.ASSETS.fetch(new Request(url.origin + '/brain/', request));
    if (url.pathname === '/classic' || url.pathname === '/classic/') {
      if (url.pathname.endsWith('/')) return Response.redirect(url.origin + '/classic' + url.search, 301);
      return env.ASSETS.fetch(new Request(url.origin + '/', request));
    }
    if (url.pathname === '/brain' || url.pathname === '/brain/') return Response.redirect(url.origin + '/' + url.search, 301);
    // A subpage shown in a window of the Brain page: ?embed=1 adds the embed look and the link bridge (stage 3).
    // An app (brainScreener, game, World Cup) keeps its own look and only gets the bridge — on every one of its pages,
    // so the frame is recognised by the browser's own "loaded in a frame" header, not only by the first ?embed=1.
    const res = await env.ASSETS.fetch(request);
    const framed = url.searchParams.get('embed') === '1' || request.headers.get('sec-fetch-dest') === 'iframe';
    if (framed && (res.headers.get('content-type') || '').includes('text/html')) {
      const app = /^\/(brainscreener|game|worldcup)(\/|$)/.test(url.pathname);
      return new HTMLRewriter()
        .on('html', { element(e) { e.setAttribute('class', ((e.getAttribute('class') || '') + (app ? ' bp-app' : ' bp-embed')).trim()); } })
        .on('head', { element(e) { e.append((app ? '' : '<link rel="stylesheet" href="/brain/embed.css">') + '<script src="/brain/embed.js" defer></script>', { html: true }); } })
        .transform(res);
    }
    return res;
  },
};
