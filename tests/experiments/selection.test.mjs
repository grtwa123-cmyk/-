import { browser, chk, rows, url, BASE as BASE_URL, finish } from '../lib/harness.mjs';

const BASE = BASE_URL + '/';

const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(BASE+'experiments/selection.html', { waitUntil:'networkidle' });
await page.waitForTimeout(600);
chk('page loads without console errors', errs.length===0, errs.slice(0,3).join(' | '));

const setV = (id, v) => page.$eval('#'+id, (el,val)=>{ el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }, v);
const txt = id => page.evaluate(i=>document.getElementById(i).textContent.trim(), id);

// ---- 1. Hardy–Weinberg: equal fitness, p never moves ----
{
  const r = await page.evaluate(() => {
    window.__ns.setFitness(1,1,1);
    let p = 0.37, worst = 0;
    for (let i=0;i<500;i++) { p = window.__ns.detStep(p); worst = Math.max(worst, Math.abs(p-0.37)); }
    return { p, worst, wbar: window.__ns.meanFitness(0.37), eq: window.__ns.equilibrium() };
  });
  chk('Hardy–Weinberg: p unchanged over 500 generations', r.worst === 0, `drift=${r.worst}`);
  chk('Hardy–Weinberg: mean fitness = 1', Math.abs(r.wbar-1)<1e-15, `w̄=${r.wbar}`);
  chk('Hardy–Weinberg: no interior equilibrium reported', r.eq === null, JSON.stringify(r.eq));
}

// ---- 2. Recessive lethal: exact q_t = q0/(1 + t·q0) ----
{
  const r = await page.evaluate(() => {
    window.__ns.setFitness(1,1,0);
    const q0 = 0.6; let p = 1-q0, worst = 0, at400 = 0;
    for (let t=1;t<=400;t++) {
      p = window.__ns.detStep(p);
      const q = 1-p, e = q0/(1+t*q0);
      worst = Math.max(worst, Math.abs(q-e));
      if (t===400) at400 = q;
    }
    return { worst, at400, exact: 0.6/(1+400*0.6) };
  });
  chk('recessive lethal matches q₀/(1+tq₀) over 400 generations', r.worst < 1e-12,
      `max err=${r.worst.toExponential(2)}`);
  chk('recessive lethal: q₄₀₀ = 0.002490', Math.abs(r.at400-r.exact)<1e-12,
      `${r.at400.toFixed(9)} vs ${r.exact.toFixed(9)}`);
}

// ---- 3. Heterozygote advantage: converges to p* = 0.6 from anywhere ----
{
  const r = await page.evaluate(() => {
    window.__ns.setFitness(0.8,1,0.7);
    const eq = window.__ns.equilibrium();
    const ends = [0.02,0.5,0.98].map(p0 => { let p=p0; for(let i=0;i<3000;i++) p=window.__ns.detStep(p); return p; });
    return { eq, ends };
  });
  chk('overdominance: p* = 0.600 and flagged stable',
      r.eq && Math.abs(r.eq.p-0.6)<1e-12 && r.eq.stable, JSON.stringify(r.eq));
  chk('overdominance: converges to p* from 0.02 / 0.50 / 0.98',
      r.ends.every(p=>Math.abs(p-0.6)<1e-9), r.ends.map(p=>p.toFixed(9)).join(' '));
}

// ---- 4. Underdominance: p* = 0.4 is a watershed, not an attractor ----
{
  const r = await page.evaluate(() => {
    window.__ns.setFitness(1,0.7,0.9);
    const eq = window.__ns.equilibrium();
    const below = (()=>{ let p=eq.p-0.01; for(let i=0;i<3000;i++) p=window.__ns.detStep(p); return p; })();
    const above = (()=>{ let p=eq.p+0.01; for(let i=0;i<3000;i++) p=window.__ns.detStep(p); return p; })();
    return { eq, below, above };
  });
  chk('underdominance: p* = 0.400 and flagged unstable',
      r.eq && Math.abs(r.eq.p-0.4)<1e-12 && !r.eq.stable, JSON.stringify(r.eq));
  chk('underdominance: repels — below p* → 0, above p* → 1',
      r.below < 1e-9 && r.above > 1-1e-9, `${r.below.toExponential(2)} / ${r.above}`);
}

