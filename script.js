// Initialize Google Map
function initMap() {
    const bakeryLocation = { lat: -34.397, lng: 150.644 };
    const map = new google.maps.Map(document.getElementById('map'), {
        zoom: 15,
        center: bakeryLocation,
    });
    new google.maps.Marker({
        position: bakeryLocation,
        map: map,
    });
}

// Load the Google Maps API script
function loadScript(src) {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    document.head.appendChild(script);
}
loadScript('https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&callback=initMap');

// Add background to the navbar when scrolling
window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    const socialIcons = document.querySelectorAll('.social-icon');
    if (window.scrollY > 50) {
        socialIcons.forEach(icon => icon.classList.remove('d-none'));
        navbar.classList.add('scrolled');
        navbar.classList.remove('transparent');
    } else {
        socialIcons.forEach(icon => icon.classList.add('d-none'));
        navbar.classList.remove('scrolled');
        navbar.classList.add('transparent');
    }
});

// Make scrollToSection a global function
function scrollToSection(sectionId) {
    const targetElement = document.getElementById(sectionId);
    const navbar = document.querySelector('.navbar');
    const navbarHeight = navbar.offsetHeight;

    if (targetElement) {
        const scrollToPosition = targetElement.offsetTop - navbarHeight;

        window.scrollTo({
            top: scrollToPosition,
            behavior: 'smooth',
        });

        // Prevent adding #id to the URL
        history.replaceState(null, '', ' ');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const heroCarousel = document.getElementById('carouselExampleIndicators');
    if (heroCarousel && window.jQuery) {
        window.jQuery(heroCarousel).carousel({
            interval: 5000,
            pause: false,
            wrap: true,
        });
    }

    // Smooth Scrolling
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section');
    const navbar = document.querySelector('.navbar');
    const navbarHeight = navbar.offsetHeight;

    navLinks.forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1); // Remove leading '#'
            scrollToSection(targetId);
        });
    });

    function isDesktopNav() {
        return window.matchMedia('(min-width: 992px)').matches;
    }

    function setActiveNavLink() {
        if (!isDesktopNav()) {
            navLinks.forEach(link => link.classList.remove('active'));
            return;
        }

        const scrollPosition = window.scrollY + navbarHeight + 20;

        sections.forEach((section, index) => {
            const sectionTop = section.offsetTop;
            const sectionBottom = sectionTop + section.offsetHeight;

            if (scrollPosition >= sectionTop && scrollPosition < sectionBottom) {
                navLinks.forEach(link => link.classList.remove('active'));
                navLinks[index].classList.add('active');
            }
        });
    }

    window.addEventListener('scroll', setActiveNavLink);
    window.addEventListener('resize', setActiveNavLink);
    setActiveNavLink();
});



document.addEventListener('DOMContentLoaded', () => {


    // Load More / See Less Buttons
    const loadMoreBtn = document.getElementById('loadMore');
    const seeLessBtn = document.getElementById('seeLess');
    const loadMoreContent = document.querySelector('.load-more-content');
    const lastVisibleProduct = document.querySelector('#products .row .col-md-4:nth-child(6)');

    if (loadMoreBtn && seeLessBtn && loadMoreContent) {
        loadMoreBtn.addEventListener('click', () => {
            loadMoreContent.style.display = 'flex';
            loadMoreBtn.style.display = 'none';
            seeLessBtn.style.display = 'inline-block';
        });

        seeLessBtn.addEventListener('click', () => {
            loadMoreContent.style.display = 'none';
            loadMoreBtn.style.display = 'inline-block';
            seeLessBtn.style.display = 'none';

            // Scroll back to the last originally visible product
            lastVisibleProduct.scrollIntoView({ behavior: 'smooth' });
        });
    }  
  
      



    // Floating Animation for Pricing Images
    const pricingImages = document.querySelectorAll('#pricing img');
    const floatObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('float-in');
                floatObserver.unobserve(entry.target);
            }
        });
    });

    pricingImages.forEach(img => {
        floatObserver.observe(img);
    });

    pricingImages.forEach(img => {
        img.addEventListener('mouseover', () => {
            img.classList.add('hover-float');
        });
        img.addEventListener('mouseout', () => {
            img.classList.remove('hover-float');
        });
    });
});

