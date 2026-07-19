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

  // ── Bubbles (cosmetic; rate tracks true production) ────────────────────
  const bubbles = [];           // { x, y, r, vy, side }
  let bubbleTimer = 0;

  // ── Layout ─────────────────────────────────────────────────────────────
  // Beaker with two electrodes; above each electrode an inverted test
  // tube collects the gas. Cathode (−, H₂) left, anode (+, O₂) right.
  const CELL = { x0: 60, y0: 130, x1: 460, y1: 430 };
  const waterY = () => CELL.y0 + 26;
  const elec = (side) => {
    const cx = side === "cath" ? CELL.x0 + 110 : CELL.x1 - 110;
    return { x: cx, top: waterY() + 40, bot: CELL.y1 - 18 };
  };
  const TUBE = { w: 56, h: 170 };
  const tubeRect = (side) => {
    const e = elec(side);
    return { x: e.x - TUBE.w / 2, y: waterY() - 12, w: TUBE.w, h: TUBE.h };
  };
  // Full tube at this many moles — chosen so ~90 s at 2 A fills the H₂ tube.
  const TUBE_FULL_MOL = 1.0e-3;

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt, V) {
    const I = current(V);
    charge += I * dt;

    // Bubbles: spawn ∝ current; cathode twice the rate of the anode.
    bubbleTimer += dt * I;
    while (bubbleTimer > 0.12) {
      bubbleTimer -= 0.12;
      const eC = elec("cath");
      bubbles.push({ x: eC.x + (Math.random() - 0.5) * 10, y: eC.top + Math.random() * (eC.bot - eC.top), r: 1.6 + Math.random() * 1.8, vy: 26 + Math.random() * 22, side: "cath" });
      if (Math.random() < 0.5) {
        const eA = elec("anode");
        bubbles.push({ x: eA.x + (Math.random() - 0.5) * 10, y: eA.top + Math.random() * (eA.bot - eA.top), r: 1.8 + Math.random() * 2.0, vy: 22 + Math.random() * 18, side: "anode" });
      }
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.vy * dt;
      b.x += Math.sin(b.y * 0.12) * 6 * dt;
      const t = tubeRect(b.side);
      const gasFrac = Math.min((b.side === "cath" ? molH2() : molO2()) / TUBE_FULL_MOL, 1);
      const gasBottom = t.y + t.h * 0 + (t.h * gasFrac); // gas fills from tube top downward
      if (b.y < t.y + gasBottom + 6) bubbles.splice(i, 1);
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function drawCell(V) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0c1422");
    bg.addColorStop(1, "#141126");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Beaker glass
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CELL.x0, CELL.y0);
    ctx.lineTo(CELL.x0, CELL.y1 - 12);
    ctx.quadraticCurveTo(CELL.x0, CELL.y1, CELL.x0 + 12, CELL.y1);
    ctx.lineTo(CELL.x1 - 12, CELL.y1);
    ctx.quadraticCurveTo(CELL.x1, CELL.y1, CELL.x1, CELL.y1 - 12);
    ctx.lineTo(CELL.x1, CELL.y0);
    ctx.stroke();

    // Water
    ctx.fillStyle = "rgba(110, 168, 255, 0.12)";
    ctx.fillRect(CELL.x0 + 2, waterY(), CELL.x1 - CELL.x0 - 4, CELL.y1 - waterY() - 2);
    ctx.strokeStyle = "rgba(160, 200, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CELL.x0 + 2, waterY());
    ctx.lineTo(CELL.x1 - 2, waterY());
    ctx.stroke();

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
      ctx.fillStyle = "rgba(110, 168, 255, 0.15)";
      ctx.fillRect(t.x + 1.5, t.y + gasH, t.w - 3, t.h - gasH);
      ctx.fillStyle = isC ? "rgba(140, 220, 255, 0.28)" : "rgba(255, 200, 140, 0.25)";
      ctx.fillRect(t.x + 1.5, t.y + 1.5, t.w - 3, Math.max(gasH - 1.5, 0));
      // Gas level line
      if (frac > 0.01 && frac < 1) {
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.beginPath();
        ctx.moveTo(t.x, t.y + gasH);
        ctx.lineTo(t.x + t.w, t.y + gasH);
        ctx.stroke();
      }

      // Electrode plate
      ctx.fillStyle = isC ? "#8fb4d8" : "#d8b48f";
      ctx.fillRect(e.x - 4, e.top, 8, e.bot - e.top);
      // Wire up and out
      ctx.strokeStyle = "rgba(200, 210, 230, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x, e.top);
      ctx.lineTo(e.x, 70);
      ctx.lineTo(W * 0.325, 70);
      ctx.stroke();

      // Labels
      ctx.fillStyle = "rgba(236,240,251,0.85)";
      ctx.font = "600 13px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(isC ? "− " + i18nText("elCathode", "cathode") + " · H₂" : "+ " + i18nText("elAnode", "anode") + " · O₂", e.x, CELL.y1 + 22);
      const molTxt = (mol * 1000).toFixed(3) + " mmol";
      ctx.fillText(molTxt, e.x, t.y - 8);
    }

    // Battery box between the wires
    const bx = W * 0.325 - 40, by = 48;
    ctx.fillStyle = "rgba(20, 26, 44, 0.9)";
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, 80, 40);
    ctx.strokeRect(bx, by, 80, 40);
    ctx.fillStyle = current(V) > 0 ? "#6effc6" : "rgba(236,240,251,0.5)";
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(V.toFixed(2) + " V", bx + 40, by + 25);

    // Bubbles
    for (const b of bubbles) {
      ctx.strokeStyle = b.side === "cath" ? "rgba(160, 225, 255, 0.7)" : "rgba(255, 210, 160, 0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Volume-ratio bar chart on the right
    drawRatioChart();
  }

  function drawRatioChart() {
    const gx = 520, gw = W - gx - 30;
    if (gw < 80) return;
    const gy0 = 140, gy1 = 420;
    const h2 = molH2(), o2 = molO2();
    const maxMol = Math.max(h2, 1e-9);
    const bar = (i, mol, color, label) => {
      const bw = gw / 2 - 18;
      const x = gx + i * (bw + 30);
      const bh = (mol / (maxMol * 1.08)) * (gy1 - gy0);
      ctx.fillStyle = color;
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
    const guideY = 420 - (molH2() / 2 / (Math.max(molH2(), 1e-9) * 1.08)) * 280;
    if (molH2() > 1e-9) {
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
    CELL.x1 = Math.min(460, W * 0.58);
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  updateLabels();
  syncPauseBtn();
  start();
})();
