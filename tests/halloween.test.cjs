const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function page(instant, products) {
  const dom = new JSDOM('<html><body><header id="landing"></header><main></main></body></html>', { runScripts: 'outside-only' });
  let now = Date.parse(instant);
  dom.window.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  let tick;
  if (products) dom.window.cremesSupabase = () => ({ from: () => ({ select() { return this; }, eq() { return this; }, order: async () => ({ data: products }) }) });
  dom.window.eval(fs.readFileSync('js/seasonal.js', 'utf8'));
  dom.window.setTimeout = fn => { tick = fn; return 1; };
  dom.window.eval(fs.readFileSync('js/halloween.js', 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return { dom, document: dom.window.document, advance(value) { now = Date.parse(value); tick(); } };
}

test('Halloween is limited to October 22–31, 2026 in Budapest, including the DST change', () => {
  for (const [instant, active] of [
    ['2026-10-21T21:59:59Z', false], ['2026-10-21T22:00:00Z', true],
    ['2026-10-25T01:00:00Z', true], ['2026-10-31T22:59:59Z', true],
    ['2026-10-31T23:00:00Z', false], ['2027-10-25T12:00:00Z', false]
  ]) {
    const { dom, document } = page(instant);
    assert.equal(document.documentElement.classList.contains('halloween'), active, instant);
    assert.equal(!!document.querySelector('.halloween-banner'), active, instant);
    dom.window.close();
  }
});

test('banner promotes the orderable Halloween box by its catalog name with a Hungarian CTA', async () => {
  const { dom, document, advance } = page('2026-10-22T10:00:00Z', [
    { name: 'Halloweeni süti box', is_available: true, order_until: '2026-10-28T18:00:00' }
  ]);
  await new Promise(resolve => setImmediate(resolve));
  const banner = document.querySelector('.halloween-banner');
  assert.match(banner.textContent, /Halloweeni süti box/);
  assert.doesNotMatch(banner.textContent, /OKTÓBER 22/);
  assert.equal(banner.querySelector('a').textContent, 'Megrendelem a Halloween-boxot ↗');
  assert.equal(banner.querySelector('a').getAttribute('href'), '/rendeles#seasonalOrderSection');
  advance('2026-10-28T17:00:00Z');
  assert.doesNotMatch(banner.textContent, /Halloweeni süti box/);
  assert.equal(document.querySelectorAll('.halloween-atmosphere').length, 1);
  advance('2026-10-31T23:00:00Z');
  assert.equal(document.querySelector('.halloween-atmosphere'), null);
  await new Promise(resolve => setImmediate(resolve));
  dom.window.close();
});

test('an open page activates and restores itself across both boundaries without duplicate banners', () => {
  const { dom, document, advance } = page('2026-10-21T21:59:59Z');
  advance('2026-10-21T22:00:00Z');
  assert.equal(document.querySelectorAll('.halloween-banner').length, 1);
  advance('2026-10-30T12:00:00Z');
  assert.equal(document.querySelectorAll('.halloween-banner').length, 1);
  advance('2026-10-31T23:00:00Z');
  assert.equal(document.documentElement.classList.contains('halloween'), false);
  assert.equal(document.querySelector('.halloween-banner'), null);
  dom.window.close();
});
