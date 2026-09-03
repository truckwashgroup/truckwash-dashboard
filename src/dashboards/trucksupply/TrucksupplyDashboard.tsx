import { useMemo, useState } from 'react'
import {
  BellRing, Building2, LayoutGrid, Loader2, MessageSquare, Package, PackageCheck, PackagePlus,
  Send, Settings, TriangleAlert, Truck, Warehouse,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { Start, type Tegel } from '../../components/Tegels'
import { Modal } from '../../components/ui'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import { nieuweBestelling, openAlarmen, perVestiging, testMail, voorstelUitAlarmen } from '../../lib/trucksupply'
import { number } from '../../lib/format'
import { useAuth } from '../../store/useAuth'
import { useNavTarget, usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'
import Voorraad from './Voorraad'
import Artikelen from './Artikelen'
import Bestellingen from './Bestellingen'
import Contact from './Contact'
import Instellingen from './Instellingen'
import {
  conceptVoor, isOpen, useAlarmen, useArtikelen, useBestellingen, useVestigingen,
} from './gedeeld'
// De opmaak van alles wat hier .ts- heet, los van theme.css.
import '../../styles/trucksupply.css'

/* ------------------------------------------------------------------ *
 *  Het dashboard van Trucksupply
 *
 *  Voor de twee of drie mensen die de wasstraten bevoorraden. Wat zij
 *  's ochtends willen: in één blik zien waar iets op is, in een paar klikken
 *  een zending samenstellen, de pakbon en het label printen, en verder niets
 *  in de weg hebben. Daarom staan er op het startscherm alleen cijfers die
 *  leven en twee knoppen die het meeste werk doen.
 *
 *  Wat er bewust niet in zit: rooster, personeel, techniek, kassa's. De rol
 *  telt niet mee als personeel; wat ze zien is de voorraad van alle
 *  vestigingen en wat daaruit voortkomt.
 * ------------------------------------------------------------------ */

const TITELS: Record<string, { title: string; subtitle: string }> = {
  start: { title: 'Start', subtitle: 'Waar is iets op, en wat gaat er vandaag de deur uit' },
  voorraad: { title: 'Voorraad', subtitle: 'Alle vestigingen, hun standen en de alarmen' },
  bestellingen: { title: 'Bestellingen', subtitle: 'Van concept tot ontvangen, met pakbon en verzendlabel' },
  artikelen: { title: 'Artikelen', subtitle: 'Wat Trucksupply levert, tot in de kassa' },
  vestigingen: { title: 'Vestigingen', subtitle: 'Adres, telefoon, manager en openingstijden' },
  instellingen: { title: 'Instellingen', subtitle: 'Mailadres, ochtendmail en Exact' },
  overleg: { title: 'Overleg', subtitle: 'Contact met de vestigingen en het kantoor' },
}

export default function TrucksupplyDashboard() {
  const perms = usePerms()
  const [page, setPage] = useState('start')
  const [openBestelling, setOpenBestelling] = useState<string | null>(null)
  const ongelezen = useOverlegTeller()

  const vestigingen = useVestigingen()
  const items = useArtikelen()
  const alarmen = useAlarmen()
  const bestellingen = useBestellingen()

  const open = useMemo(() => openAlarmen(alarmen), [alarmen])
  const ongezien = open.filter((a) => !a.gezienAt).length
  const openBestellingen = bestellingen.filter(isOpen).length
  const vandaag = new Date(); vandaag.setHours(0, 0, 0, 0)
  const vandaagVerzonden = bestellingen.filter((b) => (b.verzondenAt ?? 0) >= vandaag.getTime()).length
  const actieveVestigingen = vestigingen.filter((v) => v.active && v.kind !== 'hoofdkantoor').length
  const aanvragen = bestellingen.filter((b) => b.bron === 'aanvraag' && b.status === 'concept').length

  // supply.view is 'voorraad en vestigingen zien' (permissions.ts); zonder dat
  // recht staan die twee er niet, net als bestellingen zonder supply.orders.
  const magKijken = perms.can('supply.view')
  const items_: NavItem[] = [
    { key: 'start', label: 'Start', icon: LayoutGrid },
    ...(magKijken ? [{ key: 'voorraad', label: 'Voorraad', icon: Warehouse, badge: ongezien || undefined }] : []),
    ...(perms.can('supply.orders')
      ? [{ key: 'bestellingen', label: 'Bestellingen', icon: Truck, badge: openBestellingen || undefined }]
      : []),
    ...(perms.canAny('supply.articles', 'supply.view')
      ? [{ key: 'artikelen', label: 'Artikelen', icon: Package }]
      : []),
    ...(magKijken ? [{ key: 'vestigingen', label: 'Vestigingen', icon: Building2 }] : []),
    ...(perms.can('supply.settings') ? [{ key: 'instellingen', label: 'Instellingen', icon: Settings }] : []),
    ...(perms.can('chat.use')
      ? [{ key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen || undefined }]
      : []),
  ]

  useNavTarget(items_.map((i) => i.key), (p, id) => {
    setPage(p)
    if (p === 'bestellingen' && id) setOpenBestelling(id)
  })

  const tegels: Tegel[] = [
    {
      key: 'onder-minimum',
      label: 'Onder minimum',
      hint: open.length ? `Op ${new Set(open.map((a) => a.locationId)).size} ${new Set(open.map((a) => a.locationId)).size === 1 ? 'vestiging' : 'vestigingen'}` : 'Overal op peil',
      icon: TriangleAlert,
      tint: open.length ? 'danger' : 'ok',
      stat: open.length,
      statLabel: open.length === 1 ? 'open alarm' : 'open alarmen',
      urgent: open.length > 0,
      onClick: () => setPage('voorraad'),
    },
    {
      key: 'ongezien',
      label: 'Ongezien',
      hint: 'Alarmen die nog niemand heeft bekeken',
      icon: BellRing,
      tint: ongezien ? 'warn' : 'neutraal',
      stat: ongezien,
      statLabel: ongezien === 1 ? 'nog te bekijken' : 'nog te bekijken',
      onClick: () => setPage('voorraad'),
    },
    ...(perms.can('supply.orders') ? [{
      key: 'bestellingen',
      label: 'Bestellingen open',
      hint: aanvragen ? `${aanvragen} ${aanvragen === 1 ? 'aanvraag' : 'aanvragen'} van een vestiging` : 'Concept, bevestigd en ingepakt',
      icon: Truck,
      tint: (aanvragen ? 'oranje' : 'brand') as Tegel['tint'],
      stat: openBestellingen,
      statLabel: openBestellingen === 1 ? 'in behandeling' : 'in behandeling',
      urgent: aanvragen > 0,
      onClick: () => setPage('bestellingen'),
    }, {
      key: 'verzonden',
      label: 'Vandaag verzonden',
      hint: 'Wat er vandaag de deur uit ging',
      icon: PackageCheck,
      tint: 'ok' as Tegel['tint'],
      stat: vandaagVerzonden,
      statLabel: vandaagVerzonden === 1 ? 'zending' : 'zendingen',
      onClick: () => setPage('bestellingen'),
    }] : []),
    {
      key: 'artikelen',
      label: 'Artikelen',
      hint: 'De catalogus, met foto en prijs',
      icon: Package,
      tint: 'info',
      stat: items.filter((i) => i.actief !== false).length,
      statLabel: 'op alle vestigingen',
      onClick: () => setPage('artikelen'),
    },
    {
      key: 'vestigingen',
      label: 'Vestigingen',
      hint: 'Adres, telefoon en openingstijden',
      icon: Building2,
      tint: 'neutraal',
      stat: actieveVestigingen,
      statLabel: 'actief',
      onClick: () => setPage('vestigingen'),
    },
    ...(perms.can('chat.use') ? [{
      key: 'overleg',
      label: 'Overleg',
      hint: 'Kanalen en gesprekken',
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
      roleLabel="Trucksupply"
      items={items_}
      active={page}
      onNavigate={setPage}
      title={kop.title}
      subtitle={page === 'start' && open.length === 0 ? 'Nergens iets onder het minimum. Dat is geen foutmelding.' : kop.subtitle}
    >
      {page === 'start' && (
        <Start
          tegels={tegels}
          snel={<Snelknoppen magBestellen={perms.can('supply.orders')} magInstellen={perms.can('supply.settings')} onNaarBestelling={(id) => { setOpenBestelling(id); setPage('bestellingen') }} />}
        />
      )}
      {page === 'voorraad' && magKijken && <Voorraad />}
      {page === 'bestellingen' && (
        <Bestellingen openId={openBestelling} onOpened={() => setOpenBestelling(null)} />
      )}
      {page === 'artikelen' && <Artikelen />}
      {page === 'vestigingen' && magKijken && <Contact />}
      {page === 'instellingen' && perms.can('supply.settings') && <Instellingen />}
      {page === 'overleg' && <Overleg />}
    </Shell>
  )
}

/* ================================================================== *
 *  De snelknoppen op het startscherm
 *
 *  "Zending samenstellen uit alarmen" is het werk van de ochtend in één
 *  knop: per vestiging met open alarmen een concept, met per artikel de
 *  bestelhoeveelheid. Eerst een samenvatting, dan pas maken -- negentien
 *  concepten aanmaken die je niet wilde is meer werk dan één keer lezen.
 * ================================================================== */

function Snelknoppen({
  magBestellen, magInstellen, onNaarBestelling,
}: { magBestellen: boolean; magInstellen: boolean; onNaarBestelling: (id: string) => void }) {
  const user = useAuth((s) => s.user)!
  const vestigingen = useVestigingen()
  const items = useArtikelen()
  const alarmen = useAlarmen()
  const bestellingen = useBestellingen()
  const [open, setOpen] = useState(false)
  const [gekozen, setGekozen] = useState<Set<string> | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)

  const groepen = useMemo(() => perVestiging(alarmen, vestigingen).map((g) => ({
    ...g,
    regels: voorstelUitAlarmen(g.alarmen, items),
    concept: conceptVoor(bestellingen, g.locationId),
  })), [alarmen, vestigingen, items, bestellingen])

  // Standaard alles aangevinkt behalve de vestigingen die al een concept hebben:
  // daar staat waarschijnlijk al wat er moet, en een tweede concept is ruis.
  const keuze = gekozen ?? new Set(groepen.filter((g) => !g.concept).map((g) => g.locationId))

  function wissel(id: string) {
    const n = new Set(keuze)
    if (n.has(id)) n.delete(id); else n.add(id)
    setGekozen(n)
  }

  async function maken() {
    const doen = groepen.filter((g) => keuze.has(g.locationId) && g.regels.length)
    if (!doen.length) return toast.error('Kies minstens één vestiging.')
    setBezig('zending')
    let laatste: string | null = null
    let n = 0
    try {
      for (const g of doen) {
        const { bestelling } = await nieuweBestelling({
          locationId: g.locationId, bron: 'voorraad', door: user, regels: g.regels,
        })
        laatste = bestelling.id
        n++
      }
      toast.ok(`${n} ${n === 1 ? 'concept' : 'concepten'} aangemaakt`)
      setOpen(false)
      setGekozen(null)
      if (n === 1 && laatste) onNaarBestelling(laatste)
    } catch (e) {
      toast.error((e as Error).message + (n ? ` (${n} al aangemaakt)` : ''))
    } finally {
      setBezig(null)
    }
  }

  async function proefmail() {
    setBezig('mail')
    try {
      await testMail()
      toast.ok('Proefmail gestuurd. Kijk in het postvak van Trucksupply.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBezig(null)
    }
  }

  return (
    <>
      {magBestellen && (
        <button className="btn primary sm" disabled={!groepen.length} onClick={() => { setGekozen(null); setOpen(true) }} title={groepen.length ? undefined : 'Er zijn geen open alarmen'}>
          <PackagePlus size={14} /> Zending samenstellen uit alarmen
        </button>
      )}
      {magInstellen && (
        <button className="btn sm" disabled={bezig !== null} onClick={() => void proefmail()}>
          {bezig === 'mail' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Proefmail sturen
        </button>
      )}

      <Modal
        open={open}
        title="Zending samenstellen uit alarmen"
        subtitle="Per vestiging één concept, met per artikel de bestelhoeveelheid (of genoeg om weer op twee keer het minimum te komen). Daarna kun je ze nog aanpassen."
        onClose={() => setOpen(false)}
        width={620}
      >
        <div className="ts-kieslijst">
          {groepen.map((g) => (
            <label key={g.locationId} className="ts-kiesrij ts-samenvatting">
              <input type="checkbox" checked={keuze.has(g.locationId)} onChange={() => wissel(g.locationId)} />
              <div className="ts-kiestekst">
                <strong>{g.naam}</strong>
                <span>
                  {g.regels.map((r) => `${number(r.aantal)} ${r.eenheid} ${r.itemNaam}`).join(', ')}
                </span>
                {g.concept && (
                  <span className="ts-rood">Heeft al concept {g.concept.nummer}; aanvinken maakt er een tweede.</span>
                )}
              </div>
              <span className="ts-sub">{g.regels.length} {g.regels.length === 1 ? 'regel' : 'regels'}</span>
            </label>
          ))}
        </div>
        <div className="row end">
          <span style={{ flex: 1, fontSize: '.8rem', color: 'var(--text-3)' }}>
            {keuze.size} van {groepen.length} {groepen.length === 1 ? 'vestiging' : 'vestigingen'} gekozen
          </span>
          <button className="btn ghost" onClick={() => setOpen(false)}>Annuleren</button>
          <button className="btn primary" disabled={bezig !== null || !keuze.size} onClick={() => void maken()}>
            {bezig === 'zending' ? <Loader2 size={15} className="spin" /> : <PackagePlus size={15} />}
            {keuze.size === 1 ? 'Concept maken' : `${keuze.size} concepten maken`}
          </button>
        </div>
      </Modal>
    </>
  )
}
