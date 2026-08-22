/*
 * Electrolysis of water. Nothing here divides the charge by 2F or 4F: the
 * charge is integrated into moles of electrons, and then the half-reactions
 * spend them — two at the cathode buy one H₂, four at the anode buy one O₂ —
 * with the molecules counted as they are made, one bubble at a time.
 *
 * So 2 : 1 is a measurement. These checks hold the counted gas against what
 * Faraday's law says the same charge should have produced, and hold the two
 * laws themselves: the amount depends on the charge and on nothing else about
 * how it was delivered, and the ratio is fixed by the electron price.
 */
import { browser, chk, url, finish, lang } from '../lib/harness.mjs';

const B = url('experiments/electrolysis.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const setV = (id, v) => page.$eval('#' + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
const txt = (id) => page.evaluate((i) => document.getElementById(i)?.textContent.trim(), id);

const E = 'const M = window.__el;';

// ── Counted gas against Faraday's law ────────────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    return [0.5, 1, 2, 4].map((I) => ({ I, ...M.run(I, 90) }));`));

  const errH2 = r.map((x) => Math.abs(x.nH2 - x.faradayH2) / x.faradayH2);
  const errO2 = r.map((x) => Math.abs(x.nO2 - x.faradayO2) / x.faradayO2);
  chk('the counted hydrogen lands on Q/2F — four currents, 90 s each',
      Math.max(...errH2) < 0.005,
      r.map((x) => `${x.I}A ${(errH2[r.indexOf(x)] * 100).toFixed(3)}%`).join(', '));
  chk('and the counted oxygen on Q/4F',
      Math.max(...errO2) < 0.01, `worst ${(Math.max(...errO2) * 100).toFixed(3)}%`);
  chk('the gap is one bubble wide — it is the granularity of counting',
      r.every((x) => Math.abs(x.nH2 - x.faradayH2) <= 2 * 5e-7),
      r.map((x) => `${((x.faradayH2 - x.nH2) / 5e-7).toFixed(2)} bubbles`).join(', '));
}

