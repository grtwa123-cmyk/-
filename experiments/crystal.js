/*
 * Crystal lattice — a real 3D model of the unit cell.
 *
 * Lattice sites are defined in fractional cell coordinates and rendered by
 * the shared WebGL viewer in assets/gl3d.js: lit spheres with a true depth
 * buffer, the unit cell drawn as real edge geometry, and free orbit on both
 * axes so the coordination around any site can actually be inspected.
 */
(() => {
  const canvas = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
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


  // CPK-ish colors + sizes (fractional radius relative to a cell edge of 1).
  // Smaller than realistic radii so the lattice geometry stays visible.
  const ELEMENTS = {
    A:  { color: '#6ea8ff', text: '#0b1024', radius: 0.14 }, // generic metal
    C:  { color: '#8391bb', text: '#0b1024', radius: 0.10 },
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

  // ── Colour helpers ─────────────────────────────────────────────────────
  const hexRGB = (hex) => {
    const h = hex.replace('#', '');
    return new Float32Array([
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ]);
  };
  const rgbCache = new Map();
  function elementInfo(el) {
    const info = ELEMENTS[el] || { color: '#888888', text: '#ffffff', radius: 0.14 };
    if (!rgbCache.has(info.color)) rgbCache.set(info.color, hexRGB(info.color));
    return { ...info, rgb: rgbCache.get(info.color) };
  }

  const EDGE_COLOR = new Float32Array([0.42, 0.55, 0.78]);
  const EDGE_R = 0.008;

  // ── Scene construction ─────────────────────────────────────────────────
  // The lattice is built in cell units (one cube edge = 1 world unit) and
  // centred on the origin, so the camera framing is independent of which
  // structure or expansion is showing.
  function buildScene() {
    const lat = LATTICES[currentKey];
    const atoms = expandAtoms(lat.atoms);
    const span = expandToggle.checked ? 2 : 1;
    const half = span / 2;
    const shift = (a) => [a.x - half, a.y - half, a.z - half];

    const spheres = atoms.map((a) => {
      const info = elementInfo(a.el);
      return { p: shift(a), r: info.radius, color: info.rgb, el: a.el };
    });

    // Unit-cell wireframe: the 12 edges of every cube in the expansion,
    // drawn as thin cylinders so they light and occlude like real geometry.
    const cylinders = [];
    if (cellToggle.checked) {
      const reps = expandToggle.checked ? 2 : 1;
      for (let ox = 0; ox < reps; ox++)
        for (let oy = 0; oy < reps; oy++)
          for (let oz = 0; oz < reps; oz++) {
            const c = (x, y, z) => [x + ox - half, y + oy - half, z + oz - half];
            for (let axis = 0; axis < 3; axis++) {
              for (let u = 0; u <= 1; u++) {
                for (let v = 0; v <= 1; v++) {
                  let a, b;
                  if (axis === 0) { a = c(0, u, v); b = c(1, u, v); }
                  else if (axis === 1) { a = c(u, 0, v); b = c(u, 1, v); }
                  else { a = c(u, v, 0); b = c(u, v, 1); }
                  cylinders.push({ a, b, r: EDGE_R, color: EDGE_COLOR });
                }
              }
            }
          }
    }

    // Radius that comfortably contains the cube corners plus atom radii.
    const radius = Math.sqrt(3) * half + 0.2;
    return { spheres, cylinders, radius };
  }

  // ── Labels on the 2D overlay ───────────────────────────────────────────
  // Only the ionic lattices carry more than one species, so labels matter
  // most there; we still walk near-to-far and drop any symbol that would
  // float on top of a nearer atom.
  function drawLabels(ctx2d, project, v) {
    if (!labelsToggle.checked) return;
    const focal = (v.H / 2) / Math.tan((v.fov * Math.PI) / 360);
    const items = [];
    for (const s of view.spheres) {
      const pr = project(s.p);
      if (!pr.visible) continue;
      items.push({ x: pr.x, y: pr.y, w: pr.w, rad: (s.r * focal) / pr.w, el: s.el });
    }
    items.sort((a, b) => a.w - b.w);
    const placed = [];
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    for (const it of items) {
      if (placed.some((p) => Math.hypot(p.x - it.x, p.y - it.y) < p.rad * 0.9)) continue;
      placed.push(it);
      if (it.rad < 9) continue;
      const info = elementInfo(it.el);
      ctx2d.font = `700 ${Math.max(9, Math.min(16, it.rad * 0.8))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx2d.fillStyle = info.text;
      ctx2d.fillText(it.el, it.x, it.y);
    }
  }

  // ── UI ─────────────────────────────────────────────────────────────────
  function updateProperties() {
    const lat = LATTICES[currentKey];
    prop.atoms.textContent = lat.atomsPerCell;
    prop.coord.textContent = lat.coord;
    prop.apf.textContent = lat.apf;
    prop.examples.textContent = lat.examples;
    patternBody.textContent = i18nText(lat.patternKey, '');
  }

  function highlightActive() {
    listEl.querySelectorAll('.mol-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.key === currentKey);
    });
  }

  function applyScene() {
    if (!view) return;
    const scene = buildScene();
    view.setScene(scene);
    view.fit(scene.radius);
    view.setZoomRange(scene.radius * 0.5, scene.radius * 9);
  }

  function selectLattice(key) {
    if (!LATTICES[key]) return;
    currentKey = key;
    highlightActive();
    updateProperties();
    applyScene();
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
      btn.addEventListener('click', () => {
        window.SFX?.tone({ freq: 560, dur: 0.07, type: 'triangle', gain: 0.1 });
        selectLattice(key);
      });
      listEl.appendChild(btn);
    }
  }

  // ── Fallback when WebGL is unavailable ─────────────────────────────────
  function showFallback() {
    const host = canvas.parentElement;
    if (!host) return;
    const note = document.createElement('p');
    note.className = 'hint-3d';
    note.style.cssText = 'position:static;padding:2rem 1rem;text-align:center;text-transform:none;font-size:0.95rem;opacity:1';
    note.textContent = i18nText('webglUnavailable', 'This 3D model needs WebGL, which this browser has disabled.');
    note.setAttribute('data-i18n', 'webglUnavailable');
    canvas.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    host.appendChild(note);
  }

  function wireEvents() {
    rotateToggle.addEventListener('change', () => {
      if (view) view.autoRotate = rotateToggle.checked;
    });
    rotateSpeed.addEventListener('input', () => {
      const s = parseFloat(rotateSpeed.value);
      rotateSpeedValue.textContent = s.toFixed(2);
      if (view) view.speed = s;
    });
    cellToggle.addEventListener('change', applyScene);
    expandToggle.addEventListener('change', applyScene);
    labelsToggle.addEventListener('change', () => { if (view) view.draw(); });
  }

  document.addEventListener('langchange', () => {
    updateProperties();
    buildList();
    highlightActive();
  });

  window.addEventListener('resize', () => {
    if (!view) return;
    view.resize();
    view.fit(buildScene().radius);
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  let view = null;

  buildList();
  highlightActive();
  updateProperties();
  rotateSpeedValue.textContent = parseFloat(rotateSpeed.value).toFixed(2);
  wireEvents();

  view = window.GL3D && window.GL3D.create({
    canvas,
    overlay,
    height: 600,
    minWidth: 260,
    background: [0.035, 0.05, 0.115],
    fov: 40,
    yaw: -0.6,
    pitch: 0.42,
  });

  if (!view) {
    showFallback();
  } else {
    view.speed = parseFloat(rotateSpeed.value);
    view.autoRotate = rotateToggle.checked;
    view.onOverlay = drawLabels;
    applyScene();
    view.start();
  }
})();
