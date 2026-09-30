/*
 * Full-screen pages opened from a hub node (About, ...): <section class="pg" data-page="about">.
 * The page grows out of the node as a circle and shrinks back into it on Back / Escape.
 * Anything marked .pg-in fades up as it scrolls into view.
 */
(() => {
  const OPEN_MS = 900;

  document.querySelectorAll('section.pg[data-page]').forEach((root) => {
    const name = root.dataset.page;
    const scroller = root.querySelector('.pg-scroll');
    const backBtn = root.querySelector('.pg-back');
    let state = 'closed';
    let returnFocus = null;
    let timer = 0;

    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { root: scroller, rootMargin: '0px 0px -8% 0px' });

    function open(e) {
      if (e.detail.name !== name || state !== 'closed') return;
      clearTimeout(timer);
      state = 'opening';
      returnFocus = document.activeElement;
      root.style.setProperty('--ox', e.detail.x + 'px');
      root.style.setProperty('--oy', e.detail.y + 'px');
      root.hidden = false;
      scroller.scrollTop = 0;
      root.querySelectorAll('.pg-in').forEach((el) => { el.classList.remove('is-in'); io.observe(el); });
      root.getBoundingClientRect();        // commit the closed circle before growing it
      requestAnimationFrame(() => root.classList.add('is-open'));
      timer = setTimeout(() => { state = 'open'; backBtn.focus({ preventScroll: true }); }, OPEN_MS);
    }

    function close() {
      if (state !== 'open' && state !== 'opening') return;
      clearTimeout(timer);
      state = 'closing';
      root.classList.remove('is-open');
      document.dispatchEvent(new CustomEvent('gallery:close', { detail: { name } }));
      timer = setTimeout(() => {
        state = 'closed';
        root.hidden = true;
        io.disconnect();
        if (returnFocus) returnFocus.focus({ preventScroll: true });
      }, OPEN_MS);
    }

    // copy buttons (Contact emails): copy, then say so
    const toast = root.querySelector('.ct-toast');
    root.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.copy); } catch (err) { return; }
      btn.textContent = 'Copied';
      if (toast) { toast.textContent = `Copied ${btn.dataset.copy}`; toast.classList.add('is-shown'); }
      clearTimeout(btn.t);
      btn.t = setTimeout(() => { btn.textContent = 'Copy'; toast?.classList.remove('is-shown'); }, 1600);
    }));

    document.addEventListener('gallery:open', open);
    backBtn.addEventListener('click', close);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && state !== 'closed') close(); });
  });
})();
