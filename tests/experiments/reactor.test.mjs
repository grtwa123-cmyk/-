/*
 * Nuclear reactor.
 *
 * The page runs a mechanism — six delayed-neutron groups, three thermal
 * paths, thirteen decay-heat groups, xenon, Baker–Just oxidation, boil-off —
 * and every number it prints is supposed to come back out of that rather
 * than out of a formula. So the checks here are all of one shape: drive the
 * mechanism, read what it produces, and hold it against the closed form it
 * has never been told.
 *
 *   inhour       ρ = ωΛ + Σ βᵢω/(ω+λᵢ). Step the reactivity with the
 *                feedback held off, measure the asymptotic period off the
 *                flux, and put ω back through the equation.
 *   prompt jump  n → β/(β−ρ) in the first few milliseconds.
 *   feedback     a rod step settles where ρ_rod + α_F ΔT_F + α_M ΔT_C +
 *                ρ_Xe = 0. The xenon term is not optional: leaving it out
 *                made the balance miss by 98 pcm, because the extra flux
 *                burns xenon out and pays for half the rod.
 *   decay heat   after a scram, against Way–Wigner 0.066·t^(−0.2).
 *   xenon        the pit peaks at 1.88× equilibrium 8.3 h after shutdown,
 *                which the two-species chain has a closed form for.
 *   first law    everything in equals everything stored plus everything
 *                boiled off, over the whole accident, to a part in 10⁴.
 *   hydrogen     0.0442 kg per kg of zircaloy, from the stoichiometry.
 *
 * The bounds are not tolerances picked to pass. Every one of them was set by
 * planting the corresponding defect and watching the check go red — the two
 * that mattered are named at their check.
 */
import { browser, chk, url, finish, lang } from '../lib/harness.mjs';

const B = url('experiments/reactor.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__reactor);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const txt = (id) => page.evaluate((i) => document.getElementById(i)?.textContent.trim(), id);
const num = (s) => { const m = /-?\d+(\.\d+)?/.exec(s || ''); return m ? parseFloat(m[0]) : NaN; };
const setV = (id, v) => page.$eval('#' + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

// ── The reference state ───────────────────────────────────────────────
/*
 * Rated power has to mean something before anything else can be checked:
 * fission plus decay heat is P₀ exactly, and the three temperatures sit
 * where the heat-transfer coefficients were defined from. If this drifts,
 * every reactivity coefficient below is being applied to the wrong ΔT.
 */
{
  const r = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const { s } = R.run({ T: 2000, dt: 0.05 });
    return { n: s.n, TF: s.TF, TL: s.TL, TC: s.TC, TS: s.TS,
             tot: (s.pFis + s.pDec) / K.P0, K: { TF0: K.TF0, TL0: K.TL0, TC0: K.TC0 } };
  });
  chk('at rated power the core sits still: n = 1, and fission + decay = P₀',
      Math.abs(r.n - 1) < 1e-6 && Math.abs(r.tot - 1) < 1e-6,
      `n=${r.n.toFixed(8)} (P_fis+P_dec)/P0=${r.tot.toFixed(8)}`);
  chk('and at the temperatures the heat path was defined from',
      Math.abs(r.TF - r.K.TF0) < 0.01 && Math.abs(r.TL - r.K.TL0) < 0.01
      && Math.abs(r.TC - r.K.TC0) < 0.01 && Math.abs(r.TS - r.K.TC0) < 0.01,
      `TF=${r.TF.toFixed(3)} TL=${r.TL.toFixed(3)} TC=${r.TC.toFixed(3)} TS=${r.TS.toFixed(3)}`);
}

