import type { Permission, Role, User } from './types'

/* ------------------------------------------------------------------ *
 *  De rondleiding
 *
 *  Wie er voor het eerst inlogt krijgt een dashboard met tien tegels en geen
 *  idee waar te beginnen. En wie er een rol bij krijgt, krijgt er een half
 *  dashboard bij dat hij nooit heeft gezien -- dat is nog verwarrender, want
 *  de rest kende hij wel.
 *
 *  Vandaar per rol een eigen rondleiding, in twee delen:
 *
 *    het verhaal      wat dit dashboard is, wat je ermee doet, en wat er van
 *                     je verwacht wordt
 *    de aanwijzers    pijlen naar de echte knoppen in het echte scherm
 *
 *  Dat tweede deel is het deel dat blijft hangen. Een uitleg die je leest is
 *  iets anders dan een knop die je hebt zien oplichten op de plek waar hij
 *  morgen ook zit.
 *
 *  Het versienummer per rol is de knop om iedereen hem opnieuw te laten
 *  zien. Verandert er wezenlijk iets aan een dashboard, hoog hem dan op --
 *  dan krijgt iedereen met die rol de rondleiding nog een keer.
 * ------------------------------------------------------------------ */

export interface RondleidingScherm {
  id: string
  titel: string
  tekst: string
  /** Welke sfeer het plaatje krijgt */
  tint: 'brand' | 'ok' | 'info' | 'warn' | 'paars'
  /** Naam van het lucide-icoon, opgezocht in het scherm zelf */
  icoon: string
}

export interface RondleidingAanwijzer {
  id: string
  /** Waar de pijl naartoe wijst; een data-rondleiding-waarde in het scherm */
  doel: string
  titel: string
  tekst: string
  /** Niet tonen als iemand dit recht niet heeft */
  recht?: Permission
}

export interface Rondleiding {
  rol: Role
  versie: number
  /** Wat er in de kop staat terwijl je hem doorloopt */
  naam: string
  schermen: RondleidingScherm[]
  aanwijzers: RondleidingAanwijzer[]
}

/* ================================================================== *
 *  De inhoud
 * ================================================================== */

