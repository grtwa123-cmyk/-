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
  };
  const inputValues = {
    length: document.getElementById('length-value'),
    gravity: document.getElementById('gravity-value'),
    angle: document.getElementById('angle-value'),
    damping: document.getElementById('damping-value'),
    count: document.getElementById('count-value'),
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

  const WAVE_K = 30;

  function readParams() {
    return {
      L: parseFloat(inputs.length.value),
      g: parseFloat(inputs.gravity.value),
      theta0: toRad(parseFloat(inputs.angle.value)),
      b: parseFloat(inputs.damping.value),
      N: parseInt(inputs.count.value, 10),
    };
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

  function updateReadouts(Lbase, g) {
    out.period.textContent = fmt(smallAnglePeriod(Lbase, g));
    if (pendulums.length > 0) {
      out.angle.textContent = fmt(toDeg(pendulums[0].theta));
      out.angvel.textContent = fmt(toDeg(pendulums[0].omega));
    } else {
      out.angle.textContent = '0.00';
      out.angvel.textContent = '0.00';
    }
    out.time.textContent = fmt(elapsed);
  }

  function initPendulums(N, Lbase, theta0) {
    pendulums = [];
    for (let i = 0; i < N; i++) {
      pendulums.push({
        theta: theta0,
        omega: 0,
        L: lengthForIndex(i, N, Lbase),
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
      initPendulums(p.N, p.L, p.theta0);
      elapsed = 0;
    }
    drawScene(p.N, p.L);
    updateReadouts(p.L, p.g);
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

    integrate(dt);
    elapsed += dt;

    drawScene(pendulums.length, activeParams.L);
    updateReadouts(activeParams.L, activeParams.g);

    animId = requestAnimationFrame(step);
  }

  function start() {
    if (running) {
      pause();
      return;
    }
    activeParams = readParams();
    if (elapsed === 0 || pendulums.length !== activeParams.N) {
      initPendulums(activeParams.N, activeParams.L, activeParams.theta0);
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
    const dpr = window.devicePixelRatio || 1;
    CW = Math.max(Math.round(rect.width), 300);
    CH = Math.max(Math.round(rect.height), 240);
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
    if (pendulums.length > 0) drawScene(pendulums.length, activeParams.L);
    else renderStatic();
  }

  window.addEventListener('resize', resizeCanvas);
  wireInputs();
  resizeCanvas();
})();
