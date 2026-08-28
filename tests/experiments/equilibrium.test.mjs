import { browser, chk, rows, url, finish, lang } from '../lib/harness.mjs';

const B = url('experiments/equilibrium.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(B, { waitUntil:'networkidle' });
await page.waitForTimeout(500);
chk('page loads without console errors', errs.length===0, errs.slice(0,2).join(' | '));

const setV = (id,v) => page.$eval('#'+id,(el,val)=>{el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},v);
const txt = id => page.evaluate(i=>document.getElementById(i)?.textContent.trim(), id);

// p is built the way params() does, from the two barriers alone.
const MK = `const E = window.__eq;
  const mk = (o) => { const T=o.T??300, dH=o.dH??-12, Ea=E.EA-(o.cat??0);
    return { T, dH, cat:o.cat??0, Ea, V:o.V??100,
      kf: E.PREFACTOR*Math.exp(-Ea/(E.R*T)),
      kr: E.PREFACTOR*Math.exp(-E.DS/E.R)*Math.exp(-(Ea-dH)/(E.R*T)) }; };`;

// ── The headline: K is counted, not entered ───────────────────────────
{
  // Particle counts and volume are both scaled by 3, so the concentrations —
  // and therefore K and the equilibrium position — are untouched while the
  // counting noise falls. At the default 300 molecules a strongly
  // product-favoured setting leaves only ~28 A and ~28 B, and Q is the ratio
  // to their *product*, so the finite-size bias reaches 9%. That is a real
  // effect of a small system, not an error in the chemistry, and the check
  // below measures it directly.
  const SCALE = 3;
  const r = await page.evaluate(new Function(`${MK}
    const S = ${SCALE};
    const cases = [
      {T:300,dH:-12}, {T:300,dH:-16}, {T:350,dH:-12}, {T:420,dH:-12},
      {T:500,dH:-12}, {T:300,dH:-12,V:50}, {T:300,dH:-12,V:200}, {T:380,dH:-18},
    ];
    // Five settles per condition, averaged. One run's residual reaches 4-5%
    // at the product-favoured end even at this size, so a 6% bound on a single
    // sample is barely one and a third sigma of scatter — it went red on CI at
    // 6.6% on a mixture that was sitting exactly where it should. The mean of
    // five is what the bound is on.
    const REPS = 5;
    return cases.map(c => {
      const p = mk({ ...c, V: (c.V ?? 100) * S });
      let Q = 0, fwd = 0, rev = 0, C = 0, A = Infinity;
      for (let k = 0; k < REPS; k++) {
        const s = E.settle(p, { nA:300*S, nB:300*S, burn:40, span:60 });
        Q += s.Q / REPS; fwd += s.fwd; rev += s.rev; C += s.C / REPS;
        A = Math.min(A, s.A);
      }
      return { ...c, K: E.predictedK(p), Q, fwd, rev, C, A };
    });`));
  const err = r.map((x) => Math.abs(x.Q - x.K) / x.K);
  chk('the counted mixture settles where [C]/([A][B]) = k₀/k₋ (8 conditions)',
      Math.max(...err) < 0.06,
      r.map((x,i)=>`T${x.T}/dH${x.dH}:${(err[i]*100).toFixed(1)}%`).join(' '));
  chk('every run reached a genuine equilibrium, not exhaustion',
      r.every((x) => x.fwd > 2500 && x.rev > 2500),
      r.map(x=>`${x.fwd}/${x.rev}`).join(' '));
  chk('equilibrium is dynamic: forward and reverse fire equally often',
      r.every((x) => Math.abs(x.fwd/x.rev - 1) < 0.12),
      r.map(x=>(x.fwd/x.rev).toFixed(3)).join(' '));
}

// ── The residual is finite-size, and it vanishes as the system grows ──
{
  // Twenty replicates per size, not five. The trend is a factor of two or
  // three across the range and each replicate carries about that much scatter
  // on its own, so five of them resolve nothing — the first attempt at this
  // check reported 2.2 / 4.9 / 3.0 / 2.3 % and would have been a coin toss in
  // CI. The runs are pure computation and cost almost nothing.
  const r = await page.evaluate(new Function(`${MK}
    // dH = −16 leaves only a few dozen A and B at equilibrium in a small
    // vessel, which is where Q = [C]/([A][B]) is most sensitive: it is the
    // ratio to their product, so both scarcities compound.
    return [1, 2, 4, 8].map(S => {
      const p = mk({ dH:-16, V:100*S });
      let acc = 0, leftA = Infinity;
      for (let k = 0; k < 20; k++) {
        const s = E.settle(p, { nA:300*S, nB:300*S, burn:40, span:60 });
        acc += Math.abs(s.Q - E.predictedK(p)) / E.predictedK(p);
        leftA = Math.min(leftA, s.A);
      }
      return { S, N: 300*S, leftA, err: acc/20 };
    });`));
  chk('the residual shrinks as the system grows — it is finite-size, not error',
      r[3].err < r[0].err * 0.6,
      r.map(x=>`N${x.N}(${x.leftA.toFixed(0)} left):${(x.err*100).toFixed(1)}%`).join(' '));
  chk('in the largest system the counted K is within 4% of k₀/k₋',
      r[3].err < 0.04, `${(r[3].err*100).toFixed(2)}%`);
}

// ── Thermodynamics behind K ───────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const lnK = (T,dH) => Math.log(E.predictedK(mk({T,dH})));
    // van 't Hoff: ln K against 1/T is a straight line of slope −ΔH°/R
    const fits = [-30,-18,-6,6].map(dH => {
      const pts = [280,320,360,420,480,560].map(T => [1/T, lnK(T,dH)]);
      const n=pts.length, sx=pts.reduce((a,q)=>a+q[0],0), sy=pts.reduce((a,q)=>a+q[1],0);
      const sxx=pts.reduce((a,q)=>a+q[0]*q[0],0), sxy=pts.reduce((a,q)=>a+q[0]*q[1],0);
      const slope=(n*sxy-sx*sy)/(n*sxx-sx*sx);
      const inter=(sy-slope*sx)/n;
      return { dH, slope, want: -dH/E.R, inter, wantInter: E.DS/E.R };
    });
    return fits;`));
  chk("van 't Hoff: d(ln K)/d(1/T) = −ΔH°/R for every enthalpy",
      r.every((x) => Math.abs(x.slope - x.want) / Math.abs(x.want) < 1e-9),
      r.map(x=>`${x.dH}:${x.slope.toFixed(1)}/${x.want.toFixed(1)}`).join(' '));
  chk("van 't Hoff intercept is ΔS°/R",
      r.every((x) => Math.abs(x.inter - x.wantInter) < 1e-9),
      `${r[0].inter.toFixed(4)} vs ${r[0].wantInter.toFixed(4)}`);
}

// ── A catalyst changes the road, not the destination ──────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    return [0, 5, 10, 14].map(cat => {
      const p = mk({ cat });
      return { cat, K: E.predictedK(p), kf: p.kf,
               t: E.timeToEquilibrium(p),
               C: E.settle(p, { burn:40, span:60 }).C };
    });`));
  const K0 = r[0].K;
  chk('a catalyst leaves K exactly unchanged',
      r.every((x) => Math.abs(x.K - K0) / K0 < 1e-12),
      r.map(x=>`${x.cat}:${x.K.toFixed(6)}`).join(' '));
  chk('a catalyst leaves the equilibrium concentrations alone',
      r.every((x) => Math.abs(x.C - r[0].C) / r[0].C < 0.05),
      r.map(x=>x.C.toFixed(1)).join(' '));
  chk('but it gets there far sooner — over 50× at the far end',
      r[3].t * 50 < r[0].t && r.every((x,i,a) => i===0 || x.t < a[i-1].t),
      r.map(x=>`${x.cat}kJ:${x.t.toExponential(2)}`).join(' '));
}

