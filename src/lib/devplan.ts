import { db, uid, alleMensen } from './db'
import { enqueue } from './sync'
import { notifications } from './repo'
import { ticketMessages, tickets } from './tickets'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import { PLAN_OMVANG, PLAN_RISICO } from './types'
import type {
  DevPlan, PlanOmvang, PlanRisico, PlanStap, Ticket, TicketKind, TicketMessage,
  User,
} from './types'

/* ------------------------------------------------------------------ *
 *  Van melding naar plan
 *
 *  Een melding is zelden meteen een opdracht. "Hij doet het niet" is waar en
 *  onbruikbaar; "kan dit handiger" ook. Wat eraan ontbreekt zijn de vragen
 *  die je anders drie dagen later alsnog stelt, als de melder allang is
 *  vergeten wat hij precies deed.
 *
 *  Dus eerst een gesprek. Dat loopt bij voorkeur via de serverfunctie, die
 *  echt doorvraagt op wat er gezegd wordt. Is er geen verbinding of geen
 *  sleutel, dan neemt een vaste vragenlijst het over -- minder scherp, maar
 *  een wasser op de vloer heeft niet altijd bereik, en dan moet zijn melding
 *  nog steeds bruikbaar binnenkomen.
 *
 *  Daarna een plan in stappen die los aan en uit kunnen. Dat is het hele
 *  punt: bij een wens van drie dingen wil je er misschien twee, en dan hoort
 *  de melder ook te horen wat er niet gebeurt en waarom.
 * ------------------------------------------------------------------ */

export const ASSISTENT = { id: 'assistent', name: 'Assistent' }

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
 *  De vaste vragenlijst
 *
 *  De terugval, en tegelijk de ondergrens: dit is wat er minimaal bekend
 *  moet zijn voordat iemand er iets mee kan. Per soort melding andere
 *  vragen, want "wat verwachtte je" slaat nergens op bij een wens.
 * ================================================================== */

export interface Vraag {
  id: string
  tekst: string
  hint?: string
  /** Antwoorden waar de melder uit kan kiezen; hij mag ook zelf typen. */
  keuzes?: string[]
  /** Overslaan mag; niet alles is bij elke melding te beantwoorden. */
  verplicht?: boolean
}

const VRAGEN: Record<TicketKind, Vraag[]> = {
  fout: [
    {
      id: 'stappen',
      tekst: 'Wat deed je precies, vlak voordat het misging?',
      hint: 'Het liefst stap voor stap. "Ik klikte op Planning, koos donderdag, en toen…"',
      verplicht: true,
    },
    {
      id: 'verwacht',
      tekst: 'Wat had je verwacht dat er zou gebeuren?',
      hint: 'Soms werkt iets precies zoals bedoeld en is de bedoeling het probleem.',
      verplicht: true,
    },
    {
      id: 'gebeurde',
      tekst: 'En wat gebeurde er in plaats daarvan?',
      hint: 'Stond er een melding op het scherm? Zo ja, wat stond er letterlijk?',
      verplicht: true,
    },
    {
      id: 'vaker',
      tekst: 'Gebeurt dit elke keer, of af en toe?',
      keuzes: ['Elke keer', 'Meestal wel', 'Af en toe', 'Eén keer gezien'],
    },
    {
      id: 'sinds',
      tekst: 'Werkte het eerder wel?',
      keuzes: ['Ja, sinds kort niet meer', 'Nee, het werkte nooit', 'Weet ik niet'],
    },
    {
      id: 'blokkeert',
      tekst: 'Kun je verder met je werk, of sta je hierdoor stil?',
      keuzes: ['Ik sta stil', 'Het kost me tijd', 'Het is vooral vervelend'],
    },
  ],
  wens: [
    {
      id: 'nu',
      tekst: 'Hoe doe je het nu?',
      hint: 'Ook als dat "op papier" of "ik bel even" is — dat is precies wat we willen weten.',
      verplicht: true,
    },
    {
      id: 'beter',
      tekst: 'Wat zou er dan moeten gebeuren?',
      hint: 'Beschrijf het alsof het er al is: "ik klik op X en dan zie ik Y".',
      verplicht: true,
    },
    {
      id: 'hoevaak',
      tekst: 'Hoe vaak loop je hier tegenaan?',
      keuzes: ['Elke dag', 'Elke week', 'Een paar keer per maand', 'Zelden'],
    },
    {
      id: 'wie',
      tekst: 'Wie heeft hier nog meer last van?',
      keuzes: ['Alleen ik', 'Mijn vestiging', 'Iedereen', 'Weet ik niet'],
    },
  ],
  traag: [
    {
      id: 'waar',
      tekst: 'Op welk scherm merk je het, en bij welke handeling?',
      verplicht: true,
    },
    {
      id: 'hoelang',
      tekst: 'Hoe lang duurt het ongeveer?',
      keuzes: ['Een paar seconden', 'Vijf tot tien seconden', 'Langer', 'Het loopt vast'],
    },
    {
      id: 'wanneer',
      tekst: 'Is het altijd zo, of op bepaalde momenten?',
      hint: "Bijvoorbeeld 's ochtends als iedereen inklokt.",
    },
    {
      id: 'apparaat',
      tekst: 'Op welk apparaat?',
      keuzes: ['De computer op kantoor', 'De tablet op de vestiging', 'Mijn telefoon', 'Allemaal'],
    },
  ],
  vraag: [
    {
      id: 'doel',
      tekst: 'Wat probeer je voor elkaar te krijgen?',
      verplicht: true,
    },
    {
      id: 'gezocht',
      tekst: 'Waar heb je al gekeken?',
      hint: 'Zo weten we of het er niet is, of alleen niet te vinden.',
    },
  ],
}

