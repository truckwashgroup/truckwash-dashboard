import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarCheck, CalendarDays, FolderLock, GraduationCap, LayoutGrid,
  MessageSquare, Package, Receipt, Timer,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { db } from '../../lib/db'
import { dateFull, duration } from '../../lib/format'
import { startOfDay } from '../../lib/analytics'
import Vandaag from './Vandaag'
import Uren from './Uren'
import Materiaal from './Materiaal'
import KostenIndienen from './KostenIndienen'
import MijnRooster from './MijnRooster'
import Opleiding from '../../components/Opleiding'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import Dossier from '../../components/Dossier'
import { Start, type Tegel } from '../../components/Tegels'
import { useNavTarget, usePerms } from '../../store/useNav'
import { useAuth } from '../../store/useAuth'
import { COURSES } from '../../lib/courses'
import { weekStart } from '../../lib/roster'
import type {
  CourseProgress, Expense, InventoryItem, PersonnelDocument, Shift, TimeEntry,
} from '../../lib/types'

const DAY = 86_400_000

const TITLES: Record<string, { title: string; subtitle: string }> = {
  start: { title: 'Start', subtitle: 'Waar wil je heen?' },
  vandaag: { title: 'Vandaag', subtitle: 'Wasopdrachten en wachtrij' },
  rooster: { title: 'Mijn rooster', subtitle: 'Wanneer je bent ingeroosterd' },
  uren: { title: 'Mijn uren', subtitle: 'Tijdregistratie' },
  materiaal: { title: 'Materiaal', subtitle: 'Voorraad en verbruik' },
  kosten: { title: 'Kosten', subtitle: 'Bonnen indienen ter goedkeuring' },
  opleiding: { title: 'Opleiding', subtitle: 'Cursussen en certificaten' },
  overleg: { title: 'Overleg', subtitle: 'Kanalen en gesprekken met collega’s' },
  dossier: { title: 'Mijn dossier', subtitle: 'Je gegevens, contracten en documenten' },
}

