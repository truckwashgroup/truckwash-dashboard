import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, Briefcase, Bug, Building2, CalendarDays, CalendarRange,
  ClipboardList, FileText, FolderLock, GraduationCap, Hash, Inbox,
  LayoutDashboard, LayoutGrid, Loader2, Mail, MapPin, MessageSquare, Mic,
  MicOff, Package, Radio, Receipt, ScrollText, Search, Server, Settings, Timer,
  Truck, Users, Wrench, X,
} from 'lucide-react'
import { db } from '../lib/db'
import {
  AGENDA_SOORTEN, ASSET_CATEGORIES, DOCUMENT_KINDS, KOPPELING_STATUS, SERVICES,
  WERKGEVER_STATUS, type Permission, type Role,
} from '../lib/types'
import { money, time } from '../lib/format'
import { mayRead } from '../lib/chat'
import { useAuth } from '../store/useAuth'
import { usePerms, useNav } from '../store/useNav'
import {
  cleanSpokenQuery, listenOnce, voiceAvailability, voiceSupported,
  voiceUnavailableReason, type VoiceSession,
} from '../lib/voice'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Zoeken door de hele app
 *
 *  Veiligheid: er wordt niets uitgevoerd wat een gebruiker typt. De zoekterm
 *  gaat als gewone tekst naar een vergelijking op de lokale database -- geen
 *  query-taal, geen reguliere expressie uit invoer, geen HTML. React zet
 *  tekst altijd als tekst neer, dus scripts in een zoekterm of in een
 *  klantnaam blijven letterlijk zichtbaar in plaats van uitgevoerd te worden.
 *
 *  Verder een lengtelimiet en een wachttijd, zodat niemand met een enorme
 *  invoer de app kan laten vastlopen.
 * ------------------------------------------------------------------ */

const MAX_QUERY = 64
const MAX_PER_GROUP = 5
const DEBOUNCE_MS = 180

/* ------------------------------------------------------------------ *
 *  De schermen zelf
 *
 *  Wie de weg niet kent typt de naam van wat hij zoekt, niet die van een
 *  record. "Post", "voorraad", "rooster" -- dat hoort je naar dat scherm te
 *  brengen. Onder `ook` staan de woorden waarmee mensen het óók noemen.
 * ------------------------------------------------------------------ */

interface Scherm {
  page: string
  label: string
  hint: string
  icon: typeof Truck
  recht?: Permission
  /** Sommige schermen bestaan alleen in één dashboard. */
  rol?: Role
  ook?: string[]
}

