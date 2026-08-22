import fs from 'node:fs';
import path from 'node:path';
import { browser, chk, rows, BASE, ROOT, finish, lang } from '../lib/harness.mjs';

/*
 * The galvanic cell.
 *
 * The page's claim is a strong one and it is the only thing worth checking
 * here: that it does not compute the voltage from the Nernst equation. Each
 * electrode is given Butler-Volmer kinetics — the two directions of the
 * half-reaction, each with a Boltzmann factor for the part of the potential
 * that helps or hinders it — and the voltmeter reads whatever potential makes
 * them run at the same rate.
 *
 * So the suite measures Nernst off the page rather than checking that it was
 * typed in correctly. It sweeps concentration and reads the slope; it sweeps
 * temperature and watches the slope move with it; it pushes the current far
 * from equilibrium and reads Tafel's slope out of the same expression. And it
 * reads the source to confirm that nothing in the file writes ln Q down.
 *
 * Constants are CODATA and the standard reduction potentials are the usual
 * tabulated values at 25 °C.
 */
const R_GAS = 8.314462618, FARADAY = 96485.33212;
const LN10 = Math.log(10);
/** 2.303RT/zF in millivolts — one Nernst slope. */
const slopeMv = (T, z) => LN10 * R_GAS * T / (z * FARADAY) * 1000;

const SKY = {              // V vs SHE, 25 °C
  Mg: -2.372, Zn: -0.7618, Fe: -0.447, Ni: -0.257,
  Sn: -0.1375, Pb: -0.1262, Cu: 0.3419, Ag: 0.7996,
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${BASE}/experiments/redox.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__redox, null, { timeout: 20000 });
chk('page loads without console errors', errs.length === 0, errs.slice(0, 1).join(''));

const set = (cfg) => page.evaluate((c) => window.__redox.set({ ...c, R: c.R === null ? Infinity : c.R }), cfg);
const metals = await page.evaluate(() => window.__redox.metals());

// ── the table it is built from ────────────────────────────────────────────
{
  const off = Object.entries(SKY)
    .filter(([m, v]) => Math.abs(metals[m].E0 - v) > 0.0005)
    .map(([m, v]) => `${m} ${metals[m].E0} vs ${v}`);
  chk('every standard reduction potential is the tabulated one', off.length === 0, off.join(', '));
  chk('and silver is the one that moves a single electron',
      metals.Ag.z === 1 && Object.entries(metals).filter(([, m]) => m.z === 2).length === 7,
      `Ag z=${metals.Ag.z}`);
}

// ── E°cell comes out of the difference, for every pair ────────────────────
{
  const pairs = [['Zn', 'Cu'], ['Cu', 'Ag'], ['Mg', 'Cu'], ['Fe', 'Ni'], ['Pb', 'Ag'], ['Sn', 'Cu']];
  const wrong = [];
  for (const [A, B] of pairs) {
    const r = await set({ A, B, cA: 1, cB: 1, T: 298.15, R: null });
    const want = SKY[B] - SKY[A];
    if (Math.abs(r.V - want) > 1e-6) wrong.push(`${A}|${B} ${r.V.toFixed(5)} vs ${want.toFixed(5)}`);
  }
  chk('at unit activity the cell reads E°cathode − E°anode, and nothing else',
      wrong.length === 0, wrong.join(', '));

  const zncu = await set({ A: 'Zn', B: 'Cu', cA: 1, cB: 1, T: 298.15, R: null });
  chk('so the Daniell cell reads 1.10 V, as a Daniell cell does',
      Math.abs(zncu.V - 1.10) < 0.005, `${zncu.V.toFixed(4)} V`);
}