// Kínálatunk fetch
document.addEventListener('DOMContentLoaded', async () => {
    const pricingSheetUrl = 'https://docs.google.com/spreadsheets/d/1QZOUq7eYXNSwd3CkgJmQMCGrDCxqQ7FO2RmozPnQWkM/gviz/tq?sheet=tortak&tqx=out:json';
    const extraSheetUrl = 'https://docs.google.com/spreadsheets/d/1QZOUq7eYXNSwd3CkgJmQMCGrDCxqQ7FO2RmozPnQWkM/gviz/tq?sheet=egyeb&tqx=out:json';
    const SLICE_SIZES = [8, 12, 16, 24];

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseFtLikeToNumber(s) {
        if (!s) return NaN;
        return Number(String(s).replace(/\s|\.|,-|,|Ft/gi, '').trim());
    }

    function parsePriceTriple(cellText) {
        const out = {};
        if (!cellText) return out;

        const parts = String(cellText).split('/').map(p => p.trim());
        if (parts.length < 2) return out;

        const mapOrder = [8, 12, 16, 24];
        parts.forEach((part, idx) => {
            const val = parseFtLikeToNumber(part);
            if (!isNaN(val) && mapOrder[idx] != null) {
                out[mapOrder[idx]] = val;
            }
        });
        return out;
    }

    function formatPriceHu(num) {
        if (typeof num !== 'number' || isNaN(num)) return '–';
        return new Intl.NumberFormat('hu-HU').format(num) + ',-';
    }

    function parseBadges(exemption) {
        if (!exemption) return [];
        return String(exemption)
            .split(/[,;/|]+/)
            .map(b => b.trim().replace(/^\*+|\*+$/g, ''))
            .filter(Boolean)
            .map(b => b.toUpperCase());
    }

    function renderBadgesHtml(badges) {
        if (!badges.length) return '';
        const items = badges
            .map(b => `<span class="cake-badge">${escapeHtml(b)}</span>`)
            .join('');
        return `<div class="cake-badges">${items}</div>`;
    }

    function buildTableRow({ name, badges, prices, rawPriceText }) {
        const priceCells = SLICE_SIZES.map(size => {
            const val = prices[size];
            const display = val ? formatPriceHu(val) : (rawPriceText && !Object.keys(prices).length ? escapeHtml(rawPriceText) : '–');
            return `<td class="cake-pricing__price">${display}</td>`;
        }).join('');

        return `
            <tr>
                <th scope="row" class="cake-pricing__name">
                    <span class="cake-pricing__name-text">${escapeHtml(name)}</span>
                    ${renderBadgesHtml(badges)}
                </th>
                ${priceCells}
            </tr>
        `;
    }

    function buildMobileCard({ name, badges, prices, rawPriceText }) {
        let priceRows = '';

        if (Object.keys(prices).length) {
            priceRows = SLICE_SIZES.map(size => {
                const val = prices[size];
                if (!val) return '';
                return `
                    <div class="cake-card__price-row">
                        <dt class="cake-card__slice">${size} szelet</dt>
                        <dd class="cake-card__amount">${formatPriceHu(val)}</dd>
                    </div>
                `;
            }).join('');
        } else if (rawPriceText) {
            priceRows = `
                <div class="cake-card__price-row">
                    <dt class="cake-card__slice">Ár</dt>
                    <dd class="cake-card__amount">${escapeHtml(rawPriceText)}</dd>
                </div>
            `;
        }

        return `
            <article class="cake-card" role="listitem">
                <div class="cake-card__header">
                    <h3 class="cake-card__name">${escapeHtml(name)}</h3>
                    ${renderBadgesHtml(badges)}
                </div>
                <dl class="cake-card__prices">${priceRows}</dl>
            </article>
        `;
    }

    async function fetchPricingData() {
        const pricingTableBody = document.getElementById('pricing-table-body');
        const pricingCards = document.getElementById('pricing-cards');

        try {
            const response = await fetch(pricingSheetUrl);
            const text = await response.text();
            const data = JSON.parse(text.substring(47, text.length - 2));
            const rows = data.table.rows;

            rows.slice(1).forEach(row => {
                const name = String(row.c[0]?.v ?? '').trim();
                if (!name) {
                    return;
                }

                const exemption = row.c[1]?.v || '';
                const priceCell = row.c[2]?.v || '';
                const showOnIndexRaw = row.c[3]?.v || '';
                const showOnIndex = String(showOnIndexRaw).toLowerCase();

                if (showOnIndex === 'no' || showOnIndex === 'false' || showOnIndex === 'hide') {
                    return;
                }

                const badges = parseBadges(exemption);
                const prices = parsePriceTriple(priceCell);
                const item = {
                    name,
                    badges,
                    prices,
                    rawPriceText: String(priceCell).trim(),
                };

                pricingTableBody.insertAdjacentHTML('beforeend', buildTableRow(item));
                pricingCards.insertAdjacentHTML('beforeend', buildMobileCard(item));
            });
        } catch (error) {
            console.error('Error fetching pricing data:', error);
            const errorMsg = 'Hiba történt az adatok betöltése közben.';
            pricingTableBody.innerHTML = `<tr><td colspan="5">${errorMsg}</td></tr>`;
            pricingCards.innerHTML = `<p class="cake-pricing__error">${errorMsg}</p>`;
        }
    }


    // Async function to fetch and populate the "Egyéb" list
    async function fetchExtraData() {
        try {
            const response = await fetch(extraSheetUrl);
            const text = await response.text();
            const data = JSON.parse(text.substring(47, text.length - 2));
            const extraList = document.getElementById('extra-list');
            const rows = data.table.rows;

            rows.slice(1).forEach(row => {
                const itemName = String(row.c[0]?.v ?? '').trim();
                if (!itemName) {
                    return;
                }

                const listItem = document.createElement('li');
                listItem.className = 'extras-list__item';
                listItem.textContent = itemName;
                extraList.appendChild(listItem);
            });
        } catch (error) {
            console.error('Error fetching extra data:', error);
            document.getElementById('extra-list').innerHTML = '<li class="extras-list__item extras-list__item--error">Hiba történt az adatok betöltése közben.</li>';
        }
    }

    // Execute both fetch operations concurrently
    await Promise.all([fetchPricingData(), fetchExtraData()]);
});



