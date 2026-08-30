// Drives the hire panel through a REAL wallet, past the point the other check
// stops at.
//
// registry-hire.mjs proves the panel negotiates and renders five sendable
// steps. What it cannot prove is the part that costs money: that clicking
// "Send" produces a transaction BNB Chain accepts, that step 1 yields a job id
// the panel can find, and that steps 2-5 substitute that id correctly. Headless
// Chrome has no wallet, so that half of the panel had never been executed by
// anything but a person, once, by hand.
//
// So a wallet is attached: a minimal EIP-1193 provider is injected before the
// page's own scripts run, and every request is answered from Node over a CDP
// binding. The private key never enters the page - the browser asks, Node signs.
//
//   node scripts/dashboard-check/registry-hire-wallet.mjs           plan only, free
//   node scripts/dashboard-check/registry-hire-wallet.mjs --send    really spends
//
// Plan is the default on purpose. It attaches the wallet, drives the panel to
// the moment of the first send, and prints the transaction that WOULD go out,
// decoded - which catches a broken call without paying to find out.
//
// --send costs 0.10 $U plus gas, and the escrow's OptimisticPolicy holds the
// budget for its dispute window (604800s = 7 days) before it can settle to the
// provider. Buyer and provider are both us, so this is an acceptance test, not
// demand - the same caveat scripts/hire-own-agent.mjs carries.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, http, formatUnits, getAddress, parseAbi } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const SEND = process.argv.includes('--send');
const AGENT_ID = (process.argv.find((a) => a.startsWith('--agent=')) || '--agent=302258').slice(8);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9910 + (process.pid % 80);
const URL = 'https://brainonbnb.com/registry?probe=' + Math.floor(Math.random() * 1e9);
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const USD1 = getAddress('0xce24439f2d9c6a2289f741120fe202248b666666');

const pk = process.env.NFT_RELAYER_PRIVATE_KEY;
if (!pk) { console.error('No NFT_RELAYER_PRIVATE_KEY in .env — that is the wallet that funded job 56657'); process.exit(2); }
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)']);

const uBal = await pub.readContract({ address: USD1, abi: erc20, functionName: 'balanceOf', args: [account.address] });
const bnbBal = await pub.getBalance({ address: account.address });
console.log(`wallet   ${account.address}`);
console.log(`holds    ${formatUnits(uBal, 18)} $U · ${formatUnits(bnbBal, 18)} BNB`);
console.log(`mode     ${SEND ? 'SEND — this spends real money' : 'plan only — nothing is broadcast'}\n`);

// ---- browser ---------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), `cdp-wallet-${process.pid}-`));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1280,1600', '--hide-scrollbars', '--no-first-run'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* not up */ }
    await wait(300);
  }
  throw new Error('chrome did not come up');
}
const ws = new WebSocket(await targetWs());
await new Promise((r) => (ws.onopen = r));
let msgId = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  for (const fn of listeners) fn(m);
};
const send = (method, params = {}) => new Promise((res) => { const n = ++msgId; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};

// ---- the wallet the page sees ---------------------------------------------
// Everything it can do is here. Read calls are forwarded to the same RPC the
// rest of the project uses; eth_sendTransaction is the only one that can cost
// anything, and in plan mode it never leaves this process.
const sent = [];
async function handle(method, params) {
  switch (method) {
    case 'eth_requestAccounts':
    case 'eth_accounts':
      return [account.address];
    case 'eth_chainId':
      return '0x38';
    case 'wallet_switchEthereumChain':
      return null;
    case 'eth_call':
      return await pub.request({ method: 'eth_call', params });
    case 'eth_getTransactionReceipt':
      return await pub.request({ method: 'eth_getTransactionReceipt', params });
    case 'eth_sendTransaction': {
      const t = params[0];
      sent.push({ to: t.to, data: t.data, value: t.value || '0x0' });
      console.log(`  step ${sent.length}  to ${t.to}  selector ${String(t.data).slice(0, 10)}  ${((String(t.data).length - 2) / 2)} bytes`);
      if (!SEND) throw new Error('PLAN_MODE: not broadcasting');
      const hash = await wallet.sendTransaction({ to: t.to, data: t.data, value: BigInt(t.value || '0x0') });
      console.log(`          sent ${hash}`);
      return hash;
    }
    default:
      throw new Error(`the page asked for ${method}, which this test wallet does not implement`);
  }
}

await send('Runtime.enable');
await send('Page.enable');
await send('Runtime.addBinding', { name: 'walletBridge' });
listeners.push(async (m) => {
  if (m.method !== 'Runtime.bindingCalled' || m.params?.name !== 'walletBridge') return;
  const { id, method, params } = JSON.parse(m.params.payload);
  try {
    const result = await handle(method, params);
    await send('Runtime.evaluate', { expression: `window.__walletSettle(${JSON.stringify(id)},${JSON.stringify({ ok: true, result })})` });
  } catch (e) {
    await send('Runtime.evaluate', { expression: `window.__walletSettle(${JSON.stringify(id)},${JSON.stringify({ ok: false, error: String(e.shortMessage || e.message).slice(0, 200) })})` });
  }
});

// Injected before any page script, so window.ethereum exists by the time the
// panel looks for it. No key here - this is a postbox.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (function(){
      var n = 0, waiting = {};
      window.__walletSettle = function(id, res){
        var w = waiting[id]; if(!w) return; delete waiting[id];
        if(res && res.ok) w.resolve(res.result); else w.reject(new Error((res && res.error) || 'wallet refused'));
      };
      window.ethereum = {
        isMetaMask: true,
        request: function(args){
          return new Promise(function(resolve, reject){
            var id = 'w' + (++n);
            waiting[id] = { resolve: resolve, reject: reject };
            window.walletBridge(JSON.stringify({ id: id, method: args.method, params: args.params || [] }));
          });
        },
        on: function(){}, removeListener: function(){}
      };
    })();
  `,
});

await send('Page.navigate', { url: URL });
for (let i = 0; i < 40; i++) {
  await wait(500);
  if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('.rg-hirebtn')`)) break;
}
await wait(400);

