#!/usr/bin/env node
// BOBAI Xmas Terminal kit — build your own Xmas look for the $BOBAI Brain Terminal (https://brainonbnb.com).
// No dependencies. Node 18 or newer.
//
//   npx https://brainonbnb.com/xmas/kit.tgz                     start: asks the terminal's name and the builder, makes your folder
//   npx https://brainonbnb.com/xmas/kit.tgz --title "Frosty Brain" --builder "your_name"   the same without questions (for agents)
//   node xmas.mjs dev        the real terminal on your machine with your folder in it; saved = shown
//   node xmas.mjs check      what the upload would refuse, before you upload
//   node xmas.mjs upload     your theme/ folder goes up; you get a preview link anyone can open
//   node xmas.mjs status     what is uploaded, and that it is on the switch from 1 December
//   node xmas.mjs image "<prompt>" --out theme/img/tree.webp      a picture with YOUR OpenAI key (OPENAI_API_KEY in .env)
//   node xmas.mjs video "<prompt>" --out theme/vid/sky.mp4        a clip with YOUR Google key (GEMINI_API_KEY in .env, Veo)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = process.env.BOBAI_XMAS_API || 'https://bobai-xmas.bobbuildonbnb.workers.dev';
const SANDBOX = process.env.BOBAI_XMAS_SANDBOX || 'https://xmas.bobai-dashboard.pages.dev';
const SITE = 'https://brainonbnb.com';
const LIMITS = { files: 300, fileBytes: 5 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 };
const TYPES = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', woff2: 'font/woff2', woff: 'font/woff', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream' };
// the same rules the live terminal serves your files with: try it here, it behaves there
const THEME_CSP = "sandbox allow-scripts; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; object-src 'none'; frame-ancestors 'self'";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const has = (n) => args.includes('--' + n);
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : null;
const say = (...a) => console.log(...a);
const die = (m) => { console.error('\n  ' + m + '\n'); process.exit(1); };
const slugOf = (name) => { const s = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24); return s.length >= 2 ? s : null; };

function project() {
  let d = process.cwd();
  for (let i = 0; i < 6; i++) { if (fs.existsSync(path.join(d, 'xmas.json'))) return d; const up = path.dirname(d); if (up === d) break; d = up; }
  return null;
}
function readProject(dir) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'xmas.json'), 'utf8'));
  const key = fs.existsSync(path.join(dir, '.xmas-key')) ? fs.readFileSync(path.join(dir, '.xmas-key'), 'utf8').trim() : null;
  return { cfg, key, theme: path.join(dir, 'theme') };
}
async function api(p, body, key) {
  const r = await fetch(API + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-xmas-key': key } : {}), 'user-agent': 'bobai-xmas-kit/1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'the workshop answered ' + r.status);
  return j;
}
const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a.trim()); }); });

