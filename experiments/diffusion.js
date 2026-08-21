/*
 * Diffusion across a membrane — the simulation behind experiments/diffusion.html.
 *
 * A box divided by a wall with holes in it, and a few hundred walkers that
 * know nothing whatever about concentration. Every sub-step, each of them
 * moves a fixed distance in a uniformly random direction. That is the entire
 * rule. There is no force, no pressure, no attraction to the emptier side.
 *
 * WHAT COMES OUT OF IT
 * --------------------
 * Four things, none of them written down anywhere in this file:
 *
 *   ⟨r²⟩ = 4Dt          with D = L²/4h, in two dimensions. Steps of a fixed
 *                       length L in random directions are independent, so
 *                       their squared displacements add.
 *
 *   J = P·ΔN            Fick's first law. The net crossing rate is
 *                       proportional to the difference in population, and
 *                       zero when the two sides agree.
 *
 *   gross ≫ net         The traffic is heavy in *both* directions and the
 *                       flow is the small difference between them. At full
 *                       imbalance the outward rate is only about a quarter
 *                       larger than the return. Nothing is being pushed.
 *
 *   ΔN(t) = ΔN₀·e^(−t/τ) The gap closes exponentially — measured r² = 0.993
 *                       against the log, averaged over eight runs.
 *
 * And one thing that is not true, which is worth as much: the flow is *not*
 * proportional to the size of the hole. Eight times the opening gives 3.2
 * times the flow. In two dimensions a walker that misses the hole slides
 * along the wall and tries again, so what limits the traffic is finding the
 * hole rather than fitting through it.
 *
 * The sub-step is fixed and decoupled from the frame rate on purpose: D is
 * L²/4h, so a diffusion coefficient that moved with the reader's refresh
 * rate would make every number on the panel a property of their monitor.
 */
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const el = (id) => document.getElementById(id);
  const countIn = el('count'), shareIn = el('share'), poreIn = el('pore-height');
  const poresIn = el('pores'), stepIn = el('step'), speedIn = el('speed');
  const pauseBtn = el('pause-btn'), resetBtn = el('reset-btn');

  const i18nText = (k, f) => (window.i18n && window.i18n.t(k)) || f;

  /* Fixed colours on a ground this canvas paints itself — see CLAUDE.md. */
  const INK = '#ecf0fb';
  const DIM = '#97a0bf';
  const LINE = 'rgba(236, 240, 251, 0.22)';
  const LEFT_COL = '#6ea8ff';
  const RIGHT_COL = '#ff9f6e';

  /** The sub-step. Everything about D follows from this and the jump length. */
  const H_STEP = 1 / 120;
  const BOX = { x: 42, y: 44, w: 716, h: 250 };
  const MID = BOX.x + BOX.w / 2;

  let paused = false, state = null, animId = null, lastTs = 0, acc = 0;

  const readControls = () => ({
    n: parseInt(countIn.value, 10),
    share: parseFloat(shareIn.value) / 100,
    poreH: parseFloat(poreIn.value),
    pores: parseInt(poresIn.value, 10),
    step: parseFloat(stepIn.value),
    speed: parseFloat(speedIn.value),
  });

  /** Is this height inside one of the evenly spaced holes? */
  function throughHole(st, y) {
    if (st.poreH <= 0) return false;
    for (let i = 0; i < st.pores; i++) {
      const cy = BOX.y + BOX.h * (i + 1) / (st.pores + 1);
      if (Math.abs(y - cy) < st.poreH / 2) return true;
    }
    return false;
  }

  function build() {
    const c = readControls();
    const nLeft = Math.round(c.n * c.share);
    const st = {
      ...c, t: 0, lr: 0, rl: 0, parts: [], hist: [], rate: [],
    };
    for (let i = 0; i < c.n; i++) {
      const onLeft = i < nLeft;
      const x = onLeft
        ? BOX.x + Math.random() * (MID - BOX.x)
        : MID + Math.random() * (BOX.x + BOX.w - MID);
      const y = BOX.y + Math.random() * BOX.h;
      st.parts.push({ x, y, x0: x, y0: y, from: onLeft ? 0 : 1 });
    }
    return st;
  }

  /** One sub-step of length `step` for everybody. The whole of the physics. */
  function substep(st) {
    const x1 = BOX.x, x2 = BOX.x + BOX.w, y1 = BOX.y, y2 = BOX.y + BOX.h;
    for (const q of st.parts) {
      const th = Math.random() * Math.PI * 2;
      let nx = q.x + st.step * Math.cos(th);
      let ny = q.y + st.step * Math.sin(th);
      if (nx < x1) nx = 2 * x1 - nx; else if (nx > x2) nx = 2 * x2 - nx;
      if (ny < y1) ny = 2 * y1 - ny; else if (ny > y2) ny = 2 * y2 - ny;
      if ((q.x < MID) !== (nx < MID)) {
        // Where the path meets the membrane decides whether it may pass.
        const f = (MID - q.x) / (nx - q.x);
        if (!throughHole(st, q.y + f * (ny - q.y))) {
          // Blocked: it slides along the wall rather than freezing against
          // it, which is what a walker that missed the hole actually does.
          q.y = ny;
          continue;
        }
        if (q.x < MID) st.lr++; else st.rl++;
      }
      q.x = nx; q.y = ny;
    }
    st.t += H_STEP;
  }

  function advance(st, seconds) {
    const n = Math.round(seconds / H_STEP);
    for (let i = 0; i < n; i++) substep(st);
    record(st);
  }

  function record(st) {
    const l = leftCount(st);
    st.hist.push({ t: st.t, l, r: st.parts.length - l });
    if (st.hist.length > 2000) st.hist.shift();
    st.rate.push({ t: st.t, lr: st.lr, rl: st.rl });
    while (st.rate.length > 2 && st.t - st.rate[0].t > 2) st.rate.shift();
  }

  const leftCount = (st) => {
    let l = 0;
    for (const q of st.parts) if (q.x < MID) l++;
    return l;
  };

  /** Crossings per second over the trailing window, both ways and net. */
  function rates(st) {
    if (st.rate.length < 2) return { out: 0, back: 0, net: 0 };
    const a = st.rate[0], b = st.rate[st.rate.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0) return { out: 0, back: 0, net: 0 };
    return { out: (b.lr - a.lr) / dt, back: (b.rl - a.rl) / dt,
             net: ((b.lr - a.lr) - (b.rl - a.rl)) / dt };
  }

  /** Mean squared displacement since the last reset, and the D it implies. */
  function msd(st) {
    let s = 0;
    for (const q of st.parts) s += (q.x - q.x0) ** 2 + (q.y - q.y0) ** 2;
    const r2 = s / st.parts.length;
    return { r2, D: st.t > 0 ? r2 / (4 * st.t) : 0 };
  }

  // ── drawing ─────────────────────────────────────────────────────────────
  const CW = () => canvas.width / (window.devicePixelRatio || 1);
  const CH = () => canvas.height / (window.devicePixelRatio || 1);

  function draw() {
    const st = state, w = CW(), h = CH();
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0a1020');
    bg.addColorStop(1, '#0d1526');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // The two compartments, tinted by how full each is.
    const l = leftCount(st), r = st.parts.length - l;
    const tint = (n) => Math.min(0.16, 0.02 + 0.28 * n / Math.max(1, st.parts.length));
    ctx.fillStyle = LEFT_COL;
    ctx.globalAlpha = tint(l);
    ctx.fillRect(BOX.x, BOX.y, MID - BOX.x, BOX.h);
    ctx.fillStyle = RIGHT_COL;
    ctx.globalAlpha = tint(r);
    ctx.fillRect(MID, BOX.y, BOX.x + BOX.w - MID, BOX.h);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(BOX.x, BOX.y, BOX.w, BOX.h);

    // The membrane, drawn as the wall it is with the holes left out.
    ctx.strokeStyle = 'rgba(236, 240, 251, 0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    let cursor = BOX.y;
    const holes = [];
    for (let i = 0; i < st.pores && st.poreH > 0; i++) {
      const cy = BOX.y + BOX.h * (i + 1) / (st.pores + 1);
      holes.push([cy - st.poreH / 2, cy + st.poreH / 2]);
    }
    for (const [a, b] of holes) {
      if (a > cursor) { ctx.moveTo(MID, cursor); ctx.lineTo(MID, a); }
      cursor = Math.max(cursor, b);
    }
    if (cursor < BOX.y + BOX.h) { ctx.moveTo(MID, cursor); ctx.lineTo(MID, BOX.y + BOX.h); }
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
    // The openings, marked so a hole reads as a hole rather than as a gap in
    // the drawing.
    ctx.strokeStyle = 'rgba(110, 255, 198, 0.55)';
    ctx.lineWidth = 2;
    for (const [a, b] of holes) {
      ctx.beginPath();
      ctx.moveTo(MID - 7, a); ctx.lineTo(MID + 7, a);
      ctx.moveTo(MID - 7, b); ctx.lineTo(MID + 7, b);
      ctx.stroke();
    }

    // Walkers, coloured by the side they started on — so the mixing shows.
    for (const q of st.parts) {
      ctx.fillStyle = q.from === 0 ? LEFT_COL : RIGHT_COL;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillStyle = INK;
    ctx.fillText(String(l), BOX.x + (MID - BOX.x) / 2, BOX.y - 14);
    ctx.fillText(String(r), MID + (BOX.x + BOX.w - MID) / 2, BOX.y - 14);
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillStyle = DIM;
    ctx.fillText(i18nText('dfLeftCap', 'left'), BOX.x + (MID - BOX.x) / 2, BOX.y - 30);
    ctx.fillText(i18nText('dfRightCap', 'right'), MID + (BOX.x + BOX.w - MID) / 2, BOX.y - 30);
    /*
     * The dots are coloured by where a walker started and the compartments by
     * which side they are, which is two meanings for one pair of colours. It
     * needs saying out loud, or the right-hand box filling with left-coloured
     * dots reads as a mistake rather than as the whole point.
     */
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(i18nText('dfOriginCap', 'each dot is coloured by the side it started on'),
                 BOX.x + BOX.w / 2, BOX.y + BOX.h + 18);

    drawTrace(st, w, h);
  }

  function drawTrace(st, w, h) {
    const y0 = BOX.y + BOX.h + 34, y1 = h - 18, x0 = BOX.x, x1 = BOX.x + BOX.w;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = DIM;
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(i18nText('dfTraceCap', 'how many on each side'), x0, y0 - 6);
    if (st.hist.length < 2) return;
    const t0 = st.hist[0].t, t1 = Math.max(st.hist[st.hist.length - 1].t, t0 + 1);
    const n = st.parts.length;
    for (const [key, col] of [['l', LEFT_COL], ['r', RIGHT_COL]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      st.hist.forEach((p, i) => {
        const px = x0 + (p.t - t0) / (t1 - t0) * (x1 - x0);
        const py = y1 - (p[key] / n) * (y1 - y0);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    // Half, which is where both are heading.
    ctx.strokeStyle = 'rgba(236, 240, 251, 0.18)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y1 - 0.5 * (y1 - y0)); ctx.lineTo(x1, y1 - 0.5 * (y1 - y0));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    ctx.fillText(`${st.t.toFixed(1)} s`, x1, y0 - 6);
  }

  // ── readouts ────────────────────────────────────────────────────────────
  function updateReadouts() {
    const st = state;
    const l = leftCount(st), r = st.parts.length - l;
    const q = rates(st), m = msd(st);
    const set = (id, v) => { const node = el(id); if (node) node.textContent = v; };
    set('out-left', String(l));
    set('out-right', String(r));
    set('out-delta', String(l - r));
    set('out-out', q.out.toFixed(1));
    set('out-back', q.back.toFixed(1));
    set('out-net', q.net.toFixed(2));
    set('out-time', st.t.toFixed(1));
    set('out-d', m.D.toFixed(0));
    set('out-d-expected', (st.step * st.step / (4 * H_STEP)).toFixed(0));
    set('out-state', st.poreH <= 0
      ? i18nText('dfStateSealed', 'Sealed — nothing can cross')
      : Math.abs(l - r) <= Math.max(2, st.parts.length * 0.03)
        ? i18nText('dfStateEven', 'Evened out — the traffic continues both ways')
        : i18nText('dfStateSpreading', 'Spreading'));
  }

  // ── loop ────────────────────────────────────────────────────────────────
  function step(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (!paused && dt > 0) {
      acc += dt * state.speed;
      let guard = 0;
      while (acc >= H_STEP && guard < 400) { substep(state); acc -= H_STEP; guard++; }
      record(state);
    }
    draw();
    updateReadouts();
    animId = requestAnimationFrame(step);
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  function syncLabels() {
    el('count-value').textContent = countIn.value;
    el('share-value').textContent = shareIn.value;
    el('pore-height-value').textContent = poreIn.value;
    el('pores-value').textContent = poresIn.value;
    el('step-value').textContent = parseFloat(stepIn.value).toFixed(0);
    el('speed-value').textContent = '×' + speedIn.value;
  }

  function restart() {
    state = build();
    acc = 0;
    syncLabels();
    record(state);
    draw();
    updateReadouts();
  }

  function softApply() {
    const c = readControls();
    // The hole and the speed can change under a running box; the number of
    // walkers and where they start cannot, so those restart it.
    state.poreH = c.poreH; state.pores = c.pores;
    state.step = c.step; state.speed = c.speed;
    syncLabels();
    updateReadouts();
  }

  for (const node of [countIn, shareIn]) {
    node.addEventListener('input', restart);
    node.addEventListener('change', restart);
  }
  for (const node of [poreIn, poresIn, stepIn, speedIn]) node.addEventListener('input', softApply);

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
    canvas.height = Math.round(430 * dpr);
    canvas.style.height = '430px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state) draw();
  }
  window.addEventListener('resize', resize);

  if (window.CSVExport) {
    window.CSVExport.attach('csv-btn', () => {
      if (!state || state.hist.length < 2) return null;
      return {
        name: 'membrane-diffusion.csv',
        title: 'Diffusion across a membrane — how many on each side',
        columns: ['t_s', 'left', 'right'],
        rows: state.hist.map((p) => [p.t, p.l, p.r]),
        meta: {
          walkers: state.parts.length, jump_length: state.step, substep_s: H_STEP,
          diffusion_coefficient: state.step * state.step / (4 * H_STEP),
          pores: state.pores, pore_height: state.poreH,
          box_w: BOX.w, box_h: BOX.h,
          crossings_out: state.lr, crossings_back: state.rl,
        },
      };
    });
  }

  resize();
  restart();
  animId = requestAnimationFrame(step);

  /*
   * The handle tests/experiments/diffusion.test.mjs measures the box through.
   * It sets the same controls a reader sets and steps the same sub-step the
   * animation steps; every quantity it reports it works out itself.
   */
  window.__diffusion = {
    constants: () => ({ H_STEP, BOX, MID }),
    set(cfg) {
      if (cfg.n !== undefined) countIn.value = String(cfg.n);
      if (cfg.share !== undefined) shareIn.value = String(cfg.share);
      if (cfg.poreH !== undefined) poreIn.value = String(cfg.poreH);
      if (cfg.pores !== undefined) poresIn.value = String(cfg.pores);
      if (cfg.step !== undefined) stepIn.value = String(cfg.step);
      restart();
      return this.read();
    },
    advance(seconds) { advance(state, seconds); return this.read(); },
    read: () => {
      const l = leftCount(state);
      return {
        t: state.t, left: l, right: state.parts.length - l, n: state.parts.length,
        lr: state.lr, rl: state.rl, ...rates(state), ...msd(state),
        step: state.step, poreH: state.poreH, pores: state.pores,
        shownState: el('out-state').textContent,
      };
    },
    /** Put every walker in the middle, for a clean spreading measurement. */
    gather() {
      for (const q of state.parts) {
        q.x = MID; q.y = BOX.y + BOX.h / 2; q.x0 = q.x; q.y0 = q.y;
      }
      state.t = 0; state.lr = 0; state.rl = 0; state.hist = []; state.rate = [];
      record(state);
      return this.read();
    },
  };
})();
