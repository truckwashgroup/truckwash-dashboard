import { db, uid, alleMensen } from './db'
import { enqueue } from './sync'
import { notifications, users as userRepo } from './repo'
import { mailAanmeldingBesluit, mailAanmeldingOntvangen } from './mail'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import { chat } from './chat'
import type { Role, Signup, SignupKind, User } from './types'

/* ------------------------------------------------------------------ *
 *  Zelf aanmelden
 *
 *  Het uitgangspunt: niemand hoeft ooit nog in Supabase te klikken.
 *
 *  Een account aanmaken kan een bezoeker zelf -- dat is de enige handeling
 *  die Supabase aan een niet-ingelogde toestaat, en er is niets geheims
 *  voor nodig. Maar een account is geen toegang. De databasetrigger zet het
 *  dossier klaar op inactief en zonder rollen, en legt een aanmelding neer
 *  bij het management.
 *
 *  Pas als daar iemand op "toelaten" drukt krijgt de persoon rollen, een
 *  vestiging en toegang. Tot die tijd komt hij niet verder dan het scherm
 *  waarop staat dat zijn aanmelding in behandeling is.
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

export interface RegisterInput {
  name: string
  email: string
  password: string
  phone?: string
  kind: SignupKind
  companyName?: string
  locationId?: string
  message?: string
}

export interface RegisterResult {
  ok: boolean
  /** Moet de aanmelder eerst zijn e-mailadres bevestigen? */
  needsConfirmation: boolean
  error?: string
}

/** Minimale eisen aan een wachtwoord. Supabase eist zelf acht tekens. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Gebruik minstens tien tekens.'
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Gebruik letters én cijfers.'
  }
  return null
}

export function emailLooksValid(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())
}

/**
 * Maakt het inlogaccount aan. De rest -- dossier, aanmelding, seintje aan
 * het management -- doet de databasetrigger, zodat het ook klopt als de app
 * halverwege wordt afgesloten.
 */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  if (!supabaseConfigured) {
    return { ok: false, needsConfirmation: false, error: 'Er is nog geen database ingesteld.' }
  }

  const email = input.email.trim().toLowerCase()

  const { data, error } = await supabase().auth.signUp({
    email,
    password: input.password,
    options: {
      // Alles wat de trigger nodig heeft om de aanmelding neer te leggen.
      data: {
        name: input.name.trim(),
        signup: true,
        signup_kind: input.kind,
        phone: input.phone?.trim() || undefined,
        company_name: input.companyName?.trim() || undefined,
        location_id: input.locationId || undefined,
        message: input.message?.trim().slice(0, 600) || undefined,
      },
    },
  })

  if (error) {
    // "User already registered" hoort niet als storing te klinken.
    if (/already registered|already exists/i.test(error.message)) {
      return {
        ok: false,
        needsConfirmation: false,
        error: 'Er bestaat al een account met dit e-mailadres. Probeer in te loggen.',
      }
    }
    return { ok: false, needsConfirmation: false, error: error.message }
  }

  // Post de deur uit. Mag mislukken; de aanmelding staat er hoe dan ook.
  void mailAanmeldingOntvangen(email, input.name.trim())

  // Zonder sessie moet het e-mailadres eerst bevestigd worden.
  const needsConfirmation = !data.session

  // De aanmelder hoort niet half ingelogd rond te lopen; hij heeft nog
  // nergens toegang toe.
  if (data.session) {
    try {
      await supabase().auth.signOut()
    } catch {
      /* niet erg */
    }
  }

  return { ok: true, needsConfirmation }
}

/* ------------------------------------------------------------------ *
 *  Afhandelen door het management
 * ------------------------------------------------------------------ */

export interface ApproveInput {
  signup: Signup
  roles: Role[]
  locationId?: string
  /** Extra vestigingen waar iemand leiding over krijgt */
  manages?: string[]
  allLocations?: boolean
  personnelNumber?: string
  function?: string
  contractHours?: number
  hourlyRate?: number
  supervisorId?: string
  companyId?: string
  by: Pick<User, 'id' | 'name'>
}