const SCHERMEN: Scherm[] = [
  { page: 'start',      label: 'Start',        hint: 'Het tegeloverzicht van je dashboard', icon: LayoutGrid, ook: ['home', 'begin', 'tegels'] },
  { page: 'vandaag',    label: 'Vandaag',      hint: 'Wasopdrachten en wachtrij',       icon: Truck,           recht: 'jobs.view', ook: ['wachtrij', 'wasbeurten'] },
  { page: 'planning',   label: 'Planning',     hint: 'Alle wasopdrachten',              icon: CalendarRange,   recht: 'planning.view' },
  { page: 'rooster',    label: 'Rooster',      hint: 'Wanneer je bent ingeroosterd',    icon: CalendarDays,    recht: 'roster.viewOwn', ook: ['diensten', 'werktijden'] },
  { page: 'uren',       label: 'Uren',         hint: 'In- en uitklokken',               icon: Timer,           recht: 'hours.own', ook: ['tijd', 'klok'] },
  { page: 'materiaal',  label: 'Materiaal',    hint: 'Voorraad en verbruik',            icon: Package,         recht: 'inventory.view', ook: ['voorraad', 'chemie'] },
  { page: 'kosten',     label: 'Kosten',       hint: 'Bonnen indienen',                 icon: Receipt,         recht: 'expenses.submit', ook: ['bon', 'declaratie'] },
  { page: 'financieel', label: 'Financieel',   hint: 'Kosten valideren en resultaat',   icon: Receipt,         recht: 'finance.view', ook: ['omzet', 'marge', 'bonnen'] },
  { page: 'overzicht',  label: 'Overzicht',    hint: 'Cijfers en grafieken',            icon: LayoutDashboard, ook: ['kpi', 'cijfers'] },
  { page: 'personeel',  label: 'Personeel',    hint: 'Dossiers, rechten en vestigingen', icon: Users,          recht: 'staff.view', ook: ['medewerkers', 'dossier'] },
  { page: 'aanmeldingen', label: 'Aanmeldingen', hint: 'Wie zich heeft aangemeld',      icon: Inbox,           recht: 'signups.view' },
  { page: 'dossier',    label: 'Mijn dossier', hint: 'Je contract en documenten',       icon: FolderLock,      ook: ['contract', 'documenten', 'loonstrook'] },
  { page: 'techniek',   label: 'Techniek',     hint: 'Storingen, onderhoud, werkbonnen', icon: Wrench,         recht: 'faults.view' },
  { page: 'storingen',  label: 'Storingen',    hint: 'Meldingen beoordelen',            icon: AlertTriangle,   recht: 'faults.view', ook: ['defect', 'kapot'] },
  { page: 'werkbonnen', label: 'Werkbonnen',   hint: 'Het werk zelf',                   icon: ClipboardList,   recht: 'workorders.view' },
  { page: 'installaties', label: 'Installaties', hint: 'Machinepark en QR-labels',      icon: Wrench,          recht: 'assets.view', ook: ['machines', 'apparaten'] },
  { page: 'onderhoud',  label: 'Onderhoud',    hint: 'Schema’s en beurten',             icon: CalendarRange,   recht: 'maintenance.view' },
  { page: 'opleiding',  label: 'Opleiding',    hint: 'Cursussen en certificaten',       icon: GraduationCap,   recht: 'learning.take', ook: ['cursus', 'elearning', 'veiligheid'] },
  { page: 'overleg',    label: 'Overleg',      hint: 'Kanalen en gesprekken',           icon: MessageSquare,   recht: 'chat.use', ook: ['chat', 'berichten', 'kanaal'] },
  { page: 'tickets',    label: 'Meldingen',    hint: 'Wat gebruikers tegenkomen',       icon: Bug,             recht: 'dev.tickets' },
  { page: 'logboek',    label: 'Logboek',      hint: 'Fouten en waarschuwingen',        icon: ScrollText,      recht: 'dev.logs', ook: ['errors', 'fouten'] },
  { page: 'meekijken',  label: 'Meekijken',    hint: 'Alles wat er nu gebeurt',         icon: Radio,           recht: 'dev.logs', ook: ['live', 'monitor'] },
  { page: 'post',       label: 'Post',         hint: 'Wat er via Resend is verstuurd',  icon: Mail,            recht: 'dev.logs', ook: ['mail', 'email', 'resend'] },
  { page: 'systeem',    label: 'Systeem',      hint: 'Versies, verbinding en opslag',   icon: Server,          recht: 'dev.logs' },
  { page: 'beheer',     label: 'Beheer',       hint: 'Vestigingen, klanten, instellingen', icon: Settings,     recht: 'admin.settings', ook: ['locaties', 'instellingen'] },
  { page: 'postbus',    label: 'Postbus',      hint: 'Wat er binnenkomt op het mailadres', icon: Inbox,        recht: 'mail.read', ook: ['post', 'mail', 'email', 'facturen', 'bijlagen'] },
  { page: 'agenda',     label: 'Agenda',       hint: 'Afspraken, verjaardagen en jubilea', icon: CalendarDays, recht: 'agenda.view', ook: ['kalender', 'afspraak', 'verjaardag'] },
  { page: 'werkgevers', label: 'Werkgevers',   hint: 'Bedrijven waarvan de chauffeurs hier wassen', icon: Briefcase, recht: 'employer.view', ook: ['bedrijven', 'transporteur', 'chauffeurs'] },
  { page: 'beurten',    label: 'Wasbeurten',   hint: 'Wat er op naam van je bedrijf staat', icon: Truck,      rol: 'employer' },
  { page: 'chauffeurs', label: 'Chauffeurs',   hint: 'Wie er namens je bedrijf komt wassen', icon: Users,     rol: 'employer', recht: 'employer.staff' },
  { page: 'afspraken',  label: 'Afspraken',    hint: 'Wat er per wagen wel en niet mag',  icon: ClipboardList, rol: 'employer', recht: 'employer.rules' },
]

