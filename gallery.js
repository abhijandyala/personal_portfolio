/*
 * Node gallery: the shared engine behind the hub's sub-pages (SF Trip, Projects, ...).
 *   open     cards fly out of the hub node they were opened from onto a white canvas, spread apart and
 *            linked with lines and small nodes like the hub
 *   drag     cards can be moved anywhere; they never overlap - a dragged card pushes whatever it touches
 *   click    the whole scene zooms into that card, then the page's detail view takes over (video, project)
 *   close    zoom back out; "Back" returns the cards to the node and hands control back to the hub
 *
 * The hub dispatches `gallery:open` with { name, x, y }; each gallery listens for its own name and
 * dispatches `gallery:close` when it leaves.
 *
 *   createNodeGallery({
 *     name, root,                       // root: section with .ng-stage > svg.ng-links, and .ng-back
 *     load: async () => items,          // [{ id, title, sub? }, ...]
 *     cardSize: (W, H, n) => ({ cw, ch, title?, overhang?, cols? }),   // n = item count; title overrides
 *                                       // titleSpace; overhang = caption wider than the card; cols fixes the grid
 *     titleSpace,                       // px reserved under a card for its title block
 *     cardMedia: (item) => html,        // inside .ng-card-media
 *     label: (item) => aria label,
 *     sequence: true,                   // optional: items are in order (Day 1, 2, ...): cards snake across
 *                                       // the screen, arrows join each to the next, Start / End tags
 *     setup(card), frame(card), start(cards), stop(cards),      // optional hooks
 *     detail: { prepare(card), show(card), hide() },          // prepare runs inside the click
 *   })
 */
(() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ZOOM_MS = 950;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);   // "Easy Ease"
  const drift = () => ({ amp: 3 + Math.random() * 2.5, f1: 0.2 + Math.random() * 0.25, f2: 0.45 + Math.random() * 0.4, ph: Math.random() * 6.28 });

  window.createNodeGallery = function createNodeGallery(cfg) {
    const { root, detail } = cfg;
    const stage = root.querySelector('.ng-stage');
    const svg = root.querySelector('.ng-links');
    const backBtn = root.querySelector('.ng-back');
    const GAP = 22;                  // minimum space between cards (also covers the idle drift)
    let TITLE_H = cfg.titleSpace ?? 44, OVERHANG = 0, COLS = 0;

    let items = [];
    let cards = [], dots = [], edges = [], seq = [];
    let W = 0, H = 0, cw = 0, ch = 0;
    let origin = { x: 0, y: 0 };
    let state = 'closed';            // closed | opening | open | zooming | detail | unzooming | closing
    let phaseStart = 0, raf = 0, target = null, returnFocus = null, lastTick = 0;
    let drag = null;                 // { card, id, offX, offY, sx, sy, moved }
    let driftClock = 0;              // seconds of hover drift; only advances while the stage is live

    const loaded = Promise.resolve(cfg.load()).then((list) => { items = list; });

    // ---------- layout ----------

    function measure() {
      W = innerWidth;
      H = innerHeight;
      const size = cfg.cardSize(W, H, items.length);
      ({ cw, ch } = size);
      TITLE_H = size.title ?? cfg.titleSpace ?? 44;
      OVERHANG = size.overhang ?? 0;     // caption wider than the card by this much (kept on screen)
      COLS = size.cols ?? 0;             // optional fixed column count
      root.style.setProperty('--overhang', OVERHANG + 'px');
      root.style.setProperty('--cw', cw + 'px');
      root.style.setProperty('--ch', ch + 'px');
    }

    // loose grid with jitter: spread apart, room for titles; a few cards sit centred
    function homes(n) {
      const top = cfg.sequence ? 116 : 84, bottom = 44, side = Math.max(20, W * 0.06);   // room for the Start tag
      const fit = Math.max(1, Math.floor((W - side * 2 + GAP) / (cw + GAP + 10)));   // cards that fit across
      const cols = COLS ? Math.min(n, COLS) : Math.min(n, W / H > 1.15 ? 4 : 3, fit);
      const rows = Math.ceil(n / cols);
      const cellW = (W - side * 2) / cols, cellH = (H - top - bottom) / rows;
      const jx = Math.max(0, (cellW - cw) / 2) * 0.95, jy = Math.max(0, (cellH - ch - 24) / 2) * 0.95;
      const out = [];
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols), c = cfg.sequence && r % 2 ? cols - 1 - (i % cols) : i % cols;   // a sequence snakes
        const shift = n > cols && !COLS ? (r % 2 ? 0.22 : -0.1) * cellW : 0;   // stagger rows so it reads as a web, not a table (not in a fixed phone grid)
        const jitter = n > 2 ? (cfg.sequence ? 0.4 : 1) : 0.25;   // a sequence stays evenly spaced so its arrows read
        out.push({
          x: clamp(side + cellW * (c + 0.5) + shift + (Math.random() * 2 - 1) * jx * jitter, cw / 2 + 12, W - cw / 2 - 12 - OVERHANG),
          // centre the card + caption block in its cell, and keep the caption on screen
          y: clamp(top + cellH * (r + 0.5) - TITLE_H / 2 + (Math.random() * 2 - 1) * jy * jitter, top + ch / 2, H - ch / 2 - TITLE_H - 16),
        });
      }
      return out;
    }

    function buildGraph() {
      const hs = homes(cards.length);
      cards.forEach((c, i) => { c.hx = hs[i].x; c.hy = hs[i].y; });

      // small nodes in the gaps, like the hub
      // the web runs past every edge of the screen; the header corner stays clear
      const BLEED = 0.07;
      const n = Math.round(clamp((W * H * (1 + 2 * BLEED) ** 2) / 9000, 40, 150));
      dots = [];
      const headBox = { w: Math.min(W * 0.8, 340), h: 72 };   // Back button + heading (measured before the page is shown)
      const blocked = (x, y) => (x < headBox.w && y < headBox.h) ||
        cards.some((c) => Math.abs(x - c.hx) < cw * 0.5 + 20 && Math.abs(y - c.hy) < ch * 0.5 + TITLE_H + 14);
      for (let i = 0; i < n; i++) {
        let best = null, bestD = -1;
        for (let k = 0; k < 12; k++) {
          const x = (-BLEED + Math.random() * (1 + 2 * BLEED)) * W;
          const y = (-BLEED + Math.random() * (1 + 2 * BLEED)) * H;
          if (blocked(x, y)) continue;
          let d = Infinity;
          for (const q of dots) d = Math.min(d, Math.hypot(x - q.hx, y - q.hy));
          if (d > bestD) { bestD = d; best = { x, y }; }
        }
        if (best) dots.push({ hx: best.x, hy: best.y, r: 1.2 + Math.random() * 1.4, ...drift() });
      }

      // edges: minimum spanning tree over the cards (everything connected), plus near neighbours
      const all = [...cards, ...dots];
      edges = [];
      const seen = new Set();
      const add = (a, b, w) => {
        const i = all.indexOf(a), j = all.indexOf(b);
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) { seen.add(key); edges.push({ a, b, w }); }
      };
      const inTree = [cards[0]];
      while (!cfg.sequence && inTree.length < cards.length) {
        let best = null;
        for (const a of inTree) for (const b of cards) {
          if (inTree.includes(b)) continue;
          const d = Math.hypot(a.hx - b.hx, a.hy - b.hy);
          if (!best || d < best.d) best = { a, b, d };
        }
        inTree.push(best.b);
        add(best.a, best.b, 1);
      }
      const maxD = Math.sqrt((W * H) / all.length) * 1.6;
      for (const a of all) {
        const near = all.filter((b) => b !== a)
          .map((b) => ({ b, d: Math.hypot(a.hx - b.hx, a.hy - b.hy) }))
          .filter((o) => o.d < maxD * (cards.includes(a) ? 1.6 : 1)).sort((p, q) => p.d - q.d).slice(0, cards.includes(a) ? 3 : 2);
        for (const { b, d } of near) {
          if (cfg.sequence && cards.includes(a) && cards.includes(b)) continue;   // cards link only through the arrows
          add(a, b, clamp(1 - d / (maxD * 1.6)));
        }
      }

      cards.forEach(clampHome);
      resolveHomes(null);
      cards.forEach((c) => { c.px = c.hx; c.py = c.hy; c.vx = c.vy = 0; });

      svg.replaceChildren();
      seq = [];
      if (cfg.sequence) {
        const defs = document.createElementNS(SVGNS, 'defs');
        defs.innerHTML = `<marker id="ng-arrow-${cfg.name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z"/></marker>`;
        svg.appendChild(defs);
        for (let i = 0; i < cards.length - 1; i++) {
          const el = document.createElementNS(SVGNS, 'line');
          el.setAttribute('class', 'ng-seq');
          el.setAttribute('marker-end', `url(#ng-arrow-${cfg.name})`);
          seq.push({ a: cards[i], b: cards[i + 1], el });
        }
      }
      for (const e of edges) {
        e.el = document.createElementNS(SVGNS, 'line');
        e.el.setAttribute('stroke-opacity', (0.1 + e.w * 0.25).toFixed(3));
        svg.appendChild(e.el);
      }
      for (const d of dots) {
        d.el = document.createElementNS(SVGNS, 'circle');
        d.el.setAttribute('r', d.r);
        svg.appendChild(d.el);
      }
      for (const q of seq) svg.appendChild(q.el);    // arrows on top of the web
    }

    function makeCards() {
      stage.querySelectorAll('.ng-card').forEach((el) => el.remove());
      cards = items.map((item, i) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'ng-card';
        el.setAttribute('aria-label', cfg.label(item));
        el.innerHTML = `
          ${cfg.sequence && (i === 0 || i === items.length - 1) ? `<span class="ng-tag">${i === 0 ? 'Start' : 'End'}</span>` : ''}
          <span class="ng-card-media">${cfg.cardMedia(item)}</span>
          <span class="ng-card-title">
            <strong>${item.title}</strong>${item.desc ? `<span class="ng-card-desc">${item.desc}</span>` : ''}${item.sub ? `<small>${item.sub}</small>` : ''}
          </span>`;
        const card = { item, el, delay: i * 0.045, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, hx: 0, hy: 0, rot: 0, wob: 1, ...drift() };
        el.addEventListener('click', () => {
          if (card.dragged) { card.dragged = false; return; }
          zoomTo(card);
        });
        stage.appendChild(el);
        cfg.setup?.(card);
        bindDrag(card);
        return card;
      });
    }

    // ---------- dragging + collisions ----------
    // Every card springs toward a home spot. While a card is held, its home follows the pointer on a
    // soft, slightly bouncy spring (it trails the cursor with a bit of weight and tilts as it moves).
    // Collisions move homes, never cards directly: a card in the way gets a new home just clear of the
    // held card and glides there on a quick spring, pushing its own neighbours the same way. Homes are
    // only re-solved while something is being dragged, so nothing jitters at rest.

    const HELD = { k: 110, zeta: 0.72 };     // held card: soft follow, a hint of overshoot
    const FREE = { k: 260, zeta: 1 };        // everything else: quick, no overshoot
    const box = (x, y) => ({ x, y: y + TITLE_H / 2, hw: cw / 2 + GAP / 2, hh: ch / 2 + TITLE_H / 2 + GAP / 2 });

    function clampHome(c) {
      c.hx = clamp(c.hx, cw / 2 + 10, W - cw / 2 - 10 - OVERHANG);
      c.hy = clamp(c.hy, (cfg.sequence ? 96 : 64) + ch / 2, H - ch / 2 - TITLE_H - 8);
    }

    function overlapAt(ax, ay, bx, by) {
      const A = box(ax, ay), B = box(bx, by);
      return { ox: A.hw + B.hw - Math.abs(A.x - B.x), oy: A.hh + B.hh - Math.abs(A.y - B.y), sx: Math.sign(B.x - A.x) || 1, sy: Math.sign(B.y - A.y) || 1 };
    }

    // push b's home out of a's (a moves by wa of the overlap, b by 1 - wa); if a wall blocks that
    // axis, separate along the other one
    function part(a, b, wa) {
      const o = overlapAt(a.hx, a.hy, b.hx, b.hy);
      if (o.ox <= 0 || o.oy <= 0) return false;
      const wb = 1 - wa, horizontal = o.ox < o.oy;
      if (horizontal) { a.hx -= o.sx * o.ox * wa; b.hx += o.sx * o.ox * wb; }
      else { a.hy -= o.sy * o.oy * wa; b.hy += o.sy * o.oy * wb; }
      clampHome(a);
      clampHome(b);
      const o2 = overlapAt(a.hx, a.hy, b.hx, b.hy);
      if (o2.ox > 0 && o2.oy > 0) {
        if (horizontal) { a.hy -= o2.sy * o2.oy * wa; b.hy += o2.sy * o2.oy * wb; }
        else { a.hx -= o2.sx * o2.ox * wa; b.hx += o2.sx * o2.ox * wb; }
        clampHome(a);
        clampHome(b);
      }
      return true;
    }

    function resolveHomes(held) {
      for (let it = 0; it < 10; it++) {
        let moved = false;
        for (let i = 0; i < cards.length; i++) {
          for (let j = i + 1; j < cards.length; j++) {
            const a = cards[i], b = cards[j];
            moved = part(a, b, a === held ? 0 : b === held ? 1 : 0.5) || moved;   // the held card never gets pushed
          }
        }
        if (!moved) break;
      }
      // a card pinned against a wall can't give way: then the held card's home stops short instead
      if (held) {
        for (const o of cards) if (o !== held) part(held, o, 1);
      }
    }

    // walk the held card's home toward the pointer in small steps, re-solving after each, so even a
    // fast flick pushes cards the way it's moving instead of jumping past them
    function steerHeld(card, toX, toY) {
      const dx = toX - card.hx, dy = toY - card.hy;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (Math.min(cw, ch) * 0.25)));
      for (let i = 0; i < steps; i++) {
        card.hx += dx / steps;
        card.hy += dy / steps;
        clampHome(card);
        resolveHomes(card);
      }
    }

    function springTo(c, { k, zeta }, h) {
      const damp = 2 * Math.sqrt(k) * zeta;
      c.vx += ((c.hx - c.px) * k - c.vx * damp) * h;
      c.vy += ((c.hy - c.py) * k - c.vy * damp) * h;
      c.px += c.vx * h;
      c.py += c.vy * h;
    }

    function bindDrag(card) {
      const el = card.el;
      el.addEventListener('pointerdown', (e) => {
        if (state !== 'open' || e.button !== 0) return;
        el.setPointerCapture(e.pointerId);
        // grab relative to where the card is drawn, so it doesn't jump when picked up
        drag = { card, id: e.pointerId, offX: e.clientX - card.x, offY: e.clientY - card.y, sx: e.clientX, sy: e.clientY, moved: false };
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag || drag.card !== card || e.pointerId !== drag.id) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) {
          drag.moved = true;
          el.classList.add('is-dragging');
          stage.classList.add('is-dragging');
        }
        if (drag.moved) steerHeld(card, e.clientX - drag.offX, e.clientY - drag.offY);
      });
      const end = (e) => {
        if (!drag || drag.card !== card || e.pointerId !== drag.id) return;
        card.dragged = drag.moved;              // a drag is not a click; the card eases into its home
        el.classList.remove('is-dragging');
        stage.classList.remove('is-dragging');
        drag = null;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
    }

    // ---------- animation ----------

    function tick(now) {
      raf = requestAnimationFrame(tick);
      const t = (now - phaseStart) / 1000;
      const dt = Math.min(0.05, lastTick ? (now - lastTick) / 1000 : 0);
      lastTick = now;
      // while zooming in, showing a detail view, or zooming out nothing on the stage moves: skip every
      // DOM write so the scale animation stays purely on the GPU
      const frozen = state === 'zooming' || state === 'detail' || state === 'unzooming';
      // the hover drift runs on its own clock, paused while frozen, so it resumes exactly where it stopped
      if (!frozen) driftClock += dt;
      const time = driftClock;
      const held = drag && drag.moved ? drag.card : null;

      if (!frozen && dt > 0) {
        const steps = Math.ceil(dt / (1 / 240)), h = dt / steps;
        for (let i = 0; i < steps; i++) for (const c of cards) springTo(c, c === held ? HELD : FREE, h);
      }

      for (const c of cards) {
        let p;
        if (state === 'closing') p = 1 - easeInOut(clamp((t - (cards.length - 1 - cards.indexOf(c)) * 0.02) / 0.6));
        else if (state === 'opening') p = easeInOut(clamp((t - c.delay) / 1.2));
        else p = 1;
        if (!frozen) {
          // idle drift fades out while a card is held, so it sits under the pointer
          c.wob += ((c === held ? 0 : 1) - c.wob) * (1 - Math.exp(-dt * 6));
          const dx = (Math.sin(time * c.f1 + c.ph) + 0.5 * Math.sin(time * c.f2 + c.ph * 1.7)) * c.amp * c.wob;
          const dy = (Math.cos(time * c.f1 * 0.9 + c.ph) + 0.5 * Math.cos(time * c.f2 * 1.1 + c.ph)) * c.amp * c.wob;
          c.x = lerp(origin.x, c.px + dx * p, p);
          c.y = lerp(origin.y, c.py + dy * p, p);
          c.p = p;
          // cards lean into their motion, then settle flat
          const lean = clamp(c.vx * (c === held ? 0.014 : 0.006), -7, 7);
          c.rot += (lean - c.rot) * (1 - Math.exp(-dt * 10));
        }
        if (!frozen || (c === target && state !== 'detail')) cfg.frame?.(c, now);   // e.g. keep the zoom target's preview playing
        if (frozen) continue;
        const s = lerp(0.18, 1, c.p);
        c.el.style.transform = `translate3d(${(c.x - cw / 2).toFixed(2)}px, ${(c.y - ch / 2).toFixed(2)}px, 0) rotate(${c.rot.toFixed(2)}deg) scale(${s})`;
        c.el.style.opacity = clamp(c.p * 1.6);
      }

      for (const z of zoomCanvases) if (z.src.width) {
        if (z.dst.width !== z.src.width) { z.dst.width = z.src.width; z.dst.height = z.src.height; }
        z.g.drawImage(z.src, 0, 0);
      }

      if (!frozen) drawLinks(t, time);

      if (state === 'opening' && t > 1.2 + cards.length * 0.045) state = 'open';
      if (state === 'closing' && t > 0.85) finishClose();
    }

    function drawLinks(t, time) {
      svg.style.opacity = state === 'closing' ? 1 - clamp(t / 0.3) : state === 'opening' ? clamp((t - 0.5) / 0.8) : 1;
      for (const d of dots) {
        d.x = d.hx + Math.sin(time * d.f1 + d.ph) * d.amp;
        d.y = d.hy + Math.cos(time * d.f1 * 0.9 + d.ph) * d.amp;
        d.el.setAttribute('cx', d.x.toFixed(1));
        d.el.setAttribute('cy', d.y.toFixed(1));
      }
      for (const e of edges) {
        e.el.setAttribute('x1', e.a.x.toFixed(1));
        e.el.setAttribute('y1', e.a.y.toFixed(1));
        e.el.setAttribute('x2', e.b.x.toFixed(1));
        e.el.setAttribute('y2', e.b.y.toFixed(1));
      }
      // sequence arrows run from the edge of one card to the edge of the next, so they follow drags
      for (const q of seq) {
        const [x1, y1] = cardEdge(q.a, q.b.x, q.b.y), [x2, y2] = cardEdge(q.b, q.a.x, q.a.y);
        q.el.setAttribute('x1', x1.toFixed(1));
        q.el.setAttribute('y1', y1.toFixed(1));
        q.el.setAttribute('x2', x2.toFixed(1));
        q.el.setAttribute('y2', y2.toFixed(1));
      }
    }

    // where the line from a card's centre toward (tx, ty) leaves the card (plus a small gap)
    function cardEdge(c, tx, ty) {
      const s = lerp(0.18, 1, c.p ?? 1);
      const hw = (cw * s) / 2 + 7, hh = (ch * s) / 2 + 7;
      const dx = tx - c.x, dy = ty - c.y;
      const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity, 1);
      return [c.x + dx * t, c.y + dy * t];
    }

    // ---------- open / close ----------

    async function open(e) {
      if (e.detail.name !== cfg.name || state !== 'closed') return;
      await loaded;
      origin = { x: e.detail.x, y: e.detail.y };
      returnFocus = document.activeElement;
      measure();
      makeCards();
      buildGraph();
      root.hidden = false;
      root.getBoundingClientRect();      // commit the hidden header so it fades in
      root.classList.add('is-shown');    // header (Back + heading) fades in with the cards
      state = 'opening';
      phaseStart = performance.now();
      cfg.start?.(cards);
      if (!raf) raf = requestAnimationFrame(tick);
      setTimeout(() => backBtn.focus({ preventScroll: true }), 400);
    }

    function close() {
      if (state === 'detail' || state === 'zooming') return closeDetail();
      if (state !== 'open' && state !== 'opening') return;
      state = 'closing';
      phaseStart = performance.now();
      root.classList.remove('is-shown'); // header fades out with the cards, not after them
      document.dispatchEvent(new CustomEvent('gallery:close', { detail: { name: cfg.name } }));
    }

    function finishClose() {
      state = 'closed';
      cancelAnimationFrame(raf);
      raf = 0;
      cfg.stop?.(cards);
      root.hidden = true;
      if (returnFocus) returnFocus.focus({ preventScroll: true });
    }

    // ---------- zoom into a card, then hand over to the detail view ----------
    // A copy of the clicked card grows from its spot to fill the screen while everything else fades
    // back. Only that one layer scales (it's rasterised once and scaled by the GPU), so nothing is
    // re-drawn mid-animation and nothing flashes. The stage itself never scales.

    let zoomEl = null, zoomCanvases = [];

    function cardRect(card) {
      return card.el.querySelector('.ng-card-media').getBoundingClientRect();
    }

    function zoomTransform(r, s) {
      const cx = W / 2 - (r.width * s) / 2, cy = H / 2 - (r.height * s) / 2;
      return `translate3d(${cx}px, ${cy}px, 0) scale(${s})`;
    }

    function zoomTo(card) {
      if (state !== 'open') return;
      state = 'zooming';
      target = card;
      detail.prepare?.(card);            // inside the click: e.g. unlock video playback with sound

      const r = cardRect(card);
      const media = card.el.querySelector('.ng-card-media');
      zoomEl = document.createElement('div');
      zoomEl.className = 'ng-zoom';
      zoomEl.style.width = r.width + 'px';
      zoomEl.style.height = r.height + 'px';
      zoomEl.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
      const copy = media.cloneNode(true);
      copy.removeAttribute('style');
      zoomEl.appendChild(copy);
      // canvases don't clone their pixels: copy them now, and keep copying (e.g. a playing preview)
      zoomCanvases = [...media.querySelectorAll('canvas')].map((src, i) => {
        const dst = copy.querySelectorAll('canvas')[i];
        dst.width = src.width;
        dst.height = src.height;
        const g = dst.getContext('2d');
        if (src.width) g.drawImage(src, 0, 0);
        return { src, dst, g };
      });
      root.appendChild(zoomEl);

      card.el.classList.add('is-target');
      stage.classList.add('is-focused');
      root.classList.add('is-focused');
      const s = Math.min((W * 0.9) / r.width, (H * 0.9) / r.height);
      zoomEl.getBoundingClientRect();    // commit the start position before animating
      requestAnimationFrame(() => {
        zoomEl.classList.add('is-moving');
        zoomEl.style.transform = zoomTransform(r, s);
      });

      setTimeout(() => {
        if (state !== 'zooming') return;
        state = 'detail';
        detail.show(card);
      }, ZOOM_MS);
    }

    function closeDetail() {
      if (state !== 'detail' && state !== 'zooming') return;
      state = 'unzooming';
      const wait = detail.hide() ?? 300;
      setTimeout(() => {
        const card = target;
        if (zoomEl && card) {
          const r = cardRect(card);
          zoomEl.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
        }
        stage.classList.remove('is-focused');
        root.classList.remove('is-focused');
        setTimeout(() => {
          zoomEl?.remove();
          zoomEl = null;
          zoomCanvases = [];
          if (card) {
            card.el.classList.remove('is-target');
            card.el.focus({ preventScroll: true });
          }
          target = null;
          state = 'open';
        }, ZOOM_MS);
      }, wait);
    }

    // ---------- wiring ----------

    document.addEventListener('gallery:open', open);
    backBtn.addEventListener('click', close);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && state !== 'closed') close(); });
    addEventListener('resize', () => {
      if (state !== 'open') return;
      measure();
      cards.forEach(clampHome);
      resolveHomes(null);
    });

    return { closeDetail, get state() { return state; } };
  };
})();
