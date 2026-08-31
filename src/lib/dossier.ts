import { db, uid } from './db'
import { enqueue } from './sync'
import { notifications } from './repo'
import { bestandsVingerafdruk } from './identiteit'
import { deviceInfo } from './trail'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type {
  DocumentKind, PersonnelDocument, PersonnelPrivate, User,
} from './types'
import { DOCUMENT_KINDS } from './types'

/* ------------------------------------------------------------------ *
 *  Het personeelsdossier
 *
 *  Twee dingen die uit elkaar gehouden worden:
 *
 *    de gegevens  -- BSN, IBAN, geboortedatum: staan in een eigen tabel
 *                    waar alleen het management bij mag
 *    de stukken   -- de bestanden zelf: staan in een afgesloten emmer bij
 *                    Supabase, nooit op een openbaar adres
 *
 *  Van dat tweede is het belangrijkste dat er nergens een blijvende link
 *  bestaat. Wie een document opent krijgt een adres dat na een minuut
 *  vervalt. Een link die per ongeluk in een chat belandt is daarna dood.
 * ------------------------------------------------------------------ */

export const EMMER = 'dossiers'

/** Wat we accepteren. Alles wat je aan een dossier zou hangen, en niets meer. */
export const TOEGESTAAN = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
]

export const MAX_BESTAND = 15 * 1024 * 1024

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

/* ================================================================== *
 *  De afgeschermde gegevens
 * ================================================================== */

export const dossier = {
  /** Eén regel per persoon; het id is gelijk aan het dossier-id. */
  async get(userId: string) {
    return db.personnelPrivate.get(userId)
  },

  async save(userId: string, patch: Partial<PersonnelPrivate>) {
    const bestaand = await db.personnelPrivate.get(userId)
    const rij: PersonnelPrivate = {
      ...(bestaand ?? { id: userId, userId, updatedAt: Date.now() }),
      ...patch,
      id: userId,
      userId,
      updatedAt: Date.now(),
    }
    return put('personnelPrivate', db.personnelPrivate, rij)
  },
}

/* ================================================================== *
 *  Documenten
 * ================================================================== */

export type UploadFout =
  | { soort: 'te-groot'; max: number }
  | { soort: 'soort-niet-toegestaan'; mime: string }
  | { soort: 'geen-verbinding' }
  | { soort: 'geen-opslag' }
  | { soort: 'server'; bericht: string }

export class DossierFout extends Error {
  constructor(readonly detail: UploadFout) {
    super(uitleg(detail))
  }
}

function uitleg(f: UploadFout): string {
  switch (f.soort) {
    case 'te-groot':
      return `Dit bestand is te groot. Maximaal ${Math.round(f.max / 1024 / 1024)} MB.`
    case 'soort-niet-toegestaan':
      return 'Alleen PDF en foto’s. Een Word-bestand kun je opslaan als PDF.'
    case 'geen-verbinding':
      return 'Een document uploaden lukt alleen met verbinding. De rest van de app ' +
             'werkt gewoon door; probeer het straks opnieuw.'
    case 'geen-opslag':
      return 'De opslag is nog niet ingesteld. Maak in Supabase de emmer "dossiers" aan.'
    case 'server':
      return f.bericht
  }
}

