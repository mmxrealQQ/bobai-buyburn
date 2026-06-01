-- BOBAI Worldcup '26 — Beta Schema
-- Run in Supabase SQL Editor (same project as buildonbnbgame)
-- All tables prefixed wc_ to keep app data isolated

-- ============================================================
-- 1) PROFILES (linked to auth.users, username-based)
-- ============================================================
CREATE TABLE wc_users (
  id BIGSERIAL PRIMARY KEY,
  auth_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL CHECK (char_length(username) BETWEEN 3 AND 20),
  username_lc TEXT GENERATED ALWAYS AS (lower(username)) STORED,
  wallet TEXT,                        -- lowercase BEP-20 address, NULL if not connected
  wallet_verified BOOLEAN DEFAULT FALSE,
  avatar_country TEXT,                -- ISO country code (e.g. 'BR','FR','USA')
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX wc_users_username_lc ON wc_users (username_lc);
CREATE INDEX wc_users_wallet ON wc_users (wallet) WHERE wallet IS NOT NULL;

-- ============================================================
-- 2) MATCHES (static reference data, 104 entries: 72 group + 32 KO)
-- ============================================================
CREATE TABLE wc_matches (
  id INT PRIMARY KEY,                 -- 1-72 group, 73-104 KO
  phase TEXT NOT NULL,                -- 'group','r32','r16','qf','sf','3rd','final'
  group_letter CHAR(1),               -- 'A'-'L' for group, NULL for KO
  team_home TEXT,                     -- ISO or 'TBD'
  team_away TEXT,
  kickoff_utc TIMESTAMPTZ NOT NULL,
  goals_home INT,                     -- NULL until played
  goals_away INT,
  played BOOLEAN DEFAULT FALSE,
  multiplier INT DEFAULT 1            -- group=1, r32=2, r16=3, qf=4, sf=5, 3rd=6, final=7 (rebalanced 17 May 2026, see migration_phase_j)
);
CREATE INDEX wc_matches_kickoff ON wc_matches (kickoff_utc);
CREATE INDEX wc_matches_phase ON wc_matches (phase);

-- ============================================================
-- 3) MATCH TIPS
-- ============================================================
CREATE TABLE wc_tips (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES wc_users(id) ON DELETE CASCADE,
  match_id INT REFERENCES wc_matches(id),
  tip_home INT NOT NULL CHECK (tip_home >= 0 AND tip_home <= 30),
  tip_away INT NOT NULL CHECK (tip_away >= 0 AND tip_away <= 30),
  points INT DEFAULT 0,               -- computed after match (raw, pre-multiplier)
  points_final INT DEFAULT 0,         -- post-multiplier
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, match_id)
);
CREATE INDEX wc_tips_user ON wc_tips (user_id);
CREATE INDEX wc_tips_match ON wc_tips (match_id);

-- ============================================================
-- 4) BONUS ANSWERS (pre-WC, 20pts each)
-- ============================================================
CREATE TABLE wc_bonus (
  user_id BIGINT PRIMARY KEY REFERENCES wc_users(id) ON DELETE CASCADE,
  champion TEXT,                      -- predicted winner (ISO code)
  most_goals_team TEXT,
  fewest_goals_team TEXT,
  red_cards_bracket TEXT,             -- '<5','5-9','10-14','15-19','>19'
  q5 TEXT,                            -- placeholder
  q6 TEXT,                            -- placeholder
  points INT DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5) CRYPTO PREDICTIONS (at final kickoff)
-- ============================================================
CREATE TABLE wc_crypto (
  user_id BIGINT PRIMARY KEY REFERENCES wc_users(id) ON DELETE CASCADE,
  btc_price NUMERIC(18,2),
  bnb_price NUMERIC(18,4),
  bobai_price NUMERIC(20,10),
  btc_diff NUMERIC,                   -- abs diff to actual, set at final-kickoff
  bnb_diff NUMERIC,
  bobai_diff NUMERIC,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6) POOL STATE (single row)
