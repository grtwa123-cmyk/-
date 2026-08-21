/*
 * Six crystal lattices, derived from their sites rather than read off a label.
 *
 * Like the DNA page this is badged "Real data", not "Measured": the cubic
 * cells are drawn from crystallography, not discovered by a simulation. The
 * claim that badge does make is that the structure on screen is the structure
 * the panel's numbers describe — and the page keeps those two halves in
 * separate places. LATTICES lists sites as coordinates, and states atoms per
 * cell, coordination number and packing fraction beside them as strings. A
 * mistyped "0.680", or a site at the wrong corner, looks exactly as convincing
 * as the right one.
 *
 * So all three are computed here from the coordinates alone, by the standard
 * crystallographic rules:
 *
 *   atoms per cell   share each site by how much of it lies inside the cell —
 *                    a corner is 1/8, an edge 1/4, a face 1/2, inside 1
 *   coordination     tile the cell in every direction and count the sites at
 *                    the nearest distance
 *   packing fraction those neighbours touch, so the radius is half that
 *                    distance: n·(4/3)πr³ over the cell volume
 *
 * The last one only means anything where every atom is the same size, so it
 * is claimed for the four monatomic lattices and not for rock salt or caesium
 * chloride, whose packing depends on two ionic radii this page never states.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/crystal.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const order = await page.evaluate(() => window.__crystal.order);
const LAT = {};
for (const k of order) LAT[k] = await page.evaluate((key) => window.__crystal.lattice(key), k);
chk(`all six lattices are exposed as coordinates — ${order.join(', ')}`,
    order.length === 6 && order.every((k) => LAT[k] && LAT[k].atoms.length > 0),
    order.map((k) => `${k}:${LAT[k]?.atoms.length}`).join(' '));

// ── The crystallography, computed from the sites ─────────────────────
const EPS = 1e-9;
const onBoundary = (v) => Math.abs(v) < EPS || Math.abs(v - 1) < EPS;

/** How much of each site lies inside the cell: 1/8 at a corner, 1 inside. */
function perCell(atoms) {
  const tally = {};
  for (const a of atoms) {
    const edges = [a.x, a.y, a.z].filter(onBoundary).length;
    tally[a.el] = (tally[a.el] || 0) + 1 / Math.pow(2, edges);
  }
  return tally;
}

/** The distinct sites of the infinite lattice, folded back into one cell. */
function unique(atoms) {
  const seen = new Map();
  for (const a of atoms) {
    const f = (v) => { const m = ((v % 1) + 1) % 1; return Math.abs(m - 1) < EPS ? 0 : m; };
    const p = [f(a.x), f(a.y), f(a.z)];
    seen.set(`${a.el}|${p.map((v) => v.toFixed(6)).join(',')}`, { el: a.el, p });
  }
  return [...seen.values()];
}

/** Nearest-neighbour distance and count, tiling the cell in every direction. */
function neighbours(atoms, from) {
  const cell = unique(atoms);
  const images = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    for (const s of cell) images.push({ el: s.el, p: [s.p[0] + i, s.p[1] + j, s.p[2] + k] });
  }
  const origin = cell.find((s) => (from ? s.el === from : true));
  let best = Infinity;
  const d = [];
  for (const q of images) {
    const r = Math.hypot(q.p[0] - origin.p[0], q.p[1] - origin.p[1], q.p[2] - origin.p[2]);
    if (r > EPS) { d.push({ r, el: q.el }); if (r < best) best = r; }
  }
  return { d: best, n: d.filter((q) => Math.abs(q.r - best) < 1e-6).length,
           el: origin.el, unlike: d.filter((q) => q.el !== origin.el) };
}

{
  const rows = [];
  for (const k of order) {
    const t = perCell(LAT[k].atoms);
    const total = Object.values(t).reduce((s, v) => s + v, 0);
    const declared = parseFloat(LAT[k].declared.atomsPerCell);
    rows.push({ k, total, declared, t, ok: Math.abs(total - declared) < 1e-6 });
  }
  chk('the atoms in each cell, shared out corner by corner, are the number the panel prints',
      rows.every((r) => r.ok),
      rows.map((r) => `${r.k} ${r.total}${r.ok ? '' : `≠${r.declared}`}`).join(', '));

  // The ionic cells say how the count splits between the two species.
  const nacl = perCell(LAT.nacl.atoms), cscl = perCell(LAT.cscl.atoms);
  chk('and rock salt really is four of each ion, caesium chloride one of each',
      Math.abs(nacl.Na - 4) < EPS && Math.abs(nacl.Cl - 4) < EPS
      && Math.abs(cscl.Cs - 1) < EPS && Math.abs(cscl.Cl - 1) < EPS,
      `NaCl ${nacl.Na} Na + ${nacl.Cl} Cl; CsCl ${cscl.Cs} Cs + ${cscl.Cl} Cl`);
}

