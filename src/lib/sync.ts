import { create } from 'zustand'
import { api, type PushChange } from './api'
import { db, getMeta, setMeta } from './db'
import { logLive } from './trail'
import type { EntityName, OutboxRecord, SyncOp, SyncState } from './types'

/* ------------------------------------------------------------------ *
 *  Offline-first sync-engine
 *
 *  Schrijven  -> altijd eerst lokaal (Dexie) + een regel in de outbox.
 *  Verbinding -> outbox wordt op volgorde naar de server geduwd,
 *                daarna worden serverwijzigingen opgehaald.
 *  Offline    -> niets gaat verloren; de outbox blijft staan en wordt
 *                automatisch verwerkt zodra er weer verbinding is.
 * ------------------------------------------------------------------ */

export const LAST_SYNC = 'lastSyncAt'
const MAX_TRIES = 8
const BATCH = 50

/**
 * Synchroniseren heeft alleen zin met een sessie. Een echte backend geeft een
 * niet-ingelogde bezoeker terecht niets terug; zou de app dan toch de teller
 * bijwerken, dan denkt hij na het inloggen dat hij al bij is en blijft de
 * cache leeg.
 */
let enabled = true

export function setSyncEnabled(v: boolean) {
  enabled = v
  if (v) scheduleFlush(150)
}

interface SyncStore extends SyncState {
  setOnline: (v: boolean) => void
  refreshPending: () => Promise<void>
  sync: (opts?: { silent?: boolean }) => Promise<void>
}

export const useSync = create<SyncStore>((set, get) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  lastSyncAt: null,
  lastError: null,

  setOnline: (v) => set({ online: v }),

  refreshPending: async () => {
    set({ pending: await db.outbox.count() })
  },

  sync: async (opts) => {
    if (!enabled || get().syncing) return
    set({ syncing: true, lastError: opts?.silent ? get().lastError : null })
    const begin = Date.now()
    try {
      const reachable = await api.ping()
      if (!reachable) throw new Error('Geen verbinding')
      set({ online: true })

      const geduwd = await pushOutbox()
      // De server bepaalt de nieuwe cursor, niet de klok van dit apparaat.
      // Een telefoon met een verkeerd ingestelde tijd zou anders wijzigingen
      // overslaan of eindeloos opnieuw ophalen.
      const { serverTime, opgehaald } = await pullChanges()

      await setMeta(LAST_SYNC, serverTime)
      set({ lastSyncAt: serverTime, lastError: null })

      logLive('sync', `Ronde klaar — ${geduwd} verstuurd, ${opgehaald} opgehaald`, {
        duur: Date.now() - begin,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ lastError: msg, online: navigator.onLine && !msg.includes('verbinding') })
      logLive('netwerk', `Synchroniseren mislukt: ${msg}`, {
        duur: Date.now() - begin,
        detail: e instanceof Error ? e.stack : undefined,
      })
    } finally {
      set({ syncing: false })
      await get().refreshPending()
    }
  },
}))

/* ------------------------------------------------------------------ *
 *  Backendwissel
 * ------------------------------------------------------------------ */

const BACKEND_KEY = 'backend'

/**
 * Gegevens uit een andere backend mogen niet blijven rondslingeren. Wie eerst
 * met de testgegevens werkte en daarna Supabase aanzet, zou anders die
 * testklanten en -medewerkers in beeld houden.
 *
 * Geeft true terug als er iets gewist is; de sessie hoort dan ook te vervallen.
 */
export async function ensureBackendMatches(): Promise<boolean> {
  const stored = await getMeta<string | null>(BACKEND_KEY, null)
  if (stored === api.name) return false

  await Promise.all([
    db.locations.clear(), db.users.clear(), db.companies.clear(), db.washJobs.clear(),
    db.inventory.clear(), db.stockMovements.clear(), db.expenses.clear(),
    db.timeEntries.clear(), db.shifts.clear(),
    db.notifications.clear(), db.courses.clear(), db.courseProgress.clear(),
    db.assets.clear(), db.faults.clear(), db.workOrders.clear(),
    db.maintenancePlans.clear(), db.tickets.clear(),
    db.ticketMessages.clear(), db.logEvents.clear(),
    db.signups.clear(), db.channels.clear(),
    db.chatMessages.clear(), db.channelReads.clear(), db.emailLog.clear(),
    db.personnelPrivate.clear(), db.documents.clear(), db.mailbox.clear(),
    // Wijzigingen die voor een andere server bedoeld waren zijn onbruikbaar.
    db.outbox.clear(),
  ])

  await setMeta(LAST_SYNC, 0)
  await setMeta(BACKEND_KEY, api.name)
  useSync.setState({ lastSyncAt: null, pending: 0 })
  return stored !== null
}

