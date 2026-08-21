import { browser, chk, rows, BASE, serveCdn, finish } from '../lib/harness.mjs';

/*
 * The black hole, measured off its own pixels.
 *
 * This page is badged "Integrated" and it earns it: the fragment shader
 * leapfrogs a null geodesic per pixel through a = −3M h² x / r⁵, the vector
 * form of the Binet equation u'' + u = 3Mu². Nothing about the picture is
 * drawn — the photon ring, the disk wrapping over the top and under the
 * bottom, the shadow — all of it is where the rays went.
 *
 * Which means the shadow has a size that theory fixes exactly, and no part
 * of this page is told what it is. A photon reaches the hole if its impact
 * parameter is under the critical one,
 *
 *     b_c = 3√3 M ≈ 5.196 M
 *
 * so a camera at distance D sees a dark disc of angular radius sin θ = b_c/D.
 * The suite renders, finds the edge of that disc in the scanline, converts
 * pixels back to an angle through the camera's own field of view, and
 * multiplies by D. What comes out should be 5.196, and it should be 5.196
 * from every distance and for every mass.
 *
 * Measurements are taken at the Low preset, with the camera exactly in the
 * disk's plane. Neither is to make them easy.
 *
 * Low is the only preset with bloom switched off, and bloom spills the photon
 * ring's light into the shadow until there is no edge left to find — at
 * Medium the edge finder returns nothing at all. Low switches off FXAA too,
 * which would smear the same edge. The physics is identical; the step count
 * and the resolution are what change.
 *
 * A pitch of exactly zero puts the scanned row in the equatorial plane, and
 * there the disk disappears from it completely — measured, the row's mean
 * luminance is the same to four decimals whether the disk is at gain 0, 1 or
 * 3. That is not a bug and it is worth knowing why: the disk is registered
 * by rays *crossing* the plane, `p.y * pn.y < 0`, and a ray travelling in the
 * plane has p.y ≡ 0 and never crosses. So along that one row the hole is a
 * clean silhouette against the star field, with no disk light near the edge
 * to argue with. It is the best seat in the house for this measurement.
 */

const B_CRIT = 3 * Math.sqrt(3);   // 5.19615…
const TAU = 0.03;                  // "any light at all", against a shadow of none

const ctx = await browser.newContext({ viewport: { width: 1000, height: 780 } });
await serveCdn(ctx);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${BASE}/experiments/blackhole.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__bh, null, { timeout: 60000 });
chk('the renderer builds and three.js arrived', errs.length === 0, errs.slice(0, 1).join(''));

await page.evaluate(() => { window.__bh.preset('low'); window.__bh.setPitch(0); });

/*
 * The edge of the shadow, to sub-pixel precision.
 *
 * Inside the shadow there is not darkness, there is nothing: no ray that
 * crosses the horizon comes back with anything on it. So walking outward
 * from the centre, the first pixel carrying any light at all is the edge,
 * and the crossing is interpolated between it and its neighbour. A half-
 * maximum threshold was tried first and is worse — the photon ring has
 * structure, and half of a local peak lands somewhere inside it.
 */
function edgeFrom(lum, centre, dir) {
  const last = dir > 0 ? lum.length - 1 : 0;
  for (let i = centre; dir > 0 ? i < last : i > last; i += dir) {
    const a = lum[i], b = lum[i + dir];
    if (a < TAU && b >= TAU) return i + dir * (TAU - a) / (b - a);
  }
  return NaN;
}

/** Render at this mass and distance and return the impact parameter, in M. */
async function shadow(M, D) {
  const r = await page.evaluate(([m, d]) => {
    window.__bh.setM(m);
    window.__bh.setDist(d);
    return { s: window.__bh.state(), ...window.__bh.scanRow() };
  }, [M, D]);
  const centre = Math.round((r.width - 1) / 2);
  const px = (edgeFrom(r.lum, centre, +1) - edgeFrom(r.lum, centre, -1)) / 2;
  // The shader builds its ray as normalize(fwd + tanHalfFov·(ndc.x·right +
  // ndc.y·up)) with ndc scaled by the buffer *height*, so a horizontal
  // offset of px pixels is an angle of atan(tanHalfFov · 2px/height).
  const theta = Math.atan(r.s.tanHalfFov * 2 * px / r.height);
  return {
    px, theta, dist: r.s.dist,
    b: r.s.dist * Math.sin(theta) / r.s.M,
    // Two different questions about the same row. "lit" is whether a ray
    // came back with anything at all, which separates sky from a shadow and
    // from a ray that ran out of steps. "mean" is how much light, which is
    // what the disk changes. They are not interchangeable: the shader's
    // gamma of 1/2.2 lifts a linear thousandth to 0.047, so the faintest
    // nebula counts as lit and the lit fraction barely moves when the disk
    // goes out.
    lit: r.lum.filter((v) => v > TAU).length / r.width,
    mean: r.lum.reduce((a, b) => a + b, 0) / r.width,
  };
}

