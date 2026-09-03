# Trucksupply in het dashboard

Handleiding voor de mensen van Trucksupply, en achteraan een hoofdstuk voor
Casper met wat er ingesteld moet worden voordat het werkt.

---

## Waar het om gaat

De vestigingen van Truckwash 1 bestellen hun spullen (shampoo, ontvetter,
doeken) bij Trucksupply. Vroeger ging dat per telefoon of appje, en vaak pas
als de laatste fles al leeg was. Nu kijkt Trucksupply mee in de voorraad van
alle vestigingen: zakt een stand onder zijn minimum, dan ontstaat er vanzelf
een alarm en gaat er een mail. Van een alarm maak je een zending, met een
nummer, een pakbon en een verzendlabel. Zet je de zending op verzonden, dan
wordt de voorraad van de vestiging alvast bijgeboekt en gaat het alarm uit.

Je logt in met je eigen account en kiest de kaart **Trucksupply**. Je ziet
alleen de voorraad, de artikelen en de bestellingen; roosters, uren en
personeelsdossiers zie je niet.

---

## Wat je waar vindt

| Menu | Wat er staat |
|---|---|
| **Start** | Tegels: hoeveel artikelen onder het minimum, hoeveel alarmen nog niemand heeft gezien, open bestellingen, wat er vandaag is verzonden. Met twee snelknoppen: *Zending samenstellen uit alarmen* en *Proefmail sturen*. |
| **Voorraad** | Per vestiging een kaart (aantal artikelen, hoeveel onder het minimum). Klik een vestiging aan voor de lijst met stand, minimum en bestelhoeveelheid. Onderaan de alarmen met de tabs Open / Gezien / Opgelost. |
| **Bestellingen** | Alle zendingen, met tabs per status. Klik er een aan voor de regels, de stapknoppen, de pakbon en het verzendlabel. |
| **Artikelen** | De catalogus: wat je levert, met artikelnummer, foto, inkoopprijs, minimum en bestelhoeveelheid. Van hieruit kopieer je een artikel naar andere vestigingen en zet je het op de kassa. |
| **Vestigingen** | Het adresboek: adres, telefoon, mail, manager, nu open of dicht, en per vestiging een knop *Nieuwe zending*. |
| **Instellingen** | Het mailadres voor de alarmen, het uur van de ochtendmail en de koppeling met Exact Online. |
| **Overleg** | De chat met de vestigingen en het management. |

Bij de eerste keer inloggen krijg je een korte rondleiding door drie schermen.

---

## Hoe de alarmen en de mails werken

1. **Een alarm ontstaat in de database.** Zodra de stand van een artikel op een
   vestiging onder zijn minimum zakt (door de kassa, door verbruik op de
   vloer of door een correctie) komt er een alarm bij. Komt de stand weer
   boven het minimum, dan is het alarm opgelost. Per artikel is er hoogstens
   één open alarm.

2. **Direct.** Elk kwartier gaat er een mail met alle nieuwe alarmen, per
   vestiging gegroepeerd, naar het mailadres uit Instellingen. Een alarm
   wordt maar één keer direct gemaild.

3. **Ochtendmail.** Eén keer per dag, op het ingestelde uur (standaard 8 uur
   Nederlandse tijd), een overzicht van alles wat nog openstaat en dat
   niemand op *Gezien* heeft gezet. Is er niets, dan komt er geen mail.

4. **Gezien.** In Voorraad zet je een alarm op *Gezien*. De stand is dan nog
   steeds te laag, maar de ochtendmail begint er niet nog eens over.
   Zet je de bestelling met dat artikel op *Verzonden*, dan wordt de voorraad
   bijgeboekt en gaat het alarm vanzelf uit.

Met **Proefmail sturen** (op Start en in Instellingen) controleer je of de
mail aankomt zonder op een alarm te wachten.

Het uur van de ochtendmail kan van 6 tot en met 10 uur; daarbuiten komt de
wekker niet langs en gaat er geen mail. De Instellingen laten een ander uur
daarom niet toe.

---

## Een zending maken, inpakken, verzenden

**Uit de alarmen.** Op Start: *Zending samenstellen uit alarmen*. Je ziet per
vestiging welke artikelen onder het minimum staan en hoeveel er mee zou
moeten (de bestelhoeveelheid van het artikel, of anders genoeg om weer op
twee keer het minimum te komen). Vink de vestigingen aan en er komt per
vestiging één concept. Een vestiging waar al een concept openstaat is
standaard uitgevinkt: dan voeg je liever toe aan dat concept.

**Vanuit de voorraad.** Bij een artikel in Voorraad: *In zending*. Het artikel
komt in het open concept voor die vestiging, of er wordt een nieuw concept
gemaakt.

