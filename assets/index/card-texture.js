/**
 * Procedural card texture used as a Three.js CanvasTexture on the wall.
 *
 * Each card is a single off-screen <canvas>: dark page-coloured margins so
 * labels float over the wall, a gradient + grain + motif image block, and
 * an editorial header / footer (CATEGORY · NN/12 · TAGS · OPEN →).
 *
 * The total catalogue size is small (12 cards), so we re-render the entire
 * canvas on language change — simpler than juggling separate text layers.
 */

import { drawMotif } from "./motifs.js";

const CARD_W = 540;
const CARD_H = 652;
const IMG_X = 14, IMG_Y = 64;
const IMG_W = CARD_W - 28;
const IMG_H = 470;

const TITLE_FONT = '700 46px -apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
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
 * @param {object} exp           Experiment metadata from EXPERIMENTS catalogue
 * @param {number} index         Position in the catalogue (for the NN/12 label)
 * @param {number} total         Total catalogue size
 * @param {(key:string)=>string} t  Translator (e.g. i18n.t)
 * @returns {HTMLCanvasElement}
 */
export function makeCard(exp, index, total, t) {
  const c = document.createElement("canvas");
  c.width = CARD_W; c.height = CARD_H;
  const x = c.getContext("2d");

  // Page-coloured margins — labels feel like they float on the wall.
  x.fillStyle = "#0a0a0d";
  x.fillRect(0, 0, CARD_W, CARD_H);

  // 1) Diagonal gradient inside the image block
  const ang = ((exp.cat.charCodeAt(0) + index * 17) % 90 - 45) * Math.PI / 180;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const g = x.createLinearGradient(
    IMG_X + IMG_W / 2 - dx * IMG_W, IMG_Y + IMG_H / 2 - dy * IMG_H,
    IMG_X + IMG_W / 2 + dx * IMG_W, IMG_Y + IMG_H / 2 + dy * IMG_H,
  );
  g.addColorStop(0, exp.colors[0]);
  g.addColorStop(1, exp.colors[1]);
  roundRect(x, IMG_X, IMG_Y, IMG_W, IMG_H, 6);
  x.fillStyle = g; x.fill();

  // 2) Vignette + grain + motif + title — clipped to the rounded image block
  x.save();
  roundRect(x, IMG_X, IMG_Y, IMG_W, IMG_H, 6);
  x.clip();

  const rg = x.createRadialGradient(
    IMG_X + IMG_W / 2, IMG_Y + IMG_H * 0.4, IMG_H * 0.1,
    IMG_X + IMG_W / 2, IMG_Y + IMG_H / 2,   IMG_H * 0.85,
  );
  rg.addColorStop(0, "rgba(0,0,0,0)");
  rg.addColorStop(1, "rgba(0,0,0,0.6)");
  x.fillStyle = rg;
  x.fillRect(IMG_X, IMG_Y, IMG_W, IMG_H);

  const im = x.getImageData(IMG_X, IMG_Y, IMG_W, IMG_H);
  const d  = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 20;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(im, IMG_X, IMG_Y);

  if (exp.motif) {
    drawMotif(x, exp.motif, IMG_X + IMG_W / 2, IMG_Y + IMG_H * 0.32, IMG_H * 0.21);
  }

  x.fillStyle = "#fff";
  x.textAlign = "left";
  x.font = TITLE_FONT;
  wrapText(x, t(exp.titleKey), IMG_X + 22, IMG_Y + IMG_H - 30, IMG_W - 44, 50);
  x.restore();

  // 3) Image block hairline
  x.strokeStyle = "rgba(255,255,255,0.08)";
  x.lineWidth = 1;
  roundRect(x, IMG_X, IMG_Y, IMG_W, IMG_H, 6);
  x.stroke();

  // 4) Header: CATEGORY · NN/TT
  const catKey = exp.cat === "Physics" ? "categoryPhysics" : "categoryChemistry";
  const cat = (t(catKey) || exp.cat).toUpperCase();
  x.font = META_FONT;
  x.fillStyle = "rgba(243,241,234,0.85)";
  x.textAlign = "left";
  x.fillText(cat, 16, 44);
  x.textAlign = "right";
  x.fillStyle = "rgba(138,138,147,0.9)";
  x.fillText(
    String(index + 1).padStart(2, "0") + " / " + String(total).padStart(2, "0"),
    CARD_W - 16, 44,
  );

  // 5) Footer: TAGS … OPEN →
  x.textAlign = "left";
  x.fillStyle = "rgba(138,138,147,0.95)";
  x.font = TAG_FONT;
  let tx = 16;
  for (const tag of exp.tags) {
    x.fillText(tag, tx, CARD_H - 22);
    tx += x.measureText(tag).width + 18;
  }
  x.textAlign = "right";
  x.fillStyle = "rgba(243,241,234,0.85)";
  x.fillText("OPEN →", CARD_W - 16, CARD_H - 22);

  return c;
}
