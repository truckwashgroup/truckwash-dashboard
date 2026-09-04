#!/usr/bin/env node
/* ===========================================================================
 *  De lokale lezer
 *
 *  Facturen uitlezen kostte tot nu toe een rondje langs Claude, en dat is
 *  prima -- maar er staat hier een pc met een RTX 5090 die met gemma4:26b in
 *  Ollama dezelfde factuur in acht seconden foutloos las. Dit programma laat
 *  die pc het werk doen.
 *
 *  Wat het doet, en niet meer dan dat:
 *
 *    1. Elke LEZER_INTERVAL seconden vraagt het de functie lezer om werk.
 *       Die geeft het systeemprompt, het JSON-schema en hoogstens een paar
 *       kostenposten met een tijdelijke link naar hun bijlage.
 *    2. Per kostenpost: bijlage ophalen, tekstlaag uit de PDF halen of de
 *       eerste pagina's als plaatje maken, aan Ollama voorleggen.
 *    3. De ruwe JSON van het model teruggeven met 'klaar'. Twijfelt het model
 *       of klopt de optelling niet, dan 'terugval' (Claude doet het over) als
 *       dat mag, anders toch 'klaar' -- de server zet de twijfel er dan bij.
 *       Kon er niets gelezen worden, dan 'mislukt' met de reden; lag dat aan
 *       Ollama zelf (weg, te traag), dan met tijdelijk:true zodat de bon
 *       terug op wacht gaat en niet definitief mislukt.
 *
 *  Het denken erna -- opschonen, verkoopcontrole, indelen, wegschrijven --
 *  gebeurt op de server, in dezelfde code die ook na Claude draait. Daardoor
 *  is de uitkomst hetzelfde, wie er ook las. Dit programma kent geen
 *  servicesleutel en geen API-sleutel: alleen LEZER_SECRET, en het praat
 *  alleen met de functie lezer en met Ollama op localhost.
 *
 *  Gebruik:
 *    node lezer.mjs                  de lus
 *    node lezer.mjs --proef <pdf>    een lokaal bestand lezen, zonder server
 * =========================================================================== */

import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createCanvas } from '@napi-rs/canvas'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/* ------------------------------------------------------------------ *
 *  Instellingen
 *
 *  Uit de omgeving, of uit lezer/.env als die er is. Geen dotenv: het is
 *  vijf regels, en elke afhankelijkheid minder is er een die niet stuk kan.
 * ------------------------------------------------------------------ */

function laadEnv() {
  const bestand = path.join(HIER, '.env')
  if (!existsSync(bestand)) return
  for (const regel of readFileSync(bestand, 'utf8').split(/\r?\n/)) {
    const t = regel.trim()
    if (!t || t.startsWith('#')) continue
    const is = t.indexOf('=')
    if (is < 0) continue
    const sleutel = t.slice(0, is).trim()
    let waarde = t.slice(is + 1).trim()
    if ((waarde.startsWith('"') && waarde.endsWith('"')) || (waarde.startsWith("'") && waarde.endsWith("'"))) {
      waarde = waarde.slice(1, -1)
    }
    // Wat al in de omgeving staat wint; zo kun je iets tijdelijk overrulen.
    if (!(sleutel in process.env)) process.env[sleutel] = waarde
  }
}
laadEnv()

const INSTELLING = {
  url: (process.env.LEZER_URL ?? '').replace(/\/+$/, ''),
  geheim: process.env.LEZER_SECRET ?? '',
  /*
   * Twee modellen, want er zijn twee soorten werk.
   *
   * Een PDF uit een boekhoudpakket heeft een tekstlaag; die gaat als platte
   * tekst naar het model en daar is geen oog voor nodig. Een scan of een foto
   * moet gezien worden, en dat kan alleen een model dat plaatjes leest.
   *
   * Standaard staat er voor allebei hetzelfde: gemma4:26b. Dat is met opzet.
   * Op de kaart van Casper (RTX 5090) is gemeten wat een kleiner model doet
   * met dezelfde factuur en hetzelfde schema:
   *
   *   llama3.2 (3B)        2,9s   bedragen goed, maar zei "verkoop" in plaats
   *                               van "inkoop" en gaf de datums in het
   *                               verkeerde formaat -- onbruikbaar
   *   qwen2.5-coder:14b    6,8s   alles goed, maar verzon een twijfel over de
   *                               optelling die wél klopte
   *   gpt-oss:20b         17,4s   alles goed
   *   gemma4:26b           9,9s   alles goed (warm; de eerste keer 23,7s
   *                               omdat het model nog moest laden)
   *
   * Let op wat daar staat: op een PDF met tekstlaag scheelt het grote model
   * maar drie seconden met het kleine. De winst zit niet in de snelheid maar
   * in het geheugen -- twee modellen naast elkaar betekent dat een foto en
   * een tekstfactuur tegelijk gelezen kunnen worden.
   *
   * Sneller is dus te krijgen, maar niet gratis: hoe kleiner het model, hoe
   * eerder het de OORDELEN misser slaat -- inkoop of verkoop, en of er iets
   * te twijfelen valt. Juist die twee bepalen of een bon verdwijnt of vanzelf
   * wordt goedgekeurd. Daarom blijft de standaard het grote model en is dit
   * een knop voor wie wil proberen, niet een keuze die stil voor je gemaakt is.
   *
   * Wil je splitsen: zet LEZER_MODEL_TEKST op iets kleins en laat
   * LEZER_MODEL_BEELD staan. Beide modellen passen naast elkaar in 32 GB (een
   * 14B is ~9 GB, gemma4:26b ~18 GB), dus Ollama hoeft niet te wisselen.
   */
  model: process.env.LEZER_MODEL || 'gemma4:26b',
  modelTekst: process.env.LEZER_MODEL_TEKST || process.env.LEZER_MODEL || 'gemma4:26b',
  modelBeeld: process.env.LEZER_MODEL_BEELD || process.env.LEZER_MODEL || 'gemma4:26b',
  /*
   * Hoe lang hij wacht als er NIETS te doen was. Zodra er wel werk is wacht
   * hij helemaal niet meer -- zie de lus onderaan. Vroeger sliep hij ook na
   * een volle ronde dertig seconden, en dan deed hij bij een stapel van tien
   * facturen drie stuks per halve minuut terwijl de kaart stond te wachten.
   *
   * Tien seconden is licht: het is één klein verzoek dat meestal met een lege
   * lijst terugkomt. Lager mag, maar dan vraag je vooral vaker niets.
   */
  interval: Math.max(3, Number(process.env.LEZER_INTERVAL) || 10),
  ollama: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, ''),
  /*
   * Hoeveel bonnen hij per ronde opeist. Meer is niet sneller -- hij leest ze
   * één voor één, want twee keer een model van 26 miljard parameters naast
   * elkaar past niet in 32 GB videogeheugen en valt terug op het werkgeheugen,
   * wat álles traag maakt. Het getal bepaalt alleen hoe vaak hij tussendoor de
   * server hoeft te vragen.
   */
  max: Math.max(1, Number(process.env.LEZER_MAX) || 5),
}

