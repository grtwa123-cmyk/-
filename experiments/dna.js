/*
 * DNA Double Helix Studio — a real 3D B-form model.
 *
 * The duplex is built from the actual B-DNA parameters rather than screen
 * units, and rendered by the shared WebGL viewer in assets/gl3d.js:
 *
 *   rise            3.4 Å per base pair along the helix axis
 *   backbone radius 10 Å
 *   twist           360° / 10.5 bp  ≈ 34.3° per base pair (right-handed)
 *   strand offset   120°, measured across the minor groove
 *
 * That last number is what makes the grooves real. Placing the second
 * strand exactly 180° away — as this sim used to — puts the base pairs on
 * diameters and leaves two identical channels, so there is no major or
 * minor groove at all. Offsetting the strands by 120° makes each base pair
 * a chord and opens one channel to 240° (major groove) while the other
 * closes to 120° (minor groove), which is the asymmetry you can see in the
 * model as it turns.
 *
 * Hydrogen bonds are tallied per pair: A·T → 2 rungs, G·C → 3, which is the
 * only physically meaningful asymmetry between the pair types and is what
 * governs the melting-temperature formulas below.
 */

(() => {
  const stage = document.getElementById("stage");
  const overlay = document.getElementById("overlay");

  // ── B-form geometry, in ångströms ──────────────────────────────────────
  const RISE   = 3.4;
  const RADIUS = 10.0;
  const OMEGA  = (2 * Math.PI) / 10.5;        // twist per base pair
  const MINOR_OFFSET = (120 * Math.PI) / 180; // strand B lead across the minor groove

  // ── Base palette + chemistry ───────────────────────────────────────────
  // Distinct hues for A / T / G / C, picked for accessibility on the dark
  // backdrop.
  const COLORS = {
    A: "#ff8aa3", // adenine — salmon
    T: "#ffcf6e", // thymine — amber
    G: "#7be0d0", // guanine — aqua
    C: "#c79bff", // cytosine — violet
  };
  const COMPLEMENT = { A: "T", T: "A", G: "C", C: "G" };

  const BACKBONE_A = "#8fb0e8";
  const BACKBONE_B = "#e8b08f";
  const HBOND = "#dfe6f5";

  const inputs = {
    seq:    document.getElementById("seq"),
    length: document.getElementById("length"),
    spin:   document.getElementById("spin"),
  };
  const inputValues = {
    length: document.getElementById("length-value"),
    spin:   document.getElementById("spin-value"),
  };
  const out = {
    length:  document.getElementById("out-length"),
    gc:      document.getElementById("out-gc"),
    at:      document.getElementById("out-at"),
    gcpairs: document.getElementById("out-gcpairs"),
    tm:      document.getElementById("out-tm"),
    turns:   document.getElementById("out-turns"),
    comp:    document.getElementById("out-comp"),
    mrna:    document.getElementById("out-mrna"),
  };
  const randomBtn = document.getElementById("random-btn");
  const pauseBtn  = document.getElementById("pause-btn");
  const resetBtn  = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const DEFAULT_SEQ = "ATGGCATCTGAACGTTAACGT";
  let seq = sanitize(inputs.seq.value || DEFAULT_SEQ);
  let paused = false;
  let view = null;

  // ── Helpers ────────────────────────────────────────────────────────────
  function sanitize(s) {
    return (s || "")
      .toUpperCase()
      .replace(/[^ACGT]/g, "")
      .slice(0, 30);
  }

  function randomSeq(n) {
    const letters = "ACGT";
    let out = "";
    // Deterministic-ish — biased toward 50% GC so visuals stay rich.
    for (let i = 0; i < n; i++) out += letters[Math.floor(Math.random() * 4)];
    return out;
  }

  function complementOf(s) {
    let r = "";
    for (let i = 0; i < s.length; i++) r += COMPLEMENT[s[i]] || "?";
    return r;
  }

  function mRNAOf(s) {
    // Coding-strand convention: mRNA == coding strand with T → U.
    return s.replace(/T/g, "U");
  }

  function meltingTm(s) {
    const N = s.length;
    if (!N) return 0;
    let a = 0, t = 0, g = 0, c = 0;
    for (let i = 0; i < N; i++) {
      const b = s[i];
      if (b === "A") a++; else if (b === "T") t++; else if (b === "G") g++; else if (b === "C") c++;
    }
    if (N <= 14) return 2 * (a + t) + 4 * (g + c);
    return 64.9 + (41 * (g + c - 16.4)) / N;
  }

  // ── Colour helpers ─────────────────────────────────────────────────────
  const hexRGB = (hex) => {
    const h = hex.replace("#", "");
    return new Float32Array([
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ]);
  };
  const rgbCache = new Map();
  const rgb = (hex) => {
    if (!rgbCache.has(hex)) rgbCache.set(hex, hexRGB(hex));
    return rgbCache.get(hex);
  };

  // ── Vector helpers ─────────────────────────────────────────────────────
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mulS = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // Backbone point for base i on either strand, centred on the origin.
  function strandPoint(i, strand, n) {
    const theta = OMEGA * i + (strand === "B" ? MINOR_OFFSET : 0);
    const y = (i - (n - 1) / 2) * RISE;
    return [RADIUS * Math.cos(theta), y, RADIUS * Math.sin(theta)];
  }

  // ── Scene construction ─────────────────────────────────────────────────
  const BACKBONE_R = 1.5;
  const STRUT_R = 0.9;
  const HBOND_R = 0.35;

  function buildScene() {
    const n = seq.length;
    const spheres = [];
    const cylinders = [];
    const labels = [];
    if (!n) return { spheres, cylinders, labels, radius: RADIUS * 1.4 };

    const cA = rgb(BACKBONE_A);
    const cB = rgb(BACKBONE_B);
    const cH = rgb(HBOND);

    for (let i = 0; i < n; i++) {
      const pA = strandPoint(i, "A", n);
      const pB = strandPoint(i, "B", n);
      const baseA = seq[i];
      const baseB = COMPLEMENT[baseA] || "?";

      // Sugar–phosphate backbone: a bead at every residue, joined into a
      // continuous ribbon by struts to the next residue on the same strand.
      spheres.push({ p: pA, r: BACKBONE_R, color: cA });
      spheres.push({ p: pB, r: BACKBONE_R, color: cB });
      if (i < n - 1) {
        cylinders.push({ a: pA, b: strandPoint(i + 1, "A", n), r: BACKBONE_R * 0.62, color: cA });
        cylinders.push({ a: pB, b: strandPoint(i + 1, "B", n), r: BACKBONE_R * 0.62, color: cB });
      }

      // Each base reaches in from its own backbone; the gap between them is
      // spanned by the hydrogen bonds.
      const mA = lerp(pA, pB, 0.36);
      const mB = lerp(pB, pA, 0.36);
      const colA = rgb(COLORS[baseA] || "#8899aa");
      const colB = rgb(COLORS[baseB] || "#8899aa");
      cylinders.push({ a: pA, b: mA, r: STRUT_R, color: colA });
      cylinders.push({ a: pB, b: mB, r: STRUT_R, color: colB });

      // 2 hydrogen bonds for A·T, 3 for G·C — stacked along the helix axis
      // so you can count them directly off the model.
      const nH = (baseA === "G" || baseA === "C") ? 3 : 2;
      const offs = nH === 3 ? [-0.75, 0, 0.75] : [-0.55, 0.55];
      for (const o of offs) {
        const shift = [0, o, 0];
        cylinders.push({ a: add(mA, shift), b: add(mB, shift), r: HBOND_R, color: cH });
      }

      labels.push({ p: lerp(pA, mA, 0.55), text: baseA, color: COLORS[baseA] || "#fff" });
      labels.push({ p: lerp(pB, mB, 0.55), text: baseB, color: COLORS[baseB] || "#fff" });
    }

    // End markers. The strands are antiparallel: A runs 5'→3' as i grows,
    // B runs 3'→5'.
    const top = (n - 1) / 2 * RISE;
    labels.push({ p: add(strandPoint(0, "A", n), [0, -2.6, 0]), text: "5'", color: BACKBONE_A, end: true });
    labels.push({ p: add(strandPoint(n - 1, "A", n), [0, 2.6, 0]), text: "3'", color: BACKBONE_A, end: true });
    labels.push({ p: add(strandPoint(0, "B", n), [0, -2.6, 0]), text: "3'", color: BACKBONE_B, end: true });
    labels.push({ p: add(strandPoint(n - 1, "B", n), [0, 2.6, 0]), text: "5'", color: BACKBONE_B, end: true });

    const radius = Math.hypot(RADIUS, top + 3);
    return { spheres, cylinders, labels, radius };
  }

  let sceneLabels = [];

  // ── Labels on the 2D overlay ───────────────────────────────────────────
  function drawLabels(ctx2d, project, v) {
    const focal = (v.H / 2) / Math.tan((v.fov * Math.PI) / 360);
    const items = [];
    for (const l of sceneLabels) {
      const pr = project(l.p);
      if (!pr.visible) continue;
      // Scale text with perspective, using the backbone bead as the yardstick.
      const size = (BACKBONE_R * focal) / pr.w;
      items.push({ ...l, x: pr.x, y: pr.y, w: pr.w, size });
    }
    items.sort((a, b) => a.w - b.w);
    const placed = [];
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    for (const it of items) {
      const px = Math.max(8, Math.min(17, it.size * (it.end ? 1.1 : 1.35)));
      if (px < 8.5) continue;
      // Skip anything a nearer label already covers, so back-facing bases
      // don't print through the front of the helix.
      if (placed.some((p) => Math.hypot(p.x - it.x, p.y - it.y) < px * 0.85)) continue;
      placed.push(it);
      ctx2d.font = `700 ${px}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx2d.fillStyle = it.end ? it.color : "rgba(12, 14, 26, 0.92)";
      if (!it.end) {
        ctx2d.strokeStyle = it.color;
        ctx2d.lineWidth = Math.max(2.6, px * 0.42);
        ctx2d.lineJoin = "round";
        ctx2d.strokeText(it.text, it.x, it.y);
      }
      ctx2d.fillText(it.text, it.x, it.y);
    }
  }

  // ── Sync derived UI ────────────────────────────────────────────────────
  function syncReadouts() {
    const N = seq.length;
    let gc = 0, at = 0;
    for (let i = 0; i < N; i++) {
      const b = seq[i];
      if (b === "G" || b === "C") gc++;
      else if (b === "A" || b === "T") at++;
    }
    out.length.textContent  = String(N);
    out.gc.textContent      = N ? ((100 * gc) / N).toFixed(1) : "0.0";
    out.at.textContent      = String(at);
    out.gcpairs.textContent = String(gc);
    out.tm.textContent      = Math.round(meltingTm(seq));
    out.turns.textContent   = (N / 10.5).toFixed(1);
    out.comp.textContent    = complementOf(seq) || "—";
    out.mrna.textContent    = mRNAOf(seq) || "—";
    applyScene();
  }

  function syncLabels() {
    inputValues.length.textContent = inputs.length.value;
    inputValues.spin.textContent   = inputs.spin.value;
    if (view) view.speed = (parseFloat(inputs.spin.value) * Math.PI) / 180;
  }

  function applyScene() {
    if (!view) return;
    const scene = buildScene();
    sceneLabels = scene.labels;
    view.setScene(scene);
    view.fit(scene.radius, 1.12);
    view.setZoomRange(scene.radius * 0.35, scene.radius * 6);
  }

  // ── Fallback when WebGL is unavailable ─────────────────────────────────
  function showFallback() {
    const host = stage.parentElement;
    if (!host) return;
    const note = document.createElement("p");
    note.className = "hint-3d";
    note.style.cssText = "position:static;padding:2rem 1rem;text-align:center;text-transform:none;font-size:0.95rem;opacity:1";
    note.textContent = i18nText("webglUnavailable", "This 3D model needs WebGL, which this browser has disabled.");
    note.setAttribute("data-i18n", "webglUnavailable");
    stage.style.display = "none";
    if (overlay) overlay.style.display = "none";
    host.appendChild(note);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  // Each base has its own note, so typing a sequence plays a little melody.
  const BASE_NOTE = { A: 440, T: 349.23, G: 523.25, C: 392 };
  inputs.seq.addEventListener("input", () => {
    const prevLen = seq.length;
    seq = sanitize(inputs.seq.value);
    inputs.seq.value = seq;       // mirror cleaned text back to the field
    if (seq.length > prevLen) {
      window.SFX?.tone({ freq: BASE_NOTE[seq[seq.length - 1]] || 440, dur: 0.09, type: "sine", gain: 0.12 });
    }
    inputs.length.value = String(Math.max(8, Math.min(30, seq.length || 8)));
    syncLabels();
    syncReadouts();
  });
  inputs.length.addEventListener("input", syncLabels);
  inputs.spin.addEventListener("input", syncLabels);

  randomBtn.addEventListener("click", () => {
    const n = parseInt(inputs.length.value, 10);
    seq = randomSeq(n);
    inputs.seq.value = seq;
    window.SFX?.sweep({ from: 320, to: 720, dur: 0.22, type: "sine", gain: 0.1 });
    syncLabels();
    syncReadouts();
  });

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    window.SFX?.tone({ freq: paused ? 300 : 420, dur: 0.08, type: "sine", gain: 0.12 });
    if (view) view.autoRotate = !paused;
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
  });

  resetBtn.addEventListener("click", () => {
    seq = DEFAULT_SEQ;
    inputs.seq.value = seq;
    inputs.length.value = "21";
    inputs.spin.value = "18";
    paused = false;
    if (view) { view.autoRotate = true; view.yaw = 0.5; view.pitch = 0.12; }
    pauseBtn.textContent = i18nText("wavePauseBtn", "Pause");
    syncLabels();
    syncReadouts();
  });

  document.addEventListener("langchange", () => {
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
  });

  window.addEventListener("resize", () => {
    if (!view) return;
    view.resize();
    view.fit(buildScene().radius, 1.12);
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  view = window.GL3D && window.GL3D.create({
    canvas: stage,
    overlay,
    height: 520,
    minWidth: 260,
    background: [0.055, 0.03, 0.10],
    fov: 40,
    yaw: 0.5,
    pitch: 0.12,
  });

  if (!view) {
    showFallback();
    syncLabels();
    syncReadouts();
  } else {
    view.onOverlay = drawLabels;
    // Honour prefers-reduced-motion: start held still rather than spinning,
    // and show that in the button so the reader can start it themselves.
    paused = window.GL3D.prefersReducedMotion();
    view.autoRotate = !paused;
    if (paused) pauseBtn.textContent = i18nText("waveResumeBtn", "Resume");
    syncLabels();
    syncReadouts();
    view.start();
  }
})();
