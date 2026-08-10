/**
 * Procedural Liquid-Glass card texture used as a Three.js CanvasTexture
 * on the wall.
 *
 * The entire card is ONE liquid-glass surface — no dark page frame, no
 * inset image block. The canvas starts fully transparent so the corners
 * of the rounded card fade into the scene; everything inside the rounded
 * shape is the glass.
 *
 * Layer order (back → front):
 *   1. Per-card diagonal colour gradient — the tinted "wall" behind glass
 *   2. Soft radial vignette (subtle — lets the colour show through)
 *   3. Faint grain ("frost" microtexture)
 *   4. Translucent white pane (≈7% white) for the milky frosted look
 *   5. Inset specular at the top edge
 *   6. Inset shade at the bottom edge
 *   7. Motif with a soft white aura behind it
 *   8. Title at the lower portion
 *   9. Header (CATEGORY · NN / TT) at the top edge
 *  10. Footer (TAGS · OPEN →) at the bottom edge
 *  11. Two-tone hairline ring (brighter top, dimmer bottom)
 *
 * Every highlight is white-only — when the rest-state shader on main.js
 * desaturates the texture, the icy frost survives and the only thing
 * that re-tints on hover is the per-card colour gradient underneath.
 */

import { drawMotif } from "./motifs.js";

const CARD_W = 540;
const CARD_H = 652;
const CARD_R = 28;                        // soft iOS-style corner

// Padding from the card edge for header / motif / title / footer rows
const EDGE   = 22;                        // text safe-area from the rounded edge
const HEADER_Y = 44;                      // baseline for CATEGORY row
const FOOTER_Y = CARD_H - 26;             // baseline for TAGS row

// Pretendard first, for the reason given in index.css: this file wraps the
// title by measuring it, so the face has to be the same one everywhere or the
// line count changes from machine to machine. Chinese has no Pretendard
// coverage and falls through to the system CJK faces.
const TITLE_STACK = '"Pretendard Variable",Pretendard,system-ui,-apple-system,'
  + '"Segoe UI","Apple SD Gothic Neo","Noto Sans KR","Noto Sans SC","PingFang SC",'
  + '"Microsoft YaHei",sans-serif';
const TITLE_FONT = `700 50px ${TITLE_STACK}`;
const META_FONT  = '600 17px ui-monospace,"SF Mono",Consolas,monospace';
const TAG_FONT   = '500 15px ui-monospace,"SF Mono",Consolas,monospace';

/**
 * Canvas text does not reflow when a webfont arrives — whatever face was
 * available at draw time is baked into the bitmap. Callers await this before
 * their first paint, and the wall repaints again if it resolves late.
 *
 * `text` is what the cards are about to draw, and passing it is what keeps the
 * request honest. Pretendard ships as two files split by unicode-range
 * (index.css), and a face is fetched only when a character it declares is
 * used — but drawing into a canvas does not count as usage, so on this page
 * nothing would ask for either of them. Priming with a fixed sample instead
 * would have to contain a Hangul character to cover the Korean wall, and then
 * every English reader would pay 400 KB for a face their titles never touch.
 * Ask for the actual titles and each language fetches exactly its own halves.
 */
