-- BOBAI Worldcup '26 — Phase M: matchday staircase in the group phase
--
-- Why: with a flat ×1 over the 72 group matches, many players land on the
-- same total at the end of MD3 → too many ties per payout rank. Staggering
-- MD2 and MD3 produces more distinct totals while keeping the relative
-- value of each match close to the original (no late-round shock):
--
--   MD1  ×1     (matches 1–2 in every group)
--   MD2  ×1.25  (matches 3–4)
--   MD3  ×1.5   (matches 5–6)
--   KO   ×2 → ×7  (unchanged, see migration_phase_j)
--
-- Side-effect: points_final + multiplier are no longer integers
-- (e.g. exact-score in an MD3 match = 5 × 1.5 = 7.5), so both columns
-- are widened to NUMERIC. Sums / ordering on the leaderboard view keep
-- working unchanged.
--
-- Idempotent: safe to re-run. Re-resolves any already-played matches
-- under the new scheme so historical points stay in sync (no-op before
-- MD2 kickoff, but correct if this is ever re-run mid-tournament).
--
-- Run in Supabase SQL Editor after Phase L.

BEGIN;

-- ============================================================
-- 1) Drop leaderboard views that depend on points_final
--    (Postgres blocks ALTER COLUMN TYPE on columns used by views.)
--    Views are recreated identically at the end of this migration.
-- ============================================================
DROP VIEW IF EXISTS wc_leaderboard;
DROP VIEW IF EXISTS wc_leaderboard_group;

-- ============================================================
-- 2) Widen multiplier + points_final from INT to NUMERIC
-- ============================================================
ALTER TABLE wc_matches
  ALTER COLUMN multiplier TYPE NUMERIC USING multiplier::NUMERIC;
ALTER TABLE wc_matches
  ALTER COLUMN multiplier SET DEFAULT 1;

ALTER TABLE wc_tips
  ALTER COLUMN points_final TYPE NUMERIC USING points_final::NUMERIC;
ALTER TABLE wc_tips
  ALTER COLUMN points_final SET DEFAULT 0;

-- ============================================================
-- 3) Group-phase staircase
--    Within each group, matches are ordered by kickoff time + id;
--    positions 1–2 = MD1, 3–4 = MD2, 5–6 = MD3.
--    KO phases are untouched (WHERE phase = 'group').
-- ============================================================
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY group_letter
      ORDER BY kickoff_utc, id
    ) AS pos
  FROM wc_matches
  WHERE phase = 'group'
)
UPDATE wc_matches m
SET multiplier = CASE
  WHEN r.pos <= 2 THEN 1
  WHEN r.pos <= 4 THEN 1.25
  ELSE                 1.5
END
FROM ranked r
WHERE m.id = r.id;

-- ============================================================
-- 4) Retro-resolve any already-played matches under the new scheme
--    so points_final stays in sync with the new multipliers.
--    Pre-MD2 this hits zero MD2/MD3 rows; safe.
-- ============================================================
UPDATE wc_tips t
SET
  points_final = wc_score_tip(m.goals_home, m.goals_away, t.tip_home, t.tip_away) * m.multiplier,
  updated_at   = NOW()
FROM wc_matches m
WHERE t.match_id = m.id
  AND m.played = TRUE
  AND m.goals_home IS NOT NULL
  AND m.goals_away IS NOT NULL;

-- ============================================================
-- 5) Recreate leaderboard views (identical to migration_phase_i)
--    Now reading the widened NUMERIC points_final column.
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

COMMIT;

-- Verification (run manually):
--   SELECT group_letter, multiplier, COUNT(*)
--   FROM wc_matches WHERE phase='group'
--   GROUP BY group_letter, multiplier ORDER BY group_letter, multiplier;
--   -- expect 2 rows at 1, 2 at 1.25, 2 at 1.5 per group
--
--   SELECT phase, multiplier, COUNT(*)
--   FROM wc_matches GROUP BY phase, multiplier ORDER BY multiplier;
--   -- group: 24 @ 1, 24 @ 1.25, 24 @ 1.5
--   -- r32 24 @ 2 → final 1 @ 7 (unchanged)
