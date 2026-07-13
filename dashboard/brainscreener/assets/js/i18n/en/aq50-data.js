// AQ-50 - Autism-Spectrum Quotient (full version, 50 items)
// Sources:
//  - Baron-Cohen S, Wheelwright S, Skinner R, Martin J, Clubley E (2001).
//    The Autism-Spectrum Quotient (AQ): Evidence from Asperger Syndrome/High-Functioning
//    Autism, Males and Females, Scientists and Mathematicians.
//    J Autism Dev Disord 31(1):5-17.
//  - Woodbury-Smith MR, Robinson J, Wheelwright S, Baron-Cohen S (2005).
//    Screening adults for Asperger syndrome using the AQ: a preliminary study of
//    its diagnostic validity in clinical practice. J Autism Dev Disord 35(3):331-5.
//  - Freitag CM, Retz-Junginger P, Retz W et al. (2007). Untersuchung der deutschen
//    Version des Autism-Spektrum-Quotienten (AQ) bei Erwachsenen. Diagnostica 53.
//
// 50 items, 4-point scale (definitely agree / slightly agree / slightly disagree /
// definitely disagree). Scoring: 1 point for "agree" on non-reversed items and
// "disagree" on reversed items. Total 0..50.
// Cutoffs:
//   >= 32  Baron-Cohen 2001 - clinically relevant (sens 79%, spec 98% for AS/HFA).
//   >= 26  Woodbury-Smith 2005 - more sensitive cutoff for outpatient practice.
// 5 subscales of 10 items each: social, switching, detail, communication, imagination.