export function vragenVoor(soort: TicketKind): Vraag[] {
  return VRAGEN[soort]
}

/* ================================================================== *
 *  Het gesprek
 * ================================================================== */

export interface GesprekBeurt {
  vraag: string
  antwoord: string
}

/**
 * De volgende vraag, als het gesprek via de server loopt.
 *
 * Geeft `null` terug als er niets meer te vragen valt, en `undefined` als de
 * server niet bereikbaar is -- dan neemt de vragenlijst het over. Dat
 * onderscheid is belangrijk: "klaar" en "lukt niet" horen niet hetzelfde
 * gedrag te geven.
 */
export async function volgendeVraag(
  ticket: Pick<Ticket, 'title' | 'description' | 'kind' | 'fromPage'>,
  tot_nu_toe: GesprekBeurt[],
): Promise<string | null | undefined> {
  if (!supabaseConfigured) {
    laatsteReden = 'Er is geen database ingesteld.'
    return undefined
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    laatsteReden = 'Geen verbinding.'
    return undefined
  }

  try {
    const { data, error } = await supabase().functions.invoke<{
      ok: boolean
      vraag?: string | null
      klaar?: boolean
      reden?: string
    }>('melding-gesprek', {
      body: { doel: 'vraag', ticket, gesprek: tot_nu_toe },
    })

    if (error) {
      const msg = String(error.message ?? error)
      laatsteReden = /not found|404/i.test(msg)
        ? 'De functie melding-gesprek staat nog niet bij Supabase. ' +
          'Rol hem uit met npm run functions.'
        : msg
      console.warn('[gesprek] ' + laatsteReden)
      return undefined
    }
    if (!data?.ok) {
      laatsteReden =
        data?.reden === 'geen-sleutel'
          ? 'ANTHROPIC_API_KEY staat niet ingesteld bij de functies.'
          : data?.reden === 'geen-antwoord'
            ? 'Het model gaf geen bruikbaar antwoord.'
            : (data?.reden ?? 'Onbekende reden')
      console.warn('[gesprek] ' + laatsteReden)
      return undefined
    }

    laatsteReden = null
    return data.klaar ? null : (data.vraag ?? null)
  } catch (e) {
    laatsteReden = e instanceof Error ? e.message : String(e)
    console.warn('[gesprek] ' + laatsteReden)
    return undefined
  }
}

/**
 * Waarom er niet is doorgevraagd.
 *
 * De terugval op de vaste vragen is met opzet stil voor de melder -- die
 * hoeft niets te weten van sleutels en serverfuncties. Maar voor wie het
 * moet repareren is "hij deed het niet" geen bruikbare mededeling, en zonder
 * dit stond het nergens.
 */
let laatsteReden: string | null = null

export function waaromGeenGesprek(): string | null {
  return laatsteReden
}

/** Het gesprek als berichten bij de melding, zodat het niet los komt te staan. */
export async function legGesprekVast(
  ticketId: string,
  beurten: GesprekBeurt[],
  door: Pick<User, 'id' | 'name'>,
) {
  for (const b of beurten) {
    if (!b.antwoord.trim()) continue
    await ticketMessages.send({
      ticketId,
      body: `**${b.vraag}**\n${b.antwoord.trim()}`,
      internal: false,
      by: door,
    })
  }
}

/* ================================================================== *
 *  Het plan
 * ================================================================== */