// ── the Nernst slope, measured ────────────────────────────────────────────
{
  /** Volts per decade of the cathode ion, at open circuit. */
  const sweep = async (cfg, key) => {
    const pts = [];
    for (const p of [-3, -2, -1, 0]) {
      const c = { ...cfg, [key]: Math.pow(10, p) };
      pts.push([p, (await set(c)).V]);
    }
    let sum = 0;
    for (let i = 1; i < pts.length; i++) sum += (pts[i][1] - pts[i - 1][1]) * 1000;
    return { mv: sum / (pts.length - 1), pts };
  };

  const up = await sweep({ A: 'Zn', B: 'Cu', cA: 1, T: 298.15, R: null }, 'cB');
  const want2 = slopeMv(298.15, 2);
  chk('raising the cathode ion by a decade raises the cell by one Nernst slope',
      Math.abs(up.mv - want2) < 0.05,
      `${up.mv.toFixed(3)} mV/decade measured, 2.303RT/2F = ${want2.toFixed(3)}`);

  const down = await sweep({ A: 'Zn', B: 'Cu', cB: 1, T: 298.15, R: null }, 'cA');
  chk('and raising the anode ion lowers it by the same, with the sign turned round',
      Math.abs(down.mv + want2) < 0.05,
      `${down.mv.toFixed(3)} mV/decade, expecting −${want2.toFixed(3)}`);

  // Silver moves one electron, so its half-cell moves twice as far per decade.
  const ag = await sweep({ A: 'Cu', B: 'Ag', cA: 1, T: 298.15, R: null }, 'cB');
  const want1 = slopeMv(298.15, 1);
  chk('a one-electron half-cell moves 59 mV per decade where a two-electron one moves 30',
      Math.abs(ag.mv - want1) < 0.05,
      `Ag ${ag.mv.toFixed(2)} mV vs ${want1.toFixed(2)}, Cu ${up.mv.toFixed(2)} vs ${want2.toFixed(2)}`);
}

// ── and it is 2.303RT/zF, not 59 mV ───────────────────────────────────────
{
  const out = [];
  let worst = 0;
  for (const T of [278.15, 298.15, 323.15, 348.15, 368.15]) {
    const a = (await set({ A: 'Zn', B: 'Cu', cA: 1, cB: 0.001, T, R: null })).V;
    const b = (await set({ A: 'Zn', B: 'Cu', cA: 1, cB: 0.01, T, R: null })).V;
    const mv = (b - a) * 1000;
    out.push(`${(T - 273.15).toFixed(0)}°C ${mv.toFixed(2)}`);
    worst = Math.max(worst, Math.abs(mv - slopeMv(T, 2)));
  }
  chk('the slope is proportional to absolute temperature — it is RT, not a constant',
      worst < 0.05, out.join('  ') + `  (worst ${worst.toFixed(3)} mV off 2.303RT/2F)`);
}

// ── a concentration cell has no E° left in it ─────────────────────────────
{
  const same = await set({ A: 'Cu', B: 'Cu', cA: 0.1, cB: 0.1, T: 298.15, R: null });
  chk('the same metal on both sides at the same concentration reads zero',
      Math.abs(same.V) < 1e-9 && Math.abs(same.E0) < 1e-12,
      `${(same.V * 1e9).toFixed(2)} nV, E° = ${same.E0}`);

  const split = await set({ A: 'Cu', B: 'Cu', cA: 0.001, cB: 0.1, T: 298.15, R: null });
  const want = 2 * slopeMv(298.15, 2) / 1000;
  chk('and two decades of difference is two Nernst slopes, out of nothing but concentration',
      Math.abs(split.V - want) < 1e-5,
      `${(split.V * 1000).toFixed(3)} mV measured, ${(want * 1000).toFixed(3)} expected`);
}

