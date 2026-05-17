// $BOBAI Worldcup '26 — Profile + Wallet helpers
(function(){
  const sb = window.WC_SB;

  async function updateAvatar(country){
    const p = await window.WC_AUTH.currentProfile();
    if (!p) return { error: 'Not signed in.' };
    const { error } = await sb
      .from('wc_users')
      .update({ avatar_country: country || null })
      .eq('id', p.id);
    if (error) return { error: error.message };
    return { ok: true };
  }

  // Link a BEP-20 wallet to the current account.
  // Server enforces: (a) wallet is UNIQUE across all accounts; (b) once set,
  // it cannot be changed. So this call is effectively a one-shot — UI must
  // confirm the address with the user before invoking it.
  async function saveWallet(address){
    const addr = (address || '').trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) {
      return { error: 'Invalid BEP-20 address. It must start with 0x and contain 40 hex characters.' };
    }
    const p = await window.WC_AUTH.currentProfile();
    if (!p) return { error: 'Not signed in.' };
    if (p.wallet) {
      return { error: 'Your account already has a wallet linked. The wallet is permanent.' };
    }
    const { error } = await sb
      .from('wc_users')
      .update({ wallet: addr })
      .eq('id', p.id);
    if (error) {
      // Surface the UNIQUE-violation as a friendly message — Postgres returns
      // 23505 with a constraint name we don't want to leak to the user.
      if ((error.code === '23505') || /duplicate|unique/i.test(error.message)) {
        return { error: 'This wallet is already linked to another account. Each wallet can only be used once.' };
      }
      // Server immutability trigger fires if someone tries a second update.
      if (/permanent once linked/i.test(error.message)) {
        return { error: 'Wallet is permanent once linked — contact support to correct it.' };
      }
      return { error: error.message };
    }
    return { ok: true };
  }

  // ============== BONUS QUESTIONS ==============

  async function getBonus(){
    const p = await window.WC_AUTH.currentProfile();
    if (!p) return { error: 'Not signed in.' };
    const { data, error } = await sb
      .from('wc_bonus')
      .select('champion, most_goals_team, fewest_goals_team, red_cards_bracket, topscorer_country, points, resolved')
      .eq('user_id', p.id)
      .maybeSingle();
    if (error) return { error: error.message };
    return { ok: true, bonus: data || null, userId: p.id };
  }

  async function saveBonus(fields){
    const p = await window.WC_AUTH.currentProfile();
    if (!p) return { error: 'Not signed in.' };
    const payload = {
      user_id: p.id,
      champion:          fields.champion          || null,
      most_goals_team:   fields.most_goals_team   || null,
      fewest_goals_team: fields.fewest_goals_team || null,
      red_cards_bracket: fields.red_cards_bracket || null,
      topscorer_country: fields.topscorer_country || null,
      updated_at: new Date().toISOString(),
    };
    // Upsert on PK user_id
    const { error } = await sb.from('wc_bonus').upsert(payload, { onConflict: 'user_id' });
    if (error) return { error: error.message };
    return { ok: true };
  }

  // ============== MATCHES & TIPS ==============

  async function loadMatches(){
    const { data, error } = await sb
      .from('wc_matches')
      .select('id, phase, group_letter, team_home, team_away, kickoff_utc, goals_home, goals_away, played, multiplier')
      .order('kickoff_utc', { ascending: true });
    if (error) return { error: error.message };
    return { ok: true, matches: data || [] };
  }

  async function loadMyTips(){
    const p = await window.WC_AUTH.currentProfile();
    if (!p) return { error: 'Not signed in.' };
    const { data, error } = await sb
      .from('wc_tips')
      .select('match_id, tip_home, tip_away, points_final, resolved')
      .eq('user_id', p.id);
    if (error) return { error: error.message };
    const byMatch = {};
    (data || []).forEach(t => { byMatch[t.match_id] = t; });
    return { ok: true, tips: byMatch, userId: p.id };
  }

  async function saveTip(matchId, tipHome, tipAway){
    const p = await window.WC_AUTH.currentProfile();
    if (!p) return { error: 'Not signed in.' };
    if (!Number.isInteger(tipHome) || tipHome < 0 || tipHome > 30) return { error: 'Home score must be 0–30.' };
    if (!Number.isInteger(tipAway) || tipAway < 0 || tipAway > 30) return { error: 'Away score must be 0–30.' };
    const payload = {
      user_id: p.id,
      match_id: matchId,
      tip_home: tipHome,
      tip_away: tipAway,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from('wc_tips').upsert(payload, { onConflict: 'user_id,match_id' });
    if (error) return { error: error.message };
    return { ok: true };
  }

  // ============== CRYPTO PREDICTIONS ==============

  async function getCrypto(){
    const p = await window.WC_AUTH.currentProfile();
    if (!p) return { error: 'Not signed in.' };
    const { data, error } = await sb
      .from('wc_crypto')
      .select('btc_price, bnb_price, bobai_price, btc_diff, bnb_diff, bobai_diff, resolved')
      .eq('user_id', p.id)
      .maybeSingle();
    if (error) return { error: error.message };
    return { ok: true, crypto: data || null };
  }

  async function saveCrypto({ btc, bnb, bobai }){
    const p = await window.WC_AUTH.currentProfile();
    if (!p) return { error: 'Not signed in.' };
    const payload = {
      user_id: p.id,
      btc_price:   btc   != null ? btc   : null,
      bnb_price:   bnb   != null ? bnb   : null,
      bobai_price: bobai != null ? bobai : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from('wc_crypto').upsert(payload, { onConflict: 'user_id' });
    if (error) return { error: error.message };
    return { ok: true };
  }

  // ============== LIVE PRICE FEEDS ==============
  // BTC + BNB → Binance public API (no auth)
  // BOBAI    → GeckoTerminal (existing)
  const BOBAI_POOL = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';

  async function fetchLivePrices(){
    const out = { btc: null, bnb: null, bobai: null, ts: Date.now() };
    try {
      const [btcR, bnbR, geckoR] = await Promise.allSettled([
        fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT').then(r => r.json()),
        fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT').then(r => r.json()),
        fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/pools/${BOBAI_POOL}`).then(r => r.json()),
      ]);
      if (btcR.status === 'fulfilled' && btcR.value?.price)  out.btc  = parseFloat(btcR.value.price);
      if (bnbR.status === 'fulfilled' && bnbR.value?.price)  out.bnb  = parseFloat(bnbR.value.price);
      if (geckoR.status === 'fulfilled') {
        const px = geckoR.value?.data?.attributes?.base_token_price_usd;
        if (px) out.bobai = parseFloat(px);
      }
    } catch (e) { /* swallow — partial results ok */ }
    return out;
  }

  // ============== LEADERBOARDS + POOL ==============

  async function loadOverallLeaderboard(){
    const { data, error } = await sb
      .from('wc_leaderboard')
      .select('*')
      .order('total_points', { ascending: false })
      .limit(500);
    if (error) return { error: error.message };
    return { ok: true, rows: data || [] };
  }

  async function loadGroupLeaderboard(letter){
    const { data, error } = await sb
      .from('wc_leaderboard_group')
      .select('*')
      .eq('group_letter', letter)
      .order('group_points', { ascending: false })
      .limit(500);
    if (error) return { error: error.message };
    return { ok: true, rows: data || [] };
  }

  async function loadCryptoLeaderboard(coin){
    // coin = 'btc' | 'bnb' | 'bobai'
    const diffCol = coin + '_diff';
    const { data, error } = await sb
      .from('wc_leaderboard_crypto')
      .select('*')
      .order(diffCol, { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) return { error: error.message };
    return { ok: true, rows: data || [] };
  }

  async function loadPool(){
    const { data, error } = await sb
      .from('wc_pool')
      .select('total_bobai, group_pot, endpool, crypto_pot, bobai_price_usd, updated_at')
      .eq('id', 1)
      .maybeSingle();
    if (error) return { error: error.message };
    return { ok: true, pool: data || null };
  }

  window.WC_PROFILE = {
    updateAvatar,
    saveWallet,
    getBonus, saveBonus,
    loadMatches, loadMyTips, saveTip,
    getCrypto, saveCrypto, fetchLivePrices,
    loadOverallLeaderboard, loadGroupLeaderboard, loadCryptoLeaderboard, loadPool,
  };
})();