export default function EmployeeDashboard() {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [page, setPage] = useState('start')

  const openCount = useLiveQuery(
    async () => {
      const from = startOfDay(Date.now())
      const rows = await db.washJobs.where('scheduledAt').between(from, from + DAY, true, false).toArray()
      return rows.filter((j) => j.status === 'wachtrij' || j.status === 'gepland').length
    },
    [],
    0,
  )

  const shifts = useLiveQuery(
    () => db.shifts.where('userId').equals(me.id).toArray(), [me.id], [] as Shift[])
  const entries = useLiveQuery(
    () => db.timeEntries.where('userId').equals(me.id).toArray(), [me.id], [] as TimeEntry[])
  const voorraad = useLiveQuery(() => db.inventory.toArray(), [], [] as InventoryItem[])
  const bonnen = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const voortgang = useLiveQuery(
    () => db.courseProgress.where('userId').equals(me.id).toArray(), [me.id], [] as CourseProgress[])
  const mijnDocs = useLiveQuery(
    () => db.documents.where('userId').equals(me.id).toArray(), [me.id], [] as PersonnelDocument[])
  const ongelezen = useOverlegTeller()

  const cijfers = useMemo(() => {
    const week = weekStart(Date.now())
    const diensten = shifts.filter(
      (s) => s.kind === 'dienst' && s.startAt >= week && s.startAt < week + 7 * DAY).length

    const gewerkt = entries
      .filter((e) => e.start >= week && e.end)
      .reduce((a, e) => a + (e.end! - e.start), 0)
    const loopt = entries.some((e) => !e.end)

    const laag = voorraad.filter(
      (i) => (!me.locationId || i.locationId === me.locationId) && i.stock <= i.minStock).length

    const mijnBonnen = bonnen.filter((b) => b.submittedBy === me.id)
    const openBonnen = mijnBonnen.filter((b) => b.status === 'open').length
    const afgekeurd = mijnBonnen.filter((b) => b.status === 'afgekeurd').length

    const verplicht = COURSES.filter((c) => c.requiredFor.some((r) => me.roles.includes(r)))
    const teDoen = verplicht.filter(
      (c) => !voortgang.some((p) => p.courseId === c.id && p.passed)).length

    // Wat er in het dossier op mijn handtekening wacht.
    const teTekenen = mijnDocs.filter(
      (d) => d.requiresSignature && !d.signedAt && !d.declinedAt).length

    return { diensten, gewerkt, loopt, laag, openBonnen, afgekeurd, teDoen, teTekenen }
  }, [shifts, entries, voorraad, bonnen, voortgang, mijnDocs, me])

  const items: NavItem[] = [
    { key: 'start', label: 'Start', icon: LayoutGrid },
    { key: 'vandaag', label: 'Vandaag', icon: CalendarCheck, badge: openCount || undefined },
    { key: 'rooster', label: 'Rooster', icon: CalendarDays },
    { key: 'uren', label: 'Mijn uren', icon: Timer },
    { key: 'materiaal', label: 'Materiaal', icon: Package },
    { key: 'kosten', label: 'Kosten', icon: Receipt },
    { key: 'opleiding', label: 'Opleiding', icon: GraduationCap },
    { key: 'dossier', label: 'Mijn dossier', icon: FolderLock, badge: cijfers.teTekenen || undefined },
    ...(perms.can('chat.use')
      ? [{ key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen || undefined }]
      : []),
  ]

  useNavTarget(items.map((i) => i.key), (p) => setPage(p))

  const meta = TITLES[page] ?? TITLES.start

  const tegels: Tegel[] = [
    {
      key: 'vandaag',
      label: 'Vandaag',
      hint: 'De wagens die vandaag door de straat moeten',
      icon: CalendarCheck,
      tint: 'brand',
      stat: openCount,
      statLabel: openCount === 1 ? 'wagen open' : 'wagens open',
      urgent: openCount > 6,
      onClick: () => setPage('vandaag'),
    },
    {
      key: 'uren',
      label: 'Mijn uren',
      hint: cijfers.loopt ? 'Je klok loopt nu' : 'In- en uitklokken',
      icon: Timer,
      tint: cijfers.loopt ? 'ok' : 'info',
      stat: duration(cijfers.gewerkt),
      statLabel: 'deze week',
      onClick: () => setPage('uren'),
    },
    {
      key: 'rooster',
      label: 'Mijn rooster',
      hint: 'Wanneer je staat ingeroosterd',
      icon: CalendarDays,
      tint: 'info',
      stat: cijfers.diensten,
      statLabel: 'diensten deze week',
      onClick: () => setPage('rooster'),
    },
    {
      key: 'kosten',
      label: 'Kosten',
      hint: 'Bonnen indienen en volgen',
      icon: Receipt,
      tint: cijfers.afgekeurd ? 'danger' : 'neutraal',
      stat: cijfers.afgekeurd || cijfers.openBonnen,
      statLabel: cijfers.afgekeurd ? 'afgekeurd' : 'wacht op akkoord',
      urgent: cijfers.afgekeurd > 0,
      onClick: () => setPage('kosten'),
    },
    {
      key: 'materiaal',
      label: 'Materiaal',
      hint: 'Verbruik boeken en standen zien',
      icon: Package,
      tint: cijfers.laag ? 'warn' : 'neutraal',
      stat: cijfers.laag,
      statLabel: 'onder het minimum',
      urgent: cijfers.laag > 0,
      onClick: () => setPage('materiaal'),
    },
    {
      key: 'opleiding',
      label: 'Opleiding',
      hint: 'Veiligheid, chemie en werkwijze',
      icon: GraduationCap,
      tint: cijfers.teDoen ? 'oranje' : 'ok',
      stat: cijfers.teDoen,
      statLabel: cijfers.teDoen ? 'nog te doen' : 'alles behaald',
      urgent: cijfers.teDoen > 0,
      onClick: () => setPage('opleiding'),
    },
    {
      key: 'dossier',
      label: 'Mijn dossier',
      hint: 'Je contract, je gegevens en wat er nog getekend moet',
      icon: FolderLock,
      tint: cijfers.teTekenen ? 'warn' : 'neutraal',
      stat: cijfers.teTekenen,
      statLabel: cijfers.teTekenen === 1 ? 'wacht op je handtekening' : 'wachten op je handtekening',
      urgent: cijfers.teTekenen > 0,
      onClick: () => setPage('dossier'),
    },
    ...(perms.can('chat.use') ? [{
      key: 'overleg',
      label: 'Overleg',
      hint: 'Wat er speelt op je vestiging',
      icon: MessageSquare,
      tint: 'paars' as const,
      stat: ongelezen,
      statLabel: ongelezen === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: ongelezen > 0,
      onClick: () => setPage('overleg'),
    }] : []),
  ]

  return (
    <Shell
      roleLabel="Werknemer"
      items={items}
      active={page}
      onNavigate={setPage}
      title={meta.title}
      subtitle={page === 'vandaag' ? dateFull(Date.now()) : meta.subtitle}
    >
      {page === 'start' && <Start tegels={tegels} />}
      {page === 'vandaag' && <Vandaag />}
      {page === 'rooster' && <MijnRooster />}
      {page === 'uren' && <Uren />}
      {page === 'materiaal' && <Materiaal />}
      {page === 'kosten' && <KostenIndienen />}
      {page === 'opleiding' && <Opleiding />}
      {page === 'dossier' && <Dossier person={me} />}
      {page === 'overleg' && <Overleg />}
    </Shell>
  )
}
