-- ===========================================================================
--  Truckwash1 Dashboard -- ALLES IN EEN KEER
--
--  Selecteer alles, plak het in de SQL Editor van Supabase en druk op Run.
--  Opnieuw draaien mag: het maakt niets dubbel aan en gooit niets weg.
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
--  Startgegevens: klanten en voorraadartikelen.
--
--  Draai dit ná 0001_init.sql. Gebruikers staan hier bewust niet in: die
--  maak je aan via Authentication -> Users in Supabase, waarna de trigger
--  automatisch een profiel aanmaakt.
--
--  Opnieuw draaien is veilig: bestaande rijen worden bijgewerkt, niet
--  gedupliceerd.
-- ===========================================================================

insert into public.companies (id, name, contact, email, phone, city, contract_discount_pct) values
  ('co_jansen',    'Transport Jansen B.V.',  'Mark Jansen',    'planning@transportjansen.nl',     '030-1234567', 'Utrecht',   10),
  ('co_devries',   'De Vries Logistiek',     'Sanne de Vries', 'wagenpark@devrieslogistiek.nl',   '010-7654321', 'Rotterdam',  5),
  ('co_koeltrans', 'KoelTrans Nederland',    'Ahmed Yilmaz',   'info@koeltrans.nl',               '040-2223344', 'Eindhoven', 12),
  ('co_bulk',      'BulkLine Tankvervoer',   'Petra Bos',      'planning@bulkline.nl',            '050-9988776', 'Groningen',  8)
on conflict (id) do update set
  name                  = excluded.name,
  contact               = excluded.contact,
  email                 = excluded.email,
  phone                 = excluded.phone,
  city                  = excluded.city,
  contract_discount_pct = excluded.contract_discount_pct;

insert into public.inventory_items (id, name, unit, stock, min_stock, price_per_unit, supplier) values
  ('inv_shampoo',     'Truckshampoo concentraat', 'liter', 240, 100, 3.85, 'CleanChem BV'),
  ('inv_ontvetter',   'Alkalische ontvetter',     'liter',  68,  80, 5.40, 'CleanChem BV'),
  ('inv_velgen',      'Velgenreiniger zuur',      'liter',  45,  30, 6.20, 'CleanChem BV'),
  ('inv_wax',         'Droogwax / glansmiddel',   'liter', 112,  60, 4.75, 'Nordic Wash'),
  ('inv_borstel',     'Wasborstel telescoop',     'stuk',    7,   4, 42.00, 'WashParts NL'),
  ('inv_doek',        'Microvezeldoek',           'stuk',  180, 100, 1.35, 'WashParts NL'),
  ('inv_zout',        'Onthardingszout',          'kg',    520, 250, 0.42, 'AquaSoft'),
  ('inv_handschoen',  'Nitril handschoenen',      'doos',    9,  12, 8.90, 'SafetyFirst')
on conflict (id) do update set
  name           = excluded.name,
  unit           = excluded.unit,
  min_stock      = excluded.min_stock,
  price_per_unit = excluded.price_per_unit,
  supplier       = excluded.supplier;

-- ---------------------------------------------------------------------------
--  Rollen toekennen
--
--  Nadat je in Authentication -> Users een gebruiker hebt aangemaakt, geef je
--  die hier de juiste rollen. Vervang het e-mailadres en draai de regel.
--
--    'employee'   -> knop Werknemers
--    'customer'   -> knop Klanten
--    'management' -> knop Management (de derde knop)
-- ---------------------------------------------------------------------------

-- Voorbeeld: jezelf alle drie de dashboards geven.
--
-- update public.profiles
--    set roles = array['employee','customer','management']::text[],
--        name  = 'Casper'
--  where email = 'casper@truckwash1group.nl';

-- Voorbeeld: een wasser.
--
-- update public.profiles
--    set roles = array['employee','customer']::text[],
--        name  = 'Tom Verhoeven',
--        hourly_rate = 22
--  where email = 'tom@truckwash1group.nl';

-- Voorbeeld: een klantaccount koppelen aan een bedrijf.
--
-- update public.profiles
--    set roles      = array['customer']::text[],
--        name       = 'Mark Jansen',
--        company_id = 'co_jansen'
--  where email = 'planning@transportjansen.nl';
