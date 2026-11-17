// THE COMMUNITY XMAS TERMINAL (2026-11-17, operator: "the community builds the Xmas terminal theme — one command,
// they build it themselves, it works for them as it does for me, they upload it; BOBAI and the standard terminal stay;
// from 1 December it is live", then: "even better: an X post with the command, whoever wants builds one").
//
// Operator, then: "everyone may build, Binance itself or other platforms too; once live you always see how many users
// use which terminal; as many as want; but it must all be clean and hack-free — a sandbox page like xmas.preview".
//
// A WORKER OF ITS OWN, WITH STORAGE OF ITS OWN, ON A DOMAIN OF ITS OWN: nothing here can read or write what the agent
// worker holds (payments, sessions, the board), and a theme's files come from *.workers.dev, never from brainonbnb.com.
//
// Anyone who runs the kit's one command joins (POST /join) and gets a key of their own, kept by the kit on their
// machine; the key is the builder: every upload is theirs and nobody else's. A theme is a folder (back.html under
// BOBAI, front.html over him, and whatever they load) stored as ONE bundle per version, served into a sandboxed frame
// on the terminal: the response's own CSP says `sandbox allow-scripts` (an opaque origin even when a file is opened on
// its own: no cookies, no storage, no page), `connect-src 'none'` (no calls out, no tracking), no eval and no
// WebAssembly (no miner), no workers, no forms, no plugins, no frames. The terminal gives the frames no pointer events:
// a theme can never put a button in front of a visitor. Nothing goes before every visitor until the operator approves
// it (POST /admin approve); a preview link works for anyone from the first upload: https://xmas.bobai-dashboard.pages.dev/?xmas=<slug>.
//
//   POST /join     {title, builder}            -> {key, slug}   (the kit keeps the key; a builder name is taken once)
//   POST /hello    x-xmas-key                  -> the builder's theme as it stands
//   POST /upload   x-xmas-key, {files:[{path, b64}], title?} -> {ver, preview}
//   GET  /themes                               -> the approved ones with today's users, for the terminal's switch
//   GET  /theme/<slug>                         -> one theme (approved or not: the preview link)
//   GET  /t/<slug>/<ver>/<path>                -> a file of a theme, sandboxed
//   POST /use      {slug}                      -> a visitor's terminal shows this theme today (counted once a day per browser)
//   POST /admin    x-xmas-admin, {action: list | approve | unapprove | block | unblock | order | rename}

export const XMAS_SEASON = { from: '2026-12-01T00:00:00Z', to: '2027-01-01T00:00:00Z' };
export const XMAS_LIMITS = { files: 300, fileBytes: 5 * 1024 * 1024, totalBytes: 20 * 1024 * 1024, uploadsPerDay: 120, joinsPerIpPerDay: 10, themes: 5000 };
const EXT = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', woff2: 'font/woff2', woff: 'font/woff', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream' };
// no sound: a terminal that starts playing music on a visitor is no terminal (videos play muted, the terminal says so)
// The pages a theme may sit in: the site, its previews, the lab.
const FRAME_ANCESTORS = "https://brainonbnb.com https://www.brainonbnb.com https://*.bobai-dashboard.pages.dev https://bobai-dashboard.pages.dev https://*.bobai-lab.pages.dev https://bobai-lab.pages.dev";
export const THEME_CSP = "sandbox allow-scripts; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; object-src 'none'; frame-ancestors " + FRAME_ANCESTORS;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Xmas-Key' };
const out = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
// previews open on the sandbox page (the live terminal's code with every theme reachable by link), never on brainonbnb.com
export const SITE = 'https://xmas.bobai-dashboard.pages.dev';
export const SELF = 'https://bobai-xmas.bobbuildonbnb.workers.dev';