// ---------------------------------------------------------------- start
async function init() {
  let title = flag('title'), builder = flag('builder');
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  say('\n  🎄  BOBAI Xmas Terminal kit\n  You build the Xmas look of the $BOBAI Brain Terminal: the surroundings and your own animations.\n  BOBAI himself and the standard terminal stay as they are.\n');
  if (!title || !builder) {
    if (!tty) die('Two answers are needed — ask your human, then run again with them:\n    --title "<what the terminal is called>"  --builder "<the builder\'s name as it shows>"');
    if (!title) title = await ask('  What should your terminal be called?  ');
    if (!builder) builder = await ask('  Who is the builder (your name as it shows on the terminal)?  ');
  }
  if (!slugOf(builder)) die('The builder name needs at least two letters or digits.');
  const dir = path.resolve(flag('dir') || 'bobai-xmas-' + slugOf(builder));
  if (fs.existsSync(path.join(dir, 'xmas.json'))) die(`${dir} is a kit folder already: cd into it and run  node xmas.mjs dev`);
  say('  Joining the workshop…');
  let j; try { j = await api('/join', { title, builder }); } catch (e) { die(e.message); }
  fs.mkdirSync(path.join(dir, 'theme'), { recursive: true });
  for (const f of ['back.html', 'front.html']) fs.copyFileSync(path.join(HERE, 'template', f), path.join(dir, 'theme', f));
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(dir, 'xmas.mjs'));
  const guide = fs.readFileSync(path.join(HERE, 'guide.md'), 'utf8').replaceAll('{{TITLE}}', j.title).replaceAll('{{BUILDER}}', j.builder).replaceAll('{{SLUG}}', j.slug).replaceAll('{{PREVIEW}}', j.preview);
  // every agent reads its own file first: the same guide in each
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', path.join('.github', 'copilot-instructions.md')]) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), guide); }
  fs.writeFileSync(path.join(dir, 'xmas.json'), JSON.stringify({ title: j.title, builder: j.builder, slug: j.slug, preview: j.preview, api: API, sandbox: SANDBOX }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, '.xmas-key'), j.key + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.gitignore'), '.xmas-key\n.env\nnode_modules\n');
  fs.writeFileSync(path.join(dir, '.env'), '# Your own AI keys, for: node xmas.mjs image / video. They stay on this machine (never uploaded).\nOPENAI_API_KEY=\nGEMINI_API_KEY=\n');
  say(`\n  ✅  "${j.title}" by ${j.builder} — your folder: ${dir}\n`);
  say('  Next, in that folder:');
  say('    node xmas.mjs dev       the real terminal with your theme in it (saved = shown)');
  say('    node xmas.mjs upload    send it up; you get a preview link to share');
  say('\n  Building with an AI agent (Claude Code, Codex, Cursor, Gemini…)? Open the folder with it:');
  say(`    cd "${path.relative(process.cwd(), dir) || '.'}"  &&  claude      — it reads CLAUDE.md / AGENTS.md and knows the rest.`);
  say('\n  Your key is in .xmas-key: it is you. Never share it or post it.\n');
}

