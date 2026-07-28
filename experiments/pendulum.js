/*
 * Three pendulums, one page.
 *
 *   wave      A row of pendulums whose lengths shrink by a fixed ratio, so
 *             each runs a little faster than the last. RK4 on
 *             θ̈ = −(g/L)·sin θ − b·θ̇ — the full nonlinear equation, not the
 *             small-angle one, so the period visibly lengthens past ~30°.
 *
 *   foucault  The same pendulum written in Earth's rotating frame, where the
 *             Coriolis term couples the two horizontal directions:
 *                 ζ̈ + 2iΩ_z ζ̇ + ω²ζ = 0,   ζ = x + iy,  Ω_z = Ω⊕·sin φ
 *             That linear system has an exact solution — the ordinary planar
 *             swing multiplied by e^{−iΩ_z t}, i.e. the same swing with its
 *             plane turning at Ω_z. We evaluate it in closed form rather than
 *             integrating, because watching precession needs the clock run
 *             thousands of times fast and no integrator survives that. A full
 *             turn therefore takes one sidereal day / |sin φ|: 23.93 h at the
 *             pole, 31.8 h in Paris, never at the equator.
 *
 *   newton    A row of touching balls, each its own pendulum, with one rule
 *             at contact: two equal masses meeting head-on elastically swap
 *             velocities. Nothing counts balls — pull back k and exactly k
 *             leave because that is the only outcome conserving momentum and
 *             kinetic energy together. It only works if the collisions happen
 *             one after another, so the balls rest a hair apart, as real
 *             cradles do; a truly simultaneous multi-ball collision has no
 *             unique answer.
 */

