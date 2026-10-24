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
 * Fission plus decay plus oxidation goes in, with the enthalpy of any water
 * injected; internal energy, latent heat of melting, the enthalpy carried off
 * as steam and the heat the steam generator takes come out. Nothing else.
 * Every node is in the sum — both zones of standing rods, the pool in the
 * lower head, the coolant, the head — and every path a reader can take,
 * because the leaks this found were all on paths the plain blackout never
 * walks:
 *
 *   - the lower head heating on energy the coolant never gave up (2% of the
 *     accident, found by the first version of this check);
 *   - a dry vessel: the standing rods went on "losing" heat to a coolant
 *     with no mass, and the boil-off clamp threw it away (3 MW);
 *   - a trickle of injection: each step's kilogram of water was credited
 *     with boiling off far more heat than it can carry (20 MW).
 *
 * Each run stops at the breach, past which the model holds its thermal state
 * on purpose.
 */
{
  const rows = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const CC = K.C_F + K.C_L;
    const U = (s) => {
      const wI = s.fuelIn * s.cover, dI = s.fuelIn * (1 - s.cover);
      const rods = (z, m) => m * (K.C_F * (z.TF - K.TF0) + K.C_L * (z.TL - K.TL0)
                                  + z.f * K.M_UO2 * K.H_FUS);
      return rods(s.z.w, wI) + rods(s.z.d, dI)
           + s.cor.mass * (K.C_F * (s.cor.T - K.TF0) + K.C_L * (s.cor.T - K.TL0)
                           + s.cor.f * K.M_UO2 * K.H_FUS)
           + s.m * K.CP_H2O * (s.TC - K.TC0) + K.C_S * (s.TS - K.TC0);
    };
    const paths = {
      'blackout':              () => ({ feed: 0, eccs: 0 }),
      'injection at 90 min':   (t) => ({ feed: 0, eccs: t > 5400 ? 60 : 0 }),
      'injection 90→110 min':  (t) => ({ feed: 0, eccs: t > 5400 && t < 6600 ? 60 : 0 }),
      'feed back at 90 min':   (t) => ({ feed: t > 5400 ? 1 : 0, eccs: 0 }),
      'a 20 kg/s trickle':     () => ({ feed: 0, eccs: 20 }),
    };
    const out = [];
    for (const [name, ctl] of Object.entries(paths)) {
      const s = R.fresh();
      s.scram = true; s.tScram = 0;
      const dt = 0.05, U0 = U(s);
      let Ein = 0, Eout = 0;
      for (let k = 0; k < 6 * 3600 / dt && !s.breach; k++) {
        const m0 = s.m, c = ctl(s.t);
        R.step(s, dt, { rod: 0, ...c });
        Ein += (s.pFis + s.pDec + s.pOx) * dt;
        Eout += s.steam * dt * (K.HFG + K.CP_H2O * (K.TSAT - K.TC0)) + s.qSG * dt;
        const injected = s.m - (m0 - s.steam * dt);   // arrives at the coolant temperature
        if (injected > 0) Ein += injected * K.CP_H2O * (s.TC - K.TC0);
      }
      out.push({ name, t: s.t, Ein, err: (Ein - (U(s) - U0) - Eout) / Ein,
                 reloc: s.cor.mass, breach: s.breach });
    }
    return out;
  });
  const worst = Math.max(...rows.map((r) => Math.abs(r.err)));
  chk(`the first law closes on ${rows.length} paths through the accident, to a part in 10⁴`,
      worst < 1e-4,
      rows.map((r) => `${r.name} (${(r.t / 60).toFixed(0)} min): ${(1e6 * r.err).toFixed(1)} ppm`).join(', '));
}

