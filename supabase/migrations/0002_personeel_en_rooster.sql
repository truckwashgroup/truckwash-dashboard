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