(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  let CW = 800;
  let CH = 400;

  const inputs = {
    length: document.getElementById('length'),
    gravity: document.getElementById('gravity'),
    angle: document.getElementById('angle'),
    damping: document.getElementById('damping'),
    count: document.getElementById('count'),
    latitude: document.getElementById('latitude'),
    timescale: document.getElementById('timescale'),
    balls: document.getElementById('balls'),
    pulled: document.getElementById('pulled'),
  };
  const inputValues = {
    length: document.getElementById('length-value'),
    gravity: document.getElementById('gravity-value'),
    angle: document.getElementById('angle-value'),
    damping: document.getElementById('damping-value'),
    count: document.getElementById('count-value'),
    latitude: document.getElementById('latitude-value'),
    timescale: document.getElementById('timescale-value'),
    balls: document.getElementById('balls-value'),
    pulled: document.getElementById('pulled-value'),
  };
  const out = {
    period: document.getElementById('out-period'),
    angle: document.getElementById('out-angle'),
    angvel: document.getElementById('out-angvel'),
    time: document.getElementById('out-time'),
    x1: document.getElementById('out-x1'),
    x2: document.getElementById('out-x2'),
  };
  const unit = {
    period: document.getElementById('unit-period'),
    angle: document.getElementById('unit-angle'),
    angvel: document.getElementById('unit-angvel'),
    time: document.getElementById('unit-time'),
    x1: document.getElementById('unit-x1'),
    x2: document.getElementById('unit-x2'),
  };
  const lab = {
    period: document.getElementById('lab-period'),
    angle: document.getElementById('lab-angle'),
    angvel: document.getElementById('lab-angvel'),
    time: document.getElementById('lab-time'),
    x1: document.getElementById('lab-x1'),
    x2: document.getElementById('lab-x2'),
  };
  const slotX1 = document.getElementById('slot-x1');
  const slotX2 = document.getElementById('slot-x2');
  const modeList = document.getElementById('mode-list');
  const angleLabel = document.getElementById('angle-label');
  const startBtn = document.getElementById('start-btn');
  const resetBtn = document.getElementById('reset-btn');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : '0.00';

  const WAVE_K = 30;

  // Earth's sidereal rotation. Using the sidereal day rather than the 24 h
  // solar day is what makes the polar precession come out at 23.93 h, not 24.
  const SIDEREAL_DAY = 86164.0905;                  // s
  const OMEGA_EARTH = (2 * Math.PI) / SIDEREAL_DAY; // 7.2921159e-5 rad/s

  let mode = 'wave';

  function readParams() {
    return {
      L: parseFloat(inputs.length.value),
      g: parseFloat(inputs.gravity.value),
      theta0: toRad(parseFloat(inputs.angle.value)),
      b: parseFloat(inputs.damping.value),
      N: parseInt(inputs.count.value, 10),
      lat: parseFloat(inputs.latitude.value),
      scale: parseFloat(inputs.timescale.value),
      balls: parseInt(inputs.balls.value, 10),
      pulled: parseInt(inputs.pulled.value, 10),
    };
  }

  // ── Foucault ───────────────────────────────────────────────────────────
  // In a frame turning with Earth, a bob swinging in the local horizontal
  // plane (x east, y north) feels the Coriolis acceleration −2Ω⃗ × ṙ. With
  // Ω⃗ = Ω(0, cos φ, sin φ) only the vertical component survives in-plane:
  //     ẍ = −ω²x + 2Ω_z ẏ,   ÿ = −ω²y − 2Ω_z ẋ,   Ω_z = Ω⊕ sin φ
  // which in ζ = x + iy is ζ̈ + 2iΩ_z ζ̇ + ω²ζ = 0. (The centrifugal term is
  // static and simply folds into the local g, so it changes ω and nothing
  // else.) Substituting ζ = e^{λt} gives λ = −iΩ_z ± iω′ with ω′ = √(ω²+Ω_z²),
  // hence the exact solution below; releasing from rest at ζ = A fixes the
  // two amplitudes. The leading e^{−iΩ_z t} is the whole of the precession —
  // an ordinary planar swing whose plane turns at Ω_z, and nothing else.
  const foucault = {
    Oz: 0, omega: 0, omegaP: 0, Ap: 0, Am: 0, A: 0,
    setup(L, g, theta0, latDeg) {
      this.A = L * Math.sin(Math.abs(theta0));
      this.omega = Math.sqrt(Math.max(g, 1e-9) / Math.max(L, 1e-9));
      this.Oz = OMEGA_EARTH * Math.sin(toRad(latDeg));
      this.omegaP = Math.sqrt(this.omega * this.omega + this.Oz * this.Oz);
      const r = this.Oz / this.omegaP;
      this.Ap = (this.A * (1 + r)) / 2;
      this.Am = (this.A * (1 - r)) / 2;
    },
    /** Swing-plane azimuth after t seconds, measured CCW from the start. */
    planeAngle(t) { return -this.Oz * t; },
    /** Seconds for the plane to come back round; Infinity on the equator. */
    precessionPeriod() {
      return this.Oz === 0 ? Infinity : (2 * Math.PI) / Math.abs(this.Oz);
    },
    /** Bob position in the rotating (ground) frame, metres. */
    position(t) {
      const c = Math.cos(this.omegaP * t), s = Math.sin(this.omegaP * t);
      // A₊e^{iω′t} + A₋e^{−iω′t}
      const px = (this.Ap + this.Am) * c;
      const py = (this.Ap - this.Am) * s;
      const cp = Math.cos(this.Oz * t), sp = Math.sin(this.Oz * t);
      // multiply by e^{−iΩ_z t}
      return { x: px * cp + py * sp, y: py * cp - px * sp };
    },
  };
  let fouT = 0;              // simulated seconds
  let pegs = [];             // knocked-over ring, the classic demo

  function initPegs() {
    pegs = [];
    for (let i = 0; i < 36; i++) pegs.push({ az: (i / 36) * Math.PI * 2, down: false });
  }

  // ── Newton's cradle ────────────────────────────────────────────────────
  // Balls rest a hair apart so strikes resolve one at a time. Perfect contact
  // would make the multi-ball collision simultaneous, and a simultaneous
  // elastic collision between three or more bodies has no unique solution.
  const GAP = 0.004;         // m of clear air between neighbours at rest
  let cradle = [];           // { theta, omega }
  let collisions = 0;
  let energy0 = 0;

  function cradleEnergy(L, g) {
    let e = 0;
    for (const b of cradle) {
      e += 0.5 * L * L * b.omega * b.omega + g * L * (1 - Math.cos(b.theta));
    }
    return e;                // per unit mass, J/kg
  }

  function initCradle(n, k, theta0) {
    cradle = [];
    const pull = -Math.abs(theta0);
    for (let i = 0; i < n; i++) cradle.push({ theta: i < k ? pull : 0, omega: 0 });
    collisions = 0;
  }

  /**
   * Resolve contacts. Two neighbours touch when the gap between their bobs
   * closes; equal masses exchange angular velocity, and the pass repeats
   * until no approaching contact is left, so one strike propagates through
   * the whole row in a single instant.
   *
   * The plain swap is exact here, not an approximation. An elastic collision
   * exchanges the velocity components along the line of centres, and every
   * contact in this row happens with both bobs at the bottom of their arcs:
   * a raised group all move identically and so never close on each other,
   * which leaves only the front ball reaching the resting stack, and it can
   * only reach it near θ = 0 (contact needs L·(sin θᵢ − sin θᵢ₊₁) ≥ 4 mm
   * against neighbours hanging at rest). There the line of centres is
   * horizontal and both velocities are perpendicular to vertical strings, so
   * the exchange is total — and swapping ω between two identical pendulums
   * conserves Σ½mL²ω² and Σ mLω exactly, both laws at once.
   */
  function resolveContacts(L) {
    for (let pass = 0; pass < cradle.length + 2; pass++) {
      let touched = false;
      for (let i = 0; i < cradle.length - 1; i++) {
        const a = cradle[i], b = cradle[i + 1];
        const closed = L * (Math.sin(a.theta) - Math.sin(b.theta)) >= GAP;
        if (closed && a.omega > b.omega) {
          const t = a.omega; a.omega = b.omega; b.omega = t;
          touched = true;
          collisions++;
          const v = Math.abs(a.omega - b.omega) * L;
          window.SFX?.click({ gain: Math.min(0.3, 0.06 + v * 0.12), freq: 2600, q: 6 });
        }
      }
      if (!touched) break;
    }
  }

  function lengthForIndex(i, N, Lbase) {
    if (N <= 1) return Lbase;
    const factor = WAVE_K / (WAVE_K + i);
    return Lbase * factor * factor;
  }

  function smallAnglePeriod(L, g) {
    const safeG = g > 0 ? g : 0.0001;
    return 2 * Math.PI * Math.sqrt(L / safeG);
  }

  let pendulums = [];
  let elapsed = 0;
  let activeParams = null;
  let running = false;
  let animId = null;
  let lastTs = 0;

  function pivotForIndex(i, N) {
    const padding = 40;
    const y = CH * 0.12;
    if (N <= 1) return { x: CW / 2, y };
    const totalW = CW - 2 * padding;
    return { x: padding + (totalW * i) / (N - 1), y };
  }

  function pixelsPerMeter(Lmax) {
    const yTop = CH * 0.12;
    const available = CH - yTop - 30;
    return available / Math.max(Lmax, 0.0001);
  }

  function colorForIndex(i, N) {
    if (N <= 1) return '#ffb86b';
    const hue = 25 + (200 * i) / Math.max(N - 1, 1);
    return `hsl(${hue}, 80%, 62%)`;
  }

  function drawScene(N, Lbase) {
    ctx.clearRect(0, 0, CW, CH);

    const ppm = pixelsPerMeter(Lbase);

    if (N > 1) {
      const left = pivotForIndex(0, N);
      const right = pivotForIndex(N - 1, N);
      ctx.save();
      ctx.strokeStyle = 'rgba(110, 168, 255, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left.x - 20, left.y);
      ctx.lineTo(right.x + 20, right.y);
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < N; i++) {
      const p = pendulums[i];
      const piv = pivotForIndex(i, N);
      const lengthPx = p.L * ppm;
      const bobX = piv.x + lengthPx * Math.sin(p.theta);
      const bobY = piv.y + lengthPx * Math.cos(p.theta);

      ctx.save();
      ctx.strokeStyle = 'rgba(232, 236, 247, 0.85)';
      ctx.lineWidth = N > 8 ? 1 : 1.5;
      ctx.beginPath();
      ctx.moveTo(piv.x, piv.y);
      ctx.lineTo(bobX, bobY);
      ctx.stroke();

      ctx.fillStyle = '#3a4570';
      ctx.beginPath();
      ctx.arc(piv.x, piv.y, N > 12 ? 3 : 4, 0, Math.PI * 2);
      ctx.fill();

      const bobR = N > 12 ? 7 : N > 6 ? 9 : 12;
      ctx.fillStyle = colorForIndex(i, N);
      ctx.shadowColor = 'rgba(255, 184, 107, 0.4)';
      ctx.shadowBlur = N > 10 ? 6 : 10;
      ctx.beginPath();
      ctx.arc(bobX, bobY, bobR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Foucault drawing: looking straight down ────────────────────────────
  function drawFoucault(p) {
    ctx.clearRect(0, 0, CW, CH);
    const cx = CW / 2, cy = CH / 2;
    const R = Math.min(CW, CH) * 0.38;
    const A = foucault.A > 0 ? foucault.A : 1e-6;
    const ppm = R / A;                       // metres → px, amplitude fills R
    const plane = foucault.planeAngle(fouT);

    // Swept sector: everything the plane has already turned through. The
    // plane has two ends, so shade both — that is what the fallen pegs record.
    if (Math.abs(plane) > 1e-4) {
      ctx.fillStyle = 'rgba(110, 168, 255, 0.10)';
      for (const base of [0, Math.PI]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R * 1.06, base, base - plane, plane > 0);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Compass, so the direction of turn is readable.
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(226,234,248,0.42)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const marks = [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]];
    for (const [t, dx, dy] of marks) {
      ctx.fillText(t, cx + dx * R * 1.22, cy + dy * R * 1.22 + 4);
    }

    // The peg ring. A peg falls when the swing plane reaches it, which is the
    // whole point of the demo: the pegs record where the plane has been.
    const sweep = Math.sign(plane) || 1;
    for (const peg of pegs) {
      // Angle the plane must sweep to reach this peg (the plane has two ends,
      // so azimuths are equivalent modulo π).
      const need = ((sweep * peg.az) % Math.PI + Math.PI) % Math.PI;
      peg.down = Math.abs(plane) >= need;
      const px = cx + Math.cos(peg.az) * R * 0.96;
      const py = cy - Math.sin(peg.az) * R * 0.96;
      ctx.fillStyle = peg.down ? 'rgba(255,120,140,0.55)' : 'rgba(226,234,248,0.85)';
      ctx.beginPath();
      if (peg.down) ctx.ellipse(px, py, 5, 2, peg.az, 0, Math.PI * 2);
      else ctx.arc(px, py, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // The swing itself. Once the clock runs fast enough that a whole period
    // passes in a couple of frames, an animated bob would just alias — a real
    // pendulum at that speed looks like a bar, so draw the bar.
    const T = (2 * Math.PI) / foucault.omegaP;
    const blurred = T / Math.max(p.scale, 1) < 0.12;
    const ux = Math.cos(plane), uy = -Math.sin(plane);
    ctx.strokeStyle = 'rgba(255, 184, 107, 0.85)';
    ctx.lineWidth = blurred ? 5 : 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - ux * R, cy - uy * R);
    ctx.lineTo(cx + ux * R, cy + uy * R);
    ctx.stroke();

    if (!blurred) {
      const pos = foucault.position(fouT);
      ctx.fillStyle = '#ffb86b';
      ctx.shadowColor = 'rgba(255,184,107,0.5)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(cx + pos.x * ppm, cy - pos.y * ppm, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = 'rgba(226,234,248,0.7)';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(226,234,248,0.55)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(i18nText('penTopDown', 'seen from above'), 12, 20);
    const dir = foucault.Oz > 0 ? i18nText('penCW', 'plane turning clockwise')
              : foucault.Oz < 0 ? i18nText('penCCW', 'plane turning counter-clockwise')
              : i18nText('penNoPrecess', 'on the equator — the plane never turns');
    ctx.fillText(dir, 12, CH - 14);
  }

  // ── Newton's cradle drawing ────────────────────────────────────────────
  function drawCradle(p) {
    ctx.clearRect(0, 0, CW, CH);
    const n = cradle.length;
    const yTop = CH * 0.14;
    const avail = CH - yTop - 34;
    const rPx = Math.min(avail * 0.13, (CW * 0.8) / (2 * n));
    const spacing = 2 * rPx;
    // The outermost ball swings out by L·sin θ₀, so the string has to be short
    // enough that the raised balls still land inside the canvas — sizing off
    // the available height alone clips them at the edge.
    const halfRow = ((n - 1) / 2) * spacing + rPx;
    const swingRoom = Math.max(CW / 2 - halfRow - 8, 12);
    const lenPx = Math.min(avail - rPx, swingRoom / Math.max(Math.abs(Math.sin(p.theta0)), 0.08));
    const x0 = CW / 2 - ((n - 1) * spacing) / 2;

    ctx.strokeStyle = 'rgba(110, 168, 255, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 - spacing, yTop); ctx.lineTo(x0 + n * spacing, yTop);
    ctx.stroke();

    for (let i = 0; i < n; i++) {
      const b = cradle[i];
      const px = x0 + i * spacing;
      const bx = px + lenPx * Math.sin(b.theta);
      const by = yTop + lenPx * Math.cos(b.theta);
      ctx.strokeStyle = 'rgba(232, 236, 247, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px, yTop); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#3a4570';
      ctx.beginPath(); ctx.arc(px, yTop, 3, 0, Math.PI * 2); ctx.fill();

      // Moving balls glow; the resting middle of the row stays cool.
      const speed = Math.abs(b.omega) * p.L;
      const hot = Math.min(speed / 1.4, 1);
      const grd = ctx.createRadialGradient(bx - rPx * 0.3, by - rPx * 0.4, rPx * 0.1, bx, by, rPx);
      grd.addColorStop(0, `rgb(${230 + 20 * hot}, ${216 - 30 * hot}, ${190 - 80 * hot})`);
      grd.addColorStop(1, `rgb(${120 + 90 * hot}, ${118 - 10 * hot}, ${126 - 40 * hot})`);
      ctx.fillStyle = grd;
      if (hot > 0.02) { ctx.shadowColor = 'rgba(255,184,107,0.55)'; ctx.shadowBlur = 14 * hot; }
      ctx.beginPath(); ctx.arc(bx, by, rPx, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = 'rgba(226,234,248,0.55)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      `${i18nText('penPulledBack', 'pulled back')}: ${p.pulled}   ` +
      `${i18nText('penCollisions', 'collisions')}: ${collisions}`, 12, CH - 14);
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  const LABELS = {
    wave:     ['outPeriod', 'outAngle', 'outAngVel', 'outElapsedTime', null, null],
    foucault: ['outPeriod', 'penOutPlane', 'penOutPrecession', 'penOutSimTime', 'penOutLatitude', 'penOutPegs'],
    newton:   ['outPeriod', 'penOutEnergy', 'penOutDrift', 'outElapsedTime', 'penOutMoving', 'penOutCollisions'],
  };
  const UNITS = {
    wave:     ['s', '°', '°/s', 's', '', ''],
    foucault: ['s', '°', 'h', 'h', '°', ''],
    newton:   ['s', 'J/kg', '%', 's', '', ''],
  };
  const SLOTS = ['period', 'angle', 'angvel', 'time', 'x1', 'x2'];

  function applyLabels() {
    const keys = LABELS[mode], us = UNITS[mode];
    SLOTS.forEach((s, i) => {
      if (keys[i]) lab[s].textContent = i18nText(keys[i], keys[i]);
      unit[s].textContent = us[i];
    });
    slotX1.hidden = !keys[4];
    slotX2.hidden = !keys[5];
  }

  function updateReadouts(Lbase, g) {
    out.period.textContent = fmt(smallAnglePeriod(Lbase, g));
    if (mode === 'foucault') {
      out.angle.textContent = fmt(toDeg(foucault.planeAngle(fouT)), 1);
      const Tp = foucault.precessionPeriod();
      out.angvel.textContent = Number.isFinite(Tp) ? fmt(Tp / 3600, 2) : '∞';
      out.time.textContent = fmt(fouT / 3600, 2);
      out.x1.textContent = fmt(parseFloat(inputs.latitude.value), 1);
      out.x2.textContent = `${pegs.filter((q) => q.down).length} / ${pegs.length}`;
    } else if (mode === 'newton') {
      const e = cradleEnergy(Lbase, g);
      out.angle.textContent = fmt(e, 3);
      out.angvel.textContent = energy0 > 1e-12 ? fmt(((e - energy0) / energy0) * 100, 4) : '0.0000';
      out.time.textContent = fmt(elapsed);
      out.x1.textContent = String(cradle.filter((b) => Math.abs(b.omega) > 0.05).length);
      out.x2.textContent = String(collisions);
    } else {
      if (pendulums.length > 0) {
        out.angle.textContent = fmt(toDeg(pendulums[0].theta));
        out.angvel.textContent = fmt(toDeg(pendulums[0].omega));
      } else {
        out.angle.textContent = '0.00';
        out.angvel.textContent = '0.00';
      }
      out.time.textContent = fmt(elapsed);
    }
  }

  function initPendulums(N, Lbase, theta0) {
    pendulums = [];
    for (let i = 0; i < N; i++) {
      pendulums.push({
        theta: theta0,
        omega: 0,
        L: lengthForIndex(i, N, Lbase),
        prevTheta: theta0,
      });
    }
  }

  function syncLengths(N, Lbase) {
    for (let i = 0; i < N; i++) {
      pendulums[i].L = lengthForIndex(i, N, Lbase);
    }
  }

  function renderStatic() {
    const p = readParams();
    if (!running) {
      if (mode === 'foucault') {
        foucault.setup(p.L, p.g, p.theta0, p.lat);
        fouT = 0;
        initPegs();
      } else if (mode === 'newton') {
        initCradle(p.balls, Math.min(p.pulled, p.balls - 1), p.theta0);
        energy0 = cradleEnergy(p.L, p.g);
      } else {
        initPendulums(p.N, p.L, p.theta0);
      }
      elapsed = 0;
    }
    draw(p);
    updateReadouts(p.L, p.g);
  }

  function draw(p) {
    if (mode === 'foucault') drawFoucault(p);
    else if (mode === 'newton') drawCradle(p);
    else drawScene(pendulums.length || p.N, p.L);
  }

  /** One RK4 step of θ̈ = −(g/L)·sin θ − b·θ̇ for a list of {theta, omega, L}. */
  function stepPendulums(list, h, g, b, defaultL) {
    for (let i = 0; i < list.length; i++) {
      const pen = list[i];
      const L = (pen.L || defaultL) > 0 ? (pen.L || defaultL) : 0.0001;
      const theta = pen.theta;
      const omega = pen.omega;
      const acc = (t, o) => -(g / L) * Math.sin(t) - b * o;
      const k1x = omega,                     k1v = acc(theta, omega);
      const k2x = omega + (h / 2) * k1v,     k2v = acc(theta + (h / 2) * k1x, k2x);
      const k3x = omega + (h / 2) * k2v,     k3v = acc(theta + (h / 2) * k2x, k3x);
      const k4x = omega + h * k3v,           k4v = acc(theta + h * k3x, k4x);
      pen.theta = theta + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      pen.omega = omega + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    }
  }

  function integrate(dt) {
    const { g, b } = activeParams;
    const sub = 4;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < pendulums.length; i++) {
        const pen = pendulums[i];
        const L = pen.L > 0 ? pen.L : 0.0001;
        let theta = pen.theta;
        let omega = pen.omega;

        const a1 = -(g / L) * Math.sin(theta) - b * omega;
        const k1x = omega;
        const k1v = a1;

        const t2 = theta + (h / 2) * k1x;
        const o2 = omega + (h / 2) * k1v;
        const a2 = -(g / L) * Math.sin(t2) - b * o2;
        const k2x = o2;
        const k2v = a2;

        const t3 = theta + (h / 2) * k2x;
        const o3 = omega + (h / 2) * k2v;
        const a3 = -(g / L) * Math.sin(t3) - b * o3;
        const k3x = o3;
        const k3v = a3;

        const t4 = theta + h * k3x;
        const o4 = omega + h * k3v;
        const a4 = -(g / L) * Math.sin(t4) - b * o4;
        const k4x = o4;
        const k4v = a4;

        pen.theta = theta + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
        pen.omega = omega + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      }
    }
  }

  function step(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;

    if (mode === 'foucault') {
      // Closed form, so the clock can run thousands of times fast without
      // any integrator drifting.
      fouT += dt * activeParams.scale;
      elapsed += dt;
    } else if (mode === 'newton') {
      // Small sub-steps so a strike is caught while the balls are still
      // approaching; the gap between them is only a few millimetres.
      const sub = 90;
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        stepPendulums(cradle, h, activeParams.g, activeParams.b, activeParams.L);
        resolveContacts(activeParams.L);
      }
      elapsed += dt;
    } else {
      integrate(dt);
      elapsed += dt;

      // A soft wooden "tock" each time a bob swings through the bottom;
      // shorter pendulums ring higher, so the wave pendulum cascades.
      for (const pen of pendulums) {
        if (pen.prevTheta * pen.theta < 0 && Math.abs(pen.omega) > 0.3) {
          const f = Math.max(140, Math.min(880, 220 * Math.sqrt(2 / (pen.L || 1))));
          window.SFX?.tone({ freq: f, dur: 0.12, type: 'triangle', gain: pendulums.length > 1 ? 0.05 : 0.09, attack: 0.004, release: 0.1 });
        }
        pen.prevTheta = pen.theta;
      }
    }

    draw(activeParams);
    updateReadouts(activeParams.L, activeParams.g);

    animId = requestAnimationFrame(step);
  }

  function start() {
    if (running) {
      pause();
      return;
    }
    activeParams = readParams();
    if (mode === 'foucault') {
      if (elapsed === 0) { foucault.setup(activeParams.L, activeParams.g, activeParams.theta0, activeParams.lat); initPegs(); fouT = 0; }
    } else if (mode === 'newton') {
      if (elapsed === 0 || cradle.length !== activeParams.balls) {
        initCradle(activeParams.balls, Math.min(activeParams.pulled, activeParams.balls - 1), activeParams.theta0);
        energy0 = cradleEnergy(activeParams.L, activeParams.g);
      }
    } else if (elapsed === 0 || pendulums.length !== activeParams.N) {
      initPendulums(activeParams.N, activeParams.L, activeParams.theta0);
    }
    running = true;
    lastTs = 0;
    startBtn.textContent = i18nText('pauseBtn', 'Pause');
    animId = requestAnimationFrame(step);
  }

  function setMode(next) {
    mode = next;
    modeList.querySelectorAll('.mol-btn').forEach((b) => {
      const on = b.dataset.key === next;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('.control[data-modes]').forEach((el) => {
      el.hidden = !el.dataset.modes.split(' ').includes(next);
    });
    for (const id of ['wave', 'foucault', 'newton']) {
      const d = document.getElementById('notes-' + id);
      if (d) { d.hidden = id !== next; d.open = id === next; }
    }
    angleLabel.setAttribute('data-i18n',
      next === 'newton' ? 'penPullAngleLabel'
      : next === 'foucault' ? 'penAmplitudeLabel'
      : 'initialAngleLabel');
    angleLabel.textContent = i18nText(angleLabel.dataset.i18n, 'Initial angle θ₀');
    applyLabels();
    reset();
  }

  function pause() {
    running = false;
    if (animId) cancelAnimationFrame(animId);
    animId = null;
    startBtn.textContent = i18nText('startBtn', 'Start');
  }

  function reset() {
    running = false;
    if (animId) cancelAnimationFrame(animId);
    animId = null;
    elapsed = 0;
    startBtn.textContent = i18nText('startBtn', 'Start');
    renderStatic();
  }

  function wireInputs() {
    inputs.length.addEventListener('input', () => {
      const v = parseFloat(inputs.length.value);
      inputValues.length.textContent = v.toFixed(2);
      if (running) {
        activeParams.L = v;
        syncLengths(pendulums.length, v);
      } else {
        renderStatic();
      }
    });
    inputs.gravity.addEventListener('input', () => {
      const v = parseFloat(inputs.gravity.value);
      inputValues.gravity.textContent = v.toFixed(2);
      if (running) activeParams.g = v;
      else renderStatic();
    });
    inputs.angle.addEventListener('input', () => {
      inputValues.angle.textContent = String(Math.round(parseFloat(inputs.angle.value)));
      if (!running) renderStatic();
    });
    inputs.damping.addEventListener('input', () => {
      const v = parseFloat(inputs.damping.value);
      inputValues.damping.textContent = v.toFixed(2);
      if (running) activeParams.b = v;
      else renderStatic();
    });
    inputs.count.addEventListener('input', () => {
      const N = parseInt(inputs.count.value, 10);
      inputValues.count.textContent = String(N);
      if (running) {
        activeParams.N = N;
        initPendulums(N, activeParams.L, activeParams.theta0);
        elapsed = 0;
        lastTs = 0;
      } else {
        renderStatic();
      }
    });

    // Latitude changes the precession rate, so the run restarts — carrying a
    // half-swept peg ring across a latitude change would be a lie.
    inputs.latitude.addEventListener('input', () => {
      inputValues.latitude.textContent = parseFloat(inputs.latitude.value).toFixed(1);
      if (mode === 'foucault') { pause(); renderStatic(); }
    });
    // Time acceleration is only how fast we watch, so it applies live.
    inputs.timescale.addEventListener('input', () => {
      const v = parseInt(inputs.timescale.value, 10);
      inputValues.timescale.textContent = String(v);
      if (running && activeParams) activeParams.scale = v;
    });
    inputs.balls.addEventListener('input', () => {
      const n = parseInt(inputs.balls.value, 10);
      inputValues.balls.textContent = String(n);
      inputs.pulled.max = String(n - 1);
      if (parseInt(inputs.pulled.value, 10) > n - 1) {
        inputs.pulled.value = String(n - 1);
        inputValues.pulled.textContent = inputs.pulled.value;
      }
      if (mode === 'newton') { pause(); renderStatic(); }
    });
    inputs.pulled.addEventListener('input', () => {
      inputValues.pulled.textContent = inputs.pulled.value;
      if (mode === 'newton') { pause(); renderStatic(); }
    });

    modeList.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setMode(btn.dataset.key);
        window.SFX?.tone({ freq: 520, dur: 0.08, type: 'triangle', gain: 0.1 });
      });
    });

    startBtn.addEventListener('click', start);
    resetBtn.addEventListener('click', reset);
  }

  document.addEventListener('langchange', () => {
    startBtn.textContent = running
      ? i18nText('pauseBtn', 'Pause')
      : i18nText('startBtn', 'Start');
    applyLabels();
    angleLabel.textContent = i18nText(angleLabel.dataset.i18n, 'Initial angle θ₀');
  });

  function resizeCanvas() {
    // Un-pin the inline size from the previous pass before measuring —
    // otherwise the canvas can never grow back when the window widens
    // (it would keep re-measuring its own pinned width forever).
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    CW = Math.max(Math.round(rect.width), 300);
    // Foucault is a plan view, so it wants a squarer frame than the others.
    CH = mode === 'foucault'
      ? Math.max(Math.min(CW, 440), 300)
      : Math.max(Math.round(rect.height), 240);
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.style.setProperty('width', CW + 'px', 'important');
    canvas.style.setProperty('height', CH + 'px', 'important');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // If the swing is mid-flight or paused with state, just redraw at
    // the new size — renderStatic() would re-initialise every pendulum
    // to θ₀ and zero the elapsed clock, throwing away in-flight swing.
    // Before the first Start, activeParams is still null — fall back to
    // the current slider value instead of crashing on resize.
    if (mode !== 'wave' || pendulums.length > 0) {
      draw(activeParams || readParams());
    } else {
      renderStatic();
    }
  }

  // Only resume if the swing was running — a tab switch must not undo Pause.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animId) { cancelAnimationFrame(animId); animId = null; }
    } else if (running && !animId) {
      lastTs = 0;
      animId = requestAnimationFrame(step);
    }
  });

  window.addEventListener('resize', resizeCanvas);

  // Exposed so the harness can check each model against its closed form.
  window.__pen = {
    setMode, foucault, OMEGA_EARTH, SIDEREAL_DAY,
    cradleState: () => cradle.map((b) => ({ theta: b.theta, omega: b.omega })),
    cradleEnergy, collisions: () => collisions,
    fouTime: () => fouT, smallAnglePeriod,
  };

  wireInputs();
  setMode('wave');
  resizeCanvas();
})();