// ---- 5. Δp identity holds for arbitrary fitnesses ----
{
  const worst = await page.evaluate(() => {
    let worst = 0;
    for (const [a,b,c] of [[1,1,1],[1,.95,.9],[1,1,0],[.8,1,.7],[1,.7,.9],[.3,.9,.55],[0,.4,1]]) {
      window.__ns.setFitness(a,b,c);
      for (let i=1;i<200;i++) {
        const p = i/200, q = 1-p, wbar = window.__ns.meanFitness(p);
        if (wbar <= 0) continue;
        const actual = window.__ns.detStep(p) - p;
        const formula = p*q*(p*(a-b) + q*(b-c))/wbar;
        worst = Math.max(worst, Math.abs(actual-formula));
      }
    }
    return worst;
  });
  chk('Δp = pq[p(w₁₁−w₁₂)+q(w₁₂−w₂₂)]/w̄ across 7 fitness sets × 199 points',
      worst < 1e-14, `worst=${worst.toExponential(2)}`);
}

// ---- 6. Mean fitness never falls (constant fitnesses) ----
{
  const r = await page.evaluate(() => {
    let violations = 0, checked = 0;
    for (const [a,b,c] of [[1,.95,.9],[1,1,0],[.8,1,.7],[1,.7,.9],[.3,.9,.55]]) {
      window.__ns.setFitness(a,b,c);
      for (const p0 of [0.05,0.25,0.5,0.75,0.95]) {
        let p = p0, prev = window.__ns.meanFitness(p);
        for (let i=0;i<600;i++) {
          p = window.__ns.detStep(p);
          const w = window.__ns.meanFitness(p);
          checked++;
          if (w < prev - 1e-12) violations++;
          prev = w;
        }
      }
    }
    return { violations, checked };
  });
  chk('mean fitness monotone non-decreasing (15000 steps, 5 fitness sets)',
      r.violations === 0, `${r.violations} violations in ${r.checked} steps`);
}

// ---- 7. Wright–Fisher drift: P(fixation of A) = p0 ----
{
  const r = await page.evaluate(() => {
    window.__ns.setFitness(1,1,1);
    const N = 20, p0 = 0.3, REPS = 800;
    let fixed = 0, lost = 0, unresolved = 0;
    for (let k=0;k<REPS;k++) {
      let g = window.__ns.founder(N, p0);
      let t = 0;
      while (t < 4000) {
        const f = window.__ns.freqA(g);
        if (f === 0) { lost++; break; }
        if (f === 1) { fixed++; break; }
        g = window.__ns.wfStep(g); t++;
      }
      if (t >= 4000) unresolved++;
    }
    return { fixed, lost, unresolved, REPS, frac: fixed/REPS };
  });
  const se = Math.sqrt(0.3*0.7/800);
  chk('neutral drift: P(A fixes) = p₀ = 0.30 (800 replicates, N=20)',
      Math.abs(r.frac-0.3) < 3.5*se && r.unresolved === 0,
      `observed ${r.frac.toFixed(4)}, 3.5σ = ${(3.5*se).toFixed(4)}, unresolved ${r.unresolved}`);
}

// ---- 8. Wright–Fisher is unbiased: E[p'] = p under neutrality ----
{
  const r = await page.evaluate(() => {
    window.__ns.setFitness(1,1,1);
    const N = 50, p0 = 0.4, REPS = 4000;
    let sum = 0;
    for (let k=0;k<REPS;k++) {
      const g = window.__ns.founder(N, p0);
      const before = window.__ns.freqA(g);
      sum += window.__ns.freqA(window.__ns.wfStep(g)) - before;
    }
    return sum/REPS;
  });
  chk('neutral drift is unbiased: mean Δp ≈ 0 over 4000 single steps',
      Math.abs(r) < 0.006, `mean Δp = ${r.toExponential(2)}`);
}

// ---- 9. Heterozygosity decays as (1 − 1/2N)^t ----
{
  const r = await page.evaluate(() => {
    window.__ns.setFitness(1,1,1);
    const N = 25, t = 40, REPS = 1500;
    let h0 = 0, ht = 0;
    for (let k=0;k<REPS;k++) {
      let g = window.__ns.founder(N, 0.5);
      // expected heterozygosity 2pq from the realised allele frequency
      const f0 = window.__ns.freqA(g); h0 += 2*f0*(1-f0);
      for (let i=0;i<t;i++) g = window.__ns.wfStep(g);
      const f = window.__ns.freqA(g); ht += 2*f*(1-f);
    }
    h0/=REPS; ht/=REPS;
    return { h0, ht, expect: h0*Math.pow(1-1/(2*N), t), ratio: ht/h0, theory: Math.pow(1-1/(2*N), t) };
  });
  chk('heterozygosity decays as (1−1/2N)^t (N=25, t=40, 1500 replicates)',
      Math.abs(r.ratio - r.theory) < 0.04,
      `observed ${r.ratio.toFixed(4)} vs theory ${r.theory.toFixed(4)}`);
}

