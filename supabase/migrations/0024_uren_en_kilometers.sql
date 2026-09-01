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
