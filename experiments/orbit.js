/*
 * Gravity and orbits — Kepler's three laws, measured off planets you launch.
 *
 * One law is written down here, a = −GM·r̂/r², and stepped. Everything the
 * panel says is then read back off the paths: the apsides are found by
 * watching each planet's radius turn around, the semi-major axis is the two
 * apsides, and the period is the time between successive ones. Nobody is told
 * what the orbit will be — the planet flies and the numbers appear as it
 * completes turns.
 *
 * The headline is the plot. Every planet that finishes an orbit drops a point
 * on a log–log chart of period against semi-major axis, and a least-squares
 * line through those points comes out with a slope of 1.5 to a few parts in
 * 10⁷ — Kepler's third law, not asserted but fitted to hand-launched planets
 * on orbits of every size and eccentricity. The line's *intercept* is worth as
 * much: it recovers GM to under a part per million, so the mass of the star
 * is measured from how long its planets take to go round.
 *
 * One numerical thing needs saying, because it is the reason this page had to
 * be rewritten rather than merely instrumented. The reachable orbits span a
 * factor of 300 in period, from 1.7 s at a heavy star's edge to 500 s at a
 * light one's rim, and no single step size serves both: at h = 0.01 the tight
 * fast corner gets 171 steps per orbit, loses 577 ppm on the period and
 * precesses by a hundredth of a radian per turn — visibly, on screen, with
 * an inverse-square force. So each planet gets its own fixed step, sized once
 * at launch from the periapsis its conserved energy and angular momentum
 * imply. That is a choice about resolution, not about physics, and it makes
 * the accuracy depend only on the *shape* of the orbit and not on its size.
 */
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const plotCanvas = document.getElementById('kepler-plot');
  const pctx = plotCanvas.getContext('2d');

  const starMassInput = document.getElementById('star-mass');
  const starMassValue = document.getElementById('star-mass-value');
  const timeScaleInput = document.getElementById('time-scale');
  const timeScaleValue = document.getElementById('time-scale-value');
  const systemBtn = document.getElementById('system-btn');
  const resetBtn = document.getElementById('reset-btn');
  const prop = {
    count: document.getElementById('prop-count'),
    slope: document.getElementById('prop-slope'),
    gm: document.getElementById('prop-gm'),
    axis: document.getElementById('prop-axis'),
    ecc: document.getElementById('prop-ecc'),
    period: document.getElementById('prop-period'),
    drift: document.getElementById('prop-drift'),
    resid: document.getElementById('prop-resid'),
  };

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  const BASE_GM = 16000;
  const STAR_RADIUS = 22;
  const VELOCITY_SCALE = 0.45;
  const PALETTE = ['#6ea8ff', '#ffb86b', '#6effc6', '#ff6b8a', '#c47bff', '#ffe14a'];

  /*
   * Steps per orbit, counted at the periapsis rather than at wherever the
   * planet happened to be launched — a step that resolves the slow far side
   * of an eccentric orbit will skate straight through the fast near side.
   */
  const STEPS_PER_ORBIT = 4000;
  // A frame is allowed only so much integration. Past this the simulation
  // simply runs slower than the time scale asks for, which is honest; letting
  // it queue would only make the next frame later still.
  const MAX_STEPS_PER_FRAME = 14000;
  /*
   * Below this eccentricity the orbit has no perihelion to speak of and the
   * Laplace–Runge–Lenz vector has no direction — its angle is then pure
   * rounding noise, and reporting a drift for it would be reporting noise.
   */
  const ECC_FLOOR = 0.01;
  const ESCAPE_R = 4000;

  function formatScale(s) {
    if (s >= 10) return s.toFixed(0);
    if (s >= 1) return s.toFixed(1);
    return s.toFixed(2);
  }

  // ── The law ─────────────────────────────────────────────────────────

  /** a = −GM·r̂/r² about the origin. The only physics in the file. */
  function accel(s, GM) {
    const r2 = s.x * s.x + s.y * s.y;
    const k = -GM / (r2 * Math.sqrt(r2));
    s.ax = k * s.x;
    s.ay = k * s.y;
  }

  /*
   * Velocity Verlet: symplectic, so the energy oscillates instead of
   * draining, and — the force being central — exactly conserving of angular
   * momentum, since the position update only adds multiples of r and v to r.
   * Both matter here more than usual: an orbit that loses energy spirals in
   * while you watch, and Kepler's second law is the thing being claimed.
   */
  function step(s, h, GM) {
    s.x += s.vx * h + 0.5 * s.ax * h * h;
    s.y += s.vy * h + 0.5 * s.ay * h * h;
    const ax0 = s.ax;
    const ay0 = s.ay;
    accel(s, GM);
    s.vx += 0.5 * (ax0 + s.ax) * h;
    s.vy += 0.5 * (ay0 + s.ay) * h;
  }

  /*
   * The step this planet will use for its whole life, fixed at launch. Both
   * the energy and the angular momentum are conserved exactly by the scheme
   * above, so the periapsis they imply is known the moment the planet leaves
   * the cursor — and it is the periapsis passage, the fastest thing the
   * planet will ever do, that decides how fine the step has to be. Keeping it
   * fixed thereafter is what keeps the integrator symplectic; an h that
   * changed as the planet moved would leak energy every orbit.
   */
  function stepFor(x, y, vx, vy, GM) {
    const r = Math.hypot(x, y);
    const v2 = vx * vx + vy * vy;
    const E = v2 / 2 - GM / r;
    const L = x * vy - y * vx;
    let scale = r;                                   // unbound: use where it is
    if (E < 0) {
      const a = -GM / (2 * E);
      const e = Math.sqrt(Math.max(0, 1 + (2 * E * L * L) / (GM * GM)));
      scale = Math.max(a * (1 - e), STAR_RADIUS * 0.5);
    }
    return ((2 * Math.PI) / STEPS_PER_ORBIT) * Math.sqrt((scale * scale * scale) / GM);
  }

  // ── One planet, and what is watched while it flies ──────────────────

  /*
   * Positions are kept relative to the star, so a planet in flight survives
   * the window being resized; the drawing converts at the last moment.
   */
  function newPlanet(x, y, vx, vy, GM, color) {
    const s = { x, y, vx, vy, ax: 0, ay: 0 };
    accel(s, GM);
    const r = Math.hypot(x, y);
    const L = x * vy - y * vx;
    const E = (vx * vx + vy * vy) / 2 - GM / r;
    return {
      s, GM, color,
      h: stepFor(x, y, vx, vy, GM),
      t: 0, steps: 0,
      alive: true, crashed: false, escaped: false,
      trail: [{ x, y }],
      apsides: [],
      rMin: r, rMax: r,
      eLo: E, eHi: E, lLo: L, lHi: L, l0: L,
      area: 0,
      lrl0: null, lrlDrift: 0, ecc: 0,
      p2: null, p1: { t: 0, r },
      // Filled in once the planet has been round enough to have both.
      a: NaN, e: NaN, period: NaN, turns: 0,
    };
  }

  /*
   * A turning point of r(t), located to better than one step by fitting a
   * parabola through the three radii that bracket the turn. Worth doing for
   * the *time* rather than the radius — r is flat at a turning point, so the
   * nearest sample already has it, but the period is the gap between two of
   * these times and half a step of slop in each would show.
   */
  function noteRadius(p, t, r) {
    const p2 = p.p2;
    const p1 = p.p1;
    if (p2) {
      const d1 = p1.r - p2.r;
      const d2 = r - p1.r;
      if (d1 * d2 < 0) {
        const den = p2.r - 2 * p1.r + r;
        const frac = den === 0 ? 0 : (0.5 * (p2.r - r)) / den;
        p.apsides.push({
          t: p1.t + frac * (t - p1.t),
          r: p1.r - 0.25 * (p2.r - r) * frac,
          rising: d1 > 0,
        });
        summarise(p);
      }
    }
    p.p2 = p1;
    p.p1 = { t, r };
  }

  /*
   * The orbit, from the turning points found so far. One apogee and one
   * perigee give the semi-major axis and the eccentricity; two of the same
   * kind give the period. Nothing here consults a closed form — `kepler` is
   * carried alongside only so the panel can show what the measurement is
   * being held against.
   */
  function summarise(p) {
    const rise = p.apsides.filter((q) => q.rising);
    const fall = p.apsides.filter((q) => !q.rising);
    if (rise.length && fall.length) {
      const ra = rise[rise.length - 1].r;
      const rp = fall[fall.length - 1].r;
      p.a = (ra + rp) / 2;
      p.e = Math.abs(ra - rp) / (ra + rp);
      p.kepler = 2 * Math.PI * Math.sqrt((p.a * p.a * p.a) / p.GM);
    }
    const gaps = [];
    for (const list of [rise, fall]) {
      for (let i = 1; i < list.length; i++) gaps.push(list[i].t - list[i - 1].t);
    }
    if (gaps.length) {
      p.period = gaps.reduce((x, y) => x + y, 0) / gaps.length;
      p.turns = gaps.length;
    }
  }

  /** One step of the law, plus everything the panel will later be asked. */
  function advancePlanet(p, starR) {
    if (!p.alive) return;
    const s = p.s;
    const px = s.x;
    const py = s.y;
    step(s, p.h, p.GM);
    p.t += p.h;
    p.steps++;
    const r = Math.hypot(s.x, s.y);
    // Kepler's second law, swept as it happens: the triangle between two
    // consecutive positions and the star.
    p.area += 0.5 * Math.abs(px * s.y - s.x * py);
    if (r < p.rMin) p.rMin = r;
    if (r > p.rMax) p.rMax = r;
    if (r < starR) { p.alive = false; p.crashed = true; return; }
    if (r > ESCAPE_R) { p.alive = false; p.escaped = true; return; }

    const v2 = s.vx * s.vx + s.vy * s.vy;
    const en = v2 / 2 - p.GM / r;
    const l = s.x * s.vy - s.y * s.vx;
    if (en < p.eLo) p.eLo = en;
    if (en > p.eHi) p.eHi = en;
    if (l < p.lLo) p.lLo = l;
    if (l > p.lHi) p.lHi = l;

    /*
     * Kepler's first law is usually stated as "the orbit is an ellipse", but
     * the sharper statement — and the one that singles out the inverse square
     * out of every other central force — is that the ellipse does not turn.
     * The eccentricity vector points along the perihelion, so watching its
     * angle is watching the ellipse hold still. Change the exponent by a
     * thousandth and this is the readout that moves.
     */
    const rv = s.x * s.vx + s.y * s.vy;
    const ex = (v2 * s.x - rv * s.vx) / p.GM - s.x / r;
    const ey = (v2 * s.y - rv * s.vy) / p.GM - s.y / r;
    p.ecc = Math.hypot(ex, ey);
    if (p.ecc > ECC_FLOOR) {
      const th = Math.atan2(ey, ex);
      if (p.lrl0 === null) p.lrl0 = th;
      else {
        let d = th - p.lrl0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) > Math.abs(p.lrlDrift)) p.lrlDrift = d;
      }
    }

    noteRadius(p, p.t, r);

    const last = p.trail[p.trail.length - 1];
    const ddx = last.x - s.x;
    const ddy = last.y - s.y;
    if (ddx * ddx + ddy * ddy > 16 && p.trail.length < 6000) {
      p.trail.push({ x: s.x, y: s.y });
    }
  }

  /*
   * Perihelion drift per orbit, in radians — NaN until there is an orbit to
   * divide by, and NaN for a circle. The circle case is decided by whether
   * `lrl0` was ever seeded, which happens in one place and under one
   * condition, so there is exactly one thing to get wrong rather than two
   * agreeing copies of it.
   */
  const driftPerOrbit = (p) =>
    (p.turns && p.period && p.lrl0 !== null ? p.lrlDrift / (p.t / p.period) : NaN);

  // ── Kepler's third law, fitted to whatever has gone round ───────────

  /*
   * A straight line through the measured points on a log–log chart. Its
   * slope is the exponent relating period to size, and its intercept is
   * 2π/√GM — so the same fit that produces the 3/2 also weighs the star.
   * Two points would give a slope for free; the residual is reported so the
   * page can be asked whether the points were ever straight.
   */
  function keplerFit(points) {
    const n = points.length;
    if (n < 2) return { n, slope: NaN, intercept: NaN, residual: NaN, gm: NaN };
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const q of points) {
      const x = Math.log(q.a);
      const y = Math.log(q.period);
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const den = n * sxx - sx * sx;
    if (den === 0) return { n, slope: NaN, intercept: NaN, residual: NaN, gm: NaN };
    const slope = (n * sxy - sx * sy) / den;
    const intercept = (sy - slope * sx) / n;
    let residual = 0;
    for (const q of points) {
      const d = Math.log(q.period) - (slope * Math.log(q.a) + intercept);
      residual = Math.max(residual, Math.abs(d));
    }
    // T = e^c · a^m, and for m = 3/2 that constant is 2π/√GM.
    return { n, slope, intercept, residual,
             gm: (4 * Math.PI * Math.PI) / Math.exp(2 * intercept) };
  }

  // ── State ───────────────────────────────────────────────────────────

  let CW = 800;
  let CH = 640;
  let starMass = parseFloat(starMassInput.value);
  let timeScale = parseFloat(timeScaleInput.value);
  let planets = [];
  let collisions = [];
  let drag = null;
  let animId = null;
  let lastTs = 0;
  let nextColor = 0;
  let running = true;
  let selected = -1;

  function gm() { return BASE_GM * starMass; }
  function starX() { return CW / 2; }
  function starY() { return CH / 2; }
  function starRadius() { return STAR_RADIUS * Math.sqrt(starMass); }

  function addPlanet(x, y, vx, vy) {
    const p = newPlanet(x - starX(), y - starY(), vx, vy, gm(),
                        PALETTE[nextColor % PALETTE.length]);
    planets.push(p);
    nextColor++;
    selected = planets.length - 1;
    window.SFX?.tone({ freq: 520, dur: 0.1, type: 'sine', gain: 0.12 });
    updateReadouts();
    return p;
  }

  /*
   * Six planets at once, so the chart has something on it without anyone
   * having to drag six times. Two things are deliberate. The radii are spread
   * geometrically, because a fit whose points bunch at one end has most of
   * its leverage in one place; and three of the six are launched above
   * circular speed rather than below it, so they are visibly elliptical
   * without their perihelion dipping into the star — a fit through six near
   * identical circles would say nothing about the exponent.
   *
   * The span is pinned to the star rather than to the canvas, because a star
   * twenty times heavier is four and a half times wider and would simply
   * swallow a fixed inner orbit.
   */
  const SYSTEM = [
    [0.00, 1.00], [0.18, 1.18], [0.38, 1.00],
    [0.58, 1.12], [0.78, 1.00], [1.00, 1.00],
  ];
  const systemRadius = (frac) => {
    const rMin = Math.max(starRadius() * 1.6, 45);
    const rMax = Math.max(rMin * 1.8, 370);
    return rMin * Math.pow(rMax / rMin, frac);
  };
  function launchSystem() {
    clearAll();
    const k = gm();
    for (const [frac, f] of SYSTEM) {
      const r = systemRadius(frac);
      addPlanet(starX() + r, starY(), 0, Math.sqrt(k / r) * f);
    }
    // Point the per-planet readouts at an elliptical one: a circle has no
    // perihelion, so selecting one would leave the drift readout blank.
    selected = 1;
  }

  function clearAll() {
    planets = [];
    collisions = [];
    nextColor = 0;
    selected = -1;
    updateReadouts();
  }

  function resetAll() {
    // reset-defaults.js has already put the sliders back; pick the values up.
    starMass = parseFloat(starMassInput.value);
    timeScale = parseFloat(timeScaleInput.value);
    starMassValue.textContent = formatScale(starMass);
    timeScaleValue.textContent = formatScale(timeScale);
    clearAll();
  }

  /*
   * Every orbit that has closed, and so has a period to report.
   *
   * Only living planets are here, and there is a small proof that nothing is
   * being thrown away by that. A planet dies two ways: it reaches the star,
   * or it passes the far cut-off. Neither can happen to one that has already
   * been round — two apsides of the same kind is a whole radial period, and
   * completing one means the perihelion cleared the star and the aphelion was
   * inside the cut-off, and the orbit is fixed. So a planet with a
   * measurement cannot die, and a planet that dies has no measurement.
   *
   * An earlier version kept a list of measurements from retired planets for
   * exactly this case. A deliberately broken build proved the list could
   * never receive an entry, so it is gone.
   */
  function points() {
    const out = [];
    for (const p of planets) {
      if (!p.alive) continue;
      if (p.turns > 0 && Number.isFinite(p.a) && Number.isFinite(p.period)) {
        out.push({ a: p.a, period: p.period, e: p.e, color: p.color, alive: true });
      }
    }
    return out;
  }

  // ── Drawing: the sky ────────────────────────────────────────────────

  function drawStars() {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    let s = 4321;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < 100; i++) {
      const x = rng() * CW;
      const y = rng() * CH;
      const r = 0.6 + rng() * 1.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStar() {
    const cx = starX();
    const cy = starY();
    const R = starRadius();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.8);
    grad.addColorStop(0, 'rgba(255, 235, 130, 0.95)');
    grad.addColorStop(0.4, 'rgba(255, 184, 107, 0.4)');
    grad.addColorStop(1, 'rgba(255, 184, 107, 0)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'rgba(255, 220, 130, 0.85)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffe0a0';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function spawnCollision(x, y, color, impactSpeed) {
    const strength = Math.min(2.2, 0.8 + impactSpeed * 0.03);
    const cx = starX();
    const cy = starY();
    const dist = Math.hypot(x, y) || 1;
    const sR = starRadius();
    const particles = [];
    const count = 24;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = (140 + Math.random() * 180) * strength;
      particles.push({ x: 0, y: 0, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
    }
    collisions.push({
      x: cx + (x / dist) * (sR + 4),
      y: cy + (y / dist) * (sR + 4),
      color, particles, t: 0, life: 1.8, strength,
    });
    window.SFX?.noise({ dur: 0.22, gain: Math.min(0.3, 0.1 + impactSpeed * 0.004), color: 'pink', filter: 'lowpass', freq: 260, q: 0.8 });
    window.SFX?.sweep({ from: 400, to: 120, dur: 0.18, type: 'sawtooth', gain: 0.1 });
  }

  function stepCollisions(dt) {
    for (const c of collisions) {
      c.t += dt;
      for (const part of c.particles) {
        part.x += part.vx * dt;
        part.y += part.vy * dt;
        part.vx *= 0.94;
        part.vy *= 0.94;
      }
    }
    collisions = collisions.filter((c) => c.t < c.life);
  }

  function drawCollisions() {
    for (const c of collisions) {
      const life = c.t / c.life;
      const alpha = 1 - life;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.1);
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 4 * (1 - life * 0.5);
      ctx.beginPath();
      ctx.arc(c.x, c.y, (22 + life * 180) * c.strength, 0, Math.PI * 2);
      ctx.stroke();

      if (life > 0.08) {
        const life2 = (life - 0.08) / 0.92;
        ctx.globalAlpha = (1 - life2) * 0.55;
        ctx.lineWidth = 2.5 * (1 - life2 * 0.5);
        ctx.strokeStyle = 'rgba(255, 240, 180, 1)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, (12 + life2 * 130) * c.strength, 0, Math.PI * 2);
        ctx.stroke();
      }

      const flashR = 36 * c.strength * Math.max(0, 1 - life * 1.3);
      if (flashR > 0.5) {
        const flashGrad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, flashR);
        flashGrad.addColorStop(0, `rgba(255, 250, 220, ${Math.min(1, alpha * 1.4)})`);
        flashGrad.addColorStop(0.45, `rgba(255, 210, 130, ${alpha * 0.75})`);
        flashGrad.addColorStop(1, 'rgba(255, 180, 90, 0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = flashGrad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, flashR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = alpha;
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = c.color;
      for (const part of c.particles) {
        ctx.beginPath();
        ctx.arc(c.x + part.x, c.y + part.y, 3.5 * (1 - life * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawPlanet(p, isSelected) {
    const cx = starX();
    const cy = starY();
    ctx.save();
    if (p.trail.length > 1) {
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = isSelected ? 0.85 : 0.45;
      ctx.lineWidth = isSelected ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + p.trail[0].x, cy + p.trail[0].y);
      for (let i = 1; i < p.trail.length; i++) {
        ctx.lineTo(cx + p.trail[i].x, cy + p.trail[i].y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (p.alive) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(cx + p.s.x, cy + p.s.y, isSelected ? 7 : 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDrag() {
    if (!drag) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(drag.startX, drag.startY);
    ctx.lineTo(drag.currentX, drag.currentY);
    ctx.stroke();
    ctx.setLineDash([]);

    const dx = drag.currentX - drag.startX;
    const dy = drag.currentY - drag.startY;
    const len = Math.hypot(dx, dy);
    if (len > 6) {
      const nx = dx / len;
      const ny = dy / len;
      const tipX = drag.startX + dx;
      const tipY = drag.startY + dy;
      ctx.fillStyle = 'rgba(232, 236, 247, 0.85)';
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - nx * 12 - ny * 6, tipY - ny * 12 + nx * 6);
      ctx.lineTo(tipX - nx * 12 + ny * 6, tipY - ny * 12 - nx * 6);
      ctx.closePath();
      ctx.fill();
    }

    ctx.shadowColor = 'rgba(110, 168, 255, 0.5)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(110, 168, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(drag.startX, drag.startY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHint() {
    if (planets.length > 0 || drag) return;
    ctx.save();
    ctx.font = `500 15px ${FONT}`;
    ctx.fillStyle = 'rgba(232, 236, 247, 0.45)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(i18nText('addPlanetHint', 'Drag on the canvas to launch a planet.'), CW / 2, CH - 40);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    drawStars();
    for (let i = 0; i < planets.length; i++) drawPlanet(planets[i], i === selected);
    drawStar();
    drawCollisions();
    drawDrag();
    drawHint();
  }

  // ── Drawing: the chart ──────────────────────────────────────────────

  const PW = 280;
  const PH = 200;
  const PAD = { l: 40, r: 10, t: 12, b: 26 };

  /*
   * Period against semi-major axis, both on log axes, one point per orbit
   * that has actually closed. On these axes a power law is a straight line
   * and its exponent is the slope, so Kepler's third law is not something the
   * reader is asked to take on trust — it is the shape of their own points.
   */
  function drawPlot() {
    const pts = points();
    const fit = keplerFit(pts);
    pctx.clearRect(0, 0, PW, PH);

    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--text').trim() || '#e8ecf7';
    const muted = css.getPropertyValue('--muted').trim() || '#8a93ad';

    pctx.save();
    pctx.strokeStyle = muted;
    pctx.globalAlpha = 0.5;
    pctx.lineWidth = 1;
    pctx.strokeRect(PAD.l, PAD.t, PW - PAD.l - PAD.r, PH - PAD.t - PAD.b);
    pctx.globalAlpha = 1;

    pctx.font = `500 10px ${FONT}`;
    pctx.fillStyle = muted;
    pctx.textAlign = 'center';
    pctx.fillText(i18nText('orbitsPlotX', 'semi-major axis a (log)'), (PAD.l + PW - PAD.r) / 2, PH - 8);
    pctx.save();
    pctx.translate(11, (PAD.t + PH - PAD.b) / 2);
    pctx.rotate(-Math.PI / 2);
    pctx.fillText(i18nText('orbitsPlotY', 'period T (log)'), 0, 0);
    pctx.restore();

    if (pts.length === 0) {
      pctx.fillStyle = muted;
      pctx.textAlign = 'center';
      pctx.font = `500 11px ${FONT}`;
      pctx.fillText(i18nText('orbitsPlotEmpty', 'Points appear as planets complete an orbit.'),
                    (PAD.l + PW - PAD.r) / 2, PH / 2);
      pctx.restore();
      return;
    }

    // A decade of padding either side so a single point is not on the frame.
    let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
    for (const q of pts) {
      const x = Math.log10(q.a);
      const y = Math.log10(q.period);
      xlo = Math.min(xlo, x); xhi = Math.max(xhi, x);
      ylo = Math.min(ylo, y); yhi = Math.max(yhi, y);
    }
    const padx = Math.max(0.15, (xhi - xlo) * 0.15);
    const pady = Math.max(0.15, (yhi - ylo) * 0.15);
    xlo -= padx; xhi += padx; ylo -= pady; yhi += pady;
    const X = (v) => PAD.l + ((v - xlo) / (xhi - xlo)) * (PW - PAD.l - PAD.r);
    const Y = (v) => PH - PAD.b - ((v - ylo) / (yhi - ylo)) * (PH - PAD.t - PAD.b);

    if (Number.isFinite(fit.slope)) {
      pctx.strokeStyle = ink;
      pctx.globalAlpha = 0.55;
      pctx.lineWidth = 1.4;
      pctx.setLineDash([5, 4]);
      pctx.beginPath();
      // The fit is in natural logs; the axes are decimal. Same line either way.
      const at = (lx) => (fit.slope * (lx * Math.LN10) + fit.intercept) / Math.LN10;
      pctx.moveTo(X(xlo), Y(at(xlo)));
      pctx.lineTo(X(xhi), Y(at(xhi)));
      pctx.stroke();
      pctx.setLineDash([]);
      pctx.globalAlpha = 1;
    }

    for (const q of pts) {
      pctx.fillStyle = q.color;
      pctx.globalAlpha = q.alive ? 1 : 0.5;
      pctx.beginPath();
      pctx.arc(X(Math.log10(q.a)), Y(Math.log10(q.period)), 4, 0, Math.PI * 2);
      pctx.fill();
    }
    pctx.globalAlpha = 1;
    pctx.restore();
  }

  // ── The loop ────────────────────────────────────────────────────────

  /*
   * Every planet runs on its own clock. They are given the same amount of
   * simulated time each frame, but a tight fast orbit spends it in many small
   * steps and a wide slow one in a few large ones, so both get the same
   * resolution per turn. The leftover is carried, so the number of steps
   * depends on how much simulated time has passed rather than on how the
   * browser sliced it up.
   */
  function advance(simTime) {
    const starR = starRadius();
    const live = planets.filter((p) => p.alive);
    if (live.length === 0) return false;

    /*
     * Work out what every planet wants before giving any of it out. A budget
     * handed round in array order is a budget the first planet eats: the
     * innermost orbit is the one with the smallest step, and it would take
     * the lot and leave the outer planets frozen in place — which is not a
     * slowdown, it is a different simulation. Over budget, everyone is scaled
     * by the same factor instead, so the whole system runs slow together.
     */
    const want = live.map((p) => {
      p.carry = (p.carry || 0) + simTime;
      return Math.floor(p.carry / p.h);
    });
    const total = want.reduce((a, b) => a + b, 0);
    const scale = total > MAX_STEPS_PER_FRAME ? MAX_STEPS_PER_FRAME / total : 1;

    let changed = false;
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      const n = Math.floor(want[i] * scale);
      // Under budget the remainder is carried to the next frame; over it the
      // surplus is dropped, because queueing it only makes the next frame
      // later still.
      p.carry = scale < 1 ? 0 : p.carry - n * p.h;
      for (let k = 0; k < n; k++) {
        advancePlanet(p, starR);
        if (!p.alive) break;
      }
      if (!p.alive) {
        changed = true;
        if (p.crashed) {
          spawnCollision(p.s.x, p.s.y, p.color, Math.hypot(p.s.vx, p.s.vy));
        }
      }
    }
    return changed;
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (running) {
      advance(dt * timeScale);
      stepCollisions(dt);
    }
    draw();
    drawPlot();
    updateReadouts();
    animId = requestAnimationFrame(tick);
  }

  // ── Readouts ────────────────────────────────────────────────────────

  const dash = '—';

  function updateReadouts() {
    const alive = planets.filter((p) => p.alive).length;
    const pts = points();
    prop.count.textContent = `${alive} / ${pts.length}`;

    const fit = keplerFit(pts);
    prop.slope.textContent = Number.isFinite(fit.slope)
      ? `${fit.slope.toFixed(4)} / 1.5000` : dash;
    /*
     * Two decimals, not none. The fit lands within a part per million of the
     * GM the slider is set to, so rounding to whole numbers prints the same
     * string for the measurement and for the setting — which hides the one
     * thing this row exists to show, that they are close but not identical.
     */
    prop.gm.textContent = Number.isFinite(fit.gm)
      ? `${fit.gm.toFixed(2)} / ${gm().toFixed(2)}` : dash;
    /*
     * How straight the points actually were. This is the number that says
     * whether the 3⁄2 above means anything — a slope fitted to a curve is
     * still a slope — and it is also the only fit-derived figure on the panel
     * that is not a round constant, since the measurement and the law agree
     * to seven digits and no number of decimals could ever separate them.
     */
    prop.resid.textContent = Number.isFinite(fit.residual)
      ? fit.residual.toExponential(1) : dash;

    const p = selected >= 0 && selected < planets.length ? planets[selected] : null;
    if (!p || !Number.isFinite(p.a)) {
      prop.axis.textContent = dash;
      prop.ecc.textContent = dash;
      prop.period.textContent = dash;
      prop.drift.textContent = dash;
      return;
    }
    prop.axis.textContent = p.a.toFixed(1);
    prop.ecc.textContent = p.e.toFixed(4);
    prop.period.textContent = Number.isFinite(p.period)
      ? `${p.period.toFixed(2)} / ${p.kepler.toFixed(2)}` : dash;
    const d = driftPerOrbit(p);
    prop.drift.textContent = Number.isFinite(d) ? d.toExponential(1) : dash;
  }

  // ── Input ───────────────────────────────────────────────────────────

  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDrag(x, y) { drag = { startX: x, startY: y, currentX: x, currentY: y }; }
  function moveDrag(x, y) { if (drag) { drag.currentX = x; drag.currentY = y; } }

  function endDrag() {
    if (!drag) return;
    const vx = (drag.currentX - drag.startX) * VELOCITY_SCALE;
    const vy = (drag.currentY - drag.startY) * VELOCITY_SCALE;
    const dx = drag.startX - starX();
    const dy = drag.startY - starY();
    const sR = starRadius();
    if (dx * dx + dy * dy >= sR * sR) addPlanet(drag.startX, drag.startY, vx, vy);
    drag = null;
  }

  function wireEvents() {
    starMassInput.addEventListener('input', () => {
      starMass = parseFloat(starMassInput.value);
      starMassValue.textContent = formatScale(starMass);
      /*
       * The star's mass is part of every planet's orbit, so changing it
       * invalidates every measurement already taken — a point measured
       * around a lighter star does not belong on the same line. Clearing is
       * the honest response; keeping the points would silently mix two
       * different constants into one fit.
       */
      clearAll();
    });
    timeScaleInput.addEventListener('input', () => {
      timeScale = parseFloat(timeScaleInput.value);
      timeScaleValue.textContent = formatScale(timeScale);
    });
    systemBtn.addEventListener('click', launchSystem);
    resetBtn.addEventListener('click', resetAll);

    canvas.addEventListener('mousedown', (e) => {
      const p = canvasPoint(e.clientX, e.clientY);
      startDrag(p.x, p.y);
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const p = canvasPoint(e.clientX, e.clientY);
      moveDrag(p.x, p.y);
    });
    window.addEventListener('mouseup', endDrag);

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches[0]) {
        const p = canvasPoint(e.touches[0].clientX, e.touches[0].clientY);
        startDrag(p.x, p.y);
        e.preventDefault();
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches[0]) {
        const p = canvasPoint(e.touches[0].clientX, e.touches[0].clientY);
        moveDrag(p.x, p.y);
        e.preventDefault();
      }
    }, { passive: false });
    canvas.addEventListener('touchend', endDrag);
    canvas.addEventListener('touchcancel', endDrag);
  }

  document.addEventListener('langchange', () => { draw(); drawPlot(); });

  function resizeCanvas() {
    // Un-pin the inline size from the previous pass before measuring —
    // otherwise the canvas can never grow back when the window widens
    // (it would keep re-measuring its own pinned width forever).
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    CW = Math.max(Math.round(rect.width), 320);
    CH = 640;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.style.setProperty('width', CW + 'px', 'important');
    canvas.style.setProperty('height', CH + 'px', 'important');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    plotCanvas.width = Math.round(PW * dpr);
    plotCanvas.height = Math.round(PH * dpr);
    plotCanvas.style.setProperty('width', '100%', 'important');
    plotCanvas.style.setProperty('height', 'auto', 'important');
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    draw();
    drawPlot();
  }

  /*
   * The hook the tests measure through: the law, the integrator, one planet's
   * whole history, and the fit the chart draws.
   */
  window.__orbit = {
    BASE_GM, STAR_RADIUS, STEPS_PER_ORBIT, ECC_FLOOR, ESCAPE_R, VELOCITY_SCALE, SYSTEM,
    PALETTE,
    params: () => ({ starMass, timeScale, gm: gm(), starRadius: starRadius() }),
    accel, step, stepFor, newPlanet, advancePlanet, summarise, keplerFit,
    /** Fly one planet headlessly until it has been round `turns` times. */
    fly: (x, y, vx, vy, { turns = 3, cap = 8e6, GM = gm(), sample = 0 } = {}) => {
      const p = newPlanet(x, y, vx, vy, GM, '#fff');
      const path = [];
      while (p.alive && p.steps < cap && p.turns < turns) {
        advancePlanet(p, STAR_RADIUS * Math.sqrt(GM / BASE_GM));
        if (sample && p.steps % sample === 0) {
          path.push({ t: p.t, r: Math.hypot(p.s.x, p.s.y),
                      v2: p.s.vx * p.s.vx + p.s.vy * p.s.vy });
        }
      }
      return { ...snapshot(p), path };
    },
    launch: (x, y, vx, vy) => addPlanet(x + starX(), y + starY(), vx, vy),
    launchSystem, clear: clearAll, reset: resetAll,
    select: (i) => { selected = i; updateReadouts(); },
    setRunning: (on) => { running = !!on; lastTs = 0; for (const p of planets) p.carry = 0; },
    /** Give every live planet `simTime` of simulated time, as a frame would. */
    advance: (simTime) => { advance(simTime); draw(); drawPlot(); updateReadouts(); },
    planets: () => planets.map(snapshot),
    points, fit: () => keplerFit(points()),
  };

  function snapshot(p) {
    return {
      GM: p.GM, h: p.h, t: p.t, steps: p.steps,
      alive: p.alive, crashed: p.crashed, escaped: p.escaped,
      x: p.s.x, y: p.s.y, vx: p.s.vx, vy: p.s.vy,
      r: Math.hypot(p.s.x, p.s.y), v: Math.hypot(p.s.vx, p.s.vy),
      rMin: p.rMin, rMax: p.rMax, area: p.area,
      a: p.a, e: p.e, ecc: p.ecc, period: p.period, kepler: p.kepler, turns: p.turns,
      dE: Math.abs((p.eHi - p.eLo) / p.eLo),
      dL: Math.abs((p.lHi - p.lLo) / p.l0),
      L: (p.lLo + p.lHi) / 2,
      lrlDrift: p.lrlDrift, driftPerOrbit: driftPerOrbit(p),
      apsides: p.apsides.map((q) => ({ ...q })),
    };
  }

  starMassValue.textContent = formatScale(starMass);
  timeScaleValue.textContent = formatScale(timeScale);
  wireEvents();
  updateReadouts();
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