/** Welk model bij welke invoer hoort. */
const modelVoor = (modus) => modus === 'tekst' ? INSTELLING.modelTekst : INSTELLING.modelBeeld

/** Tien minuten per stuk. Langer betekent dat er iets anders mis is. */
const OLLAMA_TIMEOUT = 10 * 60 * 1000
/** Onder dit aantal tekens is de tekstlaag geen tekstlaag maar wat losse letters. */
const MIN_TEKST = 200
/** Meer pagina's kost meer tijd en geeft zelden meer factuur. */
const MAX_PAGINAS = 3
/** Breedte van het plaatje dat het model krijgt. Scherp genoeg voor kleine lettertjes. */
const PLAATJE_BREEDTE = 1600
/** num_ctx is 16384 tokens; ruim onder blijven zodat prompt + antwoord ook passen. */
const MAX_TEKST = 30000

const PDF = 'application/pdf'
const PLAATJES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/* ------------------------------------------------------------------ *
 *  Hulpjes
 * ------------------------------------------------------------------ */

/**
 * Wachten, maar wakker te maken met het stopsignaal (Ctrl+C hoeft niet op de
 * volgende ronde te wachten). De luisteraar gaat er na afloop weer af: dit
 * draait elke ronde op hetzelfde signaal, en na tien rondes zonder opruimen
 * waarschuwt Node voor een lek -- terecht.
 */
const slaap = (ms, signaal) => new Promise((klaar) => {
  const wakker = () => { clearTimeout(t); klaar() }
  const t = setTimeout(() => { signaal?.removeEventListener('abort', wakker); klaar() }, ms)
  signaal?.addEventListener('abort', wakker, { once: true })
})

const tijd = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const log = (...delen) => console.log(tijd(), ...delen)
const kort = (id) => String(id ?? '').slice(0, 8)
const sec = (ms) => (ms / 1000).toFixed(1) + 's'

/**
 * De tekst van een fetch-fout. Node stopt de echte reden in e.cause, en bij
 * een geweigerde verbinding is dat een AggregateError met een lege message en
 * alleen een code (ECONNREFUSED) -- zonder dit stond er niets achter de
 * dubbele punt in het log.
 */
const foutTekst = (e) => String(e?.cause?.code || e?.cause?.message || e?.message || e)

