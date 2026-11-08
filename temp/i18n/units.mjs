// Arabic A-Z: BOBAI's lines that are put together at run time from counts with their unit ("2 hours", "1 trade",
// "3 burn runs") and from clauses ("welcome back" + what happened, the mood line). core.js splits a missing line at
// ":" ";" "," and sentences; this writes every clause and every unit variant those lines are made of.
import fs from 'node:fs';
const out = {};
const span = { minutes: 'دقيقة', hours: 'ساعة', days: 'يوم' }; // after a figure the singular reads as a count in UI copy
// welcome back (terminal.js welcomeBack, vary v22 / v23), each with the three units sinceWords() can give
for (const [u, a] of Object.entries(span)) {
  Object.assign(out, {
    [`Since you were here {0} ${u} ago`]: `منذ كنت هنا قبل {0} ${a}`,
    [`There you are again! In the {0} ${u} you were gone`]: `ها أنت ذا مجددًا! خلال {0} ${a} من غيابك`,
    [`In the {0} ${u} you were gone`]: `خلال {0} ${a} من غيابك`,
    [`{0} ${u} away, and the chain kept me busy`]: `{0} ${a} من الغياب، والسلسلة أبقتني مشغولًا`,
    [`Your {0} ${u} away, in short`]: `غيابك {0} ${a}، باختصار`,
    [`Back for more? Since your last visit {0} ${u} ago`]: `عدت للمزيد؟ منذ زيارتك الأخيرة قبل {0} ${a}`,
    [`Since your last visit {0} ${u} ago`]: `منذ زيارتك الأخيرة قبل {0} ${a}`,
    [`A quiet {0} ${u} since you were here.`]: `{0} ${a} هادئة منذ كنت هنا.`,
    [`{0} ${u} of calm since your last visit.`]: `{0} ${a} من الهدوء منذ زيارتك الأخيرة.`,
    [`A calm {0} ${u} on the chain; the next buyback is {1} charged.`]: `{0} ${a} هادئة على السلسلة؛ وإعادة الشراء التالية مشحونة بنسبة {1}.`,
    [`Not much happened in {0} ${u}.`]: `لم يحدث الكثير خلال {0} ${a}.`,
    [`A slow {0} ${u} since you left, and the next buyback is {1} charged.`]: `{0} ${a} بطيئة منذ غادرت، وإعادة الشراء التالية مشحونة بنسبة {1}.`,
    [`{0} and {1} in the last {2} ${u} alone`]: `{0} و{1} في آخر {2} ${a} وحدها`,
    [`no trade for {0} ${u}`]: `لا صفقات منذ {0} ${a}`,
    [`{0} in {1} ${u}`]: `{0} خلال {1} ${a}`,
    [`{0} and {1} in the last {2} ${u}`]: `{0} و{1} في آخر {2} ${a}`,
    [`{0} ${u}`]: `{0} ${a}`,
  });
}
Object.assign(out, {
  'Welcome back, builder!': 'أهلًا بعودتك يا بنّاء!', 'There you are again!': 'ها أنت ذا مجددًا!', 'Good to see you back.': 'سعيد برؤيتك مجددًا.', 'Welcome back!': 'أهلًا بعودتك!', 'Back for more?': 'عدت للمزيد؟',
  'The next buyback is {0} charged.': 'إعادة الشراء التالية مشحونة بنسبة {0}.', 'The tax kept charging: the next buyback is at {0}.': 'استمرت الضريبة في الشحن: إعادة الشراء التالية عند {0}.',
  'the next buyback is {0} charged': 'إعادة الشراء التالية مشحونة بنسبة {0}', 'price {0}': 'السعر {0}',
  // the counts in "what happened" (awayBits) and in the mood line
  '{0} buys and {1} sells': '{0} عمليات شراء و{1} عمليات بيع', '{0} buy and {1} sells': '{0} شراء و{1} عمليات بيع', '{0} buys and {1} sell': '{0} عمليات شراء و{1} بيع', '{0} buy and {1} sell': '{0} شراء و{1} بيع',
  '{0} buys and {1} sells in the last hour': '{0} عمليات شراء و{1} عمليات بيع في الساعة الأخيرة', '{0} buy and {1} sells in the last hour': '{0} شراء و{1} عمليات بيع في الساعة الأخيرة',
  '{0} buys and {1} sell in the last hour': '{0} عمليات شراء و{1} بيع في الساعة الأخيرة', '{0} buy and {1} sell in the last hour': '{0} شراء و{1} بيع في الساعة الأخيرة',
  '{0} burn runs': '{0} دورات حرق', '{0} burn run': '{0} دورة حرق', '{0} burned': '{0} محروقة', '{0} into liquidity': '{0} إلى السيولة', 'LP burned': 'وحُرقت LP',
  'the dev wallet added {0} + {1} to the pool': 'أضافت محفظة المطوّر {0} + {1} إلى المجمع', '{0} NFT drops': '{0} إصدارات NFT', '{0} NFT drop': '{0} إصدار NFT', 'more than {0} NFT drops': 'أكثر من {0} إصدارات NFT',
  '{0} trades': '{0} صفقة', '{0} trade': '{0} صفقة', "BOBAI's mood": 'مزاج BOBAI', '{0} in the last hour': '{0} في الساعة الأخيرة',
  // the mood chip (MOOD_NAME) and the quiet one
  hyped: 'متحمس', bullish: 'متفائل', chill: 'هادئ', focused: 'مركّز', unshaken: 'ثابت', bored: 'ملول',
});
fs.writeFileSync('D:/ai/fourmeme/temp/i18n/ar-units.json', JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, 'entries');
