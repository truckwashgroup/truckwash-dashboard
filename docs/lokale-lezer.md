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

### 6. Hij start al vanzelf mee

Dit is al voor je gedaan: er staat een geplande taak **Truckwash factuurlezer**
die het programma start zodra je je aanmeldt, dertig seconden later (zodat het
netwerk er is), en hem opnieuw start als hij onverhoopt omvalt. Je hoeft dus
niets op te starten; zet de pc aan en meld je aan, en hij draait.

Controleren, wijzigen of weghalen kan in de Taakplanner, of met deze regels in
PowerShell:

```powershell
# Draait hij?
Get-ScheduledTask -TaskName "Truckwash factuurlezer" | Get-ScheduledTaskInfo

# Nu meteen starten of stoppen
Start-ScheduledTask -TaskName "Truckwash factuurlezer"
Stop-ScheduledTask  -TaskName "Truckwash factuurlezer"

# Helemaal weghalen
Unregister-ScheduledTask -TaskName "Truckwash factuurlezer" -Confirm:$false
```

Wil je zien wát hij doet, start hem dan zelf in een venster met `npm start`
(stop eerst de taak, anders lezen er twee tegelijk mee); de regels per factuur
komen dan in beeld.

Staat de taak er ooit niet meer, dan maak je hem opnieuw met dit blok in
PowerShell:

```powershell
$map = "C:\Users\Contr Truckwash\Desktop\projecten\dashboard\lezer"
$actie = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" -Argument "lezer.mjs" -WorkingDirectory $map
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$env:USERNAME"
$trigger.Delay = "PT30S"
$inst = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Truckwash factuurlezer" -Action $actie -Trigger $trigger -Settings $inst -Force
```

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
| `goedkeuring_bron` | `mens` of `automatisch`; leeg bij alles wat nog openstaat |
| `goedkeuring_reden` | de zin waarmee een automatische goedkeuring is genomen |

### Twee modellen: één voor tekst, één voor foto's

Een PDF uit een boekhoudpakket heeft een tekstlaag; die gaat als platte tekst
naar het model en daar is geen oog voor nodig. Een scan of een foto moet
gezien worden. Je kunt daar dus twee verschillende modellen voor gebruiken:
`LEZER_MODEL_TEKST` en `LEZER_MODEL_BEELD` in `lezer/.env`. Laat je ze leeg,
dan gebruikt hij voor allebei `LEZER_MODEL` — en dat is de standaard.

Gemeten op de RTX 5090, dezelfde factuur, hetzelfde schema, alles warm:

| model | tekst | uitkomst |
|---|---|---|
| llama3.2 (3B) | 2,9s | **onbruikbaar**: zei "verkoop" in plaats van "inkoop", datums in het verkeerde formaat |
| qwen2.5-coder:14b | 6,8s | alles goed, maar verzon een twijfel over een optelling die klopte |
| gpt-oss:20b | 17,4s | alles goed |
| gemma4:26b | 9,9s | alles goed |

Twee dingen vallen daaraan op. Op een PDF met tekstlaag scheelt het grote
model maar drie seconden met een klein model, dus snelheid is een magere
reden om te splitsen. En hoe kleiner het model, hoe eerder het de *oordelen*
mist: inkoop of verkoop, en of er iets te twijfelen valt. Juist die twee
bepalen of een bon verdwijnt of vanzelf wordt goedgekeurd.

Waar splitsen wél voor is: geheugen. Een 14B (~9 GB) en gemma4:26b (~18 GB)
passen samen in 32 GB, dus Ollama hoeft niet te wisselen en een foto en een
tekstfactuur kunnen naast elkaar gelezen worden.

Wil je het proberen, doe dat eerst met `--proef` op een paar echte facturen —
en kijk niet alleen naar de bedragen maar juist naar `richting` en `twijfel`.

### Hoe vaak hij kijkt

