/*
 * Electromagnetic generator — Faraday's law, driven by a water wheel.
 *
 * Water from the faucet spins a wheel whose axle carries a bar magnet
 * rotating inside a pickup coil. The flux the coil links is the component
 * of the magnet's field along the coil axis, ∝ cos of the magnet angle:
 *
 *   Φ(θ) = N·B·A·cos θ                 (θ = ω·t, magnet angle)
 *   EMF  = −dΦ/dt = N·B·A·ω·sin θ      (Faraday's law → sinusoidal AC)
 *   peak EMF = N·B·A·ω ,   f = ω / 2π
 *
 * so nothing is induced by a still magnet — only the turning matters — and
 * the peak scales linearly with every one of N, B, A, ω. The wheel itself
 * obeys I·dω/dt = τ(flow) − b·ω, reaching a steady spin set by the faucet.
 *
 * The field grid draws the true rotating dipole field (3(m·r̂)r̂ − m)/r³;
 * its x-component through the coil is exactly the cos θ the flux uses, so
 * the picture and the formula are the same physics.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    flow:     document.getElementById("flow"),
    loops:    document.getElementById("loops"),
    area:     document.getElementById("area"),
    strength: document.getElementById("strength"),
  };
  const inputValues = {
    flow:     document.getElementById("flow-value"),
    loops:    document.getElementById("loops-value"),
    area:     document.getElementById("area-value"),
    strength: document.getElementById("strength-value"),
  };
  const out = {
    emf:   document.getElementById("out-emf"),
    rpm:   document.getElementById("out-rpm"),
    peak:  document.getElementById("out-peak"),
    freq:  document.getElementById("out-freq"),
    flux:  document.getElementById("out-flux"),
    power: document.getElementById("out-power"),
  };
  const flipBtn = document.getElementById("flip-btn");
  const resetBtn = document.getElementById("reset-btn");
  const meterList = document.getElementById("meter-list");
  const fieldToggle = document.getElementById("field-toggle");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Model constants ────────────────────────────────────────────────────
  const WHEEL_TORQUE = 16;   // torque per unit flow
  const WHEEL_DAMP = 1.4;    // b
  const WHEEL_INERTIA = 0.6; // I  → steady ω = 16·flow/1.4 ≈ 11·flow rad/s
  const K_EMF = 0.05;        // volts per (N·B·A·ω)
  const EMF_REF = 2.5;       // bulb saturates here (V)

  // ── State ──────────────────────────────────────────────────────────────
  let omega = 0;             // rad/s
  let theta = 0;             // magnet angle
  let pole = 1;              // +1 / −1 (flip)
  let meter = "bulb";
  let showField = true;
  let lastTs = performance.now();
  let raf = 0;
  const trace = [];          // recent EMF samples for the strip chart
  const drops = [];          // falling water droplets

  function readParams() {
    return {
      flow: parseFloat(inputs.flow.value) / 100,
      N: parseInt(inputs.loops.value, 10),
      A: parseFloat(inputs.area.value),
      B: parseFloat(inputs.strength.value),
    };
  }

  const fluxLinkage = (p) => p.N * p.B * p.A * pole * Math.cos(theta);   // N·B·A·cosθ
  const emf = (p) => K_EMF * p.N * p.B * p.A * pole * omega * Math.sin(theta);
  const peakEmf = (p) => K_EMF * p.N * p.B * p.A * omega;

  // ── Layout (logical px) ────────────────────────────────────────────────
  let wheel, magnet, bulb, coilR;
  function computeLayout() {
    const cyc = 208;
    wheel  = { x: 118, y: cyc, r: 62 };
    magnet = { x: W * 0.52, y: cyc, len: 96, w: 34 };
    coilR  = { rx: 30, ry: 62 };
    bulb   = { x: W - 78, y: cyc };
  }

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt, p) {
    const tau = WHEEL_TORQUE * p.flow;
    omega += ((tau - WHEEL_DAMP * omega) / WHEEL_INERTIA) * dt;
    if (omega < 0) omega = 0;
    theta += omega * dt;

    trace.push(emf(p));
    while (trace.length > 240) trace.shift();

    // Water droplets from the faucet, rate ∝ flow.
    if (p.flow > 0.01 && Math.random() < p.flow * dt * 60) {
      drops.push({ x: wheel.x + 30 + (Math.random() - 0.5) * 8, y: wheel.y - wheel.r - 66, vy: 60 });
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      drops[i].vy += 320 * dt;
      drops[i].y += drops[i].vy * dt;
      if (drops[i].y > wheel.y - wheel.r + 6) drops.splice(i, 1);
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function drawBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a1024");
    bg.addColorStop(1, "#0d1436");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawFaucet(p) {
    const fx = wheel.x + 30, fy = wheel.y - wheel.r - 74;
    ctx.fillStyle = "#8d97b6";
    ctx.fillRect(fx - 34, fy - 8, 30, 12);
    ctx.fillRect(fx - 8, fy - 8, 10, 22);
    // Water stream
    if (p.flow > 0.01) {
      ctx.strokeStyle = "rgba(140, 200, 255, 0.4)";
      ctx.lineWidth = 2 + p.flow * 6;
      ctx.beginPath();
      ctx.moveTo(fx - 3, fy + 14);
      ctx.lineTo(fx - 3, wheel.y - wheel.r + 4);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(160, 210, 255, 0.7)";
    for (const d of drops) {
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 2, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWheel() {
    const { x, y, r } = wheel;
    // Rim
    ctx.strokeStyle = "rgba(150, 200, 255, 0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    // Paddles / spokes (rotate with the magnet — same axle)
    const nP = 8;
    for (let i = 0; i < nP; i++) {
      const a = theta + (i / nP) * Math.PI * 2;
      const ox = Math.cos(a), oy = Math.sin(a);
      ctx.strokeStyle = "rgba(150, 200, 255, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + ox * r, y + oy * r);
      ctx.stroke();
      // Paddle blade
      ctx.fillStyle = "rgba(110, 168, 255, 0.28)";
      ctx.save();
      ctx.translate(x + ox * (r - 8), y + oy * (r - 8));
      ctx.rotate(a);
      ctx.fillRect(-3, -10, 10, 20);
      ctx.restore();
    }
    ctx.fillStyle = "#2a3352";
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    // Axle to the magnet
    ctx.strokeStyle = "rgba(180, 190, 210, 0.6)";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(magnet.x, y); ctx.stroke();
  }

  function fieldAt(px, py) {
    // Dipole field direction/strength at (px,py) from the magnet.
    const mx = Math.cos(theta) * pole, my = Math.sin(theta) * pole;
    const dx = px - magnet.x, dy = py - magnet.y;
    const r = Math.hypot(dx, dy);
    if (r < 1) return null;
    const rx = dx / r, ry = dy / r;
    const mdotr = mx * rx + my * ry;
    const bx = (3 * mdotr * rx - mx);
    const by = (3 * mdotr * ry - my);
    const mag = Math.hypot(bx, by) / (r * r * r);
    return { bx, by, mag };
  }

  function drawField(p) {
    if (!showField) return;
    const step = 46;
    ctx.lineCap = "round";
    for (let px = magnet.x - 200; px <= magnet.x + 200; px += step) {
      for (let py = magnet.y - 150; py <= magnet.y + 150; py += step) {
        const f = fieldAt(px, py);
        if (!f) continue;
        const len = Math.hypot(f.bx, f.by) || 1;
        const ux = f.bx / len, uy = f.by / len;
        const a = Math.min(0.05 + f.mag * 3200 * p.B, 0.5);
        ctx.strokeStyle = `rgba(150, 190, 255, ${a})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(px - ux * 9, py - uy * 9);
        ctx.lineTo(px + ux * 9, py + uy * 9);
        ctx.stroke();
        // arrowhead toward field direction
        ctx.beginPath();
        ctx.moveTo(px + ux * 9, py + uy * 9);
        ctx.lineTo(px + ux * 9 - (ux + uy) * 4, py + uy * 9 - (uy - ux) * 4);
        ctx.moveTo(px + ux * 9, py + uy * 9);
        ctx.lineTo(px + ux * 9 - (ux - uy) * 4, py + uy * 9 - (uy + ux) * 4);
        ctx.stroke();
      }
    }
  }

  function drawCoil() {
    // Loops of wire around the magnet (drawn as stacked ellipses).
    const p = readParams();
    const { x, y } = magnet;
    ctx.strokeStyle = "rgba(210, 170, 120, 0.85)";
    ctx.lineWidth = 2.4;
    const spread = Math.min(coilR.rx * 0.6, (magnet.len * 0.7) / Math.max(p.N, 1));
    for (let i = 0; i < p.N; i++) {
      const ox = (i - (p.N - 1) / 2) * (spread * 1.6);
      ctx.beginPath();
      ctx.ellipse(x + ox, y, coilR.rx, coilR.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Leads to the bulb
    ctx.strokeStyle = "rgba(200, 210, 230, 0.7)";
    ctx.lineWidth = 2;
    const rightX = x + ((p.N - 1) / 2) * (spread * 1.6) + coilR.rx;
    ctx.beginPath();
    ctx.moveTo(rightX, y - coilR.ry * 0.5);
    ctx.lineTo(bulb.x - 26, y - coilR.ry * 0.5);
    ctx.moveTo(rightX, y + coilR.ry * 0.5);
    ctx.lineTo(bulb.x - 26, y + coilR.ry * 0.5);
    ctx.stroke();
  }

  function drawMagnet() {
    const { x, y, len, w } = magnet;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(theta);
    const nColor = pole > 0 ? "#ff6b8a" : "#6ea8ff";
    const sColor = pole > 0 ? "#6ea8ff" : "#ff6b8a";
    ctx.fillStyle = sColor;
    ctx.fillRect(-len / 2, -w / 2, len / 2, w);
    ctx.fillStyle = nColor;
    ctx.fillRect(0, -w / 2, len / 2, w);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-len / 2, -w / 2, len, w);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = `700 ${Math.round(w * 0.7)}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pole > 0 ? "N" : "S", len / 4, 0);
    ctx.fillText(pole > 0 ? "S" : "N", -len / 4, 0);
    ctx.restore();
  }

  function drawBulb(p) {
    const e = Math.abs(emf(p));
    const bright = Math.min(e / EMF_REF, 1);
    const { x, y } = bulb;
    // Glow halo
    if (bright > 0.01) {
      const g = ctx.createRadialGradient(x, y - 6, 0, x, y - 6, 60);
      g.addColorStop(0, `rgba(255, 244, 190, ${0.75 * bright})`);
      g.addColorStop(1, "rgba(255, 244, 190, 0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y - 6, 60, 0, Math.PI * 2); ctx.fill();
    }
    // Bulb glass
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.fillStyle = `rgba(255, 240, 170, ${0.12 + 0.6 * bright})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - 6, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Filament
    ctx.strokeStyle = `rgba(255, ${Math.round(180 + 70 * bright)}, 90, ${0.5 + 0.5 * bright})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 2);
    for (let i = 0; i <= 6; i++) ctx.lineTo(x - 7 + i * 2.3, y - 6 + (i % 2 ? -5 : 5));
    ctx.stroke();
    // Base
    ctx.fillStyle = "#8d97b6";
    ctx.fillRect(x - 8, y + 12, 16, 10);
  }

  function drawVoltmeter(p) {
    const { x, y } = bulb;
    const R = 34;
    ctx.fillStyle = "rgba(20, 26, 44, 0.9)";
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, R + 6, Math.PI, 0); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - R - 6, y); ctx.lineTo(x + R + 6, y);
    ctx.stroke();
    // Scale marks across the ±60° arc
    ctx.strokeStyle = "rgba(200,210,230,0.5)";
    for (let k = -2; k <= 2; k++) {
      const a = (k / 2) * (Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(a) * (R - 4), y - Math.cos(a) * (R - 4));
      ctx.lineTo(x + Math.sin(a) * R, y - Math.cos(a) * R);
      ctx.stroke();
    }
    // Needle: EMF mapped to ±60°
    const ref = Math.max(peakEmf(p), 0.15);
    const frac = Math.max(-1, Math.min(1, emf(p) / ref));
    const a = frac * (Math.PI / 3);
    ctx.strokeStyle = "#ff9f6b";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(a) * (R - 2), y - Math.cos(a) * (R - 2));
    ctx.stroke();
    ctx.fillStyle = "rgba(236,240,251,0.7)";
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("V", x, y + 16);
    ctx.fillStyle = "rgba(255,138,163,0.8)"; ctx.textAlign = "right"; ctx.fillText("−", x - R, y - 4);
    ctx.fillStyle = "rgba(110,168,255,0.8)"; ctx.textAlign = "left"; ctx.fillText("+", x + R, y - 4);
  }

  function drawTrace(p) {
    const g = { x0: 24, y0: H - 84, x1: W - 24, y1: H - 20 };
    const midY = (g.y0 + g.y1) / 2;
    // Frame + zero line
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(g.x0, midY); ctx.lineTo(g.x1, midY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(236,240,251,0.5)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(i18nText("genTraceLabel", "EMF vs time"), g.x0 + 6, g.y0 + 12);
    // Scale to a stable reference so the sine amplitude reads meaningfully
    const ref = Math.max(peakEmf(p) * 1.1, EMF_REF);
    ctx.strokeStyle = "rgba(255, 159, 107, 0.95)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < trace.length; i++) {
      const tx = g.x0 + (i / 239) * (g.x1 - g.x0);
      const ty = midY - (trace[i] / ref) * ((g.y1 - g.y0) / 2 - 4);
      if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
    }
    ctx.stroke();
  }

  function render(p) {
    drawBackground();
    drawField(p);
    drawFaucet(p);
    drawWheel();
    drawCoil();
    drawMagnet();
    if (meter === "bulb") drawBulb(p); else drawVoltmeter(p);
    drawTrace(p);
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(p) {
    const e = emf(p);
    out.emf.textContent = e.toFixed(2);
    out.emf.style.color = Math.abs(e) < 0.005 ? "" : (e > 0 ? "#ff9f6b" : "#6ea8ff");
    out.rpm.textContent = String(Math.round(omega * 60 / (2 * Math.PI)));
    out.peak.textContent = peakEmf(p).toFixed(2);
    out.freq.textContent = (omega / (2 * Math.PI)).toFixed(2);
    out.flux.textContent = fluxLinkage(p).toFixed(2);
    out.power.textContent = String(Math.round(Math.min((Math.abs(e) / EMF_REF) ** 2, 1) * 100));
  }

  function updateLabels(p) {
    inputValues.flow.textContent = String(Math.round(p.flow * 100));
    inputValues.loops.textContent = String(p.N);
    inputValues.area.textContent = p.A.toFixed(2);
    inputValues.strength.textContent = p.B.toFixed(2);
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    const p = readParams();
    step(dt, p);
    render(p);
    updateReadouts(p);
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  Object.values(inputs).forEach((el) => el.addEventListener("input", () => updateLabels(readParams())));
  flipBtn.addEventListener("click", () => { pole *= -1; });
  meterList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      meter = btn.dataset.key === "volt" ? "volt" : "bulb";
      meterList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  fieldToggle.addEventListener("change", () => { showField = fieldToggle.checked; });
  resetBtn.addEventListener("click", () => {
    inputs.flow.value = "60"; inputs.loops.value = "4";
    inputs.area.value = "1.0"; inputs.strength.value = "1.0";
    omega = 0; theta = 0; pole = 1; trace.length = 0; drops.length = 0;
    updateLabels(readParams());
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
    W = Math.max(Math.round(rect.width), 520);
    H = 500;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  updateLabels(readParams());
  start();
})();
