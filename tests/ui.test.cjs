const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const active = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Ünnepi bejgli', product_kind: 'seasonal', dietary_tags: 'GM, LM', is_available: true, show_on_homepage: true, seasonal_price_huf: 2500, image_url: null, order_until: '2099-10-28T18:00:00', pickup_from: '2020-01-01', pickup_until: '2099-12-31', sort_order: 10, product_prices: [] };
const expired = { ...active, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'Lejárt ajánlat', order_until: '2020-01-01T18:00:00' };
const hidden = { ...active, id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', name: 'Inaktív ajánlat', is_available: false };
const cake = { ...active, id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', name: 'Torta', product_kind: 'cake', product_prices: [{ slices: 8, price_huf: 14000 }] };
const settle = () => new Promise(resolve => setTimeout(resolve, 25));

async function page(file, rows, scripts, now = '2026-10-19T08:00:00Z') {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { url: 'https://example.com/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window;
  const RealDate = w.Date;
  w.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new RealDate(now).getTime(); }
  };
  await settle();
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.emailjs = { init() {} };
  w.$ = w.jQuery = selector => ({ modal(action) { w.document.querySelector(selector)?.classList.toggle('show', action === 'show'); }, on() {}, each() {}, find() { return this; }, val() { return ''; } });
  const settings = { id: 1, min_lead_days: 2, rush_within_days: 5, rush_surcharge_huf: 3000, charge_rush_surcharge: true, block_cakes_on_monday: true };
  w.cremesSupabase = () => ({
    auth: { getSession: async () => ({ data: { session: { user: { email: 'admin@example.com' } } } }) },
    rpc: async () => ({ data: true }),
    from(table) {
      let list = table === 'products' ? [...rows] : table === 'order_settings' ? [settings] : table === 'pickup_slots' ? Array.from({ length: 7 }, (_, weekday) => ({ weekday, label: '12–14', sort_order: 0 })) : [];
      let op = 'read'; let payload;
      const q = {
        select() { return q; }, order() { return q; }, limit() { return q; },
        eq(k, v) { list = list.filter(r => r[k] === v); return q; },
        update(value) { op = 'update'; payload = value; return q; },
        insert(value) { op = 'insert'; payload = value; return q; },
        delete() { op = 'delete'; return q; },
        single() { return Promise.resolve({ data: list[0], error: null }); },
        then(resolve, reject) {
          if (op === 'update') list.forEach(r => Object.assign(r, payload));
          if (op === 'insert') rows.push({ id: 'new-id', ...payload });
          if (op === 'delete') list.forEach(r => rows.splice(rows.indexOf(r), 1));
          return Promise.resolve({ data: list, error: null }).then(resolve, reject);
        }
      };
      return q;
    }
  });
  for (const script of scripts) {
    if (script === 'inline') {
      for (const el of w.document.querySelectorAll('script:not([src])')) vm.runInContext(el.textContent, dom.getInternalVMContext());
    } else if (fs.existsSync(script)) vm.runInContext(fs.readFileSync(script, 'utf8'), dom.getInternalVMContext());
  }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await settle();
  return { dom, w, errors, setNow(value) { now = value; } };
}

test('homepage shows active seasonal products after cakes, with logo and closed label', async () => {
  const { dom, w, errors } = await page('index.html', [active, expired, hidden, cake], ['js/seasonal.js', 'js/seasonal-home.js']);
  try {
    const section = w.document.getElementById('seasonal-home');
    assert.ok(section, 'seasonal homepage section exists');
    assert.equal(section.hidden, false);
    assert.match(section.textContent, /Ünnepi bejgli/);
    assert.match(section.textContent, /A rendelés lezárult/);
    assert.doesNotMatch(section.textContent, /Inaktív ajánlat/);
    assert.equal(section.querySelector('img').getAttribute('src'), '/images/logo.png');
    assert.equal(section.previousElementSibling.classList.contains('cake-collection'), true);
    assert.equal(section.querySelectorAll('a').length, 1);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
test('homepage hides seasonal section when no product is active', async () => {
  const { dom, w } = await page('index.html', [hidden, cake], ['js/seasonal.js', 'js/seasonal-home.js']);
  try { assert.equal(w.document.getElementById('seasonal-home')?.hidden, true); }
  finally { dom.window.close(); }
});
for (const orderPage of ['rendeles.html', 'rendeles/index.html']) {
test(orderPage + ': seasonal cart, mixed cart and removal obey pickup and fee rules', async () => {
  const { dom, w, errors } = await page(orderPage, [active, expired, hidden, cake], ['js/seasonal.js', 'js/order-page.js', 'inline']);
  try {
    const section = w.document.getElementById('seasonalOrderSection');
    assert.ok(section, 'seasonal order section exists');
    assert.equal(section.querySelectorAll('.product-card').length, 1);
    assert.equal(section.querySelector('img').getAttribute('src'), '/images/logo.png');
    section.querySelector('.add-to-cart-btn').click();
    const today = w.CremesSeasonal.budapestNow().slice(0, 10);
    const date = w.document.getElementById('atvetel_napja');
    assert.equal(date.min, today);
    date.value = today;
    date.dispatchEvent(new w.Event('change'));
    assert.equal(w.rushFeeHuf(), 0);
    assert.equal(date.validationMessage, '');
    const slot = w.document.getElementById('atvetel_intervallum');
    slot.value = '12–14';
    w.cremesRefreshPickupConstraints();
    assert.equal(slot.value, '12–14', 'periodic deadline checks preserve the selected time slot');
    w.document.querySelector('#productsGrid .add-to-cart-btn').click();
    assert.ok(date.min > today);
    assert.notEqual(date.validationMessage, '');
    assert.equal(w.rushFeeHuf(), 3000);
    const removeButtons = w.document.querySelectorAll('#orderItemsTableBody [data-remove-id]');
    assert.ok(removeButtons.length, 'cart removal controls exist');
    removeButtons[1].click();
    assert.equal(date.min, today);
    assert.equal(w.rushFeeHuf(), 0);
    w.CREMES_ORDER.products.find(p => p.id === active.id).order_until = '2020-01-01T18:00:00';
    w.cremesRefreshPickupConstraints();
    assert.match(date.validationMessage, /lezárult/);
    assert.equal(slot.disabled, true);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
}
test('admin can add and edit seasonal products with Budapest deadline and logo preview', async () => {
  const rows = [{ ...active }, { ...cake }];
  const { dom, w, errors } = await page('admin.html', rows, ['js/seasonal.js', 'js/admin.js']);
  try {
    const add = w.document.getElementById('seasonalAdd');
    assert.ok(add, 'seasonal add button exists');
    add.click();
    assert.equal(w.document.getElementById('seasonalForm').hidden, false);
    assert.equal(w.document.getElementById('seasonalPreview').getAttribute('src'), '/images/logo.png');
    for (const [id, value] of Object.entries({ seasonalName: 'Új finomság', seasonalPrice: '3200', seasonalTags: 'GM', seasonalDeadline: '2026-10-28T18:00', seasonalFrom: '2026-10-29', seasonalUntil: '2026-10-31' })) w.document.getElementById(id).value = value;
    w.document.getElementById('seasonalForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await settle();
    assert.match(w.document.getElementById('seasonalList').textContent, /Új finomság/);
    w.document.querySelector('[data-edit-seasonal="new-id"]').click();
    assert.equal(w.document.getElementById('seasonalDeadline').value, '2026-10-28T18:00');
    w.document.getElementById('seasonalName').value = 'Módosított finomság';
    w.document.getElementById('seasonalActive').checked = false;
    w.document.getElementById('seasonalForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await settle();
    assert.match(w.document.getElementById('seasonalList').textContent, /Módosított finomság/);
    assert.equal(rows.find(r => r.id === 'new-id').is_available, false);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

for (const file of ['rendeles.html', 'rendeles/index.html']) {
  const scripts = ['js/seasonal.js', 'js/order-page.js', 'inline'];
  function fillOrder(w) {
    for (const [id, value] of Object.entries({ nev: 'Teszt Elek', email: 'test@example.com', telefonszam: '+36301234567', atvetel_napja: '2026-10-22' })) w.document.getElementById(id).value = value;
    w.cremesRefreshPickupConstraints();
    w.document.getElementById('atvetel_intervallum').value = '12–14';
  }

  test(file + ': elapsed and under-48-hour slots are unavailable, including mixed carts', async () => {
    const { dom, w } = await page(file, [active, cake], scripts, '2026-10-19T20:00:00Z');
    try {
      w.document.querySelector('#seasonalProductsGrid .add-to-cart-btn').click();
      assert.deepEqual(Array.from(w.cremesSlotsForDate('2026-10-19')), []);
      assert.deepEqual(Array.from(w.cremesSlotsForDate('2026-10-20')), ['12–14']);
      w.document.querySelector('#productsGrid .add-to-cart-btn').click();
      assert.deepEqual(Array.from(w.cremesSlotsForDate('2026-10-21')), []);
      assert.deepEqual(Array.from(w.cremesSlotsForDate('2026-10-22')), ['12–14']);
      w.document.querySelectorAll('#orderItemsTableBody [data-remove-id]')[1].click();
      assert.deepEqual(Array.from(w.cremesSlotsForDate('2026-10-20')), ['12–14']);
    } finally { dom.window.close(); }
  });

  test(file + ': invalid fields block both summary entry points and focus the error', async () => {
    const { dom, w } = await page(file, [cake], scripts);
    try {
      w.document.querySelector('#productsGrid .add-to-cart-btn').click();
      fillOrder(w);
      for (const button of ['btnSummary', 'btnSummaryFromCart']) {
        for (const [id, value] of [['email', 'hibas'], ['email', 'test@example'], ['nev', '   '], ['telefonszam', '123'], ['atvetel_intervallum', '']]) {
          fillOrder(w);
          w.document.getElementById(id).value = value;
          w.document.getElementById(button).click();
          assert.equal(w.document.getElementById('summaryModal').classList.contains('show'), false, id);
          assert.equal(w.document.activeElement.id, id);
        }
      }
      fillOrder(w);
      w.document.getElementById('btnSummary').click();
      assert.equal(w.document.getElementById('summaryModal').classList.contains('show'), true);
    } finally { dom.window.close(); }
  });

  test(file + ': names and notes stay literal in summary and thank-you views', async () => {
    const { dom, w } = await page(file, [cake], scripts);
    try {
      w.document.querySelector('#productsGrid .add-to-cart-btn').click();
      fillOrder(w);
      const markup = '<img src=x onerror="alert(1)"><b>TESZT</b>&';
      w.document.getElementById('nev').value = markup;
      w.document.getElementById('megjegyzes').value = markup;
      w.document.getElementById('btnSummary').click();
      for (const id of ['summaryCustomer', 'summaryNotes']) {
        assert.equal(w.document.getElementById(id).querySelector('img,b'), null);
        assert.ok(w.document.getElementById(id).textContent.includes(markup));
      }
      w.openThankyouModal(w.buildSheetPayload());
      assert.equal(w.document.getElementById('thankyouSummary').querySelector('img,b'), null);
      assert.ok(w.document.getElementById('thankyouSummary').textContent.includes(markup));
    } finally { dom.window.close(); }
  });

  test(file + ': a selected slot expiring while the summary is open blocks final submission', async () => {
    const { dom, w, setNow } = await page(file, [active], scripts);
    try {
      w.document.querySelector('#seasonalProductsGrid .add-to-cart-btn').click();
      fillOrder(w);
      w.document.getElementById('atvetel_napja').value = '2026-10-19';
      w.cremesRefreshPickupConstraints();
      w.document.getElementById('atvetel_intervallum').value = '12–14';
      w.document.getElementById('btnSummary').click();
      assert.equal(w.document.getElementById('summaryModal').classList.contains('show'), true);
      setNow('2026-10-19T10:00:00Z');
      await w.finalizeOrderFromModal();
      assert.equal(w.document.getElementById('summaryModal').classList.contains('show'), false);
      assert.equal(w.document.getElementById('atvetel_napja').validity.valid, false);
      assert.equal(w.document.getElementById('thankyouModal').classList.contains('show'), false);
      assert.equal(w.cremesCartItems().length, 1);
    } finally { dom.window.close(); }
  });
}
