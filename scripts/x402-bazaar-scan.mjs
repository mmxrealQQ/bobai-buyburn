// What is actually inside the Coinbase x402 Bazaar.
//
// WHY THIS EXISTS AT ALL
// Getting listed there costs a CDP account and a settled payment on Base, and
// both of those are the user's money and the user's identity, not mine. Before
// anyone spends either, the question worth answering is whether the thing on
// the other side is a market or a mailing list.
//
// The Binance B402 catalogue is why that question gets asked in this repo
// rather than assumed. It advertised 976 services. Reading all 976 gave SIX
// distinct payTo addresses, one of which held 941. "976 services" was one mass
// lister and five small ones, and the headline had nothing to do with the
// number of parties. See project_x402_agent_service.
//
// SO THIS COUNTS THREE UNITS AND NEVER MIXES THEM
//   entries    — rows in the catalogue
//   operators  — distinct payTo addresses, i.e. who gets paid
//   hosts      — distinct hostnames, i.e. where the thing runs
// One operator can hold thousands of entries across dozens of hosts. Any single
// number here without its unit attached is a number that will be quoted wrongly
// later, which is the whole lesson of the fleet count on /registry.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not register anything and holds no credentials. Discovery answers
// without auth; that is the entire access this needs.
//
// Usage:
//   node scripts/x402-bazaar-scan.mjs                # scan and report
//   node scripts/x402-bazaar-scan.mjs --self-test    # pin the counting, no network
//   node scripts/x402-bazaar-scan.mjs --out <file>   # also write the raw rows

const DISCOVERY = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';

// Measured 2026-09-01: the endpoint honours limit up to at least 1000, so the
// whole catalogue is fifteen requests rather than seven hundred. It is somebody
// else's server and the polite size is the largest one they will serve.
const PAGE = 1000;

// BNB Chain, in the CAIP-2 form the catalogue uses. Named because the one thing
// this repo needs to know about the Bazaar is whether the chain it is built on
// can be paid on there at all.
const BSC = 'eip155:56';

// What the CDP facilitator will actually settle, per its own documentation
// (read 2026-09-01). This list matters more than anything a seller advertises:
// getting listed requires a settled payment THROUGH that facilitator, so a
// network missing from here cannot be the way in, however many rows name it.
const CDP_SETTLES = new Set([
  'eip155:8453',   // Base
  'eip155:137',    // Polygon
  'eip155:42161',  // Arbitrum
  'eip155:480',    // World
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
]);

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const host = (url) => { try { return new URL(url).host; } catch { return null; } };

/**
 * Everything the report says, derived from the rows and nothing else.
 *
 * Pulled out as a pure function so the counting can be pinned against invented
 * rows below. A summariser that has only ever been run against the live
 * catalogue has been watched agreeing with itself.
 */
