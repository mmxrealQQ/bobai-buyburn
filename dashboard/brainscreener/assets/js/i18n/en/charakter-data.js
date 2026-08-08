// Character profile - Dark Tetrad (brainscreener, in-house instrument) — English version
// Model: four "dark" character traits as continuous, subclinical
// expressions of normal personality (everyone carries a bit of each).
//
// Dimensions (with clear, direct type names):
//   N - Narcissism        -> "The Narcissist"    (gold)
//   M - Machiavellianism  -> "The Manipulator"   (blue/teal)
//   P - Psychopathy       -> "The Psychopath"    (red)        [subclinical: fearlessness, impulsivity; also "sociopath"]
//   S - Sadism            -> "The Provocateur"   (anthracite) [everyday form: provocation, dark humour]
//
// Background / loosely based on (items are our own, freely worded):
//   - Paulhus & Williams (2002): The Dark Triad of Personality.
//   - Jones & Paulhus (2014): SD3 - Short Dark Triad.
//   - Jonason & Webster (2010): Dirty Dozen.
//   - Buckels, Jones & Paulhus (2013): Everyday Sadism.
//   - Moshagen, Hilbig & Zettler (2018): The Dark Core / D factor.
//
// IMPORTANT: This is NOT a clinical instrument and NOT a diagnosis. It is a
// judgement-free self-reflection profile of normal character tendencies.
//
// Response scale 1..5 (agreement). Reverse items are re-keyed in evaluate() (6 - raw value).

