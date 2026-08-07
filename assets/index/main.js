/**
 * Curved-index entry point.
 *
 * Builds a cylindrical wall of cards from the experiment catalogue, drives
 * horizontal-infinite + vertical-clamped scroll, and animates a cinematic
 * navigation away from the wall when the user taps a card. A drag past
 * TAP_MOVE_THRESHOLD downgrades the gesture to scroll, so the wall never
 * fires navigation mid-flick.
 *
 * Cards are desaturated and translucent at rest; hover (on fine-pointer
 * devices) re-saturates and re-opacifies the picked card via a shader
 * uniform tweened by gsap. Touch devices stay fully colored.
 *
 * Public globals expected on window:
 *   - THREE  (loaded as ES module, see HTML)
 *   - gsap   (loaded as classic script, see HTML)
 *   - i18n   (loaded as classic script, see HTML)
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { EXPERIMENTS } from "./experiments.js";
import { makeCard, titleFontReady } from "./card-texture.js";

const gsap = window.gsap;
const i18n = window.i18n;

// ── Tuning ─────────────────────────────────────────────────────────────────
const Rc = 9.5;              // Cylinder radius (how much the wall curves)
const ROWS = 2;              // Two rows, recycled horizontally.
                             // Columns are derived from the catalogue rather
                             // than hard-coded: a hard-coded count silently
                             // drops every card past COLS × ROWS, so adding an
                             // experiment used to mean remembering to widen the
                             // wall by hand. Deriving it makes that impossible.
const COLS = Math.ceil(EXPERIMENTS.length / ROWS);
const SPARE = COLS * ROWS - EXPERIMENTS.length;   // 0 or 1 for an odd catalogue
const CARD_W = 3.0;          // Card width in world units
const CARD_H = 3.62;         // Card height in world units (matches canvas ratio)
const D_ANG = 0.40;          // Angular gap between columns (radians)
const ROW_Y = [2.0, -2.0];   // Vertical positions of the two rows
const CAM_DIST = 7.2;        // Camera distance from the centre column

const DRAG_X = 0.0042;       // Horizontal drag → scroll sensitivity
const DRAG_Y = 0.0055;       // Vertical drag → row shift sensitivity
const EASE = 0.11;
const FRICTION = 0.93;
const DRIFT = 0.0016;        // Slow horizontal drift while idle
const Y_LIMIT = 2.4;         // Vertical scroll clamp

// Tap = short, mostly-stationary pointer press. Anything more becomes scroll.
const TAP_MOVE_THRESHOLD = 10;   // px of accumulated motion before the tap is downgraded
const TAP_TIME_THRESHOLD = 600;  // ms — longer than this it stops being a tap

// Rest vs. hover look. Each card material runs an onBeforeCompile patch that
// blends between grayscale (uSat=0) and the colored texture (uSat=1); the
// opacity multiplier below is applied on top of the depth-cue opacity each
// frame. Touch devices skip the rest state entirely (no pointer → no hover).
const REST_SATURATION = 0.0;
const REST_OPACITY    = 0.45;
const HOVER_TWEEN_MS  = 320;
const hasFineHover = matchMedia("(hover: hover) and (pointer: fine)").matches;

// ── Helpers ────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mod   = (a, n)    => ((a % n) + n) % n;
const mapClamp = (v, a, b, ra, rb) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return ra + (rb - ra) * t;
};
// t() returns undefined until the dictionary has loaded, so the key is the
// fallback here rather than the return value.
const tr = (key) => (i18n && i18n.t(key)) || key;

// ── Renderer / scene / camera ─────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById("scene").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0a0d, 0.026);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 100);
let zoom = 1;

/**
 * Responsive camera.
 *
 * Three.js fov is vertical, so a portrait viewport has a much narrower
 * horizontal angle. To keep the curve readable across aspect ratios we
 * pull the camera back on tall screens (more columns fall inside the
 * narrow angle) and only nudge fov.
 *
 * Pinch zoom is layered as a persistent multiplier so resize / rotation
 * never discards the user's zoom level.
 */
function applyCamera() {
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  const baseFov = mapClamp(aspect, 0.5, 1.8, 64, 56);
  const dist    = mapClamp(aspect, 0.5, 1.8, 12.5, CAM_DIST);
  camera.fov = clamp(baseFov / zoom, 38, 94);
  camera.position.set(0, 0, -Rc + dist);
  camera.lookAt(0, 0, -Rc);
  camera.updateProjectionMatrix();
}
applyCamera();