// ── Inhour ────────────────────────────────────────────────────────────
/*
 * The measurement is the slope of ln n once the transients have gone; the
 * closed form is the inhour equation, which the page also solves but from
 * the reactivity rather than from the flux. Putting the measured ω back
 * through the equation and comparing with the ρ that was inserted closes the
 * loop without either side being able to borrow from the other.
 *
 * Feedback is held off by running the kinetics alone — stepPK, not step —
 * because with feedback there is no asymptotic period to have.
 */
{
  const rows = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const inhour = (w) => w * K.L + K.BETA.reduce((a, b, i) => a + b * w / (w + K.LAM[i]), 0);
    const out = [];
    for (const pcm of [10, 50, 100, 200, 300, -50, -100, -200, -500]) {
      const rho = pcm / 1e5;
      const s = { n: 1, C: K.BETA.map((b, i) => b / (K.L * K.LAM[i])) };
      const settle = rho > 0 ? (rho > 2e-3 ? 300 : 1200) : 3000, dt = 1e-4;
      for (let t = 0; t < settle; t += dt) R.stepPK(s, rho, dt);
      const n1 = s.n;
      for (let t = 0; t < 10; t += dt) R.stepPK(s, rho, dt);
      const w = Math.log(s.n / n1) / 10;
      out.push({ pcm, T: 1 / w, back: inhour(w) * 1e5, page: R.inhour(rho) });
    }
    return out;
  });
  const worst = Math.max(...rows.map((r) => Math.abs(r.back / r.pcm - 1)));
  chk(`the measured period satisfies the inhour equation at ${rows.length} reactivities`,
      worst < 1e-3,
      rows.map((r) => `${r.pcm}pcm→T=${r.T.toFixed(2)}s→${r.back.toFixed(3)}pcm`).join(', '));
  const solverWorst = Math.max(...rows.map((r) => Math.abs(r.page / r.T - 1)));
  chk("and the page's own inhour solver lands on the same period",
      solverWorst < 1e-3,
      rows.map((r) => `${r.pcm}: measured ${r.T.toFixed(2)} vs solved ${r.page.toFixed(2)}`).join(', '));
}

// ── Prompt jump ───────────────────────────────────────────────────────
/*
 * β/(β−ρ) is a limit, not an identity: it assumes the prompt neutrons have
 * finished and the delayed ones have not started, which is only exactly true
 * as Λ → 0. At 20 ms and Λ = 20 μs the gap is a fraction of a percent, and it
 * grows with |ρ| as the approximation gets worse — which is itself the thing
 * worth seeing, so the bound is on the whole set rather than one point.
 */
{
  const rows = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    return [10, 50, 100, -50, -100, -200].map((pcm) => {
      const rho = pcm / 1e5;
      const s = { n: 1, C: K.BETA.map((b, i) => b / (K.L * K.LAM[i])) };
      for (let t = 0; t < 0.02; t += 1e-6) R.stepPK(s, rho, 1e-6);
      return { pcm, n: s.n, pj: K.B / (K.B - rho) };
    });
  });
  const worst = Math.max(...rows.map((r) => Math.abs(r.n / r.pj - 1)));
  chk('the flux jumps to β/(β − ρ) before the delayed neutrons arrive',
      worst < 0.003,
      rows.map((r) => `${r.pcm}pcm: ${r.n.toFixed(5)} vs ${r.pj.toFixed(5)}`).join(', '));
}

// ── Reactivity feedback ───────────────────────────────────────────────
/*
 * The core finds its own new power after a rod step, and the condition it
 * settles on is that the total reactivity is zero again. Recomputing that
 * total from the temperatures and the xenon — not reading the page's own ρ —
 * is what makes this a check rather than a tautology.
 */
{
  const rows = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    return [50, -100, -200].map((pcm) => {
      const { s } = R.run({ T: 20000, dt: 0.05, rod: pcm });
      const bal = pcm / 1e5 + K.aF * (s.TF - K.TF0) + K.aM * (s.TC - K.TC0)
                + K.XE_WORTH * (s.X - K.X_EQ) / K.X_EQ;
      return { pcm, n: s.n, TF: s.TF, TC: s.TC, bal: bal * 1e5 };
    });
  });
  const worst = Math.max(...rows.map((r) => Math.abs(r.bal)));
  chk('a rod step settles where ρ_rod + α_F ΔT_F + α_M ΔT_C + ρ_Xe = 0',
      worst < 0.5,
      rows.map((r) => `${r.pcm}pcm→n=${r.n.toFixed(4)} T_F=${r.TF.toFixed(1)} residual ${r.bal.toFixed(3)}pcm`).join(', '));
  chk('and the feedback is negative — more rod worth in, less power',
      rows.every((r, i) => i === 0 || r.n < rows[i - 1].n),
      rows.map((r) => `${r.pcm}:${r.n.toFixed(4)}`).join(' '));

  /*
   * −400 pcm has no steady state to settle on, and that is a result rather
   * than a limit of the run. Dropping the power builds xenon instead of
   * burning it, the xenon takes more reactivity than the cooling gives back,
   * and the reactor walks itself down to nothing. It is the transient that
   * stops a real plant from being restarted for a day, and no operator here
   * pulls a rod to answer it.
   */
  const deep = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const { s } = R.run({ T: 40000, dt: 0.05, rod: -400 });
    return { n: s.n, xe: K.XE_WORTH * (s.X - K.X_EQ) / K.X_EQ * 1e5 };
  });
  chk('a −400 pcm insertion cannot be held: xenon builds in and shuts it down',
      deep.n < 1e-4 && deep.xe < -400,
      `n = ${deep.n.toExponential(2)}, xenon has gone ${deep.xe.toFixed(0)} pcm below equilibrium`);
}

