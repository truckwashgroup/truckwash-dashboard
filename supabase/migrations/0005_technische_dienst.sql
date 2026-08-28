-- ===========================================================================
--  Technische dienst
--
--  Draai dit ná 0004. Opnieuw draaien mag.
--
--  Vier tabellen die aan elkaar hangen:
--    assets             -- apparaten op een vestiging, met een QR-label
--    faults             -- storingsmeldingen
--    maintenance_plans  -- terugkerende beurten
--    work_orders        -- het werk zelf: uren, onderdelen, resultaat
-- ===========================================================================

create table if not exists public.assets (
  id             text primary key,
  location_id    text not null references public.locations(id) on delete cascade,
  code           text not null,
  name           text not null,
  category       text not null default 'overig'
                 check (category in ('wasstraat','borstelunit','hogedruk','waterzuivering',
                                     'osmose','compressor','doseerunit','droger',
                                     'heftruck','elektra','gebouw','overig')),
  brand          text,
  model          text,
  serial_number  text,
  status         text not null default 'in bedrijf'
                 check (status in ('in bedrijf','storing','onderhoud','buiten gebruik')),
  installed_at   bigint,
  warranty_until bigint,
  running_hours  numeric,
  location       text,
  notes          text,
  -- De sleutel op het QR-label. Bewust apart van het id: een label kan
  -- worden vervangen zonder dat de historie eraan verandert, en wie een
  -- sticker fotografeert leest geen database-id mee.
  qr_token       text not null,
  last_service_at bigint,
  next_service_at bigint,
  updated_at     bigint not null default public.now_ms()
);

create unique index if not exists assets_qr_idx      on public.assets (qr_token);
create unique index if not exists assets_code_idx    on public.assets (location_id, code);
create index        if not exists assets_loc_idx     on public.assets (location_id);
create index        if not exists assets_updated_idx on public.assets (updated_at);

create table if not exists public.faults (
  id                text primary key,
  number            text not null,
  location_id       text not null references public.locations(id) on delete cascade,
  asset_id          text references public.assets(id) on delete set null,
  asset_name        text,
  title             text not null,
  description       text not null default '',
  severity          text not null default 'middel'
                    check (severity in ('laag','middel','hoog','kritiek')),
  status            text not null default 'gemeld'
                    check (status in ('gemeld','in behandeling','wacht op onderdelen','opgelost','afgewezen')),
  stops_production  boolean not null default false,
  reported_by       text,
  reported_by_name  text default '',
  reported_at       bigint not null,
  assigned_to       text,
  assigned_name     text,
  resolved_at       bigint,
  resolution        text,
  downtime_minutes  integer,
  work_order_id     text,
  updated_at        bigint not null default public.now_ms()
);

create index if not exists faults_loc_idx     on public.faults (location_id);
create index if not exists faults_status_idx  on public.faults (status);
create index if not exists faults_asset_idx   on public.faults (asset_id);
create index if not exists faults_updated_idx on public.faults (updated_at);

create table if not exists public.maintenance_plans (
  id                text primary key,
  asset_id          text references public.assets(id) on delete cascade,
  location_id       text references public.locations(id) on delete cascade,
  category          text,
  title             text not null,
  description       text,
  interval          text not null default 'maandelijks'
                    check (interval in ('wekelijks','maandelijks','kwartaal','halfjaar','jaar')),
  checklist         jsonb not null default '[]'::jsonb,
  estimated_minutes integer not null default 60,
  last_done_at      bigint,
  next_due_at       bigint not null,
  active            boolean not null default true,
  updated_at        bigint not null default public.now_ms()
);

create index if not exists plans_loc_idx     on public.maintenance_plans (location_id);
create index if not exists plans_due_idx     on public.maintenance_plans (next_due_at);
create index if not exists plans_updated_idx on public.maintenance_plans (updated_at);

