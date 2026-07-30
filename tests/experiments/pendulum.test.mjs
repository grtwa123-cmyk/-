import { browser, chk, rows, url, BASE as BASE_URL, finish } from '../lib/harness.mjs';

const B = url('experiments/pendulum.html');

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

// ── Foucault ───────────────────────────────────────────────────────────
{
  const r = await page.evaluate(() => {
    const P = window.__pen, F = P.foucault;
    const out = {};
    out.omega = P.OMEGA_EARTH;
    out.sidereal = P.SIDEREAL_DAY;
    out.periods = [90, 48.8566, 45, 37.5665, 30].map(lat => {
      F.setup(1.5, 9.81, 30*Math.PI/180, lat);
      return { lat, h: F.precessionPeriod()/3600, want: (P.SIDEREAL_DAY/3600)/Math.sin(lat*Math.PI/180) };
    });
    F.setup(1.5, 9.81, 30*Math.PI/180, 0);
    out.equator = F.precessionPeriod();
    out.equatorAngle = F.planeAngle(1e7);
    // plane angle must equal -Omega sin(phi) t exactly
    F.setup(1.5, 9.81, 30*Math.PI/180, 45);
    const Oz = P.OMEGA_EARTH*Math.sin(Math.PI/4);
    out.angleErr = Math.max(...[100, 5000, 86164, 1e6].map(t =>
      Math.abs(F.planeAngle(t) - (-Oz*t))));
    // trajectory: the swing plane recovered from the position must match
    F.setup(2.0, 9.81, 20*Math.PI/180, 45);
    const wp = Math.sqrt(9.81/2.0);
    let worst = 0;
    for (const t of [0, 500, 3000, 20000, 60000]) {
      // sample at a swing extreme so the bob is at max displacement
      const k = Math.round(t*wp/(2*Math.PI));
      const te = k*2*Math.PI/wp;
      const p = F.position(te);
      const measured = Math.atan2(p.y, p.x);
      const expect = F.planeAngle(te);
      let d = measured - expect;
      d = Math.atan2(Math.sin(d), Math.cos(d));            // wrap
      if (Math.abs(Math.abs(d)-Math.PI) < 1e-3) d = 0;      // opposite end of the line
      worst = Math.max(worst, Math.abs(d));
    }
    out.traceErr = worst;
    // northern -> clockwise (negative), southern -> counter-clockwise
    F.setup(1.5, 9.81, 0.3, 40);  out.north = F.planeAngle(3600);
    F.setup(1.5, 9.81, 0.3, -40); out.south = F.planeAngle(3600);
    // amplitude must not decay: |zeta| at successive extremes
    F.setup(1.5, 9.81, 0.3, 45);
    const w2 = F.omegaP; const amps = [];
    for (let k=0;k<200;k+=40){ const p=F.position(k*2*Math.PI/w2); amps.push(Math.hypot(p.x,p.y)); }
    out.ampSpread = Math.max(...amps)-Math.min(...amps);
    out.amp0 = amps[0];
    return out;
  });
  chk('Ω⊕ = 7.2921159e-5 rad/s from the sidereal day',
      Math.abs(r.omega - 7.2921159e-5) < 1e-11, r.omega.toExponential(8));
  chk('precession period = sidereal day / sin φ (pole/Paris/45°/Seoul/30°)',
      r.periods.every(x => Math.abs(x.h - x.want) < 1e-9),
      r.periods.map(x=>`${x.lat}:${x.h.toFixed(3)}h`).join(' '));
  chk('pole = 23.934 h, Paris = 31.783 h',
      Math.abs(r.periods[0].h-23.9344696)<1e-4 && Math.abs(r.periods[1].h-31.783)<0.01,
      `${r.periods[0].h.toFixed(4)} / ${r.periods[1].h.toFixed(3)}`);
  chk('equator: no precession ever', !Number.isFinite(r.equator) && r.equatorAngle === -0,
      `T=${r.equator} angle@1e7s=${r.equatorAngle}`);
  chk('plane angle = −Ω·sin φ·t exactly', r.angleErr < 1e-12, r.angleErr.toExponential(2));
  chk('bob trajectory really lies in that rotating plane', r.traceErr < 1e-6, r.traceErr.toExponential(2));
  chk('northern hemisphere clockwise, southern counter-clockwise',
      r.north < 0 && r.south > 0, `N=${r.north.toFixed(5)} S=${r.south.toFixed(5)}`);
  chk('undamped amplitude constant over 200 swings',
      r.ampSpread / r.amp0 < 1e-9, `spread ${r.ampSpread.toExponential(2)} of ${r.amp0.toFixed(4)}`);
}

