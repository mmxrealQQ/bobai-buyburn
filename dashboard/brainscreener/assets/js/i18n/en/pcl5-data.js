// PCL-5 - PTSD Checklist for DSM-5
// Sources:
//  - Weathers FW, Litz BT, Keane TM, Palmieri PA, Marx BP, Schnurr PP (2013).
//    The PTSD Checklist for DSM-5 (PCL-5). National Center for PTSD (public domain).
//  - Krueger-Gottschalk A, Knaevelsrud C, Roehr S, Renneberg B, Friedrich M et al. (2017).
//    The German version of the PCL-5: psychometric properties. BMC Psychiatry 17:379.
//  - DSM-5-TR (APA 2022) criteria for PTSD.
//
// 20 items, scale 0..4 ("Not at all"..."Extremely"). Reference period: past month.
// Subscales per DSM-5 (symptom clusters):
//   B (Intrusion):              Items 1-5
//   C (Avoidance):              Items 6-7
//   D (Negative Cognitions/Mood): Items 8-14
//   E (Arousal/Reactivity):     Items 15-20
// Total cutoff:
//   >= 31 per Weathers et al.; the current meta-analysis Bovin et al. 2024 supports 31-33
//   in civilian populations. We use 33 as the conservative cutoff.
// Probable-PTSD algorithm (DSM-5):
//   >= 1 B item (1-5) rated >= 2
//   >= 1 C item (6-7) rated >= 2
//   >= 2 D items (8-14) rated >= 2
//   >= 2 E items (15-20) rated >= 2

