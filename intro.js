/*
 * Intro sequence, drawn on one canvas:
 *   1. montage     full-screen flash cuts into a hero shot (montage video, screen space)
 *   2. zoom        "ABHI JANDYALA" pulls back from inside the I; letters act as windows onto the montage
 *   3. tiles       each letter crossfades to its own clip (letters video, a 4x3 grid of tiles)
 *   4. ink         background goes white, letters go solid black
 *   5. burst       letters break into particles that settle into a node field
 *   6. hub         the node field is the site navigation (real <a> links track their nodes)
 * Videos are built by tools/intro/build.py.
 */
(() => {
  const root = document.getElementById('intro');
  if (!root) return;

  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  const montage = root.querySelector('[data-intro="montage"]');
  const tiles = root.querySelector('[data-intro="letters"]');
  const loaderBar = root.querySelector('.intro-loader span');
  const skipBtn = root.querySelector('.intro-skip');
  const navLinks = [...root.querySelectorAll('.intro-node')];

  const FONT = 'Anton';
  const TILE_COLS = 4;
  const TRACKING = 0.035;            // em
  const FOCUS_INDEX = 3;             // the I in ABHI: a solid bar to start the zoom inside
  const T = {
    zoom0: 3.3, zoom1: 5.9,          // pull back
    tiles0: 4.7, tiles1: 5.8,        // letters crossfade to their own clips
    ink0: 7.3, ink1: 7.9,            // white background, black letters
    burst0: 7.9, burst1: 9.8,        // letters -> dots -> node field
    hub: 9.3,                        // nav labels appear
  };

  const params = new URLSearchParams(location.search);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  try { seen = sessionStorage.getItem('introSeen') === '1'; } catch (e) { /* storage blocked */ }
  const playIntro = params.has('intro') || (!seen && !reduceMotion);
  const frozenAt = params.has('t') ? parseFloat(params.get('t')) : null;

  let W = 0, H = 0, dpr = 1;
  let letters = [];                  // { ch, x, base, ink: {x, y, w, h}, tile }
  let fontPx = 100, capH = 70;
  let focus = { x: 0, y: 0 }, focusInk = null, startScale = 40;
  let nodes = [], links = [], dust = [];
  let driftClock = 0;                // hover drift time, advanced only while the hub is drawn
  let clock = 0, lastNow = 0, started = false, raf = 0, hubShown = false;
  const mouse = { x: -9999, y: -9999 };

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const easeInOut = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2);
  const easeOut = (t) => 1 - (1 - t) ** 3;

  // ---------- layout ----------

  function layout() {
    W = innerWidth;
    H = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = layer.width = Math.round(W * dpr);
    canvas.height = layer.height = Math.round(H * dpr);

    const lines = W / H < 0.9 ? ['ABHI', 'JANDYALA'] : ['ABHI JANDYALA'];
    ctx.font = `100px ${FONT}`;
    const advCache = {};
    const adv = (ch) => (advCache[ch] ??= ctx.measureText(ch).width + TRACKING * 100);   // at 100px
    const lineW = (l) => [...l].reduce((s, ch) => s + adv(ch), 0) - TRACKING * 100;
    const cap100 = ctx.measureText('H').actualBoundingBoxAscent;
    lines.join('').split('').forEach(adv);
    const gap = 0.16;

    const byWidth = (W * (lines.length > 1 ? 0.84 : 0.9)) / Math.max(...lines.map(lineW));
    const byHeight = (H * 0.62) / (cap100 * (lines.length + gap * (lines.length - 1)) / 100) / 100;
    const k = Math.min(byWidth, byHeight);
    fontPx = 100 * k;
    capH = cap100 * k;

    ctx.font = `${fontPx}px ${FONT}`;
    const blockH = capH * (lines.length + gap * (lines.length - 1));
    letters = [];
    let tile = 0;
    lines.forEach((line, li) => {
      const base = (H - blockH) / 2 + capH + li * capH * (1 + gap);
      let x = (W - lineW(line) * k) / 2;
      for (const ch of line) {
        if (ch !== ' ') {
          const m = ctx.measureText(ch);
          letters.push({
            ch, x, base, tile: tile++,
            ink: {
              x: x - m.actualBoundingBoxLeft,
              y: base - m.actualBoundingBoxAscent,
              w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
              h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
            },
          });
        }
        x += adv(ch) * k;
      }
    });

    focusInk = letters[FOCUS_INDEX].ink;
    focus = { x: focusInk.x + focusInk.w / 2, y: focusInk.y + focusInk.h / 2 };
    startScale = 1.25 * Math.max(W / focusInk.w, H / focusInk.h);

    navLinks.forEach((a) => delete a.dataset.w);
    if (nodes.length) {
      if (clock < T.burst0) buildNodes();          // particles start on the letters: re-sample for the new layout
      else placeNodes();
    }
  }

  // screen = F + (p - focus) * s, where F moves from the screen center to the focus point
  function zoomAt(t) {
    const e = easeInOut(prog(t, T.zoom0, T.zoom1));
    const s = Math.exp(Math.log(startScale) * (1 - e));
    const F = { x: lerp(W / 2, focus.x, e), y: lerp(H / 2, focus.y, e) };
    return { s, tx: F.x - focus.x * s, ty: F.y - focus.y * s };
  }

  function viewportInsideFocus(z) {
    const x0 = (0 - z.tx) / z.s, x1 = (W - z.tx) / z.s;
    const y0 = (0 - z.ty) / z.s, y1 = (H - z.ty) / z.s;
    const i = focusInk;
    return x0 > i.x && x1 < i.x + i.w && y0 > i.y && y1 < i.y + i.h;
  }

  // ---------- drawing ----------

  function coverRect(sw, sh, dw, dh) {
    const r = Math.max(dw / sw, dh / sh);
    return { w: sw * r, h: sh * r, x: (dw - sw * r) / 2, y: (dh - sh * r) / 2 };
  }

  function drawMontage(c) {
    if (!montage.videoWidth) return;
    const r = coverRect(montage.videoWidth, montage.videoHeight, W, H);
    c.drawImage(montage, r.x, r.y, r.w, r.h);
  }

  function drawLetterText(c, color) {
    c.fillStyle = color;
    c.font = `${fontPx}px ${FONT}`;
    c.textBaseline = 'alphabetic';
    for (const l of letters) c.fillText(l.ch, l.x, l.base);
  }

  function drawTiles(c) {
    if (!tiles.videoWidth) return;
    const tw = tiles.videoWidth / TILE_COLS;
    const th = tiles.videoHeight / Math.ceil(letters.length / TILE_COLS);
    for (const l of letters) {
      const { x, y, w, h } = l.ink;
      let sw = tw, sh = th;
      if (w / h > tw / th) sh = tw * h / w; else sw = th * w / h;
      const sx = (l.tile % TILE_COLS) * tw + (tw - sw) / 2;
      const sy = Math.floor(l.tile / TILE_COLS) * th + (th - sh) / 2;
      c.drawImage(tiles, sx, sy, sw, sh, x - 1, y - 1, w + 2, h + 2);
    }
  }

  function drawName(t) {
    const z = zoomAt(t);
    const set = (c, s = 1, tx = 0, ty = 0) => c.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);

    if (t < T.zoom0 || viewportInsideFocus(z)) {
      set(ctx);
      drawMontage(ctx);
      return;
    }

    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 1;
    lctx.clearRect(0, 0, layer.width, layer.height);

    set(lctx, z.s, z.tx, z.ty);
    drawLetterText(lctx, '#fff');

    lctx.globalCompositeOperation = 'source-in';
    set(lctx);
    drawMontage(lctx);

    lctx.globalCompositeOperation = 'source-atop';
    const tileA = easeOut(prog(t, T.tiles0, T.tiles1));
    if (tileA > 0) {
      lctx.globalAlpha = tileA;
      set(lctx, z.s, z.tx, z.ty);
      drawTiles(lctx);
    }

    // phones: the name is small and some clips are dim, so a faint outline keeps every letter readable
    if (W < 600) {
      lctx.globalCompositeOperation = 'source-over';
      lctx.globalAlpha = 0.45 * (1 - prog(t, T.ink0, T.ink1));
      set(lctx, z.s, z.tx, z.ty);
      lctx.strokeStyle = '#fff';
      lctx.lineWidth = 1.2 / z.s;              // about 1.2 px on screen at any zoom
      lctx.font = `${fontPx}px ${FONT}`;
      lctx.textBaseline = 'alphabetic';
      for (const l of letters) lctx.strokeText(l.ch, l.x, l.base);
      lctx.globalCompositeOperation = 'source-atop';
    }

    const inkA = prog(t, T.ink0, T.ink1);
    if (inkA > 0) {
      lctx.globalAlpha = easeInOut(inkA);
      set(lctx);
      lctx.fillStyle = '#0a0a0a';
      lctx.fillRect(0, 0, W, H);
    }

    const fadeA = 1 - prog(t, T.burst0, T.burst0 + 0.22);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = fadeA;
    ctx.drawImage(layer, 0, 0);
    ctx.globalAlpha = 1;
  }

  // ---------- node field ----------

  const NAV_SPOTS = {
    // Building, Projects, Achievements, About, Contact, SF Trip, VentraMatch Journey
    wide: [[0.2, 0.3], [0.58, 0.2], [0.82, 0.48], [0.3, 0.72], [0.68, 0.8], [0.5, 0.5], [0.86, 0.2]],
    tall: [[0.28, 0.14], [0.7, 0.25], [0.28, 0.37], [0.7, 0.73], [0.3, 0.86], [0.68, 0.49], [0.3, 0.61]],
  };

  function sampleLetterPoints(n) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(W);
    c.height = Math.ceil(H);
    const g = c.getContext('2d');
    drawLetterText(g, '#000');
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const pts = [];
    const step = Math.max(1, Math.round(capH / 90));
    for (let y = 0; y < c.height; y += step) {
      for (let x = 0; x < c.width; x += step) {
        if (data[(y * c.width + x) * 4 + 3] > 128) pts.push({ x, y });
      }
    }
    for (let i = pts.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    while (pts.length < n) pts.push({ x: W / 2, y: H / 2 });
    return pts.slice(0, n);
  }

  function buildNodes() {
    const n = Math.round(clamp((W * H * BLEED_AREA) / 3500, 130, 620));
    const dustN = Math.round(clamp((W * H) / 600, 1000, 2600));
    const pts = sampleLetterPoints(n + dustN);
    nodes = pts.slice(0, n).map((p, i) => ({
      sx: p.x, sy: p.y, fx: 0, fy: 0, x: p.x, y: p.y, vx: 0, vy: 0,
      delay: 0.3 + Math.random() * 0.5, phase: Math.random() * Math.PI * 2,     // delay in seconds after burst0
      amp: 7 + Math.random() * 5, f1: 0.25 + Math.random() * 0.25, f2: 0.5 + Math.random() * 0.4,
      r: 1.4 + Math.random() * 1.4, nav: i < navLinks.length ? i : -1,
    }));
    const reach = Math.max(W, H);
    dust = pts.slice(n).map((p) => {
      const a = Math.atan2(p.y - H / 2, p.x - W / 2) + (Math.random() - 0.5) * 1.6;
      const d = reach * (0.08 + Math.random() * 0.5);
      return {
        sx: p.x, sy: p.y, tx: p.x + Math.cos(a) * d, ty: p.y + Math.sin(a) * d,
        r: 0.8 + Math.random() * 1.1,
        t0: 0.25 + Math.random() * 0.35,           // seconds the dotted name holds before this dot leaves
        dur: 0.7 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
      };
    });
    placeNodes();
    if (clock >= T.burst1) nodes.forEach((nd) => { nd.x = nd.fx * W; nd.y = nd.fy * H; nd.delay = 0; });
  }

  function drawDust(t) {
    const local = t - T.burst0;
    if (!dust.length || local > 1.8) return;
    const inA = clamp(local / 0.25);
    const buckets = [[], [], [], [], [], []];
    for (const d of dust) {
      const p = clamp((local - d.t0) / d.dur);
      const e = easeOut(p);
      const a = inA * (1 - p * p);
      if (a <= 0.02) continue;
      const shimmer = p === 0 ? Math.sin(t * 30 + d.phase) * 0.4 : 0;
      d.x = lerp(d.sx, d.tx, e) + shimmer;
      d.y = lerp(d.sy, d.ty, e);
      buckets[Math.min(5, Math.floor(a * 6))].push(d);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0a0a';
    buckets.forEach((b, i) => {
      if (!b.length) return;
      ctx.globalAlpha = (i + 0.5) / 6;
      ctx.beginPath();
      for (const d of b) {
        ctx.moveTo(d.x + d.r, d.y);
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      }
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // Mitchell's best-candidate sampling: evenly spread, organic-looking; nav nodes at fixed spots
  const BLEED = 0.07;                                   // how far past each edge the web extends
  const BLEED_AREA = (1 + 2 * BLEED) ** 2;
  function placeNodes() {
    const spots = NAV_SPOTS[W / H < 0.9 ? 'tall' : 'wide'];
    const placed = spots.map(([fx, fy], i) => ({
      x: fx * W, y: fy * H,
      keep: Math.min(W, H) * (navLinks[i]?.classList.contains('intro-node--stack') ? 0.13 : 0.045),   // room for the preview stack
    }));
    const title = root.querySelector('.intro-hub-title').getBoundingClientRect();
    const titleBox = { w: title.right + 24, h: title.bottom + 18 };
    for (const nd of nodes) {
      if (nd.nav >= 0) {
        [nd.fx, nd.fy] = spots[nd.nav];
        nd.r = 5;
        continue;
      }
      let best = null, bestD = -1;
      for (let k = 0; k < 14; k++) {
        // the web runs past every edge of the screen
        const x = (-BLEED + Math.random() * (1 + 2 * BLEED)) * W;
        const y = (-BLEED + Math.random() * (1 + 2 * BLEED)) * H;
        if (x < titleBox.w && y < titleBox.h) { k--; continue; }   // keep the hub title clear
        let d = Infinity;
        for (const q of placed) d = Math.min(d, Math.hypot(x - q.x, y - q.y) - (q.keep || 0));
        if (d > bestD) { bestD = d; best = { x, y }; }
      }
      placed.push(best);
      nd.fx = best.x / W;
      nd.fy = best.y / H;
    }
    links = [];
    const maxD = Math.max(60, Math.sqrt((W * H) / nodes.length) * 1.5);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const d = Math.hypot((a.fx - b.fx) * W, (a.fy - b.fy) * H);
        if (d < maxD) links.push([a, b, 1 - d / maxD]);
      }
    }
  }

  // Nodes glide toward a slowly drifting goal (exponential smoothing), so they never snap into place.
  function drawNodes(t, now, dt) {
    const local = t - T.burst0;
    // Critically damped spring toward a drifting goal: starts from rest (ease in), settles without
    // overshoot (ease out). ~2 s to arrive.
    const K = 5, C = 2 * Math.sqrt(K), steps = Math.max(1, Math.ceil(dt / 0.016)), h = dt / steps;
    driftClock += dt;                 // pauses while the hub is hidden, so nodes resume where they were
    const time = driftClock;
    for (const nd of nodes) {
      if (local < nd.delay) {
        nd.x = nd.sx;
        nd.y = nd.sy;
        continue;
      }
      const amp = nd.nav >= 0 ? 4 : nd.amp;
      let gx = nd.fx * W + (Math.sin(time * nd.f1 + nd.phase) + 0.5 * Math.sin(time * nd.f2 + nd.phase * 1.7)) * amp;
      let gy = nd.fy * H + (Math.cos(time * nd.f1 * 0.9 + nd.phase * 1.3) + 0.5 * Math.cos(time * nd.f2 * 1.1 + nd.phase)) * amp;
      const dx = gx - mouse.x, dy = gy - mouse.y, d = Math.hypot(dx, dy);
      if (nd.nav < 0 && d < 120 && d > 0.1) {
        const push = (1 - d / 120) * 22;
        gx += (dx / d) * push;
        gy += (dy / d) * push;
      }
      for (let i = 0; i < steps; i++) {
        nd.vx += ((gx - nd.x) * K - nd.vx * C) * h;
        nd.vy += ((gy - nd.y) * K - nd.vy * C) * h;
        nd.x += nd.vx * h;
        nd.y += nd.vy * h;
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const linkA = prog(t, T.burst1 - 0.6, T.burst1 + 0.6);
    if (linkA > 0) {
      const LB = 6;
      const buckets = Array.from({ length: LB }, () => []);
      for (const l of links) buckets[Math.min(LB - 1, Math.floor(l[2] * LB))].push(l);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#0a0a0a';
      buckets.forEach((b, i) => {
        if (!b.length) return;
        ctx.globalAlpha = ((i + 0.5) / LB) * 0.28 * linkA;
        ctx.beginPath();
        for (const [a, c] of b) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(c.x, c.y);
        }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#0a0a0a';
    const inA = prog(t, T.burst0, T.burst0 + 0.3);
    for (const nd of nodes) {
      const r = nd.nav >= 0 ? lerp(1.6, nd.r, prog(t, T.burst1 - 0.5, T.burst1)) : nd.r;
      ctx.globalAlpha = inA;
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (nd.nav >= 0 && hubShown) {
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, r + 7 + Math.sin(driftClock * 2 + nd.phase) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    for (const nd of nodes) {
      if (nd.nav < 0) continue;
      const a = navLinks[nd.nav];
      const w = (a.dataset.w ??= a.offsetWidth);
      const flip = nd.x + +w > W - 16;           // label would overflow: put it left of the node
      a.classList.toggle('is-left', flip);
      a.style.transform = `translate(${flip ? nd.x - w : nd.x}px, ${nd.y}px) translateY(-50%)`;
    }
  }

  // ---------- loop ----------

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;   // capped: no jumps after a hidden tab
    lastNow = now;
    if (!started) return;

    if (frozenAt !== null) clock = frozenAt;
    else if (!montage.paused && !montage.ended) clock = Math.max(clock, montage.currentTime);
    else clock += dt;
    const t = clock;

    if (t >= T.zoom0 - 0.15 && tiles.paused && !tiles.dataset.started) {
      tiles.dataset.started = '1';
      tiles.play().catch(() => {});
    }

    const white = easeInOut(prog(t, T.ink0, T.ink1));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const v = Math.round(255 * white);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (t < T.burst0 + 0.4) drawName(t);
    if (root.classList.contains('is-away') && hubShown) return;
    if (hubShown) drawStack();
    if (t >= T.burst0) {
      if (!nodes.length) buildNodes();
      drawDust(t);
      drawNodes(t, now, dt);
    }
    if (t >= T.hub && !hubShown) showHub();
    if (t > T.burst1 + 1 && !montage.paused) montage.pause();
    if (t > T.burst1 + 1 && !tiles.paused) tiles.pause();
  }

  // Draws the SF Trip stack: each canvas shows its (hidden) video's current frame.
  const stackItems = [...root.querySelectorAll('.node-stack canvas')].map((c) => ({ c, v: c.nextElementSibling, g: c.getContext('2d') }));
  function drawStack() {
    for (const { c, v, g } of stackItems) {
      if (v.readyState < 2) continue;
      if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
      g.drawImage(v, 0, 0, c.width, c.height);
    }
  }

  // Hub clip previews. Media given a source while the tab is hidden may never paint, so only load when
  // visible, and reload anything that was loaded hidden.
  function loadStack() {
    if (document.hidden) return;
    root.querySelectorAll('img[data-src]').forEach((img) => { img.src = img.dataset.src; img.removeAttribute('data-src'); });
    root.querySelectorAll('video[data-src]').forEach((v) => {
      if (v.dataset.loaded === 'visible') return;
      v.preload = 'auto';
      v.src = v.dataset.src;
      v.load();
      v.dataset.loaded = 'visible';
      v.play().catch(() => {});
    });
  }

  function showHub() {
    hubShown = true;
    root.classList.add('is-hub');
    setTimeout(loadStack, 900);   // after the nav has faded in: media started inside an opacity:0 subtree may not paint
    try { sessionStorage.setItem('introSeen', '1'); } catch (e) { /* storage blocked */ }
  }

  function start(fromTime = 0) {
    clock = fromTime;
    started = true;
    root.classList.add('is-playing');
  }

  function skip() {
    if (clock >= T.burst0) return;
    montage.pause();
    tiles.pause();
    start(Math.max(clock, T.burst0 - 0.01));
  }

  function openHub() {
    root.classList.remove('is-hidden');
    document.documentElement.style.overflow = 'hidden';
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function closeHub() {
    root.classList.add('is-hidden');
    document.documentElement.style.overflow = '';
    setTimeout(() => {
      if (root.classList.contains('is-hidden')) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }, 700);
  }

  // ---------- boot ----------

  // v: bump when a video is rebuilt so browsers don't keep playing a cached copy
  function setSources(video, base, v = 1) {
    video.innerHTML = `<source src="${base}.webm?v=${v}" type="video/webm"><source src="${base}.mp4?v=${v}" type="video/mp4">`;
    video.load();
  }

  function whenReady(video) {
    return new Promise((resolve) => {
      if (video.readyState >= 4) return resolve();
      video.addEventListener('canplaythrough', resolve, { once: true });
      video.addEventListener('error', resolve, { once: true });
    });
  }

  function trackLoading(videos) {
    const tick = () => {
      if (started) return;
      const pct = videos.reduce((s, v) => {
        const d = v.duration || 1;
        return s + (v.buffered.length ? v.buffered.end(v.buffered.length - 1) / d : 0);
      }, 0) / videos.length;
      loaderBar.style.width = `${Math.round(clamp(pct) * 100)}%`;
      requestAnimationFrame(tick);
    };
    tick();
  }

  async function boot() {
    document.documentElement.style.overflow = 'hidden';
    await document.fonts.load(`100px ${FONT}`);
    layout();
    addEventListener('resize', () => layout());
    addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
    addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
    skipBtn.addEventListener('click', skip);
    addEventListener('keydown', (e) => { if (e.key === 'Escape') skip(); });
    navLinks.forEach((a, i) => a.addEventListener('click', (e) => {
      const tag = e.target.closest('[data-href]');   // Contact's pop-out social tags go straight to the link
      if (tag) {
        e.preventDefault();
        if (tag.dataset.href.startsWith('mailto:')) location.href = tag.dataset.href;
        else window.open(tag.dataset.href, '_blank', 'noopener');
        return;
      }
      if (a.dataset.gallery) {           // opens a node gallery (SF Trip, Projects, ...) from this node
        e.preventDefault();
        const nd = nodes.find((n) => n.nav === i);
        root.classList.add('is-away');
        document.dispatchEvent(new CustomEvent('gallery:open', {
          detail: { name: a.dataset.gallery, x: nd ? nd.x : W / 2, y: nd ? nd.y : H / 2 },
        }));
        return;
      }
      if (a.target === '_blank') return;   // external site (Building -> valiqai.com): open it in a new tab
      // sections are being rebuilt: only leave the hub when the target exists on the page
      if (a.hash && document.querySelector(a.hash)) closeHub();
      else e.preventDefault();
    }));
    document.addEventListener('gallery:close', () => root.classList.remove('is-away'));
    // hub previews: retry if autoplay was refused (power saving) or the tab was hidden when they loaded
    const playStack = () => root.querySelectorAll('.node-stack video[src]').forEach((v) => v.paused && v.play().catch(() => {}));
    root.querySelectorAll('.intro-node--stack').forEach((n) => n.addEventListener('pointerenter', playStack));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && hubShown) loadStack(); });
    document.querySelectorAll('[data-open-hub]').forEach((el) =>
      el.addEventListener('click', (e) => { e.preventDefault(); openHub(); }));
    raf = requestAnimationFrame(frame);
    (window.requestIdleCallback || setTimeout)(() => { if (!nodes.length) buildNodes(); });

    if (!playIntro) {
      start(T.burst1);
      return;
    }

    const orient = innerWidth / innerHeight < 0.9 ? 'port' : 'land';
    setSources(montage, `assets/intro/montage-${orient}`);
    setSources(tiles, 'assets/intro/letters', 2);   // v2: new B and second-A shots
    trackLoading([montage, tiles]);

    const timeout = new Promise((r) => setTimeout(r, 10000));
    await Promise.race([Promise.all([whenReady(montage), whenReady(tiles)]), timeout]);
    if (started) return;          // skipped while loading
    if (frozenAt !== null) {      // debug: ?intro&t=4.5 freezes the timeline at 4.5 s
      montage.currentTime = Math.min(frozenAt, montage.duration - 0.05);
      tiles.currentTime = clamp(frozenAt - T.zoom0, 0, tiles.duration - 0.05);
      tiles.dataset.started = '1';
      start(frozenAt);
      return;
    }
    try {
      await montage.play();
      start(0);
    } catch (e) {
      start(T.burst1);            // autoplay blocked (e.g. iOS low power mode): go straight to the hub
    }
  }

  window.__intro = { get nodes() { return nodes; }, get W() { return W; }, get H() { return H; } };
  boot();
})();
