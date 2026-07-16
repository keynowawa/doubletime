import './style.css';

const flavors = [
  {
    title: 'Main Character',
    calories: '15 cal',
    price: '₱190.00',
    tags: ['Vegan', 'Hot & Iced', 'Umami Rich', 'High Caffeine'],
    desc: 'The classic, pure ceremonial grade matcha from Uji. Perfectly balanced, rich, and vibrant.',
    image: '/assets/cocoloco-front-view.webp'
  },
  {
    title: 'Coco Loco',
    calories: '120 cal',
    price: '₱220.00',
    tags: ['Dairy-Free', 'Iced Only', 'Nutty & Sweet', 'Smooth Energy'],
    desc: 'A tropical twist of coconut and high-grade matcha. Vacation in a cup.',
    image: '/assets/cocoloco-front-view.webp'
  },
  {
    title: 'Stay Salty',
    calories: '90 cal',
    price: '₱210.00',
    tags: ['Contains Dairy', 'Iced Only', 'Savory Sweet', 'Smooth Energy'],
    desc: 'A savory, sea-salt infused matcha experience. Unexpectedly addictive.',
    image: '/assets/DT-MAT-SLT.png'
  },
  {
    title: 'Berry Cute',
    calories: '110 cal',
    price: '₱220.00',
    tags: ['Contains Dairy', 'Iced Only', 'Fruity & Creamy', 'Smooth Energy'],
    desc: 'Sweet strawberry milk folded into rich matcha. The perfect aesthetic treat.',
    image: '/assets/cocoloco-front-view.webp'
  },
  {
    title: 'Golden Hour',
    calories: '80 cal',
    price: '₱220.00',
    tags: ['Vegan', 'Hot & Iced', 'Earthy & Spiced', 'Caffeine-Free Alternative'],
    desc: 'A comforting blend of turmeric, spices, and matcha. Warmth in every sip.',
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
  const modalCloseBtn = document.getElementById('modal-close');
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

  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    // Wait for the opacity transition to finish (0.25s matching CSS) before hiding from DOM
    setTimeout(() => {
      if (!modal.classList.contains('active')) {
        modal.style.display = 'none';
      }
    }, 250);
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

  // 4. Guide Tab Interaction
  const guideTabs = document.querySelectorAll('.guide-tab');
  
  guideTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs
      guideTabs.forEach(t => t.classList.remove('active'));
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Hide all bento grids
      document.querySelectorAll('.bento-grid').forEach(grid => {
        grid.classList.remove('active');
      });
      
      // Show target bento grid
      const targetId = tab.getAttribute('data-target');
      if (targetId) {
        const targetGrid = document.getElementById(targetId);
        if (targetGrid) {
          targetGrid.classList.add('active');
        }
      }
    });
  });

});

// Scroll to top on reload (before DOM fully loaded paints)
window.addEventListener('beforeunload', () => {
  window.scrollTo(0, 0);
});
if (history.scrollRestoration) {
  history.scrollRestoration = 'manual';
}
