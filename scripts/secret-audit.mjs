// Decides whether this repository can be made public — worktree AND history.
//
// The redaction gate in build-library.mjs only ever covered the fourteen
// library bundles. Nothing has ever read the repository itself, and nothing
// has ever read its history at all, which is the half that matters: a secret
// deleted in a later commit is still served by every clone forever.
//
// Three traps this file exists to not fall into:
//
//   A transaction hash and a private key are both 32 bytes of hex and look
//   exactly alike. burns.json alone holds 1551 of them. A scanner that reports
//   "2235 possible private keys" has reported nothing — the finding drowns.
//   So hex is not judged by shape. Every candidate is run through
//   privateKeyToAccount and the DERIVED ADDRESS is compared against the
//   wallets we actually control. That question has a yes-or-no answer.
//
//   The wallets we control are read from .env, and their keys never leave this
//   process — only the addresses derived from them are ever held, compared or
//   printed. Running this must not itself become the leak.
//
//   A dead secret is not a live one. The Telegram token in the history is
//   revoked; reporting it at the same volume as a live key would train us to
//   ignore the output. Tokens are probed against their own API and reported by
//   what they can still do, not by what they look like.
//
// Exit codes: 0 clean, 1 findings, 2 self-test failed.
//
// Usage:
//   node scripts/secret-audit.mjs                 worktree at HEAD
//   node scripts/secret-audit.mjs --history       every blob that ever existed
//   node scripts/secret-audit.mjs --self-test     plant secrets, prove they are caught
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const WANT_HISTORY = args.includes('--history') || args.includes('--all');

// Binary and vendored files carry no secrets and cost the most to read.
const SKIP = /\.(png|jpe?g|gif|webp|svg|mp4|webm|woff2?|ttf|otf|eot|ico|zip|pdf|wasm)$/i;

const RULES = [
  { id: 'privkey-hex',  label: '32-byte hex (key or hash — decided by derivation)',
    re: /\b(?:0x)?[0-9a-fA-F]{64}\b/g },
  { id: 'tg-bot-token', label: 'Telegram bot token',
    re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
  { id: 'jwt',          label: 'JWT (Supabase anon/service key)',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: 'openai',       label: 'OpenAI-style key',
    re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'aws',          label: 'AWS access key id',
    re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'nodereal',     label: 'NodeReal RPC app key (in a URL)',
    re: /nodereal\.io\/v1\/([0-9a-f]{32})/gi },
];

// Hex words that are structurally not keys: the zero word, the max uint, and
// an address left-padded into a 32-byte log topic.
const BENIGN_HEX = [/^0x0{64}$/, /^0xf{64}$/i, /^0x0{24}[0-9a-fA-F]{40}$/];

// Values that are deliberately fake and must stay in the tree: the redaction
// gate's own self-test needs a specimen of each secret class to prove it fires.
const FIXTURE_FILES = new Set(['scripts/build-library.mjs', 'scripts/secret-audit.mjs']);

const git = (...a) =>
  execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 29 });

function scan (text) {
  const hits = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text)) !== null) {
      const v = m[1] || m[0];
      if (r.id === 'privkey-hex') {
        const w = v.startsWith('0x') ? v : '0x' + v;
        if (BENIGN_HEX.some(b => b.test(w))) continue;
      }
      hits.push({ rule: r.id, label: r.label, value: v });
    }
  }
  return hits;
}

