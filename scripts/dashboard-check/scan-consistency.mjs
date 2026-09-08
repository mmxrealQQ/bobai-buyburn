// Does the REST scan answer the same question the same way every time?
//
// The pool scan answers with status 200 whether the tax was measured from
// trades, simulated on the chain, or — when the log endpoint was throttled
// for the second it was needed — merely copied from a GoPlus label. A caller
// cannot tell those apart by the status, only by `tax.source`. This asks the
// same address N times and counts what came back, with the latency, so a
// change to the RPC path (a keyed endpoint, a retry) can be measured rather
// than believed.
//
//   node scripts/dashboard-check/scan-consistency.mjs [address] [N]
//   BASE=https://brainonbnb.com node scripts/dashboard-check/scan-consistency.mjs
//
// Defaults: $BOBAI, 10 calls, one at a time (a burst would measure the
// throttle, not the path). Exit code 0 always: this is a measurement, not a
// gate — a live endpoint's worst minute is not a defect in this repository.
const BASE = process.env.BASE || 'https://brainonbnb.com';
const address = (process.argv[2] || '0x245c386dcfed896f5c346107596141e5edcbffff').toLowerCase();
const N = Math.max(1, Number(process.argv[3] || 10));

const rows = [];
for (let i = 0; i < N; i++) {
  const t0 = Date.now();
  let status = 0, source = 'no answer', sell = 'no answer', second = false;
  try {
    const r = await fetch(`${BASE}/api/pool-scan?address=${address}`, { signal: AbortSignal.timeout(60000), cache: 'no-store' });
    status = r.status;
    const j = await r.json().catch(() => null);
    source = j?.tax?.source || (j?.error ? `error: ${String(j.error).slice(0, 60)}` : 'no tax block');
    const s = j?.sellability;
    sell = s ? (s.ok ? (s.sellable === false ? 'ran: not sellable' : 'ran') : `not checked: ${String(s.reason || '').slice(0, 50)}`) : 'absent';
    second = !!j?.tax?.read_on_second_try;
  } catch (e) { source = `fetch failed: ${String(e.message).slice(0, 50)}`; }
  const ms = Date.now() - t0;
  rows.push({ status, source, sell, second, ms });
  console.log(`${String(i + 1).padStart(2)}  ${status}  ${String(ms).padStart(6)} ms  tax: ${source}${second ? ' (second try)' : ''}  sell test: ${sell}`);
}
const by = (f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log('');
console.log(`${N} calls to ${BASE}/api/pool-scan for ${address}`);
console.log(`status:      ${JSON.stringify(by((r) => r.status))}`);
console.log(`tax source:  ${JSON.stringify(by((r) => r.source))}`);
console.log(`sell test:   ${JSON.stringify(by((r) => r.sell))}`);
console.log(`second try:  ${rows.filter((r) => r.second).length}`);
console.log(`latency:     min ${lat[0]} ms · median ${lat[Math.floor(lat.length / 2)]} ms · max ${lat[lat.length - 1]} ms`);
const label = rows.filter((r) => /labelled|unknown|no tax block|no answer|error|fetch failed/.test(r.source)).length;
console.log(`answers that fell back to a label or failed: ${label} of ${N}`);
