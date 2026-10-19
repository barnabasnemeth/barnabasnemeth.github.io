(function () {
  document.addEventListener('DOMContentLoaded', async () => {
    const section = document.getElementById('seasonal-home');
    const cards = document.getElementById('seasonal-home-cards');
    if (!section || !cards) return;
    const rules = window.CremesSeasonal;
    function element(tag, className, text) {
      const el = document.createElement(tag);
      el.className = className;
      if (text) el.textContent = text;
      return el;
    }
    try {
      const { data, error } = await window.cremesSupabase().from('products')
        .select('id,name,dietary_tags,image_url,is_available,seasonal_price_huf,order_until,pickup_from,pickup_until')
        .eq('product_kind', 'seasonal').eq('is_available', true).order('sort_order');
      if (error) throw error;
      function render() {
        cards.replaceChildren();
        (data || []).forEach(row => {
          const card = element('article', 'seasonal-card');
          const img = element('img', 'seasonal-card__image');
          img.addEventListener('load', () => {
            img.classList.toggle('seasonal-card__image--portrait',
              !img.classList.contains('seasonal-logo') && img.naturalWidth < img.naturalHeight);
          });
          img.src = rules.imageUrl(row.image_url);
          img.alt = row.name;
          img.loading = 'lazy';
          if (img.getAttribute('src') === rules.LOGO) img.classList.add('seasonal-logo');
          rules.applyImageFallback(img);
          const body = element('div', 'seasonal-card__body');
          body.append(element('h4', 'seasonal-card__name', row.name));
          const badges = element('div', 'cake-badges');
          String(row.dietary_tags || '').split(/[,;/|]+/).map(s => s.trim().replace(/^\*+|\*+$/g, '').toUpperCase()).filter(Boolean)
            .forEach(tag => badges.append(element('span', 'cake-badge', tag)));
          body.append(badges, element('p', 'seasonal-card__price', new Intl.NumberFormat('hu-HU').format(row.seasonal_price_huf) + ' Ft / db'));
          body.append(element('p', 'seasonal-card__dates', 'Rendelhető: ' + rules.deadlineLabel(row.order_until) + '-ig'));
          body.append(element('p', 'seasonal-card__dates', 'Átvehető: ' + rules.dateLabel(row.pickup_from) + ' – ' + rules.dateLabel(row.pickup_until)));
          if (rules.isOrderable(row)) {
            const link = element('a', 'btn cake-collection__order', 'Megrendelem ↗');
            link.href = '/rendeles#seasonalOrderSection';
            body.append(link);
          } else body.append(element('p', 'seasonal-card__closed', 'A rendelés lezárult'));
          card.append(img, body);
          cards.append(card);
        });
        section.hidden = !cards.children.length;
      }
      render();
      window.setInterval(render, 30000);
    } catch (error) {
      console.error('Szezonális kínálat betöltése sikertelen:', error);
    }
  });
})();
