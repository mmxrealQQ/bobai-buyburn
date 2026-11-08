// BOBAI Worldcup '26 — App Config (public-safe values only)
window.WC_CONFIG = {
  SUPABASE_URL: 'https://aerffjhdsbxpvuulkryr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ne0MFzyCQb6MvFWur2X-Vw_vG9JH76_',
  // Auth uses the user's real email (required for password reset).
  // Login accepts username OR email; see auth.js for the username→email resolver.
  // Kickoff & registration windows (UTC)
  REG_OPEN_UTC:  '2026-06-04T12:00:00Z',
  KICKOFF_UTC:   '2026-06-11T19:00:00Z',
  // Bonus + Crypto edit deadline — one-time extension after MD1 to give late joiners a fair chance.
  // Locks 15 min before the first MD2 match (CZ–ZA, 2026-06-18 16:00 UTC). Crypto scoring snapshot still happens at Final kickoff.
  BONUS_CRYPTO_LOCK_UTC: '2026-06-18T15:45:00Z',
  // BOBAI token (BSC)
  BOBAI_TOKEN: '0x245c386dcfed896f5c346107596141e5edcbffff',
  // Prize wallet (Phase H) — public BSC address, receives BNB/USDT donations + 26% creator tax post-04.06
  PRIZE_WALLET: '0x5E4102520A71B2AA18a1208330d4848dea4BD105',
  // USDT (BEP-20) contract on BSC — for donation address copy + future integration
  USDT_BSC: '0x55d398326f99059fF775485246999027B3197955',
  // Pool fill starts at kickoff (matches KICKOFF_UTC). Display gating only — actual on-chain flow handled by worker.
  POOL_FILL_START_UTC: '2026-06-11T19:00:00Z',
};
