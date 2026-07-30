import { browser, chk, rows, url, BASE as BASE_URL, finish } from '../lib/harness.mjs';

const BASE = BASE_URL + '/';

const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(BASE+'experiments/circuit.html', { waitUntil:'networkidle' });
await page.waitForTimeout(600);
chk('page loads without console errors', errs.length===0, errs.slice(0,3).join(' | '));

const setV = (id, v) => page.$eval('#'+id, (el,val)=>{ el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }, v);
const setChk = (id, v) => page.$eval('#'+id, (el,val)=>{ el.checked=val;
  el.dispatchEvent(new Event('change',{bubbles:true})); }, v);
const solveAt = (m) => page.evaluate((mm)=>{ window.__circuit.setMode(mm); const s = window.__circuit.solve();
  return { Rtot:s.Rtot, I:s.I, P:s.P, loop:s.loop, node:s.node,
           b:s.branches.map(x=>({r:x.r,I:x.I,V:x.V,P:x.P})) }; }, m);
const txt = id => page.evaluate(i=>document.getElementById(i).textContent.trim(), id);

const near = (a,b,tol) => Math.abs(a-b) <= tol;

// ---- 1. Series, V=6, R=100/220/330 ----
await setV('emf',6); await setV('r1',100); await setV('r2',220); await setV('r3',330);
await setChk('r3-on',true); await setChk('switch-on',true);
{
  const s = await solveAt('series');
  const eR = 650, eI = 6/650, eP = 6*eI;
  const eV = [100,220,330].map(r=>eI*r);
  chk('series Rtot = ΣR = 650 Ω', near(s.Rtot,eR,1e-9), `${s.Rtot}`);
  chk('series I = V/R = 9.2308 mA', near(s.I,eI,1e-12), `${(s.I*1000).toFixed(6)} mA vs ${(eI*1000).toFixed(6)}`);
  chk('series P = VI = 55.385 mW', near(s.P,eP,1e-12), `${(s.P*1000).toFixed(4)} mW vs ${(eP*1000).toFixed(4)}`);
  chk('series: same current in every resistor',
      s.b.every(x=>near(x.I,eI,1e-15)), s.b.map(x=>(x.I*1000).toFixed(6)).join('/'));
  chk('series drops 0.9231/2.0308/3.0462 V',
      s.b.every((x,i)=>near(x.V,eV[i],1e-12)), s.b.map(x=>x.V.toFixed(4)).join('/'));
  chk('series ΣV drops = EMF exactly',
      near(s.b.reduce((a,x)=>a+x.V,0), 6, 1e-12), `${s.b.reduce((a,x)=>a+x.V,0)}`);
  chk('series ΣP branches = total P',
      near(s.b.reduce((a,x)=>a+x.P,0), eP, 1e-12), `${s.b.reduce((a,x)=>a+x.P,0)*1000} mW`);
  chk('series Kirchhoff residuals both ~0',
      Math.abs(s.loop)<1e-12 && Math.abs(s.node)<1e-15, `loop=${s.loop} node=${s.node}`);
}

// ---- 2. Parallel, same values ----
{
  const s = await solveAt('parallel');
  const eR = 1/(1/100+1/220+1/330), eIb=[6/100,6/220,6/330], eI=eIb.reduce((a,b)=>a+b,0);
  chk('parallel Rtot = 56.897 Ω', near(s.Rtot,eR,1e-9), `${s.Rtot.toFixed(6)} vs ${eR.toFixed(6)}`);
  chk('parallel Rtot < smallest branch (100 Ω)', s.Rtot < 100, `${s.Rtot.toFixed(3)}`);
  chk('parallel I = 105.455 mA', near(s.I,eI,1e-12), `${(s.I*1000).toFixed(6)} vs ${(eI*1000).toFixed(6)}`);
  chk('parallel branch I = 60.0/27.273/18.182 mA',
      s.b.every((x,i)=>near(x.I,eIb[i],1e-12)), s.b.map(x=>(x.I*1000).toFixed(4)).join('/'));
  chk('parallel: every branch sees the full 6.00 V',
      s.b.every(x=>near(x.V,6,1e-15)), s.b.map(x=>x.V).join('/'));
  chk('parallel ΣI branches = cell current',
      near(s.b.reduce((a,x)=>a+x.I,0), eI, 1e-15), `${s.b.reduce((a,x)=>a+x.I,0)*1000}`);
  chk('parallel P = V²/R = 632.7 mW', near(s.P, 36/eR, 1e-12), `${(s.P*1000).toFixed(4)} vs ${(36/eR*1000).toFixed(4)}`);
  chk('parallel Kirchhoff residuals both ~0',
      Math.abs(s.loop)<1e-15 && Math.abs(s.node)<1e-15, `loop=${s.loop} node=${s.node}`);
}