// ---- 10. Directional selection is monotone in the favoured allele ----
{
  const ok = await page.evaluate(() => {
    window.__ns.setFitness(1,0.95,0.9);
    let p = 0.05, mono = true;
    for (let i=0;i<2000;i++) { const n = window.__ns.detStep(p); if (n < p - 1e-15) mono = false; p = n; }
    return mono && p > 1-1e-6;
  });
  chk('directional selection: A rises monotonically to fixation', ok, '');
}

// ---- 11. Everything lethal → extinct, no NaN ----
{
  const r = await page.evaluate(() => {
    const g = window.__ns.founder(50, 0.5);
    window.__ns.setFitness(0,0,0);
    const next = window.__ns.wfStep(g);
    const d = window.__ns.detStep(0.4);
    return { next, det: d, finite: Number.isFinite(d) };
  });
  chk('all genotypes lethal: population reports extinct, no NaN',
      r.next === null && r.finite, JSON.stringify(r));
  await page.reload({ waitUntil:'networkidle' }); await page.waitForTimeout(300);
}

// ---- 12. Readouts wired and internally consistent ----
{
  await setV('waa',1); await setV('wab',1); await setV('wbb',1);
  await setV('p0',0.5); await setV('popn',200); await setV('speed',10);
  await page.waitForTimeout(700);
  // One synchronous read of all six. Taken as separate round-trips they come
  // from different generations — the population keeps breeding between them —
  // and then p and the Hardy-Weinberg figures derived from it disagree in the
  // third decimal about one run in three.
  const v = await page.evaluate(() => {
    const g = (id) => document.getElementById(id).textContent.trim();
    return { gen: g('out-gen'), p: g('out-p'), pdet: g('out-pdet'),
             geno: g('out-geno'), hw: g('out-hw'), wbar: g('out-wbar') };
  });
  chk('readouts populated, no NaN', Object.values(v).every(x=>x && x!=='—' && !/NaN|undefined/.test(x)),
      JSON.stringify(v));
  const p = parseFloat(v.p);
  const hw = v.hw.split('·').map(s=>parseFloat(s));
  // p is shown to three decimals, so the p read back here is up to 0.0005 away
  // from the p the page actually squared. d(p²)/dp = 2p ≈ 1, so p² can land a
  // whole unit off in its own last shown digit — with a 0.0006 tolerance this
  // failed about one run in three on a correct readout. The propagated bound
  // is 2p·0.0005 plus the 0.0005 rounding of the result itself.
  const tol = (x) => 2 * x * 0.0005 + 0.0005 + 1e-9;
  chk('HW readout equals p² · 2pq · q² for the shown p',
      Math.abs(hw[0]-p*p) < tol(p) &&
      Math.abs(hw[1]-2*p*(1-p)) < tol(Math.abs(1-2*p)) + 0.0005 &&
      Math.abs(hw[2]-(1-p)*(1-p)) < tol(1-p),
      `p=${p} hw=${v.hw}`);
  const geno = v.geno.split('·').map(s=>parseFloat(s));
  chk('observed genotype proportions sum to 1', Math.abs(geno.reduce((a,b)=>a+b,0)-1) < 0.002,
      v.geno);
  chk('observed p reconstructs from genotypes', Math.abs((geno[0]+geno[1]/2) - p) < 0.002,
      `${(geno[0]+geno[1]/2).toFixed(3)} vs ${p}`);
  chk('deterministic track flat under no selection', Math.abs(parseFloat(v.pdet)-0.5)<1e-9, v.pdet);
  chk('generations advance', parseInt(v.gen,10) > 0, v.gen);
}

