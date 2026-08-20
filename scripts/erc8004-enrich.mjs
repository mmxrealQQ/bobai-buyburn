// Fills in the parts of a registration the scan does not carry.
//
// The scan is a counting pass over a quarter of a million ids, so it records
// only what it needs to count with. A profile needs more: what the agent says
// it does, what trust model it claims, whether it advertises x402, what it
// looks like. That data is already on-chain in the same tokenURI — it just was
// not worth carrying through 280,000 iterations to get at the few thousand
// entries that have an endpoint.
//
// So this re-reads only the ids that made it into the directory. A few thousand
// calls, a couple of minutes, and it can run while the main scan is still
// going — the two touch different files.
//
// Usage: node scripts/erc8004-enrich.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'data', 'erc8004');
const HITS = path.join(DIR, 'agents-with-endpoints.jsonl');
const OUT = path.join(DIR, 'registrations.json');

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const TOKEN_URI = '0xc87b56dd';
const RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed2.bnbchain.org',
  'https://bsc-dataseed3.bnbchain.org',
  'https://bsc-dataseed4.defibit.io',
];
const BATCH = 25;

let rr = 0;
const id32 = (n) => BigInt(n).toString(16).padStart(64, '0');

async function callBatch(ids) {
  const payload = ids.map((id, i) => ({
    jsonrpc: '2.0', id: i, method: 'eth_call',
    params: [{ to: REGISTRY, data: TOKEN_URI + id32(id) }, 'latest'],
  }));
  for (let a = 0; a < RPCS.length * 2; a++) {
    try {
      const r = await fetch(RPCS[rr++ % RPCS.length], {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      if (!Array.isArray(j)) continue;
      const out = new Array(ids.length).fill(null);
      let got = 0;
      for (const it of j) {
        if (typeof it.id !== 'number' || it.error) continue;
        out[it.id] = it.result; got++;
      }
      if (got) return out;
    } catch { /* next endpoint */ }
  }
  return new Array(ids.length).fill(null);
}

const decodeString = (hex) => {
  if (!hex || hex === '0x') return null;
  const b = hex.slice(2);
  try {
    const len = parseInt(b.slice(64, 128), 16);
    if (!(len > 0) || len > 2_000_000) return null;
    const by = [];
    for (let i = 0; i < len; i++) by.push(parseInt(b.substr(128 + i * 2, 2), 16));
    return Buffer.from(by).toString('utf8');
  } catch { return null; }
};

const parse = (raw) => {
  const s = decodeString(raw);
  if (!s) return null;
  const b64 = s.includes('base64,') ? s.split('base64,')[1] : null;
  try {
    return JSON.parse(b64 ? Buffer.from(b64, 'base64').toString('utf8') : s);
  } catch { return null; }
};

if (!fs.existsSync(HITS)) {
  console.error('Run erc8004-scan.mjs first.');
  process.exit(1);
}

const ids = [...new Set(
  fs.readFileSync(HITS, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l).id; } catch { return null; } })
    .filter((x) => Number.isInteger(x)),
)].sort((a, b) => a - b);

console.log(`enriching ${ids.length.toLocaleString('en-US')} registrations`);

const registrations = {};
for (let i = 0; i < ids.length; i += BATCH) {
  const chunk = ids.slice(i, i + BATCH);
  const res = await callBatch(chunk);
  for (let n = 0; n < chunk.length; n++) {
    const meta = parse(res[n]);
    if (!meta) continue;
    const services = Array.isArray(meta.services) ? meta.services : [];
    registrations[chunk[n]] = {
      name: typeof meta.name === 'string' ? meta.name.slice(0, 90) : null,
      // The operator's own words about what the agent does. On a profile this
      // is the difference between a row and something a person can judge.
      description: typeof meta.description === 'string' ? meta.description.slice(0, 400) : null,
      image: typeof meta.image === 'string' && /^https:\/\//.test(meta.image) ? meta.image : null,
      active: meta.active === true,
      trust: Array.isArray(meta.supportedTrust) ? meta.supportedTrust.slice(0, 6) : [],
      x402: !!meta.x402Support,
      // Named services with their declared kind — "telegram", "web", "MCP" —
      // which is how an agent states its own surface area.
      services: services.map((s) => s && typeof s === 'object' ? {
        name: String(s.name || '').slice(0, 40),
        endpoint: typeof s.endpoint === 'string' ? s.endpoint.slice(0, 200) : null,
        version: s.version ? String(s.version).slice(0, 20) : null,
      } : null).filter(Boolean).slice(0, 10),
    };
  }
  if ((i / BATCH) % 10 === 0) process.stdout.write(`\r  ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
}

fs.writeFileSync(OUT, JSON.stringify(registrations, null, 1) + '\n');
const withDesc = Object.values(registrations).filter((r) => r.description).length;
const withImg = Object.values(registrations).filter((r) => r.image).length;
const withTrust = Object.values(registrations).filter((r) => r.trust.length).length;
console.log(`\n  ${Object.keys(registrations).length} read · ${withDesc} describe themselves · ${withImg} have a logo · ${withTrust} declare a trust model`);
console.log(`written: ${path.relative(ROOT, OUT)}`);
