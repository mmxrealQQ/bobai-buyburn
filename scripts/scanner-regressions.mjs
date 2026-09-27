#!/usr/bin/env node
// Pins the pool scanner's reads of WHO holds a token, who holds its LP, how old
// it is and who trades it (dashboard/scanner-chain.js: readHolders, lpCustody,
// contractAges, activityFromSwaps, KNOWN_HOLDERS) — each both ways. Offline:
// fetch is replaced by a small fake chain that answers eth_call balanceOf,
// eth_getCode (per block), eth_getLogs and block headers from fixtures, so a
// pin says what the code makes of a chain state, not what BSC holds today.
// Added 2026-09-27 with the review items B1, B2, I1 and I2.
//
//   node scripts/scanner-regressions.mjs      (self-tests.mjs runs it as it is)
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
registerHooks({
  load(url, ctx, next) { return /\/(dashboard|shared)\/[^/]+\.js$/.test(url) ? next(url, { ...ctx, format: 'module' }) : next(url, ctx); },
});
const C = await import(pathToFileURL(path.resolve(import.meta.dirname, '../dashboard/scanner-chain.js')).href);

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

// ---- the fake chain ----------------------------------------------------------
const w = (n) => BigInt(n).toString(16).padStart(64, '0');
const topicOf = (a) => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();
const A = (c) => '0x' + c.repeat(40);
let chain = { head: 1000000, balances: {}, code: {}, logs: [] };
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  const one = (q) => {
    const [p0, p1] = q.params || [];
    let result = null;
    if (q.method === 'eth_blockNumber') result = '0x' + chain.head.toString(16);
    else if (q.method === 'eth_call') {
      const to = p0.to.toLowerCase(), who = ('0x' + p0.data.slice(-40)).toLowerCase();
      result = '0x' + w(p0.data.startsWith('0x70a08231') ? (chain.balances[to]?.[who] ?? 0n) : 0n);
    } else if (q.method === 'eth_getCode') {
      const born = chain.code[p0.toLowerCase()];
      const at = p1 === 'latest' ? chain.head : parseInt(p1, 16);
      result = born != null && at >= born ? '0x6080' : '0x';
    } else if (q.method === 'eth_getBlockByNumber') result = { timestamp: '0x' + (1.7e9 + parseInt(p0, 16)).toString(16) };
    else if (q.method === 'eth_getLogs') result = chain.logs.filter((l) => l.address === p0.address.toLowerCase());
    return { jsonrpc: '2.0', id: q.id, result };
  };
  const out = Array.isArray(body) ? body.map(one) : one(body);
  return { ok: true, json: async () => out };
};

// ---- B2: the known holders ---------------------------------------------------
ok('Binance 8 is an exchange, veCAKE a lock, PinkLock a locker, the dead address a burn',
  C.knownHolder('0xF977814e90dA44bFA03b6295A0616a897441aceC')?.kind === 'exchange' && C.knownHolder('0x45c54210128a065de780c4b0df3d16664f7f859e')?.kind === 'lock'
  && C.knownHolder('0x407993575c91ce7643a4d4ccacc9a98c36ee1bbe')?.kind === 'locker' && C.knownHolder(C.DEAD)?.kind === 'burn');
ok('… and an ordinary wallet is none of them', C.knownHolder(A('1')) === null);

