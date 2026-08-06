/*
 * Refraction — Snell's law measured out of a Huygens construction.
 *
 * Nothing in this file evaluates asin((n₁/n₂)·sinθ₁). The construction is
 * given two facts and no law:
 *
 *   1. light travels at v = c/n in each medium;
 *   2. the incoming plane wavefront sweeps along the interface, striking the
 *      point x at time t(x) = x·sinθ₁ / v₁.
 *
 * Every point struck starts a Huygens wavelet spreading into medium 2 at v₂,
 * so by the observation time wavelet k has grown to r_k = v₂·(T − t_k). The
 * refracted wavefront is the one straight line tangent to all of them, and its
 * angle is *found* — a golden-section search for the angle at which a single
 * line can touch every wavelet at once. θ₂ is the answer to that search.
 *
 * Snell's law is then a measurement: the page reads n₁·sinθ₁ and n₂·sinθ₂ off
 * two independently obtained angles and shows that they agree.
 *
 * Total internal reflection is not a special case bolted on. Past the critical
 * angle the wavelets outrun the sweep, no common tangent exists, and the search
 * closes on nothing — the leftover disagreement is what the page reports. The
 * critical angle itself is measured by bisecting on "does the envelope still
 * close?", never by asin(n₂/n₁).
 *
 * The one thing still taken from a formula is brightness: the reflected and
 * transmitted fractions are the Fresnel result for unpolarised light, which
 * comes from matching fields at the boundary rather than from the geometry
 * built here. It is evaluated at the *measured* θ₂.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    angle: document.getElementById("angle"),
    n1:    document.getElementById("n1"),
    n2:    document.getElementById("n2"),
  };
  const huygensBox = document.getElementById("huygens");
  const inputValues = {
    angle: document.getElementById("angle-value"),
    n1:    document.getElementById("n1-value"),
    n2:    document.getElementById("n2-value"),
  };
  const out = {
    theta2:   document.getElementById("out-theta2"),
    critical: document.getElementById("out-critical"),
    snell:    document.getElementById("out-snell"),
    reflect:  document.getElementById("out-reflect"),
    transmit: document.getElementById("out-transmit"),
    regime:   document.getElementById("out-regime"),
    speed:    document.getElementById("out-speed"),
  };
  const presetList = document.getElementById("preset-list");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const C_LIGHT = 299792458;   // m/s — the only speed put in by hand

  const PRESETS = {
    airWater:  { n1: 1.00, n2: 1.33 },
    airGlass:  { n1: 1.00, n2: 1.52 },
    waterAir:  { n1: 1.33, n2: 1.00 },
    glassAir:  { n1: 1.52, n2: 1.00 },
    diamond:   { n1: 2.42, n2: 1.00 },
  };

  // ── The Huygens construction ───────────────────────────────────────────
  const APERTURE = 1;      // metres of interface swept — the scale cancels out
  const WAVELETS = 24;     // how many wavelets are grown across it
  const LEAD = 0.35;       // extra growth, so the wavelets are real at θ₁ = 0
  const CLOSES = 1e-6;     // a tangent line that misses by less than this closes

  /*
   * Where each wavelet sits on the interface and how far it has spread into
   * medium 2 by the observation time. The sweep rate is the only place θ₁
   * enters, and v₂ the only place n₂ does.
   */
  function wavelets(n1, n2, theta1, count = WAVELETS, lead = LEAD) {
    const v1 = C_LIGHT / n1, v2 = C_LIGHT / n2;
    const sweep = Math.sin(theta1) / v1;                    // s per metre of x
    const Tobs = APERTURE * sweep + (lead * APERTURE) / v2;
    const xs = [], rs = [];
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * APERTURE;
      xs.push(x);
      rs.push(v2 * (Tobs - x * sweep));
    }
    return { xs, rs };
  }

  /*
   * A candidate refracted wavefront is a straight line whose unit normal leans
   * θ from the interface normal. It grazes wavelet k only if its offset is
   * d = x_k·sinθ + r_k, so a single line can touch them all only when every one
   * of those demands agrees. Search for the angle that makes them agree; what
   * is left over is how badly the envelope fails to exist.
   */
  function envelope(xs, rs) {
    const spread = (th) => {
      const s = Math.sin(th);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < xs.length; i++) {
        const f = xs[i] * s + rs[i];
        if (f < lo) lo = f;
        if (f > hi) hi = f;
      }
      return hi - lo;
    };
    const G = (Math.sqrt(5) - 1) / 2;
    let a = 0, b = Math.PI / 2;
    let c = b - G * (b - a), d = a + G * (b - a);
    let fc = spread(c), fd = spread(d);
    for (let i = 0; i < 120; i++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - G * (b - a); fc = spread(c); }
      else { a = c; c = d; fc = fd; d = a + G * (b - a); fd = spread(d); }
    }
    const theta2 = (a + b) / 2;
    const residual = spread(theta2) / APERTURE;
    // The tangent's offset, needed to draw the wavefront where it belongs.
    const offset = xs.reduce((acc, x, i) => acc + x * Math.sin(theta2) + rs[i], 0) / xs.length;
    return { theta2, residual, closes: residual < CLOSES, offset };
  }

  /*
   * The critical angle, asked for rather than looked up: walk the incidence
   * angle up until the envelope stops closing, then bisect on the boundary.
   */
  function criticalMeasured(n1, n2) {
    const closes = (deg) => {
      const w = wavelets(n1, n2, (deg * Math.PI) / 180);
      return envelope(w.xs, w.rs).closes;
    };
    if (closes(89.999)) return null;         // the envelope never fails: no TIR
    let lo = 0, hi = 89.999;
    for (let i = 0; i < 44; i++) {
      const mid = (lo + hi) / 2;
      if (closes(mid)) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /*
   * Fermat's principle, kept as a second, independent route to the same law:
   * the path from A to B that takes the least time. Used by the tests to check
   * that least-time and the wavelet envelope pick out the same geometry.
   */
  function fermat(n1, n2, ax, ay, bx, by) {
    const time = (x) => n1 * Math.hypot(x - ax, ay) + n2 * Math.hypot(bx - x, by);
    const G = (Math.sqrt(5) - 1) / 2;
    let a = Math.min(ax, bx) - 10, b = Math.max(ax, bx) + 10;
    let c = b - G * (b - a), d = a + G * (b - a);
    let fc = time(c), fd = time(d);
    for (let i = 0; i < 200; i++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - G * (b - a); fc = time(c); }
      else { a = c; c = d; fc = fd; d = a + G * (b - a); fd = time(d); }
    }
    const x = (a + b) / 2;
    return {
      x,
      theta1: Math.atan2(Math.abs(x - ax), ay),
      theta2: Math.atan2(Math.abs(bx - x), by),
      time: time(x) / C_LIGHT,
    };
  }

  // Fresnel reflectance for unpolarised light, at the measured θ₂.
  function fresnelR(n1, n2, theta1, theta2, tir) {
    if (tir) return 1;
    const c1 = Math.cos(theta1), c2 = Math.cos(theta2);
    const rs = (n1 * c1 - n2 * c2) / (n1 * c1 + n2 * c2);
    const rp = (n1 * c2 - n2 * c1) / (n1 * c2 + n2 * c1);
    return Math.min(1, (rs * rs + rp * rp) / 2);
  }

  /** Everything the page knows, measured off the construction. */
  function measure(n1, n2, theta1) {
    const w = wavelets(n1, n2, theta1);
    const e = envelope(w.xs, w.rs);
    const tir = !e.closes;
    const R = fresnelR(n1, n2, theta1, tir ? 0 : e.theta2, tir);
    return {
      theta2: tir ? null : e.theta2,
      residual: e.residual,
      tir,
      R,
      snell1: n1 * Math.sin(theta1),
      snell2: tir ? null : n2 * Math.sin(e.theta2),
      xs: w.xs, rs: w.rs, offset: e.offset,
    };
  }

  function readParams() {
    return {
      theta1: (parseFloat(inputs.angle.value) * Math.PI) / 180,
      n1: parseFloat(inputs.n1.value),
      n2: parseFloat(inputs.n2.value),
      huygens: huygensBox.checked,
    };
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  const originX = () => W / 2;
  const originY = () => H / 2;

  function drawBackground(p) {
    const ox = originX(), oy = originY();
    const tint = (n) => `rgba(90, 140, 220, ${0.05 + Math.min((n - 1) * 0.10, 0.28)})`;
    ctx.fillStyle = "#0a1024";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = tint(p.n1);
    ctx.fillRect(0, 0, W, oy);
    ctx.fillStyle = tint(p.n2);
    ctx.fillRect(0, oy, W, H - oy);

    ctx.strokeStyle = "rgba(236, 240, 251, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();

    ctx.strokeStyle = "rgba(236, 240, 251, 0.35)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(ox, 24); ctx.lineTo(ox, H - 24); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(236, 240, 251, 0.8)";
    ctx.font = "600 13px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`n₁ = ${p.n1.toFixed(2)}`, 14, 22);
    ctx.fillText(`n₂ = ${p.n2.toFixed(2)}`, 14, H - 14);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(236, 240, 251, 0.4)";
    ctx.fillText(i18nText("refractionNormal", "normal"), ox - 8, 34);
  }

  /*
   * The construction itself, drawn: the wavelets spreading from the stretch of
   * interface the wavefront has already swept, and the line they are all
   * tangent to. When no such line exists the wavelets are drawn alone, which is
   * the whole of what total internal reflection looks like from here.
   */
  function drawHuygens(p, m) {
    const ox = originX(), oy = originY();
    const span = Math.min(W * 0.34, 230);         // pixels the aperture covers
    const px = (x) => ox - span / 2 + x * span;   // metres of x → pixels
    const scale = span / APERTURE;

    ctx.save();
    // Clip the wavelets to medium 2 — they only spread forward.
    ctx.beginPath();
    ctx.rect(0, oy, W, H - oy);
    ctx.clip();
    ctx.lineWidth = 1;
    for (let i = 0; i < m.xs.length; i++) {
      const r = m.rs[i] * scale;
      if (r <= 0.5) continue;
      ctx.strokeStyle = m.tir ? "rgba(255,107,138,0.30)" : "rgba(122,217,238,0.30)";
      ctx.beginPath();
      ctx.arc(px(m.xs[i]), oy, r, 0, Math.PI);
      ctx.stroke();
    }
    ctx.restore();

    // The stretch of interface already struck, and the wavelet sources on it.
    ctx.save();
    ctx.strokeStyle = "rgba(255,210,122,0.85)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px(0), oy); ctx.lineTo(px(APERTURE), oy);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,210,122,0.9)";
    for (let i = 0; i < m.xs.length; i += 3) {
      ctx.beginPath(); ctx.arc(px(m.xs[i]), oy, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // The common tangent — the refracted wavefront. Only if one exists.
    if (!m.tir) {
      const s = Math.sin(m.theta2), c = Math.cos(m.theta2);
      // Points p with (s, c)·p = offset, in metres, drawn across the aperture.
      const L = Math.min(W, H) * 0.45;
      const cx = px(m.offset * s), cy = oy + m.offset * c * scale;
      ctx.save();
      ctx.strokeStyle = "rgba(140, 255, 210, 0.95)";
      ctx.lineWidth = 2.2;
      ctx.setLineDash([9, 5]);
      ctx.beginPath();
      ctx.moveTo(cx - c * L, cy + s * L);
      ctx.lineTo(cx + c * L, cy - s * L);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // dashDir: +1 → dashes travel from the far end toward the origin (incoming
  // light), −1 → outward from the origin, 0 → no animation.
  function ray(ox, oy, angleFromNormalUp, len, color, width, alpha, dashDir, phase) {
    const ex = ox + Math.sin(angleFromNormalUp) * len;
    const ey = oy - Math.cos(angleFromNormalUp) * len;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha * 0.45;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (dashDir) {
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = 9;
      ctx.setLineDash([13, 11]);
      ctx.lineDashOffset = dashDir * phase * 85;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    const back = angleFromNormalUp;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.sin(back - 0.4) * 12, ey + Math.cos(back - 0.4) * 12);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.sin(back + 0.4) * 12, ey + Math.cos(back + 0.4) * 12);
    ctx.stroke();
    ctx.restore();
  }

  function arc(ox, oy, a0, a1, r, color, label) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(ox, oy, r, a0, a1);
    ctx.stroke();
    if (label) {
      const mid = (a0 + a1) / 2;
      ctx.fillStyle = color;
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, ox + Math.cos(mid) * (r + 14), oy + Math.sin(mid) * (r + 14));
    }
    ctx.restore();
  }

  function render(p, m, phase) {
    drawBackground(p);
    const ox = originX(), oy = originY();
    const L = Math.min(W, H) * 0.42;

    if (p.huygens) drawHuygens(p, m);

    ray(ox, oy, -p.theta1, L, "#ffd27a", 3, 1, +1, phase);
    const rAlpha = 0.35 + 0.6 * m.R;
    ray(ox, oy, p.theta1, L * 0.85, "#ff9f6b", 2.4, rAlpha, -1, phase);

    if (!m.tir) {
      const tAlpha = 0.35 + 0.6 * (1 - m.R);
      const ex = ox + Math.sin(m.theta2) * L;
      const ey = oy + Math.cos(m.theta2) * L;
      ctx.save();
      ctx.strokeStyle = "#7ad9ee";
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      ctx.globalAlpha = tAlpha * 0.45;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.globalAlpha = tAlpha;
      ctx.shadowColor = "#7ad9ee";
      ctx.shadowBlur = 9;
      ctx.setLineDash([13, 11]);
      ctx.lineDashOffset = -phase * 85;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      const fwd = m.theta2;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.sin(fwd - 0.4) * 12, ey - Math.cos(fwd - 0.4) * 12);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.sin(fwd + 0.4) * 12, ey - Math.cos(fwd + 0.4) * 12);
      ctx.stroke();
      ctx.restore();
    }

    arc(ox, oy, -Math.PI / 2 - p.theta1, -Math.PI / 2, 46, "rgba(255,210,122,0.9)", "θ₁");
    if (!m.tir) {
      arc(ox, oy, Math.PI / 2, Math.PI / 2 + m.theta2, 46, "rgba(122,217,238,0.9)", "θ₂");
    }

    ctx.fillStyle = "#f2f5ff";
    ctx.beginPath(); ctx.arc(ox, oy, 4, 0, Math.PI * 2); ctx.fill();

    if (m.tir) {
      ctx.fillStyle = "rgba(255, 107, 138, 0.95)";
      ctx.font = "700 15px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(i18nText("refractionTIR", "Total internal reflection"), ox, oy - 12 - L);
    }
  }

  function updateReadouts(p, m) {
    const deg = (r) => ((r * 180) / Math.PI).toFixed(1) + "°";
    out.theta2.textContent = m.tir ? "—" : deg(m.theta2);
    const tc = criticalMeasured(p.n1, p.n2);
    out.critical.textContent = tc === null ? "—" : tc.toFixed(1) + "°";
    // Both sides measured: the left from the ray you set, the right from the
    // angle the wavelets settled on.
    out.snell.textContent = m.tir
      ? "—"
      : `${m.snell1.toFixed(3)} = ${m.snell2.toFixed(3)}`;
    out.reflect.textContent = (m.R * 100).toFixed(1) + "%";
    out.transmit.textContent = ((1 - m.R) * 100).toFixed(1) + "%";
    out.regime.textContent = m.tir
      ? i18nText("refractionRegimeTIR", "TIR")
      : (p.n2 > p.n1 ? i18nText("refractionRegimeInto", "Bending toward normal")
                     : i18nText("refractionRegimeOut", "Bending away from normal"));
    out.speed.textContent = (C_LIGHT / p.n2 / 1e8).toFixed(2) + "×10⁸ m/s";
  }

  function updateLabels(p) {
    inputValues.angle.textContent = String(Math.round((p.theta1 * 180) / Math.PI));
    inputValues.n1.textContent = p.n1.toFixed(2);
    inputValues.n2.textContent = p.n2.toFixed(2);
  }

  let raf = 0;
  let running = true;
  let frozenPhase = 0;
  let prevTir = false;
  // The travelling dashes are the only motion here, and this loop reads the
  // clock directly rather than taking the frame timestamp, so reduced-motion
  // has to be honoured explicitly. When the page is stopped the phase is held
  // too, so a redraw with nothing changed produces an identical frame.
  const phaseNow = () => (window.ReducedMotion ? window.ReducedMotion.clock()
                                               : performance.now() / 1000);
  function draw() {
    const p = readParams();
    const m = measure(p.n1, p.n2, p.theta1);
    if (m.tir && !prevTir) {
      window.SFX?.tone({ freq: 1320, dur: 0.16, type: "sine", gain: 0.16, release: 0.22 });
      window.SFX?.tone({ freq: 1980, dur: 0.12, type: "sine", gain: 0.08, release: 0.18 });
    }
    prevTir = m.tir;
    render(p, m, running ? phaseNow() : frozenPhase);
    updateReadouts(p, m);
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    draw();
  }
  function start() {
    cancelAnimationFrame(raf);
    if (running) raf = requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  // ── Drag the incident ray angle ────────────────────────────────────────
  let dragging = false;
  function angleFromPointer(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W - originX();
    const y = ((clientY - rect.top) / rect.height) * H - originY();
    const ang = Math.atan2(x, -y);          // 0 = straight up
    return Math.max(0, Math.min(89, (Math.abs(ang) * 180) / Math.PI));
  }
  stage.addEventListener("pointerdown", (e) => {
    dragging = true;
    stage.setPointerCapture(e.pointerId);
    inputs.angle.value = String(Math.round(angleFromPointer(e.clientX, e.clientY)));
    updateLabels(readParams());
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    inputs.angle.value = String(Math.round(angleFromPointer(e.clientX, e.clientY)));
    updateLabels(readParams());
  });
  const endDrag = () => { dragging = false; };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // ── Wiring ─────────────────────────────────────────────────────────────
  // Manually moving an index slider means the media no longer match any
  // preset — clear the stale highlight.
  const clearPresetActive = () =>
    presetList.querySelectorAll(".mol-btn").forEach((b) => b.classList.remove("active"));
  Object.values(inputs).forEach((el) =>
    el.addEventListener("input", () => {
      if (el !== inputs.angle) clearPresetActive();
      updateLabels(readParams());
      if (!running) draw();
    }));
  huygensBox.addEventListener("change", () => { if (!running) draw(); });

  presetList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pre = PRESETS[btn.dataset.key];
      if (!pre) return;
      inputs.n1.value = String(pre.n1);
      inputs.n2.value = String(pre.n2);
      window.SFX?.tone({ freq: 660, dur: 0.09, type: "triangle", gain: 0.12 });
      presetList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b === btn));
      updateLabels(readParams());
      if (!running) draw();
    });
  });

  resetBtn.addEventListener("click", () => {
    inputs.angle.value = "35";
    inputs.n1.value = "1.00";
    inputs.n2.value = "1.52";
    huygensBox.checked = true;
    presetList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b.dataset.key === "airGlass"));
    updateLabels(readParams());
    if (!running) draw();
  });

  document.addEventListener("langchange", draw);

  function resizeCanvas() {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 320);
    H = 460;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);

  // Headless access to the construction, so the checks can drive it directly.
  window.__refr = {
    wavelets, envelope, measure, criticalMeasured, fermat, fresnelR,
    params: () => {
      const p = readParams();
      return { theta1Deg: (p.theta1 * 180) / Math.PI, n1: p.n1, n2: p.n2, huygens: p.huygens };
    },
    read: () => {
      const p = readParams();
      return measure(p.n1, p.n2, p.theta1);
    },
    setRunning: (on) => {
      if (!on && running) frozenPhase = phaseNow();
      running = on;
      if (on) start(); else { cancelAnimationFrame(raf); draw(); }
    },
    APERTURE, WAVELETS, CLOSES, C_LIGHT,
  };

  resizeCanvas();
  updateLabels(readParams());
  start();
})();
