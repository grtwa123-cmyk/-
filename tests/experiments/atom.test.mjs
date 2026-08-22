/*
 * Building an atom out of its parts, and reading back what that made it.
 *
 * The last of the four "Real data" pages, and the one that behaves least like
 * a diagram: the reader drags protons, neutrons and electrons onto the board
 * and the panel names what they have built. Three counts go in; an element,
 * an isotope, a charge and a verdict on stability come out. None of those is
 * typed by the reader, and none of them should be typed by the page either.
 *
 * Two things get held here.
 *
 * The identifications, against chemistry: the proton count *is* the element,
 * so ten protons is neon whatever else is on the board; the mass number is
 * protons plus neutrons; the charge is protons minus electrons; and stability
 * is a property of the nuclide, so carbon-12 and carbon-13 are stable while
 * carbon-14 is not — the page keeps a table of the genuinely stable neutron
 * counts and the check reads its verdicts against the ones a chart of
 * nuclides gives.
 *
 * And the shell structure, off the coordinates. Electrons are laid out on
 * shells of capacity 2 then 8, and the reader is invited to count them off
 * the picture — so the suite counts them off the picture too, by measuring
 * each electron's distance from the nucleus rather than asking the page which
 * shell it thinks it used. That is what makes neon's full outer shell a thing
 * the model does rather than a thing the label says.
 */
import { browser, chk, url, finish, lang } from '../lib/harness.mjs';

