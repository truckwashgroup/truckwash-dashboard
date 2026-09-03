/* ------------------------------------------------------------------ *
 *  De boeking van een kostenpost
 *
 *  Twee dingen die uit elkaar gehouden moeten worden:
 *
 *    de indeling   welke grootboekrekening en welke tags
 *    het geheugen  hoe deze leverancier voortaan geboekt moet worden
 *
 *  Het tweede is waar het om draait. Raden op trefwoorden werkt precies één
 *  keer; daarna weet je iets veel beters, namelijk hoe iemand die ernaar keek
 *  het de vorige keer boekte. Elke goedkeuring is zo'n moment, en die gaat
 *  hier het geheugen in.
 *
 *  Waarom pas bij goedkeuren en niet meteen bij het indelen: wat de post
 *  automatisch invult is een gok tot een mens ernaar heeft gekeken. Zou een
 *  gok het geheugen in gaan, dan bevestigt het systeem voortaan zijn eigen
 *  vergissingen -- en dan is het geen geheugen meer maar een echo.
 * ------------------------------------------------------------------ */

import { db } from './db'
import { enqueue } from './sync'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type { Expense, Grootboek } from './types'

/** Waar de indeling vandaan komt, in gewone taal. */
export const BRON_TEKST: Record<NonNullable<Expense['indelingBron']>, string> = {
  geheugen: 'Zo is deze leverancier eerder geboekt',
  geraden: 'Geraden op trefwoorden — kijk dit na',
  handmatig: 'Met de hand ingesteld',
}

/**
 * Handmatig een rekening en tags zetten.
 *
 * Zet de bron op handmatig, en dat is niet cosmetisch: bij het goedkeuren
 * leert het geheugen hiervan, en het scherm laat de waarschuwing "geraden"
 * vallen zodra er iemand naar gekeken heeft.
 */
export async function zetBoeking(
  bon: Expense,
  wijziging: { grootboekCode?: string; tags?: string[] },
): Promise<Expense> {
  const nieuw: Expense = {
    ...bon,
    grootboekCode: wijziging.grootboekCode ?? bon.grootboekCode,
    tags: wijziging.tags ?? bon.tags ?? [],
    indelingBron: 'handmatig',
    updatedAt: Date.now(),
  }
  await db.expenses.put(nieuw)
  await enqueue('expenses', 'put', nieuw.id, nieuw)
  return nieuw
}

/**
 * Onthouden hoe deze leverancier geboekt is.
 *
 * Gaat rechtstreeks naar de database en niet via de wachtrij, want dit is
 * geen rij die van ons is -- het is een teller die opgehoogd wordt, en twee
 * apparaten die hem allebei bijwerken moeten optellen en niet overschrijven.
 * Dat kan alleen aan de serverkant.
 *
 * Lukt het niet, dan is dat geen fout die het goedkeuren mag tegenhouden. De
 * kostenpost is goedgekeurd; het geheugen leert dan de volgende keer bij.
 */
export async function onthoudBoeking(bon: Expense): Promise<void> {
  if (!bon.supplier?.trim() || !bon.grootboekCode) return
  if (!supabaseConfigured) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  try {
    const { error } = await supabase().rpc('boeking_onthouden', {
      leverancier_in: bon.supplier.trim(),
      grootboek_in: bon.grootboekCode,
      tags_in: bon.tags ?? [],
    })
    if (error) console.warn('[boeking] onthouden mislukte: ' + error.message)
  } catch (e) {
    console.warn('[boeking] onthouden mislukte: ' + String(e))
  }
}

/**
 * De naam bij een rekeningnummer.
 *
 * "4031" zegt niemand iets; "Contributies en heffingen" wel. Staat de
 * rekening niet in de lijst, dan de code zelf -- dat gebeurt bij een oude
 * boeking op een rekening die later is weggehaald, en dan is het nummer
 * tonen beter dan een leeg vakje.
 */
export function rekeningNaam(code: string | undefined, lijst: Grootboek[]): string {
  if (!code) return ''
  const gevonden = lijst.find((g) => g.code === code)
  return gevonden ? `${gevonden.code} · ${gevonden.naam}` : code
}

/**
 * Is er reden om hier nog eens naar te kijken?
 *
 * Alleen bij een gok. Wat uit het geheugen komt of met de hand is gezet heeft
 * al iemands oordeel gehad, en een waarschuwing die overal staat leest
 * niemand meer.
 */
export function vraagtAandacht(bon: Expense): boolean {
  return bon.indelingBron === 'geraden' || (!bon.grootboekCode && bon.source === 'mail')
}
