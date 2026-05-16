// $BOBAI Worldcup '26 — Auth helpers (username+password via synthetic email)
// Loaded after config.js and the Supabase UMD bundle.

(function(){
  const cfg = window.WC_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage },
  });
  window.WC_SB = sb;

  // Username rules — also enforced by DB CHECK constraint
  const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

  function usernameToEmail(username){
    return username.trim().toLowerCase() + '@' + cfg.AUTH_EMAIL_DOMAIN;
  }

  async function register({ username, password, country }){
    if (!USERNAME_RE.test(username)) {
      return { error: 'Username must be 3–20 chars, letters/numbers/underscore only.' };
    }
    if (password.length < 6) {
      return { error: 'Password must be at least 6 characters.' };
    }

    // 1) Reserve username in profile table FIRST? — no, RLS forbids that pre-auth.
    //    Approach: create auth user, then insert profile. On profile-collision: rollback by signing out.
    const email = usernameToEmail(username);
    const { data: signUp, error: signUpErr } = await sb.auth.signUp({ email, password });
    if (signUpErr) {
      if (signUpErr.message.toLowerCase().includes('already registered'))
        return { error: 'Username already taken.' };
      return { error: signUpErr.message };
    }
    if (!signUp.user) {
      return { error: 'Sign-up failed (no user returned).' };
    }

    const { error: profileErr } = await sb.from('wc_users').insert({
      auth_id: signUp.user.id,
      username,
      avatar_country: country || null,
    });
    if (profileErr) {
      // username collision in profile table
      await sb.auth.signOut();
      if ((profileErr.message || '').toLowerCase().includes('duplicate'))
        return { error: 'Username already taken.' };
      return { error: profileErr.message };
    }

    return { ok: true, user: signUp.user };
  }

  async function login({ username, password }){
    if (!USERNAME_RE.test(username)) {
      return { error: 'Invalid username format.' };
    }
    const email = usernameToEmail(username);
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { error: 'Wrong username or password.' };
    return { ok: true, user: data.user };
  }

  async function logout(){
    await sb.auth.signOut();
  }

  async function currentProfile(){
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return null;
    const { data, error } = await sb
      .from('wc_users')
      .select('id, username, avatar_country, wallet, wallet_verified')
      .eq('auth_id', s.session.user.id)
      .single();
    if (error) return null;
    return data;
  }

  window.WC_AUTH = { register, login, logout, currentProfile };
})();