/** Dezelfde keuze als in factuurlezer.ts: mime als die klopt, anders de extensie. */
function soortVan(naam, mime) {
  if (mime && (mime === PDF || PLAATJES.includes(mime))) return mime
  const ext = (String(naam).match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  if (ext === 'pdf') return PDF
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return null
}

/** Een 403 van de server: verkeerd geheim. Daar helpt opnieuw proberen niet bij. */
class StopFout extends Error {}

/**
 * Een fout die bij deze pc ligt en zo weer weg kan zijn: Ollama is niet
 * bereikbaar (herstart, update) of antwoordt niet op tijd. Zegt niets over de
 * bon. De server hoort dat als 'mislukt' met tijdelijk:true en zet de bon dan
 * terug op wacht in plaats van hem definitief te laten mislukken -- anders
 * was de hele wachtrij binnen een paar minuten leeg-gemislukt terwijl Ollama
 * even uit stond. Alleen de pc weet of een fout tijdelijk is; een fout die bij
 * een tweede poging even hard terugkomt (onleesbare JSON, kapot bestand) mag
 * dit niet zijn, anders draait het elke ronde opnieuw.
 */
class TijdelijkeFout extends Error {}

/** Dezelfde grens als leesFactuur (MAX_BESTAND in factuurlezer.ts): groter leest Claude ook niet. */
const MAX_BIJLAGE = 12 * 1024 * 1024

/* ------------------------------------------------------------------ *
 *  De server
 *
 *  Niet elke actie is even snel. 'werk' en 'mislukt' zijn een paar
 *  databasebewerkingen; 'klaar' draait op de server de hele verwerking
 *  (opschonen, verkoopcontrole, management melden) en 'terugval' laat Claude
 *  eerst de PDF nog eens lezen -- samen gerust anderhalve minuut. Met een
 *  time-out van een minuut voor alles brak de lezer die twee af terwijl de
 *  server ze gewoon afmaakte, en zette de bon dan onterecht op 'mislukt'.
 * ------------------------------------------------------------------ */

const SERVER_TIMEOUT = {
  werk: 60_000,
  mislukt: 60_000,
  klaar: 5 * 60 * 1000,
  terugval: 5 * 60 * 1000,
  /*
   * De lange lijn voor AI-opdrachten. De server houdt dit verzoek 25 seconden
   * open als er niets te doen is; hier moet dus meer dan 25 in staan, anders
   * breekt deze kant de lijn af terwijl de server nog netjes aan het wachten
   * is -- en dan zie je elke halve minuut een time-out die geen storing is.
   */
  'ai-werk': 40_000,
  'ai-klaar': 60_000,
}

async function server(actie, body = {}) {
  if (!INSTELLING.url || !INSTELLING.geheim) {
    throw new StopFout('LEZER_URL en LEZER_SECRET ontbreken. Kopieer .env.voorbeeld naar .env en vul ze in.')
  }
  let res
  try {
    res = await fetch(INSTELLING.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geheim: INSTELLING.geheim, actie, ...body }),
      signal: AbortSignal.timeout(SERVER_TIMEOUT[actie] ?? 60_000),
    })
  } catch (e) {
    if (e?.name === 'TimeoutError') {
      throw new Error(`de server antwoordde niet binnen ${Math.round((SERVER_TIMEOUT[actie] ?? 60_000) / 1000)} s op '${actie}'`)
    }
    throw new Error(`de server is niet bereikbaar voor '${actie}': ${foutTekst(e)}`)
  }
  if (res.status === 403) {
    throw new StopFout('De server weigert het geheim (403). Controleer LEZER_SECRET in .env; ' +
                       'het moet hetzelfde zijn als wat met "supabase secrets set LEZER_SECRET=..." is gezet.')
  }
  const tekst = await res.text()
  let uit = null
  try { uit = JSON.parse(tekst) } catch { /* hieronder */ }
  if (!res.ok || !uit || uit.ok === false) {
    throw new Error(`server gaf ${res.status} bij '${actie}': ${(uit?.reden ?? uit?.error ?? tekst).toString().slice(0, 300)}`)
  }
  return uit
}

/* ------------------------------------------------------------------ *
 *  PDF: tekstlaag of plaatjes
 *
 *  pdfjs draait hier zonder browser. Hij heeft dan een canvas nodig om op te
 *  tekenen (@napi-rs/canvas) en de mappen met standaardlettertypes, cmaps en
 *  wasm-decoders uit zijn eigen pakket, anders blijven lettertypes en
 *  sommige plaatjes leeg.
 * ------------------------------------------------------------------ */

const PDFJS_MAP = path.dirname(require.resolve('pdfjs-dist/package.json'))
const alsUrl = (sub) => new URL('file:///' + path.join(PDFJS_MAP, sub).replace(/\\/g, '/') + '/').href

class NapiCanvasFactory {
  constructor() {}
  create(breedte, hoogte) {
    if (breedte <= 0 || hoogte <= 0) throw new Error('Ongeldige canvasmaat')
    const canvas = createCanvas(Math.ceil(breedte), Math.ceil(hoogte))
    return { canvas, context: canvas.getContext('2d') }
  }
  reset(entry, breedte, hoogte) {
    if (!entry.canvas) throw new Error('Geen canvas')
    entry.canvas.width = Math.ceil(breedte)
    entry.canvas.height = Math.ceil(hoogte)
  }
  destroy(entry) {
    if (!entry.canvas) return
    entry.canvas.width = entry.canvas.height = 0
    entry.canvas = null
    entry.context = null
  }
}

/** Geeft de laadtaak terug: opruimen gaat via taak.destroy(), niet via het document. */
function openPdf(bytes) {
  return pdfjs.getDocument({
    data: new Uint8Array(bytes),
    CanvasFactory: NapiCanvasFactory,
    standardFontDataUrl: alsUrl('standard_fonts'),
    cMapUrl: alsUrl('cmaps'),
    wasmUrl: alsUrl('wasm'),
    iccUrl: alsUrl('iccs'),
    isEvalSupported: false,
    verbosity: 0,
  })
}

