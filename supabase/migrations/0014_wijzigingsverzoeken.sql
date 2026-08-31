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
