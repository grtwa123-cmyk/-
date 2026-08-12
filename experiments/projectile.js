/*
 * Projectile motion, integrated rather than plotted.
 *
 * This page used to evaluate the closed form and draw it:
 *
 *     x(t) = v₀cosθ·t,   y(t) = v₀sinθ·t − ½gt²,   R = v₀²sin2θ/g
 *
 * which is exact, and tells you nothing you did not already type in. What runs
 * now is Newton's second law with quadratic air drag,
 *
 *     ẍ = −b·|v|·vₓ
 *     ÿ = −g − b·|v|·v_y                b = drag coefficient / mass, in 1/m
 *
 * stepped with RK4. Range, apex and flight time are then *measured* off the
 * trajectory: the landing point is where y actually crosses zero, found by
 * bisection on the final step, and the apex is where v_y actually crosses
 * zero, found the same way. Nothing reads them off a formula.
 *
 * Two things fall out of that, and both are the point of the page:
 *
 *   · Set the drag to zero and the measurement lands on v₀²sin2θ/g to about
 *     one part in 10¹³ — the integrator proving itself against the one case
 *     where the answer is known exactly.
 *
 *   · Turn the drag up and it stops matching, in a specific way. The arc goes
 *     asymmetric: launched at 45° the ball comes down at 56° or 67°, because
 *     drag has bled away horizontal speed it never gets back. And the best
 *     launch angle is no longer 45°. Nowhere in this file is the number 45
 *     written down; "Find best angle" sweeps the model and reports what it
 *     finds — 45.00° in vacuum, 39.5° at b = 0.01, 37.0° at b = 0.02.
 */
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  let CW = 800;
  let CH = 460;

  const inputs = {
    velocity: document.getElementById('velocity'),
    angle: document.getElementById('angle'),
    gravity: document.getElementById('gravity'),
    drag: document.getElementById('drag'),
  };
  const inputValues = {
    velocity: document.getElementById('velocity-value'),
    angle: document.getElementById('angle-value'),
    gravity: document.getElementById('gravity-value'),
    drag: document.getElementById('drag-value'),
  };
  const out = {
    range: document.getElementById('out-range'),
    vacuum: document.getElementById('out-vacuum'),
    residual: document.getElementById('out-residual'),
    height: document.getElementById('out-height'),
    time: document.getElementById('out-time'),
    landAngle: document.getElementById('out-land-angle'),
    best: document.getElementById('out-best'),
    speed: document.getElementById('out-speed'),
  };
  const launchBtn = document.getElementById('launch-btn');
  const sweepBtn = document.getElementById('sweep-btn');
  const resetBtn = document.getElementById('reset-btn');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── The model ──────────────────────────────────────────────────────────
  // Fixed step. RK4 on this system is converged to eight significant figures
  // by 1/240 s across the whole slider range, so 1/400 has margin to spare.
  const H = 1 / 400;
  const MAX_STEPS = 200000;

  const deriv = (s, g, b) => {
    const v = Math.hypot(s.vx, s.vy);
    return { dx: s.vx, dy: s.vy, dvx: -b * v * s.vx, dvy: -g - b * v * s.vy };
  };

  function rk4(s, g, b, h) {
    const a = deriv(s, g, b);
    const s2 = { x: s.x + a.dx * h / 2, y: s.y + a.dy * h / 2, vx: s.vx + a.dvx * h / 2, vy: s.vy + a.dvy * h / 2 };
    const c = deriv(s2, g, b);
    const s3 = { x: s.x + c.dx * h / 2, y: s.y + c.dy * h / 2, vx: s.vx + c.dvx * h / 2, vy: s.vy + c.dvy * h / 2 };
    const d = deriv(s3, g, b);
    const s4 = { x: s.x + d.dx * h, y: s.y + d.dy * h, vx: s.vx + d.dvx * h, vy: s.vy + d.dvy * h };
    const e = deriv(s4, g, b);
    return {
      x: s.x + h / 6 * (a.dx + 2 * c.dx + 2 * d.dx + e.dx),
      y: s.y + h / 6 * (a.dy + 2 * c.dy + 2 * d.dy + e.dy),
      vx: s.vx + h / 6 * (a.dvx + 2 * c.dvx + 2 * d.dvx + e.dvx),
      vy: s.vy + h / 6 * (a.dvy + 2 * c.dvy + 2 * d.dvy + e.dvy),
    };
  }

  /** Sub-step from `s` to where `f` changes sign, to full double precision. */
  function refine(s, g, b, hi, f) {
    let lo = 0;
    for (let k = 0; k < 60; k++) {
      const m = (lo + hi) / 2;
      if (f(rk4(s, g, b, m)) > 0) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /**
   * Fly it, and measure what happened. Every number returned here comes off
   * the trajectory; none of them is looked up.
   */
  function fly(p, { sample = true } = {}) {
    const th = (p.theta * Math.PI) / 180;
    let s = { x: 0, y: 0, vx: p.v0 * Math.cos(th), vy: p.v0 * Math.sin(th) };
    const path = sample ? [{ t: 0, x: 0, y: 0, v: p.v0 }] : null;
    let t = 0;
    let apex = { t: 0, x: 0, y: 0 };
    let rising = s.vy > 0;

    for (let i = 0; i < MAX_STEPS; i++) {
      const prev = s, tPrev = t;
      s = rk4(s, p.g, p.b, H);
      t += H;

      // The apex is where v_y crosses zero, not simply the largest sample.
      if (rising && s.vy <= 0) {
        rising = false;
        const dt = refine(prev, p.g, p.b, H, (q) => q.vy);
        const top = rk4(prev, p.g, p.b, dt);
        apex = { t: tPrev + dt, x: top.x, y: top.y };
      }
      if (sample && i % 2 === 0) path.push({ t, x: s.x, y: s.y, v: Math.hypot(s.vx, s.vy) });

      if (s.y <= 0 && t > H) {
        const dt = refine(prev, p.g, p.b, H, (q) => q.y);
        const land = rk4(prev, p.g, p.b, dt);
        const tLand = tPrev + dt;
        if (sample) path.push({ t: tLand, x: land.x, y: 0, v: Math.hypot(land.vx, land.vy) });
        return {
          path, R: land.x, T: tLand, H: apex.y, apex,
          vLand: Math.hypot(land.vx, land.vy),
          angLand: (Math.atan2(-land.vy, land.vx) * 180) / Math.PI,
        };
      }
    }
    // Fired straight up, it lands where it started; this is the guard for the
    // degenerate corners of the sliders rather than a physical case.
    return { path, R: s.x, T: t, H: apex.y, apex, vLand: Math.hypot(s.vx, s.vy), angLand: 0 };
  }

  // The vacuum closed form, kept only so the measurement has something to be
  // compared against. Nothing drawn on this page comes from it.
  const vacRange = (p) => (p.v0 * p.v0 * Math.sin((2 * p.theta * Math.PI) / 180)) / p.g;
  const vacHeight = (p) => (p.v0 * Math.sin((p.theta * Math.PI) / 180)) ** 2 / (2 * p.g);
  const vacTime = (p) => (2 * p.v0 * Math.sin((p.theta * Math.PI) / 180)) / p.g;

  /**
   * The launch angle that carries furthest, found by sweeping the model —
   * coarse degree steps, then a golden-section refinement on the winner.
   * In vacuum this returns 45.000°; it has no idea that it should.
   */
  function bestAngle(p) {
    const at = (d) => fly({ ...p, theta: d }, { sample: false }).R;
    let best = 1, bestR = -Infinity;
    for (let d = 1; d <= 89; d++) {
      const r = at(d);
      if (r > bestR) { bestR = r; best = d; }
    }
    let lo = Math.max(0.01, best - 1), hi = Math.min(89.99, best + 1);
    const gr = (Math.sqrt(5) - 1) / 2;
    let c = hi - gr * (hi - lo), dd = lo + gr * (hi - lo);
    let fc = at(c), fd = at(dd);
    for (let k = 0; k < 40 && hi - lo > 1e-6; k++) {
      if (fc > fd) { hi = dd; dd = c; fd = fc; c = hi - gr * (hi - lo); fc = at(c); }
      else { lo = c; c = dd; fc = fd; dd = lo + gr * (hi - lo); fd = at(dd); }
    }
    const theta = (lo + hi) / 2;
    return { theta, R: at(theta) };
  }

  // ── State ──────────────────────────────────────────────────────────────
  let flight = null;          // the measured trajectory for the current params
  let ghost = null;           // the same launch with the drag switched off
  let best = null;            // { theta, R } once swept, else null
  let bestFor = '';           // the parameters that sweep belongs to
  let sweepCurve = null;      // [{ theta, R }] for the plot
  let flying = false;
  let flightT = 0;
  let raf = 0;
  let lastTs = 0;

  function readParams() {
    return {
      v0: parseFloat(inputs.velocity.value),
      theta: parseFloat(inputs.angle.value),
      g: parseFloat(inputs.gravity.value),
      b: parseFloat(inputs.drag.value),
    };
  }
  const signature = (p) => `${p.v0}|${p.g}|${p.b}`;

  function updateLabels(p) {
    inputValues.velocity.textContent = p.v0.toFixed(0);
    inputValues.angle.textContent = p.theta.toFixed(0);
    inputValues.gravity.textContent = p.g.toFixed(2);
    inputValues.drag.textContent = p.b.toFixed(4);
  }

  function remeasure() {
    const p = readParams();
    flight = fly(p);
    ghost = p.b > 0 ? fly({ ...p, b: 0 }) : null;
    if (bestFor !== signature(p)) { best = null; sweepCurve = null; }
    if (!flying) flightT = flight.T;
    updateReadouts(p);
  }

  const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

  function updateReadouts(p) {
    const f = flight;
    out.range.textContent = fmt(f.R);
    out.vacuum.textContent = fmt(vacRange(p));
    out.height.textContent = fmt(f.H);
    out.time.textContent = fmt(f.T, 3);
    out.landAngle.textContent = fmt(f.angLand, 1);

    // With no drag this is the integrator's own error, and belongs in
    // exponent form; with drag it is a physical shortfall, in metres.
    const diff = f.R - vacRange(p);
    if (p.b === 0) {
      const vac = vacRange(p);
      const rel = vac > 1e-9 ? Math.abs(diff) / vac : 0;
      out.residual.textContent = rel === 0 ? '0' : rel.toExponential(1);
    } else {
      out.residual.textContent = fmt(diff);
    }

    out.best.textContent = best ? `${best.theta.toFixed(2)}°` : '—';
    const at = flying ? sampleAt(flightT) : null;
    out.speed.textContent = at ? fmt(at.v) : fmt(f.vLand);
  }

  /** Linear interpolation into the measured path. */
  function sampleAt(t) {
    const path = flight.path;
    if (!path || !path.length) return null;
    if (t >= path[path.length - 1].t) return path[path.length - 1];
    let lo = 0, hi = path.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (path[m].t <= t) lo = m; else hi = m;
    }
    const a = path[lo], c = path[hi];
    const u = c.t === a.t ? 0 : (t - a.t) / (c.t - a.t);
    return { t, x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u, v: a.v + (c.v - a.v) * u };
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function layout() {
    const narrow = CW < 560;
    const sweepH = narrow ? 96 : 118;
    L = {
      narrow,
      fs: narrow ? 10 : 11,
      left: narrow ? 38 : 46, right: CW - (narrow ? 12 : 18),
      top: 22, bottom: CH - sweepH - (narrow ? 46 : 52),
      sTop: CH - sweepH - 6, sBot: CH - (narrow ? 26 : 28),
    };
  }

  const text = (str, x, y, colour, size, align) => {
    ctx.fillStyle = colour;
    ctx.font = `${size}px ui-monospace, monospace`;
    ctx.textAlign = align || 'left';
    ctx.fillText(str, x, y);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  function render() {
    ctx.clearRect(0, 0, CW, CH);
    const p = readParams();
    const f = flight;

    const worldR = Math.max(f.R, ghost ? ghost.R : 0, 1);
    const worldH = Math.max(f.H, ghost ? ghost.H : 0, 1);
    const w = L.right - L.left, h = L.bottom - L.top;
    const scale = Math.min(w / (worldR * 1.06), h / (worldH * 1.18));
    const X = (x) => L.left + x * scale;
    const Y = (y) => L.bottom - y * scale;

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L.left, Y(0) + 0.5); ctx.lineTo(L.right, Y(0) + 0.5); ctx.stroke();

    const stepX = niceStep(worldR);
    for (let x = 0; x <= worldR * 1.02; x += stepX) {
      const px = X(x);
      if (px > L.right) break;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(px, L.top); ctx.lineTo(px, Y(0)); ctx.stroke();
      text(String(Math.round(x)), px, Y(0) + 14, 'rgba(226,234,248,0.42)', L.fs, 'center');
    }
    const stepY = niceStep(worldH);
    for (let y = stepY; y <= worldH * 1.05; y += stepY) {
      const py = Y(y);
      if (py < L.top) break;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(L.left, py); ctx.lineTo(L.right, py); ctx.stroke();
      text(String(Math.round(y)), L.left - 6, py + 3.5, 'rgba(226,234,248,0.42)', L.fs, 'right');
    }

    // The vacuum path, for comparison, whenever drag is on.
    if (ghost) {
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(226,234,248,0.32)';
      ctx.lineWidth = 1.5;
      drawPath(ghost.path, X, Y);
      ctx.setLineDash([]);
      text(i18nText('projGhost', 'no-drag path'), Math.min(X(ghost.R), L.right), Y(0) - 8,
        'rgba(226,234,248,0.45)', L.fs, 'right');
    }

    ctx.strokeStyle = 'rgba(240,168,94,0.95)';
    ctx.lineWidth = 2.2;
    drawPath(f.path, X, Y);

    // Apex and landing, both measured off the trajectory.
    marker(X(f.apex.x), Y(f.apex.y), 'rgba(122,204,255,0.9)');
    marker(X(f.R), Y(0), 'rgba(120,240,180,0.9)');

    const at = flying ? sampleAt(flightT) : f.path[f.path.length - 1];
    if (at) {
      ctx.fillStyle = '#ffd08a';
      ctx.beginPath(); ctx.arc(X(at.x), Y(at.y), 5, 0, Math.PI * 2); ctx.fill();
    }

    text(i18nText('projAxisX', 'x (m)'), L.right, Y(0) + 28, 'rgba(226,234,248,0.5)', L.fs, 'right');
    text(i18nText('projAxisY', 'y (m)'), L.left, L.top - 8, 'rgba(226,234,248,0.5)', L.fs, 'left');

    // ── Range against launch angle, once swept.
    const sx0 = L.left, sx1 = L.right, sy0 = L.sTop, sy1 = L.sBot;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.moveTo(sx0, sy1 + 0.5); ctx.lineTo(sx1, sy1 + 0.5); ctx.stroke();
    text(i18nText('projAxisSweep', 'range vs launch angle'), sx0, sy0 - 6,
      'rgba(226,234,248,0.6)', L.fs, 'left');

    if (sweepCurve) {
      const maxR = Math.max(...sweepCurve.map((q) => q.R), 1e-9);
      const SX = (d) => sx0 + (d / 90) * (sx1 - sx0);
      const SY = (r) => sy1 - (r / maxR) * (sy1 - sy0);

      // Where 45° falls, so the shift away from it is seen rather than stated.
      ctx.strokeStyle = 'rgba(226,234,248,0.22)';
      ctx.beginPath(); ctx.moveTo(SX(45), sy0); ctx.lineTo(SX(45), sy1); ctx.stroke();
      text('45°', SX(45), sy1 + 13, 'rgba(226,234,248,0.4)', L.fs, 'center');

      ctx.strokeStyle = 'rgba(122,204,255,0.9)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      sweepCurve.forEach((q, i) => (i ? ctx.lineTo(SX(q.theta), SY(q.R)) : ctx.moveTo(SX(q.theta), SY(q.R))));
      ctx.stroke();

      if (best) {
        ctx.strokeStyle = 'rgba(120,240,180,0.85)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(SX(best.theta), sy0); ctx.lineTo(SX(best.theta), sy1); ctx.stroke();
        ctx.setLineDash([]);
        marker(SX(best.theta), SY(best.R), 'rgba(120,240,180,0.95)');
        text(`${best.theta.toFixed(2)}°`, SX(best.theta) + (best.theta > 60 ? -6 : 6), sy0 + 10,
          'rgba(150,245,200,0.95)', L.fs, best.theta > 60 ? 'right' : 'left');
      }
      text('0°', SX(0), sy1 + 13, 'rgba(226,234,248,0.4)', L.fs, 'left');
      text('90°', SX(90), sy1 + 13, 'rgba(226,234,248,0.4)', L.fs, 'right');
    } else {
      text(i18nText('projSweepHint', 'press "Find best angle" — nothing here assumes it is 45°'),
        (sx0 + sx1) / 2, (sy0 + sy1) / 2 + 4, 'rgba(226,234,248,0.35)', L.fs, 'center');
    }
  }

  function drawPath(path, X, Y) {
    ctx.beginPath();
    path.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
    ctx.stroke();
  }
  function marker(x, y, colour) {
    ctx.fillStyle = colour;
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
  }
  function niceStep(span) {
    const raw = span / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;

    if (flying) {
      flightT += dt;
      if (flightT >= flight.T) {
        flightT = flight.T;
        flying = false;
        launchBtn.textContent = i18nText('launchBtn', 'Launch');
      }
      updateReadouts(readParams());
    }
    render();
  }
  function start() { cancelAnimationFrame(raf); lastTs = 0; raf = requestAnimationFrame(frame); }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function onInput() {
    const p = readParams();
    updateLabels(p);
    remeasure();
  }
  for (const el of Object.values(inputs)) el.addEventListener('input', onInput);

  launchBtn.addEventListener('click', () => {
    flying = true;
    flightT = 0;
    launchBtn.textContent = i18nText('launchingBtn', 'Launching…');
    window.SFX?.tone({ freq: 320, dur: 0.1, type: 'triangle', gain: 0.12 });
  });

  sweepBtn.addEventListener('click', () => {
    const p = readParams();
    sweepBtn.disabled = true;
    sweepBtn.textContent = i18nText('projSweeping', 'sweeping…');
    // Yield two frames so the label paints before the sweep blocks the thread.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const curve = [];
      for (let d = 0; d <= 90; d += 1) {
        curve.push({ theta: d, R: fly({ ...p, theta: d }, { sample: false }).R });
      }
      sweepCurve = curve;
      best = bestAngle(p);
      bestFor = signature(p);
      sweepBtn.disabled = false;
      sweepBtn.textContent = i18nText('projSweepBtn', 'Find best angle');
      updateReadouts(p);
      window.SFX?.tone({ freq: 520, dur: 0.12, type: 'sine', gain: 0.1 });
    }));
  });

  resetBtn.addEventListener('click', () => {
    flying = false;
    best = null; sweepCurve = null; bestFor = '';
    launchBtn.textContent = i18nText('launchBtn', 'Launch');
    onInput();
    window.SFX?.click({ gain: 0.2 });
  });

  document.addEventListener('langchange', () => {
    launchBtn.textContent = i18nText(flying ? 'launchingBtn' : 'launchBtn', 'Launch');
    sweepBtn.textContent = i18nText('projSweepBtn', 'Find best angle');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf); else start();
  });

  function resizeCanvas() {
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    CW = Math.max(Math.round(rect.width), 320);
    CH = 460;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.style.setProperty('width', CW + 'px', 'important');
    canvas.style.setProperty('height', CH + 'px', 'important');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
  }
  window.addEventListener('resize', resizeCanvas);

  // Exposed so the harness can hold the measurement against the closed form.
  /*
   * The trajectory, as measured, for anyone who wants to plot it themselves.
   * Built at click time from the current flight rather than from a cached
   * copy, so the file holds what the panel is showing.
   */
  if (window.CSVExport) {
    window.CSVExport.attach("csv-btn", () => {
      const f = flight;
      if (!f) return null;
      const q = readParams();
      return {
        name: "projectile-v" + q.v0 + "-a" + q.theta + "-b" + q.b + ".csv",
        title: "Projectile Motion",
        columns: ["t_s", "x_m", "y_m", "speed_ms"],
        rows: f.path.map((s) => [s.t, s.x, s.y, s.v]),
        meta: {
          v0_ms: q.v0, angle_deg: q.theta, g_ms2: q.g, drag_b: q.b, step_h_s: H,
          measured_range_m: f.R, measured_apex_m: f.H,
          measured_flight_time_s: f.T,
          measured_landing_speed_ms: f.vLand,
          measured_landing_angle_deg: f.angLand,
          vacuum_range_m: vacRange(q),
        },
      };
    });
  }

  window.__proj = {
    H, params: readParams, fly, bestAngle,
    vacRange, vacHeight, vacTime,
    flight: () => flight,
    sweep: () => sweepCurve,
    best: () => best,
    isFlying: () => flying,
    remeasure,
  };

  resizeCanvas();
  onInput();
  start();
})();
