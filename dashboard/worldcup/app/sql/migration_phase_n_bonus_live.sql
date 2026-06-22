-- ============================================================
-- Phase N: Live bonus-resolution data
--
-- Adds two tables driven by the football-data.org sync worker so the
-- leaderboard "Bonus" view can render live winners without manual entry:
--
--   wc_scorers           — top scorers (for Golden Boot question)
--   wc_tournament_stats  — single-row counter for red cards (Q5 bracket)
--
-- Both are read-only for the public; writes go through the service-role
-- worker. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS wc_scorers (
  rank          INT  PRIMARY KEY,
  player_name   TEXT NOT NULL,
  country_code  TEXT,                       -- ISO code; null if unmappable
  goals         INT  NOT NULL DEFAULT 0,
  assists       INT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wc_tournament_stats (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  red_cards_total INT DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO wc_tournament_stats (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Per-match red-card counter so the worker can hit /matches/{id} once per
-- finished match (saving the count) and aggregate totals from cached values.
-- NULL = not yet fetched, integer = swept and counted.
ALTER TABLE wc_matches ADD COLUMN IF NOT EXISTS red_cards INT;

ALTER TABLE wc_scorers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wc_tournament_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wc_scorers_read           ON wc_scorers;
DROP POLICY IF EXISTS wc_tournament_stats_read  ON wc_tournament_stats;
CREATE POLICY wc_scorers_read          ON wc_scorers          FOR SELECT USING (true);
CREATE POLICY wc_tournament_stats_read ON wc_tournament_stats FOR SELECT USING (true);

GRANT SELECT ON wc_scorers, wc_tournament_stats TO anon, authenticated;
