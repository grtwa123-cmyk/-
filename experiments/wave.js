/*
 * Two-source interference — the fringes are found, not placed.
 *
 * What goes in is the superposition principle and nothing else: two circular
 * waves add, each falling off as 1/√r because a two-dimensional wavefront
 * spreads its energy over a growing circle.
 *
 *   ψ(p, t) = A₁·att₁·cos(k·r₁ − ωt) + A₂·att₂·cos(k·r₂ − ωt + Δφ)
 *
 * Everything the page reports is then measured off that field. The intensity
 * is the mean square over a whole cycle, sampled rather than solved. A screen
 * is stood at the right-hand edge, the intensity is scanned down it, and the
 * bright and dark fringes are *located* — local extrema, refined by fitting a
 * parabola to each one's three samples. The fringe spacing is the gap between
 * the fringes that were found.
 *
 * That makes the textbook line worth printing next to it. A fringe of order q
 * is a branch of the hyperbola r₁ − r₂ = qλ, and where that branch crosses the
 * screen is exact:
 *
 *   y(q) = (qλ/2)·√(1 + L² / ((d/2)² − (qλ/2)²))
 *
 * Δy = λL/d is what that collapses to when the geometry is narrow and the
 * screen is far, and the page prints all three: the measurement, the exact
 * crossing, and the approximation. The measurement lands on the exact value to
 * about one part in a million; the approximation is low, always, by
 *
 *   λL/d ÷ Δy  =  √(1 − (λ/d)²) ⁄ √(1 + (d² − λ²)/(4L²))
 *
 * — two separate debts. The first is obliquity: sin θ = λ/d is the direction,
 * tan θ is the distance up the screen, and no amount of moving the screen back
 * repays it. The second is the near screen, and that one does go away with
 * distance. Here L ≈ 303 px, so both are in play at once: the default costs
 * 8.2%, of which 6.1% would survive at infinity.
 *
 * One honest wrinkle. At every located fringe r₁ − r₂ comes out a whole number
 * of wavelengths to about one part in a million — but only with the 1/√r
 * envelope switched off, and that floor is the resolution of the search rather
 * than a property of the field. Leave the envelope on and it tilts each peak
 * slightly toward the axis, so the bright fringes drift a few parts in a
 * thousand while the dark ones, pinned by the phase rather than the amplitude,
 * stay put to a few tens of parts in a million. Both are reported.
 */

