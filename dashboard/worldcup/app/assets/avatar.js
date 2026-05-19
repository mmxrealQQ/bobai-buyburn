// BOBAI Worldcup '26 — Shared avatar / illustration helper.
//
// Single source of truth for every illustration slot in the app. The
// designer drops a file into the right path, and this helper picks it up
// everywhere without any further code changes.
//
// Files the designer is expected to deliver:
//   /worldcup/app/illus/avatars/avatar-<CODE>.webp   (48 country avatars)
//   /worldcup/app/illus/pool-trophy.webp             (pool-card flourish)
//   /worldcup/app/illus/bonus-hero.webp              (bonus banner, optional)
//   /worldcup/app/illus/coin-btc.webp
//   /worldcup/app/illus/coin-bnb.webp
//   /worldcup/app/illus/coin-bobai.webp
//
// Two render modes:
//   - Production: if the file exists, the WebP is shown; otherwise a
//     fallback (flag emoji / unicode glyph) keeps the UI working.
//   - Designer (`?design=1` on any URL OR window.WC_DESIGN === true):
//     missing files are highlighted with a dashed magenta box that
//     prints the expected filename — so the designer can see at a
//     glance what's still missing.
//
// Avatar size presets:
//   xs = 24 (leaderboard rows)
//   sm = 32
//   md = 56 (small profile chips)
//   lg = 72 (profile headers)
//   xl = 96 (champion picker cards)