const WERKNEMER: Rondleiding = {
  rol: 'employee',
  versie: 1,
  naam: 'Je eigen dashboard',
  schermen: [
    {
      id: 'welkom',
      titel: 'Welkom bij Truckwash1',
      tekst:
        'Dit is de app waar je je werk in terugvindt: wanneer je staat ' +
        'ingeroosterd, welke wagens er vandaag komen, en wat er van je ' +
        'wordt verwacht. Even twee minuten, dan weet je waar alles zit.',
      tint: 'brand',
      icoon: 'Sparkles',
    },
    {
      id: 'vandaag',
      titel: 'Vandaag is waar je begint',
      tekst:
        'De wagens van vandaag staan op volgorde. Je pakt er een op, zet ' +
        'hem op bezig, en meldt hem gereed als je klaar bent. Dat laatste ' +
        'is belangrijker dan het lijkt: daar hangt de planning van de rest ' +
        'van de dag aan vast.',
      tint: 'info',
      icoon: 'Truck',
    },
    {
      id: 'rooster',
      titel: 'Je rooster staat vast in de app',
      tekst:
        'Wanneer je werkt zie je hier, en je krijgt bericht én een mail ' +
        'zodra er iets aan verandert. Klopt er iets niet, zeg het dan tegen ' +
        'je leidinggevende — die past het aan, en dan zie jij het meteen.',
      tint: 'ok',
      icoon: 'CalendarDays',
    },
    {
      id: 'klokken',
      titel: 'In- en uitklokken doe je aan de kassa',
      tekst:
        'Niet hier, maar op het apparaat op de vestiging: je toetst je code ' +
        'in of scant je badge. Wat er geregistreerd staat kun je hier wel ' +
        'terugkijken. Klopt er iets niet, meld het dan dezelfde week nog.',
      tint: 'warn',
      icoon: 'Timer',
    },
    {
      id: 'dossier',
      titel: 'Je dossier is van jou',
      tekst:
        'Je contract, je loonstroken en je certificaten staan onder Mijn ' +
        'dossier. Moet je iets ondertekenen, dan krijg je daar bericht van ' +
        'en teken je het gewoon op je scherm.',
      tint: 'paars',
      icoon: 'FolderLock',
    },
    {
      id: 'offline',
      titel: 'Geen bereik? Gewoon doorwerken',
      tekst:
        'De app werkt zonder internet. Alles wat je invult blijft staan en ' +
        'vertrekt vanzelf zodra er weer verbinding is. Je hoeft niets te ' +
        'onthouden en niets opnieuw te doen.',
      tint: 'ok',
      icoon: 'WifiOff',
    },
  ],
  aanwijzers: [
    {
      id: 'nav-vandaag',
      doel: 'nav-vandaag',
      titel: 'Hier staat je werk',
      tekst: 'De wagens van vandaag, op volgorde.',
    },
    {
      id: 'nav-rooster',
      doel: 'nav-rooster',
      titel: 'En hier je rooster',
      tekst: 'Wanneer je de komende weken staat ingepland.',
      recht: 'roster.viewOwn',
    },
    {
      id: 'nav-dossier',
      doel: 'nav-dossier',
      titel: 'Je eigen papieren',
      tekst: 'Contract, loonstroken en wat je moet ondertekenen.',
    },
    {
      id: 'zoeken',
      doel: 'zoeken',
      titel: 'Zoeken vindt alles',
      tekst:
        'Typ hier waar je naar zoekt — een kenteken, een collega, een ' +
        'scherm. Je krijgt alleen wat jij mag zien.',
    },
    {
      id: 'bel',
      doel: 'meldingen',
      titel: 'Je berichten',
      tekst: 'Roosterwijzigingen, iets om te tekenen, een vraag van kantoor.',
    },
    {
      id: 'melding',
      doel: 'dev-melding',
      titel: 'Werkt er iets niet?',
      tekst:
        'Zeg het hier. Er worden een paar vragen gesteld en dan gaat het ' +
        'naar de ontwikkelaar. Je krijgt bericht als er iets mee gebeurt.',
      recht: 'dev.report',
    },
  ],
}

