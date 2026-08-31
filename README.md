# Truckwash1 Dashboard

Eén codebase, drie dashboards, drie platformen. Offline-first met automatische
synchronisatie zodra er verbinding is, en automatische updates op Windows,
iOS en Android.

---

## Snel starten

```bash
npm install
npm run dev            # browser  -> http://localhost:5173
npm run electron:dev   # Windows-app met live herladen
```

> **npm 12 blokkeert install-scripts.** Als `npm run electron:dev` klaagt met
> *"Electron failed to install correctly"*, draai dan eenmalig:
> `node node_modules/electron/install.js`

### Inloggen

Er zijn geen testaccounts meer. De app praat uitsluitend met Supabase; zonder
een echt account kom je er niet in.

Zijn `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` niet ingevuld, dan meldt
het inlogscherm dat en is de knop uitgeschakeld. De ingebouwde testgegevens
zitten er nog wel, maar alleen voor de geautomatiseerde tests, en die zijn
niet vanuit de app te bereiken.

### Zelf aanmelden

Onder het inlogscherm staat **Aanmelden**. Daar maakt iemand zelf een account
aan — meer kan een bezoeker niet, en er is niets geheims voor nodig.

Een account is alleen nog geen toegang. Wat er gebeurt:

1. De databasetrigger zet een dossier klaar **zonder rollen en op inactief**.
2. Er komt een aanmelding te staan bij *Management → Aanmeldingen*, en het
   management krijgt er bericht van.
3. Probeert diegene in te loggen, dan zegt de app dat zijn aanmelding wordt
   beoordeeld. Hij komt nergens binnen.
4. Bij *Aanmeldingen* druk je op **Toelaten**. Daar kies je in één keer de
   rollen, de vestiging, de vestigingen waar hij leiding over krijgt, het
   personeelsnummer, de functie en de contracturen.
5. Pas daarna kan hij inloggen, en krijgt hij daar bericht van.

Daarmee hoef je nooit meer met de hand in Supabase. Ook afwijzen kan, met een
reden die letterlijk in de mail terechtkomt.

> Wat de app **niet** overneemt zijn de gegevens die de client meestuurt bij
> het aanmaken van een account. Die zijn niet te vertrouwen: wie de publieke
> sleutel heeft kan er zetten wat hij wil. Vroeger las de trigger daar de
> rollen uit, en kon iemand zichzelf dus tot management maken. Dat gat is met
> migratie 0007 dicht, en de schematest bewijst het.

Staat er al een dossier klaar op hetzelfde e-mailadres — omdat het management
die persoon zelf heeft toegevoegd — dan wordt dat gekoppeld, mét de rollen die
er staan. Die hoeft dus niet nog eens beoordeeld te worden.

---

## Wat de app doet

**Inloggen → wasstraat-animatie → rolkeuze → dashboard.**

De animatie draait één keer per inlog: een vrachtwagen rijdt de wasstraat
binnen, krijgt voorwas, schuim, borstels, spoeling en droging, en komt
glanzend aan de andere kant naar buiten. Overslaan kan rechtsboven.

Elk dashboard begint op **Start**: een raster tegels dat je in één oogopslag
laat zien waar iets te doen is. Op elke tegel staat een cijfer dat leeft —
"4 bonnen wachten op akkoord" is een reden om te klikken, "Financieel" niet.
Vraagt er iets echt aandacht, dan springt de tegel eruit en staat hij ook
bovenaan in een balkje. De zijbalk blijft gewoon staan voor wie de weg kent.

### Werknemers
- Dagplanning en wachtrij, wagens oppakken en gereed melden met live meeloper
- Tijdregistratie (in-/uitklokken, week- en maandtotaal, indicatie loon)
- Materiaalverbruik direct afboeken, ontvangsten bijboeken
- Bonnen indienen; het management valideert ze

### Klanten
- Overzicht: wat er nu in de wasstraat staat, met voortgangsbalk
- Wasbeurt inplannen met bezette tijdvakken en contractprijs
- Historie met zoeken en filteren
- Facturen per maand, uitklapbaar per regel, met btw-opbouw en afdrukknop

### Leidinggevende
- Mijn team: wie staat er vandaag, wie is ingeklokt, waar loopt het vol
- Rooster van het team maken en publiceren
- **Smartroster**: stelt een week voor op basis van contracturen, de tijden die
  iemand gewoonlijk werkt en de drukte van die dag — met per regel de reden
