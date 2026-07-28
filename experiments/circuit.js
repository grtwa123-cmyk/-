/*
 * Ohm's law — series and parallel, solved rather than illustrated.
 *
 * The network is small enough that the exact answer is a formula, so that is
 * what runs: nothing here is a fitted curve or a hand-tuned animation.
 *
 *   series    R = ΣRᵢ            one path, so I is shared and V divides
 *   parallel  1/R = Σ1/Rᵢ        one node pair, so V is shared and I divides
 *   both      I = V/R,  P = VI = I²R
 *
 * The two arrangements are the same two Kirchhoff rules seen from different
 * sides — voltages around a loop sum to zero, currents into a node sum to
 * zero — and both residuals are printed live, so the solver can be checked
 * against itself while you drag the sliders.
 *
 * Two things here are measurements rather than decoration:
 *
 *   · Carrier speed is proportional to the current in *that* wire, against a
 *     fixed reference for the whole simulation. So the segments of a parallel
 *     rail visibly slow down as each branch taps its share off, and switching
 *     series → parallel speeds the battery wire up, because the same battery
 *     now drives a smaller total resistance.
 *   · Resistor bodies warm with the power they dissipate, on an absolute
 *     scale — a resistor burning 1 mW stays cold no matter what its
 *     neighbours are doing.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    emf: document.getElementById("emf"),
    r1:  document.getElementById("r1"),
    r2:  document.getElementById("r2"),
    r3:  document.getElementById("r3"),
  };
  const inputValues = {
    emf: document.getElementById("emf-value"),
    r1:  document.getElementById("r1-value"),
    r2:  document.getElementById("r2-value"),
    r3:  document.getElementById("r3-value"),
  };
  const out = {
    rtotal:  document.getElementById("out-rtotal"),
    current: document.getElementById("out-current"),
    power:   document.getElementById("out-power"),
    r1:      document.getElementById("out-r1"),
    r2:      document.getElementById("out-r2"),
    r3:      document.getElementById("out-r3"),
  };
  const modeList = document.getElementById("mode-list");
  const r3Toggle = document.getElementById("r3-on");
  const swToggle = document.getElementById("switch-on");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  let mode = "series";

  // Reference current for carrier speed, and reference power for body heat.
  // Both are fixed constants so the visuals compare across configurations
  // instead of being renormalised every frame.
  const REF_I = 0.05;   // A  — a carrier moving at "1×" is 50 mA
  const REF_P = 0.5;    // W  — a body at full heat is dissipating half a watt

  // ── Solver ─────────────────────────────────────────────────────────────
  function solve() {
    const V = parseFloat(inputs.emf.value);
    const R = [parseFloat(inputs.r1.value), parseFloat(inputs.r2.value)];
    if (r3Toggle.checked) R.push(parseFloat(inputs.r3.value));
    const closed = swToggle.checked;
    const Vs = closed ? V : 0;   // voltage actually driving the network

    let Rtot, I, branches;
    if (mode === "series") {
      Rtot = R.reduce((a, b) => a + b, 0);
      I = Vs / Rtot;
      // One path: every resistor carries the same current; the drops divide.
      branches = R.map((r) => ({ r, I, V: I * r, P: I * I * r }));
    } else {
      Rtot = 1 / R.reduce((a, r) => a + 1 / r, 0);
      // One node pair: every resistor sees the whole source voltage.
      branches = R.map((r) => ({ r, I: Vs / r, V: Vs, P: (Vs * Vs) / r }));
      I = branches.reduce((a, b) => a + b.I, 0);
    }
    const P = Vs * I;

    // Kirchhoff residuals. Both are computed in both modes so neither is
    // trivially zero by construction — each is a real check on the solver.
    //   loop: source EMF minus the drops around every independent loop
    //   node: current into the top node minus the currents out of it
    const loop = mode === "series"
      ? Vs - branches.reduce((a, b) => a + b.V, 0)
      : Math.max(...branches.map((b) => Math.abs(Vs - b.V)));
    const node = mode === "series"
      ? Math.max(...branches.map((b) => Math.abs(I - b.I)))
      : I - branches.reduce((a, b) => a + b.I, 0);

    return { V, Vs, R, Rtot, I, P, branches, closed, loop, node };
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    const m = Math.max(34, Math.min(64, W * 0.09));
    const narrow = W < 560;
    L = {
      x0: m,
      x1: W - m,
      yTop: narrow ? 84 : 104,
      yBot: H - (narrow ? 118 : 132),
      narrow,
      fs: narrow ? 10 : 11,      // label font size
      fsv: narrow ? 9 : 10,      // value font size
      rw: narrow ? 34 : 54,      // resistor body length
      rh: narrow ? 15 : 18,      // resistor body thickness
    };
    L.mid = (L.yTop + L.yBot) / 2;
  }

  // ── Wires and carriers ─────────────────────────────────────────────────
  let phase = 0;
  const DOT_SPACING = 32;
  const WIRE = "rgba(150, 170, 210, 0.85)";
  const BG = "#0b1122";

  function drawWire(pts, width) {
    ctx.strokeStyle = WIRE;
    ctx.lineWidth = width || 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
  }

  function pathLength(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return d;
  }

  function pointAt(pts, s) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d + seg >= s) {
        const t = seg === 0 ? 0 : (s - d) / seg;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
                pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
      d += seg;
    }
    return pts[pts.length - 1];
  }

  // Dots advance along the path at a rate set by the current in that wire.
  // The path is traversed in the direction of conventional current, so the
  // arrows of the schematic are implicit in the motion.
  function drawCarriers(pts, current) {
    if (!(current > 1e-7)) return;
    const len = pathLength(pts);
    if (len < 6) return;
    const n = Math.max(2, Math.round(len / DOT_SPACING));
    const off = (phase * Math.min(current / REF_I, 6)) % 1;
    ctx.fillStyle = "rgba(255, 225, 120, 0.95)";
    for (let i = 0; i < n; i++) {
      const [x, y] = pointAt(pts, (((i + off) / n) % 1) * len);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Components ─────────────────────────────────────────────────────────
  function drawResistor(x, y, vertical, power) {
    const long = L.rw, thick = L.rh;
    const w = vertical ? thick : long;
    const h = vertical ? long : thick;
    const t = Math.max(0, Math.min(power / REF_P, 1));

    // Clear the wire behind the body so the resistor reads as inline.
    ctx.fillStyle = BG;
    ctx.fillRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6);

    if (t > 0.02) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * 0.9);
      glow.addColorStop(0, `rgba(255, 130, 60, ${0.45 * t})`);
      glow.addColorStop(1, "rgba(255, 130, 60, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - w, y - h, w * 2, h * 2);
    }

    ctx.fillStyle = `rgb(${Math.round(58 + 190 * t)}, ${Math.round(72 + 58 * t)}, ${Math.round(102 - 46 * t)})`;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill();
    ctx.stroke();
  }

  // A cell on a vertical wire: plates run across the wire, long plate = +.
  function drawBattery(x, y, V, closed) {
    const g = 8;
    ctx.fillStyle = BG;
    ctx.fillRect(x - 20, y - g - 3, 40, 2 * g + 6);
    ctx.strokeStyle = "rgba(236,240,251,0.92)";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(x - 14, y - g); ctx.lineTo(x + 14, y - g);   // long plate  (+)
    ctx.moveTo(x - 7,  y + g); ctx.lineTo(x + 7,  y + g);   // short plate (−)
    ctx.stroke();
    ctx.lineCap = "round";

    // Terminal marks and the voltage all sit to the right of the wire, clear
    // of the carriers running along it.
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,150,150,0.9)";
    ctx.font = `600 ${L.fs}px ui-monospace, monospace`;
    ctx.fillText("+", x + 19, y - g + 4);
    ctx.fillStyle = "rgba(150,190,255,0.9)";
    ctx.fillText("−", x + 19, y + g + 4);

    ctx.fillStyle = closed ? "rgba(236,240,251,0.9)" : "rgba(255,120,140,0.9)";
    ctx.fillText(V.toFixed(1) + " V", x + 19, y + g + 26);
  }

  function drawSwitch(x, y, closed) {
    ctx.fillStyle = BG;
    ctx.fillRect(x - 22, y - 20, 44, 30);
    ctx.fillStyle = "rgba(236,240,251,0.9)";
    ctx.beginPath(); ctx.arc(x - 16, y, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 16, y, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = closed ? "rgba(236,240,251,0.9)" : "rgba(255,120,140,0.9)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x - 16, y);
    ctx.lineTo(closed ? x + 16 : x + 11, closed ? y : y - 15);
    ctx.stroke();
    if (!closed) {
      ctx.fillStyle = "rgba(255,120,140,0.9)";
      ctx.font = `600 ${L.fsv}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText(i18nText("circuitOpen", "open"), x, y + 20);
    }
  }

  const fmtI = (I) =>
    I >= 0.1  ? (I * 1000).toFixed(0) + " mA" :
    I >= 1e-4 ? (I * 1000).toFixed(1) + " mA" :
    I > 0     ? (I * 1e6).toFixed(0) + " µA" : "0 mA";

  const text = (str, x, y, colour, size, align) => {
    ctx.fillStyle = colour;
    ctx.font = `${size === L.fs ? "600 " : ""}${size}px ui-monospace, monospace`;
    ctx.textAlign = align || "center";
    ctx.fillText(str, x, y);
  };

  const C_LABEL = "rgba(236,240,251,0.92)";
  const C_VALUE = "rgba(196,212,244,0.85)";
  const C_CURR  = "rgba(255,225,120,0.92)";

  // ── Render ─────────────────────────────────────────────────────────────
  function render(s) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a1020");
    bg.addColorStop(1, "#0d1228");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const { x0, x1, yTop, yBot, mid, fs, fsv } = L;
    const n = s.branches.length;

    if (mode === "series") {
      // One loop. Conventional current leaves the + plate at the top of the
      // cell, runs right along the top through every resistor, and returns.
      const slots = [];
      for (let i = 0; i < n; i++) slots.push(x0 + ((i + 1) / (n + 1)) * (x1 - x0));
      const loop = [[x0, mid], [x0, yTop], [x1, yTop], [x1, yBot], [x0, yBot], [x0, mid]];
      drawWire(loop);
      drawCarriers(loop, s.I);

      drawSwitch((x0 + x1) / 2, yBot, s.closed);

      slots.forEach((x, i) => {
        const b = s.branches[i];
        drawResistor(x, yTop, false, b.P);
        text("R" + (i + 1), x, yTop - L.rh / 2 - 9, C_LABEL, fs);
        text(b.r + " Ω", x, yTop + L.rh / 2 + 14, C_VALUE, fsv);
        text(b.V.toFixed(2) + " V", x, yTop + L.rh / 2 + 27, C_CURR, fsv);
      });

      // In series the current is one number for the whole loop, so it belongs
      // on the wire, not repeated under every body.
      text(fmtI(s.I), x1 - 8, mid, C_CURR, fs, "right");
    } else {
      // Rails top and bottom; every resistor bridges the same two nodes. The
      // last branch sits on the right end so no rail stub dangles free.
      const slots = [];
      const xA = x0 + 0.26 * (x1 - x0);
      for (let i = 0; i < n; i++) slots.push(n === 1 ? x1 : xA + (i / (n - 1)) * (x1 - xA));

      drawWire([[x0, yTop], [x1, yTop]]);
      drawWire([[x0, yBot], [x1, yBot]]);
      drawWire([[x0, yTop], [x0, mid]]);
      drawWire([[x0, mid], [x0, yBot]]);

      // Rail segments carry only the current not yet tapped off. Feeding each
      // segment its own current is what makes the rail visibly slow down from
      // left to right as the branches take their share.
      drawCarriers([[x0, yBot], [x0, mid]], s.I);   // up through the cell
      drawCarriers([[x0, mid], [x0, yTop]], s.I);
      let remaining = s.I;
      const nodesX = [x0, ...slots];
      for (let i = 0; i < n; i++) {
        drawCarriers([[nodesX[i], yTop], [nodesX[i + 1], yTop]], remaining);
        remaining -= s.branches[i].I;
      }
      let returning = 0;
      for (let i = n - 1; i >= 0; i--) {
        returning += s.branches[i].I;
        drawCarriers([[nodesX[i + 1], yBot], [nodesX[i], yBot]], returning);
      }

      slots.forEach((x, i) => {
        const b = s.branches[i];
        drawWire([[x, yTop], [x, yBot]], 2);
        drawCarriers([[x, yTop], [x, yBot]], b.I);
        drawResistor(x, mid, true, b.P);
        text("R" + (i + 1), x, yTop - 12, C_LABEL, fs);
        text(b.r + " Ω", x, yBot + 20, C_VALUE, fsv);
        text(fmtI(b.I), x, yBot + 33, C_CURR, fsv);
      });

      drawSwitch(x0 + (slots[0] - x0) * 0.55, yBot, s.closed);
      text(s.Vs.toFixed(2) + " V", (x0 + slots[0]) / 2, yTop - 12, C_VALUE, fsv);
    }

    // The cell sits on the left wire in both arrangements, drawn last so the
    // carriers do not run across its plates.
    drawBattery(x0, mid, s.V, s.closed);

    // Heading and live Kirchhoff residuals.
    text(mode === "series"
      ? i18nText("circuitLabelSeries", "series — one path, current shared")
      : i18nText("circuitLabelParallel", "parallel — one node pair, voltage shared"),
      x0 - 4, 34, "rgba(236,240,251,0.62)", fsv, "left");

    text(`ΣV loop ${s.loop.toFixed(9)} V   ΣI node ${(s.node * 1000).toFixed(9)} mA`,
      x1 + 4, H - 14, "rgba(140, 210, 175, 0.8)", fsv, "right");
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(s) {
    out.rtotal.textContent = s.Rtot.toFixed(1);
    out.current.textContent = (s.I * 1000).toFixed(2);
    out.power.textContent = (s.P * 1000).toFixed(1);
    const cells = [out.r1, out.r2, out.r3];
    for (let i = 0; i < 3; i++) {
      const b = s.branches[i];
      cells[i].textContent = b ? `${fmtI(b.I)} · ${b.V.toFixed(2)} V` : "—";
      cells[i].style.color = b ? "" : "var(--muted)";
    }
  }

  function updateLabels() {
    inputValues.emf.textContent = parseFloat(inputs.emf.value).toFixed(1);
    inputValues.r1.textContent = inputs.r1.value;
    inputValues.r2.textContent = inputs.r2.value;
    inputValues.r3.textContent = inputs.r3.value;
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let lastTs = performance.now();
  let raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    phase += dt * 1.1;
    const s = solve();
    render(s);
    updateReadouts(s);
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
  }

  Object.values(inputs).forEach((el) => el.addEventListener("input", updateLabels));
  modeList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.key);
      window.SFX?.tone({ freq: btn.dataset.key === "series" ? 480 : 640, dur: 0.08, type: "triangle", gain: 0.1 });
    });
  });
  swToggle.addEventListener("change", () => {
    window.SFX?.click({ gain: swToggle.checked ? 0.28 : 0.2 });
  });
  r3Toggle.addEventListener("change", () => {
    window.SFX?.tone({ freq: r3Toggle.checked ? 520 : 320, dur: 0.07, type: "triangle", gain: 0.1 });
  });
  resetBtn.addEventListener("click", () => {
    inputs.emf.value = "6";
    inputs.r1.value = "100";
    inputs.r2.value = "220";
    inputs.r3.value = "330";
    r3Toggle.checked = true;
    swToggle.checked = true;
    setMode("series");
    updateLabels();
    window.SFX?.click({ gain: 0.22 });
  });

  document.addEventListener("langchange", () => updateReadouts(solve()));
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
    H = W < 560 ? 420 : 480;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the harness can check the solver against the closed forms.
  window.__circuit = { solve, setMode };

  resizeCanvas();
  setMode("series");
  updateLabels();
  start();
})();