// ── Le Chatelier, every disturbance a result ──────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const at = (o, init) => {
      const p = mk(o);
      return { K: E.predictedK(p), ...E.settle(p, { ...init, burn:40, span:60 }) };
    };
    const base = at({}, { nA:300, nB:300 });
    return {
      base,
      moreA:    at({}, { nA:600, nB:300 }),
      compress: at({ V:50 },  { nA:300, nB:300 }),
      expand:   at({ V:200 }, { nA:300, nB:300 }),
      exoHot:   at({ T:520, dH:-12 }, { nA:300, nB:300 }),
      exoCold:  at({ T:270, dH:-12 }, { nA:300, nB:300 }),
      endoHot:  at({ T:520, dH:6 },   { nA:300, nB:300 }),
      endoCold: at({ T:270, dH:6 },   { nA:300, nB:300 }),
      startFromC: at({}, { nA:0, nB:0, nC:300 }),
    };`));
  chk('adding A makes more C', r.moreA.C > r.base.C * 1.05,
      `${r.base.C.toFixed(1)} → ${r.moreA.C.toFixed(1)}`);
  chk('adding A does not change K', Math.abs(r.moreA.K - r.base.K) < 1e-12, '');
  chk('compressing shifts to the side with fewer molecules',
      r.compress.C > r.base.C && r.expand.C < r.base.C,
      `${r.expand.C.toFixed(1)} ← ${r.base.C.toFixed(1)} → ${r.compress.C.toFixed(1)}`);
  chk('a change of volume does not change K',
      Math.abs(r.compress.K - r.base.K) < 1e-12 && Math.abs(r.expand.K - r.base.K) < 1e-12, '');
  chk('heating an exothermic reaction drives it back',
      r.exoHot.C < r.exoCold.C && r.exoHot.K < r.exoCold.K,
      `C ${r.exoCold.C.toFixed(0)} → ${r.exoHot.C.toFixed(0)}, K ${r.exoCold.K.toFixed(2)} → ${r.exoHot.K.toFixed(2)}`);
  chk('heating an endothermic reaction drives it forward',
      r.endoHot.C > r.endoCold.C && r.endoHot.K > r.endoCold.K,
      `C ${r.endoCold.C.toFixed(1)} → ${r.endoHot.C.toFixed(1)}, K ${r.endoCold.K.toExponential(1)} → ${r.endoHot.K.toExponential(1)}`);
  chk('temperature is the only thing that moves K itself',
      Math.abs(r.exoHot.K - r.base.K) > 1e-6, '');
  // The same equilibrium must be reached from either side — the strongest
  // statement that it is an equilibrium and not just where the run stopped.
  //
  // One run of each is not enough to say so: a single settled Q carries about
  // 3% of scatter, so two of them differ by ~5% on average and occasionally by
  // fifteen. Average a dozen from each side and compare the means against the
  // spread those replicates actually showed, rather than against a number
  // picked in advance.
  {
    const s = await page.evaluate(new Function(`${MK}
      const stats = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length;
        const sd = Math.sqrt(v.reduce((s2, x) => s2 + (x - m) ** 2, 0) / (v.length - 1));
        return { m, sd, se: sd / Math.sqrt(v.length) }; };
      const many = (init) => stats(Array.from({ length: 12 }, () =>
        E.settle(mk({}), { ...init, burn: 40, span: 60 }).Q));
      return { ab: many({ nA: 300, nB: 300 }), c: many({ nA: 0, nB: 0, nC: 300 }) };`));
    const gap = Math.abs(s.ab.m - s.c.m);
    const bound = 4 * Math.hypot(s.ab.se, s.c.se);
    chk('starting from pure C reaches the same equilibrium as starting from A + B',
        gap < bound,
        `Q ${s.ab.m.toFixed(4)} ± ${s.ab.se.toFixed(4)} from A+B, ` +
        `${s.c.m.toFixed(4)} ± ${s.c.se.toFixed(4)} from C — ` +
        `gap ${gap.toFixed(4)} against a 4σ bound of ${bound.toFixed(4)}`);
  }
}

// ── The live page ─────────────────────────────────────────────────────
{
  // A clean page, not a reload: the controls now live in the query string,
  // so reloading would bring back whatever the last section left set.
  await page.goto(B, { waitUntil:'networkidle' }); await page.waitForTimeout(300);
  await setV('speed', 8);
  await page.waitForFunction(() => {
    const t = document.getElementById('out-k').textContent;
    return /[\d.]/.test(t) && !/…/.test(t);
  }, { timeout: 45000 }).catch(()=>{});
  const measured = parseFloat(await txt('out-k'));
  const predicted = parseFloat(await txt('out-kpred'));
  chk('the page measures K from its own counts and it matches k₀/k₋',
      Number.isFinite(measured) && Math.abs(measured - predicted) / predicted < 0.12,
      `measured ${measured} vs k₀/k₋ ${predicted}`);
  /*
   * Counted over a window, not since the page opened.
   *
   * The tallies run from the first step, and the first thing the mixture does
   * is rush one way to reach equilibrium — a head start to the forward count
   * equal to the net displacement, which never goes away. So the cumulative
   * ratio is not 1 and is not meant to be; it decays towards 1 as the
   * transient is diluted, and how far it has got depends on how fast the
   * machine ran. Measured: cumulative 1.191 at four seconds, 1.068 at eight,
   * 1.029 at sixteen, against a 15% bound — which is why this failed on a
   * slow run. Over a window taken after equilibrium the same three
   * measurements are 1.001, 1.001 and 0.989.
   *
   * Five seconds gives about 1600 events each way, so the Poisson noise on
   * the ratio is 3.5% and the bound below is four sigma.
   */
  const evA = await page.evaluate(()=>window.__eq.events());
  await page.waitForTimeout(5000);
  const evB = await page.evaluate(()=>window.__eq.events());
  const fwd = evB.fwd - evA.fwd, rev = evB.rev - evA.rev;
  chk('both directions keep firing at equilibrium, at the same rate',
      fwd > 1000 && rev > 1000 && Math.abs(fwd/rev - 1) < 0.15,
      `${fwd} fwd / ${rev} rev over five seconds — ratio ${(fwd/rev).toFixed(3)}`);
  // The measured K settles as soon as the quotient stops drifting, which can
  // be a little before Q has actually arrived. Wait for arrival, not for the
  // readout to appear.
  await page.waitForFunction(() => {
    const s = window.__eq.state();
    const K = window.__eq.predictedK(window.__eq.params());
    return Math.abs(s.q - K) / K < 0.05;
  }, { timeout: 45000 }).catch(()=>{});
  chk('the direction readout says equilibrium',
      /equilibrium|평형|平衡/.test(await txt('out-shift')), await txt('out-shift'));
}
{
  // Injecting A must push Q below K and then let it walk back.
  // Freeze first. At ×8 the mixture re-equilibrates inside a single poll, so
  // reading the disturbance while it runs is a race the test loses — it saw Q
  // already back above K and called the injection a no-op.
  await page.evaluate(()=>window.__eq.setRunning(false));
  await page.waitForTimeout(120);
  const before = await page.evaluate(()=>window.__eq.state());
  await page.click('#add-a-btn'); await page.waitForTimeout(120);
  const kicked = await page.evaluate(()=>({ ...window.__eq.state(),
    K: window.__eq.predictedK(window.__eq.params()) }));
  chk('injecting A knocks Q below K', kicked.q < kicked.K * 0.95,
      `Q ${kicked.q.toFixed(3)} vs K ${kicked.K.toFixed(3)}`);
  chk('and the readout says which way it will go',
      /making C|C 생성|生成 C/.test(await txt('out-shift')), await txt('out-shift'));
  await page.evaluate(()=>window.__eq.setRunning(true));
  await page.waitForFunction(() => {
    const s = window.__eq.state();
    const K = window.__eq.predictedK(window.__eq.params());
    return Math.abs(s.q - K) / K < 0.08;
  }, { timeout: 45000 }).catch(()=>{});
  const settled = await page.evaluate(()=>({ ...window.__eq.state(),
    K: window.__eq.predictedK(window.__eq.params()) }));
  chk('Q walks back to K on its own', Math.abs(settled.q - settled.K)/settled.K < 0.08,
      `Q ${settled.q.toFixed(3)} vs K ${settled.K.toFixed(3)}`);
  chk('and there is more C than before the injection', settled.C > before.C,
      `${before.C} → ${settled.C}`);
}
{
  await page.click('#pause-btn'); await page.waitForTimeout(300);
  const a = await page.evaluate(()=>window.__eq.state().t);
  await page.waitForTimeout(600);
  const b = await page.evaluate(()=>window.__eq.state().t);
  chk('Pause stops the simulation clock', Math.abs(b-a) < 1e-9, `${a} → ${b}`);
  await page.click('#pause-btn'); await page.waitForTimeout(300);
  const c = await page.evaluate(()=>window.__eq.state().t);
  chk('Resume starts it again', c > b, `${b} → ${c}`);
}
{
  // Two traps here, and this check fell into both.
  //
  // The catalyst's whole point is that it leaves K and the equilibrium
  // concentrations alone, so a snapshot of A/B/C/K reports it dead exactly
  // when it works. And the piston changes neither the molecule counts nor K
  // nor kf — it changes the volume, and only the *concentrations* that
  // follow from it. With the clock running the counts drift on their own
  // between the two snapshots, so the check passed for a reason that had
  // nothing to do with the control being alive, and reported "volume" dead
  // whenever the drift happened to come out even.
  //
  // Freeze the clock, and hold every control to the thing it actually
  // changes in the model — the whole parameter set, plus the counts for the
  // two that rebuild the mixture and the button that injects into it.
  await page.evaluate(() => window.__eq.setRunning(false));
  const sig = async () => {
    await page.waitForTimeout(140);
    return page.evaluate(() => {
      const p = window.__eq.params(), s = window.__eq.state();
      return JSON.stringify([p.T, p.dH, p.cat, p.Ea, p.V,
        p.kf.toExponential(6), p.kr.toExponential(6), s.A, s.B, s.C]);
    });
  };
  const dead = [];
  const acts = [
    ['temp', () => setV('temp', 480)],
    ['dh', () => setV('dh', -20)],
    ['volume', () => setV('volume', 60)],
    ['catalyst', () => setV('catalyst', 10)],
    ['na0', () => setV('na0', 500)],
    ['nb0', () => setV('nb0', 150)],
    ['inject C', () => page.click('#add-c-btn')],
  ];
  let before = await sig();
  for (const [name, act] of acts) {
    await act();
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length===0, dead.join(','));
  await page.evaluate(() => window.__eq.setRunning(true));
  // Reset restarts the run, so C is only zero for an instant. Clicking and
  // freezing have to happen in the same task: as two round trips a frame lands
  // between them and the reaction is already a dozen molecules along by the
  // time anyone looks.
  await page.evaluate(() => {
    document.getElementById('reset-btn').click();
    window.__eq.setRunning(false);
  });
  await page.waitForTimeout(150);
  const after = await page.evaluate(()=>window.__eq.state());
  const want = await page.evaluate(()=>parseInt(document.getElementById('na0').value, 10));
  chk('Reset restores the starting mixture',
      after.C === 0 && after.A === want, JSON.stringify(after));
}
{
  const h1 = () => page.evaluate(()=>document.querySelector('h1').textContent.trim());
  const en = await h1();
  await lang(page, 'ko');
  const ko = await h1();
  await lang(page, 'zh');
  const zh = await h1();
  await lang(page, 'en');
  chk('title translates en/ko/zh and returns', ko!==en && zh!==en && zh!==ko && (await h1())===en,
      `${en} | ${ko} | ${zh}`);
  const bad = await page.evaluate(()=>{ const b=[];
    document.querySelectorAll('[data-i18n]').forEach(el=>{ if(!window.i18n.t(el.dataset.i18n)) b.push(el.dataset.i18n); });
    return b; });
  chk('every data-i18n key resolves', bad.length===0, bad.join(','));
}
{
  /*
   * Start it first. The block above leaves the page frozen, and this check
   * used to pass anyway because the dots drifted outside the running gate —
   * so it was asserting that a stopped page still moves, which was true and
   * was the bug. With the gate closed it fails unless the clock is running,
   * which is what it was always meant to say.
   */
  await page.evaluate(() => window.__eq.setRunning(true));
  await page.waitForTimeout(200);
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot(); await page.waitForTimeout(700); const b = await shot();
  chk('canvas animates', a!==b && a.length>3000, `len ${a.length}`);
}
chk('no console errors after the whole run', errs.length===0, errs.slice(0,3).join(' | '));
await page.close();

for (const w of [320, 390, 768]) {
  const p = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(B, { waitUntil:'networkidle' });
  await p.waitForTimeout(500);
  const o = await p.evaluate(()=>({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  chk(`no horizontal overflow at ${w}px`, o.doc <= o.win+1, `doc=${o.doc} win=${o.win}`);
  await p.close();
}

await finish('Chemical equilibrium');
