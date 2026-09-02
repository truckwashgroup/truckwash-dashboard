-- ===========================================================================
--  Utrecht bleef op "kasweg 2112" staan
--
--  0035 zou achttien vestigingen invoeren en heeft er zeventien gedaan.
--  Utrecht ontbreekt, en de proefinvoer met het adres "kasweg 2112" staat er
--  nog. Gemeten na afloop: 19 rijen, 17 met punten, en de rij met code TW-UTR
--  heeft geen website_slug.
--
--  Waarom het misging
--  ------------------
--
--  0035 voegt in met "on conflict (code) do nothing". Dat is met opzet -- een
--  importmigratie mag bij een tweede keer draaien niets overschrijven. Maar de
--  code TW-UTR was al bezet door de proefinvoer, dus de echte Utrecht werd
--  overgeslagen en de rij loc_utrecht is nooit ontstaan.
--
--  En precies die rij had de reparatie eronder als bron nodig:
--
--    update ... from public.locations echt where echt.id = 'loc_utrecht'
--
--  Geen bronrij, geen update. Geen foutmelding ook: nul rijen bijwerken is
--  voor Postgres een geldig antwoord. De migratie meldde succes en deed de
--  helft.
--
--  Waarom de test het niet ving
--  ----------------------------
--
--  Die botsing bestond in de test ook -- een fixture maakte een vestiging aan
--  met de code TW-UTR. Toen 0035 daarop stukliep is de fixture hernoemd naar
--  TST-UTR. Daarmee verdween de botsing uit de test, en dus ook het enige
--  geval waarvoor de reparatie geschreven was. De test werd groen door het
--  probleem weg te halen in plaats van het na te rekenen.
--
--  In scripts/sqltest.mjs wordt de situatie nu nagebouwd zoals hij op de
--  echte database was, en pas daarna wordt dit bestand gedraaid.
--
--  Wat deze migratie doet
--  ----------------------
--
--  De bestaande rij bijwerken, niet vervangen. Aan die rij kunnen uren,
--  wasbeurten, roosters en een kluis hangen, en die verwijzen naar zijn id.
--  Weggooien en opnieuw invoeren zou dat meenemen.
--
--  Het aantal wasstraten blijft staan zoals het staat. De site zegt "2
--  moderne wasstraten" in de introtekst, maar in de app staat 3 -- met de hand
--  ingevuld, en dat is vermoedelijk de werkelijkheid. Een migratie hoort geen
--  getal te overschrijven dat iemand zelf heeft nagekeken.
-- ===========================================================================

update public.locations
   set name          = 'Truckwash Utrecht',
       address       = 'Reactorweg 27',
       postcode      = '3542 AD',
       city          = 'Utrecht',
       phone         = '0307740744',
       email         = 'utrecht@truckwash1group.nl',
       lat           = 52.10574,
       lon           = 5.0633264,
       opening_hours = '{"ma":{"van":"08:00","tot":"18:00"},'
                       '"di":{"van":"08:00","tot":"18:00"},'
                       '"wo":{"van":"08:00","tot":"18:00"},'
                       '"do":{"van":"08:00","tot":"18:00"},'
                       '"vr":{"van":"08:00","tot":"21:00"},'
                       '"za":{"van":"08:00","tot":"13:00"}}'::jsonb,
       website_slug  = 'utrecht',
       intro         = 'Je vindt Truckwash 1 Utrecht op het bedrijventerrein '
                       'Lage Weide aan de Reactorweg 27. Lage Weide is het best '
                       'te bereiken vanaf de A2 afslag 7. (In het pand van Van '
                       'Leeuwen Trucks & vans). Truckwash Utrecht beschikt over '
                       '2 moderne wasstraten.',
       bereikbaar    = 'Door de twee straten en het efficiënt reinigen van je '
                       'voertuigen verlagen we de wachttijden tot een minimum. '
                       'Moet je even wachten? Dan kun je gebruik maken van de '
                       'stofzuiger om je cabine schoon te maken. Je kunt ook een '
                       'bezoek brengen aan onze shop of natuurlijk een kop '
                       'koffie nuttigen.',
       diensten      = array[
                         'alcoa-velgen-reinigen',
                         'haal-en-brengservice',
                         'haccp-certificaat-en-behandeling',
                         'nao-wasplaats'
                       ]::text[],
       punten        = array[
                         'Alcoa / Dura Bright behandeling',
                         'Handwash met spons',
                         'Het reinigen van alle aluminium onderdelen',
                         'Het inwendig reinigen van je laadruimtes (HACCP & NAO):',
                         'Ontsmetten en/of desinfecteren',
                         'Haal en brengservice (informeer contactpersoon)',
                         'Wassen op afspraak (informeer contactpersoon)',
                         'Alcoa reiniging'
                       ]::text[],
       op_website    = true,
       updated_at    = public.now_ms()
 where code = 'TW-UTR'
   -- Eenmalig, en daarmee opnieuw te draaien: zodra het adres klopt, of zodra
   -- iemand er in de app iets aan heeft veranderd, gebeurt hier niets meer.
   and lower(trim(coalesce(address, ''))) = 'kasweg 2112';

/*
 * Het gat dat 0035 openliet.
 *
 * Was er nooit een proefinvoer geweest, dan had 0035 Utrecht gewoon ingevoerd
 * en doet de update hierboven niets. Deze regel vangt dat geval af, zodat dit
 * bestand op elke database hetzelfde eindresultaat geeft: precies een Utrecht,
 * op de website, met een slug.
 *
 * De insert vindt geen bestaande rij met deze code, want die zou hierboven al
 * zijn bijgewerkt en dan is aan de where-voorwaarde voldaan.
 */
insert into public.locations (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  website_slug, kind, active, op_website
)
select
  'loc_utrecht', 'TW-UTR', 'Truckwash Utrecht', 'Reactorweg 27', '3542 AD',
  'Utrecht', '0307740744', 'utrecht@truckwash1group.nl', 52.10574, 5.0633264,
  'utrecht', 'vestiging', true, true
where not exists (
  select 1 from public.locations where website_slug = 'utrecht'
);
