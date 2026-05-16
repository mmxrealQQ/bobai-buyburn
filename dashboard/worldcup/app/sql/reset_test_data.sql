-- $BOBAI Worldcup '26 — Reset all user/test data
-- Run BEFORE public registration opens (04.06) if you want a clean slate.
-- Keeps wc_matches + wc_pool (reference data); wipes all user-created rows.
--
-- ⚠ DESTRUCTIVE: deletes ALL users including yours.
--   You'll need to re-register after running this.

BEGIN;

-- 1) Drop all user-created game data (cascades from wc_users via ON DELETE CASCADE)
DELETE FROM wc_donations;   -- donation log
DELETE FROM wc_tips;        -- match tips
DELETE FROM wc_bonus;       -- bonus answers
DELETE FROM wc_crypto;      -- crypto predictions
DELETE FROM wc_users;       -- profile rows

-- 2) Delete the Supabase auth users tied to our synthetic email domain
--    (otherwise usernames stay reserved in auth.users and re-registering fails)
DELETE FROM auth.users WHERE email LIKE '%@worldcup.bobai.app';

-- 3) Reset pool counters (kept for now; will start filling from kickoff)
UPDATE wc_pool SET
  total_bobai = 0,
  group_pot   = 0,
  endpool     = 0,
  crypto_pot  = 0,
  updated_at  = NOW()
WHERE id = 1;

COMMIT;