/* ------------------------------------------------------------------ *
 *  Outbox
 * ------------------------------------------------------------------ */

export async function enqueue(
  entity: EntityName,
  op: SyncOp,
  recordId: string,
  payload: unknown,
) {
  // Nieuwere wijziging op hetzelfde record vervangt de oude (laatste wint).
  const existing = await db.outbox.where('recordId').equals(recordId).toArray()
  const stale = existing.filter((r) => r.entity === entity).map((r) => r.id!)
  if (stale.length) await db.outbox.bulkDelete(stale)

  await db.outbox.add({
    entity, op, recordId, payload,
    createdAt: Date.now(),
    tries: 0,
  })
  await useSync.getState().refreshPending()
  void scheduleFlush()
}

/**
 * De volgorde waarin tabellen naar de server gaan.
 *
 * Records verwijzen naar elkaar: een bericht hangt aan een kanaal, een
 * werkbon aan een storing, een storing aan een installatie. Komt het kind
 * eerder aan dan de ouder, dan weigert de server het -- en niet eens met een
 * duidelijke melding. De beveiligingsregel wordt namelijk eerder beoordeeld
 * dan de verwijzing, dus je krijgt te horen dat je ergens niet bij mag, over
 * iets wat er nog niet is.
 *
 * Op de volgorde van de wachtrij kun je niet bouwen: die volgt de klok, en
 * twee handelingen in dezelfde milliseconde staan in willekeurige volgorde.
 * Daarom leggen we hem hier expliciet vast: ouders eerst.
 */
export const PUSH_ORDER: EntityName[] = [
  'locations', 'companies', 'users', 'personnelPrivate',
  'channels', 'courses', 'assets',
  'washJobs', 'inventory', 'maintenancePlans', 'tickets',
  'faults', 'shifts', 'expenses', 'timeEntries', 'stockMovements',
  'workOrders', 'courseProgress', 'notifications',
  'chatMessages', 'channelReads', 'ticketMessages', 'logEvents',
  'signups', 'emailLog', 'documents', 'mailbox',
]

const RANG = new Map(PUSH_ORDER.map((e, i) => [e, i]))

async function pushOutbox(): Promise<number> {
  let totaal = 0
  for (;;) {
    const batch = await db.outbox.orderBy('createdAt').limit(BATCH).toArray()
    if (!batch.length) return totaal

    // Ouders voor kinderen. Binnen een tabel blijft de volgorde van de
    // wachtrij staan; sorteren in JavaScript is stabiel.
    const gesorteerd = [...batch].sort(
      (a, b) => (RANG.get(a.entity) ?? 99) - (RANG.get(b.entity) ?? 99))

    const changes: PushChange[] = gesorteerd.map((r) => ({
      entity: r.entity,
      op: r.op,
      recordId: r.recordId,
      payload: r.payload,
    }))

    try {
      await api.push(changes)
      await db.outbox.bulkDelete(batch.map((r) => r.id!))
      totaal += batch.length
    } catch (e) {
      /*
       * Eén record dat de server weigert mag niet de hele wachtrij
       * blokkeren. Anders staat een verkeerd chatbericht het doorzetten van
       * een rooster in de weg, en blijft dat weken hangen.
       *
       * Dus proberen we ze nu stuk voor stuk. Wat erdoor komt is weg; wat
       * blijft weigeren krijgt een teller, en gaat er na acht pogingen uit
       * met een regel in het logboek.
       */
      const mislukt = await pushPerStuk(gesorteerd)
      await useSync.getState().refreshPending()
      throw mislukt ?? e
    }
    await useSync.getState().refreshPending()
  }
}

/** Duwt elk record apart. Geeft de eerste fout terug, of null als alles lukte. */
async function pushPerStuk(batch: OutboxRecord[]): Promise<Error | null> {
  let eerste: Error | null = null

  for (const r of batch) {
    try {
      await api.push([{
        entity: r.entity, op: r.op, recordId: r.recordId, payload: r.payload,
      }])
      await db.outbox.delete(r.id!)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      eerste ??= e instanceof Error ? e : new Error(msg)

      const tries = r.tries + 1
      if (tries >= MAX_TRIES) {
        await db.outbox.delete(r.id!)
        // Zichtbaar maken dat er iets is weggegooid; anders verdwijnt een
        // wijziging zonder dat iemand het merkt.
        console.warn(
          `[sync] ${r.entity}/${r.recordId} is na ${MAX_TRIES} pogingen ` +
          `opgegeven en weggegooid. Laatste fout: ${msg}`)
        logLive('netwerk', `Opgegeven: ${r.entity}/${r.recordId}`, { detail: msg })
      } else {
        await db.outbox.update(r.id!, { tries, lastError: msg })
      }
    }
  }

  return eerste
}

