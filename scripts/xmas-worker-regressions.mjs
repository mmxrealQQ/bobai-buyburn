#!/usr/bin/env node
// The community Xmas terminal's worker (worker-xmas/xmas.js, 2026-11-17), offline with a stand-in KV: joining, the key,
// uploading, serving sandboxed, the operator's approval, counting users — and every way in that must stay shut.
//   node scripts/xmas-worker-regressions.mjs
import { handleXmas, THEME_CSP, checkPath, slugOf, XMAS_LIMITS } from '../worker-xmas/xmas.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

const store = new Map();
const KV = {
  async get(k, o) { const v = store.get(k); if (v == null) return null; const type = typeof o === 'string' ? o : o?.type; if (type === 'json') return JSON.parse(v); if (type === 'arrayBuffer') return v; return v; },
  async put(k, v) { store.set(k, v instanceof ArrayBuffer ? v.slice(0) : v); },
  async delete(k) { store.delete(k); },
};
const env = { XMAS: KV, XMAS_ADMIN: 'adm1n-secret' };
const call = async (method, path, { body, headers = {}, ip = '1.1.1.1' } = {}) => {
  const req = new Request('https://bobai-xmas.example' + path, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers }, body: body == null ? undefined : JSON.stringify(body) });
  const res = await handleXmas(req, env, new URL(req.url), path);
  const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: res.status, j, text, h: res.headers };
};
const b64 = (s) => Buffer.from(s).toString('base64');

// joining
let r = await call('POST', '/join', { body: { title: 'Frosty Brain', builder: 'mmx_qq' } });
const key = r.j?.key;
ok('join gives a key of 32 characters and the slug of the name', r.status === 200 && /^xk_[A-Za-z0-9]{32}$/.test(key || '') && r.j.slug === 'mmx_qq', JSON.stringify(r.j));
ok('the key is not kept in the clear', ![...store.keys()].some((k) => k.includes(key)) && ![...store.values()].some((v) => typeof v === 'string' && v.includes(key)));
r = await call('POST', '/join', { body: { title: 'Copy', builder: 'MMX_QQ' } });
ok('a name is taken once (case does not make it new)', r.status === 409);
r = await call('POST', '/join', { body: { title: '<script>x</script>', builder: 'b<img src=x>' } });
ok('markup in a title or a name is stripped, never stored', r.status === 200 && !/[<>]/.test(r.j.title + r.j.builder), JSON.stringify(r.j));
for (let i = 0; i < XMAS_LIMITS.joinsPerIpPerDay; i++) await call('POST', '/join', { body: { title: 't', builder: 'spam' + i }, ip: '9.9.9.9' });
r = await call('POST', '/join', { body: { title: 't', builder: 'spammore' }, ip: '9.9.9.9' });
ok(`at most ${XMAS_LIMITS.joinsPerIpPerDay} new builders from one address a day`, r.status === 429);

// the key
r = await call('POST', '/upload', { body: { files: [{ path: 'back.html', b64: b64('<p>x</p>') }] } });
ok('an upload without a key is refused', r.status === 401);
r = await call('POST', '/upload', { headers: { 'x-xmas-key': 'xk_' + 'A'.repeat(32) }, body: { files: [{ path: 'back.html', b64: b64('<p>x</p>') }] } });
ok('an upload with a made-up key is refused', r.status === 401);

// paths
ok('no way out of the folder', !!checkPath('../x.html').error && !!checkPath('a/../../x.js').error && !!checkPath('/etc/x.html').error && !!checkPath('a//b.png').error);
ok('no unknown kinds of file (no .exe, .php, .wasm, sound)', ['a.exe', 'a.php', 'a.wasm', 'a.mp3', 'a.html.', 'noext'].every((p) => !!checkPath(p).error));
ok('the usual kinds are served with their type', checkPath('img/snow.webp').type === 'image/webp' && checkPath('back.html').type.startsWith('text/html') && checkPath('m/tree.glb').type === 'model/gltf-binary');
ok('a name becomes an address: lower case, safe characters', slugOf('Binance Square') === 'binance-square' && slugOf('x') === null && slugOf('ÄÖ!!') === null);

