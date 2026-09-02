-- ===========================================================================
--  De achttien vestigingen komen naar binnen
--
--  Tot nu toe stonden de vestigingen op twee plekken, en geen van beide was
--  compleet. De app kende er twee -- het hoofdkantoor en een proefinvoer met
--  het adres "kasweg 2112". De website kende er achttien, met echte adressen,
--  telefoonnummers en openingstijden, maar die stonden in met de hand
--  geschreven HTML.
--
--  Vanaf hier is de app de bron. Deze migratie zet de achttien erin, precies
--  zoals ze op de site staan, zodat de site er daarna hetzelfde uitziet en
--  alleen zijn gegevens ergens anders vandaan haalt. Wie voortaan een adres
--  wijzigt of een uur van zaterdag afhaalt, doet dat op een plek.
--
--  Waar de gegevens vandaan komen
--  ------------------------------
--
--  Uit bouw/site.json van het merksiteproject. Dat bestand is destijds van
--  truckwash1group.nl geschraapt en is de bron waaruit de achttien
--  vestigingspagina's worden gegenereerd. Adres, postcode, plaats, telefoon,
--  e-mail, coordinaten, openingstijden, de introtekst en de routebeschrijving
--  zijn een-op-een overgenomen.
--
--  Wat NIET is overgenomen, en waarom
--  ----------------------------------
--
--    het aantal wasstraten   staat nergens op de site. Elke vestiging krijgt
--                            de standaardwaarde. Dit is het enige veld dat
--                            met de hand moet worden nagelopen, en tot dat
--                            gebeurd is hoort het niet op de site te staan.
--
--    de foto's               de site verwijst naar afbeeldingen op
--                            truckwash1group.nl. Die kopieren hoort bij het
--                            fotoscherm van de vestiging, niet bij een
--                            migratie.
--
--  Opnieuw draaien mag
--  -------------------
--
--  "on conflict do nothing", en niet "do update". Dat is met opzet: dit
--  bestand komt in supabase/bijwerken.sql terecht, en dat mag altijd opnieuw.
--  Met "do update" zou een tweede keer draaien alles terugzetten naar wat de
--  site ooit zei -- en daarmee elke wijziging wissen die daarna in de app is
--  gemaakt. Een importmigratie hoort een keer te importeren en zich daarna
--  stil te houden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De punten op de vestigingspagina
--
--  Per vestiging staat er een lijstje op de site: "500 meter vanaf Flora
--  Holland", "Handwash met spons", "Haal en brengservice". Dat is geen
--  dienstenlijst maar het rijtje redenen om juist hier te stoppen, en het
--  verschilt echt per vestiging -- van de achttien lijsten zijn er twaalf
--  verschillend.
--
--  Los van de kolom diensten. Die bevat sleutels die naar een dienstpagina
--  wijzen; dit is vrije tekst die alleen op deze pagina staat.
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists punten text[] not null default '{}';

comment on column public.locations.punten is
  'Opsomming op de vestigingspagina van de website. Vrije tekst, een regel per '
  'punt. Los van de kolom diensten -- dat zijn sleutels naar een dienstpagina.';

-- ---------------------------------------------------------------------------
--  De achttien
-- ---------------------------------------------------------------------------

insert into public.locations (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  opening_hours, website_slug, intro, bereikbaar, bijzonder, diensten, punten,
  kind, active, op_website
)
select
  v.id, v.code, v.name, v.address, v.postcode, v.city, v.phone, v.email,
  v.lat, v.lon, v.opening_hours, v.website_slug, v.intro, v.bereikbaar,
  v.bijzonder, v.diensten, v.punten,
  'vestiging', true, true
