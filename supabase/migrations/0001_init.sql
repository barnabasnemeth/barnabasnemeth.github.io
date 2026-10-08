-- Créme's Dessert — initial Supabase schema
-- Run this entire file once in the Supabase SQL Editor (postgres role).
-- Do not put the service_role key or database password in the website.
-- Customer orders are NOT seeded here. Import them separately.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  dietary_tags text not null default '',
  show_on_homepage boolean not null default true,
  is_available boolean not null default true,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_len check (char_length(btrim(name)) between 1 and 160),
  constraint products_tags_len check (char_length(dietary_tags) <= 200),
  constraint products_image_len check (image_url is null or char_length(image_url) <= 1000)
);

create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  slices smallint,
  price_huf integer not null,
  constraint product_prices_slices_chk check (slices is null or slices in (8, 12, 16, 24)),
  constraint product_prices_amount_chk check (price_huf >= 0)
);

create unique index product_prices_slice_uidx
  on public.product_prices (product_id, slices)
  where slices is not null;

create unique index product_prices_unit_uidx
  on public.product_prices (product_id)
  where slices is null;

create table public.pogacsa_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_huf integer not null,
  min_order_quantity numeric(8, 2) not null,
  quantity_unit text not null default 'kg',
  price_unit_label text not null default 'Ft / kg',
  image_url text,
  is_featured boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pogacsa_name_len check (char_length(btrim(name)) between 1 and 160),
  constraint pogacsa_price_chk check (price_huf >= 0),
  constraint pogacsa_min_chk check (min_order_quantity > 0),
  constraint pogacsa_unit_len check (char_length(btrim(quantity_unit)) between 1 and 20),
  constraint pogacsa_label_len check (char_length(price_unit_label) between 1 and 40),
  constraint pogacsa_image_len check (image_url is null or char_length(image_url) <= 1000)
);

create table public.homepage_extras (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homepage_extras_name_len check (char_length(btrim(name)) between 1 and 120)
);

create table public.opening_hours (
  id uuid primary key default gen_random_uuid(),
  day_label text not null,
  opens_at text,
  closes_at text,
  is_closed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opening_hours_label_len check (char_length(btrim(day_label)) between 1 and 40),
  constraint opening_hours_time_len check (
    (opens_at is null or char_length(opens_at) <= 8)
    and (closes_at is null or char_length(closes_at) <= 8)
  )
);

create table public.pickup_slots (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null,
  label text not null,
  sort_order integer not null default 0,
  constraint pickup_slots_weekday_chk check (weekday between 0 and 6),
  constraint pickup_slots_label_len check (char_length(btrim(label)) between 1 and 40),
  constraint pickup_slots_unique unique (weekday, label)
);

create table public.blackout_ranges (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  blocks_cakes_only boolean not null default true,
  message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blackout_range_chk check (ends_on >= starts_on),
  constraint blackout_message_len check (char_length(message) <= 1000)
);

-- Every column here is shown to visitors or used to price a public order.
-- Do not add private staff notes to this table.
create table public.order_settings (
  id smallint primary key default 1,
  min_lead_days integer not null default 2,
  rush_within_days integer not null default 5,
  rush_surcharge_huf integer,
  charge_rush_surcharge boolean not null default false,
  block_cakes_on_monday boolean not null default true,
  candle_unit_price_huf integer not null default 0,
  box_price_huf integer not null default 0,
  firework_price_huf integer not null default 0,
  opening_notice text not null default '',
  guest_notice_allergy text not null default '',
  guest_notice_rush text not null default '',
  pickup_help_text text not null default '',
  rush_warning_text text not null default '',
  rush_summary_text text not null default '',
  monday_block_message text not null default '',
  placeholder_image_url text not null default '',
  updated_at timestamptz not null default now(),
  constraint order_settings_singleton check (id = 1),
  constraint order_settings_lead_chk check (min_lead_days between 0 and 60),
  constraint order_settings_rush_days_chk check (rush_within_days between 0 and 60),
  constraint order_settings_rush_fee_chk check (rush_surcharge_huf is null or rush_surcharge_huf >= 0),
  constraint order_settings_prices_chk check (
    candle_unit_price_huf >= 0
    and box_price_huf >= 0
    and firework_price_huf >= 0
  ),
  constraint order_settings_text_len check (
    char_length(opening_notice) <= 1000
    and char_length(guest_notice_allergy) <= 1000
    and char_length(guest_notice_rush) <= 1000
    and char_length(pickup_help_text) <= 1000
    and char_length(rush_warning_text) <= 1000
    and char_length(rush_summary_text) <= 1000
    and char_length(monday_block_message) <= 1000
    and char_length(placeholder_image_url) <= 1000
  )
);

