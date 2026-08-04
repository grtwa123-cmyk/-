/*
 * A + B ⇌ C, one molecule at a time.
 *
 * The two directions are separate reaction channels with their own rate
 * constants, drawn from the Arrhenius expression and the two energy barriers:
 *
 *     k₊ = A·exp(−Ea/RT)              A + B → C
 *     k₋ = A·exp(−ΔS°/R)·exp(−(Ea−ΔH°)/RT)   C → A + B
 *
 * Which one fires next, and when, is decided by exact stochastic simulation:
 * the propensities are k₊[A][B]V and k₋[C]V, the waiting time is exponential
 * in their sum, and the channel is chosen in proportion. Nothing integrates a
 * rate law and nothing knows the equilibrium constant.
 *
 * K is therefore a measurement. Once the counts settle, [C]/([A][B]) is read
 * off them, and it lands on k₊/k₋ — because at equilibrium the two channels
 * fire equally often, which is the textbook derivation happening rather than
 * being asserted. The event counters make that visible: at equilibrium
 * thousands of reactions keep going in both directions and their ratio sits
 * at one. Nothing has stopped.
 *
 * Le Chatelier follows for free. Injecting A, moving the piston or changing
 * the temperature all change the propensities, and the counts walk to wherever
 * that leaves them. Only temperature moves K itself; the rest move Q.
 *
 * The entropy term is not decoration. Two particles becoming one is a real
 * loss of entropy, and without it every exothermic setting would run to
 * completion and there would be no equilibrium worth looking at.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    temp: document.getElementById("temp"),
    dh: document.getElementById("dh"),
    volume: document.getElementById("volume"),
    catalyst: document.getElementById("catalyst"),
    na0: document.getElementById("na0"),
    nb0: document.getElementById("nb0"),
    speed: document.getElementById("speed"),
  };
  const inputValues = {
    temp: document.getElementById("temp-value"),
    dh: document.getElementById("dh-value"),
    volume: document.getElementById("volume-value"),
    catalyst: document.getElementById("catalyst-value"),
    na0: document.getElementById("na0-value"),
    nb0: document.getElementById("nb0-value"),
    speed: document.getElementById("speed-value"),
  };
  const out = {
    conc: document.getElementById("out-conc"),
    q: document.getElementById("out-q"),
    k: document.getElementById("out-k"),
    kpred: document.getElementById("out-kpred"),
    events: document.getElementById("out-events"),
    shift: document.getElementById("out-shift"),
  };
  const addABtn = document.getElementById("add-a-btn");
  const addCBtn = document.getElementById("add-c-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Constants ──────────────────────────────────────────────────────────
  const R = 8.314e-3;          // kJ/(mol·K)
  const EA = 40;               // kJ/mol, the uncatalysed forward barrier
  // Association entropy: A + B → C turns two particles into one, so ΔS° < 0.
  const DS = -0.025;           // kJ/(mol·K)
  const T_REF = 300;
  // Chosen so k₊ = 1 at the reference temperature with no catalyst; it sets
  // the clock, nothing else.
  const PREFACTOR = Math.exp(EA / (R * T_REF));

  function params() {
    const T = parseFloat(inputs.temp.value);
    const dH = parseFloat(inputs.dh.value);
    const cat = parseFloat(inputs.catalyst.value);
    const Ea = EA - cat;                 // a catalyst lowers *both* barriers
    return {
      T, dH, cat, Ea,
      V: parseFloat(inputs.volume.value),
      kf: PREFACTOR * Math.exp(-Ea / (R * T)),
      kr: PREFACTOR * Math.exp(-DS / R) * Math.exp(-(Ea - dH) / (R * T)),
    };
  }

  /** k₊/k₋ — the value the counts should come to, never used to drive them. */
  const predictedK = (p) => p.kf / p.kr;

  /** Where the deterministic rate law would settle, for the reference curve. */
  function equilibriumC(nA, nB, nC, p) {
    const totalA = nA + nC, totalB = nB + nC;
    const K = predictedK(p);
    let lo = 0, hi = Math.min(totalA, totalB);
    for (let i = 0; i < 80; i++) {
      const x = (lo + hi) / 2;
      const a = (totalA - x) / p.V, b = (totalB - x) / p.V, c = x / p.V;
      const q = a > 0 && b > 0 ? c / (a * b) : Infinity;
      if (q < K) lo = x; else hi = x;
    }
    return (lo + hi) / 2;
  }

  // ── State ──────────────────────────────────────────────────────────────
  let N = { A: 300, B: 300, C: 0 };
  let simT = 0;
  let fwd = 0, rev = 0;             // since the last disturbance
  let running = true;
  let history = [];                 // { t, a, b, c }
  let dots = [];                    // drawn molecules; a depiction only
  let settleWindow = [];            // recent Q samples, for the measured K

  const HISTORY_SPAN = 30;          // simulated time units on screen

  function concentrations(p) {
    return { a: N.A / p.V, b: N.B / p.V, c: N.C / p.V };
  }

  /** Q = [C]/([A][B]) — the same expression as K, evaluated right now. */
  function quotient(p) {
    const { a, b, c } = concentrations(p);
    return a > 0 && b > 0 ? c / (a * b) : NaN;
  }

  function rebuildDots() {
    dots = [];
    const push = (kind, n) => {
      for (let i = 0; i < n; i++) {
        dots.push({
          kind,
          x: Math.random(), y: Math.random(),
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
        });
      }
    };
    push("A", N.A); push("B", N.B); push("C", N.C);
  }

  /** Keep the drawn population in step with the counts after a reaction. */
  function syncDots() {
    const want = { A: N.A, B: N.B, C: N.C };
    const have = { A: 0, B: 0, C: 0 };
    for (const d of dots) have[d.kind]++;
    for (const kind of ["A", "B", "C"]) {
      while (have[kind] > want[kind]) {
        const i = dots.findIndex((d) => d.kind === kind);
        dots.splice(i, 1); have[kind]--;
      }
      while (have[kind] < want[kind]) {
        dots.push({ kind, x: Math.random(), y: Math.random(),
                    vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22 });
        have[kind]++;
      }
    }
  }

  function reset() {
    N = { A: parseInt(inputs.na0.value, 10), B: parseInt(inputs.nb0.value, 10), C: 0 };
    simT = 0; fwd = 0; rev = 0;
    history = [];
    settleWindow = [];
    rebuildDots();
  }

  /** Clear the tallies that only mean something between disturbances. */
  function disturb() {
    fwd = 0; rev = 0;
    settleWindow = [];
  }

  /**
   * Advance to simT + dt by exact stochastic simulation.
   *
   * Waiting times come from the total propensity and the channel is picked in
   * proportion to its own — the Gillespie algorithm, so the trajectory is a
   * sample of the chemical master equation rather than a discretised rate law.
   */
  function step(dt, p) {
    const target = simT + dt;
    let guard = 0;
    while (simT < target && guard++ < 400000) {
      const aF = p.kf * N.A * N.B / p.V;
      const aR = p.kr * N.C;
      const a0 = aF + aR;
      if (a0 <= 0) { simT = target; break; }
      const wait = -Math.log(1 - Math.random()) / a0;
      if (simT + wait > target) { simT = target; break; }
      simT += wait;
      if (Math.random() * a0 < aF) { N.A--; N.B--; N.C++; fwd++; }
      else { N.A++; N.B++; N.C--; rev++; }
    }
    syncDots();

    const { a, b, c } = concentrations(p);
    history.push({ t: simT, a, b, c });
    while (history.length && history[0].t < simT - HISTORY_SPAN) history.shift();

    const q = quotient(p);
    if (Number.isFinite(q)) {
      settleWindow.push(q);
      if (settleWindow.length > 400) settleWindow.shift();
    }
  }

  /**
   * K from the counts.
   *
   * Only meaningful once the mixture has settled, so it is reported as the
   * mean of the recent quotient samples and withheld until they stop drifting.
   */
  function measuredK() {
    if (settleWindow.length < 120) return NaN;
    const half = settleWindow.length >> 1;
    const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
    const first = mean(settleWindow.slice(0, half));
    const second = mean(settleWindow.slice(half));
    // Still moving in one direction? Then it is not an equilibrium yet.
    const drift = Math.abs(second - first) / Math.max(second, 1e-12);
    if (drift > 0.05) return NaN;
    return mean(settleWindow);
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    const narrow = W < 560;
    const padL = narrow ? 44 : 58;
    const padR = narrow ? 14 : 20;
    const top = 10;
    const vesselH = narrow ? 190 : 240;
    const gap = narrow ? 30 : 34;
    const barH = narrow ? 52 : 60;
    const plotH = H - top - vesselH - gap * 2 - barH - (narrow ? 30 : 34);
    L = {
      narrow,
      fs: narrow ? 10 : 11,
      fsv: narrow ? 9 : 10,
      x0: padL, x1: W - padR,
      vTop: top, vBot: top + vesselH,
      pTop: top + vesselH + gap, pBot: top + vesselH + gap + plotH,
      bTop: top + vesselH + gap * 2 + plotH, bBot: top + vesselH + gap * 2 + plotH + barH,
    };
  }

  const text = (str, x, y, colour, size, align, bold) => {
    ctx.fillStyle = colour;
    ctx.font = `${bold ? "600 " : ""}${size}px ui-monospace, monospace`;
    ctx.textAlign = align || "left";
    ctx.fillText(str, x, y);
  };

  const plate = (str, x, y, size, align) => {
    ctx.font = `${size}px ui-monospace, monospace`;
    const w = ctx.measureText(str).width;
    const px = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    ctx.fillStyle = "rgba(10,20,16,0.82)";
    ctx.fillRect(px - 3, y - size - 1, w + 6, size + 6);
  };

  const COLOUR = {
    A: "rgba(110,168,255,0.95)",
    B: "rgba(255,209,102,0.95)",
    C: "rgba(111,191,138,0.98)",
  };

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#08130f");
    bg.addColorStop(1, "#0a1420");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ── The vessel. The piston position *is* the volume control, so the
    //    crowding you see is the concentration the rates are computed from.
    {
      const top = L.vTop, bot = L.vBot;
      const full = L.x1 - L.x0;
      const vMax = parseFloat(inputs.volume.max);
      const w = full * (p.V / vMax);
      const bx = L.x0, by = top, bh = bot - top;

      // The barrel is always full width; the piston sits inside it. Drawing
      // only the occupied part made a half-open vessel look like a clipped
      // canvas rather than a cylinder with room left in it.
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, full - 1, bh - 1);
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.fillRect(bx, by, w, bh);
      ctx.strokeStyle = "rgba(255,255,255,0.20)";
      ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, bh - 1);

      // Piston: the face, then the rod out to the end of the barrel.
      ctx.fillStyle = "rgba(226,234,248,0.30)";
      ctx.fillRect(bx + w, by + 2, 9, bh - 4);
      ctx.fillStyle = "rgba(226,234,248,0.20)";
      ctx.fillRect(bx + w + 9, by + bh / 2 - 2.5, Math.max(full - w - 9, 0), 5);

      for (const d of dots) {
        ctx.fillStyle = COLOUR[d.kind];
        const r = d.kind === "C" ? 3.6 : 2.6;
        ctx.beginPath();
        ctx.arc(bx + 5 + d.x * (w - 10), by + 5 + d.y * (bh - 10), r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Legend and counts.
      let lx = L.x0;
      for (const [kind, n] of [["A", N.A], ["B", N.B], ["C", N.C]]) {
        ctx.fillStyle = COLOUR[kind];
        ctx.beginPath(); ctx.arc(lx + 4, bot + 14, 4, 0, Math.PI * 2); ctx.fill();
        text(`${kind} ${n}`, lx + 12, bot + 17.5, "rgba(226,234,248,0.75)", L.fsv, "left");
        lx += 62;
      }
      const vLbl = `${p.V} L`;
      plate(vLbl, bx + w - 6, top + 16, L.fsv, "right");
      text(vLbl, bx + w - 6, top + 16, "rgba(226,234,248,0.6)", L.fsv, "right");
      text(`${p.T} K`, L.x1, bot + 17.5, "rgba(255,138,163,0.8)", L.fsv, "right");
    }

    // ── Concentrations against time.
    {
      const top = L.pTop, bot = L.pBot;
      let hi = 0.5;
      for (const h of history) hi = Math.max(hi, h.a, h.b, h.c);
      hi = Math.ceil(hi * 1.15 * 2) / 2;
      const t0 = Math.max(0, simT - HISTORY_SPAN);
      const X = (t) => L.x0 + ((t - t0) / HISTORY_SPAN) * (L.x1 - L.x0);
      const Y = (v) => bot - (v / hi) * (bot - top);

      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const v = (hi * k) / 4;
        ctx.beginPath(); ctx.moveTo(L.x0, Y(v)); ctx.lineTo(L.x1, Y(v)); ctx.stroke();
        text(v.toFixed(1), L.x0 - 6, Y(v) + 3.5, "rgba(226,234,248,0.45)", L.fsv, "right");
      }
      for (let k = 1; k < 6; k++) {
        const x = L.x0 + ((L.x1 - L.x0) * k) / 6;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
      }

      ctx.save();
      ctx.beginPath(); ctx.rect(L.x0, top, L.x1 - L.x0, bot - top); ctx.clip();

      // Where the rate law says C will settle, for comparison only.
      const cEq = equilibriumC(N.A, N.B, N.C, p) / p.V;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(111,191,138,0.4)";
      ctx.beginPath(); ctx.moveTo(L.x0, Y(cEq)); ctx.lineTo(L.x1, Y(cEq)); ctx.stroke();
      ctx.setLineDash([]);

      for (const [pick, kind] of [[(h) => h.a, "A"], [(h) => h.b, "B"], [(h) => h.c, "C"]]) {
        ctx.strokeStyle = COLOUR[kind];
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (const h of history) {
          const x = X(h.t), y = Y(pick(h));
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      text(i18nText("eqAxisConc", "concentration (mol/L)"), L.x0, top - 6,
        "rgba(226,234,248,0.6)", L.fsv, "left");
      const eqLbl = i18nText("eqPredicted", "predicted [C] at equilibrium");
      plate(eqLbl, L.x1 - 4, Y(cEq) - 5, L.fsv, "right");
      text(eqLbl, L.x1 - 4, Y(cEq) - 5, "rgba(111,191,138,0.75)", L.fsv, "right");
      text(i18nText("eqAxisTime", "time"), L.x1, bot + 14, "rgba(226,234,248,0.5)", L.fsv, "right");
    }

    // ── Q against K, on a log axis because K spans decades.
    {
      const top = L.bTop, bot = L.bBot, mid = (top + bot) / 2;
      const K = predictedK(p);
      const q = quotient(p);
      const lo = -4, hi = 4;                       // log10 range
      const X = (v) => {
        const l = Math.max(lo, Math.min(hi, Math.log10(Math.max(v, 1e-12))));
        return L.x0 + ((l - lo) / (hi - lo)) * (L.x1 - L.x0);
      };
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L.x0, mid); ctx.lineTo(L.x1, mid); ctx.stroke();
      for (let e = lo; e <= hi; e++) {
        const x = X(Math.pow(10, e));
        ctx.beginPath(); ctx.moveTo(x, mid - 4); ctx.lineTo(x, mid + 4); ctx.stroke();
        text(`1e${e}`, x, bot + 10, "rgba(226,234,248,0.4)", L.fsv, "center");
      }
      // K
      ctx.strokeStyle = "rgba(255,209,102,0.95)";
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(X(K), mid - 13); ctx.lineTo(X(K), mid + 13); ctx.stroke();
      plate("K", X(K), mid - 15, L.fsv, "center");
      text("K", X(K), mid - 15, "rgba(255,209,102,0.95)", L.fsv, "center");
      // Q, and the gap between them is the whole story of a disturbance
      if (Number.isFinite(q)) {
        ctx.fillStyle = "rgba(111,191,138,0.95)";
        ctx.beginPath(); ctx.arc(X(q), mid, 5.5, 0, Math.PI * 2); ctx.fill();
        plate("Q", X(q), mid + 20, L.fsv, "center");
        text("Q", X(q), mid + 20, "rgba(111,191,138,0.95)", L.fsv, "center");
      }
      text(i18nText("eqAxisQK", "Q chases K"), L.x0, top - 4,
        "rgba(226,234,248,0.6)", L.fsv, "left");
    }
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(p) {
    const { a, b, c } = concentrations(p);
    const q = quotient(p);
    const K = predictedK(p);
    const mK = measuredK();
    const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toExponential(1));

    out.conc.textContent = `${a.toFixed(2)} · ${b.toFixed(2)} · ${c.toFixed(2)}`;
    out.q.textContent = Number.isFinite(q) ? fmt(q) : "—";
    out.k.textContent = Number.isFinite(mK) ? fmt(mK) : i18nText("eqSettling", "settling…");
    out.kpred.textContent = fmt(K);
    out.events.textContent = `${fwd.toLocaleString()} · ${rev.toLocaleString()}`;

    let key = "eqShiftEq", fallback = "at equilibrium";
    if (!Number.isFinite(q)) { key = "eqShiftNone"; fallback = "—"; }
    else if (q < K * 0.9) { key = "eqShiftFwd"; fallback = "Q < K → making C"; }
    else if (q > K * 1.1) { key = "eqShiftRev"; fallback = "Q > K → breaking C"; }
    out.shift.textContent = i18nText(key, fallback);
  }

  function updateLabels() {
    inputValues.temp.textContent = inputs.temp.value;
    inputValues.dh.textContent = parseFloat(inputs.dh.value).toFixed(1).replace("-", "−");
    inputValues.volume.textContent = inputs.volume.value;
    inputValues.catalyst.textContent = parseFloat(inputs.catalyst.value).toFixed(1);
    inputValues.na0.textContent = inputs.na0.value;
    inputValues.nb0.textContent = inputs.nb0.value;
    inputValues.speed.textContent = parseFloat(inputs.speed.value).toFixed(1);
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let lastTs = performance.now();
  let raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dtReal = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    const p = params();

    if (running) step(dtReal * parseFloat(inputs.speed.value), p);

    for (const d of dots) {
      d.x += d.vx * dtReal; d.y += d.vy * dtReal;
      if (d.x < 0 || d.x > 1) d.vx *= -1;
      if (d.y < 0 || d.y > 1) d.vy *= -1;
      d.x = Math.min(Math.max(d.x, 0), 1);
      d.y = Math.min(Math.max(d.y, 0), 1);
    }

    render(p);
    updateReadouts(p);
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  Object.values(inputs).forEach((el) => {
    el.addEventListener("input", () => {
      updateLabels();
      if (el === inputs.na0 || el === inputs.nb0) reset();
      // Temperature, volume and the catalyst change the conditions rather
      // than the contents, so the mixture stays and re-equilibrates — which
      // is the point of the experiment.
      else if (el !== inputs.speed) disturb();
    });
  });
  addABtn.addEventListener("click", () => {
    N.A += 100; disturb(); syncDots();
    window.SFX?.tone({ freq: 420, dur: 0.09, type: "triangle", gain: 0.12 });
  });
  addCBtn.addEventListener("click", () => {
    N.C += 100; disturb(); syncDots();
    window.SFX?.tone({ freq: 620, dur: 0.09, type: "triangle", gain: 0.12 });
  });
  pauseBtn.addEventListener("click", () => {
    running = !running;
    pauseBtn.textContent = running
      ? i18nText("wavePauseBtn", "Pause") : i18nText("waveResumeBtn", "Resume");
    window.SFX?.click({ gain: 0.2 });
  });
  resetBtn.addEventListener("click", () => {
    running = true;
    pauseBtn.textContent = i18nText("wavePauseBtn", "Pause");
    reset();
    updateLabels();
    window.SFX?.click({ gain: 0.22 });
  });

  document.addEventListener("langchange", () => {
    pauseBtn.textContent = running
      ? i18nText("wavePauseBtn", "Pause") : i18nText("waveResumeBtn", "Resume");
    updateReadouts(params());
  });
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
    H = W < 560 ? 560 : 620;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the harness can check that K is measured rather than assumed.
  window.__eq = {
    R, EA, DS, PREFACTOR,
    params, predictedK, quotient, concentrations, equilibriumC,
    step, reset, disturb,
    counts: () => ({ ...N }),
    setCounts: (a, b, c) => { N = { A: a, B: b, C: c }; syncDots(); disturb(); },
    events: () => ({ fwd, rev }),
    measuredK,
    state: () => ({ t: simT, ...N, running, q: quotient(params()) }),
    setRunning: (v) => { running = v; },
    /**
     * Run a fresh mixture to equilibrium on a throwaway copy and report the
     * time-averaged quotient. Never touches the displayed state.
     */
    settle(p, { nA = 300, nB = 300, nC = 0, burn = 20, span = 40 } = {}) {
      let A = nA, B = nB, C = nC, t = 0;
      let sA = 0, sB = 0, sC = 0, sT = 0, f = 0, r = 0;
      const end = burn + span;
      while (t < end) {
        const aF = p.kf * A * B / p.V, aR = p.kr * C, a0 = aF + aR;
        if (a0 <= 0) break;
        const wait = -Math.log(1 - Math.random()) / a0;
        if (t > burn) {
          const w = Math.min(wait, end - t);
          sA += A * w; sB += B * w; sC += C * w; sT += w;
        }
        t += wait;
        if (Math.random() * a0 < aF) { A--; B--; C++; if (t > burn) f++; }
        else { A++; B++; C--; if (t > burn) r++; }
      }
      const mA = sA / sT, mB = sB / sT, mC = sC / sT;
      return { A: mA, B: mB, C: mC, fwd: f, rev: r,
               Q: (mC / p.V) / ((mA / p.V) * (mB / p.V)) };
    },
    /** Simulated time to reach 95% of the equilibrium C, from pure A + B. */
    timeToEquilibrium(p, { nA = 300, nB = 300 } = {}) {
      const target = 0.95 * equilibriumC(nA, nB, 0, p);
      let A = nA, B = nB, C = 0, t = 0, guard = 0;
      while (C < target && guard++ < 5e6) {
        const aF = p.kf * A * B / p.V, aR = p.kr * C, a0 = aF + aR;
        if (a0 <= 0) break;
        t += -Math.log(1 - Math.random()) / a0;
        if (Math.random() * a0 < aF) { A--; B--; C++; } else { A++; B++; C--; }
      }
      return t;
    },
  };

  resizeCanvas();
  updateLabels();
  reset();
  start();
})();
