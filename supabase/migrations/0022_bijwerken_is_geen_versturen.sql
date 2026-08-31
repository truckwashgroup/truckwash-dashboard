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
