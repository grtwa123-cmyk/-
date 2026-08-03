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

  electrolysis(p, s, ctx) {
    // Beaker with two electrodes and rising bubbles (H₂ side busier).
    const w = s * 1.8, h = s * 1.4;
    const x0 = -w / 2, y0 = -s * 0.3;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - s * 0.35);
    ctx.lineTo(x0, y0 + h);
    ctx.lineTo(x0 + w, y0 + h);
    ctx.lineTo(x0 + w, y0 - s * 0.35);
    ctx.stroke();
    // Water line
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    p.line(x0, y0, x0 + w, y0);
    ctx.restore();
    // Electrodes
    ctx.lineWidth = 3.2;
    p.line(x0 + w * 0.3, y0 + s * 0.15, x0 + w * 0.3, y0 + h - s * 0.15);
    p.line(x0 + w * 0.7, y0 + s * 0.15, x0 + w * 0.7, y0 + h - s * 0.15);
    ctx.lineWidth = 1.8;
    // Bubbles: cathode (left) twice as many
    p.dot(x0 + w * 0.30, y0 + s * 0.35, 2.4);
    p.dot(x0 + w * 0.25, y0 + s * 0.62, 2.0);
    p.dot(x0 + w * 0.34, y0 + s * 0.85, 2.2);
    p.dot(x0 + w * 0.36, y0 + s * 0.15, 1.8);
    p.dot(x0 + w * 0.70, y0 + s * 0.45, 2.2);
    p.dot(x0 + w * 0.66, y0 + s * 0.80, 1.9);
    // Wires up to a source
    p.line(x0 + w * 0.3, y0 + s * 0.15, x0 + w * 0.3, y0 - s * 0.85);
    p.line(x0 + w * 0.7, y0 + s * 0.15, x0 + w * 0.7, y0 - s * 0.85);
    p.line(x0 + w * 0.3, y0 - s * 0.85, x0 + w * 0.7, y0 - s * 0.85);
  },

  kinetics(p, s, ctx) {
    // Two particles on a collision course + an energy barrier hump the
    // pair must clear — collision theory in one glyph.
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = (-0.5 + t) * s * 2.4;
      const y = s * 0.9 - Math.exp(-Math.pow((t - 0.5) * 3.4, 2)) * s * 1.5;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    // Reactant pair (left) and product (right)
    p.dot(-s * 1.05, s * 0.55, 5.5);
    p.dot(-s * 0.78, s * 0.72, 5.5);
    p.dot(s * 0.95, s * 0.62, 7);
    // Arrow over the barrier
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.setLineDash([3, 4]);
    p.line(-s * 0.75, s * 0.35, -s * 0.15, -s * 0.42);
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

  // Hydrogen spectrum: crowding energy rungs on the left, emission lines right.
  // Photoelectric: a beam striking a plate, electrons flying off it.
  photoelectric(p, s) {
    // Incoming light, drawn as three converging rays.
    for (let i = -1; i <= 1; i++) {
      p.line(-s * 1.7, s * i * 0.42, -s * 0.34, s * i * 0.16);
    }
    // The metal plate.
    p.line(-s * 0.3, -s * 1.0, -s * 0.3, s * 1.0);
    // Ejected electrons scattering to the upper right.
    p.dot(s * 0.28, -s * 0.62, 3.2);
    p.dot(s * 0.92, -s * 0.24, 3.2);
    p.dot(s * 0.62, s * 0.5, 2.8);
    p.line(-s * 0.22, -s * 0.3, s * 0.86, -s * 0.32);
    p.line(-s * 0.22, s * 0.16, s * 0.56, s * 0.44);
  },

  // Resonance: the amplitude curve A/X₀ = 1/√((1−r²)²+(2ζr)²) for ζ = 0.12,
  // drawn from the real expression, with the peak marked and the drive line
  // standing on it.
  resonance(p, s) {
    const A = (r) => 1 / Math.hypot(1 - r * r, 2 * 0.12 * r);
    const peak = A(Math.sqrt(1 - 2 * 0.12 * 0.12));
    const X = (r) => s * (r * 1.15 - 1.55);
    const Y = (g) => s * (0.95 - 1.85 * (g / peak));
    for (let i = 0; i < 46; i++) {
      const r0 = (i / 46) * 2.7, r1 = ((i + 1) / 46) * 2.7;
      p.line(X(r0), Y(A(r0)), X(r1), Y(A(r1)));
    }
    p.line(-s * 1.6, s * 0.95, s * 1.6, s * 0.95);          // frequency axis
    p.dot(X(Math.sqrt(1 - 2 * 0.12 * 0.12)), Y(peak), 3.4); // the peak
    p.line(X(1), s * 0.95, X(1), Y(peak) - s * 0.12);       // f₀
  },

  // Lens: a biconvex outline with the two rays that define an image — the
  // one arriving parallel leaving through the far focus, and the one through
  // the centre carrying straight on. They cross where the image is.
  lens(p, s, ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.05);
    ctx.quadraticCurveTo(s * 0.42, 0, 0, s * 1.05);
    ctx.quadraticCurveTo(-s * 0.42, 0, 0, -s * 1.05);
    ctx.stroke();
    p.line(-s * 1.8, 0, s * 1.8, 0);                 // optical axis
    p.line(-s * 1.35, -s * 0.62, 0, -s * 0.62);      // parallel in
    p.line(0, -s * 0.62, s * 1.5, s * 0.7);          // out through the far focus
    p.line(-s * 1.35, -s * 0.62, s * 1.5, s * 0.7);  // straight through the centre
    p.line(-s * 1.35, 0, -s * 1.35, -s * 0.62);      // object
    p.line(s * 0.9, 0, s * 0.9, s * 0.42);           // image, where they cross
    p.dot(s * 0.9, s * 0.42, 3.2);
    p.dot(s * 0.62, 0, 2.6);                         // focus
    p.dot(-s * 0.62, 0, 2.6);
  },

  // Diffraction: a slit mask on the left, and the fringe pattern it throws —
  // bar heights follow the real (sin α/α)²·cos²β with a = d/3, so the third
  // order is missing exactly as it should be.
  diffraction(p, s) {
    for (const y of [-0.95, -0.32, 0.32, 0.95]) {
      p.line(-s * 1.5, s * y, -s * 1.5, s * (y + (y < 0 ? 0.42 : -0.42)));
    }
    for (let m = -4; m <= 4; m++) {
      const beta = (Math.PI / 3) * m;                    // d·sinθ = mλ
      const al = beta / 3;                               // a = d/3
      const env = al === 0 ? 1 : Math.sin(al) / al;
      const h = env * env;                               // cos²β = 1 at maxima
      if (h < 0.012) continue;                           // the missing order
      const x = s * (m * 0.36 + 0.3);
      p.line(x, s * 0.95, x, s * (0.95 - 1.75 * h));
    }
    p.line(-s * 0.42, s * 0.95, s * 1.72, s * 0.95);
    p.dot(-s * 1.5, 0, 3);
  },

  // Enzyme kinetics: the Michaelis–Menten hyperbola drawn from the real
  // expression, with Kₘ marked at the half-maximum and Vmax as the asymptote.
  neuron(p, s, ctx) {
    // A real action potential: the same Hodgkin-Huxley equations the page
    // integrates, run once at build time here so the glyph is the curve
    // rather than a hand-drawn impression of one.
    const aM=V=>Math.abs(V+40)<1e-6?1:0.1*(V+40)/(1-Math.exp(-(V+40)/10));
    const bM=V=>4*Math.exp(-(V+65)/18);
    const aH=V=>0.07*Math.exp(-(V+65)/20);
    const bH=V=>1/(1+Math.exp(-(V+35)/10));
    const aN=V=>Math.abs(V+55)<1e-6?0.1:0.01*(V+55)/(1-Math.exp(-(V+55)/10));
    const bN=V=>0.125*Math.exp(-(V+65)/80);
    let V=-65, m=0.053, h=0.596, n=0.318;
    const pts=[], dt=0.01;
    for (let i=0;i<2200;i++){
      const tt=i*dt, I=tt<0.5?25:0;
      const dV=(I-120*m*m*m*h*(V-50)-36*n*n*n*n*(V+77)-0.3*(V+54.387));
      const dm=aM(V)*(1-m)-bM(V)*m, dh=aH(V)*(1-h)-bH(V)*h, dn=aN(V)*(1-n)-bN(V)*n;
      V+=dV*dt; m+=dm*dt; h+=dh*dt; n+=dn*dt;
      if (i%12===0) pts.push([tt, V]);
    }
    const X=(tt)=>s*(-1.55+(tt/22)*3.1);
    const Y=(v)=>s*(0.85-((v+90)/150)*1.7);
    for (let i=1;i<pts.length;i++) p.line(X(pts[i-1][0]),Y(pts[i-1][1]),X(pts[i][0]),Y(pts[i][1]));
    p.line(-s*1.55, s*0.85, s*1.6, s*0.85);              // time axis
    p.line(-s*1.55, s*0.85, -s*1.55, -s*0.9);            // voltage axis
    ctx.save();
    ctx.setLineDash([3, 4]);
    p.line(-s*1.55, Y(-65), s*1.6, Y(-65));              // resting potential
    ctx.restore();
    ctx.setLineDash([]);
  },

  equilibrium(p, s, ctx) {
    // Two opposed arrows of unequal length: the reaction runs both ways at
    // once, and the position of the equilibrium is which way runs harder.
    const arrow = (x0, x1, y) => {
      p.line(x0, y, x1, y);
      const dir = Math.sign(x1 - x0), head = s * 0.22;
      p.line(x1, y, x1 - dir * head, y - head * 0.62);
      p.line(x1, y, x1 - dir * head, y + head * 0.62);
    };
    arrow(-s * 1.15, s * 1.15, -s * 0.34);        // forward, longer
    arrow(s * 0.72, -s * 1.15, s * 0.34);         // reverse, shorter
    p.dot(-s * 1.42, -s * 0.34, s * 0.15);        // A + B on the left
    p.dot(-s * 1.42, s * 0.34, s * 0.15);
    p.circ(s * 1.42, 0, s * 0.24);                // C on the right
    ctx.save();
    ctx.setLineDash([3, 4]);
    p.line(0, -s * 0.95, 0, s * 0.95);            // the balance point
    ctx.restore();
    ctx.setLineDash([]);
  },

  standing(p, s, ctx) {
    // The first three modes between two fixed ends, drawn from the sine each
    // one actually is — so the glyph shows why only whole numbers fit.
    const half = (n, yScale, from, to) => {
      const steps = 60;
      for (let i = 0; i < steps; i++) {
        const u0 = i / steps, u1 = (i + 1) / steps;
        p.line(from + (to - from) * u0, yScale * Math.sin(Math.PI * n * u0),
               from + (to - from) * u1, yScale * Math.sin(Math.PI * n * u1));
      }
    };
    half(1, -s * 0.72, -s * 1.3, s * 1.3);
    half(2, -s * 0.42, -s * 1.3, s * 1.3);
    half(3, -s * 0.24, -s * 1.3, s * 1.3);
    p.line(-s * 1.3, -s * 1.0, -s * 1.3, s * 1.0);      // the fixed ends
    p.line(s * 1.3, -s * 1.0, s * 1.3, s * 1.0);
    p.dot(-s * 1.3, 0, s * 0.11);
    p.dot(s * 1.3, 0, s * 0.11);
  },

  phases(p, s, ctx) {
    // Ordered on the left, disordered on the right: the same particles, and
    // the only difference between the two halves is temperature.
    const rows = [-0.62, 0, 0.62];
    rows.forEach((ry, r) => {
      for (let c = 0; c < 3; c++) {
        const x = -s * (1.28 - c * 0.44) + (r % 2) * s * 0.22;
        p.dot(x, ry * s, s * 0.13);                    // lattice
      }
    });
    const loose = [[0.42, -0.74], [0.95, -0.36], [0.5, 0.12], [1.24, 0.32],
                   [0.72, 0.78], [1.32, -0.86]];
    for (const [dx, dy] of loose) p.circ(dx * s, dy * s, s * 0.13);
    ctx.save();
    ctx.setLineDash([3, 4]);
    p.line(s * 0.16, -s * 1.05, s * 0.16, s * 1.05);   // the transition
    ctx.restore();
    ctx.setLineDash([]);
  },

  enzyme(p, s, ctx) {
    const Km = 0.8;
    const V = (S) => S / (Km + S);
    const X = (S) => s * (S * 0.62 - 1.5);
    const Y = (v) => s * (0.92 - 1.8 * v);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * 4.6, b = ((i + 1) / 40) * 4.6;
      p.line(X(a), Y(V(a)), X(b), Y(V(b)));
    }
    p.line(-s * 1.5, s * 0.92, s * 1.6, s * 0.92);       // [S] axis
    p.line(-s * 1.5, s * 0.92, -s * 1.5, -s * 0.95);     // v axis
    ctx.save();
    ctx.setLineDash([3, 4]);
    p.line(-s * 1.5, Y(1), s * 1.6, Y(1));               // Vmax asymptote
    p.line(X(Km), s * 0.92, X(Km), Y(0.5));              // Kₘ at half-maximum
    ctx.restore();
    ctx.setLineDash([]);
    p.dot(X(Km), Y(0.5), 3.4);
  },

  // Natural selection: a logistic sweep from rare to fixed, with a finite
  // population drifting either side of the deterministic curve.
  selection(p, s) {
    const X = (t) => s * t * 1.5;
    const Y = (t) => s * (0.92 - 1.84 / (1 + Math.exp(-4.4 * t)));
    for (let i = 0; i < 16; i++) {
      const a = -1 + (2 * i) / 16, b = -1 + (2 * (i + 1)) / 16;
      p.line(X(a), Y(a), X(b), Y(b));
    }
    p.line(-s * 1.5, s * 0.92, s * 1.5, s * 0.92);      // generation axis
    p.line(-s * 1.5, s * 0.92, -s * 1.5, -s * 0.92);    // frequency axis
    const drift = [[-0.72, -0.16], [-0.3, 0.2], [0.06, -0.22], [0.42, 0.18], [0.8, 0.12]];
    for (const [t, dy] of drift) p.dot(X(t), Y(t) + s * dy, 3.2);
  },

  // Circuits: one loop, a cell on the left, a zigzag resistor across the top,
  // and carriers drifting back along the return wire.
  circuit(p, s) {
    const zig = [[-0.46, -0.86], [-0.33, -1.16], [-0.11, -0.56],
                 [0.11, -1.16], [0.33, -0.56], [0.46, -0.86]];
    for (let i = 1; i < zig.length; i++) {
      p.line(s * zig[i - 1][0], s * zig[i - 1][1], s * zig[i][0], s * zig[i][1]);
    }
    p.line(-s * 1.4, -s * 0.86, -s * 0.46, -s * 0.86);   // top rail, left of it
    p.line(s * 0.46, -s * 0.86, s * 1.4, -s * 0.86);     // top rail, right of it
    p.line(s * 1.4, -s * 0.86, s * 1.4, s * 0.86);       // far side
    p.line(s * 1.4, s * 0.86, -s * 1.4, s * 0.86);       // return wire
    p.line(-s * 1.4, -s * 0.86, -s * 1.4, -s * 0.24);    // up to the + plate
    p.line(-s * 1.4, s * 0.24, -s * 1.4, s * 0.86);      // down from the − plate
    p.line(-s * 1.7, -s * 0.24, -s * 1.1, -s * 0.24);    // long plate  (+)
    p.line(-s * 1.56, s * 0.24, -s * 1.24, s * 0.24);    // short plate (−)
    p.dot(-s * 0.6, s * 0.86, 3.2);
    p.dot(s * 0.1, s * 0.86, 3.2);
    p.dot(s * 0.8, s * 0.86, 3.2);
  },

  spectra(p, s) {
    // Rungs bunch toward the top the way 1/n² levels do.
    for (let n = 1; n <= 5; n++) {
      const t = (1 - 1 / (n * n)) / (1 - 1 / 25);      // 0 at n=1, 1 at n=5
      const y = s * (1.0 - 1.85 * t);
      p.line(-s * 1.55, y, -s * 0.6, y);
    }
    // The electron dropping between two rungs.
    p.line(-s * 1.07, -s * 0.5, -s * 1.07, s * 0.98);
    p.dot(-s * 1.07, s * 0.98, 3.4);
    // Emission lines of differing strength, standing on a baseline.
    const lx = [0.2, 0.6, 1.0, 1.45];
    const lh = [0.9, 0.55, 0.75, 0.4];
    for (let i = 0; i < lx.length; i++) {
      p.line(s * lx[i], s * (0.95 - lh[i] * 1.6), s * lx[i], s * 0.95);
    }
    p.line(s * 0.05, s * 0.95, s * 1.6, s * 0.95);
  },

  atom(p, s, ctx) {
    // Bohr atom: nucleus dot + two tilted elliptical shells with electrons.
    ctx.save();
    for (let k = 0; k < 2; k++) {
      ctx.save();
      ctx.rotate(k * Math.PI / 2 + 0.3);
      ctx.strokeStyle = "rgba(150, 190, 255, 0.7)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.25, s * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Electrons on the shells
    ctx.fillStyle = "rgba(140, 190, 255, 0.95)";
    p.dot(Math.cos(0.3) * s * 1.25, Math.sin(0.3) * s * 0.5, 3.4);
    p.dot(-Math.cos(1.87) * s * 0.5, -Math.sin(1.87) * s * 1.25, 3.4);
    // Nucleus — a small red/grey cluster
    ctx.fillStyle = "rgba(255, 107, 138, 0.95)";
    p.dot(-2, -1, 4.5);
    ctx.fillStyle = "rgba(154, 163, 189, 0.9)";
    p.dot(3, 2, 4);
    ctx.restore();
  },

  generator(p, s, ctx) {
    // Bar magnet (N red / S blue) inside an elliptical coil loop.
    ctx.save();
    ctx.strokeStyle = "rgba(255, 225, 74, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.3, s * 0.72, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Magnet, tilted
    ctx.rotate(-0.5);
    const L = s * 1.5, w = s * 0.5;
    ctx.fillStyle = "rgba(110, 168, 255, 0.9)";
    ctx.fillRect(-L / 2, -w / 2, L / 2, w);
    ctx.fillStyle = "rgba(255, 107, 138, 0.9)";
    ctx.fillRect(0, -w / 2, L / 2, w);
    ctx.restore();
    // A little rotation arrow
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.95, -0.6, 0.8);
    ctx.stroke();
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
