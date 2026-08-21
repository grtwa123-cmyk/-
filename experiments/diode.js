(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const batteryToggle = document.getElementById('battery-toggle');
  const voltageInput = document.getElementById('voltage');
  const voltageValue = document.getElementById('voltage-value');
  const tempInput = document.getElementById('temperature');
  const tempValue = document.getElementById('temperature-value');
  const reverseBtn = document.getElementById('reverse-btn');
  const propBias = document.getElementById('prop-bias');
  const propCurrent = document.getElementById('prop-current');

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  const COLOR = {
    electron: '#6ea8ff',
    hole: '#ff6b8a',
    si: '#6b748f',
    donor: '#6effc6',
    acceptor: '#ffb86b',
    bondLine: 'rgba(255, 255, 255, 0.06)',
    nFill: 'rgba(110, 168, 255, 0.08)',
    pFill: 'rgba(255, 107, 138, 0.08)',
    depletionFill: 'rgba(255, 184, 107, 0.12)',
    depletionEdge: 'rgba(255, 184, 107, 0.45)',
    builtIn: 'rgba(255, 184, 107, 0.7)',
    junction: 'rgba(255, 255, 255, 0.5)',
    border: 'rgba(110, 168, 255, 0.45)',
    wire: '#8d97b6',
    plus: '#ff6b8a',
    minus: '#6ea8ff',
    fieldArrow: 'rgba(255, 184, 107, 0.7)',
    rowLabel: '#ecf0fb',
  };

  const ATOMS_X = 18;
  const ATOMS_Y = 5;

  let batteryOn = true;
  let polarity = 1; // +1 = + on right (P-side) = forward bias
  let voltage = parseFloat(voltageInput.value);
  let temperature = parseFloat(tempInput.value);

  let layout = null;
  let atoms = [];
  let electrons = [];
  let holes = [];
  let ionizedDonors = []; // positions of ionized donor atoms (near junction on N-side)
  let ionizedAcceptors = []; // positions of ionized acceptor atoms (near junction on P-side)
  let animId = null;
  let lastTs = 0;
  let smoothedCurrent = 0;
  let CW = 800;
  let CH = 720;

  const BASE_DEPLETION_WIDTH = 0.18; // as fraction of device width
  const BUILT_IN_FIELD = 220; // depletion field at zero bias
  // How far a carrier driven across the junction gets before it recombines,
  // as a fraction of the device. A diffusion length, in other words.
  const RECOMB_LEN = 0.12;
  // Depth of the accumulation layer that builds at a contact when the bias
  // drives majority carriers into it, as a fraction of the device.
  const ACCUM_LAYER = 0.10;
  // Seconds the ammeter averages over. The current is a crossing rate and
  // crossings are discrete events, so a short window reads them as a flicker
  // between nothing and everything.
  const CURRENT_TAU = 1.0;
  // Crossings per carrier per second at which the ammeter reads 100%.
  const CURRENT_FULL = 0.45;

  function computeLayout() {
    const margin = 18;
    const batteryH = 140;
    const left = 60;
    const right = CW - 30;
    const top = batteryH + margin * 2;
    const bottom = CH - 30;
    const junctionX = (left + right) / 2;
    return { margin, batteryTop: margin, batteryH, left, right, top, bottom, junctionX };
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function deviceWidth() { return layout.right - layout.left; }
  function deviceHeight() { return layout.bottom - layout.top; }

  /** The height of the junction's potential barrier, in units of the
   *  built-in one. Forward bias subtracts from it, reverse bias adds to it.
   *  This single number is the whole diode: everything below reads it. */
  function junctionPotential() {
    if (!batteryOn) return 1;
    return polarity === 1 ? Math.max(0.05, 1 - 0.55 * voltage) : 1 + 0.9 * voltage;
  }

  function currentDepletionHalfWidth() {
    const base = BASE_DEPLETION_WIDTH * deviceWidth() / 2;
    // W ∝ √V_j — the abrupt-junction result. The peak field goes as √V_j
    // too, so their product, which is the barrier a carrier actually has to
    // get over, comes out proportional to the potential, as it must.
    return Math.max(8, base * Math.sqrt(junctionPotential()));
  }

  /** The field inside the depletion region. It has to move with the bias:
   *  held at a constant while only the width moved, the barrier got wider
   *  under reverse bias and no stronger, and the drift walked straight
   *  through it. The junction was not a diode at all. */
  function depletionField() {
    return BUILT_IN_FIELD * Math.sqrt(junctionPotential());
  }

  /** What the ammeter shows, 0 to 1. The sign of smoothedCurrent is the
   *  direction the conventional current runs; the needle only has the one
   *  direction to move in. */
  function currentFraction() {
    return Math.min(1, Math.abs(smoothedCurrent) / CURRENT_FULL);
  }

  function buildLattice() {
    atoms = [];
    ionizedDonors = [];
    ionizedAcceptors = [];
    const stepX = deviceWidth() / (ATOMS_X - 1);
    const stepY = deviceHeight() / (ATOMS_Y - 1);
    for (let j = 0; j < ATOMS_Y; j++) {
      for (let i = 0; i < ATOMS_X; i++) {
        const x = layout.left + i * stepX;
        const y = layout.top + j * stepY;
        let el = 'Si';
        // sprinkle donors on N (left half) and acceptors on P (right half)
        const isN = x < layout.junctionX;
        if (isN) {
          // every 4th column on alternating rows: donor
          if ((i % 3) === 1 && (j % 2) === 0 && Math.random() < 0.85) el = 'Donor';
        } else {
          if ((i % 3) === 2 && (j % 2) === 1 && Math.random() < 0.85) el = 'Acceptor';
        }
        atoms.push({ x, y, el });
      }
    }
    // Pick ionized dopants near the junction (within base depletion zone)
    const baseHalf = BASE_DEPLETION_WIDTH * deviceWidth() / 2;
    for (const a of atoms) {
      const dx = a.x - layout.junctionX;
      if (a.el === 'Donor' && dx < 0 && Math.abs(dx) <= baseHalf * 1.3) ionizedDonors.push({ x: a.x, y: a.y });
      if (a.el === 'Acceptor' && dx > 0 && dx <= baseHalf * 1.3) ionizedAcceptors.push({ x: a.x, y: a.y });
    }
  }

  function spawnCarriersInSide(n, sideLeft, sideRight, depletionHalf) {
    const arr = [];
    let tries = 0;
    while (arr.length < n && tries < n * 12) {
      tries++;
      const x = rand(sideLeft, sideRight);
      // skip if in depletion region (so the initial state shows depletion clearly)
      if (Math.abs(x - layout.junctionX) < depletionHalf) continue;
      const y = rand(layout.top + 8, layout.bottom - 8);
      arr.push({ x, y, vx: 0, vy: 0 });
    }
    return arr;
  }

  function initCarriers() {
    const dHalf = currentDepletionHalfWidth();
    // N-side (left): many electrons, few holes
    const nL = layout.left, nR = layout.junctionX;
    const pL = layout.junctionX, pR = layout.right;
    const elN = spawnCarriersInSide(26, nL, nR, dHalf);
    const elP = spawnCarriersInSide(3, pL, pR, dHalf);
    const hN  = spawnCarriersInSide(3, nL, nR, dHalf);
    const hP  = spawnCarriersInSide(26, pL, pR, dHalf);
    electrons = elN.concat(elP);
    holes = hN.concat(hP);
  }

  function drawBattery() {
    const cx = CW / 2;
    const top = layout.batteryTop;
    const bH = 84;
    const bW = 250;
    const bx = cx - bW / 2;
    const by = top + 10;

    ctx.save();
    ctx.fillStyle = 'rgba(35, 42, 68, 0.95)';
    ctx.strokeStyle = 'rgba(110, 168, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bW, bH, 14);
    ctx.fill();
    ctx.stroke();

    const leftLabel = polarity === 1 ? '−' : '+';
    const rightLabel = polarity === 1 ? '+' : '−';
    const leftColor = polarity === 1 ? COLOR.minus : COLOR.plus;
    const rightColor = polarity === 1 ? COLOR.plus : COLOR.minus;

    ctx.font = `bold 40px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = leftColor;
    ctx.fillText(leftLabel, bx + 38, by + bH / 2);
    ctx.fillStyle = rightColor;
    ctx.fillText(rightLabel, bx + bW - 38, by + bH / 2);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 82, by + 22);
    ctx.lineTo(bx + 82, by + bH - 22);
    ctx.moveTo(bx + bW - 82, by + 22);
    ctx.lineTo(bx + bW - 82, by + bH - 22);
    ctx.stroke();

    ctx.font = `600 16px ${FONT}`;
    ctx.fillStyle = 'rgba(232, 236, 247, 0.75)';
    ctx.fillText(i18nText('battery', 'Battery'), cx, by + bH / 2);

    // Wires from battery to device
    const wireY = by + bH;
    const wireBottom = layout.top - 10;
    ctx.strokeStyle = COLOR.wire;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx + 38, wireY);
    ctx.lineTo(bx + 38, wireBottom);
    ctx.lineTo(layout.left, wireBottom);
    ctx.lineTo(layout.left, layout.top);
    ctx.moveTo(bx + bW - 38, wireY);
    ctx.lineTo(bx + bW - 38, wireBottom);
    ctx.lineTo(layout.right, wireBottom);
    ctx.lineTo(layout.right, layout.top);
    ctx.stroke();

    if (batteryOn) {
      const rightward = polarity === 1;
      drawCurrentArrow(wireBottom, bx + bW - 38, layout.right, rightward);
      drawCurrentArrow(wireBottom, layout.left, bx + 38, rightward);

      if (currentFraction() > 0.02) {
        const phase = (performance.now() / 1000 * (0.8 + currentFraction() * 2)) % 1;
        const rStart = rightward ? bx + bW - 38 : layout.right;
        const rEnd   = rightward ? layout.right : bx + bW - 38;
        const lStart = rightward ? layout.left  : bx + 38;
        const lEnd   = rightward ? bx + 38      : layout.left;
        ctx.fillStyle = COLOR.fieldArrow;
        ctx.beginPath();
        ctx.arc(rStart + phase * (rEnd - rStart), wireBottom, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(lStart + phase * (lEnd - lStart), wireBottom, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawCurrentArrow(y, x1, x2, rightward) {
    const cx = (x1 + x2) / 2;
    ctx.save();
    ctx.fillStyle = COLOR.fieldArrow;
    ctx.beginPath();
    if (rightward) {
      ctx.moveTo(cx - 6, y - 6);
      ctx.lineTo(cx + 8, y);
      ctx.lineTo(cx - 6, y + 6);
    } else {
      ctx.moveTo(cx + 6, y - 6);
      ctx.lineTo(cx - 8, y);
      ctx.lineTo(cx + 6, y + 6);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawDevice() {
    const { left, right, top, bottom, junctionX } = layout;
    const dHalf = currentDepletionHalfWidth();
    const depL = junctionX - dHalf;
    const depR = junctionX + dHalf;

    // Backgrounds for N-side, P-side, depletion
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, bottom - top, 10);
    ctx.clip();

    ctx.fillStyle = COLOR.nFill;
    ctx.fillRect(left, top, junctionX - left, bottom - top);
    ctx.fillStyle = COLOR.pFill;
    ctx.fillRect(junctionX, top, right - junctionX, bottom - top);

    // Depletion region
    ctx.fillStyle = COLOR.depletionFill;
    ctx.fillRect(depL, top, depR - depL, bottom - top);

    // Junction line
    ctx.strokeStyle = COLOR.junction;
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(junctionX, top);
    ctx.lineTo(junctionX, bottom);
    ctx.stroke();

    // Depletion edges
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = COLOR.depletionEdge;
    ctx.beginPath();
    ctx.moveTo(depL, top);
    ctx.lineTo(depL, bottom);
    ctx.moveTo(depR, top);
    ctx.lineTo(depR, bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();

    // Border around device
    ctx.save();
    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, bottom - top, 10);
    ctx.stroke();
    ctx.restore();

    // Region labels
    ctx.save();
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(110, 168, 255, 0.95)';
    ctx.fillText(i18nText('nRegion', 'N'), (left + depL) / 2, top + 12);
    ctx.fillStyle = 'rgba(255, 107, 138, 0.95)';
    ctx.fillText(i18nText('pRegion', 'P'), (depR + right) / 2, top + 12);
    ctx.restore();

    // Terminal markers on device edges
    const leftLabel = polarity === 1 ? '−' : '+';
    const rightLabel = polarity === 1 ? '+' : '−';
    const leftColor = polarity === 1 ? COLOR.minus : COLOR.plus;
    const rightColor = polarity === 1 ? COLOR.plus : COLOR.minus;
    ctx.save();
    ctx.font = `bold 28px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = batteryOn ? leftColor : 'rgba(141, 151, 182, 0.4)';
    ctx.fillText(leftLabel, left - 20, (top + bottom) / 2);
    ctx.fillStyle = batteryOn ? rightColor : 'rgba(141, 151, 182, 0.4)';
    ctx.fillText(rightLabel, right + 20, (top + bottom) / 2);
    ctx.restore();

    // Built-in field arrows (only inside depletion region)
    if (depR - depL > 12) {
      ctx.save();
      ctx.strokeStyle = COLOR.builtIn;
      ctx.fillStyle = COLOR.builtIn;
      ctx.lineWidth = 1.5;
      const arrowY = (top + bottom) / 2;
      const arrowStart = depL + 8;
      const arrowEnd = depR - 8;
      ctx.beginPath();
      ctx.moveTo(arrowStart, arrowY);
      ctx.lineTo(arrowEnd, arrowY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(arrowEnd - 6, arrowY - 5);
      ctx.lineTo(arrowEnd + 2, arrowY);
      ctx.lineTo(arrowEnd - 6, arrowY + 5);
      ctx.closePath();
      ctx.fill();
      ctx.font = `600 15px ${FONT}`;
      ctx.fillStyle = COLOR.builtIn;
      ctx.textAlign = 'center';
      ctx.fillText(i18nText('builtInField', 'E_built-in'), (depL + depR) / 2, arrowY - 12);
      ctx.restore();
    }
  }

  function drawAtoms() {
    ctx.save();
    ctx.strokeStyle = COLOR.bondLine;
    ctx.lineWidth = 1;
    for (let j = 0; j < ATOMS_Y; j++) {
      for (let i = 0; i < ATOMS_X - 1; i++) {
        const a = atoms[j * ATOMS_X + i];
        const b = atoms[j * ATOMS_X + i + 1];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    for (let i = 0; i < ATOMS_X; i++) {
      for (let j = 0; j < ATOMS_Y - 1; j++) {
        const a = atoms[j * ATOMS_X + i];
        const b = atoms[(j + 1) * ATOMS_X + i];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    for (const atom of atoms) {
      let r = 3.5;
      let color = COLOR.si;
      if (atom.el === 'Donor') { color = COLOR.donor; r = 5; }
      else if (atom.el === 'Acceptor') { color = COLOR.acceptor; r = 5; }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(atom.x, atom.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mark ionized dopants near junction with a + or − sign
    ctx.font = `bold 14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const dHalf = currentDepletionHalfWidth();
    for (const d of ionizedDonors) {
      if (Math.abs(d.x - layout.junctionX) <= dHalf + 4) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = COLOR.donor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#0b1024';
        ctx.fillText('+', d.x, d.y);
      }
    }
    for (const d of ionizedAcceptors) {
      if (Math.abs(d.x - layout.junctionX) <= dHalf + 4) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = COLOR.acceptor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#0b1024';
        ctx.fillText('−', d.x, d.y);
      }
    }
    ctx.restore();
  }

  function drawCarriers() {
    ctx.save();
    ctx.shadowColor = 'rgba(110, 168, 255, 0.4)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = COLOR.electron;
    for (const e of electrons) {
      ctx.beginPath();
      ctx.arc(e.x, e.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowColor = 'rgba(255, 107, 138, 0.4)';
    ctx.fillStyle = COLOR.hole;
    for (const h of holes) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function updateCarriers(dt) {
    const externalE = batteryOn ? voltage * 90 : 0;
    const thermalA = temperature * 50;
    const damping = 1.5;
    const dHalf = currentDepletionHalfWidth();
    const depE = depletionField();
    const recombLen = RECOMB_LEN * deviceWidth();
    const { left, right, top, bottom, junctionX } = layout;

    let crossingsR = 0; // conventional current toward +x
    let crossingsL = 0; // conventional current toward -x
    let totalCarriers = electrons.length + holes.length;

    const stepCarrier = (c, charge) => {
      // Thermal noise + damping
      c.vx += (gauss() * thermalA - damping * c.vx) * dt;
      c.vy += (gauss() * thermalA - damping * c.vy) * dt;

      // External drift: electrons toward + terminal, holes toward − terminal.
      const driftDir = charge < 0 ? polarity : -polarity;
      c.vx += driftDir * externalE * dt;

      // Built-in field inside depletion: pushes e- in -x, h+ in +x (i.e. away from junction)
      const dx = c.x - junctionX;
      if (Math.abs(dx) < dHalf) {
        // Built-in points from N (-x) to P (+x) inside depletion.
        // Force on electron: -E → -x. Force on hole: +E → +x.
        const bi = depE * (charge < 0 ? -1 : 1);
        c.vx += bi * dt;
      }

      const prevX = c.x;
      c.x += c.vx * dt;
      c.y += c.vy * dt;

      // Track junction crossings, as conventional current rather than as
      // bodies. An electron moving +x and a hole moving +x are opposite
      // currents; counting both as "one crossing to the right" made forward
      // bias — where the two species move apart — cancel to nothing.
      const q = charge < 0 ? -1 : 1; // the sign is what turns a body into a current
      if (prevX < junctionX && c.x >= junctionX) { if (q > 0) crossingsR++; else crossingsL++; }
      else if (prevX > junctionX && c.x <= junctionX) { if (q > 0) crossingsL++; else crossingsR++; }

      // Recombination and re-injection, which is what circuit continuity
      // actually looks like inside the silicon. A carrier driven across the
      // junction is in hostile country — an electron in P is surrounded by
      // holes — and it annihilates within a diffusion length. The charge is
      // not lost to the circuit: the battery pushes another one in at that
      // carrier's own contact. Wrapping it round to the far edge instead,
      // which is what this did, left the P side permanently stocked with
      // electrons. Reverse bias then had all the carriers it needed and
      // conducted as happily as forward.
      const away = charge < 0 ? 1 : -1; // from the junction into foreign ground
      if ((c.x - junctionX) * away > recombLen) {
        // Gone. A fresh one turns up somewhere in its own neutral region,
        // which is a sea of majority carriers the contact keeps topped up —
        // not a queue starting at the terminal. Re-injecting them all at the
        // contact edge instead kept the population marching in step, and the
        // ammeter read the resulting bursts as a current that switched
        // itself on and off.
        const homeL = charge < 0 ? left + 4 : junctionX + dHalf;
        const homeR = charge < 0 ? junctionX - dHalf : right - 4;
        c.x = homeR > homeL ? rand(homeL, homeR) : (charge < 0 ? left + 4 : right - 4);
        c.y = rand(top + 8, bottom - 8);
        c.vx = 0;
        c.vy = 0;
      } else if (c.x < left + 2 || c.x > right - 2) {
        // Its own contact, which is where reverse bias drives the majority
        // carriers: away from the junction and up against the terminal.
        // The contact absorbs them and hands them straight back to the
        // neutral region as an accumulation layer, so what builds is a band
        // a finite depth into the silicon. Pinning them to the boundary
        // instead drew a painted line of dots down the edge of the device.
        const inward = c.x < junctionX ? 1 : -1;
        const edge = c.x < junctionX ? left + 2 : right - 2;
        c.x = edge + inward * rand(0, ACCUM_LAYER * deviceWidth());
        c.vx = 0;
      }

      // Vertical reflect
      if (c.y < top + 2) { c.y = top + 2; c.vy = Math.abs(c.vy); }
      else if (c.y > bottom - 2) { c.y = bottom - 2; c.vy = -Math.abs(c.vy); }
    };

    for (const e of electrons) stepCarrier(e, -1);
    for (const h of holes) stepCarrier(h, +1);

    // Current is a rate — crossings per carrier per second — and not a
    // per-frame tally, so that the reading is the same whether the browser
    // is painting at 60 frames a second or at 30. What gets averaged is the
    // signed rate rather than its size, so that traffic going both ways
    // would cancel instead of adding up into a current that is not there.
    // As it happens this junction never has any: counting the crossings
    // finds none at all below the knee or in reverse, and all one way above
    // it. The averaging is right either way, but on this page the choice
    // makes no visible difference and no check can tell it was made.
    const net = crossingsR - crossingsL;
    const rate = net / Math.max(1, totalCarriers) / Math.max(dt, 1e-4);
    smoothedCurrent += (rate - smoothedCurrent) * Math.min(1, dt / CURRENT_TAU);
  }

  function biasLabel() {
    if (!batteryOn) return i18nText('biasOff', 'Off');
    if (voltage === 0) return i18nText('biasZero', 'Zero');
    if (polarity === 1) return i18nText('biasForward', 'Forward');
    return i18nText('biasReverse', 'Reverse');
  }

  function currentLabel() {
    if (!batteryOn) return '—';
    // One branch. Which way the battery points is not consulted here: the
    // reverse reading is small because the carriers do not cross, and if
    // this typed in the asymmetry the page would be claiming the very thing
    // it is meant to be showing.
    return `${Math.round(currentFraction() * 100)}%`;
  }

  function updateReadouts() {
    propBias.textContent = biasLabel();
    propCurrent.textContent = currentLabel();
  }

  function render() {
    ctx.clearRect(0, 0, CW, CH);
    drawDevice();
    drawAtoms();
    drawCarriers();
    drawBattery();
  }

  // Conduction buzz — loud when the junction actually passes current
  // (forward bias), near-silent under reverse bias. You hear the diode work.
  const buzz = window.SFX ? new window.SFX.Drone({ type: "square", freq: 110, gain: 0 }) : null;

  function step(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    updateCarriers(dt);
    updateReadouts();
    render();
    if (buzz) buzz.setGain(batteryOn ? currentFraction() * 0.045 : 0);
    animId = requestAnimationFrame(step);
  }

  function start() {
    if (animId !== null) return;
    lastTs = 0;
    animId = requestAnimationFrame(step);
  }

  function wireEvents() {
    batteryToggle.addEventListener('change', () => {
      batteryOn = batteryToggle.checked;
      window.SFX?.tone({ freq: batteryOn ? 520 : 300, dur: 0.07, type: 'triangle', gain: 0.12 });
    });
    voltageInput.addEventListener('input', () => {
      voltage = parseFloat(voltageInput.value);
      voltageValue.textContent = voltage.toFixed(2);
    });
    tempInput.addEventListener('input', () => {
      temperature = parseFloat(tempInput.value);
      tempValue.textContent = temperature.toFixed(2);
    });
    reverseBtn.addEventListener('click', () => {
      polarity = -polarity;
      window.SFX?.noise({ dur: 0.07, gain: 0.16, color: 'pink', filter: 'lowpass', freq: 340, q: 0.9 });
    });
  }

  document.addEventListener('langchange', updateReadouts);

  function resizeCanvas() {
    // Un-pin the inline size from the previous pass before measuring —
    // otherwise the canvas can never grow back when the window widens
    // (it would keep re-measuring its own pinned width forever).
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const newCW = Math.max(Math.round(rect.width), 320);
    const newCH = 720;
    if (newCW === CW && newCH === CH && atoms.length) return;
    CW = newCW;
    CH = newCH;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.style.setProperty('width', CW + 'px', 'important');
    canvas.style.setProperty('height', CH + 'px', 'important');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    layout = computeLayout();
    buildLattice();
    initCarriers();
    render();
  }

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      this.beginPath();
      this.moveTo(x + rr, y);
      this.arcTo(x + w, y, x + w, y + h, rr);
      this.arcTo(x + w, y + h, x, y + h, rr);
      this.arcTo(x, y + h, x, y, rr);
      this.arcTo(x, y, x + w, y, rr);
      this.closePath();
      return this;
    };
  }

  voltageValue.textContent = voltage.toFixed(2);
  tempValue.textContent = temperature.toFixed(2);
  wireEvents();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animId !== null) cancelAnimationFrame(animId);
      animId = null;
    } else { start(); }
  });
  resizeCanvas();
  updateReadouts();
  start();

  /*
   * The handle tests/experiments/diode.test.mjs drives the junction by. It
   * sets the same variables the controls set and steps the same physics the
   * animation steps — nothing here computes an answer of its own.
   */
  window.__diode = {
    setBattery(on) { batteryOn = on; batteryToggle.checked = on; updateReadouts(); },
    setPolarity(p) { polarity = p; updateReadouts(); },
    setVoltage(v) { voltageInput.value = String(v); voltage = parseFloat(voltageInput.value);
      voltageValue.textContent = voltage.toFixed(2); updateReadouts(); },
    setTemperature(t) { tempInput.value = String(t); temperature = parseFloat(tempInput.value);
      tempValue.textContent = temperature.toFixed(2); },
    /** Advance the carriers by `seconds` of the page's own time. This has to
     *  do what step() does, not just the physics half of it: the current
     *  readout is a piece of DOM text, and updateCarriers only moves the
     *  number behind it. Stepping without repainting the readout left the
     *  panel showing whatever it said before the run. */
    advance(seconds, steps = 120) {
      for (let i = 0; i < steps; i++) { updateCarriers(seconds / steps); updateReadouts(); }
    },
    state: () => ({
      polarity, voltage, batteryOn,
      depletionHalfWidth: currentDepletionHalfWidth(),
      junctionX: layout.junctionX,
      deviceWidth: deviceWidth(),
      electrons: electrons.map((c) => ({ x: c.x, y: c.y, vx: c.vx })),
      holes: holes.map((c) => ({ x: c.x, y: c.y, vx: c.vx })),
      currentRate: smoothedCurrent, // signed crossings per carrier per second
      bias: propBias.textContent.trim(),
      current: propCurrent.textContent.trim(),
    }),
  };

})();
