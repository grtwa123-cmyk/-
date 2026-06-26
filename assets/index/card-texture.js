/**
 * Procedural Liquid-Glass card texture used as a Three.js CanvasTexture
 * on the wall.
 *
 * Each card is a single off-screen <canvas> built up in layers:
 *   1. Page-coloured frame so the labels float on the wall
 *   2. Per-card diagonal colour gradient (the tinted "wall behind glass")
 *   3. Soft radial vignette + faint grain (light noise — the "frost")
 *   4. NEW Liquid-Glass panel inset into the image block:
 *        – translucent white pane (≈10% alpha)
 *        – inset specular highlight at the top edge
 *        – inset shade band at the bottom edge
 *        – two-tone hairline ring (brighter top half, darker bottom)
 *        – soft drop shadow beneath the pane for "lift"
 *   5. Motif drawn on the glass pane with a gentle glow under it
 *   6. Title wrapped onto the bottom of the glass pane
 *   7. Editorial header (CATEGORY · NN / TT) and footer (TAGS · OPEN →)
 *
 * Every painted highlight is greyscale-safe — white@α stays white when
 * desaturated by the rest-state shader on main.js, so the icy frost look
 * survives the grayscale-at-rest treatment and only re-tints on hover.
 */

import { drawMotif } from "./motifs.js";

const CARD_W = 540;
const CARD_H = 652;
const IMG_X = 14, IMG_Y = 64;
const IMG_W = CARD_W - 28;
const IMG_H = 470;
const IMG_R = 18;                         // rounded image-block corners

// Inset for the inner glass pane — leaves a thin halo of tinted gradient
// visible around the pane so the eye reads a layered glass surface
// floating over coloured backdrop.
const PANE_PAD = 18;
const PANE_R   = 16;
const PANE_X = IMG_X + PANE_PAD;
const PANE_Y = IMG_Y + PANE_PAD;
const PANE_W = IMG_W - PANE_PAD * 2;
const PANE_H = IMG_H - PANE_PAD * 2;

const TITLE_FONT = '700 44px -apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const META_FONT  = '600 17px ui-monospace,"SF Mono",Consolas,monospace';
const TAG_FONT   = '500 15px ui-monospace,"SF Mono",Consolas,monospace';

