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
