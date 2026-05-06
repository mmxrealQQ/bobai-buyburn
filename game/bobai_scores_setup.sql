-- Run this in your Supabase SQL Editor (same project as buildonbnbgame)
-- Table for Brain On BNB AI game highscores

CREATE TABLE bobai_scores (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 42),
  score INTEGER NOT NULL CHECK (score >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bobai_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select" ON bobai_scores FOR SELECT USING (true);
CREATE POLICY "anon_insert" ON bobai_scores FOR INSERT WITH CHECK (true);

CREATE INDEX idx_bobai_score ON bobai_scores (score DESC);
CREATE INDEX idx_bobai_created ON bobai_scores (created_at DESC);