// ── Station blackout: the sequence, and what it makes ──────────────────
{
  const r = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const { s } = R.run({ T: 12000, dt: 0.05, scram: true, feed: 0, eccs: 0 });
    return { marks: s.marks, h2: s.h2, zr: s.zr, ratio: s.h2 / s.zr,
             breach: s.breach, TS: s.TS, m: s.m, ox: s.zr / K.M_ZR };
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
  /*
   * The vessel fails at 1700 K and only once the water has gone. The head
   * used to stop exchanging heat with the water the moment corium landed on
   * it, so it failed with ten tonnes still in the vessel — and turning the
   * injection back on made no difference to when.
   */
  chk('the vessel fails at 1700 K, and only once the water has gone',
      r.breach && Math.abs(r.TS - 1700) < 1 && r.m === 0,
      `head at ${r.TS.toFixed(1)} K with ${r.m.toFixed(0)} kg of water left, at ${(M.breach / 60).toFixed(0)} min`);
  /*
   * And the oxidation stops of its own accord, near where TMI-2's did.
   * Nothing is tuned to put it there: it stops when the melted core pours
   * out of the steam into the lower head, and the pool there has no
   * cladding wall to burn. The model used to treat the pool as the same
   * zone it came from, so it went on burning over all 560 m² of a wall that
   * no longer existed until every gram of the zircaloy had gone, and heated
   * itself to 4800 K doing it.
   */
  chk('the cladding stops oxidising part-way, when the melted core leaves the steam',
      r.ox > 0.25 && r.ox < 0.7,
      `${(100 * r.ox).toFixed(1)}% of the zircaloy oxidised, ${r.h2.toFixed(0)} kg of hydrogen (TMI-2: ~45%)`);
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
    let Ein = 0, Eout = 0;
    for (let k = 0; k < 400000 && !s.breach; k++) {
      R.step(s, dt, u); Ein += s.qCOR * dt; Eout += s.qHeadW * dt;
    }
    return { Ein, Eout, pred: K.C_S * (K.T_VESSEL - K.TC0), breach: s.breach, t: s.t };
  });
  chk('what the head kept of the heat it was given is exactly what brought it to 1700 K',
      r.breach && Math.abs((r.Ein - r.Eout) / r.pred - 1) < 1e-4 && r.Eout > 0.1 * r.Ein,
      `${(r.Ein / 1e9).toFixed(1)} GJ in from the corium, ${(r.Eout / 1e9).toFixed(1)} GJ out to the water, `
      + `${((r.Ein - r.Eout) / 1e9).toFixed(3)} GJ kept vs C_S·ΔT = ${(r.pred / 1e9).toFixed(3)} GJ`);
}

// ── Emergency injection is a real control, not a decoration ────────────
{
  const r = await page.evaluate(() => {
    const R = window.__reactor;
    const dry = R.run({ T: 9000, dt: 0.05, scram: true, feed: 0, eccs: 0 }).s;
    const wet = R.run({ T: 9000, dt: 0.05, scram: true, feed: 0, eccs: 40 }).s;
    return { dryTL: dry.TL, drySlump: dry.slumped, dryLvl: dry.m,
             wetTL: wet.TL, wetSlump: wet.slumped, wetLvl: wet.m,
             wetMarks: Object.keys(wet.marks) };
  });
  /* Slumped, not melted: corium that has poured into the lower head and
     refrozen there is not molten any more, and it is not a core either. */
  chk('40 kg/s of makeup keeps the core covered and stops the meltdown',
      r.wetSlump === 0 && r.wetTL < 700 && r.drySlump > 0.9,
      `with injection: clad ${r.wetTL.toFixed(0)} K, slumped ${r.wetSlump.toFixed(3)}; `
      + `without: clad ${r.dryTL.toFixed(0)} K, slumped ${r.drySlump.toFixed(3)}`);
}