/** De tekstlaag van alle pagina's, regel voor regel zoals hij op het papier staat. */
async function tekstUit(doc) {
  const stukken = []
  let totaal = 0
  for (let p = 1; p <= doc.numPages && totaal < MAX_TEKST; p++) {
    const pagina = await doc.getPage(p)
    const inhoud = await pagina.getTextContent()
    let regel = ''
    const regels = []
    for (const item of inhoud.items) {
      if (!('str' in item)) continue
      regel += item.str
      if (item.hasEOL) { regels.push(regel); regel = '' }
      else if (item.str && !item.str.endsWith(' ')) regel += ' '
    }
    if (regel.trim()) regels.push(regel)
    const tekst = regels.map((r) => r.replace(/[ \t]+/g, ' ').trimEnd()).join('\n').trim()
    if (tekst) {
      stukken.push(doc.numPages > 1 ? `--- pagina ${p} ---\n${tekst}` : tekst)
      totaal += tekst.length
    }
    pagina.cleanup()
  }
  return stukken.join('\n\n').slice(0, MAX_TEKST)
}

/** De eerste pagina's als PNG (base64), ongeveer PLAATJE_BREEDTE breed. */
async function plaatjesUit(doc) {
  const uit = []
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGINAS); p++) {
    const pagina = await doc.getPage(p)
    const basis = pagina.getViewport({ scale: 1 })
    const viewport = pagina.getViewport({ scale: PLAATJE_BREEDTE / basis.width })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await pagina.render({ canvasContext: context, viewport }).promise
    uit.push(canvas.toBuffer('image/png').toString('base64'))
    pagina.cleanup()
  }
  return uit
}

/**
 * Van bytes naar wat het model krijgt: { modus: 'tekst', tekst } of
 * { modus: 'plaatje', images }. Een PDF met een echte tekstlaag gaat als
 * tekst (sneller en preciezer); een scan of een foto gaat als plaatje.
 *
 * alleenPlaatje slaat de tekstlaag over -- alleen voor --proef --plaatje, om
 * de scanroute te bekijken met een PDF die eigenlijk wel tekst heeft.
 */
async function maakInvoer(bytes, soort, alleenPlaatje = false) {
  if (soort !== PDF) {
    return { modus: 'plaatje', images: [Buffer.from(bytes).toString('base64')] }
  }
  const taak = openPdf(bytes)
  try {
    const doc = await taak.promise
    const tekst = alleenPlaatje ? '' : await tekstUit(doc)
    if (tekst.length >= MIN_TEKST) return { modus: 'tekst', tekst, paginas: doc.numPages }
    const images = await plaatjesUit(doc)
    return { modus: 'plaatje', images, paginas: doc.numPages }
  } finally {
    await taak.destroy().catch(() => {})
  }
}

/* ------------------------------------------------------------------ *
 *  Ollama
 * ------------------------------------------------------------------ */

/** Zoals leesJson in factuurlezer.ts: hekjes eraf, anders het eerste {...}. */
function leesJson(ruw) {
  const hek = '```'
  let schoon = String(ruw ?? '').trim()
  if (schoon.startsWith(hek)) schoon = schoon.slice(hek.length).replace(/^json/i, '').trim()
  if (schoon.endsWith(hek)) schoon = schoon.slice(0, -hek.length).trim()
  try { return JSON.parse(schoon) } catch { /* hieronder */ }
  const eerste = schoon.indexOf('{')
  const laatste = schoon.lastIndexOf('}')
  if (eerste < 0 || laatste <= eerste) return null
  try { return JSON.parse(schoon.slice(eerste, laatste + 1)) } catch { return null }
}

