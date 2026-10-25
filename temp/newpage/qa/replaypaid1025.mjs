// (replaypaid1025, 2026-10-25, operator: "auch im Replay abspielen … die paid waren kurz aufeinander") REPLAY 24H on a
// fresh visit: when the replayed day holds an agent's payment, BOBAI plays his 'paid' take for it (live did already), and
// payments close together move him at most once in 20 s. Reads window.__btMoves (the move log), [secs, move, why].
// usage: node replaypaid1025.mjs [base]   exit 1 on FAIL; prints SKIP when the last 24 h hold no payment
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const buys = await fetch('https://agent.brainonbnb.com/buys').then((r) => r.json()).catch(() => null);
const since = Date.now() - 24 * 3600e3;
const paid = (buys?.payments || []).filter((p) => !p.self_test && Date.parse(p.at) >= since);
if (!paid.length) { console.log('SKIP  no outside payment in the last 24 h, nothing to replay'); process.exit(0); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9600 + Math.floor(Math.random() * 200), prof = import.meta.dirname + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(12000);
const start = JSON.parse(await ev('JSON.stringify((window.__btMoves||[]).length)'));
await ev("document.getElementById('bt-rp').click()");
let moves = [], logPaid = 0;
// to the replay's own end (as replay.mjs: #bt-live carries .rp while it runs), at most 420 s
for (let t = 0; t < 420; t += 3) {
  await sleep(3000);
  moves = JSON.parse(await ev('JSON.stringify((window.__btMoves||[]))')).slice(start);
  if (t > 10 && !(await ev("!!document.querySelector('#bt-live.rp')"))) break;
}
const p = moves.filter((m) => m[1] === 'paid');
const close = p.some((m, i) => i && m[0] - p[i - 1][0] < 20);
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
say(p.length >= 1, `the replay of the last 24 h (${paid.length} payment(s) in it) moves him with his paid take — moves seen: ${moves.map((m) => m[1]).join(' ') || 'none'}`);
say(!close, `payments close together move him at most once in 20 s (${p.map((m) => m[0]).join(', ')})`);
console.log(fails ? `FAIL  ${fails}` : 'PASS  paid plays in the replay');
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
process.exit(fails ? 1 : 0);
