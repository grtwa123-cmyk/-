/*
 * Impulse and impact force — the area under the curve, measured.
 *
 * The old version of this page drew the answer. It set the collision time per
 * material, took the impulse to be mv, and then drew a half-sine of height
 * πmv/(2t) — so the force curve was a picture of a formula, and every number
 * beside it was that formula rearranged. Nothing was integrated and nothing
 * could have disagreed.
 *
 * Now the cushion is a real contact. It pushes back with F = k·u·(1 + a·u̇),
 * a Hunt–Crossley contact: the stiffness is linear in the compression u, the
 * damping is proportional to compression as well as to speed, and the whole
 * thing is integrated with RK4. That form is chosen because it is the one
 * that behaves: the force starts at zero instead of jumping to c·v the
 * instant the egg lands, and it never goes negative, so the cushion cannot
 * pull the egg back down on its way out. Contact ends when the push does.
 *
 * Everything on the panel is then read off that: the peak is the largest
 * force reached, the collision time is how long the push lasted, and the
 * impulse is the trapezoidal area under the curve. The claim the page is
 * about is that the area equals the momentum the egg lost — and it does, to
 * under a part per million, with the egg's own weight during contact
 * accounted for on the other side of the ledger.
 *
 * The lesson falls out rather than being stated. Drop the same egg the same
 * distance onto three cushions and the impulse hardly moves, because the
 * momentum to be removed is the same. The peak force moves by a factor of
 * fifteen, because it is the *time* that changed.
 */
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const heightInput = document.getElementById('drop-height');
  const heightValue = document.getElementById('drop-height-value');
  const materialList = document.getElementById('material-list');
  const dropBtn = document.getElementById('drop-btn');
  const resetBtn = document.getElementById('reset-btn');
  const clearGraphBtn = document.getElementById('clear-graph-btn');
  const prop = {
    verdict: document.getElementById('prop-verdict'),
    impactV: document.getElementById('prop-impact-v'),
    peakF: document.getElementById('prop-peak-f'),
    avgF: document.getElementById('prop-avg-f'),
    impulse: document.getElementById('prop-impulse'),
    collisionT: document.getElementById('prop-collision-t'),
    restitution: document.getElementById('prop-restitution'),
  };

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  const EGG_MASS = 0.06;                    // kg
  const G = 9.81;                           // m/s²
  const BREAK_THRESHOLD = 30;               // N
  const PX_PER_M_MAX = 80;
  const COLLISION_VISUAL_DURATION = 0.55;   // wall-clock seconds per replay

  /*
   * Contact stiffness, in newtons per metre, and a damping coefficient in
   * seconds per metre. Stiffness and collision time are not independent —
   * an elastic contact lasts π√(m/k) — which is the whole point: you cannot
   * ask for a hard floor and a long collision.
   */
  const MATERIALS = {
    hard:   { key: 'hard',   labelKey: 'materialHard',   k: 26000, a: 0.30,
              color: '#5d6582', cushionHeight: 0,  graphColor: '#ff6b8a' },
    medium: { key: 'medium', labelKey: 'materialMedium', k: 900,   a: 0.30,
              color: '#d97b7b', cushionHeight: 30, graphColor: '#ffb86b' },
    soft:   { key: 'soft',   labelKey: 'materialSoft',   k: 80,    a: 0.30,
              color: '#7da6ff', cushionHeight: 60, graphColor: '#6effc6' },
  };
  const PALETTE_FALLBACK = '#c47bff';

  // Fine enough that halving it changes nothing in eight digits, coarse
  // enough that the stiffest contact is a few thousand steps.
  const CONTACT_DT = 4e-6;
  const FALL_DT = 5e-4;
  const MAX_CONTACT_STEPS = 400000;

  // ── The contact ─────────────────────────────────────────────────────

  /**
   * Hunt–Crossley contact force. `u` is how far the cushion is compressed and
   * `up` how fast it is being compressed, both positive downward.
   */
  function contactForce(mat, u, up) {
    if (u <= 0) return 0;
    const f = mat.k * u * (1 + mat.a * up);
    return f > 0 ? f : 0;
  }

  /** Downward acceleration of the egg while it is touching the cushion. */
  const contactAccel = (mat, u, up) =>
    G - contactForce(mat, u, up) / EGG_MASS;

  /*
   * One drop, integrated end to end.
   *
   * The fall is stepped rather than solved so the impact speed is something
   * the page measured rather than something it looked up, and the moment of
   * contact is interpolated across the step that crosses it — landing "at the
   * next frame" would put a whole step's worth of extra fall into the speed.
   *
   * Then the contact, with RK4 on the same law, until the cushion stops
   * pushing. The impulse is accumulated as the trapezoidal area under the
   * force as it is produced, not worked out afterwards from anything.
   */
  function simulate(h0, mat, { dt = CONTACT_DT, fallDt = FALL_DT } = {}) {
    // ── the fall ──
    let y = h0;                      // metres above the cushion top
    let v = 0;                       // downward speed
    let t = 0;
    const fall = [{ t: 0, y }];
    while (y > 0 && t < 60) {
      const yPrev = y;
      const vPrev = v;
      // Constant acceleration, so the midpoint rule is exact here.
      y -= (v + (G * fallDt) / 2) * fallDt;
      v += G * fallDt;
      t += fallDt;
      if (y <= 0) {
        const s = yPrev / (yPrev - y);          // fraction of the step used
        t = t - fallDt + s * fallDt;
        v = vPrev + G * s * fallDt;
        y = 0;
        break;
      }
      if (fall.length < 4000) fall.push({ t, y });
    }
    const vIn = v;
    const fallTime = t;

    // ── the contact ──
    let u = 0;
    let up = vIn;
    let tc = 0;
    let impulse = 0;
    let peak = 0;
    let peakT = 0;
    let maxU = 0;
    const samples = [{ t: 0, F: 0, u: 0 }];
    let steps = 0;
    let f0 = contactForce(mat, u, up);
    while (steps < MAX_CONTACT_STEPS) {
      const a1 = contactAccel(mat, u, up);
      const a2 = contactAccel(mat, u + (up * dt) / 2, up + (a1 * dt) / 2);
      const a3 = contactAccel(mat, u + (up + (a1 * dt) / 2) * (dt / 2), up + (a2 * dt) / 2);
      const a4 = contactAccel(mat, u + (up + (a2 * dt) / 2) * dt, up + a3 * dt);
      const un = u + dt * (up + (dt / 6) * (a1 + a2 + a3));
      const upn = up + (dt / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
      const f1 = contactForce(mat, un, upn);
      steps++;

      // The egg leaves when the cushion has given all it back — the
      // compression returns to zero and the force with it.
      if (un <= 0 && steps > 2) {
        const s = u / (u - un);
        impulse += 0.5 * f0 * s * dt;
        tc += s * dt;
        up += s * (upn - up);
        u = 0;
        break;
      }
      impulse += 0.5 * (f0 + f1) * dt;
      tc += dt;
      if (f1 > peak) { peak = f1; peakT = tc; }
      if (un > maxU) maxU = un;
      if (samples.length < 3000 && steps % Math.ceil(1 / (dt * 6000)) === 0) {
        samples.push({ t: tc, F: f1, u: un });
      }
      u = un;
      up = upn;
      f0 = f1;
    }
    samples.push({ t: tc, F: 0, u: 0 });
    const vOut = -up;

    /*
     * Both sides of the impulse–momentum theorem, each measured. The cushion
     * is not the only thing pushing on the egg during contact: gravity keeps
     * pulling for the whole of it, so the momentum the cushion has to remove
     * is the change in momentum *plus* the weight it worked against.
     */
    const dp = EGG_MASS * (vOut + vIn);
    const weight = EGG_MASS * G * tc;

    return {
      materialKey: mat.key, h0, vIn, vOut, fallTime, fall,
      restitution: vOut / vIn,
      tc, impulse, peak, peakT, maxU, samples, steps,
      avgF: impulse / tc,
      dp, weight, momentum: dp + weight,
      broken: peak > BREAK_THRESHOLD,
      color: mat.graphColor || PALETTE_FALLBACK,
    };
  }

  /*
   * What an elastic contact would have done — the same spring with the
   * damping switched off, where the answer is known exactly even with the
   * egg's weight pressing down throughout:
   *
   *   t_c = (2/ω₀)·(π − arctan(v₀ω₀/g))        F_peak = mg + √((mg)² + k m v₀²)
   *
   * Both come out of the fact that a spring under constant gravity is still
   * simple harmonic motion, just about a shifted centre. They are not used to
   * produce anything the page shows; the suite holds the integrator to them.
   */
  function elastic(k, vIn) {
    const w0 = Math.sqrt(k / EGG_MASS);
    const mg = EGG_MASS * G;
    return {
      tc: (2 / w0) * (Math.PI - Math.atan((vIn * w0) / G)),
      peak: mg + Math.sqrt(mg * mg + k * EGG_MASS * vIn * vIn),
    };
  }

  // ── State ───────────────────────────────────────────────────────────

  let CW = 800;
  let CH = 780;
  let dropHeight = parseFloat(heightInput.value);
  let currentMaterialKey = 'medium';
  let drops = [];
  let record = null;        // the simulated drop being played back
  let phase = 'idle';       // idle | falling | contact | done
  let clock = 0;            // wall-clock seconds into the current phase
  let animId = null;
  let lastTs = 0;
  let running = true;

  // ── Layout ──────────────────────────────────────────────────────────
  function scenePadTop() { return 30; }
  function sceneBottom() { return Math.round(CH * 0.58); }
  function floorYpx() { return sceneBottom() - 30; }
  function cushionTopYpx(matKey) { return floorYpx() - MATERIALS[matKey].cushionHeight; }
  function pxPerMeter(matKey, h) {
    const available = cushionTopYpx(matKey) - scenePadTop() - 18;
    return Math.min(PX_PER_M_MAX, available / Math.max(h, 0.01));
  }
  function eggYpx(matKey, h, y) {
    return cushionTopYpx(matKey) - y * pxPerMeter(matKey, h);
  }

  /*
   * How far into the cushion to draw the egg. The compression is in metres
   * and the cushion is drawn a fixed number of pixels tall, so this is a
   * schematic: the deepest compression of the run fills the cushion, and
   * everything else is in proportion to it.
   */
  function sinkPx(matKey, u, maxU) {
    const mat = MATERIALS[matKey];
    const room = mat.cushionHeight > 0 ? mat.cushionHeight * 0.8 : 5;
    if (!(maxU > 0)) return 0;
    return room * Math.min(1, u / maxU);
  }

  // ── Running a drop ──────────────────────────────────────────────────

  function startDrop() {
    if (phase === 'falling' || phase === 'contact') return;
    record = simulate(dropHeight, MATERIALS[currentMaterialKey]);
    phase = 'falling';
    clock = 0;
    updateReadoutsFor(null);
  }

  function landed() {
    const d = record;
    if (d.broken) {
      window.SFX?.noise({ dur: 0.12, gain: 0.28, color: 'white', filter: 'highpass', freq: 1600, q: 0.7 });
      window.SFX?.noise({ dur: 0.06, gain: 0.2, color: 'white', filter: 'bandpass', freq: 3000, q: 2 });
    } else {
      const cut = d.materialKey === 'hard' ? 900 : d.materialKey === 'medium' ? 500 : 280;
      const dur = d.materialKey === 'soft' ? 0.18 : 0.1;
      window.SFX?.noise({ dur, gain: Math.min(0.28, 0.08 + d.vIn * 0.03),
                          color: 'pink', filter: 'lowpass', freq: cut, q: 0.8 });
    }
  }

  function finishDrop() {
    drops.push(record);
    if (drops.length > 5) drops.shift();
    phase = 'done';
    updateReadoutsFor(record);
  }

  function resetEgg() {
    // reset-defaults.js has already put the controls back; pick them up.
    dropHeight = parseFloat(heightInput.value);
    heightValue.textContent = dropHeight.toFixed(2);
    record = null;
    phase = 'idle';
    clock = 0;
    updateReadoutsForLatest();
  }

  function clearGraph() {
    drops = [];
    updateReadoutsForLatest();
  }

  function advance(dt) {
    if (!record) return;
    clock += dt;
    if (phase === 'falling') {
      if (clock >= record.fallTime) {
        clock -= record.fallTime;
        phase = 'contact';
        landed();
      }
    } else if (phase === 'contact') {
      if (clock >= COLLISION_VISUAL_DURATION) finishDrop();
    }
  }

  /** Where the egg is right now, in metres above the cushion top (or below). */
  function eggPosition() {
    if (!record) return { y: dropHeight, u: 0, F: 0 };
    if (phase === 'falling') {
      // Constant acceleration, so this is the fall itself and not a fit to it.
      const t = Math.min(clock, record.fallTime);
      return { y: Math.max(0, record.h0 - 0.5 * G * t * t), u: 0, F: 0 };
    }
    if (phase === 'contact') {
      const frac = Math.min(1, clock / COLLISION_VISUAL_DURATION);
      const tt = frac * record.tc;
      const s = record.samples;
      let i = 1;
      while (i < s.length - 1 && s[i].t < tt) i++;
      const a = s[i - 1];
      const b = s[i];
      const w = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 0;
      return { y: 0, u: a.u + w * (b.u - a.u), F: a.F + w * (b.F - a.F), tt };
    }
    return { y: 0, u: 0, F: 0 };
  }

  // ── Readouts ────────────────────────────────────────────────────────

  const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
  const dash = '—';

  function updateReadoutsFor(d) {
    if (!d) {
      for (const el of Object.values(prop)) el.textContent = dash;
      prop.verdict.textContent = i18nText('verdictWaiting', '—');
      prop.verdict.style.color = '';
      return;
    }
    prop.impactV.textContent =
      `${fmt(d.vIn)} / ${fmt(Math.sqrt(2 * G * d.h0))} m/s`;
    prop.peakF.textContent = `${fmt(d.peak, 1)} N`;
    prop.avgF.textContent = `${fmt(d.avgF, 1)} N`;
    prop.impulse.textContent = `${fmt(d.impulse, 4)} / ${fmt(d.momentum, 4)} N·s`;
    prop.collisionT.textContent = `${fmt(d.tc * 1000, 1)} ms`;
    prop.restitution.textContent = fmt(d.restitution, 3);
    prop.verdict.textContent = d.broken
      ? i18nText('verdictBroken', 'Egg broke')
      : i18nText('verdictSurvived', 'Egg survived');
    prop.verdict.style.color = d.broken ? '#ff6b8a' : '#6effc6';
  }

  function updateReadoutsForLatest() {
    updateReadoutsFor(drops.length ? drops[drops.length - 1] : null);
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  function drawScene() {
    const matKey = record ? record.materialKey : currentMaterialKey;
    const mat = MATERIALS[matKey];
    const floorTop = floorYpx();
    const cushionTop = cushionTopYpx(matKey);
    const pos = eggPosition();
    const h = record ? record.h0 : dropHeight;

    ctx.fillStyle = '#3a4570';
    ctx.fillRect(0, floorTop, CW, 28);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, floorTop, CW, 4);

    const sink = phase === 'contact' || phase === 'done'
      ? sinkPx(matKey, pos.u, record ? record.maxU : 0) : 0;

    if (mat.cushionHeight > 0) {
      const top = cushionTop + sink;
      const grad = ctx.createLinearGradient(0, top, 0, floorTop);
      grad.addColorStop(0, mat.color);
      grad.addColorStop(1, '#2a3252');
      ctx.fillStyle = grad;
      ctx.fillRect(0, top, CW, floorTop - top);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(0, top, CW, 3);
    }

    let eggY;
    if (phase === 'falling') eggY = eggYpx(matKey, h, pos.y);
    else if (phase === 'idle') eggY = Math.max(scenePadTop() + 14, eggYpx(matKey, h, h));
    else eggY = cushionTop + sink;

    if (phase === 'idle') {
      const xEgg = CW / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(232, 236, 247, 0.32)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(xEgg + 26, eggY);
      ctx.lineTo(xEgg + 26, cushionTop);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(xEgg + 20, eggY);
      ctx.lineTo(xEgg + 32, eggY);
      ctx.moveTo(xEgg + 20, cushionTop);
      ctx.lineTo(xEgg + 32, cushionTop);
      ctx.stroke();
      ctx.fillStyle = 'rgba(232, 236, 247, 0.75)';
      ctx.font = `600 13px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${dropHeight.toFixed(2)} m`, xEgg + 38, (eggY + cushionTop) / 2);
      ctx.restore();
    }

    drawEgg(CW / 2, eggY, phase === 'done' && record && record.broken);
  }

  function drawEgg(x, y, broken) {
    ctx.save();
    if (broken) {
      ctx.fillStyle = 'rgba(255, 224, 130, 0.95)';
      ctx.beginPath();
      ctx.ellipse(x, y, 18, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 197, 80, 1)';
      ctx.beginPath();
      ctx.arc(x, y - 1, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fdf6e3';
      for (const [dx, dy, rot] of [[-22, -2, -0.4], [-10, -6, 0.3], [12, -5, -0.2], [22, -1, 0.5]]) {
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, 6, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#fdf6e3';
      ctx.beginPath();
      ctx.ellipse(x, y - 14, 13, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.ellipse(x - 4, y - 22, 3.5, 6, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y - 14, 13, 18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── The force–time graph ────────────────────────────────────────────

  function graphRect() {
    return { left: 70, right: CW - 30, top: sceneBottom() + 50, bottom: CH - 30 };
  }

  function drawGraph() {
    const { left, right, top, bottom } = graphRect();

    ctx.fillStyle = 'rgba(22, 27, 48, 0.6)';
    ctx.fillRect(left - 50, top - 40, right - left + 80, bottom - top + 60);
    ctx.strokeStyle = 'rgba(110, 168, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 50, top - 40, right - left + 80, bottom - top + 60);

    ctx.fillStyle = '#e8ecf7';
    ctx.font = `700 15px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(i18nText('forceVsTime', 'Force vs time'), left - 40, top - 14);

    const live = phase === 'contact' ? record : null;
    const allDrops = drops.concat(live ? [live] : []);
    let maxT = 0.05;
    let maxF = BREAK_THRESHOLD * 1.2;
    for (const d of allDrops) {
      if (d.tc > maxT) maxT = d.tc;
      if (d.peak > maxF) maxF = d.peak;
    }
    maxT = Math.max(maxT * 1.1, 0.05);
    maxF = Math.max(maxF * 1.15, BREAK_THRESHOLD * 1.2);

    const xScale = (right - left) / maxT;
    const yScale = (bottom - top) / maxF;

    ctx.strokeStyle = 'rgba(232, 236, 247, 0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(232, 236, 247, 0.7)';
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 1; i <= 4; i++) {
      const F = (maxF / 4) * i;
      const y = bottom - F * yScale;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillText(`${F.toFixed(0)}`, left - 8, y);
    }
    ctx.fillStyle = 'rgba(232, 236, 247, 0.85)';
    ctx.fillText('F (N)', left - 8, top - 12);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(232, 236, 247, 0.7)';
    const xTickStep = niceTickStep(maxT * 1000, 6);
    for (let tms = 0; tms <= maxT * 1000 + 0.0001; tms += xTickStep) {
      const x = left + (tms / 1000) * xScale;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232, 236, 247, 0.18)';
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + 5);
      ctx.stroke();
      ctx.fillText(`${tms.toFixed(0)}`, x, bottom + 8);
    }
    ctx.fillStyle = 'rgba(232, 236, 247, 0.85)';
    ctx.fillText('t (ms)', right - 8, bottom + 22);

    ctx.strokeStyle = 'rgba(232, 236, 247, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(left, top - 4);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    const yThresh = bottom - BREAK_THRESHOLD * yScale;
    if (yThresh > top) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 107, 138, 0.55)';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(left, yThresh);
      ctx.lineTo(right, yThresh);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 107, 138, 0.85)';
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${i18nText('breakThresholdLabel', 'Break threshold')} ${BREAK_THRESHOLD} N`,
                   left + 6, yThresh - 4);
      ctx.restore();
    }

    for (const d of drops) drawCurve(d, left, bottom, xScale, yScale, false, 1);
    if (live) {
      // Fill in as it happens, so the area really is being swept out.
      drawCurve(live, left, bottom, xScale, yScale, true,
                Math.min(1, clock / COLLISION_VISUAL_DURATION));
    }

    drawLegend(left, top - 36, allDrops);
  }

  function drawCurve(d, left, bottom, xScale, yScale, active, upTo) {
    if (!d || d.samples.length < 2) return;
    const cut = d.tc * upTo;
    ctx.save();
    ctx.strokeStyle = d.color;
    ctx.lineWidth = active ? 2.6 : 1.7;
    ctx.globalAlpha = active ? 1 : 0.7;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    for (const s of d.samples) {
      if (s.t > cut) break;
      ctx.lineTo(left + s.t * xScale, bottom - s.F * yScale);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawLegend(x, y, allDrops) {
    if (allDrops.length === 0) return;
    ctx.save();
    ctx.font = `600 12px ${FONT}`;
    ctx.textBaseline = 'middle';
    let cursor = x + 80;
    const seen = new Set();
    for (const d of allDrops) {
      if (seen.has(d.materialKey)) continue;
      seen.add(d.materialKey);
      const label = i18nText(MATERIALS[d.materialKey].labelKey, d.materialKey);
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(cursor, y + 6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(232, 236, 247, 0.9)';
      ctx.textAlign = 'left';
      ctx.fillText(label, cursor + 10, y + 6);
      cursor += 12 + ctx.measureText(label).width + 20;
    }
    ctx.restore();
  }

  function niceTickStep(maxValue, target) {
    const raw = maxValue / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const r = raw / pow;
    return (r >= 5 ? 5 : r >= 2 ? 2 : 1) * pow;
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    drawScene();
    drawGraph();
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (running) advance(dt);
    draw();
    animId = requestAnimationFrame(tick);
  }

  // ── Input ───────────────────────────────────────────────────────────

  function selectMaterial(key) {
    if (!MATERIALS[key]) return;
    currentMaterialKey = key;
    materialList.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.key === key);
    });
    if (phase === 'done' || phase === 'idle') { phase = 'idle'; record = null; }
  }

  function wireEvents() {
    heightInput.addEventListener('input', () => {
      dropHeight = parseFloat(heightInput.value);
      heightValue.textContent = dropHeight.toFixed(2);
      if (phase === 'done') { phase = 'idle'; record = null; }
    });
    materialList.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.addEventListener('click', () => selectMaterial(btn.dataset.key));
    });
    dropBtn.addEventListener('click', startDrop);
    resetBtn.addEventListener('click', resetEgg);
    clearGraphBtn.addEventListener('click', clearGraph);
  }

  document.addEventListener('langchange', () => {
    updateReadoutsForLatest();
    draw();
  });

  function resizeCanvas() {
    // Un-pin the inline size from the previous pass before measuring —
    // otherwise the canvas can never grow back when the window widens
    // (it would keep re-measuring its own pinned width forever).
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    CW = Math.max(Math.round(rect.width), 320);
    CH = 780;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.style.setProperty('width', CW + 'px', 'important');
    canvas.style.setProperty('height', CH + 'px', 'important');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    draw();
  }

  /*
   * The hook the tests measure through: the contact law, one whole drop, and
   * the elastic reference the integrator is held against.
   */
  window.__impact = {
    EGG_MASS, G, BREAK_THRESHOLD, MATERIALS, CONTACT_DT, COLLISION_VISUAL_DURATION,
    params: () => ({ dropHeight, material: currentMaterialKey }),
    contactForce, contactAccel, simulate, elastic,
    drop: startDrop, reset: resetEgg, clear: clearGraph,
    select: selectMaterial,
    setRunning: (on) => { running = !!on; lastTs = 0; },
    advance: (dt) => { advance(dt); draw(); },
    phase: () => phase,
    record: () => record,
    drops: () => drops.slice(),
    eggPosition,
  };

  heightValue.textContent = dropHeight.toFixed(2);
  wireEvents();
  selectMaterial('medium');
  updateReadoutsForLatest();
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  // A hidden tab should not keep a physics loop alive, and coming back
  // should not hand the integrator one enormous dt. Drop the frame request
  // while hidden and restart from a fresh timestamp on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animId) { cancelAnimationFrame(animId); animId = null; }
    } else if (!animId) {
      lastTs = 0;
      animId = requestAnimationFrame(tick);
    }
  });

  animId = requestAnimationFrame(tick);
})();