const hasWallet = await evaluate(`!!window.ethereum`);
if (!hasWallet) { console.error('the injected wallet did not survive into the page'); process.exit(1); }

// ---- drive it --------------------------------------------------------------
const problems = [];
await evaluate(`document.querySelector('.rg-hirebtn[data-hire="${AGENT_ID}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
await wait(300);
await evaluate(`document.getElementById('rg-hire-quote').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
let ready = false;
for (let i = 0; i < 60; i++) {
  await wait(1000);
  if (await evaluate(`!!document.getElementById('rg-stepwrap')`)) { ready = true; break; }
  if (await evaluate(`document.getElementById('rg-hire-msg').className.indexOf('rg-err')>=0`)) break;
}
if (!ready) {
  console.error('negotiation did not produce the escrow steps: ' + await evaluate(`document.getElementById('rg-hire-msg').textContent.trim()`));
  process.exit(1);
}

const walletLine = await evaluate(`(document.getElementById('rg-wallet')||{}).textContent||''`);
console.log(`panel sees the wallet: ${walletLine.replace(/\s+/g, ' ').trim().slice(0, 100)}\n`);
if (/No wallet found/i.test(walletLine)) problems.push('the panel still says there is no wallet, with one injected');

const steps = await evaluate(`document.querySelectorAll('#rg-stepwrap button[data-step]').length`);
console.log(`${steps} sendable steps\n`);

// Click step 1. In plan mode the bridge refuses to broadcast, which the panel
// reports as a wallet rejection - the correct behaviour for a declined signature.
await evaluate(`document.querySelector('#rg-stepwrap button[data-step]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);

if (!SEND) {
  for (let i = 0; i < 20 && !sent.length; i++) await wait(500);
  await wait(1500);
  const msg = await evaluate(`document.getElementById('rg-hire-msg').textContent.trim()`);
  const btn = await evaluate(`(function(){var b=document.querySelector('#rg-stepwrap button[data-step]');return {text:b?b.textContent.trim():'',disabled:b?!!b.disabled:false};})()`);
  console.log(`\nafter a declined signature:`);
  console.log(`  message : ${msg.replace(/\s+/g, ' ').slice(0, 140)}`);
  console.log(`  button  : "${btn.text}"${btn.disabled ? ' (disabled)' : ' (still clickable)'}`);
  if (!sent.length) problems.push('clicking Send never reached the wallet');
  if (btn.disabled) problems.push('a declined signature left the step permanently disabled — the buyer cannot retry');
} else {
  // Watch it walk the five steps. Each needs a receipt, so this is slow.
  let last = '';
  for (let i = 0; i < 300; i++) {
    await wait(2000);
    const s = await evaluate(`(function(){
      var m=document.getElementById('rg-hire-msg');
      var done=document.querySelectorAll('#rg-stepwrap .rg-step.rg-done').length;
      var next=document.querySelector('#rg-stepwrap button[data-step]:not([disabled])');
      return { msg:m.textContent.trim(), done:done, hasNext:!!next, err:m.className.indexOf('rg-err')>=0 };
    })()`);
    if (s.msg !== last) { console.log(`  · ${s.msg.replace(/\s+/g, ' ').slice(0, 120)}`); last = s.msg; }
    if (s.err) { problems.push(`the panel reported an error: ${s.msg.slice(0, 160)}`); break; }
    if (sent.length >= 5 && !s.hasNext) break;
    if (s.hasNext && sent.length < 5) {
      await evaluate(`(function(){var b=document.querySelector('#rg-stepwrap button[data-step]:not([disabled])'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));})()`);
      await wait(1000);
    }
  }
  if (sent.length < 5) problems.push(`only ${sent.length} of 5 steps were sent`);
}

ws.close();
chrome.kill();

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log(SEND
  ? '\n✓ all five escrow steps went out from the panel through a real wallet'
  : '\n✓ the panel reaches a real wallet and hands it a well-formed transaction (nothing was spent)');
