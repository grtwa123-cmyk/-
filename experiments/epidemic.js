/*
 * Epidemic — R₀ counted, not typed in.
 *
 * A population of individuals meets at random. Each infected one makes
 * contacts at some rate; a contact with a susceptible transmits with some
 * probability; after a while the infected recovers and is immune. That is the
 * whole mechanism, and it is all this file knows. It contains no R₀, no final
 * size and no epidemic peak.
 *
 * Those come back out of it:
 *
 *   R₀       transmissions ÷ (infected-time × the susceptible fraction),
 *            times the mean infectious period — both counted off the run
 *   final    the fraction ever infected, which the textbook says solves
 *            r = 1 − e^(−R₀r), a transcendental equation with no closed form
 *   peak     the largest fraction infectious at once, against
 *            1 − (1 + ln R₀)/R₀
 *
 * Three ways to measure R₀ were tried offline before any of this was built.
 * Averaging the secondary infections of the index cases is ten samples and
 * far too noisy — it read 0.97 for a population set to 1.20. Fitting the early
 * exponential growth and dividing by the recovery rate, R₀ = 1 + r/γ, came out
 * 8% low at every setting; splitting the estimator showed the infectious
 * period was right to 0.8% and the growth-rate fit was the culprit, and
 * neither a tighter window nor skipping the seeding transient fixed it. What
 * works is counting: β within 0.2–1% of its set value, R₀ within 1.5%, the
 * final size within 0.5% and the peak within 2.5%.
 *
 * Well mixed, and it has to be said out loud
 * ------------------------------------------
 * Contact partners are drawn uniformly from the whole population, not from
 * some neighbourhood. That is what "well mixed" means and it is the assumption
 * the two closed forms rest on. The dots moving in the box are a picture of
 * the epidemic, not its contact structure — a genuinely spatial model spreads
 * as a wave, reaches a different final size, and comparing it to these
 * formulas would be dishonest. The page says so, and so does this comment.
 */