export const documenten = {
  /**
   * Zet een bestand in het dossier.
   *
   * Volgorde met opzet: eerst het bestand naar de opslag, dan pas de regel
   * erover. Andersom zou je een dossierstuk in de lijst hebben staan
   * waarvan het bestand nooit is aangekomen.
   */
  async upload(input: {
    bestand: File | Blob
    bestandsnaam: string
    persoon: Pick<User, 'id' | 'name'>
    kind: DocumentKind
    title: string
    description?: string
    visibleToEmployee?: boolean
    hiddenReason?: string
    expiresAt?: number
    requiresSignature?: boolean
    door: Pick<User, 'id' | 'name'>
  }): Promise<PersonnelDocument> {
    const mime = (input.bestand as File).type || 'application/octet-stream'

    if (input.bestand.size > MAX_BESTAND) {
      throw new DossierFout({ soort: 'te-groot', max: MAX_BESTAND })
    }
    if (!TOEGESTAAN.includes(mime)) {
      throw new DossierFout({ soort: 'soort-niet-toegestaan', mime })
    }
    if (!supabaseConfigured) throw new DossierFout({ soort: 'geen-opslag' })
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new DossierFout({ soort: 'geen-verbinding' })
    }

    const id = uid('doc')
    const extensie = (input.bestandsnaam.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'bin').toLowerCase()
    const pad = `${input.persoon.id}/${id}.${extensie}`

    const hash = await bestandsVingerafdruk(input.bestand)

    const { error } = await supabase().storage.from(EMMER).upload(pad, input.bestand, {
      contentType: mime,
      upsert: false,
    })
    if (error) {
      const bericht = String(error.message ?? error)
      if (/bucket/i.test(bericht) && /not found|does not exist/i.test(bericht)) {
        throw new DossierFout({ soort: 'geen-opslag' })
      }
      throw new DossierFout({ soort: 'server', bericht })
    }

    const zichtbaar = input.visibleToEmployee
      ?? DOCUMENT_KINDS[input.kind].standaardZichtbaar

    const doc: PersonnelDocument = {
      id,
      userId: input.persoon.id,
      userName: input.persoon.name,
      kind: input.kind,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      storagePath: pad,
      mime,
      sizeBytes: input.bestand.size,
      hash,
      visibleToEmployee: zichtbaar,
      hiddenReason: zichtbaar ? undefined : input.hiddenReason?.trim() || undefined,
      uploadedBy: input.door.id,
      uploadedByName: input.door.name,
      uploadedAt: Date.now(),
      expiresAt: input.expiresAt,
      requiresSignature: input.requiresSignature ?? false,
      updatedAt: Date.now(),
    }

    await put('documents', db.documents, doc)

    /* De medewerker hoort te weten dat er iets in zijn dossier is gezet --
       maar alleen als hij het ook mag zien. */
    if (zichtbaar && input.persoon.id !== input.door.id) {
      await notifications.send({
        to: { id: input.persoon.id, name: input.persoon.name },
        from: input.door,
        kind: doc.requiresSignature ? 'taak' : 'info',
        title: doc.requiresSignature
          ? `Handtekening gevraagd: ${doc.title}`
          : `Nieuw in je dossier: ${doc.title}`,
        body: doc.requiresSignature
          ? 'Lees het door en zet je handtekening als je akkoord bent.'
          : DOCUMENT_KINDS[doc.kind].label,
        link: 'dossier',
        // Een contract dat getekend moet worden mag niet blijven liggen
        // omdat iemand de app die week niet openheeft.
        mail: doc.requiresSignature,
      })
    }

    return doc
  },

  /**
   * Een adres om het bestand te openen, dat na een minuut vervalt.
   *
   * Bewust kort: een link die in een gesprek belandt of in de geschiedenis
   * van een browser blijft staan, is daarna niets meer waard.
   */
  async openen(doc: PersonnelDocument): Promise<string> {
    if (!supabaseConfigured) throw new DossierFout({ soort: 'geen-opslag' })

    const { data, error } = await supabase().storage
      .from(EMMER)
      .createSignedUrl(doc.storagePath, 60)

    if (error || !data?.signedUrl) {
      throw new DossierFout({
        soort: 'server',
        bericht: String(error?.message ?? 'Het bestand is niet op te halen.'),
      })
    }
    return data.signedUrl
  },

  /** Het bestand zelf, bijvoorbeeld om de vingerafdruk na te rekenen. */
  async ophalen(doc: PersonnelDocument): Promise<Blob> {
    if (!supabaseConfigured) throw new DossierFout({ soort: 'geen-opslag' })
    const { data, error } = await supabase().storage.from(EMMER).download(doc.storagePath)
    if (error || !data) {
      throw new DossierFout({
        soort: 'server',
        bericht: String(error?.message ?? 'Het bestand is niet op te halen.'),
      })
    }
    return data
  },

  async update(id: string, patch: Partial<PersonnelDocument>) {
    const doc = await db.documents.get(id)
    if (!doc) return
    return put('documents', db.documents, { ...doc, ...patch, id })
  },

  /**
   * Op ongezien zetten, of juist weer vrijgeven.
   *
   * Verbergen vraagt om een reden. Niet omdat de app dat nodig heeft, maar
   * omdat iemand over een jaar moet kunnen zien waarom dit is afgeschermd.
   */
  async zichtbaarheid(id: string, zichtbaar: boolean, reden?: string) {
    return documenten.update(id, {
      visibleToEmployee: zichtbaar,
      hiddenReason: zichtbaar ? undefined : reden?.trim() || undefined,
    })
  },

  /**
   * Ondertekenen door de medewerker.
   *
   * Wat we vastleggen: het moment, de naam die diegene zelf intypte, de
   * krabbel, en de vingerafdruk van het bestand op dat moment. Verandert er
   * later iets aan het bestand, dan klopt die vingerafdruk niet meer en is
   * dat aantoonbaar.
   *
   * Dit is een eenvoudige elektronische handtekening. Voor een
   * arbeidsovereenkomst is dat gebruikelijk en toereikend; het is geen
   * gekwalificeerde handtekening met een certificaat erachter.
   */
  async ondertekenen(input: {
    doc: PersonnelDocument
    door: Pick<User, 'id' | 'name'>
    getypteNaam: string
    krabbel?: string
  }) {
    const device = deviceInfo()

    const ondertekend = await documenten.update(input.doc.id, {
      signedAt: Date.now(),
      signedBy: input.door.id,
      signedName: input.getypteNaam.trim(),
      signedHash: input.doc.hash,
      signatureImage: input.krabbel,
      signedPlatform: device.platform,
      declinedAt: undefined,
      declineReason: undefined,
    })

    // Wie het document klaarzette hoort te horen dat het rond is.
    if (input.doc.uploadedBy !== input.door.id) {
      await notifications.send({
        to: { id: input.doc.uploadedBy, name: input.doc.uploadedByName },
        from: input.door,
        kind: 'info',
        title: `${input.door.name} heeft getekend`,
        body: input.doc.title,
        link: 'personeel',
        mail: true,
      })
    }

    return ondertekend
  },

  /** De medewerker tekent niet, en zegt waarom. */
  async afwijzen(doc: PersonnelDocument, door: Pick<User, 'id' | 'name'>, reden: string) {
    const afgewezen = await documenten.update(doc.id, {
      declinedAt: Date.now(),
      declineReason: reden.trim().slice(0, 500) || undefined,
    })

    await notifications.send({
      to: { id: doc.uploadedBy, name: doc.uploadedByName },
      from: door,
      kind: 'waarschuwing',
      title: `${door.name} tekent niet: ${doc.title}`,
      body: reden.trim().slice(0, 200) || 'Geen reden opgegeven.',
      link: 'personeel',
      mail: true,
    })

    return afgewezen
  },

  /**
   * Weghalen. Eerst de regel, dan het bestand: blijft het bestand hangen,
   * dan is dat vervelend maar niet zichtbaar. Andersom zou er een dossierstuk
   * in de lijst staan dat nergens meer naar wijst.
   */
  async verwijderen(doc: PersonnelDocument) {
    await db.documents.delete(doc.id)
    await enqueue('documents', 'delete', doc.id, null)

    if (supabaseConfigured && navigator.onLine) {
      try {
        await supabase().storage.from(EMMER).remove([doc.storagePath])
      } catch {
        /* De regel is weg; een achtergebleven bestand ruimen we later op. */
      }
    }
  },
}