- Uren van het team, opleidingsvoortgang, en berichten sturen

### Management
- KPI's over 7/30/90 dagen met vergelijking t.o.v. de vorige periode
- Omzet-, kosten- en volumegrafieken, mix van behandelingen, grootste klanten
- **Financieel**: kostenposten valideren (los of in bulk), afkeuren met reden,
  resultaat en btw-saldo
- Personeel: dossiers, rooster, **per persoon precies instellen wat mag**, en
  per persoon de vestiging plus de vestigingen waar hij leiding over krijgt
- **Aanmeldingen**: wie zich via de app heeft aangemeld, toelaten of afwijzen
- Voorraad, volledige planning, opleidingsoverzicht
- **Beheer**: backendstatus, synchronisatie, rechtenoverzicht, lokale gegevens

### Overal
- **Zoeken** (Ctrl+K) door wasbeurten, klanten, medewerkers, voorraad en
  cursussen — je ziet alleen waar je bij mag
- **Zoeken met je stem**: klik op de microfoon en zeg bijvoorbeeld
  "zoek 12-BND-4". Handig met natte handschoenen aan
- **Meldingen** in de app en op het apparaat zelf (Windows, Android, iOS)
- **E-learning**: veiligheid, chemie, installatie, kwaliteit en klantcontact,
  met toets, slaagnorm en certificaten die verlopen
- **Overleg**: kanalen per onderwerp, één per vestiging, en rechtstreekse
  gesprekken. Werkt zonder bereik, net als de rest

---

## Vestigingen

De organisatie bestaat uit negentien vestigingen plus een hoofdkantoor. Bijna
alles hangt aan een vestiging: wasbeurten, roosters, voorraad, kosten en uren.

Rechten zeggen *wat* iemand mag, vestigingen zeggen *waar*. Een leidinggevende
met het recht om roosters te maken, maakt ze alleen voor de vestigingen die aan
hem hangen — niet voor de andere achttien.

| Wie | Ziet |
|---|---|
| Werknemer | Alleen de eigen vestiging |
| Leidinggevende | De eigen vestiging plus de vestigingen in `manages` |
| Hoofdkantoor | Alles (`allLocations`, of het recht `locations.all`) |

Bovenin staat een kiezer met zoekveld. Wie meerdere vestigingen ziet, kijkt
naar alles tegelijk of zoomt in op één. Wie bij precies één vestiging hoort,
ziet alleen de naam — geen keuze die er niet is.

Ook hier is de afscherming in de database geregeld, niet alleen in de app: de
voorraad van Rotterdam is niet op te vragen door de voorman van Utrecht, ook
niet buiten de app om.

---

## Technische dienst

Vier dingen die aan elkaar hangen:

| | |
|---|---|
| **Installatie** | Een apparaat op een vestiging, met een QR-label erop |
| **Storing** | Een melding dat er iets stuk is |
| **Onderhoud** | Een terugkerende beurt volgens een schema |
| **Werkbon** | Het werk zelf: uren, onderdelen, wat er gedaan is |

Een storing of een onderhoudsbeurt levert een werkbon op. Rond je die af, dan
sluit de storing mee, krijgt de melder bericht, schuift het onderhoudsschema
door naar de volgende keer en komt het apparaat weer op *in bedrijf*.

### QR-labels

Elk apparaat heeft een sleutel in de vorm `K7M-P2X-9RT`. Die staat in de
QR-code én leesbaar eronder gedrukt, want in een natte machinekamer is
intypen soms sneller dan scannen.

De sleutel staat bewust los van het interne id: een beschadigd label kun je
vervangen zonder dat de historie eraan verandert, en wie een sticker
fotografeert leest geen database-id mee.

Labels afdrukken doe je vanuit *Installaties → Labels*; scannen kan overal via
de knop **Scannen**, of direct vanuit het storingsformulier — dan staan de
vestiging en de installatie al goed.

### Storing melden

De knop **Storing** staat in de balk van elk dashboard, want wie het defect
ziet is meestal de wasser en niet de monteur. Vier niveaus van urgentie, plus
een schakelaar voor "de installatie ligt stil". Een kritieke melding zet het
apparaat meteen op *storing* en stuurt een bericht naar de technische dienst
van die vestiging.

---

## Overleg

De vervanger van de groepsapp op ieders telefoon, waar de planning van
dinsdag tussen de verjaardagen verdwijnt en waar niemand die weggaat nog uit
te halen is.

