/*
 * Solar System Tour — the simulation behind experiments/solarsystem.html.
 *
 * Lifted out of the page it used to live inside. Thirty-four kilobytes of
 * JavaScript in a <script> block is thirty-four kilobytes nothing treats as a
 * file: it was the largest script on the site, and until the linter learned to
 * read inline blocks it was one of the few nothing ever parsed. Every other
 * experiment ships its own file; now so does this one.
 *
 * Loaded WITHOUT defer, from the position the block occupied. That is not
 * incidental. The tag sits after three.min.js and after the markup this file
 * reaches for, and a classic script there runs synchronously between the two —
 * exactly what the inline block did. Add `defer` and it would run after
 * DOMContentLoaded instead, changing when the scene is built and when the
 * CDN-failure notice fires.
 *
 * The guard below stays the first thing here for the reason it was the first
 * thing there: without three.js every statement past it throws "THREE is not
 * defined", which is an uncaught error and a dead page rather than a message
 * the reader can act on.
 */
/* If the CDN did not deliver, everything below throws "THREE is not defined"
   on its first top-level statement — an uncaught error, a dead page, and an
   eight-second wait before the reader is told anything. Report it now and
   stop, rather than crashing through nine hundred lines of setup. */
if (typeof THREE === "undefined") window.solarLoadFailed();
else {
/* ===================== 데이터 ===================== */
/* Every string the reader sees is a dictionary key. `rows` is an ordered list
   of [labelKey, value, valueIsAKey]: diameter, mass and surface gravity are
   pure numbers and units, so they are the same in all three languages and stay
   literal; everything else carries words and is translated. */
/*
 * orbitR is drawn to fit a screen and is not to scale. Neptune sits seven
 * times further out than Mercury here; in the sky it is seventy-seven. The
 * period, ratio and tilt columns are the measured ones and the tour's motion
 * is read off period alone, so nothing downstream depends on orbitR being
 * anything but legible.
 */
const BODIES = [
  { id:'sun', nameKey:'ssSun', en:'SUN', ui:'#ffc169', dispR:15, orbitR:0, period:1, rotDir:1, rotSpd:.012, ratio:109.2,
    descKey:'ssDescSun',
    rows:[['ssLabClass','ssClassStar',1], ['ssLabDiameter','1,392,700 km',0], ['ssLabMass','1.989×10³⁰ kg',0],
          ['ssLabDistance','ssDistSun',1], ['ssLabOrbit','ssOrbitSun',1], ['ssLabRotation','ssRotSun',1],
          ['ssLabTempSurface','ssTempSun',1], ['ssLabMoons','ssMoonsSun',1], ['ssLabGravity','27.9 g',0]] },
  { id:'mercury', nameKey:'ssMercury', en:'MERCURY', ui:'#a89684', dispR:1.3, orbitR:30, period:88, rotDir:1, rotSpd:.004, ratio:0.38, tilt:0,
    descKey:'ssDescMercury',
    rows:[['ssLabClass','ssClassRock',1], ['ssLabDiameter','4,879 km',0], ['ssLabMass','3.30×10²³ kg',0],
          ['ssLabDistance','ssDistMercury',1], ['ssLabOrbit','ssOrbitMercury',1], ['ssLabRotation','ssRotMercury',1],
          ['ssLabTempMean','ssTempMercury',1], ['ssLabMoons','ssMoonsMercury',1], ['ssLabGravity','0.38 g',0]] },
  { id:'venus', nameKey:'ssVenus', en:'VENUS', ui:'#e6c98f', dispR:2.4, orbitR:44, period:225, rotDir:-1, rotSpd:.002, ratio:0.95, tilt:177,
    atmo:{ c:'#eedaa2', i:.7, s:1.13 },
    descKey:'ssDescVenus',
    rows:[['ssLabClass','ssClassRock',1], ['ssLabDiameter','12,104 km',0], ['ssLabMass','4.87×10²⁴ kg',0],
          ['ssLabDistance','ssDistVenus',1], ['ssLabOrbit','ssOrbitVenus',1], ['ssLabRotation','ssRotVenus',1],
          ['ssLabTempMean','ssTempVenus',1], ['ssLabMoons','ssMoonsVenus',1], ['ssLabGravity','0.91 g',0]] },
  { id:'earth', nameKey:'ssEarth', en:'EARTH', ui:'#5e9bd6', dispR:2.5, orbitR:58, period:365.25, rotDir:1, rotSpd:.02, ratio:1, tilt:23.5,
    atmo:{ c:'#5fb4ff', i:1.0, s:1.16 },
    descKey:'ssDescEarth',
    rows:[['ssLabClass','ssClassRock',1], ['ssLabDiameter','12,756 km',0], ['ssLabMass','5.97×10²⁴ kg',0],
          ['ssLabDistance','ssDistEarth',1], ['ssLabOrbit','ssOrbitEarth',1], ['ssLabRotation','ssRotEarth',1],
          ['ssLabTempMean','ssTempEarth',1], ['ssLabMoons','ssMoonsEarth',1], ['ssLabGravity','1.00 g',0]] },
  { id:'mars', nameKey:'ssMars', en:'MARS', ui:'#d1693f', dispR:1.7, orbitR:74, period:687, rotDir:1, rotSpd:.019, ratio:0.53, tilt:25,
    atmo:{ c:'#e08a5e', i:.32, s:1.1 },
    descKey:'ssDescMars',
    rows:[['ssLabClass','ssClassRock',1], ['ssLabDiameter','6,792 km',0], ['ssLabMass','6.42×10²³ kg',0],
          ['ssLabDistance','ssDistMars',1], ['ssLabOrbit','ssOrbitMars',1], ['ssLabRotation','ssRotMars',1],
          ['ssLabTempMean','ssTempMars',1], ['ssLabMoons','ssMoonsMars',1], ['ssLabGravity','0.38 g',0]] },
  { id:'jupiter', nameKey:'ssJupiter', en:'JUPITER', ui:'#d8a06a', dispR:8, orbitR:106, period:4333, rotDir:1, rotSpd:.045, ratio:11.21, tilt:3,
    atmo:{ c:'#e7caa0', i:.35, s:1.07 },
    descKey:'ssDescJupiter',
    rows:[['ssLabClass','ssClassGas',1], ['ssLabDiameter','142,984 km',0], ['ssLabMass','1.90×10²⁷ kg',0],
          ['ssLabDistance','ssDistJupiter',1], ['ssLabOrbit','ssOrbitJupiter',1], ['ssLabRotation','ssRotJupiter',1],
          ['ssLabTempMean','ssTempJupiter',1], ['ssLabMoons','ssMoonsJupiter',1], ['ssLabGravity','2.53 g',0]] },
  { id:'saturn', nameKey:'ssSaturn', en:'SATURN', ui:'#e3c78f', dispR:6.8, orbitR:142, period:10759, rotDir:1, rotSpd:.042, ratio:9.45, tilt:27, ring:'saturn',
    atmo:{ c:'#eedcae', i:.3, s:1.07 },
    descKey:'ssDescSaturn',
    rows:[['ssLabClass','ssClassGas',1], ['ssLabDiameter','120,536 km',0], ['ssLabMass','5.68×10²⁶ kg',0],
          ['ssLabDistance','ssDistSaturn',1], ['ssLabOrbit','ssOrbitSaturn',1], ['ssLabRotation','ssRotSaturn',1],
          ['ssLabTempMean','ssTempSaturn',1], ['ssLabMoons','ssMoonsSaturn',1], ['ssLabGravity','1.07 g',0]] },
  { id:'uranus', nameKey:'ssUranus', en:'URANUS', ui:'#8fd0d6', dispR:4.2, orbitR:178, period:30687, rotDir:-1, rotSpd:.03, ratio:4.01, tilt:98, ring:'uranus',
    atmo:{ c:'#aef0f4', i:.5, s:1.1 },
    descKey:'ssDescUranus',
    rows:[['ssLabClass','ssClassIce',1], ['ssLabDiameter','51,118 km',0], ['ssLabMass','8.68×10²⁵ kg',0],
          ['ssLabDistance','ssDistUranus',1], ['ssLabOrbit','ssOrbitUranus',1], ['ssLabRotation','ssRotUranus',1],
          ['ssLabTempMean','ssTempUranus',1], ['ssLabMoons','ssMoonsUranus',1], ['ssLabGravity','0.89 g',0]] },
  { id:'neptune', nameKey:'ssNeptune', en:'NEPTUNE', ui:'#5a7fe0', dispR:4.0, orbitR:210, period:60190, rotDir:1, rotSpd:.032, ratio:3.88, tilt:28,
    atmo:{ c:'#7e9bff', i:.55, s:1.1 },
    descKey:'ssDescNeptune',
    rows:[['ssLabClass','ssClassIce',1], ['ssLabDiameter','49,528 km',0], ['ssLabMass','1.02×10²⁶ kg',0],
          ['ssLabDistance','ssDistNeptune',1], ['ssLabOrbit','ssOrbitNeptune',1], ['ssLabRotation','ssRotNeptune',1],
          ['ssLabTempMean','ssTempNeptune',1], ['ssLabMoons','ssMoonsNeptune',1], ['ssLabGravity','1.14 g',0]] },
];
/** Dictionary lookup that keeps working before the dictionary has arrived. */
const T = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback || key;
const MAX_RATIO = 11.21;

/* ===================== 펄린 노이즈 ===================== */
const Noise = (() => {
  const p = new Uint8Array(512);
  const perm = [...Array(256).keys()];
  let seed = 1337;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for(let i = 255; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for(let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y, z) => {
    h &= 15;
    const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };
  function n3(x, y, z){
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lp(
      lp(lp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
         lp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      lp(lp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
         lp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  function fbm(x, y, z, oct){
    let a = .5, f = 1, s = 0, nm = 0;
    for(let i = 0; i < oct; i++){ s += a * n3(x * f, y * f, z * f); nm += a; a *= .5; f *= 2.03; }
    return s / nm;
  }
  return { n3, fbm };
})();

/* ===================== 색/텍스처 헬퍼 ===================== */
const hexC = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const sstep = (a, b, t) => { t = clamp01((t - a) / (b - a)); return t * t * (3 - 2 * t); };
function ramp(stops, t){
  t = clamp01(t);
  for(let i = 0; i < stops.length - 1; i++){
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if(t <= b) return mixC(ca, cb, clamp01((t - a) / (b - a || 1e-6)));
  }
  return stops[stops.length - 1][1];
}
const R = stops => stops.map(([t, h]) => [t, hexC(h)]);

/* 구면 좌표를 돌며 픽셀 셰이더 실행 (가로/극지 이음매 없음) */
function buildSurface(w, h, shader, collect){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const heights = collect ? new Float32Array(w * h) : null;
  let k = 0;
  for(let j = 0; j < h; j++){
    const v = j / (h - 1);
    const lat = (.5 - v) * Math.PI;
    const sy = Math.sin(lat), cl = Math.cos(lat);
    for(let i = 0; i < w; i++){
      const lon = i / w * Math.PI * 2;
      const out = shader(Math.cos(lon) * cl, sy, Math.sin(lon) * cl, lon, k);
      const o = k * 4;
      d[o] = out[0]; d[o + 1] = out[1]; d[o + 2] = out[2]; d[o + 3] = 255;
      if(heights) heights[k] = out[3] || 0;
      k++;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, ctx, heights };
}
function grayCanvas(arr, w, h){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for(let i = 0; i < arr.length; i++){
    const v = clamp01(arr[i]) * 255, o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function lumBump(src){
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
  for(let i = 0; i < d.length; i += 4){
    const l = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11;
    d[i] = d[i + 1] = d[i + 2] = l;
  }
  x.putImageData(im, 0, 0);
  return c;
}
function sphereDir(latDeg, lonDeg){
  const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180;
  return [Math.cos(lo) * Math.cos(la), Math.sin(la), Math.sin(lo) * Math.cos(la)];
}

/* 크레이터: 이음매 보정을 위해 x±w에도 그림 */
function drawCraters(ctx, w, h, count, strength){
  const S = w / 512;
  for(let n = 0; n < count; n++){
    const lat = Math.asin(Math.random() * 2 - 1);
    const cx = Math.random() * w, cy = (.5 - lat / Math.PI) * h;
    const r = (1.5 + Math.pow(Math.random(), 2.2) * 13) * S;
    const rx = Math.min(r / Math.max(.25, Math.cos(lat)), w * .18);
    for(const ox of [-w, 0, w]){
      const x = cx + ox;
      const g = ctx.createRadialGradient(x, cy, 0, x, cy, rx);
      g.addColorStop(0, `rgba(0,0,0,${.5 * strength})`);
      g.addColorStop(.62, `rgba(0,0,0,${.16 * strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, cy, rx, r, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,248,238,${.3 * strength})`;
      ctx.lineWidth = Math.max(.8, r * .16);
      ctx.beginPath(); ctx.ellipse(x, cy, rx, r, 0, -.6, 2.2); ctx.stroke();
      ctx.strokeStyle = `rgba(0,0,0,${.28 * strength})`;
      ctx.beginPath(); ctx.ellipse(x, cy, rx * .92, r * .92, 0, 2.6, 5.6); ctx.stroke();
    }
  }
}

/* ===================== 행성별 표면 생성 ===================== */
function makeCratered(W, H, stops, opts){
  const F = opts.freq || 3.1, off = opts.off || 0;
  const sf = (x, y, z) => {
    let e = Noise.fbm(x * F + off, y * F, z * F, 6) * .5 + .5;
    if(opts.maria){
      const m = Noise.fbm(x * 1.15 + 13, y * 1.15, z * 1.15, 3);
      e -= sstep(.12, .5, m) * .2;
    }
    const c = ramp(stops, e);
    return [c[0], c[1], c[2], e];
  };
  const s = buildSurface(W, H, sf);
  drawCraters(s.ctx, W, H, opts.craters, opts.strength || 1);
  return { map: s.canvas, bump: lumBump(s.canvas) };
}

function makeEarth(){
  const W = 768, H = 384;
  const spec = new Float32Array(W * H);
  const ocean = R([[0,'#041d3d'],[.5,'#0a3a6e'],[.82,'#1465a8'],[1,'#2f8ec9']]);
  const land  = R([[0,'#bba87a'],[.08,'#7aa055'],[.38,'#3c7a3a'],[.6,'#5d6b3f'],[.78,'#7d7460'],[.9,'#9a948c'],[1,'#f2f4f4']]);
  const sf = (x, y, z, lon, k) => {
    let e = Noise.fbm(x * 2.1, y * 2.1, z * 2.1, 6) * .5 + .5;
    e += Noise.fbm(x * 5.6 + 7.3, y * 5.6, z * 5.6, 4) * .12;
    const ice = sstep(.84, .94, Math.abs(y) + (e - .5) * .12);
    let c, hgt, s;
    if(e < .54){
      c = ramp(ocean, e / .54); hgt = .2; s = 1;
    } else {
      const t = Math.min(1, (e - .54) / .38);
      c = ramp(land, t); hgt = .35 + t * .65; s = .05;
    }
    c = mixC(c, [238, 243, 246], ice);
    if(ice > .3){ hgt = Math.max(hgt, .55); s *= .3; }
    spec[k] = s;
    return [c[0], c[1], c[2], hgt];
  };
  const s = buildSurface(W, H, sf, true);
  return { map: s.canvas, bump: grayCanvas(s.heights, W, H), spec: grayCanvas(spec, W, H) };
}

function makeClouds(){
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  let k = 0;
  for(let j = 0; j < H; j++){
    const v = j / (H - 1), lat = (.5 - v) * Math.PI;
    const sy = Math.sin(lat), cl = Math.cos(lat);
    for(let i = 0; i < W; i++){
      const lon = i / W * Math.PI * 2;
      const x = Math.cos(lon) * cl, z = Math.sin(lon) * cl;
      const n1 = Noise.fbm(x * 1.7, sy * 4.2, z * 1.7, 5) * .5 + .5;
      const n2 = Noise.fbm(x * 4.5 + 3, sy * 9, z * 4.5, 4) * .5 + .5;
      const a = sstep(.5, .8, n1 * .68 + n2 * .42) * .95;
      const o = k * 4;
      img.data[o] = 255; img.data[o + 1] = 252; img.data[o + 2] = 249;
      img.data[o + 3] = a * 255;
      k++;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeVenus(){
  const stops = R([[0,'#b98e54'],[.3,'#d4ad72'],[.55,'#e9cf99'],[.78,'#f6e8c3'],[1,'#cfa86a']]);
  const sf = (x, y, z) => {
    const w1 = Noise.fbm(x * 1.4, y * 1.4, z * 1.4, 4);
    const w2 = Noise.fbm(x * 3.2 + 9, y * 3.2, z * 3.2, 4);
    const t = .5 + .5 * Math.sin(y * 4.6 + w1 * 3 + w2 * 1.4);
    let c = ramp(stops, t);
    c = mixC(c, [120, 88, 50], sstep(.7, 1, Math.abs(y)) * .25);
    return [c[0], c[1], c[2], t];
  };
  return { map: buildSurface(512, 256, sf).canvas };
}

function makeMars(){
  const W = 640, H = 320;
  const stops = R([[0,'#54281a'],[.25,'#86381f'],[.5,'#b05a32'],[.72,'#cd854f'],[1,'#e2ab6f']]);
  const vol = [
    { d: sphereDir(18, -110), r: .085 },   // 올림푸스산
    { d: sphereDir(2, -98),  r: .06 },
    { d: sphereDir(-8, -90), r: .055 },
  ];
  const sf = (x, y, z) => {
    let e = Noise.fbm(x * 2.5, y * 2.5, z * 2.5, 6) * .5 + .5 + y * .06;
    let c = ramp(stops, e);
    const m = Noise.fbm(x * 1.3 + 21, y * 1.3, z * 1.3, 4);
    c = mixC(c, hexC('#46211a'), sstep(.16, .5, m) * .45);
    for(const vlc of vol){
      const t = Math.acos(clamp01(x * vlc.d[0] + y * vlc.d[1] + z * vlc.d[2]));
      if(t < vlc.r){
        const f = 1 - t / vlc.r;
        c = mixC(c, hexC('#7c3a20'), f * .55);
        if(t < vlc.r * .2) c = mixC(c, hexC('#39180d'), .6);
      }
    }
    const capN = sstep(.84, .92, y + Noise.fbm(x * 6, y * 6, z * 6, 2) * .03);
    const capS = sstep(.9, .96, -y + Noise.fbm(x * 6 + 4, y * 6, z * 6, 2) * .02);
    c = mixC(c, [240, 235, 228], Math.max(capN, capS));
    return [c[0], c[1], c[2], e];
  };
  const s = buildSurface(W, H, sf);
  /* 마리네리스 협곡 */
  const ctx = s.ctx, y0 = H * .53;
  ctx.lineCap = 'round';
  for(const [wd, col] of [[H * .022, 'rgba(34,13,7,.5)'], [H * .01, 'rgba(20,8,4,.55)']]){
    ctx.strokeStyle = col; ctx.lineWidth = wd;
    ctx.beginPath();
    for(let i = 0; i <= 24; i++){
      const x = W * (.18 + .2 * i / 24);
      const y = y0 + Math.sin(i * 1.2) * H * .012 + (Math.random() - .5) * H * .008;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  drawCraters(ctx, W, H, 40, .5);
  return { map: s.canvas, bump: lumBump(s.canvas) };
}

function makeJupiter(){
  const stops = R([[0,'#9a6238'],[.22,'#c08a55'],[.45,'#e6cfa4'],[.62,'#f4ead2'],[.8,'#d9b384'],[1,'#a8743f']]);
  const la0 = -.38, lo0 = 1.1;
  const sf = (x, y, z, lon) => {
    const w1 = Noise.fbm(x * 1.5, y * 4.5, z * 1.5, 4) * .13;
    const w2 = Noise.fbm(x * 3.5 + 8, y * 9, z * 3.5, 3) * .05;
    const b = y + w1 + w2;
    const sBand = Math.sin(b * 12.5) + .55 * Math.sin(b * 25 + 1.3) + .3 * Math.sin(b * 6.1 + .5);
    let c = ramp(stops, (sBand + 1.85) / 3.7);
    const tb = Noise.fbm(x * 7 + 3, y * 16, z * 7, 3);
    c = mixC(c, [255, 250, 240], Math.max(0, tb) * .2);
    c = mixC(c, [110, 72, 42], Math.max(0, -tb) * .18);
    /* 대적점 */
    let dl = lon - lo0; dl = Math.atan2(Math.sin(dl), Math.cos(dl));
    const e = Math.sqrt((dl / .34) ** 2 + ((y - la0) / .15) ** 2);
    if(e < 1.3){
      const core = hexC('#c14a26'), mid = hexC('#d97a4a'), edge = hexC('#e8c9a0');
      let sc = e < .55 ? mixC(core, mid, e / .55) : mixC(mid, edge, (e - .55) / .75);
      sc = mixC(sc, [255, 236, 212], (Math.sin(e * 9 - 1.5) * .5 + .5) * .12);
      c = mixC(c, sc, (1 - sstep(.85, 1.3, e)) * .95);
      c = mixC(c, [246, 238, 224], sstep(.95, 1.05, e) * (1 - sstep(1.18, 1.3, e)) * .45);
    }
    c = mixC(c, hexC('#93714c'), sstep(.78, .97, Math.abs(y)) * .5);
    return [c[0], c[1], c[2], 0];
  };
  return { map: buildSurface(768, 384, sf).canvas };
}

function makeSaturn(){
  const stops = R([[0,'#b6915c'],[.28,'#d9c293'],[.52,'#eee1bd'],[.72,'#e2cfa0'],[1,'#c2a06a']]);
  const sf = (x, y, z) => {
    const w = Noise.fbm(x * 1.4, y * 4, z * 1.4, 4) * .09;
    const b = y + w;
    const sBand = Math.sin(b * 9) + .4 * Math.sin(b * 19 + 2) + .25 * Math.sin(b * 4.4);
    let c = ramp(stops, (sBand + 1.65) / 3.3);
    const tb = Noise.fbm(x * 6 + 5, y * 13, z * 6, 3);
    c = mixC(c, [255, 250, 238], Math.max(0, tb) * .1);
    c = mixC(c, hexC('#8d9a90'), sstep(.82, .98, Math.abs(y)) * .45);
    return [c[0], c[1], c[2], 0];
  };
  return { map: buildSurface(640, 320, sf).canvas };
}

function makeIce(kind){
  if(kind === 'uranus'){
    const sf = (x, y, z) => {
      const w = Noise.fbm(x * 1.2, y * 3, z * 1.2, 3) * .3;
      const t = .25 + .5 * (.5 + .5 * Math.sin(y * 4.5 + w));
      let c = mixC(hexC('#7fc6cf'), hexC('#a5e0e4'), t);
      c = mixC(c, hexC('#c2eff1'), sstep(.6, 1, y) * .35);
      return [c[0], c[1], c[2], 0];
    };
    return { map: buildSurface(512, 256, sf).canvas };
  }
  /* 해왕성 */
  const la0 = -.42, lo0 = 2.2;
  const sf = (x, y, z, lon) => {
    const w = Noise.fbm(x * 1.6, y * 4, z * 1.6, 4) * .4;
    const t = .5 + .5 * Math.sin(y * 6 + w * 2);
    let c = mixC(hexC('#2a49b8'), hexC('#4a6fdc'), t);
    c = mixC(c, hexC('#1d2f8a'), sstep(.5, 1, Math.abs(y)) * .3);
    const s = Noise.fbm(x * 2.2 + 4, y * 16, z * 2.2, 4);
    const band = Math.exp(-((y + .32) ** 2) / .02) + Math.exp(-((y - .15) ** 2) / .015);
    c = mixC(c, [236, 242, 255], clamp01(Math.max(0, s - .16) * band * 1.7));
    let dl = lon - lo0; dl = Math.atan2(Math.sin(dl), Math.cos(dl));
    const e = Math.sqrt((dl / .2) ** 2 + ((y - la0) / .11) ** 2);
    if(e < 1) c = mixC(c, hexC('#141f6e'), (1 - sstep(.5, 1, e)) * .55);
    return [c[0], c[1], c[2], 0];
  };
  return { map: buildSurface(512, 256, sf).canvas };
}

/* 토성/천왕성 고리: 반지름 방향 1D 프로파일 텍스처 */
function ringCanvas(kind){
  const W = 1024, H = 8;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  let walk = 0;
  for(let i = 0; i < W; i++){
    const t = i / (W - 1);
    walk = Math.max(-.4, Math.min(.4, walk + (Math.random() - .5) * .22));
    let a = 0, col = hexC('#e7d6ae');
    if(kind === 'saturn'){
      if(t < .08){ a = .25; col = hexC('#b3a285'); }
      else if(t < .5){ a = .96; col = hexC('#ecdcb4'); }
      else if(t < .565){ a = .06; col = hexC('#5c5242'); }          // 카시니 간극
      else if(t < .9){ a = .72; col = hexC('#dcc99c'); if(Math.abs(t - .84) < .007) a = .07; }  // 엥케 간극
      else a = .72 * (1 - (t - .9) / .1);
      a *= .82 + walk * .45;
      col = mixC(col, [120, 100, 70], Math.max(0, -walk) * .8);
    } else {
      const bands = [[.2, .02, .25], [.45, .015, .3], [.78, .03, .8], [.9, .015, .4]];
      for(const [ct, wd, ba] of bands) if(Math.abs(t - ct) < wd) a = Math.max(a, ba);
      col = hexC('#9fb6bd');
    }
    for(let j = 0; j < H; j++){
      const o = (j * W + i) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2];
      img.data[o + 3] = clamp01(a) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ===================== 렌더러/장면 ===================== */
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x04060d);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .5, 4000);
const MAXANISO = renderer.capabilities.getMaxAnisotropy();

function texFrom(canvas, srgb){
  const t = new THREE.CanvasTexture(canvas);
  if(srgb) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = MAXANISO;
  return t;
}

/* ── 셰이더 ── */
const ATMO_V = `
varying vec3 vN; varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const ATMO_F = `
uniform vec3 uC; uniform float uI;
varying vec3 vN; varying vec3 vV;
void main(){
  float a = pow(max(0.0, 0.62 + dot(vN, vV)), 3.2) * uI;
  gl_FragColor = vec4(uC, clamp(a, 0.0, 1.0));
}`;
const SUN_V = `
varying vec3 vP; varying vec3 vN; varying vec3 vV;
void main(){
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SUN_F = `
uniform float uTime;
varying vec3 vP; varying vec3 vN; varying vec3 vV;
float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float s = 0.0, a = 0.5; for(int i = 0; i < 5; i++){ s += a * noise(p); a *= 0.5; p *= 2.03; } return s; }
void main(){
  vec3 p = normalize(vP);
  float n1 = fbm(p * 3.0 + vec3(uTime * 0.05, uTime * 0.04, 0.0));
  float n2 = fbm(p * 8.0 - vec3(0.0, uTime * 0.07, uTime * 0.06));
  float t = clamp(n1 * 0.65 + n2 * 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.52, 0.13, 0.01), vec3(1.0, 0.5, 0.08), smoothstep(0.0, 0.45, t));
  col = mix(col, vec3(1.0, 0.84, 0.42), smoothstep(0.45, 0.72, t));
  col = mix(col, vec3(1.0, 0.98, 0.86), smoothstep(0.72, 1.0, t));
  float limb = clamp(dot(vN, vV), 0.0, 1.0);
  col *= 0.55 + 0.5 * pow(limb, 0.55);
  col += vec3(1.0, 0.42, 0.1) * pow(1.0 - limb, 2.6) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;

function glowTex(){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,225,160,1)');
  g.addColorStop(.32, 'rgba(255,170,80,.5)');
  g.addColorStop(1, 'rgba(255,130,55,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
function labelTex(text){
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '600 30px ' + getComputedStyle(document.body).fontFamily;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,.9)'; x.shadowBlur = 8;
  x.fillStyle = '#e9edf8';
  x.fillText(text, 128, 32);
  return new THREE.CanvasTexture(c);
}
function ringSpriteTex(){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineWidth = 7; x.globalAlpha = .95;
  x.setLineDash([26, 14]);
  x.beginPath(); x.arc(128, 128, 120, 0, 7); x.stroke();
  return new THREE.CanvasTexture(c);
}

/* ===================== 초기화 ===================== */
const pickMeshes = [];
const labelsGroup = new THREE.Group();
let SUN, EARTH, moon, belt, sunMat, earthClouds;
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

function buildBodies(){
  scene.add(new THREE.AmbientLight(0x44587a, .55));
  scene.add(new THREE.PointLight(0xfff3e0, 2.3, 0, 0));
  scene.add(labelsGroup);

  /* 별 (두 겹) */
  for(const [N, sz, near, far, op] of [[1900, 1.4, 750, 1600, .8], [260, 2.8, 750, 1400, 1]]){
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for(let i = 0; i < N; i++){
      const r = near + Math.random() * (far - near);
      const t = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(t);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(t);
      const warm = Math.random();
      col[i * 3] = .75 + warm * .25; col[i * 3 + 1] = .78 + warm * .15; col[i * 3 + 2] = .85 + Math.random() * .15;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: sz, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: op })));
  }

  /* 소행성대 */
  {
    const N = 1500, pos = new Float32Array(N * 3);
    for(let i = 0; i < N; i++){
      const r = 86 + Math.random() * 12, a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = (Math.random() - .5) * 2.6;
      pos[i * 3 + 2] = -Math.sin(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    belt = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9b8d7a, size: 1.0, transparent: true, opacity: .7 }));
    scene.add(belt);
  }

  /* 천체 */
  BODIES.forEach(b => {
    b.phase = b.id === 'sun' ? 0 : Math.random() * Math.PI * 2;
    b.pos = new THREE.Vector3();
    b.holder = new THREE.Group();
    b.tiltG = new THREE.Group();
    b.holder.add(b.tiltG);
    if(b.tilt) b.tiltG.rotation.z = THREE.MathUtils.degToRad(b.tilt);

    let mat;
    const big = ['earth', 'jupiter', 'saturn'].includes(b.id);
    if(b.id === 'sun'){
      sunMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SUN_V, fragmentShader: SUN_F });
      mat = sunMat;
    } else {
      let r;
      if(b.id === 'mercury') r = makeCratered(512, 256, R([[0,'#4f463c'],[.3,'#6e6356'],[.6,'#8e8270'],[.85,'#aa9d88'],[1,'#c0b49e']]), { craters: 110, maria: true });
      else if(b.id === 'venus') r = makeVenus();
      else if(b.id === 'earth') r = makeEarth();
      else if(b.id === 'mars') r = makeMars();
      else if(b.id === 'jupiter') r = makeJupiter();
      else if(b.id === 'saturn') r = makeSaturn();
      else r = makeIce(b.id);

      const opt = { map: texFrom(r.map, true), shininess: 6, specular: new THREE.Color('#1c1c1c') };
      if(r.bump){ opt.bumpMap = texFrom(r.bump, false); opt.bumpScale = b.id === 'earth' ? .1 : b.id === 'mars' ? .08 : .05; }
      if(r.spec){ opt.specularMap = texFrom(r.spec, false); opt.specular = new THREE.Color('#46627e'); opt.shininess = 26; }
      mat = new THREE.MeshPhongMaterial(opt);
    }

    b.mesh = new THREE.Mesh(new THREE.SphereGeometry(b.dispR, big ? 96 : 64, big ? 64 : 48), mat);
    b.mesh.userData.body = b;
    b.tiltG.add(b.mesh);
    pickMeshes.push(b.mesh);

    /* 지구 구름 */
    if(b.id === 'earth'){
      earthClouds = new THREE.Mesh(
        new THREE.SphereGeometry(b.dispR * 1.018, 64, 48),
        new THREE.MeshLambertMaterial({ map: texFrom(makeClouds(), true), transparent: true, depthWrite: false })
      );
      b.tiltG.add(earthClouds);
    }

    /* 대기 프레넬 글로우 */
    if(b.atmo){
      const am = new THREE.Mesh(
        new THREE.SphereGeometry(b.dispR * b.atmo.s, 48, 32),
        new THREE.ShaderMaterial({
          uniforms: { uC: { value: new THREE.Color(b.atmo.c) }, uI: { value: b.atmo.i } },
          vertexShader: ATMO_V, fragmentShader: ATMO_F,
          blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
        })
      );
      b.tiltG.add(am);
    }

    /* 고리 */
    if(b.ring){
      const inner = b.dispR * (b.ring === 'saturn' ? 1.4 : 1.6);
      const outer = b.dispR * (b.ring === 'saturn' ? 2.3 : 1.95);
      const geo = new THREE.RingGeometry(inner, outer, 128, 1);
      const pAttr = geo.attributes.position, uvAttr = geo.attributes.uv;
      for(let i = 0; i < pAttr.count; i++){
        const rr = Math.hypot(pAttr.getX(i), pAttr.getY(i));
        uvAttr.setXY(i, (rr - inner) / (outer - inner), .5);
      }
      const rt = texFrom(ringCanvas(b.ring), true);
      const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: rt, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      b.tiltG.add(ring);
    }

    if(b.id === 'sun'){
      for(const [sc, op] of [[58, .95], [120, .5]]){
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op }));
        sp.scale.set(sc, sc, 1);
        b.holder.add(sp);
      }
    } else {
      const orbit = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 128 }, (_, i) => {
            const a = i / 128 * Math.PI * 2;
            return new THREE.Vector3(Math.cos(a) * b.orbitR, 0, Math.sin(a) * b.orbitR);
          })
        ),
        new THREE.LineBasicMaterial({ color: 0x44507a, transparent: true, opacity: .5 })
      );
      scene.add(orbit);
    }

    b.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(T(b.nameKey)), depthTest: false, transparent: true }));
    labelsGroup.add(b.label);
    scene.add(b.holder);
  });
  SUN = BODIES[0];
  EARTH = BODIES.find(b => b.id === 'earth');

  /* 달 */
  const moonTex = makeCratered(256, 128, R([[0,'#55534f'],[.35,'#75726c'],[.65,'#94908a'],[1,'#b5b1a8']]), { craters: 60, maria: true, strength: .9 });
  moon = new THREE.Mesh(
    new THREE.SphereGeometry(.65, 32, 24),
    new THREE.MeshPhongMaterial({ map: texFrom(moonTex.map, true), bumpMap: texFrom(moonTex.bump, false), bumpScale: .035, shininess: 4 })
  );
  scene.add(moon);
}

/* 선택 표시 링 */
const selRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringSpriteTex(), depthTest: false, transparent: true }));
selRing.visible = false; scene.add(selRing);

/* ===================== 카메라 컨트롤 ===================== */
let theta = .6, phi = 1.12, radius = 300;
const camTarget = new THREE.Vector3();
let selected = null, trans = null;
const minR = () => selected ? selected.dispR * 2.4 + 2 : 16;

function focusBody(b){
  selected = b;
  trans = { from: camTarget.clone(), fromR: radius, toR: b ? Math.max(b.dispR * 6, 15) : 300, t: 0 };
  if(b){ openPanel(b); } else { openBody = null; panel.classList.remove('open'); }
  selRing.visible = !!b;
  if(b) selRing.material.color.set(b.ui);
  document.querySelectorAll('.chip').forEach(c => {
    const on = b && c.dataset.id === b.id;
    c.classList.toggle('on', on);
    c.style.background = on ? b.ui : '';
  });
}

const el = renderer.domElement;
const pointers = new Map();
let downInfo = null, pinchDist = 0;
el.addEventListener('pointerdown', e => {
  el.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if(pointers.size === 1) downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
  if(pointers.size === 2){
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
el.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId); if(!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if(pointers.size === 1){
    if(downInfo) downInfo.moved += Math.abs(dx) + Math.abs(dy);
    theta -= dx * .0045;
    phi = clampN(phi - dy * .0045, .08, 1.52);
  } else if(pointers.size === 2){
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if(pinchDist > 0 && d > 0) radius = clampN(radius * pinchDist / d, minR(), 800);
    pinchDist = d;
  }
});
function pointerEnd(e){
  pointers.delete(e.pointerId);
  if(pointers.size < 2) pinchDist = 0;
  if(downInfo && pointers.size === 0){
    const dt = performance.now() - downInfo.t;
    if(downInfo.moved < 10 && dt < 450) pick(e.clientX, e.clientY);
    downInfo = null;
  }
}
el.addEventListener('pointerup', pointerEnd);
el.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); downInfo = null; });
el.addEventListener('wheel', e => {
  e.preventDefault();
  radius = clampN(radius * Math.pow(1.0013, e.deltaY), minR(), 800);
}, { passive: false });

/* 탭 → 천체 선택 (레이캐스트 + 화면 근접 보조) */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(cx, cy){
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickMeshes)[0];
  if(hit){ focusBody(hit.object.userData.body); return; }
  let best = null, bestD = 34;
  const v = new THREE.Vector3();
  BODIES.forEach(b => {
    v.copy(b.pos).project(camera);
    if(v.z > 1) return;
    const sx = (v.x * .5 + .5) * innerWidth, sy = (-v.y * .5 + .5) * innerHeight;
    const d = Math.hypot(sx - cx, sy - cy);
    if(d < bestD){ bestD = d; best = b; }
  });
  focusBody(best);
}

/* ===================== UI ===================== */
const panel = document.getElementById('panel');
let openBody = null;
function openPanel(b){
  openBody = b;
  document.getElementById('pBar').style.background = b.ui;
  document.getElementById('pEn').textContent = b.en;
  document.getElementById('pName').textContent = T(b.nameKey);
  document.getElementById('pDesc').textContent = T(b.descKey);
  const grid = document.getElementById('pGrid');
  grid.innerHTML = '';
  b.rows.forEach(([labelKey, val, isKey]) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const dt = document.createElement('dt'); dt.textContent = T(labelKey);
    const dd = document.createElement('dd'); dd.textContent = isKey ? T(val) : val;
    cell.append(dt, dd);
    grid.appendChild(cell);
  });
  const fill = document.getElementById('cmpFill');
  fill.style.background = `linear-gradient(90deg, ${b.ui}, #ffffffcc)`;
  fill.style.width = Math.min(100, b.ratio / MAX_RATIO * 100) + '%';
  document.getElementById('cmpCap').innerHTML =
    b.id === 'sun'
      ? T('ssDiameterSun', 'Diameter = <b>109.2×</b> Earth (off the scale)')
      : T('ssDiameter', 'Diameter = <b>{x}×</b> Earth').replace('{x}', b.ratio.toFixed(2));
  panel.classList.add('open');
}
document.getElementById('pClose').addEventListener('click', () => focusBody(null));
document.getElementById('resetBtn').addEventListener('click', () => focusBody(null));
addEventListener('keydown', e => { if(e.key === 'Escape') focusBody(null); });

/* 칩 */
const rail = document.getElementById('chips');
BODIES.forEach(b => {
  const c = document.createElement('button');
  c.className = 'chip'; c.dataset.id = b.id; c.dataset.i18n = b.nameKey;
  c.textContent = T(b.nameKey);
  c.addEventListener('click', () => focusBody(b));
  rail.appendChild(c);
});

/* 속도 / 정지 / 라벨 */
let paused = false, mult = 1;
const speedEl = document.getElementById('speed');
const fmtMult = m => '×' + (m < .1 ? m.toFixed(2) : m < 10 ? m.toFixed(1) : Math.round(m));
speedEl.addEventListener('input', () => {
  mult = Math.pow(10, (speedEl.value - 50) / 25);
  document.getElementById('spdLab').textContent = fmtMult(mult);
  document.getElementById('tSpeed').textContent = fmtMult(mult);
});
const pauseBtn = document.getElementById('pauseBtn');
/** The pause button carries two strings, so it is repainted rather than bound. */
function paintPause(){
  pauseBtn.textContent = paused ? T('ssResume', '▶ Play') : T('ssPause', '⏸ Pause');
  pauseBtn.setAttribute('aria-label', T('ssPauseAria', 'Pause'));
}
pauseBtn.addEventListener('click', () => { paused = !paused; paintPause(); });
paintPause();
speedEl.setAttribute('aria-label', T('ssSpeedAria', 'Time rate'));
const labelBtn = document.getElementById('labelBtn');
labelBtn.addEventListener('click', () => {
  labelsGroup.visible = !labelsGroup.visible;
  labelBtn.style.opacity = labelsGroup.visible ? 1 : .45;
});

/* ===================== 메인 루프 ===================== */
/*
 * assets/reduced-motion.js gates animation by freezing the timestamp handed
 * to requestAnimationFrame, which stops every loop that derives dt from it.
 * This one does not: THREE.Clock reads performance.now() internally, and the
 * sun's pulse read it directly, so the whole scene kept turning at full tilt
 * for a reader who had asked the system to stop moving things — while the
 * notice at the top of the stage said "paused". The gate publishes a clock of
 * its own for exactly this case, and both time sources below now ask it.
 *
 * It went unseen locally because three.js comes from a CDN this development
 * container cannot reach, so the scene never built here; CI reaches it fine
 * and the whole-catalogue sweep caught it there.
 */
const rmGated = () => !!(window.ReducedMotion && window.ReducedMotion.active);
const rmSeconds = () => (window.ReducedMotion
  ? window.ReducedMotion.clock() : performance.now() / 1000);

const clock = new THREE.Clock();
let simDays = 0, tAnim = 0;
const DAYS_PER_SEC = 12;
const easeIO = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

let rafId = 0;
function animate(){
  rafId = requestAnimationFrame(animate);
  // getDelta() is called either way, and its value dropped while gated: the
  // clock measures from its own last call, so skipping it would bank the
  // whole paused stretch and hand it over in one step when Play is pressed.
  const elapsed = Math.min(clock.getDelta(), .05);
  const dt = rmGated() ? 0 : elapsed;
  if(!paused){ simDays += dt * DAYS_PER_SEC * mult; tAnim += dt; }
  sunMat.uniforms.uTime.value = tAnim;

  BODIES.forEach(b => {
    if(b.orbitR > 0){
      const a = b.phase + simDays / b.period * Math.PI * 2;
      b.pos.set(Math.cos(a) * b.orbitR, 0, -Math.sin(a) * b.orbitR);
    }
    b.holder.position.copy(b.pos);
    if(!paused) b.mesh.rotation.y += b.rotDir * b.rotSpd * Math.min(mult, 5) * dt * 60;
    b.label.position.set(b.pos.x, b.pos.y + b.dispR * 1.5 + 2.2, b.pos.z);
    const d = camera.position.distanceTo(b.pos);
    const s = clampN(d * .052, 6, 60);
    b.label.scale.set(s, s / 4, 1);
  });
  if(!paused && earthClouds) earthClouds.rotation.y += EARTH.rotSpd * 1.3 * Math.min(mult, 5) * dt * 60;
  const ma = simDays / 27.3 * Math.PI * 2;
  moon.position.set(EARTH.pos.x + Math.cos(ma) * 4.6, 0, EARTH.pos.z - Math.sin(ma) * 4.6);
  if(!paused) belt.rotation.y += dt * .004 * Math.min(mult, 5);

  /* 카메라 */
  const desired = selected ? selected.pos : SUN.pos;
  if(trans){
    // The camera flight is the one piece of motion that must not simply
    // freeze: with dt held at zero the reader who picks a planet would sit
    // where they were and nothing would happen. Reduced motion means arrive
    // without the journey, so the transition completes in a single frame.
    trans.t = Math.min(1, trans.t + (rmGated() ? 1 : dt / .9));
    const e = easeIO(trans.t);
    camTarget.lerpVectors(trans.from, desired, e);
    radius = trans.fromR + (trans.toR - trans.fromR) * e;
    if(trans.t >= 1) trans = null;
  } else {
    camTarget.copy(desired);
  }
  camera.position.set(
    camTarget.x + radius * Math.sin(phi) * Math.sin(theta),
    camTarget.y + radius * Math.cos(phi),
    camTarget.z + radius * Math.sin(phi) * Math.cos(theta)
  );
  camera.lookAt(camTarget);

  if(selected){
    selRing.position.copy(selected.pos);
    const pulse = 1 + Math.sin(rmSeconds() * 4) * .05;
    const rs = selected.dispR * 3.2 * pulse;
    selRing.scale.set(rs, rs, 1);
  }

  const days = Math.floor(simDays);
  document.getElementById('tDays').textContent = days >= 365
    ? T('ssDaysYears', '{n} d ({y} yr)')
        .replace('{n}', days.toLocaleString()).replace('{y}', (simDays / 365.25).toFixed(1))
    : T('ssDays', '{n} d').replace('{n}', days);

  renderer.render(scene, camera);
}

/* The chips, the pause label and the whole observation card are built in JS,
   so `data-i18n` cannot reach them. Repaint them when the language changes. */
document.addEventListener('langchange', () => {
  paintPause();
  rail.querySelectorAll('.chip').forEach((c) => {
    const b = BODIES.find((x) => x.id === c.dataset.id);
    if (b) c.textContent = T(b.nameKey);
  });
  if (openBody) openPanel(openBody);
  // The in-scene labels are baked into a texture, so they have to be redrawn
  // rather than reassigned — and the old texture released with them.
  BODIES.forEach((b) => {
    if (!b.label) return;
    const old = b.label.material.map;
    b.label.material.map = labelTex(T(b.nameKey));
    b.label.material.needsUpdate = true;
    if (old) old.dispose();
  });
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Pause the heavy WebGL loop when the tab is hidden — every per-pixel
// star-field + procedural planet shader stays cool in the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(rafId); rafId = 0; }
  else if (!rafId) { rafId = requestAnimationFrame(animate); }
});

/* 로딩 화면이 먼저 그려지도록 두 프레임 뒤에 생성 시작 */
requestAnimationFrame(() => requestAnimationFrame(() => {
  buildBodies();
  document.getElementById('loading').remove();
  animate();
}));

/*
 * The handle tests/experiments/solarsystem.test.mjs reads the tour through.
 * It exposes the table the tour is built from and the positions it puts the
 * bodies at; the clock is moved by the same variable the animation moves, so
 * what the suite measures is what a reader watching would see.
 */
window.__ss = {
  bodies: () => BODIES.map((b) => ({
    id: b.id, period: b.period, ratio: b.ratio, tilt: b.tilt,
    rotDir: b.rotDir, orbitR: b.orbitR, dispR: b.dispR,
  })),
  /** Put the clock at an exact day count and lay the bodies out for it. */
  setDays(d) {
    simDays = d;
    for (const b of BODIES) {
      if (b.orbitR > 0) {
        const a = b.phase + simDays / b.period * Math.PI * 2;
        b.pos.set(Math.cos(a) * b.orbitR, 0, -Math.sin(a) * b.orbitR);
      }
      b.holder.position.copy(b.pos);
    }
    const ma = simDays / 27.3 * Math.PI * 2;
    moon.position.set(EARTH.pos.x + Math.cos(ma) * 4.6, 0, EARTH.pos.z - Math.sin(ma) * 4.6);
  },
  days: () => simDays,
  /** Where each body is right now, in the tour's own units. */
  positions: () => {
    const out = {};
    for (const b of BODIES) out[b.id] = { x: b.pos.x, z: b.pos.z };
    out.moon = { x: moon.position.x, z: moon.position.z };
    return out;
  },
  select: (id) => focusBody(BODIES.find((b) => b.id === id) || null),
  /** What the info card says about the body now open. */
  card: () => ({
    title: (document.getElementById('pName') || {}).textContent,
    diameter: (document.getElementById('cmpCap') || {}).textContent,
  }),
  elapsedText: () => document.getElementById('tDays').textContent.trim(),
};
}   /* end of the `typeof THREE` guard opened above */
