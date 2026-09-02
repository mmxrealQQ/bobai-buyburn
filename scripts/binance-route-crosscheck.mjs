#!/usr/bin/env node
// A second opinion on the one number we would most hate to be quietly wrong
// about: what a trade of a given size actually returns.
//
// Our pancakeswap_best_route quotes PancakeSwap only — every pool the pair
// lives in, quoted by the venue itself, plus the round trip with the transfer
// tax that no quoter can see. It says so on the page. What it has never had is
// somebody else's answer to the same question. Binance's Web3 Trading API
// aggregates across DEXes and hops, so it can only be equal or better on the
// buy leg if both are right — and if it is materially WORSE, one of the two is
// wrong, and that is worth knowing before anybody sizes a trade on ours.
//
// THE SAME QUESTION, NOT A SIMILAR ONE
// Our tool now publishes `you_pay.raw`: the exact raw amount of the quote token
// it asked the quoter about. That raw amount goes to Binance unchanged. A
// cross-check that re-derived "$250 of BNB" from its own price feed would be
// comparing two prices as much as two routes.
//
// It runs from here. The Binance key stays in .env on this machine and never
// enters a worker: external APIs do not belong in the things that hold money,
// and this project already keeps that line. Read-only: nothing here can sign
// a transaction.
//
// Usage:
//   node scripts/binance-route-crosscheck.mjs [--token 0x…] [--usd 250]
//   node scripts/binance-route-crosscheck.mjs --self-test
import 'dotenv/config';
import { callWeb3, credentials } from './lib/binance-web3.mjs';

const OURS = 'https://brainonbnb.com/api/best-route';
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
const BSC = '56';

const arg = (n, d) => { const i = process.argv.indexOf(n); const v = i >= 0 ? process.argv[i + 1] : null; return v && !v.startsWith('--') ? v : d; };

// Pure, so the self-test can pin it: what the two answers say about each
// other. `diff_pct` is Binance relative to ours — positive means the
// aggregator found more. The verdict thresholds are deliberately asymmetric:
// an aggregator with more venues beating a single-venue quote by a little is
// the expected shape; a single-venue quote beating the aggregator by much is a
// finding about one of the two tools.
export function compare({ ours, theirs, decimals }) {
  const ourOut = Number(ours.you_would_receive);
  const theirOut = Number(theirs.toTokenAmount) / 10 ** decimals;
  if (!(ourOut > 0) || !(theirOut > 0)) throw new Error('one of the two quotes is not a positive amount');
  const diff = (theirOut / ourOut - 1) * 100;
  let verdict;
  if (diff > 5) verdict = 'the aggregator returns materially more — our single-venue figure understates what a router would get';
  else if (diff >= -1) verdict = 'the two agree within a percent — our figure holds as a PancakeSwap quote';
  else if (diff >= -5) verdict = 'ours is a few percent better — plausible if the aggregator routed through more hops and fees, worth a second sample';
  else verdict = 'ours is materially better than an aggregator with more venues — one of the two is wrong, do not size a trade on ours until this is understood';
  return { our_out: +ourOut.toFixed(8), their_out: +theirOut.toFixed(8), diff_pct: +diff.toFixed(4), verdict };
}

// The Binance route string is the hop list joined by "--"; a direct swap has
// two addresses, anything longer went through intermediates.
export const hops = (router) => (router ? String(router).split('--').length - 1 : null);

