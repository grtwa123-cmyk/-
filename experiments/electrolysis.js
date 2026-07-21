/*
 * Electrolysis of water — Faraday's laws made visible.
 *
 *   overall   2 H₂O → 2 H₂ + O₂
 *   cathode(−)  2 H₂O + 2 e⁻ → H₂ + 2 OH⁻
 *   anode(+)    2 H₂O → O₂ + 4 H⁺ + 4 e⁻
 *
 * Everything quantitative flows from the charge: Q = ∫I dt, moles of
 * electrons n_e = Q/F, and the stoichiometry above gives
 *   n(H₂) = Q / 2F      n(O₂) = Q / 4F
 * so the collected volume ratio is exactly 2 : 1 — the sim's gas columns
 * are drawn from those formulas, never faked.
 *
 * The cell only runs above the thermodynamic decomposition voltage
 * (E° = 1.23 V at 25 °C); below it the current is zero. Above it we use
 * a simple linear I = g·(V − 1.23) — a fine model for a resistive cell.
 * Bubbles are cosmetic; their spawn rate tracks each electrode's true
 * gas production rate (cathode bubbles twice as often as the anode).
 *
 * The water itself is rendered as water: a depth gradient under a gently
 * waving surface with wall menisci, a light shaft, stray bubbles that pop
 * into surface ripples, and electron-flow dashes running along the wires
 * whenever current passes.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    voltage: document.getElementById("voltage"),
  };
  const inputValues = {
    voltage: document.getElementById("voltage-value"),
  };
  const out = {
    current: document.getElementById("out-current"),
    charge:  document.getElementById("out-charge"),
    h2:      document.getElementById("out-h2"),
    o2:      document.getElementById("out-o2"),
    ratio:   document.getElementById("out-ratio"),
    state:   document.getElementById("out-state"),
  };
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Electrochemistry ───────────────────────────────────────────────────
  const FARADAY = 96485;        // C/mol e⁻
  const E_DECOMP = 1.23;        // V, thermodynamic decomposition voltage
  const CONDUCTANCE = 1.6;      // A/V above threshold (resistive cell model)

  let charge = 0;               // coulombs passed
  let paused = false;
  let lastTs = performance.now();
  let raf = 0;

  const current = (V) => (V > E_DECOMP ? CONDUCTANCE * (V - E_DECOMP) : 0);
  const molH2 = () => charge / (2 * FARADAY);
  const molO2 = () => charge / (4 * FARADAY);

  // ── Cosmetics (rates track the true production) ────────────────────────
  const bubbles = [];           // { x, y, r, vy, side, stray }
  const ripples = [];           // { x, r, life, t } surface rings
  let bubbleTimer = 0;

  // ── Layout ─────────────────────────────────────────────────────────────
  // Beaker with two electrodes; above each electrode an inverted test
  // tube collects the gas. Cathode (−, H₂) left, anode (+, O₂) right.
  // Electrode positions are PROPORTIONAL to the beaker width so a narrow
  // canvas never collapses the two electrodes onto each other.
  const CELL = { x0: 60, y0: 130, x1: 460, y1: 430 };
  const waterY = () => CELL.y0 + 26;
  const elec = (side) => {
    const f = side === "cath" ? 0.27 : 0.73;
    const cx = CELL.x0 + (CELL.x1 - CELL.x0) * f;
    return { x: cx, top: waterY() + 40, bot: CELL.y1 - 18 };
  };
  const TUBE = { w: 56, h: 170 };
  const tubeRect = (side) => {
    const e = elec(side);
    return { x: e.x - TUBE.w / 2, y: waterY() - 12, w: TUBE.w, h: TUBE.h };
  };
  // Full tube at this many moles — chosen so ~90 s at 2 A fills the H₂ tube.
  const TUBE_FULL_MOL = 1.0e-3;

  const surfaceAt = (x, ph) =>
    waterY() + Math.sin(x * 0.055 + ph * 1.7) * 1.4 + Math.sin(x * 0.021 - ph * 1.1) * 1.0;

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt, V) {
    const I = current(V);
    charge += I * dt;

    // Bubbles: spawn ∝ current; cathode twice the rate of the anode.
    // A few strays drift out past the tube mouth and pop at the surface.
    bubbleTimer += dt * I;
    while (bubbleTimer > 0.1) {
      bubbleTimer -= 0.1;
      const mk = (side) => {
        const e = elec(side);
        const stray = Math.random() < 0.18;
        bubbles.push({
          side, stray,
          x: e.x + (Math.random() - 0.5) * (stray ? 46 : 10),
          y: e.top + Math.random() * (e.bot - e.top),
          r: (side === "cath" ? 1.5 : 1.8) + Math.random() * 1.8,
          vy: 24 + Math.random() * 24,
        });
      };
      mk("cath");
      if (Math.random() < 0.5) mk("anode");
    }

    const ph = performance.now() / 1000;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.vy * dt;
      b.x += Math.sin(b.y * 0.11 + i) * 7 * dt;
      const t = tubeRect(b.side);
      const gasFrac = Math.min((b.side === "cath" ? molH2() : molO2()) / TUBE_FULL_MOL, 1);
      const gasLineY = t.y + t.h * gasFrac;       // bottom edge of collected gas
      const inTubeMouth = b.x > t.x + 3 && b.x < t.x + t.w - 3;
      if (!b.stray && inTubeMouth && gasFrac < 1) {
        // Collected: vanish where it meets the gas pocket in the tube.
        if (b.y < gasLineY + 5) bubbles.splice(i, 1);
      } else if (b.y < surfaceAt(b.x, ph) + 2) {
        // Escaped to the open surface: pop into a ripple.
        ripples.push({ x: b.x, r: b.r * 1.6, life: 0.7, t: 0 });
        bubbles.splice(i, 1);
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].t += dt;
      if (ripples[i].t > ripples[i].life) ripples.splice(i, 1);
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function beakerInnerPath(topY) {
    ctx.beginPath();
    ctx.moveTo(CELL.x0 + 2, topY);
    ctx.lineTo(CELL.x0 + 2, CELL.y1 - 12);
    ctx.quadraticCurveTo(CELL.x0 + 2, CELL.y1 - 2, CELL.x0 + 12, CELL.y1 - 2);
    ctx.lineTo(CELL.x1 - 12, CELL.y1 - 2);
    ctx.quadraticCurveTo(CELL.x1 - 2, CELL.y1 - 2, CELL.x1 - 2, CELL.y1 - 12);
    ctx.lineTo(CELL.x1 - 2, topY);
  }

  function drawWater(ph) {
    // Water body under a gently waving surface, with a depth gradient.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(CELL.x0 + 2, surfaceAt(CELL.x0 + 2, ph));
    for (let x = CELL.x0 + 2; x <= CELL.x1 - 2; x += 6) {
      ctx.lineTo(x, surfaceAt(x, ph));
    }
    ctx.lineTo(CELL.x1 - 2, CELL.y1 - 2);
    ctx.lineTo(CELL.x0 + 2, CELL.y1 - 2);
    ctx.closePath();
    const wg = ctx.createLinearGradient(0, waterY(), 0, CELL.y1);
    wg.addColorStop(0,   "rgba(120, 178, 245, 0.16)");
    wg.addColorStop(0.4, "rgba(88, 138, 220, 0.20)");
    wg.addColorStop(1,   "rgba(56, 92, 180, 0.30)");
    ctx.fillStyle = wg;
    ctx.fill();

    // Light shaft slanting through the water.
    ctx.clip();
    const shaftX = CELL.x0 + (CELL.x1 - CELL.x0) * 0.42;
    const sh = ctx.createLinearGradient(shaftX, waterY(), shaftX + 70, CELL.y1);
    sh.addColorStop(0, "rgba(200, 230, 255, 0.10)");
    sh.addColorStop(1, "rgba(200, 230, 255, 0.0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.moveTo(shaftX - 26, waterY() - 4);
    ctx.lineTo(shaftX + 30, waterY() - 4);
    ctx.lineTo(shaftX + 92, CELL.y1);
    ctx.lineTo(shaftX + 6, CELL.y1);
    ctx.closePath();
    ctx.fill();

    // Faint caustic shimmer lines drifting in the body.
    ctx.strokeStyle = "rgba(190, 225, 255, 0.06)";
    ctx.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) {
      const yy = waterY() + 46 + k * 64;
      ctx.beginPath();
      for (let x = CELL.x0 + 6; x <= CELL.x1 - 6; x += 8) {
        const y = yy + Math.sin(x * 0.05 + ph * (1.1 + k * 0.35) + k * 2.2) * 5;
        x === CELL.x0 + 6 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Surface line — brighter, with sparkle where the wave crests.
    ctx.strokeStyle = "rgba(190, 222, 255, 0.55)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let x = CELL.x0 + 2; x <= CELL.x1 - 2; x += 4) {
      const y = surfaceAt(x, ph);
      x === CELL.x0 + 2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Menisci: water climbs slightly where it meets the glass.
    ctx.strokeStyle = "rgba(190, 222, 255, 0.5)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(CELL.x0 + 2, surfaceAt(CELL.x0 + 8, ph) - 5);
    ctx.quadraticCurveTo(CELL.x0 + 5, surfaceAt(CELL.x0 + 6, ph), CELL.x0 + 12, surfaceAt(CELL.x0 + 12, ph));
    ctx.moveTo(CELL.x1 - 2, surfaceAt(CELL.x1 - 8, ph) - 5);
    ctx.quadraticCurveTo(CELL.x1 - 5, surfaceAt(CELL.x1 - 6, ph), CELL.x1 - 12, surfaceAt(CELL.x1 - 12, ph));
    ctx.stroke();

    // Surface ripples from popped bubbles.
    for (const rp of ripples) {
      const k = rp.t / rp.life;
      ctx.strokeStyle = `rgba(210, 235, 255, ${0.5 * (1 - k)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(rp.x, surfaceAt(rp.x, ph), rp.r + k * 16, (rp.r + k * 16) * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawCell(V) {
    const ph = performance.now() / 1000;
    const I = current(V);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0c1422");
    bg.addColorStop(1, "#141126");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawWater(ph);

    // Beaker glass: outline + inner-wall highlight.
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CELL.x0 - 6, CELL.y0 - 8);          // small pouring lip
    ctx.lineTo(CELL.x0, CELL.y0);
    ctx.lineTo(CELL.x0, CELL.y1 - 12);
    ctx.quadraticCurveTo(CELL.x0, CELL.y1, CELL.x0 + 12, CELL.y1);
    ctx.lineTo(CELL.x1 - 12, CELL.y1);
    ctx.quadraticCurveTo(CELL.x1, CELL.y1, CELL.x1, CELL.y1 - 12);
    ctx.lineTo(CELL.x1, CELL.y0);
    ctx.lineTo(CELL.x1 + 6, CELL.y0 - 8);
    ctx.stroke();
    const glassHl = ctx.createLinearGradient(CELL.x0, 0, CELL.x0 + 26, 0);
    glassHl.addColorStop(0, "rgba(255,255,255,0.10)");
    glassHl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glassHl;
    ctx.fillRect(CELL.x0 + 2, CELL.y0 + 6, 24, CELL.y1 - CELL.y0 - 10);

    // Electrodes + collected gas tubes
    for (const side of ["cath", "anode"]) {
      const e = elec(side);
      const t = tubeRect(side);
      const isC = side === "cath";

      // Test tube (inverted): glass walls + closed top
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y + t.h);
      ctx.lineTo(t.x, t.y + 8);
      ctx.quadraticCurveTo(t.x, t.y, t.x + 8, t.y);
      ctx.lineTo(t.x + t.w - 8, t.y);
      ctx.quadraticCurveTo(t.x + t.w, t.y, t.x + t.w, t.y + 8);
      ctx.lineTo(t.x + t.w, t.y + t.h);
      ctx.stroke();

      // Water inside tube + collected gas (fills from the top down)
      const mol = isC ? molH2() : molO2();
      const frac = Math.min(mol / TUBE_FULL_MOL, 1);
      const gasH = t.h * frac;
      const tw = ctx.createLinearGradient(0, t.y, 0, t.y + t.h);
      tw.addColorStop(0, "rgba(100, 150, 230, 0.16)");
      tw.addColorStop(1, "rgba(70, 108, 195, 0.24)");
      ctx.fillStyle = tw;
      ctx.fillRect(t.x + 1.5, t.y + gasH, t.w - 3, t.h - gasH);
      ctx.fillStyle = isC ? "rgba(140, 220, 255, 0.28)" : "rgba(255, 200, 140, 0.25)";
      ctx.fillRect(t.x + 1.5, t.y + 1.5, t.w - 3, Math.max(gasH - 1.5, 0));
      // Gas/water interface inside the tube
      if (frac > 0.01 && frac < 1) {
        ctx.strokeStyle = "rgba(220, 238, 255, 0.55)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(t.x + 1.5, t.y + gasH);
        ctx.lineTo(t.x + t.w - 1.5, t.y + gasH);
        ctx.stroke();
      }

      // Electrode plate with a subtle metallic gradient.
      const eg = ctx.createLinearGradient(e.x - 4, 0, e.x + 4, 0);
      if (isC) {
        eg.addColorStop(0, "#a9c8e8"); eg.addColorStop(0.5, "#7d9fc4"); eg.addColorStop(1, "#5f7fa6");
      } else {
        eg.addColorStop(0, "#e8cba9"); eg.addColorStop(0.5, "#c4a37d"); eg.addColorStop(1, "#a6845f");
      }
      ctx.fillStyle = eg;
      ctx.fillRect(e.x - 4, e.top, 8, e.bot - e.top);

      // Wire up and out to the source
      ctx.strokeStyle = "rgba(200, 210, 230, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x, e.top);
      ctx.lineTo(e.x, 70);
      ctx.lineTo(W * 0.325, 70);
      ctx.stroke();

      // Electron flow: bright dashes streaming along the wire while
      // current passes. Electrons run battery(−) → cathode, and
      // anode → battery(+): dashes flow DOWN the cathode wire and UP
      // the anode wire.
      if (I > 0) {
        ctx.save();
        ctx.strokeStyle = isC ? "rgba(140, 220, 255, 0.85)" : "rgba(255, 205, 150, 0.85)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 14]);
        const flow = ph * (26 + I * 10);
        ctx.lineDashOffset = isC ? -flow : flow;
        ctx.beginPath();
        // Draw the path battery → electrode so a NEGATIVE offset moves
        // dashes toward the electrode (cathode) and a positive one
        // moves them toward the battery (anode).
        ctx.moveTo(W * 0.325, 70);
        ctx.lineTo(e.x, 70);
        ctx.lineTo(e.x, e.top);
        ctx.stroke();
        ctx.restore();
      }

      // Labels
      ctx.fillStyle = "rgba(236,240,251,0.85)";
      ctx.font = "600 13px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(isC ? "− " + i18nText("elCathode", "cathode") + " · H₂" : "+ " + i18nText("elAnode", "anode") + " · O₂", e.x, CELL.y1 + 22);
      ctx.fillText((mol * 1000).toFixed(3) + " mmol", e.x, t.y - 8);
    }

    // Battery box between the wires
    const bx = W * 0.325 - 40, by = 48;
    ctx.fillStyle = "rgba(20, 26, 44, 0.9)";
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, 80, 40);
    ctx.strokeRect(bx, by, 80, 40);
    ctx.fillStyle = I > 0 ? "#6effc6" : "rgba(236,240,251,0.5)";
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(V.toFixed(2) + " V", bx + 40, by + 25);
    // Terminal marks
    ctx.font = "700 12px ui-monospace, monospace";
    ctx.fillStyle = "rgba(140, 220, 255, 0.9)";
    ctx.fillText("−", bx - 8, by + 25);
    ctx.fillStyle = "rgba(255, 150, 150, 0.9)";
    ctx.fillText("+", bx + 88, by + 25);

    // Bubbles — tiny glass spheres with a highlight.
    for (const b of bubbles) {
      ctx.strokeStyle = b.side === "cath" ? "rgba(170, 228, 255, 0.75)" : "rgba(255, 214, 165, 0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, Math.max(0.5, b.r * 0.25), 0, Math.PI * 2);
      ctx.fill();
    }

    // Volume-ratio bar chart on the right
    drawRatioChart();
  }

  function drawRatioChart() {
    const gx = CELL.x1 + 58, gw = W - gx - 30;
    if (gw < 80) return;
    const gy0 = 140, gy1 = 420;
    const h2 = molH2(), o2 = molO2();
    const maxMol = Math.max(h2, 1e-9);
    const bar = (i, mol, color, label) => {
      const bw = gw / 2 - 18;
      const x = gx + i * (bw + 30);
      const bh = (mol / (maxMol * 1.08)) * (gy1 - gy0);
      const bgr = ctx.createLinearGradient(0, gy1 - bh, 0, gy1);
      bgr.addColorStop(0, color.replace("0.55", "0.75"));
      bgr.addColorStop(1, color);
      ctx.fillStyle = bgr;
      ctx.fillRect(x, gy1 - bh, bw, bh);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.strokeRect(x, gy0, bw, gy1 - gy0);
      ctx.fillStyle = "rgba(236,240,251,0.8)";
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x + bw / 2, gy1 + 18);
    };
    bar(0, h2, "rgba(140, 220, 255, 0.55)", "H₂");
    bar(1, o2, "rgba(255, 200, 140, 0.55)", "O₂");
    ctx.fillStyle = "rgba(236,240,251,0.6)";
    ctx.textAlign = "center";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(i18nText("elChartTitle", "collected gas (mol)"), gx + gw / 2, 126);
    // 2:1 guide on the O₂ bar
    if (h2 > 1e-9) {
      const guideY = gy1 - (h2 / 2 / (maxMol * 1.08)) * (gy1 - gy0);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.moveTo(gx + gw / 2 + 12, guideY);
      ctx.lineTo(gx + gw, guideY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = "left";
      ctx.fillText("½ H₂", gx + gw / 2 + 14, guideY - 5);
    }
  }

  function updateReadouts(V) {
    const I = current(V);
    out.current.textContent = I.toFixed(2);
    out.charge.textContent = charge.toFixed(1);
    out.h2.textContent = (molH2() * 1000).toFixed(3);
    out.o2.textContent = (molO2() * 1000).toFixed(3);
    out.ratio.textContent = molO2() > 1e-12 ? (molH2() / molO2()).toFixed(2) + " : 1" : "—";
    out.state.textContent = I > 0
      ? i18nText("elStateOn", "Electrolysing")
      : i18nText("elStateOff", "Below 1.23 V — no current");
    out.state.style.color = I > 0 ? "#6effc6" : "";
  }

  function updateLabels() {
    inputValues.voltage.textContent = parseFloat(inputs.voltage.value).toFixed(2);
  }

  function syncPauseBtn() {
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    // Clamp below at 0 too — a first rAF timestamp can precede the
    // performance.now() captured in start(), and a negative dt would
    // run accumulators (charge, time, volume) backwards.
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    const V = parseFloat(inputs.voltage.value);
    if (!paused) step(dt, V);
    drawCell(V);
    updateReadouts(V);
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  inputs.voltage.addEventListener("input", updateLabels);
  pauseBtn.addEventListener("click", () => { paused = !paused; syncPauseBtn(); });
  resetBtn.addEventListener("click", () => {
    charge = 0;
    bubbles.length = 0;
    ripples.length = 0;
    inputs.voltage.value = "2.5";
    paused = false;
    updateLabels();
    syncPauseBtn();
  });

  document.addEventListener("langchange", syncPauseBtn);
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
    H = 470;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CELL.x1 = Math.max(CELL.x0 + 260, Math.min(460, W * 0.58));
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  updateLabels();
  syncPauseBtn();
  start();
})();
