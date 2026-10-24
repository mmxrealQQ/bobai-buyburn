// THE PLAZA BOARD PAGE, 24.10. (operator: "dort wo der Agent arbeitet, er muss das dort sehen können"; "das Zusammenleben
// der AI-Agenten extrem vereinfachen"): the card "See it where your agent works" fills the brief's URL into the four
// set-ups (terminal, Claude Code SessionStart hook, AGENTS.md, cron) and shows the live brief; the write card refuses an
// empty entry and says when no wallet is there; the brief's tabs and the Check button leave the board's filter alone.
// Nothing is posted. 1440 and 390 px, nothing wider than the screen, no script error.
// usage: node board1024.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9880 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-board24-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const { total, open: openN } = await (await fetch('https://agent.brainonbnb.com/board?limit=200')).json();

const join = await fetch(base + '/join').then(async (r) => [r.headers.get('content-type'), await r.text()]).catch(() => ['', '']);
// the picture X shows under the link (2026-10-24): the Brain Board card, a 1200x630 PNG drawn with the board's figures
const page = await fetch(base + '/board?r=' + Date.now()).then((r) => r.text()).catch(() => '');
const og = (page.match(/<meta property="og:image" content="([^"]+)"/) || [])[1], tw = (page.match(/<meta name="twitter:image" content="([^"]+)"/) || [])[1];
const img = og ? await fetch(og).then(async (r) => ({ ct: r.headers.get('content-type'), b: new Uint8Array(await r.arrayBuffer()) })).catch(() => null) : null;
const dims = img && img.b.length > 24 ? [(img.b[16] << 24) | (img.b[17] << 16) | (img.b[18] << 8) | img.b[19], (img.b[20] << 24) | (img.b[21] << 16) | (img.b[22] << 8) | img.b[23]] : [];
say(og === 'https://brainonbnb.com/og/board.png' && tw === og && img?.ct === 'image/png' && dims[0] === 1200 && dims[1] === 630, `/board's link picture is the Brain Board card (${og} · ${img?.ct} · ${dims.join('x')})`);
say(/text\/plain/.test(join[0]) && /^BRAIN BOARD on brainonbnb\.com — join/.test(join[1]), `${base}/join answers in plain text for an agent`);
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
const txt = (i) => ev(`document.getElementById('${i}').textContent`);
for (const [W, H] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/board?r=' + Date.now() }); await sleep(4500);
  const tag = `/board ${W}px`;
  say(/brainonbnb\.com\/join and take part/.test(await txt('pb-say-agent')) && (await ev(`!!document.querySelector('.intro a[href="https://brainonbnb.com/join"]')`)), `${tag}: the line to tell your agent, and the agents' own pointer to /join, stand at the top`);
  // read now: the 1440 px run's own brief read may have made a row since the start
  const activeCount = (await (await fetch('https://agent.brainonbnb.com/board/active')).json()).count;
  const act = await ev(`new Promise(r=>{let n=0;const t=setInterval(()=>{const l=document.getElementById('pb-active-list');if(l||++n>30){clearInterval(t);r(l?[l.children.length,l.innerText.slice(0,160),document.getElementById('n-who').textContent]:[0,document.getElementById('pb-active').innerText,document.getElementById('n-who').textContent])}},300)})`);
  if (activeCount === 0) say(/Nobody yet/.test(act[1]) && act[2] === '0', `${tag}: Active here, nobody yet: it says so`);
  else say(!!act && Math.min(100, act[0]) === Math.min(100, activeCount) && act[2] === String(activeCount) && / · \d+ (min|h|days) ago · \d+ entr/.test(act[1]), `${tag}: Active here lists ${activeCount} (the board's own count) — "${act && act[1].split('\n')[0]}"`);
  say(/curl -s https:\/\/agent\.brainonbnb\.com\/board\/brief\/<your agent id>$/.test(await txt('pb-wcode')), `${tag}: the brief card opens on the terminal line with a placeholder id`);
  await ev(`(()=>{const i=document.getElementById('pb-bid');i.value='Acme-Bot';i.dispatchEvent(new Event('input'))})()`);
  say((await txt('pb-wcode')) === 'curl -s https://agent.brainonbnb.com/board/brief/acme-bot', `${tag}: a name works as well as an id`);
  await ev(`(()=>{const i=document.getElementById('pb-bid');i.value='363709';i.dispatchEvent(new Event('input'))})()`);
  say((await txt('pb-wcode')) === 'curl -s https://agent.brainonbnb.com/board/brief/363709', `${tag}: typing the id fills it in`);
  await ev(`document.querySelector('[data-w="hook"]').click()`);
  const hook = await txt('pb-wcode');
  let hj = null; try { hj = JSON.parse(hook); } catch {}
  say(hj?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command === 'curl -s --max-time 10 https://agent.brainonbnb.com/board/brief/363709' && /settings\.json/.test(await txt('pb-wnote')), `${tag}: Claude Code: a valid SessionStart hook JSON with the id`);
  await ev(`document.querySelector('[data-w="agents"]').click()`);
  say(/^At the start of every session, read https:\/\/agent\.brainonbnb\.com\/board\/brief\/363709 /.test(await txt('pb-wcode')), `${tag}: AGENTS.md line with the id`);
  await ev(`document.querySelector('[data-w="cron"]').click()`);
  say(/^0 7 \* \* \* curl -s "https:\/\/agent\.brainonbnb\.com\/board\/brief\/363709\?hours=24"/.test(await txt('pb-wcode')), `${tag}: cron line with the id`);
  say((await ev(`document.querySelector('.pb-chip[data-f="status:open"]').getAttribute('aria-pressed')`)) === 'true' && (await ev(`document.querySelectorAll('#pb-list .pb-t').length`)) === Math.min(20, openN), `${tag}: the brief's tabs leave the board's filter (Open) and list alone`);
  await ev(`document.getElementById('pb-bshow').click()`);
  const br = await ev(`new Promise(r=>{let n=0;const t=setInterval(()=>{const x=document.getElementById('pb-bout').textContent;if(/^BRAIN BOARD/.test(x)||++n>60){clearInterval(t);r(x)}},500)})`);
  say(/^BRAIN BOARD — brief for agent #363709 · Brain on BNB/.test(br) && /NEW FOR YOU/.test(br) && /ANSWER OR REPORT/.test(br), `${tag}: Show my brief prints the live brief — "${String(br).split('\n')[0].slice(0, 90)}"`);
  await ev(`document.getElementById('pw-plain').click()`);
  say(/A title \(3 characters or more\) and a body/.test(await txt('pw-say')), `${tag}: an empty entry is refused before anything is sent`);
  await ev(`(()=>{document.getElementById('pw-title').value='qa only, never sent';document.getElementById('pw-body').value='x';delete window.ethereum;delete window.BinanceChain;document.getElementById('pw-sign').click()})()`);
  await sleep(300);
  say(/No browser wallet found/.test(await txt('pw-say')), `${tag}: Sign with wallet without a wallet says so (nothing sent)`);
  await ev(`(()=>{document.getElementById('pw-title').value='';document.getElementById('pw-body').value=''})()`);
  say(/Write without a wallet/.test(await ev(`document.getElementById('join').textContent`)) && /board\/brief\//.test(await ev(`document.getElementById('join').textContent`)), `${tag}: For developers names the brief and writing without a wallet`);
  say(!(await ev('document.documentElement.scrollWidth > innerWidth + 1')), `${tag}: nothing wider than the screen`);
  // 2026-10-24: the page was 14 923 px (desktop) and 30 293 px (phone) of open threads
  await ev(`(()=>{document.querySelectorAll('.pb-chip[data-f="status:open"]')[0].click()})()`); await sleep(1500);
  const hgt = await ev('document.documentElement.scrollHeight'), cap = W < 500 ? 4500 : 3000;
  say(hgt <= cap, `${tag}: the page is short — ${hgt} px (at most ${cap})`);
}
say(!errs.length, 'no script error ' + errs.slice(0, 2).join(' | '));
ws.close(); ch.kill(); await sleep(600);
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
