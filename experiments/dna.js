/*
 * DNA Double Helix Studio.
 *
 * A 5'→3' input strand drives a parametric B-form double helix:
 *   strand A — bases at angle θ_i = ω·i + φ
 *   strand B — bases at angle θ_i + π (antiparallel, offset 180° around the
 *              helix axis so the major / minor groove geometry reads cleanly)
 *
 * Each base is a 3D point P(i, strand) = (R·cosθ, y₀ + i·rise, R·sinθ); a
 * one-point perspective project lands it on screen at
 *   s = focal / (focal − z)
 *   (sx, sy) = (cx + x·s,  y)
 * so back-facing rungs shrink and dim, front-facing ones bloom. Backbone
 * segments, rungs, and base discs are batched into a single list, sorted by
 * z (back to front), and drawn in a single pass — no per-pixel work.
 *
 * Hydrogen bonds are tallied per pair: A·T → 2 ticks, G·C → 3 ticks, which
 * is also the only physically-meaningful asymmetry between the two pair
 * types and is what governs the melting-temperature formulas below.
 */

(() => {
  // ── Canvas ─────────────────────────────────────────────────────────────
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  // Sized by resizeCanvas(): logical (CSS-pixel) coordinates, with the
  // backing store scaled by devicePixelRatio for crisp discs on hiDPI.
  let W = stage.width;
  let H = stage.height;
  let CX = W / 2;

  // ── B-form geometry, screen units ──────────────────────────────────────
  // 10.5 bp/turn → 360 / 10.5 ≈ 34.286° per bp. Rise / radius tuned so a
  // 30-bp duplex (~3 turns) fills the canvas height vertically.
  const RISE   = 12;
  const RADIUS = 56;
  const OMEGA  = (2 * Math.PI) / 10.5;
  const FOCAL  = 360;

  // ── Base palette + chemistry ───────────────────────────────────────────
  // Distinct hues for A / T / G / C, picked for accessibility on the dark
  // backdrop. Disc letters render in near-black so the colour pops.
  const COLORS = {
    A: "#ff8aa3", // adenine — salmon
    T: "#ffcf6e", // thymine — amber
    G: "#7be0d0", // guanine — aqua
    C: "#c79bff", // cytosine — violet
  };
  const COMPLEMENT = { A: "T", T: "A", G: "C", C: "G" };
  const isPyrimidine = (b) => b === "T" || b === "C";

  // ── DOM refs ───────────────────────────────────────────────────────────
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

  // ── State ──────────────────────────────────────────────────────────────
  const DEFAULT_SEQ = "ATGGCATCTGAACGTTAACGT";
  let seq = sanitize(inputs.seq.value || DEFAULT_SEQ);
  let phi = 0;                  // current rotation around helix axis
  let lastTs = performance.now();
  let paused = false;
  let raf = 0;

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
  }

  function syncLabels() {
    inputValues.length.textContent = inputs.length.value;
    inputValues.spin.textContent   = inputs.spin.value;
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function background() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a0612");
    bg.addColorStop(1, "#13091e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Faint vertical guide along the helix axis — a printer's grid cue,
    // not a real coordinate axis, kept low contrast so the helix dominates.
    ctx.strokeStyle = "rgba(230, 200, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  function project(x, z) {
    const f = FOCAL / (FOCAL - z);
    return { sx: CX + x * f, scale: f };
  }

  function strandPoint(i, strand) {
    const baseTheta = OMEGA * i + phi;
    const theta = strand === "A" ? baseTheta : baseTheta + Math.PI;
    return {
      x: RADIUS * Math.cos(theta),
      z: RADIUS * Math.sin(theta),
      theta,
    };
  }

  function render() {
    background();

    const N = seq.length;
    if (!N) return;
    const totalH = (N - 1) * RISE;
    const yTop = (H - totalH) / 2;

    // Build paint list with z values for back-to-front sorting.
    const items = [];

    for (let i = 0; i < N; i++) {
      const A = strandPoint(i, "A");
      const B = strandPoint(i, "B");
      const pA = project(A.x, A.z);
      const pB = project(B.x, B.z);
      const y = yTop + i * RISE;
      const baseA = seq[i];
      const baseB = COMPLEMENT[baseA] || "?";

      // Backbone — link to previous bp on each strand
      if (i > 0) {
        const Ap = strandPoint(i - 1, "A");
        const Bp = strandPoint(i - 1, "B");
        const pAp = project(Ap.x, Ap.z);
        const pBp = project(Bp.x, Bp.z);
        const yPrev = yTop + (i - 1) * RISE;
        items.push({
          kind: "bb", z: (A.z + Ap.z) / 2,
          from: { sx: pAp.sx, sy: yPrev, sc: pAp.scale },
          to:   { sx: pA.sx,  sy: y,     sc: pA.scale  },
        });
        items.push({
          kind: "bb", z: (B.z + Bp.z) / 2,
          from: { sx: pBp.sx, sy: yPrev, sc: pBp.scale },
          to:   { sx: pB.sx,  sy: y,     sc: pB.scale  },
        });
      }

      // Rung — keep each base's own z so the disc pass can occlude
      // the farther one behind the nearer one.
      items.push({
        kind: "rung",
        z: (A.z + B.z) / 2,
        A: { sx: pA.sx, sy: y, sc: pA.scale, base: baseA, z: A.z },
        B: { sx: pB.sx, sy: y, sc: pB.scale, base: baseB, z: B.z },
      });
    }

    // Back to front. z is in [−R, +R]; bigger z = nearer the viewer.
    items.sort((a, b) => a.z - b.z);

    // Two passes: first rungs + backbones (under), then base discs (over).
    for (const it of items) {
      if (it.kind === "bb") drawBackbone(it);
      else if (it.kind === "rung") drawRung(it);
    }
    for (const it of items) {
      if (it.kind === "rung") {
        // Draw the farther base first so the nearer one paints over it.
        // A fixed A-then-B order put the BACK disc on top whenever the
        // rotation carried strand A in front — exactly at the edge-on
        // moments where the two discs overlap on screen.
        const aNear = it.A.z >= it.B.z;
        drawBaseDisc(aNear ? it.B : it.A);
        drawBaseDisc(aNear ? it.A : it.B);
      }
    }

    drawStrandLabels(yTop, totalH);
  }

  function depthAlpha(z) {
    // map z ∈ [−R, R] → α ∈ [0.32, 1]
    return 0.32 + 0.68 * (0.5 + z / (2 * RADIUS));
  }

  function drawBackbone(it) {
    const a = depthAlpha(it.z);
    ctx.strokeStyle = `rgba(220, 200, 255, ${a * 0.9})`;
    ctx.lineWidth = 2.2 + 1.8 * ((it.from.sc + it.to.sc) / 2 - 0.6);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(it.from.sx, it.from.sy);
    ctx.lineTo(it.to.sx, it.to.sy);
    ctx.stroke();
  }

  function drawRung(it) {
    const a = depthAlpha(it.z);
    const { A, B } = it;
    // Rung body — soft pearl line
    ctx.strokeStyle = `rgba(255, 248, 255, ${a * 0.35})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(A.sx, A.sy);
    ctx.lineTo(B.sx, B.sy);
    ctx.stroke();

    // Hydrogen bonds — perpendicular ticks. A·T → 2, G·C → 3.
    const ticks = (A.base === "A" || A.base === "T") ? 2 : 3;
    const dx = B.sx - A.sx, dy = B.sy - A.sy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const tickLen = 3.8 * Math.max(A.sc, B.sc);
    ctx.strokeStyle = `rgba(255, 255, 255, ${a * 0.85})`;
    ctx.lineWidth = 1.3;
    for (let k = 1; k <= ticks; k++) {
      const t = k / (ticks + 1);
      const cxk = A.sx + dx * t, cyk = A.sy + dy * t;
      ctx.beginPath();
      ctx.moveTo(cxk - nx * tickLen, cyk - ny * tickLen);
      ctx.lineTo(cxk + nx * tickLen, cyk + ny * tickLen);
      ctx.stroke();
    }
  }

  function drawBaseDisc(p) {
    const color = COLORS[p.base] || "#999";
    const r = 10 * p.sc;
    // Aura — wider, dim radial behind the disc for premium gloss.
    const aura = ctx.createRadialGradient(p.sx, p.sy, r * 0.4, p.sx, p.sy, r * 2.2);
    aura.addColorStop(0, `${color}77`);
    aura.addColorStop(1, `${color}00`);
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Disc with a soft top-light highlight (linear gradient).
    const fill = ctx.createLinearGradient(p.sx, p.sy - r, p.sx, p.sy + r);
    fill.addColorStop(0, lighten(color, 0.18));
    fill.addColorStop(1, color);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fill();

    // Letter
    ctx.fillStyle = "#0a0612";
    ctx.font = `600 ${Math.round(11 * p.sc)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.base, p.sx, p.sy + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function lighten(hex, k) {
    // Lighten a #rrggbb hex toward white by factor k ∈ [0,1].
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return hex;
    const lerp = (v) => Math.round(v + (255 - v) * k);
    const r = lerp(parseInt(m[1], 16));
    const g = lerp(parseInt(m[2], 16));
    const b = lerp(parseInt(m[3], 16));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function drawStrandLabels(yTop, totalH) {
    // DNA strands are antiparallel:
    //   strand A — 5' at top, 3' at bottom
    //   strand B — 3' at top, 5' at bottom
    // Top of the helix uses index 0's x for both strands; bottom uses
    // index N-1's x. Previously this drew strand A's bottom label at
    // index 0's x and strand B's top label at index N-1's x, putting
    // both bottom-strand labels in line with whichever strand happened
    // to be in front at i=0 — anatomically wrong.
    const N = seq.length;
    const A0 = strandPoint(0,     "A"); const pA0 = project(A0.x, A0.z);
    const An = strandPoint(N - 1, "A"); const pAn = project(An.x, An.z);
    const B0 = strandPoint(0,     "B"); const pB0 = project(B0.x, B0.z);
    const Bn = strandPoint(N - 1, "B"); const pBn = project(Bn.x, Bn.z);

    // When the rotation brings both strand ends to nearly the same
    // screen x (edge-on), the two labels land on top of each other —
    // push the pair apart symmetrically to a minimum separation.
    const MIN_GAP = 18;
    function spread(xa, xb) {
      const d = xb - xa;
      if (Math.abs(d) >= MIN_GAP) return [xa, xb];
      const mid = (xa + xb) / 2;
      const s = (d >= 0 ? 1 : -1) * MIN_GAP / 2;
      return [mid - s, mid + s];
    }
    const [topA, topB] = spread(pA0.sx, pB0.sx);
    const [botA, botB] = spread(pAn.sx, pBn.sx);

    ctx.fillStyle = "rgba(240, 230, 255, 0.70)";
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText("5'",  topA, yTop - 14);
    ctx.fillText("3'",  botA, yTop + totalH + 14);
    ctx.fillText("3'",  topB, yTop - 14);
    ctx.fillText("5'",  botB, yTop + totalH + 14);
    ctx.textAlign = "left";
  }

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt) {
    const speedDegPerSec = parseFloat(inputs.spin.value);
    phi += (speedDegPerSec * Math.PI) / 180 * dt;
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    if (!paused && !dragging) step(dt);
    render();
  }

  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Drag to spin ───────────────────────────────────────────────────────
  // Horizontal drag on the canvas rotates the helix by hand — sensitivity
  // tuned so a full canvas-width drag is roughly two turns.
  let dragging = false;
  let dragLastX = 0;
  let dragSens = (Math.PI * 4) / W;

  stage.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragLastX = e.clientX;
    stage.setPointerCapture(e.pointerId);
    stage.style.cursor = "grabbing";
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    phi += (e.clientX - dragLastX) * dragSens;
    dragLastX = e.clientX;
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    stage.style.cursor = "grab";
    try { stage.releasePointerCapture(e.pointerId); } catch {}
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.style.cursor = "grab";

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
  inputs.length.addEventListener("input", () => {
    syncLabels();
  });
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
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
  });

  resetBtn.addEventListener("click", () => {
    seq = DEFAULT_SEQ;
    inputs.seq.value = seq;
    inputs.length.value = "21";
    inputs.spin.value = "18";
    phi = 0;
    paused = false;
    pauseBtn.textContent = i18nText("wavePauseBtn", "Pause");
    syncLabels();
    syncReadouts();
  });

  document.addEventListener("langchange", () => {
    pauseBtn.textContent = paused
      ? i18nText("waveResumeBtn", "Resume")
      : i18nText("wavePauseBtn", "Pause");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 300);
    H = Math.max(Math.round(rect.height), 300);
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CX = W / 2;
    dragSens = (Math.PI * 4) / W;
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  syncLabels();
  syncReadouts();
  start();
})();
