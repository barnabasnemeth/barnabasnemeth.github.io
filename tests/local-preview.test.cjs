const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function setup(url) {
  const dom = new JSDOM('<!doctype html><body></body>', { url, runScripts: 'outside-only' });
  const w = dom.window;
  const snapshot = JSON.parse(fs.readFileSync('js/local-preview-data.json', 'utf8'));
  w.fetch = async () => ({ ok: true, json: async () => structuredClone(snapshot) });
  if (fs.existsSync('js/local-preview.js')) w.eval(fs.readFileSync('js/local-preview.js', 'utf8'));
  w.eval(fs.readFileSync('js/supabase-config.js', 'utf8'));
  return { dom, w };
}

test('localhost shows the regular catalog and active seasonal examples without Supabase', async () => {
  const { dom, w } = setup('http://127.0.0.1:5500/');
  try {
    assert.equal(w.CREMES_LOCAL_PREVIEW, true);
    const client = w.cremesSupabase();
    const cakes = await client.from('products').select('*,product_prices(*)').eq('product_kind', 'cake');
    assert.ok(cakes.data.length > 0);
    assert.ok(cakes.data[0].product_prices.length > 0);
    const seasonal = await client.from('products').select('*').eq('product_kind', 'seasonal').eq('is_available', true);
    assert.equal(seasonal.data.length, 2);
    assert.ok(seasonal.data.every(p => p.order_until > new Date().toISOString().slice(0, 10)));
    const submitted = await client.rpc('submit_order', { payload: {} });
    assert.match(submitted.error.message, /helyi előnézet/i);
  } finally { dom.window.close(); }
});
test('local seasonal edits persist across clients and can be hidden without changing remote data', async () => {
  const { dom, w } = setup('http://localhost:5500/admin.html');
  try {
    assert.equal(w.CREMES_LOCAL_PREVIEW, true);
    const first = w.cremesSupabase();
    const inserted = await first.from('products').insert({ product_kind: 'seasonal', name: 'Saját helyi termék', seasonal_price_huf: 4000, is_available: true, order_until: '2099-10-28T18:00:00', pickup_from: '2099-10-29', pickup_until: '2099-10-31' }).select('id').single();
    assert.ok(inserted.data.id);
    await first.from('products').update({ name: 'Átnevezett helyi termék', is_available: false }).eq('id', inserted.data.id);
    const stored = await first.from('products').select('*').eq('id', inserted.data.id).single();
    assert.equal(stored.data.name, 'Átnevezett helyi termék');
    w.eval(fs.readFileSync('js/local-preview.js', 'utf8'));
    w.__cremesLocalClient = null;
    const visible = await w.cremesSupabase().from('products').select('*').eq('product_kind', 'seasonal').eq('is_available', true);
    assert.equal(visible.data.length, 2);
    const reloaded = await w.cremesSupabase().from('products').select('*').eq('id', inserted.data.id).single();
    assert.equal(reloaded.data.is_available, false);
  } finally { dom.window.close(); }
});
test('production hostname always uses the real Supabase client', () => {
  const { dom, w } = setup('https://cremesdessert.com/');
  try {
    const real = { live: true };
    w.supabase = { createClient: () => real };
    assert.equal(w.cremesSupabase(), real);
    assert.notEqual(w.CREMES_LOCAL_PREVIEW, true);
  } finally { dom.window.close(); }
});

test('local quote form submission cannot reach the email delivery handler', () => {
  const { dom, w } = setup('http://127.0.0.1:5500/');
  try {
    w.alert = () => {};
    w.document.body.innerHTML = '<form id="contactForm"></form>';
    const outbox = [];
    const form = w.document.getElementById('contactForm');
    form.addEventListener('submit', () => outbox.push('quote email'));
    const allowed = form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(allowed, false);
    assert.equal(outbox.length, 0);
  } finally { dom.window.close(); }
});