create sequence public.order_number_seq as integer start with 1;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number integer not null unique,
  customer_name text not null,
  email text not null,
  phone text not null,
  ordered_at timestamptz not null default now(),
  pickup_date date not null,
  pickup_slot text not null,
  note text not null default '',
  allergy_note text not null default '',
  status text not null default 'Új',
  paid boolean not null default false,
  is_rush boolean not null default false,
  rush_surcharge_huf integer,
  cake_total_huf integer,
  candle_total_huf integer,
  firework_total_huf integer,
  box_total_huf integer,
  known_subtotal_huf integer,
  grand_total_huf integer,
  candle_requested boolean not null default false,
  candle_text text not null default '',
  firework_requested boolean not null default false,
  box_requested boolean not null default false,
  haccp_requested boolean not null default false,
  invoice_requested boolean not null default false,
  invoice_company text,
  invoice_address text,
  invoice_tax_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_number_chk check (order_number > 0),
  constraint orders_name_len check (char_length(customer_name) between 1 and 120),
  constraint orders_email_len check (char_length(email) between 3 and 320),
  constraint orders_phone_len check (char_length(phone) between 8 and 40),
  constraint orders_slot_len check (char_length(pickup_slot) between 1 and 40),
  constraint orders_note_len check (char_length(note) <= 20000),
  constraint orders_allergy_len check (char_length(allergy_note) <= 2000),
  constraint orders_status_chk check (status in ('Új', 'Folyamatban', 'Elkészült', 'Átvéve')),
  constraint orders_candle_len check (char_length(candle_text) <= 32),
  constraint orders_invoice_len check (
    (invoice_company is null or char_length(invoice_company) <= 300)
    and (invoice_address is null or char_length(invoice_address) <= 300)
    and (invoice_tax_id is null or char_length(invoice_tax_id) <= 32)
  ),
  constraint orders_money_chk check (
    (rush_surcharge_huf is null or rush_surcharge_huf >= 0)
    and (cake_total_huf is null or cake_total_huf >= 0)
    and (candle_total_huf is null or candle_total_huf >= 0)
    and (firework_total_huf is null or firework_total_huf >= 0)
    and (box_total_huf is null or box_total_huf >= 0)
    and (known_subtotal_huf is null or known_subtotal_huf >= 0)
    and (grand_total_huf is null or grand_total_huf >= 0)
  )
);

create index orders_ordered_at_idx on public.orders (ordered_at desc);
create index orders_pickup_date_idx on public.orders (pickup_date);
create index orders_status_idx on public.orders (status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  slices smallint,
  quantity integer not null,
  unit_price_huf integer,
  line_total_huf integer,
  sort_order integer not null default 0,
  constraint order_items_name_len check (char_length(product_name) between 1 and 160),
  constraint order_items_slices_chk check (slices is null or (slices > 0 and slices <= 200)),
  constraint order_items_qty_chk check (quantity between 1 and 50),
  constraint order_items_money_chk check (
    (unit_price_huf is null or unit_price_huf >= 0)
    and (line_total_huf is null or line_total_huf >= 0)
  )
);

create index order_items_order_id_idx on public.order_items (order_id);

create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger pogacsa_updated_at before update on public.pogacsa_products
  for each row execute function public.set_updated_at();
create trigger homepage_extras_updated_at before update on public.homepage_extras
  for each row execute function public.set_updated_at();
create trigger opening_hours_updated_at before update on public.opening_hours
  for each row execute function public.set_updated_at();
create trigger blackout_updated_at before update on public.blackout_ranges
  for each row execute function public.set_updated_at();
create trigger order_settings_updated_at before update on public.order_settings
  for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create or replace function public.protect_order_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id or new.order_number is distinct from old.order_number then
    raise exception 'A rendelésszám nem módosítható.';
  end if;
  return new;
end;
$$;

create trigger orders_protect_identity before update on public.orders
  for each row execute function public.protect_order_identity();