// ── Tafel, from the same expression ───────────────────────────────────────
{
  /*
   * Far from equilibrium the reverse reaction stops mattering and the same
   * i/i0 = e^(u/2) − c·e^(−u/2) becomes a straight line in log i, with twice
   * the Nernst slope because the symmetry factor is a half. Read off one
   * electrode, which is where the kinetics live.
   */
  const eta = await page.evaluate(() => {
    const E0 = window.__redox.electrode('Zn', 1, 298.15, 0);
    return [1e3, 1e4, 1e5, 1e6].map((r) => window.__redox.electrode('Zn', 1, 298.15, r) - E0);
  });
  let slope = 0;
  for (let i = 1; i < eta.length; i++) slope += (eta[i] - eta[i - 1]) * 1000;
  slope /= eta.length - 1;
  const want = 2 * slopeMv(298.15, 2);
  chk('driven hard, the very same expression gives Tafel — twice the Nernst slope',
      Math.abs(slope - want) / want < 0.01,
      `${slope.toFixed(2)} mV/decade against 2·2.303RT/2F = ${want.toFixed(2)}`);
}

// ── under load ────────────────────────────────────────────────────────────
{
  const seen = [];
  let sags = true, prevV = Infinity, prevI = -1, rises = true;
  for (const R of [1000, 100, 20, 5, 1]) {
    const r = await set({ A: 'Zn', B: 'Cu', cA: 1, cB: 1, T: 298.15, R });
    seen.push(`${R}Ω ${r.V.toFixed(3)}V ${(r.I * 1000).toFixed(1)}mA`);
    if (r.V >= prevV) sags = false;
    if (r.I <= prevI) rises = false;
    prevV = r.V; prevI = r.I;
  }
  chk('a heavier load pulls the voltage down and the current up, every step',
      sags && rises, seen.join('  '));

  const open = await set({ A: 'Zn', B: 'Cu', cA: 1, cB: 1, T: 298.15, R: null });
  chk('and open circuit draws nothing at all, as a voltmeter should',
      open.I === 0, `${open.I} A`);
}

// ── a cell that cannot go, does not ───────────────────────────────────────
{
  const back = await set({ A: 'Cu', B: 'Zn', cA: 1, cB: 1, T: 298.15, R: 20 });
  chk('wired backwards it delivers no current — a cell is not persuaded by wiring',
      back.I === 0 && back.E0 < 0, `E° ${back.E0.toFixed(3)} V, ${back.I} A`);
  chk('and the panel says so rather than showing a dead zero',
      /backward|거꾸로|接反/i.test(back.shownState), back.shownState);
}

// ── Faraday, and what discharging does to the cell ────────────────────────
{
  // The rest voltage before anything is drawn, for the comparison at the end
  // of this block. Taking it under load instead was my mistake the first
  // time: a loaded cell reads lower than an open one for reasons that have
  // nothing to do with Q, and 0.82 V against 1.14 V says nothing at all.
  const restBefore = (await set({ A: 'Zn', B: 'Cu', cA: 0.01, cB: 1, T: 298.15, R: null })).V;
  await set({ A: 'Zn', B: 'Cu', cA: 0.01, cB: 1, T: 298.15, R: 20 });
  const before = await page.evaluate(() => window.__redox.read());
  const after = await page.evaluate(() => window.__redox.advance(300, 600));
  const c = await page.evaluate(() => window.__redox.constants());

  const nFromCharge = after.charge / (2 * c.F);
  chk('the metal that moved is the charge that passed, divided by zF',
      Math.abs(after.nA - nFromCharge) < 1e-12 && Math.abs(after.nB - nFromCharge) < 1e-12,
      `${after.charge.toFixed(3)} C → ${(nFromCharge * 1e6).toFixed(3)} µmol, page says`
      + ` ${(after.nA * 1e6).toFixed(3)} / ${(after.nB * 1e6).toFixed(3)}`);

  chk('the anode ion builds up and the cathode ion is consumed, by that many moles',
      Math.abs((after.cA - before.cA) - after.nA / c.VOL_L) < 1e-9
      && Math.abs((before.cB - after.cB) - after.nB / c.VOL_L) < 1e-9,
      `Zn²⁺ ${before.cA.toFixed(4)}→${after.cA.toFixed(4)}, Cu²⁺ ${before.cB.toFixed(4)}→${after.cB.toFixed(4)}`);

  // The reading follows the cell into its new state, rather than staying
  // where it started — Q has moved, so the voltage must have.
  const open = await page.evaluate(() => {
    const r = window.__redox.read();
    const st = window.__redox.set({ A: r.A, B: r.B, cA: r.cA, cB: r.cB, T: r.T, R: Infinity });
    return { V: st.V, Q: st.Q, n: st.n, E0: st.E0, T: st.T };
  });
  const closed = open.E0 - (R_GAS * open.T / (open.n * FARADAY)) * Math.log(open.Q);
  chk('and part way through, the rest voltage is still E°cell − (RT/nF)lnQ',
      Math.abs(open.V - closed) < 1e-9,
      `${open.V.toFixed(6)} V measured, ${closed.toFixed(6)} V from the Q it has reached`);
  chk('and it is lower at rest than it was at rest before, because Q has risen',
      open.V < restBefore && open.Q > (before.cA ** 2) / (before.cB ** 2) * 0.999,
      `${restBefore.toFixed(4)} → ${open.V.toFixed(4)} V at rest, Q ${open.Q.toExponential(2)}`);
}