// ── 3√3, read out of the image ────────────────────────────────────────────
{
  const at = [];
  for (const D of [15, 20, 30, 45, 60, 90, 120]) at.push([D, await shadow(1, D)]);
  const bs = at.map(([, m]) => m.b);
  const mean = bs.reduce((a, b) => a + b, 0) / bs.length;
  const shown = at.map(([D, m]) => `${D}M:${m.b.toFixed(3)}`).join(' ');

  chk('the shadow measures 3√3 M across — the critical impact parameter, off the pixels',
      Math.abs(mean - B_CRIT) / B_CRIT < 0.02,
      `mean b = ${mean.toFixed(3)} M against ${B_CRIT.toFixed(3)} — ${shown}`);

  const wild = at.filter(([, m]) => Math.abs(m.b - B_CRIT) / B_CRIT > 0.04);
  chk('and it measures the same from every distance, near or far',
      wild.length === 0,
      wild.map(([D, m]) => `${D}M gives ${m.b.toFixed(3)}`).join(', ') || shown);
}

// ── the shadow scales with the mass, and with nothing else ────────────────
{
  // Hold D/M fixed so the angular size should not move at all: the only
  // length in the problem is M, so the picture is the same picture.
  const out = [];
  for (const M of [0.5, 0.7, 1.0, 1.4, 1.8]) out.push([M, await shadow(M, 40 * M)]);
  const bs = out.map(([, m]) => m.b);
  const spread = (Math.max(...bs) - Math.min(...bs)) / (bs.reduce((a, b) => a + b, 0) / bs.length);
  chk('b is proportional to M and to nothing else — the same picture at every mass',
      spread < 0.005,
      `${out.map(([M, m]) => `M=${M}:${m.b.toFixed(4)}`).join(' ')} — spread ${(spread * 100).toFixed(2)}%`);

  // And at a fixed distance, a heavier hole covers more sky.
  const light = await shadow(0.7, 40);
  const heavy = await shadow(1.4, 40);
  chk('so doubling the mass at a fixed distance doubles the angle it subtends',
      Math.abs(heavy.theta / light.theta - 2) < 0.06,
      `${(heavy.theta / light.theta).toFixed(3)}× the angle for 2× the mass`);
}

// ── pulling back ──────────────────────────────────────────────────────────
{
  const seq = [];
  for (const D of [20, 40, 80, 120]) seq.push(await shadow(1, D));
  let shrinks = true;
  for (let i = 1; i < seq.length; i++) if (seq[i].theta >= seq[i - 1].theta) shrinks = false;
  chk('and pulling the camera back makes it smaller on the sky, every time',
      shrinks, seq.map((m) => `${m.dist}M:${(m.theta * 180 / Math.PI).toFixed(2)}°`).join(' '));

  /*
   * Far out, most of the frame should be sky. The geodesic loop leaves a ray
   * dark when it runs out of steps, which is right for the winding orbits
   * near the photon sphere it was written for and wrong everywhere else: at
   * 120 M nearly every ray ran out of budget while still travelling almost
   * straight, and the shadow measured 7.86 M against 5.196 — half again too
   * wide — with no edge at all left to find at 150. Rays past 8M and heading
   * outward now escape to the sky, which is what they do.
   */
  const far = await shadow(1, 120);
  chk('the sky is still there at maximum zoom, not a frame of exhausted rays',
      far.lit > 0.5, `${(far.lit * 100).toFixed(0)}% of the scanline carries light`);
}

// ── the disk is the disk ──────────────────────────────────────────────────
{
  // Tilted off the plane for this one, for the reason in the header: in the
  // plane the disk is invisible to the row and the control would look dead.
  await page.evaluate(() => { window.__bh.setPitch(0.12); window.__bh.setDisk(1); });
  const on = await shadow(1, 30);
  await page.evaluate(() => window.__bh.setDisk(0));
  const off = await shadow(1, 30);
  await page.evaluate(() => { window.__bh.setDisk(1); window.__bh.setPitch(0); });
  chk('turning the disk off takes the bright band with it, and leaves the stars',
      off.mean < on.mean * 0.5 && off.lit > 0.4,
      `mean luminance ${on.mean.toFixed(3)} with the disk, ${off.mean.toFixed(3)} without;`
      + ` ${(off.lit * 100).toFixed(0)}% of the row still carries sky`);
}

// ── the badge, and the chrome ─────────────────────────────────────────────
{
  chk('the page is badged integrated, which is what a geodesic per pixel is',
      await page.locator('.method-tag[data-method="integrated"]').count() === 1);

  // This page has no h1 — it is full-bleed, and its name lives in <title>.
  const title = () => page.evaluate(() => document.title.trim());
  const en = await title();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(400);
  const ko = await title();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(400);
  const zh = await title();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(400);
  chk('title translates en/ko/zh and returns',
      en !== ko && ko !== zh && (await title()) === en, `${en} / ${ko} / ${zh}`);

  const missing = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
    .filter((el) => el.textContent.trim() === el.dataset.i18n).map((el) => el.dataset.i18n));
  chk('every data-i18n key resolves', missing.length === 0, missing.slice(0, 3).join(', '));
}

chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log('=== blackhole ===');
let f = 0;
for (const r of rows) { if (!r.ok) f++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok || !r.d ? '' : '  ::  ' + r.d}`); }
console.log(`\n${rows.length - f}/${rows.length} passed`);
await finish('blackhole');
process.exit(f ? 1 : 0);
