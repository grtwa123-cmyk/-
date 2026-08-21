/*
 * Gene expression noise — where a Poisson distribution comes from.
 *
 * A field of cells, each carrying one copy of one gene. The gene flips
 * between OFF and ON at its own two rates; while it is ON it transcribes;
 * every mRNA molecule eventually degrades. That is the whole mechanism, and
 * it is written in molecules and coin flips. There is no distribution in it.
 *
 * Then look across the cells. They were all built the same way and none of
 * them was told what to hold, and yet the spread of their counts is not
 * arbitrary — it is a specific shape with a specific width:
 *
 *   mean   m = k·kon / (γ·(kon + koff))
 *   Fano   F = variance / mean = 1 + k·koff / ((kon + koff)·(kon + koff + γ))
 *
 * The second one is the interesting number. A gene that never switches off
 * gives F = 1 exactly — the count is Poisson, and the variance equals the
 * mean for no reason the cell knows about. Let the gene start switching and
 * F climbs above 1: the extra width is the bursting, and how far above tells
 * you how big the bursts were. Neither expression appears anywhere in step().
 *
 * The step is exact rather than first order. Molecules already present are
 * thinned by e^(−γ·DT); the ones made *during* the step are added as
 * Poisson(k(1 − e^(−γ·DT))/γ), which is the integral of production times the
 * survival left in the step. Producing first and decaying the whole lot
 * afterwards instead costs the mean γ·DT/2, which at the step size here is
 * half a percent — small enough that none of the checks in
 * tests/experiments/expression.test.mjs can tell the two apart, as planting
 * the cheap version confirms. It is kept because it is free and it is right,
 * not because anything is guarding it; at a coarser step it would matter,
 * and an earlier draft running DT = 0.05 did lean 2.5% low.
 */
