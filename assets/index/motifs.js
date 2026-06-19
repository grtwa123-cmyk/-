/**
 * Procedural line-art glyphs drawn on each card's image block.
 *
 * Pure 2D canvas drawing — no Three.js, no DOM. Receives the 2D context,
 * a motif kind, a centre point in canvas coordinates, and a size factor.
 *
 * Each motif is intentionally a sketch (≤ ~15 strokes) so the cards read
 * as editorial illustrations rather than icons.
 */

const PRIMITIVES = (ctx) => ({
  dot:  (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); },
  circ: (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); },
  line: (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); },
  // Parabola: x ∈ [-a/2, a/2], y = (4t² + k) · b   where t = (i/N - 0.5)
  para: (a, b, k) => {
    ctx.beginPath();
    for (let i = 0; i <= 44; i++) {
      const t = i / 44, xx = (t - 0.5) * a;
      const yy = ((t - 0.5) * (t - 0.5) * 4 + k) * b;
      i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    }
    ctx.stroke();
  },
});

const RENDERERS = {
  projectile(p, s) {
    p.para(s * 2.2, s * 0.7, -1);
    p.dot(-s * 1.1, s * 0.7, 4); p.dot(s * 1.1, s * 0.7, 4);
  },
  wave(p, s, ctx) {
    // Two point sources radiating circular wavefronts that meet in the
    // middle — denser rings + solid strokes so the eye registers the
    // overlap as interference, not just two icons placed side by side.
    const left  = { x: -s * 0.95, y: 0 };
    const right = { x:  s * 0.95, y: 0 };
    ctx.save();
    ctx.lineWidth = 1.4;
    for (let k = 1; k <= 5; k++) {
      const a = 0.72 - k * 0.11;
      ctx.strokeStyle = `rgba(180, 224, 255, ${a})`;
      p.circ(left.x,  left.y,  s * 0.32 * k);
      p.circ(right.x, right.y, s * 0.32 * k);
    }
    // Two short central fringe segments — the visual signature of
    // constructive interference where wavefronts coincide.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 2.2;
    p.line(0, -s * 0.18, 0, s * 0.18);
    ctx.restore();
    // Source dots
    p.dot(left.x,  left.y,  5);
    p.dot(right.x, right.y, 5);
  },

  doppler(p, s, ctx) {
    // Moving source: rings centred at past emission points along the
    // motion axis. Spacing compresses to the right (direction of motion)
    // and stretches to the left — the Doppler signature at a glance.
    const cx = s * 0.55;          // current source position (heading right)
    ctx.save();
    ctx.lineWidth = 1.4;
    // Past emission points, regular emission rate but shifted by motion
    const v = 0.55;               // Mach-like fraction
    const T = s * 0.32;           // base radius increment
    for (let k = 1; k <= 4; k++) {
      const a = 0.75 - k * 0.13;
      ctx.strokeStyle = `rgba(255, 200, 160, ${a})`;
      // Each ring's centre = cx − v · k · T (where the source was)
      p.circ(cx - v * k * T, 0, T * k);
    }
    // Motion arrow ahead of the source
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.8;
    p.line(cx,  0, cx + s * 0.45, 0);
    p.line(cx + s * 0.45, 0, cx + s * 0.30, -s * 0.10);
    p.line(cx + s * 0.45, 0, cx + s * 0.30,  s * 0.10);
    ctx.restore();
    // Source dot
    p.dot(cx, 0, 6);
  },
  pendulum(p, s, ctx) {
    p.line(-s * 0.95, -s * 0.85, s * 0.95, -s * 0.85);
    const a = 0.42;
    p.line(0, -s * 0.85, Math.sin(a) * s * 1.55, -s * 0.85 + Math.cos(a) * s * 1.55);
    p.dot(Math.sin(a) * s * 1.55, -s * 0.85 + Math.cos(a) * s * 1.55, 8);
    ctx.strokeStyle = "rgba(255,255,255,0.30)"; ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(0, -s * 0.85, s * 1.55, Math.PI / 2 - 0.55, Math.PI / 2 + 0.55);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  cannon(p, s, ctx) {
    ctx.beginPath();
    ctx.arc(0, s * 2.9, s * 2.6, -Math.PI * 0.78, -Math.PI * 0.22);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= 44; i++) {
      const t = i / 44, xx = (t - 0.5) * s * 2.3;
      const yy = ((t - 0.5) * (t - 0.5) * 3.5 - 0.95) * s * 0.75;
      i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    }
    ctx.stroke();
    p.dot(s * 1.15, s * 0.65, 4);
  },
  orbit(p, s, ctx) {
    ctx.beginPath();
    ctx.ellipse(s * 0.18, 0, s * 1.4, s * 0.85, 0, 0, Math.PI * 2);
    ctx.stroke();
    p.dot(-s * 0.5, 0, 7); p.dot(s * 1.45, s * 0.05, 4);
  },
  impact(p, s, ctx) {
    p.line(-s * 0.5, -s * 1.0, -s * 0.5, s * 0.7);
    p.line( s * 0.5, -s * 1.0,  s * 0.5, s * 0.7);
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, s * 0.7);
    ctx.quadraticCurveTo(0, s * 1.25, s * 0.5, s * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.7, s * 0.3, s * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  },
  solar(p, s) {
    p.dot(0, 0, 8);
    for (let k = 1; k <= 3; k++) {
      p.circ(0, 0, s * 0.5 * k);
      const a = k * 0.7 + 0.2;
      p.dot(Math.cos(a) * s * 0.5 * k, Math.sin(a) * s * 0.5 * k, 4);
    }
  },
  solarsystem(p, s, ctx) {
    ctx.save(); ctx.scale(1, 0.4);
    p.dot(0, 0, 9);
    for (let k = 1; k <= 4; k++) p.circ(0, 0, s * 0.4 * k);
    ctx.restore();
    for (let k = 1; k <= 4; k++) {
      const a = k * 0.85;
      p.dot(Math.cos(a) * s * 0.4 * k, Math.sin(a) * s * 0.4 * k * 0.4, 4);
    }
  },
  blackhole(_, s, ctx) {
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(0, s * 0.08, s * 1.32, s * 0.38, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = "rgba(255,255,255,0.78)";
  },
  semi(p, s) {
    for (let k = -1; k <= 1; k++) {
      p.line(-s * 1.25, k * s * 0.5, s * 1.25, k * s * 0.5);
      for (let i = 0; i < 6; i++) p.dot(-s * 1.05 + i * s * 0.42, k * s * 0.5 - s * 0.16, 2.2);
    }
  },
  diode(p, s, ctx) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, -s * 0.6);
    ctx.lineTo(s * 0.2, 0);
    ctx.lineTo(-s * 0.8, s * 0.6);
    ctx.closePath();
    ctx.stroke();
    p.line(s * 0.2, -s * 0.7, s * 0.2, s * 0.7);
    p.line(-s * 1.4, 0, -s * 0.8, 0);
    p.line(s * 0.2, 0, s * 1.4, 0);
  },
  molecule(p, s) {
    const r = s * 0.24;
    const A = { x: 0, y: 0 };
    const B = { x: s * 0.95, y: -s * 0.7 };
    const C = { x: s * 0.95, y:  s * 0.7 };
    const D = { x: -s * 1.1, y: 0 };
    p.line(A.x, A.y, B.x, B.y); p.line(A.x, A.y, C.x, C.y); p.line(A.x, A.y, D.x, D.y);
    p.circ(A.x, A.y, r * 1.3); p.circ(B.x, B.y, r); p.circ(C.x, C.y, r); p.circ(D.x, D.y, r);
  },
  crystal(p, s) {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const px = i * s * 0.72, py = j * s * 0.72;
        if (i < 1) p.line(px, py, px + s * 0.72, py);
        if (j < 1) p.line(px, py, px, py + s * 0.72);
      }
    }
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) p.dot(i * s * 0.72, j * s * 0.72, 4.5);
    }
  },
};

export function drawMotif(ctx, kind, cx, cy, s) {
  const render = RENDERERS[kind];
  if (!render) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.fillStyle   = "rgba(255,255,255,0.92)";
  ctx.lineWidth   = 1.8;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur  = 8;
  render(PRIMITIVES(ctx), s, ctx);
  ctx.shadowBlur  = 0;
  ctx.restore();
}
