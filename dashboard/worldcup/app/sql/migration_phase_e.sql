-- Phase E migration — Scoring engine (DB trigger, auto-resolves tips when match.played=true)
-- Manipulation-safe: scoring runs ONLY via this trigger, never by user input.
-- Run in Supabase SQL Editor after Phase D.

-- ============================================================
-- Compute one tip's raw score (pre-multiplier)
-- 5 = exact result · 3 = correct winner + correct goal diff · 1 = correct winner only · 0 otherwise
-- ============================================================
CREATE OR REPLACE FUNCTION wc_score_tip(
  m_h INT, m_a INT, t_h INT, t_a INT
) RETURNS INT AS $$
BEGIN
  IF m_h IS NULL OR m_a IS NULL OR t_h IS NULL OR t_a IS NULL THEN
    RETURN 0;
  END IF;
  -- Exact
  IF t_h = m_h AND t_a = m_a THEN
    RETURN 5;
  END IF;
  -- Correct winner direction?
  IF (m_h > m_a AND t_h > t_a)
     OR (m_h < m_a AND t_h < t_a)
     OR (m_h = m_a AND t_h = t_a) THEN
    -- Correct goal difference too?
    IF (m_h - m_a) = (t_h - t_a) THEN
      RETURN 3;
    END IF;
    RETURN 1;
  END IF;
  RETURN 0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- Trigger: when match transitions to played (or score corrected),
-- recompute points for every tip on that match.
-- ============================================================
CREATE OR REPLACE FUNCTION wc_resolve_tips() RETURNS TRIGGER AS $$
BEGIN
  -- Trigger fires when match is marked played WITH valid goals, OR when goals are corrected
  IF NEW.played
     AND NEW.goals_home IS NOT NULL
     AND NEW.goals_away IS NOT NULL
     AND (
       OLD.played       IS DISTINCT FROM NEW.played
       OR OLD.goals_home IS DISTINCT FROM NEW.goals_home
       OR OLD.goals_away IS DISTINCT FROM NEW.goals_away
     ) THEN
    UPDATE wc_tips t
    SET
      points       = wc_score_tip(NEW.goals_home, NEW.goals_away, t.tip_home, t.tip_away),
      points_final = wc_score_tip(NEW.goals_home, NEW.goals_away, t.tip_home, t.tip_away) * NEW.multiplier,
      resolved     = TRUE,
      updated_at   = NOW()
    WHERE t.match_id = NEW.id;
  END IF;
  -- Unresolve if a match is reset (played=true → false)
  IF OLD.played = TRUE AND NEW.played = FALSE THEN
    UPDATE wc_tips t
    SET points = 0, points_final = 0, resolved = FALSE, updated_at = NOW()
    WHERE t.match_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wc_resolve_tips_trigger ON wc_matches;
CREATE TRIGGER wc_resolve_tips_trigger
AFTER UPDATE ON wc_matches
FOR EACH ROW EXECUTE FUNCTION wc_resolve_tips();

-- ============================================================
-- Hard guard: users can NEVER update wc_matches (results/goals)
-- Only service-role (Cloudflare Worker) is allowed to write.
-- This is implicit (no INSERT/UPDATE policy → blocked under RLS), but
-- we add a NEGATIVE policy explicitly for clarity.
-- ============================================================
-- (no-op — wc_matches has only SELECT policy; INSERT/UPDATE require service role)

-- ============================================================
-- Helper: resolve bonus questions in one call (run after tournament ends)
-- Takes the actual answers and writes points to wc_bonus rows.
-- Each correct answer = 10 pts.
-- ============================================================
CREATE OR REPLACE FUNCTION wc_resolve_bonus(
  p_champion           TEXT,
  p_most_goals_team    TEXT,
  p_fewest_goals_team  TEXT,
  p_red_cards_bracket  TEXT,
  p_topscorer_country  TEXT
) RETURNS INT AS $$
DECLARE
  rows_updated INT;
BEGIN
  UPDATE wc_bonus b
  SET points = (
    (CASE WHEN b.champion          = p_champion          THEN 10 ELSE 0 END) +
    (CASE WHEN b.most_goals_team   = p_most_goals_team   THEN 10 ELSE 0 END) +
    (CASE WHEN b.fewest_goals_team = p_fewest_goals_team THEN 10 ELSE 0 END) +
    (CASE WHEN b.red_cards_bracket = p_red_cards_bracket THEN 10 ELSE 0 END) +
    (CASE WHEN b.topscorer_country = p_topscorer_country THEN 10 ELSE 0 END)
  ),
  resolved = TRUE,
  updated_at = NOW();
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Helper: resolve crypto predictions
-- Stores abs-diff to actual prices; lowest diff wins the pool slot (computed at payout time).
-- ============================================================
CREATE OR REPLACE FUNCTION wc_resolve_crypto(
  p_btc   NUMERIC,
  p_bnb   NUMERIC,
  p_bobai NUMERIC
) RETURNS INT AS $$
DECLARE
  rows_updated INT;
BEGIN
  UPDATE wc_crypto c
  SET btc_diff   = ABS(c.btc_price   - p_btc),
      bnb_diff   = ABS(c.bnb_price   - p_bnb),
      bobai_diff = ABS(c.bobai_price - p_bobai),
      resolved   = TRUE,
      updated_at = NOW();
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$ LANGUAGE plpgsql;
