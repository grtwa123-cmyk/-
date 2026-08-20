(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const batteryToggle = document.getElementById('battery-toggle');
  const voltageInput = document.getElementById('voltage');
  const voltageValue = document.getElementById('voltage-value');
  const tempInput = document.getElementById('temperature');
  const tempValue = document.getElementById('temperature-value');
  const reverseBtn = document.getElementById('reverse-btn');
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
    bondLine: 'rgba(255, 255, 255, 0.07)',
    border: 'rgba(110, 168, 255, 0.45)',
    wire: '#8d97b6',
    plus: '#ff6b8a',
    minus: '#6ea8ff',
    fieldArrow: 'rgba(255, 184, 107, 0.55)',
    rowLabel: '#ecf0fb',
  };

  const ATOMS_X = 16;
  const ATOMS_Y = 4;

  const TYPES = [
    { key: 'intrinsic', labelKey: 'typeIntrinsic', electrons: 6, holes: 6, donors: 0, acceptors: 0 },
    { key: 'ntype',     labelKey: 'typeNType',     electrons: 22, holes: 3, donors: 4, acceptors: 0 },
    { key: 'ptype',     labelKey: 'typePType',     electrons: 3, holes: 22, donors: 0, acceptors: 4 },
  ];

  let batteryOn = true;
  let polarity = 1; // +1 = + terminal on right, -1 = + terminal on left
  let voltage = parseFloat(voltageInput.value);
  let temperature = parseFloat(tempInput.value);

  let rows = [];
  let layout = null;
  let animId = null;
  let lastTs = 0;
  let CW = 800;
  let CH = 840;

  function computeLayout() {
    const margin = 18;
    const batteryH = 130;
    const rowsArea = CH - batteryH - margin * 2;
    const rowH = Math.floor(rowsArea / TYPES.length);
    const left = 180;
    const right = CW - 40;
    return {
      margin,
      batteryTop: margin,
      batteryH,
      rowH,
      left,
      right,
      rowsTop: batteryH + margin * 2,
    };
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function rowBounds(idx) {
    const top = layout.rowsTop + idx * layout.rowH + 18;
    const bottom = layout.rowsTop + (idx + 1) * layout.rowH - 12;
    const left = layout.left + 8;
    const right = layout.right - 8;
    return { top, bottom, left, right };
  }

  function initAtomsFor(type, b) {
    const atoms = [];
    const stepX = (b.right - b.left) / (ATOMS_X - 1);
    const stepY = (b.bottom - b.top) / (ATOMS_Y - 1);
    for (let j = 0; j < ATOMS_Y; j++) {
      for (let i = 0; i < ATOMS_X; i++) {
        atoms.push({
          x: b.left + i * stepX,
          y: b.top + j * stepY,
          el: 'Si',
        });
      }
    }
    const totalDopants = type.donors + type.acceptors;
    const positions = new Set();
    while (positions.size < totalDopants && positions.size < atoms.length) {
      positions.add(Math.floor(Math.random() * atoms.length));
    }
    const idxList = Array.from(positions);
    for (let i = 0; i < type.donors; i++) atoms[idxList[i]].el = 'Donor';
    for (let i = 0; i < type.acceptors; i++) atoms[idxList[type.donors + i]].el = 'Acceptor';
    return atoms;
  }

  function spawnCarriers(n, b) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push({
        x: rand(b.left, b.right),
        y: rand(b.top, b.bottom),
        vx: 0,
        vy: 0,
      });
    }
    return arr;
  }

  function buildRows() {
    layout = computeLayout();
    rows = TYPES.map((type, idx) => {
      const b = rowBounds(idx);
      return {
        type,
        bounds: b,
        atoms: initAtomsFor(type, b),
        electrons: spawnCarriers(type.electrons, b),
        holes: spawnCarriers(type.holes, b),
      };
    });
  }

  function drawBattery() {
    const cx = CW / 2;
    const top = layout.batteryTop;
    const bH = 80;
    const bW = 240;
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
    ctx.moveTo(bx + 78, by + 22);
    ctx.lineTo(bx + 78, by + bH - 22);
    ctx.moveTo(bx + bW - 78, by + 22);
    ctx.lineTo(bx + bW - 78, by + bH - 22);
    ctx.stroke();

    ctx.font = `600 16px ${FONT}`;
    ctx.fillStyle = 'rgba(232, 236, 247, 0.75)';
    ctx.fillText(i18nText('battery', 'Battery'), cx, by + bH / 2);

    // Wires from battery terminals down and around to the semiconductor block left/right edges
    const wireY = by + bH;
    const semiLeft = layout.left;
    const semiRight = layout.right;
    const wireBottom = layout.rowsTop;

    ctx.strokeStyle = COLOR.wire;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Left wire from battery to semi-left
    ctx.moveTo(bx + 36, wireY);
    ctx.lineTo(bx + 36, wireBottom - 30);
    ctx.lineTo(semiLeft, wireBottom - 30);
    ctx.lineTo(semiLeft, layout.rowsTop + layout.rowH * TYPES.length);
    // Right wire from battery to semi-right
    ctx.moveTo(bx + bW - 36, wireY);
    ctx.lineTo(bx + bW - 36, wireBottom - 30);
    ctx.lineTo(semiRight, wireBottom - 30);
    ctx.lineTo(semiRight, layout.rowsTop + layout.rowH * TYPES.length);
    ctx.stroke();

    // Current flows out of + terminal, through both wires, into - terminal.
    // For polarity = +1: + on right, both wire arrows point right (current x increases).
    // For polarity = -1: + on left, both wire arrows point left.
    if (batteryOn) {
      const arrowY = wireBottom - 30;
      const rightward = polarity === 1;
      drawCurrentArrow(arrowY, bx + bW - 36, semiRight, rightward);
      drawCurrentArrow(arrowY, semiLeft, bx + 36, rightward);
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

  function drawRowBackground(row, idx) {
    const b = row.bounds;
    const top = layout.rowsTop + idx * layout.rowH + 10;
    const bottom = layout.rowsTop + (idx + 1) * layout.rowH - 5;

    ctx.save();
    ctx.fillStyle = 'rgba(22, 27, 48, 0.85)';
    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(layout.left, top, layout.right - layout.left, bottom - top, 10);
    ctx.fill();
    ctx.stroke();

    // Row label (further left so it doesn't crowd the polarity marker)
    ctx.fillStyle = COLOR.rowLabel;
    ctx.font = `700 20px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const label = i18nText(row.type.labelKey, row.type.key);
    const midY = (top + bottom) / 2;
    ctx.fillText(label, layout.left - 36, midY);

    // Terminal markers on row sides (mirrors battery polarity)
    const leftLabel = polarity === 1 ? '−' : '+';
    const rightLabel = polarity === 1 ? '+' : '−';
    const leftColor = polarity === 1 ? COLOR.minus : COLOR.plus;
    const rightColor = polarity === 1 ? COLOR.plus : COLOR.minus;

    ctx.font = `bold 26px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = batteryOn ? leftColor : 'rgba(141, 151, 182, 0.4)';
    ctx.fillText(leftLabel, layout.left - 16, midY);
    ctx.fillStyle = batteryOn ? rightColor : 'rgba(141, 151, 182, 0.4)';
    ctx.fillText(rightLabel, layout.right + 18, midY);

    ctx.restore();
  }

  function drawAtoms(row) {
    ctx.save();
    // Subtle bond lines between adjacent atoms
    ctx.strokeStyle = COLOR.bondLine;
    ctx.lineWidth = 1;
    for (let j = 0; j < ATOMS_Y; j++) {
      for (let i = 0; i < ATOMS_X - 1; i++) {
        const a = row.atoms[j * ATOMS_X + i];
        const b = row.atoms[j * ATOMS_X + i + 1];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    for (let i = 0; i < ATOMS_X; i++) {
      for (let j = 0; j < ATOMS_Y - 1; j++) {
        const a = row.atoms[j * ATOMS_X + i];
        const b = row.atoms[(j + 1) * ATOMS_X + i];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    for (const atom of row.atoms) {
      let r = 4;
      let color = COLOR.si;
      if (atom.el === 'Donor') { color = COLOR.donor; r = 5.5; }
      else if (atom.el === 'Acceptor') { color = COLOR.acceptor; r = 5.5; }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(atom.x, atom.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCarrier(c, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRow(row, idx) {
    drawRowBackground(row, idx);
    drawAtoms(row);
    ctx.save();
    ctx.shadowColor = 'rgba(110, 168, 255, 0.45)';
    ctx.shadowBlur = 6;
    for (const e of row.electrons) drawCarrier(e, COLOR.electron);
    ctx.shadowColor = 'rgba(255, 107, 138, 0.45)';
    for (const h of row.holes) drawCarrier(h, COLOR.hole);
    ctx.restore();
  }

  function updateCarriers(dt) {
    // Drift acceleration: electrons drift opposite to E, holes drift with E.
    // polarity = +1 → + on right → E points right→left (i.e., -x). Electrons drift +x; holes drift -x.
    // polarity = -1 → + on left → E points +x. Electrons drift -x; holes drift +x.
    const fieldStrength = batteryOn ? voltage * 60 : 0;
    const thermalA = temperature * 40;

    for (const row of rows) {
      const b = row.bounds;
      const w = b.right - b.left;
      const h = b.bottom - b.top;

      for (const e of row.electrons) {
        e.vx += (gauss() * thermalA - 1.2 * e.vx) * dt;
        e.vy += (gauss() * thermalA - 1.2 * e.vy) * dt;
        e.vx += polarity * fieldStrength * dt; // electrons drift +x when polarity=+1
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.x < b.left) e.x += w;
        if (e.x > b.right) e.x -= w;
        if (e.y < b.top) { e.y = b.top; e.vy = Math.abs(e.vy); }
        if (e.y > b.bottom) { e.y = b.bottom; e.vy = -Math.abs(e.vy); }
      }

      for (const hole of row.holes) {
        hole.vx += (gauss() * thermalA - 1.2 * hole.vx) * dt;
        hole.vy += (gauss() * thermalA - 1.2 * hole.vy) * dt;
        hole.vx += -polarity * fieldStrength * dt; // holes drift opposite to electrons
        hole.x += hole.vx * dt;
        hole.y += hole.vy * dt;
        if (hole.x < b.left) hole.x += w;
        if (hole.x > b.right) hole.x -= w;
        if (hole.y < b.top) { hole.y = b.top; hole.vy = Math.abs(hole.vy); }
        if (hole.y > b.bottom) { hole.y = b.bottom; hole.vy = -Math.abs(hole.vy); }
      }
    }
  }

  function updateReadouts() {
    if (!batteryOn) {
      propCurrent.textContent = i18nText('currentNone', 'off');
      return;
    }
    // Conventional current inside semiconductor flows from + terminal toward - terminal.
    // polarity = +1 → + is on right → current flows right→left.
    const key = polarity === 1 ? 'currentRightToLeft' : 'currentLeftToRight';
    propCurrent.textContent = i18nText(key, polarity === 1 ? '→ left' : '→ right');
  }

  function render() {
    ctx.clearRect(0, 0, CW, CH);
    drawBattery();
    rows.forEach(drawRow);
  }

  // A faint electrical buzz whose loudness rises with the driving voltage,
  // and falls silent when the battery is switched off.
  const buzz = window.SFX ? new window.SFX.Drone({ type: "square", freq: 120, gain: 0 }) : null;
  function updateBuzz() {
    if (!buzz) return;
    buzz.setGain(batteryOn ? Math.min(0.035, voltage * 0.02) : 0);
  }

  function step(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    updateCarriers(dt);
    render();
    updateBuzz();
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
      updateReadouts();
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
      updateReadouts();
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
    const newCH = 840;
    if (newCW === CW && newCH === CH && rows.length) return;
    CW = newCW;
    CH = newCH;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.style.setProperty('width', CW + 'px', 'important');
    canvas.style.setProperty('height', CH + 'px', 'important');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    buildRows();
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
  updateReadouts();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animId !== null) cancelAnimationFrame(animId);
      animId = null;
    } else { start(); }
  });
  resizeCanvas();
  start();

  /*
   * The carriers, exposed for checking.
   *
   * This page is badged "Illustration": an animation of the idea, with no
   * quantitative model behind it. So there is no closed form to hold it to,
   * and a suite that invented one would be claiming more than the page does.
   * What can be held is that the idea being illustrated is the right idea —
   * that n-type is electron-rich and p-type hole-rich, that electrons and
   * holes drift opposite ways, and that reversing the battery reverses both.
   * Getting any of those backwards is a real defect, and "no quantitative
   * model" is not a defence against it.
   */
  window.__semi = {
    types: TYPES.map((t) => ({ ...t })),
    setBattery(on) { batteryOn = on; batteryToggle.checked = on; updateReadouts(); },
    setPolarity(p) { polarity = p; updateReadouts(); },
    setVoltage(v) { voltage = v; voltageInput.value = String(v); updateReadouts(); },
    setTemperature(t) { temperature = t; tempInput.value = String(t); },
    /** Advance the carriers by `seconds` of the page's own time. */
    advance(seconds, steps = 60) {
      for (let i = 0; i < steps; i++) updateCarriers(seconds / steps);
    },
    state: () => rows.map((row) => ({
      key: row.type.key,
      electrons: row.electrons.map((c) => ({ x: c.x, y: c.y, vx: c.vx, vy: c.vy })),
      holes: row.holes.map((c) => ({ x: c.x, y: c.y, vx: c.vx, vy: c.vy })),
      bounds: { ...row.bounds },
    })),
    current: () => propCurrent.textContent.trim(),
  };

})();
