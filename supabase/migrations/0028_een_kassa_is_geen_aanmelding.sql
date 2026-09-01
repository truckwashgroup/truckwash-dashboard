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
