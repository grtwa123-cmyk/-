/*
 * Natural selection and genetic drift at one diploid locus.
 *
 * Two alleles, three genotypes, and a relative fitness for each. Everything
 * on screen comes from the standard one-locus viability model — no fitted
 * curves, no tuned constants:
 *
 *   Hardy–Weinberg    p² : 2pq : q²        genotypes after random mating
 *   mean fitness      w̄ = p²w₁₁ + 2pq·w₁₂ + q²w₂₂
 *   recursion         p′ = (p²w₁₁ + pq·w₁₂) / w̄
 *   change            Δp = pq[p(w₁₁−w₁₂) + q(w₁₂−w₂₂)] / w̄
 *   equilibrium       p* = (w₁₂−w₂₂) / (2w₁₂−w₁₁−w₂₂)   when interior
 *
 * Two tracks run at once and the contrast between them is the point:
 *
 *   · The DETERMINISTIC track is the recursion above — an infinite
 *     population, pure selection, no luck involved.
 *   · The FINITE track is a real Wright–Fisher population of N individuals.
 *     Selection is applied to the *observed* genotype counts rather than to
 *     assumed Hardy–Weinberg proportions, then 2N gametes are drawn from the
 *     survivors' pool and paired at random. Sampling 2N Bernoulli(p′) alleles
 *     and pairing consecutive ones is exactly Wright–Fisher: the allele count
 *     is Binomial(2N, p′) and offspring genotypes come out Hardy–Weinberg by
 *     construction, so drift enters through the sampling and nowhere else.
 *
 * Five more populations run under identical rules and are drawn faintly:
 * same selection, different luck. With equal fitnesses their spread is the
 * whole of what drift does, and the probability that any one of them fixes
 * for A is exactly its starting frequency.
 *
 * Population size is held constant, so the fitnesses are relative survival
 * odds, not absolute growth rates — doubling all three changes nothing.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    waa:   document.getElementById("waa"),
    wab:   document.getElementById("wab"),
    wbb:   document.getElementById("wbb"),
    p0:    document.getElementById("p0"),
    popn:  document.getElementById("popn"),
    speed: document.getElementById("speed"),
  };
  const inputValues = {
    waa:   document.getElementById("waa-value"),
    wab:   document.getElementById("wab-value"),
    wbb:   document.getElementById("wbb-value"),
    p0:    document.getElementById("p0-value"),
    popn:  document.getElementById("popn-value"),
    speed: document.getElementById("speed-value"),
  };
  const out = {
    gen:   document.getElementById("out-gen"),
    p:     document.getElementById("out-p"),
    pdet:  document.getElementById("out-pdet"),
    geno:  document.getElementById("out-geno"),
    hw:    document.getElementById("out-hw"),
    wbar:  document.getElementById("out-wbar"),
  };
  const presetList = document.getElementById("preset-list");
  const pauseBtn = document.getElementById("pause-btn");
  const stepBtn  = document.getElementById("step-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const C_AA = "#5fe0c8";
  const C_AB = "#b98cff";
  const C_BB = "#ff7aa8";
  const C_DET = "#ffd166";
  const C_POP = "#7be0d0";

  const PRESETS = {
    neutral:     { wAA: 1,    wAa: 1,    waa: 1    },
    directional: { wAA: 1,    wAa: 0.95, waa: 0.9  },
    recessive:   { wAA: 1,    wAa: 1,    waa: 0    },
    over:        { wAA: 0.8,  wAa: 1,    waa: 0.7  },
    under:       { wAA: 1,    wAa: 0.7,  waa: 0.9  },
  };
  const REPLICATES = 5;
  const MAX_GEN = 3000;

  // ── Model ──────────────────────────────────────────────────────────────
  let wAA = 1, wAa = 1, waa = 1;

  /** Mean fitness of a Hardy–Weinberg population at frequency p. */
  function meanFitness(p) {
    const q = 1 - p;
    return p * p * wAA + 2 * p * q * wAa + q * q * waa;
  }

  /** One generation of the infinite-population recursion. */
  function detStep(p) {
    const q = 1 - p;
    const wbar = meanFitness(p);
    if (wbar <= 0) return p;              // every genotype lethal: undefined
    return (p * p * wAA + p * q * wAa) / wbar;
  }

  /**
   * Interior equilibrium, or null when selection is directional. Stable when
   * the heterozygote is fittest, unstable when it is least fit.
   */
  function equilibrium() {
    const denom = 2 * wAa - wAA - waa;
    if (Math.abs(denom) < 1e-12) return null;
    const p = (wAa - waa) / denom;
    if (!(p > 0 && p < 1)) return null;
    return { p, stable: wAa > wAA && wAa > waa };
  }

  /** Allele frequency of A from genotype counts. */
  const freqA = (g) => {
    const n = g.AA + g.Aa + g.aa;
    return n > 0 ? (2 * g.AA + g.Aa) / (2 * n) : 0;
  };

  /**
   * One Wright–Fisher generation with viability selection. Selection weights
   * the *observed* counts, so a population that has drifted away from
   * Hardy–Weinberg is treated as it actually is.
   */
  function wfStep(g) {
    const tAA = g.AA * wAA, tAa = g.Aa * wAa, tbb = g.aa * waa;
    const tot = tAA + tAa + tbb;
    if (tot <= 0) return null;            // no survivors
    const ps = (tAA + 0.5 * tAa) / tot;   // A frequency in the gamete pool
    const n = g.AA + g.Aa + g.aa;
    let AA = 0, Aa = 0, bb = 0;
    for (let i = 0; i < n; i++) {
      const k = (Math.random() < ps ? 1 : 0) + (Math.random() < ps ? 1 : 0);
      if (k === 2) AA++; else if (k === 1) Aa++; else bb++;
    }
    return { AA, Aa, aa: bb };
  }

  /** Found a population of n individuals by drawing 2n alleles at frequency p. */
  function founder(n, p) {
    let AA = 0, Aa = 0, bb = 0;
    for (let i = 0; i < n; i++) {
      const k = (Math.random() < p ? 1 : 0) + (Math.random() < p ? 1 : 0);
      if (k === 2) AA++; else if (k === 1) Aa++; else bb++;
    }
    return { AA, Aa, aa: bb };
  }

  // ── State ──────────────────────────────────────────────────────────────
  let N = 200;
  let pop = null;              // focal population, genotype counts
  let reps = [];               // faint replicate populations
  let pDet = 0.5;              // infinite-population frequency
  let gen = 0;
  let extinct = false;
  let histPop = [], histDet = [], histReps = [];
  let order = [];              // stable dot ordering, so colours don't flicker
  let running = true;
  let acc = 0;

  function buildOrder(n) {
    order = new Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  function reset() {
    readFitness();
    N = parseInt(inputs.popn.value, 10);
    const p0 = parseFloat(inputs.p0.value);
    pop = founder(N, p0);
    reps = Array.from({ length: REPLICATES }, () => founder(N, p0));
    pDet = p0;
    gen = 0;
    extinct = false;
    histPop = [freqA(pop)];
    histDet = [pDet];
    histReps = reps.map((r) => [freqA(r)]);
    buildOrder(N);
    acc = 0;
  }

  function readFitness() {
    wAA = parseFloat(inputs.waa.value);
    wAa = parseFloat(inputs.wab.value);
    waa = parseFloat(inputs.wbb.value);
  }

  let lastFixed = null;
  function stepGeneration() {
    if (extinct || gen >= MAX_GEN) return;
    const next = wfStep(pop);
    if (!next) { extinct = true; return; }
    const before = freqA(pop);
    pop = next;
    reps = reps.map((r) => wfStep(r) || r);
    pDet = detStep(pDet);
    gen++;
    histPop.push(freqA(pop));
    histDet.push(pDet);
    reps.forEach((r, i) => histReps[i].push(freqA(r)));

    // Fixation and loss are the two absorbing states; announce them once.
    const after = freqA(pop);
    if (before > 0 && before < 1) {
      if (after === 1 && lastFixed !== 1) {
        lastFixed = 1;
        window.SFX?.tone({ freq: 420, glideTo: 720, dur: 0.3, type: "sine", gain: 0.14 });
      } else if (after === 0 && lastFixed !== 0) {
        lastFixed = 0;
        window.SFX?.tone({ freq: 420, glideTo: 200, dur: 0.34, type: "sine", gain: 0.14 });
      }
    }
    if (after > 0 && after < 1) lastFixed = null;
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    const narrow = W < 560;
    const padL = narrow ? 34 : 46;
    const padR = narrow ? 10 : 16;
    const fieldTop = narrow ? 26 : 30;
    const barsH = 62;
    const panelA = Math.round(H * (narrow ? 0.42 : 0.44));
    L = {
      narrow,
      fs: narrow ? 10 : 11,
      fsv: narrow ? 9 : 10,
      fieldTop,
      fieldBot: panelA - barsH - 24,   // room for the "observed" caption
      barsTop: panelA - barsH,
      plotL: padL,
      plotR: W - padR,
      plotT: panelA + (narrow ? 46 : 52),   // room for a status row above the plot
      plotB: H - (narrow ? 24 : 28),
    };
  }

  // ── Drawing helpers ────────────────────────────────────────────────────
  function text(str, x, y, colour, size, align, bold) {
    ctx.fillStyle = colour;
    ctx.font = `${bold ? "600 " : ""}${size}px ui-monospace, monospace`;
    ctx.textAlign = align || "left";
    ctx.fillText(str, x, y);
  }

  function stackedBar(x, y, w, h, parts) {
    let cx = x;
    parts.forEach(([frac, colour]) => {
      const seg = w * frac;
      if (seg <= 0) return;
      ctx.fillStyle = colour;
      ctx.fillRect(cx, y, Math.max(seg, 0.6), h);
      // Percentages only where the segment is wide enough to hold them.
      if (seg > 34) {
        text(`${(frac * 100).toFixed(0)}%`, cx + seg / 2, y + h / 2 + 3.5,
             "rgba(10,14,26,0.86)", L.fsv, "center", true);
      }
      cx += seg;
    });
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b1018");
    bg.addColorStop(1, "#0d1222");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const { fs, fsv, plotL, plotR, plotT, plotB, narrow } = L;
    const p = freqA(pop);
    const q = 1 - p;
    const nAA = pop.AA, nAa = pop.Aa, nbb = pop.aa;

    // ── Panel A: the population, one dot per individual ──────────────────
    const legendY = narrow ? 16 : 18;
    let lx = plotL;
    [[C_AA, "AA", nAA], [C_AB, "Aa", nAa], [C_BB, "aa", nbb]].forEach(([c, lbl, n]) => {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(lx + 4, legendY - 3.5, 4, 0, Math.PI * 2); ctx.fill();
      text(`${lbl} ${n}`, lx + 13, legendY, "rgba(226,234,248,0.88)", fs, "left", true);
      lx += (narrow ? 74 : 92);
    });
    text(`N = ${N}`, plotR, legendY, "rgba(226,234,248,0.6)", fsv, "right");

    const fw = plotR - plotL;
    const fh = L.fieldBot - L.fieldTop;
    const cols = Math.max(1, Math.round(Math.sqrt(N * (fw / Math.max(fh, 1)))));
    const rows = Math.ceil(N / cols);
    const cell = Math.min(fw / cols, fh / rows);
    const r = Math.max(1.4, cell * 0.34);
    const ox = plotL + (fw - cols * cell) / 2 + cell / 2;
    const oy = L.fieldTop + (fh - rows * cell) / 2 + cell / 2;
    for (let i = 0; i < N; i++) {
      const slot = order[i];
      ctx.fillStyle = i < nAA ? C_AA : i < nAA + nAa ? C_AB : C_BB;
      ctx.beginPath();
      ctx.arc(ox + (slot % cols) * cell, oy + Math.floor(slot / cols) * cell, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Observed composition against the Hardy–Weinberg expectation for the
    // same p. Any gap between the two bars is departure from random mating
    // proportions — with selection acting, the adults are not at H–W.
    const bh = 16;
    text(i18nText("nsObserved", "observed"), plotL, L.barsTop - 4,
         "rgba(226,234,248,0.62)", fsv, "left");
    stackedBar(plotL, L.barsTop, fw, bh,
      [[nAA / N, C_AA], [nAa / N, C_AB], [nbb / N, C_BB]]);
    text(i18nText("nsExpected", "Hardy–Weinberg expected for this p"), plotL, L.barsTop + bh + 15,
         "rgba(226,234,248,0.62)", fsv, "left");
    stackedBar(plotL, L.barsTop + bh + 20, fw, bh,
      [[p * p, C_AA], [2 * p * q, C_AB], [q * q, C_BB]]);

    // ── Panel B: allele frequency against generation ─────────────────────
    const span = Math.max(60, Math.ceil(Math.max(gen, 1) / 30) * 30);
    const X = (g) => plotL + (g / span) * (plotR - plotL);
    const Y = (v) => plotB - v * (plotB - plotT);

    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      ctx.moveTo(plotL, Y(v) + 0.5); ctx.lineTo(plotR, Y(v) + 0.5); ctx.stroke();
      text(v.toFixed(2), plotL - 6, Y(v) + 3.5, "rgba(226,234,248,0.5)", fsv, "right");
    }
    // Tick labels are skipped near the right edge so they never collide with
    // the axis caption sitting there.
    const axisY = plotB + (narrow ? 15 : 17);
    const capW = ctx.measureText(i18nText("nsGeneration", "generation")).width + 26;
    for (let g = 0; g <= span; g += span / (narrow ? 3 : 6)) {
      if (X(g) > plotR - capW) continue;
      text(String(Math.round(g)), X(g), axisY, "rgba(226,234,248,0.5)", fsv, "center");
    }
    text(i18nText("nsFreqA", "frequency of A"), plotL - 6, plotT - 12,
         "rgba(226,234,248,0.62)", fsv, "left");
    text(i18nText("nsGeneration", "generation"), plotR, axisY,
         "rgba(226,234,248,0.5)", fsv, "right");

    // Interior equilibrium, when there is one.
    const eq = equilibrium();
    if (eq) {
      ctx.strokeStyle = eq.stable ? "rgba(120,230,190,0.55)" : "rgba(255,140,160,0.5)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(plotL, Y(eq.p)); ctx.lineTo(plotR, Y(eq.p)); ctx.stroke();
      ctx.setLineDash([]);
    }

    const trace = (hist, colour, width) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let g = 0; g < hist.length; g++) {
        const x = X(g), y = Y(hist[g]);
        g ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    histReps.forEach((h) => trace(h, "rgba(123,224,208,0.26)", 1.2));
    trace(histDet, C_DET, 2.2);
    trace(histPop, C_POP, 2);

    ctx.fillStyle = C_POP;
    ctx.beginPath(); ctx.arc(X(gen), Y(p), 3.4, 0, Math.PI * 2); ctx.fill();

    // The p* label goes on last, over its own plate, so the traces that
    // cluster around the equilibrium cannot make it unreadable.
    if (eq) {
      const label = `p* = ${eq.p.toFixed(3)} · ${eq.stable
        ? i18nText("nsStable", "stable")
        : i18nText("nsUnstable", "unstable")}`;
      ctx.font = `${fsv}px ui-monospace, monospace`;
      const tw = ctx.measureText(label).width;
      const ly2 = Y(eq.p) - (eq.p > 0.88 ? -16 : 8);   // flip below the line up top
      ctx.fillStyle = "rgba(11,17,32,0.82)";
      ctx.fillRect(plotR - tw - 10, ly2 - fsv - 2, tw + 10, fsv + 8);
      text(label, plotR - 5, ly2,
           eq.stable ? "rgba(120,230,190,0.95)" : "rgba(255,140,160,0.92)", fsv, "right");
    }

    // Legend for the two tracks.
    const ly = plotT - 12;
    let x2 = plotR;
    const key = (colour, label) => {
      const wgt = ctx.measureText(label).width;
      text(label, x2, ly, "rgba(226,234,248,0.72)", fsv, "right");
      ctx.strokeStyle = colour; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x2 - wgt - 20, ly - 3.5); ctx.lineTo(x2 - wgt - 6, ly - 3.5);
      ctx.stroke();
      x2 -= wgt + 32;
    };
    ctx.font = `${fsv}px ui-monospace, monospace`;
    key(C_POP, i18nText("nsPopulation", "this population"));
    key(C_DET, i18nText("nsDeterministic", "infinite N"));

    // Status.
    let status = "";
    if (extinct) status = i18nText("nsExtinct", "extinct — no genotype survives");
    else if (p === 1) status = i18nText("nsFixed", "A fixed — a is gone for good");
    else if (p === 0) status = i18nText("nsLost", "A lost — a is fixed instead");
    else if (gen >= MAX_GEN) status = i18nText("nsMaxGen", "generation limit reached");
    if (status) {
      // Its own row above the plot, so it never lands on the axis caption or
      // the track legend that share the line below it.
      text(status, (plotL + plotR) / 2, plotT - 30,
           extinct || p === 0 ? "rgba(255,140,160,0.95)" : "rgba(120,230,190,0.95)",
           fs, "center", true);
    }
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  const f3 = (v) => v.toFixed(3);
  function updateReadouts() {
    const p = freqA(pop), q = 1 - p;
    out.gen.textContent = String(gen);
    out.p.textContent = f3(p);
    out.pdet.textContent = f3(pDet);
    out.geno.textContent = `${f3(pop.AA / N)} · ${f3(pop.Aa / N)} · ${f3(pop.aa / N)}`;
    out.hw.textContent = `${f3(p * p)} · ${f3(2 * p * q)} · ${f3(q * q)}`;
    out.wbar.textContent = f3(meanFitness(p));
  }

  function updateLabels() {
    inputValues.waa.textContent = parseFloat(inputs.waa.value).toFixed(2);
    inputValues.wab.textContent = parseFloat(inputs.wab.value).toFixed(2);
    inputValues.wbb.textContent = parseFloat(inputs.wbb.value).toFixed(2);
    inputValues.p0.textContent = parseFloat(inputs.p0.value).toFixed(2);
    inputValues.popn.textContent = inputs.popn.value;
    inputValues.speed.textContent = inputs.speed.value;
  }

  function setPauseLabel() {
    pauseBtn.textContent = running
      ? i18nText("wavePauseBtn", "Pause")
      : i18nText("waveResumeBtn", "Resume");
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let lastTs = performance.now();
  let raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    if (running && !extinct && gen < MAX_GEN) {
      acc += dt * parseInt(inputs.speed.value, 10);
      let guard = 0;
      while (acc >= 1 && guard++ < 8) { stepGeneration(); acc -= 1; }
      if (acc > 1) acc = 0;
    }
    render();
    updateReadouts();
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function markPreset(key) {
    presetList.querySelectorAll(".mol-btn").forEach((b) => {
      const on = b.dataset.key === key;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  /** Highlight whichever preset the current fitnesses happen to match. */
  function syncPreset() {
    const hit = Object.entries(PRESETS).find(([, v]) =>
      Math.abs(v.wAA - wAA) < 1e-9 && Math.abs(v.wAa - wAa) < 1e-9 && Math.abs(v.waa - waa) < 1e-9);
    markPreset(hit ? hit[0] : null);
  }

  function applyPreset(key) {
    const v = PRESETS[key];
    if (!v) return;
    inputs.waa.value = String(v.wAA);
    inputs.wab.value = String(v.wAa);
    inputs.wbb.value = String(v.waa);
    markPreset(key);
    updateLabels();
    reset();
  }

  presetList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyPreset(btn.dataset.key);
      window.SFX?.tone({ freq: 540, dur: 0.08, type: "triangle", gain: 0.1 });
    });
  });

  // Fitness, starting frequency and N all define the run, so changing any of
  // them restarts it — continuing would mix two different experiments.
  [inputs.waa, inputs.wab, inputs.wbb, inputs.p0, inputs.popn].forEach((el) => {
    el.addEventListener("input", () => { updateLabels(); reset(); syncPreset(); });
  });
  inputs.speed.addEventListener("input", updateLabels);

  pauseBtn.addEventListener("click", () => {
    running = !running;
    setPauseLabel();
    window.SFX?.click({ gain: 0.22 });
  });
  stepBtn.addEventListener("click", () => {
    running = false;
    setPauseLabel();
    stepGeneration();
    window.SFX?.click({ gain: 0.18, freq: 1600 });
  });
  resetBtn.addEventListener("click", () => {
    reset();
    running = true;
    setPauseLabel();
    window.SFX?.click({ gain: 0.22 });
  });

  document.addEventListener("langchange", () => { setPauseLabel(); updateReadouts(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  function resizeCanvas() {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 260);
    H = W < 560 ? 520 : 560;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the harness can check the model against the closed forms.
  window.__ns = {
    detStep, meanFitness, equilibrium, freqA, wfStep, founder,
    setFitness: (a, b, c) => { wAA = a; wAa = b; waa = c; },
    state: () => ({ gen, p: freqA(pop), pDet, N, extinct,
                    geno: { ...pop }, wbar: meanFitness(freqA(pop)) }),
    stepGeneration, reset,
    setRunning: (v) => { running = v; setPauseLabel(); },
  };

  resizeCanvas();
  updateLabels();
  reset();
  setPauseLabel();
  start();
})();
