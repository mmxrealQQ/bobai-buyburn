-- BOBAI Worldcup '26 — Reset all user/test data
-- Run BEFORE public registration opens (04.06) if you want a clean slate.
-- Keeps wc_matches + wc_pool (reference data); wipes all user-created rows.
--
-- ⚠ DESTRUCTIVE: deletes ALL users including yours.
--   You'll need to re-register after running this.

BEGIN;

-- 1) Drop donation log (no FK to wc_users)
DELETE FROM wc_donations;

-- 2) Delete every Supabase auth user that has a wc_users profile.
--    FK chain: auth.users → wc_users (CASCADE) → wc_tips/wc_bonus/wc_crypto (CASCADE)
--    so this one DELETE wipes everything user-related in one shot.
DELETE FROM auth.users WHERE id IN (SELECT auth_id FROM wc_users);

-- Safety net for the historical synthetic-email accounts (pre-Phase-H).
-- These had no matching wc_users row in some failed-registration cases.
DELETE FROM auth.users WHERE email LIKE '%@worldcup.bobai.app';

-- Belt-and-suspenders: if any orphan game rows survived the cascade, kill them.
DELETE FROM wc_tips;
DELETE FROM wc_bonus;
DELETE FROM wc_crypto;
DELETE FROM wc_users;

-- 3) Reset pool counters (kept for now; will start filling from kickoff)
UPDATE wc_pool SET
  total_bobai = 0,
  group_pot   = 0,
  endpool     = 0,
  crypto_pot  = 0,
  updated_at  = NOW()
WHERE id = 1;

COMMIT;
