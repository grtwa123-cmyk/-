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
  dna(p, s, ctx) {
    // Two intertwined sinusoidal strands + colored base discs at each
    // crossing. Tuned so the helix fills the card without crowding the
    // title — three full turns left-to-right, sampled densely so the
    // strands read as ribbon curves rather than polylines.
    const span = s * 1.8;
    const amp  = s * 0.36;
    const turns = 3;
    const segs = 64;
    const x0 = -span / 2;
    ctx.save();

    // Strand A
    ctx.strokeStyle = "rgba(232, 200, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const x = x0 + span * t;
      const y = Math.sin(t * Math.PI * turns) * amp;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    // Strand B (antiparallel offset by π)
    ctx.strokeStyle = "rgba(255, 200, 240, 0.85)";
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const x = x0 + span * t;
      const y = Math.sin(t * Math.PI * turns + Math.PI) * amp;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    // Rungs + colored base discs at peaks/troughs
    const baseColors = ["#ff8aa3", "#ffcf6e", "#7be0d0", "#c79bff"];
    const pairs = 6;
    ctx.lineWidth = 1.2;
    for (let k = 0; k < pairs; k++) {
      const t = (k + 0.5) / pairs;
      const x = x0 + span * t;
      const yA = Math.sin(t * Math.PI * turns) * amp;
      const yB = Math.sin(t * Math.PI * turns + Math.PI) * amp;
      ctx.strokeStyle = "rgba(255, 240, 255, 0.45)";
      p.line(x, yA, x, yB);
      ctx.fillStyle = baseColors[k % 4];
      p.dot(x, yA, 3.6);
      ctx.fillStyle = baseColors[(k + 2) % 4];
      p.dot(x, yB, 3.6);
    }
    ctx.restore();
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

  titration(p, s, ctx) {
    // Burette tip above, one falling drop, Erlenmeyer flask below with a
    // liquid line — the whole titration story in a glance.
    p.line(-s * 0.12, -s * 1.55, -s * 0.12, -s * 0.85);
    p.line( s * 0.12, -s * 1.55,  s * 0.12, -s * 0.85);
    p.line(-s * 0.12, -s * 0.85, 0, -s * 0.62);
    p.line( s * 0.12, -s * 0.85, 0, -s * 0.62);
    p.dot(0, -s * 0.38, 3.6);                     // the drop
    ctx.beginPath();
    ctx.moveTo(-s * 0.26, -s * 0.10);
    ctx.lineTo( s * 0.26, -s * 0.10);
    ctx.lineTo( s * 0.26,  s * 0.30);
    ctx.lineTo( s * 0.92,  s * 1.30);
    ctx.lineTo(-s * 0.92,  s * 1.30);
    ctx.lineTo(-s * 0.26,  s * 0.30);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 170, 220, 0.85)";
    p.line(-s * 0.60, s * 0.86, s * 0.60, s * 0.86);   // pink liquid line
  },

  gas(p, s, ctx) {
    // Piston chamber (open right) with a plate + rod, particles inside.
    const w = s * 1.9, h = s * 1.5;
    const x0 = -s * 1.15, y0 = -h / 2;
    ctx.beginPath();
    ctx.moveTo(x0 + w, y0);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0, y0 + h);
    ctx.lineTo(x0 + w, y0 + h);
    ctx.stroke();
    const px = x0 + w * 0.74;                     // piston plate
    ctx.lineWidth = 3.4;
    p.line(px, y0 + 3, px, y0 + h - 3);
    ctx.lineWidth = 1.8;
    p.line(px, 0, x0 + w + s * 0.45, 0);          // rod
    p.line(x0 + w + s * 0.45, -s * 0.20, x0 + w + s * 0.45, s * 0.20);
    p.dot(x0 + w * 0.16, -h * 0.22, 3.4);         // particles
    p.dot(x0 + w * 0.42,  h * 0.05, 3.4);
    p.dot(x0 + w * 0.24,  h * 0.28, 3.4);
    p.dot(x0 + w * 0.58, -h * 0.26, 3.4);
    p.dot(x0 + w * 0.60,  h * 0.24, 3.4);
  },

  refraction(p, s, ctx) {
    // Interface (horizontal) + dashed normal + incident/refracted ray
    // bending toward the normal, as air → glass.
    p.line(-s * 1.3, 0, s * 1.3, 0);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.setLineDash([3, 4]);
    p.line(0, -s * 1.15, 0, s * 1.15);
    ctx.restore();
    // Incident ray from upper-left to origin (steep), refracted ray
    // continues into lower medium at a smaller angle from the normal.
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    p.line(-s * 0.95, -s * 1.0, 0, 0);
    p.line(0, 0, s * 0.42, s * 1.05);
    // Faint reflected ray
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    p.line(0, 0, s * 0.95, -s * 1.0);
    ctx.restore();
  },

  decay(p, s, ctx) {
    // A falling exponential curve with a few nuclei dropping off it.
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = (-0.5 + t) * s * 2.4;
      const y = (0.85 - Math.pow(0.5, t * 3.2) * 1.7) * s;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    p.dot(-s * 1.0, -s * 0.72, 4);
    p.dot(-s * 0.3, -s * 0.18, 3.4);
    p.dot(s * 0.35, s * 0.5, 3);
    // A couple of decayed ones peeling away downward
    ctx.save();
    ctx.globalAlpha = 0.5;
    p.dot(s * 0.1, s * 0.95, 2.6);
    p.dot(s * 0.7, s * 1.0, 2.4);
    ctx.restore();
  },

  lotka(p, s, ctx) {
    // Two out-of-phase population waves (prey leading, predator trailing).
    const span = s * 2.4, x0 = -span / 2, amp = s * 0.5;
    const wave = (phase, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const x = x0 + span * t;
        const y = -Math.sin(t * Math.PI * 2 + phase) * amp;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    wave(0, "rgba(123,224,208,0.9)");            // prey
    wave(Math.PI * 0.5, "rgba(255,138,163,0.9)"); // predator, quarter-cycle behind
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