async function vraagOllama({ prompt, schema, invoer, model }) {
  const gebruiker = invoer.modus === 'tekst'
    ? { role: 'user', content: 'Dit is de tekst van de factuur. Geef de JSON terug.\n\n' + invoer.tekst }
    : { role: 'user', content: 'Lees dit stuk en geef de JSON terug.', images: invoer.images }

  const body = {
    model,
    messages: [{ role: 'system', content: prompt }, gebruiker],
    format: schema,
    stream: false,
    options: { temperature: 0, num_ctx: 16384 },
  }

  let laatsteRuw = ''
  // Een niet-parseerbaar antwoord komt zelden twee keer; een keer opnieuw is genoeg.
  for (let poging = 1; poging <= 2; poging++) {
    let res
    try {
      res = await fetch(INSTELLING.ollama + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT),
      })
    } catch (e) {
      // Hier weten we nog wie er niet antwoordde; verderop is een TimeoutError
      // van Ollama niet meer te onderscheiden van een van de server.
      if (e?.name === 'TimeoutError') throw new TijdelijkeFout('Ollama antwoordde niet binnen tien minuten')
      throw new TijdelijkeFout(`Ollama is niet bereikbaar op ${INSTELLING.ollama}: ${foutTekst(e)}`)
    }
    if (!res.ok) {
      throw new Error(`Ollama gaf ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const antwoord = await res.json()
    laatsteRuw = antwoord?.message?.content ?? ''
    const uit = leesJson(laatsteRuw)
    if (uit && typeof uit === 'object' && !Array.isArray(uit)) {
      return { uit, tokens: { in: antwoord.prompt_eval_count, uit: antwoord.eval_count } }
    }
  }
  throw new Error('Ollama gaf twee keer geen leesbare JSON terug: ' + laatsteRuw.slice(0, 200))
}

/* ------------------------------------------------------------------ *
 *  De lokale controle
 *
 *  Het model zegt zelf wanneer het twijfelt, en de optelling is een controle
 *  die het model niet doet. Valt een van beide om, dan is dit een stuk waar
 *  Claude beter naar kan kijken -- als dat mag. Anders gaat het toch naar de
 *  server, die de twijfel bij de bon zet zodat een mens het ziet.
 * ------------------------------------------------------------------ */

const getal = (w) => {
  const n = typeof w === 'string' ? Number(w.replace(',', '.')) : Number(w)
  return Number.isFinite(n) ? n : undefined
}

function controleer(uit) {
  const redenen = []
  if (!String(uit.leverancier ?? '').trim()) redenen.push('geen leverancier gelezen')
  const totaal = getal(uit.totaalIncl)
  if (totaal == null || totaal === 0) redenen.push('geen totaalbedrag gelezen')
  const sub = getal(uit.subtotaalExcl)
  const btw = getal(uit.btwBedrag)
  if (sub != null && btw != null && totaal != null && Math.abs(sub + btw - totaal) > 0.02) {
    redenen.push(`subtotaal ${sub.toFixed(2)} + btw ${btw.toFixed(2)} is niet ${totaal.toFixed(2)}`)
  }
  const twijfel = Array.isArray(uit.twijfel) ? uit.twijfel.filter((t) => String(t ?? '').trim()) : []
  if (twijfel.length) redenen.push('het model twijfelt: ' + twijfel.join(' | '))
  return redenen.length ? redenen.join('; ').slice(0, 500) : null
}

/* ------------------------------------------------------------------ *
 *  Eén kostenpost
 * ------------------------------------------------------------------ */

async function haalBijlage(bijlage) {
  let res
  try {
    res = await fetch(bijlage.url, { signal: AbortSignal.timeout(60_000) })
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error('bijlage ophalen duurde langer dan een minuut')
    throw new Error(`bijlage ophalen lukte niet: ${foutTekst(e)}`)
  }
  if (!res.ok) throw new Error(`bijlage ophalen gaf ${res.status}`)
  /*
   * Te groot is te groot, net als bij Claude: zonder grens laadt dit alles in
   * het geheugen, rendert het en stuurt bij een foto het hele plaatje naar
   * Ollama -- een trage of vastlopende ronde in plaats van een nette reden.
   * Eerst op de kopregel, zodat het bestand niet eens binnenkomt.
   */
  const mb = (n) => (n / 1024 / 1024).toFixed(1)
  const aangekondigd = Number(res.headers.get('content-length'))
  if (aangekondigd > MAX_BIJLAGE) {
    throw new Error(`bijlage is ${mb(aangekondigd)} MB en te groot om lokaal te lezen (grens ${mb(MAX_BIJLAGE)} MB)`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!bytes.length) throw new Error('bijlage is leeg')
  if (bytes.length > MAX_BIJLAGE) {
    throw new Error(`bijlage is ${mb(bytes.length)} MB en te groot om lokaal te lezen (grens ${mb(MAX_BIJLAGE)} MB)`)
  }
  return bytes
}

/**
 * Twee fasen, met een verschillende afhandeling als het misgaat.
 *
 * Fase 1, lezen (bijlage kiezen en ophalen, PDF openen, Ollama): gaat dat
 * mis, dan is er echt niets gelezen en hoort de server dat als 'mislukt',
 * zodat de reden in de app bij de bon komt.
 *
 * Fase 2, melden ('klaar' of 'terugval'): gaat DAT mis, dan weten we niet of
 * de server het bericht kreeg. Vaak wel: bij 'klaar' bewaart hij de lezing en
 * draait hij de verwerking, bij 'terugval' leest Claude de bon over -- en
 * pas daarna komt het antwoord. Een netwerkblip of time-out op dat antwoord
 * betekent dus niet dat het lezen mislukte. Zouden we dan alsnog 'mislukt'
 * sturen, dan overschrijft dat een afgemaakte bon met een twijfelregel en een
 * lezer-kolom die niet klopt. Daarom hier alleen loggen: is de bon op de
 * server toch op 'bezig' blijven staan, dan deelt hij hem na tien minuten
 * vanzelf opnieuw uit en gaat hij hier nog een keer door.
 */
async function verwerkStuk(stuk, werk) {
  const begin = Date.now()
  const id = kort(stuk.expenseId)
  let modus = '-'
  /*
   * Welk model het uiteindelijk werd. Begint op het beeldmodel: gaat het mis
   * vóór we weten wat voor bestand het is, dan is dat de eerlijkste gok voor
   * in de melding aan de server.
   */
  let gebruiktModel = INSTELLING.modelBeeld

  // --- Fase 1: lezen ---
  let bijlage, uit
  try {
    // Dezelfde keuze als leesFactuur: een PDF gaat voor een plaatje (het logo
    // uit de handtekening staat vaak voor de factuur).
    const kandidaten = (stuk.bijlagen ?? []).filter((b) => b?.url)
    bijlage = kandidaten.find((b) => soortVan(b.naam, b.mime) === PDF) ?? kandidaten[0]
    if (!bijlage) throw new Error('geen bijlage bij deze kostenpost')

    const soort = soortVan(bijlage.naam, bijlage.mime)
    if (!soort) throw new Error(`bestandstype van "${bijlage.naam}" kan niet gelezen worden; PDF en foto's wel`)

    const bytes = await haalBijlage(bijlage)
    const invoer = await maakInvoer(bytes, soort)
    modus = invoer.modus

    gebruiktModel = modelVoor(invoer.modus)
    ;({ uit } = await vraagOllama({
      prompt: werk.prompt, schema: werk.schema, invoer, model: gebruiktModel,
    }))
  } catch (e) {
    if (e instanceof StopFout) throw e
    const reden = String(e?.message ?? e).slice(0, 500)
    // Lag het aan deze pc (Ollama weg of te traag), dan gaat de bon terug op
    // wacht in plaats van definitief mislukt; zie TijdelijkeFout.
    const tijdelijk = e instanceof TijdelijkeFout
    klaarMet(false, 'factuur', reden)
    log(id, modus, sec(Date.now() - begin), (tijdelijk ? 'tijdelijk niet gelukt, bon gaat terug op wacht: ' : 'mislukt: ') + reden)
    try {
      await server('mislukt', {
        expenseId: stuk.expenseId,
        reden: 'Lokale lezer: ' + reden,
        model: gebruiktModel,
        ...(tijdelijk ? { tijdelijk: true } : {}),
      })
    } catch (e2) {
      if (e2 instanceof StopFout) throw e2
      log(id, 'kon "mislukt" niet melden: ' + String(e2?.message ?? e2))
    }
    return
  }

  // --- Fase 2: melden ---
  const reden = controleer(uit)
  const actie = reden && werk.terugvalToegestaan ? 'terugval' : 'klaar'
  try {
    if (actie === 'terugval') {
      // model gaat mee zodat de lezing de juiste lezer noemt, ook als het
      // model op de server intussen anders staat (lezer_model is van de laatste ronde).
      const r = await server('terugval', { expenseId: stuk.expenseId, reden, model: gebruiktModel })
      klaarMet(r.gedaan === 'claude', 'factuur', reden)
      log(id, modus, sec(Date.now() - begin), `terugval (${r.gedaan ?? '?'}): ${reden}`)
    } else {
      await server('klaar', {
        expenseId: stuk.expenseId, model: gebruiktModel, bestand: bijlage.naam, lezing: uit,
      })
      klaarMet(true, 'factuur')
      log(id, modus, sec(Date.now() - begin), reden ? `klaar, met twijfel: ${reden}` : 'klaar')
    }
  } catch (e) {
    if (e instanceof StopFout) throw e
    log(id, modus, sec(Date.now() - begin),
        `gelezen, maar '${actie}' kon niet gemeld worden: ${String(e?.message ?? e).slice(0, 300)}` +
        ' -- geen "mislukt" gestuurd; staat de bon nog op bezig, dan deelt de server hem na tien minuten opnieuw uit')
  }
}

