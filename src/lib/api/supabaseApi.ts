import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ApiAdapter, PullResult, PushChange } from './types'
import type { EntityName } from '../types'

/* ------------------------------------------------------------------ *
 *  Supabase-adapter
 *
 *  Zelfde vier methodes als de mock: login, push, pull, ping. De rest van
 *  de app merkt geen verschil.
 *
 *  Twee dingen die hier geregeld worden:
 *   1. De app werkt in camelCase, Postgres in snake_case. Onderaan staat
 *      een vertaallaag; alleen de uitzonderingen zijn met de hand benoemd.
 *   2. Alle tijdstempels zijn epoch-milliseconden (bigint). Dat is exact
 *      hetzelfde formaat als in de app, dus geen tijdzone-verrassingen.
 *      `updated_at` wordt serverzijdig gezet door een trigger, zodat een
 *      scheefstaande klok op een telefoon de synchronisatie niet breekt.
 * ------------------------------------------------------------------ */

// import.meta.env bestaat alleen in een Vite-build. In Node (de zelftest)
// niet, vandaar de voorzichtige uitlezing.
const ENV: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

const URL = ENV.VITE_SUPABASE_URL
const ANON = ENV.VITE_SUPABASE_ANON_KEY

/**
 * De sleutel in deze variabele belandt in de app-bundel en gaat dus mee naar
 * iedere gebruiker. Dat mag alleen met de publieke sleutel: die komt niet
 * langs de beveiligingsregels heen. Een geheime sleutel doet dat wel, en die
 * weigeren we hier hardop.
 */
function keyProblem(key: string | undefined): string | null {
  if (!key) return null
  if (key.startsWith('sb_secret_') || key.startsWith('sk_')) {
    return 'Dit is een geheime sleutel (sb_secret_). Gebruik de publieke sleutel: ' +
           'Supabase -> Project Settings -> API Keys -> "publishable".'
  }
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const pad = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4)
      const json = atob(pad.replace(/-/g, '+').replace(/_/g, '/'))
      if (JSON.parse(json).role === 'service_role') {
        return 'Dit is de service_role-sleutel. Gebruik de "anon public" sleutel.'
      }
    } catch {
      /* geen leesbare JWT: dan is het waarschijnlijk een publieke sleutel */
    }
  }
  return null
}

export const configError = keyProblem(ANON)

if (configError) {
  console.error('[Supabase] ' + configError)
}

export const supabaseConfigured = Boolean(URL && ANON) && !configError

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (!client) {
    if (!URL || !ANON) {
      throw new Error(
        'Supabase is niet ingesteld. Zet VITE_SUPABASE_URL en ' +
        'VITE_SUPABASE_ANON_KEY in je .env-bestand.',
      )
    }
    client = createClient(URL, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // De app draait ook als bestand (Electron) en als webview (mobiel);
        // daar bestaat geen URL-callback om een sessie uit te lezen.
        detectSessionInUrl: false,
      },
    })
  }
  return client
}

/* ------------------------------------------------------------------ *
 *  Tabellen
 * ------------------------------------------------------------------ */

const TABLES: Record<EntityName, string> = {
  locations: 'locations',
  users: 'profiles',
  companies: 'companies',
  washJobs: 'wash_jobs',
  inventory: 'inventory_items',
  stockMovements: 'stock_movements',
  expenses: 'expenses',
  timeEntries: 'time_entries',
  shifts: 'shifts',
  notifications: 'notifications',
  courses: 'courses',
  courseProgress: 'course_progress',
  assets: 'assets',
  faults: 'faults',
  workOrders: 'work_orders',
  maintenancePlans: 'maintenance_plans',
  tickets: 'tickets',
  ticketMessages: 'ticket_messages',
  logEvents: 'log_events',
  signups: 'signups',
  channels: 'channels',
  chatMessages: 'chat_messages',
  channelReads: 'channel_reads',
  emailLog: 'email_log',
  personnelPrivate: 'personnel_private',
  documents: 'documents',
  mailbox: 'mailbox',
  changeRequests: 'change_requests',
}

