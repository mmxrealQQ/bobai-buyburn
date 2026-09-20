// MDQ - Mood Disorder Questionnaire
// Sources:
//  - Hirschfeld RMA, Williams JB, Spitzer RL, Calabrese JR et al. (2000). Development
//    and validation of a screening instrument for bipolar spectrum disorder: the
//    Mood Disorder Questionnaire. Am J Psychiatry 157(11):1873-5.
//  - Hu C et al. (2020). Meta-analysis of the MDQ for bipolar spectrum disorders.
//  - DSM-5-TR criteria for Bipolar I / II / Bipolar Spectrum (APA 2022).
//
// 13 yes/no items on lifetime manic/hypomanic symptoms + 2 follow-up questions:
//   Question 14: did several symptoms occur AT THE SAME TIME? (yes/no)
//   Question 15: severity of the problems these caused (0-3)
// Positive-screen algorithm (Hirschfeld 2000):
//   >= 7/13 yes  AND  question 14 = yes  AND  question 15 >= 2 (moderate/serious).

window.TEST_DATA = (function () {
  const YN = { cols: 2, options: [
    { v: 1, label: "Yes" },
    { v: 0, label: "No" },
  ] };
  const SEVERITY = { cols: 4, options: [
    { v: 0, label: "No problem" },
    { v: 1, label: "Minor problem" },
    { v: 2, label: "Moderate problem" },
    { v: 3, label: "Serious problem" },
  ] };

  const SYMPTOMS = [
    { id: "M1",  text: "...you felt so good or so hyper that other people thought you were not your normal self or you were so hyper that you got into trouble?" },
    { id: "M2",  text: "...you were so irritable that you shouted at people or started fights or arguments?" },
    { id: "M3",  text: "...you felt much more self-confident than usual?" },
    { id: "M4",  text: "...you got much less sleep than usual and found you didn't really miss it?" },
    { id: "M5",  text: "...you were much more talkative or spoke much faster than usual?" },
    { id: "M6",  text: "...thoughts raced through your head or you couldn't slow your mind down?" },
    { id: "M7",  text: "...you were so easily distracted by things around you that you had trouble concentrating or staying on track?" },
    { id: "M8",  text: "...you had much more energy than usual?" },
    { id: "M9",  text: "...you were much more active or did many more things than usual?" },
    { id: "M10", text: "...you were much more social or outgoing than usual — for example, you telephoned friends in the middle of the night?" },
    { id: "M11", text: "...you were much more interested in sex than usual?" },
    { id: "M12", text: "...you did things that were unusual for you or that other people might have thought were excessive, foolish, or risky?" },
    { id: "M13", text: "...spending money got you or your family into trouble?" },
  ].map(i => ({ ...i, scale: YN }));

  const FOLLOWUP = [
    { id: "M14", scale: YN,       text: "If you checked YES to more than one of the above, have several of these ever happened <strong>during the same period of time</strong>?" },
    { id: "M15", scale: SEVERITY, text: "How much of a problem did any of these cause you — like being unable to work; having family, money, or legal troubles; getting into arguments or fights?" },
  ];

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 0);
    const yesCount = SYMPTOMS.filter(s => get(s.id) === 1).length;
    const concurrent = get("M14") === 1;
    const severity   = get("M15");
    const positive = yesCount >= 7 && concurrent && severity >= 2;

    let flag;
    if (positive) flag = "high";
    else if (yesCount >= 7 || (yesCount >= 5 && concurrent)) flag = "moderate";
    else flag = "low";

    return { yesCount, concurrent, severity, positive, flag };
  }

  function renderResult(result) {
    const titleMap = {
      low: "Unremarkable MDQ screening",
      moderate: "Partially elevated screening",
      high: "MDQ-positive · consistent with the bipolar spectrum",
    };
    const subMap = {
      low: "The three MDQ criteria are not met.",
      moderate: "Some MDQ criteria are met — a specialist assessment is recommended.",
      high: "All three MDQ criteria are met — a specialist bipolar assessment is recommended.",
    };

    const interp = `
      You answered "Yes" to <strong>${result.yesCount} of 13</strong> symptoms,
      co-occurrence (question 14): <strong>${result.concurrent ? "yes" : "no"}</strong>,
      severity (question 15): <strong>${["no problem","minor problem","moderate problem","serious problem"][result.severity]}</strong>.
      ${result.positive
        ? `This means the <strong>MDQ algorithm is met</strong> (≥&nbsp;7 symptoms, co-occurring, ≥&nbsp;moderate). In validation studies, the MDQ shows a sensitivity of about&nbsp;73&nbsp;% and a specificity of about&nbsp;90&nbsp;% for Bipolar I (Hirschfeld 2000, Hu et al. meta-analysis 2020). For Bipolar II / the bipolar spectrum, sensitivity is lower.`
        : `This means the full MDQ algorithm is not met. However, a negative screening does not rule out a bipolar disorder — particularly Bipolar II — since the MDQ captures hypomanic symptoms less reliably.`}
    `;

    const subscales = [
      { label: "Symptom count (items 1–13)", raw: result.yesCount, max: 13, threshold: 7,
        note: `Cutoff criterion A: ≥&nbsp;7 symptoms answered "Yes". ${result.yesCount >= 7 ? "<strong>Met.</strong>" : "Not met."}` },
      { label: "Co-occurrence (question 14)", raw: result.concurrent ? 1 : 0, max: 1, threshold: 1,
        valueLabel: result.concurrent ? "Yes" : "No",
        note: `Criterion B: symptoms occurred during the same period of time. ${result.concurrent ? "<strong>Met.</strong>" : "Not met."}` },
      { label: "Functional impairment (question 15)", raw: result.severity, max: 3, threshold: 2,
        valueLabel: ["no problem","minor problem","moderate problem","serious problem"][result.severity],
        note: `Criterion C: ≥&nbsp;"moderate". ${result.severity >= 2 ? "<strong>Met.</strong>" : "Not met."}` },
    ];

    const context = `
      The <strong>Mood Disorder Questionnaire (MDQ)</strong> is the most widely used
      self-rating instrument for bipolar spectrum screening worldwide. It asks about
      symptoms of mania/hypomania occurring <em>at any point in life</em> and applies three
      criteria: symptom count ≥&nbsp;7, co-occurrence, and moderate to serious impairment.
      The MDQ is sensitive for Bipolar I but less sensitive for Bipolar II and the bipolar
      spectrum — a negative screening therefore does not rule out a bipolar disorder. A
      confirmed diagnosis requires a clinical interview (e.g.&nbsp;SCID-5, MINI 7).
    `;

    const next = [];
    if (result.flag === "high") {
      next.push("Arrange an appointment with a psychiatric practice or a specialist bipolar outpatient clinic. A bipolar diagnosis is highly relevant for treatment — antidepressants without a mood stabiliser can induce switches in bipolar depression.");
      next.push("A detailed history of the episodes (duration, sleep patterns, level of functioning) is central to the diagnosis. Keep a record of episodes with their duration and triggers.");
      next.push("Evidence-based options depending on the diagnosis: lithium, valproate, quetiapine, lurasidone, lamotrigine (German S3 guideline on bipolar disorders 2024, NICE CG185).");
    } else if (result.flag === "moderate") {
      next.push("Even though the full algorithm is not met, a specialist assessment is worthwhile if bipolar disorder is suspected — Bipolar II is frequently missed.");
      next.push("The Hypomania Checklist HCL-32 (Angst 2005) can be a useful addition, as it captures hypomania more sensitively than the MDQ.");
    } else {
      next.push("The MDQ is negative. If mood symptoms persist, a specialist assessment is still advisable, particularly for differential diagnosis (unipolar depression, personality, ADHD).");
    }
    next.push("Print this report as a PDF and bring it to your next appointment.");

    return {
      title: titleMap[result.flag],
      sub: subMap[result.flag],
      value: result.yesCount,
      unit: `/ 13 symptoms${result.positive ? " · algorithm +" : ""}`,
      gauge: Math.min(1, (result.yesCount/13 * 0.6) + (result.concurrent ? 0.2 : 0) + (result.severity / 3 * 0.2)),
      flag: result.flag,
      interpretationHTML: interp,
      subscales,
      contextHTML: context,
      nextSteps: next,
    };
  }

  return {
    id: "mdq",
    meta: {
      title: "MDQ · Bipolar Screening",
      pageTitle: "MDQ — Bipolar Screening · brainScreener",
      eyebrow: "Bipolar spectrum",
      intro: `The <strong>Mood Disorder Questionnaire (MDQ)</strong> is the most widely used self-report screen for possible manic / hypomanic episodes worldwide. Reference period: <strong>your entire life so far</strong>.`,
      durationText: "approx. 3–4 minutes",
      itemsText: "13 + 2 items",
      sources: "Hirschfeld et al. 2000 · Hu et al. 2020 · DSM-5-TR",
      testPath: "/brainscreener/mdq",
      retestPath: "/brainscreener/mdq",
      resultPath: "/brainscreener/mdq-result",
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
        title: "MDQ · Lifetime symptoms",
        intro: "<strong>Has there ever been a period of time when you were not your usual self and ...</strong>",
        items: SYMPTOMS,
        scale: YN,
      },
      {
        id: "followup",
        title: "MDQ · Follow-up questions",
        intro: "Please answer two final questions about the overall picture.",
        items: FOLLOWUP,
        scale: YN,
      },
    ],
    evaluate,
    renderResult,
  };
})();
