/*
 * Reaction kinetics — the Boltzmann factor, counted.
 *
 * Nothing evaluates Arrhenius. Hard discs collide, the line-of-centres energy
 * of each A–B encounter is tested against Ea, and the successes are tallied.
 * The claim is that the tally lands on e^(−Ea/kT), and for a while it did not:
 * it sat 4–8% low across six runs, which combines to about −3.3σ.
 *
 * The cause is not a bug in the counting. A + B merging into one C of mass 2
 * at (vA+vB)/2 destroys |v_rel|²/4 of kinetic energy — a two-body association
 * cannot conserve both momentum and energy, which is why real ones need a
 * third body — and only *energetic* pairs react, so the reaction eats the tail
 * being measured. The walls refill it and the steady state settles below the
 * dial. So the comparison is now the Boltzmann factor at the temperature the
 * gas had *at each collision*, accumulated as the collisions happen, which is
 * the exact expectation of the tally. Against that the bias is gone: mean z
 * over six runs moved from −1.34 to +0.15.
 *
 * These checks hold both halves — that the tally matches the honest
 * expectation, and that the gap to the dial is real and grows with the number
 * of reactions rather than being noise.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/kinetics.html');
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

/*
 * Wait for collisions, not for seconds.
 *
 * This used to run for 13 000 ms of wall-clock, which meant the amount of
 * physics behind every number below depended on how busy the machine was.
 * CI is busy, and it failed here — two checks at once, which is a systematic
 * shift rather than the independent noise the thresholds were set for.
 *
 * The tell is in the spread of z. Idle and unhurried it is 0.61, not the 1.00
 * the binomial model assumes: `predictedFraction` accumulates over the very
 * collisions it is compared against, so the two share their sampling noise
 * and most of it cancels. At that spread |z| > 3 is five sigma and cannot
 * happen. Starve the run and the cancellation goes with it — 0.91 at four
 * seconds, 1.08 at two — and under six busy loops on four cores one setting
 * reached 2.88 against a threshold of 3.
 *
 * So each setting waits for a number of collisions instead. A loaded machine
 * then takes longer in wall-clock and arrives at the same statistics, which
 * is the whole point.
 *
 * The number cannot be the same for all of them, because they cannot all
 * supply the same evidence. A hot gas over a low barrier reacts away its own
 * reactants: T900/Ea200 counts 685 collisions by ten seconds, 862 by thirty
 * and 889 by forty-five, with A and B down from 50 each to 7 — its rate is
 * heading for zero and no amount of waiting reaches four figures. The others
 * keep going: T300/Ea400 passes 1366 by twenty seconds.
 *
 * One gate for all of them therefore means the slowest one's ceiling for
 * everybody, and that is not free either. Set at 500 it took the barrier-
 * ratio check below from 1620 collisions to 500 at T300/Ea800, where the
 * measured fraction is 0.04 — twenty successes instead of sixty-five — and
 * that check started failing under load instead. So the targets are per
 * setting, each one what that setting can actually produce.
 */
const COLLISIONS = {
  '300/400': 1200,
  '600/400': 900,
  '300/800': 1200,
  '900/200': 600,     // its ceiling is about 890, and slow to get there
  '500/1000': 1200,
};

const snapshot = () => page.evaluate(() => {
  const K = window.__kin, p = K.params();
  const parts = K.particles ? K.particles() : null;
  return { T: p.T, Ea: p.Ea, N: p.N,
           c: K.collisions(), e: K.energetic(), rx: K.reactions(),
           f: K.measuredFraction(), honest: K.predictedFraction(),
           dial: K.setPointFraction(), gasT: K.gasTemperature(),
           counts: parts && parts.reduce((a, q) => (a[q.kind] = (a[q.kind] || 0) + 1, a), {}) };
});

/*
 * Run a setting, and take a reading at the halfway mark as well as the end.
 *
 * The halfway reading is not used by any check. It is here because this suite
 * has now gone red on CI twice with a discrepancy no sample size explains —
 * measured 0.1579 against a predicted 0.1290 in the one failure captured in
 * full — and neither of the two causes proposed for it survived being tested.
 * A loaded runner does not reproduce it: six busy loops on four cores leave
 * the collision counts alone (936 -> 992, 1620 -> 1616) and the unfixed code
 * passed under them. Nor does an equilibration transient: the per-segment
 * gap starts at +0.009, +0.010, -0.010 across three runs, sign and all.
 *
 * So the next failure has to carry its own evidence. Splitting the run in two
 * separates the three explanations that remain: a fluctuation puts the halves
 * on either side at random, a drift makes the second half systematically
 * different, and a bad early sample leaves the first half alone as the
 * outlier. None of that can be recovered after the fact from a single number.
 *
 * The halves are worth reading even on a green run. They show the gas moving a
 * long way inside one measurement — T900/Ea200 reads 992 in the first half and
 * 665 in the second, against a dial of 900, as a low barrier burns the
 * reactants away — and the prediction is accumulated per collision at whatever
 * the temperature was at the time, so the two track each other down. That
 * shared drift is what makes z under-dispersed at 0.61 rather than 1.00. The
 * temperature itself is instantaneous, not smoothed, so a lagging estimate is
 * not among the candidates.
 */
