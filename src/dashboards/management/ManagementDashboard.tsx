import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarRange, GraduationCap, Inbox, LayoutDashboard, LayoutGrid,
  Briefcase, Building2, CalendarDays, Mail, MessageSquare, Monitor, Package, Receipt,
  Send, Settings, Users, Wrench,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { db, alleMensen } from '../../lib/db'
import { money } from '../../lib/format'
import Overzicht from './Overzicht'
import Financieel from './Financieel'
import Personeel from './Personeel'
import Voorraad from './Voorraad'
import Planning from './Planning'
import Beheer from './Beheer'
import Techniek from './Techniek'
import Aanmeldingen from './Aanmeldingen'
import Werkgevers from './Werkgevers'
import Kassas from './Kassas'
import Vestigingen from './Vestigingen'
import OpleidingOverzicht from '../../components/OpleidingOverzicht'
import BerichtVersturen from '../../components/BerichtVersturen'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import Postbus from '../../components/Postbus'
import Agenda from '../../components/Agenda'
import { Start, type Tegel, type TegelTint } from '../../components/Tegels'
import { useNavTarget, usePerms } from '../../store/useNav'
import { startOfDay } from '../../lib/analytics'
import type {
  Expense, Fault, InventoryItem, MailBericht, Signup, User, WashJob, Werkgever,
} from '../../lib/types'

const DAY = 86_400_000

const PERIODS = [
  { days: 7, label: '7 dagen' },
  { days: 30, label: '30 dagen' },
  { days: 90, label: '90 dagen' },
]

const TITLES: Record<string, { title: string; subtitle: string }> = {
  start: { title: 'Start', subtitle: 'Waar wil je heen?' },
  overzicht: { title: 'Managementoverzicht', subtitle: 'Omzet, volume en marge' },
  financieel: { title: 'Financieel', subtitle: 'Kosten valideren en resultaat' },
  personeel: { title: 'Personeel', subtitle: 'Prestaties, uren en rechten' },
  aanmeldingen: { title: 'Aanmeldingen', subtitle: 'Wie zich via de app heeft aangemeld' },
  voorraad: { title: 'Voorraad', subtitle: 'Materiaal, verbruik en bestellingen' },
  planning: { title: 'Planning', subtitle: 'Alle wasopdrachten' },
  techniek: { title: 'Techniek', subtitle: 'Storingen, onderhoud en werkbonnen' },
  opleiding: { title: 'Opleiding', subtitle: 'Voortgang van iedereen' },
  overleg: { title: 'Overleg', subtitle: 'Kanalen en gesprekken' },
  postbus: { title: 'Postbus', subtitle: 'Post die binnenkomt op het dashboard' },
  agenda: { title: 'Agenda', subtitle: 'Afspraken, verjaardagen en wat er aankomt' },
  werkgevers: { title: 'Werkgevers', subtitle: 'Bedrijven waarvan de chauffeurs hier wassen' },
  kassas: { title: "Kassa's", subtitle: 'Apparaten, koppelcodes en de kluis' },
  vestigingen: { title: 'Vestigingen', subtitle: "Adressen, foto's en openingstijden" },
  beheer: { title: 'Beheer', subtitle: 'Instellingen, rechten en gegevens' },
}

const ZONDER_PERIODE = [
  'start', 'planning', 'beheer', 'opleiding', 'aanmeldingen', 'overleg', 'postbus',
  'agenda', 'werkgevers', 'kassas', 'vestigingen',
]

