import fs from 'node:fs';
import path from 'node:path';
import { browser, chk, rows, BASE, ROOT, serveCdn, finish } from '../lib/harness.mjs';

/*
 * The Solar System tour.
 *
 * This page was badged "Integrated" — the equations of motion are stepped
 * forward in time, what you see is where they go — and that is not what it
 * does. Every body's angle is a closed form:
 *
 *     a = phase + simDays / period * 2π
 *     pos = (cos a · orbitR, 0, −sin a · orbitR)
 *
 * Uniform circular motion, read off a formula. Nothing is integrated but the
 * clock. There is no gravity in the file and no Kepler's third law to find:
 * the orbit radii are 30, 44, 58, 74, 106, 142, 178, 210, which put Neptune
 * seven times further out than Mercury where the sky puts it seventy-seven
 * times. They are drawn to fit a screen.
 *
 * So the badge is now "Real data" — a three-dimensional structure built from
 * measured constants, geometry rather than simulation — which is exactly what
 * this is, and the constants really are measured. The suite holds them to the
 * sky, one by one, and then holds the motion to the periods those constants
 * claim. What it does not do is look for physics the page never had.
 */

// Sidereal orbital periods in days, and equatorial diameters in Earths.
// IAU/NASA planetary fact sheet values.
const SKY = {
  mercury: { period: 87.969, ratio: 0.383, tilt: 0.03, retrograde: false },
  venus:   { period: 224.701, ratio: 0.949, tilt: 177.36, retrograde: true },
  earth:   { period: 365.256, ratio: 1.000, tilt: 23.44, retrograde: false },
  mars:    { period: 686.980, ratio: 0.532, tilt: 25.19, retrograde: false },
  jupiter: { period: 4332.59, ratio: 11.209, tilt: 3.13, retrograde: false },
  saturn:  { period: 10759.2, ratio: 9.449, tilt: 26.73, retrograde: false },
  uranus:  { period: 30685.4, ratio: 4.007, tilt: 97.77, retrograde: true },
  neptune: { period: 60189.0, ratio: 3.883, tilt: 28.32, retrograde: false },
};
const MOON_PERIOD = 27.32;   // sidereal month, days
const SUN_RATIO = 109.2;     // solar diameter in Earths

const ctx = await browser.newContext({ viewport: { width: 1280, height: 960 } });
await serveCdn(ctx);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${BASE}/experiments/solarsystem.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ss, null, { timeout: 60000 });
chk('the tour builds and three.js arrived', errs.length === 0, errs.slice(0, 1).join(''));

const bodies = await page.evaluate(() => window.__ss.bodies());
const by = Object.fromEntries(bodies.map((b) => [b.id, b]));

// ── the constants, against the sky ────────────────────────────────────────
{
  const off = [];
  for (const [id, real] of Object.entries(SKY)) {
    const got = by[id];
    if (!got) { off.push(`${id} missing`); continue; }
    /*
     * Half a day, or a tenth of a percent, whichever is the larger. These
     * are transcriptions rather than measurements, so the tolerance only has
     * to cover how the numbers were written down, and they were written down
     * two ways. The table stores whole days, which puts Venus at 225 against
     * a sidereal 224.701 — a tenth of a percent alone rejects that, and the
     * rounding is not an error. At the other end the sources disagree in the
     * last digits: NASA's fact sheet gives Uranus a sidereal period of
     * 30685.4 days and an orbital period of 30687, and the table took the
     * second. A day and a half in eighty-four years is not a claim worth
     * arbitrating here.
     */
    const slack = Math.max(0.5, real.period * 0.001);
    if (Math.abs(got.period - real.period) > slack) {
      off.push(`${id} ${got.period} d vs ${real.period}`);
    }
  }
  chk('every orbital period is the sidereal one, to within how it was written down',
      off.length === 0, off.join(', '));

  const bad = [];
  for (const [id, real] of Object.entries(SKY)) {
    if (Math.abs(by[id].ratio - real.ratio) > 0.011) {
      bad.push(`${id} ${by[id].ratio}× vs ${real.ratio}×`);
    }
  }
  chk('and every diameter is the measured one, in Earths', bad.length === 0, bad.join(', '));

  chk('the Sun included, at 109 Earths across',
      Math.abs(by.sun.ratio - SUN_RATIO) < 0.1, `${by.sun.ratio}× vs ${SUN_RATIO}×`);

  const tilts = [];
  for (const [id, real] of Object.entries(SKY)) {
    if (Math.abs(by[id].tilt - real.tilt) > 1) tilts.push(`${id} ${by[id].tilt}° vs ${real.tilt}°`);
  }
  chk('axial tilts too, within a degree of the real obliquity',
      tilts.length === 0, tilts.join(', '));

  // Venus and Uranus are the two that turn the other way, and they are the
  // two the table must not get wrong: a retrograde flag on Mars would be a
  // fact about the solar system, invented.
  const spin = [];
  for (const [id, real] of Object.entries(SKY)) {
    const isRetro = by[id].rotDir < 0;
    if (isRetro !== real.retrograde) spin.push(`${id} ${isRetro ? 'retrograde' : 'prograde'}`);
  }
  chk('and exactly Venus and Uranus turn backwards, as they do', spin.length === 0, spin.join(', '));
}

// ── the motion, measured off the positions ────────────────────────────────
/** The angle of a body about the Sun, in the tour's own plane. */
const angles = (days) => page.evaluate((d) => {
  window.__ss.setDays(d);
  const p = window.__ss.positions();
  const out = {};
  for (const [id, q] of Object.entries(p)) out[id] = Math.atan2(-q.z, q.x);
  return out;
}, days);

