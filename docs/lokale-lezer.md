# De lokale factuurlezer

Voor Casper: hoe je de facturen op je eigen pc laat lezen in plaats van bij
Claude, wat daarvoor op die pc moet staan, en hoe je ziet dat het werkt. De
details van het programma zelf (opties, foutmeldingen, `--proef`) staan in
`lezer/README.md`.

---

## Waar het om gaat

Een factuur die op een inkoopadres binnenkomt wordt voorgelezen: leverancier,
factuurnummer, IBAN, btw-nummer, de regels en de bedragen. Tot nu toe deed
Claude dat, in de cloud. Dat kost een paar cent per factuur en de factuur
gaat het pand uit.

Op de pc met de RTX 5090 draait Ollama met het model `gemma4:26b`. Dat model
leest dezelfde testfactuur foutloos uit in 8 seconden (uit de tekst van de
PDF) tot 15 seconden (van een plaatje), inclusief IBAN, btw-nummer en KvK.
Daarom kan het lezen nu ook lokaal.

Het belangrijkste is wat er níét verandert. Het lokale programma leest
alleen. Alles wat daarna komt -- opschonen, de verkoopcontrole op de eigen
nummers, indelen op grootboek en tags, wegschrijven bij de bon -- doet de
server, met dezelfde code als bij Claude. Een factuur die lokaal gelezen is
ziet er in het dashboard dus precies zo uit als een die Claude las; alleen
het veld *lezer* op de kostenpost zegt wie het was.

---

## De drie standen

In het dashboard Ontwikkelaar, onder **Inkoop**, staat onder het vinkje
*Facturen automatisch uitlezen en indelen* het blok **Wie leest de facturen**:

| Stand | Wat er gebeurt |
|---|---|
| **Claude (Sonnet 5, in de cloud)** | Zoals het was. De post leest de factuur meteen bij binnenkomst. Leest foto's van gekreukte bonnen het best. Kost per factuur; de factuur gaat naar Anthropic. |
| **Lokaal (Ollama op de eigen server)** | De post zet de bon op *wacht*. Het programma op de pc haalt hem binnen een halve minuut op, leest hem en meldt zich terug. Gratis per factuur; de factuur verlaat het pand niet. Staat de pc uit, dan blijven de bonnen wachten tot hij weer aan is. |
| **Lokaal, met Claude als terugval** | Lokaal lezen. Twijfelt het lokale model (leverancier of totaal ontbreekt, de bedragen tellen niet op, of het model meldt zelf twijfel), of is Ollama niet bereikbaar, dan gaat de factuur alsnog naar Claude. De veilige middenweg. |

De keuze bewaar je met de knop *Opslaan* eronder. De instelling heet in de
database `factuur_lezer` (`claude`, `lokaal` of `lokaal-terugval`); staat er
niets of iets onbekends, dan is het `claude`.

Onder de drie keuzes staat **Lokale lezer laatst gezien ... , model ...**.
Het programma meldt zich bij elke ronde; is dat langer dan vijf minuten
geleden terwijl een lokale stand gekozen is, dan wordt die regel rood.

---

## Wat er op de pc moet staan

1. **Node 24.** Controleer met `node --version`.
2. **Ollama** (0.33 of nieuwer), draaiend op `http://localhost:11434`.
3. **Het model:** `ollama pull gemma4:26b`. Een ander model kan ook, maar het
   moet plaatjes kunnen lezen en een JSON-schema als antwoordvorm aannemen;
   zet de naam dan in `LEZER_MODEL` (zie onder).
4. **De map `lezer/`** uit deze repo, met `npm install` erin gedraaid.

Het programma kent geen servicesleutel en geen API-sleutel. Het heeft één
geheim (`LEZER_SECRET`) en praat met precies twee adressen: de Edge Function
`lezer` op Supabase en Ollama op localhost.

---

## Eén keer instellen

### 1. De database bijwerken (migratie 0049)

Plak `supabase/bijwerken.sql` in de SQL-editor van Supabase en druk op Run.
Dat zet de instelling `factuur_lezer` (standaard `claude`) en de kolommen
`lees_status`, `lees_geclaimd_at` en `lezer` op `expenses`. Zonder deze stap
valt de post terug op Claude en zegt de log van ontvang-mail dat erbij.

### 2. Het geheim: LEZER_SECRET

Kies een lang wachtwoord (letters en cijfers volstaan). Zet het op de server:

```
# vanuit de map dashboard
supabase secrets set LEZER_SECRET=<het wachtwoord> --project-ref yxsbmhavnttswxczeovt
```

Zonder dit geheim antwoordt de functie `lezer` met 500 en zegt waarom; met
een verkeerd geheim met 403.

### 3. De Edge Functions uitrollen

```
npm run functions:open
```

Dat rolt `lezer` uit met `--no-verify-jwt`, samen met `ontvang-mail` en de
andere open functies. Nooit een kaal `supabase functions deploy`: dat zet
verify_jwt aan en dan komt het programma (dat alleen het geheim meestuurt,
geen token) er niet meer doorheen.

### 4. De .env in lezer/

Kopieer `lezer/.env.voorbeeld` naar `lezer/.env` en vul het geheim in:

```
LEZER_URL=https://yxsbmhavnttswxczeovt.supabase.co/functions/v1/lezer
LEZER_SECRET=<hetzelfde wachtwoord>
LEZER_MODEL=gemma4:26b
LEZER_INTERVAL=30
OLLAMA_URL=http://localhost:11434
```

