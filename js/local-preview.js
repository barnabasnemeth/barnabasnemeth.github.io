/* Loopback-only preview. Reads a public catalog snapshot; all edits stay in this browser. */
(function () {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
  window.CREMES_LOCAL_PREVIEW = true;
  document.addEventListener('submit', event => {
    if (event.target.id !== 'contactForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.alert('A helyi előnézetben ajánlatkérés nem küldhető el.');
  }, true);
  const KEY = 'cremes-local-preview-v1';
  let initialData;
  const clone = value => JSON.parse(JSON.stringify(value));
  const session = { user: { id: 'local-preview', email: 'Helyi előnézet' } };

  function shiftDay(today, days) {
    const date = new Date(today + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  async function readData() {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return JSON.parse(stored);
    if (!initialData) initialData = fetch('/js/local-preview-data.json').then(async response => {
      if (!response.ok) throw new Error('A helyi mintaadatok nem tölthetők be.');
      const data = await response.json();
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      ['Diós bejgli', 'Mákos bejgli'].forEach((name, index) => data.products.push({
        id: '00000000-0000-4000-8000-00000000000' + (index + 1),
        name: '[Minta] ' + name, product_kind: 'seasonal',
        dietary_tags: index ? 'GM, LM' : '', seasonal_price_huf: index ? 3790 : 3590,
        image_url: null, is_available: true, show_on_homepage: true, sort_order: 10 + index * 10,
        order_until: shiftDay(today, 30) + 'T18:00:00',
        pickup_from: today, pickup_until: shiftDay(today, 40)
      }));
      window.localStorage.setItem(KEY, JSON.stringify(data));
      return data;
    });
    return clone(await initialData);
  }

  function query(table) {
    const filters = [], sorting = [];
    let operation = 'select', payload, single = false, execution;
    const builder = {
      select() { return builder; },
      eq(column, value) { filters.push(row => row[column] === value); return builder; },
      order(column, options) { sorting.push({ column, ascending: options?.ascending !== false }); return builder; },
      insert(value) { operation = 'insert'; payload = value; return builder; },
      update(value) { operation = 'update'; payload = value; return builder; },
      delete() { operation = 'delete'; return builder; },
      single() { single = true; return builder; },
      then(resolve, reject) {
        if (!execution) execution = execute();
        return execution.then(resolve, reject);
      }
    };
    async function execute() {
      try {
        const data = await readData();
        if (!Array.isArray(data[table])) throw new Error('Ismeretlen helyi adattábla.');
        const matches = row => filters.every(filter => filter(row));
        let rows = data[table].filter(matches);
        if (operation === 'insert') {
          rows = (Array.isArray(payload) ? payload : [payload]).map(row => ({
            id: window.crypto.randomUUID(), sort_order: 0, created_at: new Date().toISOString(),
            ...(table === 'products' ? { product_kind: 'cake', is_available: true, show_on_homepage: true, dietary_tags: '' } : {}),
            ...clone(row)
          }));
          data[table].push(...rows);
        } else if (operation === 'update') {
          rows.forEach(row => Object.assign(row, clone(payload), { updated_at: new Date().toISOString() }));
        } else if (operation === 'delete') {
          const ids = new Set(rows.map(row => row.id));
          data[table] = data[table].filter(row => !matches(row));
          if (table === 'products') {
            data.product_prices = data.product_prices.filter(row => !ids.has(row.product_id));
            data.order_items.forEach(row => { if (ids.has(row.product_id)) row.product_id = null; });
          }
        }
        if (operation !== 'select') window.localStorage.setItem(KEY, JSON.stringify(data));
        rows = rows.map(row => ({ ...row,
          ...(table === 'products' ? { product_prices: data.product_prices.filter(price => price.product_id === row.id) } : {}),
          ...(table === 'orders' ? { order_items: data.order_items.filter(item => item.order_id === row.id) } : {})
        }));
        rows.sort((a, b) => {
          for (const { column, ascending } of sorting) {
            const comparison = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
            if (comparison) return ascending ? comparison : -comparison;
          }
          return 0;
        });
        return { data: single ? rows[0] || null : rows, error: null };
      } catch (error) { return { data: null, error: { message: error.message } }; }
    }
    return builder;
  }

  window.cremesLocalClient = function () {
    if (!window.__cremesLocalClient) window.__cremesLocalClient = {
      from: query,
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        signInWithPassword: async () => ({ data: { session }, error: null }),
        signOut: async () => ({ error: null })
      },
      rpc: async name => name === 'is_admin' ? { data: true, error: null } : {
        data: null, error: { message: 'A helyi előnézetben rendelés nem küldhető el. A kosár és az összesítő szabadon kipróbálható.' }
      }
    };
    return window.__cremesLocalClient;
  };

  function showBanner() {
    if (document.getElementById('localPreviewNotice')) return;
    const notice = document.createElement('aside');
    notice.id = 'localPreviewNotice';
    notice.setAttribute('aria-label', 'Helyi előnézet');
    notice.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:1100;max-width:calc(100vw - 100px);padding:8px 12px;border:1px solid #c8a27a;border-radius:8px;background:#fff9ec;color:#3a2a20;font:12px/1.5 Arial,sans-serif;box-shadow:0 3px 14px #0002';
    notice.append('Helyi előnézet · Mintaadatok · Mentés ebben a böngészőben. ');
    const link = document.createElement('a');
    link.href = '/admin.html';
    link.textContent = 'Admin megnyitása';
    link.style.color = 'inherit';
    notice.append(link);
    document.body.append(notice);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
  else showBanner();
})();
