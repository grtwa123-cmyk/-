/*
 * Chemotaxis — run and tumble. The simulation behind experiments/chemotaxis.html.
 *
 * A dish with an attractant that rises smoothly from the left edge to the
 * right, and a few hundred bacteria. Each one swims in a straight line at a
 * fixed speed and, every so often, stops and picks a new direction at random.
 * That is all a bacterium does. It cannot steer, and it cannot tell which way
 * the attractant lies: at its size, Brownian buffeting scrambles its heading
 * long before it could compare its front with its back.
 *
 * The one thing it can do is remember. It holds the concentration it felt a
 * moment ago and compares it with the concentration it feels now. If things
 * are getting better, it tumbles less often. One line:
 *
 *     rate = LAMBDA0 * max(0, 1 - beta * (cNow - cThen) / h)
 *
 * WHAT COMES OUT OF IT
 * --------------------
 * Five things, none of them written down anywhere in this file:
 *
 *   lambda(th) = lambda0 (1 - k cos th)     The tumble rate, sorted by the
 *                       angle between heading and gradient, is a straight
 *                       line in cos th — even though nothing here computes
 *                       an angle. lambda0 comes back as 1/tau and the slope
 *                       gives k = beta v / W.
 *
 *   <r2> = 2 v^2 tau^2 (t/tau - 1 + e^(-t/tau))
 *                       With no gradient. Short runs are ballistic, <r2> = v^2 t^2;
 *                       long ones diffuse, <r2> = 4Dt with D = v^2 tau / 2. The
 *                       one expression covers both and everything between.
 *
 *   rho(x) ~ e^(x/l)    Turn the gradient on and the population settles into
 *                       an exponential pile against the attractant side.
 *
 *   l = D / v_d         The pile-up length is the drift against the spreading,
 *                       with v_d = (v/k)(1 - sqrt(1 - k^2)) ~ v k / 2.
 *
 *   l = tau W / beta    Which, once k = beta v / W is put in, does not contain
 *                       the swimming speed at all. Swim three times as fast
 *                       and the cluster is exactly as tight — the faster cell
 *                       both drifts and spreads faster, in the same ratio.
 *
 * MEASURING THROUGH THE WALLS
 * ---------------------------
 * A reflecting wall is a mirror, so a walk that bounces off one is the folded
 * image of a walk that never met it. The dish is 716 x 260 and a cell covers
 * that in seconds, so the folded displacement saturates and reads 81% low by
 * t = 100 tau. Every cell therefore carries an unfolded position as well as a
 * real one: a pair of signs flips at each reflection, so sign * cos(theta)
 * runs on undisturbed. Measured that way <r2> tracks the closed form to 1%
 * over three decades. This is exact only while the tumble rate is blind to
 * direction, i.e. with the gradient off, which is the only case <r2> is
 * claimed for.
 *
 * It also explains why the graph barely moves when the memory is turned up.
 * Unfolding mirrors the dish, and it mirrors the attractant ramp with it, so
 * the unfolded cell is climbing a zigzag that goes up and down for ever and
 * drifts nowhere. The drift is real; it is just not in this graph. It is in
 * the histogram.
 *
 * The sub-step is fixed and decoupled from the frame rate, as in the
 * membrane-diffusion page: tau, D and l would otherwise all be properties of
 * the reader's monitor.
 */
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const el = (id) => document.getElementById(id);
  const countIn = el('count'), speedIn = el('swim'), runIn = el('runtime');
  const betaIn = el('beta'), simIn = el('sim-speed');
  const pauseBtn = el('pause-btn'), resetBtn = el('reset-btn');

  const i18nText = (k, f) => (window.i18n && window.i18n.t(k)) || f;

  /* Fixed colours on a ground this canvas paints itself — see CLAUDE.md. */
  const INK = '#ecf0fb';
  const DIM = '#97a0bf';
  const LINE = 'rgba(236, 240, 251, 0.22)';
  const CELL = '#7be0d0';
  const CELL_UP = '#ffd166';
  const BAR = '#7be0d0';
  const MEAS = '#7be0d0';
  const PRED = '#ff9f6e';
  const ASYM = 'rgba(236, 240, 251, 0.30)';

  /** The sub-step. tau, D and the drift all follow from this. */
  const H_STEP = 1 / 120;
  const DISH = { x: 42, y: 50, w: 716, h: 244 };
  const PROF = { y: 320, h: 44 };
  const PLOT = { x: 96, y: 396, w: 620, h: 86 };
  const NBIN = 16;
  const NCOS = 12;

  let paused = false, state = null, animId = null, lastTs = 0, acc = 0;

  const readControls = () => ({
    n: parseInt(countIn.value, 10),
    v: parseFloat(speedIn.value),
    tau: parseFloat(runIn.value),
    beta: parseFloat(betaIn.value),
    sim: parseFloat(simIn.value),
  });

  /**
   * The attractant. Zero at the left edge, one at the right, straight in
   * between. A cell never sees this function — it only ever sees the number
   * it returns, here and a sub-step ago.
   */
  const conc = (x) => (x - DISH.x) / DISH.w;

  function build() {
    const c = readControls();
    const st = { ...c, t: 0, cells: [], prof: new Array(NBIN).fill(0), profN: 0,
                 cosSteps: new Array(NCOS).fill(0), cosSum: new Array(NCOS).fill(0),
                 cosTumbles: new Array(NCOS).fill(0), runs: 0, runTime: 0, msd: [] };
    for (let i = 0; i < c.n; i++) {
      const x = DISH.x + Math.random() * DISH.w;
      const y = DISH.y + Math.random() * DISH.h;
      st.cells.push({
        x, y, th: Math.random() * Math.PI * 2,
        c: conc(x), sx: 1, sy: 1, ux: 0, uy: 0, fx0: x, fy0: y, age: 0, up: false,
      });
    }
    return st;
  }

  /**
   * One sub-step. The whole of the biology is the three lines that work out
   * `rate`, and none of them mentions a direction.
   */
  function substep(st) {
    const x1 = DISH.x, x2 = DISH.x + DISH.w, y1 = DISH.y, y2 = DISH.y + DISH.h;
    const lambda0 = 1 / st.tau;
    for (const q of st.cells) {
      const dx = st.v * H_STEP * Math.cos(q.th);
      const dy = st.v * H_STEP * Math.sin(q.th);
      // The unfolded path, which the walls never touch.
      q.ux += q.sx * dx; q.uy += q.sy * dy;
      let nx = q.x + dx, ny = q.y + dy;
      if (nx < x1) { nx = 2 * x1 - nx; q.th = Math.PI - q.th; q.sx = -q.sx; }
      else if (nx > x2) { nx = 2 * x2 - nx; q.th = Math.PI - q.th; q.sx = -q.sx; }
      if (ny < y1) { ny = 2 * y1 - ny; q.th = -q.th; q.sy = -q.sy; }
      else if (ny > y2) { ny = 2 * y2 - ny; q.th = -q.th; q.sy = -q.sy; }
      q.x = nx; q.y = ny;

      // Better than a moment ago? Then tumble less. This is the entire rule.
      const cNow = conc(nx);
      const rate = lambda0 * Math.max(0, 1 - st.beta * (cNow - q.c) / H_STEP);
      q.c = cNow;
      q.up = cNow > 0 && rate < lambda0;
      const tumbling = Math.random() < rate * H_STEP;

      // Sort this sub-step by the heading it was taken on, for the panel that
      // recovers lambda(th). The simulation does not read this back.
      const cs = Math.cos(q.th);
      const bin = Math.min(NCOS - 1, Math.floor((cs + 1) / 2 * NCOS));
      st.cosSteps[bin]++; st.cosSum[bin] += cs;
      q.age += H_STEP;
      if (tumbling) {
        st.cosTumbles[bin]++;
        st.runs++; st.runTime += q.age; q.age = 0;
        q.th = Math.random() * Math.PI * 2;
      }
    }
    st.t += H_STEP;
  }

  function sample(st) {
    for (const q of st.cells) {
      const b = Math.min(NBIN - 1, Math.max(0, Math.floor((q.x - DISH.x) / DISH.w * NBIN)));
      st.prof[b]++;
    }
    st.profN++;
    /*
     * Kept logarithmically. The graph's x axis spans four decades, so a
     * trailing window of the last few hundred samples would draw a curve
     * occupying the last centimetre of it. One point per five per cent in t
     * covers the whole axis in about two hundred points and never needs
     * trimming.
     */
    const last = st.msd[st.msd.length - 1];
    if (!last || st.t > last.t * 1.05) st.msd.push({ t: st.t, r2: meanSquare(st) });
  }

  function meanSquare(st) {
    let s = 0;
    for (const q of st.cells) s += q.ux * q.ux + q.uy * q.uy;
    return s / st.cells.length;
  }

  /**
   * The same walk measured between the walls instead of through them. Nothing
   * on the page uses this: it exists so the suite can show what the unfolding
   * is worth, which is four fifths of the answer by t = 100 tau.
   */
  function meanSquareFolded(st) {
    let s = 0;
    for (const q of st.cells) s += (q.x - q.fx0) ** 2 + (q.y - q.fy0) ** 2;
    return s / st.cells.length;
  }

  function advance(st, seconds) {
    const n = Math.round(seconds / H_STEP);
    for (let i = 0; i < n; i++) {
      substep(st);
      if (i % 12 === 0) sample(st);
    }
    return st;
  }

  // ── what the closed forms say ───────────────────────────────────────────
  const bias = (st) => st.beta * st.v / DISH.w;
  const diffusion = (st) => st.v * st.v * st.tau / 2;
  const driftSpeed = (st) => {
    const k = bias(st);
    if (k <= 0) return 0;
    if (k >= 1) return st.v;              // saturated; the slider does not reach here
    return (st.v / k) * (1 - Math.sqrt(1 - k * k));
  };
  const decayLength = (st) => {
    const vd = driftSpeed(st);
    return vd > 0 ? diffusion(st) / vd : Infinity;
  };
  const msdCurve = (st, t) => {
    const tau = st.tau;
    return 2 * st.v * st.v * tau * tau * (t / tau - 1 + Math.exp(-t / tau));
  };

  /** Straight-line fit, returning slope, intercept and r². */
  function lsq(xs, ys) {
    const m = xs.length;
    if (m < 3) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < m; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const den = m * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return null;
    const slope = (m * sxy - sx * sy) / den, inter = (sy - slope * sx) / m;
    let ssr = 0, sst = 0; const yb = sy / m;
    for (let i = 0; i < m; i++) {
      const p = slope * xs[i] + inter;
      ssr += (ys[i] - p) ** 2; sst += (ys[i] - yb) ** 2;
    }
    return { slope, inter, r2: sst > 0 ? 1 - ssr / sst : 0 };
  }

  /** The pile-up, read off the histogram the dish actually produced. */
  function fitProfile(st) {
    if (!st.profN) return null;
    const xs = [], ys = [];
    for (let i = 0; i < NBIN; i++) {
      if (st.prof[i] < 1) continue;
      xs.push(DISH.w * (i + 0.5) / NBIN);
      ys.push(Math.log(st.prof[i] / st.profN));
    }
    const f = lsq(xs, ys);
    if (!f) return null;
    return { l: 1 / f.slope, r2: f.r2 };
  }

  /** The tumble rate against cos θ, which should be a straight line. */
  function fitTumble(st) {
    const xs = [], ys = [];
    for (let i = 0; i < NCOS; i++) {
      if (st.cosSteps[i] < 200) continue;
      xs.push(st.cosSum[i] / st.cosSteps[i]);
      ys.push(st.cosTumbles[i] / st.cosSteps[i] / H_STEP);
    }
    const f = lsq(xs, ys);
    if (!f || f.inter <= 0) return null;
    return { lambda0: f.inter, k: -f.slope / f.inter, r2: f.r2 };
  }

  // ── drawing ─────────────────────────────────────────────────────────────
  const CW = () => canvas.width / (window.devicePixelRatio || 1);
  const CH = () => canvas.height / (window.devicePixelRatio || 1);

  function draw() {
    const st = state, w = CW(), h = CH();
    ctx.fillStyle = '#0a1420';
    ctx.fillRect(0, 0, w, h);

    // The attractant itself, painted as the ramp it is.
    const g = ctx.createLinearGradient(DISH.x, 0, DISH.x + DISH.w, 0);
    g.addColorStop(0, 'rgba(123, 224, 208, 0.02)');
    g.addColorStop(1, 'rgba(123, 224, 208, 0.20)');
    ctx.fillStyle = g;
    ctx.fillRect(DISH.x, DISH.y, DISH.w, DISH.h);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(DISH.x, DISH.y, DISH.w, DISH.h);

    ctx.textAlign = 'left';
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillStyle = DIM;
    ctx.fillText(i18nText('ctLowCap', 'no attractant'), DISH.x, DISH.y - 12);
    ctx.textAlign = 'right';
    ctx.fillText(i18nText('ctHighCap', 'most attractant'), DISH.x + DISH.w, DISH.y - 12);

    // Cells. A short tail shows the heading, because a run is the point.
    for (const q of st.cells) {
      ctx.strokeStyle = q.up ? CELL_UP : CELL;
      ctx.globalAlpha = q.up ? 0.85 : 0.5;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - 7 * Math.cos(q.th), q.y - 7 * Math.sin(q.th));
      ctx.stroke();
      ctx.fillStyle = q.up ? CELL_UP : CELL;
      ctx.globalAlpha = q.up ? 0.95 : 0.7;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawProfile(st);
    drawPlot(st);
  }

  function drawProfile(st) {
    const y1 = PROF.y + PROF.h;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(DISH.x, y1); ctx.lineTo(DISH.x + DISH.w, y1); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = DIM;
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(i18nText('ctProfileCap', 'where the cells are, averaged over the run'),
                 DISH.x, PROF.y - 4);
    if (!st.profN) return;
    let peak = 1;
    for (const v of st.prof) peak = Math.max(peak, v / st.profN);
    const bw = DISH.w / NBIN;
    for (let i = 0; i < NBIN; i++) {
      const v = st.prof[i] / st.profN / peak;
      ctx.fillStyle = BAR;
      ctx.globalAlpha = 0.25 + 0.5 * v;
      ctx.fillRect(DISH.x + i * bw + 1, y1 - v * PROF.h, bw - 2, v * PROF.h);
    }
    ctx.globalAlpha = 1;
    // The exponential the drift and the spreading agree on.
    const l = decayLength(st);
    if (Number.isFinite(l)) {
      let norm = 0;
      for (let i = 0; i < NBIN; i++) norm = Math.max(norm, Math.exp((DISH.w * (i + 0.5) / NBIN) / l));
      ctx.strokeStyle = PRED;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let i = 0; i < NBIN; i++) {
        const px = DISH.x + (i + 0.5) * bw;
        const py = y1 - (Math.exp((DISH.w * (i + 0.5) / NBIN) / l) / norm) * PROF.h;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** ⟨r²⟩ against t, log–log, so the ballistic knee is visible as a kink. */
  function drawPlot(st) {
    const x0 = PLOT.x, x1 = PLOT.x + PLOT.w, y0 = PLOT.y, y1 = PLOT.y + PLOT.h;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = DIM;
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(i18nText('ctPlotCap', 'how far, against how long — both axes logarithmic'), x0, y0 - 5);

    const tMin = H_STEP * 12, tMax = Math.max(st.t, tMin * 100);
    const rMin = st.v * st.v * tMin * tMin * 0.5;
    const rMax = Math.max(msdCurve(st, tMax) * 2, rMin * 100);
    const lx = (t) => x0 + (Math.log(Math.max(t, tMin)) - Math.log(tMin)) /
                           (Math.log(tMax) - Math.log(tMin)) * PLOT.w;
    const ly = (r) => y1 - (Math.log(Math.max(r, rMin)) - Math.log(rMin)) /
                           (Math.log(rMax) - Math.log(rMin)) * PLOT.h;

    // Everything from here is clipped to the box: the ballistic line leaves
    // the top of it two decades before the axis ends, which is the point.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, PLOT.w, PLOT.h);
    ctx.clip();

    // The two limits, each drawn where it is wrong as well as where it is right.
    ctx.strokeStyle = ASYM;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    for (const f of [(t) => st.v * st.v * t * t, (t) => 4 * diffusion(st) * t]) {
      ctx.beginPath();
      ctx.moveTo(lx(tMin), ly(f(tMin))); ctx.lineTo(lx(tMax), ly(f(tMax)));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // The crossover, which is right everywhere.
    ctx.strokeStyle = PRED;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const t = Math.exp(Math.log(tMin) + (Math.log(tMax) - Math.log(tMin)) * i / 80);
      const px = lx(t), py = ly(msdCurve(st, t));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // What the dish actually did.
    if (st.msd.length > 1) {
      ctx.strokeStyle = MEAS;
      ctx.lineWidth = 2;
      ctx.beginPath();
      st.msd.forEach((p, i) => {
        const px = lx(p.t), py = ly(p.r2);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.restore();

    // Each limit named where it runs alone, not where it is buried in the
    // curve: the ballistic line at the height it leaves the box, the
    // diffusive one under the right-hand end.
    ctx.fillStyle = DIM;
    ctx.font = '500 10px system-ui, sans-serif';
    const tOut = Math.sqrt(rMax) / st.v;
    ctx.textAlign = 'left';
    ctx.fillText(i18nText('ctBallistic', 'v²t²'), Math.min(lx(tOut) + 5, x1 - 30), y0 + 11);
    ctx.textAlign = 'right';
    ctx.fillText(i18nText('ctDiffusive', '4Dt'), x1 - 4, ly(4 * diffusion(st) * tMax) + 14);
    ctx.textAlign = 'center';
    ctx.fillText(`${st.t.toFixed(1)} s`, x1 - 16, y1 + 13);
  }

  // ── readouts ────────────────────────────────────────────────────────────
  function updateReadouts() {
    const st = state;
    const set = (id, v) => { const node = el(id); if (node) node.textContent = v; };
    const prof = fitProfile(st), tum = fitTumble(st);
    const l = decayLength(st);
    set('out-k', (bias(st) * 100).toFixed(1));
    set('out-run', st.runs > 20 ? (st.runTime / st.runs).toFixed(2) : '—');
    set('out-lambda', tum ? tum.lambda0.toFixed(2) : '—');
    set('out-kfit', tum && bias(st) > 0 ? (tum.k * 100).toFixed(1) : '—');
    set('out-d', diffusion(st).toFixed(0));
    set('out-drift', driftSpeed(st).toFixed(2));
    set('out-l', Number.isFinite(l) ? l.toFixed(0) : '∞');
    set('out-lfit', prof && st.beta > 0 && prof.l > 0 ? prof.l.toFixed(0) : '—');
    set('out-r2', prof && st.beta > 0 ? prof.r2.toFixed(3) : '—');
    set('out-time', st.t.toFixed(1));
    // The bars are an average over everything since the reset, so they only
    // mean what the label says once the population has had time to arrange
    // itself — several trips across the dish at the drift speed.
    const settled = driftSpeed(st) > 0 && st.t > 4 * DISH.w / driftSpeed(st);
    set('out-state', st.beta <= 0
      ? i18nText('ctStateBlind', 'No memory — it spreads and goes nowhere')
      : settled
        ? i18nText('ctStatePiled', 'Piled up — drift against spreading')
        : i18nText('ctStateClimbing', 'Climbing'));
  }

  // ── loop ────────────────────────────────────────────────────────────────
  let sampleAcc = 0;
  function step(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (!paused && dt > 0) {
      acc += dt * state.sim;
      let guard = 0;
      while (acc >= H_STEP && guard < 400) {
        substep(state); acc -= H_STEP; guard++;
        if (++sampleAcc % 12 === 0) sample(state);
      }
    }
    draw();
    updateReadouts();
    animId = requestAnimationFrame(step);
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  function syncLabels() {
    el('count-value').textContent = countIn.value;
    el('swim-value').textContent = speedIn.value;
    el('runtime-value').textContent = parseFloat(runIn.value).toFixed(1);
    el('beta-value').textContent = parseFloat(betaIn.value).toFixed(1);
    el('sim-speed-value').textContent = '×' + simIn.value;
  }

  function restart() {
    state = build();
    acc = 0; sampleAcc = 0;
    syncLabels();
    sample(state);
    draw();
    updateReadouts();
  }

  /**
   * Sensitivity and the clock may change under a running dish. Speed and run
   * time may not: every measurement on the panel is dated from a fixed tau and
   * v, so changing one has to start the averaging again.
   */
  function softApply() {
    state.beta = readControls().beta;
    state.sim = readControls().sim;
    syncLabels();
    updateReadouts();
  }

  for (const node of [countIn, speedIn, runIn]) {
    node.addEventListener('input', restart);
    node.addEventListener('change', restart);
  }
  for (const node of [betaIn, simIn]) node.addEventListener('input', softApply);

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? i18nText('waveResumeBtn', 'Resume') : i18nText('wavePauseBtn', 'Pause');
    window.SFX?.tone({ freq: paused ? 300 : 520, dur: 0.07, type: 'triangle', gain: 0.1 });
  });
  resetBtn.addEventListener('click', () => {
    paused = false;
    pauseBtn.textContent = i18nText('wavePauseBtn', 'Pause');
    restart();
  });

  document.addEventListener('langchange', () => { syncLabels(); updateReadouts(); draw(); });

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(800 * dpr);
    canvas.height = Math.round(500 * dpr);
    canvas.style.height = '500px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state) draw();
  }
  window.addEventListener('resize', resize);

  if (window.CSVExport) {
    window.CSVExport.attach('csv-btn', () => {
      if (!state || !state.profN) return null;
      const st = state;
      return {
        name: 'chemotaxis-profile.csv',
        title: 'Chemotaxis — where the cells ended up, and the tumble rate by heading',
        columns: ['bin_x', 'cells_per_frame', 'cos_theta', 'tumbles_per_second'],
        rows: Array.from({ length: Math.max(NBIN, NCOS) }, (_, i) => [
          i < NBIN ? DISH.w * (i + 0.5) / NBIN : '',
          i < NBIN ? (st.prof[i] / st.profN).toFixed(4) : '',
          i < NCOS && st.cosSteps[i] ? (st.cosSum[i] / st.cosSteps[i]).toFixed(4) : '',
          i < NCOS && st.cosSteps[i] ? (st.cosTumbles[i] / st.cosSteps[i] / H_STEP).toFixed(4) : '',
        ]),
        meta: {
          cells: st.cells.length, swim_speed: st.v, mean_run_time: st.tau,
          sensitivity: st.beta, substep_s: H_STEP, dish_w: DISH.w, dish_h: DISH.h,
          bias_k: bias(st), diffusion: diffusion(st), drift: driftSpeed(st),
          decay_length: decayLength(st), elapsed_s: st.t,
        },
      };
    });
  }

  resize();
  restart();
  animId = requestAnimationFrame(step);

  /*
   * The handle tests/experiments/chemotaxis.test.mjs measures the dish through.
   * It sets the same controls a reader sets and steps the same sub-step the
   * animation steps; every quantity it checks it fits itself, from the bins.
   */
  window.__chemo = {
    constants: () => ({ H_STEP, DISH, NBIN, NCOS }),
    set(cfg) {
      if (cfg.n !== undefined) countIn.value = String(cfg.n);
      if (cfg.v !== undefined) speedIn.value = String(cfg.v);
      if (cfg.tau !== undefined) runIn.value = String(cfg.tau);
      if (cfg.beta !== undefined) betaIn.value = String(cfg.beta);
      restart();
      return this.read();
    },
    advance(seconds) { advance(state, seconds); return this.read(); },
    /** Forget everything measured so far, keeping the cells where they are. */
    clearStats() {
      const st = state;
      st.prof.fill(0); st.profN = 0;
      st.cosSteps.fill(0); st.cosSum.fill(0); st.cosTumbles.fill(0);
      st.runs = 0; st.runTime = 0; st.msd = []; st.t = 0;
      for (const q of st.cells) { q.ux = 0; q.uy = 0; q.fx0 = q.x; q.fy0 = q.y; q.age = 0; }
      return this.read();
    },
    read: () => {
      const st = state;
      return {
        t: st.t, n: st.cells.length, v: st.v, tau: st.tau, beta: st.beta,
        k: bias(st), D: diffusion(st), drift: driftSpeed(st), l: decayLength(st),
        msd: meanSquare(st), msdFolded: meanSquareFolded(st),
        msdPredicted: msdCurve(st, st.t),
        meanRun: st.runs > 20 ? st.runTime / st.runs : null,
        profile: st.prof.slice(), profN: st.profN,
        cosSteps: st.cosSteps.slice(), cosSum: st.cosSum.slice(),
        cosTumbles: st.cosTumbles.slice(),
        fitProfile: fitProfile(st), fitTumble: fitTumble(st),
        meanX: st.cells.reduce((a, q) => a + q.x, 0) / st.cells.length - DISH.x,
        shownState: el('out-state').textContent,
      };
    },
    /** What the closed forms say, for a set of numbers the page never sees. */
    predict: (v, tau, beta) => {
      const k = beta * v / DISH.w;
      const D = v * v * tau / 2;
      const vd = k > 0 ? (v / k) * (1 - Math.sqrt(1 - k * k)) : 0;
      return { k, D, drift: vd, l: vd > 0 ? D / vd : Infinity };
    },
  };
})();
