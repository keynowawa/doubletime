import './style.css';

const flavors = [
  {
    title: 'Main Character',
    calories: '15 cal',
    price: '₱190.00',
    tags: ['Vegan', 'Hot & Iced', 'Umami', 'High Caffeine'],
    desc: 'The classic, pure ceremonial grade matcha from Uji. Perfectly balanced, rich, and vibrant.',
    image: '/assets/cocoloco-front-view.webp'
  },
  {
    title: 'Coco Loco',
    calories: '120 cal',
    price: '₱220.00',
    tags: ['Dairy-Free', 'Iced Only', 'Nutty', 'Smooth Energy'],
    desc: 'A tropical twist of coconut and high-grade matcha. Vacation in a cup.',
    image: '/assets/cocoloco-front-view.webp'
  },
  {
    title: 'Stay Salty',
    calories: '90 cal',
    price: '₱210.00',
    tags: ['Contains Dairy', 'Iced Only', 'Savory', 'Smooth Energy'],
    desc: 'A savory, sea-salt infused matcha experience. Unexpectedly addictive.',
    image: '/assets/DT-MAT-SLT.png'
  },
  {
    title: 'Berry Cute',
    calories: '110 cal',
    price: '₱220.00',
    tags: ['Contains Dairy', 'Iced Only', 'Fruity', 'Smooth Energy'],
    desc: 'Sweet strawberry milk folded into rich matcha. The perfect aesthetic treat.',
    image: '/assets/cocoloco-front-view.webp'
  },
  {
    title: 'Golden Hour',
    calories: '80 cal',
    price: '₱220.00',
    tags: ['Vegan', 'Hot & Iced', 'Earthy', 'Caffeine-Free Alternative'],
    desc: 'Turmeric and ginger meet creamy oat milk for a warming, spice-forward latte.',
    image: '/assets/cocoloco-front-view.webp'
  }
];

