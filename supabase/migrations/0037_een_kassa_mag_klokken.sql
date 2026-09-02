-- ===========================================================================
--  Een kassa mag klokken
--
--  Wat er gebeurde: iemand klokte in op de kassa, zag "is ingeklokt", stond
--  onder "Nu aan het werk" -- en de urenregel kwam nooit in de administratie.
--  De database weigerde hem, en de kassa gooide hem na acht pogingen weg.
--
--  Dat weggooien is in de kassa rechtgezet (versie 0.10.0: zo'n weigering
--  verbruikt geen pogingen meer en er komt een melding aan de balie). Dit is
--  de andere helft: de weigering zelf.
--
--  Waarom hij geweigerd werd
--  -------------------------
--
--  Sinds 0018 gaat klokken via de kassa, en de regel daar is:
--
--      insert on time_entries: is_management() or heeft_recht('hours.clock')
--
--  heeft_recht() kijkt in profiles.grants. Een gekoppelde kassa krijgt sinds
--  0025 zijn eigen inlogaccount met een dossier erbij -- rol employee, een
--  vestiging, en verder niets. Geen grants dus, en dus geen hours.clock.
--
--  De rechten van de kassa en de rechten van de medewerker zijn twee
--  verschillende dingen, en dat is precies waar dit misging. In de app wordt
--  gekeken of degene die er staat mag klokken; de database kijkt naar het
--  apparaat dat het verzoek stuurt. Beide horen te kloppen, en van die tweede
--  was niemand zich bewust.
--
--  Waarom juist dit recht, en niet meer
--  ------------------------------------
--
--  Klokken is het enige wat een kassa doet en wat niet elders kan: mensen
--  klokken in bij het apparaat waar ze langslopen. Alles wat de kassa verder
--  wegschrijft -- bonnen, kasmutaties, kluisboekingen, wasopdrachten, voorraad
--  -- komt al langs op is_staff() plus de eigen vestiging, en dat heeft dit
--  dossier.
--
--  pos.manage krijgt hij níet. Dat zou betekenen dat de inloggegevens van een
--  tablet achter de balie genoeg zijn om prijzen te wijzigen. Wat daar nog wél
--  aan vastzit staat onderaan dit bestand.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De kassa's die er al staan
-- ---------------------------------------------------------------------------

update public.profiles
   set grants = (
     select array_agg(distinct g)
       from unnest(coalesce(grants, array[]::text[]) || array['hours.clock']) as g
   )
 where is_device
   and not ('hours.clock' = any(coalesce(grants, array[]::text[])));

-- ---------------------------------------------------------------------------
--  En de kassa's die er nog bij komen
--
--  De serverfunctie kassa-koppelen zet dit recht ook zelf op het dossier. Deze
--  trigger is de rem eronder: hij vult het aan als het er niet op staat.
--
--  Twee plekken voor hetzelfde is meestal een fout, hier niet. De functie is de
--  gewone weg; deze trigger vangt de gevallen die daar niet langskomen -- een
--  dossier dat met de hand op is_device wordt gezet, of een kassa die gekoppeld
--  is met een oudere versie van de functie. Een kassa waarvan de uren stil
--  wegvallen is te duur om van één plek af te laten hangen.
-- ---------------------------------------------------------------------------

create or replace function public.apparaat_mag_klokken()
returns trigger language plpgsql as $$
begin
  if new.is_device
     and not ('hours.clock' = any(coalesce(new.grants, array[]::text[])))
  then
    new.grants := coalesce(new.grants, array[]::text[]) || array['hours.clock'];
  end if;
  return new;
end;
$$;

/*
 * Vóór profiles_apparaat, want die controleert wat er op het dossier staat en
 * deze vult het aan. Triggers met dezelfde tijd lopen op alfabet, en
 * "profiles_apparaat_klokken" komt na "profiles_apparaat" -- dus krijgt hij een
 * naam die eerder komt. Dat is lelijk en het staat er daarom bij.
 */
drop trigger if exists profiles_a_klokken on public.profiles;
create trigger profiles_a_klokken before insert or update on public.profiles
  for each row execute function public.apparaat_mag_klokken();

-- ---------------------------------------------------------------------------
--  Wat de kassa hierna nog steeds niet mag, en waarom dat een keuze is
--
--  Twee schermen in de kassa schrijven naar tabellen die mag_kassa_beheren()
--  vragen, en dat heeft een apparaataccount niet:
--
--    Beheer -> Artikelen        pos_products
--    Beheer -> Nummers, badges  pos_pins
--
--  Die blijven dus weigeren. Dat is geen vergissing maar het is ook niet af:
--  een scherm dat invoer aanneemt en het daarna niet kan opslaan, is dezelfde
--  soort fout als de inklokking die verdween -- alleen valt hij nu wél op,
--  want de kassa laat sinds 0.10.0 zien wat er in de wachtrij vastzit.
--
--  Er zijn twee eerlijke uitkomsten, en het is een keuze welke:
--
--    1. Prijzen en badges horen bij het kantoor, zoals vestigingen, kassa's en
--       kluizen. Dan gaan die twee schermen uit de kassa en komen ze in het
--       dashboard.
--    2. De kassa mag het. Dan krijgt het apparaataccount pos.manage, en zijn de
--       inloggegevens van een tablet achter de balie genoeg om prijzen te
--       wijzigen.
--
--  Zolang die keuze niet gemaakt is, doet deze migratie het minste van de twee:
--  klokken werkt, en prijzen blijven waar ze zijn.
-- ---------------------------------------------------------------------------