Links de kanalen, rechts het gesprek. Drie soorten:

| Soort | Wie zit erin |
| --- | --- |
| **Kanaal** | Een onderwerp: #algemeen, #techniek, #planning, #kwaliteit. Open voor iedereen die mee mag doen, of besloten met een ledenlijst. |
| **Vestiging** | Eén per vestiging plus het hoofdkantoor. Wie daar werkt zit erin; het hoofdkantoor leest overal mee. |
| **Rechtstreeks** | Twee mensen. Het id is aan beide kanten hetzelfde, dus het gesprek splitst nooit. |

Wat er anders is dan in een gewone chat:

- **Het werkt zonder bereik.** Een bericht dat je in de machinekamer typt
  staat er meteen, met een klokje ernaast, en vertrekt zodra je weer buiten
  staat. Onderin de kanalenlijst zie je hoeveel er nog wacht.
- **Zolang het scherm openstaat wordt er elke vijf seconden gekeken** in
  plaats van elke drie kwartier. Zodra je het scherm verlaat gaat dat weer
  omlaag. Het blijft dezelfde synchronisatie; er komt geen tweede verbinding
  bij.
- **Bellen doet het alleen als het over jou gaat.** Je krijgt bericht als
  iemand je met `@naam` noemt, bij `@iedereen`, en bij elk rechtstreeks
  gesprek. Niet bij elke regel in een kanaal — dan zet men het na een dag uit.
- **Verwijderen laat de regel staan** met "bericht verwijderd" erin. Een
  gesprek met gaten leest niemand meer met vertrouwen, en het antwoord
  eronder slaat dan nergens meer op.

Wie waar bij mag staat niet alleen in de app maar ook in de database. Een
vestigingskanaal is voor wie op die vestiging werkt; een besloten kanaal voor
wie in de ledenlijst staat. Ook wie de app omzeilt en rechtstreeks de database
bevraagt komt er niet in.

Kanalen beginnen mag een leidinggevende en het management. Een rechtstreeks
gesprek mag iedereen.

---

## Meldingen aan de ontwikkelaar

In de balk van elk dashboard staat de knop **Devmelding**. Wie ergens tegenaan
loopt vult drie dingen in — wat voor soort melding, wat er aan de hand is en
hoe erg het in de weg zit — en de rest gaat automatisch mee:

- Apparaat, platform, schermformaat en app-versie
- Of er verbinding was en hoeveel wijzigingen er nog openstonden
- **Wat die persoon het afgelopen kwartier deed**: welke schermen, welke
  acties, en welke fouten er ondertussen langskwamen

Dat spoor is zichtbaar vóór het versturen — niemand hoort iets mee te sturen
zonder te kunnen zien wát. Er komt alleen in te staan wat er gebeurde, niet
wat er is ingetypt: geen wachtwoorden, geen klantgegevens, geen invoervelden.

### De kant van de ontwikkelaar

Het dashboard **Ontwikkeling** heeft drie schermen:

| | |
|---|---|
| **Meldingen** | Tickets met gesprek, interne notities, toewijzen, urgentie en afhandelen |
| **Logboek** | Fouten en waarschuwingen uit de app, waarbij dezelfde fout wordt opgeteld in plaats van herhaald |
| **Systeem** | Wat er lokaal staat, en op welke versies en platformen de mensen draaien |

De melder krijgt bericht bij elke reactie en bij elke statuswijziging, en kan
in *Mijn meldingen* antwoorden of zeggen dat het toch niet opgelost is.

Interne notities blijven bij het ontwikkelteam — dat is niet alleen in de app
zo geregeld maar ook in de database.

---

## Rechten

Rollen geven de basis, en daarbovenop stel je per persoon los in wat wel en
niet mag. Zo kun je een leidinggevende wel het rooster laten maken maar de
loonkosten afschermen, zonder een aparte rol te verzinnen.

| Rol | Krijgt standaard |
|---|---|
| Werknemer | Eigen wasbeurten oppakken, eigen rooster en uren, materiaal boeken, bon indienen, cursussen volgen |
| Leidinggevende | Alles van werknemer, plus planning, teamrooster, uren goedkeuren, berichten sturen, cursussen toewijzen |
| Klant | Alleen de eigen omgeving |
| Management | Alles, inclusief rechten uitdelen en financiën |

Er zijn 38 losse rechten in tien groepen. Gevoelige rechten (loongegevens,
financiën, rechten uitdelen) vragen een extra bevestiging. Het laatste account
dat rechten mag uitdelen kan dat recht niet kwijtraken — anders sluit je
jezelf buiten.