// ── Decay heat ────────────────────────────────────────────────────────
/*
 * The groups are integrated, so what comes out after a scram is whatever
 * they have left. Way–Wigner is the curve they were fitted to and it is not
 * consulted at run time; below 10 s the fit itself is worth 3.6% and the
 * bound says so rather than hiding it.
 */
{
  const rows = await page.evaluate(() => {
    const R = window.__reactor;
    const out = [];
    for (const T of [100, 1000, 10000, 100000, 1000000]) {
      const { s } = R.run({ T, dt: Math.min(0.05, T / 4000), scram: true, feed: 1 });
      let dec = 0; for (const d of s.D) dec += d;
      out.push({ T, dec, ww: R.wayWigner(T) });
    }
    return out;
  });
  const worst = Math.max(...rows.map((r) => Math.abs(r.dec / r.ww - 1)));
  /*
   * From 100 s on, because before that the reactor has not finished fissioning:
   * ten seconds after a scram the delayed neutrons still hold n near 3·10⁻³ and
   * are still feeding the groups, which puts the model 2.2% above a curve whose
   * derivation assumes the fission stopped instantly. That is the model being
   * right and Way–Wigner being idealised, not an error to bound away.
   */
  chk('the decay heat after a scram follows Way–Wigner over four decades',
      worst < 0.02,
      rows.map((r) => `${r.T}s: ${(100 * r.dec).toFixed(3)}% vs ${(100 * r.ww).toFixed(3)}%`).join(', '));
  chk('and it is still about 1% of rated an hour after shutdown',
      rows.find((r) => r.T === 1000).dec > 0.015 && rows.find((r) => r.T === 10000).dec < 0.012,
      rows.map((r) => `${r.T}s=${(100 * r.dec).toFixed(3)}%`).join(' '));
}

/*
 * And the part the comparison above cannot see. Way–Wigner is a function of
 * one variable, the time since shutdown; the groups are a function of the
 * whole power history. Two consequences follow that no t^(−0.2) can imitate,
 * and they are what stops the page from quietly printing the curve it is
 * being checked against.
 */
{
  const r = await page.evaluate(() => {
    const R = window.__reactor;
    /* dt = 1 s, not 10: the fastest group has λ = 0.316 s⁻¹ and the group
       update is explicit, so anything past 6.3 s is unstable. The page runs
       at 0.05 s and never goes near it, but a test driving the groups
       directly can. */
    const soak = (n, T) => {
      const s = { n, D: R.K.DA.map(() => 0) };
      for (let t = 0; t < T; t += 1) R.stepDecayHeat(s, 1);
      s.n = 0;
      const out = [];
      let t = 0;
      for (const until of [100, 1000, 10000, 100000]) {
        for (; t < until; t += 1) R.stepDecayHeat(s, 1);
        out.push(s.D.reduce((a, b) => a + b, 0));
      }
      return out;
    };
    const half = soak(0.5, 1e6), full = soak(1.0, 1e6), brief = soak(1.0, 3600);
    return { half, full, brief,
             ratio: full.map((v, i) => v / half[i]),
             shortfall: brief.map((v, i) => v / full[i]) };
  });
  const worst = Math.max(...r.ratio.map((x) => Math.abs(x - 2)));
  chk('half the power history leaves exactly half the decay heat, at every time after',
      worst < 1e-9,
      r.ratio.map((x, i) => `${[100, 1000, 10000, 100000][i]}s: ${x.toFixed(10)}`).join(', '));
  chk('and an hour-old core holds far less than a saturated one — the curve knows nothing of this',
      r.shortfall.every((x, i) => x < [0.75, 0.5, 0.25, 0.1][i]),
      r.shortfall.map((x, i) => `${[100, 1000, 10000, 100000][i]}s: ${(100 * x).toFixed(1)}%`).join(', '));
}

