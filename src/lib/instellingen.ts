/* ------------------------------------------------------------------ *
 *  Instellingen
 *
 *  Kleine losse waarden die het management of de ontwikkelaar zet en die de
 *  server ook moet kunnen lezen: naar welk adres een contactverzoek gaat, op
 *  welk domein facturen binnenkomen, of het automatisch boeken aanstaat.
 *
 *  Dit stond eerst in trucky.ts, want daar kwam de eerste instelling vandaan.
 *  Inmiddels zet de ontwikkelaar er het inkoopdomein mee, en dan is "even in
 *  het chatbotbestand kijken" niet meer uit te leggen.
 *
 *  Waarom de database en niet een .env
 *  -----------------------------------
 *
 *  Een waarde in de omgeving van de app is alleen daar bekend. Deze waarden
 *  moeten door de Edge Functions gelezen worden -- ontvang-mail kijkt bij elke
 *  binnenkomende factuur welk domein er staat -- en tegelijk in de app te
 *  wijzigen zijn zonder uitrol. Dat is precies wat een tabel doet.
 * ------------------------------------------------------------------ */

import { db } from './db'
import { enqueue } from './sync'
import type { Instelling } from './types'

/** De sleutels die dit systeem kent, zodat een typefout niet stilletjes werkt. */
export const SLEUTELS = {
  truckyContactAdres: 'trucky_contact_adres',
  inkoopDomein: 'inkoop_domein',
  inkoopVoorvoegsel: 'inkoop_voorvoegsel',
  factuurAutomatisch: 'factuur_automatisch',
  /*
   * De eigen nummers van Truckwash. De post haalt een kostenpost alleen weg
   * als het model "verkoop" zegt EN een van deze nummers op het stuk staat
   * (0047); staan ze leeg, dan wordt er nooit iets weggehaald.
   */
  eigenKvk: 'eigen_kvk',
  eigenBtw: 'eigen_btw',
  eigenIban: 'eigen_iban',
  /*
   * Wie de facturen leest (0049). 'claude' is Claude in de cloud, 'lokaal' is
   * Ollama op de eigen server via het programma in lezer/, en
   * 'lokaal-terugval' is lokaal met Claude als vangnet wanneer het lokale
   * model twijfelt of uitvalt. De post leest dit bij elke binnenkomende
   * factuur; daarom een instelling en niet een .env.
   *
   * De andere twee zet het lokale programma zelf bij elke ronde, zodat het
   * Inkoop-scherm kan laten zien of het nog draait en met welk model.
   */
  factuurLezer: 'factuur_lezer',
  lezerLaatstGezien: 'lezer_laatst_gezien',
  lezerModel: 'lezer_model',
  /*
   * Waar het denkwerk gebeurt bij de andere twee plekken waar een model
   * meedenkt (0051): het gesprek bij een melding, en Trucky op de website.
   * Zelfde drie standen als bij de facturen. Het model draait op één machine
   * -- nu de pc op kantoor, straks de server -- en nooit bij de bezoeker.
   */
  aiMelding: 'ai_melding',
  aiTrucky: 'ai_trucky',
  aiLokaalModel: 'ai_lokaal_model',
  aiWachttijd: 'ai_wachttijd',
  /*
   * Zichzelf goedkeuren (0050). Staat standaard uit: dit is de enige plek
   * waar geld wordt goedgekeurd zonder dat er iemand kijkt. De vier sloten
   * (alleen wat een mens goedkeurde telt mee, een marge op het bedrag, een
   * plafond en geen dubbele factuurnummers) zitten in de database, niet hier
   * -- de post vraagt het daar en doet wat er terugkomt.
   */
  autoGoedkeuren: 'auto_goedkeuren',
  autoGoedkeurenVanaf: 'auto_goedkeuren_vanaf',
  autoGoedkeurenMarge: 'auto_goedkeuren_marge',
  autoGoedkeurenMax: 'auto_goedkeuren_max',
  /*
   * Trucksupply. Het adres waar de voorraadalarmen heen gaan, het uur waarop
   * de ochtendmail vertrekt (Europe/Amsterdam) en de divisie in Exact. De
   * serverfunctie leest ze bij elke ronde; daarom staan ze hier en niet in
   * een .env van de app.
   */
  trucksupplyMail: 'trucksupply_mail',
  trucksupplyOchtendUur: 'trucksupply_ochtend_uur',
  exactDivision: 'exact_division',
} as const

