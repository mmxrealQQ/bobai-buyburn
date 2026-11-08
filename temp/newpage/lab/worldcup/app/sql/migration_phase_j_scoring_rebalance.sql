-- Phase J — Scoring rebalance (17 May 2026)
--
-- Two changes that the rules + UI already advertise:
--   1) Raw points for a winner-only tip: 1 → 2.   New ladder: 0 · 2 · 3 · 5.
--   2) Phase multipliers expanded from x1..x4 to x1..x7 so the late KO
--      matches truly swing the leaderboard.
--
-- Idempotent: safe to re-run.  Re-resolves any already-played matches under
-- the new scheme so historical points stay consistent (no-op before kickoff,
-- but correct if this is ever re-run mid-tournament).
--
-- Run in Supabase SQL Editor after Phase I.

BEGIN;

-- ============================================================
-- 1) Updated raw score function: 5 / 3 / 2 / 0
--    (was: 5 / 3 / 1 / 0)
-- ============================================================
CREATE OR REPLACE FUNCTION wc_score_tip(
  m_h INT, m_a INT, t_h INT, t_a INT
) RETURNS INT AS $$
BEGIN
  IF m_h IS NULL OR m_a IS NULL OR t_h IS NULL OR t_a IS NULL THEN
    RETURN 0;
  END IF;
  -- Exact result
  IF t_h = m_h AND t_a = m_a THEN
    RETURN 5;
  END IF;
  -- Correct winner direction?
  IF (m_h > m_a AND t_h > t_a)
     OR (m_h < m_a AND t_h < t_a)
     OR (m_h = m_a AND t_h = t_a) THEN
    -- Correct goal difference on top of correct winner?
    IF (m_h - m_a) = (t_h - t_a) THEN
      RETURN 3;
    END IF;
    RETURN 2;  -- was 1
  END IF;
  RETURN 0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 2) Phase multipliers
--    Was:  group=1, r32/r16=2, qf/sf=3, 3rd/final=4
--    Now:  group=1, r32=2, r16=3, qf=4, sf=5, 3rd=6, final=7
-- ============================================================
UPDATE wc_matches SET multiplier =
  CASE phase
    WHEN 'group' THEN 1
    WHEN 'r32'   THEN 2
    WHEN 'r16'   THEN 3
    WHEN 'qf'    THEN 4
    WHEN 'sf'    THEN 5
    WHEN '3rd'   THEN 6
    WHEN 'final' THEN 7
    ELSE multiplier
  END
WHERE phase IN ('group','r32','r16','qf','sf','3rd','final');

-- ============================================================
-- 3) Retro-resolve any already-played matches under the new scheme
--    so points + points_final stay in sync.  Pre-kickoff this hits
--    zero rows; mid-tournament it brings history up to date.
-- ============================================================
UPDATE wc_tips t
SET
  points       = wc_score_tip(m.goals_home, m.goals_away, t.tip_home, t.tip_away),
  points_final = wc_score_tip(m.goals_home, m.goals_away, t.tip_home, t.tip_away) * m.multiplier,
  updated_at   = NOW()
FROM wc_matches m
WHERE t.match_id = m.id
  AND m.played = TRUE
  AND m.goals_home IS NOT NULL
  AND m.goals_away IS NOT NULL;

COMMIT;

-- Verification queries (run manually if you want to double-check):
--   SELECT phase, multiplier, COUNT(*) FROM wc_matches GROUP BY phase, multiplier ORDER BY multiplier;
--   SELECT wc_score_tip(3,2,2,1);  -- expects 2 (correct winner only)
--   SELECT wc_score_tip(3,2,2,1);  -- ↑
--   SELECT wc_score_tip(3,2,3,2);  -- expects 5 (exact)
--   SELECT wc_score_tip(3,1,2,0);  -- expects 3 (winner + goal diff)
--   SELECT wc_score_tip(1,0,0,1);  -- expects 0 (wrong winner)
