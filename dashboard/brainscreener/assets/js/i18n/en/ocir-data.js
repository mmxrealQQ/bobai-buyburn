// OCI-R - Obsessive-Compulsive Inventory Revised
// Sources:
//  - Foa EB, Huppert JD, Leiberg S, Langner R, Kichic R, Hajcak G, Salkovskis PM (2002).
//    The Obsessive-Compulsive Inventory: development and validation of a short version.
//    Psychol Assess 14(4): 485-96.
//  - Goenner S, Leonhart R, Ecker W (2008). The Obsessive-Compulsive Inventory-Revised
//    (OCI-R): validation of the German version. J Anxiety Disord 22(4): 734-49.
//  - Abramovitch A, Abramowitz JS, McKay D (2020). The OCI-R: A critical review and
//    recommended revisions. J Anxiety Disord 76:102307.
//
// 18 items, scale 0..4. Reference period: past month.
// 6 subscales of 3 items each:
//   Washing:      5, 11, 17    Checking:    2, 8, 14    Ordering:    3, 9, 15
//   Obsessing:    6, 12, 18    Hoarding:    1, 7, 13    Neutralising: 4, 10, 16
// Cutoffs:
//   Total >= 21 (Foa et al. 2002, classic cutoff). Sensitivity ~66%, specificity ~64%.
//   Alternative more recent recommendation: >= 14 (more sensitive, less specific).

