/*
 * Achievements: the hub's "Achievements" node opens every award as a node gallery (see gallery.js).
 * Clicking one zooms into its card, then its page fades in over it (reusing the project page
 * styles from projects.css). Content lives in assets/achievements/achievements.json.
 */
(() => {
  const root = document.getElementById('achievements');
  if (!root || !window.createNodeGallery) return;

  const panel = root.querySelector('.pj-detail');
  const article = panel.querySelector('.pj-article');
  const scroller = panel.querySelector('.pj-scroll');
  const closeBtn = panel.querySelector('.pj-close');

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // awards without a photo get a typographic tile: the placing, big, in the award's colours
  const tile = (a, big) => {
    const t = a.tile || {};
    return `<span class="ac-tile${big ? ' ac-tile--big' : ''}" style="--t-bg:${esc(t.bg || '#111')};--t-fg:${esc(t.fg || '#fff')};--t-accent:${esc(t.accent || '#fff')}">
      <b>${esc(a.rank)}</b><i>${esc(a.event)}</i></span>`;
  };

  function render(a) {
    const t = a.theme || {};
    panel.style.setProperty('--pj-bg', t.bg || '#0b0b0d');
    panel.style.setProperty('--pj-fg', t.fg || '#f4f4f4');
    panel.style.setProperty('--pj-muted', t.muted || 'rgba(244, 244, 244, 0.6)');
    panel.style.setProperty('--pj-accent', t.accent || '#ffffff');
    panel.style.setProperty('--pj-shadow', t.shadow || 'rgba(0, 0, 0, 0.5)');
    const links = a.links || [];
    const v = a.video;
    const hero = a.hero
      ? `<figure class="pj-hero${a.heroNarrow ? ' ac-hero--narrow' : ''} pj-in"><img src="${esc(a.hero)}" alt="${esc(a.event)}">${a.heroCaption ? `<figcaption>${esc(a.heroCaption)}</figcaption>` : ''}</figure>`
      : a.card || v ? '' : `<figure class="pj-hero ac-hero-tile pj-in">${tile(a, true)}</figure>`;
    article.innerHTML = `
      <header class="pj-top pj-in">
        <p class="ac-event">${esc(a.event)}</p>
        <h2 class="pj-title is-visible" id="ac-title">${esc(a.title)}</h2>
        <p class="pj-dates">${esc(a.date)}</p>
      </header>
      <div class="pj-grid${hero ? '' : ' ac-grid--solo'}">
        <div class="pj-copy">
          <p class="pj-summary pj-in">${esc(a.summary || '')}</p>
          ${(a.awards || []).length ? `<ul class="ac-awards pj-in">${a.awards.map((w) => `
            <li><b>${esc(w.place)}</b><span>${esc(w.label)}</span></li>`).join('')}</ul>` : ''}
          ${(a.bullets || []).length ? `<ul class="pj-bullets pj-in">${a.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
          ${links.length ? `<div class="pj-links pj-in">${links.map((l) => `
            <a class="pj-cta${l.primary ? '' : ' pj-cta--ghost'}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} <span aria-hidden="true">&nearr;</span></a>`).join('')}
          </div>` : ''}
        </div>
        ${hero}
      </div>
      ${(a.photos || []).length ? `
        <section class="ac-photos pj-in">
          ${a.photos.map((ph) => `<figure><img src="${esc(ph.img)}" alt="${esc(ph.caption || a.event)}" loading="lazy">${ph.caption ? `<figcaption>${esc(ph.caption)}</figcaption>` : ''}</figure>`).join('')}
        </section>` : ''}
      ${v?.src ? `
        <section class="pj-video pj-in">
          <h3>${esc(v.title || 'Video')}</h3>
          <div class="pj-video-frame is-playing"><video src="${esc(v.src)}" poster="${esc(v.poster || '')}" controls playsinline preload="none"></video></div>
        </section>` : v ? `
        <section class="pj-video pj-in">
          <h3>${esc(v.title || 'Video')}</h3>
          <button class="pj-video-frame" type="button" data-youtube="${esc(v.youtube)}" aria-label="Play ${esc(v.title || 'video')}">
            <img src="${esc(v.thumb)}" alt="">
            <span class="pj-play" aria-hidden="true"></span>
          </button>
        </section>` : ''}`;
    article.querySelectorAll('.pj-in').forEach((el, i) => el.style.setProperty('--i', i));
    scroller.scrollTop = 0;
  }

  const gallery = window.createNodeGallery({
    name: 'achievements',
    root,
    load: () => fetch('assets/achievements/achievements.json').then((r) => r.json()).then((d) =>
      d.achievements.map((a) => ({ ...a, title: esc(a.title), desc: esc(a.oneliner || ''), sub: esc(`${a.event} · ${a.date}`) }))),
    cardSize: (W, H) => {
      // phones: smaller cards and a short caption (no one-liner) so every card fits on one screen
      if (W < 600) {
        const cw = Math.round(Math.min(170, Math.max(120, Math.min(W * 0.38, H * 0.2))));
        return { cw, ch: Math.round(cw * 0.625), title: 58 };
      }
      const cw = Math.round(Math.min(280, Math.max(170, Math.min(W * 0.175, H * 0.3))));
      return { cw, ch: Math.round(cw * 0.625) };        // 16:10
    },
    titleSpace: 100,                                    // name, one-liner (up to 2 lines), event + date (up to 2 lines)
    label: (a) => `Open achievement: ${a.title}, ${a.event}`,
    cardMedia: (a) => `
      ${a.card ? `<img src="${esc(a.card)}" alt="" draggable="false"><span class="ac-badge">${esc(a.rank)}</span>` : tile(a)}
      <span class="ng-card-hint ng-card-hint--pill" aria-hidden="true">View</span>`,
    detail: {
      show(card) {
        render(card.item);
        panel.hidden = false;
        requestAnimationFrame(() => panel.classList.add('is-visible'));
        closeBtn.focus({ preventScroll: true });
      },
      hide() {
        panel.classList.remove('is-visible');
        article.querySelectorAll('video').forEach((v) => v.pause());
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