Aanpassen doe je in *Management → Personeel → een medewerker → Rechten*. Er
wordt alleen de **afwijking** op de rol bewaard, zodat een latere wijziging in
wat een rol betekent gewoon blijft doorwerken.

---

## Zoeken, en waarom dat veilig is

De zoekbalk voert niets uit wat je typt. De zoekterm gaat als gewone tekst
naar een vergelijking op de lokale database: geen query-taal, geen reguliere
expressie uit invoer, geen HTML. React zet tekst altijd als tekst neer, dus
een script in een zoekterm of in een klantnaam blijft letterlijk zichtbaar in
plaats van uitgevoerd te worden. Daarnaast een lengtelimiet van 64 tekens en
een wachttijd, zodat een enorme invoer de app niet kan laten vastlopen.

Spraak gaat door dezelfde molen: wat er verstaan wordt komt in het zoekveld te
staan, en jij ziet het resultaat voordat er iets gebeurt. Er wordt nooit een
actie uitgevoerd op basis van wat er gezegd is.

---

---

## Offline werken

Alles wat je op het scherm ziet komt uit een lokale IndexedDB-cache, nooit
rechtstreeks van de server. Daardoor werkt de app identiek met en zonder
internet.

1. **Schrijven** gaat altijd eerst lokaal en levert meteen een regel in de
   *outbox*.
2. **Bij verbinding** wordt de outbox op volgorde naar de server geduwd,
   daarna worden serverwijzigingen opgehaald.
3. **Zonder verbinding** blijft alles staan; zodra het netwerk terug is gaat
   het automatisch alsnog weg (ook bij het terugkeren naar het scherm, en elke
   45 seconden).

Details die er in de praktijk toe doen:

- Meerdere bewerkingen op hetzelfde record worden samengevoegd tot één
  verzending — de laatste stand wint.
- Een binnenkomende pull overschrijft **nooit** een record dat nog in de
  outbox staat.
- Na acht mislukte pogingen wordt een regel losgelaten, zodat één kapotte
  wijziging de rest niet blokkeert.
- Inloggen kan offline met een account dat eerder op dat apparaat is gebruikt.

**Zelf testen:** klik rechtsboven op *Offline testen*. De app doet dan alsof
er geen internet is. Maak een afspraak of keur een bon goed, zet hem weer aan,
en kijk hoe de wachtrij leegloopt.

Het gedrag hierboven staat in een echte testsuite:

```bash
npm run selftest        # 190 controles op de app-logica
npm run sqltest         # 73 controles: het databaseschema in een echte Postgres
```

---

## Automatische updates

| Platform | Techniek | Gedrag |
|---|---|---|
| Windows | Electron + `electron-updater` | Controleert bij start en elk half uur, downloadt op de achtergrond, installeert bij afsluiten of direct via de knop in de balk |
| iOS / Android | Capacitor OTA (Capgo) | Nieuwe webbundel zonder store-review; alleen native wijzigingen vragen om een nieuwe store-release |
| Web | — | Herladen geeft de nieuwste build |

### Een release publiceren

De installer en de APK staan bewust **niet** in git: het zijn bouwresultaten,
en binaries horen niet in een repo. Ze verschijnen onder *Releases* zodra je
er één publiceert.

**Eenmalig instellen.** Zet in GitHub onder *Settings → Secrets and variables
→ Actions* twee secrets klaar:

| Secret | Waarde |
|---|---|
| `VITE_SUPABASE_URL` | je Project URL uit Supabase |
| `VITE_SUPABASE_ANON_KEY` | de **publishable** sleutel |

Zonder die twee bouwt de workflow een app waarin niemand kan inloggen, en dat
meldt hij dan ook met een duidelijke fout in plaats van stilletjes door te gaan.

**Een release maken:**

```bash
npm version 1.0.1 --no-git-tag-version
git commit -am "Versie 1.0.1"
git tag v1.0.1
git push && git push --tags
```

De workflow controleert eerst of de tag en `package.json` hetzelfde zeggen —
de updater vergelijkt namelijk op `package.json`, dus die twee uit elkaar laten
lopen is de klassieke manier om een release te maken die niemand binnenkrijgt.
Daarna bouwt hij de Windows-installer en de Android-APK en hangt ze samen met
`latest.yml` onder Releases.