-- True only when the signed-in user is listed in admin_users.
-- Authenticated alone is not enough.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Public order submission. The only insert path for visitors.
-- Prices, status and paid are taken from the database, never from the client.
-- ---------------------------------------------------------------------------

create or replace function public.submit_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.order_settings%rowtype;
  v_today date;
  v_name text;
  v_email text;
  v_phone text;
  v_pickup date;
  v_slot text;
  v_note text;
  v_items jsonb;
  v_item jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_qty integer;
  v_slices smallint;
  v_pname text;
  v_available boolean;
  v_price_count integer;
  v_unit integer;
  v_has_slice_cake boolean := false;
  v_all_cakes_priced boolean := true;
  v_cake_priced_any boolean := false;
  v_cake_total integer := 0;
  v_candle boolean;
  v_candle_text text;
  v_candle_digits integer := 0;
  v_candle_known boolean := true;
  v_candle_total integer;
  v_firework boolean;
  v_firework_known boolean := true;
  v_firework_total integer;
  v_box boolean;
  v_box_known boolean := true;
  v_box_total integer;
  v_haccp boolean;
  v_invoice boolean;
  v_company text;
  v_address text;
  v_tax text;
  v_weekday integer;
  v_is_rush boolean;
  v_rush_fee integer;
  v_extras_known boolean;
  v_subtotal integer := 0;
  v_grand integer;
  v_order_id uuid;
  v_order_number integer;
  v_sort integer := 0;
  v_line_total integer;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Érvénytelen rendelés.';
  end if;

  if octet_length(payload::text) > 20000 then
    raise exception 'A rendelés túl nagy.';
  end if;

  select * into s from public.order_settings where id = 1;
  if not found then
    raise exception 'A rendelési beállítások hiányoznak.';
  end if;

  v_today := (now() at time zone 'Europe/Budapest')::date;

  v_name := btrim(coalesce(payload->>'customer_name', ''));
  v_email := btrim(coalesce(payload->>'email', ''));
  v_phone := btrim(coalesce(payload->>'phone', ''));
  v_note := btrim(coalesce(payload->>'note', ''));
  v_slot := btrim(coalesce(payload->>'pickup_slot', ''));

  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'A név megadása kötelező.';
  end if;

  if char_length(v_email) < 3
     or char_length(v_email) > 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Érvényes email cím szükséges.';
  end if;

  if v_phone !~ '^(\+36|06)[[:space:]]?(1|[2-9][0-9])[[:space:]]?[0-9]{3}[[:space:]]?[0-9]{3,4}$' then
    raise exception 'Érvényes magyar telefonszám szükséges.';
  end if;

  if char_length(v_note) > 2000 then
    raise exception 'A megjegyzés túl hosszú.';
  end if;

  begin
    v_pickup := (payload->>'pickup_date')::date;
  exception when others then
    raise exception 'Az átvétel napja érvénytelen.';
  end;

  if v_pickup is null then
    raise exception 'Az átvétel napja kötelező.';
  end if;

  if v_pickup < v_today + s.min_lead_days then
    raise exception 'Az átvétel a megengedettnél korábbi napra esik.';
  end if;

  if char_length(v_slot) < 1 or char_length(v_slot) > 40 then
    raise exception 'Az átvételi idősáv kötelező.';
  end if;

  v_weekday := extract(dow from v_pickup)::integer;
  if not exists (
    select 1
    from public.pickup_slots ps
    where ps.weekday = v_weekday
      and ps.label = v_slot
  ) then
    raise exception 'A választott idősáv erre a napra nem elérhető.';
  end if;

  v_items := payload->'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'Legalább egy tétel szükséges.';
  end if;

  if jsonb_array_length(v_items) < 1 or jsonb_array_length(v_items) > 30 then
    raise exception 'Legalább egy, legfeljebb 30 tétel adható le.';
  end if;

  for v_item in select value from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Érvénytelen tétel.';
    end if;

    if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Érvénytelen termék.';
    end if;

    v_product_id := (v_item->>'product_id')::uuid;

    begin
      v_qty := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Érvénytelen mennyiség.';
    end;

    if v_qty is null or v_qty < 1 or v_qty > 50 then
      raise exception 'Érvénytelen mennyiség.';
    end if;

    v_slices := null;
    if coalesce(v_item->>'slices', '') <> '' then
      begin
        v_slices := (v_item->>'slices')::smallint;
      exception when others then
        raise exception 'A választott méret nem rendelhető.';
      end;
      if v_slices is not null and v_slices <= 0 then
        v_slices := null;
      end if;
    end if;

    select p.name, p.is_available
      into v_pname, v_available
    from public.products p
    where p.id = v_product_id;

    if not found or v_available is not true then
      raise exception 'A termék nem elérhető.';
    end if;

    select count(*) into v_price_count
    from public.product_prices pp
    where pp.product_id = v_product_id;

    v_unit := null;
    if v_price_count > 0 then
      select pp.price_huf into v_unit
      from public.product_prices pp
      where pp.product_id = v_product_id
        and pp.slices is not distinct from v_slices;

      if not found then
        raise exception 'A választott méret nem rendelhető.';
      end if;
    else
      v_all_cakes_priced := false;
    end if;

    if v_slices is not null then
      v_has_slice_cake := true;
    end if;

    v_line_total := null;
    if v_unit is not null then
      v_line_total := v_unit * v_qty;
      v_cake_total := v_cake_total + v_line_total;
      v_cake_priced_any := true;
    else
      v_all_cakes_priced := false;
    end if;

    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'product_name', v_pname,
      'slices', v_slices,
      'quantity', v_qty,
      'unit_price_huf', v_unit,
      'line_total_huf', v_line_total
    ));
  end loop;

  if s.block_cakes_on_monday and v_weekday = 1 and v_has_slice_cake then
    raise exception 'Hétfőn torta nem adható át.';
  end if;

  if v_has_slice_cake and exists (
    select 1
    from public.blackout_ranges b
    where v_pickup between b.starts_on and b.ends_on
      and b.blocks_cakes_only
  ) then
    raise exception 'A választott napon torta nem adható át.';
  end if;

  if exists (
    select 1
    from public.blackout_ranges b
    where v_pickup between b.starts_on and b.ends_on
      and b.blocks_cakes_only = false
  ) then
    raise exception 'A választott napon nincs átvétel.';
  end if;

  v_candle := lower(coalesce(payload->>'candle_requested', 'false')) in ('true', 't', '1');
  v_firework := lower(coalesce(payload->>'firework_requested', 'false')) in ('true', 't', '1');
  v_box := lower(coalesce(payload->>'box_requested', 'false')) in ('true', 't', '1');
  v_haccp := lower(coalesce(payload->>'haccp_requested', 'false')) in ('true', 't', '1');
  v_invoice := lower(coalesce(payload->>'invoice_requested', 'false')) in ('true', 't', '1');

  v_candle_text := '';
  v_candle_total := null;
  if v_candle then
    v_candle_text := btrim(coalesce(payload->>'candle_text', ''));
    if char_length(v_candle_text) > 32 then
      raise exception 'A számgyertya szövege túl hosszú.';
    end if;
    if v_candle_text ~ '[^0-9]' then
      raise exception 'A számgyertya csak számjegyeket tartalmazhat.';
    end if;
    v_candle_digits := char_length(v_candle_text);
    if v_candle_digits = 0 then
      v_candle_total := 0;
      v_candle_known := true;
    elsif s.candle_unit_price_huf > 0 then
      v_candle_total := v_candle_digits * s.candle_unit_price_huf;
      v_candle_known := true;
    else
      v_candle_total := null;
      v_candle_known := false;
    end if;
  end if;

  v_firework_total := null;
  if v_firework then
    if s.firework_price_huf > 0 then
      v_firework_total := s.firework_price_huf;
      v_firework_known := true;
    else
      v_firework_known := false;
    end if;
  end if;

  v_box_total := null;
  if v_box then
    if s.box_price_huf > 0 then
      v_box_total := s.box_price_huf;
      v_box_known := true;
    else
      v_box_known := false;
    end if;
  end if;

  v_company := null;
  v_address := null;
  v_tax := null;
  if v_invoice then
    v_company := btrim(coalesce(payload->>'invoice_company', ''));
    v_address := btrim(coalesce(payload->>'invoice_address', ''));
    v_tax := btrim(coalesce(payload->>'invoice_tax_id', ''));
    if char_length(v_company) < 1 or char_length(v_company) > 300
       or char_length(v_address) < 1 or char_length(v_address) > 300
       or char_length(v_tax) < 1 or char_length(v_tax) > 32 then
      raise exception 'Az áfás számlához cégnév, cím és adószám szükséges.';
    end if;
  end if;

  v_is_rush := (v_pickup - v_today) < s.rush_within_days;
  v_rush_fee := null;
  if v_is_rush and s.charge_rush_surcharge and s.rush_surcharge_huf is not null then
    v_rush_fee := s.rush_surcharge_huf;
  end if;

  v_subtotal := 0;
  if v_cake_priced_any then
    v_subtotal := v_subtotal + v_cake_total;
  end if;
  if v_candle and v_candle_known and v_candle_total is not null then
    v_subtotal := v_subtotal + v_candle_total;
  end if;
  if v_firework and v_firework_known and v_firework_total is not null then
    v_subtotal := v_subtotal + v_firework_total;
  end if;
  if v_box and v_box_known and v_box_total is not null then
    v_subtotal := v_subtotal + v_box_total;
  end if;

  v_extras_known :=
    (not v_candle or v_candle_known)
    and (not v_firework or v_firework_known)
    and (not v_box or v_box_known);

  v_grand := null;
  if v_all_cakes_priced and v_extras_known then
    if not v_is_rush then
      v_grand := v_subtotal;
    elsif v_rush_fee is not null then
      v_grand := v_subtotal + v_rush_fee;
    end if;
  end if;

  v_order_number := nextval('public.order_number_seq');
  v_order_id := gen_random_uuid();

  insert into public.orders (
    id,
    order_number,
    customer_name,
    email,
    phone,
    ordered_at,
    pickup_date,
    pickup_slot,
    note,
    allergy_note,
    status,
    paid,
    is_rush,
    rush_surcharge_huf,
    cake_total_huf,
    candle_total_huf,
    firework_total_huf,
    box_total_huf,
    known_subtotal_huf,
    grand_total_huf,
    candle_requested,
    candle_text,
    firework_requested,
    box_requested,
    haccp_requested,
    invoice_requested,
    invoice_company,
    invoice_address,
    invoice_tax_id
  ) values (
    v_order_id,
    v_order_number,
    v_name,
    v_email,
    v_phone,
    now(),
    v_pickup,
    v_slot,
    v_note,
    '',
    'Új',
    false,
    v_is_rush,
    v_rush_fee,
    case when v_cake_priced_any then v_cake_total else null end,
    case when v_candle and v_candle_known then v_candle_total else null end,
    case when v_firework and v_firework_known then v_firework_total else null end,
    case when v_box and v_box_known then v_box_total else null end,
    case when v_subtotal > 0 then v_subtotal else null end,
    v_grand,
    v_candle,
    v_candle_text,
    v_firework,
    v_box,
    v_haccp,
    v_invoice,
    v_company,
    v_address,
    v_tax
  );

  for v_item in select value from jsonb_array_elements(v_clean) loop
    v_sort := v_sort + 1;
    insert into public.order_items (
      order_id,
      product_id,
      product_name,
      slices,
      quantity,
      unit_price_huf,
      line_total_huf,
      sort_order
    ) values (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      case when v_item->>'slices' is null then null else (v_item->>'slices')::smallint end,
      (v_item->>'quantity')::integer,
      case when v_item->>'unit_price_huf' is null then null else (v_item->>'unit_price_huf')::integer end,
      case when v_item->>'line_total_huf' is null then null else (v_item->>'line_total_huf')::integer end,
      v_sort
    );
  end loop;

  return jsonb_build_object('ok', true, 'order_number', v_order_number);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. RLS is enabled below; these revokes are still required.