async function run(T, Ea, minC = COLLISIONS[`${T}/${Ea}`] || 900, N = 100) {
  await setV('temp', T); await setV('ea', Ea); await setV('count', N);
  await page.evaluate(() => { window.__kin.reset(); window.__kin.setRunning(true); });
  await page.waitForFunction(
    (want) => window.__kin.collisions() >= want, Math.floor(minC / 2), { timeout: 90000 });
  const mid = await snapshot();
  await page.waitForFunction(
    (want) => window.__kin.collisions() >= want, minC, { timeout: 90000 });
  const end = await snapshot();
  // The second half on its own, by difference — the running totals are
  // cumulative, so the halves have to be separated by subtraction.
  const dc = end.c - mid.c;
  end.halves = {
    first: { c: mid.c, f: mid.f, honest: mid.honest, gasT: mid.gasT },
    second: dc > 0
      ? { c: dc, f: (end.e - mid.e) / dc,
          honest: (end.honest * end.c - mid.honest * mid.c) / dc, gasT: end.gasT }
      : null,
  };
  return end;
}
const z = (r, want) => (r.f - want) / Math.sqrt((want * (1 - want)) / r.c);

/** Everything known about a setting, for a failure message to carry. */
function forensics(r) {
  const h = r.halves || {};
  const half = (x) => (x ? `f=${x.f.toFixed(4)} pred=${x.honest.toFixed(4)} `
                          + `d=${(x.f - x.honest >= 0 ? '+' : '') + (x.f - x.honest).toFixed(4)} `
                          + `T=${x.gasT.toFixed(1)} n=${x.c}` : 'n/a');
  return `T${r.T}/Ea${r.Ea}: c=${r.c} f=${r.f.toFixed(4)} pred=${r.honest.toFixed(4)} `
    + `dial=${r.dial.toFixed(4)} gasT=${r.gasT.toFixed(1)} rx=${r.rx} `
    + `left=${JSON.stringify(r.counts)}\n      first half  ${half(h.first)}`
    + `\n      second half ${half(h.second)}`;
}

// ── The tally lands on the Boltzmann factor ──────────────────────────
const runs = [];
for (const [T, Ea] of [[300, 400], [600, 400], [300, 800], [900, 200], [500, 1000]]) {
  runs.push(await run(T, Ea));
}
{
  const zs = runs.map((r) => z(r, r.honest));
  const worst = Math.max(...zs.map(Math.abs));
  chk(`the counted success rate is e^(−Ea/kT) at the temperature the gas is at — ${runs.length} settings`,
      runs.every((r) => r.c > 400) && worst < 3,
      runs.map((r, i) => `z=${zs[i].toFixed(2)}  ${forensics(r)}`).join('\n    '));

  // Five independent runs, so the mean of their z is a standard normal
  // divided by √5. This is the check that a systematic bias trips.
  const mean = zs.reduce((a, b) => a + b) / zs.length;
  chk('and with no bias left across the five',
      Math.abs(mean) * Math.sqrt(zs.length) < 2.5,
      `mean z = ${mean.toFixed(2)}, combined ${(mean * Math.sqrt(zs.length)).toFixed(2)}σ\n    `
      + runs.map((r, i) => `z=${zs[i].toFixed(2)}  ${forensics(r)}`).join('\n    '));
}

/*
 * ── The dial is not the temperature: three claims tried, three withdrawn ──
 *
 * The reaction is a heat sink and the walls are the source, so the gas ought
 * to settle below the dial. Every attempt to hold that as a check has failed
 * for the same reason, and the record is here so it is not attempted a fourth
 * time without more run length behind it.
 *
 *   1. "The deficit grows with how much reacting has been done." It does not
 *      — it anti-correlates, because the runs that react hardest are the hot
 *      ones where the same lost energy is a smaller share of the total.
 *   2. "The correction beats the noise per run." The gap came out 0.0147
 *      against a standard error of 0.0170, so it does not.
 *   3. "Every one of the five settings lands below the dial." This one
 *      shipped, on the strength of ten runs across two passes that all did.
 *      It then failed CI, and six repeats found it failing three times: one
 *      setting or another comes out above, by as much as 4%.
 *
 * Four measured passes of the five settings put numbers on why. The mean
 * deficit over the five is +9.0%, +8.2%, +5.8%, +2.7% — positive every time,
 * so the effect is real — but its t against the between-setting spread is
 * 3.37, 2.15, 1.57, 0.82. There is no threshold that keeps a true claim and
 * rejects a false one at n = 5, and the reason is visible in the raw numbers:
 * the measured gas temperature of a single 13-second run swings from 21%
 * below the dial to 11% above it. These runs are not in a steady state.
 *
 * What survives is the check above, which is the one that matters: the tally
 * lands on the Boltzmann factor at the temperature the gas *actually had*,
 * with no bias left across five settings. Nothing here now asserts which side
 * of the dial that temperature falls on.
 */

