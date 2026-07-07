/*
 * Acid–base titration — NaOH into a strong (HCl) or weak (acetic) acid.
 *
 * The pH is not pieced together from textbook regimes. One exact charge
 * balance covers every point of the curve:
 *
 *   [H⁺] + [Na⁺] = [OH⁻] + [A⁻]
 *   [A⁻]  = Cₐᵗ·Ka / (Ka + [H⁺])        (acid dissociation, mass balance)
 *   [OH⁻] = Kw / [H⁺]
 *
 * where Cₐᵗ and [Na⁺] are the *diluted* analytical concentrations at the
 * current total volume. f([H⁺]) is strictly increasing, so a bisection on
 * log₁₀[H⁺] ∈ [−14, 1] nails the root to machine-visible precision in 60
 * halvings. A strong acid is just Ka → large (fully dissociated); the same
 * solver then reproduces the buffer plateau, half-equivalence pH = pKa,
 * the sharp equivalence jump, and the hydrolysed (>7) equivalence point
 * of the weak acid — none of it special-cased.
 *
 * Left of the canvas: burette + Erlenmeyer flask with phenolphthalein
 * (colourless below pH 8.2 → pink by 10). Right: live pH–V curve over a
 * faint full-curve preview. Dragging on the graph scrubs the titration.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  // Logical (CSS-pixel) coordinates; backing store scaled by dpr.
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    acidConc: document.getElementById("acid-conc"),
    acidVol:  document.getElementById("acid-vol"),
    baseConc: document.getElementById("base-conc"),
    rate:     document.getElementById("rate"),
  };
  const inputValues = {
    acidConc: document.getElementById("acid-conc-value"),
    acidVol:  document.getElementById("acid-vol-value"),
    baseConc: document.getElementById("base-conc-value"),
    rate:     document.getElementById("rate-value"),
  };
  const out = {
    ph:     document.getElementById("out-ph"),
    vb:     document.getElementById("out-vb"),
    veq:    document.getElementById("out-veq"),
    h:      document.getElementById("out-h"),
    pct:    document.getElementById("out-pct"),
    region: document.getElementById("out-region"),
  };
  const startBtn = document.getElementById("start-btn");
  const resetBtn = document.getElementById("reset-btn");
  const acidList = document.getElementById("acid-list");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Chemistry ──────────────────────────────────────────────────────────
  const KW = 1e-14;
  const VMAX = 50;                        // burette capacity, mL
  const ACIDS = {
    hcl:    { Ka: 1e3,    formula: "HCl" },        // strong: effectively ∞
    acetic: { Ka: 1.8e-5, formula: "CH₃COOH" },
  };
  let acidKey = "hcl";

  /**
   * Exact pH from the charge balance, via bisection on log10[H+].
   * caT / naT are the diluted analytical concentrations (mol/L).
   */
  function solvePH(caT, naT, Ka) {
    const f = (h) => h + naT - KW / h - (caT * Ka) / (Ka + h);
    let lo = -14, hi = 1;                 // f(1e-14) < 0 < f(10) for our ranges
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (f(Math.pow(10, mid)) > 0) hi = mid; else lo = mid;
    }
    return -(lo + hi) / 2;
  }

  function readParams() {
    return {
      Ca: parseFloat(inputs.acidConc.value),
      Va: parseFloat(inputs.acidVol.value),
      Cb: parseFloat(inputs.baseConc.value),
      rate: parseFloat(inputs.rate.value),
      Ka: ACIDS[acidKey].Ka,
    };
  }

  function phAt(vb, p) {
    const vt = p.Va + vb;
    return solvePH((p.Ca * p.Va) / vt, (p.Cb * vb) / vt, p.Ka);
  }

  // Full-curve preview, cached until a parameter changes.
  const CURVE_N = 220;
  let curve = [];
  let curveDirty = true;
  function ensureCurve(p) {
    if (!curveDirty) return;
    curve = [];
    for (let i = 0; i <= CURVE_N; i++) {
      const vb = (VMAX * i) / CURVE_N;
      curve.push(phAt(vb, p));
    }
    curveDirty = false;
  }

  // ── State ──────────────────────────────────────────────────────────────
  let vb = 0;                             // titrant added, mL
  let running = false;
  let lastTs = performance.now();
  let raf = 0;
  let stirAngle = 0;
  const drops = [];                       // { y } falling titrant drops
  let dropTimer = 0;

  // ── Layout (logical px) ────────────────────────────────────────────────
  // Apparatus occupies a fixed left strip; the graph flexes to the right.
  const APP = { cx: 128, buretteTop: 26, buretteBot: 236, buretteW: 20,
                tipY: 262, flaskTop: 292, flaskBot: 466, flaskHalf: 62, neckHalf: 15 };
  const graphRect = () => ({ x0: 288, y0: 34, x1: W - 24, y1: H - 52 });

  const vToX = (v, g) => g.x0 + ((g.x1 - g.x0) * v) / VMAX;
  const phToY = (ph, g) => g.y1 - ((g.y1 - g.y0) * ph) / 14;

  // ── Drawing ────────────────────────────────────────────────────────────
  function drawBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#120a1e");
    bg.addColorStop(1, "#1a0f28");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBurette(p) {
    const { cx, buretteTop: t, buretteBot: b, buretteW: w } = APP;
    const level = t + ((b - t) * vb) / VMAX;       // liquid surface sinks as vb grows

    // Titrant column (below the surface line, down to the stopcock)
    ctx.fillStyle = "rgba(140, 183, 255, 0.55)";
    ctx.fillRect(cx - w / 2 + 1.5, level, w - 3, b - level);

    // Glass
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(cx - w / 2, t, w, b - t);

    // Graduations every 10 mL (labels every 10)
    ctx.fillStyle = "rgba(236, 240, 251, 0.55)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    for (let m = 0; m <= VMAX; m += 10) {
      const y = t + ((b - t) * m) / VMAX;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.beginPath(); ctx.moveTo(cx + w / 2, y); ctx.lineTo(cx + w / 2 + 6, y); ctx.stroke();
      ctx.fillText(String(m), cx + w / 2 + 9, y + 3);
    }

    // Stopcock + tip
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, b); ctx.lineTo(cx - 2, APP.tipY);
    ctx.moveTo(cx + w / 2, b); ctx.lineTo(cx + 2, APP.tipY);
    ctx.stroke();
    ctx.fillStyle = running ? "rgba(140, 183, 255, 0.9)" : "rgba(255, 255, 255, 0.35)";
    ctx.fillRect(cx - 7, b + 6, 14, 5);

    // Label
    ctx.fillStyle = "rgba(236, 240, 251, 0.85)";
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`NaOH ${p.Cb.toFixed(2)} M`, cx, t - 9);
    ctx.textAlign = "left";

    // Falling drops
    ctx.fillStyle = "rgba(140, 183, 255, 0.9)";
    for (const d of drops) {
      ctx.beginPath();
      ctx.ellipse(cx, d.y, 2.6, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function flaskPath() {
    const { cx, flaskTop: t, flaskBot: b, flaskHalf: hw, neckHalf: nh } = APP;
    const shoulder = t + 44;
    ctx.beginPath();
    ctx.moveTo(cx - nh, t);
    ctx.lineTo(cx + nh, t);
    ctx.lineTo(cx + nh, shoulder);
    ctx.lineTo(cx + hw, b - 10);
    ctx.quadraticCurveTo(cx + hw, b, cx + hw - 12, b);
    ctx.lineTo(cx - hw + 12, b);
    ctx.quadraticCurveTo(cx - hw, b, cx - hw, b - 10);
    ctx.lineTo(cx - nh, shoulder);
    ctx.closePath();
  }

  function drawFlask(p, ph) {
    const { cx, flaskBot: b } = APP;
    const vTot = p.Va + vb;                                  // 10..90 mL
    const liquidY = b - 16 - (vTot / 90) * 92;

    // Liquid, clipped to the flask interior. Phenolphthalein: colourless
    // below 8.2 → pink by 10 (drawn over a faint water tint).
    ctx.save();
    flaskPath();
    ctx.clip();
    ctx.fillStyle = "rgba(150, 185, 235, 0.20)";
    ctx.fillRect(cx - 70, liquidY, 140, b - liquidY);
    const pink = Math.min(Math.max((ph - 8.2) / 1.8, 0), 1);
    if (pink > 0) {
      ctx.fillStyle = `rgba(242, 92, 190, ${0.62 * pink})`;
      ctx.fillRect(cx - 70, liquidY, 140, b - liquidY);
    }
    // Surface line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.30)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 70, liquidY); ctx.lineTo(cx + 70, liquidY); ctx.stroke();

    // Magnetic stir bar
    ctx.save();
    ctx.translate(cx, b - 9);
    ctx.scale(Math.abs(Math.cos(stirAngle)) * 0.85 + 0.15, 1);
    ctx.fillStyle = "rgba(236, 240, 251, 0.75)";
    ctx.beginPath();
    ctx.roundRect(-16, -3.5, 32, 7, 3.5);
    ctx.fill();
    ctx.restore();
    ctx.restore();

    // Glass outline
    flaskPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Label
    ctx.fillStyle = "rgba(236, 240, 251, 0.85)";
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${ACIDS[acidKey].formula} ${p.Ca.toFixed(2)} M · ${p.Va} mL`, cx, b + 22);
    ctx.textAlign = "left";
  }

  function drawGraph(p, phNow) {
    const g = graphRect();

    // Frame + grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    for (let ph = 0; ph <= 14; ph += 2) {
      const y = phToY(ph, g);
      ctx.beginPath(); ctx.moveTo(g.x0, y); ctx.lineTo(g.x1, y); ctx.stroke();
      ctx.fillStyle = "rgba(236, 240, 251, 0.5)";
      ctx.textAlign = "right";
      ctx.fillText(String(ph), g.x0 - 6, y + 3);
    }
    for (let v = 0; v <= VMAX; v += 10) {
      const x = vToX(v, g);
      ctx.beginPath(); ctx.moveTo(x, g.y0); ctx.lineTo(x, g.y1); ctx.stroke();
      ctx.fillStyle = "rgba(236, 240, 251, 0.5)";
      ctx.textAlign = "center";
      ctx.fillText(String(v), x, g.y1 + 14);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(236, 240, 251, 0.6)";
    ctx.fillText("pH", g.x0 - 20, g.y0 - 8);
    ctx.fillText("V (mL)", g.x1 - 38, g.y1 + 28);

    // Phenolphthalein transition band (pH 8.2–10)
    ctx.fillStyle = "rgba(242, 92, 190, 0.07)";
    ctx.fillRect(g.x0, phToY(10, g), g.x1 - g.x0, phToY(8.2, g) - phToY(10, g));

    // pH 7 reference
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(g.x0, phToY(7, g)); ctx.lineTo(g.x1, phToY(7, g)); ctx.stroke();

    // Equivalence volume marker
    const veq = (p.Ca * p.Va) / p.Cb;
    if (veq <= VMAX) {
      const x = vToX(veq, g);
      ctx.strokeStyle = "rgba(255, 184, 107, 0.5)";
      ctx.beginPath(); ctx.moveTo(x, g.y0); ctx.lineTo(x, g.y1); ctx.stroke();
      ctx.fillStyle = "rgba(255, 184, 107, 0.85)";
      ctx.textAlign = "center";
      ctx.fillText("V_eq", x, g.y0 - 6);
      ctx.textAlign = "left";
    }
    ctx.setLineDash([]);

    // Faint full-curve preview
    ensureCurve(p);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= CURVE_N; i++) {
      const x = vToX((VMAX * i) / CURVE_N, g);
      const y = phToY(curve[i], g);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Bright trace up to the current volume
    const upto = Math.floor((vb / VMAX) * CURVE_N);
    ctx.strokeStyle = "rgba(196, 123, 255, 0.95)";
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= upto; i++) {
      const x = vToX((VMAX * i) / CURVE_N, g);
      const y = phToY(curve[i], g);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    if (upto >= 0) ctx.lineTo(vToX(vb, g), phToY(phNow, g));
    ctx.stroke();

    // Current point
    ctx.fillStyle = "#f2f5ff";
    ctx.beginPath();
    ctx.arc(vToX(vb, g), phToY(phNow, g), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function superscript(n) {
    const SUP = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
                  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
    return String(n).split("").map((c) => SUP[c] || c).join("");
  }

  function regionLabel(p, veq) {
    const tol = Math.max(0.25, veq * 0.01);
    if (Math.abs(vb - veq) <= tol) return i18nText("regionEquiv", "Equivalence point");
    if (vb < veq) {
      return acidKey === "acetic"
        ? i18nText("regionBuffer", "Buffer region")
        : i18nText("regionAcidExcess", "Excess acid");
    }
    return i18nText("regionBaseExcess", "Excess base");
  }

  function updateReadouts(p, phNow) {
    const veq = (p.Ca * p.Va) / p.Cb;
    const h = Math.pow(10, -phNow);
    const exp = Math.floor(Math.log10(h));
    const mant = h / Math.pow(10, exp);
    out.ph.textContent = phNow.toFixed(2);
    out.vb.textContent = vb.toFixed(1);
    out.veq.textContent = Math.min(veq, 999).toFixed(1);
    out.h.textContent = `${mant.toFixed(1)}×10${superscript(exp)} M`;
    out.pct.textContent = String(Math.round((vb / veq) * 100));
    out.region.textContent = regionLabel(p, veq);
  }

  function updateLabels(p) {
    inputValues.acidConc.textContent = p.Ca.toFixed(2);
    inputValues.acidVol.textContent = String(p.Va);
    inputValues.baseConc.textContent = p.Cb.toFixed(2);
    inputValues.rate.textContent = p.rate.toFixed(1);
  }

  function syncStartBtn() {
    startBtn.textContent = running
      ? i18nText("wavePauseBtn", "Pause")
      : i18nText("startBtn", "Start");
  }

  // ── Step / loop ────────────────────────────────────────────────────────
  function step(dt, p) {
    if (running) {
      vb = Math.min(vb + p.rate * dt, VMAX);
      if (vb >= VMAX) { running = false; syncStartBtn(); }
      dropTimer -= dt;
      if (dropTimer <= 0) {
        drops.push({ y: APP.tipY + 4 });
        dropTimer = 0.22 / Math.max(p.rate, 0.2);
      }
    }
    stirAngle += dt * (running ? 9 : 3);
    for (let i = drops.length - 1; i >= 0; i--) {
      drops[i].y += 330 * dt;
      if (drops[i].y > APP.flaskBot - 40) drops.splice(i, 1);
    }
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    const p = readParams();
    step(dt, p);
    const phNow = phAt(vb, p);
    drawBackground();
    drawBurette(p);
    drawFlask(p, phNow);
    drawGraph(p, phNow);
    updateReadouts(p, phNow);
  }

  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Graph scrubbing ────────────────────────────────────────────────────
  let scrubbing = false;
  function scrubTo(clientX) {
    const rect = stage.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    const g = graphRect();
    vb = Math.min(Math.max(((x - g.x0) / (g.x1 - g.x0)) * VMAX, 0), VMAX);
  }
  stage.addEventListener("pointerdown", (e) => {
    const rect = stage.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    if (x < graphRect().x0 - 20) return;      // apparatus side: ignore
    scrubbing = true;
    running = false;
    syncStartBtn();
    stage.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  });
  stage.addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e.clientX); });
  const endScrub = () => { scrubbing = false; };
  stage.addEventListener("pointerup", endScrub);
  stage.addEventListener("pointercancel", endScrub);

  // ── Wiring ─────────────────────────────────────────────────────────────
  acidList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      acidKey = btn.dataset.key;
      acidList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b === btn));
      curveDirty = true;
    });
  });

  Object.values(inputs).forEach((el) =>
    el.addEventListener("input", () => {
      curveDirty = true;
      updateLabels(readParams());
    }));

  startBtn.addEventListener("click", () => {
    if (!running && vb >= VMAX) vb = 0;       // restart a finished run
    running = !running;
    syncStartBtn();
  });

  resetBtn.addEventListener("click", () => {
    vb = 0;
    running = false;
    drops.length = 0;
    syncStartBtn();
  });

  document.addEventListener("langchange", syncStartBtn);

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
  syncStartBtn();
  start();
})();
