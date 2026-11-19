// BOBAI CHECKS A TOKEN, LIVE (2026-11-19, operator after BSCDaily (759k) put us among the new dApps on BNB Chain: "make our
// dApp really good, above all sensible and usable"; his choice of three: "BOBAI checks live"). A visitor pastes any BNB
// Chain token (or its pool, or a DexScreener/BscScan/PancakeSwap link) and a size; the page asks the same pre-trade check
// every agent gets (/api/preflight: measured on-chain at this block, never labelled) and answers in plain words — can I get
// in, can I get out at my size, what the round trip costs, the tax as measured, who can pull the liquidity, who owns the
// contract — while BOBAI says the verdict in his own bubble (window.__btSay, the terminal's speak()). Nothing is signed,
// nothing is stored, no wallet. Every text node is written with textContent: an address, a token's name and a reason
// come from the chain and from other people.
// ARABIC: on /ar/ the card and his lines are written in Arabic here (a token's name is no placeholder of the dictionary,
// so every token would be a new untranslated key); the API's own explanations stay as sent, marked data-noar, left to right.
(() => {
  const panel = document.getElementById('bk-panel'), form = document.getElementById('bk-form'), input = document.getElementById('bk-in');
  const out = document.getElementById('bk-out'), btn = document.querySelector('.bp-chk-btn');
  if (!panel || !form || !input || !out) return;
  const AR = /^\/ar(\/|$)/.test(location.pathname);
  const t = (en, ar) => (AR ? ar : en);
  const SIZES = [50, 100, 500, 1000];
  let size = 100, busy = false, lastKey = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const raw = (tag, cls, text) => { const e = el(tag, cls, text); e.setAttribute('data-noar', ''); e.dir = 'ltr'; return e; }; // the API's own words
  const short = (a) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? a.slice(0, 6) + '…' + a.slice(-4) : a);
  const usd = (n) => '$' + (n >= 1000 ? Math.round(n).toLocaleString('en-US') : (+n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const pct = (n, d = 2) => (+n).toFixed(d).replace(/\.?0+$/, '') + '%';
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // the size chips
  const chips = form.querySelector('.bk-sizes');
  if (chips) for (const s of SIZES) {
    const c = el('button', 'bk-chip' + (s === size ? ' on' : ''), usd(s)); c.type = 'button'; c.dataset.usd = s;
    c.addEventListener('click', () => { size = s; chips.querySelectorAll('.bk-chip').forEach((x) => x.classList.toggle('on', +x.dataset.usd === s)); if (input.value.trim()) run(); });
    chips.appendChild(c);
  }
  // first-time help: two tokens to try
  const tries = form.querySelector('.bk-try');
  if (tries) for (const [label, addr] of [['CAKE', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'], ['$BOBAI', '0x245c386dcfed896f5c346107596141e5edcbffff']]) {
    const b = el('button', 'bk-tryb', label); b.type = 'button';
    b.addEventListener('click', () => { input.value = addr; run(); });
    tries.appendChild(b);
  }

  // what a code means in a few words, for his line and the note's head (the card shows the full reason)
  const SAY = {
    not_sellable: ['you could not sell it back', 'لن تستطيع بيعه'], not_buyable: ['it cannot be bought right now', 'لا يمكن شراؤه الآن'],
    not_quotable: ['no pool would quote it', 'لا يوجد مجمع يسعّره'], sell_not_quotable: ['no pool would quote the sell', 'لا يوجد مجمع يسعّر البيع'],
    no_route_quote: ['no route answered at your size', 'لا مسار أجاب بحجمك'], on_launch_curve: ['it is still on its launch curve', 'ما زال على منحنى الإطلاق'],
    lp_pullable: ['its liquidity can be pulled', 'يمكن سحب سيولته'], lp_withdrawable: ['its liquidity can be withdrawn', 'يمكن سحب سيولته'],
    lp_withdrawn: ['liquidity was pulled lately', 'سُحبت سيولة مؤخرًا'], holders_concentrated: ['a few wallets hold a lot', 'محافظ قليلة تملك الكثير'],
    holders_unknown: ['its holders could not be read', 'تعذّرت قراءة الحاملين'], dev_selling: ['the deployer is selling', 'المطوّر يبيع'],
    top_holder_selling: ['top holders are selling', 'كبار الحاملين يبيعون'], sniped_launch: ['snipers took the launch', 'القنّاصون أخذوا الإطلاق'],
    volume_from_few_wallets: ['its volume comes from few wallets', 'حجمه من محافظ قليلة'], tax_can_change: ['the tax can be changed', 'يمكن تغيير الضريبة'],
    tax_unknown: ['the tax could not be measured', 'تعذّر قياس الضريبة'], round_trip: ['a round trip costs a lot', 'الذهاب والعودة مكلفان'],
    size_moves_price: ['your size moves the price', 'حجمك يحرّك السعر'], deeper_pool_elsewhere: ['a deeper pool exists elsewhere', 'يوجد مجمع أعمق في مكان آخر'],
    partial_market: ['only part of its market was read', 'قُرئ جزء من سوقه فقط'], owner_is_eoa: ['a wallet still owns the contract', 'محفظة ما زالت تملك العقد'],
    source_not_verified: ['its source is not verified', 'مصدره غير موثّق'], contract_flags: ['the contract has risky switches', 'في العقد مفاتيح خطرة'],
    size_beyond_ladder: ['your size is past what was measured', 'حجمك أكبر مما قيس'], sell_not_simulated: ['the sell was not simulated', 'لم تُحاكَ عملية البيع'],
    sell_tested_on_another_pair: ['the sell was tested on another pair', 'اختُبر البيع على زوج آخر'], index_liquidity_virtual: ['its listed liquidity is virtual', 'سيولته المدرجة افتراضية'],
  };
  const said = (x) => { const s = SAY[x.code]; return s ? t(s[0], s[1]) : t(String(x.why || x.code || '').split(/[.;—]/)[0].slice(0, 60).toLowerCase(), 'ملاحظة على هذا التوكن'); };

  // his verdict, five ways each (the terminal's rule: every kind of line has at least five, so a second check does not repeat him)
  const LINES = AR ? {
    stop: [(s, n, w) => `${s} بمبلغ ${n}: توقّف. ${w}.`, (s, n, w) => `لن أدخل: ${s} بمبلغ ${n} — ${w}.`, (s, n, w) => `${s}، مقروءًا عند هذه الكتلة: ${w}. هذا يوقفه عند ${n}.`, (s, n, w) => `احذر من ${s}. عند ${n}، ${w}.`, (s, n, w) => `${s} يرسب في الفحص عند ${n}: ${w}.`],
    weigh: [(s, n, w, k) => `${s} بمبلغ ${n}: تدخل وتخرج، والذهاب والعودة يُبقيان ${k}. أمر واحد للتفكير: ${w}.`, (s, n, w, k) => `فحصت ${s} بمبلغ ${n}. قابل للبيع، يبقى ${k} — لكن ${w}.`, (s, n, w, k) => `${s} يتداول عند ${n}، والذهاب والعودة يُبقيان ${k}. فكّر أولًا: ${w}.`, (s, n, w, k) => `الدخول والخروج يعملان لـ ${s} عند ${n} (يبقى ${k}). ومع ذلك، ${w}.`, (s, n, w, k) => `${s}: لا شيء يوقف ${n}، يبقى ${k}. يستحق النظر: ${w}.`],
    clear: [(s, n, w, k) => `${s} بمبلغ ${n}: الدخول والخروج يعملان، يبقى ${k}. لا مانع معروف.`, (s, n, w, k) => `فحصت ${s} بمبلغ ${n}. قابل للبيع، يبقى ${k}، لا مانع معروف عند هذه الكتلة.`, (s, n, w, k) => `${s} نظيف عند ${n}: يبقى ${k} في الذهاب والعودة.`, (s, n, w, k) => `لا مانع لـ ${s} عند ${n}. الذهاب والعودة يُبقيان ${k}.`, (s, n, w, k) => `${s}، قيس الآن: دخول، خروج، يبقى ${k} عند ${n}.`],
    untested: [(s, n) => `${s} بمبلغ ${n}: الشراء يعمل، لكن البيع لم يُختبر الآن. أعد الفحص بعد دقيقة.`, (s, n) => `سعّرت ${s} بمبلغ ${n}، ولم أختبر البيع. ليست نعم بعد.`, (s, n) => `${s}: طريق الدخول موجود عند ${n}. طريق الخروج لم يُختبر في هذه الكتلة.`, (s, n) => `نصف قراءة لـ ${s} عند ${n}: جانب الشراء فقط. اسألني بعد قليل.`, (s, n) => `${s} عند ${n} — الدخول نعم، الخروج لم يُختبر بعد. أنتظر القراءة الكاملة.`],
    fail: [() => 'تعذّرت قراءة هذا العنوان.', () => 'لم ينجح الفحص لهذا العنوان.', () => 'لا شيء لقياسه هناك.', () => 'لا قراءة لهذا العنوان.', () => 'هذا العنوان لم يعطني قراءة.'],
  } : {
    stop: [
      (s, n, w) => `${s} at ${n}: stop. ${w}.`,
      (s, n, w) => `I would not go in: ${s} at ${n} — ${w}.`,
      (s, n, w) => `${s}, read at this block: ${w}. That stops it at ${n}.`,
      (s, n, w) => `Careful with ${s}. At ${n}, ${w}.`,
      (s, n, w) => `${s} fails the check at ${n}: ${w}.`,
    ],
    weigh: [
      (s, n, w, k) => `${s} at ${n}: you get in and out, a round trip keeps ${k}. One thing to weigh: ${w}.`,
      (s, n, w, k) => `Checked ${s} for ${n}. Sellable, ${k} kept on a round trip — but ${w}.`,
      (s, n, w, k) => `${s} trades at ${n}, round trip keeps ${k}. Weigh this first: ${w}.`,
      (s, n, w, k) => `In and out works for ${s} at ${n} (${k} kept). Still, ${w}.`,
      (s, n, w, k) => `${s}: nothing stops ${n}, a round trip keeps ${k}. Worth a look: ${w}.`,
    ],
    clear: [
      (s, n, w, k) => `${s} at ${n}: in and out both work, a round trip keeps ${k}. Nothing known stops it.`,
      (s, n, w, k) => `Checked ${s} for ${n}. Sellable, ${k} kept on a round trip, no known stop at this block.`,
      (s, n, w, k) => `${s} reads clean at ${n}: ${k} kept on a round trip.`,
      (s, n, w, k) => `No stop found for ${s} at ${n}. A round trip keeps ${k}.`,
      (s, n, w, k) => `${s}, measured just now: in, out, ${k} kept at ${n}.`,
    ],
    // the sell was not tested at this block: he never says "in and out" then
    untested: [
      (s, n) => `${s} at ${n}: buying works, but the sell could not be tested just now. Check again in a minute.`,
      (s, n) => `I could quote ${s} for ${n}, not test the sell back. Not a yes yet.`,
      (s, n) => `${s}: the way in is there at ${n}. The way out was not tested this block.`,
      (s, n) => `Half a reading on ${s} at ${n}: the buy side only. Ask me again shortly.`,
      (s, n) => `${s} at ${n} — in, yes; out, not tested yet. I would wait for the full reading.`,
    ],
    fail: [
      (m) => `I could not read that one: ${m}`, (m) => `That did not check out: ${m}`, (m) => `Nothing to measure there: ${m}`,
      (m) => `No reading for that address: ${m}`, (m) => `That one gave me no reading: ${m}`,
    ],
  };
  const sayLine = (s) => { try { if (window.__btSay) window.__btSay(s); } catch (e) {} };
  const GATE = { stop: t('STOP', 'توقّف'), weigh: t('WEIGH IT', 'فكّر فيه'), clear: t('NO KNOWN STOP', 'لا مانع معروف') };

  // the card
  function row(k, v, cls, apiText) {
    const r = el('div', 'bk-r' + (cls ? ' ' + cls : ''));
    r.append(el('span', 'bk-k', k), (apiText ? raw : el)('span', 'bk-v', v));
    return r;
  }
  function render(j, asked) {
    out.textContent = '';
    const sym = (j.token && (j.token.symbol || j.token.name)) || short(asked);
    const gate = j.gate === 'stop' ? 'stop' : j.gate === 'weigh' ? 'weigh' : 'clear';
    const n = usd(j.size_usd || size);
    const head = el('div', 'bk-head bk-' + gate);
    head.append(el('span', 'bk-gate', GATE[gate]), raw('span', 'bk-sym', `${sym} · ${n}`));
    out.appendChild(head);
    const list = el('div', 'bk-rows');
    const ex = j.exit || {}, en = j.entry || {}, tx = j.tax || {}, dp = j.depth || {}, ct = j.control || {};
    const recv = en.receive_tokens_after_tax ? (+en.receive_tokens_after_tax).toLocaleString('en-US', { maximumFractionDigits: 2 }) : null;
    if (en.route) list.appendChild(row(t('Get in', 'الدخول'), `${en.pay || ''} · ${en.venue ? en.venue + ' ' : ''}${en.route}${recv ? ` · ${t('you receive', 'تستلم')} ${recv} ${sym}` : ''}`, '', true));
    // "sellable" only when the sell was tested; an estimate without the test says so (2026-11-19: the card said "not
    // measured" while his line said "in and out works")
    list.appendChild(row(t('Get out', 'الخروج'), ex.sellable === false ? t('Not sellable at this block', 'غير قابل للبيع عند هذه الكتلة')
      : ex.sellable ? t(`Sellable · a round trip keeps ${pct(ex.round_trip_keep_pct)} (costs ${pct(ex.round_trip_cost_pct)}, the pools alone ${pct(ex.of_which_pools_only_pct)})`, `قابل للبيع · الذهاب والعودة يُبقيان ${pct(ex.round_trip_keep_pct)} (التكلفة ${pct(ex.round_trip_cost_pct)}، منها المجمعات ${pct(ex.of_which_pools_only_pct)})`)
      : t('The sell was not tested at this block', 'لم يُختبر البيع عند هذه الكتلة'), ex.sellable === false ? 'bad' : ex.sellable ? '' : 'warn'));
    if (tx.buy_pct != null || tx.sell_pct != null) list.appendChild(row(t('Tax', 'الضريبة'), `${t('buy', 'شراء')} ${tx.buy_pct == null ? t('unknown', 'غير معروفة') : pct(tx.buy_pct)} · ${t('sell', 'بيع')} ${tx.sell_pct == null ? t('unknown', 'غير معروفة') : pct(tx.sell_pct)}${tx.sell_source ? ' — ' + t('measured, not labelled', 'مقيسة، لا مُعلنة') : ''}`));
    // a V3 pool has positions, not a burnable LP token: "0% burned" in warning colour misread CAKE's pool (2026-11-19)
    const v3 = /^V3/i.test(en.route || '');
    if (v3) list.appendChild(row(t('Liquidity', 'السيولة'), `${dp.pool_hard_side_usd ? usd(dp.pool_hard_side_usd) + t(' on the hard side · ', ' في الجانب الصلب · ') : ''}${t('a V3 pool: liquidity sits in positions, there is no LP token to burn', 'مجمع V3: السيولة في مراكز، لا يوجد توكن LP يُحرق')}`));
    else if (j.lp_burned_pct != null) list.appendChild(row(t('Liquidity', 'السيولة'), `${pct(j.lp_burned_pct)} ${t('of the LP burned', 'من LP محروق')}${dp.pool_hard_side_usd ? ` · ${usd(dp.pool_hard_side_usd)} ${t('on the hard side', 'في الجانب الصلب')}` : ''}`, j.lp_burned_pct < 50 ? 'warn' : ''));
    if (dp.one_percent_buy_usd != null) list.appendChild(row(t('Depth', 'العمق'), t(`${usd(dp.one_percent_buy_usd)} moves the price 1% (buy) · ${usd(dp.one_percent_sell_usd)} (sell)`, `${usd(dp.one_percent_buy_usd)} يحرّك السعر 1% (شراء) · ${usd(dp.one_percent_sell_usd)} (بيع)`)));
    if (ct.read) list.appendChild(row(t('Owner', 'المالك'), ct.owner && ct.owner.kind === 'renounced' ? t('Renounced (no owner)', 'متنازل عنه (لا مالك)') : ct.owner ? `${ct.owner.kind === 'contract' ? t('a contract', 'عقد') : ct.owner.kind === 'eoa' || ct.owner.kind === 'wallet' ? t('a wallet', 'محفظة') : t('owner', 'المالك')} ${short(ct.owner.address || '')}` : t('Not read', 'لم يُقرأ'), ct.owner && ct.owner.kind !== 'renounced' ? 'warn' : ''));
    if (j.age_hours && j.age_hours.pool != null) list.appendChild(row(t('Pool age', 'عمر المجمع'), j.age_hours.pool >= 48 ? `${Math.round(j.age_hours.pool / 24)} ${t('days', 'يومًا')}` : `${Math.round(j.age_hours.pool)} ${t('hours', 'ساعة')}`));
    out.appendChild(list);
    const notes = [...(j.stop || []).map((x) => ['stop', x]), ...(j.caution || []).map((x) => ['weigh', x])];
    if (notes.length) {
      const ul = el('ul', 'bk-notes');
      for (const [k, x] of notes.slice(0, 5)) { const li = el('li', 'bk-n-' + k); li.append(el('b', '', (k === 'stop' ? t('Stop: ', 'توقّف: ') : t('Weigh: ', 'فكّر: ')) + said(x) + '. '), raw('span', '', String(x.why || '').slice(0, 260))); ul.appendChild(li); }
      out.appendChild(ul);
    }
    const foot = el('div', 'bk-foot');
    const addr = (j.token && j.token.address) || asked;
    const link = 'https://brainonbnb.com/scanner?token=' + encodeURIComponent(addr);
    const label = t('Share this check', 'شارك هذا الفحص');
    const share = el('button', 'bk-share', label); share.type = 'button';
    share.addEventListener('click', async () => {
      const text = `${sym} on BNB Chain, checked on-chain by BOBAI: ${gate === 'stop' ? 'STOP' : gate === 'weigh' ? 'weigh it' : 'no known stop'} at ${n}`;
      try { if (navigator.share) { await navigator.share({ title: 'BOBAI token check', text, url: link }); return; } } catch (e) { return; }
      try { await navigator.clipboard.writeText(text + ' ' + link); share.textContent = t('Link copied ✓', 'نُسخ الرابط ✓'); setTimeout(() => { share.textContent = label; }, 1800); } catch (e) {}
    });
    const full = el('a', 'bk-full', t('Full scan →', 'الفحص الكامل ←')); full.href = (AR ? '/ar' : '') + '/scanner?token=' + encodeURIComponent(addr);
    foot.append(share, full, el('span', 'bk-meta', `${t('Block', 'الكتلة')} ${j.block || '—'} · ${t('measurement, not advice', 'قياس، لا نصيحة')}`));
    out.appendChild(foot);
    // his line
    const w = notes.length ? said(notes[0][1]) : '', k = ex.round_trip_keep_pct != null ? pct(ex.round_trip_keep_pct, 1) : t('most of it', 'معظمه');
    sayLine(pick(LINES[gate !== 'stop' && ex.sellable !== true ? 'untested' : gate])(sym, n, w, k));
  }
  function fail(msg, asked) {
    out.textContent = '';
    const head = el('div', 'bk-head bk-fail'); head.append(el('span', 'bk-gate', t('NO READING', 'لا قراءة')), raw('span', 'bk-sym', short(asked)));
    out.append(head, raw('p', 'bk-msg', msg));
    sayLine(pick(LINES.fail)(String(msg).split(/(?<=\.)\s/)[0].slice(0, 140)));
  }
  const NOANSWER = () => t('the check did not answer — try again in a few seconds.', 'لم يُجب الفحص — أعد المحاولة بعد ثوانٍ.');

  async function run() {
    const asked = input.value.trim();
    if (!asked || busy) return;
    const key = asked.toLowerCase() + '|' + size;
    open(true);
    if (key === lastKey && out.childElementCount) return;
    busy = true; lastKey = key; form.classList.add('busy');
    out.textContent = ''; out.appendChild(el('p', 'bk-wait', t('BOBAI is reading the chain at this block… (a few seconds)', 'BOBAI يقرأ السلسلة عند هذه الكتلة… (بضع ثوانٍ)')));
    try {
      const r = await fetch(`/api/preflight?address=${encodeURIComponent(asked)}&usd=${size}`, { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!j) { fail(NOANSWER(), asked); lastKey = ''; }
      else if (j.error) fail(j.error, asked);
      else render(j, asked);
    } catch (e) { fail(NOANSWER(), asked); lastKey = ''; }
    finally { busy = false; form.classList.remove('busy'); }
  }
  function open(on) {
    panel.classList.toggle('open', on);
    if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  if (btn) btn.addEventListener('click', () => { const on = !panel.classList.contains('open'); open(on); if (on) setTimeout(() => input.focus(), 30); });
  panel.querySelector('.bk-x')?.addEventListener('click', () => open(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) open(false); });
  // a shared link: brainonbnb.com/?check=0x… opens the check with the token in it
  const q = new URLSearchParams(location.search).get('check');
  if (q && /^0x[0-9a-fA-F]{40}$/.test(q)) { input.value = q; setTimeout(run, 1500); }
})();
