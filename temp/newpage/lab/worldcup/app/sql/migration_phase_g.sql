-- Phase G migration — leaderboard views (overall, per-group, per-crypto)
-- Run in Supabase SQL Editor after previous migrations.

-- ============================================================
-- Per-group leaderboard: points from group-stage matches only
-- ============================================================
DROP VIEW IF EXISTS wc_leaderboard_group;
CREATE VIEW wc_leaderboard_group AS
SELECT
  u.id            AS user_id,
  u.username,
  u.avatar_country,
  (u.wallet IS NOT NULL AND u.wallet_verified) AS has_wallet,
  m.group_letter,
  COALESCE(SUM(t.points_final), 0)         AS group_points,
  COUNT(t.id)                               AS tips_count,
  COUNT(t.id) FILTER (WHERE t.resolved)     AS tips_resolved
FROM wc_users u
JOIN wc_tips t ON t.user_id = u.id
JOIN wc_matches m ON m.id = t.match_id AND m.phase = 'group'
GROUP BY u.id, u.username, u.avatar_country, u.wallet, u.wallet_verified, m.group_letter;

ALTER VIEW wc_leaderboard_group SET (security_invoker = on);
GRANT SELECT ON wc_leaderboard_group TO anon, authenticated, service_role;

-- ============================================================
-- Per-crypto leaderboard view (one per coin, sorted by diff)
-- Returns NULL diff at the bottom (= not yet resolved or didn't predict)
-- ============================================================
DROP VIEW IF EXISTS wc_leaderboard_crypto;
CREATE VIEW wc_leaderboard_crypto AS
SELECT
  u.id            AS user_id,
  u.username,
  u.avatar_country,
  (u.wallet IS NOT NULL AND u.wallet_verified) AS has_wallet,
  c.btc_price,    c.btc_diff,
  c.bnb_price,    c.bnb_diff,
  c.bobai_price,  c.bobai_diff,
  c.resolved      AS crypto_resolved
FROM wc_users u
JOIN wc_crypto c ON c.user_id = u.id;

ALTER VIEW wc_leaderboard_crypto SET (security_invoker = on);
GRANT SELECT ON wc_leaderboard_crypto TO anon, authenticated, service_role;

-- ============================================================
-- Refresh existing wc_leaderboard to include avatar + crypto resolved info
-- (the original view exists from base schema; we replace it to include
-- the crypto-prize-pot positions so the overall page can show them)
-- ============================================================
DROP VIEW IF EXISTS wc_leaderboard;
CREATE VIEW wc_leaderboard AS
SELECT
  u.id            AS user_id,
  u.username,
  u.avatar_country,
  (u.wallet IS NOT NULL AND u.wallet_verified) AS has_wallet,
  COALESCE(SUM(t.points_final), 0) + COALESCE(b.points, 0) AS total_points,
  COALESCE(SUM(t.points_final), 0)                          AS match_points,
  COALESCE(b.points, 0)                                     AS bonus_points,
  COUNT(t.id)                                               AS tips_count,
  COUNT(t.id) FILTER (WHERE t.resolved)                     AS tips_resolved
FROM wc_users u
LEFT JOIN wc_tips  t ON t.user_id = u.id
LEFT JOIN wc_bonus b ON b.user_id = u.id
GROUP BY u.id, u.username, u.avatar_country, u.wallet, u.wallet_verified, b.points;

ALTER VIEW wc_leaderboard SET (security_invoker = on);
GRANT SELECT ON wc_leaderboard TO anon, authenticated, service_role;