const LEIDINGGEVENDE: Rondleiding = {
  rol: 'supervisor',
  versie: 1,
  naam: 'Leidinggevende',
  schermen: [
    {
      id: 'welkom',
      titel: 'Je bent nu leidinggevende',
      tekst:
        'Je houdt je eigen dashboard, maar er komt een laag bij: je ziet je ' +
        'team, je maakt het rooster, en je bent degene die het merkt als het ' +
        'volloopt.',
      tint: 'paars',
      icoon: 'Sparkles',
    },
    {
      id: 'team',
      titel: 'Het team vandaag',
      tekst:
        'Wie er staat, wie is ingeklokt, en wie er nog niet is. Vergeet ' +
        'iemand aan het eind van de dag uit te klokken, dan kun jij die ' +
        'registratie afsluiten — dat is het enige wat je aan iemands uren ' +
        'mag veranderen.',
      tint: 'info',
      icoon: 'Users',
    },
    {
      id: 'rooster',
      titel: 'Het rooster maak jij',
      tekst:
        'Slepen en klikken. Let op: iedereen die je inplant of verzet ' +
        'krijgt daar meteen bericht van, en een mail. Een dienst die ' +
        'verschuift zonder dat iemand het weet, is de ene helft van een ' +
        'misverstand waar de andere helft om vier uur voor de deur staat.',
      tint: 'brand',
      icoon: 'CalendarRange',
    },
    {
      id: 'slim',
      titel: 'Het slimme rooster denkt mee',
      tekst:
        'Op basis van de drukte van de afgelopen weken doet de app een ' +
        'voorstel voor de hele week. Je kijkt het na, past aan wat je wilt, ' +
        'en zet het door. Het blijft jouw rooster; de app doet alleen het ' +
        'saaie deel.',
      tint: 'ok',
      icoon: 'Sparkles',
    },
    {
      id: 'oproep',
      titel: 'Je kunt je team bereiken',
      tekst:
        'Loopt het vol, dan stuur je in één keer een bericht naar iedereen ' +
        'met een bepaalde rol. Dat kan alleen jij en het kantoor — juist ' +
        'omdat het iedereen tegelijk bereikt.',
      tint: 'warn',
      icoon: 'MessageSquare',
    },
  ],
  aanwijzers: [
    {
      id: 'nav-team',
      doel: 'nav-team',
      titel: 'Je team vandaag',
      tekst: 'Wie er staat, wie is ingeklokt, en wie er nog niet is.',
    },
    {
      id: 'nav-smart',
      doel: 'nav-smart',
      titel: 'Het slimme rooster',
      tekst: 'Een voorstel voor de hele week, dat jij nakijkt en aanpast.',
      recht: 'roster.edit',
    },
    {
      id: 'nav-rooster',
      doel: 'nav-rooster',
      titel: 'Hier maak je het rooster',
      tekst: 'Van je hele team, week voor week.',
    },
    {
      id: 'nav-opleiding',
      doel: 'nav-opleiding',
      titel: 'Wie is waarvoor opgeleid',
      tekst: 'Certificaten en cursussen die aflopen zie je hier aankomen.',
    },
  ],
}

const TECHNICUS: Rondleiding = {
  rol: 'technician',
  versie: 1,
  naam: 'Technische dienst',
  schermen: [
    {
      id: 'welkom',
      titel: 'De technische dienst',
      tekst:
        'Storingen, onderhoud en werkbonnen van alle negentien vestigingen ' +
        'op één plek. Je ziet wat er stuk is, wat er aankomt, en wat je zelf ' +
        'hebt opgepakt.',
      tint: 'warn',
      icoon: 'Wrench',
    },
    {
      id: 'storingen',
      titel: 'Storingen komen van de vloer',
      tekst:
        'Een wasser die iets ziet, meldt het met een foto erbij. Kritieke ' +
        'meldingen en alles wat een installatie stillegt komen ook per mail ' +
        'binnen — die hoef je dus niet in de app te zitten wachten.',
      tint: 'brand',
      icoon: 'AlertTriangle',
    },
    {
      id: 'qr',
      titel: 'Elke installatie heeft een QR-label',
      tekst:
        'Scan het label op de machine en je hebt meteen de geschiedenis, ' +
        'de handleiding en het onderhoudsschema. Melden doe je vanaf ' +
        'dezelfde plek, dus je hoeft niet te zoeken welke machine het ook ' +
        'alweer was.',
      tint: 'info',
      icoon: 'QrCode',
    },
    {
      id: 'onderhoud',
      titel: 'Onderhoud dat vanzelf komt',
      tekst:
        'Periodieke beurten staan in een schema en verschijnen op tijd in ' +
        'je lijst. Wat je afvinkt komt in de geschiedenis van die machine ' +
        'te staan — handig als er ooit iemand vraagt wanneer er voor het ' +
        'laatst naar is gekeken.',
      tint: 'ok',
      icoon: 'CalendarRange',
    },
  ],
  aanwijzers: [
    {
      id: 'nav-storingen',
      doel: 'nav-storingen',
      titel: 'Wat er gemeld is',
      tekst: 'Nieuw bovenaan, met de urgentie erbij.',
      recht: 'faults.view',
    },
    {
      id: 'nav-werkbonnen',
      doel: 'nav-werkbonnen',
      titel: 'Het werk zelf',
      tekst: 'Wat je hebt opgepakt en wat er nog ligt.',
      recht: 'workorders.view',
    },
    {
      id: 'nav-installaties',
      doel: 'nav-installaties',
      titel: 'Het machinepark',
      tekst: 'Met de QR-labels die je op de machines plakt.',
      recht: 'assets.view',
    },
  ],
}

