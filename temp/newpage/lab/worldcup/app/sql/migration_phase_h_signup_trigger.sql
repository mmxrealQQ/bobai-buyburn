-- Phase H — auto-create wc_users profile when an auth.users row is created.
-- Replaces the client-side insert (which fails when Confirm Email is on,
-- because the new user has no session yet → anon role → permission denied).
--
-- Username uniqueness is enforced by the existing unique index on
-- wc_users.username_lc — if it collides, the trigger raises an exception,
-- which rolls back the auth.users INSERT too. Net effect: signUp fails
-- with "Database error saving new user", which the client maps to
-- "Username already taken".
--
-- Signups WITHOUT a `username` in raw_user_meta_data are skipped, so this
-- trigger is safe even if other apps share this Supabase project.

CREATE OR REPLACE FUNCTION public.wc_handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
  v_country  TEXT;
BEGIN
  v_username := NEW.raw_user_meta_data->>'username';
  v_country  := NEW.raw_user_meta_data->>'country';

  -- Only auto-create for users that signed up via the worldcup app
  -- (they always carry a username in user_metadata).
  IF v_username IS NULL OR v_username = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.wc_users (auth_id, username, avatar_country)
  VALUES (NEW.id, v_username, NULLIF(v_country, ''));

  RETURN NEW;
END;
$$;

-- Replace any prior version of the trigger
DROP TRIGGER IF EXISTS wc_on_auth_user_created ON auth.users;

CREATE TRIGGER wc_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.wc_handle_new_user();
