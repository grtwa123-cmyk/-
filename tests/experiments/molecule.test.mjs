/*
 * Seven molecules, with their angles and bond lengths worked out of the
 * coordinates rather than read off the label beside them.
 *
 * Badged "Real data", like the DNA and crystal pages: the shapes come from
 * chemistry, not from a simulation. The claim to hold is that the structure
 * on screen is the structure the panel describes — and this page had the gap
 * that claim can hide in, with `angle: '104.5°'` written as a string next to
 * a list of positions and nothing joining them. It has bitten before: an
 * earlier draft's ammonia drew 98.6° under a label reading 107°, and a person
 * caught it, because nothing automatic was looking.
 *
 * One distinction the checks have to make, because the page makes it. For
 * five of the seven the declared angle is the angle the coordinates hold, to
 * a tenth of a degree. For ethane and ethylene it is the *ideal* angle of the
 * named geometry — tetrahedral 109.5°, trigonal planar 120° — while the
 * coordinates carry the real molecule, which deviates: ethylene measures
 * H–C–H 117.5° and C–C–H 121.2°, against experiment's 117.4° and 121.3°. The
 * label is right about the class and the coordinates are right about the
 * molecule. Checking them to a tenth of a degree would be demanding the
 * coordinates be less accurate than they are, so the two cases are separated
 * and each is held to what it actually asserts.
 *
 * Bond lengths are not printed anywhere, which makes them the stronger test:
 * they can only be wrong, never merely mislabelled. Literature values in
 * ångström — O–H 0.958, C=O 1.163, C–H 1.087, N–H 1.012, C–C 1.535,
 * C=C 1.339, benzene C–C 1.397 — and the page sits within 0.005 of every one.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/molecule.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const order = await page.evaluate(() => window.__molecule.order);
const M = {};
for (const k of order) M[k] = await page.evaluate((key) => window.__molecule.molecule(key), k);
chk(`all seven molecules are exposed as coordinates — ${order.join(', ')}`,
    order.length === 7 && order.every((k) => M[k] && M[k].atoms.length >= 3),
    order.map((k) => `${k}:${M[k]?.atoms.length}`).join(' '));

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Every X–A–Y angle, in degrees, at each atom with two or more bonds. */
function angles(m) {
  const nb = m.atoms.map(() => []);
  for (const [i, j] of m.bonds) { nb[i].push(j); nb[j].push(i); }
  const out = [];
  for (let c = 0; c < m.atoms.length; c++) {
    for (let p = 0; p < nb[c].length; p++) {
      for (let q = p + 1; q < nb[c].length; q++) {
        const A = m.atoms[nb[c][p]], O = m.atoms[c], C = m.atoms[nb[c][q]];
        const u = [A.x - O.x, A.y - O.y, A.z - O.z];
        const v = [C.x - O.x, C.y - O.y, C.z - O.z];
        const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        const cos = dot / (Math.hypot(...u) * Math.hypot(...v));
        out.push({ name: `${A.el}-${O.el}-${C.el}`,
                   deg: (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI });
      }
    }
  }
  return out;
}

// ── Five whose label is the angle the molecule actually holds ────────
{
  const EXACT = ['water', 'co2', 'methane', 'ammonia', 'benzene'];
  const rows = EXACT.map((k) => {
    const declared = parseFloat(M[k].declared.angle);
    const all = angles(M[k]).map((a) => a.deg);
    // The furthest angle from the label, not the first one — a detail that
    // reports a passing sample explains nothing about why the check failed.
    const off = all.map((d) => Math.abs(d - declared));
    const worstAt = all[off.indexOf(Math.max(...off))];
    return { k, declared, worst: Math.max(...off), worstAt };
  });
  chk('five of the shapes hold the angle their panel prints, to a tenth of a degree',
      rows.every((r) => r.worst < 0.2),
      rows.map((r) => `${r.k} worst ${r.worstAt.toFixed(1)}° vs ${r.declared}°`).join(', '));
}

// ── Two whose label is the ideal for the named geometry ──────────────
{
  const rows = ['ethane', 'ethylene'].map((k) => {
    const ideal = parseFloat(M[k].declared.angle);
    const all = angles(M[k]).map((a) => a.deg);
    return { k, ideal, min: Math.min(...all), max: Math.max(...all),
             worst: Math.max(...all.map((d) => Math.abs(d - ideal))) };
  });
  chk('and two carry the real molecule, spread a few degrees round their ideal',
      rows.every((r) => r.worst < 3.5 && r.worst > 0.5),
      rows.map((r) => `${r.k} ${r.min.toFixed(1)}–${r.max.toFixed(1)}° round ${r.ideal}°`).join(', '));

  // The direction of the distortion is the chemistry, not rounding.
  const eth = angles(M.ethylene);
  const hch = eth.find((a) => a.name === 'H-C-H').deg;
  const cch = eth.find((a) => a.name.includes('C-C-H') || a.name === 'H-C-C').deg;
  chk("and they lean the way the real molecules do — ethylene's H–C–H closes below 120°",
      hch < 118.5 && cch > 120.5, `H-C-H ${hch.toFixed(1)}°, C-C-H ${cch.toFixed(1)}°`);
}

// ── Bond lengths against the literature ──────────────────────────────
{
  const LIT = {
    'H-O(1)': 0.958, 'C-O(2)': 1.163, 'C-H(1)': 1.087,
    'H-N(1)': 1.012, 'C-C(1)': 1.535, 'C-C(2)': 1.339, 'C-C(1.5)': 1.397,
  };
  const seen = {}, bad = [];
  for (const k of order) {
    for (const [i, j, o] of M[k].bonds) {
      const pair = [M[k].atoms[i].el, M[k].atoms[j].el].sort().join('-');
      (seen[`${pair}(${o})`] ||= []).push(dist(M[k].atoms[i], M[k].atoms[j]));
    }
  }
  const mean = (rs) => rs.reduce((s, v) => s + v, 0) / rs.length;
  for (const [key, rs] of Object.entries(seen)) {
    if (LIT[key] === undefined) continue;
    if (Math.abs(mean(rs) - LIT[key]) > 0.02) bad.push(`${key} ${mean(rs).toFixed(3)} vs ${LIT[key]}`);
  }
  chk('every bond length is the measured one, within 0.02 Å of the literature',
      bad.length === 0,
      bad.join(', ') || Object.entries(seen).filter(([k]) => LIT[k] !== undefined)
        .map(([k, rs]) => `${k} ${mean(rs).toFixed(3)}`).join(', '));

  const single = seen['C-C(1)'][0], aromatic = seen['C-C(1.5)'][0], double = seen['C-C(2)'][0];
  chk('and the C–C bonds shorten as their order rises, with benzene between the two',
      single > aromatic && aromatic > double,
      `single ${single.toFixed(3)} > aromatic ${aromatic.toFixed(3)} > double ${double.toFixed(3)}`);
}

// ── Benzene's six bonds are one bond ─────────────────────────────────
{
  const ring = M.benzene.bonds.filter(([i, j]) =>
    M.benzene.atoms[i].el === 'C' && M.benzene.atoms[j].el === 'C');
  const rs = ring.map(([i, j]) => dist(M.benzene.atoms[i], M.benzene.atoms[j]));
  const spread = Math.max(...rs) - Math.min(...rs);
  chk('benzene draws six identical C–C bonds, not three short and three long',
      ring.length === 6 && spread < 1e-9,
      `${ring.length} bonds, ${rs[0].toFixed(3)} Å, spread ${spread.toExponential(1)}`);
}

// ── Flat where flat, and not where not ───────────────────────────────
{
  /**
   * Distance of the furthest atom from the best plane through them all.
   *
   * Zero for a linear molecule, which is the case that has to be said out
   * loud: every pair of its atom vectors is collinear, so no cross product
   * gives a normal and the search for a best plane finds none at all. It is
   * not that carbon dioxide has no plane — it lies in infinitely many, and an
   * earlier draft of this helper reported Infinity for it.
   */
  const outOfPlane = (m) => {
    const n = m.atoms.length;
    const c = m.atoms.reduce((s, a) => [s[0] + a.x / n, s[1] + a.y / n, s[2] + a.z / n], [0, 0, 0]);
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const u = [m.atoms[i].x - c[0], m.atoms[i].y - c[1], m.atoms[i].z - c[2]];
        const v = [m.atoms[j].x - c[0], m.atoms[j].y - c[1], m.atoms[j].z - c[2]];
        const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const len = Math.hypot(...nrm);
        if (len < 1e-9) continue;
        const worst = Math.max(...m.atoms.map((a) =>
          Math.abs(((a.x - c[0]) * nrm[0] + (a.y - c[1]) * nrm[1] + (a.z - c[2]) * nrm[2]) / len)));
        if (worst < best) best = worst;
      }
    }
    return Number.isFinite(best) ? best : 0;
  };
  const flat = ['water', 'co2', 'ethylene', 'benzene'].map((k) => ({ k, d: outOfPlane(M[k]) }));
  const solid = ['methane', 'ammonia'].map((k) => ({ k, d: outOfPlane(M[k]) }));
  chk('water, carbon dioxide, ethylene and benzene are flat',
      flat.every((r) => r.d < 1e-6), flat.map((r) => `${r.k} ${r.d.toExponential(1)} Å`).join(', '));
  chk('and methane and ammonia are not — they have a third dimension to them',
      solid.every((r) => r.d > 0.2), solid.map((r) => `${r.k} ${r.d.toFixed(3)} Å`).join(', '));
}

