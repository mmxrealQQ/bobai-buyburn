// THE 20 NOV SWITCH IN THE TERMINAL (2026-11-19, operator: "at midnight everything must run correctly"): the front page
// at a moment of the address (?at=) — before the switch and after it — in the standard terminal and in the brainrot one.
//   node temp/newpage/qa/split1120.mjs <base url>
// After 20 Nov 00:01 UTC: three stations with 1% (BURN $BOBAI, BURN $BOB, CREATOR); the standard terminal shows only those;
// the brainrot stage keeps all six pictures, the three ended ones without their label (operator: "just take the label away").
// Before: six stations with today's split, none struck. Also: the phase the page reads, no script error.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.log('usage: node split1120.mjs <base url>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9400 + Math.floor(Math.random() * 90), prof = (process.env.TEMP || '/tmp') + '/bobai-prof-' + port;
{ const d = process.env.TEMP || '/tmp'; try { for (const n of fs.readdirSync(d)) if (n.startsWith('bobai-prof-') && Date.now() - fs.statSync(d + '/' + n).mtimeMs > 36e5) fs.rmSync(d + '/' + n, { recursive: true, force: true }); } catch {} }
process.on('exit', () => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} });
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.slice(0, 160) || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr })).result?.result?.value;
let fail = 0; const pin = (ok, what, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? ' — ' + String(d).slice(0, 260) : ''}`); };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const read = () => ev(`JSON.stringify([...document.querySelectorAll('#bt .lab.dest')].map(e => ({ n: e.querySelector('.n')?.firstChild?.textContent?.trim(), pc: e.querySelector('.pc')?.textContent, off: e.classList.contains('off'), seen: getComputedStyle(e).display !== 'none', vis: getComputedStyle(e).visibility, deco: getComputedStyle(e.querySelector('.n')).textDecorationLine, inView: (() => { const r = e.getBoundingClientRect(), w = document.getElementById('bt-win').getBoundingClientRect(), tabs = document.querySelector('#bt .tabs, #bt-mtabs, #bt .vtabs'); const tr = tabs && tabs.getBoundingClientRect(), floor = tr && tr.height > 0 ? tr.top : w.bottom; return r.width > 0 && r.left >= w.left - 2 && r.right <= w.right + 2 && r.top >= w.top && r.bottom <= floor + 2; })() })))`);
const OUT = process.env.SHOTS || (process.env.TEMP || '.');
for (const [at, rot] of [['2026-11-20T00:02:00Z', false], ['2026-11-20T00:02:00Z', true], ['2026-11-19T23:58:00Z', false]]) {
  // brainrot is remembered per browser (bt-br); set it on the origin, then load the moment
  await send('Page.navigate', { url: base + '/robots.txt' }); await sleep(1200);
  await ev(`localStorage.setItem('bt-br', '${rot ? '1' : '0'}'); localStorage.setItem('bt-br-asked', '1'); true`);
  errs.length = 0;
  await send('Page.navigate', { url: `${base}/?at=${at}${rot ? '&br=1' : ''}` }); await sleep(11000);
  const L = JSON.parse((await read()) || '[]'), tag = `${at.slice(5, 16)} ${rot ? 'rot' : 'standard'}`;
  const ph = await ev(`(() => { const p = window.__bobaiPhase && window.__bobaiPhase(); return p ? [p.name || p.key || '', p.bobaiPct, p.bobPct, p.liqPct, p.lpPct, p.gigglePct, p.creatorPct].join(' / ') : null; })()`);
  const on = await ev(`document.getElementById('bt-win').classList.contains('br-on')`);
  pin(on === rot, `${tag}: the terminal is in the ${rot ? 'brainrot' : 'standard'} look`, `br-on ${on}`);
  const by = Object.fromEntries(L.map((x) => [x.n || '', x]));
  const get = (rx) => L.find((x) => rx.test(x.n || ''));
  const A = get(/BURN \$BOBAI/), B = get(/BURN \$BOB$/), C = get(/CREATOR/), LQ = get(/LIQ|BOOST/), DF = get(/DEFI/), GG = get(/GIGGLE/);
  if (at.startsWith('2026-11-20')) {
    pin(/1/.test(String(ph)), `${tag}: the page reads the standard 1/1/1 phase`, ph);
    pin([A, B, C].every((x) => x && x.seen && !x.off && x.pc === '1%'), `${tag}: BURN $BOBAI, BURN $BOB and CREATOR show 1%`, JSON.stringify([A, B, C]));
    if (!rot) pin([LQ, DF, GG].every((x) => x && !x.seen), `${tag}: the three ended stations are gone`, JSON.stringify([LQ, DF, GG]));
    else { const st = await ev("document.querySelectorAll('#bt .br-st').length");
      pin([LQ, DF, GG].every((x) => x && x.off && x.vis === 'hidden') && [A, B, C].every((x) => x.vis !== 'hidden') && st >= 7, `${tag}: the three ended stations keep their pictures (${st} on stage), their labels are gone`, JSON.stringify([LQ, DF, GG].map((x) => x && [x.n, x.vis]))); }
  } else {
    pin(L.length === 6 && L.every((x) => x.seen && !x.off) && A?.pc === '0.8%' && C?.pc === '0.8%', `${tag}: before the switch, six stations with today's split, none struck`, JSON.stringify(L.map((x) => x.n + ' ' + x.pc)));
  }
  fs.writeFileSync(`${OUT}/split1120-${at.slice(5, 10)}-${rot ? 'rot' : 'std'}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  pin(!errs.length, `${tag}: no script error`, errs.join(' | '));
}
console.log(fail ? `\n${fail} FAIL` : '\nall PASS');
ws.close(); ch.kill(); await sleep(600);
