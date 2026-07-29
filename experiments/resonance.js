/*
 * A driven, damped harmonic oscillator — integrated, then measured.
 *
 *     ẍ + 2ζω₀ẋ + ω₀²x = X₀ω₀² cos ωt
 *
 * written in the dimensionless damping ratio ζ so nothing depends on a choice
 * of mass or spring constant. X₀ is the static deflection: what that same
 * force produces if you push infinitely slowly. In steady state
 *
 *     A/X₀ = 1 / √((1−r²)² + (2ζr)²),   tan φ = 2ζr/(1−r²),   r = ω/ω₀
 *
 * The mass is not placed on that curve. It is integrated from rest with RK4,
 * transient and all, and the amplitude and phase it settles into are then
 * *measured back out* of the motion by taking the Fourier component at the
 * drive frequency over one whole period:
 *
 *     a = (2/T)∫x·cos ωt dt = A cos φ      b = (2/T)∫x·sin ωt dt = A sin φ
 *
 * so A = √(a²+b²) and φ = atan2(b, a). The readout carries the gap between
 * that measurement and the closed form; it settles to a few parts in 10⁴ and
 * is the integrator and the algebra checking each other rather than one being
 * drawn from the other.
 *
 * Three facts are worth watching for and all fall out of the same expression:
 * amplitude peaks at r = √(1−2ζ²), slightly *below* resonance, and stops
 * peaking at all once ζ ≥ 1/√2; the phase lag is exactly 90° at r = 1 for
 * every ζ there is; and velocity — hence absorbed power — peaks exactly at
 * r = 1 rather than at the amplitude peak.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    natural: document.getElementById("natural"),
    drive: document.getElementById("drive"),
    zeta: document.getElementById("zeta"),
    static: document.getElementById("static"),
  };
  const inputValues = {
    natural: document.getElementById("natural-value"),
    drive: document.getElementById("drive-value"),
    zeta: document.getElementById("zeta-value"),
    static: document.getElementById("static-value"),
  };
  const out = {
    amp: document.getElementById("out-amp"),
    measured: document.getElementById("out-measured"),
    phase: document.getElementById("out-phase"),
    q: document.getElementById("out-q"),
    peak: document.getElementById("out-peak"),
    error: document.getElementById("out-error"),
  };
  const presetList = document.getElementById("preset-list");
  const tuneBtn = document.getElementById("tune-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const TAU = Math.PI * 2;
  const PRESETS = { light: 0.03, moderate: 0.15, heavy: 0.6, critical: 1.0 };

  function params() {
    const f0 = parseFloat(inputs.natural.value);
    const f = parseFloat(inputs.drive.value);
    return {
      f0, f,
      w0: TAU * f0,
      w: TAU * f,
      z: parseFloat(inputs.zeta.value),
      X0: parseFloat(inputs.static.value),        // cm
    };
  }

  // ── Closed form ────────────────────────────────────────────────────────
  /** Steady-state amplitude in units of the static deflection. */
  const gain = (r, z) => 1 / Math.hypot(1 - r * r, 2 * z * r);
  /** Phase by which the mass lags the force, radians in (0, π). */
  const phaseLag = (r, z) => Math.atan2(2 * z * r, 1 - r * r);
  /** Where the amplitude peaks — below ω₀, and nowhere once ζ ≥ 1/√2. */
  const peakRatio = (z) => (z < Math.SQRT1_2 ? Math.sqrt(1 - 2 * z * z) : NaN);
  const peakGain = (z) => (z < Math.SQRT1_2 ? 1 / (2 * z * Math.sqrt(1 - z * z)) : NaN);
  const qFactor = (z) => 1 / (2 * z);

  // ── State ──────────────────────────────────────────────────────────────
  let x = 0, v = 0, t = 0;
  let history = [];                 // { t, x } for the scrolling trace
  let running = true;

  // Fourier measurement, accumulated over exactly one drive period.
  let ia = 0, ib = 0, mt = 0;
  let measA = NaN, measPhi = NaN;

  function reset() {
    x = 0; v = 0; t = 0;
    history = [];
    ia = 0; ib = 0; mt = 0;
    measA = NaN; measPhi = NaN;
  }

  /** Sub-stepped RK4 on the equation of motion, with the measurement folded in. */
  function integrate(dt, p) {
    const sub = 24;                 // enough for 5 Hz drive at 60 fps
    const h = dt / sub;
    const a0 = p.X0 * p.w0 * p.w0;
    const accel = (xx, vv, tt) =>
      -2 * p.z * p.w0 * vv - p.w0 * p.w0 * xx + a0 * Math.cos(p.w * tt);

    for (let s = 0; s < sub; s++) {
      const k1x = v,                     k1v = accel(x, v, t);
      const k2x = v + (h / 2) * k1v,     k2v = accel(x + (h / 2) * k1x, k2x, t + h / 2);
      const k3x = v + (h / 2) * k2v,     k3v = accel(x + (h / 2) * k2x, k3x, t + h / 2);
      const k4x = v + h * k3v,           k4v = accel(x + h * k3x, k4x, t + h);
      x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      t += h;

      ia += x * Math.cos(p.w * t) * h;
      ib += x * Math.sin(p.w * t) * h;
      mt += h;
      const T = TAU / p.w;
      if (mt >= T) {
        measA = (2 / T) * Math.hypot(ia, ib);
        measPhi = Math.atan2(ib, ia);
        ia = 0; ib = 0; mt = 0;
      }
    }
  }

  /**
   * How much of the transient is gone. The homogeneous solution decays as
   * e^(−ζω₀t), so that exponential *is* the fraction still to go — no extra
   * factor belongs in it.
   */
  const settled = (p) => 1 - Math.exp(-p.z * p.w0 * t);

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    const narrow = W < 560;
    const oscBot = narrow ? 96 : 112;
    const traceBot = narrow ? 240 : 300;
    L = {
      narrow,
      fs: narrow ? 10 : 11,
      fsv: narrow ? 9 : 10,
      padL: narrow ? 34 : 46,
      padR: narrow ? 40 : 52,
      oscTop: 12, oscBot,
      traceTop: oscBot + 16, traceBot,
      curveTop: traceBot + (narrow ? 26 : 30),
      curveBot: H - (narrow ? 26 : 30),
    };
  }

  const text = (str, x2, y, colour, size, align, bold) => {
    ctx.fillStyle = colour;
    ctx.font = `${bold ? "600 " : ""}${size}px ui-monospace, monospace`;
    ctx.textAlign = align || "left";
    ctx.fillText(str, x2, y);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a0d18");
    bg.addColorStop(1, "#0d1122");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const { fs, fsv, padL, padR, narrow } = L;
    const r = p.w / p.w0;
    const A = gain(r, p.z) * p.X0;
    const phi = phaseLag(r, p.z);
    const pk = peakGain(p.z);
    const scaleMax = Math.max(Number.isFinite(pk) ? pk : 1.2, 1.2);

    // ── The oscillator: wall, spring, mass, and the force pushing it.
    {
      const cy = (L.oscTop + L.oscBot) / 2;
      const wallX = padL;
      const restX = W * 0.55;
      // cm → px, sized so the largest reachable swing still fits.
      const room = W - padR - restX - 40;
      const cmPx = Math.min(room / Math.max(scaleMax * p.X0, 0.5), 46);
      const mx = restX + x * cmPx;

      ctx.strokeStyle = "rgba(150,170,210,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(wallX, cy - 26); ctx.lineTo(wallX, cy + 26); ctx.stroke();

      // Spring, drawn with a coil count that keeps its pitch sane as it stretches.
      ctx.strokeStyle = "rgba(140,190,255,0.75)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const coils = 12, span = mx - 16 - wallX;
      ctx.moveTo(wallX, cy);
      for (let i = 0; i <= coils * 4; i++) {
        const u = i / (coils * 4);
        ctx.lineTo(wallX + span * u, cy + (i % 2 ? 0 : (i % 4 === 1 ? -9 : 9)) * (u > 0.02 && u < 0.98 ? 1 : 0));
      }
      ctx.lineTo(mx - 16, cy);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,138,163,0.92)";
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.rect(mx - 16, cy - 16, 32, 32); ctx.fill(); ctx.stroke();

      // Equilibrium marker, so the displacement is readable as a displacement.
      ctx.strokeStyle = "rgba(226,234,248,0.25)";
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(restX, cy - 30); ctx.lineTo(restX, cy + 30); ctx.stroke();
      ctx.setLineDash([]);

      // The driving force, as an arrow under the mass — its direction against
      // the mass's own motion is the phase lag, made visible.
      const drive = Math.cos(p.w * t);
      const fx = mx, fy = cy + 30;
      const len = drive * 34;
      ctx.strokeStyle = "rgba(255,225,74,0.9)";
      ctx.fillStyle = "rgba(255,225,74,0.9)";
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + len, fy); ctx.stroke();
      if (Math.abs(len) > 5) {
        const d = Math.sign(len);
        ctx.beginPath();
        ctx.moveTo(fx + len, fy);
        ctx.lineTo(fx + len - d * 7, fy - 4);
        ctx.lineTo(fx + len - d * 7, fy + 4);
        ctx.closePath(); ctx.fill();
      }
      text(i18nText("resDriveForce", "driving force"), padL, L.oscBot - 2,
        "rgba(255,225,74,0.6)", fsv, "left");
      text(`x = ${x.toFixed(3)} cm`, W - padR, L.oscTop + 12,
        "rgba(255,138,163,0.8)", fsv, "right");
    }

    // ── Displacement against time, with the analytic envelope over it.
    {
      const top = L.traceTop, bot = L.traceBot, cy = (top + bot) / 2;
      const win = Math.min(Math.max(6 / Math.max(p.f, 0.05), 3), 20);
      const yMax = Math.max(A * 1.25, p.X0 * 0.6);
      const X = (tt) => padL + ((tt - (t - win)) / win) * (W - padL - padR);
      const Y = (xx) => cy - (xx / yMax) * ((bot - top) / 2);

      ctx.strokeStyle = "rgba(255,255,255,0.09)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, cy); ctx.lineTo(W - padR, cy); ctx.stroke();

      // The amplitude the theory says it will settle at.
      ctx.strokeStyle = "rgba(110, 230, 190, 0.45)";
      ctx.setLineDash([5, 4]);
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(padL, Y(sgn * A)); ctx.lineTo(W - padR, Y(sgn * A));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      text(`±A = ${A.toFixed(2)} cm`, W - padR - 6, Y(A) - 5,
        "rgba(110,230,190,0.8)", fsv, "right");

      // The drive, faint, so the lag between them is directly visible.
      ctx.strokeStyle = "rgba(255,225,74,0.32)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let px = padL; px <= W - padR; px++) {
        const tt = t - win + ((px - padL) / (W - padL - padR)) * win;
        const yy = Y(Math.cos(p.w * tt) * yMax * 0.82);
        px === padL ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 138, 163, 0.95)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      let started = false;
      for (const h of history) {
        if (h.t < t - win) continue;
        const px = X(h.t), py = Y(h.x);
        started ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        started = true;
      }
      ctx.stroke();

      text(i18nText("resTraceLabel", "displacement over time"), padL, top - 6,
        "rgba(226,234,248,0.55)", fsv, "left");
      const s = settled(p);
      if (s < 0.999) {
        text(`${i18nText("resSettling", "transient still dying away")} · ${(s * 100).toFixed(0)}%`,
          W - padR, top - 6, "rgba(255,225,74,0.8)", fsv, "right");
      }
    }

    // ── The resonance curve, with the phase on the same axes.
    {
      const top = L.curveTop, bot = L.curveBot;
      const R_MAX = 3;
      const X = (rr) => padL + (rr / R_MAX) * (W - padL - padR);
      const Y = (g) => bot - (g / scaleMax) * (bot - top);
      const YP = (deg) => bot - (deg / 180) * (bot - top);

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      for (let k = 0; k <= 3; k++) {
        const gx = X(k);
        ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, bot); ctx.stroke();
        text(String(k), gx, bot + 14, "rgba(226,234,248,0.45)", fsv, "center");
      }
      ctx.beginPath(); ctx.moveTo(padL, bot + 0.5); ctx.lineTo(W - padR, bot + 0.5); ctx.stroke();
      for (const g of [scaleMax * 0.5, scaleMax]) {
        ctx.beginPath(); ctx.moveTo(padL, Y(g)); ctx.lineTo(W - padR, Y(g)); ctx.stroke();
        text(g.toFixed(1), padL - 6, Y(g) + 3.5, "rgba(110,230,190,0.6)", fsv, "right");
      }
      for (const d of [90, 180]) {
        text(`${d}°`, W - padR + 4, YP(d) + 3.5, "rgba(180,160,255,0.55)", fsv, "left");
      }

      // Phase first, so the amplitude curve sits on top of it.
      ctx.strokeStyle = "rgba(180, 160, 255, 0.65)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let px = padL; px <= W - padR; px++) {
        const rr = ((px - padL) / (W - padL - padR)) * R_MAX;
        const yy = YP((phaseLag(rr, p.z) * 180) / Math.PI);
        px === padL ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(110, 230, 190, 0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = padL; px <= W - padR; px++) {
        const rr = ((px - padL) / (W - padL - padR)) * R_MAX;
        const yy = Y(Math.min(gain(rr, p.z), scaleMax));
        px === padL ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
      }
      ctx.stroke();

      // r = 1 is where the phase crosses 90°, whatever the damping.
      ctx.strokeStyle = "rgba(226,234,248,0.3)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(X(1), top); ctx.lineTo(X(1), bot); ctx.stroke();
      ctx.setLineDash([]);
      text("f₀", X(1), top - 4, "rgba(226,234,248,0.5)", fsv, "center");

      // The amplitude peak, which is not there.
      const pr = peakRatio(p.z);
      if (Number.isFinite(pr)) {
        ctx.fillStyle = "rgba(110,230,190,0.9)";
        ctx.beginPath(); ctx.arc(X(pr), Y(peakGain(p.z)), 3.4, 0, Math.PI * 2); ctx.fill();
      } else {
        text(i18nText("resNoPeak", "ζ ≥ 1/√2 — no resonant peak at all"),
          W - padR, top + 16, "rgba(255,180,120,0.85)", fsv, "right");
      }

      // Where the drive currently sits on that curve.
      const gx = X(Math.min(r, R_MAX));
      ctx.strokeStyle = "rgba(255,225,74,0.9)";
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, bot); ctx.stroke();
      ctx.fillStyle = "rgba(255,225,74,1)";
      ctx.beginPath();
      ctx.arc(gx, Y(Math.min(gain(r, p.z), scaleMax)), 4.2, 0, Math.PI * 2);
      ctx.fill();

      text(i18nText("resCurveLabel", "amplitude A/X₀"), padL, top - 4,
        "rgba(110,230,190,0.75)", fsv, "left");
      // Clear of the 180° tick, which sits at exactly this height on the
      // right-hand phase scale.
      text(i18nText("resPhaseLabel", "phase lag"), W - padR - 34, top - 4,
        "rgba(180,160,255,0.7)", fsv, "right");

      text(i18nText("resRatioLabel", "f / f₀"), (padL + W - padR) / 2, bot + (narrow ? 25 : 27),
        "rgba(226,234,248,0.5)", fsv, "center");
      text(`φ = ${((phi * 180) / Math.PI).toFixed(1)}°`, gx + 6, top + 12,
        "rgba(255,225,74,0.9)", fsv, "left");
    }
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(p) {
    const r = p.w / p.w0;
    const g = gain(r, p.z);
    out.amp.textContent = g.toFixed(3);
    out.measured.textContent = Number.isFinite(measA) ? (measA / p.X0).toFixed(3) : "—";
    out.phase.textContent = ((phaseLag(r, p.z) * 180) / Math.PI).toFixed(1);
    out.q.textContent = qFactor(p.z).toFixed(2);
    const pr = peakRatio(p.z);
    out.peak.textContent = Number.isFinite(pr)
      ? (pr * p.f0).toFixed(3)
      : i18nText("resNone", "none");
    if (!Number.isFinite(measA)) {
      out.error.textContent = "—";
    } else if (settled(p) < 0.999) {
      // Below this the leftover transient still biases the Fourier window by
      // more than the number is worth, so say so rather than print it.
      out.error.textContent = i18nText("resSettlingShort", "settling…");
    } else {
      out.error.textContent = `${(Math.abs(measA / p.X0 - g) / g * 100).toExponential(1)} %`;
    }
  }

  function updateLabels() {
    inputValues.natural.textContent = parseFloat(inputs.natural.value).toFixed(2);
    inputValues.drive.textContent = parseFloat(inputs.drive.value).toFixed(2);
    inputValues.zeta.textContent = parseFloat(inputs.zeta.value).toFixed(2);
    inputValues.static.textContent = parseFloat(inputs.static.value).toFixed(1);
  }

  function syncPreset() {
    const z = parseFloat(inputs.zeta.value);
    const hit = Object.entries(PRESETS).find(([, v]) => Math.abs(v - z) < 1e-9);
    presetList.querySelectorAll(".mol-btn").forEach((b) => {
      const on = !!hit && b.dataset.key === hit[0];
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
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
    const p = params();
    if (running) {
      integrate(dt, p);
      history.push({ t, x });
      if (history.length > 4000) history.splice(0, history.length - 4000);
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
  // Every parameter change restarts the run: a measurement carried across a
  // change of drive or damping would be an average over two experiments.
  Object.values(inputs).forEach((el) => {
    el.addEventListener("input", () => { updateLabels(); syncPreset(); reset(); });
  });
  presetList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      inputs.zeta.value = String(PRESETS[btn.dataset.key]);
      updateLabels(); syncPreset(); reset();
      window.SFX?.tone({ freq: 520, dur: 0.08, type: "triangle", gain: 0.1 });
    });
  });
  tuneBtn.addEventListener("click", () => {
    const p = params();
    const pr = peakRatio(p.z);
    // With no amplitude peak there is still a phase resonance at f₀, so that
    // is where "tune" goes.
    const target = (Number.isFinite(pr) ? pr : 1) * p.f0;
    inputs.drive.value = String(Math.min(Math.max(target, 0.05), 5).toFixed(2));
    updateLabels(); reset();
    window.SFX?.tone({ freq: 880, dur: 0.14, type: "sine", gain: 0.12 });
  });
  pauseBtn.addEventListener("click", () => {
    running = !running;
    setPauseLabel();
    window.SFX?.click({ gain: 0.22 });
  });
  resetBtn.addEventListener("click", () => {
    reset();
    running = true;
    setPauseLabel();
    updateLabels();
    syncPreset();
    window.SFX?.click({ gain: 0.22 });
  });

  document.addEventListener("langchange", () => {
    setPauseLabel();
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
    H = W < 560 ? 470 : 560;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the harness can check the response against the closed forms.
  window.__res = {
    params, gain, phaseLag, peakRatio, peakGain, qFactor, integrate, reset,
    state: () => ({ x, v, t, measA, measPhi, settled: settled(params()) }),
    setRunning: (b) => { running = b; setPauseLabel(); },
  };

  resizeCanvas();
  updateLabels();
  syncPreset();
  setPauseLabel();
  start();
})();