// The wallets we actually control. Keys are read, derived, and dropped; only
// addresses survive this function.
function ourAddresses () {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return new Map();
  const out = new Map();
  const re = /^([A-Z0-9_]*(?:PRIVATE_KEY|KEY))\s*=\s*["']?(?:0x)?([0-9a-fA-F]{64})["']?\s*$/gm;
  for (const m of fs.readFileSync(envPath, 'utf8').matchAll(re)) {
    try { out.set(privateKeyToAccount('0x' + m[2]).address.toLowerCase(), m[1]); } catch { /* not a key */ }
  }
  return out;
}

function derives (hex, ours) {
  const w = hex.startsWith('0x') ? hex : '0x' + hex;
  let a;
  try { a = privateKeyToAccount(w).address.toLowerCase(); } catch { return null; }
  return ours.has(a) ? { addr: a, name: ours.get(a) } : null;
}

// A token is judged by what it can still do. Network failure is reported as
// unknown, never as dead — "we could not reach Telegram" must not read as
// "the token is revoked".
async function probeTelegram (token) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (j.ok) return { state: 'LIVE', detail: `@${j.result?.username ?? '?'}` };
    if (r.status === 401) return { state: 'revoked', detail: 'HTTP 401' };
    return { state: 'unknown', detail: `HTTP ${r.status}` };
  } catch (e) {
    return { state: 'unknown', detail: `unreachable (${e.name})` };
  }
}

