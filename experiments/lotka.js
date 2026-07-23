/*
 * Predator–prey dynamics — the Lotka–Volterra system.
 *
 *   dx/dt =  α·x − β·x·y      prey  (grow, eaten on contact)
 *   dy/dt =  δ·x·y − γ·y      predator (born from prey eaten, die off)
 *
 * Integrated with RK4. The system has a nontrivial fixed point at
 *   x* = γ/δ ,  y* = α/β
 * around which every orbit is a closed loop — populations oscillate
 * forever, predators lagging prey by a quarter cycle. That closed orbit
 * is guaranteed by a conserved quantity
 *   V = δ·x − γ·ln x + β·y − α·ln y   (constant along trajectories),
 * which we display live: it should stay flat, and its drift is a direct
 * readout of integration error (RK4 keeps it to a few parts in 10⁴).
 *
 * Left panel: populations vs time (scrolling). Right inset: the phase
 * portrait (prey on x, predators on y) tracing the closed orbit, with the
 * fixed point marked.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    alpha: document.getElementById("alpha"),
    beta:  document.getElementById("beta"),
    delta: document.getElementById("delta"),
    gamma: document.getElementById("gamma"),
    rate:  document.getElementById("rate"),
  };
  const inputValues = {
    alpha: document.getElementById("alpha-value"),
    beta:  document.getElementById("beta-value"),
    delta: document.getElementById("delta-value"),
    gamma: document.getElementById("gamma-value"),
    rate:  document.getElementById("rate-value"),
  };
  const out = {
    prey:     document.getElementById("out-prey"),
    predator: document.getElementById("out-predator"),
    preyEq:   document.getElementById("out-prey-eq"),
    predEq:   document.getElementById("out-pred-eq"),
    period:   document.getElementById("out-period"),
    invariant:document.getElementById("out-invariant"),
  };
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const PREY_COLOR = "#7be0d0";
  const PRED_COLOR = "#ff8aa3";

  // ── State ──────────────────────────────────────────────────────────────
  let x = 10, y = 5;        // prey, predator populations
  let t = 0;
  let paused = false;
  let lastTs = performance.now();
  let raf = 0;
  const WINDOW = 40;        // time units shown on the scrolling plot
  const series = [];        // { t, x, y }
  const orbit = [];         // { x, y } phase-space trail

  function readParams() {
    return {
      alpha: parseFloat(inputs.alpha.value),
      beta:  parseFloat(inputs.beta.value),
      delta: parseFloat(inputs.delta.value),
      gamma: parseFloat(inputs.gamma.value),
      rate:  parseFloat(inputs.rate.value),
    };
  }

  const deriv = (p, X, Y) => ({
    dx: p.alpha * X - p.beta * X * Y,
    dy: p.delta * X * Y - p.gamma * Y,
  });

  function rk4(p, dt) {
    const k1 = deriv(p, x, y);
    const k2 = deriv(p, x + 0.5 * dt * k1.dx, y + 0.5 * dt * k1.dy);
    const k3 = deriv(p, x + 0.5 * dt * k2.dx, y + 0.5 * dt * k2.dy);
    const k4 = deriv(p, x + dt * k3.dx, y + dt * k3.dy);
    x += (dt / 6) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
    y += (dt / 6) * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy);
    // Populations can't go negative through numerical undershoot.
    if (x < 1e-6) x = 1e-6;
    if (y < 1e-6) y = 1e-6;
  }

  function invariant(p) {
    return p.delta * x - p.gamma * Math.log(x) + p.beta * y - p.alpha * Math.log(y);
  }

  // Small-oscillation period around the fixed point: T ≈ 2π/√(αγ).
  function linearPeriod(p) { return (2 * Math.PI) / Math.sqrt(p.alpha * p.gamma); }

  function reset() {
    x = 10; y = 5; t = 0;
    series.length = 0;
    orbit.length = 0;
    paused = false;
    syncPauseBtn();
  }

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt, p) {
    const simDt = dt * p.rate;
    const sub = Math.max(1, Math.ceil(simDt / 0.02));
    const h = simDt / sub;
    for (let s = 0; s < sub; s++) { rk4(p, h); t += h; }
    series.push({ t, x, y });
    while (series.length && series[0].t < t - WINDOW) series.shift();
    orbit.push({ x, y });
    if (orbit.length > 1400) orbit.shift();
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function drawBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a1810");
    bg.addColorStop(1, "#120b1e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  function seriesMax() {
    let m = 1;
    for (const s of series) { if (s.x > m) m = s.x; if (s.y > m) m = s.y; }
    return m * 1.1;
  }

  function drawTimeSeries(p) {
    const g = { x0: 52, y0: 26, x1: Math.max(W * 0.62, 320), y1: H - 42 };
    const yMax = seriesMax();
    const tToX = (tt) => g.x1 - ((t - tt) / WINDOW) * (g.x1 - g.x0);
    const nToY = (n) => g.y1 - (n / yMax) * (g.y1 - g.y0);

    // Grid + axes
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(236,240,251,0.5)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const n = (yMax / 4) * k;
      const yy = nToY(n);
      ctx.beginPath(); ctx.moveTo(g.x0, yy); ctx.lineTo(g.x1, yy); ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(n.toFixed(0), g.x0 - 6, yy + 3);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(236,240,251,0.6)";
    ctx.fillText(i18nText("lotkaAxisPop", "population"), g.x0 - 44, g.y0 - 8);
    ctx.textAlign = "right";
    ctx.fillText(i18nText("lotkaAxisTime", "time →"), g.x1, g.y1 + 22);

    // Equilibrium lines
    const xEq = p.gamma / p.delta, yEq = p.alpha / p.beta;
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "rgba(123,224,208,0.35)";
    ctx.beginPath(); ctx.moveTo(g.x0, nToY(xEq)); ctx.lineTo(g.x1, nToY(xEq)); ctx.stroke();
    ctx.strokeStyle = "rgba(255,138,163,0.35)";
    ctx.beginPath(); ctx.moveTo(g.x0, nToY(yEq)); ctx.lineTo(g.x1, nToY(yEq)); ctx.stroke();
    ctx.setLineDash([]);

    // Curves — soft area fill under each population, then the line.
    const plot = (key, color, fill) => {
      let first = null, lastPt = null;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (const s of series) {
        if (s.t < t - WINDOW) continue;
        const px = tToX(s.t), py = nToY(s[key]);
        if (!started) { ctx.moveTo(px, py); started = true; first = { px, py }; }
        else ctx.lineTo(px, py);
        lastPt = { px, py };
      }
      if (first && lastPt) {
        ctx.save();
        ctx.lineTo(lastPt.px, g.y1);
        ctx.lineTo(first.px, g.y1);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.restore();
        // Re-stroke the outline (the closePath fill consumed the path)
        ctx.beginPath();
        started = false;
        for (const s of series) {
          if (s.t < t - WINDOW) continue;
          const px = tToX(s.t), py = nToY(s[key]);
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        // Glowing marker on the newest sample
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lastPt.px, lastPt.py, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
    plot("x", PREY_COLOR, "rgba(123, 224, 208, 0.08)");
    plot("y", PRED_COLOR, "rgba(255, 138, 163, 0.08)");

    // Legend
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = PREY_COLOR;
    ctx.fillText("● " + i18nText("lotkaPrey", "prey"), g.x0 + 6, g.y0 + 12);
    ctx.fillStyle = PRED_COLOR;
    ctx.fillText("● " + i18nText("lotkaPredator", "predator"), g.x0 + 6, g.y0 + 28);
  }

  function drawPhasePortrait(p) {
    const size = Math.min(H - 60, W * 0.3);
    const px0 = W - size - 24, py0 = 30;
    const g = { x0: px0, y0: py0, x1: px0 + size, y1: py0 + size };
    if (g.x0 < W * 0.6) return;   // too narrow: skip on small screens

    let mx = p.gamma / p.delta * 2.2, my = p.alpha / p.beta * 2.2;
    for (const o of orbit) { if (o.x > mx) mx = o.x * 1.1; if (o.y > my) my = o.y * 1.1; }
    const xToPx = (v) => g.x0 + (v / mx) * size;
    const yToPy = (v) => g.y1 - (v / my) * size;

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x0, g.y0, size, size);
    ctx.fillStyle = "rgba(236,240,251,0.55)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(i18nText("lotkaPrey", "prey") + " →", (g.x0 + g.x1) / 2, g.y1 + 14);
    ctx.save();
    ctx.translate(g.x0 - 8, (g.y0 + g.y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("↑ " + i18nText("lotkaPredator", "predator"), 0, 0);
    ctx.restore();

    // Orbit trail
    ctx.strokeStyle = "rgba(196,123,255,0.85)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < orbit.length; i++) {
      const pxp = xToPx(orbit[i].x), pyp = yToPy(orbit[i].y);
      if (i === 0) ctx.moveTo(pxp, pyp); else ctx.lineTo(pxp, pyp);
    }
    ctx.stroke();

    // Fixed point
    const fxx = xToPx(p.gamma / p.delta), fyy = yToPy(p.alpha / p.beta);
    ctx.strokeStyle = "rgba(255,224,130,0.9)";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(fxx - 5, fyy); ctx.lineTo(fxx + 5, fyy);
    ctx.moveTo(fxx, fyy - 5); ctx.lineTo(fxx, fyy + 5); ctx.stroke();

    // Current state — glowing
    ctx.save();
    ctx.shadowColor = "#c47bff";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#f2f5ff";
    ctx.beginPath();
    ctx.arc(xToPx(x), yToPy(y), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render(p) {
    drawBackground();
    drawTimeSeries(p);
    drawPhasePortrait(p);
  }

  function updateReadouts(p) {
    out.prey.textContent = x.toFixed(1);
    out.predator.textContent = y.toFixed(1);
    out.preyEq.textContent = (p.gamma / p.delta).toFixed(1);
    out.predEq.textContent = (p.alpha / p.beta).toFixed(1);
    out.period.textContent = linearPeriod(p).toFixed(1);
    out.invariant.textContent = invariant(p).toFixed(3);
  }

  function updateLabels(p) {
    inputValues.alpha.textContent = p.alpha.toFixed(2);
    inputValues.beta.textContent = p.beta.toFixed(2);
    inputValues.delta.textContent = p.delta.toFixed(3);
    inputValues.gamma.textContent = p.gamma.toFixed(2);
    inputValues.rate.textContent = p.rate.toFixed(1);
  }

  function syncPauseBtn() {
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    // Clamp below at 0 too — a first rAF timestamp can precede the
    // performance.now() captured in start(), and a negative dt would
    // run accumulators (charge, time, volume) backwards.
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    const p = readParams();
    if (!paused) step(dt, p);
    render(p);
    updateReadouts(p);
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  Object.values(inputs).forEach((el) =>
    el.addEventListener("input", () => updateLabels(readParams())));

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    window.SFX?.tone({ freq: paused ? 300 : 420, dur: 0.08, type: "sine", gain: 0.12 });
    syncPauseBtn();
  });
  resetBtn.addEventListener("click", () => {
    inputs.alpha.value = "1.1";
    inputs.beta.value = "0.4";
    inputs.delta.value = "0.1";
    inputs.gamma.value = "0.4";
    updateLabels(readParams());
    reset();
  });

  document.addEventListener("langchange", syncPauseBtn);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  function resizeCanvas() {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 520);
    H = 460;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  updateLabels(readParams());
  reset();
  start();
})();
