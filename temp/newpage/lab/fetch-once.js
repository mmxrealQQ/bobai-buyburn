// ONE READ PER RECORD (2026-11-04, operator: "Startseite leichter"): the front page's windows each read their own
// record, and a visit asked /board 5 times, /lp/portfolio 4, /stats 4, logs/health 4, /buys 3 — the same answer over
// and over as each window opened. Loaded before every other script: a GET of one of our own records asked again
// within 15 s gets a copy of the first answer instead of a new request. 15 s on purpose: every regular read on the
// page repeats at 20 s or more (the windows 20-30 s, the terminal's record 45 s; its 8 s trade poll is a chain read,
// POST, never touched), so no repeat of a poll is ever handed an old copy. Only GET without a body, only our record hosts and paths; POST (the chain
// reads), videos and images are never touched. Each caller gets its own clone, so one reading the body leaves the
// others theirs; a failed read is forgotten at once, so the next one asks anew.
(function () {
  if (!window.fetch || window.__fetchOnce) return;
  var orig = window.fetch.bind(window), seen = new Map(), KEEP = 15000;
  var ours = /^https:\/\/(agent|logs)\.brainonbnb\.com\/|^https:\/\/brainonbnb\.com\/(api\/|logs\/|[a-z0-9-]+\.json)/i;
  window.__fetchOnce = { asked: 0, shared: 0 };
  window.fetch = function (input, init) {
    try {
      var method = (init && init.method) || (input && input.method) || 'GET';
      var url = typeof input === 'string' ? new URL(input, location.href).href : input && input.url;
      if (String(method).toUpperCase() !== 'GET' || (init && init.body) || !url || !ours.test(url) || /\.(mp4|webp|png|jpg)(\?|$)/i.test(url)) return orig(input, init);
      window.__fetchOnce.asked++;
      var hit = seen.get(url);
      if (hit && Date.now() - hit.at < KEEP) { window.__fetchOnce.shared++; return hit.p.then(function (r) { return r.clone(); }); }
      var p = orig(input, init);
      seen.set(url, { at: Date.now(), p: p });
      p.then(function (r) { if (!r.ok) seen.delete(url); }, function () { seen.delete(url); });
      setTimeout(function () { var h = seen.get(url); if (h && h.p === p) seen.delete(url); }, KEEP);
      return p.then(function (r) { return r.clone(); });
    } catch (e) { return orig(input, init); }
  };
})();
