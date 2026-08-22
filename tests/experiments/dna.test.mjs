/*
 * The double helix, measured off the model rather than off its constants.
 *
 * This page is badged "Real data", not "Measured", and the distinction is
 * exact: RISE = 3.4 Å is typed in, not discovered. Nothing here pretends
 * otherwise. What a suite can hold is the claim that badge actually makes —
 * that the geometry on screen is the geometry those numbers describe — plus
 * the handful of facts that are consequences rather than inputs.
 *
 * So every number below is taken from the coordinates of the beads and rods
 * the page built, never from the constants it was given. The constants are
 * fetched only as the thing to compare against. A hook reporting "rise = 3.4"
 * would have been the page handing back its own input, and a suite built on
 * that would pass however the helix was laid out.
 *
 * B-form DNA, for reference: 3.4 Å rise per base pair, 10.5 base pairs per
 * turn, a 20 Å backbone diameter, right-handed, antiparallel strands, and two
 * grooves of unequal width because the strands sit 120° apart one way round
 * and 240° the other.
 */
import { browser, chk, url, finish, lang } from '../lib/harness.mjs';

const B = url('experiments/dna.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const K = await page.evaluate(() => window.__dna.constants);

/**
 * The backbone beads of one strand, in sequence order.
 *
 * buildScene pushes them as it walks the sequence — strand A then strand B for
 * each base — so the two strands are the even and odd entries of the sphere
 * list. Taken by position rather than by colour, which is decoration.
 */
const strand = (spheres, which) => spheres.filter((_, i) => i % 2 === (which === 'A' ? 0 : 1));

const scene = await page.evaluate(() => {
  const s = window.__dna.scene();
  return {
    spheres: s.spheres.map((q) => q.p),
    cylRadii: s.cylinders.map((c) => c.r),
    cyl: s.cylinders.map((c) => ({ a: c.a, b: c.b, r: c.r })),
    labels: s.labels.map((l) => ({ p: l.p, text: l.text, end: !!l.end })),
    n: window.__dna.sequence().length,
  };
});
const A = strand(scene.spheres, 'A'), Bs = strand(scene.spheres, 'B');

chk(`the model is built — ${scene.n} base pairs, ${scene.spheres.length} backbone beads`,
    scene.n > 8 && A.length === scene.n && Bs.length === scene.n,
    `${A.length} + ${Bs.length} beads for ${scene.n} bases`);

// ── The helix the coordinates actually describe ──────────────────────
{
  // Rise: the axial gap between consecutive beads on one strand.
  const rises = [];
  for (let i = 1; i < A.length; i++) rises.push(A[i][1] - A[i - 1][1]);
  const rise = rises.reduce((s, v) => s + v, 0) / rises.length;
  const riseSpread = Math.max(...rises) - Math.min(...rises);
  chk('the beads are evenly spaced along the axis, at the rise the page declares',
      riseSpread < 1e-9 && Math.abs(rise - K.RISE) < 1e-9,
      `measured ${rise.toFixed(4)} Å vs declared ${K.RISE}, spread ${riseSpread.toExponential(1)}`);

  // Twist: the angle each bead advances about the axis.
  const ang = (p) => Math.atan2(p[2], p[0]);
  const wrap = (d) => ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const twists = [];
  for (let i = 1; i < A.length; i++) twists.push(wrap(ang(A[i]) - ang(A[i - 1])));
  const twist = twists.reduce((s, v) => s + v, 0) / twists.length;
  const perTurn = (2 * Math.PI) / twist;
  chk('and a full turn takes 10.5 of them, counted off the angles between beads',
      Math.abs(perTurn - 10.5) < 0.02,
      `${perTurn.toFixed(3)} bp per turn (${(twist * 180 / Math.PI).toFixed(2)}° each)`);

  // Diameter: the backbone sits on a cylinder of constant radius.
  const radii = [...A, ...Bs].map((p) => Math.hypot(p[0], p[2]));
  const spread = Math.max(...radii) - Math.min(...radii);
  chk('the backbone runs on a cylinder 20 Å across',
      spread < 1e-9 && Math.abs(2 * radii[0] - 20) < 1e-9,
      `diameter ${(2 * radii[0]).toFixed(3)} Å, radial spread ${spread.toExponential(1)}`);

  // Right-handed: advancing along +y advances the angle the same way.
  chk('and it is right-handed — the twist and the rise share a sign',
      twist > 0 && rise > 0, `twist ${twist.toFixed(4)}, rise ${rise.toFixed(4)}`);

  // The product of the two constants, which neither one states alone.
  const perTurnRise = perTurn * rise;
  chk('so one full turn climbs 35.7 Å, which is neither constant on its own',
      Math.abs(perTurnRise - 35.7) < 0.1, `${perTurnRise.toFixed(2)} Å per turn`);
}

// ── Two grooves, and they are not the same width ─────────────────────
{
  /*
   * The famous asymmetry, and the one thing here that is genuinely a
   * consequence: the page sets a single offset between the strands, and the
   * two gaps it leaves around the cylinder are what the minor and major
   * grooves are. Measured as the angle from one strand to the other, both
   * ways round.
   */
  const ang = (p) => Math.atan2(p[2], p[0]);
  const deg = (r) => (r * 180) / Math.PI;
  const gaps = [];
  for (let i = 0; i < A.length; i++) {
    let d = deg(ang(Bs[i]) - ang(A[i]));
    d = ((d % 360) + 360) % 360;
    gaps.push(d);
  }
  const minor = Math.min(...gaps), major = 360 - Math.max(...gaps);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  chk('the two strands leave grooves of 120° and 240°, not one groove of 180°',
      spread < 1e-9 && Math.abs(minor - 120) < 0.01 && Math.abs(major - 240) < 0.01,
      `minor ${minor.toFixed(2)}°, major ${major.toFixed(2)}°`);
  chk('and the minor groove really is the narrower of the two',
      minor < major - 60, `${minor.toFixed(1)}° vs ${major.toFixed(1)}°`);
}

// ── The rungs are base pairs, and they pair correctly ────────────────
{
  // The base letters sit in pairs in the label list, strand A then strand B.
  const bases = scene.labels.filter((l) => !l.end && /^[ACGT]$/.test(l.text));
  const pairs = [];
  for (let i = 0; i + 1 < bases.length; i += 2) pairs.push(bases[i].text + bases[i + 1].text);
  const legal = new Set(['AT', 'TA', 'GC', 'CG']);
  const bad = pairs.filter((p) => !legal.has(p));
  chk(`every rung joins a legal pair — ${pairs.length} of them`,
      pairs.length === scene.n && bad.length === 0,
      bad.slice(0, 5).join(', ') || `${pairs.length} pairs`);

  // Two hydrogen bonds for A·T, three for G·C. Counted off the thin rods,
  // which are the only cylinders that span from one strand's base to the
  // other's — the page draws them stacked so they can be counted by eye too.
  const thin = Math.min(...scene.cylRadii);
  const hbonds = scene.cyl.filter((c) => Math.abs(c.r - thin) < 1e-9);
  const perRung = [];
  for (let i = 0; i < scene.n; i++) {
    const y = (i - (scene.n - 1) / 2) * K.RISE;
    perRung.push(hbonds.filter((c) => Math.abs((c.a[1] + c.b[1]) / 2 - y) < K.RISE / 2).length);
  }
  const wrong = [];
  pairs.forEach((p, i) => {
    const want = p === 'GC' || p === 'CG' ? 3 : 2;
    if (perRung[i] !== want) wrong.push(`${p} drew ${perRung[i]}, not ${want}`);
  });
  chk('and carries the hydrogen bonds that pair takes — three for G·C, two for A·T',
      wrong.length === 0 && perRung.reduce((s, v) => s + v, 0) === hbonds.length,
      wrong.slice(0, 4).join('; ') || `${hbonds.length} bonds over ${scene.n} rungs`);
}

// ── Antiparallel ─────────────────────────────────────────────────────
{
  const ends = scene.labels.filter((l) => l.end);
  const lowest = (t) => ends.filter((e) => e.text === t).map((e) => e.p[1]).sort((a, b) => a - b);
  const five = lowest("5'"), three = lowest("3'");
  chk("the strands run in opposite directions — a 5' end faces a 3' end at each tip",
      ends.length === 4 && five.length === 2 && three.length === 2
      && Math.sign(five[0]) !== Math.sign(five[1]),
      ends.map((e) => `${e.text}@${e.p[1].toFixed(1)}`).join(' '));
}

// ── The sequence drives the model ────────────────────────────────────
{
  const before = scene.n;
  const probe = 'GGGGCCCCGGGG';
  const after = await page.evaluate((s) => {
    window.__dna.setSequence(s);
    const sc = window.__dna.scene();
    const bases = sc.labels.filter((l) => !l.end && /^[ACGT]$/.test(l.text)).map((l) => l.text);
    const thin = Math.min(...sc.cylinders.map((c) => c.r));
    return {
      seq: window.__dna.sequence(),
      n: sc.spheres.length / 2,
      bases: bases.slice(0, 4).join(''),
      hbonds: sc.cylinders.filter((c) => Math.abs(c.r - thin) < 1e-9).length,
      mrna: window.__dna.transcribe(),
    };
  }, probe);
  chk('typing a sequence rebuilds the model to match it',
      after.seq === probe && after.n === probe.length && after.bases === 'GCGC',
      `${after.seq} → ${after.n} pairs, first rung ${after.bases}`);
  chk('and an all-G·C sequence draws three bonds per rung, so 36 for twelve pairs',
      after.hbonds === probe.length * 3, `${after.hbonds} bonds`);
  chk('transcription copies the coding strand with T replaced by U',
      after.mrna === probe.replace(/T/g, 'U') && !/T/.test(after.mrna), after.mrna);
}

// ── The page reports what it built ───────────────────────────────────
{
  await page.evaluate(() => window.__dna.setSequence('ATGCATGCATGCATGCATGCA'));
  await page.waitForTimeout(250);
  const shown = await page.evaluate(() => {
    const t = (id) => document.getElementById(id)?.textContent.trim();
    const sc = window.__dna.scene();
    return {
      length: t('out-length'), gc: t('out-gc'), turns: t('out-turns'), tm: t('out-tm'),
      n: sc.spheres.length / 2,
      tmReal: window.__dna.meltingTm(), seq: window.__dna.sequence(),
    };
  });
  const gcReal = [...shown.seq].filter((c) => c === 'G' || c === 'C').length / shown.seq.length;
  // Parsed, not pattern-matched: the page rounds GC to a decimal and Tm to a
  // whole degree, and a check that assumed either format would be testing the
  // formatting rather than the number. Half a unit is the rounding itself.
  const num = (t) => parseFloat(String(t).replace(/[^0-9.\-]/g, ''));
  chk('the readouts describe the model beside them, not a stale copy',
      num(shown.length) === shown.n
      && Math.abs(num(shown.gc) - gcReal * 100) < 0.5
      && Math.abs(num(shown.tm) - shown.tmReal) < 0.5,
      `length "${shown.length}" vs ${shown.n}, GC "${shown.gc}" vs `
      + `${(gcReal * 100).toFixed(1)}, Tm "${shown.tm}" vs ${shown.tmReal.toFixed(1)}`);
  chk('and the turn count is the base count over 10.5, as the geometry has it',
      Math.abs(parseFloat(shown.turns) - shown.n / 10.5) < 0.06,
      `${shown.turns} vs ${(shown.n / 10.5).toFixed(2)}`);
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

await finish('dna');
