import { browser, chk, rows, url, BASE as BASE_URL, finish, lang } from '../lib/harness.mjs';

const B = url('experiments/enzyme.html');

const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(B, { waitUntil:'networkidle' });
await page.waitForTimeout(600);
chk('page loads without console errors', errs.length===0, errs.slice(0,2).join(' | '));

const setV = (id,v) => page.$eval('#'+id,(el,val)=>{el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},v);
const txt = id => page.evaluate(i=>document.getElementById(i)?.textContent.trim(), id);

// The harness builds p exactly the way params() does, so it exercises the same
// derivation of k₋₁ from Kₘ that the page uses.
const MK = `const M = window.__mm;
  const mk = (o) => ({ S:o.S, Km:o.Km, kcat:o.kcat, nE:o.nE,
    kOff: M.K1*o.Km - o.kcat, Et:o.nE/M.OMEGA, Vmax:(o.kcat*o.nE)/M.OMEGA,
    i: o.i||0, type: o.type||'none' });`;

// ── Closed forms ──────────────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const o = {};
    // v is exactly half of Vmax at [S] = Kₘ — the definition of Kₘ
    o.half = [[10,5,2],[25,20,12],[60,33,7],[100,40,24]].map(([Km,kcat,nE]) => {
      const p = mk({ S:Km, Km, kcat, nE });
      return Math.abs(M.mmRate(p.S, Km, p.Vmax) - p.Vmax/2);
    });
    // saturation
    o.sat = [[25,20,12],[100,5,3]].map(([Km,kcat,nE]) => {
      const p = mk({ S:Km*1e7, Km, kcat, nE });
      return Math.abs(M.mmRate(p.S, Km, p.Vmax)/p.Vmax - 1);
    });
    // Kₘ = (k₋₁ + kcat)/k₁ must come back out of the constants we hand the sim
    o.kmBack = []; o.kOffMin = Infinity;
    for (let Km = 10; Km <= 100; Km++) for (let kcat = 5; kcat <= 40; kcat++) {
      const p = mk({ S:1, Km, kcat, nE:1 });
      o.kOffMin = Math.min(o.kOffMin, p.kOff);
      o.kmBack.push(Math.abs((p.kOff + kcat)/M.K1 - Km));
    }
    o.kmBack = Math.max(...o.kmBack);
    // α = 1 + [I]/Kᵢ
    o.alpha = [0,0.5,2,5].map(i => Math.abs(M.alpha(mk({S:1,Km:25,kcat:20,nE:12,type:'competitive',i})) - (1+i)));
    // The three signatures, read off the Lineweaver–Burk line 1/v = (Kₘ/Vmax)x + 1/Vmax
    const base = mk({ S:1, Km:25, kcat:20, nE:12 });
    const lb = (p) => { const a = M.apparent(p); return { yInt: 1/a.Vmax, xInt: -1/a.Km, slope: a.Km/a.Vmax, ...a }; };
    const b = lb(base);
    o.sig = [0.5, 1, 2, 5].map(i => {
      const c = lb(mk({S:1,Km:25,kcat:20,nE:12,type:'competitive',i}));
      const n = lb(mk({S:1,Km:25,kcat:20,nE:12,type:'noncompetitive',i}));
      const u = lb(mk({S:1,Km:25,kcat:20,nE:12,type:'uncompetitive',i}));
      return {
        i,
        compY: Math.abs(c.yInt - b.yInt), compKm: Math.abs(c.Km - base.Km*(1+i)),
        nonX: Math.abs(c.xInt - b.xInt),                     // competitive must MOVE it
        noncX: Math.abs(n.xInt - b.xInt), noncV: Math.abs(n.Vmax - base.Vmax/(1+i)),
        noncYmoved: Math.abs(n.yInt - b.yInt),
        unSlope: Math.abs(u.slope - b.slope),
        unBoth: Math.abs(u.Km - base.Km/(1+i)) + Math.abs(u.Vmax - base.Vmax/(1+i)),
      };
    });
    return o;`));
  chk('v = Vₘₐₓ/2 exactly at [S] = Kₘ (4 enzymes)', r.half.every(d=>d<1e-14),
      r.half.map(d=>d.toExponential(1)).join(' '));
  chk('v → Vₘₐₓ at saturation', r.sat.every(d=>d<1e-6), r.sat.map(d=>d.toExponential(1)).join(' '));
  chk('Kₘ = (k₋₁+kcat)/k₁ over the whole control range (3276 combinations)', r.kmBack < 1e-12,
      `worst ${r.kmBack.toExponential(1)}`);
  chk('k₋₁ stays positive over the whole control range', r.kOffMin > 0, `min k₋₁ = ${r.kOffMin}`);
  chk('α = 1 + [I]/Kᵢ', r.alpha.every(d=>d<1e-15), '');
  chk('competitive inhibitor keeps 1/Vₘₐₓ and scales Kₘ by α',
      r.sig.every(x => x.compY < 1e-15 && x.compKm < 1e-12 && x.nonX > 1e-3),
      r.sig.map(x=>`i${x.i}:${x.compY.toExponential(0)}`).join(' '));
  chk('non-competitive inhibitor keeps −1/Kₘ and divides Vₘₐₓ by α',
      r.sig.every(x => x.noncX < 1e-15 && x.noncV < 1e-12 && x.noncYmoved > 1e-3),
      r.sig.map(x=>`i${x.i}:${x.noncX.toExponential(0)}`).join(' '));
  chk('uncompetitive inhibitor leaves the slope alone and divides both constants',
      r.sig.every(x => x.unSlope < 1e-15 && x.unBoth < 1e-12),
      r.sig.map(x=>`i${x.i}:${x.unSlope.toExponential(0)}`).join(' '));
}

// ── The headline: the counted rate must come out as the rate law ───────
{
  const r = await page.evaluate(new Function(`${MK}
    const run = (o, T) => {
      const p = mk(o);
      M.rebuild(p);
      for (let t = 0; t < T; t += 1) M.step(Math.min(t+1, T), p);
      return { v: M.measuredRate(), want: M.predicted(p), n: M.stats().turnovers, p };
    };
    const cases = [
      { S:2,   Km:25, kcat:20, nE:24 },
      { S:12,  Km:25, kcat:20, nE:24 },
      { S:25,  Km:25, kcat:20, nE:24 },   // exactly half-max
      { S:80,  Km:25, kcat:20, nE:24 },
      { S:250, Km:25, kcat:20, nE:24 },
      { S:50,  Km:100, kcat:5,  nE:24 },
      { S:50,  Km:10,  kcat:40, nE:24 },
      { S:30,  Km:60,  kcat:12, nE:8  },
    ];
    return { plain: cases.map(c => run(c, 400)),
             half: run({ S:25, Km:25, kcat:20, nE:24 }, 400) };`));
  const err = r.plain.map(x => Math.abs(x.v - x.want)/x.want);
  // Each configuration counts a different number of turnovers, so each has its
  // own noise floor: 1/√n. A flat 2% band is four sigma at [S] = 250 but only
  // two and a half at [S] = 2, where 400 s buys just 14000 events — and that
  // is where it went red on CI, at 2.09%, on a rate that was correct. The
  // bound is four sigma of the count the run actually made.
  const tol = r.plain.map(x => Math.max(0.01, 4/Math.sqrt(x.n)));
  chk('counted turnovers reproduce v = Vₘₐₓ[S]/(Kₘ+[S]) — 8 configurations, 400 s each',
      err.every((e,i) => e < tol[i]),
      r.plain.map((x,i)=>`S${x.p.S}:${(err[i]*100).toFixed(2)}%/${(tol[i]*100).toFixed(2)}%`).join('  '));
  chk('the counted rate at [S] = Kₘ is half the counted maximum',
      Math.abs(r.half.v/(r.half.p.Vmax/2) - 1) < 0.02,
      `${r.half.v.toFixed(3)} vs Vₘₐₓ/2 = ${(r.half.p.Vmax/2).toFixed(3)}`);
  chk('every run actually counted a large number of events',
      r.plain.every(x => x.n > 5000), r.plain.map(x=>x.n).join(' '));
}

// ── Inhibition has to emerge too, not be applied to the answer ─────────
{
  const r = await page.evaluate(new Function(`${MK}
    const run = (o, T) => {
      const p = mk(o);
      M.rebuild(p);
      for (let t = 0; t < T; t += 1) M.step(Math.min(t+1, T), p);
      const a = M.apparent(p);
      return { v: M.measuredRate(), want: M.predicted(p), type: p.type, i: p.i, S: p.S,
               Km: a.Km, Vmax: a.Vmax };
    };
    const out = [];
    for (const type of ['competitive','noncompetitive','uncompetitive'])
      for (const i of [1, 3])
        for (const S of [10, 60, 250])
          out.push(run({ S, Km:25, kcat:20, nE:24, type, i }, 400));
    return out;`));
  const e = r.map(x => Math.abs(x.v - x.want)/x.want);
  const worst = Math.max(...e);
  chk('counted rate matches the apparent constants for all three inhibitors (18 runs)',
      worst < 0.03,
      `worst ${(worst*100).toFixed(2)}% :: ` +
      r.map((x,i)=>`${x.type[0]}${x.i}@${x.S}:${(e[i]*100).toFixed(1)}%`).join(' '));
  // A competitive inhibitor must be outcompeted by substrate; an uncompetitive
  // one must not be. That is the qualitative signature, and it is a result here.
  const rel = (t, S) => { const x = r.find(y=>y.type===t && y.i===3 && y.S===S); return x; };
  const compLo = rel('competitive',10), compHi = rel('competitive',250);
  const unLo = rel('uncompetitive',10), unHi = rel('uncompetitive',250);
  const frac = (x, Km0, Vm0) => x.v / ((Vm0*x.S)/(Km0+x.S));
  chk('substrate outcompetes a competitive inhibitor but not an uncompetitive one',
      frac(compHi,25,48) > frac(compLo,25,48) + 0.2 && frac(unHi,25,48) < frac(unLo,25,48),
      `comp ${frac(compLo,25,48).toFixed(2)}→${frac(compHi,25,48).toFixed(2)}, ` +
      `uncomp ${frac(unLo,25,48).toFixed(2)}→${frac(unHi,25,48).toFixed(2)}`);
}

// ── Steady-state occupancy of the four states ──────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const occupancy = (o) => {
      const p = mk(o);
      M.rebuild(p);
      M.step(2, p);                       // past the transient
      const c = [0,0,0,0]; let n = 0;
      let t = 2;
      for (let k = 0; k < 6000; k++) {
        t += 0.02; M.step(t, p);
        for (const s of M.stats().states) { c[s]++; n++; }
      }
      const s = p.S/p.Km, i = p.type === 'none' ? 0 : p.i;
      let w;
      if (p.type === 'competitive')         w = [1, s, i, 0];
      else if (p.type === 'noncompetitive') w = [1, s, i, s*i];
      else if (p.type === 'uncompetitive')  w = [1, s, 0, s*i];
      else                                  w = [1, s, 0, 0];
      const tot = w.reduce((a,b)=>a+b,0);
      return { type: o.type||'none', got: c.map(x=>x/n), want: w.map(x=>x/tot) };
    };
    return [
      occupancy({ S:25,  Km:25, kcat:20, nE:24 }),
      occupancy({ S:100, Km:25, kcat:20, nE:24 }),
      occupancy({ S:25,  Km:25, kcat:20, nE:24, type:'competitive', i:2 }),
      occupancy({ S:25,  Km:25, kcat:20, nE:24, type:'noncompetitive', i:2 }),
      occupancy({ S:25,  Km:25, kcat:20, nE:24, type:'uncompetitive', i:2 }),
    ];`));
  const worst = Math.max(...r.map(x => Math.max(...x.got.map((g,k)=>Math.abs(g-x.want[k])))));
  chk('steady-state occupancy of E/ES/EI/ESI matches the mechanism (5 conditions)',
      worst < 0.02,
      r.map(x=>`${x.type}:[${x.got.map(g=>g.toFixed(3)).join(',')}] want [${x.want.map(g=>g.toFixed(3)).join(',')}]`).join('  '));
  const none = r[0];
  chk('with [S] = Kₘ exactly half the enzyme is carrying substrate',
      Math.abs(none.got[1] - 0.5) < 0.02, none.got[1].toFixed(4));
}