Vanaf dat moment ziet elke geïnstalleerde Windows-app die nieuwe versie vanzelf.

**Met de hand publiceren** kan ook, als je nu al iets wilt uitdelen: ga naar
*Releases → Draft a new release*, maak tag `v1.0.0`, en sleep deze drie
bestanden erin:

```
release/Truckwash1 Dashboard-Setup-1.0.0.exe
release/latest.yml
Truckwash1-Dashboard.apk
```

`latest.yml` is geen bijzaak: daarin staat de checksum waarmee de app
controleert of de download klopt. Zonder dat bestand werken de automatische
updates niet.

> **Waarom lokaal `signAndEditExecutable: false`?** Windows staat symlinks
> alleen toe met beheerdersrechten of met Ontwikkelaarsmodus aan, en zonder dat
> kan electron-builder zijn codesign-hulppakket niet uitpakken. Die omweg zit
> daarom in het `electron:build`-script en niet in de gedeelde configuratie —
> op de bouwmachine van GitHub is hij niet nodig, en krijgt de app dus wél zijn
> eigen pictogram.

### iOS/Android OTA aanzetten

```bash
npm i @capgo/capacitor-updater
npx cap sync
```

Zet daarna je `updateUrl` in `capacitor.config.ts`. De app pakt de plugin
automatisch op; zolang hij er niet is, slaat de updatelaag dat stil over en
blijft de rest gewoon werken.

---

## Mobiel bouwen (iOS en Android)

De projectmappen `android/` en `ios/` staan er al in. Ze horen in git — niet
negeren, want de bouwmachines hebben ze nodig.

### De harde beperking

**iOS bouwen kan alleen op macOS.** Xcode draait nergens anders, en Apple
ondertekent alleen daar. Vanaf Windows heb je dus één van deze drie nodig:

| Route | Kosten | Wanneer geschikt |
|---|---|---|
| **GitHub Actions** (aanbevolen) | gratis voor open repo's, anders ~$0,08/min | Je hoeft geen Mac te kopen; staat al klaar in `.github/workflows/mobile.yml` |
| Mac huren in de cloud (MacinCloud, MacStadium) | ± €25–70/maand | Je wilt af en toe met de hand in Xcode kunnen |
| Zelf een Mac (mini vanaf ± €700) | eenmalig | Je gaat dit vaker doen |

Daarnaast, los van de bouwmachine:

- **Apple Developer Program — €99 per jaar.** Zonder dit kun je de app niet op
  een echte iPhone zetten (behalve 7 dagen op je eigen toestel), niet in
  TestFlight, en niet in de App Store.
- **Google Play Console — $25 eenmalig.** Alleen nodig voor de Play Store; een
  APK rechtstreeks op een Android-toestel zetten is gratis.

### Android bouwen

Android Studio staat geinstalleerd en de APK is al een keer gebouwd. Een
nieuwe maken doe je met:

```bash
npm run android:apk
```

Dat bouwt de webapp, kopieert hem naar het Android-project, bouwt de APK en
legt `Truckwash1-Dashboard.apk` klaar in de projectmap. Zet dat bestand op een
toestel (USB, WeTransfer, Google Drive), tik erop en sta eenmalig
"installeren uit onbekende bron" toe.

Liever via de grafische omgeving? `npm run cap:android` opent Android Studio;
daar kies je *Build -> Build Bundle(s)/APK(s) -> Build APK(s)*.

#### Let op: de Java-versie

Android Studio levert een **JDK 25** mee, maar de Gradle-versie die Capacitor
gebruikt (8.11) draait alleen op **Java 17 t/m 23**. Zonder ingrijpen krijg je:

```
Unsupported class file major version 69
```

Daarom staat er een Temurin **JDK 21** in `~/.jdks/`, met het pad naar die JDK
in je persoonlijke `~/.gradle/gradle.properties`:

```properties
org.gradle.java.home=C:/Users/<jij>/.jdks/jdk-21.0.12.1+1
```

Dat bestand staat bewust buiten het project, zodat het machine-specifieke pad
niet meegaat naar GitHub. `npm run android:apk` zoekt zelf ook een bruikbare
JDK, dus dat commando werkt ook zonder die instelling.

Bouwt Android Studio zelf niet? Zet daar dan
*Settings -> Build Tools -> Gradle -> Gradle JDK* op dezelfde JDK 21.

### iOS via GitHub Actions