-- service_role keeps dashboard access and is not used by the website.
-- ---------------------------------------------------------------------------

revoke all on table
  public.products,
  public.product_prices,
  public.pogacsa_products,
  public.homepage_extras,
  public.opening_hours,
  public.pickup_slots,
  public.blackout_ranges,
  public.order_settings,
  public.orders,
  public.order_items,
  public.admin_users
from public, anon, authenticated;

revoke all on sequence public.order_number_seq from public, anon, authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.protect_order_identity() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.submit_order(jsonb) from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select on table
  public.products,
  public.product_prices,
  public.pogacsa_products,
  public.homepage_extras,
  public.opening_hours,
  public.pickup_slots,
  public.blackout_ranges,
  public.order_settings
to anon, authenticated;

grant insert, update, delete on table
  public.products,
  public.product_prices,
  public.pogacsa_products,
  public.homepage_extras,
  public.opening_hours,
  public.pickup_slots,
  public.blackout_ranges
to authenticated;

grant update on table public.order_settings to authenticated;

grant select, update on table public.orders to authenticated;
grant select, insert, update, delete on table public.order_items to authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.submit_order(jsonb) to anon, authenticated;

grant all on table
  public.products,
  public.product_prices,
  public.pogacsa_products,
  public.homepage_extras,
  public.opening_hours,
  public.pickup_slots,
  public.blackout_ranges,
  public.order_settings,
  public.orders,
  public.order_items,
  public.admin_users
