/*
 * Molecule viewer — a real 3D ball-and-stick model.
 *
 * The coordinates below are genuine 3D geometries (tetrahedral methane,
 * 107° pyramidal ammonia, planar benzene…), so they are rendered by the
 * shared WebGL viewer in assets/gl3d.js rather than flattened into a 2D
 * projection: perspective, a depth buffer, lit spheres, and free orbit on
 * both axes. Bonds are split at the midpoint and take each end's atom
 * colour, the way molecular viewers conventionally draw them.
 */
(() => {
  const canvas = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
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
  let view = null;

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
    const info = ELEMENTS[el] || { color: '#888888', text: '#fff', radius: 0.5 };
    if (!rgbCache.has(info.color)) rgbCache.set(info.color, hexRGB(info.color));
    return { ...info, rgb: rgbCache.get(info.color) };
  }

  // Ball-and-stick proportions: balls well under their van der Waals size so
  // the bond framework — the point of the model — stays visible.
  const BALL = 0.42;
  const STICK = 0.10;

  // ── Vector helpers ─────────────────────────────────────────────────────
  const v3 = (a) => [a.x, a.y, a.z];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mulS = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const mid = (a, b) => mulS(add(a, b), 0.5);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function unit(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  /**
   * Offset direction for the extra lines of a multiple bond.
   *
   * A double bond's two lines have to be drawn in a chemically sensible
   * plane, so we look for a neighbouring atom and take the component of
   * that direction perpendicular to the bond — which puts the pair in the
   * local molecular plane (the C=C of ethylene, the C=O of a carbonyl).
   * With no neighbour to go on, any perpendicular will do.
   */
  function offsetDir(mol, i, j) {
    const a = v3(mol.atoms[i]), b = v3(mol.atoms[j]);
    const axis = unit(sub(b, a));
    for (const [p, q] of mol.bonds) {
      const other = (p === i && q !== j) ? q : (q === i && p !== j) ? p
                  : (p === j && q !== i) ? q : (q === j && p !== i) ? p : -1;
      if (other < 0) continue;
      const ref = sub(v3(mol.atoms[other]), a);
      const perp = sub(ref, mulS(axis, dot(ref, axis)));
      if (Math.hypot(perp[0], perp[1], perp[2]) > 1e-3) return unit(perp);
    }
    const seed = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    return unit(cross(axis, seed));
  }

  function centroid(mol) {
    const c = mol.atoms.reduce((s, a) => add(s, v3(a)), [0, 0, 0]);
    return mulS(c, 1 / Math.max(mol.atoms.length, 1));
  }

  // ── Scene construction ─────────────────────────────────────────────────
  function buildScene() {
    const mol = MOLECULES[currentKey];
    const cen = centroid(mol);
    const spheres = [];
    const cylinders = [];

    for (const atom of mol.atoms) {
      const info = elementInfo(atom.el);
      spheres.push({ p: sub(v3(atom), cen), r: info.radius * BALL, color: info.rgb });
    }

    // Each bond is drawn as two half-cylinders so it takes the colour of the
    // atom at each end.
    const halfBond = (a, b, ca, cb, r) => {
      const m = mid(a, b);
      cylinders.push({ a, b: m, r, color: ca });
      cylinders.push({ a: m, b, r, color: cb });
    };

    for (const [i, j, order] of mol.bonds) {
      const a = sub(v3(mol.atoms[i]), cen);
      const b = sub(v3(mol.atoms[j]), cen);
      const ca = elementInfo(mol.atoms[i].el).rgb;
      const cb = elementInfo(mol.atoms[j].el).rgb;

      if (order === 1) {
        halfBond(a, b, ca, cb, STICK);
      } else if (order === 2 || order === 3) {
        const d = offsetDir(mol, i, j);
        const gap = STICK * (order === 2 ? 1.5 : 2.0);
        const r = STICK * (order === 3 ? 0.62 : 0.72);
        const offs = order === 2 ? [-gap, gap] : [-gap, 0, gap];
        for (const o of offs) {
          halfBond(add(a, mulS(d, o)), add(b, mulS(d, o)), ca, cb, r);
        }
      } else if (order === 1.5) {
        // Aromatic: the full sigma bond plus a thinner partial line offset
        // toward the ring centre, the standard way of drawing delocalised
        // benzene bonds.
        halfBond(a, b, ca, cb, STICK);
        const inward = unit(sub(mulS(add(a, b), -0.5), [0, 0, 0]));
        const axis = unit(sub(b, a));
        let d = sub(inward, mulS(axis, dot(inward, axis)));
        if (Math.hypot(d[0], d[1], d[2]) < 1e-3) d = offsetDir(mol, i, j);
        else d = unit(d);
        const o = mulS(d, STICK * 2.0);
        halfBond(add(a, o), add(b, o), ca, cb, STICK * 0.5);
      }
    }
    return { spheres, cylinders, radius: sceneRadius(spheres) };
  }

  function sceneRadius(spheres) {
    let m = 1;
    for (const s of spheres) m = Math.max(m, Math.hypot(s.p[0], s.p[1], s.p[2]) + s.r);
    return m;
  }

  // ── Element-symbol labels on the 2D overlay ────────────────────────────
  // Labels are placed by projecting each atom centre. An atom hidden behind
  // a nearer one would otherwise show its symbol floating on top, so we walk
  // near-to-far and skip any label whose anchor falls inside an already
  // placed (nearer) atom's disc.
  function drawLabels(ctx2d, project, v) {
    if (!labelsToggle.checked) return;
    const mol = MOLECULES[currentKey];
    const focal = (v.H / 2) / Math.tan((v.fov * Math.PI) / 360);
    const items = [];
    for (let i = 0; i < view.spheres.length; i++) {
      const s = view.spheres[i];
      const pr = project(s.p);
      if (!pr.visible) continue;
      items.push({ x: pr.x, y: pr.y, w: pr.w, rad: (s.r * focal) / pr.w, el: mol.atoms[i].el });
    }
    items.sort((a, b) => a.w - b.w);
    const placed = [];
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    for (const it of items) {
      if (placed.some((p) => Math.hypot(p.x - it.x, p.y - it.y) < p.rad * 0.92)) continue;
      placed.push(it);
      if (it.rad < 7) continue;
      const info = elementInfo(it.el);
      ctx2d.font = `700 ${Math.max(10, Math.min(20, it.rad * 0.95))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx2d.fillStyle = info.text;
      ctx2d.fillText(it.el, it.x, it.y);
    }
  }

  // ── UI ─────────────────────────────────────────────────────────────────
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

  function applyScene() {
    if (!view) return;
    const scene = buildScene();
    view.setScene(scene);
    view.fit(scene.radius);
    view.setZoomRange(scene.radius * 0.8, scene.radius * 9);
  }

  function selectMolecule(key) {
    if (!MOLECULES[key]) return;
    currentKey = key;
    highlightActive();
    updateProperties();
    applyScene();
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
    speedInput.addEventListener('input', () => {
      const s = parseFloat(speedInput.value);
      speedValue.textContent = s.toFixed(2);
      if (view) view.speed = s;
    });
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
    const scene = buildScene();
    view.fit(scene.radius);
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  buildList();
  highlightActive();
  updateProperties();
  speedValue.textContent = parseFloat(speedInput.value).toFixed(2);
  wireEvents();

  view = window.GL3D && window.GL3D.create({
    canvas,
    overlay,
    height: 500,
    minWidth: 260,
    background: [0.039, 0.055, 0.125],
    fov: 40,
    pitch: 0.28,
  });

  if (!view) {
    showFallback();
  } else {
    view.speed = parseFloat(speedInput.value);
    view.autoRotate = rotateToggle.checked;
    view.onOverlay = drawLabels;
    applyScene();
    view.start();
  }
})();