(() => {
  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");

  const inputs = {
    pop: document.getElementById("pop"),
    contact: document.getElementById("contact"),
    transmit: document.getElementById("transmit"),
    recover: document.getElementById("recover"),
    speed: document.getElementById("speed"),
  };
  const vals = {
    pop: document.getElementById("pop-value"),
    contact: document.getElementById("contact-value"),
    transmit: document.getElementById("transmit-value"),
    recover: document.getElementById("recover-value"),
    speed: document.getElementById("speed-value"),
  };
  const out = {
    s: document.getElementById("out-s"),
    i: document.getElementById("out-i"),
    r: document.getElementById("out-r"),
    r0: document.getElementById("out-r0"),
    beta: document.getElementById("out-beta"),
    period: document.getElementById("out-period"),
    final: document.getElementById("out-final"),
    finalTheory: document.getElementById("out-final-theory"),
    peak: document.getElementById("out-peak"),
    peakTheory: document.getElementById("out-peak-theory"),
    verdict: document.getElementById("out-verdict"),
    time: document.getElementById("out-time"),
  };
  const startBtn = document.getElementById("start-btn");
  const resetBtn = document.getElementById("reset-btn");

  const S = 0, I = 1, R = 2;
  const DT = 0.05;                 // fixed step, in units of the time axis

  let st = null;
  let running = false;
  let raf = 0;

  const readParams = () => ({
    N: parseInt(inputs.pop.value, 10),
    c: parseFloat(inputs.contact.value),
    p: parseFloat(inputs.transmit.value),
    g: parseFloat(inputs.recover.value),
    speed: parseInt(inputs.speed.value, 10),
  });

  /** A fresh population, all susceptible but for a few seeds. */
  function build(q) {
    const seeds = Math.max(1, Math.round(q.N * 0.004));
    const s = {
      N: q.N, c: q.c, p: q.p, g: q.g,
      state: new Uint8Array(q.N),
      tInf: new Float64Array(q.N).fill(-1),
      x: new Float64Array(q.N), y: new Float64Array(q.N),
      vx: new Float64Array(q.N), vy: new Float64Array(q.N),
      nS: q.N - seeds, nI: seeds, nR: 0,
      t: 0,
      /*
       * The three tallies every measurement below is built from. Nothing else
       * is recorded, and nothing here is a rate or a ratio yet.
       */
      transmissions: 0,        // how many infections actually happened
      exposure: 0,             // Σ (infectious × susceptible fraction) dt
      periodSum: 0,            // Σ (recovery time − infection time)
      recovered: 0,            // how many of those there have been
      peakI: seeds,
      curve: [{ t: 0, s: q.N - seeds, i: seeds, r: 0 }],
      live: [],
    };
    for (let k = 0; k < q.N; k++) {
      s.x[k] = Math.random();
      s.y[k] = Math.random();
      const th = Math.random() * Math.PI * 2;
      s.vx[k] = Math.cos(th) * 0.04;
      s.vy[k] = Math.sin(th) * 0.04;
    }
    for (let k = 0; k < seeds; k++) { s.state[k] = I; s.live.push(k); }
    return s;
  }

  /** Poisson(λ) by Knuth's product method — λ is small here, so this is cheap. */
  function poisson(lambda) {
    const L = Math.exp(-lambda);
    let k = 0, q = Math.random();
    while (q > L) { q *= Math.random(); k++; }
    return k;
  }

  /**
   * One step of the mechanism. Contacts, then transmission, then recovery —
   * and the tallies that let the epidemic be measured afterwards.
   */
  function step(s) {
    const next = [];
    for (const k of s.live) {
      if (s.state[k] !== I) continue;
      const contacts = poisson(s.c * DT);
      for (let m = 0; m < contacts; m++) {
        // Uniform over the whole population: "well mixed", and the assumption
        // the closed forms need. Not a neighbourhood.
        const j = (Math.random() * s.N) | 0;
        if (s.state[j] === S && Math.random() < s.p) {
          s.state[j] = I;
          s.tInf[j] = s.t;
          s.nS--; s.nI++;
          s.transmissions++;
          next.push(j);
        }
      }
      if (Math.random() < s.g * DT) {
        s.state[k] = R;
        s.nI--; s.nR++;
        s.periodSum += s.t - s.tInf[k];
        s.recovered++;
      } else {
        next.push(k);
      }
    }
    // Weighted by who is still available to infect, so the rate this yields is
    // the mass-action β rather than an average over a shrinking pool.
    s.exposure += s.nI * (s.nS / s.N) * DT;
    s.live = next;
    s.t += DT;
    if (s.nI > s.peakI) s.peakI = s.nI;
    s.curve.push({ t: s.t, s: s.nS, i: s.nI, r: s.nR });

    // The dots are decoration; they do not decide who meets whom.
    for (let k = 0; k < s.N; k++) {
      s.x[k] += s.vx[k] * DT; s.y[k] += s.vy[k] * DT;
      if (s.x[k] < 0 || s.x[k] > 1) { s.vx[k] *= -1; s.x[k] = Math.min(1, Math.max(0, s.x[k])); }
      if (s.y[k] < 0 || s.y[k] > 1) { s.vy[k] *= -1; s.y[k] = Math.min(1, Math.max(0, s.y[k])); }
    }
  }

  /** Everything the panel reports, derived from the three tallies. */
  function measure(s) {
    const beta = s.exposure > 0 ? s.transmissions / s.exposure : NaN;
    const period = s.recovered > 0 ? s.periodSum / s.recovered : NaN;
    const r0 = beta * period;
    return {
      beta, period, r0,
      finalFraction: s.nR / s.N,
      peakFraction: s.peakI / s.N,
      // The textbook answers, evaluated at the R₀ that was measured — not at
      // the one the sliders imply, or the comparison would be circular.
      finalTheory: finalSize(r0),
      peakTheory: r0 > 1 ? 1 - (1 + Math.log(r0)) / r0 : 0,
      done: s.nI === 0,
    };
  }

  /**
   * The r solving r = 1 − e^(−R₀r), by bisection.
   *
   * There is no closed form for it — which is the point of putting it beside a
   * measurement. Below R₀ = 1 the only root is zero: no epidemic.
   */
  function finalSize(r0) {
    if (!(r0 > 1)) return 0;
    let lo = 1e-12, hi = 1 - 1e-15;
    for (let k = 0; k < 200; k++) {
      const m = (lo + hi) / 2;
      if (1 - Math.exp(-r0 * m) - m > 0) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  const COL = { s: "#6ea8ff", i: "#ff6b8a", r: "#7be0d0" };

  function draw() {
    const w = canvas.width, h = canvas.height;
    const css = getComputedStyle(document.body);
    ctx.clearRect(0, 0, w, h);
    if (!st) return;

    const boxW = Math.round(w * 0.46);
    // ── the population, as dots ──
    ctx.save();
    ctx.beginPath(); ctx.rect(8, 8, boxW - 16, h - 16); ctx.clip();
    for (let k = 0; k < st.N; k++) {
      ctx.fillStyle = st.state[k] === S ? COL.s : st.state[k] === I ? COL.i : COL.r;
      ctx.globalAlpha = st.state[k] === R ? 0.45 : 0.95;
      const px = 8 + st.x[k] * (boxW - 16);
      const py = 8 + st.y[k] * (h - 16);
      ctx.beginPath();
      ctx.arc(px, py, st.N > 400 ? 1.8 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = css.getPropertyValue("--border") || "rgba(255,255,255,.1)";
    ctx.strokeRect(8, 8, boxW - 16, h - 16);

    // ── S, I and R against time ──
    const gx = boxW + 18, gy = 18, gw = w - gx - 16, gh = h - 40;
    ctx.strokeRect(gx, gy, gw, gh);
    const tMax = Math.max(20, st.t);
    const px = (t) => gx + (t / tMax) * gw;
    const py = (v) => gy + gh - (v / st.N) * gh;
    for (const [key, col] of [["s", COL.s], ["i", COL.i], ["r", COL.r]]) {
      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      st.curve.forEach((q, n) => (n ? ctx.lineTo(px(q.t), py(q[key])) : ctx.moveTo(px(q.t), py(q[key]))));
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.fillStyle = css.getPropertyValue("--muted") || "#97a0bf";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(`t = ${st.t.toFixed(1)}`, gx + 6, gy + gh + 16);
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  function updateReadouts() {
    if (!st) return;
    const m = measure(st);
    out.s.textContent = String(st.nS);
    out.i.textContent = String(st.nI);
    out.r.textContent = String(st.nR);
    out.time.textContent = st.t.toFixed(1);
    out.beta.textContent = Number.isFinite(m.beta) ? m.beta.toFixed(3) : "—";
    out.period.textContent = Number.isFinite(m.period) ? m.period.toFixed(2) : "—";
    out.r0.textContent = Number.isFinite(m.r0) ? m.r0.toFixed(3) : "—";
    out.final.textContent = pct(m.finalFraction);
    out.peak.textContent = pct(m.peakFraction);
    out.finalTheory.textContent = Number.isFinite(m.r0) ? pct(m.finalTheory) : "—";
    out.peakTheory.textContent = Number.isFinite(m.r0) ? pct(m.peakTheory) : "—";

    /*
     * The threshold, stated as what happened rather than as a rule. Below
     * R₀ = 1 an outbreak fades; above it, it takes off. Which side a
     * particular run lands on is not certain near 1 — a handful of seeds can
     * die out by luck — so the label reports the run, not the theory.
     */
    let verdict;
    if (!Number.isFinite(m.r0)) verdict = "—";
    else if (m.done && m.finalFraction < 0.05) verdict = i18nText("epiVerdictFadedOut", "faded out");
    else if (m.done) verdict = i18nText("epiVerdictBurntOut", "burnt through");
    else verdict = i18nText("epiVerdictRunning", "spreading");
    out.verdict.textContent = verdict;
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let lastTs = -1;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    // Step only while the clock advances. The steps themselves are counted,
    // not dt-scaled — but under prefers-reduced-motion the timestamp is
    // frozen, and a loop that ignored it kept animating behind a notice that
    // said "paused". A repeated timestamp means a frozen clock, so it steps
    // nothing; real frames never repeat one.
    const moved = ts !== lastTs;
    lastTs = ts;
    if (running && st && moved) {
      const q = readParams();
      for (let k = 0; k < q.speed && st.nI > 0; k++) step(st);
      if (st.nI === 0) { running = false; syncStart(); }
    }
    draw();
    updateReadouts();
  }

  function syncStart() {
    startBtn.textContent = running
      ? i18nText("pauseBtn", "Pause")
      : i18nText("startBtn", "Start");
  }

  function reset() {
    running = false;
    st = build(readParams());
    syncStart();
    draw();
    updateReadouts();
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function applyLabels() {
    const q = readParams();
    vals.pop.textContent = String(q.N);
    vals.contact.textContent = q.c.toFixed(1);
    vals.transmit.textContent = q.p.toFixed(2);
    vals.recover.textContent = q.g.toFixed(2);
    vals.speed.textContent = String(q.speed);
  }

  for (const [name, el] of Object.entries(inputs)) {
    el.addEventListener("input", () => {
      applyLabels();
      // Changing the disease means a different epidemic; the tallies from the
      // old one would be measuring two things at once. Speed is only how fast
      // it is watched, so it leaves the run alone.
      if (name !== "speed") reset();
    });
  }
  startBtn.addEventListener("click", () => {
    if (st && st.nI === 0) reset();
    running = !running;
    syncStart();
    window.SFX?.click({ gain: 0.18 });
  });
  resetBtn.addEventListener("click", () => { reset(); window.SFX?.click({ gain: 0.18 }); });
  document.addEventListener("langchange", () => { syncStart(); updateReadouts(); });

  /*
   * The dataset a reader can check the page against: the whole S/I/R curve,
   * with the measured quantities and the two closed forms in the header.
   */
  if (window.CSVExport) {
    window.CSVExport.attach("csv-btn", () => {
      if (!st || st.curve.length < 2) return null;
      const m = measure(st);
      return {
        name: "epidemic.csv",
        title: "Epidemic — SIR",
        columns: ["t", "susceptible", "infectious", "recovered"],
        rows: st.curve.map((q) => [q.t, q.s, q.i, q.r]),
        meta: {
          population: st.N, contact_rate: st.c, transmission_prob: st.p,
          recovery_rate: st.g, step_dt: DT,
          measured_beta: m.beta, measured_infectious_period: m.period,
          measured_R0: m.r0,
          final_fraction_measured: m.finalFraction,
          final_fraction_theory: m.finalTheory,
          peak_fraction_measured: m.peakFraction,
          peak_fraction_theory: m.peakTheory,
        },
      };
    });
  }

  window.__epi = {
    DT, params: readParams, build, step, measure, finalSize,
    state: () => st,
    reset,
    setRunning: (v) => { running = v; syncStart(); },
    isRunning: () => running,
    /** Run one epidemic to extinction headlessly and report it. */
    run(q, limit = 200000) {
      const s = build(q);
      for (let k = 0; k < limit && s.nI > 0; k++) step(s);
      return { ...measure(s), t: s.t, N: s.N,
               transmissions: s.transmissions, recoveredCount: s.recovered };
    },
  };

  applyLabels();
  reset();
  raf = requestAnimationFrame(frame);
})();
