// WHODAS 2.0 - WHO Disability Assessment Schedule 2.0 (36-item self-administered, full version)
// Sources:
//  - WHO (2010). Measuring Health and Disability: Manual for WHO Disability Assessment
//    Schedule (WHODAS 2.0). World Health Organization. (Open Access)
//  - Uestuen TB, Chatterji S et al. (2010). Developing the WHO Disability Assessment
//    Schedule 2.0. Bull WHO 88(11):815-823.
//  - DSM-5-TR (APA 2022) recommends WHODAS 2.0 as the standard measure of functioning.
//  - Pavedis M, Volz HP et al. (2014) - German adaptation of WHODAS 2.0.
//
// 36 items, 6 domains. Reference period: last 30 days. Scale 0..4 (0=none ... 4=extreme).
// Domains:
//   D1 Cognition:                  6 items (D1.1-D1.6)
//   D2 Mobility:                   5 items (D2.1-D2.5)
//   D3 Self-care:                  4 items (D3.1-D3.4)
//   D4 Getting along with people:  5 items (D4.1-D4.5)
//   D5 Life activities household:  4 items (D5.1-D5.4)
//   D5 Life activities work:       4 items (D5.5-D5.8, only if employed / in education)
//   D6 Participation:              8 items (D6.1-D6.8)
// Scoring (Simple Summary Method): sum / max * 100% = disability %.

