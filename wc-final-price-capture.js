// WC26 Final — freeze BTC/BNB/BOBAI prices at the exact Final kickoff
// (2026-07-19 19:00:00 UTC). These are the reference prices for resolving
// the wc_crypto predictions (rules: "prices at the exact moment of the
// World Cup Final kickoff").
//
// Primary sources = exactly what the app's live display uses (profile.js):
//   BTC/BNB  → Binance  api.binance.com/api/v3/ticker/price
//   BOBAI    → GeckoTerminal pool 0x6eadd…d9a6 base_token_price_usd
// Redundancy: CoinGecko (BTC/BNB) + DexScreener (BOBAI).
//
// Run modes:
//   node capture-final-kickoff-prices.js          → wait until 19:00:00 UTC,
//     sample at T-3min (warmup), T0 (PRIMARY), T+30s, T+60s
//   node capture-final-kickoff-prices.js --now    → one immediate sample (test)
//
// Output: appends JSON samples to d:\ai\fourmeme\wc-final-kickoff-prices.json

const fs = require('fs');
// Local Task-Scheduler run writes the absolute path; the GitHub-Actions
// backup run overrides via WC_PRICE_OUT (repo-relative, gets committed).
const OUT = process.env.WC_PRICE_OUT || 'd:\\ai\\fourmeme\\wc-final-kickoff-prices.json';
const KICKOFF_UTC = '2026-07-19T19:00:00.000Z';
const BOBAI_POOL = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';
const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';

async function j(url, timeoutMs = 8000) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const body = await r.json();
    return { ok: r.ok, ms: Date.now() - t0, body };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e) };
  } finally {
    clearTimeout(to);
  }
}

async function sample(label) {
  const at = new Date().toISOString();
  const [btc, bnb, gecko, cg, ds] = await Promise.all([
    j('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
    j('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT'),
    j(`https://api.geckoterminal.com/api/v2/networks/bsc/pools/${BOBAI_POOL}`),
    j('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,binancecoin&vs_currencies=usd'),
    j(`https://api.dexscreener.com/latest/dex/tokens/${BOBAI_TOKEN}`),
  ]);
  const out = {
    label,
    sampled_at: at,
    primary: {
      btc_usd: btc.ok ? parseFloat(btc.body.price) : null,
      bnb_usd: bnb.ok ? parseFloat(bnb.body.price) : null,
      bobai_usd: gecko.ok ? parseFloat(gecko.body?.data?.attributes?.base_token_price_usd) : null,
      sources: 'binance (btc/bnb) + geckoterminal pool (bobai) — same as app live display',
    },
    redundancy: {
      btc_usd_coingecko: cg.ok ? cg.body?.bitcoin?.usd ?? null : null,
      bnb_usd_coingecko: cg.ok ? cg.body?.binancecoin?.usd ?? null : null,
      bobai_usd_dexscreener: ds.ok ? parseFloat(ds.body?.pairs?.[0]?.priceUsd) || null : null,
    },
    latency_ms: { btc: btc.ms, bnb: bnb.ms, gecko: gecko.ms, coingecko: cg.ms, dexscreener: ds.ms },
    errors: [btc, bnb, gecko, cg, ds].filter(r => !r.ok).map(r => r.error || 'http error'),
  };
  let all = [];
  try { all = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }
  all.push(out);
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
  console.log(`[${label}] ${at} BTC=${out.primary.btc_usd} BNB=${out.primary.bnb_usd} BOBAI=${out.primary.bobai_usd}`);
  return out;
}

function sleepUntil(tsMs) {
  return new Promise(res => {
    const wait = tsMs - Date.now();
    if (wait <= 0) return res();
    setTimeout(res, wait);
  });
}

(async () => {
  if (process.argv.includes('--now')) {
    await sample('test-now');
    return;
  }
  const t0 = new Date(KICKOFF_UTC).getTime();
  if (Date.now() > t0 + 10 * 60 * 1000) {
    console.error('Kickoff is more than 10 min in the past — refusing to overwrite history. Use --now for a test sample.');
    process.exit(1);
  }
  console.log('Waiting for Final kickoff', KICKOFF_UTC, '— now:', new Date().toISOString());
  await sleepUntil(t0 - 3 * 60 * 1000); await sample('warmup-T-3min');
  await sleepUntil(t0);                 await sample('KICKOFF-T0-PRIMARY');
  await sleepUntil(t0 + 30 * 1000);     await sample('T+30s');
  await sleepUntil(t0 + 60 * 1000);     await sample('T+60s');
  console.log('Done. Frozen prices in', OUT);
})();