const KLANT: Rondleiding = {
  rol: 'customer',
  versie: 1,
  naam: 'Klantportaal',
  schermen: [
    {
      id: 'welkom',
      titel: 'Welkom in het klantportaal',
      tekst:
        'Hier ziet u wat er met uw wagens gebeurt: wanneer ze zijn gewassen, ' +
        'wat er is gedaan en wat het heeft gekost. Alles op één plek, zonder ' +
        'te hoeven bellen.',
      tint: 'brand',
      icoon: 'Building2',
    },
    {
      id: 'beurten',
      titel: 'Uw wasbeurten',
      tekst:
        'Per kenteken en per datum, met de behandeling erbij. Wat er vandaag ' +
        'staat gepland ziet u ook, dus u weet wanneer een wagen weer ' +
        'beschikbaar is.',
      tint: 'info',
      icoon: 'Truck',
    },
    {
      id: 'vestigingen',
      titel: 'Negentien vestigingen',
      tekst:
        'Waar we zitten, wanneer we open zijn en wat er per locatie mogelijk ' +
        'is. Handig bij het plannen van een rit.',
      tint: 'ok',
      icoon: 'MapPin',
    },
    {
      id: 'contact',
      titel: 'Iets vragen kan hier ook',
      tekst:
        'Klopt er iets niet aan een beurt, of wilt u iets anders afspreken? ' +
        'Laat het weten via het portaal; het komt bij het kantoor terecht en ' +
        'u krijgt antwoord op hetzelfde adres.',
      tint: 'paars',
      icoon: 'MessageSquare',
    },
  ],
  aanwijzers: [
    {
      id: 'zoeken',
      doel: 'zoeken',
      titel: 'Zoeken op kenteken',
      tekst: 'Typ een kenteken en u ziet meteen de historie van die wagen.',
    },
  ],
}

const WERKGEVER: Rondleiding = {
  rol: 'employer',
  versie: 1,
  naam: 'Werkgeversportaal',
  schermen: [
    {
      id: 'welkom',
      titel: 'Uw bedrijf bij Truckwash1',
      tekst:
        'Uw chauffeurs wassen bij ons op rekening van uw bedrijf. Hier ziet ' +
        'u wie dat zijn, wat ze laten doen, en legt u vast wat er wel en ' +
        'niet mag.',
      tint: 'info',
      icoon: 'Briefcase',
    },
    {
      id: 'chauffeurs',
      titel: 'Chauffeurs nodigt u zelf uit',
      tekst:
        'U vult een naam en een mailadres in; die persoon krijgt inloggegevens ' +
        'en moet bij de eerste keer zijn eigen wachtwoord kiezen. Bestaat er ' +
        'al een account op dat adres, dan vragen we die persoon eerst om ' +
        'toestemming — wij koppelen niemand ongevraagd aan een bedrijf.',
      tint: 'brand',
      icoon: 'Users',
    },
    {
      id: 'afspraken',
      titel: 'Afspraken per wagen',
      tekst:
        'Een chauffeur die op kosten van de zaak een polijstbeurt afneemt ' +
        'terwijl er een buitenwas was afgesproken, is een gesprek achteraf. ' +
        'Legt u het hier vast, dan komt het aan de balie niet eens in beeld.',
      tint: 'warn',
      icoon: 'ClipboardList',
    },
    {
      id: 'grens',
      titel: 'Wat u niet ziet',
      tekst:
        'U ziet de wasbeurten die op uw naam staan en verder niets van ons ' +
        'bedrijf. Geen rooster, geen voorraad, geen personeelsgegevens. Dat ' +
        'is met opzet, en het geldt andersom net zo goed.',
      tint: 'ok',
      icoon: 'ShieldCheck',
    },
  ],
  aanwijzers: [
    {
      id: 'nav-chauffeurs',
      doel: 'nav-chauffeurs',
      titel: 'Uw chauffeurs',
      tekst: 'Uitnodigen, kentekens toewijzen, of iemand loskoppelen.',
      recht: 'employer.staff',
    },
    {
      id: 'nav-beurten',
      doel: 'nav-beurten',
      titel: 'De wasbeurten',
      tekst: 'Alles wat er op naam van uw bedrijf is gedaan.',
    },
    {
      id: 'nav-afspraken',
      doel: 'nav-afspraken',
      titel: 'Uw afspraken',
      tekst: 'Wat er per wagen wel en niet afgenomen mag worden.',
      recht: 'employer.rules',
    },
  ],
}

