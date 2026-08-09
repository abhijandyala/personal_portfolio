document.addEventListener('DOMContentLoaded', () => {
  // Custom Cursor
  const cursor = document.querySelector('.cursor');
  const hoverElements = document.querySelectorAll('a, button, .stack-item, .work-card, .win-card, .info-card');
  
  if (window.matchMedia('(hover: hover)').matches && cursor) {
    document.addEventListener('mousemove', (e) => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    });

    hoverElements.forEach(el => {
      el.addEventListener('mouseenter', () => cursor.classList.add('hover'));
      el.addEventListener('mouseleave', () => cursor.classList.remove('hover'));
    });

    document.addEventListener('mouseenter', () => cursor.style.opacity = '1');
    document.addEventListener('mouseleave', () => cursor.style.opacity = '0');
  } else if (cursor) {
    cursor.style.display = 'none';
  }

  // Live Time in Nav
  const updateTime = () => {
    const timeEl = document.getElementById('time');
    if (timeEl) {
      const now = new Date();
      const options = { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false
      };
      timeEl.textContent = now.toLocaleTimeString('en-US', options);
    }
  };
  updateTime();
  setInterval(updateTime, 1000);

  // Smooth Scroll
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      
      // Skip modal links
      if (href.startsWith('#project-')) {
        return;
      }
      
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // Modal handling
  const handleModalState = () => {
    const isModalOpen = window.location.hash.startsWith('#project-');
    if (isModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  };

  // Check on load and hash change
  handleModalState();
  window.addEventListener('hashchange', handleModalState);

  // Modal close on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', () => {
      history.pushState('', document.title, window.location.pathname);
      document.body.style.overflow = '';
    });
  });

  // Modal close button
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState('', document.title, window.location.pathname);
      document.body.style.overflow = '';
    });
  });

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && window.location.hash.startsWith('#project-')) {
      history.pushState('', document.title, window.location.pathname);
      document.body.style.overflow = '';
    }
  });

  // Intersection Observer for animations
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const animateOnScroll = (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  };

  const observer = new IntersectionObserver(animateOnScroll, observerOptions);

  document.querySelectorAll('.section').forEach(section => {
    section.style.opacity = '0';
    section.style.transform = 'translateY(40px)';
    section.style.transition = 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
    observer.observe(section);
  });

  // Add visible class styles
  const style = document.createElement('style');
  style.textContent = `
    .section.visible {
      opacity: 1 !important;
      transform: translateY(0) !important;
    }
    
    .work-card,
    .win-card {
      opacity: 0;
      transform: translateY(30px);
      transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s;
    }
    
    .section.visible .work-card,
    .section.visible .win-card {
      opacity: 1;
      transform: translateY(0);
    }
    
    .section.visible .work-card:nth-child(1) { transition-delay: 0.1s; }
    .section.visible .work-card:nth-child(2) { transition-delay: 0.2s; }
    .section.visible .wins-featured .win-card:nth-child(1) { transition-delay: 0.1s; }
    .section.visible .wins-featured .win-card:nth-child(2) { transition-delay: 0.2s; }
    .section.visible .wins-grid .win-card:nth-child(1) { transition-delay: 0.2s; }
    .section.visible .wins-grid .win-card:nth-child(2) { transition-delay: 0.3s; }
    .section.visible .wins-grid .win-card:nth-child(3) { transition-delay: 0.4s; }
    
    
    .info-card {
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    .section.visible .info-card {
      opacity: 1;
      transform: translateY(0);
    }
    
    .section.visible .info-card:nth-child(1) { transition-delay: 0.1s; }
    .section.visible .info-card:nth-child(2) { transition-delay: 0.2s; }
  `;
  document.head.appendChild(style);

  // Code typing effect
  const codeContent = document.querySelector('.code-content');
  if (codeContent) {
    const originalHTML = codeContent.innerHTML;
    codeContent.innerHTML = '';
    
    let charIndex = 0;
    const typeCode = () => {
      if (charIndex < originalHTML.length) {
        // Handle HTML tags
        if (originalHTML[charIndex] === '<') {
          const closingIndex = originalHTML.indexOf('>', charIndex);
          codeContent.innerHTML += originalHTML.substring(charIndex, closingIndex + 1);
          charIndex = closingIndex + 1;
        } else {
          codeContent.innerHTML += originalHTML[charIndex];
          charIndex++;
        }
        
        const delay = Math.random() * 20 + 10;
        setTimeout(typeCode, delay);
      }
    };
    
    setTimeout(typeCode, 1000);
  }

  // Parallax effect on scroll
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const scrolled = window.pageYOffset;
        const heroVisual = document.querySelector('.hero-visual');
        if (heroVisual && scrolled < window.innerHeight) {
          heroVisual.style.transform = `translateY(${scrolled * 0.2}px)`;
        }
        ticking = false;
      });
      ticking = true;
    }
  });

  // Magnetic button effect
  const magneticBtns = document.querySelectorAll('.btn-primary, .btn-secondary');
  magneticBtns.forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = `translate(${x * 0.2}px, ${y * 0.2}px)`;
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translate(0, 0)';
    });
  });

  // Info card hover effect
  const infoCards = document.querySelectorAll('.info-card');
  infoCards.forEach(card => {
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'var(--accent)';
      card.style.transform = 'translateY(-4px)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'var(--border)';
      card.style.transform = 'translateY(0)';
    });
  });
});