/* ------------------------------------------------------------------ *
 *  De lus
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  De tweede lus: meedenken in plaats van lezen (0051)
 *
 *  Naast facturen kan deze machine ook het gesprek bij een melding en de
 *  chatbot op de website beantwoorden. Dat is ander werk: er zit iemand te
 *  wachten, dus het moet meteen.
 *
 *  Vandaar de lange lijn. Deze lus vraagt om werk en de server houdt dat
 *  verzoek open tot er iets is -- hoogstens vijfentwintig seconden. Komt er
 *  niets, dan begint hij gewoon opnieuw. Zo is de vertraging een fractie van
 *  een seconde en zijn het toch maar twee, drie verzoeken per minuut.
 *
 *  Waarom een aparte lus en niet in de bestaande: een factuur mag tien
 *  minuten duren, een antwoord aan een bezoeker niet. Zouden ze door elkaar
 *  lopen, dan staat een chauffeur te wachten omdat er net een scan van drie
 *  pagina's wordt gelezen. Nu lopen ze naast elkaar en pakt Ollama ze in de
 *  volgorde waarin ze binnenkomen.
 * ------------------------------------------------------------------ */

async function aiLus() {
  let stilGemeld = false

  while (!stoppen) {
    let opdracht = null
    try {
      const uit = await server('ai-werk', { stand: standNu() })
      opdracht = uit.opdracht ?? null
      if (stilGemeld) { log('ai: server weer bereikbaar'); stilGemeld = false }
    } catch (e) {
      if (e instanceof StopFout) throw e
      if (!stilGemeld) {
        log('ai: server niet bereikbaar,', foutTekst(e))
        stilGemeld = true
      }
      if (!stoppen) await slaap(10_000, stop.signal)
      continue
    }

    if (!opdracht) continue

    const begin = Date.now()
    const model = opdracht.model || INSTELLING.modelTekst
    begintMet(opdracht.soort === 'trucky' ? 'vraag van de website' : 'meedenken bij een melding')
    try {
      const antwoord = await vraagOllamaTekst({
        systeem: opdracht.systeem,
        gebruiker: opdracht.gebruiker,
        schema: opdracht.schema ?? undefined,
        model,
      })
      const uit = await server('ai-klaar', { id: opdracht.id, antwoord, model })
      klaarMet(true, 'ai')
      log('ai', opdracht.soort, sec(Date.now() - begin),
          uit.teLaat ? 'klaar, maar te laat -- de server wachtte niet meer' : 'klaar')
    } catch (e) {
      const reden = foutTekst(e).slice(0, 400)
      klaarMet(false, 'ai', reden)
      log('ai', opdracht.soort, sec(Date.now() - begin), 'mislukt: ' + reden)
      try {
        await server('ai-klaar', { id: opdracht.id, fout: reden, model })
      } catch { /* dan loopt de server zelf in zijn tijdslot */ }
    }
  }
}