(function(){
  const BASE = '/worldcup/app/illus/';
  const AVATAR_BASE = BASE + 'avatars/';

  // Formats we try, in priority order. The designer just drops *any* of these
  // into the right folder and the app picks it up.
  const FORMATS = ['webp', 'png', 'jpg', 'jpeg', 'svg'];

  // Designer mode toggle: ?design=1 OR localStorage('wc_design') OR window.WC_DESIGN
  const params = new URLSearchParams(window.location.search);
  const designOn = params.has('design') ||
                   localStorage.getItem('wc_design') === '1' ||
                   window.WC_DESIGN === true;
  if (params.has('design')) localStorage.setItem('wc_design', '1');
  if (params.get('design') === '0') localStorage.removeItem('wc_design');

  const SIZES = { xs: 24, sm: 32, md: 56, lg: 72, xl: 96 };

  // Inline-onerror chain: when the current src 404s, jump to the next format.
  // After the last format, swap the <img> for the fallback flag span.
  // Exposed on window so onerror="WC_AVATAR.imgError(this)" works.
  function imgError(img){
    const base = img.dataset.fBase;
    const fmts = (img.dataset.fFmts || FORMATS.join(',')).split(',');
    let idx = parseInt(img.dataset.fIdx || '0', 10);
    idx++;
    if (idx < fmts.length) {
      img.dataset.fIdx = idx;
      img.src = base + '.' + fmts[idx];
      return;
    }
    // All formats failed — show fallback inside the parent .wc-ava
    img.onerror = null;
    const flag = img.dataset.fFlag || '⚪';
    const wrap = img.parentElement;
    img.remove();
    if (wrap && wrap.classList.contains('wc-ava')) {
      // Use existing .wc-ava-fallback if present (designer mode), else add one
      let fb = wrap.querySelector('.wc-ava-fallback');
      if (!fb) {
        fb = document.createElement('span');
        fb.className = 'wc-ava-fallback';
        const size = parseInt(wrap.style.width || '72', 10);
        fb.style.cssText = `display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${Math.round(size*0.55)}px;line-height:1`;
        fb.textContent = flag;
        wrap.appendChild(fb);
      }
    }
  }

  function findCountry(code){
    if (!window.WC_COUNTRIES) return null;
    return window.WC_COUNTRIES.find(c => c.code === code) || null;
  }

  function avatarBase(code){
    if (!code) return null;
    return AVATAR_BASE + 'avatar-' + code;        // extension-less
  }
  function avatarUrl(code, ext){
    if (!code) return null;
    return avatarBase(code) + '.' + (ext || FORMATS[0]);
  }

  // Inline HTML snippet for a single country avatar.
  // Renders an <img> that walks through webp → png → jpg → jpeg → svg via
  // onerror. After the last format also 404s, it gets replaced with a flag
  // emoji span. In designer mode a magenta dashed wrap shows the filename.
  function avatarHtml(code, sizeKey = 'lg'){
    const px = SIZES[sizeKey] || SIZES.lg;
    const c = findCountry(code);
    const flag = c ? c.flag : '⚪';
    if (!code) {
      return `<span class="wc-ava wc-ava-${sizeKey}" data-empty style="width:${px}px;height:${px}px;font-size:${Math.round(px*0.55)}px">⚪</span>`;
    }
    const base = avatarBase(code);
    const fmts = FORMATS.join(',');
    const designCls = designOn ? ' wc-ava-design' : '';
    const designTag = designOn
      ? `<span class="wc-ava-fallback" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${Math.round(px*0.55)}px;line-height:1">${flag}</span>
         <span class="wc-ava-tag">avatar-${code}.{webp|png|jpg}</span>`
      : '';
    return `<span class="wc-ava wc-ava-${sizeKey}${designCls}" style="width:${px}px;height:${px}px">
      <img class="wc-ava-img" alt="BOBAI ${c?c.name:code}"
           src="${base}.${FORMATS[0]}"
           data-f-base="${base}" data-f-fmts="${fmts}" data-f-idx="0" data-f-flag="${flag}"
           onload="this.parentElement.classList.add('wc-has-art')"
           onerror="window.WC_AVATAR.imgError(this)">
      ${designTag}
    </span>`;
  }

  // Generic illustration slot for non-avatar art (trophy, hero, coin icons).
  // `filename` is the WebP filename — same fallback chain to png/jpg/etc.
  function illusUrl(filename){ return BASE + filename; }
  function illusHtml(filename, opts){
    opts = opts || {};
    const w = opts.w || 200;
    const h = opts.h || 200;
    const alt = opts.alt || '';
    // strip extension so we can swap through the chain
    const base = BASE + filename.replace(/\.[a-z0-9]+$/i, '');
    const fmts = FORMATS.join(',');
    if (designOn) {
      return `<span class="wc-illus wc-illus-design" style="width:${w}px;height:${h}px;display:inline-flex">
        <img alt="${alt}" style="max-width:100%;max-height:100%"
             src="${base}.${FORMATS[0]}"
             data-f-base="${base}" data-f-fmts="${fmts}" data-f-idx="0"
             onload="this.parentElement.classList.add('wc-has-art')"
             onerror="this.style.display='none'">
        <span class="wc-illus-tag">${filename}</span>
      </span>`;
    }
    return `<img alt="${alt}" style="max-width:${w}px;max-height:${h}px"
                 src="${base}.${FORMATS[0]}"
                 data-f-base="${base}" data-f-fmts="${fmts}" data-f-idx="0"
                 onerror="this.style.display='none'">`;
  }

  // Hero banner helper — emits a full-width landscape illustration for the
  // top of a tab page. `slot` is the filename stem (e.g. 'dashboard-hero').
  // If the file doesn't exist (and we're not in designer mode), the wrapper
  // collapses silently so the page just shows its normal heading.
  function heroHtml(slot){
    const base = BASE + slot;
    const fmts = FORMATS.join(',');
    if (designOn) {
      return `<div class="wc-hero wc-hero-design">
        <img alt="" style="max-width:100%;max-height:240px;display:inline-block"
             src="${base}.${FORMATS[0]}"
             data-f-base="${base}" data-f-fmts="${fmts}" data-f-idx="0"
             onload="this.parentElement.classList.add('wc-has-art')"
             onerror="window.WC_AVATAR.heroError(this)">
        <span class="wc-hero-tag">${slot}.{webp|png|jpg}</span>
      </div>`;
    }
    return `<div class="wc-hero">
      <img alt="" src="${base}.${FORMATS[0]}"
           data-f-base="${base}" data-f-fmts="${fmts}" data-f-idx="0"
           onload="this.parentElement.classList.add('wc-has-art')"
           onerror="window.WC_AVATAR.heroError(this)">
    </div>`;
  }
  // Fallback chain for hero images. Walks through formats, then hides the
  // wrapper entirely so missing art doesn't leave a broken-image gap.
  function heroError(img){
    const base = img.dataset.fBase;
    const fmts = (img.dataset.fFmts || FORMATS.join(',')).split(',');
    let idx = parseInt(img.dataset.fIdx || '0', 10);
    idx++;
    if (idx < fmts.length) {
      img.dataset.fIdx = idx;
      img.src = base + '.' + fmts[idx];
      return;
    }
    img.onerror = null;
    const wrap = img.parentElement;
    if (wrap && wrap.classList.contains('wc-hero') && !wrap.classList.contains('wc-hero-design')) {
      wrap.style.display = 'none';
    } else {
      img.style.display = 'none';
    }
  }

  // Same idea as heroHtml but for the small pool-card corner trophy accent.
  function poolTrophyHtml(){
    const base = BASE + 'pool-trophy';
    const fmts = FORMATS.join(',');
    return `<div class="wc-pool-trophy">
      <img alt="" src="${base}.${FORMATS[0]}"
           data-f-base="${base}" data-f-fmts="${fmts}" data-f-idx="0"
           onerror="window.WC_AVATAR.heroError(this)">
    </div>`;
  }

  // Generic card-corner accent (e.g. bonus-crystal, tips-ball). Same fallback
  // chain as heroHtml; positioned absolute top-right of the parent .card.
  function cardAccentHtml(slot){
    const base = BASE + slot;
    const fmts = FORMATS.join(',');
    return `<div class="wc-card-accent" data-slot="${slot}">
      <img alt="" src="${base}.${FORMATS[0]}"
           data-f-base="${base}" data-f-fmts="${fmts}" data-f-idx="0"
           onerror="window.WC_AVATAR.heroError(this)">
    </div>`;
  }

  // Programmatic single-URL check — returns Promise<boolean>.
  // We can't just trust `response.ok`: CF Pages may serve the project's 404
  // HTML page with a 200 status for missing static files. So we also verify
  // the response is actually an image by checking Content-Type.
  function exists(path){
    return fetch(path, { method: 'HEAD', cache: 'no-store' })
      .then(r => {
        if (!r.ok) return false;
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        return ct.startsWith('image/');
      })
      .catch(() => false);
  }

  // Multi-format probe — returns the extension that exists, or null.
  // basePath = full URL without extension (e.g. ".../avatar-BR").
  // Runs all format probes in parallel and returns the first hit (in FORMATS
  // priority order). This keeps for-designer.html responsive: with N slots
  // and the sequential version it would do up to 5×N HEAD requests serially.
  async function findFormat(basePath){
    const probes = FORMATS.map(ext =>
      exists(basePath + '.' + ext).then(ok => ok ? ext : null)
    );
    const results = await Promise.all(probes);
    return results.find(Boolean) || null;
  }

  // Master inventory of every illustration slot. Used by for-designer.html.
  // basePath = URL without extension; the checker tries webp/png/jpg/jpeg/svg.
  function inventory(){
    const items = [];
    // 48 country avatars
    (window.WC_COUNTRIES || []).forEach(c => {
      items.push({
        kind: 'avatar',
        code: c.code,
        name: c.name,
        flag: c.flag,
        filename: 'avatars/avatar-' + c.code,
        basePath: AVATAR_BASE + 'avatar-' + c.code,
        specs: '512×512 transparent. BOBAI in the ' + c.name + ' national kit. Any format (WebP / PNG / JPG / SVG).',
        usedOn: 'Dashboard · Leaderboard · Public profile · Champion pick',
        required: true,
      });
    });
    // Page hero banners — one per tab. Landscape format, transparent.
    const HEROES = [
      { name: 'Dashboard hero',    filename: 'dashboard-hero',  usedOn: 'Dashboard page (top banner)' },
      { name: 'Tips hero',         filename: 'tips-hero',       usedOn: 'Tips page (top banner)' },
      { name: 'Bonus-questions hero banner', filename: 'bonus-hero', usedOn: 'Bonus page (above questions)' },
      { name: 'Crypto hero',       filename: 'crypto-hero',     usedOn: 'Crypto predictions page (top banner)' },
      { name: 'Leaderboard hero',  filename: 'leaderboard-hero',usedOn: 'Leaderboard page (top banner)' },
      { name: 'Prize Pool hero',   filename: 'prize-pool-hero', usedOn: 'Prize Pool page (top banner)' },
      { name: 'Rules hero',        filename: 'rules-hero',      usedOn: 'Rules page (top banner)' },
    ];
    HEROES.forEach(h => items.push({
      kind: 'illus',
      name: h.name,
      filename: h.filename,
      basePath: BASE + h.filename,
      specs: '~1500×1000, transparent, dark-mode compatible. BOBAI mascot themed for the section. Any format.',
      usedOn: h.usedOn,
      required: false,
    }));

    // Decorative accents
    items.push({
      kind: 'illus',
      name: 'Pool-card trophy flourish',
      filename: 'pool-trophy',
      basePath: BASE + 'pool-trophy',
      specs: '~512×512, transparent. BOBAI lifting a small trophy, coins/sparkles. Any format.',
      usedOn: 'Leaderboard + Prize Pool pool-card corner accent',
      required: false,
    });
    items.push({
      kind: 'illus',
      name: 'Bonus crystal-ball accent',
      filename: 'bonus-crystal',
      basePath: BASE + 'bonus-crystal',
      specs: '~512×512, transparent. BOBAI peering into a glowing crystal ball. Any format.',
      usedOn: 'Bonus Questions card (top-right corner)',
      required: false,
    });
    items.push({
      kind: 'illus',
      name: 'Tips ball-kick accent',
      filename: 'tips-ball',
      basePath: BASE + 'tips-ball',
      specs: '~512×512, transparent. BOBAI kicking a small football. Any format.',
      usedOn: 'Tips card (top-right corner)',
      required: false,
    });

    // BOBAI-style coin icons (re-skin of BTC / BNB / BOBAI marks)
    items.push({
      kind: 'illus',
      name: 'BTC coin icon (BOBAI style)',
      filename: 'coin-btc',
      basePath: BASE + 'coin-btc',
      specs: '~512×512, transparent. BOBAI-style Bitcoin icon. Any format.',
      usedOn: 'Crypto predictions page · Leaderboard crypto view',
      required: false,
    });
    items.push({
      kind: 'illus',
      name: 'BNB coin icon (BOBAI style)',
      filename: 'coin-bnb',
      basePath: BASE + 'coin-bnb',
      specs: '~512×512, transparent. BOBAI-style BNB icon. Any format.',
      usedOn: 'Crypto predictions page · Leaderboard crypto view',
      required: false,
    });
    items.push({
      kind: 'illus',
      name: 'BOBAI coin icon (mark)',
      filename: 'coin-bobai',
      basePath: BASE + 'coin-bobai',
      specs: '~512×512, transparent. The brain icon, mark-style. Any format.',
      usedOn: 'Crypto predictions page · Leaderboard crypto view',
      required: false,
    });
    return items;
  }

  // Click-to-zoom on any delivered avatar (wrapper has .wc-has-art once the img
  // actually loaded). Also catches plain .item.done .preview img on for-designer.
  // Lightbox markup is injected lazily on first open.
  function ensureLightbox(){
    if (document.getElementById('wc-lightbox')) return;
    const lb = document.createElement('div');
    lb.id = 'wc-lightbox';
    lb.setAttribute('aria-hidden', 'true');
    lb.innerHTML = '<button class="lb-close" aria-label="Close">&times;</button><div class="lb-cap"></div><img alt="">';
    document.body.appendChild(lb);
    lb.addEventListener('click', e => {
      if (e.target === lb || e.target.classList.contains('lb-close')) closeLightbox();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && lb.classList.contains('open')) closeLightbox();
    });
  }
  function openLightbox(src, caption){
    ensureLightbox();
    const lb = document.getElementById('wc-lightbox');
    lb.querySelector('img').src = src;
    lb.querySelector('.lb-cap').textContent = caption || '';
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
  }
  function closeLightbox(){
    const lb = document.getElementById('wc-lightbox');
    if (!lb) return;
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
    lb.querySelector('img').src = '';
  }
  document.addEventListener('click', e => {
    const img = e.target.closest('.wc-ava.wc-has-art .wc-ava-img, .item.done .preview img, .illus-card img');
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    let caption = img.alt || '';
    // Try to enrich caption with the username if inside a leaderboard row
    const row = img.closest('a.row, .item');
    if (row) {
      const uname = row.querySelector('.uname-text, .uname, .name, .info .name');
      if (uname && uname.textContent.trim()) caption = uname.textContent.trim();
    }
    openLightbox(img.src, caption);
  });

  // Auto-wire any declarative markup so each page only needs one line.
  //   <div data-hero="dashboard-hero"></div>   → renders dashboard-hero banner
  //   <div data-pool-trophy></div>             → renders the pool-card trophy accent
  function autoWire(){
    document.querySelectorAll('[data-hero]').forEach(el => {
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.outerHTML = heroHtml(el.dataset.hero);
    });
    document.querySelectorAll('[data-pool-trophy]').forEach(el => {
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.outerHTML = poolTrophyHtml();
    });
    document.querySelectorAll('[data-card-accent]').forEach(el => {
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.outerHTML = cardAccentHtml(el.dataset.cardAccent);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoWire);
  } else {
    autoWire();
  }

  window.WC_AVATAR = {
    designOn, formats: FORMATS,
    avatarUrl, avatarHtml,
    illusUrl, illusHtml,
    heroHtml, heroError, poolTrophyHtml, cardAccentHtml,
    exists, findFormat, inventory,
    imgError,
    openLightbox, closeLightbox,
  };
})();
