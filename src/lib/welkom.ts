import { getMeta, setMeta } from './db'
import { users as userRepo } from './repo'
import type { User } from './types'

/* ------------------------------------------------------------------ *
 *  Wie krijgt het welkom te zien
 *
 *  Niet iedereen die het nog nooit heeft gezien -- dan zou de halve
 *  organisatie er morgen doorheen moeten. Alleen wie er echt net is: hij is
 *  uitgenodigd, kwam binnen met een tijdelijk wachtwoord uit de mail en
 *  heeft zojuist zijn eigen wachtwoord gekozen.
 *
 *  Dat moment is het enige harde signaal dat we hebben, dus wordt het daar
 *  vastgelegd. In de lokale opslag en niet in het geheugen van het scherm:
 *  ververst iemand halverwege, dan hoort het welkom er daarna nog te zijn.
 *
 *  Het merkje gaat daarna wél naar de server, in dezelfde lijst als de
 *  rondleidingen. Dan krijgt hij het op zijn telefoon niet nog een keer.
 * ------------------------------------------------------------------ */

export const WELKOM_MERK = 'welkom@1'
export const WELKOM_KLAAR = 'welkom-voor'

/** Staat het welkom klaar voor deze persoon? */
export async function welkomTeGaan(user: User | null): Promise<boolean> {
  if (!user) return false
  if ((user.seenTours ?? []).includes(WELKOM_MERK)) return false
  return (await getMeta<string | null>(WELKOM_KLAAR, null)) === user.id
}

/**
 * Afstrepen.
 *
 * Eerst lokaal, dan pas naar de server. Andersom zou een haperende
 * verbinding betekenen dat je het welkom bij elke start opnieuw krijgt --
 * en een welkom dat blijft terugkomen is geen welkom.
 */
export async function welkomAfstrepen(user: User | null) {
  await setMeta(WELKOM_KLAAR, null)
  if (!user) return

  const bestaand = user.seenTours ?? []
  if (bestaand.includes(WELKOM_MERK)) return

  try {
    await userRepo.update(user.id, { seenTours: [...bestaand, WELKOM_MERK] })
  } catch {
    /* Lukt het niet, dan ziet hij het op een ander apparaat nog een keer.
       Vervelend, maar niet iets om het opstarten voor te laten struikelen. */
  }
}

/** Voor het testen: staat er iets klaar, en voor wie. */
export function welkomStaatKlaarVoor() {
  return getMeta<string | null>(WELKOM_KLAAR, null)
}
