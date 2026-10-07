// The numbers a card is drawn from — the same sources the Brain Terminal reads, nothing else.
//
// Read-only by construction: two public log files the bots write, the ten-minute candles the TG bot keeps,
// and a handful of eth_calls against public BSC nodes. No third-party price API (the terminal reads the
// pool and Chainlink, so the card does too; an aggregator's number would differ from the page by a few
// percent and the shared picture would contradict the page it links to).
//
// Every read may fail on its own. A failed read leaves its field null, never 0: the card then drops that
// element instead of printing a zero that is not true (a "0 BOBAI burned" card shared to X is worse than
// a card with one tile less).

export const LOGS = 'https://logs.brainonbnb.com/logs';
export const CANDLES_URL = 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/candles';
// dataseed first (Binance's own), publicnode when it rate-limits or times out
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'];

export const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';
const BNBFEED = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE';
// the buyback bot's wallet: its BNB + WBNB is the half of "next buyback" that is already swapped
const BW = '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce';
const DEAD = '000000000000000000000000000000000000dEaD';
const balOf = a => '0x70a08231' + a.slice(2).toLowerCase().padStart(64, '0');
const DEAD_BAL = '0x70a08231' + DEAD.padStart(64, '0');

// `init` carries the Worker-only `cf` cache hint; Node's fetch never sees it (the test passes {}).
async function getJSON(url, init = {}, ms = 8000) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

// One JSON-RPC batch per node; the next node only if the whole batch failed. A single call that errors
// inside a good batch stays null — the fields that depend on it are dropped, the rest of the card stands.
async function rpcBatch(calls) {
  const body = JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params })));
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const j = await r.json();
      if (!Array.isArray(j)) continue;
      const out = calls.map(() => null);
      for (const x of j) if (x && x.result && x.result !== '0x' && Number.isInteger(x.id)) out[x.id] = x.result;
      if (out.some(v => v != null)) return out;
    } catch { /* next node */ }
  }
  return calls.map(() => null);
}

const call = (to, data) => ['eth_call', [{ to, data }, 'latest']];
const big = h => (h ? BigInt(h.length > 66 ? h.slice(0, 66) : h) : null);
const u18 = h => (h ? Number(big(h)) / 1e18 : null);
const word = (h, i) => BigInt('0x' + h.slice(2 + i * 64, 2 + (i + 1) * 64));

export async function readChain() {
  const q = await rpcBatch([
    ['eth_getBalance', [BW, 'latest']], call(WBNB, balOf(BW)), call(BOBAI, DEAD_BAL),
    call(PAIR, '0x0902f1ac'), call(PAIR, '0x0dfe1681'), call(BOBAI, balOf(BOBAI)),
    call(PAIR, '0x18160ddd'), call(PAIR, DEAD_BAL), call(BNBFEED, '0xfeaf968c'),
  ]);
  const c = { bnbP: null, price: null, pxBnb: null, deadA: null, queued: null, walletBnb: null, lpPct: null };
  // latestRoundData: (roundId, answer, startedAt, updatedAt, answeredInRound); answer has 8 decimals
  if (q[8]) { const a = Number(word(q[8], 1)) / 1e8; if (a > 0) c.bnbP = a; }
  if (q[3] && q[4]) {
    const r0 = word(q[3], 0), r1 = word(q[3], 1), t0IsBobai = ('0x' + q[4].slice(26)).toLowerCase() === BOBAI;
    const bR = t0IsBobai ? r0 : r1, wR = t0IsBobai ? r1 : r0;
    if (bR > 0n && wR > 0n) { c.pxBnb = Number(wR) / Number(bR); if (c.bnbP) c.price = c.pxBnb * c.bnbP; }
  }
  const dead = u18(q[2]); if (dead > 0) c.deadA = dead;
  if (q[5] != null) c.queued = u18(q[5]);
  if (q[0] != null && q[1] != null) c.walletBnb = u18(q[0]) + u18(q[1]);
  if (q[6] && q[7]) { const tot = Number(big(q[6])), d = Number(big(q[7])); if (tot > 0 && d > 0) c.lpPct = d / tot * 100; }
  return c;
}

export async function readLogs(init = {}) {
  const [burns, liq] = await Promise.allSettled([getJSON(`${LOGS}/burns.json`, init), getJSON(`${LOGS}/bobai-liq-log.json`, init)]);
  const ok = r => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : null);
  return { burns: ok(burns), liq: ok(liq) };
}

// In the Worker the bot is reached by its service binding (`tg`): a fetch from one worker to a sibling's
// workers.dev host is answered 404 by Cloudflare's own router, and the card lost its candle strip that way.
// Without a binding (the Node test) the public address is read.
export async function readCandles(init = {}, tg = null) {
  try {
    const j = tg ? await tg.fetch('https://tg/candles', { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } }).then(r => { if (!r.ok) throw new Error('candles ' + r.status); return r.json(); }) : await getJSON(CANDLES_URL, init);
    if (!Array.isArray(j?.rows) || !j.rows.length) return null;
    return { minutes: j.minutes || 10, rows: j.rows.filter(r => r.c > 0).sort((a, b) => a.t - b.t) };
  } catch { return null; }
}

// What the cache is keyed by: a new burn or a new add changes the picture at once; everything else
// (price, queued tax, the candle strip) is allowed to be up to ten minutes old.
export function dataVersion(logs, now = Date.now()) {
  const last = a => (a && a.length ? a[a.length - 1].time : '-');
  const s = `${last(logs.burns)}|${last(logs.liq)}|${Math.floor(now / 600e3)}`;
  let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// The whole state a card needs. Chain and candles only on a cache miss (the caller decides).
export async function readState(init = {}, logs = null, tg = null) {
  const [l, chain, candles] = await Promise.all([logs ? Promise.resolve(logs) : readLogs(init), readChain().catch(() => ({})), readCandles(init, tg)]);
  return { burns: l.burns || [], liq: l.liq || [], logsOk: !!l.burns, liqOk: !!l.liq, ...chain, candles };
}
