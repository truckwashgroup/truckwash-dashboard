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
een echt account kom je er niet in. Gebruikers maak je aan in Supabase onder
*Authentication → Users*, en rollen ken je toe in de app.

Zijn `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` niet ingevuld, dan meldt
het inlogscherm dat en is de knop uitgeschakeld. De ingebouwde testgegevens
zitten er nog wel, maar alleen voor de geautomatiseerde tests, en die zijn
niet vanuit de app te bereiken.

---

## Wat de app doet

**Inloggen → wasstraat-animatie → rolkeuze → dashboard.**

De animatie draait één keer per inlog: een vrachtwagen rijdt de wasstraat
binnen, krijgt voorwas, schuim, borstels, spoeling en droging, en komt
glanzend aan de andere kant naar buiten. Overslaan kan rechtsboven.

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
- Personeel: dossiers, rooster, en **per persoon precies instellen wat mag**
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
npm run selftest        # 111 controles op de app-logica
npm run sqltest         # 56 controles: het databaseschema in een echte Postgres
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

**2. Zet het schema klaar.** Open in Supabase de **SQL Editor**, plak de inhoud
van [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) en
druk op Run. Daarna hetzelfde met [supabase/seed.sql](supabase/seed.sql) voor
de klanten en voorraadartikelen.

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

**4. Maak gebruikers aan** onder *Authentication → Users → Add user*. Zet
"Auto Confirm User" aan, anders moet er eerst een e-mail bevestigd worden. Er
wordt automatisch een profiel aangemaakt.

**4b. Zet openbaar registreren uit.** Standaard mag iedereen die de app heeft
zelf een account aanmaken. Voor een bedrijfsapp wil je dat niet: ga naar
*Authentication -> Sign In / Providers* en schakel "Allow new users to sign up"
uit. Nieuwe collega's voeg je daarna zelf toe onder *Users*.

**5. Ken rollen toe.** Nieuwe gebruikers krijgen standaard alleen de klantrol.
Geef jezelf alle drie via de SQL Editor:

```sql
update public.profiles
   set roles = array['employee','customer','management']::text[],
       name  = 'Casper'
 where email = 'casper@truckwash1group.nl';
```

Daarna herstart je de app (`npm run dev`). Verdere rollen deel je gewoon in de
app uit, via *Management → Personeel → Rechten*.

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
supabase/            databaseschema en startgegevens
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
    api/
      types.ts       de interface waar alles op leunt
      index.ts       kiest mock of Supabase
      mockApi.ts     ingebouwde backend
      supabaseApi.ts echte backend
  store/             sessie, rolkeuze, meldingen
  components/        inlog, wasstraat-animatie, rolkeuze, shell, logo, ui
  dashboards/
    employee/        vandaag, uren, materiaal, kosten
    customer/        overzicht, plannen, historie, facturen
    management/      overzicht, financieel, planning, personeel, voorraad
```
