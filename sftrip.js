/*
 * Reel galleries: the hub's "SF Trip" and "VentraMatch Journey" nodes open every clip as a node
 * gallery (see gallery.js). Cards loop a silent preview; clicking one zooms in and plays the full
 * video with sound. Media and clips.json are built by tools/intro/build_reels.py.
 */
(() => {
  if (!window.createNodeGallery) return;
  reelGallery('sf-trip', 'sftrip', 'assets/sftrip/');
  reelGallery('ventramatch', 'ventramatch', 'assets/ventramatch/');

function reelGallery(id, name, ASSETS) {
  const root = document.getElementById(id);
  if (!root) return;

  const player = root.querySelector('.sf-player');
  const playerVideo = player.querySelector('video');
  const playerTitle = player.querySelector('.sf-player-title');
  const playerIg = player.querySelector('.sf-player-ig');
  const closeBtn = player.querySelector('.sf-close');
  let lastRetry = 0;
  let prepared = null;

  const gallery = window.createNodeGallery({
    name,
    sequence: true,                 // Day 1 -> Day 2 -> ... arrows, Start / End tags
    root,
    load: () => fetch(ASSETS + 'clips.json').then((r) => r.json()).then((m) => m.clips),
    cardSize: (W, H, n) => {
      // phones: pick the grid first (4 columns for long trips), then the largest card where every
      // column fits across and every row (card + caption + gap) fits down the screen
      if (W < 600) {
        const cols = n > 9 ? 4 : 3, rows = Math.ceil(n / cols), side = Math.max(20, W * 0.06);
        const byWidth = (W - side * 2 + 22) / cols - 32;
        const byHeight = ((H - 160) / rows - 70) * 9 / 16;
        const cw = Math.floor(Math.max(40, Math.min(76, byWidth, byHeight)));
        const overhang = Math.round(Math.max(0, Math.min(30, (W - side * 2) / cols - cw - 16)));   // stop short of the next card
        return { cw, ch: Math.round(cw * 16 / 9), title: 46, overhang, cols };
      }
      const cw = Math.round(Math.min(132, Math.max(64, Math.min(W * 0.085, H * 0.13))));
      return { cw, ch: Math.round(cw * 16 / 9) };
    },
    titleSpace: 54,
    label: (clip) => `Watch: ${clip.title}`,
    // previews are drawn onto a canvas from a hidden video (reliable painting inside moving layers)
    cardMedia: () => `<canvas></canvas><video muted loop playsinline preload="none"></video>
      <span class="ng-card-hint" aria-hidden="true">&#9654;</span>`,
    setup: (card) => {
      card.canvas = card.el.querySelector('canvas');
      card.g = card.canvas.getContext('2d');
      card.video = card.el.querySelector('video');
    },
    start: (cards) => cards.forEach((c) => {
      c.video.preload = 'auto';
      c.video.src = `${ASSETS}${c.item.id}-preview.mp4`;
      c.video.load();
      c.video.play().catch(() => {});
    }),
    stop: (cards) => cards.forEach((c) => { c.video.pause(); c.video.removeAttribute('src'); c.video.load(); }),
    frame: (c, now) => {
      if (c.video.readyState >= 2) {
        if (c.canvas.width !== c.video.videoWidth) { c.canvas.width = c.video.videoWidth; c.canvas.height = c.video.videoHeight; }
        c.g.drawImage(c.video, 0, 0, c.canvas.width, c.canvas.height);
      }
      // retry now and then if autoplay was refused
      if (c.video.paused && c.video.src && now - lastRetry > 1000 && !document.hidden) {
        lastRetry = now;
        c.video.play().catch(() => {});
      }
    },
    detail: {
      // unlock playback with sound inside the click (Safari requires a user gesture)
      prepare(card) {
        prepared = card;
        playerVideo.src = `${ASSETS}${card.item.id}.mp4`;
        playerVideo.muted = false;
        const unlock = playerVideo.play();
        if (unlock) unlock.then(() => { if (player.hidden) playerVideo.pause(); }).catch(() => {});
      },
      show(card) {
        playerTitle.textContent = card.item.title;
        playerIg.href = card.item.instagram;
        player.hidden = false;
        requestAnimationFrame(() => player.classList.add('is-visible'));
        playerVideo.currentTime = 0;
        playerVideo.play().catch(() => { playerVideo.muted = true; playerVideo.play().catch(() => {}); });
        closeBtn.focus({ preventScroll: true });
      },
      hide() {
        playerVideo.pause();
        player.classList.remove('is-visible');
        setTimeout(() => {
          player.hidden = true;
          playerVideo.removeAttribute('src');
          playerVideo.load();
        }, 300);
        prepared = null;
        return 300;
      },
    },
  });

  closeBtn.addEventListener('click', () => gallery.closeDetail());
  player.addEventListener('click', (e) => { if (e.target === player) gallery.closeDetail(); });
}
})();
