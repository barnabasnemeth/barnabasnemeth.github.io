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

    function setActiveNavLink() {
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
    setActiveNavLink(); // Set the initial active link
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

    // Async function to fetch and populate the pricing table
    async function fetchPricingData() {
        try {
            const response = await fetch(pricingSheetUrl);
            const text = await response.text();
            const data = JSON.parse(text.substring(47, text.length - 2));
            const pricingTableBody = document.getElementById('pricing-table-body');
            const rows = data.table.rows;

            // Skip the first row
            rows.slice(1).forEach(row => {
                const name = row.c[0]?.v || 'N/A';
                const exemption = row.c[1]?.v || '';
                const price = row.c[2]?.v || 'N/A';
                const combinedName = exemption ? `${name} <span class="small-text">(${exemption})</span>` : name;

                const tableRow = `
                    <tr>
                        <td>${combinedName}</td>
                        <td>${price}</td>
                    </tr>
                `;
                pricingTableBody.insertAdjacentHTML('beforeend', tableRow);
            });
        } catch (error) {
            console.error('Error fetching pricing data:', error);
            document.getElementById('pricing-table-body').innerHTML = '<tr><td colspan="2">Hiba történt az adatok betöltése közben.</td></tr>';
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

            // Skip the first row
            rows.slice(1).forEach(row => {
                const itemName = row.c[0]?.v || 'N/A';
                const listItem = `- ${itemName}<br>`;
                extraList.insertAdjacentHTML('beforeend', listItem);
            });
        } catch (error) {
            console.error('Error fetching extra data:', error);
            document.getElementById('extra-list').innerHTML = '<p>Hiba történt az adatok betöltése közben.</p>';
        }
    }

    // Execute both fetch operations concurrently
    await Promise.all([fetchPricingData(), fetchExtraData()]);
});



// Nyitvatartás fetch
document.addEventListener('DOMContentLoaded', async () => {
    const openingHoursSheetUrl = 'https://docs.google.com/spreadsheets/d/1QZOUq7eYXNSwd3CkgJmQMCGrDCxqQ7FO2RmozPnQWkM/gviz/tq?sheet=nyitvatartas&tqx=out:json';

    try {
        // Fetch and parse data for opening hours
        const openingHoursResponse = await fetch(openingHoursSheetUrl);
        const openingHoursText = await openingHoursResponse.text();
        const openingHoursData = JSON.parse(openingHoursText.substring(47, openingHoursText.length - 2));
        const openingHoursRows = openingHoursData.table.rows;
        const openingHoursList = document.getElementById('opening-hours-list');

        // Exclude the first row (header row) and populate the opening hours list
        openingHoursRows.slice(1).forEach(row => {
            const day = row.c[0]?.v || 'N/A';
            const openTime = row.c[1]?.v || '';
            const closeTime = row.c[2]?.v || '';

            let listItem;
            if (openTime.toLowerCase() === 'zárva') {
                listItem = `<li>${day}: Zárva</li>`;
            } else {
                listItem = `<li>${day}: ${openTime} - ${closeTime}</li>`;
            }

            openingHoursList.insertAdjacentHTML('beforeend', listItem);
        });

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
  