const MANAGEMENT: Rondleiding = {
  rol: 'management',
  versie: 1,
  naam: 'Management',
  schermen: [
    {
      id: 'welkom',
      titel: 'Je ziet nu alles',
      tekst:
        'Negentien vestigingen, het personeel, de cijfers en de post. Dat is ' +
        'veel, dus het dashboard begint met tegels: wat aandacht vraagt staat ' +
        'bovenaan, de rest wacht rustig af.',
      tint: 'brand',
      icoon: 'LayoutGrid',
    },
    {
      id: 'financieel',
      titel: 'Kosten en resultaat',
      tekst:
        'Bonnen komen binnen van de vloer én per mail. Een factuur die naar ' +
        'het postbusadres wordt gestuurd staat hier binnen een minuut klaar ' +
        'om te valideren, met de bijlage eraan. Het bedrag vullen we bewust ' +
        'niet zelf in — een gok in de boekhouding is erger dan een leeg veld.',
      tint: 'ok',
      icoon: 'Receipt',
    },
    {
      id: 'personeel',
      titel: 'Personeel en dossiers',
      tekst:
        'Contracten, certificaten, verzuim en rechten. Je kunt een dossier ' +
        'grotendeels laten invullen door het paspoort te scannen en het ' +
        'contract te uploaden. Wat de app eruit haalt stelt hij vóór; jij ' +
        'bevestigt het.',
      tint: 'paars',
      icoon: 'Users',
    },
    {
      id: 'rechten',
      titel: 'Rechten deel jij uit',
      tekst:
        'Rollen geven een basis, en daarbovenop zet je per persoon losse ' +
        'rechten aan of uit. Niemand kan zichzelf iets toekennen — ook jij ' +
        'niet bij jezelf als je de laatste rechtenbeheerder bent. Dat is de ' +
        'enige knop die de app tegenhoudt.',
      tint: 'warn',
      icoon: 'ShieldCheck',
    },
    {
      id: 'aanmeldingen',
      titel: 'Niemand komt er zomaar in',
      tekst:
        'Wie zich aanmeldt krijgt een account zonder rollen en zonder ' +
        'toegang. Pas als jij hem toelaat en een rol geeft, kan hij iets. ' +
        'Tot die tijd ziet hij een scherm dat zegt dat hij op beoordeling ' +
        'wacht.',
      tint: 'info',
      icoon: 'Inbox',
    },
    {
      id: 'plannen',
      titel: 'Meldingen worden plannen',
      tekst:
        'Meldt iemand iets, dan wordt er doorgevraagd en komt er een plan ' +
        'met stappen uit. Jij zet per stap een vinkje uit wat je niet wilt; ' +
        'wat aan blijft staan wordt gebouwd. De melder hoort ook wat er niet ' +
        'gebeurt en waarom.',
      tint: 'ok',
      icoon: 'ListChecks',
    },
  ],
  aanwijzers: [
    {
      id: 'nav-start',
      doel: 'nav-start',
      titel: 'De tegels',
      tekst: 'Wat aandacht vraagt staat bovenaan en licht op.',
    },
    {
      id: 'nav-financieel',
      doel: 'nav-financieel',
      titel: 'De cijfers',
      tekst: 'Kosten valideren, omzet en marge per vestiging.',
      recht: 'finance.view',
    },
    {
      id: 'nav-personeel',
      doel: 'nav-personeel',
      titel: 'Personeel',
      tekst: 'Dossiers, rechten en vestigingen.',
      recht: 'staff.view',
    },
    {
      id: 'nav-postbus',
      doel: 'nav-postbus',
      titel: 'De postbus',
      tekst: 'Wat er binnenkomt op het mailadres, met de bijlagen erbij.',
      recht: 'mail.read',
    },
    {
      id: 'locatie',
      doel: 'locatie',
      titel: 'Welke vestiging',
      tekst:
        'Alles wat je ziet gaat over de vestigingen die hier staan. Zet hem ' +
        'op alles voor het totaalbeeld.',
    },
    {
      id: 'zoeken',
      doel: 'zoeken',
      titel: 'Zoeken gaat door alles heen',
      tekst:
        'Klanten, bonnen, dossiers, post, kentekens, schermen. Je krijgt ' +
        'alleen wat je mag zien.',
    },
  ],
}

