-- Phase C migration — bonus questions finalized, RLS hardened for empty-match-table case
-- Run in Supabase SQL Editor after the base schema.sql.

-- 1) wc_bonus: q5 → topscorer_country (typed properly), drop q6 placeholder
ALTER TABLE wc_bonus RENAME COLUMN q5 TO topscorer_country;
ALTER TABLE wc_bonus DROP COLUMN q6;

-- 2) Harden RLS time-locks so they don't reject inserts when wc_matches is empty
--    (during beta build, matches aren't seeded yet — without COALESCE, NULL > NOW()
--     returns NULL which fails the WITH CHECK clause and blocks legitimate inserts)

DROP POLICY IF EXISTS wc_bonus_insert_own ON wc_bonus;
DROP POLICY IF EXISTS wc_bonus_update_own ON wc_bonus;
CREATE POLICY wc_bonus_insert_own ON wc_bonus FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND COALESCE((SELECT kickoff_utc FROM wc_matches WHERE id = 1), '9999-12-31'::timestamptz) > NOW()
);
CREATE POLICY wc_bonus_update_own ON wc_bonus FOR UPDATE USING (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND COALESCE((SELECT kickoff_utc FROM wc_matches WHERE id = 1), '9999-12-31'::timestamptz) > NOW()
);

DROP POLICY IF EXISTS wc_crypto_insert_own ON wc_crypto;
DROP POLICY IF EXISTS wc_crypto_update_own ON wc_crypto;
CREATE POLICY wc_crypto_insert_own ON wc_crypto FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND COALESCE(
        (SELECT kickoff_utc FROM wc_matches WHERE phase = 'final' ORDER BY kickoff_utc DESC LIMIT 1),
        '9999-12-31'::timestamptz
      ) > NOW()
);
CREATE POLICY wc_crypto_update_own ON wc_crypto FOR UPDATE USING (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND COALESCE(
        (SELECT kickoff_utc FROM wc_matches WHERE phase = 'final' ORDER BY kickoff_utc DESC LIMIT 1),
        '9999-12-31'::timestamptz
      ) > NOW()
);

-- Tips RLS already covers this implicitly: tip insert requires a wc_matches row with kickoff > NOW(),
-- so empty wc_matches naturally blocks tipping until Phase D seeds the matches. Keep as-is.