// Nyitvatartás fetch
document.addEventListener('DOMContentLoaded', async () => {
    const openingHoursSheetUrl = 'https://docs.google.com/spreadsheets/d/1QZOUq7eYXNSwd3CkgJmQMCGrDCxqQ7FO2RmozPnQWkM/gviz/tq?sheet=nyitvatartas&tqx=out:json';

    function normalizeForMatch(text) {
        return String(text)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    try {
        const openingHoursResponse = await fetch(openingHoursSheetUrl);
        const openingHoursText = await openingHoursResponse.text();
        const openingHoursData = JSON.parse(openingHoursText.substring(47, openingHoursText.length - 2));
        const openingHoursRows = openingHoursData.table.rows;
        const openingHoursList = document.getElementById('opening-hours-list');
        const openingHoursWrapper = document.getElementById('opening-hours-wrapper');
        const openingHoursMessage = document.getElementById('opening-hours-message');

        const dataRows = openingHoursRows.slice(1);
        const globalMessage = String(dataRows[0]?.c[3]?.v || '').trim();

        dataRows.forEach(row => {
            const day = row.c[0]?.v || 'N/A';
            const openTime = row.c[1]?.v || '';
            const closeTime = row.c[2]?.v || '';

            let listItem;
            if (String(openTime).toLowerCase() === 'zárva') {
                listItem = `<li>${day}: Zárva</li>`;
            } else {
                listItem = `<li>${day}: ${openTime} - ${closeTime}</li>`;
            }

            openingHoursList.insertAdjacentHTML('beforeend', listItem);
        });

        if (globalMessage && openingHoursMessage && openingHoursWrapper) {
            openingHoursMessage.textContent = globalMessage;
            openingHoursMessage.hidden = false;

            if (normalizeForMatch(globalMessage).includes('zarva')) {
                openingHoursWrapper.classList.add('opening-hours-closed-warning');
            }
        }

    } catch (error) {
        console.error('Error fetching or processing opening hours data:', error);
        document.getElementById('opening-hours-list').innerHTML = '<li>Hiba történt az adatok betöltése közben.</li>';
    }
});




  document.addEventListener('DOMContentLoaded', () => {
    // Handle opening the modal
    const requestOfferBtn = document.getElementById('requestOfferBtn');
    const requestOfferModal = new bootstrap.Modal(document.getElementById('requestOfferModal'));
  
    requestOfferBtn.addEventListener('click', () => {
      requestOfferModal.show();
    });
  
    // Form submission handling (optional)
    document.getElementById('contactForm').addEventListener('submit', (e) => {
      e.preventDefault();  // Prevent page reload
  
      // Form data collection
      const formData = {
        name: document.getElementById('name').value,
        phone: document.getElementById('phone').value,
        email: document.getElementById('email').value,
        attendees: document.getElementById('attendees').value,
        event_date: document.getElementById('event_date').value,
        message: document.getElementById('message').value,
      };
  
      console.log('Form data submitted:', formData);
  
    // Send form data using EmailJS
    emailjs.send('service_d6x33yp', 'template_84ali8w', formData)
        .then(() => {
            alert('Az üzenet sikeresen elküldve!');
            document.getElementById('contactForm').reset();
        })
        .catch((error) => {
            alert('Hiba történt az üzenet küldése közben. Kérjük, próbálja meg újra.');
            console.error('EmailJS Error:', error);
        });
  
      requestOfferModal.hide();  // Close the modal after submission
    });
  });
  
  
// Galéria gallery js

document.addEventListener('DOMContentLoaded', function () {
    var glide = new Glide('#galeriaGlide', {
        type: 'carousel',
        perView: 4,
        focusAt: 'center',
        gap: 20,
        animationDuration: 800,
        autoplay: 3000,
        breakpoints: {
          800: {
            perView: 2
          },
          480: {
            perView: 1
          }
        }
      });
      
      glide.mount();
      
  });
  