const ONTWIKKELAAR: Rondleiding = {
  rol: 'developer',
  versie: 1,
  naam: 'Ontwikkeling',
  schermen: [
    {
      id: 'welkom',
      titel: 'Het ontwikkelaarsdashboard',
      tekst:
        'Meldingen van gebruikers, het logboek, en wat er op dit moment in ' +
        'de app gebeurt. Bedoeld om te kunnen zien wat er misging zonder het ' +
        'aan iemand te hoeven vragen.',
      tint: 'paars',
      icoon: 'Bug',
    },
    {
      id: 'meldingen',
      titel: 'Een melding brengt zijn context mee',
      tekst:
        'Bij elke melding zit het apparaat, de versie, of er verbinding was, ' +
        'en wat de melder het afgelopen kwartier deed. Dat spoor bevat alleen ' +
        'handelingen, nooit wat er is getypt — en de melder ziet het vóór hij ' +
        'verstuurt.',
      tint: 'info',
      icoon: 'Inbox',
    },
    {
      id: 'plannen',
      titel: 'Van melding naar plan',
      tekst:
        'Er wordt doorgevraagd bij de melder, en daaruit komt een plan in ' +
        'stappen. Het management zet er vinkjes bij; wat overblijft is de ' +
        'opdracht, met één knop te kopiëren.',
      tint: 'ok',
      icoon: 'ListChecks',
    },
    {
      id: 'meekijken',
      titel: 'Meekijken en het logboek',
      tekst:
        'Alles wat er nu gebeurt, op volgorde. Dezelfde fout wordt opgeteld ' +
        'in plaats van herhaald, dus een lijst van tien regels betekent tien ' +
        'verschillende problemen.',
      tint: 'warn',
      icoon: 'Radio',
    },
  ],
  aanwijzers: [
    {
      id: 'nav-tickets',
      doel: 'nav-tickets',
      titel: 'De meldingen',
      tekst: 'Open bovenaan, met de urgentie die de melder koos.',
    },
    {
      id: 'nav-plannen',
      doel: 'nav-plannen',
      titel: 'De plannen',
      tekst: 'Wat er uit een melding kwam, en wat ervan is goedgekeurd.',
      recht: 'dev.plan',
    },
    {
      id: 'nav-logboek',
      doel: 'nav-logboek',
      titel: 'Het logboek',
      tekst: 'Fouten en waarschuwingen, opgeteld per soort.',
      recht: 'dev.logs',
    },
  ],
}

