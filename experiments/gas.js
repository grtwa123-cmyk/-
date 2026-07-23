/*
 * Ideal gas & kinetic theory — particles in a piston chamber.
 *
 * The point of this sim: pressure is not a formula, it is bookkeeping.
 * Every wall bounce deposits an impulse 2m|v⊥|; summing those over a
 * rolling window and dividing by (time × wall length) IS the measured
 * pressure. Displayed next to it, the ideal-gas prediction for a 2D box:
 *
 *   P·A = N·k·T      (area A, k = 1 in sim units)
 *
 * The two agree to within statistical fluctuation — visibly tighter as
 * N grows — with no calibration constant anywhere: both are computed in
 * the same units from the same trajectories.
 *
 * Faithful to "ideal": particles do not interact with each other (only
 * with walls), and a weak thermostat rescales speeds toward the set
 * temperature so compression stays isothermal. Speeds are initialised
 * Maxwell–Boltzmann (⟨½v²⟩ = T per axis via Box–Muller gaussians).
 *
 * Units: T in arbitrary units u; SPEED2 converts u → px²/s² so the
 * motion reads well on screen. Pressures are reported in u of N·T/A.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  // Logical (CSS-pixel) coordinates; backing store scaled by dpr.
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    temp:   document.getElementById("temp"),
    volume: document.getElementById("volume"),
    count:  document.getElementById("count"),
  };
  const inputValues = {
    temp:   document.getElementById("temp-value"),
    volume: document.getElementById("volume-value"),
    count:  document.getElementById("count-value"),
  };
  const out = {
    pmeas:  document.getElementById("out-pmeas"),
    pideal: document.getElementById("out-pideal"),
    temp:   document.getElementById("out-temp"),
    volume: document.getElementById("out-volume"),
    vrms:   document.getElementById("out-vrms"),
    n:      document.getElementById("out-n"),
  };
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Chamber geometry (logical px) ──────────────────────────────────────
  const BOX = { x0: 44, y0: 74, fullW: 200, y1: 442 };
  const boxH = () => BOX.y1 - BOX.y0;
  const PISTON_W = 10;
  const ROD_LEN = 34;
  const R = 3;                              // particle radius (drawing + walls)
  const graphRect = () => ({ x0: 336, y0: 40, x1: W - 24, y1: H - 56 });

  // ── Sim units ──────────────────────────────────────────────────────────
  const SPEED2 = 25;                        // px²/s² per unit temperature
  const FR_MIN = 0.30, FR_MAX = 1.0;

  function readParams() {
    return {
      T: parseFloat(inputs.temp.value),
      fr: parseFloat(inputs.volume.value) / 100,
      N: parseInt(inputs.count.value, 10),
    };
  }

  const pistonX = (fr) => BOX.x0 + fr * BOX.fullW;
  const areaPx = (fr) => fr * BOX.fullW * boxH();
  const idealP = (p) => (p.N * p.T) / areaPx(p.fr) * SPEED2; // px units
  const toU = (pPx) => pPx / SPEED2;                          // display units

  // ── Particles ──────────────────────────────────────────────────────────
  const parts = [];                         // { x, y, vx, vy }
  let gaussSpare = null;
  function gauss() {
    if (gaussSpare !== null) { const g = gaussSpare; gaussSpare = null; return g; }
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    v = Math.random();
    const m = Math.sqrt(-2 * Math.log(u));
    gaussSpare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }
  function maxwellV(T) { return gauss() * Math.sqrt(T * SPEED2); }

  function spawn(p) {
    const px = pistonX(p.fr);
    return {
      x: BOX.x0 + R + Math.random() * (px - BOX.x0 - 2 * R),
      y: BOX.y0 + R + Math.random() * (boxH() - 2 * R),
      vx: maxwellV(p.T),
      vy: maxwellV(p.T),
    };
  }

  function syncCount(p) {
    while (parts.length < p.N) parts.push(spawn(p));
    if (parts.length > p.N) parts.length = p.N;
  }

  function reseed() {
    parts.length = 0;
    syncCount(readParams());
  }

  // ── Pressure bookkeeping ───────────────────────────────────────────────
  let impulseAcc = 0;                       // Σ 2|v⊥| since window start
  let windowT = 0;
  let pMeas = 0;                            // px units, smoothed per window
  const PWINDOW = 0.4;                      // s

  // ── State ──────────────────────────────────────────────────────────────
  let paused = false;
  let lastTs = performance.now();
  let raf = 0;

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt, p) {
    const px = pistonX(p.fr);

    // Weak thermostat: rescale speeds toward the set temperature.
    let ke = 0;
    for (const q of parts) ke += q.vx * q.vx + q.vy * q.vy;
    const Tnow = parts.length ? ke / (2 * parts.length * SPEED2) : p.T;
    if (Tnow > 1e-9) {
      const f = 1 + (Math.sqrt(p.T / Tnow) - 1) * Math.min(1, dt * 4);
      for (const q of parts) { q.vx *= f; q.vy *= f; }
    }

    let wallHits = 0;
    for (const q of parts) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.x < BOX.x0 + R)  { q.x = BOX.x0 + R;  impulseAcc += 2 * Math.abs(q.vx); q.vx =  Math.abs(q.vx); wallHits++; }
      if (q.x > px - R)      { q.x = px - R;      impulseAcc += 2 * Math.abs(q.vx); q.vx = -Math.abs(q.vx); wallHits++; }
      if (q.y < BOX.y0 + R)  { q.y = BOX.y0 + R;  impulseAcc += 2 * Math.abs(q.vy); q.vy =  Math.abs(q.vy); wallHits++; }
      if (q.y > BOX.y1 - R)  { q.y = BOX.y1 - R;  impulseAcc += 2 * Math.abs(q.vy); q.vy = -Math.abs(q.vy); wallHits++; }
    }
    // A faint patter of wall hits — more collisions (hotter / more crowded)
    // makes a busier sizzle. Capped so it stays a texture, not a roar.
    if (wallHits > 0) {
      const ticks = Math.min(2, Math.ceil(wallHits / 3));
      for (let i = 0; i < ticks; i++) {
        if (Math.random() < 0.6) {
          window.SFX?.noise({ dur: 0.02, gain: 0.025, color: "white", filter: "highpass", freq: 2600 + Math.random() * 1800, q: 0.7 });
        }
      }
    }

    windowT += dt;
    if (windowT >= PWINDOW) {
      const perimeter = 2 * ((px - BOX.x0) + boxH());
      const sample = impulseAcc / (windowT * perimeter);
      pMeas = pMeas === 0 ? sample : pMeas * 0.45 + sample * 0.55;
      impulseAcc = 0;
      windowT = 0;
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function drawChamber(p) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#160e20");
    bg.addColorStop(1, "#1d1226");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const px = pistonX(p.fr);

    // Gas fill — brightness hints at density
    const dens = Math.min(p.N / areaPx(p.fr) * 900, 0.3);
    ctx.fillStyle = `rgba(240, 176, 96, ${0.05 + dens * 0.35})`;
    ctx.fillRect(BOX.x0, BOX.y0, px - BOX.x0, boxH());

    // Chamber walls (open on the right where the piston slides)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BOX.x0 + BOX.fullW + PISTON_W + 4, BOX.y0);
    ctx.lineTo(BOX.x0, BOX.y0);
    ctx.lineTo(BOX.x0, BOX.y1);
    ctx.lineTo(BOX.x0 + BOX.fullW + PISTON_W + 4, BOX.y1);
    ctx.stroke();

    // Particles, coloured by speed (blue slow → amber fast)
    const vRef = 2 * Math.sqrt(2 * p.T * SPEED2);
    for (const q of parts) {
      const sp = Math.hypot(q.vx, q.vy);
      const t = Math.min(sp / vRef, 1);
      ctx.fillStyle = `hsl(${215 - 175 * t}, 85%, ${55 + 15 * t}%)`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, R, 0, Math.PI * 2);
      ctx.fill();
    }

    // Piston plate + rod + handle
    ctx.fillStyle = "rgba(236, 240, 251, 0.85)";
    ctx.fillRect(px, BOX.y0 + 2, PISTON_W, boxH() - 4);
    ctx.strokeStyle = "rgba(236, 240, 251, 0.7)";
    ctx.lineWidth = 4;
    const midY = (BOX.y0 + BOX.y1) / 2;
    ctx.beginPath();
    ctx.moveTo(px + PISTON_W, midY);
    ctx.lineTo(px + PISTON_W + ROD_LEN, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + PISTON_W + ROD_LEN, midY - 16);
    ctx.lineTo(px + PISTON_W + ROD_LEN, midY + 16);
    ctx.stroke();

    ctx.fillStyle = "rgba(236, 240, 251, 0.7)";
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`V = ${(p.fr * 100).toFixed(0)}%`, (BOX.x0 + px) / 2, BOX.y1 + 20);
    ctx.textAlign = "left";
  }

  function drawGraph(p) {
    const g = graphRect();
    const pMaxU = 1.15 * toU((p.N * p.T) / areaPx(FR_MIN) * SPEED2);
    const vToX = (fr) => g.x0 + ((fr - 0.25) / (1.05 - 0.25)) * (g.x1 - g.x0);
    const pToY = (u) => g.y1 - (u / pMaxU) * (g.y1 - g.y0);

    // Grid + labels
    ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    for (let v = 30; v <= 100; v += 10) {
      const x = vToX(v / 100);
      ctx.beginPath(); ctx.moveTo(x, g.y0); ctx.lineTo(x, g.y1); ctx.stroke();
      ctx.fillStyle = "rgba(236, 240, 251, 0.5)";
      ctx.textAlign = "center";
      ctx.fillText(String(v), x, g.y1 + 14);
    }
    const pTick = pMaxU > 2 ? 1 : 0.5;
    for (let u = 0; u <= pMaxU; u += pTick) {
      const y = pToY(u);
      ctx.beginPath(); ctx.moveTo(g.x0, y); ctx.lineTo(g.x1, y); ctx.stroke();
      ctx.fillStyle = "rgba(236, 240, 251, 0.5)";
      ctx.textAlign = "right";
      ctx.fillText(u.toFixed(pTick < 1 ? 1 : 0), g.x0 - 6, y + 3);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(236, 240, 251, 0.6)";
    ctx.fillText("P (u)", g.x0 - 24, g.y0 - 8);
    ctx.fillText("V (%)", g.x1 - 34, g.y1 + 28);

    // Isotherm P(V) = N·T/A at the current T
    ctx.strokeStyle = "rgba(196, 123, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const fr = FR_MIN + (i / 80) * (FR_MAX - FR_MIN);
      const u = toU((p.N * p.T) / areaPx(fr) * SPEED2);
      const x = vToX(fr), y = pToY(Math.min(u, pMaxU));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Measured point — real impulse bookkeeping, wobbling on the curve
    ctx.fillStyle = "#ffd9a0";
    ctx.beginPath();
    ctx.arc(vToX(p.fr), pToY(Math.min(toU(pMeas), pMaxU)), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 217, 160, 0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(vToX(p.fr), g.y1);
    ctx.lineTo(vToX(p.fr), pToY(Math.min(toU(pMeas), pMaxU)));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function updateReadouts(p) {
    let ke = 0;
    for (const q of parts) ke += q.vx * q.vx + q.vy * q.vy;
    const Tnow = parts.length ? ke / (2 * parts.length * SPEED2) : p.T;
    out.pmeas.textContent = toU(pMeas).toFixed(2);
    out.pideal.textContent = toU(idealP(p)).toFixed(2);
    out.temp.textContent = String(Math.round(Tnow));
    out.volume.textContent = String(Math.round(p.fr * 100));
    out.vrms.textContent = Math.sqrt(2 * Math.max(Tnow, 0)).toFixed(1);
    out.n.textContent = String(parts.length);
  }

  function updateLabels(p) {
    inputValues.temp.textContent = String(Math.round(p.T));
    inputValues.volume.textContent = String(Math.round(p.fr * 100));
    inputValues.count.textContent = String(p.N);
  }

  // ── Main loop ──────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    // Clamp below at 0 too — a first rAF timestamp can precede the
    // performance.now() captured in start(), and a negative dt would
    // run accumulators (charge, time, volume) backwards.
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.033));
    lastTs = ts;
    const p = readParams();
    syncCount(p);
    if (!paused) step(dt, p);
    drawChamber(p);
    drawGraph(p);
    updateReadouts(p);
  }

  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Piston drag ────────────────────────────────────────────────────────
  let draggingPiston = false;
  function canvasX(clientX) {
    const rect = stage.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }
  stage.addEventListener("pointerdown", (e) => {
    const x = canvasX(e.clientX);
    const rect = stage.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const px = pistonX(readParams().fr);
    if (Math.abs(x - (px + PISTON_W / 2)) < 26 + ROD_LEN && y > BOX.y0 - 10 && y < BOX.y1 + 10) {
      draggingPiston = true;
      stage.setPointerCapture(e.pointerId);
    }
  });
  // Keep every particle inside the (possibly smaller) chamber. step()
  // normally handles this, but it doesn't run while paused — without an
  // explicit confine, dragging the piston inward while paused leaves
  // particles stranded outside the chamber.
  function confineParticles() {
    const px = pistonX(readParams().fr);
    for (const q of parts) {
      if (q.x > px - R) { q.x = px - R; if (q.vx > 0) q.vx = -q.vx; }
      if (q.x < BOX.x0 + R) q.x = BOX.x0 + R;
    }
  }

  stage.addEventListener("pointermove", (e) => {
    if (!draggingPiston) return;
    const fr = Math.min(Math.max((canvasX(e.clientX) - BOX.x0) / BOX.fullW, FR_MIN), FR_MAX);
    inputs.volume.value = String(Math.round(fr * 100));
    updateLabels(readParams());
    confineParticles();
  });
  const endDrag = () => { draggingPiston = false; };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // ── Wiring ─────────────────────────────────────────────────────────────
  Object.values(inputs).forEach((el) =>
    el.addEventListener("input", () => {
      updateLabels(readParams());
      confineParticles();
    }));

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    window.SFX?.tone({ freq: paused ? 300 : 420, dur: 0.08, type: "sine", gain: 0.12 });
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
  });

  resetBtn.addEventListener("click", () => {
    inputs.temp.value = "300";
    inputs.volume.value = "70";
    inputs.count.value = "80";
    paused = false;
    pauseBtn.textContent = i18nText("wavePauseBtn", "Pause");
    pMeas = 0; impulseAcc = 0; windowT = 0;
    updateLabels(readParams());
    reseed();
  });

  document.addEventListener("langchange", () => {
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
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
    W = Math.max(Math.round(rect.width), 520);
    H = 520;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  updateLabels(readParams());
  reseed();
  start();
})();