if (process.argv.includes('--self-test')) {
  let n = 0; const bad = [];
  const t = (name, cond) => { n++; if (!cond) bad.push(name); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); };
  const ours = { you_would_receive: 100 };
  const at = (out) => ({ toTokenAmount: String(BigInt(Math.round(out * 1e6)) * 10n ** 12n) });
  t('equal quotes agree', /agree/.test(compare({ ours, theirs: at(100), decimals: 18 }).verdict));
  t('half a percent under still agrees', /agree/.test(compare({ ours, theirs: at(99.5), decimals: 18 }).verdict));
  t('three percent under asks for a second sample', /second sample/.test(compare({ ours, theirs: at(97), decimals: 18 }).verdict));
  t('ten percent under is a finding', /one of the two is wrong/.test(compare({ ours, theirs: at(90), decimals: 18 }).verdict));
  t('ten percent over says ours understates', /understates/.test(compare({ ours, theirs: at(110), decimals: 18 }).verdict));
  t('diff is signed from our side', compare({ ours, theirs: at(110), decimals: 18 }).diff_pct === 10);
  t('decimals are honoured', compare({ ours, theirs: { toTokenAmount: '110000000' }, decimals: 6 }).their_out === 110);
  let threw = false; try { compare({ ours, theirs: { toTokenAmount: '0' }, decimals: 18 }); } catch { threw = true; }
  t('a zero quote throws instead of dividing', threw);
  t('a direct route is one hop', hops('0xa--0xb') === 1);
  t('a three-address route is two hops', hops('0xa--0xb--0xc') === 2);
  t('no route is unknown, not zero', hops(null) === null);
  console.log(`\n${n - bad.length} of ${n} checks passed`);
  if (bad.length) { bad.forEach((b) => console.log(`  - ${b}`)); process.exitCode = 1; }
} else {
  const cred = credentials();
  if (!cred) {
    console.log('No BINANCE_WEB3_API_KEY / BINANCE_WEB3_API_SECRET in .env — nothing to compare against.');
    process.exitCode = 1;
  } else {
    const token = String(arg('--token', CAKE)).toLowerCase();
    const usd = Number(arg('--usd', 250)) || 250;
    console.log(`Second opinion on pancakeswap_best_route — ${token}, $${usd}\n`);

    const r = await fetch(`${OURS}?address=${token}&usd=${usd}`, { signal: AbortSignal.timeout(60000) });
    const ours = await r.json();
    if (ours.error || !ours.you_pay) {
      console.log(`ours: ${ours.error || 'the live tool does not publish you_pay yet — deploy the dashboard first'}`);
      process.exitCode = 1;
    } else {
      console.log(`ours     : ${ours.you_pay.amount} ${ours.you_pay.symbol} → ${ours.you_would_receive} ${ours.token.symbol} via ${ours.best_route} (PancakeSwap only, by design)`);

      const q = `binanceChainId=${BSC}&fromTokenAddress=${ours.quote.address}&toTokenAddress=${token}&amount=${ours.you_pay.raw}`;
      let theirs;
      try {
        const data = await callWeb3({ ...cred, path: `/api/v1/dex/aggregator/quote?${q}` });
        theirs = Array.isArray(data) ? data[0] : data;
      } catch (e) { console.log(`binance  : ${e.message}`); process.exitCode = 1; }

      if (theirs) {
        const c = compare({ ours, theirs, decimals: ours.token.decimals });
        const h = hops(theirs.router);
        console.log(`binance  : same ${ours.you_pay.raw} raw → ${c.their_out} ${ours.token.symbol} via ${theirs.vendorName || '?'}`
          + `${h != null ? `, ${h} hop${h === 1 ? '' : 's'}` : ''}`
          + `${theirs.priceImpactPercent != null ? `, impact ${theirs.priceImpactPercent}%` : ''}`);
        console.log(`\ndifference: ${c.diff_pct > 0 ? '+' : ''}${c.diff_pct}% (Binance relative to ours)`);
        console.log(`verdict   : ${c.verdict}`);
        if (h != null && h > 1) console.log(`\nnote      : Binance routed through ${h} hops. Ours is one PancakeSwap pool by design, so a small edge for the aggregator is the expected shape, not a defect.`);
        console.log(`\nmeasured  : ${new Date().toISOString()} — one sample, one size. A cross-check is a habit, not a certificate.`);
      }
    }
  }
}