// ---------------------------------------------------------------- self-test
// Plants one specimen of every class and requires each to be caught, then
// requires the two known false-positive shapes to stay quiet. Without this the
// scanner's silence is indistinguishable from it being broken.
if (args.includes('--self-test')) {
  const fails = [];
  const planted = [
    ['privkey-hex',  '0x' + 'a3'.repeat(32)],
    ['tg-bot-token', '1234567890:AAF' + 'x'.repeat(32)],
    ['jwt',          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
    ['openai',       'sk-proj-' + 'AbCdEf0123456789'],
    ['aws',          'AKIA' + 'ABCDEFGHIJKLMNOP'],
    ['nodereal',     'https://bsc-mainnet.nodereal.io/v1/' + '0'.repeat(32)],
  ];
  for (const [id, sample] of planted) {
    if (!scan(sample).some(h => h.rule === id)) fails.push(`missed ${id}`);
  }
  for (const [what, sample] of [
    ['zero word', '0x' + '0'.repeat(64)],
    ['padded address topic', '0x' + '0'.repeat(24) + 'defc0e900dfc83e207902cf22265ae63f94c01ce'],
  ]) {
    if (scan(sample).length) fails.push(`false positive on ${what}`);
  }
  // The derivation test is the whole argument. Prove it can say yes: plant a
  // key and an "our wallet" map that its address is in.
  const probe = '0x' + '5d'.repeat(32);
  const fakeOurs = new Map([[privateKeyToAccount(probe).address.toLowerCase(), 'PROBE']]);
  if (!derives(probe, fakeOurs)) fails.push('derivation failed to match a planted key');
  if (derives('0x' + 'ab'.repeat(32), fakeOurs)) fails.push('derivation matched an unrelated key');
  // And prove it reads real keys out of .env at all — a silent empty map would
  // make every future run pass for the wrong reason.
  if (fs.existsSync(path.join(ROOT, '.env')) && ourAddresses().size === 0) {
    fails.push('.env exists but no controlled wallets were derived from it');
  }

  if (fails.length) {
    console.error(`\nself-test FAILED (${fails.length})`);
    for (const f of fails) console.error('  - ' + f);
    process.exit(2);
  }
  console.log('self-test passed: all six secret classes caught, zero-word and padded-topic stay quiet, derivation says yes to a planted key and no to a stranger, .env really is read');
  process.exit(0);
}

// -------------------------------------------------------------------- scan
const ours = ourAddresses();
console.log(`wallets we control (from .env, addresses only): ${ours.size}`);

const findings = new Map(); // rule|value -> {rule,label,value,where:Set}
const note = (hits, where) => {
  for (const h of hits) {
    const k = h.rule + '|' + h.value;
    if (!findings.has(k)) findings.set(k, { ...h, where: new Set() });
    findings.get(k).where.add(where);
  }
};

const files = git('ls-files', '-z').split('\0').filter(Boolean);
let nFiles = 0;
for (const f of files) {
  if (SKIP.test(f)) continue;
  let text;
  try { text = git('show', `HEAD:${f}`); } catch { continue; }
  nFiles++;
  note(scan(text).map(h => ({ ...h, fixture: FIXTURE_FILES.has(f) })), f);
}
console.log(`worktree: read ${nFiles} text files of ${files.length} tracked`);

if (WANT_HISTORY) {
  // One `git cat-file --batch` for every object that ever existed. Spawning a
  // process per blob takes minutes on Windows; this takes seconds.
  const objs = git('rev-list', '--objects', '--all').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf(' '); return i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)]; })
    .filter(([, p]) => p && !SKIP.test(p));
  const pathOf = new Map(objs.map(([o, p]) => [o, p]));

  const cat = spawn('git', ['cat-file', '--batch'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
  const chunks = [];
  cat.stdout.on('data', d => chunks.push(d));
  const finished = new Promise(r => cat.stdout.on('end', r));
  cat.stdin.end(objs.map(([o]) => o).join('\n') + '\n');
  await finished;

  const buf = Buffer.concat(chunks);
  let off = 0, nBlobs = 0;
  while (off < buf.length) {
    const nl = buf.indexOf(0x0a, off);
    if (nl < 0) break;
    const m = buf.toString('utf8', off, nl).match(/^([0-9a-f]{40}) (\w+) (\d+)$/);
    if (!m) break;
    const [, oid, type, size] = m;
    const start = nl + 1, len = Number(size);
    if (type === 'blob' && len < 4_000_000) {
      nBlobs++;
      const p = pathOf.get(oid) ?? oid;
      note(scan(buf.toString('utf8', start, start + len)).map(h => ({ ...h, fixture: FIXTURE_FILES.has(p) })),
           `history:${p}`);
    }
    off = start + len + 1;
  }
  console.log(`history: read ${nBlobs} blobs across ${git('rev-list', '--all', '--count').trim()} commits`);
}

// ------------------------------------------------------------------ verdict
const live = [];      // unlocks a wallet we control — stop the world
const dead = [];      // real secret, provably revoked
const unknown = [];   // could not be decided; a human must look
const fixtures = [];  // deliberately fake, kept for a self-test
let hashes = 0;

for (const f of findings.values()) {
  const where = [...f.where];
  if (f.fixture) { fixtures.push({ ...f, where }); continue; }
  if (f.rule === 'privkey-hex') {
    const hit = derives(f.value, ours);
    if (hit) live.push({ ...f, where, addr: hit.addr, name: hit.name });
    else hashes++;
    continue;
  }
  if (f.rule === 'tg-bot-token') {
    const state = await probeTelegram(f.value);
    (state.state === 'LIVE' ? live : state.state === 'revoked' ? dead : unknown)
      .push({ ...f, where, detail: state.detail });
    continue;
  }
  unknown.push({ ...f, where });
}

const mask = v => v.length > 14 ? v.slice(0, 8) + '…' + v.slice(-4) : v;

console.log(`\n32-byte hex values that derive to no wallet of ours: ${hashes} (transaction hashes)`);
if (fixtures.length) console.log(`self-test fixtures, intentionally fake: ${fixtures.length}`);

if (dead.length) {
  console.log(`\nREVOKED — in the history, no longer usable (${dead.length}):`);
  for (const d of dead) console.log(`  ${d.label}: ${mask(d.value)} — ${d.detail}\n    ${d.where.slice(0, 3).join(', ')}`);
}
if (unknown.length) {
  console.log(`\nUNDECIDED — a human must look (${unknown.length}):`);
  for (const u of unknown) console.log(`  ${u.label}: ${mask(u.value)}${u.detail ? ' — ' + u.detail : ''}\n    ${u.where.slice(0, 3).join(', ')}`);
}
if (live.length) {
  console.log(`\nLIVE SECRET — DO NOT PUBLISH (${live.length}):`);
  for (const l of live) console.log(`  ${l.label}: ${mask(l.value)} unlocks ${l.name} ${l.addr ?? ''}\n    ${l.where.slice(0, 3).join(', ')}`);
}

const blocking = live.length + unknown.length;
console.log(blocking === 0
  ? `\nPUBLISHABLE${WANT_HISTORY ? ' (worktree and full history)' : ' (worktree only — rerun with --history before publishing)'}: no live secret, nothing undecided.`
  : `\nNOT PUBLISHABLE: ${live.length} live, ${unknown.length} undecided.`);
process.exit(blocking === 0 ? 0 : 1);