Is er niets te doen, dan wacht hij `LEZER_INTERVAL` seconden (standaard 10) en
vraagt hij opnieuw. Is er wél werk, dan wacht hij helemaal niet: hij leest de
bonnen één voor één en vraagt meteen om de volgende, tot de stapel leeg is.
Antwoordt de server niet, dan gaat hij naar vier keer die pauze, zodat een
kapotte lijn geen logboek vol schrijft.

Per ronde eist hij hoogstens `LEZER_MAX` bonnen op (standaard 5). Dat maakt
hem niet sneller -- hij leest ze toch één voor één, want twee keer een model
van 26 miljard parameters naast elkaar past niet in 32 GB videogeheugen -- het
bepaalt alleen hoe vaak hij tussendoor de server hoeft te vragen.

In `instellingen`: `factuur_lezer` (de keuze), `lezer_laatst_gezien` (epoch
ms als tekst) en `lezer_model` (de laatste twee zet het programma zelf), plus
`auto_goedkeuren` met `auto_goedkeuren_vanaf`, `auto_goedkeuren_marge` en
`auto_goedkeuren_max`.

---

## Facturen die zichzelf goedkeuren

Los van wie er leest staat er sinds 0050 nóg een stap klaar, en die **staat
uit**. Zet je hem aan, dan mag een factuur zichzelf goedkeuren als dezelfde
leverancier al een paar keer voor ongeveer hetzelfde bedrag is goedgekeurd.

Aanzetten: **Ontwikkeling → Inkoop → Zichzelf goedkeuren**. Daar staan ook de
drie getallen: vanaf hoeveel keer (standaard 3), hoeveel procent het bedrag mag
afwijken (standaard 2) en het plafond (standaard € 500 exclusief btw).

### Wanneer gaat een factuur vanzelf door

Alles hieronder moet kloppen. Eén nee is genoeg om hem gewoon in de rij te
laten staan.

| Voorwaarde | Waarom |
|---|---|
| Minstens 3 eerdere goedkeuringen **van een mens** | Wat het systeem zelf goedkeurde telt niet mee. Anders bevestigt het na verloop van tijd zijn eigen vergissingen. |
| Bedrag binnen 2% van de **mediaan** van die drie | Niet het gemiddelde: één jaarafrekening ertussen zou de grens optillen voor alles daarna. |
| Onder het plafond van € 500 | Een leverancier die elke maand € 40 stuurt en ineens € 4.000 is geen gewoonte maar een vraag. |
| Het factuurnummer staat nog niet bij deze leverancier | Anders is het een herinnering of een dubbele, en die betaal je niet twee keer. |
| De lezer twijfelde nergens over | Twijfel betekent dat er een mens naar moet kijken; daar is het veld voor. |
| De grootboekrekening komt uit het geheugen, niet uit een gok | Kent het systeem deze leverancier nog niet, dan kan het ook niet weten dat dit "hetzelfde" is. |
| Het is een factuur of een bon | Een aanmaning is per definitie een tweede keer. |

### Wat je ervan ziet

De bon staat op *goedgekeurd* met **Automatisch** als goedkeurder en een badge
*vanzelf goedgekeurd* in de lijst. In het detail staat de hele reden: op
hoeveel eerdere facturen hij zich baseerde, welk bedrag daarbij gebruikelijk
was en hoeveel deze afwijkt. Het management krijgt er een melding van.

Klopt het niet, dan keur je hem gewoon af. Vanaf dat moment telt jouw oordeel
weer mee en het automatische niet.

### Hoe ik het zou aanzetten

Laat hem eerst een maand of twee uit staan en kijk in Kostenposten hoe vaak de
lezer het goed had. Zet hem daarna aan met het plafond laag — €100 bijvoorbeeld
— zodat alleen de kleine, saaie maandfacturen doorgaan en alles wat geld kost
nog steeds langs een mens komt. Werkt dat een paar maanden goed, dan verhoog je
het plafond.
