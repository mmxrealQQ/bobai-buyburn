// BOBAI Worldcup '26 — Shared nav behavior
// Activates the current tab, wires logout, and fills the "Hi <user>" slot.
// Pages that include this script just need the <nav> markup with `.tabbar a[data-tab]`
// items plus optional #me-name + #logout elements.

(function(){
  // Determine current tab from filename (dashboard.html → dashboard).
  const file = (window.location.pathname.split('/').pop() || 'dashboard.html')
    .replace('.html','') || 'dashboard';

  // Mark active tab
  document.querySelectorAll('.tabbar a').forEach(a => {
    if (a.dataset.tab === file) a.classList.add('active');
  });

  // Inject an inline "← back" row between the sticky nav and main content.
  // Skipped when the user has no in-app history (deep-link entry, refresh on
  // first page), since history.back() would otherwise leave the app.
  (function injectBackRow(){
    const nav = document.querySelector('nav');
    if (!nav) return;
    const ref = document.referrer || '';
    const sameOrigin = ref && ref.indexOf(window.location.origin) === 0;
    const hasInAppHistory = sameOrigin && ref !== window.location.href;
    if (!hasInAppHistory) return;
    const row = document.createElement('div');
    row.className = 'back-row';
    row.innerHTML = '<button type="button" id="nav-back"><span class="ic">←</span> back</button>';
    nav.insertAdjacentElement('afterend', row);
    row.querySelector('#nav-back').addEventListener('click', () => {
      if (window.history.length > 1) window.history.back();
      else window.location.href = './dashboard.html';
    });
  })();

  // Wire logout (anywhere on the page)
  const lo = document.getElementById('logout');
  if (lo) {
    lo.addEventListener('click', async (e) => {
      e.preventDefault();
      if (window.WC_AUTH) await window.WC_AUTH.logout();
      window.location.href = '/worldcup/';
    });
  }

  // Populate #me-name with the current username (and redirect to landing if not signed in).
  // Pages that have their own auth-gate (e.g. dashboard.html) can ignore the redirect —
  // we only redirect when the page actually carries a #me-name placeholder, i.e. it
  // expects an authenticated user.
  const me = document.getElementById('me-name');
  if (me && window.WC_AUTH) {
    (async () => {
      try {
        const p = await window.WC_AUTH.currentProfile();
        if (!p) {
          // Authenticated-only page → bounce to landing for sign-in
          window.location.href = '/worldcup/';
          return;
        }
        me.textContent = p.username;
      } catch (e) { /* swallow — page-local auth code will handle errors */ }
    })();
  }
})();
