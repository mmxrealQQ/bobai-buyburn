// Generische Result-Engine fuer alle brainscreener-Tests (ausser ADHS/IQ-Legacy).
// Erwartet:
//  - window.TEST_DATA mit { id, meta:{title, sources, testPath, retestPath?}, renderResult(result,payload) }
//  - sessionStorage[`brainscreener.<id>.result.v1`] mit { result, answers, probandCode, ts, testId }
// Pflicht-DOM (siehe template result.html):
//  #dateStr, #codeRow, #codeStr, #overallTitle, #overallSubtitle, #overallValue, #overallUnit,
//  #interpretationText, #gaugeWrap, #subscaleList, #contextText, #nextSteps, #btnPrint,
//  #verfahrensRef (optional), #resultTitle, #resultEyebrow

(function () {
  const D = window.TEST_DATA;
  if (!D) { console.error("[result-engine] TEST_DATA fehlt"); return; }

  // UI-Strings: deutsche Defaults, übersetzte Datendateien liefern D.ui mit.
  const UI = Object.assign({
    locale: document.documentElement.lang || "de-CH",
    evalLabel: "Auswertung",
    noResultTitle: "Kein Ergebnis gefunden",
    noResultText: "Bitte starten Sie den Test, um eine Auswertung zu erhalten.",
    toTest: "Zum Test",
    gaugeLow: "niedrig",
    gaugeHigh: "hoch",
  }, D.ui || {});

  const RESULT_KEY = `brainscreener.${D.id}.result.v1`;
  let payload = window.BS_PRINT ? BS_PRINT.loadPayload(RESULT_KEY) : null;
  if (!payload) { try { payload = JSON.parse(sessionStorage.getItem(RESULT_KEY) || "null"); } catch {} }

  const root = document.querySelector(".result-shell .container-narrow");
  if (!root) { console.error("[result-engine] .result-shell .container-narrow fehlt"); return; }

  if (!payload) {
    root.innerHTML = `
      <div class="result-card">
        <h2>${UI.noResultTitle}</h2>
        <p>${UI.noResultText}</p>
        <p><a class="btn btn-primary" href="${D.meta.testPath}">${UI.toTest}</a></p>
      </div>`;
    return;
  }

  const { ts, probandCode } = payload;
  // Ergebnis aus den (sprachneutralen) Antworten in der Sprache DIESER Seite neu
  // berechnen — so kann ein Test z. B. auf Französisch ausgefüllt und auf Deutsch
  // gedruckt werden. Fallback: gespeichertes Ergebnis (ältere Sessions).
  const result = (payload.answers && typeof D.evaluate === "function")
    ? D.evaluate(payload.answers)
    : payload.result;
  const r = D.renderResult(result, payload);

  // --- Header / Datum / Code ---
  const date = ts ? new Date(ts) : new Date();
  const dateStr = date.toLocaleDateString(UI.locale, { day: "2-digit", month: "long", year: "numeric" }) +
                  " · " + date.toLocaleTimeString(UI.locale, { hour: "2-digit", minute: "2-digit" });
  setText("dateStr", dateStr);

  const code = (probandCode || "").trim();
  if (code) {
    const row = document.getElementById("codeRow");
    if (row) row.hidden = false;
    setText("codeStr", code);
  }

  // --- Title / Eyebrow ---
  if (D.meta.pageTitle) document.title = D.meta.pageTitle;
  setText("resultTitle", D.meta.title);
  setText("resultEyebrow", UI.evalLabel);
  setText("verfahrensRef", D.meta.sources);

  // --- Overall ---
  setText("overallTitle", r.title);
  setText("overallSubtitle", r.sub);
  setText("overallValue", r.value);
  setText("overallUnit", r.unit);
  setHTML("interpretationText", r.interpretationHTML);

  // --- Gauge (oder benutzerdefiniertes SVG) ---
  const gaugeWrap = document.getElementById("gaugeWrap");
  if (gaugeWrap) {
    if (r.customGaugeHTML) {
      gaugeWrap.innerHTML = r.customGaugeHTML;
      gaugeWrap.classList.add("gauge-custom");
    } else if (r.gauge != null) {
      gaugeWrap.innerHTML = gaugeSVG(r.gauge, r.flag);
    } else {
      gaugeWrap.innerHTML = "";
      gaugeWrap.hidden = true;
    }
  }
  // Krisenbox optional ausblenden
  if (r.hideCrisis) {
    document.querySelectorAll(".crisis-box").forEach((el) => el.hidden = true);
  }

  // --- Subskalen ---
  const subList = document.getElementById("subscaleList");
  if (subList && r.subscales) {
    subList.innerHTML = r.subscales.map((s) => {
      const pct  = Math.min(100, Math.max(0, Math.round((s.raw / s.max) * 100)));
      const tPct = s.threshold != null ? Math.min(100, Math.round((s.threshold / s.max) * 100)) : null;
      return `
        <div class="subscale">
          <div class="subscale-head">
            <strong>${s.label}</strong>
            <span class="val">${s.valueLabel || (s.raw + " / " + s.max)}</span>
          </div>
          <div class="subscale-bar" style="position:relative;">
            <div style="width:${pct}%;"></div>
            ${tPct != null ? `<span style="position:absolute; left:${tPct}%; top:-3px; bottom:-3px; width:1.5px; background:var(--gold);" title="Cutoff"></span>` : ""}
          </div>
          <div class="note">${s.note}</div>
        </div>
      `;
    }).join("");
  }

  setHTML("contextText", r.contextHTML);

  // --- Next steps ---
  const ns = document.getElementById("nextSteps");
  if (ns) ns.innerHTML = (r.nextSteps || []).map((s) => `<li style="margin-bottom:6px;">${s}</li>`).join("");

  // --- Buttons ---
  const btnPrint = document.getElementById("btnPrint");
  if (btnPrint) {
    if (window.BS_PRINT) BS_PRINT.attachPrint(btnPrint, RESULT_KEY);
    else btnPrint.addEventListener("click", () => window.print());
  }
  const btnRetry = document.getElementById("btnRetry");
  if (btnRetry && D.meta.retestPath) btnRetry.setAttribute("href", D.meta.retestPath);

  // ---------- helpers ----------
  function setText(id, v) {
    const el = document.getElementById(id);
    if (el && v != null) el.textContent = String(v);
  }
  function setHTML(id, v) {
    const el = document.getElementById(id);
    if (el && v != null) el.innerHTML = v;
  }

  function gaugeSVG(value, flag) {
    const v = Math.max(0, Math.min(1, value));
    const w = 360, h = 200, cx = w / 2, cy = h - 12, r = 140;
    const start = Math.PI, end = 0;
    const ang = start + (end - start) * v;
    const px = cx + r * Math.cos(ang);
    const py = cy + r * Math.sin(ang);
    const color = flag === "high" ? "var(--danger)"
                : flag === "moderate" ? "var(--gold)"
                : flag === "low" ? "var(--sage)"
                : "var(--sage)";
    return `
      <svg viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">
        <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="var(--line)" stroke-width="14" stroke-linecap="round"/>
        <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${px} ${py}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/>
        <circle cx="${px}" cy="${py}" r="10" fill="var(--ink)" />
        <text x="${cx}" y="${cy - 30}" text-anchor="middle" font-family="Space Grotesk, Inter, system-ui, sans-serif" font-size="36" fill="var(--ink)" font-weight="500">${Math.round(v * 100)}%</text>
        <text x="${cx - r + 6}" y="${cy + 22}" font-size="11" fill="var(--ink-mute)">${UI.gaugeLow}</text>
        <text x="${cx + r - 30}" y="${cy + 22}" font-size="11" fill="var(--ink-mute)">${UI.gaugeHigh}</text>
      </svg>`;
  }
})();