// uploading
const html = '<!doctype html><html><body><script src="snow.js"></script></body></html>';
r = await call('POST', '/upload', { headers: { 'x-xmas-key': key }, body: { files: [{ path: 'back.html', b64: b64(html) }, { path: 'snow.js', b64: b64('console.log(1)') }] } });
ok('the builder uploads: version 1, preview link', r.status === 200 && r.j.ver === 1 && /\?xmas=mmx_qq$/.test(r.j.preview), JSON.stringify(r.j));
r = await call('POST', '/upload', { headers: { 'x-xmas-key': key }, body: { files: [{ path: 'style.css', b64: b64('a{}') }] } });
ok('a theme without back.html or front.html is refused', r.status === 400);
r = await call('POST', '/upload', { headers: { 'x-xmas-key': key }, body: { files: [{ path: 'back.html', b64: Buffer.alloc(XMAS_LIMITS.fileBytes + 1).toString('base64') }] } });
ok('a file over the limit is refused', r.status === 400);

// serving
r = await call('GET', '/t/mmx_qq/1/back.html');
ok('a file is served with its type', r.status === 200 && r.text === html && r.h.get('content-type').startsWith('text/html'));
const csp = r.h.get('content-security-policy') || '';
ok('… sandboxed: its own CSP opens it in an opaque origin (no cookies, storage, page), scripts only', /^sandbox allow-scripts;/.test(csp) && !/allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/.test(csp));
ok('… no calls out, no eval or WebAssembly, no workers, no frames, no forms, no plugins', /connect-src 'none'/.test(csp) && !/unsafe-eval|wasm/.test(csp) && /worker-src 'none'/.test(csp) && /frame-src 'none'/.test(csp) && /form-action 'none'/.test(csp) && /object-src 'none'/.test(csp));
ok('… and only our pages may frame it', /frame-ancestors https:\/\/brainonbnb\.com /.test(csp) && !/frame-ancestors[^;]*\*(\s|;|$)/.test(csp));
ok('… nosniff', r.h.get('x-content-type-options') === 'nosniff');
ok('the CSP the worker sends is the one pinned here', csp === THEME_CSP);
r = await call('GET', '/t/mmx_qq/1/..%2F..%2Fsecret.js');
ok('a path climbing out is not found', r.status === 404);
r = await call('GET', '/t/mmx_qq/7/back.html');
ok('a version that does not exist is not found', r.status === 404);

// the operator
r = await call('GET', '/themes');
ok('everyone is in (17.11.): an uploaded theme is on the list, one with nothing uploaded is not', r.status === 200 && r.j.live.length === 1 && r.j.live[0].slug === 'mmx_qq' && /\/t\/mmx_qq\/1\/$/.test(r.j.live[0].base) && r.j.live[0].users_today === 0, JSON.stringify(r.j.live.map((t) => t.slug)));
r = await call('GET', '/theme/mmx_qq');
ok('the preview link reads the theme', r.status === 200 && r.j.theme.ver === 1 && r.j.theme.layers.back === true && r.j.theme.layers.front === false);
r = await call('POST', '/admin', { headers: { 'x-xmas-admin': 'wrong' }, body: { action: 'block', slug: 'mmx_qq' } });
ok('blocking needs the operator secret', r.status === 401);
r = await call('POST', '/admin', { headers: { 'x-xmas-admin': 'adm1n-secret' }, body: { action: 'approve', slug: 'mmx_qq' } });
ok('there is no approving any more', r.status === 400);

// counting users
await call('POST', '/use', { body: { slug: 'mmx_qq' } }); await call('POST', '/use', { body: { slug: 'mmx_qq' } });
r = await call('POST', '/use', { body: { slug: 'spam0' } });
ok('a theme with nothing uploaded is not counted', r.j?.counted === false);
r = await call('GET', '/themes');
ok('users today and in all', r.j.live[0].users_today === 2 && r.j.live[0].users_total === 2 && r.j.users_today_all === 2);
ok('the count holds no address', ![...store.entries()].some(([k, v]) => k.startsWith('xmas:use') && /1\.1\.1\.1|9\.9\.9\.9/.test(String(v))));

// blocking
await call('POST', '/admin', { headers: { 'x-xmas-admin': 'adm1n-secret' }, body: { action: 'block', slug: 'mmx_qq' } });
const g = await call('GET', '/t/mmx_qq/1/back.html'), l = await call('GET', '/themes'), u = await call('POST', '/upload', { headers: { 'x-xmas-key': key }, body: { files: [{ path: 'back.html', b64: b64('x') }] } });
ok('blocked: its files are gone, it leaves the list, its key uploads nothing', g.status === 404 && l.j.live.length === 0 && u.status === 403);

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