```bash
git add -A
git commit -m "Eerste versie"
git remote add origin https://github.com/<jouw-account>/truckwash-dashboard.git
git push -u origin main
```

De workflow start vanzelf. De iOS-taak draait op een Mac van GitHub, installeert
CocoaPods en controleert dat de app foutloos compileert. De Android-taak levert
meteen een installeerbare APK op.

### Naar TestFlight en de App Store

Dit is de stap waarbij je het Apple-account nodig hebt. Eenmalig:

1. Neem het **Apple Developer Program** (€99/jaar).
2. Registreer de bundel-ID **`nl.truckwash1group.dashboard`** in App Store
   Connect (die staat al zo ingesteld in `capacitor.config.ts`).
3. Maak een distributiecertificaat en een provisioning profile, en zet ze als
   secrets in je GitHub-repo.
4. Vervang in `.github/workflows/mobile.yml` de simulator-stap door een
   `xcodebuild archive` plus `xcrun altool --upload-app`.

Daarna levert elke push een nieuwe TestFlight-build op, en kun je collega's per
e-mail uitnodigen om te testen.

### Android publiceren (Play Store)

Maak eenmalig een keystore en zet deze vier secrets in GitHub:

```bash
keytool -genkey -v -keystore release.keystore -alias truckwash   -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore     # de uitvoer wordt ANDROID_KEYSTORE_BASE64
```

`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`. De workflow bouwt dan automatisch een ondertekende
`.aab` voor de Play Store.

> **Bewaar die keystore goed.** Raak je hem kwijt, dan kun je nooit meer een
> update van dezelfde app publiceren.

### Iconen en opstartscherm

Nu gebruikt de app de standaardiconen van Capacitor. Lever één logo aan van
1024×1024 px als `assets/icon.png` en draai:

```bash
npm i -D @capacitor/assets
npx capacitor-assets generate
```

Dat genereert alle formaten voor iOS en Android in één keer.

### Volgorde die ik zou aanhouden

1. Android Studio installeren, APK op een toestel zetten — dan zie je hem
   vandaag nog op een telefoon.
2. Repo naar GitHub, workflow laten draaien.
3. Logo aanleveren en iconen genereren.
4. Pas dan het Apple-account nemen en de App Store-route doen.

## Backend: Supabase

De app kiest zelf welke backend hij gebruikt:

- Staan `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` in je `.env`?
  Dan praat hij met **Supabase**.
- Staan ze er niet? Dan gebruikt hij de **ingebouwde mock**, zodat er altijd
  iets werkends is om in te kijken.

Alle schermen, de offline-wachtrij en de conflictafhandeling zijn hetzelfde;
alleen de vier methodes `login`, `push`, `pull` en `ping` verschillen.

### In vijf stappen aanzetten

**1. Maak een project** op [supabase.com](https://supabase.com) (gratis tier
volstaat ruim). Kies een regio in Europa — dat scheelt vertraging en houdt de
gegevens binnen de EU.

**2. Zet het schema klaar.** Open in Supabase de **SQL Editor**, plak de hele
inhoud van [supabase/setup.sql](supabase/setup.sql) en druk op Run. Dat bestand
is alle migraties achter elkaar; opnieuw draaien mag altijd en gooit niets weg.
Daarna hetzelfde met [supabase/seed.sql](supabase/seed.sql) voor de klanten en
voorraadartikelen.

Komt er later een migratie bij, dan draai je `setup.sql` gewoon nog een keer.
Het bestand wordt gemaakt met `node scripts/build-setup-sql.cjs`.

**3. Vul je sleutels in.** Kopieer `.env.example` naar `.env` en neem uit
Supabase (*Project Settings → API*) de **Project URL** en de **anon public**
key over:

```bash
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

> De anon-key mag in de app staan: hij geeft alleen toegang tot wat de
> beveiligingsregels toelaten. De **service_role** key hoort er nooit in — die
> omzeilt alle beveiliging.

**4. Maak jezelf aan** onder *Authentication → Users → Add user*. Zet
"Auto Confirm User" aan, anders moet er eerst een e-mail bevestigd worden.

Dit is de enige keer dat je dit hoeft te doen. Iedereen daarna meldt zich aan
via de knop **Aanmelden** op het inlogscherm en wordt in de app toegelaten.

**4b. Laat registreren aanstaan.** In *Authentication → Sign In / Providers*
moet "Allow new users to sign up" **aan** staan, anders werkt aanmelden niet.
Dat is veilig: een nieuw account krijgt geen enkele rol en staat op inactief
tot iemand van het management het toelaat.

**5. Geef jezelf de rollen.** Jouw eigen account is er nog een van vóór die
regel, dus die zet je één keer met de hand goed:

```sql
update public.profiles
   set roles = array['employee','customer','management']::text[],
       name  = 'Casper'
 where email = 'casper@truckwash1group.nl';
