// Order-page data and rules. Prices sent to the server are ignored there.
(function () {
  let pending = null;

  function budapestToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }

  function addCalendarDays(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  function weekdayOf(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  function settings() {
    return (window.CREMES_ORDER && window.CREMES_ORDER.settings) || {};
  }

  async function cremesEnsureOrderData() {
    if (!pending) pending = fetchOrderData();
    return pending;
  }

  async function fetchOrderData() {
    const client = window.cremesSupabase();
    const [productsRes, settingsRes, slotsRes, blackoutsRes] = await Promise.all([
      client.from('products')
        .select('id,name,dietary_tags,image_url,show_on_homepage,is_available,sort_order,product_prices(slices,price_huf)')
        .eq('is_available', true)
        .order('sort_order'),
      client.from('order_settings').select('*').eq('id', 1).single(),
      client.from('pickup_slots').select('weekday,label,sort_order').order('sort_order'),
      client.from('blackout_ranges').select('starts_on,ends_on,blocks_cakes_only,message').order('starts_on')
    ]);

    const error = productsRes.error || settingsRes.error || slotsRes.error || blackoutsRes.error;
    if (error) throw error;

    const products = (productsRes.data || []).map(row => {
      const prices = {};
      let unitPrice = null;
      (row.product_prices || []).forEach(price => {
        if (price.slices == null) unitPrice = price.price_huf;
        else prices[price.slices] = price.price_huf;
      });
      return {
        id: row.id,
        name: row.name,
        dietaryTags: row.dietary_tags || '',
        imageUrl: row.image_url || '',
        showOnHomepage: row.show_on_homepage,
        prices,
        unitPrice
      };
    });

    window.CREMES_ORDER = {
      products,
      settings: settingsRes.data,
      slots: slotsRes.data || [],
      blackouts: blackoutsRes.data || []
    };
    return window.CREMES_ORDER;
  }

  function cremesSlotsForDate(dateStr) {
    if (!dateStr || !window.CREMES_ORDER) return [];
    const day = weekdayOf(dateStr);
    return window.CREMES_ORDER.slots
      .filter(slot => Number(slot.weekday) === day)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(slot => slot.label);
  }

  function cremesMinPickupDate() {
    const lead = Number(settings().min_lead_days);
    const days = Number.isFinite(lead) ? lead : 2;
    return addCalendarDays(budapestToday(), days);
  }

  function cremesDayDiff(dateStr) {
    if (!dateStr) return null;
    const today = budapestToday();
    const [y1, m1, d1] = today.split('-').map(Number);
    const [y2, m2, d2] = dateStr.split('-').map(Number);
    const a = Date.UTC(y1, m1 - 1, d1);
    const b = Date.UTC(y2, m2 - 1, d2);
    return Math.round((b - a) / 86400000);
  }

  function cremesIsRush(dateStr) {
    const diff = cremesDayDiff(dateStr);
    if (diff == null) return false;
    const within = Number(settings().rush_within_days);
    const days = Number.isFinite(within) ? within : 5;
    return diff < days;
  }

  function cremesPickupBlock(dateStr, hasSliceCake) {
    if (!dateStr) return '';
    const ranges = window.CREMES_ORDER?.blackouts || [];
    const closed = ranges.find(range =>
      !range.blocks_cakes_only && dateStr >= range.starts_on && dateStr <= range.ends_on
    );
    if (closed) return closed.message || 'A választott napon nincs átvétel.';
    if (!hasSliceCake) return '';
    const cfg = settings();
    if (cfg.block_cakes_on_monday && weekdayOf(dateStr) === 1) {
      return cfg.monday_block_message || 'Hétfőn torta nem adható át.';
    }
    const hit = ranges.find(range =>
      range.blocks_cakes_only && dateStr >= range.starts_on && dateStr <= range.ends_on
    );
    if (hit) return hit.message || 'A választott napon torta nem adható át.';
    return '';
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function cremesApplyOrderCopy(data) {
    const cfg = data.settings || {};
    const list = document.querySelector('.guest-notice-list');
    if (list) {
      list.replaceChildren();
      [cfg.guest_notice_allergy, cfg.guest_notice_rush].forEach(text => {
        if (!text) return;
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
      });
    }
    const help = document.getElementById('pickupHelpText');
    if (help && cfg.pickup_help_text) help.textContent = cfg.pickup_help_text;
    const warning = document.getElementById('urgencyWarning');
    if (warning && cfg.rush_warning_text) {
      const rest = String(cfg.rush_warning_text).replace(/^Figyelem!\s*/i, '');
      warning.innerHTML = '<strong>Figyelem!</strong> ' + escapeText(rest);
    }
  }

  async function cremesSubmitOrder(body) {
    const client = window.cremesSupabase();
    const { data, error } = await client.rpc('submit_order', { payload: body });
    if (error) {
      const message = error.message || 'Sajnáljuk, hiba történt a mentésnél.';
      throw new Error(message);
    }
    if (!data || data.ok !== true || data.order_number == null) {
      throw new Error('A rendelés mentése nem sikerült.');
    }
    return data;
  }

  window.cremesEnsureOrderData = cremesEnsureOrderData;
  window.cremesSlotsForDate = cremesSlotsForDate;
  window.cremesMinPickupDate = cremesMinPickupDate;
  window.cremesIsRush = cremesIsRush;
  window.cremesPickupBlock = cremesPickupBlock;
  window.cremesApplyOrderCopy = cremesApplyOrderCopy;
  window.cremesSubmitOrder = cremesSubmitOrder;

  document.addEventListener('DOMContentLoaded', () => {
    cremesEnsureOrderData()
      .then(data => {
        cremesApplyOrderCopy(data);
        if (typeof window.updatePickupSlots === 'function') window.updatePickupSlots();
      })
      .catch(err => console.error('Rendelési adatok betöltése sikertelen:', err));
  });
})();