// ── Recovery: what happens when the water comes back ──────────────────
/*
 * Everything above runs the accident forward with nothing done about it.
 * These turn the water back on part-way, which is what a reader does next
 * and which nothing tested — and every defect found on the second pass over
 * this page was on one of these paths.
 */
{
  const r = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const STEAM = 2 * 18.015 / 91.224;               // Zr + 2H₂O, from the periodic table
    const paths = {
      'blackout':               () => ({ feed: 0, eccs: 0 }),
      'injection at 60 min':    (t) => ({ feed: 0, eccs: t > 3600 ? 60 : 0 }),
      'injection at 90 min':    (t) => ({ feed: 0, eccs: t > 5400 ? 60 : 0 }),
      'injection at 106 min':   (t) => ({ feed: 0, eccs: t > 6360 ? 60 : 0 }),
      'injection 90→110 min':   (t) => ({ feed: 0, eccs: t > 5400 && t < 6600 ? 60 : 0 }),
      'feed back at 90 min':    (t) => ({ feed: t > 5400 ? 1 : 0, eccs: 0 }),
      'both back at 95 min':    (t) => ({ feed: t > 5700 ? 1 : 0, eccs: t > 5700 ? 60 : 0 }),
      'a 20 kg/s trickle':      () => ({ feed: 0, eccs: 20 }),
      'no scram (ATWS)':        () => ({ feed: 0, eccs: 0 }),
    };
    const out = {};
    for (const [name, ctl] of Object.entries(paths)) {
      const s = R.fresh();
      if (name !== 'no scram (ATWS)') { s.scram = true; s.tScram = 0; }
      const dt = 0.05;
      let peak = 0, steamUse = 0, standMin = 1, standGrew = 0, zrAfter95 = 0, zrAt95 = null;
      let oxPeakSlump = 0, oxAt98 = null;
      for (let k = 0; k < 6 * 3600 / dt && !s.breach; k++) {
        const steamPrev = s.steam, zr0 = s.zr;
        R.step(s, dt, { rod: 0, ...ctl(s.t) });
        peak = Math.max(peak, s.TL, s.TFpeak);
        const burnt = s.zr - zr0;
        if (burnt > 0) steamUse = Math.max(steamUse, burnt * STEAM / Math.max(steamPrev * dt, 1e-30));
        const standing = s.fuelIn - (s.slumped - s.cor.mass);
        if (standing > standMin + 1e-9) standGrew = Math.max(standGrew, standing - standMin);
        standMin = Math.min(standMin, standing);
        if (s.t >= 5700 && zrAt95 === null) zrAt95 = s.zr;
        if (!s.relocated && s.z.d.g > 0) {
          oxPeakSlump = Math.max(oxPeakSlump, s.pOx);
          if (oxAt98 === null && s.z.d.g >= 0.98) oxAt98 = s.pOx;
        }
      }
      out[name] = { peak, steamUse, standGrew, breach: s.breach, reloc: s.cor.mass,
                    oxFade: oxAt98 === null ? null : oxAt98 / oxPeakSlump,
                    standing: s.fuelIn, zrAfter95: zrAt95 === null ? 0 : s.zr - zrAt95,
                    breachMin: s.breach ? s.marks.breach / 60 : null };
    }
    return out;
  });
  const names = Object.keys(r);

  /*
   * A ceiling the physics sets, not one picked to pass: nothing here models
   * vaporisation, so nothing may get hotter than UO₂ boils. On the paths the
   * reader can reach, the cladding used to: 4813 K in the plain blackout,
   * 5305 K with injection at 90 minutes, 6526 K once a melted top was left
   * hanging above the returning water with no heat path at all.
   */
  const hot = names.map((n) => [n, r[n].peak]);
  chk(`nothing in the vessel gets hotter than UO₂ boils (3815 K), on ${names.length} paths`,
      hot.every(([, T]) => T < 3815),
      hot.map(([n, T]) => `${n} ${T.toFixed(0)} K`).join(', '));

  /*
   * Zr + 2H₂O: 0.395 kg of steam per kg of zircaloy, and the steam rising
   * through the core is what boiled off below it the step before. With the
   * heat sink restored the water goes subcooled, nothing boils — and 24
   * tonnes of zirconium used to oxidise anyway, because the only gate was
   * "there is still some water".
   */
  chk('the cladding never burns more steam than the core is boiling',
      names.every((n) => r[n].steamUse <= 1 + 1e-9),
      names.map((n) => `${n} ${r[n].steamUse.toFixed(3)}`).join(', '));
  /*
   * Only on the path where nothing does boil. With injection as well, the
   * water rising onto rods at 2000 K quench-boils faster than the steam
   * generator can cool it, and the cladding burns in that steam — TMI-2's
   * reflood made its biggest burst of hydrogen exactly this way. The check
   * above holds every path to the steam it had; this one shows the
   * steam-starved case stopping dead.
   */
  chk('and once the water is subcooled and nothing boils, it stops',
      r['feed back at 90 min'].zrAfter95 < 0.01,
      `zirconium burnt after 95 min with the feed back: ${r['feed back at 90 min'].zrAfter95.toFixed(4)} kg `
      + `(with injection too, the quench boils and ${r['both back at 95 min'].zrAfter95.toFixed(3)} kg burns in it)`);

  /*
   * Fuel that slumps takes its cladding surface with it, so the reaction on
   * it dies away as it goes rather than running at full rate until the
   * instant it relocates. In the plain blackout something else would see to
   * that anyway — slumped fuel stops boiling the water, and with no steam
   * the steam limit starves the reaction — so it shows where the steam keeps
   * coming regardless: a reflood. There, without the surface factor, the top
   * of the core was still burning at 65% of its peak with 98% of it slumped.
   */
  const fade = r['injection at 90 min'].oxFade;
  chk('in a reflood, the reaction on the slumping top dies away with its cladding',
      fade !== null && fade < 0.1,
      `oxidation at 98% slumped: ${fade === null ? 'never reached' : (100 * fade).toFixed(1) + '% of its peak'}`);

  /* Refrozen debris is a lump. It gets back neither its surface nor its
     place in the drawing — the rods used to redraw themselves as the
     corium in the lower head froze. */
  chk('fuel that has slumped never stands up again',
      names.every((n) => r[n].standGrew === 0),
      names.filter((n) => r[n].standGrew > 0).map((n) => `${n} +${r[n].standGrew.toFixed(4)}`).join(', ') || 'never');

  /*
   * TMI-2's ending. Water came back while the top of the core was melting;
   * the melted part poured into a lower head that still held water, the
   * rest stayed standing in it, and the vessel held. The relocation rule
   * used to need the whole core molten, which left the melted top hanging
   * above the water line — and the head stopped exchanging heat with the
   * water once corium arrived, so injection at 106 minutes failed the
   * vessel at the same minute as no injection at all.
   */
  const tmi = r['injection at 90 min'];
  chk('injection at 90 minutes ends like TMI-2: the top relocates, the bottom stands, the vessel holds',
      !tmi.breach && tmi.reloc > 0.2 && tmi.reloc < 0.95 && tmi.standing > 0.05,
      `${(100 * tmi.reloc).toFixed(0)}% relocated, ${(100 * tmi.standing).toFixed(0)}% still standing, `
      + `vessel ${tmi.breach ? 'failed' : 'intact'}`);
  chk('and water that outruns the boil-off holds the vessel even after the core has melted',
      r.blackout.breach && !r['injection at 106 min'].breach && r['injection at 106 min'].reloc > 0.99,
      `blackout fails at ${r.blackout.breachMin.toFixed(0)} min; injection at 106 min: `
      + `${(100 * r['injection at 106 min'].reloc).toFixed(0)}% relocated, vessel `
      + `${r['injection at 106 min'].breach ? 'failed' : 'intact'}`);
  chk('while water that cannot keep up only delays it',
      r['injection 90→110 min'].breach
      && r['injection 90→110 min'].breachMin > r.blackout.breachMin,
      `injection from 90 to 110 min then off: fails at ${r['injection 90→110 min'].breachMin?.toFixed(0)} min `
      + `instead of ${r.blackout.breachMin.toFixed(0)}`);
}