document.addEventListener('DOMContentLoaded', () => {

  if (window.location.hash) {
    // Prevent browser from automatically smoothly scrolling to the hash on load if they refresh
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    window.scrollTo(0, 0);
  }

  // Navbar Scroll Animation
  const nav = document.querySelector('.header-container');
  window.addEventListener('scroll', () => {
    // Crucial: remove load animation class so it doesn't fight scrolled state
    nav?.classList.remove('fade-slide-up');
    
    if (window.scrollY > 50) {
      nav?.classList.add('scrolled');
    } else {
      nav?.classList.remove('scrolled');
    }
  });

  // 1. Magnetic Hover on Flavor Cups
  const flavorItems = document.querySelectorAll('.flavor-item');
  flavorItems.forEach((item) => {
    const el = item as HTMLElement;
    
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      
      const pullX = x * 0.2;
      const pullY = y * 0.2;
      
      el.style.transform = `translate(${pullX}px, ${pullY}px) rotate(3deg) scale(1.05)`;
    });

    el.addEventListener('mouseleave', () => {
      el.style.transform = `translate(0px, 0px) rotate(0deg) scale(1)`;
    });
  });

  // 2. Modal Interaction
  const modal = document.getElementById('flavor-modal');
  const modalImg = document.getElementById('modal-img') as HTMLImageElement;
  const modalTitle = document.getElementById('modal-title');
  const modalDesc = document.getElementById('modal-desc');
  const modalSku = document.getElementById('modal-sku');
  const modalCal = document.getElementById('modal-cal');
  const modalPrice = document.getElementById('modal-price');
  const modalBadges = document.getElementById('modal-badges');

  const openModal = (index: number) => {
    if (!modal || !modalImg || !modalTitle || !modalDesc) return;
    const flavor = flavors[index];
    if (!flavor) return;

    modalImg.src = flavor.image;
    modalTitle.textContent = flavor.title;
    modalDesc.textContent = flavor.desc;
    
    if (modalSku) modalSku.textContent = ''; // Deprecated, will remove from HTML
    if (modalCal) modalCal.textContent = flavor.calories;
    if (modalPrice) modalPrice.textContent = flavor.price;

    // Dynamically inject rich tags
    if (modalBadges) {
      modalBadges.innerHTML = '';
      flavor.tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'badge rich-badge';
        span.textContent = tag;
        modalBadges.appendChild(span);
      });
    }

    modal.style.display = 'flex';
    // Small delay to allow display: flex to render before adding opacity transition
    setTimeout(() => {
      modal.classList.add('active');
    }, 10);
    document.body.style.overflow = 'hidden';
  };

  const closeModal = (modalEl: HTMLElement | null = null) => {
    const activeModals = modalEl ? [modalEl] : Array.from(document.querySelectorAll('.modal-overlay.active'));
    activeModals.forEach(m => {
      m.classList.remove('active');
      m.setAttribute('aria-hidden', 'true');
      
      setTimeout(() => {
        if (!m.classList.contains('active')) {
          (m as HTMLElement).style.display = 'none';
        }
      }, 300); // Wait for transition
    });
    
    document.body.style.overflow = '';
    
    // Unzoom the glass if it was zoomed
    const glassScene = document.getElementById('craft-glass-scene');
    if (glassScene) {
      glassScene.classList.remove('glass-scene-zoom');
    }
  };

  // Attach close event to all modal close buttons and overlays
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay as HTMLElement);
    });
  });

  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = (e.target as HTMLElement).closest('.modal-overlay');
      if (modal) closeModal(modal as HTMLElement);
    });
  });

  flavorItems.forEach(item => {
    item.addEventListener('click', () => {
      const indexStr = item.getAttribute('data-index');
      if (indexStr !== null) {
        openModal(parseInt(indexStr, 10));
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeModals = document.querySelectorAll('.modal-overlay.active');
      activeModals.forEach(m => closeModal(m as HTMLElement));
    }
  });

  // 3. News Slideshow (Horizontal Flex Sliding)
  const slidesContainer = document.getElementById('news-slides-container');
  const newsSlides = document.querySelectorAll('.news-slide');
  const btnNewsNext = document.getElementById('news-next');
  const btnNewsPrev = document.getElementById('news-prev');
  let currentNewsSlide = 0;
  let autoSlideInterval: number;

  if (slidesContainer && newsSlides.length > 0) {
    const updateSlidePosition = () => {
      slidesContainer.style.transform = `translateX(-${currentNewsSlide * 100}%)`;
    };

    const nextNews = () => {
      currentNewsSlide = (currentNewsSlide + 1) % newsSlides.length;
      updateSlidePosition();
    };

    const prevNews = () => {
      currentNewsSlide = (currentNewsSlide - 1 + newsSlides.length) % newsSlides.length;
      updateSlidePosition();
    };

    const startAutoSlide = () => {
      autoSlideInterval = window.setInterval(nextNews, 5000);
    };

    const stopAutoSlide = () => clearInterval(autoSlideInterval);

    if (btnNewsNext) btnNewsNext.addEventListener('click', () => { nextNews(); stopAutoSlide(); startAutoSlide(); });
    if (btnNewsPrev) btnNewsPrev.addEventListener('click', () => { prevNews(); stopAutoSlide(); startAutoSlide(); });

    startAutoSlide();
  }

  // 4. Craft Tab Interaction (Caffeine / Tasting panels)
  const guideTabs = document.querySelectorAll('.guide-tab');

  guideTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      guideTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.getAttribute('data-target');
      document.querySelectorAll('.craft-panel').forEach(panel => {
        panel.classList.remove('active');
      });

      if (targetId) {
        const target = document.getElementById(targetId);
        if (target) {
          // Brief delay so display:none → display:block fires before the opacity transition
          requestAnimationFrame(() => {
            target.classList.add('active');
          });
        }
      }
    });
  });

  // 5. IntersectionObserver — fade-in info items on scroll
  const infoItems = document.querySelectorAll('.craft-info-item');
  const fadeObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            (entry.target as HTMLElement).classList.add('visible');
          }, i * 120);
          fadeObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );
  infoItems.forEach(item => fadeObserver.observe(item));

  // 6. Glass Layer Click to Zoom Modals
  const matchaLayer  = document.querySelector('.glass-layer-hoverable[data-layer="matcha"]');
  const milkLayer    = document.querySelector('.glass-layer-hoverable[data-layer="milk"]');
  const glassScene   = document.getElementById('craft-glass-scene') as HTMLElement | null;
  const matchaModal  = document.getElementById('matcha-modal');
  const milkModal    = document.getElementById('milk-modal');

  const openGlassModal = (targetModal: HTMLElement | null) => {
    if (!glassScene || !targetModal) return;
    
    // Step 1: Zoom + fade out the glass
    glassScene.classList.add('glass-scene-zoom');
    
    // Step 2: After glass has fully dissolved, show the modal
    setTimeout(() => {
      targetModal.style.display = 'flex';
      void targetModal.offsetWidth; // Force reflow
      targetModal.classList.add('active');
      targetModal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }, 700); // Match the zoomIntoGlass keyframe duration
  };

  matchaLayer?.addEventListener('click', () => openGlassModal(matchaModal));
  milkLayer?.addEventListener('click', () => openGlassModal(milkModal));


  // 7. Caffeine Spectrum — animate fill + dot tooltips
  const spectrumFill = document.querySelector('.caf-spectrum-fill') as HTMLElement | null;
  const cafTooltip   = document.getElementById('caf-tooltip');
  const cafDots      = document.querySelectorAll('.caf-dot');

  // Animate the fill bar in when the section is scrolled to
  if (spectrumFill) {
    const specObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            spectrumFill.classList.add('animated');
            specObserver.disconnect();
          }
        });
      },
      { threshold: 0.5 }
    );
    specObserver.observe(spectrumFill);
  }

  cafDots.forEach(dot => {
    dot.addEventListener('mouseenter', () => {
      if (!cafTooltip) return;
      const name = dot.getAttribute('data-name') || '';
      const mg   = dot.getAttribute('data-mg') || '';
      const desc = dot.getAttribute('data-desc') || '';
      cafTooltip.innerHTML = `<strong>${name} — ${mg}</strong><span>${desc}</span>`;
    });
    dot.addEventListener('mouseleave', () => {
      if (!cafTooltip) return;
      cafTooltip.innerHTML = `<span style="opacity:0.4">Hover a dot to explore caffeine levels</span>`;
    });
  });

  // Set default tooltip text
  if (cafTooltip) {
    cafTooltip.innerHTML = `<span style="opacity:0.4">Hover a dot to explore caffeine levels</span>`;
  }

  // 8. Tasting Accordion
  const tastingItems = document.querySelectorAll('.tasting-item');
  tastingItems.forEach(item => {
    const trigger = item.querySelector('.tasting-trigger');
    trigger?.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      // Close all
      tastingItems.forEach(i => {
        i.classList.remove('open');
        (i as HTMLElement).style.setProperty('--item-color', '');
      });
      // Open this one if it was closed
      if (!isOpen) {
        item.classList.add('open');
        const color = item.getAttribute('data-color') || '';
        (item as HTMLElement).style.setProperty('--item-color', color);
      }
    });
  });
  // 9. Editorial Slideshow
  const slides = document.querySelectorAll('.editorial-section .slide');
  if (slides.length > 1) {
    let currentSlide = 0;
    setInterval(() => {
      slides[currentSlide].classList.remove('active');
      currentSlide = (currentSlide + 1) % slides.length;
      slides[currentSlide].classList.add('active');
    }, 4500); // 4.5 seconds
  }
});

// Scroll to top on reload (before DOM fully loaded paints)
window.addEventListener('beforeunload', () => {
  window.scrollTo(0, 0);
});
if (history.scrollRestoration) {
  history.scrollRestoration = 'manual';
}
