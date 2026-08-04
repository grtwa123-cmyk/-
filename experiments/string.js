/*
 * A string obeying the wave equation, and nothing else.
 *
 *     ∂²y/∂t² = c² ∂²y/∂x²,      y(0) = y(L) = 0,      c = √(T/µ)
 *
 * integrated by the standard explicit three-level stencil
 *
 *     yⁿ⁺¹ᵢ = 2(1−r²)yⁿᵢ + r²(yⁿᵢ₊₁ + yⁿᵢ₋₁) − yⁿ⁻¹ᵢ,    r = c·dt/dx
 *
 * at r = 0.4, comfortably inside the Courant limit of 1.
 *
 * No harmonic is written down anywhere. The only extra fact in the model is
 * that the two end points never move, and that alone is what quantises the
 * thing: between fixed ends only whole numbers of half-wavelengths fit, so a
 * Fourier transform of the shape finds energy at n·c/2L and nowhere else. The
 * frequencies are measured out of the motion, never imposed on it.
 *
 * Where you pluck decides which harmonics exist. Pull the string at its
 * midpoint and no even harmonic can start, because the midpoint is a node of
 * every one of them and you cannot excite a mode by displacing a point that
 * mode never displaces. The coefficients come out as sin(nπp)/n², which is the
 * Fourier series of a triangle, and the suppression is exact to one part in
 * 10¹⁶ rather than approximate.
 *
 * The grid is 720 points because 720 divides by 2, 3, 4, 5, 6, 8, 9, 10 and
 * 12. A pluck at L/3 on a grid of 800 lands on point 267 rather than 266.67,
 * which is 0.04% off the true third — enough to leave the third harmonic at
 * 0.05% instead of zero, and enough to make the cleanest demonstration on the
 * page look merely approximate.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    pluck: document.getElementById("pluck"),
    length: document.getElementById("length"),
    tension: document.getElementById("tension"),
    density: document.getElementById("density"),
    damping: document.getElementById("damping"),
    slow: document.getElementById("slow"),
  };
  const inputValues = {
    pluck: document.getElementById("pluck-value"),
    length: document.getElementById("length-value"),
    tension: document.getElementById("tension-value"),
    density: document.getElementById("density-value"),
    damping: document.getElementById("damping-value"),
    slow: document.getElementById("slow-value"),
  };
  const out = {
    speed: document.getElementById("out-speed"),
    f1: document.getElementById("out-f1"),
    measured: document.getElementById("out-measured"),
    missing: document.getElementById("out-missing"),
    strongest: document.getElementById("out-strongest"),
    note: document.getElementById("out-note"),
  };
  const soundToggle = document.getElementById("sound-on");
  const pluckBtn = document.getElementById("pluck-btn");
  const modeBtn = document.getElementById("bow-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── The string ─────────────────────────────────────────────────────────
  const N = 720;                 // divisible by 2,3,4,5,6,8,9,10,12
  const COURANT = 0.4;
  const MODES = 12;              // harmonics tracked for the spectrum

  // The pluck slider picks a simple fraction, so the demonstration lands on a
  // grid point exactly rather than 0.04% away from one.
  const FRACTIONS = [
    [1, 12], [1, 8], [1, 6], [1, 5], [1, 4], [1, 3],
    [2, 5], [5, 12], [1, 2], [7, 12], [3, 5],
  ];

  let y = new Float64Array(N + 1);
  let yPrev = new Float64Array(N + 1);
  let simT = 0;
  // Only the crossing times are kept, not the history they came from. A
  // buffer of samples would have to hold several periods, and a period is
  // some 3600 steps at the default settings — the first version stored 4096
  // samples, never accumulated three crossings, and the readout sat on
  // "measuring…" for ever.
  let crossings = [];
  let lastA1 = 0;
  let measuredF1 = NaN;

  function params() {
    const idx = parseInt(inputs.pluck.value, 10) - 1;
    const [num, den] = FRACTIONS[Math.max(0, Math.min(FRACTIONS.length - 1, idx))];
    const L = parseFloat(inputs.length.value);
    const T = parseFloat(inputs.tension.value);
    const mu = parseFloat(inputs.density.value) / 1000;   // g/m → kg/m
    const c = Math.sqrt(T / mu);
    return {
      num, den, p: num / den, L, T, mu, c,
      f1: c / (2 * L),
      damping: parseFloat(inputs.damping.value),
      slow: parseFloat(inputs.slow.value),
      dx: L / N,
      dt: (COURANT * (L / N)) / c,
    };
  }

  /** Amplitude of harmonic n, by discrete sine transform of the shape. */
  function modeAmp(n) {
    let s = 0;
    for (let i = 1; i < N; i++) s += y[i] * Math.sin((Math.PI * n * i) / N);
    return (2 * s) / N;
  }

  function spectrum() {
    const a = new Array(MODES);
    for (let n = 1; n <= MODES; n++) a[n - 1] = modeAmp(n);
    return a;
  }

  /** Total energy — kinetic from the two stored time levels, potential from slope. */
  function energy(p) {
    let k = 0, u = 0;
    for (let i = 1; i < N; i++) {
      const v = (y[i] - yPrev[i]) / p.dt;
      k += 0.5 * p.mu * v * v * p.dx;
    }
    for (let i = 0; i < N; i++) {
      const d = (y[i + 1] - y[i]) / p.dx;
      u += 0.5 * p.T * d * d * p.dx;
    }
    return k + u;
  }

  function clear() {
    y = new Float64Array(N + 1);
    yPrev = new Float64Array(N + 1);
    simT = 0;
    crossings = [];
    lastA1 = 0;
    measuredF1 = NaN;
  }

  /** A triangular displacement, released from rest — a real plucked string. */
  function pluck(p, amp = 0.004) {
    clear();
    const at = Math.round(p.p * N);
    for (let i = 0; i <= N; i++) {
      y[i] = i <= at ? (amp * i) / at : (amp * (N - i)) / (N - at);
    }
    yPrev = Float64Array.from(y);
  }

  /** Start in one pure mode instead, so the standing wave stands still. */
  function pureMode(n, amp = 0.004) {
    clear();
    for (let i = 0; i <= N; i++) y[i] = amp * Math.sin((Math.PI * n * i) / N);
    yPrev = Float64Array.from(y);
  }

  let modeN = 3;

  /*
   * Damping belongs on the velocity, not on the answer.
   *
   *     ∂²y/∂t² = c²∂²y/∂x² − 2γ ∂y/∂t
   *
   * central-differenced, gives
   *
   *     y^{n+1}(1+γdt) = 2(1−r²)y^n + r²(y_{i+1}+y_{i−1}) − (1−γdt)y^{n−1}
   *
   * The first version simply multiplied the whole new level by (1−γdt). That
   * scales the characteristic polynomial rather than adding a friction term,
   * and it moves the roots sideways as well as inwards: cos(ω′dt) = √f·cos(ωdt),
   * which at these settings raised every frequency by 19%. On a page about
   * pitch, the damping slider was quietly detuning the string.
   */
  function step(p) {
    const r2 = ((p.c * p.dt) / p.dx) ** 2;
    const g = p.damping * p.dt;
    const inv = 1 / (1 + g), old = 1 - g;
    const next = new Float64Array(N + 1);
    for (let i = 1; i < N; i++) {
      next[i] = ((2 - 2 * r2) * y[i] + r2 * (y[i + 1] + y[i - 1]) - old * yPrev[i]) * inv;
    }
    yPrev = y;
    y = next;
    simT += p.dt;

    // The fundamental's period is measured from its own sign changes, which is
    // a measurement of the motion rather than a restatement of c/2L.
    const a1 = modeAmp(1);
    if (lastA1 > 0 && a1 <= 0) {
      crossings.push(simT);
      if (crossings.length > 12) crossings.shift();
    }
    lastA1 = a1;
  }

  /** f₁ from the zero crossings of the fundamental's amplitude. */
  function measureF1() {
    if (crossings.length < 3) return NaN;
    // One downward crossing per period.
    const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    return period > 0 ? 1 / period : NaN;
  }

  // ── Sound ──────────────────────────────────────────────────────────────
  // Additive synthesis straight from the measured spectrum, at the real
  // frequencies rather than the slow-motion ones — so changing where you
  // pluck changes the timbre you hear, for the same reason it changes the bars.
  let audio = null, master = null, partials = [];
  function ensureAudio() {
    if (audio) return audio;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audio = new Ctx();
    master = audio.createGain();
    master.gain.value = 0;
    master.connect(audio.destination);
    for (let n = 1; n <= MODES; n++) {
      const osc = audio.createOscillator();
      const g = audio.createGain();
      osc.type = "sine";
      g.gain.value = 0;
      osc.connect(g); g.connect(master);
      osc.start();
      partials.push({ osc, g });
    }
    return audio;
  }
  function updateSound(p, amps) {
    if (!soundToggle.checked) {
      if (master) master.gain.setTargetAtTime(0, audio.currentTime, 0.05);
      return;
    }
    if (!ensureAudio()) return;
    if (audio.state === "suspended") audio.resume();
    const now = audio.currentTime;
    const peak = Math.max(1e-9, ...amps.map(Math.abs));
    master.gain.setTargetAtTime(0.18, now, 0.05);
    partials.forEach((q, i) => {
      const n = i + 1;
      const f = n * p.f1;
      q.osc.frequency.setTargetAtTime(Math.min(f, 18000), now, 0.02);
      // Relative to the loudest partial, so the timbre is what is heard.
      q.g.gain.setTargetAtTime((Math.abs(amps[i]) / peak) * 0.25, now, 0.04);
    });
  }
  function silence() {
    if (master && audio) master.gain.setTargetAtTime(0, audio.currentTime, 0.03);
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L2;
  function computeLayout() {
    const narrow = W < 560;
    const padL = narrow ? 40 : 54;
    const padR = narrow ? 14 : 20;
    const top = 14;
    const strH = narrow ? 190 : 230;
    const gap = narrow ? 34 : 40;
    const specH = H - top - strH - gap - (narrow ? 34 : 38);
    L2 = {
      narrow,
      fs: narrow ? 10 : 11,
      fsv: narrow ? 9 : 10,
      x0: padL, x1: W - padR,
      sTop: top, sBot: top + strH,
      spTop: top + strH + gap, spBot: top + strH + gap + specH,
    };
  }

  const text = (str, x, y2, colour, size, align, bold) => {
    ctx.fillStyle = colour;
    ctx.font = `${bold ? "600 " : ""}${size}px ui-monospace, monospace`;
    ctx.textAlign = align || "left";
    ctx.fillText(str, x, y2);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p, amps) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#080e1a");
    bg.addColorStop(1, "#0b1424");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ── The string.
    {
      const top = L2.sTop, bot = L2.sBot, mid = (top + bot) / 2;
      const span = L2.x1 - L2.x0;
      let peak = 1e-9;
      for (let i = 0; i <= N; i++) peak = Math.max(peak, Math.abs(y[i]));
      const scale = ((bot - top) * 0.42) / Math.max(peak, 0.0015);

      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L2.x0, mid); ctx.lineTo(L2.x1, mid); ctx.stroke();

      // The two fixed ends: the entire boundary condition, drawn.
      for (const x of [L2.x0, L2.x1]) {
        ctx.strokeStyle = "rgba(226,234,248,0.5)";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, mid - 26); ctx.lineTo(x, mid + 26); ctx.stroke();
      }

      // Nodes of the strongest harmonic, so the shape has landmarks.
      let strongest = 1, best = 0;
      amps.forEach((a, i) => { if (Math.abs(a) > best) { best = Math.abs(a); strongest = i + 1; } });
      if (strongest > 1) {
        ctx.fillStyle = "rgba(255,209,102,0.5)";
        for (let k = 1; k < strongest; k++) {
          const x = L2.x0 + (span * k) / strongest;
          ctx.beginPath(); ctx.arc(x, mid, 3, 0, Math.PI * 2); ctx.fill();
        }
      }

      ctx.strokeStyle = "rgba(122,217,238,0.98)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const x = L2.x0 + (span * i) / N;
        const yy = mid - y[i] * scale;
        i === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();

      // Where the pluck was, as the fraction it actually is.
      const px = L2.x0 + span * p.p;
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(255,209,102,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, top + 4); ctx.lineTo(px, bot - 4); ctx.stroke();
      ctx.setLineDash([]);
      text(`${p.num}/${p.den}`, px, top + 12, "rgba(255,209,102,0.8)", L2.fsv, "center");

      text(i18nText("swAxisString", "the string"), L2.x0, top - 4,
        "rgba(226,234,248,0.6)", L2.fsv, "left");
      text(`L = ${p.L.toFixed(2)} m`, L2.x1, bot + 15, "rgba(226,234,248,0.5)", L2.fsv, "right");
    }

    // ── The spectrum: what the motion is actually made of.
    {
      const top = L2.spTop, bot = L2.spBot;
      const span = L2.x1 - L2.x0;
      const bw = span / MODES;
      let peak = 1e-12;
      for (const a of amps) peak = Math.max(peak, Math.abs(a));

      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const yy = bot - ((bot - top) * k) / 4;
        ctx.beginPath(); ctx.moveTo(L2.x0, yy); ctx.lineTo(L2.x1, yy); ctx.stroke();
        text(`${(k * 25)}%`, L2.x0 - 6, yy + 3.5, "rgba(226,234,248,0.4)", L2.fsv, "right");
      }

      for (let n = 1; n <= MODES; n++) {
        const rel = Math.abs(amps[n - 1]) / peak;
        const x = L2.x0 + bw * (n - 1) + bw * 0.18;
        const w = bw * 0.64;
        const h = Math.max(rel * (bot - top), rel > 1e-6 ? 1.5 : 0);
        // A harmonic the pluck cannot reach is drawn as an empty slot, not a
        // sliver — that absence is the point of the experiment.
        if (rel < 1e-6) {
          ctx.strokeStyle = "rgba(226,234,248,0.18)";
          ctx.setLineDash([2, 3]);
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, bot - 10.5, w - 1, 10);
          ctx.setLineDash([]);
        } else {
          const g = ctx.createLinearGradient(0, bot - h, 0, bot);
          g.addColorStop(0, "rgba(122,217,238,0.95)");
          g.addColorStop(1, "rgba(122,217,238,0.35)");
          ctx.fillStyle = g;
          ctx.fillRect(x, bot - h, w, h);
        }
        const cx = x + w / 2;
        text(String(n), cx, bot + 14, "rgba(226,234,248,0.5)", L2.fsv, "center");
        if (rel > 0.06) {
          // A tall bar's label goes inside it — above the tallest bar there is
          // no room, and it landed on the panel caption.
          const inside = h > (bot - top) * 0.86;
          text(`${Math.round(n * p.f1)}`, cx, inside ? bot - h + 13 : bot - h - 5,
            inside ? "rgba(8,14,26,0.85)" : "rgba(226,234,248,0.55)", L2.fsv, "center");
        }
      }
      text(i18nText("swAxisSpectrum", "harmonic content (Hz above each bar)"),
        L2.x0, top - 6, "rgba(226,234,248,0.6)", L2.fsv, "left");
      text(i18nText("swAxisN", "harmonic n"), L2.x1, bot + (L2.narrow ? 26 : 28),
        "rgba(226,234,248,0.5)", L2.fsv, "right");
    }
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  function nearestNote(f) {
    if (!Number.isFinite(f) || f <= 0) return "—";
    const semis = Math.round(12 * Math.log2(f / 440));
    const name = NOTES[((semis + 9) % 12 + 12) % 12];
    const octave = 4 + Math.floor((semis + 9) / 12);
    const exact = 440 * Math.pow(2, semis / 12);
    const cents = Math.round(1200 * Math.log2(f / exact));
    return `${name}${octave} ${cents >= 0 ? "+" : "−"}${Math.abs(cents)}¢`;
  }

  function updateReadouts(p, amps) {
    out.speed.textContent = p.c.toFixed(1);
    out.f1.textContent = p.f1.toFixed(1);
    out.measured.textContent = Number.isFinite(measuredF1) ? measuredF1.toFixed(1)
      : i18nText("swMeasuring", "measuring…");

    const peak = Math.max(1e-12, ...amps.map(Math.abs));
    const missing = [];
    let strongest = 1, best = 0;
    amps.forEach((a, i) => {
      if (Math.abs(a) / peak < 1e-6) missing.push(i + 1);
      if (Math.abs(a) > best) { best = Math.abs(a); strongest = i + 1; }
    });
    out.missing.textContent = missing.length ? missing.join(", ")
      : i18nText("swNoneMissing", "none");
    out.strongest.textContent = `n = ${strongest} · ${Math.round(strongest * p.f1)} Hz`;
    out.note.textContent = nearestNote(p.f1);
  }

  function updateLabels() {
    const p = params();
    inputValues.pluck.textContent = `${p.num}/${p.den}`;
    inputValues.length.textContent = p.L.toFixed(2);
    inputValues.tension.textContent = inputs.tension.value;
    inputValues.density.textContent = parseFloat(inputs.density.value).toFixed(2);
    inputValues.damping.textContent = parseFloat(inputs.damping.value).toFixed(1);
    inputValues.slow.textContent = inputs.slow.value;
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let lastTs = performance.now();
  let raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dtReal = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    const p = params();

    const wanted = (dtReal / p.slow) / p.dt;
    const steps = Math.min(Math.round(wanted), 4000);
    for (let k = 0; k < steps; k++) step(p);
    if (steps > 0) measuredF1 = measureF1();

    const amps = spectrum();
    render(p, amps);
    updateReadouts(p, amps);
    updateSound(p, amps);
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  let lastAction = "pluck";
  const redo = () => {
    const p = params();
    if (lastAction === "mode") pureMode(modeN); else pluck(p);
  };

  Object.values(inputs).forEach((el) => {
    el.addEventListener("input", () => {
      updateLabels();
      // Slow motion and damping are properties of the viewing, not of the
      // string's starting shape, so they do not restart it.
      if (el !== inputs.slow && el !== inputs.damping) redo();
    });
  });
  pluckBtn.addEventListener("click", () => {
    lastAction = "pluck"; pluck(params());
    window.SFX?.click({ gain: 0.2 });
  });
  modeBtn.addEventListener("click", () => {
    lastAction = "mode";
    modeN = (modeN % 6) + 1;
    pureMode(modeN);
    modeBtn.textContent = `${i18nText("swModeBtn", "Pure harmonic")} n=${modeN}`;
    window.SFX?.tone({ freq: 440 * modeN / 2, dur: 0.1, type: "sine", gain: 0.1 });
  });
  resetBtn.addEventListener("click", () => {
    lastAction = "pluck";
    modeN = 3;
    modeBtn.textContent = i18nText("swModeBtn", "Pure harmonic");
    updateLabels();
    pluck(params());
    window.SFX?.click({ gain: 0.22 });
  });
  soundToggle.addEventListener("change", () => { if (!soundToggle.checked) silence(); });

  document.addEventListener("langchange", () => {
    modeBtn.textContent = lastAction === "mode"
      ? `${i18nText("swModeBtn", "Pure harmonic")} n=${modeN}`
      : i18nText("swModeBtn", "Pure harmonic");
    updateReadouts(params(), spectrum());
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); silence(); }
    else start();
  });

  function resizeCanvas() {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 260);
    H = W < 560 ? 540 : 600;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the harness can measure the harmonic series out of the motion
  // rather than trusting the readout.
  window.__sw = {
    N, MODES, COURANT, FRACTIONS,
    params, modeAmp, spectrum, energy, step, pluck, pureMode, clear,
    shape: () => Array.from(y),
    simTime: () => simT,
    measureF1,
    /** Run a fresh string and report the period of each harmonic it contains. */
    harmonics(p, { modes = [1, 2, 3, 4, 5, 6, 7], steps = 200000 } = {}) {
      pluck(p);
      const start0 = {}, cross = {}, prev = {};
      for (const n of modes) { prev[n] = modeAmp(n); start0[n] = Math.abs(prev[n]); cross[n] = []; }
      for (let k = 0; k < steps; k++) {
        step(p);
        for (const n of modes) {
          const a = modeAmp(n);
          if (prev[n] > 0 && a <= 0) cross[n].push(simT);
          prev[n] = a;
        }
      }
      return modes.map((n) => {
        const cs = cross[n];
        const excited = start0[n] / start0[1] > 1e-6;
        const period = cs.length >= 3 ? (cs[cs.length - 1] - cs[0]) / (cs.length - 1) : NaN;
        return { n, excited, amp0: start0[n], f: period > 0 ? 1 / period : NaN,
                 want: n * p.f1 };
      });
    },
  };

  resizeCanvas();
  updateLabels();
  pluck(params());
  start();
})();