// ---- 3. Adding a resistor: series raises R, parallel lowers it ----
{
  await setChk('r3-on', false);
  const s2 = await solveAt('series'), p2 = await solveAt('parallel');
  await setChk('r3-on', true);
  const s3 = await solveAt('series'), p3 = await solveAt('parallel');
  chk('series: adding R₃ raises total R (320→650)',
      s3.Rtot > s2.Rtot && near(s2.Rtot,320,1e-9), `${s2.Rtot} → ${s3.Rtot}`);
  chk('parallel: adding R₃ lowers total R (68.75→56.90)',
      p3.Rtot < p2.Rtot && near(p2.Rtot, 1/(1/100+1/220), 1e-9),
      `${p2.Rtot.toFixed(3)} → ${p3.Rtot.toFixed(3)}`);
  chk('R₃ off drops to 2 branches', s2.b.length===2 && p2.b.length===2, `${s2.b.length}/${p2.b.length}`);
}

// ---- 4. Ohm's law holds across the whole slider range, both modes ----
{
  let worst = 0, worstD = '';
  for (const V of [0, 1.3, 4.7, 9.9, 12]) {
    for (const R of [[10,10,10],[1000,1000,1000],[10,1000,550],[330,20,880]]) {
      await setV('emf',V); await setV('r1',R[0]); await setV('r2',R[1]); await setV('r3',R[2]);
      for (const m of ['series','parallel']) {
        const s = await solveAt(m);
        const eR = m==='series' ? R[0]+R[1]+R[2] : 1/(1/R[0]+1/R[1]+1/R[2]);
        const eI = V/eR;
        // V = IR must hold on every branch, and the network must obey I = V/R
        for (const b of s.b) {
          const d = Math.abs(b.V - b.I*b.r); if (d>worst) { worst=d; worstD=`${m} V=${V} R=${R}`; }
        }
        const dR = Math.abs(s.Rtot-eR)/eR, dI = Math.abs(s.I-eI);
        if (dR > 1e-12 || dI > 1e-12) { worst = 1; worstD = `network ${m} V=${V} R=${R} dR=${dR} dI=${dI}`; }
      }
    }
  }
  chk('V = IR on every branch across 40 configurations', worst < 1e-12, `worst=${worst} ${worstD}`);
}

// ---- 5. Open switch ----
{
  await setV('emf',6); await setV('r1',100); await setV('r2',220); await setV('r3',330);
  await setChk('switch-on', false);
  const s = await solveAt('series'), p = await solveAt('parallel');
  chk('open switch: no current, no power, R still defined',
      s.I===0 && p.I===0 && s.P===0 && p.P===0 && near(s.Rtot,650,1e-9) && p.Rtot>0,
      `sI=${s.I} pI=${p.I} sR=${s.Rtot} pR=${p.Rtot.toFixed(3)}`);
  chk('open switch: branch V and I all zero',
      s.b.every(x=>x.V===0&&x.I===0) && p.b.every(x=>x.V===0&&x.I===0), '');
  await setChk('switch-on', true);
}

// ---- 6. Zero volts and readout wiring ----
{
  await setV('emf',0);
  const s = await solveAt('series');
  chk('0 V: finite everywhere, no NaN', [s.Rtot,s.I,s.P,...s.b.map(b=>b.V)].every(Number.isFinite), '');
  await setV('emf',6);
  await page.waitForTimeout(120);
  const vals = { rt: await txt('out-rtotal'), i: await txt('out-current'), p: await txt('out-power'),
                 r1: await txt('out-r1'), r2: await txt('out-r2'), r3: await txt('out-r3') };
  chk('readouts populated (no em-dashes, no NaN)',
      Object.values(vals).every(v=>v.length>0 && v!=='—' && !/NaN|undefined/.test(v)),
      JSON.stringify(vals));
  await setChk('r3-on', false); await page.waitForTimeout(120);
  chk('R₃ readout goes blank when R₃ is removed', (await txt('out-r3'))==='—', await txt('out-r3'));
  await setChk('r3-on', true);
}