/** Kolommen waarvan de naam niet simpelweg de snake_case-variant is. */
const OVERRIDES: Partial<Record<EntityName, Record<string, string>>> = {
  // "end" en "function" zijn gereserveerde woorden in SQL, "date" is een typenaam
  timeEntries: { start: 'started_at', end: 'ended_at' },
  expenses: { date: 'expense_date' },
  users: { function: 'job_title' },
}

/* ------------------------------------------------------------------ *
 *  camelCase <-> snake_case
 * ------------------------------------------------------------------ */

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

export function toRow(entity: EntityName, obj: Record<string, unknown>) {
  const over = OVERRIDES[entity] ?? {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    out[over[k] ?? toSnake(k)] = v
  }
  // updated_at wordt serverzijdig gezet
  delete out.updated_at
  return out
}

export function fromRow(entity: EntityName, row: Record<string, unknown>) {
  const over = OVERRIDES[entity] ?? {}
  const back = Object.fromEntries(Object.entries(over).map(([camel, col]) => [col, camel]))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === null) continue // de app gebruikt undefined, niet null
    out[back[k] ?? toCamel(k)] = v
  }
  return out
}

/* ------------------------------------------------------------------ */

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? 'onbekende fout'}`)
}

/**
 * Bestaat deze tabel nog niet?
 *
 * Dat gebeurt zodra er een versie uitkomt met een nieuwe tabel en het
 * schema nog niet is bijgewerkt. Vroeger liep de hele synchronisatie daarop
 * stuk -- niet alleen die ene tabel, maar alles: roosters, bonnen, meldingen.
 * Eén ontbrekende tabel legde de app plat.
 *
 * Nu slaan we hem over en zeggen we hardop wat eraan te doen valt.
 */
export function tabelOntbreekt(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // 42P01 komt van Postgres, PGRST205/PGRST106 van de laag ervoor.
  if (['42P01', 'PGRST205', 'PGRST106'].includes(error.code ?? '')) return true
  return /(relation|table).{0,40}(does not exist|not found)/i.test(error.message ?? '')
}

/** Geen rechten op een tabel is normaal: een klant ziet geen voorraad. */
function geenRechten(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST301' || error?.code === '42501'
}

/** Welke tabellen ontbraken bij de laatste ronde. */
export const ontbrekendeTabellen = new Set<string>()

/**
 * Een wijziging voor een tabel die nog niet bestaat.
 *
 * Apart soort fout, want dit is geen slecht record maar een schema dat
 * achterloopt. Zo'n wijziging mag niet worden weggegooid na een paar
 * mislukte pogingen -- hij hoort te blijven staan tot het schema klopt.
 */
export class OntbrekendeTabel extends Error {
  constructor(readonly tabel: string) {
    super(
      `De tabel "${tabel}" bestaat nog niet in de database. ` +
      'Draai supabase/setup.sql opnieuw; je wijziging blijft zolang in de wachtrij staan.',
    )
  }
}

export const supabaseApi: ApiAdapter = {
  name: 'supabase',

  async ping() {
    if (!supabaseConfigured || !navigator.onLine) return false
    try {
      // Lichte query die alleen slaagt als de server bereikbaar is.
      const { error } = await supabase().from('companies').select('id', { head: true, count: 'exact' }).limit(1)
      // Een RLS-weigering betekent nog steeds: server bereikbaar.
      return !error || error.code === 'PGRST301' || error.code === '42501'
    } catch {
      return false
    }
  },

  async login(email, password) {
    const { data, error } = await supabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      // Verkeerde inloggegevens is geen storing: null teruggeven.
      const wrong = error.status === 400 || /invalid login/i.test(error.message)
      if (wrong) return null
      throw new Error(error.message)
    }
    if (!data.session || !data.user) return null

    // Het inlogaccount en het personeelsdossier zijn twee dingen: iemand kan
    // al op de loonlijst staan voordat er een account is. De rest van de app
    // werkt met het dossier-id, dus dat zoeken we hier op.
    const { data: profile, error: profileError } = await supabase()
      .from('profiles')
      .select('*')
      .eq('auth_id', data.user.id)
      .maybeSingle()

    if (profileError) fail('profiel ophalen', profileError)
    if (!profile) {
      throw new Error(
        'Inloggen lukte, maar er hangt geen personeelsdossier aan dit account. ' +
        'Laat het management je toevoegen met hetzelfde e-mailadres.',
      )
    }

    return {
      userId: profile.id as string,
      token: data.session.access_token,
      profile: fromRow('users', profile as Record<string, unknown>),
    }
  },

  async push(changes: PushChange[]) {
    // Per tabel bundelen scheelt netwerkrondes.
    const byTable = new Map<EntityName, PushChange[]>()
    for (const c of changes) {
      const list = byTable.get(c.entity) ?? []
      list.push(c)
      byTable.set(c.entity, list)
    }

    for (const [entity, list] of byTable) {
      const table = TABLES[entity]

      const deletes = list.filter((c) => c.op === 'delete').map((c) => c.recordId)
      if (deletes.length) {
        const { error } = await supabase().from(table).delete().in('id', deletes)
        if (error && tabelOntbreekt(error)) throw new OntbrekendeTabel(table)
        if (error) fail(`verwijderen in ${table}`, error)
      }

      const upserts = list
        .filter((c) => c.op === 'put')
        .map((c) => toRow(entity, c.payload as Record<string, unknown>))
      if (upserts.length) {
        const { error } = await supabase().from(table).upsert(upserts, { onConflict: 'id' })
        if (error && tabelOntbreekt(error)) throw new OntbrekendeTabel(table)
        if (error) fail(`opslaan in ${table}`, error)
      }
    }
  },

  async pull(since: number): Promise<PullResult> {
    const changes: PullResult['changes'] = {}

    // Parallel ophalen: zeven kleine queries in plaats van zeven wachtrondes.
    const results = await Promise.all(
      (Object.keys(TABLES) as EntityName[]).map(async (entity) => {
        const { data, error } = await supabase()
          .from(TABLES[entity])
          .select('*')
          .gt('updated_at', since)
          .order('updated_at', { ascending: true })
          .limit(2000)

        if (error && geenRechten(error)) {
          return [entity, [] as Record<string, unknown>[]] as const
        }
        if (error && tabelOntbreekt(error)) {
          if (!ontbrekendeTabellen.has(TABLES[entity])) {
            ontbrekendeTabellen.add(TABLES[entity])
            console.warn(
              `[sync] De tabel "${TABLES[entity]}" bestaat nog niet in de database. ` +
              'Draai supabase/setup.sql opnieuw. De rest van de app blijft werken.',
            )
          }
          return [entity, [] as Record<string, unknown>[]] as const
        }
        ontbrekendeTabellen.delete(TABLES[entity])
        if (error) fail(`ophalen van ${TABLES[entity]}`, error)
        return [entity, (data ?? []).map((r) => fromRow(entity, r))] as const
      }),
    )

    for (const [entity, rows] of results) {
      if (rows.length) changes[entity] = rows
    }

    // Servertijd bepaalt de volgende cursor, niet de klok van dit apparaat.
    const { data: serverNow } = await supabase().rpc('server_time_ms')
    return {
      changes,
      serverTime: typeof serverNow === 'number' ? serverNow : Date.now(),
    }
  },
}

/** Uitloggen bij Supabase; de lokale cache blijft staan. */
export async function supabaseSignOut() {
  if (supabaseConfigured) {
    try {
      await supabase().auth.signOut()
    } catch {
      /* offline uitloggen mag geen fout geven */
    }
  }
}