```

Daarna herstart je de app (`npm run dev`). Verdere rollen deel je gewoon in de
app uit, via *Management → Personeel → Rechten*, en nieuwe mensen laat je toe
via *Management → Aanmeldingen*.

### Wie mag wat zien

Dit is met opzet in de database geregeld en niet alleen in de app: ook wie de
app omzeilt en rechtstreeks de database bevraagt, komt niet verder.

| | Klant | Werknemer | Management |
|---|---|---|---|
| Eigen wasbeurten en facturen | ja | ja | ja |
| Wasbeurten van **andere** klanten | **nee** | ja | ja |
| Voorraad en materiaalverbruik | **nee** | ja | ja |
| Eigen ingediende bonnen | — | ja | ja |
| Bonnen van collega's | **nee** | **nee** | ja |
| Bon goedkeuren of afkeuren | **nee** | **nee** | ja |
| Uren van collega's | **nee** | **nee** | ja |
| Rollen en rechten wijzigen | **nee** | **nee** | ja |

Een werknemer kan zijn eigen bon nog aanpassen zolang die op *open* staat;
zodra het management hem heeft beoordeeld, kan dat niet meer.

### Twee ontwerpkeuzes die opvallen in het schema

**Id's zijn `text`, niet door de database uitgedeelde UUID's.** De app moet
offline een nieuwe wasbeurt kunnen aanmaken. Zou de server het id bepalen, dan
kon dat niet.

**Tijdstempels zijn `bigint` met epoch-milliseconden**, hetzelfde formaat als
in JavaScript. Geen tijdzone-conversies. `updated_at` wordt door een trigger
serverzijdig gezet, en de app gebruikt de **servertijd** als cursor voor de
volgende synchronisatie — anders zou een telefoon met een verkeerd ingestelde
klok wijzigingen overslaan.

### Offline inloggen met een echte backend

Supabase controleert wachtwoorden op de server en stuurt ze nooit mee. Zonder
internet valt er dus niets te vragen. Daarom onthoudt de app bij een geslaagde
online inlog een SHA-256-afgeleide van het wachtwoord, met een salt die alleen
op dat apparaat bestaat. Wie eerder op dat toestel inlogde, komt daarna ook
zonder verbinding binnen — zonder dat het wachtwoord ergens is opgeslagen.
Zie [src/lib/offlineAuth.ts](src/lib/offlineAuth.ts).

### Terug naar de mock

Leeg de twee regels in `.env` (of hernoem het bestand). Handig om iets te
demonstreren zonder je echte gegevens te raken.

---

## E-mail via Resend

De app verstuurt zelf geen post. Dat doet een kleine serverfunctie bij
Supabase, en daar is een goede reden voor: alles wat je meelevert aan
telefoons en laptops is uit te lezen. De sleutel van Resend hoort dus niet in
de app.

### Twee regels waar alles op rust

1. **De app geeft nooit een e-mailadres mee**, maar een id — van een dossier
   of van een aanmelding. De functie zoekt het adres er zelf bij. Daarmee is
   dit geen doorgeefluik waarmee iemand namens `truckwash.cloud` post de
   wereld in kan sturen.
2. **De app geeft nooit opmaak mee**, alleen een sjabloonnaam en wat losse
   woorden. De vormgeving staat op de server, en alles wat erin wordt gezet
   gaat eerst door een filter dat tekens onschadelijk maakt.

### Uitrollen

```bash
npm install -g supabase          # eenmalig
supabase login
supabase link --project-ref <jouw-project-ref>

supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set MAIL_FROM="Truckwash1 Group <dashboard@preview.truckwash.cloud>"