// ---- 7. Every control does something ----
{
  await page.reload({ waitUntil:'networkidle' }); await page.waitForTimeout(400);
  const snap = () => page.evaluate(() => {
    const s = window.__circuit.solve();
    return JSON.stringify([s.Rtot, s.I, s.P, s.branches.length,
      document.getElementById('out-rtotal').textContent,
      document.getElementById('out-current').textContent]);
  });
  const controls = [
    ['emf',    () => setV('emf', 11)],
    ['r1',     () => setV('r1', 700)],
    ['r2',     () => setV('r2', 40)],
    ['r3',     () => setV('r3', 900)],
    ['r3-on',  () => setChk('r3-on', false)],
    ['switch-on', () => setChk('switch-on', false)],
    ['mode parallel', () => page.click('#mode-list .mol-btn[data-key="parallel"]')],
    ['mode series',   () => page.click('#mode-list .mol-btn[data-key="series"]')],
  ];
  let dead = [];
  for (const [name, act] of controls) {
    const before = await snap();
    await act(); await page.waitForTimeout(150);
    if (await snap() === before) dead.push(name);
  }
  chk('no dead controls', dead.length===0, 'dead: '+dead.join(','));
  // reset must restore defaults
  await page.click('#reset-btn'); await page.waitForTimeout(200);
  const after = await page.evaluate(()=>({
    emf: document.getElementById('emf').value, r1: document.getElementById('r1').value,
    r2: document.getElementById('r2').value, r3: document.getElementById('r3').value,
    r3on: document.getElementById('r3-on').checked, sw: document.getElementById('switch-on').checked,
    mode: document.querySelector('#mode-list .mol-btn.active').dataset.key,
    pressed: document.querySelector('#mode-list .mol-btn[data-key="series"]').getAttribute('aria-pressed'),
    lbl: document.getElementById('emf-value').textContent,
  }));
  chk('reset restores defaults incl. mode + aria-pressed + slider labels',
      after.emf==='6' && after.r1==='100' && after.r2==='220' && after.r3==='330' &&
      after.r3on && after.sw && after.mode==='series' && after.pressed==='true' && after.lbl==='6.0',
      JSON.stringify(after));
}

// ---- 8. Canvas actually paints, and paints differently per mode ----
{
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  await page.click('#mode-list .mol-btn[data-key="series"]'); await page.waitForTimeout(400);
  const a = await shot();
  await page.click('#mode-list .mol-btn[data-key="parallel"]'); await page.waitForTimeout(400);
  const b = await shot();
  chk('series and parallel render visibly different schematics', a !== b && a.length > 3000,
      `len ${a.length}/${b.length}`);
  // and the animation is live
  const c = await shot(); await page.waitForTimeout(500); const d = await shot();
  chk('carriers animate between frames', c !== d, '');
}

// ---- 9. i18n round trip ----
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
  const untranslated = await page.evaluate(()=> {
    const bad=[]; document.querySelectorAll('[data-i18n]').forEach(el=>{
      if (!window.i18n.t(el.dataset.i18n)) bad.push(el.dataset.i18n); }); return bad; });
  chk('every data-i18n key resolves', untranslated.length===0, untranslated.join(','));
}

// ---- 10. Mobile: no horizontal overflow ----
for (const w of [320, 360, 390, 414, 768]) {
  const mp = await browser.newPage({ viewport: { width: w, height: 780 }, deviceScaleFactor: 2 });
  await mp.goto(BASE+'experiments/circuit.html', { waitUntil:'networkidle' });
  await mp.waitForTimeout(400);
  const o = await mp.evaluate(()=>({ doc: document.documentElement.scrollWidth,
    win: window.innerWidth, cw: document.getElementById('stage').getBoundingClientRect().width }));
  chk(`no horizontal overflow at ${w}px`, o.doc <= o.win + 1, `doc=${o.doc} win=${o.win} canvas=${o.cw.toFixed(0)}`);
  await mp.close();
}


await finish("Ohm's law");