to service_role;

grant usage, select, update on sequence public.order_number_seq to service_role;
grant execute on function public.is_admin() to service_role;
grant execute on function public.submit_order(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;
alter table public.product_prices enable row level security;
alter table public.pogacsa_products enable row level security;
alter table public.homepage_extras enable row level security;
alter table public.opening_hours enable row level security;
alter table public.pickup_slots enable row level security;
alter table public.blackout_ranges enable row level security;
alter table public.order_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.admin_users enable row level security;

alter table public.products force row level security;
alter table public.product_prices force row level security;
alter table public.pogacsa_products force row level security;
alter table public.homepage_extras force row level security;
alter table public.opening_hours force row level security;
alter table public.pickup_slots force row level security;
alter table public.blackout_ranges force row level security;
alter table public.order_settings force row level security;
alter table public.orders force row level security;
alter table public.order_items force row level security;
alter table public.admin_users force row level security;

create policy products_select on public.products
  for select to anon, authenticated
  using (is_available or public.is_admin());

create policy products_insert on public.products
  for insert to authenticated
  with check (public.is_admin());

create policy products_update on public.products
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy products_delete on public.products
  for delete to authenticated
  using (public.is_admin());

create policy product_prices_select on public.product_prices
  for select to anon, authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.products p
      where p.id = product_prices.product_id
        and p.is_available
    )
  );

