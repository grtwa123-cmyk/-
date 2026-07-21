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
  const SHELL_R = [70, 116];   // Bohr shell radii
  const bucket = {};           // p/n/e → { x, y }
  const B_R = 46;              // bucket radius

  function computeLayout() {
    cx = W * 0.42;
    cy = 232;
    const by = H - 66;
    bucket.p = { x: W * 0.20, y: by };
    bucket.n = { x: W * 0.44, y: by };
    bucket.e = { x: W * 0.68, y: by };
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
  function electronHome(i, total) {
    const { shell, idxInShell, inShell } = shellInfo(i, total);
    const r = SHELL_R[shell] || (SHELL_R[SHELL_R.length - 1] + 40 * (shell - SHELL_R.length + 1));
    const dir = shell % 2 === 0 ? 1 : -1;
    // Gentle orbit — slow enough that the small electrons stay easy to grab.
    const ang = clock * 0.4 * dir + (idxInShell / Math.max(inShell, 1)) * Math.PI * 2;
    return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
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
      const e = electrons.length;
      if (e > 0) {
        const rad = SHELL_R[1] * 0.9;
        const g = ctx.createRadialGradient(cx, cy, nucleusRadius(), cx, cy, rad);
        const a = Math.min(0.05 + e * 0.03, 0.34);
        g.addColorStop(0, `rgba(110, 168, 255, ${a})`);
        g.addColorStop(1, "rgba(110, 168, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
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

  function drawSymbolBadge() {
    if (!showSymbol) return;
    const p = protons.length;
    const el = ELEMENTS[p];
    if (!el) return;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(236,240,251,0.9)";
    ctx.font = `800 ${Math.min(34, 16 + nucleusRadius() * 0.6)}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.fillText(el.sym, cx, cy);
    ctx.restore();
  }

  function render() {
    drawBackground();
    drawShellsOrCloud();

    // Nucleons (behind the symbol badge)
    const rN = 9;
    for (let i = 0; i < protons.length; i++) if (protons[i] !== (drag && drag.obj)) drawParticle(protons[i], "p", rN);
    for (let i = 0; i < neutrons.length; i++) if (neutrons[i] !== (drag && drag.obj)) drawParticle(neutrons[i], "n", rN);

    if (electronModel === "shells") drawSymbolBadge();

    // Electrons
    for (let i = 0; i < electrons.length; i++) if (electrons[i] !== (drag && drag.obj)) drawParticle(electrons[i], "e", 7);

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
    for (let i = 0; i < electrons.length; i++) ease(electrons[i], electronHome(i, electrons.length));
  }
  function ease(o, home) {
    if (drag && drag.obj === o) return;
    o.x += (home.x - o.x) * 0.18;
    o.y += (home.y - o.y) * 0.18;
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
    // Accept a drop that lands anywhere on the atom side (above the buckets).
    return pt.y < H - 120 && dist2(pt, cx, cy) < (SHELL_R[1] + 60) ** 2;
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
    scan(electrons, "e", 20);
    scan(neutrons, "n", 13);
    scan(protons, "p", 13);
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

  function endDrag(e) {
    if (!drag) return;
    const pt = pointerPos(e);
    const { kind, obj } = drag;
    const keep = inAtomZone(pt) && !overBucket(pt);
    if (keep) arr(kind).push(obj);   // commit (bucket-spawn) or re-attach (from atom)
    // else: dropped on a bucket / outside → discarded (for atom-source this
    //       is the removal; for bucket-source it simply never got added).
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
    W = Math.max(Math.round(rect.width), 520);
    H = 540;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  start();
})();
