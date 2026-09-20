// AUDIT - Alcohol Use Disorders Identification Test
// Sources:
//  - Saunders JB, Aasland OG, Babor TF, de la Fuente JR, Grant M (1993). Development
//    of the Alcohol Use Disorders Identification Test (AUDIT). Addiction 88(6): 791-804.
//  - Babor TF, Higgins-Biddle JC, Saunders JB, Monteiro MG (2001). AUDIT: Guidelines for
//    Use in Primary Care. WHO, 2nd edition.
//  - WHO/Addiction Switzerland (Sucht Schweiz): standard alcohol screener for primary care.
//
// 10 items with different scales:
//   Item 1: 5-point frequency scale
//   Item 2: 5-point scale for quantity per drinking occasion
//   Items 3-8: 5-point scale "Never..Daily"
//   Items 9-10: 3-point scale "No / Yes, but not in the last year / Yes, during the last year" (0/2/4)
//
// Cutoffs (WHO 2001):
//   0-7   low risk
//   8-15  hazardous drinking (counselling recommended)
//   16-19 harmful drinking (brief intervention)
//   >=20  probable dependence (urgent diagnostic assessment)
// Women-specific cutoff: 5 (Bradley et al. 2007).

window.TEST_DATA = (function () {
  const SCALE_FREQ = { cols: 5, options: [
    { v: 0, label: "Never" },
    { v: 1, label: "Monthly or less" },
    { v: 2, label: "2 to 4 times a month" },
    { v: 3, label: "2 to 3 times a week" },
    { v: 4, label: "4 or more times a week" },
  ] };

  const SCALE_AMOUNT = { cols: 5, options: [
    { v: 0, label: "1 or 2" },
    { v: 1, label: "3 or 4" },
    { v: 2, label: "5 or 6" },
    { v: 3, label: "7 to 9" },
    { v: 4, label: "10 or more" },
  ] };

  const SCALE_PROBLEM = { cols: 5, options: [
    { v: 0, label: "Never" },
    { v: 1, label: "Less than monthly" },
    { v: 2, label: "Monthly" },
    { v: 3, label: "Weekly" },
    { v: 4, label: "Daily or almost daily" },
  ] };

  const SCALE_YESNO = { cols: 3, options: [
    { v: 0, label: "No" },
    { v: 2, label: "Yes, but not in the last year" },
    { v: 4, label: "Yes, during the last year" },
  ] };

  const ITEMS = [
    { id: "A1",  scale: SCALE_FREQ,    text: "How often do you have a drink containing alcohol? <span class='muted small'>(one standard drink = approx. 10–12 g of pure alcohol: 3 dl beer, 1 dl wine, 2 cl spirits)</span>" },
    { id: "A2",  scale: SCALE_AMOUNT,  text: "How many drinks containing alcohol do you have on a typical day when you are drinking?" },
    { id: "A3",  scale: SCALE_PROBLEM, text: "How often do you have six or more drinks on one occasion?" },
    { id: "A4",  scale: SCALE_PROBLEM, text: "How often during the last year have you found that you were not able to stop drinking once you had started?" },
    { id: "A5",  scale: SCALE_PROBLEM, text: "How often during the last year have you failed to do what was normally expected from you because of drinking?" },
    { id: "A6",  scale: SCALE_PROBLEM, text: "How often during the last year have you needed a first drink in the morning to get yourself going after a heavy drinking session?" },
    { id: "A7",  scale: SCALE_PROBLEM, text: "How often during the last year have you had a feeling of guilt or remorse after drinking?" },
    { id: "A8",  scale: SCALE_PROBLEM, text: "How often during the last year have you been unable to remember what happened the night before because you had been drinking?" },
    { id: "A9",  scale: SCALE_YESNO,   text: "Have you or someone else been injured as a result of your drinking?" },
    { id: "A10", scale: SCALE_YESNO,   text: "Has a relative or friend or a doctor or another health worker been concerned about your drinking or suggested you cut down?" },
  ];

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 0);
    const total = ITEMS.reduce((s, it) => s + get(it.id), 0);
    const consumption = get("A1") + get("A2") + get("A3");
    const dependence  = get("A4") + get("A5") + get("A6");
    const harm        = get("A7") + get("A8") + get("A9") + get("A10");

    let flag, level;
    if (total <= 7)        { level = "low risk";       flag = "low"; }
    else if (total <= 15)  { level = "hazardous drinking";       flag = "moderate"; }
    else if (total <= 19)  { level = "harmful drinking";     flag = "high"; }
    else                   { level = "probable dependence"; flag = "high"; }

    return { total, max: 40, level, flag, consumption, dependence, harm };
  }

  function renderResult(result) {
    const interp = (() => {
      if (result.total <= 7) return `Your <strong>AUDIT score</strong> is <strong>${result.total}/40</strong> — this corresponds to the WHO category <strong>"low risk"</strong>. No specific need for action; abstinent or moderate consumption.`;
      if (result.total <= 15) return `Your <strong>AUDIT score</strong> is <strong>${result.total}/40</strong> — this corresponds to the WHO category <strong>"hazardous drinking"</strong>. In this range there is an increased risk of health-related and social consequences; a brief medical intervention (brief intervention) has well-documented effectiveness (Kaner et al. Cochrane Review 2018; WHO 2024).`;
      if (result.total <= 19) return `Your <strong>AUDIT score</strong> is <strong>${result.total}/40</strong> — this corresponds to the WHO category <strong>"harmful drinking"</strong>. A brief intervention plus closer follow-up monitoring is recommended.`;
      return `Your <strong>AUDIT score</strong> is <strong>${result.total}/40</strong> — this corresponds to the WHO category <strong>"probable dependence"</strong>. A diagnostic assessment and, where indicated, specialised addiction treatment is urgently recommended.`;
    })();

    const subscales = [
      { label: "AUDIT total score", raw: result.total, max: 40, threshold: 8,
        note: `Cutoff for hazardous drinking: ≥&nbsp;8. For women, often ≥&nbsp;5 (Bradley et al. 2007). Current category: <strong>${result.level}</strong>.` },
      { label: "Items 1–3 · Quantity & frequency of consumption (AUDIT-C)", raw: result.consumption, max: 12, threshold: 4,
        note: `AUDIT-C cutoff: ≥&nbsp;4 (men) / ≥&nbsp;3 (women). Also established as a stand-alone brief screener.` },
      { label: "Items 4–6 · Dependence symptoms", raw: result.dependence, max: 12, threshold: 4,
        note: `Elevated scores suggest loss of control, neglect of obligations and morning drinking — core symptoms of dependence.` },
      { label: "Items 7–10 · Alcohol-related problems", raw: result.harm, max: 16, threshold: 4,
        note: `Feelings of guilt, blackouts, injuries, feedback from others — indications of harm that has already occurred.` },
    ];

    const context = `
      The <strong>Alcohol Use Disorders Identification Test (AUDIT)</strong> was developed by the
      WHO in 1989 and is the most widely used screening instrument internationally for
      problematic alcohol consumption. It captures not only dependence but also
      <strong>hazardous</strong> and <strong>harmful</strong> drinking below the diagnostic threshold. The
      short form <strong>AUDIT-C</strong> (items 1–3) is increasingly recommended as a first-line screener in
      the primary care setting (USPSTF 2018, update 2024). A confirmed diagnosis requires a
      clinical interview and physical findings (CDT, gamma-GT, MCV, clinical impression).
    `;

    const next = [];
    if (result.total >= 20) {
      next.push("Contact a GP practice experienced in addiction medicine, a psychiatric service or a specialised addiction counselling service promptly.");
      next.push("If you are physically dependent, do not stop abruptly on your own — withdrawal complications (seizures, delirium) can be life-threatening. Inpatient or medically supervised outpatient detoxification is recommended.");
      next.push("Evidence-based treatment: motivational interviewing + CBT + medication where indicated (naltrexone, acamprosate, nalmefene); German S3 guideline 2021, NICE CG115 update 2024.");
    } else if (result.total >= 16) {
      next.push("A medical brief intervention (10–30 minutes of structured conversation) is evidence-based and effective at this level — make an appointment with your GP.");
      next.push("Keep a drinking diary for 2 weeks — this is very useful for the initial consultation.");
    } else if (result.total >= 8) {
      next.push("Actively reduce your drinking days and quantities. WHO guidance on low-risk consumption (revised in 2024 in line with the Canadian guidelines): every reduction is a gain; there is no completely \"safe\" level of consumption.");
      next.push("If you are unsure or unable to cut down on your own, low-threshold counselling is worthwhile (GP, addiction counselling service).");
    } else {
      next.push("Your consumption profile is in the low-risk range. Stay mindful, especially during stressful periods of life.");
    }
    next.push("Print this report as a PDF and bring it to your next appointment.");

    return {
      title: result.total <= 7 ? "Unremarkable AUDIT screening" : (result.total <= 15 ? "Hazardous alcohol consumption" : (result.total <= 19 ? "Harmful alcohol consumption" : "Probable alcohol dependence")),
      sub: result.total <= 7 ? "Consumption in the low-risk range according to the WHO categorisation." : "A further assessment or specific counselling is recommended.",
      value: result.total,
      unit: `/ 40 points · ${result.level}`,
      gauge: Math.min(1, result.total / 25),
      flag: result.flag,
      interpretationHTML: interp,
      subscales,
      contextHTML: context,
      nextSteps: next,
    };
  }

  return {
    id: "audit",
    meta: {
      title: "AUDIT · Alcohol Screening (WHO)",
      pageTitle: "AUDIT — Alcohol Screening · brainScreener",
      eyebrow: "Alcohol consumption",
      intro: `The WHO's <strong>Alcohol Use Disorders Identification Test (AUDIT)</strong> captures not only dependence but all levels of problematic alcohol consumption — from hazardous drinking to dependence. 10 items, reference period: <strong>the last year</strong>.`,
      durationText: "approx. 3–4 minutes",
      itemsText: "10 items · 3 subscales",
      sources: "Saunders et al. 1993 · WHO/Babor et al. 2001 · USPSTF 2024",
      testPath: "/brainscreener/audit",
      retestPath: "/brainscreener/audit",
      resultPath: "/brainscreener/audit-result",
    },
    ui: {
      question: "Question",
      answersCount: "{answered} / {total} answered",
      sectionLabel: "Section {i} of {n} · {title}",
      resetConfirm: "Really delete all previous answers and restart?",
      locale: "en-GB",
      evalLabel: "Results",
      noResultTitle: "No result found",
      noResultText: "Please take the test first to receive a report.",
      toTest: "Go to the test",
      gaugeLow: "low",
      gaugeHigh: "high",
    },
    sections: [
      {
        id: "main",
        title: "AUDIT · Last year",
        intro: "Answer the following questions honestly — with reference to the last 12 months.",
        items: ITEMS,
        scale: SCALE_FREQ, // overridden per item
      },
    ],
    evaluate,
    renderResult,
  };
})();