type Hit = {
  id: string
  group: string
  icon: typeof Truck
  title: string
  subtitle: string
  right?: string
  page: string
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const [listening, setListening] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const session = useRef<VoiceSession | null>(null)

  const perms = usePerms()
  const me = useAuth((s) => s.user)
  const rol = useAuth((s) => s.role)
  const goto = useNav((s) => s.goto)
  const searchRequest = useNav((s) => s.searchRequest)
  const clearSearchRequest = useNav((s) => s.clearSearchRequest)

  /* ---- openen met Ctrl+K, sluiten met Escape ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Van elders geopend: via de knop in de balk of de microfoon ernaast
  useEffect(() => {
    if (!searchRequest) return
    setOpen(true)
    if (searchRequest.voice) setTimeout(() => startListening(), 120)
    clearSearchRequest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRequest?.nonce])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40)
    else {
      setQuery('')
      setHits([])
      stopListening()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* ---- wachten tot het typen even stilvalt ---- */
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  /* ---- zoeken ---- */
  useEffect(() => {
    let cancelled = false
    const needle = debounced.toLowerCase()

    if (needle.length < 2) {
      setHits([])
      setBusy(false)
      return
    }

    setBusy(true)
    ;(async () => {
      const found: Hit[] = []
      const has = (...velden: unknown[]) =>
        velden.some((v) => String(v ?? '').toLowerCase().includes(needle))

      /**
       * Elke bron levert hoogstens vijf treffers. Zonder die rem duwt één
       * veelvoorkomend woord alle andere soorten uit beeld -- en juist het
       * overzicht is waar je voor komt.
       */
      const voegToe = (groep: string, maak: () => Hit) => {
        if (found.filter((h) => h.group === groep).length >= MAX_PER_GROUP) return false
        found.push(maak())
        return true
      }

      /* ---------------------------------------------------------------- *
       *  Schermen
       *
       *  Zoeken op "post" of "voorraad" hoort je naar dat scherm te brengen.
       *  Wie de weg niet kent typt de naam van wat hij zoekt, niet die van
       *  een record.
       * ---------------------------------------------------------------- */

      for (const scherm of SCHERMEN) {
        if (scherm.rol && scherm.rol !== rol) continue
        if (scherm.recht && !perms.can(scherm.recht)) continue
        if (!has(scherm.label, scherm.hint, scherm.ook?.join(' '))) continue
        voegToe('Schermen', () => ({
          id: 'nav:' + scherm.page,
          group: 'Schermen',
          icon: scherm.icon,
          title: scherm.label,
          subtitle: scherm.hint,
          page: scherm.page,
        }))
      }

      /* ------------------------------ Werk ---------------------------- */

      if (perms.can('jobs.view')) {
        for (const j of await db.washJobs.toArray()) {
          if (!has(j.plate, j.ticket, j.companyName, j.assignedName)) continue
          if (!voegToe('Wasbeurten', () => ({
            id: 'job:' + j.id,
            group: 'Wasbeurten',
            icon: Truck,
            title: j.plate,
            subtitle: `${j.companyName} · ${SERVICES[j.service].label} · ${j.status}`,
            right: time(j.scheduledAt),
            page: perms.can('planning.view') ? 'planning' : 'vandaag',
          }))) break
        }
      }

      if (perms.can('customers.view')) {
        for (const c of await db.companies.toArray()) {
          if (!has(c.name, c.city, c.contact, c.email)) continue
          if (!voegToe('Klanten', () => ({
            id: 'co:' + c.id,
            group: 'Klanten',
            icon: Building2,
            title: c.name,
            subtitle: `${c.contact} · ${c.city}`,
            right: c.contractDiscountPct ? `${c.contractDiscountPct}% korting` : undefined,
            page: 'klanten',
          }))) break
        }
      }

      if (perms.can('staff.view')) {
        for (const u of await db.users.toArray()) {
          if (!has(u.name, u.email, u.personnelNumber, u.function)) continue
          if (!voegToe('Medewerkers', () => ({
            id: 'user:' + u.id,
            group: 'Medewerkers',
            icon: Users,
            title: u.name,
            subtitle: [u.personnelNumber, u.function].filter(Boolean).join(' · ') || u.email,
            right: u.active ? undefined : 'inactief',
            page: 'personeel',
          }))) break
        }
      }

      if (perms.can('inventory.view')) {
        for (const i of await db.inventory.toArray()) {
          if (!has(i.name, i.supplier)) continue
          if (!voegToe('Voorraad', () => ({
            id: 'inv:' + i.id,
            group: 'Voorraad',
            icon: Package,
            title: i.name,
            subtitle: `${i.supplier} · ${i.stock} ${i.unit} op voorraad`,
            right: money(i.pricePerUnit),
            page: 'materiaal',
          }))) break
        }
      }

      if (perms.can('learning.take')) {
        for (const c of await db.courses.toArray()) {
          if (!has(c.title, c.summary, c.code)) continue
          if (!voegToe('Cursussen', () => ({
            id: 'crs:' + c.id,
            group: 'Cursussen',
            icon: GraduationCap,
            title: c.title,
            subtitle: `${c.code} · ${c.estimatedMinutes} min`,
            page: 'opleiding',
          }))) break
        }
      }

      /* --------------------------- Vestigingen ------------------------ */

      if (perms.can('locations.view')) {
        for (const l of await db.locations.toArray()) {
          if (!has(l.name, l.code, l.city, l.address)) continue
          if (!voegToe('Vestigingen', () => ({
            id: 'loc:' + l.id,
            group: 'Vestigingen',
            icon: MapPin,
            title: l.name,
            subtitle: `${l.code} · ${l.address}, ${l.city}`,
            right: l.bays ? `${l.bays} banen` : undefined,
            page: 'beheer',
          }))) break
        }
      }

      /* ---------------------------- Techniek -------------------------- */

      if (perms.can('assets.view')) {
        for (const a of await db.assets.toArray()) {
          if (!has(a.name, a.code, a.brand, a.model, a.serialNumber)) continue
          if (!voegToe('Installaties', () => ({
            id: 'asset:' + a.id,
            group: 'Installaties',
            icon: Wrench,
            title: a.name,
            subtitle: `${a.code} · ${ASSET_CATEGORIES[a.category]}`,
            right: a.status,
            page: 'installaties',
          }))) break
        }
      }

      if (perms.can('faults.view')) {
        for (const f of await db.faults.toArray()) {
          if (!has(f.title, f.number, f.assetName, f.description)) continue
          if (!voegToe('Storingen', () => ({
            id: 'fault:' + f.id,
            group: 'Storingen',
            icon: AlertTriangle,
            title: f.title,
            subtitle: `${f.number} · ${f.assetName ?? 'geen installatie'} · ${f.status}`,
            right: f.severity,
            page: 'storingen',
          }))) break
        }
      }

      if (perms.can('workorders.view')) {
        for (const w of await db.workOrders.toArray()) {
          if (!has(w.title, w.number, w.assetName, w.assignedName)) continue
          if (!voegToe('Werkbonnen', () => ({
            id: 'wo:' + w.id,
            group: 'Werkbonnen',
            icon: ClipboardList,
            title: w.title,
            subtitle: `${w.number} · ${w.assignedName ?? 'niet toegewezen'}`,
            right: w.status,
            page: 'werkbonnen',
          }))) break
        }
      }

      /* ----------------------------- Kosten --------------------------- */

      if (perms.canAny('expenses.viewTeam', 'expenses.approve', 'finance.view')) {
        for (const e of await db.expenses.toArray()) {
          if (!has(e.description, e.supplier, e.submittedByName)) continue
          if (!voegToe('Kosten', () => ({
            id: 'exp:' + e.id,
            group: 'Kosten',
            icon: Receipt,
            title: e.description || e.supplier,
            subtitle: `${e.supplier} · ${e.submittedByName} · ${e.status}`,
            right: money(e.amountExcl),
            page: 'financieel',
          }))) break
        }
      }

      /* ---------------------------- Overleg --------------------------- */

      if (perms.can('chat.use')) {
        const kanalen = await db.channels.toArray()
        const zichtbaar = kanalen.filter((c) => mayRead(me, c))

        for (const c of zichtbaar) {
          if (!has(c.name, c.topic)) continue
          if (!voegToe('Kanalen', () => ({
            id: 'ch:' + c.id,
            group: 'Kanalen',
            icon: Hash,
            title: c.name,
            subtitle: c.topic ?? 'Overleg',
            page: 'overleg',
          }))) break
        }

        // Alleen zoeken in kanalen waar je bij mag; de rest bestaat voor jou niet.
        const toegestaan = new Set(zichtbaar.map((c) => c.id))
        const berichten = (await db.chatMessages.toArray())
          .filter((m) => !m.deletedAt && toegestaan.has(m.channelId))
          .sort((a, b) => b.at - a.at)

        for (const m of berichten) {
          if (!has(m.body, m.authorName)) continue
          const kanaal = zichtbaar.find((c) => c.id === m.channelId)
          if (!voegToe('Berichten', () => ({
            id: 'cm:' + m.id,
            group: 'Berichten',
            icon: MessageSquare,
            title: m.body.slice(0, 70),
            subtitle: `${m.authorName} in ${kanaal?.name ?? 'overleg'}`,
            right: time(m.at),
            page: 'overleg',
          }))) break
        }
      }

      /* --------------------------- Meldingen -------------------------- */

      for (const t of await db.tickets.toArray()) {
        const vanMij = t.reportedBy === me?.id
        if (!vanMij && !perms.can('dev.tickets')) continue
        if (!has(t.title, t.number, t.description)) continue
        if (!voegToe('Meldingen', () => ({
          id: 'tk:' + t.id,
          group: 'Meldingen',
          icon: Bug,
          title: t.title,
          subtitle: `${t.number} · ${t.reportedByName} · ${t.status}`,
          right: t.priority,
          page: perms.can('dev.tickets') ? 'tickets' : 'meldingen',
        }))) break
      }

      /* -------------------------- Aanmeldingen ------------------------ */

      if (perms.can('signups.view')) {
        for (const a of await db.signups.toArray()) {
          if (!has(a.name, a.email, a.companyName)) continue
          if (!voegToe('Aanmeldingen', () => ({
            id: 'sg:' + a.id,
            group: 'Aanmeldingen',
            icon: Inbox,
            title: a.name,
            subtitle: `${a.email} · ${a.kind}`,
            right: a.status,
            page: 'aanmeldingen',
          }))) break
        }
      }

      /* --------------------------- Documenten ------------------------- */

      for (const d of await db.documents.toArray()) {
        // De database geeft je alleen wat je mag zien, maar dubbel op slot
        // is hier op zijn plaats: een dossierstuk is geen wasbeurt.
        const vanMij = d.userId === me?.id && d.visibleToEmployee
        if (!vanMij && !perms.can('staff.view')) continue
        if (!has(d.title, d.userName, d.description)) continue
        if (!voegToe('Documenten', () => ({
          id: 'doc:' + d.id,
          group: 'Documenten',
          icon: FileText,
          title: d.title,
          subtitle: `${DOCUMENT_KINDS[d.kind].label} · ${d.userName}`,
          right: d.signedAt ? 'ondertekend' : d.requiresSignature ? 'te tekenen' : undefined,
          page: vanMij && !perms.can('staff.view') ? 'dossier' : 'personeel',
        }))) break
      }

      /* --------------------------- Werkgevers ------------------------- */

      if (perms.can('employer.view')) {
        for (const w of await db.employers.toArray()) {
          if (!has(w.naam, w.contactNaam, w.email, w.plaats, w.kvk)) continue
          if (!voegToe('Werkgevers', () => ({
            id: 'wg:' + w.id,
            group: 'Werkgevers',
            icon: Briefcase,
            title: w.naam,
            subtitle: [w.contactNaam, w.plaats].filter(Boolean).join(' · '),
            right: WERKGEVER_STATUS[w.status].label,
            page: rol === 'employer' ? 'start' : 'werkgevers',
          }))) break
        }

        for (const k of await db.employerLinks.toArray()) {
          if (!has(k.naam, k.email, k.werkgeverNaam, ...k.kentekens)) continue
          if (!voegToe('Chauffeurs', () => ({
            id: 'wgk:' + k.id,
            group: 'Chauffeurs',
            icon: Users,
            title: k.naam,
            subtitle: `${k.werkgeverNaam}${k.kentekens.length ? ' · ' + k.kentekens.join(', ') : ''}`,
            right: KOPPELING_STATUS[k.status].label,
            page: rol === 'employer' ? 'chauffeurs' : 'werkgevers',
          }))) break
        }
      }

      /* ---------------------------- Postbus --------------------------- */

      if (perms.can('mail.read')) {
        for (const m of await db.mailbox.toArray()) {
          if (!has(m.onderwerp, m.van, m.vanNaam, ...m.attachments.map((b) => b.naam))) continue
          if (!voegToe('Postbus', () => ({
            id: 'mb:' + m.id,
            group: 'Postbus',
            icon: Inbox,
            title: m.onderwerp || '(geen onderwerp)',
            subtitle: `${m.vanNaam ?? m.van}${m.attachments.length ? ` · ${m.attachments.length} bijlage${m.attachments.length === 1 ? '' : 'n'}` : ''}`,
            right: m.status,
            page: 'postbus',
          }))) break
        }
      }

      /* ----------------------------- Agenda --------------------------- */

      if (perms.can('agenda.view')) {
        for (const a of await db.agendaItems.toArray()) {
          if (!has(a.title, a.description, a.createdByName)) continue
          if (!voegToe('Agenda', () => ({
            id: 'ag:' + a.id,
            group: 'Agenda',
            icon: CalendarDays,
            title: a.title,
            subtitle: `${AGENDA_SOORTEN[a.soort]?.label ?? a.soort} · ${a.createdByName}`,
            right: time(a.startAt),
            page: 'agenda',
          }))) break
        }
      }

      /* ------------------------------ Post ---------------------------- */

      if (perms.canAny('dev.logs', 'admin.audit')) {
        for (const e of await db.emailLog.toArray()) {
          if (!has(e.subject, e.toEmail, e.template)) continue
          if (!voegToe('Post', () => ({
            id: 'em:' + e.id,
            group: 'Post',
            icon: Mail,
            title: e.subject,
            subtitle: `${e.toEmail} · ${e.status}`,
            right: time(e.at),
            page: 'post',
          }))) break
        }
      }

      if (!cancelled) {
        setHits(found)
        setActive(0)
        setBusy(false)
      }
    })()

    return () => { cancelled = true }
  }, [debounced, perms, me, rol])

  const grouped = useMemo(() => {
    const map = new Map<string, Hit[]>()
    for (const h of hits) {
      const list = map.get(h.group) ?? []
      list.push(h)
      map.set(h.group, list)
    }
    return [...map.entries()]
  }, [hits])

  /* ---- spraak ---- */

  function stopListening() {
    session.current?.stop()
    session.current = null
    setListening(false)
  }

  function startListening() {
    if (listening) return stopListening()
    setListening(true)
    session.current = listenOnce({
      onPartial: (text) => setQuery(text.slice(0, MAX_QUERY)),
      onFinal: (text) => {
        const cleaned = cleanSpokenQuery(text).slice(0, MAX_QUERY)
        setQuery(cleaned)
        setDebounced(cleaned)
      },
      onError: (message) => { toast.warn(message); stopListening() },
      onEnd: () => setListening(false),
    })
    if (!session.current) setListening(false)
  }

  function pick(hit: Hit) {
    goto(hit.page, { query: debounced, id: hit.id.split(':')[1] })
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]) }
  }

  let index = -1

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="search-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
            >
              <motion.div
                className="search-panel"
                initial={{ opacity: 0, y: -14, scale: .98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: .98 }}
                transition={{ duration: .16 }}
              >
                <div className="search-input-row">
                  <Search size={17} color="var(--text-3)" />
                  <input
                    ref={inputRef}
                    value={query}
                    maxLength={MAX_QUERY}
                    onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY))}
                    onKeyDown={onKeyDown}
                    placeholder="Kenteken, klant, medewerker, artikel of cursus"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {busy && <Loader2 size={15} className="spin" color="var(--text-3)" />}
                  <button
                    className={`search-mic ${listening ? 'on' : ''} ${voiceSupported() ? '' : 'off'}`}
                    onClick={() => voiceSupported() ? startListening() : toast.info(voiceUnavailableReason())}
                    title={
                      voiceSupported()
                        ? listening ? 'Stoppen met luisteren' : 'Zoeken met je stem'
                        : voiceUnavailableReason()
                    }
                  >
                    {listening ? <MicOff size={16} /> : <Mic size={16} />}
                  </button>
                  <button className="btn ghost sm" onClick={() => setOpen(false)}>
                    <X size={15} />
                  </button>
                </div>

                {listening && (
                  <div className="search-listening">
                    <span className="pulse" /> Luisteren… zeg bijvoorbeeld “zoek 12-BND-4”
                  </div>
                )}

                <div className="search-results">
                  {debounced.length >= 2 && hits.length === 0 && !busy && (
                    <div className="search-empty">
                      Niets gevonden voor <strong>{debounced}</strong>
                    </div>
                  )}

                  {debounced.length < 2 && !listening && (
                    <div className="search-hint">
                      <div><CalendarRange size={14} /> Typ minstens twee tekens</div>
                      {voiceSupported()
                        ? <div><Mic size={14} /> Of klik op de microfoon en zeg “zoek 12-BND-4”</div>
                        : <div style={{ color: 'var(--warn)' }}>{voiceUnavailableReason()}</div>}
                      <div>Doorzoekt alleen waar jij bij mag</div>
                    </div>
                  )}

                  {grouped.map(([group, items]) => (
                    <div key={group} className="search-group">
                      <div className="search-group-head">{group}</div>
                      {items.map((h) => {
                        index++
                        const isActive = index === active
                        const Icon = h.icon
                        return (
                          <button
                            key={h.id}
                            className={`search-hit ${isActive ? 'active' : ''}`}
                            onMouseEnter={() => setActive(hits.indexOf(h))}
                            onClick={() => pick(h)}
                          >
                            <Icon size={16} />
                            <div className="text">
                              <div className="t">{h.title}</div>
                              <div className="s">{h.subtitle}</div>
                            </div>
                            {h.right && <span className="r mono">{h.right}</span>}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