// ── Convergence: the error is statistics, and it shrinks as √N ─────────
{
  const r = await page.evaluate(new Function(`${MK}
    const err = (T) => {
      const p = mk({ S:25, Km:25, kcat:20, nE:24 });
      let acc = 0;
      for (let k = 0; k < 24; k++) {
        M.rebuild(p);
        for (let t = 0; t < T; t += 1) M.step(Math.min(t+1, T), p);
        acc += Math.abs(M.measuredRate() - M.predicted(p))/M.predicted(p);
      }
      return acc/24;
    };
    return [1, 10, 100].map(err);`));
  chk('the residual is sampling noise: it falls as the assay gets longer',
      r[0] > r[1] && r[1] > r[2] && r[2] < 0.01 && r[0] > 0.01,
      r.map((e,k)=>`${[1,10,100][k]}s:${(e*100).toFixed(2)}%`).join('  '));
}

// ── The Lineweaver–Burk fit ────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const o = {};
    // exact points must be recovered exactly
    const Km = 34, Vmax = 19;
    M.setPoints([4,9,20,45,110,250].map(S => ({ S, v: M.mmRate(S, Km, Vmax), n: 1 })));
    const f = M.fitFromPoints();
    o.exact = { dKm: Math.abs(f.Km - Km), dV: Math.abs(f.Vmax - Vmax), n: f.n };
    // fewer than three points is not a fit
    M.setPoints([{S:10,v:1,n:1},{S:20,v:2,n:1}]);
    o.tooFew = M.fitFromPoints();
    // a simulated series
    const p = mk({ S:25, Km:25, kcat:20, nE:24 });
    const pts = [];
    for (const S of [4,8,16,32,64,128,250]) {
      const q = mk({ S, Km:25, kcat:20, nE:24 });
      M.rebuild(q);
      for (let t = 0; t < 120; t += 1) M.step(Math.min(t+1,120), q);
      pts.push({ S, v: M.measuredRate(), n: M.stats().turnovers });
    }
    M.setPoints(pts);
    const g = M.fitFromPoints();
    o.sim = { Km: g.Km, Vmax: g.Vmax, wantKm: 25, wantVmax: p.Vmax };
    M.setPoints([]);
    return o;`));
  chk('the fit recovers Kₘ and Vₘₐₓ exactly from exact points',
      r.exact.dKm < 1e-9 && r.exact.dV < 1e-9 && r.exact.n === 6,
      `ΔKₘ ${r.exact.dKm.toExponential(1)}, ΔVₘₐₓ ${r.exact.dV.toExponential(1)}`);
  chk('fewer than three points gives no fit', r.tooFew === null, String(r.tooFew));
  chk('the fit recovers the constants from a simulated series',
      Math.abs(r.sim.Km - 25)/25 < 0.15 && Math.abs(r.sim.Vmax - r.sim.wantVmax)/r.sim.wantVmax < 0.10,
      `Kₘ ${r.sim.Km.toFixed(2)}/25, Vₘₐₓ ${r.sim.Vmax.toFixed(2)}/${r.sim.wantVmax}`);
}

// ── The live page ─────────────────────────────────────────────────────
await page.goto(B, { waitUntil:'networkidle' }); await page.waitForTimeout(500);
{
  await setV('substrate', 25); await setV('km', 25); await setV('kcat', 20); await setV('enzymes', 12);
  await page.waitForTimeout(300);
  chk('readout: Vₘₐₓ apparent = kcat·[E]ᴛ = 24.00 µM/s', (await txt('out-vmax'))==='24.00', await txt('out-vmax'));
  chk('readout: Kₘ apparent = 25.0 µM', (await txt('out-km'))==='25.0', await txt('out-km'));
  chk('readout: Michaelis–Menten prediction is Vₘₐₓ/2 at [S] = Kₘ',
      (await txt('out-predicted'))==='12.000', await txt('out-predicted'));

  await page.click('#inhibitor-list .mol-btn[data-key="competitive"]');
  await setV('iratio', 2); await page.waitForTimeout(300);
  chk('competitive inhibitor at [I]/Kᵢ = 2 triples Kₘ and leaves Vₘₐₓ',
      (await txt('out-km'))==='75.0' && (await txt('out-vmax'))==='24.00',
      `Kₘ ${await txt('out-km')}, Vₘₐₓ ${await txt('out-vmax')}`);
  await page.click('#inhibitor-list .mol-btn[data-key="noncompetitive"]'); await setV('iratio', 2);
  await page.waitForTimeout(300);
  chk('non-competitive inhibitor thirds Vₘₐₓ and leaves Kₘ',
      (await txt('out-km'))==='25.0' && (await txt('out-vmax'))==='8.00',
      `Kₘ ${await txt('out-km')}, Vₘₐₓ ${await txt('out-vmax')}`);
  await page.click('#inhibitor-list .mol-btn[data-key="uncompetitive"]'); await setV('iratio', 2);
  await page.waitForTimeout(300);
  chk('uncompetitive inhibitor thirds both constants',
      (await txt('out-km'))==='8.3' && (await txt('out-vmax'))==='8.00',
      `Kₘ ${await txt('out-km')}, Vₘₐₓ ${await txt('out-vmax')}`);
  await page.click('#inhibitor-list .mol-btn[data-key="none"]'); await page.waitForTimeout(200);
  chk('the [I]/Kᵢ slider is hidden when there is no inhibitor',
      await page.evaluate(()=>document.getElementById('ratio-control').hidden), '');
}
{
  // The regression that mattered: changing a control must not stall the clock.
  await setV('kcat', 30); await page.waitForTimeout(900);
  const s = await page.evaluate(()=>window.__mm.stats());
  chk('the sim keeps counting after a control changes (rebuild rewinds the clock)',
      s.simT > 0.3 && s.turnovers > 20, `t=${s.simT.toFixed(2)}s, ${s.turnovers} turnovers`);
  await setV('kcat', 20); await page.waitForTimeout(200);
}
{
  await page.click('#reset-btn'); await page.waitForTimeout(200);
  // Wait on the count, not on the clock. A fixed sleep gives however much
  // simulated time the machine happened to manage, and under a loaded runner
  // that can be a few hundred turnovers — enough sampling noise to miss a 25%
  // band on a rate that is otherwise correct.
  await page.waitForFunction(
    () => window.__mm.stats().turnovers > 3000, { timeout: 30000 }).catch(()=>{});
  const live = parseFloat(await txt('out-rate'));
  const want = parseFloat(await txt('out-predicted'));
  chk('the live counted readout tracks the Michaelis–Menten readout',
      Number.isFinite(live) && Math.abs(live-want)/want < 0.25,
      `counted ${live} vs predicted ${want}`);
}
{
  await page.click('#sweep-btn');
  await page.waitForFunction(()=>window.__mm.getPoints().length >= 12, { timeout: 60000 }).catch(()=>{});
  const pts = await page.evaluate(()=>window.__mm.getPoints());
  chk('"Run assay series" records a full 12-point series', pts.length===12,
      `${pts.length} points`);
  // A six-second assay per point is a small number of random events, and a
  // least-squares fit on 1/v weights the noisiest of them most heavily — that
  // is the standard objection to the Lineweaver-Burk plot, and the page says
  // as much. Measured over 25 sweeps the estimator is unbiased but wide:
  // Kₘ mean 25.4 against a true 25, sd 3.0, worst single run 39% out. A single
  // fit held to 30% is therefore a test that fails on correct behaviour, which
  // is how this first went red on CI.
  //
  // So the claim under test is the one that is actually true: repeat the assay
  // and the average converges on the real constants. sd/√5 is 5.4% for Kₘ, so
  // 18% is better than three sigma while still catching a genuinely broken
  // fit, and each individual run only has to be sane.
  const fits = [await page.evaluate(()=>window.__mm.fitFromPoints())];
  for (let i = 0; i < 4; i++) {
    await page.click('#reset-btn'); await page.waitForTimeout(150);
    await page.click('#sweep-btn');
    await page.waitForFunction(()=>window.__mm.getPoints().length>=12,{timeout:60000}).catch(()=>{});
    fits.push(await page.evaluate(()=>window.__mm.fitFromPoints()));
  }
  const ok = fits.every((f) => f && Number.isFinite(f.Km) && Number.isFinite(f.Vmax));
  const mean = (pick) => fits.reduce((a, f) => a + pick(f), 0) / fits.length;
  const mKm = ok ? mean((f)=>f.Km) : NaN, mVmax = ok ? mean((f)=>f.Vmax) : NaN;
  chk('the series fit is unbiased: 5 assays average onto Kₘ 25, Vₘₐₓ 24',
      ok && Math.abs(mKm-25)/25 < 0.18 && Math.abs(mVmax-24)/24 < 0.12,
      ok ? `mean Kₘ ${mKm.toFixed(1)}, mean Vₘₐₓ ${mVmax.toFixed(2)} ` +
           `(runs: ${fits.map(f=>f.Km.toFixed(1)).join(', ')})` : 'a sweep produced no fit');
  chk('no single assay is wildly off (each within 60%)',
      ok && fits.every((f)=>Math.abs(f.Km-25)/25 < 0.6 && Math.abs(f.Vmax-24)/24 < 0.5),
      ok ? fits.map(f=>`${f.Km.toFixed(1)}/${f.Vmax.toFixed(1)}`).join(' ') : '');
  await page.click('#sweep-btn');
  await page.waitForFunction(()=>window.__mm.getPoints().length>=12,{timeout:60000}).catch(()=>{});
  chk('the fit readout is filled in once there are points',
      /K/.test(await txt('out-fit')), await txt('out-fit'));
  const rising = pts.every((q,k)=>k===0 || q.v > pts[k-1].v*0.92);
  chk('the recorded series rises and saturates', rising && pts[11].v > pts[0].v*4,
      pts.map(q=>q.v.toFixed(1)).join(' '));
}
{
  const before = (await page.evaluate(()=>window.__mm.getPoints().length));
  await page.click('#record-btn'); await page.waitForTimeout(200);
  const after = (await page.evaluate(()=>window.__mm.getPoints().length));
  chk('"Record this point" adds a point', after === before+1, `${before}→${after}`);
  await page.click('#inhibitor-list .mol-btn[data-key="competitive"]'); await page.waitForTimeout(200);
  chk('changing the enzyme discards the series taken on the old one',
      (await page.evaluate(()=>window.__mm.getPoints().length)) === 0, '');
  await page.click('#reset-btn'); await page.waitForTimeout(250);
  chk('Reset clears the series and returns the inhibitor to none',
      (await page.evaluate(()=>window.__mm.getPoints().length)) === 0 &&
      (await page.evaluate(()=>!!document.querySelector('#inhibitor-list .mol-btn[data-key="none"].active'))), '');
}
{
  // The molecules move every frame, so comparing screenshots proved a control
  // alive whatever it did — a deliberately dead entry planted in this list
  // passed. Freeze the simulation and hold each control to the model.
  await page.evaluate(() => window.__mm.setRunning(false));
  const sig = async () => {
    await page.waitForTimeout(140);
    return page.evaluate(() => {
      const p = window.__mm.params(), a = window.__mm.apparent(p);
      return JSON.stringify([p.S, p.Km, p.kcat, p.nE, p.i, p.type,
        p.kOff, p.Et, p.Vmax, a.Km, a.Vmax]);
    });
  };
  const dead = [];
  const acts = [
    ['substrate', () => setV('substrate', 200)],
    ['km', () => setV('km', 80)],
    ['kcat', () => setV('kcat', 38)],
    ['enzymes', () => setV('enzymes', 22)],
    ['inhibitor', () => page.click('#inhibitor-list .mol-btn[data-key="noncompetitive"]')],
    ['iratio', () => setV('iratio', 4)],
  ];
  let before = await sig();
  for (const [name, act] of acts) {
    await act();
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length===0, dead.join(','));

  // Lineweaver–Burk is purely a drawing choice, so it is the one that has to
  // be checked in pixels — on a frozen frame, where the only thing that can
  // differ is the plot it swaps.
  await page.waitForTimeout(250);
  const off = (await page.locator('#stage').screenshot()).toString('base64');
  await page.click('#lb-on');
  await page.waitForTimeout(250);
  const on = (await page.locator('#stage').screenshot()).toString('base64');
  chk('the Lineweaver–Burk toggle actually swaps the plot', off !== on,
      `${off.length} vs ${on.length} bytes, frozen frame`);
  await page.evaluate(() => window.__mm.setRunning(true));
  await page.click('#lb-on'); await page.click('#reset-btn'); await page.waitForTimeout(250);
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
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot(); await page.waitForTimeout(700); const b = await shot();
  chk('canvas animates', a!==b && a.length>3000, `len ${a.length}`);
}
/*
 * The one idealisation on this page, measured rather than asserted.
 *
 * [S] is an endless pool: it is read off the slider whenever a molecule needs
 * it and never decremented. That is the initial-rate assay, and it is the
 * reason Michaelis–Menten is exact here instead of approximate — the law
 * assumes a substrate the enzymes cannot deplete, and this one cannot be.
 * Nothing on the page said so until a bug hunt went looking for the small
 * parameter each closed form is standing on and found that this one had had
 * its removed. Now the notes say it and this says it in numbers: run the
 * assay long enough and the products counted pass the whole pool several
 * times over, with [S] sitting exactly where it started.
 */
{
  const d = await page.evaluate(async () => {
    const set = (id, v) => { const s = document.getElementById(id);
      s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); };
    set('substrate', 2); set('enzymes', 24); set('kcat', 40); set('km', 10);
    const p = window.__mm.params();
    window.__mm.rebuild(p);
    const before = window.__mm.stats();
    // step() takes the time to run *to*, not a step length.
    const T = 200;
    for (let i = 1; i <= 2000; i++) window.__mm.step(i * (T / 2000), p);
    const after = window.__mm.stats();
    return { S: p.S, before: before.turnovers, after: after.turnovers, t: T,
             stillS: window.__mm.params().S };
  });
  const made = d.after - d.before;
  chk('the substrate never falls: it is the concentration on the slider, start to finish',
      d.stillS === d.S, `${d.S} → ${d.stillS}`);
  chk('and the pool is endless — the turnovers counted pass it many times over',
      made > 20 * d.S,
      `${made} products from a pool of ${d.S} over ${d.t.toFixed(0)} s — ${(made / d.S).toFixed(0)}×`);
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


await finish('Enzyme kinetics');
