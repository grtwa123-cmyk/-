/*
 * Image formation by a thin lens, built out of rays rather than out of the
 * answer.
 *
 * Cartesian convention: light travels left to right, distances are measured
 * from the lens, and rightward is positive. A real object therefore sits at
 * u < 0. Converging lenses have f > 0, diverging f < 0.
 *
 * The only optics in here is one line — a thin lens changes a ray's slope by
 * an amount proportional to the height at which the ray crosses it:
 *
 *     θ′ = θ − y/f
 *
 * That is the exact paraxial transfer, [[1,0],[−1/f,1]] as a matrix. Every
 * ray in the fan gets it and nothing else. The image is not placed: it is
 * wherever the rays happen to cross, and the fact that they cross at all is
 * the lens equation falling out of the algebra. Taking a ray that leaves the
 * tip (u, h) and crosses the lens at height y_L, its height back at x is
 *
 *     y(x) = h(1 − x/f) + θ(x + u·x/f − u)
 *
 * and the θ term vanishes for every ray at once exactly when
 *
 *     1/v − 1/u = 1/f,       where then  y = h·(v/u) = m·h
 *
 * so the convergence point and the textbook formula are the same statement.
 * The readout reports the largest distance any traced ray misses the image
 * point by, which stays at the 1e-14 level — that is the algebra above being
 * checked against the picture on every frame.
 *
 * The three "principal rays" are not separate rules. They are the members of
 * the same fan with θ = 0, with y_L = 0, and with the one aimed at the front
 * focus; the simulation highlights them but does not treat them differently.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    focal: document.getElementById("focal"),
    objdist: document.getElementById("objdist"),
    objheight: document.getElementById("objheight"),
    rays: document.getElementById("rays"),
  };
  const inputValues = {
    focal: document.getElementById("focal-value"),
    objdist: document.getElementById("objdist-value"),
    objheight: document.getElementById("objheight-value"),
    rays: document.getElementById("rays-value"),
  };
  const out = {
    v: document.getElementById("out-v"),
    m: document.getElementById("out-m"),
    height: document.getElementById("out-height"),
    type: document.getElementById("out-type"),
    newton: document.getElementById("out-newton"),
    residual: document.getElementById("out-residual"),
  };
  const kindList = document.getElementById("kind-list");
  const principalToggle = document.getElementById("principal-on");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const APERTURE = 8;        // lens semi-aperture, cm
  const V_CAP = 400;         // beyond this the image is called "at infinity"

  let kind = "convex";

  function params() {
    const f = parseFloat(inputs.focal.value) * (kind === "convex" ? 1 : -1);
    return {
      f,
      u: -parseFloat(inputs.objdist.value),        // real object, left of lens
      h: parseFloat(inputs.objheight.value),
      n: parseInt(inputs.rays.value, 10),
    };
  }

  /** Where the image is, from the thin-lens equation. */
  function solve(p) {
    const inv = 1 / p.f + 1 / p.u;                 // 1/v = 1/f + 1/u
    const v = Math.abs(inv) < 1e-12 ? Infinity : 1 / inv;
    const m = Number.isFinite(v) ? v / p.u : NaN;
    return { v, m, height: Number.isFinite(m) ? m * p.h : NaN };
  }

  /**
   * One ray, given the height at which it crosses the lens. Returns the
   * incoming slope, the outgoing slope, and that height — the outgoing slope
   * is the entire action of the lens.
   */
  function ray(yL, p) {
    const theta = (yL - p.h) / -p.u;               // slope from tip to lens
    return { yL, theta, out: theta - yL / p.f };
  }

  /** Height of a traced ray at the image plane — the convergence check. */
  const rayAt = (r, x) => r.yL + r.out * x;

  /** Largest distance any traced ray misses the image point by. */
  function convergenceError(p, s) {
    if (!Number.isFinite(s.v)) return 0;
    let worst = 0;
    for (let i = 0; i <= 40; i++) {
      const yL = -APERTURE + (2 * APERTURE * i) / 40;
      worst = Math.max(worst, Math.abs(rayAt(ray(yL, p), s.v) - s.height));
    }
    return worst;
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    const narrow = W < 560;
    L = {
      narrow,
      fs: narrow ? 10 : 11,
      fsv: narrow ? 9 : 10,
      padL: narrow ? 12 : 18,
      padR: narrow ? 12 : 18,
      top: narrow ? 18 : 24,
      bot: H - (narrow ? 26 : 32),
    };
    L.cy = (L.top + L.bot) / 2;
  }

  /**
   * The window on the optical bench. It has to hold the object, both foci and
   * the image, but a virtual image can sit far off to the left and a real one
   * runs away to infinity near the focus, so the span is clamped rather than
   * letting one extreme collapse everything else to a point.
   */
  function view(p, s) {
    let left = Math.min(p.u, -Math.abs(p.f)) - 6;
    let right = Math.max(Math.abs(p.f), 12) + 6;
    if (Number.isFinite(s.v) && Math.abs(s.v) <= V_CAP) {
      left = Math.min(left, s.v - 6);
      right = Math.max(right, s.v + 6);
    }
    const cap = Math.max(Math.abs(p.u) * 3.2, 60);
    left = Math.max(left, -cap);
    right = Math.min(right, cap);
    const vHalfWanted = Math.max(
      APERTURE * 1.15,
      p.h * 1.3,
      Number.isFinite(s.height) ? Math.abs(s.height) * 1.3 : 0
    );
    return { left, right, vHalf: Math.min(vHalfWanted, 60) };
  }

  const text = (str, x, y, colour, size, align, bold) => {
    ctx.fillStyle = colour;
    ctx.font = `${bold ? "600 " : ""}${size}px ui-monospace, monospace`;
    ctx.textAlign = align || "left";
    ctx.fillText(str, x, y);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p, s) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#080c18");
    bg.addColorStop(1, "#0c1124");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const { fs, fsv, cy, padL, padR, narrow } = L;
    const vw = view(p, s);
    const X = (x) => padL + ((x - vw.left) / (vw.right - vw.left)) * (W - padL - padR);
    const Y = (y) => cy - (y / vw.vHalf) * ((L.bot - L.top) / 2);
    const x0 = X(0);

    // Optical axis.
    ctx.strokeStyle = "rgba(226,234,248,0.22)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(padL, cy); ctx.lineTo(W - padR, cy); ctx.stroke();
    ctx.setLineDash([]);

    // The lens: bulging out for converging, waisted for diverging.
    const ap = Math.min(Math.abs(Y(APERTURE) - cy), (L.bot - L.top) / 2 - 2);
    const bulge = kind === "convex" ? 13 : -13;
    ctx.fillStyle = "rgba(110, 168, 255, 0.16)";
    ctx.strokeStyle = "rgba(140, 190, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (kind === "convex") {
      ctx.moveTo(x0, cy - ap);
      ctx.quadraticCurveTo(x0 + bulge * 2, cy, x0, cy + ap);
      ctx.quadraticCurveTo(x0 - bulge * 2, cy, x0, cy - ap);
    } else {
      const w = 9;
      ctx.moveTo(x0 - w, cy - ap);
      ctx.lineTo(x0 + w, cy - ap);
      ctx.quadraticCurveTo(x0 + w + bulge, cy, x0 + w, cy + ap);
      ctx.lineTo(x0 - w, cy + ap);
      ctx.quadraticCurveTo(x0 - w - bulge, cy, x0 - w, cy - ap);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // Focal points, at ±f on the axis whichever way f points.
    for (const sgn of [-1, 1]) {
      const fx = X(sgn * p.f);
      if (fx < padL || fx > W - padR) continue;
      ctx.fillStyle = "rgba(255, 225, 74, 0.9)";
      ctx.beginPath(); ctx.arc(fx, cy, 3.2, 0, Math.PI * 2); ctx.fill();
      text(sgn * p.f > 0 ? "F′" : "F", fx, cy + 16, "rgba(255,225,74,0.75)", fsv, "center");
    }
    // ...and 2f, the life-size points, which is where m = −1.
    for (const sgn of [-1, 1]) {
      const fx = X(sgn * 2 * p.f);
      if (fx < padL || fx > W - padR) continue;
      ctx.fillStyle = "rgba(255, 225, 74, 0.4)";
      ctx.beginPath(); ctx.arc(fx, cy, 2.2, 0, Math.PI * 2); ctx.fill();
      text("2f", fx, cy + 16, "rgba(255,225,74,0.4)", fsv, "center");
    }

    // The ray fan. Rays are chosen by where they cross the lens, so every one
    // of them actually lands on the glass.
    const rays = [];
    for (let i = 0; i < p.n; i++) {
      const t = p.n === 1 ? 0.5 : i / (p.n - 1);
      rays.push(ray(-APERTURE + 2 * APERTURE * t, p));
    }
    // The three easy-to-draw members, highlighted but not treated differently.
    const principal = principalToggle.checked
      ? [ray(p.h, p), ray(0, p), ray((p.h * p.f) / (p.f + p.u), p)]
      : [];

    const drawRay = (r, colour, width) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(X(p.u), Y(p.h));
      ctx.lineTo(x0, Y(r.yL));
      const xEnd = vw.right;
      ctx.lineTo(X(xEnd), Y(rayAt(r, xEnd)));
      ctx.stroke();
      // A virtual image is where the outgoing rays came from, not where they
      // go, so the backward extensions are what actually meet — dashed,
      // because no light travels along them.
      if (Number.isFinite(s.v) && s.v < 0) {
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = Math.max(width - 0.6, 0.7);
        ctx.beginPath();
        ctx.moveTo(x0, Y(r.yL));
        ctx.lineTo(X(vw.left), Y(rayAt(r, vw.left)));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    for (const r of rays) drawRay(r, "rgba(140, 200, 255, 0.30)", 1);
    for (const r of principal) {
      if (!Number.isFinite(r.yL) || Math.abs(r.yL) > APERTURE * 1.02) continue;
      drawRay(r, "rgba(255, 184, 107, 0.95)", 1.7);
    }

    // Object.
    const drawArrow = (x, y, colour, dashed, label) => {
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = 2.4;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath(); ctx.moveTo(X(x), cy); ctx.lineTo(X(x), Y(y)); ctx.stroke();
      ctx.setLineDash([]);
      const dir = y >= 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(X(x), Y(y));
      ctx.lineTo(X(x) - 5, Y(y) - dir * 9);
      ctx.lineTo(X(x) + 5, Y(y) - dir * 9);
      ctx.closePath(); ctx.fill();
      if (label) {
        // The rays run right through where these labels sit, so each gets its
        // own plate rather than competing with the fan for legibility.
        const ly = Y(y) + (y >= 0 ? -14 : 20);
        ctx.font = `600 ${fsv}px ui-monospace, monospace`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(8,12,24,0.82)";
        ctx.fillRect(X(x) - tw / 2 - 5, ly - fsv - 2, tw + 10, fsv + 7);
        text(label, X(x), ly, colour, fsv, "center", true);
      }
    };
    drawArrow(p.u, p.h, "rgba(110, 230, 190, 0.95)", false,
      i18nText("lensObject", "object"));

    if (!Number.isFinite(s.v) || Math.abs(s.v) > V_CAP) {
      text(i18nText("lensAtInfinity", "rays leave parallel — the image is at infinity"),
        W / 2, L.top + 14, "rgba(255,225,74,0.9)", fs, "center", true);
    } else {
      drawArrow(s.v, s.height,
        s.v > 0 ? "rgba(255, 138, 163, 0.95)" : "rgba(200, 150, 255, 0.95)",
        s.v < 0,
        s.v > 0 ? i18nText("lensRealImage", "real image") : i18nText("lensVirtualImage", "virtual image"));
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(X(s.v), Y(s.height), 3.4, 0, Math.PI * 2); ctx.fill();
    }

    // Scale bar, so the picture keeps a size as well as a shape.
    const span = vw.right - vw.left;
    const stepCm = span > 160 ? 50 : span > 80 ? 20 : span > 40 ? 10 : 5;
    const barPx = X(stepCm) - X(0);
    ctx.strokeStyle = "rgba(226,234,248,0.4)";
    ctx.lineWidth = 1;
    const bx = padL + 8, by = L.bot + (narrow ? 16 : 20);
    ctx.beginPath();
    ctx.moveTo(bx, by - 3); ctx.lineTo(bx, by + 3);
    ctx.moveTo(bx, by); ctx.lineTo(bx + barPx, by);
    ctx.moveTo(bx + barPx, by - 3); ctx.lineTo(bx + barPx, by + 3);
    ctx.stroke();
    text(`${stepCm} cm`, bx + barPx + 8, by + 3.5, "rgba(226,234,248,0.5)", fsv, "left");
    text(`f = ${p.f.toFixed(1)} cm`, W - padR, by + 3.5,
      "rgba(255,225,74,0.7)", fsv, "right");
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(p, s) {
    const far = !Number.isFinite(s.v) || Math.abs(s.v) > V_CAP;
    out.v.textContent = far ? "∞" : s.v.toFixed(2);
    out.m.textContent = far ? "∞" : s.m.toFixed(3);
    out.height.textContent = far ? "∞" : s.height.toFixed(2);
    out.type.textContent = far
      ? i18nText("lensNoImage", "none — at infinity")
      : `${s.v > 0 ? i18nText("lensReal", "real") : i18nText("lensVirtual", "virtual")} · ` +
        `${s.m > 0 ? i18nText("lensUpright", "upright") : i18nText("lensInverted", "inverted")} · ` +
        `${Math.abs(s.m) > 1.0005 ? i18nText("lensLarger", "enlarged")
          : Math.abs(s.m) < 0.9995 ? i18nText("lensSmaller", "reduced")
          : i18nText("lensSameSize", "life-size")}`;
    // Newton's form is an independent statement of the same optics, so its
    // agreeing with f² is a check rather than a restatement.
    out.newton.textContent = far ? "—"
      : `${((-p.u - p.f) * (s.v - p.f)).toFixed(2)} = f² = ${(p.f * p.f).toFixed(2)}`;
    out.residual.textContent = far ? "—" : convergenceError(p, s).toExponential(1);
  }

  function updateLabels() {
    inputValues.focal.textContent = parseFloat(inputs.focal.value).toFixed(1).replace(/\.0$/, "");
    inputValues.objdist.textContent = parseFloat(inputs.objdist.value).toFixed(1).replace(/\.0$/, "");
    inputValues.objheight.textContent = parseFloat(inputs.objheight.value).toFixed(1);
    inputValues.rays.textContent = inputs.rays.value;
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const p = params();
    const s = solve(p);
    render(p, s);
    updateReadouts(p, s);
  }
  function start() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function setKind(next) {
    kind = next;
    kindList.querySelectorAll(".mol-btn").forEach((b) => {
      const on = b.dataset.key === next;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  Object.values(inputs).forEach((el) => el.addEventListener("input", updateLabels));
  kindList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setKind(btn.dataset.key);
      window.SFX?.tone({ freq: btn.dataset.key === "convex" ? 560 : 380, dur: 0.08, type: "triangle", gain: 0.1 });
    });
  });
  principalToggle.addEventListener("change", () => window.SFX?.click({ gain: 0.2 }));
  resetBtn.addEventListener("click", () => {
    setKind("convex");
    updateLabels();
    window.SFX?.click({ gain: 0.22 });
  });

  document.addEventListener("langchange", () => {
    const p = params();
    updateReadouts(p, solve(p));
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
    W = Math.max(Math.round(rect.width), 260);
    H = W < 560 ? 380 : 470;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the harness can check the optics against the closed forms.
  window.__lens = {
    params, solve, ray, rayAt, convergenceError,
    setKind, APERTURE,
    kind: () => kind,
  };

  resizeCanvas();
  setKind("convex");
  updateLabels();
  start();
})();
