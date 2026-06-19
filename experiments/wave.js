/*
 * Two-source wave interference field.
 *
 *   ψ(p, t) = A1·cos(k·r1 − ω·t)
 *           + A2·cos(k·r2 − ω·t + Δφ)
 *
 * Where r1, r2 are Euclidean distances from sources S1, S2 to pixel p.
 * Computed for every pixel of a half-resolution off-screen canvas, then
 * upscaled to the visible stage with smoothing on so the bands read as
 * continuous water rather than stepped squares.
 *
 * Performance notes:
 * - Half resolution (W/2 × H/2) → ~80k math ops per frame at 800×400.
 *   That stays inside a 16 ms budget on every modern device we target.
 * - The colour ramp is computed once and indexed at render time so the
 *   inner loop is one cos pair, one add, one quantize, one memcpy of 4
 *   bytes from a typed array. No allocations per frame.
 */

(() => {
  const stage = document.getElementById("stage");
  const sctx = stage.getContext("2d");

  // Half-res render target — the GPU upscales for free with smoothing on.
  const HR_DIV = 2;
  const offW = stage.width / HR_DIV;
  const offH = stage.height / HR_DIV;
  const off = document.createElement("canvas");
  off.width = offW; off.height = offH;
  const octx = off.getContext("2d");
  const imageData = octx.createImageData(offW, offH);
  const px = imageData.data;
  sctx.imageSmoothingEnabled = true;

  // ── Inputs / outputs ───────────────────────────────────────────────────
  const inputs = {
    spacing: document.getElementById("spacing"),
    wavelength: document.getElementById("wavelength"),
    amp1: document.getElementById("amp1"),
    amp2: document.getElementById("amp2"),
    phase: document.getElementById("phase"),
    speed: document.getElementById("speed"),
  };
  const inputValues = {
    spacing: document.getElementById("spacing-value"),
    wavelength: document.getElementById("wavelength-value"),
    amp1: document.getElementById("amp1-value"),
    amp2: document.getElementById("amp2-value"),
    phase: document.getElementById("phase-value"),
    speed: document.getElementById("speed-value"),
  };
  const out = {
    wavelength: document.getElementById("out-wavelength"),
    frequency: document.getElementById("out-frequency"),
    k: document.getElementById("out-k"),
    omega: document.getElementById("out-omega"),
    fringe: document.getElementById("out-fringe"),
    phase: document.getElementById("out-phase"),
  };
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "0.00");

  // ── Colour ramp ────────────────────────────────────────────────────────
  // Diverging palette: deep blue at −1, near-black at 0, warm amber at +1.
  // Pre-computed at 512 stops so the inner loop is one table lookup.
  const RAMP_SIZE = 512;
  const ramp = new Uint8ClampedArray(RAMP_SIZE * 4);
  (function buildRamp() {
    const NEG = [0.20, 0.55, 1.00];  // sky blue
    const MID = [0.05, 0.07, 0.13];  // page-coloured
    const POS = [1.00, 0.62, 0.18];  // amber
    for (let i = 0; i < RAMP_SIZE; i++) {
      const t = i / (RAMP_SIZE - 1);    // 0..1
      const s = t * 2 - 1;              // -1..1
      let r, g, b;
      if (s < 0) {
        const u = -s;                   // 0..1 weight toward NEG
        r = MID[0] + (NEG[0] - MID[0]) * u;
        g = MID[1] + (NEG[1] - MID[1]) * u;
        b = MID[2] + (NEG[2] - MID[2]) * u;
      } else {
        const u = s;
        r = MID[0] + (POS[0] - MID[0]) * u;
        g = MID[1] + (POS[1] - MID[1]) * u;
        b = MID[2] + (POS[2] - MID[2]) * u;
      }
      const o = i * 4;
      ramp[o]     = r * 255;
      ramp[o + 1] = g * 255;
      ramp[o + 2] = b * 255;
      ramp[o + 3] = 255;
    }
  })();

  // ── State ──────────────────────────────────────────────────────────────
  // The "wave speed" v sets ω = k·v in pixels-per-second. We pick v so the
  // field animates at human-readable rates (~2-3 Hz) across the wavelength
  // range. t is wall-clock seconds, scaled by the animation-speed slider.
  const V_PX_PER_SEC = 120;
  let t = 0;
  let lastTs = performance.now();
  let paused = false;
  let raf = 0;

  function readParams() {
    const d   = parseFloat(inputs.spacing.value);
    const lam = parseFloat(inputs.wavelength.value);
    const A1  = parseFloat(inputs.amp1.value);
    const A2  = parseFloat(inputs.amp2.value);
    const phi = parseFloat(inputs.phase.value) * Math.PI / 180;  // deg → rad
    const sp  = parseFloat(inputs.speed.value);
    return { d, lam, A1, A2, phi, sp };
  }

  function updateLabels(p) {
    inputValues.spacing.textContent    = String(Math.round(p.d));
    inputValues.wavelength.textContent = String(Math.round(p.lam));
    inputValues.amp1.textContent       = fmt(p.A1);
    inputValues.amp2.textContent       = fmt(p.A2);
    inputValues.phase.textContent      = String(Math.round(p.phi * 180 / Math.PI));
    inputValues.speed.textContent      = fmt(p.sp);
  }

  function updateReadouts(p) {
    const k = (2 * Math.PI) / p.lam;
    const omega = k * V_PX_PER_SEC;
    const f = omega / (2 * Math.PI);
    // L is the perpendicular distance from the source line to the right
    // edge of the canvas (where the far-field fringe spacing reads off).
    const L = stage.width * 0.5;
    const fringe = (p.lam * L) / Math.max(p.d, 1);
    out.wavelength.textContent = String(Math.round(p.lam));
    out.frequency.textContent  = fmt(f);
    out.k.textContent          = fmt(k, 3);
    out.omega.textContent      = fmt(omega, 2);
    out.fringe.textContent     = String(Math.round(fringe));
    out.phase.textContent      = fmt(p.phi);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p) {
    const k = (2 * Math.PI) / p.lam;
    const omega = k * V_PX_PER_SEC;
    const wt = omega * t;

    // Sources S1, S2 sit symmetrically about canvas centre on the y-axis,
    // separated by d. We render to the off-screen half-res canvas so the
    // upscale gives free anti-aliasing.
    const cx = offW / 2;
    const cy = offH / 2;
    const halfD = p.d / (2 * HR_DIV);

    const s1x = cx, s1y = cy - halfD;
    const s2x = cx, s2y = cy + halfD;

    // Inner loop: hot path. Manual indexing into the typed arrays, no
    // per-pixel allocations. `kHR` accounts for the half-resolution.
    const kHR = k * HR_DIV;
    const A1 = p.A1, A2 = p.A2, phi = p.phi;
    const ampMax = A1 + A2;             // peak magnitude of ψ
    const invAmpMax = ampMax > 0 ? 1 / (2 * ampMax) : 0;

    let o = 0;
    for (let j = 0; j < offH; j++) {
      const dy1 = j - s1y;
      const dy2 = j - s2y;
      for (let i = 0; i < offW; i++) {
        const dx1 = i - s1x;
        const dx2 = i - s2x;
        const r1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const r2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        // 1/√r amplitude falloff so the field doesn't read like a strobe
        // near the sources. Clamp r ≥ 1 to avoid divide-by-zero at S1/S2.
        const att1 = 1 / Math.sqrt(Math.max(r1, 1));
        const att2 = 1 / Math.sqrt(Math.max(r2, 1));
        const psi = A1 * att1 * Math.cos(kHR * r1 - wt)
                  + A2 * att2 * Math.cos(kHR * r2 - wt + phi);

        // Map ψ ∈ [−ampMax, +ampMax] → ramp index [0, RAMP_SIZE)
        let u = 0.5 + psi * invAmpMax;
        if (u < 0) u = 0; else if (u > 1) u = 1;
        const rIdx = ((u * (RAMP_SIZE - 1)) | 0) << 2;
        px[o    ] = ramp[rIdx];
        px[o + 1] = ramp[rIdx + 1];
        px[o + 2] = ramp[rIdx + 2];
        px[o + 3] = 255;
        o += 4;
      }
    }
    octx.putImageData(imageData, 0, 0);

    // Upscale off-screen → stage with smoothing.
    sctx.drawImage(off, 0, 0, stage.width, stage.height);

    // Overlay: source markers (full resolution).
    const fullCx = stage.width / 2;
    const fullCy = stage.height / 2;
    const halfDFull = p.d / 2;
    drawSource(fullCx, fullCy - halfDFull, "S₁");
    drawSource(fullCx, fullCy + halfDFull, "S₂");
  }

  function drawSource(x, y, label) {
    sctx.save();
    sctx.shadowColor = "rgba(0,0,0,0.6)";
    sctx.shadowBlur = 8;
    sctx.fillStyle = "rgba(255,255,255,0.95)";
    sctx.beginPath();
    sctx.arc(x, y, 6, 0, Math.PI * 2);
    sctx.fill();
    sctx.shadowBlur = 0;
    sctx.fillStyle = "rgba(255,255,255,0.95)";
    sctx.font = "600 13px ui-monospace, monospace";
    sctx.textBaseline = "middle";
    sctx.textAlign = "left";
    sctx.fillText(label, x + 11, y - 2);
    sctx.restore();
  }

  // ── Main loop ──────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((ts - lastTs) / 1000, 0.05);  // cap big jumps
    lastTs = ts;
    const p = readParams();
    if (!paused) t += dt * p.sp;
    render(p);
  }

  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
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
    inputs.spacing.value    = "140";
    inputs.wavelength.value = "48";
    inputs.amp1.value       = "1";
    inputs.amp2.value       = "1";
    inputs.phase.value      = "0";
    inputs.speed.value      = "1";
    t = 0;
    paused = false;
    pauseBtn.textContent = i18nText("wavePauseBtn", "Pause");
    handleInput();
  });

  document.addEventListener("langchange", () => {
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
  });

  // Pause the loop when the tab is hidden so we don't burn battery.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  handleInput();
  start();
})();
