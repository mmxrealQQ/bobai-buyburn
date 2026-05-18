-- BOBAI Worldcup '26 — Phase H follow-up: lock crypto predictions at tournament start
--
-- Previously crypto predictions stayed editable until the FINAL kickoff, which
-- meant they could not be revealed on public profiles until after the Final.
-- New rule: crypto predictions lock when the FIRST match kicks off (same lock
-- moment as bonus). They then become publicly visible during the tournament,
-- and the leaderboard can show who's currently closest to the live price.

DROP POLICY IF EXISTS wc_crypto_insert_own ON wc_crypto;
DROP POLICY IF EXISTS wc_crypto_update_own ON wc_crypto;

CREATE POLICY wc_crypto_insert_own ON wc_crypto FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND (SELECT kickoff_utc FROM wc_matches WHERE id = 1) > NOW()
);

CREATE POLICY wc_crypto_update_own ON wc_crypto FOR UPDATE USING (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND (SELECT kickoff_utc FROM wc_matches WHERE id = 1) > NOW()
);