// ── Xenon ─────────────────────────────────────────────────────────────
/*
 * Equilibrium first, then the pit. After shutdown both species are pure
 * decay, so X(t) has a closed form; the page integrates the same chain with
 * the burnout term still in it and has to arrive at the same peak, at the
 * same hour.
 */
{
  const r = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const s = R.fresh();
    s.I = 0; s.X = 0;
    for (let t = 0; t < 3600 * 80; t += 2) R.stepXe(s, 2);
    const eqI = s.I, eqX = s.X;
    s.n = 0;
    let peak = 0, tp = 0;
    for (let t = 0; t < 3600 * 40; t += 2) {
      R.stepXe(s, 2);
      if (s.X > peak) { peak = s.X; tp = t; }
    }
    const X0 = eqX, I0 = K.I_EQ;
    const Xt = (t) => X0 * Math.exp(-K.lX * t)
      + I0 * K.lI / (K.lI - K.lX) * (Math.exp(-K.lX * t) - Math.exp(-K.lI * t));
    let bp = 0, bt = 0;
    for (let t = 0; t < 3600 * 40; t += 1) { const v = Xt(t); if (v > bp) { bp = v; bt = t; } }
    return { eqI, eqX, I_EQ: K.I_EQ, X_EQ: K.X_EQ,
             peak: peak / X0, tp: tp / 3600, bpeak: bp / X0, btp: bt / 3600,
             worth: K.XE_WORTH * 1e5, pitWorth: K.XE_WORTH * peak / X0 * 1e5 };
  });
  chk('iodine and xenon reach the equilibrium the balance equations give',
      Math.abs(r.eqI / r.I_EQ - 1) < 1e-3 && Math.abs(r.eqX / r.X_EQ - 1) < 1e-3,
      `I ${r.eqI.toExponential(4)} vs ${r.I_EQ.toExponential(4)}, `
      + `X ${r.eqX.toExponential(4)} vs ${r.X_EQ.toExponential(4)}`);
  chk('and after a scram the xenon pit peaks where the decay chain says it does',
      Math.abs(r.peak / r.bpeak - 1) < 2e-3 && Math.abs(r.tp - r.btp) < 0.1,
      `peak ${r.peak.toFixed(3)}× at ${r.tp.toFixed(2)} h vs ${r.bpeak.toFixed(3)}× at ${r.btp.toFixed(2)} h`);
  chk('the pit is deep enough to hold the reactor down — under −5000 pcm',
      r.pitWorth < -5000 && r.worth < -2000,
      `equilibrium ${r.worth.toFixed(0)} pcm, peak ${r.pitWorth.toFixed(0)} pcm`);
}

// ── The first law, over the whole accident ────────────────────────────
/*
 * Fission plus decay plus oxidation goes in; internal energy, latent heat of
 * melting, and the enthalpy carried off as steam come out. Nothing else. The
 * audit runs to the moment the vessel fails, because past that the model has
 * withdrawn and holds its thermal state on purpose.
 *
 * This is the check that found two real defects: the lower head was heating
 * on energy the coolant never gave up (2% of the accident), and clamping the
 * coolant to saturation was throwing the overshoot away.
 */
{
  const rows = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const out = [];
    for (const T of [1200, 2400, 3600, 5400, 7000]) {
      const s = R.fresh();
      s.scram = true; s.tScram = 0;
      const dt = 0.05, u = { rod: 0, feed: 0, eccs: 0 };
      let Ein = 0, boiled = 0, steps = 0;
      for (let k = 0; k < Math.round(T / dt) && !s.breach; k++) {
        const before = s.m;
        R.step(s, dt, u);
        Ein += (s.pFis + s.pDec + s.pOx) * dt;
        boiled += before - s.m;
        steps++;
      }
      const c = s.cover;
      const U = c * K.C_F * (s.z.w.TF - K.TF0) + (1 - c) * K.C_F * (s.z.d.TF - K.TF0)
              + c * K.C_L * (s.z.w.TL - K.TL0) + (1 - c) * K.C_L * (s.z.d.TL - K.TL0)
              + (c * s.z.w.f + (1 - c) * s.z.d.f) * K.M_UO2 * K.H_FUS
              + s.m * K.CP_H2O * (s.TC - K.TC0) + K.C_S * (s.TS - K.TC0);
      const steam = boiled * (K.HFG + K.CP_H2O * (K.TSAT - K.TC0));
      out.push({ T, t: steps * dt, Ein, err: (Ein - U - steam) / Ein });
    }
    return out;
  });
  const worst = Math.max(...rows.map((r) => Math.abs(r.err)));
  chk('the first law closes over the whole accident, to a part in 10⁴',
      worst < 1e-4,
      rows.map((r) => `${(r.t / 60).toFixed(0)}min: ${(r.Ein / 1e9).toFixed(1)}GJ in, ${(1e6 * r.err).toFixed(2)} ppm out`).join(', '));
}

