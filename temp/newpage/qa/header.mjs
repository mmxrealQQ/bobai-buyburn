// The front page's header (2026-10-18, operator's decisions): the vision sentence in the small line under the name
// (desktop only, as the line was), on a phone "Buy $BOBAI" at the right edge. The "Classic" switch left on 18.10. and
// came back on 20.10. (operator: "the switch should be there, as long as it limits nothing"). Checks: the line's text,
// that it fits beside the ticker without touching it, the Classic switch inside the header between ticker and Buy,
// the Buy button's right edge at the phone's edge, nothing runs sideways; /classic still answers, /neu goes to /.
// usage: node header.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
const base = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9550 + Math.floor(Math.random() * 40), prof = process.cwd() + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
for (const [W, H, mob] of [[1440, 900, 0], [1024, 768, 0], [390, 844, 1]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: !!mob });
  await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(4500);
  const r = JSON.parse(await ev(`(()=>{const sm=document.querySelector('.bp-name small'),tk=document.querySelector('.bp-tick'),buy=document.querySelector('.bp-buy');
    const sw=document.querySelector('.bp-h a.bp-sw[href="/classic"]'),hd=document.querySelector('.bp-h'),s=sw&&sw.getBoundingClientRect(),h=hd&&hd.getBoundingClientRect();
    const a=sm&&sm.getBoundingClientRect(),t=tk&&tk.getBoundingClientRect(),b=buy&&buy.getBoundingClientRect();
    return JSON.stringify({text:sm?sm.textContent:'',shown:!!sm&&getComputedStyle(sm).display!=='none'&&a.width>0,smR:a?a.right:0,tkL:t&&t.width>0?t.left:null,
      classic:!!sw,swShown:!!sw&&s.width>0&&getComputedStyle(sw).display!=='none',swL:s?s.left:0,swR:s?s.right:0,swT:s?s.top:0,swB:s?s.bottom:0,hB:h?h.bottom:0,tkR:t&&t.width>0?t.right:0,buyL:b?b.left:0,buyR:b?b.right:0,vw:innerWidth,wide:document.documentElement.scrollWidth<=innerWidth+1})})()`));
  say(r.text === 'Built to stay. Every number checked, every tool for everyone.', `${W}: the small line is the vision sentence`);
  // 1180-1699 px gives the tagline's room to the buy line on purpose (brain.css, 2026-10-28): hidden there is right
  if (W >= 1180 && W <= 1699) say(!r.shown, `${W}: it gives its room to the buy line (hidden on purpose from 1180 to 1699 px)`);
  else if (W >= 901) say(r.shown && (r.tkL == null || r.smR <= r.tkL + 1), `${W}: it shows and ends before the ticker (${Math.round(r.smR)} / ${r.tkL == null ? 'no ticker' : Math.round(r.tkL)})`);
  else say(!r.shown, `${W}: hidden on a phone, as the line always was`);
  say(r.classic && r.swShown && r.swR <= r.buyL + 1 && (r.tkL == null || r.tkR <= r.swL + 1) && r.swT >= 0 && r.swB <= r.hB + 1, `${W}: the Classic switch shows before Buy, in the header, beside the ticker (${Math.round(r.swL)}-${Math.round(r.swR)} / Buy ${Math.round(r.buyL)})`);
  if (mob) say(r.vw - r.buyR <= 20, `${W}: Buy at the right edge (${Math.round(r.vw - r.buyR)} px from it)`);
  say(r.wide, `${W}: nothing runs sideways`);
}
ws.close(); ch.kill(); await sleep(800); try { (await import('node:fs')).rmSync(prof, { recursive: true, force: true }); } catch {}
const c = await fetch(base + '/classic', { redirect: 'manual' }), n = await fetch(base + '/neu', { redirect: 'manual' });
say(c.status === 200, `/classic still answers (${c.status})`);
say(n.status === 302 && (n.headers.get('location') || '').replace(base, '') === '/', `/neu goes to / (${n.status} ${n.headers.get('location')})`);
console.log(fails ? `FAIL  ${fails}` : 'PASS  the header carries the vision and the Classic switch');
process.exit(fails ? 1 : 0);
