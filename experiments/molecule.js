(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const listEl = document.getElementById('molecule-list');
  const rotateToggle = document.getElementById('rotate-toggle');
  const speedInput = document.getElementById('rotate-speed');
  const speedValue = document.getElementById('rotate-speed-value');
  const labelsToggle = document.getElementById('labels-toggle');
  const prop = {
    name: document.getElementById('prop-name'),
    formula: document.getElementById('prop-formula'),
    geometry: document.getElementById('prop-geometry'),
    angle: document.getElementById('prop-angle'),
    hybrid: document.getElementById('prop-hybrid'),
    count: document.getElementById('prop-count'),
  };
  const patternBody = document.getElementById('pattern-body');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const ELEMENTS = {
    H:  { color: '#e8ecf7', text: '#0b1024', radius: 0.32 },
    C:  { color: '#454d6d', text: '#e8ecf7', radius: 0.65 },
    N:  { color: '#3050f8', text: '#ffffff', radius: 0.58 },
    O:  { color: '#ff5454', text: '#0b1024', radius: 0.55 },
    F:  { color: '#90e050', text: '#0b1024', radius: 0.48 },
    Cl: { color: '#1ff01f', text: '#0b1024', radius: 0.78 },
    S:  { color: '#ffe14a', text: '#0b1024', radius: 0.72 },
    P:  { color: '#ff8000', text: '#0b1024', radius: 0.7 },
  };

  const benzeneRing = () => {
    const r = 1.4;
    const atoms = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI * 2) / 6;
      atoms.push({ el: 'C', x: r * Math.cos(a), y: r * Math.sin(a), z: 0 });
    }
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI * 2) / 6;
      atoms.push({ el: 'H', x: 2.5 * Math.cos(a), y: 2.5 * Math.sin(a), z: 0 });
    }
    return atoms;
  };
  const benzeneBonds = () => {
    const bonds = [];
    for (let i = 0; i < 6; i++) bonds.push([i, (i + 1) % 6, 1.5]);
    for (let i = 0; i < 6; i++) bonds.push([i, i + 6, 1]);
    return bonds;
  };

  const MOLECULES = {
    water: {
      key: 'water', nameKey: 'molWater', formula: 'H₂O',
      geometryKey: 'geomBent', angle: '104.5°', hybrid: 'sp³',
      patternKey: 'patternBodyBent',
      atoms: [
        { el: 'O', x: 0,     y: 0,    z: 0 },
        { el: 'H', x: -0.76, y: -0.59, z: 0 },
        { el: 'H', x: 0.76,  y: -0.59, z: 0 },
      ],
      bonds: [[0, 1, 1], [0, 2, 1]],
    },
    co2: {
      key: 'co2', nameKey: 'molCO2', formula: 'CO₂',
      geometryKey: 'geomLinear', angle: '180°', hybrid: 'sp',
      patternKey: 'patternBodyLinear',
      atoms: [
        { el: 'C', x: 0,     y: 0, z: 0 },
        { el: 'O', x: -1.16, y: 0, z: 0 },
        { el: 'O', x: 1.16,  y: 0, z: 0 },
      ],
      bonds: [[0, 1, 2], [0, 2, 2]],
    },
    methane: {
      key: 'methane', nameKey: 'molMethane', formula: 'CH₄',
      geometryKey: 'geomTetrahedral', angle: '109.5°', hybrid: 'sp³',
      patternKey: 'patternBodyTetrahedral',
      atoms: [
        { el: 'C', x: 0,      y: 0,      z: 0 },
        { el: 'H', x: 0.629,  y: 0.629,  z: 0.629 },
        { el: 'H', x: -0.629, y: -0.629, z: 0.629 },
        { el: 'H', x: -0.629, y: 0.629,  z: -0.629 },
        { el: 'H', x: 0.629,  y: -0.629, z: -0.629 },
      ],
      bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]],
    },
    ammonia: {
      key: 'ammonia', nameKey: 'molAmmonia', formula: 'NH₃',
      geometryKey: 'geomTrigPyramidal', angle: '107°', hybrid: 'sp³',
      patternKey: 'patternBodyTrigPyramidal',
      // H ring radius 0.937, apex height 0.376 below N → H–N–H = 107°,
      // N–H = 1.01 Å (the previous coordinates measured only 98.6°).
      atoms: [
        { el: 'N', x: 0,      y: 0.19,   z: 0 },
        { el: 'H', x: 0.937,  y: -0.186, z: 0 },
        { el: 'H', x: -0.468, y: -0.186, z: 0.811 },
        { el: 'H', x: -0.468, y: -0.186, z: -0.811 },
      ],
      bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]],
    },
    ethane: {
      key: 'ethane', nameKey: 'molEthane', formula: 'C₂H₆',
      geometryKey: 'geomTetrahedral', angle: '109.5°', hybrid: 'sp³',
      patternKey: 'patternBodyTetrahedral',
      atoms: [
        { el: 'C', x: -0.77, y: 0,     z: 0 },
        { el: 'C', x: 0.77,  y: 0,     z: 0 },
        { el: 'H', x: -1.16, y: 0.51,  z: 0.89 },
        { el: 'H', x: -1.16, y: 0.51,  z: -0.89 },
        { el: 'H', x: -1.16, y: -1.02, z: 0 },
        { el: 'H', x: 1.16,  y: -0.51, z: 0.89 },
        { el: 'H', x: 1.16,  y: -0.51, z: -0.89 },
        { el: 'H', x: 1.16,  y: 1.02,  z: 0 },
      ],
      bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 5, 1], [1, 6, 1], [1, 7, 1]],
    },
    ethylene: {
      key: 'ethylene', nameKey: 'molEthylene', formula: 'C₂H₄',
      geometryKey: 'geomTrigPlanar', angle: '120°', hybrid: 'sp²',
      patternKey: 'patternBodyTrigPlanar',
      atoms: [
        { el: 'C', x: -0.67, y: 0,     z: 0 },
        { el: 'C', x: 0.67,  y: 0,     z: 0 },
        { el: 'H', x: -1.24, y: 0.94,  z: 0 },
        { el: 'H', x: -1.24, y: -0.94, z: 0 },
        { el: 'H', x: 1.24,  y: 0.94,  z: 0 },
        { el: 'H', x: 1.24,  y: -0.94, z: 0 },
      ],
      bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1]],
    },
    benzene: {
      key: 'benzene', nameKey: 'molBenzene', formula: 'C₆H₆',
      geometryKey: 'geomPlanarRing', angle: '120°', hybrid: 'sp²',
      patternKey: 'patternBodyPlanarRing',
      atoms: benzeneRing(),
      bonds: benzeneBonds(),
    },
  };

  const MOL_ORDER = ['water', 'co2', 'methane', 'ammonia', 'ethane', 'ethylene', 'benzene'];

  let currentKey = 'water';
  let rotation = 0;
  let lastTs = 0;
  let animId = null;
  let CW = 800;
  let CH = 400;

  function buildList() {
    listEl.innerHTML = '';
    for (const key of MOL_ORDER) {
      const mol = MOLECULES[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mol-btn';
      btn.dataset.key = key;
      const label = document.createElement('span');
      label.dataset.i18n = mol.nameKey;
      label.textContent = i18nText(mol.nameKey, key);
      const formula = document.createElement('small');
      formula.textContent = mol.formula;
      btn.appendChild(label);
      btn.appendChild(formula);
      btn.addEventListener('click', () => {
        window.SFX?.tone({ freq: 600, dur: 0.07, type: 'triangle', gain: 0.1 });
        selectMolecule(key);
      });
      listEl.appendChild(btn);
    }
  }

  function project(atom, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: atom.x * cos + atom.z * sin,
      y: atom.y,
      z: -atom.x * sin + atom.z * cos,
      el: atom.el,
    };
  }

  function elementInfo(el) {
    return ELEMENTS[el] || { color: '#888', text: '#fff', radius: 0.5 };
  }

  function drawBond(a, b, order, scale, depthScale) {
    const z = (a.z + b.z) / 2;
    const f = depthScale(z);
    ctx.lineWidth = Math.max(1.5, 3 * f);
    ctx.strokeStyle = `rgba(232, 236, 247, ${0.55 + 0.4 * f})`;

    if (order === 1) {
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.lineTo(b.cx, b.cy);
      ctx.stroke();
    } else if (order === 2 || order === 3) {
      const dx = b.cx - a.cx;
      const dy = b.cy - a.cy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const offsets = order === 2 ? [-3.5, 3.5] : [-5, 0, 5];
      for (const off of offsets) {
        ctx.beginPath();
        ctx.moveTo(a.cx + nx * off, a.cy + ny * off);
        ctx.lineTo(b.cx + nx * off, b.cy + ny * off);
        ctx.stroke();
      }
    } else if (order === 1.5) {
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.lineTo(b.cx, b.cy);
      ctx.stroke();
      const dx = b.cx - a.cx;
      const dy = b.cy - a.cy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(a.cx + nx * 4, a.cy + ny * 4);
      ctx.lineTo(b.cx + nx * 4, b.cy + ny * 4);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAtom(atomCanvas, scale, depthScale, showLabel) {
    const f = depthScale(atomCanvas.z);
    const info = elementInfo(atomCanvas.el);
    const r = Math.max(8, info.radius * scale * 0.5 * f);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = info.color;
    ctx.beginPath();
    ctx.arc(atomCanvas.cx, atomCanvas.cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const grad = ctx.createRadialGradient(
      atomCanvas.cx - r * 0.35, atomCanvas.cy - r * 0.35, r * 0.1,
      atomCanvas.cx, atomCanvas.cy, r
    );
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(atomCanvas.cx, atomCanvas.cy, r, 0, Math.PI * 2);
    ctx.fill();

    if (showLabel && r >= 10) {
      ctx.fillStyle = info.text;
      ctx.font = `${Math.max(10, Math.floor(r * 0.9))}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(atomCanvas.el, atomCanvas.cx, atomCanvas.cy);
    }
    ctx.restore();
  }

  function render() {
    const mol = MOLECULES[currentKey];
    ctx.clearRect(0, 0, CW, CH);

    const projected = mol.atoms.map((a) => project(a, rotation));
    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    const zs = projected.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);

    const margin = 70;
    const scale = Math.min(
      (CW - margin * 2) / (spanX + 1.5),
      (CH - margin * 2) / (spanY + 1.5)
    );

    const zRange = Math.max(maxZ - minZ, 0.0001);
    const depthScale = (z) => {
      const t = (z - minZ) / zRange;
      return 0.65 + 0.45 * t;
    };

    const canvasAtoms = projected.map((p) => ({
      ...p,
      cx: CW / 2 + (p.x - midX) * scale,
      cy: CH / 2 - (p.y - midY) * scale,
    }));

    const bondItems = mol.bonds.map(([i, j, order]) => ({
      kind: 'bond',
      a: canvasAtoms[i],
      b: canvasAtoms[j],
      order,
      z: (canvasAtoms[i].z + canvasAtoms[j].z) / 2 - 0.001,
    }));
    const atomItems = canvasAtoms.map((a) => ({ kind: 'atom', a, z: a.z }));
    const items = [...bondItems, ...atomItems].sort((p, q) => p.z - q.z);

    const showLabels = labelsToggle.checked;
    for (const it of items) {
      if (it.kind === 'bond') drawBond(it.a, it.b, it.order, scale, depthScale);
      else drawAtom(it.a, scale, depthScale, showLabels);
    }
  }

  function updateProperties() {
    const mol = MOLECULES[currentKey];
    prop.name.textContent = i18nText(mol.nameKey, mol.key);
    prop.formula.textContent = mol.formula;
    prop.geometry.textContent = i18nText(mol.geometryKey, mol.geometryKey);
    prop.angle.textContent = mol.angle;
    prop.hybrid.textContent = mol.hybrid;
    prop.count.textContent = String(mol.atoms.length);
    patternBody.textContent = i18nText(mol.patternKey, '');
  }

  function highlightActive() {
    listEl.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.key === currentKey);
    });
  }

  function selectMolecule(key) {
    if (!MOLECULES[key]) return;
    currentKey = key;
    highlightActive();
    updateProperties();
    render();
  }

  function tick(ts) {
    if (!rotateToggle.checked) {
      animId = null;
      return;
    }
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    const speed = parseFloat(speedInput.value);
    rotation += dt * speed;
    render();
    animId = requestAnimationFrame(tick);
  }

  function startRotation() {
    if (animId !== null) return;
    lastTs = 0;
    animId = requestAnimationFrame(tick);
  }

  function stopRotation() {
    if (animId !== null) cancelAnimationFrame(animId);
    animId = null;
  }

  function wireEvents() {
    rotateToggle.addEventListener('change', () => {
      if (rotateToggle.checked) startRotation();
      else stopRotation();
    });
    speedInput.addEventListener('input', () => {
      speedValue.textContent = parseFloat(speedInput.value).toFixed(2);
    });
    labelsToggle.addEventListener('change', render);

    let dragging = false;
    let lastX = 0;
    const onDown = (clientX) => { dragging = true; lastX = clientX; };
    const onMove = (clientX) => {
      if (!dragging) return;
      const dx = clientX - lastX;
      lastX = clientX;
      rotation += dx * 0.01;
      render();
    };
    const onUp = () => { dragging = false; };

    canvas.addEventListener('mousedown', (e) => onDown(e.clientX));
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches[0]) {
        onDown(e.touches[0].clientX);
        e.preventDefault();
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches[0]) {
        onMove(e.touches[0].clientX);
        e.preventDefault();
      }
    }, { passive: false });
    canvas.addEventListener('touchend', onUp);
  }

  document.addEventListener('langchange', () => {
    updateProperties();
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
    CH = Math.max(Math.round(rect.height), 300);
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.style.setProperty('width', CW + 'px', 'important');
    canvas.style.setProperty('height', CH + 'px', 'important');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    render();
  }

  buildList();
  highlightActive();
  updateProperties();
  speedValue.textContent = parseFloat(speedInput.value).toFixed(2);
  wireEvents();
  window.addEventListener('resize', resizeCanvas);
  // Pause the 3D rotation loop while the tab is hidden so the WebGL
  // context isn't redrawn from a background tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRotation();
    else if (rotateToggle.checked) startRotation();
  });
  resizeCanvas();
  startRotation();
})();