/**
 * Ollama vragen om tekst in plaats van om een gelezen factuur.
 *
 * Zelfde model, andere vorm: hier komt er geen plaatje aan te pas en hoeft er
 * niet per se JSON uit. Alleen als de beller een schema meestuurt (dat doet
 * het gesprek bij een melding) wordt dat als "format" meegegeven; dan kán het
 * model niet anders antwoorden.
 */
async function vraagOllamaTekst({ systeem, gebruiker, schema, model }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systeem },
      { role: 'user', content: gebruiker },
    ],
    stream: false,
    options: { temperature: 0.2, num_ctx: 16384 },
  }
  if (schema) body.format = schema

  let res
  try {
    res = await fetch(INSTELLING.ollama + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT),
    })
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`Ollama antwoordde niet binnen ${OLLAMA_TIMEOUT / 60000} minuten`)
    throw new Error(`Ollama is niet bereikbaar op ${INSTELLING.ollama}: ${foutTekst(e)}`)
  }

  if (!res.ok) {
    throw new Error(`Ollama gaf ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const uit = await res.json()
  const tekst = String(uit?.message?.content ?? '').trim()
  if (!tekst) throw new Error('Ollama gaf een leeg antwoord')
  return tekst
}

/*
 * Het stopsignaal staat hier en niet in lus(), want er zijn er sinds 0051
 * twee: de facturenlus en de AI-lus. Ctrl+C hoort ze allebei te raken, en
 * een AbortController die in één functie leeft laat de andere doordraaien.
 */
const stop = new AbortController()
let stoppen = false

/* ------------------------------------------------------------------ *
 *  Wat we van onszelf vertellen
 *
 *  Aan een kostenpost zie je dat er iets wacht, niet of er iets gebeurt. Deze
 *  teller gaat bij elke ronde mee naar de server, die hem in
 *  instellingen.lezer_stand zet; het scherm Ontwikkeling > Eigen AI leest hem
 *  daar. Zo zie je of de machine leeft, waar hij nu mee bezig is en wat hij
 *  vandaag heeft gedaan.
 *
 *  Bewust klein en zonder geschiedenis: wat er precies gelezen is staat al bij
 *  de bon, met de lezer erbij. Hier gaat het om "leeft hij en doet hij iets".
 * ------------------------------------------------------------------ */

const STAND = {
  /** Waar hij nu mee bezig is, of null als hij wacht. */
  bezig: null,
  /** Sinds wanneer, epoch ms. */
  sinds: null,
  /** Welke dag de tellers hieronder over gaan (jjjj-mm-dd, lokale tijd). */
  dag: null,
  facturen: 0,
  aiVragen: 0,
  mislukt: 0,
  /** De laatste fout, kort. Blijft staan tot er een nieuwe komt. */
  laatsteFout: null,
  gestartOp: Date.now(),
}

/** Nieuwe dag = nieuwe tellers. Anders staat er in maart nog een jaartotaal. */
function nieuweDag() {
  const d = new Date()
  const vandaag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (STAND.dag !== vandaag) {
    STAND.dag = vandaag
    STAND.facturen = 0
    STAND.aiVragen = 0
    STAND.mislukt = 0
  }
}

/** Aan de server meegeven bij elke ronde. */
function standNu() {
  nieuweDag()
  return {
    bezig: STAND.bezig,
    sinds: STAND.sinds,
    dag: STAND.dag,
    facturen: STAND.facturen,
    aiVragen: STAND.aiVragen,
    mislukt: STAND.mislukt,
    laatsteFout: STAND.laatsteFout,
    gestartOp: STAND.gestartOp,
    modelTekst: INSTELLING.modelTekst,
    modelBeeld: INSTELLING.modelBeeld,
  }
}

function begintMet(wat) {
  STAND.bezig = wat
  STAND.sinds = Date.now()
}

function klaarMet(gelukt, soort, fout) {
  STAND.bezig = null
  STAND.sinds = null
  nieuweDag()
  if (gelukt) {
    if (soort === 'factuur') STAND.facturen++
    else STAND.aiVragen++
  } else {
    STAND.mislukt++
    if (fout) STAND.laatsteFout = String(fout).slice(0, 200)
  }
}

async function lus() {
  let bezig = false

  const afsluiten = () => {
    if (stoppen) { process.exit(130) }
    stoppen = true
    stop.abort()
    log(bezig ? 'Ctrl+C -- het lopende stuk wordt afgemaakt, daarna stop ik (nog eens Ctrl+C: meteen).'
              : 'Ctrl+C -- gestopt.')
    if (!bezig) process.exit(0)
  }
  process.on('SIGINT', afsluiten)
  process.on('SIGTERM', afsluiten)

  const modellen = INSTELLING.modelTekst === INSTELLING.modelBeeld
    ? `model ${INSTELLING.modelBeeld}`
    : `tekst ${INSTELLING.modelTekst}, beeld ${INSTELLING.modelBeeld}`
  log(`Lokale lezer gestart: ${modellen}, tot ${INSTELLING.max} bonnen per ronde, ` +
      `bij niets te doen ${INSTELLING.interval}s pauze; server ${INSTELLING.url || '(geen LEZER_URL)'}`)

  let serverfoutGemeld = false
  while (!stoppen) {
    /*
     * Hoe lang er ná deze ronde gewacht wordt.
     *
     *   0                 er was werk -- meteen door, de stapel is misschien
     *                     nog niet leeg en de kaart staat klaar
     *   interval          er was niets te doen
     *   interval x 4      de server antwoordde niet; dan is vaker vragen
     *                     zinloos en alleen maar ruis in het log
     */
    let wacht = INSTELLING.interval * 1000

    try {
      const werk = await server('werk', { model: INSTELLING.modelBeeld, max: INSTELLING.max, stand: standNu() })
      if (serverfoutGemeld) { log('server weer bereikbaar'); serverfoutGemeld = false }

      const stukken = werk.werk ?? []
      for (const stuk of stukken) {
        if (stoppen) break
        bezig = true
        begintMet(`factuur ${stuk.expenseId}`)
        try { await verwerkStuk(stuk, werk) } finally { bezig = false }
      }

      /*
       * Werk gehad? Dan meteen opnieuw vragen. Zo loopt een stapel in één keer
       * leeg in plaats van in porties van <max> per <interval> seconden.
       */
      if (stukken.length > 0) wacht = 0
    } catch (e) {
      if (e instanceof StopFout) {
        console.error(tijd(), 'GESTOPT:', e.message)
        process.exit(2)
      }
      // Netwerk weg, functie even niet uitgerold: één keer melden, stil doorgaan.
      wacht = INSTELLING.interval * 4000
      if (!serverfoutGemeld) {
        log('server niet bereikbaar, ik probeer het over', Math.round(wacht / 1000),
            's opnieuw:', String(e?.message ?? e))
        serverfoutGemeld = true
      }
    }
    if (!stoppen && wacht > 0) await slaap(wacht, stop.signal)
  }
  log('gestopt.')
  process.exit(0)
}

/* ------------------------------------------------------------------ *
 *  --proef: één lokaal bestand, zonder de server aan te raken
 *
 *  Prompt en schema komen van de server als LEZER_URL en LEZER_SECRET er
 *  zijn (werk met max 0 claimt niets); anders uit prompt.json, de kopie die
 *  alleen hiervoor bestaat.
 * ------------------------------------------------------------------ */

async function promptEnSchema() {
  if (INSTELLING.url && INSTELLING.geheim) {
    try {
      const w = await server('werk', { model: INSTELLING.modelBeeld, max: 0 })
      if (w.prompt && w.schema) return { prompt: w.prompt, schema: w.schema, bron: 'server' }
    } catch (e) {
      console.error('prompt niet van de server gekregen (' + String(e?.message ?? e) + '); ik gebruik prompt.json')
    }
  }
  const kopie = JSON.parse(await readFile(path.join(HIER, 'prompt.json'), 'utf8'))
  return { prompt: kopie.prompt, schema: kopie.schema, bron: 'prompt.json' }
}

async function proef(bestand, alleenPlaatje) {
  const pad = path.resolve(bestand)
  const soort = soortVan(pad, null)
  if (!soort) { console.error('Alleen PDF, jpg, png, webp of gif.'); process.exit(1) }

  const { prompt, schema, bron } = await promptEnSchema()
  const bytes = await readFile(pad)

  const t0 = Date.now()
  const invoer = await maakInvoer(bytes, soort, alleenPlaatje)
  const t1 = Date.now()
  console.error(`bestand: ${pad}`)
  const proefModel = modelVoor(invoer.modus)
  console.error(`prompt en schema uit ${bron}; model ${proefModel} via ${INSTELLING.ollama}`)
  console.error(`modus: ${invoer.modus}` +
    (invoer.modus === 'tekst' ? ` (${invoer.tekst.length} tekens tekstlaag)` : ` (${invoer.images.length} plaatje(s))`) +
    (invoer.paginas ? `, ${invoer.paginas} pagina('s)` : '') + `, voorbereid in ${sec(t1 - t0)}`)

  const { uit, tokens } = await vraagOllama({ prompt, schema, invoer, model: proefModel })
  const t2 = Date.now()
  console.log(JSON.stringify(uit, null, 2))
  const reden = controleer(uit)
  console.error(`Ollama: ${sec(t2 - t1)} (${tokens.in ?? '?'} tokens in, ${tokens.uit ?? '?'} uit); totaal ${sec(t2 - t0)}`)
  console.error(reden ? `lokale controle: NIET in orde -- ${reden}` : 'lokale controle: in orde')
}

/* ------------------------------------------------------------------ *
 *  Start
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2)
const proefIndex = argv.indexOf('--proef')
if (proefIndex >= 0) {
  const bestand = argv.slice(proefIndex + 1).find((a) => !a.startsWith('--'))
  if (!bestand) { console.error('Gebruik: node lezer.mjs --proef <bestand.pdf|png|jpg> [--plaatje]'); process.exit(1) }
  proef(bestand, argv.includes('--plaatje')).catch((e) => { console.error('mislukt:', e?.message ?? e); process.exit(1) })
} else {
  /*
   * Twee lussen naast elkaar: facturen en AI-opdrachten. Valt er één om, dan
   * stopt het programma -- de geplande taak start het binnen een minuut
   * opnieuw, en dat is beter dan half doordraaien terwijl de helft stilstaat.
   */
  Promise.all([
    lus(),
    aiLus(),
  ]).catch((e) => { console.error('onverwacht gestopt:', e); process.exit(1) })
}