// Foucault readouts through the UI
{
  await page.click('#mode-list .mol-btn[data-key="foucault"]');
  await page.waitForTimeout(300);
  await setV('latitude', 90); await page.waitForTimeout(250);
  chk('UI: latitude 90° shows 23.93 h precession',
      Math.abs(parseFloat(await txt('out-angvel')) - 23.93) < 0.02, await txt('out-angvel'));
  await setV('latitude', 0); await page.waitForTimeout(250);
  chk('UI: latitude 0° shows ∞', (await txt('out-angvel')) === '∞', await txt('out-angvel'));
  await setV('latitude', 37.6); await setV('timescale', 7200);
  await page.click('#start-btn'); await page.waitForTimeout(2500);
  const simH = parseFloat(await txt('out-time'));
  const plane = parseFloat(await txt('out-angle'));
  const Tp = parseFloat(await txt('out-angvel'));
  const expected = -(simH / Tp) * 360;
  chk('UI: swept angle matches simulated time / precession period',
      simH > 0.5 && Math.abs(plane - expected) < 0.5,
      `t=${simH}h plane=${plane}° expected=${expected.toFixed(2)}°`);
  const pegs = await txt('out-x2');
  chk('UI: pegs fall as the plane sweeps', parseInt(pegs,10) > 0, pegs);
  await page.click('#start-btn');
}

// ── Newton's cradle ────────────────────────────────────────────────────
{
  await page.click('#mode-list .mol-btn[data-key="newton"]');
  await page.waitForTimeout(300);
  for (const [n, k] of [[5,1],[5,2],[5,3],[7,1],[7,3],[7,5],[3,1],[3,2]]) {
    await page.click('#reset-btn'); await page.waitForTimeout(120);
    await setV('balls', n); await setV('pulled', k);
    await setV('angle', 25); await setV('damping', 0); await setV('length', 1.5);
    await page.waitForTimeout(200);
    await page.click('#start-btn');
    // one half period is enough for the pulse to cross and the far side to rise
    await page.waitForTimeout(1600);
    await page.click('#start-btn');                       // pause at the far swing
    const st = await page.evaluate(()=>window.__pen.cradleState());
    const moving = st.filter(b => Math.abs(b.omega) > 0.05 || b.theta > 0.02).length;
    const restLeft = st.slice(0, n-k).every(b => b.theta < 0.02);
    chk(`Newton: ${n} balls, ${k} pulled → ${k} out`,
        moving === k && restLeft,
        `moving=${moving} θ=[${st.map(b=>b.theta.toFixed(3)).join(',')}]`);
  }
}
{
  // energy conservation across many collisions
  await page.click('#reset-btn'); await page.waitForTimeout(150);
  await setV('balls',5); await setV('pulled',2); await setV('angle',30); await setV('damping',0);
  await page.waitForTimeout(200);
  await page.click('#start-btn'); await page.waitForTimeout(6000);
  const drift = Math.abs(parseFloat(await txt('out-angvel')));
  const coll = parseInt(await txt('out-x2'), 10);
  await page.click('#start-btn');
  chk('Newton: energy drift < 0.1% over many collisions', drift < 0.1, `${drift}% after ${coll} collisions`);
  chk('Newton: collisions actually happened', coll > 5, String(coll));
}

// ── Wave mode still correct (the original behaviour) ───────────────────
{
  await page.click('#mode-list .mol-btn[data-key="wave"]');
  await page.waitForTimeout(300);
  await setV('length', 1.0); await setV('gravity', 9.81);
  await page.waitForTimeout(250);
  const T = parseFloat(await txt('out-period'));
  chk('wave mode: period still 2π√(L/g)', Math.abs(T - 2*Math.PI*Math.sqrt(1/9.81)) < 0.02, String(T));
  const vis = await page.evaluate(()=>({
    count: !document.querySelector('.control[data-modes="wave"]').hidden,
    lat: document.querySelector('.control[data-modes="foucault"]').hidden,
    balls: document.querySelector('.control[data-modes="newton"]').hidden }));
  chk('controls show/hide per mode', vis.count && vis.lat && vis.balls, JSON.stringify(vis));
}

// ── i18n + mobile ──────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(()=>document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(300);
  const ko = await h1();
  const koLabel = await txt('lab-period');
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(300);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(300);
  chk('title translates en/ko/zh', ko!==en && zh!==en && zh!==ko, `${en}|${ko}|${zh}`);
  chk('readout labels translate too', /[가-힣]/.test(koLabel), koLabel);
  const bad = await page.evaluate(()=>{ const b=[];
    document.querySelectorAll('[data-i18n]').forEach(el=>{ if(!window.i18n.t(el.dataset.i18n)) b.push(el.dataset.i18n); });
    return b; });
  chk('every data-i18n key resolves', bad.length===0, bad.join(','));
}
await page.close();

for (const w of [320, 390, 768]) {
  for (const m of ['wave','foucault','newton']) {
    const p = await browser.newPage({ viewport: { width: w, height: 850 }, deviceScaleFactor: 2 });
    await p.goto(B, { waitUntil:'networkidle' });
    await p.waitForTimeout(400);
    await p.click(`#mode-list .mol-btn[data-key="${m}"]`);
    await p.waitForTimeout(500);
    const o = await p.evaluate(()=>({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    chk(`no horizontal overflow at ${w}px (${m})`, o.doc <= o.win+1, `doc=${o.doc} win=${o.win}`);
    await p.close();
  }
}


await finish('Pendulums');
