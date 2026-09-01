// Do the page and the Telegram bot answer the same question with the same
// number? Both are supposed to read the Chainlink BNB/USD feed. This reads the
// rendered page in headless Chrome and computes the bot's figures from chain in
// the same breath, then prints the gap. Reserves only move when somebody trades,
// so seconds apart is close enough to compare — and a source mismatch shows up
// as a constant offset on every dollar figure, not as noise.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;
const RPC = 'https://bsc-dataseed.bnbchain.org';
const PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';
const FEED = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE';
const LP_FEE = 0.9975, TAX = 0.97;

const post = body => fetch(RPC, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());

async function fromChain() {
  const call = (to, data, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] });
  const r = await post([call(PAIR, '0x0902f1ac', 1), call(FEED, '0x50d25bcd', 2),
    { jsonrpc: '2.0', id: 3, method: 'eth_blockNumber', params: [] }]);
  const m = {}; for (const x of r) m[x.id] = x.result;
  const tok = Number(BigInt('0x' + m[1].slice(2, 66))) / 1e18;
  const wbnb = Number(BigInt('0x' + m[1].slice(66, 130))) / 1e18;
  const bnbUsd = Number(BigInt(m[2])) / 1e8;
  const px = (wbnb / tok) * bnbUsd;
  const q = 1 + LP_FEE, onePct = (rr, k) => rr * ((-q + Math.sqrt(q * q + 4 * LP_FEE * (k - 1))) / (2 * LP_FEE));
  return {
    block: parseInt(m[3], 16), bnbUsd, wbnb, tok,
    tvl: wbnb * bnbUsd * 2, bnbSide: wbnb * bnbUsd,
    up1: onePct(wbnb, 1.01) * bnbUsd, dn1: onePct(tok, 1 / 0.99) / TAX * px,
  };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'cdp3-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1280,1200', '--hide-scrollbars', '--no-first-run'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl; } catch {}
    await wait(300);
  }
  throw new Error('no chrome');
}
const ws = new WebSocket(await target());
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'https://brainonbnb.com/?probe=' + Math.floor(Math.random() * 1e9) });
// The block is below the fold and its figures are fetched when it comes into
// view, so a checker that never scrolls waits thirty seconds for placeholders
// and then reports every dollar figure as a 100% gap. That is what it did until
// 1 September, while the depth-panel checker one directory over was reading the
// same tiles correctly — a false alarm on a page that was right the whole time.
await ev(`(document.getElementById('lq-tvl')||{scrollIntoView(){}}).scrollIntoView({block:'center'})`);
let filled = false;
for (let i = 0; i < 40; i++) {
  await wait(1000);
  if (await ev(`(document.getElementById('lq-up1')||{}).textContent !== '--'`)) { filled = true; break; }
}
if (!filled) {
  console.error('the liquidity block never filled in 40s — nothing was compared, and that is not a pass');
  ws.close(); chrome.kill(); process.exit(1);
}

const num = s => Number(String(s).replace(/[^0-9.]/g, ''));
const page = await ev(`(() => { const t = id => (document.getElementById(id)||{}).textContent;
  return { tvl: t('lq-tvl'), bnbUsd: t('lq-bnb-usd'), bnb: t('lq-bnb'), up1: t('lq-up1'), dn1: t('lq-dn1'), px: window.__bobaiPx }; })()`);
if (process.argv.includes('--debug')) console.error('RAW PAGE', JSON.stringify(page));
const chain = await fromChain();
ws.close(); chrome.kill();

const rows = [
  ['pool $', num(page.tvl), chain.tvl],
  ['bnb side $', num(page.bnbUsd), chain.bnbSide],
  ['+1% $', num(page.up1), chain.up1],
  ['-1% $', num(page.dn1), chain.dn1],
  ['bobai price', page.px, (chain.wbnb / chain.tok) * chain.bnbUsd],
];
console.log('block', chain.block, '| chainlink bnb/usd', chain.bnbUsd.toFixed(4), '\n');
console.log('figure'.padEnd(13), 'page'.padEnd(14), 'chain (bot maths)'.padEnd(20), 'gap');
let worst = 0;
for (const [name, p, c] of rows) {
  const gap = Math.abs(p / c - 1) * 100;
  worst = Math.max(worst, gap);
  console.log(name.padEnd(13), String(p).padEnd(14), c.toFixed(8).padEnd(20), gap.toFixed(4) + '%');
}
console.log('\nlargest gap', worst.toFixed(4) + '%',
  worst < 0.02 ? '-> same source (rounding only)' : '-> STILL DIFFERENT, investigate');