export const CARD_SIZE = Object.freeze({ w: CARD_W, h: CARD_H });

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, baselineY, maxW, lineH) {
  const words = (text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  for (let i = lines.length - 1; i >= 0; i--) {
    ctx.fillText(lines[i], x, baselineY - (lines.length - 1 - i) * lineH);
  }
}

/**
 * @param {object} exp
 * @param {number} index
 * @param {number} total
 * @param {(key:string)=>string} t
 * @returns {HTMLCanvasElement}
 */
export function makeCard(exp, index, total, t) {
  const c = document.createElement("canvas");
  c.width = CARD_W; c.height = CARD_H;
  const x = c.getContext("2d");

  // 0) Page-coloured frame
  x.fillStyle = "#0a0a0d";
  x.fillRect(0, 0, CARD_W, CARD_H);

  // 1) Diagonal colour gradient inside the image block — the tinted wall
  //    that sits behind the glass pane.
  const ang = ((exp.cat.charCodeAt(0) + index * 17) % 90 - 45) * Math.PI / 180;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const g = x.createLinearGradient(
    IMG_X + IMG_W / 2 - dx * IMG_W, IMG_Y + IMG_H / 2 - dy * IMG_H,
    IMG_X + IMG_W / 2 + dx * IMG_W, IMG_Y + IMG_H / 2 + dy * IMG_H,
  );
  g.addColorStop(0, exp.colors[0]);
  g.addColorStop(1, exp.colors[1]);
  roundRect(x, IMG_X, IMG_Y, IMG_W, IMG_H, IMG_R);
  x.fillStyle = g; x.fill();

  // 2) Vignette + grain — clipped to the image block.
  x.save();
  roundRect(x, IMG_X, IMG_Y, IMG_W, IMG_H, IMG_R);
  x.clip();

  // Soft radial vignette — pushes attention into the centre of the pane.
  const rg = x.createRadialGradient(
    IMG_X + IMG_W / 2, IMG_Y + IMG_H * 0.4, IMG_H * 0.1,
    IMG_X + IMG_W / 2, IMG_Y + IMG_H / 2,   IMG_H * 0.85,
  );
  rg.addColorStop(0, "rgba(0,0,0,0)");
  rg.addColorStop(1, "rgba(0,0,0,0.55)");
  x.fillStyle = rg;
  x.fillRect(IMG_X, IMG_Y, IMG_W, IMG_H);

  // Frost grain — slightly subtler than before so the glass reads cleaner.
  const im = x.getImageData(IMG_X, IMG_Y, IMG_W, IMG_H);
  const d  = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(im, IMG_X, IMG_Y);

  // 3) Liquid-Glass pane — inset translucent white panel + specular +
  //    inset shade + two-tone hairline. Drawn while still clipped to the
  //    image block so the pane shadow doesn't bleed into the frame.

  // Soft drop shadow under the pane for visual lift.
  x.save();
  x.shadowColor = "rgba(0,0,0,0.45)";
  x.shadowBlur  = 22;
  x.shadowOffsetY = 6;
  roundRect(x, PANE_X, PANE_Y, PANE_W, PANE_H, PANE_R);
  x.fillStyle = "rgba(0,0,0,0.001)"; // shadow needs *something* filled
  x.fill();
  x.restore();

  // Translucent pane body — white@α. Compositing over the tinted
  // gradient gives the milky frosted-glass appearance, and stays white
  // when desaturated (rest state) so the glass look survives grayscale.
  roundRect(x, PANE_X, PANE_Y, PANE_W, PANE_H, PANE_R);
  x.fillStyle = "rgba(255,255,255,0.10)";
  x.fill();

  // Inset specular at the top edge — a horizon line of light. Clipped to
  // the pane so the highlight curls into the rounded corners.
  x.save();
  roundRect(x, PANE_X, PANE_Y, PANE_W, PANE_H, PANE_R);
  x.clip();

  const spec = x.createLinearGradient(0, PANE_Y, 0, PANE_Y + PANE_H * 0.32);
  spec.addColorStop(0,    "rgba(255,255,255,0.34)");
  spec.addColorStop(0.45, "rgba(255,255,255,0.08)");
  spec.addColorStop(1,    "rgba(255,255,255,0)");
  x.fillStyle = spec;
  x.fillRect(PANE_X, PANE_Y, PANE_W, PANE_H * 0.32);

  // Inset shade at the bottom edge — gives the pane weight.
  const shade = x.createLinearGradient(0, PANE_Y + PANE_H * 0.78, 0, PANE_Y + PANE_H);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.22)");
  x.fillStyle = shade;
  x.fillRect(PANE_X, PANE_Y + PANE_H * 0.78, PANE_W, PANE_H * 0.22);

  // 4) Motif — drawn inside the clipped pane so it always sits on glass.
  //    A soft white aura behind it lifts the strokes off the surface.
  if (exp.motif) {
    const mx = PANE_X + PANE_W / 2;
    const my = PANE_Y + PANE_H * 0.34;
    const ms = PANE_H * 0.20;
    const aura = x.createRadialGradient(mx, my, ms * 0.2, mx, my, ms * 2.2);
    aura.addColorStop(0, "rgba(255,255,255,0.12)");
    aura.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = aura;
    x.beginPath();
    x.arc(mx, my, ms * 2.2, 0, Math.PI * 2);
    x.fill();
    drawMotif(x, exp.motif, mx, my, ms);
  }

  // 5) Title — bottom of the pane, white with a hair of warmth so it
  //    reads as printed ink rather than glow.
  x.fillStyle = "#fff";
  x.textAlign = "left";
  x.font = TITLE_FONT;
  wrapText(x, t(exp.titleKey), PANE_X + 18, PANE_Y + PANE_H - 24, PANE_W - 36, 50);

  x.restore(); // end pane clip

  // 6) Pane hairline — brighter top half, dimmer bottom — completes the
  //    "catching light from above" cue.
  x.save();
  x.lineWidth = 1.2;
  const ring = x.createLinearGradient(0, PANE_Y, 0, PANE_Y + PANE_H);
  ring.addColorStop(0,   "rgba(255,255,255,0.55)");
  ring.addColorStop(0.5, "rgba(255,255,255,0.16)");
  ring.addColorStop(1,   "rgba(0,0,0,0.30)");
  x.strokeStyle = ring;
  roundRect(x, PANE_X + 0.5, PANE_Y + 0.5, PANE_W - 1, PANE_H - 1, PANE_R - 0.5);
  x.stroke();
  x.restore();

  x.restore(); // end image-block clip

  // 7) Outer image-block hairline — slim, dim, just to seal the frame.
  x.strokeStyle = "rgba(255,255,255,0.08)";
  x.lineWidth = 1;
  roundRect(x, IMG_X + 0.5, IMG_Y + 0.5, IMG_W - 1, IMG_H - 1, IMG_R);
  x.stroke();

  // 8) Header: CATEGORY · NN / TT
  const catKey = exp.cat === "Physics"
    ? "categoryPhysics"
    : exp.cat === "Chemistry"
      ? "categoryChemistry"
      : exp.cat === "Biology"
        ? "categoryBiology"
        : "categoryPhysics";
  const cat = (t(catKey) || exp.cat).toUpperCase();
  x.font = META_FONT;
  x.fillStyle = "rgba(243,241,234,0.88)";
  x.textAlign = "left";
  x.fillText(cat, 16, 44);
  x.textAlign = "right";
  x.fillStyle = "rgba(138,138,147,0.92)";
  x.fillText(
    String(index + 1).padStart(2, "0") + " / " + String(total).padStart(2, "0"),
    CARD_W - 16, 44,
  );

  // 9) Footer: TAGS · OPEN →
  x.textAlign = "left";
  x.fillStyle = "rgba(138,138,147,0.95)";
  x.font = TAG_FONT;
  let tx = 16;
  for (const tag of exp.tags) {
    x.fillText(tag, tx, CARD_H - 22);
    tx += x.measureText(tag).width + 18;
  }
  x.textAlign = "right";
  x.fillStyle = "rgba(243,241,234,0.88)";
  x.fillText("OPEN →", CARD_W - 16, CARD_H - 22);

  return c;
}