export const signups = {
  /**
   * Laat iemand toe.
   *
   * Het dossier bestaat al (de trigger zette het klaar bij het aanmaken van
   * het account); we vullen het aan en zetten het op actief. Bestaat het
   * niet -- bijvoorbeeld omdat dit met de testgegevens draait -- dan maken
   * we het alsnog.
   */
  async approve(input: ApproveInput) {
    const { signup, by } = input

    const bestaand = signup.profileId
      ? await db.users.get(signup.profileId)
      : (await alleMensen()).find(
          (u) => u.email.toLowerCase() === signup.email.toLowerCase())

    const patch: Partial<User> = {
      name: signup.name,
      roles: input.roles,
      active: true,
      phone: signup.phone,
      locationId: input.locationId,
      manages: input.manages?.length ? input.manages : undefined,
      allLocations: input.allLocations || undefined,
      personnelNumber: input.personnelNumber?.trim() || undefined,
      function: input.function?.trim() || undefined,
      contractHours: input.contractHours,
      hourlyRate: input.hourlyRate,
      supervisorId: input.supervisorId,
      companyId: input.companyId,
    }

    let profile: User | undefined
    if (bestaand) {
      profile = await userRepo.update(bestaand.id, patch)
    } else {
      const nieuw: User = {
        id: uid('u'),
        email: signup.email,
        password: '',
        name: signup.name,
        roles: input.roles,
        active: true,
        updatedAt: Date.now(),
        ...patch,
      }
      profile = await put('users', db.users, nieuw)
    }

    await put('signups', db.signups, {
      ...signup,
      status: 'goedgekeurd',
      profileId: profile?.id ?? signup.profileId,
      handledBy: by.id,
      handledByName: by.name,
      handledAt: Date.now(),
      rejectReason: undefined,
    })

    if (profile) {
      // Welkom in de app zelf, zodat het er staat zodra hij binnenkomt.
      await notifications.send({
        to: { id: profile.id, name: profile.name },
        from: by,
        kind: 'info',
        title: 'Je aanmelding is goedgekeurd',
        body: 'Je kunt inloggen met het e-mailadres en wachtwoord waarmee je je hebt aangemeld.',
      })

      // En meteen in het overleg van zijn vestiging zetten.
      if (input.roles.some((r) => r !== 'customer')) {
        await chat.addToLocationChannel(profile)
      }
    }

    void mailAanmeldingBesluit(signup.id, true, {
      naam: signup.name.split(' ')[0],
      rollen: input.roles.join(', '),
    })

    return profile
  },

  /** Wijst een aanmelding af. Het account blijft bestaan maar komt nergens in. */
  async reject(signup: Signup, reason: string, by: Pick<User, 'id' | 'name'>) {
    const opgeslagen = await put('signups', db.signups, {
      ...signup,
      status: 'afgewezen',
      handledBy: by.id,
      handledByName: by.name,
      handledAt: Date.now(),
      rejectReason: reason.trim().slice(0, 400) || undefined,
    })

    void mailAanmeldingBesluit(signup.id, false, {
      naam: signup.name.split(' ')[0],
      reden: reason.trim().slice(0, 400),
    })

    return opgeslagen
  },

  /** Terugdraaien: zet een afgehandelde aanmelding weer op nieuw. */
  async reopen(signup: Signup) {
    return put('signups', db.signups, {
      ...signup,
      status: 'nieuw',
      handledBy: undefined,
      handledByName: undefined,
      handledAt: undefined,
      rejectReason: undefined,
    })
  },

  /**
   * Legt met de hand een aanmelding neer. Alleen voor de testgegevens en
   * voor het geval iemand telefonisch binnenkomt.
   */
  async create(input: Omit<Signup, 'id' | 'status' | 'createdAt' | 'updatedAt'>) {
    const rij: Signup = {
      ...input,
      id: uid('sg'),
      status: 'nieuw',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('signups', db.signups, rij)
  },
}