// ---------------------------------------------------------------- the theme folder
function walk(root) {
  const out = [];
  const go = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) go(p); else if (e.isFile()) out.push(p); } };
  if (fs.existsSync(root)) go(root);
  return out;
}
function checkTheme(root) {
  const files = walk(root), problems = [], warnings = [];
  let total = 0;
  const rels = files.map((f) => path.relative(root, f).split(path.sep).join('/'));
  if (!rels.includes('back.html') && !rels.includes('front.html')) problems.push('theme/ needs back.html (behind BOBAI) or front.html (in front of him)');
  if (files.length > LIMITS.files) problems.push(`${files.length} files; at most ${LIMITS.files}`);
  files.forEach((f, i) => {
    const rel = rels[i], ext = (rel.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase(), size = fs.statSync(f).size;
    total += size;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(rel)) problems.push(`${rel}: use letters, digits, . _ - and / in file names`);
    if (!ext || !TYPES[ext]) problems.push(`${rel}: .${ext || '?'} is not served (html, css, js, json, images, video, fonts, glb)`);
    if (size > LIMITS.fileBytes) problems.push(`${rel}: ${(size / 1048576).toFixed(1)} MB; one file at most 5 MB`);
    if (/\.(html?|css|m?js)$/i.test(rel)) {
      const t = fs.readFileSync(f, 'utf8');
      const ext2 = t.match(/(?:src|href)\s*=\s*["']\s*(https?:)?\/\/[^"']+|url\(\s*["']?(https?:)?\/\//gi);
      if (ext2) warnings.push(`${rel}: loads from another site (${ext2[0].slice(0, 60)}…) — the terminal blocks it; put the file in theme/`);
      if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(t)) warnings.push(`${rel}: calls out (fetch/XHR/WebSocket) — blocked on the terminal; everything must be in theme/`);
      if (/\beval\s*\(|new\s+Function\s*\(|WebAssembly/.test(t)) warnings.push(`${rel}: eval / new Function / WebAssembly — blocked on the terminal`);
      if (/<audio|new\s+Audio\s*\(|AudioContext/.test(t)) warnings.push(`${rel}: sound — the terminal has none; it will not play`);
      if (/localStorage|sessionStorage|indexedDB|document\.cookie/.test(t)) warnings.push(`${rel}: storage/cookies — not available in the sandbox (it throws); keep state in variables`);
    }
  });
  if (total > LIMITS.totalBytes) problems.push(`${(total / 1048576).toFixed(1)} MB in all; at most 20 MB`);
  // NEVER A KEY IN AN UPLOAD: an API key (OpenAI, Google, any sk-/AIza- form) or the kit's own key in a file of theme/
  // stops the upload — whatever is uploaded can be read by anyone with the preview link
  const own = (() => { try { return fs.readFileSync(path.join(path.dirname(root), '.xmas-key'), 'utf8').trim(); } catch { return null; } })();
  files.forEach((f, i) => {
    if (!/\.(html?|css|m?js|json|txt|svg|gltf)$/i.test(rels[i])) return;
    const t = fs.readFileSync(f, 'utf8');
    if (/\bsk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}|\bAIza[0-9A-Za-z_-]{30,}|\bxk_[A-Za-z0-9]{32}\b|OPENAI_API_KEY\s*=\s*\S|GEMINI_API_KEY\s*=\s*\S/.test(t) || (own && t.includes(own)))
      problems.push(`${rels[i]}: contains what looks like an API key or your .xmas-key — never upload a key; keys stay in .env`);
  });
  return { files, rels, total, problems, warnings };
}

async function check(dir) {
  const { theme } = readProject(dir), c = checkTheme(theme);
  say(`\n  theme/: ${c.files.length} files, ${(c.total / 1024).toFixed(0)} KB`);
  for (const w of c.warnings) say('  ⚠  ' + w);
  for (const p of c.problems) say('  ✗  ' + p);
  if (!c.problems.length) say('  ✓  ready to upload');
  say('');
  return c;
}

async function upload(dir) {
  const { cfg, key, theme } = readProject(dir);
  if (!key) die('No .xmas-key in this folder. Run the start command again in a new folder, or put your key back.');
  const c = await check(dir); if (c.problems.length) die('Not uploaded: fix the ✗ lines first.');
  say('  Uploading…');
  const files = c.files.map((f, i) => ({ path: c.rels[i], b64: fs.readFileSync(f).toString('base64') }));
  let j; try { j = await api('/upload', { files, title: has('title') ? flag('title') : undefined }, key); } catch (e) { die(e.message); }
  say(`\n  ✅  version ${j.ver} is up (${j.files} files, ${(j.bytes / 1024).toFixed(0)} KB)\n  Preview, anyone can open it:  ${j.preview}\n  ${j.note}\n`);
}

async function status(dir) {
  const { key } = readProject(dir);
  let j; try { j = await api('/hello', {}, key); } catch (e) { die(e.message); }
  const t = j.theme;
  say(`\n  "${t.title}" by ${t.builder}\n  uploaded: ${t.ver ? 'version ' + t.ver + ', ' + t.updated : 'nothing yet'}\n  on the terminal's switch from 1 December: ${t.live ? 'yes, under your name' : t.ver ? 'no (stopped by the operator)' : 'after your first upload'}\n  preview: ${t.preview}\n`);
}

// ---------------------------------------------------------------- dev: the sandbox page, mirrored, with your folder in it
async function dev(dir) {
  const { cfg, theme } = readProject(dir);
  const port = Number(flag('port')) || 5199;
  const EMPTY = '<!doctype html><meta charset="utf-8"><title></title>';
  let ver = 0, sig = '';
  const scan = () => { try { const s = walk(theme).map((f) => { const st = fs.statSync(f); return f + st.size + ':' + st.mtimeMs; }).join('|'); if (s !== sig) { sig = s; ver++; } } catch {} };
  scan(); setInterval(scan, 600);
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname.startsWith('/__theme/')) {
        if (u.pathname === '/__theme/__version') { res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); return res.end(String(ver)); }
        const rel = decodeURIComponent(u.pathname.slice('/__theme/'.length));
        const file = path.resolve(theme, rel);
        if (!file.startsWith(path.resolve(theme) + path.sep)) { res.writeHead(404); return res.end(); }
        const ext = (rel.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
        const headers = { 'content-security-policy': THEME_CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
        if (!fs.existsSync(file)) { if (/^(back|front)\.html$/.test(rel)) { res.writeHead(200, { ...headers, 'content-type': TYPES.html }); return res.end(EMPTY); } res.writeHead(404, headers); return res.end(); }
        if (!ext || !TYPES[ext]) { res.writeHead(415, headers); return res.end('not a kind of file the terminal serves'); }
        res.writeHead(200, { ...headers, 'content-type': TYPES[ext] }); return res.end(fs.readFileSync(file));
      }
      // everything else: the sandbox page itself, fetched for you
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
      const up = await fetch(SANDBOX + u.pathname + u.search, { method: req.method, redirect: 'manual', body, headers: { accept: req.headers.accept || '*/*', 'content-type': req.headers['content-type'] || '', 'user-agent': 'bobai-xmas-kit-dev/1' } });
      const h = {};
      up.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'strict-transport-security', 'alt-svc'].includes(k)) h[k] = v; });
      if (h['content-security-policy']) h['content-security-policy'] = h['content-security-policy'].replace(/;\s*upgrade-insecure-requests/g, '');
      if (h.location) h.location = h.location.replace(SANDBOX, `http://127.0.0.1:${port}`);
      res.writeHead(up.status, h); res.end(Buffer.from(await up.arrayBuffer()));
    } catch (e) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('the sandbox page could not be reached: ' + e.message); }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/?xmas-dev=1`;
    say(`\n  🎄  "${cfg.title}" by ${cfg.builder} — dev\n  Open:  ${url}\n  Your folder theme/ is in the terminal; save a file and it shows. Ctrl+C stops.\n`);
    if (!has('no-open')) { const o = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]; try { spawn(o[0], o[1], { stdio: 'ignore', detached: true }).unref(); } catch {} }
  });
  server.on('error', (e) => die(e.code === 'EADDRINUSE' ? `Port ${port} is busy: node xmas.mjs dev --port ${port + 1}` : e.message));
}

// ---------------------------------------------------------------- pictures and clips, with the builder's own keys
// The same way the BOBAI terminal's own pictures and clips are made: OpenAI's image models (transparent PNG/WebP, a
// reference picture for a matching set) and Google's Veo (a clip from a prompt, optionally from a first and a last
// frame). Your keys, your credits: they are read from .env in this folder (or the environment) and sent only to OpenAI
// or Google — never to the terminal, never into theme/.
function env(name) {
  if (process.env[name]) return process.env[name];
  const dir = project(); if (!dir) return null;
  try { for (const l of fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, ''); } } catch {}
  return null;
}
const promptArg = () => args.slice(1).find((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
function outPath(dir, def) {
  const o = path.resolve(dir, flag('out') || def);
  if (!o.startsWith(path.join(dir, 'theme') + path.sep)) die('--out must be inside theme/ (e.g. --out theme/img/tree.webp)');
  fs.mkdirSync(path.dirname(o), { recursive: true });
  return o;
}
async function image(dir) {
  const key = env('OPENAI_API_KEY'); if (!key) die('No OPENAI_API_KEY: put a line OPENAI_API_KEY=sk-… into .env in this folder (your own key, your credits).');
  const prompt = promptArg(); if (!prompt) die('node xmas.mjs image "<what to draw>" --out theme/img/name.webp [--size 1024x1024|1536x1024|1024x1536] [--quality low|medium|high] [--opaque] [--ref theme/img/other.png] [--model …]');
  const out = outPath(dir, 'theme/img/image-' + Date.now() + '.webp');
  const fmt = /\.png$/i.test(out) ? 'png' : /\.jpe?g$/i.test(out) ? 'jpeg' : 'webp';
  const opaque = has('opaque') || fmt === 'jpeg', size = flag('size') || '1024x1024', quality = flag('quality') || 'medium';
  const ref = flag('ref');
  const models = flag('model') ? [flag('model')] : [env('OPENAI_IMAGE_MODEL') || 'gpt-image-2', 'gpt-image-1'];
  for (const model of [...new Set(models)]) {
    say(`  ${model} · ${size} · ${quality}${opaque ? '' : ' · transparent'}${ref ? ' · from ' + ref : ''} …`);
    let r;
    if (ref) {
      const fd = new FormData(); fd.append('model', model); fd.append('prompt', prompt); fd.append('size', size); fd.append('quality', quality);
      fd.append('background', opaque ? 'opaque' : 'transparent'); fd.append('output_format', fmt); fd.append('n', '1');
      fd.append('image[]', new Blob([fs.readFileSync(path.resolve(dir, ref))], { type: /\.webp$/i.test(ref) ? 'image/webp' : /\.jpe?g$/i.test(ref) ? 'image/jpeg' : 'image/png' }), path.basename(ref));
      r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
    } else {
      r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, size, quality, background: opaque ? 'opaque' : 'transparent', output_format: fmt, n: 1 }) });
    }
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.data?.[0]?.b64_json) { fs.writeFileSync(out, Buffer.from(j.data[0].b64_json, 'base64')); return say(`  ✅  ${path.relative(dir, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`); }
    const msg = j.error?.message || 'OpenAI answered ' + r.status;
    if (models.length > 1 && /model/i.test(msg) && model !== models[models.length - 1]) { say('  ' + msg + ' — trying the next model'); continue; }
    die(msg);
  }
}
async function video(dir) {
  const key = env('GEMINI_API_KEY'); if (!key) die('No GEMINI_API_KEY: put a line GEMINI_API_KEY=AIza… into .env in this folder (your own Google AI Studio key, your credits).');
  const prompt = promptArg(); if (!prompt) die('node xmas.mjs video "<what happens>" --out theme/vid/name.mp4 [--image first.png] [--last last.png] [--ratio 16:9|9:16] [--secs 8] [--model veo-3.1-fast-generate-preview]');
  const out = outPath(dir, 'theme/vid/video-' + Date.now() + '.mp4');
  const model = flag('model') || env('VEO_MODEL') || 'veo-3.1-fast-generate-preview', API = 'https://generativelanguage.googleapis.com/v1beta';
  const img = (p) => ({ bytesBase64Encoded: fs.readFileSync(path.resolve(dir, p)).toString('base64'), mimeType: /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.webp$/i.test(p) ? 'image/webp' : 'image/png' });
  const inst = { prompt, ...(flag('image') ? { image: img(flag('image')) } : {}), ...(flag('last') ? { lastFrame: img(flag('last')) } : {}) };
  const body = { instances: [inst], parameters: { aspectRatio: flag('ratio') || '16:9', durationSeconds: Number(flag('secs')) || 8, resolution: '720p' } };
  say(`  ${model} · ${body.parameters.aspectRatio} · ${body.parameters.durationSeconds} s … (a clip takes one to a few minutes)`);
  const r = await fetch(`${API}/models/${model}:predictLongRunning`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) die(j.error?.message || 'Google answered ' + r.status);
  let s;
  for (;;) { await new Promise((ok) => setTimeout(ok, 10000)); s = await (await fetch(`${API}/${j.name}`, { headers: { 'x-goog-api-key': key } })).json().catch(() => ({})); if (s.error) die(s.error.message || 'Veo failed'); if (s.done) break; process.stdout.write('.'); }
  const uri = s.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) die('Veo returned no clip (filtered?): ' + JSON.stringify(s.response || {}).slice(0, 300));
  const v = await fetch(uri, { headers: { 'x-goog-api-key': key }, redirect: 'follow' });
  fs.writeFileSync(out, Buffer.from(await v.arrayBuffer()));
  say(`\n  ✅  ${path.relative(dir, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB) — Veo clips have sound: the terminal plays every video muted`);
}

// ---------------------------------------------------------------- which
const dir = project();
if (!cmd && !dir) await init();
else if (!dir) die('Run this inside your kit folder (the one with xmas.json), or start a new one:  npx https://brainonbnb.com/xmas/kit.tgz');
else if (cmd === 'dev') await dev(dir);
else if (cmd === 'check') { const c = await check(dir); process.exit(c.problems.length ? 1 : 0); }
else if (cmd === 'upload') await upload(dir);
else if (cmd === 'status') await status(dir);
else if (cmd === 'image') await image(dir);
else if (cmd === 'video') await video(dir);
else say('\n  node xmas.mjs dev | check | upload | status | image | video   — the guide for you and your agent: AGENTS.md\n');
