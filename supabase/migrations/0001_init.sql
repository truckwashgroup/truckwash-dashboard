-- ===========================================================================
--  Truckwash1 Dashboard — databaseschema
--
--  Plak dit in de SQL Editor van je Supabase-project en druk op Run.
--
--  Twee keuzes die hier gemaakt zijn en die de rest verklaren:
--
--  1. Alle id's zijn TEXT, niet UUID die de database zelf uitdeelt.
--     De app moet offline een nieuwe wasbeurt kunnen aanmaken; die krijgt
--     dan ter plekke een id. Zou de server het id bepalen, dan kon dat niet.
--
--  2. Alle tijdstempels zijn BIGINT met epoch-milliseconden, hetzelfde
--     formaat als in JavaScript. Geen tijdzone-conversies, geen afrondings-
--     verschillen. `updated_at` wordt door een trigger gezet met de tijd van
--     de server, zodat een telefoon met een verkeerd ingestelde klok de
--     synchronisatie niet in de war schopt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Hulpfuncties
-- ---------------------------------------------------------------------------

create or replace function public.now_ms()
returns bigint language sql stable as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- De app vraagt hiermee de servertijd op als cursor voor de volgende sync.
create or replace function public.server_time_ms()
returns bigint language sql stable as $$
  select public.now_ms();
$$;

grant execute on function public.server_time_ms() to authenticated;

create or replace function public.stamp_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := public.now_ms();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
--  Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id                    text primary key,
  name                  text not null,
  contact               text default '',
  email                 text default '',
  phone                 text default '',
  city                  text default '',
  contract_discount_pct numeric not null default 0,
  updated_at            bigint not null default public.now_ms()
);

-- Eén rij per ingelogde gebruiker. De koppeling met auth.users bepaalt wie
-- het is; deze tabel bepaalt wat diegene mag.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null default '',
  roles       text[] not null default array['employee']::text[],
  company_id  text references public.companies(id) on delete set null,
  hourly_rate numeric default 0,
  active      boolean not null default true,
  updated_at  bigint not null default public.now_ms()
);

create table if not exists public.wash_jobs (
  id            text primary key,
  ticket        text not null default '',
  company_id    text not null references public.companies(id) on delete restrict,
  company_name  text not null default '',
  plate         text not null,
  service       text not null,
  status        text not null default 'gepland'
                check (status in ('gepland','wachtrij','bezig','gereed','geannuleerd')),
  assigned_to   text,
  assigned_name text,
  scheduled_at  bigint not null,
  started_at    bigint,
  completed_at  bigint,
  price_excl    numeric not null default 0,
  notes         text,
  created_by    text,
  updated_at    bigint not null default public.now_ms()
);

create table if not exists public.inventory_items (
  id             text primary key,
  name           text not null,
  unit           text not null default 'stuk',
  stock          numeric not null default 0,
  min_stock      numeric not null default 0,
  price_per_unit numeric not null default 0,
  supplier       text default '',
  updated_at     bigint not null default public.now_ms()
);

create table if not exists public.stock_movements (
  id         text primary key,
  item_id    text not null references public.inventory_items(id) on delete cascade,
  item_name  text not null default '',
  qty        numeric not null,
  reason     text default '',
  job_id     text,
  user_id    text,
  user_name  text default '',
  at         bigint not null,
  updated_at bigint not null default public.now_ms()
);

create table if not exists public.expenses (
  id                text primary key,
  expense_date      bigint not null,
  category          text not null default 'overig'
                    check (category in ('materiaal','energie','onderhoud','personeel','transport','overig')),
  supplier          text not null default '',
  description       text default '',
  amount_excl       numeric not null default 0,
  vat_pct           numeric not null default 21,
  status            text not null default 'open'
                    check (status in ('open','goedgekeurd','afgekeurd')),
  submitted_by      text,
  submitted_by_name text default '',
  approved_by       text,
  approved_by_name  text,
  approved_at       bigint,
  reject_reason     text,
  updated_at        bigint not null default public.now_ms()
);

create table if not exists public.time_entries (
  id         text primary key,
  user_id    text not null,
  user_name  text default '',
  job_id     text,
  started_at bigint not null,
  ended_at   bigint,
  note       text,
  updated_at bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Indexen — de app haalt altijd op met "wat is er veranderd sinds ..."
-- ---------------------------------------------------------------------------

create index if not exists companies_updated_idx      on public.companies (updated_at);
create index if not exists profiles_updated_idx       on public.profiles (updated_at);
create index if not exists wash_jobs_updated_idx      on public.wash_jobs (updated_at);
create index if not exists inventory_updated_idx      on public.inventory_items (updated_at);
create index if not exists stock_moves_updated_idx    on public.stock_movements (updated_at);
create index if not exists expenses_updated_idx       on public.expenses (updated_at);
create index if not exists time_entries_updated_idx   on public.time_entries (updated_at);

create index if not exists wash_jobs_company_idx      on public.wash_jobs (company_id);
create index if not exists wash_jobs_scheduled_idx    on public.wash_jobs (scheduled_at);
create index if not exists expenses_status_idx        on public.expenses (status);

-- ---------------------------------------------------------------------------
--  updated_at altijd serverzijdig stempelen
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'companies','profiles','wash_jobs','inventory_items',
    'stock_movements','expenses','time_entries'
  ] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Wie ben ik, en wat mag ik?