export const plannen = {
  /**
   * Een plan laten opstellen uit de melding en het gesprek.
   *
   * Lukt dat niet -- geen verbinding, geen sleutel -- dan komt er een
   * geraamte terug met de melding en het gesprek erin. Beter een plan dat je
   * zelf afmaakt dan een knop die niets doet.
   */
  async opstellen(input: {
    ticket: Ticket
    gesprek: GesprekBeurt[]
    door: Pick<User, 'id' | 'name'>
  }): Promise<DevPlan> {
    const bedacht = await vraagPlanAanServer(input.ticket, input.gesprek)

    const plan: DevPlan = {
      id: uid('pl'),
      ticketId: input.ticket.id,
      ticketNumber: input.ticket.number,
      titel: bedacht?.titel?.trim() || input.ticket.title,
      aanleiding: bedacht?.aanleiding?.trim() || samenvatting(input.ticket, input.gesprek),
      stappen: (bedacht?.stappen ?? geraamte(input.ticket)).map(schoonStap),
      buitenScope: bedacht?.buitenScope?.trim() || undefined,
      status: 'concept',
      bron: bedacht ? 'gesprek' : 'vragenlijst',
      gemaaktDoor: input.door.id,
      gemaaktDoorNaam: input.door.name,
      gemaaktOp: Date.now(),
      updatedAt: Date.now(),
    }

    await put('devPlans', db.devPlans, plan)
    return plan
  },

  async update(id: string, patch: Partial<DevPlan>) {
    const plan = await db.devPlans.get(id)
    if (!plan) return
    return put('devPlans', db.devPlans, { ...plan, ...patch, id })
  },

  /** Een stap aan- of uitzetten. */
  async zetStap(planId: string, stapId: string, gekozen: boolean) {
    const plan = await db.devPlans.get(planId)
    if (!plan) return
    return put('devPlans', db.devPlans, {
      ...plan,
      stappen: plan.stappen.map((s) => (s.id === stapId ? { ...s, gekozen } : s)),
    })
  },

  async zetStapOpmerking(planId: string, stapId: string, opmerking: string) {
    const plan = await db.devPlans.get(planId)
    if (!plan) return
    return put('devPlans', db.devPlans, {
      ...plan,
      stappen: plan.stappen.map(
        (s) => (s.id === stapId ? { ...s, opmerking: opmerking.trim() || undefined } : s)),
    })
  },

  /** Klaar om te laten beoordelen. */
  async indienen(plan: DevPlan) {
    const bijgewerkt = await plannen.update(plan.id, { status: 'ter beoordeling' })

    const bazen = (await alleMensen()).filter(
      (u) => u.active && u.roles.includes('management'))
    for (const baas of bazen) {
      await notifications.send({
        to: { id: baas.id, name: baas.name },
        from: { id: plan.gemaaktDoor, name: plan.gemaaktDoorNaam },
        kind: 'taak',
        title: `Plan klaar: ${plan.ticketNumber}`,
        body: `${plan.titel} — ${plan.stappen.length} stappen om langs te lopen.`,
        link: 'plannen',
      })
    }
    return bijgewerkt
  },

  /**
   * Akkoord.
   *
   * Het gaat alleen over de aangevinkte stappen. Wat uitstaat is geen
   * "later misschien" maar een beslissing, en die hoort de melder ook te
   * horen -- anders wacht hij op iets wat nooit komt.
   */
  async goedkeuren(plan: DevPlan, door: Pick<User, 'id' | 'name'>, opmerking?: string) {
    const gekozen = plan.stappen.filter((s) => s.gekozen)
    if (gekozen.length === 0) {
      throw new Error(
        'Er staat geen enkele stap aan. Wijs het plan af als je niets wilt, ' +
        'dan weet de melder waar hij aan toe is.',
      )
    }

    const bijgewerkt = await plannen.update(plan.id, {
      status: 'goedgekeurd',
      beoordeeldDoor: door.id,
      beoordeeldDoorNaam: door.name,
      beoordeeldOp: Date.now(),
      opmerking: opmerking?.trim() || undefined,
    })

    const ticket = await db.tickets.get(plan.ticketId)
    if (ticket) {
      const afgevallen = plan.stappen.length - gekozen.length
      await ticketMessages.send({
        ticketId: ticket.id,
        internal: false,
        by: door,
        body:
          `Je melding is een plan geworden en dat is goedgekeurd.\n\n` +
          `Wat er gebouwd wordt:\n` +
          gekozen.map((s) => `· ${s.titel}`).join('\n') +
          (afgevallen > 0
            ? `\n\nWat er niet in zit (${afgevallen}):\n` +
              plan.stappen.filter((s) => !s.gekozen)
                .map((s) => `· ${s.titel}${s.opmerking ? ` — ${s.opmerking}` : ''}`).join('\n')
            : '') +
          (opmerking?.trim() ? `\n\n${opmerking.trim()}` : ''),
      })
      await tickets.setStatus(ticket.id, 'in behandeling', door)
    }

    return bijgewerkt
  },

  async afwijzen(plan: DevPlan, reden: string, door: Pick<User, 'id' | 'name'>) {
    const bijgewerkt = await plannen.update(plan.id, {
      status: 'afgewezen',
      beoordeeldDoor: door.id,
      beoordeeldDoorNaam: door.name,
      beoordeeldOp: Date.now(),
      opmerking: reden.trim() || undefined,
    })

    const ticket = await db.tickets.get(plan.ticketId)
    if (ticket) {
      await ticketMessages.send({
        ticketId: ticket.id,
        internal: false,
        by: door,
        body:
          'We gaan hier voorlopig niets mee doen.\n\n' +
          (reden.trim() || 'Er is geen reden opgegeven.'),
      })
    }
    return bijgewerkt
  },

  /** Uitgeleverd, met de versie erbij. */
  async uitgevoerd(plan: DevPlan, versie: string, door: Pick<User, 'id' | 'name'>) {
    const bijgewerkt = await plannen.update(plan.id, {
      status: 'uitgevoerd',
      uitgevoerdIn: versie.trim(),
      uitgevoerdOp: Date.now(),
    })

    const ticket = await db.tickets.get(plan.ticketId)
    if (ticket) {
      await tickets.setStatus(ticket.id, 'opgelost', door, {
        resolution: `Uitgeleverd in versie ${versie.trim()}.`,
        fixedIn: versie.trim(),
      })
    }
    return bijgewerkt
  },

  async verwijderen(id: string) {
    await db.devPlans.delete(id)
    await enqueue('devPlans', 'delete', id, null)
  },
}

