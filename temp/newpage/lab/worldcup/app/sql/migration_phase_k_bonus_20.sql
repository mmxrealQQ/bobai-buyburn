-- ============================================================
-- Phase K: bump bonus question points 10 → 20
-- Each correct bonus answer now scores 20 (was 10).
-- Idempotent: CREATE OR REPLACE — safe to re-run.
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
    (CASE WHEN b.champion          = p_champion          THEN 20 ELSE 0 END) +
    (CASE WHEN b.most_goals_team   = p_most_goals_team   THEN 20 ELSE 0 END) +
    (CASE WHEN b.fewest_goals_team = p_fewest_goals_team THEN 20 ELSE 0 END) +
    (CASE WHEN b.red_cards_bracket = p_red_cards_bracket THEN 20 ELSE 0 END) +
    (CASE WHEN b.topscorer_country = p_topscorer_country THEN 20 ELSE 0 END)
  ),
  resolved = TRUE,
  updated_at = NOW();
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$ LANGUAGE plpgsql;
