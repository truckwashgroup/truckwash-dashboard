import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ClipboardCheck, Clock, MessageSquare, Receipt, UserPlus, Users,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { Start, type Tegel } from '../../components/Tegels'
import { db } from '../../lib/db'
import type { DossierWijziging, Expense, HourRequest, Signup } from '../../lib/types'
import Kostenposten from './Kostenposten'
import Urenverzoeken from '../../components/Urenverzoeken'
import { OpenWijzigingen } from '../../components/Wijzigingen'
import Aanmeldingen from '../management/Aanmeldingen'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import { useNavTarget, usePerms } from '../../store/useNav'

/* ------------------------------------------------------------------ *
 *  Het administratiedashboard
 *
 *  Eén rode draad: hier staat wat op een beslissing wacht. Kostenposten,
 *  urenwijzigingen, aanpassingen in een dossier en aanmeldingen stonden
 *  verspreid over vier schermen van het management, tussen de grafieken en
 *  de planning door. Wie vier lijsten moet openen om te weten of hij klaar
 *  is, denkt op een gegeven moment dat hij klaar is.
 *
 *  Wat er bewust niet in zit: het rooster maken, de planning, de voorraad,
 *  de techniek. Dat is uitvoeren, en wie uitvoert hoort niet ook zijn eigen
 *  werk af te tekenen.
 * ------------------------------------------------------------------ */

const TITELS: Record<string, { title: string; subtitle: string }> = {
  start: { title: 'Te doen', subtitle: 'Alles wat op een beslissing wacht' },
  kosten: { title: 'Kostenposten', subtitle: 'Bonnen en facturen beoordelen' },
  uren: { title: 'Urenwijzigingen', subtitle: 'Correcties op wat er is geklokt' },
  dossiers: { title: 'Dossierwijzigingen', subtitle: 'Wat medewerkers zelf willen aanpassen' },
  aanmeldingen: { title: 'Aanmeldingen', subtitle: 'Wie zich via de app heeft gemeld' },
  overleg: { title: 'Overleg', subtitle: 'Kanalen en gesprekken' },
}