(() => {
  "use strict";

  // Minutes of cell time per step. build() bakes the per-step probabilities
  // from this, so the quality toggle rebuilds the field when it moves; the
  // steps-per-frame scale by the same ratio, so Fine costs CPU, not pace.
  const DT_STD = 0.01;
  let DT = window.Quality ? window.Quality.pick(DT_STD, 0.004) : DT_STD;

  const stage = document.getElementById("stage");
  if (!stage) return;
  const ctx = stage.getContext("2d");

  const inputs = {
    cells:  document.getElementById("cells"),
    rate:   document.getElementById("rate"),
    kon:    document.getElementById("kon"),
    koff:   document.getElementById("koff"),
    decay:  document.getElementById("decay"),
    speed:  document.getElementById("speed"),
  };
  const inputValues = {
    cells:  document.getElementById("cells-value"),
    rate:   document.getElementById("rate-value"),
    kon:    document.getElementById("kon-value"),
    koff:   document.getElementById("koff-value"),
    decay:  document.getElementById("decay-value"),
    speed:  document.getElementById("speed-value"),
  };
  const out = {
    mean:     document.getElementById("out-mean"),
    meanT:    document.getElementById("out-mean-theory"),
    variance: document.getElementById("out-variance"),
    fano:     document.getElementById("out-fano"),
    fanoT:    document.getElementById("out-fano-theory"),
    duty:     document.getElementById("out-duty"),
    dutyT:    document.getElementById("out-duty-theory"),
    silent:   document.getElementById("out-silent"),
    shape:    document.getElementById("out-shape"),
    time:     document.getElementById("out-time"),
  };
  const startBtn = document.getElementById("start-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) => window.i18n?.t?.(key) ?? fallback;

  // ── Random draws ───────────────────────────────────────────────────────
  /** Poisson by Knuth's product, normal above 30 where the product underflows. */
  function poisson(mean) {
    if (!(mean > 0)) return 0;
    if (mean > 30) {
      const u = Math.random() || 1e-12, v = Math.random();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.max(0, Math.round(mean + Math.sqrt(mean) * z));
    }
    const L = Math.exp(-mean);
    let n = 0, p = 1;
    do { n++; p *= Math.random(); } while (p > L);
    return n - 1;
  }

  /**
   * Binomial by geometric skipping — one random number per success rather
   * than per trial. A cell can hold hundreds of molecules each with a one
   * percent chance of decaying this step, and rolling every one of them is
   * sixteen times slower for the same answer.
   */
  function binomial(n, p) {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    const logq = Math.log(1 - p);
    let count = 0, i = -1;
    for (;;) {
      i += 1 + Math.floor(Math.log(1 - Math.random()) / logq);
      if (i >= n) return count;
      count++;
    }
  }

  // ── Parameters ─────────────────────────────────────────────────────────
  function readParams() {
    return {
      cells: parseInt(inputs.cells.value, 10),
      k:     parseFloat(inputs.rate.value),
      kon:   parseFloat(inputs.kon.value),
      koff:  parseFloat(inputs.koff.value),
      g:     parseFloat(inputs.decay.value),
      speed: parseInt(inputs.speed.value, 10),
    };
  }

  function updateLabels(p) {
    inputValues.cells.textContent = p.cells;
    inputValues.rate.textContent = p.k.toFixed(0);
    inputValues.kon.textContent = p.kon.toFixed(1);
    inputValues.koff.textContent = p.koff === 0
      ? i18nText("exprNeverOff", "never") : p.koff.toFixed(1);
    inputValues.decay.textContent = p.g.toFixed(2);
    inputValues.speed.textContent = p.speed;
  }

  // ── State ──────────────────────────────────────────────────────────────
  let s = null;
  let running = false;
  let raf = 0;
  let lastTs = 0;

  function build(p) {
    const duty = p.koff > 0 ? p.kon / (p.kon + p.koff) : 1;
    const st = {
      p,
      m: new Int32Array(p.cells),
      on: new Uint8Array(p.cells),
      t: 0,
      // Cached per-step probabilities. kAlive is the mean number of molecules
      // transcribed during a step that have not already degraded by the end
      // of it: ∫₀^DT k·e^(−γ(DT−u)) du.
      pOn: 1 - Math.exp(-p.kon * DT),
      pOff: 1 - Math.exp(-p.koff * DT),
      pDec: 1 - Math.exp(-p.g * DT),
      kAlive: (p.k * (1 - Math.exp(-p.g * DT))) / p.g,
    };
    // Start each gene in its own long-run state so the field is not all
    // switching on together — that transient is not what the page is about.
    for (let i = 0; i < p.cells; i++) st.on[i] = Math.random() < duty ? 1 : 0;
    return st;
  }

  function step(st) {
    const { m, on, pOn, pOff, pDec, kAlive } = st;
    const n = m.length;
    for (let i = 0; i < n; i++) {
      if (on[i]) { if (Math.random() < pOff) on[i] = 0; }
      else if (Math.random() < pOn) on[i] = 1;
      m[i] = m[i] - binomial(m[i], pDec) + (on[i] ? poisson(kAlive) : 0);
    }
    st.t += DT;
  }

  // ── What the field says about itself ───────────────────────────────────
  /**
   * Mean, variance and Fano factor over the cells as they stand — a single
   * snapshot across the population, not an average over time. The cells are
   * independent of one another, which is what makes the snapshot a clean
   * sample; consecutive snapshots are not, so nothing here averages them.
   */
  function measure(st) {
    const { m, on } = st;
    const n = m.length;
    let sum = 0, sumSq = 0, onCount = 0, zero = 0, max = 0;
    for (let i = 0; i < n; i++) {
      const v = m[i];
      sum += v; sumSq += v * v;
      if (v === 0) zero++;
      if (v > max) max = v;
      onCount += on[i];
    }
    const mean = sum / n;
    // Bessel: the population mean was estimated from the same cells.
    const variance = n > 1 ? (sumSq - (sum * sum) / n) / (n - 1) : 0;
    const { k, kon, koff, g } = st.p;
    const total = sum;
    return {
      mean, variance, total, max,
      // A Fano factor read off a handful of molecules is not a measurement.
      fano: total >= 200 ? variance / mean : NaN,
      silent: zero / n,
      duty: onCount / n,
      dutyTheory: koff > 0 ? kon / (kon + koff) : 1,
      meanTheory: (k * kon) / (g * (kon + koff)),
      fanoTheory: 1 + (k * koff) / ((kon + koff) * (kon + koff + g)),
      t: st.t,
    };
  }

  /** Poisson pmf at n for the given mean, by logs so large n does not blow up. */
  function poissonPmf(n, mean) {
    if (mean <= 0) return n === 0 ? 1 : 0;
    let logP = -mean + n * Math.log(mean);
    for (let i = 2; i <= n; i++) logP -= Math.log(i);
    return Math.exp(logP);
  }

  /** The histogram of counts across the cells, as bin -> how many cells. */
  function histogram(st, bins) {
    const h = new Int32Array(bins);
    const m = st.m;
    for (let i = 0; i < m.length; i++) {
      const b = Math.min(bins - 1, m[i]);
      h[b]++;
    }
    return h;
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  let W = stage.width, H = stage.height;

  function css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function render() {
    if (!s) return;
    const acc = css("--accent", "#ff6b8a");
    const muted = css("--muted", "#97a0bf");
    const fg = css("--fg", "#e6ecff");
    ctx.clearRect(0, 0, W, H);

    const gap = 16;
    const fieldW = Math.round(W * 0.52);
    const histX = fieldW + gap;
    const histW = W - histX - 8;

    // ── The field of cells ──
    // A top band keeps the captions off the squares; the first cut drew them
    // over the bottom row and pushed the histogram's legend clean off the
    // canvas.
    const bandY = 14, fieldTop = 22;
    ctx.fillStyle = acc;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(i18nText("exprFieldLabel", "one square = one cell"), 4, bandY);

    const n = s.m.length;
    const fieldH = H - fieldTop;
    const cols = Math.ceil(Math.sqrt(n * (fieldW / fieldH)));
    const rows = Math.ceil(n / cols);
    const cw = fieldW / cols, ch = fieldH / rows;
    const size = Math.max(1.5, Math.min(cw, ch) - Math.min(2, Math.min(cw, ch) * 0.18));
    const mx = Math.max(1, s.__scale || 1);
    // The ring marks a gene that is ON — but only when the dials let it ever
    // be off. With switching disabled every ring is lit all the time, and a
    // mark that cannot vary is not information, just mesh over the colours.
    const ringShown = s.p.koff > 0 && size >= 4;
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = (i / cols) | 0;
      const x = c * cw + (cw - size) / 2, y = fieldTop + r * ch + (ch - size) / 2;
      const load = Math.min(1, s.m[i] / mx);
      // Brightness is the molecule count; the ring is the gene being on.
      ctx.fillStyle = `rgba(255, 107, 138, ${0.06 + 0.94 * load})`;
      ctx.fillRect(x, y, size, size);
      if (ringShown && s.on[i]) {
        ctx.strokeStyle = "rgba(120, 240, 200, 0.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 0.5, y - 0.5, size + 1, size + 1);
      }
    }

    // ── The histogram, with the Poisson of the same mean over it ──
    const stat = measure(s);
    const bins = Math.max(8, Math.min(60, Math.ceil(stat.max * 1.15) + 1));
    const h = histogram(s, bins);
    const peak = Math.max(1, ...h);
    const bw = histW / bins;
    const base = H - 26;

    ctx.fillStyle = muted;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(i18nText("exprHistLabel", "mRNA per cell"), histX, bandY);

    // The Poisson legend lives in the top band with a sample of its own
    // line. It used to sit below the axis captions, which was below the
    // canvas: the one label explaining the comparison was never visible.
    ctx.strokeStyle = fg;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.6;
    const legendLabel = i18nText("exprPoissonLabel", "Poisson of the same mean");
    const legendW = ctx.measureText(legendLabel).width;
    const legendX = Math.max(histX + 96, histX + histW - legendW - 26);
    ctx.beginPath();
    ctx.moveTo(legendX, bandY - 4); ctx.lineTo(legendX + 18, bandY - 4);
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.fillText(legendLabel, legendX + 24, bandY);
    ctx.globalAlpha = 1;

    for (let b = 0; b < bins; b++) {
      const bh = (h[b] / peak) * (base - 26);
      ctx.fillStyle = "rgba(255, 107, 138, 0.55)";
      ctx.fillRect(histX + b * bw, base - bh, Math.max(1, bw - 1), bh);
    }

    // The Poisson with the measured mean — what the spread would be if the
    // gene never switched off. Drawn, never read back.
    if (stat.mean > 0) {
      ctx.strokeStyle = fg;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (let b = 0; b < bins; b++) {
        const y = base - (poissonPmf(b, stat.mean) * n / peak) * (base - 26);
        const x = histX + (b + 0.5) * bw;
        if (b === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = muted;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(histX, base + 0.5); ctx.lineTo(histX + histW, base + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = muted;
    ctx.textAlign = "left";
    ctx.fillText("0", histX, base + 15);
    ctx.textAlign = "right";
    ctx.fillText(String(bins - 1), histX + histW, base + 15);
    ctx.textAlign = "left";
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

  function updateReadouts() {
    if (!s) return;
    const q = measure(s);
    // A running scale for the brightness so the field does not go all-white
    // the moment the mean climbs. Tracked slowly; it is decoration.
    s.__scale = s.__scale ? s.__scale * 0.97 + Math.max(1, q.max) * 0.03
                          : Math.max(1, q.max);
    out.mean.textContent = fmt(q.mean);
    out.meanT.textContent = fmt(q.meanTheory);
    out.variance.textContent = fmt(q.variance);
    out.fano.textContent = fmt(q.fano, 3);
    out.fanoT.textContent = fmt(q.fanoTheory, 3);
    out.duty.textContent = fmt(q.duty * 100, 1) + "%";
    out.dutyT.textContent = fmt(q.dutyTheory * 100, 1) + "%";
    out.silent.textContent = fmt(q.silent * 100, 1) + "%";
    out.time.textContent = q.t.toFixed(1);

    // What the width is saying, in words. The boundary is not a judgement
    // about the dials — it is read off the measurement.
    let shape;
    if (!Number.isFinite(q.fano)) shape = i18nText("exprShapeQuiet", "too few molecules to say");
    else if (q.fano < 1.15) shape = i18nText("exprShapePoisson", "Poisson — variance is the mean");
    else if (q.fano < 3) shape = i18nText("exprShapeMild", "wider than Poisson — small bursts");
    else shape = i18nText("exprShapeBursty", "far wider than Poisson — bursty");
    out.shape.textContent = shape;
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    // Step only while the clock advances: under prefers-reduced-motion the
    // rAF timestamp is frozen, and a loop that ignored it kept stepping at
    // full tilt behind a notice that said "paused". Real frames never repeat
    // a timestamp, so outside the gate this changes nothing.
    const moved = ts !== lastTs;
    lastTs = ts;
    if (running && s && moved) {
      const n = Math.round(s.p.speed * (DT_STD / DT));
      for (let i = 0; i < n; i++) step(s);
    }
    render();
    updateReadouts();
  }

  function reset() {
    const p = readParams();
    updateLabels(p);
    s = build(p);
    render();
    updateReadouts();
  }

  function syncStartBtn() {
    startBtn.textContent = running
      ? i18nText("wavePauseBtn", "Pause")
      : i18nText("startBtn", "Start");
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  for (const [name, el] of Object.entries(inputs)) {
    el.addEventListener("input", () => {
      const p = readParams();
      updateLabels(p);
      // Speed is not part of the biology, so it does not disturb the run.
      if (name === "speed") { if (s) s.p.speed = p.speed; return; }
      reset();
    });
  }

  startBtn.addEventListener("click", () => {
    running = !running;
    syncStartBtn();
  });
  resetBtn.addEventListener("click", () => {
    running = false;
    syncStartBtn();
    reset();
  });

  function resize() {
    const rect = stage.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(Math.round(rect.width) - 2, 320);
    H = Math.round(W * 0.5);
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }
  window.addEventListener("resize", resize);
  // "langchange" on document is what i18n.js actually fires. This listened
  // for "i18n:change" on window at first — an event nothing has ever sent —
  // so a language switch mid-run repainted the running page's button as
  // "Start" and left the koff dial's "never" in the old language.
  document.addEventListener("langchange", () => { syncStartBtn(); updateLabels(readParams()); });

  resize();
  reset();
  syncStartBtn();
  raf = requestAnimationFrame(frame);

  // CSV: the histogram as it stands, which is the thing being claimed about.
  window.CSVExport?.attach("csv-btn", () => {
    if (!s) return null;
    const q = measure(s);
    const bins = Math.max(8, Math.ceil(q.max * 1.15) + 1);
    const h = histogram(s, bins);
    // Name with the extension and title/meta filled in: the first version
    // skipped them, and the file opened "# Science Lab — undefined" with no
    // record of the dials that produced it.
    return {
      name: "gene-expression.csv",
      title: "Gene Expression — noise across the field",
      columns: ["mRNA_per_cell", "cells", "fraction", "poisson_fraction"],
      rows: Array.from(h, (count, n) => [
        n, count, count / s.m.length, poissonPmf(n, q.mean),
      ]),
      meta: {
        cells: s.m.length, transcription_rate: s.p.k,
        k_on: s.p.kon, k_off: s.p.koff, decay_rate: s.p.g, step_dt: DT,
        minutes_elapsed: s.t,
        mean_measured: q.mean, mean_theory: q.meanTheory,
        fano_measured: q.fano, fano_theory: q.fanoTheory,
      },
    };
  });

  /*
   * The hook the suite measures through. run() carries a field to steady
   * state and reports it, headlessly — a check is then a whole population
   * rather than a few seconds of animation, and nothing samples the clock.
   */
  document.addEventListener("qualitychange", () => {
    DT = window.Quality.pick(DT_STD, 0.004);
    running = false; syncStartBtn(); reset();
  });

  window.__expr = {
    get DT() { return DT; },
    params: readParams,
    build, step, measure, histogram, poissonPmf,
    state: () => s,
    reset,
    setRunning: (v) => { running = !!v; syncStartBtn(); },
    isRunning: () => running,
    run(q, settle = 12) {
      const p = { cells: 800, k: 20, kon: 1, koff: 0, g: 1, speed: 1, ...q };
      const st = build(p);
      // Settle for several mRNA lifetimes; the memory of an empty start
      // decays as e^(−γt), so twelve of them leaves none of it.
      const steps = Math.ceil(settle / (p.g * DT));
      for (let i = 0; i < steps; i++) step(st);
      return measure(st);
    },
  };
})();
