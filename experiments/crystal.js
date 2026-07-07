(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const listEl = document.getElementById('lattice-list');
  const rotateToggle = document.getElementById('rotate-toggle');
  const rotateSpeed = document.getElementById('rotate-speed');
  const rotateSpeedValue = document.getElementById('rotate-speed-value');
  const cellToggle = document.getElementById('cell-toggle');
  const expandToggle = document.getElementById('expand-toggle');
  const labelsToggle = document.getElementById('labels-toggle');
  const prop = {
    atoms: document.getElementById('prop-atoms'),
    coord: document.getElementById('prop-coord'),
    apf: document.getElementById('prop-apf'),
    examples: document.getElementById('prop-examples'),
  };
  const patternBody = document.getElementById('pattern-body');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  // CPK-ish colors + sizes (fractional radius relative to a cell edge of 1).
  // Smaller than realistic radii so the lattice geometry stays visible.
  const ELEMENTS = {
    A:  { color: '#6ea8ff', text: '#0b1024', radius: 0.14 }, // generic metal
    C:  { color: '#454d6d', text: '#e8ecf7', radius: 0.10 },
    Na: { color: '#ab5cf2', text: '#ffffff', radius: 0.13 },
    Cl: { color: '#5fe04f', text: '#0b1024', radius: 0.17 },
    Cs: { color: '#7d3eb3', text: '#ffffff', radius: 0.20 },
  };

  function cubeCorners(el) {
    const out = [];
    for (let x = 0; x <= 1; x++)
      for (let y = 0; y <= 1; y++)
        for (let z = 0; z <= 1; z++)
          out.push({ el, x, y, z });
    return out;
  }

  function faceCenters(el) {
    return [
      { el, x: 0.5, y: 0.5, z: 0 },
      { el, x: 0.5, y: 0.5, z: 1 },
      { el, x: 0.5, y: 0, z: 0.5 },
      { el, x: 0.5, y: 1, z: 0.5 },
      { el, x: 0, y: 0.5, z: 0.5 },
      { el, x: 1, y: 0.5, z: 0.5 },
    ];
  }

  // NaCl: alternating ions on a 3×3×3 grid at half-cell spacing — this is the
  // textbook drawing of the rock-salt unit cell with all boundary atoms shown.
  function naclAtoms() {
    const out = [];
    for (let i = 0; i <= 2; i++)
      for (let j = 0; j <= 2; j++)
        for (let k = 0; k <= 2; k++) {
          const el = (i + j + k) % 2 === 0 ? 'Na' : 'Cl';
          out.push({ el, x: i / 2, y: j / 2, z: k / 2 });
        }
    return out;
  }

  const LATTICES = {
    sc: {
      key: 'sc', nameKey: 'latticeSC',
      atomsPerCell: '1',
      coord: '6',
      apf: '0.524',
      examples: 'α-Po',
      patternKey: 'crystalPatternSC',
      atoms: cubeCorners('A'),
    },
    bcc: {
      key: 'bcc', nameKey: 'latticeBCC',
      atomsPerCell: '2',
      coord: '8',
      apf: '0.680',
      examples: 'α-Fe, W, Na, Cr',
      patternKey: 'crystalPatternBCC',
      atoms: [...cubeCorners('A'), { el: 'A', x: 0.5, y: 0.5, z: 0.5 }],
    },
    fcc: {
      key: 'fcc', nameKey: 'latticeFCC',
      atomsPerCell: '4',
      coord: '12',
      apf: '0.740',
      examples: 'Cu, Al, Au, Ag, Ni',
      patternKey: 'crystalPatternFCC',
      atoms: [...cubeCorners('A'), ...faceCenters('A')],
    },
    nacl: {
      key: 'nacl', nameKey: 'latticeNaCl',
      atomsPerCell: '8 (4 Na + 4 Cl)',
      coord: '6 : 6',
      apf: '0.793',
      examples: 'NaCl, KCl, MgO',
      patternKey: 'crystalPatternNaCl',
      atoms: naclAtoms(),
    },
    cscl: {
      key: 'cscl', nameKey: 'latticeCsCl',
      atomsPerCell: '2 (1 Cs + 1 Cl)',
      coord: '8 : 8',
      apf: '0.729',
      examples: 'CsCl, CsBr, NH₄Cl',
      patternKey: 'crystalPatternCsCl',
      atoms: [...cubeCorners('Cl'), { el: 'Cs', x: 0.5, y: 0.5, z: 0.5 }],
    },
    diamond: {
      key: 'diamond', nameKey: 'latticeDiamond',
      atomsPerCell: '8',
      coord: '4',
      apf: '0.340',
      examples: 'C (diamond), Si, Ge',
      patternKey: 'crystalPatternDiamond',
      atoms: [
        ...cubeCorners('C'),
        ...faceCenters('C'),
        { el: 'C', x: 0.25, y: 0.25, z: 0.25 },
        { el: 'C', x: 0.75, y: 0.75, z: 0.25 },
        { el: 'C', x: 0.75, y: 0.25, z: 0.75 },
        { el: 'C', x: 0.25, y: 0.75, z: 0.75 },
      ],
    },
  };

  const LATTICE_ORDER = ['sc', 'bcc', 'fcc', 'nacl', 'cscl', 'diamond'];

  // ---- View state ----
  let currentKey = 'sc';
  let rotY = -0.5; // azimuth
  let rotX = -0.4; // elevation
  let lastTs = 0;
  let animId = null;
  let CW = 800;
  let CH = 600;

  // ---- Atom expansion ----
  function expandAtoms(atoms) {
    if (!expandToggle.checked) return atoms;
    const out = [];
    for (let dx = 0; dx <= 1; dx++)
      for (let dy = 0; dy <= 1; dy++)
        for (let dz = 0; dz <= 1; dz++) {
          for (const a of atoms) {
            // Skip boundary duplicates from the +dx/+dy/+dz direction
            // already provided by the next translated copy.
            if (dx === 1 && a.x === 0) continue;
            if (dy === 1 && a.y === 0) continue;
            if (dz === 1 && a.z === 0) continue;
            out.push({ el: a.el, x: a.x + dx, y: a.y + dy, z: a.z + dz });
          }
        }
    return out;
  }

  // ---- 3D projection ----
  function project(p, cellSize, cellSpan) {
    // Center the lattice on origin
    const half = cellSpan / 2;
    const x0 = (p.x - half) * cellSize;
    const y0 = (p.y - half) * cellSize;
    const z0 = (p.z - half) * cellSize;
    // Rotate around Y, then X.
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const x1 = x0 * cosY + z0 * sinY;
    const z1 = -x0 * sinY + z0 * cosY;
    const y1 = y0;
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    const y2 = y1 * cosX - z1 * sinX;
    const z2 = y1 * sinX + z1 * cosX;
    return { x: x1, y: y2, z: z2 };
  }

  function elementInfo(el) {
    return ELEMENTS[el] || { color: '#9aa0b8', text: '#0b1024', radius: 0.2 };
  }

  function drawCellEdges(cellSize, cellSpan, depthScale) {
    if (!cellToggle.checked) return;
    const corners = [];
    const repeats = expandToggle.checked ? 2 : 1;
    for (let ix = 0; ix <= repeats; ix++)
      for (let iy = 0; iy <= repeats; iy++)
        for (let iz = 0; iz <= repeats; iz++) {
          corners.push({ x: ix, y: iy, z: iz });
        }
    // Build edge list as pairs of corner indices.
    const idx = (x, y, z) => (x * (repeats + 1) + y) * (repeats + 1) + z;
    const edges = [];
    for (let ix = 0; ix <= repeats; ix++)
      for (let iy = 0; iy <= repeats; iy++)
        for (let iz = 0; iz < repeats; iz++)
          edges.push([idx(ix, iy, iz), idx(ix, iy, iz + 1)]);
    for (let ix = 0; ix <= repeats; ix++)
      for (let iz = 0; iz <= repeats; iz++)
        for (let iy = 0; iy < repeats; iy++)
          edges.push([idx(ix, iy, iz), idx(ix, iy + 1, iz)]);
    for (let iy = 0; iy <= repeats; iy++)
      for (let iz = 0; iz <= repeats; iz++)
        for (let ix = 0; ix < repeats; ix++)
          edges.push([idx(ix, iy, iz), idx(ix + 1, iy, iz)]);

    const projected = corners.map((p) => projectToCanvas(p, cellSize, cellSpan));

    ctx.save();
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.32)';
    ctx.lineWidth = 1.2;
    for (const [a, b] of edges) {
      const za = projected[a].z;
      const zb = projected[b].z;
      const fade = 0.45 + 0.55 * depthScale((za + zb) / 2);
      ctx.globalAlpha = Math.min(1, fade);
      ctx.beginPath();
      ctx.moveTo(projected[a].cx, projected[a].cy);
      ctx.lineTo(projected[b].cx, projected[b].cy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function projectToCanvas(p, cellSize, cellSpan) {
    const proj = project(p, cellSize, cellSpan);
    return {
      cx: CW / 2 + proj.x,
      cy: CH / 2 - proj.y,
      z: proj.z,
    };
  }

  function drawAtom(canvasAtom, cellSize, depthScale, showLabel) {
    const f = depthScale(canvasAtom.z);
    const info = elementInfo(canvasAtom.el);
    const r = Math.max(7, info.radius * cellSize * f);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = info.color;
    ctx.beginPath();
    ctx.arc(canvasAtom.cx, canvasAtom.cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Highlight sheen for a 3D look
    const grad = ctx.createRadialGradient(
      canvasAtom.cx - r * 0.35, canvasAtom.cy - r * 0.35, r * 0.1,
      canvasAtom.cx, canvasAtom.cy, r
    );
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(canvasAtom.cx, canvasAtom.cy, r, 0, Math.PI * 2);
    ctx.fill();

    if (showLabel && r >= 10) {
      ctx.fillStyle = info.text;
      ctx.font = `${Math.max(10, Math.floor(r * 0.9))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(canvasAtom.el, canvasAtom.cx, canvasAtom.cy);
    }
    ctx.restore();
  }

  function render() {
    const lattice = LATTICES[currentKey];
    ctx.clearRect(0, 0, CW, CH);

    const atoms = expandAtoms(lattice.atoms);
    const cellSpan = expandToggle.checked ? 2 : 1;

    // Pick a cell size so the projected lattice fits comfortably across
    // every rotation. Worst-case extent is the body diagonal, √3 × side.
    const margin = 70;
    const fitSize = Math.min(CW - margin * 2, CH - margin * 2);
    const cellSize = fitSize / (cellSpan * 1.8);

    const projected = atoms.map((a) => projectToCanvas(a, cellSize, cellSpan));
    const minZ = Math.min(...projected.map((p) => p.z));
    const maxZ = Math.max(...projected.map((p) => p.z));
    const zRange = Math.max(maxZ - minZ, 0.0001);
    const depthScale = (z) => {
      const t = (z - minZ) / zRange;
      return 0.6 + 0.45 * t;
    };

    drawCellEdges(cellSize, cellSpan, depthScale);

    const items = projected.map((p, i) => ({ ...p, el: atoms[i].el }));
    items.sort((a, b) => a.z - b.z);
    const showLabels = labelsToggle.checked;
    for (const it of items) drawAtom(it, cellSize, depthScale, showLabels);
  }

  function updateProperties() {
    const lattice = LATTICES[currentKey];
    prop.atoms.textContent = lattice.atomsPerCell;
    prop.coord.textContent = lattice.coord;
    prop.apf.textContent = lattice.apf;
    prop.examples.textContent = lattice.examples;
    patternBody.textContent = i18nText(lattice.patternKey, '');
  }

  function highlightActive() {
    listEl.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.key === currentKey);
    });
  }

  function selectLattice(key) {
    if (!LATTICES[key]) return;
    currentKey = key;
    highlightActive();
    updateProperties();
    render();
  }

  function buildList() {
    listEl.innerHTML = '';
    for (const key of LATTICE_ORDER) {
      const lattice = LATTICES[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mol-btn';
      btn.dataset.key = key;
      const label = document.createElement('span');
      label.dataset.i18n = lattice.nameKey;
      label.textContent = i18nText(lattice.nameKey, key);
      btn.appendChild(label);
      btn.addEventListener('click', () => selectLattice(key));
      listEl.appendChild(btn);
    }
  }

  function tick(ts) {
    if (!rotateToggle.checked) {
      animId = null;
      return;
    }
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    const speed = parseFloat(rotateSpeed.value);
    rotY += dt * speed;
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
    rotateSpeed.addEventListener('input', () => {
      rotateSpeedValue.textContent = parseFloat(rotateSpeed.value).toFixed(2);
    });
    cellToggle.addEventListener('change', render);
    expandToggle.addEventListener('change', render);
    labelsToggle.addEventListener('change', render);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (cx, cy) => { dragging = true; lastX = cx; lastY = cy; };
    const onMove = (cx, cy) => {
      if (!dragging) return;
      const dx = cx - lastX;
      const dy = cy - lastY;
      lastX = cx; lastY = cy;
      rotY += dx * 0.01;
      rotX += dy * 0.01;
      if (rotX > Math.PI / 2) rotX = Math.PI / 2;
      if (rotX < -Math.PI / 2) rotX = -Math.PI / 2;
      render();
    };
    const onUp = () => { dragging = false; };

    canvas.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches[0]) {
        onDown(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches[0]) {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
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
    CW = Math.max(Math.round(rect.width), 320);
    CH = 560;
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
  rotateSpeedValue.textContent = parseFloat(rotateSpeed.value).toFixed(2);
  wireEvents();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRotation();
    else if (rotateToggle.checked) startRotation();
  });
  resizeCanvas();
  startRotation();
})();