export default function ManagementDashboard() {
  const [page, setPage] = useState('start')
  const [days, setDays] = useState(30)
  const [messaging, setMessaging] = useState(false)
  const perms = usePerms()

  const bonnen = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const aanmeldingen = useLiveQuery(() => db.signups.toArray(), [], [] as Signup[])
  const storingen = useLiveQuery(() => db.faults.toArray(), [], [] as Fault[])
  const voorraad = useLiveQuery(() => db.inventory.toArray(), [], [] as InventoryItem[])
  const mensen = useLiveQuery(() => alleMensen(), [], [] as User[])
  const ongelezen = useOverlegTeller()
  const post = useLiveQuery(() => db.mailbox.toArray(), [], [] as MailBericht[])
  const werkgevers = useLiveQuery(() => db.employers.toArray(), [], [] as Werkgever[])

  const jobsVandaag = useLiveQuery(
    async () => {
      const van = startOfDay(Date.now())
      return db.washJobs.where('scheduledAt').between(van, van + DAY, true, false).toArray()
    },
    [],
    [] as WashJob[],
  )

  const cijfers = useMemo(() => {
    const openKosten = bonnen.filter((b) => b.status === 'open')
    const nieuweAanmeldingen = aanmeldingen.filter((s) => s.status === 'nieuw').length
    const openStoringen = storingen.filter(
      (f) => f.status !== 'opgelost' && f.status !== 'afgewezen')
    const kritiek = openStoringen.filter(
      (f) => f.severity === 'kritiek' || f.stopsProduction).length
    const laag = voorraad.filter((i) => i.stock <= i.minStock).length
    const zonderLogin = mensen.filter(
      (u) => u.active && !u.authId && !u.roles.includes('customer')).length
    const gereed = jobsVandaag.filter((j) => j.status === 'gereed').length

    const nieuwePost = post.filter((m) => m.richting === 'in' && m.status === 'nieuw').length
    const nieuweWerkgevers = werkgevers.filter((w) => w.status === 'aangevraagd').length

    return {
      nieuwePost,
      nieuweWerkgevers,
      openKosten: openKosten.length,
      openBedrag: openKosten.reduce((a, b) => a + b.amountExcl, 0),
      nieuweAanmeldingen,
      openStoringen: openStoringen.length,
      kritiek,
      laag,
      zonderLogin,
      gereed,
      vandaag: jobsVandaag.length,
    }
  }, [bonnen, aanmeldingen, storingen, voorraad, mensen, jobsVandaag, post, werkgevers])

  const items: NavItem[] = [
    { key: 'start', label: 'Start', icon: LayoutGrid },
    { key: 'overzicht', label: 'Overzicht', icon: LayoutDashboard },
    { key: 'financieel', label: 'Financieel', icon: Receipt, badge: cijfers.openKosten || undefined },
    { key: 'planning', label: 'Planning', icon: CalendarRange },
    { key: 'personeel', label: 'Personeel', icon: Users },
    ...(perms.can('signups.view')
      ? [{ key: 'aanmeldingen', label: 'Aanmeldingen', icon: Inbox, badge: cijfers.nieuweAanmeldingen || undefined }]
      : []),
    { key: 'voorraad', label: 'Voorraad', icon: Package },
    { key: 'techniek', label: 'Techniek', icon: Wrench, badge: cijfers.kritiek || undefined },
    { key: 'opleiding', label: 'Opleiding', icon: GraduationCap },
    ...(perms.can('chat.use')
      ? [{ key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen || undefined }]
      : []),
    ...(perms.can('employer.view')
      ? [{ key: 'werkgevers', label: 'Werkgevers', icon: Briefcase,
           badge: cijfers.nieuweWerkgevers || undefined }]
      : []),
    ...(perms.can('locations.view')
      ? [{ key: 'vestigingen', label: 'Vestigingen', icon: Building2 }]
      : []),
    ...(perms.can('pos.manage')
      ? [{ key: 'kassas', label: "Kassa's", icon: Monitor }]
      : []),
    ...(perms.can('agenda.view')
      ? [{ key: 'agenda', label: 'Agenda', icon: CalendarDays }]
      : []),
    ...(perms.can('mail.read')
      ? [{ key: 'postbus', label: 'Postbus', icon: Mail, badge: cijfers.nieuwePost || undefined }]
      : []),
    { key: 'beheer', label: 'Beheer', icon: Settings },
  ]

  useNavTarget(
    [...items.map((i) => i.key),
     'klanten', 'materiaal', 'storingen', 'werkbonnen', 'installaties', 'onderhoud'],
    (p) => setPage(
      p === 'klanten' ? 'personeel' :
      p === 'materiaal' ? 'voorraad' :
      ['storingen', 'werkbonnen', 'installaties', 'onderhoud'].includes(p) ? 'techniek' : p),
  )

  const meta = TITLES[page] ?? TITLES.start
  const showPeriod = !ZONDER_PERIODE.includes(page)

  const tegels: Tegel[] = [
    {
      key: 'overzicht',
      label: 'Overzicht',
      hint: 'Omzet, volume, marge en doorlooptijd',
      icon: LayoutDashboard,
      tint: 'brand',
      stat: `${cijfers.gereed}/${cijfers.vandaag}`,
      statLabel: 'gereed vandaag',
      onClick: () => setPage('overzicht'),
    },
    {
      key: 'financieel',
      label: 'Financieel',
      hint: 'Bonnen valideren en het resultaat',
      icon: Receipt,
      tint: cijfers.openKosten ? 'warn' : 'ok',
      stat: cijfers.openKosten,
      statLabel: cijfers.openKosten
        ? `wacht op akkoord · ${money(cijfers.openBedrag)}`
        : 'alles afgehandeld',
      urgent: cijfers.openKosten > 0,
      onClick: () => setPage('financieel'),
    },
    ...(perms.can('signups.view') ? [{
      key: 'aanmeldingen',
      label: 'Aanmeldingen',
      hint: 'Mensen die zich via de app hebben aangemeld',
      icon: Inbox,
      tint: (cijfers.nieuweAanmeldingen ? 'oranje' : 'neutraal') as TegelTint,
      stat: cijfers.nieuweAanmeldingen,
      statLabel: cijfers.nieuweAanmeldingen === 1 ? 'wacht op je' : 'wachten op je',
      urgent: cijfers.nieuweAanmeldingen > 0,
      onClick: () => setPage('aanmeldingen'),
    }] : []),
    {
      key: 'techniek',
      label: 'Techniek',
      hint: 'Storingen, onderhoud en werkbonnen',
      icon: Wrench,
      tint: cijfers.kritiek ? 'danger' : 'info',
      stat: cijfers.openStoringen,
      statLabel: cijfers.kritiek ? `waarvan ${cijfers.kritiek} kritiek` : 'storingen open',
      urgent: cijfers.kritiek > 0,
      onClick: () => setPage('techniek'),
    },
    {
      key: 'personeel',
      label: 'Personeel',
      hint: 'Dossiers, rechten, uren en vestigingen',
      icon: Users,
      tint: cijfers.zonderLogin ? 'warn' : 'neutraal',
      stat: cijfers.zonderLogin || mensen.filter((u) => u.active).length,
      statLabel: cijfers.zonderLogin ? 'nog zonder inlog' : 'actieve mensen',
      onClick: () => setPage('personeel'),
    },
    {
      key: 'planning',
      label: 'Planning',
      hint: 'Alle wasopdrachten over alle vestigingen',
      icon: CalendarRange,
      tint: 'info',
      stat: cijfers.vandaag,
      statLabel: 'ingepland vandaag',
      onClick: () => setPage('planning'),
    },
    {
      key: 'voorraad',
      label: 'Voorraad',
      hint: 'Materiaal, verbruik en bestellingen',
      icon: Package,
      tint: cijfers.laag ? 'warn' : 'neutraal',
      stat: cijfers.laag,
      statLabel: 'onder het minimum',
      urgent: cijfers.laag > 3,
      onClick: () => setPage('voorraad'),
    },
    ...(perms.can('chat.use') ? [{
      key: 'overleg',
      label: 'Overleg',
      hint: 'Kanalen, vestigingen en gesprekken',
      icon: MessageSquare,
      tint: 'paars' as const,
      stat: ongelezen,
      statLabel: ongelezen === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: ongelezen > 0,
      onClick: () => setPage('overleg'),
    }] : []),
    ...(perms.can('locations.view') ? [{
      key: 'vestigingen',
      label: 'Vestigingen',
      hint: "Adressen, foto's en openingstijden",
      icon: Building2,
      tint: 'neutraal' as TegelTint,
      onClick: () => setPage('vestigingen'),
    }] : []),
    ...(perms.can('pos.manage') ? [{
      key: 'kassas',
      label: "Kassa's",
      hint: 'Apparaten, koppelcodes en de kluis',
      icon: Monitor,
      tint: 'neutraal' as TegelTint,
      onClick: () => setPage('kassas'),
    }] : []),
    ...(perms.can('employer.view') ? [{
      key: 'werkgevers',
      label: 'Werkgevers',
      hint: 'Bedrijven waarvan de chauffeurs hier wassen',
      icon: Briefcase,
      tint: (cijfers.nieuweWerkgevers ? 'oranje' : 'neutraal') as TegelTint,
      stat: cijfers.nieuweWerkgevers,
      statLabel: cijfers.nieuweWerkgevers === 1 ? 'wacht op akkoord' : 'wachten op akkoord',
      urgent: cijfers.nieuweWerkgevers > 0,
      onClick: () => setPage('werkgevers'),
    }] : []),
    ...(perms.can('agenda.view') ? [{
      key: 'agenda',
      label: 'Agenda',
      hint: 'Afspraken, verjaardagen en jubilea',
      icon: CalendarDays,
      tint: 'info' as TegelTint,
      onClick: () => setPage('agenda'),
    }] : []),
    ...(perms.can('mail.read') ? [{
      key: 'postbus',
      label: 'Postbus',
      hint: 'Bonnen en post die binnenkomen per mail',
      icon: Mail,
      tint: (cijfers.nieuwePost ? 'oranje' : 'neutraal') as TegelTint,
      stat: cijfers.nieuwePost,
      statLabel: cijfers.nieuwePost === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: cijfers.nieuwePost > 0,
      onClick: () => setPage('postbus'),
    }] : []),
    {
      key: 'opleiding',
      label: 'Opleiding',
      hint: 'Wie welke cursus heeft gehaald',
      icon: GraduationCap,
      tint: 'neutraal',
      onClick: () => setPage('opleiding'),
    },
    {
      key: 'beheer',
      label: 'Beheer',
      hint: 'Vestigingen, klanten en instellingen',
      icon: Settings,
      tint: 'neutraal',
      onClick: () => setPage('beheer'),
    },
  ]

  return (
    <Shell
      roleLabel="Management"
      items={items}
      active={page}
      onNavigate={setPage}
      title={meta.title}
      subtitle={meta.subtitle}
      actions={
        showPeriod ? (
          <div className="row hide-mobile" style={{ gap: 5 }}>
            {PERIODS.map((p) => (
              <button
                key={p.days}
                className={`btn sm ${days === p.days ? 'primary' : 'ghost'}`}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
      menu={
        perms.can('notify.send')
          ? [{
              title: 'Versturen',
              items: [{
                key: 'bericht',
                label: 'Bericht sturen',
                hint: 'Naar losse medewerkers of een hele groep',
                icon: <Send size={16} />,
                onClick: () => setMessaging(true),
              }],
            }]
          : undefined
      }
    >
      {page === 'start' && (
        <Start
          tegels={tegels}
          snel={
            perms.can('notify.send') ? (
              <button className="btn sm" onClick={() => setMessaging(true)}>
                <Send size={14} /> Bericht sturen
              </button>
            ) : undefined
          }
        />
      )}
      {page === 'overzicht' && <Overzicht days={days} />}
      {page === 'financieel' && <Financieel days={days} />}
      {page === 'personeel' && <Personeel days={days} />}
      {page === 'aanmeldingen' && <Aanmeldingen />}
      {page === 'voorraad' && <Voorraad days={days} />}
      {page === 'planning' && <Planning />}
      {page === 'techniek' && <Techniek days={days} />}
      {page === 'opleiding' && <OpleidingOverzicht />}
      {page === 'overleg' && <Overleg />}
      {page === 'postbus' && <Postbus />}
      {page === 'agenda' && <Agenda />}
      {page === 'werkgevers' && <Werkgevers />}
      {page === 'kassas' && <Kassas />}
      {page === 'vestigingen' && <Vestigingen />}
      {page === 'beheer' && <Beheer />}

      <BerichtVersturen open={messaging} onClose={() => setMessaging(false)} />
    </Shell>
  )
}
