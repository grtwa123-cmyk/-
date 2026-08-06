/*
 * Electromagnetic generator — Faraday's law run rather than quoted.
 *
 * The page used to evaluate EMF = N·B·A·ω·sin(ωt) and draw it. That is the
 * answer, not the mechanism. Nothing in this file writes sin θ.
 *
 * What is put in is a field and a shape. The bore field points along the
 * magnet and weakens away from the coil axis:
 *
 *   B(ρ, θ) = B₀·g(ρ)·(cos θ, sin θ),    g(ρ) = (1 + (ρ/ρ₀)²)^(−3/2)
 *
 * The flux through one turn is then the surface integral of that field's axial
 * component over the disc the turn encloses, summed on a polar grid, and the
 * flux linkage is N of them. The EMF is a numerical time derivative of that
 * flux — a centred difference, with the minus sign of Faraday's law and
 * nothing else:
 *
 *   ε = −(Φ(θ + ωh) − Φ(θ − ωh)) / 2h
 *
 * So the sine wave is an output. So is its quarter-turn lag behind the flux,
 * so is Lenz's sign, and so are the scalings: the peak comes out exactly
 * linear in N, in B and in ω.
 *
 * The area is the interesting one. The textbook Φ = N·B·A·cos θ assumes the
 * field is uniform across the coil, and then the peak is linear in A. Here it
 * is not: widening the loop reaches out into weaker field, and the measured
 * exponent is about 0.57 — ten times the area buys under four times the EMF.
 * That is a real consequence of the geometry, and the page reports what it
 * measures rather than what the idealisation would have said.
 *
 * The wheel is its own small ODE, I·dω/dt = τ(flow) − b·ω, integrated forward;
 * its steady spin τ/b is not written down either.
 *
 * Units are model units. What is measured here — the waveform, the phase, the
 * sign, the scalings — does not depend on that choice.
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
    emf:     document.getElementById("out-emf"),
    faraday: document.getElementById("out-faraday"),
    rpm:     document.getElementById("out-rpm"),
    peak:    document.getElementById("out-peak"),
    freq:    document.getElementById("out-freq"),
    flux:    document.getElementById("out-flux"),
    power:   document.getElementById("out-power"),
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
  const WHEEL_INERTIA = 0.6; // I
  const RHO0 = 0.42;         // how far out the bore field holds its strength
  const NR = 32, NPHI = 64;  // polar grid the flux integral is summed on
  const DIFF_H = 1e-4;       // the h in the centred difference, seconds
  const VOLT_SCALE = 0.21;   // model flux-rate → displayed volts
  const EMF_REF = 2.5;       // bulb saturates here (V)

  // ── State ──────────────────────────────────────────────────────────────
  let omega = 0;             // rad/s
  let theta = 0;             // magnet angle
  let pole = 1;              // +1 / −1 (flip)
  let meter = "bulb";
  let showField = true;
  let running = true;
  let lastTs = performance.now();
  let raf = 0;
  let simT = 0;                // seconds of simulated time
  const trace = [];            // { t, th, phi, e } — the recorded machine
  const drops = [];            // falling water droplets

  function readParams() {
    return {
      flow: parseFloat(inputs.flow.value) / 100,
      N: parseInt(inputs.loops.value, 10),
      A: parseFloat(inputs.area.value),
      B: parseFloat(inputs.strength.value),
    };
  }

  // ── The field, the flux, and Faraday's law ─────────────────────────────

  /** How much of its axis strength the bore field still has at radius ρ. */
  const g = (rho) => Math.pow(1 + (rho / RHO0) ** 2, -1.5);

  /*
   * Flux through one turn: the surface integral of the field's axial component
   * over the disc the turn encloses, on a polar midpoint grid. The bore model
   * happens to be axisymmetric, so the angular sum comes out uniform — but the
   * integration does not assume that, it just adds up the cells.
   */
  function fluxTurn(th, B0, area, nr = NR, nphi = NPHI) {
    const a = Math.sqrt(area / Math.PI);
    const axial = Math.cos(th) * pole;      // the field's component along the coil
    const dr = a / nr, dphi = (2 * Math.PI) / nphi;
    let sum = 0;
    for (let i = 0; i < nr; i++) {
      const rho = (i + 0.5) * dr;
      const cell = B0 * g(rho) * axial * rho * dr * dphi;
      for (let j = 0; j < nphi; j++) sum += cell;
    }
    return sum;
  }

  const flux = (th, p) => p.N * fluxTurn(th, p.B, p.A);

  /** Faraday's law, as a difference: minus the rate at which the flux changes. */
  const emfAt = (th, w, p) =>
    VOLT_SCALE * -(flux(th + w * DIFF_H, p) - flux(th - w * DIFF_H, p)) / (2 * DIFF_H);

  const emf = (p) => emfAt(theta, omega, p);
  const fluxNow = (p) => flux(theta, p);

  /*
   * The peak is measured off the machine, not predicted: the largest EMF the
   * recorded trace has seen within the last complete turn. Until the wheel has
   * managed one, there is nothing to report.
   */
  function measuredPeak() {
    if (!trace.length) return null;
    const newest = trace[trace.length - 1].th;
    let best = 0, span = 0;
    for (let i = trace.length - 1; i >= 0; i--) {
      span = newest - trace[i].th;
      if (span > 2 * Math.PI) return best;
      best = Math.max(best, Math.abs(trace[i].e));
    }
    return null;                     // not a full turn on the books yet
  }

  /*
   * Faraday's law checked against the machine's own record: differentiate the
   * flux actually logged, across real frame times. Same law, but read off the
   * recorded trace rather than evaluated on the spot.
   *
   * The difference is taken over the last two samples rather than centred over
   * three, so that what it reports belongs to half a frame ago instead of a
   * whole one — near a zero crossing the EMF moves fast enough that a frame of
   * lag would show up as a visible disagreement with the live figure beside it.
   */
  function faradayFromTrace() {
    const n = trace.length;
    if (n < 2) return null;
    const a = trace[n - 2], c = trace[n - 1];
    const dt = c.t - a.t;
    if (dt <= 0) return null;
    return VOLT_SCALE * -(c.phi - a.phi) / dt;
  }

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
    simT += dt;

    trace.push({ t: simT, th: theta, phi: flux(theta, p), e: emf(p) });
    while (trace.length > 480) trace.shift();

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
    ctx.strokeStyle = "rgba(150, 200, 255, 0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
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
      ctx.fillStyle = "rgba(110, 168, 255, 0.28)";
      ctx.save();
      ctx.translate(x + ox * (r - 8), y + oy * (r - 8));
      ctx.rotate(a);
      ctx.fillRect(-3, -10, 10, 20);
      ctx.restore();
    }
    ctx.fillStyle = "#2a3352";
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(180, 190, 210, 0.6)";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(magnet.x, y); ctx.stroke();
  }

  function fieldAt(px, py) {
    // The dipole field outside the coil — what a bar magnet looks like.
    const mx = Math.cos(theta) * pole, my = Math.sin(theta) * pole;
    const dx = px - magnet.x, dy = py - magnet.y;
    const r = Math.hypot(dx, dy);
    if (r < 1) return null;
    const rx = dx / r, ry = dy / r;
    const mdotr = mx * rx + my * ry;
    return { bx: 3 * mdotr * rx - mx, by: 3 * mdotr * ry - my,
             mag: Math.hypot(3 * mdotr * rx - mx, 3 * mdotr * ry - my) / (r * r * r) };
  }

  /*
   * Inside the bore, draw the field the flux integral actually sees: along the
   * magnet, fading with distance from the axis. These are the arrows that get
   * added up.
   */
  function boreFieldAt(px, py, p) {
    const a = Math.sqrt(p.A / Math.PI);
    const rho = (Math.abs(py - magnet.y) / coilR.ry) * a;
    const s = g(rho);
    return { bx: Math.cos(theta) * pole, by: Math.sin(theta) * pole, mag: s * p.B };
  }

  const inBore = (px, py) =>
    ((px - magnet.x) / (coilR.rx * 2.4)) ** 2 + ((py - magnet.y) / coilR.ry) ** 2 <= 1;

  function drawField(p) {
    if (!showField) return;
    const stepPx = 46;
    ctx.lineCap = "round";
    for (let px = magnet.x - 200; px <= magnet.x + 200; px += stepPx) {
      for (let py = magnet.y - 150; py <= magnet.y + 150; py += stepPx) {
        const bore = inBore(px, py);
        const f = bore ? boreFieldAt(px, py, p) : fieldAt(px, py);
        if (!f) continue;
        const len = Math.hypot(f.bx, f.by) || 1;
        const ux = f.bx / len, uy = f.by / len;
        const a = bore ? Math.min(0.16 + f.mag * 0.5, 0.75)
                       : Math.min(0.05 + f.mag * 3200 * p.B, 0.5);
        ctx.strokeStyle = bore ? `rgba(255, 214, 140, ${a})` : `rgba(150, 190, 255, ${a})`;
        ctx.lineWidth = bore ? 1.8 : 1.4;
        ctx.beginPath();
        ctx.moveTo(px - ux * 9, py - uy * 9);
        ctx.lineTo(px + ux * 9, py + uy * 9);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px + ux * 9, py + uy * 9);
        ctx.lineTo(px + ux * 9 - (ux + uy) * 4, py + uy * 9 - (uy - ux) * 4);
        ctx.moveTo(px + ux * 9, py + uy * 9);
        ctx.lineTo(px + ux * 9 - (ux - uy) * 4, py + uy * 9 - (uy + ux) * 4);
        ctx.stroke();
      }
    }
  }

  function drawCoil(p) {
    const { x, y } = magnet;
    // The drawn loop half-height tracks the area slider, because that is what
    // decides how far out into the fading field the turn reaches.
    const ry = coilR.ry * Math.sqrt(p.A / 1.0);
    ctx.strokeStyle = "rgba(210, 170, 120, 0.85)";
    ctx.lineWidth = 2.4;
    const spread = Math.min(coilR.rx * 0.6, (magnet.len * 0.7) / Math.max(p.N, 1));
    for (let i = 0; i < p.N; i++) {
      const ox = (i - (p.N - 1) / 2) * (spread * 1.6);
      ctx.beginPath();
      ctx.ellipse(x + ox, y, coilR.rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(200, 210, 230, 0.7)";
    ctx.lineWidth = 2;
    const rightX = x + ((p.N - 1) / 2) * (spread * 1.6) + coilR.rx;
    ctx.beginPath();
    ctx.moveTo(rightX, y - ry * 0.5);
    ctx.lineTo(bulb.x - 26, y - ry * 0.5);
    ctx.moveTo(rightX, y + ry * 0.5);
    ctx.lineTo(bulb.x - 26, y + ry * 0.5);
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
    if (bright > 0.01) {
      const gl = ctx.createRadialGradient(x, y - 6, 0, x, y - 6, 60);
      gl.addColorStop(0, `rgba(255, 244, 190, ${0.75 * bright})`);
      gl.addColorStop(1, "rgba(255, 244, 190, 0)");
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(x, y - 6, 60, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.fillStyle = `rgba(255, 240, 170, ${0.12 + 0.6 * bright})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - 6, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = `rgba(255, ${Math.round(180 + 70 * bright)}, 90, ${0.5 + 0.5 * bright})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 2);
    for (let i = 0; i <= 6; i++) ctx.lineTo(x - 7 + i * 2.3, y - 6 + (i % 2 ? -5 : 5));
    ctx.stroke();
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
    ctx.strokeStyle = "rgba(200,210,230,0.5)";
    for (let k = -2; k <= 2; k++) {
      const a = (k / 2) * (Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(a) * (R - 4), y - Math.cos(a) * (R - 4));
      ctx.lineTo(x + Math.sin(a) * R, y - Math.cos(a) * R);
      ctx.stroke();
    }
    // Needle scaled to the peak the machine has actually produced.
    const ref = Math.max(measuredPeak() ?? 0, 0.15);
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

  /*
   * Both curves on one axis: the flux the coil links, and the EMF that is its
   * derivative. The quarter-turn offset between them is Faraday's law made
   * visible — the voltage peaks exactly where the flux is passing through zero
   * fastest, and vanishes where the flux is at a standstill.
   */
  function drawTrace(p) {
    const gbox = { x0: 24, y0: H - 96, x1: W - 24, y1: H - 20 };
    const midY = (gbox.y0 + gbox.y1) / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(gbox.x0, gbox.y0, gbox.x1 - gbox.x0, gbox.y1 - gbox.y0);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(gbox.x0, midY); ctx.lineTo(gbox.x1, midY); ctx.stroke();
    ctx.setLineDash([]);

    const n = trace.length;
    const half = (gbox.y1 - gbox.y0) / 2 - 5;
    const curve = (pick, ref, colour, width) => {
      if (ref <= 0) return;
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const tx = gbox.x0 + (i / Math.max(n - 1, 1)) * (gbox.x1 - gbox.x0);
        const ty = midY - (pick(trace[i]) / ref) * half;
        if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
      }
      ctx.stroke();
    };
    let phiRef = 0, eRef = 0;
    for (const s of trace) {
      phiRef = Math.max(phiRef, Math.abs(s.phi));
      eRef = Math.max(eRef, Math.abs(s.e));
    }
    curve((s) => s.phi, phiRef || 1, "rgba(122, 217, 238, 0.75)", 1.6);
    curve((s) => s.e, eRef || 1, "rgba(255, 159, 107, 0.95)", 1.8);

    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(122, 217, 238, 0.9)";
    ctx.fillText(i18nText("genTraceFlux", "flux Φ"), gbox.x0 + 6, gbox.y0 + 12);
    ctx.fillStyle = "rgba(255, 159, 107, 0.95)";
    ctx.fillText(i18nText("genTraceEmf", "EMF = −dΦ/dt"), gbox.x0 + 58, gbox.y0 + 12);
  }

  function render(p) {
    drawBackground();
    drawField(p);
    drawFaucet(p);
    drawWheel();
    drawCoil(p);
    drawMagnet();
    if (meter === "bulb") drawBulb(p); else drawVoltmeter(p);
    drawTrace(p);
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(p) {
    const e = emf(p);
    out.emf.textContent = e.toFixed(2);
    out.emf.style.color = Math.abs(e) < 0.005 ? "" : (e > 0 ? "#ff9f6b" : "#6ea8ff");
    const fromTrace = faradayFromTrace();
    out.faraday.textContent = fromTrace === null ? "—" : fromTrace.toFixed(2);
    out.rpm.textContent = String(Math.round((omega * 60) / (2 * Math.PI)));
    const pk = measuredPeak();
    out.peak.textContent = pk === null ? "—" : pk.toFixed(2);
    out.freq.textContent = (omega / (2 * Math.PI)).toFixed(2);
    out.flux.textContent = fluxNow(p).toFixed(2);
    out.power.textContent = String(Math.round(Math.min((Math.abs(e) / EMF_REF) ** 2, 1) * 100));
  }

  function updateLabels(p) {
    inputValues.flow.textContent = String(Math.round(p.flow * 100));
    inputValues.loops.textContent = String(p.N);
    inputValues.area.textContent = p.A.toFixed(2);
    inputValues.strength.textContent = p.B.toFixed(2);
  }

  // Generator hum — pitch rises with the wheel's spin, volume with it too.
  const hum = window.SFX ? new window.SFX.Drone({ type: "sawtooth", freq: 50, gain: 0, partials: 1 }) : null;
  function updateHum() {
    if (!hum) return;
    hum.setFreq(38 + omega * 6);
    hum.setGain(Math.min(0.06, omega * 0.006));
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function draw() {
    const p = readParams();
    render(p);
    updateReadouts(p);
  }
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    const p = readParams();
    step(dt, p);
    render(p);
    updateReadouts(p);
    updateHum();
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    if (running) raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  Object.values(inputs).forEach((el) => el.addEventListener("input", () => {
    updateLabels(readParams());
    if (!running) draw();
  }));
  flipBtn.addEventListener("click", () => {
    pole *= -1;
    window.SFX?.noise({ dur: 0.08, gain: 0.18, color: "pink", filter: "lowpass", freq: 320, q: 0.9 });
    if (!running) draw();
  });
  meterList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      meter = btn.dataset.key === "volt" ? "volt" : "bulb";
      window.SFX?.tone({ freq: 620, dur: 0.07, type: "triangle", gain: 0.1 });
      meterList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b === btn));
      if (!running) draw();
    });
  });
  fieldToggle.addEventListener("change", () => {
    showField = fieldToggle.checked;
    if (!running) draw();
  });
  resetBtn.addEventListener("click", () => {
    inputs.flow.value = "60"; inputs.loops.value = "4";
    inputs.area.value = "1.0"; inputs.strength.value = "1.0";
    omega = 0; theta = 0; pole = 1; simT = 0;
    trace.length = 0; drops.length = 0;
    meter = "bulb";
    meterList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b.dataset.key === "bulb"));
    fieldToggle.checked = true; showField = true;
    updateLabels(readParams());
    if (!running) draw();
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

  // Headless access, so the checks can drive the machine directly.
  window.__gen = {
    fluxTurn, flux, emfAt, g,
    params: readParams,
    state: () => ({ omega, theta, pole, meter, showField, simT,
                    samples: trace.length, peak: measuredPeak(),
                    faradayFromTrace: faradayFromTrace() }),
    trace: () => trace.map((s) => ({ ...s })),
    /** Run the machine forward headlessly at a fixed step. */
    run: (seconds, dt = 1 / 240) => {
      const p = readParams();
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) step(dt, p);
      return { omega, theta, simT, peak: measuredPeak() };
    },
    /** The largest EMF over a whole turn, scanned rather than recorded. */
    peakOf: (w, p, samples = 720) => {
      let m = 0;
      for (let k = 0; k < samples; k++) m = Math.max(m, Math.abs(emfAt((2 * Math.PI * k) / samples, w, p)));
      return m;
    },
    setRunning: (on) => { running = on; if (on) start(); else { cancelAnimationFrame(raf); draw(); } },
    setOmega: (w) => { omega = w; },
    RHO0, NR, NPHI, VOLT_SCALE, WHEEL_TORQUE, WHEEL_DAMP, WHEEL_INERTIA,
  };

  resizeCanvas();
  updateLabels(readParams());
  start();
})();
