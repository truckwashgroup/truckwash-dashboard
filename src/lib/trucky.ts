import { db, uid } from './db'
import { enqueue } from './sync'
import { supabase, supabaseUrl } from './api/supabaseApi'
import type { Instelling, TruckyContact, TruckyVraag, User } from './types'

/* ------------------------------------------------------------------ *
 *  Trucky, de kant van het dashboard
 *
 *  De chatbot zelf draait op de website en praat met een edge function. Dit
 *  bestand gaat over wat het kantoor ermee doet: de vragenlijst bijhouden en
 *  antwoorden op wat er binnenkomt.
 * ------------------------------------------------------------------ */

async function put<T extends { id: string; updatedAt?: number }>(
  entity: Parameters<typeof enqueue>[0],
  table: { put: (v: T) => Promise<unknown> },
  record: T,
) {
  const stamped = { ...record, updatedAt: Date.now() }
  await table.put(stamped)
  await enqueue(entity, 'put', record.id, stamped)
  return stamped
}

export const trucky = {
  /** Een vraag toevoegen of wijzigen. */
  async bewaar(vraag: TruckyVraag): Promise<TruckyVraag> {
    return put('truckyVragen', db.truckyVragen, {
      ...vraag,
      id: vraag.id || uid('tv'),
      vraag: vraag.vraag.trim(),
      antwoord: vraag.antwoord.trim(),
      pagina: vraag.pagina?.trim() || undefined,
      updatedAt: Date.now(),
    })
  },

  async weg(id: string) {
    await db.truckyVragen.delete(id)
    await enqueue('truckyVragen', 'delete', id, null)
  },

  /**
   * Antwoorden op een vraag van de website.
   *
   * Twee dingen, in deze volgorde: eerst het antwoord vastleggen, dan de mail.
   * Andersom zou een verstuurd antwoord dat niet is opgeslagen betekenen dat
   * een collega het nog eens beantwoordt -- en de bezoeker het twee keer
   * krijgt.
   *
   * Dit werkt dus alleen mét verbinding, anders dan de rest van de app. Dat is
   * hier juist: een antwoord dat pas morgen de deur uit gaat omdat iemand in
   * een kelder stond, is erger dan een melding dat het nu niet lukt.
   */
  async beantwoord(rij: TruckyContact, antwoord: string, door: Pick<User, 'id' | 'name'>) {
    const bij = await put('truckyContact', db.truckyContact, {
      ...rij,
      status: 'beantwoord',
      antwoord: antwoord.trim(),
      behandeldDoor: door.id,
      behandeldDoorNaam: door.name,
      behandeldAt: Date.now(),
      updatedAt: Date.now(),
    })

    /*
     * De mail gaat via de trucky-functie en niet via de gewone postbus van de
     * app. Die postbus mailt op gebruikers-id en zoekt het adres zelf op de
     * server op -- dat is haar slot, en precies daarom kan ze niet naar iemand
     * buiten het bedrijf. Deze ontvanger is een bezoeker van de website.
     *
     * De functie controleert zelf of jij dit mag: hij kijkt je inlog na en
     * eist management of het administratierecht. Hij staat open zonder inlog
     * voor bezoekers, dus dat moet hij zelf doen.
     */
    const { data: sessie } = await supabase().auth.getSession()
    const token = sessie.session?.access_token
    if (!token) throw new Error('Je sessie is verlopen. Log opnieuw in.')

    const res = await fetch(`${supabaseUrl()}/functions/v1/trucky`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        actie: 'antwoord',
        email: rij.email,
        naam: rij.naam,
        vraag: rij.vraag,
        antwoord: antwoord.trim(),
      }),
    })

    const uit = await res.json().catch(() => null) as { ok?: boolean; reden?: string } | null
    if (!uit?.ok) {
      /*
       * Het antwoord staat wel opgeslagen -- dat is hierboven al gebeurd, en
       * met opzet in die volgorde. Dus geen paniekverhaal, maar wel eerlijk
       * dat de mail niet weg is.
       */
      throw new Error(
        (uit?.reden ?? 'De mail ging niet uit.') +
        ' Het antwoord staat wel opgeslagen; je kunt het ook zelf mailen.',
      )
    }

    return bij
  },

  /** Oppakken zonder al te antwoorden, zodat collega's het niet dubbel doen. */
  async oppakken(rij: TruckyContact, door: Pick<User, 'id' | 'name'>) {
    if (rij.status !== 'nieuw') return rij
    return put('truckyContact', db.truckyContact, {
      ...rij,
      status: 'opgepakt',
      behandeldDoor: door.id,
      behandeldDoorNaam: door.name,
      updatedAt: Date.now(),
    })
  },

  /** Een instelling zetten. Maakt hem aan als hij nog niet bestaat. */
  async zetInstelling(sleutel: string, waarde: string): Promise<Instelling> {
    const bestaand = (await db.instellingen.toArray())
      .find((i) => i.sleutel === sleutel)

    const rij: Instelling = {
      ...(bestaand ?? {
        id: 'in_' + sleutel,
        sleutel,
        omschrijving: '',
      }),
      waarde: waarde.trim(),
      updatedAt: Date.now(),
    }

    const stamped = { ...rij, updatedAt: Date.now() }
    await db.instellingen.put(stamped)
    await enqueue('instellingen', 'put', rij.id, stamped)
    return stamped
  },
}
