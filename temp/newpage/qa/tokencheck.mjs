// BOBAI CHECKS A TOKEN (2026-11-19): the front page's check, in a real Chrome, wide and phone.
//   node temp/newpage/qa/tokencheck.mjs <base url>
// PASS needs, at 1280x900 and 390x844: the field is there (header button opens it on wide, a row on the phone), nothing
// wider than the screen, the terminal still fills the first screen on the phone, a check of CAKE draws a verdict card
// (gate + Get out + Tax rows), BOBAI's bubble says a line with the token's symbol, a wallet address answers "NO READING"
// in words, and no script error. Screenshots land in the scratch dir.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.log('usage: node tokencheck.mjs <base url>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9300 + Math.floor(Math.random() * 90), prof = (process.env.TEMP || '/tmp') + '/bobai-prof-' + port;
{ const d = process.env.TEMP || '/tmp'; try { for (const n of fs.readdirSync(d)) if (n.startsWith('bobai-prof-') && Date.now() - fs.statSync(d + '/' + n).mtimeMs > 36e5) fs.rmSync(d + '/' + n, { recursive: true, force: true }); } catch {} }
process.on('exit', () => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} });
const OUT = process.env.SHOTS || (process.env.TEMP || '.');
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.slice(0, 160) || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }); return r.result?.result?.value; };
let fail = 0; const pin = (ok, what, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? ' — ' + String(d).slice(0, 200) : ''}`); };
await send('Page.enable'); await send('Runtime.enable');
const waitFor = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(400); } return false; };
for (const [W, H, mob] of [[1280, 900, 0], [390, 844, 1]]) {
  errs.length = 0;
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: !!mob });
  await send('Page.navigate', { url: base + '/?calm' }); await sleep(8000);
  const s = `${W}px`;
  pin(await ev(`!!document.getElementById('bk-panel') && !!document.getElementById('bk-in')`), `${s}: the check is on the page`);
  pin(await ev(`document.documentElement.scrollWidth <= innerWidth`), `${s}: nothing wider than the screen`, await ev('document.documentElement.scrollWidth'));
  if (!mob) {
    pin(await ev(`getComputedStyle(document.getElementById('bk-panel')).display === 'none' && getComputedStyle(document.querySelector('.bp-chk-btn')).display !== 'none'`), `${s}: closed until the header's button is pressed`);
    await ev(`document.querySelector('.bp-chk-btn').click()`); await sleep(400);
    pin(await ev(`document.getElementById('bk-panel').classList.contains('open') && document.getElementById('bk-panel').getBoundingClientRect().right < innerWidth * 0.55`), `${s}: the button opens it over the left side, BOBAI stays in sight`, await ev(`JSON.stringify(document.getElementById('bk-panel').getBoundingClientRect())`));
  } else {
    pin(await ev(`(() => { const p = document.getElementById('bk-panel').getBoundingClientRect(), c = document.querySelector('.bp-center').getBoundingClientRect(); return p.height > 30 && p.height < 70 && c.bottom <= innerHeight + 2; })()`), `${s}: a row under the buy line, the terminal still ends inside the first screen`, await ev(`JSON.stringify([document.getElementById('bk-panel').getBoundingClientRect().height, document.querySelector('.bp-center').getBoundingClientRect().bottom, innerHeight])`));
  }
  // a check of CAKE, at $100
  await ev(`(() => { const i = document.getElementById('bk-in'); i.value = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'; document.getElementById('bk-form').requestSubmit(); })()`);
  const drawn = await waitFor(`!!document.querySelector('#bk-out .bk-head') && !document.querySelector('#bk-out .bk-wait')`, 90000);
  const card = await ev(`JSON.stringify({ gate: document.querySelector('#bk-out .bk-gate')?.textContent, sym: document.querySelector('#bk-out .bk-sym')?.textContent, rows: [...document.querySelectorAll('#bk-out .bk-k')].map(e => e.textContent) })`);
  const c = JSON.parse(card || '{}');
  pin(drawn && /STOP|WEIGH IT|NO KNOWN STOP|توقّف|فكّر فيه|لا مانع معروف/.test(c.gate || '') && (c.rows || []).some((r) => r === 'Get out' || r === 'الخروج') && (c.rows || []).some((r) => r === 'Tax' || r === 'الضريبة'), `${s}: CAKE draws a verdict card with Get out and Tax`, card);
  const said = await waitFor(`/cake/i.test(document.querySelector('#bt .say')?.textContent || '')`, 25000);
  pin(said, `${s}: BOBAI says the verdict in his bubble`, await ev(`document.querySelector('#bt .say')?.textContent`));
  fs.writeFileSync(`${OUT}/tokencheck-${W}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  // a wallet answers in words
  await ev(`(() => { const i = document.getElementById('bk-in'); i.value = '0x000000000000000000000000000000000000dEaD'; document.getElementById('bk-form').requestSubmit(); })()`);
  const no = await waitFor(`/NO READING|لا قراءة/.test(document.querySelector('#bk-out .bk-gate')?.textContent || '')`, 30000);
  pin(no && (await ev(`(document.querySelector('#bk-out .bk-msg')?.textContent || '').length > 10`)), `${s}: a wallet address answers NO READING in words`, await ev(`document.querySelector('#bk-out .bk-msg')?.textContent`));
  pin(!errs.length, `${s}: no script error`, errs.join(' | '));
}
console.log(fail ? `\n${fail} FAIL` : '\nall PASS');
ws.close(); ch.kill(); await sleep(600);