create table if not exists public.work_orders (
  id             text primary key,
  number         text not null,
  location_id    text not null references public.locations(id) on delete cascade,
  asset_id       text references public.assets(id) on delete set null,
  asset_name     text,
  fault_id       text references public.faults(id) on delete set null,
  plan_id        text references public.maintenance_plans(id) on delete set null,
  type           text not null default 'storing'
                 check (type in ('storing','preventief','inspectie','modificatie')),
  priority       text not null default 'normaal'
                 check (priority in ('laag','normaal','hoog','spoed')),
  status         text not null default 'open'
                 check (status in ('open','ingepland','bezig','gereed','geannuleerd')),
  title          text not null,
  description    text,
  created_by     text,
  created_by_name text default '',
  created_at     bigint not null,
  assigned_to    text,
  assigned_name  text,
  planned_at     bigint,
  started_at     bigint,
  completed_at   bigint,
  minutes_spent  integer,
  parts          jsonb not null default '[]'::jsonb,
  checklist      jsonb not null default '[]'::jsonb,
  work_done      text,
  signed_off_by  text,
  external_cost  numeric,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists orders_loc_idx      on public.work_orders (location_id);
create index if not exists orders_status_idx   on public.work_orders (status);
create index if not exists orders_assigned_idx on public.work_orders (assigned_to);
create index if not exists orders_updated_idx  on public.work_orders (updated_at);

-- De verwijzing van storing naar werkbon kon pas nu, omdat work_orders later
-- wordt aangemaakt dan faults.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'faults_work_order_fkey') then
    alter table public.faults
      add constraint faults_work_order_fkey
      foreign key (work_order_id) references public.work_orders(id) on delete set null;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['assets','faults','maintenance_plans','work_orders'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Beveiliging
--
--  Alles is per vestiging afgeschermd, net als de rest. Een monteur die twee
--  vestigingen doet, ziet de installaties van de andere zeventien niet.
-- ---------------------------------------------------------------------------

alter table public.assets            enable row level security;
alter table public.faults            enable row level security;
alter table public.maintenance_plans enable row level security;
alter table public.work_orders       enable row level security;

-- Installaties: iedereen die op die vestiging werkt mag ze zien, want je moet
-- een storing kunnen melden. Wijzigen is voorbehouden aan de techniek.
drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists assets_write on public.assets;
create policy assets_write on public.assets for all to authenticated
  using (public.is_lead() and public.in_my_locations(location_id))
  with check (public.is_lead() and public.in_my_locations(location_id));

-- Storingen: melden mag iedereen op de vestiging, afhandelen de leiding.
drop policy if exists faults_select on public.faults;
create policy faults_select on public.faults for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists faults_insert on public.faults;
create policy faults_insert on public.faults for insert to authenticated
  with check (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists faults_update on public.faults;
create policy faults_update on public.faults for update to authenticated
  using (public.is_lead() and public.in_my_locations(location_id))
  with check (public.is_lead() and public.in_my_locations(location_id));

drop policy if exists faults_delete on public.faults;
create policy faults_delete on public.faults for delete to authenticated
  using (public.is_management());

-- Onderhoudsschemas
drop policy if exists plans_select on public.maintenance_plans;
create policy plans_select on public.maintenance_plans for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists plans_write on public.maintenance_plans;
create policy plans_write on public.maintenance_plans for all to authenticated
  using (public.is_lead() and public.in_my_locations(location_id))
  with check (public.is_lead() and public.in_my_locations(location_id));

-- Werkbonnen
drop policy if exists orders_select on public.work_orders;
create policy orders_select on public.work_orders for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists orders_write on public.work_orders;
create policy orders_write on public.work_orders for all to authenticated
  using (public.is_lead() and public.in_my_locations(location_id))
  with check (public.is_lead() and public.in_my_locations(location_id));

-- ---------------------------------------------------------------------------
--  De technische dienst telt mee als leiding
--
--  is_lead() bepaalt wie storingen mag afhandelen en werkbonnen mag maken.
--  Zonder deze aanpassing zou een monteur alleen mogen kijken.
-- ---------------------------------------------------------------------------

create or replace function public.is_technician()
returns boolean language sql stable as $$
  select 'technician' = any(public.my_roles());
$$;

create or replace function public.is_lead()
returns boolean language sql stable as $$
  select public.is_supervisor() or public.is_management() or public.is_technician();
$$;

create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee'   = any(public.my_roles())
      or 'supervisor' = any(public.my_roles())
      or 'technician' = any(public.my_roles())
      or 'management' = any(public.my_roles());
$$;

grant execute on function public.is_technician() to authenticated;