-- ============================================================
CREATE TABLE wc_pool (
  id INT PRIMARY KEY DEFAULT 1,
  total_bobai NUMERIC DEFAULT 0,
  group_pot NUMERIC DEFAULT 0,        -- 60% during group phase
  endpool NUMERIC DEFAULT 0,          -- 30% group / 90% KO
  crypto_pot NUMERIC DEFAULT 0,       -- 10% always
  bobai_price_usd NUMERIC,            -- cached for display
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (id = 1)                      -- enforce single row
);
INSERT INTO wc_pool (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- 7) DONATIONS LOG
-- ============================================================
CREATE TABLE wc_donations (
  id BIGSERIAL PRIMARY KEY,
  from_address TEXT NOT NULL,
  token TEXT NOT NULL,                -- 'BNB','USDT','TAX'
  amount_in NUMERIC NOT NULL,
  amount_bobai NUMERIC,
  tx_hash TEXT UNIQUE,
  swap_tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX wc_donations_from ON wc_donations (from_address);
CREATE INDEX wc_donations_created ON wc_donations (created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE wc_users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wc_matches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wc_tips      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wc_bonus     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wc_crypto    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wc_pool      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wc_donations ENABLE ROW LEVEL SECURITY;

-- USERS: public can read leaderboard fields, only owner writes own row
CREATE POLICY wc_users_read       ON wc_users FOR SELECT USING (true);
CREATE POLICY wc_users_insert_own ON wc_users FOR INSERT WITH CHECK (auth.uid() = auth_id);
CREATE POLICY wc_users_update_own ON wc_users FOR UPDATE USING (auth.uid() = auth_id);

-- IMMUTABILITY: username + auth_id can NEVER change after creation
CREATE OR REPLACE FUNCTION wc_users_immutable_check() RETURNS TRIGGER AS $$
BEGIN
  -- Service role (Cloudflare Worker) bypasses all immutability checks
  IF coalesce(current_setting('request.jwt.claims', true)::json->>'role','') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.auth_id IS DISTINCT FROM OLD.auth_id THEN
    RAISE EXCEPTION 'auth_id is immutable';
  END IF;
  IF NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'username is immutable';
  END IF;
  -- Users cannot self-verify their wallet; flip happens via service-role flow
  IF NEW.wallet_verified IS DISTINCT FROM OLD.wallet_verified AND OLD.wallet_verified = FALSE THEN
    RAISE EXCEPTION 'wallet_verified can only be set via signature verification flow';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wc_users_immutable BEFORE UPDATE ON wc_users
FOR EACH ROW EXECUTE FUNCTION wc_users_immutable_check();

-- MATCHES: public read-only (writes via service role)
CREATE POLICY wc_matches_read ON wc_matches FOR SELECT USING (true);

-- TIPS: public can read all (for leaderboard transparency), owner writes own
-- DB-enforced lock: tips can only be inserted/updated BEFORE match kickoff
CREATE POLICY wc_tips_read       ON wc_tips FOR SELECT USING (true);
CREATE POLICY wc_tips_insert_own ON wc_tips FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND (SELECT kickoff_utc FROM wc_matches WHERE id = match_id) > NOW()
);
CREATE POLICY wc_tips_update_own ON wc_tips FOR UPDATE USING (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND (SELECT kickoff_utc FROM wc_matches WHERE id = match_id) > NOW()
);

-- BONUS: public can read (for transparency), owner writes own
-- DB-enforced lock: locked once the FIRST match (id=1) has kicked off
CREATE POLICY wc_bonus_read       ON wc_bonus FOR SELECT USING (true);
CREATE POLICY wc_bonus_insert_own ON wc_bonus FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND (SELECT kickoff_utc FROM wc_matches WHERE id = 1) > NOW()
);
CREATE POLICY wc_bonus_update_own ON wc_bonus FOR UPDATE USING (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND (SELECT kickoff_utc FROM wc_matches WHERE id = 1) > NOW()
);

-- CRYPTO: public can read, owner writes own
-- DB-enforced lock: locked once the FINAL match has kicked off
CREATE POLICY wc_crypto_read       ON wc_crypto FOR SELECT USING (true);
CREATE POLICY wc_crypto_insert_own ON wc_crypto FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND (SELECT kickoff_utc FROM wc_matches WHERE phase = 'final' ORDER BY kickoff_utc DESC LIMIT 1) > NOW()
);
CREATE POLICY wc_crypto_update_own ON wc_crypto FOR UPDATE USING (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND (SELECT kickoff_utc FROM wc_matches WHERE phase = 'final' ORDER BY kickoff_utc DESC LIMIT 1) > NOW()
);

-- POOL & DONATIONS: public read-only
CREATE POLICY wc_pool_read      ON wc_pool      FOR SELECT USING (true);
CREATE POLICY wc_donations_read ON wc_donations FOR SELECT USING (true);

-- ============================================================
-- LEADERBOARD VIEW (computed aggregate)
-- ============================================================
CREATE OR REPLACE VIEW wc_leaderboard AS
SELECT
  u.id            AS user_id,
  u.username,
  u.avatar_country,
  (u.wallet IS NOT NULL AND u.wallet_verified) AS has_wallet,
  COALESCE(SUM(t.points_final), 0) + COALESCE(b.points, 0) AS total_points,
  COALESCE(SUM(t.points_final), 0) AS match_points,
  COALESCE(b.points, 0) AS bonus_points,
  COUNT(t.id) FILTER (WHERE t.resolved) AS matches_resolved
FROM wc_users u
LEFT JOIN wc_tips  t ON t.user_id = u.id
LEFT JOIN wc_bonus b ON b.user_id = u.id
GROUP BY u.id, u.username, u.avatar_country, u.wallet, u.wallet_verified, b.points;

GRANT SELECT ON wc_leaderboard TO anon, authenticated;
