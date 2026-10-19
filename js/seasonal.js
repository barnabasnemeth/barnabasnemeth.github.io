/* Seasonal dates are Budapest wall times, matching the database columns. */
(function () {
  const LOGO = '/images/logo.png';
  function budapestNow(now = new Date()) {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).format(now);
    return parts.replace(' ', 'T');
  }
  function isOrderable(product, now = new Date()) {
    return product.is_available === true && !!product.order_until &&
      budapestNow(now) < product.order_until.replace(' ', 'T');
  }
  function onlySeasonal(products) {
    return products.length > 0 && products.every(p => p.product_kind === 'seasonal');
  }
  function pickupBounds(products, today, leadDays) {
    const dt = new Date(today + 'T12:00:00Z');
    dt.setUTCDate(dt.getUTCDate() + (onlySeasonal(products) ? 0 : leadDays));
    let min = dt.toISOString().slice(0, 10);
    let max = '';
    products.filter(p => p.product_kind === 'seasonal').forEach(p => {
      if (p.pickup_from > min) min = p.pickup_from;
      if (!max || p.pickup_until < max) max = p.pickup_until;
    });
    return { min, max, empty: !!max && min > max };
  }
  function dateLabel(value) {
    return String(value || '').slice(0, 10).replaceAll('-', '. ') + '.';
  }
  // Slot labels are Budapest wall times (e.g. 12–14 or 12:00–14:00).
  function pickupSlotStart(date, label) {
    const match = String(label).match(/^\s*([0-9]{1,2})(?::([0-9]{2}))?\s*[–—-]\s*(?:[0-9]{1,2})(?::[0-9]{2})?\s*$/);
    if (!match || Number(match[1]) > 23 || Number(match[2] || 0) > 59) return NaN;
    const wall = date + 'T' + match[1].padStart(2, '0') + ':' + (match[2] || '00') + ':00';
    const nominal = Date.parse(wall + 'Z');
    let instant = nominal;
    for (let i = 0; i < 3; i++) {
      instant += nominal - Date.parse(budapestNow(new Date(instant)) + 'Z');
    }
    // Like PostgreSQL, choose standard time for the repeated autumn hour.
    const candidates = [instant - 3600000, instant, instant + 3600000]
      .filter(value => budapestNow(new Date(value)) === wall);
    return candidates.length ? Math.max(...candidates) : NaN;
  }
  function pickupSlotAllowed(products, date, label, leadDays, now = new Date()) {
    const start = pickupSlotStart(date, label);
    const lead = onlySeasonal(products) ? 0 : leadDays * 86400000;
    return Number.isFinite(start) && start > now.getTime() && start >= now.getTime() + lead;
  }
  function deadlineLabel(value) {
    return dateLabel(value) + ' ' + String(value || '').slice(11, 16);
  }
  function imageUrl(value) {
    const url = String(value || '').trim();
    return /^(https?:\/\/|\/(?!\/))/i.test(url) ? url : LOGO;
  }
  function applyImageFallback(img) {
    img.addEventListener('error', () => {
      if (img.getAttribute('src') !== LOGO) img.src = LOGO;
      img.classList.add('seasonal-logo');
    });
  }
  window.CremesSeasonal = { LOGO, budapestNow, isOrderable, onlySeasonal, pickupBounds, pickupSlotStart, pickupSlotAllowed, dateLabel, deadlineLabel, imageUrl, applyImageFallback };
})();