window.TEST_DATA = (function () {
  const SCALE = { cols: 5, options: [
    { v: 0, label: "None" },
    { v: 1, label: "Mild" },
    { v: 2, label: "Moderate" },
    { v: 3, label: "Severe" },
    { v: 4, label: "Extreme or cannot do" },
  ] };

  // Section 1: Cognition
  const D1 = [
    { id: "W1_1", domain: "cognition", text: "Concentrating on doing something for ten minutes?" },
    { id: "W1_2", domain: "cognition", text: "Remembering to do important things?" },
    { id: "W1_3", domain: "cognition", text: "Analysing and finding solutions to problems in day-to-day life?" },
    { id: "W1_4", domain: "cognition", text: "Learning a new task, for example, learning how to get to a new place?" },
    { id: "W1_5", domain: "cognition", text: "Generally understanding what people say?" },
    { id: "W1_6", domain: "cognition", text: "Starting and maintaining a conversation?" },
  ];

  const D2 = [
    { id: "W2_1", domain: "mobility", text: "Standing for long periods such as 30&nbsp;minutes?" },
    { id: "W2_2", domain: "mobility", text: "Standing up from sitting down?" },
    { id: "W2_3", domain: "mobility", text: "Moving around inside your home?" },
    { id: "W2_4", domain: "mobility", text: "Getting out of your home?" },
    { id: "W2_5", domain: "mobility", text: "Walking a long distance such as a kilometre?" },
  ];

  const D3 = [
    { id: "W3_1", domain: "selfcare", text: "Washing your whole body?" },
    { id: "W3_2", domain: "selfcare", text: "Getting dressed?" },
    { id: "W3_3", domain: "selfcare", text: "Eating?" },
    { id: "W3_4", domain: "selfcare", text: "Staying by yourself for a few days?" },
  ];

  const D4 = [
    { id: "W4_1", domain: "people", text: "Dealing with people you do not know?" },
    { id: "W4_2", domain: "people", text: "Maintaining a friendship?" },
    { id: "W4_3", domain: "people", text: "Getting along with people who are close to you?" },
    { id: "W4_4", domain: "people", text: "Making new friends?" },
    { id: "W4_5", domain: "people", text: "Sexual activities?" },
  ];

  const D5_HOME = [
    { id: "W5_1", domain: "household", text: "Taking care of your household responsibilities?" },
    { id: "W5_2", domain: "household", text: "Doing most important household tasks well?" },
    { id: "W5_3", domain: "household", text: "Getting all the household work done that you needed to do?" },
    { id: "W5_4", domain: "household", text: "Getting your household work done as quickly as needed?" },
  ];

  const D5_WORK = [
    { id: "W5_5", domain: "work", text: "Your day-to-day work/school?" },
    { id: "W5_6", domain: "work", text: "Doing your most important work/school tasks well?" },
    { id: "W5_7", domain: "work", text: "Getting all the work done that you need to do?" },
    { id: "W5_8", domain: "work", text: "Getting your work done as quickly as needed?" },
  ];

  const D6 = [
    { id: "W6_1", domain: "participation", text: "How much of a problem did you have in joining in community activities (for example, festivities, religious or other activities) in the same way as anyone else can?" },
    { id: "W6_2", domain: "participation", text: "How much of a problem did you have because of barriers or hindrances in the world around you?" },
    { id: "W6_3", domain: "participation", text: "How much of a problem did you have living with dignity because of the attitudes and actions of others?" },
    { id: "W6_4", domain: "participation", text: "How much time did you spend on your health condition, or its consequences?" },
    { id: "W6_5", domain: "participation", text: "How much have you been <em>emotionally</em> affected by your health condition?" },
    { id: "W6_6", domain: "participation", text: "How much has your health been a drain on the financial resources of you or your family?" },
    { id: "W6_7", domain: "participation", text: "How much of a problem did your family have because of your health problems?" },
    { id: "W6_8", domain: "participation", text: "How much of a problem did you have in doing things by yourself for relaxation or pleasure?" },
  ];

  const ALL_ITEMS = [...D1, ...D2, ...D3, ...D4, ...D5_HOME, ...D5_WORK, ...D6];

  const DOMAIN_LABELS = {
    cognition:     "D1 · Cognition (understanding & communicating)",
    mobility:      "D2 · Mobility",
    selfcare:      "D3 · Self-care",
    people:        "D4 · Getting along with people",
    household:     "D5 · Life activities (household)",
    work:          "D5 · Life activities (work / school)",
    participation: "D6 · Participation in society",
  };

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 0);

    // Check whether the work items are "not applicable" - heuristically, if all = 0 AND at least 1 other value > 0
    const workValues = D5_WORK.map(i => get(i.id));
    const workAllZero = workValues.every(v => v === 0);
    const otherValues = ALL_ITEMS.filter(i => i.domain !== "work").map(i => get(i.id));
    const otherHasValues = otherValues.some(v => v > 0);
    const workNotApplicable = workAllZero && otherHasValues;

    const itemsForScoring = workNotApplicable
      ? ALL_ITEMS.filter(i => i.domain !== "work")
      : ALL_ITEMS;

    const total = itemsForScoring.reduce((s, it) => s + get(it.id), 0);
    const max = itemsForScoring.length * 4;
    const pct = Math.round((total / max) * 100);

    const domains = {};
    for (const key of Object.keys(DOMAIN_LABELS)) {
      const items = ALL_ITEMS.filter(i => i.domain === key);
      const sum = items.reduce((s, i) => s + get(i.id), 0);
      const dMax = items.length * 4;
      domains[key] = {
        sum, max: dMax, pct: dMax ? Math.round(sum / dMax * 100) : 0,
        skipped: key === "work" && workNotApplicable,
      };
    }

    let flag, level;
    if (pct < 10)       { level = "no to minimal functional impairment"; flag = "low"; }
    else if (pct < 25)  { level = "mild functional impairment";              flag = "low"; }
    else if (pct < 50)  { level = "moderate functional impairment";              flag = "moderate"; }
    else if (pct < 75)  { level = "severe functional impairment";               flag = "high"; }
    else                { level = "extreme functional impairment";              flag = "high"; }

    return { total, max, pct, level, flag, domains, workNotApplicable };
  }

  function renderResult(result) {
    const titleMap = {
      low: result.pct < 10 ? "Unimpaired level of functioning" : "Mild functional impairment",
      moderate: "Moderate functional impairment",
      high: result.pct >= 75 ? "Extreme functional impairment" : "Severe functional impairment",
    };
    const subMap = {
      low: "Scores are within the population mid-range.",
      moderate: "Some domains are already relevantly impaired — clarifying the causes is advisable.",
      high: "Marked functional limitation — specialist medical assessment and, if indicated, rehabilitation/social counselling recommended.",
    };

    const interp = `
      Your <strong>WHODAS 2.0 total score</strong> is <strong>${result.total} / ${result.max} points</strong>
      (= <strong>${result.pct}&nbsp;%</strong> of the maximum impairment). This corresponds to <strong>${result.level}</strong>.
      ${result.workNotApplicable ? `The "work / school" items were identified as <em>not applicable</em> and excluded from scoring (${ALL_ITEMS.filter(i=>i.domain==="work").length} items).` : ""}
      For comparison: in the WHO World Health Survey (general population &gt; 60,000 adults)
      the median is approx. 5–10&nbsp;%, the 75th percentile approx. 15&nbsp;%, and the 90th percentile
      approx. 30&nbsp;%. Scores of 25&nbsp;% or above are considered clinically notable (DSM-5-TR recommendation).
    `;

    const totalSub = {
      label: "WHODAS 2.0 total score", raw: result.total, max: result.max,
      threshold: Math.round(result.max * 0.25),
      valueLabel: `${result.total} / ${result.max} · ${result.pct} %`,
      note: `Clinical cutoff approx. 25&nbsp;% of the maximum impairment. Current proportion: <strong>${result.pct}&nbsp;%</strong>.`,
    };

    const domainSubs = Object.keys(DOMAIN_LABELS).map((k) => {
      const v = result.domains[k];
      if (v.skipped) {
        return {
          label: DOMAIN_LABELS[k] + " · not assessed",
          raw: 0, max: v.max, threshold: null,
          valueLabel: "not applicable",
          note: "Work/school items identified as not applicable — excluded from overall scoring.",
        };
      }
      return {
        label: DOMAIN_LABELS[k],
        raw: v.sum, max: v.max, threshold: Math.round(v.max * 0.25),
        valueLabel: `${v.sum} / ${v.max} · ${v.pct} %`,
        note: `${v.pct < 25 ? "In the largely unremarkable range." : v.pct < 50 ? "Moderately impaired." : "Severely impaired."}`,
      };
    });

    const context = `
      The <strong>WHODAS 2.0</strong> is the standard instrument developed by the WHO for
      assessing health-related functioning and participation — ICF-compliant, transdiagnostic
      and cross-culturally validated. The <strong>DSM-5-TR</strong> explicitly recommends the 36-item version as
      the standard measure of functional impairment in adult psychiatry. It does
      <em>not</em> assess a specific illness, but rather how much health problems
      (mental or physical) have interfered with your everyday life over the last 30 days.
      The full 36-item version (unlike the 12-item short form) yields clean domain profiles.
    `;

    const next = [];
    if (result.flag === "high") {
      next.push("A medical or psychotherapeutic assessment of the causes is recommended — the WHODAS indicates marked functional limitation without identifying the cause (somatic, mental, social).");
      next.push("Consider social counselling or referral to a rehabilitation or vocational reintegration service.");
    } else if (result.flag === "moderate") {
      next.push("A medical or psychotherapeutic assessment is recommended, especially if the impairment has persisted for several weeks.");
      next.push("Identify the most severely affected domains — they are often the starting point for targeted interventions (e.g. physiotherapy for mobility, CBT for participation or emotional issues).");
    } else {
      next.push("Scores are in the largely unremarkable range. The WHODAS is well suited to regular progress monitoring — e.g. every 3–6 months.");
    }
    next.push("Print this report as a PDF and bring it to your next appointment.");

    return {
      title: titleMap[result.flag],
      sub: subMap[result.flag],
      value: `${result.pct} %`,
      unit: `functional impairment (${result.total}/${result.max} points)`,
      gauge: Math.min(1, result.pct / 100),
      flag: result.flag,
      interpretationHTML: interp,
      subscales: [totalSub, ...domainSubs],
      contextHTML: context,
      nextSteps: next,
      hideCrisis: true,
    };
  }

  return {
    id: "whodas36",
    meta: {
      title: "WHODAS 2.0 · Functioning & Participation (36 items)",
      pageTitle: "WHODAS 2.0 (36) — Functioning & Participation · brainScreener",
      eyebrow: "Level of functioning · ICF · DSM-5-TR",
      intro: `The <strong>WHODAS 2.0</strong> (36 items) is the transdiagnostic standard instrument developed by the WHO for assessing health-related functioning and participation — recommended by the DSM-5-TR. Full version with six domain profiles, reference period: <strong>last 30 days</strong>.`,
      durationText: "approx. 8–12 minutes",
      itemsText: "36 items · 6 domains",
      sources: "WHO 2010 · Üstün et al. 2010 · DSM-5-TR (APA 2022) · ICF (WHO 2024)",
      testPath: "/brainscreener/whodas36",
      retestPath: "/brainscreener/whodas36",
      resultPath: "/brainscreener/whodas36-result",
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
        id: "cognition",
        title: "D1 · Understanding and communicating",
        intro: "<strong>In the last 30 days, how much difficulty did you have in:</strong>",
        items: D1, scale: SCALE,
      },
      {
        id: "mobility",
        title: "D2 · Getting around",
        intro: "Still referring to the last 30 days.",
        items: D2, scale: SCALE,
      },
      {
        id: "selfcare",
        title: "D3 · Self-care",
        intro: "Still referring to the last 30 days.",
        items: D3, scale: SCALE,
      },
      {
        id: "people",
        title: "D4 · Getting along with people",
        intro: "For difficulties in relationships, think of problems arising from your health condition.",
        items: D4, scale: SCALE,
      },
      {
        id: "household",
        title: "D5 · Life activities (household)",
        intro: "Activities you carry out at home for your family or other people.",
        items: D5_HOME, scale: SCALE,
      },
      {
        id: "work",
        title: "D5 · Life activities (work / school)",
        intro: "<strong>If you are not currently employed or in education:</strong> answer the items with reference to your most recent occupation. If you have never been employed or this does not apply to you: please select “None” throughout — the items will then be excluded from scoring.",
        items: D5_WORK, scale: SCALE,
      },
      {
        id: "participation",
        title: "D6 · Participation in society",
        intro: "Final questions on social and societal participation.",
        items: D6, scale: SCALE,
      },
    ],
    evaluate,
    renderResult,
  };
})();