--
--  security definer omdat deze functies profiles lezen terwijl er juist een
--  regel op profiles wordt geëvalueerd — zonder dit krijg je een oneindige lus.
-- ---------------------------------------------------------------------------

create or replace function public.my_roles()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(roles, array[]::text[]) from public.profiles where id = auth.uid();
$$;

create or replace function public.my_company()
returns text language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_management()
returns boolean language sql stable as $$
  select 'management' = any(public.my_roles());
$$;

-- "staf" = werknemer of management: iedereen die bij Truckwash1 werkt
create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee' = any(public.my_roles()) or 'management' = any(public.my_roles());
$$;

grant execute on function public.my_roles(), public.my_company(),
                         public.is_management(), public.is_staff() to authenticated;

-- ---------------------------------------------------------------------------
--  Nieuw account -> automatisch een profiel
--
--  Zonder dit kan iemand wel inloggen maar heeft de app geen idee wie het is.
--  Standaard krijgt een nieuwe gebruiker alleen de klantrol; rollen uitdelen
--  doet het management daarna in de app.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, roles, company_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(
        coalesce(new.raw_user_meta_data->'roles', '["customer"]'::jsonb)) as value),
      array['customer']::text[]
    ),
    new.raw_user_meta_data->>'company_id'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
--  Beveiliging op rijniveau
--
--  Dit is het belangrijkste deel: het zorgt ervoor dat klant A nooit de
--  wasbeurten, prijzen of facturen van klant B kan opvragen -- ook niet door
--  de app te omzeilen en rechtstreeks de database te bevragen.
-- ===========================================================================

alter table public.companies       enable row level security;
alter table public.profiles        enable row level security;
alter table public.wash_jobs       enable row level security;
alter table public.inventory_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.expenses        enable row level security;
alter table public.time_entries    enable row level security;

-- ------------------------------- profiles ---------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_management()) with check (public.is_management());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_management());

-- ------------------------------ companies ---------------------------------

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (public.is_staff() or id = public.my_company());

drop policy if exists companies_write on public.companies;
create policy companies_write on public.companies for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- ------------------------------ wash_jobs ---------------------------------

drop policy if exists wash_jobs_select on public.wash_jobs;
create policy wash_jobs_select on public.wash_jobs for select to authenticated
  using (public.is_staff() or company_id = public.my_company());

drop policy if exists wash_jobs_insert on public.wash_jobs;
create policy wash_jobs_insert on public.wash_jobs for insert to authenticated
  with check (public.is_staff() or company_id = public.my_company());

drop policy if exists wash_jobs_update on public.wash_jobs;
create policy wash_jobs_update on public.wash_jobs for update to authenticated
  using (public.is_staff() or company_id = public.my_company())
  with check (public.is_staff() or company_id = public.my_company());

drop policy if exists wash_jobs_delete on public.wash_jobs;
create policy wash_jobs_delete on public.wash_jobs for delete to authenticated
  using (public.is_management());

-- --------------------------- inventory_items ------------------------------
--  Voorraad is intern: klanten zien hier niets van.

drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items for select to authenticated
  using (public.is_staff());

drop policy if exists inventory_write on public.inventory_items;
create policy inventory_write on public.inventory_items for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- --------------------------- stock_movements ------------------------------

drop policy if exists stock_select on public.stock_movements;
create policy stock_select on public.stock_movements for select to authenticated
  using (public.is_staff());

drop policy if exists stock_insert on public.stock_movements;
create policy stock_insert on public.stock_movements for insert to authenticated
  with check (public.is_staff());

drop policy if exists stock_update on public.stock_movements;
create policy stock_update on public.stock_movements for update to authenticated
  using (public.is_management()) with check (public.is_management());

-- ------------------------------- expenses ---------------------------------
--  Een werknemer ziet alleen zijn eigen bonnen, en mag ze alleen aanpassen
--  zolang het management er nog niet naar gekeken heeft.

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (public.is_management() or submitted_by = auth.uid()::text);

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.is_staff() and submitted_by = auth.uid()::text);

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (public.is_management() or (submitted_by = auth.uid()::text and status = 'open'))
  with check (public.is_management() or (submitted_by = auth.uid()::text and status = 'open'));

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.is_management());

-- ----------------------------- time_entries -------------------------------

drop policy if exists time_select on public.time_entries;
create policy time_select on public.time_entries for select to authenticated
  using (public.is_management() or user_id = auth.uid()::text);

drop policy if exists time_write on public.time_entries;
create policy time_write on public.time_entries for all to authenticated
  using (public.is_management() or user_id = auth.uid()::text)
  with check (public.is_management() or user_id = auth.uid()::text);