/* ------------------------------------------------------------------ *
 *  De opdracht
 *
 *  Wat er uit de knop "kopieer opdracht" komt. Bewust platte tekst met
 *  koppen: het gaat naar een gesprek, niet naar een systeem, en het moet
 *  leesbaar blijven als het ergens tussen plakt.
 * ------------------------------------------------------------------ */

export function opdrachtTekst(plan: DevPlan, ticket?: Ticket): string {
  const gekozen = plan.stappen.filter((s) => s.gekozen)
  const afgevallen = plan.stappen.filter((s) => !s.gekozen)

  const regels: string[] = [
    `# ${plan.titel}`,
    '',
    `Melding ${plan.ticketNumber}${ticket ? ` — gemeld door ${ticket.reportedByName}` : ''}`,
    plan.beoordeeldDoorNaam
      ? `Goedgekeurd door ${plan.beoordeeldDoorNaam}.`
      : 'Nog niet goedgekeurd.',
    '',
    '## Aanleiding',
    plan.aanleiding,
    '',
    '## Wat er gebouwd wordt',
  ]

  gekozen.forEach((s, i) => {
    regels.push('')
    regels.push(`### ${i + 1}. ${s.titel}`)
    regels.push(s.wat)
    if (s.waarom) regels.push(`*Waarom:* ${s.waarom}`)
    if (s.raakt) regels.push(`*Raakt:* ${s.raakt}`)
    regels.push(
      `*Omvang:* ${PLAN_OMVANG[s.omvang].label} · *Risico:* ${PLAN_RISICO[s.risico].label}`)
    if (s.opmerking) regels.push(`*Aantekening:* ${s.opmerking}`)
  })

  if (afgevallen.length) {
    regels.push('', '## Wat er bewust niet in zit')
    for (const s of afgevallen) {
      regels.push(`- ${s.titel}${s.opmerking ? ` — ${s.opmerking}` : ''}`)
    }
  }

  if (plan.buitenScope) {
    regels.push('', '## Buiten bereik', plan.buitenScope)
  }

  if (plan.opmerking) {
    regels.push('', '## Aantekening bij het akkoord', plan.opmerking)
  }

  if (ticket) {
    regels.push(
      '',
      '## Context uit de melding',
      `Soort: ${ticket.kind} · Prioriteit: ${ticket.priority}`,
      `Vanaf: ${ticket.fromPage ?? 'onbekend'} (${ticket.fromRole ?? 'onbekende rol'})`,
      `Versie: ${ticket.appVersion} · ${ticket.platform}`,
    )
  }

  return regels.join('\n')
}

