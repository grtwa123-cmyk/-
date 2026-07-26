/*
 * gl3d — a compact ball-and-stick 3D viewer built straight on WebGL.
 *
 * The molecule / crystal / DNA experiments are inherently three-dimensional
 * but used to be drawn with a hand-rolled 2D projection: a single rotation
 * axis, flat discs with a painted-on highlight, and painter's-algorithm
 * sorting. This module renders them properly instead — perspective camera,
 * a real depth buffer, Blinn–Phong shading, and free orbit on both axes —
 * without taking on a runtime dependency, so the pages still work offline.
 *
 * Two unit primitives are uploaded once (a sphere, and a cylinder spanning
 * y = 0…1) and re-drawn per object with a model matrix, so a scene is just
 * a list of {position, radius, colour} and {a, b, radius, colour}. Scenes
 * here run to a few hundred objects, where one draw call each is far
 * cheaper than the bookkeeping instancing would cost.
 *
 * The optional overlay canvas sits on top for 2D labels: `project()` maps a
 * world point to CSS pixels so callers can place text at an atom without
 * needing to know anything about the matrices.
 */
(() => {
  // ── Matrix helpers (column-major, matching WebGL) ──────────────────────
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                       a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  function perspective(fovyDeg, aspect, near, far) {
    const f = 1 / Math.tan((fovyDeg * Math.PI) / 360);
    const nf = 1 / (near - far);
    const o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf;
    o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  }
  function lookAt(eye, center, up) {
    const z = norm3(sub3(eye, center));
    const x = norm3(cross3(up, z));
    const y = cross3(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
    ]);
  }
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  function norm3(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  // Model matrix for a sphere: translate(p) · scale(r)
  function sphereModel(p, r) {
    return new Float32Array([r,0,0,0, 0,r,0,0, 0,0,r,0, p[0],p[1],p[2],1]);
  }
  // Model matrix mapping the unit +Y cylinder onto the segment a→b.
  // Returns both the model matrix and its matching normal matrix (the
  // rotation with the non-uniform scale divided back out).
  function cylinderModel(a, b, r) {
    const d = sub3(b, a);
    const len = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    const u = [d[0] / len, d[1] / len, d[2] / len];
    // Rotation taking +Y onto u.
    let xa, za;
    if (u[1] > 0.9999) { xa = [1, 0, 0]; za = [0, 0, 1]; }
    else if (u[1] < -0.9999) { xa = [1, 0, 0]; za = [0, 0, -1]; }
    else {
      xa = norm3(cross3([0, 1, 0], u));
      za = cross3(xa, u);
    }
    const model = new Float32Array([
      xa[0] * r, xa[1] * r, xa[2] * r, 0,
      u[0] * len, u[1] * len, u[2] * len, 0,
      za[0] * r, za[1] * r, za[2] * r, 0,
      a[0], a[1], a[2], 1,
    ]);
    const normal = new Float32Array([
      xa[0], xa[1], xa[2],
      u[0], u[1], u[2],
      za[0], za[1], za[2],
    ]);
    return { model, normal };
  }
  const IDENT3 = new Float32Array([1,0,0, 0,1,0, 0,0,1]);

  // ── Geometry ───────────────────────────────────────────────────────────
  function makeSphere(seg, ring) {
    const pos = [], idx = [];
    for (let j = 0; j <= ring; j++) {
      const phi = (j / ring) * Math.PI;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        pos.push(sp * Math.cos(th), cp, sp * Math.sin(th));
      }
    }
    for (let j = 0; j < ring; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i, b = a + seg + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { pos: new Float32Array(pos), norm: new Float32Array(pos), idx: new Uint16Array(idx) };
  }
  function makeCylinder(seg) {
    const pos = [], norm = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      pos.push(c, 0, s); norm.push(c, 0, s);
      pos.push(c, 1, s); norm.push(c, 0, s);
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    // Flat caps so cell edges and exposed bond ends don't look hollow.
    for (const y of [0, 1]) {
      const base = pos.length / 3;
      pos.push(0, y, 0); norm.push(0, y ? 1 : -1, 0);
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        pos.push(Math.cos(th), y, Math.sin(th));
        norm.push(0, y ? 1 : -1, 0);
      }
      for (let i = 0; i < seg; i++) {
        if (y) idx.push(base, base + 1 + i, base + 2 + i);
        else idx.push(base, base + 2 + i, base + 1 + i);
      }
    }
    return { pos: new Float32Array(pos), norm: new Float32Array(norm), idx: new Uint16Array(idx) };
  }

  const VERT = `
    attribute vec3 aPos; attribute vec3 aNormal;
    uniform mat4 uProj, uView, uModel; uniform mat3 uNormalMat;
    varying vec3 vN, vW;
    void main() {
      vec4 w = uModel * vec4(aPos, 1.0);
      vW = w.xyz;
      vN = uNormalMat * aNormal;
      gl_Position = uProj * uView * w;
    }`;
  const FRAG = `
    precision mediump float;
    varying vec3 vN, vW;
    uniform vec3 uColor, uCam, uLight;
    uniform float uAlpha;
    void main() {
      vec3 N = normalize(vN);
      vec3 V = normalize(uCam - vW);
      if (dot(N, V) < 0.0) N = -N;            // keep caps/backfaces lit sanely
      vec3 L = normalize(uLight);
      float diff = max(dot(N, L), 0.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 40.0);
      float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
      vec3 c = uColor * (0.30 + 0.74 * diff) + vec3(1.0) * spec * 0.32 + uColor * rim * 0.20;
      gl_FragColor = vec4(c, uAlpha);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error("gl3d shader: " + gl.getShaderInfoLog(s));
    }
    return s;
  }

  // Readers who ask for reduced motion should not get a model spinning at
  // them forever. The CSS media query in styles.css can only reach CSS
  // animations, so the idle auto-rotate has to check this itself.
  const reduceQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  const prefersReducedMotion = () => !!(reduceQuery && reduceQuery.matches);

  function create(opts) {
    const canvas = opts.canvas;
    const overlay = opts.overlay || null;
    const octx = overlay ? overlay.getContext("2d") : null;
    const attrs = { antialias: true, alpha: false, depth: true, premultipliedAlpha: false };
    const gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs);
    if (!gl) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("gl3d link: " + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);

    const A = { pos: gl.getAttribLocation(prog, "aPos"), norm: gl.getAttribLocation(prog, "aNormal") };
    const U = {};
    for (const n of ["uProj", "uView", "uModel", "uNormalMat", "uColor", "uCam", "uLight", "uAlpha"]) {
      U[n] = gl.getUniformLocation(prog, n);
    }

    function upload(g) {
      const b = {
        pos: gl.createBuffer(), norm: gl.createBuffer(), idx: gl.createBuffer(), n: g.idx.length,
      };
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.bufferData(gl.ARRAY_BUFFER, g.pos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.norm); gl.bufferData(gl.ARRAY_BUFFER, g.norm, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW);
      return b;
    }
    // Two sphere levels of detail — busy lattices swap to the cheaper one.
    const GEO = {
      sphereHi: upload(makeSphere(28, 18)),
      sphereLo: upload(makeSphere(14, 9)),
      cyl: upload(makeCylinder(18)),
    };

    function bind(b) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pos);
      gl.enableVertexAttribArray(A.pos);
      gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.norm);
      gl.enableVertexAttribArray(A.norm);
      gl.vertexAttribPointer(A.norm, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const bg = opts.background || [0.04, 0.06, 0.13];

    const view = {
      gl,
      spheres: [],
      cylinders: [],
      yaw: opts.yaw !== undefined ? opts.yaw : 0.6,
      pitch: opts.pitch !== undefined ? opts.pitch : 0.35,
      dist: 12,
      target: [0, 0, 0],
      autoRotate: true,
      speed: 0.45,             // rad/s
      fov: opts.fov || 42,
      W: 1, H: 1,
      onOverlay: null,
      _raf: 0, _last: 0, _proj: null, _viewM: null, _cam: [0, 0, 1],
    };

    // Redraw only when something actually changed. With auto-rotate off and
    // no input, the image is static, so re-rendering it 60 times a second is
    // pure battery burn — a few frames of margin lets the overlay settle.
    let dirty = 3;
    const invalidate = () => { dirty = 3; };
    view.invalidate = invalidate;

    view.setScene = (scene) => {
      view.spheres = scene.spheres || [];
      view.cylinders = scene.cylinders || [];
      invalidate();
    };

    // Frame the camera so a sphere of the given radius fills the viewport.
    view.fit = (radius, pad) => {
      const p = pad === undefined ? 1.28 : pad;
      view._fitRadius = radius; view._fitPad = p;
      const vFov = (view.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(view.W / view.H, 0.35));
      view.dist = (radius * p) / Math.sin(Math.min(vFov, hFov) / 2);
      invalidate();
    };

    view.resize = () => {
      canvas.style.removeProperty("width");
      canvas.style.removeProperty("height");
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      view.W = Math.max(Math.round(rect.width), opts.minWidth || 260);
      view.H = opts.height || 460;
      canvas.width = Math.round(view.W * dpr);
      canvas.height = Math.round(view.H * dpr);
      canvas.style.setProperty("width", view.W + "px", "important");
      canvas.style.setProperty("height", view.H + "px", "important");
      if (overlay) {
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        overlay.style.setProperty("width", view.W + "px", "important");
        overlay.style.setProperty("height", view.H + "px", "important");
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      invalidate();
    };

    // Recompute the camera basis + matrices for the current orbit state.
    // draw() calls this every frame; project() calls it on demand so a
    // caller can map points before the first frame has been rendered.
    function updateCamera() {
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      const eye = [
        view.target[0] + view.dist * cp * Math.sin(view.yaw),
        view.target[1] + view.dist * sp,
        view.target[2] + view.dist * cp * Math.cos(view.yaw),
      ];
      view._cam = eye;
      view._proj = perspective(view.fov, view.W / view.H, Math.max(view.dist * 0.02, 0.05), view.dist * 6 + 100);
      view._viewM = lookAt(eye, view.target, [0, 1, 0]);
      return eye;
    }
    view._updateCamera = updateCamera;

    // World point → CSS pixels on the overlay.
    view.project = (p) => {
      if (!view._proj || !view._viewM) updateCamera();
      const m = mul(view._proj, view._viewM);
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (w <= 0.0001) return { x: 0, y: 0, visible: false, w };
      return { x: (x / w * 0.5 + 0.5) * view.W, y: (1 - (y / w * 0.5 + 0.5)) * view.H, visible: true, w };
    };

    function draw() {
      const eye = updateCamera();

      // Key light rides with the camera so the model stays lit while tumbling.
      const fwd = norm3(sub3(eye, view.target));
      const right = norm3(cross3([0, 1, 0], fwd));
      const up = cross3(fwd, right);
      const light = norm3([
        fwd[0] + right[0] * 0.55 + up[0] * 0.45,
        fwd[1] + right[1] * 0.55 + up[1] * 0.45,
        fwd[2] + right[2] * 0.55 + up[2] * 0.45,
      ]);

      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.uProj, false, view._proj);
      gl.uniformMatrix4fv(U.uView, false, view._viewM);
      gl.uniform3fv(U.uCam, new Float32Array(eye));
      gl.uniform3fv(U.uLight, new Float32Array(light));
      gl.uniform1f(U.uAlpha, 1);

      const sphereGeo = view.spheres.length > 120 ? GEO.sphereLo : GEO.sphereHi;
      bind(sphereGeo);
      for (const s of view.spheres) {
        gl.uniformMatrix4fv(U.uModel, false, sphereModel(s.p, s.r));
        gl.uniformMatrix3fv(U.uNormalMat, false, IDENT3);
        gl.uniform3fv(U.uColor, s.color);
        gl.drawElements(gl.TRIANGLES, sphereGeo.n, gl.UNSIGNED_SHORT, 0);
      }

      if (view.cylinders.length) {
        bind(GEO.cyl);
        for (const c of view.cylinders) {
          const m = cylinderModel(c.a, c.b, c.r);
          gl.uniformMatrix4fv(U.uModel, false, m.model);
          gl.uniformMatrix3fv(U.uNormalMat, false, m.normal);
          gl.uniform3fv(U.uColor, c.color);
          gl.drawElements(gl.TRIANGLES, GEO.cyl.n, gl.UNSIGNED_SHORT, 0);
        }
      }

      if (octx) {
        octx.clearRect(0, 0, view.W, view.H);
        if (view.onOverlay) view.onOverlay(octx, view.project, view);
      }
    }
    // Callers use this to request a repaint after changing something the
    // engine can't see (a label toggle, say); the next frame picks it up.
    view.draw = invalidate;

    function frame(ts) {
      view._raf = requestAnimationFrame(frame);
      const dt = Math.max(0, Math.min((ts - view._last) / 1000, 0.05));
      view._last = ts;
      if (view.autoRotate && !dragging && view.speed > 0) {
        view.yaw += view.speed * dt;
        invalidate();
      }
      if (view.onTick) view.onTick(dt);
      if (dirty > 0) { dirty--; draw(); }
    }
    view.start = () => {
      cancelAnimationFrame(view._raf);
      view._last = performance.now();
      view._raf = requestAnimationFrame(frame);
    };
    view.stop = () => cancelAnimationFrame(view._raf);

    // ── Orbit / zoom input ───────────────────────────────────────────────
    let dragging = false, lastX = 0, lastY = 0;
    const pointers = new Map();
    let pinchDist = 0;

    canvas.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 1) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) view.dist = Math.max(view._minD || 1, Math.min(view._maxD || 1e4, view.dist * (pinchDist / (d || 1))));
        pinchDist = d;
        invalidate();
        return;
      }
      if (!dragging) return;
      view.yaw -= (e.clientX - lastX) * 0.01;
      view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch + (e.clientY - lastY) * 0.01));
      lastX = e.clientX; lastY = e.clientY;
      invalidate();
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) dragging = false;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      view.dist = Math.max(view._minD || 1, Math.min(view._maxD || 1e4, view.dist * (1 + Math.sign(e.deltaY) * 0.12)));
      invalidate();
    }, { passive: false });

    // ── Keyboard control ─────────────────────────────────────────────────
    // The model is a real interactive surface, so it has to be operable
    // without a pointer: focus it and drive it with the arrow keys.
    const zoomBy = (f) => {
      view.dist = Math.max(view._minD || 1, Math.min(view._maxD || 1e4, view.dist * f));
      invalidate();
    };
    canvas.tabIndex = 0;
    canvas.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.24 : 0.09;
      let handled = true;
      switch (e.key) {
        case "ArrowLeft":  view.yaw -= step; break;
        case "ArrowRight": view.yaw += step; break;
        case "ArrowUp":    view.pitch = Math.min(1.45, view.pitch + step); break;
        case "ArrowDown":  view.pitch = Math.max(-1.45, view.pitch - step); break;
        case "+": case "=": zoomBy(0.88); break;
        case "-": case "_": zoomBy(1.14); break;
        case "0":
          view.yaw = opts.yaw !== undefined ? opts.yaw : 0.6;
          view.pitch = opts.pitch !== undefined ? opts.pitch : 0.35;
          if (view._fitRadius) view.fit(view._fitRadius, view._fitPad);
          break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); invalidate(); }
    });

    view.setZoomRange = (min, max) => { view._minD = min; view._maxD = max; };
    view.isDragging = () => dragging;

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) view.stop(); else view.start();
    });

    view.resize();
    return view;
  }

  window.GL3D = { create, prefersReducedMotion };
})();
