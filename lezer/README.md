# De lokale lezer

Leest binnengekomen facturen op deze pc met Ollama, in plaats van bij Claude.
Het programma haalt werk bij de functie `lezer` op Supabase, laat het model
lezen, en stuurt de ruwe lezing terug. Opschonen, verkoopcontrole, indelen en
wegschrijven doet de server -- in dezelfde code die ook na Claude draait, dus
de uitkomst is hetzelfde, wie er ook las.

Het programma kent geen servicesleutel en geen API-sleutel. Het heeft alleen
`LEZER_SECRET` en praat alleen met de functie `lezer` en met Ollama op
localhost.

## Installeren

1. **Node 24** -- <https://nodejs.org>. Controleer met `node --version`.
2. **Ollama** -- <https://ollama.com>. Daarna het model ophalen (ruim 16 GB):

       ollama pull gemma4:26b

   Het model moet plaatjes kunnen lezen; gemma4:26b kan dat en past op de
   RTX 5090.
3. **Dit programma** -- in deze map:

       npm install

## Instellen

Kopieer `.env.voorbeeld` naar `.env` en vul `LEZER_SECRET` in. Dat is
hetzelfde geheim dat op de server staat:

    supabase secrets set LEZER_SECRET=<lange willekeurige tekst> --project-ref yxsbmhavnttswxczeovt

Zonder dit geheim geeft de server 403 en stopt het programma met een melding.
De andere waarden (`LEZER_URL`, `LEZER_MODEL`, `LEZER_INTERVAL`, `OLLAMA_URL`)
staan goed voor de gewone situatie.

Zet daarna in het dashboard bij **Ontwikkelaar > Inkoop** onder "Wie leest de
facturen" de keuze op *Lokaal* of *Lokaal, met Claude als terugval*. Zolang
daar *Claude* staat komt er geen werk, ook al draait het programma.

## Starten

    npm start

Het programma vraagt elke 30 seconden om werk en logt per factuur een regel:
tijd, kostenpost, modus (`tekst` of `plaatje`), duur en uitkomst (`klaar`,
`terugval`, `mislukt`). Stoppen met Ctrl+C; een lopend stuk wordt eerst
afgemaakt.

Twee soorten misgaan, met een verschillende afloop:

- **Lezen mislukt** (bijlage niet op te halen of groter dan 12 MB, geen PDF
  of foto, het model geeft geen leesbare JSON): de bon krijgt `mislukt` en de
  reden komt in de app bij de bon te staan. In de stand *lokaal met terugval*
  leest Claude hem dan alsnog. Uitzondering: ligt het aan deze pc zelf --
  Ollama is niet bereikbaar of antwoordt niet binnen tien minuten -- dan
  meldt de lezer dat als *tijdelijk* en zet de server de bon terug op
  `wacht`. Een herstart van Ollama kost dan alleen wachttijd, geen bon.
- **Melden mislukt** (de bon is gelezen, maar het antwoord van de server op
  `klaar` of `terugval` komt niet -- netwerkblip, of de server had meer dan
  vijf minuten nodig): het log zegt "gelezen, maar 'klaar' kon niet gemeld
  worden". Er wordt dan bewust GEEN `mislukt` gestuurd, want de server heeft
  de bon meestal al afgemaakt (bij `klaar` bewaart hij de lezing en draait hij
  de verwerking, bij `terugval` leest Claude hem over). Is de bon toch op
  'bezig' blijven staan, dan deelt de server hem na tien minuten vanzelf
  opnieuw uit.

### Bij aanmelden laten starten (Windows-taak)

Een keer, in een opdrachtprompt als de gebruiker die zich aanmeldt:

    schtasks /create /tn "Truckwash lezer" /tr "cmd /c cd /d \"C:\Users\Contr Truckwash\Desktop\projecten\dashboard\lezer\" && npm start" /sc onlogon

Pas het pad aan als de map ergens anders staat. Weghalen:

    schtasks /delete /tn "Truckwash lezer" /f

Ollama zelf start al bij aanmelden als je dat bij de installatie hebt
aangevinkt; anders moet die ook als taak.

## Zien dat het werkt

- In het dashboard bij **Ontwikkelaar > Inkoop** staat "Lokale lezer laatst
  gezien <zojuist>, model gemma4:26b". Wordt dat rood, dan heeft het programma
  meer dan vijf minuten niet om werk gevraagd: pc uit, Ollama gestopt, of het
  programma is afgesloten.
- Bij **Kostenposten** krijgt een bon die op de lokale lezer wacht een badge
  "wacht op de lokale lezer"; is het lezen mislukt dan staat de reden bij de
  bon in de twijfel.

## Een bestand los proberen

    node lezer.mjs --proef pad\naar\factuur.pdf

Leest dat ene bestand met Ollama en drukt de JSON en de duur af. De server
wordt niet aangeraakt; als `.env` compleet is komen prompt en schema wel van
de server (werk vragen met `max: 0` claimt niets), anders uit `prompt.json`.
Dat bestand is een kopie voor precies dit doel -- de waarheid staat in
`supabase/functions/_gedeeld/factuurlezer.ts`.

Met `--plaatje` erachter wordt een PDF niet via de tekstlaag maar als plaatje
gelezen, zoals een scan. Handig om de scanroute te bekijken met een PDF die
eigenlijk wel tekst heeft:

    node lezer.mjs --proef pad\naar\factuur.pdf --plaatje

Ter vergelijking, de PreZero-testfactuur op deze pc (RTX 5090, gemma4:26b):
tekstlaag 17 s, PDF als plaatje 13 s, foto van 37 kB 10 s. Alle drie gaven
subtotaal 194.50, btw 40.85 en totaal 235.35; alleen de kleine foto las
IBAN, KvK en btw-nummer een cijfer verkeerd.

## Hoe het leest

- **PDF met tekstlaag** (digitaal aangemaakt): de tekst gaat naar het model.
  Snelst en het preciest, ook voor IBAN, KvK en btw-nummer.
- **PDF zonder tekstlaag** (scan) en **foto's**: de eerste drie pagina's
  worden op 1600 pixels breed gerenderd en als plaatje aangeboden. Daar leest
  het model bedragen en namen goed, maar op een kleine of onscherpe foto gaan
  lange cijferreeksen (IBAN, KvK, btw-nummer) weleens een cijfer mis. Daar is
  de terugval voor; en een foto op ware grootte helpt meer dan een kleinere.
- Na het lezen een controle: geen leverancier, geen totaal, subtotaal plus btw
  is niet het totaal, of het model twijfelt zelf. Valt die om, dan gaat het
  stuk naar Claude als *Lokaal, met Claude als terugval* aanstaat; anders
  toch naar de server, die de twijfel bij de bon zet.
