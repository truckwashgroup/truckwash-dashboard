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
