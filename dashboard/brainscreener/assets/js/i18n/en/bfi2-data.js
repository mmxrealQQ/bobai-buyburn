// BFI-2 - Big Five Inventory-2 (60 items, full version)
// Sources:
//  - Soto CJ, John OP (2017). The next Big Five Inventory (BFI-2): Developing and
//    assessing a hierarchical model with 15 facets to enhance bandwidth, fidelity,
//    and predictive power. J Pers Soc Psychol 113(1): 117-143.
//  - Danner D, Rammstedt B, Bluemke M, Lechner C, Berres S, Knopf T, Soto CJ, John OP
//    (2019). Das Big Five Inventory 2 (BFI-2): Deutsche Adaptation. Diagnostica 65(3).
//  - Soto CJ, John OP (2024). The BFI-2: Updated psychometric properties and
//    cross-cultural evidence.
//
// 60 items, 5-point Likert. 5 domains of 12 items each, 15 facets of 4 items each.
// Domain norms (Danner et al. 2019, German general population, N>4,600):
//   E: M=3.32 SD=0.69 | A: M=3.57 SD=0.55 | C: M=3.62 SD=0.65
//   N: M=2.62 SD=0.79 | O: M=3.74 SD=0.62

window.TEST_DATA = (function () {
  const SCALE = { cols: 5, options: [
    { v: 1, label: "Disagree strongly" },
    { v: 2, label: "Disagree a little" },
    { v: 3, label: "Neutral; no opinion" },
    { v: 4, label: "Agree a little" },
    { v: 5, label: "Agree strongly" },
  ] };

  // d: Domain (E/A/C/N/O), f: Facet, r: reverse-coded
  const ITEMS = [
    { id: "B1",  d: "E", f: "sociability",     r: false, text: "I am someone who is outgoing, sociable." },
    { id: "B2",  d: "A", f: "compassion",      r: false, text: "I am someone who is compassionate, has a soft heart." },
    { id: "B3",  d: "C", f: "organization",    r: true,  text: "I am someone who tends to be disorganized." },
    { id: "B4",  d: "N", f: "anxiety",         r: true,  text: "I am someone who is relaxed, handles stress well." },
    { id: "B5",  d: "O", f: "aesthetic",       r: true,  text: "I am someone who has few artistic interests." },
    { id: "B6",  d: "E", f: "assertiveness",   r: false, text: "I am someone who has an assertive personality." },
    { id: "B7",  d: "A", f: "respectfulness", r: false, text: "I am someone who is respectful, treats others with respect." },
    { id: "B8",  d: "C", f: "productiveness", r: true,  text: "I am someone who tends to be lazy." },
    { id: "B9",  d: "N", f: "depression",      r: true,  text: "I am someone who stays optimistic after experiencing a setback." },
    { id: "B10", d: "O", f: "intellectual",   r: false, text: "I am someone who is curious about many different things." },
    { id: "B11", d: "E", f: "energy",          r: true,  text: "I am someone who rarely feels excited or eager." },
    { id: "B12", d: "A", f: "trust",           r: true,  text: "I am someone who tends to find fault with others." },
    { id: "B13", d: "C", f: "responsibility", r: false, text: "I am someone who is dependable, steady." },
    { id: "B14", d: "N", f: "volatility",      r: false, text: "I am someone who is moody, has up and down mood swings." },
    { id: "B15", d: "O", f: "creative",        r: false, text: "I am someone who is inventive, finds clever ways to do things." },
    { id: "B16", d: "E", f: "sociability",     r: true,  text: "I am someone who tends to be quiet." },
    { id: "B17", d: "A", f: "compassion",      r: true,  text: "I am someone who feels little sympathy for others." },
    { id: "B18", d: "C", f: "organization",    r: false, text: "I am someone who is systematic, likes to keep things in order." },
    { id: "B19", d: "N", f: "anxiety",         r: false, text: "I am someone who can be tense." },
    { id: "B20", d: "O", f: "aesthetic",       r: false, text: "I am someone who is fascinated by art, music, or literature." },
    { id: "B21", d: "E", f: "assertiveness",   r: false, text: "I am someone who is dominant, acts as a leader." },
    { id: "B22", d: "A", f: "respectfulness", r: true,  text: "I am someone who starts arguments with others." },
    { id: "B23", d: "C", f: "productiveness", r: true,  text: "I am someone who has difficulty getting started on tasks." },
    { id: "B24", d: "N", f: "depression",      r: true,  text: "I am someone who feels secure, comfortable with self." },
    { id: "B25", d: "O", f: "intellectual",   r: true,  text: "I am someone who avoids intellectual, philosophical discussions." },
    { id: "B26", d: "E", f: "energy",          r: true,  text: "I am someone who is less active than other people." },
    { id: "B27", d: "A", f: "trust",           r: false, text: "I am someone who has a forgiving nature." },
    { id: "B28", d: "C", f: "responsibility", r: true,  text: "I am someone who can be somewhat careless." },
    { id: "B29", d: "N", f: "volatility",      r: true,  text: "I am someone who is emotionally stable, not easily upset." },
    { id: "B30", d: "O", f: "creative",        r: true,  text: "I am someone who has little creativity." },
    { id: "B31", d: "E", f: "sociability",     r: true,  text: "I am someone who is sometimes shy, introverted." },
    { id: "B32", d: "A", f: "compassion",      r: false, text: "I am someone who is helpful and unselfish with others." },
    { id: "B33", d: "C", f: "organization",    r: false, text: "I am someone who keeps things neat and tidy." },
    { id: "B34", d: "N", f: "anxiety",         r: false, text: "I am someone who worries a lot." },
    { id: "B35", d: "O", f: "aesthetic",       r: false, text: "I am someone who values art and beauty." },
    { id: "B36", d: "E", f: "assertiveness",   r: true,  text: "I am someone who finds it hard to influence people." },
    { id: "B37", d: "A", f: "respectfulness", r: true,  text: "I am someone who is sometimes rude to others." },
    { id: "B38", d: "C", f: "productiveness", r: false, text: "I am someone who is efficient, gets things done." },
    { id: "B39", d: "N", f: "depression",      r: false, text: "I am someone who often feels sad." },
    { id: "B40", d: "O", f: "intellectual",   r: false, text: "I am someone who is complex, a deep thinker." },
    { id: "B41", d: "E", f: "energy",          r: false, text: "I am someone who is full of energy." },
    { id: "B42", d: "A", f: "trust",           r: true,  text: "I am someone who is suspicious of others' intentions." },
    { id: "B43", d: "C", f: "responsibility", r: false, text: "I am someone who is reliable, can always be counted on." },
    { id: "B44", d: "N", f: "volatility",      r: true,  text: "I am someone who keeps their emotions under control." },
    { id: "B45", d: "O", f: "creative",        r: true,  text: "I am someone who has difficulty imagining things." },
    { id: "B46", d: "E", f: "sociability",     r: false, text: "I am someone who is talkative." },
    { id: "B47", d: "A", f: "compassion",      r: true,  text: "I am someone who can be cold and uncaring." },
    { id: "B48", d: "C", f: "organization",    r: true,  text: "I am someone who leaves a mess, doesn't clean up." },
    { id: "B49", d: "N", f: "anxiety",         r: true,  text: "I am someone who rarely feels anxious or afraid." },
    { id: "B50", d: "O", f: "aesthetic",       r: true,  text: "I am someone who thinks poetry and plays are boring." },
    { id: "B51", d: "E", f: "assertiveness",   r: true,  text: "I am someone who prefers to have others take charge." },
    { id: "B52", d: "A", f: "respectfulness", r: false, text: "I am someone who is polite, courteous to others." },
    { id: "B53", d: "C", f: "productiveness", r: false, text: "I am someone who is persistent, works until the task is finished." },
    { id: "B54", d: "N", f: "depression",      r: false, text: "I am someone who tends to feel depressed, blue." },
    { id: "B55", d: "O", f: "intellectual",   r: true,  text: "I am someone who has little interest in abstract ideas." },
    { id: "B56", d: "E", f: "energy",          r: false, text: "I am someone who shows a lot of enthusiasm." },
    { id: "B57", d: "A", f: "trust",           r: false, text: "I am someone who assumes the best about people." },
    { id: "B58", d: "C", f: "responsibility", r: true,  text: "I am someone who sometimes behaves irresponsibly." },
    { id: "B59", d: "N", f: "volatility",      r: false, text: "I am someone who is temperamental, gets emotional easily." },
    { id: "B60", d: "O", f: "creative",        r: false, text: "I am someone who is original, comes up with new ideas." },
  ];

  const DOMAINS = {
    E: { name: "Extraversion",              short: "E", m: 3.32, sd: 0.69, color: "#C9A86B",
         high: "outgoing, energetic, dominant, socially active",
         low:  "reserved, quiet, more focused on a few close relationships" },
    A: { name: "Agreeableness",             short: "A", m: 3.57, sd: 0.55, color: "#A9B8A3",
         high: "warm-hearted, trusting, cooperative, willing to compromise",
         low:  "critical, direct, competitive, less willing to compromise" },
    C: { name: "Conscientiousness",         short: "C", m: 3.62, sd: 0.65, color: "#4FA3B8",
         high: "organized, goal-directed, disciplined, reliable",
         low:  "spontaneous, flexible, less structured, open-ended in approach" },
    N: { name: "Negative Emotionality",     short: "N", m: 2.62, sd: 0.79, color: "#B5564A",
         high: "emotionally sensitive, easily unsettled, prone to worry",
         low:  "emotionally stable, even-tempered, resilient to stress" },
    O: { name: "Open-Mindedness",           short: "O", m: 3.74, sd: 0.62, color: "#7F6FA8",
         high: "curious, creative, broadly interested, aesthetically sensitive",
         low:  "pragmatic, conventional, focused on familiar domains" },
  };

  const FACET_LABELS = {
    sociability: "Sociability", assertiveness: "Assertiveness", energy: "Energy Level",
    compassion: "Compassion", respectfulness: "Respectfulness", trust: "Trust",
    organization: "Organization", productiveness: "Productiveness", responsibility: "Responsibility",
    anxiety: "Anxiety", depression: "Depression", volatility: "Emotional Volatility",
    aesthetic: "Aesthetic Sensitivity", intellectual: "Intellectual Curiosity", creative: "Creative Imagination",
  };

  // Facet norms (US standard, Soto & John 2017, for approximate benchmarking)
  const FACET_NORMS = {
    sociability: 3.18, assertiveness: 3.21, energy: 3.45,
    compassion: 3.93, respectfulness: 3.97, trust: 3.28,
    organization: 3.30, productiveness: 3.46, responsibility: 4.04,
    anxiety: 3.04, depression: 2.55, volatility: 2.77,
    aesthetic: 3.30, intellectual: 3.79, creative: 3.68,
  };

  function evaluate(answers) {
    const get = (id) => (typeof answers[id] === "number" ? answers[id] : 3);
    const scoreItem = (it) => it.r ? (6 - get(it.id)) : get(it.id);

    const domains = {};
    for (const d of Object.keys(DOMAINS)) {
      const items = ITEMS.filter((i) => i.d === d);
      const sum = items.reduce((s, it) => s + scoreItem(it), 0);
      const mean = sum / items.length;
      const T = Math.round(50 + 10 * (mean - DOMAINS[d].m) / DOMAINS[d].sd);
      let level;
      if (T < 35) level = "very low";
      else if (T < 45) level = "low";
      else if (T < 56) level = "average";
      else if (T < 65) level = "high";
      else level = "very high";
      domains[d] = { mean, T, level };
    }

    const facets = {};
    for (const f of Object.keys(FACET_LABELS)) {
      const items = ITEMS.filter((i) => i.f === f);
      const sum = items.reduce((s, it) => s + scoreItem(it), 0);
      const mean = sum / items.length;
      const norm = FACET_NORMS[f];
      const diff = mean - norm;
      let level;
      if (diff < -0.8) level = "well below the norm";
      else if (diff < -0.3) level = "slightly below the norm";
      else if (diff < 0.3) level = "within the normal range";
      else if (diff < 0.8) level = "slightly above the norm";
      else level = "well above the norm";
      facets[f] = { mean, level, domain: items[0].d };
    }
    return { domains, facets };
  }

  function profileSVG(domains) {
    const labels = ["E","A","C","N","O"];
    const w = 380, h = 220, padX = 44, padY = 28, barH = 24, gap = 10;
    const barAreaW = w - padX * 2;
    const tToX = (t) => padX + Math.max(0, Math.min(1, (t - 20) / 60)) * barAreaW;

    const bars = labels.map((d, i) => {
      const y = padY + i * (barH + gap);
      const x = tToX(domains[d].T);
      const filled = x - padX;
      return `
        <g>
          <rect x="${padX}" y="${y}" width="${barAreaW}" height="${barH}" rx="3" fill="var(--bg-alt)"/>
          <line x1="${tToX(50)}" y1="${y - 3}" x2="${tToX(50)}" y2="${y + barH + 3}" stroke="var(--ink-mute)" stroke-width="1" stroke-dasharray="2,2"/>
          <rect x="${padX}" y="${y}" width="${filled}" height="${barH}" rx="3" fill="${DOMAINS[d].color}" opacity="0.85"/>
          <text x="${padX - 8}" y="${y + barH/2 + 4}" text-anchor="end" font-size="11" fill="var(--ink)" font-weight="600">${d}</text>
          <text x="${padX + barAreaW + 6}" y="${y + barH/2 + 4}" font-size="11" fill="var(--ink)" font-variant-numeric="tabular-nums">T=${domains[d].T}</text>
        </g>`;
    }).join("");

    return `
      <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Big Five personality profile">
        <text x="${padX}" y="16" font-size="10" fill="var(--ink-mute)">T-scores (M=50, SD=10) — dashed line: German population mean</text>
        ${bars}
        <text x="${padX}" y="${h - 6}" font-size="10" fill="var(--ink-mute)">20</text>
        <text x="${tToX(50) - 4}" y="${h - 6}" font-size="10" fill="var(--ink-mute)">50</text>
        <text x="${padX + barAreaW - 14}" y="${h - 6}" font-size="10" fill="var(--ink-mute)">80</text>
      </svg>`;
  }

  function renderResult(result) {
    const customSVG = profileSVG(result.domains);

    const interp = `
      Your <strong>BFI-2 profile</strong> shows your individual standing on the five domains
      and 15 facets of personality. The domain scores are expressed as <strong>T-scores</strong>
      (mean&nbsp;=&nbsp;50, standard&nbsp;deviation&nbsp;=&nbsp;10) relative to the German
      norm sample (Danner et al. 2019, N&nbsp;&gt;&nbsp;4,600). T-scores between 40
      and 60 correspond to the range covering about 68&nbsp;% of people; scores below 35
      or above 65 are statistically unusual. Trait levels are <em>not an indicator of pathology</em>
      — they describe enduring personality characteristics.
    `;

    // Domain subscales (with T-scores) + all 15 facets
    const domainSubs = Object.keys(DOMAINS).map((k) => {
      const v = result.domains[k];
      const isHigh = v.T >= 56;
      const note = `T = ${v.T} (mean ${v.mean.toFixed(2)} / 5). Level: <strong>${v.level}</strong>. ` +
                   (isHigh ? `Tends to be ${DOMAINS[k].high}.` : (v.T < 45 ? `Tends to be ${DOMAINS[k].low}.` : `Within the average range.`));
      return {
        label: `Domain · ${DOMAINS[k].name} (${DOMAINS[k].short})`,
        raw: v.T, max: 80, threshold: 50, thresholdLabel: "Norm mean",
        valueLabel: `T = ${v.T} · ${v.level}`,
        note,
      };
    });

    // Facets grouped by domain
    const facetSubs = [];
    for (const d of Object.keys(DOMAINS)) {
      const facetsInDomain = Object.keys(FACET_LABELS).filter(f => result.facets[f].domain === d);
      for (const f of facetsInDomain) {
        const v = result.facets[f];
        facetSubs.push({
          label: `Facet · ${FACET_LABELS[f]} (${DOMAINS[d].short})`,
          raw: Math.round(v.mean * 20), max: 100, threshold: Math.round(FACET_NORMS[f] * 20), thresholdLabel: "Norm mean",
          valueLabel: `M = ${v.mean.toFixed(2)} / 5 · ${v.level}`,
          note: `Population mean (US norm, Soto & John 2017): ${FACET_NORMS[f].toFixed(2)}.`,
        });
      }
    }

    const subscaleEntries = [...domainSubs, ...facetSubs];

    const context = `
      The <strong>Big Five Inventory-2 (BFI-2)</strong> is the scientifically current
      full-length instrument for the hierarchical assessment of personality within the Big Five model:
      five domains (Extraversion, Agreeableness, Conscientiousness, Negative Emotionality,
      Open-Mindedness) plus three <strong>facets</strong> per domain (15 in total). It supersedes the
      older NEO-FFI and BFI and is available open source (Soto & John, UC Berkeley). The
      German adaptation (Danner et al. 2019) shows very good internal consistencies
      (α 0.83–0.91 per domain, α 0.70–0.83 per facet) and is the scientific
      reference version in the German-speaking region. Big Five scores are relatively stable
      across the lifespan (correlation 0.6–0.8 over 10 years).
    `;

    const next = [];
    if (result.domains.N.T >= 65) {
      next.push("High Negative Emotionality (T ≥ 65) is associated with an elevated risk of stress, anxiety and depressive episodes. If you experience subjective distress, supplementary assessment with PHQ-9 / GAD-7 / WHODAS is advisable.");
    }
    if (result.facets.depression && result.facets.depression.mean >= 3.5) {
      next.push("The \"Depression\" facet is markedly elevated — although the BFI is not a diagnostic tool, an additional PHQ-9 assessment is worthwhile for gauging severity.");
    }
    next.push("Big Five profiles are well suited to career guidance, couples assessment and coaching — they help you use strengths more deliberately and anticipate sources of friction.");
    next.push("A single self-rating reflects your self-image — an outside perspective (e.g. a partner or supervisor) often yields a clearer overall picture (self-/other-rating correlation approx. 0.4–0.6).");
    next.push("Print this report as a PDF to compare your profile over time or discuss it with a professional.");

    const d = result.domains;
    return {
      title: "Your Big Five Personality Profile",
      sub: "A dimensional profile across five domains and 15 facets — not an indicator of pathology.",
      value: `${d.E.T}/${d.A.T}/${d.C.T}/${d.N.T}/${d.O.T}`,
      unit: "T-scores E/A/C/N/O",
      gauge: null,
      customGaugeHTML: customSVG,
      hideCrisis: true,
      flag: "low",
      interpretationHTML: interp,
      subscales: subscaleEntries,
      contextHTML: context,
      nextSteps: next,
    };
  }

  return {
    id: "bfi2",
    meta: {
      title: "BFI-2 · Personality Profile (Big Five, 60 items)",
      pageTitle: "BFI-2 — Personality · brainScreener",
      eyebrow: "Personality · Big Five",
      intro: `The <strong>Big Five Inventory-2 (BFI-2)</strong> is the scientifically current full-length instrument (Soto & John 2017) for the hierarchical assessment of personality — 5 domains plus 15 facets (3 per domain). 60 items, German validation by Danner et al. 2019. <em>Not a test of pathology</em>: the result describes your individual personality profile with a high level of differentiation.`,
      durationText: "approx. 10–14 minutes",
      itemsText: "60 items · 5 domains · 15 facets",
      sources: "Soto & John 2017 · Danner et al. (German version) 2019",
      testPath: "/brainscreener/bfi2",
      retestPath: "/brainscreener/bfi2",
      resultPath: "/brainscreener/bfi2-result",
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
        title: "BFI-2 · Self-Description",
        intro: "<strong>To what extent do you agree with the following statements about yourself?</strong> Please answer all items spontaneously.",
        items: ITEMS,
        scale: SCALE,
      },
    ],
    evaluate,
    renderResult,
  };
})();
