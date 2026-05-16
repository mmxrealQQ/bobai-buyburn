-- Phase H hotfix — grant anon + authenticated explicit privileges on wc_* tables.
-- Required because new sb_publishable_*/sb_secret_* API keys don't get implicit
-- table privileges like the legacy JWT keys did. Without this, every INSERT
-- into wc_users (during signup) fails with "permission denied for table".
--
-- RLS policies remain the gatekeeper — these GRANTs only allow the role to
-- attempt the operation; the policy WITH CHECK still has to pass.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- All current tables: authenticated does full CRUD (RLS scopes to owner),
-- anon is read-only (for public leaderboard / pool / matches).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Sequences (BIGSERIAL columns need USAGE on the underlying sequence for INSERT)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Functions (RPCs like wc_username_to_email)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- Auto-apply same grants to any tables/sequences/functions added later
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
