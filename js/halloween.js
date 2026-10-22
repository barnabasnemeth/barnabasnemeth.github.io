/* One-off Halloween season: Budapest midnight, October 22 through October 31, 2026.
   Explicit offsets account for the October 25 daylight-saving transition. */
(function () {
  const start = Date.parse('2026-10-22T00:00:00+02:00');
  const end = Date.parse('2026-11-01T00:00:00+01:00');
  let timer;
  let products = [];
  let loading = false;
  let loadedAt = 0;
  async function loadProducts() {
    if (loading || !window.cremesSupabase || Date.now() - loadedAt < 60000) return;
    loading = true;
    try {
      const { data, error } = await window.cremesSupabase().from('products')
        .select('name,is_available,order_until').eq('product_kind', 'seasonal')
        .eq('is_available', true).order('sort_order');
      products = error ? [] : (data || []);
    } catch { products = []; }
    loadedAt = Date.now();
    loading = false;
    update();
  }
  function update() {
    window.clearTimeout(timer);
    const now = Date.now();
    const active = now >= start && now < end;
    document.documentElement.classList.toggle('halloween', active);
    if (document.body) {
      let banner = document.querySelector('.halloween-banner');
      if (active && !banner) {
        banner = document.createElement('aside');
        banner.className = 'halloween-banner';
        banner.setAttribute('aria-label', 'Halloween a Créme’s-ben');
        banner.innerHTML = '<span class="halloween-pumpkin" aria-hidden="true">🎃</span><div class="halloween-banner-copy"><p class="halloween-kicker">HALLOWEEN A CRÉME’S-BEN</p><h2>Édesen borzongató napok</h2><p class="halloween-promo"></p><a class="halloween-order" href="/rendeles#seasonalOrderSection"></a></div><span class="halloween-bats" aria-hidden="true"><i></i><i></i><i></i></span>';
        const hero = document.getElementById('landing');
        if (hero) hero.after(banner);
        else (document.querySelector('main') || document.body).prepend(banner);
      } else if (!active && banner) banner.remove();
      if (active) {
        const box = products.find(product => /halloween/i.test(product.name) && /box/i.test(product.name) && window.CremesSeasonal?.isOrderable(product));
        banner.querySelector('.halloween-kicker').textContent = box ? box.name : 'HALLOWEEN A CRÉME’S-BEN';
        banner.querySelector('.halloween-promo').textContent = box
          ? 'Egy doboznyi édes borzongás. Rendeld meg az ünnepi finomságokat!'
          : 'Egy csipet varázslat, egy falat boldogság. Fedezd fel kínálatunkat!';
        const link = banner.querySelector('.halloween-order');
        link.textContent = box ? 'Megrendelem a Halloween-boxot ↗' : 'Megnézem a kínálatot ↗';
        link.setAttribute('href', box ? '/rendeles#seasonalOrderSection' : '/rendeles');
        if (!document.querySelector('.halloween-atmosphere')) {
          const atmosphere = document.createElement('div');
          atmosphere.className = 'halloween-atmosphere';
          atmosphere.setAttribute('aria-hidden', 'true');
          atmosphere.innerHTML = '<span class="halloween-moon"></span><span class="halloween-fog"></span><span class="halloween-flying-bat"></span><span class="halloween-flying-bat"></span><span class="halloween-flying-bat"></span>';
          document.body.append(atmosphere);
        }
        loadProducts();
      } else document.querySelector('.halloween-atmosphere')?.remove();
    }
    // Recheck clock changes and fire at the exact boundary in an active tab.
    if (now < end) timer = window.setTimeout(update, Math.min(60000, (now < start ? start : end) - now));
  }
  update();
  document.addEventListener('DOMContentLoaded', update, { once: true });
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pageshow', update);
})();
