// GAD-7 - Generalized Anxiety Disorder 7-Item Scale
// Sources:
//  - Spitzer RL, Kroenke K, Williams JBW, Loewe B. A brief measure for assessing
//    generalized anxiety disorder: the GAD-7. Arch Intern Med. 2006;166(10):1092-7.
//  - Loewe B et al., Validation and standardization of the GAD-7 in the general
//    German population, J Affect Disord. 2008;114(1-3):163-73.
//  - NICE NG222 (2022, update 2024): GAD-7 as first-line instrument for generalised anxiety.
//  - DSM-5-TR criteria for GAD (APA 2022).
//
// Response scale 0..3 for all 7 items, reference period: last 2 weeks.
// Cutoffs (manual / Spitzer 2006):
//   0-4 minimal, 5-9 mild, 10-14 moderate, 15-21 severe.
// Clinically relevant cutoff for GAD: >= 10 (sens. 89%, spec. 82%).
// Cutoff >= 8 additionally indicates possible panic disorder / social phobia / PTSD.

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
    { id: "G1", text: "Feeling nervous, anxious or on edge" },
    { id: "G2", text: "Not being able to stop or control worrying" },
    { id: "G3", text: "Worrying too much about different things" },
    { id: "G4", text: "Trouble relaxing" },
    { id: "G5", text: "Being so restless that it is hard to sit still" },
    { id: "G6", text: "Becoming easily annoyed or irritable" },
    { id: "G7", text: "Feeling afraid as if something awful might happen" },
  ];

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 0);
    const total = ITEMS.reduce((s, it) => s + get(it.id), 0);
    let severity, flag;
    if (total <= 4)        { severity = "minimal"; flag = "low"; }
    else if (total <= 9)   { severity = "mild";  flag = "low"; }
    else if (total <= 14)  { severity = "moderate";  flag = "moderate"; }
    else                   { severity = "severe";  flag = "high"; }
    return {
      total, max: 21, severity, flag,
      cutoffReached: total >= 10,
      panicHint: total >= 8,
    };
  }

  function renderResult(result) {
    const titleMap = {
      low: result.total <= 4 ? "Unremarkable screening" : "Mild anxiety symptoms",
      moderate: "Moderate anxiety symptoms",
      high: "Severe anxiety symptoms",
    };
    const subMap = {
      low: result.total <= 4 ? "No indications of a clinically relevant anxiety disorder." : "Symptoms are present but remain below the clinical cutoff — monitoring is advisable.",
      moderate: "The total score falls within the range that suggests a specialist assessment.",
      high: "The picture is consistent with an anxiety disorder requiring treatment.",
    };

    const interp = `
      Your <strong>GAD-7 total score</strong> is <strong>${result.total} of 21 points</strong> — a <strong>${result.severity}</strong> level of severity.
      ${result.cutoffReached
        ? `The established cutoff of ≥&nbsp;10 has been reached; validation studies report a sensitivity of approx.&nbsp;89&nbsp;% and specificity of approx.&nbsp;82&nbsp;% for generalised anxiety disorder at this threshold (Spitzer et al. 2006; Plummer et al. meta-analysis 2016; NICE NG222).`
        : (result.panicHint
            ? `The GAD cutoff of 10 has not been reached, but the score is ≥&nbsp;8 — in this range, validation studies show additional indications of panic disorder, social phobia or PTSD symptoms (Kroenke et al. 2007).`
            : `The cutoff of ≥&nbsp;10 has not been reached. If the distress persists over several weeks, a specialist assessment is nevertheless advisable.`)}
    `;

    const subscales = [
      {
        label: "GAD-7 total score",
        raw: result.total, max: 21, threshold: 10,
        note: `Cutoff for clinically relevant GAD: ≥&nbsp;10. ${result.cutoffReached ? "<strong>Cutoff reached.</strong>" : "Cutoff not reached."} Severity: <strong>${result.severity}</strong>.`,
      },
    ];

    const context = `
      The <strong>Generalized Anxiety Disorder Scale (GAD-7)</strong> is the most widely used
      self-report measure internationally for assessing generalised anxiety symptoms and is
      considered the sister instrument of the PHQ-9. It was developed in 2006 by Spitzer, Kroenke & Williams
      and, despite its focus on GAD, also serves as a good initial screener for panic disorder,
      social phobia and PTSD (Kroenke et al. 2007). NICE NG222 (2022, update 2024) recommends
      it as the first-line instrument in primary care.
    `;

    const next = [];
    if (result.flag === "high") {
      next.push("Arrange an appointment promptly with your general practitioner or directly with a psychiatric / psychotherapeutic practice.");
      next.push("A confirmed diagnosis requires a clinical interview and the exclusion of organic causes (e.&nbsp;g. hyperthyroidism, caffeine/substances, cardiac arrhythmia).");
      next.push("Evidence-based treatments for GAD: cognitive behavioural therapy (CBT), and in more severe cases SSRIs/SNRIs (grade A recommendation, NICE / German S3 guideline 2021).");
    } else if (result.flag === "moderate") {
      next.push("A specialist or psychotherapeutic assessment is recommended, particularly if the symptoms have persisted for more than 6 months (DSM-5-TR duration criterion for GAD).");
      next.push("Consider accompanying progress monitoring — the GAD-7 is a standardised instrument well suited for this purpose.");
    } else {
      if (result.panicHint) next.push("Your score is below the GAD cutoff, but within a range that may additionally indicate panic or social phobia symptoms. A differentiated assessment is advisable if you feel distressed.");
      next.push("The scores are in the largely unremarkable range. Stay attentive in case the symptoms change.");
      next.push("Sleep, exercise, reducing caffeine/alcohol and structured breathing/relaxation exercises are effective everyday measures.");
    }
    next.push("Print this report as a PDF and bring it to your next appointment.");

    return {
      title: titleMap[result.flag],
      sub: subMap[result.flag],
      value: result.total,
      unit: `/ 21 points · ${result.severity}`,
      gauge: result.total / 21,
      flag: result.flag,
      interpretationHTML: interp,
      subscales,
      contextHTML: context,
      nextSteps: next,
    };
  }

  return {
    id: "gad7",
    meta: {
      title: "GAD-7 · Anxiety Screening",
      pageTitle: "GAD-7 — Anxiety Screening · brainScreener",
      eyebrow: "Generalised Anxiety Disorder",
      intro: `This instrument is the <strong>Generalized Anxiety Disorder Scale (GAD-7)</strong> — the most widely used self-report test worldwide for assessing generalised anxiety symptoms. Seven items, reference period: <strong>last 2 weeks</strong>.`,
      durationText: "approx. 2–3 minutes",
      itemsText: "7 items",
      sources: "Spitzer, Kroenke & Williams 2006 · Löwe et al. (dt.) 2008 · NICE NG222 (2024)",
      testPath: "/brainscreener/gad7.html",
      retestPath: "/brainscreener/gad7.html",
      resultPath: "/brainscreener/gad7-result.html",
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
        title: "GAD-7 · Last 2 weeks",
        intro: "<strong>Over the last 2 weeks, how often have you been bothered by the following problems?</strong>",
        items: ITEMS,
        scale: SCALE,
      },
    ],
    evaluate,
    renderResult,
  };
})();
