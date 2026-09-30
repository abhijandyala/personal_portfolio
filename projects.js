/*
 * Projects: the hub's "Projects" node opens every project as a node gallery (see gallery.js).
 * Clicking a project zooms into its card, then the project page fades in over it in the
 * project's own colours. Content lives in assets/projects/projects.json.
 */
(() => {
  const root = document.getElementById('projects');
  if (!root || !window.createNodeGallery) return;

  const panel = root.querySelector('.pj-detail');
  const article = panel.querySelector('.pj-article');
  const scroller = panel.querySelector('.pj-scroll');
  const closeBtn = panel.querySelector('.pj-close');

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render(p) {
    const t = p.theme || {};
    panel.style.setProperty('--pj-bg', t.bg || '#0b0b0d');
    panel.style.setProperty('--pj-fg', t.fg || '#f4f4f4');
    panel.style.setProperty('--pj-muted', t.muted || 'rgba(244, 244, 244, 0.6)');
    panel.style.setProperty('--pj-accent', t.accent || '#ffffff');
    panel.style.setProperty('--pj-shadow', t.shadow || 'rgba(0, 0, 0, 0.5)');
    const links = p.links || [];
    const v = p.video;
    article.innerHTML = `
      <header class="pj-top pj-in">
        <div class="pj-brand">
          ${p.mark ? `<img class="pj-mark" src="${esc(p.mark)}" alt="">` : ''}
          ${p.logo ? `<img class="pj-logo" src="${esc(p.logo)}" alt="">`
            : `<h2 class="pj-title is-visible${p.wordmark === 'sans' ? ' pj-title--sans' : ''}" id="pj-title">${esc(p.title)}</h2>`}
        </div>
        ${p.logo ? `<h2 class="pj-title" id="pj-title">${esc(p.title)}</h2>` : ''}
        <p class="pj-dates">${esc(p.dates || p.tagline || '')}</p>
      </header>
      <div class="pj-grid">
        <div class="pj-copy">
          <p class="pj-summary pj-in">${esc(p.summary || '')}</p>
          ${(p.bullets || []).length ? `<ul class="pj-bullets pj-in">${p.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
          ${p.closing ? `<p class="pj-closing pj-in">${esc(p.closing)}</p>` : ''}
          ${links.length ? `<div class="pj-links pj-in">${links.map((l) => `
            <a class="pj-cta${l.primary ? '' : ' pj-cta--ghost'}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} <span aria-hidden="true">&nearr;</span></a>`).join('')}
          </div>` : ''}
        </div>
        <figure class="pj-hero pj-in"><img src="${esc(p.hero || p.card)}" alt="${esc(p.title)} screenshot"></figure>
      </div>
      ${v ? `
        <section class="pj-video pj-in">
          <h3>${esc(v.title || 'Video')}</h3>
          <button class="pj-video-frame" type="button" data-youtube="${esc(v.youtube)}" aria-label="Play ${esc(p.title)} ${esc(v.title || 'video')}">
            <img src="${esc(v.thumb)}" alt="">
            <span class="pj-play" aria-hidden="true"></span>
          </button>
        </section>` : ''}
      ${(p.panel || []).length ? `
        <section class="pj-panel pj-in">
          <h3>${esc(p.panelTitle || '')}</h3>
          <ul>${p.panel.map((m) => `<li><img src="${esc(m.img)}" alt="" loading="lazy"><span>${esc(m.label)}</span></li>`).join('')}</ul>
        </section>` : ''}`;
    article.querySelectorAll('.pj-in').forEach((el, i) => el.style.setProperty('--i', i));
    scroller.scrollTop = 0;
  }

  const gallery = window.createNodeGallery({
    name: 'projects',
    root,
    load: () => fetch('assets/projects/projects.json').then((r) => r.json()).then((d) =>
      d.projects.map((p) => ({ ...p, sub: p.dates || p.tagline, desc: p.oneliner ? esc(p.oneliner) : '' }))),
    cardSize: (W, H) => {
      const cw = Math.round(Math.min(380, Math.max(200, Math.min(W * 0.26, H * 0.62))));
      return { cw, ch: Math.round(cw * 0.625) };        // 16:10
    },
    titleSpace: 82,                                     // name, one-liner (up to 2 lines), date
    label: (p) => `Open project: ${p.title}`,
    cardMedia: (p) => `
      <img src="${esc(p.card)}" alt="" draggable="false">
      ${p.cardLabel === false ? '' : `<span class="pj-card-logo">${p.logo ? `<img src="${esc(p.logo)}" alt="" draggable="false">` : `<b>${esc(p.title)}</b>`}</span>`}
      <span class="ng-card-hint ng-card-hint--pill" aria-hidden="true">View project</span>`,
    detail: {
      show(card) {
        render(card.item);
        panel.hidden = false;
        requestAnimationFrame(() => panel.classList.add('is-visible'));
        closeBtn.focus({ preventScroll: true });
      },
      hide() {
        panel.classList.remove('is-visible');
        setTimeout(() => { panel.hidden = true; article.replaceChildren(); }, 450);
        return 450;
      },
    },
  });

  article.addEventListener('click', (e) => {
    const btn = e.target.closest('.pj-video-frame');
    if (!btn || btn.dataset.playing) return;
    btn.dataset.playing = '1';
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(btn.dataset.youtube)}?autoplay=1&rel=0&modestbranding=1`;
    f.title = btn.getAttribute('aria-label').replace(/^Play /, '');
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    const frame = document.createElement('div');       // an iframe can't live inside a <button>
    frame.className = 'pj-video-frame is-playing';
    frame.appendChild(f);
    btn.replaceWith(frame);
  });

  closeBtn.addEventListener('click', () => gallery.closeDetail());
})();
