// Charakterprofil — Ergebnis-Renderer (eigenes Layout, analog zu adhs-result / iq-result).
// Liest sessionStorage[brainscreener.charakter.result.v1] und nutzt window.TEST_DATA.archetypes.
(function () {
  const D = window.TEST_DATA;
  if (!D) { console.error("[charakter-result] TEST_DATA fehlt"); return; }

  const RESULT_KEY = "brainscreener.charakter.result.v1";
  let payload = window.BS_PRINT ? BS_PRINT.loadPayload(RESULT_KEY) : null;
  if (!payload) { try { payload = JSON.parse(sessionStorage.getItem(RESULT_KEY) || "null"); } catch { payload = null; } }

  if (D.meta && D.meta.pageTitle) document.title = D.meta.pageTitle;

  const root = document.querySelector(".result-shell .container-narrow");
  if (!payload) {
    const NU = (D.ui || {});
    root.innerHTML = `
      <div class="result-card">
        <h2>${NU.noResultTitle || "No result found"}</h2>
        <p>${NU.noResultText || "Please take the test first to receive a report."}</p>
        <p><a class="btn btn-primary" href="/brainscreener/character.html">${NU.toTest || "Go to the test"}</a></p>
      </div>`;
    return;
  }

  const A = D.archetypes;
  const DIMS = D.dims;
  const { ts, probandCode } = payload;
  // Sprachneutrale Antworten in der Sprache dieser Seite neu auswerten
  // (ermöglicht Drucken der Auswertung in einer anderen Sprache).
  const result = (payload.answers && typeof D.evaluate === "function")
    ? D.evaluate(payload.answers)
    : payload.result;
  const { scores, order, dominant, balanced } = result;
  const LOCALE = document.documentElement.lang || "de-CH";

  // ---- Datum / Code ----
  const date = ts ? new Date(ts) : new Date();
  setText("dateStr",
    date.toLocaleDateString(LOCALE, { day: "2-digit", month: "long", year: "numeric" }) +
    " · " + date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }));
  const code = (probandCode || "").trim();
  if (code) {
    const row = document.getElementById("codeRow");
    if (row) row.hidden = false;
    setText("codeStr", code);
  }
  setText("verfahrensRef", D.meta.sources);

  // UI-Strings: deutsche Defaults; übersetzte charakter-data.js liefert D.resultUi mit.
  const RUI = Object.assign({
    balancedTrait: "Ausgewogenes Profil",
    balancedName: "Ein ausgeglichenes Mischverhältnis",
    balancedIntro: "Ihr Profil ist bemerkenswert <strong>ausgewogen</strong> — kein Zug ragt deutlich heraus. Je nach Situation zeigen Sie verschiedene Seiten. Vermutlich erkennen Sie sich unten in mehreren Typen wieder.",
    domIntro: (dom, domPct, sec, secPct) =>
      `Jeder Mensch trägt von allen vier Zügen etwas in sich — am stärksten zeigt sich bei Ihnen <strong>${dom.name}</strong> (${domPct}&nbsp;%). ${dom.tagline} ` +
      `Danach folgt am ehesten <strong>${sec.name}</strong> (${secPct}&nbsp;%). ` +
      `Das heisst nicht, dass Sie „so sind“ — es zeigt nur, welche Tendenz bei Ihnen am ehesten durchscheint.`,
    badgeTop: "ragt heraus",
    badgeDominant: "Ihr stärkster Zug",
    colExamples: "So zeigt es sich im Alltag",
    colStrengths: "Stärken",
    colTips: "Tipps &amp; woran Sie arbeiten können",
    wheelBalanced: "ausgewogen",
    wheelDominant: "stärkster Zug",
  }, D.resultUi || {});

  // ---- Hero (dominanter Zug + Intro) ----
  if (balanced) {
    setText("domTrait", RUI.balancedTrait);
    setText("domName", RUI.balancedName);
    setHTML("domIntro", RUI.balancedIntro);
  } else {
    const dom = A[dominant];
    const sec = A[order[1]];
    setText("domTrait", dom.trait);
    setText("domName", dom.name);
    setHTML("domIntro", RUI.domIntro(dom, scores[dominant].pct, sec, scores[order[1]].pct));
  }

  // ---- Farbrad ----
  const wheel = document.getElementById("charWheel");
  if (wheel) wheel.innerHTML = wheelSVG();

  // ---- Balken (nach Ausprägung absteigend) ----
  const bars = document.getElementById("charBars");
  if (bars) {
    bars.innerHTML = order.map((k, i) => {
      const a = A[k], pct = scores[k].pct;
      const badge = (i === 0 && !balanced) ? `<span class="char-badge">${RUI.badgeTop}</span>` : "";
      return `
        <div class="char-bar">
          <div class="char-bar-head">
            <span class="char-dot" style="background:${a.color}"></span>
            <strong>${a.name}</strong>
            <span class="char-trait">${a.trait}</span>
            ${badge}
            <span class="char-pct">${pct}&nbsp;%</span>
          </div>
          <div class="char-track"><div class="char-fill" style="width:${pct}%; background:${a.color}"></div></div>
        </div>`;
    }).join("");
  }

  // ---- Typ-Detailkarten (dominanter Zug zuerst) ----
  const types = document.getElementById("charTypes");
  if (types) {
    types.innerHTML = order.map((k, i) => {
      const a = A[k], pct = scores[k].pct;
      const isDom = (i === 0 && !balanced);
      const badge = isDom ? `<span class="char-badge">${RUI.badgeDominant}</span>` : "";
      const li = (arr) => arr.map((x) => `<li>${x}</li>`).join("");
      return `
        <div class="char-type-card ${isDom ? "is-dominant" : ""}" style="border-left-color:${a.color}">
          <div class="char-type-title">
            <span class="char-dot" style="background:${a.color}"></span>
            <h3>${a.name}</h3>
            <span class="char-trait">${a.trait} · ${pct}&nbsp;%</span>
            ${badge}
          </div>
          <p class="char-tagline">${a.tagline}</p>
          <p>${a.desc}</p>
          <div class="char-cols">
            <div>
              <h4>${RUI.colExamples}</h4>
              <ul>${li(a.examples)}</ul>
            </div>
            <div>
              <h4>${RUI.colStrengths}</h4>
              <ul>${li(a.strengths)}</ul>
            </div>
          </div>
          <h4>${RUI.colTips}</h4>
          <ul>${li(a.tips)}</ul>
        </div>`;
    }).join("");
  }

  // ---- Print ----
  const btnPrint = document.getElementById("btnPrint");
  if (btnPrint) {
    if (window.BS_PRINT) BS_PRINT.attachPrint(btnPrint, RESULT_KEY);
    else btnPrint.addEventListener("click", () => window.print());
  }

  // ---------- helpers ----------
  function setText(id, v) { const el = document.getElementById(id); if (el && v != null) el.textContent = String(v); }
  function setHTML(id, v) { const el = document.getElementById(id); if (el && v != null) el.innerHTML = v; }

  function wheelSVG() {
    const cx = 80, cy = 80, r = 58, sw = 24;
    const C = 2 * Math.PI * r;
    const total = DIMS.reduce((s, d) => s + scores[d].pct, 0) || 1;
    let offset = 0, segs = "";
    DIMS.forEach((d) => {
      const len = (scores[d].pct / total) * C;
      if (len > 0.5) {
        segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${A[d].color}" stroke-width="${sw}"` +
          ` stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"` +
          ` transform="rotate(-90 ${cx} ${cy})"/>`;
      }
      offset += len;
    });
    const centerTop = balanced ? "≈" : scores[order[0]].pct + "%";
    const centerSub = balanced ? RUI.wheelBalanced : RUI.wheelDominant;
    const centerColor = balanced ? "var(--ink)" : A[order[0]].color;
    return `
      <svg viewBox="0 0 160 160" role="img" aria-label="Charakter-Mischverhältnis">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${sw}"/>
        ${segs}
        <text x="${cx}" y="${cy - 1}" text-anchor="middle" font-family="Space Grotesk, Inter, system-ui, sans-serif" font-size="30" font-weight="600" fill="${centerColor}">${centerTop}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="9" fill="var(--ink-mute)" letter-spacing="0.4">${centerSub}</text>
      </svg>`;
  }
})();