export type Sleutel = (typeof SLEUTELS)[keyof typeof SLEUTELS]

/** Wat er staat, of de terugval als er niets staat. */
export async function leesInstelling(sleutel: string, terugval = ''): Promise<string> {
  const rij = (await db.instellingen.toArray()).find((i) => i.sleutel === sleutel)
  const waarde = (rij?.waarde ?? '').trim()
  return waarde || terugval
}

/** Alles in één keer, voor een scherm dat er meer dan één laat zien. */
export async function leesInstellingen(): Promise<Record<string, string>> {
  const rijen = await db.instellingen.toArray()
  return Object.fromEntries(rijen.map((i) => [i.sleutel, (i.waarde ?? '').trim()]))
}

/**
 * Een instelling zetten. Maakt hem aan als hij nog niet bestaat.
 *
 * De id wordt afgeleid van de sleutel en niet willekeurig gekozen. Zo maakt
 * dezelfde sleutel vanaf twee apparaten dezelfde rij, en krijg je geen twee
 * regels die om beurten winnen.
 */
export async function zetInstelling(sleutel: string, waarde: string): Promise<Instelling> {
  const bestaand = (await db.instellingen.toArray()).find((i) => i.sleutel === sleutel)

  const rij: Instelling = {
    ...(bestaand ?? { id: 'in_' + sleutel, sleutel, omschrijving: '' }),
    waarde: waarde.trim(),
    updatedAt: Date.now(),
  }

  await db.instellingen.put(rij)
  await enqueue('instellingen', 'put', rij.id, rij)
  return rij
}

/* ------------------------------------------------------------------ *
 *  De inkoopadressen
 * ------------------------------------------------------------------ */

/**
 * Het adres waar facturen voor een vestiging binnenkomen.
 *
 * Zonder slug het algemene adres -- dat is waar post terechtkomt die niet aan
 * een vestiging hangt, en dat is een geldige uitkomst en geen fout.
 */
export function inkoopAdres(domein: string, voorvoegsel: string, slug?: string): string {
  const d = (domein || '').trim().toLowerCase()
  const v = (voorvoegsel || 'inkoop').trim().toLowerCase()
  if (!d) return ''
  return slug ? `${v}.${slug.trim().toLowerCase()}@${d}` : `${v}@${d}`
}

/**
 * Deugt dit als domein?
 *
 * Niet streng volgens de letter van de standaard, wel streng genoeg om de
 * fouten te vangen die je hier maakt: een heel mailadres plakken, of https
 * ervoor laten staan.
 */
export function domeinProbleem(domein: string): string | null {
  const d = (domein || '').trim()
  if (!d) return 'Zonder domein komt er geen factuur binnen.'
  if (d.includes('@')) return 'Alleen het domein, dus zonder het stuk voor de @.'
  if (/^https?:/i.test(d)) return 'Alleen het domein, zonder https:// ervoor.'
  if (d.includes('/')) return 'Alleen het domein, zonder pad erachter.'
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return 'Dit ziet er niet uit als een domein.'
  return null
}

/** Deugt dit als voorvoegsel? Het staat straks links van de punt in een adres. */
export function voorvoegselProbleem(voorvoegsel: string): string | null {
  const v = (voorvoegsel || '').trim()
  if (!v) return 'Zonder voorvoegsel is elk adres een inkoopadres.'
  if (!/^[a-z0-9-]+$/.test(v)) {
    return 'Alleen kleine letters, cijfers en streepjes -- dit wordt een mailadres.'
  }
  return null
}