from (values
  ('loc_aalsmeer', 'TW-AAL', 'Truckwash Aalsmeer', 'Afmijnstraat 4', '1187 ZZ', 'Amstelveen', '0203035112', 'aalsmeer@truckwash1group.nl', 52.2606023, 4.7997808, '{"ma":{"van":"07:00","tot":"19:00"},"di":{"van":"07:00","tot":"19:00"},"wo":{"van":"07:00","tot":"19:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"15:00"},"zo":null}'::jsonb, 'aalsmeer', 'Je vindt Truckwash 1 Aalsmeer op het bedrijventerrein Greenpoort aan de Afmijnstraat 4 in Amstelveen, langs de N201. Truckwash Aalsmeer is vanaf de A4 makkelijk te bereiken.', 'Vanuit Amsterdam neem je afslag 3 richting Hoofddorp en vervolgens via de N201. Vanuit Den Haag neem je ook afslag 3 richting Aalsmeer en vervolgens via de N201.', null, array['alcoa-velgen-reinigen', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['500 meter vanaf Flora Holland bloemenveiling', '5 minuten vanaf Schiphol Airport', '8 minuten vanaf snelweg A4', 'Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren']::text[]),
  ('loc_amsterdam', 'TW-AMS', 'Truckwash Amsterdam', 'Galwin 4', '1046AW', 'Amsterdam', '0203035135', 'amsterdam@truckwash1group.nl', 52.3956631, 4.8003185, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'amsterdam', 'Welkom bij Truckwash 1 Amsterdam, dé toonaangevende bestemming voor het grondig reinigen van vrachtwagens. Je vindt onze wasstraat aan Galwin 4 op bedrijventerrein Sloterdijk, nabij industriewijk Westpoort. Vanaf de A5 neem je afslag 3 Amsterdam-Westpoort.', 'Met twee moderne wasstraten is Truckwash 1 Amsterdam perfect uitgerust voor het reinigen van alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan strenge normen en maken gebruik van de nieuwste reinigingsprogramma’s, waardoor je voertuig weer in optimale staat wordt gebracht. Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je een kop koffie nuttigen in de wachtruimte.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_asten', 'TW-AST', 'Truckwash Asten', 'Nobisweg 5', '5721 VA', 'Asten', '+31(0)493 670242', 'asten@truckwash1group.nl', 51.4162996, 5.7567305, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"14:00"},"zo":null}'::jsonb, 'asten', 'Je vindt Truckwash 1 Asten direct langs de A67 in Asten, op het terrein van truckstop Nobis aan de Nobisweg 5.', 'Truckwash 1 Asten beschikt over 2 professionele wasstraten, geschikt voor alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan de hoogste eisen en beschikken over de modernste reinigingsprogramma’s om jou wagen weer spik en span te maken.', null, array['alcoa-velgen-reinigen']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Velgen reinigen', 'Alcoa reiniging', 'Velgen reiniging', 'Zuren / Ontvetten', 'Wassen met spons']::text[]),
  ('loc_bodegraven', 'TW-BOD', 'Truckwash Bodegraven', 'Europaweg 1e', '2411 NE', 'Bodegraven', '0172619499', 'bodegraven@truckwash1group.nl', 52.0698105, 4.7445157, '{"ma":{"van":"08:00","tot":"19:00"},"di":{"van":"08:00","tot":"19:00"},"wo":{"van":"08:00","tot":"19:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"13:00"},"zo":null}'::jsonb, 'bodegraven', 'Je vindt Truckwash 1 Bodegraven op het bedrijven terrein Broekvelden aan de Europaweg 1e in Bodegraven, naast Goedhart Motoren. Truckwash Bodegraven is het beste te bereiken vanaf de A12 afslag 12a of afslag 12 Reeuwijk of vanaf de N11 afslag Bodegraven. Truckwash Bodegraven beschikt over 3 moderne wasstraten waarvan 1 LZV straat.', 'Twee straten zijn voorzien van een onderwasser voor de onderkant van jouw wagen. Elke straat is voorzien van een warmwatercleaner zodat we in elke hal de trailer inwendig kunnen reinigen. Door de drie straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_hazeldonk', 'TW-HAZ', 'Truckwash Hazeldonk', 'Hazeldonk 6005', '4836 LA', 'Breda', '076 596 3278', 'breda@truckwash1group.nl', 51.4902708, 4.7441562, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"12:00"},"zo":null}'::jsonb, 'hazeldonk', 'Truckwash 1 Hazeldonk is gevestigd in de voormalige Truckwash Hazeldonk locatie aan de Hazeldonk 6005, naast de Q8.
