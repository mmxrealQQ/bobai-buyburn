-- BOBAI Worldcup '26 — Phase O: BOBAI balance snapshot for tie-breaker.
-- Adds a periodically-refreshed on-chain BOBAI balance to wc_users so the
-- leaderboard can apply the published tie-breaker rule (rules.html §7):
--   1. group_points DESC                  (the score itself)
--   2. on-chain BOBAI balance DESC        (skin-in-the-game tie-breaker)
--   3. has_wallet DESC                    (linked > non-linked)
--   4. user_id ASC                        (deterministic last-resort fallback)
--
-- PRIVACY: bobai_balance MUST NEVER be exposed to anon/authenticated. It's
-- consumed strictly inside SECURITY DEFINER RPCs which return only the
-- pre-computed `rank` + `tied_above`/`tied_below` flags (so the UI can render
-- a "holds more $BOBAI" badge without ever revealing the actual amounts).
--
-- Also used at payout time (Phase H) for the 26× holder cap and the audit PDF
-- — but the payout calculator reads a FRESH on-chain balance at lock time;
-- this column is for live display only.

BEGIN;

-- ============================================================
-- 1) New columns on wc_users
-- ============================================================
ALTER TABLE wc_users
  ADD COLUMN IF NOT EXISTS bobai_balance     NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bobai_snapshot_at TIMESTAMPTZ;

-- ============================================================
-- 2) Privacy lockdown — anon/authenticated must NOT see balances
--    (existing RLS policy `wc_users_read FOR SELECT USING (true)` would
--     otherwise expose any column the role has GRANT on)
-- ============================================================
REVOKE SELECT (bobai_balance, bobai_snapshot_at) ON wc_users FROM anon, authenticated;

-- ============================================================
-- 3) Group leaderboard with tie-breaker resolved server-side
--    Returns same shape as wc_leaderboard_group + rank + tied flags.
--    bobai_balance is consumed inside this function but NEVER returned.
-- ============================================================
DROP FUNCTION IF EXISTS wc_group_leaderboard_ranked(text);

CREATE OR REPLACE FUNCTION wc_group_leaderboard_ranked(p_letter text)
RETURNS TABLE (
  user_id            bigint,
  username           text,
  avatar_country     text,
  has_wallet         boolean,
  group_letter       text,
  group_points       numeric,
  tips_count         bigint,
  tips_resolved      bigint,
  rank               int,
  tied_above         boolean,
  tied_below         boolean,
  bobai_beats_below  boolean,   -- this row beat the next-ranked row on BOBAI
  bobai_loses_above  boolean    -- this row lost to the prior-ranked row on BOBAI
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      u.id                                                       AS user_id,
      u.username,
      u.avatar_country,
      (u.wallet IS NOT NULL)                                     AS has_wallet,
      m.group_letter::text                                       AS group_letter,
      COALESCE(SUM(t.points_final), 0)::numeric                  AS group_points,
      COUNT(t.id)::bigint                                        AS tips_count,
      COUNT(t.id) FILTER (WHERE t.resolved)::bigint              AS tips_resolved,
      COALESCE(u.bobai_balance, 0)::numeric                      AS bobai_balance
    FROM wc_users u
    JOIN wc_tips    t ON t.user_id = u.id
    JOIN wc_matches m ON m.id = t.match_id AND m.phase = 'group'
    WHERE m.group_letter = p_letter
    GROUP BY u.id, u.username, u.avatar_country, u.wallet, m.group_letter, u.bobai_balance
  ),
  ordered AS (
    SELECT
      *,
      ROW_NUMBER() OVER w AS rk,
      LAG(group_points)   OVER w AS prev_pts,
      LEAD(group_points)  OVER w AS next_pts,
      LAG(bobai_balance)  OVER w AS prev_bobai,
      LEAD(bobai_balance) OVER w AS next_bobai
    FROM base
    WINDOW w AS (ORDER BY group_points DESC, bobai_balance DESC, has_wallet DESC, user_id ASC)
  )
  SELECT
    user_id, username, avatar_country, has_wallet, group_letter,
    group_points, tips_count, tips_resolved,
    rk::int AS rank,
    (prev_pts IS NOT NULL AND prev_pts = group_points) AS tied_above,
    (next_pts IS NOT NULL AND next_pts = group_points) AS tied_below,
    (next_pts IS NOT NULL AND next_pts = group_points AND bobai_balance > next_bobai) AS bobai_beats_below,
    (prev_pts IS NOT NULL AND prev_pts = group_points AND bobai_balance < prev_bobai) AS bobai_loses_above
  FROM ordered
  ORDER BY rk;
$$;

