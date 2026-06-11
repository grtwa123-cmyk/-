(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const timeScaleInput = document.getElementById('time-scale');
  const timeScaleValue = document.getElementById('time-scale-value');
  const bhMassInput = document.getElementById('bh-mass');
  const bhMassValue = document.getElementById('bh-mass-value');
  const modeList = document.getElementById('mode-list');
  const spawnHint = document.getElementById('spawn-hint');
  const clearBhBtn = document.getElementById('clear-bh-btn');
  const resetBtn = document.getElementById('reset-btn');
  const propPlanets = document.getElementById('prop-planets');
  const propBh = document.getElementById('prop-bh');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  // Real Solar System data. a in AU, real planet radius in km.
  const EARTH_RADIUS_KM = 6371;
  const PLANET_TEMPLATES = [
    { key: 'mercury', nameKey: 'planetMercury', a: 0.39, radiusKm: 2440,  color: '#b08b6a' },
    { key: 'venus',   nameKey: 'planetVenus',   a: 0.72, radiusKm: 6052,  color: '#e6b366' },
    { key: 'earth',   nameKey: 'planetEarth',   a: 1.00, radiusKm: 6371,  color: '#6ea8ff' },
    { key: 'mars',    nameKey: 'planetMars',    a: 1.52, radiusKm: 3390,  color: '#e07050' },
    { key: 'jupiter', nameKey: 'planetJupiter', a: 5.20, radiusKm: 69911, color: '#cca070' },
    { key: 'saturn',  nameKey: 'planetSaturn',  a: 9.54, radiusKm: 58232, color: '#e0c080', ring: true },
    { key: 'uranus',  nameKey: 'planetUranus',  a: 19.2, radiusKm: 25362, color: '#9fe4e4' },
    { key: 'neptune', nameKey: 'planetNeptune', a: 30.1, radiusKm: 24622, color: '#4f7fd0' },
  ];

  const SUN_R = 30;                // sun visual radius (px); still far smaller than true scale
  const EARTH_PX = 2.6;            // Earth's visual radius; other planets scale LINEARLY from real radii
  const EARTH_VIS_PERIOD = 365.25; // days the Earth orbit takes in sim time
  const ADDED_PLANET_PALETTE = ['#c47bff', '#6effc6', '#ff6b8a', '#ffe14a', '#7fd0ff', '#ff9f6b'];

  let DISTANCE_SCALE = 60;
  let MU_SUN = 1;        // GM of the sun (mass 1 ⊙), in px³/day²
  let VEL_SCALE = 0.01;  // px/day per px of drag, set at resize

  let CW = 800;
  let CH = 720;
  let timeScale = parseFloat(timeScaleInput.value); // days per wall-second
  let bhMassPending = parseFloat(bhMassInput.value);
  let spawnMode = 'blackhole';

  const sun = { x: 0, y: 0, vx: 0, vy: 0, mass: 1, alive: true, draining: null };
  let planets = [];
  let blackHoles = [];
  let effects = [];
  let addedCount = 0;
  let animId = null;
  let lastTs = 0;

  // Linear real-size ratio: Jupiter really is ~11× Earth on screen.
  function planetPx(radiusKm) {
    const rel = radiusKm / EARTH_RADIUS_KM;
    return Math.max(1.5, EARTH_PX * rel);
  }

  function ehFor(mass) { return Math.max(7, 5 + mass * 1.2); }
  function diskFor(mass) { return ehFor(mass) * 2.4 + 6; }
  // Sun's visual radius shrinks as it is drained (radius ∝ mass^⅓).
  function sunR() { return SUN_R * Math.cbrt(Math.max(sun.mass, 0.001)); }

  function recomputeScale() {
    const usableR = Math.min(CW, CH) / 2 - 30;
    DISTANCE_SCALE = usableR / Math.sqrt(30.1); // Neptune must fit
    const earthR = Math.sqrt(1.0) * DISTANCE_SCALE;
    const omegaRef = (2 * Math.PI) / EARTH_VIS_PERIOD; // rad / day
    MU_SUN = omegaRef * omegaRef * earthR * earthR * earthR;
    VEL_SCALE = Math.sqrt(MU_SUN / earthR) / earthR;
  }

  // Heaviest gravity source still alive (sun counts as mass 1).
  function dominantBody() {
    let best = sun.alive ? { x: sun.x, y: sun.y, vx: sun.vx, vy: sun.vy, mass: sun.mass } : null;
    for (const bh of blackHoles) {
      if (!best || bh.mass > best.mass) best = bh;
    }
    return best;
  }

  function circularVelocityAround(body, x, y) {
    const dx = x - body.x;
    const dy = y - body.y;
    const r = Math.hypot(dx, dy) || 1;
    const v = Math.sqrt(MU_SUN * body.mass / r);
    return { vx: body.vx + (-dy / r) * v, vy: body.vy + (dx / r) * v };
  }

  function initPlanets() {
    sun.x = CW / 2;
    sun.y = CH / 2;
    sun.vx = 0;
    sun.vy = 0;
    sun.mass = 1;
    sun.alive = true;
    sun.draining = null;
    addedCount = 0;
    planets = PLANET_TEMPLATES.map((p, idx) => {
      const r = Math.sqrt(p.a) * DISTANCE_SCALE;
      const theta0 = (Math.PI * 2 * idx) / PLANET_TEMPLATES.length + 0.4 * p.a;
      const x = sun.x + Math.cos(theta0) * r;
      const y = sun.y + Math.sin(theta0) * r;
      const v = circularVelocityAround({ x: sun.x, y: sun.y, vx: 0, vy: 0, mass: 1 }, x, y);
      return {
        key: p.key, nameKey: p.nameKey, color: p.color,
        r: planetPx(p.radiusKm), ring: !!p.ring,
        guideR: r, isTemplate: true,
        x, y, vx: v.vx, vy: v.vy, alive: true, trail: [],
      };
    });
  }

  function addPlanet(x, y, vx, vy) {
    addedCount++;
    planets.push({
      key: 'added' + addedCount, nameKey: null,
      color: ADDED_PLANET_PALETTE[(addedCount - 1) % ADDED_PLANET_PALETTE.length],
      r: 4, ring: false, guideR: 0, isTemplate: false,
      x, y, vx, vy, alive: true, trail: [],
    });
    updateCounts();
  }

  function updateCounts() {
    propPlanets.textContent = String(planets.filter((p) => p.alive).length);
    propBh.textContent = String(blackHoles.length);
  }

  function clearBlackHoles() {
    blackHoles = [];
    updateCounts();
  }

  function resetAll() {
    blackHoles = [];
    effects = [];
    initPlanets();
    updateCounts();
  }

  function spawnBlackHole(x, y, mass) {
    blackHoles.push({
      x, y, vx: 0, vy: 0, mass,
      created: 0, spin: Math.random() * Math.PI * 2,
    });
    updateCounts();
  }

  function spawnExplosion(x, y, color, scale) {
    const parts = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = (60 + Math.random() * 130) * scale;
      parts.push({ x: 0, y: 0, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
    }
    effects.push({ x, y, color, parts, t: 0, life: 0.9, scale });
  }

  function stepEffects(dt) {
    for (const e of effects) {
      e.t += dt;
      for (const p of e.parts) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy *= 0.92;
      }
    }
    effects = effects.filter((e) => e.t < e.life);
  }

  // ---- physics ----
  function step(dt) {
    const simDt = dt * timeScale; // days
    const sub = Math.min(800, Math.max(6, Math.ceil(simDt / 0.25)));
    const h = simDt / sub;
    let countDirty = false;

    for (let s = 0; s < sub; s++) {
      // Black holes are dynamic: pulled by the sun and by each other.
      for (const bh of blackHoles) {
        let ax = 0, ay = 0;
        if (sun.alive) {
          const dx = bh.x - sun.x;
          const dy = bh.y - sun.y;
          const r2 = dx * dx + dy * dy;
          const r = Math.sqrt(r2) || 1;
          const mu = MU_SUN * sun.mass;
          ax += (-mu / r2) * (dx / r);
          ay += (-mu / r2) * (dy / r);
        }
        for (const other of blackHoles) {
          if (other === bh) continue;
          const dx = bh.x - other.x;
          const dy = bh.y - other.y;
          const r2 = dx * dx + dy * dy;
          const r = Math.sqrt(r2) || 1;
          const mu = MU_SUN * other.mass;
          ax += (-mu / r2) * (dx / r);
          ay += (-mu / r2) * (dy / r);
        }
        bh.vx += ax * h;
        bh.vy += ay * h;
        bh.x += bh.vx * h;
        bh.y += bh.vy * h;
      }

      // Black hole mergers: momentum-conserving, mass-weighted.
      if (blackHoles.length > 1) {
        for (let i = 0; i < blackHoles.length; i++) {
          for (let j = i + 1; j < blackHoles.length; j++) {
            const A = blackHoles[i], B = blackHoles[j];
            const d = Math.hypot(A.x - B.x, A.y - B.y);
            if (d < (ehFor(A.mass) + ehFor(B.mass)) * 0.75) {
              const m = A.mass + B.mass;
              const mx = (A.x * A.mass + B.x * B.mass) / m;
              const my = (A.y * A.mass + B.y * B.mass) / m;
              spawnExplosion(mx, my, '#ffd27a', 1.6);
              A.x = mx;
              A.y = my;
              A.vx = (A.vx * A.mass + B.vx * B.mass) / m;
              A.vy = (A.vy * A.mass + B.vy * B.mass) / m;
              A.mass = m;
              blackHoles.splice(j, 1);
              countDirty = true;
              j--;
            }
          }
        }
      }

      // Sun: pulled by black holes. Touching a horizon doesn't delete it —
      // it marks the hole as draining the sun (gradual accretion below).
      if (sun.alive) {
        let sax = 0, say = 0;
        sun.draining = null;
        for (const bh of blackHoles) {
          const dx = sun.x - bh.x;
          const dy = sun.y - bh.y;
          const r2 = dx * dx + dy * dy;
          const r = Math.sqrt(r2) || 1;
          if (r < ehFor(bh.mass) + sunR() * 0.7) sun.draining = bh;
          const mu = MU_SUN * bh.mass;
          sax += (-mu / r2) * (dx / r);
          say += (-mu / r2) * (dy / r);
        }
        sun.vx += sax * h;
        sun.vy += say * h;
        sun.x += sun.vx * h;
        sun.y += sun.vy * h;
      }

      // Planets
      for (const p of planets) {
        if (!p.alive) continue;
        let ax = 0, ay = 0;
        if (sun.alive) {
          const dx = p.x - sun.x;
          const dy = p.y - sun.y;
          const r2 = dx * dx + dy * dy;
          const r = Math.sqrt(r2);
          if (r < sunR()) {
            p.alive = false;
            countDirty = true;
            spawnExplosion(p.x, p.y, p.color, 1);
            continue;
          }
          const mu = MU_SUN * sun.mass;
          ax += (-mu / r2) * (dx / r);
          ay += (-mu / r2) * (dy / r);
        }
        let eaten = false;
        for (const bh of blackHoles) {
          const dx = p.x - bh.x;
          const dy = p.y - bh.y;
          const r2 = dx * dx + dy * dy;
          const r = Math.sqrt(r2);
          if (r < ehFor(bh.mass)) {
            p.alive = false;
            countDirty = true;
            spawnExplosion(bh.x, bh.y, p.color, 1.1);
            eaten = true;
            break;
          }
          const mu = MU_SUN * bh.mass;
          ax += (-mu / r2) * (dx / r);
          ay += (-mu / r2) * (dy / r);
        }
        if (eaten) continue;
        p.vx += ax * h;
        p.vy += ay * h;
        p.x += p.vx * h;
        p.y += p.vy * h;
      }
    }

    // Gradual accretion: a hole in contact drains the sun instead of
    // deleting it. The sun shrinks, the hole grows, momentum is conserved.
    if (sun.alive && sun.draining) {
      const bh = sun.draining;
      const rate = 0.35 + 0.25 * Math.sqrt(bh.mass); // solar masses per wall-second
      const dm = Math.min(sun.mass, rate * dt);
      const newM = bh.mass + dm;
      bh.vx = (bh.vx * bh.mass + sun.vx * dm) / newM;
      bh.vy = (bh.vy * bh.mass + sun.vy * dm) / newM;
      bh.mass = newM;
      sun.mass -= dm;
      // Soft velocity coupling keeps the locked pair from drifting apart.
      const k = Math.min(1, dt * 2.5);
      sun.vx += (bh.vx - sun.vx) * k;
      sun.vy += (bh.vy - sun.vy) * k;
      if (sun.mass <= 0.04) {
        bh.mass += sun.mass;
        sun.mass = 0;
        sun.alive = false;
        sun.draining = null;
        spawnExplosion(sun.x, sun.y, '#ffd27a', 2.2);
      }
    }

    // Trail sampling (per frame)
    for (const p of planets) {
      if (!p.alive) continue;
      const trail = p.trail;
      const last = trail[trail.length - 1];
      if (!last || (last.x - p.x) ** 2 + (last.y - p.y) ** 2 > 9) {
        trail.push({ x: p.x, y: p.y });
        if (trail.length > 260) trail.shift();
      }
    }

    stepEffects(dt);
    if (countDirty) updateCounts();
    for (const bh of blackHoles) {
      bh.created += dt;
      bh.spin += dt * 1.6;
    }
  }

  // ---- drawing ----
  function drawStarfield() {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    let s = 9871;
    const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 140; i++) {
      const x = rng() * CW, y = rng() * CH, r = 0.5 + rng() * 1.4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawOrbits() {
    if (!sun.alive) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.07)';
    ctx.lineWidth = 1;
    for (const p of planets) {
      if (!p.alive || !p.isTemplate) continue;
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, p.guideR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSun() {
    if (!sun.alive) return;
    const x = sun.x, y = sun.y;
    const R = sunR();
    const grad = ctx.createRadialGradient(x, y, 0, x, y, R * 2.4);
    grad.addColorStop(0, 'rgba(255, 240, 180, 0.9)');
    grad.addColorStop(0.45, 'rgba(255, 200, 110, 0.35)');
    grad.addColorStop(1, 'rgba(255, 184, 107, 0)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, R * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'rgba(255, 220, 130, 0.9)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffe0a0';
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Glowing stream of plasma flowing from the sun's surface into the hole.
  function drawAccretionStream() {
    if (!sun.alive || !sun.draining) return;
    const bh = sun.draining;
    const dx = bh.x - sun.x;
    const dy = bh.y - sun.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const px = -uy, py = ux; // perpendicular
    const sx = sun.x + ux * sunR() * 0.85;
    const sy = sun.y + uy * sunR() * 0.85;

    ctx.save();
    // Three bowed filaments
    for (let k = -1; k <= 1; k++) {
      const bow = k * Math.min(14, d * 0.18);
      const mx = (sx + bh.x) / 2 + px * bow;
      const my = (sy + bh.y) / 2 + py * bow;
      ctx.strokeStyle = `rgba(255, 205, 125, ${0.55 - Math.abs(k) * 0.18})`;
      ctx.lineWidth = 3.5 - Math.abs(k) * 1.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, bh.x, bh.y);
      ctx.stroke();
    }
    // Plasma blobs travelling along the stream
    ctx.fillStyle = 'rgba(255, 235, 170, 0.9)';
    for (let i = 0; i < 4; i++) {
      const t = ((bh.spin * 0.45 + i / 4) % 1);
      const bx = sx + (bh.x - sx) * t;
      const by = sy + (bh.y - sy) * t;
      ctx.beginPath();
      ctx.arc(bx, by, 2.6 * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Tidal stretch toward the nearest black hole (spaghettification).
  function tidalStretch(p) {
    let best = null;
    let bestF = 0;
    for (const bh of blackHoles) {
      const eh = ehFor(bh.mass);
      const d = Math.hypot(p.x - bh.x, p.y - bh.y);
      const f = Math.max(0, 1 - d / (3.5 * eh));
      if (f > bestF) { bestF = f; best = bh; }
    }
    if (!best || bestF < 0.03) return null;
    const f = Math.min(0.6, bestF);
    return { angle: Math.atan2(best.y - p.y, best.x - p.x), f };
  }

  function drawPlanet(p) {
    if (!p.alive) return;
    ctx.save();
    if (p.trail.length > 1) {
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.trail[0].x, p.trail[0].y);
      for (let i = 1; i < p.trail.length; i++) ctx.lineTo(p.trail[i].x, p.trail[i].y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = p.color;
    ctx.shadowBlur = Math.min(12, 4 + p.r);
    ctx.fillStyle = p.color;
    const stretch = tidalStretch(p);
    if (stretch) {
      ctx.translate(p.x, p.y);
      ctx.rotate(stretch.angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * (1 + 1.6 * stretch.f), p.r * (1 - 0.55 * stretch.f), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(-stretch.angle);
      ctx.translate(-p.x, -p.y);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (p.ring && !stretch) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 230, 170, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.8, p.r * 0.62, 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBlackHole(bh) {
    ctx.save();
    const t = Math.min(1, bh.created / 0.5);
    const eh = ehFor(bh.mass) * (0.4 + 0.6 * t);
    const disk = diskFor(bh.mass) * (0.4 + 0.6 * t);
    const tilt = 0.35;

    ctx.translate(bh.x, bh.y);

    // Accretion disk (tilted, with rotating swirl arcs)
    ctx.rotate(tilt);
    ctx.scale(1, 0.42);
    const grad = ctx.createRadialGradient(0, 0, eh * 0.9, 0, 0, disk);
    grad.addColorStop(0, 'rgba(255, 220, 140, 0)');
    grad.addColorStop(0.18, 'rgba(255, 200, 110, 0.85)');
    grad.addColorStop(0.5, 'rgba(255, 140, 70, 0.6)');
    grad.addColorStop(1, 'rgba(190, 80, 40, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, disk, 0, Math.PI * 2);
    ctx.fill();

    // Swirl arcs make the rotation visible
    ctx.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) {
      const rr = eh * 1.25 + ((disk - eh * 1.25) * (k + 0.5)) / 3;
      const start = bh.spin * (1 + k * 0.35) + k * 2.1;
      ctx.strokeStyle = `rgba(255, 230, 180, ${0.35 - k * 0.08})`;
      ctx.beginPath();
      ctx.arc(0, 0, rr, start, start + 2.0);
      ctx.stroke();
    }
    ctx.scale(1, 1 / 0.42);
    ctx.rotate(-tilt);

    // Photon ring
    ctx.strokeStyle = 'rgba(255, 230, 170, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, eh * 1.18, 0, Math.PI * 2);
    ctx.stroke();

    // Event horizon
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(0, 0, eh, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawEffect(e) {
    const life = e.t / e.life;
    const alpha = 1 - life;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * 1.1);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 3 * (1 - life * 0.5) * e.scale;
    ctx.beginPath();
    ctx.arc(e.x, e.y, (16 + life * 130) * e.scale, 0, Math.PI * 2);
    ctx.stroke();
    const flashR = 26 * e.scale * Math.max(0, 1 - life * 1.4);
    if (flashR > 0.5) {
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, flashR);
      g.addColorStop(0, `rgba(255, 248, 210, ${Math.min(1, alpha * 1.3)})`);
      g.addColorStop(0.5, `rgba(255, 200, 120, ${alpha * 0.6})`);
      g.addColorStop(1, 'rgba(255, 180, 90, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(e.x, e.y, flashR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 6;
    ctx.fillStyle = e.color;
    for (const p of e.parts) {
      ctx.beginPath();
      ctx.arc(e.x + p.x, e.y + p.y, 3 * (1 - life * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDrag() {
    if (!drag || spawnMode !== 'planet') return;
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(drag.startX, drag.startY);
    ctx.lineTo(drag.curX, drag.curY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(196, 123, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(drag.startX, drag.startY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHint() {
    if (blackHoles.length > 0 || drag) return;
    ctx.save();
    ctx.font = `500 14px ${FONT}`;
    ctx.fillStyle = 'rgba(232, 236, 247, 0.5)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const key = spawnMode === 'planet' ? 'solarHintPlanet' : 'solarHintBlackHole';
    ctx.fillText(i18nText(key, ''), CW / 2, CH - 28);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    drawStarfield();
    drawOrbits();
    drawSun();
    drawAccretionStream();
    for (const p of planets) drawPlanet(p);
    for (const bh of blackHoles) drawBlackHole(bh);
    for (const e of effects) drawEffect(e);
    drawDrag();
    drawHint();
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    step(dt);
    draw();
    animId = requestAnimationFrame(tick);
  }

  // ---- input ----
  let drag = null;

  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function nearSun(x, y) {
    if (!sun.alive) return false;
    const dx = x - sun.x;
    const dy = y - sun.y;
    const R = sunR() + 6;
    return dx * dx + dy * dy < R * R;
  }

  function onDown(x, y) {
    drag = { startX: x, startY: y, curX: x, curY: y };
  }
  function onMove(x, y) {
    if (!drag) return;
    drag.curX = x;
    drag.curY = y;
  }
  function onUp() {
    if (!drag) return;
    const { startX, startY, curX, curY } = drag;
    drag = null;
    if (spawnMode === 'blackhole') {
      if (!nearSun(startX, startY)) spawnBlackHole(startX, startY, bhMassPending);
      return;
    }
    // planet mode
    if (nearSun(startX, startY)) return;
    const center = dominantBody();
    const dx = curX - startX;
    const dy = curY - startY;
    const dragLen = Math.hypot(dx, dy);
    if (dragLen < 8) {
      // tap → circular orbit around the dominant body
      if (!center) return;
      const v = circularVelocityAround(center, startX, startY);
      addPlanet(startX, startY, v.vx, v.vy);
    } else {
      let vx = dx * VEL_SCALE;
      let vy = dy * VEL_SCALE;
      if (center) {
        const r = Math.max(SUN_R, Math.hypot(startX - center.x, startY - center.y));
        const vmax = 2.2 * Math.sqrt(MU_SUN * center.mass / r);
        const vmag = Math.hypot(vx, vy);
        if (vmag > vmax) { vx *= vmax / vmag; vy *= vmax / vmag; }
      }
      addPlanet(startX, startY, vx, vy);
    }
  }

  function selectMode(key) {
    if (key !== 'blackhole' && key !== 'planet') return;
    spawnMode = key;
    modeList.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.key === key);
    });
    if (spawnHint) {
      const hk = key === 'planet' ? 'solarHintPlanet' : 'solarHintBlackHole';
      spawnHint.dataset.i18n = hk;
      spawnHint.textContent = i18nText(hk, spawnHint.textContent);
    }
  }

  function wireEvents() {
    timeScaleInput.addEventListener('input', () => {
      timeScale = parseFloat(timeScaleInput.value);
      timeScaleValue.textContent = String(timeScale);
    });
    bhMassInput.addEventListener('input', () => {
      bhMassPending = parseFloat(bhMassInput.value);
      bhMassValue.textContent = bhMassPending.toFixed(1);
    });
    modeList.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.addEventListener('click', () => selectMode(btn.dataset.key));
    });
    clearBhBtn.addEventListener('click', clearBlackHoles);
    resetBtn.addEventListener('click', resetAll);

    canvas.addEventListener('mousedown', (e) => { const p = canvasPoint(e.clientX, e.clientY); onDown(p.x, p.y); });
    window.addEventListener('mousemove', (e) => { if (drag) { const p = canvasPoint(e.clientX, e.clientY); onMove(p.x, p.y); } });
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', (e) => {
      if (!e.touches[0]) return;
      const p = canvasPoint(e.touches[0].clientX, e.touches[0].clientY);
      onDown(p.x, p.y);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (!e.touches[0]) return;
      const p = canvasPoint(e.touches[0].clientX, e.touches[0].clientY);
      onMove(p.x, p.y);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => { onUp(); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchcancel', () => { drag = null; });
  }

  document.addEventListener('langchange', draw);

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    CW = Math.max(Math.round(rect.width), 320);
    CH = 720;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.style.setProperty('width', CW + 'px', 'important');
    canvas.style.setProperty('height', CH + 'px', 'important');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    recomputeScale();
    if (planets.length === 0) initPlanets();
    draw();
  }

  timeScaleValue.textContent = String(timeScale);
  bhMassValue.textContent = bhMassPending.toFixed(1);
  wireEvents();
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  updateCounts();
  animId = requestAnimationFrame(tick);
})();
