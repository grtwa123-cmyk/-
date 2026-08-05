import { browser, chk, rows, url, finish } from '../lib/harness.mjs';

const B = url('experiments/phases.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(B, { waitUntil:'networkidle' });
await page.waitForTimeout(600);
chk('page loads without console errors', errs.length===0, errs.slice(0,2).join(' | '));

const setV = (id,v) => page.$eval('#'+id,(el,val)=>{el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},v);
const txt = id => page.evaluate(i=>document.getElementById(i)?.textContent.trim(), id);

const MK = `const M = window.__md;
  const mk = (o={}) => ({ n:o.n??10, N:(o.n??10)**2, rho:o.rho??0.8, T:o.T??0.3,
    steps:1, thermostat:o.thermostat!==false });`;

// ── The potential itself ──────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    // V(r) = 4[(1/r)^12 − (1/r)^6] − shift, and the force is −dV/dr.
    const V = (r) => 4*(Math.pow(r,-12)-Math.pow(r,-6)) - M.SHIFT;
    const num = (r,h=1e-6) => -(V(r+h)-V(r-h))/(2*h);
    const ana = (r) => { const i2=1/(r*r), i6=i2*i2*i2, i12=i6*i6;
      return 24*(2*i12-i6)*i2*r; };
    const pts = [0.95,1.0,1.1,1.2,1.5,2.0,2.4];
    return {
      atCut: V(M.RC),
      minAt: (()=>{ let lo=1.0,hi=1.5;
        for(let i=0;i<80;i++){const m=(lo+hi)/2; num(m)>0?lo=m:hi=m;} return (lo+hi)/2; })(),
      minV: V(Math.pow(2,1/6)),
      force: pts.map(r=>({ r, num:num(r), ana:ana(r) })),
    };`));
  chk('the potential is shifted to exactly zero at the cutoff',
      Math.abs(r.atCut) < 1e-15, r.atCut.toExponential(1));
  chk('its minimum is at r = 2^(1/6) σ, where the force changes sign',
      Math.abs(r.minAt - Math.pow(2,1/6)) < 1e-4,
      `${r.minAt.toFixed(6)} vs ${Math.pow(2,1/6).toFixed(6)}`);
  chk('the force used by the integrator is −dV/dr',
      r.force.every((x) => Math.abs(x.num - x.ana) / Math.max(Math.abs(x.ana),1e-6) < 1e-4),
      r.force.map(x=>`r${x.r}:${(Math.abs(x.num-x.ana)).toExponential(1)}`).join(' '));
}

// ── Velocity Verlet conserves energy with the thermostat off ──────────
{
  const r = await page.evaluate(new Function(`${MK}
    const p = mk({ T:0.8, rho:0.8 });
    M.build(p);
    for (let i=0;i<4000;i++){ M.step(); if(i%10===0) M.setTemperature(0.8); }
    const e0 = M.totalEnergy();
    let mn=e0, mx=e0;
    for (let i=0;i<20000;i++){ M.step(); const e=M.totalEnergy();
      mn=Math.min(mn,e); mx=Math.max(mx,e); }
    return { e0, drift:(mx-mn)/Math.abs(e0) };`));
  chk('with the thermostat off the total energy holds to 0.5% over 20000 steps',
      r.drift < 0.005, `${(r.drift*100).toFixed(3)}%  (E₀ = ${r.e0.toFixed(1)})`);
}

// ── One potential, three phases ───────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    // measure() reports the *measured* temperature, so the target is kept
    // under its own name rather than being overwritten by the spread.
    return [0.15, 0.30, 0.45, 0.80, 1.50, 3.00].map(T =>
      ({ target: T, ...M.measure(mk({ T, rho:0.8 }), { equil:6000, sample:8000 }) }));`));
  const at = (T) => r.find((x) => x.target === T);
  // "No diffusion" is asked as bounded displacement, not as a small D. In a
  // solid the mean-square displacement plateaus, so D = msd/4t is that
  // plateau divided by however long you happened to watch — it decays as 1/t
  // and is not a transport coefficient at all. rms/a is flat in time:
  // 0.15–0.19 at T* = 0.15 over four offline replicates, against 1.8–2.1 in
  // the liquid, so the two do not come close to overlapping.
  chk('cold: the particles hold a lattice — ψ₆ near 0.9, displacement bounded',
      at(0.15).psi > 0.75 && at(0.15).rmsOverA < 0.35,
      `ψ₆ ${at(0.15).psi.toFixed(3)}, rms/a ${at(0.15).rmsOverA.toFixed(3)}`);
  chk('hot: the order is gone and the particles diffuse freely',
      at(1.50).psi < 0.35 && at(1.50).D > 2e-2,
      `ψ₆ ${at(1.50).psi.toFixed(3)}, D ${at(1.50).D.toExponential(1)}`);
  chk('ψ₆ falls as the system is heated',
      at(0.15).psi > at(0.45).psi && at(0.45).psi > at(1.50).psi,
      r.map(x=>`T${x.target}:${x.psi.toFixed(2)}`).join(' '));
  chk('diffusion rises as the system is heated',
      at(0.15).D < at(0.45).D && at(0.45).D < at(0.80).D && at(0.80).D < at(3.00).D,
      r.map(x=>`T${x.target}:${x.D.toExponential(1)}`).join(' '));
  // Compared over the same observation window, so this is a ratio of two
  // things measured the same way rather than of a transport coefficient
  // against a plateau artefact.
  chk('melting is a transition, not a slope: displacement jumps by an order of magnitude',
      at(0.80).rmsOverA / Math.max(at(0.15).rmsOverA, 1e-9) > 5,
      `rms/a ${at(0.15).rmsOverA.toFixed(3)} → ${at(0.80).rmsOverA.toFixed(3)}`
      + ` (${(at(0.80).rmsOverA / at(0.15).rmsOverA).toFixed(1)}×)`);
  chk('pressure rises with temperature at fixed density',
      r.every((x,i,a) => i===0 || x.P > a[i-1].P),
      r.map(x=>`T${x.target}:${x.P.toFixed(2)}`).join(' '));
}

