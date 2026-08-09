/*
 * Newton's cannon, measured.
 *
 * One law is written down in this file — a = −GM·r̂/r² — and stepped with
 * velocity Verlet. Everything the panel then says about the result is read
 * back off the paths that come out: the apsides are found by watching r(t)
 * turn around, the period is the time between them, the eccentricity is the
 * two apsides, and the outcome is what the ball was seen to do.
 *
 * The two speeds the thought experiment is *about* are measured too, and that
 * is the part worth explaining. Fire five ordinary cannonballs, all of them
 * comfortably below escape speed, and measure how high each one gets. Plot
 * 1/r_apogee against 1/v₀² and the five points lie on a straight line — the
 * residuals are a tenth of a part per million, so this is the shape of the
 * data and not a flattering choice of shots. Follow that line down to zero
 * and the apogee has run away to infinity: escape speed. Follow it up to
 * 1/r₀ and the apogee is back at the muzzle: a circle. Both come out of five
 * bound shots, with √(GM/r) written nowhere, and both land within a part per
 * million of it. The panel prints the measurement beside the closed form so
 * the reader can watch the two agree instead of being told that they do.
 */
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const velocityInput = document.getElementById('velocity');
  const velocityValue = document.getElementById('velocity-value');
  const timeScaleInput = document.getElementById('time-scale');
  const timeScaleValue = document.getElementById('time-scale-value');
  const fireBtn = document.getElementById('fire-btn');
  const resetBtn = document.getElementById('reset-btn');
  const prop = {
    outcome: document.getElementById('prop-outcome'),
    speed: document.getElementById('prop-speed'),
    apsides: document.getElementById('prop-apsides'),
    ecc: document.getElementById('prop-ecc'),
    period: document.getElementById('prop-period'),
    vcirc: document.getElementById('prop-vcirc'),
    vesc: document.getElementById('prop-vesc'),
  };

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  const GM = 4000;
  const EARTH_R = 90;
  const MOUNTAIN_H = 28;
  const LAUNCH_R = EARTH_R + MOUNTAIN_H;

  /*
   * One fixed step for every integration on the page. The ball on the screen
   * and the headless shot the panel measures take the same steps from the
   * same start, so they are the same trajectory down to the last bit rather
   * than two nearly-equal ones — which also means the sim no longer runs
   * slightly differently on a 144 Hz display than on a 60 Hz one.
   */
  const H = 0.01;
  const MAX_STEPS_PER_FRAME = 900;
  const MAX_PROBE_STEPS = 400000;
  /*
   * How far from the muzzle radius a turning point has to be before it counts
   * as an apsis. Fire at exactly the circular speed and r never really turns
   * — it wobbles at the 10⁻⁸ level on rounding alone, and the first "apsis"
   * found would be whichever piece of noise came first, with a meaningless
   * time attached. Below this floor the orbit is a circle and its period is
   * taken from the angle swept instead.
   */
  const APSIS_FLOOR = 1e-6 * LAUNCH_R;
  // Far enough out that the screen lost the ball long ago; near enough that a
  // shot just under escape speed still finishes in a few milliseconds.
  const ESCAPE_R = 40 * LAUNCH_R;

  // Five bound shots, spread so their apogees span 180 px to 1370 px. Nothing
  // about the choice matters except that they are bound and distinct.
  const REFERENCE_SHOTS = [6.4, 6.8, 7.2, 7.6, 7.9];

  const PALETTE = ['#ffb86b', '#6effc6', '#ff6b8a', '#c47bff', '#6ea8ff', '#ffe14a'];

  function formatScale(s) {
    if (s >= 10) return s.toFixed(0);
    if (s >= 1) return s.toFixed(1);
    return s.toFixed(2);
  }

  // ── The law ─────────────────────────────────────────────────────────

  /** a = −GM·r̂/r², written into the state. The only physics in the file. */
  function accel(s) {
    const r2 = s.x * s.x + s.y * s.y;
    const k = -GM / (r2 * Math.sqrt(r2));
    s.ax = k * s.x;
    s.ay = k * s.y;
  }

  /*
   * Velocity Verlet: symplectic, second order, and — because the force is
   * central — exactly conserving of angular momentum, since the position
   * update only adds multiples of r and v to r. That is what keeps the
   * ellipse an ellipse: over a hundred orbits the energy wanders by a few
   * parts in 10⁸ instead of walking off in one direction.
   */
  function step(s, h) {
    s.x += s.vx * h + 0.5 * s.ax * h * h;
    s.y += s.vy * h + 0.5 * s.ay * h * h;
    const ax0 = s.ax;
    const ay0 = s.ay;
    accel(s);
    s.vx += 0.5 * (ax0 + s.ax) * h;
    s.vy += 0.5 * (ay0 + s.ay) * h;
  }

  // ── One shot, and what is watched while it flies ────────────────────

  /*
   * Positions are kept relative to the planet's centre, so a shot in flight
   * survives the window being resized — the drawing converts to canvas
   * coordinates at the last moment.
   */
  function newShot(v0) {
    const s = { x: 0, y: -LAUNCH_R, vx: v0, vy: 0, ax: 0, ay: 0 };
    accel(s);
    const L = s.x * s.vy - s.y * s.vx;
    const E = (v0 * v0) / 2 - GM / LAUNCH_R;
    return {
      v0, s, t: 0, steps: 0,
      alive: true, hit: false, escaped: false, far: false,
      apsides: [],
      rMin: LAUNCH_R, rMax: LAUNCH_R,
      eLo: E, eHi: E, lLo: L, lHi: L,
      area: 0,
      sweep: 0, thPrev: Math.atan2(s.y, s.x), revT: NaN,
      p2: null, p1: { t: 0, r: LAUNCH_R },
    };
  }

  /*
   * A turning point of r(t), located to better than one step. Three
   * consecutive radii that rise then fall (or fall then rise) sit on a
   * parabola, and its vertex is the apsis.
   *
   * What that buys is the *time*, not the radius. The radius is flat at a
   * turning point, so the nearest sampled step already has it to a part in
   * 10¹¹ and the reference fit below would not notice the difference. The
   * time of the turn is a different matter: taking the nearest step puts it
   * anywhere within half a step, and the period is twice it. Measured, that
   * is the difference between agreeing with 2π√(a³/GM) to a tenth of a part
   * per billion and agreeing with it to three parts in 10⁵.
   */
  function noteRadius(shot, t, r) {
    const p2 = shot.p2;
    const p1 = shot.p1;
    if (p2) {
      const d1 = p1.r - p2.r;
      const d2 = r - p1.r;
      if (d1 * d2 < 0) {
        const den = p2.r - 2 * p1.r + r;
        const frac = den === 0 ? 0 : (0.5 * (p2.r - r)) / den;
        shot.apsides.push({
          t: p1.t + frac * (t - p1.t),
          r: p1.r - 0.25 * (p2.r - r) * frac,
          rising: d1 > 0,
        });
      }
    }
    shot.p2 = p1;
    shot.p1 = { t, r };
  }

  /*
   * The other way to time an orbit: unwrap the polar angle and note when it
   * has swept a full turn. This costs a whole revolution where the apsis
   * method needs half of one, so it is the fallback rather than the default
   * — but it is the only one that survives a circular orbit, and having two
   * independent measurements of the same period is worth the bookkeeping.
   */
  function noteAngle(shot, s) {
    const th = Math.atan2(s.y, s.x);
    let d = th - shot.thPrev;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    shot.thPrev = th;
    const before = shot.sweep;
    shot.sweep += d;
    if (!Number.isNaN(shot.revT) || Math.abs(shot.sweep) < 2 * Math.PI || d === 0) return;
    const target = 2 * Math.PI * Math.sign(shot.sweep);
    shot.revT = shot.t - H + ((target - before) / d) * H;
  }

  /** One step of the law, plus everything the panel will later be asked. */
  function advanceShot(shot) {
    if (!shot.alive) return;
    const s = shot.s;
    const px = s.x;
    const py = s.y;
    step(s, H);
    shot.t += H;
    shot.steps++;
    const r = Math.hypot(s.x, s.y);
    // Kepler's second law, swept as it happens: the triangle between two
    // consecutive positions and the centre.
    shot.area += 0.5 * Math.abs(px * s.y - s.x * py);
    if (r < shot.rMin) shot.rMin = r;
    if (r > shot.rMax) shot.rMax = r;
    if (r < EARTH_R) { shot.alive = false; shot.hit = true; return; }
    const v2 = s.vx * s.vx + s.vy * s.vy;
    const e = v2 / 2 - GM / r;
    const l = s.x * s.vy - s.y * s.vx;
    if (e < shot.eLo) shot.eLo = e;
    if (e > shot.eHi) shot.eHi = e;
    if (l < shot.lLo) shot.lLo = l;
    if (l > shot.lHi) shot.lHi = l;
    noteRadius(shot, shot.t, r);
    noteAngle(shot, s);
    if (r > ESCAPE_R) {
      shot.alive = false;
      shot.far = true;
      shot.escaped = e >= 0;
    }
  }

  /*
   * The orbit, from one half of it.
   *
   * The launch is horizontal, so the muzzle is itself an apsis: the ball is
   * neither climbing nor falling at the instant it leaves. The next turning
   * point is therefore exactly half an orbit later, which is all that is
   * needed — the two apsides give the semi-major axis and the eccentricity,
   * and twice the time to the first one is the period. No closed form is
   * consulted to get any of them; `kepler` is carried alongside purely so the
   * panel can show what the measurement is being held against.
   */
  /** The first turning point far enough from the muzzle to be a real one. */
  const firstApsis = (shot) =>
    shot.apsides.find((a) => Math.abs(a.r - LAUNCH_R) > APSIS_FLOOR);

  function elements(shot) {
    const first = firstApsis(shot);
    const base = { ok: false, v0: shot.v0, hit: shot.hit, far: shot.far,
                   capped: shot.steps >= MAX_PROBE_STEPS, steps: shot.steps };
    let rp, ra, period, how;
    if (first) {
      rp = Math.min(LAUNCH_R, first.r);
      ra = Math.max(LAUNCH_R, first.r);
      period = 2 * first.t;
      how = 'apsis';
    } else if (!Number.isNaN(shot.revT)) {
      // A circle: no turning point to find, so the period is the full turn
      // and the two apsides are whatever the radius managed to wander to.
      rp = shot.rMin;
      ra = shot.rMax;
      period = shot.revT;
      how = 'revolution';
    } else {
      return base;
    }
    const a = (rp + ra) / 2;
    return {
      ...base, ok: true, how, rp, ra, a,
      e: (ra - rp) / (ra + rp),
      period,
      kepler: 2 * Math.PI * Math.sqrt((a * a * a) / GM),
      revolution: shot.revT,
    };
  }

  /*
   * Fire headlessly and stop as soon as the orbit has given up its shape:
   * at the first genuine turning point of the radius, which for a horizontal
   * launch is half an orbit, or — for the circle that has no turning point —
   * after one full revolution.
   */
  function probe(v0) {
    const shot = newShot(v0);
    while (shot.alive && shot.steps < MAX_PROBE_STEPS
           && !firstApsis(shot) && Number.isNaN(shot.revT)) {
      advanceShot(shot);
    }
    return elements(shot);
  }

  /** The same shot, sampled, for anything that wants the shape of the path. */
  function track(v0, { steps = 80000, every = 20 } = {}) {
    const shot = newShot(v0);
    const path = [];
    while (shot.alive && shot.steps < steps) {
      advanceShot(shot);
      if (shot.steps % every === 0) {
        const s = shot.s;
        path.push({
          t: shot.t, r: Math.hypot(s.x, s.y),
          v2: s.vx * s.vx + s.vy * s.vy,
          th: Math.atan2(s.y, s.x),
        });
      }
    }
    return { path, el: elements(shot), summary: summarise(shot) };
  }

  // ── The reference measurement: five apogees, one straight line ──────

  /*
   * For a horizontal launch from r₀ the apogee obeys 1/r_apogee =
   * (2GM/r₀²)·(1/v₀²) − 1/r₀, so measured apogees plotted against 1/v₀² fall
   * on a line. Nothing here uses that identity: the fit is an ordinary least
   * squares through five measured points, and the two speeds are where the
   * fitted line crosses two heights. Where it reaches zero the apogee is
   * unbounded — escape. Where it reaches 1/r₀ the apogee is the muzzle — a
   * circle. The residuals come back with it so the page can be asked whether
   * the points were ever straight enough for the extrapolation to mean
   * anything.
   */
  function calibrate() {
    const points = [];
    for (const v0 of REFERENCE_SHOTS) {
      const el = probe(v0);
      points.push({ v0, ra: el.ra, x: 1 / (v0 * v0), y: 1 / el.ra });
    }
    const n = points.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of points) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    let residual = 0;
    for (const p of points) {
      residual = Math.max(residual, Math.abs(p.y / (slope * p.x + intercept) - 1));
    }
    return {
      points, slope, intercept, residual,
      vEsc: 1 / Math.sqrt(-intercept / slope),
      vCirc: 1 / Math.sqrt((1 / LAUNCH_R - intercept) / slope),
    };
  }

  let reference = null;
  const ref = () => (reference || (reference = calibrate()));

  // ── State ───────────────────────────────────────────────────────────

  let CW = 800;
  let CH = 700;
  let trails = [];
  let activeIndex = -1;
  let animId = null;
  let lastTs = 0;
  let carry = 0;
  let nextColor = 0;
  let running = true;
  let timeScale = parseFloat(timeScaleInput.value);

  function centerX() { return CW / 2; }
  function centerY() { return CH * 0.55; }

  function launchSpeed() { return parseFloat(velocityInput.value); }

  function summarise(shot) {
    const s = shot.s;
    return {
      v0: shot.v0, t: shot.t, steps: shot.steps,
      alive: shot.alive, hit: shot.hit, escaped: shot.escaped, far: shot.far,
      x: s.x, y: s.y, vx: s.vx, vy: s.vy,
      r: Math.hypot(s.x, s.y), v: Math.hypot(s.vx, s.vy),
      rMin: shot.rMin, rMax: shot.rMax,
      area: shot.area,
      sweep: shot.sweep, revT: shot.revT,
      dE: Math.abs((shot.eHi - shot.eLo) / shot.eLo),
      dL: Math.abs((shot.lHi - shot.lLo) / shot.lLo),
      L: (shot.lLo + shot.lHi) / 2,
      apsides: shot.apsides.map((a) => ({ ...a })),
    };
  }

  function fire() {
    const v0 = launchSpeed();
    const shot = newShot(v0);
    trails.push({
      color: PALETTE[nextColor % PALETTE.length],
      points: [{ x: shot.s.x, y: shot.s.y }],
      shot,
      v0,
      // The identical shot, run ahead to its first apsis. It takes a few
      // milliseconds and it is the same sequence of steps the drawn ball is
      // about to take, so the panel can describe the orbit now rather than
      // several minutes of screen time from now.
      el: probe(v0),
    });
    nextColor++;
    activeIndex = trails.length - 1;
    if (trails.length > 5) {
      trails.shift();
      activeIndex--;
    }
    // Cannon boom — a low noise thump plus a downward report.
    window.SFX?.noise({ dur: 0.22, gain: 0.26, color: 'pink', filter: 'lowpass', freq: 240, q: 0.8 });
    window.SFX?.sweep({ from: 320, to: 90, dur: 0.2, type: 'sawtooth', gain: 0.14 });
    updateActiveReadouts();
  }

  function resetAll() {
    trails = [];
    activeIndex = -1;
    nextColor = 0;
    carry = 0;
    updateActiveReadouts();
  }

  /*
   * What the ball was seen to do. The only prediction is the half-orbit
   * already flown headlessly at launch, which is the same trajectory; the
   * escape case is decided against the *measured* escape speed rather than
   * against √(2GM/r₀), so no closed form decides what the reader is told.
   */
  function outcomeKey(trail) {
    if (!trail) return 'outcomeIdle';
    if (trail.shot.hit) return trail.shot.apsides.length ? 'outcomeCrashed' : 'outcomeFalls';
    if (trail.el.hit) return 'outcomeFalls';
    if (trail.v0 >= ref().vEsc) return 'outcomeEscapes';
    return 'outcomeOrbits';
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  function drawStars() {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    let s = 1234;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < 90; i++) {
      const x = rng() * CW;
      const y = rng() * CH;
      const r = 0.6 + rng() * 1.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEarth() {
    const cx = centerX();
    const cy = centerY();
    const grad = ctx.createRadialGradient(
      cx - EARTH_R * 0.35, cy - EARTH_R * 0.35, EARTH_R * 0.1,
      cx, cy, EARTH_R
    );
    grad.addColorStop(0, '#62a8e6');
    grad.addColorStop(0.6, '#2d5a9b');
    grad.addColorStop(1, '#152e57');

    ctx.save();
    ctx.shadowColor = 'rgba(110, 168, 255, 0.45)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, EARTH_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(110, 198, 145, 0.55)';
    drawContinent(cx, cy, EARTH_R, [
      [-0.5, -0.35, 0.18, 0.12],
      [0.3, -0.15, 0.22, 0.18],
      [-0.2, 0.4, 0.25, 0.1],
      [0.45, 0.35, 0.14, 0.1],
    ]);
    ctx.restore();

    ctx.strokeStyle = 'rgba(110, 168, 255, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, EARTH_R, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawContinent(cx, cy, R, blobs) {
    for (const [nx, ny, w, h] of blobs) {
      ctx.beginPath();
      ctx.ellipse(cx + nx * R, cy + ny * R, w * R, h * R, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMountain() {
    const cx = centerX();
    const cy = centerY();
    const top = cy - EARTH_R - MOUNTAIN_H;
    ctx.save();
    ctx.fillStyle = '#a07b58';
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx + 16, cy - EARTH_R + 2);
    ctx.lineTo(cx - 16, cy - EARTH_R + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3a4570';
    ctx.fillRect(cx - 12, top - 4, 24, 7);
    ctx.fillStyle = '#1a1f35';
    ctx.fillRect(cx + 6, top - 2, 12, 3);
    ctx.restore();
  }

  function drawReferenceCircle() {
    const cx = centerX();
    const cy = centerY();
    ctx.save();
    ctx.strokeStyle = 'rgba(110, 168, 255, 0.18)';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, LAUNCH_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawTrail(trail, isActive) {
    if (trail.points.length < 2) return;
    const cx = centerX();
    const cy = centerY();
    ctx.save();
    ctx.strokeStyle = trail.color;
    ctx.lineWidth = isActive ? 2.5 : 1.6;
    ctx.globalAlpha = isActive ? 1 : 0.55;
    ctx.beginPath();
    ctx.moveTo(cx + trail.points[0].x, cy + trail.points[0].y);
    for (let i = 1; i < trail.points.length; i++) {
      ctx.lineTo(cx + trail.points[i].x, cy + trail.points[i].y);
    }
    ctx.stroke();

    if (trail.shot.alive) {
      ctx.globalAlpha = 1;
      ctx.shadowColor = trail.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = trail.color;
      ctx.beginPath();
      ctx.arc(cx + trail.shot.s.x, cy + trail.shot.s.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawLegend() {
    const r = ref();
    const top = 24;
    ctx.save();
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const v = launchSpeed();
    ctx.fillStyle = 'rgba(110, 255, 198, 0.8)';
    ctx.fillText(`${i18nText('orbitalSpeedRef', 'Circular orbit')}: ${r.vCirc.toFixed(2)}`, 24, top);
    ctx.fillStyle = 'rgba(196, 123, 255, 0.85)';
    ctx.fillText(`${i18nText('escapeSpeedRef', 'Escape velocity')}: ${r.vEsc.toFixed(2)}`, 24, top + 22);

    ctx.font = `700 18px ${FONT}`;
    ctx.fillStyle = v < r.vCirc ? '#ff6b8a' : v < r.vEsc ? '#6effc6' : '#c47bff';
    ctx.textAlign = 'right';
    ctx.fillText(`v₀ = ${v.toFixed(2)}`, CW - 24, top + 4);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    drawStars();
    drawReferenceCircle();

    for (let i = 0; i < trails.length; i++) {
      drawTrail(trails[i], i === activeIndex);
    }

    drawEarth();
    drawMountain();
    drawLegend();
  }

  // ── The loop ────────────────────────────────────────────────────────

  /*
   * Fixed-step, with the leftover carried to the next frame, so the number of
   * steps depends on how much simulated time has passed and not on how the
   * browser happened to slice it up. When a frame asks for more steps than
   * the cap allows the surplus is dropped rather than queued: a backlog would
   * only make the next frame later still.
   */
  function advance(n) {
    for (let i = 0; i < n; i++) {
      for (const trail of trails) {
        const shot = trail.shot;
        if (!shot.alive) continue;
        advanceShot(shot);
        if (trail.points.length < 6000) {
          const last = trail.points[trail.points.length - 1];
          const dx = last.x - shot.s.x;
          const dy = last.y - shot.s.y;
          if (dx * dx + dy * dy > 4) trail.points.push({ x: shot.s.x, y: shot.s.y });
        }
        if (!shot.alive) {
          if (shot.escaped) window.SFX?.sweep({ from: 220, to: 880, dur: 0.5, type: 'sine', gain: 0.14 });
          else if (shot.hit) window.SFX?.noise({ dur: 0.18, gain: 0.2, color: 'pink', filter: 'lowpass', freq: 300, q: 0.8 });
        }
      }
    }
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (running) {
      carry += dt * timeScale;
      let n = Math.floor(carry / H);
      if (n > MAX_STEPS_PER_FRAME) { n = MAX_STEPS_PER_FRAME; carry = 0; }
      else carry -= n * H;
      advance(n);
    }
    draw();
    updateActiveReadouts();
    animId = requestAnimationFrame(tick);
  }

  // ── Readouts ────────────────────────────────────────────────────────

  function updateActiveReadouts() {
    const r = ref();
    prop.vcirc.textContent = `${r.vCirc.toFixed(3)} / ${Math.sqrt(GM / LAUNCH_R).toFixed(3)}`;
    prop.vesc.textContent = `${r.vEsc.toFixed(3)} / ${Math.sqrt((2 * GM) / LAUNCH_R).toFixed(3)}`;

    const trail = activeIndex >= 0 ? trails[activeIndex] : null;
    prop.outcome.textContent = i18nText(outcomeKey(trail), 'Ready');
    if (!trail) {
      prop.speed.textContent = '0.00';
      prop.apsides.textContent = '—';
      prop.ecc.textContent = '—';
      prop.period.textContent = '—';
      return;
    }
    prop.speed.textContent = Math.hypot(trail.shot.s.vx, trail.shot.s.vy).toFixed(2);
    const el = trail.el;
    if (!el.ok) {
      prop.apsides.textContent = '—';
      prop.ecc.textContent = '—';
      prop.period.textContent = '—';
      return;
    }
    prop.apsides.textContent =
      `${(el.rp - EARTH_R).toFixed(1)} / ${(el.ra - EARTH_R).toFixed(1)}`;
    prop.ecc.textContent = el.e.toFixed(4);
    prop.period.textContent = `${el.period.toFixed(1)} / ${el.kepler.toFixed(1)}`;
  }

  function wireEvents() {
    velocityInput.addEventListener('input', () => {
      velocityValue.textContent = parseFloat(velocityInput.value).toFixed(2);
    });
    timeScaleInput.addEventListener('input', () => {
      timeScale = parseFloat(timeScaleInput.value);
      timeScaleValue.textContent = formatScale(timeScale);
    });
    fireBtn.addEventListener('click', fire);
    resetBtn.addEventListener('click', resetAll);
  }

  document.addEventListener('langchange', () => {
    updateActiveReadouts();
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
    CH = 700;
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
   * The hook the tests measure through: the law, the integrator, a headless
   * shot, the reference fit, and enough of the live state to check that the
   * ball being drawn is the one the panel is describing.
   */
  window.__cannon = {
    GM, EARTH_R, MOUNTAIN_H, LAUNCH_R, H, ESCAPE_R, REFERENCE_SHOTS,
    params: () => ({ v0: launchSpeed(), timeScale }),
    accel, step, newShot, advanceShot, elements,
    probe, track, calibrate,
    reference: ref,
    fire, reset: resetAll,
    setRunning: (on) => { running = !!on; lastTs = 0; carry = 0; },
    isRunning: () => running,
    /** Step every live shot n times, exactly as a frame would. */
    tickSteps: (n) => { advance(n); draw(); updateActiveReadouts(); },
    shots: () => trails.map((t) => ({ v0: t.v0, el: t.el, outcome: outcomeKey(t),
                                      ...summarise(t.shot) })),
    active: () => (activeIndex >= 0 ? window.__cannon.shots()[activeIndex] : null),
  };

  velocityValue.textContent = parseFloat(velocityInput.value).toFixed(2);
  timeScaleValue.textContent = formatScale(timeScale);
  wireEvents();
  updateActiveReadouts();
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
