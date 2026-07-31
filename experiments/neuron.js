/*
 * The Hodgkin–Huxley axon, integrated as written.
 *
 * Four coupled ordinary differential equations and nothing else:
 *
 *     C dV/dt = I − ḡ_Na m³h (V−E_Na) − ḡ_K n⁴ (V−E_K) − g_L (V−E_L)
 *     dx/dt   = αₓ(V)(1−x) − βₓ(V)x                for x = m, h, n
 *
 * No line here compares V against a threshold, and none decides that a spike
 * has begun. The action potential is what those equations do when you push a
 * little current into them, and the threshold is a property of the gate
 * kinetics rather than a rule imposed on top:
 *
 *   m opens in a fraction of a millisecond and pulls V towards E_Na, which
 *   opens m further — the positive feedback that makes the rise so steep.
 *   h closes more slowly and shuts the sodium off. n opens later still and
 *   pulls V down past rest. The refractory period is h needing time to
 *   reopen; nothing counts it out.
 *
 * α and β are Hodgkin and Huxley's own fits to their voltage-clamp data, in
 * the modern sign convention where rest is about −65 mV rather than 0.
 *
 * Integration is RK4 at a fixed 5 µs step. The spike's rising phase turns
 * over in well under a millisecond, and a step chosen for the display's frame
 * rate rather than the equations would round the peak off.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    amp: document.getElementById("amp"),
    width: document.getElementById("width"),
    gap: document.getElementById("gap"),
    ttx: document.getElementById("ttx"),
    tea: document.getElementById("tea"),
    speed: document.getElementById("speed"),
  };
  const inputValues = {
    amp: document.getElementById("amp-value"),
    width: document.getElementById("width-value"),
    gap: document.getElementById("gap-value"),
    ttx: document.getElementById("ttx-value"),
    tea: document.getElementById("tea-value"),
    speed: document.getElementById("speed-value"),
  };
  const out = {
    v: document.getElementById("out-v"),
    peak: document.getElementById("out-peak"),
    threshold: document.getElementById("out-threshold"),
    rate: document.getElementById("out-rate"),
    gates: document.getElementById("out-gates"),
    state: document.getElementById("out-state"),
  };
  const modeList = document.getElementById("mode-list");
  const widthControl = document.getElementById("width-control");
  const gapControl = document.getElementById("gap-control");
  const fireBtn = document.getElementById("fire-btn");
  const thresholdBtn = document.getElementById("threshold-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Constants, in the squid axon's own units ───────────────────────────
  // µF/cm², mS/cm², mV, ms.
  const C_M = 1;
  const G_NA = 120, G_K = 36, G_L = 0.3;
  const E_NA = 50, E_K = -77, E_L = -54.387;

  // Hodgkin and Huxley's rate functions. Two of them are 0/0 at a single
  // voltage — the expression, not the biology — so the limit is used there.
  const aM = (V) => (Math.abs(V + 40) < 1e-6 ? 1 : 0.1 * (V + 40) / (1 - Math.exp(-(V + 40) / 10)));
  const bM = (V) => 4 * Math.exp(-(V + 65) / 18);
  const aH = (V) => 0.07 * Math.exp(-(V + 65) / 20);
  const bH = (V) => 1 / (1 + Math.exp(-(V + 35) / 10));
  const aN = (V) => (Math.abs(V + 55) < 1e-6 ? 0.1 : 0.01 * (V + 55) / (1 - Math.exp(-(V + 55) / 10)));
  const bN = (V) => 0.125 * Math.exp(-(V + 65) / 80);
  const steady = (a, b, V) => a(V) / (a(V) + b(V));

  const DT = 0.005;              // ms — set by the spike, not the frame rate
  const WINDOW = 50;             // ms of trace on screen, for a scrolling run

  /**
   * How much time the display covers, and where it starts.
   *
   * A single pulse fires once at t = 0 and is over in a few milliseconds. If
   * the window scrolls it slides off almost immediately and the run ends
   * showing fifty milliseconds of flat resting potential — the one thing the
   * page exists to show, gone. So the discrete stimuli hold a fixed window and
   * stop when it is full; only the sustained ones scroll.
   */
  function windowSpan(p) {
    if (p.mode === "pair") return Math.max(WINDOW, p.gap + 35);
    return WINDOW;
  }
  const scrolls = (p) => p.mode === "steady" || p.mode === "ramp";
  function windowStart(p) {
    return scrolls(p) ? Math.max(0, t - windowSpan(p)) : 0;
  }

  function params() {
    return {
      amp: parseFloat(inputs.amp.value),
      width: parseFloat(inputs.width.value),
      gap: parseFloat(inputs.gap.value),
      gNa: G_NA * parseFloat(inputs.ttx.value) / 100,
      gK: G_K * parseFloat(inputs.tea.value) / 100,
      mode,
    };
  }

  /** The three ionic currents, positive outward. */
  function currents(s, p) {
    const [V, m, h, n] = s;
    return {
      iNa: p.gNa * m * m * m * h * (V - E_NA),
      iK: p.gK * n * n * n * n * (V - E_K),
      iL: G_L * (V - E_L),
    };
  }

  /**
   * Is the membrane depolarising itself?
   *
   * Counting a spike as "V crossed 0 mV" is not enough. Drive enough current
   * through the electrode and V will cross zero with every sodium channel
   * blocked — that is the membrane being charged from outside, not an action
   * potential. A spike is regenerative: the channels themselves are pushing.
   * With TTX on board that can never be true, which is the correct answer.
   */
  function regenerative(s, p) {
    const { iNa, iK, iL } = currents(s, p);
    return -(iNa + iK + iL) > 0;
  }

  /** State vector [V, m, h, n]. */
  function derivatives(s, I, p) {
    const [V, m, h, n] = s;
    const iNa = p.gNa * m * m * m * h * (V - E_NA);
    const iK = p.gK * n * n * n * n * (V - E_K);
    const iL = G_L * (V - E_L);
    return [
      (I - iNa - iK - iL) / C_M,
      aM(V) * (1 - m) - bM(V) * m,
      aH(V) * (1 - h) - bH(V) * h,
      aN(V) * (1 - n) - bN(V) * n,
    ];
  }

  function rk4(s, dt, I, p) {
    const add = (base, k, f) => base.map((x, i) => x + k[i] * f);
    const k1 = derivatives(s, I, p);
    const k2 = derivatives(add(s, k1, dt / 2), I, p);
    const k3 = derivatives(add(s, k2, dt / 2), I, p);
    const k4 = derivatives(add(s, k3, dt), I, p);
    return s.map((x, i) => x + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }

  /** The resting state: where the equations sit with no current at all. */
  function restingState() {
    let V = -65;
    for (let i = 0; i < 4000; i++) {
      const m = steady(aM, bM, V), h = steady(aH, bH, V), n = steady(aN, bN, V);
      const flux = -G_NA * m * m * m * h * (V - E_NA)
                   - G_K * n * n * n * n * (V - E_K) - G_L * (V - E_L);
      V += flux * 0.01;
    }
    return [V, steady(aM, bM, V), steady(aH, bH, V), steady(aN, bN, V)];
  }
  const REST = restingState();

  /** The stimulus waveform — the only thing the experimenter controls. */
  function stimulus(t, p) {
    switch (p.mode) {
      case "pulse": return t >= 0 && t < p.width ? p.amp : 0;
      case "pair":  return (t >= 0 && t < p.width) ||
                           (t >= p.gap && t < p.gap + p.width) ? p.amp : 0;
      case "steady": return t >= 0 ? p.amp : 0;
      case "ramp":   return t >= 0 ? Math.min(p.amp, (p.amp * t) / 40) : 0;
      default: return 0;
    }
  }

  // ── Live state ─────────────────────────────────────────────────────────
  let mode = "pulse";
  let s = [...REST];
  let t = 0;                     // ms since the stimulus began
  let running = false;
  let trace = [];                // { t, V, m, h, n, iNa, iK, I }
  let spikeTimes = [];
  let lastPeak = NaN;
  let peakTracking = false, peakValue = -Infinity;
  let measuredThreshold = NaN;

  function reset() {
    s = [...REST];
    t = 0;
    running = false;
    trace = [];
    spikeTimes = [];
    lastPeak = NaN;
    peakTracking = false;
    peakValue = -Infinity;
  }

  /** One integration step, plus the bookkeeping the readouts need. */
  function advance(p) {
    const prevV = s[0];
    const I = stimulus(t, p);
    s = rk4(s, DT, I, p);
    t += DT;

    // A spike is *counted* by a regenerative upward crossing of 0 mV. That is
    // a detector for the readout — the model neither knows nor uses it.
    if (prevV < 0 && s[0] >= 0 && regenerative(s, p)) {
      spikeTimes.push(t);
      peakTracking = true;
      peakValue = -Infinity;
    }
    if (peakTracking) {
      if (s[0] > peakValue) peakValue = s[0];
      else if (s[0] < 0) { lastPeak = peakValue; peakTracking = false; }
    }

    const [V, m, h, n] = s;
    trace.push({
      t, V, m, h, n, I,
      iNa: p.gNa * m * m * m * h * (V - E_NA),
      iK: p.gK * n * n * n * n * (V - E_K),
    });
    // Keep a little more than the window so the left edge is never bare. A
    // fixed window keeps everything; only a scrolling one discards.
    if (scrolls(p)) {
      const cutoff = t - windowSpan(p) * 1.05;
      while (trace.length && trace[0].t < cutoff) trace.shift();
    }
  }

  /**
   * Bisect for the smallest stimulus that produces a spike.
   *
   * This runs the same equations on a throwaway copy of the state, so what it
   * reports is a measurement of the model rather than a constant.
   */
  function findThreshold(p, span = 60) {
    const fires = (amp) => {
      let st = [...REST], tt = 0, prev = REST[0];
      const probe = { ...p, amp, mode: p.mode === "steady" || p.mode === "ramp" ? "steady" : p.mode };
      while (tt < span) {
        const I = stimulus(tt, probe);
        st = rk4(st, DT, I, probe);
        tt += DT;
        if (prev < 0 && st[0] >= 0 && regenerative(st, probe)) return true;
        prev = st[0];
      }
      return false;
    };
    let lo = 0, hi = 400;
    if (!fires(hi)) return NaN;          // blocked channels, or nothing works
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fires(mid)) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  /** Firing rate from the counted crossings, ignoring the first transient. */
  function firingRate() {
    const recent = spikeTimes.filter((x) => x > 20);
    if (recent.length < 2) return NaN;
    const span = recent[recent.length - 1] - recent[0];
    return span > 0 ? (1000 * (recent.length - 1)) / span : NaN;
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    const narrow = W < 560;
    const padL = narrow ? 42 : 56;
    const padR = narrow ? 12 : 18;
    const top = 8;
    const memH = narrow ? 74 : 92;
    const gap = narrow ? 26 : 30;
    const rest = H - top - memH - gap * 3 - (narrow ? 34 : 38);
    const vH = Math.round(rest * 0.5);
    const gH = Math.round(rest * 0.25);
    const cH = rest - vH - gH;
    L = {
      narrow,
      fs: narrow ? 10 : 11,
      fsv: narrow ? 9 : 10,
      x0: padL, x1: W - padR,
      memTop: top, memBot: top + memH,
      vTop: top + memH + gap, vBot: top + memH + gap + vH,
      gTop: top + memH + gap * 2 + vH, gBot: top + memH + gap * 2 + vH + gH,
      cTop: top + memH + gap * 3 + vH + gH, cBot: top + memH + gap * 3 + vH + gH + cH,
    };
  }

  const text = (str, x, y, colour, size, align, bold) => {
    ctx.fillStyle = colour;
    ctx.font = `${bold ? "600 " : ""}${size}px ui-monospace, monospace`;
    ctx.textAlign = align || "left";
    ctx.fillText(str, x, y);
  };

  const clipTo = (top, bot, fn) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x0, top, L.x1 - L.x0, bot - top);
    ctx.clip();
    fn();
    ctx.restore();
  };

  let viewT0 = 0, viewSpan = WINDOW;      // set once per frame by render()
  const tX = (tt) => L.x0 + ((tt - viewT0) / viewSpan) * (L.x1 - L.x0);

  /** A panel: axes, gridlines, labels, and one or more traces through it. */
  function panel(top, bot, lo, hi, ticks, series, label) {
    const Y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (const tick of ticks) {
      ctx.beginPath(); ctx.moveTo(L.x0, Y(tick)); ctx.lineTo(L.x1, Y(tick)); ctx.stroke();
      text(String(tick), L.x0 - 6, Y(tick) + 3.5, "rgba(226,234,248,0.45)", L.fsv, "right");
    }
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath(); ctx.moveTo(L.x0, bot); ctx.lineTo(L.x1, bot); ctx.stroke();
    clipTo(top, bot, () => {
      for (const { pick, colour, width } of series) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width || 1.8;
        ctx.beginPath();
        let started = false;
        for (const pt of trace) {
          const x = tX(pt.t), y = Y(pick(pt));
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    });
    text(label, L.x0, top - 6, "rgba(226,234,248,0.6)", L.fsv, "left");
    return Y;
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p) {
    viewSpan = windowSpan(p);
    viewT0 = windowStart(p);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a1016");
    bg.addColorStop(1, "#0c1222");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const [V, m, h, n] = s;
    const openNa = m * m * m * h;
    const openK = n * n * n * n;

    // ── The membrane. Channel openness is m³h and n⁴ themselves, so this is
    //    a picture of the state vector rather than a decoration.
    {
      const top = L.memTop, bot = L.memBot, mid = (top + bot) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(L.x0, mid - 9, L.x1 - L.x0, 18);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(L.x0 + 0.5, mid - 9.5, L.x1 - L.x0 - 1, 19);

      // The sign of V is the polarity: at rest the inside is negative, and
      // during the overshoot it genuinely reverses. Drawing a deviation from
      // rest instead would show an unpolarised membrane at rest, which is the
      // opposite of the truth.
      const insideNegative = V < 0;
      for (let k = 0; k < 26; k++) {
        const x = L.x0 + 12 + (k / 25) * (L.x1 - L.x0 - 24);
        ctx.fillStyle = "rgba(255,138,163,0.55)";
        ctx.fillText(insideNegative ? "+" : "−", x, mid - 14);   // outside
        ctx.fillStyle = "rgba(110,168,255,0.55)";
        ctx.fillText(insideNegative ? "−" : "+", x, mid + 22);   // inside
      }
      ctx.font = `${L.fsv}px ui-monospace, monospace`;

      const drawChannel = (cx, open, colour, label) => {
        const w = 13, gapW = open * 9;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, mid - 11); ctx.lineTo(cx - w / 2, mid + 11);
        ctx.moveTo(cx + w / 2, mid - 11); ctx.lineTo(cx + w / 2, mid + 11);
        ctx.stroke();
        // The pore, drawn open in proportion to the gating variable.
        ctx.fillStyle = colour.replace(/[\d.]+\)$/, `${0.15 + 0.6 * open})`);
        ctx.fillRect(cx - gapW / 2, mid - 10, Math.max(gapW, 0.5), 20);
        text(label, cx, bot - 2, colour, L.fsv, "center");
      };
      const span = L.x1 - L.x0;
      for (let k = 0; k < 4; k++) {
        drawChannel(L.x0 + span * (0.14 + k * 0.09), openNa, "rgba(255,209,102,0.95)", k === 0 ? "Na⁺" : "");
        drawChannel(L.x0 + span * (0.56 + k * 0.09), openK, "rgba(123,224,208,0.95)", k === 0 ? "K⁺" : "");
      }
      text(`${(openNa * 100).toFixed(1)}%`, L.x0 + span * 0.14 + 46, bot - 2,
        "rgba(255,209,102,0.7)", L.fsv, "left");
      text(`${(openK * 100).toFixed(1)}%`, L.x0 + span * 0.56 + 46, bot - 2,
        "rgba(123,224,208,0.7)", L.fsv, "left");
    }

    // ── Voltage.
    const vY = panel(L.vTop, L.vBot, -90, 60, [-80, -40, 0, 40], [
      { pick: (d) => d.V, colour: "rgba(255,209,102,0.98)", width: 2.2 },
    ], i18nText("hhAxisV", "membrane potential (mV)"));

    // Rest and the sodium reversal, the two levels the spike lives between.
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(226,234,248,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L.x0, vY(REST[0])); ctx.lineTo(L.x1, vY(REST[0])); ctx.stroke();
    ctx.strokeStyle = "rgba(255,209,102,0.25)";
    ctx.beginPath(); ctx.moveTo(L.x0, vY(E_NA)); ctx.lineTo(L.x1, vY(E_NA)); ctx.stroke();
    ctx.setLineDash([]);
    text("E_Na", L.x1 - 4, vY(E_NA) + 12, "rgba(255,209,102,0.6)", L.fsv, "right");
    text(i18nText("hhRest", "rest"), L.x1 - 4, vY(REST[0]) - 5, "rgba(226,234,248,0.5)", L.fsv, "right");

    // The stimulus itself, as a band along the bottom of the voltage panel.
    clipTo(L.vTop, L.vBot, () => {
      ctx.fillStyle = "rgba(110,168,255,0.22)";
      for (const pt of trace) {
        if (pt.I > 0) ctx.fillRect(tX(pt.t), L.vBot - 7, 2, 7);
      }
    });
    text(i18nText("hhStimBand", "stimulus"), L.x1 - 4, L.vBot - 10,
      "rgba(110,168,255,0.65)", L.fsv, "right");

    // ── Gates.
    panel(L.gTop, L.gBot, 0, 1, [0, 0.5, 1], [
      { pick: (d) => d.m, colour: "rgba(255,209,102,0.95)" },
      { pick: (d) => d.h, colour: "rgba(255,138,163,0.95)" },
      { pick: (d) => d.n, colour: "rgba(123,224,208,0.95)" },
    ], i18nText("hhAxisGates", "gates  m (Na open) · h (Na inactivate) · n (K open)"));

    // ── Currents. The scale follows the trace, since blocking a channel
    //    changes the range by orders of magnitude.
    let peakI = 100;
    for (const d of trace) peakI = Math.max(peakI, Math.abs(d.iNa), Math.abs(d.iK));
    peakI = Math.ceil(peakI / 100) * 100;
    panel(L.cTop, L.cBot, -peakI, peakI, [-peakI, 0, peakI], [
      { pick: (d) => d.iNa, colour: "rgba(255,209,102,0.9)" },
      { pick: (d) => d.iK, colour: "rgba(123,224,208,0.9)" },
    ], i18nText("hhAxisI", "ionic current (µA/cm²)  inward Na⁺ · outward K⁺"));

    // Time axis.
    for (let k = 0; k <= 5; k++) {
      const tt = viewT0 + (viewSpan * k) / 5;
      text(tt.toFixed(0), tX(tt), L.cBot + 14, "rgba(226,234,248,0.45)", L.fsv, "center");
    }
    text(i18nText("hhAxisT", "time (ms)"), L.x1, L.cBot + (L.narrow ? 24 : 26),
      "rgba(226,234,248,0.5)", L.fsv, "right");

    if (!running && trace.length === 0) {
      text(i18nText("hhIdle", "press Stimulate"), (L.x0 + L.x1) / 2, (L.vTop + L.vBot) / 2,
        "rgba(226,234,248,0.35)", L.fs, "center");
    }
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(p) {
    const [V, m, h, n] = s;
    out.v.textContent = V.toFixed(1);
    out.peak.textContent = Number.isFinite(lastPeak) ? lastPeak.toFixed(1) : "—";
    out.threshold.textContent = Number.isFinite(measuredThreshold)
      ? measuredThreshold.toFixed(3) : "—";
    const rate = firingRate();
    out.rate.textContent = Number.isFinite(rate) ? rate.toFixed(0) : "—";
    out.gates.textContent = `${m.toFixed(2)} · ${h.toFixed(2)} · ${n.toFixed(2)}`;

    // The label describes what the gates are doing; it does not drive anything.
    let key = "hhStateRest", fallback = "resting";
    if (!running && trace.length === 0) { key = "hhStateIdle"; fallback = "idle"; }
    else if (V > 0) { key = "hhStateSpike"; fallback = "spiking"; }
    else if (h < 0.3) { key = "hhStateAbsRef"; fallback = "refractory (h shut)"; }
    else if (h < REST[2] * 0.92 || n > REST[3] * 1.15) { key = "hhStateRelRef"; fallback = "recovering"; }
    else if (V < REST[0] - 2) { key = "hhStateHyper"; fallback = "hyperpolarised"; }
    out.state.textContent = i18nText(key, fallback);
  }

  function updateLabels() {
    inputValues.amp.textContent = parseFloat(inputs.amp.value).toFixed(1);
    inputValues.width.textContent = parseFloat(inputs.width.value).toFixed(1);
    inputValues.gap.textContent = parseFloat(inputs.gap.value).toFixed(1);
    inputValues.ttx.textContent = inputs.ttx.value;
    inputValues.tea.textContent = inputs.tea.value;
    inputValues.speed.textContent = inputs.speed.value;
    widthControl.hidden = mode === "steady" || mode === "ramp";
    gapControl.hidden = mode !== "pair";
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let lastTs = performance.now();
  let raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dtReal = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    const p = params();

    if (running) {
      const msWanted = parseFloat(inputs.speed.value) * dtReal;
      const steps = Math.min(Math.round(msWanted / DT), 20000);
      for (let k = 0; k < steps; k++) advance(p);
      // A discrete stimulus is done when its window is full; running on would
      // only push the spike off the left-hand edge.
      if (!scrolls(p) && t >= windowSpan(p)) running = false;
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
  function setMode(next) {
    mode = next;
    modeList.querySelectorAll(".mol-btn").forEach((b) => {
      const on = b.dataset.key === next;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    reset();
    updateLabels();
  }

  function fire() {
    reset();
    running = true;
  }

  Object.values(inputs).forEach((el) => {
    el.addEventListener("input", () => {
      updateLabels();
      // Speed is a property of the display; everything else changes the
      // experiment, so the trace on screen no longer belongs to it.
      if (el !== inputs.speed) { measuredThreshold = NaN; reset(); }
    });
  });
  modeList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.key);
      measuredThreshold = NaN;
      window.SFX?.tone({ freq: 520, dur: 0.08, type: "triangle", gain: 0.1 });
    });
  });
  fireBtn.addEventListener("click", () => {
    fire();
    window.SFX?.click({ gain: 0.22 });
  });
  thresholdBtn.addEventListener("click", () => {
    measuredThreshold = findThreshold(params());
    if (Number.isFinite(measuredThreshold)) {
      inputs.amp.value = String(Math.round(measuredThreshold * 1.02 * 2) / 2);
      updateLabels();
      fire();
    }
    window.SFX?.click({ gain: 0.2, freq: 1500 });
  });
  resetBtn.addEventListener("click", () => {
    measuredThreshold = NaN;
    reset();
    updateLabels();
    window.SFX?.click({ gain: 0.22 });
  });

  document.addEventListener("langchange", () => updateReadouts(params()));
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

  // Exposed so the harness can drive the equations directly and check that
  // the threshold, the refractory period and the firing rate are results.
  window.__hh = {
    REST, DT, E_NA, E_K, E_L, G_NA, G_K, G_L,
    params, derivatives, currents, regenerative, rk4, stimulus, findThreshold, restingState,
    rates: { aM, bM, aH, bH, aN, bN, steady },
    /** Run the model from rest on a throwaway state and report what happened. */
    simulate(p, span) {
      let st = [...REST], tt = 0, prev = REST[0];
      let peak = -Infinity, spikes = [], minV = Infinity;
      while (tt < span) {
        st = rk4(st, DT, stimulus(tt, p), p);
        tt += DT;
        if (prev < 0 && st[0] >= 0 && regenerative(st, p)) spikes.push(tt);
        prev = st[0];
        peak = Math.max(peak, st[0]);
        minV = Math.min(minV, st[0]);
      }
      const rate = spikes.length > 1
        ? (1000 * (spikes.length - 1)) / (spikes[spikes.length - 1] - spikes[0]) : 0;
      return { peak, minV, spikes: spikes.length, times: spikes, rate, end: st };
    },
    state: () => ({ t, V: s[0], m: s[1], h: s[2], n: s[3], running,
                    spikes: spikeTimes.length, lastPeak, measuredThreshold }),
    setMode, fire, reset,
    isRunning: () => running,
  };

  resizeCanvas();
  updateLabels();
  updateReadouts(params());
  start();
})();
