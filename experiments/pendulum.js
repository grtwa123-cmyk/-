(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const inputs = {
    length: document.getElementById('length'),
    gravity: document.getElementById('gravity'),
    angle: document.getElementById('angle'),
    damping: document.getElementById('damping'),
  };
  const inputValues = {
    length: document.getElementById('length-value'),
    gravity: document.getElementById('gravity-value'),
    angle: document.getElementById('angle-value'),
    damping: document.getElementById('damping-value'),
  };
  const out = {
    period: document.getElementById('out-period'),
    angle: document.getElementById('out-angle'),
    angvel: document.getElementById('out-angvel'),
    time: document.getElementById('out-time'),
  };
  const startBtn = document.getElementById('start-btn');
  const resetBtn = document.getElementById('reset-btn');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : '0.00';

  function readParams() {
    return {
      L: parseFloat(inputs.length.value),
      g: parseFloat(inputs.gravity.value),
      theta0: toRad(parseFloat(inputs.angle.value)),
      b: parseFloat(inputs.damping.value),
    };
  }

  function smallAnglePeriod(L, g) {
    const safeG = g > 0 ? g : 0.0001;
    return 2 * Math.PI * Math.sqrt(L / safeG);
  }

  let theta = 0;
  let omega = 0;
  let elapsed = 0;
  let activeParams = null;
  let running = false;
  let animId = null;
  let lastTs = 0;

  function pivot() {
    return { x: canvas.width / 2, y: canvas.height * 0.18 };
  }

  function pixelsPerMeter() {
    const p = pivot();
    const available = canvas.height - p.y - 30;
    const maxL = 3.0;
    return available / maxL;
  }

  function drawScene(L) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const p = pivot();
    const ppm = pixelsPerMeter();
    const lengthPx = L * ppm;
    const bobX = p.x + lengthPx * Math.sin(theta);
    const bobY = p.y + lengthPx * Math.cos(theta);

    ctx.save();
    ctx.strokeStyle = 'rgba(110, 168, 255, 0.25)';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y + lengthPx);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(110, 168, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, lengthPx, Math.PI / 2 - Math.PI / 2.2, Math.PI / 2 + Math.PI / 2.2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#e8ecf7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(bobX, bobY);
    ctx.stroke();

    ctx.fillStyle = '#3a4570';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6ea8ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffb86b';
    ctx.shadowColor = 'rgba(255, 184, 107, 0.55)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(bobX, bobY, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function updateReadouts(L, g) {
    out.period.textContent = fmt(smallAnglePeriod(L, g));
    out.angle.textContent = fmt(toDeg(theta));
    out.angvel.textContent = fmt(toDeg(omega));
    out.time.textContent = fmt(elapsed);
  }

  function renderStatic() {
    const p = readParams();
    if (!running) {
      theta = p.theta0;
      omega = 0;
      elapsed = 0;
    }
    drawScene(p.L);
    updateReadouts(p.L, p.g);
  }

  function step(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;

    const { L, g, b } = activeParams;
    const safeL = L > 0 ? L : 0.0001;

    const sub = 4;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const a1 = -(g / safeL) * Math.sin(theta) - b * omega;
      const k1v = a1;
      const k1x = omega;

      const theta2 = theta + (h / 2) * k1x;
      const omega2 = omega + (h / 2) * k1v;
      const a2 = -(g / safeL) * Math.sin(theta2) - b * omega2;
      const k2v = a2;
      const k2x = omega2;

      const theta3 = theta + (h / 2) * k2x;
      const omega3 = omega + (h / 2) * k2v;
      const a3 = -(g / safeL) * Math.sin(theta3) - b * omega3;
      const k3v = a3;
      const k3x = omega3;

      const theta4 = theta + h * k3x;
      const omega4 = omega + h * k3v;
      const a4 = -(g / safeL) * Math.sin(theta4) - b * omega4;
      const k4v = a4;
      const k4x = omega4;

      theta += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      omega += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    }
    elapsed += dt;

    drawScene(L);
    updateReadouts(L, g);

    animId = requestAnimationFrame(step);
  }

  function start() {
    if (running) {
      pause();
      return;
    }
    activeParams = readParams();
    if (elapsed === 0) {
      theta = activeParams.theta0;
      omega = 0;
    }
    running = true;
    lastTs = 0;
    startBtn.textContent = i18nText('pauseBtn', 'Pause');
    animId = requestAnimationFrame(step);
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
      if (running) activeParams.L = v;
      else renderStatic();
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
    startBtn.addEventListener('click', start);
    resetBtn.addEventListener('click', reset);
  }

  document.addEventListener('langchange', () => {
    startBtn.textContent = running
      ? i18nText('pauseBtn', 'Pause')
      : i18nText('startBtn', 'Start');
  });

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(Math.round(rect.width), 300);
    canvas.height = Math.max(Math.round(rect.height), 240);
    if (running) drawScene(activeParams.L);
    else renderStatic();
  }

  window.addEventListener('resize', resizeCanvas);
  wireInputs();
  resizeCanvas();
})();
