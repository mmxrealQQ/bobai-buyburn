// WHO CALLS THE FREE REST TOOLS, AND WHO COMES BACK (2026-11-04)
// Operator, 4.11.: "trading bots". The REST tools (fee-tiers, pool-scan, preflight, range-plan, best-route, price …)
// were counted per day only. Since 4.11. the site worker also counts restby:<route>:<tag>:<product> — tag = 6 hex of a
// salted hash over the address and the software name (no address kept). This reads the last N days and prints, per
// caller: the days seen, the calls, the tools, the software. Our own checks (brainonbnb-*, bobai-*) are own: and absent.
//   node scripts/rest-callers.mjs [days=7]
const days = Math.max(1, Math.min(30, Number(process.argv[2]) || 7));
const AG = 'https://agent.brainonbnb.com';
const callers = new Map();
const perDay = [];
for (let i = days - 1; i >= 0; i--) {
  const day = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10);
  const j = await fetch(`${AG}/stats/detail?day=${day}&r=${Date.now()}`, { headers: { 'user-agent': 'brainonbnb-rest-callers' } }).then((r) => r.json()).catch(() => null);
  const names = j?.names || {};
  let n = 0;
  for (const [k, v] of Object.entries(names)) {
    const m = k.match(/^restby:([^:]+):([0-9a-fx]+):(.*)$/);
    if (!m) continue;
    const [, route, tag, product] = m;
    const c = callers.get(tag) || { tag, product, days: new Set(), calls: 0, routes: {} };
    c.days.add(day); c.calls += v; c.routes[route] = (c.routes[route] || 0) + v;
    callers.set(tag, c); n += v;
  }
  perDay.push(`${day}: ${n} calls by ${new Set(Object.keys(names).filter((k) => k.startsWith('restby:')).map((k) => k.split(':')[2])).size} callers`);
}
const list = [...callers.values()].sort((a, b) => b.days.size - a.days.size || b.calls - a.calls);
console.log(`REST callers, last ${days} days (counted since 2026-11-04)`);
console.log(perDay.join('\n'));
console.log(`\n${list.length} callers · ${list.filter((c) => c.days.size > 1).length} came back on another day\n`);
for (const c of list.slice(0, 40)) {
  console.log(`${c.tag}  ${String(c.days.size).padStart(2)} d  ${String(c.calls).padStart(5)} calls  ${c.product.padEnd(14)} ${Object.entries(c.routes).sort((a, b) => b[1] - a[1]).map(([r, v]) => `${r} ${v}`).join(' · ')}`);
}
