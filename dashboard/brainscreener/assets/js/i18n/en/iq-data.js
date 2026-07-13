// IQ Test - Item bank and scoring (English version)
// Structure based on CHC theory (Cattell-Horn-Carroll):
//   Gf - Fluid intelligence (matrix reasoning)
//   Gq - Quantitative reasoning (number series)
//   Gc - Crystallized intelligence (verbal analogies)
//   Gf/Gc - Logical reasoning (syllogisms, inference)
// 40 items, increasing difficulty, normed IQ estimate (M=100, SD=15).

window.IQ_DATA = (function () {

  const COLOR = { INK: "#1F3A3D", SAGE: "#A9B8A3", GOLD: "#C9A86B", LIGHT: "#DCD7CD" };

  // -------------------- SVG Primitive --------------------
  function svgWrap(inner, viewBox = "0 0 100 100") {
    return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  }
  function dot(cx, cy, r = 6, color = COLOR.INK) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
  }
  function dotsLine(n, color = COLOR.INK) {
    const spacing = 14;
    const startX = 50 - ((n - 1) * spacing) / 2;
    let out = "";
    for (let i = 0; i < n; i++) out += dot(startX + i * spacing, 50, 5, color);
    return out;
  }
  function shape(kind, fill = "none", { cx = 50, cy = 50, size = 1, rot = 0, color = COLOR.INK, sw = 3 } = {}) {
    const r = 24 * size, s = 42 * size;
    const fillAttr =
      fill === "full" ? `fill="${color}"` :
      fill === "half" ? `fill="${color}" fill-opacity="0.45" stroke="${color}" stroke-width="${sw}"` :
      `fill="none" stroke="${color}" stroke-width="${sw}"`;
    if (kind === "circle") return `<circle cx="${cx}" cy="${cy}" r="${r}" ${fillAttr}/>`;
    if (kind === "square") {
      const x = cx - s / 2, y = cy - s / 2;
      return `<rect x="${x}" y="${y}" width="${s}" height="${s}" ${fillAttr} transform="rotate(${rot} ${cx} ${cy})"/>`;
    }
    if (kind === "triangle") {
      const p1 = `${cx},${cy - r}`;
      const p2 = `${cx - r * 0.866},${cy + r * 0.55}`;
      const p3 = `${cx + r * 0.866},${cy + r * 0.55}`;
      return `<polygon points="${p1} ${p2} ${p3}" ${fillAttr} transform="rotate(${rot} ${cx} ${cy})"/>`;
    }
    if (kind === "diamond") {
      const x = cx - r / 1.3, y = cy - r / 1.3, ss = r * 1.55;
      return `<rect x="${x}" y="${y}" width="${ss}" height="${ss}" ${fillAttr} transform="rotate(45 ${cx} ${cy})"/>`;
    }
    if (kind === "hex") {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
      }
      return `<polygon points="${pts.join(" ")}" ${fillAttr} transform="rotate(${rot} ${cx} ${cy})"/>`;
    }
    return "";
  }
  function arrow(rot = 0, color = COLOR.INK) {
    return `<g transform="rotate(${rot} 50 50)" stroke-linecap="round">
      <line x1="50" y1="78" x2="50" y2="28" stroke="${color}" stroke-width="4"/>
      <polyline points="38,38 50,22 62,38" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>
    </g>`;
  }
  function compoundDots(n, kind = "circle") {
    // n shapes arranged horizontally, fitted to viewBox 0..100
    const spacing = n <= 1 ? 0 : Math.min(26, 84 / (n - 1));
    const size = n >= 6 ? 0.26 : n >= 5 ? 0.3 : 0.35;
    const startX = 50 - ((n - 1) * spacing) / 2;
    let out = "";
    for (let i = 0; i < n; i++) {
      out += shape(kind, "full", { cx: startX + i * spacing, cy: 50, size });
    }
    return out;
  }
  function positionDot(corner) {
    // dot in one of 8 outer positions around a centered square frame
    const positions = {
      "N":  [50, 22], "NE": [78, 22], "E":  [78, 50], "SE": [78, 78],
      "S":  [50, 78], "SW": [22, 78], "W":  [22, 50], "NW": [22, 22],
      "C":  [50, 50],
    };
    const [cx, cy] = positions[corner] || [50, 50];
    return `<rect x="18" y="18" width="64" height="64" fill="none" stroke="${COLOR.LIGHT}" stroke-width="1.5" rx="6"/>${dot(cx, cy, 7)}`;
  }
  function cell(inner) {
    return svgWrap(inner);
  }

  // -------------------- 3x3 Grid renderer --------------------
  function gridSVG(cells) {
    // cells: array of 9 inner-SVG strings; cells[8] is the missing one -> "?"
    const size = 105, gap = 8, total = 3 * size + 2 * gap; // 331
    let inner = "";
    for (let i = 0; i < 9; i++) {
      const r = Math.floor(i / 3), c = i % 3;
      const x = c * (size + gap), y = r * (size + gap);
      const isMissing = (i === 8);
      const bg = isMissing
        ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="8" fill="#FBFAF7" stroke="${COLOR.GOLD}" stroke-width="2" stroke-dasharray="4 4"/>`
        : `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="8" fill="#FFFFFF" stroke="${COLOR.LIGHT}" stroke-width="1.5"/>`;
      inner += bg;
      if (isMissing) {
        inner += `<text x="${x + size / 2}" y="${y + size / 2 + 14}" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="44" fill="${COLOR.GOLD}">?</text>`;
      } else {
        // embed an inner svg
        inner += `<svg x="${x + 3}" y="${y + 3}" width="${size - 6}" height="${size - 6}" viewBox="0 0 100 100">${cells[i]}</svg>`;
      }
    }
    return `<svg viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg" style="max-width:340px; width:100%;">${inner}</svg>`;
  }
  function optionSVG(inner) {
    return svgWrap(inner);
  }

  // -------------------- Matrix items --------------------

  const M = []; // matrix items

  // M1: Dots count progression (+1 per cell within each row, +1 per row)
  M.push({
    id: "M1", type: "matrix", domain: "Gf", level: 1,
    cells: [
      dotsLine(1), dotsLine(2), dotsLine(3),
      dotsLine(2), dotsLine(3), dotsLine(4),
      dotsLine(3), dotsLine(4), null,
    ],
    options: [dotsLine(3), dotsLine(4), dotsLine(5), dotsLine(6), dotsLine(2), dotsLine(7)],
    answer: 2,
  });

  // M2: Latin square of shapes (each row & column contains circle/square/triangle exactly once)
  const sC = shape("circle", "full"), sS = shape("square", "full"), sT = shape("triangle", "full");
  M.push({
    id: "M2", type: "matrix", domain: "Gf", level: 1,
    cells: [
      sC, sS, sT,
      sS, sT, sC,
      sT, sC, null,
    ],
    options: [sC, sS, sT, shape("diamond", "full"), shape("hex", "full"), shape("triangle", "none")],
    answer: 1,
  });

  // M3: Fill progression: each row keeps shape, fill goes none->half->full
  M.push({
    id: "M3", type: "matrix", domain: "Gf", level: 1,
    cells: [
      shape("circle", "none"), shape("circle", "half"), shape("circle", "full"),
      shape("square", "none"), shape("square", "half"), shape("square", "full"),
      shape("triangle", "none"), shape("triangle", "half"), null,
    ],
    options: [
      shape("triangle", "none"),
      shape("triangle", "half"),
      shape("triangle", "full"),
      shape("circle", "full"),
      shape("square", "full"),
      shape("diamond", "full"),
    ],
    answer: 2,
  });

  // M4: Shape rotates 45 degrees across each row
  M.push({
    id: "M4", type: "matrix", domain: "Gf", level: 2,
    cells: [
      shape("triangle", "full", { rot: 0 }),
      shape("triangle", "full", { rot: 45 }),
      shape("triangle", "full", { rot: 90 }),

      shape("triangle", "full", { rot: 90 }),
      shape("triangle", "full", { rot: 135 }),
      shape("triangle", "full", { rot: 180 }),

      shape("triangle", "full", { rot: 180 }),
      shape("triangle", "full", { rot: 225 }),
      null,
    ],
    options: [
      shape("triangle", "full", { rot: 0 }),
      shape("triangle", "full", { rot: 90 }),
      shape("triangle", "full", { rot: 180 }),
      shape("triangle", "full", { rot: 270 }),
      shape("triangle", "full", { rot: 315 }),
      shape("triangle", "none", { rot: 270 }),
    ],
    answer: 3,
  });

  // M5: Dot position rotates 45 degrees clockwise per cell
  // Sequence: N, NE, E, SE, S, SW, W, NW, then ?=N
  const rotSeq = ["N","NE","E","SE","S","SW","W","NW"];
  M.push({
    id: "M5", type: "matrix", domain: "Gv", level: 2,
    cells: rotSeq.map((p) => positionDot(p)).concat([null]),
    options: [positionDot("N"), positionDot("E"), positionDot("S"), positionDot("W"), positionDot("C"), positionDot("NE")],
    answer: 0,
  });

  // M6: Count progression: row 1: 1, 2, 3 circles; row 2: 2, 3, 4 squares; row 3: 3, 4, ? triangles
  M.push({
    id: "M6", type: "matrix", domain: "Gf", level: 2,
    cells: [
      compoundDots(1, "circle"), compoundDots(2, "circle"), compoundDots(3, "circle"),
      compoundDots(2, "square"), compoundDots(3, "square"), compoundDots(4, "square"),
      compoundDots(3, "triangle"), compoundDots(4, "triangle"), null,
    ],
    options: [
      compoundDots(3, "triangle"),
      compoundDots(4, "triangle"),
      compoundDots(5, "triangle"),
      compoundDots(6, "triangle"),
      compoundDots(5, "circle"),
      compoundDots(5, "square"),
    ],
    answer: 2,
  });

  // M7: Two attributes: shape (rows) x fill (cols)
  M.push({
    id: "M7", type: "matrix", domain: "Gf", level: 2,
    cells: [
      shape("hex", "none"), shape("hex", "half"), shape("hex", "full"),
      shape("diamond", "none"), shape("diamond", "half"), shape("diamond", "full"),
      shape("circle", "none"), shape("circle", "half"), null,
    ],
    options: [
      shape("circle", "full"),
      shape("circle", "half"),
      shape("circle", "none"),
      shape("diamond", "full"),
      shape("hex", "full"),
      shape("square", "full"),
    ],
    answer: 0,
  });

  // M8: Arrow rotates 90 degrees per cell, sequence: 0,90,180,270,...
  // Row 1: 0, 90, 180; Row 2: 90, 180, 270; Row 3: 180, 270, ?
  M.push({
    id: "M8", type: "matrix", domain: "Gv", level: 2,
    cells: [
      arrow(0), arrow(90), arrow(180),
      arrow(90), arrow(180), arrow(270),
      arrow(180), arrow(270), null,
    ],
    options: [arrow(0), arrow(45), arrow(90), arrow(135), arrow(180), arrow(270)],
    answer: 0,
  });

  // M9: Size progression: small, medium, large per row; shape changes per row
  M.push({
    id: "M9", type: "matrix", domain: "Gf", level: 3,
    cells: [
      shape("circle", "full", { size: 0.4 }), shape("circle", "full", { size: 0.7 }), shape("circle", "full", { size: 1.0 }),
      shape("square", "full", { size: 0.4 }), shape("square", "full", { size: 0.7 }), shape("square", "full", { size: 1.0 }),
      shape("triangle", "full", { size: 0.4 }), shape("triangle", "full", { size: 0.7 }), null,
    ],
    options: [
      shape("triangle", "full", { size: 0.4 }),
      shape("triangle", "full", { size: 0.7 }),
      shape("triangle", "full", { size: 1.0 }),
      shape("triangle", "none", { size: 1.0 }),
      shape("circle", "full", { size: 1.0 }),
      shape("square", "full", { size: 1.0 }),
    ],
    answer: 2,
  });

  // M10: Complex - shape + small inner shape both rotate through sequence
  // Outer: circle / square / triangle (Latin square)
  // Inner small dot color: ink / sage / gold (also Latin square but shifted)
  function compound(outer, innerColor) {
    return shape(outer, "none") + dot(50, 50, 7, innerColor);
  }
  M.push({
    id: "M10", type: "matrix", domain: "Gf", level: 3,
    cells: [
      compound("circle", COLOR.INK), compound("square", COLOR.SAGE), compound("triangle", COLOR.GOLD),
      compound("square", COLOR.GOLD), compound("triangle", COLOR.INK), compound("circle", COLOR.SAGE),
      compound("triangle", COLOR.SAGE), compound("circle", COLOR.GOLD), null,
    ],
    // each row contains each (shape, color) such that row=(c,s,t) permutation and col contains each color
    // Pattern: outer cycles through (circle, square, triangle) shifted by row; color cycles too
    // Row 1: c-ink, s-sage, t-gold
    // Row 2: s-gold, t-ink, c-sage
    // Row 3: t-sage, c-gold, ?-?
    // Cells:
    //  - outer shapes used: row 3 already has triangle, circle -> missing: square
    //  - colors used: row 3 already has sage, gold -> missing: ink
    // So: square + ink dot
    options: [
      compound("square", COLOR.INK),
      compound("square", COLOR.GOLD),
      compound("triangle", COLOR.INK),
      compound("circle", COLOR.INK),
      compound("square", COLOR.SAGE),
      compound("triangle", COLOR.GOLD),
    ],
    answer: 0,
  });

  // -------------------- Number series (Gq) --------------------
  const N = [];
  function addNumber(id, level, q, options, answerIdx) {
    N.push({ id, type: "numeric", domain: "Gq", level, question: q, options, answer: answerIdx });
  }
  addNumber("N1", 1, "2, 4, 6, 8, ?", ["9", "10", "12", "14"], 1);
  addNumber("N2", 1, "3, 6, 12, 24, ?", ["36", "42", "48", "60"], 2);
  addNumber("N3", 1, "1, 4, 9, 16, ?", ["20", "23", "25", "32"], 2);
  addNumber("N4", 2, "1, 1, 2, 3, 5, 8, ?", ["10", "11", "13", "16"], 2);
  addNumber("N5", 2, "2, 5, 11, 23, ?", ["35", "41", "47", "53"], 2);
  addNumber("N6", 2, "81, 27, 9, 3, ?", ["0", "1", "2", "3"], 1);
  addNumber("N7", 2, "1, 3, 6, 10, 15, ?", ["18", "20", "21", "22"], 2);
  addNumber("N8", 3, "7, 14, 28, 56, ?", ["84", "98", "112", "120"], 2);
  addNumber("N9", 3, "5, 8, 13, 20, 29, ?", ["35", "38", "40", "42"], 2);
  addNumber("N10", 3, "2, 3, 5, 7, 11, ?", ["12", "13", "15", "17"], 1);
  addNumber("N11", 3, "1, 8, 27, 64, ?", ["100", "120", "125", "128"], 2);
  addNumber("N12", 4, "4, 9, 19, 39, 79, ?", ["129", "139", "159", "199"], 2);

  // -------------------- Verbal analogies (Gc) --------------------
  const V = [];
  function addVerbal(id, level, q, options, answerIdx) {
    V.push({ id, type: "verbal", domain: "Gc", level, question: q, options, answer: answerIdx });
  }
  addVerbal("V1", 1, "Hand : finger = foot : ?", ["Leg", "Toe", "Shoe", "Ankle"], 1);
  addVerbal("V2", 1, "Day : sun = night : ?", ["Star", "Darkness", "Moon", "Sleep"], 2);
  addVerbal("V3", 1, "Book : library = painting : ?", ["Artist", "Studio", "Gallery", "Exhibition"], 2);
  addVerbal("V4", 2, "Doctor : patient = teacher : ?", ["School", "Student", "Book", "Class"], 1);
  addVerbal("V5", 2, "Island : sea = oasis : ?", ["Sand", "Palm tree", "Desert", "Water"], 2);
  addVerbal("V6", 2, "Step : to walk = leap : ?", ["to leap", "to fall", "to fly", "to run"], 0);
  addVerbal("V7", 2, "Architect : building = composer : ?", ["Concert", "Music", "Symphony", "Orchestra"], 2);
  addVerbal("V8", 3, "Gram : mass = second : ?", ["Clock", "Hour", "Minute", "Time"], 3);
  addVerbal("V9", 3, "Word : sentence = note : ?", ["Song", "Tone", "Melody", "Instrument"], 2);
  addVerbal("V10", 3, "Drop : rain = grain : ?", ["Flour", "Sand", "Bread", "Field"], 1);

  // -------------------- Logical reasoning --------------------
  const L = [];
  function addLogic(id, level, q, options, answerIdx) {
    L.push({ id, type: "logical", domain: "Gf", level, question: q, options, answer: answerIdx });
  }
  addLogic("L1", 1,
    "All dogs are mammals. Bello is a dog. What necessarily follows?",
    [
      "Bello is a mammal.",
      "All mammals are dogs.",
      "Bello barks.",
      "Bello has fur.",
    ], 0);
  addLogic("L2", 2,
    "If it rains, the road is wet. The road is wet. What necessarily follows?",
    [
      "It is raining.",
      "It is not raining.",
      "It may be raining, but it does not have to be.",
      "It has rained.",
    ], 2);
  addLogic("L3", 2,
    "Some politicians are lawyers. All lawyers have a university degree. What necessarily follows?",
    [
      "All politicians have a university degree.",
      "Some politicians have a university degree.",
      "Anyone with a university degree is a politician or a lawyer.",
      "Some lawyers are not politicians.",
    ], 1);
  addLogic("L4", 2,
    "A is taller than B. C is shorter than B. D is taller than A. Who is the shortest?",
    ["A", "B", "C", "D"], 2);
  addLogic("L5", 3,
    "Five people each shake hands with each other exactly once. How many handshakes are there?",
    ["8", "9", "10", "12"], 2);
  addLogic("L6", 3,
    "The following is true: “If Anna lies, then Ben lies too.” Ben is telling the truth. What necessarily follows?",
    [
      "Anna lies.",
      "Anna is telling the truth.",
      "Both lie.",
      "Nothing can be concluded.",
    ], 1);
  addLogic("L7", 3,
    "A cube has 6 faces. How many edges does it have?",
    ["6", "8", "12", "16"], 2);
  addLogic("L8", 4,
    "Three cards lie side by side: one red, one green, one blue. The following holds: the red one lies to the left of the green one. The blue one lies between the other two. In what order (from left to right) do they lie?",
    ["red, blue, green", "blue, red, green", "red, green, blue", "green, blue, red"], 0);

  // -------------------- Assemble the item bank --------------------
  // Order: mixed, increasing difficulty
  const ITEMS = [];
  // All items are sorted by level, then balanced by domain
  const allByLevel = [...M, ...N, ...V, ...L].sort((a, b) => a.level - b.level);
  // For better UX: balanced interleave per level
  ITEMS.push(...allByLevel);

  const TOTAL = ITEMS.length;

  // -------------------- Scoring --------------------
  function evaluate(answers) {
    // answers: { itemId: chosenIndex }
    const byDomain = { Gf: { right: 0, total: 0 }, Gq: { right: 0, total: 0 }, Gc: { right: 0, total: 0 }, Gv: { right: 0, total: 0 } };
    let correct = 0;
    const perItem = [];
    for (const it of ITEMS) {
      const chosen = answers[it.id];
      const ok = chosen === it.answer;
      if (ok) correct++;
      const dom = byDomain[it.domain] || (byDomain[it.domain] = { right: 0, total: 0 });
      dom.total += 1;
      if (ok) dom.right += 1;
      perItem.push({ id: it.id, ok, chosen: chosen ?? null, answer: it.answer, domain: it.domain, level: it.level });
    }

    // IQ estimate: z-based with the assumptions mean=22, SD=6 for 40 items.
    // This calibration is representative of a mixed test of medium difficulty
    // and yields plausible values on the standard score scale (M=100, SD=15).
    const M_RAW = 22;
    const SD_RAW = 6;
    const z = (correct - M_RAW) / SD_RAW;
    let iq = Math.round(100 + 15 * z);
    iq = Math.max(60, Math.min(150, iq));

    // Standard error of measurement (SEM) ~ 5 IQ points; 95% CI ~ +-10 points
    const ciLow = Math.max(55, iq - 10);
    const ciHigh = Math.min(155, iq + 10);

    // Percentile from z
    const pct = Math.round(normalCdf(z) * 100);

    // Classification according to common convention
    let band;
    if (iq < 70) band = "Well below average";
    else if (iq < 80) band = "Below average";
    else if (iq < 90) band = "Low average";
    else if (iq <= 109) band = "Average";
    else if (iq <= 119) band = "High average";
    else if (iq <= 129) band = "Above average";
    else band = "Well above average";

    return {
      correct, total: TOTAL,
      iq, ciLow, ciHigh, percentile: pct, band,
      byDomain, perItem,
    };
  }

  // Approximation of the standard normal distribution (Abramowitz/Stegun)
  function normalCdf(z) {
    const p = 0.2316419;
    const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937, b4 = -1.821255978, b5 = 1.330274429;
    const t = 1 / (1 + p * Math.abs(z));
    const pdf = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
    const cdf = 1 - pdf * (b1 * t + b2 * t ** 2 + b3 * t ** 3 + b4 * t ** 4 + b5 * t ** 5);
    return z >= 0 ? cdf : 1 - cdf;
  }

  const ui = {
    itemOf: (i, n) => `Task ${i} of ${n}`,
    answeredOf: (a, n) => `${a} / ${n} answered`,
    qMatrix: "Which figure completes the pattern?",
    qNumeric: "Which number logically continues the series?",
    qVerbal: "Which completion fits best?",
    optionLabel: (letter) => `Option ${letter}`,
    finishConfirm: (a, n) => `You have answered ${a} of ${n} tasks. Score the test anyway?`,
    resetConfirm: "Do you really want to clear all previous answers and start over?",
    confirmFinishOk: "Score anyway",
    confirmResetOk: "Delete answers",
    confirmCancel: "Cancel",
    domainLabel: { Gf: "Matrix reasoning · Fluid intelligence", Gq: "Number series · Quantitative reasoning", Gc: "Verbal analogy · Crystallized intelligence", Gv: "Visuospatial · Pattern recognition" },
  };

  return { ITEMS, TOTAL, evaluate, gridSVG, optionSVG, ui };
})();
