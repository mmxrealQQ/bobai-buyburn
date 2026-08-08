// IQ-Result Renderer (English version)
(function () {
  const RESULT_KEY = "brainscreener.iq.result.v1";

  let payload = window.BS_PRINT ? BS_PRINT.loadPayload(RESULT_KEY) : null;
  if (!payload) { try { payload = JSON.parse(sessionStorage.getItem(RESULT_KEY) || "null"); } catch { payload = null; } }

  if (!payload) {
    document.querySelector(".result-shell .container-narrow").innerHTML = `
      <div class="result-card">
        <h2>No result found</h2>
        <p>Please take the test first to obtain a report.</p>
        <p><a class="btn btn-primary" href="/brainscreener/iq.html">Go to the IQ test</a></p>
      </div>`;
    return;
  }

  const { ts, durationSec, probandCode } = payload;
  // Re-score the language-neutral answers in the language of this page
  // (allows printing the report in a different language).
  const result = (payload.answers && window.IQ_DATA && typeof window.IQ_DATA.evaluate === "function")
    ? window.IQ_DATA.evaluate(payload.answers)
    : payload.result;
  const LOCALE = document.documentElement.lang || "en-GB";
  const date = ts ? new Date(ts) : new Date();
  document.getElementById("dateStr").textContent =
    date.toLocaleDateString(LOCALE, { day: "2-digit", month: "long", year: "numeric" }) +
    " · " + date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

  const code = (probandCode || "").trim();
  if (code) {
    document.getElementById("codeRow").hidden = false;
    document.getElementById("codeStr").textContent = code;
  }

  // ---- Main IQ value ----
  document.getElementById("iqValue").textContent = result.iq;
  document.getElementById("bandLabel").textContent = result.band;
  document.getElementById("bandHint").textContent = bandHint(result.band);

  const ci = `95% confidence interval: ${result.ciLow}–${result.ciHigh}  ·  Percentile: ${result.percentile}  ·  Raw score: ${result.correct} / ${result.total}` +
    (durationSec ? `  ·  Completion time: ${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")} min` : "");
  document.getElementById("ciText").textContent = ci;

  // Gauge (IQ scale 60..145, normed)
  document.getElementById("gaugeWrap").innerHTML = iqGauge(result.iq);

  // Interpretation
  document.getElementById("interpretationText").innerHTML = `
    Your estimated IQ score of <strong>${result.iq}</strong> falls in the
    <strong>“${result.band}”</strong> range. Statistically, this corresponds to a percentile of
    <strong>${result.percentile}</strong> — i.e. about ${result.percentile}%
    of the general population obtain the same or a lower score.
    Taking the standard error of measurement into account, your “true” score lies
    with 95&nbsp;% probability between <strong>${result.ciLow}</strong> and
    <strong>${result.ciHigh}</strong>.
  `;

  // ---- Subscales / Domain Profile ----
  // Unter dieser Itemzahl ist ein Domaenenwert nicht interpretierbar
  const MIN_DOMAIN_ITEMS = 5;
  const domainNames = {
    Gf: "Fluid intelligence (matrix reasoning, logical reasoning)",
    Gq: "Quantitative reasoning (number series)",
    Gc: "Crystallized intelligence (verbal analogies)",
    Gv: "Visuospatial reasoning (position patterns)",
  };
  const subList = document.getElementById("subscaleList");
  const domains = Object.keys(result.byDomain).filter((k) => result.byDomain[k].total > 0);
  subList.innerHTML = domains.map((k) => {
    const d = result.byDomain[k];
    const pct = Math.round((d.right / d.total) * 100);
    return `
      <div class="subscale">
        <div class="subscale-head">
          <strong>${domainNames[k] || k}</strong>
          <span class="val">${d.right} / ${d.total} · ${pct} %</span>
        </div>
        <div class="subscale-bar"><div style="width:${pct}%;"></div></div>
        ${d.total < MIN_DOMAIN_ITEMS ? `<div class="note">Only ${d.total} items — not statistically meaningful on its own.</div>` : ""}
      </div>`;
  }).join("");

  // ---- Distribution chart ----
  document.getElementById("distributionWrap").innerHTML = distributionSVG(result.iq);

  // ---- Context ----
  document.getElementById("contextText").innerHTML = `
    Intelligence tests do <strong>not measure a person's worth</strong>, but a
    specific kind of cognitive performance at the present point in time. Your <strong>condition on the day</strong>
    (sleep, concentration, anxiety, medication) noticeably influences the result.
    A short online test with 40 items <strong>cannot replace</strong> a professional
    assessment (e.g. the WAIS-IV with 10–15 subtests), but it is well suited as a
    first orientation. <strong>Please discuss the result with a qualified professional</strong>
    (e.g. the physician or psychologist treating you), especially
    if the profile shows marked differences across the domains.
  `;

  // ---- Buttons ----
  if (window.BS_PRINT) BS_PRINT.attachPrint(document.getElementById("btnPrint"), RESULT_KEY);
  else document.getElementById("btnPrint").addEventListener("click", () => window.print());

  // ---- helpers ----
  function bandHint(band) {
    return {
      "Well below average": "Performance level clearly below the average of the general population in the area assessed.",
      "Below average": "Performance level in the range occupied by approx. 7–16% of the population.",
      "Low average": "Just below the average range.",
      "Average": "Middle range, in which about half of the population falls.",
      "High average": "Upper part of the average range, roughly the top 25%.",
      "Above average": "Clearly above-average level, roughly the top 9%.",
      "Well above average": "Very high level, above the 97th percentile (in the range of giftedness cut-offs).",
    }[band] || "";
  }

  function iqGauge(iq) {
    // Hoehe aus dem Bogen ableiten: 10 px Luft oben fuer die runde Strichkappe,
    // 36 px unten fuer die Skalenbeschriftung (sonst faellt sie aus der viewBox).
    const w = 360, r = 140, cx = w / 2, cy = r + 10, h = cy + 36;
    // IQ scale 55..145 (90 IQ points) on a semicircle
    const min = 55, max = 145;
    const value = Math.max(0, Math.min(1, (iq - min) / (max - min)));
    const start = Math.PI, end = 0;
    function arc(p) {
      const a = start + (end - start) * p;
      // In SVG zeigt +y nach unten, der Bogen liegt oben — daher cy MINUS sin.
      return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    }
    const [px, py] = arc(value);
    const color = iq < 85 ? "var(--danger)" : iq < 115 ? "var(--sage)" : "var(--gold)";
    // background arc
    return `
      <svg viewBox="0 0 ${w} ${h}" aria-hidden="true">
        <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="var(--line)" stroke-width="14" stroke-linecap="round"/>
        <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${px} ${py}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/>
        <circle cx="${px}" cy="${py}" r="10" fill="var(--ink)" />
        <text x="${cx}" y="${cy - 30}" text-anchor="middle" font-family="Space Grotesk, Inter, system-ui, sans-serif" font-size="42" fill="var(--ink)" font-weight="500">${iq}</text>
        <text x="${cx - r + 6}" y="${cy + 22}" font-size="11" fill="var(--ink-mute)">55</text>
        <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="var(--ink-mute)">100</text>
        <text x="${cx + r - 14}" y="${cy + 22}" font-size="11" fill="var(--ink-mute)">145</text>
      </svg>`;
  }

  function distributionSVG(iq) {
    // Bell curve, marker on the IQ
    const w = 720, h = 220, padL = 30, padR = 30, padT = 10, padB = 38;
    const minIQ = 55, maxIQ = 145;
    const xFor = (v) => padL + ((v - minIQ) / (maxIQ - minIQ)) * (w - padL - padR);
    const phi = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
    const yScale = (h - padT - padB) / phi(0);
    // build path
    let d = "";
    for (let v = minIQ; v <= maxIQ; v += 0.5) {
      const z = (v - 100) / 15;
      const x = xFor(v);
      const y = (h - padB) - phi(z) * yScale;
      d += (v === minIQ ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
    }
    // fill area
    const fillPath = `${d} L ${xFor(maxIQ)} ${h - padB} L ${xFor(minIQ)} ${h - padB} Z`;
    // marker
    const mx = xFor(iq);
    const myTop = (h - padB) - phi((iq - 100) / 15) * yScale;

    const ticks = [70, 85, 100, 115, 130];
    const tickHTML = ticks.map((t) => {
      const tx = xFor(t);
      return `
        <line x1="${tx}" y1="${h - padB}" x2="${tx}" y2="${h - padB + 4}" stroke="var(--ink-mute)" stroke-width="1"/>
        <text x="${tx}" y="${h - padB + 18}" text-anchor="middle" font-size="11" fill="var(--ink-soft)" font-family="Inter, system-ui, sans-serif">${t}</text>
      `;
    }).join("");

    const bands = [
      { from: 55,  to: 70,  label: "Well below avg.", color: "var(--gold-soft)" },
      { from: 70,  to: 85,  label: "Below avg.", color: "var(--gold-soft)" },
      { from: 85,  to: 115, label: "Average", color: "var(--sage-soft)" },
      { from: 115, to: 130, label: "Above avg.", color: "var(--gold-soft)" },
      { from: 130, to: 145, label: "Well above avg.", color: "var(--gold-soft)" },
    ];

    const bandRects = bands.map((b) => {
      const x1 = xFor(b.from), x2 = xFor(b.to);
      return `<rect x="${x1}" y="${padT}" width="${x2 - x1}" height="${h - padT - padB}" fill="${b.color}" fill-opacity="0.35"/>`;
    }).join("");

    return `
      <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; margin-top:12px;" role="img" aria-label="Normal distribution of IQ scores with the result marked">
        ${bandRects}
        <path d="${fillPath}" fill="var(--sage)" fill-opacity="0.35"/>
        <path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
        <line x1="${xFor(100)}" y1="${padT}" x2="${xFor(100)}" y2="${h - padB}" stroke="var(--ink-mute)" stroke-dasharray="3 4" stroke-width="1"/>
        <line x1="${mx}" y1="${myTop - 8}" x2="${mx}" y2="${h - padB}" stroke="var(--gold)" stroke-width="2.5"/>
        <circle cx="${mx}" cy="${myTop - 8}" r="7" fill="var(--gold)" stroke="var(--ink)" stroke-width="2"/>
        <text x="${mx}" y="${myTop - 18}" text-anchor="middle" font-family="Space Grotesk, Inter, system-ui, sans-serif" font-size="20" fill="var(--ink)" font-weight="500">IQ ${iq}</text>
        <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="var(--ink-mute)" stroke-width="1"/>
        ${tickHTML}
      </svg>`;
  }
})();
