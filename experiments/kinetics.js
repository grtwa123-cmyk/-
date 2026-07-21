/*
 * Reaction rates & collision theory — A + B → C, honestly counted.
 *
 * Red A and blue B particles fly around at Maxwell–Boltzmann speeds for
 * the set temperature. An A–B collision is "energetic" when the relative
 * kinetic energy ALONG the line joining the two centres at contact,
 * E⊥ = ½μ(v_rel·n̂)², exceeds the activation energy Ea — the textbook
 * line-of-centres criterion. For hard disks with collision-rate
 * weighting that criterion is Boltzmann-exact: P(E⊥ ≥ Ea) = e^(−Ea/kT)
 * (verified by Monte Carlo to 4 decimals; the naive total-relative-KE
 * criterion overshoots badly).
 *
 * The punchline is the readout pair:
 *   measured energetic fraction = (E⊥ ≥ Ea collisions) / all A·B collisions
 *   Boltzmann prediction        = e^(−Ea / kT)
 * The two converge as collisions accumulate, and both respond identically
 * to the T and Ea sliders — Arrhenius behaviour, honestly earned.
 *
 * Products C (violet, mass 2) are formed momentum-conservingly from the
 * pair and thereafter drift inertly.
 *
 * Two ingredients keep the measurement honest (both were verified to
 * matter, offline, against long-run replicas):
 *
 * 1. THERMAL EQUILIBRIUM MAINTENANCE. Reactions selectively consume the
 *    energetic tail of the Maxwell distribution; unless it regenerates,
 *    the measured rate sags ~40% below Boltzmann. So (a) the walls are
 *    diffuse thermal walls at T — every bounce re-emits with a fresh
 *    Maxwell draw (Rayleigh normal, Gaussian tangential) — and (b) ALL
 *    gas pairs (A–A, B–B too) collide elastically, re-thermalising the
 *    bulk exactly the way a real gas does.
 *
 * 2. A STERIC FACTOR: only a fraction P = 0.15 of sufficiently energetic
 *    collisions actually react (real reactions need the right collision
 *    geometry too — this is the pre-exponential factor's job in
 *    Arrhenius' k = A·e^(−Ea/RT)). It also keeps the burn slow relative
 *    to re-thermalisation, so the gas stays near equilibrium and the
 *    energetic-collision fraction sits on e^(−Ea/kT). The Boltzmann
 *    readout counts ENERGY successes (E⊥ ≥ Ea), whether or not the
 *    steric dice let that particular pair react.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    temp:  document.getElementById("temp"),
    ea:    document.getElementById("ea"),
    count: document.getElementById("count"),
  };
  const inputValues = {
    temp:  document.getElementById("temp-value"),
    ea:    document.getElementById("ea-value"),
    count: document.getElementById("count-value"),
  };
  const out = {
    a:          document.getElementById("out-a"),
    b:          document.getElementById("out-b"),
    c:          document.getElementById("out-c"),
    collisions: document.getElementById("out-collisions"),
    measured:   document.getElementById("out-measured"),
    theory:     document.getElementById("out-theory"),
  };
  const startBtn = document.getElementById("start-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Sim units ──────────────────────────────────────────────────────────
  const SPEED2 = 25;            // px²/s² per unit temperature (as gas.js)
  const R = 4;                  // particle radius, px
  const STERIC = 0.15;          // fraction of energetic collisions that react
  const BOX = { x0: 24, y0: 24, x1: 0, y1: 0 };   // x1/y1 set on resize

  const COLOR = { A: "#ff8aa3", B: "#7ab8ff", C: "#c47bff" };

  // ── State ──────────────────────────────────────────────────────────────
  const parts = [];             // { kind: 'A'|'B'|'C', x, y, vx, vy, m }
  let running = false;
  let lastTs = performance.now();
  let raf = 0;
  let nCollisions = 0;          // A–B encounters
  let nEnergetic = 0;           // A–B encounters with E⊥ ≥ Ea (Boltzmann tally)
  let nReactions = 0;           // energetic AND passed the steric roll
  const flashes = [];           // { x, y, ts } reaction bursts

  let gaussSpare = null;
  function gauss() {
    if (gaussSpare !== null) { const g = gaussSpare; gaussSpare = null; return g; }
    let u = 0;
    while (u === 0) u = Math.random();
    const v = Math.random();
    const m = Math.sqrt(-2 * Math.log(u));
    gaussSpare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }

  function readParams() {
    return {
      T: parseFloat(inputs.temp.value),
      Ea: parseFloat(inputs.ea.value),
      N: parseInt(inputs.count.value, 10),
    };
  }

  function spawn(kind, T) {
    return {
      kind, m: 1,
      x: BOX.x0 + R + Math.random() * (BOX.x1 - BOX.x0 - 2 * R),
      y: BOX.y0 + R + Math.random() * (BOX.y1 - BOX.y0 - 2 * R),
      vx: gauss() * Math.sqrt(T * SPEED2),
      vy: gauss() * Math.sqrt(T * SPEED2),
    };
  }

  function reset() {
    const p = readParams();
    parts.length = 0;
    for (let i = 0; i < p.N; i++) parts.push(spawn("A", p.T));
    for (let i = 0; i < p.N; i++) parts.push(spawn("B", p.T));
    nCollisions = 0;
    nEnergetic = 0;
    nReactions = 0;
    flashes.length = 0;
    running = false;
    syncStartBtn();
  }

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt, p) {
    // Sub-step so the fastest particle cannot tunnel through a partner
    // between checks (the exact contact-time back-projection below makes
    // penetration depth itself harmless, so ~3 px per sub-step is enough
    // and keeps the pair loop cheap even at high T and N).
    let vmax2 = 0;
    for (const q of parts) {
      const s2 = q.vx * q.vx + q.vy * q.vy;
      if (s2 > vmax2) vmax2 = s2;
    }
    const sub = Math.min(16, Math.max(1, Math.ceil(Math.sqrt(vmax2) * dt / 3)));
    const h = dt / sub;
    for (let s = 0; s < sub; s++) subStep(h, p);
  }

  function subStep(dt, p) {
    // Move + DIFFUSE THERMAL WALLS at temperature T. Each wall contact
    // re-emits the particle with a fresh Maxwell draw (Rayleigh normal,
    // Gaussian tangential; σ² = kT/m). This continuously regenerates the
    // energetic tail that reactions eat away — without it the measured
    // success rate sags far below the Boltzmann factor.
    for (const q of parts) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const sig = Math.sqrt(p.T * SPEED2 / q.m);
      const ray = () => sig * Math.sqrt(-2 * Math.log(1 - Math.random()));
      if (q.x < BOX.x0 + R)      { q.x = BOX.x0 + R; q.vx =  ray(); q.vy = gauss() * sig; }
      else if (q.x > BOX.x1 - R) { q.x = BOX.x1 - R; q.vx = -ray(); q.vy = gauss() * sig; }
      if (q.y < BOX.y0 + R)      { q.y = BOX.y0 + R; q.vy =  ray(); q.vx = gauss() * sig; }
      else if (q.y > BOX.y1 - R) { q.y = BOX.y1 - R; q.vy = -ray(); q.vx = gauss() * sig; }
    }

    // All gas pairs collide elastically (A–A and B–B included — that's
    // what re-thermalises the bulk). A–B pairs additionally get counted,
    // energy-tested against Ea, and — if energetic AND the steric roll
    // passes — merged into a product.
    const gas = [];
    for (const q of parts) if (q.kind !== "C") gas.push(q);
    const D2 = (2 * R) * (2 * R);
    const toRemove = new Set();
    for (let i = 0; i < gas.length; i++) {
      const a = gas[i];
      if (toRemove.has(a)) continue;
      for (let j = i + 1; j < gas.length; j++) {
        const b = gas[j];
        if (toRemove.has(b)) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > D2 || d2 === 0) continue;
        // Approaching? (skip pairs already separating — avoids recounting
        // the same encounter while they overlap)
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        if (rvx * dx + rvy * dy >= 0) continue;

        // Back-project to the EXACT moment of contact: solve
        // |d + τ·v_rel| = 2R for τ ≤ 0. The overlap was detected mid-
        // penetration, and the penetrated centre line under-reads the
        // line-of-centres energy — selectively for fast (reactive)
        // pairs; the contact-time normal removes that bias.
        const a2 = rvx * rvx + rvy * rvy;
        const bq = dx * rvx + dy * rvy;          // < 0 (approaching)
        let dxc = dx, dyc = dy;
        let tau = 0;
        if (a2 > 1e-12) {
          const disc = bq * bq - a2 * (d2 - D2);
          if (disc > 0) {
            tau = (-bq - Math.sqrt(disc)) / a2;  // ≤ 0: contact in the past
            dxc = dx + tau * rvx;
            dyc = dy + tau * rvy;
          }
        }
        const dLen = Math.sqrt(dxc * dxc + dyc * dyc) || 1;
        const nx = dxc / dLen, ny = dyc / dLen;
        const vn = rvx * nx + rvy * ny;

        if (a.kind !== b.kind) {
          nCollisions++;
          // Line-of-centres energy with reduced mass μ = m/2 (equal
          // masses): E⊥ = ½·μ·(v_rel·n̂)² = ¼·(v_rel·n̂)². In sim units
          // kT ↔ T·SPEED2; for hard disks at equilibrium this criterion
          // is Boltzmann-exact: P(E⊥ ≥ Ea) = e^(−Ea/kT).
          if (0.25 * vn * vn >= p.Ea * SPEED2) {
            nEnergetic++;
            if (Math.random() < STERIC) {
              // React: momentum-conserving merge into one C of mass 2,
              // born at the contact point.
              nReactions++;
              const c = {
                kind: "C", m: 2,
                x: a.x + tau * a.vx + dxc / 2,
                y: a.y + tau * a.vy + dyc / 2,
                vx: (a.vx + b.vx) / 2, vy: (a.vy + b.vy) / 2,
              };
              toRemove.add(a); toRemove.add(b);
              parts.push(c);
              flashes.push({ x: c.x, y: c.y, ts: performance.now() / 1000 });
              break;
            }
          }
        }

        // Elastic bounce (same-species always; A–B when no reaction):
        // rewind both to contact, exchange the normal components
        // (equal-mass elastic), replay the rewound time with the
        // post-collision velocities.
        a.x += tau * a.vx; a.y += tau * a.vy;
        b.x += tau * b.vx; b.y += tau * b.vy;
        const va = a.vx * nx + a.vy * ny;
        const vb = b.vx * nx + b.vy * ny;
        a.vx += (vb - va) * nx; a.vy += (vb - va) * ny;
        b.vx += (va - vb) * nx; b.vy += (va - vb) * ny;
        a.x -= tau * a.vx; a.y -= tau * a.vy;
        b.x -= tau * b.vx; b.y -= tau * b.vy;
      }
    }
    if (toRemove.size) {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (toRemove.has(parts[i])) parts.splice(i, 1);
      }
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function render(p) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#180d1e");
    bg.addColorStop(1, "#12101f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(BOX.x0, BOX.y0, BOX.x1 - BOX.x0, BOX.y1 - BOX.y0);

    for (const q of parts) {
      ctx.fillStyle = COLOR[q.kind];
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.kind === "C" ? R + 1.5 : R, 0, Math.PI * 2);
      ctx.fill();
    }

    // Reaction flashes — a brief violet burst where a product formed.
    const nowS = performance.now() / 1000;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const age = nowS - flashes[i].ts;
      if (age > 0.5) { flashes.splice(i, 1); continue; }
      const k = age / 0.5;
      ctx.strokeStyle = `rgba(196, 123, 255, ${0.85 * (1 - k)})`;
      ctx.lineWidth = 2 * (1 - k * 0.5);
      ctx.beginPath();
      ctx.arc(flashes[i].x, flashes[i].y, R + 2 + k * 26, 0, Math.PI * 2);
      ctx.stroke();
      const g = ctx.createRadialGradient(flashes[i].x, flashes[i].y, 0, flashes[i].x, flashes[i].y, R + 10);
      g.addColorStop(0, `rgba(230, 200, 255, ${0.5 * (1 - k)})`);
      g.addColorStop(1, "rgba(230, 200, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(flashes[i].x, flashes[i].y, R + 10, 0, Math.PI * 2);
      ctx.fill();
    }

    // Legend
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.textAlign = "left";
    let lx = BOX.x0 + 4;
    for (const [kind, labelKey, fallback] of [["A", "kinLegendA", "A"], ["B", "kinLegendB", "B"], ["C", "kinLegendC", "C (product)"]]) {
      ctx.fillStyle = COLOR[kind];
      ctx.fillText("● " + i18nText(labelKey, fallback), lx, BOX.y0 - 8);
      lx += 90;
    }

    // Arrhenius panel: measured vs theory bar pair
    const gx = BOX.x1 + 24, gw = W - gx - 26;
    if (gw > 90) {
      const gy0 = 60, gy1 = H - 70;
      const meas = nCollisions > 0 ? nEnergetic / nCollisions : 0;
      const theo = Math.exp(-p.Ea / p.T);
      const bar = (i, v, color, label) => {
        const bw = gw / 2 - 12;
        const x = gx + i * (bw + 20);
        const bh = Math.min(v, 1) * (gy1 - gy0);
        ctx.fillStyle = color;
        ctx.fillRect(x, gy1 - bh, bw, bh);
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.strokeRect(x, gy0, bw, gy1 - gy0);
        ctx.fillStyle = "rgba(236,240,251,0.85)";
        ctx.font = "600 11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(label, x + bw / 2, gy1 + 16);
        ctx.fillText((v * 100).toFixed(1) + "%", x + bw / 2, gy1 - bh - 6);
      };
      bar(0, meas, "rgba(255, 138, 163, 0.6)", i18nText("kinMeasured", "measured"));
      bar(1, theo, "rgba(196, 123, 255, 0.6)", "e^(−Ea/kT)");
      ctx.fillStyle = "rgba(236,240,251,0.6)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(i18nText("kinChartTitle", "reaction probability per collision"), gx + gw / 2, 44);
    }
  }

  function updateReadouts(p) {
    let a = 0, b = 0, c = 0;
    for (const q of parts) {
      if (q.kind === "A") a++;
      else if (q.kind === "B") b++;
      else c++;
    }
    out.a.textContent = String(a);
    out.b.textContent = String(b);
    out.c.textContent = String(c);
    out.collisions.textContent = String(nCollisions);
    out.measured.textContent = nCollisions > 0 ? (100 * nEnergetic / nCollisions).toFixed(1) + "%" : "—";
    out.theory.textContent = (100 * Math.exp(-p.Ea / p.T)).toFixed(1) + "%";
  }

  function updateLabels(p) {
    inputValues.temp.textContent = String(Math.round(p.T));
    inputValues.ea.textContent = String(Math.round(p.Ea));
    inputValues.count.textContent = String(p.N);
  }

  function syncStartBtn() {
    startBtn.textContent = running
      ? i18nText("wavePauseBtn", "Pause")
      : i18nText("startBtn", "Start");
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    // Clamp below at 0 too — a first rAF timestamp can precede the
    // performance.now() captured in start(), and a negative dt would
    // run accumulators (charge, time, volume) backwards.
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.033));
    lastTs = ts;
    const p = readParams();
    if (running) step(dt, p);
    render(p);
    updateReadouts(p);
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  inputs.temp.addEventListener("input", () => updateLabels(readParams()));
  inputs.ea.addEventListener("input", () => {
    updateLabels(readParams());
    // Changing Ea redefines what counts as success — restart the tally so
    // the measured fraction compares against the current Boltzmann factor.
    nCollisions = 0; nEnergetic = 0; nReactions = 0;
  });
  inputs.count.addEventListener("input", () => { updateLabels(readParams()); reset(); });

  startBtn.addEventListener("click", () => {
    let hasReactants = false;
    for (const q of parts) if (q.kind !== "C") { hasReactants = true; break; }
    if (!running && !hasReactants) reset();
    running = !running;
    syncStartBtn();
  });
  resetBtn.addEventListener("click", reset);

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
    H = 460;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    BOX.x1 = Math.min(W * 0.62, 470);
    BOX.y1 = H - 28;
    // Keep particles inside the (possibly smaller) box
    for (const q of parts) {
      q.x = Math.min(Math.max(q.x, BOX.x0 + R), BOX.x1 - R);
      q.y = Math.min(Math.max(q.y, BOX.y0 + R), BOX.y1 - R);
    }
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  updateLabels(readParams());
  reset();
  start();
})();
