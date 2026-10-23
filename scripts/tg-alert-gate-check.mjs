#!/usr/bin/env node
// ONE ALERT PER BUY (2026-10-23). The $328 buy of 22.10. 20:37 UTC was posted twice, the same photo in the same
// minute: two every-minute ticks read `pending_nft_buys` before either wrote it back. The bot now claims every buy
// at a Durable Object (AlertGate) before it sends; only the first claim sends.
// Pins (the code before 2026-10-23 FAILs 1, 4 and 5 — it had no gate):
//   1  AlertGate exists: a tx is claimed once, a second claim is refused, a release lets it be claimed again
//   2  two ticks claiming the same tx at the same moment: exactly one may send
//   3  no gate bound (tests, local run) or a gate that throws: the tick still sends (a buy is never lost)
//   4  every postBuyAlert of the tick (minted, timeout, sold-out) is preceded by claimAlert, and a failed send releases
//   5  wrangler.toml binds GATE to AlertGate with a migration
// usage: node scripts/tg-alert-gate-check.mjs      offline
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'worker-tg-bot', 'index.js'), 'utf8');
const toml = fs.readFileSync(path.join(ROOT, 'worker-tg-bot', 'wrangler.toml'), 'utf8');
const worker = await import(pathToFileURL(path.join(ROOT, 'worker-tg-bot', 'index.js')).href);
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };

// a stand-in Durable Object: one instance, storage calls run one after the other as in the runtime's input gate
function fakeGateEnv(Gate) {
  const map = new Map();
  let chain = Promise.resolve();
  const storage = { get: async (k) => map.get(k), put: async (k, v) => { map.set(k, v); }, delete: async (k) => { (Array.isArray(k) ? k : [k]).forEach((x) => map.delete(x)); }, list: async () => new Map(map) };
  const obj = new Gate({ storage });
  const stub = { fetch: (url) => { const run = chain.then(() => obj.fetch(new Request(url))); chain = run.catch(() => {}); return run; } };
  return { GATE: { idFromName: () => 'alerts', get: () => stub } };
}

const Gate = worker.AlertGate;
is('1  AlertGate is exported by the worker', typeof Gate === 'function');
if (typeof Gate === 'function' && typeof worker.claimAlert === 'function') {
  const env = fakeGateEnv(Gate);
  const tx = '0x7b1e9e1e86be97eb3cfeb84276f369985ee92cad94ac97a5c116390205e9e4c3';
  const a = await worker.claimAlert(env, 'buy', tx);
  const b = await worker.claimAlert(env, 'buy', tx.toUpperCase().replace('0X', '0x'));
  await worker.releaseAlert(env, 'buy', tx);
  const c = await worker.claimAlert(env, 'buy', tx);
  is('1  claimed once, refused the second time (any letter case), claimable again after a release', a === true && b === false && c === true, `${a} ${b} ${c}`);

  const env2 = fakeGateEnv(Gate);
  const both = await Promise.all([worker.claimAlert(env2, 'buy', '0xabc'), worker.claimAlert(env2, 'buy', '0xabc')]);
  is('2  two ticks at the same moment: exactly one may send', both.filter(Boolean).length === 1, both.join(' '));

  const quiet = console.error; console.error = () => {};
  const none = await worker.claimAlert({}, 'buy', '0xabc');
  const broken = await worker.claimAlert({ GATE: { idFromName: () => 'x', get: () => ({ fetch: async () => { throw new Error('down'); } }) } }, 'buy', '0xabc');
  console.error = quiet;
  is('3  no gate or a broken gate: the tick still sends', none === true && broken === true, `${none} ${broken}`);
} else {
  is('1  claim/release helpers exported', false);
  is('2  two ticks at the same moment: exactly one may send', false, 'no gate');
  is('3  no gate or a broken gate: the tick still sends', false, 'no gate');
}

// 4: every tick send is gated. The tick's calls carry TG_CHAT_ID; /previewbuy (operator preview) is left alone.
const sends = [...src.matchAll(/const sent = await postBuyAlert\([^\n]*TG_CHAT_ID[^\n]*\n/g)];
const gated = sends.filter((m) => {
  const before = src.slice(Math.max(0, m.index - 260), m.index);
  const after = src.slice(m.index, m.index + 420);
  return /claimAlert\(env, 'buy'/.test(before) && /releaseAlert\(env, 'buy'/.test(after);
});
is('4  every buy alert of the tick claims first and releases on a failed send', sends.length === 3 && gated.length === 3, `${gated.length} of ${sends.length}`);

// 6, 7 (2026-10-23, the same race): the burn alert reads last_burned, the whale scan its cursor — both from KV
is('6  the burn alert claims its burn total first and releases on a failed send', /claimAlert\(env, 'burn', burnKey\)[\s\S]{0,200}postBurnAlert\(currentBurned[\s\S]{0,120}releaseAlert\(env, 'burn', burnKey\)/.test(src));
is('7  every whale alert claims its move first (inside postWhaleAlert) and releases on a failed send', /async function postWhaleAlert[\s\S]{0,400}claimAlert\(WHALE_ENV, 'whale', gateKey\)[\s\S]{0,200}releaseAlert\(WHALE_ENV, 'whale', gateKey\)/.test(src));
is('5  wrangler.toml binds GATE to AlertGate with a migration', /name = "GATE"/.test(toml) && /class_name = "AlertGate"/.test(toml) && /new_sqlite_classes = \["AlertGate"\]/.test(toml));

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
