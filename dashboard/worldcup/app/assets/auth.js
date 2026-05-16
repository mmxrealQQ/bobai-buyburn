// $BOBAI Worldcup '26 — Auth helpers
// Real-email auth: users sign up with their own email; login accepts
// username OR email; password reset via email link.

(function(){
  const cfg = window.WC_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage },
  });
  window.WC_SB = sb;

  // Username: 3–20 chars, letters/numbers/underscore (also enforced by DB CHECK)
  const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
  // Basic email format (Supabase does the deep validation)
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function register({ username, email, password, passwordConfirm, country }){
    username = (username || '').trim();
    email = (email || '').trim().toLowerCase();

    if (!USERNAME_RE.test(username)) {
      return { error: 'Username must be 3–20 chars, letters/numbers/underscore only.' };
    }
    if (!EMAIL_RE.test(email)) {
      return { error: 'Please enter a valid email address.' };
    }
    if (!password || password.length < 6) {
      return { error: 'Password must be at least 6 characters.' };
    }
    if (password !== passwordConfirm) {
      return { error: 'Passwords do not match.' };
    }

    // 1) Create auth user with real email.
    //    If "Confirm email" is enabled in Supabase, this sends a confirmation
    //    link and the user must verify before they can sign in.
    const { data: signUp, error: signUpErr } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + '/worldcup/app/',
        data: { username },
      },
    });
    if (signUpErr) {
      const m = (signUpErr.message || '').toLowerCase();
      if (m.includes('already registered') || m.includes('already in use')) {
        return { error: 'Email already registered. Try signing in or use password reset.' };
      }
      return { error: signUpErr.message };
    }
    if (!signUp.user) {
      return { error: 'Sign-up failed (no user returned).' };
    }

    // 2) Insert profile row. RLS only allows insert when auth.uid() matches
    //    auth_id, which works because signUp also created an active session
    //    (unless email confirmation is on — then we still try and let it
    //    succeed via the existing session OR fall through with a clear msg).
    const { error: profileErr } = await sb.from('wc_users').insert({
      auth_id: signUp.user.id,
      username,
      avatar_country: country || null,
    });
    if (profileErr) {
      const m = (profileErr.message || '').toLowerCase();
      // Username uniqueness collision (case-insensitive via username_lc index)
      if (m.includes('duplicate') || m.includes('unique')) {
        // Don't sign out — they may still want to verify their email and try a different username later.
        return { error: 'Username already taken. Please pick another.' };
      }
      // Email confirmation flow: no session yet → RLS rejects insert.
      // We'll let the user finish confirmation and create the profile on first sign-in (see ensureProfile()).
      if (m.includes('row-level security') || m.includes('rls')) {
        return {
          ok: true,
          needsConfirmation: true,
          pendingProfile: { username, country: country || null },
        };
      }
      return { error: profileErr.message };
    }

    // If there's no session (confirmation required), tell the UI.
    const { data: s } = await sb.auth.getSession();
    if (!s.session) {
      return { ok: true, needsConfirmation: true };
    }
    return { ok: true, user: signUp.user };
  }

  async function login({ identifier, password }){
    identifier = (identifier || '').trim();
    if (!identifier) return { error: 'Enter your username or email.' };
    if (!password) return { error: 'Enter your password.' };

    let email = null;
    if (identifier.includes('@')) {
      email = identifier.toLowerCase();
    } else {
      if (!USERNAME_RE.test(identifier)) {
        return { error: 'Invalid username format.' };
      }
      // Resolve username → email via RPC
      const { data, error } = await sb.rpc('wc_username_to_email', { p_username: identifier });
      if (error || !data) {
        return { error: 'Wrong username or password.' };
      }
      email = data;
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('email not confirmed')) {
        return { error: 'Please confirm your email first — check your inbox.' };
      }
      return { error: 'Wrong username/email or password.' };
    }

    // Make sure the profile row exists (for users whose sign-up insert was deferred
    // due to email-confirmation flow).
    await ensureProfile(data.user);

    return { ok: true, user: data.user };
  }

  // Reset request — sends a password-reset email with a link back to reset.html.
  async function resetPasswordRequest(email){
    email = (email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return { error: 'Please enter a valid email address.' };
    }
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/worldcup/app/reset.html',
    });
    if (error) return { error: error.message };
    return { ok: true };
  }

  // Called on reset.html after the user clicks the email link.
  async function updatePassword(newPassword, confirmPassword){
    if (!newPassword || newPassword.length < 6) {
      return { error: 'Password must be at least 6 characters.' };
    }
    if (newPassword !== confirmPassword) {
      return { error: 'Passwords do not match.' };
    }
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    return { ok: true };
  }

  async function logout(){
    await sb.auth.signOut();
  }

  // Lazily create the wc_users row if it's missing (handles the email-confirm
  // race where signUp insert was blocked by RLS pre-session).
  async function ensureProfile(authUser){
    if (!authUser) return null;
    const { data: existing } = await sb
      .from('wc_users')
      .select('id, username, avatar_country, wallet, wallet_verified')
      .eq('auth_id', authUser.id)
      .maybeSingle();
    if (existing) return existing;

    const meta = authUser.user_metadata || {};
    const username = meta.username;
    if (!username || !USERNAME_RE.test(username)) return null;

    const { data: row, error } = await sb
      .from('wc_users')
      .insert({
        auth_id: authUser.id,
        username,
        avatar_country: meta.country || null,
      })
      .select('id, username, avatar_country, wallet, wallet_verified')
      .single();
    if (error) return null;
    return row;
  }

  async function currentProfile(){
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return null;
    const { data, error } = await sb
      .from('wc_users')
      .select('id, username, avatar_country, wallet, wallet_verified')
      .eq('auth_id', s.session.user.id)
      .maybeSingle();
    if (error) return null;
    if (data) return data;
    // Profile missing → try to backfill (post email-confirmation case)
    return await ensureProfile(s.session.user);
  }

  window.WC_AUTH = {
    register, login, logout, currentProfile,
    resetPasswordRequest, updatePassword,
  };
})();
