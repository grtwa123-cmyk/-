/*
 * Shared procedural sound effects — Web Audio API, no audio files, no deps.
 *
 * Every experiment page includes this script. It:
 *   • lazily creates one AudioContext and unlocks it on the first user
 *     gesture (browsers block audio until then),
 *   • injects a floating 🔊 / 🔇 mute toggle whose state persists in
 *     localStorage, so a muted visitor stays muted across pages,
 *   • exposes a tiny synth API on window.SFX that the simulations call at
 *     their own event points (a launch, a collision, a decay, …).
 *
 * All sound is synthesised from oscillators and noise buffers, so it works
 * offline and adds nothing to download. Continuous sounds (a generator hum,
 * gas pressure) use SFX.Drone; one-shots use tone / sweep / noise / click.
 *
 * Nothing here throws if Web Audio is missing — every entry point degrades
 * to a no-op, so callers never need to guard beyond `window.SFX?.`.
 */
(() => {
  const KEY = "sfx-muted";
  let muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch (_) {}

  const MASTER = 0.85;
  let ctx = null;
  let master = null;
  let updateButton = () => {};

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (_) {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    master.connect(ctx.destination);
    return ctx;
  }

  // Unlock / resume on any gesture (also recovers after a tab switch).
  const unlock = () => { const c = ensure(); if (c && c.state === "suspended") c.resume(); };
  ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
    window.addEventListener(ev, unlock, { passive: true }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) unlock(); });

  const now = () => ctx.currentTime;
  const clampF = (f) => Math.max(1, Math.min(f, 20000));

  // ── One-shot: an enveloped oscillator tone ────────────────────────────
  function tone(opts = {}) {
    if (muted || !ensure()) return;
    const { freq = 440, dur = 0.15, type = "sine", gain = 0.2,
            attack = 0.005, release = 0.09, detune = 0, glideTo = 0 } = opts;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(clampF(freq), t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(clampF(glideTo), t + dur);
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + release + 0.03);
  }

  // ── One-shot: a pitch sweep (launches, whooshes, zaps) ────────────────
  function sweep(opts = {}) {
    if (muted || !ensure()) return;
    const { from = 600, to = 180, dur = 0.25, type = "sawtooth", gain = 0.18 } = opts;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(clampF(from), t);
    o.frequency.exponentialRampToValueAtTime(clampF(to), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  // ── One-shot: a filtered noise burst (impacts, bubbles, hiss) ─────────
  function noise(opts = {}) {
    if (muted || !ensure()) return;
    const { dur = 0.2, gain = 0.2, color = "white",
            filter = "bandpass", freq = 1000, q = 1 } = opts;
    const t = now();
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "pink") { last = 0.97 * last + 0.03 * w; d[i] = last * 3.2; }
      else d[i] = w;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = src;
    if (filter && filter !== "none") {
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = clampF(freq);
      f.Q.value = q;
      src.connect(f);
      node = f;
    }
    node.connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  // ── One-shot: a short Geiger-style click ──────────────────────────────
  function click(opts = {}) {
    const { freq = 2200, gain = 0.3, q = 9 } = opts;
    noise({ dur: 0.028, gain, color: "white", filter: "bandpass", freq, q });
  }

  // ── Continuous drone with settable pitch/level (hum, pressure) ────────
  class Drone {
    constructor(opts = {}) {
      const { type = "sine", freq = 120, gain = 0, partials = 0 } = opts;
      this.ok = !!ensure();
      if (!this.ok) return;
      const t = now();
      this.o = ctx.createOscillator();
      this.g = ctx.createGain();
      this.o.type = type;
      this.o.frequency.setValueAtTime(clampF(freq), t);
      this.g.gain.setValueAtTime(gain, t);
      this.o.connect(this.g).connect(master);
      this.o.start(t);
      // Optional detuned octave for a richer machine hum.
      if (partials) {
        this.o2 = ctx.createOscillator();
        this.o2.type = type;
        this.o2.frequency.setValueAtTime(clampF(freq * 2), t);
        this.o2.detune.value = 6;
        this.g2 = ctx.createGain();
        this.g2.gain.setValueAtTime(gain * 0.4, t);
        this.o2.connect(this.g2).connect(master);
        this.o2.start(t);
      }
    }
    setFreq(f) {
      if (!this.ok) return;
      this.o.frequency.setTargetAtTime(clampF(f), now(), 0.05);
      if (this.o2) this.o2.frequency.setTargetAtTime(clampF(f * 2), now(), 0.05);
    }
    setGain(v) {
      if (!this.ok) return;
      const g = Math.max(0, v);
      this.g.gain.setTargetAtTime(g, now(), 0.06);
      if (this.g2) this.g2.gain.setTargetAtTime(g * 0.4, now(), 0.06);
    }
    stop() {
      if (!this.ok) return;
      try { this.o.stop(); if (this.o2) this.o2.stop(); } catch (_) {}
      this.ok = false;
    }
  }

  // ── Mute state ────────────────────────────────────────────────────────
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem(KEY, m ? "1" : "0"); } catch (_) {}
    if (master) master.gain.setTargetAtTime(m ? 0 : MASTER, ctx.currentTime, 0.02);
    updateButton();
  }

  // ── Floating mute toggle ──────────────────────────────────────────────
  function injectButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sfx-toggle";
    b.title = "Sound on / off";
    b.setAttribute("aria-label", "Toggle sound");
    b.addEventListener("click", (e) => {
      e.preventDefault();
      ensure();
      setMuted(!muted);
    });
    updateButton = () => {
      b.textContent = muted ? "🔇" : "🔊";
      b.setAttribute("aria-pressed", String(!muted));
      b.classList.toggle("is-muted", muted);
    };
    updateButton();
    const attach = () => { if (document.body) document.body.appendChild(b); };
    if (document.body) attach();
    else document.addEventListener("DOMContentLoaded", attach);
  }
  injectButton();

  window.SFX = {
    tone, sweep, noise, click, Drone,
    setMuted, toggle: () => setMuted(!muted),
    isMuted: () => muted,
  };
})();