supabase functions deploy stuur-mail --no-verify-jwt
```

Dat `--no-verify-jwt` is nodig omdat één verzoek van iemand zonder account
moet kunnen komen: de bevestiging van zijn eigen aanmelding. De controle
gebeurt in de functie zelf, en strenger dan een JWT-check alleen — die mail
gaat alleen uit als er bij dat adres werkelijk in het laatste kwartier een
aanmelding binnenkwam, en één keer.

Alle andere sjablonen eisen wél een geldige inlog, en waar het hoort ook de
rol management.

### Wanneer er post uitgaat

| Wanneer | Naar wie |
| --- | --- |
| Iemand meldt zich aan | De aanmelder (bevestiging) én het management (seintje) |
| Een aanmelding wordt toegelaten | De aanmelder, met wat hij nu mag |
| Een aanmelding wordt afgewezen | De aanmelder, met de reden die je hebt ingevuld |
| Een kritieke storing, of eentje die de installatie stillegt | De technische dienst |
| Antwoord of statuswijziging op een melding aan de ontwikkelaar | De melder |

Bewust **niet** bij elk bericht in het overleg en niet bij elke gewone
melding. Post die te vaak komt wordt niet meer gelezen, en dan mist de mail
die er wél toe doet zijn doel.

### Als er iets misgaat

De app blijft gewoon werken. De melding in de app is de echte melding; de
mail is de tik op de schouder voor wie de app niet openheeft. Mislukt het
versturen, dan komt dat in het logboek en gaat de rest door.

Wat eruit is gegaan zie je onder *Ontwikkeling → Post*: aan wie, wanneer, en
bij een mislukking wat de server terugkreeg. Dat is er precies voor de vraag
"ik heb niets ontvangen" — anders is die niet te beantwoorden.

> Staat de functie nog niet bij Supabase, dan merkt de app dat aan de eerste
> poging en houdt op met vragen tot de app herstart. Er komt dus geen stroom
> foutmeldingen van.

---

## Merk en iconen

Het logo staat in [src/assets/logo.webp](src/assets/logo.webp) en wordt
gebruikt op het inlogscherm, bij de rolkeuze en in de zijbalk. De merkkleuren
komen er rechtstreeks uit: geel `#F8C010` en wit `#F8F8F8` op donker marine.

App-iconen en opstartschermen genereer je opnieuw met:

```bash
npm run assets:icons
```

Die leest `assets/icon.png` (1024×1024) en `assets/splash.png` (2732×2732) en
zet alle formaten in de Android- en iOS-projecten.

> **Let op de bronresolutie.** Het aangeleverde logo is 250×70 pixels. Het
> truck-symbool daaruit is dus maar 73×70 — genoeg voor een icoon op een
> telefoonscherm, maar zichtbaar zacht op een groot vlak zoals de
> App Store-vermelding. Lever je het origineel aan (SVG, AI, EPS of een PNG
> van 1024 px), dan is één keer `npm run assets:icons` genoeg voor scherpe
> iconen overal.

---

## Structuur

```
electron/            main-proces + preload (auto-update, IPC)
android/ ios/        native projecten (Capacitor) -- horen in git
supabase/
  migrations/        het schema, per stap
  setup.sql          alles achter elkaar -- dit plak je in Supabase
  functions/
    stuur-mail/      de enige plek met de sleutel van Resend
assets/              bron voor app-iconen en opstartschermen
scripts/             starters voor desktop/APK, zelftest
src/
  lib/
    db.ts            lokale cache (Dexie)
    sync.ts          outbox, push/pull, automatiek
    repo.ts          alle schrijfacties
    analytics.ts     KPI's, reeksen, prestaties, voorraad
    offlineAuth.ts   inloggen zonder verbinding
    updates.ts       updates per platform
    charts.ts        gedeelde grafiekstijl
    chat.ts          kanalen, berichten, ongelezen
    signups.ts       zelf aanmelden en toelaten
    mail.ts          vraagt de serverfunctie om post
    tickets.ts       meldingen aan de ontwikkelaar
    techniek.ts      installaties, storingen, werkbonnen
    api/
      types.ts       de interface waar alles op leunt
      index.ts       kiest mock of Supabase
      mockApi.ts     ingebouwde backend
      supabaseApi.ts echte backend
  store/             sessie, rolkeuze, meldingen
  components/        inlog, aanmelden, animatie, rolkeuze, shell, tegels,
                     overleg, zoeken, meldingen, ui
  dashboards/
    employee/        start, vandaag, uren, materiaal, kosten
    customer/        start, overzicht, plannen, historie, facturen
    supervisor/      team, rooster, smartroster, uren
    technician/      storingen, werkbonnen, installaties, onderhoud
    developer/       meldingen, logboek, systeem, post
    management/      overzicht, financieel, planning, personeel,
                     aanmeldingen, voorraad, techniek, beheer
```