const B = url('experiments/atom.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const cap = await page.evaluate(() => window.__atom.shellCap);
chk('the shells are the ones the page says it uses — capacity 2 then 8',
    Array.isArray(cap) && cap[0] === 2 && cap[1] === 8, JSON.stringify(cap));

/** Build an atom and read back both the panel and the positions. */
const build = (q) => page.evaluate((spec) => {
  const st = window.__atom.build(spec);
  const t = (id) => document.getElementById(id)?.textContent.trim();
  return { st, shown: { element: t('out-element'), isotope: t('out-isotope'),
                        charge: t('out-charge'), stability: t('out-stability'),
                        state: t('out-state') } };
}, q);

/** Electrons per shell, counted by how far each one sits from the nucleus. */
function shellsFromPositions(st) {
  const counts = st.shellRadii.map(() => 0);
  let stray = 0;
  for (const e of st.electrons) {
    const r = Math.hypot(e.x - st.centre.x, e.y - st.centre.y);
    let best = -1, gap = Infinity;
    st.shellRadii.forEach((R, i) => {
      const d = Math.abs(r - R);
      if (d < gap) { gap = d; best = i; }
    });
    // A quarter of the inner shell radius is far wider than the layout's own
    // jitter and far narrower than the gap between shells, so "nearest" here
    // is never a close call.
    if (gap > st.shellRadii[0] * 0.25) stray++; else counts[best]++;
  }
  return { counts, stray };
}

// ── The proton count is the element ──────────────────────────────────
{
  const TABLE = [null, 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne'];
  const bad = [];
  for (let z = 1; z <= 10; z++) {
    // Neutrons and electrons deliberately unmatched: the element must not
    // depend on either of them.
    const r = await build({ p: z, n: (z + 3) % 7, e: (z + 5) % 9 });
    if (!r.shown.element.includes(TABLE[z])) bad.push(`Z=${z} → "${r.shown.element}"`);
  }
  chk('every proton count names its element, whatever else is on the board',
      bad.length === 0, bad.slice(0, 4).join(', ') || 'H through Ne');
}

// ── Mass number and charge ───────────────────────────────────────────
{
  const cases = [
    { p: 6, n: 6, e: 6, A: 12, q: 0 },
    { p: 6, n: 8, e: 6, A: 14, q: 0 },
    { p: 8, n: 8, e: 10, A: 16, q: -2 },
    { p: 3, n: 4, e: 2, A: 7, q: 1 },
    { p: 1, n: 0, e: 0, A: 1, q: 1 },
  ];
  // The panel sets mass numbers as superscripts — ¹²C, not 12C — so the
  // digits have to be folded back before they can be compared. An earlier
  // version of this check read ASCII only, found no number at all, and
  // reported a page that was right in every case as wrong in every case.
  const SUP = { '\u2070': 0, '\u00b9': 1, '\u00b2': 2, '\u00b3': 3, '\u2074': 4,
                '\u2075': 5, '\u2076': 6, '\u2077': 7, '\u2078': 8, '\u2079': 9 };
  const plain = (t) => [...String(t)].map((c) => (c in SUP ? String(SUP[c]) : c)).join('');

  const badA = [], badQ = [];
  for (const c of cases) {
    const r = await build(c);
    const num = (t) => (plain(t).match(/-?\d+/g) || []).map(Number);
    if (!num(r.shown.isotope).includes(c.A)) badA.push(`${c.p}p${c.n}n → "${r.shown.isotope}"`);
    const q = num(r.shown.charge);
    const got = /-|−/.test(r.shown.charge) ? -Math.abs(q[0] ?? 0) : (q[0] ?? 0);
    if (got !== c.q) badQ.push(`${c.p}p${c.e}e → "${r.shown.charge}" want ${c.q}`);
  }
  chk('the mass number is the nucleons counted, not the protons alone',
      badA.length === 0, badA.join(', ') || `${cases.length} nuclides`);
  chk('and the charge is protons minus electrons, with its sign',
      badQ.length === 0, badQ.join(', ') || `${cases.length} ions`);
}

// ── Stability is a property of the nuclide ───────────────────────────
{
  /*
   * Straight off a chart of nuclides: carbon-12 and carbon-13 are stable and
   * carbon-14 is not, which is the whole reason radiocarbon dating works.
   * Beryllium has exactly one stable isotope; boron has two.
   */
  const NUCLIDES = [
    { p: 6, n: 6, stable: true }, { p: 6, n: 7, stable: true },
    { p: 6, n: 8, stable: false },
    { p: 4, n: 5, stable: true }, { p: 4, n: 4, stable: false },
    { p: 8, n: 8, stable: true }, { p: 8, n: 11, stable: false },
    { p: 1, n: 0, stable: true }, { p: 1, n: 2, stable: false },
  ];
  const bad = [];
  for (const c of NUCLIDES) {
    const r = await build({ p: c.p, n: c.n, e: c.p });
    const says = r.shown.stability.toLowerCase();
    const reads = !/un|radio|not/.test(says);
    if (reads !== c.stable) {
      bad.push(`${c.p}-${c.p + c.n} reads "${r.shown.stability}", is ${c.stable ? '' : 'un'}stable`);
    }
  }
  chk(`stability follows the nuclide, not the element — ${NUCLIDES.length} isotopes`,
      bad.length === 0, bad.slice(0, 3).join('; ') || 'carbon-12, -13 stable; -14 not');
}

// ── The shells, counted off the picture ──────────────────────────────
{
  const WANT = [
    { e: 1, occ: [1, 0] }, { e: 2, occ: [2, 0] }, { e: 3, occ: [2, 1] },
    { e: 8, occ: [2, 6] }, { e: 10, occ: [2, 8] },
  ];
  const bad = [];
  for (const w of WANT) {
    const r = await build({ p: w.e, n: w.e, e: w.e });
    const { counts, stray } = shellsFromPositions(r.st);
    if (stray > 0 || counts[0] !== w.occ[0] || counts[1] !== w.occ[1]) {
      bad.push(`${w.e}e sat ${counts.join('+')}${stray ? ` (+${stray} stray)` : ''}, want ${w.occ.join('+')}`);
    }
  }
  chk('the electrons really sit where the shell rule puts them — 2 first, then 8',
      bad.length === 0, bad.join('; ') || WANT.map((w) => `${w.e}e→${w.occ.join('+')}`).join(' '));

  // Helium and neon are the two closed shells in reach, and that is a fact
  // about where the electrons landed, not about the label.
  const he = shellsFromPositions((await build({ p: 2, n: 2, e: 2 })).st);
  const ne = shellsFromPositions((await build({ p: 10, n: 10, e: 10 })).st);
  chk('so helium closes the first shell and neon closes the second',
      he.counts[0] === 2 && he.counts[1] === 0
      && ne.counts[0] === 2 && ne.counts[1] === 8,
      `He ${he.counts.join('+')}, Ne ${ne.counts.join('+')}`);

  // And the outer shell is genuinely further out than the inner one.
  const st = (await build({ p: 10, n: 10, e: 10 })).st;
  const rs = st.electrons.map((e) => Math.hypot(e.x - st.centre.x, e.y - st.centre.y)).sort((a, b) => a - b);
  chk('with the second shell outside the first, not drawn on top of it',
      rs[1] < rs[2] * 0.85, `inner ${rs[0].toFixed(0)},${rs[1].toFixed(0)} px; outer from ${rs[2].toFixed(0)} px`);
}

// ── An empty board says nothing rather than something wrong ──────────
{
  const r = await build({ p: 0, n: 0, e: 0 });
  chk('and an empty board does not name an element it has not got',
      !/\b(H|He|Li|Be|B|C|N|O|F|Ne)\b/.test(r.shown.element),
      `element reads "${r.shown.element}"`);
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await h1();
  await lang(page, 'ko');
  const ko = await h1();
  await lang(page, 'zh');
  const zh = await h1();
  await lang(page, 'en');
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

await finish('atom');
