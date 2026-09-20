// EAT-26 - Eating Attitudes Test (26 items)
// Sources:
//  - Garner DM, Olmsted MP, Bohr Y, Garfinkel PE (1982). The Eating Attitudes Test:
//    psychometric features and clinical correlates. Psychol Med. 12(4):871-8.
//  - Garner DM (2007). EAT-26: Self-Test. Eating Disorder Information Resource.
//  - Berger U, Wick K, Brix C et al. (2011). Screening of disordered eating: German EAT-26.
//
// 26 items, 6-point scale. Scoring:
//   "Always" = 3, "Usually" = 2, "Often" = 1, "Sometimes/Rarely/Never" = 0.
//   Item 25 is REVERSE: "Always/Usually/Often" = 0, "Sometimes" = 1, "Rarely" = 2, "Never" = 3.
// Total cutoff: >= 20 = clinically relevant, further assessment indicated.
// Subscale cutoffs (Garner 2007): Diet >= 10, Bulimia >= 4, Oral Control >= 4.

window.TEST_DATA = (function () {
  const SCALE = {
    cols: 6,
    options: [
      { v: 5, label: "Always" },
      { v: 4, label: "Usually" },
      { v: 3, label: "Often" },
      { v: 2, label: "Sometimes" },
      { v: 1, label: "Rarely" },
      { v: 0, label: "Never" },
    ],
  };

  // Standard scoring: v 5→3, 4→2, 3→1, 2/1/0→0
  function score(v)        { return v === 5 ? 3 : v === 4 ? 2 : v === 3 ? 1 : 0; }
  // Reverse scoring for item 25: 5/4/3→0, 2→1, 1→2, 0→3
  function scoreReverseExact(v) { return v === 2 ? 1 : v === 1 ? 2 : v === 0 ? 3 : 0; }

  const ITEMS = [
    { id: "E1",  sub: "diet",     text: "Am terrified about being overweight." },
    { id: "E2",  sub: "oral",     text: "Avoid eating when I am hungry." },
    { id: "E3",  sub: "bulimia",  text: "Find myself preoccupied with food." },
    { id: "E4",  sub: "bulimia",  text: "Have gone on eating binges where I feel that I may not be able to stop." },
    { id: "E5",  sub: "oral",     text: "Cut my food into small pieces." },
    { id: "E6",  sub: "diet",     text: "Aware of the calorie content of foods that I eat." },
    { id: "E7",  sub: "diet",     text: "Particularly avoid food with a high carbohydrate content (i.&nbsp;e. bread, rice, potatoes, etc.)." },
    { id: "E8",  sub: "oral",     text: "Feel that others would prefer if I ate more." },
    { id: "E9",  sub: "bulimia",  text: "Vomit after I have eaten." },
    { id: "E10", sub: "diet",     text: "Feel extremely guilty after eating." },
    { id: "E11", sub: "diet",     text: "Am preoccupied with a desire to be thinner." },
    { id: "E12", sub: "diet",     text: "Think about burning up calories when I exercise." },
    { id: "E13", sub: "oral",     text: "Other people think that I am too thin." },
    { id: "E14", sub: "diet",     text: "Am preoccupied with the thought of having fat on my body." },
    { id: "E15", sub: "oral",     text: "Take longer than others to eat my meals." },
    { id: "E16", sub: "diet",     text: "Avoid foods with sugar in them." },
    { id: "E17", sub: "diet",     text: "Eat diet foods." },
    { id: "E18", sub: "bulimia",  text: "Feel that food controls my life." },
    { id: "E19", sub: "oral",     text: "Display self-control around food." },
    { id: "E20", sub: "oral",     text: "Feel that others pressure me to eat." },
    { id: "E21", sub: "bulimia",  text: "Give too much time and thought to food." },
    { id: "E22", sub: "diet",     text: "Feel uncomfortable after eating sweets." },
    { id: "E23", sub: "diet",     text: "Engage in dieting behavior." },
    { id: "E24", sub: "diet",     text: "Like my stomach to be empty." },
    // The subscale follows the ITEM, not its position (2026-09-20). In the
    // published order (Garner et al. 1982) "Have the impulse to vomit after
    // meals" is no. 25 and belongs to Bulimia & Food Preoccupation, "Enjoy trying
    // new rich foods" is no. 26, reverse-scored, and belongs to Dieting. This
    // file lists the two the other way round and had kept the subscale by
    // number — so "Never" on rich foods scored 3 bulimia points, and one more
    // point reached the bulimia flag for someone who never vomits.
    { id: "E25", sub: "diet",     text: "Enjoy trying new rich foods.", reverse: true },
    { id: "E26", sub: "bulimia",  text: "Have the impulse to vomit after meals." },
  ];

  const SUB_LABELS = {
    diet:    "Dieting",
    bulimia: "Bulimia & Food Preoccupation",
    oral:    "Oral Control",
  };
  const SUB_CUTOFFS = { diet: 10, bulimia: 4, oral: 4 };
  const SUB_MAX     = { diet: 39, bulimia: 18, oral: 21 };

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 0);

    let total = 0;
    const subs = { diet: 0, bulimia: 0, oral: 0 };
    for (const it of ITEMS) {
      const raw = get(it.id);
      const s = it.reverse ? scoreReverseExact(raw) : score(raw);
      total += s;
      subs[it.sub] += s;
    }

    const cutoffReached = total >= 20;
    const subFlags = {};
    for (const k of Object.keys(subs)) subFlags[k] = subs[k] >= SUB_CUTOFFS[k];

    let flag;
    if (total >= 30 || subs.bulimia >= 4) flag = "high";
    else if (cutoffReached) flag = "moderate";
    else if (Object.values(subFlags).some(Boolean)) flag = "moderate";
    else flag = "low";

    return { total, max: 78, subs, subFlags, cutoffReached, flag };
  }

  function renderResult(result) {
    const titleMap = {
      low: "Unremarkable eating behaviour screening",
      moderate: "Indications of disordered eating",
      high: "Consistent with clinically relevant eating disorder symptoms",
    };
    const subMap = {
      low: "The scores are below the clinical cutoff (≥&nbsp;20).",
      moderate: "An assessment by a physician or a service specialising in eating disorders is recommended.",
      high: "A prompt specialist medical assessment is strongly recommended.",
    };

    const interp = `
      Your <strong>EAT-26 total score</strong> is <strong>${result.total} of 78 points</strong>.
      ${result.cutoffReached
        ? `The established cutoff of ≥&nbsp;20 (Garner et al. 1982, confirmed in Berger et al. 2011 for the German version) has been reached — this corresponds to a clinically relevant risk of disordered eating and should lead to a specialist medical assessment.`
        : `The established cutoff of ≥&nbsp;20 has not been reached.`}
      ${result.subFlags.bulimia
        ? ` The <strong>Bulimia subscale</strong> is elevated — this calls for particular attention to binge eating, vomiting, and excessive preoccupation with food.`
        : ""}
      ${result.subFlags.diet
        ? ` The <strong>Dieting subscale</strong> is elevated — restrictive eating behaviour and a drive for thinness are clearly pronounced.`
        : ""}
    `;

    const subscaleEntries = [
      { label: "EAT-26 total score", raw: result.total, max: 78, threshold: 20,
        note: `Cutoff for further assessment: ≥&nbsp;20. ${result.cutoffReached ? "<strong>Cutoff reached.</strong>" : "Cutoff not reached."}` },
      ...Object.keys(SUB_LABELS).map((k) => ({
        label: `Subscale · ${SUB_LABELS[k]}`,
        raw: result.subs[k], max: SUB_MAX[k], threshold: SUB_CUTOFFS[k],
        note: `Cutoff: ≥&nbsp;${SUB_CUTOFFS[k]}. ${result.subFlags[k] ? "<strong>Elevated.</strong>" : "Within the normal range."}`,
      })),
    ];

    const context = `
      The <strong>Eating Attitudes Test (EAT-26)</strong> is the most widely used self-report
      screening instrument for eating disorders worldwide. It dimensionally assesses drive for
      thinness, binge eating, and oral control — but not a specific diagnosis (anorexia, bulimia,
      binge eating disorder). A confirmed diagnosis requires a clinical interview
      (e.&nbsp;g. EDE or SIAB-EX) as well as body weight/BMI, gynaecological, and somatic findings.
      Reference period: <strong>the past 6 months</strong>.
    `;

    const next = [];
    if (result.flag === "high") {
      next.push("Arrange an appointment promptly with a service specialising in eating disorders.");
      next.push("In the case of acute medical risk (e.&nbsp;g. low BMI &lt; 17.5, electrolyte imbalance, cardiac arrhythmia), a somatic assessment is urgently needed.");
      next.push("Evidence-based, effective depending on the diagnosis: CBT-E (Fairburn), MANTRA, family-based treatment (FBT for adolescents), and for BED also SSRIs/lisdexamfetamine (German S3 guideline 2018 / NICE NG69 2024).");
    } else if (result.flag === "moderate") {
      next.push("An assessment by a physician or a service specialising in eating disorders is recommended, especially if your weight or eating behaviour is distressing you or your weight has changed significantly.");
      next.push("Watch for warning signs: binge eating with loss of control, vomiting, excessive exercise, restrictive eating patterns, pronounced preoccupation with body and weight.");
    } else {
      next.push("The scores are in the largely unremarkable range. Stay attentive should your eating behaviour change.");
    }
    next.push("Print this report as a PDF and bring it to your next appointment.");

    return {
      title: titleMap[result.flag],
      sub: subMap[result.flag],
      value: result.total,
      unit: `/ 78 points`,
      gauge: Math.min(1, result.total / 40),
      flag: result.flag,
      interpretationHTML: interp,
      subscales: subscaleEntries,
      contextHTML: context,
      nextSteps: next,
    };
  }

  return {
    id: "eat26",
    meta: {
      title: "EAT-26 · Eating Disorder Screening",
      pageTitle: "EAT-26 — Eating Disorder Screening · brainScreener",
      eyebrow: "Eating disorders",
      intro: `The <strong>Eating Attitudes Test (EAT-26)</strong> is the most widely used self-report screener for eating disorder symptoms worldwide. 26 items, three subscales (Dieting, Bulimia, Oral Control). It is no substitute for a diagnosis, but it is well established as an early warning tool.`,
      durationText: "approx. 5–7 minutes",
      itemsText: "26 items · 3 subscales",
      sources: "Garner, Olmsted, Bohr & Garfinkel 1982 · Garner 2007 · Berger et al. (German version) 2011",
      testPath: "/brainscreener/eat26",
      retestPath: "/brainscreener/eat26",
      resultPath: "/brainscreener/eat26-result",
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
        title: "EAT-26 · Past 6 months",
        intro: "<strong>How often do the following statements apply to you?</strong>",
        items: ITEMS,
        scale: SCALE,
      },
    ],
    evaluate,
    renderResult,
  };
})();