// ---- B1 + B2: readHolders ------------------------------------------------------
const TOKEN = A('7'), gpOk = { token_name: 'T' };
const base = { token: TOKEN, tokDec: 18, supply: 1000, burned: 0 };
let h = await C.readHolders({ ...base, gp: null });
ok('GoPlus silent: holders unknown, with the reason', h.unknown === true && /did not answer/.test(h.reason));
h = await C.readHolders({ ...base, gp: { ...gpOk, holder_count: '0', holders: [] } });
ok('an empty list (a token minutes old): unknown, never "spread out"', h.unknown === true && /no holders/.test(h.reason));
h = await C.readHolders({ ...base, gp: { ...gpOk, holder_count: '3', holders: [{ address: A('9') }, { address: C.DEAD }, { address: A('8') }] } });
ok('three holders counted (GOL at the review): unknown — the index has not caught up', h.unknown === true && /counts 3 holders/.test(h.reason));
h = await C.readHolders({ ...base, gp: { ...gpOk, holder_count: '40', holders: [{ address: A('9') }, { address: C.DEAD }, { address: A('8') }] }, skip: [A('9')], lpOwners: [A('8')] });
ok('a list that is only the pool, the burn address and the LP holder: unknown', h.unknown === true && /plumbing/.test(h.reason));
const BIN8 = '0xf977814e90da44bfa03b6295a0616a897441acec';
chain.balances[TOKEN] = { [BIN8]: 234n * 10n ** 18n, [A('1')]: 35n * 10n ** 18n, [A('2')]: 30n * 10n ** 18n };
h = await C.readHolders({ ...base, gp: { ...gpOk, holder_count: '1900000', holders: [{ address: BIN8 }, { address: A('1'), is_contract: 1 }, { address: A('2') }] } });
ok('a real list is read: Binance 8 is out of the figure and named with its share', !h.unknown && h.largestPct === 3.5 && h.top[0].address === A('1') && h.excluded?.[0]?.name === 'Binance 8' && h.excluded[0].pct === 23.4, JSON.stringify(h));
ok('… and the count and top-10 figure stand on the wallets left', h.count === 1900000 && h.top10PctOfCirculating === 6.5 && h.wallets === 2, JSON.stringify(h));

// ---- I1: lpCustody -------------------------------------------------------------
const PAIR = A('5'), DEP = A('d'), FEE = A('f'), RUG = A('e');
const xfer = (from, to, v, block = 999000) => ({ address: PAIR, topics: [C.XFER_T, topicOf(from), topicOf(to)], data: '0x' + w(v), blockNumber: '0x' + block.toString(16), blockTimestamp: '0x' + (1.7e9 + block).toString(16) });
chain.logs = [xfer(C.NULLA, C.NULLA, 1000n, 998000), xfer(C.NULLA, DEP, 10n ** 21n, 998000)];
chain.balances[PAIR] = { [DEP]: 10n ** 21n, [C.NULLA]: 1000n };
let cu = await C.lpCustody({ pair: PAIR, lpTot: 1000, feeTo: FEE, gp: { creator_address: DEP }, head: chain.head });
ok('a pair born inside the log window: the ledger is complete, the creator holds 100% as a wallet', cu.read === 'complete' && cu.largestWallet?.address === DEP && cu.largestWallet.pct === 100 && cu.largestWallet.deployer && cu.walletPct === 100 && cu.unreadPct === 0 && cu.pairCreatedBlock === 998000, JSON.stringify(cu));
chain.code[DEP] = 1;
cu = await C.lpCustody({ pair: PAIR, lpTot: 1000, feeTo: FEE, gp: { creator_address: DEP }, head: chain.head });
ok('… the same holder with contract code is a contract, not a wallet anybody can name as pullable', cu.largestWallet === null && cu.contractPct === 100, JSON.stringify(cu));
delete chain.code[DEP];
chain.logs = [xfer(C.NULLA, C.NULLA, 1000n, 998000), xfer(C.NULLA, DEP, 10n ** 21n, 998000), xfer(DEP, RUG, 10n ** 21n, 998500), xfer(RUG, PAIR, 10n ** 21n, 998600), xfer(PAIR, C.NULLA, 10n ** 21n, 998600), xfer(C.NULLA, FEE, 10n ** 18n, 998600)];
chain.balances[PAIR] = { [FEE]: 10n ** 18n, [C.NULLA]: 1000n };
cu = await C.lpCustody({ pair: PAIR, lpTot: 1, feeTo: FEE, gp: { creator_address: DEP }, head: chain.head });
ok('liquidity already pulled (SUPE): named with its share of all LP ever minted, and nobody left to pull', cu.withdrawnSinceCreation?.[0]?.address === RUG && cu.withdrawnSinceCreation[0].pctOfLpEverMinted > 99 && cu.largestWallet === null && cu.exchangeFeePct === 100, JSON.stringify(cu));
chain.logs = [];
chain.balances[PAIR] = { [C.DEAD]: 900n * 10n ** 18n, '0x407993575c91ce7643a4d4ccacc9a98c36ee1bbe': 50n * 10n ** 18n };
chain.code['0x407993575c91ce7643a4d4ccacc9a98c36ee1bbe'] = 1;
cu = await C.lpCustody({ pair: PAIR, lpTot: 1000, feeTo: FEE, gp: null, head: chain.head });
ok('an older pair: partial, burned and PinkLock-locked read by name, the rest said as unread', cu.read === 'partial' && cu.burnedPct === 90 && cu.lockedPct === 5 && cu.unreadPct === 5 && cu.largestWallet === null, JSON.stringify(cu));

