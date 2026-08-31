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