export function titleFontReady(text = "A") {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return document.fonts.load(TITLE_FONT, text).catch(() => {});
}

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
  // Split on spaces first; any single token wider than the card (CJK
  // titles contain no spaces at all) falls back to character-level
  // wrapping so e.g. "理想气体与分子运动论" can't overflow the edge.
  const words = [];
  for (const w of (text || "").split(/\s+/)) {
    if (ctx.measureText(w).width <= maxW) {
      words.push(w);
      continue;
    }
    let chunk = "";
    for (const ch of w) {
      if (chunk && ctx.measureText(chunk + ch).width > maxW) {
        words.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    if (chunk) words.push(chunk);
  }
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

  // 0) Canvas starts fully transparent. The rounded card shape is the
  //    only opaque region — corners outside the round fade into the wall.
  x.clearRect(0, 0, CARD_W, CARD_H);

  // 1) Diagonal colour gradient filling the entire rounded card —
  //    the tinted backdrop behind the glass.
  const ang = ((exp.cat.charCodeAt(0) + index * 17) % 90 - 45) * Math.PI / 180;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const g = x.createLinearGradient(
    CARD_W / 2 - dx * CARD_W, CARD_H / 2 - dy * CARD_H,
    CARD_W / 2 + dx * CARD_W, CARD_H / 2 + dy * CARD_H,
  );
  g.addColorStop(0, exp.colors[0]);
  g.addColorStop(1, exp.colors[1]);

  // Clip everything that follows to the rounded card shape.
  x.save();
  roundRect(x, 0, 0, CARD_W, CARD_H, CARD_R);
  x.clip();

  x.fillStyle = g;
  x.fillRect(0, 0, CARD_W, CARD_H);

  // 2) Subtle radial vignette — pushes attention to the centre without
  //    overpowering the colour (lower α than before).
  const rg = x.createRadialGradient(
    CARD_W / 2, CARD_H * 0.40, CARD_H * 0.10,
    CARD_W / 2, CARD_H * 0.50, CARD_H * 0.85,
  );
  rg.addColorStop(0, "rgba(0,0,0,0)");
  rg.addColorStop(1, "rgba(0,0,0,0.38)");
  x.fillStyle = rg;
  x.fillRect(0, 0, CARD_W, CARD_H);

  // 3) Frost grain — slight microtexture so the glass doesn't look
  //    plastic.
  const im = x.getImageData(0, 0, CARD_W, CARD_H);
  const d  = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 12;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(im, 0, 0);

  // 4) Translucent white pane — the milky frosted-glass layer. Dialled
  //    down from 0.10 to 0.07 so the colour reads through more clearly.
  x.fillStyle = "rgba(255,255,255,0.07)";
  x.fillRect(0, 0, CARD_W, CARD_H);

  // 5) Inset specular at the top edge — a horizon line of light.
  const spec = x.createLinearGradient(0, 0, 0, CARD_H * 0.30);
  spec.addColorStop(0,    "rgba(255,255,255,0.26)");
  spec.addColorStop(0.45, "rgba(255,255,255,0.06)");
  spec.addColorStop(1,    "rgba(255,255,255,0)");
  x.fillStyle = spec;
  x.fillRect(0, 0, CARD_W, CARD_H * 0.30);

  // 6) Inset shade at the bottom edge — gives the surface weight.
  const shade = x.createLinearGradient(0, CARD_H * 0.78, 0, CARD_H);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.20)");
  x.fillStyle = shade;
  x.fillRect(0, CARD_H * 0.78, CARD_W, CARD_H * 0.22);

  // 7) Motif — drawn on the glass with a soft aura behind for lift.
  if (exp.motif) {
    const mx = CARD_W / 2;
    const my = CARD_H * 0.36;
    const ms = CARD_H * 0.16;
    const aura = x.createRadialGradient(mx, my, ms * 0.2, mx, my, ms * 2.4);
    aura.addColorStop(0, "rgba(255,255,255,0.10)");
    aura.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = aura;
    x.beginPath();
    x.arc(mx, my, ms * 2.4, 0, Math.PI * 2);
    x.fill();
    drawMotif(x, exp.motif, mx, my, ms);
  }

  // 8) Title — large, low-contrast white with a soft shadow for
  //    legibility over the gradient.
  x.save();
  x.shadowColor = "rgba(0,0,0,0.55)";
  x.shadowBlur = 8;
  x.fillStyle = "rgba(255,255,255,0.96)";
  x.textAlign = "left";
  x.font = TITLE_FONT;
  wrapText(x, t(exp.titleKey), EDGE, CARD_H * 0.80, CARD_W - EDGE * 2, 54);
  x.restore();

  // 9) Header: CATEGORY · NN / TT — drawn ON the glass with a thin
  //    text-shadow so it stays legible against any backdrop colour.
  const catKey = exp.cat === "Physics"
    ? "categoryPhysics"
    : exp.cat === "Chemistry"
      ? "categoryChemistry"
      : exp.cat === "Biology"
        ? "categoryBiology"
        : "categoryPhysics";
  const cat = (t(catKey) || exp.cat).toUpperCase();

  x.save();
  x.shadowColor = "rgba(0,0,0,0.45)";
  x.shadowBlur = 4;
  x.font = META_FONT;
  x.fillStyle = "rgba(255,255,255,0.92)";
  x.textAlign = "left";
  x.fillText(cat, EDGE, HEADER_Y);
  x.textAlign = "right";
  x.fillStyle = "rgba(255,255,255,0.78)";
  x.fillText(
    String(index + 1).padStart(2, "0") + " / " + String(total).padStart(2, "0"),
    CARD_W - EDGE, HEADER_Y,
  );
  x.restore();

  // 10) Footer: TAGS · OPEN →
  x.save();
  x.shadowColor = "rgba(0,0,0,0.45)";
  x.shadowBlur = 4;
  x.textAlign = "left";
  x.fillStyle = "rgba(255,255,255,0.82)";
  x.font = TAG_FONT;
  let tx = EDGE;
  for (const tag of exp.tags) {
    x.fillText(tag, tx, FOOTER_Y);
    tx += x.measureText(tag).width + 18;
  }
  x.textAlign = "right";
  x.fillStyle = "rgba(255,255,255,0.92)";
  x.fillText("OPEN →", CARD_W - EDGE, FOOTER_Y);
  x.restore();

  x.restore(); // end card clip

  // 11) Two-tone hairline ring — bright top, dim bottom — completes
  //     the "catching light from above" cue.
  x.save();
  x.lineWidth = 1.4;
  const ring = x.createLinearGradient(0, 0, 0, CARD_H);
  ring.addColorStop(0,    "rgba(255,255,255,0.52)");
  ring.addColorStop(0.45, "rgba(255,255,255,0.14)");
  ring.addColorStop(1,    "rgba(0,0,0,0.32)");
  x.strokeStyle = ring;
  roundRect(x, 0.7, 0.7, CARD_W - 1.4, CARD_H - 1.4, CARD_R - 0.7);
  x.stroke();
  x.restore();

  return c;
}
