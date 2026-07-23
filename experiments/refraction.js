/*
 * Snell's law — refraction and total internal reflection.
 *
 * A ray in medium 1 (index n₁) strikes a flat interface and splits into a
 * refracted ray in medium 2 (index n₂) and a partially reflected ray back
 * into medium 1:
 *
 *   n₁·sinθ₁ = n₂·sinθ₂            (Snell's law)
 *   θ_reflected = θ₁               (law of reflection)
 *   θ_c = asin(n₂/n₁)              (critical angle, only when n₁ > n₂)
 *
 * When n₁ > n₂ and θ₁ > θ_c the refracted ray is evanescent — Snell gives
 * sinθ₂ > 1, no real solution — and 100% of the light reflects (TIR).
 *
 * The reflected/transmitted split is the exact Fresnel result for
 * unpolarised light, R = (R_s + R_p)/2, so the two rays are drawn with
 * physically-honest relative brightness (T = 1 − R), and R → 1 as θ₁ → θ_c.
 * Angles are measured from the normal, as in every optics textbook.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    angle: document.getElementById("angle"),
    n1:    document.getElementById("n1"),
    n2:    document.getElementById("n2"),
  };
  const inputValues = {
    angle: document.getElementById("angle-value"),
    n1:    document.getElementById("n1-value"),
    n2:    document.getElementById("n2-value"),
  };
  const out = {
    theta2:   document.getElementById("out-theta2"),
    critical: document.getElementById("out-critical"),
    reflect:  document.getElementById("out-reflect"),
    transmit: document.getElementById("out-transmit"),
    regime:   document.getElementById("out-regime"),
    speed:    document.getElementById("out-speed"),
  };
  const presetList = document.getElementById("preset-list");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const C_LIGHT = 299792458; // m/s, for the phase-speed readout v = c/n

  const PRESETS = {
    airWater:  { n1: 1.00, n2: 1.33 },
    airGlass:  { n1: 1.00, n2: 1.52 },
    waterAir:  { n1: 1.33, n2: 1.00 },
    glassAir:  { n1: 1.52, n2: 1.00 },
    diamond:   { n1: 2.42, n2: 1.00 },
  };

  function readParams() {
    return {
      theta1: parseFloat(inputs.angle.value) * Math.PI / 180,
      n1: parseFloat(inputs.n1.value),
      n2: parseFloat(inputs.n2.value),
    };
  }

  // Fresnel reflectance for unpolarised light.
  function fresnelR(n1, n2, theta1, theta2, tir) {
    if (tir) return 1;
    const c1 = Math.cos(theta1), c2 = Math.cos(theta2);
    const rs = (n1 * c1 - n2 * c2) / (n1 * c1 + n2 * c2);
    const rp = (n1 * c2 - n2 * c1) / (n1 * c2 + n2 * c1);
    return Math.min(1, (rs * rs + rp * rp) / 2);
  }

  function solve(p) {
    const s2 = (p.n1 / p.n2) * Math.sin(p.theta1);
    const tir = Math.abs(s2) > 1;
    const theta2 = tir ? null : Math.asin(Math.max(-1, Math.min(1, s2)));
    const critical = p.n1 > p.n2 ? Math.asin(p.n2 / p.n1) : null;
    const R = fresnelR(p.n1, p.n2, p.theta1, tir ? 0 : theta2, tir);
    return { theta2, tir, critical, R };
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  const originX = () => W / 2;
  const originY = () => H / 2;

  function drawBackground(p) {
    const ox = originX(), oy = originY();
    // Upper medium (n₁) and lower medium (n₂) — denser = deeper blue tint.
    const tint = (n) => `rgba(90, 140, 220, ${0.05 + Math.min((n - 1) * 0.10, 0.28)})`;
    ctx.fillStyle = "#0a1024";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = tint(p.n1);
    ctx.fillRect(0, 0, W, oy);
    ctx.fillStyle = tint(p.n2);
    ctx.fillRect(0, oy, W, H - oy);

    // Interface
    ctx.strokeStyle = "rgba(236, 240, 251, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();

    // Normal (dashed vertical)
    ctx.strokeStyle = "rgba(236, 240, 251, 0.35)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(ox, 24); ctx.lineTo(ox, H - 24); ctx.stroke();
    ctx.setLineDash([]);

    // Medium labels
    ctx.fillStyle = "rgba(236, 240, 251, 0.8)";
    ctx.font = "600 13px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`n₁ = ${p.n1.toFixed(2)}`, 14, 22);
    ctx.fillText(`n₂ = ${p.n2.toFixed(2)}`, 14, H - 14);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(236, 240, 251, 0.4)";
    ctx.fillText(i18nText("refractionNormal", "normal"), ox - 8, 34);
  }

  // dashDir: +1 → photon dashes travel from the far end toward the origin
  // (incoming light), −1 → outward from the origin, 0 → no animation.
  function ray(ox, oy, angleFromNormalUp, len, color, width, alpha, dashDir, phase) {
    const ex = ox + Math.sin(angleFromNormalUp) * len;
    const ey = oy - Math.cos(angleFromNormalUp) * len;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    // Faint continuous beam underneath…
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha * 0.45;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // …with bright travelling photon dashes on top.
    if (dashDir) {
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = 9;
      ctx.setLineDash([13, 11]);
      ctx.lineDashOffset = dashDir * phase * 85;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }
    // Arrow head
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    const back = angleFromNormalUp;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.sin(back - 0.4) * 12, ey + Math.cos(back - 0.4) * 12);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.sin(back + 0.4) * 12, ey + Math.cos(back + 0.4) * 12);
    ctx.stroke();
    ctx.restore();
  }

  function arc(ox, oy, a0, a1, r, color, label) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(ox, oy, r, a0, a1);
    ctx.stroke();
    if (label) {
      const mid = (a0 + a1) / 2;
      ctx.fillStyle = color;
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, ox + Math.cos(mid) * (r + 14), oy + Math.sin(mid) * (r + 14));
    }
    ctx.restore();
  }

  function render(p, sol, phase) {
    drawBackground(p);
    const ox = originX(), oy = originY();
    const L = Math.min(W, H) * 0.42;

    // Incident ray: drawn origin → upper-left; the light travels the
    // other way, so its dashes flow toward the interface (dashDir +1).
    ray(ox, oy, -p.theta1, L, "#ffd27a", 3, 1, +1, phase);
    // Reflected ray: outward into medium 1 (dashes flow away, −1).
    const rAlpha = 0.35 + 0.6 * sol.R;
    ray(ox, oy, p.theta1, L * 0.85, "#ff9f6b", 2.4, rAlpha, -1, phase);
    // Refracted or (if TIR) nothing transmitted.
    if (!sol.tir) {
      const tAlpha = 0.35 + 0.6 * (1 - sol.R);
      // Refracted ray goes DOWN into medium 2 at θ₂ on the same side.
      const ex = ox + Math.sin(sol.theta2) * L;
      const ey = oy + Math.cos(sol.theta2) * L;
      ctx.save();
      ctx.strokeStyle = "#7ad9ee";
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      ctx.globalAlpha = tAlpha * 0.45;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.globalAlpha = tAlpha;
      ctx.shadowColor = "#7ad9ee";
      ctx.shadowBlur = 9;
      ctx.setLineDash([13, 11]);
      ctx.lineDashOffset = -phase * 85;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      const fwd = sol.theta2;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.sin(fwd - 0.4) * 12, ey - Math.cos(fwd - 0.4) * 12);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.sin(fwd + 0.4) * 12, ey - Math.cos(fwd + 0.4) * 12);
      ctx.stroke();
      ctx.restore();
    }

    // Angle arcs
    arc(ox, oy, -Math.PI / 2 - p.theta1, -Math.PI / 2, 46, "rgba(255,210,122,0.9)", "θ₁");
    if (!sol.tir) {
      arc(ox, oy, Math.PI / 2, Math.PI / 2 + sol.theta2, 46, "rgba(122,217,238,0.9)", "θ₂");
    }

    // Origin dot
    ctx.fillStyle = "#f2f5ff";
    ctx.beginPath(); ctx.arc(ox, oy, 4, 0, Math.PI * 2); ctx.fill();

    // TIR banner
    if (sol.tir) {
      ctx.fillStyle = "rgba(255, 107, 138, 0.95)";
      ctx.font = "700 15px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(i18nText("refractionTIR", "Total internal reflection"), ox, oy - 12 - L);
    }
  }

  function updateReadouts(p, sol) {
    out.theta2.textContent = sol.tir ? "—" : (sol.theta2 * 180 / Math.PI).toFixed(1) + "°";
    out.critical.textContent = sol.critical === null ? "—" : (sol.critical * 180 / Math.PI).toFixed(1) + "°";
    out.reflect.textContent = (sol.R * 100).toFixed(1) + "%";
    out.transmit.textContent = ((1 - sol.R) * 100).toFixed(1) + "%";
    out.regime.textContent = sol.tir
      ? i18nText("refractionRegimeTIR", "TIR")
      : (p.n2 > p.n1 ? i18nText("refractionRegimeInto", "Bending toward normal")
                     : i18nText("refractionRegimeOut", "Bending away from normal"));
    // Phase speed in medium 2 as a fraction of c.
    out.speed.textContent = (C_LIGHT / p.n2 / 1e8).toFixed(2) + "×10⁸ m/s";
  }

  function updateLabels(p) {
    inputValues.angle.textContent = String(Math.round(p.theta1 * 180 / Math.PI));
    inputValues.n1.textContent = p.n1.toFixed(2);
    inputValues.n2.textContent = p.n2.toFixed(2);
  }

  let raf = 0;
  let prevTir = false;
  function frame() {
    raf = requestAnimationFrame(frame);
    const p = readParams();
    const sol = solve(p);
    // A bright glassy "ping" the moment the ray tips into total internal
    // reflection — the physically meaningful threshold.
    if (sol.tir && !prevTir) {
      window.SFX?.tone({ freq: 1320, dur: 0.16, type: "sine", gain: 0.16, release: 0.22 });
      window.SFX?.tone({ freq: 1980, dur: 0.12, type: "sine", gain: 0.08, release: 0.18 });
    }
    prevTir = sol.tir;
    render(p, sol, performance.now() / 1000);
    updateReadouts(p, sol);
  }
  function start() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  // ── Drag the incident ray angle ────────────────────────────────────────
  let dragging = false;
  function angleFromPointer(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W - originX();
    const y = ((clientY - rect.top) / rect.height) * H - originY();
    // Incident ray lives in the upper half; measure its angle from the
    // upward normal, clamped to 0..89°.
    const ang = Math.atan2(x, -y);          // 0 = straight up
    const deg = Math.max(0, Math.min(89, Math.abs(ang) * 180 / Math.PI));
    return deg;
  }
  stage.addEventListener("pointerdown", (e) => {
    dragging = true;
    stage.setPointerCapture(e.pointerId);
    inputs.angle.value = String(Math.round(angleFromPointer(e.clientX, e.clientY)));
    updateLabels(readParams());
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    inputs.angle.value = String(Math.round(angleFromPointer(e.clientX, e.clientY)));
    updateLabels(readParams());
  });
  const endDrag = () => { dragging = false; };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // ── Wiring ─────────────────────────────────────────────────────────────
  // Manually moving an index slider means the media no longer match any
  // preset — clear the stale highlight.
  const clearPresetActive = () =>
    presetList.querySelectorAll(".mol-btn").forEach((b) => b.classList.remove("active"));
  Object.values(inputs).forEach((el) =>
    el.addEventListener("input", () => {
      if (el !== inputs.angle) clearPresetActive();
      updateLabels(readParams());
    }));

  presetList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pre = PRESETS[btn.dataset.key];
      if (!pre) return;
      inputs.n1.value = String(pre.n1);
      inputs.n2.value = String(pre.n2);
      window.SFX?.tone({ freq: 660, dur: 0.09, type: "triangle", gain: 0.12 });
      presetList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b === btn));
      updateLabels(readParams());
    });
  });

  resetBtn.addEventListener("click", () => {
    inputs.angle.value = "35";
    inputs.n1.value = "1.00";
    inputs.n2.value = "1.52";
    presetList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b.dataset.key === "airGlass"));
    updateLabels(readParams());
  });

  document.addEventListener("langchange", frame);

  function resizeCanvas() {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 320);
    H = 460;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  updateLabels(readParams());
  start();
})();
