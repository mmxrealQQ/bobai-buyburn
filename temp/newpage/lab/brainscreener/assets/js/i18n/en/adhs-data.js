// ADHD screening: ASRS v1.1 (WHO, 18 items) + a childhood scale based on the WURS-K (25 items, retrospective)
// Sources / references:
//  - Kessler RC et al. (2005), WHO Adult ADHD Self-Report Scale (ASRS) v1.1
//  - Retz-Junginger P et al. (2002), Wender Utah Rating Scale Kurzform (WURS-K)
//  - DSM-5-TR (APA, 2022), ICD-11 (WHO, 2022)
//
// Response scale 0..4 for the ASRS:  0=Never  1=Rarely  2=Sometimes  3=Often  4=Very often
// Response scale 0..4 for the WURS-K: 0=Does not apply  1=Mildly  2=Moderately  3=Clearly  4=Strongly

window.ADHS_DATA = (function () {

  const ASRS_LIKERT = [
    { v: 0, label: "Never" },
    { v: 1, label: "Rarely" },
    { v: 2, label: "Sometimes" },
    { v: 3, label: "Often" },
    { v: 4, label: "Very often" },
  ];

  const WURS_LIKERT = [
    { v: 0, label: "Does not apply" },
    { v: 1, label: "Mildly" },
    { v: 2, label: "Moderately" },
    { v: 3, label: "Clearly" },
    { v: 4, label: "Strongly" },
  ];

  // -------- ASRS v1.1, official English original (Kessler/WHO) ----------
  // dim: "I" = inattention, "H" = hyperactivity/impulsivity
  // partA = screening items (1..6). Official per-item cutoff (Kessler/WHO):
  //   Items 1,2,3: marked from "Sometimes" / "Often" / "Very often"  (threshold = 2)
  //   Items 4,5,6: marked from "Often" / "Very often"                (threshold = 3)
  // >=4 of 6 marked: highly consistent with ADHD in adults.
  const ASRS = [
    { id: "A1", partA: true, dim: "I", th: 2, text: "How often do you have trouble wrapping up the final details of a project, once the challenging parts have been done?" },
    { id: "A2", partA: true, dim: "I", th: 2, text: "How often do you have difficulty getting things in order when you have to do a task that requires organization?" },
    { id: "A3", partA: true, dim: "I", th: 2, text: "How often do you have problems remembering appointments or obligations?" },
    { id: "A4", partA: true, dim: "I", th: 3, text: "When you have a task that requires a lot of thought, how often do you avoid or delay getting started?" },
    { id: "A5", partA: true, dim: "H", th: 3, text: "How often do you fidget or squirm with your hands or feet when you have to sit down for a long time?" },
    { id: "A6", partA: true, dim: "H", th: 3, text: "How often do you feel overly active and compelled to do things, like you were driven by a motor?" },

    { id: "B7",  partA: false, dim: "I", text: "How often do you make careless mistakes when you have to work on a boring or difficult project?" },
    { id: "B8",  partA: false, dim: "I", text: "How often do you have difficulty keeping your attention when you are doing boring or repetitive work?" },
    { id: "B9",  partA: false, dim: "I", text: "How often do you have difficulty concentrating on what people say to you, even when they are speaking to you directly?" },
    { id: "B10", partA: false, dim: "I", text: "How often do you misplace or have difficulty finding things at home or at work?" },
    { id: "B11", partA: false, dim: "I", text: "How often are you distracted by activity or noise around you?" },
    { id: "B12", partA: false, dim: "H", text: "How often do you leave your seat in meetings or other situations in which you are expected to remain seated?" },
    { id: "B13", partA: false, dim: "H", text: "How often do you feel restless or fidgety?" },
    { id: "B14", partA: false, dim: "H", text: "How often do you have difficulty unwinding and relaxing when you have time to yourself?" },
    { id: "B15", partA: false, dim: "H", text: "How often do you find yourself talking too much when you are in social situations?" },
    { id: "B16", partA: false, dim: "H", text: "When you're in a conversation, how often do you find yourself finishing the sentences of the people you are talking to, before they can finish them themselves?" },
    { id: "B17", partA: false, dim: "H", text: "How often do you have difficulty waiting your turn in situations when turn taking is required?" },
    { id: "B18", partA: false, dim: "H", text: "How often do you interrupt others when they are busy?" },
  ];

  // -------- Childhood scale, 25 freely worded items BASED ON the WURS-K (Retz-Junginger et al. 2002) ----
  // Introductory sentence: "As a child (aged about 8 to 10), I was / I had ..."
  // Scoring: sum score 0..100; guide threshold >= 36, converted from the WURS-K cutoff, not validated for this version (see evaluate).
  const WURSK_INTRO = "As a child (aged between about 8 and 10 years), I was / I had ...";
  const WURSK = [
    { id: "W1",  text: "difficulty concentrating, easily distracted" },
    { id: "W2",  text: "anxious, full of worries" },
    { id: "W3",  text: "nervous, fidgety" },
    { id: "W4",  text: "inattentive, dreamy" },
    { id: "W5",  text: "hot-tempered, quick to flare up, with angry outbursts" },
    { id: "W6",  text: "a rather weak pupil / slow learner" },
    { id: "W7",  text: "disobedient, defiant towards adults" },
    { id: "W8",  text: "difficulty finishing tasks" },
    { id: "W9",  text: "inattentive at school, daydreaming" },
    { id: "W10", text: "cheerful, boisterous, excessively active" },
    { id: "W11", text: "easily irritated, easy to annoy" },
    { id: "W12", text: "sad or dissatisfied with myself" },
    { id: "W13", text: "impatient, easily frustrated" },
    { id: "W14", text: "tearful, quickly upset" },
    { id: "W15", text: "poorly adjusted, had difficulties at school" },
    { id: "W16", text: "headstrong, stubborn, hard to talk out of things" },
    { id: "W17", text: "low self-esteem, with self-doubt" },
    { id: "W18", text: "problems with authority figures (teachers, parents)" },
    { id: "W19", text: "problems understanding or following rules" },
    { id: "W20", text: "problems with other children, frequent conflicts" },
    { id: "W21", text: "clumsy, awkward" },
    { id: "W22", text: "impulsive, acted without thinking" },
    { id: "W23", text: "difficulty reading or spelling" },
    { id: "W24", text: "an outsider, had few friends" },
    { id: "W25", text: "moody, with rapid mood swings" },
  ];

  // ---------- Evaluation function ----------
  function evaluate(answers) {
    // answers: { id: 0..4 }
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : null);

    // ----- ASRS Part A: Markierung gem. Shaded-Zone-Logik -----
    const partAItems = ASRS.filter((i) => i.partA);
    let partAMarks = 0;
    const partADetails = partAItems.map((item) => {
      const a = get(item.id);
      const threshold = item.th;  // Items 1-3: th=2 (Manchmal); Items 4-6: th=3 (Oft)
      const marked = a !== null && a >= threshold;
      if (marked) partAMarks++;
      return { id: item.id, value: a, marked, threshold };
    });

    // ----- Summen-Scores ueber alle 18 ASRS-Items -----
    const inattItems = ASRS.filter((i) => i.dim === "I");
    const hypItems   = ASRS.filter((i) => i.dim === "H");
    const inattSum = inattItems.reduce((s, i) => s + (get(i.id) || 0), 0);
    const hypSum   = hypItems.reduce((s, i) => s + (get(i.id) || 0), 0);
    const asrsTotal = inattSum + hypSum;
    // Klinisch oft genannter Cutoff für Erwachsenen-ADHS (Adler et al., DuPaul Adult ADHD RS):
    //   Unaufmerksamkeit >= 17 von 36; Hyperaktivität/Impulsivität >= 17 von 36.
    const inattElevated = inattSum >= 17;
    const hypElevated   = hypSum >= 17;

    // ----- WURS-K Summenscore -----
    const wurskSum = WURSK.reduce((s, i) => s + (get(i.id) || 0), 0);
    const wurskMax = WURSK.length * 4; // = 100
    // The 25 childhood items are freely worded, BASED ON the WURS-K (Retz-Junginger 2002).
    // Original: 21 scored items (0..84) + 4 unscored control items, cutoff >= 30.
    // Here all 25 items count (0..100) — with the unchanged cutoff of 30 the scale fired too
    // early. The threshold is therefore converted proportionally: 30/84 * 100 = 35.7 -> >= 36.
    // A guide value, not validated separately for this item version (2026-09-20).
    const WURSK_CUTOFF = 36;
    const wurskElevated = wurskSum >= WURSK_CUTOFF;

    // ----- Gesamteinordnung -----
    // Konvention: Erwachsenen-ADHS-Hinweis erfordert (a) aktuelle Symptomatik UND (b) Hinweise auf Kindheit.
    const partAPositive = partAMarks >= 4;
    const overallFlag =
      partAPositive ? "high" :
      (inattElevated || hypElevated || wurskElevated) ? "moderate" : "low";

    return {
      asrs: {
        partAMarks, partAPositive, partADetails,
        inattSum, hypSum, total: asrsTotal,
        inattMax: inattItems.length * 4, hypMax: hypItems.length * 4,
        inattElevated, hypElevated,
      },
      wursk: {
        sum: wurskSum, max: wurskMax, elevated: wurskElevated, cutoff: WURSK_CUTOFF,
      },
      overall: { flag: overallFlag, partAPositive, retroPositive: wurskElevated },
    };
  }

  return {
    ASRS_LIKERT, WURS_LIKERT,
    ASRS, WURSK, WURSK_INTRO,
    evaluate,
    ui: {
      question: "Question",
      answersCount: (a, t) => `${a} / ${t} answered`,
      sectionLabels: { A: "Section 1 of 3 · ASRS Part A", B: "Section 2 of 3 · ASRS Part B", W: "Section 3 of 3 · Childhood" },
      resetConfirm: "Do you really want to delete all previous answers and start over?",
    },
  };
})();
