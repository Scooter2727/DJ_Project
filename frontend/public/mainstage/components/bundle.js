/* @ds-bundle: {"format":4,"namespace":"FLXHero","components":[{"name":"GameplayScreen"},{"name":"Deck"},{"name":"NoteLanes"},{"name":"Note"},{"name":"HitMarker"},{"name":"HitFX"},{"name":"Crowd"},{"name":"Equalizer"},{"name":"Title"},{"name":"TrackSelect"}]} */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- constants
  var W = 1600, H = 900;            // logical size of the sharp layer
  var LW = 640, LH = 360;           // retro layer resolution (dithered, upscaled)
  var LS = LW / W;
  var ROWS = ['TRIM', 'HI', 'MID', 'LOW', 'CFX'];
  var KNOB_SWEEP = Math.PI / 2; // radians to either side of twelve o'clock
  var C = {
    void: '#0b0814', wall: '#1a1028', plum: '#3a2160', violet: '#8b4dff', magenta: '#ff3d9a',
    cyan: '#34e0ff', amber: '#ffb330', laser: '#6bff9e', cream: '#f6ecd6', creamDim: '#c9bda4', ink: '#120d1c',
    perfect: '#f6ecd6', good: '#34e0ff', miss: '#ff4d5e'
  };
  var FONT = '"Press Start 2P", "Courier New", monospace';
  var JCOL = { perfect: C.perfect, good: C.good, miss: C.miss };

  // ---------------------------------------------------------------- helpers
  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function poly(ctx, p) { ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (var i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.closePath(); }
  function mod(a, n) { return ((a % n) + n) % n; }
  function key(ch, row) { return ch + ':' + row; }
  function pad(n, w) { n = String(Math.max(0, Math.floor(n))); while (n.length < w) n = '0' + n; return n; }

  function ensureFont() {
    if (typeof document === 'undefined' || document.getElementById('flx-fonts')) return;
    var l = document.createElement('link'); l.id = 'flx-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Space+Grotesk:wght@400;500;700&display=swap';
    document.head.appendChild(l);
  }

  var _noise = null;
  function noiseCanvas() {
    if (_noise) return _noise;
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), d = x.createImageData(64, 64), r = rng(99);
    for (var i = 0; i < d.data.length; i += 4) { var v = (r() * 255) | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0); _noise = c; return c;
  }
  function noise(ctx) {
    if (ctx._flxNoise) return ctx._flxNoise;
    var p = ctx.createPattern(noiseCanvas(), 'repeat');
    if (p.setTransform && typeof DOMMatrix !== 'undefined') p.setTransform(new DOMMatrix().scale(1 / LS));
    ctx._flxNoise = p; return p;
  }
  function texture(ctx, x, y, w, h, a) {
    ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = a; ctx.fillStyle = noise(ctx); ctx.fillRect(x, y, w, h); ctx.restore();
  }

  // ordered 4x4 Bayer dither + colour quantise: the PS1 crunch for the retro layer only
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function dither(ctx, w, h, step) {
    var img = ctx.getImageData(0, 0, w, h), d = img.data, y, x, i, b, v;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = (y * w + x) * 4; b = (BAYER[((y & 3) << 2) | (x & 3)] / 16 - 0.5) * step;
        v = Math.round((d[i] + b) / step) * step; d[i] = v < 0 ? 0 : v > 255 ? 255 : v;
        v = Math.round((d[i + 1] + b) / step) * step; d[i + 1] = v < 0 ? 0 : v > 255 ? 255 : v;
        v = Math.round((d[i + 2] + b) / step) * step; d[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------- layout + camera
  // The deck is authored flat (top-down, "flat" coords) and shown through a shallow
  // three-quarter camera: front edge close, back edge receding. P() is a true perspective
  // map. Each vertical lane ends at the projected centre of its knob's raised face.
  var DECK_EXTENSION = 275;
  function makeLayout(opts) {
    opts = opts || {};
    var rows = ROWS.filter(function (r) { return !opts.rows || opts.rows.indexOf(r) >= 0; });
    var pitch = opts.rowPitch || 78, flatRowY = {};
    ROWS.forEach(function (r, i) { flatRowY[r] = 440 + i * pitch; });
    var cam = Object.assign({ cx: 800, front: 910, D: 530, Yf: 885, c: 0.9, k: 0.2 }, opts.camera || {});
    function P(x, y) { var v = cam.front - y, s = 1 / (1 + cam.k * v / cam.D); return { x: cam.cx + (x - cam.cx) * s, y: cam.Yf - v * cam.c * s, s: s }; }
    function unY(yp) { var u = (cam.Yf - yp) / cam.c, v = u / (1 - cam.k * u / cam.D); return { y: cam.front - v, s: 1 / (1 + cam.k * v / cam.D) }; }
    var flat = {
      deck: { x: 370 - DECK_EXTENSION, y: 380, w: 860 + 2 * DECK_EXTENSION, h: 530, r: 24 },
      knobX: { 1: {}, 2: {} }, knobR: 20, rowY: flatRowY,
      deckOffset: { 1: -DECK_EXTENSION, 2: 580 + DECK_EXTENSION }
    };
    var knobH = 8, lanes = { 1: {}, 2: {} };
    ROWS.forEach(function (row, index) {
      [1, 2].forEach(function (ch) {
        var outward = ch === 1 ? -1 : 1;
        var x = 800 + outward * (42 + index * 78);
        flat.knobX[ch][row] = x;
        var centre = P(x, flatRowY[row]);
        lanes[ch][row] = { x: centre.x, hitY: centre.y - knobH * centre.s,
          flatX: x, flatY: flatRowY[row], pointerRadius: flat.knobR * centre.s };
      });
    });
    return {
      W: W, H: H, rows: rows, flat: flat, P: P, unY: unY, cam: cam, knobH: knobH,
      lanes: lanes, spawnY: -24, laneWidth: 64, noteR: 19, markerR: 24
    };
  }
  function isPositionTrace(trace) { return trace && Array.isArray(trace.changes); }
  function guideBottom(L, lane, trace) {
    return isPositionTrace(trace) ? knobTip(L, lane, knobAngle(trace.position)).y : lane.hitY;
  }
  function noteY(L, lane, timeUntilHit, approach, trace) {
    return lerp(guideBottom(L, lane, trace), L.spawnY, clamp(timeUntilHit / approach, 0, 1));
  }
  function knobAngle(position) { return (clamp(position, 0, 1) - 0.5) * 2 * KNOB_SWEEP; }
  function knobTip(L, lane, angle) {
    return planePt(L, lane.flatX, lane.flatY, L.flat.knobR, angle, L.knobH);
  }
  function positionOffset(position, lane) {
    return Math.sin(knobAngle(position)) * lane.pointerRadius;
  }
  function traceOffset(trace, fraction, width, lane) {
    if (!trace) return 0;
    if (isPositionTrace(trace)) {
      var position = trace.position;
      for (var change of trace.changes) {
        if (change.fraction > fraction + 1e-12) break;
        position = change.position;
      }
      return positionOffset(position, lane);
    }
    var index = clamp(fraction, 0, 1) * (trace.length - 1), i = Math.floor(index);
    var turn = lerp(trace[i], trace[Math.min(i + 1, trace.length - 1)], index - i);
    return clamp(turn, -1, 1) * (width / 2 - 5);
  }
  // a flat circle on the deck plane, lifted by `lift` px (knob height), as a projected path
  function planeCircle(ctx, L, cx, cy, r, lift, a0, a1, ccw) {
    var n = 36, i, from = a0 == null ? 0 : a0, to = a1 == null ? Math.PI * 2 : a1;
    if (ccw) { var t = from; from = to; to = t; }
    ctx.beginPath();
    for (i = 0; i <= n; i++) {
      var a = from + (to - from) * i / n, p = planePt(L, cx, cy, r, a, lift);
      if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
  }
  function planePt(L, cx, cy, r, a, lift) {
    var center = L.P(cx, cy), depth = L.P(cx, cy - Math.cos(a) * r);
    return { x: center.x + Math.sin(a) * (r * center.s), y: depth.y - lift * depth.s };
  }

  // ---------------------------------------------------------------- stage
  function createStage(rootEl) {
    ensureFont();
    var wrap = document.createElement('div'); wrap.className = 'flx-stage';
    wrap.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;background:#0b0814;overflow:hidden;outline:none;';
    wrap.tabIndex = 0;
    var lo = document.createElement('canvas'); lo.width = LW; lo.height = LH;
    var sh = document.createElement('canvas'); sh.width = W; sh.height = H;
    var css = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;';
    lo.style.cssText = css + 'image-rendering:pixelated;image-rendering:crisp-edges;';
    sh.style.cssText = css;
    wrap.appendChild(lo); wrap.appendChild(sh); rootEl.appendChild(wrap);
    var lctx = lo.getContext('2d', { willReadFrequently: true }); lctx.imageSmoothingEnabled = false;
    var sctx = sh.getContext('2d');
    var raf = 0, last = 0, running = false;
    function resetFrameTime() { last = 0; }
    return {
      el: wrap, low: lctx, sharp: sctx,
      beginLow: function () { lctx.setTransform(LS, 0, 0, LS, 0, 0); },
      endLow: function (step) { lctx.setTransform(1, 0, 0, 1, 0, 0); dither(lctx, LW, LH, step || 22); },
      run: function (fn, options) {
        running = true;
        document.addEventListener('visibilitychange', resetFrameTime);
        var tick = function (ts) {
          if (!running) return;
          var elapsed = last ? (ts - last) / 1000 : 0.016; last = ts;
          fn(options?.timeline ? elapsed : Math.min(0.05, elapsed), ts / 1000);
          if (running) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      stop: function () { running = false; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', resetFrameTime); }
    };
  }

  // ---------------------------------------------------------------- Venue (retro layer)
  var _panels = null;
  function wallPanels() {
    if (_panels) return _panels;
    var r = rng(11), cols = 14, rows = 4, pts = [], tris = [], i, j;
    for (j = 0; j <= rows; j++) { pts[j] = []; for (i = 0; i <= cols; i++) pts[j][i] = [i * W / cols + (i > 0 && i < cols ? (r() - 0.5) * 70 : 0), 20 + j * 105 + (j > 0 && j < rows ? (r() - 0.5) * 50 : 0)]; }
    for (j = 0; j < rows; j++) for (i = 0; i < cols; i++) {
      var a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i], d = pts[j + 1][i + 1];
      tris.push({ p: [a, b, d], s: 0.7 + r() * 0.6 }, { p: [a, d, c], s: 0.7 + r() * 0.6 });
    }
    _panels = tris; return tris;
  }
  var FIX_X = [90, 290, 490, 690, 910, 1110, 1310, 1510];
  var FIX_COL = [C.violet, C.magenta, C.cyan, C.violet, C.magenta, C.cyan, C.magenta, C.violet];
  var _sparks = null, _floorCrowd = null;
  function sparks() {
    if (_sparks) return _sparks;
    var r = rng(77), a = [];
    for (var i = 0; i < 90; i++) a.push({ x: r() * W, y: 70 + r() * 360, ph: r() * 6.28, sp: 0.6 + r() * 1.2 });
    _sparks = a; return a;
  }
  // cheap bloom: shrink the lit part of the retro layer twice (smoothing on = blur), add it back on top
  var _bl = null;
  function bloom(ctx, yLogical, amount) {
    var c = ctx.canvas, hl = Math.round(yLogical * LS);
    if (!_bl) {
      var a = document.createElement('canvas'), b = document.createElement('canvas');
      a.width = LW / 4; a.height = LH / 4; b.width = LW / 10; b.height = LH / 10;
      _bl = { a: a, b: b, ac: a.getContext('2d'), bc: b.getContext('2d') };
    }
    var ah = Math.round(hl / 4), bh = Math.max(1, Math.round(hl / 10));
    _bl.ac.imageSmoothingEnabled = true; _bl.bc.imageSmoothingEnabled = true;
    _bl.ac.clearRect(0, 0, _bl.a.width, _bl.a.height); _bl.bc.clearRect(0, 0, _bl.b.width, _bl.b.height);
    _bl.ac.drawImage(c, 0, 0, LW, hl, 0, 0, _bl.a.width, ah);
    _bl.bc.drawImage(_bl.a, 0, 0, _bl.a.width, ah, 0, 0, _bl.b.width, bh);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = amount; ctx.drawImage(_bl.b, 0, 0, _bl.b.width, bh, 0, 0, LW, hl);
    ctx.globalAlpha = amount * 0.6; ctx.drawImage(_bl.a, 0, 0, _bl.a.width, ah, 0, 0, LW, hl);
    ctx.restore();
  }

  var Venue = {
    // o: {t, e (crowd energy 0..1), beat (float beats)}. Lights never go fully dark: LL is the floor-to-peak light level.
    draw: function (ctx, o) {
      var e = o.e, t = o.t, bp = o.beat - Math.floor(o.beat), i, j, LL = 0.55 + 0.45 * e, kick = Math.exp(-bp * 6);
      ctx.fillStyle = '#120a20'; ctx.fillRect(0, 0, W, H);
      wallPanels().forEach(function (tr) {
        var s = tr.s * (0.9 + 0.6 * LL);
        ctx.fillStyle = 'rgb(' + (34 * s | 0) + ',' + (18 * s | 0) + ',' + (58 * s | 0) + ')'; poly(ctx, tr.p); ctx.fill();
      });
      texture(ctx, 0, 0, W, 440, 0.18);
      // coloured side washes pumping on the kick
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      [[0, C.magenta], [W, C.cyan]].forEach(function (w) {
        var g = ctx.createRadialGradient(w[0], 300, 20, w[0], 300, 620);
        g.addColorStop(0, hexA(w[1], (0.22 + 0.25 * kick) * LL)); g.addColorStop(1, hexA(w[1], 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, 450);
      });
      // LED arch: concentric low-poly rings, centre glow behind it
      var cx = 800, cy = 430, segs = 22, ring, a0 = Math.PI * 1.06, a1 = Math.PI * 1.94;
      var cg = ctx.createRadialGradient(cx, cy - 60, 20, cx, cy - 60, 420);
      cg.addColorStop(0, hexA(C.violet, 0.3 * LL + 0.15 * kick)); cg.addColorStop(1, hexA(C.violet, 0));
      ctx.fillStyle = cg; ctx.fillRect(300, 0, 1000, 450);
      for (ring = 0; ring < 5; ring++) {
        var r0 = 170 + ring * 46, r1 = r0 + 36;
        for (i = 0; i < segs; i++) {
          var aa = lerp(a0, a1, i / segs) + 0.012, ab = lerp(a0, a1, (i + 1) / segs) - 0.012;
          var v = 0.5 + 0.5 * Math.sin(i * 0.5 - ring * 0.9 + t * 2.2 + Math.sin(o.beat * Math.PI * 0.5) * 1.5);
          var chase = mod(i - Math.floor(o.beat * 2), segs) < 4 ? 0.5 : 0;
          var col = [C.violet, C.cyan, C.magenta, C.laser][mod(ring + Math.floor(o.beat / 4), 4)];
          ctx.fillStyle = hexA(col, clamp((0.18 + 0.42 * v * v) * LL + 0.18 * kick * (ring < 2 ? 1 : 0.4) + chase * 0.7, 0, 0.85));
          poly(ctx, [[cx + Math.cos(aa) * r0, cy + Math.sin(aa) * r0], [cx + Math.cos(aa) * r1, cy + Math.sin(aa) * r1], [cx + Math.cos(ab) * r1, cy + Math.sin(ab) * r1], [cx + Math.cos(ab) * r0, cy + Math.sin(ab) * r0]]);
          ctx.fill();
        }
      }
      ctx.restore();
      // speaker stacks with glowing cones
      [40, 1440].forEach(function (x, si) {
        ctx.fillStyle = '#0d0a12'; ctx.fillRect(x, 150, 120, 300);
        ctx.strokeStyle = hexA(si ? C.cyan : C.magenta, 0.5 + 0.4 * kick); ctx.lineWidth = 4; ctx.strokeRect(x + 4, 154, 112, 292);
        for (j = 0; j < 2; j++) {
          var wy = 230 + j * 130, pump = 1 + kick * 0.1;
          ctx.fillStyle = '#17121f'; circ(ctx, x + 60, wy, 46); ctx.fill();
          ctx.strokeStyle = hexA(si ? C.cyan : C.magenta, 0.5 + 0.5 * kick); ctx.lineWidth = 6; circ(ctx, x + 60, wy, 38 * pump); ctx.stroke();
          ctx.fillStyle = '#2a2036'; circ(ctx, x + 60, wy, 16 * pump); ctx.fill();
        }
      });
      // truss, fixtures and a mirror ball
      ctx.fillStyle = '#08060c'; ctx.fillRect(0, 22, W, 28);
      ctx.strokeStyle = '#3a2c4c'; ctx.lineWidth = 3; ctx.beginPath();
      for (i = 0; i < W; i += 40) { ctx.moveTo(i, 24); ctx.lineTo(i + 20, 48); ctx.lineTo(i + 40, 24); }
      ctx.stroke();
      for (i = 0; i < FIX_X.length; i++) {
        ctx.fillStyle = '#1c1525'; ctx.fillRect(FIX_X[i] - 15, 48, 30, 22);
        ctx.fillStyle = hexA(FIX_COL[i], 0.8 + 0.2 * kick); circ(ctx, FIX_X[i], 72, 8); ctx.fill();
      }
      ctx.fillStyle = '#b9b3c9'; circ(ctx, 800, 92, 22); ctx.fill();
      ctx.fillStyle = '#e9e4f5';
      for (i = 0; i < 12; i++) { var ma = i / 12 * Math.PI * 2 + t * 1.5; if (Math.cos(ma) > 0) ctx.fillRect(800 + Math.sin(ma) * 16 - 3, 84 + (i % 3) * 6, 5, 5); }
      // mirror-ball sparkles drifting across the room
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      sparks().forEach(function (sp) {
        var x = mod(sp.x + t * 45 * sp.sp, W), tw = 0.5 + 0.5 * Math.sin(t * 5 * sp.sp + sp.ph);
        ctx.fillStyle = hexA(C.cream, (0.25 + 0.6 * tw) * LL); ctx.fillRect(x - 3, sp.y - 3, 6, 6);
      });
      ctx.restore();
    },
    drawBeams: function (ctx, o) {
      var e = o.e, t = o.t, bp = o.beat - Math.floor(o.beat), LL = 0.55 + 0.45 * e, kick = Math.exp(-bp * 6), k, i;
      var order = [3, 4, 1, 6, 0, 7, 2, 5], n = 5 + Math.round(e * 3);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 444); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      for (k = 0; k < n; k++) {
        i = order[k];
        var x = FIX_X[i], ang = Math.sin(t * (0.5 + 0.09 * i) + i * 1.3) * 0.6, len = 540, spread = 70 + 70 * e;
        var tx = x + Math.sin(ang) * len, ty = 72 + Math.cos(ang) * len;
        var g = ctx.createLinearGradient(x, 72, tx, ty);
        g.addColorStop(0, hexA(FIX_COL[i], (0.3 + 0.25 * kick) * LL)); g.addColorStop(1, hexA(FIX_COL[i], 0));
        ctx.fillStyle = g;
        poly(ctx, [[x - 6, 72], [x + 6, 72], [tx + spread * Math.cos(ang), ty - spread * Math.sin(ang)], [tx - spread * Math.cos(ang), ty + spread * Math.sin(ang)]]);
        ctx.fill();
      }
      // laser fans: one from the centre, one from each side, sweeping; thin bright core + soft halo
      var fans = [[800, 30, C.laser, 0], [60, 120, C.cyan, 1], [1540, 120, C.magenta, 2]];
      fans.forEach(function (f) {
        var nl = 7, sweep = Math.sin(t * (0.7 + f[3] * 0.2) + f[3] * 2) * 0.5, base = f[3] === 0 ? Math.PI / 2 : f[3] === 1 ? Math.PI * 0.18 : Math.PI * 0.82;
        var on = f[3] === 0 ? 1 : (mod(Math.floor(o.beat / 2), 2) === f[3] - 1 || e > 0.5 ? 1 : 0.35);
        for (var l = 0; l < nl; l++) {
          var a = base + sweep + (l - (nl - 1) / 2) * 0.13, ex = f[0] + Math.cos(a) * 1300, ey = f[1] + Math.sin(a) * 1300;
          ctx.strokeStyle = hexA(f[2], 0.14 * on * LL); ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(f[0], f[1]); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.strokeStyle = hexA(f[2], (0.75 + 0.25 * kick) * on * LL); ctx.lineWidth = 3; ctx.stroke();
        }
      });
      var hz = ctx.createRadialGradient(800, 280, 40, 800, 280, 820);
      hz.addColorStop(0, hexA(C.violet, 0.16 + 0.16 * e)); hz.addColorStop(1, hexA(C.violet, 0));
      ctx.fillStyle = hz; ctx.fillRect(0, 0, W, 444);
      if (bp < 0.06 && e > 0.55) { ctx.fillStyle = hexA(C.cream, 0.08 + 0.12 * e); ctx.fillRect(0, 0, W, 444); }   // strobe on the downbeat
      ctx.restore();
    },
    bloom: bloom,
    // the booth floor: retro grid scrolling toward the player on the beat, roaming light pools,
    // a chasing LED strip top and bottom. All of it sits under the lane bands, so notes stay readable.
    drawBooth: function (ctx, o) {
      var e = o.e, i, bp = o.beat - Math.floor(o.beat), LL = 0.55 + 0.45 * e, kick = Math.exp(-bp * 6), t = o.t;
      var top = 446, vx = 800, vy = 330;
      var bg = ctx.createLinearGradient(0, top, 0, H);
      bg.addColorStop(0, '#1c1030'); bg.addColorStop(1, '#2a1440');
      ctx.fillStyle = bg; ctx.fillRect(0, 440, W, H - 440);
      ctx.save(); ctx.beginPath(); ctx.rect(0, top, W, H - top); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      // perspective grid. Default: every row rushes toward the player once per beat.
      // o.road (title screen): only a wide centre wedge scrolls; the floor either side stays still.
      // No edge lines or markings: the motion alone gives the shape.
      var gridA = (0.22 + 0.2 * kick) * LL, span = H + 40 - top;
      function rowY(z) { return top + Math.pow(z, 2.2) * span; }
      var floorBeat = o.beat + (o.floorTravel || 0);
      var wedge = o.road ? (o.roadWidth || 3) : 0, rows = o.road ? 14 : 9;   // road: wider wedge, rows reach further into the distance
      function edge(y, sg) { return vx + sg * wedge * (40 + 220 * (y - top) / span); }   // follows the converging grid lines
      ctx.lineWidth = 3;
      for (i = 0; i < rows; i++) {
        var z = (i + mod(floorBeat, 1)) / rows, y = rowY(z);
        ctx.strokeStyle = hexA((i - Math.floor(floorBeat)) % 2 ? C.magenta : C.violet, gridA * (0.4 + z));
        ctx.beginPath();
        if (o.road) { ctx.moveTo(edge(y, -1), y); ctx.lineTo(edge(y, 1), y); }
        else { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
      }
      for (i = -12; i <= 12; i++) {
        if (o.road && Math.abs(i) > wedge) continue;   // outside the wedge is crowd, not floor
        ctx.strokeStyle = hexA(C.violet, gridA * 0.8);
        ctx.beginPath(); ctx.moveTo(vx + i * 40, top); ctx.lineTo(vx + i * 260, H + 40); ctx.stroke();
      }
      // roaming light pools (moving heads hitting the floor)
      var pools = [[C.magenta, 0.0], [C.cyan, 1.7], [C.laser, 3.1], [C.violet, 4.4]];
      pools.forEach(function (pl, k) {
        var px = 800 + Math.sin(t * (0.35 + k * 0.08) + pl[1]) * 720, py = 640 + Math.sin(t * (0.5 + k * 0.05) + pl[1] * 1.3) * 180;
        var g = ctx.createRadialGradient(px, py, 10, px, py, 230);
        g.addColorStop(0, hexA(pl[0], (0.2 + 0.12 * kick) * LL)); g.addColorStop(1, hexA(pl[0], 0));
        ctx.fillStyle = g; ctx.fillRect(px - 230, py - 230, 460, 460);
      });
      // underglow around the deck
      var g2 = ctx.createRadialGradient(800, 700, 80, 800, 700, 700);
      g2.addColorStop(0, hexA(C.magenta, (0.26 + 0.2 * kick) * LL)); g2.addColorStop(0.55, hexA(C.violet, 0.16 * LL)); g2.addColorStop(1, hexA(C.violet, 0));
      ctx.fillStyle = g2; ctx.fillRect(0, top, W, H - top);
      // light spilling down from the stage
      var g3 = ctx.createLinearGradient(0, top, 0, 560);
      g3.addColorStop(0, hexA(C.cyan, 0.28 * LL)); g3.addColorStop(1, hexA(C.cyan, 0));
      ctx.fillStyle = g3; ctx.fillRect(0, top, W, 114);
      ctx.restore();
      texture(ctx, 0, 440, W, H - 440, 0.22);
      // road mode: a hyped crowd fills the floor either side of the moving wedge, in perspective
      if (o.road) {
        if (!_floorCrowd || _floorCrowd.wedge !== wedge) {
          // packed but natural: perspective rows, people spaced by their own size with jitter, alternate rows staggered
          var fr = rng(31), ppl = [], R = 30, rr0, sgn;
          for (rr0 = 0; rr0 < R; rr0++) {
            var fz = 0.02 + 0.98 * (rr0 + 0.5) / R;
            [-1, 1].forEach(function (sg) {
              var fy0 = rowY(fz), fsc0 = (40 + 220 * (fy0 - top) / span) / 260, gap = 44 * fsc0;
              var x0 = edge(fy0, sg) + sg * (24 * fsc0 + (rr0 % 2 ? gap * 0.5 : 0)), lim = sg < 0 ? -30 : W + 30;
              for (var xx = x0; sg < 0 ? xx > lim : xx < lim; xx += sg * gap * (0.8 + 0.4 * fr())) {
                var fy = fy0 + (fr() - 0.5) * 10 * fsc0, fsc = fsc0 * (0.9 + 0.2 * fr());
                ppl.push({ x: xx + (fr() - 0.5) * gap * 0.3, y: fy, s: fsc * 1.5, shade: 0.25 + 0.75 * fsc0, armT: 0.02 + fr() * 0.5, jumpT: 0.2 + fr() * 0.6,
                  ph: fr() * 6.28, tone: fr(), hair: fr() < 0.45, arm: 1, jump: 1, oneArm: fr() < 0.3, stick: fr() < 0.35,
                  stickCol: [C.laser, C.cyan, C.magenta, C.amber][(fr() * 4) | 0] });
              }
            });
          }
          ppl.sort(function (a, b) { return a.y - b.y; });
          // The densely packed back rows repeat the same beat cycle. Keep their pixel silhouettes
          // in a small sprite sequence and draw the people closest to the camera in real time.
          var split = ppl.findIndex(function (p) { return p.y > top + span * 0.32; });
          if (split < 0) split = ppl.length;
          _floorCrowd = { wedge: wedge, back: new Crowd(0, ppl.slice(0, split)),
            front: new Crowd(0, ppl.slice(split)), frames: [] };
        }
        var frame = Math.floor(bp * 12), silhouettes = _floorCrowd.frames[frame];
        if (!silhouettes) {
          silhouettes = document.createElement('canvas'); silhouettes.width = LW; silhouettes.height = LH;
          var peopleCtx = silhouettes.getContext('2d'); peopleCtx.scale(LS, LS);
          _floorCrowd.back.draw(peopleCtx, { t: 0, e: 0.95, beat: frame / 12 });
          _floorCrowd.frames[frame] = silhouettes;
        }
        ctx.drawImage(silhouettes, 0, 0, W, H);
        _floorCrowd.front.draw(ctx, { t: o.t, e: 0.95, beat: o.beat });
      }
      // road mode: equalizer bars standing along both borders of the moving wedge, receding into the
      // distance. Sized by perspective; a kick ripples from the stage toward the player.
      if (o.road) {
        var nb = 16, bk;
        for (bk = nb - 1; bk >= 0; bk--) {                       // far to near so near bars overlap far ones
          var zb = (bk + 0.5) / nb, yb = rowY(zb), sc = (40 + 220 * (yb - top) / span) / 260;
          var ripple = Math.exp(-mod(o.beat - (1 - zb) * 0.5, 1) * 6);
          [-1, 1].forEach(function (sg, si) {
            var lvl = (0.3 + 0.7 * Math.abs(Math.sin(bk * 1.7 + si * 2.1 + Math.floor(o.beat) * 0.9))) * (0.35 + 0.65 * ripple) * (0.6 + 0.4 * LL);
            var bw = 44 * sc + 3, bh = 420 * sc * lvl, step = Math.max(4, 15 * sc), bx = edge(yb, sg) + sg * (bw * 0.6) - bw / 2;
            var cols = [C.cyan, C.violet, C.magenta];
            for (var yy = 0; yy < bh; yy += step) {
              var fr = yy / (420 * sc);
              ctx.fillStyle = hexA(cols[Math.min(2, Math.floor(fr * 3))], 0.9 - 0.3 * fr);
              ctx.fillRect(bx, yb - yy - step + 1, bw, Math.max(2, step - Math.max(1, 3 * sc)));
            }
          });
        }
      }
      // LED strips: stage edge and the booth's front lip, chasing in opposite directions
      for (i = 0; i < 40; i++) {
        var col = [C.violet, C.magenta, C.cyan, C.laser][mod(i + Math.floor(o.beat * 2), 4)];
        if (!o.road) {   // stage-edge strip; the title screen leaves it out so nothing cuts under the logo
          ctx.fillStyle = hexA(col, 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(i * 0.6 - o.beat * Math.PI * 2)));
          ctx.fillRect(i * 40 + 2, 436, 36, 10);
        }
        var col2 = [C.cyan, C.violet, C.magenta, C.laser][mod(i - Math.floor(o.beat * 2), 4)];
        ctx.fillStyle = hexA(col2, (0.45 + 0.4 * kick) * (0.5 + 0.5 * Math.sin(i * 0.6 + o.beat * Math.PI * 2)) + 0.15);
        ctx.fillRect(i * 40 + 2, H - 12, 36, 12);
      }
      if (!o.road) { ctx.fillStyle = '#07050b'; ctx.fillRect(0, 446, W, 6); }
    }
  };

  // ---------------------------------------------------------------- Crowd (retro layer)
  // energy 0..1: sway + head bob -> arms up -> jumping -> whole room on the beat
  function Crowd(seed, people, expandable) {
    var r = rng(seed || 7), self = this;
    this.people = [];
    if (people) { this.people = people; return; }
    var rows = [{ y: 320, s: 0.62, n: 24, shade: 0.35 }, { y: 390, s: 0.85, n: 17, shade: 0.6 }, { y: 470, s: 1.15, n: 11, shade: 0.9 }];
    if (expandable) rows.push(
      { y: 271, s: 0.46, n: 13, shade: 0.27, distant: true },
      { y: 298, s: 0.53, n: 20, shade: 0.38, tier: 1, distant: true },
      { y: 342, s: 0.69, n: 14, shade: 0.48, tier: 2 },
      { y: 365, s: 0.70, n: 11, shade: 0.55, tier: 2, sides: true },
      { y: 319, s: 0.59, n: 19, shade: 0.44, tier: 3, distant: true },
      { y: 424, s: 0.95, n: 16, shade: 0.76, tier: 3 },
      { y: 246, s: 0.42, n: 20, shade: 0.35, tier: 4, distant: true }
    );
    rows.forEach(function (row) {
      for (var i = 0; i < row.n; i++) {
        var lane = (i + 0.5 + (r() - 0.5) * 0.6) / row.n;
        if (row.sides) lane = lane < 0.5 ? lane * 0.66 : 0.34 + lane * 0.66;
        self.people.push({
          x: lane * W, y: row.y + (r() - 0.5) * 14, s: row.s * (0.88 + r() * 0.24),
          shade: row.shade, armT: 0.12 + r() * 0.62, jumpT: 0.45 + r() * 0.4, ph: r() * 6.28, tone: r(), hair: r() < 0.45,
          arm: 0, jump: 0, oneArm: r() < 0.35, stick: r() < 0.45, stickCol: [C.laser, C.cyan, C.magenta, C.amber][(r() * 4) | 0],
          tier: row.tier, opacity: row.tier ? 0 : 1, distant: row.distant
        });
      }
    });
    if (expandable) this.people.sort(function (a, b) { return a.y - b.y; });
  }
  Crowd.prototype.update = function (dt, e, tier) {
    this.people.forEach(function (p) {
      if (p.tier) {
        var visible = tier >= p.tier;
        p.opacity += ((visible ? 1 : 0) - p.opacity) * Math.min(1, dt * 3);
        if (!visible && p.opacity < 0.015) return;
      }
      var armTgt = e > p.armT ? 1 : 0, jumpTgt = e > p.jumpT || e > 0.88 ? 1 : 0;
      p.arm += (armTgt - p.arm) * Math.min(1, dt * 4);
      p.jump += (jumpTgt - p.jump) * Math.min(1, dt * 3);
    });
  };
  Crowd.prototype.draw = function (ctx, o) {
    var e = o.e, t = o.t, bp = o.beat - Math.floor(o.beat);
    var celebration = o.celebration;
    var cheer = celebration ? Math.min(1, celebration.elapsed * 5, (celebration.duration - celebration.elapsed) * 2.5) : 0;
    var cheerBeat = celebration ? celebration.elapsed * o.tempo / 60 : 0;
    var rim = [C.violet, C.magenta, C.cyan];
    this.people.forEach(function (p, idx) {
      if (p.tier && p.opacity < 0.015) return;
      if (p.tier) { ctx.save(); ctx.globalAlpha *= p.opacity; }
      var h = 120 * p.s;
      var sway = Math.sin(t * 1.7 + p.ph) * 6 * p.s * (1 - 0.4 * e);
      var bob = Math.sin((bp + p.ph * 0.015) * Math.PI * 2) * 3 * p.s * (0.6 + e);
      var hop = p.jump * Math.abs(Math.sin(bp * Math.PI)) * 18 * p.s;
      if (cheer > 0) {
        var jumpPhase = mod(cheerBeat + p.ph * 0.06, 1);
        hop = lerp(hop, 64 * p.s * Math.sin(jumpPhase * Math.PI), cheer);
      }
      var x = p.x + sway, base = p.y - hop;
      var v = p.shade * (0.55 + 0.6 * e);
      var body = 'rgb(' + ((8 + 16 * v * (0.6 + p.tone * 0.4)) | 0) + ',' + ((6 + 8 * v) | 0) + ',' + ((14 + 20 * v) | 0) + ')';
      ctx.fillStyle = body;
      if (p.distant) {
        var faceY = base - 0.95 * h + bob;
        ctx.fillRect(x - 0.14 * h, base - 0.73 * h, 0.28 * h, 0.66 * h);
        ctx.fillRect(x - 0.1 * h, faceY - 0.09 * h, 0.2 * h, 0.19 * h);
        var arms = Math.max(p.arm, cheer);
        ctx.fillRect(x - 0.23 * h, base - (0.54 + 0.5 * arms) * h, 0.08 * h, 0.38 * h);
        if (!p.oneArm || cheer > 0) ctx.fillRect(x + 0.15 * h, base - (0.54 + 0.55 * arms) * h, 0.08 * h, 0.38 * h);
        ctx.fillStyle = hexA(rim[idx % 3], 0.30 + 0.28 * e);
        ctx.fillRect(x - 0.1 * h, faceY - 0.09 * h, 0.2 * h, 3);
        if (p.tier) ctx.restore();
        return;
      }
      poly(ctx, [[x - 0.11 * h, base - 0.38 * h], [x + 0.11 * h, base - 0.38 * h], [x + 0.08 * h, base + 4], [x - 0.08 * h, base + 4]]); ctx.fill();
      poly(ctx, [[x - 0.17 * h, base - 0.8 * h], [x + 0.17 * h, base - 0.8 * h], [x + 0.13 * h, base - 0.36 * h], [x - 0.13 * h, base - 0.36 * h]]); ctx.fill();
      ctx.strokeStyle = body; ctx.lineWidth = 0.075 * h; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = hexA(rim[idx % 3], 0.4 + 0.4 * e * p.shade); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 0.17 * h, base - 0.8 * h); ctx.lineTo(x + 0.17 * h, base - 0.8 * h); ctx.stroke();
      ctx.strokeStyle = body; ctx.lineWidth = 0.075 * h;
      [-1, 1].forEach(function (sg) {
        var a = lerp(p.oneArm && sg < 0 ? p.arm * 0.25 : p.arm, 1, cheer);
        var pump = Math.sin(lerp(bp, cheerBeat, cheer) * Math.PI * 2 + p.ph) * (0.04 + 0.07 * cheer) * h * a;
        var sx = x + sg * 0.15 * h, sy = base - 0.77 * h;
        var ex = lerp(x + sg * 0.21 * h, x + sg * 0.25 * h, a), ey = lerp(base - 0.57 * h + bob * 0.3, base - 0.98 * h, a);
        var hx = lerp(x + sg * 0.19 * h + sway * 0.1, x + sg * 0.19 * h, a), hy = lerp(base - 0.4 * h, base - 1.2 * h + pump, a);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
        if (p.stick && a > 0.5 && sg > 0) { ctx.save(); ctx.fillStyle = p.stickCol; ctx.fillRect(hx - 3, hy - 0.16 * h, 6, 0.16 * h); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = hexA(p.stickCol, 0.35); circ(ctx, hx, hy - 0.08 * h, 0.08 * h); ctx.fill(); ctx.restore(); ctx.strokeStyle = body; ctx.lineWidth = 0.075 * h; }
      });
      var hx0 = x + sway * 0.3, hy0 = base - 0.92 * h + bob, hr = 0.1 * h, k, pts = [];
      for (k = 0; k < 6; k++) pts.push([hx0 + Math.cos(k / 6 * Math.PI * 2 + 0.3) * hr, hy0 + Math.sin(k / 6 * Math.PI * 2 + 0.3) * hr]);
      ctx.fillStyle = body; poly(ctx, pts); ctx.fill();
      ctx.strokeStyle = hexA(rim[idx % 3], 0.6 + 0.4 * e * p.shade); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(hx0, hy0, hr, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      if (p.tier) ctx.restore();
    });
  };

  // ---------------------------------------------------------------- Equalizer (drawn into the deck surface)
  // Audio frame shape (from the game, or sampleAudio() for the mockup):
  //   { kick 0..1, bass 0..1, hats 0..1, energy 0..1, bands?: number[] 0..1 (any length, low to high), level?: [l, r] }
  // Bars rise instantly on a hit and fall smoothly. They are deliberately dim: the bright beams
  // on the mapped knobs stay the brightest thing on the deck.
  function sampleAudio(time, bpm) {
    var beat = time * bpm / 60, bp = beat - Math.floor(beat), b8 = beat * 2 - Math.floor(beat * 2), b16i = Math.floor(beat * 4), b16 = beat * 4 - b16i;
    var phrase = mod(beat, 32) / 32;                                 // 8-bar phrase: build, peak, breakdown
    var energy = phrase < 0.75 ? 0.35 + 0.6 * (phrase / 0.75) : 0.95 - 0.6 * ((phrase - 0.75) / 0.25);
    var kick = Math.exp(-bp * 9);
    var bass = 0.25 + 0.6 * Math.exp(-b8 * 4) * (mod(Math.floor(beat * 2), 2) === 1 ? 1 : 0.55);   // off-beat bassline pumps
    var hats = (mod(b16i, 2) === 1 ? 1 : 0.35) * Math.exp(-b16 * 14);
    return { kick: kick, bass: bass, hats: hats, energy: energy };
  }
  function Equalizer(nBands) {
    this.n = nBands || 16; this.bars = []; this.level = [0, 0]; this.peaks = [];
    for (var i = 0; i < this.n; i++) { this.bars.push(0); this.peaks.push(0); }
    this.r = rng(21);
  }
  Equalizer.prototype.update = function (dt, a, t) {
    a = a || {}; var n = this.n, i, r = this.r, e = a.energy == null ? 0.6 : a.energy;
    for (i = 0; i < n; i++) {
      var f = i / (n - 1), v;
      if (a.bands && a.bands.length) v = a.bands[Math.min(a.bands.length - 1, Math.floor(f * a.bands.length))];
      else {
        var flick = 0.55 + 0.45 * r();                                // light hi-hat shimmer
        v = (a.kick || 0) * Math.pow(1 - f, 2) * 1.0
          + (a.bass || 0) * Math.max(0, 1 - Math.abs(f - 0.22) * 3) * 0.75
          + (a.hats || 0) * Math.pow(f, 1.6) * 0.8 * flick
          + 0.18 * (0.6 + 0.4 * Math.sin(i * 1.7 + t * 2.3));
        v *= 0.35 + 0.65 * e;                                         // whole display rides the track energy
      }
      v = clamp(v, 0, 1);
      // quick rise, smooth drop
      this.bars[i] = v > this.bars[i] ? v : this.bars[i] + (v - this.bars[i]) * Math.min(1, dt * 5);
      this.peaks[i] = Math.max(this.bars[i], this.peaks[i] - dt * 0.6);
    }
    var lv = a.level || [clamp(((a.kick || 0) * 0.7 + (a.bass || 0) * 0.5) * (0.4 + 0.6 * e), 0, 1), clamp(((a.kick || 0) * 0.55 + (a.hats || 0) * 0.5 + (a.bass || 0) * 0.3) * (0.4 + 0.6 * e), 0, 1)];
    for (i = 0; i < 2; i++) this.level[i] = lv[i] > this.level[i] ? lv[i] : this.level[i] + (lv[i] - this.level[i]) * Math.min(1, dt * 6);
  };
  var EQ_ON = ['#1f6f85', '#2d7f8f', '#4a3c96', '#5a3a9e', '#7a2f84', '#8f2a68'];   // dim cyan -> violet -> magenta
  var EQ_OFF = '#18161d';
  function eqCol(rowFrac) { return EQ_ON[Math.min(EQ_ON.length - 1, Math.floor(rowFrac * EQ_ON.length))]; }
  // bank of stacked-pixel bars in flat deck coords. mirror: lows on the right
  Equalizer.prototype.drawBank = function (ctx, x, y, w, h, cols, rows, mirror) {
    var gap = 5, bw = (w - gap * (cols - 1)) / cols, bh = (h - gap * (rows - 1)) / rows, c, k;
    ctx.fillStyle = '#0c0b10'; ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
    for (c = 0; c < cols; c++) {
      var bi = Math.floor((c + 0.5) / cols * this.n), idx = bi;
      var lit = Math.round(this.bars[idx] * rows), pk = Math.min(rows - 1, Math.round(this.peaks[idx] * rows) - 1);
      var bx = x + (mirror ? cols - 1 - c : c) * (bw + gap);
      for (k = 0; k < rows; k++) {
        var by = y + h - (k + 1) * bh - k * gap;
        ctx.fillStyle = k < lit ? eqCol(k / rows) : (k === pk ? '#3a3448' : EQ_OFF);
        ctx.fillRect(bx, by, bw, bh);
      }
    }
  };
  Equalizer.prototype.drawMeter = function (ctx, x, y, w, h, rows, side) {
    var gap = 5, bh = (h - gap * (rows - 1)) / rows, lit = Math.round(this.level[side] * rows), k;
    ctx.fillStyle = '#0c0b10'; ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
    for (k = 0; k < rows; k++) { ctx.fillStyle = k < lit ? eqCol(k / rows) : EQ_OFF; ctx.fillRect(x, y + h - (k + 1) * bh - k * gap, w, bh); }
  };

  // ---------------------------------------------------------------- Deck (retro body + sharp overlay)
  // Body is painted flat into a small offscreen canvas, then warped scanline by scanline onto the
  // retro layer through the camera (stepped edges, early-3D texture feel). Controls the game does
  // not use are drawn "soft": each one blurred and lowered in contrast on its own, so the mapped
  // knobs next to them stay crisp. Mapped knobs themselves are drawn sharp in drawOverlay.
  var SOFT = 'blur(0.7px) saturate(0.6) contrast(0.7) brightness(0.85)';
  var FX0 = 330 - DECK_EXTENSION, FY0 = 370, FWL = 940 + 2 * DECK_EXTENSION, FHL = 560;
  var _flat = null;
  function flatCanvas() {
    if (_flat) return _flat;
    var c = document.createElement('canvas'); c.width = Math.ceil(FWL * LS); c.height = Math.ceil(FHL * LS);
    _flat = { c: c, ctx: c.getContext('2d') }; return _flat;
  }
  // unused controls go to their own layer, which is blurred and dimmed once per frame as it is
  // composited; mapped knobs never enter it, so they stay crisp right next to blurred neighbours
  var _soft = null;
  function softLayer() {
    if (_soft) return _soft;
    var c = document.createElement('canvas'); c.width = Math.ceil(FWL * LS); c.height = Math.ceil(FHL * LS);
    _soft = { c: c, ctx: c.getContext('2d') }; return _soft;
  }
  function soft(ctx, fn) { fn(softLayer().ctx); }
  function knobLow(ctx, x, y, r) {
    ctx.fillStyle = '#0c0b0f'; circ(ctx, x, y + 3, r + 1); ctx.fill();
    ctx.fillStyle = '#1a191e'; circ(ctx, x, y, r); ctx.fill();
    ctx.fillStyle = '#2d2c33'; circ(ctx, x, y - 1, r * 0.72); ctx.fill();
    ctx.fillStyle = '#8a8478'; ctx.fillRect(x - 1, y - r * 0.7, 2, r * 0.45);
  }
  function btnLow(ctx, x, y, r, fill, ring) {
    ctx.fillStyle = '#0c0b0f'; circ(ctx, x, y + 3, r + 1); ctx.fill();
    ctx.fillStyle = fill; circ(ctx, x, y, r); ctx.fill();
    if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 3; circ(ctx, x, y, r - 1); ctx.stroke(); }
  }
  function deckHalf(ctx, ox, o, side) {
    var k, i, j;
    soft(ctx, function (ctx) {
      btnLow(ctx, 404 + ox, 405, 13, '#e9dfcb'); btnLow(ctx, 442 + ox, 405, 13, '#e9dfcb');
      btnLow(ctx, 480 + ox, 405, 9, '#151418'); btnLow(ctx, 514 + ox, 405, 7, '#151418'); btnLow(ctx, 538 + ox, 405, 7, '#151418');
      btnLow(ctx, 600 + ox, 405, 14, '#d6c9b0', '#a99c84');
    });
    var jx = 510 + ox, jy = 612;
    (function (ctx) {
      var wheel = o.wheels && o.wheels[side === 1 ? 'a' : 'b'], angle = wheel
        ? wheel.time * Math.PI * 2 * 33.333333 / 60
        : 0;
      ctx.fillStyle = '#0d0c10'; circ(ctx, jx, jy + 6, 117); ctx.fill();
      ctx.fillStyle = '#19181d'; circ(ctx, jx, jy, 114); ctx.fill();
      ctx.strokeStyle = '#28272d'; ctx.lineWidth = 6; circ(ctx, jx, jy, 105); ctx.stroke();
      ctx.save(); ctx.translate(jx, jy); ctx.rotate(angle); ctx.translate(-jx, -jy);
      ctx.fillStyle = '#5a5a62'; circ(ctx, jx, jy, 95); ctx.fill();
      ctx.fillStyle = '#6a6a73'; ctx.beginPath(); ctx.arc(jx, jy, 95, Math.PI * 0.9, Math.PI * 1.6); ctx.lineTo(jx, jy); ctx.fill();
      ctx.strokeStyle = '#c9c9cf'; ctx.lineWidth = 3; ctx.beginPath();
      for (k = 0; k < 40; k++) { var a = k / 40 * Math.PI * 2, radius = k % 5 === 0 ? 62 : 55; ctx.moveTo(jx + Math.cos(a) * 45, jy + Math.sin(a) * 45); ctx.lineTo(jx + Math.cos(a) * radius, jy + Math.sin(a) * radius); }
      ctx.stroke();
      ctx.strokeStyle = C.cream; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(jx + 66, jy); ctx.lineTo(jx + 90, jy); ctx.stroke();
      ctx.fillStyle = '#2e2e35'; circ(ctx, jx, jy, 40); ctx.fill();
      ctx.strokeStyle = '#aaaab3'; ctx.lineWidth = 5; circ(ctx, jx, jy, 30); ctx.stroke();
      ctx.fillStyle = '#3a3a42'; circ(ctx, jx, jy, 20); ctx.fill();
      ctx.strokeStyle = '#0d0c10'; ctx.lineWidth = 3; circ(ctx, jx, jy, 95); ctx.stroke();
      ctx.restore();
    })(ctx);
    soft(ctx, function (ctx) {
      ctx.fillStyle = '#131216'; ctx.fillRect(426 + ox, 768, 15, 15);
      btnLow(ctx, 404 + ox, 790, 18, '#141317', '#34333a'); btnLow(ctx, 404 + ox, 842, 18, '#141317', '#34333a');
      ctx.fillStyle = '#9c968a'; poly(ctx, [[398 + ox, 833], [398 + ox, 851], [413 + ox, 842]]); ctx.fill();
      var tx = 628 + ox;
      ctx.fillStyle = '#0b0a0e'; ctx.fillRect(tx - 4, 765, 8, 130);
      ctx.fillStyle = '#3a3940'; for (k = 0; k < 9; k++) ctx.fillRect(tx - 15, 770 + k * 14, 7, 2);
      ctx.fillStyle = '#4c4c55'; ctx.fillRect(tx - 14, 815, 28, 15);
      ctx.fillStyle = '#d8d2c4'; ctx.fillRect(tx - 12, 821, 24, 3);
    });
    // performance pads -> equalizer bank, drawn on the surface (not soft) so it warps with the board
    if (o.eq) o.eq.drawBank(ctx, 446 + ox, 752, 158, 98, 8, 8, side === 2);
  }
  function mixerFlat(ctx, L, o) {
    var F = L.flat;
    [1, 2].forEach(function (ch) {
      var x = F.knobX[ch], y = F.rowY;
      ctx.fillStyle = '#24232b';
      ctx.strokeStyle = '#44414e'; ctx.lineWidth = 2;
      poly(ctx, [[x.TRIM - 36, y.TRIM - 34], [x.TRIM + 36, y.TRIM - 34],
        [x.CFX + 36, y.CFX + 40], [x.CFX - 36, y.CFX + 40]]);
      ctx.fill(); ctx.stroke();
    });
    soft(ctx, function (ctx) {
      ctx.fillStyle = '#121115'; ctx.fillRect(747, 390, 26, 18); ctx.fillRect(827, 390, 26, 18);
      knobLow(ctx, 800, 400, 13);
      ctx.save(); ctx.translate(-DECK_EXTENSION, 0);
      knobLow(ctx, 688, 440, 12); btnLow(ctx, 688, 500, 11, '#151418', '#8c7a5a');
      knobLow(ctx, 688, 560, 11); knobLow(ctx, 688, 620, 11); btnLow(ctx, 688, 690, 11, '#151418', '#8c7a5a');
      ctx.restore(); ctx.save(); ctx.translate(DECK_EXTENSION, 0);
      knobLow(ctx, 912, 440, 12);
      ctx.strokeStyle = C.amber; ctx.lineWidth = 3; ctx.strokeRect(899, 476, 26, 14);
      ctx.fillStyle = '#0c0b0f'; ctx.fillRect(904, 512, 16, 30);
      ctx.fillStyle = '#131216'; ctx.fillRect(897, 562, 13, 13); ctx.fillRect(914, 562, 13, 13);
      knobLow(ctx, 912, 620, 12);
      btnLow(ctx, 912, 690, 13, hexA(C.amber, o.fxOn ? 1 : 0.35));
      ctx.restore();
    });
    // row knobs: mapped rows get only a socket (the knob is drawn sharp on top); unmapped rows are soft
    ROWS.forEach(function (r) {
      var on = L.rows.indexOf(r) >= 0;
      [1, 2].forEach(function (ch) {
        var x = F.knobX[ch][r], y = F.rowY[r];
        if (on) { ctx.fillStyle = '#0b0a0d'; circ(ctx, x, y + 2, F.knobR + 4); ctx.fill(); }
        else soft(ctx, function (ctx) { knobLow(ctx, x, y, F.knobR); });
      });
    });
    if (o.eq) {
      o.eq.drawMeter(ctx, 758, 522, 36, 226, 12, 0);
      o.eq.drawMeter(ctx, 806, 522, 36, 226, 12, 1);
    }
  }

  var XF = { x0: 610, x1: 990, y: 828 };   // a big crossfader: it fills the bottom of the mixer
  function xfPt(L, u, dy, lift) { var p = L.P(lerp(XF.x0, XF.x1, u), XF.y + (dy || 0)); return { x: p.x, y: p.y - (lift || 0) * p.s, s: p.s }; }
  function xfCap(ctx, L, u, lift, fill) {   // a cap as a projected box, 40 x 64 on the deck plane
    var cx = lerp(XF.x0, XF.x1, u), pts = [[-20, -32], [20, -32], [20, 32], [-20, 32]].map(function (q) { var p = L.P(cx + q[0], XF.y + q[1]); return [p.x, p.y - lift * p.s]; });
    poly(ctx, pts); ctx.fillStyle = fill; ctx.fill();
  }
  // The three printed zone labels surround the exact recorded target on the rail.
  var XF_ZONES = [{ c: 0, w: 0.2, label: '1' }, { c: 0.5, w: 0.2, label: 'MID' }, { c: 1, w: 0.2, label: '2' }];   // 1 = channel 1 side, 2 = channel 2 side
  function xfZone(to) { return to <= 0.25 ? 0 : to >= 0.75 ? 2 : 1; }
  function xfQuad(ctx, L, u0, u1, dy0, dy1, lift) {
    var pts = [[u0, dy0], [u1, dy0], [u1, dy1], [u0, dy1]].map(function (q) { var p = xfPt(L, q[0], q[1], lift); return [p.x, p.y]; });
    poly(ctx, pts);
  }
  function drawCrossfader(ctx, L, xf, now, beat, energy) {
    var u = xf.pos, k, cue = xf.cue, zi = cue ? xfZone(cue.to) : -1, inZone = cue && Math.abs(u - cue.to) <= 0.06;
    var bp = (beat || 0) - Math.floor(beat || 0), kick = Math.exp(-bp * 6), e = energy == null ? 0.5 : energy;
    var U0 = -0.16, U1 = 1.16, D0 = -62, D1 = 54;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // outer glow, pumping on the kick
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    xfQuad(ctx, L, U0 - 0.03, U1 + 0.03, D0 - 12, D1 + 12, 2);
    ctx.strokeStyle = hexA(C.magenta, 0.18 + 0.3 * kick * (0.5 + e)); ctx.lineWidth = 26; ctx.stroke();
    ctx.strokeStyle = hexA(C.violet, 0.25 + 0.2 * kick); ctx.lineWidth = 12; ctx.stroke();
    ctx.restore();
    // the plate
    xfQuad(ctx, L, U0, U1, D0, D1, 2); ctx.fillStyle = 'rgba(8,6,14,.96)'; ctx.fill();
    // neon border: colour blocks chasing round the edge on the beat
    var cols = [C.magenta, C.violet, C.cyan, C.laser, C.amber], edge = [];
    [[U0, D0, U1, D0], [U1, D0, U1, D1], [U1, D1, U0, D1], [U0, D1, U0, D0]].forEach(function (sd, si) {
      var n = si % 2 ? 6 : 16;
      for (var q = 0; q < n; q++) edge.push([lerp(sd[0], sd[2], q / n), lerp(sd[1], sd[3], q / n), lerp(sd[0], sd[2], (q + 0.75) / n), lerp(sd[1], sd[3], (q + 0.75) / n)]);
    });
    edge.forEach(function (sg, q) {
      var p0 = xfPt(L, sg[0], sg[1], 2), p1 = xfPt(L, sg[2], sg[3], 2);
      var lit = 0.55 + 0.45 * Math.max(0, Math.sin((q / edge.length) * Math.PI * 4 - (beat || 0) * Math.PI));
      ctx.strokeStyle = hexA(cols[mod(q + Math.floor((beat || 0) * 2), cols.length)], lit); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    });
    // LED dots along the top and bottom edges, an EQ that rides the kick
    for (k = 0; k < 22; k++) {
      var uu = lerp(U0 + 0.05, U1 - 0.05, k / 21), on = Math.abs(Math.sin(k * 1.3 + Math.floor(beat || 0) * 0.8)) * (0.4 + 0.6 * kick) > 0.35;
      var dt0 = xfPt(L, uu, D0 + 9, 2), db0 = xfPt(L, uu, D1 - 9, 2);
      ctx.fillStyle = on ? cols[k % cols.length] : 'rgba(246,236,214,.08)';
      ctx.fillRect(dt0.x - 3, dt0.y - 2, 6, 4); ctx.fillRect(db0.x - 3, db0.y - 2, 6, 4);
    }
    // zones: 1 | MID | 2, the asked-for one lit
    XF_ZONES.forEach(function (z, i) {
      var u0 = Math.max(-0.06, z.c - z.w / 2), u1 = Math.min(1.06, z.c + z.w / 2), lit = i === zi;
      xfQuad(ctx, L, u0, u1, -44, 38, 2);
      ctx.fillStyle = lit ? hexA(C.cyan, 0.25 + 0.3 * (cue ? cue.ready : 0)) : 'rgba(246,236,214,.06)'; ctx.fill();
      if (lit) { ctx.strokeStyle = hexA(C.cyan, 0.6 + 0.4 * cue.ready); ctx.lineWidth = 3; ctx.stroke(); }
      var lp = xfPt(L, z.c, 32, 2);
      ctx.font = '14px ' + FONT; ctx.textAlign = 'center'; ctx.fillStyle = lit ? C.cream : hexA(C.creamDim, 0.6); ctx.fillText(z.label, lp.x, lp.y + 5);
    });
    // the track
    var a = xfPt(L, 0, -6, 2), b = xfPt(L, 1, -6, 2);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    var tg = ctx.createLinearGradient(a.x, a.y, b.x, b.y); tg.addColorStop(0, hexA(C.magenta, 0.7)); tg.addColorStop(0.5, hexA(C.violet, 0.5)); tg.addColorStop(1, hexA(C.cyan, 0.7));
    ctx.strokeStyle = tg; ctx.lineWidth = 3; ctx.stroke();
    // instruction above the plate, with a fill bar counting down to the move
    if (cue) {
      var destination = Math.abs(cue.to - XF_ZONES[zi].c) < 0.06
        ? (zi === 1 ? 'MIDDLE' : XF_ZONES[zi].label) : Math.round(cue.to * 100) + '%';
      var word = (inZone ? 'HOLD ' : 'SLIDE TO ') + destination;
      var tp = xfPt(L, 0.5, -88, 2);
      ctx.font = '16px ' + FONT; var tw = ctx.measureText(word).width + 30;
      ctx.fillStyle = 'rgba(8,6,14,.95)'; ctx.fillRect(tp.x - tw / 2, tp.y - 18, tw, 32);
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 3; ctx.strokeRect(tp.x - tw / 2 + 1.5, tp.y - 16.5, tw - 3, 29);
      ctx.fillStyle = hexA(C.cyan, 0.4); ctx.fillRect(tp.x - tw / 2 + 3, tp.y + 8, (tw - 6) * cue.ready, 4);
      ctx.fillStyle = C.cream; ctx.fillText(word, tp.x, tp.y + 2);
      if (!inZone) {
        xfQuad(ctx, L, cue.to - 0.045, cue.to + 0.045, -32, 32, 12);
        ctx.strokeStyle = C.cyan; ctx.lineWidth = 3; ctx.stroke();
        var dir = cue.to > u ? 1 : -1, s0 = xfPt(L, u + dir * 0.1, -6, 12), s1 = xfPt(L, cue.to - dir * 0.05, -6, 12);
        ctx.strokeStyle = '#000'; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
        ctx.strokeStyle = C.cyan; ctx.lineWidth = 6; ctx.stroke();
        ctx.fillStyle = C.cyan; ctx.beginPath(); ctx.moveTo(s1.x + dir * 18, s1.y); ctx.lineTo(s1.x - dir * 3, s1.y - 14); ctx.lineTo(s1.x - dir * 3, s1.y + 14); ctx.closePath(); ctx.fill();
      }
    }
    // the cap
    for (var h = 2; h <= 12; h += 2) xfCap(ctx, L, u, h, h === 2 ? '#05040a' : '#3a3940');
    xfCap(ctx, L, u, 12, inZone ? C.cyan : C.cream);
    var cl0 = xfPt(L, u, -26, 12), cl1 = xfPt(L, u, 26, 12);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cl0.x, cl0.y); ctx.lineTo(cl1.x, cl1.y); ctx.stroke();
    var mp = (now - (xf.moveT == null ? -9 : xf.moveT)) / 0.3;
    if (mp < 1) { var g = xfPt(L, u, 0, 12); ctx.strokeStyle = hexA(C.cyan, 0.8 * (1 - mp)); ctx.lineWidth = 3; ctx.strokeRect(g.x - 27, g.y - 42, 54, 76); }
    ctx.restore();
  }

  // ---------------------------------------------------------------- Jog wheel moves (sharp)
  // The numbered countdown uses seconds to the audio cue. Its glow pulses on the track tempo.
  function jogCenter(L, ch) { return { x: 510 + L.flat.deckOffset[ch], y: 612 }; }
  function pixelArrow(ctx, x, y, dir, size, col) {   // chunky right/left arrow built from blocks
    var p = size / 6; ctx.fillStyle = col;
    ctx.fillRect(x - dir * 3 * p - (dir < 0 ? 4 * p : 0), y - p, 4 * p, 2 * p);
    for (var i = 0; i < 4; i++) ctx.fillRect(x + dir * i * p - (dir < 0 ? p : 0), y - (4 - i) * p, p, (4 - i) * 2 * p);
  }
  function drawJogCue(ctx, L, cue, spb, reducedMotion, animationTime) {
    var c = jogCenter(L, cue.deck === 'a' ? 1 : 2), R0 = 108, k;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var remaining = cue.remaining, n = Math.max(0, Math.ceil(remaining));
    var sgn = cue.deck === 'a' ? -1 : 1;
    var color = sgn < 0 ? C.magenta : C.cyan;
    var onBeat = reducedMotion ? 0 : Math.exp(-mod(-remaining / spb, 1) * 6);
    var spinning = n === 0, cp = L.P(c.x, c.y), top = L.P(c.x, c.y - R0 - 30);
    if (cue.bonus || cue.matched) {
      planeCircle(ctx, L, c.x, c.y, R0 + 8, 0);
      ctx.strokeStyle = C.laser; ctx.lineWidth = 7; ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '29px ' + FONT;
      var result = cue.bonus ? '+' + cue.bonus : 'ON CUE';
      ctx.strokeStyle = C.void; ctx.lineWidth = 9; ctx.strokeText(result, cp.x, cp.y);
      ctx.fillStyle = C.laser; ctx.fillText(result, cp.x, cp.y);
    } else {
      // the whole disc lights up, pulsing on every beat of the count (brighter on the SPIN beat)
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      planeCircle(ctx, L, c.x, c.y, R0 + 26, 0); ctx.fillStyle = hexA(color, (spinning ? 0.22 : 0.09) + 0.16 * onBeat); ctx.fill();
      ctx.restore();
      planeCircle(ctx, L, c.x, c.y, R0, 0); ctx.strokeStyle = 'rgba(8,6,14,.9)'; ctx.lineWidth = 14; ctx.stroke();
      var fill = clamp(1 - remaining / (cue.lead || 3), 0, 1);
      planeCircle(ctx, L, c.x, c.y, R0, 0, 0, sgn * Math.PI * 2 * fill); ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.stroke();
      // Zero radians is twelve o'clock. Positive angles move right across the top.
      var phase = reducedMotion ? 0 : animationTime * Math.PI * 2 / (4 * spb);
      for (k = 0; k < 3; k++) {
        var angle = sgn * (phase + k * Math.PI * 2 / 3);
        var tip = planePt(L, c.x, c.y, R0 + 12, angle, 0);
        var tail = planePt(L, c.x, c.y, R0 + 12, angle - sgn * (k ? 0.13 : 0.21), 0);
        var vx = tip.x - tail.x, vy = tip.y - tail.y, len = Math.hypot(vx, vy) || 1;
        var nx = -vy / len * (k ? 6 : 9), ny = vx / len * (k ? 6 : 9);
        poly(ctx, [[tip.x, tip.y], [tail.x + nx, tail.y + ny], [tail.x - nx, tail.y - ny]]);
        ctx.strokeStyle = C.void; ctx.lineWidth = 4; ctx.stroke();
        ctx.fillStyle = k ? color : C.cream; ctx.fill();
      }
      // banner above the disc from the very first beat: direction in words and arrows, so it's known early
      var word = sgn > 0 ? 'SPIN RIGHT' : 'SPIN LEFT';
      ctx.font = '22px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var bw = ctx.measureText(word).width + 120, by = top.y - 34, bscale = 1 + 0.08 * onBeat;
      ctx.save(); ctx.translate(top.x, by); ctx.scale(bscale, bscale);
      ctx.fillStyle = 'rgba(8,6,14,.95)'; ctx.fillRect(-bw / 2, -24, bw, 48);
      ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(-bw / 2 + 2, -22, bw - 4, 44);
      ctx.fillStyle = C.cream; ctx.fillText(word, sgn > 0 ? -14 : 14, 2);
      var ax = sgn > 0 ? bw / 2 - 30 : -bw / 2 + 30, shake = 5 * onBeat * sgn;
      pixelArrow(ctx, ax + shake, 0, sgn, 26, color);
      ctx.restore();
      if (!spinning) {   // 3, 2, 1 big in the middle of the disc, popping on each beat
        var pop = 1 + 0.45 * onBeat;
        ctx.save(); ctx.translate(cp.x, cp.y); ctx.scale(pop, pop);
        ctx.font = '72px ' + FONT;
        ctx.strokeStyle = C.void; ctx.lineWidth = 12; ctx.strokeText(String(n), 0, 4); ctx.fillStyle = C.cream; ctx.fillText(String(n), 0, 4);
        ctx.restore();
      } else {   // SPIN beat: arrowheads racing round the rim in the spin direction, plus a big sweep arrow
        var a0 = sgn > 0 ? -Math.PI * 0.75 : Math.PI * 0.75, a1 = a0 + sgn * Math.PI * 1.3;
        planeCircle(ctx, L, c.x, c.y, R0 - 20, 0, a0, a1);
        ctx.strokeStyle = C.void; ctx.lineWidth = 18; ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.stroke();
        var tip = planePt(L, c.x, c.y, R0 - 20, a1, 0), back = planePt(L, c.x, c.y, R0 - 20, a1 - sgn * 0.3, 0);
        var dx = tip.x - back.x, dy = tip.y - back.y, dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(tip.x + dx * 26, tip.y + dy * 26); ctx.lineTo(tip.x - dy * 18, tip.y + dx * 18); ctx.lineTo(tip.x + dy * 18, tip.y - dx * 18); ctx.closePath(); ctx.fill();
        ctx.font = '34px ' + FONT;
        ctx.strokeStyle = C.void; ctx.lineWidth = 10; ctx.strokeText('SPIN!', cp.x, cp.y + 2); ctx.fillStyle = C.cream; ctx.fillText('SPIN!', cp.x, cp.y + 2);
      }
    }
    ctx.restore();
  }

  var Deck = {
    drawJogCue: drawJogCue,
    // retro body through the camera. ctx: retro layer in logical coords. o: {beat, e, fxOn}
    draw: function (ctx, L, o) {
      var fl = flatCanvas(), f = fl.ctx, d = L.flat.deck, cam = L.cam;
      f.setTransform(1, 0, 0, 1, 0, 0); f.clearRect(0, 0, fl.c.width, fl.c.height);
      f.setTransform(LS, 0, 0, LS, -FX0 * LS, -FY0 * LS); f.imageSmoothingEnabled = false;
      var sl = softLayer(); sl.ctx.setTransform(1, 0, 0, 1, 0, 0); sl.ctx.clearRect(0, 0, sl.c.width, sl.c.height);
      sl.ctx.setTransform(LS, 0, 0, LS, -FX0 * LS, -FY0 * LS);
      var g = f.createLinearGradient(0, d.y, 0, d.y + d.h);
      g.addColorStop(0, '#2c2b31'); g.addColorStop(1, '#3d3c43');
      f.fillStyle = g; rr(f, d.x, d.y, d.w, d.h, d.r); f.fill();
      texture(f, d.x, d.y, d.w, d.h, 0.18);
      f.strokeStyle = '#4a4952'; f.lineWidth = 4; rr(f, d.x + 2, d.y + 2, d.w - 4, d.h - 4, d.r); f.stroke();
      f.fillStyle = '#17161a'; f.fillRect(648 - DECK_EXTENSION, d.y + 10, 4, d.h - 20); f.fillRect(948 + DECK_EXTENSION, d.y + 10, 4, d.h - 20);
      deckHalf(f, L.flat.deckOffset[1], o, 1); deckHalf(f, L.flat.deckOffset[2], o, 2);
      mixerFlat(f, L, o);
      f.save(); f.setTransform(1, 0, 0, 1, 0, 0);
      if ('filter' in f) f.filter = SOFT; else f.globalAlpha = 0.6;
      f.drawImage(sl.c, 0, 0); f.restore();

      // neon underglow rim, colour cycling on the bar
      var rimC = [C.magenta, C.cyan, C.violet, C.laser][mod(Math.floor(o.beat / 4), 4)], kk = Math.exp(-(o.beat - Math.floor(o.beat)) * 6);
      var q0 = L.P(d.x - 14, d.y - 10), q1 = L.P(d.x + d.w + 14, d.y - 10), q2 = L.P(d.x + d.w + 14, d.y + d.h + 4), q3 = L.P(d.x - 14, d.y + d.h + 4);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
      poly(ctx, [[q0.x, q0.y], [q1.x, q1.y], [q2.x, q2.y + 26], [q3.x, q3.y + 26]]);
      ctx.strokeStyle = hexA(rimC, 0.22 + 0.15 * kk); ctx.lineWidth = 40; ctx.stroke();
      ctx.strokeStyle = hexA(rimC, 0.5 + 0.3 * kk); ctx.lineWidth = 10; ctx.stroke();
      ctx.restore();
      // contact shadow + front face (the edge nearest the player)
      var bl = L.P(d.x, d.y), br = L.P(d.x + d.w, d.y), fl0 = L.P(d.x, d.y + d.h), fr0 = L.P(d.x + d.w, d.y + d.h);
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      poly(ctx, [[bl.x - 6, bl.y + 10], [br.x + 6, br.y + 10], [fr0.x + 14, fr0.y + 30], [fl0.x - 14, fl0.y + 30]]); ctx.fill();
      ctx.fillStyle = '#141317'; poly(ctx, [[fl0.x + 10, fl0.y - 4], [fr0.x - 10, fr0.y - 4], [fr0.x - 18, fr0.y + 20], [fl0.x + 18, fl0.y + 20]]); ctx.fill();
      ctx.fillStyle = '#26252b'; ctx.fillRect(fl0.x + 16, fl0.y + 4, fr0.x - fl0.x - 32, 4);

      // scanline warp
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
      var top = Math.floor(L.P(0, d.y).y * LS), bot = Math.ceil(cam.Yf * LS), fw = fl.c.width, fh = fl.c.height, j;
      for (j = top; j <= bot; j++) {
        var u = L.unY((j + 0.5) / LS), sr = Math.floor((u.y - FY0) * LS);
        if (sr < 0 || sr >= fh) continue;
        var x0 = cam.cx + (FX0 - cam.cx) * u.s, x1 = cam.cx + (FX0 + FWL - cam.cx) * u.s;
        ctx.drawImage(fl.c, 0, sr, fw, 1, Math.round(x0 * LS), j, Math.round((x1 - x0) * LS), 1);
      }
      ctx.restore();
    },
    // Knob bodies and their live position indicators.
    drawOverlay: function (ctx, L, knobs) {
      var F = L.flat, R = F.knobR, H = L.knobH;
      ctx.save(); ctx.lineJoin = 'round';
      ctx.font = '12px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ROWS.forEach(function (row) {
        var on = L.rows.indexOf(row) >= 0, fy = F.rowY[row];
        [1, 2].forEach(function (ch) {
          var k = knobs[key(ch, row)] || {}, fx = F.knobX[ch][row], lane = L.lanes[ch][row];
          ctx.fillStyle = on ? C.cream : hexA(C.creamDim, 0.4);
          ctx.fillText(row, lane.x, lane.hitY + 35);
          if (!on) return;
          // body: stacked rims give the cylinder side, then a flat stepped top
          for (var h = 0; h <= H; h += 2) { planeCircle(ctx, L, fx, fy, R, h); ctx.fillStyle = h === 0 ? '#08070a' : '#16151a'; ctx.fill(); }
          planeCircle(ctx, L, fx, fy, R, H); ctx.fillStyle = '#2a2930'; ctx.fill();
          ctx.strokeStyle = '#4a4952'; ctx.lineWidth = 1.5; ctx.stroke();
          planeCircle(ctx, L, fx, fy, R * 0.68, H); ctx.fillStyle = '#34333b'; ctx.fill();
          // scale ticks around the knob (every 30 degrees) so a 30-degree turn has a visible ruler
          ctx.strokeStyle = hexA(C.cream, 0.3); ctx.lineWidth = 1.5; ctx.beginPath();
          for (var t = -3; t <= 3; t++) { var ta = t * Math.PI / 6, p1 = planePt(L, fx, fy, R + 3, ta, 0), p2 = planePt(L, fx, fy, R + 6, ta, 0); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
          ctx.stroke();
          var angle = k.angle || 0;
          var c0 = planePt(L, fx, fy, 0, angle, H), c1 = knobTip(L, lane, angle);
          ctx.strokeStyle = C.void; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.stroke();
          ctx.strokeStyle = C.cream; ctx.lineWidth = 3.5; ctx.stroke();
        });
      });
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------- Note (sharp)
  // CW = cream disc + dark arrow; CCW = dark disc + cream ring + mirrored arrow.
  // Direction reads from arrow shape and fill, never colour alone.
  function curvedArrow(ctx, rad, w, col) {
    var a0 = Math.PI * 0.62, a1 = a0 + Math.PI * 1.45;
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(0, 0, rad, a0, a1 - 0.3); ctx.stroke();
    var px = Math.cos(a1) * rad, py = Math.sin(a1) * rad, tx = -Math.sin(a1), ty = Math.cos(a1), nx = Math.cos(a1), ny = Math.sin(a1);
    var hl = w * 2.3, hw = w * 1.45, bx = px - tx * hl * 0.5, by = py - ty * hl * 0.5;
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(px + tx * hl * 0.65, py + ty * hl * 0.65); ctx.lineTo(bx + nx * hw, by + ny * hw); ctx.lineTo(bx - nx * hw, by - ny * hw); ctx.closePath(); ctx.fill();
  }
  var Note = {
    // o: {r, alpha, side (1|2), tail}
    draw: function (ctx, x, y, dir, o) {
      o = o || {}; var r = o.r || 21;
      ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha; ctx.translate(x, y);
      if (o.tail) {
        var g = ctx.createLinearGradient(0, 0, 0, -90);
        g.addColorStop(0, hexA(C.cream, 0.3)); g.addColorStop(1, hexA(C.cream, 0));
        ctx.fillStyle = g; ctx.fillRect(-5, -90, 10, 90);
      }
      ctx.fillStyle = 'rgba(0,0,0,.6)'; circ(ctx, 0, 3, r + 3); ctx.fill();
      var arrowCol;
      if (dir === 'cw') { ctx.fillStyle = C.cream; circ(ctx, 0, 0, r); ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 3; circ(ctx, 0, 0, r - 1.5); ctx.stroke(); arrowCol = C.ink; }
      else { ctx.fillStyle = C.ink; circ(ctx, 0, 0, r); ctx.fill(); ctx.strokeStyle = C.cream; ctx.lineWidth = 3.5; circ(ctx, 0, 0, r - 2); ctx.stroke(); arrowCol = C.cream; }
      if (dir !== 'cw') ctx.scale(-1, 1);
      curvedArrow(ctx, r * 0.5, r * 0.24, arrowCol);
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------- HitMarker (sharp)
  var HitMarker = {
    // s: {ready 0..1, flashT, flashJ, now, side}
    draw: function (ctx, x, y, s) {
      s = s || {}; var r = s.r || 22, ready = s.ready || 0, k;
      ctx.save();
      ctx.strokeStyle = hexA(s.side === 1 ? C.magenta : C.cyan, 0.55 + 0.45 * ready); ctx.lineWidth = 2; circ(ctx, x, y, r); ctx.stroke();
      ctx.strokeStyle = hexA(C.cream, 0.6 + 0.4 * ready); ctx.lineWidth = 3; ctx.beginPath();
      for (k = 0; k < 4; k += 2) { var a = k * Math.PI / 2; ctx.moveTo(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3)); ctx.lineTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6)); }
      ctx.stroke();
      var fp = s.flashT == null ? 1 : (s.now - s.flashT) / 0.3;
      if (fp >= 0 && fp < 1) { ctx.fillStyle = hexA(JCOL[s.flashJ] || C.cream, 0.55 * (1 - fp)); circ(ctx, x, y, r + 2); ctx.fill(); }
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------- HitFX (sharp)
  function HitFX() { this.list = []; }
  HitFX.prototype.spawn = function (j, x, y, side, sub) { this.list.push({ j: j, x: x, y: y, side: side, sub: sub, t: 0 }); };
  HitFX.prototype.update = function (dt) { this.list.forEach(function (f) { f.t += dt; }); this.list = this.list.filter(function (f) { return f.t < 0.75; }); };
  HitFX.prototype.draw = function (ctx) {
    ctx.save();
    this.list.forEach(function (f) {
      var col = JCOL[f.j], t = f.t, k;
      if (f.j !== 'miss') {
        var p = clamp(t / 0.35, 0, 1), a = 1 - p;
        ctx.strokeStyle = hexA(col, a); ctx.lineWidth = f.j === 'perfect' ? 5 : 3;
        if (f.j === 'perfect') {
          ctx.lineWidth = 3; ctx.beginPath();
          for (k = 0; k < 10; k++) { var an = k / 10 * Math.PI * 2 + 0.2; ctx.moveTo(f.x + Math.cos(an) * (30 + p * 20), f.y + Math.sin(an) * (30 + p * 20)); ctx.lineTo(f.x + Math.cos(an) * (40 + p * 34), f.y + Math.sin(an) * (40 + p * 34)); }
          ctx.stroke();
        }
      } else if (t < 0.45) {
        var m = 1 - t / 0.45; ctx.strokeStyle = hexA(C.miss, m); ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(f.x - 13, f.y - 13); ctx.lineTo(f.x + 13, f.y + 13); ctx.moveTo(f.x + 13, f.y - 13); ctx.lineTo(f.x - 13, f.y + 13); ctx.stroke();
      }
      var label = f.j === 'perfect' ? 'PERFECT' : f.j === 'good' ? 'GOOD' : 'MISS';
      var ta = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.25, sc = t < 0.08 ? 1.3 - t / 0.08 * 0.3 : 1;
      var tx = f.x, ty = f.y + 55 + t * 16;
      ctx.save(); ctx.translate(tx, ty); ctx.scale(sc, sc); ctx.globalAlpha = clamp(ta, 0, 1);
      ctx.font = '16px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.strokeStyle = C.void; ctx.lineWidth = 6; ctx.strokeText(label, 0, 0); ctx.fillStyle = col; ctx.fillText(label, 0, 0);
      if (f.sub) { ctx.font = '8px ' + FONT; ctx.strokeText(f.sub, 0, 18); ctx.fillText(f.sub, 0, 18); }
      ctx.restore();
    });
    ctx.restore();
  };

  // ---------------------------------------------------------------- NoteLanes (sharp)
  var NoteLanes = {
    draw: function (ctx, L, o) {
      var width = L.laneWidth;
      ctx.save();
      L.rows.forEach(function (row) {
        [1, 2].forEach(function (ch) {
          var lane = L.lanes[ch][row], left = lane.x - width / 2;
          var bottom = lane.hitY;
          var band = ctx.createLinearGradient(0, 0, 0, bottom);
          band.addColorStop(0, 'rgba(11,8,20,.58)'); band.addColorStop(1, 'rgba(11,8,20,.83)');
          ctx.fillStyle = band; ctx.fillRect(left, 0, width, bottom);
          var accent = ch === 1 ? C.magenta : C.cyan;
          var rails = ctx.createLinearGradient(0, 0, 0, bottom);
          rails.addColorStop(0, hexA(accent, 0.22)); rails.addColorStop(1, hexA(accent, 0.7));
          ctx.fillStyle = rails;
          ctx.fillRect(left, 0, 2, bottom); ctx.fillRect(left + width - 2, 0, 2, bottom);

          if (!o.spb) return;
          for (var beat = Math.ceil(o.time / o.spb); beat * o.spb <= o.time + o.approach; beat++) {
            var y = noteY(L, lane, beat * o.spb - o.time, o.approach, o.traces && o.traces[key(ch, row)]);
            if (y < 0 || y > bottom) continue;
            var downbeat = beat % 4 === 0;
            ctx.fillStyle = hexA(C.cream, downbeat ? 0.42 : 0.18);
            ctx.fillRect(left + 4, y, width - 8, downbeat ? 3 : 2);
          }
        });
      });
      ctx.restore();
    },
    drawGuides: function (ctx, L, upcoming, traces) {
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
      L.rows.forEach(function (row) {
        [1, 2].forEach(function (ch) {
          var id = key(ch, row), lane = L.lanes[ch][row], trace = traces && traces[id];
          var color = ch === 1 ? C.magenta : C.cyan;
          var absolute = isPositionTrace(trace), bottom = guideBottom(L, lane, trace);
          ctx.beginPath();
          if (absolute) {
            var x = lane.x + positionOffset(trace.position, lane);
            ctx.moveTo(x, bottom);
            for (var change of trace.changes) {
              var y = lerp(bottom, L.spawnY, change.fraction);
              ctx.lineTo(x, y);
              x = lane.x + positionOffset(change.position, lane);
              ctx.lineTo(x, y);
            }
            ctx.lineTo(x, L.spawnY);
          } else {
            var segments = trace ? trace.length - 1 : 1;
            ctx.moveTo(lane.x, bottom);
            for (var i = 1; i <= segments; i++) {
              var f = i / segments;
              ctx.lineTo(lane.x + traceOffset(trace, f, L.laneWidth, lane), lerp(bottom, L.spawnY, f));
            }
          }
          var moving = upcoming[id] || (absolute ? trace.changes.length : trace);
          ctx.strokeStyle = hexA(color, 0.30); ctx.lineWidth = moving ? 10 : 5; ctx.stroke();
          ctx.strokeStyle = moving ? color : hexA(color, 0.74);
          ctx.lineWidth = moving ? 4 : 2; ctx.stroke();
        });
      });
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------- HUD (sharp)
  function plate(ctx, x, y, w, h) {
    var c = 10;
    poly(ctx, [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]]);
    ctx.fillStyle = 'rgba(11,8,20,.82)'; ctx.fill();
    ctx.strokeStyle = '#6a6478'; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = hexA(C.violet, 0.8); ctx.lineWidth = 2;
    poly(ctx, [[x + c + 4, y + 5], [x + w - c - 4, y + 5], [x + w - 5, y + c + 4], [x + w - 5, y + h - c - 4], [x + w - c - 4, y + h - 5], [x + c + 4, y + h - 5], [x + 5, y + h - c - 4], [x + 5, y + c + 4]]); ctx.stroke();
  }
  // Top left: score. Top right: webcam slot.
  var CAM = { x: W - 342, y: 20, w: 320, h: 180 };   // 16:9 inner frame for the player's live webcam
  var HYPE_BAR = { x: CAM.x - 76, y: CAM.y + 27, w: 52, h: CAM.h - 51 };

  function drawHypeMeter(ctx, frame) {
    var r = HYPE_BAR, color = [C.violet, C.cyan, C.amber, C.magenta][frame.tier];
    var x = r.x + 9, y = r.y + 5, w = r.w - 18, h = r.h - 10;
    var fill = h * clamp(frame.level / 100, 0, 1);
    ctx.save();
    plate(ctx, r.x - 8, CAM.y - 12, r.w + 16, CAM.h + 24);
    ctx.fillStyle = C.ink; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = frame.celebration ? C.cream : color;
    ctx.fillRect(x, y + h - fill, w, fill);
    if (fill > 0) {
      ctx.fillStyle = hexA(C.cream, 0.5); ctx.fillRect(x, y + h - fill, w, Math.min(fill, 3));
    }
    for (var i = 1; i <= 3; i++) {
      ctx.fillStyle = hexA(C.cream, 0.5); ctx.fillRect(x - 3, y + h * i / 4, w + 6, 1);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.cream;
    ctx.font = '10px ' + FONT; ctx.fillText('HYPE', r.x + r.w / 2, CAM.y + 9);
    ctx.font = '12px ' + FONT; ctx.fillText(Math.floor(frame.level) + '%', r.x + r.w / 2, CAM.y + CAM.h - 7);
    ctx.restore();
  }

  function drawHypeTempo(ctx, frame) {
    if (!frame.windows) return;
    var x = HYPE_BAR.x, y = CAM.y + CAM.h + 33, w = CAM.x + CAM.w - x, h = 18;
    var width = w - 88, edge = frame.cueLine / 100;
    var good = frame.windows.good, perfect = frame.windows.perfect;
    ctx.save();
    plate(ctx, x - 8, y - 7, w + 20, h + 14);
    ctx.fillStyle = C.ink; ctx.fillRect(x, y, width, h);
    ctx.fillStyle = hexA(C.cyan, 0.27); ctx.fillRect(x + width * good.left / 100, y, width * good.width / 100, h);
    ctx.fillStyle = hexA(C.amber, 0.32); ctx.fillRect(x + width * perfect.left / 100, y, width * perfect.width / 100, h);
    ctx.fillStyle = C.amber; ctx.fillRect(x + width * edge, y - 2, 2, h + 4);
    frame.bars.forEach(function (bar) {
      ctx.fillStyle = bar.zone === 'perfect' ? C.amber : C.cyan;
      ctx.fillRect(x + width * bar.left / 100 - 4, y + 3, 4, h - 6);
    });
    ctx.font = '9px ' + FONT; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.cream;
    ctx.fillText(frame.tempo + ' BPM', x + w, y + h / 2);
    ctx.restore();
  }

  function createHypeConfetti(id) {
    var random = rng(id + 30), colors = [C.cyan, C.amber, C.magenta, C.violet, C.cream, C.laser];
    return Array.from({ length: 220 }, function (_, index) {
      return {
        color: colors[index % colors.length], size: 5 + random() * 9,
        delay: random() ** 2 * 0.65, landingX: random() * W,
        launchSpeed: 58 + random() * 114, fallSpeed: 100 + random() * 86,
        spin: (random() - 0.5) * 8, phase: random() * Math.PI * 2,
        foreground: index % 3 !== 0
      };
    });
  }

  function drawHypeConfetti(ctx, confetti, celebration, foreground) {
    var x = HYPE_BAR.x + HYPE_BAR.w / 2, y = HYPE_BAR.y - 12;
    var gravity = 560;
    ctx.save();
    ctx.globalAlpha = clamp((celebration.duration - celebration.elapsed) / 0.65, 0, 1);
    confetti.forEach(function (piece) {
      var age = celebration.elapsed - piece.delay;
      if (age < 0 || piece.foreground !== foreground) return;
      // Fan out quickly, then ease into a slow flutter at the falling speed.
      var ballisticTime = Math.min(age, (piece.launchSpeed + piece.fallSpeed) / gravity);
      var drop = -piece.launchSpeed * ballisticTime + gravity * ballisticTime * ballisticTime / 2
        + piece.fallSpeed * (age - ballisticTime);
      var drift = Math.sin(age * 3 + piece.phase) * 20 * Math.min(age, 1);
      var px = lerp(x, piece.landingX, 1 - Math.exp(-1.1 * age)) + drift;
      var flip = 0.25 + 0.75 * Math.abs(Math.cos(age * 6 + piece.phase));
      ctx.save();
      ctx.translate(px, y + drop);
      ctx.rotate(age * piece.spin + piece.phase);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.size / 2, -piece.size * flip / 2, piece.size, piece.size * flip);
      ctx.restore();
    });
    ctx.restore();
  }
  function drawRecordedFaders(ctx, guide) {
    var faders = [['A VOL', 'a.volume', 16383], ['B VOL', 'b.volume', 16383], ['MASTER', 'mixer.master', 16383]];
    ctx.save();
    plate(ctx, 22, 120, 330, 54);
    ctx.font = '8px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    faders.forEach(function (fader, i) {
      var x = 44 + i * 101, y = 151, w = 78, key = fader[1];
      var target = x + w * clamp((guide.target[key] ?? fader[2]) / 16383, 0, 1);
      ctx.fillStyle = C.cream; ctx.fillText(fader[0], x + w / 2, 136);
      ctx.fillStyle = '#555267'; ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = C.amber; ctx.fillRect(target - 2, y - 6, 4, 14);
      if (Number.isFinite(guide.live?.[key])) {
        var live = x + w * clamp(guide.live[key] / 16383, 0, 1);
        ctx.fillStyle = C.cyan; ctx.fillRect(live - 2, y + 6, 4, 5);
      }
    });
    ctx.restore();
  }

  var HUD = {
    cam: CAM,
    draw: function (ctx, s) {
      ctx.save(); ctx.textBaseline = 'alphabetic';
      plate(ctx, 22, 20, 330, 92);
      ctx.font = '12px ' + FONT; ctx.fillStyle = C.creamDim; ctx.textAlign = 'left'; ctx.fillText('SCORE', 44, 50);
      ctx.font = '30px ' + FONT; ctx.fillStyle = C.cream; ctx.fillText(pad(s.score, 7), 44, 93);
      if (s.award) {
        var age = s.clock - s.award.at;
        var y = 50 - (s.reducedMotion ? 0 : age * 6);
        ctx.save();
        ctx.globalAlpha = clamp((1 - age) / 0.3, 0, 1);
        ctx.textAlign = 'right'; ctx.lineWidth = 4; ctx.strokeStyle = C.void;
        ctx.font = '13px ' + FONT; ctx.fillStyle = C.amber;
        var multiplierLabel = 'x' + s.award.multiplier;
        var pointsX = 330 - ctx.measureText(multiplierLabel).width - 12;
        ctx.strokeText(multiplierLabel, 330, y); ctx.fillText(multiplierLabel, 330, y);
        ctx.font = '16px ' + FONT; ctx.fillStyle = C.laser;
        var label = '+' + s.award.points;
        ctx.strokeText(label, pointsX, y); ctx.fillText(label, pointsX, y);
        ctx.restore();
      }
      ctx.restore();
    },
    // video: an HTMLVideoElement (or null for the empty slot).
    drawWebcam: function (ctx, video, o) {
      o = o || {}; var r = CAM, k;
      ctx.save();
      plate(ctx, r.x - 12, r.y - 12, r.w + 24, r.h + 24);
      ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      var live = video && video.readyState >= 2 && video.videoWidth > 0;
      if (live) {
        // cover-fit, mirrored like a selfie view so moving your hand left moves it left on screen
        var vw = video.videoWidth, vh = video.videoHeight, sc = Math.max(r.w / vw, r.h / vh), dw = vw * sc, dh = vh * sc;
        ctx.save();
        var mirror = o.mirror !== false, left = (r.w - dw) / 2, top = (r.h - dh) / 2;
        if (mirror) { ctx.translate(r.x + r.w, r.y); ctx.scale(-1, 1); ctx.drawImage(video, left, top, dw, dh); }
        else ctx.drawImage(video, r.x + left, r.y + top, dw, dh);
        ctx.restore();
        if (o.effects) {
          ctx.save();
          ctx.translate(r.x, r.y);
          o.effects(ctx, { width: r.w, height: r.h, drawWidth: dw, drawHeight: dh, left: left, top: top, mirror: mirror }, o.hype, o.dt, o.reducedMotion);
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(0,0,0,.12)'; for (k = r.y; k < r.y + r.h; k += 4) ctx.fillRect(r.x, k, r.w, 1);   // light scanlines
      } else {
        ctx.fillStyle = '#0d0a14'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = 'rgba(246,236,214,.04)'; for (k = r.y; k < r.y + r.h; k += 4) ctx.fillRect(r.x, k, r.w, 2);
        var cx = r.x + r.w / 2, cy = r.y + r.h / 2 - 14;
        ctx.strokeStyle = hexA(C.creamDim, 0.6); ctx.lineWidth = 3;
        rr(ctx, cx - 30, cy - 18, 46, 36, 4); ctx.stroke();
        poly(ctx, [[cx + 18, cy - 6], [cx + 32, cy - 14], [cx + 32, cy + 14], [cx + 18, cy + 6]]); ctx.stroke();
        ctx.font = '11px ' + FONT; ctx.textAlign = 'center'; ctx.fillStyle = C.creamDim; ctx.fillText('WEBCAM', cx, cy + 46);
        ctx.font = '8px ' + FONT; ctx.fillStyle = hexA(C.creamDim, 0.6); ctx.fillText('NO FEED', cx, cy + 64);
      }
      // LIVE tag: shape + word, not colour alone
      ctx.fillStyle = 'rgba(11,8,20,.8)'; ctx.fillRect(r.x + 10, r.y + 10, live ? 76 : 64, 22);
      ctx.fillStyle = live ? (Math.floor((o.t || 0) * 2) % 2 ? C.magenta : hexA(C.magenta, 0.5)) : hexA(C.creamDim, 0.4);
      ctx.beginPath(); ctx.arc(r.x + 22, r.y + 21, 5, 0, Math.PI * 2); ctx.fill();
      ctx.font = '9px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = live ? C.cream : C.creamDim;
      ctx.fillText(live ? 'LIVE' : 'OFF', r.x + 34, r.y + 22);
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------- Title (sharp layer, pixel-built)
  // The MAINSTAGE logo. Built at low resolution (chunky stepped pixels) from the display face:
  // a deep stepped extrusion, a chrome face (cream to amber to magenta, cut by horizontal slits),
  // a neon outline, then upscaled with no smoothing and given a soft additive halo.
  // Pulses on the kick; a glint sweeps across every bar.
  var _tt = {};
  function titleBuffers(key, w, h) {
    var b = _tt[key];
    if (!b || b.c.width !== w || b.c.height !== h) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var m = document.createElement('canvas'); m.width = w; m.height = h;
      b = _tt[key] = { c: c, x: c.getContext('2d'), m: m, mx: m.getContext('2d') };
    }
    return b;
  }
  var Title = {
    // o: {text='MAINSTAGE', sub='DJ RHYTHM GAME', size=96 (cap height in px), px=4 (pixel size), beat, t, align='center'}
    draw: function (ctx, cx, cy, o) {
      o = o || {};
      var text = o.text || 'MAINSTAGE', sub = o.sub == null ? 'DJ RHYTHM GAME' : o.sub, px = o.px || 4, size = o.size || 96;
      var beat = o.beat || 0, bp = beat - Math.floor(beat), kick = Math.exp(-bp * 7), t = o.t || 0;
      var fs = Math.round(size / px), depth = Math.max(3, Math.round(fs * 0.22));
      var probe = titleBuffers('probe', 8, 8).x; probe.font = fs + 'px ' + FONT;
      var tw = Math.ceil(probe.measureText(text).width), pad = depth + 6;
      var w = tw + pad * 2, h = fs + pad * 2 + depth, B = titleBuffers('main', w, h), x = B.x, mx = B.mx;
      if (o.maxWidth && w * px > o.maxWidth) px = o.maxWidth / w;   // never wider than its slot
      x.clearRect(0, 0, w, h); mx.clearRect(0, 0, w, h);
      x.imageSmoothingEnabled = false; x.textBaseline = 'top'; x.textAlign = 'left'; x.font = fs + 'px ' + FONT;
      mx.textBaseline = 'top'; mx.font = fs + 'px ' + FONT;
      var ox = pad, oy = pad;
      // stepped extrusion, darkest at the back
      for (var k = depth; k >= 1; k--) {
        var f = k / depth;
        x.fillStyle = 'rgb(' + Math.round(40 + 60 * (1 - f)) + ',' + Math.round(12 + 14 * (1 - f)) + ',' + Math.round(70 + 60 * (1 - f)) + ')';
        x.fillText(text, ox + k, oy + k);
      }
      // neon outline (one pixel around the face)
      x.fillStyle = hexA(C.magenta, 1);
      [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]].forEach(function (d) { x.fillText(text, ox + d[0], oy + d[1]); });
      // chrome face built in a mask, then cut with slits
      mx.fillStyle = '#fff'; mx.fillText(text, ox, oy);
      mx.globalCompositeOperation = 'source-in';
      var g = mx.createLinearGradient(0, oy, 0, oy + fs);
      g.addColorStop(0, C.cream); g.addColorStop(0.45, '#ffe2a8'); g.addColorStop(0.5, C.amber); g.addColorStop(0.75, C.magenta); g.addColorStop(1, C.violet);
      mx.fillStyle = g; mx.fillRect(0, 0, w, h);
      // horizontal slits through the lower half (classic arcade chrome)
      mx.globalCompositeOperation = 'destination-out';
      for (var sl = 0; sl < 3; sl++) mx.fillRect(0, oy + Math.round(fs * (0.58 + sl * 0.13)), w, 1);
      // glint sweeping across once per bar
      mx.globalCompositeOperation = 'source-atop';
      var gx = ((mod(beat, 4) / 4) * 1.6 - 0.3) * w;
      mx.fillStyle = 'rgba(255,255,255,.85)';
      mx.beginPath(); mx.moveTo(gx, 0); mx.lineTo(gx + fs * 0.35, 0); mx.lineTo(gx + fs * 0.35 - h * 0.5, h); mx.lineTo(gx - h * 0.5, h); mx.closePath(); mx.fill();
      mx.globalCompositeOperation = 'source-over';
      x.drawImage(B.m, 0, 0);
      // upscale: chunky pixels + halo
      var sc = px * (1 + 0.035 * kick), dw = w * sc, dh = h * sc, dx = cx - (pad + tw / 2) * sc, dy = cy - (pad + fs / 2) * sc - (sub ? size * 0.25 : 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.2 + 0.3 * kick; ctx.drawImage(B.c, dx - dw * 0.04, dy - dh * 0.08, dw * 1.08, dh * 1.16);
      ctx.globalAlpha = 0.14; ctx.drawImage(B.c, dx - dw * 0.1, dy - dh * 0.25, dw * 1.2, dh * 1.5);
      ctx.restore();
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(B.c, dx, dy, dw, dh); ctx.restore();
      // subtitle plate (optional) + EQ bars hanging below the logo, reaching down into the screen
      var below = dy + (pad + fs + depth) * sc + size * 0.16;
      if (sub) {
        var sfs = Math.max(10, Math.round(size * 0.16)), sy = below + sfs;
        ctx.save(); ctx.font = sfs + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var sw = ctx.measureText(sub).width + sfs * 2.4;
        ctx.fillStyle = 'rgba(11,8,20,.85)'; ctx.fillRect(cx - sw / 2, sy - sfs, sw, sfs * 2);
        ctx.strokeStyle = C.cyan; ctx.lineWidth = 2; ctx.strokeRect(cx - sw / 2 + 0.5, sy - sfs + 0.5, sw - 1, sfs * 2 - 1);
        ctx.fillStyle = C.cream; ctx.fillText(sub, cx, sy + 1);
        ctx.restore();
        below = sy + sfs * 1.6;
      }
      if (o.eq) {
        var bars = o.eqBars || 32, span = dw * (o.eqSpan || 1), bw = span / bars, reach = o.eqDepth || size * 2.4, step = 9;
        ctx.save();
        for (var i = 0; i < bars; i++) {
          var mid = 1 - Math.abs(i - (bars - 1) / 2) / (bars / 2);          // taller toward the centre
          var hv = (0.25 + 0.75 * Math.abs(Math.sin(i * 1.3 + Math.floor(beat) * 0.7))) * (0.45 + 0.55 * kick) * (0.45 + 0.55 * mid) * reach;
          var col = [C.magenta, C.violet, C.cyan][i % 3];
          for (var yy = 0; yy < hv; yy += step) {
            ctx.fillStyle = hexA(col, 0.95 * (1 - 0.75 * yy / reach));  // fades as it reaches into the floor
            ctx.fillRect(cx - span / 2 + i * bw + 1, below + yy, bw - 3, step - 3);
          }
        }
        ctx.restore();
      }
    }
  };

  // ---------------------------------------------------------------- Title backdrop (shared by title + track select)
  // Same stage on both pages so the cut from "turn any knob" to track select is seamless.
  function TitleBackdrop() { this.t = 0; this.floorTravel = 0; }
  TitleBackdrop.prototype.draw = function (stage, dt, tAbs, bpm, e, warp) {
    this.t += dt;
    var tempo = (bpm || 128) / 60, beat = this.t * tempo;
    this.floorTravel += dt * tempo * (warp || 0) * 7;
    var vo = { t: tAbs, e: e == null ? 0.5 : e, beat: beat, road: true, floorTravel: this.floorTravel };
    stage.beginLow();
    Venue.draw(stage.low, vo); Venue.drawBeams(stage.low, vo); bloom(stage.low, 446, 0.5);
    Venue.drawBooth(stage.low, vo); stage.endLow();
    var s = stage.sharp; s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, W, H);
    var vg = s.createRadialGradient(800, 400, 120, 800, 400, 760); vg.addColorStop(0, 'rgba(11,8,20,.6)'); vg.addColorStop(1, 'rgba(11,8,20,0)');
    s.fillStyle = vg; s.fillRect(0, 0, W, H);
    return beat;
  };

  var TitleScreen = {
    create: function (rootEl, opts) {
      opts = opts || {};
      var stage = createStage(rootEl), bd = opts.backdrop || new TitleBackdrop(), clock = 0, started = false;
      function start() {
        if (started) return;
        started = true; if (opts.onStart) opts.onStart();
      }
      function onKey(e) {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab' || e.target.closest?.('button,a,input,select,summary')) return;
        e.preventDefault(); start();
      }
      if (opts.keyboard !== false) window.addEventListener('keydown', onKey);
      stage.el.addEventListener('click', start);
      stage.run(function (dt, tAbs) {
        clock += dt;
        var beat = bd.draw(stage, dt, tAbs, opts.bpm, 0.5), s = stage.sharp;
        Title.draw(s, 800, 300, { text: 'MAINSTAGE', sub: '', size: 110, px: 5, maxWidth: 1240, beat: beat, t: clock });
        s.save(); s.font = '16px ' + FONT; s.textAlign = 'center';
        s.fillStyle = Math.floor(clock * 1.5) % 2 ? C.cream : hexA(C.cream, 0.35);
        s.fillText('TURN ANY KNOB TO START', 800, 800);
        if (clock < 0.5 && opts.fadeIn !== false) { s.fillStyle = hexA(C.void, 1 - clock / 0.5); s.fillRect(0, 0, W, H); }
        s.restore();
        if (opts.preview && clock >= 2.6) start();
      }, { timeline: true });
      return { el: stage.el, start: start, destroy: function () {
        stage.stop(); window.removeEventListener('keydown', onKey); stage.el.remove();
      } };
    }
  };

  // ---------------------------------------------------------------- Vinyl (8-bit spinning record)
  // Drawn small (64 px) and upscaled with no smoothing, like the title, so it reads as pixel art.
  var ICONS = {
    // handheld mic, angled: ball grille (holes), collar, handle, curled cable
    mic:  ['........###.', '.......#####', '.......#.#.#', '.......##.##', '......#.###.', '.....###....', '....###.....', '...###......', '..###.......', '.##...#.....', '#...##......', '.###........'],
    star: ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '##...##'],
    bolt: ['....##.', '...##..', '..##...', '.######', '...##..', '..##...', '.##....']
  };
  var _vin = null;
  function vinylBuffer() { if (!_vin) { var c = document.createElement('canvas'); c.width = c.height = 64; _vin = { c: c, x: c.getContext('2d') }; } return _vin; }
  var Vinyl = {
    // o: {color, icon: 'mic'|'star'|'bolt', angle, size (screen px), glow 0..1, beat}
    draw: function (ctx, cx, cy, o) {
      var B = vinylBuffer(), x = B.x, D = 64, r = 30, a = o.angle || 0, k;
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, D, D); x.imageSmoothingEnabled = false;
      x.translate(D / 2, D / 2);
      x.fillStyle = '#07050b'; circ(x, 1, 2, r); x.fill();                       // drop shadow
      x.fillStyle = '#16121e'; circ(x, 0, 0, r); x.fill();
      x.strokeStyle = '#2c2638'; x.lineWidth = 1;
      [27, 24, 21, 18, 15].forEach(function (gr) { circ(x, 0, 0, gr); x.stroke(); });   // grooves
      x.strokeStyle = hexA(o.color, 0.9); x.lineWidth = 1; circ(x, 0, 0, r - 0.5); x.stroke();   // coloured rim
      // static sheen (light doesn't spin), two wedges
      x.fillStyle = 'rgba(246,236,214,.22)';
      [-0.9, 2.25].forEach(function (s0) { x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, r - 2, s0, s0 + 0.45); x.closePath(); x.fill(); });
      x.fillStyle = '#16121e'; circ(x, 0, 0, 16); x.fill();
      // spinning parts: groove glints, label, icon
      x.rotate(a);
      x.strokeStyle = 'rgba(246,236,214,.55)'; x.lineWidth = 1;
      [[26, 0.2], [22, 2.4], [17, 4.1]].forEach(function (gl) { x.beginPath(); x.arc(0, 0, gl[0], gl[1], gl[1] + 0.5); x.stroke(); });
      x.fillStyle = o.color; circ(x, 0, 0, 14.5); x.fill();
      x.strokeStyle = 'rgba(11,8,20,.55)'; circ(x, 0, 0, 13); x.stroke();
      x.rotate(-a);   // icon stays upright so it always reads; grooves and glints carry the spin
      var ic = ICONS[o.icon] || ICONS.star, ih = ic.length, iw = ic[0].length;
      x.fillStyle = C.ink;
      for (var j = 0; j < ih; j++) for (k = 0; k < iw; k++) if (ic[j][k] === '#') x.fillRect((k - iw / 2) * 2, (j - ih / 2) * 2, 2, 2);   // 2x pixel icon
      x.setTransform(1, 0, 0, 1, 0, 0);
      var size = o.size || 300, glow = o.glow || 0;
      ctx.save();
      if (glow > 0) {
        ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = 0.45 * glow; ctx.drawImage(B.c, cx - size * 0.62, cy - size * 0.62, size * 1.24, size * 1.24);
        ctx.globalAlpha = 0.2 * glow; ctx.drawImage(B.c, cx - size * 0.8, cy - size * 0.8, size * 1.6, size * 1.6);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      ctx.imageSmoothingEnabled = false; ctx.drawImage(B.c, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------- TrackSelect page
  // After the title. Three spinning records (RAP, POP, EDM) over the same backdrop. The selected one is
  // bigger, glows and spins on its tempo; the backdrop's beat follows the selected track's BPM.
  // Controller: turn any knob (or the browse knob) to move, press LOAD (or call confirm) to mix.
  var TRACKS = [
    { id: 'rap', name: 'RAP', color: C.amber, icon: 'mic', bpm: 90 },
    { id: 'pop', name: 'POP', color: C.magenta, icon: 'star', bpm: 118 },
    { id: 'edm', name: 'EDM', color: C.cyan, icon: 'bolt', bpm: 128 }
  ];
  function drawPixelArrow(ctx, x, y, dir, size, col) {
    var p = size / 5; ctx.fillStyle = col;
    for (var i = 0; i < 5; i++) { var hgt = (5 - i) * 2 - 1; ctx.fillRect(x + dir * i * p - p / 2, y - hgt * p / 2, p, hgt * p); }
  }
  var TrackSelect = {
    // opts: {tracks, index, onChange(track, i), onConfirm(track, i), keyboard=true}
    create: function (rootEl, opts) {
      opts = opts || {};
      var tracks = opts.tracks || TRACKS, sel = opts.index || 0, stage = createStage(rootEl), bd = opts.backdrop || new TitleBackdrop();
      var anim = tracks.map(function (_, i) { return { angle: i, grow: i === sel ? 1 : 0 }; });
      var acc = 0, lastPos = {}, confirmT = -9, clock = 0, slots = [400, 800, 1200], discY = 520;
      var recordPose;
      var INTRO = opts.intro === false ? 0 : 1.2;
      function eo(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
      var confirmed = false, confirmDelay = opts.confirmDelay || 0;
      function select(i) {
        if (clock < INTRO || (confirmed && confirmDelay)) return;
        i = mod(i, tracks.length); if (i === sel) return;
        sel = i; if (opts.onChange) opts.onChange(tracks[sel], sel);
      }
      function confirm() {
        if (clock < INTRO || (confirmed && confirmDelay) || clock - confirmT < 0.8) return;
        confirmT = clock;
        confirmed = true;
        if (!confirmDelay && opts.onConfirm) opts.onConfirm(tracks[sel], sel);
      }
      function knob(ev) {
        var d = 0, id = ev.channel + ':' + ev.row;
        if (typeof ev.delta === 'number') d = ev.delta;
        else if (typeof ev.position === 'number') { if (lastPos[id] != null) d = ev.position - lastPos[id]; lastPos[id] = ev.position; }
        acc += d;
        if (acc > 0.06) { select(sel + 1); acc = 0; } else if (acc < -0.06) { select(sel - 1); acc = 0; }
      }
      var jogR = 0, jogRT = 0;
      // jog({ side: 'left' | 'right', delta }): left wheel browses (clockwise = right), right wheel selects
      // once it has spun about a quarter turn in either direction within half a second
      function jog(ev) {
        var d = ev.delta || 0;
        if (ev.side === 'left' || ev.side === 1) { acc += d; if (acc > 0.06) { select(sel + 1); acc = 0; } else if (acc < -0.06) { select(sel - 1); acc = 0; } }
        else { if (clock - jogRT > 0.5) jogR = 0; jogRT = clock; jogR += Math.abs(d); if (jogR > 0.25 && clock - confirmT > 0.8) { jogR = 0; confirm(); } }
      }
      function onKey(e) {
        if (e.repeat || e.target.closest?.('button,a,input,select,summary')) return;
        if (e.key === 'ArrowRight') { select(sel + 1); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { select(sel - 1); e.preventDefault(); }
        else if (e.key === 'Enter' || e.key === ' ') { confirm(); e.preventDefault(); }
      }
      if (opts.keyboard !== false) window.addEventListener('keydown', onKey);
      stage.el.addEventListener('click', function (e) {
        var r = stage.el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
        for (var i = 0; i < slots.length; i++) if (Math.hypot(x - slots[i], y - discY) < 170) { if (i === sel) confirm(); else select(i); return; }
      });
      stage.run(function (dt, tAbs) {
        clock += dt;
        if (opts.preview && clock >= 1.9 && clock - dt < 1.9) select(sel - 1);
        if (opts.preview && clock >= 3 && confirmT < 0) confirm();
        var warp = INTRO ? Math.pow(Math.max(0, 1 - clock / INTRO), 2) : 0;
        var tr = tracks[sel], beat = bd.draw(stage, dt, tAbs, tr.bpm, 0.55, warp), bp = beat - Math.floor(beat), kick = Math.exp(-bp * 7), s = stage.sharp;
        var pl = INTRO ? eo(clock / 0.7) : 1;   // logo glides up from its title-screen spot
        Title.draw(s, 800, lerp(300, 118, pl), { text: 'MAINSTAGE', sub: '', size: lerp(110, 84, pl), px: 5, maxWidth: lerp(1240, 980, pl), beat: beat, t: clock });
        // plate: CHOOSE YOUR TRACK
        var pb = INTRO ? eo((clock - 0.35) / 0.4) : 1;   // banner drops in
        s.save(); s.globalAlpha = pb; s.translate(0, (1 - pb) * -300); s.font = '28px ' + FONT; s.textAlign = 'center'; s.textBaseline = 'middle';
        var pw = s.measureText('CHOOSE YOUR TRACK').width + 72;
        s.fillStyle = 'rgba(11,8,20,.85)'; s.fillRect(800 - pw / 2, 236, pw, 60);
        s.strokeStyle = C.cyan; s.lineWidth = 3; s.strokeRect(800 - pw / 2 + 1.5, 237.5, pw - 3, 57);
        s.fillStyle = C.cream; s.fillText('CHOOSE YOUR TRACK', 800, 267); s.restore();
        tracks.forEach(function (t, i) {
          var a = anim[i], on = i === sel;
          a.grow += ((on ? 1 : 0) - a.grow) * Math.min(1, dt * 8);
          var pr = INTRO ? eo((clock - 0.5 - i * 0.12) / 0.5) : 1;            // records fly up into place, staggered
          a.angle += dt * (on ? t.bpm / 60 * Math.PI * 0.5 : 0.35) + dt * 14 * (1 - pr);   // selected spins on its tempo
          var size = (230 + 90 * a.grow + (on ? 10 * kick : 0)) * lerp(1.45, 1, pr);
          var y = discY - 18 * a.grow + (on ? -4 * kick : 0) + (1 - pr) * 620;
          var pop = on ? Math.max(0, 1 - (clock - confirmT) / 0.5) : 0;
          if (on) recordPose = { x: slots[i], y: y, angle: a.angle, size: size * (1 + 0.15 * pop) };
          var floorY = discY + 185;
          s.save();
          s.fillStyle = hexA(C.void, (on ? 0.72 : 0.46) * pr);
          s.beginPath(); s.ellipse(slots[i], floorY, size * 0.44, size * 0.052, 0, 0, Math.PI * 2); s.fill(); s.restore();
          if (on) {   // spotlight ring on the floor under the selected record
            s.save(); s.globalCompositeOperation = 'lighter';
            var g = s.createRadialGradient(slots[i], floorY, 10, slots[i], floorY, size * 0.75);
            g.addColorStop(0, hexA(t.color, 0.45 + 0.25 * kick)); g.addColorStop(1, hexA(t.color, 0));
            s.globalAlpha = pr;
            s.fillStyle = g; s.beginPath(); s.ellipse(slots[i], floorY, size * 0.75, size * 0.17, 0, 0, Math.PI * 2); s.fill(); s.restore();
          }
          s.save(); s.globalAlpha = on ? 1 : 0.88;
          Vinyl.draw(s, slots[i], y, { color: t.color, icon: t.icon, angle: a.angle, size: size * (1 + 0.15 * pop), glow: a.grow * (0.6 + 0.4 * kick) + pop });
          s.restore();
          // name in the title's chrome, smaller
          Title.draw(s, slots[i], y + size / 2 + 56, { text: t.name, sub: '', size: on ? 46 : 36, maxWidth: 380, px: on ? 4 : 3, beat: on ? beat : 0, t: clock });
          if (on) {
            var off = size / 2 + 34 + 6 * Math.sin(clock * 6);
            drawPixelArrow(s, slots[i] - off, y, -1, 30, t.color); drawPixelArrow(s, slots[i] + off, y, 1, 30, t.color);
          }
        });
        s.save(); s.font = '14px ' + FONT; s.textAlign = 'center'; s.globalAlpha = INTRO ? clamp((clock - INTRO) / 0.3, 0, 1) : 1;
        s.fillStyle = Math.floor(clock * 1.5) % 2 ? C.cream : hexA(C.cream, 0.4);
        s.fillText('SPIN LEFT JOGWHEEL TO CHOOSE    SPIN RIGHT JOGWHEEL TO SELECT', 800, 866); s.restore();
        if (INTRO && clock < 0.3) { s.fillStyle = hexA(C.cream, 0.8 * (1 - clock / 0.3)); s.fillRect(0, 0, W, H); }   // entry flash
        if (confirmed && confirmDelay && clock - confirmT >= confirmDelay) {
          confirmed = false;
          if (opts.onConfirm) opts.onConfirm(tracks[sel], sel, recordPose);
        }
        if (clock - confirmT < 0.6) {   // confirm flash
          var cf = 1 - (clock - confirmT) / 0.6;
          s.save(); s.fillStyle = hexA(tracks[sel].color, 0.25 * cf); s.fillRect(0, 0, W, H);
          Title.draw(s, 800, 360, { text: "LET'S MIX", sub: '', size: 72, px: 5, beat: beat, t: clock }); s.restore();
        }
      }, { timeline: true });
      return {
        el: stage.el, knob: knob, jog: jog, select: select, confirm: confirm,
        next: function () { select(sel + 1); }, prev: function () { select(sel - 1); },
        selected: function () { return tracks[sel]; },
        destroy: function () { stage.stop(); window.removeEventListener('keydown', onKey); stage.el.remove(); }
      };
    }
  };

  // ---------------------------------------------------------------- GameplayScreen
  // A pure view over a GameState source + a live mirror of the controller.
  //
  //   source.frame() -> {
  //     time,         // song time in seconds (same clock as note.time)
  //     bpm, approach,// approach = seconds a note is on screen (default 1.5)
  //     notes: [{ id, channel: 1|2, row: 'TRIM'|'HI'|'MID'|'LOW'|'CFX', dir: 'cw'|'ccw', time,
  //               state: 'pending'|'hit'|'miss', judgedAt? }],
  //     score, combo, multiplier, energy?  // energy 0..1 optional; derived from combo if absent
  //     mode?          // 'live' | 'keys' | 'demo' (HUD chip only)
  //   }
  //   screen.knob({channel, row, position})  absolute 0..1 (0 = full CCW, 0.5 = 12 o'clock)
  //   screen.knob({channel, row, delta})     relative turn, in fractions of the full sweep (+ = CW)
  //   screen.showJudgment({channel, row, judgment: 'perfect'|'good'|'miss', reason?})
  // ---------------------------------------------------------------- PixelWipe (transition overlay)
  // Chunky blocks sweep diagonally across an element with a neon leading edge.
  // mode 'cover': blocks fill in until the element is hidden. mode 'reveal': blocks clear away.
  var PixelWipe = {
    run: function (el, o) {
      o = o || {};
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      var cv = document.createElement('canvas'); cv.width = 64; cv.height = 36;
      cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;pointer-events:none;z-index:20;';
      el.appendChild(cv);
      var x = cv.getContext('2d'), cols = 64, rows = 36, r = rng(o.seed || 9), keys = [], i, j;
      for (j = 0; j < rows; j++) for (i = 0; i < cols; i++) keys.push(((i / cols) * 0.7 + (j / rows) * 0.3) * 0.8 + r() * 0.2);
      var dur = o.duration || 0.6, t0 = performance.now(), cover = o.mode !== 'reveal', edge = [C.magenta, C.cyan, C.violet, o.color || C.cream];
      var frameId;
      (function tick() {
        var p = clamp((performance.now() - t0) / 1000 / dur, 0, 1);
        x.clearRect(0, 0, cols, rows);
        for (j = 0; j < rows; j++) for (i = 0; i < cols; i++) {
          var k = keys[j * cols + i], on = cover ? p >= k : p < k;
          if (!on) continue;
          var near = Math.abs(p - k) < 0.05;
          x.fillStyle = near ? edge[(i + j) % 4] : C.void; x.fillRect(i, j, 1, 1);
        }
        if (p < 1) frameId = requestAnimationFrame(tick);
        else { if (!cover || o.keep === false) cv.remove(); if (o.onDone) o.onDone(cv); }
      })();
      return { el: cv, remove: function () { cancelAnimationFrame(frameId); cv.remove(); } };
    }
  };

  // ---------------------------------------------------------------- Loading page (track select -> game)
  // The chosen record spins big over the same backdrop (darker), a pixel progress bar fills, then a
  // 3-2-1 countdown lands on the track's beat, LET'S MIX, and a pixel wipe covers the screen.
  var LoadingScreen = {
    create: function (rootEl, opts) {
      opts = opts || {};
      var track = opts.track || TRACKS[0], stage = createStage(rootEl), bd = opts.backdrop || new TitleBackdrop(), clock = 0;
      var origin = opts.recordPose || { x: 800, y: 500, angle: 0, size: 330 }, angle = origin.angle;
      var reduced = opts.reducedMotion, targetProgress = 0, progress = 0, countBeat0 = null, wipe, finished = false;
      stage.run(function (dt, tAbs) {
        clock += dt;
        var sceneBeat = bd.draw(stage, reduced ? 0 : dt, reduced ? 0 : tAbs, track.bpm, 0.35);
        var beat = reduced ? clock * track.bpm / 60 : sceneBeat;
        var bp = beat - Math.floor(beat), kick = reduced ? 0 : Math.exp(-bp * 7), s = stage.sharp;
        s.fillStyle = hexA(C.void, 0.17 + 0.42 * clamp(clock / 0.8, 0, 1)); s.fillRect(0, 0, W, H);
        progress = Math.min(targetProgress, progress + dt / 0.6);
        if (progress >= 1 && countBeat0 === null) countBeat0 = Math.ceil(beat);
        // header: track name in chrome
        Title.draw(s, 800, 120, { text: track.name, sub: '', size: 96, maxWidth: 1280, px: 6, beat: beat, t: clock });
        // the record, entering from where it sat on track select, spinning up
        var enter = reduced ? 1 : clamp(clock / 0.8, 0, 1), ee = 1 - Math.pow(1 - enter, 3);
        if (!reduced) angle += dt * (track.bpm / 60) * Math.PI * (0.5 + 1.5 * ee);
        var size = lerp(origin.size, 430 + 14 * kick, ee);
        Vinyl.draw(s, lerp(origin.x, 800, ee), lerp(origin.y, 430, ee), { color: track.color, icon: track.icon, angle: angle, size: size, glow: 0.7 + 0.3 * kick });
        // progress bar or countdown
        if (countBeat0 === null || beat < countBeat0) {
          var segs = 24, bw = 22, gap = 6, x0 = 800 - (segs * (bw + gap) - gap) / 2, lit = Math.floor(progress * segs);
          s.save(); s.fillStyle = 'rgba(11,8,20,.85)'; s.fillRect(x0 - 14, 690, segs * (bw + gap) - gap + 28, 44);
          s.strokeStyle = track.color; s.lineWidth = 3; s.strokeRect(x0 - 12.5, 691.5, segs * (bw + gap) - gap + 25, 41);
          for (var k = 0; k < segs; k++) { s.fillStyle = k < lit ? track.color : 'rgba(246,236,214,.1)'; s.fillRect(x0 + k * (bw + gap), 702, bw, 20); }
          s.font = '16px ' + FONT; s.textAlign = 'center'; s.fillStyle = C.cream;
          s.fillText('LOADING' + '...'.slice(0, 1 + Math.floor(clock * 3) % 3), 800, 672);
          s.restore();
        } else {
          var n = Math.floor(beat) - countBeat0;   // -1 waiting, 0..2 => 3,2,1, 3 => LET'S MIX
          if (n >= 0 && n < 3) {
            var pop = reduced ? 1 : 1 + 0.35 * Math.exp(-bp * 8);
            s.save(); s.translate(800, 430); s.scale(pop, pop);
            Title.draw(s, 0, 0, { text: String(3 - n), sub: '', size: 220, px: 10, beat: 0, t: clock }); s.restore();
          } else if (n >= 3) {
            Title.draw(s, 800, 430, { text: "LET'S MIX!", sub: '', size: 110, px: 6, beat: beat, t: clock });
            if (!finished && n >= 4) {
              finished = true;
              if (reduced) opts.onDone?.(track);
              else wipe = PixelWipe.run(stage.el, { mode: 'cover', duration: 0.72, color: track.color, onDone: function () { opts.onDone?.(track); } });
            }
          }
        }
        if (!reduced && clock < 0.35) { s.fillStyle = hexA(track.color, 0.5 * (1 - clock / 0.35)); s.fillRect(0, 0, W, H); }   // carries the select flash
      }, { timeline: true });
      return {
        el: stage.el,
        setProgress: function (p) { targetProgress = clamp(p, 0, 1); },
        destroy: function () { if (wipe) wipe.remove(); stage.stop(); stage.el.remove(); }
      };
    }
  };

  function createScreen(rootEl, opts) {
    opts = opts || {};
    var stage = createStage(rootEl);
    var L = makeLayout({ rows: opts.rows, camera: opts.camera });
    var source = opts.source || null;
    var show = Object.assign({ venue: true, crowd: true, hud: true, deck: true }, opts.show || {});
    var crowd = new Crowd(7, null, Boolean(opts.getCrowdHype)), fx = new HitFX(), eq = new Equalizer(16);
    var crowdEnergy = null, confetti = null;
    var reducedMotion = opts.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    var webcam = null, webcamMirror = opts.webcamMirror !== false;
    function setWebcam(src) {
      if (!src) { webcam = null; return; }
      if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) { webcam = src; return; }
      var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = src;
      var pl = v.play(); if (pl && pl.catch) pl.catch(function () {});
      webcam = v;
    }
    if (opts.webcam) setWebcam(opts.webcam);
    var knobs = {}, turnListeners = [];
    var smoothing = opts.knobSmoothing == null ? 0.035 : opts.knobSmoothing; // seconds; subtle
    var clock = 0, energy = 0, lastCombo = 0, frameState = null;
    var xf = { pos: null, target: null, cue: null };
    var faderInput, cueStatus;
    if (show.deck) {
      cueStatus = document.createElement('span');
      cueStatus.className = 'flx-cue-status'; cueStatus.setAttribute('role', 'status');
      stage.el.appendChild(cueStatus);
      if (opts.onCrossfadeInput) {
        var left = xfPt(L, 0, -35, 12), right = xfPt(L, 1, 35, 12);
        faderInput = document.createElement('input');
        faderInput.type = 'range'; faderInput.min = 0; faderInput.max = 16383; faderInput.step = 1;
        faderInput.className = 'flx-crossfader'; faderInput.setAttribute('aria-label', 'Crossfader');
        faderInput.style.left = left.x / W * 100 + '%'; faderInput.style.width = (right.x - left.x) / W * 100 + '%';
        faderInput.style.top = left.y / H * 100 + '%'; faderInput.style.height = (right.y - left.y) / H * 100 + '%';
        faderInput.addEventListener('input', function () { opts.onCrossfadeInput(faderInput.valueAsNumber); });
        faderInput.addEventListener('keydown', function (ev) {
          var direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[ev.key];
          if (!direction) return;
          ev.preventDefault();
          opts.onCrossfadeInput(clamp(faderInput.valueAsNumber + direction * 819, 0, 16383));
        });
        stage.el.appendChild(faderInput);
      }
    }
    var scoreAward = null;
    function showScoreAward(award) {
      scoreAward = { points: award.points, multiplier: award.multiplier, at: clock };
    }
    ROWS.forEach(function (r) { [1, 2].forEach(function (ch) { knobs[key(ch, r)] = { pos: 0.5, target: 0.5, angle: 0 }; }); });

    function knob(ev) {
      var k = knobs[key(ev.channel, ev.row)]; if (!k) return null;
      var before = k.target, next;
      if (typeof ev.position === 'number') next = clamp(ev.position, 0, 1);
      else next = clamp(before + (ev.delta || 0), 0, 1);
      var d = next - before;
      k.target = next;
      if (smoothing <= 0) k.pos = next;
      var turn = { channel: ev.channel, row: ev.row, dir: d > 0 ? 'cw' : d < 0 ? 'ccw' : null, amount: d, position: next };
      if (turn.dir) turnListeners.forEach(function (fn) { fn(turn); });
      return turn;
    }
    function showJudgment(ev) {
      var lane = L.lanes[ev.channel] && L.lanes[ev.channel][ev.row];
      if (!lane) return;
      fx.spawn(ev.judgment, lane.x, lane.hitY, ev.channel, ev.reason === 'wrong-way' ? 'WRONG WAY' : null);
    }

    function render(dt, tAbs) {
      clock += dt;
      var f = (source && source.frame) ? source.frame(dt) : { time: clock, bpm: 120, notes: [], score: 0, combo: 0 };
      frameState = f;
      var approach = f.approach || 1.5, bpm = f.bpm || 120, spb = 60 / bpm, beat = f.time / spb;
      // crowd energy: from live state if given, else from combo. Rises with the streak, fades gradually after a miss.
      var target = typeof f.energy === 'number' ? clamp(f.energy, 0, 1) : clamp((f.combo || 0) / 20, 0, 1);
      energy += (target - energy) * Math.min(1, dt * (target > energy ? 1.6 : 0.45));
      lastCombo = f.combo || 0;
      var hype = opts.getCrowdHype ? opts.getCrowdHype(dt) : null;
      var celebration = reducedMotion ? null : hype?.celebration;
      if (celebration && (!confetti || confetti.id !== celebration.id)) {
        confetti = { id: celebration.id, pieces: createHypeConfetti(celebration.id) };
      } else if (!celebration) confetti = null;
      var excitement = hype ? (hype.celebration ? 1 : [energy, 0.43, 0.67, 0.94][hype.tier]) : energy;
      if (crowdEnergy === null) crowdEnergy = excitement;
      crowdEnergy += (excitement - crowdEnergy) * Math.min(1, dt * 3.2);
      var crowdTier = hype?.celebration ? 4 : hype?.tier;
      crowd.update(dt, hype ? crowdEnergy : energy, crowdTier);
      fx.update(dt);
      eq.update(dt, f.audio || sampleAudio(f.time, bpm), tAbs);
      // knob smoothing
      Object.keys(knobs).forEach(function (id) {
        var k = knobs[id];
        k.pos = smoothing > 0 ? k.pos + (k.target - k.pos) * Math.min(1, dt / smoothing) : k.target;
        k.angle = knobAngle(k.pos);
      });
      var upcoming = {};
      (f.notes || []).forEach(function (n) {
        if (n.state !== 'pending' || L.rows.indexOf(n.row) < 0) return;
        var d = n.time - f.time;
        if (d >= 0 && d <= approach) upcoming[key(n.channel, n.row)] = true;
      });

      // retro layer
      var vo = { t: tAbs, e: energy, beat: hype?.beat ?? beat, fxOn: energy > 0.6, eq: eq, wheels: f.wheels, crossfade: f.crossfade };
      stage.beginLow();
      if (show.venue) Venue.draw(stage.low, vo); else { stage.low.fillStyle = C.void; stage.low.fillRect(0, 0, W, H); }
      if (show.hud && confetti) drawHypeConfetti(stage.low, confetti.pieces, celebration, false);
      if (show.crowd) crowd.draw(stage.low, hype ? { t: tAbs, e: crowdEnergy, beat: hype.beat ?? beat, tempo: hype.tempo ?? bpm, celebration: celebration } : vo);
      if (show.venue) Venue.drawBeams(stage.low, vo);
      if (show.venue) bloom(stage.low, 446, 0.4 + 0.25 * energy);
      Venue.drawBooth(stage.low, vo);
      if (show.deck) Deck.draw(stage.low, L, vo);
      stage.endLow();

      // sharp layer
      var s = stage.sharp; s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, W, H);
      if (show.hud && confetti) drawHypeConfetti(s, confetti.pieces, celebration, true);
      NoteLanes.draw(s, L, { time: f.time, approach: approach, spb: spb, traces: f.traces });
      NoteLanes.drawGuides(s, L, upcoming, f.traces);
      if (show.deck) {
        Deck.drawOverlay(s, L, knobs);
        var faderTarget = clamp((f.crossfade ?? 8191.5) / 16383, 0, 1);
        if (faderInput) {
          if (faderInput.valueAsNumber !== Math.round(faderTarget * 16383)) faderInput.value = Math.round(faderTarget * 16383);
          faderInput.disabled = f.mode === 'demo';
        }
        if (xf.target !== null && xf.target !== faderTarget && !reducedMotion) xf.moveT = clock;
        xf.target = faderTarget;
        xf.pos = xf.pos === null || reducedMotion ? xf.target : lerp(xf.pos, xf.target, 1 - Math.exp(-dt / 0.045));
        xf.cue = f.crossfadeCue;
        drawCrossfader(s, L, xf, clock, vo.beat, energy);
      }
      (f.notes || []).forEach(function (n) {
        if (L.rows.indexOf(n.row) < 0 || n.state === 'hit') return;
        var d = n.time - f.time; if (d > approach) return;
        var alpha = 1;
        if (n.state === 'miss') { alpha = 1 - (f.time - (n.judgedAt == null ? n.time : n.judgedAt)) / 0.35; if (alpha <= 0) return; }
        var lane = L.lanes[n.channel][n.row];
        var trace = f.traces && f.traces[key(n.channel, n.row)];
        Note.draw(s, lane.x + traceOffset(trace, d / approach, L.laneWidth, lane), noteY(L, lane, d, approach, trace), n.dir, { r: L.noteR, tail: n.state === 'pending', alpha: alpha });
      });
      if (show.deck) {
        var wheelLabels = (f.jogCues || []).map(function (cue) {
          Deck.drawJogCue(s, L, cue, spb, reducedMotion, clock);
          var wheel = cue.deck === 'a' ? 'Spin left' : 'Spin right';
          if (cue.bonus || cue.matched) return cue.bonus ? '+' + cue.bonus : 'On cue';
          return cue.remaining > 0 ? wheel + ' in ' + Math.ceil(cue.remaining) : wheel + ' now';
        }).join('. ');
        if (cueStatus.textContent !== wheelLabels) cueStatus.textContent = wheelLabels;
      }
      fx.draw(s);
      if (scoreAward && clock - scoreAward.at >= 1) scoreAward = null;
      if (show.hud) HUD.draw(s, { score: f.score, award: scoreAward, clock: clock, reducedMotion: reducedMotion });
      if (show.hud && f.mixerGuide) drawRecordedFaders(s, f.mixerGuide);
      if (show.hud && show.webcam !== false) HUD.drawWebcam(s, webcam, {
        mirror: webcamMirror, t: tAbs, effects: opts.drawWebcamEffects, hype: hype, dt: dt, reducedMotion: reducedMotion
      });
      if (show.hud && hype) {
        drawHypeMeter(s, hype);
        drawHypeTempo(s, hype);
      }
    }
    stage.run(render);

    return {
      el: stage.el,
      knob: knob,
      showJudgment: showJudgment,
      showScoreAward: showScoreAward,
      setWebcam: setWebcam,   // MediaStream (e.g. from getUserMedia), an HTMLVideoElement, or null
      onTurn: function (fn) { turnListeners.push(fn); return function () { turnListeners = turnListeners.filter(function (g) { return g !== fn; }); }; },
      setSource: function (src) { source = src; },
      setRows: function (rows) { L = makeLayout({ rows: rows, camera: opts.camera }); if (source && source.setRows) source.setRows(L.rows.slice()); },
      getRows: function () { return L.rows.slice(); },
      getEnergy: function () { return energy; },
      getLayout: function () { return L; },
      destroy: function () { stage.stop(); stage.el.remove(); }
    };
  }

  // ---------------------------------------------------------------- Sample data source
  // Same interface live gameplay uses. Owns a clock, a looping chart, judging, score and combo.
  // Feed it turns via screen.onTurn (wired in attach) so physical knobs, keyboard or autoplay
  // all go through screen.knob() first: the on-screen knob always moves, then the game judges.
  var SAMPLE_CHART = {
    bpm: 128, lengthBeats: 32,
    notes: [
      [2, 1, 'HI', 'cw', 'perfect'], [4, 2, 'MID', 'ccw', 'perfect'],
      [6, 1, 'LOW', 'ccw', 'perfect'], [6, 2, 'HI', 'cw', 'good'],
      [7, 1, 'MID', 'cw', 'good'], [8, 2, 'CFX', 'cw', 'perfect'], [9, 1, 'HI', 'ccw', 'perfect'],
      [10, 2, 'LOW', 'ccw', 'perfect'], [11, 1, 'TRIM', 'cw', 'perfect'],
      [12, 1, 'MID', 'ccw', 'perfect'], [12, 2, 'MID', 'cw', 'perfect'],
      [13, 2, 'HI', 'ccw', 'good'], [14, 1, 'LOW', 'cw', 'perfect'], [15, 2, 'TRIM', 'cw', 'perfect'],
      [16, 1, 'CFX', 'ccw', 'perfect'], [17, 2, 'MID', 'cw', 'perfect'],
      [18, 1, 'HI', 'cw', 'perfect'], [18, 2, 'HI', 'ccw', 'perfect'],
      [19, 1, 'LOW', 'ccw', 'perfect'], [20, 2, 'LOW', 'cw', 'good'], [21, 1, 'MID', 'cw', 'perfect'],
      [22, 2, 'CFX', 'ccw', 'perfect'], [23, 1, 'TRIM', 'ccw', 'perfect'],
      [24, 1, 'LOW', 'cw', 'perfect'], [24, 2, 'LOW', 'ccw', 'perfect'],
      [25, 2, 'HI', 'cw', 'perfect'], [26, 1, 'HI', 'ccw', 'perfect'],
      [27, 2, 'MID', 'ccw', 'miss'],
      [29, 1, 'MID', 'cw', 'good'], [30, 2, 'LOW', 'cw', 'perfect']
    ].map(function (a) { return { beat: a[0], channel: a[1], row: a[2], dir: a[3], demo: a[4] }; })
  };
  var WINDOWS = { perfect: 0.05, good: 0.11, miss: 0.15 };

  function createSampleSource(opts) {
    opts = opts || {};
    var chart = opts.chart || SAMPLE_CHART, bpm = chart.bpm, spb = 60 / bpm, loopLen = chart.lengthBeats * spb;
    var approach = opts.approach || 1.5, autoplay = opts.autoplay !== false;
    var time = opts.leadIn == null ? -0.6 : -opts.leadIn, nextLoop = 0, idSeq = 0, r = rng(5);
    var notes = [], rows = ROWS.slice(), screen = null, listeners = {}, mode = autoplay ? 'demo' : 'keys';
    var st = { score: 0, combo: 0, maxCombo: 0, counts: { perfect: 0, good: 0, miss: 0 } };
    var idleNext = 1.2, keyHeld = {};

    function emit(n, d) { (listeners[n] || []).forEach(function (fn) { fn(d); }); }
    function mult() { return Math.min(4, 1 + Math.floor(st.combo / 10)); }
    function spawn(loop) {
      chart.notes.forEach(function (c, i) {
        if (rows.indexOf(c.row) < 0) return;
        var t = loop * loopLen + c.beat * spb, alt = (i % 2 ? 1 : -1);
        notes.push({ id: ++idSeq, channel: c.channel, row: c.row, dir: c.dir, time: t, state: 'pending', demo: c.demo,
          autoAt: c.demo === 'perfect' ? t + (r() - 0.5) * 0.03 : c.demo === 'good' ? t + alt * 0.085 : null });
      });
    }
    function judge(n, j, reason) {
      n.state = j === 'miss' ? 'miss' : 'hit'; n.judgedAt = time;
      st.counts[j]++;
      if (j === 'miss') st.combo = 0;
      else {
        st.combo++;
        var multiplier = mult(), points = (j === 'perfect' ? 300 : 100) * multiplier;
        st.score += points;
        if (screen && screen.showScoreAward) screen.showScoreAward({ points: points, multiplier: multiplier });
      }
      st.maxCombo = Math.max(st.maxCombo, st.combo);
      if (screen) screen.showJudgment({ channel: n.channel, row: n.row, judgment: j, reason: reason });
      emit('judge', { note: n, judgment: j, reason: reason, combo: st.combo, score: st.score });
    }
    // game-side judging of a physical turn
    function onTurn(turn) {
      var best = null, bd = 1e9;
      notes.forEach(function (n) {
        if (n.state !== 'pending' || n.channel !== turn.channel || n.row !== turn.row) return;
        var d = Math.abs(n.time - time); if (d <= WINDOWS.miss && d < bd) { bd = d; best = n; }
      });
      if (!best || best._turning) return;
      best._turning = true; // one judgment per note, however many ticks the turn sends
      if (turn.dir !== best.dir) return judge(best, 'miss', 'wrong-way');
      judge(best, bd <= WINDOWS.perfect ? 'perfect' : bd <= WINDOWS.good ? 'good' : 'miss');
    }
    // autoplay sends gesture-like streams of small deltas, exactly like a relative encoder
    var gestures = [];
    function gesture(channel, row, dir, size) {
      gestures.push({ channel: channel, row: row, step: (dir === 'cw' ? 1 : -1) * size / 6, left: 6 });
    }
    var KEYS = {};
    ROWS.forEach(function (row, i) {
      KEYS['12345'[i]] = [1, row, 'ccw']; KEYS['qwert'[i]] = [1, row, 'cw'];
      KEYS['67890'[i]] = [2, row, 'ccw']; KEYS['yuiop'[i]] = [2, row, 'cw'];
    });
    function onKey(e) {
      if (e.key === ' ') { api.setAutoplay(!autoplay); e.preventDefault(); return; }
      var m = KEYS[e.key.toLowerCase()]; if (!m || e.repeat) return;
      if (autoplay) api.setAutoplay(false);
      gesture(m[0], m[1], m[2], 0.08);
    }

    var api = {
      attach: function (s) {
        screen = s;
        s.onTurn(onTurn);
        if (opts.keyboard !== false && typeof window !== 'undefined') window.addEventListener('keydown', onKey);
      },
      frame: function (dt) {
        time += dt;
        while (nextLoop * loopLen - time < approach + 1) { spawn(nextLoop); nextLoop++; }
        // feed queued gestures through the screen so knobs move first
        gestures.forEach(function (g) { if (screen && g.left > 0) { screen.knob({ channel: g.channel, row: g.row, delta: g.step }); g.left--; } });
        gestures = gestures.filter(function (g) { return g.left > 0; });
        if (autoplay) {
          notes.forEach(function (n) {
            if (n.state === 'pending' && n.autoAt != null && !n._auto && time >= n.autoAt - 0.03) { n._auto = true; gesture(n.channel, n.row, n.dir, 30 / 180); }
          });
          // idle noodling: knobs move even when no note is due
          idleNext -= dt;
          if (idleNext <= 0) {
            idleNext = 1.4 + r() * 1.6;
            var row = rows[(r() * rows.length) | 0], ch = r() < 0.5 ? 1 : 2, busy = notes.some(function (n) { return n.state === 'pending' && n.channel === ch && n.row === row && Math.abs(n.time - time) < 0.4; });
            if (row && !busy) gesture(ch, row, r() < 0.5 ? 'cw' : 'ccw', 0.05);
          }
        }
        notes.forEach(function (n) { if (n.state === 'pending' && time > n.time + WINDOWS.miss) judge(n, 'miss'); });
        notes = notes.filter(function (n) { return n.state === 'pending' || time - n.judgedAt < 0.5; });
        return { time: time, bpm: bpm, approach: approach, notes: notes, score: st.score, combo: st.combo, multiplier: mult(), mode: mode, audio: sampleAudio(time, bpm) };
      },
      setAutoplay: function (on) { autoplay = !!on; mode = autoplay ? 'demo' : 'keys'; emit('mode', mode); },
      isAutoplay: function () { return autoplay; },
      setRows: function (r2) { rows = r2.slice(); notes = notes.filter(function (n) { return rows.indexOf(n.row) >= 0; }); },
      on: function (n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
      stats: function () { return JSON.parse(JSON.stringify(st)); },
      destroy: function () { if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey); }
    };
    return api;
  }

  // patch createScreen so setSource can hand the screen api to the source
  var _createScreen = createScreen;
  createScreen = function (rootEl, opts) {
    opts = opts || {};
    var src = opts.source; opts.source = null;
    var s = _createScreen(rootEl, opts);
    s.setSource = (function (orig) {
      return function (source) { orig(source); if (source && source.attach) source.attach(s); };
    })(s.setSource);
    if (src) s.setSource(src);
    return s;
  };

  root.FLXHero = {
    ROWS: ROWS, COLORS: C, FONT: FONT, WINDOWS: WINDOWS, SAMPLE_CHART: SAMPLE_CHART,
    makeLayout: makeLayout, createStage: createStage, createScreen: createScreen, createSampleSource: createSampleSource,
    Venue: Venue, Crowd: Crowd, Deck: Deck, Equalizer: Equalizer, sampleAudio: sampleAudio, Title: Title, bloom: bloom, TitleBackdrop: TitleBackdrop, Vinyl: Vinyl, TrackSelect: TrackSelect, TRACKS: TRACKS, Note: Note, HitMarker: HitMarker, HitFX: HitFX, NoteLanes: NoteLanes, HUD: HUD,
    TitleScreen: TitleScreen, PixelWipe: PixelWipe, LoadingScreen: LoadingScreen,
    GameplayScreen: { create: function (el, o) { return createScreen(el, o); } }
  };
})(typeof window !== 'undefined' ? window : this);
