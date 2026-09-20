// ADHD result renderer (English version)
(function () {
  const RESULT_KEY = "brainscreener.adhs.result.v1";

  let payload = window.BS_PRINT ? BS_PRINT.loadPayload(RESULT_KEY) : null;
  if (!payload) { try { payload = JSON.parse(sessionStorage.getItem(RESULT_KEY) || "null"); } catch { payload = null; } }

  if (!payload) {
    document.querySelector(".result-shell .container-narrow").innerHTML = `
      <div class="result-card">
        <h2>No result found</h2>
        <p>Please take the test first to receive a report.</p>
        <p><a class="btn btn-primary" href="/brainscreener/adhd">Go to the ADHD test</a></p>
      </div>`;
    return;
  }

  const { ts, probandCode } = payload;
  // Re-evaluate the language-neutral answers in the language of this page
  // (allows printing the report in a different language).
  const result = (payload.answers && window.ADHS_DATA && typeof window.ADHS_DATA.evaluate === "function")
    ? window.ADHS_DATA.evaluate(payload.answers)
    : payload.result;
  const LOCALE = document.documentElement.lang || "en-CH";
  const date = ts ? new Date(ts) : new Date();
  document.getElementById("dateStr").textContent =
    date.toLocaleDateString(LOCALE, { day: "2-digit", month: "long", year: "numeric" }) +
    " · " + date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

  // Show the examination code if one was entered
  const code = (probandCode || "").trim();
  if (code) {
    document.getElementById("codeRow").hidden = false;
    document.getElementById("codeStr").textContent = code;
  }

  // ---- Overall classification ----
  const flag = result.overall.flag;
  const flagMap = {
    high: {
      title: "Markedly positive screening",
      sub: "The symptom pattern is consistent with attention-deficit/hyperactivity disorder in adulthood.",
      val: "High",
      gauge: 0.85,
      text: `On <strong>ASRS Part A</strong> you marked ${result.asrs.partAMarks} of 6 items within the diagnostically
relevant response range (cutoff: ≥4). Clinically, this counts as a <strong>strong indication</strong>
of adult ADHD: in the WHO validation study (Kessler et al. 2005) the six-item screener showed a very high
specificity (99.5&nbsp;%) at a sensitivity of about 69&nbsp;%. ${result.overall.retroPositive ? "The WURS-K additionally points to relevant childhood symptoms, which further supports this finding." : "The WURS-K scores are below the cutoff – retrospective recall is, however, prone to error; a specialist medical assessment remains indicated."}`,
    },
    moderate: {
      title: "Partially positive screening",
      sub: "There are indications of ADHD-typical symptoms, without the central cutoffs being fully reached.",
      val: "Moderate",
      gauge: 0.55,
      text: `Individual subscales lie within the clinically relevant range (inattention: ${result.asrs.inattSum}/${result.asrs.inattMax}; hyperactivity/impulsivity: ${result.asrs.hypSum}/${result.asrs.hypMax}; WURS-K: ${result.wursk.sum}/${result.wursk.max}). This level of symptoms may point to ADHD, but can also be caused by other factors (sleep deprivation, stress, other conditions). A specialist medical evaluation is recommended if the symptoms are burdensome in everyday life.`,
    },
    low: {
      title: "Unremarkable screening",
      sub: "The central cutoffs are not reached. There is no strong indication of adult ADHD.",
      val: "Low",
      gauge: 0.18,
      text: `Both on <strong>ASRS Part A</strong> (${result.asrs.partAMarks}/6 marked) and on the subscales
and the WURS-K (${result.wursk.sum}/${result.wursk.max}), the scores remain below the
established cutoffs. A screening cannot, however, capture every presentation of the disorder.
If you feel subjectively highly burdened, a specialist medical assessment may still be worthwhile.`,
    },
  };
  const cfg = flagMap[flag];
  document.getElementById("overallTitle").textContent = stripTags(cfg.title);
  document.getElementById("overallSubtitle").textContent = stripTags(cfg.sub);
  document.getElementById("overallValue").textContent = cfg.val;
  // "Probability" beside a constant "85%" read as an 85 % chance of having ADHD. It is a screening level.
  document.getElementById("overallUnit").textContent = "Screening level";
  document.getElementById("interpretationText").innerHTML = cfg.text;

  // Gauge
  document.getElementById("gaugeWrap").innerHTML = gaugeSVG(cfg.gauge, flag, cfg.val);
  // "Repeat test" starts a fresh test; it used to open the old form with every answer still ticked (2026-09-20).
  const btnRetryEl = document.getElementById("btnRetry");
  if (btnRetryEl) btnRetryEl.addEventListener("click", () => {
    try { ["answers","code"].forEach((k) => sessionStorage.removeItem("brainscreener.adhs." + k + ".v1")); } catch {}
  });


  // ---- Subscales ----
  const cutoff = result.wursk.cutoff || 36; // older stored results do not carry the field
  const subscales = [
    {
      label: "ASRS Part A · Screening items",
      raw: result.asrs.partAMarks, max: 6,
      threshold: 4,
      note: `${result.asrs.partAMarks} of 6 items within the diagnostically relevant range (cutoff ≥4). ${result.asrs.partAPositive ? "<strong>Cutoff reached.</strong>" : "Cutoff not reached."}`,
    },
    {
      label: "ASRS · Inattention",
      raw: result.asrs.inattSum, max: result.asrs.inattMax,
      threshold: 17,
      note: `Sum score: ${result.asrs.inattSum} / ${result.asrs.inattMax} (clinically relevant cutoff ≥17). ${result.asrs.inattElevated ? "<strong>Elevated.</strong>" : "Within the normal range."}`,
    },
    {
      label: "ASRS · Hyperactivity / impulsivity",
      raw: result.asrs.hypSum, max: result.asrs.hypMax,
      threshold: 17,
      note: `Sum score: ${result.asrs.hypSum} / ${result.asrs.hypMax} (clinically relevant cutoff ≥17). ${result.asrs.hypElevated ? "<strong>Elevated.</strong>" : "Within the normal range."}`,
    },
    {
      label: "Childhood scale (based on the WURS-K) · retrospective",
      raw: result.wursk.sum, max: result.wursk.max,
      threshold: cutoff,
      note: `Sum score: ${result.wursk.sum} / ${result.wursk.max} (guide threshold ≥&nbsp;${cutoff}: the WURS-K cutoff of 30 out of 84 points, converted proportionally to the 25 items scored here). ${result.wursk.elevated ? "<strong>Elevated.</strong>" : "Within the normal range."}`,
    },
  ];

  const subList = document.getElementById("subscaleList");
  subList.innerHTML = subscales.map((s) => {
    const pct = Math.min(100, Math.round((s.raw / s.max) * 100));
    const tPct = Math.min(100, Math.round((s.threshold / s.max) * 100));
    return `
      <div class="subscale">
        <div class="subscale-head">
          <strong>${s.label}</strong>
          <span class="val">${s.raw} / ${s.max}</span>
        </div>
        <div class="subscale-bar" style="position:relative;">
          <div style="width:${pct}%;"></div>
          <span style="position:absolute; left:${tPct}%; top:-3px; bottom:-3px; width:1.5px; background:var(--gold);" title="Cutoff"></span>
        </div>
        <div class="note">${s.note}</div>
      </div>
    `;
  }).join("");

  // ---- Context text ----
  document.getElementById("contextText").innerHTML = `
    The <strong>ASRS v1.1</strong> is a WHO instrument for the self-assessment of current
    ADHD symptoms in adults (reference period: 6 months). It is one of the
    best-validated brief instruments internationally. The <strong>WURS-K</strong>
    complements the picture with a retrospective assessment of childhood, since an
    ADHD diagnosis requires symptoms to have been present before the age of
    12&nbsp;years (DSM-5-TR Criterion B). The childhood items are freely worded, <strong>based on</strong> the
    WURS-K (Retz-Junginger et al. 2002); the threshold of ≥&nbsp;${cutoff} out of 100 is converted proportionally from the original
    cutoff (≥&nbsp;30 out of 84 points across 21 scored items) and has not been validated separately for this version.
  `;

  // ---- Next steps ----
  const ns = document.getElementById("nextSteps");
  const nextSteps = [];
  if (flag === "high" || flag === "moderate") {
    nextSteps.push("Discuss this result with a medical or psychological professional. The document can help structure the initial consultation or further diagnostic workup.");
    nextSteps.push("Write down concrete example situations from everyday life, work and your school years in which symptoms were burdensome — this helps in the clinical interview.");
    nextSteps.push("A confirmed diagnosis requires a structured clinical interview, a thorough history and the exclusion of differential-diagnostic causes (sleep, thyroid, affective disorders).");
    nextSteps.push("Print the report as a PDF and bring it to your next appointment.");
  } else {
    nextSteps.push("Nevertheless, discuss the result with your treating clinician if you were referred to this test.");
    nextSteps.push("If you feel subjectively burdened: other causes (e.&nbsp;g. sleep disorders, a depressive episode, an anxiety disorder) can produce similar symptoms and should be carefully evaluated.");
    nextSteps.push("Sleep, exercise and stress regulation form the foundation of cognitive performance.");
  }
  ns.innerHTML = nextSteps.map((s) => `<li style="margin-bottom:6px;">${s}</li>`).join("");

  // ---- Buttons ----
  if (window.BS_PRINT) BS_PRINT.attachPrint(document.getElementById("btnPrint"), RESULT_KEY);
  else document.getElementById("btnPrint").addEventListener("click", () => window.print());

  // ---- helpers ----
  function stripTags(s) { return s.replace(/<[^>]*>/g, ""); }

  function gaugeSVG(value /* 0..1 */, flag, label) {
    // Halbkreis-Gauge. Hoehe aus dem Bogen ableiten: 10 px Luft oben fuer die runde
    // Strichkappe, 36 px unten fuer die Skalenbeschriftung (sonst faellt sie aus der viewBox).
    const w = 360, r = 140, cx = w / 2, cy = r + 10, h = cy + 36;
    const start = Math.PI;
    const end = 0;
    const ang = start + (end - start) * value;
    const px = cx + r * Math.cos(ang);
    // In SVG zeigt +y nach unten, der Bogen liegt oben — daher cy MINUS sin.
    const py = cy - r * Math.sin(ang);
    const color = flag === "high" ? "var(--danger)" : flag === "moderate" ? "var(--gold)" : "var(--sage)";
    function arc(p) {
      const a = start + (end - start) * p;
      return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    }
    const [ax, ay] = arc(value);
    return `
      <svg viewBox="0 0 ${w} ${h}" aria-hidden="true">
        <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="var(--line)" stroke-width="14" stroke-linecap="round"/>
        <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ax} ${ay}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/>
        <circle cx="${px}" cy="${py}" r="10" fill="var(--ink)" />
        <text x="${cx}" y="${cy - 30}" text-anchor="middle" font-family="Space Grotesk, Inter, system-ui, sans-serif" font-size="36" fill="var(--ink)" font-weight="500">${String(label || "").replace(/[<>&]/g, "")}</text>
        <text x="${cx - r + 6}" y="${cy + 22}" font-size="11" fill="var(--ink-mute)">low</text>
        <text x="${cx + r - 30}" y="${cy + 22}" font-size="11" fill="var(--ink-mute)">high</text>
      </svg>`;
  }
})();