window.TEST_DATA = (function () {
  const SCALE = {
    cols: 5,
    options: [
      { v: 0, label: "Not at all" },
      { v: 1, label: "A little" },
      { v: 2, label: "Moderately" },
      { v: 3, label: "A lot" },
      { v: 4, label: "Extremely" },
    ],
  };

  const ITEMS = [
    { id: "O1",  sub: "hoarding",    text: "I have saved up so many things that they get in the way." },
    { id: "O2",  sub: "checking",    text: "I check things more often than necessary." },
    { id: "O3",  sub: "ordering",    text: "I get upset if objects are not arranged properly." },
    { id: "O4",  sub: "neutralising",text: "I feel compelled to count while I am doing things." },
    { id: "O5",  sub: "washing",     text: "I find it difficult to touch an object when I know it has been touched by strangers or certain people." },
    { id: "O6",  sub: "obsessing",   text: "I find it difficult to control my own thoughts." },
    { id: "O7",  sub: "hoarding",    text: "I collect things I don't need." },
    { id: "O8",  sub: "checking",    text: "I repeatedly check doors, windows, drawers, etc." },
    { id: "O9",  sub: "ordering",    text: "I get upset if others change the way I have arranged things." },
    { id: "O10", sub: "neutralising",text: "I feel I have to repeat certain numbers." },
    { id: "O11", sub: "washing",     text: "I sometimes have to wash or clean myself simply because I feel contaminated." },
    { id: "O12", sub: "obsessing",   text: "I am upset by unpleasant thoughts that come into my mind against my will." },
    { id: "O13", sub: "hoarding",    text: "I avoid throwing things away because I am afraid I might need them later." },
    { id: "O14", sub: "checking",    text: "I repeatedly check gas and water taps and light switches after turning them off." },
    { id: "O15", sub: "ordering",    text: "I need things to be arranged in a particular order." },
    { id: "O16", sub: "neutralising",text: "I feel that there are good and bad numbers." },
    { id: "O17", sub: "washing",     text: "I wash my hands more often and longer than necessary." },
    { id: "O18", sub: "obsessing",   text: "I frequently get nasty thoughts and have difficulty in getting rid of them." },
  ];

  const SUBSCALE_LABELS = {
    washing:      "Washing / contamination",
    checking:     "Checking",
    ordering:     "Ordering / symmetry",
    obsessing:    "Obsessing",
    hoarding:     "Hoarding",
    neutralising: "Mental neutralising",
  };

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 0);
    const total = ITEMS.reduce((s, i) => s + get(i.id), 0);
    const subs = {};
    for (const key of Object.keys(SUBSCALE_LABELS)) {
      subs[key] = ITEMS.filter(i => i.sub === key).reduce((s, i) => s + get(i.id), 0);
    }
    const cutoffReached = total >= 21;
    const sensitiveCutoff = total >= 14;

    let flag;
    if (total >= 30) flag = "high";
    else if (cutoffReached) flag = "moderate";
    else if (sensitiveCutoff) flag = "moderate";
    else flag = "low";

    return { total, max: 72, subs, cutoffReached, sensitiveCutoff, flag };
  }

  function renderResult(result) {
    const titleMap = {
      low: "Unremarkable OCD screening",
      moderate: "Indications of obsessive-compulsive symptoms",
      high: "Consistent with clinically relevant obsessive-compulsive symptoms",
    };
    const subMap = {
      low: "The scores are below the clinically established cutoff.",
      moderate: "The score suggests a specialist assessment is advisable.",
      high: "The profile is consistent with obsessive-compulsive disorder; prompt specialist assessment is recommended.",
    };

    const interp = `
      Your <strong>OCI-R total score</strong> is <strong>${result.total} of 72 points</strong>.
      ${result.cutoffReached
        ? `The classic cutoff of ≥&nbsp;21 (Foa et al. 2002) is reached — sensitivity approx.&nbsp;66&nbsp;%, specificity approx.&nbsp;64&nbsp;% for obsessive-compulsive disorder.`
        : (result.sensitiveCutoff
            ? `The standard cutoff of ≥&nbsp;21 is not reached, but the more sensitive cutoff of ≥&nbsp;14 (Abramovitch et al. 2020) is. A specialist assessment is worthwhile if the symptoms are distressing.`
            : `Neither of the established cutoffs (≥&nbsp;14 sensitive; ≥&nbsp;21 specific) is reached.`)}
      The six subscales below show in which direction the obsessive-compulsive symptoms are most pronounced.
    `;

    const subscaleEntries = Object.keys(SUBSCALE_LABELS).map((key) => ({
      label: `Subscale · ${SUBSCALE_LABELS[key]}`,
      raw: result.subs[key], max: 12, threshold: 6, thresholdLabel: "Guide value",
      note: `${result.subs[key]} of 12 points.${result.subs[key] >= 6 ? " <strong>Markedly elevated</strong> (≥&nbsp;6 of 12 — a guide value, not a validated subscale cutoff)." : ""}`,
    }));

    subscaleEntries.unshift({
      label: "OCI-R total score",
      raw: result.total, max: 72, threshold: 21,
      note: `Classic cutoff: ≥&nbsp;21. ${result.cutoffReached ? "<strong>Reached.</strong>" : "Not reached."}`,
    });

    const context = `
      The <strong>Obsessive-Compulsive Inventory-Revised (OCI-R)</strong> is a brief, internationally
      established self-report measure for the dimensional assessment of obsessive-compulsive symptoms.
      It covers six symptom dimensions and is more sensitive than the original OCI of 1998.
      The German validation (Goenner et al. 2008) demonstrates good psychometric properties.
      Reference period: <strong>past month</strong>. A definitive diagnosis requires a clinical
      interview (e.g. the Y-BOCS symptom checklist).
    `;

    const next = [];
    if (result.flag === "high") {
      next.push("Arrange an appointment promptly with a psychotherapy practice specialising in obsessive-compulsive disorder.");
      next.push("Evidence-based and effective: cognitive behavioural therapy with exposure and response prevention (ERP), supplemented by an SSRI where appropriate (grade A recommendation, German S3 guideline 2022, NICE CG31 update 2024).");
    } else if (result.flag === "moderate") {
      next.push("A specialist medical or psychotherapeutic assessment is recommended, particularly if the obsessions or compulsions take up more than one hour per day or noticeably restrict everyday life (DSM-5-TR time criterion).");
      next.push("Take note of which subscale is most pronounced for you — this helps in the initial therapeutic consultation.");
    } else {
      next.push("The scores lie in the largely unremarkable range. Stay alert if symptoms change.");
    }
    next.push("Print this report as a PDF and bring it to your next appointment.");

    return {
      title: titleMap[result.flag],
      sub: subMap[result.flag],
      value: result.total,
      unit: `/ 72 points`,
      gauge: result.total / 72,
      flag: result.flag,
      interpretationHTML: interp,
      subscales: subscaleEntries,
      contextHTML: context,
      nextSteps: next,
    };
  }

  return {
    id: "ocir",
    meta: {
      title: "OCI-R · OCD Screening",
      pageTitle: "OCI-R — OCD Screening · brainScreener",
      eyebrow: "Obsessive-Compulsive Disorder",
      intro: `The <strong>Obsessive-Compulsive Inventory-Revised (OCI-R)</strong> is an internationally recognised brief self-report test for the dimensional assessment of obsessive-compulsive symptoms — reference period: <strong>past month</strong>. 18 items across six symptom domains (washing, checking, ordering, obsessing, hoarding, neutralising).`,
      durationText: "approx. 4–5 minutes",
      itemsText: "18 items · 6 subscales",
      sources: "Foa et al. 2002 · Gönner, Leonhart & Ecker (German version) 2008 · Abramovitch et al. 2020",
      testPath: "/brainscreener/ocir",
      retestPath: "/brainscreener/ocir",
      resultPath: "/brainscreener/ocir-result",
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
        title: "OCI-R · Past month",
        intro: "<strong>How much have the following experiences distressed or bothered you during the past month?</strong>",
        items: ITEMS,
        scale: SCALE,
      },
    ],
    evaluate,
    renderResult,
  };
})();