REVOKE ALL ON FUNCTION wc_group_leaderboard_ranked(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wc_group_leaderboard_ranked(text) TO anon, authenticated, service_role;

-- ============================================================
-- 4) Overall leaderboard with tie-breaker resolved server-side
--    Mirrors wc_leaderboard shape + rank + tied flags.
-- ============================================================
DROP FUNCTION IF EXISTS wc_overall_leaderboard_ranked();

CREATE OR REPLACE FUNCTION wc_overall_leaderboard_ranked()
RETURNS TABLE (
  user_id            bigint,
  username           text,
  avatar_country     text,
  has_wallet         boolean,
  total_points       numeric,
  match_points       numeric,
  bonus_points       int,
  tips_count         bigint,
  tips_resolved      bigint,
  rank               int,
  tied_above         boolean,
  tied_below         boolean,
  bobai_beats_below  boolean,
  bobai_loses_above  boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      u.id                                                                       AS user_id,
      u.username,
      u.avatar_country,
      (u.wallet IS NOT NULL)                                                     AS has_wallet,
      (COALESCE(SUM(t.points_final), 0) + COALESCE(b.points, 0))::numeric        AS total_points,
      COALESCE(SUM(t.points_final), 0)::numeric                                  AS match_points,
      COALESCE(b.points, 0)::int                                                 AS bonus_points,
      COUNT(t.id)::bigint                                                        AS tips_count,
      COUNT(t.id) FILTER (WHERE t.resolved)::bigint                              AS tips_resolved,
      COALESCE(u.bobai_balance, 0)::numeric                                      AS bobai_balance
    FROM wc_users u
    LEFT JOIN wc_tips  t ON t.user_id = u.id
    LEFT JOIN wc_bonus b ON b.user_id = u.id
    GROUP BY u.id, u.username, u.avatar_country, u.wallet, b.points, u.bobai_balance
  ),
  ordered AS (
    SELECT
      *,
      ROW_NUMBER() OVER w AS rk,
      LAG(total_points)   OVER w AS prev_pts,
      LEAD(total_points)  OVER w AS next_pts,
      LAG(bobai_balance)  OVER w AS prev_bobai,
      LEAD(bobai_balance) OVER w AS next_bobai
    FROM base
    WINDOW w AS (ORDER BY total_points DESC, bobai_balance DESC, has_wallet DESC, user_id ASC)
  )
  SELECT
    user_id, username, avatar_country, has_wallet,
    total_points, match_points, bonus_points,
    tips_count, tips_resolved,
    rk::int AS rank,
    (prev_pts IS NOT NULL AND prev_pts = total_points) AS tied_above,
    (next_pts IS NOT NULL AND next_pts = total_points) AS tied_below,
    (next_pts IS NOT NULL AND next_pts = total_points AND bobai_balance > next_bobai) AS bobai_beats_below,
    (prev_pts IS NOT NULL AND prev_pts = total_points AND bobai_balance < prev_bobai) AS bobai_loses_above
  FROM ordered
  ORDER BY rk;
$$;

REVOKE ALL ON FUNCTION wc_overall_leaderboard_ranked()  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wc_overall_leaderboard_ranked() TO anon, authenticated, service_role;

-- ============================================================
-- 5) Bulk-update RPC for the hourly cron snapshot
--    Worker posts a JSON array of {id, balance} and updates in one round-trip
--    (keeps Cloudflare Workers free-tier subrequest count down — single REST
--    call instead of N PATCHes).
-- ============================================================
DROP FUNCTION IF EXISTS wc_update_bobai_snapshots(jsonb);

CREATE OR REPLACE FUNCTION wc_update_bobai_snapshots(payload jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  WITH src AS (
    SELECT
      (e->>'id')::bigint       AS id,
      (e->>'balance')::numeric AS balance
    FROM jsonb_array_elements(payload) e
  )
  UPDATE wc_users u
     SET bobai_balance     = src.balance,
         bobai_snapshot_at = NOW()
    FROM src
   WHERE u.id = src.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION wc_update_bobai_snapshots(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wc_update_bobai_snapshots(jsonb) TO service_role;

COMMIT;

-- Verification (run manually):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='wc_users' AND column_name IN ('bobai_balance','bobai_snapshot_at');
--
--   -- Anon should NOT be able to read bobai_balance directly:
--   SET ROLE anon;
--   SELECT bobai_balance FROM wc_users LIMIT 1;   -- expect: permission denied
--   RESET ROLE;
--
--   -- RPC should return ranked rows with tied flags but no bobai column:
--   SELECT * FROM wc_group_leaderboard_ranked('A') LIMIT 5;
--   SELECT * FROM wc_overall_leaderboard_ranked() LIMIT 5;
