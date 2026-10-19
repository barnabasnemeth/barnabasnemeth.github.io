const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('seasonal order rules are enforced by PostgreSQL', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
    // Freeze only this disposable database's clock; production SQL runs unchanged.
    await db.exec(`create schema test_clock;
      create table test_clock.value (instant timestamptz);
      insert into test_clock.value values ('2026-10-19T08:00:00Z');
      alter function pg_catalog.now() rename to real_now;
      alter function pg_catalog.clock_timestamp() rename to real_clock_timestamp;
      create function pg_catalog.now() returns timestamptz language sql stable as $$ select instant from test_clock.value $$;
      create function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$ select instant from test_clock.value $$;`);
    const clock = value => db.query('update test_clock.value set instant=$1', [value]);
    await clock('2026-10-19T08:00:00Z');
    for (const name of fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync('supabase/migrations/' + name, 'utf8').replace('create extension if not exists pgcrypto;', ''));
    }
    const columns = await db.query("select column_name from information_schema.columns where table_name='products'");
    assert.ok(columns.rows.some(r => r.column_name === 'product_kind'), 'seasonal product fields must exist');
    await db.exec(`set time zone 'Europe/Budapest';
      insert into products (id,name,product_kind,seasonal_price_huf,order_until,pickup_from,pickup_until)
      values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Szezonális teszt','seasonal',2500,
        (now() at time zone 'Europe/Budapest') + interval '2 days', (now() at time zone 'Europe/Budapest')::date - 2, (now() at time zone 'Europe/Budapest')::date + 12);
      insert into pickup_slots(weekday,label) select n,'12–14' from generate_series(0,6) n;
      update order_settings set charge_rush_surcharge=true, rush_surcharge_huf=3000, min_lead_days=2;`);
    const seasonal = { product_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', quantity: 2, unit_price_huf: 1 };
    const cakeId = (await db.query("select id from products where product_kind='cake' limit 1")).rows[0].id;
    const cake = { product_id: cakeId, quantity: 1, slices: 8 };
    const today = (await db.query("select (now() at time zone 'Europe/Budapest')::date::text as d")).rows[0].d;
    const submit = (items, day = today, slot = '12–14') => db.query('select submit_order($1::jsonb) as result', [JSON.stringify({
      customer_name: 'Teszt Elek', email: 'test@example.com', phone: '+36301234567',
      pickup_date: day, pickup_slot: slot, items
    })]);
    await t.test('same-day seasonal-only order is priced from DB without rush fee', async () => {
      const result = (await submit([seasonal])).rows[0].result;
      assert.equal(result.ok, true);
      const order = (await db.query('select * from orders where order_number=$1', [result.order_number])).rows[0];
      assert.equal(order.grand_total_huf, 5000);
      assert.equal(order.is_rush, false);
      assert.equal(order.rush_surcharge_huf, null);
    });
    await t.test('mixed cart and cake-only cart keep lead time', async () => {
      await assert.rejects(submit([seasonal, cake]), /48 ór/);
      await assert.rejects(submit([cake]), /48 ór/);
    });
    await t.test('a future mixed cart retains the configured rush fee', async () => {
      const later = (await db.query("select ((now() at time zone 'Europe/Budapest')::date+2)::text as d")).rows[0].d;
      await db.exec('update order_settings set block_cakes_on_monday=false');
      const result = (await submit([seasonal, cake], later)).rows[0].result;
      const order = (await db.query('select * from orders where order_number=$1', [result.order_number])).rows[0];
      assert.equal(order.is_rush, true);
      assert.equal(order.rush_surcharge_huf, 3000);
      assert.equal(order.grand_total_huf, 22000);
      await db.exec('update order_settings set block_cakes_on_monday=true');
    });
    await t.test('elapsed same-day slots are rejected even for seasonal-only orders', async () => {
      await clock('2026-10-19T20:00:00Z');
      try { await assert.rejects(submit([seasonal]), /idősáv.*elmúlt/); }
      finally { await clock('2026-10-19T08:00:00Z'); }
    });
    await t.test('cake and mixed orders require 48 real hours before the start of pickup', async () => {
      await clock('2026-10-19T20:00:00Z');
      try {
        await assert.rejects(submit([cake], '2026-10-21'), /48 ór/);
        await assert.rejects(submit([seasonal, cake], '2026-10-21'), /48 ór/);
        assert.equal((await submit([cake], '2026-10-22')).rows[0].result.ok, true);
        assert.equal((await submit([seasonal], '2026-10-20')).rows[0].result.ok, true);
      } finally { await clock('2026-10-19T08:00:00Z'); }
    });
    await t.test('48-hour boundary uses elapsed hours across both Budapest DST changes', async () => {
      await db.exec("insert into pickup_slots(weekday,label) select 0,label from (values ('13:00–14:00'),('14:00–15:00'),('15:00–16:00')) t(label)");
      try {
        await clock('2026-10-23T12:00:00Z');
        await assert.rejects(submit([cake], '2026-10-25', '12–14'), /48 ór/);
        assert.equal((await submit([cake], '2026-10-25', '13:00–14:00')).rows[0].result.ok, true);
        await clock('2026-03-27T13:00:00Z');
        await assert.rejects(submit([cake], '2026-03-29', '14:00–15:00'), /48 ór/);
        assert.equal((await submit([cake], '2026-03-29', '15:00–16:00')).rows[0].result.ok, true);
      } finally { await clock('2026-10-19T08:00:00Z'); }
    });
    await t.test('past pickup dates are rejected even for seasonal-only carts', async () => {
      const yesterday = (await db.query("select ((now() at time zone 'Europe/Budapest')::date-1)::text as d")).rows[0].d;
      await assert.rejects(submit([seasonal], yesterday), /korábbi/);
    });
    await t.test('pickup outside the seasonal window is rejected', async () => {
      await db.exec("update products set pickup_from=(now() at time zone 'Europe/Budapest')::date+1 where product_kind='seasonal'");
      await assert.rejects(submit([seasonal]), /átvételi időszak/);
      await db.exec("update products set pickup_from=(now() at time zone 'Europe/Budapest')::date-2, pickup_until=(now() at time zone 'Europe/Budapest')::date-1 where product_kind='seasonal'");
      await assert.rejects(submit([seasonal]), /átvételi időszak/);
      await db.exec("update products set pickup_until=(now() at time zone 'Europe/Budapest')::date+12 where product_kind='seasonal'");
    });
    await t.test('expired, inactive and sliced seasonal orders are rejected', async () => {
      await assert.rejects(submit([{ ...seasonal, slices: 8 }]), /méret/);
      await db.exec("update products set order_until=(now() at time zone 'Europe/Budapest')-interval '1 second' where product_kind='seasonal'");
      await assert.rejects(submit([seasonal]), /lezárult/);
      await db.exec("update products set order_until=(now() at time zone 'Europe/Budapest')+interval '1 day', is_available=false where product_kind='seasonal'");
      await assert.rejects(submit([seasonal]), /nem elérhető/);
      await db.exec("update products set is_available=true where product_kind='seasonal'");
    });
    await t.test('cake-only closures do not block seasonal orders, full closures do', async () => {
      await db.exec(`insert into blackout_ranges(starts_on,ends_on,blocks_cakes_only) values ((now() at time zone 'Europe/Budapest')::date,(now() at time zone 'Europe/Budapest')::date,true)`);
      assert.equal((await submit([seasonal])).rows[0].result.ok, true);
      await db.exec('update blackout_ranges set blocks_cakes_only=false');
      await assert.rejects(submit([seasonal]), /nincs átvétel/);
      await db.exec('delete from blackout_ranges');
    });
    await t.test('missing pickup slot is rejected even for seasonal-only cart', async () => {
      await db.exec("delete from pickup_slots where label='12–14'");
      await assert.rejects(submit([seasonal]), /idősáv/);
    });
    await t.test('invalid seasonal configuration cannot be stored', async () => {
      await assert.rejects(db.exec("update products set pickup_until=pickup_from-1 where product_kind='seasonal'"), /check constraint/);
      await assert.rejects(db.exec("update products set seasonal_price_huf=null where product_kind='seasonal'"), /check constraint/);
    });
    await t.test('anonymous users cannot see inactive products or edit the catalog', async () => {
      await db.exec("update products set is_available=false where product_kind='seasonal'; set role anon");
      assert.equal((await db.query("select * from products where product_kind='seasonal'")).rows.length, 0);
      await assert.rejects(db.exec("update products set name='attack'"), /permission denied/);
      await db.exec('reset role');
    });
  } finally { await db.close(); }
});
