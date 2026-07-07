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
    altitude: document.getElementById('prop-altitude'),
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
  const V_CIRC = Math.sqrt(GM / LAUNCH_R);
  const V_ESC = Math.sqrt(2 * GM / LAUNCH_R);
  const PALETTE = ['#ffb86b', '#6effc6', '#ff6b8a', '#c47bff', '#6ea8ff', '#ffe14a'];

  function formatScale(s) {
    if (s >= 10) return s.toFixed(0);
    if (s >= 1) return s.toFixed(1);
    return s.toFixed(2);
  }

  let CW = 800;
  let CH = 700;
  let trails = [];
  let activeIndex = -1;
  let animId = null;
  let lastTs = 0;
  let nextColor = 0;
  let timeScale = parseFloat(timeScaleInput.value);

  function centerX() { return CW / 2; }
  function centerY() { return CH * 0.55; }

  function launchSpeed() {
    return parseFloat(velocityInput.value);
  }

  function fire() {
    const v0 = launchSpeed();
    const cx = centerX();
    const cy = centerY();
    const start = { x: cx, y: cy - LAUNCH_R };
    const ball = {
      x: start.x,
      y: start.y,
      vx: v0,
      vy: 0,
      alive: true,
      maxAltitude: 0,
      outcomeKey: 'outcomeIdle',
      escaped: false,
    };
    trails.push({
      color: PALETTE[nextColor % PALETTE.length],
      points: [{ x: start.x, y: start.y }],
      ball,
      v0,
    });
    nextColor++;
    activeIndex = trails.length - 1;
    if (trails.length > 5) {
      trails.shift();
      activeIndex--;
    }
  }

  function resetAll() {
    trails = [];
    activeIndex = -1;
    nextColor = 0;
    updateActiveReadouts();
  }

  function classify(ball, v0) {
    if (ball.escaped || v0 >= V_ESC * 0.999) return 'outcomeEscapes';
    if (!ball.alive) {
      // Landed: a slow lob falling back is the expected outcome, not a crash.
      return v0 < V_CIRC * 0.7 ? 'outcomeFalls' : 'outcomeCrashed';
    }
    if (v0 >= V_CIRC * 0.7) return 'outcomeOrbits';
    return 'outcomeFalls';
  }

  function stepBall(trail, dt) {
    const ball = trail.ball;
    if (!ball.alive) return;
    const cx = centerX();
    const cy = centerY();
    // Keep each integration step under ~10 ms of simulated time even when
    // the user scales time up, so high-speed orbits stay stable.
    const subSteps = Math.max(6, Math.ceil(dt / 0.01));
    const h = dt / subSteps;
    for (let i = 0; i < subSteps; i++) {
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const r2 = dx * dx + dy * dy;
      const r = Math.sqrt(r2);
      if (r < EARTH_R) {
        ball.alive = false;
        return;
      }
      const a = -GM / r2;
      ball.vx += a * (dx / r) * h;
      ball.vy += a * (dy / r) * h;
      ball.x += ball.vx * h;
      ball.y += ball.vy * h;
      // Sample the trail by distance, not by frame, so the curve stays
      // smooth even at 100× time scale.
      if (trail.points.length < 6000) {
        const last = trail.points[trail.points.length - 1];
        const ddx = last.x - ball.x;
        const ddy = last.y - ball.y;
        if (ddx * ddx + ddy * ddy > 4) {
          trail.points.push({ x: ball.x, y: ball.y });
        }
      }
    }
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    ball.maxAltitude = Math.max(ball.maxAltitude, r - EARTH_R);
    if (r > Math.max(CW, CH) * 1.2) {
      ball.escaped = true;
      ball.alive = false;
    }
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    const scaled = dt * timeScale;
    for (const trail of trails) {
      if (!trail.ball.alive) continue;
      stepBall(trail, scaled);
    }
    draw();
    updateActiveReadouts();
    animId = requestAnimationFrame(tick);
  }

  function drawStars() {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    const seed = 1234;
    let s = seed;
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
    ctx.save();
    ctx.strokeStyle = trail.color;
    ctx.lineWidth = isActive ? 2.5 : 1.6;
    ctx.globalAlpha = isActive ? 1 : 0.55;
    ctx.beginPath();
    ctx.moveTo(trail.points[0].x, trail.points[0].y);
    for (let i = 1; i < trail.points.length; i++) {
      ctx.lineTo(trail.points[i].x, trail.points[i].y);
    }
    ctx.stroke();

    if (trail.ball.alive) {
      ctx.globalAlpha = 1;
      ctx.shadowColor = trail.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = trail.color;
      ctx.beginPath();
      ctx.arc(trail.ball.x, trail.ball.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawLegend() {
    const cx = centerX();
    const top = 24;
    ctx.save();
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const v = launchSpeed();
    const vCircTxt = `${i18nText('orbitalSpeedRef', 'Circular orbit')}: ${V_CIRC.toFixed(2)}`;
    const vEscTxt = `${i18nText('escapeSpeedRef', 'Escape velocity')}: ${V_ESC.toFixed(2)}`;
    ctx.fillStyle = 'rgba(110, 255, 198, 0.8)';
    ctx.fillText(vCircTxt, 24, top);
    ctx.fillStyle = 'rgba(196, 123, 255, 0.85)';
    ctx.fillText(vEscTxt, 24, top + 22);

    ctx.font = `700 18px ${FONT}`;
    ctx.fillStyle = v < V_CIRC * 0.999 ? '#ff6b8a' : v < V_ESC * 0.999 ? '#6effc6' : '#c47bff';
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

  function updateActiveReadouts() {
    if (activeIndex < 0 || !trails[activeIndex]) {
      prop.outcome.textContent = i18nText('outcomeIdle', 'Ready');
      prop.speed.textContent = '0.00';
      prop.altitude.textContent = '0.00';
      prop.vcirc.textContent = V_CIRC.toFixed(2);
      prop.vesc.textContent = V_ESC.toFixed(2);
      return;
    }
    const trail = trails[activeIndex];
    const ball = trail.ball;
    const speed = Math.hypot(ball.vx, ball.vy);
    prop.speed.textContent = speed.toFixed(2);
    prop.altitude.textContent = ball.maxAltitude.toFixed(1);
    prop.vcirc.textContent = V_CIRC.toFixed(2);
    prop.vesc.textContent = V_ESC.toFixed(2);
    const key = classify(ball, trail.v0);
    prop.outcome.textContent = i18nText(key, key);
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

  velocityValue.textContent = parseFloat(velocityInput.value).toFixed(2);
  timeScaleValue.textContent = formatScale(timeScale);
  wireEvents();
  updateActiveReadouts();
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  animId = requestAnimationFrame(tick);
})();