create policy product_prices_insert on public.product_prices
  for insert to authenticated
  with check (public.is_admin());

create policy product_prices_update on public.product_prices
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy product_prices_delete on public.product_prices
  for delete to authenticated
  using (public.is_admin());

create policy pogacsa_select on public.pogacsa_products
  for select to anon, authenticated
  using (is_available or public.is_admin());

create policy pogacsa_insert on public.pogacsa_products
  for insert to authenticated
  with check (public.is_admin());

create policy pogacsa_update on public.pogacsa_products
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy pogacsa_delete on public.pogacsa_products
  for delete to authenticated
  using (public.is_admin());

create policy homepage_extras_select on public.homepage_extras
  for select to anon, authenticated
  using (is_visible or public.is_admin());

create policy homepage_extras_insert on public.homepage_extras
  for insert to authenticated
  with check (public.is_admin());

create policy homepage_extras_update on public.homepage_extras
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy homepage_extras_delete on public.homepage_extras
  for delete to authenticated
  using (public.is_admin());

create policy opening_hours_select on public.opening_hours
  for select to anon, authenticated
  using (true);

create policy opening_hours_insert on public.opening_hours
  for insert to authenticated
  with check (public.is_admin());

create policy opening_hours_update on public.opening_hours
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy opening_hours_delete on public.opening_hours
  for delete to authenticated
  using (public.is_admin());

create policy pickup_slots_select on public.pickup_slots
  for select to anon, authenticated
  using (true);

create policy pickup_slots_insert on public.pickup_slots
  for insert to authenticated
  with check (public.is_admin());

create policy pickup_slots_update on public.pickup_slots
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy pickup_slots_delete on public.pickup_slots
  for delete to authenticated
  using (public.is_admin());

create policy blackout_select on public.blackout_ranges
  for select to anon, authenticated
  using (true);

create policy blackout_insert on public.blackout_ranges
  for insert to authenticated
  with check (public.is_admin());

create policy blackout_update on public.blackout_ranges
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy blackout_delete on public.blackout_ranges
  for delete to authenticated
  using (public.is_admin());

create policy order_settings_select on public.order_settings
  for select to anon, authenticated
  using (true);

create policy order_settings_update on public.order_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy orders_select on public.orders
  for select to authenticated
  using (public.is_admin());

create policy orders_update on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy order_items_select on public.order_items
  for select to authenticated
  using (public.is_admin());

