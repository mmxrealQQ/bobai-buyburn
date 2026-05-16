-- $BOBAI Worldcup '26 — Phase H Auth Migration
-- Switch from synthetic-email auth (<username>@worldcup.bobai.app)
-- to real-email auth (user provides their own email; can log in via
-- username OR email; password reset via email).
--
-- Run AFTER reset_test_data.sql (since old synthetic-email users won't
-- have a real email and can't be migrated).

-- ============================================================
-- RPC: wc_username_to_email(p_username)
-- Resolves a username to the auth.users.email so client can call
-- signInWithPassword({ email, password }) when the user typed only
-- a username. SECURITY DEFINER bypasses RLS so anonymous callers
-- (pre-login) can use it.
--
-- Trade-off accepted: this exposes the email of any username someone
-- queries. Username enumeration is already possible via the "Username
-- already taken" sign-up error, so this is an acceptable widening for
-- the login UX. Supabase auth rate limiting still applies on the
-- subsequent password attempt.
-- ============================================================
CREATE OR REPLACE FUNCTION public.wc_username_to_email(p_username TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.email
  FROM wc_users wu
  JOIN auth.users au ON au.id = wu.auth_id
  WHERE wu.username_lc = lower(p_username)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.wc_username_to_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wc_username_to_email(TEXT) TO anon, authenticated;