export default function AdministratieDashboard() {
  const [page, setPage] = useState('start')
  const perms = usePerms()
  const ongelezen = useOverlegTeller()

  const bonnen = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const uren = useLiveQuery(() => db.hourRequests.toArray(), [], [] as HourRequest[])
  const wijzigingen = useLiveQuery(
    () => db.changeRequests.toArray(), [], [] as DossierWijziging[])
  const aanmeldingen = useLiveQuery(() => db.signups.toArray(), [], [] as Signup[])

  const wacht = useMemo(() => ({
    kosten: bonnen.filter((e) => e.status === 'open').length,
    // Een bon zonder bedrag is erger dan een bon die op akkoord wacht: daar
    // kun je niets over beslissen tot iemand hem aanvult.
    kaal: bonnen.filter((e) => e.status === 'open' && e.amountExcl === 0).length,
    uren: uren.filter((u) => u.status === 'nieuw').length,
    dossiers: wijzigingen.filter((w) => w.status === 'open').length,
    aanmeldingen: aanmeldingen.filter((s) => s.status === 'nieuw').length,
  }), [bonnen, uren, wijzigingen, aanmeldingen])

  const totaal = wacht.kosten + wacht.uren + wacht.dossiers + wacht.aanmeldingen

  const items: NavItem[] = [
    { key: 'start', label: 'Te doen', icon: ClipboardCheck, badge: totaal || undefined },
    ...(perms.can('expenses.approve')
      ? [{ key: 'kosten', label: 'Kostenposten', icon: Receipt, badge: wacht.kosten || undefined }]
      : []),
    ...(perms.can('hours.approve')
      ? [{ key: 'uren', label: 'Urenwijzigingen', icon: Clock, badge: wacht.uren || undefined }]
      : []),
    ...(perms.can('staff.view')
      ? [{ key: 'dossiers', label: 'Dossiers', icon: Users, badge: wacht.dossiers || undefined }]
      : []),
    ...(perms.can('signups.view')
      ? [{ key: 'aanmeldingen', label: 'Aanmeldingen', icon: UserPlus,
           badge: wacht.aanmeldingen || undefined }]
      : []),
    ...(perms.can('chat.use')
      ? [{ key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen || undefined }]
      : []),
  ]

  useNavTarget(items.map((i) => i.key), setPage)

  const tegels: Tegel[] = [
    ...(perms.can('expenses.approve') ? [{
      key: 'kosten',
      label: 'Kostenposten',
      hint: wacht.kaal
        ? `${wacht.kaal} zonder bedrag — laat de factuur voorlezen`
        : 'Bonnen en facturen beoordelen',
      icon: Receipt,
      tint: (wacht.kosten ? 'oranje' : 'neutraal') as Tegel['tint'],
      stat: wacht.kosten,
      statLabel: wacht.kosten === 1 ? 'wacht op akkoord' : 'wachten op akkoord',
      urgent: wacht.kosten > 0,
      onClick: () => setPage('kosten'),
    }] : []),
    ...(perms.can('hours.approve') ? [{
      key: 'uren',
      label: 'Urenwijzigingen',
      hint: 'Wie niet op tijd geklokt heeft vraagt hier een correctie',
      icon: Clock,
      tint: (wacht.uren ? 'oranje' : 'neutraal') as Tegel['tint'],
      stat: wacht.uren,
      statLabel: wacht.uren === 1 ? 'openstaand verzoek' : 'openstaande verzoeken',
      urgent: wacht.uren > 0,
      onClick: () => setPage('uren'),
    }] : []),
    ...(perms.can('staff.view') ? [{
      key: 'dossiers',
      label: 'Dossierwijzigingen',
      hint: 'Een gewijzigd rekeningnummer neem je niet zomaar over',
      icon: Users,
      tint: (wacht.dossiers ? 'oranje' : 'neutraal') as Tegel['tint'],
      stat: wacht.dossiers,
      statLabel: wacht.dossiers === 1 ? 'te beoordelen' : 'te beoordelen',
      urgent: wacht.dossiers > 0,
      onClick: () => setPage('dossiers'),
    }] : []),
    ...(perms.can('signups.view') ? [{
      key: 'aanmeldingen',
      label: 'Aanmeldingen',
      hint: 'Wie zich via de app heeft gemeld',
      icon: UserPlus,
      tint: (wacht.aanmeldingen ? 'oranje' : 'neutraal') as Tegel['tint'],
      stat: wacht.aanmeldingen,
      statLabel: wacht.aanmeldingen === 1 ? 'nieuwe aanmelding' : 'nieuwe aanmeldingen',
      urgent: wacht.aanmeldingen > 0,
      onClick: () => setPage('aanmeldingen'),
    }] : []),
    ...(perms.can('chat.use') ? [{
      key: 'overleg',
      label: 'Overleg',
      hint: 'Kanalen, vestigingen en gesprekken',
      icon: MessageSquare,
      tint: 'paars' as Tegel['tint'],
      stat: ongelezen,
      statLabel: ongelezen === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: ongelezen > 0,
      onClick: () => setPage('overleg'),
    }] : []),
  ]

  const kop = TITELS[page] ?? TITELS.start

  return (
    <Shell
      roleLabel="Administratie"
      items={items}
      active={page}
      onNavigate={setPage}
      title={kop.title}
      subtitle={page === 'start' && totaal === 0
        ? 'Er staat niets open. Dat is geen foutmelding.'
        : kop.subtitle}
    >
      {page === 'start' && (
        <Start tegels={tegels} />
      )}
      {page === 'kosten' && <Kostenposten />}
      {page === 'uren' && <Urenverzoeken />}
      {page === 'dossiers' && <OpenWijzigingen />}
      {page === 'aanmeldingen' && <Aanmeldingen />}
      {page === 'overleg' && <Overleg />}
    </Shell>
  )
}