// ── Station blackout: the sequence, and what it makes ──────────────────
{
  const r = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const { s } = R.run({ T: 12000, dt: 0.05, scram: true, feed: 0, eccs: 0 });
    return { marks: s.marks, h2: s.h2, W: s.W, W_FULL: K.W_FULL,
             zr: s.W * 1e-6 * K.ZR_AREA, ratio: s.h2 / (s.W * 1e-6 * K.ZR_AREA),
             expect: K.H2_PER_ZR, melted: s.melted, breach: s.breach, TS: s.TS,
             headE: K.C_S * (K.T_VESSEL - K.TC0) };
  });
  const M = r.marks;
  const order = ['sat', 'uncover', 'burst', 'bare', 'zr', 'melt', 'relocate', 'breach'];
  const have = order.filter((k) => M[k] !== undefined);
  chk('with no heat sink and no makeup the accident runs its whole course',
      have.length === order.length,
      have.map((k) => `${k} ${(M[k] / 60).toFixed(1)}min`).join(', '));
  chk('and in the order the physics requires it',
      M.sat < M.uncover && M.uncover < M.burst && M.burst < M.zr
      && M.zr < M.melt && M.melt <= M.relocate && M.relocate < M.breach,
      order.map((k) => `${k}=${(M[k] / 60).toFixed(1)}`).join(' '));
  /*
   * The cladding bursts BEFORE the core is fully bare — the top of it is out
   * of the water and heating while the bottom is still boiling. A single
   * lumped clad node cannot produce that: it averages the two heat-transfer
   * coefficients and holds the whole core a degree above saturation until
   * the last of the water has gone. This check is what a one-zone model
   * fails.
   */
  chk('the top of the core bursts while the bottom is still under water',
      M.burst < M.bare,
      `burst ${(M.burst / 60).toFixed(1)} min, fully uncovered ${(M.bare / 60).toFixed(1)} min`);
  /*
   * Against the periodic table, not against the page's own constant. The
   * first version of this check divided the page's hydrogen by the page's
   * zirconium and compared the answer with the page's conversion factor —
   * halving that factor changed all three and nothing failed. Zr + 2H₂O →
   * ZrO₂ + 2H₂ gives 2 × 2.01588 / 91.224 = 0.044196 kg per kg, and that
   * number lives here.
   */
  const STOICH = 2 * 2.01588 / 91.224;
  chk('hydrogen comes out at the stoichiometric 2·M(H₂)/M(Zr) per kg of zircaloy',
      Math.abs(r.ratio / STOICH - 1) < 0.005,
      `${r.h2.toFixed(1)} kg from ${r.zr.toFixed(0)} kg Zr — ratio ${r.ratio.toFixed(6)} `
      + `against ${STOICH.toFixed(6)}`);
  chk('the vessel fails once its lower head has absorbed C_S·ΔT of heat',
      r.breach && Math.abs(r.TS - 1700) < 1,
      `head at ${r.TS.toFixed(1)} K, ${(r.headE / 1e9).toFixed(1)} GJ`);
}