// ── The thermostat delivers the temperature it is asked for ───────────
{
  const r = await page.evaluate(new Function(`${MK}
    return [0.2, 0.6, 1.2, 2.5].map(T => {
      const s = M.measure(mk({ T, rho:0.8 }), { equil:5000, sample:5000 });
      return { want:T, got:s.T };
    });`));
  // Averaged over the sampling window, not read off the last step. A single
  // instantaneous reading is off by 1–14% — with a hundred particles the
  // temperature swings by about 1/√N and the thermostat only corrects every
  // tenth step — so the old 12% bound sat inside its own noise and failed
  // roughly one run in three. The time average lands within 0.1%, which is a
  // far stronger statement as well as a reliable one.
  chk('the measured temperature is the mean kinetic energy, and it matches the target',
      r.every((x) => Math.abs(x.got - x.want)/x.want < 0.01),
      r.map(x=>`${x.want}→${x.got.toFixed(4)}`).join(' '));
}

// ── g(r) is the structural fingerprint ────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const sample = (T, rho) => {
      M.build(mk({ T, rho }));
      for (let i=0;i<6000;i++){ M.step(); if(i%10===0) M.setTemperature(T); }
      // accumulate g(r) over a stretch of the run
      const acc = new Array(M.GR_BINS).fill(0); let frames = 0;
      for (let k=0;k<40;k++){
        for (let i=0;i<200;i++){ M.step(); if(i%10===0) M.setTemperature(T); }
      }
      return { T, rho };
    };
    // The page's own accumulator is easier to read out: run it and ask.
    const grOf = (T, rho, steps=12000) => {
      M.build(mk({ T, rho }));
      for (let i=0;i<steps;i++){ M.step(); if(i%10===0) M.setTemperature(T); }
      return null;
    };
    // Count peaks directly from a fresh accumulation instead.
    const measureGr = (T, rho) => {
      M.build(mk({ T, rho }));
      for (let i=0;i<6000;i++){ M.step(); if(i%10===0) M.setTemperature(T); }
      const bins = M.GR_BINS, max = M.GR_MAX, acc = new Array(bins).fill(0);
      let frames = 0;
      const S = M.system();
      for (let f=0; f<60; f++) {
        for (let i=0;i<120;i++){ M.step(); if(i%10===0) M.setTemperature(T); }
        const hist = new Array(bins).fill(0);
        for (let i=0;i<S.N-1;i++) for (let j=i+1;j<S.N;j++){
          let dx=S.x[i]-S.x[j], dy=S.y[i]-S.y[j];
          dx-=S.Lx*Math.round(dx/S.Lx); dy-=S.Ly*Math.round(dy/S.Ly);
          const rr=Math.hypot(dx,dy);
          if(rr<max) hist[Math.floor(rr/(max/bins))]+=2;
        }
        const dens=S.N/(S.Lx*S.Ly);
        for(let b=0;b<bins;b++){
          const r0=b*(max/bins), r1=r0+(max/bins);
          const ideal=Math.PI*(r1*r1-r0*r0)*dens*S.N;
          acc[b]+=ideal>0?hist[b]/ideal:0;
        }
        frames++;
      }
      const g = acc.map(v=>v/frames);
      // first peak, and how much structure survives past r = 2.5
      const firstPeak = Math.max(...g.slice(0, Math.floor(bins*1.6/max)));
      const far = g.slice(Math.floor(bins*2.5/max));
      const farSpread = Math.max(...far) - Math.min(...far);
      const nearZero = g.slice(0, Math.floor(bins*0.8/max));
      return { firstPeak, farSpread, maxNearZero: Math.max(...nearZero) };
    };
    return { solid: measureGr(0.15, 0.8), liquid: measureGr(0.9, 0.8),
             gas: measureGr(2.5, 0.10) };`));
  chk('g(r) is zero inside the core — particles never overlap',
      r.solid.maxNearZero < 0.05 && r.liquid.maxNearZero < 0.05,
      `solid ${r.solid.maxNearZero.toFixed(3)}, liquid ${r.liquid.maxNearZero.toFixed(3)}`);
  chk('a solid keeps structure out to the far shells; a liquid does not',
      r.solid.farSpread > r.liquid.farSpread * 1.5,
      `solid ${r.solid.farSpread.toFixed(3)} vs liquid ${r.liquid.farSpread.toFixed(3)}`);
  chk('a dilute gas has almost no structure at all',
      r.gas.farSpread < r.liquid.farSpread,
      `gas ${r.gas.farSpread.toFixed(3)}`);
  chk('every phase still has a first neighbour peak above 1',
      r.solid.firstPeak > 1.5 && r.liquid.firstPeak > 1.2,
      `solid ${r.solid.firstPeak.toFixed(2)}, liquid ${r.liquid.firstPeak.toFixed(2)}`);
}

// ── Condensation: a droplet is not put there ──────────────────────────
// Two observables, because they answer different questions. The condensed
// fraction asks whether the particles have gathered at all — thermodynamics,
// and reproducible run to run. The largest blob asks whether the droplets have
// finished merging, which is kinetics: nucleation happily leaves two drops
// that meet much later, so that one is averaged over replicates.
{
  const r = await page.evaluate(new Function(`${MK}
    const run = (T) => {
      M.build(mk({ T, rho:0.12 }));
      for (let i=0;i<66000;i++){ M.step(); if(i%10===0) M.setTemperature(T); }
      for (let i=0;i<8000;i++){ M.step(); if(i%20===0) M.setTemperature(T); }
      return { lc: M.largestCluster(), cf: M.condensedFraction() };
    };
    const mean = (a) => a.reduce((s,x)=>s+x,0)/a.length;
    const cold = [run(0.35), run(0.35)];
    return { coldCf: mean(cold.map(c=>c.cf)), coldLc: mean(cold.map(c=>c.lc)),
             hot: run(1.5) };`));
  chk('cooled and dilute, the particles gather into a condensed phase',
      r.coldCf > 0.6, `${(r.coldCf*100).toFixed(0)}% of particles have neighbours`);
  chk('heated, the same system is a dispersed gas',
      r.hot.cf < 0.2, `${(r.hot.cf*100).toFixed(0)}%`);
  chk('and that condensed phase collects into essentially one droplet',
      r.coldLc > 0.6, `${(r.coldLc*100).toFixed(0)}% in the largest cluster`);
  chk('the difference is large — this is a transition, not a trend',
      r.coldLc > r.hot.lc * 2.5,
      `${(r.coldLc*100).toFixed(0)}% vs ${(r.hot.lc*100).toFixed(0)}%`);
}

// ── Maxwell–Boltzmann emerges from a single starting speed ────────────
// Seeded as a spike, so χ² against the 2D Maxwell–Boltzmann form starts in the
// hundreds (208–778 over 20 offline replicates) and relaxes to single digits
// (3.5–22.0). The bounds below sit outside both of those ranges.
{
  const r = await page.evaluate(new Function(`${MK}
    const T = 1.0;
    M.build(mk({ T, rho:0.5 }));
    const before = Array.from(M.speeds());
    for (let i=0;i<20000;i++){ M.step(); if(i%10===0) M.setTemperature(T); }
    // Chi-square-ish comparison against P(v) ∝ v·exp(−v²/2T) in 2D.
    const compare = (v, Tm) => {
      const bins = 14, vMax = 3.2*Math.sqrt(Tm);
      const obs = new Array(bins).fill(0);
      for (const s of v) { const b=Math.floor(s/vMax*bins); if(b>=0&&b<bins) obs[b]++; }
      const exp = [];
      for (let b=0;b<bins;b++){
        const a=b*vMax/bins, c=(b+1)*vMax/bins;
        // integral of (v/T)exp(-v^2/2T) is -exp(-v^2/2T)
        exp.push(Math.exp(-a*a/(2*Tm)) - Math.exp(-c*c/(2*Tm)));
      }
      const n = v.length, se = exp.reduce((s,x)=>s+x,0);
      let chi = 0;
      for (let b=0;b<bins;b++){ const e=n*exp[b]/se; if(e>3) chi += (obs[b]-e)**2/e; }
      return chi;
    };
    const Tm = M.temperature();
    const after = Array.from(M.speeds());
    return { chiBefore: compare(before, 1.0), chiAfter: compare(after, Tm), Tm,
             meanKE: M.kinetic()/M.system().N };`));
  chk('the speeds start off *not* Maxwell–Boltzmann (every particle gets the same one)',
      r.chiBefore > 100, `χ² = ${r.chiBefore.toFixed(1)}`);
  chk('collisions drive them onto the Maxwell–Boltzmann distribution',
      r.chiAfter < r.chiBefore / 5 && r.chiAfter < 30,
      `χ² ${r.chiBefore.toFixed(1)} → ${r.chiAfter.toFixed(1)}`);
  chk('T* really is the mean kinetic energy per particle',
      Math.abs(r.meanKE - r.Tm) < 1e-9, `${r.meanKE.toFixed(6)} vs ${r.Tm.toFixed(6)}`);
}

// ── The live page ─────────────────────────────────────────────────────
{
  await page.reload({ waitUntil:'networkidle' }); await page.waitForTimeout(500);
  await setV('speed', 40);
  await page.click('#preset-list .mol-btn[data-key="solid"]');
  await page.waitForFunction(() => {
    const t = document.getElementById('out-psi').textContent;
    return /^[\d.]+$/.test(t) && parseFloat(t) > 0;
  }, { timeout: 40000 }).catch(()=>{});
  // Wait on simulated time, not wall-clock: on a loaded runner the same
  // number of milliseconds buys far fewer frames, and what the readout is
  // reporting on is how far the run has got, not how long you waited.
  await page.waitForFunction(() => window.__md.time() > 12, null, { timeout: 60000 });
  const psiSolid = parseFloat(await txt('out-psi'));
  chk('the solid preset settles at high order', psiSolid > 0.6, String(psiSolid));

  // Report the two quantities the classification is made of, so a failure
  // says which one moved instead of leaving it to be guessed at.
  const solidState = await page.evaluate(() => {
    const M = window.__md, S = M.system();
    return { phase: document.getElementById('out-phase').textContent.trim(),
      psi: M.psi6(), rmsOverA: Math.sqrt(M.msd()) / S.a,
      T: M.temperature(), t: M.time() };
  });
  chk('and the phase readout says solid',
      /solid|고체|固体/.test(solidState.phase),
      `${solidState.phase} — ψ₆ ${solidState.psi.toFixed(3)} (needs > 0.5), `
      + `rms/a ${solidState.rmsOverA.toFixed(3)} (needs < 0.35), `
      + `T* ${solidState.T.toFixed(3)}, t ${solidState.t.toFixed(1)}`);

  await page.click('#preset-list .mol-btn[data-key="liquid"]');
  await page.waitForTimeout(4000);
  const psiLiquid = parseFloat(await txt('out-psi'));
  chk('the liquid preset drops the order well below the solid',
      psiLiquid < psiSolid * 0.7, `${psiSolid} → ${psiLiquid}`);
  chk('and the phase readout no longer says solid',
      !/^solid|^고체|^固体/.test(await txt('out-phase')), await txt('out-phase'));
}
{
  await page.click('#preset-list .mol-btn[data-key="gas"]');
  await page.waitForTimeout(2500);
  const t = parseFloat(await txt('out-t'));
  chk('the gas preset holds its temperature near 1.5',
      Math.abs(t - 1.5) / 1.5 < 0.2, String(t));
  chk('the energy readout is finite everywhere',
      /^-?[\d.]+$/.test(await txt('out-e')), await txt('out-e'));
}
{
  await page.click('#pause-btn'); await page.waitForTimeout(300);
  const a = await page.evaluate(()=>window.__md.time());
  await page.waitForTimeout(600);
  const b = await page.evaluate(()=>window.__md.time());
  chk('Pause stops the integrator', Math.abs(b-a) < 1e-9, `${a} → ${b}`);
  await page.click('#pause-btn'); await page.waitForTimeout(400);
  chk('Resume starts it again', (await page.evaluate(()=>window.__md.time())) > b);
}
{
  // With the integrator live the canvas differs every frame, so comparing
  // pixels would pass whatever the control did — including nothing. Each one is
  // held to the thing it is supposed to change in the model instead.
  const sig = async () => {
    await page.waitForTimeout(320);
    return page.evaluate(() => {
      const p = window.__md.params(), S = window.__md.system();
      return JSON.stringify([p.T, p.rho, p.n, p.steps, p.thermostat, p.trails,
        S.N, S.Lx.toFixed(6), window.__md.temperature().toFixed(6)]);
    });
  };
  const dead = [];
  const acts = [
    ['temp', () => setV('temp', 2.2)],
    ['density', () => setV('density', 0.5)],
    ['count', () => setV('count', 12)],
    ['speed', () => setV('speed', 25)],
    ['preset melting', () => page.click('#preset-list .mol-btn[data-key="melting"]')],
    ['quench', () => page.click('#quench-btn')],
    ['thermostat', () => page.click('#thermostat')],
    ['trails', () => page.click('#trails')],
  ];
  let before = await sig();
  for (const [name, act] of acts) {
    await act();
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length===0, dead.join(','));

  // `trails` is the one control that is purely a drawing choice, so it is the
  // one that has to be checked in pixels — on a frozen frame, where the only
  // thing that can differ is the overlay itself.
  await page.click('#trails');                 // back off
  await page.waitForTimeout(700);
  await page.click('#pause-btn'); await page.waitForTimeout(250);
  const off = (await page.locator('#stage').screenshot()).toString('base64');
  await page.click('#trails'); await page.waitForTimeout(250);
  const on = (await page.locator('#stage').screenshot()).toString('base64');
  chk('Show paths actually draws the paths', off !== on,
      `${off.length} vs ${on.length} bytes, frozen frame`);
  await page.click('#pause-btn');
  await page.click('#reset-btn'); await page.waitForTimeout(400);
}
{
  const h1 = () => page.evaluate(()=>document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(400);
  const ko = await h1();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(400);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(400);
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
chk('no console errors after the whole run', errs.length===0, errs.slice(0,3).join(' | '));
await page.close();

for (const w of [320, 390, 768]) {
  const p = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(B, { waitUntil:'networkidle' });
  await p.waitForTimeout(600);
  const o = await p.evaluate(()=>({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  chk(`no horizontal overflow at ${w}px`, o.doc <= o.win+1, `doc=${o.doc} win=${o.win}`);
  await p.close();
}

await finish('States of matter');