**Vanuit een vestiging.** In Vestigingen: *Nieuwe zending*, dan kies je zelf
de artikelen.

**Aangevraagd door de vestiging.** Een medewerker kan in zijn eigen scherm
Materiaal bij een artikel onder het minimum op *aanvragen bij Trucksupply*
drukken. Dat wordt een concept met bron *aanvraag*, en op Start telt de tegel
Bestellingen dan als urgent.

Daarna loopt elke bestelling dezelfde stappen, in deze volgorde:

| Status | Wat je doet | Wat er gebeurt |
|---|---|---|
| **Concept** | Regels toevoegen, aantallen aanpassen, regels weghalen. Een concept kun je weggooien. | Het nummer (TS-2026-0001) komt van de server. Ben je even offline, dan staat er tijdelijk *TS-concept-...*; bij de volgende stap met verbinding wordt dat een echt nummer. |
| **Bevestigd** | Aantallen mag je nog aanpassen. Regels weghalen kan niet meer; zet het aantal op wat er wel meegaat. | De bestelling staat vast. |
| **Ingepakt** | Vul per regel *geleverd* in als er iets anders in de doos zit dan besteld. | Wat er echt meegaat, staat op de pakbon. |
| **Verzonden** | Vul vervoerder en track & trace in. | De voorraad van de vestiging wordt bijgeboekt met wat er meegaat; het alarm gaat uit. |
| **Ontvangen** | Zet je zelf, als de vestiging bevestigt dat het er is. | Eindstation. |

*Annuleren* kan tot en met Ingepakt; zet de reden in de opmerking. Wat
verzonden is, is een feit: dat annuleer je niet meer.

Zonder regels kan een bestelling niet verder dan concept.

### Pakbon en verzendlabel

In het detail van een bestelling:

- **Pakbon**: A4, zonder prijzen, met per regel een vakje voor het geleverde
  aantal en een handtekeningregel. Print via het printvenster van de browser.
- **Verzendlabel**: A6 staand, met groot *AAN: Truckwash 1 \<plaats\>*, het
  adres, het bestelnummer als QR-code en het aantal colli. Kies in het
  printvenster het papierformaat A6 (of print twee per A4).
- **Doorsturen**: mailt de pakbon als platte tekst naar een adres dat je
  opgeeft (bijvoorbeeld de vervoerder of de vestiging). Op de bestelling
  komt te staan naar wie en wanneer.

---

## Artikelen beheren

- **Nieuw artikel**: naam, eenheid, artikelnummer (sku), omschrijving, foto,
  minimum, bestelhoeveelheid, inkoopprijs en de vestiging. De foto wordt in
  de app verkleind; groter dan de server aanneemt kan niet.
- **Kopieer naar andere vestigingen**: zet hetzelfde artikel met stand 0 op
  de vestigingen die je aanvinkt. Let op: staat het minimum boven 0, dan
  ontstaat er op elke gekozen vestiging meteen een alarm en binnen een
  kwartier één mail. Zet het minimum eerst op 0 als de vestiging nog moet
  tellen; het scherm waarschuwt hiervoor.
- **Naar de kassa**: maakt of werkt het kassaproduct bij (naam, eenheid, foto
  en de prijs die je opgeeft). Een tweede keer werkt dezelfde kassaregel bij;
  er komt geen dubbel product. Zet je een artikel uit (*actief* uit), dan
  verdwijnt het ook van het kassascherm.
- De **voorraadstand** zelf pas je hier niet aan: die verandert door de kassa,
  door verbruik op de vloer en door jouw leveringen.

---

## Instellingen

- **Mailadres van Trucksupply**: waar de directe meldingen en de ochtendmail
  heen gaan. Eén adres; een groepsadres is prima.
- **Uur van de ochtendmail**: Nederlandse tijd, 6 tot en met 10.
- **Exact Online**: *Koppelen met Exact* opent een venster van Exact waarin je
  inlogt en toestemming geeft; daarna toont het scherm *gekoppeld*. De
  division (het administratienummer) vul je hier in. Eerlijk is eerlijk: de
  koppeling verbindt nu alleen en houdt het token bij; er gaan nog geen
  artikelen, bestellingen of facturen naar Exact. Dat komt in een volgende
  stap.

---

## Voor Casper: wat er ingesteld moet worden

Alles hieronder is één keer. Zonder deze stappen werkt het dashboard wel,
maar komen er geen mails en is de kaart Trucksupply voor niemand te kiezen.

### 1. De database bijwerken (migratie 0048)

