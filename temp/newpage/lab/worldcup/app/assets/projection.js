// BOBAI Worldcup '26 — Projected payout helper
// Mirrors the prize math in leaderboard.html (End-Pool / Group brackets / Crypto)
// and computes a per-user projection that lines up exactly with the leaderboard.
//
// Public API:
//   WC_PROJECTION.loadAll()                       → { pool, overall, allGroups, allCrypto, live }
//   WC_PROJECTION.compute(data, userId, opts)     → { end, groups, crypto, totalBobai, totalUsd }
//   WC_PROJECTION.loadAndCompute(userId, wallet)  → load + compute (simulateEligible=true), for own/profile cards
//   WC_PROJECTION.computeAll(data)                → array of projections for every wallet-linked user,
//                                                    sorted by totalBobai DESC. For the leaderboard payouts view.
//   WC_PROJECTION.renderHtml(proj)                → HTML for the dashboard/profile card
//   WC_PROJECTION.injectStyles()                  → adds the shared CSS once
(function(){
  const POOL_SPLIT = {
    groupTop1:  0.55,
    groupTop2:  0.30,
    groupBest3: 0.15,
    endTiers:   [0.50, 0.25, 0.15, 0.10],
  };
  const GROUP_SLOTS_TOP1  = 12;
  const GROUP_SLOTS_TOP2  = 12;
  const GROUP_SLOTS_BEST3 = 8;
  const END_TOP_N = POOL_SPLIT.endTiers.length;
  const GROUP_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const COINS = ['btc','bnb','bobai'];

  function withSelfAsEligible(rows, userId){
    return rows.map(r => r.user_id === userId ? { ...r, has_wallet: true } : r);
  }
  function isEligible(r){ return !!(r && r.has_wallet); }

  // ============== PRIZE MATH ==============
  function projectEnd(overallRows, pool, userId, simulateEligible, finalPayouts){
    const overallRank = (overallRows.findIndex(r => r.user_id === userId) + 1) || null;
    // Once the Final payout ran (wc_payouts pot=end rows exist), those
    // post-cascade amounts are the only truth — incl. 26x cap forfeits (0)
    // and the proportional redistribution to the uncapped winners.
    const endRows = (finalPayouts || []).filter(r => r.pot === 'end');
    if (endRows.length) {
      const mine = endRows.find(r => r.user_id === userId);
      if (!mine) return { overallRank, tierRank: null, prize: 0, settled: true };
      const prize = Number(mine.bobai_amount) || 0;
      return {
        overallRank,
        tierRank: Number(String(mine.position).split('_')[1]) || null,
        prize, settled: true, paid: !!mine.tx_hash, forfeit: prize === 0,
      };
    }
    const rows = simulateEligible ? withSelfAsEligible(overallRows, userId) : overallRows;
    const eligible = rows.filter(isEligible);
    const idx = eligible.findIndex(r => r.user_id === userId);
    if (idx < 0 || idx >= END_TOP_N) {
      return { overallRank, tierRank: null, prize: 0 };
    }
    return { overallRank, tierRank: idx + 1, prize: POOL_SPLIT.endTiers[idx] * (pool.end || 0) };
  }

  function projectGroups(allGroups, pool, userId, simulateEligible, groupPayouts){
    if (pool.group <= 0 && !pool.groupPaidAt) {
      return GROUP_LETTERS.map(letter => ({ letter, rank: null, prize: 0, bracket: null }));
    }
    const snapshots = allGroups.map(g => {
      const rows = simulateEligible ? withSelfAsEligible(g.rows, userId) : g.rows;
      return { letter: g.letter, rows, eligible: rows.filter(isEligible) };
    });
    // Best-3rd pool across all 12 groups — only the top 8 by group_points qualify.
    const best3Pool = [];
    snapshots.forEach(g => {
      if (g.eligible[2]) {
        best3Pool.push({ user_id: g.eligible[2].user_id, group_points: g.eligible[2].group_points || 0, letter: g.letter });
      }
    });
    const best3Keys = new Set(
      best3Pool.slice()
        .sort((a,b) => (b.group_points||0) - (a.group_points||0))
        .slice(0, GROUP_SLOTS_BEST3)
        .map(c => c.user_id + '|' + c.letter)
    );
    // Once group_paid_at is set, the post-cascade per-row amounts in
    // wc_payouts are the source of truth — they include 26x cap forfeits
    // (amount=0) and proportional redistribution bonuses to uncapped winners.
    const payoutByKey = new Map();
    (groupPayouts || []).forEach(r => {
      payoutByKey.set(`${r.user_id}|${r.group_letter}`, r);
    });
    const lookupPaid = (uid, letter) => payoutByKey.get(`${uid}|${letter}`);

    const settled = !!pool.groupPaidAt;
    return snapshots.map(g => {
      const idx = g.eligible.findIndex(r => r.user_id === userId);
      const paidRow = lookupPaid(userId, g.letter);

      // Once the group pot is settled, the ONLY truth is wc_payouts. A wallet
      // that drifted into a top-3 live slot after the freeze (daily $BOBAI
      // tie-breaker shuffle) must NOT show a phantom share it never received —
      // and a paid winner who drifted DOWN keeps their real amount.
      if (settled) {
        if (!paidRow) return { letter: g.letter, rank: null, prize: 0, bracket: null };
        const prize  = Number(paidRow.bobai_amount) || 0;
        const rank   = paidRow.position === '1st' ? 1 : paidRow.position === '2nd' ? 2 : 3;
        const bracket = paidRow.position === '1st' ? 'top1' : paidRow.position === '2nd' ? 'top2' : 'best3';
        return { letter: g.letter, rank, prize, bracket,
                 paid: true, forfeit: prize === 0, txHash: paidRow.tx_hash || null };
      }

      // Pre-settlement: live projection from current standings.
      if (idx < 0) return { letter: g.letter, rank: null, prize: 0, bracket: null };
      if (idx === 0) {
        return { letter: g.letter, rank: 1, prize: (pool.group * POOL_SPLIT.groupTop1) / GROUP_SLOTS_TOP1, bracket: 'top1' };
      }
      if (idx === 1) {
        return { letter: g.letter, rank: 2, prize: (pool.group * POOL_SPLIT.groupTop2) / GROUP_SLOTS_TOP2, bracket: 'top2' };
      }
      if (idx === 2) {
        const inBest8 = best3Keys.has(userId + '|' + g.letter);
        const rawShare = inBest8 ? (pool.group * POOL_SPLIT.groupBest3) / GROUP_SLOTS_BEST3 : 0;
        return { letter: g.letter, rank: 3, prize: rawShare, bracket: inBest8 ? 'best3' : '3rd-outside' };
      }
      return { letter: g.letter, rank: idx + 1, prize: 0, bracket: null };
    });
  }

  function projectCrypto(allCrypto, pool, livePrices, userId, simulateEligible, finalPayouts){
    const winnerPrize = (pool.crypto || 0) / 3;
    // Settled: wc_payouts pot=crypto rows carry the actual winner + amount per coin
    // (closest wallet-linked guess WITH BOBAI holdings — cap 0 → next closest).
    const cRows = (finalPayouts || []).filter(r => r.pot === 'crypto');
    if (cRows.length) {
      return COINS.map(coin => {
        const row = cRows.find(r => r.position === 'crypto_' + coin);
        const picked = (allCrypto[coin] || []).some(r => r.user_id === userId && r[coin + '_price'] != null);
        const isWinner = !!(row && row.user_id === userId);
        return {
          coin, picked, rank: null,
          totalPicks: (allCrypto[coin] || []).filter(r => r[coin + '_price'] != null).length,
          livePxAvailable: true, isWinner,
          prize: isWinner ? (Number(row.bobai_amount) || 0) : 0,
          settled: true, paid: isWinner && !!row.tx_hash,
        };
      });
    }
    return COINS.map(coin => {
      const priceKey = coin + '_price';
      const livePx = livePrices ? livePrices[coin] : null;
      const valid = (allCrypto[coin] || [])
        .filter(r => r[priceKey] != null)
        .map(r => ({ ...r, _tip: parseFloat(r[priceKey]) }))
        .filter(r => isFinite(r._tip));
      const adj = simulateEligible ? withSelfAsEligible(valid, userId) : valid;
      const sortedByTip = adj.slice().sort((a,b) => a._tip - b._tip);
      const eligibleAll = sortedByTip.filter(isEligible);
      let payoutWinnerId = null;
      if (eligibleAll.length) {
        if (livePx != null && isFinite(livePx)) {
          let bestDiff = Infinity;
          eligibleAll.forEach(row => {
            const d = Math.abs(row._tip - livePx);
            if (d < bestDiff) { bestDiff = d; payoutWinnerId = row.user_id; }
          });
        } else {
          payoutWinnerId = eligibleAll[0].user_id;
        }
      }
      const targetRow = sortedByTip.find(r => r.user_id === userId);
      let rank = null;
      if (targetRow) {
        if (livePx != null && isFinite(livePx)) {
          const ranked = sortedByTip.slice()
            .map(r => ({ r, dist: Math.abs(r._tip - livePx) }))
            .sort((a,b) => a.dist - b.dist);
          rank = ranked.findIndex(x => x.r.user_id === userId) + 1;
        } else {
          rank = sortedByTip.findIndex(r => r.user_id === userId) + 1;
        }
      }
      const isWinner = !!(targetRow && payoutWinnerId === userId);
      return {
        coin,
        picked: !!targetRow,
        rank,
        totalPicks: sortedByTip.length,
        livePxAvailable: livePx != null && isFinite(livePx),
        isWinner,
        prize: isWinner ? winnerPrize : 0,
      };
    });
  }

  // ============== DATA LOADING ==============
  async function loadAll(){
    const P = window.WC_PROFILE;
    const [poolR, overallR, allGroupsArr, allCryptoArr, live] = await Promise.all([
      P.loadPool(),
      P.loadOverallLeaderboard(),
      Promise.all(GROUP_LETTERS.map(L => P.loadGroupLeaderboard(L).then(r => ({ letter: L, rows: r.rows || [] })))),
      Promise.all(COINS.map(coin => P.loadCryptoLeaderboard(coin).then(r => ({ coin, rows: r.rows || [] })))),
      P.fetchLivePrices(),
    ]);
    if (poolR.error)    return { error: poolR.error };
    if (overallR.error) return { error: overallR.error };
    const p = poolR.pool || {};
    const pool = {
      total:        parseFloat(p.total_bobai)     || 0,
      group:        parseFloat(p.group_pot)       || 0,
      end:          parseFloat(p.endpool)         || 0,
      crypto:       parseFloat(p.crypto_pot)      || 0,
      price:        parseFloat(p.bobai_price_usd) || 0,
      groupPaidAt:  p.group_paid_at || null,
    };
    // Once a pot is paid, the actual per-row post-cascade amounts live in
    // wc_payouts. We overlay those over the raw shares so the page reflects
    // what each wallet really received (0 for 0-BOBAI forfeits, +redistributed
    // bonus for everyone else). One read covers group AND end/crypto (Final).
    let groupPayouts = [];
    let finalPayouts = [];
    {
      const r = await P.loadPayouts();
      if (!r.error) {
        const all = r.rows || [];
        groupPayouts = all.filter(x => x.pot === 'group');
        finalPayouts = all.filter(x => x.pot === 'end' || x.pot === 'crypto');
      }
    }
    pool.finalPaidAt = finalPayouts.some(x => x.tx_hash) ? (finalPayouts.find(x => x.paid_at)?.paid_at || null) : null;
    const allCrypto = {};
    allCryptoArr.forEach(c => { allCrypto[c.coin] = c.rows; });
    return {
      ok: true,
      pool,
      overall: overallR.rows || [],
      allGroups: allGroupsArr,
      allCrypto,
      live,
      groupPayouts,
      finalPayouts,
    };
  }

  function compute(data, userId, opts){
    opts = opts || {};
    const simulate = opts.simulateEligible !== false;  // default true
    const { pool, overall, allGroups, allCrypto, live, groupPayouts, finalPayouts } = data;
    const end    = projectEnd(overall, pool, userId, simulate, finalPayouts);
    const groups = projectGroups(allGroups, pool, userId, simulate, groupPayouts);
    const crypto = projectCrypto(allCrypto, pool, live, userId, simulate, finalPayouts);
    const totalBobai = end.prize
      + groups.reduce((a, g) => a + g.prize, 0)
      + crypto.reduce((a, c) => a + c.prize, 0);
    return {
      ok: true,
      pool, end, groups, crypto,
      totalBobai,
      totalUsd: pool.price > 0 ? totalBobai * pool.price : null,
    };
  }

  async function loadAndCompute(userId, userWallet){
    const data = await loadAll();
    if (data.error) return { error: data.error };
    const proj = compute(data, userId, { simulateEligible: true });
    return { ...proj, hasWallet: !!userWallet };
  }

  // Returns one projection per wallet-linked user, sorted by totalBobai DESC.
  // Each entry carries the user's display data so the leaderboard can render rows directly.
  function computeAll(data){
    const eligible = (data.overall || []).filter(isEligible);
    const list = eligible.map(u => {
      const proj = compute(data, u.user_id, { simulateEligible: false });
      return {
        user_id: u.user_id,
        username: u.username,
        avatar_country: u.avatar_country,
        has_wallet: true,
        end: proj.end,
        groups: proj.groups,
        crypto: proj.crypto,
        totalBobai: proj.totalBobai,
        totalUsd: proj.totalUsd,
      };
    });
    list.sort((a,b) => b.totalBobai - a.totalBobai);
    return list;
  }

  // ============== FORMATTERS ==============
  function fmtBobai(n){
    if (n == null) return '0';
    const v = Number(n);
    if (v >= 1_000_000) return (v/1_000_000).toFixed(2) + 'M';
    if (v >= 1_000)     return (v/1_000).toFixed(1) + 'K';
    return v.toFixed(0);
  }
  function fmtUsd(n){
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1_000_000) return '$' + (n/1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return '$' + (n/1_000).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  }
  function fmtPct(p){
    if (p == null || !isFinite(p)) return '—';
    if (p === 0)    return '0%';
    if (p < 0.01)   return '<0.01%';
    if (p < 0.1)    return p.toFixed(2) + '%';
    if (p < 10)     return p.toFixed(1)  + '%';
    return p.toFixed(0) + '%';
  }
  function tierIcon(rank){
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : ('#'+rank);
  }
  function coinName(coin){ return coin === 'bobai' ? 'BOBAI' : coin.toUpperCase(); }

  // ============== UI: SINGLE-USER CARD ==============
  function renderHtml(proj){
    if (!proj || proj.error) {
      return `<div class="proj-empty">Projection unavailable${proj && proj.error ? ': ' + proj.error : ''}.</div>`;
    }
    const { pool, end, groups, crypto, totalBobai, totalUsd, hasWallet } = proj;
    const usd  = b => pool.price > 0 ? fmtUsd(b * pool.price) : 'n/a';
    const line = (cls, icon, label, bobai, paid) => {
      const won = bobai > 0;
      const cls2 = (cls || '') + (won ? '' : ' muted') + (paid ? ' paid' : '');
      const paidPill = paid ? '<span class="proj-paid-pill">✓ paid</span>' : '';
      return `<div class="proj-line ${cls2.trim()}">
        <div class="pl-left"><span class="pl-icon">${icon}</span><span class="pl-label">${label}${paidPill}</span></div>
        <div class="pl-right">
          <div class="pl-prize">${won ? fmtBobai(bobai) + ' BOBAI' : '—'}</div>
          <div class="pl-usd">${won ? usd(bobai) : '$0'}</div>
        </div>
      </div>`;
    };

    // Overall row
    const ord = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : (n + 'th');
    let overallHtml;
    if (end.settled && end.tierRank && end.forfeit) {
      overallHtml = `<div class="proj-line forfeit">
        <div class="pl-left"><span class="pl-icon">${tierIcon(end.tierRank)}</span><span class="pl-label">Overall · End-Pool ${ord(end.tierRank)} of 4 <span class="proj-forfeit-pill">holds 0 $BOBAI · forfeited</span></span></div>
        <div class="pl-right"><div class="pl-prize">0 BOBAI</div><div class="pl-usd">$0</div></div>
      </div>`;
    } else if (end.tierRank) {
      overallHtml = line('', tierIcon(end.tierRank), `Overall · End-Pool ${ord(end.tierRank)} of 4`, end.prize, !!end.paid);
    } else if (end.overallRank) {
      overallHtml = `<div class="proj-line muted"><div class="pl-left"><span class="pl-icon">#${end.overallRank}</span><span class="pl-label">Overall · outside top 4</span></div><div class="pl-right"><div class="pl-prize">—</div><div class="pl-usd">$0</div></div></div>`;
    } else {
      overallHtml = `<div class="proj-line muted"><div class="pl-left"><span class="pl-icon">—</span><span class="pl-label">Overall · no rank yet</span></div><div class="pl-right"><div class="pl-prize">—</div><div class="pl-usd">$0</div></div></div>`;
    }

    // Groups: show groups where user is currently top-3 OR has a wc_payouts row
    // (so 0-amount forfeits also surface with the "holds 0 $BOBAI" tag instead
    // of silently disappearing).
    const winningGroups = groups.filter(g => (g.rank && g.rank <= 3) || g.paid);
    const groupPaid = !!pool.groupPaidAt;
    let groupsHtml;
    if (!winningGroups.length) {
      groupsHtml = `<div class="proj-line muted"><div class="pl-left"><span class="pl-icon">—</span><span class="pl-label">Groups · outside top 3 in all 12 groups</span></div><div class="pl-right"><div class="pl-prize">—</div><div class="pl-usd">$0</div></div></div>`;
    } else {
      groupsHtml = winningGroups.map(g => {
        const lbl = g.bracket === 'top1' ? '1st' : g.bracket === 'top2' ? '2nd' : g.bracket === 'best3' ? 'best 3rd' : '3rd (outside best 8)';
        if (g.forfeit) {
          // Wallet linked but holds 0 $BOBAI → 26× cap = 0 → share cascades to others.
          return `<div class="proj-line forfeit">
            <div class="pl-left"><span class="pl-icon">${tierIcon(g.rank)}</span><span class="pl-label">Group ${g.letter} · ${lbl} <span class="proj-forfeit-pill">holds 0 $BOBAI · forfeited</span></span></div>
            <div class="pl-right">
              <div class="pl-prize">0 BOBAI</div>
              <div class="pl-usd">$0</div>
            </div>
          </div>`;
        }
        return line('', tierIcon(g.rank), `Group ${g.letter} · ${lbl}`, g.prize, groupPaid && g.prize > 0);
      }).join('');
    }
    const groupsSectionHeader = groupPaid
      ? `Groups · 12 brackets <span class="proj-paid-pill">✓ paid</span>`
      : `Groups · 12 brackets (55 / 30 / 15 % split)`;

    // Crypto: list all 3 coins
    const cryptoSettled = crypto.some(c => c.settled);
    const cryptoHtml = crypto.map(c => {
      const name = coinName(c.coin);
      if (!c.picked) {
        return `<div class="proj-line muted"><div class="pl-left"><span class="pl-icon">—</span><span class="pl-label">${name} · no pick</span></div><div class="pl-right"><div class="pl-prize">—</div><div class="pl-usd">$0</div></div></div>`;
      }
      if (c.settled) {
        if (c.isWinner) return line('', '🥇', `${name} · closest guess — pot won`, c.prize, !!c.paid);
        return `<div class="proj-line muted"><div class="pl-left"><span class="pl-icon">—</span><span class="pl-label">${name} · pot settled — not the winner</span></div><div class="pl-right"><div class="pl-prize">—</div><div class="pl-usd">$0</div></div></div>`;
      }
      if (!c.livePxAvailable) {
        return `<div class="proj-line muted"><div class="pl-left"><span class="pl-icon">#${c.rank}</span><span class="pl-label">${name} · live price unavailable</span></div><div class="pl-right"><div class="pl-prize">—</div><div class="pl-usd">$0</div></div></div>`;
      }
      if (c.isWinner) return line('', '🥇', `${name} · currently closest`, c.prize);
      return `<div class="proj-line muted"><div class="pl-left"><span class="pl-icon">#${c.rank}</span><span class="pl-label">${name} · not closest</span></div><div class="pl-right"><div class="pl-prize">—</div><div class="pl-usd">$0</div></div></div>`;
    }).join('');

    const totalPct = pool.total > 0 ? (totalBobai / pool.total * 100) : 0;
    const totalHtml = `<div class="proj-total">
      <div class="pl-left"><span class="pl-label">Total projected payout</span><span class="pl-sub">${fmtPct(totalPct)} of full pool</span></div>
      <div class="pl-right">
        <div class="pl-prize">${fmtBobai(totalBobai)} BOBAI</div>
        <div class="pl-usd">${pool.price > 0 ? fmtUsd(totalUsd) : 'n/a'}</div>
      </div>
    </div>`;

    const walletWarn = (!hasWallet && !(end.settled && crypto.some(c => c.settled)))
      ? `<div class="proj-warn">⚠ No wallet linked — at current standings the actual payout is <b>$0</b>. <a href="./dashboard.html">Link a wallet</a> to qualify (skip+promote rule).</div>`
      : '';

    const endSettled = !!end.settled;
    const allSettled = endSettled && cryptoSettled && !!pool.groupPaidAt;
    const endHeader = endSettled
      ? `Overall · End-Pool (top 4 · 50 / 25 / 15 / 10 %) <span class="proj-paid-pill">✓ paid</span>`
      : `Overall · End-Pool (top 4 · 50 / 25 / 15 / 10 %)`;
    const cryptoHeader = cryptoSettled
      ? `Crypto · 3 coins (winner-take-all) <span class="proj-paid-pill">✓ paid</span>`
      : `Crypto · 3 coins (winner-take-all)`;
    const foot = allSettled
      ? `Final — all pots settled &amp; paid on-chain. Amounts are the actual on-chain transfers (26× cap cascade applied).`
      : `Live · standings refresh after each match · this projection assumes current ranks hold to settlement.`;
    const totalLabel = allSettled ? 'Total payout received' : 'Total projected payout';
    return `
      <div class="proj-section"><div class="proj-sh">${endHeader}</div>${overallHtml}</div>
      <div class="proj-section"><div class="proj-sh">${groupsSectionHeader}</div>${groupsHtml}</div>
      <div class="proj-section"><div class="proj-sh">${cryptoHeader}</div>${cryptoHtml}</div>
      ${totalHtml.replace('Total projected payout', totalLabel)}
      ${walletWarn}
      <div class="proj-foot">${foot}</div>
    `;
  }

  // ============== UI: LEADERBOARD PAYOUTS LIST ==============
  // Returns a flat row for each wallet-linked user with their summed payout.
  // `me` may be null when viewing as anon (won't happen, but defensive).
  function renderPayoutListRowHtml(entry, rank, pool, opts){
    opts = opts || {};
    const usd  = b => pool.price > 0 ? fmtUsd(b * pool.price) : 'n/a';
    const pct  = pool.total > 0 ? (entry.totalBobai / pool.total * 100) : 0;
    const ava  = window.WC_AVATAR
      ? window.WC_AVATAR.avatarHtml(entry.avatar_country, 'sm')
      : '<span style="font-size:22px">⚪</span>';
    const country = (window.WC_COUNTRIES && window.WC_COUNTRIES.find(c => c.code === entry.avatar_country)) || null;
    const countryName = country ? country.name : '—';
    const rankLbl = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank;
    const isMe = opts.meId && entry.user_id === opts.meId;
    const href = './user.html?u=' + encodeURIComponent(entry.username);
    // Tiny breakdown chip line: which pots contribute. Group-chips flip
    // to green once the group pot has been paid out (pool.groupPaidAt set).
    // Forfeit groups (had a top-3 slot but the 26× cap wiped the share) get
    // their own amber chip + a tooltip explaining the cascade.
    const groupPaid = !!pool.groupPaidAt;
    const contribs = [];
    const forfeitGroups = [];
    if (entry.end && entry.end.prize > 0)        contribs.push({ text: `End ${tierIcon(entry.end.tierRank)}`, paid: !!entry.end.paid });
    (entry.groups || []).forEach(g => {
      if (g.prize > 0)        contribs.push({ text: `G${g.letter}`, paid: groupPaid });
      else if (g.forfeit)     forfeitGroups.push(g.letter);
    });
    (entry.crypto || []).forEach(c => { if (c.prize > 0) contribs.push({ text: coinName(c.coin), paid: !!c.paid }); });
    // Append forfeit chips (amber) after winning chips so they read as exceptions
    forfeitGroups.forEach(letter => contribs.push({ text: `G${letter}`, forfeit: true }));
    if (entry.end && entry.end.settled && entry.end.forfeit && entry.end.tierRank) {
      contribs.push({ text: `End ${tierIcon(entry.end.tierRank)}`, forfeit: true });
    }
    let chipLine;
    if (contribs.length) {
      chipLine = `<div class="payout-chips">${contribs.map(x => {
        const cls = x.forfeit ? ' forfeit' : (x.paid ? ' paid' : '');
        const title = x.forfeit ? ' title="Top-3 in this group but 26x cap not reached — share cascaded to other winners."' : '';
        return `<span class="payout-chip${cls}"${title}>${x.text}</span>`;
      }).join('')}</div>`;
    } else if (forfeitGroups.length) {
      chipLine = `<div class="payout-chips muted">26× cap not reached in ${forfeitGroups.length} group${forfeitGroups.length > 1 ? 's' : ''} — share cascaded</div>`;
    } else {
      chipLine = '<div class="payout-chips muted">no pot won — wallet linked but currently outside payout positions</div>';
    }
    const rowCls = 'row payout-row' + (rank === 1 ? ' top1' : rank === 2 ? ' top2' : rank === 3 ? ' top3' : '') + (isMe ? ' me' : '');
    return `<a href="${href}" class="${rowCls}" style="text-decoration:none;color:inherit">
      <div class="rank">${rankLbl}</div>
      <div class="ava-sm">${ava}</div>
      <div class="uinfo">
        <div class="uname"><span class="uname-text">${escapeHtml(entry.username)}</span><span class="ball">⚽</span></div>
        <div class="umeta">${countryName}</div>
        ${chipLine}
      </div>
      <div class="prize-cell">
        <div class="pz-pct">${fmtPct(pct)}</div>
        <div class="pz-bobai">${fmtBobai(entry.totalBobai)} BOBAI</div>
        <div class="pz-usd">${pool.price > 0 ? fmtUsd(entry.totalUsd) : 'n/a'}</div>
      </div>
    </a>`;
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]); }

  // ============== STYLES ==============
  const STYLES = `
    .proj-section{margin-bottom:14px}
    .proj-sh{font-family:'Space Grotesk';font-weight:600;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--gold);margin-bottom:8px;opacity:.85}
    .proj-line{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:9px;margin-bottom:6px;gap:10px}
    .proj-line .pl-left{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
    .proj-line .pl-icon{font-size:18px;line-height:1;width:24px;text-align:center;flex-shrink:0}
    .proj-line .pl-label{font-size:13px;color:var(--text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .proj-line .pl-right{text-align:right;flex-shrink:0}
    .proj-line .pl-prize{font-family:'Space Grotesk';font-size:13px;font-weight:700;color:var(--gold);letter-spacing:.3px;line-height:1.1}
    .proj-line .pl-usd{font-size:11px;color:var(--muted);margin-top:2px}
    .proj-line.muted{opacity:.55}
    .proj-line.muted .pl-prize{color:var(--muted);font-weight:600}
    .proj-total{display:flex;align-items:center;justify-content:space-between;padding:14px 14px;background:var(--gold-glow);border:1px solid var(--gold);border-radius:10px;margin-top:14px;gap:10px}
    .proj-total .pl-left{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
    .proj-total .pl-label{font-family:'Space Grotesk';font-weight:700;font-size:13px;color:var(--gold);letter-spacing:.5px;text-transform:uppercase}
    .proj-total .pl-sub{font-size:11px;color:var(--muted)}
    .proj-total .pl-right{text-align:right;flex-shrink:0}
    .proj-total .pl-prize{font-family:'Space Grotesk';font-weight:800;font-size:18px;color:var(--gold);line-height:1.1}
    .proj-total .pl-usd{font-size:12px;color:var(--text);margin-top:2px;font-weight:600}
    .proj-warn{margin-top:12px;padding:10px 12px;background:rgba(255,180,0,.06);border:1px solid rgba(255,180,0,.25);border-radius:8px;color:#ffc066;font-size:12px;line-height:1.5}
    .proj-warn a{color:#ffd58a;font-weight:700}
    .proj-foot{margin-top:10px;font-size:11px;color:var(--muted);text-align:center;line-height:1.5}
    .proj-empty{padding:14px;text-align:center;color:var(--muted);font-size:13px}

    /* Leaderboard payouts list */
    .payout-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
    .payout-chips.muted{font-size:10.5px;color:var(--muted);opacity:.7;margin-top:5px}
    .payout-chip{display:inline-block;padding:2px 7px;background:rgba(240,185,11,.07);border:1px solid rgba(240,185,11,.22);border-radius:999px;font-size:9.5px;font-weight:600;color:var(--gold);letter-spacing:.3px;line-height:1.4}
    .payout-chip.paid{background:rgba(0,230,118,.08);border-color:rgba(0,230,118,.32);color:#7fffb0}
    .payout-chip.forfeit{background:rgba(255,180,0,.08);border-color:rgba(255,180,0,.32);color:#ffc066;cursor:help}
    /* Paid badge on the per-group projection line + section header */
    .proj-line.paid{background:linear-gradient(90deg,rgba(0,230,118,.08),rgba(0,0,0,.3));border-color:rgba(0,230,118,.32)}
    .proj-line.paid .pl-prize{color:#7fffb0}
    .proj-paid-pill{display:inline-flex;align-items:center;gap:3px;margin-left:7px;padding:1px 7px;border-radius:5px;background:rgba(0,230,118,.14);border:1px solid rgba(0,230,118,.32);color:#7fffb0;font-family:'Space Grotesk';font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;vertical-align:middle}
    /* Forfeit (cap-hit at 0 BOBAI balance): share cascades to other winners */
    .proj-line.forfeit{background:linear-gradient(90deg,rgba(255,180,0,.07),rgba(0,0,0,.3));border-color:rgba(255,180,0,.25);opacity:.8}
    .proj-line.forfeit .pl-prize{color:#ffc066}
    .proj-line.forfeit .pl-usd{color:rgba(255,192,102,.6)}
    .proj-forfeit-pill{display:inline-flex;align-items:center;gap:3px;margin-left:7px;padding:1px 7px;border-radius:5px;background:rgba(255,180,0,.12);border:1px solid rgba(255,180,0,.32);color:#ffc066;font-family:'Space Grotesk';font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;vertical-align:middle}
  `;
  let stylesInjected = false;
  function injectStyles(){
    if (stylesInjected) return;
    stylesInjected = true;
    const s = document.createElement('style');
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  window.WC_PROJECTION = {
    loadAll,
    compute,
    loadAndCompute,
    computeAll,
    renderHtml,
    renderPayoutListRowHtml,
    injectStyles,
    GROUP_LETTERS,
    COINS,
  };
})();