// ── The ratio is measured, not written down ──────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    return [10, 30, 60, 120].map((s) => { const q = M.run(2, s);
      return { s, ratio: q.nH2 / q.nO2, bubbles: q.bubblesH2 / q.bubblesO2,
               bH2: q.bubblesH2, bO2: q.bubblesO2 }; });`));
  chk('the collected volumes come out 2 : 1, counted',
      r.every((x) => Math.abs(x.ratio - 2) < 0.01),
      r.map((x) => `${x.s}s: ${x.ratio.toFixed(4)}`).join(', '));
  chk('and so does the bubble count — the cathode fizzes twice as fast',
      r.every((x) => Math.abs(x.bubbles - 2) < 0.02),
      r.map((x) => `${x.bH2}/${x.bO2}`).join(', '));
}

// ── Faraday's first law: the charge is what matters ──────────────────
{
  const r = await page.evaluate(new Function(`${E}
    // The same 120 coulombs, delivered four different ways.
    return [[1, 120], [2, 60], [4, 30], [0.5, 240]].map(([I, t]) =>
      ({ I, t, ...M.run(I, t) }));`));
  const h2 = r.map((x) => x.nH2);
  const spread = (Math.max(...h2) - Math.min(...h2)) / (h2[0] || 1);
  chk('120 C makes the same gas whether it took 30 s or 240 s',
      spread < 0.002,
      r.map((x) => `${x.I}A×${x.t}s → ${(x.nH2 * 1e3).toFixed(4)} mmol`).join(', '));
  chk('and every one of them passed the same charge',
      r.every((x) => Math.abs(x.charge - 120) < 1), r.map((x) => x.charge.toFixed(1)).join(', '));
}

// ── The cell does not run below the decomposition voltage ────────────
{
  const r = await page.evaluate(new Function(`${E}
    return { below: [0, 0.5, 1.0, 1.22, 1.23].map((V) => ({ V, I: M.current(V) })),
             above: [1.24, 1.5, 2.0, 3.0].map((V) => ({ V, I: M.current(V) })),
             E0: M.E_DECOMP, g: M.CONDUCTANCE };`));
  chk('below 1.23 V no current flows at all',
      r.below.every((x) => x.I === 0), r.below.map((x) => `${x.V}V:${x.I}`).join(' '));
  chk('above it the current is linear in the overpotential',
      r.above.every((x) => Math.abs(x.I - r.g * (x.V - r.E0)) < 1e-12),
      r.above.map((x) => `${x.V}V:${x.I.toFixed(3)}A`).join(' '));
  chk('and with no current there is no gas, however long you wait',
      (await page.evaluate(new Function(`${E}
        const q = M.run(M.current(1.0), 600); return q.nH2 + q.nO2;`))) === 0, '');
}

// ── The live cell ────────────────────────────────────────────────────
{
  // A clean page, not a reload: the controls now live in the query string,
  // so reloading would bring back whatever the last section left set.
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // It starts at 2.5 V, which is above the decomposition voltage, so the cell
  // is already running by the time the page has painted — asking for an empty
  // tube here would be asking it not to work.
  chk('it starts running, because 2.5 V is above the decomposition voltage',
      (await page.evaluate(() => window.__el.params().V)) > 1.23
      && (await page.evaluate(() => window.__el.charge())) > 0, '');

  await setV('voltage', 3);
  await page.waitForFunction(() => window.__el.molH2() > 2e-4, null, { timeout: 60000 });

  const live = await page.evaluate(() => {
    const M = window.__el;
    return { h2: M.molH2(), o2: M.molO2(), q: M.charge(),
             fh2: M.faradayH2(), bubbles: M.bubbles() };
  });
  chk('the counted gas on the live page tracks Q/2F',
      Math.abs(live.h2 - live.fh2) / live.fh2 < 0.02,
      `${(live.h2 * 1e3).toFixed(4)} mmol counted vs ${(live.fh2 * 1e3).toFixed(4)} predicted`);
  chk('and the live ratio reads 2 : 1',
      Math.abs(live.h2 / live.o2 - 2) < 0.02, (live.h2 / live.o2).toFixed(4));
  chk('bubbles are actually in flight — they are the gas, not decoration',
      live.bubbles > 0, String(live.bubbles));

  const ratioText = await txt('out-ratio');
  chk('the ratio readout says so too', /^1\.9[89]|^2\.0[012]/.test(ratioText), ratioText);
  const shown = parseFloat(await txt('out-faraday'));
  chk('and the Faraday prediction is on screen beside it',
      Math.abs(shown - live.fh2 * 1e3) < 0.01, `${shown} mmol`);

  await setV('voltage', 1.0);
  const q0 = await page.evaluate(() => window.__el.charge());
  await page.waitForTimeout(1200);
  const q1 = await page.evaluate(() => window.__el.charge());
  chk('dropping below 1.23 V stops the cell dead',
      Math.abs(q1 - q0) < 1e-9, `${q0.toFixed(3)} → ${q1.toFixed(3)} C`);

  // Reset deliberately restores the working default — 2.5 V, unpaused — so
  // the cell is filling again on the very next frame. Asking for exactly zero
  // afterwards would be asking it to stay stopped, which is not what the
  // button is for. What it has to do is discard what was collected.
  const filled = await page.evaluate(() => window.__el.molH2());
  await page.click('#reset-btn'); await page.waitForTimeout(200);
  const afterReset = await page.evaluate(() => ({
    h2: window.__el.molH2(), q: window.__el.charge(), V: window.__el.params().V }));
  chk('Reset empties the tubes and puts the voltage back to its default',
      afterReset.h2 < filled * 0.05 && Math.abs(afterReset.V - 2.5) < 1e-9,
      `${(filled * 1e3).toFixed(3)} → ${(afterReset.h2 * 1e3).toFixed(4)} mmol at ${afterReset.V} V`);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.evaluate(() => window.__el.setRunning(false));
  const sig = async () => {
    await page.waitForTimeout(160);
    return page.evaluate(() => {
      const M = window.__el, p = M.params();
      return JSON.stringify([p.V, p.paused, M.current(p.V).toFixed(6),
        document.getElementById('voltage-value').textContent]);
    });
  };
  const dead = [];
  const acts = [
    ['voltage', () => setV('voltage', 2.4)],
    ['pause', () => page.click('#pause-btn')],
  ];
  let before = await sig();
  for (const [name, act] of acts) {
    await act();
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));
  await page.evaluate(() => window.__el.setRunning(true));
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

  chk('the page badges itself as measured and verified',
      await page.$('.method-tag[data-method="measured"]') !== null
      && await page.$('.method-verified') !== null);

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(420);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('electrolysis');
