/*
 * Doppler effect — moving source emitting circular wavefronts.
 *
 * Every period T = 1/f the source emits a new wavefront from its current
 * position. A wavefront emitted at time t_e from position x_e has radius
 * c·(t − t_e) at observer time t, and its centre stays fixed at x_e. So
 * the field is a list of (x_e, t_e) circles painted onto the canvas every
 * frame; no per-pixel math, no allocations per frame after warm-up.
 *
 * - When v < c the rings compress ahead (higher f) and stretch behind
 *   (lower f) — classic Doppler shift.
 * - When v > c the source outruns its own wave and the wavefronts merge
 *   into a Mach cone with half-angle sin α = c/v.
 *
 * The source bounces between the left and right margins so the regime is
 * visible from both sides without scrolling.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  const W = stage.width;
  const H = stage.height;
  const SY = H * 0.5;                       // source y (horizontal motion)
  const MARGIN_X = 60;                      // bounce range
  const MAX_RING_RADIUS = Math.hypot(W, H); // off-screen → drop

  const inputs = {
    velocity:  document.getElementById("velocity"),
    frequency: document.getElementById("frequency"),
    wavespeed: document.getElementById("wavespeed"),
  };
  const inputValues = {
    velocity:  document.getElementById("velocity-value"),
    frequency: document.getElementById("frequency-value"),
    wavespeed: document.getElementById("wavespeed-value"),
  };
  const out = {
    forward:    document.getElementById("out-forward"),
    backward:   document.getElementById("out-backward"),
    mach:       document.getElementById("out-mach"),
    cone:       document.getElementById("out-cone"),
    wavelength: document.getElementById("out-wavelength"),
    regime:     document.getElementById("out-regime"),
  };
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "0.00");

  // ── State ──────────────────────────────────────────────────────────────
  const rings = [];                         // { x, tEmit }
  let t = 0;                                // wall-clock seconds (paused-aware)
  let lastTs = performance.now();
  let paused = false;
  let raf = 0;
  let nextEmit = 0;                         // next emission time
  let sourceX = MARGIN_X;
  let sourceDir = 1;                        // +1 right, -1 left

  function readParams() {
    return {
      mach: parseFloat(inputs.velocity.value),
      f:    parseFloat(inputs.frequency.value),
      c:    parseFloat(inputs.wavespeed.value),
    };
  }

  function updateLabels(p) {
    inputValues.velocity.textContent  = fmt(p.mach);
    inputValues.frequency.textContent = fmt(p.f, 1);
    inputValues.wavespeed.textContent = String(Math.round(p.c));
  }

  function updateReadouts(p) {
    const lambda = p.c / p.f;
    const fForward  = p.mach < 1
      ? p.f * p.c / (p.c - p.mach * p.c)
      : Infinity;
    const fBackward = p.f * p.c / (p.c + p.mach * p.c);
    out.forward.textContent    = Number.isFinite(fForward) ? fmt(fForward, 2) : "∞";
    out.backward.textContent   = fmt(fBackward, 2);
    out.mach.textContent       = fmt(p.mach, 2);
    out.wavelength.textContent = String(Math.round(lambda));
    if (p.mach > 1.0001) {
      const alpha = Math.asin(1 / p.mach) * 180 / Math.PI;
      out.cone.textContent   = fmt(alpha, 1) + "°";
      out.regime.textContent = i18nText("dopplerRegimeSupersonic", "Supersonic");
    } else if (Math.abs(p.mach - 1) < 0.0001) {
      out.cone.textContent   = "90°";
      out.regime.textContent = i18nText("dopplerRegimeSonic", "Sonic (Mach 1)");
    } else {
      out.cone.textContent   = "—";
      out.regime.textContent = i18nText("dopplerRegimeSubsonic", "Subsonic");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p) {
    // Background gradient (kept subtle, the rings are the stars).
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#080c1a");
    bg.addColorStop(1, "#0e1426");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Horizon line
    ctx.strokeStyle = "rgba(140, 156, 200, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, SY);
    ctx.lineTo(W, SY);
    ctx.stroke();

    // Each ring: centre = (x, SY), radius = c·(t − tEmit). Colour fades with
    // age so the freshest ring is brightest, oldest ones bleed into the bg.
    ctx.lineWidth = 1.4;
    for (const ring of rings) {
      const age = t - ring.tEmit;
      const r = p.c * age;
      if (r > MAX_RING_RADIUS) continue;
      const a = Math.max(0, 1 - age / (MAX_RING_RADIUS / p.c));
      ctx.strokeStyle = `rgba(150, 200, 255, ${0.18 + 0.6 * a})`;
      ctx.beginPath();
      ctx.arc(ring.x, SY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Mach cone overlay when supersonic — drawn behind the source motion
    if (p.mach > 1.0001) {
      const sinA = 1 / p.mach;
      const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA));
      const dirX = sourceDir;
      // The cone trails the source: from (sourceX, SY) backward along −dirX
      ctx.strokeStyle = "rgba(255, 180, 120, 0.45)";
      ctx.lineWidth = 1.6;
      const L = MAX_RING_RADIUS;
      ctx.beginPath();
      ctx.moveTo(sourceX, SY);
      ctx.lineTo(sourceX - dirX * L * cosA, SY - L * sinA);
      ctx.moveTo(sourceX, SY);
      ctx.lineTo(sourceX - dirX * L * cosA, SY + L * sinA);
      ctx.stroke();
    }

    // Source
    ctx.save();
    ctx.shadowColor = "rgba(110, 168, 255, 0.7)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#ecf0fb";
    ctx.beginPath();
    ctx.arc(sourceX, SY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Direction arrow on the source
    ctx.strokeStyle = "rgba(243, 241, 234, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const arrowLen = 16 * sourceDir;
    ctx.moveTo(sourceX, SY);
    ctx.lineTo(sourceX + arrowLen, SY);
    ctx.lineTo(sourceX + arrowLen - 5 * sourceDir, SY - 4);
    ctx.moveTo(sourceX + arrowLen, SY);
    ctx.lineTo(sourceX + arrowLen - 5 * sourceDir, SY + 4);
    ctx.stroke();

    // Observer hint dots (left / right edges)
    ctx.fillStyle = "rgba(243, 241, 234, 0.45)";
    ctx.beginPath(); ctx.arc(16,     SY, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 16, SY, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(i18nText("dopplerObserverLeft",  "obs ←"), 24, SY - 8);
    ctx.textAlign = "right";
    ctx.fillText(i18nText("dopplerObserverRight", "obs →"), W - 24, SY - 8);
    ctx.textAlign = "left";
  }

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt, p) {
    t += dt;
    // Source motion. v_source = mach · c (in px/s)
    const vs = p.mach * p.c;
    sourceX += sourceDir * vs * dt;
    if (sourceX > W - MARGIN_X) { sourceX = W - MARGIN_X; sourceDir = -1; }
    if (sourceX < MARGIN_X)     { sourceX = MARGIN_X;     sourceDir = +1; }

    // Emit at frequency f
    const T = 1 / p.f;
    while (t >= nextEmit) {
      rings.push({ x: sourceX, tEmit: nextEmit });
      nextEmit += T;
    }

    // Prune off-canvas rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const age = t - rings[i].tEmit;
      if (p.c * age > MAX_RING_RADIUS) rings.splice(i, 1);
    }
  }

  // ── Main loop ──────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    const p = readParams();
    if (!paused) step(dt, p);
    render(p);
  }

  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Reset / wiring ─────────────────────────────────────────────────────
  function reset() {
    rings.length = 0;
    sourceX = MARGIN_X;
    sourceDir = 1;
    t = 0;
    nextEmit = 0;
    paused = false;
    pauseBtn.textContent = i18nText("wavePauseBtn", "Pause");
  }

  function handleInput() {
    const p = readParams();
    updateLabels(p);
    updateReadouts(p);
  }
  Object.values(inputs).forEach((el) => el.addEventListener("input", handleInput));

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
  });
  resetBtn.addEventListener("click", () => {
    inputs.velocity.value  = "0.6";
    inputs.frequency.value = "2";
    inputs.wavespeed.value = "220";
    reset();
    handleInput();
  });

  document.addEventListener("langchange", () => {
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
    updateReadouts(readParams());
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  handleInput();
  start();
})();
