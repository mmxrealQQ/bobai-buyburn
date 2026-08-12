// Drives the live dashboard in headless Chrome: reads the depth panel at 1x,
// clicks each multiplier, and checks that (a) the trade figures change to the
// expected values, (b) the real pool tiles above do NOT move, (c) the
// hypothetical warning appears and disappears again.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const URL = 'https://brainonbnb.com/?probe=' + Math.floor(Math.random() * 1e9);

const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,1200', '--hide-scrollbars', '--no-first-run',
], { stdio: 'ignore' });

const wait = ms => new Promise(r => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {}
    await wait(300);
  }
  throw new Error('chrome did not come up');
}

const ws = new WebSocket(await target());
await new Promise(r => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => {
  const n = ++id;
  pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
for (let i = 0; i < 30; i++) {
  await wait(1000);
  if (await evaluate(`(document.getElementById('lq-up1')||{}).textContent !== '--'`)) break;
}

const READ = `(() => {
  const t = id => (document.getElementById(id) || {}).textContent || null;
  const rows = n => ({
    buy: t('lq-bm' + n), buyCost: t('lq-bc' + n),
    sell: t('lq-sm' + n), sellCost: t('lq-sc' + n),
    barBuy: (() => { const e = document.getElementById('lq-bw' + n);
      return e ? +new DOMMatrix(getComputedStyle(e).transform).a.toFixed(4) : null })(),
  });
  return {
    tiles: { tvl: t('lq-tvl'), hard: t('lq-bnb-usd'), bnb: t('lq-bnb'), ratio: t('lq-ratio'), burned: t('lq-burnedlp') },
    up1: t('lq-up1'), dn1: t('lq-dn1'),
    upSub: t('lq-up1s'), note: t('lq-simn'),
    simClass: document.querySelector('.lqi').classList.contains('sim'),
    r1: rows(1), r6: rows(6),
    pressed: [...document.querySelectorAll('.lqsim-b')].map(b => b.dataset.mul + ':' + b.classList.contains('on')),
  };
})()`;

const out = {};
out['1'] = await evaluate(READ);
for (const mul of [2, 5, 10, 1]) {
  await evaluate(`document.querySelector('.lqsim-b[data-mul="${mul}"]').click()`);
  await wait(400);
  out['after' + mul] = await evaluate(READ);
}

const base = out['1'];
const line = (k, o) => console.log(
  k.padEnd(9),
  ('±1% ' + o.up1 + '/' + o.dn1).padEnd(24),
  ('$100 ' + o.r1.buy + ' ' + o.r1.buyCost).padEnd(26),
  ('$2500 ' + o.r6.buy + ' ' + o.r6.buyCost).padEnd(28),
  'bar1 ' + o.r1.barBuy, o.simClass ? '| SIM' : '| live',
);
for (const [k, o] of Object.entries(out)) line(k, o);

console.log('\n--- guards ---');
for (const [k, o] of Object.entries(out)) {
  const same = JSON.stringify(o.tiles) === JSON.stringify(base.tiles);
  const noteOk = o.simClass ? (o.note || '').includes('Hypothetical') : !(o.note || '').trim();
  const subOk = o.simClass ? o.upSub.includes('deeper') : o.upSub.includes('right now');
  console.log(k.padEnd(9), 'tiles unchanged:', same, '| warning matches state:', noteOk, '| sub-label matches:', subOk);
}
console.log('\ntiles throughout:', JSON.stringify(base.tiles));
ws.close();
chrome.kill();
