-- BOBAI Worldcup '26 — Phase L: one-time reopen of Bonus + Crypto submissions
--
-- Original rule: bonus + crypto predictions locked at the first-match kickoff
-- (wc_matches id=1, 2026-06-11 19:00 UTC).
--
-- After MD1 we noticed late joiners had zero chance to play. Fair extension:
-- reopen Bonus + Crypto editing for everyone (existing + new users) and lock
-- finally 15 min before the first MD2 match (CZ–ZA, 2026-06-18 16:00 UTC),
-- i.e. 2026-06-18 15:45 UTC.
--
-- This is a ONE-TIME extension — the new lock is a hard-coded timestamp so it
-- isn't coupled to match IDs (cleaner; no risk of moving again if matches get
-- reshuffled).
--
-- Crypto: the scoring snapshot is still taken at the Final kickoff (19 Jul 2026
-- 19:00 UTC) — only the edit deadline moves, no re-snapshot needed.

-- BONUS
DROP POLICY IF EXISTS wc_bonus_insert_own ON wc_bonus;
DROP POLICY IF EXISTS wc_bonus_update_own ON wc_bonus;

CREATE POLICY wc_bonus_insert_own ON wc_bonus FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND NOW() < '2026-06-18 15:45+00'::timestamptz
);

CREATE POLICY wc_bonus_update_own ON wc_bonus FOR UPDATE USING (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND NOW() < '2026-06-18 15:45+00'::timestamptz
);

-- CRYPTO
DROP POLICY IF EXISTS wc_crypto_insert_own ON wc_crypto;
DROP POLICY IF EXISTS wc_crypto_update_own ON wc_crypto;

CREATE POLICY wc_crypto_insert_own ON wc_crypto FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND NOW() < '2026-06-18 15:45+00'::timestamptz
);

CREATE POLICY wc_crypto_update_own ON wc_crypto FOR UPDATE USING (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND NOW() < '2026-06-18 15:45+00'::timestamptz
);