/*
 * The oxidation itself, which nothing above touches. Baker–Just is a
 * parabolic law — the oxide already grown slows the next increment — and the
 * page integrates the rate rather than evaluating the law, so integrating it
 * back out has to reproduce w² = A·e^(−B/RT)·t. The published constants are
 * written here rather than read off the page, so a wrong activation energy
 * is a failure instead of a matched pair.
 */
{
  const BJ = { A: 33.3e6, B: 45500, R: 1.987 };     // (mg/cm²)²/s, cal/mol, cal/mol/K
  const r = await page.evaluate((bj) => {
    const R = window.__reactor, K = R.K;
    const out = [];
    for (const T of [1200, 1500, 1800, 2100]) {
      let W = 0;
      const dt = 0.002, span = 20;
      for (let t = 0; t < span; t += dt) W += R.oxidationStep(W, T, dt);
      const kp = bj.A * Math.exp(-bj.B / (bj.R * T));
      out.push({ T, W, closed: Math.sqrt(kp * span) });
    }
    return { out, kpPage: K.BJ_A * Math.exp(-K.BJ_B / (K.RCAL * 1500)),
             kpLit: bj.A * Math.exp(-bj.B / (bj.R * 1500)) };
  }, BJ);
  const worst = Math.max(...r.out.map((q) => Math.abs(q.W / q.closed - 1)));
  chk('the integrated oxide reproduces the parabolic law at four temperatures',
      worst < 2e-3,
      r.out.map((q) => `${q.T}K: ${q.W.toFixed(3)} vs ${q.closed.toFixed(3)} mg/cm²`).join(', '));
  chk("and the page's rate constant is Baker–Just's, not something near it",
      Math.abs(r.kpPage / r.kpLit - 1) < 1e-6,
      `kp(1500 K) = ${r.kpPage.toExponential(4)} against ${r.kpLit.toExponential(4)}`);
  /*
   * And it has to run away. The reaction releases 6.42 MJ per kg of
   * zirconium, and above about 1500 K that is more heat than the whole decay
   * of the core — which is why a bare core does not simply come to some
   * warm equilibrium and sit there.
   */
  const runaway = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const at = (T) => {
      const dw = R.oxidationStep(1.0, T, 1);          // mg/cm²/s at 1 mg/cm²
      return dw * 1e-6 * K.ZR_AREA * K.H_OX;          // W
    };
    return { p1300: at(1300), p1500: at(1500), decay1h: 0.01 * K.P0 };
  });
  chk('above ~1500 K the metal-water reaction outruns the decay heat',
      runaway.p1300 < runaway.decay1h && runaway.p1500 > 3 * runaway.decay1h,
      `oxidation ${(runaway.p1300 / 1e6).toFixed(0)} MW at 1300 K and `
      + `${(runaway.p1500 / 1e6).toFixed(0)} MW at 1500 K, against `
      + `${(runaway.decay1h / 1e6).toFixed(0)} MW of decay heat`);
}

// ── The lower head's energy budget ────────────────────────────────────
{
  const r = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const s = R.fresh(); s.scram = true; s.tScram = 0;
    const dt = 0.05, u = { rod: 0, feed: 0, eccs: 0 };
    let E = 0;
    for (let k = 0; k < 400000 && !s.breach; k++) { R.step(s, dt, u); E += s.qCOR * dt; }
    return { E, pred: K.C_S * (K.T_VESSEL - K.TC0), breach: s.breach, t: s.t };
  });
  chk('what the head absorbed is exactly what it took to bring it to 1700 K',
      r.breach && Math.abs(r.E / r.pred - 1) < 1e-4,
      `${(r.E / 1e9).toFixed(3)} GJ absorbed vs ${(r.pred / 1e9).toFixed(3)} GJ predicted, at ${(r.t / 60).toFixed(1)} min`);
}

// ── Emergency injection is a real control, not a decoration ────────────
{
  const r = await page.evaluate(() => {
    const R = window.__reactor;
    const dry = R.run({ T: 9000, dt: 0.05, scram: true, feed: 0, eccs: 0 }).s;
    const wet = R.run({ T: 9000, dt: 0.05, scram: true, feed: 0, eccs: 40 }).s;
    return { dryTL: dry.TL, dryMelt: dry.melted, dryLvl: dry.m,
             wetTL: wet.TL, wetMelt: wet.melted, wetLvl: wet.m,
             wetMarks: Object.keys(wet.marks) };
  });
  chk('40 kg/s of makeup keeps the core covered and stops the meltdown',
      r.wetMelt === 0 && r.wetTL < 700 && r.dryMelt > 0.9,
      `with injection: clad ${r.wetTL.toFixed(0)} K, melted ${r.wetMelt.toFixed(3)}; `
      + `without: clad ${r.dryTL.toFixed(0)} K, melted ${r.dryMelt.toFixed(3)}`);
}

