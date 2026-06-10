(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const timeScaleInput = document.getElementById('time-scale');
  const timeScaleValue = document.getElementById('time-scale-value');
  const bhMassInput = document.getElementById('bh-mass');
  const bhMassValue = document.getElementById('bh-mass-value');
  const clearBhBtn = document.getElementById('clear-bh-btn');
  const resetBtn = document.getElementById('reset-btn');
  const propPlanets = document.getElementById('prop-planets');
  const propBh = document.getElementById('prop-bh');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  // Real Solar System data. a in AU, period in days.
  const PLANET_TEMPLATES = [
    { key: 'mercury', nameKey: 'planetMercury', a: 0.39, period: 87.97,    color: '#aa8866', r: 3.5 },
    { key: 'venus',   nameKey: 'planetVenus',   a: 0.72, period: 224.70,   color: '#e6b366', r: 5.5 },
    { key: 'earth',   nameKey: 'planetEarth',   a: 1.00, period: 365.25,   color: '#6ea8ff', r: 5.5 },
    { key: 'mars',    nameKey: 'planetMars',    a: 1.52, period: 686.98,   color: '#e07050', r: 4.5 },
    { key: 'jupiter', nameKey: 'planetJupiter', a: 5.20, period: 4332.59,  color: '#cca070', r: 11 },
    { key: 'saturn',  nameKey: 'planetSaturn',  a: 9.54, period: 10759.22, color: '#e0c080', r: 9, ring: true },
    { key: 'uranus',  nameKey: 'planetUranus',  a: 19.2, period: 30688.50, color: '#9fe4e4', r: 7 },
    { key: 'neptune', nameKey: 'planetNeptune', a: 30.1, period: 60182.00, color: '#4f7fd0', r: 7 },
  ];

  // Tunables
  const SUN_VISUAL_R = 16;
  // Distance scale: r_px = sqrt(a) * DISTANCE_SCALE. Chosen at resize time so Neptune fits.
  let DISTANCE_SCALE = 60;

  let CW = 800;
  let CH = 720;
  let timeScale = parseFloat(timeScaleInput.value); // days per second of wall time
  let bhMassPending = parseFloat(bhMassInput.value);

  // Derived from earth's circular orbit: GM_sun chosen so earth's orbit matches its
  // period at the visual distance assigned to earth.
  let MU_SUN = 1;

  let planets = [];
  let blackHoles = [];
  let consumeEffects = [];
  let animId = null;
  let lastTs = 0;

  function sunX() { return CW / 2; }
  function sunY() { return CH * 0.5; }

  function recomputeScale() {
    const usableR = Math.min(CW, CH) / 2 - 30;
    // Neptune (a = 30.1) must fit
    DISTANCE_SCALE = usableR / Math.sqrt(30.1);
    // GM_sun: choose so earth (a_visual = sqrt(1)*scale) completes its period.
    const earthR = Math.sqrt(1.0) * DISTANCE_SCALE;
    // omega = 2pi / period_in_days, v = omega * r, GM = omega^2 * r^3
    const omega = (2 * Math.PI) / 365.25; // rad / day
    MU_SUN = omega * omega * earthR * earthR * earthR;
  }

  function initPlanets() {
    planets = PLANET_TEMPLATES.map((p) => {
      const r = Math.sqrt(p.a) * DISTANCE_SCALE;
      // Initial angle: spread them so they don't start in a line.
      const theta0 = (Math.PI * 2 * (PLANET_TEMPLATES.indexOf(p) / PLANET_TEMPLATES.length)) + 0.4 * p.a;
      const omega = (2 * Math.PI) / p.period;
      const speed = omega * r;
      return {
        key: p.key,
        nameKey: p.nameKey,
        color: p.color,
        r: p.r,
        ring: !!p.ring,
        a: p.a,
        initialR: r,
        x: sunX() + Math.cos(theta0) * r,
        y: sunY() + Math.sin(theta0) * r,
        vx: -Math.sin(theta0) * speed,
        vy: Math.cos(theta0) * speed,
        alive: true,
        trail: [],
      };
    });
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
    consumeEffects = [];
    initPlanets();
    updateCounts();
  }

  function spawnBlackHole(x, y, mass) {
    const eventHorizon = Math.max(7, 5 + mass * 1.2);
    blackHoles.push({
      x, y, mass,
      eventHorizon,
      diskOuter: eventHorizon * 2.4 + 6,
      created: 0,
    });
    updateCounts();
  }

  function spawnConsumeEffect(planet, blackHole) {
    consumeEffects.push({
      x: planet.x,
      y: planet.y,
      bx: blackHole.x,
      by: blackHole.y,
      color: planet.color,
      t: 0,
      life: 0.9,
    });
  }

  // Days → wall-clock seconds: 1 wall-sec advances timeScale days of sim time.
  function step(dt) {
    const simDt = dt * timeScale; // days
    // Sub-step so inner planets and tight black-hole encounters integrate stably.
    const innerOmega = (2 * Math.PI) / 87.97; // mercury's angular rate
    const sub = Math.max(6, Math.ceil(simDt * innerOmega * 12));
    const h = simDt / sub;

    for (let s = 0; s < sub; s++) {
      for (const p of planets) {
        if (!p.alive) continue;
        // Sun
        let dx = p.x - sunX();
        let dy = p.y - sunY();
        let r2 = dx * dx + dy * dy;
        let r = Math.sqrt(r2);
        let ax = (-MU_SUN / r2) * (dx / r);
        let ay = (-MU_SUN / r2) * (dy / r);
        if (r < SUN_VISUAL_R) {
          p.alive = false;
          continue;
        }
        // Black holes
        for (const bh of blackHoles) {
          dx = p.x - bh.x;
          dy = p.y - bh.y;
          r2 = dx * dx + dy * dy;
          r = Math.sqrt(r2);
          if (r < bh.eventHorizon) {
            p.alive = false;
            spawnConsumeEffect(p, bh);
            break;
          }
          const mu = MU_SUN * bh.mass;
          ax += (-mu / r2) * (dx / r);
          ay += (-mu / r2) * (dy / r);
        }
        if (!p.alive) continue;
        p.vx += ax * h;
        p.vy += ay * h;
        p.x += p.vx * h;
        p.y += p.vy * h;
      }
    }

    // Trail sampling (per frame, not per sub-step, to keep it light)
    for (const p of planets) {
      if (!p.alive) continue;
      const trail = p.trail;
      const last = trail[trail.length - 1];
      if (!last || (last.x - p.x) ** 2 + (last.y - p.y) ** 2 > 9) {
        trail.push({ x: p.x, y: p.y });
        if (trail.length > 220) trail.shift();
      }
    }

    // Consume effects decay in wall time
    for (const e of consumeEffects) e.t += dt;
    consumeEffects = consumeEffects.filter((e) => e.t < e.life);

    // Black hole birth animation timer
    for (const bh of blackHoles) bh.created += dt;
  }

  // ---- drawing ----
  function drawStarfield() {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    let s = 9871;
    const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 140; i++) {
      const x = rng() * CW;
      const y = rng() * CH;
      const r = 0.5 + rng() * 1.4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawOrbits() {
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.07)';
    ctx.lineWidth = 1;
    for (const p of planets) {
      if (!p.alive) continue;
      ctx.beginPath();
      ctx.arc(sunX(), sunY(), p.initialR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSun() {
    const x = sunX();
    const y = sunY();
    const grad = ctx.createRadialGradient(x, y, 0, x, y, SUN_VISUAL_R * 4);
    grad.addColorStop(0, 'rgba(255, 240, 180, 0.95)');
    grad.addColorStop(0.3, 'rgba(255, 200, 110, 0.5)');
    grad.addColorStop(1, 'rgba(255, 184, 107, 0)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, SUN_VISUAL_R * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'rgba(255, 220, 130, 0.9)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#ffe0a0';
    ctx.beginPath();
    ctx.arc(x, y, SUN_VISUAL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlanet(p) {
    if (!p.alive) return;
    ctx.save();
    // Trail
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
    // Body
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    // Ring (Saturn)
    if (p.ring) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 230, 170, 0.8)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.9, p.r * 0.6, 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBlackHole(bh) {
    ctx.save();
    const t = Math.min(1, bh.created / 0.5); // spawn-in animation
    const eh = bh.eventHorizon * (0.4 + 0.6 * t);
    const disk = bh.diskOuter * (0.4 + 0.6 * t);

    // Accretion disk (warm tilted ellipse)
    const tilt = 0.35;
    const grad = ctx.createRadialGradient(bh.x, bh.y, eh * 0.9, bh.x, bh.y, disk);
    grad.addColorStop(0, 'rgba(255, 220, 140, 0)');
    grad.addColorStop(0.18, 'rgba(255, 200, 110, 0.85)');
    grad.addColorStop(0.5, 'rgba(255, 140, 70, 0.6)');
    grad.addColorStop(1, 'rgba(190, 80, 40, 0)');
    ctx.translate(bh.x, bh.y);
    ctx.rotate(tilt);
    ctx.scale(1, 0.42);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, disk, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(1, 1 / 0.42);
    ctx.rotate(-tilt);

    // Photon ring rim
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

  function drawConsumeEffect(e) {
    const t = e.t / e.life;
    const alpha = 1 - t;
    // Draw a stretched streak from the planet's spawn point toward the black hole.
    const x = e.x + (e.bx - e.x) * Math.min(1, t * 1.5);
    const y = e.y + (e.by - e.y) * Math.min(1, t * 1.5);
    ctx.save();
    ctx.strokeStyle = e.color;
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    // Flash at the impact point
    const flashR = 28 * (1 - t);
    if (flashR > 1) {
      const grad = ctx.createRadialGradient(e.bx, e.by, 0, e.bx, e.by, flashR);
      grad.addColorStop(0, `rgba(255, 240, 200, ${alpha * 0.9})`);
      grad.addColorStop(1, 'rgba(255, 200, 130, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(e.bx, e.by, flashR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHint() {
    if (blackHoles.length > 0) return;
    ctx.save();
    ctx.font = `500 14px ${FONT}`;
    ctx.fillStyle = 'rgba(232, 236, 247, 0.5)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(i18nText('spawnBlackHoleHint', 'Tap on the canvas to summon a black hole.'), CW / 2, CH - 32);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    drawStarfield();
    drawOrbits();
    for (const p of planets) drawPlanet(p);
    drawSun();
    for (const bh of blackHoles) drawBlackHole(bh);
    for (const e of consumeEffects) drawConsumeEffect(e);
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
  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function tryAddBlackHole(x, y) {
    // Don't drop one on top of the sun (it would just instantly nuke everything).
    const dx = x - sunX();
    const dy = y - sunY();
    if (dx * dx + dy * dy < (SUN_VISUAL_R + 6) * (SUN_VISUAL_R + 6)) return;
    spawnBlackHole(x, y, bhMassPending);
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
    clearBhBtn.addEventListener('click', clearBlackHoles);
    resetBtn.addEventListener('click', resetAll);

    canvas.addEventListener('click', (e) => {
      const p = canvasPoint(e.clientX, e.clientY);
      tryAddBlackHole(p.x, p.y);
    });
    canvas.addEventListener('touchstart', (e) => {
      if (!e.touches[0]) return;
      const p = canvasPoint(e.touches[0].clientX, e.touches[0].clientY);
      tryAddBlackHole(p.x, p.y);
      e.preventDefault();
    }, { passive: false });
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
