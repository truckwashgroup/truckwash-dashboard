import { supabase, supabaseConfigured } from './api/supabaseApi'

/* ------------------------------------------------------------------ *
 *  E-mail via Resend
 *
 *  De sleutel van Resend zit niet in deze app en hoort daar ook niet. Wie
 *  hem heeft kan namens preview.truckwash.cloud versturen wat hij wil, en
 *  alles in een app op telefoons en laptops is uit te lezen. De sleutel
 *  staat dus in een serverfunctie bij Supabase.
 *
 *  Wat hier gebeurt is alleen: vragen of die functie iets wil versturen.
 *
 *  Twee dingen die met opzet zo zijn:
 *
 *   1. De app geeft nooit een e-mailadres mee, maar een id -- van een
 *      dossier, van een aanmelding, of een rol. De serverfunctie zoekt het
 *      adres er zelf bij. Daarmee kan niemand deze weg gebruiken om post
 *      naar een willekeurig adres te sturen.
 *
 *   2. De app geeft nooit HTML mee, alleen een sjabloonnaam en wat losse
 *      woorden. De opmaak staat op de server.
 *
 *  Mislukken mag. Een bericht in de app is de echte melding; de mail is de
 *  tik op de schouder voor wie de app niet openheeft. Gaat dat mis, dan
 *  komt het in het logboek en gaat de rest gewoon door.
 * ------------------------------------------------------------------ */

export type MailTemplate =
  /** Bevestiging aan de aanmelder plus een seintje aan het management */
  | 'aanmelding'
  | 'aanmelding-goedgekeurd'
  | 'aanmelding-afgewezen'
  /** Een melding uit de app, doorgestuurd naar het postvak */
  | 'bericht'

export interface MailRequest {
  template: MailTemplate
  /** Het dossier van de ontvanger */
  toUserId?: string
  /** Of: de aanmelding waar het over gaat; het adres komt uit die rij */
  signupId?: string
  /** Het e-mailadres dat zich zojuist aanmeldde (alleen bij 'aanmelding') */
  email?: string
  /** Losse woorden voor in het sjabloon; nooit opmaak */
  vars?: Record<string, string>
}

export interface MailResult {
  sent: number
  skipped?: string
}

const FUNCTION = 'stuur-mail'

/** Onthoudt of de functie er is, zodat we niet elke keer opnieuw proberen. */
let functionMissing = false

/**
 * Vraagt de serverfunctie om post te versturen.
 *
 * Geeft nooit een fout terug: de bel in de app is de echte melding.
 */
export async function sendMail(request: MailRequest): Promise<MailResult | null> {
  if (!supabaseConfigured || functionMissing) return null
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null

  try {
    const { data, error } = await supabase().functions.invoke<MailResult>(FUNCTION, {
      body: request,
    })

    if (error) {
      // Niet uitgerold? Dan houden we op met vragen tot de app herstart.
      const msg = String(error.message ?? error)
      if (/not found|404/i.test(msg)) {
        functionMissing = true
        console.warn(
          `[mail] De functie ${FUNCTION} staat nog niet bij Supabase. ` +
          'De app blijft werken; er gaat alleen geen post uit.',
        )
        return null
      }
      console.warn(`[mail] ${request.template} niet verstuurd: ${msg}`)
      return null
    }

    return data ?? null
  } catch (e) {
    console.warn(`[mail] ${request.template} niet verstuurd: ${
      e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/* ------------------------------------------------------------------ *
 *  De gevallen waarin er post uitgaat
 * ------------------------------------------------------------------ */

/**
 * Iemand heeft zich zojuist aangemeld.
 *
 * Dit is het enige verzoek dat zonder inlog mag -- de aanmelder heeft per
 * definitie nog geen toegang. De serverfunctie laat het alleen door als er
 * bij dit adres net werkelijk een aanmelding binnenkwam, en één keer.
 */
export async function mailAanmeldingOntvangen(email: string, naam: string) {
  return sendMail({ template: 'aanmelding', email, vars: { naam } })
}

/** Het management heeft een aanmelding toegelaten of afgewezen. */
export async function mailAanmeldingBesluit(
  signupId: string,
  goedgekeurd: boolean,
  vars: Record<string, string> = {},
) {
  return sendMail({
    template: goedgekeurd ? 'aanmelding-goedgekeurd' : 'aanmelding-afgewezen',
    signupId,
    vars,
  })
}

/** Een melding uit de app ook in het postvak laten belanden. */
export async function mailBericht(
  toUserId: string,
  vars: { titel: string; tekst: string; van?: string },
) {
  return sendMail({ template: 'bericht', toUserId, vars })
}