`LEZER_INTERVAL` is het aantal seconden tussen twee rondes; 30 is een goede
waarde. Sneller heeft geen zin -- de post komt niet vaker binnen -- en de
server wordt er onnodig mee lastiggevallen.

### 5. Starten

```
cd lezer
npm start
```

Je ziet per factuur één regel: tijd, kostenpost, modus (tekst of plaatje),
duur en uitkomst. Laat het venster openstaan, of beter:

### 6. Als Windows-taak bij het aanmelden

Zo start het programma vanzelf mee en hoef je er niet aan te denken. Eén
regel in een **opdrachtprompt (cmd, niet PowerShell)**, als de gebruiker die
zich aanmeldt; beheerdersrechten zijn niet nodig. Pas het pad aan:

```
schtasks /create /tn "Truckwash lezer" /tr "cmd /c cd /d \"C:\Users\Contr Truckwash\Desktop\projecten\dashboard\lezer\" && npm start" /sc onlogon
```

Waarom cmd: de regel gebruikt `\"` om aanhalingstekens binnen aanhalingstekens
te zetten, en dat verstaat alleen cmd. PowerShell sluit de tekst bij de eerste
`\"`, hakt het pad met de spatie in losse stukken en schtasks krijgt een
kapotte opdracht. Wil je het toch vanuit PowerShell, zet dan `--%` achter
`schtasks`: vanaf dat teken geeft PowerShell de rest letterlijk door, zonder
er zelf iets van te maken (enkele aanhalingstekens buiten en dubbele binnen
lijkt te werken, maar PowerShell 5.1 -- de standaard op Windows 11 -- laat de
binnenste aanhalingstekens vallen bij het doorgeven aan het programma):

```
schtasks --% /create /tn "Truckwash lezer" /tr "cmd /c cd /d \"C:\Users\Contr Truckwash\Desktop\projecten\dashboard\lezer\" && npm start" /sc onlogon
```

Controleren of hij loopt: Taakplanner, of in het Inkoop-scherm kijken naar
*laatst gezien*. Weghalen: `schtasks /delete /tn "Truckwash lezer" /f`.
De precieze regel en wat je doet als hij niet start staan in
`lezer/README.md`.

### 7. De stand kiezen

Pas nu de stand in het dashboard op *Lokaal* of *Lokaal, met Claude als
terugval* zetten en opslaan. Doe je dit eerder, dan blijven de bonnen op
*wacht* staan tot het programma draait -- niet erg, ze worden alsnog gelezen,
maar het is wel verwarrend.

Begin met de terugval-stand. Pas als je een paar weken ziet dat de lokale
lezer nooit hoeft terug te vallen, zet je hem op alleen lokaal.

**Terug naar Claude?** Bonnen die op dat moment al op *wacht* staan gaan niet
vanzelf naar Claude: de post heeft ze aan de pc gegeven, en alleen de pc (of
een mens) maakt ze af. Laat het programma dus nog even draaien tot er in
Kostenposten geen bon meer met *wacht op de lokale lezer* staat, en zet dan
pas de stand terug. Staat er toch nog een, lees hem dan met de knop *Lezen*
bij de kostenpost -- dat haalt hem uit de wachtrij van de pc.

---

## Controleren dat het werkt

1. **Inkoop-scherm.** Binnen een halve minuut na het starten staat er *Lokale
   lezer laatst gezien zojuist, model gemma4:26b*. Blijft er *nog nooit
   gezien* staan, dan komt het programma niet bij de server: kijk in het
   venster van het programma naar de foutmelding (meestal het geheim, of
   `functions:open` nog niet gedraaid).
2. **Een factuur mailen** naar een inkoopadres (de adressen staan onderaan
   het Inkoop-scherm). Bij Kostenposten verschijnt de bon met het label
   *wacht op de lokale lezer*; na een halve minuut plus de leestijd is dat
   label weg en staat er *Voorgelezen*, met de leverancier, het nummer en de
   bedragen erbij.
3. **Ging het mis,** dan staat er *lezen mislukt* op de bon en staat de reden
   in de lezing onder *waar het model over twijfelde*, net als bij Claude.
   In de terugval-stand zie je in plaats daarvan een gewone lezing, met
   `claude (terugval)` als lezer.

Een bon die te lang op *bezig* blijft staan (het programma viel middenin
weg) wordt na tien minuten opnieuw aangeboden; daar hoef je niets aan te
doen.

### Even een los bestand proberen

Zonder de server aan te raken, om te zien wat het model ervan maakt:

```
cd lezer
node lezer.mjs --proef C:\pad\naar\factuur.pdf
```

Drukt het ruwe JSON af. Met `LEZER_URL` en `LEZER_SECRET` in de .env haalt
het de opdracht en het schema van de server; zonder die twee gebruikt het de
kopie in `lezer/prompt.json`.

---

## Wat je terugziet in de database

Op `expenses`:

| Kolom | Betekenis |
|---|---|
| `lees_status` | `wacht`, `bezig`, `klaar` of `mislukt`; leeg als de bon niet via de lokale lezer ging |
| `lees_geclaimd_at` | wanneer het programma de bon opeiste (epoch ms); ouder dan tien minuten op *bezig* geldt als vastgelopen |
| `lezer` | wie las: `claude`, `claude (terugval)` of `lokaal: gemma4:26b` |

In `instellingen`: `factuur_lezer` (de keuze), `lezer_laatst_gezien` (epoch
ms als tekst) en `lezer_model` (de laatste twee zet het programma zelf).