// ── Arrhenius, without Arrhenius being written down ──────────────────
{
  const hot = runs.find((r) => r.T === 600 && r.Ea === 400);
  const cool = runs.find((r) => r.T === 300 && r.Ea === 400);
  chk('raising the temperature at fixed Ea raises the success rate',
      hot.f > cool.f * 1.5, `T300: ${cool.f.toFixed(4)} → T600: ${hot.f.toFixed(4)}`);
  const low = runs.find((r) => r.T === 300 && r.Ea === 400);
  const high = runs.find((r) => r.T === 300 && r.Ea === 800);
  chk('and raising the barrier at fixed temperature lowers it, by the ratio the exponent says',
      high.f < low.f / 2
      && Math.abs(Math.log(low.f / high.f) / (400 / high.gasT) - 1) < 0.35,
      `Ea400: ${low.f.toFixed(4)}, Ea800: ${high.f.toFixed(4)}; `
      + `ln ratio ${Math.log(low.f / high.f).toFixed(3)} against ΔEa/kT ${(400 / high.gasT).toFixed(3)}`);
}

// ── Bookkeeping that cannot be off by one ────────────────────────────
{
  const r = runs[0];
  chk('every reaction takes one A and one B and makes one C, exactly',
      r.counts && (r.counts.A || 0) + (r.counts.C || 0) === r.N
      && (r.counts.B || 0) + (r.counts.C || 0) === r.N,
      `A${r.counts?.A} B${r.counts?.B} C${r.counts?.C}, started with ${r.N} of each`);

  // Only a fraction of energetic collisions clear the steric roll.
  const tot = runs.reduce((a, x) => a + x.e, 0), fired = runs.reduce((a, x) => a + x.rx, 0);
  const sd = Math.sqrt((0.15 * 0.85) / tot);
  chk('and the steric factor fires on 15% of the energetic ones',
      Math.abs(fired / tot - 0.15) < 3.5 * sd,
      `${fired} of ${tot} = ${(fired / tot).toFixed(4)}, want 0.15 ± ${(sd * 100).toFixed(2)}%`);
}

// ── The live page ────────────────────────────────────────────────────
{
  const shown = await page.evaluate(() => {
    const K = window.__kin;
    return { meas: document.getElementById('out-measured')?.textContent.trim(),
             theory: document.getElementById('out-theory')?.textContent.trim(),
             coll: document.getElementById('out-collisions')?.textContent.trim(),
             gt: document.getElementById('out-gastemp')?.textContent.trim(),
             f: K.measuredFraction(), honest: K.predictedFraction(),
             c: K.collisions(), gasT: K.gasTemperature(), T: K.params().T };
  });
  chk('the success-rate readout is the tally',
      Math.abs(parseFloat(shown.meas) - shown.f * 100) < 0.15
      && parseInt(shown.coll, 10) === shown.c, `${shown.meas} of ${shown.coll}`);
  chk('and the Boltzmann readout is taken at the measured temperature, not the dial',
      Math.abs(parseFloat(shown.theory) - shown.honest * 100) < 0.15, shown.theory);
  chk('the temperature readout shows what the gas reached beside what was asked for',
      /^\d+ \/ \d+$/.test(shown.gt)
      && Math.abs(parseFloat(shown.gt) - shown.gasT) < 1
      && parseInt(shown.gt.split('/')[1], 10) === shown.T, shown.gt);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const sig = async () => {
    await page.waitForTimeout(200);
    return page.evaluate(() => JSON.stringify([window.__kin.params(),
      document.getElementById('temp-value')?.textContent,
      document.getElementById('ea-value')?.textContent,
      document.getElementById('count-value')?.textContent,
      document.getElementById('out-theory')?.textContent]));
  };
  const dead = [];
  let before = await sig();
  for (const [id, v] of [['temp', 700], ['ea', 900], ['count', 40]]) {
    await setV(id, v);
    await page.evaluate(() => window.__kin.reset());
    const after = await sig();
    if (after === before) dead.push(id);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  await page.click('#reset-btn');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    c: window.__kin.collisions(), p: window.__kin.params(),
  }));
  chk('Reset restores the defaults and clears the tally',
      after.c === 0 && after.p.T === 300 && after.p.Ea === 400, JSON.stringify(after));
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  /*
   * Wait for the title to actually change rather than for a fixed number of
   * milliseconds. The zh dictionary is fetched on demand, and on a slow
   * machine 300 ms is not always enough — which shows up as ko and zh
   * reporting the same string and the check failing for no reason at all.
   */
  const lang = async (code, prev) => {
    await page.click(`.lang-btn[data-lang="${code}"]`);
    await page.waitForFunction(
      (p) => document.querySelector('h1').textContent.trim() !== p, prev,
      { timeout: 8000 },
    ).catch(() => {});
    return h1();
  };
  const en = await h1();
  const ko = await lang('ko', en);
  const zh = await lang('zh', ko);
  await lang('en', zh);
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
    await page.waitForTimeout(400);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('kinetics');
