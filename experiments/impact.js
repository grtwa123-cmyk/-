(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const heightInput = document.getElementById('drop-height');
  const heightValue = document.getElementById('drop-height-value');
  const materialList = document.getElementById('material-list');
  const dropBtn = document.getElementById('drop-btn');
  const resetBtn = document.getElementById('reset-btn');
  const clearGraphBtn = document.getElementById('clear-graph-btn');
  const prop = {
    impactV: document.getElementById('prop-impact-v'),
    peakF: document.getElementById('prop-peak-f'),
    avgF: document.getElementById('prop-avg-f'),
    impulse: document.getElementById('prop-impulse'),
    collisionT: document.getElementById('prop-collision-t'),
    verdict: document.getElementById('prop-verdict'),
  };

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  const EGG_MASS = 0.06; // kg
  const G = 9.81;
  const PX_PER_M_MAX = 80; // baseline pixels per metre; auto-shrinks for tall drops
  const BREAK_THRESHOLD = 30; // N
  const COLLISION_VISUAL_DURATION = 0.55; // wall-clock seconds spent rendering each collision

  const MATERIALS = {
    hard:   { key: 'hard',   labelKey: 'materialHard',   tCollision: 0.005, color: '#5d6582', cushionHeight: 0,  maxCompression: 4,  graphColor: '#ff6b8a' },
    medium: { key: 'medium', labelKey: 'materialMedium', tCollision: 0.03,  color: '#d97b7b', cushionHeight: 30, maxCompression: 14, graphColor: '#ffb86b' },
    soft:   { key: 'soft',   labelKey: 'materialSoft',   tCollision: 0.08,  color: '#7da6ff', cushionHeight: 60, maxCompression: 32, graphColor: '#6effc6' },
  };
  const MATERIAL_KEYS = ['hard', 'medium', 'soft'];
  const PALETTE_FALLBACK = '#c47bff';

  let CW = 800;
  let CH = 780;
  let dropHeight = parseFloat(heightInput.value);
  let currentMaterialKey = 'medium';
  let drops = []; // history of completed drops {samples, peakF, avgF, impulse, tCollision, impactV, broken, color, materialKey}
  let currentDrop = null;
  let animId = null;
  let lastTs = 0;

  const egg = {
    state: 'idle', // idle | falling | collision | done
    materialKey: 'medium',
    h: dropHeight, // height used when drop started
    pxPerM: PX_PER_M_MAX, // scale used for this drop
    y: 0,
    vy: 0,
    t: 0,
    visualT: 0,
    broken: false,
    contactY: 0,
  };

  // ---- layout ----
  function scenePadTop() { return 30; }
  function sceneBottom() { return Math.round(CH * 0.58); }
  function floorYpx() { return sceneBottom() - 30; }
  function cushionTopYpx(matKey) { return floorYpx() - MATERIALS[matKey].cushionHeight; }
  function pxPerMeter(matKey, h) {
    const available = cushionTopYpx(matKey) - scenePadTop() - 18;
    const safeH = Math.max(h, 0.01);
    return Math.min(PX_PER_M_MAX, available / safeH);
  }
  function eggStartYpx(matKey, h) {
    return cushionTopYpx(matKey) - h * pxPerMeter(matKey, h);
  }

  function clampEggForIdle() {
    let y = eggStartYpx(egg.materialKey, dropHeight);
    if (y < scenePadTop() + 14) y = scenePadTop() + 14;
    egg.y = y;
  }

  // ---- physics ----
  function startDrop() {
    if (egg.state === 'falling' || egg.state === 'collision') return;
    egg.materialKey = currentMaterialKey;
    egg.h = dropHeight;
    egg.pxPerM = pxPerMeter(egg.materialKey, egg.h);
    egg.y = eggStartYpx(egg.materialKey, egg.h);
    if (egg.y < scenePadTop() + 14) egg.y = scenePadTop() + 14;
    egg.vy = 0;
    egg.t = 0;
    egg.visualT = 0;
    egg.broken = false;
    egg.contactY = cushionTopYpx(egg.materialKey);
    egg.state = 'falling';
    currentDrop = null;
  }

  function resetEgg() {
    egg.state = 'idle';
    egg.materialKey = currentMaterialKey;
    egg.vy = 0;
    egg.broken = false;
    egg.visualT = 0;
    egg.t = 0;
    currentDrop = null;
    clampEggForIdle();
  }

  function clearGraph() {
    drops = [];
    updateReadoutsForLatest();
  }

  function step(dt) {
    if (egg.state === 'falling') {
      const aPx = G * egg.pxPerM;
      egg.vy += aPx * dt;
      egg.y += egg.vy * dt;
      const contactY = egg.contactY;
      if (egg.y >= contactY) {
        // Snap to contact and switch to collision phase.
        egg.y = contactY;
        const vMS = egg.vy / egg.pxPerM;
        const mat = MATERIALS[egg.materialKey];
        const J = EGG_MASS * vMS;
        const peakF = (Math.PI * J) / (2 * mat.tCollision);
        const avgF = J / mat.tCollision;
        const broken = peakF > BREAK_THRESHOLD;
        currentDrop = {
          materialKey: egg.materialKey,
          samples: [{ t: 0, F: 0 }],
          peakF,
          avgF,
          impulse: J,
          tCollision: mat.tCollision,
          impactV: vMS,
          broken,
          color: mat.graphColor || PALETTE_FALLBACK,
        };
        egg.state = 'collision';
        egg.visualT = 0;
        egg.t = 0;
        egg.broken = broken;
        // Impact sound — a crack if it broke, otherwise a thud whose
        // dullness follows the cushion (hard = sharp, soft = muffled).
        if (broken) {
          window.SFX?.noise({ dur: 0.12, gain: 0.28, color: 'white', filter: 'highpass', freq: 1600, q: 0.7 });
          window.SFX?.noise({ dur: 0.06, gain: 0.2, color: 'white', filter: 'bandpass', freq: 3000, q: 2 });
        } else {
          const cut = egg.materialKey === 'hard' ? 900 : egg.materialKey === 'medium' ? 500 : 280;
          const dur = egg.materialKey === 'soft' ? 0.18 : 0.1;
          window.SFX?.noise({ dur, gain: Math.min(0.28, 0.08 + vMS * 0.03), color: 'pink', filter: 'lowpass', freq: cut, q: 0.8 });
        }
      }
    } else if (egg.state === 'collision') {
      egg.visualT += dt;
      const progress = Math.min(1, egg.visualT / COLLISION_VISUAL_DURATION);
      const mat = MATERIALS[egg.materialKey];
      egg.t = mat.tCollision * progress;
      const phase = Math.sin(Math.PI * progress);
      const F = currentDrop.peakF * phase;
      if (currentDrop.samples[currentDrop.samples.length - 1].t < egg.t - 0.0001) {
        currentDrop.samples.push({ t: egg.t, F });
      }
      // Egg sinks into the cushion (or onto the hard floor)
      egg.y = egg.contactY + phase * mat.maxCompression;
      if (progress >= 1) {
        // Finished: commit the drop
        drops.push(currentDrop);
        if (drops.length > 5) drops.shift();
        const finished = currentDrop;
        currentDrop = null;
        egg.state = 'done';
        // Resting position
        if (egg.broken) {
          egg.y = egg.contactY + mat.maxCompression * 0.6;
        } else {
          egg.y = egg.contactY;
        }
        updateReadoutsFor(finished);
      }
    }
  }

  // ---- readouts ----
  function fmt(n, digits = 2) { return Number.isFinite(n) ? n.toFixed(digits) : '—'; }

  function updateReadoutsFor(d) {
    if (!d) {
      prop.impactV.textContent = '—';
      prop.peakF.textContent = '—';
      prop.avgF.textContent = '—';
      prop.impulse.textContent = '—';
      prop.collisionT.textContent = '—';
      prop.verdict.textContent = i18nText('verdictWaiting', '—');
      return;
    }
    prop.impactV.textContent = `${fmt(d.impactV)} m/s`;
    prop.peakF.textContent = `${fmt(d.peakF, 1)} N`;
    prop.avgF.textContent = `${fmt(d.avgF, 1)} N`;
    prop.impulse.textContent = `${fmt(d.impulse, 3)} N·s`;
    prop.collisionT.textContent = `${fmt(d.tCollision * 1000, 1)} ms`;
    prop.verdict.textContent = d.broken
      ? i18nText('verdictBroken', 'Egg broke')
      : i18nText('verdictSurvived', 'Egg survived');
    prop.verdict.style.color = d.broken ? '#ff6b8a' : '#6effc6';
  }

  function updateReadoutsForLatest() {
    if (drops.length === 0 && egg.state !== 'collision') {
      updateReadoutsFor(null);
      prop.verdict.style.color = '';
    } else if (drops.length > 0) {
      updateReadoutsFor(drops[drops.length - 1]);
    }
  }

  // ---- drawing ----
  function drawScene() {
    const mat = MATERIALS[egg.materialKey];
    const floorTop = floorYpx();
    const cushionTop = cushionTopYpx(egg.materialKey);

    // Floor slab
    ctx.fillStyle = '#3a4570';
    ctx.fillRect(0, floorTop, CW, 28);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, floorTop, CW, 4);

    // Cushion
    if (mat.cushionHeight > 0) {
      const grad = ctx.createLinearGradient(0, cushionTop, 0, floorTop);
      grad.addColorStop(0, mat.color);
      grad.addColorStop(1, '#2a3252');
      ctx.fillStyle = grad;
      ctx.fillRect(0, cushionTop, CW, mat.cushionHeight);
      // Top highlight
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(0, cushionTop, CW, 3);
    }

    // Drop-height indicator while idle / done
    if (egg.state === 'idle') {
      const xEgg = CW / 2;
      const yEgg = egg.y;
      ctx.save();
      ctx.strokeStyle = 'rgba(232, 236, 247, 0.32)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(xEgg + 26, yEgg);
      ctx.lineTo(xEgg + 26, cushionTop);
      ctx.stroke();
      // Tick marks at endpoints
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(xEgg + 20, yEgg);
      ctx.lineTo(xEgg + 32, yEgg);
      ctx.moveTo(xEgg + 20, cushionTop);
      ctx.lineTo(xEgg + 32, cushionTop);
      ctx.stroke();
      // Label
      ctx.fillStyle = 'rgba(232, 236, 247, 0.75)';
      ctx.font = `600 13px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${dropHeight.toFixed(2)} m`, xEgg + 38, (yEgg + cushionTop) / 2);
      ctx.restore();
    }

    // Egg
    drawEgg(CW / 2, egg.y, egg.broken);
  }

  function drawEgg(x, y, broken) {
    ctx.save();
    if (broken) {
      // Splat: yolk + shell pieces
      ctx.fillStyle = 'rgba(255, 224, 130, 0.95)';
      ctx.beginPath();
      ctx.ellipse(x, y, 18, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 197, 80, 1)';
      ctx.beginPath();
      ctx.arc(x, y - 1, 6, 0, Math.PI * 2);
      ctx.fill();
      // Shell shards
      ctx.fillStyle = '#fdf6e3';
      const shards = [[-22, -2, -0.4], [-10, -6, 0.3], [12, -5, -0.2], [22, -1, 0.5]];
      for (const [dx, dy, rot] of shards) {
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, 6, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#fdf6e3';
      ctx.beginPath();
      ctx.ellipse(x, y - 14, 13, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Sheen
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.ellipse(x - 4, y - 22, 3.5, 6, -0.25, 0, Math.PI * 2);
      ctx.fill();
      // Outline
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y - 14, 13, 18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- graph ----
  function graphRect() {
    const left = 70;
    const right = CW - 30;
    const top = sceneBottom() + 50;
    const bottom = CH - 30;
    return { left, right, top, bottom };
  }

  function drawGraph() {
    const { left, right, top, bottom } = graphRect();

    // Panel background
    ctx.fillStyle = 'rgba(22, 27, 48, 0.6)';
    ctx.fillRect(left - 50, top - 40, right - left + 80, bottom - top + 60);
    ctx.strokeStyle = 'rgba(110, 168, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 50, top - 40, right - left + 80, bottom - top + 60);

    // Title
    ctx.fillStyle = '#e8ecf7';
    ctx.font = `700 15px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(i18nText('forceVsTime', 'Force vs time'), left - 40, top - 14);

    // Decide axis ranges
    const allDrops = drops.concat(currentDrop ? [currentDrop] : []);
    let maxT = 0.05;
    let maxF = BREAK_THRESHOLD * 1.2;
    for (const d of allDrops) {
      if (d.tCollision > maxT) maxT = d.tCollision;
      if (d.peakF > maxF) maxF = d.peakF;
    }
    maxT = Math.max(maxT * 1.1, 0.05);
    maxF = Math.max(maxF * 1.15, BREAK_THRESHOLD * 1.2);

    const xScale = (right - left) / maxT;
    const yScale = (bottom - top) / maxF;

    // Y grid + ticks
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(232, 236, 247, 0.7)';
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yTicks = 4;
    for (let i = 1; i <= yTicks; i++) {
      const F = (maxF / yTicks) * i;
      const y = bottom - F * yScale;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillText(`${F.toFixed(0)}`, left - 8, y);
    }
    ctx.fillStyle = 'rgba(232, 236, 247, 0.85)';
    ctx.fillText('F (N)', left - 8, top - 12);

    // X axis ticks
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(232, 236, 247, 0.7)';
    const xTickStep = niceTickStep(maxT * 1000, 6); // ms
    for (let tms = 0; tms <= maxT * 1000 + 0.0001; tms += xTickStep) {
      const x = left + (tms / 1000) * xScale;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232, 236, 247, 0.18)';
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + 5);
      ctx.stroke();
      ctx.fillText(`${tms.toFixed(0)}`, x, bottom + 8);
    }
    ctx.fillStyle = 'rgba(232, 236, 247, 0.85)';
    ctx.fillText('t (ms)', right - 8, bottom + 22);

    // Axes
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(left, top - 4);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    // Break threshold line
    const yThresh = bottom - BREAK_THRESHOLD * yScale;
    if (yThresh > top) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 107, 138, 0.55)';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(left, yThresh);
      ctx.lineTo(right, yThresh);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 107, 138, 0.85)';
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${i18nText('breakThresholdLabel', 'Break threshold')} ${BREAK_THRESHOLD} N`, left + 6, yThresh - 4);
      ctx.restore();
    }

    // Curves: past drops, then active drop on top
    for (let i = 0; i < drops.length; i++) {
      drawCurve(drops[i], left, bottom, xScale, yScale, false);
    }
    if (currentDrop) {
      drawCurve(currentDrop, left, bottom, xScale, yScale, true);
    }

    // Legend
    drawLegend(left, top - 36, allDrops);
  }

  function drawCurve(d, left, bottom, xScale, yScale, active) {
    if (!d || d.samples.length < 2) return;
    ctx.save();
    ctx.strokeStyle = d.color;
    ctx.lineWidth = active ? 2.6 : 1.7;
    ctx.globalAlpha = active ? 1 : 0.7;
    ctx.beginPath();
    ctx.moveTo(left + d.samples[0].t * xScale, bottom - d.samples[0].F * yScale);
    for (let i = 1; i < d.samples.length; i++) {
      ctx.lineTo(left + d.samples[i].t * xScale, bottom - d.samples[i].F * yScale);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawLegend(x, y, allDrops) {
    if (allDrops.length === 0) return;
    ctx.save();
    ctx.font = `600 12px ${FONT}`;
    ctx.textBaseline = 'middle';
    let cursor = x + 80;
    const seen = new Set();
    for (const d of allDrops) {
      if (seen.has(d.materialKey)) continue;
      seen.add(d.materialKey);
      const label = i18nText(MATERIALS[d.materialKey].labelKey, d.materialKey);
      // Dot
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(cursor, y + 6, 5, 0, Math.PI * 2);
      ctx.fill();
      // Label
      ctx.fillStyle = 'rgba(232, 236, 247, 0.9)';
      ctx.textAlign = 'left';
      ctx.fillText(label, cursor + 10, y + 6);
      cursor += 12 + ctx.measureText(label).width + 20;
    }
    ctx.restore();
  }

  function niceTickStep(maxValue, target) {
    const raw = maxValue / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const r = raw / pow;
    let nice = 1;
    if (r >= 5) nice = 5;
    else if (r >= 2) nice = 2;
    return nice * pow;
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    drawScene();
    drawGraph();
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

  // ---- input wiring ----
  function selectMaterial(key) {
    if (!MATERIALS[key]) return;
    currentMaterialKey = key;
    materialList.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.key === key);
    });
    if (egg.state === 'idle') {
      egg.materialKey = key;
      clampEggForIdle();
    } else if (egg.state === 'done') {
      // Reflect the new floor visually; rest the egg on the new cushion top.
      egg.materialKey = key;
      const mat = MATERIALS[key];
      egg.contactY = cushionTopYpx(key);
      egg.y = egg.broken
        ? egg.contactY + mat.maxCompression * 0.6
        : egg.contactY;
    }
  }

  function wireEvents() {
    heightInput.addEventListener('input', () => {
      dropHeight = parseFloat(heightInput.value);
      heightValue.textContent = dropHeight.toFixed(2);
      if (egg.state === 'idle') clampEggForIdle();
    });
    materialList.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.addEventListener('click', () => selectMaterial(btn.dataset.key));
    });
    dropBtn.addEventListener('click', startDrop);
    resetBtn.addEventListener('click', resetEgg);
    clearGraphBtn.addEventListener('click', clearGraph);
  }

  document.addEventListener('langchange', () => {
    updateReadoutsForLatest();
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
    CH = 780;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.style.setProperty('width', CW + 'px', 'important');
    canvas.style.setProperty('height', CH + 'px', 'important');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (egg.state === 'idle' || egg.state === 'done') clampEggForIdle();
    draw();
  }

  heightValue.textContent = dropHeight.toFixed(2);
  wireEvents();
  selectMaterial('medium');
  updateReadoutsForLatest();
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