window.TEST_DATA = (function () {
  const SCALE = { cols: 4, options: [
    { v: 3, label: "Definitely agree" },
    { v: 2, label: "Slightly agree" },
    { v: 1, label: "Slightly disagree" },
    { v: 0, label: "Definitely disagree" },
  ] };

  // s: subscale, r: reverse-coded
  const ITEMS = [
    { id: "Q1",  s: "social",        r: true,  text: "I prefer to do things with others rather than on my own." },
    { id: "Q2",  s: "switching",     r: false, text: "I prefer to do things the same way over and over again." },
    { id: "Q3",  s: "imagination",   r: true,  text: "If I try to imagine something, I find it very easy to create a picture in my mind." },
    { id: "Q4",  s: "switching",     r: false, text: "I frequently get so strongly absorbed in one thing that I lose sight of other things." },
    { id: "Q5",  s: "detail",        r: false, text: "I often notice small sounds when others do not." },
    { id: "Q6",  s: "detail",        r: false, text: "I usually notice car number plates or similar strings of information." },
    { id: "Q7",  s: "communication", r: false, text: "Other people frequently tell me that what I've said is impolite, even though I think it is polite." },
    { id: "Q8",  s: "imagination",   r: true,  text: "When I'm reading a story, I can easily imagine what the characters might look like." },
    { id: "Q9",  s: "detail",        r: false, text: "I am fascinated by dates." },
    { id: "Q10", s: "switching",     r: true,  text: "In a social group, I can easily keep track of several different people's conversations." },
    { id: "Q11", s: "social",        r: true,  text: "I find social situations easy." },
    { id: "Q12", s: "detail",        r: false, text: "I tend to notice details that others do not." },
    { id: "Q13", s: "social",        r: false, text: "I would rather go to a library than a party." },
    { id: "Q14", s: "imagination",   r: true,  text: "I find making up stories easy." },
    { id: "Q15", s: "social",        r: true,  text: "I find myself drawn more strongly to people than to things." },
    { id: "Q16", s: "switching",     r: false, text: "I tend to have very strong interests, which I get upset about if I can't pursue." },
    { id: "Q17", s: "communication", r: true,  text: "I enjoy social chit-chat." },
    { id: "Q18", s: "communication", r: false, text: "When I talk, it isn't always easy for others to get a word in edgeways." },
    { id: "Q19", s: "detail",        r: false, text: "I am fascinated by numbers." },
    { id: "Q20", s: "imagination",   r: false, text: "When I'm reading a story, I find it difficult to work out the characters' intentions." },
    { id: "Q21", s: "imagination",   r: false, text: "I don't particularly enjoy reading fiction." },
    { id: "Q22", s: "social",        r: false, text: "I find it hard to make new friends." },
    { id: "Q23", s: "detail",        r: false, text: "I notice patterns in things all the time." },
    { id: "Q24", s: "imagination",   r: true,  text: "I would rather go to the theatre than a museum." },
    { id: "Q25", s: "switching",     r: true,  text: "It does not upset me if my daily routine is disturbed." },
    { id: "Q26", s: "communication", r: false, text: "I frequently find that I don't know how to keep a conversation going." },
    { id: "Q27", s: "communication", r: true,  text: "I find it easy to \"read between the lines\" when someone is talking to me." },
    { id: "Q28", s: "detail",        r: true,  text: "I usually concentrate more on the whole picture, rather than the small details." },
    { id: "Q29", s: "detail",        r: true,  text: "I am not very good at remembering phone numbers." },
    { id: "Q30", s: "detail",        r: true,  text: "I don't usually notice small changes in a situation, or a person's appearance." },
    { id: "Q31", s: "communication", r: true,  text: "I know how to tell if someone listening to me is getting bored." },
    { id: "Q32", s: "switching",     r: true,  text: "I find it easy to do more than one thing at once." },
    { id: "Q33", s: "communication", r: false, text: "When I talk on the phone, I'm not sure when it's my turn to speak." },
    { id: "Q34", s: "switching",     r: true,  text: "I enjoy doing things spontaneously." },
    { id: "Q35", s: "communication", r: false, text: "I am often the last to understand the point of a joke." },
    { id: "Q36", s: "social",        r: true,  text: "I find it easy to work out what someone is thinking or feeling just by looking at their face." },
    { id: "Q37", s: "switching",     r: true,  text: "If there is an interruption, I can switch back to what I was doing very quickly." },
    { id: "Q38", s: "communication", r: true,  text: "I am good at social chit-chat." },
    { id: "Q39", s: "communication", r: false, text: "People often tell me that I keep going on and on about the same thing." },
    { id: "Q40", s: "imagination",   r: true,  text: "When I was young, I used to enjoy playing games involving pretending with other children." },
    { id: "Q41", s: "imagination",   r: false, text: "I like to collect information about categories of things (e.g. types of car, types of bird, types of train, types of plant, etc.)." },
    { id: "Q42", s: "imagination",   r: false, text: "I find it difficult to imagine what it would be like to be someone else." },
    { id: "Q43", s: "switching",     r: false, text: "I like to plan any activities I participate in carefully." },
    { id: "Q44", s: "social",        r: true,  text: "I enjoy social occasions." },
    { id: "Q45", s: "social",        r: false, text: "I find it difficult to work out people's intentions." },
    { id: "Q46", s: "switching",     r: false, text: "New situations make me anxious." },
    { id: "Q47", s: "social",        r: true,  text: "I enjoy meeting new people." },
    { id: "Q48", s: "social",        r: true,  text: "I am a good diplomat." },
    { id: "Q49", s: "detail",        r: true,  text: "I am not very good at remembering people's date of birth." },
    { id: "Q50", s: "imagination",   r: true,  text: "I find it very easy to play games with children that involve pretending." },
  ];

  const SUB_LABELS = {
    social:        "Social skill",
    switching:     "Attention switching",
    detail:        "Attention to detail",
    communication: "Communication",
    imagination:   "Imagination",
  };

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 0);
    let total = 0;
    const subs = { social: 0, switching: 0, detail: 0, communication: 0, imagination: 0 };
    for (const it of ITEMS) {
      const v = get(it.id);
      const counted = it.r ? (v <= 1) : (v >= 2);
      if (counted) { total++; subs[it.s]++; }
    }
    const cutoffStrict = total >= 32;
    const cutoffSensitive = total >= 26;

    // Bands based on established cutoffs: >=32 clinical (Baron-Cohen 2001),
    // 26-31 borderline elevated (Woodbury-Smith 2005), below that unremarkable.
    // The population mean is around ~16-17 — scores in that range are
    // normal and are NOT reported as "elevated".
    let flag;
    if (cutoffStrict) flag = "high";
    else if (cutoffSensitive) flag = "moderate";
    else flag = "low";

    return { total, max: 50, subs, cutoffStrict, cutoffSensitive, flag };
  }

  function renderResult(result) {
    const titleMap = {
      low: "Unremarkable AQ-50 screening",
      moderate: "Elevated autistic trait expression",
      high: "Consistent with an autistic phenotype",
    };
    const subMap = {
      low: "Scores within the range of the neurotypical general population.",
      moderate: "Scores are above the population average — a specialist assessment may be worthwhile.",
      high: "Profile consistent with an autism spectrum condition; specialist diagnostic assessment is recommended.",
    };

    const interp = `
      Your <strong>AQ-50 total score</strong> is <strong>${result.total}/50 points</strong>.
      For comparison: in the original validation study (Baron-Cohen 2001), the mean of the
      neurotypical comparison group was <strong>16.4</strong>, while adults with
      Asperger syndrome/high-functioning autism averaged <strong>35.8</strong>.
      ${result.cutoffStrict
        ? `The strict cutoff of ≥&nbsp;32 (Baron-Cohen 2001) is met — sensitivity approx.&nbsp;79&nbsp;%, specificity approx.&nbsp;98&nbsp;%.`
        : (result.cutoffSensitive
            ? `The more sensitive cutoff of ≥&nbsp;26 (Woodbury-Smith et al. 2005) is met; the strict cutoff (≥&nbsp;32) is not met.`
            : `Neither of the established cutoffs (≥&nbsp;26 sensitive, ≥&nbsp;32 specific) is met.`)}
      The five subscales below show the functional domains in which autistic traits
      are most pronounced in your profile.
    `;

    const subscaleEntries = [
      { label: "AQ-50 total score", raw: result.total, max: 50, threshold: 32,
        note: `Strict cutoff: ≥&nbsp;32. ${result.cutoffStrict ? "<strong>Met.</strong>" : (result.cutoffSensitive ? "More sensitive cutoff (≥&nbsp;26) met." : "Not met.")}` },
      ...Object.keys(SUB_LABELS).map((k) => ({
        label: `Subscale · ${SUB_LABELS[k]}`,
        raw: result.subs[k], max: 10, threshold: 6,
        note: `${result.subs[k]} of 10 items answered in the autistic direction.${result.subs[k] >= 6 ? " <strong>Markedly pronounced.</strong>" : ""}`,
      })),
    ];

    const context = `
      The <strong>Autism Spectrum Quotient (AQ-50)</strong> is the original version by
      Baron-Cohen et al. (2001) and the most widely used self-report measure worldwide
      for autistic traits in adults of normal intelligence. It provides
      subscale profiles across five functional domains (social skill, attention switching,
      attention to detail, communication, imagination). A confirmed
      ASD diagnosis requires a developmental history (e.g. ADI-R)
      as well as standardised behavioural observation (e.g. ADOS-2). The German version
      was validated by Freitag, Retz-Junginger and Retz (2007).
    `;

    const next = [];
    if (result.flag === "high") {
      next.push("Arrange an appointment at a practice or specialist outpatient clinic focusing on adult autism spectrum diagnostics.");
      next.push("A complete diagnostic work-up includes a developmental history (ideally with a caregiver who knew you in childhood), standardised behavioural observation (ADOS-2, module 4) and differential diagnostics (ADHD, social phobia, schizoid personality disorder, attachment disorder).");
      next.push("Even with a clear self-identification as \"autistic\", a professional diagnosis is helpful — it opens access to therapy, counselling and, where applicable, social benefits, and allows a differentiated distinction from comorbidities.");
    } else if (result.flag === "moderate") {
      next.push("The score indicates an above-average expression of autistic traits. If you experience subjective distress or impairment in daily life, a specialist assessment is worthwhile.");
      next.push("Additional specific instruments can sharpen the diagnostic picture: RAADS-R (80 items, more sensitive in women who camouflage), EQ/SQ (Empathy/Systemising), or ADOS-2.");
    } else {
      next.push("Your scores lie within the neurotypical range. If you nonetheless experience yourself as \"different\" in many areas of life, a longer instrument such as the RAADS-R may provide further insight.");
    }
    next.push("Print this report as a PDF and bring it along to your next appointment.");

    return {
      title: titleMap[result.flag],
      sub: subMap[result.flag],
      value: result.total,
      unit: `/ 50 points`,
      gauge: result.total / 50,
      flag: result.flag,
      interpretationHTML: interp,
      subscales: subscaleEntries,
      contextHTML: context,
      nextSteps: next,
    };
  }

  return {
    id: "aq50",
    meta: {
      title: "AQ-50 · Autism Spectrum (Adults)",
      pageTitle: "AQ-50 — Autism Screening · brainScreener",
      eyebrow: "Autism spectrum",
      intro: `The <strong>Autism Spectrum Quotient (AQ-50)</strong> is the original version by Baron-Cohen et al. (2001) — the most widely used international self-report measure for autistic traits in adults of normal intelligence. 50 items across five subscales. It provides a differentiated functional profile; the definitive diagnosis is made by specialised professionals using ADOS-2 / ADI-R.`,
      durationText: "approx. 8–12 minutes",
      itemsText: "50 items · 5 subscales",
      sources: "Baron-Cohen et al. 2001 · Woodbury-Smith et al. 2005 · Freitag et al. (dt.) 2007",
      testPath: "/brainscreener/aq50.html",
      retestPath: "/brainscreener/aq50.html",
      resultPath: "/brainscreener/aq50-result.html",
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
        title: "AQ-50 · Self-assessment",
        intro: "<strong>How strongly do you agree with the following statements about yourself?</strong>",
        items: ITEMS,
        scale: SCALE,
      },
    ],
    evaluate,
    renderResult,
  };
})();