// ---- 13. Presets set the sliders and the equilibrium ----
{
  for (const [key, want] of [['neutral',['1.00','1.00','1.00']], ['directional',['1.00','0.95','0.90']],
                             ['recessive',['1.00','1.00','0.00']], ['over',['0.80','1.00','0.70']],
                             ['under',['1.00','0.70','0.90']]]) {
    await page.click(`#preset-list .mol-btn[data-key="${key}"]`);
    await page.waitForTimeout(120);
    const got = [await txt('waa-value'), await txt('wab-value'), await txt('wbb-value')];
    const pressed = await page.$eval(`#preset-list .mol-btn[data-key="${key}"]`, e=>e.getAttribute('aria-pressed'));
    chk(`preset "${key}" sets fitnesses and aria-pressed`,
        got.join()===want.join() && pressed==='true', `${got.join('/')} pressed=${pressed}`);
  }
  const eq = await page.evaluate(()=>window.__ns.equilibrium());
  chk('underdominance preset reports p* = 0.400 unstable',
      eq && Math.abs(eq.p-0.4)<1e-12 && !eq.stable, JSON.stringify(eq));
}

// ---- 14. No dead controls ----
{
  await page.reload({ waitUntil:'networkidle' }); await page.waitForTimeout(400);
  const snap = () => page.evaluate(() => {
    const s = window.__ns.state();
    return JSON.stringify([s.N, s.p, s.pDet, s.geno,
      document.getElementById('out-gen').textContent,
      document.getElementById('waa-value').textContent,
      document.getElementById('speed-value').textContent,
      // Pause's whole job is to stop the generation counter moving, so
      // watching only the counter marks it dead exactly when it works. Its
      // own label is the signal that it did something.
      document.getElementById('pause-btn').textContent]);
  });
  const controls = [
    ['waa',  () => setV('waa', 0.4)],
    ['wab',  () => setV('wab', 0.6)],
    ['wbb',  () => setV('wbb', 0.2)],
    ['p0',   () => setV('p0', 0.8)],
    ['popn', () => setV('popn', 60)],
    ['speed',() => setV('speed', 20)],
    ['preset over', () => page.click('#preset-list .mol-btn[data-key="over"]')],
    ['pause', () => page.click('#pause-btn')],
    ['step',  () => page.click('#step-btn')],
    ['reset', () => page.click('#reset-btn')],
  ];
  const dead = [];
  for (const [name, act] of controls) {
    const before = await snap();
    await act(); await page.waitForTimeout(180);
    if (await snap() === before) dead.push(name);
  }
  chk('no dead controls', dead.length===0, 'dead: '+dead.join(','));
}

// ---- 15. Step advances exactly one generation while paused ----
{
  await page.click('#reset-btn'); await page.waitForTimeout(150);
  await page.evaluate(()=>window.__ns.setRunning(false));
  await page.waitForTimeout(250);
  const g0 = parseInt(await txt('out-gen'),10);
  await page.click('#step-btn'); await page.waitForTimeout(150);
  const g1 = parseInt(await txt('out-gen'),10);
  await page.waitForTimeout(500);
  const g2 = parseInt(await txt('out-gen'),10);
  chk('Step advances exactly one generation and stays paused',
      g1 === g0+1 && g2 === g1, `${g0} → ${g1} → ${g2}`);
}

// ---- 16. Canvas paints and animates ----
{
  await page.click('#reset-btn'); await page.waitForTimeout(200);
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot(); await page.waitForTimeout(700); const b = await shot();
  chk('canvas paints and updates between generations', a !== b && a.length > 3000, `len ${a.length}`);
}

// ---- 17. i18n ----
{
  const readTitle = () => page.evaluate(()=>document.querySelector('h1').textContent.trim());
  const en = await readTitle();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(300);
  const ko = await readTitle();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(300);
  const zh = await readTitle();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(300);
  chk('title translates en/ko/zh and returns', ko!==en && zh!==en && zh!==ko && (await readTitle())===en,
      `${en} | ${ko} | ${zh}`);
  const bad = await page.evaluate(()=>{ const b=[];
    document.querySelectorAll('[data-i18n]').forEach(el=>{ if(!window.i18n.t(el.dataset.i18n)) b.push(el.dataset.i18n); });
    return b; });
  chk('every data-i18n key resolves', bad.length===0, bad.join(','));
}

// ---- 18. Mobile ----
for (const w of [320, 360, 390, 414, 768]) {
  const mp = await browser.newPage({ viewport: { width: w, height: 820 }, deviceScaleFactor: 2 });
  await mp.goto(BASE+'experiments/selection.html', { waitUntil:'networkidle' });
  await mp.waitForTimeout(400);
  const o = await mp.evaluate(()=>({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  chk(`no horizontal overflow at ${w}px`, o.doc <= o.win + 1, `doc=${o.doc} win=${o.win}`);
  await mp.close();
}


await finish('Natural selection');
