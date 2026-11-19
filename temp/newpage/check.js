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
    // the shared link lands on BOBAI, who runs the check again for whoever opens it; its preview is the token's card (_worker.js)
    const link = 'https://brainonbnb.com/' + (AR ? 'ar/' : '') + '?check=' + encodeURIComponent(String(addr).toLowerCase());
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

  // ---- THE WALLET CHECK (2026-11-19, operator: "build the wallet check"): a wallet pasted into the same field. Which
  // tokens it holds, read on-chain only, in the visitor's browser: (1) every ERC-20 it RECEIVED in the last days, from
  // Transfer logs (the one public log node that answers without a contract address caps a call at 10,001 blocks, so
  // the days are read in windows), plus a list of major BSC tokens; (2) every balance in one batch; (3) each token held
  // through the same pre-trade check at the size the wallet holds — can it be sold back. What it cannot see is said on
  // the card: a token received before the window and not on the list. Nothing is stored, no wallet is connected.
  const LOG_RPC = 'https://bsc.api.pocket.network';
  const CALL_RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc.publicnode.com', 'https://bsc-dataseed1.defibit.io'];
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const BLOCKS_PER_DAY = 192000; // 0.45 s blocks
  const MAJORS = ['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', '0x55d398326f99059ff775485246999027b3197955', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', '0x2170ed0880ac9a755fd29b2688956bd959f933f8', '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
    '0x245c386dcfed896f5c346107596141e5edcbffff', '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d',
    '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe', '0xba2ae424d960c26247dd6c32edc70b295c744c43', '0x3ee2200efb3400fabb9aacf31297cbdd1d435d47',
    '0x7083609fce4d1d8dc0c979aab8c869ea2c873402', '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd', '0x4b0f1812e5df2a09796481ff14017e6005508003',
    '0xcf6bb5389c92bdda8a3747ddb454cb7a64626c63', '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e', '0xce24439f2d9c6a2289f741120fe202248b666666',
    '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', '0x4338665cbb7b2485a8855a139b75d5e34ab0db94', '0xbf5140a22578168fd562dccf235e5d43a02ce9b1',
    '0x570a5d26f7765ecb712c0924e4de545b89fd43df', '0xfb5b838b6cfeedc2873ab27866079ac55363d37e', '0xc748673057861a797275cd8a068abb95a902e8de',
    '0x2859e4544c4bb03966803b044a93563bd2d0dd4d', '0x40af3827f39d0eacbf4a168f8d4ee67c121d11c9'];
  const pad = (a) => '000000000000000000000000' + a.slice(2).toLowerCase();
  async function rpc(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return r.json();
  }
  async function callBatch(calls) { // [{to, data}] -> [hex|null]
    const outs = new Array(calls.length).fill(null);
    for (let i = 0; i < calls.length; i += 40) {
      const part = calls.slice(i, i + 40), body = part.map((c, k) => ({ jsonrpc: '2.0', id: i + k, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }));
      for (const url of CALL_RPCS) {
        try { const res = await rpc(url, body); if (!Array.isArray(res)) continue; for (const x of res) if (x && x.result && x.result !== '0x') outs[x.id] = x.result; break; } catch (e) { /* the next node */ }
      }
    }
    return outs;
  }
  const strOf = (h) => {
    if (!h || h.length < 66) return null;
    try {
      if (h.length >= 130) { const len = parseInt(h.slice(66, 130), 16); const hex = h.slice(130, 130 + len * 2); return decodeURIComponent(hex.replace(/(..)/g, '%$1')).replace(/[^\x20-\x7e -￿]/g, '').slice(0, 16) || null; }
      return decodeURIComponent(h.slice(2, 66).replace(/(00)+$/, '').replace(/(..)/g, '%$1')).slice(0, 16) || null;
    } catch (e) { return null; }
  };
  // two public log hosts answer a Transfer query without a contract address: 48.club up to 5,000 blocks, Pocket up to
  // 10,001 — both refuse bursts (measured 19.11.: six at once on Pocket, every one "too many requests"). So 5,000-block
  // windows from one queue, two at a time per host, a growing pause after a refusal; a day is 39 windows, 6-15 s.
  const LOG_HOSTS = ['https://rpc-bsc.48.club', LOG_RPC];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dw = (d) => (d === 1 ? 'day' : d + ' days'), dwAr = (d) => (d === 1 ? 'آخر يوم' : 'آخر ' + d + ' أيام');
  async function receivedTokens(wallet, days, onProgress) {
    let head = 0;
    for (const u of CALL_RPCS) { try { head = parseInt((await rpc(u, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })).result, 16) - 3; if (head > 0) break; } catch (e) { /* the next node */ } }
    if (!(head > 0)) throw new Error('no head');
    const queue = []; for (let to = head; to > head - days * BLOCKS_PER_DAY; to -= 5000) queue.push([Math.max(0, to - 4999), to]);
    const total = queue.length, found = new Set(); let done = 0, failed = 0;
    const worker = async (host) => {
      while (queue.length) {
        const [from, to] = queue.shift(); let ok = false;
        for (let k = 0; k < 4 && !ok; k++) {
          try {
            const j = await rpc(host, { jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [TRANSFER, null, '0x' + pad(wallet)] }] });
            if (Array.isArray(j.result)) { for (const l of j.result) if (l.topics && l.topics.length === 3) found.add(String(l.address).toLowerCase()); ok = true; }
          } catch (e) { /* refused or not JSON: wait and ask again */ }
          if (!ok) await sleep(600 * (k + 1));
        }
        if (!ok) failed++;
        done++; onProgress && onProgress(done, total);
      }
    };
    await Promise.all([worker(LOG_HOSTS[0]), worker(LOG_HOSTS[0]), worker(LOG_HOSTS[1]), worker(LOG_HOSTS[1])]);
    return { tokens: [...found], windows: total, failed };
  }
  const WLINES = AR ? {
    bad: [(n, b) => `تحمل ${n} توكن. ${b} منها لا يمكنك بيعها.`, (n, b) => `فحصت ${n} توكن في هذه المحفظة: ${b} لا تُباع.`, (n, b) => `${b} من ${n} توكن هنا لن تخرج منها.`, (n, b) => `انتبه: ${b} من توكناتك الـ ${n} غير قابلة للبيع.`, (n, b) => `في المحفظة ${n} توكن، و${b} منها عالقة.`],
    good: [(n) => `تحمل ${n} توكن، وكلها قابلة للبيع عند هذه الكتلة.`, (n) => `فحصت ${n} توكن: لا شيء عالق.`, (n) => `${n} توكن، والخروج يعمل لكل منها.`, (n) => `محفظة نظيفة: ${n} توكن، كلها تُباع.`, (n) => `لا توكن عالق بين الـ ${n} التي وجدتها.`],
    none: [() => 'لم أجد توكنات في هذه المحفظة ضمن ما قرأته.', () => 'المحفظة فارغة فيما قرأته.', () => 'لا توكنات هنا في الأيام المقروءة.', () => 'لم يظهر أي توكن في هذه المحفظة.', () => 'لا شيء لفحصه في هذه المحفظة.'],
  } : {
    bad: [(n, b) => `You hold ${n} tokens. ${b} of them you could not sell back.`, (n, b) => `Checked ${n} tokens in this wallet: ${b} would not sell.`, (n, b) => `${b} of the ${n} tokens here have no way out.`, (n, b) => `Careful: ${b} of your ${n} tokens cannot be sold.`, (n, b) => `${n} tokens in the wallet, ${b} of them stuck.`],
    good: [(n) => `You hold ${n} tokens, and every one sells back at this block.`, (n) => `Checked ${n} tokens: nothing stuck.`, (n) => `${n} tokens, the way out works for each.`, (n) => `A clean wallet: ${n} tokens, all of them sellable.`, (n) => `No stuck token among the ${n} I found.`],
    none: [() => 'I found no tokens in this wallet in what I read.', () => 'This wallet is empty in what I read.', () => 'No tokens here in the days I read.', () => 'Not one token showed up for this wallet.', () => 'Nothing to check in this wallet.'],
  };
  async function walletCheck(wallet, days = 1) {
    busy = true; form.classList.add('busy'); lastKey = wallet.toLowerCase() + '|w' + days;
    out.textContent = '';
    const head = el('div', 'bk-head bk-weigh'); head.append(el('span', 'bk-gate', t('WALLET CHECK', 'فحص المحفظة')), raw('span', 'bk-sym', short(wallet)));
    const status = el('p', 'bk-wait', t('Reading which tokens this wallet received…', 'أقرأ التوكنات التي استلمتها هذه المحفظة…'));
    const list = el('div', 'bk-wrows');
    out.append(head, status, list);
    try {
      const rec = await receivedTokens(wallet, days, (d, n) => { status.textContent = t(`Reading the last ${dw(days)} of transfers… ${Math.round((d / n) * 100)}%`, `أقرأ تحويلات ${dwAr(days)}… ${Math.round((d / n) * 100)}%`); });
      const cand = [...new Set([...rec.tokens, ...MAJORS])];
      status.textContent = t(`Reading ${cand.length} balances…`, `أقرأ ${cand.length} رصيدًا…`);
      const bal = await callBatch(cand.map((a) => ({ to: a, data: '0x70a08231' + pad(wallet) })));
      let held = cand.map((a, i) => ({ a, raw: bal[i] ? BigInt(bal[i].slice(0, 66)) : 0n })).filter((x) => x.raw > 0n);
      const meta = await callBatch(held.flatMap((x) => [{ to: x.a, data: '0x313ce567' }, { to: x.a, data: '0x95d89b41' }]));
      held = held.map((x, i) => ({ ...x, dec: meta[2 * i] ? Number(BigInt(meta[2 * i].slice(0, 66))) : 18, sym: strOf(meta[2 * i + 1]) || short(x.a) }))
        .map((x) => ({ ...x, amt: Number(x.raw) / 10 ** Math.min(36, x.dec) }));
      const MAX = 15, todo = held.slice(0, MAX);
      status.textContent = held.length ? t(`${held.length} token${held.length === 1 ? '' : 's'} held — checking whether each sells back…`, `${held.length} توكن — أفحص هل يُباع كل منها…`) : '';
      const rows = new Map();
      for (const x of todo) { const r = el('div', 'bk-wr'); r.append(raw('span', 'bk-ws', x.sym), raw('span', 'bk-wa', x.amt.toLocaleString('en-US', { maximumFractionDigits: 4 })), el('span', 'bk-wv bk-wait', '…')); list.appendChild(r); rows.set(x.a, r); }
      let bad = 0, untested = 0, checked = 0;
      const checkOne = async (x) => {
        const r = rows.get(x.a), v = r.querySelector('.bk-wv');
        try {
          // first at $100 for the price, then the verdict is read at the size the wallet holds (between $10 and $10,000)
          let j = await fetch(`/api/preflight?address=${x.a}&usd=100`, { cache: 'no-store', signal: AbortSignal.timeout(30000) }).then((q) => q.json());
          const p = j && j.token && j.token.price_usd, worth = p ? x.amt * p : null;
          if (worth != null && Math.abs(worth - 100) > 25 && worth >= 10) j = await fetch(`/api/preflight?address=${x.a}&usd=${Math.round(Math.min(10000, worth))}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) }).then((q) => q.json());
          checked++;
          if (!j || j.error) { v.className = 'bk-wv warn'; v.textContent = t('no reading', 'لا قراءة'); untested++; return; }
          const ex = j.exit || {};
          if (worth != null) r.querySelector('.bk-wa').textContent += ` · ${worth < 0.01 ? '<$0.01' : usd(worth)}`; // a dust rest is not "$0"
          if (ex.sellable === false) { bad++; r.classList.add('bad'); v.className = 'bk-wv bad'; v.textContent = t('cannot sell', 'لا يُباع'); list.prepend(r); }
          else if (ex.sellable) { v.className = 'bk-wv ok'; v.textContent = t(`sells · keeps ${pct(ex.round_trip_keep_pct, 1)}`, `يُباع · يبقى ${pct(ex.round_trip_keep_pct, 1)}`); }
          else { untested++; v.className = 'bk-wv warn'; v.textContent = t('sell not tested', 'البيع لم يُختبر'); }
          const tx = j.tax || {}; if (tx.sell_pct > 0) v.textContent += t(` · sell tax ${pct(tx.sell_pct)}`, ` · ضريبة بيع ${pct(tx.sell_pct)}`);
          const a = el('a', 'bk-wl', '→'); a.href = (AR ? '/ar' : '') + '/scanner?token=' + x.a; a.title = t('Full scan', 'الفحص الكامل'); r.appendChild(a);
        } catch (e) { v.className = 'bk-wv warn'; v.textContent = t('no reading', 'لا قراءة'); untested++; }
      };
      for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map(checkOne));
      status.textContent = held.length ? t(`${held.length} token${held.length === 1 ? '' : 's'} held${held.length > MAX ? ` (the first ${MAX} checked)` : ''} · ${bad} cannot be sold · ${untested} not tested`, `${held.length} توكن${held.length > MAX ? ` (فُحص أول ${MAX})` : ''} · ${bad} لا تُباع · ${untested} لم تُختبر`) : t('No tokens found.', 'لم يُعثر على توكنات.');
      head.className = 'bk-head ' + (bad ? 'bk-stop' : untested ? 'bk-weigh' : 'bk-clear');
      const note = el('p', 'bk-msg', t(`Read on-chain: tokens this wallet received in the last ${dw(days)}${rec.failed ? ` (${rec.failed} of ${rec.windows} windows did not answer)` : ''}, plus ${MAJORS.length} major BNB Chain tokens. A token received earlier and not on that list is not here — paste it above to check it.`, `قُرئ على السلسلة: التوكنات التي استلمتها المحفظة في ${dwAr(days)}${rec.failed ? ` (${rec.failed} من ${rec.windows} نافذة لم تُجب)` : ''}، و${MAJORS.length} توكنًا رئيسيًا على BNB Chain. توكن استُلم قبل ذلك وليس في القائمة لا يظهر هنا — الصقه أعلاه لفحصه.`));
      out.appendChild(note);
      if (days < 7) {
        const more = el('button', 'bk-share', t(days < 3 ? 'Look back 3 days' : 'Look back 7 days', days < 3 ? 'ابحث 3 أيام' : 'ابحث 7 أيام')); more.type = 'button';
        more.addEventListener('click', () => { if (!busy) walletCheck(wallet, days < 3 ? 3 : 7); });
        const foot = el('div', 'bk-foot'); foot.append(more, el('span', 'bk-meta', t('measurement, not advice', 'قياس، لا نصيحة'))); out.appendChild(foot);
      }
      const n = held.length;
      sayLine(n ? (bad ? pick(WLINES.bad)(n, bad) : pick(WLINES.good)(checked)) : pick(WLINES.none)());
    } catch (e) {
      status.className = 'bk-msg'; status.textContent = t('The chain did not answer just now — try again in a moment.', 'لم تُجب السلسلة الآن — أعد المحاولة بعد لحظة.'); lastKey = '';
    } finally { busy = false; form.classList.remove('busy'); }
  }

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
      else if (j.code === 'is_wallet' && /^0x[0-9a-fA-F]{40}$/.test(asked)) { await walletCheck(asked); return; } // a wallet: its tokens instead (run's finally clears busy after it)
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
