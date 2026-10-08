/* Homepage carousel controls; Bootstrap remains responsible for slide transitions. */
document.addEventListener('DOMContentLoaded', () => {
    const menu = document.getElementById('navbarNav');
    if (menu && window.jQuery) {
        menu.addEventListener('click', event => {
            const link = event.target.closest('.nav-link');
            if (!link || !menu.classList.contains('show') || window.innerWidth >= 992) return;
            const target = document.querySelector(link.getAttribute('href'));
            if (!target) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            window.jQuery(menu).one('hidden.bs.collapse', () => {
                target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            }).collapse('hide');
        }, true);
    }
    const carousel = document.getElementById('carouselExampleIndicators');
    if (!carousel || !window.jQuery) return;
    const slides = window.jQuery(carousel);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    function syncPlayback() {
        slides.carousel(motion.matches ? 'pause' : 'cycle');
    }
    motion.addEventListener('change', syncPlayback);
    window.addEventListener('load', syncPlayback);
    syncPlayback();
});
