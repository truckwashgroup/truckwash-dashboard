-- ===========================================================================
--  Truckwash1 Dashboard -- ALLES IN EEN KEER
--
--  Selecteer alles, plak het in de SQL Editor van Supabase en druk op Run.
--  Opnieuw draaien mag: het maakt niets dubbel aan en gooit niets weg.
--
--  Dit bestand wordt gemaakt door scripts/build-setup-sql.cjs. Wijzig de
--  migraties in supabase/migrations, niet dit bestand.
-- ===========================================================================

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
  select coalesce(roles, array[]::text[]) from public.profiles where id::text = auth.uid()::text;
$$;

create or replace function public.my_company()
returns text language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id::text = auth.uid()::text;
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
-- De vergelijking gaat via text, zodat deze regel blijft werken nadat
-- 0002 het id-type omzet naar text.
create policy profiles_select on public.profiles for select to authenticated
  using (id::text = auth.uid()::text or public.is_staff());

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

-- ===========================================================================
--  Personeelsdossiers en rooster
--
--  Draai dit ná 0001_init.sql. Opnieuw draaien mag.
--
--  De belangrijkste verandering: een persoon en een inlogaccount zijn niet
--  langer hetzelfde. Het management moet iemand kunnen toevoegen voordat die
--  kan inloggen -- een account aanmaken vereist namelijk beheerdersrechten,
--  en die horen niet in een app die op telefoons staat.
--
--  Daarom krijgt profiles een eigen id (text, door de app te maken, ook
--  offline) en een losse verwijzing auth_id naar het inlogaccount. Zodra
--  iemand voor het eerst inlogt, koppelt de trigger onderaan het dossier op
--  e-mailadres.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. profiles losmaken van auth.users
--
--  Let op de volgorde: Postgres weigert het type van een kolom te wijzigen
--  zolang er een beveiligingsregel naar verwijst. De regels op profiles gaan
--  er dus eerst af, en aan het eind van dit bestand weer op.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists auth_id uuid;

-- Bestaande rijen: het id was de auth-uuid, dus die nemen we over. De
-- regexcontrole is er voor het geval dit bestand al eerder deels liep en er
-- inmiddels door de app gemaakte id's in staan.
update public.profiles
   set auth_id = id::text::uuid
 where auth_id is null
   and id::text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- Alle regels op profiles tijdelijk weghalen, ongeacht hoe ze heten.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
  end loop;
end $$;

-- De koppeling naar auth.users hangt voortaan aan auth_id, niet aan id.
alter table public.profiles drop constraint if exists profiles_id_fkey;

do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles' and column_name = 'id') <> 'text'
  then
    alter table public.profiles alter column id type text using id::text;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_auth_id_fkey') then
    alter table public.profiles
      add constraint profiles_auth_id_fkey
      foreign key (auth_id) references auth.users(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_auth_id_key') then
    alter table public.profiles add constraint profiles_auth_id_key unique (auth_id);
  end if;
end $$;

create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
--  2. Personeelsvelden
--
--  "function" is een gereserveerd woord in SQL, vandaar job_title. De app
--  vertaalt dat heen en weer.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists personnel_number text;
alter table public.profiles add column if not exists phone            text;
alter table public.profiles add column if not exists job_title        text;
alter table public.profiles add column if not exists contract_hours   numeric;
alter table public.profiles add column if not exists start_date       bigint;
alter table public.profiles add column if not exists end_date         bigint;
alter table public.profiles add column if not exists notes            text;

create unique index if not exists profiles_personnel_number_idx
  on public.profiles (personnel_number) where personnel_number is not null;

-- ---------------------------------------------------------------------------
--  3. Hulpfuncties bijwerken: ze hingen aan id, nu aan auth_id
-- ---------------------------------------------------------------------------

create or replace function public.my_roles()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(roles, array[]::text[]) from public.profiles where auth_id = auth.uid();
$$;

create or replace function public.my_company()
returns text language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where auth_id = auth.uid();
$$;

-- Het id van mijn eigen dossier. Records verwijzen hiernaar, niet naar de
-- auth-uuid, want ze kunnen aangemaakt zijn voordat iemand een account had.
create or replace function public.my_id()
returns text language sql stable security definer set search_path = public as $$
  select id from public.profiles where auth_id = auth.uid();
$$;

grant execute on function public.my_id() to authenticated;

-- ---------------------------------------------------------------------------
--  4. Nieuw account koppelen aan een bestaand dossier
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing_id text;
begin
  -- Staat er al een dossier klaar op dit e-mailadres? Dan koppelen we dat.
  select id into existing_id
    from public.profiles
   where lower(email) = lower(new.email)
     and auth_id is null
   limit 1;

  if existing_id is not null then
    update public.profiles set auth_id = new.id where id = existing_id;
    return new;
  end if;

  -- Anders een nieuw dossier, standaard alleen de klantrol.
  insert into public.profiles (id, auth_id, email, name, roles, company_id)
  values (
    new.id::text,
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

-- ---------------------------------------------------------------------------
--  5. Rooster
-- ---------------------------------------------------------------------------

create table if not exists public.shifts (
  id            text primary key,
  user_id       text not null,
  user_name     text not null default '',
  kind          text not null default 'dienst'
                check (kind in ('dienst','verlof','ziek','vrij')),
  start_at      bigint not null,
  end_at        bigint not null,
  break_minutes integer not null default 0,
  note          text,
  created_by    text,
  updated_at    bigint not null default public.now_ms()
);

create index if not exists shifts_user_idx    on public.shifts (user_id);
create index if not exists shifts_start_idx   on public.shifts (start_at);
create index if not exists shifts_updated_idx on public.shifts (updated_at);

drop trigger if exists stamp_shifts on public.shifts;
create trigger stamp_shifts before insert or update on public.shifts
  for each row execute function public.stamp_updated_at();

alter table public.shifts enable row level security;

-- Iedereen die bij Truckwash1 werkt mag het rooster zien: je moet weten wie
-- er naast je staat. Wijzigen mag alleen het management.
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts for select to authenticated
  using (public.is_staff());

drop policy if exists shifts_write on public.shifts;
create policy shifts_write on public.shifts for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- ---------------------------------------------------------------------------
--  6. Beleid dat naar auth.uid() verwees, wijst nu naar het dossier-id
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (auth_id = auth.uid() or public.is_staff());

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (public.is_management() or submitted_by = public.my_id());

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.is_staff() and submitted_by = public.my_id());

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (public.is_management() or (submitted_by = public.my_id() and status = 'open'))
  with check (public.is_management() or (submitted_by = public.my_id() and status = 'open'));

drop policy if exists time_select on public.time_entries;
create policy time_select on public.time_entries for select to authenticated
  using (public.is_management() or user_id = public.my_id());

drop policy if exists time_write on public.time_entries;
create policy time_write on public.time_entries for all to authenticated
  using (public.is_management() or user_id = public.my_id())
  with check (public.is_management() or user_id = public.my_id());

-- Het management mag dossiers aanmaken en bijwerken (ook zonder inlogaccount).
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_management());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_management() or auth_id = auth.uid())
  with check (public.is_management() or auth_id = auth.uid());

-- ===========================================================================
--  Rechten per persoon, berichten en e-learning
--
--  Draai dit ná 0002. Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Rechten en aansturing op het personeelsdossier
--
--  De rol geeft de basis; grants en revokes zijn de afwijkingen daarop. We
--  slaan alleen die afwijkingen op, zodat een latere wijziging in wat een rol
--  betekent gewoon blijft doorwerken.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists grants        text[] default '{}';
alter table public.profiles add column if not exists revokes       text[] default '{}';
alter table public.profiles add column if not exists supervisor_id text;

create index if not exists profiles_supervisor_idx on public.profiles (supervisor_id);

-- Leidinggevende is een volwaardige rol naast werknemer en management.
create or replace function public.is_supervisor()
returns boolean language sql stable as $$
  select 'supervisor' = any(public.my_roles());
$$;

-- "Leiding" = leidinggevende of management: mag het team overzien.
create or replace function public.is_lead()
returns boolean language sql stable as $$
  select public.is_supervisor() or public.is_management();
$$;

grant execute on function public.is_supervisor(), public.is_lead() to authenticated;

-- is_staff moet de nieuwe rol ook meetellen
create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee'   = any(public.my_roles())
      or 'supervisor' = any(public.my_roles())
      or 'management' = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  2. Berichten
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id           text primary key,
  to_user_id   text,
  to_role      text check (to_role in ('employee','supervisor','customer','management')),
  kind         text not null default 'info'
               check (kind in ('info','taak','waarschuwing','rooster','opleiding')),
  title        text not null,
  body         text not null default '',
  from_user_id text,
  from_name    text default '',
  created_at   bigint not null,
  read_at      bigint,
  link         text,
  updated_at   bigint not null default public.now_ms(),
  -- Een bericht gaat naar één persoon of naar een rol, niet naar allebei
  constraint notifications_target check (to_user_id is not null or to_role is not null)
);

create index if not exists notifications_user_idx    on public.notifications (to_user_id);
create index if not exists notifications_role_idx    on public.notifications (to_role);
create index if not exists notifications_updated_idx on public.notifications (updated_at);

drop trigger if exists stamp_notifications on public.notifications;
create trigger stamp_notifications before insert or update on public.notifications
  for each row execute function public.stamp_updated_at();

alter table public.notifications enable row level security;

-- Je ziet wat aan jou is gericht, of aan een rol die jij hebt.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (
    to_user_id = public.my_id()
    or (to_role is not null and to_role = any(public.my_roles()))
    or from_user_id = public.my_id()
  );

-- Versturen mag alleen wie leiding geeft.
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.is_lead() and from_user_id = public.my_id());

-- Bijwerken is in de praktijk "gelezen zetten": alleen op je eigen berichten.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (
    to_user_id = public.my_id()
    or (to_role is not null and to_role = any(public.my_roles()))
    or public.is_management()
  )
  with check (
    to_user_id = public.my_id()
    or (to_role is not null and to_role = any(public.my_roles()))
    or public.is_management()
  );

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (public.is_management());

-- ---------------------------------------------------------------------------
--  3. E-learning
--
--  Lessen en toetsvragen staan als jsonb bij de cursus. Dat houdt een cursus
--  één record, wat het synchroniseren en het offline lezen eenvoudig houdt.
-- ---------------------------------------------------------------------------

create table if not exists public.courses (
  id                text primary key,
  code              text not null,
  title             text not null,
  summary           text default '',
  category          text not null default 'veiligheid'
                    check (category in ('veiligheid','chemie','machine','kwaliteit','klant')),
  estimated_minutes integer not null default 15,
  required_for      text[] not null default '{}',
  valid_months      integer,
  pass_score        integer not null default 75,
  version           integer not null default 1,
  lessons           jsonb not null default '[]'::jsonb,
  quiz              jsonb not null default '[]'::jsonb,
  updated_at        bigint not null default public.now_ms()
);

create index if not exists courses_updated_idx on public.courses (updated_at);

create table if not exists public.course_progress (
  id           text primary key,
  user_id      text not null,
  user_name    text default '',
  course_id    text not null references public.courses(id) on delete cascade,
  started_at   bigint not null default 0,
  lesson_index integer not null default 0,
  completed_at bigint,
  score        integer,
  passed       boolean not null default false,
  attempts     integer not null default 0,
  expires_at   bigint,
  assigned_by  text,
  due_at       bigint,
  updated_at   bigint not null default public.now_ms()
);

create index if not exists progress_user_idx    on public.course_progress (user_id);
create index if not exists progress_course_idx  on public.course_progress (course_id);
create index if not exists progress_updated_idx on public.course_progress (updated_at);

do $$
declare t text;
begin
  foreach t in array array['courses','course_progress'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

alter table public.courses         enable row level security;
alter table public.course_progress enable row level security;

-- Lesmateriaal mag iedereen lezen die bij ons werkt; wijzigen alleen management.
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select to authenticated
  using (public.is_staff());

drop policy if exists courses_write on public.courses;
create policy courses_write on public.courses for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- Je eigen voortgang, en die van je team als je leiding geeft.
drop policy if exists progress_select on public.course_progress;
create policy progress_select on public.course_progress for select to authenticated
  using (user_id = public.my_id() or public.is_lead());

drop policy if exists progress_insert on public.course_progress;
create policy progress_insert on public.course_progress for insert to authenticated
  with check (user_id = public.my_id() or public.is_lead());

drop policy if exists progress_update on public.course_progress;
create policy progress_update on public.course_progress for update to authenticated
  using (user_id = public.my_id() or public.is_lead())
  with check (user_id = public.my_id() or public.is_lead());

-- ---------------------------------------------------------------------------
--  4. Leidinggevenden mogen hun team overzien
--
--  Tot nu toe kon alleen het management de uren en bonnen van anderen zien.
--  Een leidinggevende hoort dat voor zijn eigen mensen ook te kunnen.
-- ---------------------------------------------------------------------------

drop policy if exists time_select on public.time_entries;
create policy time_select on public.time_entries for select to authenticated
  using (public.is_lead() or user_id = public.my_id());

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (public.is_lead() or submitted_by = public.my_id());

-- Het rooster maken mag nu ook de leidinggevende, niet alleen het management.
drop policy if exists shifts_write on public.shifts;
create policy shifts_write on public.shifts for all to authenticated
  using (public.is_lead()) with check (public.is_lead());

-- ===========================================================================
--  Vestigingen
--
--  Draai dit ná 0003. Opnieuw draaien mag.
--
--  De organisatie bestaat uit vestigingen plus een hoofdkantoor. Bijna alles
--  hangt aan een vestiging: wasbeurten, roosters, voorraad, kosten en uren.
--
--  Rechten zeggen *wat* iemand mag; de vestigingen zeggen *waar*. Een
--  leidinggevende met het recht om roosters te maken, maakt ze alleen voor de
--  vestigingen die aan hem hangen -- niet voor de andere achttien.
-- ===========================================================================

create table if not exists public.locations (
  id           text primary key,
  code         text not null,
  name         text not null,
  kind         text not null default 'vestiging'
               check (kind in ('vestiging','hoofdkantoor')),
  address      text default '',
  postcode     text default '',
  city         text default '',
  phone        text,
  manager_id   text,
  manager_name text,
  bays         integer not null default 2,
  active       boolean not null default true,
  updated_at   bigint not null default public.now_ms()
);

create unique index if not exists locations_code_idx    on public.locations (code);
create index        if not exists locations_updated_idx on public.locations (updated_at);

drop trigger if exists stamp_locations on public.locations;
create trigger stamp_locations before insert or update on public.locations
  for each row execute function public.stamp_updated_at();

-- ---------------------------------------------------------------------------
--  Koppelingen op bestaande tabellen
-- ---------------------------------------------------------------------------

alter table public.profiles        add column if not exists location_id    text references public.locations(id) on delete set null;
alter table public.profiles        add column if not exists manages        text[] default '{}';
alter table public.profiles        add column if not exists all_locations  boolean not null default false;

alter table public.wash_jobs       add column if not exists location_id text references public.locations(id) on delete restrict;
alter table public.inventory_items add column if not exists location_id text references public.locations(id) on delete cascade;
alter table public.expenses        add column if not exists location_id text references public.locations(id) on delete set null;
alter table public.shifts          add column if not exists location_id text references public.locations(id) on delete set null;
alter table public.time_entries    add column if not exists location_id text references public.locations(id) on delete set null;
alter table public.stock_movements add column if not exists location_id text references public.locations(id) on delete set null;

create index if not exists profiles_location_idx   on public.profiles (location_id);
create index if not exists wash_jobs_location_idx  on public.wash_jobs (location_id);
create index if not exists inventory_location_idx  on public.inventory_items (location_id);
create index if not exists expenses_location_idx   on public.expenses (location_id);
create index if not exists shifts_location_idx     on public.shifts (location_id);

-- ---------------------------------------------------------------------------
--  Bereik van een gebruiker
--
--  security definer, net als de andere hulpfuncties: ze lezen profiles
--  terwijl er juist een regel op profiles wordt geëvalueerd.
-- ---------------------------------------------------------------------------

create or replace function public.sees_all_locations()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select all_locations from public.profiles where auth_id = auth.uid()),
    false
  ) or 'locations.all' = any(coalesce(
    (select grants from public.profiles where auth_id = auth.uid()),
    array[]::text[]
  ));
$$;

/**
 * De vestigingen waar ik iets mag zien of doen: mijn eigen vestiging plus de
 * vestigingen waar ik leiding over heb.
 */
create or replace function public.my_locations()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    array_remove(
      coalesce((select manages from public.profiles where auth_id = auth.uid()), array[]::text[])
        || coalesce((select location_id from public.profiles where auth_id = auth.uid()), ''),
      ''
    ),
    array[]::text[]
  );
$$;

/** Mag ik bij deze vestiging? Records zonder vestiging zijn voor iedereen. */
create or replace function public.in_my_locations(loc text)
returns boolean language sql stable as $$
  select loc is null
      or public.sees_all_locations()
      or loc = any(public.my_locations());
$$;

grant execute on function public.sees_all_locations(), public.my_locations(),
                         public.in_my_locations(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.locations enable row level security;

drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations for select to authenticated
  using (
    -- Klanten mogen de vestigingen zien om een afspraak te kunnen maken.
    true
  );

drop policy if exists locations_write on public.locations;
create policy locations_write on public.locations for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- Wasbeurten: staf ziet alleen de eigen vestigingen, klanten alleen hun
-- eigen wagens (ongeacht waar die gewassen worden).
drop policy if exists wash_jobs_select on public.wash_jobs;
create policy wash_jobs_select on public.wash_jobs for select to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or company_id = public.my_company()
  );

drop policy if exists wash_jobs_update on public.wash_jobs;
create policy wash_jobs_update on public.wash_jobs for update to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or company_id = public.my_company()
  )
  with check (
    (public.is_staff() and public.in_my_locations(location_id))
    or company_id = public.my_company()
  );

-- Voorraad hoort bij een vestiging en is intern.
drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists inventory_write on public.inventory_items;
create policy inventory_write on public.inventory_items for all to authenticated
  using (public.is_staff() and public.in_my_locations(location_id))
  with check (public.is_staff() and public.in_my_locations(location_id));

-- Roosters: zichtbaar voor de staf van die vestiging, te wijzigen door de
-- leiding die er verantwoordelijk voor is.
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists shifts_write on public.shifts;
create policy shifts_write on public.shifts for all to authenticated
  using (public.is_lead() and public.in_my_locations(location_id))
  with check (public.is_lead() and public.in_my_locations(location_id));

-- Kosten: eigen bonnen altijd, die van anderen alleen als leiding op die
-- vestiging.
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (
    submitted_by = public.my_id()
    or (public.is_lead() and public.in_my_locations(location_id))
  );

-- Personeel: je ziet collega's van je eigen vestigingen. Het hoofdkantoor
-- ziet iedereen.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    auth_id = auth.uid()
    or public.sees_all_locations()
    or (public.is_staff() and public.in_my_locations(location_id))
  );

-- ---------------------------------------------------------------------------
--  Startvestiging
--
--  Zonder minstens één vestiging kan er niets aan gekoppeld worden. Het
--  hoofdkantoor maken we alvast aan; de rest voeg je toe in de app.
-- ---------------------------------------------------------------------------

insert into public.locations (id, code, name, kind, address, postcode, city, bays)
values ('loc_hk', 'TW-HK', 'Hoofdkantoor', 'hoofdkantoor',
        'Proostwetering 10', '3543 AH', 'Utrecht', 0)
on conflict (id) do nothing;

-- Bestaande gebruikers zonder vestiging aan het hoofdkantoor hangen, zodat
-- niemand plotseling nergens meer bij kan.
update public.profiles
   set location_id = 'loc_hk'
 where location_id is null;

-- Wie management is, mag standaard overal bij.
update public.profiles
   set all_locations = true
 where 'management' = any(roles) and all_locations = false;

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

-- ===========================================================================
--  Meldingen aan de ontwikkelaar, en het logboek
--
--  Draai dit ná 0005. Opnieuw draaien mag.
--
--  Anders dan de rest is dit niet per vestiging afgeschermd: een fout in de
--  app raakt iedereen, en de ontwikkelaar moet hem overal kunnen zien. Wat wel
--  geldt: je ziet je eigen meldingen, en verder niets -- tenzij je de rol
--  ontwikkelaar hebt.
-- ===========================================================================

create table if not exists public.tickets (
  id               text primary key,
  number           text not null,
  title            text not null,
  description      text not null default '',
  kind             text not null default 'fout'
                   check (kind in ('fout','vraag','wens','traag')),
  priority         text not null default 'normaal'
                   check (priority in ('laag','normaal','hoog','blokkerend')),
  status           text not null default 'nieuw'
                   check (status in ('nieuw','in behandeling','wacht op melder','opgelost','gesloten')),

  reported_by      text,
  reported_by_name text default '',
  reported_at      bigint not null,
  from_role        text,
  from_page        text,
  location_id      text references public.locations(id) on delete set null,

  -- Technische context, automatisch meegestuurd bij het melden
  app_version      text default '',
  platform         text default '',
  user_agent       text default '',
  screen           text default '',
  online           boolean not null default true,
  pending_changes  integer not null default 0,
  -- Wat de melder het kwartier ervoor deed
  trail            jsonb not null default '[]'::jsonb,

  assigned_to      text,
  assigned_name    text,
  resolved_at      bigint,
  resolution       text,
  fixed_in         text,
  updated_at       bigint not null default public.now_ms()
);

create index if not exists tickets_status_idx   on public.tickets (status);
create index if not exists tickets_reporter_idx on public.tickets (reported_by);
create index if not exists tickets_updated_idx  on public.tickets (updated_at);

create table if not exists public.ticket_messages (
  id          text primary key,
  ticket_id   text not null references public.tickets(id) on delete cascade,
  author_id   text,
  author_name text default '',
  -- Interne notities blijven binnen het ontwikkelteam
  internal    boolean not null default false,
  body        text not null,
  created_at  bigint not null,
  updated_at  bigint not null default public.now_ms()
);

create index if not exists messages_ticket_idx  on public.ticket_messages (ticket_id);
create index if not exists messages_updated_idx on public.ticket_messages (updated_at);

create table if not exists public.log_events (
  id          text primary key,
  level       text not null default 'fout'
              check (level in ('fout','waarschuwing','info')),
  message     text not null,
  stack       text,
  page        text,
  user_id     text,
  user_name   text,
  location_id text,
  app_version text default '',
  platform    text default '',
  at          bigint not null,
  -- Dezelfde fout wordt opgeteld in plaats van herhaald
  count       integer not null default 1,
  ticket_id   text references public.tickets(id) on delete set null,
  updated_at  bigint not null default public.now_ms()
);

create index if not exists logs_level_idx   on public.log_events (level);
create index if not exists logs_at_idx      on public.log_events (at);
create index if not exists logs_updated_idx on public.log_events (updated_at);

do $$
declare t text;
begin
  foreach t in array array['tickets','ticket_messages','log_events'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Wie is ontwikkelaar?
-- ---------------------------------------------------------------------------

create or replace function public.is_developer()
returns boolean language sql stable as $$
  select 'developer' = any(public.my_roles());
$$;

grant execute on function public.is_developer() to authenticated;

-- De ontwikkelaar telt mee als medewerker, zodat hij de app kan gebruiken.
create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee'   = any(public.my_roles())
      or 'supervisor' = any(public.my_roles())
      or 'technician' = any(public.my_roles())
      or 'management' = any(public.my_roles())
      or 'developer'  = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.tickets         enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.log_events      enable row level security;

-- Je eigen meldingen, en alles als je ontwikkelaar bent.
drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
  using (reported_by = public.my_id() or public.is_developer());

-- Melden mag iedereen die is ingelogd, maar alleen namens zichzelf.
drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (reported_by = public.my_id());

-- De melder mag zijn eigen melding heropenen; de rest doet de ontwikkelaar.
drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update to authenticated
  using (reported_by = public.my_id() or public.is_developer())
  with check (reported_by = public.my_id() or public.is_developer());

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets for delete to authenticated
  using (public.is_developer());

-- Berichten: interne notities blijven bij het ontwikkelteam.
drop policy if exists messages_select on public.ticket_messages;
create policy messages_select on public.ticket_messages for select to authenticated
  using (
    public.is_developer()
    or (
      internal = false
      and exists (
        select 1 from public.tickets t
         where t.id = ticket_id and t.reported_by = public.my_id()
      )
    )
  );

drop policy if exists messages_insert on public.ticket_messages;
create policy messages_insert on public.ticket_messages for insert to authenticated
  with check (
    author_id = public.my_id()
    and (
      public.is_developer()
      -- Een melder mag reageren op zijn eigen melding, maar geen interne
      -- notitie schrijven.
      or (
        internal = false
        and exists (
          select 1 from public.tickets t
           where t.id = ticket_id and t.reported_by = public.my_id()
        )
      )
    )
  );

drop policy if exists messages_update on public.ticket_messages;
create policy messages_update on public.ticket_messages for update to authenticated
  using (public.is_developer()) with check (public.is_developer());

-- Logboek: schrijven mag iedereen (de app doet dat automatisch), lezen alleen
-- de ontwikkelaar. Er kan immers een foutmelding in staan die iets prijsgeeft.
drop policy if exists logs_select on public.log_events;
create policy logs_select on public.log_events for select to authenticated
  using (public.is_developer());

drop policy if exists logs_insert on public.log_events;
create policy logs_insert on public.log_events for insert to authenticated
  with check (true);

drop policy if exists logs_update on public.log_events;
create policy logs_update on public.log_events for update to authenticated
  using (true) with check (true);

drop policy if exists logs_delete on public.log_events;
create policy logs_delete on public.log_events for delete to authenticated
  using (public.is_developer());

-- ===========================================================================
--  Zelf aanmelden, het overleg, en verstuurde post
--
--  Draai dit ná 0006. Opnieuw draaien mag.
--
--  Drie dingen zitten hierin:
--
--   1. Aanmelden. Iemand maakt zelf een inlogaccount aan -- meer kan een
--      bezoeker niet -- en belandt in een lijst bij het management. Daar
--      wordt hij toegelaten of afgewezen. Er hoeft nooit meer iemand met
--      de hand in Supabase.
--
--   2. Overleg. Kanalen, vestigingskanalen en rechtstreekse gesprekken.
--
--   3. Post. Een logboek van wat de serverfunctie via Resend heeft
--      verstuurd, zodat "ik heb niets gekregen" na te kijken is.
--
--  BELANGRIJK -- dit bestand dicht ook een gat. In de oude versie las de
--  trigger de rollen uit de gegevens die bij het aanmaken van het account
--  werden meegestuurd. Die komen van de client, en dus kon iemand die de
--  publieke sleutel had zichzelf aanmelden mét de rol management. Vanaf nu
--  worden die gegevens genegeerd: een nieuw account krijgt géén rollen en
--  staat op inactief tot een mens het toelaat.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Aanmeldingen
-- ---------------------------------------------------------------------------

create table if not exists public.signups (
  id              text primary key,
  name            text not null default '',
  email           text not null,
  phone           text,
  kind            text not null default 'werknemer'
                  check (kind in ('werknemer','klant')),
  company_name    text,
  location_id     text references public.locations(id) on delete set null,
  message         text,
  status          text not null default 'nieuw'
                  check (status in ('nieuw','goedgekeurd','afgewezen')),
  created_at      bigint not null default public.now_ms(),

  auth_id         uuid references auth.users(id) on delete cascade,
  profile_id      text,

  handled_by      text,
  handled_by_name text,
  handled_at      bigint,
  reject_reason   text,
  updated_at      bigint not null default public.now_ms()
);

create index if not exists signups_status_idx  on public.signups (status);
create index if not exists signups_email_idx   on public.signups (lower(email));
create index if not exists signups_updated_idx on public.signups (updated_at);

-- ---------------------------------------------------------------------------
--  2. Overleg
-- ---------------------------------------------------------------------------

create table if not exists public.channels (
  id          text primary key,
  slug        text not null default '',
  name        text not null,
  kind        text not null default 'kanaal'
              check (kind in ('kanaal','vestiging','gesprek')),
  topic       text,
  location_id text references public.locations(id) on delete cascade,
  private     boolean not null default false,
  member_ids  text[] not null default '{}',
  created_by  text,
  created_at  bigint not null default public.now_ms(),
  archived    boolean not null default false,
  updated_at  bigint not null default public.now_ms()
);

create index if not exists channels_kind_idx    on public.channels (kind);
create index if not exists channels_updated_idx on public.channels (updated_at);

create table if not exists public.chat_messages (
  id            text primary key,
  channel_id    text not null references public.channels(id) on delete cascade,
  author_id     text,
  author_name   text not null default '',
  body          text not null default '',
  at            bigint not null,
  edited_at     bigint,
  reply_to_id   text,
  reply_to_name text,
  reply_to_body text,
  mentions      text[] not null default '{}',
  deleted_at    bigint,
  deleted_by    text,
  updated_at    bigint not null default public.now_ms()
);

create index if not exists chat_channel_idx on public.chat_messages (channel_id, at);
create index if not exists chat_updated_idx on public.chat_messages (updated_at);

-- Tot waar iemand een kanaal heeft gelezen. Eén rij per persoon per kanaal.
create table if not exists public.channel_reads (
  id           text primary key,
  user_id      text not null,
  channel_id   text not null references public.channels(id) on delete cascade,
  last_read_at bigint not null default 0,
  updated_at   bigint not null default public.now_ms()
);

create index if not exists reads_user_idx    on public.channel_reads (user_id);
create index if not exists reads_updated_idx on public.channel_reads (updated_at);

-- ---------------------------------------------------------------------------
--  3. Verstuurde post
--
--  Alleen de serverfunctie schrijft hierin. Er staan geen policies voor
--  schrijven; de functie werkt met de servicesleutel en komt daar langs.
-- ---------------------------------------------------------------------------

create table if not exists public.email_log (
  id          text primary key,
  template    text not null default '',
  to_email    text not null default '',
  to_user_id  text,
  subject     text not null default '',
  status      text not null default 'verstuurd'
              check (status in ('verstuurd','mislukt')),
  provider_id text,
  error       text,
  at          bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

create index if not exists email_at_idx      on public.email_log (at);
create index if not exists email_updated_idx on public.email_log (updated_at);

-- ---------------------------------------------------------------------------
--  Tijdstempels
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['signups','channels','chat_messages','channel_reads','email_log'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Groepsberichten mogen ook naar de technische dienst en de ontwikkelaar
--
--  Die twee rollen kwamen er later bij; de oude controle kende ze nog niet
--  en weigerde zo'n bericht.
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_to_role_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_to_role_allowed'
  ) then
    alter table public.notifications
      add constraint notifications_to_role_allowed
      check (to_role is null or to_role in
        ('employee','supervisor','technician','customer','management','developer'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  Nieuw account: koppelen, of een aanmelding neerleggen
--
--  Wat er NIET meer gebeurt: rollen overnemen uit de gegevens die de client
--  meestuurt. Die zijn niet te vertrouwen.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing_id text;
  nieuw_id    text;
  aanmelding  text;
  volle_naam  text;
  soort       text;
begin
  volle_naam := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(new.email, '@', 1));

  -- 1. Staat er al een dossier klaar op dit e-mailadres? Dan koppelen we dat.
  --    Het management heeft die persoon dus zelf toegevoegd; de rollen die
  --    daar staan gelden, en hij kan meteen aan de slag.
  select id into existing_id
    from public.profiles
   where lower(email) = lower(new.email)
     and auth_id is null
   limit 1;

  if existing_id is not null then
    update public.profiles set auth_id = new.id where id = existing_id;
    return new;
  end if;

  -- 2. Anders is dit een aanmelding. Het dossier komt er wel, maar zonder
  --    rollen en op inactief: een account is nog geen toegang.
  nieuw_id := 'u_' || replace(new.id::text, '-', '');

  insert into public.profiles (id, auth_id, email, name, roles, active, phone, location_id)
  values (
    nieuw_id,
    new.id,
    new.email,
    volle_naam,
    array[]::text[],
    false,
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'location_id', '')), '')
  )
  on conflict (id) do nothing;

  soort := coalesce(new.raw_user_meta_data->>'signup_kind', 'werknemer');
  if soort not in ('werknemer', 'klant') then
    soort := 'werknemer';
  end if;

  aanmelding := 'sg_' || replace(new.id::text, '-', '');

  insert into public.signups (
    id, name, email, phone, kind, company_name, location_id, message,
    status, created_at, auth_id, profile_id)
  values (
    aanmelding,
    volle_naam,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    soort,
    nullif(trim(coalesce(new.raw_user_meta_data->>'company_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'location_id', '')), ''),
    left(coalesce(new.raw_user_meta_data->>'message', ''), 600),
    'nieuw',
    public.now_ms(),
    new.id,
    nieuw_id
  )
  on conflict (id) do nothing;

  -- 3. Het management een seintje geven, zodat de aanmelding niet weken
  --    blijft liggen omdat niemand toevallig op dat tabblad keek.
  insert into public.notifications (
    id, to_role, kind, title, body, from_user_id, from_name, created_at, link)
  values (
    'nt_' || aanmelding,
    'management',
    'taak',
    'Nieuwe aanmelding: ' || volle_naam,
    volle_naam || ' meldt zich aan als ' || soort || ' (' || new.email || ').',
    -- Bewust zonder afzender: dit bericht komt van het systeem, niet van de
    -- aanmelder. Stond zijn eigen id hier, dan zou hij zijn eigen aanmelding
    -- in zijn berichten terugzien -- de regels laten je zien wat je zelf
    -- verstuurt.
    null,
    'Aanmelding',
    public.now_ms(),
    'aanmeldingen'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- De trigger zelf staat al in 0001; voor de zekerheid opnieuw zetten.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
--  Mag ik in dit kanaal meelezen?
--
--  Dezelfde regel als in de app, maar hier telt hij echt: dit is wat de
--  database toestaat, ongeacht welk scherm iemand openheeft.
-- ---------------------------------------------------------------------------

create or replace function public.can_see_channel(channel text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.channels c
      join public.profiles p on p.auth_id = auth.uid()
     where c.id = channel
       and p.active
       and (
         -- lid van het kanaal
         p.id = any(c.member_ids)
         -- of het is open, en geen vestigingskanaal van een andere vestiging
         or (
           c.private = false
           and (
             c.kind <> 'vestiging'
             or p.all_locations
             or 'management' = any(coalesce(p.roles, array[]::text[]))
             or c.location_id = p.location_id
             or c.location_id = any(coalesce(p.manages, array[]::text[]))
           )
         )
       )
  );
$$;

grant execute on function public.can_see_channel(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.signups       enable row level security;
alter table public.channels      enable row level security;
alter table public.chat_messages enable row level security;
alter table public.channel_reads enable row level security;
alter table public.email_log     enable row level security;

-- --- Aanmeldingen ---------------------------------------------------------

-- Je eigen aanmelding zie je, zodat de app kan zeggen hoe het ervoor staat.
-- Verder is dit iets van het management.
drop policy if exists signups_select on public.signups;
create policy signups_select on public.signups for select to authenticated
  using (auth_id = auth.uid() or public.is_management());

drop policy if exists signups_update on public.signups;
create policy signups_update on public.signups for update to authenticated
  using (public.is_management()) with check (public.is_management());

drop policy if exists signups_insert on public.signups;
create policy signups_insert on public.signups for insert to authenticated
  with check (public.is_management());

drop policy if exists signups_delete on public.signups;
create policy signups_delete on public.signups for delete to authenticated
  using (public.is_management());

-- --- Kanalen --------------------------------------------------------------

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated
  using (public.is_staff() and public.can_see_channel(id));

-- Een kanaal beginnen mag een leidinggevende of het management. Een
-- rechtstreeks gesprek mag iedereen, mits hij er zelf in zit.
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (
    public.is_staff()
    and (
      public.is_management()
      or public.is_supervisor()
      or (kind = 'gesprek' and public.my_id() = any(member_ids))
    )
  );

drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update to authenticated
  using (
    public.is_management()
    or public.is_supervisor()
    or (kind = 'gesprek' and public.my_id() = any(member_ids))
  )
  with check (
    public.is_management()
    or public.is_supervisor()
    or (kind = 'gesprek' and public.my_id() = any(member_ids))
  );

drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated
  using (public.is_management());

-- --- Berichten ------------------------------------------------------------

drop policy if exists chat_select on public.chat_messages;
create policy chat_select on public.chat_messages for select to authenticated
  using (public.is_staff() and public.can_see_channel(channel_id));

-- Je plaatst alleen berichten op je eigen naam, in een kanaal waar je bij mag.
drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (
    public.is_staff()
    and author_id = public.my_id()
    and public.can_see_channel(channel_id)
  );

-- Wijzigen doe je bij je eigen bericht. Het management mag ook weghalen wat
-- niet door de beugel kan.
drop policy if exists chat_update on public.chat_messages;
create policy chat_update on public.chat_messages for update to authenticated
  using (author_id = public.my_id() or public.is_management())
  with check (author_id = public.my_id() or public.is_management());

drop policy if exists chat_delete on public.chat_messages;
create policy chat_delete on public.chat_messages for delete to authenticated
  using (public.is_management());

-- --- Leestekens -----------------------------------------------------------

-- Waar jij tot hebt gelezen gaat niemand anders aan.
drop policy if exists reads_all on public.channel_reads;
create policy reads_all on public.channel_reads for all to authenticated
  using (user_id = public.my_id())
  with check (user_id = public.my_id());

-- --- Post -----------------------------------------------------------------

-- Meekijken mag het management en de ontwikkelaar. Schrijven doet alleen de
-- serverfunctie; daarvoor staat hier met opzet geen enkele policy.
drop policy if exists email_select on public.email_log;
create policy email_select on public.email_log for select to authenticated
  using (public.is_management() or public.is_developer());

-- ===========================================================================
--  Losse rechten tellen ook mee in het overleg
--
--  Draai dit ná 0007. Opnieuw draaien mag.
--
--  Aanleiding: de app en de database waren het niet helemaal eens over wie
--  een vestigingskanaal mag lezen.
--
--  De app kijkt naar de effectieve rechten van iemand: wat zijn rollen geven,
--  plus wat er met de hand is toegekend, min wat er is ingetrokken. Iemand die
--  het recht "alle vestigingen" los toegekend krijgt, ziet in de app dus alle
--  kanalen.
--
--  De database keek alleen naar het vinkje all_locations en naar de rol
--  management. Gevolg: zo iemand ziet het kanaal wél staan, typt een bericht,
--  en krijgt bij het versturen te horen dat hij er niet bij mag. Dat is de
--  vervelendste soort fout -- je ziet iets, en pas achteraf blijkt dat het
--  niet mocht.
--
--  Hieronder leest de database dezelfde lijstjes als de app, in dezelfde
--  volgorde: het vinkje wint, daarna je eigen vestiging, daarna waar je
--  leiding geeft, en pas dan het recht "alle vestigingen" -- dat laatste
--  alleen als het niet is ingetrokken. Intrekken wint van toekennen, precies
--  zoals in de app.
-- ===========================================================================

create or replace function public.can_see_channel(channel text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.channels c
      join public.profiles p on p.auth_id = auth.uid()
     where c.id = channel
       and p.active
       and (
         -- Lid van het kanaal: dat is genoeg, ook als het besloten is.
         p.id = any(c.member_ids)

         or (
           c.private = false
           and (
             -- Een gewoon kanaal is voor iedereen die mee mag doen.
             c.kind <> 'vestiging'

             -- Het hoofdkantoor komt overal.
             or p.all_locations

             -- Je eigen vestiging, en die waar je leiding geeft.
             or c.location_id = p.location_id
             or c.location_id = any(coalesce(p.manages, array[]::text[]))

             -- Het recht "alle vestigingen": van de rol management of los
             -- toegekend, maar niet als het is ingetrokken.
             or (
               not ('locations.all' = any(coalesce(p.revokes, array[]::text[])))
               and (
                 'management' = any(coalesce(p.roles, array[]::text[]))
                 or 'locations.all' = any(coalesce(p.grants, array[]::text[]))
               )
             )
           )
         )
       )
  );
$$;

grant execute on function public.can_see_channel(text) to authenticated;

-- ===========================================================================
--  Het personeelsdossier
--
--  Draai dit ná 0008. Opnieuw draaien mag.
--
--  De kern van dit bestand is één scheiding.
--
--  `profiles` mag iedereen lezen die bij Truckwash1 werkt. Dat moet ook: je
--  wilt de naam van je collega kunnen zien, en wie er vandaag staat. Maar
--  daardoor belandt élke kolom van die tabel op het toestel van iedere
--  wasser -- de synchronisatie haalt immers alle rijen op waar je bij mag.
--
--  Een burgerservicenummer, een rekeningnummer of het uurloon van een ander
--  hoort daar niet bij. Die gaan naar een eigen tabel waar alleen het
--  management bij komt, plus de persoon zelf voor zijn eigen regel. Wie er
--  niet bij mag krijgt geen lege velden maar helemaal geen rij.
--
--  Row Level Security werkt per rij, niet per kolom. Een tabel splitsen is
--  daarom niet netjes bedoeld maar noodzakelijk.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Het afgeschermde deel
-- ---------------------------------------------------------------------------

create table if not exists public.personnel_private (
  id                 text primary key,
  user_id            text not null,

  birth_date         bigint,
  birth_place        text,
  nationality        text,

  document_type      text check (document_type in
                       ('paspoort','id-kaart','verblijfsdocument','rijbewijs')),
  document_number    text,
  document_expires   bigint,
  -- Is het nummer met de controlecijfers uit de MRZ nagelopen?
  document_verified  boolean not null default false,

  -- Een werkgever mag het BSN verwerken voor de loonaangifte; daar is het
  -- voor. De app controleert het met de elfproef voordat het hier belandt.
  bsn                text,
  iban               text,
  hourly_rate        numeric,

  emergency_name     text,
  emergency_phone    text,
  emergency_relation text,

  -- Notities van het management. De medewerker ziet deze nooit; daarom
  -- staan ze hier en niet in profiles.notes.
  internal_notes     text,

  updated_at         bigint not null default public.now_ms()
);

create index if not exists prive_user_idx    on public.personnel_private (user_id);
create index if not exists prive_updated_idx on public.personnel_private (updated_at);

-- ---------------------------------------------------------------------------
--  2. Documenten
--
--  Het bestand zelf staat in de opslag. Hier staat alleen wat erover te
--  zeggen valt, inclusief of de medewerker het mag zien.
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id                   text primary key,
  user_id              text not null,
  user_name            text not null default '',
  kind                 text not null default 'overig'
                       check (kind in ('identiteitsbewijs','contract','loonstrook',
                                       'diploma','verklaring','beoordeling','overig')),
  title                text not null,
  description          text,

  storage_path         text not null unique,
  mime                 text not null default '',
  size_bytes           integer not null default 0,
  -- SHA-256 van het bestand zoals het is geüpload
  hash                 text,

  -- Het slot waar dit allemaal om draait
  visible_to_employee  boolean not null default true,
  hidden_reason        text,

  uploaded_by          text,
  uploaded_by_name     text default '',
  uploaded_at          bigint not null default public.now_ms(),
  expires_at           bigint,

  requires_signature   boolean not null default false,
  signed_at            bigint,
  signed_by            text,
  signed_name          text,
  signed_hash          text,
  signature_image      text,
  signed_platform      text,
  declined_at          bigint,
  decline_reason       text,

  updated_at           bigint not null default public.now_ms()
);

create index if not exists doc_user_idx    on public.documents (user_id);
create index if not exists doc_kind_idx    on public.documents (kind);
create index if not exists doc_updated_idx on public.documents (updated_at);

do $$
declare t text;
begin
  foreach t in array array['personnel_private','documents'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  3. Het uurloon verhuist mee
--
--  Het stond in profiles en was daarmee zichtbaar voor iedere collega. We
--  nemen de bestaande waarden over en laten de oude kolom leeg achter: hem
--  weggooien zou een oudere versie van de app breken die nog draait.
-- ---------------------------------------------------------------------------

insert into public.personnel_private (id, user_id, hourly_rate)
select p.id, p.id, p.hourly_rate
  from public.profiles p
 where p.hourly_rate is not null
   and p.hourly_rate <> 0
   and not exists (select 1 from public.personnel_private pp where pp.id = p.id)
on conflict (id) do nothing;

update public.personnel_private pp
   set hourly_rate = p.hourly_rate
  from public.profiles p
 where pp.id = p.id
   and pp.hourly_rate is null
   and p.hourly_rate is not null;

update public.profiles set hourly_rate = null where hourly_rate is not null;

-- Interne notities gaan dezelfde kant op.
insert into public.personnel_private (id, user_id, internal_notes)
select p.id, p.id, p.notes
  from public.profiles p
 where coalesce(trim(p.notes), '') <> ''
   and not exists (select 1 from public.personnel_private pp where pp.id = p.id)
on conflict (id) do nothing;

update public.personnel_private pp
   set internal_notes = coalesce(pp.internal_notes, p.notes)
  from public.profiles p
 where pp.id = p.id
   and coalesce(trim(p.notes), '') <> '';

update public.profiles set notes = null where coalesce(trim(notes), '') <> '';

-- ---------------------------------------------------------------------------
--  4. Beveiliging op de gegevens
-- ---------------------------------------------------------------------------

alter table public.personnel_private enable row level security;
alter table public.documents         enable row level security;

-- Je eigen regel mag je zien -- je eigen BSN en rekeningnummer ken je al.
-- De rest is van het management. Wijzigen doet alleen het management: een
-- medewerker die zijn eigen uurloon kan aanpassen is geen dossier.
drop policy if exists prive_select on public.personnel_private;
create policy prive_select on public.personnel_private for select to authenticated
  using (user_id = public.my_id() or public.is_management());

drop policy if exists prive_write on public.personnel_private;
create policy prive_write on public.personnel_private for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- Documenten: het management ziet alles. De medewerker ziet zijn eigen
-- stukken, en alleen die niet op ongezien staan.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (
    public.is_management()
    or (user_id = public.my_id() and visible_to_employee)
  );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (public.is_management());

/*
 * Wijzigen mag het management, en de medewerker mag ondertekenen.
 *
 * Die tweede is smal gehouden: het moet zijn eigen document zijn, hij moet
 * het mogen zien, en er mag nog niet getekend zijn. Wát hij dan mag
 * veranderen staat hieronder in een trigger -- een policy kan niet zeggen
 * "alleen deze kolommen".
 */
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (
    public.is_management()
    or (user_id = public.my_id() and visible_to_employee)
  )
  with check (
    public.is_management()
    or (user_id = public.my_id() and visible_to_employee)
  );

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_management());

/*
 * Wat een medewerker aan zijn eigen document mag veranderen: tekenen, of
 * zeggen dat hij niet tekent. Verder niets.
 *
 * Zonder deze trigger zou hij zichzelf op zichtbaar kunnen zetten wat op
 * ongezien staat, of de vingerafdruk kunnen aanpassen waarmee je aantoont
 * dat er niets aan het bestand is veranderd.
 */
create or replace function public.documents_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_management() then
    return new;
  end if;

  -- Alles wat niet met ondertekenen te maken heeft moet gelijk blijven.
  if new.user_id             is distinct from old.user_id
     or new.kind             is distinct from old.kind
     or new.title            is distinct from old.title
     or new.description      is distinct from old.description
     or new.storage_path     is distinct from old.storage_path
     or new.mime             is distinct from old.mime
     or new.size_bytes       is distinct from old.size_bytes
     or new.hash             is distinct from old.hash
     or new.visible_to_employee is distinct from old.visible_to_employee
     or new.hidden_reason    is distinct from old.hidden_reason
     or new.uploaded_by      is distinct from old.uploaded_by
     or new.expires_at       is distinct from old.expires_at
     or new.requires_signature is distinct from old.requires_signature
  then
    raise exception 'Alleen ondertekenen is toegestaan op je eigen document';
  end if;

  -- Eenmaal getekend blijft getekend; terugdraaien doet het management.
  if old.signed_at is not null and new.signed_at is distinct from old.signed_at then
    raise exception 'Dit document is al ondertekend';
  end if;

  -- Tekenen doe je op je eigen naam.
  if new.signed_at is not null and new.signed_by is distinct from public.my_id() then
    raise exception 'Een handtekening staat op je eigen naam';
  end if;

  return new;
end;
$$;

drop trigger if exists documents_bewaak on public.documents;
create trigger documents_bewaak before update on public.documents
  for each row execute function public.documents_bewaak_wijziging();

-- ---------------------------------------------------------------------------
--  5. De opslag
--
--  De bestanden staan in een emmer die van buitenaf dicht zit: er bestaat
--  geen openbaar adres. De app vraagt per keer om een link die na een
--  minuut vervalt.
--
--  De regels hieronder kijken naar de tabel documents. Zo staat de vraag
--  "mag deze persoon hierbij" op één plek, en kan het slot op een document
--  niet omzeild worden door het bestand rechtstreeks op te vragen.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dossiers', 'dossiers', false, 15728640,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dossiers_lezen on storage.objects;
create policy dossiers_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'dossiers'
    and (
      public.is_management()
      or exists (
        select 1 from public.documents d
         where d.storage_path = storage.objects.name
           and d.user_id = public.my_id()
           and d.visible_to_employee
      )
    )
  );

-- Neerzetten doet alleen het management, en alleen in de map van iemand.
drop policy if exists dossiers_schrijven on storage.objects;
create policy dossiers_schrijven on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dossiers'
    and public.is_management()
    and exists (
      select 1 from public.profiles p
       where p.id = split_part(storage.objects.name, '/', 1)
    )
  );

drop policy if exists dossiers_wissen on storage.objects;
create policy dossiers_wissen on storage.objects for delete to authenticated
  using (bucket_id = 'dossiers' and public.is_management());

drop policy if exists dossiers_bijwerken on storage.objects;
create policy dossiers_bijwerken on storage.objects for update to authenticated
  using (bucket_id = 'dossiers' and public.is_management())
  with check (bucket_id = 'dossiers' and public.is_management());

-- ===========================================================================
--  Leestekens mogen niets blokkeren
--
--  Draai dit ná 0009. Opnieuw draaien mag.
--
--  Wat er misging: `channel_reads` bewaart tot waar iemand een kanaal heeft
--  gelezen. Dat is afgeleide informatie -- een tijdstip, meer niet. Er stond
--  een harde verwijzing naar `channels` op, en die blokkeerde de hele
--  wachtrij zodra het leesteken eerder aankwam dan het kanaal, of zodra het
--  kanaal er om wat voor reden dan ook niet was.
--
--  Een leesteken dat naar een verdwenen kanaal wijst is onschadelijk: je ziet
--  het nergens en het weegt niets. Een leesteken dat het doorzetten van een
--  rooster tegenhoudt is dat wél. Daarom gaat de verwijzing eraf.
--
--  De index blijft staan, en verweesde regels ruimen we op.
-- ===========================================================================

alter table public.channel_reads
  drop constraint if exists channel_reads_channel_id_fkey;

-- Wat er inmiddels los rondzweeft mag weg.
delete from public.channel_reads r
 where not exists (select 1 from public.channels c where c.id = r.channel_id);

create index if not exists reads_channel_idx on public.channel_reads (channel_id);

-- ---------------------------------------------------------------------------
--  Opruimen achteraf
--
--  Verdwijnt er later een kanaal, dan gaan de leestekens ervan mee. Dat deed
--  de verwijzing hiervoor ook, maar dan met het nadeel dat hij ook bij het
--  toevoegen meekeek.
-- ---------------------------------------------------------------------------

create or replace function public.ruim_leestekens_op()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.channel_reads where channel_id = old.id;
  return old;
end;
$$;

drop trigger if exists channels_ruim_leestekens on public.channels;
create trigger channels_ruim_leestekens after delete on public.channels
  for each row execute function public.ruim_leestekens_op();

-- ===========================================================================
--  Postbus
--
--  Draai dit ná 0010. Opnieuw draaien mag.
--
--  Post die binnenkomt op het adres van het dashboard, en post die eruit
--  gaat. Het ontvangen loopt via een webhook van Resend naar de
--  serverfunctie `ontvang-mail`; die zet het bericht en de bijlagen weg.
--
--  Waarom: bonnen komen per mail binnen. Doorsturen, printen, inscannen en
--  opnieuw invoeren is drie keer werk voor één bedrag. Een mail met een
--  bijlage levert hier meteen een kostenpost op die alleen nog goedgekeurd
--  hoeft te worden -- met de bijlage eraan vast.
-- ===========================================================================

create table if not exists public.mailbox (
  id              text primary key,
  richting        text not null default 'in' check (richting in ('in','uit')),

  van             text not null default '',
  van_naam        text,
  aan             text not null default '',
  onderwerp       text not null default '',
  -- Platte tekst. De app toont dit nooit als HTML; een mail van buiten is
  -- per definitie niet te vertrouwen.
  tekst           text not null default '',
  had_html        boolean not null default false,

  at              bigint not null default public.now_ms(),
  status          text not null default 'nieuw'
                  check (status in ('nieuw','gelezen','verwerkt','genegeerd')),

  -- [{naam, mime, size, path}]
  attachments     jsonb not null default '[]'::jsonb,
  expense_id      text references public.expenses(id) on delete set null,

  handled_by      text,
  handled_by_name text,
  handled_at      bigint,

  provider_id     text,
  -- Wat er precies binnenkwam, ingekort. Alleen voor de ontwikkelaar: als
  -- een bericht niet goed wordt herkend staat hier waarom.
  raw             text,

  updated_at      bigint not null default public.now_ms()
);

create index if not exists mailbox_status_idx  on public.mailbox (status);
create index if not exists mailbox_at_idx      on public.mailbox (at);
create index if not exists mailbox_updated_idx on public.mailbox (updated_at);
-- Voorkomt dat een webhook die twee keer binnenkomt twee bonnen oplevert.
create unique index if not exists mailbox_provider_idx
  on public.mailbox (provider_id) where provider_id is not null;

drop trigger if exists stamp_mailbox on public.mailbox;
create trigger stamp_mailbox before insert or update on public.mailbox
  for each row execute function public.stamp_updated_at();

-- ---------------------------------------------------------------------------
--  De kostenpost weet waar hij vandaan komt
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists source          text default 'app';
alter table public.expenses add column if not exists mailbox_id      text;
alter table public.expenses add column if not exists attachment_path text;
alter table public.expenses add column if not exists attachment_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_source_check') then
    alter table public.expenses
      add constraint expenses_source_check check (source is null or source in ('app','mail'));
  end if;
end $$;

/*
 * Een bon die per mail binnenkwam is niet door een collega ingediend. Het
 * bestaande beleid eist dat `submitted_by` gelijk is aan de indiener, en dat
 * klopt hier niet -- de serverfunctie zet hem neer namens niemand.
 *
 * Daarom mag het management ook bonnen zien en bijwerken die uit de mail
 * komen, ongeacht wie eronder staat. Zien deden ze dat al; expliciet maken
 * scheelt zoeken als het ooit misgaat.
 */
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (
    public.is_management()
    or submitted_by = public.my_id()
    or (source = 'mail' and public.is_management())
  );

-- ---------------------------------------------------------------------------
--  Beveiliging op de postbus
--
--  Post die binnenkomt op het bedrijfsadres kan over van alles gaan. Lezen
--  is daarom voor het management en de ontwikkelaar, niet voor iedereen die
--  hier werkt.
--
--  Schrijven doet de serverfunctie met de servicesleutel; die komt overal
--  langs. Het management mag de status bijwerken -- gelezen, verwerkt,
--  genegeerd -- en dat is het.
-- ---------------------------------------------------------------------------

alter table public.mailbox enable row level security;

drop policy if exists mailbox_select on public.mailbox;
create policy mailbox_select on public.mailbox for select to authenticated
  using (public.is_management() or public.is_developer());

drop policy if exists mailbox_update on public.mailbox;
create policy mailbox_update on public.mailbox for update to authenticated
  using (public.is_management() or public.is_developer())
  with check (public.is_management() or public.is_developer());

drop policy if exists mailbox_insert on public.mailbox;
create policy mailbox_insert on public.mailbox for insert to authenticated
  with check (public.is_management() or public.is_developer());

drop policy if exists mailbox_delete on public.mailbox;
create policy mailbox_delete on public.mailbox for delete to authenticated
  using (public.is_management());

-- ---------------------------------------------------------------------------
--  De emmer voor bijlagen
--
--  Apart van de dossiers: een bon uit de mail is iets anders dan een
--  paspoort, en de regels eromheen horen dat ook te zijn.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post', 'post', false, 26214400,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic',
        'image/gif','text/plain','text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel','application/xml','text/xml']
)
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists post_lezen on storage.objects;
create policy post_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'post'
    and (public.is_management() or public.is_developer())
  );

drop policy if exists post_wissen on storage.objects;
create policy post_wissen on storage.objects for delete to authenticated
  using (bucket_id = 'post' and public.is_management());

-- ===========================================================================
--  Kassasysteem (truckwashPOS)
--
--  De kassa is een tweede app, maar geen tweede administratie: hij praat met
--  dezelfde database als het dashboard. Daardoor is een medewerker één
--  persoon, met één personeelsnummer, één rooster en één urenstaat -- of hij
--  nu in de wasstraat staat of achter de kassa.
--
--  Wat hier bij komt:
--
--   * pos_registers          welke kassa's er zijn, met printer en pinautomaat
--   * pos_products           wat er te koop is: artikelen, wasbeurten, kaarten
--   * pos_sales              de bonnen -- het verkoopjournaal
--   * pos_sale_lines         de regels op een bon
--   * pos_payments           hoe er betaald is; meerdere per bon mag (gemengd)
--   * pos_cash_sessions      de kassadag: lade open, lade dicht, verschil
--   * pos_cash_moves         inleg, afstorting en correcties op de lade
--   * pos_subscriptions      abonnementen en strippenkaarten
--   * pos_subscription_uses  welke bon welke strip heeft gebruikt
--   * pos_pins               de persoonlijke code waarmee iemand aan de kassa
--                            inklokt en verkoopt
--
--  Twee dingen zijn hier bewust anders dan in de rest van het schema:
--
--  1. Een afgerekende bon staat vast. Een trigger weigert wijzigingen aan de
--     bedragen en weigert verwijderen. Corrigeren doe je met een creditbon die
--     naar de oorspronkelijke verwijst. Dat is niet alleen netjes -- de
--     Belastingdienst wil een administratie die je achteraf niet kunt
--     bijschaven.
--
--  2. Het saldo van een strippenkaart wordt niet als getal opgeslagen maar
--     opgeteld uit pos_subscription_uses. Twee kassa's die tegelijk offline
--     een strip afboeken zouden anders elkaars aftrek overschrijven; regels
--     bij elkaar optellen kan niet fout gaan.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Hulpfunctie: een los toegekend recht
--
--  De rollen zelf staan in de app (permissions.ts); die kan de database niet
--  narekenen. Wat de database wél kan zien is het losse recht dat het
--  management aan iemand heeft toegekend. Dat is genoeg voor de grove
--  afscherming hieronder; de fijne bepaalt de app.
-- ---------------------------------------------------------------------------

create or replace function public.heeft_recht(recht text)
returns boolean language sql stable security definer set search_path = public as $$
  select recht = any(
    coalesce((select grants from public.profiles where auth_id = auth.uid()), array[]::text[])
  );
$$;

create or replace function public.mag_kassa_beheren()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('pos.manage');
$$;

grant execute on function public.heeft_recht(text) to authenticated;
grant execute on function public.mag_kassa_beheren() to authenticated;

-- ---------------------------------------------------------------------------
--  Kassa's
-- ---------------------------------------------------------------------------

create table if not exists public.pos_registers (
  id           text primary key,
  location_id  text references public.locations(id) on delete set null,
  code         text not null default '',   -- kort en uniek: KAS-UTR-1
  name         text not null default '',
  device       text default '',            -- welk apparaat staat hier
  -- Instellingen van de randapparatuur. Als losse kolommen zou dit tien
  -- velden zijn die per printermodel anders heten; als jsonb blijft het
  -- één ding dat de app begrijpt.
  printer      jsonb not null default '{}'::jsonb,
  terminal     jsonb not null default '{}'::jsonb,
  -- Bonnen worden per kassa doorlopend genummerd, op het apparaat zelf, zodat
  -- het ook zonder internet doorloopt. Dit is de hoogste die de server heeft
  -- gezien; daarmee kan een kassa die opnieuw is ingericht verder tellen in
  -- plaats van opnieuw te beginnen.
  last_seq     bigint not null default 0,
  active       boolean not null default true,
  updated_at   bigint not null default public.now_ms()
);

create unique index if not exists pos_registers_code_key on public.pos_registers (code);

-- ---------------------------------------------------------------------------
--  Artikelen
--
--  De kassa rekent met prijzen inclusief btw. Dat is wat op het bord staat en
--  wat de chauffeur betaalt; het bedrag exclusief volgt eruit. Andersom
--  rekenen geeft bonnen die een cent afwijken van het prijskaartje.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_products (
  id                text primary key,
  -- Leeg = op alle vestigingen te koop.
  location_id       text references public.locations(id) on delete set null,
  code              text not null default '',
  barcode           text,
  name              text not null,
  group_name        text not null default 'Overig',
  unit              text not null default 'stuk',
  price_incl        numeric not null default 0,
  vat_pct           numeric not null default 21,
  kind              text not null default 'artikel'
                    check (kind in ('artikel','wasbeurt','strippenkaart','abonnement','overig')),
  -- Bij kind = wasbeurt: welk type uit de wasstraat-app (buitenwas, combi, ...)
  wash_service      text,
  -- Bij kind = strippenkaart: hoeveel wasbeurten de kaart bevat.
  credits           numeric,
  -- Bij kind = abonnement: hoeveel dagen hij geldig is.
  valid_days        integer,
  -- Verkoop boekt hier voorraad af, als het artikel aan de voorraad hangt.
  inventory_item_id text references public.inventory_items(id) on delete set null,
  -- Plaats op het kassascherm. Lage nummers eerst.
  sort              integer not null default 100,
  color             text,
  active            boolean not null default true,
  updated_at        bigint not null default public.now_ms()
);

create index if not exists pos_products_barcode_idx  on public.pos_products (barcode);
create index if not exists pos_products_location_idx on public.pos_products (location_id);

-- ---------------------------------------------------------------------------
--  Bonnen
-- ---------------------------------------------------------------------------

create table if not exists public.pos_sales (
  id                  text primary key,
  register_id         text references public.pos_registers(id) on delete set null,
  register_code       text not null default '',
  location_id         text references public.locations(id) on delete set null,
  -- Bonnummer zoals het op de bon staat: KAS-UTR-1-20260831-0042
  receipt_no          text not null default '',
  seq                 bigint not null default 0,
  status              text not null default 'open'
                      check (status in ('open','geparkeerd','afgerekend','geannuleerd','gecrediteerd')),
  -- Wie verkocht. Dit is het dossier-id uit profiles, niet het inlogaccount:
  -- aan één kassa werken meerdere mensen met hun eigen code.
  operator_id         text references public.profiles(id) on delete set null,
  operator_name       text not null default '',
  customer_company_id text references public.companies(id) on delete set null,
  customer_name       text default '',
  plate               text default '',
  -- De koppeling met de wasstraat: deze bon rekent die wasopdracht af.
  wash_job_id         text references public.wash_jobs(id) on delete set null,
  total_incl          numeric not null default 0,
  total_excl          numeric not null default 0,
  vat_total           numeric not null default 0,
  discount_incl       numeric not null default 0,
  -- Contant wordt op vijf cent afgerond; het verschil hoort op de bon.
  rounding            numeric not null default 0,
  method              text
                      check (method is null or method in ('contant','pin','op-rekening','abonnement','gemengd')),
  -- Bij een creditbon: welke bon wordt hiermee teruggedraaid.
  credit_of           text references public.pos_sales(id) on delete set null,
  cash_session_id     text,
  opened_at           bigint not null default public.now_ms(),
  closed_at           bigint,
  printed             boolean not null default false,
  note                text,
  updated_at          bigint not null default public.now_ms()
);

create unique index if not exists pos_sales_receipt_key
  on public.pos_sales (register_code, receipt_no)
  where receipt_no <> '';

create index if not exists pos_sales_location_idx on public.pos_sales (location_id, closed_at);
create index if not exists pos_sales_session_idx  on public.pos_sales (cash_session_id);
create index if not exists pos_sales_job_idx      on public.pos_sales (wash_job_id);

create table if not exists public.pos_sale_lines (
  id           text primary key,
  sale_id      text not null references public.pos_sales(id) on delete cascade,
  line_no      integer not null default 1,
  product_id   text references public.pos_products(id) on delete set null,
  name         text not null default '',
  kind         text not null default 'artikel',
  qty          numeric not null default 1,
  price_incl   numeric not null default 0,
  vat_pct      numeric not null default 21,
  discount_pct numeric not null default 0,
  total_incl   numeric not null default 0,
  total_excl   numeric not null default 0,
  vat_amount   numeric not null default 0,
  wash_job_id  text references public.wash_jobs(id) on delete set null,
  note         text,
  updated_at   bigint not null default public.now_ms()
);

create index if not exists pos_sale_lines_sale_idx on public.pos_sale_lines (sale_id);

create table if not exists public.pos_payments (
  id              text primary key,
  sale_id         text not null references public.pos_sales(id) on delete cascade,
  method          text not null
                  check (method in ('contant','pin','op-rekening','abonnement')),
  amount          numeric not null default 0,
  -- Contant: wat er in de lade ging en wat eruit terug moest.
  received        numeric,
  change_given    numeric,
  -- Pin: wat de betaalterminal terugmeldde.
  terminal_ref    text,
  terminal_status text,
  card_brand      text,
  -- Abonnement of strippenkaart waarmee betaald is.
  subscription_id text,
  at              bigint not null default public.now_ms(),
  updated_at      bigint not null default public.now_ms()
);

create index if not exists pos_payments_sale_idx on public.pos_payments (sale_id);

-- ---------------------------------------------------------------------------
--  De kassadag
-- ---------------------------------------------------------------------------

create table if not exists public.pos_cash_sessions (
  id             text primary key,
  register_id    text references public.pos_registers(id) on delete set null,
  register_code  text not null default '',
  location_id    text references public.locations(id) on delete set null,
  opened_by      text references public.profiles(id) on delete set null,
  opened_by_name text default '',
  opened_at      bigint not null default public.now_ms(),
  start_float    numeric not null default 0,
  closed_by      text references public.profiles(id) on delete set null,
  closed_by_name text,
  closed_at      bigint,
  -- Wat er geteld is, wat er had moeten zijn, en het verschil. Het verschil
  -- rekenen we uit en slaan we op: bij een controle wil je zien wat er die
  -- dag is vastgesteld, niet wat er nu uit een nieuwe berekening rolt.
  counted        numeric,
  expected       numeric,
  difference     numeric,
  cash_total     numeric not null default 0,
  pin_total      numeric not null default 0,
  invoice_total  numeric not null default 0,
  sales_count    integer not null default 0,
  status         text not null default 'open' check (status in ('open','gesloten')),
  note           text,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists pos_cash_sessions_reg_idx
  on public.pos_cash_sessions (register_id, status);

create table if not exists public.pos_cash_moves (
  id         text primary key,
  session_id text not null references public.pos_cash_sessions(id) on delete cascade,
  kind       text not null check (kind in ('inleg','afstorting','correctie')),
  amount     numeric not null,
  reason     text default '',
  user_id    text references public.profiles(id) on delete set null,
  user_name  text default '',
  at         bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);

create index if not exists pos_cash_moves_session_idx on public.pos_cash_moves (session_id);

-- ---------------------------------------------------------------------------
--  Abonnementen en strippenkaarten
-- ---------------------------------------------------------------------------

create table if not exists public.pos_subscriptions (
  id            text primary key,
  location_id   text references public.locations(id) on delete set null,
  company_id    text references public.companies(id) on delete set null,
  customer_name text default '',
  plate         text default '',
  -- Scanbare code op de kaart. Hiermee vindt de kassa hem terug.
  code          text not null default '',
  kind          text not null default 'strippenkaart'
                check (kind in ('strippenkaart','abonnement')),
  -- Strippenkaart: hoeveel beurten erop zaten toen hij verkocht werd.
  credits_total numeric not null default 0,
  -- Abonnement: van wanneer tot wanneer hij geldig is.
  valid_from    bigint,
  valid_to      bigint,
  -- Waarvoor hij geldt; leeg = elke wasbeurt.
  wash_service  text,
  sold_sale_id  text references public.pos_sales(id) on delete set null,
  active        boolean not null default true,
  note          text,
  updated_at    bigint not null default public.now_ms()
);

create unique index if not exists pos_subscriptions_code_key
  on public.pos_subscriptions (code) where code <> '';

create table if not exists public.pos_subscription_uses (
  id              text primary key,
  subscription_id text not null references public.pos_subscriptions(id) on delete cascade,
  sale_id         text references public.pos_sales(id) on delete set null,
  credits         numeric not null default 1,
  user_id         text references public.profiles(id) on delete set null,
  user_name       text default '',
  at              bigint not null default public.now_ms(),
  updated_at      bigint not null default public.now_ms()
);

create index if not exists pos_subscription_uses_sub_idx
  on public.pos_subscription_uses (subscription_id);

-- ---------------------------------------------------------------------------
--  De persoonlijke code
--
--  Aan één kassa werken meerdere mensen. Het apparaat is ingelogd met een
--  kassa-account; wie er op dat moment achter staat blijkt uit zijn eigen
--  code of zijn badge. Daarmee klokt hij in, en daarmee komt zijn naam op de
--  bon.
--
--  De code zelf staat hier niet: alleen een PBKDF2-afgeleide met een eigen
--  zout per persoon. De kassa moet die afgeleide kunnen ophalen, want
--  controleren moet ook zonder internet kunnen -- vandaar dat collega's op
--  dezelfde vestiging hem mogen lezen. Een code van zes cijfers is daarmee
--  geen wachtwoord waarmee je bij gegevens komt; het is een ondertekening,
--  zoals een paraaf op een urenlijst. Bij de gegevens kom je met het
--  kassa-account, en dat wachtwoord staat hier nergens.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_pins (
  id          text primary key,
  user_id     text not null references public.profiles(id) on delete cascade,
  salt        text not null,
  hash        text not null,
  iterations  integer not null default 210000,
  -- Scanbare badge, als alternatief voor het intoetsen van de code.
  badge_token text,
  must_change boolean not null default false,
  set_by      text references public.profiles(id) on delete set null,
  updated_at  bigint not null default public.now_ms()
);

create unique index if not exists pos_pins_user_key on public.pos_pins (user_id);
create unique index if not exists pos_pins_badge_key
  on public.pos_pins (badge_token) where badge_token is not null;

-- ---------------------------------------------------------------------------
--  Tijdstempels
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'pos_registers','pos_products','pos_sales','pos_sale_lines','pos_payments',
    'pos_cash_sessions','pos_cash_moves','pos_subscriptions',
    'pos_subscription_uses','pos_pins'
  ] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Een afgerekende bon staat vast
--
--  Dit is geen extra slot op de deur maar het slot zelf: zonder dit is de
--  kassa-administratie een lijst die je naderhand kunt bijwerken, en daar
--  heeft een boekhouder niets aan.
--
--  Wat nog wel mag na het afrekenen: het vinkje "afgedrukt" zetten, de status
--  op gecrediteerd zetten en een opmerking toevoegen. Wat niet meer mag:
--  bedragen, betaalwijze, bonnummer, tijdstip en wie het verkocht.
-- ---------------------------------------------------------------------------

create or replace function public.pos_bon_vastzetten()
returns trigger language plpgsql as $$
begin
  if old.status in ('afgerekend','gecrediteerd') then
    if new.total_incl    is distinct from old.total_incl
    or new.total_excl    is distinct from old.total_excl
    or new.vat_total     is distinct from old.vat_total
    or new.discount_incl is distinct from old.discount_incl
    or new.rounding      is distinct from old.rounding
    or new.method        is distinct from old.method
    or new.closed_at     is distinct from old.closed_at
    or new.operator_id   is distinct from old.operator_id
    or new.receipt_no    is distinct from old.receipt_no
    then
      raise exception
        'Bon % is afgerekend en mag niet meer gewijzigd worden. Maak een creditbon.',
        coalesce(nullif(old.receipt_no, ''), old.id);
    end if;

    if new.status not in ('afgerekend','gecrediteerd') then
      raise exception 'Bon % kan niet terug naar %.',
        coalesce(nullif(old.receipt_no, ''), old.id), new.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_sales_vast on public.pos_sales;
create trigger pos_sales_vast before update on public.pos_sales
  for each row execute function public.pos_bon_vastzetten();

create or replace function public.pos_bon_niet_wissen()
returns trigger language plpgsql as $$
begin
  if old.status in ('afgerekend','gecrediteerd') then
    raise exception
      'Bon % is afgerekend en mag niet verwijderd worden. Maak een creditbon.',
      coalesce(nullif(old.receipt_no, ''), old.id);
  end if;
  return old;
end;
$$;

drop trigger if exists pos_sales_niet_wissen on public.pos_sales;
create trigger pos_sales_niet_wissen before delete on public.pos_sales
  for each row execute function public.pos_bon_niet_wissen();

-- Regels en betalingen van een afgerekende bon liggen even vast als de bon.
--
-- Toevoegen blijft wel mogelijk: bij het afrekenen komen de bon en zijn
-- regels in dezelfde synchronisatieronde binnen, en de bon gaat voorop. De
-- regels zouden dan tegen een al afgerekende bon aanlopen.
create or replace function public.pos_regel_vastzetten()
returns trigger language plpgsql as $$
declare
  bon_id     text := coalesce(new.sale_id, old.sale_id);
  bon_status text;
begin
  select status into bon_status from public.pos_sales where id = bon_id;
  if bon_status in ('afgerekend','gecrediteerd') and tg_op <> 'INSERT' then
    raise exception 'De bon is afgerekend; regels en betalingen liggen vast.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists pos_sale_lines_vast on public.pos_sale_lines;
create trigger pos_sale_lines_vast before update or delete on public.pos_sale_lines
  for each row execute function public.pos_regel_vastzetten();

drop trigger if exists pos_payments_vast on public.pos_payments;
create trigger pos_payments_vast before update or delete on public.pos_payments
  for each row execute function public.pos_regel_vastzetten();

-- ---------------------------------------------------------------------------
--  Beveiliging op rijniveau
--
--  Grofweg: wie op een vestiging werkt, mag de kassa van die vestiging zien
--  en gebruiken. Prijzen, kaarten en codes zijn voor de leiding. De fijne
--  verdeling (mag deze persoon korting geven? een bon crediteren?) doet de
--  app met de rechten uit permissions.ts -- die kan de database niet
--  narekenen, want daar zitten de rollen in.
-- ---------------------------------------------------------------------------

alter table public.pos_registers         enable row level security;
alter table public.pos_products          enable row level security;
alter table public.pos_sales             enable row level security;
alter table public.pos_sale_lines        enable row level security;
alter table public.pos_payments          enable row level security;
alter table public.pos_cash_sessions     enable row level security;
alter table public.pos_cash_moves        enable row level security;
alter table public.pos_subscriptions     enable row level security;
alter table public.pos_subscription_uses enable row level security;
alter table public.pos_pins              enable row level security;

-- ------------------------------ kassa's -----------------------------------

drop policy if exists pos_registers_select on public.pos_registers;
create policy pos_registers_select on public.pos_registers for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_registers_write on public.pos_registers;
create policy pos_registers_write on public.pos_registers for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

-- ----------------------------- artikelen ----------------------------------

drop policy if exists pos_products_select on public.pos_products;
create policy pos_products_select on public.pos_products for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_products_write on public.pos_products;
create policy pos_products_write on public.pos_products for all to authenticated
  using (public.mag_kassa_beheren())
  with check (public.mag_kassa_beheren());

-- ------------------------------- bonnen -----------------------------------

-- Een klant mag zijn eigen bonnen zien; die komen straks op zijn factuur.
drop policy if exists pos_sales_select on public.pos_sales;
create policy pos_sales_select on public.pos_sales for select to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or customer_company_id = public.my_company()
  );

drop policy if exists pos_sales_insert on public.pos_sales;
create policy pos_sales_insert on public.pos_sales for insert to authenticated
  with check (public.is_staff() and public.in_my_locations(location_id));

-- Wijzigen mag; de trigger hierboven bepaalt wat er nog te wijzigen valt.
drop policy if exists pos_sales_update on public.pos_sales;
create policy pos_sales_update on public.pos_sales for update to authenticated
  using (public.is_staff() and public.in_my_locations(location_id))
  with check (public.is_staff() and public.in_my_locations(location_id));

-- Alleen een bon die nooit is afgerekend kan weg -- een geparkeerde bon die
-- niemand meer nodig heeft. De trigger houdt de rest tegen.
drop policy if exists pos_sales_delete on public.pos_sales;
create policy pos_sales_delete on public.pos_sales for delete to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

-- Regels en betalingen volgen hun bon.
drop policy if exists pos_sale_lines_all on public.pos_sale_lines;
create policy pos_sale_lines_all on public.pos_sale_lines for all to authenticated
  using (exists (
    select 1 from public.pos_sales s
     where s.id = pos_sale_lines.sale_id
       and ((public.is_staff() and public.in_my_locations(s.location_id))
            or s.customer_company_id = public.my_company())))
  with check (exists (
    select 1 from public.pos_sales s
     where s.id = pos_sale_lines.sale_id
       and public.is_staff() and public.in_my_locations(s.location_id)));

drop policy if exists pos_payments_all on public.pos_payments;
create policy pos_payments_all on public.pos_payments for all to authenticated
  using (exists (
    select 1 from public.pos_sales s
     where s.id = pos_payments.sale_id
       and ((public.is_staff() and public.in_my_locations(s.location_id))
            or s.customer_company_id = public.my_company())))
  with check (exists (
    select 1 from public.pos_sales s
     where s.id = pos_payments.sale_id
       and public.is_staff() and public.in_my_locations(s.location_id)));

-- ----------------------------- kassadag -----------------------------------

drop policy if exists pos_cash_sessions_select on public.pos_cash_sessions;
create policy pos_cash_sessions_select on public.pos_cash_sessions for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_cash_sessions_write on public.pos_cash_sessions;
create policy pos_cash_sessions_write on public.pos_cash_sessions for all to authenticated
  using (public.is_staff() and public.in_my_locations(location_id))
  with check (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_cash_moves_all on public.pos_cash_moves;
create policy pos_cash_moves_all on public.pos_cash_moves for all to authenticated
  using (exists (
    select 1 from public.pos_cash_sessions cs
     where cs.id = pos_cash_moves.session_id
       and public.is_staff() and public.in_my_locations(cs.location_id)))
  with check (exists (
    select 1 from public.pos_cash_sessions cs
     where cs.id = pos_cash_moves.session_id
       and public.is_staff() and public.in_my_locations(cs.location_id)));

-- -------------------------- kaarten en abonnementen -----------------------

drop policy if exists pos_subscriptions_select on public.pos_subscriptions;
create policy pos_subscriptions_select on public.pos_subscriptions for select to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or company_id = public.my_company()
  );

-- Een kaart verkopen is gewoon verkopen; dat mag iedereen aan de kassa.
-- Achteraf de inhoud van een kaart aanpassen is dat niet.
drop policy if exists pos_subscriptions_insert on public.pos_subscriptions;
create policy pos_subscriptions_insert on public.pos_subscriptions for insert to authenticated
  with check (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_subscriptions_update on public.pos_subscriptions;
create policy pos_subscriptions_update on public.pos_subscriptions for update to authenticated
  using (public.is_lead() or public.mag_kassa_beheren())
  with check (public.is_lead() or public.mag_kassa_beheren());

-- Afboeken is optellen: regels erbij, nooit een saldo overschrijven.
drop policy if exists pos_subscription_uses_select on public.pos_subscription_uses;
create policy pos_subscription_uses_select on public.pos_subscription_uses
  for select to authenticated
  using (exists (
    select 1 from public.pos_subscriptions s
     where s.id = pos_subscription_uses.subscription_id
       and ((public.is_staff() and public.in_my_locations(s.location_id))
            or s.company_id = public.my_company())));

drop policy if exists pos_subscription_uses_insert on public.pos_subscription_uses;
create policy pos_subscription_uses_insert on public.pos_subscription_uses
  for insert to authenticated
  with check (public.is_staff());

-- Opnieuw versturen van dezelfde afboeking mag -- dat gebeurt als de eerste
-- poging strandde op een wegvallende verbinding. Die van een ander niet.
drop policy if exists pos_subscription_uses_update on public.pos_subscription_uses;
create policy pos_subscription_uses_update on public.pos_subscription_uses
  for update to authenticated
  using (user_id = public.my_id() or public.is_lead())
  with check (user_id = public.my_id() or public.is_lead());

-- ------------------------------- codes ------------------------------------

-- Collega's op dezelfde vestiging mogen de afgeleide ophalen, anders kan de
-- kassa offline niemand herkennen. Zie de toelichting bij de tabel.
drop policy if exists pos_pins_select on public.pos_pins;
create policy pos_pins_select on public.pos_pins for select to authenticated
  using (
    public.is_staff()
    and exists (
      select 1 from public.profiles p
       where p.id = pos_pins.user_id
         and public.in_my_locations(p.location_id)
    )
  );

-- Je eigen code veranderen mag altijd. Die van een ander alleen als je het
-- personeel of de kassa beheert -- en dan zet je een nieuwe, je leest de
-- oude niet.
drop policy if exists pos_pins_write on public.pos_pins;
create policy pos_pins_write on public.pos_pins for all to authenticated
  using (user_id = public.my_id() or public.is_management() or public.mag_kassa_beheren())
  with check (user_id = public.my_id() or public.is_management() or public.mag_kassa_beheren());

-- ===========================================================================
--  Een bericht aan één persoon mag van iedereen komen
--
--  Draai dit ná 0012. Opnieuw draaien mag.
--
--  De regel op `notifications` stamt uit de tijd dat berichten één ding
--  deden: een leidinggevende die zijn team iets liet weten. Vandaar:
--
--      with check (public.is_lead() and from_user_id = public.my_id())
--
--  Sindsdien is de belletjeslade het algemene seinsysteem van de app
--  geworden, en daarmee klopte die regel niet meer. Alles hieronder werd
--  geweigerd:
--
--    * een wasser die een collega noemt in het overleg
--    * een melding aan de ontwikkelaar -- die stuurt bericht naar de dev
--    * een storing melden vanaf de vloer
--    * een medewerker die zijn contract ondertekent, of juist niet
--
--  De fout die je zag -- "new row violates row-level security policy for
--  table notifications" -- kwam daar vandaan, en hij blokkeerde de hele
--  wachtrij omdat het bericht bij de handeling hoort.
--
--  Nieuwe regel, in twee helften:
--
--    naar één persoon   -> iedereen die hier werkt, op eigen naam
--    naar een hele rol  -> alleen een leidinggevende of het management
--
--  Dat tweede blijft eng genoeg: een groepsbericht bereikt iedereen tegelijk
--  en hoort niet bij iemand te kunnen die alleen zijn collega wil bereiken.
-- ===========================================================================

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (
    public.is_staff()
    and from_user_id = public.my_id()
    and (
      to_user_id is not null
      or public.is_lead()
    )
  );

-- ===========================================================================
--  Wijzigingen in een dossier
--
--  Draai dit ná 0013. Opnieuw draaien mag.
--
--  Een leidinggevende staat het dichtst bij zijn mensen en merkt als eerste
--  dat iemand meer uren gaat draaien of van functie verandert. Maar hij hoort
--  niet zelf in het dossier te schrijven: een uurloon dat verandert zonder
--  dat iemand het heeft goedgekeurd is geen administratie.
--
--  Dus stelt hij het voor, en het management drukt op akkoord. Pas dán
--  verandert het dossier -- en dat gebeurt hier, in de database, niet in het
--  scherm. Een verzoek goedkeuren en de wijziging doorvoeren zijn één
--  handeling; anders bestaat de mogelijkheid dat het eerste lukt en het
--  tweede niet.
-- ===========================================================================

create table if not exists public.change_requests (
  id                     text primary key,
  user_id                text not null,
  user_name              text not null default '',

  -- [{veld, oud, nieuw}]
  velden                 jsonb not null default '[]'::jsonb,
  reden                  text not null default '',
  ingaand_op             bigint,

  status                 text not null default 'open'
                         check (status in ('open','goedgekeurd','afgewezen','ingetrokken')),

  aangevraagd_door       text,
  aangevraagd_door_naam  text default '',
  aangevraagd_op         bigint not null default public.now_ms(),

  beslist_door           text,
  beslist_door_naam      text,
  beslist_op             bigint,
  afwijzing_reden        text,

  updated_at             bigint not null default public.now_ms()
);

create index if not exists cr_user_idx    on public.change_requests (user_id);
create index if not exists cr_status_idx  on public.change_requests (status);
create index if not exists cr_updated_idx on public.change_requests (updated_at);

drop trigger if exists stamp_change_requests on public.change_requests;
create trigger stamp_change_requests before insert or update on public.change_requests
  for each row execute function public.stamp_updated_at();

-- ---------------------------------------------------------------------------
--  Beveiliging
--
--  Zien: het management, de aanvrager, en degene over wie het gaat. Dat
--  laatste is een keuze: een voorstel om jouw uren te wijzigen mag je weten.
--  Zolang het nog niet is goedgekeurd staat er "voorgesteld" bij.
-- ---------------------------------------------------------------------------

alter table public.change_requests enable row level security;

drop policy if exists cr_select on public.change_requests;
create policy cr_select on public.change_requests for select to authenticated
  using (
    public.is_management()
    or aangevraagd_door = public.my_id()
    or user_id = public.my_id()
  );

-- Aanvragen doet een leidinggevende of het management.
drop policy if exists cr_insert on public.change_requests;
create policy cr_insert on public.change_requests for insert to authenticated
  with check (
    public.is_lead()
    and aangevraagd_door = public.my_id()
    and status = 'open'
  );

/*
 * Bijwerken: het management beslist, de aanvrager mag zijn eigen verzoek
 * intrekken zolang er nog niets over is gezegd. Wat precies mag staat in de
 * trigger hieronder -- een policy kan niet zeggen "alleen deze overgang".
 */
drop policy if exists cr_update on public.change_requests;
create policy cr_update on public.change_requests for update to authenticated
  using (public.is_management() or aangevraagd_door = public.my_id())
  with check (public.is_management() or aangevraagd_door = public.my_id());

drop policy if exists cr_delete on public.change_requests;
create policy cr_delete on public.change_requests for delete to authenticated
  using (public.is_management());

create or replace function public.cr_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_management() then
    -- Een beslissing staat vast. Terugdraaien doe je met een nieuw verzoek,
    -- niet door de geschiedenis aan te passen.
    if old.status in ('goedgekeurd', 'afgewezen')
       and new.status is distinct from old.status then
      raise exception 'Over dit verzoek is al beslist';
    end if;
    return new;
  end if;

  -- De aanvrager mag precies één ding: intrekken zolang het openstaat.
  if old.status <> 'open' then
    raise exception 'Dit verzoek is niet meer open';
  end if;
  if new.status <> 'ingetrokken' then
    raise exception 'Je kunt je eigen verzoek alleen intrekken';
  end if;
  if new.velden is distinct from old.velden
     or new.user_id is distinct from old.user_id
     or new.reden is distinct from old.reden then
    raise exception 'De inhoud van een verzoek ligt vast';
  end if;

  return new;
end;
$$;

drop trigger if exists cr_bewaak on public.change_requests;
create trigger cr_bewaak before update on public.change_requests
  for each row execute function public.cr_bewaak_wijziging();

-- ---------------------------------------------------------------------------
--  Goedkeuren voert de wijziging meteen door
--
--  Eén handeling, in de database. Zou het scherm eerst goedkeuren en daarna
--  het dossier bijwerken, dan bestaat de kans dat het eerste lukt en het
--  tweede niet -- en dan staat er een goedgekeurd verzoek waar niets mee is
--  gebeurd.
--
--  De velden die naar `profiles` gaan en die naar `personnel_private` worden
--  hier uit elkaar gehaald; de app hoeft dat onderscheid niet te kennen.
-- ---------------------------------------------------------------------------

create or replace function public.cr_voer_door()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  veld   jsonb;
  naam   text;
  nieuw  jsonb;
begin
  if new.status <> 'goedgekeurd' or old.status = 'goedgekeurd' then
    return new;
  end if;

  for veld in select * from jsonb_array_elements(new.velden)
  loop
    naam  := veld->>'veld';
    nieuw := veld->'nieuw';

    if naam = 'function' then
      update public.profiles set job_title = nullif(nieuw #>> '{}', '') where id = new.user_id;

    elsif naam = 'contractHours' then
      update public.profiles set contract_hours = nullif(nieuw #>> '{}', '')::numeric
       where id = new.user_id;

    elsif naam = 'locationId' then
      update public.profiles set location_id = nullif(nieuw #>> '{}', '') where id = new.user_id;

    elsif naam = 'supervisorId' then
      update public.profiles set supervisor_id = nullif(nieuw #>> '{}', '') where id = new.user_id;

    elsif naam = 'startDate' then
      update public.profiles set start_date = nullif(nieuw #>> '{}', '')::bigint
       where id = new.user_id;

    elsif naam = 'endDate' then
      update public.profiles set end_date = nullif(nieuw #>> '{}', '')::bigint
       where id = new.user_id;

    elsif naam = 'manages' then
      update public.profiles
         set manages = coalesce(
               (select array_agg(value #>> '{}') from jsonb_array_elements(nieuw)),
               array[]::text[])
       where id = new.user_id;

    elsif naam = 'roles' then
      update public.profiles
         set roles = coalesce(
               (select array_agg(value #>> '{}') from jsonb_array_elements(nieuw)),
               array[]::text[])
       where id = new.user_id;

    elsif naam = 'hourlyRate' then
      -- Het uurloon staat in het afgeschermde deel. Bestaat die regel nog
      -- niet, dan maken we hem hier aan.
      insert into public.personnel_private (id, user_id, hourly_rate)
      values (new.user_id, new.user_id, nullif(nieuw #>> '{}', '')::numeric)
      on conflict (id) do update set hourly_rate = excluded.hourly_rate;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists cr_doorvoeren on public.change_requests;
create trigger cr_doorvoeren after update on public.change_requests
  for each row execute function public.cr_voer_door();

-- ===========================================================================
--  Agenda
--
--  Draai dit ná 0014. Opnieuw draaien mag.
--
--  Alleen de afspraken die iemand er zelf in zet staan hier. Verjaardagen,
--  jubilea, aflopende contracten en onderhoudsbeurten staan er níét in:
--  die volgen uit gegevens die er al zijn en worden bij het tonen berekend.
--
--  Zou je ze wel opslaan, dan heb je twee waarheden over dezelfde datum. Een
--  geboortedatum die wordt gecorrigeerd geeft dan nog jaren de oude
--  verjaardag, tot iemand toevallig de oude regel opruimt.
-- ===========================================================================

create table if not exists public.agenda_items (
  id              text primary key,
  title           text not null,
  description     text,
  soort           text not null default 'afspraak'
                  check (soort in ('afspraak','verlof','opleiding','onderhoud','overig')),
  start_at        bigint not null,
  end_at          bigint not null,
  hele_dag        boolean not null default false,
  location_id     text references public.locations(id) on delete set null,
  -- Wie erbij moeten zijn
  deelnemers      text[] not null default '{}',
  created_by      text,
  created_by_name text default '',
  created_at      bigint not null default public.now_ms(),
  updated_at      bigint not null default public.now_ms()
);

create index if not exists agenda_start_idx   on public.agenda_items (start_at);
create index if not exists agenda_loc_idx     on public.agenda_items (location_id);
create index if not exists agenda_updated_idx on public.agenda_items (updated_at);

drop trigger if exists stamp_agenda_items on public.agenda_items;
create trigger stamp_agenda_items before insert or update on public.agenda_items
  for each row execute function public.stamp_updated_at();

-- ---------------------------------------------------------------------------
--  Beveiliging
--
--  Zien mag iedereen die hier werkt: een agenda waarin je de helft niet ziet
--  is geen agenda. Wat er per vestiging getoond wordt regelt het scherm.
--
--  Wijzigen doet een leidinggevende, de technische dienst of het management.
--  Wie iets heeft aangemaakt mag het ook zelf weer weghalen.
-- ---------------------------------------------------------------------------

alter table public.agenda_items enable row level security;

drop policy if exists agenda_select on public.agenda_items;
create policy agenda_select on public.agenda_items for select to authenticated
  using (public.is_staff());

drop policy if exists agenda_insert on public.agenda_items;
create policy agenda_insert on public.agenda_items for insert to authenticated
  with check (public.is_staff() and created_by = public.my_id());

drop policy if exists agenda_update on public.agenda_items;
create policy agenda_update on public.agenda_items for update to authenticated
  using (public.is_management() or public.is_supervisor() or created_by = public.my_id())
  with check (public.is_management() or public.is_supervisor() or created_by = public.my_id());

drop policy if exists agenda_delete on public.agenda_items;
create policy agenda_delete on public.agenda_items for delete to authenticated
  using (public.is_management() or public.is_supervisor() or created_by = public.my_id());

-- ===========================================================================
--  Werkgevers
--
--  Draai dit ná 0015. Opnieuw draaien mag.
--
--  Een transportbedrijf waarvan de chauffeurs hier komen wassen. De
--  werkgever betaalt, ziet wat zijn mensen laten doen, en legt vast wat er
--  per wagen wél en niet afgenomen mag worden.
--
--  Drie dingen die hier zorgvuldig moeten:
--
--   1. Een werkgever mag precies zijn eigen bedrijf zien en niets van
--      Truckwash1 zelf. Geen rooster, geen voorraad, geen collega's.
--
--   2. Een chauffeur ziet de wasbeurten van de werkgever waar hij áán
--      gekoppeld is. Wordt die koppeling beëindigd, dan verdwijnen ze uit
--      zijn beeld -- ook de beurten die hij zelf heeft gebracht. Dat is de
--      hele reden dat er een koppeltabel is en geen kolom op het profiel.
--
--   3. Een werkgever mag nooit in het personeelsdossier van Truckwash1.
--      Zijn chauffeurs zijn zijn mensen, maar de gegevens die hier van hen
--      liggen zijn dat niet.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De werkgever
-- ---------------------------------------------------------------------------

create table if not exists public.employers (
  id                    text primary key,
  naam                  text not null,
  kvk                   text,
  contact_naam          text not null default '',
  email                 text not null default '',
  telefoon              text,
  adres                 text,
  postcode              text,
  plaats                text,

  company_id            text references public.companies(id) on delete set null,
  status                text not null default 'aangevraagd'
                        check (status in ('aangevraagd','actief','geblokkeerd','afgewezen')),

  -- Wie dit bedrijf beheert in de app
  beheerders            text[] not null default '{}',

  aangevraagd_door      text,
  aangevraagd_door_naam text,
  aangevraagd_op        bigint not null default public.now_ms(),
  beslist_door          text,
  beslist_door_naam     text,
  beslist_op            bigint,
  afwijzing_reden       text,

  notitie               text,
  updated_at            bigint not null default public.now_ms()
);

create index if not exists wg_status_idx  on public.employers (status);
create index if not exists wg_updated_idx on public.employers (updated_at);

-- ---------------------------------------------------------------------------
--  2. De koppeling met een chauffeur
-- ---------------------------------------------------------------------------

create table if not exists public.employer_links (
  id                     text primary key,
  werkgever_id           text not null references public.employers(id) on delete cascade,
  werkgever_naam         text not null default '',

  user_id                text,
  naam                   text not null default '',
  email                  text not null default '',
  -- Kentekens die deze chauffeur mag brengen; leeg is alles van de werkgever
  kentekens              text[] not null default '{}',

  status                 text not null default 'uitgenodigd'
                         check (status in ('uitgenodigd','wacht op akkoord','actief','beëindigd','geweigerd')),

  uitgenodigd_op         bigint not null default public.now_ms(),
  uitgenodigd_door       text,
  uitgenodigd_door_naam  text default '',
  -- Er bestond al een account op dit adres; dan is er gevraagd of het
  -- gekoppeld mag worden in plaats van er een aangemaakt.
  bestaand_account       boolean not null default false,

  gekoppeld_op           bigint,
  beeindigd_op           bigint,
  beeindigd_door         text,
  beeindigd_door_naam    text,
  beeindigd_reden        text,

  updated_at             bigint not null default public.now_ms()
);

create index if not exists wgk_werkgever_idx on public.employer_links (werkgever_id);
create index if not exists wgk_user_idx      on public.employer_links (user_id);
create index if not exists wgk_status_idx    on public.employer_links (status);
create index if not exists wgk_updated_idx   on public.employer_links (updated_at);

-- Eén actieve koppeling per persoon per werkgever.
create unique index if not exists wgk_uniek
  on public.employer_links (werkgever_id, lower(email))
  where status in ('uitgenodigd', 'wacht op akkoord', 'actief');

-- ---------------------------------------------------------------------------
--  3. Afspraken over wat er afgenomen mag worden
-- ---------------------------------------------------------------------------

create table if not exists public.employer_rules (
  id              text primary key,
  werkgever_id    text not null references public.employers(id) on delete cascade,
  -- Leeg betekent: geldt voor alle wagens van deze werkgever
  kenteken        text,
  service         text,
  product_code    text,
  soort           text not null default 'niet toegestaan'
                  check (soort in ('niet toegestaan','alleen met akkoord')),
  reden           text,
  aangemaakt_door text,
  aangemaakt_op   bigint not null default public.now_ms(),
  updated_at      bigint not null default public.now_ms()
);

create index if not exists wgr_werkgever_idx on public.employer_rules (werkgever_id);
create index if not exists wgr_kenteken_idx  on public.employer_rules (kenteken);
create index if not exists wgr_updated_idx   on public.employer_rules (updated_at);

-- ---------------------------------------------------------------------------
--  4. Een wasbeurt weet van welke werkgever hij is
-- ---------------------------------------------------------------------------

alter table public.wash_jobs
  add column if not exists employer_id text references public.employers(id) on delete set null;

create index if not exists jobs_employer_idx on public.wash_jobs (employer_id);

-- Een account dat is aangemaakt met een tijdelijk wachtwoord.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

do $$
declare t text;
begin
  foreach t in array array['employers','employer_links','employer_rules'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Hulpfuncties
-- ---------------------------------------------------------------------------

create or replace function public.is_employer()
returns boolean language sql stable as $$
  select 'employer' = any(public.my_roles());
$$;

grant execute on function public.is_employer() to authenticated;

/**
 * De werkgevers waar ik iets mee te maken heb.
 *
 * Als beheerder: de bedrijven die ik beheer. Als chauffeur: de bedrijven
 * waar ik op dit moment aan gekoppeld ben -- alleen 'actief' telt, want een
 * beëindigde koppeling hoort niets meer te laten zien.
 */
create or replace function public.mijn_werkgevers()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), array[]::text[]) from (
    select e.id
      from public.employers e
     where public.my_id() = any(e.beheerders)
    union
    select l.werkgever_id
      from public.employer_links l
     where l.user_id = public.my_id()
       and l.status = 'actief'
  ) as x;
$$;

grant execute on function public.mijn_werkgevers() to authenticated;

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.employers      enable row level security;
alter table public.employer_links enable row level security;
alter table public.employer_rules enable row level security;

/* --- de werkgever zelf --- */

-- Truckwash1 ziet alle werkgevers; een werkgever ziet alleen zijn eigen
-- bedrijf, en de aanvrager ziet zijn eigen aanvraag zolang die loopt.
drop policy if exists wg_select on public.employers;
create policy wg_select on public.employers for select to authenticated
  using (
    public.is_staff()
    or id = any(public.mijn_werkgevers())
    or aangevraagd_door = public.my_id()
  );

-- Aanmelden mag iedereen die is ingelogd, op eigen naam en als aanvraag.
-- Aanmaken zonder aanvraag doet het management.
drop policy if exists wg_insert on public.employers;
create policy wg_insert on public.employers for insert to authenticated
  with check (
    public.is_management()
    or (status = 'aangevraagd' and aangevraagd_door = public.my_id())
  );

drop policy if exists wg_update on public.employers;
create policy wg_update on public.employers for update to authenticated
  using (public.is_management() or public.my_id() = any(beheerders))
  with check (public.is_management() or public.my_id() = any(beheerders));

drop policy if exists wg_delete on public.employers;
create policy wg_delete on public.employers for delete to authenticated
  using (public.is_management());

/*
 * Een werkgever mag zijn eigen gegevens bijwerken, maar niet zijn status,
 * niet wie de beheerders zijn en niet aan welk klantaccount hij hangt. Dat
 * zijn beslissingen van Truckwash1.
 */
create or replace function public.wg_bewaak()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_management() then return new; end if;

  if new.status is distinct from old.status
     or new.beheerders is distinct from old.beheerders
     or new.company_id is distinct from old.company_id
  then
    raise exception 'Status, beheerders en de klantkoppeling bepaalt Truckwash1';
  end if;
  return new;
end;
$$;

drop trigger if exists wg_bewaak_trigger on public.employers;
create trigger wg_bewaak_trigger before update on public.employers
  for each row execute function public.wg_bewaak();

/* --- de koppelingen --- */

-- Truckwash1 ziet alles. Een werkgever ziet zijn eigen chauffeurs. Een
-- chauffeur ziet zijn eigen koppelingen -- ook de beëindigde, want hij mag
-- weten dat het is gebeurd.
drop policy if exists wgk_select on public.employer_links;
create policy wgk_select on public.employer_links for select to authenticated
  using (
    public.is_staff()
    or werkgever_id = any(public.mijn_werkgevers())
    or user_id = public.my_id()
    or lower(email) = lower((select p.email from public.profiles p where p.id = public.my_id()))
  );

drop policy if exists wgk_insert on public.employer_links;
create policy wgk_insert on public.employer_links for insert to authenticated
  with check (
    public.is_management()
    or exists (
      select 1 from public.employers e
       where e.id = werkgever_id
         and e.status = 'actief'
         and public.my_id() = any(e.beheerders)
    )
  );

-- Bijwerken: de werkgever (uitnodigen, beëindigen), het management, of de
-- chauffeur zelf -- die mag een koppelverzoek aannemen of weigeren.
drop policy if exists wgk_update on public.employer_links;
create policy wgk_update on public.employer_links for update to authenticated
  using (
    public.is_management()
    or werkgever_id = any(public.mijn_werkgevers())
    or user_id = public.my_id()
    or lower(email) = lower((select p.email from public.profiles p where p.id = public.my_id()))
  )
  with check (
    public.is_management()
    or werkgever_id = any(public.mijn_werkgevers())
    or user_id = public.my_id()
    or lower(email) = lower((select p.email from public.profiles p where p.id = public.my_id()))
  );

drop policy if exists wgk_delete on public.employer_links;
create policy wgk_delete on public.employer_links for delete to authenticated
  using (public.is_management());

/* --- de afspraken --- */

drop policy if exists wgr_select on public.employer_rules;
create policy wgr_select on public.employer_rules for select to authenticated
  using (public.is_staff() or werkgever_id = any(public.mijn_werkgevers()));

drop policy if exists wgr_write on public.employer_rules;
create policy wgr_write on public.employer_rules for all to authenticated
  using (
    public.is_management()
    or exists (
      select 1 from public.employers e
       where e.id = werkgever_id
         and public.my_id() = any(e.beheerders)
    )
  )
  with check (
    public.is_management()
    or exists (
      select 1 from public.employers e
       where e.id = werkgever_id
         and public.my_id() = any(e.beheerders)
    )
  );

-- ---------------------------------------------------------------------------
--  Wasbeurten: wie ziet wat
--
--  Hier zit de kern van "wie eruit ligt, ziet niets meer". De chauffeur ziet
--  de beurten van de werkgevers waar hij nú aan gekoppeld is. `mijn_werkgevers`
--  telt alleen actieve koppelingen, dus zodra die stopt verdwijnt het uit
--  zijn beeld -- ook de beurten die hij zelf heeft gebracht.
-- ---------------------------------------------------------------------------

drop policy if exists jobs_select on public.wash_jobs;
create policy jobs_select on public.wash_jobs for select to authenticated
  using (
    public.is_staff()
    or company_id = public.my_company()
    or (employer_id is not null and employer_id = any(public.mijn_werkgevers()))
  );

-- ---------------------------------------------------------------------------
--  Een werkgever hoort niet in het personeelsdossier van Truckwash1
--
--  `is_staff()` telt de rol werkgever niet mee, dus dat gaat vanzelf goed.
--  Voor de zekerheid wel expliciet: wie alleen werkgever is, komt nergens
--  aan de dossiers.
-- ---------------------------------------------------------------------------

drop policy if exists prive_select on public.personnel_private;
create policy prive_select on public.personnel_private for select to authenticated
  using (
    -- Je eigen regel, tenzij je hier alleen als werkgever komt. Iemand die
    -- én bij Truckwash1 werkt én een werkgeversaccount beheert, houdt gewoon
    -- toegang tot zijn eigen dossier.
    (user_id = public.my_id() and (public.is_staff() or not public.is_employer()))
    or public.is_management()
  );

-- ===========================================================================
--  Berichten over de grens van het eigen bedrijf heen
--
--  Draai dit ná 0016. Opnieuw draaien mag.
--
--  De fout:
--
--      opslaan in notifications: new row violates row-level security
--      policy for table "notifications"
--
--  Dit is de tweede keer dat deze regel omvalt, en om dezelfde reden als de
--  eerste keer (0013): hij noemt wie er mag sturen in plaats van wat er
--  gestuurd wordt. Elke keer dat er iemand bij komt die geen wasser is,
--  breekt hij opnieuw.
--
--  0013 zette hem op `is_staff()` -- werknemer of management. Daar vallen
--  buiten:
--
--    * een werkgever die een chauffeur uitnodigt of loskoppelt
--    * een chauffeur die een koppelverzoek aanneemt of weigert; die heeft
--      vaak helemaal geen rol, hij rijdt alleen voor een bedrijf
--    * een werkgever die zich aanmeldt en dat bij het kantoor meldt
--    * de ontwikkelaar die op een melding antwoordt -- 'developer' is geen
--      'employee', dus die stond er ook buiten
--
--  Het bericht hoort bij de handeling. Wordt het geweigerd, dan blijft het
--  in de wachtrij staan en gaat er niets meer doorheen.
--
--  Wat blijft staan
--  ----------------
--
--  De twee dingen die er werkelijk toe doen, veranderen niet:
--
--    * je stuurt nooit op andermans naam  (from_user_id = my_id())
--    * een bericht aan een hele rol blijft voor een leidinggevende
--
--  Wat verandert is wíé je mag bereiken, en dat wordt nu een vraag over de
--  verhouding tussen twee mensen in plaats van over een rollijst:
--
--    1. wie hier werkt, bereikt zijn collega's
--    2. iedereen bereikt het kantoor -- dat is waar je heen gaat met iets
--    3. een werkgever en zijn chauffeur bereiken elkaar, beide kanten op
--
--  Wat daarmee níét kan: een klant of een chauffeur die zomaar een
--  willekeurige wasmedewerker aanschrijft. Daar is de verhouding niet, dus
--  daar gaat het bericht niet heen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Mijn eigen mailadres
--
--  Nodig omdat een uitnodiging aan een mailadres hangt en niet aan een
--  dossier: op het moment dat een chauffeur ja zegt, staat zijn id nog niet
--  op de koppeling.
-- ---------------------------------------------------------------------------

create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles where auth_id = auth.uid();
$$;

grant execute on function public.my_email() to authenticated;

-- ---------------------------------------------------------------------------
--  Mag ik deze persoon een bericht sturen?
-- ---------------------------------------------------------------------------

create or replace function public.mag_bericht_sturen(doel text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- 1. Wie hier werkt, bereikt zijn collega's.
    --
    --    Ruimer dan is_staff(), want een monteur en de ontwikkelaar werken
    --    hier ook. Dat die er tot nu toe buiten vielen was geen keuze maar
    --    een gevolg van een lijst die niet is meegegroeid.
    public.is_staff()
    or 'technician' = any(public.my_roles())
    or 'developer'  = any(public.my_roles())

    -- 2. Iedereen bereikt het kantoor.
    --
    --    Een werkgever die zich aanmeldt, een klant met een vraag: die
    --    hebben één adres, en dat is management. Eén kant op: hieruit volgt
    --    niet dat management iedereen bereikt -- dat volgt al uit 1.
    or exists (
      select 1 from public.profiles p
       where p.id = doel and p.active and 'management' = any(p.roles)
    )

    -- 3. Een werkgever en zijn chauffeur bereiken elkaar.
    --
    --    De koppeling zelf is het bewijs van de verhouding. Ook een
    --    beëindigde telt hier: juist bij het loskoppelen moet het bericht
    --    aankomen, en dat gaat over dezelfde rij.
    or exists (
      select 1
        from public.employer_links l
        join public.employers e on e.id = l.werkgever_id
       where (
               -- ik ben de chauffeur, het doel beheert het bedrijf
               (l.user_id = public.my_id()
                or lower(l.email) = lower(coalesce(public.my_email(), '')))
               and doel = any(e.beheerders)
             )
          or (
               -- ik beheer het bedrijf, het doel is de chauffeur
               public.my_id() = any(e.beheerders)
               and (
                 l.user_id = doel
                 or lower(l.email) = lower(coalesce(
                      (select p.email from public.profiles p where p.id = doel), ''))
               )
             )
    );
$$;

grant execute on function public.mag_bericht_sturen(text) to authenticated;

-- ---------------------------------------------------------------------------
--  De regel zelf
-- ---------------------------------------------------------------------------

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (
    from_user_id = public.my_id()
    and (
      case
        when to_user_id is not null then public.mag_bericht_sturen(to_user_id)
        -- Een bericht aan een hele rol bereikt iedereen tegelijk. Dat hoort
        -- niet bij iemand te kunnen die alleen zijn collega wil bereiken.
        else public.is_lead()
      end
    )
  );

-- ===========================================================================
--  In- en uitklokken gaat via de kassa
--
--  Draai dit ná 0017. Opnieuw draaien mag.
--
--  Tot nu toe kon iedereen in het dashboard op "Starten" drukken en daarmee
--  zijn eigen urenstaat schrijven. Dat hoort niet thuis in een app die op
--  ieders telefoon staat: dan is inklokken iets wat je vanaf de bank doet.
--
--  Klokken hoort bij het apparaat op de vestiging. Daar toets je je
--  persoonlijke code in of scan je je badge (pos_pins), en dáármee ontstaat
--  de urenregel -- op de plek waar je ook werkelijk staat.
--
--  De regel op time_entries stond op:
--
--      using (public.is_management() or user_id = public.my_id())
--
--  Dat tweede deel is precies de zelfbediening die eruit moet. Maar het
--  eerste deel was ook niet genoeg: de kassa schrijft een urenregel voor de
--  persoon die zich zojuist heeft gemeld, en dat is een ander dossier dan
--  dat van het kassa-account zelf. Met de oude regel kon de kassa dus
--  helemaal niets wegschrijven.
--
--  Vandaar een eigen recht: hours.clock. Dat kent het management toe aan het
--  kassa-account, net zoals pos.manage. Het dashboard vraagt er nooit om.
--
--  Kijken blijft zoals het was -- je eigen uren zie je gewoon, en een
--  leidinggevende die van zijn team -- met één toevoeging: het kassa-account
--  moet ook kunnen kijken. Anders vindt het de openstaande regel niet die
--  het wil afsluiten.
-- ===========================================================================

-- De oude regel deed insert, update én delete in één keer.
drop policy if exists time_write on public.time_entries;

/*
 * En de kassa moet ook kunnen kijken.
 *
 * Niet vanzelfsprekend, dus expliciet: om iemand uit te klokken moet het
 * apparaat de regel kunnen vinden die nog openstaat. Zonder leesrecht raakt
 * die update nul rijen en gebeurt er stilletjes niets -- geen foutmelding,
 * alleen een uitklokking die er nooit is gekomen.
 *
 * Het is een apparaat op de vestiging, geen persoon: het ziet urenregels en
 * verder niets. Uurlonen en dossiers zitten in personnel_private en daar
 * komt het niet.
 */
drop policy if exists time_select on public.time_entries;
create policy time_select on public.time_entries for select to authenticated
  using (
    public.is_lead()
    or user_id = public.my_id()
    or public.heeft_recht('hours.clock')
  );

/*
 * Schrijven doet de kassa, of het kantoor als er iets rechtgezet moet
 * worden. Een medewerker schrijft niet in zijn eigen urenstaat -- ook niet
 * als klopt wat hij zou schrijven. Een urenstaat die je zelf kunt bijwerken
 * is geen urenstaat maar een voorstel.
 */
drop policy if exists time_insert on public.time_entries;
create policy time_insert on public.time_entries for insert to authenticated
  with check (public.is_management() or public.heeft_recht('hours.clock'));

/*
 * Bijwerken: de kassa, het kantoor, en -- alleen om een lopende regel af te
 * sluiten -- een leidinggevende. Die staat erbij als iemand aan het eind van
 * de dag vergeet uit te klokken, en zonder dat blijft zo'n regel eeuwig
 * openstaan. Wat hij precies mag bewaakt de trigger hieronder.
 */
drop policy if exists time_update on public.time_entries;
create policy time_update on public.time_entries for update to authenticated
  using (
    public.is_management()
    or public.heeft_recht('hours.clock')
    or (public.is_supervisor() and ended_at is null)
  )
  with check (
    public.is_management()
    or public.heeft_recht('hours.clock')
    or public.is_supervisor()
  );

/*
 * Weggooien doet alleen het kantoor. Een verkeerd gezette uitklokking
 * corrigeer je; een gewerkt uur dat verdwijnt is een gewerkt uur dat niet
 * wordt uitbetaald.
 */
drop policy if exists time_delete on public.time_entries;
create policy time_delete on public.time_entries for delete to authenticated
  using (public.is_management());

-- ---------------------------------------------------------------------------
--  Wat een leidinggevende precies mag
--
--  Beveiligingsregels kijken naar de nieuwe rij, niet naar het verschil met
--  de oude. "Alleen de eindtijd zetten" is een verschil, dus dat hoort in een
--  trigger. Zonder deze zou een leidinggevende via een openstaande regel het
--  begin, de persoon of de vestiging kunnen verzetten.
-- ---------------------------------------------------------------------------

create or replace function public.time_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_management() or public.heeft_recht('hours.clock') then
    return new;
  end if;

  if public.is_supervisor()
     and old.ended_at is null
     and new.ended_at is not null
     and new.user_id     is not distinct from old.user_id
     and new.started_at  is not distinct from old.started_at
     and new.location_id is not distinct from old.location_id
  then
    return new;
  end if;

  raise exception 'Uren schrijf je aan de kassa, niet hier';
end;
$$;

drop trigger if exists time_bewaak on public.time_entries;
create trigger time_bewaak before update on public.time_entries
  for each row execute function public.time_bewaak_wijziging();

-- ===========================================================================
--  Een bericht als gelezen kunnen melden
--
--  Draai dit ná 0018. Opnieuw draaien mag.
--
--  De fout:
--
--      opslaan in notifications: new row violates row-level security
--      policy for table "notifications"
--
--  ...op een bericht met een id als nt_mb_<mailid>_<baas>. Dat zijn de
--  seintjes die de postbus-serverfunctie maakt als er post binnenkomt. Die
--  worden dus niet door de app verstuurd -- ze worden alleen gelézen.
--
--  En daar zat het. De app kent één manier om iets naar de server te
--  brengen: de hele regel opsturen, en de database beslist of dat een nieuwe
--  regel is of een wijziging. Dat is een upsert, en bij een upsert kijkt
--  Postgres naar de regel voor INSERT én naar die voor UPDATE. Allebei
--  moeten ze meewerken.
--
--  De regel voor INSERT zegt: `from_user_id = my_id()`. Terecht -- je
--  verstuurt niet op andermans naam. Maar hij gold ook voor het openklikken
--  van een bericht dat er allang stond. Daarmee kon je alleen berichten als
--  gelezen melden die je zelf had verstuurd, en dat is nou net de categorie
--  die je niet krijgt.
--
--  Bij de seintjes uit de postbus viel het extra hard op: die hebben
--  helemaal geen afzender -- ze komen van "Postbus", niet van een persoon.
--
--  Wat er nu gebeurt: bestaat de regel al, dan is dit geen verzending maar
--  een wijziging, en dan beslist de regel voor UPDATE. Wat je aan een
--  bestaand bericht mag veranderen bewaakt de trigger eronder, en dat is
--  precies één ding: of je het gelezen hebt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Bestaat dit bericht al?
--
--  Als losse functie, want een regel op notifications die zelf notifications
--  leest draait in een kringetje. Met security definer gaat de vraag langs
--  de regels heen -- en meer dan "ja of nee" komt er niet uit.
-- ---------------------------------------------------------------------------

create or replace function public.bericht_bestaat(bericht_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.notifications n where n.id = bericht_id);
$$;

grant execute on function public.bericht_bestaat(text) to authenticated;

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (
    -- Een bestaande regel: dit is een wijziging, geen verzending.
    public.bericht_bestaat(id)
    -- Een nieuwe regel: dan gelden de eisen aan versturen onverkort.
    or (
      from_user_id = public.my_id()
      and (
        case
          when to_user_id is not null then public.mag_bericht_sturen(to_user_id)
          else public.is_lead()
        end
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Wat je aan een bestaand bericht mag veranderen
--
--  Zonder dit zou de ontvanger de tekst van zijn eigen bericht kunnen
--  herschrijven. Dat is niet erg in de zin dat er iets uitlekt, maar een
--  bericht dat achteraf iets anders zegt dan er is verstuurd is geen bericht
--  meer.
--
--  De afzender mag zijn eigen bericht wel bijwerken -- die heeft het
--  geschreven. En het management sowieso.
-- ---------------------------------------------------------------------------

create or replace function public.notif_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Geen ingelogde gebruiker: dan is dit de server zelf (de serverfuncties
  -- draaien met de servicesleutel). Die komt hier niet aan banden te liggen.
  if public.my_id() is null then return new; end if;

  if public.is_management() or old.from_user_id = public.my_id() then
    return new;
  end if;

  if new.to_user_id   is not distinct from old.to_user_id
     and new.to_role  is not distinct from old.to_role
     and new.kind     is not distinct from old.kind
     and new.title    is not distinct from old.title
     and new.body     is not distinct from old.body
     and new.link     is not distinct from old.link
     and new.from_user_id is not distinct from old.from_user_id
     and new.from_name    is not distinct from old.from_name
     and new.created_at   is not distinct from old.created_at
  then
    -- Alleen read_at is veranderd. Dat is het openklikken van de bel.
    return new;
  end if;

  raise exception 'Aan een bericht van iemand anders verandert alleen of je het gelezen hebt';
end;
$$;

drop trigger if exists notif_bewaak on public.notifications;
create trigger notif_bewaak before update on public.notifications
  for each row execute function public.notif_bewaak_wijziging();

-- ===========================================================================
--  Van melding naar plan
--
--  Draai dit ná 0019. Opnieuw draaien mag.
--
--  Een melding is zelden meteen een opdracht. "Hij doet het niet" is waar en
--  onbruikbaar; "kan dit handiger" ook. Wat eraan ontbreekt zijn de vragen
--  die je anders drie dagen later alsnog stelt, als de melder allang is
--  vergeten wat hij precies deed.
--
--  Daarom: eerst een gesprek met de melder -- dat staat als gewone berichten
--  bij de melding, dus daar is hier geen tabel voor nodig -- en daarna een
--  plan in stappen.
--
--  De stappen staan als jsonb in één rij en niet als losse tabel. Ze worden
--  altijd samen gelezen en samen bijgewerkt (iemand loopt het plan langs en
--  zet vinkjes), dus een tweede tabel zou alleen maar een tweede plek zijn
--  waar het uit de pas kan lopen.
--
--  Wie wat mag:
--
--    lezen      wie meldingen mag zien -- de ontwikkelaar en het management
--    maken      wie plannen mag maken (dev.plan)
--    beslissen  het management, of wie dev.approve heeft gekregen
--
--  De melder ziet het plan niet. Hij ziet wél wat eruit besloten is: dat komt
--  als bericht bij zijn melding te staan, inclusief wat er niet gebeurt en
--  waarom. Een half plan lezen is verwarrender dan de uitkomst horen.
-- ===========================================================================

create table if not exists public.dev_plans (
  id                  text primary key,
  ticket_id           text not null references public.tickets(id) on delete cascade,
  ticket_number       text not null default '',
  titel               text not null default '',
  aanleiding          text not null default '',

  -- [{id,titel,wat,waarom,raakt,risico,omvang,gekozen,opmerking}]
  stappen             jsonb not null default '[]'::jsonb,
  buiten_scope        text,

  status              text not null default 'concept'
                      check (status in ('concept','ter beoordeling','goedgekeurd','afgewezen','uitgevoerd')),
  bron                text not null default 'handmatig'
                      check (bron in ('gesprek','vragenlijst','handmatig')),

  gemaakt_door        text,
  gemaakt_door_naam   text default '',
  gemaakt_op          bigint not null default public.now_ms(),

  beoordeeld_door     text,
  beoordeeld_door_naam text,
  beoordeeld_op       bigint,
  opmerking           text,

  uitgevoerd_in       text,
  uitgevoerd_op       bigint,

  updated_at          bigint not null default public.now_ms()
);

create index if not exists dev_plans_ticket_idx  on public.dev_plans (ticket_id);
create index if not exists dev_plans_status_idx  on public.dev_plans (status);
create index if not exists dev_plans_updated_idx on public.dev_plans (updated_at);

drop trigger if exists stamp_dev_plans on public.dev_plans;
create trigger stamp_dev_plans before insert or update on public.dev_plans
  for each row execute function public.stamp_updated_at();

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.dev_plans enable row level security;

create or replace function public.mag_plannen()
returns boolean language sql stable as $$
  select public.is_management()
      or 'developer' = any(public.my_roles())
      or public.heeft_recht('dev.plan');
$$;

create or replace function public.mag_plan_beslissen()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('dev.approve');
$$;

grant execute on function public.mag_plannen(), public.mag_plan_beslissen() to authenticated;

drop policy if exists dev_plans_select on public.dev_plans;
create policy dev_plans_select on public.dev_plans for select to authenticated
  using (public.mag_plannen() or public.mag_plan_beslissen());

drop policy if exists dev_plans_insert on public.dev_plans;
create policy dev_plans_insert on public.dev_plans for insert to authenticated
  with check (public.mag_plannen());

drop policy if exists dev_plans_update on public.dev_plans;
create policy dev_plans_update on public.dev_plans for update to authenticated
  using (public.mag_plannen() or public.mag_plan_beslissen())
  with check (public.mag_plannen() or public.mag_plan_beslissen());

drop policy if exists dev_plans_delete on public.dev_plans;
create policy dev_plans_delete on public.dev_plans for delete to authenticated
  using (public.is_management());

/*
 * Wie het plan maakt, keurt het niet zelf goed.
 *
 * Niet omdat de ontwikkelaar niet te vertrouwen is, maar omdat dat het hele
 * punt van deze stap is: er zit iemand tussen die bepaalt wat er gebouwd
 * wordt. Valt die weg, dan is het een formulier en geen beslissing.
 *
 * En een plan dat eenmaal is uitgevoerd staat vast. Achteraf de stappen
 * bijstellen zou betekenen dat er iets anders in de app zit dan er in het
 * plan staat, en dan kun je er niet meer op terugkijken.
 */
create or replace function public.plan_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null then return new; end if;

  if old.status = 'uitgevoerd' and not public.is_management() then
    raise exception 'Een uitgevoerd plan staat vast';
  end if;

  if new.status is distinct from old.status
     and new.status in ('goedgekeurd', 'afgewezen')
  then
    if not public.mag_plan_beslissen() then
      raise exception 'Beslissen over een plan doet het management';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists plan_bewaak on public.dev_plans;
create trigger plan_bewaak before update on public.dev_plans
  for each row execute function public.plan_bewaak_wijziging();

-- ===========================================================================
--  Wat je aan je eigen dossier mag veranderen, en de rondleiding
--
--  Draai dit ná 0020. Opnieuw draaien mag.
--
--  Dit had er vanaf het begin moeten staan.
--
--  De regel op profiles luidt:
--
--      using (public.is_management() or auth_id = auth.uid())
--
--  Dat is prima voor wíé er mag schrijven, maar het zegt niets over wát.
--  Beveiligingsregels in PostgreSQL werken per rij en niet per kolom, dus
--  "je mag je eigen rij bijwerken" betekende letterlijk: je hele rij. Ook de
--  kolom `roles`.
--
--  Daarmee kon iedereen met een account zichzelf management maken. Eén
--  update op zijn eigen profiel en hij zag de omzet, de dossiers, de
--  uurlonen en de rechten van iedereen. Niet via een omweg of een truc --
--  gewoon, omdat het mocht.
--
--  Wat een kolom is die niemand over zichzelf hoort te bepalen, staat
--  hieronder. De rest -- je naam, je telefoonnummer, je voorkeuren -- mag je
--  gewoon zelf zetten, en dat blijft zo.
--
--  De rem zet zo'n kolom stilletjes terug in plaats van de hele wijziging te
--  weigeren. Dat is geen slapheid: de app stuurt een gewijzigd dossier als
--  hele rij op, met wat er lokaal bekend was, dus wie offline zijn naam
--  wijzigt terwijl het kantoor ondertussen zijn rol aanpast stuurt die oude
--  rol mee zonder iets van plan te zijn. Weigeren zou daar een wachtrij
--  opleveren die niet meer leegloopt. Wie het wél probeert bereikt precies
--  hetzelfde als hij nu bereikt: niets.
--
--  En meteen de kolom erbij voor de rondleiding: welke uitleg iemand al
--  heeft gezien. Dat hoort bij het profiel en niet op het apparaat, want
--  anders begint hij op elke telefoon opnieuw.
-- ===========================================================================

alter table public.profiles
  add column if not exists seen_tours text[] not null default '{}';

-- ---------------------------------------------------------------------------
--  De rem
-- ---------------------------------------------------------------------------

create or replace function public.profiel_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- De server zelf (serverfuncties met de servicesleutel) en het management.
  if public.my_id() is null or public.is_management() then
    return new;
  end if;

  /*
   * Iemand anders zijn dossier komt hier niet eens langs -- daar houdt de
   * beveiligingsregel hem al tegen. Wat hier gebeurt is de tweede helft: op
   * je eigen rij zijn dit de kolommen die niet van jou zijn.
   *
   * Terugzetten in plaats van weigeren, met opzet. De app stuurt een
   * gewijzigd dossier als hele rij op, met wat er lokaal bekend was. Heeft
   * het kantoor ondertussen je rol aangepast terwijl jij offline was, dan
   * stuur je die oude rol dus mee zonder dat je iets van plan bent -- en dan
   * hoort er niets te gebeuren, geen foutmelding die de wachtrij laat
   * vastlopen. Wie het wél probeert, bereikt precies hetzelfde: niets.
   */
  new.roles            := old.roles;
  new.grants           := old.grants;
  new.revokes          := old.revokes;
  new.active           := old.active;
  new.all_locations    := old.all_locations;
  new.manages          := old.manages;
  new.location_id      := old.location_id;
  new.company_id       := old.company_id;
  new.supervisor_id    := old.supervisor_id;
  new.personnel_number := old.personnel_number;
  new.job_title        := old.job_title;
  new.contract_hours   := old.contract_hours;
  new.start_date       := old.start_date;
  new.end_date         := old.end_date;
  new.hourly_rate      := old.hourly_rate;
  new.notes            := old.notes;
  new.email            := old.email;
  new.auth_id          := old.auth_id;

  /*
   * Het vinkje "moet zijn wachtwoord nog wijzigen" mag je zelf uitzetten --
   * dat is precies wat er gebeurt als je het hebt gewijzigd. Aanzetten hoort
   * bij het uitnodigen, en dat doet de server.
   */
  if new.must_change_password and not old.must_change_password then
    new.must_change_password := old.must_change_password;
  end if;

  return new;
end;
$$;

drop trigger if exists profiel_bewaak on public.profiles;
create trigger profiel_bewaak before update on public.profiles
  for each row execute function public.profiel_bewaak_wijziging();

-- ===========================================================================
--  Bijwerken is geen aanmaken
--
--  Draai dit ná 0021. Opnieuw draaien mag.
--
--  De fout:
--
--      De database weigert dit voor "expenses": new row violates row-level
--      security policy for table "expenses"
--
--  Dit is dezelfde valstrik als bij de berichten in 0019, en hij zit op meer
--  tabellen dan ik toen doorhad.
--
--  De app kent één manier om iets naar de server te brengen: de hele rij
--  opsturen, en de database laten bepalen of dat nieuw is of een wijziging.
--  Dat is een upsert. En bij een upsert kijkt Postgres naar de regel voor
--  INSERT én naar die voor UPDATE -- allebei moeten ze meewerken.
--
--  Zodra de regel voor INSERT iets zegt over wie de rij heeft gemaakt, gaat
--  dat mis bij elke wijziging door iemand anders:
--
--    expenses         `submitted_by = my_id()`. Een bon die per mail
--                     binnenkwam heeft helemaal geen indiener. Het management
--                     kon hem dus openen, maar niet goedkeuren.
--
--    employer_links   alleen de beheerder van het bedrijf mag er een maken.
--                     Maar een chauffeur die zijn koppelverzoek aanneemt
--                     werkt diezelfde rij bij -- en die is geen beheerder.
--
--    agenda_items     `created_by = my_id()`. Een afspraak van een collega
--                     bijwerken kon dus niet, ook niet als je erbij hoort.
--
--  De regel: bestaat de rij al, dan is dit geen aanmaken maar een wijziging,
--  en dan beslist de regel voor UPDATE. Die stond in alle drie de gevallen
--  al goed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Bestaat deze rij al?
--
--  Als losse functie, want een regel op een tabel die zichzelf leest draait
--  in een kringetje. Met security definer gaat de vraag langs de regels heen,
--  en er komt niet meer uit dan ja of nee.
--
--  Het type regclass in plaats van tekst is met opzet: daarmee kan er geen
--  tabelnaam in worden gesmokkeld die er niet hoort.
-- ---------------------------------------------------------------------------

create or replace function public.rij_bestaat(tabel regclass, sleutel text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare gevonden boolean;
begin
  execute format('select exists (select 1 from %s where id = $1)', tabel)
    into gevonden using sleutel;
  return gevonden;
end;
$$;

grant execute on function public.rij_bestaat(regclass, text) to authenticated;

-- ---------------------------------------------------------------------------
--  Bonnen
--
--  Een bon die per mail binnenkwam heeft geen indiener -- die komt van de
--  postbus. Het management hoort hem gewoon te kunnen invullen en afhandelen.
-- ---------------------------------------------------------------------------

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (
    public.rij_bestaat('public.expenses'::regclass, id)
    or public.is_management()
    or (public.is_staff() and submitted_by = public.my_id())
  );

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (
    public.is_management()
    or (submitted_by = public.my_id() and status = 'open')
  )
  with check (
    public.is_management()
    or (submitted_by = public.my_id() and status = 'open')
  );

-- ---------------------------------------------------------------------------
--  Koppelingen met een werkgever
--
--  Aannemen of weigeren van een koppelverzoek is een wijziging van een rij
--  die er al staat. Wie dat mag, staat in wgk_update.
-- ---------------------------------------------------------------------------

drop policy if exists wgk_insert on public.employer_links;
create policy wgk_insert on public.employer_links for insert to authenticated
  with check (
    public.rij_bestaat('public.employer_links'::regclass, id)
    or public.is_management()
    or exists (
      select 1 from public.employers e
       where e.id = werkgever_id
         and e.status = 'actief'
         and public.my_id() = any(e.beheerders)
    )
  );

-- ---------------------------------------------------------------------------
--  De agenda
-- ---------------------------------------------------------------------------

drop policy if exists agenda_insert on public.agenda_items;
create policy agenda_insert on public.agenda_items for insert to authenticated
  with check (
    public.rij_bestaat('public.agenda_items'::regclass, id)
    or (public.is_staff() and created_by = public.my_id())
  );

-- ===========================================================================
--  Uitnodigen en uitschrijven
--
--  Draai dit ná 0022. Opnieuw draaien mag.
--
--  Twee gaten die aan elkaar hangen.
--
--  1. Dubbele mensen
--
--     Het kantoor maakt een dossier aan. Diezelfde persoon meldt zich daarna
--     zelf aan, want er kwam geen uitnodiging -- en doet dat met zijn privé-
--     adres. De koppeling in handle_new_user kijkt op e-mailadres, dus die
--     ziet twee verschillende mensen. Twee dossiers, twee personeelsnummers,
--     twee keer dezelfde man in het rooster.
--
--     De oplossing zit vooral in het uitnodigen: wie een uitnodiging krijgt
--     hoeft zich niet aan te melden. Wat hier bij komt is de vangnet-kant --
--     bij het toelaten van een aanmelding zien of er al iemand met die naam
--     staat, en dan kunnen koppelen in plaats van een tweede aanmaken.
--
--  2. Niemand kon iemand weghalen
--
--     Er stond geen enkele regel voor verwijderen op profiles. Zonder regel
--     mag het niet, dus een dossier dat er per ongeluk stond bleef er staan.
--
--     Twee manieren, want het is niet één ding:
--
--       uitschrijven   inlog en dossier gaan dicht, de persoon is nergens
--                      meer te kiezen, maar zijn uren, wasbeurten en
--                      getekende contracten blijven staan. Dit is wat de
--                      bewaarplicht van je vraagt: loonadministratie en
--                      contracten zeven jaar.
--
--       wissen         werkelijk alles weg. Voor een AVG-verzoek, en pas als
--                      de bewaarplicht voorbij is. Onomkeerbaar, dus met een
--                      reden erbij die blijft staan nadat de persoon weg is.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Uitgeschreven
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists archived_at     bigint,
  add column if not exists archived_by     text,
  add column if not exists archive_reason  text;

create index if not exists profiles_archived_idx on public.profiles (archived_at);

/*
 * De rem uit 0021 kent deze kolommen nog niet. Zonder dit zou een
 * medewerker zichzelf kunnen uitschrijven -- of erger, zichzelf weer
 * terugzetten nadat het kantoor hem eruit heeft gehaald.
 */
create or replace function public.profiel_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_management() then
    return new;
  end if;

  new.roles            := old.roles;
  new.grants           := old.grants;
  new.revokes          := old.revokes;
  new.active           := old.active;
  new.all_locations    := old.all_locations;
  new.manages          := old.manages;
  new.location_id      := old.location_id;
  new.company_id       := old.company_id;
  new.supervisor_id    := old.supervisor_id;
  new.personnel_number := old.personnel_number;
  new.job_title        := old.job_title;
  new.contract_hours   := old.contract_hours;
  new.start_date       := old.start_date;
  new.end_date         := old.end_date;
  new.hourly_rate      := old.hourly_rate;
  new.notes            := old.notes;
  new.email            := old.email;
  new.auth_id          := old.auth_id;
  new.archived_at      := old.archived_at;
  new.archived_by      := old.archived_by;
  new.archive_reason   := old.archive_reason;

  if new.must_change_password and not old.must_change_password then
    new.must_change_password := old.must_change_password;
  end if;

  return new;
end;
$$;

drop trigger if exists profiel_bewaak on public.profiles;
create trigger profiel_bewaak before update on public.profiles
  for each row execute function public.profiel_bewaak_wijziging();

-- ---------------------------------------------------------------------------
--  Wissen: wat er overblijft als de persoon weg is
--
--  Een dossier dat verdwijnt laat niets achter, en dat is precies het
--  probleem: dan kan later niemand meer nagaan dat het is gebeurd, door wie
--  en waarom. Deze regel blijft, met alleen wat nodig is om die vraag te
--  beantwoorden -- geen gegevens van de persoon zelf behalve zijn naam.
-- ---------------------------------------------------------------------------

create table if not exists public.deletion_log (
  id            text primary key,
  soort         text not null default 'medewerker',
  naam          text not null default '',
  /* Het personeelsnummer, zodat een oude urenlijst nog te plaatsen is */
  kenmerk       text,
  reden         text not null default '',
  door          text,
  door_naam     text not null default '',
  at            bigint not null default public.now_ms(),
  updated_at    bigint not null default public.now_ms()
);

create index if not exists deletion_log_at_idx on public.deletion_log (at);

alter table public.deletion_log enable row level security;

drop policy if exists deletion_log_select on public.deletion_log;
create policy deletion_log_select on public.deletion_log for select to authenticated
  using (public.is_management());

/* Schrijven doet de serverfunctie met de servicesleutel, niemand anders. */
drop policy if exists deletion_log_write on public.deletion_log;
create policy deletion_log_write on public.deletion_log for all to authenticated
  using (false) with check (false);

-- ---------------------------------------------------------------------------
--  Verwijderen mag het management
--
--  De serverfunctie doet het echte werk -- die haalt ook het inlogaccount
--  weg, en daar heb je de servicesleutel voor nodig. Maar zonder deze regel
--  zou zelfs dát niet lukken vanuit de app, en dan blijft een verkeerd
--  aangemaakt dossier eeuwig staan.
-- ---------------------------------------------------------------------------

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_management() and id <> public.my_id());

-- ---------------------------------------------------------------------------
--  Wie is uitgeschreven, telt niet meer mee
--
--  Alleen voor het lezen van de lijst. Wie uitgeschreven is verdwijnt uit
--  het beeld van collega's, maar het management blijft hem zien -- anders
--  kun je een vergissing niet terugdraaien.
-- ---------------------------------------------------------------------------

create or replace function public.is_uitgeschreven(dossier text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select archived_at is not null from public.profiles where id = dossier),
    false);
$$;

grant execute on function public.is_uitgeschreven(text) to authenticated;

-- ===========================================================================
--  Uren rechtzetten en kilometers verantwoorden
--
--  Draai dit ná 0023. Opnieuw draaien mag.
--
--  Twee dingen die een medewerker over zichzelf moet kunnen zeggen, en één
--  ding dat hij juist niet zelf mag bepalen.
--
--  1. Uren rechtzetten
--
--     Klokken gaat sinds 0018 via de kassa, en dat is goed: waar je werkt
--     hoort te blijken uit waar je inklokt. Maar iemand die vergeet in te
--     klokken staat nu met lege handen -- hij was er wel, het staat er niet,
--     en hij kan er zelf niets aan doen.
--
--     Vandaar een verzoek: hij geeft aan wat er had moeten staan en waarom,
--     zijn leidinggevende kijkt ernaar. Niet hijzelf, want dan is het geen
--     urenstaat meer maar een voorstel -- precies wat we in 0018 hebben
--     dichtgezet.
--
--     Alles blijft staan: wat hij vroeg, wat het was, wie besliste en
--     wanneer. Een urenstaat waarin achteraf iets is veranderd zonder spoor
--     is een urenstaat waar je niets meer aan hebt.
--
--  2. Kilometers
--
--     Van adres naar adres, uitgerekend over de weg. Losse kilometers
--     intypen kan niet, en dat is de hele bedoeling: een vergoeding waarbij
--     iedereen zijn eigen getal invult is geen vergoeding maar een
--     vertrouwenskwestie.
--
--     De afstand wordt één keer opgezocht en dan onthouden. Woon-werk is
--     elke dag dezelfde route; die hoeft niet elke dag opnieuw berekend te
--     worden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Waar iemand woont
--
--  Hoort bij het afgeschermde deel: het adres van een collega gaat niemand
--  anders aan, en zonder adres valt woon-werkverkeer niet uit te rekenen.
-- ---------------------------------------------------------------------------

alter table public.personnel_private
  add column if not exists address  text,
  add column if not exists postcode text,
  add column if not exists city     text;

-- ---------------------------------------------------------------------------
--  Een verzoek om de uren recht te zetten
-- ---------------------------------------------------------------------------

create table if not exists public.hour_requests (
  id             text primary key,
  user_id        text not null,
  user_name      text not null default '',
  /* De regel waar het over gaat; leeg betekent: die is er helemaal niet */
  entry_id       text,
  location_id    text references public.locations(id) on delete set null,

  soort          text not null default 'vergeten'
                 check (soort in ('vergeten','verkeerde tijd','te vroeg uitgeklokt','anders')),
  /* Wat er volgens de medewerker had moeten staan */
  van            bigint not null,
  tot            bigint,
  toelichting    text not null default '',

  status         text not null default 'nieuw'
                 check (status in ('nieuw','goedgekeurd','afgewezen','ingetrokken')),
  aangevraagd_op bigint not null default public.now_ms(),

  beslist_door      text,
  beslist_door_naam text,
  beslist_op        bigint,
  beslissing_reden  text,

  updated_at     bigint not null default public.now_ms()
);

create index if not exists hr_user_idx    on public.hour_requests (user_id);
create index if not exists hr_status_idx  on public.hour_requests (status);
create index if not exists hr_updated_idx on public.hour_requests (updated_at);

-- ---------------------------------------------------------------------------
--  Ritten
-- ---------------------------------------------------------------------------

create table if not exists public.trips (
  id            text primary key,
  user_id       text not null,
  user_name     text not null default '',
  op            bigint not null,

  van_label     text not null default '',
  naar_label    text not null default '',
  /* Wat er werkelijk is opgezocht; hiermee is de afstand na te rekenen */
  van_adres     text not null default '',
  naar_adres    text not null default '',

  /* Kilometers over de weg, één kant op */
  km            numeric not null default 0,
  retour        boolean not null default false,
  doel          text not null default 'woon-werk'
                check (doel in ('woon-werk','klant','vestiging','anders')),
  toelichting   text,

  /* Waar de afstand vandaan komt; 'handmatig' bestaat met opzet niet */
  bron          text not null default 'route'
                check (bron in ('route','vast')),

  status        text not null default 'nieuw'
                check (status in ('nieuw','goedgekeurd','afgewezen')),
  beslist_door      text,
  beslist_door_naam text,
  beslist_op        bigint,

  updated_at    bigint not null default public.now_ms()
);

create index if not exists trips_user_idx    on public.trips (user_id);
create index if not exists trips_op_idx      on public.trips (op);
create index if not exists trips_updated_idx on public.trips (updated_at);

/*
 * Niemand vult zijn eigen kilometers in.
 *
 * Dit staat hier en niet alleen in het scherm, want een scherm is een
 * afspraak en dit is een regel. De afstand komt van de routedienst; de
 * serverfunctie schrijft hem weg.
 */
create or replace function public.rit_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_lead() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.km <> 0 then
      raise exception 'De kilometers worden uitgerekend, niet ingevuld';
    end if;
    return new;
  end if;

  if new.km is distinct from old.km
     or new.van_adres is distinct from old.van_adres
     or new.naar_adres is distinct from old.naar_adres
     or new.status is distinct from old.status
  then
    raise exception 'De afstand en de beoordeling bepaal je niet zelf';
  end if;
  return new;
end;
$$;

drop trigger if exists rit_bewaak on public.trips;
create trigger rit_bewaak before insert or update on public.trips
  for each row execute function public.rit_bewaak_wijziging();

-- ---------------------------------------------------------------------------
--  Het geheugen van de routedienst
--
--  Woon-werk is elke dag dezelfde route. Die hoeft niet elke dag opnieuw te
--  worden opgevraagd -- dat kost tijd, en bij een betaalde dienst geld.
-- ---------------------------------------------------------------------------

create table if not exists public.route_cache (
  id          text primary key,
  van         text not null,
  naar        text not null,
  km          numeric not null,
  minuten     integer,
  dienst      text not null default 'ors',
  at          bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Tijdstempels
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['hour_requests','trips','route_cache'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.hour_requests enable row level security;
alter table public.trips         enable row level security;
alter table public.route_cache   enable row level security;

/* --- urenverzoeken --- */

drop policy if exists hr_select on public.hour_requests;
create policy hr_select on public.hour_requests for select to authenticated
  using (user_id = public.my_id() or public.is_lead());

drop policy if exists hr_insert on public.hour_requests;
create policy hr_insert on public.hour_requests for insert to authenticated
  with check (
    public.rij_bestaat('public.hour_requests'::regclass, id)
    or (public.is_staff() and user_id = public.my_id() and status = 'nieuw')
  );

-- Beslissen doet de leidinggevende; intrekken mag de aanvrager zelf.
drop policy if exists hr_update on public.hour_requests;
create policy hr_update on public.hour_requests for update to authenticated
  using (public.is_lead() or user_id = public.my_id())
  with check (public.is_lead() or user_id = public.my_id());

create or replace function public.hr_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_lead() then return new; end if;

  -- De aanvrager mag precies één ding: zijn eigen verzoek intrekken.
  if new.status = 'ingetrokken'
     and old.status = 'nieuw'
     and old.user_id = public.my_id()
     and new.van is not distinct from old.van
     and new.tot is not distinct from old.tot
  then
    return new;
  end if;

  raise exception 'Over je eigen urenverzoek beslist je leidinggevende';
end;
$$;

drop trigger if exists hr_bewaak on public.hour_requests;
create trigger hr_bewaak before update on public.hour_requests
  for each row execute function public.hr_bewaak_wijziging();

drop policy if exists hr_delete on public.hour_requests;
create policy hr_delete on public.hour_requests for delete to authenticated
  using (public.is_management());

/* --- ritten --- */

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (user_id = public.my_id() or public.is_lead());

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (
    public.rij_bestaat('public.trips'::regclass, id)
    or (public.is_staff() and user_id = public.my_id())
  );

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (public.is_lead() or (user_id = public.my_id() and status = 'nieuw'))
  with check (public.is_lead() or (user_id = public.my_id() and status = 'nieuw'));

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated
  using (public.is_lead() or (user_id = public.my_id() and status = 'nieuw'));

/* --- het routegeheugen --- */

drop policy if exists route_select on public.route_cache;
create policy route_select on public.route_cache for select to authenticated
  using (public.is_staff());

-- Schrijven doet de serverfunctie met de servicesleutel. Zou de app hier
-- mogen schrijven, dan kon iedereen zijn eigen afstand "onthouden".
drop policy if exists route_write on public.route_cache;
create policy route_write on public.route_cache for all to authenticated
  using (false) with check (false);

-- ===========================================================================
--  De kluis, en het koppelen van een kassa
--
--  Twee dingen die bij elkaar horen, want ze gaan over hetzelfde: wie mag er
--  aan het geld, en welk apparaat mag er meepraten.
--
--  ------------------------------------------------------------------------
--  1. De kluis
--  ------------------------------------------------------------------------
--
--  Naast de lade van de kassa staat er op elke vestiging een kluis. Daar gaat
--  de omzet in die niet in de lade hoort, en daar komt het wisselgeld uit.
--  Tot nu toe was dat een boek op de balie; hier wordt het een administratie.
--
--  De keuze die alles verklaart: er worden briefjes en munten geteld, geen
--  bedragen ingetikt.
--
--  Bij een kluis werkt dat namelijk anders dan bij een bon. Wie 340 euro
--  afstort, legt drie briefjes van honderd, twee van twintig en dat kleine
--  beetje neer -- en juist bij dat laatste gaat het mis. Iemand tikt 340 in
--  terwijl er 240 ligt, en dat verschil komt drie weken later boven water,
--  als niemand meer weet wie er die dag stond. Dus slaan we op wat er
--  fysiek bewoog, en rekent de database het bedrag daaruit uit.
--
--   * pos_safes        de kluis, één per vestiging
--   * pos_safe_moves   elke beweging, met de briefjes en munten erbij
--
--  Het saldo is geen kolom maar een som -- net als bij een strippenkaart, en
--  om dezelfde reden: twee mensen die tegelijk offline iets uit de kluis
--  halen zouden elkaars saldo overschrijven.
--
--  Een telling is het enige dat het saldo hard zet. Wat er geteld is staat
--  erin, samen met wat er verwacht werd en het verschil. Dat verschil wordt
--  bewaard zoals het die avond is vastgesteld en nooit stilletjes
--  weggerekend.
--
--  ------------------------------------------------------------------------
--  2. Een kassa koppelen
--  ------------------------------------------------------------------------
--
--  Tot nu toe richtte je een kassa in door er met een account op in te
--  loggen en zelf een kassa aan te maken. Dat werkt, maar het betekent dat
--  op elke tablet achter de balie iemands wachtwoord staat, en dat het
--  kantoor niet weet welke apparaten er meedoen.
--
--  Nu gaat het andersom. Het kantoor maakt de kassa aan en zet er een code
--  bij die één keer geldig is. Die code wordt op de kassa ingetoetst, en de
--  serverfunctie kassa-koppelen geeft dat apparaat zijn eigen inlog. Zo
--  hoort er bij elk apparaat een naam in een lijst, en kan het kantoor er
--  van een afstand de stekker uit trekken.
--
--   * pos_pairings     de eenmalige codes
--   * pos_devices      welk apparaat op welke kassa staat, en of het nog mag
--
--  Waarom "eruit gooien" twee stappen is: op een kassa kan omzet staan die
--  nog niet verstuurd is. Trek je de inlog er direct onderuit, dan komt die
--  omzet nergens meer aan. Dus zet het kantoor het apparaat op
--  'ingetrokken'; de kassa ziet dat, stuurt eerst zijn wachtrij leeg, wist
--  zichzelf en meldt dat terug met wiped_at. Daarna kan het account weg.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De kluis
-- ---------------------------------------------------------------------------

create table if not exists public.pos_safes (
  id          text primary key,
  location_id text references public.locations(id) on delete cascade,
  name        text not null default 'Kluis',
  active      boolean not null default true,
  note        text,
  updated_at  bigint not null default public.now_ms()
);

-- Eén kluis per vestiging. Twee zou betekenen dat het geld in de ene of in
-- de andere kan zitten, en dan telt niemand meer iets.
create unique index if not exists pos_safes_location_key
  on public.pos_safes (location_id);

/*
 * Elke vestiging krijgt zijn kluis, ook de vestigingen die er al zijn.
 *
 * Dit gebeurt hier en niet in de app, om een simpele reden: de kassa mag
 * geen kluizen aanmaken. Zou hij dat wel mogen, dan maakt een apparaat met
 * een verkeerd ingestelde vestiging een tweede kluis aan, en verdwijnt het
 * geld in een administratie die niemand bekijkt.
 */
insert into public.pos_safes (id, location_id, name)
select 'kluis_' || l.id, l.id, 'Kluis ' || l.name
  from public.locations l
 where not exists (select 1 from public.pos_safes s where s.location_id = l.id)
on conflict do nothing;

create or replace function public.pos_kluis_bij_vestiging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pos_safes (id, location_id, name)
  values ('kluis_' || new.id, new.id, 'Kluis ' || new.name)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists locations_kluis on public.locations;
create trigger locations_kluis after insert on public.locations
  for each row execute function public.pos_kluis_bij_vestiging();

-- ---------------------------------------------------------------------------
--  Bewegingen in de kluis
--
--  De richting zit in `soort` en niet in het teken van het bedrag. Dat is
--  met opzet: een min die je zelf moet intikken is een min die iemand ooit
--  vergeet. Wat erin gaat is een afstorting, wisselgeld of een inleg; wat
--  eruit gaat gaat naar de bank, naar de lade of naar een uitgave.
--
--  `coins` is altijd een positief aantal per soort briefje of munt:
--  {"b100": 3, "b20": 2, "m50": 1}. De sleutels zijn b<euro> voor briefjes
--  en m<cent> voor munten -- b5 is dus het briefje van vijf, m5 de munt van
--  vijf cent.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_safe_moves (
  id           text primary key,
  safe_id      text not null references public.pos_safes(id) on delete cascade,
  location_id  text references public.locations(id) on delete set null,
  soort        text not null default 'inleg'
               check (soort in ('afstorting','wisselgeld','naar-bank',
                                'van-bank','uitgave','inleg','telling')),
  -- Wat er fysiek bewoog. Bij een telling leeg; daar staat het in counted.
  coins        jsonb not null default '{}'::jsonb,
  -- Alleen bij een telling: de volledige samenstelling zoals geteld. Dit is
  -- het enige dat het saldo hard zet.
  counted      jsonb,
  -- Het bedrag met teken, afgeleid uit coins en soort en hier vastgelegd.
  -- Vastgelegd en niet berekend bij het opvragen: als er later een beweging
  -- bijkomt die nog in een wachtrij stond, moet je kunnen zien wat het die
  -- dag was.
  amount       numeric not null default 0,
  -- Alleen bij een telling.
  expected     numeric,
  difference   numeric,
  -- Waar het vandaan kwam of naartoe ging, als dat de kassalade was.
  session_id   text references public.pos_cash_sessions(id) on delete set null,
  register_id  text references public.pos_registers(id) on delete set null,
  reason       text not null default '',
  user_id      text references public.profiles(id) on delete set null,
  user_name    text not null default '',
  at           bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists pos_safe_moves_safe_idx    on public.pos_safe_moves (safe_id, at);
create index if not exists pos_safe_moves_session_idx on public.pos_safe_moves (session_id);
create index if not exists pos_safe_moves_updated_idx on public.pos_safe_moves (updated_at);

-- ---------------------------------------------------------------------------
--  Een beweging in de kluis staat vast
--
--  Om dezelfde reden als bij een afgerekende bon: een kasadministratie die je
--  achteraf kunt bijschaven is geen administratie. Een vergissing corrigeer
--  je met een tegenboeking of met een telling, niet met de gum.
--
--  Opnieuw versturen mag wél. Een kassa die zijn wachtrij twee keer
--  aanbiedt, biedt dezelfde waarden aan; `is distinct from` laat dat door.
-- ---------------------------------------------------------------------------

create or replace function public.pos_kluis_vastzetten()
returns trigger language plpgsql as $$
begin
  if new.soort    is distinct from old.soort
  or new.coins    is distinct from old.coins
  or new.counted  is distinct from old.counted
  or new.amount   is distinct from old.amount
  or new.safe_id  is distinct from old.safe_id
  or new.at       is distinct from old.at
  or new.user_id  is distinct from old.user_id
  then
    raise exception 'Deze kluisboeking staat vast. Zet een tegenboeking of een telling tegenover een vergissing.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_safe_moves_vast on public.pos_safe_moves;
create trigger pos_safe_moves_vast before update on public.pos_safe_moves
  for each row execute function public.pos_kluis_vastzetten();

create or replace function public.pos_kluis_niet_wissen()
returns trigger language plpgsql as $$
begin
  raise exception 'Een kluisboeking mag niet verwijderd worden. Zet er een tegenboeking tegenover; dan blijft te zien wat er gebeurd is.';
end;
$$;

drop trigger if exists pos_safe_moves_niet_wissen on public.pos_safe_moves;
create trigger pos_safe_moves_niet_wissen before delete on public.pos_safe_moves
  for each row execute function public.pos_kluis_niet_wissen();

/**
 * Wat één briefje of munt waard is, uit zijn sleutel.
 *
 * b100 -> 100.00, m50 -> 0.50. Een onbekende sleutel is nul en geen fout:
 * komt er ooit een nieuwe munt bij, dan moet een oude telling nog leesbaar
 * zijn in plaats van de hele functie te laten omvallen.
 */
create or replace function public.pos_munt_waarde(sleutel text)
returns numeric language sql immutable as $$
  select case
    when sleutel ~ '^b[0-9]+$' then substring(sleutel from 2)::numeric
    when sleutel ~ '^m[0-9]+$' then substring(sleutel from 2)::numeric / 100
    else 0
  end;
$$;

grant execute on function public.pos_munt_waarde(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Wat er in de kluis zit
--
--  Voor het dashboard, dat niet de hele geschiedenis van een kluis wil
--  ophalen om één getal te laten zien. De kassa rekent hetzelfde uit in
--  src/lib/kluis.ts, en die moet het offline kunnen -- vandaar dat het op
--  twee plekken staat. De regel is dezelfde: vanaf de laatste telling
--  optellen, en zonder telling vanaf nul.
--
--  Waarom er op (at, id) gesorteerd wordt en niet alleen op at: twee boekingen
--  kunnen in dezelfde milliseconde vallen. Stond hier alleen `at > telling.at`,
--  dan viel een boeking van hetzelfde moment als de telling uit het saldo --
--  geen fout, alleen een bedrag dat niet klopt. Het id erbij maakt de volgorde
--  overal dezelfde. Willekeurig, maar overal op dezelfde manier willekeurig, en
--  dat is precies wat hier nodig is.
-- ---------------------------------------------------------------------------

create or replace function public.pos_kluis_saldo(kluis text)
returns numeric language sql stable security definer set search_path = public as $$
  with laatste as (
    -- Op tijd én id, want twee boekingen kunnen in dezelfde milliseconde
    -- vallen. Zie de kanttekening hieronder.
    select at, id,
           coalesce((select sum((value)::numeric * public.pos_munt_waarde(key))
                       from jsonb_each_text(m.counted)), 0) as basis
      from public.pos_safe_moves m
     where m.safe_id = kluis and m.soort = 'telling' and m.counted is not null
     order by m.at desc, m.id desc
     limit 1
  )
  select coalesce((select basis from laatste), 0)
       + coalesce((
           select sum(m.amount) from public.pos_safe_moves m
            where m.safe_id = kluis
              and m.soort <> 'telling'
              and (
                not exists (select 1 from laatste)
                or (m.at, m.id) > (select at, id from laatste)
              )
         ), 0);
$$;

grant execute on function public.pos_kluis_saldo(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Eenmalige codes om een kassa te koppelen
--
--  De code staat leesbaar in de tabel, en dat hoort ook: iemand van het
--  kantoor leest hem van zijn scherm en tikt hem op de kassa in. Wat hem
--  veilig maakt is niet dat hij geheim is opgeslagen maar dat hij één keer
--  werkt en verloopt -- en dat alleen wie kassa's mag beheren hem kan zien.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_pairings (
  id              text primary key,
  code            text not null,
  location_id     text not null references public.locations(id) on delete cascade,
  -- Voor welke kassa. Het kantoor maakt de kassa aan en dan de code; zo weet
  -- het apparaat meteen welke code op zijn bonnen komt.
  register_id     text references public.pos_registers(id) on delete cascade,
  created_by      text references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  expires_at      bigint not null,
  used_at         bigint,
  used_by_device  text,
  note            text,
  updated_at      bigint not null default public.now_ms()
);

create unique index if not exists pos_pairings_code_key on public.pos_pairings (code);
create index if not exists pos_pairings_location_idx on public.pos_pairings (location_id);

-- ---------------------------------------------------------------------------
--  De apparaten
--
--  Elk apparaat heeft zijn eigen inlog. Niet het account van een medewerker:
--  dan staat er een wachtwoord van een mens op een tablet achter de balie,
--  en verliest die mens zijn toegang als het apparaat wordt geblokkeerd.
--
--  status:
--    actief        doet mee
--    geblokkeerd   tijdelijk uit; de kassa gaat op slot maar blijft zijn
--                  wachtrij versturen. Precies wat je wil als een tablet
--                  kwijt is en de omzet er nog op staat.
--    ingetrokken   eruit. De kassa stuurt zijn wachtrij leeg, wist zichzelf
--                  en zet wiped_at. Daarna mag het account weg.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_devices (
  id           text primary key,
  register_id  text references public.pos_registers(id) on delete cascade,
  location_id  text references public.locations(id) on delete set null,
  -- Wat het apparaat van zichzelf weet. Blijft staan als de app opnieuw
  -- wordt geïnstalleerd, zodat hetzelfde apparaat niet twee keer in de
  -- lijst komt.
  device_key   text not null default '',
  name         text not null default '',
  platform     text not null default '',
  app_version  text,
  -- Het inlogaccount dat bij dit apparaat hoort.
  auth_user_id uuid,
  profile_id   text references public.profiles(id) on delete set null,
  status       text not null default 'actief'
               check (status in ('actief','geblokkeerd','ingetrokken')),
  paired_at    bigint not null default public.now_ms(),
  last_seen_at bigint,
  wiped_at     bigint,
  note         text,
  updated_at   bigint not null default public.now_ms()
);

/*
 * Eén apparaat per kassa.
 *
 * Twee apparaten op dezelfde kassa geven dezelfde bonnummers, en dan blijft
 * de tweede bon in de wachtrij hangen met een fout over een dubbele sleutel.
 * De app waarschuwde daarvoor; nu houdt de database het tegen. Een
 * ingetrokken apparaat telt niet mee -- de opvolger moet erin kunnen.
 */
create unique index if not exists pos_devices_register_key
  on public.pos_devices (register_id)
  where status in ('actief','geblokkeerd');

create index if not exists pos_devices_location_idx on public.pos_devices (location_id);
create index if not exists pos_devices_updated_idx  on public.pos_devices (updated_at);

-- ---------------------------------------------------------------------------
--  Een apparaat is geen medewerker
--
--  Het inlogaccount van een kassa heeft een personeelsdossier nodig, want
--  daar hangt alles aan: welke vestiging, en dus welke gegevens het apparaat
--  mag zien. Maar het is geen mens. Zonder dit vlaggetje staat "Kassa
--  KAS-UTR-1" tussen het personeel in het rooster, in de urenstaat en in de
--  lijst waaruit je aan de kassa iemand kiest.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists is_device boolean not null default false;

create index if not exists profiles_is_device_idx on public.profiles (is_device);

-- ---------------------------------------------------------------------------
--  Het bonnummer komt van de kassa, de bovengrens van de server
--
--  De kassa nummert zijn bonnen zelf door, op het apparaat, zodat het ook
--  zonder internet doorloopt. last_seq is de hoogste die de server gezien
--  heeft; een opnieuw ingericht apparaat telt daar vanaf verder.
--
--  Dat getal stuurde de kassa eerst zelf mee. Dat kan niet meer: een
--  apparaataccount mag geen kassa's wijzigen -- en dat is goed, want dan kan
--  een apparaat ook zijn eigen instellingen niet omzetten. Dus rekent de
--  server het uit op het moment dat er een bon binnenkomt. Dat is
--  bovendien betrouwbaarder: het volgt de bonnen die er echt zijn.
-- ---------------------------------------------------------------------------

create or replace function public.pos_seq_bijwerken()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.register_id is not null and new.seq is not null then
    update public.pos_registers
       set last_seq = greatest(last_seq, new.seq)
     where id = new.register_id and last_seq < new.seq;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_sales_seq on public.pos_sales;
create trigger pos_sales_seq after insert on public.pos_sales
  for each row execute function public.pos_seq_bijwerken();

-- ---------------------------------------------------------------------------
--  Tijdstempels
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'pos_safes','pos_safe_moves','pos_pairings','pos_devices'
  ] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Beveiliging op rijniveau
--
--  Dezelfde verdeling als bij de rest van de kassa: wie op een vestiging
--  werkt mag de kluis van die vestiging zien en erin boeken; de app bepaalt
--  wie er daadwerkelijk bij mag met het recht pos.safe. Dat de app dat doet
--  en niet de database heeft een reden: de rollen staan in permissions.ts en
--  die kan de database niet narekenen.
--
--  Wat de database wél hard afdwingt, en dat is het belangrijkste:
--  boekingen kunnen niet meer gewijzigd of gewist worden.
-- ---------------------------------------------------------------------------

alter table public.pos_safes      enable row level security;
alter table public.pos_safe_moves enable row level security;
alter table public.pos_pairings   enable row level security;
alter table public.pos_devices    enable row level security;

-- ------------------------------- de kluis ---------------------------------

drop policy if exists pos_safes_select on public.pos_safes;
create policy pos_safes_select on public.pos_safes for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

-- Aanmaken en omzetten doet het kantoor. De kassa leest alleen.
drop policy if exists pos_safes_write on public.pos_safes;
create policy pos_safes_write on public.pos_safes for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

drop policy if exists pos_safe_moves_select on public.pos_safe_moves;
create policy pos_safe_moves_select on public.pos_safe_moves for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_safe_moves_insert on public.pos_safe_moves;
create policy pos_safe_moves_insert on public.pos_safe_moves for insert to authenticated
  with check (public.is_staff() and public.in_my_locations(location_id));

-- Wijzigen mag; de trigger hierboven bepaalt dat er niets te wijzigen valt
-- behalve de toelichting. Zonder deze regel zou een kassa die zijn wachtrij
-- opnieuw aanbiedt vastlopen op een rij die er al staat.
drop policy if exists pos_safe_moves_update on public.pos_safe_moves;
create policy pos_safe_moves_update on public.pos_safe_moves for update to authenticated
  using (public.is_staff() and public.in_my_locations(location_id))
  with check (public.is_staff() and public.in_my_locations(location_id));

-- ------------------------------- de codes ---------------------------------

-- Een koppelcode is een sleutel tot de gegevens van een vestiging. Alleen
-- wie kassa's beheert ziet hem, en niemand anders -- ook geen collega op
-- dezelfde vestiging.
drop policy if exists pos_pairings_all on public.pos_pairings;
create policy pos_pairings_all on public.pos_pairings for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

-- --------------------- de kassa mag zijn eigen instelling ------------------

/*
 * Een apparaat mag van zijn eigen kassa de printer en de pinautomaat zetten.
 *
 * Dat hoort namelijk bij het apparaat en niet bij het kantoor: welke bonprinter
 * er aan deze balie hangt, weet degene die ervoor staat. Zonder deze regel is
 * de enige manier om dat in te stellen een account met kassabeheer -- en dan
 * kan datzelfde apparaat ook aan de prijzen.
 *
 * Wat er niet bij hoort: de code, de naam, de vestiging en het aan-uitvinkje.
 * Daar zit de rem eronder voor.
 */
drop policy if exists pos_registers_eigen on public.pos_registers;
create policy pos_registers_eigen on public.pos_registers for update to authenticated
  using (exists (
    select 1 from public.pos_devices d
     where d.register_id = pos_registers.id
       and d.auth_user_id = auth.uid()
       and d.status = 'actief'))
  with check (exists (
    select 1 from public.pos_devices d
     where d.register_id = pos_registers.id
       and d.auth_user_id = auth.uid()
       and d.status = 'actief'));

create or replace function public.pos_kassa_eigen_instelling()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /*
   * Het bonnummer gaat nooit achteruit -- voor niemand, ook niet voor het
   * kantoor.
   *
   * last_seq is een hoogwatermerk: de hoogste bon die de server gezien heeft.
   * Een kassa stuurt bij het opslaan van zijn printerinstelling de hele regel
   * mee, inclusief het nummer dat híj kende. Is dat een oud nummer -- omdat er
   * inmiddels bonnen van een ander apparaat binnenkwamen -- dan zou de
   * bovengrens zakken, en begint een volgend apparaat opnieuw te tellen bij
   * een nummer dat al bestaat. Dan blijven bonnen in de wachtrij hangen op een
   * dubbele sleutel, en dat is precies de fout die nergens hardop klinkt.
   */
  if new.last_seq < old.last_seq then
    new.last_seq := old.last_seq;
  end if;

  if public.mag_kassa_beheren() then return new; end if;

  -- Gaat dit niet over het apparaat zelf, dan bepaalt de regel erboven al of
  -- het mag; hier valt niets te knijpen.
  if auth.uid() is null
  or not exists (select 1 from public.pos_devices d
                  where d.register_id = old.id and d.auth_user_id = auth.uid())
  then
    return new;
  end if;

  if new.code        is distinct from old.code
  or new.name        is distinct from old.name
  or new.location_id is distinct from old.location_id
  or new.active      is distinct from old.active
  then
    raise exception 'Een kassa mag van zichzelf alleen de printer en de pinautomaat zetten. De code, de naam en de vestiging komen uit het dashboard.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_registers_eigen_instelling on public.pos_registers;
create trigger pos_registers_eigen_instelling before update on public.pos_registers
  for each row execute function public.pos_kassa_eigen_instelling();

-- ----------------------------- de apparaten -------------------------------

drop policy if exists pos_devices_select on public.pos_devices;
create policy pos_devices_select on public.pos_devices for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_devices_write on public.pos_devices;
create policy pos_devices_write on public.pos_devices for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

/*
 * Een apparaat mag van zijn eigen regel bijhouden dat hij er nog is, en
 * melden dat hij zichzelf gewist heeft. Niets anders -- de trigger eronder
 * houdt de rest tegen.
 *
 * Dat laatste is wat "op afstand eruit gooien" werkend maakt: het kantoor
 * zet de status op ingetrokken, de kassa stuurt zijn wachtrij leeg en zet
 * wiped_at. Pas dan mag het account weg, want anders zou de omzet die nog
 * op dat apparaat stond nergens meer aankomen.
 */
drop policy if exists pos_devices_eigen on public.pos_devices;
create policy pos_devices_eigen on public.pos_devices for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create or replace function public.pos_apparaat_eigen_regel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /*
   * Deze rem geldt alleen voor het apparaat zelf.
   *
   * Eerst stond hier "wie geen kassa's beheert mag niets", en dat leek
   * hetzelfde. Het was het niet: bij een serverfunctie en bij een migratie is
   * auth.uid() leeg, dus mag_kassa_beheren() is dan onwaar -- en dan hield
   * deze trigger juist de kant tegen die er wel over gaat. Op afstand
   * intrekken werkte daardoor niet.
   *
   * Wie überhaupt aan deze tabel mag komen, bepalen de regels erboven. Hier
   * gaat het alleen om wat een apparaat aan zijn eigen regel mag veranderen.
   */
  if old.auth_user_id is null
  or auth.uid() is null
  or old.auth_user_id <> auth.uid()
  or public.mag_kassa_beheren()
  then
    return new;
  end if;

  if new.register_id  is distinct from old.register_id
  or new.location_id  is distinct from old.location_id
  or new.status       is distinct from old.status
  or new.auth_user_id is distinct from old.auth_user_id
  or new.profile_id   is distinct from old.profile_id
  or new.device_key   is distinct from old.device_key
  then
    raise exception 'Een kassa mag van zijn eigen regel alleen bijhouden dat hij er nog is. Blokkeren en intrekken gebeurt in het dashboard.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_devices_eigen_regel on public.pos_devices;
create trigger pos_devices_eigen_regel before update on public.pos_devices
  for each row execute function public.pos_apparaat_eigen_regel();

-- ===========================================================================
--  De vestigingen zelf beheren
--
--  De vestigingen stonden er wel, maar er was geen enkele manier om er een
--  bij te maken, er een te wijzigen of er een weg te halen. Ze kwamen uit de
--  eerste vulling en daar bleef het bij.
--
--  Drie dingen gebeuren hier:
--
--    1. de vestiging krijgt de gegevens die je van een vestiging wil hebben:
--       e-mailadres, openingstijden, een notitie, en de coordinaten die bij
--       het adres horen
--    2. er komen foto's bij, in een eigen emmer
--    3. wissen wordt afgeschermd -- en dat is het belangrijkste stuk
--
--  Waarom dat derde. Op locations hangen tweeentwintig verwijzingen, en een
--  flink deel daarvan staat op "on delete cascade": installaties, storingen,
--  werkbonnen, onderhoudsschema's, voorraad, overlegkanalen en de kluis.
--  Een vestiging wissen zou die allemaal meenemen zonder een woord. De rest
--  staat op "set null", wat net zo stil is: negentien mensen die opeens geen
--  vestiging meer hebben.
--
--  Dus: de database weigert het, en zegt erbij wat eraan hangt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De vestiging zelf
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists email         text;
alter table public.locations add column if not exists notes         text;

-- Wat de kaartendienst van het adres maakte. geo_label is wat er gevonden is,
-- en dat is met opzet apart van wat er is ingetikt: als die twee uit elkaar
-- lopen wil je dat zien en niet dat de app je adres stilletjes herschrijft.
alter table public.locations add column if not exists lat           double precision;
alter table public.locations add column if not exists lon           double precision;
alter table public.locations add column if not exists geo_label     text;
alter table public.locations add column if not exists geo_at        bigint;

-- {"ma":{"van":"07:00","tot":"18:00"}, "zo":null, ...}  null = dicht
alter table public.locations add column if not exists opening_hours jsonb
  not null default '{}'::jsonb;

-- Waarom een vestiging uit staat. Zonder reden is "actief = false" over een
-- half jaar een raadsel.
alter table public.locations add column if not exists inactive_reason text;
alter table public.locations add column if not exists inactive_at     bigint;

-- ---------------------------------------------------------------------------
--  Wie mag dit?
--
--  Tot nu toe alleen het management. Het recht locations.manage bestond al in
--  de app maar de database keek er niet naar, dus uitdelen had geen effect.
-- ---------------------------------------------------------------------------

create or replace function public.mag_vestigingen_beheren()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('locations.manage');
$$;

grant execute on function public.mag_vestigingen_beheren() to authenticated;

drop policy if exists locations_write on public.locations;
create policy locations_write on public.locations for all to authenticated
  using (public.mag_vestigingen_beheren())
  with check (public.mag_vestigingen_beheren());

-- ---------------------------------------------------------------------------
--  Foto's
--
--  Een eigen tabel en niet een kolom op locations. Er zijn er meer dan een,
--  ze hebben een volgorde en een bijschrift, en een rij met een lijst erin is
--  een rij die je bij elke wijziging in zijn geheel moet overschrijven.
-- ---------------------------------------------------------------------------

create table if not exists public.location_photos (
  id               text primary key,
  location_id      text not null references public.locations(id) on delete cascade,
  storage_path     text not null,
  mime             text not null,
  size_bytes       integer not null default 0,
  width            integer,
  height           integer,
  caption          text,
  sort             integer not null default 0,
  is_cover         boolean not null default false,
  uploaded_by      text,
  uploaded_by_name text,
  uploaded_at      bigint not null default public.now_ms(),
  updated_at       bigint not null default public.now_ms()
);

create index if not exists location_photos_loc_idx
  on public.location_photos (location_id, sort);
create index if not exists location_photos_updated_idx
  on public.location_photos (updated_at);

-- Een vestiging heeft er hoogstens een die vooraan staat. Zonder deze index
-- kun je er twee aanzetten en is het maar net welke de lijst als eerste ziet.
create unique index if not exists location_photos_cover_idx
  on public.location_photos (location_id) where is_cover;

drop trigger if exists stamp_location_photos on public.location_photos;
create trigger stamp_location_photos before insert or update on public.location_photos
  for each row execute function public.stamp_updated_at();

alter table public.location_photos enable row level security;

-- Iedereen die is ingelogd mag ze zien, net als de vestigingen zelf. Het is
-- een foto van een wasstraat langs de snelweg; die staat ook op de website.
drop policy if exists location_photos_select on public.location_photos;
create policy location_photos_select on public.location_photos for select to authenticated
  using (true);

drop policy if exists location_photos_write on public.location_photos;
create policy location_photos_write on public.location_photos for all to authenticated
  using (public.mag_vestigingen_beheren())
  with check (public.mag_vestigingen_beheren());

-- ---------------------------------------------------------------------------
--  De emmer
--
--  Openbaar leesbaar, anders dan de dossiers. Dat is een keuze en geen
--  slordigheid: een foto van een vestiging is geen geheim, en negentien
--  ondertekende adressen ophalen bij elke keer dat het scherm opengaat maakt
--  de lijst traag en offline leeg.
--
--  Schrijven mag alleen wie vestigingen beheert. Openbaar lezen is niet
--  hetzelfde als openbaar volzetten.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vestigingen', 'vestigingen', true, 10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists vestigingen_lezen on storage.objects;
create policy vestigingen_lezen on storage.objects for select to authenticated
  using (bucket_id = 'vestigingen');

drop policy if exists vestigingen_schrijven on storage.objects;
create policy vestigingen_schrijven on storage.objects for insert to authenticated
  with check (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren());

drop policy if exists vestigingen_bijwerken on storage.objects;
create policy vestigingen_bijwerken on storage.objects for update to authenticated
  using (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren())
  with check (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren());

drop policy if exists vestigingen_wissen on storage.objects;
create policy vestigingen_wissen on storage.objects for delete to authenticated
  using (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren());

-- ---------------------------------------------------------------------------
--  Wat hangt er aan deze vestiging?
--
--  Geeft per soort terug hoeveel er zijn. Het scherm gebruikt dit om te
--  vertellen waarom wissen niet kan; de trigger hieronder gebruikt hetzelfde
--  antwoord om het ook echt tegen te houden. Een van de twee zou niet genoeg
--  zijn: een scherm is te omzeilen en een trigger legt niets uit.
-- ---------------------------------------------------------------------------

create or replace function public.vestiging_bezet(loc text)
returns table (wat text, aantal bigint)
language sql stable security definer set search_path = public as $$
  select 'medewerkers'::text, count(*) from public.profiles
   where location_id = loc or loc = any(coalesce(manages, array[]::text[]))
  union all select 'wasbeurten',   count(*) from public.wash_jobs        where location_id = loc
  union all select 'diensten',     count(*) from public.shifts           where location_id = loc
  union all select 'urenregels',   count(*) from public.time_entries     where location_id = loc
  union all select 'installaties', count(*) from public.assets           where location_id = loc
  union all select 'storingen',    count(*) from public.faults           where location_id = loc
  union all select 'werkbonnen',   count(*) from public.work_orders      where location_id = loc
  union all select 'onderhoud',    count(*) from public.maintenance_plans where location_id = loc
  union all select 'voorraad',     count(*) from public.inventory_items  where location_id = loc
  union all select 'kassa''s',     count(*) from public.pos_registers    where location_id = loc
  union all select 'kluisboekingen', count(*) from public.pos_safe_moves where location_id = loc
  union all select 'overlegkanalen', count(*) from public.channels       where location_id = loc
$$;

grant execute on function public.vestiging_bezet(text) to authenticated;

create or replace function public.vestiging_bewaak_wissen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bezet text;
begin
  select string_agg(wat || ': ' || aantal, ', ' order by aantal desc)
    into bezet
    from public.vestiging_bezet(old.id)
   where aantal > 0;

  if bezet is not null then
    raise exception
      'Deze vestiging kan niet weg, er hangt nog van alles aan (%). Zet hem uit in plaats van hem te wissen.',
      bezet
      using errcode = 'foreign_key_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists vestiging_wissen on public.locations;
create trigger vestiging_wissen before delete on public.locations
  for each row execute function public.vestiging_bewaak_wissen();

-- ---------------------------------------------------------------------------
--  Een nieuwe vestiging krijgt een kluis
--
--  0025 gaf elke bestaande vestiging er een. Wie er daarna een aanmaakt hoort
--  er ook een te krijgen, anders staat er bij de eerste afstorting op de
--  kassa geen kluis om in te boeken.
--
--  Het aanmaken gebeurt hier en niet in de app: de app die de vestiging maakt
--  is niet altijd dezelfde als de app die de kassa neerzet.
-- ---------------------------------------------------------------------------

create or replace function public.vestiging_krijgt_kluis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pos_safes (id, location_id, name)
  values ('kluis_' || new.id, new.id, 'Kluis ' || new.name)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists vestiging_kluis on public.locations;
create trigger vestiging_kluis after insert on public.locations
  for each row execute function public.vestiging_krijgt_kluis();

-- ===========================================================================
--  Een foto bij het artikel
--
--  Aan een balie zoek je niet op naam maar op hoe iets eruitziet. Twee flessen
--  ruitenwisservloeistof van hetzelfde merk verschillen in de winter en de
--  zomer een letter in de naam en een kleur op het etiket; wie er de hele dag
--  staat kiest op die kleur, niet op die letter.
--
--  Waarom de foto in de rij staat en niet in een bucket
--  ---------------------------------------------------
--
--  Supabase heeft opslag voor bestanden, en dat is de gewone plek voor een
--  plaatje. Hier niet, om één reden: de kassa moet het zonder internet doen.
--  Een foto achter een URL is een foto die er niet is als de lijn eruit ligt --
--  en dan staat er op het kassascherm een rij grijze vlakken op precies het
--  moment dat het rustig moet blijven werken.
--
--  Een foto in de rij komt mee met dezelfde synchronisatie als de prijs, staat
--  daarna in de lokale cache van elk apparaat, en werkt dus altijd. De prijs
--  daarvan is grootte, en die houden we klein: de kassa verkleint elke foto
--  vóór het opslaan tot een paar tienden van een kilobyte. Zie
--  src/lib/afbeelding.ts in de kassa-app.
--
--  De grens hieronder is de rem daaronder. Zonder die rem zet iemand ooit een
--  foto van vier megabyte in een artikel, en dan sleept elke kassa die bij
--  elke synchronisatie mee.
-- ===========================================================================

alter table public.pos_products
  add column if not exists image text;

/*
 * Een data-URI van maximaal ongeveer 150 kB.
 *
 * Ruim boven wat de kassa maakt (die mikt op 48 kB aan beeldgegevens, wat als
 * base64 zo'n 64 kB wordt), zodat een foto die elders is toegevoegd er ook
 * langs komt. En ruim onder wat een tabel met artikelen zwaar maakt.
 *
 * De controle staat er als NOT VALID: dan geldt hij voor alles wat er vanaf nu
 * in gaat, zonder dat het draaien van deze migratie op een bestaande database
 * kan struikelen over een rij die er al staat. Nieuwe rijen zijn waar het om
 * gaat -- een bestaande te grote foto is een last, geen fout.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pos_products_image_maat'
       and conrelid = 'public.pos_products'::regclass
  ) then
    alter table public.pos_products
      add constraint pos_products_image_maat
      check (image is null or length(image) <= 150000) not valid;
  end if;
end $$;

-- ===========================================================================
--  Een kassa is geen aanmelding
--
--  Toen de eerste kassa met een koppelcode werd gekoppeld, stond hij daarna in
--  het dashboard onder Aanmeldingen -- met een melding aan het management erbij
--  dat er iemand nieuw was. Dat is niet zomaar lelijk: het management moet dan
--  een beslissing nemen over een apparaat dat het zelf heeft aangezet, en een
--  lijst waar dingen in staan die niemand hoeft te beoordelen is een lijst die
--  je op een gegeven moment niet meer opent.
--
--  Waar het vandaan kwam: handle_new_user() draait bij elk nieuw inlogaccount.
--  Vindt hij geen dossier op dat e-mailadres, dan is het volgens hem een
--  aanmelding -- dossier op inactief, rij in signups, seintje naar het
--  management. Dat is precies goed voor een mens die zich meldt.
--
--  Maar de serverfunctie kassa-koppelen maakt ook een inlogaccount aan: elk
--  apparaat krijgt zijn eigen inlog, zodat er geen wachtwoord van een mens op
--  een tablet achter de balie staat. En dat account liep door dezelfde trechter.
--
--  Vanaf nu stapt de trigger daar uit. Het dossier van een apparaat wordt door
--  kassa-koppelen zelf gezet, met is_device erop, en er komt geen aanmelding en
--  geen melding bij.
--
--  Waarom het vlaggetje uit de metagegevens mag komen
--  -------------------------------------------------
--
--  In 0007 staat met nadruk dat rollen niet uit de gegevens van de client
--  worden overgenomen: die zijn niet te vertrouwen. Dat geldt hier ook, en
--  toch mag dit -- omdat deze vlag alleen maar minder kan opleveren.
--
--  Zet iemand bij het aanmelden zelf 'apparaat' in zijn metagegevens, dan
--  krijgt hij geen dossier en geen aanmelding, en dus nergens toegang: geen
--  rollen, geen vestiging, is_staff() onwaar. Hij heeft dan een inlog waarmee
--  je niets kunt. Een vlag die alleen deuren kan sluiten, hoeft niet
--  gecontroleerd te worden.
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing_id text;
  nieuw_id    text;
  aanmelding  text;
  volle_naam  text;
  soort       text;
begin
  /*
   * Een apparaat, geen mens.
   *
   * kassa-koppelen zet in de metagegevens dat dit een kassa is, en zet daarna
   * zelf het dossier neer -- met is_device, met de vestiging en op actief. Hier
   * hoeft dus niets te gebeuren, en er hoort vooral geen aanmelding te komen.
   */
  if coalesce(new.raw_user_meta_data->>'apparaat', '') = 'true' then
    return new;
  end if;

  volle_naam := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(new.email, '@', 1));

  -- 1. Staat er al een dossier klaar op dit e-mailadres? Dan koppelen we dat.
  --    Het management heeft die persoon dus zelf toegevoegd; de rollen die
  --    daar staan gelden, en hij kan meteen aan de slag.
  select id into existing_id
    from public.profiles
   where lower(email) = lower(new.email)
     and auth_id is null
   limit 1;

  if existing_id is not null then
    update public.profiles set auth_id = new.id where id = existing_id;
    return new;
  end if;

  -- 2. Anders is dit een aanmelding. Het dossier komt er wel, maar zonder
  --    rollen en op inactief: een account is nog geen toegang.
  nieuw_id := 'u_' || replace(new.id::text, '-', '');

  insert into public.profiles (id, auth_id, email, name, roles, active, phone, location_id)
  values (
    nieuw_id,
    new.id,
    new.email,
    volle_naam,
    array[]::text[],
    false,
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'location_id', '')), '')
  )
  on conflict (id) do nothing;

  soort := coalesce(new.raw_user_meta_data->>'signup_kind', 'werknemer');
  if soort not in ('werknemer', 'klant') then
    soort := 'werknemer';
  end if;

  aanmelding := 'sg_' || replace(new.id::text, '-', '');

  insert into public.signups (
    id, name, email, phone, kind, company_name, location_id, message,
    status, created_at, auth_id, profile_id)
  values (
    aanmelding,
    volle_naam,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    soort,
    nullif(trim(coalesce(new.raw_user_meta_data->>'company_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'location_id', '')), ''),
    left(coalesce(new.raw_user_meta_data->>'message', ''), 600),
    'nieuw',
    public.now_ms(),
    new.id,
    nieuw_id
  )
  on conflict (id) do nothing;

  -- 3. Het management een seintje geven, zodat de aanmelding niet weken
  --    blijft liggen omdat niemand toevallig op dat tabblad keek.
  insert into public.notifications (
    id, to_role, kind, title, body, from_user_id, from_name, created_at, link)
  values (
    'nt_' || aanmelding,
    'management',
    'taak',
    'Nieuwe aanmelding: ' || volle_naam,
    volle_naam || ' meldt zich aan als ' || soort || ' (' || new.email || ').',
    -- Bewust zonder afzender: dit bericht komt van het systeem, niet van de
    -- aanmelder. Stond zijn eigen id hier, dan zou hij zijn eigen aanmelding
    -- in zijn berichten terugzien -- de regels laten je zien wat je zelf
    -- verstuurt.
    null,
    'Aanmelding',
    public.now_ms(),
    'aanmeldingen'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
--  Opruimen wat er al ligt
--
--  De kassa's die vóór deze migratie gekoppeld zijn, staan als aanmelding in de
--  lijst. Die halen we hier weg -- en niet alleen de aanmelding zelf, ook het
--  seintje eraan, want een melding die naar een aanmelding wijst die niet meer
--  bestaat is erger dan geen melding.
--
--  Herkennen doen we ze aan het vlaggetje op het inlogaccount, en niet aan
--  is_device op het dossier. Dat laatste lijkt logischer maar werkt hier niet:
--  is_device komt er pas op als kassa-koppelen het dossier heeft bijgewerkt, en
--  bij een kassa die halverwege is blijven steken is dat juist niet gebeurd.
--  Het vlaggetje staat er vanaf het moment dat het account gemaakt is.
-- ---------------------------------------------------------------------------

create or replace function public.is_apparaataccount(wie uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select coalesce(u.raw_user_meta_data->>'apparaat', '') = 'true'
       from auth.users u where u.id = wie),
    false);
$$;

delete from public.notifications
 where id in (
   select 'nt_' || s.id from public.signups s
    where s.auth_id is not null and public.is_apparaataccount(s.auth_id)
 );

delete from public.signups s
 where s.auth_id is not null and public.is_apparaataccount(s.auth_id);

-- ---------------------------------------------------------------------------
--  Een apparaat telt niet mee als medewerker
--
--  Dit is de kant die de app niet kan afdwingen. Overal waar in het dashboard
--  mensen worden opgesomd -- personeel, rooster, urenstaat, keuzelijsten --
--  hoort is_device eruit gefilterd te worden. Dat gebeurt in de app, en dat
--  blijft zo: de database weet niet wat een lijst is.
--
--  Wat de database wél kan, is ervoor zorgen dat een apparaat nooit per
--  ongeluk als mens in beeld komt doordat iemand er rollen aan hangt. Een
--  kassa heeft precies één rol nodig -- employee, voor de leesrechten op zijn
--  vestiging -- en verder niets.
-- ---------------------------------------------------------------------------

create or replace function public.apparaat_blijft_apparaat()
returns trigger language plpgsql as $$
begin
  if new.is_device then
    if new.roles is distinct from array['employee']::text[] then
      raise exception
        'Een kassa-account houdt de rol employee en niets anders. Wil je dit een medewerker maken, haal dan eerst is_device eraf.';
    end if;
    if new.manages is not null and array_length(new.manages, 1) > 0 then
      raise exception 'Een kassa-account heeft geen leiding over vestigingen.';
    end if;
    if coalesce(new.all_locations, false) then
      raise exception 'Een kassa-account hoort bij één vestiging, niet bij alle.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_apparaat on public.profiles;
create trigger profiles_apparaat before insert or update on public.profiles
  for each row execute function public.apparaat_blijft_apparaat();

-- ===========================================================================
--  De administratie
--
--  Er is een rol bij gekomen. Wat er goedgekeurd moet worden -- kostenposten,
--  urenwijzigingen, aanpassingen in een dossier, aanmeldingen -- stond in
--  vier verschillende schermen van het managementdashboard. Wie vier lijsten
--  moet openen om te weten of hij klaar is, denkt op een gegeven moment dat
--  hij klaar is.
--
--  Deze migratie doet drie dingen:
--
--    1. de administratie telt mee als personeel (is_staff)
--    2. wie kosten mag goedkeuren, mag ze ook zien en aftekenen -- tot nu toe
--       stond daar alleen "management", en het recht expenses.approve deed
--       in de database dus niets
--    3. er komt een veld bij waar in staat wat er uit een factuur is gelezen
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De administratie is personeel
--
--  is_staff() bepaalt op tientallen plekken of je iets mag zien: het rooster,
--  de wasbeurten, de voorraad, de berichten. Iemand van de administratie is
--  gewoon iemand die hier werkt, dus die hoort erbij.
--
--  Let op wat dit niet doet: het geeft geen enkel recht om iets te wijzigen.
--  Dat staat per tabel apart geregeld, en daar staat management of een
--  specifiek recht.
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee' = any(public.my_roles())
      or 'administratie' = any(public.my_roles())
      or 'management' = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  Wie mag kosten beoordelen
--
--  Het recht expenses.approve bestond al in de app, maar de database keek er
--  niet naar: daar gold alleen is_management(). Je kon het dus uitdelen zonder
--  dat er iets veranderde. Dat is het gevaarlijkste soort recht -- een dat er
--  is en niets doet.
-- ---------------------------------------------------------------------------

create or replace function public.mag_kosten_beslissen()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('expenses.approve');
$$;

grant execute on function public.mag_kosten_beslissen() to authenticated;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (
    public.mag_kosten_beslissen()
    or submitted_by = public.my_id()
  );

/*
 * De insertregel blijft zoals 0022 hem achterliet: rij_bestaat() vooraan,
 * anders valt een bijwerkende upsert over de insertcontrole. Alleen
 * is_management() is vervangen door de nieuwe functie.
 */
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (
    public.rij_bestaat('public.expenses'::regclass, id)
    or public.mag_kosten_beslissen()
    or (public.is_staff() and submitted_by = public.my_id())
  );

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (
    public.mag_kosten_beslissen()
    or (submitted_by = public.my_id() and status = 'open')
  )
  with check (
    public.mag_kosten_beslissen()
    or (submitted_by = public.my_id() and status = 'open')
  );

-- ---------------------------------------------------------------------------
--  Wat er uit de factuur is gelezen
--
--  Een eigen veld, en niet in supplier / amount_excl / vat_pct. Dat is het
--  hele punt: wat de app eruit haalt is een voorstel, wat in die velden staat
--  is wat een mens heeft goedgekeurd. Landen ze op dezelfde plek, dan kun je
--  een jaar later niet meer nagaan wie wat heeft ingevuld -- en dat is
--  precies de vraag die dan gesteld wordt.
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists gelezen jsonb;

/*
 * De uitkomst van het lezen hoort niet met de hand bijgewerkt te worden.
 * Hij komt van de serverfunctie, die met de servicesleutel werkt en dus
 * buiten deze regel valt. Wie hem in de app zou aanpassen, maakt van een
 * verslag een bewering.
 */
create or replace function public.lezing_blijft_lezing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- De serverfunctie schrijft hem; die werkt met de servicesleutel en heeft
  -- dus geen my_id(). Alleen wat uit de app komt wordt teruggezet.
  if public.my_id() is null then return new; end if;

  if new.gelezen is distinct from old.gelezen then
    new.gelezen := old.gelezen;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_lezing on public.expenses;
create trigger expenses_lezing before update on public.expenses
  for each row execute function public.lezing_blijft_lezing();

-- ---------------------------------------------------------------------------
--  Wat de administratie verder moet kunnen zien
--
--  Urenwijzigingen en dossierwijzigingen stonden op "de leidinggevende of
--  het management". De administratie beoordeelt ze ook, dus die komt erbij --
--  via het recht dat er al voor bestaat en niet via de rolnaam. Dan kun je
--  het per persoon dichtzetten zonder dat je de rol hoeft af te pakken.
-- ---------------------------------------------------------------------------

drop policy if exists hr_select on public.hour_requests;
create policy hr_select on public.hour_requests for select to authenticated
  using (
    user_id = public.my_id()
    or public.is_lead()
    or public.heeft_recht('hours.approve')
  );

drop policy if exists hr_update on public.hour_requests;
create policy hr_update on public.hour_requests for update to authenticated
  using (public.is_lead() or public.heeft_recht('hours.approve') or user_id = public.my_id())
  with check (public.is_lead() or public.heeft_recht('hours.approve') or user_id = public.my_id());

/*
 * En de wacht op die tabel moet hem ook als beslisser zien. Zonder dit stukje
 * mag de administratie het verzoek wél openen en wél opslaan, maar zet de
 * trigger de beslissing terug -- en dat is precies het soort stilte waar je
 * een middag aan kwijt bent.
 */
create or replace function public.hr_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null
     or public.is_lead()
     or public.heeft_recht('hours.approve')
  then
    return new;
  end if;

  -- De aanvrager mag precies één ding: zijn eigen verzoek intrekken.
  if new.status = 'ingetrokken'
     and old.status = 'nieuw'
     and old.user_id = public.my_id()
     and new.van is not distinct from old.van
     and new.tot is not distinct from old.tot
  then
    return new;
  end if;

  raise exception 'Over je eigen urenverzoek beslist je leidinggevende';
end;
$$;

-- ===========================================================================
--  Gewone facturen stonden als verdacht in de postbus
--
--  De bijlagecontrole hield een PDF tegen zodra er /OpenAction, /AA,
--  /EmbeddedFile of /RichMedia in stond. Dat leek redelijk en was het niet:
--
--    /OpenAction   staat in bijna elke PDF uit Word, InDesign of LaTeX en zet
--                  meestal alleen de beginweergave
--    /AA           hangt aan de formuliervelden van elke invulbare factuur
--    /EmbeddedFile is juist het kenmerk van een ZUGFeRD- of Factur-X-factuur:
--                  de Europese e-factuur met de gegevens als XML erin
--
--  Gevolg was dubbel. De bijlage ging op slot in het scherm, dus niemand kon
--  de factuur bekijken. En de AI las hem ook niet, want die sloeg alles over
--  wat niet 'schoon' was. Precies bij de bon die aandacht vroeg gebeurde er
--  dus niets, zonder dat iemand zag waarom.
--
--  De controle zelf is aangepast (supabase/functions/ontvang-mail/controle.ts).
--  Maar wat er al is binnengekomen draagt die uitkomst met zich mee, en dat
--  repareert zichzelf niet. Deze migratie haalt de uitkomst weg bij precies
--  die vier redenen -- niet bij alle verdachte bijlagen, want JavaScript en
--  /Launch blijven een reden om iets tegen te houden.
--
--  Zonder uitkomst geldt een bijlage als "van vóór de controle": hij gaat open
--  met een waarschuwing erbij. Dat is wat we willen -- niet stilletjes op
--  schoon zetten, want gecontroleerd is hij niet.
-- ===========================================================================

do $$
declare
  geraakt integer;
begin
  if not exists (select 1 from pg_tables
                  where schemaname = 'public' and tablename = 'mailbox') then
    return;
  end if;

  /*
   * De bijlagen staan als jsonb-array op het bericht. Uitpakken, de regels
   * bijwerken die het betreft, en weer inpakken -- met behoud van de volgorde,
   * want die bepaalt welke bijlage het scherm als eerste toont.
   */
  with geraakte as (
    select
      m.id,
      jsonb_agg(
        case
          when b.waarde ->> 'controle' = 'verdacht'
           and b.waarde ->> 'controleReden' ~ '(OpenAction|automatische actie|ingesloten bestand|ingesloten media|een actie die bij het openen afgaat)'
          then (b.waarde - 'controle' - 'controleReden' - 'controleOp')
               || jsonb_build_object(
                    'controleHersteld',
                    'De bijlagecontrole hield dit bestand eerder tegen om een reden die '
                    || 'niet klopte. Hij is nooit opnieuw nagekeken.')
          else b.waarde
        end
        order by b.volgnr
      ) as nieuw
      from public.mailbox m
      cross join lateral jsonb_array_elements(m.attachments)
                 with ordinality as b(waarde, volgnr)
     where m.attachments is not null
       and jsonb_typeof(m.attachments) = 'array'
     group by m.id
    having bool_or(
      b.waarde ->> 'controle' = 'verdacht'
      and b.waarde ->> 'controleReden' ~ '(OpenAction|automatische actie|ingesloten bestand|ingesloten media|een actie die bij het openen afgaat)'
    )
  )
  update public.mailbox m
     set attachments = g.nieuw
    from geraakte g
   where g.id = m.id;

  get diagnostics geraakt = row_count;
  raise notice 'Bijlagen vrijgegeven op % berichten', geraakt;
end $$;

-- ===========================================================================
--  Bijwerken is nog steeds geen aanmaken
--
--  Migratie 0022 repareerde dit voor expenses, employer_links en agenda_items.
--  Het bleek geen eigenschap van die drie tabellen te zijn maar van de manier
--  waarop de app opslaat, en dus zat het er nog op zes andere.
--
--  Wat er aan de hand is, nog een keer, want het is niet vanzelfsprekend:
--
--  De app stuurt een gewijzigde rij als geheel op, met een upsert. PostgREST
--  maakt daar "insert ... on conflict do update" van. PostgreSQL evalueert bij
--  zo'n opdracht de WITH CHECK van de INSERT-regel, óók als de rij allang
--  bestaat en er alleen wordt bijgewerkt.
--
--  Staat er in die insertregel iets over eigendom -- "je mag alleen namens
--  jezelf melden" -- dan klopt dat bij het aanmaken en klopt het niet meer
--  zodra iemand anders de rij bijwerkt. De ontwikkelaar die een melding
--  afhandelt is niet de melder. De leidinggevende die een wijzigingsverzoek
--  goedkeurt is niet de aanvrager. En de status is dan geen 'open' meer.
--
--  Het gevolg is een foutmelding die over rechten gaat terwijl er niets mis
--  is met de rechten, en een wijziging die in de wachtrij blijft staan.
--
--  De oplossing is dezelfde als in 0022: bestaat de rij al, dan is dit geen
--  aanmaken en gaat de insertregel opzij. Wat er dan wél mag, bepaalt de
--  updateregel -- en die staat er al, ongewijzigd. Er gaat dus geen deur
--  open die dicht hoorde te zijn; de deur die dicht zat was de verkeerde.
--
--  Niet aangeraakt: pos_safe_moves. Daar kan dit niet gebeuren, want een
--  kluisboeking wordt nooit bijgewerkt -- er staat een trigger op die dat
--  weigert. Wat niet wordt bijgewerkt, kan niet over deze val struikelen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Meldingen
--
--  Dit is de fout die gemeld werd. De ontwikkelaar die een melding oppakt,
--  van status verandert of er een reactie op zet, is niet degene die hem heeft
--  gemaakt -- en de insertregel eist dat wel.
-- ---------------------------------------------------------------------------

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (
    public.rij_bestaat('public.tickets'::regclass, id)
    or reported_by = public.my_id()
  );

drop policy if exists messages_insert on public.ticket_messages;
create policy messages_insert on public.ticket_messages for insert to authenticated
  with check (
    public.rij_bestaat('public.ticket_messages'::regclass, id)
    or (
      author_id = public.my_id()
      and (
        public.is_developer()
        or exists (
          select 1 from public.tickets t
           where t.id = ticket_id and t.reported_by = public.my_id()
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Wijzigingsverzoeken op een dossier
--
--  Deze was gegarandeerd stuk en het is nooit gemeld. De insertregel eist
--  status = 'open' én dat jij de aanvrager bent. Op het moment dat iemand het
--  verzoek goedkeurt is de status geen 'open' meer en is de beslisser niet de
--  aanvrager -- dus faalt precies de handeling waar het verzoek voor bestaat.
-- ---------------------------------------------------------------------------

drop policy if exists cr_insert on public.change_requests;
create policy cr_insert on public.change_requests for insert to authenticated
  with check (
    public.rij_bestaat('public.change_requests'::regclass, id)
    or (
      public.is_lead()
      and aangevraagd_door = public.my_id()
      and status = 'open'
    )
  );

-- ---------------------------------------------------------------------------
--  Werkgevers
--
--  Zelfde verhaal: een aanvraag komt binnen met status 'aangevraagd' op naam
--  van de aanvrager. Zodra het management hem goedkeurt klopt geen van beide
--  voorwaarden meer.
-- ---------------------------------------------------------------------------

drop policy if exists wg_insert on public.employers;
create policy wg_insert on public.employers for insert to authenticated
  with check (
    public.rij_bestaat('public.employers'::regclass, id)
    or public.is_management()
    or (status = 'aangevraagd' and aangevraagd_door = public.my_id())
  );

-- ---------------------------------------------------------------------------
--  Overleg
--
--  Een bericht bijwerken -- een correctie, of het weghalen door iemand die
--  mag modereren -- struikelt over "author_id = mijn id". Een kanaal
--  bijwerken struikelt over de voorwaarden waaronder je er een mag aanmaken.
-- ---------------------------------------------------------------------------

drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (
    public.rij_bestaat('public.chat_messages'::regclass, id)
    or (
      public.is_staff()
      and author_id = public.my_id()
      and public.can_see_channel(channel_id)
    )
  );

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (
    public.rij_bestaat('public.channels'::regclass, id)
    or (
      public.is_staff()
      and (
        public.is_management()
        or public.is_supervisor()
        or (kind = 'gesprek' and public.my_id() = any(member_ids))
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Opleiding
--
--  De minst waarschijnlijke van het stel -- een leidinggevende valt al onder
--  is_lead() -- maar de val zit er wel, en hem hier laten zitten betekent dat
--  iemand er over een half jaar opnieuw achter komt.
-- ---------------------------------------------------------------------------

drop policy if exists progress_insert on public.course_progress;
create policy progress_insert on public.course_progress for insert to authenticated
  with check (
    public.rij_bestaat('public.course_progress'::regclass, id)
    or user_id = public.my_id()
    or public.is_lead()
  );

-- ===========================================================================
--  Wat weg is, moet ook wegblijven
--
--  Een gewiste medewerker bleef in elk apparaat staan. Niet als restje in de
--  database -- daar was hij echt weg -- maar in de kopie die elke app lokaal
--  bijhoudt. Gevolg: hij stond nog in de personeelslijst, en je kon hem niet
--  opnieuw aanmaken omdat de dubbelcontrole hem daar zag staan.
--
--  Waarom dat gebeurde
--  -------------------
--
--  De app haalt wijzigingen op met "geef me alles wat is veranderd sinds
--  <tijdstip>" en zet die er lokaal overheen. Dat werkt voor nieuwe en
--  gewijzigde rijen, en het kan per definitie niet werken voor verwijderde
--  rijen: een rij die er niet meer is, komt niet mee in een lijst van rijen
--  die er wel zijn. Er was dus geen enkele manier waarop een apparaat kon
--  wéten dat er iets was weggehaald.
--
--  Dit is geen fout in één functie maar een gat in de opzet. Het raakt elke
--  harde verwijdering, niet alleen die van een medewerker.
--
--  De oplossing
--  ------------
--
--  Er was al een deletion_log -- die bestond om te kunnen navertellen wie wat
--  wanneer heeft gewist. Alleen stond er niet in wélke rij het betrof, dus je
--  kon er niets mee opruimen. Met die twee velden erbij wordt hij tegelijk de
--  lijst waaraan de apps kunnen zien wat ze moeten weggooien.
--
--  Bewust geen "verwijderd"-vlaggetje op de rij zelf. Dan blijft een gewist
--  personeelsdossier met BSN en rekeningnummer gewoon staan, en dat is precies
--  wat wissen niet moet zijn.
-- ===========================================================================

alter table public.deletion_log add column if not exists tabel     text;
alter table public.deletion_log add column if not exists record_id text;

create index if not exists deletion_log_record_idx
  on public.deletion_log (tabel, record_id);

/*
 * De oude regels weten niet welke rij het was; die zijn geschreven voordat
 * deze kolommen bestonden. Voor medewerkers valt dat te herstellen: het
 * dossier-id is niet bewaard, maar de naam wel, en de app kan daar niets mee.
 *
 * Dus laten we ze leeg. Een lege waarde betekent "onbekend, sla over", en dat
 * is eerlijker dan iets verzinnen. De apparaten die nu een spook hebben staan
 * ruimen dat op bij de eerstvolgende volledige verversing.
 */

comment on column public.deletion_log.tabel is
  'Welke tabel de rij in stond, in de naamgeving van de app (users, expenses, ...). Leeg bij regels van vóór deze migratie.';
comment on column public.deletion_log.record_id is
  'Het id van de rij die is weggehaald, zodat elk apparaat weet wat het lokaal moet weggooien.';

-- ---------------------------------------------------------------------------
--  Wie mag dit lezen
--
--  Iedereen die is ingelogd. Er staat niets gevoeligs in -- een naam, een
--  personeelsnummer en een reden -- en elk apparaat moet kunnen ophalen wat er
--  is weggehaald. Zonder leesrecht blijft het spook staan, en dan lost deze
--  migratie niets op.
--
--  Schrijven blijft bij het management, zoals het al was.
-- ---------------------------------------------------------------------------

drop policy if exists deletion_log_select on public.deletion_log;
create policy deletion_log_select on public.deletion_log for select to authenticated
  using (true);

-- ===========================================================================
--  De vestiging vult de website
--
--  De vestigingen staan in de app: adres, telefoon, openingstijden, foto's,
--  het aantal wasstraten. Op de website staan dezelfde achttien vestigingen
--  nog een keer, met de hand geschreven, in gegenereerde HTML.
--
--  Dat is één keer bijhouden te veel. Verhuist een vestiging of gaat er een
--  uur af op zaterdag, dan klopt de ene plek en de andere niet -- en de plek
--  die niet klopt is precies de plek waar de chauffeur kijkt.
--
--  Hier komen de velden bij die een openbare pagina nodig heeft en die er nog
--  niet waren. De rest -- adres, openingstijden, foto's -- staat er al sinds
--  0026.
--
--  Wat hier NIET gebeurt
--  ---------------------
--
--  De dienstenlijst van de app (buitenwas, cabine binnen, combi,
--  tankreiniging, polijsten) blijft ongemoeid. Dat is wat de wasstraat boekt
--  en afrekent, en dat type wordt letterlijk naar de kassa-repo gekopieerd --
--  daar iets aan veranderen raakt negentien kassa's.
--
--  Wat je verkoopt is een andere lijst en langer: veertien, met truckparking,
--  catering, HACCP en de wasboxen erbij. Die krijgt een eigen veld.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Welke pagina op de website hoort hierbij
--
--  Expliciet, en niet op naam raden. De site heeft vaste paden (/locaties/
--  utrecht/), de app heeft namen die iemand kan wijzigen. Koppelen op naam
--  betekent dat één hernoeming een pagina breekt zonder dat iemand het ziet.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists website_slug text;

-- Twee vestigingen op dezelfde pagina kan niet: dan is het maar net welke de
-- lijst als eerste ziet, en dat verschilt per keer.
create unique index if not exists locations_slug_idx
  on public.locations (website_slug) where website_slug is not null;

-- ---------------------------------------------------------------------------
--  De tekst op de pagina
--
--  Drie soorten, want ze horen op verschillende plekken en hebben een
--  verschillend publiek:
--
--    intro       de alinea bovenaan de pagina -- waarom je hier komt
--    bereikbaar  hoe je er komt: de afrit, de oprit, waar de ingang zit.
--                Dit is het stukje waar een chauffeur die er nog nooit is
--                geweest werkelijk iets aan heeft.
--    bijzonder   wat hier anders is dan elders. Mag leeg blijven.
--
--  Losse velden en geen groot tekstvak: dan staat op elke pagina hetzelfde
--  soort informatie op dezelfde plek, en hoeft niemand na te denken over
--  opmaak.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists intro      text;
alter table public.locations add column if not exists bereikbaar text;
alter table public.locations add column if not exists bijzonder  text;

-- ---------------------------------------------------------------------------
--  Wat kan hier
--
--  De sleutels komen overeen met de mappen op de website, zodat de pagina
--  rechtstreeks kan doorlinken naar de dienst. Vandaar de streepjes.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists diensten text[] not null default '{}';

comment on column public.locations.diensten is
  'Sleutels van de diensten op de website: alcoa-velgen-reinigen, bus-wasstraat, '
  'camper-wasstraat, catering-op-locatie, haal-en-brengservice, '
  'haccp-certificaat-en-behandeling, interieur-reinigen, nao-wasplaats, '
  'truck-shop, truckparking, vogelgriep, vrachtwagen-polijsten, wasboxen, '
  'wegrestaurant-a2. Los van SERVICES in de app -- dat is wat de kassa boekt.';

-- ---------------------------------------------------------------------------
--  Hoort deze vestiging op de website
--
--  Niet elke vestiging is een publiek adres. Het hoofdkantoor hoort er niet
--  op, en een locatie die net is aangekocht ook nog niet. Standaard uit, want
--  per ongeluk iets publiceren is erger dan per ongeluk iets weglaten.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists op_website boolean not null default false;

-- ---------------------------------------------------------------------------
--  Wat er publiek te zien is
--
--  Een openbare bezoeker heeft geen inlog, dus die kan de tabel locations niet
--  lezen -- en dat hoort ook zo: daar staat de vestigingsmanager in, de
--  interne notitie en welke vestigingen uit staan.
--
--  Deze functie geeft precies de velden terug die op een openbare pagina
--  horen, en alleen van vestigingen die daarvoor zijn aangewezen. Zo staat op
--  één plek in de database wat er naar buiten mag, en niet verspreid over de
--  code die het opvraagt.
-- ---------------------------------------------------------------------------

/*
 * Eerst weg, dan opnieuw -- en niet "create or replace".
 *
 * Postgres weigert een vervanging zodra de teruggegeven kolommen veranderen:
 * "cannot change return type of existing function". Dat is precies wat er
 * gebeurde toen 0035 er een kolom bij zette. Bij de eerste keer draaien merk
 * je dat niet; bij de TWEEDE keer wel, want dan komt dit bestand langs terwijl
 * de functie al de nieuwe vorm heeft, en dan valt supabase/bijwerken.sql
 * halverwege om. En dat bestand belooft juist dat opnieuw draaien altijd mag.
 */
drop function if exists public.website_vestigingen();

create function public.website_vestigingen()
returns table (
  slug        text,
  naam        text,
  adres       text,
  postcode    text,
  plaats      text,
  telefoon    text,
  email       text,
  lat         double precision,
  lon         double precision,
  wasstraten  integer,
  openingstijden jsonb,
  intro       text,
  bereikbaar  text,
  bijzonder   text,
  diensten    text[]
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * Hoeveel mensen er werken.
 *
 * Voor de vacaturepagina: "sluit je aan bij de andere zoveel". Eén getal, en
 * verder niets -- geen namen, geen verdeling over vestigingen. Dat laatste is
 * een landkaart van waar het bedrijf dun bezet is.
 *
 * Apparaten tellen niet mee. Een kassa is geen collega.
 */
create or replace function public.website_aantal_medewerkers()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.profiles
   where active
     and not coalesce(is_device, false)
     and archived_at is null
     and 'customer' <> all(coalesce(roles, array[]::text[]))
     and 'employer' <> all(coalesce(roles, array[]::text[]));
$$;

/*
 * Uitvoerrecht.
 *
 * Eerst intrekken, dan uitdelen -- en die volgorde is het hele punt.
 *
 * Postgres geeft het uitvoerrecht op een nieuwe functie uit zichzelf aan
 * PUBLIC. Alleen "grant to service_role" laat die standaard gewoon staan:
 * iedereen kan de functie dan aanroepen. En omdat het security definer-
 * functies zijn, stapt zo'n aanroep dwars door de beveiligingsregels op
 * locations en profiles heen. Dat is het omgekeerde van wat hierboven staat.
 *
 * Waarom anon en authenticated er apart bij staan
 * -----------------------------------------------
 *
 * Omdat "revoke from public" ze op Supabase NIET raakt. Supabase zet in elk
 * project een standaardregel klaar:
 *
 *   alter default privileges in schema public
 *     grant execute on functions to anon, authenticated, service_role;
 *
 * Daardoor krijgt elke nieuwe functie een EIGEN recht voor anon en
 * authenticated, en niet een recht via PUBLIC. Intrekken bij PUBLIC haalt die
 * eigen rechten er niet af. Gemeten op de echte database:
 *
 *   anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
 *
 * De eerste versie van deze migratie trok alleen bij PUBLIC in en leek te
 * werken, want in de test (PGlite) bestaat die standaardregel niet en erft
 * anon wél via PUBLIC. De test stond groen en het gat stond open. De stub in
 * scripts/sqltest.mjs bootst die regel nu na, zodat dit verschil niet meer
 * tussen wal en schip valt.
 *
 * De website haalt dit op via een serverfunctie met de servicesleutel. Anon
 * uitvoerrecht geven kan later alsnog, maar dan als besluit en niet als
 * bijvangst van een standaardinstelling.
 */
revoke execute on function public.website_vestigingen()        from public, anon, authenticated;
revoke execute on function public.website_aantal_medewerkers() from public, anon, authenticated;

grant execute on function public.website_vestigingen() to service_role;
grant execute on function public.website_aantal_medewerkers() to service_role;

-- ===========================================================================
--  Anon hoort hier niet bij te kunnen
--
--  Aanleiding: bij het nameten van 0033 bleek dat een bezoeker zonder inlog,
--  met alleen de publieke sleutel, twee functies kon aanroepen die daar niet
--  voor bedoeld zijn. Gemeten via de REST-laag, zonder enige sessie:
--
--    POST /rest/v1/rpc/pos_kluis_saldo  {"kluis":"..."}   -> 200, een bedrag
--    POST /rest/v1/rpc/vestiging_bezet  {"loc":"..."}     -> 200, een lijst
--
--  Dat is geen bewuste keuze geweest. In 0025 en 0026 staat letterlijk:
--
--    grant execute on function public.pos_kluis_saldo(text)  to authenticated;
--    grant execute on function public.vestiging_bezet(text)  to authenticated;
--
--  "to authenticated" betekent: ingelogd, en verder niemand. Maar Supabase
--  zet in elk project deze standaardregel klaar:
--
--    alter default privileges in schema public
--      grant execute on functions to anon, authenticated, service_role;
--
--  Daardoor krijgt elke nieuwe functie er anon gratis bij. De grant erna
--  bevestigt alleen wat er al stond; hij neemt niets weg. Deze migratie laat
--  de code dus doen wat er al stond -- ze verandert geen bedoeling.
--
--  Waarom dit veilig is
--  --------------------
--
--  Beide functies zijn security definer: ze draaien met de rechten van de
--  eigenaar en stappen dwars door de regels op de onderliggende tabellen
--  heen. Precies daarom moet de deur ervoor kloppen.
--
--  Nagekeken voordat dit werd ingetrokken:
--
--    - Geen van beide komt voor in een beveiligingsregel (using / with check).
--      Zat er wel een in, dan zou intrekken bij anon elke anonieme aanvraag op
--      die tabel een foutmelding geven in plaats van een lege lijst.
--    - Geen van beide apps roept ze aan. De enige rpc-aanroep in het dashboard
--      en de kassa samen is server_time_ms.
--    - vestiging_bezet wordt wel gebruikt binnen een trigger (0026, regel
--      196). Een trigger draait onder de eigenaar en heeft dit recht niet
--      nodig.
--
--  authenticated houdt zijn recht. Alleen anon gaat eraf.
--
--  LET OP: pos_kluis_saldo hoort bij de kassa (0025). Dit raakt geen enkele
--  regel van die functie zelf -- alleen wie hem mag aanroepen, en dat wordt
--  wat er in 0025 al als bedoeling staat.
-- ===========================================================================

-- Waarom PUBLIC er ook bij staat, en niet alleen anon
-- --------------------------------------------------
--
-- Er zitten twee rechten op deze functies, en je moet ze allebei weghalen:
--
--   =X/postgres        het recht van PUBLIC -- van Postgres zelf
--   anon=X/postgres    het eigen recht van anon -- van Supabase' standaardregel
--
-- anon is lid van PUBLIC. Trek je alleen het eigen recht in, dan kan anon het
-- nog steeds via PUBLIC. Trek je alleen bij PUBLIC in, dan kan anon het nog
-- steeds via zijn eigen recht. Precies die eerste helft ging in de eerste
-- versie van 0033 mis, en de tweede helft in de eerste versie van dit
-- bestand. Allebei betrapt door de controle in scripts/sqltest.mjs.
--
-- authenticated raakt zijn recht via PUBLIC hier ook kwijt, en krijgt het
-- daarom hieronder expliciet terug. Dat is meteen netter: dan staat er in de
-- rechten wie het mag in plaats van "iedereen behalve".

revoke execute on function public.pos_kluis_saldo(text) from public, anon;
revoke execute on function public.vestiging_bezet(text) from public, anon;

-- En teruggeven wat de bedoeling was, zodat opnieuw draaien altijd mag.
grant execute on function public.pos_kluis_saldo(text) to authenticated;
grant execute on function public.vestiging_bezet(text) to authenticated;

-- ===========================================================================
--  De achttien vestigingen komen naar binnen
--
--  Tot nu toe stonden de vestigingen op twee plekken, en geen van beide was
--  compleet. De app kende er twee -- het hoofdkantoor en een proefinvoer met
--  het adres "kasweg 2112". De website kende er achttien, met echte adressen,
--  telefoonnummers en openingstijden, maar die stonden in met de hand
--  geschreven HTML.
--
--  Vanaf hier is de app de bron. Deze migratie zet de achttien erin, precies
--  zoals ze op de site staan, zodat de site er daarna hetzelfde uitziet en
--  alleen zijn gegevens ergens anders vandaan haalt. Wie voortaan een adres
--  wijzigt of een uur van zaterdag afhaalt, doet dat op een plek.
--
--  Waar de gegevens vandaan komen
--  ------------------------------
--
--  Uit bouw/site.json van het merksiteproject. Dat bestand is destijds van
--  truckwash1group.nl geschraapt en is de bron waaruit de achttien
--  vestigingspagina's worden gegenereerd. Adres, postcode, plaats, telefoon,
--  e-mail, coordinaten, openingstijden, de introtekst en de routebeschrijving
--  zijn een-op-een overgenomen.
--
--  Wat NIET is overgenomen, en waarom
--  ----------------------------------
--
--    het aantal wasstraten   staat nergens op de site. Elke vestiging krijgt
--                            de standaardwaarde. Dit is het enige veld dat
--                            met de hand moet worden nagelopen, en tot dat
--                            gebeurd is hoort het niet op de site te staan.
--
--    de foto's               de site verwijst naar afbeeldingen op
--                            truckwash1group.nl. Die kopieren hoort bij het
--                            fotoscherm van de vestiging, niet bij een
--                            migratie.
--
--  Opnieuw draaien mag
--  -------------------
--
--  "on conflict do nothing", en niet "do update". Dat is met opzet: dit
--  bestand komt in supabase/bijwerken.sql terecht, en dat mag altijd opnieuw.
--  Met "do update" zou een tweede keer draaien alles terugzetten naar wat de
--  site ooit zei -- en daarmee elke wijziging wissen die daarna in de app is
--  gemaakt. Een importmigratie hoort een keer te importeren en zich daarna
--  stil te houden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De punten op de vestigingspagina
--
--  Per vestiging staat er een lijstje op de site: "500 meter vanaf Flora
--  Holland", "Handwash met spons", "Haal en brengservice". Dat is geen
--  dienstenlijst maar het rijtje redenen om juist hier te stoppen, en het
--  verschilt echt per vestiging -- van de achttien lijsten zijn er twaalf
--  verschillend.
--
--  Los van de kolom diensten. Die bevat sleutels die naar een dienstpagina
--  wijzen; dit is vrije tekst die alleen op deze pagina staat.
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists punten text[] not null default '{}';

comment on column public.locations.punten is
  'Opsomming op de vestigingspagina van de website. Vrije tekst, een regel per '
  'punt. Los van de kolom diensten -- dat zijn sleutels naar een dienstpagina.';

-- ---------------------------------------------------------------------------
--  De achttien
-- ---------------------------------------------------------------------------

insert into public.locations (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  opening_hours, website_slug, intro, bereikbaar, bijzonder, diensten, punten,
  kind, active, op_website
)
select
  v.id, v.code, v.name, v.address, v.postcode, v.city, v.phone, v.email,
  v.lat, v.lon, v.opening_hours, v.website_slug, v.intro, v.bereikbaar,
  v.bijzonder, v.diensten, v.punten,
  'vestiging', true, true
from (values
  ('loc_aalsmeer', 'TW-AAL', 'Truckwash Aalsmeer', 'Afmijnstraat 4', '1187 ZZ', 'Amstelveen', '0203035112', 'aalsmeer@truckwash1group.nl', 52.2606023, 4.7997808, '{"ma":{"van":"07:00","tot":"19:00"},"di":{"van":"07:00","tot":"19:00"},"wo":{"van":"07:00","tot":"19:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"15:00"},"zo":null}'::jsonb, 'aalsmeer', 'Je vindt Truckwash 1 Aalsmeer op het bedrijventerrein Greenpoort aan de Afmijnstraat 4 in Amstelveen, langs de N201. Truckwash Aalsmeer is vanaf de A4 makkelijk te bereiken.', 'Vanuit Amsterdam neem je afslag 3 richting Hoofddorp en vervolgens via de N201. Vanuit Den Haag neem je ook afslag 3 richting Aalsmeer en vervolgens via de N201.', null, array['alcoa-velgen-reinigen', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['500 meter vanaf Flora Holland bloemenveiling', '5 minuten vanaf Schiphol Airport', '8 minuten vanaf snelweg A4', 'Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren']::text[]),
  ('loc_amsterdam', 'TW-AMS', 'Truckwash Amsterdam', 'Galwin 4', '1046AW', 'Amsterdam', '0203035135', 'amsterdam@truckwash1group.nl', 52.3956631, 4.8003185, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'amsterdam', 'Welkom bij Truckwash 1 Amsterdam, dé toonaangevende bestemming voor het grondig reinigen van vrachtwagens. Je vindt onze wasstraat aan Galwin 4 op bedrijventerrein Sloterdijk, nabij industriewijk Westpoort. Vanaf de A5 neem je afslag 3 Amsterdam-Westpoort.', 'Met twee moderne wasstraten is Truckwash 1 Amsterdam perfect uitgerust voor het reinigen van alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan strenge normen en maken gebruik van de nieuwste reinigingsprogramma’s, waardoor je voertuig weer in optimale staat wordt gebracht. Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je een kop koffie nuttigen in de wachtruimte.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_asten', 'TW-AST', 'Truckwash Asten', 'Nobisweg 5', '5721 VA', 'Asten', '+31(0)493 670242', 'asten@truckwash1group.nl', 51.4162996, 5.7567305, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"14:00"},"zo":null}'::jsonb, 'asten', 'Je vindt Truckwash 1 Asten direct langs de A67 in Asten, op het terrein van truckstop Nobis aan de Nobisweg 5.', 'Truckwash 1 Asten beschikt over 2 professionele wasstraten, geschikt voor alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan de hoogste eisen en beschikken over de modernste reinigingsprogramma’s om jou wagen weer spik en span te maken.', null, array['alcoa-velgen-reinigen']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Velgen reinigen', 'Alcoa reiniging', 'Velgen reiniging', 'Zuren / Ontvetten', 'Wassen met spons']::text[]),
  ('loc_bodegraven', 'TW-BOD', 'Truckwash Bodegraven', 'Europaweg 1e', '2411 NE', 'Bodegraven', '0172619499', 'bodegraven@truckwash1group.nl', 52.0698105, 4.7445157, '{"ma":{"van":"08:00","tot":"19:00"},"di":{"van":"08:00","tot":"19:00"},"wo":{"van":"08:00","tot":"19:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"13:00"},"zo":null}'::jsonb, 'bodegraven', 'Je vindt Truckwash 1 Bodegraven op het bedrijven terrein Broekvelden aan de Europaweg 1e in Bodegraven, naast Goedhart Motoren. Truckwash Bodegraven is het beste te bereiken vanaf de A12 afslag 12a of afslag 12 Reeuwijk of vanaf de N11 afslag Bodegraven. Truckwash Bodegraven beschikt over 3 moderne wasstraten waarvan 1 LZV straat.', 'Twee straten zijn voorzien van een onderwasser voor de onderkant van jouw wagen. Elke straat is voorzien van een warmwatercleaner zodat we in elke hal de trailer inwendig kunnen reinigen. Door de drie straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_hazeldonk', 'TW-HAZ', 'Truckwash Hazeldonk', 'Hazeldonk 6005', '4836 LA', 'Breda', '076 596 3278', 'breda@truckwash1group.nl', 51.4902708, 4.7441562, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"12:00"},"zo":null}'::jsonb, 'hazeldonk', 'Truckwash 1 Hazeldonk is gevestigd in de voormalige Truckwash Hazeldonk locatie aan de Hazeldonk 6005, naast de Q8.
De Truckwash 1 locatie ligt strategisch gelegen aan de A16, bij de grens tussen België en Nederland.', 'De Truckwash wordt compleet gerenoveerd en krijgt een nieuwe machine, en word ingericht op de mogelijkheid om te kunnen voorwassen zodat het proces efficiënt verloopt.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling']::text[], array['We zullen van Maandag t/m Zaterdag geopend zijn', 'We accepteren alle betaalmogelijkheden die u van ons gewend bent', 'We bieden speciale behandelingen aan zoals een alcoa behandeling', 'Chauffeurs kunnen sparen voor leuke truck accessoires', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging', 'HACCP reiniging']::text[]),
  ('loc_doetinchem', 'TW-DOE', 'Truckwash Doetinchem', 'Braamtseweg 10', '7007 CK', 'Doetinchem', '088-0600 100', 'doetinchem@truckwash1group.nl', 51.9463034, 6.2834481, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'doetinchem', 'De nieuwe vestiging in Doetinchem ligt direct aan de A18 (afslag 3), een van de belangrijkste oost-westas voor het vrachtverkeer in de Achterhoek en het grensgebied met Duitsland. De locatie is daarmee ideaal bereikbaar voor transporteurs die rijden op de corridors richting het Ruhrgebied, Münster en verder.', 'Route plannen 
 Openingstijden 
 Vandaag geopend van 08.00 - 18.00', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_ede', 'TW-EDE', 'Truckwash Ede', 'Francis Baconstraat 2', '6718 XA', 'Ede', '0318452282', 'ede@truckwash1group.nl', 52.0356369, 5.6076683, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'ede', 'Je vindt Truckwash 1 Ede op het bedrijventerrein BT A12 op een A locatie op nog geen 5 minuten van de A12 (knooppunt Maanderbroek), en maar 2 minuten van de afslag 1 van de A30 (achter het Plantion).', 'Truckwash Ede beschikt over 2 moderne wasstraten en in 1 straat een onderwas voor de onderkant van jouw wagen. Door de twee straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'vogelgriep']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Bodemreiniging', 'Vogelgriep reiniging en desinfectie', 'Haal en brengservice (informeer contactpersoon)']::text[]),
  ('loc_eindhoven', 'TW-EIN', 'Truckwash Eindhoven', 'Het Schakelplein 30', '5651 GR', 'Eindhoven', '+31 (0) 40 262 02 22', 'eindhoven@truckwash1group.nl', 51.4659684, 5.4186163, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"12:00"},"zo":null}'::jsonb, 'eindhoven', 'Je vindt Truckwash 1 Eindhoven vlak bij de A2 (afrit 29, Eindhoven Airport/acht) en Eindhoven Airport (volg de N2). Op het bedrijventerrein Eindhoven-acht.', 'Truckwash 1 Eindhoven beschikt over 3 moderne wasstraten, speciaal voor vrachtwagens en bestelwagens, die voldoen aan de hoogste eisen. Kan je bedrijfswagen weer een wasbeurt gebruiken? Rij dan door de modernste wasstraat van Eindhoven en terwijl je wagen wordt gewassen, kun je een gratis kopje koffie halen bij ons restaurant. Of je nu het chassis, de buitenzijde of de binnenkant van de oplegger wilt laten reinigen: bij ons is (bijna) alles mogelijk. Onze wasstraat is bijzonder milieuvriendelijk.', null, array['alcoa-velgen-reinigen', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Alcoa reiniging', 'HACCP reiniging', 'Velgen reiniging']::text[]),
  ('loc_groenlo', 'TW-GRO', 'Truckwash Groenlo', 'Noordgang 8', '7141JP', 'Groenlo', '0544745006', 'groenlo@truckwash1group.nl', 52.0616814, 6.6250053, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"14:00"},"zo":null}'::jsonb, 'groenlo', 'Truckwash 1 Groenlo is uitstekend bereikbaar via de N18 (Twenteroute) en vormt een logische stop voor chauffeurs in de Achterhoek en richting Duitsland. Dankzij de ligging vlak bij deze hoofdroute ben je snel van de weg af en eenvoudig weer onderweg.', 'Route plannen 
 Openingstijden 
 Vandaag geopend van 08.00 - 18.00', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_holten', 'TW-HOL', 'Truckwash Holten', 'Handelsweg 34', '7451PJ', 'Holten', '0548855574', 'holten@truckwash1group.nl', 52.2755805, 6.4011927, '{"ma":{"van":"07:00","tot":"18:00"},"di":{"van":"07:00","tot":"18:00"},"wo":{"van":"07:00","tot":"18:00"},"do":{"van":"07:00","tot":"18:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"13:00"},"zo":null}'::jsonb, 'holten', 'Welkom bij Truckwash 1 Holten, dé toonaangevende bestemming in Twente voor het grondig reinigen van vrachtwagens. Je vindt onze vrachtwagen wasstraat aan de Handelsweg 34, aan de N332.', 'Truckwash 1 Holten is uitgerust met maar liefst 5 banen. Drie moderne wasstraten voor het reinigen van alle soorten vrachtwagens en bestelwagens. Daarnaast hebben we nog twee plaatsen voor het uitspuiten van de binnenkant. Onze wasstraten voldoen aan strenge normen en maken gebruik van effectieve reinigingsprogramma’s, waardoor je voertuig weer in optimale staat wordt gebracht. Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je in onze wachtruimte genieten van een kop koffie.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_maasvlakte', 'TW-MAA', 'Truckwash Maasvlakte', 'Luzonstraat 10', '3199 KX', 'Maasvlakte', '0181 44 25 60', 'maasvlakte@truckwash1group.nl', 51.9276713, 4.023263, '{"ma":{"van":"08:00","tot":"21:00"},"di":{"van":"08:00","tot":"21:00"},"wo":{"van":"08:00","tot":"21:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'maasvlakte', 'Je vindt Truckwash 1 Maasvlakte op de Maasvlakte Plaza in Rotterdam aan de Luzonstraat 10. Truckwash Maasvlakte is de grootste Truckwash van Europa en is het beste te bereiken via de A15 naar de N15. Naast ons terrein zit de Maasvlakte Plaza, chauffeur restaurant genaamd Routiers, en de Maasvlakte Plaza Truckparking.', 'Truckwash 1 Maasvlakte beschikt over 6 wasstraten. Door de vier straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum.', 'Op zondag alleen op afspraak.', array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'truckparking', 'wegrestaurant-a2']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_rilland', 'TW-RIL', 'Truckwash Rilland', 'De Poort 24a', '4411PA', 'Rilland', '0113560028', 'rilland@truckwash1group.nl', 51.4222148, 4.1914538, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'rilland', 'Je vindt Truckwash 1 Rilland op het bedrijventerrein De Poort, naast het tankstation De Meeuw. Onze locatie is het best te bereiken via de A58. We zijn gevestigd op De Poort 24a.', 'We beschikken over 2 moderne wasstraten en 1 hal in het midden die gebruikt kan worden voor het inwendig reinigen van trailers en/of zelfservice.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_roosendaal', 'TW-ROO', 'Truckwash Roosendaal', 'Stepvelden 23', '4704RM', 'Roosendaal', '0165529496', 'roosendaal@truckwash1group.nl', 51.5539283, 4.4635791, '{"ma":{"van":"07:00","tot":"21:00"},"di":{"van":"07:00","tot":"21:00"},"wo":{"van":"07:00","tot":"21:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'roosendaal', 'Je vindt Truckwash 1 Roosendaal op het bedrijventerrein de Borchwerf aan de Stepvelden 23, Roosendaal. Jouw locatie is het best te bereiken via de A17 afslag 20. We beschikken over 2 moderne wasstraten van 35 meter lang. Alle voertuigen die niet in een normale wasstraat passen kunnen bij ons terecht.', 'Ben je op zoek naar een truckwash in de buurt van Hazeldonk (Breda )? Dan is Truckwash 1 in Roosendaal het dichtste bij jou in de buurt.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Stickerverwijdering in trailers', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)']::text[]),
  ('loc_rotterdam', 'TW-ROT', 'Truckwash Rotterdam', 'Tweedweg 20', '3197 LM', 'Rotterdam-Botlek', '0102967764', 'rotterdam@truckwash1group.nl', 51.8734417, 4.2631194, '{"ma":{"van":"07:00","tot":"21:00"},"di":{"van":"07:00","tot":"21:00"},"wo":{"van":"07:00","tot":"21:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'rotterdam', 'Truckwash 1 Rotterdam zit in de Botlek aan de Tweedweg 20. Bereikbaar via de A15 (afslag 15). Met 4 wasstraten is dit een van onze grootste locaties. Naast het terrein: een ADR truckparking (betaald), truckerrestaurant Routiers, een Q8 truck-tankstation en een gratis parkeerplaats. Kortom alles op één plek. Geen afspraak nodig.', 'Door de vier straten en het efficiënt reinigen van je voertuigen verlagen we de wachttijden tot een minimum. Elke hal beschikt over een warmwater cleaner zodat we op iedere baan ook de trailer inwendig kunnen reinigen. Moet je even wachten? Dan kun je gebruik maken van de stofzuiger om je cabine schoon te maken. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen. Lang onderweg geweest? Je kunt bij ons gebruik maken van de douches.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'truckparking', 'wegrestaurant-a2']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_steenwijk', 'TW-STE', 'Truckwash Steenwijk', 'Oostermeentherand 8', '8332JZ', 'Steenwijk', '0521745003', 'Steenwijk@truckwash1group.nl', 52.7974282, 6.1293435, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"18:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'steenwijk', 'Truckwash 1 Steenwijk ligt op korte afstand van de A32 (afslag Steenwijk) en is daarmee ideaal bereikbaar voor chauffeurs die rijden tussen Zwolle, Meppel en Leeuwarden. De aanrijroute is overzichtelijk en geschikt voor zwaar transport.', 'Door de combinatie van moderne apparatuur en een vlot werkend team kun je hier rekenen op een snelle doorloop zonder concessies te doen aan kwaliteit. Efficiënt wassen met een schoon en representatief resultaat.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_utrecht', 'TW-UTR', 'Truckwash Utrecht', 'Reactorweg 27', '3542 AD', 'Utrecht', '0307740744', 'utrecht@truckwash1group.nl', 52.10574, 5.0633264, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"}}'::jsonb, 'utrecht', 'Je vindt Truckwash 1 Utrecht op het bedrijventerrein Lage Weide aan de Reactorweg 27. Lage Weide is het best te bereiken vanaf de A2 afslag 7. (In het pand van Van Leeuwen Trucks & vans). Truckwash Utrecht beschikt over 2 moderne wasstraten.', 'Door de twee straten en het efficiënt reinigen van je voertuigen verlagen we de wachttijden tot een minimum. Moet je even wachten? Dan kun je gebruik maken van de stofzuiger om je cabine schoon te maken. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO):', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_venlo', 'TW-VEN', 'Truckwash Venlo', 'Columbusweg 47', '5928LA', 'Venlo', '0773230405', 'venlo@truckwash1group.nl', 51.3958245, 6.0898586, '{"ma":{"van":"08:00","tot":"19:00"},"di":{"van":"08:00","tot":"19:00"},"wo":{"van":"08:00","tot":"19:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'venlo', 'Welkom bij Truckwash 1 Venlo, dé toonaangevende bestemming in Venlo en omstreken voor het grondig reinigen van vrachtwagens. Je vindt onze wasstraat aan de Columbusweg 47 op bedrijventerrein Trade Port West. Vanaf de A67 neem je afslag 39 Sevenum.', 'Truckwash 1 Venlo is uitgerust met twee moderne wasstraten voor het reinigen van alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan strenge normen en maken gebruik van de nieuwste reinigingsprogramma’s, waardoor uw voertuig weer in optimale staat wordt gebracht. Wassen gebeurt bovendien op een duurzame manier . Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je in onze wachtruimte genieten van een kop koffie.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_wehl', 'TW-WEH', 'Truckwash Wehl', 'Kryptonstraat 6A', '7031GG', 'Wehl', '088-0600100', 'holten@truckwash1group.nl', 51.9464915, 6.2251281, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"16:00"},"zo":null}'::jsonb, 'wehl', 'Truckwash 1 Wehl is goed bereikbaar via de A18 (afslag Wehl/Doetinchem) en ligt centraal in de Achterhoek. De ligging maakt deze locatie een vaste stop voor transportbewegingen in Oost-Nederland en richting Duitsland.', 'De locatie is volledig ingericht op efficiënt werken, met aandacht voor kwaliteit en zorgvuldige reiniging. Zo vervolg je je route met een schone vrachtwagen en minimale tijd van de weg.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[])
) as v (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  opening_hours, website_slug, intro, bereikbaar, bijzonder, diensten, punten
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
--  De proefinvoer bijwerken
--
--  Er stond al een "Truckwash Utrecht" met de code TW-UTR en het adres
--  "kasweg 2112". Die code botst met de echte Utrecht-vestiging hierboven, dus
--  die is door "do nothing" overgeslagen -- en dan bleef de proefinvoer staan
--  met het verkeerde adres erin.
--
--  Bijwerken en niet weggooien: er kunnen al uren, wasbeurten of roosters aan
--  deze vestiging hangen, en die verwijzen naar dit id. Een nieuwe rij naast
--  de oude zou Utrecht twee keer in elke keuzelijst zetten.
--
--  De voorwaarde op het adres maakt dit eenmalig. Heeft iemand het adres al
--  goedgezet -- met de hand of door deze migratie -- dan gebeurt er niets meer,
--  en blijft alles wat daarna in de app is gewijzigd gewoon staan.
-- ---------------------------------------------------------------------------

update public.locations bestaand
   set name          = echt.name,
       address       = echt.address,
       postcode      = echt.postcode,
       city          = echt.city,
       phone         = echt.phone,
       email         = echt.email,
       lat           = echt.lat,
       lon           = echt.lon,
       opening_hours = echt.opening_hours,
       website_slug  = echt.website_slug,
       intro         = echt.intro,
       bereikbaar    = echt.bereikbaar,
       diensten      = echt.diensten,
       punten        = echt.punten,
       op_website    = true,
       updated_at    = public.now_ms()
  from public.locations echt
 where bestaand.code = 'TW-UTR'
   and echt.id       = 'loc_utrecht'
   and bestaand.id  <> echt.id
   and lower(trim(coalesce(bestaand.address, ''))) = 'kasweg 2112';

-- De rij waaruit is overgenomen mag daarna weg: hij is nooit in gebruik
-- geweest en zou Utrecht anders dubbel in de lijst zetten.
delete from public.locations
 where id = 'loc_utrecht'
   and exists (
     select 1 from public.locations b
      where b.code = 'TW-UTR' and b.id <> 'loc_utrecht'
        and b.website_slug = 'utrecht');

-- ---------------------------------------------------------------------------
--  Hoeveel mensen er werken
--
--  De telling voor de vacaturepagina zat er naast. Hij sloot iedereen uit met
--  de rol "klant" of "werkgever", en dat is te streng: rollen stapelen in dit
--  systeem. Wie werknemer is en daarnaast een klantaccount heeft, is nog
--  steeds gewoon een collega. Gemeten op de echte database gaf dat 1 in plaats
--  van 6 -- en 1 is een getal dat je niet op een vacaturepagina wilt zetten
--  voor een bedrijf met negentien vestigingen.
--
--  De nieuwe regel is eenvoudiger en zegt wat hij bedoelt: iedereen die de rol
--  werknemer heeft, actief is, niet is uitgeschreven, en geen kassa is.
-- ---------------------------------------------------------------------------

create or replace function public.website_aantal_medewerkers()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.profiles
   where active
     and archived_at is null
     and not coalesce(is_device, false)
     and 'employee' = any(coalesce(roles, array[]::text[]));
$$;

-- ---------------------------------------------------------------------------
--  De punten mee naar buiten
--
--  website_vestigingen() gaf ze nog niet terug, en zonder die lijst kan de
--  site de vestigingspagina niet maken zoals hij nu is.
-- ---------------------------------------------------------------------------

drop function if exists public.website_vestigingen();

create function public.website_vestigingen()
returns table (
  slug        text,
  naam        text,
  adres       text,
  postcode    text,
  plaats      text,
  telefoon    text,
  email       text,
  lat         double precision,
  lon         double precision,
  wasstraten  integer,
  openingstijden jsonb,
  intro       text,
  bereikbaar  text,
  bijzonder   text,
  diensten    text[],
  punten      text[]
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten, l.punten
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * De rechten opnieuw zetten.
 *
 * "drop function" gooit ook de rechten weg, en de nieuwe functie krijgt van
 * Supabase weer automatisch anon en authenticated erbij -- zie 0033 en 0034.
 * Zonder deze twee regels staat het gat dat daar is gedicht meteen weer open.
 */
revoke execute on function public.website_vestigingen()        from public, anon, authenticated;
revoke execute on function public.website_aantal_medewerkers() from public, anon, authenticated;

grant execute on function public.website_vestigingen()        to service_role;
grant execute on function public.website_aantal_medewerkers() to service_role;

-- ===========================================================================
--  Utrecht bleef op "kasweg 2112" staan
--
--  0035 zou achttien vestigingen invoeren en heeft er zeventien gedaan.
--  Utrecht ontbreekt, en de proefinvoer met het adres "kasweg 2112" staat er
--  nog. Gemeten na afloop: 19 rijen, 17 met punten, en de rij met code TW-UTR
--  heeft geen website_slug.
--
--  Waarom het misging
--  ------------------
--
--  0035 voegt in met "on conflict (code) do nothing". Dat is met opzet -- een
--  importmigratie mag bij een tweede keer draaien niets overschrijven. Maar de
--  code TW-UTR was al bezet door de proefinvoer, dus de echte Utrecht werd
--  overgeslagen en de rij loc_utrecht is nooit ontstaan.
--
--  En precies die rij had de reparatie eronder als bron nodig:
--
--    update ... from public.locations echt where echt.id = 'loc_utrecht'
--
--  Geen bronrij, geen update. Geen foutmelding ook: nul rijen bijwerken is
--  voor Postgres een geldig antwoord. De migratie meldde succes en deed de
--  helft.
--
--  Waarom de test het niet ving
--  ----------------------------
--
--  Die botsing bestond in de test ook -- een fixture maakte een vestiging aan
--  met de code TW-UTR. Toen 0035 daarop stukliep is de fixture hernoemd naar
--  TST-UTR. Daarmee verdween de botsing uit de test, en dus ook het enige
--  geval waarvoor de reparatie geschreven was. De test werd groen door het
--  probleem weg te halen in plaats van het na te rekenen.
--
--  In scripts/sqltest.mjs wordt de situatie nu nagebouwd zoals hij op de
--  echte database was, en pas daarna wordt dit bestand gedraaid.
--
--  Wat deze migratie doet
--  ----------------------
--
--  De bestaande rij bijwerken, niet vervangen. Aan die rij kunnen uren,
--  wasbeurten, roosters en een kluis hangen, en die verwijzen naar zijn id.
--  Weggooien en opnieuw invoeren zou dat meenemen.
--
--  Het aantal wasstraten blijft staan zoals het staat. De site zegt "2
--  moderne wasstraten" in de introtekst, maar in de app staat 3 -- met de hand
--  ingevuld, en dat is vermoedelijk de werkelijkheid. Een migratie hoort geen
--  getal te overschrijven dat iemand zelf heeft nagekeken.
-- ===========================================================================

update public.locations
   set name          = 'Truckwash Utrecht',
       address       = 'Reactorweg 27',
       postcode      = '3542 AD',
       city          = 'Utrecht',
       phone         = '0307740744',
       email         = 'utrecht@truckwash1group.nl',
       lat           = 52.10574,
       lon           = 5.0633264,
       opening_hours = '{"ma":{"van":"08:00","tot":"18:00"},'
                       '"di":{"van":"08:00","tot":"18:00"},'
                       '"wo":{"van":"08:00","tot":"18:00"},'
                       '"do":{"van":"08:00","tot":"18:00"},'
                       '"vr":{"van":"08:00","tot":"21:00"},'
                       '"za":{"van":"08:00","tot":"13:00"}}'::jsonb,
       website_slug  = 'utrecht',
       intro         = 'Je vindt Truckwash 1 Utrecht op het bedrijventerrein '
                       'Lage Weide aan de Reactorweg 27. Lage Weide is het best '
                       'te bereiken vanaf de A2 afslag 7. (In het pand van Van '
                       'Leeuwen Trucks & vans). Truckwash Utrecht beschikt over '
                       '2 moderne wasstraten.',
       bereikbaar    = 'Door de twee straten en het efficiënt reinigen van je '
                       'voertuigen verlagen we de wachttijden tot een minimum. '
                       'Moet je even wachten? Dan kun je gebruik maken van de '
                       'stofzuiger om je cabine schoon te maken. Je kunt ook een '
                       'bezoek brengen aan onze shop of natuurlijk een kop '
                       'koffie nuttigen.',
       diensten      = array[
                         'alcoa-velgen-reinigen',
                         'haal-en-brengservice',
                         'haccp-certificaat-en-behandeling',
                         'nao-wasplaats'
                       ]::text[],
       punten        = array[
                         'Alcoa / Dura Bright behandeling',
                         'Handwash met spons',
                         'Het reinigen van alle aluminium onderdelen',
                         'Het inwendig reinigen van je laadruimtes (HACCP & NAO):',
                         'Ontsmetten en/of desinfecteren',
                         'Haal en brengservice (informeer contactpersoon)',
                         'Wassen op afspraak (informeer contactpersoon)',
                         'Alcoa reiniging'
                       ]::text[],
       op_website    = true,
       updated_at    = public.now_ms()
 where code = 'TW-UTR'
   -- Eenmalig, en daarmee opnieuw te draaien: zodra het adres klopt, of zodra
   -- iemand er in de app iets aan heeft veranderd, gebeurt hier niets meer.
   and lower(trim(coalesce(address, ''))) = 'kasweg 2112';

/*
 * Het gat dat 0035 openliet.
 *
 * Was er nooit een proefinvoer geweest, dan had 0035 Utrecht gewoon ingevoerd
 * en doet de update hierboven niets. Deze regel vangt dat geval af, zodat dit
 * bestand op elke database hetzelfde eindresultaat geeft: precies een Utrecht,
 * op de website, met een slug.
 *
 * De insert vindt geen bestaande rij met deze code, want die zou hierboven al
 * zijn bijgewerkt en dan is aan de where-voorwaarde voldaan.
 */
insert into public.locations (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  website_slug, kind, active, op_website
)
select
  'loc_utrecht', 'TW-UTR', 'Truckwash Utrecht', 'Reactorweg 27', '3542 AD',
  'Utrecht', '0307740744', 'utrecht@truckwash1group.nl', 52.10574, 5.0633264,
  'utrecht', 'vestiging', true, true
where not exists (
  select 1 from public.locations where website_slug = 'utrecht'
);

-- ===========================================================================
--  Een kassa mag klokken
--
--  Wat er gebeurde: iemand klokte in op de kassa, zag "is ingeklokt", stond
--  onder "Nu aan het werk" -- en de urenregel kwam nooit in de administratie.
--  De database weigerde hem, en de kassa gooide hem na acht pogingen weg.
--
--  Dat weggooien is in de kassa rechtgezet (versie 0.10.0: zo'n weigering
--  verbruikt geen pogingen meer en er komt een melding aan de balie). Dit is
--  de andere helft: de weigering zelf.
--
--  Waarom hij geweigerd werd
--  -------------------------
--
--  Sinds 0018 gaat klokken via de kassa, en de regel daar is:
--
--      insert on time_entries: is_management() or heeft_recht('hours.clock')
--
--  heeft_recht() kijkt in profiles.grants. Een gekoppelde kassa krijgt sinds
--  0025 zijn eigen inlogaccount met een dossier erbij -- rol employee, een
--  vestiging, en verder niets. Geen grants dus, en dus geen hours.clock.
--
--  De rechten van de kassa en de rechten van de medewerker zijn twee
--  verschillende dingen, en dat is precies waar dit misging. In de app wordt
--  gekeken of degene die er staat mag klokken; de database kijkt naar het
--  apparaat dat het verzoek stuurt. Beide horen te kloppen, en van die tweede
--  was niemand zich bewust.
--
--  Waarom juist dit recht, en niet meer
--  ------------------------------------
--
--  Klokken is het enige wat een kassa doet en wat niet elders kan: mensen
--  klokken in bij het apparaat waar ze langslopen. Alles wat de kassa verder
--  wegschrijft -- bonnen, kasmutaties, kluisboekingen, wasopdrachten, voorraad
--  -- komt al langs op is_staff() plus de eigen vestiging, en dat heeft dit
--  dossier.
--
--  pos.manage krijgt hij níet. Dat zou betekenen dat de inloggegevens van een
--  tablet achter de balie genoeg zijn om prijzen te wijzigen. Wat daar nog wél
--  aan vastzit staat onderaan dit bestand.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De kassa's die er al staan
-- ---------------------------------------------------------------------------

update public.profiles
   set grants = (
     select array_agg(distinct g)
       from unnest(coalesce(grants, array[]::text[]) || array['hours.clock']) as g
   )
 where is_device
   and not ('hours.clock' = any(coalesce(grants, array[]::text[])));

-- ---------------------------------------------------------------------------
--  En de kassa's die er nog bij komen
--
--  De serverfunctie kassa-koppelen zet dit recht ook zelf op het dossier. Deze
--  trigger is de rem eronder: hij vult het aan als het er niet op staat.
--
--  Twee plekken voor hetzelfde is meestal een fout, hier niet. De functie is de
--  gewone weg; deze trigger vangt de gevallen die daar niet langskomen -- een
--  dossier dat met de hand op is_device wordt gezet, of een kassa die gekoppeld
--  is met een oudere versie van de functie. Een kassa waarvan de uren stil
--  wegvallen is te duur om van één plek af te laten hangen.
-- ---------------------------------------------------------------------------

create or replace function public.apparaat_mag_klokken()
returns trigger language plpgsql as $$
begin
  if new.is_device
     and not ('hours.clock' = any(coalesce(new.grants, array[]::text[])))
  then
    new.grants := coalesce(new.grants, array[]::text[]) || array['hours.clock'];
  end if;
  return new;
end;
$$;

/*
 * Vóór profiles_apparaat, want die controleert wat er op het dossier staat en
 * deze vult het aan. Triggers met dezelfde tijd lopen op alfabet, en
 * "profiles_apparaat_klokken" komt na "profiles_apparaat" -- dus krijgt hij een
 * naam die eerder komt. Dat is lelijk en het staat er daarom bij.
 */
drop trigger if exists profiles_a_klokken on public.profiles;
create trigger profiles_a_klokken before insert or update on public.profiles
  for each row execute function public.apparaat_mag_klokken();

-- ---------------------------------------------------------------------------
--  Wat de kassa hierna nog steeds niet mag, en waarom dat een keuze is
--
--  Twee schermen in de kassa schrijven naar tabellen die mag_kassa_beheren()
--  vragen, en dat heeft een apparaataccount niet:
--
--    Beheer -> Artikelen        pos_products
--    Beheer -> Nummers, badges  pos_pins
--
--  Die blijven dus weigeren. Dat is geen vergissing maar het is ook niet af:
--  een scherm dat invoer aanneemt en het daarna niet kan opslaan, is dezelfde
--  soort fout als de inklokking die verdween -- alleen valt hij nu wél op,
--  want de kassa laat sinds 0.10.0 zien wat er in de wachtrij vastzit.
--
--  Er zijn twee eerlijke uitkomsten, en het is een keuze welke:
--
--    1. Prijzen en badges horen bij het kantoor, zoals vestigingen, kassa's en
--       kluizen. Dan gaan die twee schermen uit de kassa en komen ze in het
--       dashboard.
--    2. De kassa mag het. Dan krijgt het apparaataccount pos.manage, en zijn de
--       inloggegevens van een tablet achter de balie genoeg om prijzen te
--       wijzigen.
--
--  Zolang die keuze niet gemaakt is, doet deze migratie het minste van de twee:
--  klokken werkt, en prijzen blijven waar ze zijn.
-- ---------------------------------------------------------------------------

-- ===========================================================================
--  Een verwijdering moet zichzelf melden
--
--  Wat er gebeurde
--  ---------------
--
--  Op een werkplek stonden twee meldingen eeuwig in de wachtrij:
--
--    notifications  nt_sg_6fef2842...  111 pogingen
--    notifications  nt_sg_c2606e6b...  111 pogingen
--    "new row violates row-level security policy for table notifications"
--
--  Die twee waren gemaakt door de edge function kassa-koppelen bij een
--  aanmelding van een kassa, en door diezelfde functie weer weggehaald zodra
--  de kassa gekoppeld was (kassa-koppelen/index.ts, regel 425):
--
--    await admin.from('notifications').delete().eq('id', `nt_sg_${...}`)
--
--  Op de server klopte dat. Alleen: het ophalen vraagt om alles wat sinds de
--  vorige keer is veranderd, en een rij die er niet meer is verandert nooit
--  meer. De werkplek hield dus twee meldingen die nergens anders bestonden.
--
--  Daarna ging het pas mis. Zodra iemand ze als gelezen aanvinkte, ging er een
--  wijziging de wachtrij in. PostgREST maakt van een wijziging op een
--  verdwenen rij een nieuwe rij, en dan geldt de insert-regel:
--
--    bericht_bestaat(id) or (from_user_id = my_id() and ...)
--
--  Het origineel bestond niet meer, dus die eerste helft was onwaar. En de
--  afzender was de edge function en niet degene die zat te klikken, dus de
--  tweede ook. Terecht geweigerd -- en daarmee een regel die nooit meer weg
--  zou gaan.
--
--  De oorzaak, en waar hij zit
--  ---------------------------
--
--  0032 heeft hiervoor de verwijderlijst gemaakt: schrijf bij een verwijdering
--  op wélke rij van wélke tabel weg is, dan kan het ophalen dat doorgeven. Die
--  lijst werd alleen met de hand gevuld, op de plekken waar toen aan gedacht
--  is -- bij het wissen van een medewerker. Elke andere verwijdering, waar dan
--  ook vandaan, bleef stil.
--
--  Dus niet kassa-koppelen aanpassen. Dat repareert dit ene geval en laat de
--  volgende open. Een trigger op de tabel vangt élke verwijdering: uit een
--  edge function, uit de SQL-editor, uit een andere app, of uit een migratie.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De trigger
--
--  security definer, want wie de rij mag verwijderen hoeft daarmee nog geen
--  schrijfrecht op de verwijderlijst te hebben. Zonder dat zou een verwijdering
--  die wél is toegestaan alsnog stukbreken op het opschrijven ervan.
--
--  Hij mag nooit de verwijdering zelf tegenhouden. Vandaar de exception-vanger:
--  een rij die niet in de lijst komt is vervelend, een rij die niet weg kan is
--  erger.
-- ---------------------------------------------------------------------------

create or replace function public.meld_verwijdering()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.deletion_log (id, soort, tabel, record_id, naam, reden)
    values (
      'dl_' || replace(gen_random_uuid()::text, '-', ''),
      tg_table_name,
      tg_table_name,
      old.id,
      -- Een naam als de tabel er een heeft, anders het id. De lijst wordt ook
      -- door mensen gelezen.
      coalesce(
        case when to_jsonb(old) ? 'name'  then to_jsonb(old)->>'name'
             when to_jsonb(old) ? 'title' then to_jsonb(old)->>'title'
             when to_jsonb(old) ? 'naam'  then to_jsonb(old)->>'naam'
        end,
        old.id),
      'verwijderd');
  exception when others then
    -- Nooit de verwijdering blokkeren om het logboek.
    null;
  end;
  return old;
end;
$$;

comment on function public.meld_verwijdering() is
  'Schrijft elke verwijdering in deletion_log, zodat het ophalen hem kan '
  'doorgeven. Zonder dit houdt elk apparaat een rij die nergens meer bestaat, '
  'en probeert die bij de eerste wijziging terug te schrijven.';

-- ---------------------------------------------------------------------------
--  Waar hij op staat
--
--  De tabellen waar de server rijen weghaalt achter de app om, en waar de app
--  een eigen kopie van bewaart. notifications is de gemeten aanleiding;
--  signups gaat langs dezelfde weg -- kassa-koppelen raakt ze allebei aan.
--
--  Niet op alles gezet. Een trigger op elke tabel klinkt grondig, maar dan
--  loopt de verwijderlijst vol met rijen waar geen apparaat een kopie van
--  heeft, en wordt het ophalen duurder zonder dat iemand er iets aan heeft.
-- ---------------------------------------------------------------------------

drop trigger if exists notifications_verwijderd on public.notifications;
create trigger notifications_verwijderd
  after delete on public.notifications
  for each row execute function public.meld_verwijdering();

drop trigger if exists signups_verwijderd on public.signups;
create trigger signups_verwijderd
  after delete on public.signups
  for each row execute function public.meld_verwijdering();

-- ---------------------------------------------------------------------------
--  De twee die er al stonden
--
--  Ze zijn weggehaald voordat deze trigger bestond, dus staan ze in geen
--  enkele verwijderlijst. Voor de apparaten die ze nog hebben is dat het
--  verschil tussen "gaat vanzelf over" en "blijft eeuwig hangen".
--
--  Alleen die twee met de hand toevoegen zou dit ene geval oplossen. Beter is
--  de hele klasse: elke melding die met nt_sg_ begint hoort bij een
--  kassa-aanmelding en wordt door kassa-koppelen weggehaald zodra de kassa
--  gekoppeld is. Voor elke kassa die al gekoppeld is, staat die melding dus
--  nergens meer -- terwijl een werkplek hem nog kan hebben.
--
--  We weten niet welke ids dat waren; die rijen zijn weg. Maar we weten wel
--  welke aanmeldingen er zijn geweest, en het id was daaruit af te leiden:
--  'nt_sg_' plus het aanmeld-id zonder streepjes.
-- ---------------------------------------------------------------------------

insert into public.deletion_log (id, soort, tabel, record_id, naam, reden)
select
  'dl_sg_' || replace(s.id, '-', ''),
  'notifications',
  'notifications',
  'nt_sg_' || replace(s.id, '-', ''),
  'Aanmelding ' || coalesce(s.name, s.id),
  'de kassa is gekoppeld; de melding is toen weggehaald'
from public.signups s
where not exists (
        select 1 from public.notifications n
         where n.id = 'nt_sg_' || replace(s.id, '-', ''))
  and not exists (
        select 1 from public.deletion_log d
         where d.tabel = 'notifications'
           and d.record_id = 'nt_sg_' || replace(s.id, '-', ''))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  En de twee die niemand meer kan afleiden
--
--  De regel hierboven leidt het meldings-id af uit de aanmelding. Dat werkt
--  alleen zolang die aanmelding er nog staat -- en bij deze twee is ook die
--  weg. Ze zijn afgelezen van een werkplek waar ze vastzaten:
--
--    notifications  nt_sg_6fef28421615442aa565a91e03cdc657  111 pogingen
--    notifications  nt_sg_c2606e6bf5b54f1380dce4748bcb90a6  111 pogingen
--
--  Twee ids met de hand in een migratie is lelijk, en dat is het eerlijke
--  woord ervoor. Het alternatief is een werkplek die blijft klagen over twee
--  meldingen die nergens meer bestaan, en dat is erger. Voor elk apparaat dat
--  ze niet heeft is dit een regel die niets doet.
-- ---------------------------------------------------------------------------

insert into public.deletion_log (id, soort, tabel, record_id, naam, reden)
values
  ('dl_nt_6fef28421615442aa565a91e03cdc657', 'notifications', 'notifications',
   'nt_sg_6fef28421615442aa565a91e03cdc657', 'Aanmelding van een kassa',
   'weggehaald bij het koppelen, voordat verwijderingen werden gemeld'),
  ('dl_nt_c2606e6bf5b54f1380dce4748bcb90a6', 'notifications', 'notifications',
   'nt_sg_c2606e6bf5b54f1380dce4748bcb90a6', 'Aanmelding van een kassa',
   'weggehaald bij het koppelen, voordat verwijderingen werden gemeld')
on conflict (id) do nothing;

-- ===========================================================================
--  Verdwaalde regeleindes in de vestigingsteksten
--
--  Bij het naderhand vergelijken van de site met de nulmeting bleken vier van
--  de vijfenveertig pagina's te verschillen. De inhoud was gelijk; het enige
--  verschil was een onzichtbaar teken:
--
--    ...naast de Q8.^M
--
--  Dat is een carriage return (chr(13)), het regeleindeteken van Windows. Hij
--  staat in de tekst zelf, niet aan het eind van de regel in het bestand.
--
--  Waar hij vandaan komt
--  ---------------------
--
--  De achttien vestigingen zijn met 0035 ingevoerd uit site.json. Die migratie
--  is op een Windows-machine geschreven, en git zet .sql-bestanden daar om naar
--  CRLF -- de waarschuwing "LF will be replaced by CRLF" kwam bij elke commit
--  langs. In een tekst die over meerdere regels is samengesteld belandt dat
--  teken binnen de waarde in plaats van erbuiten.
--
--  Gemeten: 1 intro en 2 bereikbaar-teksten, van de achttien.
--
--  Waarom het opruimen hoort
--  -------------------------
--
--  Het valt niemand op. Het is geen zichtbaar teken, de pagina ziet er goed
--  uit, en HTML vouwt witruimte toch samen. Maar zolang het er staat is elke
--  vergelijking tussen de site en de database vals: er verschijnen verschillen
--  die geen verschillen zijn, en dan leer je die vergelijking negeren -- en
--  precies dan glipt er een keer een echt verschil doorheen.
--
--  Ook de andere kant is nu afgedekt: bouw/omzet.cjs in het siteproject haalt
--  regeleindes eruit voordat er HTML van wordt gemaakt. Dit repareert wat er
--  staat, dat voorkomt dat het langs een andere weg terugkomt.
--
--  Opnieuw draaien mag; de tweede keer valt er niets meer op te ruimen.
-- ===========================================================================

update public.locations
   set intro      = nullif(replace(coalesce(intro, ''),      chr(13), ''), ''),
       bereikbaar = nullif(replace(coalesce(bereikbaar, ''), chr(13), ''), ''),
       bijzonder  = nullif(replace(coalesce(bijzonder, ''),  chr(13), ''), ''),
       punten     = (
         select coalesce(array_agg(replace(p, chr(13), '') order by nr), '{}')
           from unnest(punten) with ordinality as t(p, nr)
       ),
       updated_at = public.now_ms()
 where intro      like '%' || chr(13) || '%'
    or bereikbaar like '%' || chr(13) || '%'
    or bijzonder  like '%' || chr(13) || '%'
    or exists (select 1 from unnest(punten) p where p like '%' || chr(13) || '%');

-- ===========================================================================
--  Bijwerken is nog steeds geen aanmaken -- nu op alle tabellen
--
--  "De database weigert dit voor X: new row violates row-level security
--  policy" is in dit project inmiddels vijf keer gemeld, elke keer op een
--  andere tabel: log_events, tickets, notifications, en nu channels. Steeds
--  dezelfde oorzaak, steeds één tabel tegelijk gerepareerd. Dat is vier keer
--  het symptoom behandelen.
--
--  Wat er aan de hand is
--  ---------------------
--
--  De app stuurt wijzigingen als een upsert: "zet deze rij neer, en bestaat
--  hij al, werk hem dan bij". PostgREST beoordeelt zo'n verzoek altijd óók
--  tegen de insert-regel -- ook als het feitelijk een bijwerking is.
--
--  Het gevolg: je mag een rij wijzigen, je mag hem niet aanmaken, en dus
--  wordt je wijziging geweigerd. De foutmelding zegt "new row", terwijl er
--  geen nieuwe rij is.
--
--  In de praktijk gebeurt dat zo. Iemand haalt een overlegkanaal op, leest het
--  laatste bericht, en de app schrijft terug wanneer hij het gelezen heeft. Op
--  dat moment is hij geen beheerder van dat kanaal -- hij hoeft het ook niet
--  aan te maken, het bestaat al -- maar de insert-regel kijkt daar niet naar.
--
--  De oplossing die er al was
--  --------------------------
--
--  0031 heeft daarvoor rij_bestaat() gemaakt: bestaat de rij al, dan mag het
--  verzoek door, en beslist de update-regel wat er werkelijk gewijzigd mag
--  worden. Dat geeft dus niets weg -- wie niets mag wijzigen, wijzigt nog
--  steeds niets. Het haalt alleen de verkeerde vraag weg.
--
--  Die reparatie is toen op zes tabellen gezet. Gemeten vandaag: dertien
--  tabellen hebben hem nog steeds niet.
--
--    dev_plans   documents   faults   mailbox   profiles   signups
--    stock_movements   time_entries   wash_jobs
--    pos_safe_moves   pos_sales   pos_subscriptions   pos_subscription_uses
--
--  Hier krijgen ze hem alle dertien. De oorspronkelijke regel blijft er
--  woordelijk in staan -- er komt alleen een uitweg vóór, voor het geval de
--  rij er al is.
--
--  log_events staat er niet bij: die laat invoegen al onvoorwaardelijk toe.
--
--  Over de pos_-tabellen
--  ---------------------
--
--  Die horen bij de kassa. Dit raakt geen enkele regel over wie wat mag: de
--  toegevoegde tak staat alleen toe wat de update-regel van diezelfde tabel al
--  toestond. Ze staan er wel bij, want een klasse half repareren is precies
--  hoe dit vier keer eerder is teruggekomen.
--
--  Vanaf nu bewaakt scripts/sqltest.mjs dit: komt er een tabel bij zonder de
--  uitweg, dan valt de bouw om in plaats van dat iemand er over een half jaar
--  tegenaan loopt.
--
--  Opnieuw draaien mag.
-- ===========================================================================

drop policy if exists dev_plans_insert on public.dev_plans;
create policy dev_plans_insert on public.dev_plans for insert to authenticated
  with check (
    public.rij_bestaat('public.dev_plans'::regclass, id::text)
    or (public.mag_plannen())
  );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (
    public.rij_bestaat('public.documents'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists faults_insert on public.faults;
create policy faults_insert on public.faults for insert to authenticated
  with check (
    public.rij_bestaat('public.faults'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists mailbox_insert on public.mailbox;
create policy mailbox_insert on public.mailbox for insert to authenticated
  with check (
    public.rij_bestaat('public.mailbox'::regclass, id::text)
    or (public.is_management() or public.is_developer())
  );

drop policy if exists pos_safe_moves_insert on public.pos_safe_moves;
create policy pos_safe_moves_insert on public.pos_safe_moves for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_safe_moves'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists pos_sales_insert on public.pos_sales;
create policy pos_sales_insert on public.pos_sales for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_sales'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists pos_subscription_uses_insert on public.pos_subscription_uses;
create policy pos_subscription_uses_insert on public.pos_subscription_uses for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_subscription_uses'::regclass, id::text)
    or (public.is_staff())
  );

drop policy if exists pos_subscriptions_insert on public.pos_subscriptions;
create policy pos_subscriptions_insert on public.pos_subscriptions for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_subscriptions'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (
    public.rij_bestaat('public.profiles'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists signups_insert on public.signups;
create policy signups_insert on public.signups for insert to authenticated
  with check (
    public.rij_bestaat('public.signups'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists stock_insert on public.stock_movements;
create policy stock_insert on public.stock_movements for insert to authenticated
  with check (
    public.rij_bestaat('public.stock_movements'::regclass, id::text)
    or (public.is_staff())
  );

drop policy if exists time_insert on public.time_entries;
create policy time_insert on public.time_entries for insert to authenticated
  with check (
    public.rij_bestaat('public.time_entries'::regclass, id::text)
    or (public.is_management() or public.heeft_recht('hours.clock'))
  );

drop policy if exists wash_jobs_insert on public.wash_jobs;
create policy wash_jobs_insert on public.wash_jobs for insert to authenticated
  with check (
    public.rij_bestaat('public.wash_jobs'::regclass, id::text)
    or (public.is_staff() or company_id = public.my_company())
  );

-- ===========================================================================
--  Trucky praat met bezoekers
--
--  Een chatbot op de website, met Claude erachter. Deze tabel bestaat om één
--  reden: de kosten begrenzen.
--
--  Waarom dat hier moet en niet in de browser
--  ------------------------------------------
--
--  Het adres van de chatfunctie staat open -- dat moet ook, anders kan een
--  bezoeker zonder inlog er niet bij. Alles wat de browser meestuurt is dus
--  door diezelfde bezoeker te veranderen: het gespreks-id, het aantal vragen
--  dat hij al gesteld heeft, alles. Een teller in JavaScript houdt niemand
--  tegen die de ontwikkelaarsconsole weet te vinden.
--
--  De teller staat daarom hier, en de functie leest en schrijft hem met de
--  servicesleutel. Wat er in de browser gebeurt is dan hoogstens een
--  vriendelijke waarschuwing vooraf.
--
--  Drie grenzen, en waarom drie
--  ----------------------------
--
--    per gesprek    een bezoeker die doorvraagt is prima; een bezoeker die
--                   honderd keer doorvraagt is geen bezoeker meer.
--    per dag        beschermt tegen het geval dat iemand tienduizend
--                   gesprekken begint. Zonder deze grens is de eerste twee
--                   waardeloos: nieuwe gesprekken zijn gratis te maken.
--    tokens per dag de echte rekening. Vragen tellen zegt weinig -- iemand
--                   die een lap tekst plakt kost meer dan honderd korte
--                   vragen.
--
--  De grenzen zelf staan in de functie en niet hier, zodat bijstellen geen
--  migratie kost.
-- ===========================================================================

create table if not exists public.trucky_gesprekken (
  id              text primary key,
  begonnen_at     bigint not null default public.now_ms(),
  laatst_at       bigint not null default public.now_ms(),
  aantal_vragen   integer not null default 0,
  invoer_tokens   integer not null default 0,
  uitvoer_tokens  integer not null default 0,
  /* Alleen gevuld als de bezoeker om een verslag heeft gevraagd. Zolang dat
     niet gebeurt weten we niet wie er heeft zitten typen, en dat hoort ook zo:
     een chauffeur die vraagt hoe laat Venlo opengaat laat geen adres achter. */
  email           text,
  verslag_at      bigint,
  updated_at      bigint not null default public.now_ms()
);

comment on table public.trucky_gesprekken is
  'Eén rij per chatgesprek op de website. Bestaat om de kosten te begrenzen: '
  'de tellers moeten op de server staan, want het chatadres is openbaar en '
  'alles wat de browser meestuurt is door de bezoeker te veranderen.';

create index if not exists trucky_gesprekken_dag_idx
  on public.trucky_gesprekken (begonnen_at);

-- ---------------------------------------------------------------------------
--  Niemand mag hierbij
--
--  Ook niet wie is ingelogd. Hier staan vragen van bezoekers in, en die zijn
--  van niemand in de organisatie. De functie leest en schrijft met de
--  servicesleutel; die gaat langs de regels heen en heeft er dus geen nodig.
--
--  Row level security AAN met nul regels betekent: dicht voor iedereen.
-- ---------------------------------------------------------------------------

alter table public.trucky_gesprekken enable row level security;
alter table public.trucky_gesprekken force row level security;

revoke all on public.trucky_gesprekken from anon, authenticated;

-- ---------------------------------------------------------------------------
--  Wat er vandaag al is verstookt
--
--  Eén vraag in plaats van drie, en de functie hoeft niet te weten hoe de
--  tabel eruitziet. security definer omdat de tabel voor iedereen dicht staat.
-- ---------------------------------------------------------------------------

create or replace function public.trucky_verbruik_vandaag()
returns table (gesprekken integer, tokens integer)
language sql stable security definer set search_path = public as $$
  select
    count(*)::integer,
    coalesce(sum(invoer_tokens + uitvoer_tokens), 0)::integer
  from public.trucky_gesprekken
  where begonnen_at > (extract(epoch from now()) * 1000)::bigint - 86400000;
$$;

/*
 * Rechten. Zie 0033 en 0034: Postgres geeft het uitvoerrecht op een nieuwe
 * functie aan PUBLIC, en Supabase geeft er anon en authenticated bovenop. Bij
 * een security definer-functie is dat een open deur, dus allebei eraf.
 */
revoke execute on function public.trucky_verbruik_vandaag() from public, anon, authenticated;
grant  execute on function public.trucky_verbruik_vandaag() to service_role;

-- ===========================================================================
--  Trucky kent de antwoorden zelf
--
--  Tot nu toe ging elke vraag naar het model. Dat is duur voor vragen die
--  iedereen stelt -- "hoe laat zijn jullie open", "kan ik zonder afspraak
--  terecht", "wat kost een buitenwas" -- en het antwoord kan per keer nét
--  anders uitvallen, terwijl je bij zulke vragen juist wilt dat er altijd
--  hetzelfde staat.
--
--  Vanaf hier staan de vragen en antwoorden in de database. De volgorde is:
--
--    1. zoeken in deze tabel. Gevonden? Dan dat antwoord, woordelijk, gratis.
--    2. niets gevonden? Dan het model -- maar met de dichtstbijzijnde
--       antwoorden erbij, zodat het niet gaat verzinnen wat hier al staat.
--    3. mag of kan het model het niet? Dan een contactformulier.
--
--  Zoeken dat tegen een typefout kan
--  ---------------------------------
--
--  Een chauffeur op een telefoon in een wasstraat typt "opeingstijden". Zoeken
--  op exacte woorden vindt dan niets, en dan gaat er een dure vraag naar het
--  model voor iets wat hier gewoon staat.
--
--  Vandaar twee manieren naast elkaar, en de beste van de twee telt:
--
--    woorden      Postgres' eigen tekstzoeken in het Nederlands. Vangt
--                 verbuigingen: "openingstijd" vindt "openingstijden".
--    letters      trigram-gelijkenis. Vangt tikfouten: "opeingstijden" lijkt
--                 voor 80% op "openingstijden", ook al is geen woord gelijk.
--
--  Alleen woorden is te streng, alleen letters is te dom -- die vindt
--  "wasstraat" ook in "waspoeder".
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De twee uitbreidingen, en waarom er een terugval onder staat
--
--  pg_trgm en unaccent zitten in Supabase. In de testdatabase (PGlite, waar
--  scripts/sqltest.mjs op draait) niet -- die kent geen uitbreidingen. Zonder
--  terugval kan dit bestand daar niet eens laden, en dan is er van deze hele
--  migratie niets te controleren.
--
--  De terugval hieronder wordt daarom alleen aangemaakt als de echte functie
--  ontbreekt. Op Supabase gebeurt dat nooit. Het is een stut voor de test, en
--  hij zegt dat ook van zichzelf.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm niet beschikbaar -- terugval wordt gebruikt';
end $$;

do $$
begin
  create extension if not exists unaccent;
exception when others then
  raise notice 'unaccent niet beschikbaar -- terugval wordt gebruikt';
end $$;

do $$
begin
  if to_regprocedure('unaccent(text)') is null then
    execute $f$
      create function public.unaccent(t text) returns text
      language sql immutable as 'select t';
    $f$;
  end if;

  if to_regprocedure('similarity(text,text)') is null then
    /*
     * Grove vervanger: hoeveel van de woorden komen in allebei voor. Vangt
     * geen tikfouten -- dat is nou juist wat trigrammen wél doen -- maar is
     * genoeg om de rest van dit bestand te laten laden en te controleren.
     * Draait alleen waar pg_trgm ontbreekt, dus nooit op Supabase.
     */
    execute $f$
      create function public.similarity(a text, b text) returns real
      language sql immutable as $s$
        select case
          when coalesce(a,'') = '' or coalesce(b,'') = '' then 0::real
          else (
            select count(*)::real / greatest(1, array_length(
              string_to_array(lower(b), ' '), 1))
              from unnest(string_to_array(lower(a), ' ')) w
             where w <> '' and lower(b) like '%' || w || '%'
          )::real
        end;
      $s$;
    $f$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  De vragen en antwoorden
-- ---------------------------------------------------------------------------

create table if not exists public.trucky_vragen (
  id          text primary key,
  vraag       text not null,
  antwoord    text not null,
  /* Andere manieren waarop mensen ernaar vragen. "wanneer open", "hoe laat",
     "openingstijden" horen bij dezelfde vraag, en dit is goedkoper dan er drie
     rijen van maken die je alle drie moet bijwerken. */
  trefwoorden text[] not null default '{}',
  /* Waar de bezoeker verder kan lezen. Wordt een knop onder het antwoord. */
  pagina      text,
  actief      boolean not null default true,
  /* Hoe vaak dit antwoord is gegeven zonder dat het model eraan te pas kwam.
     Zegt welke vragen echt leven -- en dus welke het waard zijn om scherp te
     houden. */
  gebruikt    integer not null default 0,
  updated_at  bigint not null default public.now_ms()
);

comment on table public.trucky_vragen is
  'Vaste vragen en antwoorden voor de chatbot op de website. Wordt eerst '
  'doorzocht; pas als er niets past komt het model eraan te pas.';

/*
 * De index hoort bij pg_trgm en kan er dus alleen zijn waar die uitbreiding is.
 * Bij een handvol vragen maakt hij nog niets uit; hij staat er voor als de
 * lijst groeit.
 */
do $$
begin
  create index if not exists trucky_vragen_vraag_trgm
    on public.trucky_vragen using gin (vraag gin_trgm_ops);
exception when others then
  raise notice 'trigram-index overgeslagen -- pg_trgm ontbreekt';
end $$;

-- ---------------------------------------------------------------------------
--  Wat een bezoeker achterlaat als niemand het kon beantwoorden
--
--  Hier staan naam, adres en telefoonnummer van mensen buiten het bedrijf in.
--  Dat is de reden dat deze tabel strenger dicht zit dan de vragenlijst.
-- ---------------------------------------------------------------------------

create table if not exists public.trucky_contact (
  id            text primary key,
  naam          text not null,
  email         text not null,
  telefoon      text,
  bedrijf       text,
  vraag         text not null,
  /* Het gesprek waar dit uit voortkwam, zodat je ziet wat eraan voorafging. */
  gesprek       text,
  /* Wat er in de chat is gezegd. Zonder dat is de vraag vaak niet te plaatsen:
     "ja graag, om 9 uur" zegt weinig zonder de vraag ervoor. */
  verloop       text,
  status        text not null default 'nieuw'
                check (status in ('nieuw', 'opgepakt', 'beantwoord')),
  antwoord      text,
  behandeld_door      text,
  behandeld_door_naam text,
  behandeld_at  bigint,
  created_at    bigint not null default public.now_ms(),
  updated_at    bigint not null default public.now_ms()
);

comment on table public.trucky_contact is
  'Vragen die de chatbot niet kon of mocht beantwoorden. Komen in het '
  'dashboard bij administratie en management terecht.';

create index if not exists trucky_contact_status_idx
  on public.trucky_contact (status, created_at desc);

-- ---------------------------------------------------------------------------
--  Instellingen die het management zelf zet
--
--  Begonnen om één reden -- naar welk adres een contactverzoek gaat -- maar
--  bewust als lijst en niet als losse kolom ergens. Er komt altijd een tweede.
-- ---------------------------------------------------------------------------

create table if not exists public.instellingen (
  /* id én sleutel: de synchronisatie van de app gaat overal uit van een kolom
     id, en daar een uitzondering voor maken kost meer dan deze kolom. sleutel
     is wat je in de code opzoekt en blijft uniek. */
  id          text primary key,
  sleutel     text not null unique,
  waarde      text not null default '',
  omschrijving text not null default '',
  updated_at  bigint not null default public.now_ms()
);

insert into public.instellingen (id, sleutel, waarde, omschrijving)
values (
  'in_contact_mail',
  'contact_mail',
  'casper@truckwash1group.nl',
  'Naar welk adres een contactverzoek van de website gaat. Meerdere adressen '
  'mag, gescheiden door een komma.'
)
on conflict (sleutel) do nothing;

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  De vragenlijst: iedereen die hier werkt mag hem lezen -- hij staat toch op
--  de website. Wijzigen is management, want dit is wat het bedrijf naar buiten
--  zegt.
--
--  De contactverzoeken: administratie en management. Daar staan gegevens van
--  buitenstaanders in, en dat hoeft de wasstraat niet te zien.
--
--  Overal de uitweg voor de upsert-val erbij; zie 0040 voor waarom.
-- ---------------------------------------------------------------------------

alter table public.trucky_vragen  enable row level security;
alter table public.trucky_contact enable row level security;
alter table public.instellingen   enable row level security;

drop policy if exists trucky_vragen_select on public.trucky_vragen;
create policy trucky_vragen_select on public.trucky_vragen for select to authenticated
  using (public.is_staff() or 'technician' = any(public.my_roles())
         or 'developer' = any(public.my_roles()));

drop policy if exists trucky_vragen_insert on public.trucky_vragen;
create policy trucky_vragen_insert on public.trucky_vragen for insert to authenticated
  with check (public.rij_bestaat('public.trucky_vragen'::regclass, id) or public.is_management());

drop policy if exists trucky_vragen_update on public.trucky_vragen;
create policy trucky_vragen_update on public.trucky_vragen for update to authenticated
  using (public.is_management()) with check (public.is_management());

drop policy if exists trucky_vragen_delete on public.trucky_vragen;
create policy trucky_vragen_delete on public.trucky_vragen for delete to authenticated
  using (public.is_management());

/* Administratie of management. heeft_recht() kijkt naar de losse rechten op
   het dossier; is_management() vangt de rol af. */
drop policy if exists trucky_contact_select on public.trucky_contact;
create policy trucky_contact_select on public.trucky_contact for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists trucky_contact_insert on public.trucky_contact;
create policy trucky_contact_insert on public.trucky_contact for insert to authenticated
  with check (public.rij_bestaat('public.trucky_contact'::regclass, id)
              or public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists trucky_contact_update on public.trucky_contact;
create policy trucky_contact_update on public.trucky_contact for update to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists instellingen_insert on public.instellingen;
create policy instellingen_insert on public.instellingen for insert to authenticated
  with check (public.rij_bestaat('public.instellingen'::regclass, id)
              or public.is_management());

drop policy if exists instellingen_update on public.instellingen;
create policy instellingen_update on public.instellingen for update to authenticated
  using (public.is_management()) with check (public.is_management());

-- ---------------------------------------------------------------------------
--  Zoeken
--
--  Geeft de beste treffers terug met een cijfer tussen 0 en 1. De functie
--  bepaalt niet wat "goed genoeg" is -- dat staat in de edge function, zodat
--  bijstellen geen migratie kost.
-- ---------------------------------------------------------------------------

create or replace function public.trucky_zoek(vraag_in text, hoeveel integer default 3)
returns table (id text, vraag text, antwoord text, pagina text, score real)
language sql stable security definer set search_path = public as $$
  with schoon as (
    select lower(unaccent(coalesce(vraag_in, ''))) as q
  )
  select
    v.id, v.vraag, v.antwoord, v.pagina,
    greatest(
      -- op letters: vangt tikfouten
      similarity(s.q, lower(unaccent(v.vraag))),
      -- op letters, tegen de trefwoorden
      coalesce((
        select max(similarity(s.q, lower(unaccent(t))))
          from unnest(v.trefwoorden) t
      ), 0),
      -- op woorden: vangt verbuigingen. ts_rank geeft kleine getallen, dus
      -- opgetrokken naar dezelfde schaal als de rest.
      least(1.0, ts_rank(
        to_tsvector('dutch',
          v.vraag || ' ' || coalesce(array_to_string(v.trefwoorden, ' '), '')),
        plainto_tsquery('dutch', s.q)
      ) * 8)
    )::real as score
  from public.trucky_vragen v, schoon s
  where v.actief
    and length(s.q) > 2
  order by score desc
  limit greatest(1, least(hoeveel, 10));
$$;

/* Zie 0033/0034: nieuwe functies krijgen anon er gratis bij. Dit is een
   security definer-functie, dus die deur gaat dicht. De edge function draait
   met de servicesleutel. */
revoke execute on function public.trucky_zoek(text, integer) from public, anon, authenticated;
grant  execute on function public.trucky_zoek(text, integer) to service_role;

/*
 * De teller ophogen.
 *
 * Een eigen functie omdat PostgREST geen "gebruikt = gebruikt + 1" kent -- via
 * de REST-laag zou het lezen-en-terugschrijven worden, en dan telt bij twee
 * bezoekers tegelijk één van de twee niet mee.
 */
create or replace function public.trucky_vraag_gebruikt(vraag_id text)
returns void
language sql security definer set search_path = public as $$
  update public.trucky_vragen
     set gebruikt = gebruikt + 1, updated_at = public.now_ms()
   where id = vraag_id;
$$;

revoke execute on function public.trucky_vraag_gebruikt(text) from public, anon, authenticated;
grant  execute on function public.trucky_vraag_gebruikt(text) to service_role;

-- ---------------------------------------------------------------------------
--  Een startlijst
--
--  Twaalf vragen die op elke wasstraat langskomen. Bedoeld om meteen iets te
--  hebben; het management kan ze in de app wijzigen en aanvullen.
--
--  De antwoorden zijn met opzet kort en zonder cijfers die verouderen -- voor
--  prijzen en tijden verwijzen ze naar de pagina waar het echte getal staat.
-- ---------------------------------------------------------------------------

insert into public.trucky_vragen (id, vraag, antwoord, trefwoorden, pagina) values
  ('tv_afspraak', 'Moet ik een afspraak maken?',
   'Nee, je kunt zonder afspraak langskomen bij al onze vestigingen. Even bellen mag natuurlijk altijd als je zeker wilt weten dat het rustig is.',
   array['afspraak','reserveren','zonder afspraak','moet ik bellen'], '/locaties/'),

  ('tv_open', 'Hoe laat zijn jullie open?',
   'Dat verschilt per vestiging. Op de locatiepagina staan de openingstijden van elke vestiging, en je kunt daar ook op postcode zoeken welke het dichtst bij je is.',
   array['openingstijden','hoe laat open','wanneer open','tijden','geopend'], '/locaties/'),

  ('tv_prijs', 'Wat kost een wasbeurt?',
   'Alle tarieven staan op de prijzenpagina, inclusief de toeslagen. De prijzen zijn exclusief 21% btw.',
   array['prijs','kosten','tarief','wat kost','hoeveel kost'], '/prijzen/'),

  ('tv_waar', 'Waar zitten jullie?',
   'We hebben achttien vestigingen door heel Nederland. Op de locatiepagina vind je ze allemaal op de kaart, en kun je op postcode zoeken welke het dichtst bij je is.',
   array['vestigingen','locaties','waar zitten jullie','adres','dichtstbijzijnde'], '/locaties/'),

  ('tv_betalen', 'Hoe kan ik betalen?',
   'Pinnen kan bij elke vestiging. Rijd je vaker bij ons binnen, dan is een account op rekening vaak handiger -- bel daarvoor 088 - 0600 100.',
   array['betalen','pinnen','pin','contant','op rekening','factuur'], '/contact/'),

  ('tv_haccp', 'Reinigen jullie ook laadruimtes?',
   'Ja, we reinigen laadruimtes inwendig, HACCP- en NAO-gecertificeerd. Ontsmetten en desinfecteren kan ook.',
   array['haccp','nao','laadruimte','inwendig','ontsmetten','desinfecteren','tank'],
   '/diensten/haccp-certificaat-en-behandeling/'),

  ('tv_alcoa', 'Poetsen jullie ook velgen?',
   'Ja, we doen Alcoa- en Dura Bright-behandelingen en reinigen alle aluminium onderdelen.',
   array['velgen','alcoa','dura bright','aluminium','polijsten'],
   '/diensten/alcoa-velgen-reinigen/'),

  ('tv_camper', 'Wassen jullie ook campers en bussen?',
   'Ja, campers en bussen kunnen bij ons terecht. Kijk even op de dienstenpagina welke vestiging bij jouw voertuig past.',
   array['camper','bus','bussen','touringcar','bestelbus'], '/diensten/'),

  ('tv_vacature', 'Hebben jullie vacatures?',
   'Ja, we zoeken regelmatig mensen. Je hebt er geen diploma voor nodig, wel de wil om te leren. Op de vacaturepagina staan de openstaande functies en kun je meteen solliciteren.',
   array['vacature','werken','baan','solliciteren','werk','personeel gezocht'],
   '/werken-bij/'),

  ('tv_wachttijd', 'Hoe lang duurt een wasbeurt?',
   'Een buitenwas duurt ongeveer een half uur. Bij drukte kan het wat langer zijn; op de meeste vestigingen kun je ondertussen wachten met een kop koffie.',
   array['hoe lang','wachttijd','duur','snel klaar'], '/locaties/'),

  ('tv_truckparking', 'Kan ik bij jullie parkeren of overnachten?',
   'Op een aantal vestigingen is truckparking. Op de dienstenpagina zie je waar dat kan.',
   array['parkeren','truckparking','overnachten','slapen','parking'],
   '/diensten/truckparking/'),

  ('tv_contact', 'Hoe kan ik contact opnemen?',
   'Bel 088 - 0600 100 of mail info@truckwash1group.nl. Elke vestiging heeft ook een eigen nummer; dat staat op de locatiepagina.',
   array['contact','bellen','telefoonnummer','mailen','e-mail'], '/contact/')
on conflict (id) do nothing;

-- ===========================================================================
--  De app en de database waren het oneens over wie een kanaal mag maken
--
--  Gemeld: drieëntwintig overlegkanalen, honderd pogingen elk, allemaal
--  geweigerd met "new row violates row-level security policy for table
--  channels". De kanalen deugden, de regel deugde, en toch kwam er niets door.
--
--  Wat er aan de hand was
--  ----------------------
--
--  Twee plekken beslissen of je een kanaal mag aanmaken, en ze kijken naar
--  verschillende dingen.
--
--    de app         perms.can('chat.manage')  -- een RECHT
--    de database    is_management() or is_supervisor()  -- een ROL
--
--  Zolang die twee samenvallen merkt niemand het. Maar het recht chat.manage
--  is ook los toe te kennen aan iemand zonder die rollen, en dan zegt de app
--  ja en de database nee.
--
--  Het gevolg is erger dan een geweigerde knop. Het overlegscherm zet bij het
--  eerste bezoek de vaste kanalen klaar -- vijf algemene plus een per
--  vestiging. Sinds er achttien vestigingen in staan zijn dat er drieëntwintig
--  in één keer. Allemaal lokaal aangemaakt, allemaal de wachtrij in, en
--  allemaal voor altijd geweigerd.
--
--  Nagemeten in de testdatabase, met dezelfde regels en dezelfde rijen:
--
--    management     mag
--    leidinggevende mag
--    medewerker     new row violates row-level security policy
--
--  Woordelijk de melding uit productie.
--
--  Wat hier verandert
--  ------------------
--
--  De database gaat naar hetzelfde kijken als de app: het recht. De rollen
--  blijven staan -- management en een leidinggevende hebben chat.manage toch
--  al, dus voor hen verandert er niets, en zonder die takken zou een verkeerd
--  gezette instelling het hele overleg op slot zetten.
--
--  heeft_recht() is precies waarvoor dit soort gevallen bestaat; het wordt in
--  dit schema al gebruikt voor hours.clock en admin.desk.
--
--  Waarom niet andersom -- de app strenger maken
--  ---------------------------------------------
--
--  Dan zou een los toegekend recht in de app zichtbaar zijn en niet werken, en
--  dat is precies het soort stilte waar dit probleem uit voortkwam. Eén plek
--  hoort te beslissen, en dat is de database.
--
--  Opnieuw draaien mag.
-- ===========================================================================

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (
    -- De uitweg voor de upsert-val; zie 0031 en 0040.
    public.rij_bestaat('public.channels'::regclass, id)
    or (
      public.is_staff()
      and (
        public.is_management()
        or public.is_supervisor()
        or public.heeft_recht('chat.manage')
        -- Een gesprek mag je aanmaken als je er zelf in zit. Dat is geen
        -- beheer maar iemand aanspreken, en daar is geen recht voor nodig.
        or (kind = 'gesprek' and public.my_id() = any(member_ids))
      )
    )
  );

/*
 * En bijwerken op dezelfde voet.
 *
 * Zou dat achterblijven, dan kun je een kanaal aanmaken en daarna de naam niet
 * meer wijzigen -- en dat is precies het soort halve toestemming waar niemand
 * iets aan heeft.
 */
drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update to authenticated
  using (
    public.is_management()
    or public.is_supervisor()
    or public.heeft_recht('chat.manage')
    or (kind = 'gesprek' and public.my_id() = any(member_ids))
  )
  with check (
    public.is_management()
    or public.is_supervisor()
    or public.heeft_recht('chat.manage')
    or (kind = 'gesprek' and public.my_id() = any(member_ids))
  );

-- ===========================================================================
--  Facturen boeken zichzelf
--
--  Wat er nu gebeurt: er komt een factuur binnen per mail, ontvang-mail zet er
--  een kostenpost van met bedrag 0, en daar blijft het. Het uitlezen gebeurt
--  pas als iemand in de app op "laat de factuur voorlezen" drukt. Dat is
--  precies het handwerk dat weg moest.
--
--  Wat hier bijkomt is wat er nodig is om dat automatisch te doen: een
--  grootboek om op te boeken, tags om op te sorteren, en een geheugen dat
--  onthoudt hoe een leverancier de vorige keer is geboekt.
--
--  Het geheugen is het belangrijkste stuk
--  --------------------------------------
--
--  Raden op trefwoorden werkt één keer. Daarna weet je iets beters: hoe die
--  leverancier de vorige keer is geboekt, door een mens die ernaar keek. Dat
--  is een veel sterker signaal dan welk trefwoord ook.
--
--  Dus twee lagen. Kent het geheugen deze leverancier, dan die boeking. Zo
--  niet, dan trefwoorden als eerste gok, duidelijk gemarkeerd als gok. En elke
--  keer dat iemand een kostenpost goedkeurt, leert het geheugen bij.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Het grootboek
--
--  Alleen de rekeningen die hier werkelijk gebruikt worden. Een compleet
--  rekeningschema overtypen levert een lijst op waar niemand doorheen komt.
-- ---------------------------------------------------------------------------

create table if not exists public.grootboek (
  /* De sleutel heet id en niet code, en dat is geen smaakkwestie.
     De synchronisatie in de app vergelijkt elke binnengehaalde rij met wat er
     nog in de wachtrij staat, en doet dat op rij.id -- voor alle tabellen,
     zonder uitzondering. Een tabel met een andere sleutelnaam levert daar
     stilletjes "undefined" op, en dan overschrijft binnenkomende post een
     wijziging die nog niet verstuurd was. Eén afwijkende tabel is die klasse
     fouten niet waard. */
  id          text primary key,
  code        text not null unique,
  naam        text not null,
  /* Waar deze rekening op te herkennen is, als het geheugen nog niets weet. */
  trefwoorden text[] not null default '{}',
  /* Het gebruikelijke btw-percentage. Wat op de factuur staat gaat altijd
     voor -- dit is alleen een vangnet voor een onleesbare bon. */
  btw_pct     integer not null default 21,
  actief      boolean not null default true,
  updated_at  bigint not null default public.now_ms()
);

comment on table public.grootboek is
  'De grootboekrekeningen waarop kosten worden geboekt. Klein gehouden: '
  'alleen wat hier echt gebruikt wordt.';

-- ---------------------------------------------------------------------------
--  De tags
--
--  Losse etiketten om op te filteren, naast de grootboekrekening. Een factuur
--  van Enexis is "elektra" en boekt op energie; die twee zijn niet hetzelfde
--  en het een vervangt het ander niet.
-- ---------------------------------------------------------------------------

create table if not exists public.kosten_tags (
  -- Zelfde reden als bij grootboek hierboven: de sleutel heet id.
  id          text primary key,
  naam        text not null unique,
  trefwoorden text[] not null default '{}',
  actief      boolean not null default true,
  updated_at  bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Het geheugen
--
--  Eén regel per leverancier: zo is hij de vorige keer geboekt. Wordt bij elke
--  goedkeuring bijgewerkt, zodat de tweede factuur van dezelfde partij vanzelf
--  goed staat.
--
--  De sleutel is de leveranciersnaam in kleine letters. Niet het btw-nummer:
--  dat staat lang niet op elke bon, en dan zou het geheugen juist bij de
--  slordige leveranciers niets onthouden.
-- ---------------------------------------------------------------------------

create table if not exists public.leverancier_boeking (
  leverancier    text primary key,
  grootboek_code text references public.grootboek(code) on delete set null,
  tags           text[] not null default '{}',
  /* Hoe vaak het zo is geboekt. Eén keer is een aanwijzing, tien keer is een
     gewoonte -- en dat verschil wil je kunnen zien voordat je erop vertrouwt. */
  keren          integer not null default 1,
  laatst_at      bigint not null default public.now_ms(),
  updated_at     bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Wat er op de kostenpost bijkomt
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists tags           text[] not null default '{}';
alter table public.expenses add column if not exists grootboek_code text;
alter table public.expenses add column if not exists factuurnummer  text;
alter table public.expenses add column if not exists vervaldatum    bigint;
alter table public.expenses add column if not exists btw_bedrag     numeric(12,2);
/* Waar de indeling vandaan komt: uit het geheugen, geraden, of met de hand
   gezet. Zonder dit weet niemand of dat rekeningnummer een gok is. */
alter table public.expenses add column if not exists indeling_bron  text
  check (indeling_bron in ('geheugen', 'geraden', 'handmatig'));

comment on column public.expenses.indeling_bron is
  'Waar grootboek_code en tags vandaan komen. "geraden" betekent: op '
  'trefwoorden gegokt omdat deze leverancier nog niet bekend was -- daar hoort '
  'iemand naar te kijken.';

-- ---------------------------------------------------------------------------
--  Voorstellen
--
--  Geeft terug hoe deze factuur waarschijnlijk geboekt moet worden. Beslist
--  niets: de aanroeper zet het op de kostenpost en een mens keurt goed.
-- ---------------------------------------------------------------------------

create or replace function public.factuur_indelen(
  leverancier_in text,
  omschrijving_in text default ''
)
returns table (grootboek_code text, tags text[], bron text)
language sql stable security definer set search_path = public as $$
  with zoek as (
    select
      lower(trim(coalesce(leverancier_in, ''))) as lev,
      lower(coalesce(leverancier_in, '') || ' ' || coalesce(omschrijving_in, '')) as alles
  ),
  -- 1. Kennen we deze leverancier?
  uit_geheugen as (
    select b.grootboek_code, b.tags, 'geheugen'::text as bron
      from public.leverancier_boeking b, zoek z
     where b.leverancier = z.lev
       and b.grootboek_code is not null
  ),
  -- 2. Zo niet: raden op trefwoorden.
  geraden_rekening as (
    select g.code
      from public.grootboek g, zoek z
     where g.actief
       and exists (select 1 from unnest(g.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
     order by g.code
     limit 1
  ),
  geraden_tags as (
    select coalesce(array_agg(k.naam order by k.naam), '{}') as tags
      from public.kosten_tags k, zoek z
     where k.actief
       and exists (select 1 from unnest(k.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
  )
  select * from uit_geheugen
  union all
  select (select code from geraden_rekening),
         (select tags from geraden_tags),
         'geraden'
   where not exists (select 1 from uit_geheugen)
  limit 1;
$$;

/*
 * Leren van een goedkeuring.
 *
 * Wordt aangeroepen als iemand een kostenpost akkoord geeft. Vanaf dat moment
 * staat de volgende factuur van diezelfde partij meteen goed.
 */
create or replace function public.boeking_onthouden(
  leverancier_in text,
  grootboek_in text,
  tags_in text[]
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  sleutel text := lower(trim(coalesce(leverancier_in, '')));
begin
  /*
   * Wie hier niets te zoeken heeft, leert het geheugen ook niets.
   *
   * Deze functie is security definer en stond open voor iedere ingelogde
   * gebruiker. Een monteur ziet geen enkele kostenpost, maar kon wel bepalen
   * op welke rekening de facturen van een leverancier voortaan landen -- en
   * dat zou niemand merken, want het is precies wat de functie hoort te doen.
   *
   * Stil weglopen en niet klagen: dit wordt aangeroepen naast een
   * goedkeuring, en die mag niet stuklopen op een recht dat er toch al voor
   * zorgt dat je hier niet komt.
   */
  if not (public.is_management() or public.heeft_recht('admin.desk')) then
    return;
  end if;

  if sleutel = '' or grootboek_in is null then return; end if;

  insert into public.leverancier_boeking
    (leverancier, grootboek_code, tags, keren, laatst_at, updated_at)
  values (sleutel, grootboek_in, coalesce(tags_in, '{}'), 1,
          public.now_ms(), public.now_ms())
  on conflict (leverancier) do update
    set grootboek_code = excluded.grootboek_code,
        tags           = excluded.tags,
        -- Doortellen, niet resetten: het aantal keren is het vertrouwen.
        keren          = public.leverancier_boeking.keren + 1,
        laatst_at      = public.now_ms(),
        updated_at     = public.now_ms();
end;
$$;

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  Het grootboek en de tags mag iedereen die kosten ziet ook lezen -- anders
--  staat er een code op een bon waar niemand de naam bij weet. Wijzigen is
--  administratie of management.
-- ---------------------------------------------------------------------------

alter table public.grootboek           enable row level security;
alter table public.kosten_tags         enable row level security;
alter table public.leverancier_boeking enable row level security;

do $$
declare t text;
begin
  /* leverancier_boeking staat hier niet bij: die tabel heeft geen id-kolom
     en wordt ook nooit rechtstreeks geschreven -- dat gaat via
     boeking_onthouden(). Lezen mag wel, en dat staat hieronder los. */
  foreach t in array array['grootboek', 'kosten_tags'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.is_staff())',
      t, t);

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      /* De sleutelkolom heet id, en dat moet ook: rij_bestaat kijkt hard
         naar "where id = $1". Hier stond per tabel een andere kolom (code,
         naam, leverancier), en dan zoekt hij een rij met id = '4031' terwijl
         die id gb_4031 heet. Die vlucht slaat dan altijd mis, en dan is dit
         weer een tabel die "new row violates row-level security" geeft zodra
         de app een bestaande rij bijwerkt met een upsert. */
      'create policy %I_insert on public.%I for insert to authenticated '
      'with check (public.rij_bestaat(''public.%I''::regclass, id) '
      '            or public.is_management() or public.heeft_recht(''admin.desk''))',
      t, t, t);

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated '
      'using (public.is_management() or public.heeft_recht(''admin.desk'')) '
      'with check (public.is_management() or public.heeft_recht(''admin.desk''))',
      t, t);
  end loop;
end $$;

revoke execute on function public.factuur_indelen(text, text) from public, anon, authenticated;
grant  execute on function public.factuur_indelen(text, text) to service_role, authenticated;
revoke execute on function public.boeking_onthouden(text, text, text[]) from public, anon;
grant  execute on function public.boeking_onthouden(text, text, text[]) to service_role, authenticated;

-- ---------------------------------------------------------------------------
--  Een begin
--
--  De rekeningen en tags die in de huidige administratie voorkomen. Bedoeld om
--  meteen iets te hebben; aanvullen gaat in de app.
-- ---------------------------------------------------------------------------

insert into public.grootboek (id, code, naam, trefwoorden, btw_pct)
select 'gb_' || v.code, v.code, v.naam, v.trefwoorden, v.btw_pct
from (values
  ('4000', 'Inkoop wasmiddelen en chemie',
   array['wasmiddel','chemie','shampoo','ontvetter','zeep','wairtec','cemex'], 21),
  ('4010', 'Energie',
   array['enexis','eneco','vattenfall','essent','elektra','stroom','gas','energie'], 21),
  ('4015', 'Water en osmose',
   array['water','osmose','vitens','brabant water','evides'], 9),
  ('4020', 'Afval en milieu',
   array['afval','prezero','renewi','container','milieu','suez'], 21),
  ('4025', 'Onderhoud en reparatie',
   array['onderhoud','reparatie','installatie','monteur','service','storing'], 21),
  ('4031', 'Contributies en heffingen',
   array['contributie','lidmaatschap','heffing','mkb','kamer van koophandel','kvk'], 0),
  ('4040', 'Huur en huisvesting',
   array['huur','pacht','huisvesting','erfpacht'], 21),
  ('4050', 'Verzekeringen',
   array['verzekering','polis','assurantie','premie'], 0),
  ('4060', 'Kantoor en administratie',
   array['kantoor','administratie','accountant','boekhoud','tork','papier'], 21),
  ('4070', 'Telefoon en internet',
   array['telefoon','internet','kpn','vodafone','ziggo','t-mobile','odido'], 21),
  ('4080', 'Vervoer en brandstof',
   array['brandstof','diesel','tankpas','shell','bp','total','leasing','lease'], 21),
  ('4090', 'Overige bedrijfskosten', array[]::text[], 21)
) as v(code, naam, trefwoorden, btw_pct)
on conflict (code) do nothing;

insert into public.kosten_tags (id, naam, trefwoorden)
select 'tag_' || v.naam, v.naam, v.trefwoorden
from (values
  ('afval',    array['afval','container','prezero','renewi','suez']),
  ('cemex',    array['cemex']),
  ('elektra',  array['elektra','stroom','enexis','eneco','vattenfall','essent']),
  ('enexis',   array['enexis']),
  ('finance',  array['bank','rente','financiering','lease','verzekering']),
  ('gas',      array['gas','aardgas']),
  ('osmose',   array['osmose','waterontharding','omgekeerde osmose']),
  ('prezero',  array['prezero']),
  ('tork',     array['tork']),
  ('wairtec',  array['wairtec'])
) as v(naam, trefwoorden)
on conflict (naam) do nothing;

-- ---------------------------------------------------------------------------
--  Waar facturen binnenkomen
--
--  Per vestiging een eigen adres: inkoop.<vestiging>@<domein>. Dan hoeft
--  niemand achteraf uit te zoeken bij welke vestiging een bon hoort -- dat
--  staat al in het adres waar hij op binnenkwam.
--
--  Het domein is een instelling en geen vaste waarde in de code. Nu is dat het
--  huidige adres; gaat er later een eigen domein komen, dan is dat één regel
--  wijzigen in plaats van een nieuwe versie uitbrengen.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_inkoop_domein', 'inkoop_domein', 'preview.truckwash.cloud',
   'Het domein waarop facturen binnenkomen. Het adres per vestiging wordt '
   'inkoop.<vestiging>@<domein>, bijvoorbeeld inkoop.venlo@preview.truckwash.cloud. '
   'Let op: een nieuw domein moet eerst bij Resend zijn ingesteld voordat er '
   'post op binnenkomt.'),
  ('in_inkoop_voorvoegsel', 'inkoop_voorvoegsel', 'inkoop',
   'Het deel vóór de punt in het factuuradres. Standaard "inkoop", dus '
   'inkoop.venlo@... Wijzig dit alleen als de mailroutering meeverandert.'),
  ('in_factuur_automatisch', 'factuur_automatisch', 'ja',
   'Of een binnengekomen factuur meteen wordt uitgelezen en ingedeeld. Op '
   '"nee" blijft hij staan tot iemand in de app op voorlezen drukt.')
on conflict (id) do nothing;

-- ===========================================================================
--  Een kassa ziet wie er bij hem mag werken
--
--  De kassa gaat afdwingen dat iemand alleen aanmeldt op de vestiging waar hij
--  staat -- wie op Asten staat, mag de kassa van Asten en verder geen enkele.
--  Wie overal mag werken, mag elke kassa.
--
--  Dat tweede deel werkte niet, en niet door de kassa maar door deze regel:
--
--      profiles_select:  auth_id = auth.uid()
--                        or sees_all_locations()
--                        or (is_staff() and in_my_locations(location_id))
--
--  sees_all_locations() gaat over wie kíjkt, niet over wie bekeken wordt. Een
--  kassa in Asten ziet dus: zijn eigen dossier, iedereen op Asten, en iedereen
--  zonder vestiging (want in_my_locations(null) is waar). Iemand van het
--  kantoor die overal mag werken staat op de vestiging van het kantoor -- en
--  die is voor de kassa in Asten onzichtbaar. Zijn nummer staat niet in de
--  cache, dus "dat personeelsnummer is niet bekend op deze vestiging".
--
--  Met één vestiging viel dat niet op. Met achttien wel.
--
--  Waarom dit alleen voor een kassa geldt
--  -------------------------------------
--
--  Een dossier bevat meer dan een naam: telefoonnummer, uurloon, aantekeningen.
--  Zou deze regel voor iedereen gelden, dan zag elke werknemer op elke
--  vestiging het dossier van iedereen die overal mag werken. Dat is een prijs
--  die niemand gevraagd heeft.
--
--  Een apparaataccount is wat anders. Dat is geen mens die rondkijkt maar een
--  kassa die moet weten wie er voor hem staat, en het is nodig voor precies
--  één ding: een nummer of een badge herkennen.
--
--  Wat er niet mee opgelost is
--  ---------------------------
--
--  De kassa haalt hele dossierrijen op en bewaart die in zijn eigen cache. Er
--  staat vanaf nu dus ook het uurloon van het kantoor op een tablet achter de
--  balie. Dat was al zo voor iedereen op die vestiging; dit maakt de kring
--  groter en niet anders. De echte oplossing is dat de kassa een smalle
--  weergave leest met alleen wat hij nodig heeft -- naam, nummer, rollen,
--  vestiging -- en dat is een eigen klus. Zolang die er niet is, hoort dit
--  hardop te staan.
-- ===========================================================================

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    auth_id = auth.uid()
    or public.sees_all_locations()
    or (public.is_staff() and public.in_my_locations(location_id))
    /*
     * En dit is nieuw: een kassa mag zien wie er bij hem mag werken.
     *
     * Twee gevallen, en ze volgen precies de regel die de kassa daarna zelf
     * toetst (magOpKassa in src/lib/code.ts):
     *
     *   all_locations   deze persoon mag overal werken, dus ook hier
     *   manages         hij heeft leiding over de vestiging van deze kassa
     */
    or (
      public.is_apparaataccount(auth.uid())
      and (
        coalesce(all_locations, false)
        or (manages is not null and manages && public.my_locations())
      )
    )
  );

-- ===========================================================================
--  De foto's gaan mee naar de website
--
--  De vestigingspagina op de site toont een vaste stockfoto: dezelfde
--  wasstraat voor Aalsmeer, Venlo en Maasvlakte, met twee uitzonderingen die
--  met de hand in brok.js staan. Terwijl in het beheerscherm per vestiging
--  echte foto's zijn geupload, met een bijschrift en een omslag die vooraan
--  staat. Die kwamen niet verder dan de app.
--
--  Vanaf hier geeft website_vestigingen() ze mee, als een lijst per
--  vestiging. De omslag staat vooraan en daarna komt de volgorde zoals die
--  in het scherm is gesleept -- dat is dezelfde volgorde die de app zelf
--  toont, zodat wat je in het beheerscherm ziet ook is wat de site laat zien.
--
--  Wat er per foto meegaat
--  -----------------------
--
--    pad         het pad in de emmer "vestigingen" (die is openbaar leesbaar,
--                zie 0026); de serverfunctie maakt er de volledige url van
--    bijschrift  wat er in het scherm bij is getikt, of null
--    cover       staat deze vooraan
--    volgorde    het sorteergetal uit het scherm
--
--  En met opzet NIET: wie hem heeft geupload, wanneer, hoe groot het
--  bestand is, welk id de regel heeft. Dat is administratie van binnen en
--  hoort niet op een openbare pagina. scripts/sqltest.mjs bewaakt dat.
--
--  Waarom drop + create: de functie krijgt een kolom erbij, en bij een
--  "returns table" kan dat niet met "create or replace". Dezelfde reden als
--  in 0035, en met dezelfde valkuil: het droppen gooit de rechten weg, dus
--  die staan onderaan opnieuw.
-- ===========================================================================

drop function if exists public.website_vestigingen();

create function public.website_vestigingen()
returns table (
  slug        text,
  naam        text,
  adres       text,
  postcode    text,
  plaats      text,
  telefoon    text,
  email       text,
  lat         double precision,
  lon         double precision,
  wasstraten  integer,
  openingstijden jsonb,
  intro       text,
  bereikbaar  text,
  bijzonder   text,
  diensten    text[],
  punten      text[],
  fotos       jsonb
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten, l.punten,
    /*
     * Een lege lijst en geen null: het bouwscript van de site doet
     * fotos.map(...) en moet dat kunnen doen zonder eerst te kijken.
     *
     * De volgorde staat IN de aggregatie. Een "order by" op de buitenste
     * select zou de vestigingen sorteren en de foto's laten staan zoals
     * ze toevallig uit de tabel komen.
     */
    coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'pad',        f.storage_path,
                 'bijschrift', f.caption,
                 'cover',      f.is_cover,
                 'volgorde',   f.sort)
               order by f.is_cover desc, f.sort asc, f.uploaded_at asc)
        from public.location_photos f
       where f.location_id = l.id
    ), '[]'::jsonb)
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * De rechten opnieuw zetten, precies zoals in 0033.
 *
 * "drop function" gooit ook de rechten weg, en de nieuwe functie krijgt van
 * Supabase weer automatisch anon en authenticated erbij via de standaardregel
 * in het schema. Intrekken bij PUBLIC alleen haalt die eigen rechten er niet
 * af -- daarom staan anon en authenticated er apart bij. Zonder deze regels
 * staat het gat dat in 0033 en 0034 is gedicht meteen weer open, en dan kan
 * een onbekende bezoeker de hele lijst zelf opvragen.
 */
revoke execute on function public.website_vestigingen() from public, anon, authenticated;
grant  execute on function public.website_vestigingen() to service_role;

-- ===========================================================================
--  Een verkoopfactuur is geen kostenpost
--
--  Draai dit ná 0046. Opnieuw draaien mag.
--
--  Wat er misging
--  --------------
--
--  Alles wat met een PDF op een inkoopadres binnenkwam werd een kostenpost.
--  Ook een factuur die Truckwash zélf aan een klant had gestuurd -- een klant
--  die hem terugmailt met een vraag, een collega die hem doorstuurt "voor de
--  administratie". Die stond dan aan de kostenkant, met het eigen btw-nummer
--  als leverancier, en niemand zag het verschil met een echte rekening.
--
--  De lezer kijkt nu wie er bovenaan het stuk staat. Is dat Truckwash, dan
--  haalt de post de zojuist aangemaakte kostenpost weer weg en zet op het
--  bericht dat het een verkoopfactuur is. Daarvoor is deze kolom.
--
--  Bewust geen verkoopadministratie. Alleen herkennen, apart zetten en
--  duidelijk laten zien; wat er verder mee moet is aan de administratie.
-- ===========================================================================

alter table public.mailbox add column if not exists soort text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mailbox_soort_check') then
    alter table public.mailbox
      add constraint mailbox_soort_check
      check (soort is null or soort in ('inkoop','verkoop','overig'));
  end if;
end $$;

comment on column public.mailbox.soort is
  'Wat de post ervan maakte: inkoop (er is een kostenpost van gemaakt), '
  'verkoop (een factuur van Truckwash zelf, geen kostenpost) of overig (geen '
  'bijlage om te lezen). Leeg zolang de lezer er nog niet naar keek of het '
  'niet zeker wist, en bij post van vóór deze migratie.';

-- Het scherm zet de verkoopfacturen bij elkaar; dat hoort niet de hele
-- postbus door te lopen.
create index if not exists mailbox_soort_idx on public.mailbox (soort) where soort is not null;

-- ---------------------------------------------------------------------------
--  De eigen nummers, voor het tweede slot
--
--  De post haalt een kostenpost pas weg als het stuk naast de lezing
--  "verkoop" van het model óók een nummer van Truckwash zelf draagt: KvK,
--  btw-nummer of IBAN. Het model alleen is niet genoeg -- een andere wasserij
--  met "Truckwash" in de naam of een scan met een stempel "ontvangen" leest
--  het soms als verkoop, en een weggehaalde kostenpost komt niet vanzelf
--  terug.
--
--  Bewust leeg aangemaakt. Zolang ze leeg zijn wordt er niets weggehaald en
--  blijft elke factuur een kostenpost, met de twijfel erop. Invullen in het
--  ontwikkelaarsscherm bij de inkoopadressen, of hier met een update.
--  Meerdere nummers mag, met een komma ertussen (één per werkmaatschappij).
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_eigen_kvk', 'eigen_kvk', '',
   'Het KvK-nummer van Truckwash 1 Group (meerdere mag, met een komma). De '
   'post gebruikt het om een doorgestuurde verkoopfactuur van Truckwash zelf '
   'te herkennen; leeg betekent dat er nooit een kostenpost wordt weggehaald.'),
  ('in_eigen_btw', 'eigen_btw', '',
   'Het btw-nummer van Truckwash 1 Group, bijvoorbeeld NL123456789B01 '
   '(meerdere mag, met een komma). Zelfde doel als het KvK-nummer.'),
  ('in_eigen_iban', 'eigen_iban', '',
   'De eigen bankrekening(en) van Truckwash, met een komma ertussen. Zelfde '
   'doel als het KvK-nummer: staat deze op een factuur als rekening om op te '
   'betalen, dan is het een factuur van Truckwash zelf.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  De verwijdering moet zichzelf melden
--
--  Dit is de eerste plek waar de server een kostenpost weghaalt achter de app
--  om. Een apparaat dat de bon net had opgehaald houdt hem anders in zijn
--  lokale kopie staan -- precies het spook uit 0032 en 0038, nu op expenses.
--  Dezelfde trigger als daar, zodat elk apparaat hem bij het volgende ophalen
--  opruimt.
-- ---------------------------------------------------------------------------

drop trigger if exists expenses_verwijderd on public.expenses;
create trigger expenses_verwijderd
  after delete on public.expenses
  for each row execute function public.meld_verwijdering();

-- ===========================================================================
--  Trucksupply ziet de voorraad
--
--  Draai dit ná 0047. Opnieuw draaien mag.
--
--  Waar het om gaat
--  ----------------
--
--  De vestigingen bestellen hun spullen -- shampoo, ontvetter, doeken -- bij
--  één leverancier, Trucksupply. Tot nu toe ging dat zo: iemand op de
--  vestiging ziet dat de ontvetter op is, belt of appt, en hoopt dat het
--  aankomt voordat de laatste fles leeg is. Niemand aan de leverancierskant
--  ziet de standen, dus die kan niets zien aankomen.
--
--  Vanaf nu kijkt Trucksupply mee. Een eigen rol, die op alle vestigingen de
--  voorraad ziet maar verder geen personeel is: geen rooster, geen uren, geen
--  dossiers. Zakt een stand onder het minimum, dan ontstaat er een alarm dat
--  bij de leverancier binnenkomt -- meteen, en 's ochtends nog eens als
--  niemand ernaar keek. Van een alarm wordt een bestelling gemaakt, met een
--  nummer, een pakbon en een verzendstatus.
--
--  Wat hier in de database komt: de rol, de kolommen die een artikel voor de
--  leverancier bruikbaar maken (artikelnummer, foto, inkoopprijs), de
--  alarmen, de bestellingen met hun regels, en een eerste plek voor de
--  koppeling met Exact. De mails en de wekker staan in een Edge Function
--  (supabase/functions/trucksupply) en een GitHub-workflow
--  (.github/workflows/voorraad.yml).
--
--  Twee reparaties die onderweg meekomen
--  -------------------------------------
--
--  a. is_staff() is in 0029 ingekort. Die migratie voegde de administratie
--     toe en schreef de functie opnieuw uit als employee / administratie /
--     management -- en liet daarmee supervisor, technician en developer
--     vallen, die 0006 er eerder in had gezet. Sindsdien ziet een
--     leidinggevende met alléén de rol supervisor het rooster niet meer, en
--     de monteur de storingen niet. Het viel niet op omdat vrijwel iedereen
--     de rol employee ernaast heeft. Hier staan ze alle zes; trucksupply
--     bewust NIET, dat is geen personeel.
--
--  b. notifications.to_role kent een vaste lijst rollen (0007). Een
--     bestelaanvraag van een vestiging is een bericht aan "wie de inkoop
--     doet", en dat is een rol, geen persoon: wie er vandaag bij Trucksupply
--     achter het scherm zit weet de vestiging niet, en hoort dat ook niet te
--     hoeven weten. Dus komt trucksupply in de lijst. to_user_id blijft
--     bestaan voor het geval iemand tóch één persoon wil aanspreken.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De rol
--
--  Twee functies. is_trucksupply() zegt wie je bent; mag_leverancier() zegt
--  wat je mag, en daar valt ook het management onder en iedereen met het
--  losse recht supply.orders -- zodat een medewerker van kantoor kan
--  invallen zonder dat je hem van rol hoeft te laten wisselen.
-- ---------------------------------------------------------------------------

create or replace function public.is_trucksupply()
returns boolean language sql stable as $$
  select 'trucksupply' = any(public.my_roles());
$$;

create or replace function public.mag_leverancier()
returns boolean language sql stable as $$
  select public.is_trucksupply()
      or public.is_management()
      or public.heeft_recht('supply.orders');
$$;

/* Geen security definer, maar wel dezelfde hygiëne als in 0034: anon krijgt
   elke nieuwe functie standaard, en er is geen enkele reden waarom een
   bezoeker zonder inlog zou mogen vragen of hij Trucksupply is. */
revoke execute on function public.is_trucksupply()   from public, anon;
revoke execute on function public.mag_leverancier()  from public, anon;
grant  execute on function public.is_trucksupply()   to authenticated, service_role;
grant  execute on function public.mag_leverancier()  to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  Reparatie a: is_staff() is weer compleet
--
--  Woordelijk de lijst van 0006, plus de administratie uit 0029. Volgorde en
--  vorm als toen, zodat een volgende die hier iets aan toevoegt ziet dat het
--  een lijst is en niet drie losse gevallen.
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee'      = any(public.my_roles())
      or 'supervisor'    = any(public.my_roles())
      or 'technician'    = any(public.my_roles())
      or 'administratie' = any(public.my_roles())
      or 'management'    = any(public.my_roles())
      or 'developer'     = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  Reparatie b: een melding mag aan de leverancier gericht zijn
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_to_role_allowed;
alter table public.notifications
  add constraint notifications_to_role_allowed
  check (to_role is null or to_role in
    ('employee','supervisor','technician','customer','management','developer',
     'trucksupply'));

-- ---------------------------------------------------------------------------
--  Wat een artikel voor de leverancier nodig heeft
--
--  De voorraadtabel is gemaakt voor de vestiging: naam, stand, minimum. De
--  leverancier heeft meer nodig om er een bestelling van te maken. Alles met
--  add column if not exists, want de tabel staat vol.
-- ---------------------------------------------------------------------------

alter table public.inventory_items add column if not exists sku               text;
alter table public.inventory_items add column if not exists omschrijving      text;
alter table public.inventory_items add column if not exists image             text;
/* Wat er standaard per keer wordt meegestuurd. Een alarm op ontvetter
   betekent niet "stuur één liter" maar "stuur wat er altijd gaat". */
alter table public.inventory_items add column if not exists bestelhoeveelheid numeric not null default 0;
/* Wat Trucksupply ervoor rekent. price_per_unit blijft de interne waarde
   waarmee de vestiging zijn verbruik waardeert; die twee lopen uiteen. */
alter table public.inventory_items add column if not exists inkoopprijs       numeric;
alter table public.inventory_items add column if not exists actief            boolean not null default true;
/* De artikelcode in Exact. Nog nergens voor gebruikt; staat er zodat de
   koppeling straks geen tweede kolomronde nodig heeft. */
alter table public.inventory_items add column if not exists exact_code        text;

/*
 * Dezelfde rem als op pos_products.image (0027), om dezelfde reden: de foto
 * komt mee in elke synchronisatie van elk apparaat. NOT VALID, zodat een
 * bestaande database er niet op struikelt.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'inventory_items_image_maat'
       and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_image_maat
      check (image is null or length(image) <= 150000) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  De alarmen
--
--  Eén rij per keer dat een artikel onder zijn minimum zakt, en die rij
--  blijft bestaan tot de stand weer goed is. Het is dus geen momentopname
--  maar een geschiedenis: wanneer het begon, wie ernaar keek, wanneer er
--  over gemaild is en wanneer het over was. Dat laatste is wat je later wilt
--  weten -- "hoe lang zat Venlo zonder ontvetter" is een vraag die alleen te
--  beantwoorden is als je het hebt opgeschreven.
--
--  item_naam en stand staan er dubbel in, met opzet: een alarm van drie weken
--  terug moet nog leesbaar zijn als het artikel inmiddels is hernoemd of weg.
-- ---------------------------------------------------------------------------

create table if not exists public.voorraad_alarmen (
  id                text primary key,
  item_id           text references public.inventory_items(id) on delete cascade,
  item_naam         text not null default '',
  location_id       text,
  stand             numeric not null default 0,
  minimum           numeric not null default 0,
  ontstaan_at       bigint not null default public.now_ms(),
  gezien_at         bigint,
  gezien_door       text,
  gezien_door_naam  text,
  /* De directe mail, binnen een kwartier na het ontstaan. */
  gemaild_at        bigint,
  /* De ochtendmail, voor alles wat niemand gezien heeft. */
  ochtend_gemaild_at bigint,
  opgelost_at       bigint,
  updated_at        bigint not null default public.now_ms()
);

create index if not exists voorraad_alarmen_open_idx
  on public.voorraad_alarmen (item_id) where opgelost_at is null;
create index if not exists voorraad_alarmen_updated_idx
  on public.voorraad_alarmen (updated_at);

comment on table public.voorraad_alarmen is
  'Eén rij per keer dat een artikel onder zijn minimum zakte. Wordt door een '
  'trigger op inventory_items gemaakt en gesloten; de app zet alleen gezien_at.';

/*
 * De wacht op de voorraad.
 *
 * Bij elke wijziging van stand of minimum: onder het minimum en nog geen open
 * alarm, dan komt er een. Weer op of boven het minimum, dan gaat het open
 * alarm dicht. Precies één open alarm per artikel -- een tweede afboeking
 * terwijl het al onder het minimum staat is geen nieuw feit.
 *
 * Security definer, want wie een liter afboekt heeft daarmee geen
 * schrijfrecht op de alarmen, en dat hoort ook niet: de alarmen zijn van de
 * server. Bewust "stock < min_stock" en niet "<=": op het minimum staan is
 * de grens halen, niet eronder zitten. Een minimum van 0 geeft dus nooit een
 * alarm, en dat is de manier om een artikel buiten de bewaking te houden.
 */
create or replace function public.voorraad_alarm_bewaken()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  open_id text;
begin
  select id into open_id
    from public.voorraad_alarmen
   where item_id = new.id and opgelost_at is null
   limit 1;

  if new.stock < new.min_stock then
    if open_id is null then
      insert into public.voorraad_alarmen
        (id, item_id, item_naam, location_id, stand, minimum, ontstaan_at, updated_at)
      values
        ('va_' || replace(gen_random_uuid()::text, '-', ''),
         new.id, new.name, new.location_id, new.stock, new.min_stock,
         public.now_ms(), public.now_ms());
    else
      -- Het alarm staat er al; alleen de stand bijhouden, zodat de mail het
      -- laatste getal noemt en niet het getal van het moment van ontstaan.
      update public.voorraad_alarmen
         set stand = new.stock, minimum = new.min_stock, updated_at = public.now_ms()
       where id = open_id;
    end if;
  elsif open_id is not null then
    update public.voorraad_alarmen
       set opgelost_at = public.now_ms(), stand = new.stock, updated_at = public.now_ms()
     where id = open_id;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_items_alarm on public.inventory_items;
create trigger inventory_items_alarm
  after insert or update of stock, min_stock on public.inventory_items
  for each row execute function public.voorraad_alarm_bewaken();

/*
 * Wat er nú al onder het minimum staat.
 *
 * De trigger kijkt alleen bij een wijziging. Een artikel dat al weken onder
 * zijn minimum staat en waar niemand meer aan komt, zou dus nooit een alarm
 * krijgen -- terwijl dat precies het artikel is waar het om gaat. Eén keer
 * aanraken is genoeg: "update of stock" gaat af zodra de kolom in de SET
 * staat, ook als de waarde gelijk blijft. Bij opnieuw draaien gebeurt er
 * niets: de trigger maakt geen tweede open alarm.
 */
update public.inventory_items set stock = stock
 where stock < min_stock
   and not exists (select 1 from public.voorraad_alarmen a
                    where a.item_id = inventory_items.id and a.opgelost_at is null);

-- ---------------------------------------------------------------------------
--  De bestellingen
--
--  Een bestelling is van de leverancier: die maakt hem, pakt hem in en
--  verstuurt hem. De vestiging kan er een aanvragen (bron 'aanvraag'); de
--  status is niet van haar -- ook 'ontvangen' zet de leverancier of het
--  management, want bestellingen_update laat alleen die twee door. Wil de
--  vestiging zelf aftekenen, dan is dat een aparte policy in een latere
--  migratie, niet iets wat de app stilletjes probeert.
--
--  Het nummer (TS-2026-0001) komt uit bestelnummer(), niet uit de app. Twee
--  apparaten die tegelijk een bestelling maken krijgen anders hetzelfde
--  nummer, en een pakbon met een dubbel nummer is precies het soort fout
--  waar je een maand later een uur naar zoekt.
-- ---------------------------------------------------------------------------

create table if not exists public.bestellingen (
  id                   text primary key,
  nummer               text unique,
  location_id          text references public.locations(id) on delete set null,
  status               text not null default 'concept'
                       check (status in ('concept','bevestigd','ingepakt','verzonden','ontvangen','geannuleerd')),
  /* Waar hij vandaan komt: uit een alarm (voorraad), door de leverancier
     zelf (handmatig) of aangevraagd door de vestiging (aanvraag). */
  bron                 text not null default 'handmatig'
                       check (bron in ('voorraad','handmatig','aanvraag')),
  aangemaakt_door      text,
  aangemaakt_door_naam text,
  aangemaakt_at        bigint not null default public.now_ms(),
  bevestigd_at         bigint,
  verzonden_at         bigint,
  ontvangen_at         bigint,
  vervoerder           text,
  track_trace          text,
  opmerking            text,
  /* Als de pakbon per mail naar een ander is gegaan -- een magazijn, een
     vervoerder. Naar wie en wanneer, zodat "is hij al doorgestuurd" geen
     vraag is die je in je mailbox moet beantwoorden. */
  doorgestuurd_naar    text,
  doorgestuurd_at      bigint,
  updated_at           bigint not null default public.now_ms()
);

create index if not exists bestellingen_location_idx on public.bestellingen (location_id);
create index if not exists bestellingen_status_idx   on public.bestellingen (status);
create index if not exists bestellingen_updated_idx  on public.bestellingen (updated_at);

create table if not exists public.bestelregels (
  id             text primary key,
  bestelling_id  text not null references public.bestellingen(id) on delete cascade,
  item_id        text references public.inventory_items(id) on delete set null,
  /* Nogmaals de naam, om dezelfde reden als bij de alarmen: een pakbon van
     vorig jaar moet nog kloppen als het artikel weg is. */
  item_naam      text not null default '',
  aantal         numeric not null default 0,
  eenheid        text not null default 'stuk',
  prijs          numeric,
  /* Wat er werkelijk meegaat. Leeg tot de leverancier bij het inpakken
     invult wat er echt in de doos zit; bij verzenden wordt dít bijgeboekt,
     en anders het bestelde aantal. */
  geleverd       numeric,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists bestelregels_bestelling_idx on public.bestelregels (bestelling_id);
create index if not exists bestelregels_updated_idx    on public.bestelregels (updated_at);

/*
 * Het bestelnummer.
 *
 * Een sequence voor het volgnummer; het jaar ervoor. Bij het eerste nummer
 * van een nieuw jaar begint de teller opnieuw -- dat is wat mensen van zo'n
 * nummer verwachten, en het maakt "hoeveel bestellingen dit jaar" een blik op
 * het laatste nummer.
 *
 * Het jaar zit in de sequence zelf: de waarde is jaar * 10000 + volgnummer.
 * Zo weet de sequence uit zichzelf of hij nog in het goede jaar zit, zonder
 * een aparte teller en zonder in de tabel te kijken. Dat laatste was de
 * eerste versie, en die zat fout: zolang er nog geen bestelling van dit jaar
 * ís opgeslagen begon hij bij élke aanroep opnieuw, en gaf dus twee keer
 * 0001 aan wie twee nummers vroeg voordat hij de eerste had bewaard.
 *
 * Twee bestellingen op precies hetzelfde moment op 1 januari kunnen nog
 * steeds botsen: allebei zien ze een oud jaar, allebei zetten ze de teller
 * terug. De unieke sleutel op nummer vangt dat, en de tweede probeert het
 * opnieuw. Hoogstens één keer per jaar, en dan nog alleen op die seconde.
 *
 * Security definer, zodat de aanroeper geen recht op de sequence zelf nodig
 * heeft; en dus met de gebruikelijke revoke, zie 0034.
 */
create sequence if not exists public.bestelnummer_seq;

create or replace function public.bestelnummer()
returns text language plpgsql security definer set search_path = public as $$
declare
  jaar   integer := extract(year from now() at time zone 'Europe/Amsterdam')::integer;
  ondergrens bigint := jaar::bigint * 10000;
  laatste bigint;
  waarde bigint;
begin
  select last_value into laatste from public.bestelnummer_seq;
  if laatste < ondergrens then
    perform setval('public.bestelnummer_seq', ondergrens + 1, false);
  end if;
  waarde := nextval('public.bestelnummer_seq');
  return 'TS-' || jaar::text || '-' || lpad((waarde - ondergrens)::text, 4, '0');
end;
$$;

revoke execute on function public.bestelnummer() from public, anon, authenticated;
grant  execute on function public.bestelnummer() to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  De koppeling met Exact
--
--  Eén rij, met de tokens erin. Daarom RLS aan en géén enkele policy: niets
--  wat via de app binnenkomt mag hier bij, ook het management niet. De
--  Edge Function exact werkt met de servicesleutel en is de enige die leest
--  en schrijft. Een toegangstoken in een tabel die de app kan synchroniseren
--  is een toegangstoken op elke tablet.
-- ---------------------------------------------------------------------------

create table if not exists public.exact_koppeling (
  id                 text primary key default 'exact',
  division           text,
  access_token       text,
  refresh_token      text,
  token_verloopt_at  bigint,
  status             text not null default 'los',
  verbonden_door     text,
  verbonden_at       bigint,
  laatste_fout       text,
  /* De state van een lopende koppelpoging: uitgegeven bij verbind-url,
     gecontroleerd bij de terugkeer van Exact. Een eigen kolom en niet
     laatste_fout, want een fout en een lopende poging zijn twee dingen. */
  state              text,
  /* Wanneer die state is uitgegeven. Een poging die niet binnen een kwartier
     terugkomt vervalt vanzelf; anders blijft een verlaten koppelpoging voor
     altijd een geldige deur. */
  state_at           bigint,
  updated_at         bigint not null default public.now_ms()
);

alter table public.exact_koppeling add column if not exists state text;
alter table public.exact_koppeling add column if not exists state_at bigint;
alter table public.exact_koppeling enable row level security;

comment on table public.exact_koppeling is
  'De OAuth-tokens van Exact Online. RLS aan zonder policies: alleen de '
  'servicesleutel (Edge Function exact) komt erbij. Nooit een policy op zetten.';

-- ---------------------------------------------------------------------------
--  Instellingen
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_trucksupply_mail', 'trucksupply_mail', 'casper@truckwash1group.nl',
   'Het adres waar voorraadalarmen en de ochtendmail naartoe gaan. Meerdere '
   'mag, met een komma ertussen.'),
  ('in_trucksupply_ochtend_uur', 'trucksupply_ochtend_uur', '8',
   'Het uur (Nederlandse tijd) waarop de ochtendmail met alle nog niet '
   'geziene alarmen wordt verstuurd. De wekker (.github/workflows/voorraad.yml) '
   'loopt elk heel uur van 4 tot en met 9 UTC; de functie kijkt zelf of het '
   'lokaal dit uur is. Daardoor werkt 6 tot en met 10; een ander uur komt de '
   'wekker nooit langs en dan gaat er geen ochtendmail.'),
  ('in_exact_division', 'exact_division', '',
   'De administratie (division) in Exact Online. Leeg betekent: de standaard '
   'van het gekoppelde account.')
on conflict (id) do nothing;

/* De tabel instellingen was van het management (0042: lezen ook met
   admin.desk). Deze drie sleutels zijn van de leverancier: het is zíjn
   mailadres en zíjn ochtendmail. Zonder deze verruiming las het scherm
   Instellingen van Trucksupply een lege tabel en toonde het de terugval, en
   een Opslaan bleef in de wachtrij hangen op een RLS-fout terwijl de app
   "opgeslagen" zei. Alleen deze drie: het inkoopdomein en het adres van
   Trucky blijven van het management. */

create or replace function public.is_trucksupply_instelling(sleutel text)
returns boolean
language sql
stable
as $$
  select sleutel in ('trucksupply_mail', 'trucksupply_ochtend_uur', 'exact_division')
$$;

revoke execute on function public.is_trucksupply_instelling(text) from public, anon;
grant  execute on function public.is_trucksupply_instelling(text) to authenticated, service_role;

drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated
  using (
    public.is_management() or public.heeft_recht('admin.desk')
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

drop policy if exists instellingen_insert on public.instellingen;
create policy instellingen_insert on public.instellingen for insert to authenticated
  with check (
    public.rij_bestaat('public.instellingen'::regclass, id)
    or public.is_management()
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

drop policy if exists instellingen_update on public.instellingen;
create policy instellingen_update on public.instellingen for update to authenticated
  using (
    public.is_management()
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  )
  with check (
    public.is_management()
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

-- ---------------------------------------------------------------------------
--  Tijdstempels en verwijderingen
--
--  Zelfde twee triggers als op elke gesynchroniseerde tabel: de server zet
--  updated_at (0001), en een verwijdering meldt zichzelf (0038). Zonder de
--  tweede houdt elk apparaat een verwijderde conceptbestelling als spook.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['voorraad_alarmen', 'bestellingen', 'bestelregels', 'exact_koppeling'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;

  foreach t in array array['voorraad_alarmen', 'bestellingen', 'bestelregels'] loop
    execute format('drop trigger if exists %1$s_verwijderd on public.%1$I', t);
    execute format(
      'create trigger %1$s_verwijderd after delete on public.%1$I
       for each row execute function public.meld_verwijdering()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  De leverancier ziet de voorraad van álle vestigingen; dat is het hele
--  punt. De regel van 0004 blijft woordelijk staan, met de leverancier als
--  extra tak -- zodat een medewerker nog steeds alleen zijn eigen vestiging
--  ziet.
-- ---------------------------------------------------------------------------

drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items for select to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or public.is_trucksupply()
  );

drop policy if exists inventory_write on public.inventory_items;
create policy inventory_write on public.inventory_items for all to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or public.is_trucksupply()
  )
  with check (
    (public.is_staff() and public.in_my_locations(location_id))
    or public.is_trucksupply()
  );

/* De mutaties mag hij lezen (wat is er verbruikt), niet schrijven: afboeken
   doet de vestiging. stock_insert blijft zoals 0040 hem achterliet. */
drop policy if exists stock_select on public.stock_movements;
create policy stock_select on public.stock_movements for select to authenticated
  using (public.is_staff() or public.is_trucksupply());

-- --- alarmen ---

alter table public.voorraad_alarmen enable row level security;

drop policy if exists voorraad_alarmen_select on public.voorraad_alarmen;
create policy voorraad_alarmen_select on public.voorraad_alarmen for select to authenticated
  using (
    public.mag_leverancier()
    or (public.is_staff() and public.in_my_locations(location_id))
  );

/* Alarmen ontstaan in de trigger, die als eigenaar draait en hier niet langs
   komt. Deze regel is er voor de upsert-val (0040): de app zet gezien_at met
   een upsert, en die wordt óók tegen de insert-regel gehouden. */
drop policy if exists voorraad_alarmen_insert on public.voorraad_alarmen;
create policy voorraad_alarmen_insert on public.voorraad_alarmen for insert to authenticated
  with check (
    public.rij_bestaat('public.voorraad_alarmen'::regclass, id)
    or public.mag_leverancier()
  );

drop policy if exists voorraad_alarmen_update on public.voorraad_alarmen;
create policy voorraad_alarmen_update on public.voorraad_alarmen for update to authenticated
  using (public.mag_leverancier() or public.is_management())
  with check (public.mag_leverancier() or public.is_management());

-- --- bestellingen ---

alter table public.bestellingen enable row level security;
alter table public.bestelregels enable row level security;

drop policy if exists bestellingen_select on public.bestellingen;
create policy bestellingen_select on public.bestellingen for select to authenticated
  using (
    public.mag_leverancier()
    or (public.is_staff() and public.in_my_locations(location_id))
  );

/* Een vestiging mag alleen een aanvraag neerleggen, en alleen voor zichzelf.
   De rest van het maken is aan de leverancier. De 'is not null' staat er
   omdat in_my_locations(null) waar is (0004): zonder die regel kon elke
   medewerker een aanvraag voor niemand neerleggen, en die staat dan bij de
   leverancier zonder adres op de pakbon. */
drop policy if exists bestellingen_insert on public.bestellingen;
create policy bestellingen_insert on public.bestellingen for insert to authenticated
  with check (
    public.rij_bestaat('public.bestellingen'::regclass, id)
    or public.mag_leverancier()
    or (public.is_staff() and bron = 'aanvraag' and location_id is not null
        and public.in_my_locations(location_id))
  );

drop policy if exists bestellingen_update on public.bestellingen;
create policy bestellingen_update on public.bestellingen for update to authenticated
  using (public.mag_leverancier() or public.is_management())
  with check (public.mag_leverancier() or public.is_management());

/* Weg mag alleen wat nog nergens is: een concept. Een verzonden bestelling
   is een feit, en feiten annuleer je (status), je wist ze niet. */
drop policy if exists bestellingen_delete on public.bestellingen;
create policy bestellingen_delete on public.bestellingen for delete to authenticated
  using (public.mag_leverancier() and status = 'concept');

-- --- regels: alles loopt via de bestelling waar ze bij horen ---

drop policy if exists bestelregels_select on public.bestelregels;
create policy bestelregels_select on public.bestelregels for select to authenticated
  using (
    public.mag_leverancier()
    or exists (
      select 1 from public.bestellingen b
       where b.id = bestelling_id
         and public.is_staff() and public.in_my_locations(b.location_id))
  );

drop policy if exists bestelregels_insert on public.bestelregels;
create policy bestelregels_insert on public.bestelregels for insert to authenticated
  with check (
    public.rij_bestaat('public.bestelregels'::regclass, id)
    or public.mag_leverancier()
    or exists (
      select 1 from public.bestellingen b
       where b.id = bestelling_id
         and b.bron = 'aanvraag'
         and public.is_staff() and public.in_my_locations(b.location_id))
  );

drop policy if exists bestelregels_update on public.bestelregels;
create policy bestelregels_update on public.bestelregels for update to authenticated
  using (public.mag_leverancier() or public.is_management())
  with check (public.mag_leverancier() or public.is_management());

drop policy if exists bestelregels_delete on public.bestelregels;
create policy bestelregels_delete on public.bestelregels for delete to authenticated
  using (
    public.mag_leverancier()
    and exists (
      select 1 from public.bestellingen b
       where b.id = bestelling_id and b.status = 'concept')
  );

-- ---------------------------------------------------------------------------
--  Een artikel naar de kassa
--
--  De kassa verkoopt uit dezelfde voorraad, maar heeft zijn eigen
--  artikeltabel (pos_products, 0012). Die tabel is van de kassa: geen nieuwe
--  kolom, geen andere policy -- dat is een afspraak, zie 0040 en 0045.
--
--  Deze functie is daarom de enige deur. Ze maakt de kassarij aan als die er
--  nog niet is, en werkt hem anders bij; de koppeling is inventory_item_id,
--  die kolom bestond al. Wie mag: de leverancier, of wie de kassa toch al
--  beheert.
-- ---------------------------------------------------------------------------

create or replace function public.supply_artikel_naar_kassa(
  item_id    text,
  prijs_incl numeric,
  groep      text default null
)
returns text language plpgsql security definer set search_path = public as $$
declare
  artikel public.inventory_items%rowtype;
  product_id text;
begin
  if not (public.mag_leverancier() or public.mag_kassa_beheren()) then
    raise exception 'Alleen de leverancier of wie de kassa beheert zet een artikel op de kassa';
  end if;

  select * into artikel from public.inventory_items where id = item_id;
  if not found then
    raise exception 'Artikel % bestaat niet', item_id;
  end if;

  select id into product_id
    from public.pos_products
   where inventory_item_id = item_id
   order by updated_at desc
   limit 1;

  if product_id is null then
    product_id := 'pp_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.pos_products
      (id, location_id, code, name, group_name, unit, price_incl, kind,
       inventory_item_id, image, active, updated_at)
    values
      (product_id, artikel.location_id, coalesce(artikel.sku, ''), artikel.name,
       coalesce(nullif(trim(groep), ''), 'Overig'), artikel.unit,
       coalesce(prijs_incl, 0), 'artikel',
       artikel.id, artikel.image, artikel.actief, public.now_ms());
  else
    update public.pos_products
       set name        = artikel.name,
           unit        = artikel.unit,
           image       = artikel.image,
           location_id = artikel.location_id,
           code        = coalesce(artikel.sku, code),
           /* Geen prijs meegegeven: de kassaprijs blijft staan. */
           price_incl  = coalesce(prijs_incl, price_incl),
           group_name  = coalesce(nullif(trim(groep), ''), group_name),
           kind        = 'artikel',
           active      = artikel.actief,
           updated_at  = public.now_ms()
     where id = product_id;
  end if;

  return product_id;
end;
$$;

revoke execute on function public.supply_artikel_naar_kassa(text, numeric, text) from public, anon, authenticated;
grant  execute on function public.supply_artikel_naar_kassa(text, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  Wat de kassa van een artikel weet -- alleen lezen
--
--  De leverancier zet een artikel op de kassa via de deur hierboven, maar kon
--  daarna niet zien of het er stond en voor welke prijs: pos_products_select
--  (0012) is voor personeel, en Trucksupply is bewust geen personeel. Het
--  scherm verborg de kolom dan maar. Dat is eerlijk, maar niet handig: wie
--  de prijs zet hoort hem terug te kunnen lezen.
--
--  Dus een tweede deur, en die kan alleen kijken. Geen naam, geen barcode,
--  geen omzet -- alleen wat er nodig is om naast het artikel te tonen: welk
--  kassaproduct eraan hangt, de prijs en of het aanstaat. Wie de kassa mag
--  lezen krijgt niets nieuws; wie de kassa beheert of levert krijgt precies
--  dit. En de pos_*-tabellen blijven ongewijzigd: geen kolom, geen policy.
-- ---------------------------------------------------------------------------

create or replace function public.supply_kassa_prijzen()
returns table (inventory_item_id text, product_id text, price_incl numeric, active boolean)
language sql stable security definer set search_path = public as $$
  select p.inventory_item_id, p.id, p.price_incl, p.active
    from public.pos_products p
   where p.inventory_item_id is not null
     and (public.mag_leverancier() or public.mag_kassa_beheren() or public.is_staff())
   order by p.updated_at desc;
$$;

revoke execute on function public.supply_kassa_prijzen() from public, anon, authenticated;
grant  execute on function public.supply_kassa_prijzen() to authenticated, service_role;

-- ===========================================================================
--  De factuur kan ook thuis gelezen worden
--
--  Draai dit ná 0048. Opnieuw draaien mag.
--
--  Waar het om gaat
--  ----------------
--
--  Elke factuur die per mail binnenkomt gaat nu naar Claude om gelezen te
--  worden. Dat werkt, maar het kost per stuk geld en de bon gaat het huis uit.
--  Casper heeft een pc met een RTX 5090 staan waarop Ollama met gemma4:26b
--  draait, en een proef met hetzelfde systeemprompt las een testfactuur in
--  acht seconden foutloos uit -- IBAN, btw-nummer, KvK en alle regels erbij.
--  Dus mag die pc het ook doen.
--
--  Twee dingen zijn daarbij met opzet zo:
--
--  a. De uitkomst moet DEZELFDE zijn als bij Claude. Daarom leest de pc
--     alleen. Het opschonen, de verkoopcontrole, het indelen en het
--     wegschrijven gebeuren nog steeds op de server, in dezelfde code
--     (supabase/functions/_gedeeld/verwerking.ts). Wie er leest is een
--     instelling; wat er daarna gebeurt niet.
--
--  b. De richting is omgedraaid. Niet de server die de pc belt -- dan moet er
--     op het thuisnetwerk een poort open en een adres bekend zijn -- maar de
--     pc die elke halve minuut bij de server komt vragen of er werk ligt
--     (Edge Function lezer). De pc kent alleen één geheim en praat alleen
--     met die functie en met Ollama op localhost. Geen servicesleutel, geen
--     API-sleutel, geen open poort.
--
--  Wat hier in de database komt: drie kolommen op expenses waarmee de server
--  en de pc het werk overdragen, en de instelling die zegt wie er leest.
--  Geen RLS-wijziging: de functie lezer werkt met de servicesleutel, en de
--  app leest de nieuwe kolommen mee via de bestaande policies op expenses.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De overdracht
--
--    lees_status       wacht    de post heeft hem klaargezet voor de pc
--                      bezig    de pc heeft hem opgehaald (lees_geclaimd_at)
--                      klaar    gelezen en verwerkt
--                      mislukt  de pc kon het niet; de reden staat in de
--                               twijfel van de lezing, zodat de app hem toont
--                      leeg     niet via de pc gegaan (Claude, of van vóór
--                               deze migratie)
--    lees_geclaimd_at  wanneer de pc hem pakte. Staat een bon langer dan
--                      tien minuten op bezig, dan is de pc er halverwege mee
--                      opgehouden en mag de volgende ronde hem opnieuw pakken.
--    lezer             wie las: 'claude', 'claude (terugval)' of
--                      'lokaal: <model>'. Zodat je achteraf kunt zien welke
--                      lezer een fout maakte, als er een gemaakt is.
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists lees_status      text;
alter table public.expenses add column if not exists lees_geclaimd_at bigint;
alter table public.expenses add column if not exists lezer            text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_lees_status_check') then
    alter table public.expenses
      add constraint expenses_lees_status_check
      check (lees_status is null or lees_status in ('wacht','bezig','klaar','mislukt'));
  end if;
end $$;

comment on column public.expenses.lees_status is
  'Overdracht aan de lokale lezer: wacht (klaargezet), bezig (opgehaald), '
  'klaar (gelezen en verwerkt), mislukt (reden staat in de twijfel van de '
  'lezing). Leeg als de bon niet via de lokale lezer ging.';

comment on column public.expenses.lees_geclaimd_at is
  'Wanneer de lokale lezer de bon pakte (epoch ms). Ouder dan tien minuten op '
  'bezig telt als vastgelopen en mag opnieuw gepakt worden.';

comment on column public.expenses.lezer is
  'Wie de factuur las: claude, claude (terugval) of lokaal: <model>.';

-- ---------------------------------------------------------------------------
--  Wie leest
--
--  Standaard blijft Claude het doen: zonder pc die werk komt halen zou
--  "lokaal" betekenen dat elke bon op wacht blijft staan. De twee sleutels
--  eronder schrijft de functie lezer bij elke ronde, zodat het
--  ontwikkelaarsscherm kan laten zien of de pc er nog is.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_factuur_lezer', 'factuur_lezer', 'claude',
   'Wie een binnengekomen factuur uitleest. "claude": Claude in de cloud, '
   'zoals altijd. "lokaal": alleen de eigen pc met Ollama; is die er niet, '
   'dan blijft de bon op wacht staan. "lokaal-terugval": de eigen pc, en als '
   'die het niet vertrouwt of niet kan lezen alsnog Claude. Wat er ná het '
   'lezen gebeurt is in alle drie de standen hetzelfde.'),
  ('in_lezer_laatst_gezien', 'lezer_laatst_gezien', '',
   'Wanneer de lokale lezer voor het laatst om werk kwam vragen (epoch ms). '
   'Schrijft de functie lezer zelf; niet met de hand aanpassen.'),
  ('in_lezer_model', 'lezer_model', '',
   'Het model dat de lokale lezer de laatste keer opgaf, bijvoorbeeld '
   'gemma4:26b. Schrijft de functie lezer zelf.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  De overdracht blijft van de server
--
--  De app schrijft een kostenpost altijd als hele rij terug (goedkeuren is
--  een upsert van alles wat het toestel het laatst zag), en daar zitten deze
--  drie kolommen nu ook in. Keurt iemand een bon goed tussen het moment dat
--  de pc hem op "klaar" zette en de volgende keer dat de app hem ophaalt,
--  dan zou lees_status terug naar "wacht" of "bezig" gaan -- en dan pakt de
--  pc een goedgekeurde bon opnieuw en schrijft de lezing over wat een mens
--  had beoordeeld. Voor gelezen bestaat hiervoor sinds 0029 de trigger
--  lezing_blijft_lezing; die krijgt de drie nieuwe kolommen erbij, met
--  dezelfde regel: wat uit de app komt wordt teruggezet, de server (geen
--  my_id()) mag alles.
-- ---------------------------------------------------------------------------

create or replace function public.lezing_blijft_lezing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- De serverfunctie schrijft hem; die werkt met de servicesleutel en heeft
  -- dus geen my_id(). Alleen wat uit de app komt wordt teruggezet.
  if public.my_id() is null then return new; end if;

  if new.gelezen is distinct from old.gelezen then
    new.gelezen := old.gelezen;
  end if;

  -- De overdracht aan de lokale lezer (0049) is ook van de server.
  new.lees_status      := old.lees_status;
  new.lees_geclaimd_at := old.lees_geclaimd_at;
  new.lezer            := old.lezer;
  return new;
end;
$$;

revoke execute on function public.lezing_blijft_lezing() from public, anon, authenticated;

-- ===========================================================================
--  Wat drie keer hetzelfde was, hoeft de vierde keer niet opnieuw
--
--  De vraag van Casper: "Als hij 3x is goedgekeurd, en de volgende is
--  hetzelfde, maar met een andere datum en factuurnummer, dan mag je hem
--  automatisch goedkeuren."
--
--  Dat is een goede regel, en tegelijk de gevaarlijkste die in dit systeem
--  zit: hier gaat er geld weg zonder dat iemand keek. Daarom staat hij
--  standaard UIT, en zitten er vier sloten op.
--
--  Slot 1: alleen wat een MENS drie keer goedkeurde
--  -----------------------------------------------
--
--  De drie eerdere goedkeuringen moeten van een mens zijn. Zou een
--  automatische goedkeuring meetellen, dan bevestigt het systeem na verloop
--  van tijd zijn eigen vergissingen -- precies het gat dat bij het
--  grootboekgeheugen (0044) al is dichtgezet. Nu blijft het oordeel altijd
--  terug te voeren op drie mensen die ja zeiden.
--
--  Slot 2: hetzelfde bedrag, binnen een marge
--  ------------------------------------------
--
--  "Hetzelfde" is bij een maandfactuur nooit tot op de cent hetzelfde: een
--  afvalcontainer verschilt met de weegbon, elektra met het verbruik. Daarom
--  een marge (standaard 2%) ten opzichte van de MEDIAAN van de drie, niet van
--  de laatste. Eén uitschieter verschuift de mediaan niet, en dus ook niet wat
--  er voortaan vanzelf doorgaat.
--
--  Slot 3: een plafond
--  -------------------
--
--  Boven een bedrag (standaard 500 euro exclusief btw) gaat er nooit iets
--  vanzelf doorheen, hoe vertrouwd de leverancier ook is. Een leverancier die
--  elke maand 40 euro stuurt en ineens 4.000, is geen gewoonte maar een vraag.
--
--  Slot 4: geen twijfel, geen dubbele
--  ----------------------------------
--
--  Wat de lezer niet zeker wist gaat nooit vanzelf door, en een factuurnummer
--  dat al bij deze leverancier bestaat al helemaal niet -- dat is een
--  herinnering of een dubbele, en die betaal je niet twee keer.
--
--  Wat je terugziet
--  ----------------
--
--  Een automatisch goedgekeurde bon draagt goedkeuring_bron = 'automatisch',
--  de naam "Automatisch" bij de goedkeurder en een zin in goedkeuring_reden
--  die zegt waaróm. Het management krijgt er een melding van. Afkeuren kan
--  gewoon; dan wordt het weer mensenwerk.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wat er op de kostenpost bijkomt
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists goedkeuring_bron text;

do $$
begin
  alter table public.expenses drop constraint if exists expenses_goedkeuring_bron_check;
  alter table public.expenses add constraint expenses_goedkeuring_bron_check
    check (goedkeuring_bron is null or goedkeuring_bron in ('mens', 'automatisch'));
exception when others then
  raise notice 'goedkeuring_bron-controle niet gezet: %', sqlerrm;
end $$;

/* Waarom hij vanzelf doorging. Eén zin, voor op het scherm en voor later. */
alter table public.expenses add column if not exists goedkeuring_reden text;

comment on column public.expenses.goedkeuring_bron is
  'Wie deze kostenpost heeft goedgekeurd: "mens" of "automatisch" (0050). '
  'Leeg bij bonnen van voor die migratie en bij alles wat nog openstaat.';

-- ---------------------------------------------------------------------------
--  De instellingen
--
--  Standaard uit. Dit is de enige plek in het systeem waar geld wordt
--  goedgekeurd zonder dat er iemand kijkt; dat zet je zelf aan, bewust, als
--  je de eerste maanden hebt gezien dat de lezer klopt.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_auto_goedkeuren', 'auto_goedkeuren', 'nee',
   'Mag een factuur zichzelf goedkeuren als dezelfde leverancier voor '
   'ongeveer hetzelfde bedrag al een aantal keer door een mens is '
   'goedgekeurd? "ja" of "nee". Standaard nee.'),
  ('in_auto_goedkeuren_vanaf', 'auto_goedkeuren_vanaf', '3',
   'Hoeveel keer een mens dezelfde leverancier voor ongeveer hetzelfde bedrag '
   'moet hebben goedgekeurd voordat de volgende vanzelf doorgaat. Minimaal 2.'),
  ('in_auto_goedkeuren_marge', 'auto_goedkeuren_marge', '2',
   'Hoeveel procent het bedrag mag afwijken van de mediaan van de eerdere '
   'goedkeuringen en toch "hetzelfde" heet. Standaard 2.'),
  ('in_auto_goedkeuren_max', 'auto_goedkeuren_max', '500',
   'Bedrag exclusief btw waarboven nooit iets vanzelf wordt goedgekeurd, hoe '
   'vertrouwd de leverancier ook is. Standaard 500 euro.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Het oordeel
--
--  Eén functie die alles nakijkt en zegt wat hij vindt, met de reden erbij.
--  Beslissen doet hij niet: hij geeft antwoord, en de aanroeper (de post, via
--  _gedeeld/verwerking.ts) keurt goed of laat hem staan. Zo is dit oordeel los
--  te lezen, los te testen, en straks ook los aan te roepen vanuit een scherm
--  dat wil laten zien waarom iets wel of niet vanzelf doorging.
--
--  security definer omdat hij over alle vestigingen heen telt; wie hem mag
--  aanroepen staat onderaan.
-- ---------------------------------------------------------------------------

create or replace function public.mag_automatisch_goedkeuren(
  leverancier_in    text,
  bedrag_in         numeric,
  factuurnummer_in  text default null,
  expense_in        text default null
)
returns table (mag boolean, waarom text, keren integer, gewoonte numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  /*
   * De leverancier heet hier partij en niet sleutel.
   *
   * Dat is geen smaak: instellingen heeft een kolom die sleutel heet, en
   * PL/pgSQL kiest bij gelijke namen de variabele. Elke select op de
   * instellingen viel daardoor om met "column reference sleutel is
   * ambiguous" -- pas bij het draaien, niet bij het aanmaken.
   */
  partij    text := lower(trim(coalesce(leverancier_in, '')));
  aan       text;
  vanaf     integer;
  marge     numeric;
  plafond   numeric;
  bedragen  numeric[];
  midden    numeric;
  afwijking numeric;
  al_gezien integer;
begin
  keren := 0;
  gewoonte := null;

  select lower(trim(coalesce(i.waarde, 'nee'))) into aan
    from public.instellingen i where i.sleutel = 'auto_goedkeuren';
  if coalesce(aan, 'nee') <> 'ja' then
    mag := false; waarom := 'Automatisch goedkeuren staat uit.'; return next; return;
  end if;

  if partij = '' then
    mag := false; waarom := 'Geen leverancier op het stuk.'; return next; return;
  end if;
  if bedrag_in is null or bedrag_in <= 0 then
    mag := false; waarom := 'Geen bedrag gelezen.'; return next; return;
  end if;

  /* De instellingen, met een bodem eronder: een "vanaf 1" zou betekenen dat
     één goedkeuring genoeg is, en dat is geen gewoonte maar een toevalstreffer. */
  select greatest(2, coalesce(nullif(trim(i.waarde), '')::integer, 3)) into vanaf
    from public.instellingen i where i.sleutel = 'auto_goedkeuren_vanaf';
  vanaf := coalesce(vanaf, 3);

  select greatest(0, least(25, coalesce(nullif(trim(i.waarde), '')::numeric, 2))) into marge
    from public.instellingen i where i.sleutel = 'auto_goedkeuren_marge';
  marge := coalesce(marge, 2);

  select coalesce(nullif(trim(i.waarde), '')::numeric, 500) into plafond
    from public.instellingen i where i.sleutel = 'auto_goedkeuren_max';
  plafond := coalesce(plafond, 500);

  if bedrag_in > plafond then
    mag := false;
    waarom := format('Boven het plafond van %s euro; hier kijkt altijd iemand naar.',
                     trim(to_char(plafond, 'FM999999990.99')));
    return next; return;
  end if;

  /*
   * Een factuurnummer dat al bij deze leverancier staat is een herinnering of
   * een dubbele. Nooit vanzelf. De eigen rij telt niet mee -- die staat er op
   * dit moment al.
   */
  if coalesce(trim(factuurnummer_in), '') <> '' then
    select count(*)::integer into al_gezien
      from public.expenses e
     where lower(trim(coalesce(e.supplier, ''))) = partij
       and trim(coalesce(e.factuurnummer, '')) = trim(factuurnummer_in)
       and (expense_in is null or e.id <> expense_in);
    if coalesce(al_gezien, 0) > 0 then
      mag := false;
      waarom := format('Factuurnummer %s staat al bij deze leverancier.', trim(factuurnummer_in));
      return next; return;
    end if;
  end if;

  /*
   * De eerdere goedkeuringen, nieuwste eerst, en alleen die van een mens.
   * goedkeuring_bron is leeg bij alles van voor deze migratie; dat is
   * mensenwerk geweest en telt dus mee.
   */
  select array_agg(recent.b order by recent.d desc nulls last) into bedragen
    from (
      select e.amount_excl as b, e.approved_at as d
        from public.expenses e
       where lower(trim(coalesce(e.supplier, ''))) = partij
         and e.status = 'goedgekeurd'
         and coalesce(e.goedkeuring_bron, 'mens') = 'mens'
         and e.amount_excl > 0
         and (expense_in is null or e.id <> expense_in)
       order by e.approved_at desc nulls last
       limit 12
    ) recent;

  keren := coalesce(array_length(bedragen, 1), 0);
  if keren < vanaf then
    mag := false;
    waarom := format('Deze leverancier is %s keer door een mens goedgekeurd; er zijn er %s nodig.',
                     keren, vanaf);
    return next; return;
  end if;

  /*
   * De mediaan van de laatste <vanaf> bedragen, niet het gemiddelde: één
   * jaarafrekening ertussen zou het gemiddelde optillen en daarmee de grens
   * verschuiven voor alles wat daarna komt.
   */
  select percentile_cont(0.5) within group (order by w.b) into midden
    from unnest(bedragen[1:vanaf]) as w(b);
  gewoonte := round(midden, 2);

  if midden is null or midden <= 0 then
    mag := false; waarom := 'Geen bruikbaar bedrag om mee te vergelijken.'; return next; return;
  end if;

  afwijking := abs(bedrag_in - midden) / midden * 100;
  if afwijking > marge then
    mag := false;
    waarom := format('Wijkt %s%% af van de gebruikelijke %s euro; dat is meer dan de %s%% die mag.',
                     trim(to_char(afwijking, 'FM999990.9')),
                     trim(to_char(midden, 'FM999999990.99')),
                     trim(to_char(marge, 'FM999990.99')));
    return next; return;
  end if;

  mag := true;
  waarom := format('%s eerdere facturen van deze leverancier zijn met de hand goedgekeurd rond %s euro; dit bedrag wijkt %s%% af.',
                   vanaf,
                   trim(to_char(midden, 'FM999999990.99')),
                   trim(to_char(afwijking, 'FM999990.9')));
  return next;
end;
$$;

revoke execute on function public.mag_automatisch_goedkeuren(text, numeric, text, text)
  from public, anon, authenticated;
grant  execute on function public.mag_automatisch_goedkeuren(text, numeric, text, text)
  to authenticated, service_role;

comment on function public.mag_automatisch_goedkeuren(text, numeric, text, text) is
  'Mag deze factuur zichzelf goedkeuren? Geeft ja/nee met de reden, hoe vaak '
  'deze leverancier eerder door een mens is goedgekeurd, en het bedrag dat '
  'daarbij gebruikelijk was. Beslist niets zelf.';