// A builder's name becomes the theme's address: lower case, letters, digits, _ and -, 2-24 long.
export function slugOf(name) {
  const s = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return s.length >= 2 ? s : null;
}
// What a person typed as a title or a name: plain text, one line, no markup, a sane length.
export function cleanText(v, max) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}
// A path inside a theme: relative, lower case or not, no way out of the folder, a known kind of file.
export function checkPath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(s) || s.includes('..') || s.includes('//') || s.endsWith('/')) return { error: `not a usable path: ${String(p).slice(0, 80)}` };
  const ext = (s.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
  if (!ext || !EXT[ext]) return { error: `${s}: .${ext || '?'} files are not served (html, css, js, json, images, video, fonts, glb)` };
  return { path: s, type: EXT[ext] };
}
const b64bytes = (b64) => { const bin = atob(String(b64 || '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export function inSeason(t = Date.now()) { return t >= Date.parse(XMAS_SEASON.from) && t < Date.parse(XMAS_SEASON.to); }

// Checks an upload and packs it: one buffer, an index of [path, type, offset, length].
export function packUpload(files) {
  if (!Array.isArray(files) || !files.length) return { error: 'no files: send {files:[{path, b64}]}' };
  if (files.length > XMAS_LIMITS.files) return { error: `${files.length} files; at most ${XMAS_LIMITS.files}` };
  const seen = new Set(), parts = [], index = [];
  let total = 0;
  for (const f of files) {
    const c = checkPath(f?.path); if (c.error) return { error: c.error };
    if (seen.has(c.path)) return { error: `${c.path} twice` };
    seen.add(c.path);
    let bytes; try { bytes = b64bytes(f.b64); } catch { return { error: `${c.path}: b64 is not base64` }; }
    if (bytes.length > XMAS_LIMITS.fileBytes) return { error: `${c.path}: ${(bytes.length / 1048576).toFixed(1)} MB; one file at most ${XMAS_LIMITS.fileBytes / 1048576} MB` };
    index.push([c.path, c.type, total, bytes.length]); parts.push(bytes); total += bytes.length;
    if (total > XMAS_LIMITS.totalBytes) return { error: `more than ${XMAS_LIMITS.totalBytes / 1048576} MB in all` };
  }
  if (!seen.has('back.html') && !seen.has('front.html')) return { error: 'a theme needs back.html (behind BOBAI) or front.html (in front of him), or both, at the top of the folder' };
  const buf = new Uint8Array(total); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  return { buf, index, total };
}

const themeKey = (slug) => `xmas:theme:${slug}`, keyKey = (h) => `xmas:key:${h}`, bundleKey = (slug, ver) => `xmas:b:${slug}:${ver}`;
async function readUse(env) {
  const day = new Date().toISOString().slice(0, 10);
  const [today, total] = await Promise.all([env.XMAS.get(`xmas:use:${day}`, 'json', { cacheTtl: 60 }), env.XMAS.get('xmas:use:total', 'json', { cacheTtl: 60 })]);
  return { day, today: today || {}, total: total || {} };
}
async function listSlugs(env) { return (await env.XMAS.get('xmas:index', 'json').catch(() => null)) || []; }
const publicView = (t) => ({ slug: t.slug, title: t.title, builder: t.builder, ver: t.ver || 0, updated: t.updated || null, approved: !!t.approved,
  base: t.ver ? `${SELF}/t/${t.slug}/${t.ver}/` : null, layers: { back: !!t.files?.some((f) => f[0] === 'back.html'), front: !!t.files?.some((f) => f[0] === 'front.html') },
  preview: `${SITE}/?xmas=${t.slug}` });

async function builderOf(request, env) {
  const key = String(request.headers.get('x-xmas-key') || '').trim();
  if (!/^xk_[A-Za-z0-9]{32}$/.test(key)) return { error: out({ error: 'no key: run the kit again (it keeps your key in .xmas-key)' }, 401) };
  const rec = await env.XMAS.get(keyKey(await sha(key)), 'json');
  if (!rec) return { error: out({ error: 'unknown key' }, 401) };
  const t = await env.XMAS.get(themeKey(rec.slug), 'json');
  if (!t) return { error: out({ error: 'unknown theme' }, 404) };
  if (t.blocked) return { error: out({ error: 'this theme was stopped by the operator' }, 403) };
  return { t };
}

export async function handleXmas(request, env, url, path) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.XMAS) return out({ error: 'storage is not bound' }, 503);

  // a file of a theme, sandboxed
  const fm = path.match(/^\/t\/([a-z0-9_-]{2,24})\/(\d{1,6})\/(.+)$/);
  if (fm && request.method === 'GET') {
    const [, slug, ver, rawPath] = fm;
    const c = checkPath(decodeURIComponent(rawPath)); if (c.error) return new Response('not found', { status: 404 });
    const t = await env.XMAS.get(themeKey(slug), 'json', { cacheTtl: 60 });
    if (!t || t.blocked) return new Response('not found', { status: 404 });
    const idx = Number(ver) === t.ver ? t.files : Number(ver) === t.prevVer ? t.prevFiles : null;
    const ent = idx?.find((f) => f[0] === c.path);
    if (!ent) return new Response('not found', { status: 404, headers: { 'Content-Security-Policy': THEME_CSP } });
    const buf = await env.XMAS.get(bundleKey(slug, ver), { type: 'arrayBuffer', cacheTtl: 3600 });
    if (!buf) return new Response('not found', { status: 404 });
    return new Response(buf.slice(ent[2], ent[2] + ent[3]), { headers: { 'Content-Type': ent[1], 'Content-Security-Policy': THEME_CSP, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*' } });
  }

  if (path === '/themes' && request.method === 'GET') {
    const slugs = await listSlugs(env);
    const all = (await Promise.all(slugs.map((s) => env.XMAS.get(themeKey(s), 'json', { cacheTtl: 60 })))).filter(Boolean);
    const live = all.filter((t) => t.approved && !t.blocked && t.ver).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.approvedAt).localeCompare(String(b.approvedAt)));
    const use = await readUse(env);
    return out({ season: XMAS_SEASON, in_season: inSeason(), day: use.day,
      live: live.map((t) => ({ ...publicView(t), users_today: use.today[t.slug] || 0, users_total: use.total[t.slug] || 0 })),
      users_today_all: Object.values(use.today).reduce((a, b) => a + b, 0), builders: all.filter((t) => !t.blocked).length }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // HOW MANY USE WHICH TERMINAL (operator, 2026-11-17): the terminal says once a day per browser which theme it shows.
  // A count of browsers, never who: no address, no IP kept. Counts go into one value per day (a few lost under a burst
  // of simultaneous writes is the price of not holding anything about a visitor).
  if (path === '/use' && request.method === 'POST') {
    const b = await request.json().catch(() => null), slug = String(b?.slug || '');
    if (!/^[a-z0-9_-]{2,24}$/.test(slug)) return out({ ok: false }, 400);
    const t = await env.XMAS.get(themeKey(slug), 'json', { cacheTtl: 60 });
    if (!t || !t.approved || t.blocked) return out({ ok: false, counted: false });
    const day = new Date().toISOString().slice(0, 10), k = `xmas:use:${day}`;
    const m = (await env.XMAS.get(k, 'json')) || {};
    m[slug] = (m[slug] || 0) + 1;
    await env.XMAS.put(k, JSON.stringify(m), { expirationTtl: 90 * 86400 });
    const tot = (await env.XMAS.get('xmas:use:total', 'json')) || {};
    tot[slug] = (tot[slug] || 0) + 1;
    await env.XMAS.put('xmas:use:total', JSON.stringify(tot));
    return out({ ok: true, counted: true });
  }
  const one = path.match(/^\/theme\/([a-z0-9_-]{2,24})$/);
  if (one && request.method === 'GET') {
    const t = await env.XMAS.get(themeKey(one[1]), 'json', { cacheTtl: 60 });
    if (!t || t.blocked) return out({ error: 'no such theme' }, 404);
    return out({ season: XMAS_SEASON, theme: publicView(t) }, 200, { 'Cache-Control': 'public, max-age=30' });
  }

  if (path === '/join' && request.method === 'POST') {
    const b = await request.json().catch(() => null);
    const title = cleanText(b?.title, 48), builder = cleanText(b?.builder, 32), slug = slugOf(builder);
    if (!title) return out({ error: 'title: what is your terminal called?' }, 400);
    if (!builder || !slug) return out({ error: 'builder: your name as it should show (2-24 letters or digits)' }, 400);
    const ip = request.headers.get('cf-connecting-ip') || 'x', day = new Date().toISOString().slice(0, 10), ipKey = `xmas:join:${day}:${await sha(ip)}`;
    const n = Number(await env.XMAS.get(ipKey)) || 0;
    if (n >= XMAS_LIMITS.joinsPerIpPerDay) return out({ error: 'too many new builders from here today; try tomorrow' }, 429);
    const slugs = await listSlugs(env);
    if (slugs.length >= XMAS_LIMITS.themes) return out({ error: 'the workshop is full' }, 503);
    if (slugs.includes(slug)) return out({ error: `the name "${builder}" is taken; choose another` }, 409);
    // 32 characters from 62 by rejection (no modulo bias): about 190 bits
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'xk_';
    while (key.length < 35) for (const x of crypto.getRandomValues(new Uint8Array(48))) if (x < 248 && key.length < 35) key += A[x % 62];
    const now = new Date().toISOString();
    await env.XMAS.put(themeKey(slug), JSON.stringify({ slug, title, builder, ver: 0, files: [], created: now, updated: null, approved: false, uploads: {} }));
    await env.XMAS.put(keyKey(await sha(key)), JSON.stringify({ slug, created: now }));
    await env.XMAS.put('xmas:index', JSON.stringify([...slugs, slug]));
    await env.XMAS.put(ipKey, String(n + 1), { expirationTtl: 172800 });
    return out({ key, slug, title, builder, preview: `${SITE}/?xmas=${slug}`, note: 'Keep the key: it is you. The kit stores it in .xmas-key; never post it.' });
  }

  if (path === '/hello' && request.method === 'POST') {
    const r = await builderOf(request, env); if (r.error) return r.error;
    return out({ theme: publicView(r.t), season: XMAS_SEASON, limits: XMAS_LIMITS });
  }

  if (path === '/upload' && request.method === 'POST') {
    const r = await builderOf(request, env); if (r.error) return r.error;
    const t = r.t, day = new Date().toISOString().slice(0, 10);
    const used = Number(t.uploads?.[day]) || 0;
    if (used >= XMAS_LIMITS.uploadsPerDay) return out({ error: `${XMAS_LIMITS.uploadsPerDay} uploads today already; the dev page shows your changes without uploading` }, 429);
    const b = await request.json().catch(() => null);
    const p = packUpload(b?.files); if (p.error) return out({ error: p.error }, 400);
    const ver = (t.ver || 0) + 1;
    await env.XMAS.put(bundleKey(t.slug, ver), p.buf.buffer);
    const old = t.prevVer;
    const title = cleanText(b?.title, 48) || t.title;
    const next = { ...t, title, prevVer: t.ver || null, prevFiles: t.files || [], ver, files: p.index, bytes: p.total, updated: new Date().toISOString(), uploads: { [day]: used + 1 } };
    await env.XMAS.put(themeKey(t.slug), JSON.stringify(next));
    if (old) await env.XMAS.delete(bundleKey(t.slug, old)).catch(() => {});   // the version before the previous one
    return out({ ok: true, ver, files: p.index.length, bytes: p.total, preview: `${SITE}/?xmas=${t.slug}`, approved: !!t.approved,
      note: t.approved ? 'Approved: this version is what the terminal shows.' : 'Uploaded. The preview link shows it to anyone; the operator decides what goes live on 1 December.' });
  }

  if (path === '/admin' && request.method === 'POST') {
    if (!env.XMAS_ADMIN || request.headers.get('x-xmas-admin') !== env.XMAS_ADMIN) return out({ error: 'unauthorized' }, 401);
    const b = await request.json().catch(() => ({}));
    const slugs = await listSlugs(env);
    if (b.action === 'list') {
      const all = (await Promise.all(slugs.map((s) => env.XMAS.get(themeKey(s), 'json')))).filter(Boolean);
      return out({ themes: all.map((t) => ({ ...publicView(t), blocked: !!t.blocked, order: t.order ?? null, bytes: t.bytes || 0, files: (t.files || []).length, created: t.created })) });
    }
    const t = await env.XMAS.get(themeKey(String(b.slug || '')), 'json');
    if (!t) return out({ error: 'no such theme' }, 404);
    if (b.action === 'approve') { t.approved = true; t.approvedAt = new Date().toISOString(); if (Number.isFinite(b.order)) t.order = b.order; }
    else if (b.action === 'unapprove') t.approved = false;
    else if (b.action === 'block') { t.blocked = true; t.approved = false; }
    else if (b.action === 'unblock') t.blocked = false;
    else if (b.action === 'order') t.order = Number(b.order);
    else if (b.action === 'rename') { t.title = cleanText(b.title, 48) || t.title; }
    else return out({ error: 'action: list | approve | unapprove | block | unblock | order | rename' }, 400);
    await env.XMAS.put(themeKey(t.slug), JSON.stringify(t));
    return out({ ok: true, theme: { ...publicView(t), blocked: !!t.blocked, order: t.order ?? null } });
  }
  return out({ error: 'not found', see: 'POST /join, /hello, /upload, /use; GET /themes, /theme/<slug>' }, 404);
}