Plak `supabase/bijwerken.sql` in de SQL-editor van Supabase en druk op Run
(opnieuw draaien mag). Dat brengt de database tot en met 0048: de rol, de
kolommen op `inventory_items`, de tabellen `voorraad_alarmen`,
`bestellingen`, `bestelregels` en `exact_koppeling`, de alarmtrigger, de
functie `bestelnummer()`, de kassadeur `supply_artikel_naar_kassa()` en de
verruiming van de policy op `instellingen` voor de drie sleutels van
Trucksupply. Bij het draaien krijgt alles wat al onder het minimum stond
meteen een alarm; verwacht dus een eerste mail met wat er nu al tekort is.

Twijfel je of eerdere migraties gedraaid zijn: `supabase/setup.sql` is het
geheel en mag ook opnieuw.

### 2. Het geheim van de wekker: VOORRAAD_CRON_SECRET

De GitHub-workflow `.github/workflows/voorraad.yml` roept elk kwartier de
Edge Function `trucksupply` aan, en elk heel uur van 4 tot en met 9 UTC voor
de ochtendmail. De functie vergelijkt een geheim; klopt het niet, dan
antwoordt ze 403 en wordt de job rood.

Kies een lang wachtwoord (letters en cijfers volstaan) en zet het op twee
plekken:

```
# Supabase (vanuit de map dashboard)
supabase secrets set VOORRAAD_CRON_SECRET=<het wachtwoord> --project-ref yxsbmhavnttswxczeovt
```

En in GitHub: deze repo, Settings, Secrets and variables, Actions:

| Secret | Waarde |
|---|---|
| `SUPABASE_FUNCTIONS_URL` | `https://yxsbmhavnttswxczeovt.supabase.co/functions/v1` |
| `VOORRAAD_CRON_SECRET` | hetzelfde wachtwoord |

De mail zelf gaat via Resend; `RESEND_API_KEY` en `MAIL_FROM` staan al op de
server voor stuur-mail en Trucky.

### 3. Exact Online: EXACT_CLIENT_ID en EXACT_CLIENT_SECRET

Pas nodig als de koppeling echt gebruikt gaat worden; zonder deze twee zegt
het scherm netjes dat Exact niet is ingesteld.

1. Maak in het Exact App Center een app aan en registreer als redirect-URI
   letterlijk:
   `https://yxsbmhavnttswxczeovt.supabase.co/functions/v1/exact`
   (wil je een andere, zet dan ook `EXACT_REDIRECT_URI` als secret).
2. Zet het client-id en het client-secret op de server:

```
supabase secrets set EXACT_CLIENT_ID=<id> EXACT_CLIENT_SECRET=<geheim> --project-ref yxsbmhavnttswxczeovt
```

De tokens komen in de tabel `exact_koppeling`, die RLS aan heeft zonder
policies: alleen de Edge Function komt erbij. Het verversen van een verlopen
token is nog niet gebouwd; dat komt zodra er echt met Exact gepraat gaat
worden.

### 4. De Edge Functions uitrollen

```
npm run functions:open
```

Dat rolt `trucksupply` en `exact` uit met `--no-verify-jwt`, samen met de
andere open functies. Nooit een kaal `supabase functions deploy`: dat zet
verify_jwt aan en dan komt de terugkeer van Exact (een browser zonder token)
en de wekker (een curl met alleen het geheim) er niet meer doorheen.

Controleren: in GitHub onder Actions de workflow *Voorraadwekker* handmatig
starten met actie `test`. Die doet een proefrun zonder mail en zegt of het
geheim klopt.

### 5. Een gebruiker met de rol Trucksupply

In het dashboard Management, onder **Personeel**, een nieuwe persoon aanmaken
met alleen de rol **Trucksupply** aangevinkt (geen andere rol: de rol is
bewust geen personeel, dus geen rooster, geen uren, geen dossier) en het
mailadres van Trucksupply. De uitnodiging gaat per mail; na het aanmelden
verschijnt de kaart Trucksupply bij het inloggen.

De rol heeft standaard de rechten `supply.view`, `supply.articles`,
`supply.orders` en `supply.settings` (plus chat en het zien van de
vestigingen). Wie een van die vier via de rechten intrekt, verliest het
bijbehorende menu.

### 6. Daarna

- Zet in het dashboard Trucksupply, onder Instellingen, het mailadres en het
  uur, en druk op *Proefmail sturen*.
- Vul bij de artikelen de bestelhoeveelheid en het artikelnummer in; zonder
  bestelhoeveelheid stelt de app "tot twee keer het minimum" voor.
- Voor de kassa staat er een aparte opdracht in `docs/kassa-sessie-trucksupply.md`.