const group = new THREE.Group();
scene.add(group);

// ── Cards ─────────────────────────────────────────────────────────────────
// Each card material gets a small shader patch that desaturates the texture
// by a uniform `uSat` (0 = grayscale, 1 = original colour). The hover state
// is stored on material.userData.hover and tweened by gsap; tick() copies
// it onto the uniform and also scales the depth-cue opacity so the rest
// state ends up both desaturated AND translucent in a single read.
const geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
const cards = [];
const MAXANISO = renderer.capabilities.getMaxAnisotropy();

function patchDesaturate(mat) {
  // Touch devices never hover, so they get a permanently-coloured baseline.
  mat.userData.hover = hasFineHover ? 0 : 1;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSat = { value: mat.userData.hover };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uSat;"
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         float _lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
         diffuseColor.rgb = mix(vec3(_lum), diffuseColor.rgb, uSat);`
      );
    mat.userData.shader = shader;
  };
}

for (let cIdx = 0; cIdx < COLS; cIdx++) {
  for (let r = 0; r < ROWS; r++) {
    const index = cIdx * ROWS + r;
    if (index >= EXPERIMENTS.length) continue;
    const exp = EXPERIMENTS[index];
    const tex = new THREE.CanvasTexture(makeCard(exp, index, EXPERIMENTS.length, tr));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = MAXANISO;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.DoubleSide, transparent: true, opacity: 1, fog: true,
    });
    patchDesaturate(mat);
    const mesh = new THREE.Mesh(geo, mat);
    // An odd catalogue leaves one slot over. Rather than a hole in the wall,
    // the card left alone in its column sits centred between the two rows.
    const solo = SPARE > 0 && cIdx === COLS - 1;
    mesh.userData = { exp, index, col: cIdx, row: r, y: solo ? 0 : ROW_Y[r] };
    group.add(mesh);
    cards.push(mesh);
  }
}

function repaint() {
  for (const m of cards) {
    m.material.map.image = makeCard(m.userData.exp, m.userData.index, EXPERIMENTS.length, tr);
    m.material.map.needsUpdate = true;
  }
}
document.addEventListener("langchange", repaint);

// The cards are bitmaps. If Pretendard is still in flight when they are first
// drawn they bake in a fallback face and would keep it forever, so repaint
// once it lands. Resolves immediately when the font is already cached.
titleFontReady().then(repaint);

// ── Scroll state ──────────────────────────────────────────────────────────
const st = { s: 0, ts: 0, vs: 0, y: 0, ty: 0, vy: 0 };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let interacted = false;

/**
 * Place each card on the cylinder, wrapping its column index so the row
 * scrolls infinitely. We keep relative col in [-COLS/2, COLS/2) so the
 * recycled cards always sit on the opposite side of the visible arc.
 */
function layout() {
  for (const m of cards) {
    const rel = mod(m.userData.col - st.s + COLS / 2, COLS) - COLS / 2;
    const th = rel * D_ANG;
    const yy = m.userData.y + st.y;
    m.position.set(Math.sin(th) * Rc, yy, -Math.cos(th) * Rc);
    m.lookAt(0, yy, 0);
    m.userData.theta = th;
    m.userData.rel = rel;
  }
}

// ── Picking ───────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickAt(px, py) {
  ndc.set((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(cards)[0]?.object || null;
}

// ── DOM refs ──────────────────────────────────────────────────────────────
const el = renderer.domElement;
const cursor = document.getElementById("cursor");
const cursorPos = { x: innerWidth / 2, y: innerHeight / 2 };
const focusEl = document.getElementById("focus");
const navFade = document.getElementById("navFade");
const hint = document.getElementById("hint");
const loader = document.getElementById("loader");
let hovered = null;

// ── Tap to navigate ───────────────────────────────────────────────────────
// A single-pointer press that stays within TAP_MOVE_THRESHOLD of its origin
// and releases inside TAP_TIME_THRESHOLD navigates to the picked card. A
// second pointer (pinch zoom) or any drag past the threshold downgrades
// the gesture and the release does nothing — so flicking the wall never
// fires a navigation by accident.
let tap = null;  // { mesh, t, moved } | null

function cancelTap() { tap = null; }

// ── Pointers ──────────────────────────────────────────────────────────────
const pointers = new Map();
let dragging = false, pinch = 0, locked = false;

el.addEventListener("pointerdown", (e) => {
  if (locked) return;
  interacted = true;
  el.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragging = true;
    tap = { mesh: pickAt(e.clientX, e.clientY), t: performance.now(), moved: 0 };
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
    cancelTap();
  }
});

el.addEventListener("pointermove", (e) => {
  const pt = pointers.get(e.pointerId);
  if (pt) {
    const dx = e.clientX - pt.x, dy = e.clientY - pt.y;
    pt.x = e.clientX; pt.y = e.clientY;
    if (pointers.size === 1 && dragging) {
      if (tap) {
        tap.moved += Math.abs(dx) + Math.abs(dy);
        if (tap.moved > TAP_MOVE_THRESHOLD) cancelTap();
      }
      st.ts -= dx * DRAG_X; st.vs = -dx * DRAG_X;
      st.ty = clamp(st.ty + dy * DRAG_Y, -Y_LIMIT, Y_LIMIT);
      st.vy = dy * DRAG_Y;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) { zoom = clamp(zoom * dd / pinch, 0.7, 1.9); applyCamera(); }
      pinch = dd;
    }
  }
  cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
  cursorPos.x = e.clientX; cursorPos.y = e.clientY;
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = 0;
  if (pointers.size === 0) {
    dragging = false;
    if (tap && tap.mesh && !locked &&
        performance.now() - tap.t < TAP_TIME_THRESHOLD) {
      navigateTo(tap.mesh);
    }
    cancelTap();
  }
}
el.addEventListener("pointerup", endPointer);
el.addEventListener("pointercancel", endPointer);

// OS-level interruptions must also drop any pending tap so navigation does
// not fire after we return to focus.
addEventListener("visibilitychange", () => { if (document.hidden) cancelTap(); });
addEventListener("blur", cancelTap);

el.addEventListener("wheel", (e) => {
  e.preventDefault();
  interacted = true;
  cancelTap();
  st.ts += e.deltaX * DRAG_X * 0.6;
  st.ty = clamp(st.ty - e.deltaY * DRAG_Y * 0.25, -Y_LIMIT, Y_LIMIT);
}, { passive: false });

// ── Navigation (out) ──────────────────────────────────────────────────────
function navigateTo(mesh) {
  if (locked) return;
  locked = true;
  const url = mesh.userData.exp.url;
  hint.style.opacity = 0;
  // Hover tweens were re-saturating cards while they faded out. Kill
  // every card's hover tween and snap the picked card to fully
  // saturated so it doesn't desaturate mid-zoom.
  cards.forEach((c) => gsap.killTweensOf(c.material.userData));
  mesh.material.userData.hover = 1;
  hovered = null;
  if (reduced) {
    gsap.to(navFade, { opacity: 1, duration: 0.25, onComplete: () => { location.href = url; } });
    return;
  }
  gsap.to([".topbar", ".lang-switch"], { opacity: 0, duration: 0.3 });
  cards.forEach((c) => { if (c !== mesh) gsap.to(c.material, { opacity: 0, duration: 0.4 }); });
  gsap.to(camera.position, {
    x: mesh.position.x * 0.5, y: mesh.position.y * 0.5,
    z: (camera.position.z + mesh.position.z) / 2,
    duration: 0.7, ease: "expo.in",
  });
  gsap.to(camera, { fov: 34, duration: 0.7, ease: "expo.in", onUpdate: () => camera.updateProjectionMatrix() });
  gsap.to(cursor, { opacity: 0, duration: 0.3 });
  gsap.to(navFade, { opacity: 1, duration: 0.65, ease: "expo.in", onComplete: () => { location.href = url; } });
}

// ── Main loop ─────────────────────────────────────────────────────────────
let introDone = false, frame = 0;

function tick() {
  requestAnimationFrame(tick);

  if (!locked) {
    if (!dragging) {
      st.ts += st.vs; st.vs *= FRICTION;
      st.ty = clamp(st.ty + st.vy, -Y_LIMIT, Y_LIMIT); st.vy *= FRICTION;
      if (!interacted && !reduced) st.ts += DRIFT;
      // Snap to nearest column boundary once velocity has died.
      if (interacted && Math.abs(st.vs) < 0.0009) {
        const target = Math.round(st.ts);
        st.ts += (target - st.ts) * 0.06;
      }
    }
    st.s += (st.ts - st.s) * EASE;
    st.y += (st.ty - st.y) * EASE;
    layout();
  }

  // Depth cue: alignment with view centre → opacity + scale. The card-level
  // hover state (0..1) then multiplies opacity toward 1 and the saturation
  // uniform toward 1, so hovering re-saturates and re-opacifies in one shot.
  let visible = 0;
  for (const m of cards) {
    const align = Math.cos(m.userData.theta || 0);
    const baseAlpha = clamp((align - 0.35) / 0.5, 0.06, 1);
    const mat = m.material;
    const h = mat.userData.hover;
    mat.opacity = baseAlpha * (REST_OPACITY + (1 - REST_OPACITY) * h);
    if (mat.userData.shader) {
      mat.userData.shader.uniforms.uSat.value = REST_SATURATION + (1 - REST_SATURATION) * h;
    }
    if (introDone && !locked) {
      const s = 1 + Math.max(0, align - 0.6) * 0.16;
      m.scale.x += (s - m.scale.x) * 0.12;
      m.scale.y += (s - m.scale.y) * 0.12;
    }
    if (align > 0.78) visible++;
  }
  if (frame % 6 === 0) focusEl.textContent = visible;

  if (!locked && hasFineHover) {
    const m = pickAt(cursorPos.x, cursorPos.y);
    if (m !== hovered) {
      if (hovered) {
        gsap.killTweensOf(hovered.material.userData);
        gsap.to(hovered.material.userData, { hover: 0, duration: HOVER_TWEEN_MS / 1000, ease: "power2.out" });
      }
      hovered = m;
      if (m) {
        gsap.killTweensOf(m.material.userData);
        gsap.to(m.material.userData, { hover: 1, duration: HOVER_TWEEN_MS / 1000, ease: "power2.out" });
      }
      cursor.classList.toggle("hot", !!m);
    }
  }

  renderer.render(scene, camera);
  frame++;
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  applyCamera();
});
addEventListener("orientationchange", () => setTimeout(() => {
  renderer.setSize(innerWidth, innerHeight);
  applyCamera();
}, 120));

// ── Intro ─────────────────────────────────────────────────────────────────
document.getElementById("count").textContent = EXPERIMENTS.length;
document.getElementById("ldNum").textContent = "100%";
layout();

if (reduced) {
  cards.forEach((m) => m.scale.set(1, 1, 1));
  introDone = true;
  loader.classList.add("gone");
} else {
  cards.forEach((m) => m.scale.set(0, 0, 0));
  requestAnimationFrame(() => {
    gsap.to(loader, { opacity: 0, duration: 0.7, onComplete: () => loader.classList.add("gone") });
    gsap.to(cards.map((m) => m.scale), {
      x: 1, y: 1, z: 1, duration: 0.9, ease: "expo.out",
      stagger: { each: 0.04, from: "center" },
      onComplete: () => { introDone = true; },
    });
    st.vs = -0.05;
  });
}

// ── bfcache restore ───────────────────────────────────────────────────────
// navigateTo leaves the page in an end-of-transition state (locked, faded,
// black overlay opaque) right before it changes location. If the browser
// serves the page back from bfcache that exact state is restored — looks
// frozen — so reset everything when pageshow.persisted is true.
addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  gsap.killTweensOf([navFade, ".topbar", ".lang-switch", hint, cursor, camera, camera.position]);
  cards.forEach((c) => {
    gsap.killTweensOf(c.material);
    gsap.killTweensOf(c.material.userData);
    c.material.color.setRGB(1, 1, 1);
    c.material.opacity = 1;
    c.material.userData.hover = hasFineHover ? 0 : 1;
  });
  hovered = null;
  cancelTap();
  // Zero scroll velocity + pointer state so the wall doesn't jolt
  // forward on bfcache restore with whatever momentum was in flight.
  st.vs = 0; st.vy = 0;
  st.ts = st.s; st.ty = st.y;
  pointers.clear();
  dragging = false; pinch = 0;
  navFade.style.opacity = 0;
  document.querySelectorAll(".topbar, .lang-switch").forEach((node) => { node.style.opacity = ""; });
  if (hint) hint.style.opacity = "";
  cursor.style.opacity = "";
  zoom = 1; applyCamera();
  locked = false;
  interacted = false;
});

tick();
