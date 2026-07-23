(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  let CW = 800;
  let CH = 400;

  const inputs = {
    velocity: document.getElementById('velocity'),
    angle: document.getElementById('angle'),
    gravity: document.getElementById('gravity'),
  };
  const inputValues = {
    velocity: document.getElementById('velocity-value'),
    angle: document.getElementById('angle-value'),
    gravity: document.getElementById('gravity-value'),
  };
  const out = {
    range: document.getElementById('out-range'),
    height: document.getElementById('out-height'),
    time: document.getElementById('out-time'),
    t: document.getElementById('out-t'),
    x: document.getElementById('out-x'),
    y: document.getElementById('out-y'),
    speed: document.getElementById('out-speed'),
  };
  const launchBtn = document.getElementById('launch-btn');
  const resetBtn = document.getElementById('reset-btn');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : '0.00';

  function readParams() {
    return {
      v0: parseFloat(inputs.velocity.value),
      theta: parseFloat(inputs.angle.value),
      g: parseFloat(inputs.gravity.value),
    };
  }

  function derived(p) {
    const r = toRad(p.theta);
    const sinT = Math.sin(r);
    const cosT = Math.cos(r);
    const safeG = p.g > 0 ? p.g : 0.0001;
    const T = (2 * p.v0 * sinT) / safeG;
    const H = (p.v0 * sinT) ** 2 / (2 * safeG);
    const R = (p.v0 * p.v0 * Math.sin(2 * r)) / safeG;
    return { T, H, R, sinT, cosT };
  }

  function fitScale(R, H) {
    const margin = 40;
    const w = CW - margin * 2;
    const h = CH - margin * 2;
    const worldW = Math.max(R * 1.05, 1);
    const worldH = Math.max(H * 1.2, 1);
    const scale = Math.min(w / worldW, h / worldH);
    return { scale, margin };
  }

  function worldToCanvas(x, y, scale, margin) {
    return {
      cx: margin + x * scale,
      cy: CH - margin - y * scale,
    };
  }

  function drawAxes(scale, margin, R) {
    ctx.save();
    ctx.strokeStyle = '#3a4570';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, CH - margin);
    ctx.lineTo(CW - margin, CH - margin);
    ctx.stroke();

    ctx.fillStyle = '#95a0bf';
    ctx.font = '12px "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const target = 6;
    const rawStep = Math.max(R / target, 1);
    const pow = 10 ** Math.floor(Math.log10(rawStep));
    const niceStep = Math.ceil(rawStep / pow) * pow;
    const maxX = (CW - 2 * margin) / scale;

    for (let x = 0; x <= maxX + 0.5; x += niceStep) {
      const { cx, cy } = worldToCanvas(x, 0, scale, margin);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy + 4);
      ctx.strokeStyle = '#3a4570';
      ctx.stroke();
      ctx.fillText(`${x.toFixed(0)} m`, cx, cy + 6);
    }
    ctx.restore();
  }

  function drawLauncher(scale, margin) {
    const { cx, cy } = worldToCanvas(0, 0, scale, margin);
    ctx.save();
    ctx.fillStyle = '#6ea8ff';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawProjectile(x, y, scale, margin) {
    const { cx, cy } = worldToCanvas(x, y, scale, margin);
    ctx.save();
    ctx.fillStyle = '#ffb86b';
    ctx.shadowColor = 'rgba(255, 184, 107, 0.6)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTrajectory(points, scale, margin) {
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 184, 107, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const first = worldToCanvas(points[0].x, points[0].y, scale, margin);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < points.length; i++) {
      const p = worldToCanvas(points[i].x, points[i].y, scale, margin);
      ctx.lineTo(p.cx, p.cy);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawPreviewArc(p, d, scale, margin) {
    if (d.T <= 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(110, 168, 255, 0.35)';
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const t = (d.T * i) / steps;
      const x = p.v0 * d.cosT * t;
      const y = p.v0 * d.sinT * t - 0.5 * p.g * t * t;
      const { cx, cy } = worldToCanvas(x, Math.max(y, 0), scale, margin);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.restore();
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, CW, CH);
  }

  let animId = null;
  let startTs = 0;
  let trail = [];
  let running = false;
  let activeParams = null;
  let activeDerived = null;

  function renderStatic() {
    const p = readParams();
    const d = derived(p);
    const { scale, margin } = fitScale(d.R, d.H);
    clearCanvas();
    drawAxes(scale, margin, d.R);
    drawPreviewArc(p, d, scale, margin);
    drawLauncher(scale, margin);

    out.range.textContent = fmt(d.R);
    out.height.textContent = fmt(d.H);
    out.time.textContent = fmt(d.T);
    if (!running) {
      out.t.textContent = '0.00';
      out.x.textContent = '0.00';
      out.y.textContent = '0.00';
      out.speed.textContent = fmt(p.v0);
    }
  }

  function step(ts) {
    if (!running) return;
    if (!startTs) startTs = ts;
    const t = (ts - startTs) / 1000;

    const p = activeParams;
    const d = activeDerived;
    const x = p.v0 * d.cosT * t;
    const y = p.v0 * d.sinT * t - 0.5 * p.g * t * t;

    const vx = p.v0 * d.cosT;
    const vy = p.v0 * d.sinT - p.g * t;
    const speed = Math.hypot(vx, vy);

    const { scale, margin } = fitScale(d.R, d.H);

    if (y <= 0 && t > 0) {
      const finalT = d.T;
      const finalX = p.v0 * d.cosT * finalT;
      trail.push({ x: finalX, y: 0 });
      clearCanvas();
      drawAxes(scale, margin, d.R);
      drawTrajectory(trail, scale, margin);
      drawLauncher(scale, margin);
      drawProjectile(finalX, 0, scale, margin);
      out.t.textContent = fmt(finalT);
      out.x.textContent = fmt(finalX);
      out.y.textContent = '0.00';
      out.speed.textContent = fmt(Math.hypot(p.v0 * d.cosT, p.v0 * d.sinT - p.g * finalT));
      // Landing thud — soft low impact.
      window.SFX?.noise({ dur: 0.14, gain: 0.16, color: 'pink', filter: 'lowpass', freq: 420, q: 0.7 });
      running = false;
      animId = null;
      launchBtn.textContent = i18nText('launchBtn', 'Launch');
      return;
    }

    trail.push({ x, y });
    clearCanvas();
    drawAxes(scale, margin, d.R);
    drawTrajectory(trail, scale, margin);
    drawLauncher(scale, margin);
    drawProjectile(x, y, scale, margin);

    out.t.textContent = fmt(t);
    out.x.textContent = fmt(x);
    out.y.textContent = fmt(Math.max(y, 0));
    out.speed.textContent = fmt(speed);

    animId = requestAnimationFrame(step);
  }

  function launch() {
    if (animId) cancelAnimationFrame(animId);
    activeParams = readParams();
    activeDerived = derived(activeParams);
    if (activeDerived.T <= 0) {
      renderStatic();
      return;
    }
    trail = [{ x: 0, y: 0 }];
    startTs = 0;
    running = true;
    // Launch "whoomp" — pitch rises with muzzle speed.
    window.SFX?.sweep({ from: 150, to: 360 + activeParams.v0 * 4, dur: 0.16, type: 'sawtooth', gain: 0.16 });
    launchBtn.textContent = i18nText('launchingBtn', 'Launching…');
    animId = requestAnimationFrame(step);
  }

  function reset() {
    if (animId) cancelAnimationFrame(animId);
    animId = null;
    running = false;
    trail = [];
    launchBtn.textContent = i18nText('launchBtn', 'Launch');
    renderStatic();
  }

  function wireInputs() {
    for (const key of Object.keys(inputs)) {
      const el = inputs[key];
      const display = inputValues[key];
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        display.textContent = key === 'gravity' ? v.toFixed(2) : String(Math.round(v));
        if (!running) renderStatic();
      });
    }
    launchBtn.addEventListener('click', launch);
    resetBtn.addEventListener('click', reset);
  }

  function resizeCanvas() {
    // Un-pin the inline size from the previous pass before measuring —
    // otherwise the canvas can never grow back when the window widens
    // (it would keep re-measuring its own pinned width forever).
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
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
    renderStatic();
  }

  document.addEventListener('langchange', () => {
    launchBtn.textContent = running
      ? i18nText('launchingBtn', 'Launching…')
      : i18nText('launchBtn', 'Launch');
  });

  window.addEventListener('resize', resizeCanvas);
  wireInputs();
  resizeCanvas();
})();
