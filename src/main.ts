import './style.css';

const flavors = [
  {
    title: 'Main Character',
    desc: 'The classic, pure ceremonial grade matcha from Uji. Perfectly balanced, rich, and vibrant.',
    image: '/assets/cocoloco-front-view.webp' // Placeholder
  },
  {
    title: 'Coco Loco',
    desc: 'A tropical twist of coconut and high-grade matcha. Vacation in a cup.',
    image: '/assets/cocoloco-front-view.webp'
  },
  {
    title: 'Stay Salty',
    desc: 'A savory, sea-salt infused matcha experience. Unexpectedly addictive.',
    image: '/assets/cocoloco-front-view.webp'
  },
  {
    title: 'Berry Cute',
    desc: 'Sweet strawberry milk folded into rich matcha. The perfect aesthetic treat.',
    image: '/assets/cocoloco-front-view.webp'
  },
  {
    title: 'Golden Hour',
    desc: 'A comforting blend of turmeric, spices, and matcha. Warmth in every sip.',
    image: '/assets/cocoloco-front-view.webp'
  }
];

document.addEventListener('DOMContentLoaded', () => {

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
  const modalCloseBtn = document.getElementById('modal-close');
  const modalImg = document.getElementById('modal-img') as HTMLImageElement;
  const modalTitle = document.getElementById('modal-title');
  const modalDesc = document.getElementById('modal-desc');

  const openModal = (index: number) => {
    if (!modal || !modalImg || !modalTitle || !modalDesc) return;
    const flavor = flavors[index];
    if (!flavor) return;

    modalImg.src = flavor.image;
    modalTitle.textContent = flavor.title;
    modalDesc.textContent = flavor.desc;

    modal.style.display = 'flex';
    // Small delay to allow display: flex to render before adding opacity transition
    requestAnimationFrame(() => {
      modal.classList.add('active');
    });
    document.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    // Wait for the opacity transition to finish (0.4s matching CSS) before hiding from DOM
    setTimeout(() => {
      if (!modal.classList.contains('active')) {
        modal.style.display = 'none';
      }
    }, 400);
  };

  flavorItems.forEach(item => {
    item.addEventListener('click', () => {
      const indexStr = item.getAttribute('data-index');
      if (indexStr !== null) {
        openModal(parseInt(indexStr, 10));
      }
    });
  });

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
      closeModal();
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

});

// Scroll to top on reload (before DOM fully loaded paints)
window.addEventListener('beforeunload', () => {
  window.scrollTo(0, 0);
});
if (history.scrollRestoration) {
  history.scrollRestoration = 'manual';
}
