/*
 * Galvanic Cell — the simulation behind experiments/redox.html.
 *
 * Two metals in solutions of their own ions, joined by a wire and a salt
 * bridge. The more easily oxidised one dissolves, the other plates out, and
 * the electrons go the long way round through the load. It is electrolysis
 * run backwards: there, current is forced through to drive a reaction that
 * would not go; here, a reaction that wants to go drives the current.
 *
 * WHERE THE VOLTAGE COMES FROM
 * ----------------------------
 * Not from the Nernst equation. Nothing in this file writes it down.
 *
 * Each electrode is given Butler-Volmer kinetics — the rate of the forward
 * and reverse half-reactions, each with a Boltzmann factor for the part of
 * the electrode potential that helps or hinders it. With the symmetry factor
 * at one half, the anodic-positive current density is
 *
 *     i / i₀ = exp(+u/2) − c · exp(−u/2),    u = zF(E − E°)/RT,  c = [Mᶻ⁺]/C°
 *
 * where the metal is a solid at unit activity so only the reduction term
 * carries a concentration. That is a quadratic in x = exp(u/2), so the
 * potential at a given current comes out in closed form rather than by
 * iteration:
 *
 *     x = ( i/i₀ + √( (i/i₀)² + 4c ) ) / 2,   E = E° + (2RT/zF)·ln x
 *
 * Set i = 0 and it collapses to E = E° + (RT/zF)·ln c, which is the Nernst
 * equation. The page never asserts it; it falls out of asking what potential
 * makes the two directions of the reaction run at the same rate. Push the
 * current far the other way instead and the same expression becomes Tafel's,
 * with a slope of 2·2.303RT/zF per decade. One mechanism, both laws.
 *
 * The two electrodes are then joined by a circuit: whatever current leaves
 * one must arrive at the other, and the terminal voltage it produces must
 * equal that current times the load. One bisection per frame closes the loop.
 *
 * WHAT THE CELL DOES TO ITSELF
 * ----------------------------
 * Charge that passes is metal that moved: dn = I·dt/(zF) at each electrode,
 * by Faraday. Anode ions accumulate, cathode ions are consumed, and the
 * concentrations feed straight back into the two potentials — so the cell
 * runs down on its own, and a concentration cell (same metal both sides)
 * closes the gap between its two beakers and quietly stops.
 *
 * The verification that all of this reproduces the closed forms is in
 * tests/experiments/redox.test.mjs, which measures them off the running page.
 */
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const R_GAS = 8.314462618;      // J K⁻¹ mol⁻¹
  const FARADAY = 96485.33212;    // C mol⁻¹

  /*
   * Standard reduction potentials, V vs the standard hydrogen electrode at
   * 25 °C, with molar masses and densities for the mass and thickness
   * readouts. i0 is the exchange current density in A m⁻², the one number
   * here that is a plausible order of magnitude rather than a measured
   * constant: real values depend on the surface, the electrolyte and the age
   * of the electrode, and range over decades for the same metal. It sets how
   * hard the cell sags under load, not where it sits at rest.
   */
  const METALS = {
    Mg: { z: 2, E0: -2.372, M: 24.305, rho: 1738, i0: 0.5,  ion: 'Mg²⁺', color: '#c7d0e0' },
    Zn: { z: 2, E0: -0.7618, M: 65.38, rho: 7140, i0: 20,   ion: 'Zn²⁺', color: '#9fb0c4' },
    Fe: { z: 2, E0: -0.447, M: 55.845, rho: 7874, i0: 5,    ion: 'Fe²⁺', color: '#a08f7d' },
    Ni: { z: 2, E0: -0.257, M: 58.693, rho: 8908, i0: 2,    ion: 'Ni²⁺', color: '#b9c4a8' },
    Sn: { z: 2, E0: -0.1375, M: 118.71, rho: 7265, i0: 20,  ion: 'Sn²⁺', color: '#cfd6dd' },
    Pb: { z: 2, E0: -0.1262, M: 207.2, rho: 11342, i0: 50,  ion: 'Pb²⁺', color: '#8f95a3' },
    Cu: { z: 2, E0: 0.3419, M: 63.546, rho: 8960, i0: 30,   ion: 'Cu²⁺', color: '#e08a5a' },
    Ag: { z: 1, E0: 0.7996, M: 107.868, rho: 10490, i0: 200, ion: 'Ag⁺',  color: '#dfe6ef' },
  };

  const AREA = 4e-4;      // m² of electrode facing the solution
  const VOL_L = 1e-3;     // litres in each half-cell — a small cell, so it runs
  const R_SOL = 5;        // Ω through the solution and the salt bridge

  const el = (id) => document.getElementById(id);
  const anodeSel = el('anode'), cathodeSel = el('cathode');
  const cAnodeIn = el('c-anode'), cCathodeIn = el('c-cathode');
  const tempIn = el('temperature'), loadIn = el('load'), speedIn = el('speed');
  const pauseBtn = el('pause-btn'), resetBtn = el('reset-btn');

  const i18nText = (k, f) => (window.i18n && window.i18n.t(k)) || f;

  let paused = false;
  let state = null;
  let animId = null, lastTs = 0;

  /** Load resistance in ohms, or Infinity for the voltmeter's open circuit. */
  function loadOhms() {
    const v = parseFloat(loadIn.value);
    return v >= 4 ? Infinity : Math.pow(10, v);   // slider is log₁₀(R), top notch = open
  }

  function readControls() {
    return {
      A: anodeSel.value, B: cathodeSel.value,
      cA0: Math.pow(10, parseFloat(cAnodeIn.value)),
      cB0: Math.pow(10, parseFloat(cCathodeIn.value)),
      T: parseFloat(tempIn.value) + 273.15,
      R: loadOhms(),
      speed: parseFloat(speedIn.value),
    };
  }

  /**
   * The electrode potential that carries this current density, in volts vs
   * SHE. `iRel` is i/i₀, positive when the metal is dissolving.
   */
  function electrodePotential(metal, C, T, iRel) {
    const x = (iRel + Math.sqrt(iRel * iRel + 4 * Math.max(C, 1e-12))) / 2;
    return metal.E0 + (2 * R_GAS * T / (metal.z * FARADAY)) * Math.log(x);
  }

  /**
   * Close the circuit. Returns the current the loop settles at and the
   * voltage across the terminals with it flowing.
   *
   * A voltmeter is an open circuit, not a very large resistor: reading it as
   * a gigaohm still draws a nanoamp, and the nanoamp still costs a little
   * overpotential, so the reading would not quite be the rest potential.
   */
  function solveCircuit(st) {
    const a = METALS[st.A], b = METALS[st.B];
    const emf = (I) =>
      electrodePotential(b, st.cB, st.T, -I / (AREA * b.i0))
      - electrodePotential(a, st.cA, st.T, I / (AREA * a.i0));

    if (!Number.isFinite(st.R)) return { I: 0, V: emf(0), emf: emf(0) };

    const f = (I) => emf(I) - I * (st.R + R_SOL);
    if (f(0) <= 0) return { I: 0, V: emf(0), emf: emf(0) };
    let lo = 0, hi = 1e-9;
    while (f(hi) > 0 && hi < 1e4) hi *= 2;
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid; else hi = mid;
    }
    const I = (lo + hi) / 2;
    return { I, V: emf(I) - I * R_SOL, emf: emf(I) };
  }

  /** E°cell and the reaction quotient, for the panel — reported, not used. */
  function thermo(st) {
    const a = METALS[st.A], b = METALS[st.B];
    const n = a.z * b.z;                      // electrons per cell reaction
    const Q = Math.pow(st.cA, b.z) / Math.pow(st.cB, a.z);
    return { n, Q, E0: b.E0 - a.E0 };
  }

  function build() {
    const c = readControls();
    const st = {
      ...c, cA: c.cA0, cB: c.cB0,
      t: 0, charge: 0, nA: 0, nB: 0,
      trace: [], ions: [], electrons: [], sparks: [],
    };
    const a = METALS[st.A], b = METALS[st.B];
    for (let i = 0; i < 34; i++) {
      st.ions.push({ side: 0, x: Math.random(), y: Math.random(), v: Math.random(), el: a.ion });
      st.ions.push({ side: 1, x: Math.random(), y: Math.random(), v: Math.random(), el: b.ion });
    }
    for (let i = 0; i < 26; i++) st.electrons.push({ u: i / 26 });
    return st;
  }

  // ── the step ────────────────────────────────────────────────────────────
  function advance(st, dt) {
    const a = METALS[st.A], b = METALS[st.B];
    const sol = solveCircuit(st);
    st.I = sol.I; st.V = sol.V;

    if (sol.I > 0 && dt > 0) {
      const dq = sol.I * dt;
      // Faraday, at each electrode in its own charge number. Nothing else in
      // the file moves metal; the pictures are drawn from these two numbers.
      const dnA = dq / (a.z * FARADAY);
      const dnB = dq / (b.z * FARADAY);
      const roomB = Math.max(0, st.cB - 1e-9) * VOL_L;
      const useB = Math.min(dnB, roomB);
      const scale = dnB > 0 ? useB / dnB : 0;
      st.charge += dq * scale;
      st.nA += dnA * scale;
      st.nB += dnB * scale;
      st.cA += (dnA * scale) / VOL_L;
      st.cB -= useB / VOL_L;
      if (st.cB < 1e-9) st.cB = 1e-9;
    }

    st.t += dt;
    if (st.trace.length === 0 || st.t - st.trace[st.trace.length - 1].t > 0.25) {
      st.trace.push({ t: st.t, V: st.V, I: st.I });
      if (st.trace.length > 1400) st.trace.shift();
    }

    // The animation only: dots that move because current is flowing.
    const flow = Math.min(1, st.I / 0.05);
    for (const e of st.electrons) { e.u = (e.u + flow * dt * 0.35) % 1; }
    for (const q of st.ions) {
      q.v += (Math.random() - 0.5) * dt * 0.6;
      q.v = Math.max(-1, Math.min(1, q.v));
      q.y += q.v * dt * 0.05;
      if (q.y < 0.02) { q.y = 0.02; q.v = Math.abs(q.v); }
      if (q.y > 0.98) { q.y = 0.98; q.v = -Math.abs(q.v); }
      q.x += (q.side === 0 ? -1 : 1) * flow * dt * 0.04 * (0.4 + Math.random() * 0.6);
      if (q.x < 0.04) q.x += 0.9;
      if (q.x > 0.96) q.x -= 0.9;
    }
  }

  // ── drawing ─────────────────────────────────────────────────────────────
  const CW = () => canvas.width / (window.devicePixelRatio || 1);
  const CH = () => canvas.height / (window.devicePixelRatio || 1);

  /*
   * Fixed colours, and the canvas paints its own ground, as the other
   * chemistry stages do. Reading --text off the document instead looked
   * tidier and was wrong: the stage stays dark in both themes, so in the
   * light one the labels came out dark ink on a dark beaker and the whole
   * voltmeter went invisible.
   */
  const INK = '#ecf0fb';
  const DIM = '#97a0bf';
  const LINE = 'rgba(236, 240, 251, 0.22)';

  /*
   * One layout object, so the bands cannot drift into each other. The first
   * attempt computed each piece from the canvas height where it stood, and
   * the metal names ended up behind the voltmeter while the voltage trace ran
   * straight through the concentration captions.
   */
  function layout() {
    const w = CW(), h = CH();
    const bw = Math.max(120, Math.min(230, (w - 150) / 2.3));
    return {
      w, h, bw,
      leftX: 56, rightX: w - 56 - bw,
      wireY: 40,                 // the wire across the top
      postTop: 66,               // where the electrodes leave the solution
      nameY: 132,                // metal name, above its beaker
      beakerTop: 146, beakerBot: h - 150,
      bridgeY: 168,              // the salt bridge dips to here
      ionY: h - 136, capY: h - 120,
      traceTop: h - 96, traceBot: h - 20,
    };
  }

  function draw() {
    const st = state;
    const L = layout();
    const bg = ctx.createLinearGradient(0, 0, 0, L.h);
    bg.addColorStop(0, '#06150f');
    bg.addColorStop(1, '#0b1a22');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, L.w, L.h);
    const a = METALS[st.A], b = METALS[st.B];
    const ink = INK, muted = DIM, line = LINE;

    const lc = L.leftX + L.bw / 2, rc = L.rightX + L.bw / 2;

    // ── the wire, the meter, the electrons ──
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lc, L.postTop); ctx.lineTo(lc, L.wireY);
    ctx.lineTo(rc, L.wireY); ctx.lineTo(rc, L.postTop);
    ctx.stroke();

    if (st.I > 1e-9) {
      ctx.fillStyle = '#6ea8ff';
      const up = L.postTop - L.wireY, across = rc - lc, total = up + across + up;
      for (const e of st.electrons) {
        const d = e.u * total;
        let px, py;
        if (d < up) { px = lc; py = L.postTop - d; }
        else if (d < up + across) { px = lc + (d - up); py = L.wireY; }
        else { px = rc; py = L.wireY + (d - up - across); }
        ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }

    const mx = L.w / 2;
    ctx.fillStyle = 'rgba(8, 20, 26, 0.95)';
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(mx - 66, L.wireY - 25, 132, 50, 12);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.font = '600 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`${st.V.toFixed(3)} V`, mx, L.wireY - 6);
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.fillText(Number.isFinite(st.R)
      ? (st.I >= 0.001 ? (st.I * 1000).toFixed(1) + ' mA' : (st.I * 1e6).toFixed(0) + ' \u00b5A')
      : i18nText('rxOpenCircuit', 'open circuit'), mx, L.wireY + 12);

    // ── the salt bridge, dipping into both solutions ──
    const bl = L.leftX + L.bw - 26, br = L.rightX + 26;
    ctx.strokeStyle = line;
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(bl, L.bridgeY + 34);
    ctx.lineTo(bl, L.bridgeY);
    ctx.lineTo(br, L.bridgeY);
    ctx.lineTo(br, L.bridgeY + 34);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.fillText(i18nText('rxSaltBridge', 'salt bridge'), (bl + br) / 2, L.bridgeY - 12);

    drawHalf(L, L.leftX, a, st.cA, st.A, true, st, ink, muted);
    drawHalf(L, L.rightX, b, st.cB, st.B, false, st, ink, muted);
    drawTrace(L, st, muted);
  }

  function drawHalf(L, x, metal, C, name, isAnode, st, ink, muted) {
    const ex = x + L.bw / 2;
    // The electrode thickens or thins with the metal that has actually moved.
    const moved = (isAnode ? -st.nA : st.nB) * metal.M;       // grams, signed
    const ew = Math.max(5, Math.min(26, 15 + moved * 90));

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, L.beakerTop); ctx.lineTo(x, L.beakerBot);
    ctx.lineTo(x + L.bw, L.beakerBot); ctx.lineTo(x + L.bw, L.beakerTop);
    ctx.stroke();

    // Solution, tinted by how much ion is dissolved in it.
    const surface = L.beakerTop + 20;
    ctx.globalAlpha = Math.max(0.07, Math.min(0.46, 0.08 + 0.4 * (Math.log10(C) + 4) / 4.3));
    ctx.fillStyle = metal.color;
    ctx.fillRect(x + 1, surface, L.bw - 2, L.beakerBot - surface - 1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 1, surface); ctx.lineTo(x + L.bw - 1, surface); ctx.stroke();

    // Ions, avoiding the metal they are about to land on.
    for (const q of st.ions) {
      if ((q.side === 0) !== isAnode) continue;
      const px = x + 10 + q.x * (L.bw - 20);
      const py = surface + 10 + q.y * (L.beakerBot - surface - 20);
      if (Math.abs(px - ex) < ew / 2 + 3) continue;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = metal.color;
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = metal.color;
    ctx.fillRect(ex - ew / 2, L.postTop, ew, L.beakerBot - 16 - L.postTop);
    ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ex - ew / 2, L.postTop, ew, L.beakerBot - 16 - L.postTop);

    // Left-aligned at the beaker's edge, not centred: centred puts it on top
    // of the electrode, which is a pale metal bar, and the name disappeared.
    ctx.textAlign = 'left';
    ctx.fillStyle = ink;
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(`${name} ${isAnode ? '(\u2212)' : '(+)'}`, x + 2, L.nameY);
    ctx.textAlign = 'center';
    ctx.font = '500 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = muted;
    ctx.fillText(`${metal.ion}  ${C < 0.001 ? C.toExponential(1) : C.toFixed(4)} M`, ex, L.ionY);
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(isAnode ? i18nText('rxAnodeCap', 'oxidation \u2014 loses electrons')
                         : i18nText('rxCathodeCap', 'reduction \u2014 gains electrons'), ex, L.capY);
  }

  function drawTrace(L, st, muted) {
    const x0 = L.leftX, x1 = L.w - L.leftX;
    ctx.textAlign = 'left';
    ctx.fillStyle = muted;
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(i18nText('rxTraceCap', 'cell voltage over time'), x0, L.traceTop - 4);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, L.traceBot); ctx.lineTo(x1, L.traceBot); ctx.stroke();
    if (st.trace.length < 2) return;
    const vmax = Math.max(0.05, ...st.trace.map((p) => p.V)) * 1.18;
    const t0 = st.trace[0].t, t1 = Math.max(st.trace[st.trace.length - 1].t, t0 + 1);
    ctx.strokeStyle = '#6effc6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    st.trace.forEach((p, i) => {
      const px = x0 + (p.t - t0) / (t1 - t0) * (x1 - x0);
      const py = L.traceBot - (p.V / vmax) * (L.traceBot - L.traceTop);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillStyle = muted;
    ctx.fillText(vmax.toFixed(2) + ' V', x1, L.traceTop + 8);
  }

  // ── readouts ────────────────────────────────────────────────────────────
  function updateReadouts() {
    const st = state;
    const a = METALS[st.A], b = METALS[st.B];
    const th = thermo(st);
    const set = (id, v) => { const n = el(id); if (n) n.textContent = v; };
    set('out-voltage', st.V.toFixed(4));
    set('out-current', st.I >= 0.001 ? (st.I * 1000).toFixed(2) : (st.I * 1e6).toFixed(1));
    set('out-current-unit', st.I >= 0.001 ? 'mA' : 'µA');
    set('out-e0', th.E0.toFixed(4));
    set('out-q', th.Q < 0.001 || th.Q > 1000 ? th.Q.toExponential(2) : th.Q.toFixed(4));
    set('out-n', String(th.n));
    set('out-charge', st.charge.toFixed(3));
    set('out-anode-mass', (st.nA * a.M * 1000).toFixed(3));
    set('out-cathode-mass', (st.nB * b.M * 1000).toFixed(3));
    const dead = st.I <= 1e-12;
    set('out-state', !Number.isFinite(st.R)
      ? i18nText('rxStateOpen', 'At rest — no current drawn')
      : dead
        ? (th.E0 <= 0 && st.A !== st.B
            ? i18nText('rxStateBackwards', 'Wired backwards — nothing flows')
            : i18nText('rxStateSpent', 'Spent — the cell has run down'))
        : i18nText('rxStateRunning', 'Discharging'));
  }

  // ── loop ────────────────────────────────────────────────────────────────
  function step(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (!paused) advance(state, dt * state.speed);
    else { const s = solveCircuit(state); state.I = s.I; state.V = s.V; }
    draw();
    updateReadouts();
    animId = requestAnimationFrame(step);
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  function syncLabels() {
    el('c-anode-value').textContent = fmtC(Math.pow(10, parseFloat(cAnodeIn.value)));
    el('c-cathode-value').textContent = fmtC(Math.pow(10, parseFloat(cCathodeIn.value)));
    el('temperature-value').textContent = parseFloat(tempIn.value).toFixed(0);
    const r = loadOhms();
    el('load-value').textContent = Number.isFinite(r)
      ? (r >= 1000 ? (r / 1000).toFixed(r >= 10000 ? 0 : 1) + ' kΩ' : r.toFixed(r < 10 ? 1 : 0) + ' Ω')
      : i18nText('rxOpen', 'open');
    el('speed-value').textContent = '×' + parseFloat(speedIn.value).toFixed(0);
  }
  const fmtC = (c) => (c >= 0.01 ? c.toFixed(c >= 0.1 ? 2 : 3) : c.toExponential(0));

  function restart() {
    state = build();
    syncLabels();
    advance(state, 0);
    draw();
    updateReadouts();
  }

  function softApply() {
    // Metals and concentrations restart the cell; temperature and load do not
    // — turning the dial on a running battery does not empty the beakers.
    const c = readControls();
    state.T = c.T; state.R = c.R; state.speed = c.speed;
    syncLabels();
    advance(state, 0);
    updateReadouts();
  }

  for (const n of [anodeSel, cathodeSel, cAnodeIn, cCathodeIn]) {
    n.addEventListener('input', restart);
    n.addEventListener('change', restart);
  }
  for (const n of [tempIn, loadIn, speedIn]) n.addEventListener('input', softApply);

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? i18nText('waveResumeBtn', 'Resume') : i18nText('wavePauseBtn', 'Pause');
    window.SFX?.tone({ freq: paused ? 300 : 520, dur: 0.07, type: 'triangle', gain: 0.1 });
  });
  resetBtn.addEventListener('click', () => { paused = false;
    pauseBtn.textContent = i18nText('wavePauseBtn', 'Pause'); restart(); });

  document.addEventListener('langchange', () => { syncLabels(); updateReadouts(); draw(); });

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width));
    const h = 510;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state) draw();
  }
  window.addEventListener('resize', resize);

  if (window.CSVExport) {
    window.CSVExport.attach('csv-btn', () => {
      if (!state || state.trace.length < 2) return null;
      const th = thermo(state);
      return {
        name: 'galvanic-cell.csv',
        title: 'Galvanic cell — voltage against time',
        columns: ['t_s', 'cell_voltage_V', 'current_A'],
        rows: state.trace.map((p) => [p.t, p.V, p.I]),
        meta: {
          anode: state.A, cathode: state.B,
          anode_ion_M_start: state.cA0, cathode_ion_M_start: state.cB0,
          anode_ion_M_now: state.cA, cathode_ion_M_now: state.cB,
          temperature_K: state.T, load_ohm: Number.isFinite(state.R) ? state.R : 'open',
          solution_resistance_ohm: R_SOL, electrode_area_m2: AREA, half_cell_litres: VOL_L,
          standard_cell_potential_V: th.E0, electrons_n: th.n, reaction_quotient_Q: th.Q,
          charge_passed_C: state.charge,
          nernst_slope_mV_per_decade: 2.302585093 * R_GAS * state.T / FARADAY * 1000,
        },
      };
    });
  }

  resize();
  restart();
  animId = requestAnimationFrame(step);

  /*
   * The handle tests/experiments/redox.test.mjs measures the cell through.
   * Every number it returns is one the page itself computed or displayed —
   * nothing here works out an answer for the suite's benefit.
   */
  window.__redox = {
    metals: () => JSON.parse(JSON.stringify(METALS)),
    constants: () => ({ R: R_GAS, F: FARADAY, AREA, VOL_L, R_SOL }),
    /** Set the cell up and let it settle at rest, without discharging it. */
    set(cfg) {
      if (cfg.A) anodeSel.value = cfg.A;
      if (cfg.B) cathodeSel.value = cfg.B;
      if (cfg.cA !== undefined) cAnodeIn.value = String(Math.log10(cfg.cA));
      if (cfg.cB !== undefined) cCathodeIn.value = String(Math.log10(cfg.cB));
      if (cfg.T !== undefined) tempIn.value = String(cfg.T - 273.15);
      if (cfg.R !== undefined) loadIn.value = String(Number.isFinite(cfg.R) ? Math.log10(cfg.R) : 4);
      restart();
      return this.read();
    },
    /** Push the cell forward by `seconds` of its own time. */
    advance(seconds, steps = 200) {
      for (let i = 0; i < steps; i++) advance(state, seconds / steps);
      updateReadouts();
      return this.read();
    },
    read: () => ({
      A: state.A, B: state.B, cA: state.cA, cB: state.cB, T: state.T,
      R: Number.isFinite(state.R) ? state.R : null,
      V: state.V, I: state.I, charge: state.charge, nA: state.nA, nB: state.nB,
      ...thermo(state),
      shownVoltage: el('out-voltage').textContent,
      shownState: el('out-state').textContent,
    }),
    /** One electrode on its own, which is where the Nernst equation lives. */
    electrode: (name, C, T, iRel) => electrodePotential(METALS[name], C, T, iRel),
  };
})();