{
  const rows = [];
  for (const k of order) {
    const nb = neighbours(LAT[k].atoms);
    // "6 : 6" for the ionic pair, a bare number otherwise.
    const declared = parseFloat(LAT[k].declared.coord);
    rows.push({ k, n: nb.n, d: nb.d, declared, ok: nb.n === declared });
  }
  chk('the nearest neighbours counted round a site are the coordination number',
      rows.every((r) => r.ok),
      rows.map((r) => `${r.k} ${r.n}${r.ok ? '' : `≠${r.declared}`} at ${r.d.toFixed(4)}a`).join(', '));

  // In an ionic lattice the neighbours are the *other* ion, which is what
  // makes 6 : 6 and 8 : 8 two numbers rather than one.
  const ionic = ['nacl', 'cscl'].map((k) => {
    const nb = neighbours(LAT[k].atoms);
    const nearest = nb.unlike.filter((q) => Math.abs(q.r - nb.d) < 1e-6).length;
    return { k, el: nb.el, n: nb.n, unlike: nearest };
  });
  chk('and in an ionic cell every one of them is the opposite ion',
      ionic.every((r) => r.unlike === r.n),
      ionic.map((r) => `${r.k}: ${r.unlike}/${r.n} round ${r.el}`).join(', '));
}

{
  /*
   * Packing fraction. Nearest neighbours touch, so each sphere has radius
   * half that distance — which is where 0.740 for close packing and the
   * famously empty 0.340 of diamond come from.
   */
  const MONATOMIC = ['sc', 'bcc', 'fcc', 'diamond'];
  const rows = MONATOMIC.map((k) => {
    const nb = neighbours(LAT[k].atoms);
    const n = Object.values(perCell(LAT[k].atoms)).reduce((s, v) => s + v, 0);
    const apf = (n * (4 / 3) * Math.PI * Math.pow(nb.d / 2, 3));
    const declared = parseFloat(LAT[k].declared.apf);
    return { k, apf, declared, ok: Math.abs(apf - declared) < 0.001 };
  });
  chk('and the space those touching spheres fill is the packing fraction printed',
      rows.every((r) => r.ok),
      rows.map((r) => `${r.k} ${r.apf.toFixed(3)} vs ${r.declared.toFixed(3)}`).join(', '));

  const fcc = rows.find((r) => r.k === 'fcc'), dia = rows.find((r) => r.k === 'diamond');
  chk('so close packing fills three quarters of the box and diamond barely a third',
      fcc.apf > 0.73 && fcc.apf < 0.75 && dia.apf > 0.33 && dia.apf < 0.35,
      `fcc ${fcc.apf.toFixed(3)}, diamond ${dia.apf.toFixed(3)}`);
}

// ── The panel describes the lattice on screen ────────────────────────
{
  const seen = [];
  for (const k of order) {
    const shown = await page.evaluate((key) => {
      window.__crystal.select(key);
      const t = (id) => document.getElementById(id)?.textContent.trim();
      return { current: window.__crystal.current(), atoms: t('prop-atoms'),
               coord: t('prop-coord'), apf: t('prop-apf') };
    }, k);
    const d = LAT[k].declared;
    seen.push({ k, ok: shown.current === k && shown.atoms === d.atomsPerCell
                     && shown.coord === d.coord && shown.apf === d.apf,
                shown });
  }
  chk('picking a lattice shows that lattice, with its own numbers beside it',
      seen.every((r) => r.ok),
      seen.filter((r) => !r.ok).map((r) => `${r.k}: ${JSON.stringify(r.shown)}`).join(' | ')
      || `${seen.length} lattices`);
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(400);
  const ko = await h1();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(400);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(400);
  chk('title translates en/ko/zh and returns', en !== ko && ko !== zh && (await h1()) === en,
      `${en} / ${ko} / ${zh}`);

  const unresolved = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
    .filter((el) => el.textContent.trim() === el.dataset.i18n).map((el) => el.dataset.i18n));
  chk('every data-i18n key resolves', unresolved.length === 0, unresolved.slice(0, 4).join(', '));

  chk('the page badges itself as real data, and does not claim to be measured',
      await page.$('.method-tag[data-method="model"]') !== null
      && await page.$('.method-tag[data-method="measured"]') === null);

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('crystal');
