// (giggle1120, 2026-11-09; 2026-11-20 after the donation) The Giggle Academy donation day: no Brain page line may say
// "donated" before the donation's transaction stands in /giggle-donation.json; Classic's archive card carries that tx.
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
// SINCE THE DONATION (2026-11-20): the live card left Tokenomics for the archive (#giggle-done), its receipt written in
// the HTML. Classic is read with the REAL donation file: the archive card must link exactly that tx and say its amount,
// the old live card and its countdown must be gone, and no line may still say the pot is collecting or on its way.
const real = await (await fetch(base + '/giggle-donation.json?r=' + Date.now())).json();
const CASES = [
  ['Nov 20 08:00, file empty', '2026-11-20T08:00:00Z', null],
  ['Nov 20 08:00, tx in the file', '2026-11-20T08:00:00Z', { tx: TX, bnb: '0.976', time: '2026-11-20T08:00:00Z' }],
];
{
  await at(null); donation = real;
  await send('Page.navigate', { url: base + '/classic?r=' + Date.now() }); await sleep(9000);
  // the receipt's own links: the picture, its caption and the note (the sends table links each send, not the donation)
  const r = await ev(`(() => { const d = document.getElementById('giggle-done'), t = document.body.innerText; if (d) d.open = true;
    return { arch: !!d, links: d ? [...d.querySelectorAll('figure a, .lb-note a')].map((a) => a.href).filter((h) => h.includes('bscscan.com/tx/')) : [], text: d ? d.innerText : '',
      live: !!document.getElementById('giggle') || !!document.getElementById('gg-days'), stale: /collecting now|on its way to Giggle|until collecting ends/i.test(t),
      count: (document.getElementById('gg-count') || {}).textContent }; })()`);
  const amt = (+real.bnb).toFixed(4), url = 'https://bscscan.com/tx/' + real.tx;
  say(/^0x[0-9a-fA-F]{64}$/.test(real.tx || '') && +real.bnb > 0, `the donation file carries a tx and an amount (${real.tx && real.tx.slice(0, 10)}…, ${real.bnb})`);
  say(r && r.arch && r.links.length >= 2 && r.links.every((h) => h === url), `Classic archive card links only the donation tx (${r && r.links.length} links)`);
  say(r && r.text.includes(amt + ' BNB') && /donated to Giggle Academy/i.test(r.text), `Classic archive card says ${amt} BNB donated`);
  say(r && !r.live && !r.stale, `Classic: no live pot card, no "collecting" / "on its way" left (live ${r && r.live}, stale ${r && r.stale})`);
  say(r && +r.count > 0, `Classic archive card counts the sends (${r && r.count})`);
}
// the Brain page (front page, terminal inside): the Giggle line in the terminal's scene
for (const [name, iso, dn] of CASES) {
  await at(iso); donation = dn;
  await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(12000);
  // the 05 card's line rotates through its goals: read it for a while and keep every Giggle line seen
  let t = ''; const seen = new Set();
  for (let i = 0; i < 8; i++) { const x = await ev(`document.body.innerText`) || ''; t += '\n' + x; x.split('\n').filter((l) => /giggle pot/i.test(l)).forEach((l) => seen.add(l.trim())); await sleep(2500); }
  const lines = [...seen].slice(0, 6);
  if (!dn) say(lines.some((l) => /on its way to Giggle Academy/.test(l)) && !/donated to Giggle Academy|donated Nov 20| 0 d left/i.test(t), `${name}: Brain page says on its way, nothing donated — ${JSON.stringify(lines)}`);
  else say(lines.some((l) => /donated to Giggle Academy|Giggle pot: [\d.]+ BNB donated/.test(l)) && !/on its way| 0 d left/.test(t), `${name}: Brain page says donated — ${JSON.stringify(lines)}`);
}
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
