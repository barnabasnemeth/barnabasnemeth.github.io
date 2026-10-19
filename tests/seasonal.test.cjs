const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {}, Intl, Date };
if (fs.existsSync('js/seasonal.js')) vm.runInNewContext(fs.readFileSync('js/seasonal.js', 'utf8'), context);
const api = context.window.CremesSeasonal || {};
const seasonal = { product_kind: 'seasonal', is_available: true, order_until: '2026-10-28T18:00:00', pickup_from: '2026-10-29', pickup_until: '2026-10-31' };

test('deadline uses Budapest time and closes at the deadline', () => {
  assert.equal(typeof api.isOrderable, 'function');
  assert.equal(api.isOrderable(seasonal, new Date('2026-10-28T16:59:59Z')), true);
  assert.equal(api.isOrderable(seasonal, new Date('2026-10-28T17:00:00Z')), false);
  assert.equal(api.isOrderable({ ...seasonal, is_available: false }, new Date('2026-10-27T12:00:00Z')), false);
  assert.equal(api.isOrderable({ ...seasonal, order_until: '2026-07-28T18:00:00' }, new Date('2026-07-28T16:00:00Z')), false);
});
test('seasonal-only cart permits today while mixed cart keeps the lead time', () => {
  assert.equal(typeof api.pickupBounds, 'function');
  const early = { ...seasonal, pickup_from: '2026-10-19' };
  assert.equal(api.pickupBounds([early], '2026-10-19', 2).min, '2026-10-19');
  assert.equal(api.pickupBounds([early, { product_kind: 'cake' }], '2026-10-19', 2).min, '2026-10-21');
  assert.equal(api.pickupBounds([], '2026-10-19', 2).min, '2026-10-21');
});
test('multiple seasonal products intersect pickup dates and expose impossible carts', () => {
  assert.equal(typeof api.pickupBounds, 'function');
  const b = { ...seasonal, pickup_from: '2026-10-30', pickup_until: '2026-11-02' };
  const result = api.pickupBounds([seasonal, b], '2026-10-19', 2);
  assert.equal(result.min, '2026-10-30');
  assert.equal(result.max, '2026-10-31');
  assert.equal(result.empty, false);
  assert.equal(api.pickupBounds([seasonal, { ...b, pickup_from: '2026-11-01' }], '2026-10-19', 2).empty, true);
});

test('pickup slots enforce 48 elapsed hours and the exact boundary through DST', () => {
  const cakes = [{ product_kind: 'cake' }];
  for (const [now, day, slot, allowed] of [
    ['2026-10-19T20:00:00Z', '2026-10-21', '12–14', false],
    ['2026-10-19T20:00:00Z', '2026-10-21', '22:00–23:00', true],
    ['2026-10-23T12:00:00Z', '2026-10-25', '12:00–14:00', false],
    ['2026-10-23T12:00:00Z', '2026-10-25', '13:00–14:00', true],
    ['2026-03-27T13:00:00Z', '2026-03-29', '14:00–15:00', false],
    ['2026-03-27T13:00:00Z', '2026-03-29', '15:00–16:00', true]
  ]) assert.equal(api.pickupSlotAllowed(cakes, day, slot, 2, new Date(now)), allowed, now + ' ' + slot);
  assert.equal(api.pickupSlotAllowed([seasonal], '2026-10-19', '12–14', 2, new Date('2026-10-19T09:59:59Z')), true);
  assert.equal(api.pickupSlotAllowed([seasonal], '2026-10-19', '12–14', 2, new Date('2026-10-19T10:00:00Z')), false);
});

test('pickup slots reject unreadable times and the missing spring hour', () => {
  for (const label of ['egyeztetés szerint', '25:00–26:00', '12:99–14:00', '02:30–03:30']) {
    assert.equal(api.pickupSlotAllowed([seasonal], '2026-03-29', label, 2, new Date('2026-03-28T08:00:00Z')), false, label);
  }
});