const ADMINISTRATIE: Rondleiding = {
  rol: 'administratie',
  versie: 1,
  naam: 'Administratie',
  schermen: [
    {
      id: 'welkom',
      titel: 'Alles wat op je wacht, op één plek',
      tekst:
        'Kostenposten, urenwijzigingen, aanpassingen in een dossier en ' +
        'aanmeldingen stonden vroeger in vier verschillende schermen. Wie ' +
        'vier lijsten moet openen om te weten of hij klaar is, denkt op een ' +
        'gegeven moment dat hij klaar is. Hier staan ze bij elkaar.',
      tint: 'brand',
      icoon: 'ClipboardCheck',
    },
    {
      id: 'lezen',
      titel: 'De factuur wordt voorgelezen',
      tekst:
        'Zit er een PDF of een foto bij een kostenpost, dan haalt de app er ' +
        'de leverancier, het factuurnummer, de regels en de bedragen uit. Je ' +
        'krijgt het als voorstel te zien, naast de factuur zelf.',
      tint: 'info',
      icoon: 'ScanText',
    },
    {
      id: 'voorstel',
      titel: 'Een voorstel is geen invoer',
      tekst:
        'Wat eruit komt gaat nergens heen tot jij op overnemen drukt. Het ' +
        'staat ook apart opgeslagen van wat je goedkeurt, zodat je later kunt ' +
        'zien wat de app voorstelde en wat een mens ervan maakte. Waar het ' +
        'model twijfelde, staat dat er met zoveel woorden bij.',
      tint: 'warn',
      icoon: 'AlertTriangle',
    },
    {
      id: 'grens',
      titel: 'Beoordelen is iets anders dan uitvoeren',
      tekst:
        'Je keurt uren goed, maar je maakt geen rooster. Je keurt bonnen ' +
        'goed, maar je boekt geen voorraad af. Dat is met opzet: wie ' +
        'uitvoert hoort niet ook zijn eigen werk af te tekenen.',
      tint: 'ok',
      icoon: 'ShieldCheck',
    },
  ],
  aanwijzers: [
    {
      id: 'nav-tedoen',
      doel: 'nav-tedoen',
      titel: 'Te doen',
      tekst: 'Alles wat op een beslissing wacht, nieuwste eerst.',
    },
    {
      id: 'nav-kosten',
      doel: 'nav-kosten',
      titel: 'Kostenposten',
      tekst: 'Goedkeuren, afkeuren, en de factuur laten uitlezen.',
      recht: 'expenses.approve',
    },
    {
      id: 'nav-uren',
      doel: 'nav-uren',
      titel: 'Urenwijzigingen',
      tekst: 'Wie niet op tijd geklokt heeft, vraagt hier een correctie aan.',
      recht: 'hours.approve',
    },
    {
      id: 'nav-dossiers',
      doel: 'nav-dossiers',
      titel: 'Dossierwijzigingen',
      tekst: 'Een gewijzigd rekeningnummer of adres wil je niet zomaar overnemen.',
      recht: 'staff.view',
    },
    {
      id: 'nav-aanmeldingen',
      doel: 'nav-aanmeldingen',
      titel: 'Aanmeldingen',
      tekst: 'Wie zich via de app heeft gemeld, en of die erin mag.',
      recht: 'signups.decide',
    },
  ],
}

