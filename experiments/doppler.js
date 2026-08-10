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
  // Sized by resizeCanvas(): logical (CSS-pixel) coordinates, with the
  // backing store scaled by devicePixelRatio for crisp rings on hiDPI.
  let W = stage.width;
  let H = stage.height;
  let SY = H * 0.5;                         // source y (horizontal motion)
  const MARGIN_X = 60;                      // bounce range
  let maxRingRadius = Math.hypot(W, H);     // off-screen → drop

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
  /*
   * Two clocks the measurement cannot do without.
   *
   * `settingsAt` is when the controls last moved. Rings live until they run
   * off the canvas — about seven seconds at the default wave speed — so a
   * buffer read straight after a slider change holds a mixture of two
   * settings, and any average over it belongs to neither. That single
   * omission was worth 5–70% on most rows of the table.
   *
   * `runStart` is when the source last turned round. It bounces off both
   * edges, so a window longer than one traverse contains a reversal, and a
   * pair of rings straddling one has neither the spacing of the approach nor
   * of the recession.
   */
  let settingsAt = 0;
  let runStart = 0;

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

  /*
   * The rings emitted since the source last turned round *and* since the
   * controls last moved — the only ones that belong to the same experiment.
   */
  function currentRings() {
    const since = Math.max(settingsAt, runStart);
    return rings.filter((r) => r.tEmit >= since - 1e-9);
  }

  /*
   * Read the wavelength off the picture, not off the emitter.
   *
   * Every ring is drawn at radius c·(t − t_emit) about the point the source
   * was at when it left. Where consecutive rings cross the axis of travel is
   * therefore where the reader's eye sees the wavefronts, and the gap between
   * those crossings is the wavelength — compressed ahead of the source,
   * stretched behind it. Nothing here divides c by anything.
   *
   * A pair is only used if the source really was running steadily between the
   * two emissions: |Δx| has to be the distance it would have covered at the
   * speed the slider says, over the Δt the two rings are apart.
   *
   * That test earned its place when this page had no notion of when the run
   * or the settings began — it was what took the worst rows from 5% to
   * 0.000%. With both clocks now kept properly it is a guard rather than the
   * mechanism, and a build with it deleted passes every check in the suite.
   * It is kept for the one case the clocks cannot cover: a bounce landing in
   * the same step as an emission, where the ring is stamped at the far side
   * of the turn and its spacing belongs to neither leg.
   */
  function measureWavelengths(p) {
    const list = currentRings().slice().sort((a, b) => a.tEmit - b.tEmit);
    const v = p.mach * p.c;
    const ahead = [];
    const behind = [];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const dt = b.tEmit - a.tEmit;
      const dx = b.x - a.x;
      if (dt <= 0) continue;
      // Steady run only: the source covered exactly v·dt in the run direction.
      if (Math.abs(Math.abs(dx) - v * dt) > Math.max(1e-6, 1e-3 * v * dt)) continue;
      if (v > 0 && Math.sign(dx) !== sourceDir) continue;
      // Where each ring meets the axis, now.
      const ra = p.c * (t - a.tEmit);
      const rb = p.c * (t - b.tEmit);
      if (ra <= 0 || rb <= 0) continue;
      const front = sourceDir;                       // +1 if running right
      ahead.push(Math.abs((a.x + front * ra) - (b.x + front * rb)));
      behind.push(Math.abs((a.x - front * ra) - (b.x - front * rb)));
    }
    const stat = (arr) => {
      if (arr.length < 2) return { v: NaN, spread: NaN, n: arr.length };
      const m = arr.reduce((x, y) => x + y, 0) / arr.length;
      return { v: m, spread: (Math.max(...arr) - Math.min(...arr)) / m, n: arr.length };
    };
    return { ahead: stat(ahead), behind: stat(behind), pairs: ahead.length };
  }

  /*
   * The cone, measured off the tangency of the rings rather than from 1/M.
   *
   * Past Mach 1 the source outruns its own wavefronts and every ring it has
   * left behind is tangent to one wedge. For a ring emitted at x_e a time τ
   * ago the half-angle satisfies sin α = c·τ / |x_source − x_e|, and the whole
   * content of the claim is that *every* ring gives the same α — which is what
   * makes it a cone rather than a coincidence. So the spread across rings is
   * reported beside the angle.
   */
  function measureCone(p) {
    const list = currentRings();
    const sins = [];
    for (const r of list) {
      const tau = t - r.tEmit;
      const d = Math.abs(sourceX - r.x);
      if (tau <= 0 || d <= 0) continue;
      // Behind the source, and inside it — a ring the source has outrun.
      if (Math.sign(sourceX - r.x) !== sourceDir) continue;
      const s = (p.c * tau) / d;
      if (!(s > 0) || s > 1) continue;
      sins.push(s);
    }
    if (sins.length < 2) return { deg: NaN, spread: NaN, n: sins.length };
    const m = sins.reduce((x, y) => x + y, 0) / sins.length;
    return { deg: (Math.asin(m) * 180) / Math.PI,
             spread: (Math.max(...sins) - Math.min(...sins)) / m,
             n: sins.length };
  }

  function updateReadouts(p) {
    const lambda = p.c / p.f;
    const fForward  = p.mach < 1
      ? p.f * p.c / (p.c - p.mach * p.c)
      : Infinity;
    const fBackward = p.f * p.c / (p.c + p.mach * p.c);
    const m = measureWavelengths(p);
    const dash = "\u2014";
    const pair = (meas, want, d) => (Number.isFinite(meas)
      ? `${fmt(meas, d)} / ${Number.isFinite(want) ? fmt(want, d) : "\u221e"}`
      : `${dash} / ${Number.isFinite(want) ? fmt(want, d) : "\u221e"}`);

    /*
     * Frequency is what the measured wavelength says it is: f = c / λ. Only
     * below Mach 1, though — above it the source has outrun its own waves and
     * there is nothing ahead of it to have a wavelength. The closed form says
     * so too, by going negative, which is the sign that the question has
     * stopped meaning anything rather than that the answer is large.
     */
    const subsonic = p.mach < 1;
    out.forward.textContent = subsonic
      ? pair(Number.isFinite(m.ahead.v) ? p.c / m.ahead.v : NaN, fForward, 2)
      : dash;
    out.backward.textContent = pair(Number.isFinite(m.behind.v) ? p.c / m.behind.v : NaN,
                                    fBackward, 2);
    out.mach.textContent       = fmt(p.mach, 2);
    out.wavelength.textContent = subsonic
      ? pair(m.ahead.v, (p.c - p.mach * p.c) / p.f, 1)
      : dash;

    const cone = measureCone(p);
    if (p.mach > 1.0001) {
      const alpha = (Math.asin(1 / p.mach) * 180) / Math.PI;
      out.cone.textContent = Number.isFinite(cone.deg)
        ? `${fmt(cone.deg, 1)}\u00b0 / ${fmt(alpha, 1)}\u00b0`
        : `${dash} / ${fmt(alpha, 1)}\u00b0`;
      out.regime.textContent = i18nText("dopplerRegimeSupersonic", "Supersonic");
    } else if (Math.abs(p.mach - 1) < 0.0001) {
      out.cone.textContent   = `${dash} / 90\u00b0`;
      out.regime.textContent = i18nText("dopplerRegimeSonic", "Sonic (Mach 1)");
    } else {
      out.cone.textContent   = dash;
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
      if (r > maxRingRadius) continue;
      const a = Math.max(0, 1 - age / (maxRingRadius / p.c));
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
      const L = maxRingRadius;
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
    const tPrev = t;
    const xPrev = sourceX;
    t += dt;
    // Source motion. v_source = mach · c (in px/s)
    const vs = p.mach * p.c;
    sourceX += sourceDir * vs * dt;
    let bounced = false;
    if (sourceX > W - MARGIN_X) { sourceX = W - MARGIN_X; sourceDir = -1; runStart = t; bounced = true; }
    if (sourceX < MARGIN_X)     { sourceX = MARGIN_X;     sourceDir = +1; runStart = t; bounced = true; }

    /*
     * Emit at frequency f, from where the source *was* at the emission
     * instant rather than from where the step left it.
     *
     * The emissions fall between steps, and recording each ring at the
     * end-of-step position misplaces its centre by up to v·dt. Subsonically
     * that is invisible; past Mach 1 it is the difference between rings that
     * are tangent to one cone and rings that are nearly tangent to it, and it
     * showed up as a measured half-angle 1.7% off with a 4% spread across
     * rings. Within a step the source moves at constant speed, so
     * interpolating is exact — except across a bounce, where it is not, and
     * those rings are dropped by the run filter anyway.
     */
    const T = 1 / p.f;
    while (t >= nextEmit) {
      const frac = dt > 0 ? (nextEmit - tPrev) / dt : 0;
      rings.push({ x: bounced ? sourceX : xPrev + (sourceX - xPrev) * frac,
                   tEmit: nextEmit });
      nextEmit += T;
    }

    // Prune off-canvas rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const age = t - rings[i].tEmit;
      if (p.c * age > maxRingRadius) rings.splice(i, 1);
    }
  }

  // A tone for the right-edge observer, pitched by the true Doppler ratio:
  // approaching (source moving right) it rises, receding it falls. Silent
  // until the browser unlocks audio on the first gesture.
  const drone = window.SFX ? new window.SFX.Drone({ type: "sine", freq: 300, gain: 0 }) : null;
  function updateDrone(p) {
    if (!drone) return;
    const denom = Math.max(0.15, 1 - Math.min(p.mach, 3) * sourceDir);
    drone.setFreq(300 / denom);
    drone.setGain(paused ? 0 : 0.05);
  }

  // ── Main loop ──────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    const p = readParams();
    if (!paused) step(dt, p);
    render(p);
    updateDrone(p);
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
    settingsAt = 0;
    runStart = 0;
    paused = false;
    pauseBtn.textContent = i18nText("wavePauseBtn", "Pause");
  }

  function handleInput() {
    // Every ring already in flight was emitted under the old settings, and
    // mixing them into the measurement is what made most of this table wrong
    // by 5–70% the first time it was built.
    settingsAt = t;
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

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 300);
    H = Math.max(Math.round(rect.height), 240);
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    SY = H * 0.5;
    maxRingRadius = Math.hypot(W, H);
    sourceX = Math.min(Math.max(sourceX, MARGIN_X), W - MARGIN_X);
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();

  /*
   * The hook the tests measure through: the emission record, the two clocks
   * that decide which of it belongs to the current experiment, and the two
   * measurements read off it.
   */
  window.__doppler = {
    MARGIN_X, SY,
    params: readParams,
    state: () => ({ t, sourceX, sourceDir, settingsAt, runStart,
                    rings: rings.length, nextEmit }),
    rings: () => rings.map((r) => ({ ...r })),
    currentRings, measureWavelengths, measureCone,
    setPaused: (on) => {
      paused = !!on;
      pauseBtn.textContent = i18nText(paused ? "waveResumeBtn" : "wavePauseBtn",
                                      paused ? "Resume" : "Pause");
    },
    isPaused: () => paused,
    reset,
    /** Advance the model by `dt` of simulated time, as a frame would. */
    advance: (dt) => { const p = readParams(); if (!paused) step(dt, p); updateReadouts(p); },
    /**
     * Run from a clean start at the given settings for `seconds`, in steps
     * small enough that the emission times land where they would on screen.
     */
    settle: (secs, dt = 1 / 240) => {
      const p = readParams();
      for (let i = 0; i < Math.round(secs / dt); i++) step(dt, p);
      updateReadouts(p);
      return { ...measureWavelengths(p), cone: measureCone(p) };
    },
  };

  handleInput();
  start();
})();
