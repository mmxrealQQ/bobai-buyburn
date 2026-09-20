// PHQ-9 - Patient Health Questionnaire-9 (Depression)
// Sources:
//  - Kroenke K, Spitzer RL, Williams JB. The PHQ-9: validity of a brief depression
//    severity measure. J Gen Intern Med. 2001;16(9):606-13.
//  - Loewe B, Spitzer RL, Zipfel S, Herzog W. PHQ-D, Manual und Testunterlagen,
//    Pfizer 2002 (authorised German version).
//  - USPSTF 2023 / 2024: Screening for depression in adults (Grade B recommendation);
//    PHQ-9 remains the first-choice instrument in the primary-care setting.
//
// Response scale 0..3 for all 9 items.
// Cutoffs (manual): 0-4 minimal, 5-9 mild, 10-14 moderate, 15-19 moderately severe,
//                   20-27 severe. Clinically relevant major depression: >= 10.

window.TEST_DATA = (function () {
  const SCALE = {
    cols: 4,
    options: [
      { v: 0, label: "Not at all" },
      { v: 1, label: "Several days" },
      { v: 2, label: "More than half the days" },
      { v: 3, label: "Nearly every day" },
    ],
  };

  const ITEMS = [
    { id: "P1", text: "Little interest or pleasure in doing things" },
    { id: "P2", text: "Feeling down, depressed, or hopeless" },
    { id: "P3", text: "Trouble falling or staying asleep, or sleeping too much" },
    { id: "P4", text: "Feeling tired or having little energy" },
    { id: "P5", text: "Poor appetite or overeating" },
    { id: "P6", text: "Feeling bad about yourself — or that you are a failure or have let yourself or your family down" },
    { id: "P7", text: "Trouble concentrating on things, such as reading the newspaper or watching television" },
    { id: "P8", text: "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual" },
    { id: "P9", text: "Thoughts that you would be better off dead, or of hurting yourself in some way" },
  ];

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 0);
    const total = ITEMS.reduce((s, it) => s + get(it.id), 0);
    const q9 = get("P9");

    let severity, flag;
    if (total <= 4)        { severity = "minimal";    flag = "low"; }
    else if (total <= 9)   { severity = "mild";     flag = "low"; }
    else if (total <= 14)  { severity = "moderate"; flag = "moderate"; }
    else if (total <= 19)  { severity = "moderately severe"; flag = "high"; }
    else                   { severity = "severe";     flag = "high"; }

    // DSM-5-TR major depression algorithm (PHQ-9 as criteria check):
    // at least 1 core symptom (P1 or P2) >=2, plus a total of >=5 items >=2.
    // Item 9 counts if present at all — the PHQ instruction manual (Kroenke,
    // Spitzer & Williams): "count item 9 if present at all, regardless of
    // duration". Until 2026-09-20 it was counted from 2 like the others.
    const itemsAtLeast2 = ITEMS.filter((it) => get(it.id) >= (it.id === "P9" ? 1 : 2));
    const coreSymptom   = get("P1") >= 2 || get("P2") >= 2;
    const mddAlgorithm  = coreSymptom && itemsAtLeast2.length >= 5;

    return {
      total, max: 27, severity, flag, q9,
      mddAlgorithm, itemsAtLeast2: itemsAtLeast2.length,
      cutoffReached: total >= 10,
    };
  }

  function renderResult(result) {
    const flagMap = {
      low: {
        title: result.total <= 4 ? "Unremarkable screening" : "Mild depressive symptoms",
        sub: result.total <= 4
          ? "No indications of clinically relevant depressive symptoms."
          : "Mild symptoms that warrant monitoring — currently below the clinical cutoff.",
      },
      moderate: {
        title: "Moderate depressive symptoms",
        sub: "The total score falls within the range that suggests a specialist assessment.",
      },
      high: {
        title: result.total >= 20 ? "Severe depressive symptoms" : "Moderately severe depressive symptoms",
        sub: "The picture is consistent with major depression requiring treatment.",
      },
    };
    // A low total must never read "unremarkable" beside an endorsed item 9
    // (2026-09-20): item 9 = 3 with everything else 0 is a total of 3 — and the
    // headline said "No indications…" over a green gauge, with the crisis
    // information several screens further down. The score and the cut-offs are
    // untouched; only the words and the order of the page change.
    const risk = result.q9 >= 1;
    let cfg = flagMap[result.flag];
    if (risk && result.flag === "low") {
      cfg = {
        title: "Low total score, but one answer needs attention",
        sub: "You reported thoughts of being better off dead or of hurting yourself. Please read the crisis information first.",
      };
    }

    const interp = `
      Your <strong>PHQ-9 total score</strong> is <strong>${result.total} of 27 points</strong> — this corresponds to <strong>${result.severity}</strong> severity.
      ${result.cutoffReached
        ? `The clinically established cutoff of ≥&nbsp;10 has been reached; in validation studies this value shows a sensitivity of approx.&nbsp;88&nbsp;% and a specificity of approx.&nbsp;88&nbsp;% for major depression (Manea et al., meta-analysis 2012; confirmed in USPSTF 2023).`
        : `The clinical cutoff of ≥&nbsp;10 has not been reached. If the distress persists for weeks or worsens, a specialist assessment is nevertheless advisable.`}
      ${result.mddAlgorithm
        ? ` In addition, your response pattern meets the <strong>DSM-5-TR algorithm</strong> for major depression (at least one core symptom plus ≥&nbsp;5 symptoms rated "more than half the days").`
        : ""}
    `;

    const subscales = [
      {
        label: "PHQ-9 total score",
        raw: result.total, max: 27, threshold: 10,
        note: `Cutoff for a clinically relevant depressive episode: ≥&nbsp;10. ${result.cutoffReached ? "<strong>Cutoff reached.</strong>" : "Cutoff not reached."} Severity: <strong>${result.severity}</strong>.`,
      },
      {
        label: "Suicidality / self-harm experiences (item 9)",
        raw: result.q9, max: 3, threshold: 1,
        note: result.q9 === 0
          ? "No such thoughts reported."
          : `<strong>Important:</strong> You have indicated that over the last 2 weeks you experienced thoughts that you would be better off dead or of hurting yourself (frequency: ${["—","several days","more than half the days","nearly every day"][result.q9]}). Please speak with a professional promptly — see the crisis information at the top of this page.`,
      },
      {
        label: `Number of symptoms rated "more than half the days" (item 9 counts from "several days")`,
        raw: result.itemsAtLeast2, max: 9, threshold: 5,
        note: `${result.itemsAtLeast2} of 9 items count (a value of ≥&nbsp;2; item 9 from ≥&nbsp;1, as the PHQ manual specifies). DSM-5-TR algorithm for major depression: ≥&nbsp;5 plus at least one core symptom.`,
      },
    ];

    const context = `
      The <strong>Patient Health Questionnaire-9 (PHQ-9)</strong> directly maps the nine DSM-5 symptom
      criteria of major depression and, with more than 5,000 validation studies, is the
      most thoroughly researched depression self-rating instrument worldwide. The reference period is the
      <strong>last 2 weeks</strong>. The instrument is suitable for screening, severity assessment
      and monitoring the course of treatment. It does not replace a medical diagnosis, but it is
      recommended as a first-line instrument internationally
      (USPSTF 2023, NICE NG222).
    `;

    const next = [];
    if (risk) {
      next.push("<strong>Important:</strong> If you are currently experiencing thoughts of death or self-harm, please contact a professional or one of the crisis services listed at the top of this page without delay. In acute danger: call your local emergency number (112 / 911 / 999) immediately.");
    }
    if (result.flag === "high") {
      next.push("Arrange an appointment promptly with your general practitioner or directly with a psychiatric / psychotherapeutic practice. The printed result can help structure the initial consultation.");
      next.push("A confirmed diagnosis requires a clinical interview and the exclusion of differential-diagnostic causes (e.g. thyroid disease, sleep apnoea, substance effects, a bipolar component).");
    } else if (result.flag === "moderate") {
      next.push("A specialist or psychotherapeutic assessment is recommended, especially if the symptoms have persisted for more than 2 weeks or interfere with everyday life.");
      next.push("Consider accompanying progress monitoring — the PHQ-9 is a standardised instrument for this purpose (complete it again every 2–4 weeks).");
    } else if (risk) {
      next.push("Even with a low total score, thoughts of death or self-harm are a reason to talk to a doctor or therapist soon.");
    } else {
      next.push("The current values are within a largely unremarkable range. Stay attentive in case the symptoms change.");
      next.push("Sleep, exercise, social contact and daily structure are the most effective everyday protective factors.");
    }
    next.push("Print this report as a PDF and bring it to your next medical or therapy appointment.");

    return {
      title: cfg.title,
      sub: cfg.sub,
      value: result.total,
      unit: `/ 27 points · ${result.severity}`,
      gauge: result.total / 27,
      // The colour only: a green dial over "needs attention" would contradict the headline.
      flag: risk && result.flag === "low" ? "moderate" : result.flag,
      interpretationHTML: interp,
      subscales,
      contextHTML: context,
      nextSteps: next,
      // result-engine moves the page's crisis box directly under the score.
      crisisFirst: risk,
    };
  }

  return {
    id: "phq9",
    meta: {
      title: "PHQ-9 · Depression Screening",
      pageTitle: "PHQ-9 — Depression Screening · brainScreener",
      eyebrow: "Depression in adults",
      intro: `This instrument is the <strong>Patient Health Questionnaire-9 (PHQ-9)</strong> — the most widely used self-report questionnaire internationally for assessing depressive symptoms. It directly maps the nine DSM-5-TR symptom criteria of major depression. Reference period: <strong>last 2 weeks</strong>.`,
      durationText: "approx. 3–4 minutes",
      itemsText: "9 items",
      sources: "Kroenke, Spitzer & Williams 2001 · Löwe et al. (Pfizer, German version) 2002 · USPSTF 2023",
      testPath: "/brainscreener/phq9",
      retestPath: "/brainscreener/phq9",
      resultPath: "/brainscreener/phq9-result",
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
        title: "PHQ-9 · Last 2 weeks",
        intro: "<strong>Over the last 2 weeks, how often have you been bothered by any of the following problems?</strong>",
        items: ITEMS,
        scale: SCALE,
      },
    ],
    evaluate,
    renderResult,
  };
})();