// ── a concentration cell closes its own gap ───────────────────────────────
{
  await set({ A: 'Cu', B: 'Cu', cA: 0.002, cB: 0.2, T: 298.15, R: 5 });
  const start = await page.evaluate(() => window.__redox.read());
  let prev = start.cB / start.cA, crossed = false, mono = true;
  let last = start;
  for (let k = 0; k < 8; k++) {
    last = await page.evaluate(() => window.__redox.advance(400, 800));
    const ratio = last.cB / last.cA;
    if (ratio > prev) mono = false;
    if (last.cA > last.cB) crossed = true;
    prev = ratio;
  }
  chk('a concentration cell only ever closes the gap, and never crosses it',
      mono && !crossed,
      `${start.cA.toFixed(5)}/${start.cB.toFixed(5)} → ${last.cA.toFixed(5)}/${last.cB.toFixed(5)} M`);
  chk('and the copper it moves is copper it had',
      Math.abs((last.cA + last.cB) - (start.cA + start.cB)) < 1e-9,
      `${(start.cA + start.cB).toFixed(6)} M before, ${(last.cA + last.cB).toFixed(6)} M after`);
}

// ── nothing in the file writes the answer down ────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'experiments/redox.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  chk('and the source computes no cell voltage from ln Q anywhere outside a comment',
      !/Math\.log\s*\(\s*Q/.test(code) && !/0\.0591|59\.1|59\.2/.test(code),
      'the file appears to state the Nernst result rather than arrive at it');
}

// ── chrome ────────────────────────────────────────────────────────────────
{
  const title = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await title();
  await lang(page, 'ko');
  const ko = await title();
  await lang(page, 'zh');
  const zh = await title();
  await lang(page, 'en');
  chk('title translates en/ko/zh and returns',
      en !== ko && ko !== zh && (await title()) === en, `${en} / ${ko} / ${zh}`);

  const missing = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
    .filter((el) => el.textContent.trim() === el.dataset.i18n).map((el) => el.dataset.i18n));
  chk('every data-i18n key resolves', missing.length === 0, missing.slice(0, 4).join(', '));

  chk('the page badges itself measured', await page.locator('.method-tag[data-method="measured"]').count() === 1);
}

chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 2).join(' | '));

for (const w of [320, 390, 768]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(180);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
}

console.log('=== redox ===');
let f = 0;
for (const r of rows) { if (!r.ok) f++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok || !r.d ? '' : '  ::  ' + r.d}`); }
console.log(`\n${rows.length - f}/${rows.length} passed`);
await finish('redox');
process.exit(f ? 1 : 0);
