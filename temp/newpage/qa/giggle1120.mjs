// (giggle1120, 2026-11-09) The Giggle Academy donation day: no surface may say "donated" before the donation's
// transaction stands in /giggle-donation.json, and once it does, Classic's #giggle card says so with the tx as a link.
// The clock is moved in the page (Date shifted), the donation file is answered by this script (empty, or with a tx).
// Three cases: today (collecting), Nov 20 08:00 UTC with the file empty, the same with a tx. Classic and the Brain page.
// Usage: node giggle1120.mjs [origin]
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9760 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-gg-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; let donation = null, served = 0;
const TX = '0x' + '7a'.repeat(32);
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; return; }
  if (d.method === 'Fetch.requestPaused') { served++;
    const body = Buffer.from(JSON.stringify(donation || { tx: null, bnb: null, time: null })).toString('base64');
    ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body } })); }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*giggle-donation.json*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let script = null;
async function at(iso) {
  if (script) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
  script = iso ? (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const D = Date, off = Date.parse('${iso}') - D.now();
    class S extends D { constructor(...a) { a.length ? super(...a) : super(D.now() + off); } static now() { return D.now() + off; } }
    globalThis.Date = S; })();` })).result?.identifier : null;
}
const CARD = `(() => { const c = document.getElementById('giggle'); const p = document.getElementById('gg-phase'), l = document.getElementById('gg-cd-label');
  return { card: c ? c.innerText : '', phase: p ? p.textContent : null, label: l ? l.textContent : null, link: p && p.querySelector('a') ? p.querySelector('a').href : null }; })()`;
const CASES = [
  ['today', null, null],
  ['Nov 20 08:00, file empty', '2026-11-20T08:00:00Z', null],
  ['Nov 20 08:00, tx in the file', '2026-11-20T08:00:00Z', { tx: TX, bnb: '0.976', time: '2026-11-20T08:00:00Z' }],
];
for (const [name, iso, dn] of CASES) {
  await at(iso); donation = dn; served = 0;
  await send('Page.navigate', { url: base + '/classic?r=' + Date.now() }); await sleep(8000);
  const r = await ev(CARD);
  if (!r || r.phase == null) { say(false, `${name}: Classic has no #gg-phase`); continue; }
  if (!iso) say(/until collecting ends/.test(r.label) && /collecting now/.test(r.phase) && !/donated Nov|on its way/.test(r.phase), `${name}: Classic "${r.label}" / "${r.phase}"`);
  else if (!dn) say(served > 0 && r.label === 'collecting ended' && /on its way/.test(r.phase) && !/donated/i.test(r.phase + ' ' + r.label) && !r.link, `${name}: Classic "${r.label}" / "${r.phase}" (file read ${served}x)`);
  else say(/^donated Nov 20 · 0\.976 BNB · tx 0x7a7a…7a7a$/.test(r.phase) && r.link === 'https://bscscan.com/tx/' + TX && r.label === 'donated to Giggle Academy', `${name}: Classic "${r.label}" / "${r.phase}" -> ${r.link}`);
}
// the Brain page (front page, terminal inside): the Giggle line in the terminal's scene
for (const [name, iso, dn] of CASES.slice(1)) {
  await at(iso); donation = dn;
  await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(12000);
  // the 05 card's line rotates through its goals: read it for a while and keep every Giggle line seen
  let t = ''; const seen = new Set();
  for (let i = 0; i < 8; i++) { const x = await ev(`document.body.innerText`) || ''; t += '\n' + x; x.split('\n').filter((l) => /giggle pot/i.test(l)).forEach((l) => seen.add(l.trim())); await sleep(2500); }
  const lines = [...seen].slice(0, 6);
  if (!dn) say(lines.some((l) => /on its way to Giggle Academy/.test(l)) && !/donated to Giggle Academy|donated Nov 20| 0 d left/i.test(t), `${name}: Brain page says on its way, nothing donated — ${JSON.stringify(lines)}`);
  else say(lines.some((l) => /donated to Giggle Academy/.test(l)) && !/on its way| 0 d left/.test(t), `${name}: Brain page says donated — ${JSON.stringify(lines)}`);
}
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
