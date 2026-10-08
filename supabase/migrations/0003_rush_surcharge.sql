-- Charge the urgency fee when pickup falls inside the rush window.
-- Safe on a live database: only updates the singleton settings row.
update public.order_settings
set
  rush_surcharge_huf = coalesce(rush_surcharge_huf, 3000),
  charge_rush_surcharge = true
where id = 1
  and charge_rush_surcharge = false;

update public.order_settings
set guest_notice_rush = 'A rendeléstől számított 5 napon belüli átvétel esetén 3.000 Ft sürgősségi felárat számítunk fel. A rövid határidős rendelés részleteiről a visszaigazoláskor egyeztetünk.'
where id = 1
  and guest_notice_rush = '5 napon belüli átvételi időpont esetén a rendelés rövid határidősnek minősül. Ennek részleteiről a rendelés visszaigazolásakor egyeztetünk.';

update public.order_settings
set rush_summary_text = 'A sürgősségi felár a rövid határidős átvétel miatt kerül a végösszeghez.'
where id = 1
  and rush_summary_text = 'A rövid határidős felár mértéke egyeztetés tárgya.';

alter table public.order_settings
  alter column rush_surcharge_huf set default 3000,
  alter column charge_rush_surcharge set default true;
