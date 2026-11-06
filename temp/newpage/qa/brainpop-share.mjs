// BRAIN POP SHARE CHECK (2026-11-06, operator: "rank and score to share, with a totally crazy picture"). At each size:
//   1  the score chip carries SHARE, it takes a pointer only while the chip shows
//   2  SHARE opens the share menu with MY ROT RANK picked and a 1600x900 card; 4:5 gives 1080x1350
//   3  no console error, no failed terminal request
// usage: node brainpop-share.mjs [base=https://bobai-lab.pages.dev]   SIZES=1440x900,390x844m   SHOTS=<dir> (saves the cards)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const BASE = (process.argv[2] || 'https://bobai-lab.pages.dev').replace(/\/$/, '');
const SIZES = (process.env.SIZES || '1440x900,1280x720,1024x768,390x844m').split(',');
const SHOTS = process.env.SHOTS || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400), prof = path.join(import.meta.dirname, 'prof-' + port);
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}; let logs = [];
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 240));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 240));
  if (d.method === 'Network.responseReceived' && d.params.response.status >= 400 && /\/terminal\//.test(d.params.response.url)) logs.push('HTTP ' + d.params.response.status + ' ' + d.params.response.url.slice(0, 140)); };
const ev = async src => { const r = await send('Runtime.evaluate', { expression: src, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
let pass = 0, fail = 0;
const say = (ok, what, more = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
const waitFor = async (src, ms = 20000) => { for (let t = 0; t < ms; t += 400) { if (await ev(src)) return true; await sleep(400); } return false; };
const saveImg = async name => { if (!SHOTS || !(await ev(`!!document.querySelector('#bt-shm img').src`))) return; const b64 = await ev(`(()=>{const i=document.querySelector('#bt-shm img'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL('image/png').split(',')[1]})()`); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(b64, 'base64')); };
const SEL = `document.querySelector('#bt-shm img')`;
for (const sz of SIZES) {
  const mob = sz.endsWith('m'), [w, h] = sz.replace('m', '').split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mob });
  await send('Page.navigate', { url: BASE + '/robots.txt' }); await sleep(1500);
  await ev(`localStorage.setItem('bt-br-game', JSON.stringify({score:412,best:412,maxc:7})); localStorage.setItem('bt-br-pops','88'); 1`);
  logs = []; await send('Page.navigate', { url: BASE + '/?br=1&t=' + Date.now() });
  await waitFor(`!!document.querySelector('#bt .br-ask-yes')`, 40000); await ev(`document.querySelector('#bt .br-ask-yes')?.click(); 1`);
  await waitFor(`!!(window.__btBr && window.__btBr.on && window.__btBr.hud)`, 20000); await sleep(3000);
  const off = await ev(`(()=>{const b=document.querySelector('#bt .br-hud .br-shr');return b?getComputedStyle(b).pointerEvents:'none-missing'})()`);
  await ev(`window.__btBr?.hud?.(); 1`); await sleep(700);
  const onPE = await ev(`(()=>{const b=document.querySelector('#bt .br-hud .br-shr'),r=b&&b.getBoundingClientRect();return b?getComputedStyle(b).pointerEvents+'/'+Math.round(r.width)+'x'+Math.round(r.height)+'/'+(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b):'missing'})()`);
  say(off !== 'auto' && /^auto\/\d+x\d+\/true$/.test(onPE) && +onPE.split('/')[1].split('x')[0] >= 30, `${sz} rule 1: the chip's SHARE takes a pointer only while it shows`, off + ' · ' + onPE);
  await ev(`document.querySelector('#bt .br-hud .br-shr')?.click(); 1`);
  const opened = await waitFor(`document.querySelector('#bt-shm').classList.contains('on') && ${SEL}.naturalWidth > 0`, 25000);
  const wide = opened ? await ev(`(()=>{const i=${SEL},b=document.querySelector('#bt-shm [data-motif="rot"]');return JSON.stringify({w:i.naturalWidth,h:i.naturalHeight,rot:!!b&&!b.hidden&&b.classList.contains('on')})})()`) : '{}';
  const W1 = JSON.parse(wide), first = W1.w === 1080 ? 'tall' : 'wide'; /* the format follows the terminal window's shape (portrait at 1024 too) */ await saveImg('brainpop-wide-' + sz);
  await ev(`document.querySelector('#bt-shm [data-fmt="${first === 'tall' ? 'wide' : 'tall'}"]')?.click(); 1`);
  await waitFor(`${SEL}.naturalWidth === ${first === 'tall' ? 1600 : 1080}`, 20000); await sleep(400);
  const T1 = JSON.parse(await ev(`JSON.stringify({w:${SEL}.naturalWidth,h:${SEL}.naturalHeight})`)); await saveImg('brainpop-tall-' + sz);
  say(opened && W1.rot && [W1.w, W1.h, T1.w, T1.h].join() === (first === 'tall' ? '1080,1350,1600,900' : '1600,900,1080,1350'), `${sz} rule 2: SHARE opens MY ROT RANK, 16:9 and 4:5 cards`, JSON.stringify({ W1, T1 }));
  if (!opened) console.log('log:', await ev(`[...document.querySelectorAll('#bt-log .ln, #bt .log div')].slice(-6).map(e=>e.textContent).join(' | ')`));
  say(logs.length === 0, `${sz} rule 3: no console error, no failed terminal request`, logs.slice(0, 3).join(' | '));
}
console.log(`brainpop-share: ${pass} PASS, ${fail} FAIL`);
ws.close(); ch.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