window.TEST_DATA = (function () {
  const SCALE = {
    cols: 5,
    options: [
      { v: 1, label: "Strongly disagree" },
      { v: 2, label: "Somewhat disagree" },
      { v: 3, label: "Neither agree nor disagree" },
      { v: 4, label: "Somewhat agree" },
      { v: 5, label: "Strongly agree" },
    ],
  };

  // Items deliberately MIXED (not grouped by dimension) to reduce response
  // tendencies. dim = dimension, reverse = reverse-keyed item.
  const ITEMS = [
    { id: "N1", dim: "N", text: "I like being the centre of attention and enjoy it when others notice me." },
    { id: "M1", dim: "M", text: "I plan my moves ahead in order to reach my goal." },
    { id: "P1", dim: "P", text: "In stressful or dangerous situations I stay remarkably calm." },
    { id: "S1", dim: "S", text: "I enjoy provocative arguments where the sparks really fly." },

    { id: "N2", dim: "N", text: "I know that I am better than most people at many things." },
    { id: "M2", dim: "M", text: "You should not reveal everything you know or plan to do." },
    { id: "P2", dim: "P", text: "I like taking risks that others prefer to avoid." },
    { id: "S2", dim: "S", text: "Dark humour and a bit of schadenfreude make me laugh." },

    { id: "N3", dim: "N", text: "I expect my achievements to be recognised and appreciated." },
    { id: "M3", dim: "M", text: "Anyone who really wants to get somewhere sometimes has to play tactics." },
    { id: "P3", dim: "P", text: "I live in the here and now and rarely dwell on consequences." },
    { id: "S3", dim: "S", text: "I enjoy needling people with cheeky remarks to see how they react." },

    { id: "N4", dim: "N", text: "Compliments and admiration noticeably do me good." },
    { id: "M4", dim: "M", text: "I am good at judging how to win people over." },
    { id: "P4", dim: "P", text: "Nervousness or anxiety are almost unknown to me." },
    { id: "S4", dim: "S", text: "I make sure people clearly feel it when they have done something wrong." },

    { id: "N5", dim: "N", text: "Deep down I feel destined for greater things." },
    { id: "M5", dim: "M", text: "It is wise to keep information back for the right moment." },
    { id: "P5", dim: "P", text: "I make decisions quickly and act immediately." },
    { id: "S5", dim: "S", text: "I actually find a bit of friction and confrontation appealing." },

    { id: "N6", dim: "N", reverse: true, text: "I do not like talking about my own successes." },
    { id: "M6", dim: "M", reverse: true, text: "I always lay all my cards on the table." },
    { id: "P6", dim: "P", reverse: true, text: "Before I act, I weigh the consequences carefully." },
    { id: "S6", dim: "S", reverse: true, text: "If someone feels uncomfortable, I back off immediately." },

    { id: "N7", dim: "N", text: "I find it hard to simply let criticism stand." },
    { id: "M7", dim: "M", text: "When in doubt, the result matters more than how you get there." },
    { id: "P7", dim: "P", text: "Routine and doing the same thing over and over bore me quickly." },
    { id: "S7", dim: "S", text: "Secretly I enjoy seeing someone who deserves it being shown up." },
  ];

  // ---------- Archetypes (content for the report) ----------
  const ARCHETYPES = {
    N: {
      key: "N", name: "The Narcissist", trait: "Narcissism", color: "#F0B90B",
      tagline: "You radiate self-confidence and enjoy the big stage.",
      desc: "The Narcissist believes in himself, wants to be seen and thrives on recognition. Behind the self-assurance there is often a fine sense of how one comes across — and a strong need for affirmation.",
      examples: [
        "You like steering conversations towards yourself and talk vividly about your successes.",
        "Praise and admiration give you a noticeable lift.",
        "You feel at ease in leadership or limelight roles.",
        "Criticism hits you harder than you admit on the outside.",
      ],
      strengths: [
        "Charisma and self-confidence that carry others along.",
        "The courage to show yourself and take on responsibility.",
        "Infectious enthusiasm — you can win people over to a cause.",
      ],
      tips: [
        "Practise active listening: ask three questions before you talk about yourself.",
        "Share the stage — praise you pass on comes back amplified.",
        "Build self-worth from within (your own values, your own standards), independent of applause.",
        "Seek honest feedback and sit with the first impulse to defend yourself.",
      ],
    },
    M: {
      key: "M", name: "The Manipulator", trait: "Machiavellianism", color: "#4FA3B8",
      tagline: "You pull the strings in the background and keep a cool overview.",
      desc: "The Manipulator acts with foresight, calculation and considerable insight into people. He does not reveal everything and deploys others precisely where they are useful to him — a strength that can, however, cost trust in relationships.",
      examples: [
        "You plan several steps ahead and keep your goal in sight.",
        "You do not reveal everything you know or intend.",
        "In negotiations you stay calm and matter-of-fact.",
        "You quickly size up how to win people over.",
      ],
      strengths: [
        "Overview, planning and a cool head in a crisis.",
        "Negotiating skill and a feel for group dynamics.",
        "You rarely get side-tracked — the goal stays in focus.",
      ],
      tips: [
        "Deliberately risk transparency where trust matters more than an advantage.",
        "Maintain a few relationships entirely without ulterior motives — simply because they do you good.",
        "See extending trust as an investment, not a risk.",
        "Ask yourself: am I serving only the outcome right now — or also the person in front of me?",
      ],
    },
    P: {
      key: "P", name: "The Psychopath", trait: "Psychopathy / sociopathy", color: "#ff5a4f",
      tagline: "You stay ice-cold where others hesitate — fear and remorse are foreign to you.",
      desc: "The Psychopath is fearless, cool and decisive. He lives in the moment, seeks the thrill and is hardly slowed down by guilt. <strong>What is meant here is a normal, subclinical character tendency</strong> (courage, low anxiety, impulsivity, little emotional resonance) — expressly <strong>not</strong> a clinical diagnosis.",
      examples: [
        "When others panic, you stay calm and able to act.",
        "You take risks that others find too daring.",
        "You decide fast and execute immediately.",
        "Routine and repetition bore you quickly.",
      ],
      strengths: [
        "Courage and strong nerves, especially under pressure.",
        "Decisiveness — you act while others are still hesitating.",
        "A composure that calms the people around you too.",
      ],
      tips: [
        "Sleep on big decisions for a night — give the consequences time.",
        "Before risky moves, briefly run through the worst-case scenario.",
        "Channel the craving for thrills deliberately (sport, projects) instead of suppressing it.",
        "Ask a trusted person for an outside view before you charge ahead.",
      ],
    },
    S: {
      key: "S", name: "The Provocateur", trait: "Sadism (everyday form)", color: "#9aa0b5",
      tagline: "You can dish it out — friction, dark humour and schadenfreude appeal to you.",
      desc: "The Provocateur likes to stir things up and can seriously dish it out: pointed remarks, dark humour, a certain pleasure in watching others squirm. <strong>This ranges from harmless teasing to making people distinctly feel that they have done something wrong.</strong> What is meant is the everyday form — not the infliction of real suffering. This is exactly where mindfulness pays off, because the line between teasing and demeaning is thin.",
      examples: [
        "You enjoy heated arguments where things really get going.",
        "Dark humour and a little schadenfreude — you cannot suppress a grin.",
        "You make people distinctly feel it when they have done something wrong — sometimes more than once.",
        "Sharp, quick-witted comments come to you easily.",
      ],
      strengths: [
        "Directness and quick wit — you say out loud what others do not dare to.",
        "You can withstand tension and conflict instead of dodging them.",
        "Breaking taboos as a source of humour and creativity.",
      ],
      tips: [
        "Watch for the point where teasing turns into putting someone down — constant criticism wears people down more than you think.",
        "Rule of thumb: someone who hears a hundred times that they do everything wrong will eventually believe it. Praise about three times as often as you criticise.",
        "Separate criticism of the issue (helps) from criticism of the person (hurts) — criticise the behaviour, not the human being.",
        "Before a jab, ask yourself: do I want to help right now — or to wound?",
        "Channel the appetite for friction into debate, sport, gaming or art.",
      ],
    },
  };

  const DIMS = ["N", "M", "P", "S"];

  // ---------- Scoring ----------
  function evaluate(answers) {
    const raw = (id) => (typeof answers[id] === "number" ? answers[id] : 3);
    const itemScore = (it) => {
      const v = raw(it.id);
      return it.reverse ? (6 - v) : v;
    };

    const scores = {};
    DIMS.forEach((d) => {
      const items = ITEMS.filter((it) => it.dim === d);
      const sum = items.reduce((s, it) => s + itemScore(it), 0);
      const n = items.length;
      const min = n * 1, max = n * 5;
      const pct = Math.round(((sum - min) / (max - min)) * 100);
      const mean = Math.round((sum / n) * 100) / 100;
      scores[d] = { raw: sum, n, min, max, pct, mean };
    });

    // Order by strength (descending); ties broken by fixed dimension order
    const order = [...DIMS].sort((a, b) => {
      if (scores[b].pct !== scores[a].pct) return scores[b].pct - scores[a].pct;
      return DIMS.indexOf(a) - DIMS.indexOf(b);
    });

    const spread = scores[order[0]].pct - scores[order[order.length - 1]].pct;

    return {
      scores,
      order,
      dominant: order[0],
      spread,
      balanced: spread <= 12,
    };
  }

  return {
    id: "charakter",
    archetypes: ARCHETYPES,
    dims: DIMS,
    meta: {
      title: "Character profile · Dark Tetrad",
      pageTitle: "Character profile — Dark Tetrad · brainScreener",
      eyebrow: "Personality · Dark character traits",
      intro: `This instrument draws your personal <strong>character profile</strong> along the four scientifically described "dark" character traits — the <strong>Dark Tetrad</strong>. Everyone carries a bit of all four; the test shows which trait stands out most in you. <strong>There is no "good" or "bad"</strong> — for each trait you receive strengths, typical behaviours and concrete tips. And we do not talk around it: the four types are called what they are called — <strong>plain language instead of sugar-coating</strong>. It is expressly not a judgement of you as a person.`,
      durationText: "approx. 6–8 minutes",
      itemsText: "28 statements · 4 dimensions",
      sources: "Dark Tetrad · based on Paulhus & Williams 2002, Jones & Paulhus 2014 (SD3), Buckels et al. 2013",
      testPath: "/brainscreener/character.html",
      retestPath: "/brainscreener/character.html",
      resultPath: "/brainscreener/character-result.html",
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
    resultUi: {
      balancedTrait: "Balanced profile",
      balancedName: "A balanced mix",
      balancedIntro: "Your profile is remarkably <strong>balanced</strong> — no single trait clearly stands out. Depending on the situation, you show different sides of yourself. You will probably recognise yourself in several of the types below.",
      domIntro: (dom, domPct, sec, secPct) =>
        `Everyone carries something of all four traits — what shows most strongly in you is <strong>${dom.name}</strong> (${domPct}&nbsp;%). ${dom.tagline} ` +
        `The runner-up is <strong>${sec.name}</strong> (${secPct}&nbsp;%). ` +
        `This does not mean that you "are like that" — it only shows which tendency shines through most in you.`,
      badgeTop: "stands out",
      badgeDominant: "Your strongest trait",
      colExamples: "How it shows in everyday life",
      colStrengths: "Strengths",
      colTips: "Tips &amp; what you can work on",
      wheelBalanced: "balanced",
      wheelDominant: "strongest trait",
    },
    sections: [
      {
        id: "main",
        title: "Your character profile · 28 statements",
        intro: "<strong>How much does each statement apply to you?</strong> Answer spontaneously and honestly — there are no right or wrong answers.",
        items: ITEMS,
        scale: SCALE,
      },
    ],
    evaluate,
  };
})();