// ── The formula counts the atoms that are there ──────────────────────
{
  const SUB = { '₀': 0, '₁': 1, '₂': 2, '₃': 3, '₄': 4, '₅': 5, '₆': 6, '₇': 7, '₈': 8, '₉': 9 };
  const bad = [];
  for (const k of order) {
    const want = {};
    for (const m of M[k].formula.matchAll(/([A-Z][a-z]?)([₀-₉]*)/g)) {
      if (!m[1]) continue;
      want[m[1]] = (want[m[1]] || 0) + (m[2] ? [...m[2]].reduce((s, c) => s * 10 + SUB[c], 0) : 1);
    }
    const got = {};
    for (const a of M[k].atoms) got[a.el] = (got[a.el] || 0) + 1;
    for (const el of new Set([...Object.keys(want), ...Object.keys(got)])) {
      if ((want[el] || 0) !== (got[el] || 0)) {
        bad.push(`${k} ${M[k].formula}: ${el} ${got[el] || 0} drawn, ${want[el] || 0} written`);
      }
    }
  }
  chk('and the formula on the panel counts the atoms the model is built from',
      bad.length === 0, bad.slice(0, 4).join('; ') || `${order.length} formulas`);
}

// ── The panel describes the molecule on screen ───────────────────────
{
  const bad = [];
  for (const k of order) {
    const shown = await page.evaluate((key) => {
      window.__molecule.select(key);
      const t = (id) => document.getElementById(id)?.textContent.trim();
      return { current: window.__molecule.current(), angle: t('prop-angle') };
    }, k);
    if (shown.current !== k || shown.angle !== M[k].declared.angle) {
      bad.push(`${k}: showing ${shown.current}, angle "${shown.angle}"`);
    }
  }
  chk('picking a molecule shows that molecule, with its own angle beside it',
      bad.length === 0, bad.join(' | ') || `${order.length} molecules`);
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

await finish('molecule');
