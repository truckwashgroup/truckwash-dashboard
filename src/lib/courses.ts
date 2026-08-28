import type { Course } from './types'

/* ------------------------------------------------------------------ *
 *  Lesmateriaal voor een vrachtwagenwasstraat.
 *
 *  Dit is de startinhoud. Het management kan cursussen later aanpassen;
 *  bij een wijziging gaat het versienummer omhoog en moeten mensen met een
 *  oudere versie de toets opnieuw doen.
 * ------------------------------------------------------------------ */

const t = 0 // updatedAt wordt bij het zaaien gezet

export const COURSES: Course[] = [
  /* ================================================================ */
  {
    id: 'crs_veiligheid',
    code: 'VEI-01',
    title: 'Veilig werken in de wasstraat',
    summary:
      'De basis: wat er mis kan gaan tussen bewegende borstels, hogedruk en ' +
      'natte vloeren, en hoe je dat voorkomt.',
    category: 'veiligheid',
    estimatedMinutes: 20,
    requiredFor: ['employee', 'supervisor', 'management'],
    validMonths: 12,
    passScore: 80,
    version: 1,
    updatedAt: t,
    lessons: [
      {
        id: 'l1',
        title: 'De risico’s op een rij',
        body: [
          'Een truckwash combineert vier dingen die elk op zich al gevaarlijk zijn: zware bewegende delen, water onder hoge druk, agressieve chemie en een gladde vloer. De meeste ongevallen ontstaan niet door één groot falen, maar doordat twee kleine dingen samenvallen — iemand die haast heeft en een borstel die nog nadraait.',
          'De borstelunits hebben een nalooptijd. Nadat je de installatie stopt, draaien de borstels nog enkele seconden door. Die seconden zijn precies het moment waarop mensen naar binnen stappen omdat ze denken dat het klaar is.',
          'Hogedrukwater van 150 bar snijdt door huid heen. Een straal die je van een halve meter afstand op je hand krijgt, veroorzaakt een wond die er klein uitziet maar diep gaat en snel ontsteekt. Richt de lans nooit op jezelf of een collega, ook niet als grap.',
        ],
        keyPoints: [
          'Borstels lopen na: wacht tot alles echt stilstaat.',
          'Hogedruk kan door huid heen snijden.',
          'Natte vloer plus haast is de meest voorkomende oorzaak van letsel.',
        ],
        warning:
          'Betreed de wasstraat nooit terwijl er een voertuig in behandeling is, ook niet even snel.',
      },
      {
        id: 'l2',
        title: 'Persoonlijke beschermingsmiddelen',
        body: [
          'Bij alle werkzaamheden draag je veiligheidsschoenen met een antislipzool en een stalen neus. Vallende onderdelen en natte tegels zijn de twee dingen waar je voeten tegen beschermd moeten zijn.',
          'Bij het aanmaken of overgieten van reinigingsmiddelen draag je nitril handschoenen en een spatbril. Let op: latex handschoenen bieden onvoldoende bescherming tegen de alkalische middelen die wij gebruiken. Nitril wel.',
          'Bij tankreiniging en bij werken in besloten ruimtes gelden aanvullende eisen. Daar mag je alleen aan beginnen als je daar apart voor bent opgeleid en er een tweede persoon buiten staat die toezicht houdt.',
        ],
        keyPoints: [
          'Altijd: veiligheidsschoenen met antislip.',
          'Bij chemie: nitril handschoenen en spatbril, geen latex.',
          'Tankreiniging: alleen met aanvullende opleiding en toezicht.',
        ],
      },
      {
        id: 'l3',
        title: 'Noodstop en wat daarna',
        body: [
          'De noodstoppen zitten bij de ingang, bij de uitgang en bij de bedieningspost. Je moet ze met je ogen dicht kunnen vinden. Loop ze op je eerste werkdag alle drie langs.',
          'Na een noodstop start je de installatie niet zomaar opnieuw. Eerst kijken wat de aanleiding was, dan de wasstraat vrijmaken van mensen, en pas dan resetten. Een noodstop die je zonder nadenken reset, is een ongeval dat twee keer gebeurt.',
          'Elke noodstop wordt gemeld bij je leidinggevende, ook als er niets gebeurd is. Die meldingen zijn hoe we patronen zien voordat er echt iets misgaat.',
        ],
        keyPoints: [
          'Drie noodstoppen: ingang, uitgang, bedieningspost.',
          'Na een noodstop: oorzaak zoeken, ruimte vrijmaken, dan pas resetten.',
          'Altijd melden, ook zonder schade.',
        ],
      },
    ],
    quiz: [
      {
        id: 'q1',
        text: 'De installatie is gestopt. Wanneer mag je de wasstraat betreden?',
        options: [
          'Direct, de installatie staat immers uit',
          'Zodra alle bewegende delen volledig stilstaan',
          'Na tien seconden, dat is altijd genoeg',
          'Als de collega bij de bediening knikt',
        ],
        correct: 1,
        explain: 'Borstels hebben een nalooptijd. Alleen volledige stilstand telt.',
      },
      {
        id: 'q2',
        text: 'Welke handschoenen gebruik je bij het overgieten van alkalische ontvetter?',
        options: ['Latex', 'Nitril', 'Katoen', 'Geen, kort contact kan geen kwaad'],
        correct: 1,
        explain: 'Latex laat alkalische middelen door; nitril niet.',
      },
      {
        id: 'q3',
        text: 'Iemand drukt de noodstop in. Er blijkt niets aan de hand. Wat doe je?',
        options: [
          'Resetten en doorwerken',
          'Resetten en aan het eind van de dag noemen',
          'Oorzaak vaststellen, ruimte vrijmaken, resetten en melden bij je leidinggevende',
          'Wachten tot de leidinggevende het zelf ziet',
        ],
        correct: 2,
      },
      {
        id: 'q4',
        text: 'Wat is het gevaar van een hogedrukstraal op korte afstand?',
        options: [
          'Vooral schrikken',
          'Een oppervlakkige schaafwond',
          'De straal kan door de huid snijden en diep letsel geven',
          'Alleen gevaarlijk boven 300 bar',
        ],
        correct: 2,
      },
      {
        id: 'q5',
        text: 'Wanneer mag je alleen aan een tankreiniging beginnen?',
        options: [
          'Als je het een keer hebt zien doen',
          'Als je er apart voor bent opgeleid en er iemand toezicht houdt',
          'Als de klant haast heeft',
          'Als de tank leeg is',
        ],
        correct: 1,
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'crs_chemie',
    code: 'CHE-01',
    title: 'Reinigingsmiddelen en chemie',
    summary:
      'Welke middelen we gebruiken, waarom je ze nooit mengt, en wat je doet ' +
      'bij spatten of morsen.',
    category: 'chemie',
    estimatedMinutes: 25,
    requiredFor: ['employee', 'supervisor', 'management'],
    validMonths: 12,
    passScore: 80,
    version: 1,
    updatedAt: t,
    lessons: [
      {
        id: 'l1',
        title: 'Zuur en base: nooit mengen',
        body: [
          'We werken met twee families middelen. Alkalische ontvetters (hoge pH) halen olie, uitlaatroet en dieselvuil van de carrosserie. Zure velgenreinigers (lage pH) lossen remstof en kalkaanslag op.',
          'Deze twee mag je nooit bij elkaar brengen. De reactie is heftig, geeft warmte en kan schadelijke dampen opleveren. Dat geldt ook voor de restanten: giet nooit twee middelen in dezelfde emmer, en spoel een emmer altijd om voordat je er een ander middel in doet.',
          'Concentraat is geen gebruiksklaar product. Verdunnen doe je volgens de doseertabel bij de mengunit, en altijd door het middel bij het water te doen — niet andersom. Water bij zuur geeft spatten.',
        ],
        keyPoints: [
          'Alkalisch voor vuil en vet, zuur voor velgen en kalk.',
          'Nooit mengen, ook geen restanten in dezelfde emmer.',
          'Middel bij water, nooit water bij zuur.',
        ],
        warning:
          'Mengen van zuur en base kan schadelijke dampen geven. Bij twijfel: niet doen en je leidinggevende halen.',
      },
      {
        id: 'l2',
        title: 'Etiketten en veiligheidsbladen',
        body: [
          'Elk middel heeft een veiligheidsinformatieblad. Die map hangt bij de mengunit en staat ook digitaal bij de voorraad in deze app. Voordat je met een nieuw middel werkt, lees je in elk geval rubriek 4 (eerstehulpmaatregelen) en rubriek 8 (persoonlijke bescherming).',
          'Giet nooit een middel over in een ongemarkeerde fles of een oude frisdrankfles. Dat klinkt vanzelfsprekend, maar het is een van de meest voorkomende oorzaken van vergiftiging op werkplekken. Elke verpakking draagt het originele etiket, of een etiket met dezelfde informatie.',
          'De gevarenpictogrammen die je bij ons het meest ziet: het uitroepteken (irriterend), het corrosiepictogram (bijtend, tast huid en ogen aan) en het milieupictogram (schadelijk voor waterorganismen).',
        ],
        keyPoints: [
          'Veiligheidsblad lezen vóór eerste gebruik: rubriek 4 en 8.',
          'Nooit overgieten in ongemarkeerde verpakkingen.',
          'Bijtend betekent: onmiddellijk spoelen bij contact.',
        ],
      },
      {
        id: 'l3',
        title: 'Spatten, morsen en afvoer',
        body: [
          'Bij contact met de huid: direct spoelen met veel lauw water, minstens vijftien minuten. Kleding die doordrenkt is trek je uit terwijl je spoelt. Niet neutraliseren met een ander middel — dat maakt het erger.',
          'Bij contact met de ogen: spoelen met de oogdouche, minstens vijftien minuten, oogleden open houden. Daarna altijd naar de huisarts of de spoedeisende hulp, ook als het beter voelt. Neem het etiket of een foto ervan mee.',
          'Gemorst product ruim je op met het absorptiemateriaal uit de calamiteitenset, niet met water. Water verspreidt het alleen en brengt het in de waterafvoer. Onze afvalwaterzuivering kan een normale werkdag aan, maar geen liters onverdund concentraat.',
        ],
        keyPoints: [
          'Huid en ogen: vijftien minuten spoelen, niet neutraliseren.',
          'Na oogcontact altijd medische hulp, ook bij verbetering.',
          'Morsen opruimen met absorptiemateriaal, niet wegspoelen.',
        ],
      },
    ],
    quiz: [
      {
        id: 'q1',
        text: 'Je hebt een emmer met restant velgenreiniger. Je wilt hem gebruiken voor ontvetter. Wat doe je?',
        options: [
          'Gewoon vullen, het restant is klein',
          'Eerst grondig omspoelen met water',
          'Er wat water bij doen zodat het verdunt',
          'De ontvetter erbij, dan neutraliseert het',
        ],
        correct: 1,
        explain: 'Zuur en base horen nooit bij elkaar, ook restanten niet.',
      },
      {
        id: 'q2',
        text: 'Hoe verdun je concentraat?',
        options: [
          'Water bij het middel gieten',
          'Het middel bij het water gieten',
          'Maakt niet uit',
          'Beide tegelijk in de mengunit',
        ],
        correct: 1,
        explain: 'Water bij zuur kan heftig spatten. Altijd middel bij water.',
      },
      {
        id: 'q3',
        text: 'Er spat ontvetter in je oog. Wat doe je?',
        options: [
          'Kort spoelen en doorwerken als het beter voelt',
          'Neutraliseren met een zuur middel',
          'Vijftien minuten spoelen bij de oogdouche en daarna naar een arts',
          'Wrijven en knipperen tot de irritatie weg is',
        ],
        correct: 2,
      },
      {
        id: 'q4',
        text: 'Welke rubrieken van het veiligheidsblad lees je vóór het eerste gebruik?',
        options: [
          'Rubriek 1 en 2',
          'Rubriek 4 en 8',
          'Alleen de samenstelling',
          'Geen, het etiket volstaat',
        ],
        correct: 1,
      },
      {
        id: 'q5',
        text: 'Er is vijf liter concentraat gemorst op de vloer. Wat doe je?',
        options: [
          'Wegspoelen met de hogedrukreiniger',
          'Laten indrogen',
          'Opnemen met absorptiemateriaal uit de calamiteitenset',
          'Verdunnen met veel water en naar het putje vegen',
        ],
        correct: 2,
        explain: 'Wegspoelen belast de waterzuivering en verspreidt het probleem.',
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'crs_installatie',
    code: 'INS-01',
    title: 'De wasinstallatie bedienen',
    summary:
      'Van voorbereiding tot afmelden: hoe je een vrachtwagen door de straat ' +
      'haalt zonder schade en zonder tijdverlies.',
    category: 'machine',
    estimatedMinutes: 20,
    requiredFor: ['employee', 'supervisor'],
    validMonths: 24,
    passScore: 75,
    version: 1,
    updatedAt: t,
    lessons: [
      {
        id: 'l1',
        title: 'Voorbereiden en aanrijden',
        body: [
          'Voordat een wagen de straat in rijdt, loop je hem rond. Je let op losse onderdelen, open luiken, uitstekende spiegels, zeilen die niet vastzitten en beschadigingen die er al waren. Die laatste noteer je bij de wasopdracht — dat voorkomt discussie achteraf.',
          'Spiegels inklappen, antennes neerleggen, ramen dicht. Bij een koelwagen controleer je of de koelunit uit staat als dat in de werkinstructie van die klant staat. Bij een tankwagen controleer je of alle domdeksels gesloten zijn.',
          'De chauffeur rijdt zelf aan tot de markering, tenzij anders afgesproken. Jij staat op een plek waar de chauffeur je in de spiegel kan zien. Sta nooit in de dode hoek achter of naast de wagen.',
        ],
        keyPoints: [
          'Rondlopen en bestaande schade vastleggen bij de opdracht.',
          'Spiegels in, antennes neer, ramen dicht, luiken gesloten.',
          'Blijf zichtbaar voor de chauffeur, nooit in de dode hoek.',
        ],
      },
      {
        id: 'l2',
        title: 'Het wasprogramma',
        body: [
          'Kies het programma dat bij de opdracht hoort. Een combiwas is niet hetzelfde als twee losse behandelingen: de volgorde en de doseringen verschillen, en de doorlooptijd is korter.',
          'De voorwas laat het grove vuil losweken. Sla die stap nooit over om tijd te winnen — droog vuil onder een draaiende borstel is de belangrijkste oorzaak van krassen in de lak.',
          'Let tijdens het programma op de borsteldruk. Te weinig druk betekent overwassen; te veel druk beschadigt zeilen en spoilers. Bij twijfel stop je en overleg je, in plaats van door te zetten en achteraf schade te melden.',
        ],
        keyPoints: [
          'Voorwas nooit overslaan: droog vuil veroorzaakt krassen.',
          'Combiwas is een eigen programma, geen twee losse behandelingen.',
          'Twijfel over borsteldruk? Stoppen en overleggen.',
        ],
      },
      {
        id: 'l3',
        title: 'Afronden en registreren',
        body: [
          'Na de droging loop je de wagen nog een keer rond. Je controleert of alles schoon is, met extra aandacht voor de plekken waar borstels moeilijk komen: achter de spiegels, de onderkant van de bumper en de ruimte tussen cabine en oplegger.',
          'Nawerk doe je met de hand en met de juiste doek. Gebruik voor de ruiten een aparte doek; een doek die eerder over de velgen ging, zet krassen in het glas.',
          'Meld de wasbeurt in de app af zodra hij klaar is, niet aan het eind van de dag. De klant ziet de status live, en de doorlooptijd die we meten klopt alleen als je op tijd afmeldt.',
        ],
        keyPoints: [
          'Extra controle achter spiegels, onder de bumper en tussen cabine en oplegger.',
          'Aparte doek voor ruiten.',
          'Direct afmelden, niet aan het eind van de dag.',
        ],
      },
    ],
    quiz: [
      {
        id: 'q1',
        text: 'Je ziet vóór het wassen een deuk in het zijpaneel. Wat doe je?',
        options: [
          'Niets, dat valt niet onder jouw werk',
          'Vastleggen bij de wasopdracht voordat de wagen naar binnen gaat',
          'Aan het eind melden als de klant er iets van zegt',
          'Foto maken en zelf bewaren',
        ],
        correct: 1,
      },
      {
        id: 'q2',
        text: 'Waarom mag je de voorwas niet overslaan?',
        options: [
          'Dat kost het bedrijf omzet',
          'Droog vuil onder een draaiende borstel veroorzaakt krassen',
          'De installatie start anders niet',
          'De klant ziet het in de app',
        ],
        correct: 1,
      },
      {
        id: 'q3',
        text: 'Waar sta je terwijl de chauffeur aanrijdt?',
        options: [
          'Vlak achter de wagen om te dirigeren',
          'Naast de achteras',
          'Op een plek waar de chauffeur je in de spiegel ziet',
          'In de bedieningspost, altijd',
        ],
        correct: 2,
      },
      {
        id: 'q4',
        text: 'Wanneer meld je een wasbeurt af in de app?',
        options: [
          'Aan het eind van de dienst',
          'Zodra de wagen klaar is',
          'Als de klant betaald heeft',
          'De volgende ochtend',
        ],
        correct: 1,
        explain: 'De klant volgt de status live en de doorlooptijd moet kloppen.',
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'crs_kwaliteit',
    code: 'KWA-01',
    title: 'Kwaliteit, water en milieu',
    summary:
      'Wat een goede wasbeurt is, hoe onze waterkringloop werkt en waarom ' +
      'dosering ook een milieukwestie is.',
    category: 'kwaliteit',
    estimatedMinutes: 15,
    requiredFor: ['employee', 'supervisor'],
    passScore: 75,
    version: 1,
    updatedAt: t,
    lessons: [
      {
        id: 'l1',
        title: 'Waterkringloop en waterontharding',
        body: [
          'Wij hergebruiken het grootste deel van ons waswater. Het vuile water gaat via een slibvang en een olie-waterafscheider terug naar het systeem. Alleen de laatste spoeling gebeurt met osmosewater, dat kalkvrij is en daardoor geen droogvlekken achterlaat.',
          'De onthardingsinstallatie werkt met zout. Loopt het zoutniveau leeg, dan wordt het water hard en zie je binnen een dag witte vlekken op donkere cabines. Controleer het zoutniveau bij je ochtendronde en boek bijvullingen in de app.',
          'Een olie-waterafscheider die vol zit, werkt niet meer. Meld het direct als je een olielaag in de slibvang ziet; dat is geen kleinigheid maar een vergunningsvoorwaarde.',
        ],
        keyPoints: [
          'Laatste spoeling met osmosewater voorkomt droogvlekken.',
          'Zout op peil houden, anders kalkvlekken.',
          'Olielaag in de slibvang: direct melden.',
        ],
      },
      {
        id: 'l2',
        title: 'Doseren is geld en milieu',
        body: [
          'Meer middel betekent niet schoner. Boven de aanbevolen dosering neemt het reinigend effect nauwelijks toe, terwijl het verbruik, de kosten en de belasting van de waterzuivering wel lineair oplopen.',
          'Onderdoseren is net zo duur: dan moet je overwassen of nawerken, wat meer tijd en meer water kost dan het middel dat je bespaarde.',
          'Elke afboeking die je in de app doet, komt terug in het verbruiksoverzicht van het management. Daarmee zien we of een installatie ontregeld is, lang voordat de kosten opvallen op de factuur.',
        ],
        keyPoints: [
          'Overdoseren maakt niet schoner, alleen duurder.',
          'Onderdoseren kost tijd en water.',
          'Verbruik nauwkeurig afboeken maakt afwijkingen zichtbaar.',
        ],
      },
    ],
    quiz: [
      {
        id: 'q1',
        text: 'Waarom gebruiken we osmosewater voor de laatste spoeling?',
        options: [
          'Het is goedkoper',
          'Het is kalkvrij en laat geen droogvlekken achter',
          'Het schuimt beter',
          'Het is warmer',
        ],
        correct: 1,
      },
      {
        id: 'q2',
        text: 'Je verdubbelt de dosering om een erg vuile wagen schoon te krijgen. Klopt dat?',
        options: [
          'Ja, meer middel is altijd beter',
          'Nee, boven de aanbevolen dosering neemt het effect nauwelijks toe',
          'Alleen bij tankwagens',
          'Alleen als de klant het vraagt',
        ],
        correct: 1,
      },
      {
        id: 'q3',
        text: 'Je ziet een olielaag drijven in de slibvang. Wat doe je?',
        options: [
          'Wegspuiten',
          'Noteren voor het jaaronderhoud',
          'Direct melden, het raakt onze vergunningsvoorwaarden',
          'Extra water erbij',
        ],
        correct: 2,
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'crs_klant',
    code: 'KLA-01',
    title: 'Klantcontact en schademelding',
    summary:
      'Hoe je met chauffeurs omgaat, wat je wel en niet toezegt, en wat je ' +
      'doet als er schade is.',
    category: 'klant',
    estimatedMinutes: 15,
    requiredFor: ['employee', 'supervisor', 'management'],
    passScore: 75,
    version: 1,
    updatedAt: t,
    lessons: [
      {
        id: 'l1',
        title: 'De chauffeur is je collega voor een half uur',
        body: [
          'Chauffeurs staan onder tijdsdruk. Wat voor jou een wachttijd van tien minuten is, kan voor hen het verschil zijn tussen wel of niet binnen hun rijtijden blijven. Een realistische inschatting geven is belangrijker dan een optimistische.',
          'Zeg nooit een tijd toe die je niet kunt waarmaken. Zeg liever: "ik verwacht drie kwartier, ik laat het weten als het langer duurt" en kom daar dan ook op terug.',
          'Bij een klacht over de kwaliteit ga je niet in discussie op de vloer. Je bekijkt het samen, en als er iets over is, was je het na. Kost dat meer dan een paar minuten, dan haal je je leidinggevende erbij.',
        ],
        keyPoints: [
          'Geef realistische tijden, geen optimistische.',
          'Kom terug op een toezegging als het uitloopt.',
          'Klacht: samen kijken, nawassen, bij twijfel de leidinggevende.',
        ],
      },
      {
        id: 'l2',
        title: 'Schade: melden, niet oplossen',
        body: [
          'Ontstaat er schade tijdens het wassen, dan meld je dat altijd zelf en direct — bij de chauffeur en bij je leidinggevende. Ook als je denkt dat het al bestond maar het niet zeker weet.',
          'Zelf een schadeafhandeling toezeggen doe je nooit. Je zegt wat er gebeurd is en dat het bedrijf contact opneemt. Toezeggingen over vergoeding of aansprakelijkheid zijn niet aan de vloer.',
          'Maak foto’s: overzicht, detail en het kenteken in beeld. Voeg ze toe aan de wasopdracht. Een melding zonder foto’s wordt achteraf bijna altijd een welles-nietes.',
        ],
        keyPoints: [
          'Schade altijd zelf en direct melden, ook bij twijfel.',
          'Nooit zelf iets toezeggen over vergoeding.',
          'Foto’s: overzicht, detail en kenteken.',
        ],
        warning:
          'Schade verzwijgen is een grond voor ontslag. Schade melden is dat nooit.',
      },
    ],
    quiz: [
      {
        id: 'q1',
        text: 'Een chauffeur vraagt hoe lang het duurt. Je weet het niet precies. Wat zeg je?',
        options: [
          '"Tien minuutjes", dan is hij tevreden',
          'Een realistische inschatting, met de toezegging dat je het laat weten als het uitloopt',
          '"Geen idee"',
          'Je verwijst hem naar de balie',
        ],
        correct: 1,
      },
      {
        id: 'q2',
        text: 'Je hoort tijdens het wassen een klap en ziet daarna een kras op de spoiler. Wat doe je?',
        options: [
          'Niets zeggen, misschien zat hij er al',
          'Melden bij de chauffeur en je leidinggevende, en foto’s toevoegen',
          'Zelf bijwerken met polish',
          'Alleen noteren als de chauffeur het opmerkt',
        ],
        correct: 1,
      },
      {
        id: 'q3',
        text: 'De chauffeur vraagt of jullie de schade vergoeden. Wat antwoord je?',
        options: [
          '"Ja, dat regelen we"',
          '"Nee, dat doen wij niet"',
          'Dat je meldt wat er gebeurd is en dat het bedrijf contact opneemt',
          'Dat hij het op zijn eigen verzekering moet zetten',
        ],
        correct: 2,
      },
    ],
  },
]