const TRUCKSUPPLY: Rondleiding = {
  rol: 'trucksupply',
  versie: 1,
  naam: 'Trucksshop',
  schermen: [
    {
      id: 'welkom',
      titel: 'De voorraad van alle vestigingen',
      tekst:
        'Negentien vestigingen, elk met hun eigen standen en minima. Zakt er ' +
        'ergens iets onder het minimum, dan zet de database daar een alarm ' +
        'bij -- of de afboeking nu van de kassa, de wasser of een levering ' +
        'kwam. Jij ziet ze hier bij elkaar, per vestiging.',
      tint: 'brand',
      icoon: 'Warehouse',
    },
    {
      id: 'alarmen',
      titel: 'Alarmen komen ook per mail',
      tekst:
        'Elk nieuw alarm gaat binnen een kwartier naar het mailadres van ' +
        'Trucksshop, en elke ochtend komt er één overzicht van alles wat ' +
        'nog openstaat en dat niemand heeft gezien. Zet je een alarm op ' +
        'gezien, dan blijft het uit de ochtendmail.',
      tint: 'warn',
      icoon: 'BellRing',
    },
    {
      id: 'bestellen',
      titel: 'Van alarm naar bestelling naar pakbon',
      tekst:
        'Uit de open alarmen van een vestiging maak je met één knop een ' +
        'bestelling, met de standaard bestelhoeveelheid per artikel. Inpakken, ' +
        'verzenden, pakbon en verzendlabel afdrukken -- en op het moment dat ' +
        'hij op verzonden gaat, wordt de voorraad van de vestiging bijgeboekt.',
      tint: 'ok',
      icoon: 'PackageCheck',
    },
  ],
  aanwijzers: [
    {
      id: 'nav-voorraad',
      doel: 'nav-voorraad',
      titel: 'De voorraad',
      tekst: 'Alle vestigingen, met de alarmen bovenaan.',
      recht: 'supply.view',
    },
    {
      id: 'nav-bestellingen',
      doel: 'nav-bestellingen',
      titel: 'Bestellingen',
      tekst: 'Wat er klaarligt om in te pakken, en wat onderweg is.',
      recht: 'supply.orders',
    },
    {
      id: 'nav-artikelen',
      doel: 'nav-artikelen',
      titel: 'Artikelen',
      tekst: 'Prijs, foto en minimum, en met één knop in de kassa.',
      recht: 'supply.articles',
    },
  ],
}

export const RONDLEIDINGEN: Record<Role, Rondleiding> = {
  employee: WERKNEMER,
  supervisor: LEIDINGGEVENDE,
  technician: TECHNICUS,
  customer: KLANT,
  employer: WERKGEVER,
  trucksupply: TRUCKSUPPLY,
  management: MANAGEMENT,
  administratie: ADMINISTRATIE,
  developer: ONTWIKKELAAR,
}

/* ================================================================== *
 *  Wie heeft wat gezien
 * ================================================================== */

/** Het merkje dat in seenTours belandt: de rol met de versie erachter. */
export function merk(rol: Role): string {
  return `${rol}@${RONDLEIDINGEN[rol].versie}`
}

/** Moet deze persoon de rondleiding van deze rol nog zien? */
export function moetZien(user: User | null, rol: Role | null): boolean {
  if (!user || !rol) return false
  if (!RONDLEIDINGEN[rol]) return false
  return !(user.seenTours ?? []).includes(merk(rol))
}

/**
 * De rollen waarvan deze persoon de rondleiding kan terugkijken.
 *
 * Alleen de rollen die hij ook echt heeft -- een uitleg over een dashboard
 * waar je niet in komt is geen uitleg maar een folder.
 */
export function terugTeKijken(user: User | null): Rondleiding[] {
  if (!user) return []
  return user.roles.map((r) => RONDLEIDINGEN[r]).filter(Boolean)
}

/** seenTours met dit merkje erbij, zonder dubbelingen. */
export function metGezien(user: User, rol: Role): string[] {
  const bestaand = user.seenTours ?? []
  const nieuw = merk(rol)
  return bestaand.includes(nieuw) ? bestaand : [...bestaand, nieuw]
}

/** De aanwijzers die deze persoon werkelijk kan volgen. */
export function zichtbareAanwijzers(
  rondleiding: Rondleiding,
  mag: (recht: Permission) => boolean,
): RondleidingAanwijzer[] {
  return rondleiding.aanwijzers.filter((a) => !a.recht || mag(a.recht))
}