/* ------------------------------------------------------------------ *
 *  Pull
 * ------------------------------------------------------------------ */

const TABLE_OF: Record<EntityName, () => any> = {
  locations: () => db.locations,
  users: () => db.users,
  companies: () => db.companies,
  washJobs: () => db.washJobs,
  inventory: () => db.inventory,
  stockMovements: () => db.stockMovements,
  expenses: () => db.expenses,
  timeEntries: () => db.timeEntries,
  shifts: () => db.shifts,
  notifications: () => db.notifications,
  courses: () => db.courses,
  courseProgress: () => db.courseProgress,
  assets: () => db.assets,
  faults: () => db.faults,
  workOrders: () => db.workOrders,
  maintenancePlans: () => db.maintenancePlans,
  tickets: () => db.tickets,
  ticketMessages: () => db.ticketMessages,
  logEvents: () => db.logEvents,
  signups: () => db.signups,
  channels: () => db.channels,
  chatMessages: () => db.chatMessages,
  channelReads: () => db.channelReads,
  emailLog: () => db.emailLog,
  personnelPrivate: () => db.personnelPrivate,
  documents: () => db.documents,
  mailbox: () => db.mailbox,
}

async function pullChanges(): Promise<{ serverTime: number; opgehaald: number }> {
  const since = await getMeta<number>(LAST_SYNC, 0)
  const result = await api.pull(since)
  let opgehaald = 0

  // Records die nog in de outbox staan niet overschrijven: lokaal is nieuwer.
  const queued = new Set((await db.outbox.toArray()).map((r) => r.entity + ':' + r.recordId))

  for (const [entity, rows] of Object.entries(result.changes) as [EntityName, any[]][]) {
    if (!rows?.length) continue
    const keep = rows.filter((r) => !queued.has(entity + ':' + r.id))
    if (keep.length) {
      await TABLE_OF[entity]().bulkPut(keep)
      opgehaald += keep.length
      logLive('sync', `${keep.length}x ${entity} opgehaald`)
    }
  }

  return { serverTime: result.serverTime, opgehaald }
}

/* ------------------------------------------------------------------ *
 *  Automatiek
 * ------------------------------------------------------------------ */

let flushTimer: ReturnType<typeof setTimeout> | null = null

/** Kort uitgesteld synchroniseren, zodat snel achter elkaar bewerken
 *  niet tien keer een netwerkronde veroorzaakt. */
export function scheduleFlush(delay = 1200) {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (useSync.getState().online) void useSync.getState().sync({ silent: true })
  }, delay)
}

/* ------------------------------------------------------------------ *
 *  Sneller kijken tijdens een gesprek
 *
 *  Drie kwartier wachten op het antwoord van een collega is geen overleg.
 *  Zolang het overlegscherm openstaat kijken we daarom elke paar seconden,
 *  en daarna weer rustig. Het blijft dezelfde synchronisatie -- er komt
 *  geen tweede verbinding bij.
 * ------------------------------------------------------------------ */

const IDLE_POLL = 45_000
const CHAT_POLL = 5_000

let pollMs = IDLE_POLL
let pollTimer: ReturnType<typeof setInterval> | null = null
let fastCount = 0

function restartPoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (useSync.getState().online) void useSync.getState().sync({ silent: true })
  }, pollMs)
}

/**
 * Zet het snelle ritme aan of uit. Meerdere schermen kunnen erom vragen;
 * pas als de laatste hem loslaat gaat het terug naar het rustige ritme.
 */
export function setFastSync(on: boolean) {
  fastCount = Math.max(0, fastCount + (on ? 1 : -1))
  const wanted = fastCount > 0 ? CHAT_POLL : IDLE_POLL
  if (wanted === pollMs) return
  pollMs = wanted
  if (pollTimer) restartPoll()
}

let started = false

export function startSyncEngine() {
  if (started) return
  started = true

  const goOnline = () => {
    useSync.getState().setOnline(true)
    void useSync.getState().sync({ silent: true })
  }
  const goOffline = () => useSync.getState().setOnline(false)

  window.addEventListener('online', goOnline)
  window.addEventListener('offline', goOffline)

  // Periodiek: haalt ook wijzigingen van andere gebruikers binnen.
  restartPoll()

  // Terug in beeld -> direct bijwerken
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && useSync.getState().online) {
      void useSync.getState().sync({ silent: true })
    }
  })

  void (async () => {
    const last = await getMeta<number | null>(LAST_SYNC, null)
    useSync.setState({ lastSyncAt: last })
    await useSync.getState().refreshPending()
    await useSync.getState().sync({ silent: true })
  })()
}