// ── Convergence: the step is an instrument setting, not a result ────────
/*
 * The page integrates at 0.05 s and refines to 0.02 s on the Fine quality
 * setting. If the answer moved between them, the timeline would be a
 * property of the step size rather than of the plant.
 */
{
  const r = await page.evaluate(() => {
    const at = (dt) => {
      const { s } = window.__reactor.run({ T: 9000, dt, scram: true, feed: 0, eccs: 0 });
      return { melt: s.marks.melt, burst: s.marks.burst, h2: s.h2 };
    };
    return { coarse: at(0.1), std: at(0.05), fine: at(0.02) };
  });
  const rel = (a, b) => Math.abs(a / b - 1);
  chk('halving the step does not move the accident',
      rel(r.coarse.melt, r.fine.melt) < 0.01 && rel(r.std.melt, r.fine.melt) < 0.005
      && rel(r.std.burst, r.fine.burst) < 0.005,
      `melt at ${[r.coarse, r.std, r.fine].map((q) => (q.melt / 60).toFixed(2)).join(' / ')} min `
      + `for dt = 0.1 / 0.05 / 0.02 s`);
}

// ── What the panel says is what the model did ─────────────────────────
/*
 * Everything above drives the model through the hook. These read the page —
 * the readouts a person actually sees — and check they carry the same
 * numbers, because a correct model behind a stale panel is still a wrong
 * page.
 */
{
  /*
   * In a blackout, not a clean shutdown. With the heat sink still working a
   * scrammed plant settles with the cladding four tenths of a degree above
   * the coolant, and the readout check below cannot tell them apart —
   * wiring out-tl to the coolant temperature passed. Seventy minutes into a
   * blackout they are five hundred degrees apart.
   */
  await setV('feed', 0);
  await setV('eccs', 0);
  await page.evaluate(() => {
    const R = window.__reactor;
    R.reset(); R.scram(); R.setRunning(false);
    for (let k = 0; k < 420; k++) R.advance(200);   // 70 min of plant time
  });
  await page.waitForTimeout(120);
  const st = await page.evaluate(() => {
    const s = window.__reactor.state();
    let dec = 0; for (const d of s.D) dec += d;
    return { t: s.t, dec, TL: s.TL, TC: s.TC, h2: s.h2,
             ww: window.__reactor.wayWigner(s.t - s.tScram) };
  });
  const shown = {
    dec: num(await txt('out-decay')), ww: num(await txt('out-decay-ww')),
    tl: num(await txt('out-tl')), clock: await txt('out-clock'),
  };
  /* Against Σ D_j, not against the page's own pDec: those are the same
     number only if the readout really is the groups, which is the thing
     being checked. Substituting the Way–Wigner formula for the groups is
     invisible to the comparison two blocks up and shows up here. */
  chk('the decay-heat readout is the decay heat the groups are holding',
      Math.abs(shown.dec / (100 * st.dec) - 1) < 0.002,
      `panel ${shown.dec}% vs model ${(100 * st.dec).toFixed(3)}%`);
  chk('and the Way–Wigner figure beside it is the curve at the same instant',
      Math.abs(shown.ww / (100 * st.ww) - 1) < 0.002
      && Math.abs(shown.dec / shown.ww - 1) < 0.02,
      `panel ${shown.ww}% vs ${(100 * st.ww).toFixed(3)}%; measured/curve = `
      + `${(shown.dec / shown.ww).toFixed(4)}`);
  chk('the cladding readout is the cladding, not the coolant beside it',
      Math.abs(shown.tl - st.TL) < 1 && st.TL - st.TC > 300,
      `panel ${shown.tl} K vs clad ${st.TL.toFixed(1)} K, coolant ${st.TC.toFixed(1)} K`);

  /*
   * The one the Way–Wigner comparison cannot make. Substituting
   * 0.066·t^(−0.2) for the groups is invisible to every check that compares
   * the two, because the groups were fitted to that curve and agree with it
   * to a tenth of a percent wherever the fit is good. What the curve does
   * not know is the power history: run the reactor at half power for six
   * hours and the decay heat falls with it, while a function of the time
   * since the trip cannot move at all.
   */
  await setV('feed', 100);
  await page.evaluate(() => { window.__reactor.reset(); });
  await setV('rod', -200);
  const full = num(await txt('out-decay'));
  await page.evaluate(() => {
    const R = window.__reactor;
    R.setRunning(false);
    for (let k = 0; k < 440; k++) R.advance(1000);    // 22000 s at reduced power
  });
  await page.waitForTimeout(120);
  const low = await page.evaluate(() => ({
    dec: parseFloat(document.getElementById('out-decay').textContent),
    n: window.__reactor.state().n,
  }));
  chk('the decay heat on the panel falls with the power the core has been run at',
      Math.abs(full - 7.093) < 0.01 && low.n < 0.6 && low.dec > 3.5 && low.dec < 5.5,
      `${full}% at rated, ${low.dec}% after six hours at ${(100 * low.n).toFixed(0)}%`);
  await setV('rod', 0);
}