// ---- I2: contractAges ----------------------------------------------------------
chain.code = { [A('a')]: 999100, [A('b')]: 123457 };
const ages = await C.contractAges([A('a'), A('b'), A('c')]);
ok('a contract 900 blocks old is dated to within 20 blocks, at or after its real birth', ages[A('a')] && ages[A('a')].createdBlock >= 999100 && ages[A('a')].createdBlock - 999100 <= 20 && ages[A('a')].createdAfterBlock < 999100, JSON.stringify(ages[A('a')]));
const oldAge = chain.head - 123457;
ok('… one from far back to within 0.2% of its age (three rounds), never before its birth', ages[A('b')] && ages[A('b')].createdBlock >= 123457 && ages[A('b')].createdBlock - 123457 <= oldAge * 0.002 && ages[A('b')].createdAfterBlock < 123457, JSON.stringify(ages[A('b')]));
ok('… and an address with no code at all is not dated at all (null — never "born this minute")', ages[A('c')] === null, JSON.stringify(ages[A('c')]));

// ---- I2: activityFromSwaps -----------------------------------------------------
const E18 = 10n ** 18n;
const v2 = (a0i, a1i, a0o, a1o, to, tx) => ({ data: '0x' + w(a0i) + w(a1i) + w(a0o) + w(a1o), topics: [C.SWAP_T, topicOf(A('0')), topicOf(to)], transactionHash: tx });
const logs = [v2(0n, 2n * E18, 100n * E18, 0n, A('1'), '0xb1'), v2(0n, E18, 50n * E18, 0n, A('1'), '0xb2'), v2(40n * E18, 0n, 0n, 3n * E18, A('9'), '0xs1')];
let act = C.activityFromSwaps(logs, { kind: 'v2', tokenIs0: true, sellers: new Map([['0xs1', A('3')]]), quoteUsd: 600 });
ok('V2, token as token0: two buys, one sell, the volume and the largest sell in the quote and in dollars', act.buys === 2 && act.sells === 1 && act.volumeQuote === 6 && act.largestSellQuote === 3 && act.largestSellUsd === 1800 && act.uniqueBuyers === 1 && act.uniqueTraders === 2, JSON.stringify(act));
act = C.activityFromSwaps(logs, { kind: 'v2', tokenIs0: false, sellers: null, quoteUsd: 600 });
ok('… the same swaps with the token as token1 read the other way round, and no seller read is null, not 0', act.buys === 1 && act.sells === 2 && act.uniqueSellers === null && act.uniqueTraders === null, JSON.stringify(act));
const neg = (v) => (BigInt(1) << 256n) - v;
const v3 = (a0, a1, to) => ({ data: '0x' + w(a0 < 0n ? neg(-a0) : a0) + w(a1 < 0n ? neg(-a1) : a1) + w(0n).repeat(3), topics: [C.SWAP_V3_T, topicOf(A('0')), topicOf(to)], transactionHash: '0x' + to.slice(2, 6) });
act = C.activityFromSwaps([v3(-100n * E18, 2n * E18, A('1')), v3(80n * E18, -E18, A('2'))], { kind: 'v3', tokenIs0: true, sellers: new Map(), quoteUsd: 1 });
ok('V3 signed amounts: token out is a buy, token in is a sell', act.buys === 1 && act.sells === 1 && act.volumeQuote === 3 && act.largestSellQuote === 1, JSON.stringify(act));

console.log(fails ? `\n${fails} FAILED` : '\nscanner: all pins hold');
process.exit(fails ? 1 : 0);
