/*
 * Build an Atom — protons, neutrons, electrons dragged onto a live atom.
 *
 * Everything the readouts report is derived from three integer counts, the
 * way real chemistry works:
 *   element      Z   = number of protons        (defines the element)
 *   net charge   q   = protons − electrons      (0 → neutral, ±→ ion)
 *   mass number  A   = protons + neutrons
 *   isotope          = same Z, different N
 *   nuclear stability from a lookup of the actually-stable (Z, N) nuclides
 *                     for H … Ne — charge (electrons) has no bearing on it.
 *
 * Nucleons are packed into the nucleus by a golden-angle (phyllotaxis)
 * spiral so the cluster stays tight and even at any count; electrons fill
 * Bohr shells of capacity 2, 8 (or render as a fuzzy cloud). Particles
 * animate toward those home positions unless you're dragging one. Drag
 * from a bucket to add, drag a particle back down to a bucket to remove.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const out = {
    element:   document.getElementById("out-element"),
    isotope:   document.getElementById("out-isotope"),
    charge:    document.getElementById("out-charge"),
    mass:      document.getElementById("out-mass"),
    state:     document.getElementById("out-state"),
    stability: document.getElementById("out-stability"),
  };
  const prop = {
    protons:   document.getElementById("prop-protons"),
    neutrons:  document.getElementById("prop-neutrons"),
    electrons: document.getElementById("prop-electrons"),
  };
  const modelList = document.getElementById("model-list");
  const symbolToggle = document.getElementById("symbol-toggle");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Element + stability data (Z = 1 … 10, matching the bucket budget) ──
  const ELEMENTS = [
    null,                                   // index 0 → no element
    { sym: "H",  key: "elemH"  }, { sym: "He", key: "elemHe" },
    { sym: "Li", key: "elemLi" }, { sym: "Be", key: "elemBe" },
    { sym: "B",  key: "elemB"  }, { sym: "C",  key: "elemC"  },
    { sym: "N",  key: "elemN"  }, { sym: "O",  key: "elemO"  },
    { sym: "F",  key: "elemF"  }, { sym: "Ne", key: "elemNe" },
  ];
  // Stable neutron counts N for each Z (the genuinely stable nuclides).
  const STABLE_N = {
    1: [0, 1], 2: [1, 2], 3: [3, 4], 4: [5], 5: [5, 6],
    6: [6, 7], 7: [7, 8], 8: [8, 9, 10], 9: [10], 10: [10, 11, 12],
  };
  const isStable = (p, n) => p >= 1 && STABLE_N[p] && STABLE_N[p].includes(n);

  const MAX = { p: 10, n: 12, e: 10 };
  const SHELL_CAP = [2, 8];
  const COLOR = { p: "#ff6b8a", n: "#9aa3bd", e: "#6ea8ff" };

  // ── State ──────────────────────────────────────────────────────────────
  const protons = [];    // { x, y }
  const neutrons = [];   // { x, y }
  const electrons = [];  // { x, y }
  let electronModel = "shells";
  let showSymbol = true;
  let drag = null;       // { kind:'p'|'n'|'e', obj, source:'bucket'|'atom' }
  let lastTs = performance.now();
  let raf = 0;
  let clock = 0;

  // ── Layout (logical px) ────────────────────────────────────────────────
  let cx = 0, cy = 0;          // nucleus centre
  let SHELL_R = [70, 116];     // Bohr shell radii (scaled to fit narrow screens)
  const bucket = {};           // p/n/e → { x, y }
  let B_R = 46;                // bucket radius (shrinks on narrow screens)
  let narrow = false;          // portrait / phone layout

  function computeLayout() {
    narrow = W < 560;
    // Nucleus centred horizontally so it never crowds a corner; sits in the
    // upper third so the element tile (top-left) and buckets (bottom) both
    // have their own clear band.
    cx = W / 2;
    cy = narrow ? Math.round(H * 0.40) : 236;
    // Shells scale down only if they'd spill past the canvas edge.
    const fit = Math.min(1, (W / 2 - 16) / 116);
    SHELL_R = [Math.round(70 * fit), Math.round(116 * fit)];
    // Three buckets spread evenly across the foot; radius adapts so they
    // never touch on a phone.
    B_R = Math.max(30, Math.min(46, Math.round(W * 0.135)));
    const by = H - (narrow ? B_R + 34 : 66);
    bucket.p = { x: Math.round(W * 0.17), y: by };
    bucket.n = { x: Math.round(W * 0.50), y: by };
    bucket.e = { x: Math.round(W * 0.83), y: by };
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const arr = (kind) => (kind === "p" ? protons : kind === "n" ? neutrons : electrons);

  // Nucleon home position by index — golden-angle spiral around the nucleus.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  function nucleonHome(i) {
    const spacing = 7.2;
    const a = i * GOLDEN;
    const r = spacing * Math.sqrt(i);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }
  function nucleusRadius() {
    const c = protons.length + neutrons.length;
    return c <= 1 ? 9 : 7.2 * Math.sqrt(c - 1) + 9;
  }

  // Electron home — fill shells of capacity SHELL_CAP (fallback 8 beyond).
  function shellInfo(i, total) {
    let rem = i, s = 0;
    while (rem >= (SHELL_CAP[s] || 8)) { rem -= (SHELL_CAP[s] || 8); s++; }
    let before = 0;
    for (let k = 0; k < s; k++) before += (SHELL_CAP[k] || 8);
    const inShell = Math.min((SHELL_CAP[s] || 8), total - before);
    return { shell: s, idxInShell: rem, inShell };
  }
  const shellRadius = (shell) =>
    SHELL_R[shell] || (SHELL_R[SHELL_R.length - 1] + 40 * (shell - SHELL_R.length + 1));

  function electronHome(i, total) {
    const { shell, idxInShell, inShell } = shellInfo(i, total);
    const r = shellRadius(shell);
    const dir = shell % 2 === 0 ? 1 : -1;
    // Gentle orbit — slow enough that the small electrons stay easy to grab.
    const ang = clock * 0.4 * dir + (idxInShell / Math.max(inShell, 1)) * Math.PI * 2;
    return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
  }

  // ── Electron cloud model ───────────────────────────────────────────────
  // The whole point of the orbital picture is that an electron has no orbit:
  // only a probability of being found somewhere. So in cloud mode electrons
  // are not placed on a circle at all — each one repeatedly re-samples a
  // position from the shell's radial probability distribution and drifts
  // there, which is why the two models now look nothing alike.
  //
  // The radial spread per shell is what turns a sharp Bohr ring into a
  // smeared shell; the density still peaks at the shell radius, and the gap
  // between K and L stays visible, so the shell structure survives.
  const SHELL_SPREAD = [15, 23];
  const spreadOf = (shell) => SHELL_SPREAD[shell] || 26;

  let gaussSpare = null;
  function gauss() {
    if (gaussSpare !== null) { const g = gaussSpare; gaussSpare = null; return g; }
    let u = 0;
    while (u === 0) u = Math.random();
    const m = Math.sqrt(-2 * Math.log(u));
    const t = 2 * Math.PI * Math.random();
    gaussSpare = m * Math.sin(t);
    return m * Math.cos(t);
  }

  function sampleCloudPoint(shell) {
    const floor = nucleusRadius() + 14;
    let r = shellRadius(shell) + gauss() * spreadOf(shell);
    if (r < floor) r = floor + Math.random() * 8;
    const a = Math.random() * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }

  // A fixed speckle field per shell, so the haze reads as a stable cloud
  // instead of strobing noise. Offsets are normalised; the draw pass scales
  // them by the shell radius/spread and rotates the whole field slowly.
  const SPECKLES = [];
  (function buildSpeckles() {
    let seed = 20240611;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let s = 0; s < 3; s++) {
      const pts = [];
      for (let i = 0; i < 130; i++) {
        // Box–Muller from the seeded stream keeps the radial profile right.
        const u = Math.max(rnd(), 1e-6);
        const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
        pts.push({ dr: g, a: rnd() * Math.PI * 2, w: 0.35 + rnd() * 0.65 });
      }
      SPECKLES.push(pts);
    }
  })();

  // How many electrons sit in each shell, given the total.
  function shellOccupancy(total) {
    const occ = [];
    let left = total;
    for (let s = 0; s < SHELL_R.length; s++) {
      const cap = SHELL_CAP[s] || 8;
      occ.push(Math.max(0, Math.min(cap, left)));
      left -= cap;
    }
    return occ;
  }

  // ── Add / remove ───────────────────────────────────────────────────────
  function remaining(kind) {
    return MAX[kind === "p" ? "p" : kind === "n" ? "n" : "e"] - arr(kind).length;
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function drawBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0c1020");
    bg.addColorStop(1, "#140b1e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawParticle(p, kind, r) {
    const col = COLOR[kind];
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Highlight + sign
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(p.x - r * 0.32, p.y - r * 0.34, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    if (kind !== "n") {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `700 ${Math.round(r * 1.05)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(kind === "p" ? "+" : "−", p.x, p.y + 0.5);
      ctx.textBaseline = "alphabetic";
    }
  }

  function drawShellsOrCloud() {
    if (electronModel === "cloud") {
      const total = electrons.length;
      if (!total) return;
      const occ = shellOccupancy(total);
      for (let s = 0; s < occ.length; s++) {
        if (!occ[s]) continue;
        const R = shellRadius(s);
        const sd = spreadOf(s);
        const cap = SHELL_CAP[s] || 8;
        const fill = occ[s] / cap;

        // Density peaked at the shell radius and fading both ways — the
        // probability shell, rather than a line at a fixed radius.
        const inner = Math.max(R - sd * 2.4, 0);
        const outer = R + sd * 2.4;
        const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
        const a = 0.05 + 0.17 * fill;
        g.addColorStop(0, "rgba(110, 168, 255, 0)");
        g.addColorStop(0.5, `rgba(110, 168, 255, ${a.toFixed(3)})`);
        g.addColorStop(1, "rgba(110, 168, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.fill();

        // Speckle field: individual "where it might be" samples, drifting.
        const pts = SPECKLES[s] || SPECKLES[0];
        const spin = clock * (s % 2 === 0 ? 0.06 : -0.045);
        const shown = Math.round(pts.length * (0.25 + 0.75 * fill));
        for (let i = 0; i < shown; i++) {
          const p = pts[i];
          const r = R + p.dr * sd;
          if (r < nucleusRadius() + 6) continue;
          const ang = p.a + spin;
          ctx.fillStyle = `rgba(150, 195, 255, ${(0.10 + 0.22 * p.w * fill).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 1.5 * p.w + 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    // Bohr shell rings (only the ones that hold electrons)
    const e = electrons.length;
    let need = 0, acc = 0;
    for (let s = 0; s < SHELL_R.length; s++) { if (acc < e) need = s + 1; acc += SHELL_CAP[s] || 8; }
    for (let s = 0; s < need; s++) {
      ctx.strokeStyle = "rgba(150, 190, 255, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, SHELL_R[s], 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawBucket(kind, label) {
    const b = bucket[kind];
    // Tray
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 12, B_R, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // A little pile of remaining particles
    const rem = remaining(kind);
    const r = kind === "e" ? 7 : 9;
    const spots = [[-16, 4], [0, 0], [16, 4], [-8, 12], [8, 12]];
    for (let i = 0; i < Math.min(rem, spots.length); i++) {
      drawParticle({ x: b.x + spots[i][0], y: b.y + spots[i][1] - 4 }, kind, r);
    }
    ctx.fillStyle = "rgba(236,240,251,0.85)";
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label + "  " + rem, b.x, b.y + 40);
  }

  // Element identity as a periodic-table tile in the top-left corner, well
  // clear of the nucleus — the symbol used to sit on top of the nucleons,
  // where the packed particles made it unreadable.
  function drawSymbolTile() {
    if (!showSymbol) return;
    const p = protons.length;
    const el = ELEMENTS[p];
    const size = narrow ? 74 : 90;
    const x = 14, y = 14;
    ctx.save();
    roundRectPath(x, y, size, size, 12);
    ctx.fillStyle = el ? "rgba(18, 24, 44, 0.82)" : "rgba(18, 24, 44, 0.4)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = el ? "rgba(150, 190, 255, 0.55)" : "rgba(255, 255, 255, 0.12)";
    ctx.stroke();

    if (!el) {
      ctx.fillStyle = "rgba(236, 240, 251, 0.28)";
      ctx.font = `700 ${Math.round(size * 0.42)}px -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", x + size / 2, y + size / 2);
      ctx.restore();
      return;
    }

    // Atomic number (top-left) and mass number (top-right).
    ctx.fillStyle = "rgba(236, 240, 251, 0.7)";
    ctx.font = `700 ${narrow ? 11 : 12}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(String(p), x + 8, y + 7);
    ctx.textAlign = "right";
    ctx.fillText(String(p + neutrons.length), x + size - 8, y + 7);

    // Symbol, large and centred.
    ctx.fillStyle = "#eaf0ff";
    ctx.font = `800 ${narrow ? 30 : 38}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(el.sym, x + size / 2, y + size / 2 + 2);

    // Element name across the foot of the tile.
    ctx.fillStyle = "rgba(150, 190, 255, 0.9)";
    ctx.font = `600 ${narrow ? 10 : 11}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "center";
    ctx.fillText(i18nText(el.key, el.sym), x + size / 2, y + size - 6);
    ctx.restore();
  }

  function render() {
    drawBackground();
    drawShellsOrCloud();

    // Nucleons (behind the symbol badge)
    const rN = 9;
    for (let i = 0; i < protons.length; i++) if (protons[i] !== (drag && drag.obj)) drawParticle(protons[i], "p", rN);
    for (let i = 0; i < neutrons.length; i++) if (neutrons[i] !== (drag && drag.obj)) drawParticle(neutrons[i], "n", rN);

    // Electrons
    for (let i = 0; i < electrons.length; i++) if (electrons[i] !== (drag && drag.obj)) drawParticle(electrons[i], "e", 7);

    // Element tile — a corner badge, clear of the nucleus, shown in both models
    drawSymbolTile();

    // Buckets
    drawBucket("p", i18nText("atomProtons", "Protons"));
    drawBucket("n", i18nText("atomNeutrons", "Neutrons"));
    drawBucket("e", i18nText("atomElectrons", "Electrons"));

    // Dragged particle on top
    if (drag) drawParticle(drag.obj, drag.kind, drag.kind === "e" ? 7 : 9);
  }

  // ── Physics/animation step ─────────────────────────────────────────────
  function step(dt) {
    clock += dt;
    for (let i = 0; i < protons.length; i++) ease(protons[i], nucleonHome(i));
    const off = protons.length;
    for (let i = 0; i < neutrons.length; i++) ease(neutrons[i], nucleonHome(off + i));
    for (let i = 0; i < electrons.length; i++) {
      const e = electrons[i];
      if (electronModel === "cloud") {
        // Re-roll a destination every second or so and drift toward it, so
        // the electron wanders the shell instead of circling it.
        e.ttl = (e.ttl || 0) - dt;
        if (e.ttl <= 0 || e.hx === undefined) {
          const p = sampleCloudPoint(shellInfo(i, electrons.length).shell);
          e.hx = p.x; e.hy = p.y;
          e.ttl = 0.8 + Math.random() * 1.4;
        }
        ease(e, { x: e.hx, y: e.hy }, 0.045);
      } else {
        e.ttl = 0;                       // force a fresh sample on the way back
        ease(e, electronHome(i, electrons.length));
      }
    }
  }
  function ease(o, home, k) {
    if (drag && drag.obj === o) return;
    const f = k === undefined ? 0.18 : k;
    o.x += (home.x - o.x) * f;
    o.y += (home.y - o.y) * f;
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function superA(n) {
    const S = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
    return String(n).split("").map((c) => S[c] || c).join("");
  }
  function updateReadouts() {
    const p = protons.length, n = neutrons.length, e = electrons.length;
    prop.protons.textContent = String(p);
    prop.neutrons.textContent = String(n);
    prop.electrons.textContent = String(e);

    const el = ELEMENTS[p];
    out.element.textContent = el ? i18nText(el.key, el.sym) : "—";
    out.isotope.textContent = el ? superA(p + n) + el.sym : "—";

    const q = p - e;
    out.charge.textContent = q === 0 ? "0" : (q > 0 ? "+" : "−") + Math.abs(q);
    out.charge.style.color = q === 0 ? "" : (q > 0 ? "#ff9f6b" : "#6ea8ff");
    out.mass.textContent = String(p + n);

    out.state.textContent = p + n + e === 0 ? "—"
      : q === 0 ? i18nText("atomNeutral", "Neutral")
      : q > 0 ? i18nText("atomCation", "Cation (+)")
      : i18nText("atomAnion", "Anion (−)");

    if (p === 0) {
      out.stability.textContent = "—";
      out.stability.style.color = "";
    } else if (isStable(p, n)) {
      out.stability.textContent = i18nText("atomStable", "Stable");
      out.stability.style.color = "#6effc6";
    } else {
      out.stability.textContent = i18nText("atomUnstable", "Unstable");
      out.stability.style.color = "#ff6b8a";
    }
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    step(dt);
    render();
    updateReadouts();
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Pointer / drag-drop ────────────────────────────────────────────────
  function pointerPos(e) {
    const rect = stage.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  }
  const dist2 = (a, bx, by) => (a.x - bx) ** 2 + (a.y - by) ** 2;

  function overBucket(pt) {
    for (const kind of ["p", "n", "e"]) {
      const b = bucket[kind];
      if (dist2(pt, b.x, b.y + 6) < (B_R + 14) ** 2) return kind;
    }
    return null;
  }
  function inAtomZone(pt) {
    // Accept a drop anywhere in the upper region, above the bucket tray —
    // forgiving on touch, where precise aiming at the nucleus is hard.
    return pt.y < bucket.p.y - B_R - 4;
  }

  function pickExisting(pt) {
    // Nearest particle within a per-type grab radius. Electrons are small
    // and orbiting, so they get a more forgiving radius; the search is
    // nearest-wins so a generous radius never grabs a far particle when a
    // closer one is under the pointer. Electrons are tried first (drawn on
    // top / outermost), then neutrons, then protons.
    let best = null, bestD = Infinity;
    const scan = (list, kind, rad) => {
      const r2 = rad * rad;
      for (let i = list.length - 1; i >= 0; i--) {
        const d = dist2(pt, list[i].x, list[i].y);
        if (d < r2 && d < bestD) { bestD = d; best = { kind, obj: list[i] }; }
      }
    };
    // A touch pointer is coarser than a mouse, so widen the grab radii when
    // the primary input is touch.
    const touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    scan(electrons, "e", touch ? 26 : 20);
    scan(neutrons, "n", touch ? 18 : 13);
    scan(protons, "p", touch ? 18 : 13);
    return best;
  }

  stage.addEventListener("pointerdown", (e) => {
    const pt = pointerPos(e);
    stage.setPointerCapture(e.pointerId);

    // 1) Grab an existing atom particle → drag it out.
    const hit = pickExisting(pt);
    if (hit) {
      const list = arr(hit.kind);
      list.splice(list.indexOf(hit.obj), 1);   // detach; re-added on drop if kept
      hit.obj.x = pt.x; hit.obj.y = pt.y;
      drag = { kind: hit.kind, obj: hit.obj, source: "atom" };
      return;
    }
    // 2) Grab from a bucket → spawn a new particle if any remain.
    const bk = overBucket(pt);
    if (bk && remaining(bk) > 0) {
      drag = { kind: bk, obj: { x: pt.x, y: pt.y }, source: "bucket" };
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const pt = pointerPos(e);
    drag.obj.x = pt.x; drag.obj.y = pt.y;
  });

  // Each particle type gets its own note; adding rises, removing falls.
  const PITCH = { p: 440, n: 330, e: 620 };
  function endDrag(e) {
    if (!drag) return;
    const pt = pointerPos(e);
    const { kind, obj, source } = drag;
    const keep = inAtomZone(pt) && !overBucket(pt);
    if (keep) arr(kind).push(obj);   // commit (bucket-spawn) or re-attach (from atom)
    // else: dropped on a bucket / outside → discarded (for atom-source this
    //       is the removal; for bucket-source it simply never got added).
    const f = PITCH[kind];
    if (keep && source === "bucket") {
      window.SFX?.tone({ freq: f, dur: 0.1, type: "sine", gain: 0.15, glideTo: f * 1.3 });
    } else if (!keep && source === "atom") {
      window.SFX?.tone({ freq: f, dur: 0.12, type: "sine", gain: 0.12, glideTo: f * 0.6 });
    }
    drag = null;
  }
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // ── Wiring ─────────────────────────────────────────────────────────────
  modelList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      electronModel = btn.dataset.key;
      modelList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  symbolToggle.addEventListener("change", () => { showSymbol = symbolToggle.checked; });
  resetBtn.addEventListener("click", () => {
    protons.length = 0; neutrons.length = 0; electrons.length = 0; drag = null;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  function resizeCanvas() {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Fill the container width (down to a small floor so it never overflows a
    // phone) and give the portrait layout extra height for the buckets.
    W = Math.max(Math.round(rect.width), 260);
    H = W < 560 ? 600 : 540;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  /*
   * Build an atom, and read back where its parts actually went.
   *
   * The panel names an element, an isotope, a charge and a stability, all
   * derived from three counts — and the electrons are laid out by a shell
   * rule the reader is meant to be able to count off the picture. So the
   * hook takes the counts in and hands the positions back out, and the suite
   * works the shell structure out of the coordinates rather than asking the
   * page what it thinks it drew.
   */
  window.__atom = {
    shellCap: SHELL_CAP.slice(),
    limits: { ...MAX },
    /** Put exactly this many of each on the board, at their resting places. */
    build({ p = 0, n = 0, e = 0 }) {
      protons.length = 0; neutrons.length = 0; electrons.length = 0; drag = null;
      for (let i = 0; i < Math.min(p, MAX.p); i++) protons.push({ x: 0, y: 0 });
      for (let i = 0; i < Math.min(n, MAX.n); i++) neutrons.push({ x: 0, y: 0 });
      for (let i = 0; i < Math.min(e, MAX.e); i++) electrons.push({ x: 0, y: 0 });
      // Drop each one straight onto its home rather than easing it there, so
      // a measurement is not a race against the animation.
      protons.forEach((q, i) => { const h = nucleonHome(i); q.x = h.x; q.y = h.y; });
      neutrons.forEach((q, i) => {
        const h = nucleonHome(protons.length + i); q.x = h.x; q.y = h.y;
      });
      electrons.forEach((q, i) => {
        const h = electronHome(i, electrons.length); q.x = h.x; q.y = h.y;
      });
      updateReadouts();
      return this.state();
    },
    state: () => ({
      p: protons.length, n: neutrons.length, e: electrons.length,
      centre: { x: cx, y: cy },
      shellRadii: SHELL_R.slice(),
      electrons: electrons.map((q) => ({ x: q.x, y: q.y })),
      nucleons: [...protons, ...neutrons].map((q) => ({ x: q.x, y: q.y })),
    }),
    occupancy: (total) => shellOccupancy(total),
  };

  resizeCanvas();
  start();
})();