/*
 * The coolant solve has to survive the reader restoring the feed to a vessel
 * that is nearly dry. Explicit in the coolant temperature, the steam
 * generator's coupling goes unstable below about 545 kg of water and the
 * temperature swings by 10⁵ K a step.
 */
{
  const r = await page.evaluate(() => {
    const R = window.__reactor, K = R.K;
    const s = R.fresh(); s.scram = true; s.tScram = 0;
    for (let k = 0; k < 1e6 && s.m > 3 && !s.breach; k++) R.step(s, 0.05, { rod: 0, feed: 0, eccs: 0 });
    const m0 = s.m;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 20000; k++) {
      R.step(s, 0.05, { rod: 0, feed: 1, eccs: 0 });
      lo = Math.min(lo, s.TC); hi = Math.max(hi, s.TC);
    }
    return { m0, lo, hi, TSEC: K.TSEC, TSAT: K.TSAT };
  });
  chk('restoring the feed to a nearly dry vessel leaves the coolant between the two temperatures it can reach',
      r.lo >= r.TSEC - 1e-6 && r.hi <= r.TSAT + 1e-6,
      `${r.m0.toFixed(1)} kg of water: T_C stayed in ${r.lo.toFixed(1)}–${r.hi.toFixed(1)} K`);
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

// ── A steady reactor reads as steady ──────────────────────────────────
/*
 * Two small lies the panel told about a reactor sitting exactly critical.
 * The measured period printed "—", meaning no data, beside the inhour
 * side's "∞" after a full minute of perfectly flat flux — flat is a
 * measurement. And toFixed keeps the sign of a value that rounds to zero,
 * so the reactivity read "-0.0 pcm".
 */
{
  await page.evaluate(() => {
    const R = window.__reactor;
    R.reset(); R.setRunning(false);
    for (let k = 0; k < 60; k++) R.advance(40);       // two minutes at power
  });
  await page.waitForTimeout(120);
  const shown = {
    period: await txt('out-period'), theory: await txt('out-period-theory'),
    rho: await txt('out-rho'), parts: await txt('out-rho-parts'), xe: await txt('out-xe'),
  };
  chk('a steady reactor reads ∞ on both halves of the period, not "no data" on one',
      shown.period === '∞' && shown.theory === '∞',
      `measured "${shown.period}", inhour "${shown.theory}"`);
  chk('and no readout prints a negative zero',
      ![shown.rho, shown.parts, shown.xe].some((t) => /(^|[^\d])-0(\.0+)?(?![\d.])/.test(t)),
      `ρ "${shown.rho}", parts "${shown.parts}", Xe "${shown.xe}"`);
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