(() => {
  const stage = document.getElementById("stage");
  const sctx = stage.getContext("2d");

  // Half-res render target — the GPU upscales for free with smoothing on.
  const HR_DIV = 2;
  let W = stage.width;
  let H = stage.height;
  let offW = W / HR_DIV;
  let offH = H / HR_DIV;
  // Declared here rather than beside measure(): resizeCanvas() runs during
  // setup and clears it, which would hit the temporal dead zone otherwise.
  let cache = null;
  const off = document.createElement("canvas");
  const octx = off.getContext("2d");
  let imageData, px;

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 300);
    H = Math.max(Math.round(rect.height), 240);
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.imageSmoothingEnabled = true;
    offW = Math.max(Math.round(W / HR_DIV), 150);
    offH = Math.max(Math.round(H / HR_DIV), 120);
    off.width = offW;
    off.height = offH;
    imageData = octx.createImageData(offW, offH);
    px = imageData.data;
    cache = null;                       // the screen moves with the canvas
  }
  resizeCanvas();

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
    fringe: document.getElementById("out-fringe"),
    exact: document.getElementById("out-exact"),
    approx: document.getElementById("out-approx"),
    count: document.getElementById("out-count"),
    order: document.getElementById("out-order"),
    visibility: document.getElementById("out-visibility"),
  };
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");
  const screenBox = document.getElementById("show-screen");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");

  // ── Colour ramp ────────────────────────────────────────────────────────
  const RAMP_SIZE = 512;
  const ramp = new Uint8ClampedArray(RAMP_SIZE * 4);
  (function buildRamp() {
    const NEG = [0.20, 0.55, 1.00];  // sky blue
    const MID = [0.05, 0.07, 0.13];  // page-coloured
    const POS = [1.00, 0.62, 0.18];  // amber
    for (let i = 0; i < RAMP_SIZE; i++) {
      const s = (i / (RAMP_SIZE - 1)) * 2 - 1;
      const u = Math.abs(s);
      const to = s < 0 ? NEG : POS;
      const o = i * 4;
      for (let c = 0; c < 3; c++) ramp[o + c] = (MID[c] + (to[c] - MID[c]) * u) * 255;
      ramp[o + 3] = 255;
    }
  })();

  // ── State ──────────────────────────────────────────────────────────────
  const V_PX_PER_SEC = 120;
  let t = 0;
  let lastTs = performance.now();
  let paused = false;
  let running = true;
  let raf = 0;

  function readParams() {
    return {
      d: parseFloat(inputs.spacing.value),
      lam: parseFloat(inputs.wavelength.value),
      A1: parseFloat(inputs.amp1.value),
      A2: parseFloat(inputs.amp2.value),
      phi: (parseFloat(inputs.phase.value) * Math.PI) / 180,
      sp: parseFloat(inputs.speed.value),
      screen: !screenBox || screenBox.checked,
    };
  }

  // ── The field. This, and only this, is put in. ─────────────────────────
  //
  // Coordinates are canvas pixels measured from the midpoint between the
  // sources: x to the right, y down. S₁ sits above the axis, S₂ below.
  const att = (r) => 1 / Math.sqrt(Math.max(r, 1));

  function psi(x, y, time, p, envelope = true) {
    const k = (2 * Math.PI) / p.lam;
    const r1 = Math.hypot(x, y + p.d / 2);
    const r2 = Math.hypot(x, y - p.d / 2);
    const a1 = envelope ? att(r1) : 1;
    const a2 = envelope ? att(r2) : 1;
    return p.A1 * a1 * Math.cos(k * r1 - time)
         + p.A2 * a2 * Math.cos(k * r2 - time + p.phi);
  }

  /** Path difference at a point: what the interference condition is about. */
  const pathDiff = (x, y, p) =>
    Math.hypot(x, y + p.d / 2) - Math.hypot(x, y - p.d / 2);

  /** Which fringe a point is on, as a number of wavelengths. */
  const orderAt = (x, y, p) =>
    ((2 * Math.PI / p.lam) * pathDiff(x, y, p) - p.phi) / (2 * Math.PI);

  /*
   * Where the exact condition puts the fringe of order q, on the screen: the
   * branch of the hyperbola r₁ − r₂ = qλ, whose foci are the two sources. This
   * is a closed form and nothing on the page is *placed* with it — the fringes
   * are found in the intensity. It is here so the measurement has something
   * exact to be printed against, the way λL/d is.
   */
  function fringeY(q, p, L) {
    const a = (Math.abs(q) * p.lam) / 2;        // semi-transverse axis
    const b2 = (p.d / 2) ** 2 - a * a;          // semi-conjugate, squared
    if (b2 <= 0) return NaN;                    // |q|λ > d: no such order
    return Math.sign(q) * a * Math.sqrt(1 + (L * L) / b2);
  }

  // What the eye sees: the mean square over one whole cycle. Sampled, so the
  // page never needs the closed form for the intensity of two added cosines.
  const PHASES = 48;
  function intensity(x, y, p, envelope = true) {
    let s = 0;
    for (let m = 0; m < PHASES; m++) {
      const v = psi(x, y, (2 * Math.PI * m) / PHASES, p, envelope);
      s += v * v;
    }
    return s / PHASES;
  }

  // ── Finding the fringes ────────────────────────────────────────────────
  const screenX = () => W / 2 - 26;      // the observation line, in field px
  const SAMPLES = 1400;

  /** Intensity down the screen, top to bottom. */
  function scanScreen(p, envelope = true) {
    const L = screenX();
    const yMax = H / 2;
    const ys = new Float64Array(SAMPLES);
    const is = new Float64Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const y = -yMax + (2 * yMax * i) / (SAMPLES - 1);
      ys[i] = y;
      is[i] = intensity(L, y, p, envelope);
    }
    return { ys, is, L };
  }

  /*
   * Every local extremum, refined by fitting a parabola through its three
   * samples. Without the refinement the located position is quantised to the
   * sample spacing, which is coarser than the thing being measured.
   */
  function extrema(scan, sign) {
    const { ys, is } = scan;
    const out2 = [];
    for (let i = 1; i < is.length - 1; i++) {
      const hit = sign > 0
        ? is[i] > is[i - 1] && is[i] >= is[i + 1]
        : is[i] < is[i - 1] && is[i] <= is[i + 1];
      if (!hit) continue;
      const a = is[i - 1], b = is[i], c = is[i + 1];
      const den = a - 2 * b + c;
      const shift = den === 0 ? 0 : (0.5 * (a - c)) / den;
      out2.push({ y: ys[i] + shift * (ys[i + 1] - ys[i]), I: b });
    }
    return out2;
  }

  /*
   * Everything the readouts show, measured off the field. Cached on the
   * parameters because none of it depends on time — the pattern breathes, but
   * where its fringes sit does not.
   */
  function measure(p) {
    const key = `${p.d}|${p.lam}|${p.A1}|${p.A2}|${p.phi}|${W}|${H}`;
    if (cache && cache.key === key) return cache.v;

    const scan = scanScreen(p);
    const L = scan.L;
    const bright = extrema(scan, +1);
    const dark = extrema(scan, -1);

    // Fringe spacing: the gap between the two located fringes that straddle
    // the axis. The fringes are not evenly spaced — they widen away from the
    // centre, which is exactly what λL/d misses — so the spacing has to be
    // pinned to somewhere, and the axis is where the textbook means it.
    const ys = bright.map((m) => m.y).sort((a, b) => a - b);
    let pair = null;
    for (let i = 0; i + 1 < ys.length; i++) {
      const mid = Math.abs((ys[i] + ys[i + 1]) / 2);
      if (!pair || mid < pair.mid) pair = { mid, lo: ys[i], hi: ys[i + 1] };
    }
    const spacing = pair ? pair.hi - pair.lo : NaN;

    // The same gap, from the exact hyperbola and from the textbook line. Δφ
    // shifts every order by Δφ/2π, so the two crossings wanted are the ones
    // the measurement actually used.
    const shift = p.phi / (2 * Math.PI);
    const n0 = pair ? Math.round(orderAt(L, pair.lo, p)) : 0;
    const exact = pair
      ? fringeY(n0 + 1 + shift, p, L) - fringeY(n0 + shift, p, L) : NaN;
    const approx = (p.lam * L) / Math.max(p.d, 1e-9);

    // How close the located fringes are to the exact condition. The envelope
    // is what stops this being machine-precision; with it off the same scan
    // lands on whole numbers to about 1e-8, which is why both are measured.
    const dev = (list, offset) => list.reduce((worst, m) => {
      const n = orderAt(L, m.y, p) - offset;
      return Math.max(worst, Math.abs(n - Math.round(n)));
    }, 0);
    const flat = scanScreen(p, false);
    const orderBright = dev(bright, 0);
    const orderDark = dev(dark, 0.5);
    const orderFlat = dev(extrema(flat, +1), 0);

    // Visibility over the fringe nearest the axis, where the two arms are
    // most nearly equal.
    let Imax = -Infinity, Imin = Infinity;
    const win = Number.isFinite(spacing) ? Math.abs(spacing) * 1.1 : H / 4;
    for (let i = 0; i < SAMPLES; i++) {
      if (Math.abs(scan.ys[i]) > win) continue;
      if (scan.is[i] > Imax) Imax = scan.is[i];
      if (scan.is[i] < Imin) Imin = scan.is[i];
    }
    const visibility = Imax + Imin > 0 ? (Imax - Imin) / (Imax + Imin) : 0;
    const visIdeal = (p.A1 * p.A1 + p.A2 * p.A2) > 0
      ? (2 * p.A1 * p.A2) / (p.A1 * p.A1 + p.A2 * p.A2) : 0;

    const v = { L, bright, dark, spacing, exact, approx, orderBright, orderDark,
                orderFlat, visibility, visIdeal, scan };
    cache = { key, v };
    return v;
  }

  function updateLabels(p) {
    inputValues.spacing.textContent    = String(Math.round(p.d));
    inputValues.wavelength.textContent = String(Math.round(p.lam));
    inputValues.amp1.textContent       = fmt(p.A1);
    inputValues.amp2.textContent       = fmt(p.A2);
    inputValues.phase.textContent      = String(Math.round((p.phi * 180) / Math.PI));
    inputValues.speed.textContent      = fmt(p.sp);
  }

  function updateReadouts(p) {
    const m = measure(p);
    out.wavelength.textContent = String(Math.round(p.lam));
    out.fringe.textContent = Number.isFinite(m.spacing) ? m.spacing.toFixed(2) : "—";

    // Both predictions are quoted the same way — value, then how far it is
    // from the measurement — so the reader can put a tenth of a percent next
    // to eight percent and see which of the two is an approximation.
    const gap = (v) => (Number.isFinite(m.spacing) && Number.isFinite(v)
      ? (100 * (v - m.spacing)) / m.spacing : NaN);
    const show = (v, g) => (Number.isFinite(g)
      ? `${v.toFixed(2)} (${g > 0 ? "+" : ""}${g.toFixed(g > -1 && g < 1 ? 2 : 1)}%)`
      : Number.isFinite(v) ? v.toFixed(2) : "—");
    out.exact.textContent = show(m.exact, gap(m.exact));
    out.approx.textContent = show(m.approx, gap(m.approx));
    out.count.textContent = String(m.bright.length);
    out.order.textContent = m.bright.length
      ? `${m.orderBright.toExponential(1)} / ${m.orderFlat.toExponential(1)}`
      : "—";
    out.visibility.textContent = `${m.visibility.toFixed(3)} / ${m.visIdeal.toFixed(3)}`;
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p) {
    const k = (2 * Math.PI) / p.lam;
    const omega = k * V_PX_PER_SEC;
    const wt = omega * t;

    const cx = offW / 2, cy = offH / 2;
    const halfD = p.d / (2 * HR_DIV);
    const s1y = cy - halfD, s2y = cy + halfD;

    const kHR = k * HR_DIV;
    const A1 = p.A1, A2 = p.A2, phi = p.phi;
    const ampMax = A1 + A2;
    const invAmpMax = ampMax > 0 ? 1 / (2 * ampMax) : 0;

    let o = 0;
    for (let j = 0; j < offH; j++) {
      const dy1 = j - s1y;
      const dy2 = j - s2y;
      for (let i = 0; i < offW; i++) {
        const dx = i - cx;
        const r1 = Math.sqrt(dx * dx + dy1 * dy1);
        const r2 = Math.sqrt(dx * dx + dy2 * dy2);
        const v = A1 / Math.sqrt(Math.max(r1, 1)) * Math.cos(kHR * r1 - wt)
                + A2 / Math.sqrt(Math.max(r2, 1)) * Math.cos(kHR * r2 - wt + phi);
        let u = 0.5 + v * invAmpMax;
        if (u < 0) u = 0; else if (u > 1) u = 1;
        const rIdx = ((u * (RAMP_SIZE - 1)) | 0) << 2;
        px[o] = ramp[rIdx]; px[o + 1] = ramp[rIdx + 1];
        px[o + 2] = ramp[rIdx + 2]; px[o + 3] = 255;
        o += 4;
      }
    }
    octx.putImageData(imageData, 0, 0);
    sctx.drawImage(off, 0, 0, W, H);

    const fullCx = W / 2, fullCy = H / 2;
    if (p.screen) drawScreen(p, fullCx, fullCy);
    drawSource(fullCx, fullCy - p.d / 2, "S₁");
    drawSource(fullCx, fullCy + p.d / 2, "S₂");
  }

  /*
   * The screen, the fringes found on it, and the intensity profile that found
   * them. Drawing the profile is the point: the ticks are not decoration laid
   * over the picture, they are where the curve beside them peaked.
   */
  function drawScreen(p, cx, cy) {
    const m = measure(p);
    const sx = cx + m.L;

    sctx.save();
    sctx.strokeStyle = "rgba(236, 240, 251, 0.35)";
    sctx.lineWidth = 1;
    sctx.beginPath();
    sctx.moveTo(sx, 6); sctx.lineTo(sx, H - 6);
    sctx.stroke();

    // Intensity profile, drawn leftward from the screen and scaled to itself.
    let Imax = 0;
    for (let i = 0; i < SAMPLES; i++) if (m.scan.is[i] > Imax) Imax = m.scan.is[i];
    if (Imax > 0) {
      const span = Math.min(58, W * 0.10);
      sctx.strokeStyle = "rgba(255, 210, 122, 0.85)";
      sctx.lineWidth = 1.4;
      sctx.beginPath();
      for (let i = 0; i < SAMPLES; i++) {
        const y = cy + m.scan.ys[i];
        if (y < 0 || y > H) continue;
        const x = sx - (m.scan.is[i] / Imax) * span;
        if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
      }
      sctx.stroke();
    }

    // A tick at every located fringe: filled for bright, hollow for dark.
    for (const b of m.bright) {
      const y = cy + b.y;
      if (y < 4 || y > H - 4) continue;
      sctx.fillStyle = "rgba(255, 226, 168, 0.95)";
      sctx.fillRect(sx + 2, y - 1, 11, 2);
    }
    for (const dk of m.dark) {
      const y = cy + dk.y;
      if (y < 4 || y > H - 4) continue;
      sctx.strokeStyle = "rgba(140, 190, 255, 0.7)";
      sctx.lineWidth = 1;
      sctx.beginPath();
      sctx.moveTo(sx + 3, y); sctx.lineTo(sx + 10, y);
      sctx.stroke();
    }

    sctx.fillStyle = "rgba(236, 240, 251, 0.55)";
    sctx.font = "600 10px ui-monospace, monospace";
    sctx.textAlign = "right";
    sctx.fillText(i18nText("waveScreenLabel", "screen"), sx - 6, 16);
    sctx.restore();
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
    sctx.font = "600 13px ui-monospace, monospace";
    sctx.textBaseline = "middle";
    sctx.textAlign = "left";
    sctx.fillText(label, x + 11, y - 2);
    sctx.restore();
  }

  // ── Main loop ──────────────────────────────────────────────────────────
  function draw() {
    const p = readParams();
    render(p);
    updateReadouts(p);
  }

  function frame(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    const p = readParams();
    if (!paused) t += dt * p.sp;
    render(p);
    updateReadouts(p);
    if (!document.hidden && running) raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    if (running) raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function handleInput() {
    const p = readParams();
    updateLabels(p);
    updateReadouts(p);
    if (!running) draw();
  }
  Object.values(inputs).forEach((el) => el.addEventListener("input", handleInput));
  if (screenBox) screenBox.addEventListener("change", () => { if (!running) draw(); });
  inputs.wavelength.addEventListener("change", () =>
    window.SFX?.tone({ freq: 520 - parseFloat(inputs.wavelength.value) * 3, dur: 0.1, type: "sine", gain: 0.1 }));

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    window.SFX?.tone({ freq: paused ? 300 : 420, dur: 0.08, type: "sine", gain: 0.12 });
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
    if (screenBox) screenBox.checked = true;
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

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    updateReadouts(readParams());
  });

  // Headless access, so the checks can drive the measurement directly.
  window.__wave = {
    psi, intensity, pathDiff, orderAt, fringeY, scanScreen, extrema, measure,
    params: readParams,
    screenX,
    state: () => ({ t, paused, running }),
    setRunning: (on) => { running = on; if (on) start(); else { cancelAnimationFrame(raf); draw(); } },
    /** Measure a parameter set without touching the controls. */
    at: (o) => measure({ ...readParams(), ...o, screen: true }),
    PHASES, SAMPLES,
  };

  handleInput();
  start();
})();