/* ================================================================== *
 *  Wat je ervan ziet
 * ================================================================== */

/** De documenten van één persoon, in de volgorde waarin je ze wilt zien. */
export function documentenVan(
  alle: PersonnelDocument[],
  userId: string,
): PersonnelDocument[] {
  return alle
    .filter((d) => d.userId === userId)
    .sort((a, b) => {
      // Wat nog getekend moet worden staat bovenaan; dat is het enige
      // waar iemand vandaag iets mee moet.
      const aOpen = a.requiresSignature && !a.signedAt ? 0 : 1
      const bOpen = b.requiresSignature && !b.signedAt ? 0 : 1
      if (aOpen !== bOpen) return aOpen - bOpen
      return b.uploadedAt - a.uploadedAt
    })
}

/** Wat de medewerker zelf te zien krijgt. */
export function eigenDocumenten(
  alle: PersonnelDocument[],
  userId: string,
): PersonnelDocument[] {
  return documentenVan(alle, userId).filter((d) => d.visibleToEmployee)
}

export interface DossierSignaal {
  soort: 'tekenen' | 'verloopt' | 'verlopen' | 'ontbreekt'
  tekst: string
  doc?: PersonnelDocument
}

const DAG = 86_400_000

/**
 * Waar het dossier van deze persoon aandacht vraagt.
 *
 * Een ID dat over drie weken verloopt is geen ramp, maar wel iets wat je
 * wilt weten voordat het zover is -- daarna mag diegene niet meer werken.
 */
export function signalen(
  docs: PersonnelDocument[],
  userId: string,
): DossierSignaal[] {
  const mijn = documentenVan(docs, userId)
  const uit: DossierSignaal[] = []

  for (const d of mijn) {
    if (d.requiresSignature && !d.signedAt && !d.declinedAt) {
      uit.push({ soort: 'tekenen', tekst: `${d.title} wacht op een handtekening`, doc: d })
    }
    if (d.declinedAt) {
      uit.push({ soort: 'tekenen', tekst: `${d.title} is niet ondertekend`, doc: d })
    }
    if (d.expiresAt) {
      const dagen = Math.round((d.expiresAt - Date.now()) / DAG)
      if (dagen < 0) {
        uit.push({ soort: 'verlopen', tekst: `${d.title} is verlopen`, doc: d })
      } else if (dagen <= 60) {
        uit.push({
          soort: 'verloopt',
          tekst: `${d.title} verloopt over ${dagen} ${dagen === 1 ? 'dag' : 'dagen'}`,
          doc: d,
        })
      }
    }
  }

  if (!mijn.some((d) => d.kind === 'identiteitsbewijs')) {
    uit.push({ soort: 'ontbreekt', tekst: 'Er zit geen identiteitsbewijs in het dossier' })
  }
  if (!mijn.some((d) => d.kind === 'contract')) {
    uit.push({ soort: 'ontbreekt', tekst: 'Er zit geen contract in het dossier' })
  }

  return uit
}
