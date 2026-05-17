-- $BOBAI Worldcup '26 — Phase I: simple wallet linking
-- Removes the ECDSA-signature flow. New rules:
--   1. User just types their BEP-20 address — no signing, no gas.
--   2. Each wallet can be linked to AT MOST ONE account (UNIQUE).
--   3. Once set, the wallet is IMMUTABLE — to switch, the account is sunk.
--      Hard lock + UI confirm replaces signature verification as anti-fraud.
-- Idempotent: works whether or not the never-applied signature migration H
-- was ever run.

-- ============================================================
-- 1) Drop dependent views first (they reference wallet_verified)
-- ============================================================
DROP VIEW IF EXISTS wc_leaderboard_crypto;
DROP VIEW IF EXISTS wc_leaderboard_group;
DROP VIEW IF EXISTS wc_leaderboard;

-- ============================================================
-- 2) Drop signature columns + wallet_verified (no-op if absent)
-- ============================================================
ALTER TABLE wc_users
  DROP COLUMN IF EXISTS wallet_signature,
  DROP COLUMN IF EXISTS wallet_message,
  DROP COLUMN IF EXISTS wallet_signed_at,
  DROP COLUMN IF EXISTS wallet_verified;

-- ============================================================
-- 3) Wipe stale wallet rows (clean slate before adding UNIQUE)
-- ============================================================
UPDATE wc_users
   SET wallet = NULL
 WHERE wallet IS NOT NULL;

-- ============================================================
-- 4) UNIQUE wallet (case-insensitive, only when set)
--    Replaces the old non-unique partial index from schema.sql.
-- ============================================================
DROP INDEX IF EXISTS wc_users_wallet;
DROP INDEX IF EXISTS wc_users_wallet_unique;
CREATE UNIQUE INDEX wc_users_wallet_unique
  ON wc_users (lower(wallet))
  WHERE wallet IS NOT NULL;

-- ============================================================
-- 5) Immutability: wallet may go NULL → set, never change after that
-- ============================================================
CREATE OR REPLACE FUNCTION wc_users_immutable_check() RETURNS TRIGGER AS $$
BEGIN
  -- Service role (Cloudflare Worker / admin SQL) bypasses these checks so we
  -- can still correct mistakes manually if a user reaches out.
  IF coalesce(current_setting('request.jwt.claims', true)::json->>'role','') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.auth_id IS DISTINCT FROM OLD.auth_id THEN
    RAISE EXCEPTION 'auth_id is immutable';
  END IF;
  IF NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'username is immutable';
  END IF;
  -- Wallet: NULL → address is the ONLY allowed transition for a normal user.
  -- Changing an already-set wallet, or clearing it, requires service_role.
  IF OLD.wallet IS NOT NULL AND NEW.wallet IS DISTINCT FROM OLD.wallet THEN
    RAISE EXCEPTION 'wallet is permanent once linked — contact support to correct it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists from base schema; CREATE OR REPLACE FUNCTION above
-- is enough — no need to drop/recreate the trigger.

-- ============================================================
-- 6) Tighten column grant to the new minimal write set
--    REVOKE list only includes the column that definitely exists today.
--    Past grants on dropped columns vanished with the columns themselves.
-- ============================================================
REVOKE UPDATE (wallet, avatar_country) ON wc_users FROM authenticated;
GRANT  UPDATE (wallet, avatar_country) ON wc_users TO authenticated;

-- ============================================================
-- 7) Recreate leaderboard views without wallet_verified
--    has_wallet now == (wallet IS NOT NULL)
-- ============================================================
CREATE VIEW wc_leaderboard AS
SELECT
  u.id            AS user_id,
  u.username,
  u.avatar_country,
  (u.wallet IS NOT NULL) AS has_wallet,
  COALESCE(SUM(t.points_final), 0) + COALESCE(b.points, 0) AS total_points,
  COALESCE(SUM(t.points_final), 0)                          AS match_points,
  COALESCE(b.points, 0)                                     AS bonus_points,
  COUNT(t.id)                                               AS tips_count,
  COUNT(t.id) FILTER (WHERE t.resolved)                     AS tips_resolved
FROM wc_users u
LEFT JOIN wc_tips  t ON t.user_id = u.id
LEFT JOIN wc_bonus b ON b.user_id = u.id
GROUP BY u.id, u.username, u.avatar_country, u.wallet, b.points;

ALTER VIEW wc_leaderboard SET (security_invoker = on);
GRANT SELECT ON wc_leaderboard TO anon, authenticated, service_role;

CREATE VIEW wc_leaderboard_group AS
SELECT
  u.id            AS user_id,
  u.username,
  u.avatar_country,
  (u.wallet IS NOT NULL) AS has_wallet,
  m.group_letter,
  COALESCE(SUM(t.points_final), 0)         AS group_points,
  COUNT(t.id)                               AS tips_count,
  COUNT(t.id) FILTER (WHERE t.resolved)     AS tips_resolved
FROM wc_users u
JOIN wc_tips t ON t.user_id = u.id
JOIN wc_matches m ON m.id = t.match_id AND m.phase = 'group'
GROUP BY u.id, u.username, u.avatar_country, u.wallet, m.group_letter;

ALTER VIEW wc_leaderboard_group SET (security_invoker = on);
GRANT SELECT ON wc_leaderboard_group TO anon, authenticated, service_role;

CREATE VIEW wc_leaderboard_crypto AS
SELECT
  u.id            AS user_id,
  u.username,
  u.avatar_country,
  (u.wallet IS NOT NULL) AS has_wallet,
  c.btc_price,    c.btc_diff,
  c.bnb_price,    c.bnb_diff,
  c.bobai_price,  c.bobai_diff,
  c.resolved      AS crypto_resolved
FROM wc_users u
JOIN wc_crypto c ON c.user_id = u.id;

ALTER VIEW wc_leaderboard_crypto SET (security_invoker = on);
GRANT SELECT ON wc_leaderboard_crypto TO anon, authenticated, service_role;
