// WHERE WE STAND ON MANDATE AND MARQUE (2026-10-27, operator: "check jeweils wieder aktuell mandatemarkets.com und
// marque.trade, wie es dort um unsere Agenten aussieht — so sehen wir, wo wir stehen und können uns verbessern").
// Read-only, public endpoints only: Mandate's qualification checks per agent (/api/v1/qualify/<id>; "reading" means it
// is reading afresh — asked again once, after a pause) and Marque's marketplace (every agent, in Marque's own order).
//   node scripts/platform-standing.mjs          one table per platform, every failing check with Mandate's own words
const OURS = { 302257: 'Venus Health Factor', 302258: 'BSC Grid Planner', 304493: 'Venus Yield Ranking', 304494: 'Rebalance Pricer', 310460: 'Fee Tier Placement', 363709: 'DeFi Agent', 49467: '$BOBAI main (no service)', 391841: 'Brain Board (no service)' };
const UA = { 'user-agent': 'brainonbnb-standing' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (u, ms = 45000) => fetch(u, { headers: UA, signal: AbortSignal.timeout(ms) }).then((r) => r.json()).catch((e) => ({ __error: String(e.message || e) }));
const MARK = { pass: 'ok', fail: 'FAIL', unknown: '?', pending: '…' };

console.log(`MANDATE — mandatemarkets.com/api/v1/qualify/<id>   (${new Date().toISOString().slice(0, 16)} UTC)`);
const ask = async (id) => { let j = await json(`https://www.mandatemarkets.com/api/v1/qualify/${id}`); if (j?.data?.reading) { await sleep(30000); j = await json(`https://www.mandatemarkets.com/api/v1/qualify/${id}`); } return j; };
const mand = await Promise.all(Object.keys(OURS).map(async (id) => [id, await ask(id)]));
for (const [id, j] of mand) {
  const c = j?.data?.checks;
  if (!Array.isArray(c)) { console.log(`  #${id.padEnd(7)} ${OURS[id].padEnd(26)} not answered (${j?.__error || 'no checks'})`); continue; }
  console.log(`  #${id.padEnd(7)} ${OURS[id].padEnd(26)} ${c.map((x) => `${x.id}:${MARK[x.state] || x.state}`).join(' ')}${j.data.reading ? '  (still reading)' : ''}`);
  for (const x of c) if (x.state === 'fail' || (x.id === 'hired' && x.state !== 'pass')) console.log(`             ${x.id}: ${String(x.detail).slice(0, 200)}`);
}

console.log(`\nMARQUE — marque.trade/api/v1/marketplace (rank = position in Marque's own list)`);
let all = [];
for (let off = 0; off < 3000; off += 200) {
  const j = await json(`https://marque.trade/api/v1/marketplace?limit=200&offset=${off}`, 60000);
  const items = j.items || j.agents || [];
  all = all.concat(items);
  if (!j.hasMore || !items.length) { if (off === 0 && j.total) console.log(`  ${j.total} agents listed, ${j.facets?.proof?.warranted ?? '?'} warranted, ${j.facets?.live?.live ?? '?'} live`); break; }
  if (off === 0 && j.total) console.log(`  ${j.total} agents listed, ${j.facets?.proof?.warranted ?? '?'} warranted, ${j.facets?.live?.live ?? '?'} live`);
}
for (const id of Object.keys(OURS)) {
  const i = all.findIndex((a) => String(a.tokenId) === id);
  if (i < 0) { console.log(`  #${id.padEnd(7)} ${OURS[id].padEnd(26)} not listed`); continue; }
  const a = all[i];
  console.log(`  #${id.padEnd(7)} ${OURS[id].padEnd(26)} rank ${String(i + 1).padStart(4)} of ${all.length} · ${a.category} · ${a.liveness} · ${a.commerce?.state || '-'} · ${a.warrant?.status || a.qual || '-'}${a.warrant?.testId ? ' (' + a.warrant.testId + ')' : ''}${a.hireBlockedReason ? ' · blocked: ' + a.hireBlockedReason : ''}`);
}
const ahead = all.slice(0, Math.min(...Object.keys(OURS).map((id) => all.findIndex((a) => String(a.tokenId) === id)).filter((i) => i >= 0)));
if (ahead.length) console.log(`  ahead of ours: ${ahead.map((a) => `#${a.tokenId} ${a.name}${a.isReference ? ' (Marque reference)' : ''}`).join(' · ')}`);