De Truckwash 1 locatie ligt strategisch gelegen aan de A16, bij de grens tussen België en Nederland.', 'De Truckwash wordt compleet gerenoveerd en krijgt een nieuwe machine, en word ingericht op de mogelijkheid om te kunnen voorwassen zodat het proces efficiënt verloopt.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling']::text[], array['We zullen van Maandag t/m Zaterdag geopend zijn', 'We accepteren alle betaalmogelijkheden die u van ons gewend bent', 'We bieden speciale behandelingen aan zoals een alcoa behandeling', 'Chauffeurs kunnen sparen voor leuke truck accessoires', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging', 'HACCP reiniging']::text[]),
  ('loc_doetinchem', 'TW-DOE', 'Truckwash Doetinchem', 'Braamtseweg 10', '7007 CK', 'Doetinchem', '088-0600 100', 'doetinchem@truckwash1group.nl', 51.9463034, 6.2834481, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'doetinchem', 'De nieuwe vestiging in Doetinchem ligt direct aan de A18 (afslag 3), een van de belangrijkste oost-westas voor het vrachtverkeer in de Achterhoek en het grensgebied met Duitsland. De locatie is daarmee ideaal bereikbaar voor transporteurs die rijden op de corridors richting het Ruhrgebied, Münster en verder.', 'Route plannen 
 Openingstijden 
 Vandaag geopend van 08.00 - 18.00', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_ede', 'TW-EDE', 'Truckwash Ede', 'Francis Baconstraat 2', '6718 XA', 'Ede', '0318452282', 'ede@truckwash1group.nl', 52.0356369, 5.6076683, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'ede', 'Je vindt Truckwash 1 Ede op het bedrijventerrein BT A12 op een A locatie op nog geen 5 minuten van de A12 (knooppunt Maanderbroek), en maar 2 minuten van de afslag 1 van de A30 (achter het Plantion).', 'Truckwash Ede beschikt over 2 moderne wasstraten en in 1 straat een onderwas voor de onderkant van jouw wagen. Door de twee straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'vogelgriep']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Bodemreiniging', 'Vogelgriep reiniging en desinfectie', 'Haal en brengservice (informeer contactpersoon)']::text[]),
  ('loc_eindhoven', 'TW-EIN', 'Truckwash Eindhoven', 'Het Schakelplein 30', '5651 GR', 'Eindhoven', '+31 (0) 40 262 02 22', 'eindhoven@truckwash1group.nl', 51.4659684, 5.4186163, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"12:00"},"zo":null}'::jsonb, 'eindhoven', 'Je vindt Truckwash 1 Eindhoven vlak bij de A2 (afrit 29, Eindhoven Airport/acht) en Eindhoven Airport (volg de N2). Op het bedrijventerrein Eindhoven-acht.', 'Truckwash 1 Eindhoven beschikt over 3 moderne wasstraten, speciaal voor vrachtwagens en bestelwagens, die voldoen aan de hoogste eisen. Kan je bedrijfswagen weer een wasbeurt gebruiken? Rij dan door de modernste wasstraat van Eindhoven en terwijl je wagen wordt gewassen, kun je een gratis kopje koffie halen bij ons restaurant. Of je nu het chassis, de buitenzijde of de binnenkant van de oplegger wilt laten reinigen: bij ons is (bijna) alles mogelijk. Onze wasstraat is bijzonder milieuvriendelijk.', null, array['alcoa-velgen-reinigen', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Alcoa reiniging', 'HACCP reiniging', 'Velgen reiniging']::text[]),
  ('loc_groenlo', 'TW-GRO', 'Truckwash Groenlo', 'Noordgang 8', '7141JP', 'Groenlo', '0544745006', 'groenlo@truckwash1group.nl', 52.0616814, 6.6250053, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"14:00"},"zo":null}'::jsonb, 'groenlo', 'Truckwash 1 Groenlo is uitstekend bereikbaar via de N18 (Twenteroute) en vormt een logische stop voor chauffeurs in de Achterhoek en richting Duitsland. Dankzij de ligging vlak bij deze hoofdroute ben je snel van de weg af en eenvoudig weer onderweg.', 'Route plannen 
 Openingstijden 
 Vandaag geopend van 08.00 - 18.00', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_holten', 'TW-HOL', 'Truckwash Holten', 'Handelsweg 34', '7451PJ', 'Holten', '0548855574', 'holten@truckwash1group.nl', 52.2755805, 6.4011927, '{"ma":{"van":"07:00","tot":"18:00"},"di":{"van":"07:00","tot":"18:00"},"wo":{"van":"07:00","tot":"18:00"},"do":{"van":"07:00","tot":"18:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"13:00"},"zo":null}'::jsonb, 'holten', 'Welkom bij Truckwash 1 Holten, dé toonaangevende bestemming in Twente voor het grondig reinigen van vrachtwagens. Je vindt onze vrachtwagen wasstraat aan de Handelsweg 34, aan de N332.', 'Truckwash 1 Holten is uitgerust met maar liefst 5 banen. Drie moderne wasstraten voor het reinigen van alle soorten vrachtwagens en bestelwagens. Daarnaast hebben we nog twee plaatsen voor het uitspuiten van de binnenkant. Onze wasstraten voldoen aan strenge normen en maken gebruik van effectieve reinigingsprogramma’s, waardoor je voertuig weer in optimale staat wordt gebracht. Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je in onze wachtruimte genieten van een kop koffie.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_maasvlakte', 'TW-MAA', 'Truckwash Maasvlakte', 'Luzonstraat 10', '3199 KX', 'Maasvlakte', '0181 44 25 60', 'maasvlakte@truckwash1group.nl', 51.9276713, 4.023263, '{"ma":{"van":"08:00","tot":"21:00"},"di":{"van":"08:00","tot":"21:00"},"wo":{"van":"08:00","tot":"21:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'maasvlakte', 'Je vindt Truckwash 1 Maasvlakte op de Maasvlakte Plaza in Rotterdam aan de Luzonstraat 10. Truckwash Maasvlakte is de grootste Truckwash van Europa en is het beste te bereiken via de A15 naar de N15. Naast ons terrein zit de Maasvlakte Plaza, chauffeur restaurant genaamd Routiers, en de Maasvlakte Plaza Truckparking.', 'Truckwash 1 Maasvlakte beschikt over 6 wasstraten. Door de vier straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum.', 'Op zondag alleen op afspraak.', array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'truckparking', 'wegrestaurant-a2']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_rilland', 'TW-RIL', 'Truckwash Rilland', 'De Poort 24a', '4411PA', 'Rilland', '0113560028', 'rilland@truckwash1group.nl', 51.4222148, 4.1914538, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'rilland', 'Je vindt Truckwash 1 Rilland op het bedrijventerrein De Poort, naast het tankstation De Meeuw. Onze locatie is het best te bereiken via de A58. We zijn gevestigd op De Poort 24a.', 'We beschikken over 2 moderne wasstraten en 1 hal in het midden die gebruikt kan worden voor het inwendig reinigen van trailers en/of zelfservice.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_roosendaal', 'TW-ROO', 'Truckwash Roosendaal', 'Stepvelden 23', '4704RM', 'Roosendaal', '0165529496', 'roosendaal@truckwash1group.nl', 51.5539283, 4.4635791, '{"ma":{"van":"07:00","tot":"21:00"},"di":{"van":"07:00","tot":"21:00"},"wo":{"van":"07:00","tot":"21:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'roosendaal', 'Je vindt Truckwash 1 Roosendaal op het bedrijventerrein de Borchwerf aan de Stepvelden 23, Roosendaal. Jouw locatie is het best te bereiken via de A17 afslag 20. We beschikken over 2 moderne wasstraten van 35 meter lang. Alle voertuigen die niet in een normale wasstraat passen kunnen bij ons terecht.', 'Ben je op zoek naar een truckwash in de buurt van Hazeldonk (Breda )? Dan is Truckwash 1 in Roosendaal het dichtste bij jou in de buurt.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Stickerverwijdering in trailers', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)']::text[]),
  ('loc_rotterdam', 'TW-ROT', 'Truckwash Rotterdam', 'Tweedweg 20', '3197 LM', 'Rotterdam-Botlek', '0102967764', 'rotterdam@truckwash1group.nl', 51.8734417, 4.2631194, '{"ma":{"van":"07:00","tot":"21:00"},"di":{"van":"07:00","tot":"21:00"},"wo":{"van":"07:00","tot":"21:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'rotterdam', 'Truckwash 1 Rotterdam zit in de Botlek aan de Tweedweg 20. Bereikbaar via de A15 (afslag 15). Met 4 wasstraten is dit een van onze grootste locaties. Naast het terrein: een ADR truckparking (betaald), truckerrestaurant Routiers, een Q8 truck-tankstation en een gratis parkeerplaats. Kortom alles op één plek. Geen afspraak nodig.', 'Door de vier straten en het efficiënt reinigen van je voertuigen verlagen we de wachttijden tot een minimum. Elke hal beschikt over een warmwater cleaner zodat we op iedere baan ook de trailer inwendig kunnen reinigen. Moet je even wachten? Dan kun je gebruik maken van de stofzuiger om je cabine schoon te maken. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen. Lang onderweg geweest? Je kunt bij ons gebruik maken van de douches.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'truckparking', 'wegrestaurant-a2']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_steenwijk', 'TW-STE', 'Truckwash Steenwijk', 'Oostermeentherand 8', '8332JZ', 'Steenwijk', '0521745003', 'Steenwijk@truckwash1group.nl', 52.7974282, 6.1293435, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"18:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'steenwijk', 'Truckwash 1 Steenwijk ligt op korte afstand van de A32 (afslag Steenwijk) en is daarmee ideaal bereikbaar voor chauffeurs die rijden tussen Zwolle, Meppel en Leeuwarden. De aanrijroute is overzichtelijk en geschikt voor zwaar transport.', 'Door de combinatie van moderne apparatuur en een vlot werkend team kun je hier rekenen op een snelle doorloop zonder concessies te doen aan kwaliteit. Efficiënt wassen met een schoon en representatief resultaat.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_utrecht', 'TW-UTR', 'Truckwash Utrecht', 'Reactorweg 27', '3542 AD', 'Utrecht', '0307740744', 'utrecht@truckwash1group.nl', 52.10574, 5.0633264, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"}}'::jsonb, 'utrecht', 'Je vindt Truckwash 1 Utrecht op het bedrijventerrein Lage Weide aan de Reactorweg 27. Lage Weide is het best te bereiken vanaf de A2 afslag 7. (In het pand van Van Leeuwen Trucks & vans). Truckwash Utrecht beschikt over 2 moderne wasstraten.', 'Door de twee straten en het efficiënt reinigen van je voertuigen verlagen we de wachttijden tot een minimum. Moet je even wachten? Dan kun je gebruik maken van de stofzuiger om je cabine schoon te maken. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO):', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_venlo', 'TW-VEN', 'Truckwash Venlo', 'Columbusweg 47', '5928LA', 'Venlo', '0773230405', 'venlo@truckwash1group.nl', 51.3958245, 6.0898586, '{"ma":{"van":"08:00","tot":"19:00"},"di":{"van":"08:00","tot":"19:00"},"wo":{"van":"08:00","tot":"19:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'venlo', 'Welkom bij Truckwash 1 Venlo, dé toonaangevende bestemming in Venlo en omstreken voor het grondig reinigen van vrachtwagens. Je vindt onze wasstraat aan de Columbusweg 47 op bedrijventerrein Trade Port West. Vanaf de A67 neem je afslag 39 Sevenum.', 'Truckwash 1 Venlo is uitgerust met twee moderne wasstraten voor het reinigen van alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan strenge normen en maken gebruik van de nieuwste reinigingsprogramma’s, waardoor uw voertuig weer in optimale staat wordt gebracht. Wassen gebeurt bovendien op een duurzame manier . Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je in onze wachtruimte genieten van een kop koffie.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_wehl', 'TW-WEH', 'Truckwash Wehl', 'Kryptonstraat 6A', '7031GG', 'Wehl', '088-0600100', 'holten@truckwash1group.nl', 51.9464915, 6.2251281, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"16:00"},"zo":null}'::jsonb, 'wehl', 'Truckwash 1 Wehl is goed bereikbaar via de A18 (afslag Wehl/Doetinchem) en ligt centraal in de Achterhoek. De ligging maakt deze locatie een vaste stop voor transportbewegingen in Oost-Nederland en richting Duitsland.', 'De locatie is volledig ingericht op efficiënt werken, met aandacht voor kwaliteit en zorgvuldige reiniging. Zo vervolg je je route met een schone vrachtwagen en minimale tijd van de weg.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[])
) as v (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  opening_hours, website_slug, intro, bereikbaar, bijzonder, diensten, punten
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
--  De proefinvoer bijwerken
--
--  Er stond al een "Truckwash Utrecht" met de code TW-UTR en het adres
--  "kasweg 2112". Die code botst met de echte Utrecht-vestiging hierboven, dus
--  die is door "do nothing" overgeslagen -- en dan bleef de proefinvoer staan
--  met het verkeerde adres erin.
--
--  Bijwerken en niet weggooien: er kunnen al uren, wasbeurten of roosters aan
--  deze vestiging hangen, en die verwijzen naar dit id. Een nieuwe rij naast
--  de oude zou Utrecht twee keer in elke keuzelijst zetten.
--
--  De voorwaarde op het adres maakt dit eenmalig. Heeft iemand het adres al
--  goedgezet -- met de hand of door deze migratie -- dan gebeurt er niets meer,
--  en blijft alles wat daarna in de app is gewijzigd gewoon staan.
-- ---------------------------------------------------------------------------

update public.locations bestaand
   set name          = echt.name,
       address       = echt.address,
       postcode      = echt.postcode,
       city          = echt.city,
       phone         = echt.phone,
       email         = echt.email,
       lat           = echt.lat,
       lon           = echt.lon,
       opening_hours = echt.opening_hours,
       website_slug  = echt.website_slug,
       intro         = echt.intro,
       bereikbaar    = echt.bereikbaar,
       diensten      = echt.diensten,
       punten        = echt.punten,
       op_website    = true,
       updated_at    = public.now_ms()
  from public.locations echt
 where bestaand.code = 'TW-UTR'
   and echt.id       = 'loc_utrecht'
   and bestaand.id  <> echt.id
   and lower(trim(coalesce(bestaand.address, ''))) = 'kasweg 2112';

-- De rij waaruit is overgenomen mag daarna weg: hij is nooit in gebruik
-- geweest en zou Utrecht anders dubbel in de lijst zetten.
delete from public.locations
 where id = 'loc_utrecht'
   and exists (
     select 1 from public.locations b
      where b.code = 'TW-UTR' and b.id <> 'loc_utrecht'
        and b.website_slug = 'utrecht');

-- ---------------------------------------------------------------------------
--  Hoeveel mensen er werken
--
--  De telling voor de vacaturepagina zat er naast. Hij sloot iedereen uit met
--  de rol "klant" of "werkgever", en dat is te streng: rollen stapelen in dit
--  systeem. Wie werknemer is en daarnaast een klantaccount heeft, is nog
--  steeds gewoon een collega. Gemeten op de echte database gaf dat 1 in plaats
--  van 6 -- en 1 is een getal dat je niet op een vacaturepagina wilt zetten
--  voor een bedrijf met negentien vestigingen.
--
--  De nieuwe regel is eenvoudiger en zegt wat hij bedoelt: iedereen die de rol
--  werknemer heeft, actief is, niet is uitgeschreven, en geen kassa is.
-- ---------------------------------------------------------------------------

create or replace function public.website_aantal_medewerkers()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.profiles
   where active
     and archived_at is null
     and not coalesce(is_device, false)
     and 'employee' = any(coalesce(roles, array[]::text[]));
$$;

-- ---------------------------------------------------------------------------
--  De punten mee naar buiten
--
--  website_vestigingen() gaf ze nog niet terug, en zonder die lijst kan de
--  site de vestigingspagina niet maken zoals hij nu is.
-- ---------------------------------------------------------------------------

drop function if exists public.website_vestigingen();

create function public.website_vestigingen()
returns table (
  slug        text,
  naam        text,
  adres       text,
  postcode    text,
  plaats      text,
  telefoon    text,
  email       text,
  lat         double precision,
  lon         double precision,
  wasstraten  integer,
  openingstijden jsonb,
  intro       text,
  bereikbaar  text,
  bijzonder   text,
  diensten    text[],
  punten      text[]
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten, l.punten
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * De rechten opnieuw zetten.
 *
 * "drop function" gooit ook de rechten weg, en de nieuwe functie krijgt van
 * Supabase weer automatisch anon en authenticated erbij -- zie 0033 en 0034.
 * Zonder deze twee regels staat het gat dat daar is gedicht meteen weer open.
 */
revoke execute on function public.website_vestigingen()        from public, anon, authenticated;
revoke execute on function public.website_aantal_medewerkers() from public, anon, authenticated;

grant execute on function public.website_vestigingen()        to service_role;
grant execute on function public.website_aantal_medewerkers() to service_role;