// ── The measured period is measured ───────────────────────────────────
/*
 * The two halves of the period readout come from different places on
 * purpose: the left is a least-squares slope through the flux the page has
 * actually seen, the right is the inhour equation solved from the
 * reactivity.
 *
 * They are compared after a scram, which is the one place a power reactor
 * has an asymptotic period at all. At full power it does not: the fuel
 * heats in about three seconds, so a rod step is cancelled by Doppler
 * before any exponential establishes itself, and the readout correctly says
 * ∞. Once the trip is in and the temperatures have settled, ρ stops moving
 * and the flux decays on the longest precursor — −80 s, whatever the rod
 * worth, which is the reason a reactor cannot be turned off quickly.
 */
{
  await page.evaluate(() => {
    const R = window.__reactor;
    R.reset(); R.scram(); R.setRunning(false);
    for (let k = 0; k < 400; k++) R.advance(100);    // 2000 s of plant time
  });
  await page.waitForTimeout(120);
  const meas = num(await txt('out-period'));
  const theory = num(await txt('out-period-theory'));
  chk('after a scram the measured period is the inhour period of the reactivity',
      isFinite(meas) && isFinite(theory) && meas < 0 && Math.abs(meas / theory - 1) < 0.05,
      `measured ${meas} s, inhour ${theory} s`);
  chk('and it is the longest precursor that sets it, not the rod worth',
      Math.abs(meas + 80.6) < 4,
      `${meas} s against −1/λ₁ = −80.6 s`);

  /*
   * And the left half is genuinely read off the flux. Rewriting only the
   * history the page kept — the reactivity untouched — has to move the
   * measurement and leave the inhour solution exactly where it was. A page
   * that printed the solved value twice would pass every tolerance above.
   */
  const moved = await page.evaluate(() => {
    const R = window.__reactor, s = R.state();
    const before = { m: R.measuredPeriod(s), t: R.inhour(s.rho) };
    s.lnHist = s.lnHist.map((q) => ({ t: q.t, ln: q.ln * 0.5 }));
    return { before, T: R.measuredPeriod(s), Ti: R.inhour(s.rho) };
  });
  chk('and the measured half moves when the flux history does, while the inhour half does not',
      Math.abs(moved.T / moved.before.m - 1) > 0.5
      && Math.abs(moved.Ti / moved.before.t - 1) < 1e-9,
      `measured ${moved.before.m.toFixed(1)} → ${moved.T.toFixed(1)} s; `
      + `inhour ${moved.before.t.toFixed(1)} → ${moved.Ti.toFixed(1)} s`);
}

// ── Reset, reduced motion, and the languages ──────────────────────────
{
  await setV('feed', 0);
  await setV('eccs', 0);
  await page.evaluate(() => {
    const R = window.__reactor; R.reset(); R.scram(); R.setRunning(false);
    for (let k = 0; k < 280; k++) R.advance(500);    // 7000 s: past the burst
  });
  const hot = await page.evaluate(() => window.__reactor.state().h2);
  await page.click('#reset-btn');
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => {
    const s = window.__reactor.state();
    return { t: s.t, h2: s.h2, TF: s.TF, melted: s.melted, m: s.m, scram: s.scram,
             breach: s.breach, cover: s.cover };
  });
  chk('Reset puts the plant back at rated power with a clean core',
      hot > 0 && after.h2 === 0 && after.t === 0 && after.melted === 0
      && !after.scram && !after.breach && after.cover === 1,
      `was ${hot.toFixed(0)} kg H₂; now t=${after.t} h2=${after.h2} melted=${after.melted}`);
}

{
  for (const code of ['ko', 'zh', 'en']) {
    await lang(page, code);
    const bad = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[data-i18n]')) {
        const t = el.textContent.trim();
        if (!t || /^[a-z]{2,3}[A-Z]\w+$/.test(t)) out.push(el.getAttribute('data-i18n'));
      }
      return out;
    });
    chk(`every label is translated in ${code}`, bad.length === 0, bad.slice(0, 5).join(', '));
  }
}

chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));
await finish('reactor');