export function summarise(items) {
  const operators = new Map();   // payTo -> entry count
  const hosts = new Set();
  const networks = new Map();    // caip2 -> entry count
  const assets = new Map();      // network|asset -> entry count
  const types = new Map();       // http | mcp | ...
  let priced = 0;                // rows that name at least one way to pay
  let bazaarBlock = 0;           // rows carrying the extensions.bazaar the docs require

  for (const it of items) {
    types.set(it.type || 'unknown', (types.get(it.type || 'unknown') || 0) + 1);
    const h = host(it.resource);
    if (h) hosts.add(h);
    if (it.extensions && it.extensions.bazaar) bazaarBlock++;

    const accepts = Array.isArray(it.accepts) ? it.accepts : [];
    if (accepts.length) priced++;
    // One row can offer several ways to pay. The row is counted once per
    // distinct payTo it names, never once per accepts entry — otherwise a
    // service that offers three schemes to one wallet would inflate that
    // wallet's share threefold, which is exactly the arithmetic this script
    // exists to catch in other people's numbers.
    const payees = new Set();
    for (const a of accepts) {
      const p = (a.payTo || a.recipient || '').toLowerCase();
      if (p) payees.add(p);
      const n = a.network || 'unknown';
      networks.set(n, (networks.get(n) || 0) + 1);
      if (a.asset) assets.set(`${n}|${a.asset.toLowerCase()}`, (assets.get(`${n}|${a.asset.toLowerCase()}`) || 0) + 1);
    }
    for (const p of payees) operators.set(p, (operators.get(p) || 0) + 1);
  }

  const ranked = [...operators.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0] || null;
  return {
    entries: items.length,
    operators: operators.size,
    hosts: hosts.size,
    priced,
    bazaar_block: bazaarBlock,
    types: [...types.entries()].sort((a, b) => b[1] - a[1]),
    networks: [...networks.entries()].sort((a, b) => b[1] - a[1]),
    assets: [...assets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    top_operator: top ? { payTo: top[0], entries: top[1], share_pct: +(100 * top[1] / (items.length || 1)).toFixed(1) } : null,
    // The concentration figure that decided the B402 question. If the largest
    // operator holds most of the catalogue, the catalogue is that operator.
    top5_share_pct: +(100 * ranked.slice(0, 5).reduce((n, r) => n + r[1], 0) / (items.length || 1)).toFixed(1),
    mcp_entries: types.get('mcp') || 0,
    bsc_entries: networks.get(BSC) || 0,
    ...bscRoute(items),
  };
}

/**
 * Can a BSC-only service be listed here at all?
 *
 * The catalogue naming BNB Chain is not the same question as BNB Chain being a
 * way IN, and conflating the two is how an afternoon gets spent building a
 * second payment rail nobody needed. A row is listed because a payment settled
 * through the CDP facilitator; a row may then advertise any number of further
 * networks that the facilitator never touched.
 *
 * So this counts the only thing that distinguishes the two readings: rows that
 * offer BNB Chain and NOTHING the facilitator settles. If that number is zero
 * across a full catalogue, no BSC-only listing exists, and the reason our
 * service is not in there is not an oversight.
 */
function bscRoute(items) {
  let offering = 0, alsoSettleable = 0, bscOnly = 0;
  for (const it of items) {
    const nets = new Set((it.accepts || []).map((a) => a.network));
    if (!nets.has(BSC)) continue;
    offering++;
    if ([...nets].some((n) => CDP_SETTLES.has(n))) alsoSettleable++; else bscOnly++;
  }
  return { bsc_rows: offering, bsc_rows_also_settleable: alsoSettleable, bsc_only_rows: bscOnly };
}

async function scan() {
  const items = [];
  let total = null;
  for (let offset = 0; total === null || offset < total; offset += PAGE) {
    const r = await fetch(`${DISCOVERY}?limit=${PAGE}&offset=${offset}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error(`discovery answered ${r.status} at offset ${offset}`);
    const j = await r.json();
    const page = j.items || [];
    items.push(...page);
    if (total === null) total = j.pagination?.total ?? page.length;
    process.stdout.write(`\r  read ${items.length} of ${total}   `);
    // A page that comes back empty before the stated total means the catalogue
    // moved under us mid-scan. Stopping is right; pretending we read the rest
    // is not.
    if (!page.length) break;
    await new Promise((res) => setTimeout(res, 120));
  }
  process.stdout.write('\n');
  return { items, total };
}

function report(s, total) {
  const pct = (n) => `${(100 * n / (s.entries || 1)).toFixed(1)}%`;
  console.log('\nCoinbase x402 Bazaar — read in full\n');
  // Three units, each said out loud. The middle one is the one that matters.
  console.log(`  ${s.entries} entries`);
  console.log(`  ${s.operators} operators  (distinct payTo addresses — who actually gets paid)`);
  console.log(`  ${s.hosts} hosts       (distinct hostnames)`);
  if (total != null && total !== s.entries) console.log(`  catalogue stated ${total}; ${s.entries} were readable`);

  console.log('\n  Concentration');
  if (s.top_operator) {
    console.log(`    largest operator holds ${s.top_operator.entries} entries (${s.top_operator.share_pct}% of the catalogue)`);
    console.log(`    top five hold ${s.top5_share_pct}% between them`);
  }
  console.log('\n  By type');
  for (const [t, n] of s.types) console.log(`    ${String(t).padEnd(6)} ${String(n).padStart(6)}  ${pct(n)}`);

  console.log('\n  By network (counted per way to pay, so it exceeds the entry count)');
  for (const [n, c] of s.networks.slice(0, 10)) console.log(`    ${String(n).padEnd(22)} ${String(c).padStart(6)}`);

  console.log('\n  The questions this repo came to ask');
  console.log(`    entries of type mcp:                        ${s.mcp_entries}`);
  console.log(`    entries carrying an extensions.bazaar block: ${s.bazaar_block} (${pct(s.bazaar_block)})`);
  console.log(`\n    rows naming BNB Chain (${BSC}):        ${s.bsc_rows}`);
  console.log(`      of those, also offering a network CDP settles: ${s.bsc_rows_also_settleable}`);
  console.log(`      offering BNB Chain and nothing CDP settles:    ${s.bsc_only_rows}`);
  // Said in words, because this is the number the decision turns on and a
  // reader should not have to work out what a zero means.
  console.log(s.bsc_only_rows === 0 && s.bsc_rows > 0
    ? '\n    -> BNB Chain appears only ALONGSIDE a settleable network, never alone.\n'
      + '       It is advertising on top of a listing earned elsewhere, not a way in.\n'
      + '       A BSC-only service cannot be listed here; it would need to accept\n'
      + '       payment on one of the networks CDP settles.'
    : s.bsc_rows === 0
      ? '\n    -> BNB Chain does not appear in this catalogue at all.'
      : `\n    -> ${s.bsc_only_rows} rows are listed offering ONLY networks CDP does not settle.\n`
        + '       That contradicts the documented requirement and is worth reading before\n'
        + '       concluding anything: there may be a second way in.');
}

function selfTest() {
  const row = (payTo, extra = {}) => ({
    resource: 'https://example.com/a', type: 'http',
    accepts: [{ payTo, network: 'eip155:8453', asset: '0xUSDC' }], ...extra,
  });
  let bad = 0;
  const check = (name, cond) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) bad++; };

  // The B402 shape: many entries, one party. The summary has to say "1", not "3".
  const massed = summarise([row('0xAAA'), row('0xAAA'), row('0xAAA')]);
  check('three entries from one wallet count as one operator', massed.entries === 3 && massed.operators === 1);
  check('and the concentration says so', massed.top_operator.share_pct === 100);

  // The inflation this script must not commit itself: one row, three schemes,
  // one wallet is still one entry for that wallet.
  const multi = summarise([{
    resource: 'https://example.com/b', type: 'http',
    accepts: [
      { payTo: '0xBBB', network: 'eip155:8453', asset: '0xUSDC' },
      { payTo: '0xBBB', network: 'eip155:8453', asset: '0xUSDC' },
      { recipient: '0xBBB', network: 'solana:x', asset: 'sol' },
    ],
  }]);
  check('one row paying one wallet three ways is one entry for that wallet', multi.operators === 1 && multi.top_operator.entries === 1);
  check('but each way to pay is still counted as a network row', multi.networks.reduce((n, r) => n + r[1], 0) === 3);

  // Case must not split one operator into two.
  check('the same wallet in different case is one operator',
    summarise([row('0xAbC'), row('0xabc')]).operators === 1);

  // The two headline questions have to come back zero when they are zero, and
  // non-zero when they are not. A detector that can only say "none" is useless
  // the day the answer changes.
  check('reports no BNB Chain when there is none', summarise([row('0xAAA')]).bsc_entries === 0);
  check('finds BNB Chain when it is there',
    summarise([{ resource: 'https://e.com', type: 'http', accepts: [{ payTo: '0xA', network: BSC, asset: '0xU' }] }]).bsc_entries === 1);
  check('reports no mcp when there is none', summarise([row('0xAAA')]).mcp_entries === 0);
  check('finds an mcp entry when it is there', summarise([row('0xAAA', { type: 'mcp' })]).mcp_entries === 1);

  // A row nobody can pay is not a service, and must not be counted as priced.
  // The number the whole decision turns on, pinned in all three directions it
  // can point. Getting this wrong in the quiet direction would report "no way
  // in" when there was one, and in the loud direction would send us building a
  // second payment rail on a misreading.
  const onBase = { payTo: '0xA', network: 'eip155:8453', asset: '0xU' };
  const onBsc = { payTo: '0xA', network: BSC, asset: '0xU' };
  const r = (accepts) => ({ resource: 'https://e.com', type: 'http', accepts });
  const piggyback = summarise([r([onBase, onBsc])]);
  check('a BSC row that also offers Base is not a BSC way in',
    piggyback.bsc_rows === 1 && piggyback.bsc_rows_also_settleable === 1 && piggyback.bsc_only_rows === 0);
  const standalone = summarise([r([onBsc])]);
  check('a row offering ONLY BSC is reported as one',
    standalone.bsc_rows === 1 && standalone.bsc_only_rows === 1 && standalone.bsc_rows_also_settleable === 0);
  check('a row on a chain CDP does not settle either counts as not settleable',
    summarise([r([{ payTo: '0xA', network: 'xrpl:0', asset: 'x' }, onBsc])]).bsc_only_rows === 1);
  check('rows without BSC are not counted in any of the three',
    summarise([r([onBase])]).bsc_rows === 0);

  check('a row with no way to pay is not counted as priced',
    summarise([{ resource: 'https://e.com', type: 'http', accepts: [] }]).priced === 0);
  check('an empty catalogue does not divide by zero',
    summarise([]).entries === 0 && summarise([]).top5_share_pct === 0);

  console.log(bad ? `\nself-test FAILED: ${bad}` : '\nself-test passed: the units cannot collapse into each other');
  process.exit(bad ? 1 : 0);
}

if (has('--self-test')) selfTest();

const { items, total } = await scan();
const s = summarise(items);
report(s, total);

const out = valueOf('--out');
if (out) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, JSON.stringify({ read_at: new Date().toISOString(), total, summary: s, items }, null, 1));
  console.log(`\n  raw rows written to ${out}`);
}