create policy order_items_insert on public.order_items
  for insert to authenticated
  with check (public.is_admin());

create policy order_items_update on public.order_items
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy order_items_delete on public.order_items
  for delete to authenticated
  using (public.is_admin());

-- admin_users has RLS enabled and no policies.
-- anon and authenticated cannot read or write it.
-- is_admin() is security definer and reads it as the function owner.

-- ---------------------------------------------------------------------------
-- Seed: current public catalog and rules. No customer orders.
-- ---------------------------------------------------------------------------

insert into public.products (name, dietary_tags, show_on_homepage, is_available, image_url, sort_order)
values
  ('Málna – Fehércsokoládé – Bergamott', '', true, true, 'https://i.ibb.co/Sz1RwvD/TORTA-21-m-min.jpg', 10),
  ('Piemonti törökmogyoró – Tejcsokoládé – Mascarpone', 'GM', true, true, 'https://i.ibb.co/4RgX1tXV/TORTA-40-m-min.jpg', 20),
  ('Pisztácia – Maracuja - Narancs', 'GM', true, true, 'https://i.ibb.co/sdHpVN4s/54396929870-d99091a5d1-c.jpg', 30),
  ('Triplacsokoládé', '', true, true, null, 40),
  ('Belgacsokoládé-Málna-Brownie', '', true, true, null, 50),
  ('Étcsokoládé – Kókusz - Meggy', 'VEGAN, CM, GM, LM', true, true, 'https://i.ibb.co/k6gmmW6L/TORTA-51-m.jpg', 60),
  ('Gyümölcsös Mindenmentes (Mangó-Maracuja)', 'VEGAN, CM, GM, LM', true, true, 'https://i.ibb.co/PsnMPFWh/TORTA-2-min.jpg', 70);

insert into public.product_prices (product_id, slices, price_huf)
select products.id, prices.slice::smallint, prices.price::integer
from public.products
join (values
  ('Málna – Fehércsokoládé – Bergamott', 8, 14000),
  ('Málna – Fehércsokoládé – Bergamott', 12, 19000),
  ('Málna – Fehércsokoládé – Bergamott', 16, 24500),
  ('Málna – Fehércsokoládé – Bergamott', 24, 40000),
  ('Piemonti törökmogyoró – Tejcsokoládé – Mascarpone', 8, 15500),
  ('Piemonti törökmogyoró – Tejcsokoládé – Mascarpone', 12, 22500),
  ('Piemonti törökmogyoró – Tejcsokoládé – Mascarpone', 16, 28500),
  ('Piemonti törökmogyoró – Tejcsokoládé – Mascarpone', 24, 44500),
  ('Pisztácia – Maracuja - Narancs', 8, 16000),
  ('Pisztácia – Maracuja - Narancs', 12, 23000),
  ('Pisztácia – Maracuja - Narancs', 16, 30000),
  ('Pisztácia – Maracuja - Narancs', 24, 46000),
  ('Triplacsokoládé', 8, 14000),
  ('Triplacsokoládé', 12, 20000),
  ('Triplacsokoládé', 16, 25500),
  ('Triplacsokoládé', 24, 40000),
  ('Belgacsokoládé-Málna-Brownie', 8, 15500),
  ('Belgacsokoládé-Málna-Brownie', 12, 22500),
  ('Belgacsokoládé-Málna-Brownie', 16, 28500),
  ('Belgacsokoládé-Málna-Brownie', 24, 44500),
  ('Étcsokoládé – Kókusz - Meggy', 8, 13000),
  ('Étcsokoládé – Kókusz - Meggy', 12, 18000),
  ('Étcsokoládé – Kókusz - Meggy', 16, 23500),
  ('Étcsokoládé – Kókusz - Meggy', 24, 39000),
  ('Gyümölcsös Mindenmentes (Mangó-Maracuja)', 8, 13000),
  ('Gyümölcsös Mindenmentes (Mangó-Maracuja)', 12, 18000),
  ('Gyümölcsös Mindenmentes (Mangó-Maracuja)', 16, 23500),
  ('Gyümölcsös Mindenmentes (Mangó-Maracuja)', 24, 39000)
) as prices(name, slice, price) on prices.name = products.name;