{
  // A quarter of Earth's year should turn Earth a quarter turn. Do it for
  // every planet against its own period, which is the claim the table makes.
  const a0 = await angles(0);
  const wrong = [];
  for (const id of Object.keys(SKY)) {
    const quarter = SKY[id].period / 4;
    const a1 = (await angles(quarter))[id];
    let d = a1 - a0[id];
    while (d < 0) d += Math.PI * 2;
    while (d > Math.PI * 2) d -= Math.PI * 2;
    if (Math.abs(d - Math.PI / 2) > 0.02) {
      wrong.push(`${id} ${(d * 180 / Math.PI).toFixed(1)}°`);
    }
  }
  chk('a quarter of a planet\'s year turns it a quarter of the way round',
      wrong.length === 0, wrong.join(', '));

  // And a whole year brings it back. This is the check that would notice a
  // period the table states and the motion ignores.
  const home = [];
  for (const id of Object.keys(SKY)) {
    const a1 = (await angles(SKY[id].period))[id];
    let d = Math.abs(a1 - a0[id]);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d > 0.01) home.push(`${id} off by ${(d * 180 / Math.PI).toFixed(2)}°`);
  }
  chk('and a whole year puts every one of them back where it started',
      home.length === 0, home.join(', '));

  // Everything goes the same way round, which is the one thing the real
  // system does that this one could get wrong for free.
  const back = [];
  for (const id of Object.keys(SKY)) {
    const step = SKY[id].period / 100;
    const a1 = (await angles(step))[id];
    let d = a1 - a0[id];
    while (d < -Math.PI) d += Math.PI * 2;
    while (d > Math.PI) d -= Math.PI * 2;
    if (d <= 0) back.push(id);
  }
  chk('all eight orbit the same way about the Sun', back.length === 0, back.join(', '));
}

{
  // The Moon is on its own clock, and it is the sidereal month.
  const a0 = await angles(0);
  const half = await angles(MOON_PERIOD / 2);
  const full = await angles(MOON_PERIOD);
  const rel = (a, ref) => {
    let d = a - ref;
    while (d < 0) d += Math.PI * 2;
    return d;
  };
  // Measured about the Earth, not the Sun, so take the moon's offset from it.
  const off = await page.evaluate((P) => {
    const at = (d) => { window.__ss.setDays(d); const p = window.__ss.positions();
      return Math.atan2(-(p.moon.z - p.earth.z), p.moon.x - p.earth.x); };
    return [at(0), at(P / 2), at(P)];
  }, MOON_PERIOD);
  const halfTurn = rel(off[1], off[0]);
  let back = Math.abs(off[2] - off[0]);
  if (back > Math.PI) back = Math.PI * 2 - back;
  chk('half a sidereal month puts the Moon on the far side of the Earth',
      Math.abs(halfTurn - Math.PI) < 0.02, `${(halfTurn * 180 / Math.PI).toFixed(1)}° of 180°`);
  chk('and a whole one brings it back — 27.32 days, not 29.5',
      back < 0.01, `off by ${(back * 180 / Math.PI).toFixed(2)}°`);
  void a0; void half; void full;
}

// ── what the reader is told ───────────────────────────────────────────────
{
  await page.evaluate(() => window.__ss.setDays(400));
  const text = await page.evaluate(() => window.__ss.elapsedText());
  // The first number only: past a year the readout adds "(1.1 yr)" beside
  // the day count, and stripping every non-digit welds the two into 4001.1.
  const n = parseFloat((String(text).match(/[\d,]+(?:\.\d+)?/) || ['NaN'])[0].replace(/,/g, ''));
  chk('the elapsed readout counts the days the tour has run',
      Math.abs(n - 400) <= 1, `"${text}" at 400 days`);

  await page.evaluate(() => window.__ss.select('jupiter'));
  await page.waitForTimeout(200);
  const card = await page.evaluate(() => window.__ss.card());
  const shown = parseFloat((card.diameter || '').replace(/[^0-9.]/g, ''));
  chk('and the card gives a planet its real size beside the Earth',
      Math.abs(shown - SKY.jupiter.ratio) < 0.02,
      `Jupiter card says ${shown}×, sky says ${SKY.jupiter.ratio}×`);
}

// ── the badge, and the claim it is not making any more ────────────────────
{
  chk('the page is badged real data, not integrated — nothing here is stepped forward',
      await page.locator('.method-tag[data-method="model"]').count() === 1
      && await page.locator('.method-tag[data-method="integrated"]').count() === 0);

  // The orbit radii are drawn to fit, and the page must not be read as a map.
  // If someone ever makes them proportional this check should be replaced by
  // one that measures it, not deleted.
  const src = fs.readFileSync(path.join(ROOT, 'experiments/solarsystem.js'), 'utf8');
  chk('and the source still says in the file that the orbits are not to scale',
      /not to scale|drawn to fit|압축|스케일이 아/i.test(src),
      'no note in solarsystem.js that the orbit radii are compressed');
}

// ── chrome ────────────────────────────────────────────────────────────────
{
  const title = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
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

console.log('=== solarsystem ===');
let f = 0;
for (const r of rows) { if (!r.ok) f++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok || !r.d ? '' : '  ::  ' + r.d}`); }
console.log(`\n${rows.length - f}/${rows.length} passed`);
await finish('solarsystem');
process.exit(f ? 1 : 0);
