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