insert into public.pogacsa_products (
  name, price_huf, min_order_quantity, quantity_unit, price_unit_label, image_url, is_featured, is_available, sort_order
) values
  ('Túrós-gouda sajtos apró pogácsa', 8390, 0.50, 'kg', 'Ft / kg', '/images/pogacsa.jpg', true, true, 10),
  ('Tepertős pogácsa', 9390, 1.00, 'kg', 'Ft / kg', null, false, true, 20),
  ('Aszalt paradicsomos pogácsa', 9390, 1.00, 'kg', 'Ft / kg', null, false, true, 30),
  ('Szarvasgombás pogácsa', 10390, 1.00, 'kg', 'Ft / kg', null, false, true, 40);

insert into public.homepage_extras (name, is_visible, sort_order) values
  ('Choux', true, 10),
  ('Madeleine', true, 20),
  ('Macaron', true, 30),
  ('Cake-pop', true, 40),
  ('Pohárkrémek', true, 50);

insert into public.opening_hours (day_label, opens_at, closes_at, is_closed, sort_order) values
  ('Hétfő', null, null, true, 10),
  ('Kedd-Péntek', '11:30', '18:00', false, 20),
  ('Szombat', '10:00', '18:00', false, 30),
  ('Vasárnap', '10:00', '16:00', false, 40);

-- weekday: 0 = Sunday ... 6 = Saturday. Monday uses the weekday slots;
-- slice cakes are still rejected on Monday by order_settings.
insert into public.pickup_slots (weekday, label, sort_order) values
  (1, '12:00–14:00', 10),
  (1, '14:00–16:00', 20),
  (1, '16:00–18:00', 30),
  (2, '12:00–14:00', 10),
  (2, '14:00–16:00', 20),
  (2, '16:00–18:00', 30),
  (3, '12:00–14:00', 10),
  (3, '14:00–16:00', 20),
  (3, '16:00–18:00', 30),
  (4, '12:00–14:00', 10),
  (4, '14:00–16:00', 20),
  (4, '16:00–18:00', 30),
  (5, '12:00–14:00', 10),
  (5, '14:00–16:00', 20),
  (5, '16:00–18:00', 30),
  (6, '10:00–12:00', 10),
  (6, '12:00–14:00', 20),
  (6, '14:00–16:00', 30),
  (6, '16:00–18:00', 40),
  (0, '10:00–12:00', 10),
  (0, '12:00–14:00', 20),
  (0, '14:00–16:00', 30);

insert into public.blackout_ranges (starts_on, ends_on, blocks_cakes_only, message) values (
  date '2025-12-22',
  date '2026-01-06',
  true,
  'Tortát legkésőbb 2025. december 21-ig tudunk átadni, majd legközelebb 2026. január 7-től. Az ünnepi időszakban csak szezonális termékeink rendelhetők.'
);

insert into public.order_settings (
  id,
  min_lead_days,
  rush_within_days,
  rush_surcharge_huf,
  charge_rush_surcharge,
  block_cakes_on_monday,
  candle_unit_price_huf,
  box_price_huf,
  firework_price_huf,
  opening_notice,
  guest_notice_allergy,
  guest_notice_rush,
  pickup_help_text,
  rush_warning_text,
  rush_summary_text,
  monday_block_message,
  placeholder_image_url
) values (
  1,
  2,
  5,
  3000,
  false,
  true,
  400,
  490,
  990,
  '',
  'Műhelyünkben a keresztszennyeződés lehetőségét teljes mértékben kizárni nem tudjuk, ezért kérjük, hogy allergia vagy ételintolerancia esetén rendelés előtt ezt mindenképpen vegyék figyelembe.',
  '5 napon belüli átvételi időpont esetén a rendelés rövid határidősnek minősül. Ennek részleteiről a rendelés visszaigazolásakor egyeztetünk.',
  'Minden torta frissen és gondosan készül, ezért 48 órán belül nem tudunk tortát átadni. Emellett hétfőre torta nem rendelhető, szezonális termékeink viszont továbbra is elérhetők.',
  'Figyelem! 5 napon belüli átvételi időpont esetén rövid határidős felár kerül felszámításra.',
  'A rövid határidős felár mértéke egyeztetés tárgya.',
  'Hétfőn a cukrászda zárva tart, ezért torta nem választható erre a napra. Ünnepi szezonális termékeink azonban hétfőre is rendelhetők.',
  'https://cremesdessert.com/images/logo-white.png'
);
