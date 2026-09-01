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
