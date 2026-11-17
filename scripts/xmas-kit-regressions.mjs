#!/usr/bin/env node
// The community Xmas terminal (2026-11-17): the kit (xmas-kit/) and the terminal's frame layer, offline.
//   node scripts/xmas-kit-regressions.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

// --- the kit's check, on a folder made here
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xmkit-'));
fs.mkdirSync(path.join(tmp, 'theme'));
fs.writeFileSync(path.join(tmp, 'xmas.json'), JSON.stringify({ title: 'T', builder: 'b', slug: 'b' }));
fs.writeFileSync(path.join(tmp, '.xmas-key'), 'xk_' + 'Q'.repeat(32));
fs.copyFileSync(path.join(ROOT, 'xmas-kit', 'xmas.mjs'), path.join(tmp, 'xmas.mjs'));
const run = (...a) => spawnSync(process.execPath, ['xmas.mjs', ...a], { cwd: tmp, encoding: 'utf8', env: { ...process.env, BOBAI_XMAS_API: 'http://127.0.0.1:9' } });
const write = (f, t) => { fs.mkdirSync(path.dirname(path.join(tmp, 'theme', f)), { recursive: true }); fs.writeFileSync(path.join(tmp, 'theme', f), t); };
let r = run('check');
ok('an empty theme/ is not ready (back.html or front.html needed)', r.status === 1 && /back\.html/.test(r.stdout));
write('back.html', '<!doctype html><p>snow</p>');
r = run('check');
ok('a page alone is ready', r.status === 0 && /ready to upload/.test(r.stdout), r.stdout);
for (const [name, text] of [['an OpenAI key', 'const k = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345";'], ['a Google key', 'k="AIzaSyA1234567890abcdefghijklmnopqrstu"'], ['the kit key', 'xk_' + 'Q'.repeat(32)], ['a .env line', 'OPENAI_API_KEY=sk-x']]) {
  write('leak.js', text); r = run('check');
  ok(`${name} in a file stops the upload`, r.status === 1 && /API key or your \.xmas-key/.test(r.stdout), r.stdout);
}
fs.rmSync(path.join(tmp, 'theme', 'leak.js'));
write('a.js', 'fetch("https://x.example"); eval("1"); localStorage.x=1; new Audio("a.mp3")');
r = run('check');
ok('calls out, eval, storage and sound are warned about', /calls out/.test(r.stdout) && /eval/.test(r.stdout) && /storage/.test(r.stdout) && /sound/.test(r.stdout));
write('x.exe', 'MZ'); r = run('check');
ok('an unknown kind of file is not ready', r.status === 1 && /x\.exe/.test(r.stdout));
fs.rmSync(path.join(tmp, 'theme', 'x.exe'));
r = run('image', 'x', '--out', '../outside.webp');
ok('image/video write only into theme/', r.status === 1 && /(inside theme|OPENAI_API_KEY)/.test(r.stderr + r.stdout));
fs.rmSync(tmp, { recursive: true, force: true });

// --- the kit's files
const kit = fs.readFileSync(path.join(ROOT, 'xmas-kit', 'xmas.mjs'), 'utf8'), guide = fs.readFileSync(path.join(ROOT, 'xmas-kit', 'guide.md'), 'utf8');
ok('the dev server serves theme files with the live CSP (sandbox, no calls out)', /const THEME_CSP = "sandbox allow-scripts;[^"]*connect-src 'none'/.test(kit));
ok('… and refuses a path out of theme/', /if \(!file\.startsWith\(path\.resolve\(theme\) \+ path\.sep\)\)/.test(kit));
ok('the start keeps the key out of git and makes .env for the AI keys', /'\.xmas-key\\n\.env\\n/.test(kit) && /OPENAI_API_KEY=\\nGEMINI_API_KEY=/.test(kit));
ok('every agent finds the guide: AGENTS, CLAUDE, GEMINI, Cursor, Copilot', ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', 'copilot-instructions.md'].every((f) => kit.includes(f)));
ok('the guide names every message the terminal sends', ['hello', 'layout', 'event', 'moment', 'pose', 'mood', 'visible'].every((t) => guide.includes(`type: '${t}'`)));
ok('the guide gives the figure as "figure" (the key "bobai" is the marker)', /figure: \{ x, y, w, h \}/.test(guide) && !/^\s+bobai: \{ x/m.test(guide));
const tgz = path.join(ROOT, 'dashboard', 'xmas', 'kit.tgz');
ok('the served kit is the built one (kit.tgz exists)', fs.existsSync(tgz) && fs.statSync(tgz).size > 5000);

// --- the terminal's layer
const T = fs.readFileSync(path.join(ROOT, 'temp', 'terminal-site', 'terminal', 'terminal.js'), 'utf8'), C = fs.readFileSync(path.join(ROOT, 'temp', 'terminal-site', 'terminal', 'terminal.css'), 'utf8');
ok('a theme frame is sandboxed with scripts only', /f\.setAttribute\('sandbox', 'allow-scripts'\)/.test(T) && !/allow-same-origin/.test(T.slice(T.indexOf('COMMUNITY XMAS TERMINAL'))));
ok('the frames take no pointer events', /#bt \.xm\{[^}]*pointer-events:none/.test(C));
ok('back under BOBAI (z 1), front under every label and window (z 4)', /#bt \.xm-back\{z-index:1\}/.test(C) && /#bt \.xm-front\{z-index:4\}/.test(C));
ok('the dev folder loads only on 127.0.0.1 / localhost', /const devHost = \/\^\(127\\\.0\\\.0\\\.1\|localhost\)\$\/i\.test\(location\.hostname\)/.test(T));
ok('the marker is set last on every message (nothing overwrites it)', /\{ \.\.\.lay, bobai: 'xmas', v: 1 \}/.test(T) && /\.\.\.m, bobai: 'xmas', v: 1 \}/.test(T));
ok('the layout calls BOBAI "figure"', /figure: rel\(fig, r0\)/.test(T));
ok('a slow theme is put away (under 20 fps for 8 s)', /slowS = n < 20 \? slowS \+ 1 : 0/.test(T) && /if \(slowS >= 8\)/.test(T));
ok('the page listens to nothing a theme says', !/addEventListener\('message'/.test(T.slice(T.indexOf('COMMUNITY XMAS TERMINAL'))));
const H = fs.readFileSync(path.join(ROOT, 'dashboard', '_headers'), 'utf8');
ok('the page CSP lets in the theme worker and nothing else new', /frame-src 'self' https:\/\/bobai-xmas\.bobbuildonbnb\.workers\.dev;/.test(H) && /connect-src 'self' https:\/\/bobai-xmas\.bobbuildonbnb\.workers\.dev /.test(H));

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