/* ------------------------------------------------------------------ *
 *  Wat je ervan ziet
 * ------------------------------------------------------------------ */

export function planVan(plannen: DevPlan[], ticketId: string): DevPlan | undefined {
  return plannen
    .filter((p) => p.ticketId === ticketId)
    .sort((a, b) => b.gemaaktOp - a.gemaaktOp)[0]
}

/** Plannen die op een beslissing wachten, oudste eerst. */
export function terBeoordeling(alle: DevPlan[]): DevPlan[] {
  return alle
    .filter((p) => p.status === 'ter beoordeling')
    .sort((a, b) => a.gemaaktOp - b.gemaaktOp)
}

/** Hoeveel werk het geheel is, als grove indicatie. */
export function omvangVan(plan: DevPlan): { stappen: number; zwaarte: PlanOmvang } {
  const gekozen = plan.stappen.filter((s) => s.gekozen)
  const punten = gekozen.reduce(
    (a, s) => a + (s.omvang === 'groot' ? 5 : s.omvang === 'middel' ? 2 : 1), 0)
  return {
    stappen: gekozen.length,
    zwaarte: punten >= 8 ? 'groot' : punten >= 3 ? 'middel' : 'klein',
  }
}

/* ------------------------------------------------------------------ *
 *  Hulpjes
 * ------------------------------------------------------------------ */

interface BedachtPlan {
  titel?: string
  aanleiding?: string
  buitenScope?: string
  stappen?: Partial<PlanStap>[]
}

async function vraagPlanAanServer(
  ticket: Ticket,
  gesprek: GesprekBeurt[],
): Promise<BedachtPlan | null> {
  if (!supabaseConfigured) return null
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null

  try {
    const { data, error } = await supabase().functions.invoke<{
      ok: boolean
      plan?: BedachtPlan
    }>('melding-gesprek', {
      body: {
        doel: 'plan',
        ticket: {
          title: ticket.title,
          description: ticket.description,
          kind: ticket.kind,
          priority: ticket.priority,
          fromPage: ticket.fromPage,
          fromRole: ticket.fromRole,
        },
        gesprek,
      },
    })
    if (error || !data?.ok || !data.plan) return null
    return data.plan
  } catch {
    return null
  }
}

/** Zorgt dat wat er ook terugkomt, er een bruikbare stap van wordt. */
function schoonStap(s: Partial<PlanStap>): PlanStap {
  const risico: PlanRisico =
    s.risico === 'groot' || s.risico === 'gemiddeld' ? s.risico : 'klein'
  const omvang: PlanOmvang =
    s.omvang === 'groot' || s.omvang === 'middel' ? s.omvang : 'klein'

  return {
    id: s.id ?? uid('st'),
    titel: (s.titel ?? 'Naamloze stap').slice(0, 160),
    wat: (s.wat ?? '').slice(0, 2000),
    waarom: s.waarom?.slice(0, 600) || undefined,
    raakt: s.raakt?.slice(0, 200) || undefined,
    risico,
    omvang,
    // Alles staat aan; uitzetten is de handeling, niet aanzetten.
    gekozen: s.gekozen !== false,
    opmerking: s.opmerking?.slice(0, 600) || undefined,
  }
}

/** Het geraamte als er geen server is: één stap, met alles wat we weten. */
function geraamte(ticket: Ticket): Partial<PlanStap>[] {
  return [{
    titel: ticket.title,
    wat:
      ticket.description ||
      'Nog uit te werken. Dit plan is zonder verbinding gemaakt, dus de ' +
      'stappen zijn niet automatisch bedacht.',
    raakt: ticket.fromPage,
    risico: 'gemiddeld',
    omvang: 'middel',
  }]
}

function samenvatting(ticket: Ticket, gesprek: GesprekBeurt[]): string {
  const uit = [ticket.description.trim()]
  for (const b of gesprek) {
    if (b.antwoord.trim()) uit.push(`${b.vraag} ${b.antwoord.trim()}`)
  }
  return uit.filter(Boolean).join('\n\n').slice(0, 4000)
}

/** De beurten uit de berichten bij een melding terughalen. */
export function gesprekUit(berichten: TicketMessage[], ticketId: string): GesprekBeurt[] {
  return berichten
    .filter((m) => m.ticketId === ticketId && !m.internal && m.body.startsWith('**'))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => {
      const eind = m.body.indexOf('**', 2)
      return {
        vraag: eind > 0 ? m.body.slice(2, eind) : '',
        antwoord: eind > 0 ? m.body.slice(eind + 2).trim() : m.body,
      }
    })
    .filter((b) => b.vraag)
}