window.TEST_DATA = (function () {
  const SCALE = {
    cols: 5,
    options: [
      { v: 0, label: "Not at all" },
      { v: 1, label: "A little bit" },
      { v: 2, label: "Moderately" },
      { v: 3, label: "Quite a bit" },
      { v: 4, label: "Extremely" },
    ],
  };

  const ITEMS = [
    { id: "T1",  cluster: "B", text: "Repeated, disturbing, and unwanted memories of the stressful experience?" },
    { id: "T2",  cluster: "B", text: "Repeated, disturbing dreams of the stressful experience?" },
    { id: "T3",  cluster: "B", text: "Suddenly feeling or acting as if the stressful experience were actually happening again (as if you were actually back there reliving it)?" },
    { id: "T4",  cluster: "B", text: "Feeling very upset when something reminded you of the stressful experience?" },
    { id: "T5",  cluster: "B", text: "Having strong physical reactions when something reminded you of the stressful experience (for example, heart pounding, trouble breathing, sweating)?" },
    { id: "T6",  cluster: "C", text: "Avoiding memories, thoughts, or feelings related to the stressful experience?" },
    { id: "T7",  cluster: "C", text: "Avoiding external reminders of the stressful experience (for example, people, places, conversations, activities, objects, or situations)?" },
    { id: "T8",  cluster: "D", text: "Trouble remembering important parts of the stressful experience?" },
    { id: "T9",  cluster: "D", text: "Having strong negative beliefs about yourself, other people, or the world (for example, having thoughts such as: I am bad, there is something seriously wrong with me, no one can be trusted, the world is completely dangerous)?" },
    { id: "T10", cluster: "D", text: "Blaming yourself or someone else for the stressful experience or what happened after it?" },
    { id: "T11", cluster: "D", text: "Having strong negative feelings such as fear, horror, anger, guilt, or shame?" },
    { id: "T12", cluster: "D", text: "Loss of interest in activities that you used to enjoy?" },
    { id: "T13", cluster: "D", text: "Feeling distant or cut off from other people?" },
    { id: "T14", cluster: "D", text: "Trouble experiencing positive feelings (for example, being unable to feel happiness or have loving feelings for people close to you)?" },
    { id: "T15", cluster: "E", text: "Irritable behavior, angry outbursts, or acting aggressively?" },
    { id: "T16", cluster: "E", text: "Taking too many risks or doing things that could cause you harm?" },
    { id: "T17", cluster: "E", text: "Being “superalert” or watchful or on guard?" },
    { id: "T18", cluster: "E", text: "Feeling jumpy or easily startled?" },
    { id: "T19", cluster: "E", text: "Having difficulty concentrating?" },
    { id: "T20", cluster: "E", text: "Trouble falling or staying asleep?" },
  ];

  const CUTOFF = 33;

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 0);
    const total = ITEMS.reduce((s, it) => s + get(it.id), 0);
    const sumCluster = (c) => ITEMS.filter(i => i.cluster === c).reduce((s, i) => s + get(i.id), 0);
    const B = sumCluster("B"), C = sumCluster("C"), D = sumCluster("D"), E = sumCluster("E");

    const countAtLeast2 = (cluster) => ITEMS.filter(i => i.cluster === cluster && get(i.id) >= 2).length;
    const cB = countAtLeast2("B"), cC = countAtLeast2("C"), cD = countAtLeast2("D"), cE = countAtLeast2("E");
    const dsmAlgo = cB >= 1 && cC >= 1 && cD >= 2 && cE >= 2;
    const cutoff = total >= CUTOFF;

    let flag;
    if (dsmAlgo && cutoff) flag = "high";
    else if (cutoff || (cB >= 1 && cC >= 1 && (cD + cE) >= 2)) flag = "moderate";
    else if (total >= 20) flag = "moderate";
    else flag = "low";

    return {
      total, max: 80,
      clusterScores: { B, C, D, E },
      clusterMax: { B: 20, C: 8, D: 28, E: 24 },
      clusterCountsAtLeast2: { B: cB, C: cC, D: cD, E: cE },
      dsmAlgorithm: dsmAlgo,
      cutoff: CUTOFF, cutoffReached: cutoff,
      flag,
    };
  }

  function renderResult(result) {
    const titleMap = {
      low: "Unremarkable PTSD screening",
      moderate: "Indications of PTSD symptoms",
      high: "Consistent with PTSD per DSM-5",
    };
    const subMap = {
      low: "The scores reach neither the total-score cutoff nor the DSM-5 algorithm.",
      moderate: "Individual symptom clusters are elevated — a specialist assessment is recommended.",
      high: "Both the total-score cutoff and the DSM-5 symptom structure are met.",
    };

    const cs = result.clusterScores, cm = result.clusterMax;
    const interp = `
      Your PCL-5 total score is <strong>${result.total} of 80 points</strong>.
      ${result.cutoffReached
        ? `The conservative cutoff of ≥&nbsp;${result.cutoff} (Bovin et al. 2016/2024, German validation Krüger-Gottschalk et al. 2017) has been reached.`
        : `The cutoff of ≥&nbsp;${result.cutoff} has not been reached.`}
      ${result.dsmAlgorithm
        ? ` In addition, you meet the <strong>DSM-5 symptom algorithm</strong> (≥&nbsp;1 intrusion, ≥&nbsp;1 avoidance, ≥&nbsp;2 cognition/mood and ≥&nbsp;2 arousal symptoms rated ≥ “moderately”).`
        : ` The DSM-5 symptom algorithm is <strong>not</strong> fully met.`}
      A definitive PTSD diagnosis additionally requires the explicit presence of a Criterion A trauma and a clinical interview (e.g.&nbsp;CAPS-5).
    `;

    const subscales = [
      {
        label: "PCL-5 total score",
        raw: result.total, max: 80, threshold: result.cutoff,
        note: `Cutoff for clinically probable PTSD: ≥&nbsp;${result.cutoff}. ${result.cutoffReached ? "<strong>Cutoff reached.</strong>" : "Cutoff not reached."}`,
      },
      {
        label: "Cluster B · Intrusion (re-experiencing)",
        raw: cs.B, max: cm.B, threshold: 4,
        note: `Symptoms rated ≥ “moderately”: ${result.clusterCountsAtLeast2.B}/5. DSM-5 requires at least 1.`,
      },
      {
        label: "Cluster C · Avoidance",
        raw: cs.C, max: cm.C, threshold: 2,
        note: `Symptoms rated ≥ “moderately”: ${result.clusterCountsAtLeast2.C}/2. DSM-5 requires at least 1.`,
      },
      {
        label: "Cluster D · Negative cognitions / mood",
        raw: cs.D, max: cm.D, threshold: 6,
        note: `Symptoms rated ≥ “moderately”: ${result.clusterCountsAtLeast2.D}/7. DSM-5 requires at least 2.`,
      },
      {
        label: "Cluster E · Arousal / reactivity",
        raw: cs.E, max: cm.E, threshold: 6,
        note: `Symptoms rated ≥ “moderately”: ${result.clusterCountsAtLeast2.E}/6. DSM-5 requires at least 2.`,
      },
    ];

    const context = `
      The <strong>PTSD Checklist for DSM-5 (PCL-5)</strong> is the gold-standard self-report
      measure for post-traumatic stress disorder and maps all 20 DSM-5-TR symptoms 1:1.
      It was developed in 2013 by the US National Center for PTSD, is in the public domain
      and, since the Krüger-Gottschalk validation (2017), is also well established in
      German-speaking countries. Reference period: <strong>past month</strong>. A confirmed diagnosis requires
      the presence of a Criterion A trauma and a structured clinical interview
      (e.g.&nbsp;CAPS-5).
    `;

    const next = [];
    if (result.flag === "high") {
      next.push("Arrange an appointment promptly with a psychotherapy or psychiatric practice specialising in trauma-related disorders.");
      next.push("Evidence-based treatments for PTSD: trauma-focused CBT (e.g.&nbsp;CPT, PE), EMDR (grade A recommendation; German S3 guideline DeGPT 2019, NICE NG116 update 2024).");
      next.push("Bring this report to your first appointment — it structures the clinical history and can be continued as a progress measure.");
    } else if (result.flag === "moderate") {
      next.push("A specialist or trauma-therapy assessment is recommended, particularly if the symptoms have persisted for more than one month or interfere with daily life.");
      next.push("Note the importance of the reference period: if the trauma occurred less than 4 weeks ago, an acute stress reaction is possible (ICD-11 6B40).");
    } else {
      next.push("The scores are in the largely unremarkable range. Stay alert if new stressful experiences occur.");
      next.push("Even with a low PCL-5 score, distress after a trauma may be present — if daily life is affected, seeing a professional is advisable.");
    }
    next.push("Print this report as a PDF and bring it to your next appointment.");

    return {
      title: titleMap[result.flag],
      sub: subMap[result.flag],
      value: result.total,
      unit: `/ 80 points`,
      gauge: result.total / 80,
      flag: result.flag,
      interpretationHTML: interp,
      subscales,
      contextHTML: context,
      nextSteps: next,
    };
  }

  return {
    id: "pcl5",
    meta: {
      title: "PCL-5 · Trauma/PTSD screening",
      pageTitle: "PCL-5 — Trauma/PTSD screening · brainScreener",
      eyebrow: "Post-traumatic stress disorder",
      intro: `The <strong>PTSD Checklist for DSM-5 (PCL-5)</strong> is the global gold standard in PTSD self-report assessment. 20 items covering all DSM-5-TR symptoms, reference period: <strong>past month</strong>. <em>Note: answer the questions with reference to a specific stressful experience from your past. If you have not had such an experience, this test is not indicated for you.</em>`,
      durationText: "approx. 5–7 minutes",
      itemsText: "20 items",
      sources: "Weathers et al. 2013 · Krüger-Gottschalk et al. (dt.) 2017 · DSM-5-TR (APA 2022)",
      testPath: "/brainscreener/pcl5.html",
      retestPath: "/brainscreener/pcl5.html",
      resultPath: "/brainscreener/pcl5-result.html",
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
        title: "PCL-5 · Past month",
        intro: "<strong>In the past month, how much were you bothered by the following problems?</strong> Answer with reference to a specific stressful experience from your past.",
        items: ITEMS,
        scale: SCALE,
      },
    ],
    evaluate,
    renderResult,
  };
})();
