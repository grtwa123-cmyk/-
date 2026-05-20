(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const starMassInput = document.getElementById('star-mass');
  const starMassValue = document.getElementById('star-mass-value');
  const clearBtn = document.getElementById('clear-btn');
  const propCount = document.getElementById('prop-count');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  const BASE_GM = 16000;
  const STAR_RADIUS = 22;
  const VELOCITY_SCALE = 0.45;
  const PALETTE = ['#6ea8ff', '#ffb86b', '#6effc6', '#ff6b8a', '#c47bff', '#ffe14a'];

  let CW = 800;
  let CH = 640;
  let starMass = parseFloat(starMassInput.value);
  let planets = [];
  let drag = null;
  let animId = null;
  let lastTs = 0;
  let nextColor = 0;

  function gm() { return BASE_GM * starMass; }
  function starX() { return CW / 2; }
  function starY() { return CH / 2; }

  function addPlanet(x, y, vx, vy) {
    planets.push({
      x, y, vx, vy,
      trail: [{ x, y }],
      color: PALETTE[nextColor % PALETTE.length],
      alive: true,
    });
    nextColor++;
    updateCount();
  }

  function clearAll() {
    planets = [];
    nextColor = 0;
    updateCount();
  }

  function updateCount() {
    propCount.textContent = String(planets.filter(p => p.alive).length);
  }

  function stepPlanets(dt) {
    const cx = starX();
    const cy = starY();
    const k = gm();
    const sub = 6;
    const h = dt / sub;
    let changed = false;
    for (const p of planets) {
      if (!p.alive) continue;
      for (let s = 0; s < sub; s++) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const r2 = dx * dx + dy * dy;
        const r = Math.sqrt(r2);
        if (r < STAR_RADIUS) {
          p.alive = false;
          changed = true;
          break;
        }
        const a = -k / r2;
        p.vx += a * (dx / r) * h;
        p.vy += a * (dy / r) * h;
        p.x += p.vx * h;
        p.y += p.vy * h;
      }
      if (!p.alive) continue;
      const last = p.trail[p.trail.length - 1];
      const ddx = last.x - p.x;
      const ddy = last.y - p.y;
      if (ddx * ddx + ddy * ddy > 2 && p.trail.length < 6000) {
        p.trail.push({ x: p.x, y: p.y });
      }
      const margin = 200;
      if (p.x < -margin || p.x > CW + margin || p.y < -margin || p.y > CH + margin) {
        p.alive = false;
        changed = true;
      }
    }
    if (changed) updateCount();
  }

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
    const R = STAR_RADIUS * (0.7 + 0.3 * Math.min(starMass, 2.5));
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.5);
    grad.addColorStop(0, 'rgba(255, 235, 130, 0.95)');
    grad.addColorStop(0.4, 'rgba(255, 184, 107, 0.4)');
    grad.addColorStop(1, 'rgba(255, 184, 107, 0)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'rgba(255, 220, 130, 0.85)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#ffe0a0';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlanet(p) {
    ctx.save();
    if (p.trail.length > 1) {
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p.trail[0].x, p.trail[0].y);
      for (let i = 1; i < p.trail.length; i++) {
        ctx.lineTo(p.trail[i].x, p.trail[i].y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (p.alive) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
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

    // Velocity arrow at the start point
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

    // Ghost planet at the start
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
    for (const p of planets) drawPlanet(p);
    drawStar();
    drawDrag();
    drawHint();
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    stepPlanets(dt);
    draw();
    animId = requestAnimationFrame(tick);
  }

  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function startDrag(x, y) {
    drag = { startX: x, startY: y, currentX: x, currentY: y };
  }

  function moveDrag(x, y) {
    if (!drag) return;
    drag.currentX = x;
    drag.currentY = y;
  }

  function endDrag() {
    if (!drag) return;
    const vx = (drag.currentX - drag.startX) * VELOCITY_SCALE;
    const vy = (drag.currentY - drag.startY) * VELOCITY_SCALE;
    const dx = drag.startX - starX();
    const dy = drag.startY - starY();
    if (dx * dx + dy * dy >= STAR_RADIUS * STAR_RADIUS) {
      addPlanet(drag.startX, drag.startY, vx, vy);
    }
    drag = null;
  }

  function wireEvents() {
    starMassInput.addEventListener('input', () => {
      starMass = parseFloat(starMassInput.value);
      starMassValue.textContent = starMass.toFixed(2);
    });
    clearBtn.addEventListener('click', clearAll);

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

  document.addEventListener('langchange', draw);

  function resizeCanvas() {
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
    draw();
  }

  starMassValue.textContent = starMass.toFixed(2);
  wireEvents();
  updateCount();
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  animId = requestAnimationFrame(tick);
})();
