-- Repair order numbers after imported rows left order_number_seq behind.
-- Safe to run on the live database: replaces submit_order only.
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
  v_max_order integer;
  v_seq_last bigint;
  v_seq_called boolean;
  v_seq_next bigint;
  v_number_guard integer := 0;
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

  -- Imported rows can leave the sequence behind the highest real order number.
  -- Numbers at 10000 and above are legacy collision ids and stay outside it.
  perform pg_advisory_xact_lock(84122001::bigint);

  select coalesce(max(order_number), 0)
    into v_max_order
  from public.orders
  where order_number < 10000;

  select last_value, is_called
    into v_seq_last, v_seq_called
  from public.order_number_seq;

  v_seq_next := case when v_seq_called then v_seq_last + 1 else v_seq_last end;

  if v_max_order >= v_seq_next then
    perform setval('public.order_number_seq', v_max_order, true);
  end if;

  v_order_number := nextval('public.order_number_seq');
  while exists (
    select 1 from public.orders where order_number = v_order_number
  ) loop
    v_number_guard := v_number_guard + 1;
    if v_number_guard > 1000 then
      raise exception 'Nem sikerült szabad rendelésszámot adni.';
    end if;
    v_order_number := nextval('public.order_number_seq');
  end loop;

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
